// Teste da ação "whatsapp" da função email (v34: modelo de mensagem + PDF para o WhatsApp da oficina), com os PDFs DE VERDADE
// (js/pdf.js, js/boletopdf.js e js/mensagens.js da pasta; na função, lidos do GitHub travados num commit). Banco e pasta são falsos.
// Rodar: deno run -A teste/teste_whatsapp_pdf.ts
// Confere: textos dos modelos iguais aos da tela; PDF do orçamento/O.S./boleto/NF; prévia NÃO guarda nada; confirmado guarda o PDF
// na pasta whatsapp-envio e põe na fila com o caminho; fila recusou → PDF apagado; erros de uso; não precisa da Microsoft.
import { jsPDF } from "npm:jspdf@2.5.1";
import { pdfEntrada, pdfOrcamento, pdfOS, usarLeitorImagem } from "../js/pdf.js";
import { nomePdf, pdfBoletos } from "../js/boletopdf.js";
import * as mensagens from "../js/mensagens.js";
import type { Geradores } from "../supabase/functions/email/anexos.ts";
import { nomePdf as nomeSeguroPdf, type Mensagens } from "../supabase/functions/email/whatsapp.ts";
import { tratar, type Deps } from "../supabase/functions/email/acoes.ts";

(globalThis as unknown as { jspdf: unknown }).jspdf = { jsPDF };
const geradores = async (): Promise<Geradores> => ({ pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem });
const msgs = async () => mensagens as unknown as Mensagens;
const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, extra: unknown = "") => (c ? ok : falhas).push(n + (!c && extra !== "" ? " :: " + JSON.stringify(extra).slice(0, 500) : ""));
const deve = async (n: string, f: () => Promise<unknown>, rx: RegExp) => { try { await f(); confere(n, false, "não deu erro"); } catch (e) { confere(n, rx.test((e as Error).message), (e as Error).message); } };
const ehPdf = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5)) === "%PDF-";

