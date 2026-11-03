// Motor do WhatsApp da DTCar — roda no Android (Termux) ou num PC com Node 20+.
//
// Mantém a conexão com o WhatsApp da oficina ligada e reveza com a função "zap" do
// Supabase: a cada 30 s avisa o banco que está vivo e pega/renova a vez da conexão.
// Se o motor cair, a vez vence em 90 s e o Supabase assume sob demanda.
//
// Segurança: usa só a chave publicável do site (pública) + a CHAVE DO MOTOR, gerada pelo
// administrador em Sistema › WhatsApp. Essa chave só dá acesso às funções whatsapp_motor_*
// (sessão e situação do WhatsApp), nunca aos dados da oficina. Fica em ~/.dtcar-motor.json.
//
// Etapa 2: conecta, mantém e reveza. Etapa 3 (v25): envia a fila (uma mensagem por vez, nas regras do banco:
// horário, intervalo, limites) com "digitando…", e guarda as mensagens das conversas individuais (texto; mídia só o tipo).
// Biblioteca: SOMENTE o pacote oficial "baileys" (WhiskeySockets), versão travada no package.json.
import makeWASocket, { BufferJSON, Browsers, DisconnectReason, initAuthCreds, makeCacheableSignalKeyStore, proto } from "baileys";
import { readFileSync } from "node:fs";
import { homedir, hostname, platform, release } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { paraGuardar, jidParaEnvio, enviarTexto } from "./whats.js";

export const VERSAO = "3.0";
export const PULSO_MS = 30000;          // sinal ao banco
export const SEM_PULSO_MS = 70000;      // sem sinal aceito há isso: larga a conexão (a vez vence em 90 s)
const ESPERAS = [5, 15, 30, 60, 120, 300].map((s) => s * 1000); // entre tentativas de reconectar

const hora = () => new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
const paraBanco = (v) => JSON.parse(JSON.stringify(v, BufferJSON.replacer));
const doBanco = (v) => JSON.parse(JSON.stringify(v), BufferJSON.reviver);
/** Celular vinculado? Pelo QR Code a biblioteca preenche só creds.me ("registered" é do pareamento por código). */
export const vinculado = (c) => !!(c && (c.registered || (c.me && c.me.id)));

