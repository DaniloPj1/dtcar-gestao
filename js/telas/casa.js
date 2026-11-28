// Janelas do Painel que vieram do jeito do celular (pedido do Danilo em 22/11/2026 e 25/11/2026):
// atalhos, previsão do tempo em Colatina/ES (Open-Meteo, sem chave) com a hora e o mini calendário da semana,
// notícias por prioridade (cidade › estado › país), cotação do dólar e das outras moedas (AwesomeAPI, sem chave)
// e os e-mails que chegaram, por prioridade (contabilidade › Objetiva › outros).
// Regras da casa: nada fica em "Carregando…" sem fim (tempo-limite em toda chamada), sem internet
// as janelas explicam em uma linha, e nome/descrição sempre escritos (nunca só um ícone ou cor).
import { html, useState, useEffect } from "../lib.js";
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

/** Relógio da janela do tempo: hora de Colatina, acertada de minuto em minuto (pedido do Danilo em 25/11/2026) */
function useAgora() {
  const [t, setT] = useState(() => new Date());
  useEffect(() => { const i = setInterval(() => setT(new Date()), 30000); return () => clearInterval(i); }, []);
  return t;
}
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

export function ClimaJanela() {
  const [d, setD] = useState(() => doCache("dtcar-clima")), [erro, setErro] = useState("");
  const agora = useAgora();
  useEffect(() => { let vivo = true;
    if (d) return;
    buscar(`https://api.open-meteo.com/v1/forecast?latitude=${LAT}&longitude=${LON}&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=America%2FSao_Paulo&forecast_days=7`)
      .then(r => r.json()).then(j => { if (!vivo) return; const dd = { agora: Math.round(j.current.temperature_2m), cod: j.current.weather_code,
        dias: j.daily.time.map((t, n) => ({ t, cod: j.daily.weather_code[n], max: Math.round(j.daily.temperature_2m_max[n]), min: Math.round(j.daily.temperature_2m_min[n]), chuva: j.daily.precipitation_probability_max[n] })) };
        setD(dd); paraCache("dtcar-clima", dd); })
      .catch(() => { if (vivo) setErro("Não deu para buscar a previsão agora (precisa de internet)."); });
    return () => { vivo = false; }; }, []);
  if (erro && !d) return html`<div class="clima clima-off"><span class="dica">${erro}</span></div>`;
  if (!d) return html`<div class="clima clima-off"><span class="dica">Buscando a previsão…</span></div>`;
  const hoje = d.dias[0] || {};
  const hhmm = agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const dataLonga = DIAS_LONGOS[agora.getDay()] + ", " + agora.getDate() + " de " + MESES[agora.getMonth()];
  return html`<div class="clima">
    <div class="clima-ln">
      <${IconeTempo} cod=${d.cod} />
      <div class="clima-ag"><div class="clima-t">${d.agora}<sup>°C</sup></div>
        <strong>${tempoTexto(d.cod)}</strong><span>Colatina · ES</span></div>
      <div class="clima-relogio"><b>${hhmm}</b><span>${dataLonga}</span>
        <small>Máxima ${hoje.max}° · Mínima ${hoje.min}° · Chuva ${hoje.chuva}%</small></div>
    </div>
    <div class="clima-cal">${d.dias.map((x, n) => { const dt = new Date(x.t + "T12:00:00");
      return html`<div key=${x.t} class=${"clima-dia" + (n === 0 ? " clima-hoje" : "")}>
        <span class="clima-dia-nome">${n === 0 ? "Hoje" : DIAS[dt.getDay()]}</span>
        <span class="clima-dia-num">${dt.getDate()}</span>
        <${IconeTempo} cod=${x.cod} tam=${30} />
        <b>${x.max}°</b><span class="clima-dia-min">${x.min}°</span>
        <small>${tempoTexto(x.cod)}${x.chuva >= 30 ? " · " + x.chuva + "%" : ""}</small></div>`; })}</div>
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
  { k: "estado", t: "Espírito Santo", rss: "https://g1.globo.com/rss/g1/es/espirito-santo/", hosts: /^https:\/\/g1\.globo\.com\// },
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

function lerRSS(texto, hosts) {
  const doc = new DOMParser().parseFromString(texto, "text/xml");
  return [...doc.querySelectorAll("item")].map(i => ({
    t: (i.querySelector("title") || {}).textContent || "",
    u: (i.querySelector("link") || {}).textContent || "",
    q: (i.querySelector("pubDate") || {}).textContent || "",
    fonte: ((i.getElementsByTagName("source")[0] || {}).textContent || "").trim(),
  })).filter(i => i.t && /^https:\/\//.test(i.u) && hosts.test(i.u));
}

export function NoticiasJanela() {
  const [d, setD] = useState(() => doCache("dtcar-noticias3")), [erro, setErro] = useState("");
  const [soAfetam, setSoAfetam] = useState(() => !!lsGet(LS_FILTRO));
  useEffect(() => { let vivo = true;
    if (d) return;
    Promise.all(FONTES.map(f => buscar("https://corsproxy.io/?url=" + encodeURIComponent(f.rss))
      .then(r => r.text()).then(x => ({ k: f.k, itens: lerRSS(x, f.hosts).slice(0, 8) })).catch(() => ({ k: f.k, itens: [], falhou: true }))))
      .then(r => { if (!vivo) return;
        if (r.every(x => !x.itens.length)) throw new Error("vazio");
        const dd = Object.fromEntries(r.map(x => [x.k, x.itens]));
        setD(dd); paraCache("dtcar-noticias3", dd); })
      .catch(() => { if (vivo) setErro("Não deu para buscar as notícias agora (precisa de internet)."); });
    return () => { vivo = false; }; }, []);
  if (erro && !d) return html`<span class="dica">${erro}</span>`;
  if (!d) return html`<span class="dica">Buscando as notícias…</span>`;
  const hora = q => { if (!q) return ""; const x = new Date(q); return isNaN(x) ? "" : x.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
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
        ${l.map(n => html`<a key=${n.u} href=${n.u} target="_blank" rel="noopener noreferrer">
          <span class="not-h">${hora(n.q)}</span><strong>${n.t}</strong>${n.fonte ? html`<small>${n.fonte}</small>` : null}</a>`)}</div>`; })}
  </div>`;
}

// ---------- Cotação do dólar e de outras moedas (pedido do Danilo em 25/11/2026) ----------
/* AwesomeAPI (economia.awesomeapi.com.br), sem chave e sem cadastro — a mesma casa da API de CEP que já estava
   aprovada. O dólar fica grande, como no celular; as outras moedas ficam na lista ao lado, e a escolhida troca de
   lugar com o dólar. A variação vem SEMPRE escrita ("subiu"/"caiu"), nunca só pela cor: em P&B seria a mesma seta. */
export const MOEDAS = [["USD", "Dólar"], ["EUR", "Euro"], ["GBP", "Libra"], ["ARS", "Peso argentino"], ["BTC", "Bitcoin"]];
const LS_MOEDA = "dtcar-moeda";
const reaisMoeda = v => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: Number(v) >= 1000 ? 2 : 4, maximumFractionDigits: Number(v) >= 1000 ? 2 : 4 });
export function MoedasJanela() {
  const [d, setD] = useState(() => doCache("dtcar-moedas")), [erro, setErro] = useState("");
  const [moeda, setMoeda] = useState(() => lsGet(LS_MOEDA) || "USD");
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
        ${quando ? html`<small>Atualizado em ${quando}</small>` : null}</div>
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
