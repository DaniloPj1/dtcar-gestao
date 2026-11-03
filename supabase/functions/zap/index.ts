// DTCar Gestão — função "zap": WhatsApp próprio da oficina (biblioteca Baileys), etapa 1.
//
// Nesta etapa só confere se o WhatsApp funciona dentro do Supabase:
//   testar      — conecta sem vincular nada e espera o WhatsApp responder (nenhum celular é contatado)
//   parear      — pede o código de pareamento para o número da oficina; o Danilo digita o código no
//                 celular (Aparelhos conectados › Conectar com número). A função fica esperando o
//                 pareamento terminar em segundo plano e guarda a sessão em whatsapp_sessao.
//   conferir    — volta a conectar com a sessão guardada (prova de que dá para conectar sob demanda)
//   desconectar — desvincula o aparelho e apaga a sessão
// Ainda não envia nem recebe mensagens (etapas seguintes).
//
// Só o administrador (token do usuário, conferido aqui). As chaves da sessão ficam numa tabela que
// ninguém do sistema lê (v22): a função usa a chave de servidor só para essa tabela e para a situação.
// Publicar com "Verify JWT" desligado (a função confere o login com withSupabase).
// Biblioteca: SOMENTE o pacote oficial "baileys" (WhiskeySockets), com a versão travada.
import { withSupabase } from "npm:@supabase/server@1.9.2";
import makeWASocket, { BufferJSON, Browsers, DisconnectReason, initAuthCreds, makeCacheableSignalKeyStore, proto } from "npm:baileys@7.0.0-rc14";

type Db = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any };
declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined;

// registro da biblioteca: só erros vão para o log da função
const log: any = { level: "error", child() { return log; }, trace() {}, debug() {}, info() {}, warn() {}, fatal(...a: unknown[]) { console.error(...a); },
  error(...a: unknown[]) { console.error("baileys", ...a); } };

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
// valores da sessão têm bytes (Buffer): grava e lê com o conversor da própria biblioteca
const paraBanco = (v: unknown) => JSON.parse(JSON.stringify(v, BufferJSON.replacer));
const doBanco = (v: unknown) => JSON.parse(JSON.stringify(v), BufferJSON.reviver);

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

