/**
 * O que um código de falha quer dizer: descrição, causas prováveis e DE ONDE veio o texto.
 *
 * Até 21/11/2026 a tela mostrava "P0301 · ATUAL" e parava aí. Os acervos estavam baixados em
 * catalogo/ e nenhuma tela os usava. Este módulo é a busca; os dados ficam em js/falhas/*.js,
 * gerados por catalogo/gerar_falhasdados.py, e são baixados POR PEDAÇO: só o arquivo do prefixo
 * (P0, P2, o resto) ou da marca que apareceu no carro. Nunca os 4 MB de uma vez.
 *
 * AS REGRAS (documentos aprovados da Etapa 1 e da Etapa 2):
 *  1. Código GENÉRICO (vale em qualquer carro): texto SAE; onde a base da Honda tem, as causas.
 *     As causas vêm de UMA base, a da Honda. Para combustão elas são quase universais, mas algumas
 *     citam sistema que só a Honda tem — por isso a tela diz de onde veio.
 *  2. Código de MONTADORA: a tabela da própria marca; não achou, as marcas da mesma família;
 *     por último a lista geral. Só descrição: causa de código de montadora não existe em base aberta.
 *  3. A tela SEMPRE escreve a origem, e nada aqui é "definição conferida para aquele módulo".
 *  4. O que não tem tradução conferida aparece em inglês, marcado. Nunca tradução automática.
 *
 * Não tem window nem document: dá para testar sem navegador.
 */

/** Quais prefixos são genéricos (norma SAE J2012): valem em qualquer carro. */
export function eGenerico(codigo) {
  const c = String(codigo || "").toUpperCase();
  if (!/^[PBCU][0-3][0-9A-F]{3}$/.test(c)) return false;
  const l = c[0], d = c[1], t = parseInt(c[2], 16);
  if (l === "P") return d === "0" || d === "2" || (d === "3" && t >= 4);
  return d === "0" || (l === "U" && d === "3");
}

/** Tira o sufixo do tipo de falha ("P0301-00", "U0100:87") e devolve só o código. */
export const soCodigo = codigo => String(codigo || "").toUpperCase().trim().split(/[-:\s]/)[0];

/* ------------------------------------------------------------------ a marca do carro */
// Do nome que está no cadastro para o arquivo de códigos. Só marca que TEM arquivo.
const MARCA_ARQUIVO = [
  [/CHEVROLET|GM\b|GENERAL MOTORS|OPEL|BUICK|CADILLAC|GMC|PONTIAC|SATURN|OLDSMOBILE|DAEWOO/, "gm", "GM"],
  [/VOLKSWAGEN|\bVW\b|AUDI|SEAT|SKODA/, "vw", "Volkswagen"],
  [/FIAT/, "fiat", "Fiat"],
  [/ALFA/, "alfaromeo", "Alfa Romeo"],
  [/FORD|LINCOLN|MERCURY/, "ford", "Ford"],
  [/HONDA|ACURA/, "honda", "Honda"],
  [/NISSAN|INFINITI|DATSUN/, "nissan", "Nissan"],
  [/MITSUBISHI/, "mitsubishi", "Mitsubishi"],
  [/BMW|MINI\b/, "bmw", "BMW"],
  [/CHRYSLER|DODGE|JEEP|\bRAM\b/, "chrysler", "Chrysler"],
];
// Quem divide tabela com quem: um código que a marca não tem é procurado na família.
const FAMILIA = { fiat: ["alfaromeo", "chrysler"], alfaromeo: ["fiat"], chrysler: ["fiat"] };
const NOME = Object.fromEntries(MARCA_ARQUIVO.map(m => [m[1], m[2]]));

// Os três primeiros caracteres do chassi (WMI) das fábricas que aparecem na oficina. Usado só
// quando não há cadastro: com a placa buscada, vale a marca do cadastro.
const WMI = {
  "9BW": "vw", "8AW": "vw", "3VW": "vw", "WVW": "vw", "WAU": "vw", "93U": "vw",
  "9BG": "gm", "8AG": "gm", "1G1": "gm", "KL1": "gm",
  "9BD": "fiat", "8AP": "fiat", "ZFA": "fiat",
  "9BF": "ford", "8AF": "ford", "1FA": "ford",
  "93H": "honda", "1HG": "honda", "JHM": "honda", "2HG": "honda",
  "94D": "nissan", "3N1": "nissan", "JN1": "nissan",
  "93X": "mitsubishi", "JMB": "mitsubishi",
  "WBA": "bmw", "98M": "bmw",
  "988": "chrysler", "1C4": "chrysler",
};

/** { arquivo, nome } da marca, ou null quando não temos tabela dela (Renault, Toyota, Hyundai…). */
export function marcaDe(marca, vin) {
  const m = String(marca || "").toUpperCase();
  if (m) {
    for (const [re, arq, nome] of MARCA_ARQUIVO) if (re.test(m)) return { arquivo: arq, nome };
    return null;                      // tem marca no cadastro e não temos tabela: não adivinha pelo chassi
  }
  const w = String(vin || "").toUpperCase().slice(0, 3);
  return WMI[w] ? { arquivo: WMI[w], nome: NOME[WMI[w]] } : null;
}

/* ------------------------------------------------------------------ carga por pedaço */
const cargas = {};
let carregador = nome => import("./falhas/" + nome + ".js").then(m => m.default);
/** Só para teste: troca quem busca o arquivo. */
export const usarCarregador = fn => { carregador = fn; for (const k of Object.keys(cargas)) delete cargas[k]; };
function pedaco(nome) {
  if (!cargas[nome]) cargas[nome] = carregador(nome).catch(e => { delete cargas[nome]; throw e; });
  return cargas[nome];
}
const arquivoGenerico = c => (c.startsWith("P0") ? "generico_p0" : c.startsWith("P2") ? "generico_p2" : "generico_outros");

