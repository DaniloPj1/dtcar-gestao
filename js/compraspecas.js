// Compras (v59, pedido do Danilo em 16/11/2026) — regras da tela Compras, num lugar só. Sem window/document.
// Ideia do Danilo: pesquisar a peça (de preferência pela placa do carro), ver o preço de cada fornecedor numa tela só para comparar,
// pôr no carrinho e, ao comprar, o carrinho vira um pedido por fornecedor, que ele finaliza em cada fornecedor depois.
//
// De onde vem cada preço (a tela sempre mostra a origem e a data, para não comparar um preço de hoje com um de semanas atrás):
//   - "ao vivo": consulta automática no webservice do fornecedor (gravada só pelo servidor; entra nas próximas etapas);
//   - "informado": o preço que o vendedor passou e o Danilo digitou (compras_precos, origem "manual");
//   - "última compra": o custo da última nota de entrada daquele fornecedor (produto_fornecedor.ultimo_custo ÷ fator, ultima_compra).
// "Menor preço" só vale entre os preços atuais (ao vivo ou informado há até DIAS_ATUAL dias); a última compra é referência.
import { norm } from "./util.js";
import { nc, codigosDe, textoAplicacao } from "./pecas.js";

export const DIAS_ATUAL = 7;
export const ORIGEM_TEXTO = { ao_vivo: "Ao vivo", manual: "Informado", ultima_compra: "Última compra" };
export const SITUACOES_PEDIDO = {
  a_finalizar: { t: "A finalizar no fornecedor", cor: "warn" },
  finalizado: { t: "Finalizado", cor: "ok" },
  cancelado: { t: "Cancelado", cor: "muted" },
};
export const normCodigo = nc;
export const numPedido = n => "Pedido " + String(n ?? "").padStart(4, "0");
export const nomeFornecedor = f => f ? (String(f.fantasia || "").trim() || f.razao || "") : "";
export const arred2 = v => Math.round((Number(v) || 0) * 100) / 100;
export const totalLinha = i => arred2((Number(i.qtd) || 0) * (Number(i.preco) || 0));
/** dias desde a data (null = sem data) */
export const idadeDias = (iso, agora = Date.now()) => {
  if (!iso) return null; const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso + "T12:00:00-03:00" : iso).getTime();
  return Number.isFinite(t) ? Math.max(0, Math.floor((agora - t) / 864e5)) : null;
};

/** Todos os códigos de uma linha da pesquisa (a peça mostrada e as equivalentes: marca, montadora e conversão), normalizados */
export function codigosDaLinha(e) {
  const s = new Set();
  for (const p of [e.peca, ...(e.alternativas || [])]) for (const k of codigosDe(p)) s.add(k);
  return s;
}

/**
 * Índice de preços por código (normalizado). Monte uma vez por tela.
 *   precos       compras_precos (manual / ao vivo)
 *   vinculos     produto_fornecedor (notas de entrada): última compra por fornecedor
 *   produtos     cadastro (a referência do produto também liga a nota à peça do catálogo)
 *   fornecedores cadastro (nome)
 */
