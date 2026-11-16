// Teste da função "equipe" (criar login e senha do colaborador; trocar senha) sem rede: Supabase de mentira.
// Rodar: deno run -A teste/teste_equipe.ts
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, x = "") => (c ? ok : falhas).push(n + (x ? " (" + x + ")" : ""));
Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { executar, senhaValida, emailValido, ErroUso } = await import("../supabase/functions/equipe/index.ts");
type Deps = Parameters<typeof executar>[1];

confere("senha: 8+ com letra e número", senhaValida("abc12345") && senhaValida("Dtcar2026") && !senhaValida("12345678") && !senhaValida("abcdefgh") && !senhaValida("ab12") && !senhaValida(""));
confere("e-mail válido", emailValido("joao@dtcar.com.br") && !emailValido("joao") && !emailValido("joao@") && !emailValido("a b@x.com"));

const usuarios: Record<string, string> = { "11111111-1111-4111-8111-111111111111": "ana@dtcar.com" };
const perfis: Record<string, { nome: string; papel: string; ativo: boolean }> = { "11111111-1111-4111-8111-111111111111": { nome: "Ana", papel: "consultor", ativo: true } };
const senhas: Record<string, string> = {};
const log: string[] = [];
const deps = (admin: boolean, quem = "00000000-0000-4000-8000-000000000000"): Deps => ({
  admin, quem,
  criarUsuario: async (email, senha, nome) => { log.push("criar " + email + " " + nome);
    if (Object.values(usuarios).includes(email)) return { erro: "A user with this email address has already been registered" };
    const id = "22222222-2222-4222-8222-" + String(Object.keys(usuarios).length).padStart(12, "0"); usuarios[id] = email; senhas[id] = senha;
    perfis[id] = { nome: email.split("@")[0], papel: "pendente", ativo: true }; return { id }; },   // como o gatilho do banco
  ajustarPerfil: async (id, nome, papel) => { perfis[id] = { ...perfis[id], nome, papel, ativo: true }; },
  trocarSenha: async (id, senha) => { if (!usuarios[id]) return { erro: "User not found" }; senhas[id] = senha; return {}; },
  perfil: async (id) => perfis[id] ? { id, nome: perfis[id].nome } : null,
});
const erro = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return (e instanceof ErroUso ? "USO:" : "ERRO:") + (e as Error).message; } };

confere("não administrador é barrado", /USO:.*administrador/.test(await erro(executar({ acao: "criar", nome: "X", email: "x@x.com", senha: "abc12345", papel: "mecanico" }, deps(false)))));
confere("nome em branco", /USO:.*nome/.test(await erro(executar({ acao: "criar", nome: " ", email: "x@x.com", senha: "abc12345", papel: "mecanico" }, deps(true)))));
confere("e-mail inválido", /USO:.*e-mail/.test(await erro(executar({ acao: "criar", nome: "Carlos", email: "carlos", senha: "abc12345", papel: "mecanico" }, deps(true)))));
confere("senha fraca", /USO:.*8 ou mais/.test(await erro(executar({ acao: "criar", nome: "Carlos", email: "c@x.com", senha: "123", papel: "mecanico" }, deps(true)))));
confere("papel fora da lista", /USO:.*papel/.test(await erro(executar({ acao: "criar", nome: "Carlos", email: "c@x.com", senha: "abc12345", papel: "dono" }, deps(true)))));
confere("e-mail já usado", /USO:.*já tem acesso/.test(await erro(executar({ acao: "criar", nome: "Ana 2", email: "ANA@dtcar.com", senha: "abc12345", papel: "mecanico" }, deps(true)))));
const r = await executar({ acao: "criar", nome: "  Carlos   Mecânico ", email: " Carlos@DTCar.com ", senha: "Dtcar2026", papel: "mecanico" }, deps(true)) as Record<string, string>;
const id = r.id;
confere("cria o usuário já confirmado, com e-mail minúsculo e nome limpo", r.ok === true && usuarios[id] === "carlos@dtcar.com" && perfis[id].nome === "Carlos Mecânico" && perfis[id].papel === "mecanico" && perfis[id].ativo === true && senhas[id] === "Dtcar2026", JSON.stringify(r));
confere("a senha não vai para o registro", !log.some(l => l.includes("Dtcar2026")));
confere("trocar senha: não administrador barrado", /USO:/.test(await erro(executar({ acao: "senha", id, senha: "nova12345" }, deps(false)))));
confere("trocar senha: a própria senha não é por aqui", /USO:.*própria/.test(await erro(executar({ acao: "senha", id, senha: "nova12345" }, deps(true, id)))));
confere("trocar senha: acesso que não existe", /USO:.*não encontrado/.test(await erro(executar({ acao: "senha", id: "33333333-3333-4333-8333-333333333333", senha: "nova12345" }, deps(true)))));
confere("trocar senha: id estranho", /USO:.*não encontrado/.test(await erro(executar({ acao: "senha", id: "x'; drop", senha: "nova12345" }, deps(true)))));
const r2 = await executar({ acao: "senha", id, senha: "Nova2027x" }, deps(true)) as Record<string, string>;
confere("troca a senha do colaborador", r2.ok === true && r2.nome === "Carlos Mecânico" && senhas[id] === "Nova2027x");
confere("ação desconhecida", /USO:/.test(await erro(executar({ acao: "apagar" }, deps(true)))));

console.log(ok.length + " OK, " + falhas.length + " falha(s)"); falhas.forEach(f => console.log("FALHA: " + f));
if (falhas.length) Deno.exit(1);
