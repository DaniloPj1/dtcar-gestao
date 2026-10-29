// Regras do negócio: checklist, status, papéis e textos padrão
export const SECOES_CHECKLIST = [
  { id: "manutencao", titulo: "Manutenção preventiva", itens: [
    { k: "validadeOleo", l: "Validade do óleo", op: [["No prazo","ok"],["Vencido","bad"],["Sem etiqueta","warn"]] },
    { k: "nivelOleo", l: "Nível do óleo", op: [["No nível","ok"],["Abaixo do nível","bad"]] },
    { k: "arrefecimento", l: "Nível do arrefecimento", op: [["No nível","ok"],["Abaixo do nível","bad"]] },
  ]},
  { id: "painel", titulo: "Painel (luzes de advertência)", itens: [
    { k: "luzInjecao", l: "Luz de injeção", op: [["Apagada","ok"],["Acesa","bad"]] },
    { k: "luzOleo", l: "Luz de óleo", op: [["Apagada","ok"],["Acesa","bad"]] },
    { k: "luzBateria", l: "Luz de bateria", op: [["Apagada","ok"],["Acesa","bad"]] },
    { k: "luzABS", l: "Luz de ABS / freio", op: [["Apagada","ok"],["Acesa","bad"]] },
    { k: "luzAirbag", l: "Luz de airbag", op: [["Apagada","ok"],["Acesa","bad"]] },
  ]},
  { id: "iluminacao", titulo: "Iluminação externa", itens: [
    { k: "farolBaixo", l: "Farol baixo", op: [["Funcionando","ok"],["Com defeito","bad"]] },
    { k: "farolAlto", l: "Farol alto", op: [["Funcionando","ok"],["Com defeito","bad"]] },
    { k: "setas", l: "Setas / pisca-alerta", op: [["Funcionando","ok"],["Com defeito","bad"]] },
    { k: "luzesFreio", l: "Luzes de freio", op: [["Funcionando","ok"],["Com defeito","bad"]] },
    { k: "luzRe", l: "Luz de ré", op: [["Funcionando","ok"],["Com defeito","bad"]] },
  ]},
  { id: "sistemas", titulo: "Sistemas a verificar (queixa do cliente)", itens: [
    { k: "suspensao", l: "Suspensão", op: [["Sem queixa","ok"],["Verificar","warn"]] },
    { k: "direcao", l: "Direção", op: [["Sem queixa","ok"],["Verificar","warn"]] },
    { k: "freios", l: "Freios", op: [["Sem queixa","ok"],["Verificar","warn"]] },
    { k: "injecao", l: "Injeção eletrônica", op: [["Sem queixa","ok"],["Verificar","warn"]] },
  ]},
  { id: "servicos", titulo: "Serviços solicitados na entrada", itens: [
    { k: "alinhamento", l: "Alinhamento", op: [["Não solicitado","ok"],["Solicitado","info"]] },
    { k: "balanceamento", l: "Balanceamento", op: [["Não solicitado","ok"],["Solicitado","info"]] },
  ]},
];
export const SECOES_EXTERNO = [
  { id: "lataria", titulo: "Lataria e vidros (avarias)", itens: [
    ["frente","Frente / para-choque dianteiro"],["traseira","Traseira / para-choque traseiro"],["latEsq","Lateral esquerda"],
    ["latDir","Lateral direita"],["teto","Teto / capô"],["vidros","Para-brisa e vidros"],["rodas","Rodas e calotas"],
  ].map(([k, l]) => ({ k: "lat_" + k, l, op: [["Sem avarias","ok"],["Risco","warn"],["Amassado","warn"],["Trincado / quebrado","bad"]] })) },
  { id: "pneus", titulo: "Pneus", itens: [
    ["DE","Pneu dianteiro esquerdo"],["DD","Pneu dianteiro direito"],["TE","Pneu traseiro esquerdo"],["TD","Pneu traseiro direito"],
  ].map(([k, l]) => ({ k: "pn_" + k, l, op: [["Bom","ok"],["Meia-vida","warn"],["Trocar","bad"]] }))
   .concat([{ k: "pn_estepe", l: "Estepe", op: [["Bom","ok"],["Meia-vida","warn"],["Trocar","bad"],["Ausente","na"]] }]) },
  { id: "acessorios", titulo: "Acessórios e documentos no veículo", itens: [
    ["macaco","Macaco"],["chave","Chave de roda"],["triangulo","Triângulo"],["documento","Documento (CRLV)"],["tapetes","Tapetes"],["som","Rádio / multimídia"],
  ].map(([k, l]) => ({ k: "ac_" + k, l, op: [["Presente","ok"],["Ausente","na"]] })) },
];
export const OP_EXTRA = [["OK","ok"],["Verificar","warn"]];
export const COMBUSTIVEL = [["Reserva",.12],["1/4",.25],["1/2",.5],["3/4",.75],["Cheio",1]];
export const SLOTS_FOTO = [["frente","Frente"],["traseira","Traseira"],["latEsq","Lateral esquerda"],["latDir","Lateral direita"],["painel","Painel (KM e combustível)"]];
export const SLOTS_OBRIG = ["frente","traseira","latEsq","latDir"];

