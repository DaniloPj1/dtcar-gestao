// Teste da função "compras" (consulta ao vivo nos portais) sem rede: portais de mentira respondem como o mapeamento de 16/11/2026.
// Rodar: deno run -A teste/teste_compras_funcao.ts
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, x = "") => (c ? ok : falhas).push(n + (x ? " (" + x + ")" : ""));
Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const F = await import("../supabase/functions/compras/index.ts");
// deno-lint-ignore no-explicit-any
type L = Record<string, any>;

// ---------- regras puras
confere("robô só pelo endereço (nome do fornecedor não conta)", F.roboDe({ endereco: "https://www.dpk.com.br/#/" }) === "dpk" && F.roboDe({ endereco: "https://rolemarmaster.com" }) === "rolemar"
  && F.roboDe({ endereco: "https://compreonline.pellegrino.com.br/" }) === "pellegrino" && F.roboDe({ endereco: "https://portal.tolidistribuidora.com.br/ords/f?p=2401" }) === "toli"
  && F.roboDe({ endereco: "" }) === null && F.roboDe({ endereco: "https://outro.com.br" }) === null && F.roboDe({ endereco: "https://capitolio.com.br" }) === null);
confere("número em reais", F.numero("1.234,56") === 1234.56 && F.numero("63,24") === 63.24 && F.numero("88.81") === 88.81 && F.numero(12.5) === 12.5 && F.numero("") === 0 && F.numero("R$ 10,00") === 10 && F.numero("1.000") === 1000);
try { await F.executar({ acao: "testar", conexao: "abc def; drop" }, { papel: { gestor: true, admin: true } } as never); confere("testar com id inválido: recusa sem ir ao banco", false); } catch (e) { confere("testar com id inválido: recusa sem ir ao banco", e instanceof F.ErroUso); }
confere("cookies juntados", (() => { const r = new Response("", { headers: [["set-cookie", "PHPSESSID=abc; Path=/; HttpOnly"], ["set-cookie", "cf_clearance=xyz; Secure"]] });
  const c = F.juntarCookies({ velho: "1" }, r); return c.PHPSESSID === "abc" && c.cf_clearance === "xyz" && c.velho === "1"; })());
confere("DPK: leitura da busca", (() => { const l = F.dpkLerBusca({ totalCount: 2, products: [{ id: 1, code: "WK84213", description: "FILTRO COMBUSTIVEL", manufacturer: "MANN", sapCode: "83545" }, { id: 2, code: "", description: "x" }] });
  return l.length === 1 && l[0].id === "83545" && l[0].codigo === "WK84213" && l[0].marca === "MANN"; })());
confere("DPK: leitura dos preços", (() => { const m = F.dpkLerPrecos([{ id: 83545, status: "02 - Disponível", stock: 12, price: 63.24 }]); const p = m.get("83545"); return !!p && p.preco === 63.24 && p.estoque === 12; })());
confere("Rolemar: leitura da busca", (() => { const l = F.rolemarLerBusca({ data: [{ id: 9, fabricante: "WEGA", codigo_fabricante: "FCD2158/1", item: "FILTRO COMBUSTIVEL", estoque: "5", preco: "70,00", valor_final: "63,24", texto: "TORO 2.0 DIESEL" },
  { id: 10, fabricante: "X", codigo_fabricante: "", item: "sem código", preco: "1" }] }); return l.length === 1 && l[0].codigo === "FCD2158/1" && l[0].preco === 63.24 && l[0].estoque === 5 && l[0].aplicacao === "TORO 2.0 DIESEL"; })());
