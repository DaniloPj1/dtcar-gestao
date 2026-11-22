// DRE gerencial (pedido do Danilo em 22/11/2026, Fase C2 do novo visual): o ano inteiro numa tabela,
// mês a mês, no estilo do protótipo "Painel DTCar". SÓ LEITURA, sem SQL: receita e custo saem do
// relatorio_itens + vendas de balcão (as mesmas contas do relatório Faturamento, regime de competência
// pela entrega) e as despesas saem das CONTAS PAGAS por categoria (regime de caixa). As compras de
// peças pagas aparecem numa linha informativa FORA da conta, porque o custo das peças já está na linha
// "Custo de peças e insumos" — somar as duas cobraria a peça duas vezes.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp } from "../ui.js";
import { reais } from "../util.js";
import { agruparOS, faturadas } from "./relatorios.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const n = v => Number(v) || 0;
const mesDe = s => { const str = String(s || ""); if (!str) return null;
  if (str.length > 10) { const d = new Date(str); return isNaN(d) ? null : d.getMonth(); } // timestamp: mês no fuso daqui
  const m = Number(str.slice(5, 7)); return m >= 1 && m <= 12 ? m - 1 : null; };
const din = v => reais(v).replace("R$ ", "");
/** categoria que é compra de peça/insumo (fica fora da conta do resultado: o custo do item já conta) */
export const ehCompraDePeca = c => /fornecedor|pe[çc]a|insumo|mercadoria/i.test(String(c || ""));

const COLS = "minmax(230px, 1.6fr) repeat(12, minmax(84px, 1fr)) minmax(104px, 1.1fr)";
function Linha({ cls, label, vals }) {
  return html`<div class=${"tf-row " + cls} style=${{ gridTemplateColumns: COLS }}>
    <div class="tf-lab">${label}</div>
    ${vals.map((c, i) => html`<div key=${i} class=${"tf-cel" + (c && c.cls ? " " + c.cls : "")}>${c == null ? "—" : c.v}</div>`)}
  </div>`;
}

