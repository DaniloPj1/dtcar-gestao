// Cálculo do IBS e da CBS no Simples Nacional (Reforma Tributária do Consumo).
//
// Porte fiel da Calculadora de Tributos da Receita Federal (github.com/ReceitaFederal,
// repositório calculadora-rtc-simples-nacional, versão 0.0.6, licença MIT,
// Copyright 2026 Receita Federal do Brasil), conforme a NT 2026.005 v1.00,
// LC 123/2006, LC 214/2025 e LC 227/2026.
//
// Regras puras: NÃO usa window nem document (roda na tela, na função do Supabase e no
// programa do PC). As tabelas oficiais ficam em js/rtcdados.js, geradas por
// catalogo/rtc/gerar_rtc.py — nada disso vai para o banco.
//
// ATENÇÃO, duas coisas que a calculadora NÃO faz:
// 1. Tudo vale a partir de 01/01/2027. Antes disso não há cálculo.
// 2. A alíquota efetiva do Simples (pIBSSN e pCBSSN) é ENTRADA, não saída: quem apura
//    pela receita dos 12 meses é o PGDAS-D. Aqui ela é informada.

import { RTC } from "./rtcdados.js";

// ─── Números exatos ────────────────────────────────────────────────────────────
// A Receita calcula com BigDecimal de 8 casas e arredondamento HALF_EVEN (bancário).
// O número do JavaScript erra nos empates (11,875 tem de virar 11,88 e 26,125 vira
// 26,12), então tudo aqui é BigInt na escala 8. Nada de ponto flutuante.

const ESCALA = 8;
const UM = 10n ** BigInt(ESCALA);

/** Divide arredondando meio-para-par, como o HALF_EVEN do Java. */
function divPar(n, d) {
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  const a = neg ? -n : n;
  const q = a / d;
  const resto = a % d;
  const dobro = resto * 2n;
  let r = q;
  if (dobro > d || (dobro === d && (q % 2n) === 1n)) r = q + 1n;
  return neg ? -r : r;
}

/** Texto decimal -> BigInt na escala 8. Devolve null se não for número. */
export function dec(texto) {
  if (texto === null || texto === undefined) return null;
  const s = String(texto).trim();
  if (!s) return null;
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (!m || (!m[2] && !m[3])) return null;
  const sinal = m[1] === "-" ? -1n : 1n;
  const inteiro = m[2] || "0";
  const fracao = m[3] || "";
  const expo = m[4] ? parseInt(m[4], 10) : 0;
  // junta inteiro+fração como se fosse um inteiro, guardando quantas casas andou
  let valor = BigInt(inteiro + fracao);
  let casas = fracao.length - expo; // casas decimais depois do expoente
  if (casas <= ESCALA) {
    valor = valor * 10n ** BigInt(ESCALA - casas);
  } else {
    valor = divPar(valor, 10n ** BigInt(casas - ESCALA)); // mais casas que a escala: arredonda
  }
  return sinal * valor;
}

const ZERO = 0n;
const somar = (...vs) => vs.reduce((t, v) => t + (v ?? ZERO), ZERO);
const subtrair = (a, b) => a - b;
const multiplicar = (a, b) => (a === null || b === null ? null : divPar(a * b, UM));
const dividirPorCem = (a) => (a === null ? null : divPar(a, 100n));

/** Escala 8 -> texto com N casas, arredondando meio-para-par. */
function texto(valor, casas) {
  const v = divPar(valor, 10n ** BigInt(ESCALA - casas));
  const neg = v < 0n;
  const a = (neg ? -v : v).toString().padStart(casas + 1, "0");
  const corte = a.length - casas;
  const s = casas ? `${a.slice(0, corte)}.${a.slice(corte)}` : a;
  return (neg ? "-" : "") + s;
}

/** Dinheiro: sempre 2 casas. */
export const moeda = (v) => (v === null || v === undefined ? null : texto(v, 2));

