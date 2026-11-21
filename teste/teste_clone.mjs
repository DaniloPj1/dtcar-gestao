// Confere as funções de leitura do app DTCar Clone que decidem o resumo:
// bitmap() (quais PIDs o carro suporta) e hexResp() (endereço de resposta de um módulo).
// Rodar: node teste/teste_clone.mjs
let ok=0, falhas=0;
const chk=(n,c)=>{ if(c) ok++; else { falhas++; console.log("  FALHOU: "+n); } };

// cópias idênticas às de clone/www/index.html
function bitmap(resp, servResp, base){
  const hx=(resp||"").replace(/[^0-9A-Fa-f]/g,"").toUpperCase();
  const i=hx.indexOf(servResp+base);
  const pids=[]; let mais=false;
  if(i>=0){ const dados=hx.substr(i+4,8);
    if(dados.length===8){ const n=parseInt(dados,16); const ini=parseInt(base,16);
      for(let b=0;b<32;b++){ if(n&(1<<(31-b))){ const p=ini+1+b; if((p&0x1F)===0) mais=true; else pids.push(p.toString(16).toUpperCase().padStart(2,"0")); } }
      mais=(n&1)===1; } }
  return { pids, mais };
}
const hexResp = base => (parseInt(base,16)+8).toString(16).toUpperCase();

// 1) bitmap clássico "41 00 BE 3F B8 13" com cabeçalho do módulo
const b1 = bitmap("7E8 06 41 00 BE 3F B8 13","41","00");
chk("acha PIDs suportados", b1.pids.length>0);
chk("PID 0C (rotação) está entre os suportados", b1.pids.includes("0C"));
chk("bit final liga 'mais PIDs'", b1.mais===true);
chk("não inclui o PID 20 (é o bit de continuação)", !b1.pids.includes("20"));

// 2) sem a resposta esperada → lista vazia, sem quebrar
const b2 = bitmap("NO DATA","41","00");
chk("sem dado devolve vazio", b2.pids.length===0 && b2.mais===false);

// 3) segundo bloco (base 20)
const b3 = bitmap("7E8 06 41 20 80 00 00 01","41","20");
chk("bloco 20: PID 21 suportado", b3.pids.includes("21"));
chk("bloco 20: 'mais' ligado pelo bit final", b3.mais===true);

// 4) endereço de resposta do módulo
chk("7E0 responde em 7E8", hexResp("7E0")==="7E8");
chk("7E1 responde em 7E9", hexResp("7E1")==="7E9");
chk("7E7 responde em 7EF", hexResp("7E7")==="7EF");

console.log(falhas===0 ? ok+" conferências do clone (JS) passaram." : ok+" ok, "+falhas+" FALHARAM");
if(falhas>0) process.exit(1);
