// Comissão por linha de serviço (v64, pedido do Danilo em 23/11/2026).
// Regras puras, sem window/document: servem à tela (js/telas/comissoes.js), ao cálculo da folha (js/folha.js) e,
// mais à frente, à função "agente" — como o js/folha.js já faz.
//
// O problema que isto resolve: a comissão da folha era um percentual cheio sobre a mão de obra inteira da O.S., para
// o técnico responsável (v50). Mas um carro passa pela mão de mais de um mecânico, e o que cada um fez está em linhas
// diferentes. Aqui a conta passa a ser por LINHA: cada serviço vai para o nome de um (ou mais de um) funcionário,
// com o percentual lançado à mão pelo Danilo.
//
// O que o APP já sabe e a tela aproveita: quando o mecânico finaliza o serviço no celular (servico_apontamentos, v60)
// ele marca os itens que executou e indica a outro responsável as etapas que não são dele. É exatamente o rateio —
// por isso a tela chega com as linhas já sugeridas e o Danilo só confere e põe o percentual.
import { arred, totalItem } from "./util.js";

/** Serviços da O.S. que entram na comissão: só mão de obra e só o que não foi recusado (a mesma regra da folha). */
export const servicosDaOS = itens => (itens || []).filter(i => i.tipo === "servico" && i.aprovado !== false);

/** Mão de obra de uma linha: é a base da comissão daquele serviço. */
export const baseDaLinha = item => totalItem(item);

/** Comissão de uma linha: base × percentual ÷ 100. */
export const valorComissao = (base, pct) => arred((Number(base) || 0) * (Number(pct) || 0) / 100);

/** Mês da folha a que a comissão pertence (primeiro dia do mês da ENTREGA da O.S., no fuso de Brasília).
 *  A folha conta as O.S. entregues no mês; a competência fica gravada para não mudar se a entrega for refeita. */
export function competenciaDaOS(ordem) {
  const iso = (ordem && (ordem.entregue_em || ordem.finalizada_em)) || null;
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const br = new Date(d.getTime() - 3 * 3600000);  // UTC−3: entrega do dia 1 de madrugada não cai no mês anterior
  return br.getUTCFullYear() + "-" + String(br.getUTCMonth() + 1).padStart(2, "0") + "-01";
}

/** Funcionário dono de um acesso do sistema (perfil). O app grava perfil_id; a comissão é do funcionário. */
export const funcDoPerfil = (funcs, perfil_id) => perfil_id ? (funcs || []).find(f => f.perfil_id === perfil_id) || null : null;

/**
 * Sugestão de rateio a partir do que o app registrou, para a tela chegar preenchida.
 * Devolve { [item_id]: [{ funcionario_id, funcionario_nome, origem, perfil_nome }] }, sem percentual:
 * quem põe o percentual é o Danilo (decisão dele em 23/11/2026).
 *
 * De onde vem cada sugestão, nesta ordem:
 *  1. itens_executados do apontamento — o mecânico marcou "eu fiz este";
 *  2. indicacoes — ele indicou a etapa a outro responsável;
 *  3. técnico responsável da O.S. — para o serviço que ninguém apontou (O.S. antiga ou apontamento incompleto).
 * O mesmo funcionário nunca é sugerido duas vezes para o mesmo serviço.
 */
export function sugestoesDaOS(ordem, itens, apontamentos, funcs) {
  const fora = {};
  const por = {};
  const pôr = (item_id, f, origem) => {
    if (!item_id || !f) return;
    const l = por[item_id] || (por[item_id] = []);
    if (l.some(x => x.funcionario_id === f.id)) return;
    l.push({ funcionario_id: f.id, funcionario_nome: f.apelido || f.nome, origem });
  };
  for (const a of apontamentos || []) {
    const f = funcDoPerfil(funcs, a.perfil_id);
    for (const id of a.itens_executados || []) {
      if (f) pôr(id, f, "app");
      else fora[a.perfil_nome || "sem cadastro"] = true;   // apontou mas o acesso não está ligado a nenhum funcionário
    }
    for (const ind of a.indicacoes || []) pôr(ind.item_id, funcDoPerfil(funcs, ind.para_id), "app");
  }
  const tecnico = ordem && ordem.tecnico_id ? (funcs || []).find(f => f.id === ordem.tecnico_id) : null;
  if (tecnico) for (const i of servicosDaOS(itens)) if (!por[i.id]) pôr(i.id, tecnico, "manual");
  return { por, semCadastro: Object.keys(fora) };
}

/** Percentual que a tela oferece: o do cadastro do funcionário. O Danilo troca à mão quando quiser. */
export const pctSugerido = f => Number((f && f.comissao_pct) || 0);

/** Soma por funcionário de uma lista de comissões gravadas: { [funcionario_id]: { valor, base, linhas } } */
export function somarPorFuncionario(comissoes) {
  const r = {};
  for (const c of comissoes || []) {
    const k = c.funcionario_id;
    if (!k) continue;
    const a = r[k] || (r[k] = { valor: 0, base: 0, linhas: 0 });
    a.valor = arred(a.valor + (Number(c.valor) || 0));
    a.base = arred(a.base + (Number(c.base) || 0));
    a.linhas++;
  }
  return r;
}

/** Quais O.S. já têm rateio por linha lançado (conjunto de ordem_id). */
export const ordensComRateio = comissoes => new Set((comissoes || []).map(c => c.ordem_id).filter(Boolean));

/**
 * Quanto falta ratear numa O.S.: serviços sem nenhuma comissão lançada e o total deles.
 * É o que a tela mostra como "faltam N serviços" para o Danilo não deixar linha para trás.
 */
export function pendenciaDaOS(itens, comissoes) {
  const comRateio = new Set((comissoes || []).map(c => c.item_id));
  const servs = servicosDaOS(itens);
  const faltam = servs.filter(i => !comRateio.has(i.id));
  return { total: servs.length, faltam: faltam.length, valorFaltante: arred(faltam.reduce((s, i) => s + baseDaLinha(i), 0)) };
}
