// Tema da tela: claro, escuro ou automático (segue o Windows/celular). Guardado neste aparelho.
const LS = "dtcar-tema";
export const temaEscolhido = () => { try { return JSON.parse(localStorage.getItem(LS) || "null") || "auto"; } catch (e) { return "auto"; } };
export const temaEfetivo = () => { const t = temaEscolhido(); return t === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro") : t; };
export function aplicarTema(t) {
  try { if (t === "auto") localStorage.removeItem(LS); else localStorage.setItem(LS, JSON.stringify(t)); } catch (e) {}
  if (t === "auto") delete document.documentElement.dataset.tema; else document.documentElement.dataset.tema = t;
  window.dispatchEvent(new Event("dtcar-tema"));
}
/** alterna entre claro e escuro a partir do que está na tela */
export const alternarTema = () => aplicarTema(temaEfetivo() === "escuro" ? "claro" : "escuro");
