// Confere a lógica do app DTCar Clone usando o PRÓPRIO script de clone/www/index.html
// (sem cópia que possa divergir): decodificação com respostas reais de um Cobalt 2013, os casos
// apontados na revisão do Codex (PR #169) e o clone inteiro rodando contra um ELM327 simulado.
// Rodar: node teste/teste_clone.mjs
import { readFileSync } from "node:fs";
let ok=0, falhas=0;
const chk=(n,c)=>{ if(c) ok++; else { falhas++; console.log("  FALHOU: "+n); } };

const html=readFileSync(new URL("../clone/www/index.html", import.meta.url),"utf8");
const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const el=()=>({ textContent:"", value:"", innerHTML:"", disabled:false, onclick:null, style:{}, classList:{add(){},remove(){}}, appendChild(){} });
const doc={ getElementById:el, addEventListener(){}, createElement:el };
const carrega=win=>new Function("window","document","navigator",
  js+"\nreturn { mensagens, isotp, analisa, hex2txt, bitmap, faixas, cabecalhos, NRC, FAIXAS_RAPIDAS, TODAS, BYTE, clonar, arquivo:()=>arquivoTexto };")(win, doc, {});
const L=carrega({});
chk("o script da tela carrega sem erro", !!L.mensagens);

/* ---- respostas reais do Cobalt ---- */
const VIN="7E81014490201394247 | 7E8214A433639583044 | 7E82242333330343139";
chk("VIN do Cobalt completo", (m=>m.completo && L.hex2txt(m.dados.slice(6))==="9BGJC69X0DB330419")(L.mensagens(VIN,"7E8")[0]));
const CAL="7E81083490408313236 | 7E82134393232390000 | 7E82200000000000032 | 7E82334353831313633 | 7E82400000000000000";
chk("CALID do Cobalt detectado como CORTADO (131 bytes declarados, 34 recebidos)", (m=>!m.completo && m.esperado===131 && m.dados.length===68)(L.mensagens(CAL,"7E8")[0]));
const NOME="7E81017490A0145434D | 7E821002D456E67696E | 7E82265436F6E74726F | 7E8236C0000AAAAAAAA";
chk("nome do módulo completo, sem o enchimento AA", (m=>m.completo && L.hex2txt(m.dados).includes("EngineControl") && !/AAAA$/.test(m.dados))(L.mensagens(NOME,"7E8")[0]));

/* ---- casos da revisão do Codex ---- */
chk("enchimento não entra nos dados", L.analisa("7E8 05 62 F1 90 41 42 AA AA","7E8","22").dados==="F1904142");
chk("multiquadro truncado é marcado incompleto", L.analisa("7E8 10 0A 62 F1 90 41 42 43","7E8","22").incompleto===true);
chk("quadro fora de sequência quebra a mensagem", L.mensagens("7E8 10 0A 62 F1 90 41 42 43 | 7E8 22 44 45 46 47","7E8")[0].completo===false);
chk("aguarde (78) seguido da positiva = positiva", (a=>a.tipo==="pos"&&a.dados==="F1904142"&&a.pendente)(L.analisa("7E8 03 7F 22 78 | 7E8 05 62 F1 90 41 42","7E8","22")));
chk("positiva de OUTRO identificador = fora de ordem", L.analisa("7E8 05 62 F1 8C 41 42","7E8","22","F190").tipo==="fora-de-ordem");
chk("positiva com o eco certo = positiva", L.analisa("7E8 05 62 F1 90 41 42","7E8","22","F190").tipo==="pos");
chk("só aguarde = pendente", L.analisa("7E8 03 7F 22 78","7E8","22").tipo==="pendente");
chk("recusa guarda o código cru, sem 'existe'", (a=>a.tipo==="neg"&&a.nrc==="31"&&!("existe" in a))(L.analisa("7E8 03 7F 22 31","7E8","22")));
chk("31 explicado com a ressalva do GMLAN", /GMLAN/.test(L.NRC["31"]));
chk("resposta de OUTRO módulo é ignorada", L.analisa("7E9 05 62 F1 90 41 42","7E8","22").tipo==="nada");
chk("'50' sozinho (GMLAN) = sessão aceita sem eco", (a=>a.tipo==="pos"&&a.dados==="")(L.analisa("7E8 01 50","7E8","10")));
chk("silêncio vira faixas compactas", JSON.stringify(L.faixas(["0000","0001","0002","0005","0007","0008"]))==='["0000-0002","0005","0007-0008"]');
chk("cabeçalhos por início de quadro", (s=>s.has("7E8")&&s.has("7EA")&&s.size===2)(L.cabecalhos("7E8 06 41 00 | 7EA 06 41 00")));
chk("bitmap real do Cobalt (PID 0C)", L.bitmap("7E8064100BE3FB813AA","41","00").pids.includes("0C"));
chk("varredura completa = 65536", L.TODAS.length===65536);
chk("varredura rápida inclui FA22 e F190", L.FAIXAS_RAPIDAS.includes("FA22") && L.FAIXAS_RAPIDAS.includes("F190"));

