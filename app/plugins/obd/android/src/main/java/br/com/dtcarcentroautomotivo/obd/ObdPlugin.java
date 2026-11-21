package br.com.dtcarcentroautomotivo.obd;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Ponte entre o app da DTCar e o adaptador OBD (ELM327) por Bluetooth clássico (perfil serial, SPP).
 *
 * De propósito esta parte é BURRA: ela abre a conexão, manda uma linha de texto e devolve o que o
 * adaptador respondeu. Quem sabe o que é um código de falha, um PID ou um monitor é o js/obd.js, que
 * roda no site. Assim quase tudo pode ser testado sem celular e sem carro, e o APK só precisa ser
 * refeito se esta ponte mudar — as telas continuam chegando pelo site, como no resto do app.
 *
 * Uma conexão de cada vez (é um adaptador só, na tomada do carro) e os comandos saem em fila, um
 * depois do outro: o ELM327 não aceita dois pedidos ao mesmo tempo.
 *
 * SEGURANÇA — por que existe lista branca aqui: o app abre um SITE, então tudo o que este plugin
 * expõe fica alcançável por qualquer script daquela página. Sem a lista, um script poderia mandar
 * o serviço 04 (apagar as falhas do carro) ou escrever no barramento. Essa promessa não pode viver
 * só no JavaScript: ela é garantida aqui.
 *
 * O que o app passou a fazer (atuador, aprendizado, codificação de bico) ESCREVE no carro, então a
 * lista branca deixou de ser "só leitura" e virou duas listas: o que passa pelo comando() continua
 * sendo leitura e ajuste do adaptador, e cada coisa que age no carro ganhou MÉTODO PRÓPRIO, com
 * nome, mais abaixo. E ficou uma proibição que não tem exceção nem método: regravar memória de
 * módulo. Sem os serviços de transferência e sem a sessão de programação, não há como.
 */
@CapacitorPlugin(
    name = "DtcarObd",
    permissions = {
        @Permission(
            alias = ObdPlugin.ALIAS_BLUETOOTH,
            strings = { Manifest.permission.BLUETOOTH_CONNECT }
        )
    }
)
public class ObdPlugin extends Plugin {

    static final String ALIAS_BLUETOOTH = "bluetooth";

    /** perfil serial do Bluetooth: é por aqui que todo ELM327 conversa */
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    /** o ELM327 termina toda resposta com este sinal, pedindo o comando seguinte */
    private static final char PRONTO = '>';

    private static final int ESPERA_PADRAO = 5000;
    private static final int ESPERA_MAXIMA = 20000;

    /**
     * Comandos de configuração do adaptador que o app usa. Nada aqui chega ao carro: são ajustes do
     * próprio ELM327 (reiniciar, tirar o eco, escolher o protocolo, dizer qual protocolo achou).
     */
    private static final Set<String> AT_PERMITIDOS = new HashSet<>(Arrays.asList(
        "ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATH1", "ATSP0", "ATDP", "ATDPN", "ATRV", "ATI",
        // Para falar com UM módulo (UDS) o adaptador precisa de cabeçalho, filtro e controle de
        // fluxo. Continua sendo ajuste do próprio ELM327: nenhum destes sai para o barramento.
        //
        // ATCAF0 ficou FORA de propósito, e a razão é a parte mais importante deste arquivo:
        // com a formatação automática LIGADA (ATCAF1), o adaptador monta o quadro e o primeiro byte
        // do que o site manda é o SERVIÇO — que é justamente o que permitido() confere. Com ela
        // DESLIGADA, o primeiro byte passa a ser o byte de controle do ISO-TP e o serviço escorrega
        // para a segunda posição. Aí "022EF190..." seria conferido como serviço 02 (foto do momento
        // da falha, que é de leitura) e chegaria ao barramento como 2E, GRAVAR NO MÓDULO. O mesmo
        // truque abriria o 34 e a regravação. Então ATCAF0 não entra, e permitido() só é confiável
        // porque ele não entra.
        "ATCAF1", "ATCRA", "ATSP6", "ATSP7"
    ));

    /**
     * Comandos de ajuste que levam valor (cabeçalho, filtro, controle de fluxo, tempo de espera).
     * O valor é conferido um por um: só hexadecimal e no tamanho exato que aquele comando aceita.
     * Também são ajustes do adaptador, não pedidos ao carro.
     */
    private static boolean atComValor(String c) {
        // ATSH e ATFCSH dizem PARA ONDE o quadro vai, então só valem endereços de diagnóstico.
        // Com endereço livre, um script da página mandaria um pedido de leitura para qualquer
        // identificador do barramento — e aí o "pedido" vira um quadro forjado na rede do motor ou
        // do freio, com o conteúdo quase à escolha. Achado na releitura de 21/11/2026.
        if (c.startsWith("ATSH")) return enderecoDeDiagnostico(c.substring(4));
        if (c.startsWith("ATCRA")) return hexExato(c.substring(5), 3) || hexExato(c.substring(5), 8);
        if (c.startsWith("ATFCSH")) return enderecoDeDiagnostico(c.substring(6));
        // ATFCSD é o CONTEÚDO do quadro de controle de fluxo, e esse quadro vai ao barramento para o
        // cabeçalho que o ATFCSH escolheu — SEM o adaptador acrescentar byte de controle. Ou seja, o
        // primeiro byte é o que vem do site, que é exatamente a condição que faz o permitido()
        // valer para os outros pedidos e NÃO vale para este. Com valor livre, o site escolheria os
        // bytes de um quadro e o endereço de destino: é o mesmo furo do ATCAF0 por outra porta.
        // Então aqui vale UM valor só, o que o app usa: 30 00 00 = "pode mandar o resto, sem pausa".
        if (c.startsWith("ATFCSD")) return c.equals("ATFCSD300000");
        if (c.startsWith("ATFCSM")) return c.length() == 7 && c.charAt(6) >= '0' && c.charAt(6) <= '2';
        if (c.startsWith("ATST")) return hexExato(c.substring(4), 2);
        return false;
    }

