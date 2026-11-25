/**
 * GRÁFICOS do DTCar Scanner.
 *
 * Como o Danilo pediu (25/11/2026): a tela abre nas OPÇÕES DE ESCOLHA; marca-se o que acompanhar,
 * toca em EXIBIR e os gráficos aparecem; VOLTAR traz de volta as opções. Até QUATRO gráficos ao
 * mesmo tempo — leituras da MESMA UNIDADE dividem um gráfico e uma escala, que é o que deixa ver as
 * quatro rodas juntas e enxergar a que diverge. Unidade diferente abre outro gráfico.
 */
import { html, useState, useEffect, useRef } from "../../js/lib.js";
import * as obd from "../../js/obd.js";
import * as grafico from "../../js/obdgrafico.js";
import { Cab, Trabalhando, Falhou, useApp, Ic } from "../comum.js";

export const GRAFICOS_MAX = 4;          // o que cabe na tela do tablet (no celular são 3)
const CORES = ["#174f94", "#a35a06", "#1f7a3a", "#8c1d1d"];
const numBR = n => String(n).replace(".", ",");
/** Mesma regra do js/obdgrafico.js: sem unidade, cada leitura é o seu gráfico. */
const grupoDe = p => (p.unidade ? "u:" + p.unidade : "k:" + p.pid);
const valorEscrito = l => (typeof l.valor === "number" ? numBR(l.valor.toFixed(l.casas || 0)) : "—");

/** Um gráfico: a linha do último minuto, com o valor escrito na legenda (o olho não viaja até o eixo). */
function Linha({ titulo, leituras, historia }) {
  const agora = Date.now();
  const e = grafico.escalaDe(leituras, historia, agora);
  const L = 560, A = 150, pad = 5;
  const x = t => pad + (1 - (agora - t) / grafico.JANELA_MS) * (L - 2 * pad);
  const y = v => A - pad - ((v - e.de) / (e.ate - e.de || 1)) * (A - 2 * pad);
  return html`<div class="gra">
    <h3>${titulo}</h3>
    <svg viewBox=${"0 0 " + L + " " + A} preserveAspectRatio="none" role="img"
      aria-label=${"Gráfico de " + leituras.map(l => obd.nomeDaLeitura(l)).join(", ")}>
      <line x1="0" y1=${A - pad} x2=${L} y2=${A - pad} stroke="#d3d7dc" stroke-width="1" />
      ${leituras.map((l, i) => {
        const pts = (historia[l.chave] || []).filter(p => p.t >= agora - grafico.JANELA_MS);
        if (pts.length < 2) return null;
        const d = pts.map((p, k) => (k ? "L" : "M") + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
        return html`<path key=${l.chave} d=${d} fill="none" stroke=${CORES[i % CORES.length]} stroke-width="2.2"
          stroke-linecap="round" stroke-linejoin="round" />`;
      })}
    </svg>
    <div class="leg">${leituras.map((l, i) => html`<b key=${l.chave}>
      <s style=${"background:" + CORES[i % CORES.length]}></s>${obd.nomeDaLeitura(l)}:
      ${valorEscrito(l)}${l.unidade ? " " + l.unidade : ""}</b>`)}</div>
  </div>`;
}

