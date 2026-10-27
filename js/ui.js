import { html, createContext, useContext, useState, useEffect, useRef } from "./lib.js";
import { exPlaca, num2, parseValor } from "./util.js";
import { api } from "./api.js";
import { STATUS } from "./regras.js";

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

export const I = {
  painel: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>`,
  mais: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`,
  lista: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6h12M9 12h12M9 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="3"/></svg>`,
  pessoas: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5"/><path d="M16 4.7a3.5 3.5 0 010 6.6M18.5 14.8c1.8.7 2.8 2.4 3 5.2"/></svg>`,
  menu: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>`,
  chave: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 00-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 005.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>`,
  ajuste: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/></svg>`,
  sair: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/></svg>`,
  whats: html`<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 00-8.6 15.1L2 22l5-1.3A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 01-3.3-2.9c-.2-.4.3-.4.8-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.3 3 3 0 00-.9 2.2 5.2 5.2 0 001.1 2.7 11.8 11.8 0 004.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3z"/></svg>`,
};

export function Placa({ placa, grande }) {
  return html`<span class=${"placa" + (grande ? " p-g" : "")} aria-label=${"Placa " + exPlaca(placa)}><span class="faixa">BRASIL</span><span class="num">${exPlaca(placa) || "-------"}</span></span>`;
}
export function Status({ s }) {
  const st = STATUS[s] || { curto: s, cor: "muted" };
  return html`<span class=${"pill p-" + st.cor}>${st.curto}</span>`;
}
export function Campo({ id, rotulo, obrig, dica, erro, children }) {
  return html`<div class="campo"><label for=${id}>${rotulo}${obrig ? html` <i>*</i>` : null}</label>${children}${erro ? html`<span class="dica erro">${erro}</span>` : dica ? html`<span class="dica">${dica}</span>` : null}</div>`;
}
export function Texto({ id, valor, onMuda, ...resto }) {
  return html`<input id=${id} class="inp" value=${valor ?? ""} onInput=${e => onMuda(e.target.value)} ...${resto} />`;
}
export function Area({ id, valor, onMuda, ...resto }) {
  return html`<textarea id=${id} class="inp" value=${valor ?? ""} onInput=${e => onMuda(e.target.value)} ...${resto}></textarea>`;
}
/** Campo de valor em reais: aceita "1.234,56" e mostra formatado ao sair */
export function Dinheiro({ id, valor, onMuda, disabled }) {
  const [txt, setTxt] = useState(valor ? num2(valor) : "");
  const foco = useRef(false);
  useEffect(() => { if (!foco.current) setTxt(valor ? num2(valor) : ""); }, [valor]);
  return html`<div class="inp-din"><span>R$</span><input id=${id} class="inp" inputmode="decimal" disabled=${disabled} value=${txt}
    onFocus=${() => { foco.current = true; }} onInput=${e => { setTxt(e.target.value); onMuda(parseValor(e.target.value)); }}
    onBlur=${() => { foco.current = false; setTxt(valor ? num2(valor) : ""); }} /></div>`;
}
export function Seg({ opcoes, valor, onEscolha, rotulo }) {
  return html`<div class="seg" role="group" aria-label=${rotulo}>${opcoes.map(([t, s]) => html`<button type="button" key=${t} class=${"s-" + s} aria-pressed=${valor === t ? "true" : "false"} onClick=${() => onEscolha(t, s)}>${t}</button>`)}</div>`;
}
export function Abas({ abas, ativa, onTroca }) {
  return html`<div class="abas" role="tablist">${abas.map(([k, t]) => html`<button type="button" key=${k} role="tab" aria-selected=${ativa === k ? "true" : "false"} onClick=${() => onTroca(k)}>${t}</button>`)}</div>`;
}
export function Modal({ titulo, onFechar, children, largo }) {
  useEffect(() => { const k = e => { if (e.key === "Escape") onFechar(); }; document.addEventListener("keydown", k); document.body.classList.add("sem-rolagem");
    return () => { document.removeEventListener("keydown", k); document.body.classList.remove("sem-rolagem"); }; }, []);
  return html`<div class="fundo-modal" onClick=${e => { if (e.target === e.currentTarget) onFechar(); }}>
    <div class=${"modal" + (largo ? " largo" : "")} role="dialog" aria-modal="true" aria-label=${titulo}>
      <div class="modal-topo"><h2>${titulo}</h2><button type="button" class="fechar" aria-label="Fechar" onClick=${onFechar}>×</button></div>${children}</div></div>`;
}
/** Imagem guardada no Supabase Storage (URL assinada temporária) */
export function Foto({ caminho, alt, ...resto }) {
  const [url, setUrl] = useState("");
  useEffect(() => { let vivo = true; if (caminho) api.urlArquivo(caminho).then(u => vivo && setUrl(u)).catch(() => {}); return () => { vivo = false; }; }, [caminho]);
  return url ? html`<img src=${url} alt=${alt || ""} loading="lazy" ...${resto} />` : html`<span class="sub">…</span>`;
}

