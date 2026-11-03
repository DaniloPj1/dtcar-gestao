// Teste do motor do WhatsApp (motor-zap/motor.js) sem rede: banco e WhatsApp simulados.
// Rodar: (cd motor-zap && npm ci) && node teste/teste_motor.js
import { criarMotor, vinculado, lerConfig } from "../motor-zap/motor.js";
import { paraGuardar, variacoes, jidParaEnvio, enviarTexto } from "../motor-zap/whats.js";
import { readFileSync } from "node:fs";
import { DisconnectReason } from "../motor-zap/node_modules/baileys/lib/index.js";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ok = [], falhas = [];
const confere = (n, c, x = "") => (c ? ok : falhas).push(n + (x ? ` (${x})` : ""));
const CHAVE = "dtm_" + "a".repeat(64);

// ---------- banco simulado com as mesmas regras do v24 ----------
function banco() {
  const b = { sessao: new Map(), con: { situacao: "conectado", numero: "", dono: "", dono_id: null, dono_ate: 0, pedido: null, detalhe: "" },
    chamadas: [], fora: false, chaveValida: CHAVE, agora: 1e6, sessaoEm: 0, fila: [], resultados: [], msgs: [] };
  const erro = (msg, code) => ({ ok: false, status: 400, text: async () => JSON.stringify({ message: msg, code }) });
  const resp = (v) => ({ ok: true, status: 200, text: async () => (v === undefined ? "" : JSON.stringify(v)) });
  b.buscar = async (url, op) => {
    const nome = url.split("/rpc/")[1]; const a = JSON.parse(op.body); b.chamadas.push(nome);
    if (op.headers.apikey !== "pub" || op.headers.authorization) return erro("cabeçalho errado");
    if (b.fora) throw new TypeError("fetch failed");
    if (a.p_chave !== b.chaveValida) return erro("Chave do motor inválida ou revogada.", "28000");
    const comVez = () => b.con.dono === "android" && b.con.dono_id === a.p_id && b.con.dono_ate > b.agora;
    if (nome === "whatsapp_motor_pulso") {
      b.info = a.p_info;
      const c = b.sessao.has("creds") ? JSON.parse(b.sessao.get("creds")) : null;
      const vinculado = !!(c && ((c.me && c.me.id) || c.registered));
      if (!vinculado) { if (b.con.dono_id === a.p_id) b.con.dono_ate = 0; return resp({ vez: false, vinculado, dono: b.con.dono }); }
      const continua = b.con.dono === "android" && b.con.dono_id === a.p_id && b.con.dono_ate > b.agora;
      const vez = !b.con.dono_ate || b.con.dono_ate < b.agora || b.con.dono_id === a.p_id;
      if (vez) Object.assign(b.con, { dono: "android", dono_id: a.p_id, dono_ate: b.agora + 90000 });
      return resp({ vez, continua: vez && continua, sessao_em: new Date(b.sessaoEm).toISOString(), vinculado, pedido: vez ? b.con.pedido : null, dono: b.con.dono, situacao: b.con.situacao });
    }
    if (nome === "whatsapp_motor_mensagens") { for (const x of a.p_msgs) if (!b.msgs.some((y) => y.msg_id === x.msg_id)) b.msgs.push(x); return resp(a.p_msgs.length); }
    if (nome === "whatsapp_motor_resultado") { b.resultados.push(a); const f = b.fila.find((x) => x.id === a.p_fila_id); if (f) f.status = a.p_ok ? "enviada" : "erro"; return resp(); }
    if (nome === "whatsapp_motor_soltar") { if (b.con.dono_id === a.p_id) b.con.dono_ate = 0; return resp(); }
    if (!comVez()) return erro("O motor não está com a vez da conexão.", "55000");
    if (nome === "whatsapp_motor_proxima") { const f = b.fila.find((x) => x.status === "pendente"); if (!f) return resp({ motivo: "fila vazia" }); f.status = "enviando"; return resp({ mensagem: { id: f.id, telefone: f.telefone, texto: f.texto } }); }
    if (nome === "whatsapp_motor_ler") return resp(Object.fromEntries(a.p_chaves.filter((k) => b.sessao.has(k)).map((k) => [k, JSON.parse(b.sessao.get(k))])));
    if (nome === "whatsapp_motor_gravar") { for (const k in a.p_poe) b.sessao.set(k, JSON.stringify(a.p_poe[k])); for (const k of a.p_tira) b.sessao.delete(k); b.sessaoEm = b.agora; return resp(new Date(b.agora).toISOString()); }
    if (nome === "whatsapp_motor_apagar_sessao") { b.sessao.clear(); if (a.p_detalhe != null) Object.assign(b.con, { situacao: "desligado", numero: "", pedido: null, detalhe: a.p_detalhe }); return resp(); }
    if (nome === "whatsapp_motor_situacao") {
      Object.assign(b.con, { situacao: a.p_situacao, detalhe: a.p_detalhe }); if (a.p_numero != null) b.con.numero = a.p_numero;
      if (a.p_limpar_pedido) b.con.pedido = null; return resp();
    }
    return erro("função desconhecida " + nome);
  };
  return b;
}

