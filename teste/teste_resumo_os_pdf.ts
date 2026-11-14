// Teste do PDF do Resumo de O.S. em aberto (13/11/2026) pelo conector: anexo {fonte:"resumo", numero, de, orcamentos?, itens?}
// da função "email" (e-mail e WhatsApp), com o js/pdfresumo.js e o js/resumoos.js DE VERDADE (aqui lidos da pasta; na função,
// do GitHub travados num commit). Banco e pastas falsos. Rodar: deno run -A teste/teste_resumo_os_pdf.ts
// Confere: quais O.S. entram (em execução e aguardando pagamento; orçamento só com orcamentos=true; fechada, recusada, cancelada
// e a antiga entregue sem "a receber" nunca), cabeçalho, itens, totais, desconto, recebido e falta receber, total geral, uma folha
// no caso do Jeep, várias folhas com "Página i de n", só o quadro geral (itens=false), avisos, erros de uso e o caminho do WhatsApp
// (o resumo é sempre do cliente ou do veículo da O.S. da mensagem).
import { jsPDF } from "npm:jspdf@2.5.1";
import { extractText, getDocumentProxy } from "npm:unpdf@1.4.0";
import { pdfEntrada, pdfOrcamento, pdfOS, usarLeitorImagem } from "../js/pdf.js";
import { pdfResumoOS, usarLeitorImagem as usarLeitorResumo } from "../js/pdfresumo.js";
import { etapaNoResumo, dadosResumoOS as dadosResumoSemTipo, nomeArquivoResumo } from "../js/resumoos.js";
import { nomePdf, pdfBoletos } from "../js/boletopdf.js";
import * as mensagens from "../js/mensagens.js";
import { montarAnexos, type Geradores } from "../supabase/functions/email/anexos.ts";
import { prepararWhatsApp, type Mensagens } from "../supabase/functions/email/whatsapp.ts";

(globalThis as unknown as { jspdf: unknown }).jspdf = { jsPDF };
const usarLeitor = (f: unknown) => { usarLeitorImagem(f); usarLeitorResumo(f); };
const geradores = async (): Promise<Geradores> => ({ pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem: usarLeitor, pdfResumoOS, etapaNoResumo, dadosResumoOS: dadosResumoSemTipo, nomeArquivoResumo });

const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, extra: unknown = "") => (c ? ok : falhas).push(n + (!c && extra !== "" ? " :: " + JSON.stringify(extra).slice(0, 500) : ""));
const deve = async (n: string, f: () => Promise<unknown>, rx: RegExp) => { try { await f(); confere(n, false, "não deu erro"); } catch (e) { confere(n, rx.test((e as Error).message), (e as Error).message); } };
const ler = async (b: Uint8Array) => { const pdf = await getDocumentProxy(b.slice()); return { paginas: pdf.numPages, texto: String((await extractText(pdf, { mergePages: true })).text || "").replace(/\s+/g, " ").replace(/ /g, " ") }; };

const logo = await Deno.readFile(new URL("../icons/logo-preto.png", import.meta.url));
type L = Record<string, unknown>;
const JEEP = { placa: "QOW8427", marca: "JEEP", modelo: "COMPASS", ano: "2018" };
const os = (id: string, numero: number, status: string, cliente_id: string | null, nome: string, veiculo_id: string | null, veiculo: L, reclamacao: string, total: number, criado_em: string, mais: L = {}): L =>
  ({ id, numero, status, cliente_id, veiculo_id, cliente: { nome }, veiculo, reclamacao, total, recebido: 0, desconto: 0, finalizada_em: null, criado_em, checkin: {}, ...mais });
