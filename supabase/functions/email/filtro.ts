// DTCar Gestão — filtro do e-mail da oficina (função "email").
// Decide o que o Claude lê por padrão. A caixa do Hotmail não é alterada: nada é apagado, movido nem marcado.
//
// Ordem (a primeira que bate decide):
//   1. Lixo eletrônico do Outlook (só na busca em "todas", em que essa pasta já fica de fora) .. ignorado
//   2. Regra "fraude" (golpes conhecidos) ..................... fraude (fora da leitura, com ALERTA se parecer cobrança)
//      Regra de golpe por nome/assunto não vale para remetente cadastrado ou marcado como importante pelo e-mail/domínio
//      (ex.: fornecedor "Pneus Costa Ltda", banco avisando sobre um golpe).
//   3. Regra "ignorar" ........................................ ignorado
//   4. Regra "importante" ou e-mail cadastrado no sistema ..... importante (sempre lido)
//   5. Conteúdo útil: anexo XML; PDF com assunto de cobrança/nota; assunto de boleto, nota, cobrança, orçamento
//      ou pedido (este último só se não for e-mail de lista/propaganda) ................................... útil
//   6. Propaganda: e-mail de lista (com "descadastrar"), caixa "Outros" do Outlook, remetente de marketing .. ignorado
//   7. O resto ................................................ revisar (só aparece se o Danilo pedir)
// Remetente "importante" cujo e-mail falhou na conferência do servidor (DMARC, ou SPF e DKIM) cai para revisar, com alerta:
// pode ser e-mail falso usando o endereço do banco ou do fornecedor.

export type Decisao = "importante" | "util" | "revisar" | "ignorado" | "fraude";
export interface Regra { id?: number; tipo: "importante" | "ignorar" | "fraude"; alvo: "remetente" | "dominio" | "nome" | "assunto"; valor: string }
export interface Contato { email: string; tipo: string; nome: string }
export interface Anexo { id?: string; nome: string; tipo: string; tamanho?: number }
export interface Msg {
  de_email: string; de_nome: string; assunto: string; previa: string; anexos: Anexo[];
  lista?: boolean;            // tem List-Unsubscribe (newsletter, propaganda)
  foco?: string;              // "focused" ou "other" (Caixa Prioritária do Outlook)
  lixo?: boolean;             // está no Lixo Eletrônico
  sem_autenticacao?: boolean; // Authentication-Results reprovou (possível remetente falsificado)
}
export interface Ctx { regras: Regra[]; contatos: Map<string, Contato> }
export interface Classificacao { decisao: Decisao; motivo: string; categoria: string; cadastro?: Contato; alerta?: string }

/** minúsculo, sem acento e com espaços simples */
export const normalizar = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
export const dominioDe = (email: string) => normalizar(email).split("@")[1] || "";
const escapar = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const temPalavra = (texto: string, termo: string) => new RegExp("(^|[^a-z0-9])" + escapar(termo) + "([^a-z0-9]|$)").test(texto);
const dominioBate = (dom: string, valor: string) => !!dom && (dom === valor || dom.endsWith("." + valor));

const RX_NF = /\b(nota fiscal|nf-?e|nfs-?e|danfe|xml da nota)\b/;
const RX_COBRANCA = /\b(boleto|boletos|linha digitavel|fatura|cobranca|duplicata|vencimento|vence|2a via|segunda via|titulo|pagamento pendente)\b/;
const RX_PEDIDO = /\b(orcamento|cotacao|pedido|proposta|ordem de compra|ordem de servico)\b/;
const RX_MARKETING = /^(newsletter|news|marketing|promo|promocao|promocoes|ofertas|oferta|novidades|mkt|email-marketing|comunicacao)[@._-]/;
const extensao = (nome: string) => (normalizar(nome).match(/\.([a-z0-9]+)$/) || [])[1] || "";
const ehXml = (a: Anexo) => extensao(a.nome) === "xml" || /xml/.test(normalizar(a.tipo));
const ehPdf = (a: Anexo) => extensao(a.nome) === "pdf" || /pdf/.test(normalizar(a.tipo));

/** Assunto do e-mail: NF, boleto, pedido... (também usado na lista) */
export function categoriaDe(m: Msg, cadastro?: Contato): string {
  const assunto = normalizar(m.assunto), texto = assunto + " " + normalizar(m.previa), dom = dominioDe(m.de_email);
  if (m.anexos.some(ehXml) || RX_NF.test(assunto)) return "nota fiscal";
  if (RX_COBRANCA.test(texto) || m.anexos.some((a) => /boleto|fatura/.test(normalizar(a.nome)))) return "boleto/cobrança";
  if (RX_PEDIDO.test(assunto)) return "orçamento/pedido";
  if (/(^|\.)(sicredi\.com\.br|picpay\.com)$/.test(dom)) return "banco";
  if (dominioBate(dom, "gov.br")) return "governo";
  if (cadastro) return cadastro.tipo;
  return "outro";
}