/** Alíquota: até 4 casas, sem zeros à direita, nunca menos de 2. */
export function aliquota(v) {
  if (v === null || v === undefined) return null;
  let s = texto(v, 4);
  if (s.includes(".")) {
    s = s.replace(/0+$/, "");
    const casas = s.length - s.indexOf(".") - 1;
    if (casas < 2) s = texto(v, 2);
  }
  return s;
}

// ─── Vigência ──────────────────────────────────────────────────────────────────
// Mesma regra das consultas da Receita: data BETWEEN inicio AND COALESCE(fim, data),
// pegando a linha de início mais recente. Datas em texto AAAA-MM-DD comparam direto.

const valeNaData = (r, data) => r.de <= data && (r.ate === null || r.ate === undefined || data <= r.ate);

function vigente(lista, data) {
  const achadas = lista.filter((r) => valeNaData(r, data));
  if (!achadas.length) return null;
  return achadas.sort((a, b) => (a.de < b.de ? 1 : a.de > b.de ? -1 : 0))[0];
}

// ─── Códigos de erro (os mesmos VSN da Receita) ────────────────────────────────

export const VSN = {
  "VSN-001": "Base de cálculo do Simples ausente",
  "VSN-002": "Base de cálculo do Simples inválida (negativa/não numérica)",
  "VSN-003": "Valor do Imposto Seletivo inválido (negativo/não numérico)",
  "VSN-004": "Alíquota pCBSSN ausente",
  "VSN-005": "Alíquota pCBSSN inválida (negativa/não numérica)",
  "VSN-006": "Alíquota pIBSSN ausente",
  "VSN-007": "Alíquota pIBSSN inválida (negativa/não numérica)",
  "VSN-010": "Número do item ausente",
  "VSN-011": "Lista de itens vazia",
  "VSN-012": "Data do fato gerador ausente/inválida",
  "VSN-013": "Dado global obrigatório ausente",
  "VSN-014": "Tipo de documento fiscal (tpDoc) ausente",
  "VSN-015": "Tipo de documento fiscal (tpDoc) não suportado",
  "VSN-016": "Código de Regime Tributário (CRT) ausente/inválido",
  "VSN-017": "Tipo de regime do IBS/CBS (tpRegimeIBSCBS) inválido",
  "VSN-018": "tpRegimeIBSCBS incompatível com o CRT",
  "VSN-019": "Operação fora do escopo do cálculo assistido do Simples Nacional",
  "VSN-020": "Código de Classificação Tributária (cClassTrib) ausente",
  "VSN-021": "cClassTrib desconhecido ou fora de vigência",
  "VSN-022": "cClassTrib incompatível com o tpDoc",
  "VSN-023": "Código de Atividade do Simples Nacional incompatível com cClassTrib",
  "VSN-024": "Tipo de ente governamental (tpEnteGov) inválido",
  "VSN-025": "Parametrização de compra governamental indisponível para a data",
  "VSN-026": "Parametrização do cálculo do Simples Nacional indisponível para a data",
  "VSN-027": "cClassTrib sem tratamento implementado no cálculo do Simples Nacional",
  "VSN-000": "Erro de validação não categorizado",
  "VSN-999": "Falha técnica no cálculo do item",
};

// O "type" aponta para o catálogo de erros da própria Receita; o "pointer" diz
// onde está o problema (no item N, ou num campo da operação).
const CATALOGO = "/calculadora/observabilidade/simples-nacional/erros?codigo=";

function erro(code, campo, detail, indice) {
  const pointer = indice === undefined || indice === null
    ? `#/${campo}`
    : (campo ? `#/itens/${indice}/${campo}` : `#/itens/${indice}`);
  return { type: CATALOGO + code, title: VSN[code], code, pointer, detail };
}

// ─── Leitura das entradas ──────────────────────────────────────────────────────

function inteiro(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === "") return null;
  const s = String(valor).trim();
  if (!/^[+-]?\d+$/.test(s)) return null;
  return parseInt(s, 10);
}

const vazio = (v) => v === null || v === undefined || String(v).trim() === "";