const HILUX = { placa: "PVA4G29", marca: "Toyota", modelo: "HILUX CS4X4", ano: "2014" }, STRADA = { placa: "MSQ8C36", marca: "Fiat", modelo: "STRADA", ano: "2009" }, GOL = { placa: "ABC1234", marca: "VW", modelo: "Gol" };
let n = 0;
const item = (ordem_id: string, tipo: string, descricao: string, qtd: number, valor_unit: number, mais: L = {}): L => ({ id: "i" + (++n), ordem_id, posicao: n, tipo, descricao, qtd, valor_unit, desconto: 0, custo_unit: 77.77, aprovado: true, ...mais });
const tabelas: Record<string, L[]> = {
  config: [{ id: 1, dados: { nome: "DTCAR CENTRO AUTOMOTIVO", cnpj: "49.016.409/0001-95", endereco: "Rod. Gether Lopes de Farias, 491 - São Silvano, Colatina - ES, 29705-390", telefone: "(27) 99769-6545", espelhoLegado: false } }],
  clientes: [
    { id: "cr", codigo: 509, nome: "Renivaldo Luciano Nunes", telefone: "69984042113", cidade: "Santa Rita do Itueto", uf: "MG" },
    { id: "cd", codigo: 1, nome: "Cliente Diversos" },
    { id: "cf", codigo: 77, nome: "Frota Teste Ltda", doc: "11222333000181", telefone: "2733334444", rua: "Av. Brasil, 100", bairro: "Centro", cidade: "Colatina", uf: "ES" },
    { id: "cl", codigo: 80, nome: "Cliente Antigo" }, { id: "cm", codigo: 81, nome: "Muitas OS Ltda" }, { id: "cz", codigo: 82, nome: "Só Fechadas" }],
  veiculos: [{ id: "vj", ...JEEP, cliente_id: "cr" }, { id: "vf1", ...HILUX, cliente_id: "cf" }, { id: "vf2", ...STRADA, cliente_id: "cf" }, { id: "vl", ...GOL, cliente_id: "cl" }],
  ordens: [
    os("j1", 1927, "execucao", "cd", "Cliente Diversos", "vj", JEEP, "Revisão", 2115.24, "2026-11-13T12:04:18Z"),
    os("j2", 1928, "execucao", "cr", "Renivaldo Luciano Nunes", "vj", JEEP, "Revisão freio e suspensão ", 2644.2, "2026-11-13T14:15:00Z"),
    os("j3", 1930, "diagnostico", "cr", "Renivaldo Luciano Nunes", "vj", JEEP, "Orçamento de pneus", 1800, "2026-11-13T15:00:00Z"),
    os("j4", 1800, "entregue", "cr", "Renivaldo Luciano Nunes", "vj", JEEP, "Troca de óleo antiga", 300, "2026-09-01T12:00:00Z", { recebido: 300, finalizada_em: "2026-09-02T13:00:00Z", entregue_em: "2026-09-02T13:00:00Z" }),
    os("f1", 1874, "entregue", "cf", "Frota Teste Ltda", "vf1", HILUX, "REVISAR FREIOS // TROCAR OLEO E FILTROS // REVISAR SUSPENSÃO // REVISAR CRUZETAS // REVISAR ROLAMENTOS DE RODA", 2160.35,
      "2026-10-14T11:58:00Z", { recebido: 1000, entregue_em: "2026-10-20T20:00:00Z" }),
    os("f2", 1873, "pronto", "cf", "Frota Teste Ltda", "vf2", STRADA, "Embreagem", 710, "2026-10-14T11:45:00Z", { desconto: 40 }),
    // sistema antigo: entregue sem "a receber" conta como paga (v17); com "a receber" segue em aberto; recusada e cancelada não entram
    os("l1", 1500, "entregue", "cl", "Cliente Antigo", "vl", GOL, "Antiga paga", 400, "2026-06-01T12:00:00Z", { entregue_em: "2026-06-02T12:00:00Z", checkin: { legado: { numero: 1500 } } }),
    os("l2", 1501, "entregue", "cl", "Cliente Antigo", "vl", GOL, "Antiga a receber", 500, "2026-06-03T12:00:00Z", { entregue_em: "2026-06-04T12:00:00Z", checkin: { legado: { numero: 1501, a_receber: true } } }),
    os("l3", 1502, "recusado", "cl", "Cliente Antigo", "vl", GOL, "Recusada", 900, "2026-06-05T12:00:00Z"),
    os("l4", 1503, "cancelado", "cl", "Cliente Antigo", "vl", GOL, "Cancelada", 950, "2026-06-06T12:00:00Z"),
    os("z1", 1700, "entregue", "cz", "Só Fechadas", null, { placa: "ZZZ9Z99" }, "Fechada", 100, "2026-07-01T12:00:00Z", { recebido: 100, finalizada_em: "2026-07-02T12:00:00Z" }),
    os("z2", 1701, "aguardando", "cz", "Só Fechadas", null, { placa: "ZZZ9Z99" }, "Orçamento enviado", 250, "2026-11-10T12:00:00Z"),
    ...[0, 1, 2].map((k) => os("m" + k, 1940 + k, "execucao", "cm", "Muitas OS Ltda", null, { placa: "MMM" + k + "A00", marca: "Ford", modelo: "Cargo" }, "Revisão " + k, 3000, "2026-11-12T12:00:00Z")),
  ],
  os_itens: [
    ...[["peca", "Óleo 5W30 sintético – 5 L", 1, 290], ["peca", "Filtro de óleo", 1, 28], ["peca", "Filtro de ar do motor", 1, 58.49], ["peca", "Filtro de ar da cabine", 1, 29.05],
      ["peca", "Filtro de combustível", 1, 25], ["servico", "Mão de obra troca de óleo e filtros", 1, 110], ["peca", "Óleo de câmbio – 6 L", 1, 534], ["servico", "Mão de obra troca de óleo do câmbio", 1, 250],
      ["peca", "Trocador de calor do câmbio", 1, 440], ["servico", "SUBST. DO TROCADOR DE CALOR", 1, 180]].map(([t, d, q, v]) => item("j1", String(t), String(d), Number(q), Number(v))),
    item("j1", "peca", "ADITIVO PARA RADIADOR PRONTO USO", 5, 34.14, { codigo: "A010908000" }), item("j1", "peca", "PEÇA RECUSADA PELO CLIENTE", 1, 999, { aprovado: false }),
    ...[["peca", "Pastilha freio traseira", 1, 299], ["peca", "Pastilha freio dianteira", 1, 244.4], ["peca", "Kit amortecedor traseiro", 2, 104], ["peca", "Bucha bandeja", 2, 88.4],
      ["peca", "Disco de Freio Dianteiro", 2, 273], ["servico", "Remoção da Balança para subst/ da bucha Maior", 2, 230], ["servico", "Remoção dos amort. traseiros p/substituição dos kit", 2, 150],
      ["servico", "Alinhamento 3d da direção", 1, 90], ["servico", "Subst. pastilha e disco dianteiro", 2, 80], ["servico", "Subst. pastilha de freio traseira", 2, 80]].map(([t, d, q, v]) => item("j2", String(t), String(d), Number(q), Number(v))),
    item("j3", "peca", "Pneu 225/60 R17", 4, 450, { aprovado: null }), item("j4", "servico", "Troca de óleo", 1, 300),
    item("f1", "peca", "Jogo de pastilhas", 1, 360.35), item("f1", "servico", "Revisão geral", 1, 1800),
    item("f2", "peca", "Kit embreagem", 1, 450), item("f2", "servico", "Troca da embreagem", 1, 200), item("f2", "terceiro", "Retífica do volante", 1, 100),
    item("l1", "servico", "Serviço antigo pago", 1, 400), item("l2", "servico", "Serviço antigo a receber", 1, 500),
    ...[0, 1, 2].flatMap((k) => Array.from({ length: 30 }, (_, j) => item("m" + k, j % 3 ? "peca" : "servico", `Item ${j + 1} da O.S. ${1940 + k}`, 1, 100))),
  ],
  fotos: [], recibos: [],
};
const chamadas: L[] = [];
// deno-lint-ignore no-explicit-any
const db: any = {
  rpc: (f: string, a: L) => { chamadas.push({ f, ...a }); const p = a.p as L, arq = p.arquivo as L | undefined;
    return Promise.resolve({ data: { gravado: false, erros: [], avisos: [], telefone: p.telefone || "5527999990000", texto: p.texto, arquivo: arq ? { nome: arq.nome } : null }, error: null }); },
  from(t: string) {
    const filtros: Array<(x: L) => boolean> = [];
    const exec = () => ({ data: (tabelas[t] || []).filter((x) => filtros.every((f) => f(x))).map((x) => ({ ...x })), error: null });
    // deno-lint-ignore no-explicit-any
    const q: any = { select: () => q, order: () => q, eq: (k: string, v: unknown) => (filtros.push((x) => x[k] === v), q), in: (k: string, vs: unknown[]) => (filtros.push((x) => vs.includes(x[k])), q),
      then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => Promise.resolve(exec()).then(a, b) };
    return q;
  },
  storage: { from: () => ({ download: () => Promise.resolve({ data: null, error: { message: "Object not found" } }) }) },
};
const SITE = "https://gestao.teste";
const fetchOriginal = globalThis.fetch;
globalThis.fetch = ((u: string | URL | Request, i?: RequestInit) => String(u).startsWith(SITE) ? Promise.resolve(String(u) === SITE + "/icons/logo-preto.png" ? new Response(logo) : new Response("", { status: 404 })) : fetchOriginal(u, i)) as typeof fetch;
const anexo = (p: L) => montarAnexos(db, "", p, geradores, SITE);

