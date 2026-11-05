// Teste dos anexos do e-mail (supabase/functions/email/anexos.ts + enviar/responder em acoes.ts) com os PDFs DE VERDADE:
// usa os mesmos js/pdf.js e js/boletopdf.js do site (aqui lidos da pasta, na função lidos do site publicado) e o jsPDF da mesma versão.
// Banco, pastas do Supabase e Microsoft são falsos.
// Rodar: deno run -A teste/teste_anexos.ts
// Confere: PDF da O.S./orçamento/checklist com logo e fotos; sem fotos a pedido; boleto (um ou todos em aberto da O.S.);
// NF anexada à O.S. (PDF + XML); documento do RH; anexo de e-mail recebido; limites (5 arquivos, 3 MB); prévia mostra os
// anexos e NÃO envia; confirmado vai no sendMail/reply como fileAttachment e o histórico guarda só os nomes.
import { jsPDF } from "npm:jspdf@2.5.1";
import { extractText, getDocumentProxy } from "npm:unpdf@1.4.0";
import { pdfEntrada, pdfOrcamento, pdfOS, usarLeitorImagem } from "../js/pdf.js";
import { nomePdf, pdfBoletos } from "../js/boletopdf.js";
import { somaDias, fmtData, fmtDataHora } from "../js/util.js";
import { medirImagem, montarAnexos, MAX_BYTES, type Geradores } from "../supabase/functions/email/anexos.ts";
import { tratar, type Deps } from "../supabase/functions/email/acoes.ts";

(globalThis as unknown as { jspdf: unknown }).jspdf = { jsPDF };
const geradores = async (): Promise<Geradores> => ({ pdfOS, pdfOrcamento, pdfEntrada, pdfBoletos, nomePdf, usarLeitorImagem });

const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, extra: unknown = "") => (c ? ok : falhas).push(n + (!c && extra !== "" ? " :: " + JSON.stringify(extra).slice(0, 400) : ""));
const deve = async (n: string, f: () => Promise<unknown>, rx: RegExp) => { try { await f(); confere(n, false, "não deu erro"); } catch (e) { confere(n, rx.test((e as Error).message), (e as Error).message); } };
const texto = async (b: Uint8Array) => String((await extractText(await getDocumentProxy(b.slice()), { mergePages: true })).text || "");
const ehPdf = (b: Uint8Array) => new TextDecoder().decode(b.slice(0, 5)) === "%PDF-";

// ----- datas no horário de Brasília (a função roda em UTC) -----
confere("datas: entrega às 22h de Brasília (01h UTC do dia seguinte) conta a garantia do dia certo", somaDias("2026-11-05T01:00:00Z", 90) === "2026-02-02".replace("2026-02-02", "2027-02-02"), somaDias("2026-11-05T01:00:00Z", 90));
confere("datas: data pura não muda de dia", fmtData("2026-11-04") === "04/11/2026" && somaDias("2026-11-04", 1) === "2026-11-05");
confere("datas: hora mostrada em Brasília", fmtDataHora("2026-11-05T01:00:00Z").startsWith("04/11/2026") && /22:00/.test(fmtDataHora("2026-11-05T01:00:00Z")), fmtDataHora("2026-11-05T01:00:00Z"));

// ----- imagens de verdade -----
const logo = await Deno.readFile(new URL("../icons/logo-preto.png", import.meta.url));
const foto = await Deno.readFile(new URL("../icons/login-fundo.jpg", import.meta.url));
const ml = medirImagem(logo), mf = medirImagem(foto);
confere("mede PNG e JPEG pelo cabeçalho", ml.fmt === "PNG" && ml.w > 0 && mf.fmt === "JPEG" && mf.w > 0 && mf.h > 0, { ml, mf });

