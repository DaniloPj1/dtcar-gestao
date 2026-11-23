// Comissão por linha de serviço (v64, 23/11/2026): as regras puras de js/comissoes.js e a conta do mês em js/folha.js.
// Roda sem navegador e sem banco: node teste/teste_comissoes.mjs
import { servicosDaOS, baseDaLinha, valorComissao, competenciaDaOS, funcDoPerfil, sugestoesDaOS, pctSugerido,
  somarPorFuncionario, ordensComRateio, pendenciaDaOS } from "../js/comissoes.js";
import { calcularMes } from "../js/folha.js";

const ok = [], falhas = [];
const chk = (n, c, extra = "") => (c ? ok : falhas).push(c ? n : n + (extra === "" ? "" : " :: " + JSON.stringify(extra)));

const FUNCS = [
  { id: "f1", nome: "ALEX FRANCISCO", apelido: "BAIXINHO", perfil_id: "pa", comissao_pct: 45, ativo: true },
  { id: "f2", nome: "FRANCISCO", apelido: "CHIQUINHO", perfil_id: "pf", comissao_pct: 50, ativo: true },
  { id: "f3", nome: "TIAGO BOLZANI", apelido: "MAMUTE", perfil_id: "pt", comissao_pct: 0, ativo: true },
];
const ITENS = [
  { id: "s1", ordem_id: "o1", tipo: "servico", descricao: "SUBST. PASTILHA E DISCO DE FREIO DIANTEIRO", qtd: 2, valor_unit: 90, desconto: 0, aprovado: true },
  { id: "s2", ordem_id: "o1", tipo: "servico", descricao: "SUBST. SEMI-EIXO DIANTEIRO ESQUERDO", qtd: 1, valor_unit: 280, desconto: 0, aprovado: true },
  { id: "s3", ordem_id: "o1", tipo: "servico", descricao: "SERVIÇO RECUSADO PELO CLIENTE", qtd: 1, valor_unit: 500, desconto: 0, aprovado: false },
  { id: "p1", ordem_id: "o1", tipo: "peca", descricao: "PASTILHA", qtd: 1, valor_unit: 300, desconto: 0, aprovado: true },
];
const ORDEM = { id: "o1", numero: 1933, tecnico_id: "f1", entregue_em: "2026-11-20T18:00:00-03:00" };

/* ---------- o que entra na comissão ---------- */
const servs = servicosDaOS(ITENS);
chk("só mão de obra entra: peça fica de fora", servs.every(i => i.tipo === "servico") && !servs.some(i => i.id === "p1"));
chk("serviço recusado pelo cliente não entra", !servs.some(i => i.id === "s3"), servs.map(i => i.id));
chk("sobram os dois serviços aprovados", servs.length === 2, servs.map(i => i.id));
chk("base da linha é qtd × valor − desconto", baseDaLinha(ITENS[0]) === 180 && baseDaLinha(ITENS[1]) === 280);
chk("desconto na linha diminui a base", baseDaLinha({ qtd: 2, valor_unit: 90, desconto: 30 }) === 150);

/* ---------- a conta da comissão ---------- */
chk("45% de 180 = 81", valorComissao(180, 45) === 81);
chk("arredonda em centavos", valorComissao(333.33, 33) === 110);
chk("percentual vazio dá zero", valorComissao(180, 0) === 0 && valorComissao(180, null) === 0);

/* ---------- competência: o mês da ENTREGA, no fuso de Brasília ---------- */
chk("entrega no meio do mês", competenciaDaOS({ entregue_em: "2026-11-20T18:00:00-03:00" }) === "2026-11-01");
chk("entrega às 22h30 do dia 30 (01 de madrugada em UTC) continua no mês dela",
  competenciaDaOS({ entregue_em: "2026-12-01T01:30:00Z" }) === "2026-11-01", competenciaDaOS({ entregue_em: "2026-12-01T01:30:00Z" }));
chk("O.S. sem entrega não tem competência", competenciaDaOS({}) === null && competenciaDaOS(null) === null);

/* ---------- sugestão a partir do que o app registrou ---------- */
chk("acha o funcionário pelo acesso do app", (funcDoPerfil(FUNCS, "pa") || {}).id === "f1" && funcDoPerfil(FUNCS, "xx") === null);

const APONT = [{ perfil_id: "pa", perfil_nome: "Alexandro Francisco", itens_executados: ["s1"],
  indicacoes: [{ item_id: "s2", para_id: "pt", para_nome: "Tiago Bolzani" }] }];
const sug = sugestoesDaOS(ORDEM, ITENS, APONT, FUNCS);
chk("item marcado como executado no app vai para quem marcou",
  sug.por.s1.length === 1 && sug.por.s1[0].funcionario_id === "f1" && sug.por.s1[0].origem === "app", sug.por.s1);
chk("item indicado a outro vai para o indicado",
  sug.por.s2.length === 1 && sug.por.s2[0].funcionario_id === "f3" && sug.por.s2[0].origem === "app", sug.por.s2);
chk("a sugestão usa o apelido, que é como a oficina chama", sug.por.s1[0].funcionario_nome === "BAIXINHO");
chk("peça e serviço recusado não ganham sugestão", !sug.por.p1 && !sug.por.s3);

