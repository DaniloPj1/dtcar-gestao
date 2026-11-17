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
  && F.roboDe({ endereco: "https://compreonline.sama.com.br/" }) === "pellegrino" && F.siteCompreOnline({ endereco: "https://compreonline.sama.com.br/x" }) === "https://compreonline.sama.com.br"
  && F.roboDe({ endereco: "" }) === null && F.roboDe({ endereco: "https://outro.com.br" }) === null && F.roboDe({ endereco: "https://capitolio.com.br" }) === null);
confere("foto relativa completada com o site do portal; só https; nada de data:/javascript:", F.fotoDoSite("/img/a.jpg", "https://rolemarmaster.com") === "https://rolemarmaster.com/img/a.jpg"
  && F.fotoDoSite("img/b.png", "https://compreonline.pellegrino.com.br") === "https://compreonline.pellegrino.com.br/img/b.png" && F.fotoDoSite("//cdn.x.com/c.webp", "https://a.com") === "https://cdn.x.com/c.webp"
  && F.fotoDoSite("http://x.com/d.jpg", "https://a.com") === "https://x.com/d.jpg" && F.fotoDoSite("data:image/png;base64,AA", "https://a.com") === "" && F.fotoDoSite("javascript:alert(1)", "https://a.com") === "" && F.fotoDoSite("", "https://a.com") === "");
confere("número em reais", F.numero("1.234,56") === 1234.56 && F.numero("63,24") === 63.24 && F.numero("88.81") === 88.81 && F.numero(12.5) === 12.5 && F.numero("") === 0 && F.numero("R$ 10,00") === 10 && F.numero("1.000") === 1000);
try { await F.executar({ acao: "testar", conexao: "abc def; drop" }, { papel: { gestor: true, admin: true } } as never); confere("testar com id inválido: recusa sem ir ao banco", false); } catch (e) { confere("testar com id inválido: recusa sem ir ao banco", e instanceof F.ErroUso); }
confere("cookies juntados", (() => { const r = new Response("", { headers: [["set-cookie", "PHPSESSID=abc; Path=/; HttpOnly"], ["set-cookie", "cf_clearance=xyz; Secure"]] });
  const c = F.juntarCookies({ velho: "1" }, r); return c.PHPSESSID === "abc" && c.cf_clearance === "xyz" && c.velho === "1"; })());
confere("DPK: leitura da busca", (() => { const l = F.dpkLerBusca({ totalCount: 2, products: [{ id: 1, code: "WK84213", description: "FILTRO COMBUSTIVEL", manufacturer: "MANN", sapCode: "83545" }, { id: 2, code: "", description: "x" }] });
  return l.length === 1 && l[0].id === "83545" && l[0].codigo === "WK84213" && l[0].marca === "MANN"; })());
confere("DPK: leitura dos preços", (() => { const m = F.dpkLerPrecos([{ id: 83545, status: "02 - Disponível", stock: 12, price: 63.24 }]); const p = m.get("83545"); return !!p && p.preco === 63.24 && p.estoque === 12; })());
confere("Rolemar: leitura da busca", (() => { const l = F.rolemarLerBusca({ data: [{ id: 9, fabricante: "WEGA", codigo_fabricante: "FCD2158/1", item: "FILTRO COMBUSTIVEL", estoque: "5", preco: "70,00", valor_final: "63,24", texto: "TORO 2.0 DIESEL", imagens: [{ url: "/storage/produtos/fcd2158.jpg" }] },
  { id: 10, fabricante: "X", codigo_fabricante: "", item: "sem código", preco: "1" }] }); return l.length === 1 && l[0].codigo === "FCD2158/1" && l[0].preco === 63.24 && l[0].estoque === 5 && l[0].aplicacao === "TORO 2.0 DIESEL" && l[0].foto === "https://rolemarmaster.com/storage/produtos/fcd2158.jpg"; })());
