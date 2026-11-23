// Números do ano para o Painel e o Painel Financeiro — FONTE ÚNICA (pedido do Danilo em 23/11/2026).
// Antes, cada tela carregava e somava por conta própria; com os mesmos números em dois lugares, qualquer
// diferença de regra viraria divergência na cara do dono. Aqui ficam a carga e as contas; as telas só desenham.
// Regras (as mesmas que já valiam):
//   entradas = recibos não cancelados + venda de balcão concluída SEM recibo (o recibo pode vir noutro mês ou ano)
//   saídas   = contas pagas (valor_pago quando houver)
//   faturamento e custo = itens das O.S. entregues (relatorio_itens, competência) + vendas de balcão
// Sem window/document: roda em qualquer tela. NÃO grava nada.
import { api } from "./api.js";

export const n = v => Number(v) || 0;

/** Mês (0–11) de uma data do banco: timestamp vira mês no fuso daqui; data pura é lida pelo texto. */
export const mesDe = s => { const str = String(s || ""); if (!str) return null;
  if (str.length > 10) { const d = new Date(str); return isNaN(d) ? null : d.getMonth(); }
  const m = Number(str.slice(5, 7)); return m >= 1 && m <= 12 ? m - 1 : null; };

/** Dia (1–31) de uma data do banco, no mesmo critério do mês. */
export const diaDe = s => { const str = String(s || ""); if (!str) return null;
  if (str.length > 10) { const d = new Date(str); return isNaN(d) ? null : d.getDate(); }
  const d = Number(str.slice(8, 10)); return d >= 1 && d <= 31 ? d : null; };

/** Compra de peça, insumo ou serviço de terceiro: o custo dela já está no custo do item da O.S. */
export const ehCompraDePeca = c => /fornecedor|pe[çc]a|insumo|mercadoria|terceir|prestador/i.test(String(c || ""));

/** Carrega o ano inteiro uma vez. Devolve as listas já filtradas pelas regras acima. */
export async function carregarAno(ano, cfg, { agruparOS, faturadas }) {
  const ini = ano + "-01-01", fim = ano + "-12-31";
  const iniISO = new Date(ini + "T00:00:00").toISOString(), fimISO = new Date(new Date(fim + "T00:00:00").getTime() + 86400000).toISOString();
  const [recibos, pagas, itens, vendas, saldos] = await Promise.all([
    api.recibos.desde ? api.recibos.desde(ini) : api.recibos.listar({ de: ini, ate: fim }),
    api.contas.listar({ de: ini, ate: fim, campo: "pago_em", status: "paga" }),
    api.relatorioItens(iniISO, fimISO, "entrega"),
    api.vendas && (api.vendas.periodo || api.vendas.listar) ? (api.vendas.periodo || api.vendas.listar)({ de: iniISO, ate: fimISO }).catch(() => []) : [],
    cfg && cfg.contasFinanceiras && cfg.contasFinanceiras.length && api.saldosContas ? api.saldosContas().catch(() => null) : null,
  ]);
  const rs = (recibos || []).filter(r => !r.cancelado && String(r.data || r.criado_em || "").slice(0, 10) <= fim);
  const conc = (vendas || []).filter(v => v.status === "concluida");
  const comRecibo = new Set(api.recibos.dasVendas
    ? await api.recibos.dasVendas(conc.map(v => v.id)).catch(() => rs.map(r => r.venda_id).filter(Boolean))
    : rs.map(r => r.venda_id).filter(Boolean));
  return { recibos: rs, pagas: pagas || [], oss: faturadas(agruparOS(itens)), vendas: conc,
    vendasCaixa: conc.filter(v => !comRecibo.has(v.id)), saldos };
}

/** Os quatro vetores de 12 meses: entradas e saídas (caixa), faturamento e custo (competência). */
export function porMes(d) {
  const zero = () => Array.from({ length: 12 }, () => 0);
  const entra = zero(), sai = zero(), fat = zero(), custo = zero();
  if (d) {
    for (const r of d.recibos) { const m = mesDe(r.data || r.criado_em); if (m != null) entra[m] += n(r.valor); }
    for (const c of d.pagas) { const m = mesDe(c.pago_em); if (m != null) sai[m] += n(c.valor_pago != null ? c.valor_pago : c.valor); }
    for (const o of d.oss) { const m = mesDe(o.entregue_em); if (m != null) { fat[m] += o.total; custo[m] += o.custo; } }
    for (const v of d.vendas) { const m = mesDe(v.criado_em); if (m != null) { fat[m] += n(v.total); custo[m] += n(v.custo); } }
    for (const v of d.vendasCaixa) { const m = mesDe(v.criado_em); if (m != null) entra[m] += n(v.total); }
  }
  return { entra, sai, fat, custo };
}

const ordena = m => [...m.entries()].map(([nome, v]) => ({ nome, v })).sort((a, b) => b.v - a.v);

/** Para onde foi o dinheiro no mês: categorias, quem recebeu dentro de cada uma, e as peças por fornecedor.
 *  "Subcategoria" aqui é quem recebeu dentro da categoria — é o nível que o sistema guarda hoje. */
export function gastosDoMes(pagas, fornecedores, mes, nomeFavorecido) {
  const cats = new Map(), dentro = new Map(), pecas = new Map();
  let total = 0;
  for (const c of pagas || []) {
    if (mes != null && mesDe(c.pago_em) !== mes) continue;
    const v = n(c.valor_pago != null ? c.valor_pago : c.valor); if (!v) continue;
    total += v;
    const cat = c.categoria || "Sem categoria";
    cats.set(cat, (cats.get(cat) || 0) + v);
    const quem = nomeFavorecido(c, fornecedores || []);
    if (!dentro.has(cat)) dentro.set(cat, new Map());
    dentro.get(cat).set(quem, (dentro.get(cat).get(quem) || 0) + v);
    if (ehCompraDePeca(c.categoria)) pecas.set(quem, (pecas.get(quem) || 0) + v);
  }
  return {
    total,
    categorias: ordena(cats),
    subcategorias: ordena(cats).map(c => ({ nome: c.nome, v: c.v, itens: ordena(dentro.get(c.nome) || new Map()) })),
    pecasPorFornecedor: ordena(pecas),
    totalPecas: [...pecas.values()].reduce((s, v) => s + v, 0),
  };
}
