// DTCar Gestão — mensagem e PDF para o WhatsApp da oficina (v34, etapa 4 do WhatsApp próprio).
//
// Ação "whatsapp" da função "email" (é ela que já gera os PDFs com os mesmos js/pdf.js e js/boletopdf.js do site):
//   { modelo?, texto?, numero_os?, cliente_id?, telefone?, anexo?, fora_do_horario?, pedido?, origem?, confirmar }
//   - modelo: texto montado com js/mensagens.js (os mesmos textos da tela da O.S.): entrada, orcamento, adicionais, pronto,
//     entrega, cobranca (parcelas em aberto da O.S.) e boas_vindas. Texto ditado pelo Danilo (texto) vale por cima do modelo.
//   - anexo: UM PDF — {fonte:"os", documento: os|orcamento|entrada|recibo, fotos?, motor?}, {fonte:"boleto", os | nosso_numero}
//     (pela O.S., todos os boletos em aberto num PDF só) ou {fonte:"nf", os | id} (o PDF da NF anexada na O.S.).
//   - Sem confirmar: só a prévia (texto, arquivo, erros e avisos da fila). Nada é guardado.
//   - confirmar=true e sem erros: guarda o PDF na pasta privada "whatsapp-envio" (AAAA/MM/<uuid>.pdf) e põe na fila
//     (whatsapp_enfileirar, com o login de quem pediu: só administrador). Se a fila recusar, o PDF é apagado.
// O envio em si é do motor do Android (ou da função zap sem o motor), pelas regras da fila.
import { ErroAnexo, montarAnexos, type Arquivo, type Geradores } from "./anexos.ts";

// deno-lint-ignore no-explicit-any
type Db = { from: (t: string) => any; rpc: (f: string, a?: Record<string, unknown>) => any; storage?: any };
// deno-lint-ignore no-explicit-any
type Fn = (...a: any[]) => any;
/** js/mensagens.js do site */
export interface Mensagens { MSG: Record<string, Fn>; MODELOS: Record<string, { rotulo: string; precisaOS: boolean; pdf: string | null }>; msgBoasVindas: Fn; itensDaMensagem: Fn }
export interface DepsZap { usuario: Db; adm: Db; site: string; geradores: () => Promise<Geradores>; mensagens: () => Promise<Mensagens>; uuid?: () => string; agora?: () => Date }

