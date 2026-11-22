// Inteligência do Negócio (pedido do Danilo em 22/11/2026, Fase C2 do novo visual): o ano em análise,
// no estilo do protótipo "Painel DTCar". SÓ LEITURA, sem SQL: recebimentos e pagamentos pelo caixa,
// receita por serviço e por peça pelos itens das O.S. entregues (relatorio_itens), gastos por categoria
// e por favorecido pelas contas pagas, e a receber × a pagar pelos vencimentos em aberto.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Vazio } from "../ui.js";
import { reais } from "../util.js";
import { valorItem } from "./relatorios.js";
import { nomeFavorecido } from "./financeiro.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const n = v => Number(v) || 0;
const mesDe = s => { const m = Number(String(s || "").slice(5, 7)); return m >= 1 && m <= 12 ? m - 1 : null; };

function Ranking({ itens, cor, vazio }) {
  if (!itens.length) return html`<${Vazio} texto=${vazio} />`;
  const maior = itens[0].v || 1;
  return html`<div class="pf-cats">${itens.map(x => html`<div class="pf-cat" key=${x.k}>
    <span class="pf-cat-n" title=${x.k}>${x.k}</span>
    <span class="pf-cat-b"><i style=${{ width: Math.max(2, Math.round(x.v / maior * 100)) + "%", background: cor }}></i><b>${reais(x.v)}</b></span>
  </div>`)}</div>`;
}

