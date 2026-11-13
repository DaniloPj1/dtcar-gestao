// DTCar Gestão — arquivos que vão junto no e-mail (email_enviar / email_responder).
//
// O Danilo (ou o Claude, por ordem dele) pede pelo que o arquivo é, nunca por um caminho solto:
//   { fonte: "os", numero: 1887, documento: "os" | "orcamento" | "entrada", fotos?: false }
//        → o mesmo PDF da tela da O.S. (js/pdf.js do site, gerado aqui com os dados do banco)
//   { fonte: "os", numero: 1887, documento: "recibo", motor?: false }
//        → a O.S. Recibo (12/11/2026, js/pdfrecibo.js): só para O.S. paga; com os cuidados do motor, salvo motor=false
//   { fonte: "resumo", numero: 1928, de: "cliente" | "veiculo", orcamentos?: true, itens?: false }
//        → o Resumo de O.S. em aberto (13/11/2026, js/pdfresumo.js): as O.S. aprovadas e aguardando pagamento do cliente ou do
//          veículo da O.S. informada num PDF só (itens, total, recebido e falta receber de cada uma + total geral).
//          orcamentos=true inclui os orçamentos não aprovados; itens=false manda só o quadro "Resumo geral"
//   { fonte: "boleto", nosso_numero: "261234567" }  ou  { fonte: "boleto", os: 1887 }
//        → o PDF do boleto Sicredi (js/boletopdf.js); pela O.S., todos os boletos em aberto dela num PDF só
//   { fonte: "nf", os: 1887 }  ou  { fonte: "nf", id: "<id>" }
//        → a NF anexada à mão na tela da O.S. (Documentos › NF, v33): PDF e XML da nota emitida no ObjetivaWeb
//   { fonte: "rh", id: "<id do documento>" }   → arquivo de Financeiro › Funcionários e RH › Documentos do RH
//   { fonte: "email", id: "<e-mail>", anexo_id: "<anexo>" } → anexo de um e-mail recebido (encaminhar a nota, o XML...)
// Limites: até 5 arquivos e 3 MB somados (a Microsoft recusa e-mail com anexo maior sem a permissão de rascunho,
// que o sistema não tem de propósito). O.S. com muitas fotos: peça com fotos=false.
import { graph } from "./microsoft.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any; storage?: any };
export interface Arquivo { nome: string; tipo: string; bytes: Uint8Array; origem: string }
export interface Imagem { data: string; w: number; h: number; fmt: "PNG" | "JPEG" }
// deno-lint-ignore no-explicit-any
type Fn = (...a: any[]) => any;
/** Geradores de PDF do site (js/pdf.js e js/boletopdf.js). */
export interface Geradores { pdfOS: Fn; pdfOrcamento: Fn; pdfEntrada: Fn; pdfBoletos: Fn; nomePdf: Fn; usarLeitorImagem: Fn; pdfOSRecibo?: Fn; osQuitada?: Fn;
  /** Resumo de O.S. em aberto (js/pdfresumo.js e js/resumoos.js) */
  pdfResumoOS?: Fn; etapaNoResumo?: Fn; dadosResumoOS?: Fn; nomeArquivoResumo?: Fn }

export const MAX_ARQUIVOS = 5;
export const MAX_BYTES = 3 * 1024 * 1024;
export class ErroAnexo extends Error {}

const LIMPA_ID = (id: unknown) => { const s = String(id || ""); if (!/^[A-Za-z0-9_=+\/-]{10,400}$/.test(s)) throw new ErroAnexo("Identificador de e-mail ou anexo inválido."); return encodeURIComponent(s); };
const kb = (n: number) => Math.max(1, Math.round(n / 1024));
const nomeSeguro = (s: string) => String(s || "arquivo").replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 120);

export function paraBase64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const deBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Largura e altura de PNG ou JPEG lendo o cabeçalho (aqui não existe Image do navegador). */
export function medirImagem(b: Uint8Array): { w: number; h: number; fmt: "PNG" | "JPEG" } {
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: v.getUint32(16), h: v.getUint32(20), fmt: "PNG" };
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      const len = (b[i + 2] << 8) | b[i + 3];
      // SOF0..SOF15, exceto DHT (C4), JPG (C8) e DAC (CC)
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], fmt: "JPEG" };
      i += 2 + len;
    }
  }
  throw new Error("Imagem que não é PNG nem JPEG.");
}