export const MAX_PDF = 3 * 1024 * 1024;
const lista = async (q: Promise<{ data: unknown; error: { message: string } | null }>) => {
  const { data, error } = await q; if (error) throw new Error(error.message); return (data || []) as Array<Record<string, unknown>>;
};
/** Nome seguro do PDF: sem caracteres proibidos, até 120 letras e sempre terminando em .pdf. */
export function nomePdf(n: string) {
  const base = String(n || "").replace(/[\\/:*?"<>|\r\n]+/g, "-").replace(/\.pdf$/i, "").trim().slice(0, 116) || "documento";
  return base + ".pdf";
}
const numeroOS = (v: unknown) => parseInt(String(v ?? "").replace(/\D/g, ""), 10) || 0;

async function config(adm: Db): Promise<Record<string, unknown>> {
  const [c] = await lista(adm.from("config").select("dados").eq("id", 1));
  return ((c || {}).dados || {}) as Record<string, unknown>;
}

/** Texto do modelo com os dados da O.S. (ou do cliente, nas boas-vindas). */
async function textoDoModelo(d: DepsZap, p: Record<string, unknown>, avisos: string[]): Promise<string> {
  const m = await d.mensagens();
  const modelo = String(p.modelo || "");
  const def = m.MODELOS[modelo];
  if (!def) throw new ErroAnexo(`Modelo desconhecido: ${modelo}. Use: ${Object.keys(m.MODELOS).join(", ")}.`);
  const cfg = await config(d.adm);
  if (!cfg.nome) cfg.nome = "DTCar Centro Automotivo";
  const num = numeroOS(p.numero_os);
  if (modelo === "boas_vindas") {
    let nome = "";
    if (p.cliente_id) { const [c] = await lista(d.adm.from("clientes").select("nome").eq("id", String(p.cliente_id))); nome = String((c || {}).nome || ""); }
    else if (num) { const [o] = await lista(d.adm.from("ordens").select("cliente").eq("numero", num)); nome = String(((o || {}).cliente as Record<string, unknown> || {}).nome || ""); }
    if (!nome) avisos.push("Cliente sem nome no cadastro: a mensagem sai sem o nome.");
    return m.msgBoasVindas({ nome }, cfg);
  }
  if (!num) throw new ErroAnexo(`O modelo "${modelo}" precisa do número da O.S. (numero_os).`);
  const [o] = await lista(d.adm.from("ordens").select("*").eq("numero", num));
  if (!o) throw new ErroAnexo(`O.S. ${num} não encontrada.`);
  const itensTodos = await lista(d.adm.from("os_itens").select("*").eq("ordem_id", o.id).order("posicao"));
  const itens = m.itensDaMensagem(modelo, itensTodos);
  const st = String(o.status);
  // mensagem curta só quando o PDF anexado é o próprio orçamento (os itens e preços estão nele)
  const an = (p.anexo && typeof p.anexo === "object" ? p.anexo : {}) as Record<string, unknown>;
  const extra: Record<string, unknown> = { comPdf: an.fonte === "os" && an.documento === "orcamento" };
  if (modelo === "orcamento" && !["diagnostico", "aguardando"].includes(st)) avisos.push(`A O.S. ${num} não está mais em orçamento (situação: ${st}).`);
  if (modelo === "orcamento" && !itens.length) throw new ErroAnexo(`A O.S. ${num} não tem itens no orçamento.`);
  if (modelo === "adicionais" && !itens.length) throw new ErroAnexo(`A O.S. ${num} não tem itens adicionais esperando aprovação.`);
  if (modelo === "pronto" && st !== "pronto") avisos.push(`A O.S. ${num} não está marcada como pronta (situação: ${st}).`);
  if (modelo === "entrega" && st !== "entregue") avisos.push(`A O.S. ${num} ainda não foi entregue: a data da garantia sai errada.`);
  if (modelo === "cobranca") {
    const parcelas = await lista(d.adm.from("receber").select("*").eq("ordem_id", o.id).eq("status", "aberta").order("vencimento"));
    // O.S. fechada (finalizada_em) ou do sistema antigo entregue sem "a receber" (v17: conta como paga, com recebido 0) = quitada
    const leg = ((o.checkin || {}) as Record<string, unknown>).legado as Record<string, unknown> | undefined;
    const quitada = !!o.finalizada_em || (!!leg && leg.a_receber !== true && st === "entregue");
    const saldo = quitada ? 0 : Math.max(0, Number(o.total || 0) - Number(o.recebido || 0));
    if (quitada || (!parcelas.length && saldo <= 0.005))
      throw new ErroAnexo(`A O.S. ${num} não tem nada a receber${quitada && parcelas.length ? ` (está quitada; há ${parcelas.length} parcela(s) aberta(s) esquecidas: cancele em Contas a receber)` : ""}.`);
    if (!parcelas.length) avisos.push(`A O.S. ${num} não tem parcelas lançadas: a cobrança sai com o saldo de R$ ${saldo.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}.`);
    extra.parcelas = parcelas;
  }
  if (cfg.espelhoLegado !== false) avisos.push("Período de transição: a O.S. vem da cópia do OS Oficina. Confira os valores antes de enviar ao cliente.");
  return m.MSG[modelo]({ ...o, cliente: o.cliente || {}, veiculo: o.veiculo || {} }, cfg, itens, extra);
}

/** O PDF pedido (um só). */
async function pdfDoPedido(d: DepsZap, anexo: Record<string, unknown>): Promise<{ arquivo: Arquivo; avisos: string[] }> {
  const fonte = String(anexo.fonte || "");
  if (!["os", "boleto", "nf"].includes(fonte)) throw new ErroAnexo('No WhatsApp vai um PDF: fonte "os" (O.S., orçamento ou checklist), "boleto" ou "nf".');
  const { arquivos, avisos } = await montarAnexos(d.adm, "", [anexo], d.geradores, d.site);
  const pdfs = arquivos.filter((a) => a.tipo === "application/pdf" || /\.pdf$/i.test(a.nome));
  if (!pdfs.length) throw new ErroAnexo(fonte === "nf" ? "A NF anexada na O.S. não tem PDF (só o XML): anexe o DANFE em PDF na tela da O.S." : "Nenhum PDF gerado.");
  if (pdfs.length > 1) throw new ErroAnexo(`A O.S. tem ${pdfs.length} NF em PDF: escolha uma pelo id.`);
  const a = pdfs[0];
  if (a.bytes.length > MAX_PDF) throw new ErroAnexo(`PDF de ${Math.round(a.bytes.length / 1024)} KB, acima de 3 MB. Para O.S. com muitas fotos, peça com fotos=false.`);
  if (!/\.pdf$/i.test(a.nome)) a.nome += ".pdf";
  return { arquivo: { ...a, tipo: "application/pdf" }, avisos };
}

/** Prévia ou envio (põe na fila) de mensagem com modelo e/ou PDF. */
export async function prepararWhatsApp(d: DepsZap, p: Record<string, unknown>): Promise<Record<string, unknown>> {
  const avisos: string[] = [];
  let texto = String(p.texto ?? "").trim();
  // sem_texto (tela: o Danilo apagou o texto): vai só o PDF
  if (!texto && p.modelo && p.sem_texto !== true) texto = await textoDoModelo(d, p, avisos);
  else if (p.modelo && texto) avisos.push("Foi usado o texto informado (o modelo ficou só no histórico).");
  let pdf: { arquivo: Arquivo; avisos: string[] } | null = null;
  if (p.anexo && typeof p.anexo === "object") {
    // sem número no anexo: o da O.S. da mensagem
    const a = { ...(p.anexo as Record<string, unknown>) }, num = numeroOS(p.numero_os);
    if (!num) throw new ErroAnexo("O PDF é de uma O.S.: informe a O.S. da mensagem (numero_os).");
    if (num && a.fonte === "os" && !a.numero) a.numero = num;
    if (num && (a.fonte === "boleto" || a.fonte === "nf") && !a.os && !a.nosso_numero && !a.id) a.os = num;
    // O.S. informada no próprio anexo: tem de ser a mesma da mensagem; sem O.S. na mensagem, o PDF de O.S. não sai
    // (o destinatário vem da O.S. da mensagem: nunca o documento de outro cliente)
    for (const k of ["numero", "os"]) {
      if (a[k] === undefined || a[k] === null || a[k] === "") continue;
      const n = numeroOS(a[k]);
      if (!num) throw new ErroAnexo("O PDF é de uma O.S.: informe a O.S. da mensagem (numero_os), a mesma do anexo.");
      if (n !== num) throw new ErroAnexo(`O anexo é da O.S. ${n}, mas a mensagem é da O.S. ${num}.`);
    }
    // boleto ou NF escolhidos pelo número/id: têm de ser da mesma O.S. da mensagem (nunca o documento de outro cliente)
    if (num && a.fonte === "boleto" && a.nosso_numero) {
      const [b] = await lista(d.adm.from("boletos").select("os_numero").eq("nosso_numero", String(a.nosso_numero).replace(/\D/g, "")));
      if (b && String(b.os_numero || "") !== String(num)) throw new ErroAnexo(`O boleto ${a.nosso_numero} é da O.S. ${b.os_numero || "(sem O.S.)"}, não da ${num}.`);
    }
    if (num && a.fonte === "nf" && a.id) {
      const [n] = await lista(d.adm.from("os_notas").select("os_numero").eq("id", String(a.id)));
      if (n && Number(n.os_numero) !== num) throw new ErroAnexo(`Essa NF é da O.S. ${n.os_numero}, não da ${num}.`);
    }
    pdf = await pdfDoPedido(d, a);
  }
  if (!texto && !pdf) throw new ErroAnexo("Informe o texto, um modelo ou o PDF.");
  if (pdf) avisos.push(...pdf.avisos);
  const agora = (d.agora || (() => new Date()))();
  const path = `${agora.getUTCFullYear()}/${String(agora.getUTCMonth() + 1).padStart(2, "0")}/${(d.uuid || (() => crypto.randomUUID()))()}.pdf`;
  const arquivo = pdf ? { path, nome: nomePdf(pdf.arquivo.nome), tipo: "application/pdf", bytes: pdf.arquivo.bytes.length, origem: pdf.arquivo.origem } : undefined;
  const pedido = {
    texto, arquivo, modelo: p.modelo || undefined, ordem_numero: numeroOS(p.numero_os) || undefined, cliente_id: p.cliente_id || undefined,
    telefone: p.telefone || undefined, fora_horario: p.fora_do_horario === true, pedido: p.pedido || undefined, origem: p.origem === "tela" ? "tela" : "claude",
  };
  const fila = async (gravar: boolean) => {
    const { data, error } = await d.usuario.rpc("whatsapp_enfileirar", { p: JSON.parse(JSON.stringify(pedido)), p_gravar: gravar });
    if (error) throw new ErroAnexo(/whatsapp_enfileirar|schema cache|PGRST202/i.test(error.message) ? "O WhatsApp ainda não foi ligado no banco (falta o supabase/v25.sql)." : error.message);
    return data as Record<string, unknown>;
  };
  const juntar = (r: Record<string, unknown>) => {
    const av = [...((r.avisos as string[]) || []), ...avisos];
    return { ...r, texto, ...(arquivo ? { arquivo: { nome: arquivo.nome, kb: Math.max(1, Math.round(arquivo.bytes / 1024)), origem: arquivo.origem } } : {}), avisos: [...new Set(av)] };
  };
  const previa = await fila(false);
  // v34 não rodado: o banco ignora o arquivo (a v26 não conhece a coluna) — não deixa sair a mensagem sem o PDF
  if (arquivo && !("arquivo" in previa)) throw new ErroAnexo("Falta rodar o supabase/v34.sql no Supabase (PDF pelo WhatsApp).");
  const erros = (previa.erros as string[]) || [];
  if (p.confirmar !== true || erros.length) return juntar(previa);
  if (pdf) {
    const { error } = await d.adm.storage.from("whatsapp-envio").upload(path, pdf.arquivo.bytes, { contentType: "application/pdf", upsert: false });
    if (error) throw new ErroAnexo(/bucket|not found/i.test(error.message) ? "Falta rodar o supabase/v34.sql no Supabase (pasta whatsapp-envio)." : "PDF não guardado: " + error.message);
  }
  let r: Record<string, unknown>;
  try { r = await fila(true); } catch (e) { if (pdf) await d.adm.storage.from("whatsapp-envio").remove([path]).catch(() => {}); throw e; }
  if (!r.gravado && pdf) await d.adm.storage.from("whatsapp-envio").remove([path]).catch(() => {});
  return juntar(r);
}
