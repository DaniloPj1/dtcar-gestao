// Teste da função "cpf" (API CPF, apicpf.com) sem rede: uma API falsa responde como a documentação de apicpf.com/docs.
// Rodar: deno run -A teste/teste_cpf.ts
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, x = "") => (c ? ok : falhas).push(n + (x ? " (" + x + ")" : ""));
Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { executar, normalizar, nomeDe, nascimentoDe, cpfValido, erroDaApi, ErroUso, BASE, atender } = await import("../supabase/functions/cpf/index.ts");
// deno-lint-ignore no-explicit-any
type L = Record<string, any>;
const AGORA = new Date("2026-11-15T13:00:00Z");
// CPFs de teste (dígitos válidos, de exemplo)
const NOVO = "52998224725", FORA = "11144477735", SEMCRED = "39053344705", CADASTRADO = "15350946056", CAI = "86288366757", MINUTO = "71428793860", VAZIO = "98765432100";

// ---------- conversões
confere("CPF válido e inválido", cpfValido(NOVO) && cpfValido("529.982.247-25") && !cpfValido("52998224726") && !cpfValido("11111111111") && !cpfValido("123") && !cpfValido(""));
confere("nome sem espaço sobrando, como a API escreve", nomeDe("  João   da Silva ") === "João da Silva" && nomeDe(null) === "" && nomeDe("MARIA DE SOUZA") === "MARIA DE SOUZA");
confere("nascimento no formato do cadastro", nascimentoDe("1985-07-15", AGORA) === "1985-07-15" && nascimentoDe("15/07/1985", AGORA) === "1985-07-15" && nascimentoDe("1985-07-15T00:00:00", AGORA) === "1985-07-15");
confere("nascimento impossível, antigo demais ou no futuro fica em branco", nascimentoDe("1985-02-30", AGORA) === "" && nascimentoDe("1850-01-01", AGORA) === "" && nascimentoDe("2030-01-01", AGORA) === ""
  && nascimentoDe("", AGORA) === "" && nascimentoDe("abc", AGORA) === "" && nascimentoDe(null, AGORA) === "");
const n = normalizar({ code: 200, data: { cpf: NOVO, nome: "João da Silva", genero: "M", data_nascimento: "1985-07-15" } }, AGORA) as L;
confere("normalizar: só nome e nascimento (gênero não vai para o cadastro)", n.nome === "João da Silva" && n.nascimento === "1985-07-15" && Object.keys(n).length === 2, JSON.stringify(n));
confere("normalizar: resposta vazia não quebra", normalizar(null, AGORA).nome === "" && normalizar({ data: "x" }, AGORA).nome === "");
confere("erros da API em português", erroDaApi(404, null).encontrado === false && erroDaApi(402, null).sem_creditos === true && erroDaApi(402, null).encontrado === false
  && erroDaApi(401, null).desligada === true && /API_CPF_TOKEN/.test(erroDaApi(401, null).erro!) && erroDaApi(403, null).desligada === true && /venceu/.test(erroDaApi(403, null).erro!)
  && erroDaApi(429, { message: "Limite diário excedido" }).limite === true && /hoje/.test(erroDaApi(429, { message: "Limite diário excedido" }).erro!)
  && /minuto/.test(erroDaApi(429, { message: "Limite por minuto excedido. Diminua" }).erro!) && /várias vezes/.test(erroDaApi(429, { message: "Limite de consultas repetidas excedido" }).erro!)
  && /fora do ar/.test(erroDaApi(503, null).erro!) && /Confira os números/.test(erroDaApi(400, { message: "CPF inválido" }).erro!));

// ---------- API falsa + cadastro falso
const chamadas: { url: string; chave: string }[] = [];
const falso = (url: string | URL | Request, init: RequestInit = {}) => {
  const u = new URL(String(url)), h = (init.headers || {}) as Record<string, string>;
  chamadas.push({ url: String(url), chave: h["X-API-KEY"] || "" });
  const r = (s: number, j: unknown, cab: Record<string, string> = {}) => Promise.resolve(new Response(JSON.stringify(j), { status: s, headers: { "content-type": "application/json", ...cab } }));
  if (!String(url).startsWith(BASE + "/api/consulta")) return r(404, { code: 404 });
  if (h["X-API-KEY"] === "vencida") return r(403, { code: 403, message: "API key expirada" });
  if (h["X-API-KEY"] !== "chave-certa") return r(401, { code: 401, message: "API key inválida" });
  const cpf = u.searchParams.get("cpf");
  if (cpf === FORA) return r(404, { code: 404, message: "Pessoa não encontrada com o CPF informado" }, { "X-Credits-Remaining": "5" });
  if (cpf === SEMCRED) return r(402, { code: 402, message: "Sem créditos disponíveis para consulta externa." }, { "X-Credits-Remaining": "0" });
  if (cpf === CAI) return r(503, { code: 503 });
  if (cpf === MINUTO) return r(429, { code: 429, message: "Limite por minuto excedido. Diminua a frequência" });
  if (cpf === VAZIO) return r(200, { code: 200, data: { cpf, nome: "", genero: "I", data_nascimento: "" } });
  return r(200, { code: 200, data: { cpf, nome: "João da Silva", genero: "M", data_nascimento: "1985-07-15" } }, { "X-Credits-Remaining": "4" });
};
let cadastro: L[] = [{ id: "c9", codigo: 77, doc: CADASTRADO, nome: "Cliente Já Cadastrado", nascimento: "1990-01-02" }, { id: "c10", codigo: 78, doc: SEMCRED, nome: "", nascimento: null }];
const deps = (extra = {}) => ({ admin: true, token: "chave-certa" as string | undefined, fetch: falso as typeof fetch, agora: () => AGORA,
  cadastro: (cpf: string) => Promise.resolve(cadastro.find((c) => c.doc === cpf) || null), ...extra });