const HTML_PELL = `<table><tbody>
<tr data-objectid="A1" class="linha"><td><a class="font-weight-bold" href="#">FILTRO DE COMBUSTIVEL</a></td><td><span class="d-none">MANN</span> <img src="m.png"></td>
<td><span data-toggle="popover" data-original-title="WK84213">cód</span></td><td>R$ 88,81</td></tr>
<tr data-objectid="B2"><td><a class="font-weight-bold">FILTRO DE COMBUSTIVEL</a></td><td><span class="d-none">TECFIL</span> <img src="t.png"></td>
<td><span data-toggle="popover" data-original-title="PSC498">cód</span></td><td><button>Me avise quando estiver disponível</button></td></tr>
</tbody></table>`;
confere("Pellegrino: leitura da página", (() => { const l = F.pellegrinoLerPagina(HTML_PELL); return l.length === 2 && l[0].id === "A1" && l[0].codigo === "WK84213" && l[0].marca === "MANN" && !l[0].semEstoque && l[1].semEstoque && l[1].codigo === "PSC498"; })(),
  JSON.stringify(F.pellegrinoLerPagina(HTML_PELL)));
confere("Pellegrino: leitura dos preços", F.pellegrinoLerPrecos({ precos: [{ id: "A1", preco: 80, preco_com_imposto: 88.81 }] }).get("A1") === 88.81);

// ---------- portais de mentira
const chamadas: string[] = [];
let dpkLogins = 0, rolemarLogins = 0, pellLogins = 0, dpkTokenValido = "tok1", recusarSenha = false, bloquear403 = false;
const j = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
async function fakeFetch(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const u = String(url); chamadas.push(u);
  const h = new Headers(init.headers || {}), body = init.body;
  const texto = async () => typeof body === "string" ? body : body instanceof FormData ? Object.fromEntries([...body.entries()].map(([k, v]) => [k, String(v)])) : "";
  if (bloquear403) return new Response("blocked", { status: 403 });
  // DPK
  if (u === F.DPK.site + "/") return new Response('<html><script src="main.abc123.js"></script></html>');
  if (u === F.DPK.site + "/main.abc123.js") return new Response('var x={portal:"DPK",xApiKey:"CHAVEPUBLICA1234567890ABCDEFGHIJKLMN"};');
  if (u.startsWith(F.DPK.api)) {
    if (h.get("x-api-key") !== "CHAVEPUBLICA1234567890ABCDEFGHIJKLMN" || h.get("x-portal") !== "DPK") return j({ erro: "sem chave" }, 401);
    if (u.endsWith("/api-auth/api/connect/token")) { dpkLogins++; const b = JSON.parse(String(await texto())); if (b.password === "senha-dpk" && b.userPrincipalName === "danilo@dtcar.com" && !recusarSenha) return j({ accessToken: dpkTokenValido, refreshToken: "r", document: "49016409000195", documents: ["49016409000195"] }); return j({ error: "invalid_grant" }, 400); }
    if (h.get("authorization") !== "Bearer " + dpkTokenValido) return j({}, 401);
    if (u.includes("/productSearch?")) { const q = new URL(u).searchParams; return q.get("StoreCode") === "21" && q.get("Query") === "WK84213" ? j({ totalCount: 1, products: [{ id: 1, code: "WK84213", description: "FILTRO COMBUSTIVEL", manufacturer: "MANN", sapCode: "83545" }] }) : j({ totalCount: 0, products: [] }); }
    if (u.includes("/dpk-price/api/price/dpk?")) return j([{ id: 83545, status: "02 - Disponível", stock: 12, price: 63.24, unitePrice: 63.24 }]);
  }
  // Rolemar
  if (u === F.ROLEMAR.site + "/login") return new Response("<html>", { headers: { "set-cookie": "PHPSESSID=s1; Path=/" } });
  if (u === F.ROLEMAR.site + "/ajax-login") { rolemarLogins++; const f = await texto() as L; if (h.get("x-requested-with") !== "XMLHttpRequest") return j({ status: "erro" }, 400);
    return f.usuario === "49016409000195" && f.senha === "senha-rol" && !recusarSenha ? j({ data: { idusuario_lojista: 7, nome: "DTCAR", cod_erp: "66333" } }, 200, { "set-cookie": "logado=1; Path=/" }) : j({ status: "erro", mensagem: "Usuário ou senha inválidos" }); }
  if (u === F.ROLEMAR.site + "/ajax-lista-filiais") return h.get("cookie")?.includes("logado=1") ? j({ cod_emp: "16", filiais: [{ CODPARC: "66333", CODEMP: "16", EMPRESA: "ROLEMAR-CARIACICA" }] }) : j({ status: "erro", mensagem: "Faça login" });
  if (u === F.ROLEMAR.site + "/ajax-busca") { if (!h.get("cookie")?.includes("logado=1")) return j({ status: "erro", mensagem: "Sessão expirada, faça login" }); const f = await texto() as L;
    return f.cod_emp === "16" && f.busca === "WK84213" ? j({ data: [{ id: 9, fabricante: "WEGA", codigo_fabricante: "FCD2158/1", item: "FILTRO COMBUSTIVEL", estoque: "5", preco: "70,00", valor_final: "63,24", multiplo: 1, texto: "TORO 2.0" }], ultima_pagina: 1 }) : j({ data: [] }); }
  // Pellegrino
  if (u.startsWith(F.PELLEGRINO.site + "/Account/Login")) return new Response("<html>", { headers: { "set-cookie": "ASP.NET_SessionId=p1; Path=/" } });
  if (u === F.PELLEGRINO.site + "/account/login") { pellLogins++; const b = JSON.parse(String(await texto())); return b.Email === "danilo@dtcar.com" && b.Password === "senha-pel" && !recusarSenha ? j({ result: { success: true, ativo: true } }, 200, { "set-cookie": ".AspNet.Cookies=auth1; Path=/" }) : j({ result: { success: false, message: "Usuário ou senha inválidos" } }); }
  if (u.startsWith(F.PELLEGRINO.site + "/catalogo/ais?")) { if (!h.get("cookie")?.includes("auth1")) return new Response("", { status: 302, headers: { location: "/Account/Login" } }); return new Response(new URL(u).searchParams.get("q") === "WK84213" ? HTML_PELL : "<table></table>"); }
  if (u.startsWith(F.PELLEGRINO.site + "/api/progress/b2b/produtos/precos?")) return j({ precos: [{ id: "A1", preco: 80, preco_com_imposto: 88.81 }, { id: "B2", preco: 50, preco_com_imposto: 55 }] });
  return new Response("not found", { status: 404 });
}