    /**
     * Endereço para onde um pedido de diagnóstico pode ir: em 11 bits, de 600 a 7FF (onde moram os
     * módulos e o funcional 7DF); em 29 bits, os formatos 18DA (um módulo) e 18DB (funcional).
     */
    static boolean enderecoDeDiagnostico(String e) {
        if (hexExato(e, 3)) { int n = Integer.parseInt(e, 16); return n >= 0x600 && n <= 0x7FF; }
        return hexExato(e, 8) && (e.startsWith("18DA") || e.startsWith("18DB"));
    }

    /**
     * Serviços de LEITURA que o app pode pedir ao carro pelo comando(). Os de UDS (19 falhas por
     * módulo, 22 ler dado, 24 ler a escala do dado, 3E sinal de presença) entraram em 20/11/2026;
     * o 10 (sessão) tem portão próprio em permitido(). Os do OBD-II:
     * 01 dados ao vivo · 02 foto do momento da falha · 03 falhas confirmadas · 06 testes de bordo ·
     * 07 falhas pendentes · 09 informação do veículo (chassi) · 0A falhas permanentes.
     *
     * O serviço 04 (apagar falhas) está FORA de propósito, e qualquer outro também: quando a etapa 2
     * trouxer o apagar com registro de quem apagou, ele entra aqui junto com a regra de permissão.
     */
    private static final Set<String> SERVICOS_LEITURA = new HashSet<>(Arrays.asList(
        "01", "02", "03", "06", "07", "09", "0A",
        "19", "21", "22", "24", "3E"
    ));

    /** Quais dos de leitura são do UDS: só muda o tamanho de pedido que cada um aceita. */
    private static final Set<String> UDS_LEITURA = new HashSet<>(Arrays.asList("19", "22", "24", "3E"));

    /**
     * Serviços que este plugin NUNCA manda — não estão na lista do comando() e não têm método próprio.
     *
     * 34 pedir download · 35 pedir upload · 36 transferir bloco · 37 encerrar transferência: é com
     * estes que se REGRAVA a memória de um módulo. Sem eles, e sem a sessão de programação (ver o
     * portão do serviço 10 em permitido()), não existe regravação por aqui — aconteça o que
     * acontecer na página que o app abre. É a promessa que esta oficina pode fazer com segurança:
     * o app aciona atuador e roda rotina de serviço, e não tem como gravar programa em módulo nenhum.
     */
    private static final Set<String> SERVICOS_PROIBIDOS = new HashSet<>(Arrays.asList(
        "34", "35", "36", "37"
    ));

    private final ExecutorService fila = Executors.newSingleThreadExecutor();

    // escritos na thread da fila e lidos na do WebView: precisam de volatile
    private volatile BluetoothSocket soquete;
    private volatile InputStream entrada;
    private volatile OutputStream saida;
    private volatile String conectadoEm;
    private volatile String conectadoNome;
    /** O último cabeçalho aceito (ATSH): para quem o pedido está indo agora. */
    private volatile String cabecalho = "";
    /** O pedido anterior estourou o tempo? Então a resposta dele pode chegar com atraso. */
    private volatile boolean ultimoEstourou = false;

    /* ------------------------------------------------------------------ comandos permitidos */

    /**
     * Deixa o comando num jeito só (sem espaço, maiúsculas). O ELM327 ignora espaço e não diferencia
     * maiúscula de minúscula, então isto não muda o que o adaptador entende — e é ESTE texto que vai
     * para o carro, não o original: assim o que foi conferido e o que é enviado são a mesma coisa.
     */
    static String normalizar(String cru) {
        return cru == null ? "" : cru.trim().replace(" ", "").replace("\t", "").toUpperCase();
    }