// ----- regra de quais O.S. entram (linhas do banco)
const et = (id: string) => etapaNoResumo(tabelas.ordens.find((o) => o.id === id));
confere("etapas: execução, pronto e entregue a receber entram", et("j1") === "execucao" && et("f2") === "pagamento" && et("f1") === "pagamento", [et("j1"), et("f2"), et("f1")]);
confere("etapas: orçamento (em elaboração e enviado)", et("j3") === "orcamento" && et("z2") === "orcamento");
confere("etapas: fechada, recusada e cancelada ficam de fora", et("j4") === "" && et("l3") === "" && et("l4") === "" && et("z1") === "");
confere("etapas: antiga entregue sem 'a receber' = paga; com 'a receber' = em aberto", et("l1") === "" && et("l2") === "pagamento", [et("l1"), et("l2")]);

// ----- itens na ordem da O.S.: pela posição e, no empate, pela hora de entrada (a lista chega fora de ordem)
{
  // deno-lint-ignore no-explicit-any
  const dadosResumoOS = dadosResumoSemTipo as unknown as (p: L) => any;
  const o = os("x1", 1, "execucao", "cr", "X", "vj", JEEP, "", 0, "2026-11-13T12:00:00Z");
  const d = dadosResumoOS({ ordens: [o], itens: [
    { id: "c", ordem_id: "x1", tipo: "peca", descricao: "Terceiro", qtd: 1, valor_unit: 1, aprovado: true, posicao: 0, criado_em: "2026-11-13T12:03:00Z" },
    { id: "a", ordem_id: "x1", tipo: "peca", descricao: "Quarto", qtd: 1, valor_unit: 1, aprovado: true, posicao: 5, criado_em: "2026-11-13T12:00:00Z" },
    { id: "b", ordem_id: "x1", tipo: "peca", descricao: "Primeiro", qtd: 1, valor_unit: 1, aprovado: true, posicao: 0, criado_em: "2026-11-13T12:01:00Z" },
    { id: "d", ordem_id: "x1", tipo: "peca", descricao: "Segundo", qtd: 1, valor_unit: 1, aprovado: true, posicao: 0, criado_em: "2026-11-13T12:02:00Z" }] });
  confere("itens na ordem da O.S. (posição, depois hora de entrada)", d.blocos[0].pecas.map((i: L) => i.descricao).join() === "Primeiro,Segundo,Terceiro,Quarto", d.blocos[0].pecas.map((i: L) => i.descricao));
  confere("falta receber nunca fica negativo e soma certo", (() => { const r = dadosResumoOS({ ordens: [{ ...o, recebido: 50 }], itens: [{ id: "a", ordem_id: "x1", tipo: "servico", descricao: "S", qtd: 1, valor_unit: 30, aprovado: true }] });
    return r.blocos[0].total === 30 && r.blocos[0].falta === 0 && r.soma.recebido === 50 && r.colunas.map((c: L) => c.t).join() === "Total,Recebido,Falta receber"; })());
}

