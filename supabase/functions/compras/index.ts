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
/** trava do carrinho do portal esquecida há mais que isto pode ser tomada (maior que um login completo da DPK + leitura + gravação) */
export const PRAZO_TRAVA_MS = 150000;
export const LIMITE_MS = 12000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
// deno-lint-ignore no-explicit-any
export type Json = Record<string, any>;
export class ErroUso extends Error {}
/** Falha de login/sessão no fornecedor (senha errada, bloqueio, SMS): a conexão fica "erro" com o motivo */
export class ErroAcesso extends Error {}

export type Robo = "dpk" | "rolemar" | "pellegrino" | "toli";
export type Oferta = { codigo: string; marca: string; descricao: string; preco: number; estoque: number | null; prazo: string; aplicacao: string; ref?: string; foto?: string; extra?: Json };
/** endereço de foto que o portal devolveu: só https e só se parecer um endereço (nada de data: ou javascript:) */
const fotoOk = (u: unknown) => { const t = txt(u); return /^https:\/\/[^\s"'<>]+$/i.test(t) ? t : ""; };
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
  /** trava por conexão para o carrinho do portal (o POST da DPK manda o carrinho inteiro: duas inclusões ao mesmo tempo se sobrescreveriam).
   *  travar devolve o "dono" (marca aleatória) se pegou a trava, ou null; renovar confirma que a trava ainda é desse dono e renova o prazo
   *  (chamado logo antes de gravar no portal: se outra chamada tomou a trava, não grava); destravar só apaga a trava desse dono.
   *  Revisão do Codex, 17/11/2026. */
  travar?: (conexaoId: string) => Promise<string | null>;
  renovar?: (conexaoId: string, dono: string) => Promise<boolean>;
  destravar?: (conexaoId: string, dono: string) => Promise<void>;
  esperar?: (ms: number) => Promise<void>;
  /** só no "testar" com amostra=true (administrador): recebe um trecho da página de resultado, para afinar o leitor do portal */
  amostra?: (trecho: string) => void;
};

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
export const normCodigo = (s: unknown) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const txt = (s: unknown) => (typeof s === "string" || typeof s === "number" ? String(s) : "").replace(/\s+/g, " ").trim();
export const numero = (v: unknown): number => {
  if (typeof v === "number") return v;
  const s = txt(v).replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  // "1.234,56" → 1234.56; "63,24" → 63.24; "88.81" → 88.81; "1.000" (milhar sem centavos) → 1000
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : /^\d{1,3}(\.\d{3})+$/.test(s) ? Number(s.replace(/\./g, "")) : Number(s);
  return Number.isFinite(n) ? n : 0;
};
const soDig = (s: unknown) => txt(s).replace(/\D/g, "");
/** data e hora no horário de Brasília, para o detalhe da conexão que a tela mostra (ex.: 17/11/2026 10:05) */
export const horaBR = (d: Date) => d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "");

/** Robô SÓ pelo endereço do portal cadastrado em Ajustes (mesma regra de roboDaConexao em js/compraspecas.js; o nome do fornecedor não conta) */
export function roboDe(c: { endereco?: string }): Robo | null {
  const t = String(c.endereco || "").toLowerCase();
  if (/dpk\.com\.br/.test(t)) return "dpk";
  if (/rolemarmaster\.com|rolemar\./.test(t)) return "rolemar";
  // plataforma "Compre Online" (Pellegrino, Sama e outras distribuidoras usam o mesmo sistema): qualquer compreonline.<loja>.com.br
  if (/^https?:\/\/compreonline\.[a-z0-9-]+(\.[a-z0-9-]+)*\.com\.br(\/|$)/.test(t) || /pellegrino\.com\.br/.test(t)) return "pellegrino";
  if (/tolidistribuidora\.com\.br/.test(t)) return "toli";
  return null;
}
export const NOME_ROBO: Record<Robo, string> = { dpk: "DPK", rolemar: "Rolemar Master", pellegrino: "Compre Online", toli: "Portal Toli" };
/** endereço-base do portal Compre Online da conexão (só o esquema e o host, lidos do endereço cadastrado; nada de caminho) */
export function siteCompreOnline(c: { endereco?: string }): string {
  const m = /^https?:\/\/(compreonline\.[a-z0-9-]+(?:\.[a-z0-9-]+)*\.com\.br)/i.exec(String(c.endereco || "").trim());
  return m ? "https://" + m[1].toLowerCase() : PELLEGRINO.site;
}

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
export const DPK = { site: "https://www.dpk.com.br", api: "https://api.dpk.com.br", cdn: "https://cdn-superk.azureedge.net", store: 21 };

