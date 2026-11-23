// Janelas novas do Painel (pedido do Danilo em 22/11/2026): atalhos, previsão do tempo em
// Colatina/ES (Open-Meteo, sem chave) e notícias do Espírito Santo (RSS do g1 ES).
// Regras da casa: nada fica em "Carregando…" sem fim (tempo-limite em toda chamada), sem internet
// as janelas explicam em uma linha, e nome/descrição sempre escritos (nunca só um ícone ou cor).
import { html, useState, useEffect } from "../lib.js";
import { useApp, I } from "../ui.js";
import { pode } from "../regras.js";
import { lsGet, lsSet } from "../util.js";

// Colatina/ES (sede da oficina)
const LAT = -19.5393, LON = -40.6305;
const VALE_MIN = 30; // cache no aparelho: meia hora

/** fetch com tempo-limite de 8 s: janela do painel nunca pendura a tela */
function buscar(url) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 8000);
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
}

const doCache = chave => { const c = lsGet(chave); return c && c.em && (Date.now() - c.em) / 60000 < VALE_MIN ? c.d : null; };
const paraCache = (chave, d) => { try { lsSet(chave, { em: Date.now(), d }); } catch (e) { /* cheio: segue sem cache */ } };

// ---------- Previsão do tempo ----------
/** Texto do código de tempo da OMM (o nome sempre escrito, como a etapa da O.S.) */
export function tempoTexto(c) {
  if (c === 0) return "Céu limpo";
  if (c === 1) return "Quase limpo";
  if (c === 2) return "Parcialmente nublado";
  if (c === 3) return "Nublado";
  if (c === 45 || c === 48) return "Neblina";
  if (c >= 51 && c <= 57) return "Garoa";
  if (c >= 61 && c <= 67) return "Chuva";
  if (c >= 80 && c <= 82) return "Pancadas de chuva";
  if (c >= 95) return "Tempestade";
  return "Tempo instável";
}
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

/** Desenho do tempo no estilo dos celulares: sol, sol com nuvem, nuvem, chuva ou tempestade. */
export function IconeTempo({ cod, tam = 92 }) {
  const sol = html`<g><circle cx="32" cy="32" r="14" fill="#ffd977"></circle>
    <g stroke="#ffd977" stroke-width="3" stroke-linecap="round"><path d="M32 8v6"/><path d="M32 50v6"/><path d="M8 32h6"/><path d="M50 32h6"/><path d="M15 15l4 4"/><path d="M45 45l4 4"/><path d="M49 15l-4 4"/><path d="M19 45l-4 4"/></g></g>`;
  const solNuvem = html`<g><circle cx="24" cy="23" r="11" fill="#ffd977"></circle>
    <g stroke="#ffd977" stroke-width="2.6" stroke-linecap="round"><path d="M24 5v4"/><path d="M6 23h4"/><path d="M11 10l3 3"/><path d="M37 10l-3 3"/></g>
    <path d="M44 51H23a9.5 9.5 0 0 1-.8-19A13 13 0 0 1 46 35.6 8 8 0 0 1 44 51Z" fill="#e8eef6"></path></g>`;
  const nuvem = html`<path d="M44 46H22a10 10 0 0 1 0-20 14 14 0 0 1 26 2 8 8 0 0 1-4 18Z" fill="#dbe4ee"></path>`;
  const chuva = html`<g><path d="M44 42H22a10 10 0 0 1 0-20 14 14 0 0 1 26 2 8 8 0 0 1-4 18Z" fill="#cdd9e6"></path>
    <g stroke="#8ec5ff" stroke-width="3.4" stroke-linecap="round"><path d="M24 48l-2 8"/><path d="M34 48l-2 8"/><path d="M44 48l-2 8"/></g></g>`;
  const raio = html`<g><path d="M44 40H22a10 10 0 0 1 0-20 14 14 0 0 1 26 2 8 8 0 0 1-4 18Z" fill="#b9c6d6"></path>
    <path d="M32 44l-7 11h6l-3 9 10-13h-6l4-7z" fill="#ffd977"></path></g>`;
  const d = cod >= 95 ? raio : (cod >= 61 && cod <= 82) || (cod >= 51 && cod <= 57) ? chuva : cod === 3 || cod === 45 || cod === 48 ? nuvem : cod === 0 ? sol : solNuvem;
  return html`<svg class="clima-ic" width=${tam} height=${tam} viewBox="0 0 64 64" aria-hidden="true">${d}</svg>`;
}

