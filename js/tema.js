// Tema da tela: claro, escuro, automático (segue o Windows/celular) ou por horário. Guardado neste aparelho.
// "Por horário" (pedido do Danilo em 25/11/2026): claro das 6h às 18h e escuro das 18h às 6h, pelo relógio do aparelho.
// A troca acontece sozinha com o sistema aberto: o relógio é conferido de minuto em minuto (ligarRelogioDoTema).
const LS = "dtcar-tema";
export const CLARO_DE = 6, CLARO_ATE = 18;   // das 6h (inclusive) às 18h (exclusive) o tema é claro
export const temaEscolhido = () => { try { return JSON.parse(localStorage.getItem(LS) || "null") || "auto"; } catch (e) { return "auto"; } };
/** tema que o horário pede agora (hora = 0 a 23; sem hora, a do aparelho) */
export const temaDoHorario = (hora = new Date().getHours()) => hora >= CLARO_DE && hora < CLARO_ATE ? "claro" : "escuro";
export const temaEfetivo = () => { const t = temaEscolhido();
  return t === "horario" ? temaDoHorario() : t === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "escuro" : "claro") : t; };
export function aplicarTema(t) {
  try { if (t === "auto") localStorage.removeItem(LS); else localStorage.setItem(LS, JSON.stringify(t)); } catch (e) {}
  // no "por horário" quem manda no atributo é o relógio; "auto" não põe atributo (o CSS segue o aparelho)
  if (t === "auto") delete document.documentElement.dataset.tema;
  else document.documentElement.dataset.tema = t === "horario" ? temaDoHorario() : t;
  window.dispatchEvent(new Event("dtcar-tema"));
}
/** alterna entre claro e escuro a partir do que está na tela */
export const alternarTema = () => aplicarTema(temaEfetivo() === "escuro" ? "claro" : "escuro");
/** Com o tema "por horário", confere o relógio de minuto em minuto e troca sozinho às 6h e às 18h. */
export function ligarRelogioDoTema() {
  const conferir = () => {
    if (temaEscolhido() !== "horario") return;
    const certo = temaDoHorario();
    if (document.documentElement.dataset.tema !== certo) { document.documentElement.dataset.tema = certo; window.dispatchEvent(new Event("dtcar-tema")); }
  };
  conferir();
  const i = setInterval(conferir, 60000);
  document.addEventListener("visibilitychange", conferir);   // computador que ficou suspenso acerta o tema ao voltar
  return () => { clearInterval(i); document.removeEventListener("visibilitychange", conferir); };
}
