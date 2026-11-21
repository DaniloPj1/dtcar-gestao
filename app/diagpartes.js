/**
 * Pedaços das telas do carro que mais de uma tela usa: a explicação do código de falha, a
 * conferência antes de começar, o carro comparado com ele mesmo. Ficam aqui para o app/diag.js
 * não voltar a crescer sem fim.
 */
import { html, useState, useEffect } from "../js/lib.js";
import * as falhasCat from "../js/obdfalhas.js";

/** Explicações dos códigos da lista, buscadas uma vez por conjunto de códigos. */
export function usarExplicacoes(falhas, carro) {
  const codigos = (falhas || []).map(f => falhasCat.soCodigo(f.codigo)).filter(Boolean);
  const assinatura = codigos.join(",") + "|" + ((carro && carro.marca) || "") + "|" + ((carro && carro.vin) || "").slice(0, 3);
  const [exp, setExp] = useState({});
  useEffect(() => {
    let vivo = true;
    if (!codigos.length) { setExp({}); return undefined; }
    falhasCat.explicarTodos(codigos, { marca: carro && carro.marca, vin: carro && carro.vin }).then(r => { if (vivo) setExp(r); });
    return () => { vivo = false; };
  }, [assinatura]);
  return exp;
}

const QUANTAS = 6;   // causas mostradas antes do "ver todas": mais que isso empurra a próxima falha para fora da tela

/** O que o código quer dizer. `e` vem de usarExplicacoes; enquanto não chegou, não ocupa espaço. */
export function FalhaExplicada({ e }) {
  const [tudo, setTudo] = useState(false);
  const [mais, setMais] = useState(false);
  if (!e) return null;
  if (!e.achou) return html`<div class="fx"><div class="fx-origem">${e.origem}</div></div>`;
  const causas = tudo ? e.causas : e.causas.slice(0, QUANTAS);
  return html`<div class="fx">
    ${e.descricao ? html`<div class="fx-desc">${e.descricao}${!e.pt ? html` <span class="fx-en">em inglês</span>` : null}</div>` : null}
    ${e.pecas.length ? html`<div class="fx-pecas">No diagrama elétrico: <b>${e.pecas.join(", ")}</b></div>` : null}
    ${e.causas.length ? html`<div class="fx-causas">
      <div class="fx-t">Causas prováveis</div>
      <ul>${causas.map((c, i) => html`<li key=${i} class=${c.nivel ? "sub" : ""}>${c.texto}${!c.pt ? html` <span class="fx-en">em inglês</span>` : null}</li>`)}</ul>
      ${e.causas.length > QUANTAS ? html`<button type="button" class="fx-mais" onClick=${() => setTudo(!tudo)}>${tudo ? "Mostrar menos" : "Ver as " + e.causas.length + " causas"}</button>` : null}
    </div>` : null}
    ${e.secoes.length ? html`<button type="button" class="fx-mais" onClick=${() => setMais(!mais)}>${mais ? "Esconder como o módulo testa" : "Como o módulo testa"}</button>` : null}
    ${mais ? e.secoes.map(s => html`<div key=${s.chave} class="fx-sec"><div class="fx-t">${s.titulo}</div>
      ${s.linhas.map((l, i) => html`<div key=${i}>${l.texto}${!l.pt ? html` <span class="fx-en">em inglês</span>` : null}</div>`)}</div>`) : null}
    <div class="fx-origem">${e.origem}${e.origemCausas && e.origemCausas !== e.origem ? " " + e.origemCausas : ""}${e.emIngles ? " O que está em inglês ainda não teve a tradução conferida." : ""}</div>
  </div>`;
}

/* ---------------- dados ao vivo: DIGITAL e GRÁFICO (pedido do Danilo, 21/11/2026) ---------------- */
const numBR = n => String(n).replace(".", ",");

/** Leitura em número grande, sem ponteiro: para ler de longe, com o celular apoiado no carro. */
export function Digital({ l }) {
  return html`<div class="digital" data-pid=${l.pid} data-chave=${l.chave}>
    <div class="digital-rot">${l.rotulo}</div>
    <div class="digital-num"><b>${numBR(l.valor)}</b>${l.unidade ? html`<span>${l.unidade}</span>` : null}</div>
  </div>`;
}

export const GRAFICO_MAX = 3;          // leituras ao mesmo tempo: mais que isso a roda de leitura fica lenta e o traço não se lê
export const GRAFICO_PONTOS = 120;     // pontos guardados por leitura
const JANELA_MS = 60000;               // o gráfico mostra o último minuto

