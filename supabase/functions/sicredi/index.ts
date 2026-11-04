// DTCar Gestão — função "sicredi": API de Cobrança do Sicredi (boleto híbrido: boleto + QR Code Pix).
// Referência: API de Cobrança Sicredi v3.9.1 (https://developers.sicredi.com.br/public/docs/getting-started-billing).
//
// Ações (POST com { acao, ambiente, ... }):
//   testar      — pede o token ao Sicredi (prova que a chave e o código de acesso estão certos)
//   teste_completo — SÓ no Sandbox: emite um boleto de teste, consulta, baixa o PDF e pede a baixa (nada é gravado)
//   emitir      — registra um boleto { boleto: { valor, vencimento, seu_numero, especie, pagador, juros_mes, multa, mensagem } }
//   consultar   — situação de um boleto { nosso_numero }
//   liquidados  — boletos pagos num dia { dia: "AAAA-MM-DD" }
//   pdf         — PDF do boleto { linha } (volta em base64)
//   baixar      — pede a baixa { nosso_numero }
//
// Segredos (Supabase › Edge Functions › Secrets; nunca no repositório):
//   SICREDI_API_KEY_SANDBOX  token do Sandbox (Portal do Desenvolvedor › Minhas Apps › Tokens de acesso)
//   SICREDI_API_KEY          token de Produção
//   SICREDI_CODIGO_ACESSO    código de acesso do internet banking (Cobrança › Código de Acesso › Gerar)
// No Sandbox o usuário, a senha, a cooperativa, o posto e o beneficiário são os de teste do próprio Sicredi (fixos).
// Em Produção vêm da carteira (cfg.cobranca: cooperativa, posto, beneficiário) + SICREDI_CODIGO_ACESSO.
//
// Só o administrador (token do usuário, conferido aqui). Publicar com "Verify JWT" desligado (a função confere o login).
import { withSupabase } from "npm:@supabase/server@1.9.2";

type Ambiente = "sandbox" | "producao";
export type Carteira = { cooperativa: string; posto: string; beneficiario: string; usuario: string; senha: string };

export const BASE: Record<Ambiente, string> = { sandbox: "https://api-parceiro.sicredi.com.br/sb", producao: "https://api-parceiro.sicredi.com.br" };
export const TESTE_SANDBOX: Carteira = { usuario: "123456789", senha: "teste123", cooperativa: "6789", posto: "03", beneficiario: "12345" };
const CHAVE: Record<Ambiente, string> = { sandbox: "SICREDI_API_KEY_SANDBOX", producao: "SICREDI_API_KEY" };
const LIMITE_MS = 25000;

