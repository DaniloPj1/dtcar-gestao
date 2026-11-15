// DTCar Gestão — função "cpf": nome e data de nascimento do cliente pelo CPF, na API CPF (apicpf.com).
// Pedido do Danilo em 15/11/2026.
//
// Ações (POST com { acao, cpf }):
//   consultar — nome e data de nascimento da pessoa. SÓ ADMINISTRADOR (decisão do Danilo em 15/11/2026).
//   situacao  — diz se a chave está no lugar (não consulta ninguém). Só administrador.
//
// REGRA DO DANILO (a mesma da placa): só vai à API quando o sistema ainda não tem os dados.
//   1º o cadastro de clientes (CPF já cadastrado com nome → responde dele);
//   2º só então a API.
// Não existe tabela de cópia: depois de cadastrado, o cliente é a cópia. Nada da consulta fica guardado no servidor
// (dado pessoal: o sistema guarda só o que vai para o cadastro do cliente, quando a pessoa salva).
// A função NÃO grava nada: quem grava é a tela (ou o conector, pelo salvar_cadastro).
//
// A API CPF devolve nome, gênero e data de nascimento. O cadastro da oficina usa o nome e a data de nascimento
// (não existe campo de gênero no cadastro: não vai para a tela).
// Plano grátis (15/11/2026): 100 consultas por dia, 6 por minuto, e 5 créditos para CPF que não está na base deles
// (aí eles buscam numa base de parceiros: 1 crédito por CPF achado). Sem crédito a API responde 402 só para esses CPFs.
// A licença grátis vence a cada mês e é renovada no painel (sem custo): vencida, a API responde 403.
//
// Segredo (Supabase › Edge Functions › Secrets; nunca no repositório nem no chat):
//   API_CPF_TOKEN   a chave do painel da API CPF (apicpf.com › Minhas Chaves API)
// Publicar com "Verify JWT" desligado (a função confere o login).
import { withSupabase } from "npm:@supabase/server@1.9.2";

export const BASE = "https://apicpf.com";
// O site espera no máximo 15 s por resposta (fetchComLimite em js/api.js)
const LIMITE_MS = 9000;

// deno-lint-ignore no-explicit-any
type Json = Record<string, any>;
export type Dados = { nome: string; nascimento: string };
export class ErroUso extends Error {}

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
export const soDig = (s: unknown) => String(s ?? "").replace(/\D/g, "");
export function cpfValido(v: unknown): boolean {
  const c = soDig(v); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i); let d = (s * 10) % 11; if (d === 10) d = 0; if (d !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i); d = (s * 10) % 11; if (d === 10) d = 0; return d === +c[10];
}
const txt = (s: unknown) => (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(/\s+/g, " ").trim();

/** Nome como a API escreve, só sem espaço sobrando (a pessoa confere e ajusta na tela) */
export const nomeDe = (s: unknown) => txt(s);
/** Data de nascimento no formato do cadastro (AAAA-MM-DD); data impossível ou no futuro fica em branco */
export function nascimentoDe(s: unknown, agora = new Date()): string {
  const t = txt(s);
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/) || (t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/) ? [t, t.slice(6, 10), t.slice(3, 5), t.slice(0, 2)] : null);
  if (!m) return "";
  const a = +m[1], me = +m[2], d = +m[3], dt = new Date(Date.UTC(a, me - 1, d));
  if (a < 1900 || dt.getUTCFullYear() !== a || dt.getUTCMonth() !== me - 1 || dt.getUTCDate() !== d || dt.getTime() > agora.getTime()) return "";
  return `${m[1]}-${m[2]}-${m[3]}`;
}
/** Resposta da API ({ code, data: { cpf, nome, genero, data_nascimento } }) → dados do cadastro */
export function normalizar(r: Json | null | undefined, agora = new Date()): Dados {
  const d = (r && typeof r.data === "object" && r.data) || {};
  return { nome: nomeDe(d.nome), nascimento: nascimentoDe(d.data_nascimento, agora) };
}

