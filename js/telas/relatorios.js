// Central de relatórios: histórico de serviços, faturamento, mecânicos, terceiros, clientes,
// produtos vendidos, estoque, fluxo de caixa e contas a pagar. Todos exportam planilha e imprimem.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Seg, Vazio, Placa } from "../ui.js";
import { norm, reais, qtdFmt, hojeISO, fmtData, numOS, exPlaca, normPlaca } from "../util.js";
import { pode, STATUS } from "../regras.js";
import { nomeFavorecido, situacao } from "./financeiro.js";

/* ---------------- catálogo ---------------- */
const RELATORIOS = [
  ["Operação", [
    ["historico", "Histórico de serviços", "O.S. por período, placa, cliente ou mecânico, com os serviços e peças de cada uma."],
    ["mecanicos", "Produtividade dos mecânicos", "O.S. entregues, horas e mão de obra por mecânico."],
    ["terceiros", "Serviços de terceiros", "Custo do prestador, valor cobrado e lucro em cada serviço terceirizado."],
  ]],
  ["Vendas", [
    ["faturamento", "Faturamento e margem", "Mão de obra, peças, terceiros, balcão, custo e margem bruta por dia ou mês."],
    ["vendidos", "Produtos e serviços vendidos", "Quantidade, faturamento e margem de cada item, em O.S. e no balcão."],
    ["clientes", "Clientes que mais compraram", "Faturamento, visitas e ticket médio por cliente."],
  ]],
  ["Financeiro", [
    ["caixa", "Fluxo de caixa", "Entradas das O.S. e do balcão contra as contas pagas, com saldo acumulado.", "financeiro"],
    ["contas", "Contas a pagar", "Contas por vencimento ou pagamento, por categoria e por fornecedor.", "financeiro"],
  ]],
  ["Estoque", [
    ["estoque", "Posição do estoque", "Saldo, valor a custo e a preço de venda, abaixo do mínimo e negativos."],
  ]],
];
const TITULO = Object.fromEntries(RELATORIOS.flatMap(([, l]) => l.map(([k, t]) => [k, t])));

/* ---------------- utilidades ---------------- */
const isoDia = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const diaDe = iso => iso ? isoDia(new Date(iso)) : "";
const n = v => Number(v) || 0;
const valorItem = i => i.fornecida_cliente || i.aprovado === false ? 0 : n(i.qtd) * n(i.valor_unit) - n(i.desconto);
const custoItem = i => i.fornecida_cliente || i.aprovado === false ? 0 : n(i.qtd) * n(i.custo_unit);
const pctF = v => v === null || v === undefined || !isFinite(v) ? "—" : Math.round(v) + "%";
const FMT = { reais: v => reais(v), qtd: v => qtdFmt(v), data: v => v ? fmtData(v) : "—", pct: pctF, txt: v => v ?? "" };
const PERIODOS = [["mes", "Este mês"], ["mesant", "Mês passado"], ["30", "Últimos 30 dias"], ["ano", "Este ano"], ["12m", "12 meses"]];
function intervalo(k) {
  const h = new Date(), a = h.getFullYear(), m = h.getMonth();
  if (k === "mesant") return [isoDia(new Date(a, m - 1, 1)), isoDia(new Date(a, m, 0))];
  if (k === "30") return [isoDia(new Date(a, m, h.getDate() - 29)), isoDia(h)];
  if (k === "ano") return [isoDia(new Date(a, 0, 1)), isoDia(h)];
  if (k === "12m") return [isoDia(new Date(a, m - 11, 1)), isoDia(h)];
  return [isoDia(new Date(a, m, 1)), isoDia(h)];
}
const limites = (de, ate) => [new Date(de + "T00:00:00").toISOString(), new Date(new Date(ate + "T00:00:00").getTime() + 86400000).toISOString()];
const porMes = (de, ate) => (new Date(ate) - new Date(de)) / 86400000 > 62;
const chaveGrupo = (dia, mensal) => mensal ? dia.slice(0, 7) : dia;
const rotGrupo = (k, mensal) => mensal ? new Date(k + "-15T12:00").toLocaleDateString("pt-BR", { month: "short" }).replace(".", "") + "/" + k.slice(2, 4) : fmtData(k).slice(0, 5);