// sem apontamento nenhum, cai no técnico responsável da O.S.
const sug2 = sugestoesDaOS(ORDEM, ITENS, [], FUNCS);
chk("sem apontamento, sugere o técnico responsável em todo serviço",
  sug2.por.s1[0].funcionario_id === "f1" && sug2.por.s2[0].funcionario_id === "f1" && sug2.por.s1[0].origem === "manual");
chk("O.S. sem técnico e sem apontamento não sugere nada", Object.keys(sugestoesDaOS({ id: "o1" }, ITENS, [], FUNCS).por).length === 0);

// o mesmo serviço apontado por duas pessoas: as duas são sugeridas, sem repetir
const sug3 = sugestoesDaOS(ORDEM, ITENS, [
  { perfil_id: "pa", itens_executados: ["s1", "s1"] },
  { perfil_id: "pf", itens_executados: ["s1"] }], FUNCS);
chk("dois mecânicos no mesmo serviço: os dois são sugeridos",
  sug3.por.s1.length === 2 && sug3.por.s1.map(x => x.funcionario_id).join(",") === "f1,f2", sug3.por.s1);
chk("a mesma pessoa não é sugerida duas vezes no mesmo serviço", new Set(sug3.por.s1.map(x => x.funcionario_id)).size === 2);

// apontou no app mas o acesso não está ligado a nenhum funcionário: a tela avisa, em vez de perder a comissão em silêncio
const sug4 = sugestoesDaOS(ORDEM, ITENS, [{ perfil_id: "zz", perfil_nome: "Novato", itens_executados: ["s1"] }], FUNCS);
chk("acesso sem funcionário vinculado é avisado pelo nome", sug4.semCadastro.includes("Novato"), sug4.semCadastro);
chk("e o serviço dele não é atribuído a ninguém por engano", (sug4.por.s1 || []).every(x => x.funcionario_id !== "zz"));

chk("percentual oferecido é o do cadastro", pctSugerido(FUNCS[0]) === 45 && pctSugerido(FUNCS[2]) === 0 && pctSugerido(null) === 0);

/* ---------- somas e pendência ---------- */
const COM = [
  { ordem_id: "o1", item_id: "s1", funcionario_id: "f1", base: 180, valor: 81, percentual: 45 },
  { ordem_id: "o1", item_id: "s2", funcionario_id: "f3", base: 280, valor: 28, percentual: 10 },
  { ordem_id: "o2", item_id: "s9", funcionario_id: "f1", base: 100, valor: 45, percentual: 45 },
];
const soma = somarPorFuncionario(COM);
chk("soma por funcionário junta O.S. diferentes", soma.f1.valor === 126 && soma.f1.linhas === 2 && soma.f1.base === 280, soma.f1);
chk("quem não tem linha não aparece na soma", !soma.f2);
chk("comissão sem funcionário é ignorada", !somarPorFuncionario([{ ordem_id: "o1", valor: 50 }]).undefined);
chk("ordensComRateio lista as O.S. já rateadas", [...ordensComRateio(COM)].sort().join(",") === "o1,o2");

const pend = pendenciaDaOS(ITENS, [{ item_id: "s1" }]);
chk("pendência conta os serviços sem rateio e quanto falta", pend.total === 2 && pend.faltam === 1 && pend.valorFaltante === 280, pend);
chk("O.S. toda rateada não tem pendência", pendenciaDaOS(ITENS, [{ item_id: "s1" }, { item_id: "s2" }]).faltam === 0);

/* ---------- a folha do mês ---------- */
const F = { salario: 0, horas_mes: 220, he_pct: 50, comissao_pct: 45, vinculo: "mei", admissao: "2026-11-09" };
const antigo = calcularMes(F, "2026-11", [], 1000, {});
chk("número solto continua valendo (O.S. antigas e a função 'agente' no commit anterior)",
  antigo.comissao === 450 && antigo.comissaoPct === 450 && antigo.comissaoLinhas === 0, antigo.comissao);
const soLinha = calcularMes(F, "2026-11", [], { base: 0, porLinha: 126 }, {});
chk("O.S. rateada conta pelo valor das linhas, não pelo percentual cheio", soLinha.comissao === 126 && soLinha.comissaoPct === 0);
const misto = calcularMes(F, "2026-11", [], { base: 200, porLinha: 126 }, {});
chk("mês com O.S. rateada e O.S. no percentual cheio soma as duas", misto.comissao === 216 && misto.comissaoPct === 90 && misto.comissaoLinhas === 126, misto.comissao);
const comAvulsa = calcularMes(F, "2026-11", [{ tipo: "comissao", valor: 50, qtd: 0 }], { base: 0, porLinha: 100 }, {});
chk("comissão avulsa lançada à mão continua somando", comAvulsa.comissao === 150, comAvulsa.comissao);
chk("comissão entra nos proventos e no líquido", misto.proventos === 216 && misto.liquido === 216, [misto.proventos, misto.liquido]);

console.log(ok.map(x => "OK " + x).join("\n"));
console.log("\nOK " + ok.length);
console.log("FALHAS", falhas);
process.exit(falhas.length ? 1 : 0);