/** Número obrigatório e não negativo. Devolve {valor, erro}. */
function lerDecimal(valor, campo, codAusente, codInvalido) {
  if (vazio(valor)) {
    return { valor: null, erro: erro(codAusente, campo, "O campo é obrigatório e não foi informado.") };
  }
  const n = dec(valor);
  if (n === null) {
    return { valor: null, erro: erro(codInvalido, campo, `O valor não é um número decimal válido, recebido: '${valor}'.`) };
  }
  if (n < ZERO) {
    return { valor: null, erro: erro(codInvalido, campo, `O valor não pode ser negativo, recebido: '${valor}'.`) };
  }
  return { valor: n, erro: null };
}

/** Alíquota: só é obrigatória quando o cálculo vai usá-la. */
function lerAliquota(valor, exigida, campo, codAusente, codInvalido) {
  if (vazio(valor)) {
    return {
      valor: null,
      erro: exigida ? erro(codAusente, campo, "A alíquota é exigida para o cálculo do item e não foi informada.") : null,
    };
  }
  const n = dec(valor);
  if (n === null) {
    return { valor: null, erro: erro(codInvalido, campo, `O valor não é um número decimal válido, recebido: '${valor}'.`) };
  }
  if (n < ZERO) {
    return { valor: null, erro: erro(codInvalido, campo, `O valor não pode ser negativo, recebido: '${valor}'.`) };
  }
  return { valor: n, erro: null };
}

const dataValida = (d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.trim())
  && !Number.isNaN(Date.parse(`${d.trim()}T00:00:00Z`));

// ─── Validação da operação inteira ─────────────────────────────────────────────

function validarGlobais(op, dados) {
  const erros = [];
  if (vazio(op.id)) erros.push(erro("VSN-013", "id", "O identificador da operação (id) é obrigatório."));
  if (vazio(op.versao)) erros.push(erro("VSN-013", "versao", "A versão do payload (versao) é obrigatória."));

  // A data vem antes do escopo: a habilitação do tpDoc depende dela.
  let data = null;
  if (vazio(op.data)) {
    erros.push(erro("VSN-012", "data", "A data do fato gerador é obrigatória."));
  } else if (!dataValida(op.data)) {
    erros.push(erro("VSN-012", "data", `Data inválida, recebido: '${op.data}' (esperado AAAA-MM-DD).`));
  } else {
    data = String(op.data).trim();
  }

  validarEscopo(op, data, erros, dados);

  if (!vazio(op.tpEnteGov)) {
    const te = inteiro(op.tpEnteGov);
    if (te === null || te < 1 || te > 4) {
      erros.push(erro("VSN-024", "tpEnteGov", `Tipo de ente governamental inválido, recebido: '${op.tpEnteGov}' (esperado 1, 2, 3 ou 4).`));
    }
  }

  if (!Array.isArray(op.itens) || !op.itens.length) {
    erros.push(erro("VSN-011", "itens", "A lista de itens é obrigatória e não pode estar vazia."));
  }
  return { erros, data };
}