// ----- pelo veículo: o caso do Jeep (duas O.S. em execução, uma em nome de "Cliente Diversos")
const r1 = await anexo({ fonte: "resumo", numero: 1928, de: "veiculo" });
const a1 = r1.arquivos[0], p1 = await ler(a1.bytes), t1 = p1.texto;
await Deno.writeFile("/tmp/resumo_jeep.pdf", a1.bytes);
confere("jeep: nome do arquivo", a1.nome === "Resumo_OS_QOW8427.pdf", a1.nome);
confere("jeep: origem com as O.S., o total e o que falta receber", a1.origem === "Resumo de 2 O.S. em aberto do veículo QOW-8427 (O.S. 1927, 1928): total R$ 4.759,44, falta receber R$ 4.759,44", a1.origem);
for (const k of ["DTCAR CENTRO AUTOMOTIVO", "Rod. Gether Lopes de Farias, 491", "Tel. (27) 99769-6545 · CNPJ 49.016.409/0001-95", "RESUMO DE ORDENS DE SERVIÇO", "Nº 01927 e 01928", "Emitido em",
  "CLIENTE", "Renivaldo Luciano Nunes", "(cód. 509)", "(69) 98404-2113", "Santa Rita do Itueto/MG", "VEÍCULO", "QOW-8427", "JEEP COMPASS", "2018",
  "ORDEM DE SERVIÇO Nº 01927", "· Revisão", "Aberta em 13/11/2026, 09:04", "Aprovado · em execução", "PRODUTOS E PEÇAS", "REF.", "Óleo 5W30 sintético – 5 L", "A010908000", "R$ 170,70",
  "Total de produtos", "R$ 1.575,24", "SERVIÇOS", "Total de serviços", "R$ 540,00", "Total da O.S. 01927", "R$ 2.115,24",
  "ORDEM DE SERVIÇO Nº 01928", "Revisão freio e suspensão", "Aberta em 13/11/2026, 11:15", "Disco de Freio Dianteiro", "Remoção dos amort. traseiros p/substituição dos kit", "R$ 1.474,20", "R$ 1.170,00",
  "Total da O.S. 01928", "R$ 2.644,20", "RESUMO GERAL", "PRODUTOS", "O.S. 01927 · Revisão", "O.S. 01928 · Revisão freio e suspensão", "TOTAL GERAL", "R$ 3.049,44", "R$ 1.710,00", "R$ 4.759,44",
  "os valores podem mudar até o fechamento", "Nenhum valor foi recebido até a emissão", "NÃO VALE COMO RECIBO DE PAGAMENTO"]) confere("jeep: tem " + k, t1.includes(k), k);