export function Inteligencia() {
  const { ir, dados } = useApp();
  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true; setD(null); setErro("");
    (async () => {
      const ini = ano + "-01-01", fim = ano + "-12-31";
      const iniISO = new Date(ini + "T00:00:00").toISOString(), fimISO = new Date(new Date(fim + "T00:00:00").getTime() + 86400000).toISOString();
      const [recibos, pagas, itens, abertas, parcelas] = await Promise.all([
        api.recibos.listar({ de: ini, ate: fim }),
        api.contas.listar({ de: ini, ate: fim, campo: "pago_em", status: "paga" }),
        api.relatorioItens(iniISO, fimISO, "entrega"),
        api.contas.abertas().catch(() => []),
        api.receber && api.receber.listar ? api.receber.listar({ status: "aberta" }).catch(() => []) : [],
      ]);
      if (vivo) setD({ recibos: (recibos || []).filter(r => !r.cancelado), pagas: pagas || [], itens: itens || [], abertas: abertas || [], parcelas: parcelas || [] });
    })().catch(e => { if (vivo) { setErro(e.message); setD(false); } });
    return () => { vivo = false; };
  }, [ano]);

  const t = useMemo(() => {
    if (!d) return null;
    const soma = a => a.reduce((x, y) => x + y, 0);
    const rec = soma(d.recibos.map(r => n(r.valor)));
    const pag = soma(d.pagas.map(c => n(c.valor_pago != null ? c.valor_pago : c.valor)));
    const rank = mapa => [...mapa.entries()].map(([k, v]) => ({ k, v })).filter(x => x.v > 0).sort((a, b) => b.v - a.v).slice(0, 8);
    const serv = new Map(), pecas = new Map(), cats = new Map(), quem = new Map();
    for (const i of d.itens) { if (!i.item_id) continue; const v = valorItem(i);
      if (i.tipo === "servico") serv.set(i.descricao || "Sem descrição", (serv.get(i.descricao || "Sem descrição") || 0) + v);
      if (i.tipo === "peca") pecas.set(i.descricao || "Sem descrição", (pecas.get(i.descricao || "Sem descrição") || 0) + v); }
    for (const c of d.pagas) { const v = n(c.valor_pago != null ? c.valor_pago : c.valor);
      cats.set(c.categoria || "Sem categoria", (cats.get(c.categoria || "Sem categoria") || 0) + v);
      const f = nomeFavorecido(c, (dados && dados.fornecedores) || []); quem.set(f, (quem.get(f) || 0) + v); }
    // a receber × a pagar: próximos 6 meses pelos vencimentos em aberto
    const chave = s => String(s || "").slice(0, 7);
    const meses6 = Array.from({ length: 6 }, (_, i) => { const x = new Date(agora.getFullYear(), agora.getMonth() + i, 1); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0"); });
    const receber6 = meses6.map(m => soma(d.parcelas.filter(p => chave(p.vencimento) === m).map(p => n(p.valor - (p.pago || 0)))));
    const pagar6 = meses6.map(m => soma(d.abertas.filter(c => chave(c.vencimento) === m).map(c => n(c.valor))));
    return { rec, pag, ger: rec - pag, margem: rec ? (rec - pag) / rec * 100 : 0,
      servicos: rank(serv), pecas: rank(pecas), cats: rank(cats), quem: rank(quem), meses6, receber6, pagar6 };
  }, [d, dados]);

  const linha6 = useMemo(() => {
    if (!t) return null;
    const vals = t.receber6.concat(t.pagar6); const hi = Math.max(1, ...vals);
    const x = i => 20 + i * (520 / 5), y = v => 150 - v / hi * 125;
    const pts = a => a.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" ");
    return { receber: pts(t.receber6), pagar: pts(t.pagar6) };
  }, [t]);

  const rot = m => MESES[Number(m.slice(5, 7)) - 1] + "/" + m.slice(2, 4);

  return html`<div class="pagina pf">
    <div class="painel-topo pf-topo">
      <div><h1>Inteligência do Negócio</h1><span class="sub">O ano em análise: de onde vem a receita, para onde vai o gasto e o que vem pela frente.</span></div>
      <div class="pf-filtros">
        <button type="button" class="btn btn-sm" onClick=${() => ir("/painel-financeiro")}>Painel Financeiro</button>
        <button type="button" class="btn btn-sm" onClick=${() => ir("/dre")}>DRE</button>
        <span class="pf-ano"><button type="button" aria-label="Ano anterior" onClick=${() => setAno(ano - 1)}>◀</button><b>${ano}</b><button type="button" aria-label="Próximo ano" onClick=${() => setAno(ano + 1)}>▶</button></span>
      </div>
    </div>
    ${!t && d !== false ? html`<section class="card"><div class="esqueleto"></div></section>`
    : d === false ? html`<div class="erros">Não foi possível carregar: ${erro}</div>`
    : html`
    <div class="pf-linha">
      <section class="pf-grupo pf-estreita">
        <h3 class="pf-rotulo">Análise de ${ano} · regime de caixa</h3>
        <div class="pf-kpis pf-kpis-col">
          <div class="pf-kpi pf-ok"><div><span>Recebimentos</span><b>${reais(t.rec)}</b></div></div>
          <div class="pf-kpi pf-bad"><div><span>Pagamentos</span><b>${reais(t.pag)}</b></div></div>
          <div class="pf-kpi pf-az8"><div><span>Geração de caixa</span><b>${reais(t.ger)}</b></div></div>
        </div>
        <div class="card pf-margem-caixa">
          <span class="pf-rotulo">Margem de fluxo de caixa</span>
          <svg class="pf-anel pf-anel-g" viewBox="0 0 40 40" role="img" aria-label=${Math.round(t.margem) + " por cento de margem de caixa"}>
            <circle cx="20" cy="20" r="16" fill="none" stroke="var(--line)" stroke-width="5"></circle>
            <circle cx="20" cy="20" r="16" fill="none" stroke="var(--ok)" stroke-width="5" pathLength="100" stroke-dasharray=${Math.max(0, Math.min(100, Math.round(t.margem))) + " " + (100 - Math.max(0, Math.min(100, Math.round(t.margem))))} transform="rotate(-90 20 20)"></circle>
            <text x="20" y="24" text-anchor="middle">${Math.round(t.margem)}%</text>
          </svg>
          <span class="dica">geração de caixa ÷ recebimentos</span>
        </div>
      </section>
      <section class="card pf-card pf-larga">
        <h3 class="pf-rotulo">Receita por serviço · O.S. entregues em ${ano}</h3>
        <${Ranking} itens=${t.servicos} cor="var(--ok)" vazio="Nenhum serviço em O.S. entregue no ano." />
        <h3 class="pf-rotulo pf-sep">Receita por peça</h3>
        <${Ranking} itens=${t.pecas} cor="var(--ok)" vazio="Nenhuma peça em O.S. entregue no ano." />
      </section>
    </div>
    <div class="pf-linha">
      <section class="card pf-card">
        <h3 class="pf-rotulo">Gastos por categoria · ${ano}</h3>
        <${Ranking} itens=${t.cats} cor="var(--bad)" vazio="Nenhuma conta paga no ano." />
      </section>
      <section class="card pf-card">
        <h3 class="pf-rotulo">Gastos por favorecido · ${ano}</h3>
        <${Ranking} itens=${t.quem} cor="var(--bad)" vazio="Nenhuma conta paga no ano." />
      </section>
    </div>
    <div class="pf-linha">
      <section class="card pf-card">
        <div class="pf-cab"><h3 class="pf-rotulo">A receber × a pagar · próximos 6 meses (em aberto)</h3>
          <div class="pf-legenda"><span><i class="pf-q pf-q-ok"></i>A receber (parcelas)</span><span><i class="pf-q pf-q-bad"></i>A pagar (contas)</span></div></div>
        <svg class="pf-svg" viewBox="0 0 560 170" preserveAspectRatio="none" role="img" aria-label="Parcelas a receber e contas a pagar em aberto, mês a mês, nos próximos seis meses">
          <line x1="0" y1="150" x2="560" y2="150" class="pf-eixo"></line>
          <polyline points=${linha6.receber} class="pf-serie pf-serie-ok"></polyline>
          <polyline points=${linha6.pagar} class="pf-serie pf-serie-bad"></polyline>
        </svg>
        <div class="pf-eixo-x">${t.meses6.map(m => html`<span key=${m}>${rot(m)}</span>`)}</div>
        <p class="dica">Parcelas a receber das O.S. entregues e contas a pagar em aberto, pelo vencimento. Conta vencida e não paga não aparece aqui — ela está nos selos de Contas a pagar e a receber.</p>
      </section>
    </div>`}
  </div>`;
}