function validarEscopo(op, data, erros, dados) {
  if (vazio(op.tpDoc)) {
    erros.push(erro("VSN-014", "tpDoc", "O tipo de documento fiscal (tpDoc) é obrigatório e não foi informado."));
  } else {
    const tpDoc = inteiro(op.tpDoc);
    if (tpDoc === null) {
      erros.push(erro("VSN-015", "tpDoc", `Tipo de documento não suportado pelo cálculo do Simples Nacional, recebido: '${op.tpDoc}'.`));
    } else if (dados.tpDocSemTratamento.includes(tpDoc)) {
      erros.push(erro("VSN-015", "tpDoc", `Tipo de documento fiscal (tpDoc) de código ${tpDoc} ainda não possui tratamento implementado no cálculo do Simples Nacional.`));
    } else if (data && !dados.tpDocCalculo.some((r) => r.tpDoc === tpDoc && valeNaData(r, data))) {
      erros.push(erro("VSN-015", "tpDoc", `Tipo de documento não suportado pelo cálculo do Simples Nacional, recebido: '${op.tpDoc}'.`));
    }
  }

  const crt = inteiro(op.CRT);
  if (crt === null || crt < 1 || crt > 4) {
    erros.push(erro("VSN-016", "CRT", `O Código de Regime Tributário (CRT) é obrigatório e deve ser 1, 2, 3 ou 4, recebido: '${op.CRT}'.`));
    return;
  }

  const temRegime = !vazio(op.tpRegimeIBSCBS);
  let tpRegime = null;
  if (temRegime) {
    tpRegime = inteiro(op.tpRegimeIBSCBS);
    if (tpRegime !== 1 && tpRegime !== 2) {
      erros.push(erro("VSN-017", "tpRegimeIBSCBS", `Tipo de regime de apuração do IBS/CBS inválido, recebido: '${op.tpRegimeIBSCBS}' (esperado 1 ou 2).`));
      return;
    }
  }

  // Incoerências CRT x tpRegimeIBSCBS (regras C21a-10/20/30 da NT 2026.005)
  if (crt === 4 && temRegime) {
    erros.push(erro("VSN-018", "tpRegimeIBSCBS", "CRT=4 (MEI) não admite tpRegimeIBSCBS algum (regra C21a-30 da NT 2026.005)."));
  } else if ((crt === 1 || crt === 2) && tpRegime === 2) {
    erros.push(erro("VSN-018", "tpRegimeIBSCBS", `CRT=${crt} não admite tpRegimeIBSCBS=2 (regra C21a-10 da NT 2026.005).`));
  } else if (crt === 3 && tpRegime === 1) {
    erros.push(erro("VSN-018", "tpRegimeIBSCBS", "CRT=3 não admite tpRegimeIBSCBS=1 (regra C21a-20 da NT 2026.005)."));
  }

  // Fora do escopo deste cálculo
  if (crt === 4) {
    erros.push(erro("VSN-019", "CRT", "Operação fora do escopo do cálculo assistido do Simples Nacional: MEI (CRT=4) está fora do Evento de Tributação do Simples Nacional."));
  }
  if (tpRegime === 1) {
    erros.push(erro("VSN-019", "tpRegimeIBSCBS", "Operação fora do escopo do cálculo assistido do Simples Nacional: optante pelo regime regular do IBS/CBS (tpRegimeIBSCBS=1) tem a tributação calculada pelo regime regular."));
  }
  if (crt === 3 && !temRegime) {
    erros.push(erro("VSN-019", "CRT", "Operação fora do escopo do cálculo assistido do Simples Nacional: CRT=3 sem tpRegimeIBSCBS=2 (regime normal puro) não é Simples Nacional."));
  }
}

// ─── Resolução das tabelas ─────────────────────────────────────────────────────

function acharRegime(crt, data, dados) {
  const alvo = crt === 1 ? { crt: 1, tpRegime: null } : crt === 2 ? { crt: 2, tpRegime: null } : { crt: 3, tpRegime: 2 };
  const candidatos = dados.regimes.filter(
    (r) => r.crt === alvo.crt && (alvo.tpRegime === null ? true : r.tpRegime === alvo.tpRegime) && valeNaData(r, data),
  );
  return candidatos.length ? candidatos[0] : null;
}

/** cClassTrib ligado a tratamento tributário ainda não implementado pela Receita. */
function naoImplementado(cClassTrib, data, dados) {
  if (vazio(cClassTrib)) return false;
  const cd = String(cClassTrib).trim();
  return dados.classNaoImplementada.some((r) => r.cd === cd && valeNaData(r, data));
}

