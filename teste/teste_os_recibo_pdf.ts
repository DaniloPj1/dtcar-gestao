// Teste do PDF da O.S. Recibo (12/11/2026) pelo conector: anexo {fonte:"os", documento:"recibo", motor?} da função "email"
// (WhatsApp e e-mail), com o js/pdfrecibo.js DE VERDADE (aqui lido da pasta; na função, do GitHub travado num commit).
// Banco e pastas falsos. Rodar: deno run -A teste/teste_os_recibo_pdf.ts
// Confere: texto do PDF (cliente, veículo, itens, total, "Recebemos de", forma, prazo e validade da garantia, cuidados do motor);
// motor=false tira os cuidados e o 1.000 km das exclusões; O.S. não paga é recusada; O.S. do sistema antigo paga sem recibo
// usa o total da O.S. (com aviso); recibo cancelado não conta; e a O.S. normal (documento "os") continua "NÃO VALE COMO RECIBO".
import { jsPDF } from "npm:jspdf@2.5.1";
import { extractText, getDocumentProxy } from "npm:unpdf@1.4.0";
import { pdfEntrada, pdfOrcamento, pdfOS, usarLeitorImagem } from "../js/pdf.js";
import { pdfOSRecibo, usarLeitorImagem as usarLeitorRecibo } from "../js/pdfrecibo.js";
import { osQuitada } from "../js/osrecibo.js";
import { nomePdf, pdfBoletos } from "../js/boletopdf.js";
import { montarAnexos, type Geradores } from "../supabase/functions/email/anexos.ts";

(globalThis as unknown as { jspdf: unknown }).jspdf = { jsPDF };
const usarLeitor = (f: unknown) => { usarLeitorImagem(f); usarLeitorRecibo(f); };
const geradores = async (): Promise<Geradores> => ({ pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem: usarLeitor, pdfOSRecibo, osQuitada });

const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, extra: unknown = "") => (c ? ok : falhas).push(n + (!c && extra !== "" ? " :: " + JSON.stringify(extra).slice(0, 400) : ""));
const deve = async (n: string, f: () => Promise<unknown>, rx: RegExp) => { try { await f(); confere(n, false, "não deu erro"); } catch (e) { confere(n, rx.test((e as Error).message), (e as Error).message); } };
const texto = async (b: Uint8Array) => String((await extractText(await getDocumentProxy(b.slice()), { mergePages: true })).text || "").replace(/\s+/g, " ").replace(/ /g, " ");