// ---------- WhatsApp simulado ----------
function fabrica() {
  const f = { sockets: [] };
  f.criar = (opcoes) => {
    const ouvintes = {};
    const s = { opcoes, fechado: false, saiu: false, user: { id: "5527992470140:7@s.whatsapp.net" },
      ev: { on: (n, fn) => { (ouvintes[n] ||= []).push(fn); } },
      emitir: async (n, v) => { for (const fn of ouvintes[n] || []) await fn(v); },
      end: () => { s.fechado = true; }, logout: async () => { s.saiu = true; },
      enviadas: [], presencas: [], semWhats: new Set(), so8: new Set(),
      onWhatsApp: async (n) => [{ exists: !s.semWhats.has(n) && !(s.so8.has(n.slice(0, 4) + "9" + n.slice(4)) === false && s.so8.size && !s.so8.has(n)), jid: n + "@s.whatsapp.net" }],
      presenceSubscribe: async () => {}, sendPresenceUpdate: async (p, j) => { s.presencas.push(p); },
      sendMessage: async (jid, c) => { if (s.falhaEnvio) throw new Error("sem rede"); s.enviadas.push({ jid, texto: c.text }); return { key: { id: "M" + s.enviadas.length } }; } };
    f.sockets.push(s); return s;
  };
  return f;
}
const espera = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const silencioso = { log() {}, error() {} };
const fechamento = (codigo) => ({ connection: "close", lastDisconnect: { error: Object.assign(new Error("caiu " + codigo), { output: { statusCode: codigo } }) } });

function novo(b, f, extra = {}) {
  return criarMotor({ config: { url: "https://x.supabase.co", publica: "pub", chave: CHAVE, aparelho: "Galaxy A15" }, buscar: (u, o) => b.buscar(u, o), criarSocket: f.criar, saida: silencioso, agora: () => b.agora, esperasGravar: [0, 0, 0], esperarDigitando: async () => {}, ...extra });
}
// sessão vinculada pelo QR (só creds.me), com bytes no formato do conversor da biblioteca
function sessaoVinculada(b) {
  b.sessao.set("creds", JSON.stringify({ me: { id: "5527992470140:7@s.whatsapp.net" }, registered: false,
    noiseKey: { private: { type: "Buffer", data: "AQID" }, public: { type: "Buffer", data: "BAUG" } }, signedIdentityKey: { private: { type: "Buffer", data: "AQID" }, public: { type: "Buffer", data: "BAUG" } },
    signedPreKey: { keyPair: { private: { type: "Buffer", data: "AQID" }, public: { type: "Buffer", data: "BAUG" } }, signature: { type: "Buffer", data: "AQID" }, keyId: 1 },
    registrationId: 1, advSecretKey: "x", processedHistoryMessages: [], nextPreKeyId: 1, firstUnuploadedPreKeyId: 1, accountSyncCounter: 0, accountSettings: { unarchiveChats: false } }));
}

