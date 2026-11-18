// Teste do cálculo de IBS/CBS no Simples Nacional (js/rtc.js).
//
// Roda duas coisas:
// 1. Os casos OFICIAIS da Receita Federal, extraídos dos testes do repositório
//    calculadora-rtc-simples-nacional (teste/casos_rtc.json). São a verdade:
//    se um deles falhar, o porte está errado. Rodamos aqui o bloco "api", que é
//    o teste de ponta a ponta (entrada -> resposta). O arquivo traz também os
//    blocos "motor" e "validacao", que no Java usam objetos e catálogos
//    simulados; ficam guardados para quando houver necessidade.
// 2. Casos da oficina, montados aqui, para as situações que a DTCar vai viver
//    (peça em NF-e, serviço em NFS-e, compra de órgão público, data sem vigência).
//
// Uso: node teste/teste_rtc.mjs
// Não toca no banco nem na internet.

import { readFileSync, existsSync } from "node:fs";
import { calcularSimples, calcularItem, dec, moeda, aliquota, atividadesVigentes, documentosVigentes, vigenteDesde, VSN } from "../js/rtc.js";

let ok = 0;
let falhas = 0;
let conhecidas = 0;

// Divergência conhecida, conferida em 18/11/2026: os dois repositórios da Receita
// não estão na mesma versão. Os testes do repositório do Simples Nacional (versão
// 0.0.6) foram escritos contra um catálogo anterior à migração V0059 (30/09/2026,
// "Habilitação de 820 para NFSe"), que ligou o tratamento do cClassTrib 820001
// (UPDATE TRATAMENTO_TRIBUTARIO SET TRTR_IN_POSSUI_AJUSTE = 0 WHERE TRTR_ID = 32).
// Com a tabela de hoje o item é CALCULADO; com o dado de antes da V0059 o nosso
// cálculo devolve NAO_IMPLEMENTADO e VSN-027, igual ao teste. Não é erro do porte:
// é o dado que mudou. Quando a Receita atualizar os testes, esta linha sai daqui.
// A V0059 vale para os quatro códigos da família 820 que o teste Java usa
// (820001, 820005, 820008 e 820009), todos ligados ao tratamento 32. Com a tabela
// de hoje eles caem em tpRBSN 9 ("Fornecimento incompatível com SN"), fator zero,
// imposto zero — e nenhum deles é usado pela oficina.
// A máscara vale só para estas três verificações: se o caso quebrar por outro
// motivo, aparece como falha.
const DIVERGENCIAS_CONHECIDAS = {
  naoImplementadoTambemEmNfse: {
    motivo: "o cClassTrib 820001 foi habilitado pela migração V0059, posterior a este teste",
    verificacoes: ["objetos[0].estadoItem", "objetos[0].erros[0].code", "total"],
  },
};

/** Devolve o motivo quando esta verificação específica é uma divergência conhecida. */
function divergenciaConhecida(nome, expr) {
  const d = DIVERGENCIAS_CONHECIDAS[String(nome).split(" ")[0].split("#")[0]];
  if (!d) return null;
  return d.verificacoes.some((v) => expr === v || expr.startsWith(`${v} `)) ? d.motivo : null;
}

function conferir(titulo, obtido, esperado, conhecida) {
  const mostrar = (v) => (typeof v === "bigint" ? `${v} (valor interno)` : JSON.stringify(v));
  const a = mostrar(obtido);
  const b = mostrar(esperado);
  if (a === b) {
    ok++;
  } else if (conhecida) {
    conhecidas++;
    console.log(`DIVERGÊNCIA CONHECIDA  ${titulo}: ${conhecida}`);
  } else {
    falhas++;
    console.log(`FALHOU  ${titulo}\n        esperado: ${b}\n        obtido:  ${a}`);
  }
}