// ----- banco e pastas falsos -----
type L = Record<string, unknown>;
const tabelas: Record<string, L[]> = {
  email_conexao: [{ id: 1, ligado: true, situacao: "conectado", conta: "centroautomotivodtcar@hotmail.com" }],
  email_token: [{ id: 1, refresh_token: "RT", access_token: "AT", expira_em: "2026-11-04T23:00:00Z" }],
  email_regras: [],
  config: [{ id: 1, dados: { nome: "DTCar Centro Automotivo", cnpj: "49.016.409/0001-95", endereco: "Rua Teste, 10 - Colatina/ES", telefone: "(27) 99999-0000", garantiaDias: 90,
    cobranca: { cooperativa: "0523", posto: "16", beneficiario: "85453", conta: "85453-7", especie: "03", jurosMes: 2, multa: 2 } } }],
  ordens: [{ id: "o1", numero: 1887, status: "entregue", criado_em: "2026-11-01T12:00:00Z", entregue_em: "2026-11-05T01:00:00Z", km_entrada: 85000, km_saida: 85010,
    cliente: { nome: "João da Silva", telefone: "27999990000" }, veiculo: { placa: "ABC1D23", marca: "VW", modelo: "Gol", ano: 2015 }, reclamacao: "Barulho na suspensão",
    diagnostico: "Bieleta dianteira com folga", consultor_nome: "Danilo", mecanico_nome: "Carlos", forma_pagamento: "Boleto", garantia_dias: 90, desconto: 0,
    checkin: { feito: true, resp: {} }, assinatura_entrega: "os/o1/assinatura.png" }],
  os_itens: [{ id: "i1", ordem_id: "o1", posicao: 1, tipo: "servico", descricao: "Troca de bieletas", qtd: 1, valor_unit: 120, aprovado: true },
    { id: "i2", ordem_id: "o1", posicao: 2, tipo: "peca", codigo: "123", descricao: "Bieleta dianteira", qtd: 2, valor_unit: 85.5, aprovado: true }],
  fotos: [{ id: "f1", ordem_id: "o1", caminho: "os/o1/f1.jpg", rotulo: "Execução 1", etapa: "execucao", criado_em: "2026-11-02T12:00:00Z" },
    { id: "f2", ordem_id: "o1", caminho: "os/o1/f2.jpg", rotulo: "Entrada 1", etapa: "entrada", criado_em: "2026-11-01T12:00:00Z" }],
  boletos: [
    { id: "b1", os_numero: "1887", nosso_numero: "261000017", situacao: "registrado", valor: 145.5, vencimento: "2026-11-20", emissao: "2026-11-04", pagador_nome: "JOAO DA SILVA",
      pagador_doc: "12345678909", pagador: { endereco: "Rua A", cep: "29700000", cidade: "COLATINA", uf: "ES" }, descricao: "O.S. 1887 parcela 1/2", seu_numero: "1887-1",
      codigo_barras: "74891" + "0".repeat(39), linha_digitavel: "74890.00000 00000.000000 00000.000000 1 00000000014550", qr_url: "" },
    { id: "b2", os_numero: "1887", nosso_numero: "261000025", situacao: "registrado", valor: 145.5, vencimento: "2026-12-20", emissao: "2026-11-04", pagador_nome: "JOAO DA SILVA",
      pagador_doc: "12345678909", pagador: {}, descricao: "O.S. 1887 parcela 2/2", seu_numero: "1887-2", codigo_barras: "74892" + "0".repeat(39), linha_digitavel: "x", qr_url: "" },
    { id: "b3", os_numero: "1887", nosso_numero: "261000033", situacao: "pago", valor: 50, vencimento: "2026-10-20", emissao: "2026-10-01", pagador_nome: "X", pagador_doc: "", pagador: {},
      descricao: "", seu_numero: "", codigo_barras: "74893" + "0".repeat(39), linha_digitavel: "", qr_url: "" },
    { id: "b4", os_numero: "1900", nosso_numero: "261000041", situacao: "rejeitado", valor: 10, vencimento: "2026-11-20", emissao: "2026-11-04", pagador_nome: "X", pagador_doc: "", pagador: {},
      descricao: "", seu_numero: "", codigo_barras: "74894" + "0".repeat(39), linha_digitavel: "", qr_url: "" }],
  os_notas: [{ id: "11111111-1111-1111-1111-111111111111", os_numero: 1887, numero_nf: "131", arquivo: "1887/nf131.pdf", nome_arquivo: "NF 131.pdf", tipo_arquivo: "application/pdf", criado_em: "1" },
    { id: "22222222-2222-2222-2222-222222222222", os_numero: 1887, numero_nf: "131", arquivo: "1887/nf131.xml", nome_arquivo: "NF 131.xml", tipo_arquivo: "application/xml", criado_em: "2" }],
  rh_documentos: [{ id: "33333333-3333-3333-3333-333333333333", arquivo: "2026-10/x.pdf", nome_arquivo: "PRO LABORE 10.2026.pdf", tipo_arquivo: "application/pdf", tipo: "pro_labore", competencia: "2026-10" }],
};
const pastas: Record<string, Map<string, Uint8Array>> = {
  fotos: new Map([["os/o1/f1.jpg", foto], ["os/o1/f2.jpg", foto], ["os/o1/assinatura.png", logo]]),
  notas: new Map([["1887/nf131.pdf", new TextEncoder().encode("%PDF-1.4 NF 131")], ["1887/nf131.xml", new TextEncoder().encode("<nfeProc><nNF>131</nNF></nfeProc>")]]),
  rh: new Map([["2026-10/x.pdf", new TextEncoder().encode("%PDF-1.4 pro labore")]]),
};
const envios: L[] = [];
// deno-lint-ignore no-explicit-any
const db: any = {
  rpc: (f: string, a: L) => Promise.resolve(f === "email_contatos" ? { data: [{ email: "joao@cliente.com", tipo: "cliente", nome: "João" }], error: null }
    : f === "email_registrar_envio" ? (envios.push(a.p as L), { data: envios.length, error: null }) : { data: null, error: { message: "sem " + f } }),
  from(t: string) {
    const filtros: Array<[string, unknown]> = []; let op = "select", dados: L = {};
    const exec = () => {
      const l = tabelas[t] || [];
      if (!tabelas[t] && t === "os_notas_falta") return { data: null, error: { message: 'relation "os_notas" does not exist' } };
      const bate = (x: L) => filtros.every(([k, v]) => x[k] === v);
      if (op === "update") { l.filter(bate).forEach((x) => Object.assign(x, dados)); return { data: null, error: null }; }
      return { data: l.filter(bate).map((x) => ({ ...x })), error: null };
    };
    // deno-lint-ignore no-explicit-any
    const q: any = { select: () => q, order: () => q, gt: () => q, eq: (k: string, v: unknown) => (filtros.push([k, v]), q), update: (d: L) => (op = "update", dados = d, q),
      then: (a: (v: unknown) => unknown, b?: (e: unknown) => unknown) => Promise.resolve(exec()).then(a, b) };
    return q;
  },
  storage: { from: (b: string) => ({ download: (c: string) => {
    const x = pastas[b]?.get(c);
    return Promise.resolve(x ? { data: new Blob([x]), error: null } : { data: null, error: { message: "Object not found" } });
  } }) },
};

