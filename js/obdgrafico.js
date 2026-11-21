/**
 * A conta do gráfico dos dados ao vivo, separada da tela para dar para conferir sem navegador.
 *
 * REGRA (Danilo, 21/11/2026): até 3 GRÁFICOS na tela. Leituras da MESMA UNIDADE dividem um gráfico
 * e uma escala — é isso que deixa ver as 4 rodas do ABS juntas e enxergar a que diverge. Leitura
 * de unidade diferente abre outro gráfico, até o limite de 3.
 */
export const GRAFICOS_MAX = 3;       // gráficos na tela
export const LINHAS_MAX = 4;         // leituras no mesmo gráfico (as 4 rodas)
export const PONTOS = 120;           // pontos guardados por leitura
export const JANELA_MS = 60000;      // o gráfico mostra o último minuto

/** Leituras sem unidade não se misturam: cada uma é o seu gráfico. */
const grupoDe = l => (l.unidade ? "u:" + l.unidade : "k:" + l.chave);

/** Monta os gráficos da escolha: [{ grupo, unidade, leituras: [...] }], na ordem em que foram escolhidos. */
export function graficosDe(escolha, lidos) {
  const out = [];
  for (const k of escolha || []) {
    const l = (lidos || []).find(x => x.chave === k && typeof x.valor === "number");
    if (!l) continue;
    const g = grupoDe(l);
    let alvo = out.find(x => x.grupo === g);
    if (!alvo) { alvo = { grupo: g, unidade: l.unidade || "", leituras: [] }; out.push(alvo); }
    alvo.leituras.push(l);
  }
  return out;
}

/**
 * Tira ou põe uma leitura. Devolve { lista, recusa }: recusa "" quando entrou ou saiu, ou o motivo
 * escrito quando não coube.
 */
export function trocar(escolha, chave, lidos) {
  const lista = (escolha || []).slice();
  const i = lista.indexOf(chave);
  if (i >= 0) { lista.splice(i, 1); return { lista, recusa: "" }; }
  const l = (lidos || []).find(x => x.chave === chave);
  if (!l) return { lista, recusa: "" };
  const gs = graficosDe(lista, lidos), g = gs.find(x => x.grupo === grupoDe(l));
  if (g && g.leituras.length >= LINHAS_MAX) return { lista, recusa: "Este gráfico já tem " + LINHAS_MAX + " leituras. Tire uma para pôr outra." };
  if (!g && gs.length >= GRAFICOS_MAX) return { lista, recusa: "Já tem " + GRAFICOS_MAX + " gráficos. Leitura da mesma unidade entra junto num deles; de unidade diferente, tire um gráfico antes." };
  lista.push(chave);
  return { lista, recusa: "" };
}

/** Guarda mais um ponto da leitura na história ({ chave: [{ t, v }] }), sem deixar crescer. */
export function anotarPonto(historia, l, agora = Date.now()) {
  if (!l || typeof l.valor !== "number" || !isFinite(l.valor)) return;
  const h = historia[l.chave] || (historia[l.chave] = []);
  h.push({ t: agora, v: l.valor });
  if (h.length > PONTOS) h.splice(0, h.length - PONTOS);
}

/** A escala comum de um gráfico: o menor e o maior valor da janela, com folga. */
export function escalaDe(leituras, historia, agora = Date.now()) {
  const ini = agora - JANELA_MS;
  let mn = Infinity, mx = -Infinity, tem = false;
  for (const l of leituras) for (const p of historia[l.chave] || []) { if (p.t < ini) continue; tem = true; if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; }
  if (!tem) return { de: 0, ate: 1, min: null, max: null, ini };
  const folga = mx === mn ? Math.max(1, Math.abs(mx) * 0.05) : (mx - mn) * 0.1;
  return { de: mn - folga, ate: mx + folga, min: mn, max: mx, ini };
}