// ---------- banco de mentira
const conexoes: L[] = [
  { id: "c-dpk", fornecedor_id: "f-dpk", tipo: "portal", endereco: "https://www.dpk.com.br/#/", usuario: "danilo@dtcar.com", ativo: true, situacao: "", detalhe: "" },
  { id: "c-rol", fornecedor_id: "f-rol", tipo: "portal", endereco: "https://rolemarmaster.com/", usuario: "49.016.409/0001-95", ativo: true, situacao: "", detalhe: "" },
  { id: "c-pel", fornecedor_id: "f-pel", tipo: "portal", endereco: "https://compreonline.pellegrino.com.br/", usuario: "danilo@dtcar.com", ativo: true, situacao: "", detalhe: "" },
  { id: "c-toli", fornecedor_id: "f-toli", tipo: "portal", endereco: "https://portal.tolidistribuidora.com.br/", usuario: "danilo@dtcar.com", ativo: true, situacao: "", detalhe: "" },
  { id: "c-x", fornecedor_id: "f-x", tipo: "portal", endereco: "https://outro.com.br", usuario: "a", ativo: true, situacao: "", detalhe: "" },
  { id: "c-off", fornecedor_id: "f-off", tipo: "portal", endereco: "https://www.dpk.com.br", usuario: "a", ativo: false, situacao: "", detalhe: "" },
];
const senhas: Record<string, string | null> = { "c-dpk": "senha-dpk", "c-rol": "senha-rol", "c-pel": "senha-pel", "c-toli": "x", "c-x": "x" };
const sessoes: Record<string, L | null> = {}; const situacoes: Record<string, [string, string]> = {}; const gravados: Record<string, L[]> = {};
let limpezas: string[][] = [];
const deps = (papel = { gestor: true, admin: true }): L => ({
  papel, limparSessoes: async (v: string[]) => { limpezas.push(v); }, fetch: fakeFetch as typeof fetch, agora: () => new Date("2026-11-16T15:00:00Z"),
  conexoes: async (ids: string[] | null) => conexoes.filter((c) => !ids || ids.includes(c.id)),
  senha: async (id: string) => senhas[id] ?? null,
  lerSessao: async (id: string) => sessoes[id] || null,
  gravarSessao: async (id: string, s: L | null) => { sessoes[id] = s; },
  situacao: async (id: string, s: string, d: string) => { situacoes[id] = [s, d]; },
  gravarPrecos: async (f: string, ofertas: L[]) => { gravados[f] = ofertas; return ofertas.length; },
});