// ----- Microsoft e site falsos -----
const pedidos: Array<{ url: string; corpo: string }> = [];
const SITE = "https://gestao.teste";
globalThis.fetch = (async (u: string | URL | Request, init?: RequestInit) => {
  const url = String(u instanceof Request ? u.url : u); pedidos.push({ url, corpo: typeof init?.body === "string" ? init.body : "" });
  const j = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json" } });
  if (url === SITE + "/icons/logo-preto.png") return new Response(logo, { headers: { "content-type": "image/png" } });
  if (url.includes("/attachments/ANX-arq-000001")) return j({ "@odata.type": "#microsoft.graph.fileAttachment", name: "nfe-compra.xml", contentType: "text/xml", size: 30, contentBytes: btoa("<nfeProc>compra</nfeProc>") });
  if (url.includes("/attachments/ANX-item-00001")) return j({ "@odata.type": "#microsoft.graph.itemAttachment", name: "msg" });
  if (/\/messages\/AAMkAD-msg-0001\?/.test(url)) return j({ subject: "Pedido de orçamento", from: { emailAddress: { address: "joao@cliente.com" } }, toRecipients: [], ccRecipients: [], replyTo: [] });
  if (url.endsWith("/me/sendMail") || /\/reply(All)?$/.test(url)) return new Response(null, { status: 202 });
  return j({ error: { code: "NotFound", message: url } }, 404);
}) as typeof fetch;
const deps: Deps = { usuario: db, adm: db, env: (k) => ({ MS_CLIENT_ID: "x", MS_CLIENT_SECRET: "y", SUPABASE_URL: "https://p.supabase.co" } as Record<string, string>)[k],
  agora: () => new Date("2026-11-04T18:00:00Z"), site: SITE, geradores };

