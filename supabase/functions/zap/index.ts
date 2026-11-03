// DTCar Gestão — função "zap": WhatsApp próprio da oficina (biblioteca Baileys), etapa 1.
//
// Nesta etapa só confere se o WhatsApp funciona dentro do Supabase:
//   testar      — conecta sem vincular nada e espera o WhatsApp responder (nenhum celular é contatado)
//   parear_qr   — vincula o celular da oficina pelo QR Code (o QR aparece na tela e muda a cada 20–60 s; a função espera a
//                 leitura em segundo plano e guarda a sessão em whatsapp_sessao)
//   parear      — o mesmo por código de 8 letras. O servidor do Supabase não tem a cifra que o código usa (aes-256-ctr,
//                 "Unknown cipher", 03/11/2026): fica para o motor no Android/PC. O teste mostra quais cifras o servidor aceita.
//   conferir    — volta a conectar com a sessão guardada (prova de que dá para conectar sob demanda)
//   desconectar — desvincula o aparelho e apaga a sessão
// Ainda não envia nem recebe mensagens (etapas seguintes).
// processar (v25) — sem o motor: guarda as mensagens que chegaram e envia a fila pelas regras, em segundo plano.
// Revezamento (v24): quando o motor do Android está com a vez, a função não conecta com a sessão guardada
// (conferir responde pelo último sinal do motor; desconectar vira pedido ao motor).
//
// Só o administrador (token do usuário, conferido aqui). As chaves da sessão ficam numa tabela que
// ninguém do sistema lê (v22): a função usa a chave de servidor só para essa tabela e para a situação.
// Publicar com "Verify JWT" desligado (a função confere o login com withSupabase).
// Biblioteca: SOMENTE o pacote oficial "baileys" (WhiskeySockets), com a versão travada.
import { withSupabase } from "npm:@supabase/server@1.9.2";
import makeWASocket, { BufferJSON, Browsers, DisconnectReason, initAuthCreds, makeCacheableSignalKeyStore, proto } from "npm:baileys@7.0.0-rc14";
import { createCipheriv } from "node:crypto";
import QRCode from "npm:qrcode@1.5.4";

type Db = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// registro da biblioteca: só erros vão para o log da função
const log: any = { level: "error", child() { return log; }, trace() {}, debug() {}, info() {}, warn() {}, fatal(...a: unknown[]) { console.error(...a); },
  error(...a: unknown[]) { console.error("baileys", ...a); } };

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
const esperar = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// valores da sessão têm bytes (Buffer): grava e lê com o conversor da própria biblioteca
const paraBanco = (v: unknown) => JSON.parse(JSON.stringify(v, BufferJSON.replacer));
const doBanco = (v: unknown) => JSON.parse(JSON.stringify(v), BufferJSON.reviver);

/** Já tem celular vinculado? Pelo QR Code a biblioteca só preenche creds.me ("registered" fica false;
 *  ele só vira true no pareamento por código). É o mesmo critério que a biblioteca usa para entrar. */
export const vinculado = (creds: { registered?: boolean; me?: { id?: string } }) => !!(creds && (creds.registered || creds.me?.id));

/** Sessão do WhatsApp guardada no banco (tabela whatsapp_sessao, só a chave de servidor). */
const RESERVA = "pareamento"; // linha de whatsapp_sessao que reserva o pareamento para uma tentativa só

