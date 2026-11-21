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
 * Ponte do app DTCar CLONE com o adaptador OBD (ELM327) por Bluetooth clássico (SPP).
 *
 * É o mesmo plugin burro do app principal: abre a conexão, manda uma linha de texto e devolve o que
 * o adaptador respondeu. Quem entende de OBD/UDS é a tela (clone/www/index.html).
 *
 * DIFERENÇA para o plugin do app do pátio: este app é a FERRAMENTA DE CLONE (só no celular do
 * administrador) e precisa conversar com cada módulo por UDS para LER o máximo que ele expõe. Por isso
 * a lista branca aqui aceita, além do OBD-II de leitura:
 *   - comandos AT de ENDEREÇAMENTO do adaptador (ATSH/ATCRA/ATFC…): escolhem com qual módulo falar.
 *     Isso é ajuste do ELM327, NÃO escreve no carro.
 *   - serviços UDS de LEITURA: 22 (ler dado por identificador), 19 (ler falhas), 1A (ler dado KWP),
 *     10 só nas sessões 01 (padrão) e 03 (estendida), 3E (tester present).
 *
 * CONTINUA BLOQUEADO, igual ao app do pátio, tudo que ESCREVE ou AGE no carro:
 *   04/14 (apagar falha), 2E/3D/3B (gravar), 2F/AE (atuador, mesmo incompleto), 31 (rotina), 34-37 (transferência),
 *   27 (destravar), 11/28/85 (reiniciar/comunicação), e a sessão de programação (10 02).
 * Este app NÃO tem o método apagar(): ele só lê.
 *
 * A promessa "este app não regrava nem altera módulo" é garantida AQUI, no nativo, porque o app abre
 * um site e qualquer script da página alcança o plugin — então a trava não pode viver no JavaScript.
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

    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final char PRONTO = '>';
    private static final int ESPERA_PADRAO = 5000;
    private static final int ESPERA_MAXIMA = 20000;

    /** Comandos AT por IGUALDADE: ajustes do adaptador, nenhum chega ao carro. */
    private static final Set<String> AT_EXATOS = new HashSet<>(Arrays.asList(
        "ATZ", "ATD", "ATE0", "ATE1", "ATL0", "ATL1", "ATS0", "ATS1",
        "ATH0", "ATH1", "ATAL", "ATDP", "ATDPN", "ATRV", "ATI",
        "ATCAF0", "ATCAF1", "ATAT0", "ATAT1", "ATAT2", "ATCSM0", "ATCSM1",
        "ATAR", "ATCRA"
    ));

    /**
     * Comandos AT por PREFIXO: levam um valor (hex) depois. São de ENDEREÇAMENTO/tempo do ELM327:
     * ATSP escolhe o protocolo; ATSH o cabeçalho de quem envia; ATCRA o filtro de quem responde;
     * ATFCSH/ATFCSD/ATFCSM o controle de fluxo do ISO-TP; ATST o tempo de espera; ATCM/ATCF a máscara
     * e o filtro do CAN. Nada disso escreve no carro: é configuração da conversa.
     */
    private static final String[] AT_PREFIXOS = {
        "ATSP", "ATSH", "ATCRA", "ATFCSH", "ATFCSD", "ATFCSM", "ATST", "ATCM", "ATCF", "ATAR", "ATBI"
    };

    /** Serviços OBD-II de LEITURA. 04 (apagar) de fora, de propósito. */
    private static final Set<String> OBD_LEITURA = new HashSet<>(Arrays.asList(
        "01", "02", "03", "06", "07", "09", "0A"
    ));

    /** Serviços UDS de LEITURA liberados por completo (qualquer operando). 23 = ler memória por endereço (leitura). */
    private static final Set<String> UDS_LEITURA = new HashSet<>(Arrays.asList(
        "22", "19", "1A", "23"
    ));

    private final ExecutorService fila = Executors.newSingleThreadExecutor();

    private volatile BluetoothSocket soquete;
    private volatile InputStream entrada;
    private volatile OutputStream saida;
    private volatile String conectadoEm;
    private volatile String conectadoNome;

    /* ------------------------------------------------------------------ comandos permitidos */

    static String normalizar(String cru) {
        return cru == null ? "" : cru.trim().replace(" ", "").replace("\t", "").toUpperCase();
    }

    /** Diz se o comando pode ir ao adaptador. Só leitura e configuração; nada que escreva no carro. */
    static boolean permitido(String cru) {
        String c = normalizar(cru);
        if (c.isEmpty()) return false;
        if (c.startsWith("AT")) {
            if (AT_EXATOS.contains(c)) return true;
            for (String p : AT_PREFIXOS) {
                if (c.startsWith(p) && c.length() > p.length() && c.substring(p.length()).matches("[0-9A-F]+")) {
                    return true;
                }
            }
            return false;
        }
        // pedido ao carro: só hexadecimal, em bytes inteiros, de 1 a 8 bytes
        if (!c.matches("[0-9A-F]+") || c.length() % 2 != 0 || c.length() < 2 || c.length() > 16) return false;
        String servico = c.substring(0, 2);
        if (OBD_LEITURA.contains(servico)) return true;
        if (UDS_LEITURA.contains(servico)) return true;
        // 10 (controle de sessão) só nas sessões de LEITURA: 01 padrão e 03 estendida. 02 (programação) jamais.
        if (servico.equals("10")) return c.equals("1001") || c.equals("1003");
        // 3E (tester present) só nas duas formas padrão.
        if (servico.equals("3E")) return c.equals("3E00") || c.equals("3E80");
        // AE (device control GMLAN) e 2F (controle de E/S UDS) ficam FORA, inclusive "incompletos":
        // pela GMW3110 §8.20.6 há CPIDs que executam com ZERO bytes de controle, e AE00 é comando válido
        // (achado da revisão do Codex no PR #169). O clone só lê; mapear saída por sonda é coisa de bancada.
        return false;
    }

    /* ------------------------------------------------------------------ permissões */

    private boolean precisaPedir() {
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

    @PluginMethod
    public void listar(PluginCall call) {
        if (!temPermissao()) { call.reject("sem-permissao"); return; }
        BluetoothAdapter a = adaptador();
        if (a == null) { call.reject("sem-bluetooth"); return; }
        if (!a.isEnabled()) { call.reject("bluetooth-desligado"); return; }
        JSArray lista = new JSArray();
        try {
            for (BluetoothDevice d : a.getBondedDevices()) {
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
        if (endereco == null || endereco.isEmpty()) { call.reject("sem-endereco"); return; }
        if (!temPermissao()) { call.reject("sem-permissao"); return; }
        final BluetoothAdapter a = adaptador();
        if (a == null) { call.reject("sem-bluetooth"); return; }
        if (!a.isEnabled()) { call.reject("bluetooth-desligado"); return; }
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
                    fechar(); call.reject("sem-permissao");
                } catch (IllegalArgumentException e) {
                    fechar(); call.reject("endereco-invalido");
                } catch (IOException e) {
                    fechar(); call.reject("nao-conectou");
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
        entrada = null; saida = null; soquete = null; conectadoEm = null; conectadoNome = null;
    }

    /* ------------------------------------------------------------------ comandos */

    @PluginMethod
    public void comando(final PluginCall call) {
        final String cmd = call.getString("cmd");
        if (cmd == null || cmd.trim().isEmpty()) { call.reject("sem-comando"); return; }
        if (!permitido(cmd)) { call.reject("comando-recusado"); return; }
        enviar(call, normalizar(cmd), call.getInt("esperaMs", ESPERA_PADRAO));
    }

    private void enviar(final PluginCall call, final String limpo, final int pedida) {
        final int espera = Math.max(500, Math.min(pedida, ESPERA_MAXIMA));
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

    private void naFila(final PluginCall call, final Runnable tarefa) {
        try {
            fila.execute(new Runnable() {
                @Override
                public void run() {
                    try { tarefa.run(); }
                    catch (Throwable t) { try { call.reject("falhou"); } catch (Throwable ignorado) { } }
                }
            });
        } catch (RuntimeException e) {
            call.reject("sem-conexao");
        }
    }

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
                try { Thread.sleep(20); }
                catch (InterruptedException e) { Thread.currentThread().interrupt(); break; }
            }
        }
        return sb.toString();
    }

    @Override
    protected void handleOnDestroy() {
        fechar();
        fila.shutdownNow();
    }
}