function baixarCSV(nome, cols, linhas, total) {
  const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
  const val = (c, l) => { const v = c.v(l); return c.f === "reais" || c.f === "qtd" ? String(Math.round(n(v) * 1000) / 1000).replace(".", ",") : c.f === "pct" ? (v === null || !isFinite(v) ? "" : String(Math.round(v * 10) / 10).replace(".", ",")) : c.f === "data" ? (v ? fmtData(v) : "") : v ?? ""; };
  const L = [cols.map(c => esc(c.t)).join(";"), ...linhas.map(l => cols.map(c => esc(val(c, l))).join(";"))];
  if (total) L.push(cols.map(c => esc(val(c, total))).join(";"));
  const blob = new Blob(["﻿" + L.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = nome + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}

/** Tabela genérica: cols = [{ t, v: linha => valor, f: "reais"|"qtd"|"data"|"pct"|"txt", sub: linha => texto menor, cls: linha => classe }] */
function Tabela({ cols, linhas, total, limite = 500, vazio = "Nada encontrado com esses filtros." }) {
  const [lim, setLim] = useState(limite);
  if (!linhas.length) return html`<${Vazio}>${vazio}</${Vazio}>`;
  const num = c => ["reais", "qtd", "pct"].includes(c.f);
  return html`<div class="tabela-rolagem"><table class="tab-rel">
    <thead><tr>${cols.map(c => html`<th class=${num(c) ? "num" : ""}>${c.t}</th>`)}</tr></thead>
    <tbody>${linhas.slice(0, lim).map((l, i) => html`<tr key=${i}>${cols.map(c => html`<td class=${(num(c) ? "num" : "") + (c.cls ? " " + (c.cls(l) || "") : "")}>${FMT[c.f || "txt"](c.v(l))}${c.sub && c.sub(l) ? html`<small>${c.sub(l)}</small>` : null}</td>`)}</tr>`)}</tbody>
    ${total ? html`<tfoot><tr>${cols.map((c, i) => html`<td class=${num(c) ? "num" : ""}>${i === 0 ? "Total" : c.v(total) === undefined || c.v(total) === "" ? "" : FMT[c.f || "txt"](c.v(total))}</td>`)}</tr></tfoot>` : null}
  </table></div>${linhas.length > lim ? html`<button type="button" class="btn so-tela" onClick=${() => setLim(lim + 1000)}>Mostrar mais (${linhas.length - lim})</button>` : null}`;
}
function Kpis({ itens }) { return html`<div class="kpis rel-kpis">${itens.filter(Boolean).map(([t, v, s, cls]) => html`<div class=${"kpi" + (cls ? " " + cls : "")}><span>${t}</span><b class="kpi-din">${v}</b>${s ? html`<small>${s}</small>` : null}</div>`)}</div>`; }

/* ---------------- moldura comum (período, filtros, exportar, imprimir) ---------------- */
function Moldura({ chave, de, ate, setPer, filtros, acoesExtra, exportar, children, semPeriodo, legenda }) {
  const { cfg, ir } = useApp();
  const [pk, setPk] = useState("");
  return html`<div class="pagina larga relatorio">
    <div class="painel-topo"><div><button type="button" class="btn-link so-tela" onClick=${() => ir("/relatorios")}>← Relatórios</button><h1>${TITULO[chave]}</h1>
        <span class="sub">${semPeriodo ? "Posição em " + fmtData(hojeISO()) : fmtData(de) + " a " + fmtData(ate)}${legenda ? " · " + legenda : ""}</span></div>
      <div class="acoes so-tela">${acoesExtra}${exportar ? html`<button type="button" class="btn" onClick=${exportar}>Exportar planilha</button>` : null}<button type="button" class="btn btn-pri" onClick=${() => window.print()}>Imprimir</button></div></div>
    <div class="rel-cab-impressao"><b>${cfg.nome}</b><span>${TITULO[chave]} · ${semPeriodo ? "posição em " + fmtData(hojeISO()) : fmtData(de) + " a " + fmtData(ate)} · emitido em ${new Date().toLocaleString("pt-BR")}</span></div>
    ${!semPeriodo || filtros ? html`<section class="card filtros-rel so-tela">
      ${!semPeriodo ? html`<div class="filtros-linha">
        <div class="campo"><label for="rel-de">De</label><input id="rel-de" type="date" class="inp" value=${de} onInput=${e => { if (e.target.value) { setPk(""); setPer(e.target.value, ate); } }} /></div>
        <div class="campo"><label for="rel-ate">Até</label><input id="rel-ate" type="date" class="inp" value=${ate} onInput=${e => { if (e.target.value) { setPk(""); setPer(de, e.target.value); } }} /></div>
        <div class="chips">${PERIODOS.map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (pk === k ? " ativo" : "")} onClick=${() => { setPk(k); setPer(...intervalo(k)); }}>${t}</button>`)}</div></div>` : null}
      ${filtros || null}</section>` : null}
    ${children}
  </div>`;
}
function usePeriodo() {
  const [[de, ate], set] = useState(() => intervalo("mes"));
  return { de, ate, setPer: (a, b) => set([a, b]) };
}
function useCarga(fn, deps) {
  const [d, setD] = useState(null), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true; setD(null); setErro(""); fn().then(x => vivo && setD(x)).catch(e => { if (vivo) { setErro(e.message); setD(false); } }); return () => { vivo = false; }; }, deps);
  return [d, erro];
}
const Carregando = ({ erro }) => erro ? html`<div class="erros">Não foi possível carregar: ${erro}</div>` : html`<section class="card"><div class="esqueleto"></div></section>`;
/** agrupa as linhas da função relatorio_itens por O.S. */
function agruparOS(linhas) {
  const m = new Map();
  for (const l of linhas || []) {
    let o = m.get(l.ordem_id);
    if (!o) { o = { id: l.ordem_id, numero: l.numero, status: l.status, criado_em: l.criado_em, entregue_em: l.entregue_em, cliente_id: l.cliente_id, cliente: l.cliente || "—", placa: l.placa || "", veiculo: l.veiculo || "",
      km: l.km, mecanico: l.mecanico || "", forma: l.forma_pagamento || "", total: n(l.ordem_total), desconto: n(l.ordem_desconto), legado: l.legado, itens: [] }; m.set(l.ordem_id, o); }
    if (l.item_id) o.itens.push(l);
  }
  for (const o of m.values()) {
    const s = t => o.itens.filter(i => i.tipo === t);
    o.servicos = s("servico").reduce((a, i) => a + valorItem(i), 0); o.pecas = s("peca").reduce((a, i) => a + valorItem(i), 0); o.terceiros = s("terceiro").reduce((a, i) => a + valorItem(i), 0);
    o.custo = o.itens.reduce((a, i) => a + (i.tipo === "servico" ? 0 : custoItem(i)), 0); o.horas = s("servico").reduce((a, i) => a + n(i.horas), 0);
  }
  return [...m.values()];
}
const faturadas = l => l.filter(o => ["entregue", "recusado"].includes(o.status) && o.total > 0);

/* =================== relatórios =================== */
function RelHistorico() {
  const { de, ate, setPer } = usePeriodo();
  const [base, setBase] = useState("entrega"), [st, setSt] = useState("todas"), [q, setQ] = useState(""), [det, setDet] = useState(false);
  const [lin, erro] = useCarga(() => api.relatorioItens(...limites(de, ate), base), [de, ate, base]);
  const oss = useMemo(() => agruparOS(lin), [lin]);
  const lista = useMemo(() => { const nq = norm(q), p = normPlaca(q);
    return oss.filter(o => (st === "todas" || (st === "abertas" ? ["diagnostico", "aguardando", "execucao", "pronto"].includes(o.status) : o.status === st))
      && (!nq || norm(o.cliente).includes(nq) || (p.length >= 3 && o.placa.includes(p)) || norm(o.mecanico).includes(nq) || norm(o.veiculo).includes(nq) || o.itens.some(i => norm(i.descricao).includes(nq)) || String(o.numero) === q.trim()))
      .sort((a, b) => (base === "entrega" ? (b.entregue_em || "").localeCompare(a.entregue_em || "") : b.criado_em.localeCompare(a.criado_em))); }, [oss, st, q, base]);
  const itens = useMemo(() => lista.flatMap(o => o.itens.map(i => ({ ...i, _o: o }))), [lista]);
  const descServ = o => o.itens.filter(i => i.tipo !== "peca" && i.aprovado !== false).map(i => i.descricao).join("; ");
  const colsOS = [
    { t: "O.S.", v: o => numOS(o.numero).replace("OS ", ""), sub: o => o.legado ? "sist. anterior" : "" },
    { t: base === "entrega" ? "Entrega" : "Abertura", v: o => diaDe(base === "entrega" ? o.entregue_em : o.criado_em), f: "data" },
    { t: "Placa", v: o => exPlaca(o.placa) }, { t: "Veículo", v: o => o.veiculo }, { t: "Cliente", v: o => o.cliente }, { t: "Mecânico", v: o => o.mecanico },
    { t: "Serviços", v: o => descServ(o), cls: () => "col-larga" }, { t: "Peças", v: o => o.pecas, f: "reais" }, { t: "Mão de obra", v: o => o.servicos + o.terceiros, f: "reais" },
    { t: "Total", v: o => o.total, f: "reais" }, { t: "Situação", v: o => (STATUS[o.status] || {}).curto || o.status },
  ];
  const colsIt = [{ t: "O.S.", v: i => String(i._o.numero).padStart(5, "0") }, { t: "Data", v: i => diaDe(base === "entrega" ? i._o.entregue_em : i._o.criado_em), f: "data" }, { t: "Placa", v: i => exPlaca(i._o.placa) },
    { t: "Cliente", v: i => i._o.cliente }, { t: "Tipo", v: i => ({ servico: "Serviço", peca: "Peça", terceiro: "Terceiro" }[i.tipo]) }, { t: "Descrição", v: i => i.descricao, sub: i => i.aprovado === false ? "não aprovado" : i.fornecida_cliente ? "peça do cliente" : "" },
    { t: "Qtd.", v: i => i.qtd, f: "qtd" }, { t: "Valor", v: i => valorItem(i), f: "reais" }];
  const tot = { numero: "", total: lista.reduce((s, o) => s + o.total, 0), pecas: lista.reduce((s, o) => s + o.pecas, 0), servicos: lista.reduce((s, o) => s + o.servicos, 0), terceiros: lista.reduce((s, o) => s + o.terceiros, 0), itens: [] };
  const exportar = () => det ? baixarCSV("historico-itens-" + de + "-a-" + ate, colsIt, itens) : baixarCSV("historico-os-" + de + "-a-" + ate, colsOS, lista, tot);
  return html`<${Moldura} chave="historico" de=${de} ate=${ate} setPer=${setPer} exportar=${exportar} legenda=${lista.length + " O.S."}
    filtros=${html`<div class="filtros-linha"><input id="rel-q" class="inp" type="search" placeholder="Placa, cliente, mecânico, veículo, serviço ou nº" value=${q} onInput=${e => setQ(e.target.value)} />
      <${Seg} rotulo="Data" opcoes=${[["Por entrega", "info"], ["Por abertura", "info"]]} valor=${base === "entrega" ? "Por entrega" : "Por abertura"} onEscolha=${v => setBase(v === "Por entrega" ? "entrega" : "abertura")} /></div>
      <div class="filtros-linha"><div class="chips">${[["todas", "Todas"], ["entregue", "Entregues"], ["abertas", "Abertas"], ["recusado", "Recusadas"], ["cancelado", "Canceladas"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (st === k ? " ativo" : "")} onClick=${() => setSt(k)}>${t}</button>`)}</div>
      <label class="linha-check"><input type="checkbox" checked=${det} onChange=${e => setDet(e.target.checked)} /><span>Mostrar item por item</span></label></div>`}>
    ${!lin ? html`<${Carregando} erro=${erro} />` : html`
      <${Kpis} itens=${[["O.S.", lista.length], ["Faturado", reais(tot.total), "soma das O.S. listadas", "kpi-forte"], ["Mão de obra", reais(tot.servicos)], ["Peças", reais(tot.pecas)], tot.terceiros ? ["Terceiros", reais(tot.terceiros)] : null]} />
      <section class="card">${det ? html`<${Tabela} cols=${colsIt} linhas=${itens} />` : html`<${Tabela} cols=${colsOS} linhas=${lista} total=${tot} />`}</section>
      <p class="dica so-tela">Itens não aprovados e peças fornecidas pelo cliente aparecem com valor zero.</p>`}
  </${Moldura}>`;
}

