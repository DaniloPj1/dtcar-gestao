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
const nomeDaOS = o => primeiroNome(((o && o.cliente) || {}).nome);

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
export const msgCobrancaParcela = (p, cfg, hoje) => `Olá, ${primeiroNome(p.cliente_nome)}! Aqui é da ${cfg.nome}.\n\nPassando para lembrar ${diasAteVenc(p.vencimento, hoje) < 0 ? "da parcela vencida em" : "da parcela com vencimento em"} *${fmtData(p.vencimento)}* no valor de *${reais(p.valor)}*` +
  ` (${p.descricao}${p.parcelas > 1 ? ", parcela " + p.parcela + "/" + p.parcelas : ""}, ${p.forma}).\n\nSe já pagou, por favor desconsidere. Qualquer dúvida, estamos à disposição.`;

/** Textos da O.S. Cada um recebe (o, cfg, itens, extra). "o" é a O.S. com cliente e veículo; o total já deve ser o atual. */
export const MSG = {
  entrada: (o, cfg) => `Olá, ${nomeDaOS(o)}! Aqui é da ${cfg.nome}.\n\nRecebemos seu ${nomeVeic(o)} em ${fmtDataHora(o.criado_em)}, com ${fmtKm(o.km_entrada)}. Número do atendimento: *${numOS(o.numero)}*.\n\nVamos fazer o diagnóstico e enviar o orçamento para sua aprovação antes de executar qualquer serviço.`,
  orcamento: (o, cfg, itens) => { const t = totais(itens, o.desconto);
    return [`Olá, ${nomeDaOS(o)}! O orçamento do seu ${nomeVeic(o)} está pronto (${numOS(o.numero)}).`, "",
      ...(o.diagnostico ? ["*Diagnóstico:* " + o.diagnostico, ""] : []), ...linhasItensMsg(itens),
      ...(t.desconto ? ["Desconto: " + reais(t.desconto)] : []), `*Total: ${reais(t.total)}*`,
      `Previsão de entrega: ${o.previsao_entrega ? fmtData(o.previsao_entrega) + (o.previsao_hora ? " às " + o.previsao_hora : "") : "a combinar"}`, `Válido até ${fmtData(o.validade_orcamento)}.`, "",
      "Para aprovar, responda *APROVADO*. Se preferir aprovar só parte dos itens, é só dizer quais. Envio o orçamento completo em PDF a seguir."].join("\n"); },
  adicionais: (o, cfg, itens) => { const t = totais(itens, 0);
    return [`Olá, ${nomeDaOS(o)}! Durante o serviço no seu ${nomeVeic(o)}, na ${numOS(o.numero)}, identificamos itens adicionais:`, "",
      ...linhasItensMsg(itens), `*Valor adicional: ${reais(t.total)}*`, "", "Só executamos com a sua aprovação. Responda *APROVADO* para incluir, ou diga quais itens deseja."].join("\n"); },
  pronto: (o, cfg) => `Olá, ${nomeDaOS(o)}! Seu ${nomeVeic(o)} está pronto para retirada (${numOS(o.numero)}).\n\nValor total: *${reais(o.total)}*.\n${cfg.endereco ? "Endereço: " + cfg.endereco + "\n" : ""}\nQualquer dúvida, estamos à disposição.`,
  entrega: (o, cfg) => `Obrigado pela confiança, ${nomeDaOS(o)}!\n\nOs serviços da ${numOS(o.numero)} no seu ${nomeVeic(o)} têm garantia de ${o.garantia_dias} dias, até ${fmtData(somaDias(o.entregue_em, o.garantia_dias))}. Guarde a ordem de serviço que enviamos.\n\n${cfg.nome}${cfg.telefone ? " · " + cfg.telefone : ""}`,
  /** Cobrança das parcelas em aberto da O.S. (extra.parcelas: linhas de "receber" com status aberta; extra.hoje opcional). */
  cobranca: (o, cfg, _itens, extra = {}) => {
    const ps = (extra.parcelas || []).filter(p => p.status === "aberta").sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
    const hoje = extra.hoje || hojeBrasilia();
    const saldo = ps.length ? ps.reduce((s, p) => s + Number(p.valor || 0), 0) : Math.max(0, Number(o.total || 0) - Number(o.recebido || 0));
    const L = [`Olá, ${nomeDaOS(o)}! Aqui é da ${cfg.nome}.`, "", `Passando para lembrar do pagamento da ${numOS(o.numero)} (${nomeVeic(o)}):`];
    if (ps.length) {
      L.push("");
      for (const p of ps) L.push(`• ${p.parcelas > 1 ? "Parcela " + p.parcela + "/" + p.parcelas + " — " : ""}${reais(p.valor)} — ${diasAteVenc(p.vencimento, hoje) < 0 ? "venceu em" : "vence em"} ${fmtData(p.vencimento)}${p.forma ? " (" + p.forma + ")" : ""}`);
    }
    L.push("", `*Total em aberto: ${reais(saldo)}*`, "", "Se já pagou, por favor desconsidere e, se puder, nos envie o comprovante. Qualquer dúvida, estamos à disposição.");
    return L.join("\n");
  },
};

/** Boas-vindas a um cliente (não precisa de O.S.). c: { nome }. */
export const msgBoasVindas = (c, cfg) => `Olá, ${primeiroNome((c || {}).nome)}! Aqui é da ${cfg.nome}.\n\nEste é o WhatsApp oficial da oficina: por aqui enviamos orçamentos, avisos de serviço pronto e documentos da sua O.S. Salve o nosso número!` +
  `${cfg.endereco ? "\n\nEndereço: " + cfg.endereco : ""}\n\nSe não quiser receber nossos avisos, é só responder PARAR.`;

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