// 1) conecta, grava situação, sessão vai e volta com bytes
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  await m.pulso(); await espera();
  confere("pulso pega a vez e abre a conexão", f.sockets.length === 1 && b.con.dono === "android");
  const s = f.sockets[0];
  confere("não fica 'online' (o celular continua recebendo notificação)", s.opcoes.markOnlineOnConnect === false && s.opcoes.syncFullHistory === false);
  confere("credenciais carregadas com bytes", Buffer.isBuffer(s.opcoes.auth.creds.noiseKey.public) && s.opcoes.auth.creds.noiseKey.public.toString("hex") === "040506");
  await s.emitir("connection.update", { connection: "open" }); await espera();
  confere("aberto: situação conectado com o número", b.con.situacao === "conectado" && b.con.numero === "5527992470140" && m.st.aberto);
  await s.opcoes.auth.keys.set({ session: { "abc": Buffer.from([9, 8, 7]) }, "pre-key": { "1": null } }); await espera();
  confere("chave gravada no banco no formato do conversor", JSON.parse(b.sessao.get("k:session:abc")).type === "Buffer");
  s.opcoes.auth.creds.me.name = "DTCar"; await s.emitir("creds.update", {}); await espera();
  confere("creds.update grava as credenciais", JSON.parse(b.sessao.get("creds")).me.name === "DTCar");
  await s.emitir("messages.upsert", { type: "notify", messages: [{ key: { fromMe: false } }, { key: { fromMe: true } }, { key: { fromMe: false } }] });
  await s.emitir("messages.upsert", { type: "append", messages: [{ key: { fromMe: false } }] });
  await m.pulso();
  confere("conta só as recebidas novas e manda no pulso", b.info.recebidas === 2 && b.info.conectado === true && b.info.aparelho === "Galaxy A15", JSON.stringify(b.info));
  await m.pulso(); confere("pulso com conexão aberta não abre outra", f.sockets.length === 1);

  // perde a vez (ex.: revogaram e o zap pegou): fecha
  Object.assign(b.con, { dono: "supabase", dono_id: "z", dono_ate: b.agora + 60000 });
  await m.pulso();
  confere("perdeu a vez: fecha a conexão", s.fechado && !m.st.sock);

  // vez de volta + pedido de desconectar
  b.con.dono_ate = 0; await m.pulso(); await espera(); const s2 = f.sockets[1];
  await s2.emitir("connection.update", { connection: "open" }); await espera();
  b.con.pedido = "desconectar"; await m.pulso(); await espera();
  confere("pedido de desconectar: logout, sessão apagada, pedido limpo", s2.saiu && b.sessao.size === 0 && b.con.situacao === "desligado" && b.con.pedido === null);
  b.agora += 120000; await m.pulso();
  confere("sem sessão: não pega a vez nem abre conexão", f.sockets.length === 2 && m.st.semVinculo && b.con.dono_ate === 0);
  await m.encerrar(); confere("encerrar solta a vez", b.chamadas.at(-1) === "whatsapp_motor_soltar" && b.con.dono_ate === 0);
}

// 1b) pedido de desconectar com falha ao apagar a sessão: mantém o pedido e tenta de novo, sem reconectar
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  await m.pulso(); await espera(); await f.sockets[0].emitir("connection.update", { connection: "open" }); await espera();
  b.con.pedido = "desconectar"; const original = b.buscar;
  b.buscar = async (url, op) => (url.endsWith("whatsapp_motor_apagar_sessao") ? { ok: false, status: 503, text: async () => '{"message":"indisponível"}' } : original(url, op));
  await m.pulso(); await espera();
  confere("falha ao apagar: pedido mantido e sessão continua no banco", b.con.pedido === "desconectar" && b.sessao.has("creds") && b.con.situacao !== "desligado");
  b.agora += 61000; await m.pulso(); await espera();
  confere("falha ao apagar: não reabre a sessão", f.sockets.length === 1);
  b.buscar = original; await m.pulso(); await espera();
  confere("apagar voltou: sessão apagada e pedido limpo", !b.sessao.has("creds") && b.con.pedido === null && b.con.situacao === "desligado");
}