/** Leitor de imagem para o js/pdf.js: fotos e assinaturas da pasta "fotos", logo do site ("app:..."), ou data:. */
export function leitorImagem(adm: Db, site: string, busca: typeof fetch = fetch) {
  return async (caminho: string): Promise<Imagem> => {
    let bytes: Uint8Array;
    if (caminho.startsWith("data:")) bytes = deBase64(caminho.slice(caminho.indexOf(",") + 1));
    else if (caminho.startsWith("app:")) {
      const r = await busca(site + "/" + caminho.slice(4).replace(/^\/+/, ""));
      if (!r.ok) throw new Error("logo indisponível");
      bytes = new Uint8Array(await r.arrayBuffer());
    } else {
      const { data, error } = await adm.storage.from("fotos").download(caminho);
      if (error || !data) throw new Error("foto indisponível");
      bytes = new Uint8Array(await data.arrayBuffer());
    }
    const m = medirImagem(bytes);
    return { data: "data:image/" + (m.fmt === "PNG" ? "png" : "jpeg") + ";base64," + paraBase64(bytes), w: m.w, h: m.h, fmt: m.fmt };
  };
}

async function config(adm: Db): Promise<Record<string, unknown>> {
  const { data, error } = await adm.from("config").select("dados").eq("id", 1);
  if (error) throw new Error(error.message);
  return ((data || [])[0]?.dados || {}) as Record<string, unknown>;
}
const lista = async (q: Promise<{ data: unknown; error: { message: string } | null }>) => {
  const { data, error } = await q; if (error) throw new Error(error.message); return (data || []) as Array<Record<string, unknown>>;
};
const bytesDoPdf = async (saida: unknown) => new Uint8Array(saida instanceof Blob ? await saida.arrayBuffer() : (saida as ArrayBuffer));

const DOCS: Record<string, { gerador: "pdfOS" | "pdfOrcamento" | "pdfEntrada" | "pdfOSRecibo"; nome: string; rotulo: string }> = {
  os: { gerador: "pdfOS", nome: "OS", rotulo: "ordem de serviço" },
  orcamento: { gerador: "pdfOrcamento", nome: "Orcamento", rotulo: "orçamento" },
  entrada: { gerador: "pdfEntrada", nome: "Checklist", rotulo: "checklist de entrada" },
  recibo: { gerador: "pdfOSRecibo", nome: "OS_Recibo", rotulo: "O.S. Recibo" },
};

async function daOS(adm: Db, g: Geradores, p: Record<string, unknown>, cfg: Record<string, unknown>, avisos: string[]): Promise<Arquivo> {
  const numero = parseInt(String(p.numero ?? p.os ?? "").replace(/\D/g, ""), 10);
  if (!numero) throw new ErroAnexo("Informe o número da O.S. do anexo.");
  const doc = DOCS[String(p.documento || "os")];
  if (!doc) throw new ErroAnexo("Documento da O.S.: os, orcamento, entrada ou recibo.");
  const [o] = await lista(adm.from("ordens").select("*").eq("numero", numero));
  if (!o) throw new ErroAnexo(`O.S. ${numero} não encontrada.`);
  if (doc.gerador === "pdfOSRecibo") return await daOSRecibo(adm, g, o, numero, p, cfg, avisos);
  const [itens, fotos] = await Promise.all([
    lista(adm.from("os_itens").select("*").eq("ordem_id", o.id).order("posicao")),
    p.fotos === false ? Promise.resolve([]) : lista(adm.from("fotos").select("*").eq("ordem_id", o.id).order("criado_em")),
  ]);
  if (doc.gerador === "pdfOS" && o.status !== "entregue") avisos.push(`A O.S. ${numero} ainda não foi entregue: o PDF sai como "em andamento", sem a data da garantia.`);
  if (cfg.espelhoLegado !== false) avisos.push("Período de transição: a O.S. vem da cópia do OS Oficina. Confira os valores antes de enviar ao cliente.");
  // ficha do cliente e do veículo: código, 2º telefone, endereço completo, combustível e chassi (iguais à impressão do sistema)
  const [cli] = o.cliente_id ? await lista(adm.from("clientes").select("*").eq("id", o.cliente_id)) : [];
  const [vei] = o.veiculo_id ? await lista(adm.from("veiculos").select("*").eq("id", o.veiculo_id)) : [];
  const blob = await g[doc.gerador]({ ...o, itens, fotos, eventos: [] }, cfg, { cli: cli || null, vei: vei || null });
  const placa = String((o.veiculo as Record<string, unknown> || {}).placa || "");
  return { nome: `${doc.nome}_${String(numero).padStart(5, "0")}${placa ? "_" + placa : ""}.pdf`, tipo: "application/pdf", bytes: await bytesDoPdf(blob),
    origem: `O.S. ${numero} (${doc.rotulo}${p.fotos === false ? ", sem fotos" : ""})` };
}

