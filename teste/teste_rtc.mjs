// Teste do cálculo de IBS/CBS no Simples Nacional (js/rtc.js).
//
// Roda duas coisas:
// 1. Os casos OFICIAIS da Receita Federal, extraídos dos testes do repositório
//    calculadora-rtc-simples-nacional (teste/casos_rtc.json). São a verdade:
//    se um deles falhar, o porte está errado.
// 2. Casos da oficina, montados aqui, para as situações que a DTCar vai viver
//    (peça em NF-e, serviço em NFS-e, compra de órgão público, data sem vigência).
//
// Uso: node teste/teste_rtc.mjs
// Não toca no banco nem na internet.

import { readFileSync, existsSync } from "node:fs";
import { calcularSimples, dec, moeda, aliquota, atividadesVigentes, documentosVigentes, vigenteDesde } from "../js/rtc.js";

let ok = 0;
let falhas = 0;

function conferir(titulo, obtido, esperado) {
  const a = JSON.stringify(obtido);
  const b = JSON.stringify(esperado);
  if (a === b) {
    ok++;
  } else {
    falhas++;
    console.log(`FALHOU  ${titulo}\n        esperado: ${b}\n        obtido:  ${a}`);
  }
}

/** Lê um caminho tipo "objetos[0].tribCalc.vIBSSN" ou "total.vCBSSNtot" no resultado. */
function caminho(obj, expr) {
  return expr.split(".").reduce((o, parte) => {
    if (o === null || o === undefined) return undefined;
    const m = /^([^[]+)\[(\d+)\]$/.exec(parte);
    return m ? (o[m[1]] || [])[Number(m[2])] : o[parte];
  }, obj);
}

// ─── 1. Casos oficiais da Receita ──────────────────────────────────────────────

const ARQUIVO = new URL("./casos_rtc.json", import.meta.url);
if (existsSync(ARQUIVO)) {
  const casos = JSON.parse(readFileSync(ARQUIVO, "utf8"));
  for (const caso of casos.api || []) {
    const r = calcularSimples(caso.entrada);
    for (const [expr, esperado] of Object.entries(caso.esperado || {})) {
      conferir(`[oficial] ${caso.nome} -> ${expr}`, caminho(r, expr), esperado);
    }
  }
  console.log(`Casos oficiais conferidos: ${(casos.api || []).length}`);
} else {
  console.log("AVISO: teste/casos_rtc.json não encontrado — só os casos da oficina rodaram.");
}

// ─── 2. Números exatos (o ponto mais fácil de errar) ───────────────────────────
// A Receita arredonda meio-para-par (HALF_EVEN). O número comum do JavaScript erra
// justamente nos empates, por isso o cálculo usa inteiros.

conferir("arredondamento 11,875 vira 11,88", moeda(dec("11.875")), "11.88");
conferir("arredondamento 26,125 vira 26,12", moeda(dec("26.125")), "26.12");
conferir("arredondamento 0,005 vira 0,00", moeda(dec("0.005")), "0.00");
conferir("arredondamento 0,015 vira 0,02", moeda(dec("0.015")), "0.02");
conferir("alíquota sem zero à direita", aliquota(dec("2.4750")), "2.475");
conferir("alíquota com 2 casas no mínimo", aliquota(dec("3")), "3.00");

// ─── 3. Casos da oficina ───────────────────────────────────────────────────────

const OP = { id: "dtcar-teste", versao: "2.0.0", data: "2027-03-15", CRT: "1" };
const PECA = { numero: 1, cAtivSN: "01", cClassTrib: "000001", baseCalculo: "1000.00", valorImpostoSeletivo: "0", pIBSSN: "1.25", pCBSSN: "2.75" };
const SERVICO = { ...PECA, cAtivSN: "07" };

// Peça vendida em NF-e: atividade 01 (Anexo I)
let r = calcularSimples({ ...OP, tpDoc: "55", itens: [PECA] });
conferir("peça em NF-e calcula", r.objetos[0].estadoItem, "CALCULADO");
conferir("peça em NF-e: IBS", r.objetos[0].tribCalc.vIBSSN, "12.50");
conferir("peça em NF-e: CBS", r.objetos[0].tribCalc.vCBSSN, "27.50");

// Mão de obra em NFS-e: atividade 07 (Anexo III)
r = calcularSimples({ ...OP, tpDoc: "91", itens: [SERVICO] });
conferir("serviço em NFS-e calcula", r.objetos[0].estadoItem, "CALCULADO");
conferir("serviço em NFS-e: total", r.objetos[0].tribCalc.totalItem, "40.00");

// Atividade de serviço não vale em NF-e: não calcula, e isso não é erro
r = calcularSimples({ ...OP, tpDoc: "55", itens: [SERVICO] });
conferir("serviço em NF-e não calcula", r.objetos[0].estadoItem, "NAO_CALCULADO");
conferir("serviço em NF-e não dá erro", r.objetos[0].erros, undefined);

// Venda para órgão público: a alíquota migra da CBS para o IBS
r = calcularSimples({ ...OP, tpDoc: "55", tpEnteGov: "1", itens: [PECA] });
conferir("compra da União: CBS recebe tudo", r.objetos[0].tribCalc.pCBSSN, "4.00");
conferir("compra da União: IBS zera", r.objetos[0].tribCalc.vIBSSN, "0.00");

r = calcularSimples({ ...OP, data: "2029-06-01", tpDoc: "55", tpEnteGov: "2", itens: [PECA] });
conferir("compra de Estado em 2029: pIBS", r.objetos[0].tribCalc.pIBSSN, "1.525");
conferir("compra de Estado em 2029: pCBS", r.objetos[0].tribCalc.pCBSSN, "2.475");

// Antes de 2027 não há cálculo
r = calcularSimples({ ...OP, data: "2026-11-18", tpDoc: "55", itens: [PECA] });
conferir("2026 não calcula", r.erros[0].code, "VSN-015");

// Erros de preenchimento
r = calcularSimples({ ...OP, tpDoc: "55", itens: [{ ...PECA, baseCalculo: "-5" }] });
conferir("base negativa é recusada", r.objetos[0].erros[0].code, "VSN-002");

r = calcularSimples({ ...OP, tpDoc: "55", itens: [{ ...PECA, pCBSSN: "", pIBSSN: "" }] });
conferir("alíquota faltando é recusada", r.objetos[0].erros.map((e) => e.code), ["VSN-004", "VSN-006"]);

r = calcularSimples({ ...OP, CRT: "4", tpDoc: "55", itens: [PECA] });
conferir("MEI fica fora do cálculo", r.erros[0].code, "VSN-019");

// Dois itens na mesma nota (peça + serviço não entram juntos; peça + peça entram)
r = calcularSimples({ ...OP, tpDoc: "55", itens: [PECA, { ...PECA, numero: 2, baseCalculo: "500.00" }] });
conferir("dois itens: total da CBS", r.total.vCBSSNtot, "41.25");
conferir("dois itens: receita bruta", r.total.vRBSNtot, "1500.00");

// Consultas de apoio
conferir("vigência começa em 2027", vigenteDesde(), "2027-01-01");
conferir("NF-e e NFS-e estão habilitadas",
  ["55", "91"].every((t) => documentosVigentes("2027-03-15").some((d) => String(d.tpDoc) === t)), true);
conferir("atividade 01 vale em NF-e", atividadesVigentes("2027-03-15", 55).some((a) => a.cd === "01"), true);
conferir("atividade 01 não vale em NFS-e", atividadesVigentes("2027-03-15", 91).some((a) => a.cd === "01"), false);

// ─── Resultado ─────────────────────────────────────────────────────────────────

console.log(`\n${ok} verificações OK, ${falhas} falhas`);
process.exit(falhas ? 1 : 0);