// 1c) gravação da sessão recusada: a mudança fica pendente, a biblioteca recebe o erro, e o sinal manda de novo
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  await m.pulso(); await espera(); const s = f.sockets[0]; await s.emitir("connection.update", { connection: "open" }); await espera();
  const original = b.buscar;
  b.buscar = async (url, op) => (url.endsWith("whatsapp_motor_gravar") ? { ok: false, status: 503, text: async () => '{"message":"indisponível"}' } : original(url, op));
  let erro = null; try { await s.opcoes.auth.keys.set({ session: { "xyz": Buffer.from([1, 2]) } }); } catch (e) { erro = e; }
  confere("gravação recusada: a biblioteca recebe o erro", !!erro && m.pendentes.size === 1 && !b.sessao.has("k:session:xyz"));
  const lido = await s.opcoes.auth.keys.get("session", ["xyz"]);
  confere("gravação recusada: leitura usa a mudança pendente", Buffer.isBuffer(lido.xyz) && lido.xyz[1] === 2);
  await m.pulso(); confere("banco ainda recusando: continua pendente", m.pendentes.size === 1);
  b.buscar = original; await m.pulso();
  confere("banco voltou: o sinal grava a pendente", m.pendentes.size === 0 && JSON.parse(b.sessao.get("k:session:xyz")).type === "Buffer");
  // pendente quando a vez passa para o Supabase: descarta (não sobrescreve a sessão que ele avançou)
  b.buscar = async (url, op) => (url.endsWith("whatsapp_motor_gravar") ? { ok: false, status: 503, text: async () => "{}" } : original(url, op));
  try { await s.opcoes.auth.keys.set({ session: { "abc": Buffer.from([3]) } }); } catch (_) { /* esperado */ }
  b.buscar = original; Object.assign(b.con, { dono: "supabase", dono_id: "z", dono_ate: b.agora + 60000 }); await m.pulso();
  confere("vez passou para o Supabase: descarta as pendentes", m.pendentes.size === 0 && !b.sessao.has("k:session:abc"));
}

// 1d) vez interrompida e retomada: pendentes só vão se ninguém mexeu na sessão no meio
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  await m.pulso(); await espera(); const s = f.sockets[0]; await s.emitir("connection.update", { connection: "open" }); await espera();
  await s.opcoes.auth.keys.set({ session: { "ok1": Buffer.from([1]) } }); // gravação normal: guarda a hora do banco
  const original = b.buscar;
  b.buscar = async (url, op) => (url.endsWith("whatsapp_motor_gravar") ? { ok: false, status: 503, text: async () => "{}" } : original(url, op));
  try { await s.opcoes.auth.keys.set({ session: { "velha": Buffer.from([7]) } }); } catch (_) { /* esperado */ }
  b.buscar = original;
  // a vez venceu; o zap assumiu, gravou a sessão e soltou antes do próximo sinal do motor
  b.agora += 100000; b.sessao.set("k:session:velha", JSON.stringify({ type: "Buffer", data: "CQ==" })); b.sessaoEm = b.agora; b.con.dono_ate = 0;
  await m.pulso();
  confere("vez retomada depois que o zap mexeu: descarta pendentes antigas", m.pendentes.size === 0 && JSON.parse(b.sessao.get("k:session:velha")).data === "CQ==");
  // sem ninguém mexer no meio: a pendente vai
  b.buscar = async (url, op) => (url.endsWith("whatsapp_motor_gravar") ? { ok: false, status: 503, text: async () => "{}" } : original(url, op));
  await m.pulso(); await espera(); const s2 = f.sockets.at(-1); await s2.emitir("connection.update", { connection: "open" }); await espera();
  try { await s2.opcoes.auth.keys.set({ session: { "nova": Buffer.from([5]) } }); } catch (_) { /* esperado */ }
  b.buscar = original; b.agora += 100000; b.con.dono_ate = 0; await m.pulso();
  confere("vez retomada sem ninguém mexer: grava a pendente", m.pendentes.size === 0 && b.sessao.has("k:session:nova"));
  await m.encerrar();
}