async function situacao(adm: Db, patch: Record<string, unknown>) {
  await adm.from("whatsapp_conexao").update({ ...patch, atualizado_em: new Date().toISOString() }).eq("id", 1);
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
function proximo(sock: Sock, ms: number, aceitarQr = true): Promise<{ tipo: "qr" | "open" | "close" | "tempo"; codigo?: number; msg?: string }> {
  return new Promise((res) => {
    const t = setTimeout(() => res({ tipo: "tempo" }), ms);
    sock.ev.on("connection.update", (u: any) => {
      if (u.qr) { if (aceitarQr) { clearTimeout(t); res({ tipo: "qr" }); } }
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

  if (acao === "testar") {
    // sessão nova só na memória: conecta e espera o WhatsApp oferecer o pareamento; nada é gravado e nenhum celular é contatado
    const s = abrir(initAuthCreds(), { get: async () => ({}), set: async () => {} });
    const r = await proximo(s, 40000); fechar(s);
    const ok = r.tipo === "qr";
    const resultado = { ok, ms: ms(), resposta: r.tipo, detalhe: r.msg || "", em: new Date().toISOString() };
    await situacao(adm, { ultimo_teste: { acao, ...resultado }, detalhe: ok ? "Teste de conexão: o WhatsApp respondeu." : "Teste de conexão falhou: " + (r.msg || r.tipo) });
    return json(resultado);
  }

  if (acao === "parear") {
    const numero = String(corpo.numero || "").replace(/\D/g, "");
    if (numero.length < 12 || numero.length > 13 || !numero.startsWith("55")) return json({ erro: "Informe o número com 55 + DDD + número (ex.: 5527999990000)." }, 400);
    const atual = await sessao.carregar();
    if (atual.creds.registered) return json({ erro: "Já existe um aparelho vinculado. Desconecte antes de parear de novo." }, 409);
    // uma tentativa por vez. A execução da função dura no máximo 150 s (plano grátis), contando a preparação, a espera e o
    // fim: a reserva cobre a execução inteira (160 s a partir de agora) e a espera termina aos 140 s, antes do limite
    const t0 = Date.now();
    const reserva = await sessao.reservar(160000);
    if (!reserva) return json({ erro: "Já há um pareamento em andamento. Use o código pedido antes ou espere uns 2 minutos e peça outro." }, 409);
    // só vale enquanto esta tentativa for a dona da reserva (uma tentativa antiga não mexe na situação de uma nova)
    const minha = async () => (await sessao.reservaAtual()) === reserva;
    const situacaoSeMinha = async (patch: Record<string, unknown>) => { if (await minha()) await situacao(adm, patch); };
    // começa de uma sessão limpa (sobras de uma tentativa que não terminou atrapalham o pareamento)
    await sessao.apagar(false);
    const { creds, keys, salvarCreds } = await sessao.carregar();
    const salvarSeMinha = async () => { if (await minha()) await salvarCreds(); };
    let s = abrir(creds, keys, salvarSeMinha);
    const r = await proximo(s, 30000);
    if (r.tipo !== "qr") { fechar(s); await sessao.liberar(reserva); return json({ erro: "O WhatsApp não respondeu (" + (r.msg || r.tipo) + ")." }, 502); }
    let codigo: string;
    try { codigo = await s.requestPairingCode(numero); } catch (e) { fechar(s); await sessao.liberar(reserva); return json({ erro: "Não foi possível pedir o código: " + (e as Error).message }, 502); }
    await situacao(adm, { situacao: "pareando", numero, detalhe: "Código pedido: digite no celular em até 2 minutos." });
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
        await situacaoSeMinha({ situacao: "conectado", dono: "supabase", numero: String(s.user?.id || numero).split(":")[0].split("@")[0], detalhe: "Celular vinculado." });
      } else {
        await situacaoSeMinha({ situacao: "erro", detalhe: "Pareamento não concluído (" + (ev.msg || ev.tipo) + "). Peça um código novo." });
      }
      fechar(s);
      await sessao.liberar(reserva);
    })().catch(async (e) => { fechar(s); await situacaoSeMinha({ situacao: "erro", detalhe: "Pareamento falhou: " + (e as Error).message }); await sessao.liberar(reserva); });
    if (typeof EdgeRuntime !== "undefined") EdgeRuntime.waitUntil(fim);
    return json({ codigo, ms: ms(), validade_s: Math.max(30, Math.round((t0 + 140000 - Date.now()) / 1000)) });
  }

  if (acao === "conferir") {
    const { creds, keys, salvarCreds } = await sessao.carregar();
    if (!creds.registered) return json({ ok: false, ms: ms(), detalhe: "Nenhum celular vinculado ainda." });
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
    await situacao(adm, { ultimo_teste: { acao, ...resultado }, ...(ok ? { situacao: "conectado", detalhe: "Conferido: a sessão guardada conectou." } : { situacao: "erro", detalhe: "Conferência falhou: " + (r.msg || r.tipo) }) });
    return json(resultado);
  }

  if (acao === "desconectar") {
    const { creds, keys } = await sessao.carregar();
    if (creds.registered) {
      const s = abrir(creds, keys);
      const r = await proximo(s, 25000);
      if (r.tipo === "open") { try { await s.logout(); } catch (_) { /* segue apagando */ } }
      fechar(s);
    }
    await sessao.apagar();
    await situacao(adm, { situacao: "desligado", numero: "", dono: "", detalhe: "Desconectado e sessão apagada." });
    return json({ ok: true, ms: ms() });
  }

  return json({ erro: "Ação desconhecida." }, 400);
});

if (import.meta.main) Deno.serve((req) => atender(req));
