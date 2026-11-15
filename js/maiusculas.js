// Regra do Danilo (15/11/2026): os cadastros ficam em LETRAS MAIÚSCULAS — nome do cliente e descrição de produtos e serviços.
// Vale para o que for gravado daqui em diante (cadastro novo ou cadastro aberto e salvo de novo); o que já estava gravado não é mexido.
// As telas mostram o campo em maiúsculas enquanto a pessoa digita (classe "maiusc") e gravam com MAIUSC().
// Arquivo separado de util.js e regras.js de propósito: mexer neles obrigaria a publicar de novo a função "email".

/** "  joão  da silva " → "JOÃO DA SILVA" (acentos certos; espaço sobrando sai) */
export const MAIUSC = s => String(s ?? "").replace(/\s+/g, " ").trim().toLocaleUpperCase("pt-BR");