const HTML_PELL = `<table><tbody>
<tr data-objectid="A1" class="linha"><td><img src="/fotos/produtos/wk84213.jpg"><a class="font-weight-bold" href="#">FILTRO DE COMBUSTIVEL</a></td><td><span class="d-none">MANN</span> <img src="m.png"></td>
<td><span data-toggle="popover" data-original-title="WK84213">cód</span></td><td>R$ 88,81</td></tr>
<tr data-objectid="B2"><td><a class="font-weight-bold">FILTRO DE COMBUSTIVEL</a></td><td><span class="d-none">TECFIL</span> <img src="t.png"></td>
<td><span data-toggle="popover" data-original-title="PSC498">cód</span></td><td><button>Me avise quando estiver disponível</button></td></tr>
</tbody></table>`;
confere("Pellegrino: leitura da página; foto é a da peça, nunca o logotipo do fabricante", (() => { const l = F.pellegrinoLerPagina(HTML_PELL); return l.length === 2 && l[0].id === "A1" && l[0].codigo === "WK84213" && l[0].marca === "MANN" && !l[0].semEstoque && l[1].semEstoque && l[1].codigo === "PSC498"
  && l[0].foto === "/fotos/produtos/wk84213.jpg" && l[1].foto === ""; })(),
  JSON.stringify(F.pellegrinoLerPagina(HTML_PELL)));
confere("Pellegrino: leitura dos preços", F.pellegrinoLerPrecos({ precos: [{ id: "A1", preco: 80, preco_com_imposto: 88.81 }] }).get("A1") === 88.81);

