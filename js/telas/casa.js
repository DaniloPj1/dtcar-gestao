// Janelas do Painel que vieram do jeito do celular (pedido do Danilo em 22/11/2026 e 25/11/2026):
// atalhos, previsão do tempo em Colatina/ES (Open-Meteo, sem chave) com a hora e o mini calendário da semana,
// notícias por prioridade (cidade › estado › país), cotação do dólar e das outras moedas (AwesomeAPI, sem chave)
// e os e-mails que chegaram, por prioridade (contabilidade › Objetiva › outros).
// Regras da casa: nada fica em "Carregando…" sem fim (tempo-limite em toda chamada), sem internet
// as janelas explicam em uma linha, e nome/descrição sempre escritos (nunca só um ícone ou cor).
import { html, useState, useEffect, useRef } from "../lib.js";
import { animarCena } from "../climacena.js";
import { useApp, I } from "../ui.js";
import { api } from "../api.js";
import { pode } from "../regras.js";
import { lsGet, lsSet, fmtDataHora } from "../util.js";

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
const DIAS_LONGOS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];

/** Desenho do tempo no estilo dos celulares: sol, sol com nuvem, nuvem, chuva ou tempestade. */
export function IconeTempo({ cod, tam = 92, noite = false }) {
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
  // à noite, céu limpo vira lua e "quase limpo" vira lua com nuvem
  const lua = html`<path d="M40 10a22 22 0 1 0 14 38A18 18 0 0 1 40 10Z" fill="#f3e7b8"></path>`;
  const luaNuvem = html`<g><path d="M30 6a17 17 0 1 0 11 29A14 14 0 0 1 30 6Z" fill="#f3e7b8"></path>
    <path d="M46 53H25a9.5 9.5 0 0 1-.8-19A13 13 0 0 1 48 37.6 8 8 0 0 1 46 53Z" fill="#dde5ee"></path></g>`;
  const d = cod >= 95 ? raio : (cod >= 61 && cod <= 82) || (cod >= 51 && cod <= 57) ? chuva : cod === 3 || cod === 45 || cod === 48 ? nuvem
    : cod === 0 ? (noite ? lua : sol) : (noite ? luaNuvem : solNuvem);
  return html`<svg class="clima-ic" width=${tam} height=${tam} viewBox="0 0 64 64" aria-hidden="true">${d}</svg>`;
}

/** Cena de fundo do quadro do tempo (pedido do Danilo em 28/11/2026: "se estiver sol, coloque a expressão atrás como se
    estivesse sol, se for chuva coloque chuva"). Devolve o nome da cena pelo código da OMM. */
export function cenaDoTempo(cod) {
  if (cod >= 95) return "tempestade";
  if ((cod >= 61 && cod <= 67) || (cod >= 80 && cod <= 82)) return "chuva";
  if (cod >= 51 && cod <= 57) return "garoa";
  if (cod === 45 || cod === 48) return "neblina";
  if (cod === 0) return "sol";
  if (cod === 1 || cod === 2) return "parcial";
  return "nublado";
}

/** É noite em Colatina agora? Pelo nascer e pôr do sol do dia, quando a previsão traz; senão, das 18h às 6h. */
export function eNoite(agora, nasce, poe) {
  const a = agora.getTime(), n = nasce ? Date.parse(nasce) : NaN, p = poe ? Date.parse(poe) : NaN;
  if (!isNaN(n) && !isNaN(p)) return a < n || a >= p;
  const h = agora.getHours(); return h < 6 || h >= 18;
}

/** O desenho de fundo (js/climacena.js): céu, sol com raios e reflexo, lua e estrelas, nuvens andando, névoa, garoa,
    chuva com respingos ou tempestade com relâmpago. Fica atrás dos desenhos e do texto; só enfeite (aria-hidden). */