export function indiceOfertas({ precos = [], vinculos = [], produtos = [], fornecedores = [] }) {
  const forn = new Map(fornecedores.map(f => [f.id, f])), prod = new Map(produtos.map(p => [p.id, p]));
  const idx = new Map(), add = (k, o) => { if (!k || k.length < 3) return; if (!idx.has(k)) idx.set(k, []); idx.get(k).push(o); };
  for (const p of precos) {
    const f = forn.get(p.fornecedor_id); if (!f || !(Number(p.preco) > 0)) continue;
    const o = { chave: "p:" + p.id, id: p.id, fornecedor_id: p.fornecedor_id, fornecedor: nomeFornecedor(f), codigo: p.codigo, marca: p.marca || "", descricao: p.descricao || "",
      preco: Number(p.preco), estoque: p.estoque === null || p.estoque === undefined ? null : Number(p.estoque), prazo: p.prazo || "", origem: p.origem === "ao_vivo" ? "ao_vivo" : "manual", em: p.consultado_em };
    add(p.codigo_norm || nc(p.codigo), o);
  }
  for (const v of vinculos) {
    const f = forn.get(v.fornecedor_id), custo = Number(v.ultimo_custo), fator = Number(v.fator) || 1;
    if (!f || !(custo > 0)) continue;
    const p = prod.get(v.produto_id);
    const o = { chave: "v:" + v.id, fornecedor_id: v.fornecedor_id, fornecedor: nomeFornecedor(f), codigo: v.codigo || (p && p.referencia) || "", marca: (p && p.marca) || "",
      descricao: (p && p.descricao) || v.descricao || "", preco: arred2(custo / fator), estoque: null, prazo: "", origem: "ultima_compra", em: v.ultima_compra, produto_id: v.produto_id };
    for (const k of new Set([nc(v.codigo), p ? nc(p.referencia) : ""])) add(k, o);
  }
  return idx;
}

/**
 * Preços de uma linha, um por fornecedor e código, do menor para o maior.
 * Cada fornecedor mostra o preço atual (ao vivo ou informado, o mais novo); sem preço atual, a última compra.
 * Quando há os dois, a última compra vai junto na linha (ultima), como referência.
 * Devolve [{ ...oferta, idade, antigo, menor, ultima }].
 */
export function ofertasDaLinha(idx, codigos, agora = Date.now()) {
  const vistas = new Map();
  for (const k of codigos) for (const o of idx.get(k) || []) if (!vistas.has(o.chave)) vistas.set(o.chave, o);
  const todas = [...vistas.values()].map(o => { const idade = idadeDias(o.em, agora); return { ...o, idade, antigo: o.origem !== "ultima_compra" && (idade === null || idade > DIAS_ATUAL) }; });
  const atuais = todas.filter(o => o.origem !== "ultima_compra"), compras = todas.filter(o => o.origem === "ultima_compra");
  const maisNova = (a, b) => String(b.em || "").localeCompare(String(a.em || ""));
  const ultimaDo = fid => compras.filter(o => o.fornecedor_id === fid).sort(maisNova)[0] || null;
  // um preço atual por fornecedor + código (ao vivo vence o informado; depois o mais novo)
  const porChave = new Map();
  for (const o of atuais.sort((a, b) => (a.origem === "ao_vivo" ? 0 : 1) - (b.origem === "ao_vivo" ? 0 : 1) || maisNova(a, b))) {
    const k = o.fornecedor_id + "|" + nc(o.codigo); if (!porChave.has(k)) porChave.set(k, { ...o, ultima: ultimaDo(o.fornecedor_id) });
  }
  const comAtual = new Set([...porChave.values()].map(o => o.fornecedor_id));
  const linhas = [...porChave.values()];
  for (const fid of new Set(compras.map(o => o.fornecedor_id))) if (!comAtual.has(fid)) linhas.push({ ...ultimaDo(fid), ultima: null });
  linhas.sort((a, b) => a.preco - b.preco || (a.origem === "ultima_compra" ? 1 : 0) - (b.origem === "ultima_compra" ? 1 : 0) || a.fornecedor.localeCompare(b.fornecedor, "pt-BR"));
  const valem = linhas.filter(o => o.origem !== "ultima_compra" && !o.antigo && o.estoque !== 0);
  // menor preço = o mais barato entre os preços atuais, quando há outro preço (atual ou antigo) para comparar
  const menor = valem.length && linhas.length >= 2 ? valem[0] : null;
  return linhas.map(o => ({ ...o, menor: !!menor && o.chave === menor.chave }));
}

/** Preços informados cujo código não está em nenhuma linha do catálogo mostrada (ex.: código que o catálogo não tem) */
export function precosSoltos(idx, txt, codigosMostrados) {
  const q = nc(txt); if (q.length < 3) return [];
  const out = new Map();
  for (const [k, l] of idx) if (k.startsWith(q) && !codigosMostrados.has(k)) for (const o of l) out.set(o.chave, o);
  return [...out.values()].sort((a, b) => a.preco - b.preco).slice(0, 30);
}