// ---------- portais de mentira
const chamadas: string[] = [];
let dpkLogins = 0, rolemarLogins = 0, pellLogins = 0, dpkTokenValido = "tok1", recusarSenha = false, bloquear403 = false;
let dpkCart: L | null = null; const dpkPosts: L[] = []; const dpkFiltros: string[] = []; const dpkBuscas: string[] = [];
const j = (b: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json", ...headers } });
async function fakeFetch(url: string | URL | Request, init: RequestInit = {}): Promise<Response> {
  const u = String(url); chamadas.push(u);
  const h = new Headers(init.headers || {}), body = init.body;
  const texto = async () => typeof body === "string" ? body : body instanceof FormData ? Object.fromEntries([...body.entries()].map(([k, v]) => [k, String(v)])) : "";
  if (bloquear403) return new Response("blocked", { status: 403 });
  // DPK
  if (u.startsWith(F.DPK.api + "/api-external/api/superk/filter?")) { const q = new URL(u).searchParams; dpkFiltros.push(u);
    if (q.get("Type") === "2") return j([{ id: 1, description: "AGRALE" }, { id: 19, description: "FIAT" }, { id: 7, description: "CHEVROLET" }]);
    if (q.get("Type") === "3" && q.get("ManufacturerId") === "19") return j([{ id: 2419, description: "TORINO" }, { id: 2420, description: "TORO" }, { id: 500, description: "UNO" }]);
    if (q.get("Type") === "3" && q.get("ManufacturerId") === "7") return j([{ id: 900, description: "ONIX" }, { id: 901, description: "ONIX PLUS" }]);
    if (q.get("Type") === "5" && q.get("VehicleId") === "2420") return j([{ id: 2603, description: "1.3 16V T270 TURBO L4 FLEX" }, { id: 170, description: "1.8 16V E-TORQ FLEX" }, { id: 1006, description: "2.0 16V MULTIJET II TURBO DIESEL" }, { id: 1679, description: "2.4 16V TIGERSHARK FLEX" }]);
    return j([]); }
  if (u.startsWith(F.DPK.api + "/api-product/api/productSearch/plate?")) { const h2 = new Headers(init.headers || {}); if (h2.get("authorization") !== "Bearer " + dpkTokenValido) return j({}, 401); return new URL(u).searchParams.get("plate") === "QXN1E49" ? j("FIAT TORO 2.0 TURBO DIESEL RANCH 2020") : j(""); }
  if (u === F.DPK.api + "/dpk-order/api/cart/getByFilter") return j(dpkCart ? [dpkCart] : []);
  if (u === F.DPK.api + "/dpk-order/api/cart" && init.method === "POST") { const b = JSON.parse(String(await texto())); dpkPosts.push(b); dpkCart = { id: "cart-1", retailerId: b.retailerId, hubId: b.hubId, closed: false, cartItems: b.cartItems.map((i: L, n: number) => ({ id: "it" + n, ...i })) }; return j(dpkCart); }
  if (u === F.DPK.site + "/") return new Response('<html><script src="main.abc123.js"></script></html>');
  if (u === F.DPK.site + "/main.abc123.js") return new Response('var x={portal:"DPK",xApiKey:"CHAVEPUBLICA1234567890ABCDEFGHIJKLMN"};');
  if (u.startsWith(F.DPK.api)) {
    if (h.get("x-api-key") !== "CHAVEPUBLICA1234567890ABCDEFGHIJKLMN" || h.get("x-portal") !== "DPK") return j({ erro: "sem chave" }, 401);
    if (u.endsWith("/api-auth/api/connect/token")) { dpkLogins++; const b = JSON.parse(String(await texto())); if (b.password === "senha-dpk" && b.userPrincipalName === "danilo@dtcar.com" && !recusarSenha) return j({ accessToken: dpkTokenValido, refreshToken: "r", document: "49016409000195", documents: ["49016409000195"] }); return j({ error: "invalid_grant" }, 400); }
    if (h.get("authorization") !== "Bearer " + dpkTokenValido) return j({}, 401);
    if (u.includes("/productSearch?") && new URL(u).searchParams.get("Query") === "pastilha") { dpkBuscas.push(u); const q = new URL(u).searchParams;
      return q.get("VehicleId") === "2420" ? j({ totalCount: 1, products: [{ id: 77, code: "PD1512", description: "PASTILHA FREIO TORO", manufacturer: "FRAS-LE", sapCode: "5512" }] })
        : j({ totalCount: 2, products: [{ id: 77, code: "PD1512", description: "PASTILHA FREIO TORO", manufacturer: "FRAS-LE", sapCode: "5512" }, { id: 78, code: "PD999", description: "PASTILHA FREIO UNO", manufacturer: "COBREQ", sapCode: "5513" }] }); }
    if (u.includes("/productSearch?")) { dpkBuscas.push(u); const q = new URL(u).searchParams; return q.get("StoreCode") === "21" && q.get("Query") === "WK84213" ? j({ totalCount: 1, products: [{ id: 2905056, code: "WK84213", description: "FILTRO COMBUSTIVEL", manufacturer: "MANN", sapCode: "83545", image: "MANN_WK84213.jpg", minimumQuantity: 0 }] }) : j({ totalCount: 0, products: [] }); }
    if (u.includes("/dpk-price/api/price/dpk?")) return j([{ id: 83545, status: "02 - Disponível", stock: 12, price: 63.24, unitePrice: 63.24 }, { id: 5512, status: "02 - Disponível", stock: 4, price: 210.5 }, { id: 5513, status: "02 - Disponível", stock: 9, price: 99.9 }]);
  }
  // Rolemar
  if (u === F.ROLEMAR.site + "/login") return new Response("<html>", { headers: { "set-cookie": "PHPSESSID=s1; Path=/" } });
  if (u === F.ROLEMAR.site + "/ajax-login") { rolemarLogins++; const f = await texto() as L; if (h.get("x-requested-with") !== "XMLHttpRequest") return j({ status: "erro" }, 400);
    return f.usuario === "49016409000195" && f.senha === "senha-rol" && !recusarSenha ? j({ data: { idusuario_lojista: 7, nome: "DTCAR", cod_erp: "66333" } }, 200, { "set-cookie": "logado=1; Path=/" }) : j({ status: "erro", mensagem: "Usuário ou senha inválidos" }); }
  if (u === F.ROLEMAR.site + "/ajax-lista-filiais") return h.get("cookie")?.includes("logado=1") ? j({ cod_emp: "16", filiais: [{ CODPARC: "66333", CODEMP: "16", EMPRESA: "ROLEMAR-CARIACICA" }] }) : j({ status: "erro", mensagem: "Faça login" });
  if (u === F.ROLEMAR.site + "/ajax-busca-placa") { if (!h.get("cookie")?.includes("logado=1")) return j({ status: "erro", mensagem: "Sessão expirada, faça login" }); const f = await texto() as L; return f.placa === "QXN1E49" ? j({ data: { brand: "FIAT", model: "TORO", madeYear: "2020", engine: "2.0" } }) : j({ data: null }); }
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
confere("DPK: foto pelo CDN e códigos internos para o carrinho do portal", porConexao("c-dpk").ofertas[0].foto === "https://cdn-superk.azureedge.net/img/MANN_WK84213.jpg" && porConexao("c-dpk").ofertas[0].extra.productId === 2905056 && porConexao("c-dpk").ofertas[0].extra.sapCode === "83545", JSON.stringify(porConexao("c-dpk").ofertas[0]));
// carrinho do portal (DPK)
let rc: L;
rc = await F.executar({ acao: "carrinho_portal", conexao: "c-dpk", item: { codigo: "WK84213", descricao: "FILTRO COMBUSTIVEL", marca: "MANN", qtd: 2, preco: 63.24, extra: { productId: 2905056, sapCode: "83545" } } }, deps(), "49016409000195") as L;
confere("carrinho do portal DPK: cria o carrinho com o item", rc.ok === true && dpkPosts.length === 1 && dpkPosts[0].hubId === 21 && dpkPosts[0].retailerId === 2 && dpkPosts[0].cartItems[0].productId === 2905056 && dpkPosts[0].cartItems[0].productRetailerId === 83545 && dpkPosts[0].cartItems[0].quantity === 2 && /No carrinho da DPK: 2 x WK84213/.test(rc.detalhe), JSON.stringify(rc));
rc = await F.executar({ acao: "carrinho_portal", conexao: "c-dpk", item: { codigo: "WK84213", descricao: "FILTRO COMBUSTIVEL", marca: "MANN", qtd: 1, preco: 63.24, extra: { productId: 2905056, sapCode: "83545" } } }, deps(), "49016409000195") as L;
confere("carrinho do portal DPK: item repetido soma a quantidade no carrinho que já existe", rc.ok === true && dpkPosts.length === 2 && dpkPosts[1].id === "cart-1" && dpkPosts[1].cartItems.length === 1 && dpkPosts[1].cartItems[0].quantity === 3 && /somada/.test(rc.detalhe), JSON.stringify(dpkPosts[1]));
rc = await F.executar({ acao: "carrinho_portal", conexao: "c-dpk", item: { codigo: "X1", descricao: "x", marca: "m", qtd: 1, preco: 1 } }, deps()) as L;
confere("carrinho do portal DPK: sem código interno, recusa com orientação", rc.ok === false && /consulte de novo/.test(rc.erro));
{ // leitura do carrinho falhou (500) ou veio fora do padrão: NÃO grava (o POST substituiria o carrinho inteiro)
  const antes = dpkPosts.length;
  for (const ruim of [new Response("erro", { status: 500 }), j({ cartItems: "x" }), j([{ id: "c", cartItems: "x" }])]) {
    const f = (async (u: string | URL | Request, i?: RequestInit) => String(u) === F.DPK.api + "/dpk-order/api/cart/getByFilter" ? ruim.clone() : fakeFetch(u, i)) as typeof fetch;
    const x = await F.executar({ acao: "carrinho_portal", conexao: "c-dpk", item: { codigo: "WK84213", descricao: "F", marca: "MANN", qtd: 1, preco: 1, extra: { productId: 2905056, sapCode: "83545" } } }, { ...deps(), fetch: f }) as L;
    confere("carrinho do portal DPK: leitura do carrinho falhou/fora do padrão → não grava nada", x.ok === false && /nada foi gravado/.test(x.erro) && dpkPosts.length === antes, JSON.stringify(x));
  }
}
rc = await F.executar({ acao: "carrinho_portal", conexao: "c-rol", item: { codigo: "FCD2158/1", descricao: "x", marca: "WEGA", qtd: 1, preco: 1 } }, deps()) as L;
confere("carrinho do portal Rolemar: ainda não pronto, aviso claro", rc.ok === false && /ainda não está pronto/.test(rc.erro));
try { await F.executar({ acao: "carrinho_portal", conexao: "c-dpk", item: { codigo: "WK84213" } }, deps({ gestor: false, admin: false })); confere("carrinho do portal: mecânico não", false); } catch (e) { confere("carrinho do portal: mecânico não", e instanceof F.ErroUso); }

// ---------- placa pelo portal (grátis)
rc = await F.executar({ acao: "placa", placa: "qxn-1e49" }, deps(), "49016409000195") as L;
confere("placa pelo portal: DPK responde o modelo de graça", rc.ok === true && rc.encontrado === true && /FIAT TORO/.test(rc.modelo) && rc.fornecedor === "DPK", JSON.stringify(rc));
{ const semDpk = { ...deps(), conexoes: async (ids: string[] | null) => conexoes.filter((c) => c.id !== "c-dpk" && (!ids || ids.includes(c.id))) };
  rc = await F.executar({ acao: "placa", placa: "QXN1E49" }, semDpk) as L;
  confere("placa pelo portal: sem a DPK, a Rolemar responde", rc.ok === true && rc.encontrado === true && /FIAT TORO 2020 2.0|FIAT TORO/.test(rc.modelo) && rc.fornecedor === "Rolemar Master", JSON.stringify(rc)); }
rc = await F.executar({ acao: "placa", placa: "AAA1A11" }, deps()) as L;
confere("placa que os portais não conhecem: encontrado false (a tela cai na consulta de sempre)", rc.ok === true && rc.encontrado === false);
try { await F.executar({ acao: "placa", placa: "ZZZ" }, deps()); confere("placa inválida: recusa", false); } catch (e) { confere("placa inválida: recusa", e instanceof F.ErroUso); }
confere("Rolemar: logou com o CNPJ só em números, achou a filial e buscou", porConexao("c-rol").ok && porConexao("c-rol").ofertas[0].codigo === "FCD2158/1" && porConexao("c-rol").ofertas[0].preco === 63.24 && sessoes["c-rol"]?.cod_emp === "16" && rolemarLogins === 1,
  JSON.stringify(porConexao("c-rol")));
confere("Pellegrino: logou, leu a página e os preços; sem estoque = 0", porConexao("c-pel").ok && porConexao("c-pel").ofertas.length === 2 && porConexao("c-pel").ofertas[0].preco === 88.81 && porConexao("c-pel").ofertas[0].estoque === null
  && porConexao("c-pel").ofertas[1].estoque === 0 && pellLogins === 1, JSON.stringify(porConexao("c-pel")));
confere("Pellegrino: foto relativa completada com o site do portal", porConexao("c-pel").ofertas[0].foto === "https://compreonline.pellegrino.com.br/fotos/produtos/wk84213.jpg", porConexao("c-pel").ofertas[0].foto);
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

{ // Rolemar responde 200 com "Sessão expirada": refaz o login uma vez e acha o modelo
  const semDpk = { ...deps(), conexoes: async (ids: string[] | null) => conexoes.filter((c) => c.id !== "c-dpk" && (!ids || ids.includes(c.id))) };
  sessoes["c-rol"] = { cookies: { PHPSESSID: "velho" }, cod_emp: "16" }; const rl0 = rolemarLogins;
  rc = await F.executar({ acao: "placa", placa: "QXN1E49" }, semDpk) as L;
  confere("placa Rolemar: sessão expirada em JSON → novo login e o modelo vem", rc.encontrado === true && rolemarLogins === rl0 + 1, JSON.stringify(rc) + " logins=" + (rolemarLogins - rl0)); }

{ // duas inclusões AO MESMO TEMPO no carrinho da DPK: com a trava, as duas peças ficam (sem a trava a segunda apagava a primeira)
  dpkCart = null; let trava = false; const lento = (async (u: string | URL | Request, i?: RequestInit) => { if (String(u).endsWith("/dpk-order/api/cart/getByFilter")) await new Promise((r) => setTimeout(r, 30)); return fakeFetch(u, i); }) as typeof fetch;
  let donoAtual = "";
  const dt = { ...deps(), fetch: lento, travar: async () => { if (trava) return null; trava = true; donoAtual = crypto.randomUUID(); return donoAtual; },
    renovar: async (_id: string, d: string) => trava && d === donoAtual, destravar: async (_id: string, d: string) => { if (d === donoAtual) trava = false; },
    esperar: (ms: number) => new Promise<void>((r) => setTimeout(r, Math.min(ms, 20))) };
  const um = (cod: string, prod: number, sap: string) => F.executar({ acao: "carrinho_portal", conexao: "c-dpk", item: { codigo: cod, descricao: "X", marca: "M", qtd: 1, preco: 1, extra: { productId: prod, sapCode: sap } } }, dt, "49016409000195") as Promise<L>;
  const [a, b] = await Promise.all([um("AAA111", 1, "111"), um("BBB222", 2, "222")]);
  const sap = (dpkCart?.cartItems || []).map((i: L) => i.productRetailerId).sort();
  confere("carrinho do portal: duas inclusões ao mesmo tempo, as duas peças ficam (trava por conexão)", a.ok && b.ok && sap.length === 2 && sap[0] === 111 && sap[1] === 222 && trava === false, JSON.stringify(sap));
  trava = true; const c = await um("CCC333", 3, "333"); trava = false;
  confere("carrinho do portal: trava presa por outra inclusão → espera e, sem conseguir, avisa sem gravar", c.ok === false && /em andamento/.test(c.erro));
  // trava tomada por outra chamada no meio (inclusão demorou): não grava e não apaga a trava da outra
  const n0 = dpkPosts.length;
  const roubada = { ...dt, renovar: async () => false, destravar: async (_id: string, d: string) => { if (d === donoAtual) trava = false; } };
  const x = await F.executar({ acao: "carrinho_portal", conexao: "c-dpk", item: { codigo: "DDD444", descricao: "X", marca: "M", qtd: 1, preco: 1, extra: { productId: 4, sapCode: "444" } } }, roubada, "49016409000195") as L;
  confere("carrinho do portal: trava tomada por outra chamada → não grava no portal", x.ok === false && /nada foi gravado/.test(x.erro) && dpkPosts.length === n0, JSON.stringify(x));
}
// ---------- peça pelo carro da placa (DPK): placa → FIAT TORO 2020 2.0 diesel → busca só desse carro
confere("é código? código vai sem filtro do carro; descrição vai com", F.ehCodigo("WK84213") && F.ehCodigo("FCD2158/1") && F.ehCodigo("0986BF0018") && !F.ehCodigo("pastilha") && !F.ehCodigo("filtro de oleo") && !F.ehCodigo("PD 1512"));
{ const c = F.dpkCasarCarro("FIAT TORO 2.0 TURBO DIESEL RANCH 2020 2.0", [{ id: 19, description: "FIAT" }, { id: 7, description: "CHEVROLET" }], (id) => id === 19 ? [{ id: 2419, description: "TORINO" }, { id: 2420, description: "TORO" }] : null,
    [{ id: 170, description: "1.8 16V E-TORQ FLEX" }, { id: 1006, description: "2.0 16V MULTIJET II TURBO DIESEL" }, { id: 2603, description: "1.3 16V T270 TURBO L4 FLEX" }]);
  confere("casar o carro: montadora, veículo (palavra inteira: TORO, não TORINO), ano e motor pela cilindrada + diesel", c.carMakerId === 19 && c.vehicleId === 2420 && c.year === 2020 && c.engineId === 1006, JSON.stringify(c));
  const o = F.dpkCasarCarro("CHEVROLET ONIX PLUS 1.0 TURBO 2021", [{ id: 7, description: "CHEVROLET" }], () => [{ id: 900, description: "ONIX" }, { id: 901, description: "ONIX PLUS" }]);
  confere("casar o carro: o nome mais completo vence (ONIX PLUS, não ONIX)", o.vehicleId === 901 && o.year === 2021, JSON.stringify(o));
  const g = F.dpkCasarCarro("GM ONIX 1.0 2020", [{ id: 7, description: "CHEVROLET" }], () => [{ id: 900, description: "ONIX" }]);
  confere("casar o carro: GM vira CHEVROLET", g.carMakerId === 7 && g.vehicleId === 900);
  for (const tx of ["MB SPRINTER 2.2 2020", "M.BENZ SPRINTER 2.2 2020", "MERCEDES-BENZ SPRINTER 2.2 2020", "MERCEDES SPRINTER 2.2 2020"]) {
    const m = F.dpkCasarCarro(tx, [{ id: 30, description: "MERCEDES-BENZ" }, { id: 19, description: "FIAT" }], (id) => id === 30 ? [{ id: 3001, description: "SPRINTER" }] : null);
    confere("casar o carro: " + tx + " → MERCEDES-BENZ SPRINTER", m.carMakerId === 30 && m.vehicleId === 3001, JSON.stringify(m)); }
  for (const tx of ["FIAT TORO 2.0 2019/2020", "FIAT TORO 2.0 2019 2020", "FIAT TORO 2019-2020 2.0"]) {
    const y = F.dpkCasarCarro(tx, [{ id: 19, description: "FIAT" }], () => [{ id: 2420, description: "TORO" }]);
    confere("casar o carro: fabricação/modelo (" + tx + ") usa o ano-modelo 2020", y.year === 2020, JSON.stringify(y)); }
  confere("casar o carro: montadora desconhecida → nada", !F.dpkCasarCarro("XPTO MODELO 2020", [{ id: 19, description: "FIAT" }], () => []).carMakerId); }
sessoes["c-dpk"] = null; dpkFiltros.length = 0; dpkBuscas.length = 0; dpkTokenValido = "tok1";
rc = await F.executar({ termos: ["pastilha"], placa: "QXN-1E49", conexoes: ["c-dpk", "c-rol"] }, deps(), "49016409000195") as L;
{ const d = rc.resultados.find((x: L) => x.conexao === "c-dpk"), rl = rc.resultados.find((x: L) => x.conexao === "c-rol");
  const b = dpkBuscas.find((u) => u.includes("Query=pastilha")) || "";
  confere("DPK pela placa: a busca vai com montadora, veículo, ano e motor do carro", /CarMakerId=19/.test(b) && /VehicleId=2420/.test(b) && /Year=2020/.test(b) && /EngineId=1006/.test(b), b);
  confere("DPK pela placa: só a peça do carro volta, e a resposta diz qual carro filtrou", d.ok && d.ofertas.length === 1 && d.ofertas[0].codigo === "PD1512" && /FIAT TORO 2020 2\.0 16V MULTIJET II TURBO DIESEL/.test(d.veiculo), JSON.stringify(d));
  confere("portal que ainda não filtra pelo carro: a resposta avisa", rl.ok && /sem o filtro do carro/.test(rl.sem_carro || ""), JSON.stringify(rl).slice(0, 300));
  confere("o carro casado fica guardado na sessão", !!(sessoes["c-dpk"] && sessoes["c-dpk"].carros && sessoes["c-dpk"].carros.QXN1E49 && sessoes["c-dpk"].carros.QXN1E49.vehicleId === 2420)); }
const nFiltros = dpkFiltros.length; dpkBuscas.length = 0;
rc = await F.executar({ termos: ["pastilha"], placa: "QXN1E49", conexoes: ["c-dpk"] }, deps()) as L;
confere("mesma placa de novo: não consulta as listas do catálogo outra vez", dpkFiltros.length === nFiltros && /VehicleId=2420/.test(dpkBuscas[0] || ""));
dpkBuscas.length = 0;
rc = await F.executar({ termos: ["WK84213"], placa: "QXN1E49", conexoes: ["c-dpk"] }, deps()) as L;
confere("código com placa: vai SEM o filtro do carro (código é exato)", rc.resultados[0].ofertas.length === 1 && !/VehicleId/.test(dpkBuscas[0] || "") && !rc.resultados[0].veiculo, dpkBuscas[0]);
dpkBuscas.length = 0;
rc = await F.executar({ termos: ["pastilha"], conexoes: ["c-dpk"] }, deps()) as L;
confere("sem placa: busca sem filtro do carro", rc.resultados[0].ofertas.length === 2 && !/VehicleId/.test(dpkBuscas[0] || ""));

{ // falha passageira do portal na lista de veículos: não fica guardada; quando o portal volta, o carro é reconhecido
  sessoes["c-dpk"] = null; dpkBuscas.length = 0;
  const cai = (async (u: string | URL | Request, i?: RequestInit) => /superk\/filter\?Type=3/.test(String(u)) ? new Response("fora", { status: 503 }) : fakeFetch(u, i)) as typeof fetch;
  let x = await F.executar({ termos: ["pastilha"], placa: "QXN1E49", conexoes: ["c-dpk"] }, { ...deps(), fetch: cai }) as L;
  confere("lista de veículos fora do ar: busca sem filtro e nada vai para o cache", x.resultados[0].ok && !x.resultados[0].veiculo && !(sessoes["c-dpk"]?.carros && "QXN1E49" in sessoes["c-dpk"].carros), JSON.stringify(sessoes["c-dpk"]?.carros || null));
  dpkBuscas.length = 0;
  x = await F.executar({ termos: ["pastilha"], placa: "QXN1E49", conexoes: ["c-dpk"] }, deps()) as L;
  confere("portal de volta: o carro é reconhecido e a busca sai filtrada", /VehicleId=2420/.test(dpkBuscas.find((u) => /Query=pastilha/.test(u)) || "") && /TORO/.test(x.resultados[0].veiculo || ""), JSON.stringify(x.resultados[0]).slice(0, 200));
  sessoes["c-dpk"] = null;
  const motorCai = (async (u: string | URL | Request, i?: RequestInit) => /superk\/filter\?Type=5/.test(String(u)) ? new Response("x", { status: 500 }) : fakeFetch(u, i)) as typeof fetch;
  x = await F.executar({ termos: ["pastilha"], placa: "QXN1E49", conexoes: ["c-dpk"] }, { ...deps(), fetch: motorCai }) as L;
  confere("lista de motores fora do ar: filtra por montadora/veículo/ano, mas não guarda o filtro incompleto", /TORO/.test(x.resultados[0].veiculo || "") && !(sessoes["c-dpk"]?.carros && "QXN1E49" in sessoes["c-dpk"].carros)); }

// ---------- o código-fonte não tem senha nem chave
const fonte = await Deno.readTextFile(new URL("../supabase/functions/compras/index.ts", import.meta.url));
confere("sem segredo no código", !/senha-|password":\s*"[^"{]|sb_secret|eyJ[A-Za-z0-9_-]{30,}/.test(fonte) && !/[A-Za-z0-9]{40}/.test(fonte.replace(/CHAVEPUBLICA/g, "")));

console.log(ok.length + " ok"); for (const f of falhas) console.log("FALHA: " + f);
if (falhas.length) Deno.exit(1);
