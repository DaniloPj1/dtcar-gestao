// Teste da função "sicredi" (API de Cobrança) sem rede: um Sicredi falso responde como a documentação v3.9.1.
// Rodar: deno run -A teste/teste_sicredi.ts
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, x = "") => (c ? ok : falhas).push(n + (x ? " (" + x + ")" : ""));
Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { corpoBoleto, erroDoSicredi, clienteSicredi, executar, carteiraProducao, TESTE_SANDBOX, atender } = await import("../supabase/functions/sicredi/index.ts");

// ---------- corpo do boleto
const b = { valor: 450.5, vencimento: "2026-12-10", seu_numero: "1897-1", especie: "05", juros_mes: 2, multa: 2, mensagem: "Obrigado pela preferência",
  pagador: { nome: "José da Conceição Ltda", doc: "49.016.409/0001-95", endereco: "Rua das Flores, 100", cidade: "Colatina", uf: "es", cep: "29700-000", telefone: "(27) 99999-0000" } };
const c = corpoBoleto(b, "85453") as Record<string, any>;
confere("híbrido", c.tipoCobranca === "HIBRIDO");
confere("sem data de início de juros/multa (senão perde o QR)", !("dataInicioJuros" in c) && !("dataInicioMulta" in c));
confere("juros percentual mensal", c.tipoJuros === "B - PERCENTUAL" && c.tipoJurosPercentual === "MENSAL" && c.juros === 2);
confere("multa percentual", c.tipoMulta === "B - PERCENTUAL" && c.multa === 2);
confere("espécie DSI", c.especieDocumento === "DUPLICATA_SERVICO_INDICACAO");
confere("pagador PJ sem acento e só dígitos", c.pagador.tipoPessoa === "PESSOA_JURIDICA" && c.pagador.documento === "49016409000195" && c.pagador.nome === "JOSE DA CONCEICAO LTDA"
  && c.pagador.uf === "ES" && c.pagador.cep === "29700000" && c.pagador.telefone === "27999990000");
confere("beneficiário com 5 dígitos e seu número até 10", c.codigoBeneficiario === "85453" && c.seuNumero === "1897-1");
confere("mensagem em maiúsculas", c.mensagens[0] === "OBRIGADO PELA PREFERENCIA");
const semJuros = corpoBoleto({ ...b, juros_mes: 0, multa: 0, especie: "xx" }, "123") as Record<string, any>;
confere("sem juros nem multa: campos fora; espécie desconhecida vira DMI; beneficiário com zeros", !("tipoJuros" in semJuros) && !("tipoMulta" in semJuros)
  && semJuros.especieDocumento === "DUPLICATA_MERCANTIL_INDICACAO" && semJuros.codigoBeneficiario === "00123");
let erro = ""; try { corpoBoleto({ ...b, pagador: { ...b.pagador, doc: "123" }, valor: 0 }, "85453"); } catch (e) { erro = (e as Error).message; }
confere("boleto incompleto recusado antes de ir ao banco", /valor/.test(erro) && /CPF\/CNPJ/.test(erro));
confere("erro do Sicredi traduzido", /chave ou o código de acesso/.test(erroDoSicredi(401, { error: "unauthorized" })) && /CEP inválido/.test(erroDoSicredi(422, { message: "CEP inválido" })));

