// Quem entra no app do celular e quais telas vê — definido pelo administrador em Sistema › Equipe (pedido do Danilo, 16/11/2026).
// Fica em cfg.appAcessos (tabela config, sem SQL): { [id do acesso]: { entra: true|false, telas: ["oleo", ...] } }.
// Sem nada gravado vale o padrão: administrador e consultor entram com todas as telas; mecânico e pendente não entram.
// Usado pelo app (app/app.js e app/telas.js) e pela tela Equipe (js/telas/admin.js). Sem window/document.
export const TELAS_APP = [
  ["oleo", "Óleo (aplicação)"], ["orcamento", "Orçamentos (pedido)"], ["agendar", "Agendar"],
  ["peca", "Consultar peça por catálogo"], ["historico", "Histórico de serviços"], ["osconsulta", "Consultar O.S."],
];
const TODAS = TELAS_APP.map(t => t[0]);
/** Telas que o papel pode usar. Desde 16/11/2026 (à tarde) o orçamento no app é só um PEDIDO (sem item e sem preço), então o mecânico
 *  liberado também pode pedir orçamento e acrescentar ao orçamento aberto; o sistema monta e aprova. */
export const telasDoPapel = () => TODAS.slice();

/* ---- Login por usuário, sem e-mail (pedido do Danilo, 16/11/2026 à noite) ----
 * O Supabase exige um e-mail por conta, então o usuário "joao" vira o e-mail interno joao@app.dtcarcentroautomotivo.com.br
 * (domínio da oficina; nunca recebe mensagem: a conta nasce confirmada). Quem tem e-mail de verdade continua entrando com ele. */
export const DOMINIO_USUARIO = "app.dtcarcentroautomotivo.com.br";
export const usuarioValido = u => /^[a-z0-9][a-z0-9._-]{2,29}$/.test(String(u || ""));
/** o que a pessoa digitou na tela de entrar → e-mail para o Supabase */
export const emailDoLogin = txt => { const t = String(txt || "").trim().toLowerCase(); return !t || t.includes("@") ? t : t + "@" + DOMINIO_USUARIO; };
/** e-mail interno → nome de usuário; e-mail de verdade → "" */
export const usuarioDoEmail = email => { const e = String(email || "").toLowerCase(), fim = "@" + DOMINIO_USUARIO; return e.endsWith(fim) ? e.slice(0, -fim.length) : ""; };
/** como mostrar o login da pessoa na Equipe */
export const loginParaMostrar = email => { const u = usuarioDoEmail(email); return u ? "usuário " + u : String(email || ""); };

/* ---- Horário em que o colaborador pode usar o app (pedido do Danilo, 16/11/2026 à noite) ----
 * cfg.appAcessos[id].horario = { de: "07:30", ate: "18:00", dias: [1,2,3,4,5,6] } (0 = domingo). Sem horário gravado = sem limite.
 * O administrador nunca é limitado. */
export const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const HORARIO_PADRAO = { de: "07:30", ate: "18:00", dias: [1, 2, 3, 4, 5, 6] };
const minutos = h => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(h || "")); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
export const horarioValido = h => !!h && typeof h === "object" && minutos(h.de) !== null && minutos(h.ate) !== null && minutos(h.de) < minutos(h.ate) && Array.isArray(h.dias) && h.dias.length > 0;
/** "" dentro do horário; senão o motivo, para mostrar na tela */
export function foraDoHorario(h, agora = new Date()) {
  if (!horarioValido(h)) return "";
  const dia = agora.getDay(), min = agora.getHours() * 60 + agora.getMinutes();
  const dias = h.dias.slice().sort().map(d => DIAS_SEMANA[d]).join(", ");
  if (!h.dias.includes(dia)) return "Hoje não é dia de uso do app (" + dias + ", das " + h.de + " às " + h.ate + ").";
  if (min < minutos(h.de) || min >= minutos(h.ate)) return "Fora do horário de trabalho: o app funciona das " + h.de + " às " + h.ate + " (" + dias + ").";
  return "";
}

/** { entra, telas: [ids], padrao: true quando nada foi gravado para a pessoa, horario: {de, ate, dias} | null (nunca para o administrador) } */
export function acessoApp(cfg, perfil) {
  if (!perfil || perfil.ativo === false || !perfil.papel || perfil.papel === "pendente") return { entra: false, telas: [], padrao: true, horario: null };
  const a = ((cfg && cfg.appAcessos) || {})[perfil.id];
  const padrao = perfil.papel === "admin" || perfil.papel === "consultor", doPapel = telasDoPapel(perfil.papel);
  if (!a || typeof a !== "object") return { entra: padrao, telas: padrao ? doPapel : [], padrao: true, horario: null };
  const telas = Array.isArray(a.telas) ? doPapel.filter(t => a.telas.includes(t)) : doPapel;
  const horario = perfil.papel !== "admin" && horarioValido(a.horario) ? { de: a.horario.de, ate: a.horario.ate, dias: a.horario.dias.map(Number) } : null;
  return { entra: a.entra === true, telas: a.entra === true ? telas : [], padrao: false, horario };
}
