// Teste da importação dos Documentos do RH (supabase/functions/email/rh.ts) com Microsoft, banco e pasta falsos.
// Rodar: deno run -A teste/teste_rh.ts
// Confere: só remetentes informados; só PDF/foto; nunca o mesmo anexo duas vezes; lote limitado com "restam";
// arquivo removido se o registro falhar; mês e tipo pelo nome do arquivo.
import { importarRH } from "../supabase/functions/email/rh.ts";

const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, extra: unknown = "") => (c ? ok : falhas).push(n + (!c && extra !== "" ? " :: " + JSON.stringify(extra) : ""));

// ----- Microsoft falsa: 3 e-mails da Loredo (um com anexo repetido já importado), 1 de outro remetente com mesmo texto -----
const msgs = [
  { id: "M1", subject: "PRO-LABORE, RECIBOS 10.2026", from: { emailAddress: { address: "dploredocontabilidade@gmail.com" } }, receivedDateTime: "2026-11-04T16:38:00Z", hasAttachments: true },
  { id: "M2", subject: "IMPOSTOS E PRO LABORE 09.2026", from: { emailAddress: { address: "DPLoredoContabilidade@gmail.com" } }, receivedDateTime: "2026-10-14T12:00:00Z", hasAttachments: true },
  { id: "M3", subject: "Sem anexo", from: { emailAddress: { address: "dploredocontabilidade@gmail.com" } }, receivedDateTime: "2026-10-10T12:00:00Z", hasAttachments: false },
  { id: "M4", subject: "Golpe com o nome da Loredo", from: { emailAddress: { address: "loredo@golpe.com" } }, receivedDateTime: "2026-10-12T12:00:00Z", hasAttachments: true },
  { id: "M5", subject: "Antigo demais", from: { emailAddress: { address: "dploredocontabilidade@gmail.com" } }, receivedDateTime: "2025-01-01T12:00:00Z", hasAttachments: true },
];
const anexos: Record<string, Array<Record<string, unknown>>> = {
  M1: [{ id: "A1", name: "PRO LABORE 10.2026 - DTCAR.pdf", contentType: "application/pdf", size: 1000 }, { id: "A2", name: "RECIBO 10.2026 - DTCAR.pdf", contentType: "application/pdf", size: 1000 },
       { id: "A3", name: "logo.png", contentType: "image/png", size: 10, isInline: true }, { id: "A4", name: "planilha.xlsx", contentType: "application/vnd.ms-excel", size: 10 }],
  M2: [{ id: "B1", name: "DARF 09.2026 - DTCAR.pdf", contentType: "application/pdf", size: 1000 }, { id: "B2", name: "FGTS 09.2026 - DTCAR.pdf", contentType: "application/pdf", size: 1000 }],
  M4: [{ id: "C1", name: "boleto.pdf", contentType: "application/pdf", size: 1000 }],
  M5: [{ id: "D1", name: "velho.pdf", contentType: "application/pdf", size: 1000 }],
};
const pedidos: string[] = [];
globalThis.fetch = (async (u: string | URL | Request) => {
  const url = String(u instanceof Request ? u.url : u); pedidos.push(url);
  const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { "content-type": "application/json" } });
  const m = url.match(/\/me\/messages\/([^/?]+)\/attachments(?:\/([^/?]+))?/);
  if (m && !m[2]) return j({ value: (anexos[decodeURIComponent(m[1])] || []).map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", ...a })) });
  if (m && m[2]) { const a = (anexos[decodeURIComponent(m[1])] || []).find((x) => x.id === decodeURIComponent(m[2]))!; return j({ "@odata.type": "#microsoft.graph.fileAttachment", ...a, contentBytes: btoa("%PDF " + a.name) }); }
  if (url.includes("/me/messages?")) return j({ value: msgs }); // a busca da Microsoft devolve até o que não é do remetente
  return new Response("{}", { status: 404 });
}) as typeof fetch;

