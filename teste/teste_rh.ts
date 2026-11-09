// Teste da importação dos Documentos do RH (supabase/functions/email/rh.ts) com Microsoft, banco e pasta falsos.
// Rodar: deno run -A teste/teste_rh.ts
// Confere: só remetentes informados; só PDF/foto; nunca o mesmo anexo duas vezes; lote limitado com "restam";
// arquivo removido se o registro falhar; mês e tipo pelo nome do arquivo.
// 09/11/2026: mais novos primeiro; anexo com erro não trava os outros (vai em "erros"); sem remetentes = cfg.rh.remetentes;
// rh_listar (conector).
import { importarRH, listarRH } from "../supabase/functions/email/rh.ts";

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
let cfgRH: unknown = null;
const adm: any = {
  rpc: () => Promise.resolve({ data: null, error: null }),
  from: (t: string) => t === "config" ? ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: cfgRH ? { dados: { rh: { remetentes: cfgRH } } } : { dados: {} }, error: null }) }) }) }) : ({
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
confere("mais novos primeiro (o e-mail de 04/11 entra antes do de 14/10)", (r1.novos as Array<Record<string, unknown>>).every((n) => n.competencia === "2026-10" && n.tipo !== "darf"), r1.novos);
confere("resposta diz quantos e-mails da contabilidade achou e o mais recente", r1.emails_achados === 3 && r1.email_mais_recente === "2026-11-04T16:38:00Z", r1);
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

// registro falhou: o arquivo não fica sobrando na pasta e os outros anexos entram mesmo assim
anexos.M1.push({ id: "A5", name: "FOLHA DE PONTO 11.2026 - DTCAR.pdf", contentType: "application/pdf", size: 10 });
anexos.M2.push({ id: "B3", name: "DAS 09.2026 - DTCAR.pdf", contentType: "application/pdf", size: 10 });
falharInsert = "FOLHA DE PONTO";
const antes = pasta.size;
const r4 = await importarRH(adm, "T", { remetentes: ["dploredocontabilidade@gmail.com"] }, agora);
const e4 = (r4.erros || []) as Array<Record<string, string>>;
confere("anexo com erro não trava os outros: o DAS entra e a folha vai para erros", r4.importados === 1 && e4.length === 1 && e4[0].arquivo.startsWith("FOLHA DE PONTO") && e4[0].erro === "erro de teste", r4);
confere("falha no registro: apaga o arquivo enviado", pasta.size === antes + 1, { antes, depois: pasta.size });

// Codex no #61: lote cheio de anexos com erro não trava os mais antigos — com "pular", a chamada seguinte avança
msgs.push({ id: "M6", subject: "Lote com erro", from: { emailAddress: { address: "dploredocontabilidade@gmail.com" } }, receivedDateTime: "2026-11-05T10:00:00Z", hasAttachments: true });
anexos.M6 = [1, 2, 3].map((i) => ({ id: "E" + i, name: `QUEBRADO ${i} 11.2026.pdf`, contentType: "application/pdf", size: 10 }));
falharInsert = "QUEBRADO";
const p1 = await importarRH(adm, "T", { remetentes: ["dploredocontabilidade@gmail.com"], maximo: 3 }, agora);
const k1 = ((p1.erros || []) as Array<Record<string, string>>).map((e) => e.chave);
confere("lote só com erros: devolve a chave de cada um para pular", p1.importados === 0 && k1.length === 3 && k1.includes("M6|E1") && p1.restam === 1, p1);
const p2 = await importarRH(adm, "T", { remetentes: ["dploredocontabilidade@gmail.com"], maximo: 3, pular: k1 }, agora);
confere("com pular, a chamada seguinte pega o anexo mais antigo que estava atrás (a folha que falhou antes)", p2.importados === 1 && !p2.erros && p2.restam === 0
  && String((p2.novos as Array<Record<string, unknown>>)[0].titulo).startsWith("FOLHA DE PONTO"), p2);
anexos.M6 = [];

// sem remetentes na chamada (conector): usa cfg.rh.remetentes; sem nada gravado, o padrão da Loredo
falharInsert = "";
const r5 = await importarRH(adm, "T", {}, agora);
confere("sem remetentes: padrão da Loredo", r5.importados === 0 && r5.emails_achados === 4 && JSON.stringify(r5.remetentes) === JSON.stringify(["dploredocontabilidade@gmail.com"]), r5);
cfgRH = ["outra@contabil.com.br"];
const r6 = await importarRH(adm, "T", {}, agora);
confere("sem remetentes: vale o que está gravado na tela (cfg.rh.remetentes)", JSON.stringify(r6.remetentes) === JSON.stringify(["outra@contabil.com.br"]) && r6.importados === 0, r6);

// rh_listar: filtros e mais novos primeiro
const docsBanco = [
  { id: "1", competencia: "2026-11", tipo: "folha_ponto", titulo: "FOLHA DE PONTO 11.2026", nome_arquivo: "f.pdf", tamanho: 2048, linha_digitavel: "", email_assunto: "", obs: "" },
  { id: "2", competencia: "2026-10", tipo: "pro_labore", titulo: "PRO LABORE 10.2026", nome_arquivo: "p.pdf", tamanho: 1024, linha_digitavel: "-", email_assunto: "PRO-LABORE", obs: "" },
];
const filtros: Array<[string, unknown]> = [];
// deno-lint-ignore no-explicit-any
const q: any = { select: () => q, eq: (c: string, v: unknown) => { filtros.push([c, v]); return q; }, order: () => q,
  range: (de: number, ate: number) => Promise.resolve({ data: docsBanco.filter((d) => filtros.every(([c, v]) => (d as Record<string, unknown>)[c] === v)).slice(de, ate + 1), error: null }) };
const l1 = await listarRH({ from: () => q } as never, {});
confere("rh_listar: todos, com contagem por mês e sem o '-' de guia não lida", l1.total === 2 && l1.por_mes["2026-10"] === 1 && l1.documentos[1].linha_digitavel === "" && l1.documentos[0].tamanho_kb === 2, l1);
filtros.length = 0;
const l2 = await listarRH({ from: () => q } as never, { competencia: "2026-10" });
confere("rh_listar: filtro por mês", l2.total === 1 && l2.documentos[0].id === "2", l2);
filtros.length = 0;
const l3 = await listarRH({ from: () => q } as never, { texto: "folha" });
confere("rh_listar: busca por texto", l3.total === 1 && l3.documentos[0].id === "1", l3);
// Codex no #61: mais de 1000 documentos — a busca por texto lê todas as páginas antes de filtrar
for (let i = 0; i < 1500; i++) docsBanco.splice(i, 0, { id: "n" + i, competencia: "2026-11", tipo: "outro", titulo: "Doc " + i, nome_arquivo: "d.pdf", tamanho: 1, linha_digitavel: "", email_assunto: "", obs: "" });
filtros.length = 0;
const l4 = await listarRH({ from: () => q } as never, { texto: "pro labore" });
confere("rh_listar: acha documento antigo depois de 1500 mais novos (lê todas as páginas)", l4.total === 1 && l4.documentos[0].id === "2", { total: l4.total });
docsBanco.splice(0, 1500);
let erroMes = "";
try { await listarRH({ from: () => q } as never, { competencia: "out/2026" }); } catch (e) { erroMes = (e as Error).message; }
confere("rh_listar: mês inválido avisa", /AAAA-MM/.test(erroMes), erroMes);

for (const o of ok) console.log("OK", o);
console.log("FALHAS", falhas);
if (falhas.length) Deno.exit(1);