/** Guarda mais um ponto da leitura na história (objeto { chave: [{ t, v }] }), sem deixar crescer. */
export function anotarPonto(historia, l, agora = Date.now()) {
  if (!l || typeof l.valor !== "number" || !isFinite(l.valor)) return;
  const h = historia[l.chave] || (historia[l.chave] = []);
  h.push({ t: agora, v: l.valor });
  if (h.length > GRAFICO_PONTOS) h.splice(0, h.length - GRAFICO_PONTOS);
}

/** Tira ou põe uma leitura na escolha do gráfico, respeitando o limite. Devolve { lista, cheio }. */
export function trocarNoGrafico(lista, chave) {
  const l = (lista || []).slice();
  const i = l.indexOf(chave);
  if (i >= 0) { l.splice(i, 1); return { lista: l, cheio: false }; }
  if (l.length >= GRAFICO_MAX) return { lista: l, cheio: true };
  l.push(chave);
  return { lista: l, cheio: false };
}

const G_L = 300, G_A = 64;   // desenho de cada faixa, em unidades do viewBox
/** Uma faixa do gráfico: uma leitura, com a escala DELA (cada leitura tem unidade diferente). */
function Faixa({ l, pontos, agora }) {
  const ini = agora - JANELA_MS;
  const ps = (pontos || []).filter(p => p.t >= ini);
  let mn = Infinity, mx = -Infinity;
  for (const p of ps) { if (p.v < mn) mn = p.v; if (p.v > mx) mx = p.v; }
  if (!ps.length) { mn = 0; mx = 1; }
  const folga = mx === mn ? Math.max(1, Math.abs(mx) * 0.05) : (mx - mn) * 0.1;
  const de = mn - folga, ate = mx + folga;
  const x = t => ((t - ini) / JANELA_MS) * G_L;
  const y = v => G_A - ((v - de) / (ate - de)) * G_A;
  const d = ps.map((p, i) => (i ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  const ult = ps[ps.length - 1];
  return html`<div class="graf-faixa" data-chave=${l.chave}>
    <div class="graf-topo"><span class="graf-rot">${l.rotulo}</span>
      <b class="graf-num">${numBR(l.valor)}${l.unidade ? html`<span>${l.unidade}</span>` : null}</b></div>
    <div class="graf-corpo">
      <div class="graf-esc"><span>${ps.length ? numBR(Math.round(mx * 10) / 10) : ""}</span><span>${ps.length ? numBR(Math.round(mn * 10) / 10) : ""}</span></div>
      <svg viewBox=${"0 0 " + G_L + " " + G_A} preserveAspectRatio="none" role="img" aria-label=${"Gráfico de " + l.rotulo + ", último minuto"}>
        <line x1="0" y1=${G_A / 2} x2=${G_L} y2=${G_A / 2} class="graf-meio" />
        ${ps.length > 1 ? html`<path d=${d} class="graf-linha" />` : null}
        ${ult ? html`<circle cx=${x(ult.t).toFixed(1)} cy=${y(ult.v).toFixed(1)} r="2.6" class="graf-ponto" />` : null}
      </svg>
    </div>
  </div>`;
}

/**
 * O gráfico dos dados ao vivo: o mecânico escolhe até 3 leituras e cada uma ganha a sua faixa,
 * uma embaixo da outra, no mesmo tempo. Faixas separadas (e não três linhas no mesmo quadro)
 * porque rotação, temperatura e tensão não cabem na mesma escala — e linha distinguida só por
 * cor não serve para quem lê com a tela no sol.
 */
export function Grafico({ lidos, historia, escolha, aoTrocar, cheio }) {
  const numericas = lidos.filter(l => typeof l.valor === "number");
  const escolhidas = escolha.map(k => numericas.find(l => l.chave === k)).filter(Boolean);
  const agora = Date.now();
  return html`<div class="graf" id="obd-grafico">
    <div class="graf-escolha" role="group" aria-label="Leituras no gráfico (até 3)">
      ${numericas.map(l => html`<button key=${l.chave} type="button" data-chave=${l.chave} class=${escolha.includes(l.chave) ? "esc" : ""}
        aria-pressed=${escolha.includes(l.chave)} onClick=${() => aoTrocar(l.chave)}>${l.rotulo}</button>`)}
    </div>
    <div class=${"nota" + (cheio ? " graf-cheio" : "")} id="obd-grafico-aviso">${cheio ? "Já tem 3 no gráfico. Toque em uma das escolhidas para tirar e pôr outra."
      : escolhidas.length ? escolhidas.length + " de " + GRAFICO_MAX + " leituras · último minuto · cada faixa na sua escala" : "Escolha até 3 leituras para ver no gráfico."}</div>
    ${escolhidas.map(l => html`<${Faixa} key=${l.chave} l=${l} pontos=${historia[l.chave]} agora=${agora} />`)}
  </div>`;
}