function RelFaturamento() {
  const { de, ate, setPer } = usePeriodo(); const mensal = porMes(de, ate);
  const [d, erro] = useCarga(async () => { const [a, b] = limites(de, ate); const [lin, vendas] = await Promise.all([api.relatorioItens(a, b, "entrega"), api.vendas.listar({ de: a, ate: b })]); return { oss: faturadas(agruparOS(lin)), vendas: vendas.filter(v => v.status === "concluida") }; }, [de, ate]);
  const linhas = useMemo(() => { if (!d) return [];
    const g = new Map(), pega = k => { if (!g.has(k)) g.set(k, { k, os: 0, servicos: 0, pecas: 0, terceiros: 0, desconto: 0, totalOS: 0, balcao: 0, custo: 0 }); return g.get(k); };
    for (const o of d.oss) { const x = pega(chaveGrupo(diaDe(o.entregue_em), mensal)); x.os++; x.servicos += o.servicos; x.pecas += o.pecas; x.terceiros += o.terceiros; x.desconto += o.desconto; x.totalOS += o.total; x.custo += o.custo; }
    for (const v of d.vendas) { const x = pega(chaveGrupo(diaDe(v.criado_em), mensal)); x.balcao += n(v.total); x.custo += n(v.custo); }
    return [...g.values()].map(x => ({ ...x, total: x.totalOS + x.balcao, margem: x.totalOS + x.balcao - x.custo })).sort((a, b) => a.k.localeCompare(b.k)); }, [d, mensal]);
  const tot = linhas.reduce((t, x) => { for (const k of ["os", "servicos", "pecas", "terceiros", "desconto", "totalOS", "balcao", "custo", "total", "margem"]) t[k] += x[k]; return t; }, { k: "", os: 0, servicos: 0, pecas: 0, terceiros: 0, desconto: 0, totalOS: 0, balcao: 0, custo: 0, total: 0, margem: 0 });
  const cols = [{ t: mensal ? "Mês" : "Dia", v: x => x.k ? rotGrupo(x.k, mensal) : "" }, { t: "O.S.", v: x => x.os, f: "qtd" }, { t: "Mão de obra", v: x => x.servicos, f: "reais" }, { t: "Peças", v: x => x.pecas, f: "reais" },
    { t: "Terceiros", v: x => x.terceiros, f: "reais" }, { t: "Desc. O.S.", v: x => -x.desconto, f: "reais" }, { t: "Total O.S.", v: x => x.totalOS, f: "reais" }, { t: "Balcão", v: x => x.balcao, f: "reais" },
    { t: "Faturamento", v: x => x.total, f: "reais" }, { t: "Custo", v: x => x.custo, f: "reais" }, { t: "Margem bruta", v: x => x.margem, f: "reais" }, { t: "%", v: x => x.total ? x.margem / x.total * 100 : null, f: "pct" }];
  const formas = useMemo(() => { if (!d) return []; const g = new Map(); const add = (f, v) => g.set(f || "Não informado", (g.get(f || "Não informado") || 0) + v);
    d.oss.forEach(o => add(o.forma, o.total)); d.vendas.forEach(v => add(v.forma_pagamento, n(v.total))); return [...g.entries()].sort((a, b) => b[1] - a[1]); }, [d]);
  const semCusto = d ? d.oss.reduce((s, o) => s + o.itens.filter(i => i.tipo === "peca" && valorItem(i) > 0 && !n(i.custo_unit)).reduce((a, i) => a + valorItem(i), 0), 0) : 0;
  return html`<${Moldura} chave="faturamento" de=${de} ate=${ate} setPer=${setPer} exportar=${() => baixarCSV("faturamento-" + de + "-a-" + ate, cols, linhas, tot)} legenda=${mensal ? "por mês" : "por dia"}>
    ${!d ? html`<${Carregando} erro=${erro} />` : html`
      <${Kpis} itens=${[["Faturamento", reais(tot.total), tot.os + " O.S. e " + d.vendas.length + " venda(s) de balcão", "kpi-forte"], ["Margem bruta", reais(tot.margem), pctF(tot.total ? tot.margem / tot.total * 100 : null) + " do faturamento"],
        ["Ticket médio O.S.", reais(tot.os ? tot.totalOS / tot.os : 0)], semCusto > tot.pecas * 0.2 ? ["Peças sem custo", reais(semCusto), "margem superestimada", "alerta-kpi"] : null]} />
      <section class="card"><${Tabela} cols=${cols} linhas=${linhas} total=${tot} vazio="Nenhuma O.S. entregue ou venda no período." /></section>
      ${formas.length ? html`<section class="card"><h3>Por forma de pagamento</h3><ul class="ranking">${formas.map(([f, v]) => html`<li key=${f}><span>${f}</span><b>${reais(v)}</b><small>${pctF(tot.total ? v / tot.total * 100 : 0)}</small></li>`)}</ul></section>` : null}
      <p class="dica">Faturamento é pela data de entrega da O.S. e da venda de balcão. Margem bruta = faturamento − custo de peças e terceiros; ainda faltam impostos, salários, aluguel e taxas de cartão.</p>`}
  </${Moldura}>`;
}

