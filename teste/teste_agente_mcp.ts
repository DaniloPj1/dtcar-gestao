// Teste do conector "agente" (supabase/functions/agente) sem tocar no banco real.
// Rodar: deno run -A teste/teste_agente_mcp.ts
// 1) protocolo MCP (cliente da geração 2025, como o app do Claude): initialize, tools/list, tools/call;
// 2) cada ferramenta chama a função certa do banco com os argumentos certos;
// 3) abrir_os sem confirmar=true só pede a prévia; 4) erro do banco volta como erro da ferramenta;
// 5) sem login: 401 com o endereço da descoberta do OAuth; descoberta responde com o servidor de login.
import { createMcpHandler } from "npm:@modelcontextprotocol/server@2.4.0";
import { criarServidor, linkWhatsApp, type Banco } from "../supabase/functions/agente/ferramentas.ts";

const chamadas: Array<[string, Record<string, unknown> | undefined]> = [];
const respostas: Record<string, unknown> = {
  agente_preparar_envio: { texto: "Olá, João! Segue a O.S. 1904", telefone: "27999990001", id: "abc", itens: 2 },
  agente_abrir_os: { pode_abrir: true, gravado: false },
  whatsapp_enfileirar: { gravado: false, erros: [], avisos: [] },
};
const acordadas: unknown[] = [];
const banco: Banco = {
  rpc(fn, args) {
    chamadas.push([fn, args]);
    if (fn === "agente_estoque" && args?.p_texto === "erro") return Promise.resolve({ data: null, error: { message: "O agente só atende o administrador." } });
    if (fn === "agente_fazer" && args?.p_acao === "boleto_preparar") return Promise.resolve({ data: { os: 1887, cliente: "Granicap", total: 600, avisos: [],
      boletos: [{ receber_id: "r1", descricao: "O.S. 1887", valor: 600, vencimento: "2026-12-06", boleto: { valor: 600, vencimento: "2026-12-06", pagador: { nome: "Granicap" } } }] }, error: null });
    if (fn === "agente_fazer" && args?.p_acao === "boleto_gravar") return Promise.resolve({ data: { nosso_numero: (args.p as Record<string, unknown>).nosso_numero, pix: true }, error: null });
    if (fn === "whatsapp_enfileirar" && (args as { p_gravar?: boolean })?.p_gravar) return Promise.resolve({ data: { gravado: true, id: 7 }, error: null });
    return Promise.resolve({ data: respostas[fn] ?? { ok: fn }, error: null });
  },
  functions: { invoke(nome, op) { acordadas.push([nome, op.body]);
    if (nome === "sicredi") return Promise.resolve({ data: { nossoNumero: "260000011", linhaDigitavel: "74891", codigoBarras: "748", qrCode: "000201x", txid: "t" }, error: null });
    if (nome === "email" && op.body?.acao === "whatsapp") return Promise.resolve({ data: { gravado: op.body.confirmar === true, texto: "Olá, João!", arquivo: { nome: "Orcamento_01887_ABC1D23.pdf", kb: 180 } }, error: null });
    return Promise.resolve({ data: { ok: true }, error: null }); } },
};
const handler = createMcpHandler(() => criarServidor(banco), { onerror: (e) => console.error(e) });
const ok: string[] = [], falhas: string[] = [];
const confere = (nome: string, cond: boolean, extra = "") => (cond ? ok : falhas).push(nome + (extra ? " (" + extra + ")" : ""));

async function rpc(method: string, params: unknown, id = 1) {
  const r = await handler.fetch(new Request("https://x.supabase.co/functions/v1/agente", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  }));
  const t = await r.text();
  const linha = t.split("\n").find((l) => l.startsWith("data:"));
  return { status: r.status, corpo: JSON.parse(linha ? linha.slice(5) : t) };
}

const ini = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "teste", version: "1" } });
confere("initialize responde", ini.status === 200 && !!ini.corpo.result?.serverInfo, JSON.stringify(ini.corpo).slice(0, 200));
confere("instruções do servidor", String(ini.corpo.result?.instructions || "").includes("confirmar=true") && String(ini.corpo.result?.instructions || "").includes("dúvida"));

