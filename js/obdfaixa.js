/**
 * A FAIXA DE TRABALHO de cada leitura ao vivo, ao lado do valor de agora.
 * (Pedido do Danilo, 21/11/2026: "o parâmetro de trabalho de temperatura desse carro é de x a y e
 * a leitura ao vivo está em…".)
 *
 * A FAIXA É SEMPRE A TABELA DE REFERÊNCIA (js/obdparam.js), com o nível de confiança escrito.
 * Ordem do Danilo em 23/11/2026, depois do que aconteceu numa Amarok: até então a faixa saía do
 * HISTÓRICO do próprio carro (o menor e o maior que ele já tinha marcado) e ganhava da referência.
 * Isso deu 75 a 85 °C em marcha lenta e pintou de VERMELHO um motor normal a 86 °C — porque o
 * mínimo e o máximo de duas leituras é uma coincidência, não um parâmetro de trabalho. Pior: ao
 * acelerar, o regime mudava, o histórico sumia e a faixa "se corrigia" para a da referência, como
 * se houvesse duas leituras do mesmo dado. Agora há uma faixa só, e ela não muda com o acelerador.
 *
 * Leitura sem referência na tabela fica SEM faixa: inventar número é o que não pode.
 * Não tem window nem document: dá para testar sem navegador.
 */
import * as param from "./obdparam.js";

// Qual parâmetro da tabela vale para qual leitura, e em que condição ele se aplica.
//   quando: "ligado" = motor funcionando; "lenta" = só em marcha lenta com motor quente.
//   simetrico: a tabela guarda UM número (10 %) e a faixa é de −10 a +10.
const LIGACAO = [
  // Conferido no Raven, no carro: vem antes da suposição geral (23/11/2026).
  { pids: [0x05], id: "arrefecimento_edc17cp54", quando: "ligado", rotulo: "motor quente" },
  { pids: [0x0c], id: "lenta_edc17cp54", quando: "lenta", rotulo: "marcha lenta" },
  { pids: [0x0f], id: "iat_edc17cp54", quando: "ligado", rotulo: "motor ligado" },
  { pids: [0x23, 0x59], id: "rail_lenta_edc17cp54", quando: "lenta", rotulo: "marcha lenta" },
  { pids: [0x42], id: "bateria_motor_ligado", quando: "ligado", rotulo: "motor ligado" },
  { pids: [0x05], id: "arrefecimento_trabalho", quando: "ligado", rotulo: "motor quente" },
  { pids: [0x06, 0x07, 0x08, 0x09], id: "ajuste_atencao", quando: "ligado", simetrico: true, rotulo: "antes de chamar atenção" },
  { pids: [0x23, 0x59], id: "rail_lenta_1kd", quando: "lenta", rotulo: "marcha lenta" },
  { pids: [0x23, 0x59], id: "rail_lenta_geral", quando: "lenta", rotulo: "marcha lenta" },
  { pids: [0x10], id: "maf_lenta_1kd", quando: "lenta", rotulo: "marcha lenta" },
];
// Parâmetro que só vale para um motor: confere pelo cadastro. Sem cadastro que case, não é usado.
// O motor conferido no Raven: Amarok 2.0 bi-turbo diesel com Bosch EDC17CP54 (2016 em diante).
const E_AMAROK_20 = c => /AMAROK/i.test(c.modelo || "") && /2[.,]0/.test((c.modelo || "") + " " + (c.motor || ""));
const SO_PARA = { arrefecimento_edc17cp54: E_AMAROK_20, rail_lenta_edc17cp54: E_AMAROK_20, lenta_edc17cp54: E_AMAROK_20, iat_edc17cp54: E_AMAROK_20, rail_lenta_1kd: c => /HILUX|SW4/i.test(c.modelo || "") && /3[.,]0/.test((c.modelo || "") + " " + (c.motor || "")), maf_lenta_1kd: c => /HILUX|SW4/i.test(c.modelo || "") && /3[.,]0/.test((c.modelo || "") + " " + (c.motor || "")) };
const BAR_PARA_KPA = 100;   // a tabela guarda o rail em bar; o PID entrega em kPa

/** A referência da tabela para esta leitura, ou null. `ctx` = { rpm, regime, carro }. */
export function referencia(l, ctx = {}) {
  for (const g of LIGACAO) {
    if (!g.pids.includes(l.pid) || (l.parte || 0) !== 0) continue;
    if (SO_PARA[g.id] && !SO_PARA[g.id](ctx.carro || {})) continue;
    const p = param.porId(g.id);
    if (!p) continue;
    let f = param.faixaDe(g.id);
    if (!f && g.simetrico) { const v = param.valorDe(g.id); if (typeof v === "number") f = { de: -v, ate: v }; }
    if (!f) continue;
    const k = p.unidade === "bar" && l.unidade === "kPa" ? BAR_PARA_KPA : 1;
    return { de: f.de * k, ate: f.ate * k, nivel: param.nivelDe(g.id), nivelNome: param.nivel(param.nivelDe(g.id)).nome, rotulo: g.rotulo, quando: g.quando, origem: "referencia" };
  }
  return null;
}

/** Onde o valor está em relação à faixa: "dentro" | "acima" | "abaixo". */
export const situar = (valor, f) => (valor > f.ate ? "acima" : valor < f.de ? "abaixo" : "dentro");

const n = x => String(Math.round(x * 10) / 10).replace(".", ",");

/**
 * A faixa SE APLICA ao que o carro está fazendo agora? A faixa é sempre a mesma (não muda com o
 * acelerador), mas o julgamento não vale fora da condição dela: a faixa do rail em marcha lenta
 * não serve para julgar uma acelerada. Fora da condição a tela mostra a faixa em cinza, sem
 * vermelho — em vez de acusar um defeito que não existe.
 */
function seAplica(f, ctx) {
  if (!f) return false;
  const ligado = typeof ctx.rpm === "number" ? ctx.rpm > 400 : null;
  if (f.quando === "lenta") return ctx.regime === "lenta";
  if (f.quando === "ligado") return ligado !== false;
  return true;
}

/**
 * O que a tela mostra embaixo da leitura. Devolve null (sem faixa) ou
 * { de, ate, situacao, aplica, texto, fonte }. `situacao` é só onde o valor está; quem decide se
 * pinta de vermelho é `aplica`.
 */
export function faixaPara(l, ctx = {}) {
  if (!l || typeof l.valor !== "number") return null;
  const f = referencia(l, ctx);
  if (!f) return null;
  const u = l.unidade ? " " + l.unidade : "";
  return { ...f, situacao: situar(l.valor, f), aplica: seAplica(f, ctx),
    texto: n(f.de) + " a " + n(f.ate) + u,
    fonte: "referência, " + f.rotulo + " · " + f.nivelNome.toLowerCase() };
}