// ---------- consulta com os três portais
let r = await F.executar({ acao: "consultar", termos: ["WK84213"] }, deps(), "49.016.409/0001-95") as L;
const porConexao = (id: string) => r.resultados.find((x: L) => x.conexao === id);
confere("consulta: resposta geral", r.ok === true && r.termos[0] === "WK84213" && r.resultados.length === 5, JSON.stringify(r).slice(0, 300));
confere("DPK: logou, buscou e precificou", porConexao("c-dpk").ok && porConexao("c-dpk").ofertas[0].codigo === "WK84213" && porConexao("c-dpk").ofertas[0].preco === 63.24 && porConexao("c-dpk").ofertas[0].estoque === 12 && dpkLogins === 1,
  JSON.stringify(porConexao("c-dpk")));
confere("DPK: chave pública lida do site e guardada na sessão", sessoes["c-dpk"]?.apiKey === "CHAVEPUBLICA1234567890ABCDEFGHIJKLMN" && sessoes["c-dpk"]?.token === "tok1");
confere("Rolemar: logou com o CNPJ só em números, achou a filial e buscou", porConexao("c-rol").ok && porConexao("c-rol").ofertas[0].codigo === "FCD2158/1" && porConexao("c-rol").ofertas[0].preco === 63.24 && sessoes["c-rol"]?.cod_emp === "16" && rolemarLogins === 1,
  JSON.stringify(porConexao("c-rol")));
confere("Pellegrino: logou, leu a página e os preços; sem estoque = 0", porConexao("c-pel").ok && porConexao("c-pel").ofertas.length === 2 && porConexao("c-pel").ofertas[0].preco === 88.81 && porConexao("c-pel").ofertas[0].estoque === null
  && porConexao("c-pel").ofertas[1].estoque === 0 && pellLogins === 1, JSON.stringify(porConexao("c-pel")));
confere("Toli: fica para o programa do PC", porConexao("c-toli").ok === false && porConexao("c-toli").no_pc === true);
confere("portal desconhecido: erro claro", porConexao("c-x").ok === false && /não reconhecido/.test(porConexao("c-x").erro));
confere("conexão desligada não é consultada", !porConexao("c-off"));
confere("preços gravados por fornecedor", gravados["f-dpk"]?.length === 1 && gravados["f-rol"]?.length === 1 && gravados["f-pel"]?.length === 2);
confere("situação ok com a hora de Brasília", situacoes["c-dpk"][0] === "ok" && /16\/11\/2026 12:00/.test(situacoes["c-dpk"][1]) && situacoes["c-rol"][0] === "ok" && situacoes["c-pel"][0] === "ok");
confere("nenhuma senha na resposta", !JSON.stringify(r).includes("senha-"));

