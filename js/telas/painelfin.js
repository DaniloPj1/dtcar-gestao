// Painel Financeiro (pedido do Danilo em 22/11/2026): visão do ano e do mês no estilo do protótipo "Painel DTCar",
// com as cores do app em tonalidades. SÓ LEITURA: nada aqui grava O.S., estoque ou financeiro (a única gravação é a
// meta mensal de entradas, guardada em cfg.metaEntradas pela tabela config — sem SQL novo).
// Os números vêm das mesmas contas das telas que já existem: entradas = recibos (regime de caixa), saídas = contas
// pagas, faturamento/custo = relatorio_itens + vendas de balcão (os mesmos do relatório Faturamento) e o saldo atual
// = saldos_contas() (o mesmo da Previsão de caixa). Nenhuma tela, filtro ou função existente foi alterada por esta.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Vazio } from "../ui.js";
import { reais, parseValor } from "../util.js";
import { pode } from "../regras.js";
import { agruparOS, faturadas } from "./relatorios.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_EXT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const n = v => Number(v) || 0;
const mesDe = s => { const m = Number(String(s || "").slice(5, 7)); return m >= 1 && m <= 12 ? m - 1 : null; };

/** Anel de percentual com o número dentro (o rótulo do cartão fica sempre escrito ao lado). */
function Anel({ pct, cor, trilha, texto }) {
  const p = Math.max(0, Math.min(100, Math.round(n(pct))));
  return html`<svg class="pf-anel" viewBox="0 0 40 40" role="img" aria-label=${p + " por cento"}>
    <circle cx="20" cy="20" r="16" fill="none" stroke=${trilha || "rgba(255,255,255,0.35)"} stroke-width="5"></circle>
    <circle cx="20" cy="20" r="16" fill="none" stroke=${cor || "#ffffff"} stroke-width="5" pathLength="100" stroke-dasharray=${p + " " + (100 - p)} transform="rotate(-90 20 20)"></circle>
    <text x="20" y="24" text-anchor="middle">${texto != null ? texto : p + "%"}</text>
  </svg>`;
}

