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
};
const banco: Banco = {
  rpc(fn, args) {
    chamadas.push([fn, args]);
    if (fn === "agente_estoque" && args?.p_texto === "erro") return Promise.resolve({ data: null, error: { message: "O agente só atende o administrador." } });
    return Promise.resolve({ data: respostas[fn] ?? { ok: fn }, error: null });
  },
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
confere("instruções do servidor", String(ini.corpo.result?.instructions || "").includes("confirmar=true"));

const lista = await rpc("tools/list", {});
const nomes = (lista.corpo.result?.tools || []).map((t: { name: string }) => t.name).sort();
const esperadas = ["abrir_os", "buscar_cliente", "buscar_os", "consultar_estoque", "contas_a_pagar", "contas_a_receber", "listar_os", "notas_da_sefaz", "preparar_envio", "saldos_das_contas"];
confere("10 ferramentas", JSON.stringify(nomes) === JSON.stringify(esperadas), nomes.join(","));
const leitura = (lista.corpo.result?.tools || []).filter((t: { annotations?: { readOnlyHint?: boolean } }) => t.annotations?.readOnlyHint).length;
confere("9 só de leitura, abrir_os grava", leitura === 9, String(leitura));

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

console.log(ok.map((x) => "OK " + x).join("\n"));
console.log("FALHAS", JSON.stringify(falhas));
if (falhas.length) Deno.exit(1);