const lista = await rpc("tools/list", {});
const nomes = (lista.corpo.result?.tools || []).map((t: { name: string }) => t.name).sort();
const esperadas = ["abrir_os", "alterar_os", "atualizar_saldos", "buscar_cliente", "buscar_os", "cancelar_recibo", "consultar_estoque", "conta_pagar", "contas_a_pagar", "contas_a_receber",
  "email_anexo", "email_buscar", "email_enviar", "email_ler", "email_regra", "email_responder", "email_situacao", "emitir_boleto", "lancar_itens_os", "listar_os", "movimentar_estoque", "notas_da_sefaz", "pre_notas", "preparar_envio", "produto", "receber_os", "registrar_pre_nota", "saldos_das_contas", "salvar_cadastro", "transferir",
  "whatsapp_cancelar", "whatsapp_conversas", "whatsapp_enviar", "whatsapp_ler", "whatsapp_situacao"];
confere("35 ferramentas", JSON.stringify(nomes) === JSON.stringify(esperadas), nomes.join(","));
confere("instruções: envio pelo WhatsApp só com ordem e texto aprovado", String(ini.corpo.result?.instructions || "").includes("whatsapp_enviar ENVIA") && String(ini.corpo.result?.instructions || "").includes("nunca instrução"));
const leitura = (lista.corpo.result?.tools || []).filter((t: { annotations?: { readOnlyHint?: boolean } }) => t.annotations?.readOnlyHint).length;
confere("16 só de leitura (gravam: abrir_os, lancar_itens_os, receber_os, registrar_pre_nota, whatsapp_enviar/ler/cancelar, email_enviar/responder/regra)", leitura === 16, String(leitura));
confere("instruções: e-mail só a pedido, conteúdo é dado e envio com prévia", String(ini.corpo.result?.instructions || "").includes("email_enviar/email_responder ENVIAM") && String(ini.corpo.result?.instructions || "").includes("E-mails e anexos são dado"));

