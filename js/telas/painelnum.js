// Janelas de dinheiro do Painel (pedido do Danilo em 23/11/2026, protótipo aprovado no Claude Design):
// Resultado do mês (competência), Fluxo de caixa (caixa), Análise no período, Categorias de gasto,
// Gastos por subcategoria e Gasto com peças por fornecedor.
// SÓ LEITURA. Os números saem de js/numeros.js — a MESMA fonte do Painel Financeiro, para as duas telas
// nunca divergirem. Uma carga só por ano serve as seis janelas (useNumeros guarda em cache no módulo).
import { html, useState, useEffect } from "../lib.js";
import { useApp, Vazio } from "../ui.js";
import { reais } from "../util.js";
import { carregarAno, porMes, gastosDoMes, mesDe, n } from "../numeros.js";
import { agruparOS, faturadas } from "./relatorios.js";
import { nomeFavorecido } from "./financeiro.js";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_EXT = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const curto = v => { const x = Math.abs(n(v)); return x >= 1000 ? "R$ " + (n(v) / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : reais(v); };
const pct = (a, b) => (n(b) ? Math.round((n(a) / n(b)) * 100) : 0);

// cache por ano: as seis janelas do painel carregam uma vez só
let cache = { ano: null, dados: null, promessa: null };
export function limparCacheNumeros() { cache = { ano: null, dados: null, promessa: null }; }

/** Carrega (ou reaproveita) os números do ano. Devolve null enquanto carrega e false se falhou. */
export function useNumeros() {
  const { cfg } = useApp();
  const ano = new Date().getFullYear();
  const [d, setD] = useState(cache.ano === ano ? cache.dados : null);
  useEffect(() => {
    let vivo = true;
    if (cache.ano === ano && cache.dados) { setD(cache.dados); return; }
    if (cache.ano !== ano) { cache = { ano, dados: null, promessa: carregarAno(ano, cfg, { agruparOS, faturadas }) }; }
    cache.promessa.then(x => { cache.dados = x; if (vivo) setD(x); }).catch(() => { if (vivo) setD(false); });
    return () => { vivo = false; };
  }, [ano]);
  return d;
}

const Carregando = () => html`<span class="dica">Somando os números do ano…</span>`;
const Falhou = () => html`<${Vazio}>Não deu para somar os números agora (precisa de internet).<//>`;

/** Bloco preenchido na escala do Painel Financeiro, com anel opcional. O rótulo fica sempre escrito. */
function Bloco({ cor, rot, valor, dica, anel, anelTexto }) {
  return html`<div class=${"pn-kpi " + cor}>
    ${anel != null ? html`<svg class="pn-anel" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" fill="none" stroke="rgba(255,255,255,.32)" stroke-width="5"></circle>
      <circle cx="20" cy="20" r="16" fill="none" stroke="#fff" stroke-width="5" pathLength="100"
        stroke-dasharray=${Math.max(0, Math.min(100, anel)) + " " + (100 - Math.max(0, Math.min(100, anel)))} transform="rotate(-90 20 20)"></circle>
      <text x="20" y="24" text-anchor="middle">${anelTexto != null ? anelTexto : Math.round(anel) + "%"}</text></svg>` : null}
    <div class="pn-tx"><span>${rot}</span><b>${valor}</b>${dica ? html`<small>${dica}</small>` : null}</div></div>`;
}

/** Rosca com legenda escrita ao lado (nome, fatia e valor). */
function Rosca({ fatias, centro, sub, cores }) {
  const total = fatias.reduce((s, f) => s + n(f.v), 0) || 1;
  let off = 0;
  const C = 238.76; // 2·π·38
  return html`<div class="pn-rosca">
    <svg viewBox="0 0 100 100" aria-hidden="true">
      ${fatias.map((f, i) => { const d = (n(f.v) / total) * C; const el = html`<circle key=${i} cx="50" cy="50" r="38" fill="none"
          stroke=${cores[i % cores.length]} stroke-width="16" stroke-dasharray=${d + " " + (C - d)} stroke-dashoffset=${-off}
          transform="rotate(-90 50 50)"></circle>`; off += d; return el; })}
      <text class="pn-cen" x="50" y="48" text-anchor="middle">${centro}</text>
      <text class="pn-cen2" x="50" y="61" text-anchor="middle">${sub}</text>
    </svg>
    <div class="pn-leg">${fatias.map((f, i) => html`<div key=${i}><i style=${{ background: cores[i % cores.length] }}></i>
      <span>${f.nome}</span><em>${pct(f.v, total)}%</em><b>${curto(f.v)}</b></div>`)}</div></div>`;
}

/** Barras horizontais com o nome escrito e o valor à direita. */
function Barras({ itens, cor, vazio }) {
  if (!itens || !itens.length) return html`<${Vazio}>${vazio}<//>`;
  const max = Math.max(...itens.map(i => n(i.v))) || 1;
  return html`<div class="pn-barras">${itens.map((i, k) => html`
    <span class=${"pn-n" + (i.filho ? " pn-filho" : "")} key=${"n" + k}>${i.nome}</span>
    <span class="pn-t" key=${"t" + k}><i style=${{ width: Math.max(2, (n(i.v) / max) * 100) + "%", background: cor }}></i></span>
    <b key=${"b" + k}>${reais(i.v)}</b>`)}</div>`;
}

/* ---------- Resultado do mês · regime de competência ---------- */
export function ResultadoMes() {
  const d = useNumeros();
  if (d === false) return Falhou();
  if (!d) return Carregando();
  const mes = new Date().getMonth();
  const { fat, custo } = porMes(d);
  const f = fat[mes], c = custo[mes], mb = f - c;
  const ant = mes > 0 ? fat[mes - 1] : 0;
  // composição do MÊS: mão de obra, peças e terceiros das O.S. entregues + o balcão (peças)
  const doMes = d.oss.filter(o => mesDe(o.entregue_em) === mes), vMes = d.vendas.filter(v => mesDe(v.criado_em) === mes);
  const serv = doMes.reduce((s, o) => s + n(o.servicos), 0);
  const pec = doMes.reduce((s, o) => s + n(o.pecas), 0) + vMes.reduce((s, v) => s + n(v.total), 0);
  const ter = doMes.reduce((s, o) => s + n(o.terceiros), 0);
  const comp = [{ nome: "Serviços", v: serv }, { nome: "Peças", v: pec }, { nome: "Terceiros", v: ter }].filter(x => x.v > 0);
  return html`<div class="pn-g4">
    <${Bloco} cor="pn-az6" rot="Faturamento" valor=${reais(f)}
      dica=${ant && f ? (f >= ant ? "+" : "") + pct(f - ant, ant) + "% sobre " + MESES_EXT[mes - 1] : "O.S. entregues e balcão"} />
    <${Bloco} cor="pn-az7" rot="Custo de peças e terceiros" valor=${reais(c)} dica="do faturamento" anel=${pct(c, f)} />
    <${Bloco} cor="pn-ok" rot="Margem bruta" valor=${reais(mb)} dica="antes das despesas fixas" anel=${pct(mb, f)} />
    <div class="pn-card"><h4>Composição do faturamento</h4>
      ${comp.length ? html`<${Rosca} fatias=${comp} centro=${curto(f)} sub=${MESES[mes]}
        cores=${["#2f6fb5", "#e8a33d", "#6d4aa8"]} />` : html`<${Vazio}>Nada faturado neste mês ainda.<//>`}</div>
  </div>`;
}

/* ---------- Fluxo de caixa · regime de caixa ---------- */
export function FluxoCaixaMes() {
  const d = useNumeros();
  if (d === false) return Falhou();
  if (!d) return Carregando();
  const mes = new Date().getMonth();
  const { entra, sai } = porMes(d);
  const e = entra[mes], s = sai[mes], saldo = e - s;
  const contas = (d.saldos || []).reduce((t, c) => t + n(c.atual), 0);
  return html`<div class="pn-g4">
    <${Bloco} cor="pn-ok" rot="Entradas no mês" valor=${reais(e)} dica="recibos e balcão sem recibo" />
    <${Bloco} cor="pn-bad" rot="Saídas no mês" valor=${reais(s)} dica="contas pagas" />
    <${Bloco} cor="pn-az8" rot="Saldo no mês" valor=${(saldo >= 0 ? "+" : "") + reais(saldo)}
      dica=${saldo >= 0 ? "sobrou do que entrou" : "saiu mais do que entrou"} anel=${e ? pct(saldo, e) : 0} />
    <${Bloco} cor="pn-az9" rot="Saldo atual das contas"
      valor=${d.saldos ? reais(contas) : "—"} dica=${d.saldos ? "soma das contas da empresa" : "cadastre as contas na Previsão de caixa"} />
  </div>`;
}

/* ---------- Análise no período ---------- */
export function AnalisePeriodo() {
  const d = useNumeros();
  if (d === false) return Falhou();
  if (!d) return Carregando();
  const mes = new Date().getMonth(), ano = new Date().getFullYear();
  const { entra, sai } = porMes(d);
  const max = Math.max(...entra, ...sai, 1);
  let acc = 0; const acum = entra.map((e, i) => (acc += e - sai[i]));
  const topo = Math.max(...acum.map(Math.abs), 1);
  const pts = acum.slice(0, mes + 1).map((v, i) => (10 + i * 42) + "," + (118 - (v / topo) * 96)).join(" ");
  return html`<div class="pn-g2">
    <div class="pn-card"><h4>Entradas × saídas · ${ano}</h4>
      <div class="pn-leg2"><span><i style="background:#34b37e"></i>Entradas</span><span><i style="background:#e2645c"></i>Saídas</span></div>
      <div class="pn-cols">${MESES.map((m, i) => html`<div key=${m} class=${"pn-m" + (i === mes ? " on" : "")}>
        <div class="pn-par"><i style=${{ height: Math.max(1, (entra[i] / max) * 100) + "%" }}></i><i class="s" style=${{ height: Math.max(1, (sai[i] / max) * 100) + "%" }}></i></div>
        <span>${m}</span></div>`)}</div></div>
    <div class="pn-card"><h4>Saldo acumulado no ano</h4>
      <svg class="pn-linha" viewBox="0 0 520 130" preserveAspectRatio="none" aria-hidden="true">
        <line x1="0" y1="118" x2="520" y2="118" stroke="var(--line)"></line>
        <polyline fill="none" stroke="#174f94" stroke-width="2.6" stroke-linejoin="round" points=${pts}></polyline>
      </svg>
      <div class="pn-pe"><span>até ${MESES[mes]}</span><b class=${acum[mes] >= 0 ? "c-ok" : "c-bad"}>${reais(acum[mes])}</b></div></div>
  </div>`;
}

/* ---------- Para onde foi o dinheiro ---------- */
function useGastos() {
  const { dados } = useApp();
  const d = useNumeros();
  if (!d || d === false) return d;
  return gastosDoMes(d.pagas, (dados && dados.fornecedores) || [], new Date().getMonth(), nomeFavorecido);
}
const CORES = ["#e8a33d", "#2f6fb5", "#e2645c", "#6d4aa8", "#34b37e", "#9aa1ab"];

export function CategoriasGasto() {
  const g = useGastos();
  if (g === false) return Falhou();
  if (!g) return Carregando();
  if (!g.categorias.length) return html`<${Vazio}>Nenhuma conta paga neste mês.<//>`;
  return html`<${Rosca} fatias=${g.categorias.slice(0, 6)} centro=${curto(g.total)} sub="pagos no mês" cores=${CORES} />`;
}

export function SubcategoriasGasto() {
  const g = useGastos();
  if (g === false) return Falhou();
  if (!g) return Carregando();
  const linhas = [];
  for (const c of g.subcategorias.slice(0, 3)) {
    linhas.push({ nome: c.nome, v: c.v });
    for (const i of c.itens.slice(0, 3)) linhas.push({ nome: i.nome, v: i.v, filho: true });
  }
  return html`<${Barras} itens=${linhas} cor="#6d4aa8" vazio="Nenhuma conta paga neste mês." />`;
}

export function PecasPorFornecedor() {
  const g = useGastos();
  if (g === false) return Falhou();
  if (!g) return Carregando();
  return html`<div><${Barras} itens=${g.pecasPorFornecedor.slice(0, 7)} cor="#e8a33d"
      vazio="Nenhuma compra de peça paga neste mês." />
    ${g.totalPecas ? html`<span class="dica">${reais(g.totalPecas)} em peças, insumos e terceiros no mês.</span>` : null}</div>`;
}