async function dpkChaveDoSite(deps: Deps): Promise<string> {
  const idx = await (await pedir(deps, DPK.site + "/", { redirect: "follow" })).text();
  const m = /src="(main\.[a-f0-9]+\.js)"/.exec(idx);
  if (!m) throw new Error("DPK: não achei o programa do portal para ler a chave pública.");
  // o programa do portal tem uns 5 MB: tempo maior, e a chave fica guardada na sessão para não baixar de novo a cada login
  const js = await (await pedir(deps, DPK.site + "/" + m[1], { redirect: "follow" }, 40000)).text();
  const k = /xApiKey:"([A-Za-z0-9]{20,})"/.exec(js);
  if (!k) throw new Error("DPK: a chave pública do portal mudou de lugar; o robô precisa de ajuste.");
  return k[1];
}
const dpkHeaders = (s: Sessao) => ({ accept: "application/json", "x-portal": "DPK", "x-api-key": String(s.apiKey || ""), ...(s.token ? { authorization: "Bearer " + s.token } : {}) });

async function dpkLogin(deps: Deps, c: Conexao, senha: string, cnpjOficina: string, chaveGuardada = ""): Promise<Sessao> {
  let apiKey = chaveGuardada || await dpkChaveDoSite(deps);
  const s: Sessao = { apiKey };
  const entrar = () => pedir(deps, DPK.api + "/api-auth/api/connect/token", { method: "POST", headers: { ...dpkHeaders(s), "content-type": "application/json" },
    body: JSON.stringify({ userPrincipalName: c.usuario, password: senha }) });
  let r = await entrar();
  // chave pública guardada não vale mais (o portal trocou): lê a nova do site e tenta uma vez
  if (chaveGuardada && (r.status === 401 || r.status === 403)) { apiKey = await dpkChaveDoSite(deps); s.apiKey = apiKey; r = await entrar(); }
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
export function dpkLerBusca(corpo: Json | null): { id: string; codigo: string; descricao: string; marca: string; foto: string; extra: Json }[] {
  const l = corpo && Array.isArray(corpo.products) ? corpo.products : [];
  // foto: o portal devolve só o nome do arquivo (MANN_WK84213.jpg); as imagens ficam no CDN do SuperK
  const foto = (p: Json) => { const v = txt(p.image || p.imageUrl || ""); return /^https:/.test(v) ? fotoOk(v) : /^[\w.-]+\.(jpe?g|png|webp)$/i.test(v) ? DPK.cdn + "/img/" + v : ""; };
  return l.map((p: Json) => ({ id: String(p.sapCode ?? p.id ?? ""), codigo: txt(p.code), descricao: txt(p.description), marca: txt(p.manufacturer), foto: foto(p),
    extra: { productId: Number(p.id) || 0, sapCode: String(p.sapCode ?? ""), minimo: Number(p.minimumQuantity) || 0 } })).filter((p: Json) => p.id && p.codigo);
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
  if (rp.status === 401) throw new ErroAcesso("sessão vencida");
  const precos = rp.ok ? dpkLerPrecos(await rp.json().catch(() => null)) : new Map();
  return prods.map((p) => { const pr = precos.get(p.id); if (!pr || !(pr.preco > 0)) return null;
    return { codigo: p.codigo, marca: p.marca, descricao: p.descricao, preco: pr.preco, estoque: pr.estoque, prazo: "", aplicacao: "", ref: p.id, foto: p.foto, extra: p.extra } as Oferta; }).filter((x): x is Oferta => !!x);
}
/** Modelo do carro pela placa, GRÁTIS pelo portal da DPK (mapeado em 16/11/2026): GET api-product/api/productSearch/plate?plate=ABC1D23 → "FIAT TORO 2.0 ..." */
async function dpkPlaca(deps: Deps, s: Sessao, placa: string): Promise<string> {
  const r = await pedir(deps, DPK.api + "/api-product/api/productSearch/plate?plate=" + encodeURIComponent(placa), { headers: dpkHeaders(s) });
  if (r.status === 401) throw new ErroAcesso("sessão vencida");
  if (!r.ok) return "";
  const corpo = await r.json().catch(async () => txt(await r.text().catch(() => "")));
  return txt(typeof corpo === "string" ? corpo : corpo && (corpo.model || corpo.description || "")).slice(0, 120);
}
/* carrinho do portal da DPK (mapeado em 17/11/2026 no navegador):
 *   GET  dpk-order/api/cart/getByFilter → [{ id, retailerId, hubId, cartItems: [{ id, productId, productRetailerId, quantity, position, code, description, manufacturer }] }]
 *   POST dpk-order/api/cart { hubId, retailerId, cartItems: [{ productId, productRetailerId, quantity, position, code, description, manufacturer, total }] } → o carrinho
 *   DELETE dpk-order/api/cart/{cartId}/{itemId} → true  (não usado: o sistema só põe; tirar é no portal) */
export type ItemPortal = { codigo: string; descricao: string; marca: string; qtd: number; preco: number; extra?: Json };
async function dpkCarrinho(deps: Deps, s: Sessao, item: ItemPortal, aindaMinha: () => Promise<boolean> = async () => true): Promise<{ ok: boolean; detalhe: string }> {
  const store = Number(s.store) || DPK.store;
  const productId = Number(item.extra && item.extra.productId) || 0, sap = Number(item.extra && item.extra.sapCode) || 0;
  if (!productId || !sap) return { ok: false, detalhe: "DPK: este preço veio sem o código interno do portal; consulte de novo e adicione pelo resultado ao vivo." };
  const rg = await pedir(deps, DPK.api + "/dpk-order/api/cart/getByFilter", { headers: dpkHeaders(s) });
  if (rg.status === 401) throw new ErroAcesso("sessão vencida");
  // o POST manda o carrinho INTEIRO: sem ler o que já está lá, gravar apagaria os itens do portal. Falhou a leitura → não grava (revisão do Codex, 17/11/2026)
  if (!rg.ok) return { ok: false, detalhe: "DPK: não deu para ler o carrinho do portal (HTTP " + rg.status + "); nada foi gravado lá. O item ficou só no carrinho do sistema." };
  const lista = (await rg.json().catch(() => undefined)) as Json[] | null | undefined;
  if (!Array.isArray(lista) || lista.some((c) => !c || typeof c !== "object" || (c.cartItems !== undefined && !Array.isArray(c.cartItems))))
    return { ok: false, detalhe: "DPK: o carrinho do portal respondeu fora do padrão; nada foi gravado lá. O item ficou só no carrinho do sistema." };
  const atual = Array.isArray(lista) && lista.length ? lista.find((c) => c && c.closed === false) || lista[0] : null;
  const retailerId = Number(atual && atual.retailerId) || Number(s.retailerId) || 2;
  const existentes: Json[] = atual && Array.isArray(atual.cartItems) ? atual.cartItems : [];
  const ja = existentes.find((i) => Number(i.productRetailerId) === sap);
  const qtd = Math.max(1, Math.round(item.qtd || 1)) + (ja ? Number(ja.quantity) || 0 : 0);
  const corpo = { ...(atual && atual.id ? { id: atual.id } : {}), hubId: store, retailerId, cartItems: [
    ...existentes.filter((i) => Number(i.productRetailerId) !== sap).map((i) => ({ productId: i.productId, productRetailerId: i.productRetailerId, quantity: i.quantity, position: i.position, code: i.code, description: i.description, manufacturer: i.manufacturer, total: i.total || 0 })),
    { productId, productRetailerId: sap, quantity: qtd, position: existentes.length + 1, code: item.codigo, description: item.descricao, manufacturer: item.marca, total: Math.round((item.preco || 0) * qtd * 100) / 100 }] };
  // a trava ainda é desta chamada? (se demorou e outra tomou, gravar agora apagaria o que a outra pôs)
  if (!(await aindaMinha())) return { ok: false, detalhe: "DPK: a inclusão demorou e outra começou no mesmo carrinho; nada foi gravado no portal. Tente de novo." };
  const r = await pedir(deps, DPK.api + "/dpk-order/api/cart", { method: "POST", headers: { ...dpkHeaders(s), "content-type": "application/json" }, body: JSON.stringify(corpo) });
  if (r.status === 401) throw new ErroAcesso("sessão vencida");
  const resp = (await r.json().catch(() => null)) as Json | null;
  const itens: Json[] = resp && Array.isArray(resp.cartItems) ? resp.cartItems : [];
  if (!r.ok || !itens.some((i) => Number(i.productRetailerId) === sap)) return { ok: false, detalhe: "DPK: o portal não confirmou o item no carrinho (HTTP " + r.status + ")." };
  return { ok: true, detalhe: "No carrinho da DPK: " + qtd + " x " + item.codigo + (ja ? " (quantidade somada ao que já estava)" : "") + "." };
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
    estoque: p.estoque === undefined || p.estoque === null || p.estoque === "" ? null : numero(p.estoque), prazo: "", aplicacao: txt(p.texto).slice(0, 300), ref: txt(p.id),
    foto: fotoOk(Array.isArray(p.imagens) ? (p.imagens[0] && (p.imagens[0].url || p.imagens[0].imagem || p.imagens[0].src || p.imagens[0])) : (p.imagem || p.foto || "")) }))
    .filter((o: Oferta) => o.codigo && o.preco > 0);
}
/** Modelo do carro pela placa pelo portal da Rolemar (mapeado em 16/11/2026): POST /ajax-busca-placa placa=… → dados do carro (brand, model, madeYear, engine) */
async function rolemarPlaca(deps: Deps, s: Sessao, placa: string): Promise<string> {
  const r = await pedir(deps, ROLEMAR.site + "/ajax-busca-placa", { method: "POST", headers: rolemarHeaders(s), body: form({ placa }) });
  if (r.status === 401 || r.status === 302) throw new ErroAcesso("sessão vencida");
  if (!r.ok) return "";
  const c = await r.json().catch(() => null) as Json | null;
  if (c && c.status === "erro") { if (/login|sess|autentic/i.test(txt(c.mensagem))) throw new ErroAcesso("sessão vencida"); return ""; }
  const d = (c && (c.data || c.veiculo || c)) as Json | null;
  if (!d || typeof d !== "object") return "";
  return [txt(d.brand || d.marca), txt(d.model || d.modelo), txt(d.version || d.versao), txt(d.madeYear || d.ano || d.anoModelo), txt(d.engine || d.motor)].filter(Boolean).join(" ").slice(0, 120);
}
async function rolemarBuscar(deps: Deps, s: Sessao, termo: string): Promise<Oferta[]> {
  const r = await pedir(deps, ROLEMAR.site + "/ajax-busca", { method: "POST", headers: rolemarHeaders(s),
    body: form({ page: "1", tipo_carrinho: "compras", tipo: "simples", busca: termo, cod_emp: String(s.cod_emp || "") }) });
  if (r.status === 401 || r.status === 302) throw new ErroAcesso("sessão vencida");
  if (r.status === 403) throw new Error("Rolemar: o portal bloqueou o acesso automático (proteção do site). Tente de novo mais tarde.");
  if (!r.ok) throw new Error("Rolemar: a busca falhou (HTTP " + r.status + ").");
  const corpo = await r.json().catch(() => null) as Json | null;
  if (!corpo) throw new Error("Rolemar: a busca respondeu fora do padrão (página em vez de dados). Tente de novo; se continuar, o portal mudou.");
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
const pellSite = (c: { endereco?: string }) => siteCompreOnline(c);
const pellHeaders = (s: Sessao, extra: Record<string, string> = {}) => ({ accept: "application/json, text/html", "x-requested-with": "XMLHttpRequest", ...(s.cookies ? { cookie: cookieHeader(s.cookies) } : {}), ...extra });

async function pellegrinoLogin(deps: Deps, c: Conexao, senha: string): Promise<Sessao> {
  let cookies: Record<string, string> = {};
  const site = pellSite(c);
  const r0 = await pedir(deps, site + "/Account/Login/?ReturnUrl=%2F", { headers: { accept: "text/html" }, redirect: "follow" });
  cookies = juntarCookies(cookies, r0);
  const r = await pedir(deps, site + "/account/login", { method: "POST", headers: pellHeaders({ cookies }, { "content-type": "application/json; charset=utf-8" }),
    body: JSON.stringify({ Email: c.usuario, Password: senha, ReturnUrl: "/" }) });
  cookies = juntarCookies(cookies, r);
  const corpo = await r.json().catch(() => null) as Json | null;
  const res = corpo && (corpo.result || corpo);
  if (r.status === 403) throw new Error("Pellegrino: o portal bloqueou o acesso automático. Tente de novo mais tarde.");
  if (!res || res.success !== true) throw new ErroAcesso("Pellegrino recusou o login: " + (txt(res && (res.message || res.erro || res.error)) || "e-mail ou senha") + ". Confira o e-mail e a senha em Ajustes.");
  return { cookies, site, em: new Date().toISOString() };
}
const desHtml = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
const semTags = (s: string) => desHtml(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
/** Lê as linhas de produto da página do catálogo. Devolve { id, descricao, marca, codigo, semEstoque } por linha. */
export function pellegrinoLerPagina(html: string): { id: string; descricao: string; marca: string; codigo: string; semEstoque: boolean; foto: string }[] {
  const out: { id: string; descricao: string; marca: string; codigo: string; semEstoque: boolean; foto: string }[] = [];
  const re = /<tr[^>]*data-objectid="([^"]+)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = m[1], tr = m[2];
    const codigo = (/data-original-title="([^"]+)"/.exec(tr) || /title="([^"]{2,40})"[^>]*data-toggle="popover"/.exec(tr) || [])[1] || "";
    const descricao = (/font-weight-bold[^>]*>([^<]{3,120})</.exec(tr) || [])[1] || "";
    const marca = (/<span class="d-none">([^<]{2,40})<\/span>\s*<img/.exec(tr) || [])[1] || "";
    const semEstoque = /avise quando estiver dispon/i.test(tr);
    const foto = fotoOk(desHtml((/<img[^>]+(?:data-src|src)="(https:\/\/[^"]+\.(?:jpe?g|png|webp)[^"]*)"/i.exec(tr) || [])[1] || ""));
    if (id && (codigo || descricao)) out.push({ id, descricao: txt(descricao), marca: txt(marca), codigo: txt(desHtml(codigo)), semEstoque, foto });
  }
  return out;
}
export function pellegrinoLerPrecos(corpo: Json | null): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of corpo && Array.isArray(corpo.precos) ? corpo.precos : []) m.set(String(p.id), numero(p.preco_com_imposto ?? p.preco));
  return m;
}
async function pellegrinoBuscar(deps: Deps, s: Sessao, termo: string): Promise<Oferta[]> {
  const site = String(s.site || PELLEGRINO.site);
  const r = await pedir(deps, site + "/catalogo/ais?q=" + encodeURIComponent(termo), { headers: pellHeaders(s, { accept: "text/html" }) });
  if (r.status === 302 || r.status === 301 || r.status === 401) throw new ErroAcesso("sessão vencida");
  if (!r.ok) throw new Error("Pellegrino: a busca falhou (HTTP " + r.status + ").");
  const html = await r.text();
  if (/Account\/Login|id="kt_login_signin_submit"/.test(html)) throw new ErroAcesso("sessão vencida");
  if (deps.amostra) deps.amostra(amostraHtml(html));
  const linhas = pellegrinoLerPagina(html).slice(0, 25);
  if (!linhas.length) return [];
  const rp = await pedir(deps, site + "/api/progress/b2b/produtos/precos?ids=" + encodeURIComponent(linhas.map((l) => l.id).join(",")), { headers: pellHeaders(s) });
  const precos = rp.ok ? pellegrinoLerPrecos(await rp.json().catch(() => null)) : new Map<string, number>();
  return linhas.map((l) => { const p = precos.get(l.id); if (!(p && p > 0)) return null;
    return { codigo: l.codigo || l.id, marca: l.marca, descricao: l.descricao, preco: p, estoque: l.semEstoque ? 0 : null, prazo: "", aplicacao: "", ref: l.id, foto: l.foto } as Oferta; }).filter((x): x is Oferta => !!x);
}

