// Barra superior do computador: título da tela, busca rápida (F3), situação da conexão e da pasta de dados,
// botão Nova O.S. e troca de tema. Atalhos: F2 nova O.S., F3 busca, F4 O.S. em aberto, F6 produtos.
import { html, useState, useEffect, useRef, useMemo } from "../lib.js";
import { useApp, I, Modal } from "../ui.js";
import { norm, soDig, normPlaca, exPlaca, fmtTel, fmtDataHora, numOS } from "../util.js";
import { pode, STATUS, situacaoOS } from "../regras.js";
import { temaEfetivo, temaEscolhido, aplicarTema } from "../tema.js";

const ICON_SOL = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const ICON_LUA = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>`;
const ICON_BUSCA = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>`;

/** Botão de tema: Claro → Escuro → Automático */
export function BotaoTema({ classe, comTexto }) {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN(n => n + 1); window.addEventListener("dtcar-tema", f); const m = matchMedia("(prefers-color-scheme: dark)"); m.addEventListener && m.addEventListener("change", f);
    return () => { window.removeEventListener("dtcar-tema", f); m.removeEventListener && m.removeEventListener("change", f); }; }, []);
  const esc = temaEscolhido(), ef = temaEfetivo();
  const prox = esc === "claro" ? "escuro" : esc === "escuro" ? "auto" : "claro";
  const rot = esc === "auto" ? "Tema automático" : esc === "claro" ? "Tema claro" : "Tema escuro";
  return html`<button type="button" class=${classe || "btn btn-sm"} title=${rot + " · clique para " + { claro: "tema claro", escuro: "tema escuro", auto: "automático" }[prox]} aria-label=${rot} onClick=${() => aplicarTema(prox)}>
    ${ef === "escuro" ? ICON_LUA : ICON_SOL}${comTexto ? html`<span>${rot}</span>` : null}</button>`;
}

/** Busca rápida: número da O.S., placa, nome/telefone do cliente */
function BuscaRapida() {
  const { dados, ir } = useApp();
  const [q, setQ] = useState(""), [aberta, setAberta] = useState(false), [sel, setSel] = useState(0);
  const ref = useRef(null), inp = useRef(null);
  useEffect(() => {
    const tecla = e => { if (e.key === "F3" || (e.key === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); inp.current && inp.current.focus(); inp.current && inp.current.select(); } };
    const fora = e => { if (ref.current && !ref.current.contains(e.target)) setAberta(false); };
    document.addEventListener("keydown", tecla); document.addEventListener("pointerdown", fora);
    return () => { document.removeEventListener("keydown", tecla); document.removeEventListener("pointerdown", fora); };
  }, []);
  const res = useMemo(() => {
    const t = q.trim(); if (t.length < 2) return [];
    const n = norm(t), d = soDig(t), p = normPlaca(t), out = [];
    if (d && d === t && d.length <= 6) dados.ordens.filter(o => String(o.numero) === String(+d)).forEach(o => out.push({ k: "os" + o.id, ic: I.lista, t: numOS(o.numero) + " · " + exPlaca(o.veiculo.placa), s: o.cliente.nome + " · " + (situacaoOS(o) || { t: o.status }).t, r: "/os/" + o.id }));
    if (p.length >= 3) dados.veiculos.filter(v => v.placa && v.placa.includes(p)).slice(0, 6).forEach(v => out.push({ k: "v" + v.id, ic: I.carro, t: exPlaca(v.placa) + " · " + [v.marca, v.modelo].filter(Boolean).join(" "), s: ((dados.clientes.find(c => c.id === v.cliente_id) || {}).nome) || "sem proprietário", r: "/veiculo/" + v.id }));
    if (n.length >= 2) dados.clientes.filter(c => norm(c.nome).includes(n) || norm(c.fantasia).includes(n) || (d.length >= 4 && soDig(c.telefone).includes(d))).slice(0, 6)
      .forEach(c => out.push({ k: "c" + c.id, ic: I.pessoas, t: c.nome, s: [c.codigo ? "cód. " + c.codigo : "", c.telefone ? fmtTel(c.telefone) : ""].filter(Boolean).join(" · "), r: "/cliente/" + c.id }));
    return out.slice(0, 10);
  }, [q, dados]);
  useEffect(() => setSel(0), [q]);
  const abrir = r => { setQ(""); setAberta(false); inp.current && inp.current.blur(); ir(r.r); };
  const tecla = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(res.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && res[sel]) { e.preventDefault(); abrir(res[sel]); }
    else if (e.key === "Escape") { setQ(""); setAberta(false); e.target.blur(); }
  };
  return html`<div class="busca-rapida-topo" ref=${ref}>
    <span class="br-ic">${ICON_BUSCA}</span>
    <input ref=${inp} type="search" class="inp" aria-label="Busca rápida" placeholder="Buscar O.S., placa ou cliente" value=${q}
      onInput=${e => { setQ(e.target.value); setAberta(true); }} onFocus=${() => setAberta(true)} onKeyDown=${tecla} />
    <kbd>F3</kbd>
    ${aberta && q.trim().length >= 2 ? html`<div class="br-lista" role="listbox">${res.length ? res.map((r, i) => html`<button type="button" key=${r.k} role="option" aria-selected=${i === sel ? "true" : "false"} class=${i === sel ? "sel" : ""} onMouseEnter=${() => setSel(i)} onClick=${() => abrir(r)}>
        <span class="br-i">${r.ic}</span><span class="br-t"><b>${r.t}</b><small>${r.s}</small></span></button>`) : html`<div class="br-vazio">Nada encontrado para “${q}”.</div>`}</div>` : null}
  </div>`;
}

