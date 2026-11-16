// Quem entra no app do celular e quais telas vê — definido pelo administrador em Sistema › Equipe (pedido do Danilo, 16/11/2026).
// Fica em cfg.appAcessos (tabela config, sem SQL): { [id do acesso]: { entra: true|false, telas: ["oleo", ...] } }.
// Sem nada gravado vale o padrão: administrador e consultor entram com todas as telas; mecânico e pendente não entram.
// Usado pelo app (app/app.js e app/telas.js) e pela tela Equipe (js/telas/admin.js). Sem window/document.
export const TELAS_APP = [
  ["oleo", "Óleo (aplicação)"], ["orcamento", "+ Orçamento"], ["agendar", "Agendar"],
  ["peca", "Consultar peça por catálogo"], ["historico", "Histórico de serviços"], ["osconsulta", "Consultar O.S."],
];
const TODAS = TELAS_APP.map(t => t[0]);

/** { entra, telas: [ids], padrao: true quando nada foi gravado para a pessoa } */
export function acessoApp(cfg, perfil) {
  if (!perfil || perfil.ativo === false || !perfil.papel || perfil.papel === "pendente") return { entra: false, telas: [], padrao: true };
  const a = ((cfg && cfg.appAcessos) || {})[perfil.id];
  const padrao = perfil.papel === "admin" || perfil.papel === "consultor";
  if (!a || typeof a !== "object") return { entra: padrao, telas: padrao ? TODAS.slice() : [], padrao: true };
  const telas = Array.isArray(a.telas) ? TODAS.filter(t => a.telas.includes(t)) : TODAS.slice();
  return { entra: a.entra === true, telas: a.entra === true ? telas : [], padrao: false };
}