// ---------- 2ª consulta reaproveita a sessão (sem novo login)
chamadas.length = 0;
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-dpk", "c-rol", "c-pel"] }, deps()) as L;
confere("sessão reaproveitada: nenhum login novo", dpkLogins === 1 && rolemarLogins === 1 && pellLogins === 1 && r.resultados.every((x: L) => x.ok));
confere("só as conexões pedidas", r.resultados.length === 3);
confere("limpeza das sessões órfãs recebe as conexões vivas", limpezas.length >= 2 && limpezas[0].includes("c-off") && limpezas[0].length === 6);

// ---------- sessão vencida: entra de novo uma vez
dpkTokenValido = "tok2";
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-dpk"] }, deps()) as L;
confere("DPK: token vencido → novo login e a busca sai", dpkLogins === 2 && r.resultados[0].ok && sessoes["c-dpk"]?.token === "tok2", JSON.stringify(r.resultados[0]));
sessoes["c-rol"] = { cookies: { PHPSESSID: "velho" }, cod_emp: "16" };
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-rol"] }, deps()) as L;
confere("Rolemar: sessão vencida → novo login", rolemarLogins === 2 && r.resultados[0].ok);
sessoes["c-pel"] = { cookies: { "ASP.NET_SessionId": "velho" } };
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-pel"] }, deps()) as L;
confere("Pellegrino: redirecionado ao login → novo login", pellLogins === 2 && r.resultados[0].ok);

// ---------- senha errada: conexão em erro, sessão apagada, sem laço
recusarSenha = true; sessoes["c-dpk"] = null; sessoes["c-rol"] = null; sessoes["c-pel"] = null;
const antes = [dpkLogins, rolemarLogins, pellLogins];
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-dpk", "c-rol", "c-pel"] }, deps()) as L;
confere("senha recusada: erro com orientação, uma tentativa só", r.resultados.every((x: L) => !x.ok && /Ajustes/.test(x.erro)) && dpkLogins === antes[0] + 1 && rolemarLogins === antes[1] + 1 && pellLogins === antes[2] + 1,
  r.resultados.map((x: L) => x.erro).join(" | "));
confere("senha recusada: situação erro", situacoes["c-dpk"][0] === "erro" && situacoes["c-rol"][0] === "erro" && situacoes["c-pel"][0] === "erro");
recusarSenha = false;

// ---------- bloqueio do site (403)
bloquear403 = true;
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-rol"] }, deps()) as L;
confere("portal bloqueou (403): aviso para tentar depois", !r.resultados[0].ok && /mais tarde|bloqueou|HTTP|esperado/.test(r.resultados[0].erro), r.resultados[0].erro);
bloquear403 = false;

// ---------- Rolemar: busca devolve página (HTML) em vez de JSON → erro claro, UM login só, sem apagar a sessão
let rolemarHtml = false;
const fetchHtml = (async (u: string | URL | Request, i?: RequestInit) => { if (rolemarHtml && String(u) === F.ROLEMAR.site + "/ajax-busca") return new Response("<html>manutenção</html>", { status: 200 }); return fakeFetch(u, i); }) as typeof fetch;
sessoes["c-rol"] = null; rolemarHtml = true; const rl = rolemarLogins;
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-rol"] }, { ...deps(), fetch: fetchHtml }) as L;
confere("Rolemar fora do padrão: erro claro e só um login (sem laço)", !r.resultados[0].ok && /fora do padrão|recusada logo em seguida/.test(r.resultados[0].erro) && rolemarLogins === rl + 1 && sessoes["c-rol"] !== null, r.resultados[0].erro + " logins=" + (rolemarLogins - rl));
rolemarHtml = false;
// DPK: preço responde 401 → sessão vencida → relogin
dpkTokenValido = "tok3"; sessoes["c-dpk"] = { apiKey: "CHAVEPUBLICA1234567890ABCDEFGHIJKLMN", token: "tok2" };
const fetch401 = (async (u: string | URL | Request, i?: RequestInit) => { const h = new Headers(i && i.headers || {}); if (String(u).includes("/dpk-price/") && h.get("authorization") !== "Bearer tok3") return j({}, 401); return fakeFetch(u, i); }) as typeof fetch;
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-dpk"] }, { ...deps(), fetch: fetch401 }) as L;
confere("DPK: 401 no preço → novo login e preços saem", r.resultados[0].ok && r.resultados[0].ofertas.length === 1 && sessoes["c-dpk"]?.token === "tok3", JSON.stringify(r.resultados[0]));