function resolverTipoReceita(cClassTrib, contexto, dados, erros) {
  if (vazio(cClassTrib)) {
    erros.push(erro("VSN-020", "cClassTrib", "O código de classificação tributária (cClassTrib) é obrigatório e não foi informado."));
    return null;
  }
  const cd = String(cClassTrib).trim();
  const classif = vigente(dados.classificacoes.filter((r) => r.cd === cd), contexto.data);
  if (!classif) {
    erros.push(erro("VSN-021", "cClassTrib", `O cClassTrib '${cd}' não existe ou não está vigente na data '${contexto.data}': o tpRBSN não pôde ser determinado.`));
    return null;
  }
  const ligado = dados.classTpDoc.some((r) => r.cd === cd && r.tpDoc === contexto.tpDoc && valeNaData(r, contexto.data));
  if (!ligado) {
    erros.push(erro("VSN-022", "cClassTrib", `O cClassTrib '${cd}' não é admissível para o tipo de documento fiscal ${contexto.tpDoc}.`));
    return null;
  }
  const tipo = vigente(dados.tiposReceita.filter((r) => r.cd === classif.tpRBSN), contexto.data);
  if (!tipo) {
    erros.push(erro("VSN-026", "cClassTrib", `Não há parametrização de efeito vigente para o tipo de receita bruta tpRBSN=${classif.tpRBSN} na data '${contexto.data}'.`));
  }
  return tipo;
}

/** Código de atividade inválido NÃO é erro: leva ao estado NAO_CALCULADO. */
function validarAtividade(cAtivSN, tipoReceita, contexto, dados, erros) {
  if (vazio(cAtivSN)) return false;
  const cd = String(cAtivSN).trim();
  const atividade = vigente(dados.atividades.filter((r) => r.cd === cd), contexto.data);
  if (!atividade) return false;
  const ligada = dados.atividadeTpDoc.some((r) => r.id === atividade.id && r.tpDoc === contexto.tpDoc && valeNaData(r, contexto.data));
  if (!ligada) return false;
  if (atividade.naoTributavel && tipoReceita && tipoReceita.vedadoNaoTributavel) {
    erros.push(erro("VSN-023", "cAtivSN", `O código de atividade '${cd}' (Operações não Tributáveis) é incompatível com cClassTrib de tpRBSN=${tipoReceita.cd}.`));
  }
  return true;
}

// ─── Cálculo do item (NT 2026.005, seções 5.3.2 a 5.3.4) ───────────────────────

function calcularItem(insumo) {
  const tipo = insumo.tipoReceita;

  // Receita bruta do item: zero quando o tipo de receita não compõe receita.
  // O vIS só entraria se a linha vigente mandasse (hoje não manda em nenhuma).
  const vRBSNitem = tipo.compoeReceita
    ? (tipo.isCompoeReceita ? somar(insumo.baseCalculo, insumo.valorIs) : somar(insumo.baseCalculo))
    : ZERO;

  // Atividade ausente ou inválida: cálculo não realizado — e isso NÃO é erro.
  if (!insumo.cAtivSNValido) {
    return {
      estadoItem: "NAO_CALCULADO",
      tribCalc: { vRBSNitem, tpRBSN: tipo.cd, tpRBSNDescricao: tipo.descricao },
    };
  }

  const aliquotas = deslocarCbsIbs(
    { pIBSSN: insumo.pIbs, pCBSSN: insumo.pCbs },
    insumo.tpEnteGov,
    insumo.fatorTransicao,
  );

  const fator = dec(tipo.fatorReceita);
  const vBC = multiplicar(vRBSNitem, fator);
  const valorIbs = valorTributo(vRBSNitem, fator, aliquotas.pIBSSN);
  const valorCbs = valorTributo(vRBSNitem, fator, aliquotas.pCBSSN);

  // CRT=2 não gera IBS: os campos somem da resposta (o IBS é declarado pelo
  // emitente no gIBSCBS da nota, fora deste cálculo).
  const geraIbs = insumo.regime.geraIbs;
  const ibs = geraIbs ? repartir(insumo.regime, valorIbs, tipo.pendenteSuspenso) : null;
  const cbs = repartir(insumo.regime, valorCbs, tipo.pendenteSuspenso);

  const totalItem = somar(ibs ? ibs.devido : null, cbs.devido, insumo.valorIs);

  const tribCalc = {
    vRBSNitem,
    tpRBSN: tipo.cd,
    tpRBSNDescricao: tipo.descricao,
    vBC,
    pCBSSN: aliquotas.pCBSSN,
    vCBSSN: cbs.devido,
    vCBSPendSusp: cbs.pendenteSuspenso,
    IS: { valor: insumo.valorIs },
    totalItem,
  };
  if (geraIbs) {
    tribCalc.pIBSSN = aliquotas.pIBSSN;
    tribCalc.vIBSSN = ibs.devido;
    tribCalc.vIBSPendSusp = ibs.pendenteSuspenso;
  }
  return { estadoItem: "CALCULADO", tribCalc };
}

