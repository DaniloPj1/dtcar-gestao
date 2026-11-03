// Funções comuns do WhatsApp (motor do Android). A função "zap" do Supabase tem uma cópia igual em
// supabase/functions/zap/index.ts (ela é publicada como arquivo único): mudou aqui, mude lá — os testes
// (teste/teste_motor.js e teste/teste_zap.ts) rodam os mesmos casos nas duas.

/** Só conversa individual (nada de grupo, status, lista de transmissão ou canal). */
export const conversaIndividual = (jid) => /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
const digitos = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");

/** Telefone da conversa: o JID de telefone (@s.whatsapp.net) entre os que a mensagem traz (o WhatsApp às vezes usa @lid). */
export function telefoneDaChave(k) {
  const c = [k && k.remoteJid, k && k.remoteJidAlt, k && k.senderPn, k && k.participantAlt].find((j) => /@s\.whatsapp\.net$/.test(String(j || "")));
  return c ? digitos(c) : "";
}

const TIPOS = { conversation: "texto", extendedTextMessage: "texto", imageMessage: "imagem", videoMessage: "video", audioMessage: "audio",
  documentMessage: "documento", stickerMessage: "figurinha", locationMessage: "localizacao", liveLocationMessage: "localizacao",
  contactMessage: "contato", contactsArrayMessage: "contato", pollCreationMessage: "enquete", pollCreationMessageV3: "enquete" };

/** Desembrulha mensagens temporárias, de visualização única e documento com legenda. */
function conteudo(m) {
  let c = m && m.message;
  for (let i = 0; i < 4 && c; i++) {
    const dentro = (c.ephemeralMessage || c.viewOnceMessage || c.viewOnceMessageV2 || c.viewOnceMessageV2Extension || c.documentWithCaptionMessage || {}).message;
    if (!dentro) break; c = dentro;
  }
  return c || null;
}

/** Texto e tipo de uma mensagem do WhatsApp (mídia vira "[imagem] legenda"; o arquivo não é guardado). */
export function textoDaMensagem(m) {
  const c = conteudo(m); if (!c) return null;
  const chave = Object.keys(TIPOS).find((k) => c[k]); if (!chave) return null;
  const v = c[chave]; const tipo = TIPOS[chave];
  const txt = typeof v === "string" ? v : (v.text || v.caption || v.name || v.displayName || v.fileName || "");
  return { tipo, texto: tipo === "texto" ? String(txt) : `[${tipo}]${txt ? " " + txt : ""}` };
}

/** Converte a mensagem para guardar no banco (null = não guarda: grupo, status, aviso interno do WhatsApp). */
export function paraGuardar(m) {
  const k = m && m.key; if (!k || !k.id || !conversaIndividual(k.remoteJid)) return null;
  const t = textoDaMensagem(m); if (!t) return null;
  const ts = Number(m.messageTimestamp && (m.messageTimestamp.low ?? m.messageTimestamp)) || 0;
  return { msg_id: k.id, jid: k.remoteJid, telefone: telefoneDaChave(k), nome: k.fromMe ? "" : String(m.pushName || "").slice(0, 80),
    de_mim: !!k.fromMe, texto: t.texto.slice(0, 4000), tipo: t.tipo, em: new Date(ts ? ts * 1000 : Date.now()).toISOString() };
}

/** Variações do número brasileiro (com e sem o 9 do celular): o WhatsApp de contas antigas pode não ter o 9. */
export function variacoes(tel) {
  const d = String(tel || "").replace(/\D/g, ""); const v = [d];
  if (/^55\d{2}9\d{8}$/.test(d)) v.push(d.slice(0, 4) + d.slice(5));
  else if (/^55\d{2}[6-9]\d{7}$/.test(d)) v.push(d.slice(0, 4) + "9" + d.slice(4));
  return v;
}

/** Acha o JID certo do número no WhatsApp (null = número sem WhatsApp). */
export async function jidParaEnvio(sock, tel) {
  for (const n of variacoes(tel)) {
    const r = await sock.onWhatsApp(n);
    const a = Array.isArray(r) ? r.find((x) => x && x.exists) : null;
    if (a) return a.jid;
  }
  return null;
}

/** Envia texto como uma pessoa: "digitando…" por alguns segundos, depois a mensagem. Devolve o id da mensagem. */
export async function enviarTexto(sock, jid, texto, esperar = (ms) => new Promise((r) => setTimeout(r, ms))) {
  try { await sock.presenceSubscribe(jid); } catch (_) { /* opcional */ }
  try { await sock.sendPresenceUpdate("composing", jid); } catch (_) { /* opcional */ }
  await esperar(Math.min(1500 + String(texto).length * 35, 6000));
  try { await sock.sendPresenceUpdate("paused", jid); } catch (_) { /* opcional */ }
  const r = await sock.sendMessage(jid, { text: texto });
  return (r && r.key && r.key.id) || "";
}