const ORIGEM = {
  sae: "Texto genérico (norma SAE): vale em qualquer carro.",
  honda: "Causas da base de diagnóstico da Honda. Em outro carro servem de roteiro, não de definição.",
  geral: "Lista geral de códigos, sem marca definida: confira com o manual do carro.",
};
const SECAO_TITULO = { viu: "O que o módulo viu", teste: "Em que condição ele testa", luz: "Luz no painel",
  ciclos: "Quando verifica", grava: "Quando grava", apaga: "Como o código sai", emergencia: "O que o módulo faz em emergência" };

function montar(codigo, v, origem, marcaNome) {
  let causas = (v.c || []).map(c => ({ nivel: c[0], texto: c[1], pt: !!c[2] }));
  // Lista que só tem sub-itens (sem o título de cima) é uma lista simples: sem isso a tela desenha
  // tudo recuado, como se faltasse o começo.
  if (causas.length && causas.every(c => c.nivel > 0)) causas = causas.map(c => ({ ...c, nivel: 0 }));
  const secoes = Object.keys(v.x || {}).filter(k => SECAO_TITULO[k]).map(k => ({
    chave: k, titulo: SECAO_TITULO[k], linhas: v.x[k].map(l => ({ texto: l[0], pt: !!l[1] })) }));
  const temIngles = (v.d && !v.p) || causas.some(c => !c.pt) || secoes.some(s => s.linhas.some(l => !l.pt));
  const out = {
    codigo, achou: true, descricao: v.d || "", pt: !!v.p, causas, secoes, emIngles: !!temIngles,
    generico: eGenerico(codigo), marca: marcaNome || "", pecas: v.g || [],
    origem: origem === "marca" ? "Tabela de códigos da " + marcaNome + ". Descrição de montadora, não conferida para este módulo."
      : origem === "familia" ? "Tabela da " + marcaNome + ", que divide códigos com a marca deste carro. Não conferida para este módulo."
      : ORIGEM[origem],
  };
  if (causas.length) out.origemCausas = ORIGEM.honda;
  // A fonte em poucas palavras, para ficar embaixo de CADA código sem repetir o parágrafo inteiro.
  out.fonte = (origem === "marca" ? "Tabela da " + marcaNome : origem === "familia" ? "Tabela da " + marcaNome + " (mesma família)" : origem === "geral" ? "Lista geral, sem marca" : "Norma SAE")
    + (causas.length ? "; causas da base da Honda" : "") + (temIngles ? "; parte ainda em inglês" : "");
  return out;
}
const nada = (codigo, motivo) => ({ codigo, achou: false, descricao: "", pt: false, causas: [], secoes: [], emIngles: false,
  generico: eGenerico(codigo), marca: "", pecas: [], origem: motivo });

/**
 * Explica UM código. `opc` = { marca (do cadastro), vin }.
 * Nunca rejeita: sem internet ou sem arquivo, devolve { achou: false } com o motivo escrito.
 */
export async function explicar(codigoBruto, opc = {}) {
  const codigo = soCodigo(codigoBruto);
  if (!/^[PBCU][0-3][0-9A-F]{3}$/.test(codigo)) return nada(codigo, "Código fora do formato P/B/C/U: não há tabela para ele.");
  try {
    if (eGenerico(codigo)) {
      const v = (await pedaco(arquivoGenerico(codigo)))[codigo];
      return v && (v.d || v.c) ? montar(codigo, v, v.o === "h" ? "honda" : "sae") : nada(codigo, "Código genérico sem descrição nas bases abertas.");
    }
    const m = marcaDe(opc.marca, opc.vin);
    if (m) {
      const v = (await pedaco("marca_" + m.arquivo))[codigo];
      if (v) return montar(codigo, v, "marca", m.nome);
      for (const f of FAMILIA[m.arquivo] || []) {
        const vf = (await pedaco("marca_" + f))[codigo];
        if (vf) return montar(codigo, vf, "familia", NOME[f]);
      }
    }
    const g = (await pedaco(arquivoGenerico(codigo)))[codigo];
    if (g && g.d) return montar(codigo, g, "geral");
    return nada(codigo, m ? "Código de montadora que a tabela aberta da " + m.nome + " não tem."
      : "Código de montadora, e não há tabela aberta para a marca deste carro.");
  } catch (e) {
    return nada(codigo, "Não deu para baixar a tabela de códigos (sem internet?). O código lido continua valendo.");
  }
}

/** Explica uma lista de falhas ({ codigo, ... }) e devolve { [codigo]: explicação }. */
export async function explicarTodos(falhas, opc = {}) {
  const codigos = [...new Set((falhas || []).map(f => soCodigo(f.codigo || f)).filter(Boolean))];
  const r = await Promise.all(codigos.map(c => explicar(c, opc)));
  return Object.fromEntries(r.map(x => [x.codigo, x]));
}

/** O aviso que vale para o cartão inteiro de falhas: dito uma vez, não embaixo de cada código. */
export const NOTA_DAS_FONTES = "A descrição genérica (norma SAE) vale em qualquer carro. As causas vêm da base de diagnóstico da Honda: em outra marca servem de roteiro, não de definição. Código de montadora traz só a descrição, da tabela aberta da marca, e não é conferido para o módulo deste carro.";
