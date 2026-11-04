// DTCar Gestão — ligação com a Microsoft (login e Microsoft Graph) para o e-mail da oficina.
//
// Login: OAuth 2.0 com PKCE na conta pessoal da Microsoft (Hotmail/Outlook.com). O Danilo entra no site da Microsoft e
// autoriza; a senha nunca passa pelo sistema. Permissões pedidas: ler e-mail (Mail.Read), enviar (Mail.Send), seu
// nome e endereço (User.Read) e continuar conectado (offline_access). Nada de apagar ou mover e-mail (sem Mail.ReadWrite).
//
// Segredos da função (Supabase › Edge Functions › Secrets):
//   MS_CLIENT_ID      — "ID do aplicativo (cliente)" do registro no portal da Microsoft (Entra)
//   MS_CLIENT_SECRET  — "Valor" do segredo do cliente (registro do tipo "Web"). Vence em até 24 meses: gerar outro antes.
//                       Sem ele a função tenta como aplicativo público (só funciona se o registro for desse tipo).
//   MS_AUTORIDADE     — opcional; padrão "consumers" (contas pessoais). Use "common" se o registro aceitar as duas.

export const ESCOPOS = "offline_access openid User.Read Mail.Read Mail.Send";
const GRAPH = "https://graph.microsoft.com/v1.0";
const LIMITE_MS = 20000;

export interface Config { clientId: string; secret?: string; autoridade: string; redirect: string }
export function config(env: (k: string) => string | undefined): Config | null {
  const clientId = (env("MS_CLIENT_ID") || "").trim();
  const base = (env("SUPABASE_URL") || "").replace(/\/$/, "");
  if (!clientId || !base) return null;
  return { clientId, secret: (env("MS_CLIENT_SECRET") || "").trim() || undefined, autoridade: (env("MS_AUTORIDADE") || "consumers").trim(),
    redirect: (env("MS_REDIRECT") || "").trim() || base + "/functions/v1/email" };
}
export const enderecoRetorno = (env: (k: string) => string | undefined) =>
  (env("MS_REDIRECT") || "").trim() || (env("SUPABASE_URL") || "").replace(/\/$/, "") + "/functions/v1/email";

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const aleatorio = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function desafio(verificador: string) {
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verificador))));
}

export function urlLogin(c: Config, estado: string, desafioPkce: string): string {
  const u = new URL(`https://login.microsoftonline.com/${c.autoridade}/oauth2/v2.0/authorize`);
  u.search = new URLSearchParams({ client_id: c.clientId, response_type: "code", redirect_uri: c.redirect, response_mode: "query", scope: ESCOPOS,
    state: estado, code_challenge: desafioPkce, code_challenge_method: "S256", prompt: "select_account" }).toString();
  return u.toString();
}

export interface Tokens { access_token: string; refresh_token?: string; expires_in: number }

async function comLimite(url: string, init: RequestInit = {}, ms = LIMITE_MS): Promise<Response> {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); }
  catch (e) { throw new Error((e as Error).name === "AbortError" ? "A Microsoft não respondeu a tempo." : "Sem resposta da Microsoft: " + (e as Error).message); }
  finally { clearTimeout(t); }
}

/** Erro de login que exige conectar de novo (chave vencida, revogada ou senha trocada). */
export class PrecisaConectar extends Error {}

async function pedirToken(c: Config, corpo: Record<string, string>): Promise<Tokens> {
  const p = new URLSearchParams({ client_id: c.clientId, scope: ESCOPOS, ...corpo });
  if (c.secret) p.set("client_secret", c.secret);
  const r = await comLimite(`https://login.microsoftonline.com/${c.autoridade}/oauth2/v2.0/token`, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: p.toString() });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const cod = String(j.error || r.status), desc = String(j.error_description || "").split("\r\n")[0];
    if (cod === "invalid_grant" || cod === "interaction_required") throw new PrecisaConectar("A Microsoft pediu para conectar o e-mail de novo (" + desc.slice(0, 160) + ").");
    throw new Error("Login da Microsoft recusou: " + cod + (desc ? " — " + desc.slice(0, 200) : ""));
  }
  return j as Tokens;
}
export const trocarCodigo = (c: Config, code: string, verificador: string) =>
  pedirToken(c, { grant_type: "authorization_code", code, redirect_uri: c.redirect, code_verifier: verificador });
export const renovar = (c: Config, refresh: string) => pedirToken(c, { grant_type: "refresh_token", refresh_token: refresh });

export class ErroGraph extends Error { constructor(public status: number, msg: string, public codigo = "") { super(msg); } }

/** Chamada ao Microsoft Graph com a chave de acesso. */
export async function graph(token: string, caminho: string, op: { metodo?: string; corpo?: unknown; cabecalhos?: Record<string, string> } = {}) {
  const r = await comLimite(caminho.startsWith("http") ? caminho : GRAPH + caminho, {
    method: op.metodo || "GET",
    headers: { authorization: "Bearer " + token, ...(op.corpo !== undefined ? { "content-type": "application/json" } : {}), ...(op.cabecalhos || {}) },
    body: op.corpo !== undefined ? JSON.stringify(op.corpo) : undefined,
  });
  if (r.status === 202 || r.status === 204) return null;
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const e = (j && j.error) || {};
    if (r.status === 401) throw new PrecisaConectar("A Microsoft recusou a chave de acesso: conecte o e-mail de novo.");
    throw new ErroGraph(r.status, "Microsoft: " + (e.message || "erro " + r.status), e.code || "");
  }
  return j;
}