confere("jeep (21 itens): UMA folha A4, sem 'Página 1 de'", p1.paginas === 1 && !t1.includes("Página 1 de"), p1.paginas);
confere("jeep: orçamento, O.S. fechada e item recusado ficam de fora", !t1.includes("01930") && !t1.includes("Pneu 225") && !t1.includes("01800") && !t1.includes("PEÇA RECUSADA"));
confere("jeep: custo das peças nunca aparece", !t1.includes("77,77") && !/custo/i.test(t1));
confere("jeep: sem colunas de recebido", !t1.includes("RECEBIDO") && !t1.includes("Falta receber"));
confere("jeep: avisos (nomes diferentes e orçamento de fora)", r1.avisos.length === 2 && r1.avisos.some((a) => /nomes diferentes \(Cliente Diversos; Renivaldo Luciano Nunes\): o resumo sai no nome de Renivaldo/.test(a))
  && r1.avisos.some((a) => /Ficou de fora o orçamento ainda não aprovado \(O\.S\. 1930\)/.test(a)), r1.avisos);
// a O.S. de referência pode ser qualquer uma do veículo: dá o mesmo resumo
const r1b = await anexo({ fonte: "resumo", numero: 1927, de: "veiculo" });
confere("jeep: referência pela 1927 dá o mesmo resumo", r1b.arquivos[0].origem === a1.origem, r1b.arquivos[0].origem);
// pelo cliente da 1928: só a O.S. em nome dele (a 1927 está em "Cliente Diversos")
const r1c = await anexo({ fonte: "resumo", numero: 1928, de: "cliente" });
const t1c = (await ler(r1c.arquivos[0].bytes)).texto;
confere("pelo cliente da 1928: só a 1928", r1c.arquivos[0].nome === "Resumo_OS_cliente_509.pdf" && t1c.includes("Nº 01928") && !t1c.includes("01927") && /do cliente Renivaldo Luciano Nunes \(O\.S\. 1928\)/.test(r1c.arquivos[0].origem), r1c.arquivos[0].origem);

