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
 * o serviço 04 (apagar as falhas do carro) ou escrever no barramento. A etapa 1 é só leitura, e essa
 * promessa não pode viver só no JavaScript: ela é garantida aqui.
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
        "ATZ", "ATE0", "ATL0", "ATS0", "ATH0", "ATH1", "ATSP0", "ATDP", "ATDPN", "ATRV", "ATI"
    ));

    /**
     * Serviços de LEITURA do OBD-II que o app pode pedir ao carro:
     * 01 dados ao vivo · 02 foto do momento da falha · 03 falhas confirmadas · 06 testes de bordo ·
     * 07 falhas pendentes · 09 informação do veículo (chassi) · 0A falhas permanentes.
     *
     * O serviço 04 (apagar falhas) está FORA de propósito, e qualquer outro também: quando a etapa 2
     * trouxer o apagar com registro de quem apagou, ele entra aqui junto com a regra de permissão.
     */
    private static final Set<String> SERVICOS_LEITURA = new HashSet<>(Arrays.asList(
        "01", "02", "03", "06", "07", "09", "0A"
    ));

    private final ExecutorService fila = Executors.newSingleThreadExecutor();

    // escritos na thread da fila e lidos na do WebView: precisam de volatile
    private volatile BluetoothSocket soquete;
    private volatile InputStream entrada;
    private volatile OutputStream saida;
    private volatile String conectadoEm;
    private volatile String conectadoNome;

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
        if (c.startsWith("AT")) return AT_PERMITIDOS.contains(c);
        // pedido de OBD: só hexadecimal, em bytes inteiros, e no máximo 7 bytes
        if (!c.matches("[0-9A-F]+") || c.length() % 2 != 0 || c.length() < 2 || c.length() > 14) return false;
        return SERVICOS_LEITURA.contains(c.substring(0, 2));
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
        enviar(call, normalizar(cmd), call.getInt("esperaMs", ESPERA_PADRAO));
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
        enviar(call, "04", call.getInt("esperaMs", 10000));
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
                    out.write((limpo + "\r").getBytes(StandardCharsets.US_ASCII));
                    out.flush();
                    String resposta = ler(in, espera);
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
        // Sem o sinal de pronto: devolve o que chegou, para o js/obd.js decidir se dá ou não.
        return sb.toString();
    }

    @Override
    protected void handleOnDestroy() {
        fechar();
        fila.shutdownNow();
    }
}