function RelMecanicos() {
  const { de, ate, setPer } = usePeriodo();
  const [lin, erro] = useCarga(() => api.relatorioItens(...limites(de, ate), "entrega"), [de, ate]);
  const linhas = useMemo(() => { const g = new Map();
    for (const o of faturadas(agruparOS(lin)).filter(o => o.status === "entregue")) { const k = o.mecanico || "Sem mecânico definido"; const x = g.get(k) || { k, os: 0, horas: 0, servicos: 0, pecas: 0, total: 0 };
      x.os++; x.horas += o.horas; x.servicos += o.servicos; x.pecas += o.pecas; x.total += o.total; g.set(k, x); }
    return [...g.values()].sort((a, b) => b.servicos - a.servicos); }, [lin]);
  const tot = linhas.reduce((t, x) => ({ k: "", os: t.os + x.os, horas: t.horas + x.horas, servicos: t.servicos + x.servicos, pecas: t.pecas + x.pecas, total: t.total + x.total }), { k: "", os: 0, horas: 0, servicos: 0, pecas: 0, total: 0 });
  const cols = [{ t: "Mecânico", v: x => x.k }, { t: "O.S. entregues", v: x => x.os, f: "qtd" }, { t: "Horas lançadas", v: x => x.horas, f: "qtd" }, { t: "Mão de obra", v: x => x.servicos, f: "reais" },
    { t: "Peças", v: x => x.pecas, f: "reais" }, { t: "Total das O.S.", v: x => x.total, f: "reais" }, { t: "Mão de obra por O.S.", v: x => x.os ? x.servicos / x.os : 0, f: "reais" }];
  return html`<${Moldura} chave="mecanicos" de=${de} ate=${ate} setPer=${setPer} exportar=${() => baixarCSV("mecanicos-" + de + "-a-" + ate, cols, linhas, tot)}>
    ${!lin ? html`<${Carregando} erro=${erro} />` : html`<section class="card"><${Tabela} cols=${cols} linhas=${linhas} total=${tot} vazio="Nenhuma O.S. entregue no período." /></section>
      <p class="dica">Considera o mecânico responsável pela O.S. Horas só aparecem nos serviços cobrados por hora.</p>`}
  </${Moldura}>`;
}