// ----- com os orçamentos
const r2 = await anexo({ fonte: "resumo", numero: 1928, de: "veiculo", orcamentos: true });
const p2 = await ler(r2.arquivos[0].bytes), t2 = p2.texto;
await Deno.writeFile("/tmp/resumo_jeep_orc.pdf", r2.arquivos[0].bytes);
confere("com orçamento: entra com a etapa escrita e o título vira a quantidade", t2.includes("3 O.S. em aberto") && t2.includes("ORDEM DE SERVIÇO Nº 01930") && t2.includes("Orçamento em elaboração") && t2.includes("Pneu 225/60 R17"), t2.slice(0, 300));
confere("com orçamento: total geral soma os três e a nota avisa", t2.includes("R$ 6.559,44") && t2.includes("Orçamento ainda não aprovado está indicado na própria O.S."));
confere("com orçamento: aviso na prévia", r2.avisos.some((a) => /inclui orçamento ainda não aprovado \(O\.S\. 1930\)/.test(a)), r2.avisos);
// referência num orçamento sem pedir orçamentos: sai o resto, com aviso
const r2b = await anexo({ fonte: "resumo", numero: 1930, de: "veiculo" });
confere("referência num orçamento: fica de fora, com aviso", /\(O\.S\. 1927, 1928\)/.test(r2b.arquivos[0].origem) && r2b.avisos.some((a) => /A O\.S\. 1930 não entra neste resumo \(é orçamento não aprovado\)/.test(a)), r2b.avisos);

// ----- só o quadro geral
const r3 = await anexo({ fonte: "resumo", numero: 1928, de: "veiculo", itens: false });
const p3 = await ler(r3.arquivos[0].bytes), t3 = p3.texto;
await Deno.writeFile("/tmp/resumo_jeep_quadro.pdf", r3.arquivos[0].bytes);
confere("só o quadro: sem os itens e sem as faixas", !t3.includes("Disco de Freio") && !t3.includes("ORDEM DE SERVIÇO Nº") && !t3.includes("Total de produtos"), t3);
confere("só o quadro: etapa escrita em cada linha e total geral", (t3.match(/Aprovado · em execução/g) || []).length === 2 && t3.includes("O.S. 01927 · Revisão") && t3.includes("R$ 4.759,44") && t3.includes("TOTAL GERAL"));
confere("só o quadro: origem avisa", /só o quadro geral/.test(r3.arquivos[0].origem), r3.arquivos[0].origem);

// ----- pelo cliente: frota com dois veículos, desconto, terceiros e recebimento parcial
const r4 = await anexo({ fonte: "resumo", numero: 1873, de: "cliente" });
const a4 = r4.arquivos[0], p4 = await ler(a4.bytes), t4 = p4.texto;
await Deno.writeFile("/tmp/resumo_frota.pdf", a4.bytes);
confere("frota: nome do arquivo e origem", a4.nome === "Resumo_OS_cliente_77.pdf" && a4.origem === "Resumo de 2 O.S. em aberto do cliente Frota Teste Ltda (O.S. 1873, 1874): total R$ 2.870,35, falta receber R$ 1.870,35", [a4.nome, a4.origem]);
for (const k of ["Nº 01873 e 01874", "Frota Teste Ltda", "(cód. 77)", "11.222.333/0001-81", "(27) 3333-4444", "Av. Brasil, 100, Centro, Colatina/ES", "VEÍCULOS", "MSQ8C36", "Fiat STRADA", "PVA4G29", "Toyota HILUX CS4X4",
  "ORDEM DE SERVIÇO Nº 01873", "· MSQ8C36 Fiat STRADA · Embreagem", "Aguardando pagamento · veículo no pátio", "Aguardando pagamento · veículo entregue",
  "Reclamação:", "REVISAR FREIOS // TROCAR OLEO E FILTROS", "REVISAR ROLAMENTOS DE RODA", "SERVIÇOS DE TERCEIROS", "Retífica do volante", "Total de serviços de terceiros",
  "Desconto", "- R$ 40,00", "Total da O.S. 01873", "R$ 710,00", "Total da O.S. 01874", "R$ 2.160,35", "Recebido", "R$ 1.000,00", "Falta receber", "R$ 1.160,35",
  "RESUMO GERAL", "TOTAL", "RECEBIDO", "FALTA RECEBER", "O.S. 01874 · PVA4G29 · REVISAR FREIOS", "R$ 2.870,35", "R$ 1.870,35"]) confere("frota: tem " + k, t4.includes(k), k);
