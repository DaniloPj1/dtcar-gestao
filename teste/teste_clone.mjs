// Confere a lógica do app DTCar Clone usando o PRÓPRIO script de clone/www/index.html
// (assim não há cópia que possa divergir), com respostas reais gravadas num Cobalt 2013.
// Rodar: node teste/teste_clone.mjs
import { readFileSync } from "node:fs";
let ok=0, falhas=0;
const chk=(n,c)=>{ if(c) ok++; else { falhas++; console.log("  FALHOU: "+n); } };

const html=readFileSync(new URL("../clone/www/index.html", import.meta.url),"utf8");
const js=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
const el=()=>({ textContent:"", value:"", innerHTML:"", disabled:false, onclick:null, style:{}, classList:{add(){},remove(){}}, appendChild(){} });
const doc={ getElementById:el, addEventListener(){}, createElement:el };
const f=new Function("window","document","navigator", js+"\nreturn { isotp, analisa, hex2txt, bitmap, hx, NRC, FAIXAS_RAPIDAS, TODAS, BYTE };");
const L=f({}, doc, {});
chk("o script da tela carrega sem erro", !!L.isotp);

// quadros reais do Cobalt (modo 09)
const VIN="7E81014490201394247 | 7E8214A433639583044 | 7E82242333330343139";
chk("VIN do Cobalt", L.hex2txt(L.isotp(VIN,"7E8").replace(/^4902../,""))==="9BGJC69X0DB330419");
const NOME="7E81017490A0145434D | 7E821002D456E67696E | 7E82265436F6E74726F | 7E8236C0000AAAAAAAA";
chk("nome do módulo", L.hex2txt(L.isotp(NOME,"7E8").replace(/^490A../,"")).includes("EngineControl"));
const CAL="7E81083490408313236 | 7E82134393232390000 | 7E82200000000000032 | 7E82334353831313633 | 7E82400000000000000";
chk("CALID tem as duas calibrações", /12649229/.test(L.hex2txt(L.isotp(CAL,"7E8"))) && /24581163/.test(L.hex2txt(L.isotp(CAL,"7E8"))));

// classificação de resposta (o que vira mapa do simulador)
chk("positiva do 22", L.analisa("7E8 05 62 F1 90 41 42","7E8","22").tipo==="pos");
chk("negativa 31 = não existe", (r=>r.tipo==="neg"&&r.nrc==="31")(L.analisa("7E8 03 7F 22 31","7E8","22")));
chk("sonda AE incompleta: 13 = saída EXISTE", (r=>r.tipo==="neg"&&r.nrc==="13")(L.analisa("7E8 03 7F AE 13","7E8","AE")));
chk("aguarde (78) seguido de positiva = positiva", L.analisa("7E8 03 7F 22 78 | 7E8 05 62 F1 90 41 42","7E8","22").tipo==="pos");
chk("NO DATA = nada", L.analisa("NO DATA","7E8","22").tipo==="nada");
chk("resposta de OUTRO módulo é ignorada", L.analisa("7E9 05 62 F1 90 41 42","7E8","22").tipo==="nada");
chk("o '50' sozinho do GMLAN conta como sessão aceita", L.analisa("7E8 01 50","7E8","10").tipo==="pos");
chk("código 13 explicado", /EXISTE/.test(L.NRC["13"]));

// PIDs suportados (bitmap real do Cobalt)
const b=L.bitmap("7E8064100BE3FB813AA","41","00");
chk("PID 0C suportado no Cobalt", b.pids.includes("0C"));
chk("bit de continuação ligado", b.mais===true);

// tamanho das varreduras
chk("varredura completa = 65536 identificadores", L.TODAS.length===65536);
chk("varredura rápida = faixas conhecidas", L.FAIXAS_RAPIDAS.length===1664 && L.FAIXAS_RAPIDAS.includes("FA22") && L.FAIXAS_RAPIDAS.includes("F190"));
chk("sonda de saídas = 256 CPIDs", L.BYTE.length===256 && L.BYTE[0]==="00" && L.BYTE[255]==="FF");

console.log(falhas===0 ? ok+" conferências do clone (JS) passaram." : ok+" ok, "+falhas+" FALHARAM");
if(falhas>0) process.exit(1);