const logo = await Deno.readFile(new URL("../icons/logo-preto.png", import.meta.url));
type L = Record<string, unknown>;
const tabelas: Record<string, L[]> = {
  config: [{ id: 1, dados: { nome: "DTCar Centro Automotivo", cnpj: "49.016.409/0001-95", endereco: "Rod. Gether Lopes de Farias, 491 – São Silvano – Colatina/ES", telefone: "(27) 99247-0140", garantiaDias: 90, espelhoLegado: false } }],
  ordens: [
    { id: "p1", numero: 1854, status: "entregue", criado_em: "2026-10-06T17:54:00Z", entregue_em: "2026-11-12T19:00:00Z", finalizada_em: "2026-11-12T19:05:00Z", recebido: 3315,
      km_saida: 182340, garantia_dias: 90, total: 3315, desconto: 0, mecanico_nome: "FRANCISCO", forma_pagamento: "Pix", cliente_id: "c1",
      cliente: { nome: "Miqueias", telefone: "27995302524" }, veiculo: { placa: "MRE1D03", marca: "Volkswagen", modelo: "Parati 1.6", ano: "1999", cor: "Vermelha" } },
    { id: "p2", numero: 1900, status: "entregue", entregue_em: "2026-11-10T12:00:00Z", finalizada_em: null, recebido: 0, total: 500, criado_em: "2026-11-09T12:00:00Z",
      cliente: { nome: "Cliente A Receber" }, veiculo: { placa: "AAA1B22" } },
    { id: "p3", numero: 1700, status: "entregue", entregue_em: "2026-06-01T12:00:00Z", finalizada_em: "2026-06-01T12:00:00Z", recebido: 0, total: 400, forma_pagamento: "À vista",
      criado_em: "2026-06-01T10:00:00Z", checkin: { legado: { numero: 1700 } }, cliente: { nome: "Cliente Antigo" }, veiculo: { placa: "BBB2C33" } },
    { id: "p4", numero: 1910, status: "execucao", total: 100, recebido: 0, criado_em: "2026-11-11T12:00:00Z", cliente: { nome: "Em execução" }, veiculo: { placa: "CCC3D44" } },
  ],
  os_itens: [
    { id: "i1", ordem_id: "p1", posicao: 1, tipo: "peca", descricao: "CABEÇOTE COMPLETO (MONTADO)", qtd: 1, valor_unit: 2800, aprovado: true },
    { id: "i2", ordem_id: "p1", posicao: 2, tipo: "peca", descricao: "JUNTA CABECOTE VW GOL 1.6/1.8 (METALICA)", qtd: 1, valor_unit: 0, aprovado: true },
    { id: "i3", ordem_id: "p1", posicao: 3, tipo: "servico", descricao: "SERVIÇO DE MOTOR", qtd: 1, valor_unit: 515, aprovado: true },
    { id: "i4", ordem_id: "p1", posicao: 4, tipo: "peca", descricao: "FILTRO DE AR (RECUSADO)", qtd: 1, valor_unit: 27.55, aprovado: false },
    { id: "i5", ordem_id: "p3", posicao: 1, tipo: "servico", descricao: "REVISÃO", qtd: 1, valor_unit: 400, aprovado: true },
  ],
  recibos: [
    { id: "r1", ordem_id: "p1", numero: 901, data: "2026-11-10", forma: "Dinheiro", valor: 1000, cancelado: false },
    { id: "r2", ordem_id: "p1", numero: 902, data: "2026-11-12", forma: "Pix", valor: 2315, cancelado: false },
    { id: "r3", ordem_id: "p1", numero: 903, data: "2026-11-12", forma: "Cartão", valor: 999, cancelado: true },
  ],
  clientes: [{ id: "c1", nome: "Miqueias", doc: "12345678909" }],
  fotos: [],
};
// deno-lint-ignore no-explicit-any
const db: any = {
  from(t: string) {
    const filtros: Array<[string, unknown]> = [];
    const exec = () => ({ data: (tabelas[t] || []).filter((x) => filtros.every(([k, v]) => x[k] === v)).map((x) => ({ ...x })), error: null });
    // deno-lint-ignore no-explicit-any
    const q: any = { select: () => q, order: () => q, eq: (k: string, v: unknown) => (filtros.push([k, v]), q), then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => Promise.resolve(exec()).then(a, b) };
    return q;
  },
  storage: { from: () => ({ download: () => Promise.resolve({ data: null, error: { message: "Object not found" } }) }) },
};
const SITE = "https://gestao.teste";
const busca = (u: string) => Promise.resolve(u === SITE + "/icons/logo-preto.png" ? new Response(logo) : new Response("", { status: 404 }));
const fetchOriginal = globalThis.fetch;
globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => String(u).startsWith(SITE) ? busca(String(u)) : fetchOriginal(u, i)) as typeof fetch;
const anexo = (p: L) => montarAnexos(db, "", p, geradores, SITE);

// ----- O.S. paga, com os cuidados do motor (padrão)
const r1 = await anexo({ fonte: "os", numero: 1854, documento: "recibo" });
const a1 = r1.arquivos[0], t1 = await texto(a1.bytes);
confere("recibo: nome do arquivo", a1.nome === "OS_Recibo_01854_MRE1D03.pdf", a1.nome);
confere("recibo: origem diz com os cuidados do motor", /O\.S\. Recibo, com os cuidados do motor/.test(a1.origem), a1.origem);
for (const k of ["RECIBO DE ORDEM DE SERVIÇO", "O.S. Nº 01854", "Miqueias", "123.456.789-09", "MRE1D03", "Volkswagen – Parati 1.6 – 1999 – Vermelha", "182.340", "FRANCISCO",
  "CABEÇOTE COMPLETO (MONTADO)", "SERVIÇO DE MOTOR", "VALOR TOTAL DA O.S.: R$ 3.315,00", "Recebemos de Miqueias", "R$ 3.315,00", "três mil", "pago em dinheiro, Pix",
  "dando plena quitação", "10/11/2026 · Dinheiro · R$ 1.000,00", "12/11/2026 · Pix · R$ 2.315,00", "90 (noventa) dias", "(12/11/2026), válida até 10/02/2027",
  "(27) 99247-0140", "aos 1.000 km e os cuidados listados abaixo", "CUIDADOS PARA NÃO PERDER A GARANTIA", "TROCA DE ÓLEO E FILTRO DE ÓLEO AOS 1.000 KM",
  "3.000 rpm", "Colatina/ES, 12/11/2026", "Declaro ter recebido o veículo"]) confere("recibo com motor: tem " + k, t1.includes(k), k);
confere("recibo: item recusado fica de fora", !t1.includes("FILTRO DE AR (RECUSADO)"));
confere("recibo: recibo cancelado não conta", !t1.includes("Cartão") && !t1.includes("999,00"));
confere("recibo: não diz que não vale como recibo", !/NÃO VALE COMO RECIBO/i.test(t1));
confere("recibo: sem avisos (O.S. paga com recibos, fora da transição)", r1.avisos.length === 0, r1.avisos);
await Deno.writeFile("/tmp/os_recibo_motor.pdf", a1.bytes);