let r: L = await executar({ acao: "consultar", cpf: "529.982.247-25" }, deps());
confere("CPF novo: vai à API e devolve nome e nascimento", r.ok === true && r.encontrado === true && r.origem === "api" && r.cpf === NOVO && r.dados.nome === "João da Silva"
  && r.dados.nascimento === "1985-07-15" && r.creditos === 4 && !("genero" in r.dados), JSON.stringify(r));
confere("a chave vai no cabeçalho, nunca no endereço", chamadas.length === 1 && chamadas[0].chave === "chave-certa" && !/chave-certa|api_key/i.test(chamadas[0].url) && chamadas[0].url === BASE + "/api/consulta?cpf=" + NOVO, chamadas[0].url);
chamadas.length = 0;
r = await executar({ acao: "consultar", cpf: CADASTRADO }, deps());
confere("REGRA: CPF que já está no cadastro responde pelo cadastro, sem ir à API", r.ok === true && r.origem === "cadastro" && r.cliente_id === "c9" && r.codigo === 77 && r.dados.nome === "Cliente Já Cadastrado"
  && r.dados.nascimento === "1990-01-02" && chamadas.length === 0, JSON.stringify(r));
r = await executar({ acao: "consultar", cpf: FORA }, deps());
confere("CPF que a API não tem: não encontrado (sem erro)", r.ok === true && r.encontrado === false && !r.erro && r.creditos === 5, JSON.stringify(r));
r = await executar({ acao: "consultar", cpf: SEMCRED }, deps());
confere("cadastro sem nome não conta como cadastro; sem crédito: não encontrado, com o aviso", r.ok === true && r.encontrado === false && r.sem_creditos === true && /créditos/.test(r.erro) && r.creditos === 0, JSON.stringify(r));
r = await executar({ acao: "consultar", cpf: VAZIO }, deps());
confere("resposta 200 sem nome: não encontrado", r.ok === true && r.encontrado === false);
r = await executar({ acao: "consultar", cpf: CAI }, deps());
confere("API fora do ar: erro claro", r.ok === false && /fora do ar/.test(r.erro));
r = await executar({ acao: "consultar", cpf: MINUTO }, deps());
confere("limite por minuto: erro claro e marca de limite", r.ok === false && r.limite === true && /minuto/.test(r.erro));
r = await executar({ acao: "consultar", cpf: NOVO }, deps({ token: "errada" }));
confere("chave recusada: desligada, com o nome do segredo", r.ok === false && r.desligada === true && /API_CPF_TOKEN/.test(r.erro));
r = await executar({ acao: "consultar", cpf: NOVO }, deps({ token: "vencida" }));
confere("licença vencida: desligada, manda renovar no painel", r.ok === false && r.desligada === true && /Renove/.test(r.erro));
chamadas.length = 0;
r = await executar({ acao: "consultar", cpf: NOVO }, deps({ token: undefined }));
confere("sem a chave: desligada e não chama a API", r.ok === false && r.desligada === true && chamadas.length === 0);
r = await executar({ acao: "consultar", cpf: CADASTRADO }, deps({ token: undefined }));
confere("sem a chave, o cadastro ainda responde", r.ok === true && r.origem === "cadastro");
r = await executar({ acao: "consultar", cpf: NOVO }, deps({ fetch: (() => Promise.reject(new Error("abort"))) as unknown as typeof fetch }));
confere("API sem resposta: erro claro", r.ok === false && /não respondeu/.test(r.erro));
r = await executar({ acao: "situacao" }, deps());
confere("situação: ligada com a chave", r.ok === true && r.ligada === true);
r = await executar({ acao: "situacao" }, deps({ token: undefined }));
confere("situação: desligada sem a chave", r.ok === false && r.desligada === true);

const recusa = async (corpo: L, d: L) => { try { await executar(corpo, d as never); return ""; } catch (e) { return e instanceof ErroUso ? (e as Error).message : "outro: " + (e as Error).message; } };
chamadas.length = 0;
confere("SÓ ADMINISTRADOR: consultor e mecânico são recusados, sem chamar a API", /só para o administrador/.test(await recusa({ acao: "consultar", cpf: NOVO }, deps({ admin: false })))
  && /só para o administrador/.test(await recusa({ acao: "situacao" }, deps({ admin: false }))) && chamadas.length === 0);
confere("CPF inválido e CNPJ são recusados antes da API", /CPF inválido/.test(await recusa({ acao: "consultar", cpf: "52998224726" }, deps())) && /CPF inválido/.test(await recusa({ acao: "consultar", cpf: "27462217000331" }, deps()))
  && /CPF inválido/.test(await recusa({ acao: "consultar" }, deps())) && chamadas.length === 0);
confere("ação desconhecida", /desconhecida/.test(await recusa({ acao: "apagar" }, deps())));

// ---------- a porta da função: sem login não entra
const resp = await atender(new Request("https://x.supabase.co/functions/v1/cpf", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ acao: "consultar", cpf: NOVO }) }));
confere("sem login: recusado", resp.status === 401 || resp.status === 403, String(resp.status));

console.log(ok.length + " ok" + (falhas.length ? ", " + falhas.length + " FALHAS:\n  " + falhas.join("\n  ") : ""));
if (falhas.length) Deno.exit(1);
