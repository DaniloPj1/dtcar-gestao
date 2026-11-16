// DTCar Gestão — função "equipe": o administrador cria o login e a senha do colaborador pelo sistema (Sistema › Equipe)
// e troca a senha de quem esqueceu. Pedido do Danilo em 16/11/2026.
//
// Ações (POST com { acao, ... }), SÓ ADMINISTRADOR (conferido pelo login de quem chama, e_admin):
//   criar  — { nome, email, senha, papel }: cria o usuário no Supabase Auth já confirmado (sem e-mail de confirmação) e deixa
//            o acesso em perfis com o nome e o papel escolhidos (admin, consultor ou mecanico). Devolve { ok, id }.
//   senha  — { id, senha }: troca a senha de um acesso da equipe (quem esqueceu). Não serve para a própria senha
//            (para isso existe a tela de nova senha, com a senha atual confirmada).
// A senha NUNCA é guardada nem registrada: vai direto para o Supabase Auth e some. Nada da senha aparece nos registros (logs).
// Regras: e-mail válido; senha com 8 ou mais caracteres, letras e números; papel só da lista; e-mail já usado é recusado.
// Publicar com "Verify JWT" desligado (a função confere o login). Usa a chave de servidor do próprio Supabase (ctx.supabaseAdmin).
import { withSupabase } from "npm:@supabase/server@1.9.2";

export class ErroUso extends Error {}
const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
export const PAPEIS = ["admin", "consultor", "mecanico"];
export const emailValido = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 120;
/** 8+ caracteres, com pelo menos uma letra e um número (o Supabase exige 6) */
export const senhaValida = (s: string) => s.length >= 8 && s.length <= 72 && /[A-Za-z]/.test(s) && /\d/.test(s);

export type Deps = {
  admin: boolean;
  quem: string;                                                   // id de quem chama
  criarUsuario: (email: string, senha: string, nome: string) => Promise<{ id?: string; erro?: string }>;
  ajustarPerfil: (id: string, nome: string, papel: string, email: string) => Promise<void>;
  trocarSenha: (id: string, senha: string) => Promise<{ erro?: string }>;
  perfil: (id: string) => Promise<{ id: string; nome: string } | null>;
};

export async function executar(corpo: Record<string, unknown>, deps: Deps): Promise<Record<string, unknown>> {
  if (!deps.admin) throw new ErroUso("Só o administrador cria acessos e troca senhas da equipe.");
  const acao = String(corpo.acao || "");
  if (acao === "criar") {
    const nome = String(corpo.nome ?? "").trim().replace(/\s+/g, " "), email = String(corpo.email ?? "").trim().toLowerCase(), senha = String(corpo.senha ?? ""), papel = String(corpo.papel ?? "");
    if (nome.length > 80) throw new ErroUso("O nome pode ter no máximo 80 caracteres.");
    if (nome.length < 2) throw new ErroUso("Informe o nome do colaborador.");
    if (!emailValido(email)) throw new ErroUso("Informe um e-mail válido (é o login da pessoa).");
    if (!senhaValida(senha)) throw new ErroUso("A senha precisa ter 8 ou mais caracteres, com letras e números.");
    if (!PAPEIS.includes(papel)) throw new ErroUso("Escolha o papel: administrador, consultor ou mecânico.");
    const u = await deps.criarUsuario(email, senha, nome);
    if (!u.id) {
      if (/already|registered|exists|duplicate/i.test(u.erro || "")) throw new ErroUso("Este e-mail já tem acesso. Use “Trocar senha” na pessoa, ou outro e-mail.");
      throw new Error(u.erro || "Não deu para criar o acesso.");
    }
    await deps.ajustarPerfil(u.id, nome, papel, email);   // o gatilho do banco cria o perfil como "pendente"; aqui entram o nome e o papel escolhidos
    return { ok: true, id: u.id, email };
  }
  if (acao === "senha") {
    const id = String(corpo.id ?? ""), senha = String(corpo.senha ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroUso("Acesso não encontrado.");
    if (id === deps.quem) throw new ErroUso("Para trocar a sua própria senha use “Nova senha” na tela de entrar.");
    if (!senhaValida(senha)) throw new ErroUso("A senha precisa ter 8 ou mais caracteres, com letras e números.");
    const p = await deps.perfil(id);
    if (!p) throw new ErroUso("Acesso não encontrado.");
    const r = await deps.trocarSenha(id, senha);
    if (r.erro) throw new Error(r.erro);
    return { ok: true, id, nome: p.nome };
  }
  throw new ErroUso("Ação desconhecida.");
}

export const atender = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const a = await ctx.supabase.rpc("e_admin");
    const admin = ctx.supabaseAdmin;
    return json(await executar(corpo, {
      admin: a.data === true, quem: String((ctx.userClaims && ctx.userClaims.id) || ""),
      criarUsuario: async (email, senha, nome) => {
        const { data, error } = await admin.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } });
        return error ? { erro: error.message } : { id: data.user?.id };
      },
      ajustarPerfil: async (id, nome, papel, email) => {
        // o gatilho ao_criar_usuario já criou a linha como "pendente"; se por acaso não criou, cria aqui.
        // O update vai com o login do administrador (ctx.supabase), não com a chave de servidor: o gatilho
        // protege_papel só deixa trocar o papel quando e_admin() é verdadeiro, e isso depende do JWT de quem chama.
        const r = await ctx.supabase.from("perfis").update({ nome, papel, ativo: true }).eq("id", id).select("id");
        if (r.error) throw new Error("Acesso criado, mas não deu para gravar o papel: " + r.error.message);
        if (!r.data || !r.data.length) { const r2 = await admin.from("perfis").insert({ id, nome, email, papel, ativo: true }); if (r2.error) throw new Error("Acesso criado, mas não deu para gravar o perfil: " + r2.error.message); }
      },
      trocarSenha: async (id, senha) => { const { error } = await admin.auth.admin.updateUserById(id, { password: senha }); return error ? { erro: error.message } : {}; },
      perfil: async (id) => { const { data } = await admin.from("perfis").select("id,nome").eq("id", id).maybeSingle(); return data || null; },
    }));
  } catch (e) {
    if (e instanceof ErroUso) return json({ ok: false, erro: e.message }, 400);
    console.error("equipe", String((e as Error).message || e).slice(0, 200));   // nunca a senha: só a mensagem do erro
    return json({ ok: false, erro: (e as Error).message || "Falha na função equipe." }, 200);
  }
});

if (import.meta.main) Deno.serve((req) => atender(req));