// ----- 1. arquivos -----
const os = await montarAnexos(db, "AT", [{ fonte: "os", numero: 1887 }], geradores, SITE);
const a0 = os.arquivos[0];
const t0 = await texto(a0.bytes);
confere("O.S.: PDF de verdade com o nome da tela (OS_01887_ABC1D23.pdf)", ehPdf(a0.bytes) && a0.nome === "OS_01887_ABC1D23.pdf", a0.nome);
confere("O.S.: tem número, cliente, itens e total", /Nº 01887/.test(t0) && /João da Silva/.test(t0) && /Bieleta dianteira/.test(t0) && /291,00/.test(t0), t0.slice(0, 600));
confere("O.S.: mesmo leiaute da impressão do sistema (tabelas com total, termo, rodapé) e sem a coluna Procedência",
  /Total de produtos/.test(t0) && /NÃO VALE COMO RECIBO DE PAGAMENTO/.test(t0) && !/Procedência|Original \/ genuína|\(adicional\)/.test(t0), t0.slice(0, 900));
confere("O.S.: garantia contada em Brasília (entrega 04/11 22h → até 02/02/2027)", /02\/02\/2027/.test(t0), t0.match(/Garantia válida até [^.]*/)?.[0]);
const imgs = (b: Uint8Array) => (new TextDecoder("latin1").decode(b).match(/\/Subtype \/Image/g) || []).length;
confere("O.S.: logo, foto do serviço e assinatura entram como imagem (a foto de entrada não)", imgs(a0.bytes) === 3, imgs(a0.bytes));
confere("O.S.: aviso do período de transição", os.avisos.some((a) => /transição/.test(a)), os.avisos);
const sf = await montarAnexos(db, "AT", [{ fonte: "os", numero: "OS 01887", fotos: false }], geradores, SITE);
confere("O.S. sem fotos: menor e só logo + assinatura", sf.arquivos[0].bytes.length < a0.bytes.length && imgs(sf.arquivos[0].bytes) === 2 && /sem fotos/.test(sf.arquivos[0].origem), imgs(sf.arquivos[0].bytes));
const orc = await montarAnexos(db, "AT", [{ fonte: "os", numero: 1887, documento: "orcamento" }, { fonte: "os", numero: 1887, documento: "entrada" }], geradores, SITE);
confere("orçamento e checklist de entrada", orc.arquivos.map((a) => a.nome).join() === "Orcamento_01887_ABC1D23.pdf,Checklist_01887_ABC1D23.pdf" && orc.arquivos.every((a) => ehPdf(a.bytes))
  && /ORÇAMENTO/.test(await texto(orc.arquivos[0].bytes)), orc.arquivos.map((a) => a.nome));
await deve("O.S. que não existe", () => montarAnexos(db, "AT", [{ fonte: "os", numero: 5 }], geradores, SITE), /O\.S\. 5 não encontrada/);
await deve("documento da O.S. inválido", () => montarAnexos(db, "AT", [{ fonte: "os", numero: 1887, documento: "nota" }], geradores, SITE), /os, orcamento ou entrada/);

const bo = await montarAnexos(db, "AT", [{ fonte: "boleto", os: 1887 }], geradores, SITE);
const tb = await texto(bo.arquivos[0].bytes);
confere("boleto pela O.S.: só os em aberto (2 parcelas), num PDF só", bo.arquivos.length === 1 && bo.arquivos[0].nome === "boletos-os1887.pdf" && /2 boleto/.test(bo.arquivos[0].origem)
  && /291,00/.test(bo.arquivos[0].origem) && /JOAO DA SILVA/.test(tb) && !/261000033|26\/100003-3/.test(tb), bo.arquivos[0]);
