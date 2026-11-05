// Funções comuns do WhatsApp (motor do Android). A função "zap" do Supabase tem uma cópia igual em
// supabase/functions/zap/index.ts (ela é publicada como arquivo único): mudou aqui, mude lá — os testes
// (teste/teste_motor.js e teste/teste_zap.ts) rodam os mesmos casos nas duas.

/** Só conversa individual (nada de grupo, status, lista de transmissão ou canal). */
export const conversaIndividual = (jid) => /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
const digitosJid = (jid) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");

/** Telefone da conversa: o JID de telefone (@s.whatsapp.net) entre os que a mensagem traz (o WhatsApp às vezes usa @lid). */
export function telefoneDaChave(k) {
  const c = [k && k.remoteJid, k && k.remoteJidAlt, k && k.senderPn, k && k.participantAlt].find((j) => /@s\.whatsapp\.net$/.test(String(j || "")));
  return c ? digitosJid(c) : "";
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
  const r = { msg_id: k.id, jid: k.remoteJid, telefone: telefoneDaChave(k), nome: k.fromMe ? "" : String(m.pushName || "").slice(0, 80),
    de_mim: !!k.fromMe, texto: t.texto.slice(0, 4000), tipo: t.tipo, em: new Date(ts ? ts * 1000 : Date.now()).toISOString() };
  const cit = mensagemCitada(m); if (cit) r.responde_a = cit;
  return r;
}

/** v36: id da mensagem citada com "Responder" (o Danilo responde em cima do aviso para dizer de qual cliente é). */
export function mensagemCitada(m) {
  const c = conteudo(m); if (!c) return "";
  for (const k of Object.keys(TIPOS)) {
    const ci = c[k] && typeof c[k] === "object" && c[k].contextInfo;
    if (ci && ci.stanzaId) return String(ci.stanzaId).slice(0, 200);
  }
  return "";
}

/** Mídia que vale baixar de uma mensagem RECEBIDA: áudio (para transcrever; o arquivo não é guardado) e foto
 *  (guardada 30 dias). null = nada a baixar. Com "pular", não baixa e registra o motivo. */
export const LIMITE_AUDIO_S = 600, LIMITE_AUDIO_BYTES = 8 * 1024 * 1024, LIMITE_FOTO_BYTES = 5 * 1024 * 1024;
const numero = (v) => Number(v && typeof v === "object" ? (v.low ?? v.toString()) : v) || 0;
export function midiaParaBaixar(m) {
  const k = m && m.key; if (!k || !k.id || k.fromMe || !conversaIndividual(k.remoteJid)) return null;
  const c = conteudo(m); if (!c) return null;
  if (c.audioMessage) {
    const a = c.audioMessage, segundos = numero(a.seconds), bytes = numero(a.fileLength);
    const r = { msg_id: k.id, tipo: "audio", mime: String(a.mimetype || "audio/ogg").split(";")[0], segundos };
    if (segundos > LIMITE_AUDIO_S || bytes > LIMITE_AUDIO_BYTES) r.pular = "Áudio longo demais para transcrever (mais de 10 minutos).";
    return r;
  }
  if (c.imageMessage) {
    const f = c.imageMessage, bytes = numero(f.fileLength);
    const mime = String(f.mimetype || "image/jpeg").split(";")[0];
    const r = { msg_id: k.id, tipo: "imagem", mime: /^image\/(jpeg|png|webp)$/.test(mime) ? mime : "image/jpeg", segundos: 0 };
    if (bytes > LIMITE_FOTO_BYTES) r.pular = "Foto grande demais para guardar (mais de 5 MB).";
    return r;
  }
  return null;
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

/** Valida o PDF baixado para a mensagem da fila (v34): tamanho certo e cabeçalho de PDF. */
export function pdfConfere(bytes, arquivo) {
  if (!bytes || !bytes.length) return "PDF vazio.";
  if (arquivo && arquivo.bytes && bytes.length !== Number(arquivo.bytes)) return "PDF com tamanho diferente do gerado (" + bytes.length + " de " + arquivo.bytes + " bytes).";
  if (String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]) !== "%PDF-") return "O arquivo baixado não é um PDF.";
  return "";
}

/** Mensagem da fila (v34): o texto (com "digitando…") e, logo depois, o PDF (documento, sem legenda). Devolve o id do texto
 *  (ou do PDF, se for só ele). Se o texto saiu e o PDF não, o erro leva idTexto (o texto não pode ser mandado de novo). */
export async function enviarComArquivo(sock, jid, texto, arquivo, esperar = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let id = "";
  if (texto) id = await enviarTexto(sock, jid, texto, esperar);
  if (!arquivo) return id;
  try {
    if (id) await esperar(2500);
    const r = await sock.sendMessage(jid, { document: arquivo.dados, mimetype: arquivo.tipo || "application/pdf", fileName: arquivo.nome });
    return id || (r && r.key && r.key.id) || "";
  } catch (e) {
    if (!id) throw e;
    const x = new Error("O texto saiu, mas o PDF não: " + ((e && e.message) || e)); x.idTexto = id; throw x;
  }
}