/** O.S. Recibo (12/11/2026): a O.S. paga em forma de recibo + prazo e condições da garantia (+ cuidados do motor, salvo motor=false).
 *  Só para O.S. paga: o documento diz "Recebemos de...". Não mexe no PDF da O.S. normal. */
async function daOSRecibo(adm: Db, g: Geradores, o: Record<string, unknown>, numero: number, p: Record<string, unknown>, cfg: Record<string, unknown>, avisos: string[]): Promise<Arquivo> {
  if (!g.pdfOSRecibo || !g.osQuitada) throw new ErroAnexo("A O.S. Recibo ainda não está nesta versão da função \"email\" (publique de novo).");
  if (!g.osQuitada(o)) throw new ErroAnexo(`A O.S. ${numero} não está paga (fechada): a O.S. Recibo é só para O.S. quitada. Para a O.S. em aberto, use documento "os".`);
  const [itens, recibos] = await Promise.all([
    lista(adm.from("os_itens").select("*").eq("ordem_id", o.id).order("posicao")),
    lista(adm.from("recibos").select("numero, data, criado_em, forma, valor, cancelado").eq("ordem_id", o.id)),
  ]);
  const [cli] = o.cliente_id ? await lista(adm.from("clientes").select("*").eq("id", o.cliente_id)) : [];
  if (cfg.espelhoLegado !== false) avisos.push("Período de transição: a O.S. vem da cópia do OS Oficina. Confira os valores antes de enviar ao cliente.");
  if (!recibos.filter((r) => !r.cancelado).length) avisos.push(`A O.S. ${numero} não tem recibo lançado: o valor pago sai como o total da O.S. e a forma, a gravada na O.S.`);
  const motor = p.motor !== false;
  const blob = await g.pdfOSRecibo({ ...o, itens }, cfg, { recibos, motor, cli: cli || null });
  const placa = String((o.veiculo as Record<string, unknown> || {}).placa || "");
  return { nome: `OS_Recibo_${String(numero).padStart(5, "0")}${placa ? "_" + placa : ""}.pdf`, tipo: "application/pdf", bytes: await bytesDoPdf(blob),
    origem: `O.S. ${numero} (O.S. Recibo, ${motor ? "com" : "sem"} os cuidados do motor)` };
}

