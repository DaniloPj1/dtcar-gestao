/**
 * Pedaços das telas do carro que mais de uma tela usa: a explicação do código de falha, a
 * conferência antes de começar, o carro comparado com ele mesmo. Ficam aqui para o app/diag.js
 * não voltar a crescer sem fim.
 */
import { html, useState, useEffect } from "../js/lib.js";
import * as falhasCat from "../js/obdfalhas.js";
import * as grafico from "../js/obdgrafico.js";
import { api } from "../js/api.js";
import * as obd from "../js/obd.js";
import * as sessao from "../js/obdsessao.js";
import * as registro from "../js/obdregistro.js";
import * as mapa from "../js/obdmapa.js";

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
    <div class="fx-origem">Fonte: ${e.fonte}.</div>
  </div>`;
}

/* ---------------- dados ao vivo: DIGITAL e GRÁFICO (pedido do Danilo, 21/11/2026) ---------------- */
const numBR = n => String(n).replace(".", ",");

/**
 * A faixa de trabalho em UMA linha curta, só os dois números (js/obdfaixa.js). Usada onde não há
 * barra nem ponteiro para mostrar os limites (digital e gráfico). Sem "dentro/acima/abaixo" escrito:
 * pedido do Danilo (21/11/2026) — a cor e os números já dizem. A origem da faixa fica no toque longo.
 */
export function FaixaTxt({ f }) {
  if (!f) return null;
  return html`<div class=${"faixa-txt" + (f.aplica ? "" : " faixa-nao-julga")} data-situacao=${f.aplica ? f.situacao : null} title=${f.fonte}>${f.texto}</div>`;
}

/** Leitura em número grande, sem ponteiro: para ler de longe, com o celular apoiado no carro. */
export function Digital({ l, f }) {
  return html`<div class="digital" data-pid=${l.pid} data-chave=${l.chave}>
    <div class="digital-rot">${l.rotulo}</div>
    <div class=${"digital-num" + (f && f.aplica && f.situacao === "acima" ? " acima" : "")}><b>${numBR(l.valor)}</b>${l.unidade ? html`<span>${l.unidade}</span>` : null}</div>
    <${FaixaTxt} f=${f} />
  </div>`;
}

// Cada linha do mesmo gráfico tem um TRAÇO diferente além da cor: com a tela no sol, ou para quem
// não distingue cor, o traço é o que separa a roda dianteira esquerda da direita.
const TRACOS = ["", "7 4", "2 3", "10 3 2 3"];
const CORES = ["var(--azul)", "var(--tinta)", "#6b747e", "var(--azul)"];
const G_L = 300, G_A = 80;   // desenho do gráfico, em unidades do viewBox

/** Um gráfico: uma ou mais leituras da MESMA unidade, na mesma escala. */
function UmGrafico({ g, historia, agora, faixaDe }) {
  const e = grafico.escalaDe(g.leituras, historia, agora);
  const x = t => ((t - e.ini) / grafico.JANELA_MS) * G_L;
  const y = v => G_A - ((v - e.de) / (e.ate - e.de)) * G_A;
  return html`<div class="graf-faixa" data-grupo=${g.grupo}>
    <div class="graf-legenda">${g.leituras.map((l, i) => html`<div key=${l.chave} class="graf-leg" data-chave=${l.chave}>
      <svg class="graf-amostra" viewBox="0 0 26 8" aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke=${CORES[i]} stroke-width="2.4" stroke-dasharray=${TRACOS[i]} /></svg>
      <span class="graf-rot">${l.rotulo}</span>
      <b class="graf-num">${numBR(l.valor)}${l.unidade ? html`<span>${l.unidade}</span>` : null}</b>
      <${FaixaTxt} f=${faixaDe ? faixaDe(l) : null} /></div>`)}</div>
    <div class="graf-corpo">
      <div class="graf-esc"><span>${e.max == null ? "" : numBR(Math.round(e.max * 10) / 10)}</span><span>${e.min == null ? "" : numBR(Math.round(e.min * 10) / 10)}</span></div>
      <svg viewBox=${"0 0 " + G_L + " " + G_A} preserveAspectRatio="none" role="img" aria-label=${"Gráfico do último minuto: " + g.leituras.map(l => l.rotulo).join(", ")}>
        <line x1="0" y1=${G_A / 2} x2=${G_L} y2=${G_A / 2} class="graf-meio" />
        ${g.leituras.map((l, i) => {
          const ps = (historia[l.chave] || []).filter(p => p.t >= e.ini);
          if (ps.length < 2) return null;
          const d = ps.map((p, k) => (k ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
          return html`<path key=${l.chave} d=${d} class="graf-linha" stroke=${CORES[i]} stroke-dasharray=${TRACOS[i]} />`;
        })}
      </svg>
    </div>
  </div>`;
}

/**
 * O gráfico dos dados ao vivo. O mecânico toca nas leituras; as da mesma unidade vão para o mesmo
 * gráfico (as 4 rodas do ABS juntas, na mesma escala), as de unidade diferente abrem outro, até 3.
 */
export function Grafico({ lidos, historia, escolha, aoTrocar, recusa, faixaDe = null }) {
  const numericas = lidos.filter(l => typeof l.valor === "number");
  // Com leitura escolhida, a lista some: na tela ficam só os gráficos (pedido do Danilo, 21/11/2026).
  const [aberto, setAberto] = useState(false);
  const gs = grafico.graficosDe(escolha, numericas);
  const agora = Date.now();
  return html`<div class="graf" id="obd-grafico">
    <div class="graf-escolha" role="group" aria-label="Leituras no gráfico">
      ${(aberto || !escolha.length ? numericas : []).map(l => html`<button key=${l.chave} type="button" data-chave=${l.chave} class=${escolha.includes(l.chave) ? "esc" : ""}
        aria-pressed=${escolha.includes(l.chave)} onClick=${() => aoTrocar(l.chave)}>${l.rotulo}</button>`)}
      ${escolha.length ? html`<button type="button" class="graf-abrir" id="graf-abrir" aria-expanded=${aberto} onClick=${() => setAberto(!aberto)}>${aberto ? "Fechar a lista" : "Escolher leituras (" + escolha.length + ")"}</button>` : null}
    </div>
    <div class=${"nota" + (recusa ? " graf-cheio" : "")} id="obd-grafico-aviso">${recusa || (gs.length
      ? "Último minuto. " + gs.length + " de " + grafico.GRAFICOS_MAX + " gráficos; leituras da mesma unidade ficam juntas."
      : "Toque nas leituras para ver no gráfico: até 3 gráficos; as da mesma unidade (as 4 rodas, por exemplo) ficam juntas no mesmo.")}</div>
    ${gs.map(g => html`<${UmGrafico} key=${g.grupo} g=${g} historia=${historia} agora=${agora} faixaDe=${faixaDe} />`)}
  </div>`;
}

/* ---------------- o que é gravado SOZINHO: registro das ações e o caderno do carro ---------------- */

const cofre = () => registro.cofreDe(window.localStorage);
const FRASE = { ok: "Registrado no banco.", pendente: "Registro guardado no aparelho: sobe sozinho quando o banco aceitar (sem internet, ou falta rodar o supabase/v63.sql).", nada: "NÃO deu para registrar: anote na O.S." };

/**
 * Registra uma ação feita no carro (atuador, aprendizado, apagamento por módulo, bico…).
 * Devolve a frase que a tela mostra. Nunca rejeita: o que não gravou fica guardado no aparelho.
 */
// `carro`: o carro EM QUE a coisa aconteceu, quando quem chama já o tinha na mão antes de esperar
// alguma resposta. Sem ele vale o carro da sessão no momento de gravar.
export async function registrarAcao(tipo, perfil, dados, extra, carro = null) {
  const g = await registro.guardar(api.obd.registrar, cofre(), registro.linha(tipo, perfil, carro || sessao.carro(), dados, extra));
  return g.gravado ? FRASE.ok : g.pendente ? FRASE.pendente : FRASE.nada;
}
/** Sobe o que ficou guardado no aparelho. Chamado quando uma tela do diagnóstico abre. */
// UM envio por vez: várias telas chamam isto ao abrir, e dois envios lendo a mesma fila ao mesmo tempo
// gravariam o mesmo registro duas vezes (achado do Codex, 21/11/2026). Quem chega com um envio em
// curso recebe a mesma promessa.
let enviando = null;
export function subirPendentes() {
  if (!enviando) enviando = registro.subirPendentes(api.obd.registrar, cofre()).catch(() => ({ subiram: 0, restam: 0 })).finally(() => { enviando = null; });
  return enviando;
}

// O CADERNO DO CARRO (Etapa 4): liga uma vez e fica ouvindo a conversa com o adaptador. Não tem
// botão e não gera pedido: anota o que já aconteceu, e despeja no banco quando o adaptador é
// desligado ou o carro muda. Ninguém decide salvar.
let caderno = null, quem = null, ultimoLigado = false, ultimoCarro = null;
export function ligarCaderno(perfil) {
  quem = perfil;
  if (caderno) return;
  caderno = mapa.novoCaderno();
  obd.aoTrocar((cmd, cru, ms) => { if (caderno) mapa.anotarTroca(caderno, cmd, cru, ms); });
  sessao.observar(st => {
    const trocouCarro = ultimoCarro && st.carro && (st.carro.placa || "") !== (ultimoCarro.placa || "");
    if ((ultimoLigado && !st.ligado) || (trocouCarro && st.ligado)) despejarCaderno();
    ultimoLigado = st.ligado;
    if (st.carro) ultimoCarro = st.carro;
  });
}
export const cadernoAtual = () => caderno;
export function despejarCaderno() {
  const r = caderno && mapa.retrato(caderno, ultimoCarro);
  caderno = mapa.novoCaderno();
  if (!r || !quem) return;
  registro.guardar(api.obd.registrar, cofre(), registro.linha("mapa", quem, ultimoCarro, r)).catch(() => {});
}

/** O aviso das fontes, uma vez por cartão de falhas. */