function CenaTempo({ cena, noite }) {
  const ref = useRef(null);
  useEffect(() => { const c = ref.current; if (!c) return undefined;
    const parado = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    try { return animarCena(c, { cena, noite, parado }); } catch (e) { return undefined; }   // sem canvas: fica o céu do quadro
  }, [cena, noite]);
  return html`<div class=${"clima-cena cena-" + cena + (noite ? " cena-noite" : "")} aria-hidden="true">
    <canvas ref=${ref} class="clima-tela" data-cena=${cena + (noite ? "-noite" : "")}></canvas></div>`;
}

/** Relógio da janela do tempo: hora de Colatina, acertada de minuto em minuto (pedido do Danilo em 25/11/2026) */
function useAgora() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 30000); return () => clearInterval(i); }, []);
  return t;
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function ClimaJanela() {
  const [d, setD] = useState(() => doCache("dtcar-clima")), [erro, setErro] = useState("");
  const [sel, setSel] = useState(0);   // dia do calendário escolhido (0 = agora)
  const agora = useAgora();
  useEffect(() => { let vivo = true;
    if (d) return;
    buscar(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=America%2FSao_Paulo&forecast_days=7`)
      .then(r => r.json()).then(j => { if (!vivo) return; const dd = { agora: Math.round(j.current.temperature_2m), cod: j.current.weather_code,
        dias: j.daily.time.map((t, n) => ({ t, cod: j.daily.weather_code[n], max: Math.round(j.daily.temperature_2m_max[n]), min: Math.round(j.daily.temperature_2m_min[n]), chuva: j.daily.precipitation_probability_max[n] })),
        nasce: (j.daily.sunrise || [])[0] || "", poe: (j.daily.sunset || [])[0] || "" };
        setD(dd); paraCache("dtcar-clima", dd); })
      .catch(() => { if (vivo) setErro("Não deu para buscar a previsão agora (precisa de internet)."); });
    return () => { vivo = false; }; }, []);
  if (erro && !d) return html`<div class="clima clima-off"><span class="dica">${erro}</span></div>`;
  if (!d) return html`<div class="clima clima-off"><span class="dica">Buscando a previsão…</span></div>`;
  const hoje = d.dias[0] || {};
  const dia = (sel && d.dias[sel]) || null;           // um dia da semana escolhido no calendário
  const noite = !dia && eNoite(agora, d.nasce, d.poe);
  const cod = dia ? dia.cod : d.cod, cena = cenaDoTempo(cod);
  const nomeDia = x => { const dt = new Date(x.t + "T12:00:00"); return DIAS_LONGOS[dt.getDay()].replace("-feira", "") + ", " + dt.getDate(); };
  const ref = dia || hoje;
  const hhmm = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dataLonga = DIAS_LONGOS[agora.getDay()] + ", " + agora.getDate() + " de " + MESES[agora.getMonth()];
  return html`<div class=${"clima ceu-" + cena + (noite ? " ceu-noite" : "")} data-cena=${cena + (noite ? "-noite" : "")}>
    <${CenaTempo} key=${cena + (noite ? "-n" : "")} cena=${cena} noite=${noite} />
    <div class="clima-ln">
      <${IconeTempo} cod=${cod} noite=${noite} />
      ${dia
        ? html`<div class="clima-ag"><div class="clima-t">${dia.max}<sup>°C</sup></div>
            <strong>${tempoTexto(dia.cod)}</strong><span>Previsão de ${nomeDia(dia)}</span></div>`
        : html`<div class="clima-ag"><div class="clima-t">${d.agora}<sup>°C</sup></div>
            <strong>${tempoTexto(d.cod)}${noite ? " · noite" : ""}</strong><span>Colatina · ES</span></div>`}
      <div class="clima-relogio"><b>${hhmm}</b><span>${dataLonga}</span>
        <small>Máxima ${ref.max}° · Mínima ${ref.min}° · Chuva ${ref.chuva}%</small></div>
    </div>
    <div class="clima-cal" role="group" aria-label="Previsão da semana: toque num dia para ver o tempo dele">${d.dias.map((x, n) => { const dt = new Date(x.t + "T12:00:00");
      return html`<button type="button" key=${x.t} class=${"clima-dia" + (n === 0 ? " clima-hoje" : "") + (n === sel ? " clima-sel" : "")}
        aria-pressed=${n === sel} title=${n === 0 ? "Voltar para o tempo de agora" : "Ver o tempo de " + nomeDia(x)}
        onClick=${() => setSel(n === sel ? 0 : n)}>
        <span class="clima-dia-nome">${n === 0 ? "Hoje" : DIAS[dt.getDay()]}</span>
        <span class="clima-dia-num">${dt.getDate()}</span>
        <${IconeTempo} cod=${x.cod} tam=${30} />
        <b>${x.max}°</b><span class="clima-dia-min">${x.min}°</span>
        <small>${tempoTexto(x.cod)}${x.chuva >= 30 ? " · " + x.chuva + "%" : ""}</small></button>`; })}</div>
    <a class="clima-link" href=${"https://www.google.com/search?q=previs%C3%A3o+do+tempo+Colatina+ES"} target="_blank" rel="noopener noreferrer">Ver a previsão completa de Colatina</a>
  </div>`;
}

// ---------- Notícias: cidade › estado › país (pedido do Danilo em 25/11/2026) ----------
/* "As principais notícias por ordem de prioridade Cidade > Estado > País, com um filtro de notícias que afetam a
   nossa vida diretamente." Cidade e país saem do Google Notícias (RSS, sem chave); o estado continua no g1 ES, que
   já estava aqui. Tudo passa pelo mesmo proxy de CORS que a janela já usava.
   O filtro é por palavra: combustível, imposto, greve, estrada, energia, chuva e o resto do que mexe com a oficina.
   O que ele pede é "as que afetam a nossa vida diretamente", então o filtro é uma chave que ele liga e desliga — com
   o filtro ligado, notícia que não bate em nenhuma palavra não aparece; nada é escondido sem ele mandar. */
const FONTES = [
  { k: "cidade", t: "Colatina", rss: "https://news.google.com/rss/search?q=Colatina&hl=pt-BR&gl=BR&ceid=BR:pt-419", hosts: /\.google\.com\/|\.com\.br|\.com\// },
  { k: "estado", t: "Espírito Santo", rss: "https://g1.globo.com/rss/g1/es/espirito-santo/", hosts: /^https:\/\/g1\.globo\.com\//, fonte: "g1 ES" },
  { k: "pais", t: "Brasil", rss: "https://news.google.com/rss/headlines/section/topic/NATION?hl=pt-BR&gl=BR&ceid=BR:pt-419", hosts: /\.google\.com\/|\.com\.br|\.com\// },
];
/* Palavras do que mexe com a oficina e com o bolso de quem trabalha nela. Não é censura de assunto: é o filtro que ele
   liga quando quer só o que muda o dia da oficina. */
export const PALAVRAS_AFETAM = ["combust", "gasolina", "diesel", "etanol", "álcool", "posto", "petrobras", "imposto", "tribut",
  "reforma tribut", "nota fiscal", "sefaz", "receita federal", "simples nacional", "juros", "selic", "inflação", "dólar", "salário",
  "fgts", "inss", "greve", "caminhoneiro", "transporte", "frete", "estrada", "rodovia", "br-259", "es-080", "trânsito", "acidente",
  "chuva", "alagamento", "energia", "falta de luz", "apagão", "água", "peça", "autopeça", "montadora", "veícul", "carro", "ipva",
  "licenciamento", "detran", "cnh", "multa", "recall", "colatina", "oficina", "mecânic", "emprego", "comércio", "feriado"];
export const afetaAOficina = t => { const x = String(t || "").toLowerCase(); return PALAVRAS_AFETAM.some(p => x.includes(p)); };
const LS_FILTRO = "dtcar-noticias-filtro";

/** Foto da notícia, quando o RSS manda: media:content, media:thumbnail, enclosure ou a 1ª <img> do resumo. Só https. */
function fotoDoItem(i) {
  const tags = ["content", "thumbnail"].flatMap(n => [...i.getElementsByTagName("media:" + n), ...i.getElementsByTagName(n)]);
  for (const t of tags) { const u = t.getAttribute && t.getAttribute("url"); if (u && /^https:\/\//.test(u)) return u; }
  const enc = i.getElementsByTagName("enclosure")[0];
  const eu = enc && enc.getAttribute("url");
  if (eu && /^https:\/\//.test(eu) && /image|\.jpe?g|\.png|\.webp/i.test((enc.getAttribute("type") || "") + eu)) return eu;
  const resumo = ((i.querySelector("description") || {}).textContent || "") + ((i.getElementsByTagName("content:encoded")[0] || {}).textContent || "");
  const m = /<img[^>]+src=["'](https:\/\/[^"']+)["']/i.exec(resumo);
  return m ? m[1] : "";
}
/** "agora", "há 2 h", "ontem" — como no celular, em vez do horário cru */
export function hasAtras(iso, agora = Date.now()) {
  const d = new Date(iso); if (isNaN(d)) return "";
  const min = Math.round((agora - d.getTime()) / 60000);
  if (min < 2) return "agora";
  if (min < 60) return "há " + min + " min";
  const h = Math.round(min / 60);
  if (h < 24) return "há " + h + " h";
  const dias = Math.round(h / 24);
  return dias === 1 ? "ontem" : "há " + dias + " dias";
}
/** Nome da fonte: o RSS do Google manda em <source>; no g1 o título vem com " - Fonte" no fim */
const fonteDoItem = (i, titulo) => {
  const s = ((i.getElementsByTagName("source")[0] || {}).textContent || "").trim();
  if (s) return s;
  const m = / - ([^-]{2,30})$/.exec(titulo || "");
  return m ? m[1].trim() : "";
};
function lerRSS(texto, hosts, fontePadrao = "") {
  const doc = new DOMParser().parseFromString(texto, "text/xml");
  return [...doc.querySelectorAll("item")].map(i => {
    const t = (i.querySelector("title") || {}).textContent || "";
    const fonte = fonteDoItem(i, t) || fontePadrao;
    return { t: fonte && t.endsWith(" - " + fonte) ? t.slice(0, -(fonte.length + 3)) : t,
      u: (i.querySelector("link") || {}).textContent || "",
      q: (i.querySelector("pubDate") || {}).textContent || "",
      foto: fotoDoItem(i), fonte };
  }).filter(i => i.t && /^https:\/\//.test(i.u) && hosts.test(i.u));
}

export function NoticiasJanela() {
  const [d, setD] = useState(() => doCache("dtcar-noticias3")), [erro, setErro] = useState("");
  const [soAfetam, setSoAfetam] = useState(() => !!lsGet(LS_FILTRO));
  useEffect(() => { let vivo = true;
    if (d) return;
    Promise.all(FONTES.map(f => buscar("https://corsproxy.io/?url=" + encodeURIComponent(f.rss))
      .then(r => r.text()).then(x => ({ k: f.k, itens: lerRSS(x, f.hosts, f.fonte || "").slice(0, 8) })).catch(() => ({ k: f.k, itens: [], falhou: true }))))
      .then(r => { if (!vivo) return;
        if (r.every(x => !x.itens.length)) throw new Error("vazio");
        const dd = Object.fromEntries(r.map(x => [x.k, x.itens]));
        setD(dd); paraCache("dtcar-noticias3", dd); })
      .catch(() => { if (vivo) setErro("Não deu para buscar as notícias agora (precisa de internet)."); });
    return () => { vivo = false; }; }, []);
  if (erro && !d) return html`<span class="dica">${erro}</span>`;
  if (!d) return html`<span class="dica">Buscando as notícias…</span>`;
  const trocar = () => { const v = !soAfetam; setSoAfetam(v); lsSet(LS_FILTRO, v); };
  const doGrupo = k => (d[k] || []).filter(n => !soAfetam || afetaAOficina(n.t));
  const total = FONTES.reduce((s, f) => s + doGrupo(f.k).length, 0);
  return html`<div class="noticias">
    <div class="not-cab"><i aria-hidden="true"></i>Notícias
      <label class="not-filtro"><input type="checkbox" id="not-filtro" checked=${soAfetam} onChange=${trocar} /><span>Só o que afeta a oficina</span></label></div>
    ${!total ? html`<span class="dica">${soAfetam ? "Nenhuma notícia de hoje bate com o filtro. Desmarque para ver todas." : "Nenhuma notícia agora."}</span>` : null}
    ${FONTES.map(f => { const l = doGrupo(f.k).slice(0, f.k === "cidade" ? 5 : 4); if (!l.length) return null;
      return html`<div class="not-grupo" key=${f.k} data-grupo=${f.k}>
        <div class="not-grupo-t">${f.t}<span>${f.k === "cidade" ? "cidade" : f.k === "estado" ? "estado" : "país"}</span></div>
        <div class="not-cards">${l.map((n, i) => html`<${CardNoticia} key=${n.u} n=${n} grande=${i === 0 && f.k === "cidade"} />`)}</div></div>`; })}
  </div>`;
}

/** Cartão de uma notícia no estilo do celular: foto, fonte, manchete e há quanto tempo saiu.
 *  Sem foto no RSS, entra a inicial da fonte num quadrado — nada de espaço vazio nem de foto inventada. */
function CardNoticia({ n, grande = false }) {
  const [semFoto, setSemFoto] = useState(false);
  const inicial = (n.fonte || "N").trim().charAt(0).toUpperCase();
  return html`<a class=${"not-card" + (grande ? " not-card-g" : "")} href=${n.u} target="_blank" rel="noopener noreferrer">
    <div class="not-card-txt">
      <span class="not-card-fonte"><i aria-hidden="true">${inicial}</i>${n.fonte || "Notícia"}<span class="not-card-h">${hasAtras(n.q)}</span></span>
      <strong>${n.t}</strong>
    </div>
    <div class="not-card-foto">${n.foto && !semFoto ? html`<img src=${n.foto} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${() => setSemFoto(true)} />` : html`<span>${inicial}</span>`}</div>
  </a>`;
}

// ---------- Cotação do dólar e de outras moedas (pedido do Danilo em 25/11/2026) ----------
/* AwesomeAPI (economia.awesomeapi.com.br), sem chave e sem cadastro — a mesma casa da API de CEP que já estava
   aprovada. O dólar fica grande, como no celular; as outras moedas ficam na lista ao lado, e a escolhida troca de
   lugar com o dólar. A variação vem SEMPRE escrita ("subiu"/"caiu"), nunca só pela cor: em P&B seria a mesma seta. */
export const MOEDAS = [["USD", "Dólar"], ["EUR", "Euro"], ["GBP", "Libra"], ["ARS", "Peso argentino"], ["BTC", "Bitcoin"]];
const LS_MOEDA = "dtcar-moeda";
const DIAS_GRAFICO = 15;

/** Mini gráfico dos últimos dias (pedido do Danilo em 28/11/2026): linha simples, sem eixo e sem enfeite.
 *  A conta é só regra de três entre o menor e o maior do período; com menos de 2 dias não desenha nada. */
export function pontosDoGrafico(valores, larg = 220, alt = 54, folga = 4) {
  const v = (valores || []).map(Number).filter(x => Number.isFinite(x));
  if (v.length < 2) return null;
  const min = Math.min(...v), max = Math.max(...v), faixa = max - min || 1;
  const px = i => folga + (i * (larg - folga * 2)) / (v.length - 1);
  const py = x => alt - folga - ((x - min) / faixa) * (alt - folga * 2);
  const pts = v.map((x, i) => [px(i), py(x)]);
  return { min, max, pts, linha: pts.map(([a, b]) => a.toFixed(1) + "," + b.toFixed(1)).join(" "),
    area: "M" + pts.map(([a, b]) => a.toFixed(1) + "," + b.toFixed(1)).join(" L") + " L" + px(v.length - 1).toFixed(1) + "," + alt + " L" + folga + "," + alt + " Z",
    fim: pts[pts.length - 1] };
}
function MiniGrafico({ valores, dias }) {
  const g = pontosDoGrafico(valores);
  if (!g) return null;
  return html`<div class="moedas-graf">
    <svg viewBox="0 0 220 54" width="100%" height="54" role="img" aria-label=${"Variação dos últimos " + dias + " dias: de R$ " + g.min.toFixed(4) + " a R$ " + g.max.toFixed(4)}>
      <path d=${g.area} fill="rgba(255,255,255,.16)"></path>
      <polyline points=${g.linha} fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"></polyline>
      <circle cx=${g.fim[0]} cy=${g.fim[1]} r="3.2" fill="#fff"></circle>
    </svg>
    <div class="moedas-graf-pes"><span>${dias} dias</span><span>mín. ${g.min.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</span><span>máx. ${g.max.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}</span></div>
  </div>`;
}
const reaisMoeda = v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number(v) >= 1000 ? 2 : 4, maximumFractionDigits: Number(v) >= 1000 ? 2 : 4 });
export function MoedasJanela() {
  const [d, setD] = useState(() => doCache("dtcar-moedas")), [erro, setErro] = useState("");
  const [moeda, setMoeda] = useState(() => lsGet(LS_MOEDA) || "USD");
  const [serie, setSerie] = useState(() => doCache("dtcar-moedas-serie") || {});
  useEffect(() => { let vivo = true;
    if (d) return;
    buscar("https://economia.awesomeapi.com.br/json/last/" + MOEDAS.map(([k]) => k + "-BRL").join(","))
      .then(r => r.json()).then(j => { if (!vivo) return;
        const dd = {};
        for (const [k] of MOEDAS) { const x = j[k + "BRL"]; if (x) dd[k] = { v: Number(x.bid), pct: Number(x.pctChange), em: x.create_date }; }
        if (!Object.keys(dd).length) throw new Error("vazio");
        setD(dd); paraCache("dtcar-moedas", dd); })
      .catch(() => { if (vivo) setErro("Não deu para buscar a cotação agora (precisa de internet)."); });
    return () => { vivo = false; }; }, []);
  // os últimos dias da moeda escolhida, para o mini gráfico: busca uma vez por moeda e guarda no aparelho
  useEffect(() => { let vivo = true;
    if (serie[moeda]) return;
    buscar("https://economia.awesomeapi.com.br/json/daily/" + moeda + "-BRL/" + DIAS_GRAFICO)
      .then(r => r.json()).then(j => { if (!vivo || !Array.isArray(j) || j.length < 2) return;
        const v = j.map(x => Number(x.bid)).filter(x => Number.isFinite(x)).reverse();   // a API manda do mais novo para o mais velho
        if (v.length < 2) return;
        setSerie(s => { const novo = { ...s, [moeda]: v }; paraCache("dtcar-moedas-serie", novo); return novo; }); })
      .catch(() => { /* sem gráfico: o cartão segue com o número, que é o que importa */ });
    return () => { vivo = false; }; }, [moeda, serie[moeda]]);
  if (erro && !d) return html`<div class="moedas moedas-off"><span class="dica">${erro}</span></div>`;
  if (!d) return html`<div class="moedas moedas-off"><span class="dica">Buscando a cotação…</span></div>`;
  const escolher = k => { setMoeda(k); lsSet(LS_MOEDA, k); };
  const atual = d[moeda] || d.USD || {};
  const nome = (MOEDAS.find(([k]) => k === moeda) || MOEDAS[0])[1];
  const sobe = Number(atual.pct) > 0, cai = Number(atual.pct) < 0;
  const quando = atual.em ? String(atual.em).slice(0, 16).replace("T", " ") : "";
  return html`<div class="moedas">
    <div class="moedas-ln">
      <div class="moedas-ag"><span class="moedas-nome">${nome} hoje</span>
        <div class="moedas-v">R$ ${reaisMoeda(atual.v)}</div>
        <span class=${"moedas-var " + (sobe ? "c-bad" : cai ? "c-ok" : "")}>${sobe ? "Subiu" : cai ? "Caiu" : "Sem variação"} ${Math.abs(Number(atual.pct) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}% hoje</span>
        ${quando ? html`<small>Atualizado em ${quando}</small>` : null}
        <${MiniGrafico} valores=${serie[moeda]} dias=${DIAS_GRAFICO} /></div>
      <div class="moedas-lista">${MOEDAS.filter(([k]) => d[k]).map(([k, t]) => html`
        <button type="button" key=${k} class=${"moedas-item" + (k === moeda ? " ativo" : "")} aria-pressed=${k === moeda ? "true" : "false"} onClick=${() => escolher(k)}>
          <span>${t}</span><b>R$ ${reaisMoeda(d[k].v)}</b></button>`)}</div>
    </div>
    <a class="moedas-link" href="https://www.google.com/search?q=cota%C3%A7%C3%A3o+do+d%C3%B3lar+hoje" target="_blank" rel="noopener noreferrer">Ver a cotação no Google</a>
  </div>`;
}

// ---------- E-mails que chegaram: contabilidade › Objetiva › outros (pedido do Danilo em 25/11/2026) ----------
/* A lista sai do que o robô do e-mail já conferiu (tabela email_robo, v64): é leitura direta do banco, não custa uma
   chamada à Microsoft a cada vez que o painel abre. Sem o v64 no banco, a janela diz o que falta em vez de quebrar.
   A prioridade é a que ele pediu: contabilidade primeiro (os remetentes de cfg.rh.remetentes), Objetiva depois, o
   resto por último. Cada linha abre a caixa de e-mail dentro do sistema. */
export const GRUPOS_EMAIL = [["contabilidade", "Contabilidade"], ["objetiva", "Objetiva"], ["outros", "Outros"]];
export function grupoDoEmail(e, remetentes = []) {
  const x = String(e || "").toLowerCase();
  if (remetentes.some(r => r && x.includes(String(r).toLowerCase()))) return "contabilidade";
  if (/contabil|loredo/.test(x)) return "contabilidade";
  if (/objetiva/.test(x)) return "objetiva";
  return "outros";
}
export function EmailsJanela() {
  const { ir, cfg } = useApp();
  const [l, setL] = useState(null), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true;
    api.email.robo(40).then(r => { if (!vivo) return;
      if (r === null) { setErro("Para ver os e-mails aqui, rode o supabase/v64.sql no Supabase."); return; }
      setL(r); })
      .catch(e => { if (vivo) setErro(e.message || "Não deu para ler os e-mails agora."); });
    return () => { vivo = false; }; }, []);
  if (erro) return html`<span class="dica">${erro}</span>`;
  if (!l) return html`<span class="dica">Lendo os e-mails…</span>`;
  const remetentes = ((cfg && cfg.rh && cfg.rh.remetentes) || []);
  const porGrupo = { contabilidade: [], objetiva: [], outros: [] };
  for (const e of l) porGrupo[grupoDoEmail(e.de_email + " " + e.de_nome, remetentes)].push(e);
  const total = l.length;
  return html`<div class="emails">
    <div class="not-cab"><i aria-hidden="true"></i>E-mails recebidos<span>${total} conferidos pelo robô</span></div>
    ${!total ? html`<span class="dica">Nenhum e-mail conferido ainda.</span>` : null}
    ${GRUPOS_EMAIL.map(([k, t]) => { const g = porGrupo[k].slice(0, k === "outros" ? 4 : 5); if (!g.length) return null;
      return html`<div class="not-grupo" key=${k} data-grupo=${k}>
        <div class="not-grupo-t">${t}<span>${porGrupo[k].length}</span></div>
        ${g.map(e => html`<button type="button" key=${e.id} class="email-item" onClick=${() => ir("/email")}>
          <span class="not-h">${e.recebido_em ? fmtDataHora(e.recebido_em).slice(0, 10) : ""}</span>
          <strong>${e.assunto || "(sem assunto)"}</strong>
          <small>${e.de_nome || e.de_email}${(e.pendencias || []).length ? " · " + e.pendencias.join(", ") : ""}</small></button>`)}</div>`; })}
    <button type="button" class="emails-link" onClick=${() => ir("/email")}>Abrir a caixa de e-mail da oficina</button>
  </div>`;
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
