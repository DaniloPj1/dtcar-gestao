// DTCar Gestão — função "compras": consulta AO VIVO de preço e estoque nos portais dos fornecedores, com o login do Danilo
// (etapa 2 das Compras, pedido do Danilo em 16/11/2026: "automatizar a entrada no sistema de forma que o sistema faça a pesquisa
// e me dê o resultado usando o meu login", sem pedir API a ninguém).
//
// Cada fornecedor conectado (tabela compras_fornecedores, v59) tem um ROBÔ, reconhecido pelo endereço do portal:
//   dpk         www.dpk.com.br          — API JSON do portal (api.dpk.com.br): login por e-mail/senha → token; busca; preço/estoque
//   rolemar     rolemarmaster.com       — login por formulário (usuário = CNPJ), sessão em cookie; ajax-busca devolve JSON
//   pellegrino  compreonline.pellegrino.com.br — login em JSON, sessão em cookie; busca é página HTML + JSON de preços
//   toli        portal.tolidistribuidora.com.br — Oracle APEX: fica para o robô do programa do PC (não roda aqui)
// Mapeamento feito em 16/11/2026 com o login do Danilo no navegador (documento "Compras — fornecedores").
//
// Regras:
//   - A senha de cada fornecedor fica em segredos (chave compras_acesso:<id>, gravada pela tela via compras_gravar_acesso) e só esta
//     função lê, com a chave de servidor. A sessão aberta (token/cookies) fica em segredos (compras_sessao:<id>) para não fazer login
//     a cada consulta. Nada disso volta para a tela: a resposta só traz preços e a situação da conexão.
//   - Ritmo de gente: uma consulta por pedido da tela, no máximo MAX_TERMOS códigos por vez, nunca varredura de catálogo.
//   - O que o fornecedor devolve é gravado em compras_precos com origem "ao_vivo" (a tela mostra "Ao vivo" com a hora). Como a
//     função grava com a chave de servidor, o gatilho do v59 (que força "manual" para a tela) não interfere.
//   - A situação da conexão (compras_fornecedores.situacao/detalhe) é atualizada a cada consulta: ok | erro (com o motivo).
//   - Ações: consultar { termos: [códigos], conexoes?: [ids] } (administrador e consultor) e testar { conexao } (só administrador:
//     faz o login e uma busca de teste, sem gravar preço).
// Publicar com "Verify JWT" desligado (a função confere o login). Sem segredo próprio.
import { withSupabase } from "npm:@supabase/server@1.9.2";

export const MAX_TERMOS = 6;
export const LIMITE_MS = 12000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
// deno-lint-ignore no-explicit-any
export type Json = Record<string, any>;
export class ErroUso extends Error {}
/** Falha de login/sessão no fornecedor (senha errada, bloqueio, SMS): a conexão fica "erro" com o motivo */
export class ErroAcesso extends Error {}