export function PainelFinanceiro() {
  const { cfg, perfil, avisar, recarregar, ir } = useApp();
  const agora = new Date();
  const [ano, setAno] = useState(agora.getFullYear());
  const [mes, setMes] = useState(agora.getMonth());
  const [d, setD] = useState(null);
  const [erro, setErro] = useState("");
  const [metaTxt, setMetaTxt] = useState(null); // null = sem edição em andamento
  const [salvandoMeta, setSalvandoMeta] = useState(false);

  useEffect(() => {
    let vivo = true; setD(null); setErro("");
    (async () => {
      const ini = ano + "-01-01", fim = ano + "-12-31";
      const iniISO = new Date(ini + "T00:00:00").toISOString(), fimISO = new Date(new Date(fim + "T00:00:00").getTime() + 86400000).toISOString();
      const [recibos, pagas, itens, vendas, saldos] = await Promise.all([
        api.recibos.listar({ de: ini, ate: fim }),
        api.contas.listar({ de: ini, ate: fim, campo: "pago_em", status: "paga" }),
        api.relatorioItens(iniISO, fimISO, "entrega"),
        api.vendas && api.vendas.listar ? api.vendas.listar({ de: iniISO, ate: fimISO }).catch(() => []) : [],
        cfg.contasFinanceiras && cfg.contasFinanceiras.length && api.saldosContas ? api.saldosContas().catch(() => null) : null,
      ]);
      if (vivo) setD({ recibos: (recibos || []).filter(r => !r.cancelado), pagas: pagas || [], oss: faturadas(agruparOS(itens)), vendas: (vendas || []).filter(v => v.status === "concluida"), saldos });
    })().catch(e => { if (vivo) { setErro(e.message); setD(false); } });
    return () => { vivo = false; };
  }, [ano]);

  const t = useMemo(() => {
    const zero = () => Array.from({ length: 12 }, () => 0);
    const entra = zero(), sai = zero(), fat = zero(), custo = zero();
    if (d) {
      for (const r of d.recibos) { const m = mesDe(r.data || r.criado_em); if (m != null) entra[m] += n(r.valor); }
      for (const c of d.pagas) { const m = mesDe(c.pago_em); if (m != null) sai[m] += n(c.valor_pago != null ? c.valor_pago : c.valor); }
      for (const o of d.oss) { const m = mesDe(o.entregue_em); if (m != null) { fat[m] += o.total; custo[m] += o.custo; } }
      for (const v of d.vendas) { const m = mesDe(v.criado_em); if (m != null) { fat[m] += n(v.total); custo[m] += n(v.custo); } }
    }
    const saldo = entra.map((e, i) => e - sai[i]);
    let acc = 0; const acum = saldo.map(s => (acc += s));
    const margem = fat.map((f, i) => f - custo[i]);
    return { entra, sai, fat, custo, saldo, acum, margem };
  }, [d]);

  const ultimo = ano === agora.getFullYear() ? agora.getMonth() : ano < agora.getFullYear() ? 11 : -1;
  const saldoAtual = d && d.saldos ? d.saldos.reduce((s, c) => s + n(c.atual), 0) : null;
  const meta = n(cfg.metaEntradas);
  const pctCusto = t.fat[mes] ? t.custo[mes] / t.fat[mes] * 100 : 0;
  const pctMargem = t.fat[mes] ? t.margem[mes] / t.fat[mes] * 100 : 0;
  const catsMes = useMemo(() => { if (!d) return [];
    const g = new Map();
    for (const c of d.pagas) if (mesDe(c.pago_em) === mes) { const k = c.categoria || "Sem categoria"; g.set(k, (g.get(k) || 0) + n(c.valor_pago != null ? c.valor_pago : c.valor)); }
    return [...g.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8); }, [d, mes]);
  const maiorCat = catsMes.length ? catsMes[0][1] : 0;
  const maiorBarra = Math.max(1, ...t.entra, ...t.sai);
  const salvarMeta = async () => {
    const v = parseValor(metaTxt); setSalvandoMeta(true);
    try { await api.salvarConfig({ ...cfg, metaEntradas: v || 0 }); await recarregar(["config"]); setMetaTxt(null); avisar(v ? "Meta de entradas salva." : "Meta de entradas removida."); }
    catch (e) { avisar(e.message, true); } finally { setSalvandoMeta(false); }
  };

  // pontos da linha do saldo acumulado (até o último mês com dado no ano)
  const linha = useMemo(() => {
    const fimLinha = ultimo < 0 ? -1 : ultimo;
    if (fimLinha < 0) return null;
    const vals = t.acum.slice(0, fimLinha + 1);
    const lo = Math.min(0, ...vals), hi = Math.max(1, ...vals);
    const x = i => fimLinha === 0 ? 280 : 20 + i * (520 / fimLinha);
    const y = v => 165 - (v - lo) / (hi - lo || 1) * 140;
    return { pts: vals.map((v, i) => x(i).toFixed(1) + "," + y(v).toFixed(1)).join(" "), fim: fimLinha, x, y, vals };
  }, [t, ultimo]);

  const Chip = ({ i }) => html`<button type="button" class="pf-mes" aria-pressed=${i === mes ? "true" : "false"} onClick=${() => setMes(i)}>${MESES[i]}</button>`;

  return html`<div class="pagina pf">
    <div class="painel-topo pf-topo">
      <div><h1>Painel Financeiro</h1><span class="sub">Entradas e saídas pelo caixa; faturamento e custo pelas O.S. entregues e vendas de balcão.</span></div>
      <div class="pf-filtros">
        <button type="button" class="btn btn-sm" onClick=${() => ir("/dre")}>DRE</button>
        <button type="button" class="btn btn-sm" onClick=${() => ir("/fluxo-diario")}>Fluxo diário</button>
        <button type="button" class="btn btn-sm" onClick=${() => ir("/inteligencia")}>Inteligência</button>
        <span class="pf-ano"><button type="button" aria-label="Ano anterior" onClick=${() => setAno(ano - 1)}>◀</button><b>${ano}</b><button type="button" aria-label="Próximo ano" onClick=${() => setAno(ano + 1)}>▶</button></span>
        <span class="pf-meses">${MESES.map((_, i) => html`<${Chip} key=${i} i=${i} />`)}</span>
      </div>
    </div>
    ${d === null ? html`<section class="card"><div class="esqueleto"></div></section>`
    : d === false ? html`<div class="erros">Não foi possível carregar: ${erro}</div>`
    : html`
    <div class="pf-grupos">
      <section class="pf-grupo">
        <h3 class="pf-rotulo">Fluxo de caixa · ${MESES_EXT[mes]} de ${ano} · regime de caixa</h3>
        <div class="pf-kpis">
          <div class="pf-kpi pf-az6"><div><span>Entradas no mês</span><b>${reais(t.entra[mes])}</b></div></div>
          <div class="pf-kpi pf-az7"><div><span>Saídas no mês</span><b>${reais(t.sai[mes])}</b></div></div>
          <div class="pf-kpi pf-az8"><div><span>Saldo no mês</span><b>${reais(t.saldo[mes])}</b></div></div>
          <div class="pf-kpi pf-az9"><div><span>Saldo atual das contas</span><b>${saldoAtual == null ? "—" : reais(saldoAtual)}</b>${saldoAtual == null ? html`<small>cadastre as contas na Previsão de caixa</small>` : html`<small>soma das contas cadastradas, hoje</small>`}</div></div>
        </div>
      </section>
      <section class="pf-grupo">
        <h3 class="pf-rotulo">Resultado de ${MESES_EXT[mes]} · O.S. entregues e balcão</h3>
        <div class="pf-kpis pf-kpis-3">
          <div class="pf-kpi pf-ok"><div class="pf-kt"><span>Faturamento</span><b>${reais(t.fat[mes])}</b></div><${Anel} pct=${100} /></div>
          <div class="pf-kpi pf-bad"><div class="pf-kt"><span>Custo de peças e terceiros</span><b>${reais(t.custo[mes])}</b></div><${Anel} pct=${pctCusto} /></div>
          <div class="pf-kpi pf-az6"><div class="pf-kt"><span>Margem bruta</span><b>${reais(t.margem[mes])}</b></div><${Anel} pct=${pctMargem} /></div>
        </div>
        <p class="dica">Margem bruta = faturamento − custo de peças e terceiros. Ainda faltam impostos, salários, aluguel e taxas de cartão (lançados em Contas a pagar).</p>
      </section>
    </div>
    <div class="pf-linha">
      <section class="card pf-card pf-larga">
        <div class="pf-cab">
          <div><h3 class="pf-rotulo">Entradas × saídas · ${ano}</h3>
            <div class="pf-legenda"><span><i class="pf-q pf-q-ok"></i>Entradas (recibos)</span><span><i class="pf-q pf-q-bad"></i>Saídas (contas pagas)</span></div></div>
          <div class="pf-resumo" id="pf-resumo-mes"><b>${MESES_EXT[mes]}</b><span>Entradas: <b>${reais(t.entra[mes])}</b></span><span>Saídas: <b>${reais(t.sai[mes])}</b></span><span>Saldo: <b class=${t.saldo[mes] < 0 ? "c-bad" : "pf-azul"}>${reais(t.saldo[mes])}</b></span></div>
        </div>
        <div class="pf-bars" role="img" aria-label=${"Entradas e saídas de cada mês de " + ano}>
          ${MESES.map((nome, i) => html`<div class="pf-bm" key=${nome}>
            <div class="pf-bb"><i class="pf-b pf-b-ok" style=${{ height: Math.round(t.entra[i] / maiorBarra * 150) + "px" }}></i><i class="pf-b pf-b-bad" style=${{ height: Math.round(t.sai[i] / maiorBarra * 150) + "px" }}></i></div>
            <${Chip} i=${i} />
          </div>`)}
        </div>
      </section>
      <section class="card pf-card">
        <h3 class="pf-rotulo">Gastos por categoria · ${MESES_EXT[mes]}</h3>
        ${catsMes.length ? html`<div class="pf-cats">${catsMes.map(([k, v]) => html`<div class="pf-cat" key=${k}>
          <span class="pf-cat-n">${k}</span>
          <span class="pf-cat-b"><i style=${{ width: Math.max(2, Math.round(v / maiorCat * 100)) + "%" }}></i><b>${reais(v)}</b></span>
        </div>`)}</div>` : html`<${Vazio} texto="Nenhuma conta paga neste mês." />`}
      </section>
    </div>
    <div class="pf-linha">
      <section class="card pf-card">
        <div class="pf-cab"><h3 class="pf-rotulo">Saldo acumulado no ano</h3>
          ${ultimo >= 0 ? html`<div class="pf-resumo">até ${MESES[Math.min(mes, ultimo)]}: <b class=${t.acum[Math.min(mes, ultimo)] < 0 ? "c-bad" : "pf-azul"}>${reais(t.acum[Math.min(mes, ultimo)])}</b></div>` : null}</div>
        ${linha ? html`<svg class="pf-svg" viewBox="0 0 560 190" preserveAspectRatio="none" role="img" aria-label="Linha do saldo acumulado, mês a mês, de entradas menos saídas">
            <line x1="0" y1="165" x2="560" y2="165" class="pf-eixo"></line>
            <polyline points=${linha.pts} class="pf-serie"></polyline>
            ${Math.min(mes, linha.fim) >= 0 ? html`<circle cx=${linha.x(Math.min(mes, linha.fim))} cy=${linha.y(linha.vals[Math.min(mes, linha.fim)])} r="5" class="pf-ponto"></circle>` : null}
          </svg>
          <div class="pf-eixo-x"><span>${MESES[0]}</span><span>${MESES[linha.fim]}</span></div>`
        : html`<${Vazio} texto="Ainda não há movimento neste ano." />`}
        <p class="dica">Entradas menos saídas somadas desde janeiro. O saldo real de cada conta fica na Previsão de caixa.</p>
      </section>
      <section class="card pf-card">
        <div class="pf-cab"><h3 class="pf-rotulo">Meta de entradas · orçado × realizado</h3>
          ${meta ? html`<div class="pf-resumo">meta: <b>${reais(meta)}</b> por mês</div>` : null}</div>
        ${meta ? html`
          <div class="pf-legenda"><span><i class="pf-q pf-q-cinza"></i>Meta</span><span><i class="pf-q pf-q-azul"></i>Entradas</span></div>
          <div class="pf-bars pf-bars-meta">
            ${MESES.map((nome, i) => { const topo = Math.max(meta, ...t.entra, 1); return html`<div class="pf-bm" key=${nome}>
              <div class="pf-bb"><i class="pf-b pf-b-cinza" style=${{ height: Math.round(meta / topo * 110) + "px" }}></i><i class="pf-b pf-b-azul" style=${{ height: Math.round(t.entra[i] / topo * 110) + "px" }}></i></div>
              <span class="pf-ml">${nome}</span>
            </div>`; })}
          </div>
          <div class="pf-meta-mes"><${Anel} pct=${t.entra[mes] / meta * 100} cor="var(--brand)" trilha="var(--line)" texto=${Math.round(t.entra[mes] / meta * 100) + "%"} /><span>da meta em ${MESES_EXT[mes]} (${reais(t.entra[mes])} de ${reais(meta)})</span></div>`
        : html`<p class="dica">Sem meta definida. A meta compara, mês a mês, o que entrou no caixa com o combinado.</p>`}
        ${pode(perfil, "ajustes") ? html`<div class="pf-meta-edit">
          ${metaTxt == null ? html`<button type="button" class="btn btn-sm" id="pf-meta-abrir" onClick=${() => setMetaTxt(meta ? String(meta).replace(".", ",") : "")}>${meta ? "Alterar a meta" : "Definir a meta"}</button>`
          : html`<div class="inp-suf"><input class="inp" id="pf-meta" inputmode="decimal" aria-label="Meta mensal de entradas" value=${metaTxt} onInput=${e => setMetaTxt(e.target.value)} /><span>R$/mês</span></div>
            <button type="button" class="btn btn-pri btn-sm" id="pf-meta-salvar" disabled=${salvandoMeta} onClick=${salvarMeta}>${salvandoMeta ? "Salvando…" : "Salvar meta"}</button>
            <button type="button" class="btn btn-sm" onClick=${() => setMetaTxt(null)}>Cancelar</button>`}
        </div>` : null}
      </section>
    </div>`}
  </div>`;
}