/** Situação da conexão, da fila e da pasta de dados */
function Situacao({ offline, pend, enviarFila }) {
  const { pasta, ir } = useApp();
  const pastaRuim = pasta && pasta.configurada && pasta.permissao !== "granted";
  const [cls, txt, dica] = offline ? ["off", "Sem internet", "Modo consulta. Dá para abrir O.S. nova; ela recebe o número quando a conexão voltar."]
    : pend.length ? ["pend", pend.length + " aguardando envio", "O.S. abertas sem internet. Clique para enviar agora."]
    : pastaRuim ? ["pend", "Reconectar pasta", "O navegador pediu para confirmar o acesso à pasta de dados do PC."]
    : ["on", "Conectado", pasta && pasta.ultimaGravacao ? "Pasta do PC gravada em " + fmtDataHora(pasta.ultimaGravacao) : "Dados sincronizados com o servidor"];
  return html`<button type="button" class=${"situacao s-" + cls} title=${dica} onClick=${() => pend.length && !offline ? enviarFila() : ir("/dados-locais")}><i></i><span>${txt}</span></button>`;
}

export function BarraTopo({ titulo, offline, pend, enviarFila }) {
  const { perfil, ir } = useApp();
  useEffect(() => {
    const tecla = e => {
      if (document.querySelector(".fundo-modal")) return;
      const mapa = { F2: pode(perfil, "entrada") ? "/entrada" : null, F4: "/ordens?filtro=abertas", F6: "/cadastros?aba=produtos" };
      if (mapa[e.key]) { e.preventDefault(); ir(mapa[e.key]); }
    };
    document.addEventListener("keydown", tecla); return () => document.removeEventListener("keydown", tecla);
  }, []);
  return html`<header class="barra-topo">
    <h1 class="bt-titulo">${titulo}</h1>
    <${BuscaRapida} />
    <div class="bt-dir">
      <${BotaoInstalar} />
      <${Situacao} offline=${offline} pend=${pend} enviarFila=${enviarFila} />
      <${BotaoTema} classe="btn-icone" />
      ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri btn-sm" title="Nova O.S. (F2)" onClick=${() => ir("/entrada")}>${I.mais}<span>Nova O.S.</span></button>` : null}
    </div>
  </header>`;
}

const ICON_INSTALAR = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4M12 7v6M9.5 10.5L12 13l2.5-2.5"/></svg>`;
export const instalado = () => matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || navigator.standalone === true;

/** Botão "Instalar no computador": usa a instalação do Chrome/Edge; sem ela, mostra o passo a passo */
export function BotaoInstalar({ classe, texto }) {
  const [evt, setEvt] = useState(window.__dtcarInstalar || null), [ajuda, setAjuda] = useState(false);
  useEffect(() => { const f = () => setEvt(window.__dtcarInstalar || null); window.addEventListener("dtcar-instalavel", f); return () => window.removeEventListener("dtcar-instalavel", f); }, []);
  if (instalado()) return null;
  const instalar = async () => {
    if (!evt) return setAjuda(true);
    evt.prompt(); const r = await evt.userChoice.catch(() => null);
    if (r && r.outcome === "accepted") { window.__dtcarInstalar = null; setEvt(null); }
  };
  const edge = /Edg\//.test(navigator.userAgent), cel = /Android|iPhone|iPad/i.test(navigator.userAgent), ios = /iPhone|iPad/i.test(navigator.userAgent);
  return html`<button type="button" class=${classe || "btn btn-sm botao-instalar"} title="Instalar o DTCar Gestão neste aparelho (ícone na área de trabalho, abre sem internet)" onClick=${instalar}>${ICON_INSTALAR}<span>${texto || "Instalar"}</span></button>
    ${ajuda ? html`<${Modal} titulo="Instalar o DTCar Gestão" onFechar=${() => setAjuda(false)}>
      ${location.protocol !== "https:" ? html`<div class="aviso">A instalação só funciona no endereço com <b>https://</b>. Aguarde o certificado do endereço novo ou use o endereço atual.</div>` : null}
      ${ios ? html`<ol class="passos-pasta"><li>No <b>Safari</b>, toque em <b>Compartilhar</b> (quadrado com seta).</li><li>Escolha <b>Adicionar à Tela de Início</b> e confirme.</li></ol>`
      : cel ? html`<ol class="passos-pasta"><li>No <b>Chrome</b>, toque no menu <b>⋮</b>.</li><li>Escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>) e confirme.</li></ol>`
      : edge ? html`<ol class="passos-pasta"><li>No <b>Edge</b>, clique no menu <b>…</b> (canto superior direito).</li><li>Vá em <b>Aplicativos</b> › <b>Instalar este site como um aplicativo</b>.</li><li>Confirme em <b>Instalar</b>. O ícone vai para a área de trabalho e o menu Iniciar.</li></ol>`
      : html`<ol class="passos-pasta"><li>No <b>Chrome</b>, clique no ícone de instalar na barra de endereço (um monitor com uma seta), ao lado da estrela de favoritos.</li><li>Se não aparecer: menu <b>⋮</b> › <b>Transmitir, salvar e compartilhar</b> › <b>Instalar página como app</b>.</li><li>Confirme em <b>Instalar</b>. O ícone vai para a área de trabalho.</li></ol>`}
      <p class="sub">Se o navegador não mostrar a opção, o sistema já pode estar instalado neste computador: procure “DTCar Gestão” no menu Iniciar.</p>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn btn-pri" onClick=${() => setAjuda(false)}>Entendi</button></div></${Modal}>` : null}`;
}