/** Compra governamental: desloca alíquota entre CBS e IBS (arts. 372 e 473 da LC 214/2025). */
function deslocarCbsIbs(aliquotas, tpEnteGov, fator) {
  if (tpEnteGov === null || tpEnteGov === undefined
      || (aliquotas.pIBSSN === null && aliquotas.pCBSSN === null)) {
    return aliquotas;
  }
  const pIbs = aliquotas.pIBSSN ?? ZERO;
  const pCbs = aliquotas.pCBSSN ?? ZERO;
  if (tpEnteGov === 1) {
    // União: pCBS' = pCBS + pIBS; pIBS' = 0.
    return { pIBSSN: ZERO, pCBSSN: somar(pCbs, pIbs) };
  }
  if (fator === null || fator === undefined) {
    throw new Error(`Fator de transição de compra governamental não resolvido para tpEnteGov ${tpEnteGov}`);
  }
  // pIBS' = pIBS + f x pCBS; pCBS' = (1 - f) x pCBS.
  return {
    pIBSSN: somar(pIbs, multiplicar(fator, pCbs)),
    pCBSSN: multiplicar(subtrair(UM, fator), pCbs),
  };
}

function valorTributo(vRBSNitem, fatorReceita, aliq) {
  if (aliq === null || fatorReceita === ZERO) return ZERO;
  return multiplicar(multiplicar(vRBSNitem, fatorReceita), dividirPorCem(aliq));
}

function repartir(regime, valor, pendenteSuspenso) {
  const destino = pendenteSuspenso ? regime.destinoPendenteSuspenso : regime.destinoDevido;
  if (destino === "DEVIDO") return { devido: valor, pendenteSuspenso: ZERO };
  if (destino === "PENDENTE_SUSPENSO") return { devido: ZERO, pendenteSuspenso: valor };
  return { devido: ZERO, pendenteSuspenso: ZERO };
}

// ─── Item: validação + cálculo ─────────────────────────────────────────────────

/** Erro de item leva o índice no pointer: #/itens/2/cClassTrib. */
function carimbar(erros, indice) {
  for (const e of erros) {
    if (e.pointer.startsWith("#/itens/")) continue;
    const campo = e.pointer.slice(2);
    e.pointer = campo ? `#/itens/${indice}/${campo}` : `#/itens/${indice}`;
  }
  return erros;
}