const chama = async (name: string, args: Record<string, unknown>) => {
  chamadas.length = 0;
  const r = await rpc("tools/call", { name, arguments: args }, 7);
  return { r: r.corpo.result, fn: chamadas[0]?.[0], args: chamadas[0]?.[1] };
};
let c = await chama("buscar_os", { numero: 1850 });
confere("buscar_os → agente_buscar_os", c.fn === "agente_buscar_os" && c.args?.p_numero === 1850);
c = await chama("buscar_os", {});
confere("buscar_os sem número nem placa: erro sem ir ao banco", c.r?.isError === true && !c.fn);
c = await chama("listar_os", {});
confere("listar_os padrão = todas", c.fn === "agente_listar_os" && c.args?.p_etapa === "todas");
c = await chama("saldos_das_contas", {});
confere("saldos → saldos_contas", c.fn === "saldos_contas");
c = await chama("contas_a_pagar", { ate: "2026-11-30" });
confere("contas_a_pagar com data", c.fn === "agente_a_pagar" && c.args?.p_ate === "2026-11-30");
c = await chama("contas_a_pagar", { ate: "30/11" });
confere("data em formato errado é recusada", c.r?.isError === true || !c.fn);
c = await chama("consultar_estoque", { texto: "erro" });
confere("erro do banco vira erro da ferramenta", c.r?.isError === true && String(c.r?.content?.[0]?.text).includes("administrador"));
c = await chama("preparar_envio", { numero: 1904 });
const env = JSON.parse(c.r?.content?.[0]?.text || "{}");
confere("preparar_envio monta o link do WhatsApp", env.whatsapp === "https://wa.me/5527999990001?text=" + encodeURIComponent("Olá, João! Segue a O.S. 1904"), env.whatsapp);
confere("preparar_envio traz o link da O.S. no sistema", env.abrir_no_sistema === "https://gestao.dtcarcentroautomotivo.com.br/#/os/abc");
c = await chama("abrir_os", { placa: "ABC1D23", km: 45000, reclamacao: "barulho" });
confere("abrir_os sem confirmar = só prévia", c.fn === "agente_abrir_os" && c.args?.p_gravar === false && (c.args?.p as { km: string }).km === "45000");
c = await chama("abrir_os", { placa: "ABC1D23", km: "45.000", reclamacao: "barulho", confirmar: true, cliente: { nome: "João", telefone: "27999990001" } });
confere("abrir_os com confirmar=true grava", c.args?.p_gravar === true && !("confirmar" in (c.args?.p as object)));
const itens = [{ tipo: "servico", descricao: "Desmontagem suspensão dianteira", valor_unit: 600 }, { tipo: "peca", descricao: "Óleo 90", qtd: 3, valor_unit: 68 }];
c = await chama("lancar_itens_os", { numero: 1904, itens });
const pl = c.args?.p as { numero: number; itens: Array<{ qtd: number }> };
confere("lancar_itens_os sem confirmar = só prévia", c.fn === "agente_lancar_itens_os" && c.args?.p_gravar === false && pl.numero === 1904 && pl.itens.length === 2);
confere("lancar_itens_os: quantidade padrão 1", pl.itens[0].qtd === 1 && pl.itens[1].qtd === 3);
c = await chama("lancar_itens_os", { numero: 1904, itens, confirmar: true });
confere("lancar_itens_os com confirmar=true grava", c.args?.p_gravar === true && !("confirmar" in (c.args?.p as object)));
c = await chama("lancar_itens_os", { numero: 1904, itens: [] });
confere("lancar_itens_os sem itens é recusado", c.r?.isError === true || !c.fn);
c = await chama("lancar_itens_os", { numero: 1904, itens: [{ tipo: "peca", descricao: "x", valor_unit: -1 }] });
confere("valor negativo é recusado", c.r?.isError === true || !c.fn);
// receber O.S. (v37)
c = await chama("receber_os", { numero: 1868, forma: "Dinheiro" });
confere("receber_os sem confirmar = só prévia", c.fn === "agente_receber_os" && c.args?.p_gravar === false && (c.args?.p as Record<string, unknown>)?.numero === 1868 && (c.args?.p as Record<string, unknown>)?.forma === "Dinheiro");
c = await chama("receber_os", { numero: 1868, forma: "Dinheiro", conta: "Espécie", valor: 150, data: "2026-11-05", confirmar: true });
confere("receber_os com confirmar=true grava (sem 'confirmar' no pedido)", c.args?.p_gravar === true && !("confirmar" in (c.args?.p as object)) && (c.args?.p as Record<string, unknown>)?.valor === 150);
c = await chama("receber_os", { numero: 1868 });
confere("receber_os sem forma de pagamento é recusado", c.r?.isError === true || !c.fn);
c = await chama("receber_os", { numero: 1868, forma: "PIX", data: "05/11/2026" });
confere("receber_os com data fora do padrão é recusado", c.r?.isError === true || !c.fn);
c = await chama("receber_os", { numero: 1868, forma: "PIX", valor: -5 });
confere("receber_os com valor negativo é recusado", c.r?.isError === true || !c.fn);
// pedidos de compra por fornecedor (v31)
const ped = { fornecedor: "Biancardi", fornecedor_cnpj: "20.149.617/0003-42", documento: "PV 57941", data: "2026-11-03", total: 250.74, os_numero: 1854 };
c = await chama("registrar_pre_nota", ped);
confere("registrar_pre_nota sem confirmar = só prévia", c.fn === "agente_registrar_pre_nota" && c.args?.p_gravar === false && (c.args?.p as { total: number }).total === 250.74 && !("confirmar" in (c.args?.p as object)));
c = await chama("registrar_pre_nota", { ...ped, confirmar: true });
confere("registrar_pre_nota com confirmar=true grava e traz o link da tela", c.args?.p_gravar === true && JSON.parse(c.r?.content?.[0]?.text || "{}").abrir_no_sistema === "https://gestao.dtcarcentroautomotivo.com.br/#/pedidos");
c = await chama("registrar_pre_nota", { ...ped, total: 0 });
confere("registrar_pre_nota: valor zero é recusado", c.r?.isError === true || !c.fn);
c = await chama("registrar_pre_nota", { ...ped, data: "03/11/2026" });
confere("registrar_pre_nota: data em formato errado é recusada", c.r?.isError === true || !c.fn);
c = await chama("pre_notas", { fornecedor: "biancardi" });
confere("pre_notas: padrão = abertas, sem período", c.fn === "agente_pre_notas" && c.args?.p_situacao === "abertas" && c.args?.p_fornecedor === "biancardi" && c.args?.p_de === null);
confere("telefone inválido não gera link", linkWhatsApp("123", "x") === null);