export const extrasDe = lista => (lista || []).map(x => ({ k: "x_" + x.id, l: x.nome, op: OP_EXTRA }));
export function secoesCheckin(itensExtras) {
  const ext = extrasDe(itensExtras);
  return SECOES_CHECKLIST.concat(ext.length ? [{ id: "extras", titulo: "Itens adicionais", itens: ext }] : [], SECOES_EXTERNO);
}
export function achados(resp, secoes) {
  const out = [];
  for (const s of secoes) for (const it of s.itens) {
    const r = (resp || {})[it.k];
    if (r && (r.s === "bad" || r.s === "warn" || r.s === "info")) out.push({ secao: s.titulo, l: it.l, v: r.v, s: r.s, obs: r.obs || "" });
  }
  const ordem = { bad: 0, warn: 1, info: 2 };
  return out.sort((a, b) => ordem[a.s] - ordem[b.s]);
}

export const STATUS = {
  diagnostico: { t: "Em diagnóstico", curto: "Diagnóstico", cor: "info" },
  aguardando: { t: "Aguardando aprovação", curto: "Aguardando", cor: "warn" },
  execucao: { t: "Em execução", curto: "Execução", cor: "brand" },
  pronto: { t: "Pronto no pátio", curto: "Pronto", cor: "ok" },
  entregue: { t: "Entregue", curto: "Entregue", cor: "muted" },
  recusado: { t: "Orçamento recusado", curto: "Recusado", cor: "bad" },
  cancelado: { t: "Cancelada", curto: "Cancelada", cor: "muted" },
};
export const FLUXO = ["diagnostico", "aguardando", "execucao", "pronto", "entregue"];
/** Situação mostrada da O.S.: separa "entregue, a receber" de "finalizada" (entregue e paga) */
export function situacaoOS(o) {
  if (!o) return null;
  if (o.status === "entregue" && o.recebido !== undefined) {
    if (o.finalizada_em) return { t: "Finalizada", curto: "Finalizada", cor: "muted" };
    return { t: "Entregue · a receber", curto: "A receber", cor: "warn" };
  }
  return STATUS[o.status] || { t: o.status, curto: o.status, cor: "muted" };
}
export const ABERTOS = ["diagnostico", "aguardando", "execucao", "pronto"];

export const PAPEIS = { admin: "Administrador", consultor: "Consultor", mecanico: "Mecânico", pendente: "Aguardando liberação" };
export const pode = (perfil, acao) => {
  const p = perfil && perfil.ativo !== false ? perfil.papel : "";
  const regras = {
    verValores: ["admin", "consultor"],
    orcar: ["admin", "consultor"],
    aprovar: ["admin", "consultor"],
    entregar: ["admin", "consultor"],
    executar: ["admin", "consultor", "mecanico"],
    entrada: ["admin", "consultor", "mecanico"],
    cadastrar: ["admin", "consultor"],
    excluir: ["admin"],
    ajustes: ["admin"],
    financeiro: ["admin"],
  };
  return (regras[acao] || []).includes(p);
};

export const TABELAS_PRECO = { vista: "À vista", prazo: "A prazo", atacado: "Atacado" };
export const SITUACAO_CLIENTE = {
  liberado: { t: "Liberado", cor: "ok" },
  restrito: { t: "Restrito", cor: "warn", dica: "Aparece um aviso ao abrir O.S. para este cliente." },
  bloqueado: { t: "Bloqueado", cor: "bad", dica: "Não é possível abrir O.S. para este cliente." },
};
export const COMBUSTIVEIS = ["Flex", "Gasolina", "Etanol", "Diesel", "GNV", "Híbrido", "Elétrico"];
export const ESTADO_CIVIL = ["Solteiro(a)", "Casado(a)", "União estável", "Divorciado(a)", "Viúvo(a)"];
export const UNIDADES = ["UN", "PC", "KIT", "JG", "PAR", "L", "ML", "KG", "M", "CX", "SERV"];