export function Graficos() {
  const { st } = useApp();
  const [exibindo, setExibindo] = useState(false);
  const [pids, setPids] = useState([]);                  // os PIDs marcados, na ordem da escolha
  const [recusa, setRecusa] = useState("");
  const [valores, setValores] = useState({});
  const [erro, setErro] = useState("");
  const rodada = useRef(0);
  const historia = useRef({});
  const pidsAgora = useRef([]);
  const pend = useRef({});
  const ultimo = useRef(0);
  const relogio = useRef(null);

  useEffect(() => { pidsAgora.current = pids; }, [pids]);
  useEffect(() => () => { rodada.current = 0; if (relogio.current) clearTimeout(relogio.current); }, []);

  // as leituras que ESTE carro publica e que mudam com o motor (gráfico de valor fixo não diz nada)
  const disponiveis = obd.leiturasPara(st.pidsSuportados, null).filter(p => p.vivo);

  /** Marca ou desmarca um PID, respeitando o limite de gráficos e de linhas por gráfico. */
  const marcar = pid => {
    setRecusa("");
    if (pids.includes(pid)) return void setPids(pids.filter(p => p !== pid));
    const p = disponiveis.find(x => x.pid === pid);
    if (!p) return;
    const grupos = {};
    for (const q of pids.map(n => disponiveis.find(x => x.pid === n)).filter(Boolean)) {
      grupos[grupoDe(q)] = (grupos[grupoDe(q)] || 0) + (q.partes ? q.partes.length : 1);
    }
    const g = grupoDe(p), quantos = p.partes ? p.partes.length : 1;
    if (grupos[g] !== undefined) {
      if (grupos[g] + quantos > grafico.LINHAS_MAX) {
        return void setRecusa("Este gráfico já tem " + grafico.LINHAS_MAX + " linhas. Tire uma para pôr outra.");
      }
    } else if (Object.keys(grupos).length >= GRAFICOS_MAX) {
      return void setRecusa("Já são " + GRAFICOS_MAX + " gráficos. Leitura da mesma unidade entra junto num deles; de unidade diferente, tire um gráfico antes.");
    }
    setPids(pids.concat([pid]));
  };

  const desenhar = minha => {
    const agora = Date.now();
    if (agora - ultimo.current < 250) {
      if (!relogio.current) relogio.current = setTimeout(() => { relogio.current = null; desenhar(minha); }, 250 - (agora - ultimo.current));
      return;
    }
    ultimo.current = agora;
    if (rodada.current !== minha) return;
    const novos = pend.current; pend.current = {};
    setValores(v => ({ ...v, ...novos }));
  };

  const exibir = async () => {
    if (!pids.length) return;
    setExibindo(true); setErro(""); historia.current = {}; setValores({});
    if (!st.ligado) return;
    const minha = Date.now(); rodada.current = minha;
    try {
      await obd.lerAoVivoSeguido(
        st.pidsSuportados,
        v => {
          if (rodada.current !== minha) return;
          grafico.anotarPonto(historia.current, v);
          pend.current[v.chave] = v;
          desenhar(minha);
        },
        () => rodada.current === minha,
        { escolhidos: () => pidsAgora.current },
      );
    } catch (e) {
      if (rodada.current === minha) setErro(obd.motivoDe(e));
    } finally {
      if (rodada.current === minha) rodada.current = 0;
    }
  };
  const voltar = () => { rodada.current = 0; setExibindo(false); };

  // os gráficos: as leituras já lidas, agrupadas por unidade, na ordem em que foram escolhidas
  const lidos = Object.keys(valores).map(k => valores[k]);
  const ordem = [];
  for (const pid of pids) for (const l of lidos.filter(x => x.pid === pid)) ordem.push(l.chave);
  const graficos = grafico.graficosDe(ordem, lidos);

  return html`<div class="corpo">
    <${Cab} titulo="Gráficos">
      ${exibindo
        ? html`<button type="button" class="bt" id="sc-gra-voltar" onClick=${voltar}><${Ic} n="volta" t=${18} /> VOLTAR</button>`
        : html`<button type="button" class="bt cheio" id="sc-gra-exibir" onClick=${exibir} disabled=${!pids.length}>
            EXIBIR${pids.length ? " (" + pids.length + ")" : ""}</button>`}
    </${Cab}>
    <div class="rolo">
      ${!st.ligado ? html`<div class="ct"><div class="vazio">Conecte o adaptador no Início para acompanhar este carro.</div></div>` : null}
      ${exibindo ? html`
        ${!graficos.length && st.ligado ? html`<${Trabalhando} texto="Lendo o carro…" />` : null}
        <${Falhou} texto=${erro} />
        <div class="gras">${graficos.map(g => html`<${Linha} key=${g.grupo}
          titulo=${g.unidade ? "Em " + g.unidade : obd.nomeDaLeitura(g.leituras[0])}
          leituras=${g.leituras} historia=${historia.current} />`)}</div>
      ` : html`
        <div class="ct">
          <h2>O QUE ACOMPANHAR — até ${GRAFICOS_MAX} gráficos ao mesmo tempo</h2>
          <${Falhou} texto=${recusa} />
          <div class="lista">
            ${disponiveis.map(p => {
              const on = pids.includes(p.pid);
              return html`<div class="item" key=${p.pid}>
                <button type="button" id=${"sc-gra-p" + p.pid} aria-pressed=${on} onClick=${() => marcar(p.pid)}>
                  <span class="nome">${p.rotulo}${p.unidade ? " (" + p.unidade + ")" : ""}</span>
                  ${on ? html`<span class="selo certo">NO GRÁFICO</span>` : null}
                  <span class="seta">${on ? "✓" : "+"}</span></button>
              </div>`;
            })}
          </div>
          ${!disponiveis.length ? html`<div class="vazio">Conecte o adaptador para o app saber o que este carro publica.</div>` : null}
        </div>`}
    </div>
  </div>`;
}