confere("frota: uma folha, sem a frase de nada recebido e sem avisos", p4.paginas === 1 && !t4.includes("Nenhum valor foi recebido") && r4.avisos.length === 0, [p4.paginas, r4.avisos]);
confere("frota (com recebimento): quadro geral sem as colunas de produtos e serviços", !t4.includes("PRODUTOS E PEÇAS RESUMO") && !/RESUMO GERAL\s+PRODUTOS/.test(t4), t4.slice(-700));
// pelo veículo da 1873: só ela, sem recebimento → produtos, serviços, terceiros e total
const r4b = await anexo({ fonte: "resumo", numero: 1873, de: "veiculo" });
const t4b = (await ler(r4b.arquivos[0].bytes)).texto;
confere("só a 1873 pelo veículo: Nº 01873, quadro com terceiros e total com o desconto", t4b.includes("Nº 01873") && !t4b.includes("01874") && /RESUMO GERAL\s+PRODUTOS\s+SERVIÇOS\s+TERCEIROS\s+TOTAL/.test(t4b)
  && t4b.includes("R$ 710,00") && r4b.arquivos[0].nome === "Resumo_OS_MSQ8C36.pdf", t4b.slice(-600));

// ----- sistema antigo: paga fica de fora, "a receber" entra; recusada e cancelada não
const r5 = await anexo({ fonte: "resumo", numero: 1500, de: "cliente" });
const t5 = (await ler(r5.arquivos[0].bytes)).texto;
confere("antigas: só a 'a receber' entra", /\(O\.S\. 1501\)/.test(r5.arquivos[0].origem) && t5.includes("Serviço antigo a receber") && !t5.includes("Serviço antigo pago") && !t5.includes("01502") && !t5.includes("01503"), r5.arquivos[0].origem);
confere("antigas: aviso de que a referência (paga) não entra", r5.avisos.some((a) => /A O\.S\. 1500 não entra neste resumo \(não está em aberto\)/.test(a)), r5.avisos);

// ----- várias folhas: 3 O.S. de 30 itens — cada O.S. inteira numa folha, com "Página i de n"
const r6 = await anexo({ fonte: "resumo", numero: 1940, de: "cliente" });
const p6 = await ler(r6.arquivos[0].bytes);
await Deno.writeFile("/tmp/resumo_muitas.pdf", r6.arquivos[0].bytes);
confere("muitas: 3 O.S. no título e várias folhas com o rodapé de página", p6.texto.includes("3 O.S. em aberto") && p6.paginas >= 3 && p6.texto.includes(`Página 1 de ${p6.paginas}`) && p6.texto.includes(`Página ${p6.paginas} de ${p6.paginas}`)
  && p6.texto.includes("Resumo de O.S. · Muitas OS Ltda · DTCAR CENTRO AUTOMOTIVO"), [p6.paginas, p6.texto.slice(-300)]);
confere("muitas: total geral de R$ 9.000,00", p6.texto.includes("R$ 9.000,00") && p6.texto.includes("Item 30 da O.S. 1942"));
{ // cada O.S. (que cabe numa folha) começa e termina na mesma página
  const pdf = await getDocumentProxy(r6.arquivos[0].bytes.slice()); const onde: Record<string, number> = {};
  for (let pg = 1; pg <= pdf.numPages; pg++) for (const it of (await (await pdf.getPage(pg)).getTextContent()).items as Array<{ str: string }>) {
    for (const k of [0, 1, 2]) { if (it.str.includes("ORDEM DE SERVIÇO Nº 0194" + k)) onde["ini" + k] = pg; if (it.str.includes("Total da O.S. 0194" + k)) onde["fim" + k] = pg; }
  }
  confere("muitas: nenhuma O.S. cortada entre folhas", [0, 1, 2].every((k) => onde["ini" + k] && onde["ini" + k] === onde["fim" + k]), onde);
}

