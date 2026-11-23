// Modelos de mensagem do WhatsApp no molde aprovado pelo Danilo em 23/11/2026:
// título com UM ícone, saudação pela hora, "Sr."/"Sra." deduzido do nome, tópicos e a assinatura no fim.
// Lógica pura (sem tela e sem banco): node teste/teste_mensagens.mjs
import { MSG, msgBoasVindas, msgCobrancaParcela, abertura, saudacao, tratamento, capitalizar, veicTopico } from "../js/mensagens.js";

const ok = [], falhas = [];
const confere = (nome, cond, extra = "") => (cond ? ok : falhas).push(nome + (cond ? "" : " — " + extra));

const cfg = { nome: "DTCar Centro Automotivo", endereco: "Rua Example, 100 — Colatina/ES" };
const MANHA = new Date("2026-11-23T11:00:00Z");  // 08:00 Brasília
const TARDE = new Date("2026-11-23T18:00:00Z");  // 15:00 Brasília
const NOITE = new Date("2026-11-24T01:00:00Z");  // 22:00 Brasília
const ASS1 = "DTCar Centro Automotivo", ASS2 = "*Mensagem gerada pelo sistema Gestão DTCar*";

const os = {
  numero: 1934, cliente: { nome: "MARCOS AUGUSTO SILVA" }, veiculo: { marca: "Ford", modelo: "Ka", placa: "OZK8H21" },
  criado_em: "2026-11-23T11:40:00Z", km_entrada: 128450, total: 1240, recebido: 0, desconto: 0,
  garantia_dias: 90, entregue_em: "2026-11-23T11:40:00Z", validade_orcamento: "2026-11-30", previsao_entrega: "2026-11-25",
};
const itens = [{ tipo: "peca", descricao: "PASTILHA DE FREIO DIANTEIRA", qtd: 1, valor_unit: 180, aprovado: null },
  { tipo: "servico", descricao: "SUBST. DE PASTILHAS", qtd: 1, valor_unit: 240, aprovado: null }];

// ---------- saudação e tratamento ----------
confere("saudação pela hora de Brasília", saudacao(MANHA) === "Bom dia" && saudacao(TARDE) === "Boa tarde" && saudacao(NOITE) === "Boa noite");
confere("meio-dia já é Boa tarde", saudacao(new Date("2026-11-23T15:00:00Z")) === "Boa tarde");
confere("18h em ponto é Boa noite", saudacao(new Date("2026-11-23T21:00:00Z")) === "Boa noite");
confere("tratamento deduzido do primeiro nome", tratamento("MARCOS AUGUSTO") === "Sr." && tratamento("FERNANDA LIMA") === "Sra.");
confere("femininos que não terminam em A", ["BEATRIZ", "RAQUEL", "ISABEL", "CARMEM", "NICOLE", "ELIANE"].every(n => tratamento(n) === "Sra."));
confere("masculinos que terminam em A", ["LUCA", "NICOLA", "JONATA", "SACHA"].every(n => tratamento(n) === "Sr."));
confere("empresa não leva tratamento", tratamento("ARITUR TRANSPORTE E TURISMO LTDA") === "" && tratamento("") === "");
confere("nome do cadastro (maiúsculas) vai escrito normal", capitalizar("MARIA DA SILVA") === "Maria da Silva" && capitalizar("JOSE DOS SANTOS") === "Jose dos Santos");
confere("abertura de pessoa física", abertura("MARCOS AUGUSTO SILVA", MANHA) === "Bom dia, Sr. Marcos!");
confere("abertura de mulher", abertura("FERNANDA LIMA", TARDE) === "Boa tarde, Sra. Fernanda!");
confere("abertura de empresa: sem tratamento, sem o tipo societário e sem terminar em conectivo",
  abertura("ARITUR TRANSPORTE E TURISMO LTDA", MANHA) === "Bom dia, Aritur Transporte!" && abertura("MARBRASA GRANITOS LTDA", MANHA) === "Bom dia, Marbrasa Granitos!");
confere("sem nome, só a saudação", abertura("", MANHA) === "Bom dia!" && abertura(null, MANHA) === "Bom dia!");
confere("veículo no tópico", veicTopico(os) === "Ford Ka — OZK8H21");