// ----- banco e pasta falsos -----
const linhas: Array<Record<string, unknown>> = [{ email_id: "M2", anexo_id: "B2", email_data: "2026-10-14T12:00:00Z" }]; // FGTS já importado
const pasta = new Map<string, Uint8Array>();
let falharInsert = "";
// deno-lint-ignore no-explicit-any
const adm: any = {
  rpc: () => Promise.resolve({ data: null, error: null }),
  from: (t: string) => ({
    select: () => ({ gte: () => Promise.resolve({ data: linhas.map((l) => ({ email_id: l.email_id, anexo_id: l.anexo_id })), error: null }) }),
    insert: (d: Record<string, unknown>) => ({ select: () => {
      if (falharInsert && String(d.nome_arquivo).includes(falharInsert)) return Promise.resolve({ data: null, error: { message: "erro de teste" } });
      linhas.push(d); return Promise.resolve({ data: [{ id: "x", ...d }], error: null }); } }),
  }),
  storage: { from: (b: string) => ({
    upload: (c: string, bytes: Uint8Array) => { if (b !== "rh") throw new Error("pasta errada"); pasta.set(c, bytes); return Promise.resolve({ error: null }); },
    remove: (cs: string[]) => { cs.forEach((c) => pasta.delete(c)); return Promise.resolve({ error: null }); },
  }) },
};
const agora = new Date("2026-11-04T18:00:00Z");

const vazio = await importarRH(adm, "T", { remetentes: [] }, agora);
confere("sem remetente não busca nada", vazio.importados === 0 && !pedidos.length);

const r1 = await importarRH(adm, "T", { remetentes: ["dploredocontabilidade@gmail.com"], dias: 120, maximo: 2 }, agora);
confere("lote limitado: importa 2 e avisa que restam 1", r1.importados === 2 && r1.restam === 1, r1);
confere("mais antigo primeiro (DARF de 14/10 antes do pró-labore)", (r1.novos as Array<Record<string, unknown>>)[0].tipo === "darf", r1.novos);
const r2 = await importarRH(adm, "T", { remetentes: ["dploredocontabilidade@gmail.com"], dias: 120, maximo: 8 }, agora);
confere("segunda chamada pega o que faltou e para", r2.importados === 1 && r2.restam === 0, r2);
const r3 = await importarRH(adm, "T", { remetentes: ["dploredocontabilidade@gmail.com"], dias: 120 }, agora);
confere("terceira chamada: nada novo (nunca importa o mesmo anexo duas vezes)", r3.importados === 0 && r3.restam === 0, r3);

const nomes = linhas.map((l) => l.nome_arquivo).filter(Boolean);
confere("só PDF/foto de verdade (sem imagem da assinatura nem planilha)", nomes.length === 3 && !nomes.includes("logo.png") && !nomes.includes("planilha.xlsx"), nomes);
confere("sem o e-mail de outro remetente (golpe com o nome da Loredo) e sem o antigo demais", !nomes.includes("boleto.pdf") && !nomes.includes("velho.pdf"), nomes);
const pro = linhas.find((l) => l.nome_arquivo === "PRO LABORE 10.2026 - DTCAR.pdf")!;
confere("mês e tipo pelo nome; caminho na pasta por mês; origem e-mail", pro.competencia === "2026-10" && pro.tipo === "pro_labore" && String(pro.arquivo).startsWith("2026-10/")
  && pro.origem === "email" && pro.email_de === "dploredocontabilidade@gmail.com" && pasta.has(String(pro.arquivo)), pro);
confere("arquivo guardado é o anexo", new TextDecoder().decode(pasta.get(String(pro.arquivo))!) === "%PDF PRO LABORE 10.2026 - DTCAR.pdf");

// registro falhou: o arquivo não fica sobrando na pasta
anexos.M1.push({ id: "A5", name: "FOLHA DE PONTO 11.2026 - DTCAR.pdf", contentType: "application/pdf", size: 10 });
falharInsert = "FOLHA DE PONTO";
const antes = pasta.size;
let erro = "";
try { await importarRH(adm, "T", { remetentes: ["dploredocontabilidade@gmail.com"] }, agora); } catch (e) { erro = (e as Error).message; }
confere("falha no registro: avisa e apaga o arquivo enviado", erro === "erro de teste" && pasta.size === antes, { erro, antes, depois: pasta.size });

for (const o of ok) console.log("OK", o);
console.log("FALHAS", falhas);
if (falhas.length) Deno.exit(1);
