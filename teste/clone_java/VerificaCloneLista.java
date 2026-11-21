package br.com.dtcarcentroautomotivo.obd;
public class VerificaCloneLista {
  static int ok = 0, falhas = 0;
  static void chk(String nome, boolean cond){ if(cond) ok++; else { falhas++; System.out.println("  FALHOU: "+nome); } }
  public static void main(String[] a){
    // LEITURA que o clone PRECISA poder mandar (o pátio bloqueia, aqui é liberado)
    for(String c : new String[]{
        "ATZ","ATE0","ATL0","ATS0","ATH1","ATH0","ATCAF1","ATSP0","ATDP","ATDPN","ATRV","ATI",
        "ATSH7E0","ATSH7DF","ATSH7E7","ATCRA7E8","ATCRA7EF","ATFCSH7E0","ATFCSD300000","ATFCSM1","ATFCSM0","ATSP6",
        "0100","010C","03","07","0A","0902","0904","0906","0600",
        "22F190","22F18C","1902FF","1A90","23140000000001","1003","1001","3E00","3E80"})
      chk("permite leitura "+c, ObdPlugin.permitido(c));
    chk("espaço/minúscula não mudam", ObdPlugin.permitido("22 f1 90") && ObdPlugin.permitido("at sh 7e0") && ObdPlugin.permitido("at fcsd 30 00 00"));

    // ESCRITA/AÇÃO no carro: RECUSADA de todo jeito (a trava do clone)
    for(String c : new String[]{
        "04","0401"," 04","2E F190 00","2EF19000","3401","3501","3601","3701","2F1234030100",
        "31010203","27 01","2701","11 01","1101","14FFFFFF","1082","10 02","3D F190 00","2804","8503",
        "ATMA","ATWS"})
      chk("RECUSA ação no carro "+c, !ObdPlugin.permitido(c));

    // atuador: RECUSADO até incompleto (GMW3110: CPID sem bytes de controle executa; AE00 é comando)
    for(String c : new String[]{"AE","AE00","AE12","AE1200000000","2FF190","2FF19003","2FF1900301",
        "3B9000","A5","A501","A503","2801","1002","3DF19000"})
      chk("RECUSA "+c, !ObdPlugin.permitido(c));
    // AT: só no formato exato (revisão independente do PR #170)
    for(String c : new String[]{"ATCAF0","ATAL","ATCSM0","ATCSM1","ATBI","ATST64","ATCM7E8","ATCF7E8",
        "ATSH123","ATSH7E8","ATSH7DF0","ATSH18DB33F1","ATCRA123","ATCRA7E0",
        "ATFCSH123","ATFCSH7E8","ATFCSM2","ATFCSD","ATFCSD3000","ATFCSD30000000","ATFCSD310000","ATFCSD020000"})
      chk("RECUSA AT fora do formato "+c, !ObdPlugin.permitido(c));
    // 10 só sessão de leitura; 3E só padrão
    chk("RECUSA sessão de programação 1002", !ObdPlugin.permitido("1002"));
    chk("permite sessão estendida 1003", ObdPlugin.permitido("1003"));
    chk("RECUSA 3E fora do padrão", !ObdPlugin.permitido("3E01"));
    chk("permite ler memoria 23", ObdPlugin.permitido("23140000000001"));
    chk("permite ATAR (enumerar)", ObdPlugin.permitido("ATAR"));
    chk("permite ATCRA reset", ObdPlugin.permitido("ATCRA"));
    chk("RECUSA ATMA (monitorar tudo)", !ObdPlugin.permitido("ATMA"));
    chk("RECUSA escrever memoria 3D", !ObdPlugin.permitido("3DF19000"));

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