// ---------- molde: todas as mensagens ----------
const todas = {
  entrada: MSG.entrada(os, cfg, itens, { agora: MANHA }),
  orcamento_pdf: MSG.orcamento(os, cfg, itens, { agora: MANHA, comPdf: true }),
  orcamento: MSG.orcamento(os, cfg, itens, { agora: MANHA }),
  adicionais: MSG.adicionais(os, cfg, itens, { agora: TARDE }),
  pronto: MSG.pronto(os, cfg, itens, { agora: TARDE }),
  entrega: MSG.entrega(os, cfg, itens, { agora: TARDE }),
  cobranca: MSG.cobranca(os, cfg, itens, { agora: MANHA, hoje: "2026-11-23",
    parcelas: [{ status: "aberta", parcela: 1, parcelas: 2, valor: 620, vencimento: "2026-11-20", forma: "Boleto" },
      { status: "aberta", parcela: 2, parcelas: 2, valor: 620, vencimento: "2026-12-20", forma: "Boleto" }] }),
  boas_vindas: msgBoasVindas({ nome: "MARCOS AUGUSTO SILVA" }, cfg, MANHA),
  parcela: msgCobrancaParcela({ cliente_nome: "FERNANDA LIMA", descricao: "O.S. 1930", parcela: 1, parcelas: 1, valor: 480,
    vencimento: "2026-11-20", forma: "Boleto" }, cfg, "2026-11-23", TARDE),
};

// reais() usa espaço não separável entre "R$" e o número: normaliza para comparar
const semNbsp = t => String(t).replace(/\u00a0/g, " ");
const EMOJI = /\p{Extended_Pictographic}/gu;
for (const [nome, t] of Object.entries(todas)) {
  const linhas = t.split("\n");
  confere(nome + ": título com um ícone em negrito na 1ª linha", /^\p{Extended_Pictographic} \*[^*]+\*$/u.test(linhas[0]), linhas[0]);
  confere(nome + ": um emoji só na mensagem toda", (t.match(EMOJI) || []).length === 1, JSON.stringify(t.match(EMOJI)));
  confere(nome + ": saudação na 3ª linha", /^(Bom dia|Boa tarde|Boa noite)[,!]/.test(linhas[2]), linhas[2]);
  confere(nome + ": assinatura nas duas últimas linhas, a última em negrito",
    linhas[linhas.length - 2] === ASS1 && linhas[linhas.length - 1] === ASS2, linhas.slice(-2).join(" | "));
  confere(nome + ": sem três quebras de linha seguidas", !/\n{3}/.test(t));
  confere(nome + ": sem linha vazia antes da assinatura ou no fim", !/\n\n$/.test(t) && t === t.trimEnd());
  confere(nome + ": tópicos com • quando há mais de uma informação", !t.includes("\n- "), t);
}
confere("pronto: leva o veículo, o total em negrito e o endereço",
  semNbsp(todas.pronto).includes("• Ford Ka — OZK8H21") && semNbsp(todas.pronto).includes("*R$ 1.240,00*") && todas.pronto.includes(cfg.endereco));
confere("entrada: data e KM na mesma linha, sem repetir a palavra km",
  /• Entrada em .+, com 128\.450 km$/m.test(todas.entrada) && !/KM .*km/.test(todas.entrada), todas.entrada);
confere("orçamento com PDF é curto e pede APROVADO", todas.orcamento_pdf.length < 420 && todas.orcamento_pdf.includes("*APROVADO*"));
confere("orçamento sem PDF lista os itens", todas.orcamento.includes("*Peças:*") && todas.orcamento.includes("PASTILHA DE FREIO DIANTEIRA"));
confere("cobrança: uma linha por parcela, vencida e a vencer", todas.cobranca.includes("venceu em 20/11/2026") && todas.cobranca.includes("vence em 20/12/2026"));
confere("entrega: garantia com o prazo e a data", /Garantia de 90 dias, até \d{2}\/\d{2}\/\d{4}/.test(todas.entrega));
confere("boas-vindas: diz como sair dos avisos", todas.boas_vindas.includes("responda PARAR"));
confere("parcela avulsa: valor em negrito e o vencimento", semNbsp(todas.parcela).includes("*R$ 480,00*") && todas.parcela.includes("20/11/2026"));
confere("nenhuma mensagem passa de 700 caracteres (fora o orçamento com itens)",
  Object.entries(todas).filter(([n]) => n !== "orcamento").every(([, t]) => t.length <= 700),
  Object.entries(todas).map(([n, t]) => n + ":" + t.length).join(" "));

// cliente sem cadastro (número desconhecido): a mensagem sai sem nome, nunca com "undefined"
const semNome = MSG.pronto({ ...os, cliente: {} }, cfg, itens, { agora: TARDE });
confere("sem nome do cliente: saudação sozinha, sem 'undefined'", semNome.includes("\nBoa tarde!\n") && !/undefined|null/.test(semNome), semNome.slice(0, 60));

console.log(ok.map(x => "OK " + x).join("\n"));
console.log("FALHAS", JSON.stringify(falhas, null, falhas.length ? 1 : 0));
process.exit(falhas.length ? 1 : 0);
