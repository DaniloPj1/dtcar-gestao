package br.com.dtcarcentroautomotivo.obd;
public class VerificaListaBranca {
  static int ok = 0, falhas = 0;
  static void chk(String nome, boolean cond) { if (cond) ok++; else { falhas++; System.out.println("  FALHOU: " + nome); } }
  public static void main(String[] a) {
    // o que o app usa tem de passar
    for (String c : new String[]{"ATZ","ATE0","ATL0","ATS0","ATH0","ATSP0","ATDP","0100","0101","010C","03","07","0A","0902","0600","0620","0621","020C00"})
      chk("permite " + c, ObdPlugin.permitido(c));
    chk("espaço e minúscula não mudam o comando", ObdPlugin.permitido("at z") && ObdPlugin.permitido("atz") && ObdPlugin.permitido("01 0c"));
    chk("o que vai ao carro é o texto conferido", ObdPlugin.normalizar(" 01 0c ").equals("010C") && ObdPlugin.normalizar("\tatz").equals("ATZ"));
    chk("espaço no meio não faz passar o que é proibido", !ObdPlugin.permitido("0 4") && !ObdPlugin.permitido("2 E F1 90 00"));
    // apagar falha: recusado de todas as formas
    for (String c : new String[]{"04","04 ","0401"," 04","o4".replace("o","0") + "", "0404"})
      chk("RECUSA apagar falha: '" + c + "'", !ObdPlugin.permitido(c));
    // escrita no carro e truques
    for (String c : new String[]{"2E F190 00","2EF19000","3401","27 01","2701","08","0E","ATMA","ATPP0CSV19","ATD","ATWS","ATBRD23"})
      chk("RECUSA " + c, !ObdPlugin.permitido(c));
    // lixo
    for (String c : new String[]{"", "   ", "ZZ", "011", "0", "01020304050607080910", "01;04", "01\r04", "01\n04"})
      chk("RECUSA lixo '" + c.replace("\r","\\r").replace("\n","\\n") + "'", !ObdPlugin.permitido(c));
    chk("nulo não explode", !ObdPlugin.permitido(null));

    /* ---------------- UDS: o que a camada nova precisa, e o que ela não pode ---------------- */
    // Ajuste do adaptador para falar com UM módulo. Nada disto sai para o barramento.
    for (String c : new String[]{"ATSH7E0","ATSH18DB33F1","ATCRA7E8","ATCRA18DAF110","ATCRA","ATFCSH7E0",
                                 "ATFCSD300000","ATFCSM1","ATST64","ATCAF1","ATSP6","ATSP7"})
      chk("permite ajuste do UDS " + c, ObdPlugin.permitido(c));
    /* A lista branca é só o que o app MANDA. ATAL, ATAR, ATAT, ATCF e ATCM entraram numa primeira
     * versão e nenhuma tela usava: lista branca com comando que ninguém manda é superfície de
     * ataque de graça. Saíram na revisão de 20/11/2026. */
    for (String c : new String[]{"ATAL","ATAR","ATAT1","ATAT0","ATCF7E0","ATCM7FF","ATSP8","ATSP9"})
      chk("RECUSA ajuste que o app não usa: " + c, !ObdPlugin.permitido(c));
    /* ATCAF0 é RECUSADO, e isto é o que faz todo o resto do portão valer.
     * Com a formatação automática ligada (ATCAF1) o primeiro byte do que o site manda é o SERVIÇO,
     * que é o que permitido() confere. Desligada, o primeiro byte vira o controle do ISO-TP e o
     * serviço escorrega um byte: "022EF190" passaria como serviço 02 (leitura) e chegaria ao carro
     * como 2E, GRAVAR. Se alguém puser ATCAF0 na lista, este teste reprova — e tem de reprovar. */
    chk("RECUSA ATCAF0 (desligar a formatação deslocaria o byte do serviço)", !ObdPlugin.permitido("ATCAF0"));
    chk("RECUSA ATCAF0 com espaço", !ObdPlugin.permitido("AT CAF 0"));
    chk("e o pedido que o truque usaria continua sendo lido pelo primeiro byte",
      ObdPlugin.permitido("022EF190") && !ObdPlugin.permitido("2EF19000"));
    // Valor torto no ajuste não passa: nem letra fora do hexadecimal, nem tamanho errado, nem modo inexistente.
    for (String c : new String[]{"ATSHZZZ","ATSH7E","ATSH7E00","ATCRAZZZ","ATFCSM3","ATSTZZ","ATSH"})
      chk("RECUSA ajuste torto " + c, !ObdPlugin.permitido(c));
    /* Faixa de identificação do módulo (F180-F1FF): chassi, número de peça, número de programa.
     * Nada ali é dado de calibração, e gravar chassi é coisa que só se faz com má intenção. */
    for (String d : new String[]{"F190","F180","F1FF","F18C","F1A2"})
      chk("RECUSA gravar na faixa de identificação: " + d, !ObdPlugin.didGravavel(d));
    for (String d : new String[]{"F17F","F200","0300","2A10","FFFF"})
      chk("permite gravar fora dela: " + d, ObdPlugin.didGravavel(d));
    for (String d : new String[]{"","ZZZZ","F19",null})
      chk("RECUSA dado torto no gravar: " + d, !ObdPlugin.didGravavel(d));
    // Leitura por módulo: falha com situação, ler dado, ler a escala do dado, e o sinal de presença.
    for (String c : new String[]{"1902FF","19 02 FF","190A","22F190","22F1A0","24F190","3E00","3E80"})
      chk("permite leitura de UDS " + c, ObdPlugin.permitido(c));
    // Sessão: a comum e a estendida passam; a de PROGRAMAÇÃO não — é ela que a regravação exige.
    chk("permite sessão comum (1001)", ObdPlugin.permitido("1001"));
    chk("permite sessão estendida (1003)", ObdPlugin.permitido("1003"));
    chk("RECUSA sessão de programação (1002)", !ObdPlugin.permitido("1002"));
    chk("RECUSA sessão de programação com espaço", !ObdPlugin.permitido("10 02"));
    for (String c : new String[]{"1000","1004","1081","10"})
      chk("RECUSA sessão " + c, !ObdPlugin.permitido(c));
    // Regravar memória de módulo: não existe por aqui, nem na lista nem em método.
    for (String c : new String[]{"34","3400","340011","35","3501","36","3601","37","3700"})
      chk("RECUSA transferência de bloco " + c, !ObdPlugin.permitido(c));
    // O que AGE no carro continua fora do comando(): só pelos métodos próprios.
    for (String c : new String[]{"2F010003","2F 0100 03","310102 00".replace(" ",""),"3101AD6E","2EF19841424344",
                                 "2701","270212345678","1101","1103","14FFFFFF"})
      chk("RECUSA pelo comando(): " + c, !ObdPlugin.permitido(c));
    // Pedido de OBD-II comprido continua sendo lixo: o limite de tamanho é por serviço.
    for (String c : new String[]{"01020304050607080910","0101020304050607","03FFFFFFFFFFFFFF"})
      chk("RECUSA pedido de OBD-II comprido " + c, !ObdPlugin.permitido(c));

    /* ---------------- faixa da rotina de serviço (0x0200 a 0xDFFF) ---------------- */
    for (String r : new String[]{"0200","A001","AD6E","DFFF","1234"})
      chk("rotina na faixa do fabricante: " + r, ObdPlugin.rotinaNaFaixa(r));
    // Fora da faixa ficam o apagar memória e as de programação: nem pelo método próprio passam.
    for (String r : new String[]{"FF00","FF01","0000","00FF","01FF","E000","E200","FFFF","E001"})
      chk("RECUSA rotina fora da faixa: " + r, !ObdPlugin.rotinaNaFaixa(r));
    for (String r : new String[]{"","ZZZZ","20","02000",null})
      chk("RECUSA rotina torta: " + r, !ObdPlugin.rotinaNaFaixa(r));

    /* ---------------- cada coisa que age tem método próprio, com nome ---------------- */
    for (String nome : new String[]{"atuar","rotina","gravar","destravar","reiniciarModulo","apagar"}) {
      try {
        java.lang.reflect.Method m = ObdPlugin.class.getMethod(nome, com.getcapacitor.PluginCall.class);
        chk(nome + " está marcado com @PluginMethod", m.getAnnotation(com.getcapacitor.PluginMethod.class) != null);
        chk(nome + " não recebe o comando de fora (só PluginCall)", m.getParameterCount() == 1);
      } catch (NoSuchMethodException e) { chk(nome + " existe como método do plugin", false); }
    }
    // Regravar módulo não tem método nenhum, de propósito.
    for (String nome : new String[]{"transferir","baixarPrograma","flash","programar","regravar"}) {
      boolean existe = true;
      try { ObdPlugin.class.getMethod(nome, com.getcapacitor.PluginCall.class); }
      catch (NoSuchMethodException e) { existe = false; }
      chk("NÃO existe método " + nome, !existe);
    }
    // Apagar (v62): existe como método PRÓPRIO, com @PluginMethod, e NÃO passa pela lista branca do comando().
    // É assim que continua valendo a regra "nada que passa por comando() escreve no carro".
    try {
      java.lang.reflect.Method m = ObdPlugin.class.getMethod("apagar", com.getcapacitor.PluginCall.class);
      chk("apagar existe como método do plugin", m != null);
      chk("apagar está marcado com @PluginMethod", m.getAnnotation(com.getcapacitor.PluginMethod.class) != null);
      chk("apagar não recebe o comando de fora (só PluginCall)", m.getParameterCount() == 1);
    } catch (NoSuchMethodException e) { chk("apagar existe como método do plugin", false); }
    chk("o 04 continua fora da lista branca do comando()", !ObdPlugin.permitido("04"));
    // O texto do comando de apagar sai do próprio código: são dois literais, e nada mais.
    chk("apagar do OBD-II é exatamente 04", ObdPlugin.comandoApagar(false).equals("04"));
    chk("apagar do UDS é exatamente 14FFFFFF", ObdPlugin.comandoApagar(true).equals("14FFFFFF"));
    System.out.println(falhas == 0 ? ok + " conferências da lista branca passaram." : ok + " ok, " + falhas + " FALHARAM");
    if (falhas > 0) System.exit(1);
  }
}
