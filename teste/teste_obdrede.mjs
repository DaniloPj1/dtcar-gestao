// Confere o cruzamento do mapa da rede CAN (js/obdrede.js): varredura + códigos U = veredito.
// Rodar: node teste/teste_obdrede.mjs
import * as rede from "../js/obdrede.js";
let ok = 0, falhas = 0;
const chk = (n, c) => { if (c) ok++; else { falhas++; console.log("  FALHOU: " + n); } };
const grau = l => rede.cruzar(l).vereditos[0].chave;

chk("U0151 é código de rede", rede.eCodigoDeRede("U0151"));
chk("P0401 não é código de rede", !rede.eCodigoDeRede("P0401"));
chk("texto solto não é código", !rede.eCodigoDeRede("airbag"));

// 1) calado no mapa + código U atual = CONFIRMADO
const confirmado = [
  { pedido: "7E0", nome: "Motor", doMapa: true, respondeu: true, recusou: false, falhas: [{ codigo: "U0151", situacaoTexto: "atual" }] },
  { pedido: "715", nome: "Airbag lateral", doMapa: true, respondeu: false, recusou: false, falhas: [] },
];
chk("calado + U atual = confirmado", grau(confirmado) === "confirmado");
chk("o confirmado aponta o módulo calado pelo nome", /Airbag lateral/.test(rede.cruzar(confirmado).vereditos[0].texto));

// 2) código U mas ninguém calado = CONTRADIÇÃO
const contra = [
  { pedido: "7E0", nome: "Motor", doMapa: true, respondeu: true, recusou: false, falhas: [{ codigo: "U0140", situacaoTexto: "atual" }] },
  { pedido: "715", nome: "Airbag", doMapa: true, respondeu: true, recusou: false, falhas: [] },
];
chk("U sem ninguém calado = contradição", grau(contra) === "contradicao");

// 3) calado sem código U = SÓ INDÍCIO (não é defeito)
const indicio = [
  { pedido: "7E0", nome: "Motor", doMapa: true, respondeu: true, recusou: false, falhas: [] },
  { pedido: "717", nome: "Ar-condicionado", doMapa: true, respondeu: false, recusou: false, falhas: [] },
];
chk("calado sem U = só indício", grau(indicio) === "indicio");
chk("o indício diz que não é defeito", /Não é defeito/.test(rede.cruzar(indicio).vereditos[0].texto));

// 4) endereço da norma que não respondeu NÃO vira indício (não estava no mapa do modelo)
const soNorma = [
  { pedido: "7E0", nome: "Motor", doMapa: true, respondeu: true, recusou: false, falhas: [] },
  { pedido: "7E4", nome: "", doMapa: false, respondeu: false, recusou: false, falhas: [] },
];
chk("endereço só da norma calado = rede em ordem", grau(soNorma) === "limpo");

// 5) histórico não sustenta veredito
const hist = [
  { pedido: "7E0", nome: "Motor", doMapa: true, respondeu: true, recusou: false, falhas: [{ codigo: "U0140", situacaoTexto: "histórica" }] },
  { pedido: "715", nome: "Airbag", doMapa: true, respondeu: false, recusou: false, falhas: [] },
];
chk("U histórico com calado não confirma", grau(hist) === "indicio");
chk("mas o histórico aparece como observação", rede.cruzar(hist).vereditos.some(v => v.chave === "historico"));

// 6) quem recusou entregar as falhas existe: não conta como mudo
const recusou = [
  { pedido: "7E0", nome: "Motor", doMapa: true, respondeu: true, recusou: false, falhas: [] },
  { pedido: "744", nome: "Imobilizador", doMapa: true, respondeu: true, recusou: true, erro: "recusa 33 — pede senha", falhas: [] },
];
const r6 = rede.cruzar(recusou);
chk("recusou não é mudo", r6.mudos.length === 0 && r6.recusaram.length === 1);
chk("recusou vira observação própria", r6.vereditos.some(v => v.chave === "recusou"));
chk("com todos vivos o veredito é rede em ordem", r6.vereditos[0].chave === "limpo");

// 7) dois calados: o texto lista os dois
const dois = [
  { pedido: "7E0", nome: "Motor", doMapa: true, respondeu: true, recusou: false, falhas: [{ codigo: "U0151", situacaoTexto: "atual" }] },
  { pedido: "715", nome: "Airbag", doMapa: true, respondeu: false, recusou: false, falhas: [] },
  { pedido: "717", nome: "Ar-condicionado", doMapa: true, respondeu: false, recusou: false, falhas: [] },
];
chk("dois calados aparecem os dois", /Airbag/.test(rede.cruzar(dois).vereditos[0].texto) && /Ar-condicionado/.test(rede.cruzar(dois).vereditos[0].texto));

// 8) os códigos de rede saem com o módulo que gravou
const cods = rede.codigosDeRede(confirmado);
chk("o código sai com o módulo que gravou", cods.length === 1 && cods[0].modulo === "Motor" && cods[0].atual === true);
chk("falha que não é de rede fica fora", rede.codigosDeRede([{ pedido: "7E0", nome: "Motor", falhas: [{ codigo: "P0401" }] }]).length === 0);

// 9) varredura vazia não quebra
chk("lista vazia devolve veredito", rede.cruzar([]).vereditos.length === 1);
chk("lista nula não quebra", rede.cruzar(null).vereditos[0].chave === "limpo");

if (falhas) { console.log(falhas + " falharam."); process.exit(1); }
console.log(ok + " conferências do mapa da rede passaram.");