type Erro = { encontrado?: false; erro?: string; desligada?: true; sem_creditos?: true; limite?: true };
/** Resposta de erro da API em português para a tela */
export function erroDaApi(status: number, c: Json | null): Erro {
  const m = txt(c && c.message);
  if (status === 404) return { encontrado: false };
  if (status === 402) return { encontrado: false, sem_creditos: true, erro: "A API CPF não tem este CPF na base dela e acabaram os créditos da busca externa. Preencha o nome à mão." };
  if (status === 401) return { desligada: true, erro: "A chave da API CPF não foi aceita. Confira o segredo API_CPF_TOKEN da função \"cpf\" no Supabase." };
  if (status === 403) return { desligada: true, erro: "A licença da API CPF venceu. Renove (sem custo no plano grátis) no painel apicpf.com e a consulta volta a funcionar." };
  if (status === 429) return { limite: true, erro: /minuto/i.test(m) ? "Muitas consultas de CPF em um minuto. Espere um pouco e tente de novo." : /repetid/i.test(m) ? "Este CPF já foi consultado várias vezes hoje. Tente amanhã ou preencha à mão." : "O limite de consultas de CPF de hoje acabou. Amanhã volta a funcionar." };
  if (status === 400) return { erro: "A API CPF não aceitou este CPF. Confira os números." };
  if (status >= 500) return { erro: "A consulta de CPF está fora do ar agora. Tente daqui a pouco." };
  return { erro: "A API CPF respondeu: " + (m || "erro " + status).replace(/\.$/, "") + "." };
}

export type Deps = {
  admin: boolean;
  token: string | undefined;
  /** o cliente no cadastro (tabela clientes) com este CPF, lido com o login de quem pediu */
  cadastro: (cpf: string) => Promise<Json | null>;
  fetch: typeof fetch;
  agora?: () => Date;
};

const SEM_CHAVE = { ok: false, desligada: true, erro: "A consulta de CPF ainda não foi ligada: falta a chave da API CPF (segredo API_CPF_TOKEN da função \"cpf\" no Supabase)." };

export async function executar(corpo: Record<string, unknown>, deps: Deps): Promise<Record<string, unknown>> {
  const acao = String(corpo.acao || "");
  if (!deps.admin) throw new ErroUso("A consulta de CPF é só para o administrador.");
  if (acao === "situacao") return deps.token ? { ok: true, ligada: true } : SEM_CHAVE;
  if (acao !== "consultar") throw new ErroUso("Ação desconhecida: " + acao);
  const cpf = soDig(corpo.cpf);
  if (!cpfValido(cpf)) throw new ErroUso("CPF inválido. Confira os 11 números.");
  const agora = (deps.agora || (() => new Date()))();

  // 1º o cadastro: já temos este CPF com nome? então não vai à API
  const c = await deps.cadastro(cpf);
  if (c && txt(c.nome)) {
    return { ok: true, encontrado: true, cpf, origem: "cadastro", cliente_id: c.id ?? null, codigo: c.codigo ?? null,
      dados: { nome: txt(c.nome), nascimento: nascimentoDe(c.nascimento, agora) } };
  }

  // 2º a API
  if (!deps.token) return { ...SEM_CHAVE, cpf };
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), LIMITE_MS);
  let status = 0, resp: Json | null = null, creditos: number | null = null;
  try {
    // a chave vai no cabeçalho (nunca no endereço, que fica em registro de servidor)
    const r = await deps.fetch(BASE + "/api/consulta?cpf=" + cpf, { headers: { "X-API-KEY": deps.token, accept: "application/json" }, signal: ac.signal });
    status = r.status; resp = await r.json().catch(() => null);
    const cr = r.headers.get("x-credits-remaining"); if (cr !== null && /^\d+$/.test(cr.trim())) creditos = Number(cr.trim());
  } catch (_e) {
    return { ok: false, cpf, erro: "A API CPF não respondeu a tempo. Tente daqui a pouco." };
  } finally { clearTimeout(t); }
  const extra = creditos === null ? {} : { creditos };
  if (status !== 200) { const e = erroDaApi(status, resp); return { ok: e.encontrado === false, cpf, ...e, ...extra }; }
  const dados = normalizar(resp, agora);
  if (!dados.nome) return { ok: true, cpf, encontrado: false, ...extra };
  return { ok: true, encontrado: true, cpf, origem: "api", dados, ...extra };
}

export const atender = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const a = await ctx.supabase.rpc("e_admin");
    return json(await executar(corpo, {
      admin: a.data === true, token: (Deno.env.get("API_CPF_TOKEN") || "").trim() || undefined, fetch,
      cadastro: async (cpf) => {
        const { data, error } = await ctx.supabase.from("clientes").select("id,codigo,nome,nascimento").eq("doc", cpf).limit(1);
        if (error) throw new Error("Falha ao ler o cadastro de clientes: " + error.message);
        return (data && data[0]) || null;
      },
    }));
  } catch (e) {
    if (e instanceof ErroUso) return json({ ok: false, erro: e.message }, 400);
    console.error("cpf", (e as Error).message);   // sem o CPF nem o nome no registro
    return json({ ok: false, erro: (e as Error).message || "Falha na consulta do CPF." }, 200);
  }
});

if (import.meta.main) Deno.serve((req) => atender(req));