export function ClimaJanela() {
  const [d, setD] = useState(() => doCache("dtcar-clima")), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true;
    if (d) return;
    buscar(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FSao_Paulo&forecast_days=4`)
      .then(r => r.json()).then(j => { if (!vivo) return; const dd = { agora: Math.round(j.current.temperature_2m), cod: j.current.weather_code,
        dias: j.daily.time.map((t, n) => ({ t, cod: j.daily.weather_code[n], max: Math.round(j.daily.temperature_2m_max[n]), min: Math.round(j.daily.temperature_2m_min[n]), chuva: j.daily.precipitation_probability_max[n] })) };
        setD(dd); paraCache("dtcar-clima", dd); })
      .catch(() => { if (vivo) setErro("Não deu para buscar a previsão agora (precisa de internet)."); });
    return () => { vivo = false; }; }, []);
  if (erro && !d) return html`<div class="clima clima-off"><span class="dica">${erro}</span></div>`;
  if (!d) return html`<div class="clima clima-off"><span class="dica">Buscando a previsão…</span></div>`;
  const hoje = d.dias[0] || {};
  return html`<div class="clima">
    <div class="clima-ln">
      <${IconeTempo} cod=${d.cod} />
      <div class="clima-ag"><div class="clima-t">${d.agora}<sup>°C</sup></div>
        <strong>${tempoTexto(d.cod)}</strong><span>Colatina · ES</span></div>
      <div class="clima-mais">Máxima <b>${hoje.max}°</b><br/>Mínima <b>${hoje.min}°</b><br/>Chuva <b>${hoje.chuva}%</b></div>
    </div>
    <div class="clima-dias">${d.dias.slice(1).map(x => html`<div key=${x.t}>
      <${IconeTempo} cod=${x.cod} tam=${26} />
      <div><span>${DIAS[new Date(x.t + "T12:00:00").getDay()]}</span><b>${x.min}°/${x.max}°</b><small>${tempoTexto(x.cod)}${x.chuva >= 30 ? " · " + x.chuva + "%" : ""}</small></div></div>`)}</div>
  </div>`;
}

// ---------- Notícias ----------
const RSS = "https://g1.globo.com/rss/g1/es/espirito-santo/";
export function NoticiasJanela() {
  const [l, setL] = useState(() => doCache("dtcar-noticias")), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true;
    if (l) return;
    buscar("https://corsproxy.io/?url=" + encodeURIComponent(RSS))
      .then(r => r.text()).then(x => { if (!vivo) return;
        const doc = new DOMParser().parseFromString(x, "text/xml");
        const itens = [...doc.querySelectorAll("item")].slice(0, 6).map(i => ({
          t: (i.querySelector("title") || {}).textContent || "",
          u: (i.querySelector("link") || {}).textContent || "",
          q: (i.querySelector("pubDate") || {}).textContent || "" }))
          .filter(i => i.t && /^https:\/\/g1\.globo\.com\//.test(i.u)); // só links do próprio g1
        if (!itens.length) throw new Error("vazio");
        setL(itens); paraCache("dtcar-noticias", itens); })
      .catch(() => { if (vivo) setErro("Não deu para buscar as notícias agora (precisa de internet)."); });
    return () => { vivo = false; }; }, []);
  if (erro && !l) return html`<span class="dica">${erro}</span>`;
  if (!l) return html`<span class="dica">Buscando as notícias…</span>`;
  const hora = q => { if (!q) return ""; const d = new Date(q); return isNaN(d) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
  return html`<div class="noticias">
    <div class="not-cab"><i aria-hidden="true"></i>Notícias do Espírito Santo<span>g1 ES</span></div>
    ${l.map(n => html`<a key=${n.u} href=${n.u} target="_blank" rel="noopener noreferrer">
      <span class="not-h">${hora(n.q)}</span><strong>${n.t}</strong></a>`)}</div>`;
}

// ---------- Atalhos ----------
export function AtalhosJanela() {
  const { ir, perfil } = useApp();
  const A = ({ rota, rot, ic, p }) => !p || pode(perfil, p) ? html`<button type="button" class="atalho" onClick=${() => ir(rota)}>${I[ic] || null}<span>${rot}</span></button>` : null;
  return html`<div class="atalhos">
    <${A} rota="/entrada" rot="Nova O.S." ic="mais" p="entrada" />
    <${A} rota="/orcamento/novo" rot="Novo orçamento" ic="nota" p="orcar" />
    <${A} rota="/cadastros?novo=1" rot="Novo cliente" ic="pessoas" p="cadastrar" />
    <${A} rota="/cadastros?aba=veiculos&novo=1" rot="Novo veículo" ic="carro" p="cadastrar" />
    <${A} rota="/agenda" rot="Agenda" ic="calendario" />
    <${A} rota="/orcamentos" rot="Orçamentos" ic="nota" p="orcar" />
    <${A} rota="/oleo-filtros" rot="Óleo e filtros" ic="gota" />
    <${A} rota="/compras" rot="Compras" ic="carrinho" p="verValores" />
    <${A} rota="/balcao" rot="Venda de balcão" ic="carrinho" p="verValores" />
    <${A} rota="/painel-financeiro" rot="Painel Financeiro" ic="grafico" p="financeiro" />
    <${A} rota="/financeiro" rot="Contas a pagar" ic="lista" p="financeiro" />
    <${A} rota="/receber" rot="Contas a receber" ic="lista" p="financeiro" />
    <${A} rota="/sefaz" rot="Notas da SEFAZ" ic="nota" p="cadastrar" />
    <${A} rota="/relatorios" rot="Relatórios" ic="grafico" p="verValores" />
  </div>`;
}