export type Robo = "dpk" | "rolemar" | "pellegrino" | "toli";
export type Oferta = { codigo: string; marca: string; descricao: string; preco: number; estoque: number | null; prazo: string; aplicacao: string; ref?: string };
export type Conexao = { id: string; fornecedor_id: string; tipo: string; endereco: string; usuario: string; ativo: boolean; situacao: string; detalhe: string };
export type Sessao = Json;   // o que cada robô precisa guardar entre consultas (token, cookies, filial…)
export type Deps = {
  papel: { gestor: boolean; admin: boolean };
  conexoes: (ids: string[] | null) => Promise<Conexao[]>;
  senha: (conexaoId: string) => Promise<string | null>;
  lerSessao: (conexaoId: string) => Promise<Sessao | null>;
  gravarSessao: (conexaoId: string, s: Sessao | null) => Promise<void>;
  situacao: (conexaoId: string, situacao: "ok" | "erro" | "aguardando", detalhe: string) => Promise<void>;
  gravarPrecos: (fornecedorId: string, ofertas: Oferta[], em: string) => Promise<number>;
  /** apaga as sessões guardadas de conexões que não existem mais (a conexão apagada em Ajustes leva a senha junto, pelo gatilho do v59; a sessão sai aqui) */
  limparSessoes?: (idsVivos: string[]) => Promise<void>;
  fetch: typeof fetch;
  agora?: () => Date;
};

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
export const normCodigo = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const txt = (s: unknown) => (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(/\s+/g, " ").trim();
export const numero = (v: unknown): number => {
  if (typeof v === "number") return v;
  const s = txt(v).replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  // "1.234,56" → 1234.56; "63,24" → 63.24; "88.81" → 88.81
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : 0;
};
const soDig = (s: unknown) => txt(s).replace(/\D/g, "");

/** Robô pelo endereço do portal cadastrado em Ajustes (ou pelo nome, se o endereço estiver em branco) */
export function roboDe(c: { endereco?: string; obs?: string }, nomeFornecedor = ""): Robo | null {
  const t = ((c.endereco || "") + " " + (c.obs || "") + " " + nomeFornecedor).toLowerCase();
  if (/dpk\.com\.br|\bdpk\b/.test(t)) return "dpk";
  if (/rolemar/.test(t)) return "rolemar";
  if (/pellegrino/.test(t)) return "pellegrino";
  if (/toli/.test(t)) return "toli";
  return null;
}
export const NOME_ROBO: Record<Robo, string> = { dpk: "DPK", rolemar: "Rolemar Master", pellegrino: "Pellegrino Compre Online", toli: "Portal Toli" };

/** fetch com tempo-limite e User-Agent de navegador */
async function pedir(deps: Deps, url: string, init: RequestInit = {}, limite = LIMITE_MS): Promise<Response> {
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), limite);
  try {
    const headers = new Headers(init.headers || {});
    if (!headers.has("user-agent")) headers.set("user-agent", UA);
    return await deps.fetch(url, { ...init, headers, signal: ac.signal, redirect: init.redirect || "manual" });
  } catch (_e) {
    throw new Error("O portal do fornecedor não respondeu a tempo.");
  } finally { clearTimeout(t); }
}
/** cookies de uma resposta (nome=valor), juntados aos que já havia */
export function juntarCookies(atuais: Record<string, string>, r: Response): Record<string, string> {
  const out = { ...atuais };
  const lista: string[] = typeof (r.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
    ? (r.headers as Headers & { getSetCookie: () => string[] }).getSetCookie() : (r.headers.get("set-cookie") || "").split(/,(?=\s*[A-Za-z0-9_\-]+=)/);
  for (const c of lista) { const m = /^\s*([^=;]+)=([^;]*)/.exec(c); if (m) out[m[1].trim()] = m[2].trim(); }
  return out;
}
const cookieHeader = (c: Record<string, string>) => Object.entries(c).map(([k, v]) => k + "=" + v).join("; ");

/* ======================================================================================================================
 * DPK — api.dpk.com.br (KDaPeça / SuperK). Mapeado em 16/11/2026.
 *   login:   POST api-auth/api/connect/token  { userPrincipalName, password }  → { accessToken, refreshToken, document, documents[] }
 *            (com mais de um CNPJ: POST api-auth/api/connect/token/{cnpj} com o Bearer → token do CNPJ escolhido)
 *   busca:   GET api-product/api/productSearch?Query=…&StoreCode=21  → { totalCount, products: [{ id, code, description, manufacturer, sapCode }] }
 *   preço:   GET dpk-price/api/price/dpk?StoreCode=21&Item=83545&Item=…  → [{ id, status, stock, price, unitePrice, minimumBuy }]
 *   cabeçalhos: x-portal: DPK, x-api-key (chave pública embutida no JS do site: a função lê do site e guarda na sessão), Authorization Bearer.
 * ====================================================================================================================== */
export const DPK = { site: "https://www.dpk.com.br", api: "https://api.dpk.com.br", store: 21 };

async function dpkChaveDoSite(deps: Deps): Promise<string> {
  const idx = await (await pedir(deps, DPK.site + "/", { redirect: "follow" })).text();
  const m = /src="(main\.[a-f0-9]+\.js)"/.exec(idx);
  if (!m) throw new Error("DPK: não achei o programa do portal para ler a chave pública.");
  const js = await (await pedir(deps, DPK.site + "/" + m[1], { redirect: "follow" })).text();
  const k = /xApiKey:"([A-Za-z0-9]{20,})"/.exec(js);
  if (!k) throw new Error("DPK: a chave pública do portal mudou de lugar; o robô precisa de ajuste.");
  return k[1];
}
const dpkHeaders = (s: Sessao) => ({ accept: "application/json", "x-portal": "DPK", "x-api-key": String(s.apiKey || ""), ...(s.token ? { authorization: "Bearer " + s.token } : {}) });

async function dpkLogin(deps: Deps, c: Conexao, senha: string, cnpjOficina: string): Promise<Sessao> {
  const apiKey = await dpkChaveDoSite(deps);
  const s: Sessao = { apiKey };
  const r = await pedir(deps, DPK.api + "/api-auth/api/connect/token", { method: "POST", headers: { ...dpkHeaders(s), "content-type": "application/json" },
    body: JSON.stringify({ userPrincipalName: c.usuario, password: senha }) });
  const corpo = await r.json().catch(() => null) as Json | null;
  if (r.status === 401 || r.status === 400) throw new ErroAcesso("DPK recusou o login: confira o e-mail e a senha em Ajustes.");
  if (!r.ok || !corpo || !corpo.accessToken) throw new Error("DPK: o login não respondeu como esperado (HTTP " + r.status + ").");
  s.token = corpo.accessToken; s.refresh = corpo.refreshToken || ""; s.cnpj = corpo.document || "";
  // mais de um CNPJ no login: escolhe o da oficina
  const docs: string[] = Array.isArray(corpo.documents) ? corpo.documents.map((d: Json | string) => typeof d === "string" ? d : String(d.document || d.cnpj || "")) : [];
  const alvo = cnpjOficina && docs.map(soDig).includes(soDig(cnpjOficina)) ? soDig(cnpjOficina) : "";
  if (alvo && soDig(s.cnpj) !== alvo) {
    const r2 = await pedir(deps, DPK.api + "/api-auth/api/connect/token/" + alvo, { method: "POST", headers: { ...dpkHeaders(s), "content-type": "application/json" }, body: "{}" });
    const c2 = await r2.json().catch(() => null) as Json | null;
    if (r2.ok && c2 && c2.accessToken) { s.token = c2.accessToken; s.refresh = c2.refreshToken || s.refresh; s.cnpj = alvo; }
  }
  s.em = new Date().toISOString();
  return s;
}
export function dpkLerBusca(corpo: Json | null): { id: string; codigo: string; descricao: string; marca: string }[] {
  const l = corpo && Array.isArray(corpo.products) ? corpo.products : [];
  return l.map((p: Json) => ({ id: String(p.sapCode ?? p.id ?? ""), codigo: txt(p.code), descricao: txt(p.description), marca: txt(p.manufacturer) })).filter((p: Json) => p.id && p.codigo);
}
export function dpkLerPrecos(corpo: Json | null): Map<string, { preco: number; estoque: number | null; status: string }> {
  const m = new Map<string, { preco: number; estoque: number | null; status: string }>();
  for (const p of Array.isArray(corpo) ? corpo : []) m.set(String(p.id), { preco: numero(p.price), estoque: typeof p.stock === "number" ? p.stock : numero(p.stock), status: txt(p.status) });
  return m;
}
async function dpkBuscar(deps: Deps, s: Sessao, termo: string): Promise<Oferta[]> {
  const store = Number(s.store) || DPK.store;
  const r = await pedir(deps, DPK.api + "/api-product/api/productSearch?Query=" + encodeURIComponent(termo) + "&StoreCode=" + store, { headers: dpkHeaders(s) });
  if (r.status === 401) throw new ErroAcesso("sessão vencida");
  if (!r.ok) throw new Error("DPK: a busca falhou (HTTP " + r.status + ").");
  const prods = dpkLerBusca(await r.json().catch(() => null)).slice(0, 25);
  if (!prods.length) return [];
  const q = prods.map((p) => "Item=" + encodeURIComponent(p.id)).join("&");
  const rp = await pedir(deps, DPK.api + "/dpk-price/api/price/dpk?StoreCode=" + store + "&" + q, { headers: dpkHeaders(s) });
  const precos = rp.ok ? dpkLerPrecos(await rp.json().catch(() => null)) : new Map();
  return prods.map((p) => { const pr = precos.get(p.id); if (!pr || !(pr.preco > 0)) return null;
    return { codigo: p.codigo, marca: p.marca, descricao: p.descricao, preco: pr.preco, estoque: pr.estoque, prazo: "", aplicacao: "", ref: p.id } as Oferta; }).filter((x): x is Oferta => !!x);
}

/* ======================================================================================================================
 * Rolemar Master — rolemarmaster.com (PHP + React; Cloudflare na frente). Mapeado em 16/11/2026.
 *   login:   POST /ajax-login  FormData usuario (CNPJ) + senha → { data: { idusuario_lojista, cod_erp, … } }; sessão em cookie
 *   filial:  POST /ajax-lista-filiais → { filiais: [{ CODPARC, CODEMP, EMPRESA }], cod_emp }
 *   busca:   POST /ajax-busca FormData page=1, tipo_carrinho=compras, tipo=simples, busca=…, cod_emp → { data: [{ fabricante,
 *            codigo_fabricante, item, estoque, estoque_status, preco, valor_final, multiplo, texto }], ultima_pagina }
 *   cabeçalhos: Accept: application/json, X-Requested-With: XMLHttpRequest, Language: pt
 * ====================================================================================================================== */
export const ROLEMAR = { site: "https://rolemarmaster.com" };
const rolemarHeaders = (s: Sessao) => ({ accept: "application/json", "x-requested-with": "XMLHttpRequest", language: "pt", ...(s.cookies ? { cookie: cookieHeader(s.cookies) } : {}) });
function form(campos: Record<string, string>): FormData { const f = new FormData(); for (const [k, v] of Object.entries(campos)) f.append(k, v); return f; }

async function rolemarLogin(deps: Deps, c: Conexao, senha: string): Promise<Sessao> {
  let cookies: Record<string, string> = {};
  const r0 = await pedir(deps, ROLEMAR.site + "/login", { headers: { accept: "text/html" }, redirect: "follow" });
  cookies = juntarCookies(cookies, r0);
  const r = await pedir(deps, ROLEMAR.site + "/ajax-login", { method: "POST", headers: rolemarHeaders({ cookies }), body: form({ usuario: soDig(c.usuario) || c.usuario, senha }) });
  cookies = juntarCookies(cookies, r);
  const corpo = await r.json().catch(() => null) as Json | null;
  if (r.status === 403) throw new Error("Rolemar: o portal bloqueou o acesso automático (proteção do site). Tente de novo mais tarde.");
  if (!corpo || corpo.status === "erro" || !corpo.data || !corpo.data.idusuario_lojista) throw new ErroAcesso("Rolemar recusou o login: " + (txt(corpo && corpo.mensagem) || "usuário ou senha") + ". Confira o usuário (CNPJ) e a senha em Ajustes.");
  const s: Sessao = { cookies, cod_erp: txt(corpo.data.cod_erp), em: new Date().toISOString() };
  const rf = await pedir(deps, ROLEMAR.site + "/ajax-lista-filiais", { method: "POST", headers: { ...rolemarHeaders(s), "content-type": "application/json" }, body: "{}" });
  const f = await rf.json().catch(() => null) as Json | null;
  s.cookies = juntarCookies(s.cookies, rf);
  s.cod_emp = txt(f && (f.cod_emp || (f.filiais && f.filiais[0] && f.filiais[0].CODEMP))) || "";
  s.filial = txt(f && f.filiais && f.filiais[0] && f.filiais[0].EMPRESA);
  if (!s.cod_emp) throw new Error("Rolemar: não achei a filial da conta (cod_emp).");
  return s;
}
export function rolemarLerBusca(corpo: Json | null): Oferta[] {
  const l = corpo && Array.isArray(corpo.data) ? corpo.data : [];
  return l.map((p: Json) => ({ codigo: txt(p.codigo_fabricante), marca: txt(p.fabricante), descricao: txt(p.item), preco: numero(p.valor_final || p.preco),
    estoque: p.estoque === undefined || p.estoque === null || p.estoque === "" ? null : numero(p.estoque), prazo: "", aplicacao: txt(p.texto).slice(0, 300), ref: txt(p.id) }))
    .filter((o: Oferta) => o.codigo && o.preco > 0);
}
async function rolemarBuscar(deps: Deps, s: Sessao, termo: string): Promise<Oferta[]> {
  const r = await pedir(deps, ROLEMAR.site + "/ajax-busca", { method: "POST", headers: rolemarHeaders(s),
    body: form({ page: "1", tipo_carrinho: "compras", tipo: "simples", busca: termo, cod_emp: String(s.cod_emp || "") }) });
  if (r.status === 401 || r.status === 302) throw new ErroAcesso("sessão vencida");
  const corpo = await r.json().catch(() => null) as Json | null;
  if (!corpo) throw new ErroAcesso("sessão vencida");
  if (corpo.status === "erro") { if (/login|sess|autentic/i.test(txt(corpo.mensagem))) throw new ErroAcesso("sessão vencida"); throw new Error("Rolemar: " + txt(corpo.mensagem)); }
  return rolemarLerBusca(corpo);
}

/* ======================================================================================================================
 * Pellegrino Compre Online — compreonline.pellegrino.com.br (ASP.NET + Progress). Mapeado em 16/11/2026.
 *   login:   POST /account/login  JSON { Email, Password, ReturnUrl: "/" } → { result: { success, ativo, cnpj } }; sessão em cookie
 *   busca:   GET /catalogo/ais?q=…  → página HTML; cada produto é um <tr data-objectid="…"> com descrição, marca e cód. do fabricante
 *   preço:   GET /api/progress/b2b/produtos/precos?ids=a,b,c → { precos: [{ id, preco, preco_com_imposto, desconto, preco_anterior }] }
 *   estoque: o portal não dá quantidade; "Me avise quando estiver disponível" na linha = sem estoque.
 * ====================================================================================================================== */
export const PELLEGRINO = { site: "https://compreonline.pellegrino.com.br" };
const pellHeaders = (s: Sessao, extra: Record<string, string> = {}) => ({ accept: "application/json, text/html", "x-requested-with": "XMLHttpRequest", ...(s.cookies ? { cookie: cookieHeader(s.cookies) } : {}), ...extra });

async function pellegrinoLogin(deps: Deps, c: Conexao, senha: string): Promise<Sessao> {
  let cookies: Record<string, string> = {};
  const r0 = await pedir(deps, PELLEGRINO.site + "/Account/Login/?ReturnUrl=%2F", { headers: { accept: "text/html" }, redirect: "follow" });
  cookies = juntarCookies(cookies, r0);
  const r = await pedir(deps, PELLEGRINO.site + "/account/login", { method: "POST", headers: pellHeaders({ cookies }, { "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify({ Email: c.usuario, Password: senha, ReturnUrl: "/" }) });
  cookies = juntarCookies(cookies, r);
  const corpo = await r.json().catch(() => null) as Json | null;
  const res = corpo && (corpo.result || corpo);
  if (r.status === 403) throw new Error("Pellegrino: o portal bloqueou o acesso automático. Tente de novo mais tarde.");
  if (!res || res.success !== true) throw new ErroAcesso("Pellegrino recusou o login: " + (txt(res && (res.message || res.erro || res.error)) || "e-mail ou senha") + ". Confira o e-mail e a senha em Ajustes.");
  return { cookies, em: new Date().toISOString() };
}
const desHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const semTags = (s: string) => desHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** Lê as linhas de produto da página do catálogo. Devolve { id, descricao, marca, codigo, semEstoque } por linha. */
export function pellegrinoLerPagina(html: string): { id: string; descricao: string; marca: string; codigo: string; semEstoque: boolean }[] {
  const out: { id: string; descricao: string; marca: string; codigo: string; semEstoque: boolean }[] = [];
  const re = /<tr[^>]*data-objectid="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = m[1], tr = m[2];
    const codigo = (/data-original-title="([^"]+)"/.exec(tr) || /title="([^"]{2,40})"[^>]*data-toggle="popover"/.exec(tr) || [])[1] || "";
    const descricao = (/font-weight-bold[^>]*>([^<]{3,120})</.exec(tr) || [])[1] || "";
    const marca = (/<span class="d-none">([^<]{2,40})<\/span>\s*<img/.exec(tr) || [])[1] || "";
    const semEstoque = /avise quando estiver dispon/i.test(tr);
    if (id && (codigo || descricao)) out.push({ id, descricao: txt(descricao), marca: txt(marca), codigo: txt(desHtml(codigo)), semEstoque });
  }
  return out;
}
export function pellegrinoLerPrecos(corpo: Json | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of corpo && Array.isArray(corpo.precos) ? corpo.precos : []) m.set(String(p.id), numero(p.preco_com_imposto ?? p.preco));
  return m;
}
async function pellegrinoBuscar(deps: Deps, s: Sessao, termo: string): Promise<Oferta[]> {
  const r = await pedir(deps, PELLEGRINO.site + "/catalogo/ais?q=" + encodeURIComponent(termo), { headers: pellHeaders(s, { accept: "text/html" }) });
  if (r.status === 302 || r.status === 301 || r.status === 401) throw new ErroAcesso("sessão vencida");
  if (!r.ok) throw new Error("Pellegrino: a busca falhou (HTTP " + r.status + ").");
  const html = await r.text();
  if (/Account\/Login|id="kt_login_signin_submit"/.test(html)) throw new ErroAcesso("sessão vencida");
  const linhas = pellegrinoLerPagina(html).slice(0, 25);
  if (!linhas.length) return [];
  const rp = await pedir(deps, PELLEGRINO.site + "/api/progress/b2b/produtos/precos?ids=" + encodeURIComponent(linhas.map((l) => l.id).join(",")), { headers: pellHeaders(s) });
  const precos = rp.ok ? pellegrinoLerPrecos(await rp.json().catch(() => null)) : new Map<string, number>();
  return linhas.map((l) => { const p = precos.get(l.id); if (!(p && p > 0)) return null;
    return { codigo: l.codigo || l.id, marca: l.marca, descricao: l.descricao, preco: p, estoque: l.semEstoque ? 0 : null, prazo: "", aplicacao: "", ref: l.id } as Oferta; }).filter((x): x is Oferta => !!x);
}

/* ======================================================================================================================
 * Orquestração
 * ====================================================================================================================== */
type Resultado = { conexao: string; fornecedor_id: string; robo: Robo | null; nome: string; ok: boolean; ofertas: Oferta[]; erro?: string; gravadas?: number; em?: string; no_pc?: boolean };

async function comSessao(deps: Deps, c: Conexao, robo: Robo, cnpjOficina: string, usar: (s: Sessao) => Promise<Oferta[]>): Promise<Oferta[]> {
  const senha = await deps.senha(c.id);
  if (!senha) throw new ErroAcesso("Sem senha guardada: cadastre a senha em Ajustes › Fornecedores conectados.");
  if (!c.usuario) throw new ErroAcesso("Sem usuário: informe o login do fornecedor em Ajustes.");
  const login = () => robo === "dpk" ? dpkLogin(deps, c, senha, cnpjOficina) : robo === "rolemar" ? rolemarLogin(deps, c, senha) : pellegrinoLogin(deps, c, senha);
  let s = await deps.lerSessao(c.id);
  if (!s) { s = await login(); await deps.gravarSessao(c.id, s); }
  try { return await usar(s); }
  catch (e) {
    if (!(e instanceof ErroAcesso)) throw e;
    // sessão vencida: entra de novo uma vez
    s = await login(); await deps.gravarSessao(c.id, s);
    return await usar(s);
  }
}
const buscar = (deps: Deps, robo: Robo, s: Sessao, termo: string) => robo === "dpk" ? dpkBuscar(deps, s, termo) : robo === "rolemar" ? rolemarBuscar(deps, s, termo) : pellegrinoBuscar(deps, s, termo);

export async function executar(corpo: Json, deps: Deps, cnpjOficina = ""): Promise<Json> {
  const acao = String(corpo.acao || "consultar");
  if (!deps.papel.gestor) throw new ErroUso("Só administrador e consultor consultam os fornecedores.");
  const agora = (deps.agora || (() => new Date()))();
  if (acao === "testar") {
    if (!deps.papel.admin) throw new ErroUso("Só o administrador testa a conexão.");
    const [c] = await deps.conexoes([String(corpo.conexao || "")]);
    if (!c) throw new ErroUso("Fornecedor conectado não encontrado.");
    const robo = roboDe(c);
    if (!robo) { await deps.situacao(c.id, "erro", "Portal não reconhecido pelo endereço: use o endereço do site do fornecedor (DPK, Rolemar, Pellegrino ou Toli)."); return { ok: false, erro: "Portal não reconhecido pelo endereço.", robo: null }; }
    if (robo === "toli") { await deps.situacao(c.id, "aguardando", "Portal Toli: a consulta roda pelo programa do PC da oficina (em preparação)."); return { ok: true, robo, no_pc: true, nome: NOME_ROBO[robo] }; }
    try {
      await deps.gravarSessao(c.id, null);   // teste = login novo de verdade
      const ofertas = await comSessao(deps, c, robo, cnpjOficina, (s) => buscar(deps, robo, s, String(corpo.termo || "WK84213")));
      await deps.situacao(c.id, "ok", "Conectado em " + agora.toISOString() + " (teste: " + ofertas.length + " preço(s)).");
      return { ok: true, robo, nome: NOME_ROBO[robo], ofertas: ofertas.slice(0, 10) };
    } catch (e) {
      const msg = (e as Error).message || "falha";
      await deps.situacao(c.id, "erro", msg); await deps.gravarSessao(c.id, null);
      return { ok: false, robo, nome: NOME_ROBO[robo], erro: msg };
    }
  }
  if (acao !== "consultar") throw new ErroUso("Ação desconhecida: " + acao);
  const termos = [...new Set((Array.isArray(corpo.termos) ? corpo.termos : [corpo.termo]).map((t: unknown) => txt(t)).filter((t: string) => t.length >= 3))].slice(0, MAX_TERMOS);
  if (!termos.length) throw new ErroUso("Informe o código (ou a descrição) da peça para consultar.");
  const ids = Array.isArray(corpo.conexoes) && corpo.conexoes.length ? corpo.conexoes.map(String) : null;
  const todas = await deps.conexoes(null);
  if (deps.limparSessoes) await deps.limparSessoes(todas.map((c) => c.id)).catch(() => {});
  const conexoes = todas.filter((c) => c.ativo !== false && (!ids || ids.includes(c.id)));
  const em = agora.toISOString();
  const resultados: Resultado[] = await Promise.all(conexoes.map(async (c): Promise<Resultado> => {
    const robo = roboDe(c), base = { conexao: c.id, fornecedor_id: c.fornecedor_id, robo, nome: robo ? NOME_ROBO[robo] : "" };
    if (!robo) return { ...base, ok: false, ofertas: [], erro: "Portal não reconhecido pelo endereço." };
    if (robo === "toli") return { ...base, ok: false, ofertas: [], no_pc: true, erro: "Portal Toli: consulta pelo programa do PC (em preparação)." };
    try {
      const vistas = new Map<string, Oferta>();
      await comSessao(deps, c, robo, cnpjOficina, async (s) => {
        for (const t of termos) for (const o of await buscar(deps, robo, s, t)) { const k = normCodigo(o.codigo) + "|" + normCodigo(o.marca); if (!vistas.has(k)) vistas.set(k, o); }
        return [];
      });
      const ofertas = [...vistas.values()];
      const gravadas = ofertas.length ? await deps.gravarPrecos(c.fornecedor_id, ofertas, em) : 0;
      await deps.situacao(c.id, "ok", "Última consulta " + em + " (" + ofertas.length + " preço(s)).");
      return { ...base, ok: true, ofertas, gravadas, em };
    } catch (e) {
      const msg = (e as Error).message || "falha";
      await deps.situacao(c.id, "erro", msg);
      if (e instanceof ErroAcesso) await deps.gravarSessao(c.id, null);
      return { ...base, ok: false, ofertas: [], erro: msg };
    }
  }));
  return { ok: true, termos, em, resultados };
}

// deno-lint-ignore no-explicit-any
type Db = any;
export function depsDoBanco(adm: Db, usuario: Db): Omit<Deps, "papel" | "fetch" | "agora"> {
  const chave = (p: string, id: string) => p + ":" + id;
  return {
    conexoes: async (ids) => {
      let q = adm.from("compras_fornecedores").select("id,fornecedor_id,tipo,endereco,usuario,ativo,situacao,detalhe,obs");
      if (ids) q = q.in("id", ids);
      const { data, error } = await q;
      if (error) throw new Error("Falha ao ler os fornecedores conectados: " + error.message);
      return data || [];
    },
    senha: async (id) => { const { data } = await adm.from("segredos").select("valor").eq("chave", chave("compras_acesso", id)).maybeSingle(); return (data && data.valor) || null; },
    lerSessao: async (id) => { const { data } = await adm.from("segredos").select("valor").eq("chave", chave("compras_sessao", id)).maybeSingle();
      try { return data && data.valor ? JSON.parse(data.valor) : null; } catch (_e) { return null; } },
    gravarSessao: async (id, s) => {
      if (!s) { await adm.from("segredos").delete().eq("chave", chave("compras_sessao", id)); return; }
      await adm.from("segredos").upsert({ chave: chave("compras_sessao", id), valor: JSON.stringify(s), atualizado_em: new Date().toISOString() });
    },
    limparSessoes: async (vivos) => {
      const { data } = await adm.from("segredos").select("chave").like("chave", "compras_sessao:%");
      const mortas = (data || []).map((l: { chave: string }) => l.chave).filter((k: string) => !vivos.includes(k.slice("compras_sessao:".length)));
      if (mortas.length) await adm.from("segredos").delete().in("chave", mortas);
    },
    situacao: async (id, situacao, detalhe) => { await adm.from("compras_fornecedores").update({ situacao, detalhe: detalhe.slice(0, 300) }).eq("id", id); },
    gravarPrecos: async (fornecedorId, ofertas, em) => {
      const linhas = ofertas.map((o) => ({ fornecedor_id: fornecedorId, codigo: o.codigo.slice(0, 60), codigo_norm: normCodigo(o.codigo), marca: o.marca.slice(0, 60).toUpperCase(),
        descricao: o.descricao.slice(0, 200).toUpperCase(), preco: Math.round(o.preco * 100) / 100, estoque: o.estoque, prazo: o.prazo.slice(0, 40), origem: "ao_vivo", consultado_em: em, criado_por_nome: "robô", obs: o.aplicacao.slice(0, 300) }))
        .filter((l) => l.codigo_norm);
      // o mesmo código pode vir duas vezes (marcas diferentes com o mesmo código): fica a primeira
      const unicas: typeof linhas = []; const vistos = new Set<string>();
      for (const l of linhas) if (!vistos.has(l.codigo_norm)) { vistos.add(l.codigo_norm); unicas.push(l); }
      const { error } = await adm.from("compras_precos").upsert(unicas, { onConflict: "fornecedor_id,codigo_norm" });
      if (error) { console.error("compras: não gravou os preços", error.message); return 0; }
      return unicas.length;
    },
  };
}

export const atender = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const corpo = await req.json().catch(() => ({})) as Json;
  try {
    const [g, a, cfg] = await Promise.all([ctx.supabase.rpc("e_gestor"), ctx.supabase.rpc("e_admin"), ctx.supabase.from("config").select("dados").eq("id", 1).maybeSingle()]);
    const cnpj = (cfg.data && cfg.data.dados && cfg.data.dados.cnpj) || "";
    return json(await executar(corpo, { papel: { gestor: g.data === true, admin: a.data === true }, fetch, ...depsDoBanco(ctx.supabaseAdmin, ctx.supabase) }, cnpj));
  } catch (e) {
    if (e instanceof ErroUso) return json({ ok: false, erro: e.message }, 400);
    console.error("compras", e);
    return json({ ok: false, erro: (e as Error).message || "Falha na consulta aos fornecedores." }, 200);
  }
});

if (import.meta.main) Deno.serve((req) => atender(req));
