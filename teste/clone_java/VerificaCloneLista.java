package br.com.dtcarcentroautomotivo.obd;
public class VerificaCloneLista {
  static int ok = 0, falhas = 0;
  static void chk(String nome, boolean cond){ if(cond) ok++; else { falhas++; System.out.println("  FALHOU: "+nome); } }
  public static void main(String[] a){
    // LEITURA que o clone PRECISA poder mandar (o pátio bloqueia, aqui é liberado)
    for(String c : new String[]{
        "ATZ","ATE0","ATL0","ATS0","ATH1","ATH0","ATCAF1","ATCAF0","ATSP0","ATDP","ATDPN","ATRV","ATI",
        "ATSH7E0","ATCRA7E8","ATFCSH7E0","ATFCSD300000","ATFCSM1","ATST64","ATSP6","ATCM7E8","ATCF7E8",
        "0100","010C","03","07","0A","0902","0904","0906","0600",
        "22F190","22F18C","1902FF","1A90","1003","1001","3E00","3E80"})
      chk("permite leitura "+c, ObdPlugin.permitido(c));
    chk("espaço/minúscula não mudam", ObdPlugin.permitido("22 f1 90") && ObdPlugin.permitido("at sh 7e0"));

    // ESCRITA/AÇÃO no carro: RECUSADA de todo jeito (a trava do clone)
    for(String c : new String[]{
        "04","0401"," 04","2E F190 00","2EF19000","3401","3501","3601","3701","2F1234030100",
        "31010203","27 01","2701","11 01","1101","14FFFFFF","1082","10 02","3D F190 00","2804","8503",
        "ATMA","ATWS"})
      chk("RECUSA ação no carro "+c, !ObdPlugin.permitido(c));

    // 10 só sessão de leitura; 3E só padrão
    chk("RECUSA sessão de programação 1002", !ObdPlugin.permitido("1002"));
    chk("permite sessão estendida 1003", ObdPlugin.permitido("1003"));
    chk("RECUSA 3E fora do padrão", !ObdPlugin.permitido("3E01"));

    // AT de prefixo só com hex depois; sem lixo
    chk("RECUSA ATSH sem valor", !ObdPlugin.permitido("ATSH"));
    chk("RECUSA ATSHXYZ", !ObdPlugin.permitido("ATSHXYZ"));

    // lixo
    for(String c : new String[]{"","   ","ZZ","011","0","01;04","01\r04"})
      chk("RECUSA lixo '"+c.replace("\r","\\r")+"'", !ObdPlugin.permitido(c));
    chk("nulo não explode", !ObdPlugin.permitido(null));

    System.out.println(falhas==0 ? ok+" conferências do clone passaram." : ok+" ok, "+falhas+" FALHARAM");
    if(falhas>0) System.exit(1);
  }
}
