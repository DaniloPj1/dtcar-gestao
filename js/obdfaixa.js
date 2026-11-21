/**
 * A FAIXA DE TRABALHO de cada leitura ao vivo, ao lado do valor de agora.
 * (Pedido do Danilo, 21/11/2026: "o parâmetro de trabalho de temperatura desse carro é de x a y e
 * a leitura ao vivo está em…".)
 *
 * DE ONDE VEM A FAIXA — e a tela escreve qual das duas é:
 *  1. DESTE CARRO: o que ele mesmo marcou nas leituras anteriores, no mesmo regime (marcha lenta ou
 *     cruzeiro, motor quente). É o parâmetro mais honesto que existe, porque não há tabela pública
 *     de faixa normal por motor — muito menos para flex brasileiro. Precisa de pelo menos 2
 *     leituras guardadas da placa (js/obdcompara.js guarda sozinho).
 *  2. REFERÊNCIA: a tabela de js/obdparam.js, com o NÍVEL DE CONFIANÇA escrito (conferido aqui,
 *     norma, montadora ou suposto). Só para as leituras que têm referência; as outras ficam sem.
 *
 * Nada aqui é inventado: leitura sem histórico e sem referência aparece sem faixa.
 * Não tem window nem document: dá para testar sem navegador.
 */
import * as param from "./obdparam.js";

// Qual parâmetro da tabela vale para qual leitura, e em que condição ele se aplica.
//   quando: "ligado" = motor funcionando; "lenta" = só em marcha lenta com motor quente.
//   simetrico: a tabela guarda UM número (10 %) e a faixa é de −10 a +10.
const LIGACAO = [
  { pids: [0x05], id: "arrefecimento_trabalho", quando: "ligado", rotulo: "motor quente" },
  { pids: [0x06, 0x07, 0x08, 0x09], id: "ajuste_atencao", quando: "ligado", simetrico: true, rotulo: "antes de chamar atenção" },
  { pids: [0x23, 0x59], id: "rail_lenta_1kd", quando: "lenta", rotulo: "marcha lenta" },
  { pids: [0x23, 0x59], id: "rail_lenta_geral", quando: "lenta", rotulo: "marcha lenta" },
  { pids: [0x10], id: "maf_lenta_1kd", quando: "lenta", rotulo: "marcha lenta" },
];
// Parâmetro que só vale para um motor: confere pelo cadastro. Sem cadastro que case, não é usado.
const SO_PARA = { rail_lenta_1kd: c => /HILUX|SW4/i.test(c.modelo || "") && /3[.,]0/.test((c.modelo || "") + " " + (c.motor || "")), maf_lenta_1kd: c => /HILUX|SW4/i.test(c.modelo || "") && /3[.,]0/.test((c.modelo || "") + " " + (c.motor || "")) };
const BAR_PARA_KPA = 100;   // a tabela guarda o rail em bar; o PID entrega em kPa

/** A referência da tabela para esta leitura, ou null. `ctx` = { rpm, regime, carro }. */
export function referencia(l, ctx = {}) {
  const ligado = typeof ctx.rpm === "number" && ctx.rpm > 400;
  for (const g of LIGACAO) {
    if (!g.pids.includes(l.pid) || (l.parte || 0) !== 0) continue;
    if (SO_PARA[g.id] && !SO_PARA[g.id](ctx.carro || {})) continue;
    if (g.quando === "ligado" && !ligado) continue;
    if (g.quando === "lenta" && ctx.regime !== "lenta") continue;
    const p = param.porId(g.id);
    if (!p) continue;
    let f = param.faixaDe(g.id);
    if (!f && g.simetrico) { const v = param.valorDe(g.id); if (typeof v === "number") f = { de: -v, ate: v }; }
    if (!f) continue;
    const k = p.unidade === "bar" && l.unidade === "kPa" ? BAR_PARA_KPA : 1;
    return { de: f.de * k, ate: f.ate * k, nivel: param.nivelDe(g.id), nivelNome: param.nivel(param.nivelDe(g.id)).nome, rotulo: g.rotulo, origem: "referencia" };
  }
  return null;
}

export const MIN_SESSOES = 2;
/**
 * A faixa DESTE carro: o menor e o maior valor que ele marcou nas leituras anteriores, no regime
 * de agora. `sessoes` = resumos guardados (js/obdcompara.js). null sem regime ou com menos de 2.
 */
export function doCarro(l, regime, sessoes) {
  if (!regime) return null;
  const rs = (sessoes || []).map(s => s && s.sinais && s.sinais[l.chave] && s.sinais[l.chave].r && s.sinais[l.chave].r[regime]).filter(Boolean);
  if (rs.length < MIN_SESSOES) return null;
  return { de: Math.min(...rs.map(r => r.min)), ate: Math.max(...rs.map(r => r.max)), leituras: rs.length, regime, origem: "carro" };
}

/** Onde o valor está em relação à faixa: "dentro" | "acima" | "abaixo". */
export const situar = (valor, f) => (valor > f.ate ? "acima" : valor < f.de ? "abaixo" : "dentro");

const n = x => String(Math.round(x * 10) / 10).replace(".", ",");
const NOME_REGIME = { lenta: "marcha lenta", cruzeiro: "velocidade constante" };

/**
 * O que a tela escreve embaixo da leitura. Devolve null (sem faixa) ou
 * { de, ate, origem, situacao, texto, fonte } — a faixa do carro ganha da referência.
 */
export function faixaPara(l, ctx = {}) {
  if (!l || typeof l.valor !== "number") return null;
  const c = doCarro(l, ctx.regime, ctx.sessoes), r = referencia(l, ctx);
  const f = c || r;
  if (!f) return null;
  const u = l.unidade ? " " + l.unidade : "";
  const situacao = situar(l.valor, f);
  return { ...f, situacao,
    texto: n(f.de) + " a " + n(f.ate) + u,
    fonte: f.origem === "carro" ? "este carro, em " + NOME_REGIME[f.regime] + " (" + f.leituras + " leituras)" : "referência, " + f.rotulo + " · " + f.nivelNome.toLowerCase(),
    outra: c && r ? "Referência (" + r.nivelNome.toLowerCase() + "): " + n(r.de) + " a " + n(r.ate) + u : "" };
}
