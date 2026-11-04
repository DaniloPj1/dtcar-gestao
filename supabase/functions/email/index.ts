// DTCar Gestão — função "email": e-mail da oficina (Hotmail/Outlook) pelo Microsoft Graph.
//
// POST (login do administrador): ações em acoes.ts (situacao, conectar, desconectar, buscar, ler, anexo, enviar, responder,
//   regra, remover_regra). Chamada pela tela Sistema › E-mail e pelo conector do Claude (função "agente").
// GET ?code=…&state=… (sem login): retorno do login da Microsoft. Só vale o retorno do pedido feito pelo administrador
//   nos últimos 10 minutos (estado guardado em email_token), uma vez só.
//
// A chave de acesso da Microsoft fica em email_token, que ninguém do sistema lê (só esta função, com a chave de servidor).
// Publicar com "Verify JWT" DESLIGADO (o retorno da Microsoft chega sem login; o POST confere o login com withSupabase).
import { withSupabase } from "npm:@supabase/server@1.9.2";
import { ErroUso, retornoLogin, SITE, tratar, type Db } from "./acoes.ts";
import { PrecisaConectar } from "./microsoft.ts";

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
    return json(await tratar(String(corpo.acao || ""), corpo, { usuario: ctx.supabase as unknown as Db, adm: ctx.supabaseAdmin as unknown as Db, env }));
  } catch (e) {
    if (e instanceof ErroUso) return json({ erro: e.message }, 400);
    if (e instanceof PrecisaConectar) return json({ erro: e.message, precisa_conectar: true }, 409);
    console.error("email", e);
    return json({ erro: (e as Error).message || "Falha no e-mail." }, 502);
  }
});

// GET = retorno do login da Microsoft; o resto (POST e a consulta prévia OPTIONS do navegador) passa pelo login
export const atender = (req: Request) => req.method === "GET" ? retorno(req) : acoes(req);

if (import.meta.main) Deno.serve((req) => atender(req));