// ----- erros de uso
await deve("sem dizer de quem", () => anexo({ fonte: "resumo", numero: 1928 }), /informe de: "cliente".*ou "veiculo"/);
await deve("sem O.S. de referência", () => anexo({ fonte: "resumo", de: "cliente" }), /informe o número de uma O\.S\./);
await deve("O.S. que não existe", () => anexo({ fonte: "resumo", numero: 5, de: "cliente" }), /O\.S\. 5 não encontrada/);
await deve("O.S. sem veículo do cadastro", () => anexo({ fonte: "resumo", numero: 1940, de: "veiculo" }), /não tem veículo do cadastro/);
await deve("cliente só com fechada e orçamento: explica e ensina a incluir o orçamento", () => anexo({ fonte: "resumo", numero: 1700, de: "cliente" }), /Nenhuma O\.S\. aprovada ou aguardando pagamento deste cliente\. Há orçamento não aprovado \(O\.S\. 1701\).*orcamentos=true/);
const r7 = await anexo({ fonte: "resumo", numero: 1700, de: "cliente", orcamentos: true });
confere("mesmo cliente com orcamentos=true: sai o orçamento", /\(O\.S\. 1701\)/.test(r7.arquivos[0].origem) && (await ler(r7.arquivos[0].bytes)).texto.includes("Orçamento enviado, aguardando aprovação"), r7.arquivos[0].origem);
await deve("função antiga (sem o gerador): pede para publicar de novo", () => montarAnexos(db, "", { fonte: "resumo", numero: 1928, de: "veiculo" },
  async () => ({ pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem: usarLeitor }), SITE), /publique de novo/);
await deve("fonte desconhecida: lista o resumo entre as opções", () => anexo({ fonte: "planilha" }), /"os", "resumo", "boleto"/);

// ----- WhatsApp: o resumo é sempre do cliente ou do veículo da O.S. da mensagem
const zap = (p: L) => prepararWhatsApp({ usuario: db, adm: db, site: SITE, geradores, mensagens: async () => mensagens as unknown as Mensagens }, p);
const w1 = await zap({ texto: "Segue o resumo.", numero_os: 1928, telefone: "5569984042113", anexo: { fonte: "resumo", de: "veiculo" } });
const arq1 = w1.arquivo as L;
confere("whatsapp: prévia com o PDF do resumo da O.S. da mensagem", arq1 && arq1.nome === "Resumo_OS_QOW8427.pdf" && /Resumo de 2 O\.S\. em aberto do veículo QOW-8427/.test(String(arq1.origem)), w1);
confere("whatsapp: avisos do resumo chegam na prévia", (w1.avisos as string[]).some((a) => /nomes diferentes/.test(a)), w1.avisos);
await deve("whatsapp: resumo de outra O.S. que não a da mensagem é recusado", () => zap({ texto: "x", numero_os: 1928, anexo: { fonte: "resumo", de: "cliente", numero: 1873 } }), /O anexo é da O\.S\. 1873, mas a mensagem é da O\.S\. 1928/);
await deve("whatsapp: sem a O.S. da mensagem não sai resumo", () => zap({ texto: "x", telefone: "5527999990000", anexo: { fonte: "resumo", de: "cliente" } }), /informe a O\.S\. da mensagem/);

// ----- a O.S. normal não mudou
const r8 = await anexo({ fonte: "os", numero: 1928, documento: "os", fotos: false });
const t8 = (await ler(r8.arquivos[0].bytes)).texto;
confere("O.S. normal: continua igual", r8.arquivos[0].nome === "OS_01928_QOW8427.pdf" && t8.includes("ORDEM DE SERVIÇO") && /NÃO VALE COMO RECIBO/.test(t8) && !t8.includes("RESUMO"), r8.arquivos[0].nome);

globalThis.fetch = fetchOriginal;
for (const f of falhas) console.log("FALHOU:", f);
console.log(`${ok.length} OK, ${falhas.length} falha(s)`);
Deno.exit(falhas.length ? 1 : 0);