// ----- 12 pagamentos: a lista quebra em várias linhas sem invadir o título seguinte
const salvos = tabelas.recibos;
tabelas.recibos = Array.from({ length: 12 }, (_, n) => ({ id: "m" + n, ordem_id: "p1", numero: 950 + n, data: `2026-11-${String(n + 1).padStart(2, "0")}`, forma: "Transferência", valor: 276.25, cancelado: false }));
const rm = await anexo({ fonte: "os", numero: 1854, documento: "recibo" });
const tm = await texto(rm.arquivos[0].bytes);
confere("12 pagamentos: todos na lista", Array.from({ length: 12 }, (_, n) => `${String(n + 1).padStart(2, "0")}/11/2026 · Transferência · R$ 276,25`).every((k) => tm.includes(k)), tm.slice(800, 2200));
{ // posição: a última linha da lista fica acima da faixa "PRAZO E CONDIÇÕES"
  const pdf = await getDocumentProxy(rm.arquivos[0].bytes.slice());
  const ys: Record<string, number[]> = {};
  for (let pg = 1; pg <= pdf.numPages; pg++) {
    const c = await (await pdf.getPage(pg)).getTextContent();
    for (const it of c.items as Array<{ str: string; transform: number[] }>) {
      const k = it.str.includes("12/11/2026 · Transferência") ? "ultima" : it.str.includes("PRAZO E CONDIÇÕES DA GARANTIA") ? "prazo" : "";
      if (k) (ys[k] = ys[k] || []).push(pg * 10000 - it.transform[5]);
    }
  }
  confere("12 pagamentos: a lista termina antes do título seguinte", !!ys.ultima && !!ys.prazo && Math.max(...ys.ultima) + 8 < Math.min(...ys.prazo), ys);
}
await Deno.writeFile("/tmp/os_recibo_12pag.pdf", rm.arquivos[0].bytes);
tabelas.recibos = salvos;

// ----- sem os cuidados do motor
const r2 = await anexo({ fonte: "os", numero: 1854, documento: "recibo", motor: false });
const t2 = await texto(r2.arquivos[0].bytes);
confere("sem motor: sem a caixa de cuidados", !t2.includes("CUIDADOS PARA NÃO PERDER") && !t2.includes("3.000 rpm"), t2.slice(-600));
confere("sem motor: exclusões sem o 1.000 km", t2.includes("falta da manutenção recomendada.") && !t2.includes("1.000 km"));
confere("sem motor: mantém prazo e condições", t2.includes("PRAZO E CONDIÇÕES DA GARANTIA") && t2.includes("90 (noventa) dias"));
confere("sem motor: origem", /sem os cuidados do motor/.test(r2.arquivos[0].origem));
await Deno.writeFile("/tmp/os_recibo_sem_motor.pdf", r2.arquivos[0].bytes);

// ----- O.S. não paga e em execução: recusadas
await deve("não paga (entregue a receber): recusa", () => anexo({ fonte: "os", numero: 1900, documento: "recibo" }), /não está paga/);
await deve("em execução: recusa", () => anexo({ fonte: "os", numero: 1910, documento: "recibo" }), /não está paga/);
await deve("documento desconhecido: explica as opções", () => anexo({ fonte: "os", numero: 1854, documento: "nota" }), /os, orcamento, entrada ou recibo/);

// ----- O.S. do sistema antigo, paga sem recibo lançado
const r3 = await anexo({ fonte: "os", numero: 1700, documento: "recibo" });
const t3 = await texto(r3.arquivos[0].bytes);
confere("antiga sem recibo: valor = total da O.S.", t3.includes("a importância de R$ 400,00") && t3.includes("pago em à vista"), t3.slice(0, 900));
confere("antiga sem recibo: aviso", r3.avisos.some((a) => /não tem recibo lançado/.test(a)), r3.avisos);

// ----- função sem o gerador novo (publicada antes): mensagem clara
await deve("função antiga: pede para publicar de novo", () => montarAnexos(db, "", { fonte: "os", numero: 1854, documento: "recibo" },
  async () => ({ pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem: usarLeitor }), SITE), /publique de novo/);

// ----- a O.S. normal não mudou
const r4 = await anexo({ fonte: "os", numero: 1854, documento: "os", fotos: false });
const t4 = await texto(r4.arquivos[0].bytes);
confere("O.S. normal: continua igual (ORDEM DE SERVIÇO, não vale como recibo)", t4.includes("ORDEM DE SERVIÇO") && /NÃO VALE COMO RECIBO/.test(t4) && !t4.includes("Recebemos de"));
confere("O.S. normal: nome do arquivo de sempre", r4.arquivos[0].nome === "OS_01854_MRE1D03.pdf", r4.arquivos[0].nome);

globalThis.fetch = fetchOriginal;
for (const f of falhas) console.log("FALHOU:", f);
console.log(`${ok.length} OK, ${falhas.length} falha(s)`);
Deno.exit(falhas.length ? 1 : 0);