// sem login (pipeline completo): precisa do ambiente das Edge Functions
Deno.env.set("SUPABASE_URL", "https://vbbklawlbxznsemkgtvg.supabase.co");
Deno.env.set("SUPABASE_FUNCTION_SLUG", "agente");
Deno.env.set("SB_EXECUTION_ID", "teste");
Deno.env.set("SUPABASE_PUBLISHABLE_KEYS", JSON.stringify({ default: "sb_publishable_teste" }));
Deno.env.set("SUPABASE_JWKS", JSON.stringify({ keys: [] }));
const { atender } = await import("../supabase/functions/agente/index.ts");
const cab = { "x-forwarded-host": "vbbklawlbxznsemkgtvg.supabase.co", "x-forwarded-proto": "https" };
const sem = await atender(new Request("http://localhost/agente", { method: "POST", headers: { ...cab, "content-type": "application/json", accept: "application/json, text/event-stream" },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) }));
const www = sem.headers.get("www-authenticate") || "";
confere("sem login: 401 com resource_metadata", sem.status === 401 && www.includes("resource_metadata="), sem.status + " " + www);
const urlMeta = (www.match(/resource_metadata="([^"]+)"/) || [])[1] || "";
const meta = await atender(new Request(urlMeta.replace(/^https:\/\/[^/]+\/functions\/v1/, "http://localhost"), { headers: cab }));
const m = await meta.json().catch(() => ({}));
confere("descoberta aponta para o login do Supabase", meta.status === 200 && m.authorization_servers?.[0] === "https://vbbklawlbxznsemkgtvg.supabase.co/auth/v1", JSON.stringify(m));
confere("resource = endereço do conector", m.resource === "https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/agente", m.resource);
const falso = await atender(new Request("http://localhost/agente", { method: "POST", headers: { ...cab, authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.x", "content-type": "application/json" }, body: "{}" }));
confere("token falso: 401", falso.status === 401, String(falso.status));

// WhatsApp (v25)
c = await chama("whatsapp_enviar", { texto: "Olá" });
confere("whatsapp_enviar sem destinatário: erro sem ir ao banco", c.r?.isError === true && !c.fn);
acordadas.length = 0;
c = await chama("whatsapp_enviar", { texto: "Seu carro está pronto", numero_os: 1904 });
confere("whatsapp_enviar padrão = prévia (não grava nem acorda a zap)", c.fn === "whatsapp_enfileirar" && c.args?.p_gravar === false && (c.args?.p as Record<string, unknown>)?.ordem_numero === 1904 && acordadas.length === 0, JSON.stringify(c.args));
c = await chama("whatsapp_enviar", { texto: "Seu carro está pronto", cliente_id: "00000000-0000-4000-8000-000000000001", confirmar: true, pedido: "avisar" });
confere("whatsapp_enviar confirmado grava e acorda a zap", c.args?.p_gravar === true && (c.args?.p as Record<string, unknown>)?.fora_horario === false && (c.args?.p as Record<string, unknown>)?.origem === "claude" && JSON.stringify(acordadas) === JSON.stringify([["zap", { acao: "processar" }]]), JSON.stringify(acordadas));
// v34: modelo e PDF vão pela função "email"
acordadas.length = 0;
c = await chama("whatsapp_enviar", { modelo: "orcamento", numero_os: 1887, anexo: { fonte: "os", documento: "orcamento" } });
const pw = acordadas[0] as [string, Record<string, unknown>];
confere("whatsapp_enviar com modelo+PDF: prévia pela função email (sem gravar nem acordar a zap)", pw?.[0] === "email" && pw[1].acao === "whatsapp" && pw[1].modelo === "orcamento"
  && pw[1].numero_os === 1887 && (pw[1].anexo as Record<string, unknown>).documento === "orcamento" && pw[1].confirmar === false && acordadas.length === 1
  && /Orcamento_01887/.test(c.r?.content?.[0]?.text || ""), JSON.stringify(acordadas));
acordadas.length = 0;
c = await chama("whatsapp_enviar", { modelo: "cobranca", numero_os: 1865, anexo: { fonte: "boleto" }, confirmar: true });
confere("whatsapp_enviar com modelo confirmado: grava e acorda a zap", (acordadas[0] as [string, Record<string, unknown>])[1].confirmar === true && JSON.stringify(acordadas[1]) === JSON.stringify(["zap", { acao: "processar" }]), JSON.stringify(acordadas));
c = await chama("whatsapp_enviar", { numero_os: 1887 });
confere("whatsapp_enviar sem texto, modelo nem PDF: erro", c.r?.isError === true);
c = await chama("whatsapp_enviar", { telefone: "27999990000", anexo: { fonte: "os" } });
confere("whatsapp_enviar PDF sem O.S.: erro", c.r?.isError === true && /numero_os/.test(c.r?.content?.[0]?.text || ""));
c = await chama("whatsapp_ler", { telefone: "27999112233" });
confere("whatsapp_ler → whatsapp_mensagens_de", c.fn === "whatsapp_mensagens_de" && c.args?.p_telefone === "27999112233" && c.args?.p_marcar_lidas === true);
c = await chama("whatsapp_conversas", { so_nao_lidas: true });
confere("whatsapp_conversas → whatsapp_conversas", c.fn === "whatsapp_conversas" && c.args?.p_so_nao_lidas === true && c.args?.p_limite === 20);
c = await chama("whatsapp_situacao", {});
confere("whatsapp_situacao → whatsapp_resumo", c.fn === "whatsapp_resumo");
c = await chama("whatsapp_cancelar", { id: 7 });
confere("whatsapp_cancelar → whatsapp_cancelar", c.fn === "whatsapp_cancelar" && c.args?.p_id === 7);

// v40: ferramentas "sem amarras" vão todas pelo agente_fazer; sem confirmar = prévia
c = await chama("alterar_os", { numero: 1904, acao: "entregar", km_saida: 52000 });
confere("alterar_os sem confirmar = prévia pelo agente_fazer", c.fn === "agente_fazer" && c.args?.p_acao === "alterar_os" && c.args?.p_gravar === false
  && (c.args?.p as Record<string, unknown>).km_saida === "52000" && (c.args?.p as Record<string, unknown>).acao === "entregar", JSON.stringify(c.args));
c = await chama("alterar_os", { numero: 1904, acao: "voar" });
confere("alterar_os com ação inválida: erro sem ir ao banco", c.r?.isError === true && !c.fn);
c = await chama("conta_pagar", { acao: "pagar", busca: "energia", conta_origem: "PicPay PJ", confirmar: true });
confere("conta_pagar confirmado grava", c.fn === "agente_fazer" && c.args?.p_acao === "conta_pagar" && c.args?.p_gravar === true && (c.args?.p as Record<string, unknown>).conta_origem === "PicPay PJ");
for (const [nome, acao, args] of [["salvar_cadastro", "salvar_cadastro", { tipo: "cliente", codigo: 2, campos: { telefone: "27999" } }],
  ["atualizar_saldos", "atualizar_saldos", { contas: [{ nome: "Sicredi", saldo: 10 }] }], ["transferir", "transferir", { de: "Sicredi", para: "Espécie", valor: 5 }],
  ["cancelar_recibo", "cancelar_recibo", { numero: 19 }], ["movimentar_estoque", "movimentar_estoque", { movimentos: [{ codigo: "100", tipo: "ajuste", qtd: 3 }] }],
  ["produto", "produto", { codigo: 690, campos: { preco_vista: 10 } }]] as Array<[string, string, Record<string, unknown>]>) {
  c = await chama(nome, args);
  confere(nome + " → agente_fazer('" + acao + "') prévia", c.fn === "agente_fazer" && c.args?.p_acao === acao && c.args?.p_gravar === false, JSON.stringify(c.args));
}
// v41: emitir_boleto — prévia não chama o Sicredi; confirmado: preparar → sicredi emitir → gravar
acordadas.length = 0;
c = await chama("emitir_boleto", { numero: 1887, vencimento: "2026-12-06", valor: 600 });
confere("emitir_boleto sem confirmar: prévia sem chamar o Sicredi", c.fn === "agente_fazer" && c.args?.p_gravar === false && acordadas.length === 0
  && !/"boleto"/.test(c.r?.content?.[0]?.text || ""), c.r?.content?.[0]?.text);
chamadas.length = 0; acordadas.length = 0;
const rb = await rpc("tools/call", { name: "emitir_boleto", arguments: { numero: 1887, vencimento: "2026-12-06", valor: 600, confirmar: true } }, 8);
confere("emitir_boleto confirmado: registra no Sicredi e grava o nosso número", (acordadas[0] as [string, Record<string, unknown>])?.[0] === "sicredi"
  && ((acordadas[0] as [string, Record<string, unknown>])[1].acao === "emitir") && chamadas[1]?.[1]?.p_acao === "boleto_gravar"
  && ((chamadas[1]?.[1]?.p as Record<string, unknown>)?.nosso_numero === "260000011") && !rb.corpo.result?.isError, JSON.stringify(chamadas));

confere("instruções: dinheiro sempre com prévia", String(ini.corpo.result?.instructions || "").includes("Dinheiro (receber_os, conta_pagar"));

console.log(ok.map((x) => "OK " + x).join("\n"));
console.log("FALHAS", JSON.stringify(falhas));
if (falhas.length) Deno.exit(1);