// 1e) a guarda venceu enquanto carregava a sessão: não abre a conexão
{
  const b = banco(), f = fabrica(); sessaoVinculada(b);
  const timers = []; const relogio = { iniciar: (fn, ms) => { const t = { fn, ms, ativo: true }; timers.push(t); return t; }, parar: (t) => { t.ativo = false; } };
  const original = b.buscar;
  b.buscar = async (url, op) => { if (url.endsWith("whatsapp_motor_ler")) { const t = timers.find((x) => x.ativo); if (t) { t.ativo = false; t.fn(); } } return original(url, op); };
  const m = novo(b, f, { relogio });
  await m.pulso(); await espera();
  confere("guarda venceu durante o carregamento: não abre a conexão", f.sockets.length === 0 && !m.st.sock && !m.st.conectando);
  b.buscar = original; await m.pulso(); await espera();
  confere("próximo sinal confirma a vez: abre", f.sockets.length === 1);
  await m.encerrar();
}

// 1f) fila (v25): envia uma por sinal, com "digitando", grava o resultado; número sem WhatsApp vira erro
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  b.fila.push({ id: 1, telefone: "5527999112233", texto: "Seu carro está pronto", status: "pendente" }, { id: 2, telefone: "5527988887777", texto: "Orçamento", status: "pendente" });
  await m.pulso(); await espera(); const s = f.sockets[0]; s.semWhats.add("5527988887777"); s.semWhats.add("552788887777");
  await m.pulso(); confere("fila: sem conexão aberta não envia", s.enviadas.length === 0 && b.fila[0].status === "pendente");
  await s.emitir("connection.update", { connection: "open" }); await espera();
  await m.pulso();
  confere("fila: envia a primeira com digitando", s.enviadas.length === 1 && s.enviadas[0].jid === "5527999112233@s.whatsapp.net" && s.presencas.includes("composing") && s.presencas.includes("paused"));
  confere("fila: resultado gravado com o id da mensagem", b.resultados[0].p_ok === true && b.resultados[0].p_msg_id === "M1" && b.fila[0].status === "enviada");
  await m.pulso();
  confere("fila: número sem WhatsApp vira erro", s.enviadas.length === 1 && b.resultados[1].p_ok === false && /sem WhatsApp/.test(b.resultados[1].p_erro));
  b.fila.push({ id: 3, telefone: "5527999112233", texto: "x", status: "pendente" }); s.falhaEnvio = true; await m.pulso();
  confere("fila: falha ao enviar vira erro (não repete sozinha)", b.resultados[2].p_ok === false && /Falha ao enviar/.test(b.resultados[2].p_erro));
  // resultado não gravado (banco fora na hora): tenta de novo no próximo sinal
  s.falhaEnvio = false; b.fila.push({ id: 4, telefone: "5527999112233", texto: "y", status: "pendente" });
  const original = b.buscar; b.buscar = async (url, op) => (url.endsWith("whatsapp_motor_resultado") ? { ok: false, status: 503, text: async () => "{}" } : original(url, op));
  await m.pulso(); confere("fila: resultado não gravado fica guardado", m.st.resultados.length === 1);
  b.fila.push({ id: 5, telefone: "5527999112233", texto: "z", status: "pendente" }); const antes = s.enviadas.length; await m.pulso();
  confere("fila: com resultado pendente não envia outra", s.enviadas.length === antes && b.fila.find((x) => x.id === 5).status === "pendente");
  b.buscar = original; await m.pulso(); confere("fila: resultado guardado vai no próximo sinal (e a seguinte sai)", m.st.resultados.length === 0 && b.resultados.some((x) => x.p_fila_id === 4) && b.fila.find((x) => x.id === 5).status === "enviada");
  // recebidas: guarda as individuais, ignora grupo
  await s.emitir("messages.upsert", { type: "notify", messages: [
    { key: { id: "R1", remoteJid: "5527999112233@s.whatsapp.net" }, pushName: "Cliente", messageTimestamp: 1793736000, message: { conversation: "Obrigado!" } },
    { key: { id: "G1", remoteJid: "1203@g.us" }, message: { conversation: "grupo" } }] });
  await espera();
  confere("recebidas: guarda a individual e ignora grupo", b.msgs.length === 1 && b.msgs[0].texto === "Obrigado!" && b.msgs[0].telefone === "5527999112233");
  b.buscar = async (url, op) => (url.endsWith("whatsapp_motor_mensagens") ? { ok: false, status: 503, text: async () => "{}" } : original(url, op));
  await s.emitir("messages.upsert", { type: "notify", messages: [{ key: { id: "R2", remoteJid: "5527999112233@s.whatsapp.net" }, message: { conversation: "Outra" } }] }); await espera();
  confere("recebidas: banco fora, ficam aqui", m.st.aGuardar.length === 1);
  b.buscar = original; await m.pulso(); await espera();
  confere("recebidas: vão no próximo sinal", m.st.aGuardar.length === 0 && b.msgs.some((x) => x.msg_id === "R2"));
  await m.encerrar();
}

