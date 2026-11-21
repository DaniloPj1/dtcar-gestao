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