const json = (corpo: unknown, status = 200) => Response.json(corpo, { status });
const so = (s: unknown) => String(s ?? "").replace(/\D/g, "");
/** Texto aceito pelo banco: sem acento, maiúsculas, sem símbolos estranhos, no tamanho do campo */
export const texto = (s: unknown, max: number) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase()
  .replace(/[^A-Z0-9 .,\-/&]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

/** Espécie do título: o código do CNAB (cfg.cobranca.especie) vira o nome da API */
export const ESPECIE: Record<string, string> = { "03": "DUPLICATA_MERCANTIL_INDICACAO", "05": "DUPLICATA_SERVICO_INDICACAO", "12": "NOTA_PROMISSORIA",
  "17": "RECIBO", "19": "NOTA_DEBITO", "99": "OUTROS" };

export type BoletoEntrada = { valor: number; vencimento: string; seu_numero: string; especie?: string; juros_mes?: number; multa?: number; mensagem?: string;
  id_titulo?: string; pagador: { nome: string; doc: string; endereco?: string; cidade?: string; uf?: string; cep?: string; email?: string; telefone?: string } };

/** Monta o corpo do POST /boletos. Tipos "PERCENTUAL" (o Sicredi recusa "B - PERCENTUAL"). Juros e multa SEM data de início: com data, o Sicredi tira o QR Code sem avisar. */
export function corpoBoleto(b: BoletoEntrada, beneficiario: string) {
  const erros: string[] = [];
  const doc = so(b.pagador?.doc), valor = Math.round(Number(b.valor) * 100) / 100;
  if (!(valor > 0)) erros.push("valor");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(b.vencimento || ""))) erros.push("vencimento");
  if (![11, 14].includes(doc.length)) erros.push("CPF/CNPJ do cliente");
  if (!texto(b.pagador?.nome, 40)) erros.push("nome do cliente");
  const seu = String(b.seu_numero || "").replace(/\s/g, "").slice(0, 10);
  if (!seu) erros.push("seu número");
  if (erros.length) throw new Error("Boleto incompleto: falta " + erros.join(", ") + ".");
  const pg: Record<string, string> = { tipoPessoa: doc.length === 14 ? "PESSOA_JURIDICA" : "PESSOA_FISICA", documento: doc, nome: texto(b.pagador.nome, 40) };
  const end = texto(b.pagador.endereco, 40), cid = texto(b.pagador.cidade, 40), uf = texto(b.pagador.uf, 2), cep = so(b.pagador.cep);
  if (end) pg.endereco = end;
  if (cid) pg.cidade = cid;
  if (/^[A-Z]{2}$/.test(uf)) pg.uf = uf;
  if (cep.length === 8) pg.cep = cep;
  const tel = so(b.pagador.telefone); if (tel.length >= 10 && tel.length <= 11) pg.telefone = tel;
  const corpo: Record<string, unknown> = { codigoBeneficiario: so(beneficiario).padStart(5, "0"), dataVencimento: b.vencimento,
    especieDocumento: ESPECIE[String(b.especie || "03")] || "DUPLICATA_MERCANTIL_INDICACAO", tipoCobranca: "HIBRIDO", seuNumero: seu, valor, pagador: pg };
  if (b.id_titulo) corpo.idTituloEmpresa = String(b.id_titulo).slice(0, 25);
  const juros = Number(b.juros_mes || 0), multa = Number(b.multa || 0);
  if (juros > 0) { corpo.tipoJuros = "PERCENTUAL"; corpo.tipoJurosPercentual = "MENSAL"; corpo.juros = juros; }
  if (multa > 0) { corpo.tipoMulta = "PERCENTUAL"; corpo.multa = multa; }
  const msg = texto(b.mensagem, 80); if (msg) corpo.mensagens = [msg];
  return corpo;
}

/** Mensagem do Sicredi em português para a tela */
export function erroDoSicredi(status: number, corpo: unknown): string {
  const c = corpo as Record<string, unknown> | null;
  const partes: string[] = [];
  const add = (x: unknown) => { if (x && typeof x === "string" && !partes.includes(x)) partes.push(x); };
  if (c && typeof c === "object") {
    add(c.message); add(c.mensagem); add(c.detail); add(c.error_description); add(c.title);
    const lista = (c.errors || c.erros || c.details) as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(lista)) for (const e of lista.slice(0, 5)) add([e.field || e.campo, e.message || e.mensagem || e.detail].filter(Boolean).join(": "));
    if (!partes.length) add(c.error as string);
    if (!partes.length) add(JSON.stringify(c).slice(0, 300));
  } else if (typeof corpo === "string") add(corpo.slice(0, 200));
  const base = ({ 400: "Pedido recusado pelo Sicredi", 401: "O Sicredi não aceitou a chave ou o código de acesso", 403: "Acesso negado pelo Sicredi",
    404: "Endereço não encontrado no Sicredi", 415: "Formato recusado", 422: "Regra do Sicredi não atendida", 429: "Muitos pedidos seguidos ao Sicredi; tente de novo em instantes",
    504: "O Sicredi demorou para responder" } as Record<number, string>)[status] || "Erro " + status + " no Sicredi";
  return base + (partes.length ? ": " + partes.join(" · ") : ".");
}