export function sessaoNoBanco(adm: Db) {
  const ler = async (chaves: string[]) => {
    if (!chaves.length) return {} as Record<string, unknown>;
    const { data, error } = await adm.from("whatsapp_sessao").select("chave, valor").in("chave", chaves);
    if (error) throw new Error("sessão: " + error.message);
    return Object.fromEntries((data || []).map((r: { chave: string; valor: unknown }) => [r.chave, doBanco(r.valor)]));
  };
  const gravar = async (linhas: Array<{ chave: string; valor: unknown }>) => {
    const poe = linhas.filter((l) => l.valor != null).map((l) => ({ chave: l.chave, valor: paraBanco(l.valor), atualizado_em: new Date().toISOString() }));
    const tira = linhas.filter((l) => l.valor == null).map((l) => l.chave);
    if (poe.length) { const { error } = await adm.from("whatsapp_sessao").upsert(poe); if (error) throw new Error("sessão: " + error.message); }
    if (tira.length) { const { error } = await adm.from("whatsapp_sessao").delete().in("chave", tira); if (error) throw new Error("sessão: " + error.message); }
  };
  return {
    async carregar() {
      const r = await ler(["creds"]);
      const creds = (r.creds as ReturnType<typeof initAuthCreds>) || initAuthCreds();
      const keys = {
        get: async (tipo: string, ids: string[]) => {
          const r2 = await ler(ids.map((i) => "k:" + tipo + ":" + i));
          return Object.fromEntries(ids.map((i) => {
            let v = r2["k:" + tipo + ":" + i];
            if (v && tipo === "app-state-sync-key") v = proto.Message.AppStateSyncKeyData.fromObject(v as object);
            return [i, v];
          }));
        },
        set: async (dados: Record<string, Record<string, unknown>>) => {
          const l: Array<{ chave: string; valor: unknown }> = [];
          for (const tipo in dados) for (const id in dados[tipo]) l.push({ chave: "k:" + tipo + ":" + id, valor: dados[tipo][id] });
          await gravar(l);
        },
      };
      return { creds, keys, salvarCreds: () => gravar([{ chave: "creds", valor: creds }]) };
    },
    /** Apaga a sessão (credenciais e chaves). A reserva do pareamento só sai junto quando pedido. */
    async apagar(comReserva = true) {
      let q = adm.from("whatsapp_sessao").delete().neq("chave", "");
      if (!comReserva) q = q.neq("chave", RESERVA);
      const { error } = await q; if (error) throw new Error("sessão: " + error.message);
    },
    /** Reserva exclusiva do pareamento (uma tentativa por vez): grava só se não houver outra válida. Devolve o id ou null. */
    async reservar(validadeMs: number) {
      const agora = Date.now();
      const { data } = await adm.from("whatsapp_sessao").select("chave, valor").in("chave", [RESERVA]);
      const atual = (data || [])[0] as { valor: { ate: number } } | undefined;
      if (atual && atual.valor && atual.valor.ate > agora) return null;
      if (atual) await adm.from("whatsapp_sessao").delete().in("chave", [RESERVA]);
      const id = crypto.randomUUID();
      // insert (não upsert): se outra tentativa gravou ao mesmo tempo, a chave já existe e esta é recusada
      const { error } = await adm.from("whatsapp_sessao").insert({ chave: RESERVA, valor: { id, ate: agora + validadeMs }, atualizado_em: new Date().toISOString() });
      return error ? null : id;
    },
    async reservaAtual(): Promise<string | null> {
      const { data } = await adm.from("whatsapp_sessao").select("chave, valor").in("chave", [RESERVA]);
      const v = (data || [])[0]?.valor as { id: string; ate: number } | undefined;
      return v && v.ate > Date.now() ? v.id : null;
    },
    async liberar(id: string) {
      const { data } = await adm.from("whatsapp_sessao").select("chave, valor").in("chave", [RESERVA]);
      if ((data || [])[0]?.valor?.id === id) await adm.from("whatsapp_sessao").delete().in("chave", [RESERVA]);
    },
  };
}

/** Revezamento com o motor do Android (v24): quem está com a vez é o único que conecta com a sessão guardada.
 *  Sem o v24 no banco não existe motor: as consultas falham e a função segue como antes (sem reservar). */
/** Erro que comprova que a função do v24 não existe no banco (PostgREST PGRST202 / Postgres 42883). */
export const semV24 = (e: { code?: string; message?: string } | null) =>
  !!e && (e.code === "PGRST202" || e.code === "42883" || /could not find the function|function .*whatsapp_pegar_vez.* does not exist/i.test(e.message || ""));