export function DRE() {
  const { ir } = useApp();
  const [ano, setAno] = useState(new Date().getFullYear());
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let vivo = true; setD(null); setErro("");
    (async () => {
      const ini = ano + "-01-01", fim = ano + "-12-31";
      const iniISO = new Date(ini + "T00:00:00").toISOString(), fimISO = new Date(new Date(fim + "T00:00:00").getTime() + 86400000).toISOString();
      const [itens, vendas, pagas] = await Promise.all([
        api.relatorioItens(iniISO, fimISO, "entrega"),
        api.vendas && api.vendas.listar ? api.vendas.listar({ de: iniISO, ate: fimISO }).catch(() => []) : [],
        api.contas.listar({ de: ini, ate: fim, campo: "pago_em", status: "paga" }),
      ]);
      if (vivo) setD({ oss: faturadas(agruparOS(itens)), vendas: (vendas || []).filter(v => v.status === "concluida"), pagas: pagas || [] });
    })().catch(e => { if (vivo) { setErro(e.message); setD(false); } });
    return () => { vivo = false; };
  }, [ano]);

  const t = useMemo(() => {
    const zero = () => Array.from({ length: 12 }, () => 0);
    const fat = zero(), custo = zero();
    const cats = new Map(), pecas = zero();
    if (d) {
      for (const o of d.oss) { const m = mesDe(o.entregue_em); if (m != null) { fat[m] += o.total; custo[m] += o.custo; } }
      for (const v of d.vendas) { const m = mesDe(v.criado_em); if (m != null) { fat[m] += n(v.total); custo[m] += n(v.custo); } }
      for (const c of d.pagas) { const m = mesDe(c.pago_em); if (m == null) continue; const v = n(c.valor_pago != null ? c.valor_pago : c.valor);
        if (ehCompraDePeca(c.categoria)) { pecas[m] += v; continue; }
        const k = c.categoria || "Sem categoria"; if (!cats.has(k)) cats.set(k, zero()); cats.get(k)[m] += v; }
    }
    const rb = fat.map((f, i) => f - custo[i]);
    const listaCats = [...cats.entries()].map(([k, vs]) => ({ k, vs, tot: vs.reduce((a, b) => a + b, 0) })).sort((a, b) => b.tot - a.tot);
    const desp = Array.from({ length: 12 }, (_, i) => listaCats.reduce((s, c) => s + c.vs[i], 0));
    const res = rb.map((v, i) => v - desp[i]);
    return { fat, custo, rb, listaCats, desp, res, pecas };
  }, [d]);

  const soma = a => a.reduce((x, y) => x + y, 0);
  const vals = (a, neg, cls) => a.concat([soma(a)]).map(v => v === 0 ? null : { v: (neg && v > 0 ? "−" : "") + din(v), cls: cls || (neg ? "c-bad" : "") });
  const valsPct = a => a.map(v => v == null ? null : { v: v.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + "%", cls: n(v) < 0 ? "c-bad" : "" });

  return html`<div class="pagina pf">
    <div class="painel-topo pf-topo">
      <div><h1>DRE gerencial</h1><span class="sub">Resultado do ano, mês a mês. Receita e custo pela entrega; despesas pelas contas pagas.</span></div>
      <div class="pf-filtros">
        <button type="button" class="btn btn-sm" onClick=${() => ir("/painel-financeiro")}>Painel Financeiro</button>
        <button type="button" class="btn btn-sm" onClick=${() => ir("/fluxo-diario")}>Fluxo diário</button>
        <span class="pf-ano"><button type="button" aria-label="Ano anterior" onClick=${() => setAno(ano - 1)}>◀</button><b>${ano}</b><button type="button" aria-label="Próximo ano" onClick=${() => setAno(ano + 1)}>▶</button></span>
      </div>
    </div>
    ${d === null ? html`<section class="card"><div class="esqueleto"></div></section>`
    : d === false ? html`<div class="erros">Não foi possível carregar: ${erro}</div>`
    : html`<section class="card tf-card">
      <div class="tf-tabela"><div class="tf-min" style=${{ minWidth: "1180px" }}>
        <div class="tf-row tf-cab" style=${{ gridTemplateColumns: COLS }}>
          <div class="tf-lab">Grupo / Categoria</div>
          ${MESES.map(m => html`<div key=${m} class="tf-cel">${m}</div>`)}
          <div class="tf-cel">Total</div>
        </div>
        <${Linha} cls="tf-total" label="Receita bruta (O.S. entregues + balcão)" vals=${vals(t.fat)} />
        <${Linha} cls="tf-sub" label="(−) Custo de peças e insumos dos itens" vals=${vals(t.custo, true)} />
        <${Linha} cls="tf-total" label="Resultado bruto" vals=${vals(t.rb)} />
        ${t.listaCats.length ? html`<${Linha} cls="tf-grupo" label="Despesas pagas no mês, por categoria" vals=${MESES.concat([""]).map(() => ({ v: "" }))} />` : null}
        ${t.listaCats.map(c => html`<${Linha} key=${c.k} cls="tf-sub" label=${"(−) " + c.k} vals=${vals(c.vs, true)} />`)}
        <${Linha} cls="tf-total" label="Total de despesas pagas" vals=${vals(t.desp, true)} />
        <${Linha} cls="tf-final" label="Resultado do mês (aproximado)" vals=${t.res.concat([soma(t.res)]).map(v => ({ v: (v < 0 ? "−" : "") + din(Math.abs(v)), cls: v < 0 ? "tf-neg" : "" }))} />
        <${Linha} cls="tf-margem" label="Margem (resultado ÷ receita)" vals=${valsPct(t.fat.concat([soma(t.fat)]).map((f, i) => { const r = i < 12 ? t.res[i] : soma(t.res); return f ? r / f * 100 : null; }))} />
        ${soma(t.pecas) ? html`<${Linha} cls="tf-info" label="Compras de peças pagas (fora da conta: o custo já está na linha de custo)" vals=${vals(t.pecas)} />` : null}
      </div></div>
      <p class="dica">DRE gerencial, para acompanhar o negócio: a receita e o custo dos itens seguem a data de ENTREGA (competência) e as despesas seguem a data do PAGAMENTO (caixa). As compras de peças pagas no mês ficam fora da soma do resultado, porque o custo das peças vendidas já aparece na linha de custo — senão a peça contaria duas vezes. Impostos, folha e demais contas entram pela categoria do lançamento em Contas a pagar. A DRE oficial é a do contador.</p>
    </section>`}
  </div>`;
}