    /** Diz se o comando pode ir ao adaptador. */
    static boolean permitido(String cru) {
        String c = normalizar(cru);
        if (c.isEmpty()) return false;
        if (c.startsWith("AT")) return AT_PERMITIDOS.contains(c) || atComValor(c);
        // pedido ao carro: só hexadecimal e em bytes inteiros
        if (!c.matches("[0-9A-F]+") || c.length() % 2 != 0 || c.length() < 2) return false;
        String sv = c.substring(0, 2);
        if (SERVICOS_PROIBIDOS.contains(sv)) return false;
        // Abrir sessão (10): a comum (01) e a estendida de diagnóstico (03) passam. A de PROGRAMAÇÃO
        // (02) não passa, e é ela que a regravação exige — por isso o portão é aqui, e não no site.
        if (sv.equals("10")) return c.equals("1001") || c.equals("1003");
        // O tamanho é conferido por serviço, não por igual: um pedido de OBD-II cabe em 7 bytes
        // (modo 01 aceita 6 PIDs), e passar disso é lixo. Os de UDS pedem mais, porque o
        // identificador do dado já ocupa dois bytes e o pedido de falha leva a máscara de situação.
        // Leitura por identificador local (21, do KWP2000 sobre CAN): um byte de identificador e mais
        // nada. É como Toyota, Renault e Peugeot entregam boa parte dos dados de montadora.
        if (sv.equals("21")) return c.length() == 4;
        if (SERVICOS_LEITURA.contains(sv)) {
            int maximo = UDS_LEITURA.contains(sv) ? 32 : 14;
            return c.length() <= maximo;
        }
        return false;
    }

    /**
     * Diz se o número da rotina está na faixa que o fabricante usa para rotina de veículo
     * (0x0200 a 0xDFFF, pela ISO 14229-1). Fora dela ficam a rotina de apagar memória (0xFF00) e as
     * de programação — e é por isso que esta conferência é aqui embaixo, e não no site.
     */
    static boolean rotinaNaFaixa(String rid) {
        if (!hexExato(normalizar(rid), 4)) return false;
        int n = Integer.parseInt(normalizar(rid), 16);
        return n >= 0x0200 && n <= 0xDFFF;
    }

    /**
     * Diz se um dado pode ser GRAVADO por aqui.
     *
     * A faixa F180 a F1FF é a da IDENTIFICAÇÃO do módulo pela ISO 14229-1: chassi (F190), número da
     * peça, número do programa, número de série. Nada ali é dado de calibração, e gravar chassi é
     * coisa que só se faz com má intenção — então a faixa inteira fica fora, e o portão é aqui
     * embaixo, onde um script da página não alcança.
     *
     * O que a gravação existe para fazer (código de bico) não está nessa faixa.
     */
    static boolean didGravavel(String did) {
        if (!hexExato(normalizar(did), 4)) return false;
        int n = Integer.parseInt(normalizar(did), 16);
        return n < 0xF180 || n > 0xF1FF;
    }

    /**
     * Diz se o cabeçalho aponta para o módulo do MOTOR. A gravação de dado só existe para ele.
     * 7E0 é o endereço que a norma do OBD em CAN (ISO 15765-4) dá ao módulo do motor; 18DA10F1 é o
     * mesmo módulo nos carros de 29 bits. Câmbio, ABS, airbag, painel e imobilizador ficam de fora
     * por construção: é neles que mora o perigo de uma escrita errada.
     */
    static boolean moduloDoMotor(String cab) {
        String c = normalizar(cab);
        return c.equals("7E0") || c.equals("18DA10F1");
    }

    /** Hexadecimal com exatamente este tanto de dígitos. */
    private static boolean hexExato(String c, int quantos) {
        return c != null && c.length() == quantos && c.matches("[0-9A-F]{" + quantos + "}");
    }

    /** Hexadecimal em bytes inteiros. Vazio conta como válido: há comando sem valor. */
    private static boolean ehHexPar(String c) {
        return c != null && c.length() % 2 == 0 && (c.isEmpty() || c.matches("[0-9A-F]+"));
    }

    /* ------------------------------------------------------------------ permissões */

    private boolean precisaPedir() {
        // Android 11 e anteriores usam as permissões antigas, concedidas na instalação.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.S;
    }

    private boolean temPermissao() {
        return !precisaPedir() || getPermissionState(ALIAS_BLUETOOTH) == PermissionState.GRANTED;
    }

    @PluginMethod
    public void permissao(PluginCall call) {
        JSObject r = new JSObject();
        r.put("concedida", temPermissao());
        r.put("pedeNaHora", precisaPedir());
        call.resolve(r);
    }