/* ---- clone inteiro contra um ELM327 simulado (ECM GMLAN em 7E0/7E8) ---- */
function elm({ ignoraSH=false, ignoraCRA=false }={}){
  const st={ sh:"7DF", cra:null }, enviados=[];
  const ecm=c=>{
    if(c==="0100") return "7E8 06 41 00 BE 3F B8 13 AA";
    if(c==="1001"||c==="1003") return "7E8 01 50 AA AA AA AA AA AA";
    if(c==="1A90") return "7E8 05 5A 90 41 42 43 AA AA";
    if(c==="0902") return "7E8 10 14 49 02 01 39 42 47 | 7E8 21 4A 43 36 39 58 30 44 | 7E8 22 42 33 33 30 34 31 39";
    if(c==="03") return "7E8 02 43 00 AA AA AA AA AA";
    if(c.startsWith("23")) return "7E8 03 7F 23 11 AA AA AA AA";
    return "";
  };
  return { enviados, Plug:{
    permissao:async()=>({concedida:true}), listar:async()=>({aparelhos:[]}),
    comando:async({cmd})=>({ resposta: responde(cmd), completo:true }) } };
  function responde(cmd){ enviados.push(cmd);
      if(cmd==="ATAR"||cmd==="ATCRA"){ st.cra=null; return "OK"; }
      if(cmd.startsWith("ATSH")){ st.sh=cmd.slice(4); return "OK"; }
      if(cmd.startsWith("ATCRA")){ st.cra=cmd.slice(5); return "OK"; }
      if(cmd==="ATI") return "ELM327 v2.1"; if(cmd==="ATRV") return "12.6V";
      if(cmd==="ATDP") return "AUTO, ISO 15765-4 (CAN 11/500)"; if(cmd==="ATDPN") return "A6";
      if(cmd.startsWith("AT")) return "OK";
      const destino = ignoraSH ? "7DF" : st.sh;
      if(destino!=="7DF" && destino!=="7E0") return "NO DATA";
      let r=ecm(cmd); if(!r) return "NO DATA";
      if(st.cra && !ignoraCRA && st.cra!=="7E8") return "NO DATA";
      return r;
  }
}
async function roda(op){ const e=elm(op); const C=carrega({Capacitor:{Plugins:{DtcarObd:e.Plug}}}); await C.clonar(false); return { arq:JSON.parse(C.arquivo()), enviados:e.enviados }; }

const bom=await roda({});
chk("adaptador bom: obedece ATSH", bom.arq.adaptador.endereco==="obedece ATSH");
chk("adaptador bom: obedece ATCRA", bom.arq.adaptador.filtro==="obedece ATCRA");
chk("só o ECM é módulo (fim do falso '8 módulos')", JSON.stringify(bom.arq.enumeracao.respondem)==='["7E8"]');
chk("ECM classificado como GMLAN provável", /GMLAN/.test(bom.arq.modulos[0].protocolo));
chk("VIN lido inteiro", bom.arq.resumo.vin==="9BGJC69X0DB330419");
chk("1A90 entra como leitura positiva", bom.arq.modulos[0].leitura1A.respostas["90"].tipo==="pos");
chk("silêncio do 22 vira faixas e a varredura fecha", bom.arq.modulos[0].leitura22.concluido && bom.arq.modulos[0].leitura22.silenciosos.length>0);
chk("memória: recusa guardada (11)", bom.arq.modulos[0].memoria.nrc==="11");
chk("arquivo marcado como concluído", bom.arq.concluido===true);
chk("NENHUM comando de atuador saiu (AE/2F/31)", !bom.enviados.some(c=>/^(AE|2F|31)/.test(c)));

const semSH=await roda({ ignoraSH:true });
chk("adaptador que ignora ATSH é detectado (caso do Codex)", semSH.arq.adaptador.endereco==="ignora ATSH");
chk("…e mesmo assim só o 7E8 vira módulo", JSON.stringify(semSH.arq.enumeracao.respondem)==='["7E8"]');
const semCRA=await roda({ ignoraCRA:true });
chk("adaptador que ignora ATCRA é detectado", semCRA.arq.adaptador.filtro==="ignora ATCRA");

console.log(falhas===0 ? ok+" conferências do clone (JS) passaram." : ok+" ok, "+falhas+" FALHARAM");
if(falhas>0) process.exit(1);