function processarItem(item, indice, contexto, dados) {
  const erros = [];
  const nObj = item.numero === null || item.numero === undefined ? null : Number(item.numero);
  if (nObj === null) {
    erros.push(erro("VSN-010", "numero", "O número do item é obrigatório."));
  }

  // Primeiro de tudo: tratamento ainda não implementado encerra o item.
  if (naoImplementado(item.cClassTrib, contexto.data, dados)) {
    const cd = String(item.cClassTrib).trim();
    erros.push(erro("VSN-027", "cClassTrib", `A classificação tributária '${cd}' ainda não possui tratamento implementado no cálculo do Simples Nacional na data '${contexto.data}'.`));
    return { nObj: nObj ?? indice + 1, estadoItem: "NAO_IMPLEMENTADO", tribCalc: null, erros: carimbar(erros, indice) };
  }

  const base = lerDecimal(item.baseCalculo, "baseCalculo", "VSN-001", "VSN-002");
  if (base.erro) erros.push(base.erro);
  const vIs = lerDecimal(item.valorImpostoSeletivo, "valorImpostoSeletivo", "VSN-003", "VSN-003");
  if (vIs.erro) erros.push(vIs.erro);

  const tipoReceita = resolverTipoReceita(item.cClassTrib, contexto, dados, erros);
  const cAtivSNValido = validarAtividade(item.cAtivSN, tipoReceita, contexto, dados, erros);

  // Alíquota só é exigida quando o cálculo vai usá-la.
  const exigidas = cAtivSNValido && !!tipoReceita && tipoReceita.exigeAliquota;
  const pIbsExigida = exigidas && contexto.regime.geraIbs;
  const pCbs = lerAliquota(item.pCBSSN, exigidas, "pCBSSN", "VSN-004", "VSN-005");
  if (pCbs.erro) erros.push(pCbs.erro);
  const pIbs = lerAliquota(item.pIBSSN, pIbsExigida, "pIBSSN", "VSN-006", "VSN-007");
  if (pIbs.erro) erros.push(pIbs.erro);

  if (erros.length) {
    return { nObj: nObj ?? indice + 1, estadoItem: "INCONSISTENCIA_ENTRADA", tribCalc: null, erros: carimbar(erros, indice) };
  }

  try {
    const r = calcularItem({
      regime: contexto.regime,
      tipoReceita,
      cAtivSNValido,
      baseCalculo: base.valor,
      valorIs: vIs.valor,
      pIbs: pIbs.valor,
      pCbs: pCbs.valor,
      tpEnteGov: contexto.tpEnteGov,
      fatorTransicao: contexto.fatorTransicao,
    });
    return { nObj, estadoItem: r.estadoItem, tribCalc: r.tribCalc, erros: null };
  } catch (e) {
    return {
      nObj: nObj ?? indice + 1,
      estadoItem: "FALHA_TECNICA",
      tribCalc: null,
      erros: [erro("VSN-999", null, String(e && e.message ? e.message : e), indice)],
    };
  }
}

// ─── Entrada principal ─────────────────────────────────────────────────────────

/**
 * Calcula o IBS e a CBS de uma operação do Simples Nacional.
 *
 * Operação: { id, versao, data: "AAAA-MM-DD", tpDoc, CRT, tpRegimeIBSCBS?, tpEnteGov?, itens: [...] }
 * Item: { numero, cAtivSN, cClassTrib, baseCalculo, valorImpostoSeletivo, pIBSSN, pCBSSN }
 * Valores vão como texto ("950.00"), do jeito que a Receita recebe.
 *
 * Devolve { oper, objetos, total } com os valores já em texto, ou
 * { erros: [...] } quando a operação inteira é recusada (o equivalente ao HTTP 422).
 */
export function calcularSimples(operacao, dados = RTC) {
  const op = operacao || {};
  const { erros: errosGlobais, data } = validarGlobais(op, dados);
  if (errosGlobais.length) return { erros: errosGlobais };

  const crt = inteiro(op.CRT);
  const regime = acharRegime(crt, data, dados);
  if (!regime) {
    return { erros: [erro("VSN-026", "CRT", `Não há parametrização de regime de apuração do Simples Nacional vigente para CRT=${op.CRT} e tpRegimeIBSCBS=${op.tpRegimeIBSCBS} na data '${data}'.`)] };
  }

  const tpEnteGov = vazio(op.tpEnteGov) ? null : inteiro(op.tpEnteGov);
  let fatorTransicao = null;
  if (tpEnteGov !== null && tpEnteGov !== 1) {
    const linha = vigente(dados.transicaoCompraGov, data);
    if (!linha) {
      return { erros: [erro("VSN-025", "tpEnteGov", `Não há parametrização de transição de compra governamental vigente para a data '${data}'.`)] };
    }
    fatorTransicao = dec(linha.fator);
  }

  const contexto = { data, tpDoc: inteiro(op.tpDoc), regime, tpEnteGov, fatorTransicao };
  const objetos = op.itens.map((item, i) => processarItem(item || {}, i, contexto, dados))
    .sort((a, b) => (a.nObj ?? 0) - (b.nObj ?? 0));

  // Totais: CALCULADO e NAO_CALCULADO entram (o segundo só com a receita bruta);
  // item com erro ou não implementado fica de fora.
  const comTrib = objetos.filter((o) => o.tribCalc);
  const total = comTrib.length ? totalizar(comTrib) : null;

  // Campo que não foi informado não sai na resposta (a Receita omite nulos).
  const oper = { data: op.data, tpDoc: op.tpDoc, CRT: op.CRT };
  if (!vazio(op.tpRegimeIBSCBS)) oper.tpRegimeIBSCBS = op.tpRegimeIBSCBS;
  if (!vazio(op.tpEnteGov)) oper.tpEnteGov = op.tpEnteGov;

  const saida = { oper, objetos: objetos.map(formatarObjeto) };
  if (total) saida.total = total;
  return saida;
}

