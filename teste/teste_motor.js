// Teste do motor do WhatsApp (motor-zap/motor.js) sem rede: banco e WhatsApp simulados.
// Rodar: (cd motor-zap && npm ci) && node teste/teste_motor.js
import { criarMotor, vinculado, lerConfig } from "../motor-zap/motor.js";
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
    chamadas: [], fora: false, chaveValida: CHAVE, agora: 1e6 };
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
      const vez = !b.con.dono_ate || b.con.dono_ate < b.agora || b.con.dono_id === a.p_id;
      if (vez) Object.assign(b.con, { dono: "android", dono_id: a.p_id, dono_ate: b.agora + 90000 });
      return resp({ vez, vinculado, pedido: vez ? b.con.pedido : null, dono: b.con.dono, situacao: b.con.situacao });
    }
    if (nome === "whatsapp_motor_soltar") { if (b.con.dono_id === a.p_id) b.con.dono_ate = 0; return resp(); }
    if (!comVez()) return erro("O motor não está com a vez da conexão.", "55000");
    if (nome === "whatsapp_motor_ler") return resp(Object.fromEntries(a.p_chaves.filter((k) => b.sessao.has(k)).map((k) => [k, JSON.parse(b.sessao.get(k))])));
    if (nome === "whatsapp_motor_gravar") { for (const k in a.p_poe) b.sessao.set(k, JSON.stringify(a.p_poe[k])); for (const k of a.p_tira) b.sessao.delete(k); return resp(); }
    if (nome === "whatsapp_motor_apagar_sessao") { b.sessao.clear(); return resp(); }
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
      end: () => { s.fechado = true; }, logout: async () => { s.saiu = true; } };
    f.sockets.push(s); return s;
  };
  return f;
}
const espera = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const silencioso = { log() {}, error() {} };
const fechamento = (codigo) => ({ connection: "close", lastDisconnect: { error: Object.assign(new Error("caiu " + codigo), { output: { statusCode: codigo } }) } });

function novo(b, f, extra = {}) {
  return criarMotor({ config: { url: "https://x.supabase.co", publica: "pub", chave: CHAVE, aparelho: "Galaxy A15" }, buscar: b.buscar, criarSocket: f.criar, saida: silencioso, agora: () => b.agora, ...extra });
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