const dinheiro = (n: unknown) => "R$ " + (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Resumo de O.S. em aberto (13/11/2026): as O.S. em aberto do cliente ou do veículo da O.S. informada num PDF só — itens, total,
 *  recebido e falta receber de cada uma e o total geral. Entram as aprovadas (em execução) e as aguardando pagamento; orçamento
 *  não aprovado só com orcamentos=true. As regras e as contas são as da tela (js/resumoos.js). Só leitura. */
async function doResumo(adm: Db, g: Geradores, p: Record<string, unknown>, cfg: Record<string, unknown>, avisos: string[]): Promise<Arquivo> {
  if (!g.pdfResumoOS || !g.etapaNoResumo || !g.dadosResumoOS || !g.nomeArquivoResumo) throw new ErroAnexo("O resumo de O.S. ainda não está nesta versão da função \"email\" (publique de novo).");
  const etapa = g.etapaNoResumo;
  const numero = parseInt(String(p.numero ?? p.os ?? "").replace(/\D/g, ""), 10);
  if (!numero) throw new ErroAnexo("Resumo de O.S.: informe o número de uma O.S. do cliente ou do veículo (numero).");
  const de = String(p.de || "");
  if (de !== "cliente" && de !== "veiculo") throw new ErroAnexo('Resumo de O.S.: informe de: "cliente" (as O.S. em aberto do cliente) ou "veiculo" (as do veículo).');
  const [ref] = await lista(adm.from("ordens").select("*").eq("numero", numero));
  if (!ref) throw new ErroAnexo(`O.S. ${numero} não encontrada.`);
  const chave = de === "cliente" ? "cliente_id" : "veiculo_id", dono = de === "cliente" ? "cliente" : "veículo";
  if (!ref[chave]) throw new ErroAnexo(`A O.S. ${numero} não tem ${dono} do cadastro: o resumo junta as O.S. pelo cadastro.`);
  const abertas = (await lista(adm.from("ordens").select("*").eq(chave, ref[chave]))).filter((o) => etapa(o));
  const orcs = abertas.filter((o) => etapa(o) === "orcamento");
  const ordens = p.orcamentos === true ? abertas : abertas.filter((o) => etapa(o) !== "orcamento");
  const nums = (l: Array<Record<string, unknown>>) => l.map((o) => Number(o.numero)).sort((a, b) => a - b).join(", ");
  if (!ordens.length) throw new ErroAnexo(`Nenhuma O.S. aprovada ou aguardando pagamento deste ${dono}.` +
    (orcs.length ? ` Há orçamento não aprovado (O.S. ${nums(orcs)}): para incluir, peça com orcamentos=true.` : ""));
  const itens = await lista(adm.from("os_itens").select("*").in("ordem_id", ordens.map((o) => o.id)).order("posicao"));
  // cabeçalho: a ficha do cliente; pelo veículo, a ficha do veículo e a do proprietário do cadastro
  const [vei] = de === "veiculo" ? await lista(adm.from("veiculos").select("*").eq("id", ref.veiculo_id)) : [];
  const cliId = de === "cliente" ? ref.cliente_id : (vei || {}).cliente_id;
  const [cli] = cliId ? await lista(adm.from("clientes").select("*").eq("id", cliId)) : [];
  const d = g.dadosResumoOS({ ordens, itens, de, cliente: cli || null, veiculo: vei || null });
  if (cfg.espelhoLegado !== false) avisos.push("Período de transição: a O.S. vem da cópia do OS Oficina. Confira os valores antes de enviar ao cliente.");
  if (!ordens.some((o) => Number(o.numero) === numero)) avisos.push(`A O.S. ${numero} não entra neste resumo (${etapa(ref) === "orcamento" ? "é orçamento não aprovado" : "não está em aberto"}); entraram as outras em aberto do mesmo ${dono}.`);
  if (p.orcamentos !== true && orcs.length) avisos.push(`Ficou de fora o orçamento ainda não aprovado (O.S. ${nums(orcs)}). Para incluir, peça com orcamentos=true.`);
  if (p.orcamentos === true && orcs.length) avisos.push(`O resumo inclui orçamento ainda não aprovado (O.S. ${nums(orcs)}): o valor dele entra no total geral.`);
  if (d.clientesDiferentes.length) avisos.push(`As O.S. deste resumo estão em nomes diferentes (${d.clientesDiferentes.join("; ")}): o resumo sai no nome de ${d.cli ? d.cli.nome : "—"}.`);
  const blob = await g.pdfResumoOS(d, cfg, { itens: p.itens !== false });
  const quem = de === "cliente" ? "do cliente " + (d.cli ? d.cli.nome : "") : "do veículo " + (d.vei ? d.vei.placa : "");
  return { nome: g.nomeArquivoResumo(d), tipo: "application/pdf", bytes: await bytesDoPdf(blob),
    origem: `Resumo de ${ordens.length} O.S. em aberto ${quem.trim()} (O.S. ${nums(ordens)})${p.itens === false ? ", só o quadro geral" : ""}: total ${dinheiro(d.soma.total)}, falta receber ${dinheiro(d.soma.falta)}` };
}

const EM_ABERTO = ["gerado", "enviado", "registrado"];
/** Reserva do conector (v41): nosso número provisório 000…, sem linha digitável — não vai para PDF nem mensagem */
const ehReserva = (b: Record<string, unknown>) => b.situacao === "gerado" && !b.linha_digitavel && /^000/.test(String(b.nosso_numero || ""));
async function doBoleto(adm: Db, g: Geradores, p: Record<string, unknown>, cfg: Record<string, unknown>, avisos: string[]): Promise<Arquivo> {
  let bs: Array<Record<string, unknown>>;
  const nn = String(p.nosso_numero || "").replace(/\D/g, "");
  if (nn) bs = await lista(adm.from("boletos").select("*").eq("nosso_numero", nn));
  else if (p.os) bs = (await lista(adm.from("boletos").select("*").eq("os_numero", String(parseInt(String(p.os).replace(/\D/g, ""), 10) || "")).order("vencimento")))
    .filter((b) => EM_ABERTO.includes(String(b.situacao)) && !ehReserva(b));
  else throw new ErroAnexo("Boleto: informe o nosso_numero ou a O.S.");
  if (!bs.length) throw new ErroAnexo(nn ? `Boleto ${nn} não encontrado.` : `A O.S. ${p.os} não tem boleto em aberto.`);
  if (bs.some(ehReserva)) throw new ErroAnexo("Este boleto é só uma reserva do Claude (o Sicredi não respondeu): confira no Portal PJ; não é boleto para pagar.");
  for (const b of bs) {
    if (b.situacao === "rejeitado") throw new ErroAnexo(`O boleto ${b.nosso_numero} foi rejeitado pelo banco: não vale para pagamento.`);
    if (["pago", "baixado", "baixa_pedida"].includes(String(b.situacao))) avisos.push(`O boleto ${b.nosso_numero} está "${b.situacao}": confira antes de mandar cobrar.`);
    else if (b.situacao === "gerado") avisos.push(`O boleto ${b.nosso_numero} ainda não foi registrado no banco (situação "gerado").`);
  }
  const cob = (cfg.cobranca || {}) as Record<string, unknown>;
  if (!cob.cooperativa) throw new ErroAnexo("A carteira de cobrança não está configurada (Boletos Sicredi).");
  const emp = { nome: cfg.nome, cnpj: cfg.cnpj, endereco: cfg.endereco, cidade: cfg.cidade || "COLATINA" };
  const doc = g.pdfBoletos(bs, cob, emp);
  const nome = bs.length === 1 ? g.nomePdf(bs[0]) : `boletos-os${bs[0].os_numero || ""}.pdf`;
  const total = bs.reduce((s, b) => s + Number(b.valor || 0), 0);
  return { nome, tipo: "application/pdf", bytes: new Uint8Array(doc.output("arraybuffer")),
    origem: `${bs.length} boleto(s)${bs[0].os_numero ? " da O.S. " + bs[0].os_numero : ""}, total R$ ${total.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}` };
}

async function doRH(adm: Db, p: Record<string, unknown>): Promise<Arquivo> {
  const id = String(p.id || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroAnexo("Documento do RH: informe o id.");
  const [r] = await lista(adm.from("rh_documentos").select("arquivo, nome_arquivo, tipo_arquivo, titulo, competencia, tipo").eq("id", id));
  if (!r) throw new ErroAnexo("Documento do RH não encontrado.");
  const { data, error } = await adm.storage.from("rh").download(String(r.arquivo));
  if (error || !data) throw new ErroAnexo("Arquivo do RH indisponível na pasta.");
  return { nome: nomeSeguro(String(r.nome_arquivo || r.titulo || "documento.pdf")), tipo: String(r.tipo_arquivo || "application/pdf"),
    bytes: new Uint8Array(await data.arrayBuffer()), origem: `Documentos do RH (${r.tipo}, ${r.competencia})` };
}

async function daNF(adm: Db, p: Record<string, unknown>): Promise<Arquivo[]> {
  const id = String(p.id || "").trim(), os = parseInt(String(p.os ?? p.numero ?? "").replace(/\D/g, ""), 10);
  let q = adm.from("os_notas").select("arquivo, nome_arquivo, tipo_arquivo, numero_nf, os_numero");
  if (id) { if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ErroAnexo("NF: id inválido."); q = q.eq("id", id); }
  else if (os) q = q.eq("os_numero", os).order("criado_em");
  else throw new ErroAnexo("NF: informe a O.S. (os) ou o id da nota.");
  let ns: Array<Record<string, unknown>>;
  try { ns = await lista(q); } catch (e) {
    if (/os_notas|schema cache|does not exist/i.test((e as Error).message)) throw new ErroAnexo("Falta rodar o supabase/v33.sql no Supabase (NF na O.S.).");
    throw e;
  }
  if (!ns.length) throw new ErroAnexo(id ? "NF não encontrada." : `A O.S. ${os} não tem NF anexada. Anexe o PDF/XML na tela da O.S. (Documentos › NF).`);
  const out: Arquivo[] = [];
  for (const n of ns) {
    const { data, error } = await adm.storage.from("notas").download(String(n.arquivo));
    if (error || !data) throw new ErroAnexo(`Arquivo da NF ${n.numero_nf || ""} indisponível na pasta.`);
    out.push({ nome: nomeSeguro(String(n.nome_arquivo || "nf.pdf")), tipo: String(n.tipo_arquivo || "application/pdf"), bytes: new Uint8Array(await data.arrayBuffer()),
      origem: `NF${n.numero_nf ? " " + n.numero_nf : ""} da O.S. ${n.os_numero}` });
  }
  return out;
}

async function doEmail(token: string, p: Record<string, unknown>): Promise<Arquivo> {
  const a = await graph(token, `/me/messages/${LIMPA_ID(p.id)}/attachments/${LIMPA_ID(p.anexo_id)}`);
  if (a["@odata.type"] !== "#microsoft.graph.fileAttachment" || !a.contentBytes) throw new ErroAnexo("Esse anexo não é um arquivo (é um e-mail ou link anexado).");
  return { nome: nomeSeguro(a.name), tipo: a.contentType || "application/octet-stream", bytes: deBase64(a.contentBytes), origem: "anexo de e-mail recebido" };
}

/** Monta os arquivos pedidos. Erro de uso (O.S. não existe, limite) vira ErroAnexo com a explicação. */
export async function montarAnexos(adm: Db, token: string, pedidos: unknown, carregar: () => Promise<Geradores>, site: string):
  Promise<{ arquivos: Arquivo[]; avisos: string[] }> {
  const ps = (Array.isArray(pedidos) ? pedidos : pedidos ? [pedidos] : []) as Array<Record<string, unknown>>;
  if (!ps.length) return { arquivos: [], avisos: [] };
  if (ps.length > MAX_ARQUIVOS) throw new ErroAnexo(`No máximo ${MAX_ARQUIVOS} anexos por e-mail.`);
  const avisos: string[] = [], arquivos: Arquivo[] = [];
  let g: Geradores | null = null, cfg: Record<string, unknown> | null = null;
  for (const p of ps) {
    const fonte = String(p?.fonte || "");
    if (fonte === "os" || fonte === "boleto" || fonte === "resumo") {
      if (!g) { g = await carregar(); g.usarLeitorImagem(leitorImagem(adm, site)); }
      if (!cfg) cfg = await config(adm);
      arquivos.push(fonte === "os" ? await daOS(adm, g, p, cfg, avisos) : fonte === "resumo" ? await doResumo(adm, g, p, cfg, avisos) : await doBoleto(adm, g, p, cfg, avisos));
    } else if (fonte === "nf") arquivos.push(...await daNF(adm, p));
    else if (fonte === "rh") arquivos.push(await doRH(adm, p));
    else if (fonte === "email") arquivos.push(await doEmail(token, p));
    else throw new ErroAnexo('Anexo: fonte "os", "resumo", "boleto", "nf", "rh" ou "email".');
  }
  if (arquivos.length > MAX_ARQUIVOS) throw new ErroAnexo(`No máximo ${MAX_ARQUIVOS} arquivos por e-mail.`);
  const total = arquivos.reduce((s, a) => s + a.bytes.length, 0);
  if (total > MAX_BYTES) {
    const det = arquivos.map((a) => `${a.nome} ${kb(a.bytes.length)} KB`).join(", ");
    throw new ErroAnexo(`Anexos somam ${kb(total)} KB, acima de ${kb(MAX_BYTES)} KB (${det}). Para O.S. com fotos, peça com fotos=false.`);
  }
  return { arquivos, avisos: [...new Set(avisos)] };
}

/** Resumo para a prévia (nunca o conteúdo). */
export const resumoAnexos = (l: Arquivo[]) => l.map((a) => ({ nome: a.nome, tamanho_kb: kb(a.bytes.length), origem: a.origem }));

/** Formato da Microsoft (fileAttachment). */
export const paraGraph = (l: Arquivo[]) => l.map((a) => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: a.nome, contentType: a.tipo, contentBytes: paraBase64(a.bytes) }));