/**
 * Pesquisa no catálogo de peças sem a placa: pelo código (da marca, da montadora ou da conversão; começo do código vale)
 * ou pela descrição (todas as palavras). Devolve no formato de pecasDoVeiculo: { modo, total, cortado, grupos }.
 */
export function buscarNoCatalogo(cat, txt, limite = 40) {
  const q = nc(txt), pals = norm(txt).split(/[^a-z0-9.]+/).filter(x => x.length >= 2);
  const porCodigo = q.length >= 3 && /\d/.test(q);
  if (!porCodigo && !pals.length) return { modo: "", total: 0, cortado: false, grupos: [] };
  const achadas = [];
  for (const p of cat.pecas) {
    let pontos = 0;
    if (porCodigo) { const cs = codigosDe(p); if (cs.includes(q)) pontos = 3; else if (cs.some(k => k.startsWith(q))) pontos = 1; else continue; }
    else { const t = norm([p.descricao, p.grupo, p.marca, p.medidas].join(" ")); if (!pals.every(x => t.includes(x))) continue; pontos = 1; }
    achadas.push({ peca: p, pontos });
  }
  achadas.sort((a, b) => b.pontos - a.pontos || a.peca.descricao.localeCompare(b.peca.descricao, "pt-BR"));
  const usadas = achadas.slice(0, limite);
  const porGrupo = new Map();
  for (const { peca, pontos } of usadas) {
    const e = { peca, aplicacoes: [...new Set(peca.apl.map(textoAplicacao))], conferir: false, pontos };
    if (!porGrupo.has(peca.grupo)) porGrupo.set(peca.grupo, []); porGrupo.get(peca.grupo).push(e);
  }
  const grupos = [...porGrupo.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR")).map(([grupo, itens]) => ({ grupo, itens }));
  return { modo: porCodigo ? "codigo" : "descricao", total: achadas.length, cortado: achadas.length > limite, grupos };
}

/** Carrinho agrupado por fornecedor: [{ fornecedor_id, fornecedor, itens, total }], fornecedores em ordem alfabética */
export function agruparCarrinho(itens, fornecedores = []) {
  const forn = new Map(fornecedores.map(f => [f.id, f])), g = new Map();
  for (const i of itens) { if (!g.has(i.fornecedor_id)) g.set(i.fornecedor_id, { fornecedor_id: i.fornecedor_id, fornecedor: nomeFornecedor(forn.get(i.fornecedor_id)) || "Fornecedor fora do cadastro", itens: [], total: 0 });
    const x = g.get(i.fornecedor_id); x.itens.push(i); x.total = arred2(x.total + totalLinha(i)); }
  return [...g.values()].sort((a, b) => a.fornecedor.localeCompare(b.fornecedor, "pt-BR"));
}

const saudacao = h => h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
const reaisTxt = v => "R$ " + (Number(v) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtdTxt = v => (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
/**
 * Texto do pedido para mandar ao fornecedor (WhatsApp ou e-mail), no padrão das mensagens do Danilo:
 * saudação, itens em tópicos (•), assinatura "DTCar Centro Automotivo" e, no fim, em negrito, a marca do sistema.
 * hora = hora de Brasília (0–23).
 */
export function textoPedido(pedido, itens, { contato = "", hora = 9 } = {}) {
  const nome = String(contato || "").trim().split(/\s+/)[0];
  const linhas = itens.map(i => "• " + qtdTxt(i.qtd) + " x " + i.descricao + ([i.marca, i.codigo].filter(Boolean).length ? " — " + [i.marca, i.codigo].filter(Boolean).join(" ") : "")
    + (Number(i.preco) > 0 ? " (" + reaisTxt(i.preco) + " cada)" : ""));
  return [saudacao(hora) + (nome ? ", Sr. " + nome : "") + "!", "",
    "Segue o pedido da DTCar Centro Automotivo (nosso " + numPedido(pedido.numero).toLowerCase() + "):", ...linhas, "",
    "Total: " + reaisTxt(pedido.total), "Por favor, confirme a disponibilidade e o prazo de entrega.", "",
    "DTCar Centro Automotivo", "*Mensagem gerada pelo sistema Gestão DTCar*"].join("\n");
}

/* ---------------- consulta ao vivo (etapa 2): robô reconhecido pelo endereço do portal ---------------- */
/** Mesma regra da função "compras": o robô é escolhido SÓ pelo endereço do portal cadastrado em Ajustes (o nome do fornecedor não conta). */
export const NOME_ROBO = { dpk: "DPK", rolemar: "Rolemar Master", pellegrino: "Pellegrino Compre Online", toli: "Portal Toli" };
export function roboDaConexao(c) {
  const s = String((c && c.endereco) || "").toLowerCase();
  if (/dpk\.com\.br/.test(s)) return "dpk";
  if (/rolemarmaster\.com|rolemar\./.test(s)) return "rolemar";
  if (/pellegrino\.com\.br/.test(s)) return "pellegrino";
  if (/tolidistribuidora\.com\.br/.test(s)) return "toli";
  return null;
}
/** Como a conexão consulta: "servidor" (DPK, Rolemar, Pellegrino), "pc" (Toli: pelo programa do PC, em preparação) ou "" (portal não reconhecido) */
export const ondeConsulta = robo => robo === "toli" ? "pc" : robo ? "servidor" : "";
/** Códigos que vão para a consulta ao vivo de uma linha da pesquisa: o da peça, os equivalentes e os da montadora (sem repetir, no máximo `max`) */
export function termosDaLinha(e, max = 6) {
  const out = [], vistos = new Set();
  const add = c => { const k = normCodigo(c); if (k.length < 3 || vistos.has(k) || out.length >= max) return; vistos.add(k); out.push(String(c).trim()); };
  if (!e || !e.peca) return out;
  add(e.peca.codigo);
  for (const a of e.alternativas || []) add(a.codigo);
  for (const o of e.peca.oem || []) add(typeof o === "string" ? o : o && o.codigo);
  return out;
}
/** Resumo em uma frase do que a consulta ao vivo devolveu, para a tela: "DPK: 2 preços · Rolemar: sem resultado · Pellegrino: senha recusada…" */
export function resumoAoVivo(r, nomeDe = () => "") {
  if (!r) return "";
  if (!r.ok) return r.erro || "A consulta não respondeu.";
  const l = (r.resultados || []).map(x => {
    const nome = nomeDe(x.fornecedor_id) || x.nome || "Fornecedor";
    if (x.no_pc) return nome + ": pelo programa do PC (em preparação)";
    if (!x.ok) return nome + ": " + (x.erro || "falhou");
    const n = (x.ofertas || []).length;
    return nome + ": " + (n ? n + (n === 1 ? " preço" : " preços") : "sem resultado");
  });
  return l.length ? l.join(" · ") : "Nenhum fornecedor conectado para consultar.";
}

/**
 * Aba "Fornecedores" (pedido do Danilo em 17/11/2026: "uma aba em compras para resultados apenas dos fornecedores", como o protótipo):
 * UMA tabela com o que cada fornecedor respondeu — Fornecedor | Código | Preço | Estoque | Prazo | Origem — sem as linhas do acervo.
 *   resposta  o que a função "compras" devolveu ({ em, resultados: [{ fornecedor_id, nome, ok, ofertas, erro, no_pc }] }) ou null
 *   idx       índice de preços da tela (informados e última compra entram como referência, pelos códigos pesquisados)
 *   codigos   códigos pesquisados (normalizados ou não)
 * Devolve { linhas: [{ fornecedor, codigo, marca, descricao, preco, estoque, prazo, origem, em, menor, antigo }], semResposta: [{ fornecedor, motivo, no_pc }], semEstoque }.
 * Menor preço = o mais barato entre os preços atuais com estoque (ao vivo ou informado há até DIAS_ATUAL dias), quando há 2+ linhas.
 * REGRA DO DANILO (17/11/2026): só entra resultado com estoque disponível — linha "sem estoque" (estoque 0) fica de fora (contada em semEstoque)
 * e a última compra das notas (que não diz estoque) não entra nesta aba. Estoque em branco (o portal não informa a quantidade, como o
 * Pellegrino, que só diz quando NÃO tem) conta como disponível e aparece "disponível".
 */
export function linhasCotacao({ resposta = null, idx = new Map(), codigos = [], fornecedores = [], agora = Date.now(), soComEstoque = true } = {}) {
  const forn = new Map(fornecedores.map(f => [f.id, f]));
  const nomeDe = (id, alt) => nomeFornecedor(forn.get(id)) || alt || "Fornecedor";
  const linhas = [], vistas = new Set(), semResposta = [];
  const chaveDe = (fid, cod) => fid + "|" + nc(cod);
  for (const r of (resposta && resposta.resultados) || []) {
    const nome = nomeDe(r.fornecedor_id, r.nome);
    if (!r.ok) { semResposta.push({ fornecedor_id: r.fornecedor_id, fornecedor: nome, motivo: r.no_pc ? "consulta pelo programa do PC (em preparação)" : (r.erro || "não respondeu"), no_pc: !!r.no_pc }); continue; }
    for (const o of r.ofertas || []) {
      const k = chaveDe(r.fornecedor_id, o.codigo); if (vistas.has(k) || !(Number(o.preco) > 0)) continue; vistas.add(k);
      linhas.push({ chave: "av:" + k, fornecedor_id: r.fornecedor_id, fornecedor: nome, codigo: o.codigo || "", marca: o.marca || "", descricao: o.descricao || "", preco: Number(o.preco),
        estoque: o.estoque === null || o.estoque === undefined ? null : Number(o.estoque), prazo: o.prazo || "", origem: "ao_vivo", em: resposta.em || new Date(agora).toISOString(), idade: 0, antigo: false });
    }
    if (!(r.ofertas || []).length) semResposta.push({ fornecedor_id: r.fornecedor_id, fornecedor: nome, motivo: "sem resultado para esse código", no_pc: false, vazio: true });
  }
  // referência: preços informados e última compra dos códigos pesquisados (um por fornecedor + código, sem repetir o que veio ao vivo)
  const chaves = new Set(codigos.map(nc).filter(k => k.length >= 3));
  const ref = [];
  for (const [k, l] of idx) if ([...chaves].some(c => k === c || k.startsWith(c))) for (const o of l) ref.push(o);
  for (const o of ofertasDaLinha(new Map([["x", ref]]), ["x"], agora)) { const k = chaveDe(o.fornecedor_id, o.codigo); if (vistas.has(k)) continue; vistas.add(k); linhas.push({ ...o, menor: false }); }
  let semEstoque = 0, mostradas = linhas;
  if (soComEstoque) { mostradas = linhas.filter(o => o.origem !== "ultima_compra" && o.estoque !== 0); semEstoque = linhas.filter(o => o.origem !== "ultima_compra" && o.estoque === 0).length; }
  mostradas.sort((a, b) => a.preco - b.preco || (a.origem === "ultima_compra" ? 1 : 0) - (b.origem === "ultima_compra" ? 1 : 0) || a.fornecedor.localeCompare(b.fornecedor, "pt-BR"));
  const valem = mostradas.filter(o => o.origem !== "ultima_compra" && !o.antigo && o.estoque !== 0);
  const menor = valem.length && mostradas.length >= 2 ? valem[0] : null;
  return { linhas: mostradas.map(o => ({ ...o, menor: !!menor && o.chave === menor.chave })), semResposta, semEstoque };
}