function totalizar(objetos) {
  // Um campo do total só existe quando pelo menos um item tem esse valor: a nota
  // com um item só, não calculado, soma a receita bruta e mais nada.
  const soma = (f) => {
    const vs = objetos.map((o) => f(o.tribCalc)).filter((v) => v !== null && v !== undefined);
    return vs.length ? moeda(vs.reduce((t, v) => t + v, ZERO)) : undefined;
  };
  const t = {
    vRBSNtot: soma((c) => c.vRBSNitem),
    vBC: soma((c) => c.vBC),
    vIBSSNtot: soma((c) => c.vIBSSN),
    vIBSSNtotPendSusp: soma((c) => c.vIBSPendSusp),
    vCBSSNtot: soma((c) => c.vCBSSN),
    vCBSSNtotPendSusp: soma((c) => c.vCBSPendSusp),
    totalIs: soma((c) => (c.IS ? c.IS.valor : null)),
    totalTributos: soma((c) => c.totalItem),
  };
  for (const k of Object.keys(t)) if (t[k] === undefined) delete t[k];
  return t;
}

function formatarObjeto(o) {
  const saida = { nObj: o.nObj, estadoItem: o.estadoItem };
  if (o.erros && o.erros.length) saida.erros = o.erros;
  if (!o.tribCalc) return saida;
  const c = o.tribCalc;
  const t = { vRBSNitem: moeda(c.vRBSNitem), tpRBSN: c.tpRBSN, tpRBSNDescricao: c.tpRBSNDescricao };
  if (c.vBC !== undefined) t.vBC = moeda(c.vBC);
  if (c.pIBSSN !== undefined) {
    t.pIBSSN = aliquota(c.pIBSSN);
    t.vIBSSN = moeda(c.vIBSSN);
    t.vIBSPendSusp = moeda(c.vIBSPendSusp);
  }
  if (c.pCBSSN !== undefined) {
    t.pCBSSN = aliquota(c.pCBSSN);
    t.vCBSSN = moeda(c.vCBSSN);
    t.vCBSPendSusp = moeda(c.vCBSPendSusp);
  }
  if (c.IS) t.IS = { valor: moeda(c.IS.valor) };
  if (c.totalItem !== undefined) t.totalItem = moeda(c.totalItem);
  saida.tribCalc = t;
  return saida;
}

// ─── Consultas de apoio (para as telas) ────────────────────────────────────────

/** Atividades do Simples vigentes na data, opcionalmente só as do tipo de documento. */
export function atividadesVigentes(data, tpDoc = null, dados = RTC) {
  return dados.atividades
    .filter((a) => valeNaData(a, data))
    .filter((a) => tpDoc === null
      || dados.atividadeTpDoc.some((r) => r.id === a.id && r.tpDoc === tpDoc && valeNaData(r, data)))
    .map((a) => ({ cd: a.cd, descricao: a.descricao, anexo: a.anexo, anexoFatorR: a.anexoFatorR, rotulo: a.rotulo }));
}

/** Tipos de documento que a calculadora aceita na data (55 = NF-e, 91 = NFS-e...). */
export function documentosVigentes(data, dados = RTC) {
  return dados.tpDocCalculo
    .filter((r) => valeNaData(r, data) && !dados.tpDocSemTratamento.includes(r.tpDoc))
    .map((r) => ({ tpDoc: r.tpDoc, sigla: r.sigla }));
}

/** A partir de quando há cálculo (hoje, 01/01/2027). */
export function vigenteDesde(dados = RTC) {
  return dados.tiposReceita.reduce((menor, r) => (menor === null || r.de < menor ? r.de : menor), null);
}
