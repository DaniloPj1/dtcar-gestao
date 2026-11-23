// Modelos de mensagem de WhatsApp da oficina — fonte ÚNICA dos textos.
// Usado pela tela da O.S. e de Contas a receber (botão que abre o WhatsApp com o texto) e pela função "email" do Supabase,
// que monta a mensagem e o PDF quando o Claude manda pelo WhatsApp da oficina (v34). Por isso este arquivo:
//   - só importa util.js (nada de tela, window ou document no carregamento);
//   - recebe tudo por parâmetro: a O.S. (com cliente e veículo copiados nela), os itens, as parcelas e o cfg (Ajustes).
// Mudou este arquivo? Troque o commit em supabase/functions/email/site.ts pelo da main com a mudança e publique a função "email".
import { exPlaca, fmtData, fmtDataHora, fmtKm, numOS, qtdFmt, reais, somaDias, totais, totalItem } from "./util.js";

const FUSO = "America/Sao_Paulo";
const hojeBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const DIA = 86400000;
/** Dias até o vencimento (negativo = vencida), contados no horário de Brasília. */
export const diasAteVenc = (iso, hoje = hojeBrasilia()) => Math.round((new Date(iso + "T12:00:00Z") - new Date(hoje + "T12:00:00Z")) / DIA);

const veic = o => (o && o.veiculo) || {};
export const nomeVeic = o => [veic(o).marca, veic(o).modelo].filter(Boolean).join(" ") + " (" + exPlaca(veic(o).placa) + ")";
/** Primeiro nome do cliente (empresa: o nome inteiro até 30 letras, para não virar "Olá, Marbrasa!" pela metade). */
export function primeiroNome(nome) {
  const n = String(nome || "").trim().replace(/\s+/g, " ");
  if (!n) return "";
  if (/\b(ltda|eireli|s\.?\/?a|epp|comercio|comércio|ind|industria|indústria|mineradora|granitos|transportes|servicos|serviços)\b/i.test(n)) return n.length > 30 ? n.slice(0, 30).trim() : n;
  return n.split(" ")[0];
}
/** Nome COMPLETO do cliente da O.S. (a abertura tira o primeiro nome e deduz o tratamento). */
const nomeCli = o => ((o && o.cliente) || {}).nome || "";
/** Veículo como sai nos tópicos: "Ford Ka — OZK8H21". */
export const veicTopico = o => [veic(o).marca, veic(o).modelo].filter(Boolean).join(" ") + " — " + exPlaca(veic(o).placa);

// ---------- molde das mensagens (23/11/2026) ----------
// Toda mensagem sai igual: título em negrito com UM ícone, saudação pela hora, tratamento, tópicos e a assinatura
// no fim, a última linha em negrito. Mesmo molde do agente de mensagens (SISTEMA_ASSISTENTE na função zap).
const EMPRESA = /\b(ltda|eireli|s\.?\/?a|epp|me|comercio|comércio|ind|industria|indústria|mineradora|granitos|transportes|transporte|turismo|servicos|serviços|construtora|distribuidora)\b/i;
export const ehEmpresa = nome => EMPRESA.test(String(nome || ""));

/** Saudação pela hora de Brasília. A fila corrige na hora do envio (comSaudacaoDoEnvio, em motor-zap/whats.js). */
export function saudacao(agora = new Date()) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: FUSO, hour: "2-digit", hour12: false }).format(agora));
  return h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

// O cadastro não guarda o sexo do cliente, então o tratamento é deduzido do primeiro nome (decisão do Danilo, 23/11/2026):
// termina em A = Sra., fora as exceções; mais a lista de nomes femininos que não terminam em A. Erra pouco, mas erra.
const MASC_EM_A = ["luca", "nicola", "sacha", "juca", "jonata", "jhonata", "dionata", "josua", "joshua", "aquila", "elia", "zica"];
const FEM_SEM_A = ["beatriz", "raquel", "rachel", "isabel", "isabele", "ester", "esther", "carmen", "carmem", "nicole", "michele", "michelle",
  "daniele", "danielle", "adriane", "eliane", "eliete", "ivete", "ivone", "lourdes", "lurdes", "marlene", "miriam", "mirian", "noemi",
  "rute", "ruth", "sueli", "vivian", "viviane", "cristiane", "cristine", "simone", "solange", "denise", "elisete", "josiane", "luciene",
  "lucilene", "rosane", "rosilene", "roseane", "silvane", "tatiane", "luciane", "juliane", "jaqueline", "jacqueline", "evelin", "evelyn"];