const b1 = await montarAnexos(db, "AT", [{ fonte: "boleto", nosso_numero: "26/100001-7" }], geradores, SITE);
confere("boleto pelo nosso número (com máscara): nome igual ao da tela", b1.arquivos[0].nome === nomePdf(tabelas.boletos[0]), b1.arquivos[0].nome);
const pago = await montarAnexos(db, "AT", [{ fonte: "boleto", nosso_numero: "261000033" }], geradores, SITE);
confere("boleto pago: vai, mas avisa para conferir", pago.avisos.some((a) => /pago/.test(a)), pago.avisos);
await deve("boleto rejeitado não vai", () => montarAnexos(db, "AT", [{ fonte: "boleto", nosso_numero: "261000041" }], geradores, SITE), /rejeitado/);
await deve("O.S. sem boleto em aberto", () => montarAnexos(db, "AT", [{ fonte: "boleto", os: 1900 }], geradores, SITE), /não tem boleto em aberto/);

const nf = await montarAnexos(db, "AT", [{ fonte: "nf", os: 1887 }], geradores, SITE);
confere("NF da O.S.: PDF e XML anexados à mão", nf.arquivos.map((a) => a.nome).join() === "NF 131.pdf,NF 131.xml" && /NF 131 da O\.S\. 1887/.test(nf.arquivos[0].origem), nf.arquivos.map((a) => a.origem));
await deve("O.S. sem NF anexada explica onde anexar", () => montarAnexos(db, "AT", [{ fonte: "nf", os: 1900 }], geradores, SITE), /não tem NF anexada.*Documentos › NF/);
const rh = await montarAnexos(db, "AT", [{ fonte: "rh", id: "33333333-3333-3333-3333-333333333333" }], geradores, SITE);
confere("documento do RH", rh.arquivos[0].nome === "PRO LABORE 10.2026.pdf" && /pro_labore, 2026-10/.test(rh.arquivos[0].origem));
await deve("RH com id inválido", () => montarAnexos(db, "AT", [{ fonte: "rh", id: "../x" }], geradores, SITE), /informe o id/);
const em = await montarAnexos(db, "AT", [{ fonte: "email", id: "AAMkAD-msg-0001", anexo_id: "ANX-arq-000001" }], geradores, SITE);
confere("anexo de e-mail recebido (encaminhar)", em.arquivos[0].nome === "nfe-compra.xml" && new TextDecoder().decode(em.arquivos[0].bytes) === "<nfeProc>compra</nfeProc>");
await deve("id de anexo estranho recusado antes da Microsoft", () => montarAnexos(db, "AT", [{ fonte: "email", id: "AAMkAD-msg-0001", anexo_id: "../../sendMail" }], geradores, SITE), /inválido/);
await deve("anexo que não é arquivo", () => montarAnexos(db, "AT", [{ fonte: "email", id: "AAMkAD-msg-0001", anexo_id: "ANX-item-00001" }], geradores, SITE), /não é um arquivo/);
await deve("fonte desconhecida (nada de caminho solto)", () => montarAnexos(db, "AT", [{ fonte: "caminho", arquivo: "/etc/passwd" }], geradores, SITE), /fonte/);
await deve("mais de 5 anexos", () => montarAnexos(db, "AT", Array.from({ length: 6 }, () => ({ fonte: "rh", id: "33333333-3333-3333-3333-333333333333" })), geradores, SITE), /No máximo 5/);
await deve("NF de 2 arquivos + 4 pedidos passa de 5 arquivos", () => montarAnexos(db, "AT", [{ fonte: "nf", os: 1887 }, ...Array.from({ length: 4 }, () => ({ fonte: "rh", id: "33333333-3333-3333-3333-333333333333" }))], geradores, SITE), /No máximo 5/);
pastas.rh.set("2026-10/x.pdf", new Uint8Array(MAX_BYTES + 10));
await deve("acima de 3 MB somados explica e sugere sem fotos", () => montarAnexos(db, "AT", [{ fonte: "rh", id: "33333333-3333-3333-3333-333333333333" }], geradores, SITE), /acima de .* KB.*fotos=false/);
pastas.rh.set("2026-10/x.pdf", new TextEncoder().encode("%PDF-1.4 pro labore"));