type L = Record<string, unknown>;
const logo = await Deno.readFile(new URL("../icons/logo-preto.png", import.meta.url));
const tabelas: Record<string, L[]> = {
  config: [{ id: 1, dados: { nome: "DTCar Centro Automotivo", endereco: "Rua Teste, 10 - Colatina/ES", telefone: "(27) 99999-0000", espelhoLegado: false,
    cobranca: { cooperativa: "0523", posto: "16", beneficiario: "85453", conta: "85453-7", especie: "05", jurosMes: 2, multa: 2 } } }],
  clientes: [{ id: "c1", nome: "João da Silva" }],
  ordens: [
    { id: "o1", numero: 1887, status: "aguardando", criado_em: "2026-11-01T12:00:00Z", km_entrada: 85000, cliente: { nome: "João da Silva", telefone: "27999990000" }, cliente_id: "c1",
      veiculo: { placa: "ABC1D23", marca: "VW", modelo: "Gol" }, diagnostico: "Bieleta dianteira com folga", desconto: 0, total: 291, recebido: 0, garantia_dias: 90,
      validade_orcamento: "2026-11-11", checkin: {}, previsao_entrega: null },
    { id: "o2", numero: 1865, status: "entregue", criado_em: "2026-10-01T12:00:00Z", entregue_em: "2026-10-03T15:00:00Z", cliente: { nome: "Marbrasa Norte Mineradora Ltda", telefone: "27999990001" },
      veiculo: { placa: "QRS4T56", marca: "Toyota", modelo: "Hilux" }, desconto: 0, total: 2105.42, recebido: 1052.71, garantia_dias: 90, checkin: {} },
    { id: "o3", numero: 1900, status: "entregue", criado_em: "2026-10-29T12:00:00Z", entregue_em: "2026-10-29T18:00:00Z", cliente: { nome: "Quitado" }, veiculo: { placa: "AAA1A11" },
      total: 930, recebido: 930, garantia_dias: 90, checkin: {} }],
  os_itens: [{ id: "i1", ordem_id: "o1", posicao: 1, tipo: "servico", descricao: "Troca de bieletas", qtd: 1, valor_unit: 120, aprovado: true },
    { id: "i2", ordem_id: "o1", posicao: 2, tipo: "peca", descricao: "Bieleta dianteira", qtd: 2, valor_unit: 85.5, aprovado: true },
    { id: "i3", ordem_id: "o1", posicao: 3, tipo: "peca", descricao: "Item recusado", qtd: 1, valor_unit: 500, aprovado: false }],
  fotos: [],
  receber: [{ id: "r1", ordem_id: "o2", status: "aberta", parcela: 2, parcelas: 2, valor: 1052.71, vencimento: "2026-12-01", forma: "Boleto" },
    { id: "r2", ordem_id: "o2", status: "paga", parcela: 1, parcelas: 2, valor: 1052.71, vencimento: "2026-11-01", forma: "Boleto" }],
  boletos: [{ id: "b1", os_numero: "1865", nosso_numero: "261000017", situacao: "registrado", valor: 1052.71, vencimento: "2026-12-01", emissao: "2026-11-04",
    pagador_nome: "MARBRASA", pagador_doc: "12345678000195", pagador: {}, descricao: "O.S. 1865 parcela 2/2", seu_numero: "1865-2", codigo_barras: "74891" + "0".repeat(39), linha_digitavel: "x", qr_url: "" }],
  os_notas: [{ id: "11111111-1111-1111-1111-111111111111", os_numero: 1865, numero_nf: "131", arquivo: "1865/nf131.pdf", nome_arquivo: "NF 131.pdf", tipo_arquivo: "application/pdf", criado_em: "1" },
    { id: "22222222-2222-2222-2222-222222222222", os_numero: 1865, numero_nf: "131", arquivo: "1865/nf131.xml", nome_arquivo: "NF 131.xml", tipo_arquivo: "application/xml", criado_em: "2" }],
};
const pastas: Record<string, Map<string, Uint8Array>> = {
  fotos: new Map(), notas: new Map([["1865/nf131.pdf", new TextEncoder().encode("%PDF-1.4 NF 131")], ["1865/nf131.xml", new TextEncoder().encode("<nfeProc/>")]]),
  "whatsapp-envio": new Map(),
};
const chamadasFila: L[] = []; let filaRecusa = false;
// deno-lint-ignore no-explicit-any
const db: any = {
  rpc: (f: string, a: L) => {
    if (f !== "whatsapp_enfileirar") return Promise.resolve({ data: null, error: { message: "sem " + f } });
    chamadasFila.push(a);
    const p = a.p as L, arq = p.arquivo as L | undefined;
    const erros: string[] = [];
    if (a.p_gravar && arq && !pastas["whatsapp-envio"].has(String(arq.path))) erros.push("O PDF não está na pasta do WhatsApp (gere de novo).");
    if (a.p_gravar && filaRecusa) erros.push("Limite do dia atingido (80 mensagens).");
    const gravado = !!a.p_gravar && !erros.length;
    return Promise.resolve({ data: { gravado, erros, avisos: ["aviso do banco"], telefone: "5527999990000", texto: p.texto, arquivo: arq ? { nome: arq.nome } : null, ...(gravado ? { id: 7 } : {}) }, error: null });
  },
  from(t: string) {
    const filtros: Array<[string, unknown]> = [];
    const exec = () => ({ data: (tabelas[t] || []).filter((x) => filtros.every(([k, v]) => x[k] === v)).map((x) => ({ ...x })), error: null });
    // deno-lint-ignore no-explicit-any
    const q: any = { select: () => q, order: () => q, eq: (k: string, v: unknown) => (filtros.push([k, v]), q), then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => Promise.resolve(exec()).then(a, b) };
    return q;
  },
  storage: { from: (b: string) => ({
    download: (c: string) => { const x = pastas[b]?.get(c); return Promise.resolve(x ? { data: new Blob([x as Uint8Array<ArrayBuffer>]), error: null } : { data: null, error: { message: "Object not found" } }); },
    upload: (c: string, bytes: Uint8Array, op: L) => { if (op.contentType !== "application/pdf") return Promise.resolve({ error: { message: "tipo" } }); pastas[b].set(c, bytes); return Promise.resolve({ data: { path: c }, error: null }); },
    remove: (l: string[]) => { l.forEach((c) => pastas[b].delete(c)); return Promise.resolve({ data: l, error: null }); },
  }) },
};
globalThis.fetch = (async (u: string | URL | Request) => {
  const url = String(u instanceof Request ? u.url : u);
  if (url.endsWith("/icons/logo-preto.png")) return new Response(logo, { headers: { "content-type": "image/png" } });
  return new Response("{}", { status: 404 });
}) as typeof fetch;
let n = 0;
// sem MS_CLIENT_ID: a ação whatsapp não depende da Microsoft
const deps: Deps = { usuario: db, adm: db, env: () => undefined, agora: () => new Date("2026-11-05T12:00:00Z"), site: "https://gestao.teste", geradores, mensagens: msgs,
  uuid: () => "0000000" + (++n) + "-0000-4000-8000-000000000000" };