// 1g) funções comuns (mesmos casos do teste da função zap)
{
  const casos = JSON.parse(readFileSync(new URL("./casos_whats.json", import.meta.url), "utf8"));
  for (const c of casos.paraGuardar) {
    const r = paraGuardar(c.m);
    const certo = c.esperado === null ? r === null : r && Object.entries(c.esperado).every(([k, v]) => r[k] === v);
    confere("paraGuardar: " + c.nome, certo, JSON.stringify(r));
  }
  for (const c of casos.variacoes) confere("variações do número " + c.tel, JSON.stringify(variacoes(c.tel)) === JSON.stringify(c.esperado), JSON.stringify(variacoes(c.tel)));
  const sock = { onWhatsApp: async (n) => [{ exists: n === "552799112233", jid: n + "@s.whatsapp.net" }] };
  confere("jid: conta antiga sem o 9 é achada", (await jidParaEnvio(sock, "5527999112233")) === "552799112233@s.whatsapp.net");
  confere("jid: número sem WhatsApp devolve null", (await jidParaEnvio({ onWhatsApp: async () => [] }, "5527999112233")) === null);
}

// 2) quedas
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  await m.pulso(); await espera(); let s = f.sockets[0];
  await s.emitir("connection.update", fechamento(500)); await espera();
  await m.pulso();
  confere("queda comum: espera antes de reconectar", f.sockets.length === 1 && m.st.proximaTentativa > b.agora);
  b.agora += 6000; await m.pulso(); await espera();
  confere("depois da espera: reconecta", f.sockets.length === 2);
  s = f.sockets[1]; await s.emitir("connection.update", fechamento(DisconnectReason.restartRequired)); await m.pulso(); await espera();
  confere("restartRequired: reconecta na hora", f.sockets.length === 3);
  s = f.sockets[2]; await s.emitir("connection.update", fechamento(DisconnectReason.loggedOut)); await espera();
  confere("celular desvinculou: apaga a sessão e marca desligado", b.sessao.size === 0 && b.con.situacao === "desligado" && b.con.numero === "");
}

// 3) banco fora do ar com conexão aberta: larga a conexão antes da vez vencer
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  await m.pulso(); await espera(); await f.sockets[0].emitir("connection.update", { connection: "open" }); await espera();
  b.fora = true; b.agora += 30000; await m.pulso();
  confere("banco fora por 30 s: mantém a conexão", !f.sockets[0].fechado);
  b.agora += 45000; await m.pulso();
  confere("banco fora por 75 s: larga a conexão (a vez vence em 90 s)", f.sockets[0].fechado && !m.st.sock);
  b.fora = false; b.agora += 1000; await m.pulso(); await espera();
  confere("banco voltou: pega a vez e reconecta", f.sockets.length === 2);
}