/** Quadro de assinatura com o dedo */
export function PadAssinatura({ apiRef, altura = 170 }) {
  const cv = useRef(null), sujo = useRef(false), [temTraco, setTemTraco] = useState(false);
  useEffect(() => {
    const c = cv.current, ctx = c.getContext("2d");
    const ajusta = () => { const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1; c.width = r.width * d; c.height = r.height * d; ctx.setTransform(d, 0, 0, d, 0, 0); ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = "#0e1520"; sujo.current = false; setTemTraco(false); };
    ajusta();
    let des = false;
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const ini = e => { des = true; try { c.setPointerCapture(e.pointerId); } catch (x) {} const [x, y] = pos(e); ctx.beginPath(); ctx.moveTo(x, y); };
    const mov = e => { if (!des) return; const [x, y] = pos(e); ctx.lineTo(x, y); ctx.stroke(); if (!sujo.current) { sujo.current = true; setTemTraco(true); } };
    const fim = () => { des = false; };
    c.addEventListener("pointerdown", ini); c.addEventListener("pointermove", mov); c.addEventListener("pointerup", fim); c.addEventListener("pointercancel", fim);
    apiRef.current = { vazio: () => !sujo.current, limpar: () => ajusta(), blob: () => new Promise(ok => c.toBlob(ok, "image/png")) };
    return () => { c.removeEventListener("pointerdown", ini); c.removeEventListener("pointermove", mov); c.removeEventListener("pointerup", fim); c.removeEventListener("pointercancel", fim); };
  }, []);
  return html`<div class="assin-wrap"><canvas ref=${cv} class="assin" style=${{ height: altura + "px" }} aria-label="Área para assinatura"></canvas>
    <div class="acoes"><span class="sub" style=${{ marginRight: "auto" }}>${temTraco ? "Assinatura registrada" : "Assine com o dedo no quadro acima"}</span>
    <button type="button" class="btn btn-sm" onClick=${() => apiRef.current.limpar()}>Limpar</button></div></div>`;
}

export function ItemChecklist({ it, r, onMuda, faltando, soLeitura }) {
  const mostraObs = r && (r.s === "bad" || r.s === "warn" || r.s === "info" || r.obs);
  return html`<div class=${"item" + (faltando ? " faltando" : "")} id=${"it-" + it.k}>
    <div class="item-l">${it.l}</div>
    <${Seg} rotulo=${it.l} opcoes=${it.op} valor=${r && r.v} onEscolha=${(v, s) => !soLeitura && onMuda(it.k, { v, s, obs: (r && r.obs) || "" })} />
    ${mostraObs ? html`<input class="inp" id=${"obs-" + it.k} placeholder="Observação (opcional)" value=${r.obs || ""} onInput=${e => onMuda(it.k, { ...r, obs: e.target.value })} />` : null}
  </div>`;
}
export function SecaoChecklist({ s, resp, onMuda, faltando }) {
  const tudoOk = () => s.itens.forEach(it => { const op = it.op[0]; if (!resp[it.k]) onMuda(it.k, { v: op[0], s: op[1], obs: "" }); });
  const pend = s.itens.filter(it => !resp[it.k]).length;
  return html`<section class="card" aria-labelledby=${"s-" + s.id}>
    <div class="secao-topo"><h3 id=${"s-" + s.id}>${s.titulo}</h3>
      ${pend ? html`<button type="button" class="btn btn-sm" onClick=${tudoOk}>Marcar pendentes como “${s.itens[0].op[0]}”</button>` : html`<span class="pill p-ok">Completo</span>`}</div>
    <div>${s.itens.map(it => html`<${ItemChecklist} key=${it.k} it=${it} r=${resp[it.k]} onMuda=${onMuda} faltando=${faltando && faltando.has(it.k)} />`)}</div>
  </section>`;
}
export function Vazio({ children }) { return html`<div class="vazio">${children}</div>`; }