function regraQueBate(m: Msg, regras: Regra[], tipo: Regra["tipo"], soEndereco = false): Regra | undefined {
  const email = normalizar(m.de_email), dom = dominioDe(m.de_email);
  // nome: só o nome de quem manda e o assunto (o corpo pode citar o golpe, ex.: aviso do banco)
  const nomeTxt = normalizar(m.de_nome + " " + m.assunto), assunto = normalizar(m.assunto);
  return regras.find((r) => r.tipo === tipo && (!soEndereco || r.alvo === "remetente" || r.alvo === "dominio") && (
    (r.alvo === "remetente" && email === r.valor) ||
    (r.alvo === "dominio" && dominioBate(dom, r.valor)) ||
    (r.alvo === "nome" && temPalavra(nomeTxt, r.valor)) ||
    (r.alvo === "assunto" && assunto.includes(r.valor))));
}

export function classificar(m: Msg, ctx: Ctx): Classificacao {
  const cadastro = ctx.contatos.get(normalizar(m.de_email));
  const categoria = categoriaDe(m, cadastro);
  const cobranca = categoria === "boleto/cobrança" || m.anexos.some(ehPdf);
  const r = (decisao: Decisao, motivo: string, extra: Partial<Classificacao> = {}): Classificacao => ({ decisao, motivo, categoria, ...(cadastro ? { cadastro } : {}), ...extra });

  if (m.lixo) return r("ignorado", "lixo eletrônico do Outlook");
  const importantePorEndereco = regraQueBate(m, ctx.regras, "importante", true);
  const conhecido = !!cadastro || !!importantePorEndereco;
  const fraude = regraQueBate(m, ctx.regras, "fraude", conhecido);
  if (fraude) return r("fraude", "lista de golpes: " + fraude.valor, {
    alerta: cobranca ? `Possível cobrança de golpe (${fraude.valor} está na lista de golpes). Não pague sem conferir a compra.` : `Remetente na lista de golpes (${fraude.valor}).` });
  const ignorar = regraQueBate(m, ctx.regras, "ignorar", conhecido);
  if (ignorar) return r("ignorado", "regra do Danilo: ignorar " + ignorar.valor);
  const falso = { alerta: "Remetente não confirmado pelo servidor de e-mail: pode ser falso usando este endereço. Confira antes de pagar ou responder." };
  if (conhecido && m.sem_autenticacao) return r("revisar", "remetente conhecido, mas não confirmado", falso);
  const importante = importantePorEndereco || regraQueBate(m, ctx.regras, "importante");
  if (importante) return r("importante", "regra: importante " + importante.valor);
  if (cadastro) return r("importante", "cadastro: " + cadastro.tipo + " " + cadastro.nome);
  const assunto = normalizar(m.assunto);
  if (m.anexos.some(ehXml)) return r("util", "anexo XML");
  if (m.anexos.some(ehPdf) && (RX_NF.test(assunto) || RX_COBRANCA.test(assunto) || RX_PEDIDO.test(assunto))) return r("util", "PDF de nota, cobrança ou pedido");
  if (!m.lista && (RX_NF.test(assunto) || RX_COBRANCA.test(assunto) || RX_PEDIDO.test(assunto))) return r("util", "assunto de nota, cobrança ou pedido");
  if (m.lista) return r("ignorado", "propaganda (e-mail de lista)");
  if (m.foco === "other") return r("ignorado", "caixa \"Outros\" do Outlook");
  if (RX_MARKETING.test(normalizar(m.de_email))) return r("ignorado", "remetente de propaganda");
  return r("revisar", "sem regra: revisar");
}

/** Lê as regras ativas e os contatos do banco (o administrador já está conferido) e monta o contexto do filtro. */
export function montarCtx(regras: Regra[], contatos: Contato[]): Ctx {
  return {
    regras: regras.map((x) => ({ ...x, valor: normalizar(x.valor) })).filter((x) => x.valor.length >= 2),
    contatos: new Map(contatos.map((c) => [normalizar(c.email), c])),
  };
}

/** Normaliza uma regra pedida pelo Danilo ("ignora esse remetente") antes de gravar. */
export function valorDaRegra(alvo: Regra["alvo"], valor: string): string {
  let v = normalizar(valor);
  if (alvo === "remetente") v = (v.match(/<([^>]+)>/) || [, v])[1]!.trim();
  if (alvo === "dominio") v = v.replace(/^.*@/, "").replace(/^www\./, "");
  return v;
}