// 4) chave revogada
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); const m = novo(b, f);
  await m.pulso(); await espera(); await f.sockets[0].emitir("connection.update", { connection: "open" }); await espera();
  b.chaveValida = "outra"; await m.pulso();
  confere("chave revogada: fecha e para", f.sockets[0].fechado && m.st.chaveRuim);
  await m.pulso(); confere("chave revogada: não tenta conectar", f.sockets.length === 1);
}

// 4b) guarda independente do pulso: sem confirmação nova em 70 s, fecha mesmo com a chamada pendurada
{
  const b = banco(), f = fabrica(); sessaoVinculada(b);
  const timers = []; const relogio = { iniciar: (fn, ms) => { const t = { fn, ms, ativo: true }; timers.push(t); return t; }, parar: (t) => { t.ativo = false; } };
  const m = novo(b, f, { relogio });
  await m.pulso(); await espera(); await f.sockets[0].emitir("connection.update", { connection: "open" }); await espera();
  const ativos = () => timers.filter((t) => t.ativo);
  confere("guarda armada com 70 s depois da confirmação", ativos().length === 1 && ativos()[0].ms === 70000);
  await m.pulso();
  confere("nova confirmação troca a guarda (só uma ativa)", ativos().length === 1 && timers.length === 2);
  const venceu = ativos()[0]; venceu.ativo = false; venceu.fn(); // passou o prazo sem nova confirmação (ex.: chamada pendurada)
  confere("guarda vence: fecha a conexão antes da vez vencer", f.sockets[0].fechado && !m.st.sock);
  await m.pulso(); confere("confirmação nova arma a guarda de novo", ativos().length === 1);
  await m.encerrar(); confere("encerrar desarma a guarda", ativos().length === 0);
}

// 4c) chave trocada: o motor relê o arquivo e volta sozinho
{
  const b = banco(), f = fabrica(); sessaoVinculada(b); let arquivo = { chave: CHAVE };
  const m = novo(b, f, { recarregar: () => arquivo });
  await m.pulso(); await espera();
  b.chaveValida = "dtm_" + "d".repeat(64); await m.pulso();
  confere("chave revogada: para", m.st.chaveRuim && !m.st.sock);
  arquivo = { chave: b.chaveValida }; b.con.dono_ate = 0; await m.pulso(); await espera();
  confere("chave nova no arquivo: volta a funcionar sem reiniciar", !m.st.chaveRuim && f.sockets.length === 2);
  await m.encerrar();
}

// 5) configuração
{
  const d = mkdtempSync(join(tmpdir(), "motor-"));
  const arq = join(d, "c.json"); writeFileSync(arq, JSON.stringify({ chave_motor: CHAVE, aparelho: "A15" }));
  const site = new URL("../js/config.js", import.meta.url).pathname;
  const c = lerConfig({ arquivo: arq, site });
  confere("config: endereço e chave publicável do site + chave do motor", c.url.includes("supabase.co") && c.publica.startsWith("sb_publishable_") && c.chave === CHAVE);
  writeFileSync(arq, JSON.stringify({ chave_motor: "errada" }));
  let erro = ""; try { lerConfig({ arquivo: arq, site }); } catch (e) { erro = e.message; }
  confere("config: chave com formato errado é recusada", /formato/.test(erro), erro);
  confere("vinculado pelo QR (me) e pelo código (registered)", vinculado({ me: { id: "x" } }) && vinculado({ registered: true }) && !vinculado({}));
}

console.log(ok.map((x) => "OK " + x).join("\n")); console.log("FALHAS", JSON.stringify(falhas));
process.exit(falhas.length ? 1 : 0);