export const QUALIDADE = { original: "Original / genuína", paralela: "Paralela (mesma especificação)", usada: "Usada / recondicionada" };

export const TERMO_ENTRADA = "Declaro que entreguei o veículo acima identificado nas condições registradas neste checklist e nas fotos anexas, e autorizo a oficina a realizar o diagnóstico. Nenhum serviço será executado sem a apresentação de orçamento e a minha aprovação expressa. Recomenda-se retirar objetos de valor do veículo; os que permanecerem devem estar declarados neste documento. Os dados pessoais informados são usados apenas para identificação, contato e emissão de documentos referentes a este atendimento (Lei 13.709/2018).";
export const TERMO_ORCAMENTO = "Orçamento prévio conforme o art. 40 do Código de Defesa do Consumidor. Salvo indicação em contrário, os valores são válidos pelo prazo informado acima, contado do recebimento. Nenhum serviço será executado sem aprovação. Serviços ou peças adicionais identificados durante a execução serão orçados e só executados mediante nova aprovação. As peças empregadas são novas e originais ou mantêm as especificações técnicas do fabricante, salvo autorização expressa do cliente para outra condição, indicada item a item (art. 21 do CDC).";
export const TERMO_GARANTIA = "Garantia de {dias} dias sobre os serviços executados, contados da data de entrega do veículo. Peças fornecidas pela oficina têm garantia pelo mesmo prazo ou pelo prazo do fabricante, o que for maior. Para peças fornecidas pelo cliente, a oficina garante a mão de obra de instalação; defeitos de fabricação dessas peças são de responsabilidade do seu fornecedor, e a mão de obra de nova substituição motivada por esse defeito será orçada à parte. A garantia não cobre danos decorrentes de uso inadequado, acidentes, intervenção de terceiros ou falta da manutenção recomendada. Para acioná-la, apresente esta ordem de serviço.";

export const CONFIG_PADRAO = {
  nome: "DTCAR CENTRO AUTOMOTIVO", endereco: "", telefone: "", cnpj: "", logo: "",
  valorHora: 0, markupPecas: 30, garantiaDias: 90, validadeDias: 10, taxaDiagnostico: 0,
  exigirFotos: true, itensExtras: [],
  formasPagamento: ["PIX", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Boleto"],
  cidade: "Colatina-ES",
  situacoesOS: ["Aguardando peças", "Faltando peças", "Aguardando pagamento", "Retorno / garantia"],
  tiposCliente: ["Particular", "Empresa", "Frota", "Motorista de aplicativo", "Comerciante", "Produtor rural", "Mecânico / revenda"],
  textoRecibo: "Pelo que firmamos o presente recibo, dando plena e irrevogável quitação do valor aqui recebido.",
  impressaoVias: 1,
  markupTerceiros: 20,
  categoriasDespesa: ["Fornecedores de peças", "Serviços de terceiros", "Aluguel", "Energia", "Água", "Telefone e internet", "Impostos e taxas", "Simples Nacional (DAS)",
    "Salários e encargos", "Pró-labore", "Contabilidade", "Sistemas e assinaturas", "Equipamentos e ferramentas", "Manutenção do imóvel", "Marketing", "Combustível",
    "Cartão de crédito", "Empréstimos e financiamentos", "Taxas bancárias", "Outras despesas"],
  condicoesPadrao: "Pagamento na retirada do veículo.",
  termoEntrada: TERMO_ENTRADA, termoOrcamento: TERMO_ORCAMENTO, termoGarantia: TERMO_GARANTIA,
};
export const cfgCompleta = c => ({ ...CONFIG_PADRAO, ...(c || {}) });
export function termoEntradaFinal(cfg) {
  const t = cfg.termoEntrada || TERMO_ENTRADA;
  return Number(cfg.taxaDiagnostico) > 0
    ? t + " Caso o orçamento não seja aprovado, será cobrada taxa de diagnóstico de R$ " + Number(cfg.taxaDiagnostico).toLocaleString("pt-BR", { minimumFractionDigits: 2 }) + "."
    : t;
}
