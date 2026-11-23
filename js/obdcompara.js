/**
 * O carro comparado com ELE MESMO. (Etapa 1, frente 3.)
 *
 * Não existe base aberta de "faixa normal" por motor. O que dá para saber sem ela é se o carro
 * MUDOU em relação às leituras anteriores dele. Para isso a sessão de leitura é resumida — por
 * sinal e por REGIME (marcha lenta, cruzeiro) — e guardada; na leitura seguinte o resumo de hoje
 * é posto ao lado dos anteriores.
 *
 * A REGRA, copiada da ferramenta de onde a ideia veio: os dados nomeiam um PADRÃO, nunca uma peça.
 * Todo achado sai escrito como hipótese.
 *
 * Não tem window nem document: dá para testar sem navegador.
 */
export const REGIMES = { lenta: "Marcha lenta", cruzeiro: "Cruzeiro" };
const LENTA_RPM = [450, 1200], QUENTE = 70, CRUZEIRO_KMH = 40, CRUZEIRO_VARIA = 3;
export const MIN_AMOSTRAS = 8;         // menos que isso num regime não é retrato de nada

/** Em que regime o carro está, pelo que já foi lido. null = nenhum que valha comparar. */
export function regimeDe(e) {
  const rpm = e.rpm, v = e.velocidade, t = e.temperatura;
  if (typeof rpm !== "number" || typeof v !== "number") return null;
  if (typeof t === "number" && t < QUENTE) return null;                 // motor frio muda tudo: não compara
  if (v === 0 && rpm >= LENTA_RPM[0] && rpm <= LENTA_RPM[1]) return "lenta";
  if (v >= CRUZEIRO_KMH && typeof e.velocidadeAntes === "number" && Math.abs(v - e.velocidadeAntes) <= CRUZEIRO_VARIA) return "cruzeiro";
  return null;
}

export const novaSessao = () => ({ inicio: Date.now(), estado: {}, sinais: {} });

/** Anota uma leitura ({ chave, pid, rotulo, unidade, valor }) na sessão. */
export function anotar(s, l) {
  if (!l || typeof l.valor !== "number" || !isFinite(l.valor)) return;
  const e = s.estado;
  if (l.pid === 0x0c) e.rpm = l.valor;
  else if (l.pid === 0x0d) { e.velocidadeAntes = e.velocidade; e.velocidade = l.valor; }
  else if (l.pid === 0x05) e.temperatura = l.valor;
  const reg = regimeDe(e);
  if (!reg) return;
  const sinal = s.sinais[l.chave] || (s.sinais[l.chave] = { rotulo: l.rotulo || l.chave, unidade: l.unidade || "", r: {} });
  const a = sinal.r[reg] || (sinal.r[reg] = { n: 0, min: l.valor, max: l.valor, soma: 0, ultimo: l.valor });
  a.n++; a.soma += l.valor; a.ultimo = l.valor;
  if (l.valor < a.min) a.min = l.valor;
  if (l.valor > a.max) a.max = l.valor;
}

const arred = n => Math.round(n * 100) / 100;
/** O resumo que vai para o banco: só os regimes com amostra que baste. null se não há o que guardar. */
export function resumo(s) {
  const sinais = {};
  for (const k of Object.keys(s.sinais)) {
    const o = s.sinais[k], r = {};
    for (const reg of Object.keys(o.r)) {
      const a = o.r[reg];
      if (a.n >= MIN_AMOSTRAS) r[reg] = { n: a.n, min: arred(a.min), max: arred(a.max), media: arred(a.soma / a.n) };
    }
    if (Object.keys(r).length) sinais[k] = { rotulo: o.rotulo, unidade: o.unidade, r };
  }
  return Object.keys(sinais).length ? { duracao_s: Math.round((Date.now() - s.inicio) / 1000), sinais } : null;
}

// Quanto a média de hoje precisa sair do que o carro já fez para virar achado. Dois critérios
// juntos, para não acusar ruído: fora da faixa que as sessões anteriores cobriram E longe da média
// delas por mais que a própria variação delas (com um piso, para sinal que quase não varia).
const PISO_RELATIVO = 0.08;

/**
 * Compara o resumo de hoje com os resumos anteriores DO MESMO CARRO.
 * Devolve { sessoes, achados: [{ chave, rotulo, unidade, regime, hoje, antes, de, ate, sentido, texto }] }.
 * Com menos de 2 sessões anteriores não acusa nada: uma leitura só não é o normal do carro.
 */
export function comparar(hoje, anteriores) {
  const ant = (anteriores || []).filter(a => a && a.sinais);
  const out = { sessoes: ant.length, achados: [] };
  if (!hoje || ant.length < 2) return out;
  for (const k of Object.keys(hoje.sinais)) {
    for (const reg of Object.keys(hoje.sinais[k].r)) {
      const medias = ant.map(a => a.sinais[k] && a.sinais[k].r[reg] && a.sinais[k].r[reg].media).filter(x => typeof x === "number");
      if (medias.length < 2) continue;
      const h = hoje.sinais[k].r[reg].media;
      const de = Math.min(...medias), ate = Math.max(...medias), media = medias.reduce((a, b) => a + b, 0) / medias.length;
      const folga = Math.max(ate - de, Math.abs(media) * PISO_RELATIVO, 0.5);
      if (h >= de - folga && h <= ate + folga) continue;
      const sentido = h > ate ? "acima" : "abaixo";
      out.achados.push({ chave: k, rotulo: hoje.sinais[k].rotulo, unidade: hoje.sinais[k].unidade, regime: reg, hoje: h, antes: arred(media), de: arred(de), ate: arred(ate), sentido,
        texto: hoje.sinais[k].rotulo + " em " + REGIMES[reg].toLowerCase() + " está " + sentido + " do que este carro marcou nas " + medias.length + " leituras anteriores. Hipótese para investigar — o dado mostra a mudança, não a peça." });
    }
  }
  return out;
}