/** Lê um caminho tipo "objetos[0].tribCalc.vIBSSN" ou "total.vCBSSNtot" no resultado. */
function caminho(obj, expr) {
  return expr.split(".").reduce((o, parte) => {
    if (o === null || o === undefined) return undefined;
    if (parte === "length()") return Array.isArray(o) ? o.length : undefined;
    const m = /^([^[]+)\[(\d+)\]$/.exec(parte);
    return m ? (o[m[1]] || [])[Number(m[2])] : o[parte];
  }, obj);
}

// ─── 1. Casos oficiais da Receita ──────────────────────────────────────────────

const ARQUIVO = new URL("./casos_rtc.json", import.meta.url);
if (existsSync(ARQUIVO)) {
  const casos = JSON.parse(readFileSync(ARQUIVO, "utf8"));
  let rodados = 0;

  // Uma requisição oficial: a resposta de erro da Receita vem em "errors",
  // a nossa em "erros" — é o mesmo conteúdo, com outro nome.
  function rodar(nome, entrada, esperado, ausentes, terminaCom) {
    const bruto = calcularSimples(entrada);
    const r = bruto.erros ? { errors: bruto.erros } : bruto;
    rodados++;
    for (const [expr, valor] of Object.entries(esperado || {})) {
      conferir(`[oficial] ${nome} -> ${expr}`, caminho(r, expr), valor, divergenciaConhecida(nome, expr));
    }
    for (const expr of ausentes || []) {
      conferir(`[oficial] ${nome} -> ${expr} não existe`, caminho(r, expr), undefined, divergenciaConhecida(nome, expr));
    }
    for (const [expr, fim] of Object.entries(terminaCom || {})) {
      const v = caminho(r, expr);
      conferir(`[oficial] ${nome} -> ${expr} termina com`, typeof v === "string" && v.endsWith(fim), true, divergenciaConhecida(nome, expr));
    }
  }

  for (const caso of casos.api || []) {
    if (caso.metodo === "GET") {
      // Catálogo de códigos de erro: aqui vira a tabela VSN.
      const cod = caso.query && caso.query.codigo;
      if (cod && caso.esperado && caso.esperado.titulo) {
        conferir(`[oficial] catálogo ${cod}`, VSN[cod], caso.esperado.titulo);
      }
      continue;
    }
    if (caso.requisicoes) {
      caso.requisicoes.forEach((req, i) => rodar(`${caso.nome}#${i + 1}`, req.entrada, req.esperado, req.esperado_ausente, req.esperado_termina_com));
      continue;
    }
    if (caso.entrada) rodar(caso.nome, caso.entrada, caso.esperado, caso.esperado_ausente, caso.esperado_termina_com);
    (caso.variacoes || []).forEach((entrada, i) =>
      rodar(`${caso.nome} (variação ${i + 1})`, entrada, caso.esperado, caso.esperado_ausente, caso.esperado_termina_com));
  }
  console.log(`Requisições oficiais conferidas: ${rodados}`);

  // Bloco "motor": os casos que testam as fórmulas direto, com os valores
  // internos de 8 casas, ANTES de qualquer formatação (11.875, e não 11.88).
  // É o teste que protege a parte que calcula dinheiro.
  const fx = casos.fixtures || {};
  const comoRegime = (chave) => {
    const f = fx.regimes[chave];
    return { crt: f.crt, tpRegime: f.tpRegimeIBSCBS, descricao: f.descricao, geraIbs: f.geraIbs,
      destinoDevido: f.destinoDevido, destinoPendenteSuspenso: f.destinoPendenteSuspenso };
  };
  const comoTipo = (tpRBSN, ajustes) => {
    // o ajuste vem com os nomes do Java, então entra ANTES de traduzir os campos
    const f = { ...fx.tiposReceitaBruta[String(tpRBSN)], ...(ajustes || {}) };
    return { cd: f.codigo, descricao: f.descricao, compoeReceita: f.compoeReceita,
      isCompoeReceita: f.impostoSeletivoCompoeReceita, fatorReceita: f.fatorReceita,
      pendenteSuspenso: f.pendenteSuspenso, exigeAliquota: f.exigeAliquota,
      vedadoNaoTributavel: f.vedadoNaoTributavel };
  };

  let motorRodados = 0;
  for (const caso of casos.motor || []) {
    for (const ins of caso.insumo ? [caso.insumo] : (caso.insumo_variacoes || [])) {
      const r = calcularItem({
        regime: comoRegime(ins.regime),
        tipoReceita: comoTipo(ins.tpRBSN, ins.tipoReceitaOverride),
        cAtivSNValido: ins.cAtivSNValido,
        baseCalculo: dec(ins.baseCalculo),
        valorIs: ins.valorImpostoSeletivo === null ? null : dec(ins.valorImpostoSeletivo),
        pIbs: ins.pIBSSN === null ? null : dec(ins.pIBSSN),
        pCbs: ins.pCBSSN === null ? null : dec(ins.pCBSSN),
        tpEnteGov: ins.tpEnteGov,
        fatorTransicao: ins.fatorTransicaoCompraGov === null ? null : dec(ins.fatorTransicaoCompraGov),
      });
      motorRodados++;
      const achar = (campo) => (campo === "estadoItem" ? r.estadoItem
        : campo === "IS.valor" ? (r.tribCalc.IS || {}).valor : r.tribCalc[campo]);
      for (const [campo, esperado] of Object.entries(caso.esperado || {})) {
        const obtido = achar(campo);
        // número compara por valor (o Java guarda 8 casas, o texto pode vir "0.00")
        const iguais = typeof esperado === "string" && typeof obtido === "bigint"
          ? obtido === dec(esperado)
          : obtido === esperado;
        conferir(`[motor] ${caso.nome} -> ${campo}`, iguais ? esperado : obtido, esperado);
      }
      for (const campo of caso.esperado_nulo || []) {
        const v = achar(campo);
        conferir(`[motor] ${caso.nome} -> ${campo} é nulo`, v === null || v === undefined, true);
      }
    }
  }
  console.log(`Casos do motor conferidos: ${motorRodados}`);
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

console.log(`\n${ok} verificações OK, ${falhas} falhas` + (conhecidas ? `, ${conhecidas} divergências conhecidas (ver DIVERGENCIAS_CONHECIDAS)` : ""));
process.exit(falhas ? 1 : 0);