    @PluginMethod
    public void pedirPermissao(PluginCall call) {
        if (temPermissao()) {
            JSObject r = new JSObject();
            r.put("concedida", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias(ALIAS_BLUETOOTH, call, "aposPermissao");
    }

    @PermissionCallback
    private void aposPermissao(PluginCall call) {
        JSObject r = new JSObject();
        r.put("concedida", temPermissao());
        call.resolve(r);
    }

    /* ------------------------------------------------------------------ adaptadores */

    private BluetoothAdapter adaptador() {
        BluetoothManager m = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return m == null ? null : m.getAdapter();
    }

    /** Aparelhos já pareados no celular. O app não pareia: isso é feito uma vez nos Ajustes do Android. */
    @PluginMethod
    public void listar(PluginCall call) {
        if (!temPermissao()) {
            call.reject("sem-permissao");
            return;
        }
        BluetoothAdapter a = adaptador();
        if (a == null) {
            call.reject("sem-bluetooth");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("bluetooth-desligado");
            return;
        }
        JSArray lista = new JSArray();
        try {
            Set<BluetoothDevice> pareados = a.getBondedDevices();
            for (BluetoothDevice d : pareados) {
                JSObject o = new JSObject();
                String nome = d.getName();
                o.put("nome", nome == null ? d.getAddress() : nome);
                o.put("endereco", d.getAddress());
                lista.put(o);
            }
        } catch (SecurityException e) {
            call.reject("sem-permissao");
            return;
        }
        JSObject r = new JSObject();
        r.put("aparelhos", lista);
        call.resolve(r);
    }

    /* ------------------------------------------------------------------ conexão */

    @PluginMethod
    public void situacao(PluginCall call) {
        BluetoothSocket s = soquete;
        boolean ligado = s != null && s.isConnected();
        JSObject r = new JSObject();
        r.put("conectado", ligado);
        r.put("endereco", ligado ? conectadoEm : null);
        r.put("nome", ligado ? conectadoNome : null);
        call.resolve(r);
    }

    @PluginMethod
    public void conectar(final PluginCall call) {
        final String endereco = call.getString("endereco");
        if (endereco == null || endereco.isEmpty()) {
            call.reject("sem-endereco");
            return;
        }
        if (!temPermissao()) {
            call.reject("sem-permissao");
            return;
        }
        final BluetoothAdapter a = adaptador();
        if (a == null) {
            call.reject("sem-bluetooth");
            return;
        }
        if (!a.isEnabled()) {
            call.reject("bluetooth-desligado");
            return;
        }
        naFila(call, new Runnable() {
            @Override
            public void run() {
                fechar();
                try {
                    BluetoothDevice d = a.getRemoteDevice(endereco);
                    BluetoothSocket s = d.createRfcommSocketToServiceRecord(SPP);
                    s.connect();
                    soquete = s;
                    entrada = s.getInputStream();
                    saida = s.getOutputStream();
                    conectadoEm = endereco;
                    String nome = d.getName();
                    conectadoNome = nome == null ? endereco : nome;
                    JSObject r = new JSObject();
                    r.put("conectado", true);
                    r.put("endereco", conectadoEm);
                    r.put("nome", conectadoNome);
                    call.resolve(r);
                } catch (SecurityException e) {
                    fechar();
                    call.reject("sem-permissao");
                } catch (IllegalArgumentException e) {
                    fechar();
                    call.reject("endereco-invalido");
                } catch (IOException e) {
                    fechar();
                    call.reject("nao-conectou");
                }
            }
        });
    }

    @PluginMethod
    public void desconectar(final PluginCall call) {
        naFila(call, new Runnable() {
            @Override
            public void run() {
                fechar();
                JSObject r = new JSObject();
                r.put("conectado", false);
                call.resolve(r);
            }
        });
    }

    private synchronized void fechar() {
        try { if (entrada != null) entrada.close(); } catch (IOException ignorado) { }
        try { if (saida != null) saida.close(); } catch (IOException ignorado) { }
        try { if (soquete != null) soquete.close(); } catch (IOException ignorado) { }
        entrada = null;
        saida = null;
        soquete = null;
        conectadoEm = null;
        conectadoNome = null;
        cabecalho = "";
        ultimoEstourou = false;
    }

    /* ------------------------------------------------------------------ comandos */

    /**
     * Manda uma linha para o adaptador e devolve o que ele respondeu até o sinal de pronto ('>').
     * Nada aqui interpreta a resposta: ela sobe como texto para o js/obd.js.
     */
    @PluginMethod
    public void comando(final PluginCall call) {
        final String cmd = call.getString("cmd");
        if (cmd == null || cmd.trim().isEmpty()) {
            call.reject("sem-comando");
            return;
        }
        if (!permitido(cmd)) {
            call.reject("comando-recusado");
            return;
        }
        final String limpo = normalizar(cmd);
        // Guarda para onde os pedidos estão indo: os métodos que AGEM conferem isso antes de sair.
        //
        // E ZERA quando o adaptador volta ao padrão. ATZ reinicia o ELM327 e qualquer ATSP troca o
        // protocolo — nos dois casos o cabeçalho de transmissão volta ao padrão, que nos protocolos
        // do ISO 15765-4 é justamente o endereço de DIFUSÃO. Sem zerar, a variável continuaria
        // dizendo "um módulo" com o adaptador já em difusão, e a trava dos métodos que agem
        // deixaria passar. Não é teórico: o uds.fechar() manda ATSP0, então o fluxo normal do app
        // já dessincronizava. Achado na reconferência da revisão independente, 20/11/2026.
        if (limpo.startsWith("ATSH")) cabecalho = limpo.substring(4);
        else if (limpo.startsWith("ATSP") || limpo.equals("ATZ") || limpo.equals("ATD") || limpo.equals("ATWS")) cabecalho = "";
        enviar(call, limpo, call.getInt("esperaMs", ESPERA_PADRAO));
    }

    /**
     * Diz se o cabeçalho corrente é de DIFUSÃO — o pedido iria para todos os módulos de uma vez.
     *
     * 7DF é o endereço funcional do OBD-II e 18DB33F1 o equivalente em 29 bits: quem responde é
     * quem quiser. Ler em difusão é normal e é o que o OBD-II faz. AGIR em difusão não é: um
     * reiniciarModulo em 7DF reinicia o carro inteiro, e um apagar em difusão limpa a falha de todos
     * os módulos de uma vez, inclusive as que o mecânico ainda não leu. Então os métodos que agem
     * exigem cabeçalho de UM módulo. Achado da revisão independente de 20/11/2026.
     */
    private boolean emDifusao() {
        String c = cabecalho == null ? "" : cabecalho;
        if (c.isEmpty()) return true;
        if (c.length() == 3) {
            // 11 bits: o que não pode é o endereço FUNCIONAL, 7DF, em que quem responde é quem
            // quiser — agir ali vai para todos os módulos de uma vez. Fora dele, o endereço é de um
            // módulo, e a faixa de diagnóstico vai de 600 a 7FF: a VAG usa 70A, a Renault 743 e
            // 747, e prender isto a 7E0-7E7 (os endereços do OBD-II) barraria módulo legítimo.
            int n;
            try { n = Integer.parseInt(c, 16); } catch (NumberFormatException e) { return true; }
            return n == 0x7DF || n < 0x600 || n > 0x7FF;
        }
        if (c.length() == 8) {
            // 29 bits: o formato físico (um módulo) tem 18DA como prefixo; o funcional é 18DB.
            // Por regra, e não por lista: um funcional com outro endereço de origem passaria numa
            // lista de dois valores. Reparo pedido na reconferência da revisão, 20/11/2026.
            return !c.startsWith("18DA");
        }
        return true;
    }

    /**
     * Apaga as falhas do carro (serviço 04). MÉTODO PRÓPRIO, de propósito.
     *
     * O app abre um SITE, então todo método do plugin fica ao alcance de qualquer script daquela página. Por isso o 04
     * NÃO entra na lista branca do comando(): assim continua valendo a regra de que nada que passa por comando() escreve
     * no carro, e o único jeito de apagar é esta chamada, que tem nome, aparece sozinha no código e se acha numa busca.
     * Quem pode apagar é decidido no sistema (Sistema › Equipe, por pessoa) e o apagamento fica registrado no banco:
     * aqui embaixo não há como saber quem está segurando o celular.
     */
    @PluginMethod
    public void apagar(final PluginCall call) {
        final boolean porUds = "uds".equals(call.getString("modo", "obd"));
        // O apagar por UDS é de UM módulo. Em difusão ele limparia a falha de todos de uma vez,
        // inclusive as que o mecânico ainda não leu.
        if (porUds && emDifusao()) {
            call.reject("sem-modulo-escolhido");
            return;
        }
        enviar(call, comandoApagar(porUds), call.getInt("esperaMs", 10000));
    }

    /**
     * O comando de apagar, escrito AQUI e em nenhum outro lugar.
     *
     * São só dois, os dois literais: 04 é o apagar do OBD-II (chega no módulo do motor) e
     * 14 FF FF FF é o do UDS, que apaga as falhas de UM módulo escolhido — é o que a varredura do
     * carro inteiro usa. O site escolhe entre um e outro; o TEXTO do comando nunca vem do site.
     */
    static String comandoApagar(boolean porUds) {
        return porUds ? "14FFFFFF" : "04";
    }

    /* ------------------------------------------------------------- o que AGE no carro (UDS) */

    /*
     * Daqui para baixo, cada coisa que mexe no carro tem MÉTODO PRÓPRIO e nenhuma passa pelo
     * comando(). Vale a razão do apagar: o app abre um site, e a promessa de que uma leitura não
     * vira um comando não pode morar no JavaScript. Quem pode fazer cada uma é decidido no sistema
     * (Sistema › Equipe, por pessoa) — aqui embaixo não há como saber quem está com o celular.
     *
     * REGISTRO: hoje só o apagar do OBD-II fica gravado no banco. Atuador, aprendizado e apagar por
     * módulo NÃO ficam, porque a tabela obd_leituras só aceita os tipos "leitura" e "apagar" e
     * estender isso é SQL, que é do Danilo. Enquanto não entrar, a tela diz que o teste não fica
     * registrado, em vez de dar a entender que fica.
     *
     * Nenhum destes métodos regrava módulo: os serviços de transferência estão proibidos lá em cima
     * e a sessão de programação não passa do portão. O limite é de propósito: dá para codificar bico
     * e rodar rotina de serviço, e não dá para gravar programa.
     */

    /**
     * Teste de atuador (UDS 0x2F): manda o módulo acionar uma saída.
     * Formato: 2F <identificador> <opção> <valor>. A opção 03 é o ajuste de curta duração, que
     * aciona; a 00 devolve o controle ao módulo. O site sempre termina na 00, mesmo se der erro no
     * meio — atuador que fica preso no comando do aparelho é atuador que queima.
     */
    @PluginMethod
    public void atuar(final PluginCall call) {
        final String did = normalizar(call.getString("did"));
        final String opcao = normalizar(call.getString("opcao", "03"));
        final String valor = normalizar(call.getString("valor", ""));
        if (!hexExato(did, 4) || !hexExato(opcao, 2) || !ehHexPar(valor) || valor.length() > 12) {
            call.reject("comando-recusado");
            return;
        }
        if (Integer.parseInt(opcao, 16) > 0x03) {   // a norma define de 00 a 03
            call.reject("comando-recusado");
            return;
        }
        if (emDifusao()) {
            call.reject("sem-modulo-escolhido");
            return;
        }
        enviar(call, "2F" + did + opcao + valor, call.getInt("esperaMs", 8000));
    }

    /**
     * Rotina de serviço (UDS 0x31): aprendizado, calibração, reset de serviço, autoteste.
     * Subfunção 01 começa, 02 para, 03 pede o resultado.
     *
     * O NÚMERO da rotina é conferido aqui: só passa a faixa 0x0200 a 0xDFFF, que é onde a ISO 14229-1
     * põe as rotinas de veículo do fabricante. Com isso a rotina de apagar memória (0xFF00) e as de
     * programação ficam fora de alcance mesmo que a página peça por elas.
     */
    @PluginMethod
    public void rotina(final PluginCall call) {
        final String sub = normalizar(call.getString("sub", "01"));
        final String rid = normalizar(call.getString("rotina"));
        final String dados = normalizar(call.getString("dados", ""));
        if (!hexExato(sub, 2) || !hexExato(rid, 4) || !ehHexPar(dados) || dados.length() > 16) {
            call.reject("comando-recusado");
            return;
        }
        if (!sub.equals("01") && !sub.equals("02") && !sub.equals("03")) {
            call.reject("comando-recusado");
            return;
        }
        if (!rotinaNaFaixa(rid)) {
            call.reject("rotina-fora-da-faixa");
            return;
        }
        if (emDifusao()) {
            call.reject("sem-modulo-escolhido");
            return;
        }
        enviar(call, "31" + sub + rid + dados, call.getInt("esperaMs", 15000));
    }

    /**
     * Grava UM dado no módulo do motor (UDS 0x2E). Existe para o código de bico injetor.
     * Voltou em 21/11/2026 por decisão do Danilo, com a autorização do administrador pedida na tela.
     *
     * O que ESTE método garante, aqui embaixo, onde um script da página não alcança:
     *  - só o módulo do MOTOR (moduloDoMotor): nada de câmbio, airbag, painel ou imobilizador;
     *  - nunca a faixa de identificação (chassi, número de peça): didGravavel;
     *  - LÊ O VALOR ANTIGO ANTES, com o mesmo identificador, e só grava se o módulo o entregou. O
     *    valor antigo volta junto na resposta: sem ele não há como desfazer, então sem ele não grava;
     *  - no máximo 32 bytes de valor, que é muito mais que um código de bico e muito menos que
     *    qualquer coisa parecida com programa.
     * O que NÃO existe: destravar (0x27). O app não tem a conta da chave de nenhuma família, então
     * módulo que exige destravar recusa a gravação (resposta 0x33) e é isso que a tela mostra.
     * A sessão de programação (10 02) e os serviços de transferência continuam proibidos.
     */
    @PluginMethod
    public void gravarDado(final PluginCall call) {
        final String did = normalizar(call.getString("did"));
        final String valor = normalizar(call.getString("valor", ""));
        if (!didGravavel(did) || !ehHexPar(valor) || valor.length() < 2 || valor.length() > 64) {
            call.reject(hexExato(did, 4) && !didGravavel(did) ? "did-protegido" : "comando-recusado");
            return;
        }
        if (emDifusao()) {
            call.reject("sem-modulo-escolhido");
            return;
        }
        if (!moduloDoMotor(cabecalho)) {
            call.reject("so-modulo-do-motor");
            return;
        }
        final int espera = Math.max(500, Math.min(call.getInt("esperaMs", 8000), ESPERA_MAXIMA));
        naFila(call, new Runnable() {
            @Override
            public void run() {
                final InputStream in = entrada;
                final OutputStream out = saida;
                final BluetoothSocket s = soquete;
                if (s == null || !s.isConnected() || in == null || out == null) {
                    call.reject("sem-conexao");
                    return;
                }
                try {
                    descartarAtrasado(in);
                    try { Thread.sleep(120); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    descartarAtrasado(in);
                    ultimoEstourou = false;
                    out.write(("22" + did + "\r").getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    String antes = ler(in, espera);
                    if (!valorAntigoValido(antes, did)) {
                        if (antes.startsWith("STOPPED") || antes.isEmpty()) ultimoEstourou = true;
                        JSObject r = new JSObject();
                        r.put("gravou", false);
                        r.put("antes", antes);
                        r.put("resposta", "");
                        call.resolve(r);
                        return;
                    }
                    out.write(("2E" + did + valor + "\r").getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    String resposta = ler(in, espera);
                    if (resposta.startsWith("STOPPED") || resposta.isEmpty()) ultimoEstourou = true;
                    JSObject r = new JSObject();
                    r.put("gravou", true);
                    r.put("antes", antes);
                    r.put("resposta", resposta);
                    call.resolve(r);
                } catch (IOException e) {
                    fechar();
                    call.reject("conexao-caiu");
                }
            }
        });
    }

    /**
     * Pergunta ao módulo do motor se ele ACEITA gravar um dado, SEM GRAVAR NADA.
     * (Pedido do Danilo, 21/11/2026: a opção de gravar só aparece no módulo que aceita.)
     *
     * Como dá para perguntar sem gravar: a norma (ISO 14229-1) manda o módulo conferir o pedido de
     * gravação nesta ordem — o dado existe e é gravável (senão 0x31), está destravado (senão 0x33)
     * e, por último, o TAMANHO bate (senão 0x13). Então o app manda o pedido com tamanho ERRADO de
     * propósito: lê o valor atual, e só pergunta se ele tem 2 bytes ou mais, mandando UM byte.
     * Um pedido de tamanho errado não tem como ser gravado; a resposta diz em que degrau parou.
     * Resposta 0x13 = passou por tudo e só o tamanho não bateu = o módulo aceita gravar ali.
     * O byte mandado é montado aqui, não vem da página.
     */
    @PluginMethod
    public void sondarGravacao(final PluginCall call) {
        final String did = normalizar(call.getString("did"));
        if (!didGravavel(did)) {
            call.reject(hexExato(did, 4) ? "did-protegido" : "comando-recusado");
            return;
        }
        if (emDifusao()) {
            call.reject("sem-modulo-escolhido");
            return;
        }
        if (!moduloDoMotor(cabecalho)) {
            call.reject("so-modulo-do-motor");
            return;
        }
        final int espera = Math.max(500, Math.min(call.getInt("esperaMs", 6000), ESPERA_MAXIMA));
        naFila(call, new Runnable() {
            @Override
            public void run() {
                final InputStream in = entrada;
                final OutputStream out = saida;
                final BluetoothSocket s = soquete;
                if (s == null || !s.isConnected() || in == null || out == null) {
                    call.reject("sem-conexao");
                    return;
                }
                try {
                    descartarAtrasado(in);
                    try { Thread.sleep(120); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                    descartarAtrasado(in);
                    ultimoEstourou = false;
                    out.write(("22" + did + "\r").getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    String antes = ler(in, espera);
                    JSObject r = new JSObject();
                    r.put("antes", antes);
                    if (!podeSondarGravacao(antes, did)) {
                        if (antes.startsWith("STOPPED") || antes.isEmpty()) ultimoEstourou = true;
                        r.put("perguntou", false);
                        r.put("resposta", "");
                        call.resolve(r);
                        return;
                    }
                    out.write(("2E" + did + "00\r").getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    String resposta = ler(in, espera);
                    if (resposta.startsWith("STOPPED") || resposta.isEmpty()) ultimoEstourou = true;
                    r.put("perguntou", true);
                    r.put("resposta", resposta);
                    call.resolve(r);
                } catch (IOException e) {
                    fechar();
                    call.reject("conexao-caiu");
                }
            }
        });
    }

    /**
     * A pergunta "aceita gravar?" só é feita quando o valor atual tem DOIS BYTES OU MAIS: aí o
     * pedido de um byte é de tamanho errado com certeza e não pode ser gravado. Com dado de um byte
     * a pergunta SERIA uma gravação, então não é feita.
     */
    static boolean podeSondarGravacao(String respostaDaLeitura, String did) {
        if (!valorAntigoValido(respostaDaLeitura, did)) return false;
        String r = respostaDaLeitura.toUpperCase().replaceAll("[^0-9A-F]", "");
        return r.length() >= 6 + 4;   // 62 + identificador (2 bytes) + pelo menos 2 bytes de dado
    }

    /**
     * Diz se a leitura de antes de gravar devolveu MESMO o valor daquele identificador: a resposta
     * tem de começar com 62 + o identificador e trazer pelo menos um byte de dado. Recusa (7F),
     * silêncio ou resposta de outro identificador não servem — e sem valor antigo não se grava.
     */
    static boolean valorAntigoValido(String resposta, String did) {
        String r = resposta == null ? "" : resposta.toUpperCase().replaceAll("[^0-9A-F]", "");
        String d = normalizar(did);
        return hexExato(d, 4) && r.startsWith("62" + d) && r.length() >= 8;
    }

    /*
     * NÃO EXISTE AQUI, de propósito: destravar (0x27). O app não tem a conta da chave de nenhuma
     * família de módulo, e método publicado que ninguém usa é superfície de ataque de graça.
     */


    /**
     * Reinicia o módulo (UDS 0x11): 01 reinício completo, 03 leve.
     * Vários módulos só passam a valer o dado gravado depois disto — é o último passo da codificação
     * de bico, e por isso tem método, com nome, em vez de entrar escondido na lista do comando().
     */
    @PluginMethod
    public void reiniciarModulo(final PluginCall call) {
        final String tipo = normalizar(call.getString("tipo", "01"));
        if (!tipo.equals("01") && !tipo.equals("03")) {
            call.reject("comando-recusado");
            return;
        }
        if (emDifusao()) {
            call.reject("sem-modulo-escolhido");
            return;
        }
        enviar(call, "11" + tipo, call.getInt("esperaMs", 10000));
    }

    /** Manda a linha já conferida e devolve o que o adaptador respondeu. */
    private void enviar(final PluginCall call, final String limpo, final int pedida) {
        final int espera = Math.max(500, Math.min(pedida, ESPERA_MAXIMA));
        naFila(call, new Runnable() {
            @Override
            public void run() {
                // cópia local: a fila pode ser fechada por handleOnDestroy enquanto a leitura corre
                final InputStream in = entrada;
                final OutputStream out = saida;
                final BluetoothSocket s = soquete;
                if (s == null || !s.isConnected() || in == null || out == null) {
                    call.reject("sem-conexao");
                    return;
                }
                try {
                    // Esvazia o que ficou do pedido anterior ANTES de escrever.
                    //
                    // Por que isso importa mais aqui do que parece: quando um pedido estoura o
                    // tempo, a resposta dele pode chegar depois, e fica guardada no soquete. Sem
                    // esvaziar, ela entra na resposta do pedido SEGUINTE. A conferência do site
                    // pega troca de serviço (a resposta tem de começar com serviço + 0x40), mas
                    // NÃO pega resposta do mesmo serviço vinda de outro módulo: ler as falhas do
                    // módulo A com tempo estourado, apontar o cabeçalho para o B e ler as falhas
                    // dele mostraria as falhas de A com o nome de B. Num laudo de oficina esse é o
                    // pior defeito possível, e com o UDS, que fala com um módulo de cada vez, a
                    // chance de acontecer é muito maior do que no OBD-II.
                    descartarAtrasado(in);
                    // Se o pedido ANTERIOR estourou o tempo, a resposta dele pode ainda estar no
                    // caminho: esvaziar uma vez só não pega o que chega depois do esvaziamento.
                    // Então espera um instante e esvazia de novo. Reparo pedido na reconferência da
                    // revisão independente, 20/11/2026.
                    if (ultimoEstourou) {
                        try { Thread.sleep(120); } catch (InterruptedException ie) { Thread.currentThread().interrupt(); }
                        descartarAtrasado(in);
                        ultimoEstourou = false;
                    }
                    out.write((limpo + "\r").getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    String resposta = ler(in, espera);
                    // tempo estourado SEM nenhum byte também conta: a resposta pode chegar depois
                    if (resposta.startsWith("STOPPED") || resposta.isEmpty()) ultimoEstourou = true;
                    JSObject r = new JSObject();
                    r.put("resposta", resposta);
                    call.resolve(r);
                } catch (IOException e) {
                    fechar();
                    call.reject("conexao-caiu");
                }
            }
        });
    }

    /**
     * Põe a tarefa na fila garantindo que a chamada do JavaScript SEMPRE termina.
     * Sem isto, uma falha inesperada dentro da fila não resolveria nem rejeitaria a chamada, e a tela
     * ficaria em "Lendo as falhas…" para sempre.
     */
    private void naFila(final PluginCall call, final Runnable tarefa) {
        try {
            fila.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        tarefa.run();
                    } catch (Throwable t) {
                        try { call.reject("falhou"); } catch (Throwable ignorado) { }
                    }
                }
            });
        } catch (RuntimeException e) {
            // fila já encerrada (app fechando)
            call.reject("sem-conexao");
        }
    }

    /** Joga fora o que sobrou de um pedido anterior que estourou o tempo. */
    private void descartarAtrasado(InputStream in) throws IOException {
        byte[] balde = new byte[256];
        int voltas = 0;
        // o limite de voltas existe para um adaptador que fala sem parar não prender a fila
        while (in.available() > 0 && voltas++ < 64) {
            if (in.read(balde) <= 0) break;
        }
    }

    /** Lê até o sinal de pronto do ELM327 ou até acabar o tempo. */
    private String ler(InputStream in, int espera) throws IOException {
        StringBuilder sb = new StringBuilder();
        byte[] balde = new byte[256];
        long limite = System.currentTimeMillis() + espera;
        while (System.currentTimeMillis() < limite) {
            if (in.available() > 0) {
                int lidos = in.read(balde);
                if (lidos > 0) {
                    sb.append(new String(balde, 0, lidos, StandardCharsets.US_ASCII));
                    int fim = sb.indexOf(String.valueOf(PRONTO));
                    if (fim >= 0) return sb.substring(0, fim);
                }
            } else {
                try {
                    Thread.sleep(20);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    break;
                }
            }
        }
        // Sem o sinal de pronto, o pedido estourou o tempo. Devolver o pedaço que chegou como se
        // fosse resposta boa é o começo do defeito descrito em descartarAtrasado: o site poderia
        // interpretar meia resposta. Então vai marcado, e o js/obd.js trata como recusa.
        return sb.length() == 0 ? "" : ("STOPPED " + sb.toString());
    }

    @Override
    protected void handleOnDestroy() {
        fechar();
        fila.shutdownNow();
    }
}