function RelTerceiros() {
  const { dados } = useApp(); const { de, ate, setPer } = usePeriodo();
  const [base, setBase] = useState("entrega");
  const [lin, erro] = useCarga(() => api.relatorioItens(...limites(de, ate), base), [de, ate, base]);
  const itens = useMemo(() => (lin || []).filter(l => l.tipo === "terceiro" && l.aprovado !== false && !["cancelado"].includes(l.status)).map(l => {
    const f = l.fornecedor_id && dados.fornecedores.find(x => x.id === l.fornecedor_id); const v = valorItem(l), c = custoItem(l);
    return { ...l, prest: f ? f.fantasia || f.razao : l.fornecedor || "Não informado", v, c, lucro: v - c }; }).sort((a, b) => (a.entregue_em || a.criado_em || "").localeCompare(b.entregue_em || b.criado_em || "")), [lin]);
  const porPrest = useMemo(() => { const g = new Map(); for (const i of itens) { const x = g.get(i.prest) || { k: i.prest, n: 0, c: 0, v: 0 }; x.n++; x.c += i.c; x.v += i.v; g.set(i.prest, x); } return [...g.values()].sort((a, b) => b.c - a.c); }, [itens]);
  const tot = { numero: "", c: itens.reduce((s, i) => s + i.c, 0), v: itens.reduce((s, i) => s + i.v, 0) }; tot.lucro = tot.v - tot.c;
  const cols = [{ t: "Data", v: i => diaDe(base === "entrega" ? i.entregue_em : i.criado_em), f: "data" }, { t: "O.S.", v: i => i.numero ? String(i.numero).padStart(5, "0") : "" }, { t: "Placa", v: i => exPlaca(i.placa) },
    { t: "Cliente", v: i => i.cliente }, { t: "Serviço", v: i => i.descricao, sub: i => i.status !== "entregue" ? (STATUS[i.status] || {}).curto : "" }, { t: "Prestador", v: i => i.prest },
    { t: "Custo", v: i => i.c, f: "reais" }, { t: "Cobrado", v: i => i.v, f: "reais" }, { t: "Lucro", v: i => i.lucro, f: "reais", cls: i => i.lucro < 0 ? "c-bad" : "" }, { t: "Margem", v: i => i.c ? i.lucro / i.c * 100 : null, f: "pct" }];
  return html`<${Moldura} chave="terceiros" de=${de} ate=${ate} setPer=${setPer} exportar=${() => baixarCSV("terceiros-" + de + "-a-" + ate, cols, itens, tot)}
    filtros=${html`<${Seg} rotulo="Data" opcoes=${[["Por entrega", "info"], ["Por abertura", "info"]]} valor=${base === "entrega" ? "Por entrega" : "Por abertura"} onEscolha=${v => setBase(v === "Por entrega" ? "entrega" : "abertura")} />`}>
    ${!lin ? html`<${Carregando} erro=${erro} />` : html`
      <${Kpis} itens=${[["Serviços", itens.length], ["Pago aos prestadores", reais(tot.c)], ["Cobrado dos clientes", reais(tot.v), "", "kpi-forte"], ["Lucro da oficina", reais(tot.lucro), pctF(tot.c ? tot.lucro / tot.c * 100 : null) + " sobre o custo"]]} />
      ${porPrest.length > 1 ? html`<section class="card"><h3>Por prestador</h3><ul class="ranking">${porPrest.map(x => html`<li key=${x.k}><span>${x.k} · ${x.n} serviço(s)</span><b>${reais(x.c)}</b><small>lucro ${reais(x.v - x.c)}</small></li>`)}</ul></section>` : null}
      <section class="card"><${Tabela} cols=${cols} linhas=${itens} total=${tot} vazio="Nenhum serviço de terceiro no período." /></section>`}
  </${Moldura}>`;
}

function RelClientes() {
  const { dados } = useApp(); const { de, ate, setPer } = usePeriodo();
  const [d, erro] = useCarga(async () => { const [a, b] = limites(de, ate); const [lin, vendas] = await Promise.all([api.relatorioItens(a, b, "entrega"), api.vendas.listar({ de: a, ate: b })]); return { oss: faturadas(agruparOS(lin)), vendas: vendas.filter(v => v.status === "concluida") }; }, [de, ate]);
  const linhas = useMemo(() => { if (!d) return []; const g = new Map();
    const pega = (id, nome) => { const k = id || "n:" + norm(nome); if (!g.has(k)) { const c = id && dados.clientes.find(x => x.id === id); g.set(k, { k, nome: c ? c.nome : nome || "Consumidor", tel: c ? c.telefone : "", os: 0, balcao: 0, valor: 0, ult: "" }); } return g.get(k); };
    for (const o of d.oss) { const x = pega(o.cliente_id, o.cliente); x.os++; x.valor += o.total; const dt = diaDe(o.entregue_em); if (dt > x.ult) x.ult = dt; }
    for (const v of d.vendas) { const x = pega(v.cliente_id, (v.cliente || {}).nome); x.balcao++; x.valor += n(v.total); const dt = diaDe(v.criado_em); if (dt > x.ult) x.ult = dt; }
    return [...g.values()].sort((a, b) => b.valor - a.valor); }, [d]);
  const tot = linhas.reduce((t, x) => ({ nome: "", os: t.os + x.os, balcao: t.balcao + x.balcao, valor: t.valor + x.valor, ult: "" }), { nome: "", os: 0, balcao: 0, valor: 0, ult: "" });
  const cols = [{ t: "#", v: x => x.nome ? linhas.indexOf(x) + 1 : "" }, { t: "Cliente", v: x => x.nome }, { t: "O.S.", v: x => x.os, f: "qtd" }, { t: "Balcão", v: x => x.balcao, f: "qtd" },
    { t: "Faturamento", v: x => x.valor, f: "reais" }, { t: "Ticket médio", v: x => (x.os + x.balcao) ? x.valor / (x.os + x.balcao) : 0, f: "reais" }, { t: "Última compra", v: x => x.ult, f: "data" }, { t: "% do total", v: x => tot.valor ? x.valor / tot.valor * 100 : null, f: "pct" }];
  const top10 = linhas.slice(0, 10).reduce((s, x) => s + x.valor, 0);
  return html`<${Moldura} chave="clientes" de=${de} ate=${ate} setPer=${setPer} exportar=${() => baixarCSV("clientes-" + de + "-a-" + ate, cols, linhas, tot)}>
    ${!d ? html`<${Carregando} erro=${erro} />` : html`<${Kpis} itens=${[["Clientes atendidos", linhas.length], ["Faturamento", reais(tot.valor), "", "kpi-forte"], ["10 maiores clientes", pctF(tot.valor ? top10 / tot.valor * 100 : null), "do faturamento"]]} />
      <section class="card"><${Tabela} cols=${cols} linhas=${linhas} total=${tot} /></section>`}
  </${Moldura}>`;
}

