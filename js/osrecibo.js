// O.S. Recibo (pedido do Danilo em 12/11/2026): a O.S. paga em forma de recibo, com o prazo e as condições da garantia
// e, quando marcado, os cuidados com o motor (amaciamento e troca de óleo aos 1.000 km).
// Usado pela tela de impressão (js/telas/imprimir.js, #/imprimir/osrecibo/<id>) e pelo PDF (js/pdfrecibo.js), que a
// função "email" gera para o WhatsApp e o e-mail. Sem window/document: este arquivo também roda no Supabase.
// Não mexe na O.S. normal, no pdfOS nem no banco.
import { totais, fmtData, somaDias } from "./util.js";
import { etapaOS } from "./regras.js";

const POR_EXTENSO = { 30: "trinta", 45: "quarenta e cinco", 60: "sessenta", 90: "noventa", 120: "cento e vinte", 180: "cento e oitenta", 365: "trezentos e sessenta e cinco" };
/** "90 (noventa) dias" — sem o nome por extenso para prazos fora da lista */
export const diasTexto = n => POR_EXTENSO[n] ? `${n} (${POR_EXTENSO[n]}) dias` : `${n} dias`;

/** O.S. paga: etapa "Fechada" da tela (etapaOS) ou do sistema antigo entregue sem "a receber" (v17 conta como paga; igual à cobrança do WhatsApp). */
export function osQuitada(o) {
  if (!o || o.status !== "entregue") return false;
  if (o.finalizada_em || etapaOS(o) === "fechada") return true;
  const leg = ((o.checkin || {}).legado) || (o.legado ? { a_receber: o.legado_receber === true } : null);
  return !!leg && leg.a_receber !== true;
}

/** Tudo o que a O.S. Recibo mostra, igual na tela e no PDF. recibos = recibos da O.S. (os cancelados são ignorados). */
export function dadosOSRecibo(o, recibos, cfg = {}) {
  const itens = o.itens || [];
  // mesma regra da impressão da O.S. (ViaOS): com algum item aprovado, só os aprovados; senão, os não recusados
  const aprov = itens.some(i => i.aprovado === true);
  const lista = itens.filter(i => aprov ? i.aprovado === true : i.aprovado !== false);
  const t = totais(itens, o.desconto, aprov);
  const pagos = (recibos || []).filter(r => !r.cancelado).sort((a, b) => String(a.data || a.criado_em || "").localeCompare(String(b.data || b.criado_em || "")));
  const somaPagos = pagos.reduce((s, r) => s + Number(r.valor || 0), 0);
  const dias = Number(o.garantia_dias) || Number(cfg.garantiaDias) || 90;
  const entrega = o.entregue_em || null;
  const ultimo = pagos.length ? pagos[pagos.length - 1] : null;
  const pagoEm = (ultimo && (ultimo.data || ultimo.criado_em)) || o.finalizada_em || entrega;
  return {
    lista, t, dias, entrega, pagoEm,
    pecas: lista.filter(i => i.tipo === "peca"), servicos: lista.filter(i => i.tipo === "servico"), terceiros: lista.filter(i => i.tipo === "terceiro"),
    pagos: pagos.map(r => ({ numero: r.numero, data: r.data || r.criado_em, forma: r.forma || "", valor: Number(r.valor || 0) })),
    // O.S. do sistema antigo sem recibo lançado: vale o total da O.S. e a forma gravada nela
    valorPago: somaPagos > 0.005 ? somaPagos : Number(o.total || t.total || 0),
    formas: [...new Set(pagos.map(r => r.forma).filter(Boolean))].join(", ") || o.forma_pagamento || "",
    validade: entrega ? somaDias(entrega, dias) : null,
  };
}

/** Prazo e condições da garantia, em ordem: [{ r: rótulo em negrito (ou ""), t: texto }]. */
export function condicoesGarantia({ dias, numero, telefone, motor, entrega, validade }) {
  const n = String(numero ?? "").padStart(5, "0");
  return [
    { r: "Prazo:", t: `garantia de ${diasTexto(dias)} sobre os serviços executados, contados da data de entrega do veículo` +
      (entrega ? ` (${fmtData(entrega)}), válida até ${fmtData(validade)}.` : " indicada acima.") },
    { r: "Peças fornecidas pela oficina:", t: "garantia pelo mesmo prazo ou pelo prazo do fabricante, o que for maior." },
    { r: "Peças fornecidas pelo cliente:", t: "a oficina garante a mão de obra de instalação. Defeitos de fabricação dessas peças são de responsabilidade do seu fornecedor, e a mão de obra de nova substituição motivada por esse defeito será orçada à parte." },
    { r: "Exclusões:", t: "a garantia não cobre danos decorrentes de uso inadequado, acidentes, intervenção de terceiros ou falta da manutenção recomendada" +
      (motor ? ", em especial a troca de óleo e filtro aos 1.000 km e os cuidados listados abaixo." : ".") },
    { r: "Como acionar:", t: `entre em contato pelo telefone da oficina${telefone ? " " + telefone : ""} e apresente este recibo e a Ordem de Serviço nº ${n}.` },
    { r: "", t: "Esta garantia contratual complementa a garantia legal prevista no Código de Defesa do Consumidor (art. 50)." },
  ];
}

/** Cuidados com o motor: só quando a O.S. Recibo é tirada com "cuidados do motor" marcado. */
export const CUIDADOS_MOTOR = {
  titulo: "Cuidados para não perder a garantia",
  intro: "O motor foi retificado e montado com peças novas, por isso precisa de um período de amaciamento. A garantia depende dos cuidados abaixo:",
  destaque: "TROCA DE ÓLEO E FILTRO DE ÓLEO AOS 1.000 KM RODADOS APÓS A ENTREGA — OBRIGATÓRIA.",
  destaque2: "Quem não fizer essa troca perde a garantia do motor.",
  itens: [
    { r: "Amaciamento nos primeiros 1.000 km:", t: "dirigir com calma, sem acelerar fundo e sem passar de 3.000 rpm; variar a velocidade e evitar longos trechos em velocidade constante na estrada." },
    { r: "Não carregar peso excessivo nem rebocar", t: "durante o amaciamento." },
    { r: "Não deixar o motor muito tempo em marcha lenta", t: "e não desligar logo após uso forte; esperar alguns segundos em marcha lenta antes." },
    { r: "Conferir toda semana", t: "o nível do óleo e da água do radiador, com o motor frio. Completar só com óleo e aditivo da especificação indicada pela oficina; nunca usar só água no radiador." },
    { r: "Ficar atento ao painel:", t: "se o ponteiro da temperatura subir ou a luz do óleo acender, parar o carro em local seguro, desligar o motor na hora e ligar para a oficina. Rodar com o motor superaquecido ou sem pressão de óleo anula a garantia." },
    { r: "Usar combustível de boa procedência.", t: "" },
    { r: "Não deixar outra oficina mexer no motor", t: "durante o prazo da garantia; qualquer problema, procurar a DTCar primeiro." },
    { r: "Depois dos 1.000 km,", t: "seguir as próximas trocas de óleo no prazo recomendado." },
  ],
};