const w = (c: L) => tratar("whatsapp", c, deps) as Promise<L>;
const cfg = tabelas.config[0].dados as L;

// ----- textos: os mesmos da tela -----
{
  const r = await w({ modelo: "orcamento", numero_os: 1887 });
  const esperado = mensagens.MSG.orcamento({ ...tabelas.ordens[0] }, cfg, tabelas.os_itens.filter((i) => i.aprovado !== false));
  confere("orçamento: texto igual ao botão da tela (sem o item recusado)", r.texto === esperado && !/Item recusado/.test(String(r.texto)) && /Bieleta dianteira/.test(String(r.texto)) && /291,00/.test(String(r.texto)), r.texto);
  confere("prévia: não grava e não guarda PDF", r.gravado === false && pastas["whatsapp-envio"].size === 0 && chamadasFila.at(-1)?.p_gravar === false, r);
  confere("prévia junta avisos do banco", (r.avisos as string[]).includes("aviso do banco"), r.avisos);
}
{
  const r = await w({ modelo: "cobranca", numero_os: 1865 });
  const t = String(r.texto);
  confere("cobrança: parcela em aberto, saldo e nome da empresa inteiro", /Parcela 2\/2/.test(t) && /1\.052,71/.test(t) && /01\/12\/2026/.test(t) && !/01\/11\/2026/.test(t)
    && t.startsWith("Olá, Marbrasa Norte Mineradora Ltda!"), t);
  await deve("cobrança de O.S. quitada", () => w({ modelo: "cobranca", numero_os: 1900 }), /nada a receber/);
  tabelas.ordens.push({ id: "o4", numero: 1500, status: "entregue", criado_em: "2025-01-01T12:00:00Z", cliente: { nome: "Antigo" }, veiculo: { placa: "BBB2B22" },
    total: 800, recebido: 0, finalizada_em: null, checkin: { legado: { a_receber: false } } });
  await deve("cobrança de O.S. antiga entregue (conta como paga, recebido 0)", () => w({ modelo: "cobranca", numero_os: 1500 }), /nada a receber/);
  tabelas.ordens.push({ id: "o5", numero: 1501, status: "entregue", criado_em: "2025-01-01T12:00:00Z", cliente: { nome: "Antigo" }, veiculo: { placa: "BBB2B22" },
    total: 800, recebido: 300, checkin: { legado: { a_receber: true } } });
  const ra = await w({ modelo: "cobranca", numero_os: 1501 });
  confere("O.S. antiga marcada a receber: cobra o saldo", /500,00/.test(String(ra.texto)), ra.texto);
}
{
  const r = await w({ modelo: "boas_vindas", cliente_id: "c1", telefone: "27999990000" });
  confere("boas-vindas: primeiro nome e PARAR", /^Olá, João!/.test(String(r.texto)) && /PARAR/.test(String(r.texto)), r.texto);
}
{
  const r = await w({ modelo: "pronto", numero_os: 1887 });
  confere("pronto com O.S. em orçamento: avisa", (r.avisos as string[]).some((a) => /não está marcada como pronta/.test(a)), r.avisos);
  const r2 = await w({ modelo: "orcamento", numero_os: 1887, texto: "Texto ditado pelo Danilo" });
  confere("texto ditado vale por cima do modelo", r2.texto === "Texto ditado pelo Danilo" && (r2.avisos as string[]).some((a) => /texto informado/.test(a)), r2);
}
await deve("modelo desconhecido", () => w({ modelo: "promocao", numero_os: 1887 }), /Modelo desconhecido/);
await deve("modelo sem O.S.", () => w({ modelo: "orcamento" }), /precisa do número da O\.S\./);
await deve("O.S. que não existe", () => w({ modelo: "orcamento", numero_os: 5 }), /O\.S\. 5 não encontrada/);
await deve("adicionais sem itens pendentes", () => w({ modelo: "adicionais", numero_os: 1887 }), /adicionais/);
await deve("nada para mandar", () => w({ numero_os: 1887 }), /texto, um modelo ou o PDF/);

