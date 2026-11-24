// Quem entra no app do celular e quais telas vê — definido pelo administrador em Sistema › Equipe (pedido do Danilo, 16/11/2026).
// Fica em cfg.appAcessos (tabela config, sem SQL): { [id do acesso]: { entra: true|false, telas: ["oleo", ...] } }.
// Sem nada gravado vale o padrão: administrador e consultor entram com todas as telas; mecânico e pendente não entram.
// Usado pelo app (app/app.js e app/telas.js) e pela tela Equipe (js/telas/admin.js). Sem window/document.
export const TELAS_APP = [
  ["servico", "Iniciar serviço"], ["oleo", "Óleo (aplicação)"], ["orcamento", "Orçamentos (pedido)"], ["agendar", "Agendar"], ["agenda", "Agenda (lista)"],
  ["peca", "Consultar peça por catálogo"], ["historico", "Histórico de serviços"], ["meus", "Meus serviços (quinzena)"], ["osconsulta", "Consultar O.S."],
  // Diagnóstico: eram uma tela só e viraram família (20/11/2026). Cada uma é liberada por pessoa,
  // porque o que elas fazem é muito diferente — ler o carro e ESCREVER nele não são a mesma coisa.
  ["obd", "Diagnóstico OBD (ELM327)"],
  ["modulos", "Módulos do carro (UDS)"],
  ["atuadores", "Atuadores (aciona saída no carro)"],
  ["aprendizados", "Aprendizados e calibrações"],
  ["bico", "Programar bico (grava na ECU)"],
];
const TODAS = TELAS_APP.map(t => t[0]);
/** Telas que o papel pode usar. Desde 16/11/2026 (à tarde) o orçamento no app é só um PEDIDO (sem item e sem preço), então o mecânico
 *  liberado também pode pedir orçamento e acrescentar ao orçamento aberto; o sistema monta e aprova. */
export const telasDoPapel = papel => {
  // Agendar grava direto em `agendamentos`, e a política do banco (v54) só aceita administrador e
  // consultor. Liberar a tela para o mecânico dava um formulário que nunca grava (revisão do Codex,
  // 23/11/2026): a tela nem é oferecida. Se um dia o mecânico tiver de agendar, é SQL novo.
  return papel === "mecanico" ? TODAS.filter(t => t !== "agendar") : TODAS.slice();
};

/* ---- Login por usuário, sem e-mail (pedido do Danilo, 16/11/2026 à noite) ----
 * O Supabase exige um e-mail por conta, então o usuário "joao" vira o e-mail interno joao@app.dtcarcentroautomotivo.com.br
 * (domínio da oficina; nunca recebe mensagem: a conta nasce confirmada). Quem tem e-mail de verdade continua entrando com ele. */
export const DOMINIO_USUARIO = "app.dtcarcentroautomotivo.com.br";
export const usuarioValido = u => /^[a-z0-9][a-z0-9._-]{1,28}[a-z0-9]$/.test(String(u || "")) && !/[._-]{2}/.test(String(u || ""));
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

/* ---- Apagar falha no OBD (v62, decisão do Danilo em 19/11/2026) ----
 * "deixar essas opções reservadas para o adm e no painel do sistema o adm permite ou não o acesso por mecânico".
 * Apagar é o único comando que o app manda PARA o carro: o administrador sempre pode; qualquer outra pessoa só com
 * cfg.appAcessos[id].obd_apagar === true, marcado por ele em Sistema › Equipe. Quem não tem a tela do OBD não apaga nada. */
export function podeApagarObd(cfg, perfil) {
  // Vale nas DUAS telas que apagam: a leitura comum (apagar do OBD-II) e Módulos do carro (apagar de
  // um módulo). Antes exigia só "obd", então quem tinha só Módulos nunca apagava e a chave em
  // Sistema › Equipe nem aparecia para essa pessoa — confuso de administrar, e o apagar por módulo
  // ficava inalcançável. Achado da revisão independente de 20/11/2026.
  return podeNoObd(cfg, perfil, "obd_apagar", ["obd", "modulos"]);
}

