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
    for (String c : new String[]{"2E F190 00","2EF19000","3401","27 01","2701","08","0E","19 02 FF","1902FF","ATSH7E0","ATMA","ATPP0CSV19","ATD","ATWS","ATBRD23","ATCAF0","ATAL","ATST64"})
      chk("RECUSA " + c, !ObdPlugin.permitido(c));
    // lixo
    for (String c : new String[]{"", "   ", "ZZ", "011", "0", "01020304050607080910", "01;04", "01\r04", "01\n04"})
      chk("RECUSA lixo '" + c.replace("\r","\\r").replace("\n","\\n") + "'", !ObdPlugin.permitido(c));
    chk("nulo não explode", !ObdPlugin.permitido(null));
    System.out.println(falhas == 0 ? ok + " conferências da lista branca passaram." : ok + " ok, " + falhas + " FALHARAM");
    if (falhas > 0) System.exit(1);
  }
}
