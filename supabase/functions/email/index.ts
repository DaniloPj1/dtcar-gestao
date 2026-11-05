// DTCar Gestão — função "email": e-mail da oficina (Hotmail/Outlook) pelo Microsoft Graph.
//
// POST (login do administrador): ações em acoes.ts (situacao, conectar, desconectar, buscar, ler, anexo, enviar, responder,
//   regra, remover_regra). Chamada pela tela Sistema › E-mail e pelo conector do Claude (função "agente").
// GET ?code=…&state=… (sem login): retorno do login da Microsoft. Só vale o retorno do pedido feito pelo administrador
//   nos últimos 10 minutos (estado guardado em email_token), uma vez só.
//
// POST com o cabeçalho x-dtcar-cron (segredo do agendamento, o mesmo da SEFAZ): backup de leitura (v35, backup.ts) —
//   "backup_leitura" (pg_cron, todo dia às 18h) e "backup_passo" (cada passo numa chamada própria).
//
// A chave de acesso da Microsoft fica em email_token, que ninguém do sistema lê (só esta função, com a chave de servidor).
// Publicar com "Verify JWT" DESLIGADO (o retorno da Microsoft chega sem login; o POST confere o login com withSupabase).
import { withSupabase } from "npm:@supabase/server@1.9.2";
import { ErroUso, retornoLogin, SITE, tratar, type Db } from "./acoes.ts";
import { PrecisaConectar } from "./microsoft.ts";
import { ErroBackup, iniciar, limparSobras, passo, rodar, type Passo } from "./backup.ts";
import { depsBackup, segredoCron, segundoPlano } from "./backup_envio.ts";

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
const env = (k: string) => Deno.env.get(k);
// O Supabase não mostra páginas HTML de funções no endereço padrão (vira texto puro): o retorno do login
// volta direto para a tela Sistema › E-mail, com o resultado no endereço (a tela mostra o aviso).
function voltar(ok: boolean, msg: string) {
  const q = new URLSearchParams({ login: ok ? "ok" : "erro", msg: msg.slice(0, 300) });
  return new Response(null, { status: 302, headers: { location: SITE + "/#/email?" + q.toString(), "cache-control": "no-store", "referrer-policy": "no-referrer" } });
}

const retorno = withSupabase({ auth: "none" }, async (req, ctx) => {
  const url = new URL(req.url);
  if (!url.searchParams.has("state")) return voltar(false, "Endereço de retorno do login da Microsoft. Use Sistema › E-mail › Conectar Hotmail.");
  const adm = ctx.supabaseAdmin as unknown as Db;
  const r = await retornoLogin(url, { usuario: adm, adm, env });
  return voltar(r.ok, r.msg);
});

const acoes = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const { data: admin } = await ctx.supabase.rpc("e_admin");
  if (admin !== true) return json({ erro: "Só o administrador mexe no e-mail da oficina." }, 403);
  const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const adm = ctx.supabaseAdmin as unknown as Db;
    return json(await tratar(String(corpo.acao || ""), corpo, { usuario: ctx.supabase as unknown as Db, adm, env,
      backup: async () => depsBackup(adm, env, await segredoCron(adm)), segundoPlano }));
  } catch (e) {
    if (e instanceof ErroUso) return json({ erro: e.message }, 400);
    if (e instanceof PrecisaConectar) return json({ erro: e.message, precisa_conectar: true }, 409);
    console.error("email", e);
    return json({ erro: (e as Error).message || "Falha no e-mail." }, 502);
  }
});

// Agendamento (pg_cron) e passos do backup de leitura: só com o segredo do agendamento (tabela segredos, chave "cron").
const agendamento = withSupabase({ auth: "none" }, async (req, ctx) => {
  const adm = ctx.supabaseAdmin as unknown as Db;
  const cron = await segredoCron(adm), h = req.headers.get("x-dtcar-cron") || "";
  if (!h || !cron || h !== cron) return json({ erro: "Agendamento não autorizado." }, 401);
  const c = await req.json().catch(() => ({})) as Record<string, unknown>;
  const db = depsBackup(adm, env, cron);
  try {
    if (c.acao === "backup_leitura") {
      await limparSobras(db).catch(() => {});
      const r = await iniciar(db, "agendamento");
      if (!r.ja_rodando) segundoPlano(rodar(db, r.exec));
      return json(r);
    }
    if (c.acao === "backup_passo") return json(await passo(db, Number(c.exec), String(c.passo) as Passo));
    return json({ erro: "Ação desconhecida." }, 400);
  } catch (e) {
    const msg = (e as Error).message || "Falha no backup.";
    // o agendamento não começou (sem senha, sem o v35…): fica no histórico para o aviso das 18h40 explicar o motivo
    if (c.acao === "backup_leitura" && !/desligado/i.test(msg)) {
      await adm.from("backup_execucoes").insert({ origem: "agendamento", situacao: "erro", passo: "inicio", erro: msg.slice(0, 500), terminado_em: new Date().toISOString() }).then(() => {}, () => {});
    }
    return json({ erro: msg }, e instanceof ErroBackup ? 400 : 500);
  }
});

// GET = retorno do login da Microsoft; o resto (POST e a consulta prévia OPTIONS do navegador) passa pelo login
export const atender = (req: Request) => req.method === "GET" ? retorno(req)
  : req.method === "POST" && req.headers.get("x-dtcar-cron") ? agendamento(req) : acoes(req);

if (import.meta.main) Deno.serve((req) => atender(req));
