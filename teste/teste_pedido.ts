// Teste da função "pedido" (pedido de orçamento pelo app: novo e acrescentar) sem rede: Supabase de mentira.
// Rodar: deno run -A teste/teste_pedido.ts
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, x = "") => (c ? ok : falhas).push(n + (x ? " (" + x + ")" : ""));
Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { executar, MARCA_APP, quando, normPlaca, ErroUso } = await import("../supabase/functions/pedido/index.ts");
type Deps = Parameters<typeof executar>[1];
type Orc = { id: string; numero: number; situacao: string; reclamacao: string; obs_internas: string; [k: string]: unknown };

const AGORA = new Date("2026-11-16T18:30:00Z");   // 15:30 em Brasília
confere("hora em Brasília", quando(AGORA) === "16/11/2026 15:30", quando(AGORA));
confere("placa limpa", normPlaca("abc-1d23") === "ABC1D23" && normPlaca("") === "");

const banco: Orc[] = [{ id: "22222222-2222-4222-8222-222222222222", numero: 7, situacao: "enviado", reclamacao: "Troca de pastilhas", obs_internas: "" },
  { id: "33333333-3333-4333-8333-333333333333", numero: 8, situacao: "aprovado", reclamacao: "x", obs_internas: "" }];
const inseridos: Record<string, unknown>[] = [];
const deps = (membro: boolean, nome = "Carlos Mecânico"): Deps => ({
  membro, quem: "11111111-1111-4111-8111-111111111111", nome, agora: AGORA,
  inserir: async (o) => { inseridos.push(o); return { id: "44444444-4444-4444-8444-444444444444", numero: 9 }; },
  ler: async (id) => banco.find((o) => o.id === id) || null,
  gravar: async (id, patch) => { const o = banco.find((x) => x.id === id)!; Object.assign(o, patch); },
});
const erro = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return (e instanceof ErroUso ? "USO:" : "ERRO:") + (e as Error).message; } };

confere("quem não é da equipe é barrado", /USO:.*equipe/.test(await erro(executar({ acao: "novo", texto: "abc", placa: "ABC1D23" }, deps(false)))));
confere("texto obrigatório", /USO:.*orçar/.test(await erro(executar({ acao: "novo", texto: "  ", placa: "ABC1D23" }, deps(true)))));
confere("texto comprido demais", /USO:.*2000/.test(await erro(executar({ acao: "novo", texto: "a".repeat(2001), placa: "ABC1D23" }, deps(true)))));
confere("placa incompleta", /USO:.*placa/i.test(await erro(executar({ acao: "novo", texto: "trocar óleo", placa: "ABC12" }, deps(true)))));
confere("sem placa e sem nome", /USO:.*placa ou o nome/.test(await erro(executar({ acao: "novo", texto: "trocar óleo" }, deps(true)))));
confere("ação desconhecida", /USO:.*desconhecida/.test(await erro(executar({ acao: "x", texto: "trocar óleo" }, deps(true)))));

const r = await executar({ acao: "novo", texto: "  Trocar óleo e filtro \r\nVer barulho na frente  ", placa: "abc1d23", veiculo: { marca: "FIAT", modelo: "UNO", ano: "2015" }, veiculo_id: "55555555-5555-4555-8555-555555555555", cliente_id: "lixo", cliente: { nome: "JOÃO", telefone: "(27) 99999-0000" } }, deps(true));
confere("novo devolve id e número", r.ok === true && r.numero === 9 && r.id === "44444444-4444-4444-8444-444444444444");
const i = inseridos[0] as Record<string, any>;
confere("novo grava em elaboração sem preço", i.situacao === "elaboracao" && i.total === 0 && i.desconto === 0 && !("itens" in i));
confere("novo guarda o texto limpo em reclamacao", i.reclamacao === "Trocar óleo e filtro\nVer barulho na frente");
confere("novo marca 'Pedido pelo app' com quem e quando", i.obs_internas === MARCA_APP + " — Carlos Mecânico, 16/11/2026 15:30");
confere("novo guarda placa, veículo e cliente (id inválido vira null)", i.veiculo.placa === "ABC1D23" && i.veiculo.marca === "FIAT" && i.veiculo_id === "55555555-5555-4555-8555-555555555555" && i.cliente_id === null && i.cliente.nome === "JOÃO" && i.cliente.telefone === "27999990000");
confere("novo grava quem pediu", i.consultor_id === "11111111-1111-4111-8111-111111111111" && i.consultor_nome === "Carlos Mecânico" && i.criado_por === i.consultor_id);

confere("acrescentar exige orçamento válido", /USO:.*inválido/.test(await erro(executar({ acao: "acrescentar", id: "x", texto: "mais isso" }, deps(true)))));
confere("acrescentar em orçamento que não existe", /USO:.*não existe/.test(await erro(executar({ acao: "acrescentar", id: "99999999-9999-4999-8999-999999999999", texto: "mais isso" }, deps(true)))));
confere("acrescentar em orçamento aprovado é recusado", /USO:.*aprovado.*O\.S\./.test(await erro(executar({ acao: "acrescentar", id: "33333333-3333-4333-8333-333333333333", texto: "mais isso" }, deps(true)))));
const r2 = await executar({ acao: "acrescentar", id: "22222222-2222-4222-8222-222222222222", texto: "Verificar bateria" }, deps(true, "Ana"));
confere("acrescentar devolve ok com o número", r2.ok === true && r2.numero === 7);
confere("acrescentar junta ao pedido com nome e hora", banco[0].reclamacao === "Troca de pastilhas\n— Ana, 16/11/2026 15:30: Verificar bateria" && typeof banco[0].atualizado_em === "string");

console.log(ok.length + " OK, " + falhas.length + " falha(s)"); falhas.forEach((f) => console.log("FALHA: " + f));
if (falhas.length) Deno.exit(1);