// ---------- sem senha guardada
senhas["c-dpk"] = null; sessoes["c-dpk"] = null;
r = await F.executar({ termos: ["WK84213"], conexoes: ["c-dpk"] }, deps()) as L;
confere("sem senha guardada: manda cadastrar em Ajustes", !r.resultados[0].ok && /Sem senha/.test(r.resultados[0].erro));
senhas["c-dpk"] = "senha-dpk";

// ---------- limites e permissões
r = await F.executar({ termos: ["a", "b", "c", "d", "e", "f", "g", "h", "WK84213"], conexoes: ["c-rol"] }, deps()) as L;
confere("no máximo " + F.MAX_TERMOS + " códigos por consulta, descartando os curtos", r.termos.length === 1 && r.termos[0] === "WK84213");
r = await F.executar({ termos: ["WK84213", "WK84213", "wk84213 "] , conexoes: ["c-rol"] }, deps()) as L;
confere("termos repetidos contam uma vez", r.termos.length === 2);
try { await F.executar({ termos: [] }, deps()); confere("sem termo: recusa", false); } catch (e) { confere("sem termo: recusa", e instanceof F.ErroUso); }
try { await F.executar({ termos: ["WK84213"] }, deps({ gestor: false, admin: false })); confere("mecânico não consulta", false); } catch (e) { confere("mecânico não consulta", e instanceof F.ErroUso); }
try { await F.executar({ acao: "testar", conexao: "c-dpk" }, deps({ gestor: true, admin: false })); confere("consultor não testa conexão", false); } catch (e) { confere("consultor não testa conexão", e instanceof F.ErroUso); }

// ---------- testar conexão (Ajustes)
sessoes["c-dpk"] = { apiKey: "x", token: "lixo" }; const l0 = dpkLogins;
r = await F.executar({ acao: "testar", conexao: "c-dpk" }, deps(), "49016409000195") as L;
confere("testar: login novo de verdade e busca de teste", r.ok && r.robo === "dpk" && dpkLogins === l0 + 1 && r.ofertas.length === 1 && situacoes["c-dpk"][0] === "ok" && /teste/.test(situacoes["c-dpk"][1]), JSON.stringify(r));
const g0 = JSON.stringify(gravados);
r = await F.executar({ acao: "testar", conexao: "c-rol" }, deps()) as L;
confere("testar não grava preço", r.ok && JSON.stringify(gravados) === g0);
r = await F.executar({ acao: "testar", conexao: "c-toli" }, deps()) as L;
confere("testar Toli: avisa que é pelo PC", r.ok && r.no_pc === true && situacoes["c-toli"][0] === "aguardando");
r = await F.executar({ acao: "testar", conexao: "c-x" }, deps()) as L;
confere("testar portal desconhecido", r.ok === false && situacoes["c-x"][0] === "erro");