/** Endereço e chave publicável do site (js/config.js do próprio repositório) + chave do motor (~/.dtcar-motor.json). */
export function lerConfig({ arquivo = process.env.DTCAR_MOTOR_CONFIG || join(homedir(), ".dtcar-motor.json"),
                            site = join(dirname(fileURLToPath(import.meta.url)), "..", "js", "config.js") } = {}) {
  const js = readFileSync(site, "utf8");
  const url = /SUPABASE_URL:\s*"([^"]+)"/.exec(js)?.[1], publica = /SUPABASE_ANON_KEY:\s*"([^"]+)"/.exec(js)?.[1];
  const cfg = JSON.parse(readFileSync(arquivo, "utf8"));
  if (!url || !publica) throw new Error("js/config.js sem SUPABASE_URL/SUPABASE_ANON_KEY");
  if (!cfg.chave_motor || !/^dtm_[0-9a-f]{64}$/.test(cfg.chave_motor)) throw new Error("chave do motor ausente ou com formato errado em " + arquivo);
  return { url: process.env.DTCAR_SUPABASE_URL || cfg.url || url, publica: cfg.chave_publica || publica, chave: cfg.chave_motor, aparelho: cfg.aparelho || "" };
}

/** Registro da biblioteca: só erros. */
function registro(saida) {
  const l = { level: "error", child: () => l, trace() {}, debug() {}, info() {}, warn() {},
    error: (...a) => saida.error(hora(), "baileys", ...a.map((x) => (x && x.err ? x.err.message || x.err : x))), fatal: (...a) => saida.error(hora(), "baileys fatal", ...a) };
  return l;
}

export function criarMotor({ config, buscar = globalThis.fetch, criarSocket = makeWASocket, saida = console, agora = Date.now,
                             relogio = { iniciar: setTimeout, parar: clearTimeout }, recarregar = null, esperasGravar = [0, 1000, 3000], esperarDigitando } = {}) {
  const id = randomUUID();
  const log = (...a) => saida.log(hora(), ...a);
  const blog = registro(saida);
  const st = { sock: null, aberto: false, conectando: false, parado: false, semVinculo: false, chaveRuim: false,
    ultimoPulsoOk: 0, tentativas: 0, proximaTentativa: 0, desde: null, recebidas: 0, ultimaRecebida: null, erros: 0,
    numero: "", situacaoGravada: "", inicio: agora(), guarda: null, ultimaGravacao: null,
    enviadas: 0, ultimoEnvio: null, motivoFila: "", aGuardar: [], resultados: [] };
  let fila = Promise.resolve(); // gravações da sessão em ordem
  // mudanças da sessão ainda não confirmadas pelo banco (chave -> valor serializado; null = apagar). Ficam aqui até
  // o banco aceitar: as leituras usam estas por cima das do banco e cada gravação/sinal tenta mandar de novo.
  const pendentes = new Map();
  const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

  async function rpc(nome, args) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
    try {
      const r = await buscar(`${config.url}/rest/v1/rpc/${nome}`, { method: "POST", signal: ctl.signal,
        headers: { apikey: config.publica, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(args) });
      const txt = await r.text(); let corpo = null; try { corpo = txt ? JSON.parse(txt) : null; } catch (_) { corpo = txt; }
      if (!r.ok) { const e = new Error((corpo && corpo.message) || `HTTP ${r.status}`); e.status = r.status; e.codigo = corpo && corpo.code; throw e; }
      return corpo;
    } catch (e) { if (e.name === "AbortError") throw new Error("o banco não respondeu a tempo"); throw e; }
    finally { clearTimeout(t); }
  }
  const base = () => ({ p_chave: config.chave, p_id: id });
  const chaveInvalida = (e) => /chave do motor/i.test(e.message || "") || e.codigo === "28000";

  // ---------- sessão do WhatsApp no banco (via funções do motor) ----------
  const ler = async (chaves) => {
    const r = (chaves.length ? await rpc("whatsapp_motor_ler", { ...base(), p_chaves: chaves }) : {}) || {};
    for (const k of chaves) if (pendentes.has(k)) { const v = pendentes.get(k); if (v === null) delete r[k]; else r[k] = v; }
    return r;
  };
  async function descarregar() {
    if (!pendentes.size) return;
    const lote = new Map(pendentes), poe = {}, tira = [];
    for (const [k, v] of lote) { if (v === null) tira.push(k); else poe[k] = v; }
    const em = await rpc("whatsapp_motor_gravar", { ...base(), p_poe: poe, p_tira: tira });
    if (em) st.ultimaGravacao = em; // hora do banco
    for (const [k, v] of lote) if (pendentes.get(k) === v) pendentes.delete(k);
  }
  /** Grava na ordem; tenta 3 vezes. Se o banco não aceitar, a mudança fica pendente e o erro volta para a biblioteca
   *  (ela não pode achar que está salvo). */
  function gravar(poe, tira = []) {
    for (const k in poe) pendentes.set(k, poe[k]);
    for (const k of tira) pendentes.set(k, null);
    fila = fila.catch(() => {}).then(async () => {
      let ultimo;
      for (const e of esperasGravar) { if (e) await dormir(e); try { await descarregar(); return; } catch (x) { ultimo = x; } }
      st.erros++; log(`não gravou a sessão (${pendentes.size} mudança(s) guardadas aqui; tenta de novo):`, ultimo.message);
      throw ultimo;
    });
    return fila;
  }
  /** Sinal: manda o que ficou pendente (sem lançar erro). */
  const tentarPendentes = () => (pendentes.size ? gravar({}).catch(() => {}) : Promise.resolve());

  async function carregar() {
    const r = await ler(["creds"]);
    const creds = r.creds ? doBanco(r.creds) : initAuthCreds();
    const keys = {
      get: async (tipo, ids) => {
        const r2 = await ler(ids.map((i) => `k:${tipo}:${i}`));
        return Object.fromEntries(ids.map((i) => {
          let v = r2[`k:${tipo}:${i}`]; if (v != null) v = doBanco(v);
          if (v && tipo === "app-state-sync-key") v = proto.Message.AppStateSyncKeyData.fromObject(v);
          return [i, v];
        }));
      },
      set: async (dados) => {
        const poe = {}, tira = [];
        for (const tipo in dados) for (const i in dados[tipo]) { const v = dados[tipo][i]; if (v == null) tira.push(`k:${tipo}:${i}`); else poe[`k:${tipo}:${i}`] = paraBanco(v); }
        await gravar(poe, tira);
      },
    };
    return { creds, keys, salvarCreds: () => gravar({ creds: paraBanco(creds) }).catch(() => {}) };
  }
  async function situacao(sit, detalhe, extra = {}) {
    try { await rpc("whatsapp_motor_situacao", { ...base(), p_situacao: sit, p_detalhe: detalhe, p_numero: extra.numero ?? null, p_limpar_pedido: !!extra.limparPedido }); st.situacaoGravada = sit; }
    catch (e) { log("não gravou a situação:", e.message); }
  }

  // ---------- conexão ----------
  function fechar(motivo) {
    const s = st.sock; st.sock = null; st.aberto = false; st.conectando = false; st.desde = null;
    if (s) { log("fechando a conexão:", motivo); try { s.end(undefined); } catch (_) { /* já fechada */ } }
  }
  // Guarda da vez: cada confirmação do banco vale SEM_PULSO_MS. Se nenhuma nova chegar nesse prazo (banco fora, chamada
  // pendurada, chave revogada), a conexão fecha sozinha — antes de a vez vencer no banco (90 s) e outro poder conectar.
  function armarGuarda() {
    if (st.guarda) relogio.parar(st.guarda);
    st.guarda = relogio.iniciar(() => { st.guarda = null; if (st.sock) { st.erros++; fechar("sem confirmar a vez com o banco a tempo"); } }, SEM_PULSO_MS);
  }
  function desarmarGuarda() { if (st.guarda) { relogio.parar(st.guarda); st.guarda = null; } }
  function agendar() { st.proximaTentativa = agora() + ESPERAS[Math.min(st.tentativas, ESPERAS.length - 1)]; st.tentativas++; }

  async function conectar() {
    if (st.sock || st.conectando || st.parado) return;
    st.conectando = true;
    try {
      const { creds, keys, salvarCreds } = await carregar();
      // carregar pode demorar: só abre a conexão se a vez ainda está confirmada (guarda ativa); senão espera o próximo sinal
      if (!st.guarda || st.parado) { st.conectando = false; log("a vez não está mais confirmada: não abre a conexão agora"); return; }
      // a sessão em memória agora é a do banco nesta hora (base para saber, depois, se outro mexeu nela)
      if (st.sessaoEmPulso && (!st.ultimaGravacao || new Date(st.sessaoEmPulso) > new Date(st.ultimaGravacao))) st.ultimaGravacao = st.sessaoEmPulso;
      if (!vinculado(creds)) {
        if (!st.semVinculo) log("nenhum celular vinculado: vincule pelo QR Code em Sistema › WhatsApp. Esperando…");
        st.semVinculo = true; st.conectando = false; st.proximaTentativa = agora() + 60000; return;
      }
      st.semVinculo = false;
      const s = criarSocket({ auth: { creds, keys: makeCacheableSignalKeyStore(keys, blog) }, logger: blog, browser: Browsers.ubuntu("DTCar Gestão"),
        printQRInTerminal: false, markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => false,
        connectTimeoutMs: 30000, keepAliveIntervalMs: 25000, defaultQueryTimeoutMs: 30000 });
      st.sock = s;
      s.ev.on("creds.update", () => { salvarCreds(); });
      s.ev.on("connection.update", (u) => aoMudarConexao(s, u));
      s.ev.on("messages.upsert", ({ messages, type }) => {
        const lista = (messages || []).map(paraGuardar).filter(Boolean);
        if (lista.length) { st.aGuardar.push(...lista); guardarMensagens(); }
        if (type !== "notify") return;
        const novas = (messages || []).filter((m) => m && m.key && !m.key.fromMe).length;
        if (novas) { st.recebidas += novas; st.ultimaRecebida = new Date().toISOString(); }
      });
    } catch (e) {
      st.erros++; st.conectando = false; st.sock = null; agendar();
      if (chaveInvalida(e)) return pararPorChave(e);
      log("não conseguiu abrir a sessão:", e.message);
    }
  }

  async function aoMudarConexao(s, u) {
    if (s !== st.sock) return; // conexão antiga
    if (u.qr) { fechar("o WhatsApp pediu pareamento (sessão inválida)"); st.proximaTentativa = agora() + 60000; return; }
    if (u.connection === "open") {
      st.aberto = true; st.conectando = false; st.tentativas = 0; st.desde = new Date().toISOString();
      st.numero = String((s.user && s.user.id) || "").split(":")[0].split("@")[0];
      log("conectado ao WhatsApp", st.numero);
      await situacao("conectado", "Motor do Android conectado.", { numero: st.numero || null });
      return;
    }
    if (u.connection === "close") {
      const e = u.lastDisconnect && u.lastDisconnect.error; const codigo = e && e.output && e.output.statusCode;
      st.sock = null; st.aberto = false; st.conectando = false; st.desde = null;
      if (codigo === DisconnectReason.loggedOut) {
        log("o celular desvinculou este aparelho: apagando a sessão");
        pendentes.clear();
        try { await fila.catch(() => {}); await rpc("whatsapp_motor_apagar_sessao", { ...base(), p_detalhe: "O celular desvinculou o aparelho. Vincule de novo pelo QR Code." }); }
        catch (x) { log("não apagou a sessão:", x.message); }
        st.proximaTentativa = agora() + 60000; return;
      }
      if (codigo === DisconnectReason.connectionReplaced) {
        log("outra conexão com a mesma sessão assumiu (440): esperando 2 min");
        st.proximaTentativa = agora() + 120000; return;
      }
      if (codigo === DisconnectReason.restartRequired) { st.proximaTentativa = 0; log("reiniciando a conexão (pedido do WhatsApp)"); return; }
      st.erros++; agendar();
      log(`conexão caiu (${codigo || "sem código"}: ${(e && e.message) || "?"}); nova tentativa em ${Math.round((st.proximaTentativa - agora()) / 1000)} s`);
      if (st.situacaoGravada !== "erro" && st.tentativas >= 3) await situacao("erro", `Motor do Android sem conexão: ${(e && e.message) || codigo || "?"}. Tentando de novo.`);
    }
  }

  // ---------- mensagens e fila (v25) ----------
  let guardando = null;
  /** Manda as mensagens recebidas ao banco (em lote). Se falhar, ficam aqui e o próximo sinal tenta de novo. */
  function guardarMensagens() {
    if (guardando || !st.aGuardar.length) return guardando || Promise.resolve();
    const lote = st.aGuardar.splice(0, 200);
    guardando = rpc("whatsapp_motor_mensagens", { ...base(), p_msgs: lote })
      .catch((e) => { st.aGuardar.unshift(...lote); if (!/function|does not exist|PGRST202/i.test(e.message)) log("não guardou mensagens (tenta de novo):", e.message); })
      .finally(() => { guardando = null; });
    return guardando;
  }
  async function mandarResultados() {
    while (st.resultados.length) {
      const r = st.resultados[0];
      try { await rpc("whatsapp_motor_resultado", { ...base(), ...r }); st.resultados.shift(); } catch (e) { log("resultado do envio não gravado (tenta de novo):", e.message); return; }
    }
  }
  /** Pega a próxima mensagem liberada pelas regras do banco e envia (uma por sinal). */
  async function enviarDaFila() {
    const s = st.sock; if (!s || !st.aberto) return;
    // resultado anterior ainda não gravado: ele é que marca o intervalo e os limites — não envia outra antes
    if (st.resultados.length) return;
    let r;
    try { r = await rpc("whatsapp_motor_proxima", base()); }
    catch (e) { if (!/function|does not exist|PGRST202/i.test(e.message)) log("fila:", e.message); return; } // sem o v25: segue sem fila
    if (!r || !r.mensagem) { st.motivoFila = (r && r.motivo) || ""; return; }
    const m = r.mensagem; let res;
    try {
      const jid = await jidParaEnvio(s, m.telefone);
      if (!jid) res = { p_ok: false, p_erro: "Número sem WhatsApp." };
      else { const idm = await enviarTexto(s, jid, m.texto, esperarDigitando); res = { p_ok: true, p_msg_id: idm, p_jid: jid }; }
    } catch (e) { res = { p_ok: false, p_erro: "Falha ao enviar: " + e.message }; }
    if (res.p_ok) { st.enviadas++; st.ultimoEnvio = new Date().toISOString(); log("mensagem", m.id, "enviada"); } else log("mensagem", m.id, "não enviada:", res.p_erro);
    st.resultados.push({ p_fila_id: m.id, p_ok: res.p_ok, p_msg_id: res.p_msg_id || null, p_jid: res.p_jid || null, p_erro: res.p_erro || null });
    await mandarResultados();
  }

  async function desconectarAPedido() {
    log("pedido da tela: desconectar e apagar a sessão");
    const s = st.sock;
    if (s && st.aberto) { try { await s.logout(); } catch (e) { log("logout:", e.message); } }
    fechar("desconectar");
    // só confirma e limpa o pedido depois que a sessão sumiu do banco; se falhar, o pedido fica e o próximo sinal tenta de novo
    // (sem reconectar: proximaTentativa adiada e a conexão já fechada)
    pendentes.clear();
    // uma operação só no banco: apaga a sessão, marca "desligado" e limpa o pedido
    try { await fila.catch(() => {}); await rpc("whatsapp_motor_apagar_sessao", { ...base(), p_detalhe: "Desconectado e sessão apagada (pelo motor do Android)." }); }
    catch (e) { st.erros++; log("não apagou a sessão (tenta de novo no próximo sinal):", e.message); st.proximaTentativa = agora() + 60000; return; }
    st.situacaoGravada = "desligado"; st.proximaTentativa = agora() + 60000;
  }

  function pararPorChave(e) {
    if (!st.chaveRuim) log("CHAVE DO MOTOR RECUSADA:", e.message, "— gere outra em Sistema › WhatsApp e rode: bash ~/dtcar-gestao/motor-zap/configurar.sh");
    st.chaveRuim = true; desarmarGuarda(); fechar("chave recusada");
  }
  // chave recusada: a cada sinal relê o arquivo de configuração (configurar.sh grava a chave nova)
  function tentarChaveNova() {
    if (!recarregar) return;
    try { const c = recarregar(); if (c && c.chave && c.chave !== config.chave) { config.chave = c.chave; log("chave do motor nova lida do arquivo"); } }
    catch (e) { /* arquivo com problema: segue com a atual */ }
  }

  const info = () => ({ versao: VERSAO, node: process.version, sistema: `${platform()} ${release()}`, aparelho: config.aparelho || hostname(),
    conectado: st.aberto, desde: st.desde, recebidas: st.recebidas, ultima_recebida: st.ultimaRecebida, erros: st.erros,
    ligado_desde: new Date(st.inicio).toISOString(), pendentes: pendentes.size,
    enviadas: st.enviadas, ultimo_envio: st.ultimoEnvio, fila: st.motivoFila, a_guardar: st.aGuardar.length });

  async function pulso() {
    if (st.parado) return;
    if (st.chaveRuim) tentarChaveNova();
    let r;
    try { r = await rpc("whatsapp_motor_pulso", { ...base(), p_info: info() }); }
    catch (e) {
      st.erros++;
      if (chaveInvalida(e)) return pararPorChave(e);
      log("sem resposta do banco:", e.message);
      // sem confirmar a vez, não pode segurar a conexão: a vez vence em 90 s e o Supabase pode conectar
      if (st.sock && agora() - st.ultimoPulsoOk > SEM_PULSO_MS) fechar("sem confirmar a vez com o banco");
      return;
    }
    st.ultimoPulsoOk = agora();
    if (st.chaveRuim) { st.chaveRuim = false; log("chave do motor aceita de novo"); }
    if (r && r.vez) armarGuarda(); else desarmarGuarda();
    if (r && r.vinculado === false) {
      if (!st.semVinculo) log("nenhum celular vinculado: vincule pelo QR Code em Sistema › WhatsApp. Esperando…");
      st.semVinculo = true; if (st.sock) fechar("sessão apagada"); return;
    }
    if (!r || !r.vez) {
      if (st.sock) fechar(`a vez está com ${r && r.dono}`);
      // outro (a função zap) assumiu: ele carregou a sessão do banco e pode tê-la avançado; mandar as mudanças antigas
      // daqui por cima estragaria a sessão. Descarta.
      if (pendentes.size && r && r.dono && r.dono !== "android") { log(`descartando ${pendentes.size} mudança(s) não gravadas: a vez passou para ${r.dono}`); pendentes.clear(); }
      return;
    }
    if (r.sessao_em) st.sessaoEmPulso = r.sessao_em;
    if (!r.continua && pendentes.size) {
      // a vez foi interrompida e retomada: se a sessão mudou no banco depois da última gravação deste motor, outro (a função
      // zap) usou e avançou a sessão no meio — as mudanças antigas daqui não podem ir por cima
      const outroMexeu = !st.ultimaGravacao || (r.sessao_em && new Date(r.sessao_em) > new Date(st.ultimaGravacao));
      if (outroMexeu) { log(`descartando ${pendentes.size} mudança(s) não gravadas: a sessão foi usada por outro enquanto este motor estava sem a vez`); pendentes.clear(); }
    }
    if (!r.continua && st.sock) fechar("a vez foi interrompida: reabre com a sessão do banco");
    if (r.pedido === "desconectar") return desconectarAPedido();
    await tentarPendentes();
    await mandarResultados(); await guardarMensagens();
    if (!st.sock && !st.conectando && agora() >= st.proximaTentativa) await conectar();
    else if (st.aberto) await enviarDaFila();
  }

  async function encerrar(motivo = "encerrando") {
    st.parado = true; desarmarGuarda(); fechar(motivo);
    try { await tentarPendentes(); await fila.catch(() => {}); await rpc("whatsapp_motor_soltar", base()); } catch (_) { /* a vez vence sozinha em 90 s */ }
  }

  return { id, st, pulso, encerrar, info, rpc, pendentes, guardarMensagens, _aoMudarConexao: aoMudarConexao };
}

// ---------- execução direta ----------
async function principal() {
  const args = process.argv.slice(2);
  if (args[0] === "--versao") { console.log(VERSAO); return; }
  const config = lerConfig();
  const motor = criarMotor({ config, recarregar: () => lerConfig() });
  if (args[0] === "--teste") { // confere só a chave e o banco, sem conectar ao WhatsApp
    const r = await motor.rpc("whatsapp_motor_pulso", { p_chave: config.chave, p_id: motor.id, p_info: motor.info() });
    await motor.encerrar("teste");
    console.log("Chave do motor OK. Banco respondeu. A vez da conexão está com:", r.vez ? "este motor (soltou em seguida)" : r.dono);
    return;
  }
  console.log(hora(), `motor do WhatsApp ${VERSAO} ligado (${platform()}, Node ${process.version})`);
  let ocupado = false;
  const ciclo = async () => { if (ocupado) return; ocupado = true; try { await motor.pulso(); } catch (e) { console.error(hora(), "erro no ciclo:", e.message); } finally { ocupado = false; } };
  await ciclo();
  const t = setInterval(ciclo, PULSO_MS);
  // reinicia a cada 12 h: o iniciar.sh busca a versão nova do código antes de ligar de novo
  const reinicio = setTimeout(() => sair("reinício programado (12 h)", 0), 12 * 3600 * 1000);
  async function sair(motivo, codigo) { clearInterval(t); clearTimeout(reinicio); console.log(hora(), motivo); await motor.encerrar(motivo); process.exit(codigo); }
  process.on("SIGINT", () => sair("parado (Ctrl+C)", 130));
  process.on("SIGTERM", () => sair("parado pelo sistema", 143));
  process.on("unhandledRejection", (e) => console.error(hora(), "erro não tratado:", e && e.message ? e.message : e));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) principal().catch((e) => { console.error(hora(), "não deu para ligar o motor:", e.message); process.exit(1); });