export function vezNoBanco(adm: Db) {
  const id = crypto.randomUUID();
  return {
    id,
    /** O motor está com a vez agora? (e se está conectado, pelo último sinal dele) */
    async motor(): Promise<{ ativo: boolean; conectado: boolean; visto_s: number | null; aparelho: string }> {
      const { data, error } = await adm.from("whatsapp_conexao").select("dono, dono_ate, motor_visto, motor_info").eq("id", 1);
      const c = !error && Array.isArray(data) ? data[0] : null;
      const ativo = !!(c && c.dono === "android" && c.dono_ate && new Date(c.dono_ate).getTime() > Date.now());
      return { ativo, conectado: !!(c && c.motor_info && c.motor_info.conectado), aparelho: (c && c.motor_info && c.motor_info.aparelho) || "Android",
        visto_s: c && c.motor_visto ? Math.max(0, Math.round((Date.now() - new Date(c.motor_visto).getTime()) / 1000)) : null };
    },
    /** Pega a vez para a função. false = outro está com ela OU a reserva falhou (tempo-limite, erro): não conecta.
     *  Só segue sem reservar quando o erro comprova que o v24 não foi rodado (a função não existe: não há motor). */
    async pegar(segundos: number): Promise<boolean> {
      const { data, error } = await adm.rpc("whatsapp_pegar_vez", { p_dono: "supabase", p_id: id, p_segundos: segundos });
      if (error) return semV24(error);
      return data === true;
    },
    async soltar() { try { await adm.rpc("whatsapp_soltar_vez", { p_id: id }); } catch (_) { /* vence sozinha */ } },
  };
}
// ---------- mensagens (cópia de motor-zap/whats.js: mudou lá, mude aqui; os testes usam os mesmos casos) ----------
export const conversaIndividual = (jid: unknown) => /@(s\.whatsapp\.net|lid)$/.test(String(jid || ""));
const digitosJid = (jid: unknown) => String(jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
export function telefoneDaChave(k: any) {
  const c = [k && k.remoteJid, k && k.remoteJidAlt, k && k.senderPn, k && k.participantAlt].find((j) => /@s\.whatsapp\.net$/.test(String(j || "")));
  return c ? digitosJid(c) : "";
}
const TIPOS: Record<string, string> = { conversation: "texto", extendedTextMessage: "texto", imageMessage: "imagem", videoMessage: "video", audioMessage: "audio",
  documentMessage: "documento", stickerMessage: "figurinha", locationMessage: "localizacao", liveLocationMessage: "localizacao",
  contactMessage: "contato", contactsArrayMessage: "contato", pollCreationMessage: "enquete", pollCreationMessageV3: "enquete" };
function conteudo(m: any) {
  let c = m && m.message;
  for (let i = 0; i < 4 && c; i++) {
    const dentro = (c.ephemeralMessage || c.viewOnceMessage || c.viewOnceMessageV2 || c.viewOnceMessageV2Extension || c.documentWithCaptionMessage || {}).message;
    if (!dentro) break; c = dentro;
  }
  return c || null;
}
export function textoDaMensagem(m: any) {
  const c = conteudo(m); if (!c) return null;
  const chave = Object.keys(TIPOS).find((k) => c[k]); if (!chave) return null;
  const v = c[chave]; const tipo = TIPOS[chave];
  const txt = typeof v === "string" ? v : (v.text || v.caption || v.name || v.displayName || v.fileName || "");
  return { tipo, texto: tipo === "texto" ? String(txt) : `[${tipo}]${txt ? " " + txt : ""}` };
}
export function paraGuardar(m: any) {
  const k = m && m.key; if (!k || !k.id || !conversaIndividual(k.remoteJid)) return null;
  const t = textoDaMensagem(m); if (!t) return null;
  const ts = Number(m.messageTimestamp && (m.messageTimestamp.low ?? m.messageTimestamp)) || 0;
  return { msg_id: k.id, jid: k.remoteJid, telefone: telefoneDaChave(k), nome: k.fromMe ? "" : String(m.pushName || "").slice(0, 80),
    de_mim: !!k.fromMe, texto: t.texto.slice(0, 4000), tipo: t.tipo, em: new Date(ts ? ts * 1000 : Date.now()).toISOString() };
}
export function variacoes(tel: string) {
  const d = String(tel || "").replace(/\D/g, ""); const v = [d];
  if (/^55\d{2}9\d{8}$/.test(d)) v.push(d.slice(0, 4) + d.slice(5));
  else if (/^55\d{2}[6-9]\d{7}$/.test(d)) v.push(d.slice(0, 4) + "9" + d.slice(4));
  return v;
}
export async function jidParaEnvio(sock: any, tel: string) {
  for (const n of variacoes(tel)) {
    const r = await sock.onWhatsApp(n);
    const a = Array.isArray(r) ? r.find((x: any) => x && x.exists) : null;
    if (a) return a.jid as string;
  }
  return null;
}
export async function enviarTexto(sock: any, jid: string, texto: string, esperarMs: (ms: number) => Promise<void> = esperar) {
  try { await sock.presenceSubscribe(jid); } catch (_) { /* opcional */ }
  try { await sock.sendPresenceUpdate("composing", jid); } catch (_) { /* opcional */ }
  await esperarMs(Math.min(1500 + String(texto).length * 35, 6000));
  try { await sock.sendPresenceUpdate("paused", jid); } catch (_) { /* opcional */ }
  const r = await sock.sendMessage(jid, { text: texto });
  return (r && r.key && r.key.id) || "";
}

const ocupada = (ms: number) => ({ ok: false, ms, resposta: "ocupada", detalhe: "A conexão está em uso (ou o banco não confirmou a reserva). Tente de novo em 1 minuto." });

async function situacao(adm: Db, patch: Record<string, unknown>) {
  const { error } = await adm.from("whatsapp_conexao").update({ ...patch, atualizado_em: new Date().toISOString() }).eq("id", 1);
  if (error) console.error("situação do WhatsApp não gravada", error.message);
}

/** Quais cifras o servidor aceita. O Supabase recusou "aes-256-ctr" (usada só no pareamento por código, em 03/11/2026);
 *  "aes-256-gcm" e "aes-256-cbc" são as das mensagens e da mídia: sem elas o Supabase não serve para enviar/receber. */
export function cifras() {
  const t = (nome: string, iv: number) => { try { createCipheriv(nome, new Uint8Array(32), new Uint8Array(iv)); return true; } catch (_) { return false; } };
  return { ctr: t("aes-256-ctr", 16), gcm: t("aes-256-gcm", 12), cbc: t("aes-256-cbc", 16) };
}

type Sock = ReturnType<typeof makeWASocket>;
function abrir(creds: any, keys: any, aoMudarCreds?: () => Promise<void>): Sock {
  const sock = makeWASocket({
    auth: { creds, keys: makeCacheableSignalKeyStore(keys, log) }, logger: log, browser: Browsers.ubuntu("DTCar Gestão"),
    printQRInTerminal: false, syncFullHistory: false, markOnlineOnConnect: false, shouldSyncHistoryMessage: () => false,
    connectTimeoutMs: 20000, defaultQueryTimeoutMs: 20000,
  });
  if (aoMudarCreds) sock.ev.on("creds.update", () => { aoMudarCreds().catch((e) => console.error("guardar sessão", e)); });
  return sock;
}
const fechar = (s: Sock) => { try { s.end(undefined); } catch (_) { /* já fechado */ } };
/** Espera o primeiro evento de conexão que interessa: "qr" (pronto para parear), "open" ou "close". */
// aceitarQr = false: ignora os QR novos que a biblioteca emite a cada 20–60 s (durante o pareamento por código só interessa abrir ou fechar)
function proximo(sock: Sock, ms: number, aceitarQr = true): Promise<{ tipo: "qr" | "open" | "close" | "tempo"; codigo?: number; msg?: string; qr?: string }> {
  return new Promise((res) => {
    const t = setTimeout(() => res({ tipo: "tempo" }), ms);
    sock.ev.on("connection.update", (u: any) => {
      if (u.qr) { if (aceitarQr) { clearTimeout(t); res({ tipo: "qr", qr: u.qr }); } }
      else if (u.connection === "open") { clearTimeout(t); res({ tipo: "open" }); }
      else if (u.connection === "close") {
        clearTimeout(t);
        const e = u.lastDisconnect?.error as any;
        res({ tipo: "close", codigo: e?.output?.statusCode, msg: e?.message });
      }
    });
  });
}

export const atender = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const { data: admin } = await ctx.supabase.rpc("e_admin");
  if (admin !== true) return json({ erro: "Só o administrador mexe no WhatsApp." }, 403);
  const adm = ctx.supabaseAdmin as unknown as Db;
  const corpo = await req.json().catch(() => ({}));
  const acao = String(corpo.acao || "");
  const inicio = performance.now();
  const ms = () => Math.round(performance.now() - inicio);
  const sessao = sessaoNoBanco(adm);
  const vez = vezNoBanco(adm);

  if (acao === "testar") {
    // sessão nova só na memória: conecta e espera o WhatsApp oferecer o pareamento; nada é gravado e nenhum celular é contatado
    const s = abrir(initAuthCreds(), { get: async () => ({}), set: async () => {} });
    const r = await proximo(s, 40000); fechar(s);
    const ok = r.tipo === "qr";
    const resultado = { ok, ms: ms(), resposta: r.tipo, detalhe: r.msg || "", cifras: cifras(), em: new Date().toISOString() };
    await situacao(adm, { ultimo_teste: { acao, ...resultado }, detalhe: ok ? "Teste de conexão: o WhatsApp respondeu." : "Teste de conexão falhou: " + (r.msg || r.tipo) });
    return json(resultado);
  }

  // parear: por QR Code (padrão no Supabase) ou por código de 8 letras (o servidor do Supabase não tem a cifra que o
  // código usa; fica para o motor no Android/PC)
  if (acao === "parear" || acao === "parear_qr") {
    const porQr = acao === "parear_qr";
    const numero = String(corpo.numero || "").replace(/\D/g, "");
    if (!porQr && (numero.length < 12 || numero.length > 13 || !numero.startsWith("55"))) return json({ erro: "Informe o número com 55 + DDD + número (ex.: 5527999990000)." }, 400);
    if (!porQr && !cifras().ctr) return json({ erro: "O servidor não aceita o pareamento por código. Use o QR Code." }, 501);
    if (porQr) {
      // o QR vai para whatsapp_conexao.qr_svg (v23): sem a coluna, nada apareceria na tela — avisa antes de reservar ou conectar
      const { error } = await adm.from("whatsapp_conexao").select("qr_svg").eq("id", 1);
      if (error) return json({ erro: "Falta rodar o supabase/v23.sql no Supabase para o QR Code aparecer na tela." }, 412);
    }
    const atual = await sessao.carregar();
    if (vinculado(atual.creds)) return json({ erro: "Já existe um aparelho vinculado. Desconecte antes de parear de novo." }, 409);
    if ((await vez.motor()).ativo) return json({ erro: "O motor do Android está com a conexão. Desconecte antes de parear de novo." }, 409);
    // uma tentativa por vez. A execução da função dura no máximo 150 s (plano grátis), contando a preparação, a espera e o
    // fim: a reserva cobre a execução inteira (160 s a partir de agora) e a espera termina aos 140 s, antes do limite
    const t0 = Date.now();
    const reserva = await sessao.reservar(160000);
    if (!reserva) return json({ erro: "Já há um pareamento em andamento. Use o código ou o QR pedido antes, ou espere uns 2 minutos e peça outro." }, 409);
    // segura a vez da conexão durante o pareamento: o motor só assume depois que esta tentativa terminar
    if (!(await vez.pegar(160))) { await sessao.liberar(reserva); return json({ erro: "A conexão está em uso. Tente de novo em 2 minutos." }, 409); }
    // só vale enquanto esta tentativa for a dona da reserva (uma tentativa antiga não mexe na situação de uma nova)
    const minha = async () => (await sessao.reservaAtual()) === reserva;
    const situacaoSeMinha = async (patch: Record<string, unknown>) => { if (await minha()) await situacao(adm, patch); };
    // começa de uma sessão limpa (sobras de uma tentativa que não terminou atrapalham o pareamento)
    await sessao.apagar(false);
    const { creds, keys, salvarCreds } = await sessao.carregar();
    const salvarSeMinha = async () => { if (await minha()) await salvarCreds(); };
    let s = abrir(creds, keys, salvarSeMinha);
    const r = await proximo(s, 30000);
    if (r.tipo !== "qr") { console.error("parear: sem resposta", r); fechar(s); await sessao.liberar(reserva); await vez.soltar(); return json({ erro: "O WhatsApp não respondeu (" + (r.msg || r.tipo) + ")." }, 502); }
    let codigo = "";
    if (porQr) {
      // o QR muda a cada 20–60 s: cada novo vai para a tela (whatsapp_conexao.qr_svg), que confere a cada poucos segundos
      const mostrarQr = async (qr: string) => {
        const svg = await QRCode.toString(qr, { type: "svg", margin: 1, errorCorrectionLevel: "L" });
        await situacaoSeMinha({ situacao: "pareando", numero: "", qr_svg: svg, detalhe: "Leia o QR Code com o celular da oficina." });
      };
      await mostrarQr(r.qr || "");
      s.ev.on("connection.update", (u: any) => { if (u.qr) mostrarQr(u.qr).catch((e) => console.error("QR", e)); });
    } else {
      try { codigo = await s.requestPairingCode(numero); } catch (e) { console.error("pedir código", e); fechar(s); await sessao.liberar(reserva); await vez.soltar(); return json({ erro: "Não foi possível pedir o código: " + (e as Error).message }, 502); }
      await situacao(adm, { situacao: "pareando", numero, detalhe: "Código pedido: digite no celular em até 2 minutos." });
    }
    // o pareamento termina no celular: espera em segundo plano (até ~2 min) e guarda a sessão
    const fim = (async () => {
      const limite = t0 + 140000;
      let ev = await proximo(s, Math.max(1000, limite - Date.now()), false);
      // depois do pareamento o WhatsApp pede para reconectar (restartRequired): reconecta com a sessão nova
      if (ev.tipo === "close" && ev.codigo === DisconnectReason.restartRequired) {
        await salvarSeMinha(); s = abrir(creds, keys, salvarSeMinha);
        ev = await proximo(s, Math.max(1000, limite - Date.now()), false);
      }
      if (ev.tipo === "open") {
        await salvarSeMinha(); await esperar(3000);
        await situacaoSeMinha({ situacao: "conectado", dono: "supabase", qr_svg: null, numero: String(s.user?.id || numero).split(":")[0].split("@")[0], detalhe: "Celular vinculado." });
      } else {
        await situacaoSeMinha({ situacao: "erro", qr_svg: null, detalhe: "Pareamento não concluído (" + (ev.msg || ev.tipo) + "). Tente de novo." });
      }
      fechar(s);
      await sessao.liberar(reserva); await vez.soltar();
    })().catch(async (e) => { console.error("pareamento", e); fechar(s); await situacaoSeMinha({ situacao: "erro", qr_svg: null, detalhe: "Pareamento falhou: " + (e as Error).message }); await sessao.liberar(reserva); await vez.soltar(); });
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(fim);
    return json({ codigo: codigo || undefined, qr: porQr || undefined, ms: ms(), validade_s: Math.max(30, Math.round((t0 + 140000 - Date.now()) / 1000)) });
  }

  if (acao === "conferir") {
    // com o motor do Android na vez, quem responde pela conexão é ele (a função não conecta: seriam duas conexões)
    const m = await vez.motor();
    if (m.ativo) {
      const resultado = { ok: m.conectado, ms: ms(), resposta: "motor", em: new Date().toISOString(),
        detalhe: (m.conectado ? "O motor do Android está conectado" : "O motor do Android está com a vez, mas sem conexão agora") + ` (último sinal há ${m.visto_s ?? "?"} s).` };
      await situacao(adm, { ultimo_teste: { acao, ...resultado } });
      return json(resultado);
    }
    // pega a vez ANTES de carregar: quem usou a sessão antes já gravou tudo, e ninguém mexe nela enquanto esta conecta
    if (!(await vez.pegar(60))) return json(ocupada(ms()));
    try {
      const { creds, keys, salvarCreds } = await sessao.carregar();
      if (!vinculado(creds)) return json({ ok: false, ms: ms(), detalhe: "Nenhum celular vinculado ainda." });
      const s = abrir(creds, keys, salvarCreds);
      const r = await proximo(s, 40000);
      const ok = r.tipo === "open";
      if (ok) await esperar(1500);
      fechar(s);
      if (r.tipo === "close" && r.codigo === DisconnectReason.loggedOut) {
        await sessao.apagar();
        await situacao(adm, { situacao: "desligado", numero: "", detalhe: "O celular desvinculou este aparelho. Pareie de novo." });
        return json({ ok: false, ms: ms(), detalhe: "Desvinculado pelo celular." });
      }
      const resultado = { ok, ms: ms(), resposta: r.tipo, detalhe: r.msg || "", em: new Date().toISOString() };
      await situacao(adm, { ultimo_teste: { acao, ...resultado }, ...(ok ? { situacao: "conectado", dono: "supabase", detalhe: "Conferido: a sessão guardada conectou." } : { situacao: "erro", detalhe: "Conferência falhou: " + (r.msg || r.tipo) }) });
      return json(resultado);
    } finally { await vez.soltar(); }
  }

  if (acao === "desconectar") {
    // com o motor na vez: vira pedido para ele (desvincula, apaga a sessão e avisa a tela no próximo sinal, em até 30 s)
    if ((await vez.motor()).ativo) {
      await situacao(adm, { pedido: "desconectar", detalhe: "Pedido de desconectar enviado ao motor do Android." });
      return json({ ok: true, ms: ms(), pedido: true, detalhe: "Pedido enviado ao motor do Android: ele desconecta em até 30 segundos." });
    }
    if (!(await vez.pegar(60))) return json(ocupada(ms()));
    try {
      const { creds, keys } = await sessao.carregar();
      if (vinculado(creds)) {
        const s = abrir(creds, keys);
        const r = await proximo(s, 25000);
        if (r.tipo === "open") { try { await s.logout(); } catch (_) { /* segue apagando */ } }
        fechar(s);
      }
      await sessao.apagar();
      await situacao(adm, { situacao: "desligado", numero: "", dono: "", qr_svg: null, detalhe: "Desconectado e sessão apagada." });
      // pedido antigo ao motor não vale mais (sem o v24 a coluna não existe: ignora)
      await adm.from("whatsapp_conexao").update({ pedido: null }).eq("id", 1);
      return json({ ok: true, ms: ms() });
    } finally { await vez.soltar(); }
  }

  if (acao === "processar") {
    // Sem o motor do Android: conecta, guarda as mensagens que chegaram, envia o que as regras da fila liberarem
    // (v25: horário, intervalo, limites) e desconecta. Responde na hora e trabalha em segundo plano (até ~2 min).
    if ((await vez.motor()).ativo) return json({ ok: true, motor: true, detalhe: "O motor do Android está com a conexão: ele envia e recebe sozinho, na hora." });
    const { creds, keys, salvarCreds } = await sessao.carregar();
    if (!vinculado(creds)) return json({ ok: false, ms: ms(), detalhe: "Nenhum celular vinculado." });
    if (!(await vez.pegar(150))) return json(ocupada(ms()));
    const t0 = Date.now();
    const trabalho = (async () => {
      const s = abrir(creds, keys, salvarCreds);
      const aGuardar: any[] = []; let guardadas = 0, enviadas = 0, motivo = "";
      s.ev.on("messages.upsert", ({ messages }: any) => { for (const x of messages || []) { const g = paraGuardar(x); if (g) aGuardar.push(g); } });
      const guardar = async () => {
        if (!aGuardar.length) return;
        const lote = aGuardar.splice(0, aGuardar.length);
        const { data, error } = await adm.rpc("whatsapp_guardar_mensagens", { p_msgs: lote });
        if (error) { console.error("guardar mensagens", error.message); aGuardar.unshift(...lote); } else guardadas += Number(data) || 0;
      };
      const r = await proximo(s, 40000);
      if (r.tipo !== "open") {
        fechar(s);
        if (r.tipo === "close" && r.codigo === DisconnectReason.loggedOut) {
          await sessao.apagar(); await situacao(adm, { situacao: "desligado", numero: "", detalhe: "O celular desvinculou este aparelho. Pareie de novo." });
        } else await situacao(adm, { ultimo_teste: { acao, ok: false, detalhe: r.msg || r.tipo, em: new Date().toISOString() } });
        return;
      }
      await esperar(8000); // o WhatsApp entrega o que chegou enquanto estava desconectado
      while (Date.now() - t0 < 115000) {
        await guardar();
        const { data: p, error } = await adm.rpc("whatsapp_pegar_proxima", { p_dono: "supabase", p_id: vez.id });
        if (error) { motivo = /function|does not exist|PGRST202/i.test(error.message) ? "sem o v25" : error.message; break; }
        const prox = p as { mensagem?: { id: number; telefone: string; texto: string }; motivo?: string; proximo_envio?: string };
        if (!prox || !prox.mensagem) {
          motivo = (prox && prox.motivo) || "";
          const ate = prox && prox.motivo === "intervalo" && prox.proximo_envio ? new Date(prox.proximo_envio).getTime() : 0;
          if (ate && ate - t0 < 112000) { await esperar(Math.max(500, ate - Date.now() + 500)); continue; } // espera o intervalo se couber
          break;
        }
        const m = prox.mensagem; let res: Record<string, unknown>;
        try {
          const jid = await jidParaEnvio(s, m.telefone);
          if (!jid) res = { p_ok: false, p_erro: "Número sem WhatsApp." };
          else res = { p_ok: true, p_msg_id: await enviarTexto(s, jid, m.texto), p_jid: jid };
        } catch (e) { res = { p_ok: false, p_erro: "Falha ao enviar: " + (e as Error).message }; }
        if (res.p_ok) enviadas++;
        const { error: e2 } = await adm.rpc("whatsapp_resultado", { p_dono: "supabase", p_id: vez.id, p_fila_id: m.id, p_ok: res.p_ok, p_msg_id: res.p_msg_id ?? null, p_jid: res.p_jid ?? null, p_erro: res.p_erro ?? null });
        if (e2) console.error("resultado do envio", e2.message);
        await vez.pegar(150); // renova a vez enquanto trabalha
      }
      await esperar(1500); await guardar(); fechar(s);
      await situacao(adm, { ultimo_teste: { acao, ok: true, enviadas, guardadas, motivo, ms: Date.now() - t0, em: new Date().toISOString() } });
    })().catch((e) => console.error("processar", e)).finally(() => vez.soltar());
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(trabalho); else await trabalho;
    return json({ ok: true, iniciado: true, ms: ms(), detalhe: "Buscando mensagens novas e enviando a fila (leva até 2 minutos)." });
  }

  return json({ erro: "Ação desconhecida." }, 400);
});

if (import.meta.main) Deno.serve((req) => atender(req));