// ---------- gravação no banco (depsDoBanco) com um Supabase de mentira
{
  const ops: L[] = [];
  const tabela = (nome: string) => { const q: L = { _t: nome, _f: {} };
    const enc = (op: string) => (v: unknown, extra?: unknown) => { q._op = op; q._v = v; q._extra = extra; return q; };
    q.select = (c: string) => { q._sel = c; return q; }; q.like = (k: string, v: unknown) => { q._f[k] = v; return q; }; q.eq = (k: string, v: unknown) => { q._f[k] = v; return q; }; q.in = (k: string, v: unknown) => { q._f[k] = v; return q; };
    q.maybeSingle = async () => { ops.push(q); if (nome === "segredos" && q._f.chave === "compras_acesso:c1") return { data: { valor: "s3nh4" } }; if (nome === "segredos" && q._f.chave === "compras_sessao:c1") return { data: { valor: JSON.stringify({ token: "t" }) } }; return { data: null }; };
    q.upsert = enc("upsert"); q.update = enc("update"); q.delete = enc("delete"); q.insert = enc("insert");
    q.then = (res: (v: unknown) => void) => { ops.push(q); res(nome === "compras_fornecedores" && !q._op ? { data: [{ id: "c1", fornecedor_id: "f1", endereco: "https://www.dpk.com.br", usuario: "u", ativo: true }] }
      : nome === "segredos" && q._f.chave === "compras_sessao:%" ? { data: [{ chave: "compras_sessao:c1" }, { chave: "compras_sessao:morta" }] } : { data: null, error: null }); };
    return q; };
  const adm = { from: tabela };
  const d = F.depsDoBanco(adm, adm);
  const cs = await d.conexoes(null);
  confere("banco: lê as conexões com a chave de servidor", cs.length === 1 && cs[0].id === "c1");
  confere("banco: senha vem de segredos compras_acesso:<id>", (await d.senha("c1")) === "s3nh4");
  confere("banco: sessão vem de segredos compras_sessao:<id>", (await d.lerSessao("c1"))?.token === "t");
  await d.gravarSessao("c1", { token: "novo" });
  const up = ops.find((o) => o._t === "segredos" && o._op === "upsert");
  confere("banco: sessão gravada em segredos (nunca em compras_fornecedores)", !!up && up._v.chave === "compras_sessao:c1" && /novo/.test(up._v.valor));
  await d.gravarSessao("c1", null);
  confere("banco: sessão apagada", ops.some((o) => o._t === "segredos" && o._op === "delete" && o._f.chave === "compras_sessao:c1"));
  const n = await d.gravarPrecos("f1", [{ codigo: "wk 84213", marca: "mann", descricao: "filtro", preco: 63.239, estoque: 12, prazo: "", aplicacao: "" }, { codigo: "WK84213", marca: "x", descricao: "repetida", preco: 1, estoque: 0, prazo: "", aplicacao: "" }], "2026-11-16T15:00:00Z");
  const gp = ops.find((o) => o._t === "compras_precos" && o._op === "upsert");
  confere("banco: preços em compras_precos com origem ao_vivo, código normalizado e sem repetição", n === 1 && gp._v.length === 1 && gp._v[0].origem === "ao_vivo" && gp._v[0].codigo_norm === "WK84213" && gp._v[0].preco === 63.24 && gp._v[0].marca === "MANN"
    && gp._extra.onConflict === "fornecedor_id,codigo_norm" && gp._v[0].consultado_em === "2026-11-16T15:00:00Z", JSON.stringify(gp._v));
  await d.limparSessoes!(["c1"]);
  const lim = ops.find((o) => o._t === "segredos" && o._op === "delete" && Array.isArray(o._f.chave));
  confere("banco: sessão de conexão apagada é removida de segredos", !!lim && lim._f.chave.length === 1 && lim._f.chave[0] === "compras_sessao:morta");
  await d.situacao("c1", "erro", "x".repeat(400));
  const st = ops.find((o) => o._t === "compras_fornecedores" && o._op === "update");
  confere("banco: situação e detalhe (cortado em 300)", st._v.situacao === "erro" && st._v.detalhe.length === 300 && st._f.id === "c1");
}

// ---------- o código-fonte não tem senha nem chave
const fonte = await Deno.readTextFile(new URL("../supabase/functions/compras/index.ts", import.meta.url));
confere("sem segredo no código", !/senha-|password":\s*"[^"{]|sb_secret|eyJ[A-Za-z0-9_-]{30,}/.test(fonte) && !/[A-Za-z0-9]{40}/.test(fonte.replace(/CHAVEPUBLICA/g, "")));

console.log(ok.length + " ok"); for (const f of falhas) console.log("FALHA: " + f);
if (falhas.length) Deno.exit(1);
