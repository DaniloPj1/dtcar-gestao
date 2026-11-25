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

/** Hora de Brasília (0–23). Sem a tabela de fusos no aparelho, cai em UTC−3 (Brasília não tem horário de verão desde 2019). */
export function horaBrasilia(agora = new Date()) {
  try { return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hour12: false }).format(agora)); }
  catch (_) { return new Date(agora.getTime() - 10800000).getUTCHours(); }
}

/** Corrige a saudação do começo da mensagem para a hora em que ela está SAINDO. A mensagem é montada quando o
 *  Danilo clica, mas a fila pode segurar até o dia seguinte: sem isso, uma montada às 19h sairia "Boa noite" às 8h.
 *  Só a primeira saudação, nas primeiras linhas (o título vem antes); texto sem saudação não é tocado. */
export function comSaudacaoDoEnvio(texto, agora = new Date()) {
  const s = String(texto || "");
  if (!s) return s;
  const h = horaBrasilia(agora);
  const certa = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const linhas = s.split("\n");
  for (let i = 0; i < Math.min(linhas.length, 4); i++) {
    const m = /^(Bom dia|Boa tarde|Boa noite)\b/.exec(linhas[i]);
    if (!m) continue;
    if (m[1] !== certa) linhas[i] = certa + linhas[i].slice(m[1].length);
    return linhas.join("\n");
  }
  return s;
}

/** Envia texto como uma pessoa: "digitando…" por alguns segundos, depois a mensagem. Devolve o id da mensagem. */
export async function enviarTexto(sock, jid, texto, esperar = (ms) => new Promise((r) => setTimeout(r, ms))) {
  texto = comSaudacaoDoEnvio(texto);
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

// ---------------------------------------------------------------------
// v65: GRUPO como destino (pedido do Danilo em 25/11/2026). Regra dele: "atender apenas grupos com
// o meu número e do meu sócio". Quem confere de verdade é aqui, na hora do envio: a lista de
// participantes do grupo é lida no WhatsApp e comparada com a que ele aprovou na tela. Entrou alguém
// (um cliente, um fornecedor), a mensagem NÃO sai. A cópia igual está em supabase/functions/zap/index.ts.
// ---------------------------------------------------------------------

/** JID de grupo do WhatsApp (…@g.us). */
export const conversaGrupo = (jid) => /@g\.us$/.test(String(jid || ""));

/** Número do WhatsApp conectado (o da oficina), tirado do sock. */
export const numeroDoSock = (sock) => String((sock && sock.user && sock.user.id) || "").split("@")[0].split(":")[0].replace(/\D/g, "");

/** Chave de comparação de telefone, a MESMA da whatsapp_chave_tel do banco: DDD + últimos 8 dígitos
 *  (o 9 do celular às vezes falta no WhatsApp, e o 55 às vezes não vem). */
export function chaveTel(tel) {
  const d = String(tel || "").replace(/\D/g, "");
  if (d.length < 10) return d.slice(-8);
  const corte = d.length === 11 || d.length === 13 ? 10 : 9;
  const i = d.length - corte - 1;
  return d.slice(i, i + 2) + d.slice(-8);
}

/** Telefone de um participante do grupo. O WhatsApp pode mandar só o @lid (identificador interno),
 *  e aí não há número para conferir: devolve "" e o grupo é tratado como não conferível. */
export function telefoneDoParticipante(p) {
  const cands = [p && p.phoneNumber, p && p.jid, p && p.id, p && p.lid];
  for (const c of cands) { const s = String(c || ""); if (/@s\.whatsapp\.net$/.test(s)) return s.split("@")[0].split(":")[0].replace(/\D/g, ""); }
  for (const c of cands) { const d = String(c || "").split("@")[0].split(":")[0].replace(/\D/g, ""); if (/^55\d{10,11}$/.test(d)) return d; }
  return "";
}

/** Participantes de um grupo: ids crus (para comparar com o que foi aprovado) e os números legíveis. */
export function participantesDoGrupo(meta) {
  const lista = (meta && meta.participants) || [];
  const ids = [], numeros = []; let semNumero = 0;
  for (const p of lista) {
    const id = String((p && (p.id || p.jid || p.lid)) || "");
    if (!id) continue;
    ids.push(id);
    const t = telefoneDoParticipante(p);
    if (t) numeros.push(t); else semNumero++;
  }
  ids.sort();
  return { ids, numeros, semNumero, total: ids.length };
}

/** O grupo pode receber mensagem da oficina? Só se todo participante for o próprio número da oficina
 *  ou um dos autorizados (o do Danilo e o do sócio). Devolve { ok, motivo }. */
export function grupoLiberado({ participantes, autorizados, meuNumero }) {
  const p = participantes || { ids: [], numeros: [], semNumero: 0, total: 0 };
  const ok = (autorizados || []).map(chaveTel).filter(Boolean);
  const meu = chaveTel(meuNumero);
  if (!p.total) return { ok: false, motivo: "não deu para ler os participantes do grupo" };
  if (!ok.length) return { ok: false, motivo: "nenhum número autorizado cadastrado em Sistema › WhatsApp" };
  if (p.semNumero) return { ok: false, motivo: "o WhatsApp não informou o número de " + p.semNumero + " participante(s) deste grupo" };
  const fora = p.numeros.filter((n) => { const k = chaveTel(n); return k !== meu && ok.indexOf(k) < 0; });
  if (fora.length) return { ok: false, motivo: "participante não autorizado: " + fora.join(", ") };
  return { ok: true, motivo: "" };
}

/** O grupo continua igual ao que o Danilo aprovou na tela? Entrou ou saiu alguém = não envia. */
export function grupoIgualAoEscolhido(participantes, idsEscolhidos) {
  const a = ((participantes && participantes.ids) || []).slice().sort();
  const b = (idsEscolhidos || []).map(String).slice().sort();
  if (!a.length || !b.length) return { ok: false, motivo: "sem a lista de participantes para conferir" };
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    return { ok: false, motivo: "o grupo mudou de participantes desde a escolha (eram " + b.length + ", agora são " + a.length + "): confira em Sistema › WhatsApp" };
  }
  return { ok: true, motivo: "" };
}

/** Grupos do WhatsApp da oficina, já conferidos pela regra, para a tela escolher. */
export async function listarGrupos(sock, autorizados, meuNumero) {
  const todos = (await sock.groupFetchAllParticipating()) || {};
  const lista = [];
  for (const jid of Object.keys(todos)) {
    if (!conversaGrupo(jid)) continue;
    const meta = todos[jid] || {};
    const p = participantesDoGrupo(meta);
    const r = grupoLiberado({ participantes: p, autorizados, meuNumero });
    lista.push({ jid, nome: String(meta.subject || "").slice(0, 120), participantes: p.total,
                 ids: p.ids, numeros: p.numeros, autorizado: r.ok, motivo: r.motivo });
  }
  lista.sort((a, b) => (a.autorizado === b.autorizado ? String(a.nome).localeCompare(String(b.nome)) : a.autorizado ? -1 : 1));
  return lista;
}

/** Conferência do grupo na hora do envio: lista de participantes de AGORA contra a aprovada. */
export async function conferirGrupoAgora(sock, grupo, meuNumero) {
  const meta = await sock.groupMetadata((grupo && grupo.jid) || "");
  const p = participantesDoGrupo(meta);
  const mesmo = grupoIgualAoEscolhido(p, grupo && grupo.ids);
  if (!mesmo.ok) return mesmo;
  return grupoLiberado({ participantes: p, autorizados: (grupo && grupo.numeros) || [], meuNumero });
}