const semAcento = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** "Sr." / "Sra." pelo primeiro nome; "" para empresa ou nome vazio. */
export function tratamento(nome) {
  const n = String(nome || "").trim();
  if (!n || ehEmpresa(n)) return "";
  const p = semAcento(n.split(/\s+/)[0]);
  if (!p) return "";
  if (FEM_SEM_A.includes(p)) return "Sra.";
  if (MASC_EM_A.includes(p)) return "Sr.";
  return /a$/.test(p) ? "Sra." : "Sr.";
}

// O cadastro grava em LETRAS MAIÚSCULAS (regra de 15/11/2026), mas na mensagem o nome do cliente vai escrito normal:
// "Sr. MARCOS!" parece grito. Preposição fica minúscula ("Maria da Silva").
const MIUDAS = ["de", "da", "do", "das", "dos", "e", "di", "du", "van", "von", "la"];
export const capitalizar = nome => String(nome || "").trim().toLowerCase().split(/\s+/).filter(Boolean)
  .map((p, i) => (i > 0 && MIUDAS.includes(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(" ");

/** Nome da empresa como se escreve numa mensagem: sem o tipo societário e no máximo 3 palavras ("Aritur Transporte"). */
const nomeEmpresa = nome => {
  const p = String(nome || "").trim().split(/\s+/)
    .filter(x => !/^(ltda|eireli|epp|me|s\.?\/?a|sa|s\/a|cia)\.?,?$/i.test(x))
    .slice(0, 3);
  // nunca terminar num conectivo ("Aritur Transporte e")
  while (p.length > 1 && MIUDAS.includes(p[p.length - 1].toLowerCase())) p.pop();
  return capitalizar(p.join(" "));
};

/** Linha de abertura: "Bom dia, Sr. Marcos!", "Bom dia, Aritur Transporte!" ou "Bom dia!" quando não há nome. */
export function abertura(nome, agora = new Date()) {
  const s = saudacao(agora);
  if (!String(nome || "").trim()) return s + "!";
  if (ehEmpresa(nome)) { const e = nomeEmpresa(nome); return e ? s + ", " + e + "!" : s + "!"; }
  const n = capitalizar(primeiroNome(nome));
  if (!n) return s + "!";
  const t = tratamento(nome);
  return s + ", " + (t ? t + " " : "") + n + "!";
}

/** Título: um ícone e o texto em negrito — o único emoji da mensagem. */
const titulo = (icone, texto) => icone + " *" + texto + "*";
/** Assinatura: duas linhas no fim de toda mensagem, a última sempre em negrito (regra do Danilo). */
const assinatura = cfg => (cfg && cfg.nome ? cfg.nome : "DTCar Centro Automotivo") + "\n*Mensagem gerada pelo sistema Gestão DTCar*";
/** Monta a mensagem no molde: título, abertura, corpo (linhas) e assinatura, sem linhas vazias sobrando. */
const montar = (icone, tit, nome, cfg, linhas, agora) =>
  [titulo(icone, tit), "", abertura(nome, agora), "", ...linhas, "", assinatura(cfg)].join("\n").replace(/\n{3,}/g, "\n\n");
/** Tópicos: "• " em cada linha, só quando há duas ou mais; uma só vai em frase corrida. */
const topicos = l => { const x = l.filter(Boolean); return x.length > 1 ? x.map(i => "• " + i) : x; };

function linhasItensMsg(itens) {
  const L = [];
  const grupo = (tipo, titulo) => { const g = itens.filter(i => i.tipo === tipo); if (!g.length) return;
    L.push("*" + titulo + ":*"); g.forEach(i => L.push("• " + i.descricao + (Number(i.qtd) !== 1 && i.tipo === "peca" ? " (" + qtdFmt(i.qtd) + ")" : "") + (i.fornecida_cliente ? " (peça do cliente)" : " — " + reais(totalItem(i))))); L.push(""); };
  grupo("peca", "Peças"); grupo("servico", "Mão de obra"); grupo("terceiro", "Serviços de terceiros");
  return L;
}

/** Itens que entram em cada mensagem: no orçamento, os não recusados; nos adicionais, os ainda sem resposta do cliente. */
export const itensDaMensagem = (qual, itens) => qual === "adicionais" ? (itens || []).filter(i => i.aprovado === null || i.aprovado === undefined)
  : (itens || []).filter(i => i.aprovado !== false);

/** Uma parcela (Contas a receber › Cobrar). */
export const msgCobrancaParcela = (p, cfg, hoje, agora) => montar("💳", "Parcela em aberto", p.cliente_nome, cfg, [
  "Passando para lembrar de uma parcela em aberto.", "",
  ...topicos([
    p.descricao + (p.parcelas > 1 ? " — parcela " + p.parcela + "/" + p.parcelas : ""),
    (diasAteVenc(p.vencimento, hoje) < 0 ? "Venceu em " : "Vence em ") + fmtData(p.vencimento) + (p.forma ? " (" + p.forma + ")" : ""),
    "Valor: *" + reais(p.valor) + "*",
  ]), "",
  "Se já pagou, desconsidere. Qualquer dúvida, estamos à disposição.",
], agora);

/** Textos da O.S. Cada um recebe (o, cfg, itens, extra). "o" é a O.S. com cliente e veículo; o total já deve ser o atual. */
export const MSG = {
  entrada: (o, cfg, _itens, extra = {}) => montar("📥", "Veículo recebido — " + numOS(o.numero), nomeCli(o), cfg, [
    "Recebemos o seu veículo e vamos começar o diagnóstico.", "",
    ...topicos([veicTopico(o), "Entrada em " + fmtDataHora(o.criado_em) + (o.km_entrada ? ", com " + fmtKm(o.km_entrada) : "")]), "",
    "Enviamos o orçamento para a sua aprovação antes de executar qualquer serviço.",
  ], extra.agora),
  // extra.comPdf: o PDF do orçamento vai junto — a mensagem fica curta (os itens estão no PDF). Sem PDF (link da tela), lista os itens.
  orcamento: (o, cfg, itens, extra = {}) => { const t = totais(itens, o.desconto);
    const fim = ["Para aprovar, responda *APROVADO*. Se quiser aprovar só parte dos itens, é só dizer quais."];
    if (extra.comPdf) return montar("📄", "Orçamento — " + numOS(o.numero), nomeCli(o), cfg, [
      "Segue em anexo o orçamento do seu veículo.", "",
      ...topicos([veicTopico(o), "Total: *" + reais(t.total) + "*", o.validade_orcamento ? "Válido até " + fmtData(o.validade_orcamento) : ""]), "",
      ...fim], extra.agora);
    return montar("📄", "Orçamento — " + numOS(o.numero), nomeCli(o), cfg, [
      "O orçamento do seu " + veicTopico(o) + " está pronto.", "",
      ...(o.diagnostico ? ["*Diagnóstico:* " + o.diagnostico, ""] : []), ...linhasItensMsg(itens),
      ...topicos([
        t.desconto ? "Desconto: " + reais(t.desconto) : "",
        "Total: *" + reais(t.total) + "*",
        "Previsão de entrega: " + (o.previsao_entrega ? fmtData(o.previsao_entrega) + (o.previsao_hora ? " às " + o.previsao_hora : "") : "a combinar"),
        o.validade_orcamento ? "Válido até " + fmtData(o.validade_orcamento) : "",
      ]), "",
      ...fim, "Envio o orçamento completo em PDF a seguir."], extra.agora); },
  adicionais: (o, cfg, itens, extra = {}) => { const t = totais(itens, 0);
    return montar("🔧", "Itens adicionais — " + numOS(o.numero), nomeCli(o), cfg, [
      "Durante o serviço no seu " + veicTopico(o) + " encontramos itens que não estavam no orçamento.", "",
      ...linhasItensMsg(itens), "Valor adicional: *" + reais(t.total) + "*", "",
      "Só executamos com a sua aprovação. Responda *APROVADO* para incluir, ou diga quais itens deseja."], extra.agora); },
  pronto: (o, cfg, _itens, extra = {}) => montar("🚗", "Veículo pronto — " + numOS(o.numero), nomeCli(o), cfg, [
    "O seu veículo está pronto para retirada.", "",
    ...topicos([veicTopico(o), "Valor total: *" + reais(o.total) + "*", cfg.endereco || ""]), "",
    "Estamos à disposição."], extra.agora),
  entrega: (o, cfg, _itens, extra = {}) => montar("🚗", "Serviço entregue — " + numOS(o.numero), nomeCli(o), cfg, [
    "Obrigado pela confiança.", "",
    ...topicos([veicTopico(o),
      "Garantia de " + o.garantia_dias + " dias, até " + fmtData(somaDias(o.entregue_em, o.garantia_dias)),
      "Guarde a ordem de serviço que enviamos"]), "",
    "Qualquer coisa, é só chamar."], extra.agora),
  /** Cobrança das parcelas em aberto da O.S. (extra.parcelas: linhas de "receber" com status aberta; extra.hoje opcional). */
  cobranca: (o, cfg, _itens, extra = {}) => {
    const ps = (extra.parcelas || []).filter(p => p.status === "aberta").sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
    const hoje = extra.hoje || hojeBrasilia();
    const saldo = ps.length ? ps.reduce((s, p) => s + Number(p.valor || 0), 0) : Math.max(0, Number(o.total || 0) - Number(o.recebido || 0));
    return montar("💳", "Pagamento em aberto — " + numOS(o.numero), nomeCli(o), cfg, [
      "Passando para lembrar do pagamento do seu " + veicTopico(o) + ".", "",
      ...topicos([
        ...ps.map(p => (p.parcelas > 1 ? "Parcela " + p.parcela + "/" + p.parcelas + " — " : "") + reais(p.valor)
          + " — " + (diasAteVenc(p.vencimento, hoje) < 0 ? "venceu em " : "vence em ") + fmtData(p.vencimento) + (p.forma ? " (" + p.forma + ")" : "")),
        "Total em aberto: *" + reais(saldo) + "*",
      ]), "",
      "Se já pagou, desconsidere e, se puder, nos envie o comprovante."], extra.agora);
  },
};

/** Boas-vindas a um cliente (não precisa de O.S.). c: { nome }. */
export const msgBoasVindas = (c, cfg, agora) => montar("👋", "Bem-vindo à " + (cfg.nome || "DTCar Centro Automotivo"), (c || {}).nome, cfg, [
  "Este é o WhatsApp oficial da oficina. Salve o nosso número.", "",
  ...topicos(["Orçamentos, avisos de serviço pronto e documentos da sua O.S.", cfg.endereco || ""]), "",
  "Para não receber mais avisos, responda PARAR.",
], agora);

/** Modelos que o Claude pode pedir pelo nome (conector), com o PDF que costuma ir junto. */
export const MODELOS = {
  entrada: { rotulo: "Entrada do veículo", precisaOS: true, pdf: "entrada" },
  orcamento: { rotulo: "Orçamento pronto", precisaOS: true, pdf: "orcamento" },
  adicionais: { rotulo: "Itens adicionais para aprovar", precisaOS: true, pdf: null },
  pronto: { rotulo: "Serviço pronto para retirada", precisaOS: true, pdf: null },
  entrega: { rotulo: "Entregue, com a garantia", precisaOS: true, pdf: "os" },
  cobranca: { rotulo: "Cobrança das parcelas em aberto", precisaOS: true, pdf: "boleto" },
  boas_vindas: { rotulo: "Boas-vindas ao cliente", precisaOS: false, pdf: null },
};
