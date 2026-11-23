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
  if (erro && !d) return html`<span class="dica">${erro}</span>`;
  if (!d) return html`<span class="dica">Buscando a previsão…</span>`;
  const hoje = d.dias[0] || {};
  return html`<div class="clima">
    <div class="clima-hoje"><b>${d.agora}°C</b><div><strong>${tempoTexto(d.cod)}</strong><span>${hoje.min}° a ${hoje.max}°${hoje.chuva >= 30 ? " · chuva " + hoje.chuva + "%" : ""}</span></div></div>
    <div class="clima-dias">${d.dias.slice(1).map(x => html`<div key=${x.t}><span>${DIAS[new Date(x.t + "T12:00:00").getDay()]}</span><strong>${x.min}°/${x.max}°</strong><small>${tempoTexto(x.cod)}${x.chuva >= 30 ? " · " + x.chuva + "%" : ""}</small></div>`)}</div>
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
  return html`<div class="noticias">${l.map(n => html`<a key=${n.u} href=${n.u} target="_blank" rel="noopener noreferrer">
    <strong>${n.t}</strong><span>g1 Espírito Santo${n.q ? " · " + new Date(n.q).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""}</span></a>`)}</div>`;
}

// ---------- Atalhos ----------
export function AtalhosJanela() {
  const { ir, perfil } = useApp();
  const A = ({ rota, rot, ic, p }) => !p || pode(perfil, p) ? html`<button type="button" class="atalho" onClick=${() => ir(rota)}>${I[ic] || null}<span>${rot}</span></button>` : null;
  return html`<div class="atalhos">
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