// ----- 2. envio e resposta -----
const antes = pedidos.length;
const pv = await tratar("enviar", { para: "joao@cliente.com", assunto: "O.S. 1887", texto: "Segue a O.S., o boleto e a NF.",
  anexos: [{ fonte: "os", numero: 1887 }, { fonte: "boleto", os: 1887 }, { fonte: "nf", os: 1887 }] }, deps) as Record<string, any>;
confere("prévia lista os anexos (nome, tamanho, de onde vem) e NÃO envia", pv.previa && !pv.enviado && pv.anexos.length === 4 && pv.anexos[0].tamanho_kb > 0 && pv.anexos[0].origem
  && !("bytes" in pv.anexos[0]) && !pedidos.slice(antes).some((p) => p.url.endsWith("/sendMail")), pv.anexos);
confere("prévia traz os avisos dos anexos", (pv.avisos || []).some((a: string) => /transição/.test(a)), pv.avisos);
const ev = await tratar("enviar", { para: "joao@cliente.com", assunto: "O.S. 1887", texto: "Segue.", anexos: [{ fonte: "os", numero: 1887, fotos: false }, { fonte: "nf", os: 1887 }],
  pedido: "manda a OS com a NF", confirmar: true }, deps) as Record<string, any>;
const sm = JSON.parse(pedidos.find((p) => p.url.endsWith("/me/sendMail"))!.corpo);
const at = sm.message.attachments;
confere("enviar: arquivos vão como fileAttachment em base64", ev.enviado && at.length === 3 && at[0]["@odata.type"] === "#microsoft.graph.fileAttachment" && at[0].name === "OS_01887_ABC1D23.pdf"
  && atob(at[0].contentBytes).startsWith("%PDF-") && at[2].contentType === "application/xml", at.map((a: L) => a.name));
confere("histórico guarda só os nomes dos anexos", envios.at(-1)!.anexos === "OS_01887_ABC1D23.pdf, NF 131.pdf, NF 131.xml" && !JSON.stringify(envios).includes("contentBytes"), envios.at(-1));
await tratar("enviar", { para: "joao@cliente.com", assunto: "Oi", texto: "Sem anexo.", confirmar: true }, deps);
const sm2 = JSON.parse(pedidos.filter((p) => p.url.endsWith("/me/sendMail")).at(-1)!.corpo);
confere("sem anexo: igual a antes", !("attachments" in sm2.message) && envios.at(-1)!.anexos === "");
await deve("anexo com problema: não envia nada", async () => {
  const n = pedidos.filter((p) => p.url.endsWith("/sendMail")).length;
  try { await tratar("enviar", { para: "joao@cliente.com", assunto: "x", texto: "y", anexos: [{ fonte: "os", numero: 9999 }], confirmar: true }, deps); }
  finally { if (pedidos.filter((p) => p.url.endsWith("/sendMail")).length !== n) falhas.push("enviou mesmo com anexo errado"); }
}, /não encontrada/);
const rp = await tratar("responder", { id: "AAMkAD-msg-0001", texto: "Segue o orçamento.", anexos: [{ fonte: "os", numero: 1887, documento: "orcamento" }], confirmar: true }, deps) as Record<string, any>;
const rc = JSON.parse(pedidos.find((p) => /\/messages\/AAMkAD-msg-0001\/reply$/.test(p.url))!.corpo);
confere("responder com anexo: comment + message.attachments", rp.enviado && rc.comment === "Segue o orçamento." && rc.message.attachments[0].name === "Orcamento_01887_ABC1D23.pdf"
  && envios.at(-1)!.anexos === "Orcamento_01887_ABC1D23.pdf", rc.message?.attachments?.map((a: L) => a.name));

for (const o of ok) console.log("OK", o);
console.log("FALHAS", falhas);
if (falhas.length) Deno.exit(1);