/** Cliente da API (a função fetch entra como parâmetro para o teste) */
export function clienteSicredi(amb: Ambiente, apiKey: string, cart: Carteira, buscar: typeof fetch = fetch) {
  const base = BASE[amb];
  let tok: { access: string; refresh: string; ate: number; refreshAte: number } | null = null;
  const comLimite = async (url: string, init: RequestInit) => {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), LIMITE_MS);
    try { return await buscar(url, { ...init, signal: ctrl.signal }); }
    catch (e) { throw new Error((e as Error).name === "AbortError" ? "O Sicredi não respondeu em " + LIMITE_MS / 1000 + " s." : "Sem conexão com o Sicredi: " + (e as Error).message); }
    finally { clearTimeout(t); }
  };
  const lerCorpo = async (r: Response) => { const t = await r.text(); try { return t ? JSON.parse(t) : null; } catch { return t; } };
  async function pedirToken(campos: Record<string, string>) {
    const r = await comLimite(base + "/auth/openapi/token", { method: "POST",
      headers: { "x-api-key": apiKey, context: "COBRANCA", "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(campos).toString() });
    const c = await lerCorpo(r);
    if (!r.ok) throw new Error(erroDoSicredi(r.status, c));
    const agora = Date.now(), j = c as Record<string, unknown>;
    tok = { access: String(j.access_token), refresh: String(j.refresh_token || ""), ate: agora + (Number(j.expires_in || 300) - 20) * 1000,
      refreshAte: agora + (Number(j.refresh_expires_in || 1800) - 20) * 1000 };
    return j;
  }
  async function token() {
    const agora = Date.now();
    if (tok && agora < tok.ate) return tok.access;
    if (tok && tok.refresh && agora < tok.refreshAte) { try { await pedirToken({ grant_type: "refresh_token", refresh_token: tok.refresh }); return tok!.access; } catch { tok = null; } }
    await pedirToken({ grant_type: "password", username: cart.usuario, password: cart.senha, scope: "cobranca" });
    return tok!.access;
  }
  async function chamar(metodo: string, caminho: string, opc: { corpo?: unknown; consulta?: Record<string, string>; cabecalhos?: Record<string, string>; binario?: boolean } = {}) {
    const url = new URL(base + caminho); for (const [k, v] of Object.entries(opc.consulta || {})) url.searchParams.set(k, v);
    const headers: Record<string, string> = { "x-api-key": apiKey, Authorization: "Bearer " + await token(), "Content-Type": "application/json",
      cooperativa: cart.cooperativa, posto: cart.posto, ...(opc.cabecalhos || {}) };
    const r = await comLimite(url.toString(), { method: metodo, headers, body: opc.corpo !== undefined ? JSON.stringify(opc.corpo) : undefined });
    if (opc.binario && r.ok) return new Uint8Array(await r.arrayBuffer());
    const c = await lerCorpo(r);
    if (!r.ok) throw new Error(erroDoSicredi(r.status, c));
    return c;
  }
  return {
    testar: async () => { const t = await pedirToken({ grant_type: "password", username: cart.usuario, password: cart.senha, scope: "cobranca" }); return { escopo: t.scope, expira_s: t.expires_in }; },
    emitir: (b: BoletoEntrada) => chamar("POST", "/cobranca/boleto/v1/boletos", { corpo: corpoBoleto(b, cart.beneficiario) }),
    consultar: (nn: string) => chamar("GET", "/cobranca/boleto/v1/boletos", { consulta: { codigoBeneficiario: cart.beneficiario, nossoNumero: so(nn) } }),
    liquidados: async (diaIso: string) => {
      const [a, m, d] = diaIso.split("-"), itens: unknown[] = [];
      for (let pagina = 0; pagina < 20; pagina++) {
        const r = await chamar("GET", "/cobranca/boleto/v1/boletos/liquidados/dia", { consulta: { codigoBeneficiario: cart.beneficiario, dia: d + "/" + m + "/" + a, pagina: String(pagina) } }) as { items?: unknown[]; hasNext?: boolean };
        itens.push(...(r?.items || []));
        if (!r?.hasNext) break;
      }
      return itens;
    },
    pdf: (linha: string) => chamar("GET", "/cobranca/boleto/v1/boletos/pdf", { consulta: { linhaDigitavel: so(linha) }, binario: true }) as Promise<Uint8Array>,
    baixar: (nn: string) => chamar("PATCH", "/cobranca/boleto/v1/boletos/" + so(nn) + "/baixa", { corpo: {}, cabecalhos: { codigoBeneficiario: cart.beneficiario } }),
  };
}

const paraBase64 = (b: Uint8Array) => { let s = ""; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };

/** Teste completo no Sandbox: emitir → consultar → PDF → baixa. Devolve cada passo. */
export async function testeCompleto(cli: ReturnType<typeof clienteSicredi>) {
  const passos: Array<{ passo: string; ok: boolean; detalhe: string }> = [];
  const passo = async (nome: string, f: () => Promise<string>) => { try { passos.push({ passo: nome, ok: true, detalhe: await f() }); return true; } catch (e) { passos.push({ passo: nome, ok: false, detalhe: (e as Error).message }); return false; } };
  const venc = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  let emitido: Record<string, string> = {};
  if (!await passo("Entrar no Sicredi (token)", async () => { const t = await cli.testar(); return "Token recebido (vale " + t.expira_s + " s)."; })) return passos;
  if (!await passo("Emitir boleto de teste (R$ 1,00, com Pix)", async () => {
    emitido = await cli.emitir({ valor: 1, vencimento: venc, seu_numero: "TESTE" + String(Date.now()).slice(-5), especie: "03",
      pagador: { nome: "CLIENTE TESTE DTCAR", doc: "02738306004", endereco: "RUA DOUTOR VARGAS 150", cidade: "PORTO ALEGRE", uf: "RS", cep: "91250000" } }) as Record<string, string>;
    return "Nosso número " + emitido.nossoNumero + (emitido.qrCode ? ", com QR Code Pix" : ", SEM QR Code") + ".";
  })) return passos;
  await passo("Consultar o boleto", async () => { const c = await cli.consultar(emitido.nossoNumero) as Record<string, unknown>; return "Situação: " + (c?.situacao || "?") + "."; });
  await passo("Baixar o PDF do banco", async () => { const p = await cli.pdf(emitido.linhaDigitavel); return "PDF com " + Math.round(p.length / 1024) + " KB."; });
  await passo("Pedir a baixa", async () => { const b = await cli.baixar(emitido.nossoNumero) as Record<string, unknown>; return "Pedido aceito (" + (b?.statusComando || "recebido") + ")."; });
  return passos;
}

/** Carteira de produção a partir dos ajustes do sistema (cfg.cobranca) e do código de acesso */
export function carteiraProducao(cfg: Record<string, unknown> | null, codigo: string | undefined): Carteira {
  const cob = ((cfg || {}).cobranca || {}) as Record<string, unknown>;
  const cooperativa = so(cob.cooperativa || "0523").padStart(4, "0"), posto = so(cob.posto || "16").padStart(2, "0"), beneficiario = so(cob.beneficiario || "85453").padStart(5, "0");
  if (!codigo) throw new Error("Falta o código de acesso: gere no internet banking (Cobrança › Código de Acesso) e grave no Supabase como SICREDI_CODIGO_ACESSO.");
  return { cooperativa, posto, beneficiario, usuario: beneficiario + cooperativa, senha: codigo };
}

export async function executar(corpo: Record<string, unknown>, ambiente: Ambiente, cfg: Record<string, unknown> | null, env: (k: string) => string | undefined, buscar: typeof fetch = fetch) {
  const apiKey = env(CHAVE[ambiente]);
  if (!apiKey) throw new Error("Falta a chave " + CHAVE[ambiente] + " no Supabase (Edge Functions › Secrets).");
  const cart = ambiente === "sandbox" ? TESTE_SANDBOX : carteiraProducao(cfg, env("SICREDI_CODIGO_ACESSO"));
  const cli = clienteSicredi(ambiente, apiKey, cart, buscar);
  const acao = String(corpo.acao || "");
  if (acao === "testar") return { ok: true, ambiente, ...(await cli.testar()) };
  if (acao === "teste_completo") { if (ambiente !== "sandbox") throw new Error("O teste completo só roda no Sandbox."); const passos = await testeCompleto(cli); return { ok: passos.every((p) => p.ok), passos }; }
  if (acao === "emitir") return await cli.emitir(corpo.boleto as BoletoEntrada);
  if (acao === "consultar") return await cli.consultar(String(corpo.nosso_numero || ""));
  if (acao === "liquidados") { const dia = String(corpo.dia || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) throw new Error("Informe o dia (AAAA-MM-DD)."); return { itens: await cli.liquidados(dia) }; }
  if (acao === "pdf") return { pdf: paraBase64(await cli.pdf(String(corpo.linha || ""))) };
  if (acao === "baixar") return await cli.baixar(String(corpo.nosso_numero || ""));
  throw new Error("Ação desconhecida: " + acao);
}

export const atender = withSupabase({ auth: "user" }, async (req, ctx) => {
  if (req.method !== "POST") return json({ erro: "Use POST." }, 405);
  const { data: admin } = await ctx.supabase.rpc("e_admin");
  if (admin !== true) return json({ erro: "Só o administrador mexe nos boletos do Sicredi." }, 403);
  const corpo = await req.json().catch(() => ({})) as Record<string, unknown>;
  const ambiente: Ambiente = corpo.ambiente === "producao" ? "producao" : "sandbox";
  try {
    let cfg: Record<string, unknown> | null = null;
    if (ambiente === "producao") { const r = await ctx.supabase.from("config").select("dados").eq("id", 1).maybeSingle(); cfg = (r.data && r.data.dados) || {}; }
    return json(await executar(corpo, ambiente, cfg, (k) => Deno.env.get(k)));
  } catch (e) { return json({ erro: (e as Error).message }, 200); }
});

if (import.meta.main) Deno.serve((req) => atender(req));