// ----- PDF -----
{
  const r = await w({ modelo: "orcamento", numero_os: 1887, anexo: { fonte: "os", documento: "orcamento" } });
  const arq = (chamadasFila.at(-1)!.p as L).arquivo as L;
  confere("prévia com PDF do orçamento: nome, tamanho e caminho AAAA/MM/uuid.pdf, sem guardar", (r.arquivo as L).nome === "Orcamento_01887_ABC1D23.pdf" && Number((r.arquivo as L).kb) > 0
    && /^2026\/11\/[0-9a-f-]{36}\.pdf$/.test(String(arq.path)) && arq.tipo === "application/pdf" && Number(arq.bytes) > 1000 && pastas["whatsapp-envio"].size === 0, { r, arq });
  const c = await w({ modelo: "orcamento", numero_os: 1887, anexo: { fonte: "os", documento: "orcamento" }, confirmar: true, pedido: "manda o orçamento" });
  const ult = chamadasFila.at(-1)!; const pa = (ult.p as L).arquivo as L;
  const guardado = pastas["whatsapp-envio"].get(String(pa.path));
  confere("confirmado: PDF de verdade na pasta whatsapp-envio e na fila com o mesmo caminho", c.gravado === true && ult.p_gravar === true && !!guardado && ehPdf(guardado!)
    && guardado!.length === pa.bytes && (ult.p as L).modelo === "orcamento" && (ult.p as L).pedido === "manda o orçamento" && (ult.p as L).ordem_numero === 1887 && (ult.p as L).origem === "claude", { c, pa });
}
{
  const antes = pastas["whatsapp-envio"].size; filaRecusa = true;
  const c = await w({ numero_os: 1887, anexo: { fonte: "os" }, confirmar: true });
  confere("fila recusou na hora de gravar: PDF apagado da pasta", c.gravado === false && pastas["whatsapp-envio"].size === antes && (c.erros as string[]).some((e) => /Limite/.test(e)), c);
  filaRecusa = false;
  const os = await w({ numero_os: 1887, anexo: { fonte: "os" } });
  confere("anexo sem número usa a O.S. da mensagem; só o PDF, sem texto", (os.arquivo as L).nome === "OS_01887_ABC1D23.pdf" && os.texto === "", os);
}
{
  const r = await w({ modelo: "cobranca", numero_os: 1865, anexo: { fonte: "boleto" } });
  confere("cobrança + boleto da O.S.", /^261000017|\.pdf$/.test(String((r.arquivo as L).nome)) && /1 boleto/.test(String((r.arquivo as L).origem)), r.arquivo);
  const nf = await w({ numero_os: 1865, texto: "Segue a nota fiscal.", anexo: { fonte: "nf" } });
  confere("NF: só o PDF (o XML não vai pelo WhatsApp)", (nf.arquivo as L).nome === "NF 131.pdf", nf.arquivo);
}
await deve("boleto de outra O.S. não vai para este cliente", () => w({ numero_os: 1887, anexo: { fonte: "boleto", nosso_numero: "261000017" } }), /é da O\.S\. 1865, não da 1887/);
await deve("NF de outra O.S. não vai para este cliente", () => w({ numero_os: 1887, anexo: { fonte: "nf", id: "11111111-1111-1111-1111-111111111111" } }), /é da O\.S\. 1865, não da 1887/);
confere("nome do PDF: longo continua terminando em .pdf; vazio vira documento.pdf", nomeSeguroPdf("x".repeat(200) + ".pdf").length === 120 && nomeSeguroPdf("x".repeat(200) + ".pdf").endsWith(".pdf")
  && nomeSeguroPdf("") === "documento.pdf" && nomeSeguroPdf("NF 131.PDF") === "NF 131.pdf" && nomeSeguroPdf("a/b:c.pdf") === "a-b-c.pdf");
{
  const r = await w({ modelo: "orcamento", numero_os: 1887, texto: "", sem_texto: true, anexo: { fonte: "os", documento: "orcamento" } });
  confere("tela apagou o texto (sem_texto): vai só o PDF", r.texto === "" && (r.arquivo as L).nome === "Orcamento_01887_ABC1D23.pdf", r);
}
await deve("fonte não aceita no WhatsApp", () => w({ numero_os: 1887, anexo: { fonte: "rh", id: "x" } }), /No WhatsApp vai um PDF/);
await deve("O.S. sem NF", () => w({ numero_os: 1887, anexo: { fonte: "nf" } }), /não tem NF anexada/);
{
  // v34 não rodado: banco antigo não devolve "arquivo" na prévia — não deixa sair sem o PDF
  const rpc = db.rpc; db.rpc = (f: string, a: L) => Promise.resolve({ data: { gravado: false, erros: [], avisos: [], texto: (a.p as L).texto }, error: null });
  await deve("sem o v34 no banco: recusa mandar PDF", () => w({ numero_os: 1887, anexo: { fonte: "os" }, confirmar: true }), /v34/);
  db.rpc = rpc;
}

console.log(ok.map((x) => "OK " + x).join("\n"));
console.log("FALHAS", falhas);
if (falhas.length) Deno.exit(1);