/* ---- O que AGE no carro (20/11/2026) ----
 * Apagar falha era o único comando que saía do app para o carro. Agora há mais três, e cada um é
 * mais sério que o anterior:
 *   obd_atuar   → aciona uma saída (ventoinha, bomba, bico, lanterna). Mexe em peça que se move.
 *   obd_aprender→ roda rotina de aprendizado e calibração. Muda o jeito do módulo trabalhar.
 *   obd_gravar  → grava dado de calibração, como o código do bico. Fica gravado na ECU.
 * Vale a mesma regra do apagar, que o Danilo decidiu em 19/11/2026: o administrador sempre pode;
 * qualquer outra pessoa só com a marca dele em Sistema › Equipe. E ninguém faz nada sem ter a
 * tela — não existe permissão solta: a permissão é sempre "esta pessoa, nesta tela".
 */
export function podeNoObd(cfg, perfil, marca, tela) {
  const a = acessoApp(cfg, perfil);
  const quais = Array.isArray(tela) ? tela : [tela];
  if (!a.entra || !quais.some(t => a.telas.includes(t))) return false;
  if (perfil.papel === "admin") return true;
  const g = ((cfg && cfg.appAcessos) || {})[perfil.id];
  return g ? g[marca] === true : false;
}
export const podeAtuarObd = (cfg, perfil) => podeNoObd(cfg, perfil, "obd_atuar", "atuadores");
export const podeAprenderObd = (cfg, perfil) => podeNoObd(cfg, perfil, "obd_aprender", "aprendizados");
export const podeGravarObd = (cfg, perfil) => podeNoObd(cfg, perfil, "obd_gravar", "bico");

/** As permissões do diagnóstico, para a tela Equipe desenhar sozinha a partir daqui. */
export const PERMISSOES_OBD = [
  ["obd_apagar", "Apagar falha", ["obd", "modulos"], "Apaga os códigos do carro. A foto do momento da falha some junto."],
  ["obd_atuar", "Testar atuador", "atuadores", "Aciona uma saída do carro: ventoinha, bomba, lanterna. Mexe em peça que se move."],
  ["obd_aprender", "Rodar aprendizado", "aprendizados", "Roda calibração e aprendizado. Muda o jeito do módulo trabalhar."],
  ["obd_gravar", "Programar bico", "bico", "Grava o código do bico na ECU. Fica gravado."],
];

/** { entra, telas: [ids], padrao: true quando nada foi gravado para a pessoa, horario: {de, ate, dias} | null (nunca para o administrador) } */
export function acessoApp(cfg, perfil) {
  if (!perfil || perfil.ativo === false || !perfil.papel || perfil.papel === "pendente") return { entra: false, telas: [], padrao: true, horario: null };
  const a = ((cfg && cfg.appAcessos) || {})[perfil.id];
  const padrao = perfil.papel === "admin" || perfil.papel === "consultor", doPapel = telasDoPapel(perfil.papel);
  if (!a || typeof a !== "object") return { entra: padrao, telas: padrao ? doPapel : [], padrao: true, horario: null };
  // O ADMINISTRADOR vê todas as telas, sempre (decisão do Danilo, 21/11/2026). A lista gravada dele era de
  // antes de Módulos, Atuadores e Aprendizados existirem, e essas telas não apareciam no app dele.
  const telas = perfil.papel === "admin" ? doPapel : Array.isArray(a.telas) ? doPapel.filter(t => a.telas.includes(t)) : doPapel;
  const horario = perfil.papel !== "admin" && horarioValido(a.horario) ? { de: a.horario.de, ate: a.horario.ate, dias: a.horario.dias.map(Number) } : null;
  return { entra: a.entra === true, telas: a.entra === true ? telas : [], padrao: false, horario };
}