// ---------- Sicredi falso
const chamadas: Array<{ metodo: string; url: string; h: Record<string, string>; corpo: string }> = [];
let tokensPedidos = 0, refreshs = 0, expira = 300;
const falso = async (url: string | URL | Request, init: RequestInit = {}) => {
  const u = new URL(String(url)), h = Object.fromEntries(Object.entries((init.headers || {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
  chamadas.push({ metodo: init.method || "GET", url: u.toString(), h, corpo: String(init.body || "") });
  const r = (s: number, j: unknown) => new Response(typeof j === "string" ? j : JSON.stringify(j), { status: s, headers: { "content-type": "application/json" } });
  if (!u.pathname.startsWith("/sb/") && !u.pathname.startsWith("/auth/") && !u.pathname.startsWith("/cobranca/")) return r(404, { message: "rota" });
  if (h["x-api-key"] !== "chave-certa") return r(401, { error: "invalid api key" });
  if (u.pathname.endsWith("/auth/openapi/token")) {
    const p = new URLSearchParams(String(init.body));
    if (h.context !== "COBRANCA" || h["content-type"] !== "application/x-www-form-urlencoded") return r(400, { error: "cabecalho" });
    if (p.get("grant_type") === "refresh_token") { refreshs++; return r(200, { access_token: "A" + (++tokensPedidos), refresh_token: "R", expires_in: expira, refresh_expires_in: 1800, scope: "cobranca" }); }
    if (p.get("username") !== "123456789" || p.get("password") !== "teste123" || p.get("scope") !== "cobranca") return r(401, { error_description: "Invalid user credentials" });
    tokensPedidos++; return r(200, { access_token: "A" + tokensPedidos, refresh_token: "R", expires_in: expira, refresh_expires_in: 1800, scope: "cobranca profile email" });
  }
  if (!/^Bearer A\d+$/.test(h.authorization || "")) return r(401, { message: "token" });
  if (h.cooperativa !== "6789" || h.posto !== "03") return r(400, { message: "cooperativa/posto" });
  if (u.pathname.endsWith("/cobranca/boleto/v1/boletos") && init.method === "POST") {
    const j = JSON.parse(String(init.body));
    if (j.codigoBeneficiario !== "12345") return r(422, { message: "beneficiário" });
    return r(201, { txid: "f69d2a00", qrCode: "000201010212...6304E5E1", linhaDigitavel: "74891125110061420512803153351030188640000009990", codigoBarras: "74891886400000099901125100614205120315335103", cooperativa: "6789", posto: "03", nossoNumero: "251006142" });
  }
  if (u.pathname.endsWith("/cobranca/boleto/v1/boletos") && (init.method || "GET") === "GET") return r(200, { nossoNumero: u.searchParams.get("nossoNumero"), situacao: "EM CARTEIRA PIX" });
  if (u.pathname.endsWith("/boletos/pdf")) return new Response(new Uint8Array(2048), { status: 201, headers: { "content-type": "application/octet-stream" } });
  if (u.pathname.endsWith("/baixa")) return h.codigobeneficiario === "12345" ? r(202, { statusComando: "MOVIMENTO_ENVIADO" }) : r(400, { message: "beneficiario" });
  if (u.pathname.endsWith("/liquidados/dia")) { const p = Number(u.searchParams.get("pagina")); return r(200, { items: [{ nossoNumero: "25100614" + p, valorLiquidado: 10, tipoLiquidacao: "PIX" }], hasNext: p < 1 }); }
  return r(404, { message: "não achei" });
};
const env = (m: Record<string, string>) => (k: string) => m[k];

const t = await executar({ acao: "teste_completo" }, "sandbox", null, env({ SICREDI_API_KEY_SANDBOX: "chave-certa" }), falso as typeof fetch);
confere("teste completo no Sandbox: todos os passos ok", t.ok === true && t.passos.length === 5, JSON.stringify(t.passos.filter((p: any) => !p.ok)));
confere("teste completo: boleto com QR Code", /com QR Code/.test(t.passos[1].detalhe));
confere("um token só para todos os passos", tokensPedidos === 1, String(tokensPedidos));
const post = chamadas.find((x) => x.metodo === "POST" && x.url.endsWith("/sb/cobranca/boleto/v1/boletos"))!;
confere("emitir: URL do Sandbox e cabeçalhos", !!post && post.h.cooperativa === "6789" && post.h.posto === "03" && post.h["content-type"] === "application/json");
const tk = chamadas.find((x) => x.url.endsWith("/sb/auth/openapi/token"))!;
confere("token: usuário e senha de teste do Sicredi", /username=123456789/.test(tk.corpo) && /password=teste123/.test(tk.corpo) && /scope=cobranca/.test(tk.corpo));
const lq = await executar({ acao: "liquidados", dia: "2026-11-05" }, "sandbox", null, env({ SICREDI_API_KEY_SANDBOX: "chave-certa" }), falso as typeof fetch);
confere("liquidados: junta as páginas e manda o dia DD/MM/AAAA", lq.itens.length === 2 && chamadas.some((x) => x.url.includes("dia=05%2F11%2F2026")));
const pdf = await executar({ acao: "pdf", linha: "74891.12511 00614.205128" }, "sandbox", null, env({ SICREDI_API_KEY_SANDBOX: "chave-certa" }), falso as typeof fetch);
confere("PDF volta em base64", typeof pdf.pdf === "string" && atob(pdf.pdf).length === 2048);

// chave errada / faltando
let e1 = ""; try { await executar({ acao: "testar" }, "sandbox", null, env({ SICREDI_API_KEY_SANDBOX: "chave-errada" }), falso as typeof fetch); } catch (e) { e1 = (e as Error).message; }
confere("chave errada: mensagem clara", /não aceitou a chave/.test(e1), e1);
let e2 = ""; try { await executar({ acao: "testar" }, "sandbox", null, env({}), falso as typeof fetch); } catch (e) { e2 = (e as Error).message; }
confere("sem chave: diz qual segredo falta", /SICREDI_API_KEY_SANDBOX/.test(e2));

// produção: carteira da oficina + código de acesso; nunca teste completo
let e3 = ""; try { await executar({ acao: "testar" }, "producao", { cobranca: {} }, env({ SICREDI_API_KEY: "x" }), falso as typeof fetch); } catch (e) { e3 = (e as Error).message; }
confere("produção sem código de acesso: pede para gerar", /SICREDI_CODIGO_ACESSO/.test(e3));
const cp = carteiraProducao({ cobranca: { cooperativa: "523", posto: "16", beneficiario: "85453" } }, "codigo");
confere("produção: usuário = beneficiário + cooperativa", cp.usuario === "854530523" && cp.cooperativa === "0523" && cp.posto === "16");
let e4 = ""; try { await executar({ acao: "teste_completo" }, "producao", { cobranca: {} }, env({ SICREDI_API_KEY: "x", SICREDI_CODIGO_ACESSO: "y" }), falso as typeof fetch); } catch (e) { e4 = (e as Error).message; }
confere("teste completo recusado em produção (não emite boleto real de teste)", /só roda no Sandbox/.test(e4));
const chamProd = chamadas.length;
const urlsProd: string[] = [];
const espiao = (async (u: any, i: any) => { urlsProd.push(String(u)); return new Response(JSON.stringify({ access_token: "A1", expires_in: 300 }), { status: 200 }); }) as typeof fetch;
await executar({ acao: "testar" }, "producao", { cobranca: {} }, env({ SICREDI_API_KEY: "x", SICREDI_CODIGO_ACESSO: "y" }), espiao);
confere("produção usa a URL sem /sb", urlsProd[0] === "https://api-parceiro.sicredi.com.br/auth/openapi/token" && chamadas.length === chamProd);

// renovação: token vencido usa o refresh, sem mandar usuário e senha de novo
expira = 20; tokensPedidos = 0; refreshs = 0;
const cli = clienteSicredi("sandbox", "chave-certa", TESTE_SANDBOX, falso as typeof fetch);
await cli.consultar("251006142"); await cli.consultar("251006142");
confere("token que vence logo é renovado pelo refresh", refreshs >= 1, "refresh=" + refreshs);
expira = 300;

// sem login: 401
const r = await atender(new Request("http://x/", { method: "POST", body: "{}" }));
confere("sem login: recusa", r.status === 401 || r.status === 403, String(r.status));

console.log("OK", ok.length); console.log("FALHAS", falhas);
Deno.exit(falhas.length ? 1 : 0);