function RelVendidos() {
  const { de, ate, setPer } = usePeriodo();
  const [origem, setOrigem] = useState("todas"), [tipo, setTipo] = useState("produto"), [q, setQ] = useState(""), [ordem, setOrdem] = useState("valor");
  const [linhas, erro] = useCarga(() => api.relatorioVendidos(...limites(de, ate)), [de, ate]);
  const dados = useMemo(() => {
    const g = new Map();
    for (const l of linhas || []) {
      if (origem !== "todas" && l.origem !== origem) continue;
      if (tipo !== "todos" && l.tipo !== tipo) continue;
      if (q && !norm(l.descricao).includes(norm(q)) && !norm(l.referencia).includes(norm(q)) && String(l.codigo) !== q.trim()) continue;
      const k = l.produto_id || "d:" + norm(l.descricao) + l.tipo;
      const x = g.get(k) || { ...l, qtd: 0, valor: 0, custo: 0, vezes: 0, os: 0, balcao: 0 };
      x.qtd += n(l.qtd); x.valor += n(l.valor); x.custo += n(l.custo); x.vezes += n(l.vezes); x[l.origem === "os" ? "os" : "balcao"] += n(l.qtd); g.set(k, x);
    }
    const l = [...g.values()].map(x => ({ ...x, margem: x.custo > 0 && x.valor ? (x.valor - x.custo) / x.valor * 100 : null }));
    const f = { valor: (a, b) => b.valor - a.valor, qtd: (a, b) => b.qtd - a.qtd, margem: (a, b) => (b.margem ?? -999) - (a.margem ?? -999), descricao: (a, b) => a.descricao.localeCompare(b.descricao) }[ordem];
    return l.sort(f);
  }, [linhas, origem, tipo, q, ordem]);
  const tot = dados.reduce((t, x) => ({ codigo: "", descricao: "", qtd: t.qtd + x.qtd, os: t.os + x.os, balcao: t.balcao + x.balcao, valor: t.valor + x.valor, custo: t.custo + x.custo, comCusto: t.comCusto + (x.custo > 0 ? x.valor : 0) }), { codigo: "", descricao: "", qtd: 0, os: 0, balcao: 0, valor: 0, custo: 0, comCusto: 0 });
  tot.margem = tot.comCusto ? (tot.comCusto - tot.custo) / tot.comCusto * 100 : null;
  const cols = [{ t: "Cód.", v: x => x.codigo || "" }, { t: "Descrição", v: x => x.descricao, sub: x => [x.referencia, x.descricao && !x.produto_id ? "sem cadastro" : ""].filter(Boolean).join(" · ") }, { t: "Qtd.", v: x => x.qtd, f: "qtd" },
    { t: "Em O.S.", v: x => x.os, f: "qtd" }, { t: "Balcão", v: x => x.balcao, f: "qtd" }, { t: "Faturamento", v: x => x.valor, f: "reais" }, { t: "Custo", v: x => x.custo, f: "reais" },
    { t: "Margem", v: x => x.margem, f: "pct", cls: x => x.margem !== null && x.margem < 20 ? "c-bad" : "" }];
  return html`<${Moldura} chave="vendidos" de=${de} ate=${ate} setPer=${setPer} exportar=${() => baixarCSV("vendidos-" + de + "-a-" + ate, cols, dados, tot)}
    filtros=${html`<div class="filtros-linha"><input id="rel-q" class="inp" type="search" placeholder="Descrição, código ou referência" value=${q} onInput=${e => setQ(e.target.value)} />
      <select id="rel-ord" class="inp inp-cat" aria-label="Ordenar por" value=${ordem} onChange=${e => setOrdem(e.target.value)}>${[["valor", "Maior faturamento"], ["qtd", "Maior quantidade"], ["margem", "Maior margem"], ["descricao", "Descrição"]].map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></div>
      <div class="filtros-linha"><${Seg} rotulo="Tipo" opcoes=${[["Produtos", "info"], ["Serviços", "info"], ["Tudo", "info"]]} valor=${{ produto: "Produtos", servico: "Serviços", todos: "Tudo" }[tipo]} onEscolha=${v => setTipo({ Produtos: "produto", Serviços: "servico", Tudo: "todos" }[v])} />
      <${Seg} rotulo="Origem" opcoes=${[["O.S. e balcão", "info"], ["Só O.S.", "info"], ["Só balcão", "info"]]} valor=${{ todas: "O.S. e balcão", os: "Só O.S.", balcao: "Só balcão" }[origem]} onEscolha=${v => setOrigem({ "O.S. e balcão": "todas", "Só O.S.": "os", "Só balcão": "balcao" }[v])} /></div>`}>
    ${!linhas ? html`<${Carregando} erro=${erro} />` : html`
      <${Kpis} itens=${[["Itens diferentes", dados.length], ["Quantidade vendida", qtdFmt(tot.qtd)], ["Faturamento", reais(tot.valor), "", "kpi-forte"], ["Margem bruta", pctF(tot.margem), tot.comCusto < tot.valor * 0.8 ? "Custo lançado em " + Math.round(tot.comCusto / (tot.valor || 1) * 100) + "% do faturamento" : "nos itens com custo"]]} />
      <section class="card"><${Tabela} cols=${cols} linhas=${dados} total=${tot} /></section>
      <p class="dica">Considera O.S. entregues (pela data de entrega) e vendas de balcão concluídas. Peças fornecidas pelo cliente e itens não aprovados ficam de fora.</p>`}
  </${Moldura}>`;
}

function RelEstoque() {
  const { dados } = useApp();
  const [f, setF] = useState("todos"), [grupo, setGrupo] = useState(""), [q, setQ] = useState("");
  const grupos = useMemo(() => [...new Set(dados.produtos.filter(p => p.tipo === "produto").map(p => p.categoria).filter(Boolean))].sort(), [dados.produtos]);
  const lista = useMemo(() => dados.produtos.filter(p => p.tipo === "produto" && p.ativo !== false && p.controla_estoque && (!grupo || p.categoria === grupo)
    && (!q || norm(p.descricao).includes(norm(q)) || norm(p.referencia).includes(norm(q)) || norm(p.marca).includes(norm(q)))
    && (f === "todos" || (f === "saldo" ? n(p.estoque_atual) > 0 : f === "minimo" ? n(p.estoque_min) > 0 && n(p.estoque_atual) <= n(p.estoque_min) : f === "negativo" ? n(p.estoque_atual) < 0 : n(p.estoque_atual) > 0 && !n(p.custo))))
    .sort((a, b) => a.descricao.localeCompare(b.descricao)), [dados.produtos, f, grupo, q]);
  const tot = lista.reduce((t, p) => ({ descricao: "", est: t.est + Math.max(0, n(p.estoque_atual)), vc: t.vc + Math.max(0, n(p.estoque_atual)) * n(p.custo), vv: t.vv + Math.max(0, n(p.estoque_atual)) * n(p.preco_vista) }), { descricao: "", est: 0, vc: 0, vv: 0 });
  const cols = [{ t: "Cód.", v: p => p.codigo ?? "" }, { t: "Descrição", v: p => p.descricao, sub: p => [p.referencia, p.marca, p.localizacao ? "local " + p.localizacao : ""].filter(Boolean).join(" · ") }, { t: "Grupo", v: p => p.categoria || "" },
    { t: "Estoque", v: p => p.descricao ? n(p.estoque_atual) : tot.est, f: "qtd", cls: p => n(p.estoque_atual) < 0 ? "c-bad" : "" }, { t: "Un.", v: p => p.unidade || "" }, { t: "Mínimo", v: p => p.descricao ? n(p.estoque_min) : "", f: "qtd" },
    { t: "Custo", v: p => p.descricao ? n(p.custo) : "", f: "reais" }, { t: "Valor a custo", v: p => p.descricao ? Math.max(0, n(p.estoque_atual)) * n(p.custo) : tot.vc, f: "reais" },
    { t: "Preço à vista", v: p => p.descricao ? n(p.preco_vista) : "", f: "reais" }, { t: "Valor a preço de venda", v: p => p.descricao ? Math.max(0, n(p.estoque_atual)) * n(p.preco_vista) : tot.vv, f: "reais" }];
  const semCusto = dados.produtos.filter(p => p.tipo === "produto" && p.ativo !== false && n(p.estoque_atual) > 0 && !n(p.custo)).length;
  return html`<${Moldura} chave="estoque" semPeriodo exportar=${() => baixarCSV("estoque-" + hojeISO(), cols, lista, tot)}
    filtros=${html`<div class="filtros-linha"><input id="rel-q" class="inp" type="search" placeholder="Descrição, referência ou marca" value=${q} onInput=${e => setQ(e.target.value)} />
      <select class="inp inp-cat" aria-label="Grupo" value=${grupo} onChange=${e => setGrupo(e.target.value)}><option value="">Todos os grupos</option>${grupos.map(x => html`<option value=${x}>${x}</option>`)}</select></div>
      <div class="chips">${[["todos", "Todos"], ["saldo", "Com saldo"], ["minimo", "No mínimo ou abaixo"], ["negativo", "Negativos"], ["semcusto", "Com saldo e sem custo"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (f === k ? " ativo" : "")} onClick=${() => setF(k)}>${t}</button>`)}</div>`}>
    <${Kpis} itens=${[["Produtos", lista.length], ["Estoque a custo", reais(tot.vc), "", "kpi-forte"], ["Estoque a preço de venda", reais(tot.vv)], semCusto ? ["Com saldo e sem custo", semCusto, "valor a custo subestimado", "alerta-kpi"] : null]} />
    <section class="card"><${Tabela} cols=${cols} linhas=${lista} total=${tot} /></section>
  </${Moldura}>`;
}

function RelCaixa() {
  const { de, ate, setPer } = usePeriodo(); const mensal = porMes(de, ate);
  const [d, erro] = useCarga(async () => { const [a, b] = limites(de, ate);
    const [lin, vendas, pagas, aVencer] = await Promise.all([api.relatorioItens(a, b, "entrega"), api.vendas.listar({ de: a, ate: b }), api.contas.listar({ de, ate, campo: "pago_em", status: "paga" }), api.contas.listar({ de, ate, campo: "vencimento", status: "aberta" })]);
    return { oss: faturadas(agruparOS(lin)), vendas: vendas.filter(v => v.status === "concluida"), pagas, aVencer }; }, [de, ate]);
  const linhas = useMemo(() => { if (!d) return []; const g = new Map(), pega = k => { if (!g.has(k)) g.set(k, { k, os: 0, balcao: 0, saidas: 0, previsto: 0 }); return g.get(k); };
    d.oss.forEach(o => { pega(chaveGrupo(diaDe(o.entregue_em), mensal)).os += o.total; });
    d.vendas.forEach(v => { pega(chaveGrupo(diaDe(v.criado_em), mensal)).balcao += n(v.total); });
    d.pagas.forEach(c => { pega(chaveGrupo(c.pago_em, mensal)).saidas += n(c.valor_pago ?? c.valor); });
    d.aVencer.forEach(c => { pega(chaveGrupo(c.vencimento, mensal)).previsto += n(c.valor); });
    let acc = 0; return [...g.values()].sort((a, b) => a.k.localeCompare(b.k)).map(x => { const saldo = x.os + x.balcao - x.saidas; acc += saldo; return { ...x, entradas: x.os + x.balcao, saldo, acumulado: acc }; }); }, [d, mensal]);
  const tot = linhas.reduce((t, x) => ({ k: "", os: t.os + x.os, balcao: t.balcao + x.balcao, entradas: t.entradas + x.entradas, saidas: t.saidas + x.saidas, saldo: t.saldo + x.saldo, previsto: t.previsto + x.previsto, acumulado: "" }), { k: "", os: 0, balcao: 0, entradas: 0, saidas: 0, saldo: 0, previsto: 0, acumulado: "" });
  const cols = [{ t: mensal ? "Mês" : "Dia", v: x => x.k ? rotGrupo(x.k, mensal) : "" }, { t: "O.S. entregues", v: x => x.os, f: "reais" }, { t: "Balcão", v: x => x.balcao, f: "reais" }, { t: "Entradas", v: x => x.entradas, f: "reais" },
    { t: "Contas pagas", v: x => -x.saidas, f: "reais" }, { t: "Saldo", v: x => x.saldo, f: "reais", cls: x => x.saldo < 0 ? "c-bad" : "" }, { t: "Acumulado", v: x => x.acumulado, f: "reais", cls: x => x.acumulado < 0 ? "c-bad" : "" },
    { t: "Contas em aberto que vencem", v: x => x.previsto, f: "reais" }];
  const porCat = useMemo(() => { if (!d) return []; const g = new Map(); d.pagas.forEach(c => g.set(c.categoria || "Sem categoria", (g.get(c.categoria || "Sem categoria") || 0) + n(c.valor_pago ?? c.valor))); return [...g.entries()].sort((a, b) => b[1] - a[1]); }, [d]);
  return html`<${Moldura} chave="caixa" de=${de} ate=${ate} setPer=${setPer} exportar=${() => baixarCSV("fluxo-de-caixa-" + de + "-a-" + ate, cols, linhas, tot)} legenda=${mensal ? "por mês" : "por dia"}>
    ${!d ? html`<${Carregando} erro=${erro} />` : html`
      <${Kpis} itens=${[["Entradas", reais(tot.entradas), "O.S. entregues e balcão"], ["Saídas", reais(tot.saidas), d.pagas.length + " conta(s) paga(s)"], ["Saldo do período", reais(tot.saldo), "", tot.saldo < 0 ? "alerta-kpi" : "kpi-forte"], tot.previsto ? ["Em aberto no período", reais(tot.previsto), "contas que vencem e não foram pagas", "kpi-aviso"] : null]} />
      <section class="card"><${Tabela} cols=${cols} linhas=${linhas} total=${tot} vazio="Sem movimento no período." /></section>
      ${porCat.length ? html`<section class="card"><h3>Saídas por categoria</h3><ul class="ranking">${porCat.map(([k, v]) => html`<li key=${k}><span>${k}</span><b>${reais(v)}</b><small>${pctF(tot.saidas ? v / tot.saidas * 100 : 0)}</small></li>`)}</ul></section>` : null}
      <p class="dica">Entradas: total das O.S. na data de entrega e das vendas de balcão na data da venda, como se tudo fosse recebido na hora. Vendas a prazo e taxas de cartão não estão descontadas. Saídas: contas pagas na data do pagamento. Despesas pagas sem lançar em Contas a pagar não aparecem.</p>`}
  </${Moldura}>`;
}

function RelContas() {
  const { dados } = useApp(); const { de, ate, setPer } = usePeriodo();
  const [campo, setCampo] = useState("vencimento"), [st, setSt] = useState("todas");
  const [l, erro] = useCarga(() => api.contas.listar({ de, ate, campo }), [de, ate, campo]);
  const lista = useMemo(() => (l || []).filter(c => st === "todas" ? c.status !== "cancelada" : c.status === st).sort((a, b) => (a[campo] || "").localeCompare(b[campo] || "")), [l, st, campo]);
  const agrupa = f => { const g = new Map(); lista.forEach(c => g.set(f(c), (g.get(f(c)) || 0) + n(c.status === "paga" ? c.valor_pago ?? c.valor : c.valor))); return [...g.entries()].sort((a, b) => b[1] - a[1]); };
  const tot = { descricao: "", valor: lista.reduce((s, c) => s + n(c.valor), 0), pago: lista.filter(c => c.status === "paga").reduce((s, c) => s + n(c.valor_pago ?? c.valor), 0) };
  const cols = [{ t: "Vencimento", v: c => c.vencimento, f: "data" }, { t: "Fornecedor / favorecido", v: c => !c.vencimento ? "" : nomeFavorecido(c, dados.fornecedores) }, { t: "Descrição", v: c => c.descricao, sub: c => c.parcelas > 1 ? "parcela " + c.parcela + "/" + c.parcelas : "" },
    { t: "Categoria", v: c => c.categoria || "" }, { t: "Documento", v: c => c.documento || "" }, { t: "Valor", v: c => c.valor ?? tot.valor, f: "reais" },
    { t: "Situação", v: c => c.status ? situacao(c).t : "", cls: c => c.status ? "c-" + situacao(c).cor : "" }, { t: "Pago em", v: c => c.pago_em || "", f: "data" }, { t: "Valor pago", v: c => c.status === "paga" ? c.valor_pago ?? c.valor : c.status ? "" : tot.pago, f: "reais" }];
  const pc = agrupa(c => c.categoria || "Sem categoria"), pf = agrupa(c => nomeFavorecido(c, dados.fornecedores));
  return html`<${Moldura} chave="contas" de=${de} ate=${ate} setPer=${setPer} exportar=${() => baixarCSV("contas-" + de + "-a-" + ate, cols, lista, tot)}
    filtros=${html`<div class="filtros-linha"><${Seg} rotulo="Data" opcoes=${[["Por vencimento", "info"], ["Por pagamento", "info"]]} valor=${campo === "vencimento" ? "Por vencimento" : "Por pagamento"} onEscolha=${v => setCampo(v === "Por vencimento" ? "vencimento" : "pago_em")} />
      <div class="chips">${[["todas", "Todas"], ["aberta", "Em aberto"], ["paga", "Pagas"], ["cancelada", "Canceladas"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (st === k ? " ativo" : "")} onClick=${() => setSt(k)}>${t}</button>`)}</div></div>`}>
    ${!l ? html`<${Carregando} erro=${erro} />` : html`
      <${Kpis} itens=${[["Contas", lista.length], ["Valor", reais(tot.valor), "", "kpi-forte"], ["Pago", reais(tot.pago)], ["Em aberto", reais(lista.filter(c => c.status === "aberta").reduce((s, c) => s + n(c.valor), 0))]]} />
      ${lista.length ? html`<div class="rel-duas"><section class="card"><h3>Por categoria</h3><ul class="ranking">${pc.map(([k, v]) => html`<li key=${k}><span>${k}</span><b>${reais(v)}</b></li>`)}</ul></section>
        <section class="card"><h3>Por fornecedor</h3><ul class="ranking">${pf.slice(0, 12).map(([k, v]) => html`<li key=${k}><span>${k}</span><b>${reais(v)}</b></li>`)}</ul></section></div>` : null}
      <section class="card"><${Tabela} cols=${cols} linhas=${lista} total=${tot} vazio="Nenhuma conta no período." /></section>`}
  </${Moldura}>`;
}

const TELAS = { historico: RelHistorico, faturamento: RelFaturamento, mecanicos: RelMecanicos, terceiros: RelTerceiros, clientes: RelClientes, vendidos: RelVendidos, estoque: RelEstoque, caixa: RelCaixa, contas: RelContas };

export function Relatorios({ params = {} }) {
  const { perfil, ir } = useApp();
  const Tela = TELAS[params.r];
  const fin = pode(perfil, "financeiro");
  if (Tela && (fin || !["caixa", "contas"].includes(params.r))) return html`<${Tela} key=${params.r} />`;
  return html`<div class="pagina larga relatorios-hub">
    <div class="painel-topo"><div><h1>Relatórios</h1><span class="sub">Todos podem ser filtrados, impressos e exportados para planilha.</span></div></div>
    ${RELATORIOS.map(([g, l]) => { const vis = l.filter(r => !r[3] || pode(perfil, r[3])); return vis.length ? html`<section key=${g} class="hub-grupo"><h2>${g}</h2><div class="hub-cartoes">
      ${vis.map(([k, t, d]) => html`<button type="button" key=${k} class="hub-cartao" onClick=${() => ir("/relatorios?r=" + k)}><strong>${t}</strong><span>${d}</span></button>`)}
      ${g === "Financeiro" && fin ? html`<button type="button" class="hub-cartao" onClick=${() => ir("/recibos")}><strong>Recibos emitidos</strong><span>Recibos de pagamento por mês, com totais por forma de pagamento.</span></button>` : null}</div></section>` : null; })}
  </div>`;
}
