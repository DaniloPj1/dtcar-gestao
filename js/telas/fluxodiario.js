// Fluxo de Caixa Diário (pedido do Danilo em 22/11/2026, Fase C2 do novo visual): o mês dia a dia,
// no estilo do protótipo "Painel DTCar". SÓ LEITURA, sem SQL: entradas = recibos (pela data do recibo)
// + vendas de balcão concluídas (pela data da venda), separadas por forma de pagamento; saídas =
// contas pagas (pela data do pagamento), por categoria; saldo do dia e saldo acumulado no mês.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp } from "../ui.js";
import { reais } from "../util.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const DIAS_SEM = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const n = v => Number(v) || 0;
const diaDe = (s, ano, mes) => { const str = String(s || ""); if (!str) return null;
  if (str.length > 10) { const d = new Date(str); return isNaN(d) || d.getFullYear() !== ano || d.getMonth() !== mes ? null : d.getDate() - 1; } // timestamp: dia no fuso daqui (fora do mês: fica de fora)
  const d = Number(str.slice(8, 10)); return d >= 1 ? d - 1 : null; };
const din = v => reais(v).replace("R$ ", "");

export function FluxoDiario() {
  const { ir } = useApp();
  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [mes, setMes] = useState(agora.getMonth());
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const dias = new Date(ano, mes + 1, 0).getDate();
  const mudaMes = passo => { const x = new Date(ano, mes + passo, 1); setAno(x.getFullYear()); setMes(x.getMonth()); };

  useEffect(() => {
    let vivo = true; setD(null); setErro("");
    (async () => {
      const ini = new Date(ano, mes, 1), fim = new Date(ano, mes, dias);
      const iso = x => x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0");
      const iniISO = new Date(iso(ini) + "T00:00:00").toISOString(), fimISO = new Date(new Date(iso(fim) + "T00:00:00").getTime() + 86400000).toISOString();
      const [recibos, pagas, vendas] = await Promise.all([
        api.recibos.listar({ de: iso(ini), ate: iso(fim) }),
        api.contas.listar({ de: iso(ini), ate: iso(fim), campo: "pago_em", status: "paga" }),
        api.vendas && api.vendas.listar ? api.vendas.listar({ de: iniISO, ate: fimISO }).catch(() => []) : [],
      ]);
      const rs = (recibos || []).filter(r => !r.cancelado);
      const conc = (vendas || []).filter(v => v.status === "concluida");
      // venda com recibo entra pelo recibo, não duas vezes — e o recibo pode estar noutro mês (achados do Codex, 22/11/2026)
      const comRecibo = new Set(api.recibos.dasVendas ? await api.recibos.dasVendas(conc.map(v => v.id)).catch(() => rs.map(r => r.venda_id).filter(Boolean)) : rs.map(r => r.venda_id).filter(Boolean));
      if (vivo) setD({ recibos: rs, pagas: pagas || [], vendas: conc.filter(v => !comRecibo.has(v.id)) });
    })().catch(e => { if (vivo) { setErro(e.message); setD(false); } });
    return () => { vivo = false; };
  }, [ano, mes]);

  const t = useMemo(() => {
    const zero = () => Array.from({ length: dias }, () => 0);
    const formas = new Map(), cats = new Map();
    const poe = (mapa, k, dia, v) => { if (!mapa.has(k)) mapa.set(k, zero()); mapa.get(k)[dia] += v; };
    if (d) {
      for (const r of d.recibos) { const dia = diaDe(r.data || r.criado_em, ano, mes); if (dia != null && dia < dias) poe(formas, r.forma || "Sem forma informada", dia, n(r.valor)); }
      for (const v of d.vendas) { const dia = diaDe(v.criado_em, ano, mes); if (dia != null && dia < dias) poe(formas, v.forma_pagamento ? v.forma_pagamento + " (balcão)" : "Balcão", dia, n(v.total)); }
      for (const c of d.pagas) { const dia = diaDe(c.pago_em, ano, mes); if (dia != null && dia < dias) poe(cats, c.categoria || "Sem categoria", dia, n(c.valor_pago != null ? c.valor_pago : c.valor)); }
    }
    const somaDe = mapa => Array.from({ length: dias }, (_, i) => [...mapa.values()].reduce((s, vs) => s + vs[i], 0));
    const entra = somaDe(formas), sai = somaDe(cats);
    const saldo = entra.map((e, i) => e - sai[i]);
    let acc = 0; const acum = saldo.map(s => (acc += s));
    const lista = mapa => [...mapa.entries()].map(([k, vs]) => ({ k, vs, tot: vs.reduce((a, b) => a + b, 0) })).sort((a, b) => b.tot - a.tot);
    return { formas: lista(formas), cats: lista(cats), entra, sai, saldo, acum };
  }, [d, dias, ano, mes]);

  const COLS = "minmax(210px, 1.4fr) repeat(" + dias + ", minmax(76px, 1fr))";
  const Linha = ({ cls, label, vals }) => html`<div class=${"tf-row " + cls} style=${{ gridTemplateColumns: COLS }}>
    <div class="tf-lab">${label}</div>
    ${vals.map((c, i) => html`<div key=${i} class=${"tf-cel" + (c && c.cls ? " " + c.cls : "")}>${c == null ? "—" : c.v}</div>`)}
  </div>`;
  const vals = (a, cls) => a.map(v => v === 0 ? null : { v: din(v), cls: cls || "" });

  return html`<div class="pagina pf">
    <div class="painel-topo pf-topo">
      <div><h1>Fluxo de Caixa Diário</h1><span class="sub">O caixa dia a dia: recibos e vendas de balcão entrando, contas pagas saindo.</span></div>
      <div class="pf-filtros">
        <button type="button" class="btn btn-sm" onClick=${() => ir("/painel-financeiro")}>Painel Financeiro</button>
        <button type="button" class="btn btn-sm" onClick=${() => ir("/dre")}>DRE</button>
        <span class="pf-ano"><button type="button" aria-label="Ano anterior" onClick=${() => setAno(ano - 1)}>◀</button><b>${ano}</b><button type="button" aria-label="Próximo ano" onClick=${() => setAno(ano + 1)}>▶</button></span>
        <span class="pf-ano"><button type="button" aria-label="Mês anterior" onClick=${() => mudaMes(-1)}>◀</button><b>${MESES[mes]}</b><button type="button" aria-label="Próximo mês" onClick=${() => mudaMes(1)}>▶</button></span>
      </div>
    </div>
    ${d === null ? html`<section class="card"><div class="esqueleto"></div></section>`
    : d === false ? html`<div class="erros">Não foi possível carregar: ${erro}</div>`
    : html`
    <section class="card tf-card">
      <div class="tf-tabela"><div style=${{ minWidth: (210 + dias * 78) + "px" }}>
        <div class="tf-row tf-cab" style=${{ gridTemplateColumns: COLS }}>
          <div class="tf-lab">Grupo / Forma ou categoria</div>
          ${Array.from({ length: dias }, (_, i) => html`<div key=${i} class="tf-cel">${DIAS_SEM[new Date(ano, mes, i + 1).getDay()]} ${i + 1}</div>`)}
        </div>
        <${Linha} cls="tf-grupo" label="Entradas" vals=${Array.from({ length: dias }, () => ({ v: "" }))} />
        ${t.formas.length ? t.formas.map(f => html`<${Linha} key=${f.k} cls="tf-sub" label=${f.k} vals=${vals(f.vs)} />`) : html`<${Linha} cls="tf-sub" label="Nenhuma entrada no mês" vals=${Array.from({ length: dias }, () => null)} />`}
        <${Linha} cls="tf-total" label="Total de entradas" vals=${vals(t.entra, "c-ok")} />
        <${Linha} cls="tf-grupo" label="Saídas" vals=${Array.from({ length: dias }, () => ({ v: "" }))} />
        ${t.cats.length ? t.cats.map(c => html`<${Linha} key=${c.k} cls="tf-sub" label=${c.k} vals=${vals(c.vs, "c-bad")} />`) : html`<${Linha} cls="tf-sub" label="Nenhuma conta paga no mês" vals=${Array.from({ length: dias }, () => null)} />`}
        <${Linha} cls="tf-total" label="Total de saídas" vals=${vals(t.sai, "c-bad")} />
        <${Linha} cls="tf-total" label="Saldo do dia (entradas − saídas)" vals=${t.saldo.map(v => v === 0 ? null : { v: (v > 0 ? "+" : "−") + din(Math.abs(v)), cls: v < 0 ? "c-bad" : "c-ok" })} />
        <${Linha} cls="tf-final" label="Saldo acumulado no mês" vals=${t.acum.map(v => ({ v: (v < 0 ? "−" : "") + din(Math.abs(v)), cls: v < 0 ? "tf-neg" : "" }))} />
      </div></div>
      <p class="dica">Recibos entram pela data do recibo; venda de balcão sem recibo, pela data da venda (com recibo, ela entra pelo recibo — uma vez só); contas pela data do pagamento. O saldo acumulado começa do zero no dia 1º — o saldo real de cada conta fica na Previsão de caixa.</p>
    </section>
    <section class="card tf-card">
      <h3 class="pf-rotulo">Entradas por forma de pagamento · ${MESES[mes]} de ${ano}</h3>
      ${t.formas.length ? html`<div class="tf-tiles">${t.formas.map(f => html`<div class="tf-tile" key=${f.k}><span>${f.k}</span><b>${reais(f.tot)}</b></div>`)}</div>` : html`<p class="dica">Nenhuma entrada no mês.</p>`}
    </section>`}
  </div>`;
}