/** Trecho da página de resultado (só a tabela de produtos, até 6 KB) para o administrador afinar o leitor quando o portal mudar */
export function amostraHtml(html: string): string {
  const i = html.indexOf("data-objectid"); const j = html.search(/<table|<tbody|class="[^"]*(produto|product|catalogo)[^"]*"/i);
  const ini = i >= 0 ? Math.max(0, i - 400) : j >= 0 ? j : 0;
  return html.slice(ini, ini + 6000).replace(/\s+/g, " ");
}

/* ======================================================================================================================
 * Orquestração
 * ====================================================================================================================== */
type Resultado = { conexao: string; fornecedor_id: string; robo: Robo | null; nome: string; ok: boolean; ofertas: Oferta[]; erro?: string; gravadas?: number; em?: string; no_pc?: boolean };

async function comSessao(deps: Deps, c: Conexao, robo: Robo, cnpjOficina: string, usar: (s: Sessao) => Promise<Oferta[]>): Promise<Oferta[]> {
  const senha = await deps.senha(c.id);
  if (!senha) throw new ErroAcesso("Sem senha guardada: cadastre a senha em Ajustes › Fornecedores conectados.");
  if (!c.usuario) throw new ErroAcesso("Sem usuário: informe o login do fornecedor em Ajustes.");
  const anterior = await deps.lerSessao(c.id);
  const login = () => robo === "dpk" ? dpkLogin(deps, c, senha, cnpjOficina, String((anterior && anterior.apiKey) || "")) : robo === "rolemar" ? rolemarLogin(deps, c, senha) : pellegrinoLogin(deps, c, senha);
  let s = anterior && anterior.token || anterior && anterior.cookies ? anterior : null, nova = false;
  if (!s) { s = await login(); await deps.gravarSessao(c.id, s); nova = true; }
  try { return await usar(s); }
  catch (e) {
    if (!(e instanceof ErroAcesso)) throw e;
    // sessão guardada vencida: entra de novo UMA vez; sessão recém-aberta que já falhou não repete o login (o portal mudou ou bloqueou)
    if (nova) throw new Error(NOME_ROBO[robo] + ": entrou, mas a busca foi recusada logo em seguida (" + e.message + "). Tente de novo mais tarde.");
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
    const idc = String(corpo.conexao || "");
    if (!/^[\w-]{1,64}$/.test(idc)) throw new ErroUso("Fornecedor conectado não encontrado.");
    const [c] = await deps.conexoes([idc]);
    if (!c) throw new ErroUso("Fornecedor conectado não encontrado.");
    const robo = roboDe(c);
    if (!robo) { await deps.situacao(c.id, "erro", "Portal não reconhecido pelo endereço: use o endereço do site do fornecedor (DPK, Rolemar, Pellegrino ou Toli)."); return { ok: false, erro: "Portal não reconhecido pelo endereço.", robo: null }; }
    if (robo === "toli") { await deps.situacao(c.id, "aguardando", "Portal Toli: a consulta roda pelo programa do PC da oficina (em preparação)."); return { ok: true, robo, no_pc: true, nome: NOME_ROBO[robo] }; }
    try {
      const velha = await deps.lerSessao(c.id);
      await deps.gravarSessao(c.id, velha && velha.apiKey ? { apiKey: velha.apiKey } : null);   // teste = login novo de verdade (a chave pública da DPK pode ficar)
      let amostra = "";
      const d2: Deps = corpo.amostra === true ? { ...deps, amostra: (t) => { amostra = t; } } : deps;
      const ofertas = await comSessao(d2, c, robo, cnpjOficina, (s) => buscar(d2, robo, s, String(corpo.termo || "WK84213")));
      await deps.situacao(c.id, "ok", "Conectado em " + horaBR(agora) + " (teste: " + ofertas.length + " preço(s)).");
      return { ok: true, robo, nome: NOME_ROBO[robo], ofertas: ofertas.slice(0, 10), ...(amostra ? { amostra } : {}) };
    } catch (e) {
      const msg = (e as Error).message || "falha";
      await deps.situacao(c.id, "erro", msg); await deps.gravarSessao(c.id, null);
      return { ok: false, robo, nome: NOME_ROBO[robo], erro: msg };
    }
  }
  if (acao === "placa") {
    // modelo do carro pela placa, pelos portais com login (DPK e Rolemar: consulta grátis), para a aba Compras não gastar a consulta paga
    const placa = txt(corpo.placa).toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!/^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(placa)) throw new ErroUso("Placa inválida. Use o formato ABC1234 ou ABC1D23.");
    const cxs = (await deps.conexoes(null)).filter((c) => c.ativo !== false);
    for (const robo of ["dpk", "rolemar"] as Robo[]) {
      const c = cxs.find((x) => roboDe(x) === robo);
      if (!c) continue;
      try {
        let modelo = "";
        await comSessao(deps, c, robo, cnpjOficina, async (s) => { modelo = robo === "dpk" ? await dpkPlaca(deps, s, placa) : await rolemarPlaca(deps, s, placa); return []; });
        if (modelo) return { ok: true, encontrado: true, placa, modelo, fornecedor: NOME_ROBO[robo] };
      } catch (_e) { /* tenta o próximo portal; sem portal, a tela usa a consulta de placa de sempre */ }
    }
    return { ok: true, encontrado: false, placa };
  }
  if (acao === "carrinho_portal") {
    // põe o item TAMBÉM no carrinho do portal do fornecedor (pedido do Danilo em 17/11/2026: ao clicar "Adicionar", a peça aparece no site dele)
    const idc = String(corpo.conexao || "");
    if (!/^[\w-]{1,64}$/.test(idc)) throw new ErroUso("Fornecedor conectado não encontrado.");
    const [c] = await deps.conexoes([idc]);
    if (!c) throw new ErroUso("Fornecedor conectado não encontrado.");
    const robo = roboDe(c);
    const it = (corpo.item || {}) as Json;
    const item: ItemPortal = { codigo: txt(it.codigo).slice(0, 60), descricao: txt(it.descricao).slice(0, 200), marca: txt(it.marca).slice(0, 60), qtd: Number(it.qtd) || 1, preco: Number(it.preco) || 0, extra: it.extra && typeof it.extra === "object" ? it.extra : undefined };
    if (!item.codigo) throw new ErroUso("Informe o código da peça.");
    if (robo !== "dpk") return { ok: false, robo, nome: robo ? NOME_ROBO[robo] : "", erro: (robo ? NOME_ROBO[robo] : "Este portal") + ": pôr no carrinho do portal ainda não está pronto; o item ficou só no carrinho do sistema." };
    // uma inclusão por vez no carrinho de cada conexão (ler → somar → gravar), mesmo vindo de aparelhos diferentes
    let dono: string | null = deps.travar ? null : "sem-trava";
    for (let n = 0; !dono && n < 20; n++) { dono = await deps.travar!(c.id); if (!dono) await (deps.esperar || ((ms) => new Promise((r) => setTimeout(r, ms))))(500); }
    const aindaMinha = async () => !deps.renovar || dono === "sem-trava" || await deps.renovar(c.id, dono!);
    if (!dono) return { ok: false, robo, nome: NOME_ROBO[robo], erro: NOME_ROBO[robo] + ": outra inclusão no carrinho do portal está em andamento; tente de novo em alguns segundos. O item ficou no carrinho do sistema." };
    try {
      let res = { ok: false, detalhe: "" };
      await comSessao(deps, c, robo, cnpjOficina, async (s) => { res = await dpkCarrinho(deps, s, item, aindaMinha); return []; });
      return { ok: res.ok, robo, nome: NOME_ROBO[robo], detalhe: res.detalhe, erro: res.ok ? undefined : res.detalhe };
    } catch (e) {
      const msg = (e as Error).message || "falha";
      if (e instanceof ErroAcesso) { await deps.situacao(c.id, "erro", msg); const v = await deps.lerSessao(c.id); await deps.gravarSessao(c.id, v && v.apiKey ? { apiKey: v.apiKey } : null); }
      return { ok: false, robo, nome: NOME_ROBO[robo], erro: msg };
    } finally { if (deps.destravar && dono && dono !== "sem-trava") await deps.destravar(c.id, dono).catch(() => {}); }
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
      await deps.situacao(c.id, "ok", "Última consulta " + horaBR(agora) + " (" + ofertas.length + " preço(s)).");
      return { ...base, ok: true, ofertas, gravadas, em };
    } catch (e) {
      const msg = (e as Error).message || "falha";
      await deps.situacao(c.id, "erro", msg);
      if (e instanceof ErroAcesso) { const v = await deps.lerSessao(c.id); await deps.gravarSessao(c.id, v && v.apiKey ? { apiKey: v.apiKey } : null); }
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
    // trava em segredos: valor = "<hora em ms>|<dono>"; esquecida (função caiu no meio) por mais de PRAZO é tomada por outra chamada
    travar: async (id) => {
      const k = chave("compras_trava", id), agora = Date.now(), dono = crypto.randomUUID();
      const { error } = await adm.from("segredos").insert({ chave: k, valor: agora + "|" + dono, atualizado_em: new Date(agora).toISOString() });
      if (!error) return dono;
      const { data } = await adm.from("segredos").select("valor").eq("chave", k).maybeSingle();
      if (!data) return null;
      const desde = Number(String(data.valor).split("|")[0]) || 0;
      if (agora - desde < PRAZO_TRAVA_MS) return null;
      const { data: tomada } = await adm.from("segredos").update({ valor: agora + "|" + dono, atualizado_em: new Date(agora).toISOString() }).eq("chave", k).eq("valor", data.valor).select("chave");
      return Array.isArray(tomada) && tomada.length === 1 ? dono : null;
    },
    renovar: async (id, dono) => {
      const k = chave("compras_trava", id), agora = Date.now();
      const { data } = await adm.from("segredos").select("valor").eq("chave", k).maybeSingle();
      if (!data || String(data.valor).split("|")[1] !== dono) return false;
      const { data: ok } = await adm.from("segredos").update({ valor: agora + "|" + dono, atualizado_em: new Date(agora).toISOString() }).eq("chave", k).eq("valor", data.valor).select("chave");
      return Array.isArray(ok) && ok.length === 1;
    },
    destravar: async (id, dono) => { await adm.from("segredos").delete().eq("chave", chave("compras_trava", id)).like("valor", "%|" + dono); },
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
