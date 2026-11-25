/**
 * Os pedaços que todas as telas do DTCar Scanner usam: o contexto do carro, o sinal de conectado,
 * a placa, o cabeçalho e os dois únicos avisos que o Danilo deixou no app (trabalhando e
 * EM DESENVOLVIMENTO). Fica num arquivo só para as telas não precisarem importar o scanner.js,
 * que é quem importa as telas.
 */
import { html, createContext, useContext } from "../js/lib.js";
import { Ic } from "./icones.js";

/* ------------------------------------------------------------------ as telas e o caminho */

/** As cinco funções do Scanner, na ordem dos cards do Início e da barra lateral. */
export const TELAS = [
  { r: "aovivo", nome: "Ao vivo", ic: "vivo", titulo: "Dados ao vivo", sub: "com o motor trabalhando" },
  { r: "graficos", nome: "Gráficos", ic: "grafico", titulo: "Gráficos", sub: "até 4 ao mesmo tempo" },
  { r: "falhas", nome: "Falhas", ic: "falha", titulo: "Falhas do carro", sub: "ler e apagar" },
  { r: "rede", nome: "Rede CAN", ic: "rede", titulo: "Mapa da rede CAN", sub: "quem responde e quem não" },
  { r: "prog", nome: "Programações", ic: "prog", titulo: "Programações avançadas", sub: "", grava: true },
];
export const ROTAS = TELAS.map(t => t.r).concat(["inicio", "placa"]);
export const ir = r => { location.hash = "#/" + r; };
export const rotaDe = () => {
  const m = /^#\/([a-z]+)/.exec(location.hash || "");
  const r = m ? m[1] : "inicio";
  return ROTAS.includes(r) ? r : "inicio";
};

/* ------------------------------------------------------------------ o cofre do aparelho */

const cofre = () => { try { return window.localStorage; } catch (e) { return null; } };
export const lerCofre = (k, padrao) => { try { const v = cofre() && cofre().getItem(k); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; } };
export const gravarCofre = (k, v) => { try { if (cofre()) cofre().setItem(k, JSON.stringify(v)); } catch (e) { /* segue */ } };

/* ------------------------------------------------------------------ contexto do carro */

export const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

/* ------------------------------------------------------------------ pedaços de tela */

/** O sinal de conectado: verde quando o adaptador está no carro. Vai no topo de TODA tela. */
export function Sinal({ st }) {
  const on = st && st.ligado;
  return html`<span class=${"sinal " + (on ? "on" : "off")} id="sc-sinal">
    <i></i>${on ? "CONECTADO" : st && st.ligando ? "CONECTANDO…" : "SEM ADAPTADOR"}</span>`;
}

/** A placa Mercosul: é assim que a oficina chama o carro. */
export const PlacaId = ({ placa }) => html`<span class="placa-id"><em>BRASIL</em><b>${placa || "—"}</b></span>`;

/** Cabeçalho de uma tela de leitura: título, sinal, o carro e os botões da própria tela. */
export function Cab({ titulo, children }) {
  const { st, placa, carro } = useApp();
  return html`<header class="cab">
    <h1>${titulo}</h1>
    <${Sinal} st=${st} />
    <span class="onde">${placa}${carro && carro.modelo ? " · " + carro.modelo : ""}</span>
    <div class="dir">${children}</div>
  </header>`;
}

/** Trabalho em curso. Um dos dois únicos avisos do app. */
export const Trabalhando = ({ texto }) => html`<div class="trabalhando" role="status"><i></i>${texto}</div>`;
/** Falhou de verdade: o que o adaptador ou o módulo respondeu. Não é aviso de rotina. */
export const Falhou = ({ texto }) => (texto ? html`<div class="falhou" role="alert">${texto}</div>` : null);
/** Função que ainda não fala com o carro. O outro aviso que o Danilo mandou manter. */
export const EmObra = ({ o }) => html`<div class="ct"><h2>${o} <span class="selo obra">EM DESENVOLVIMENTO</span></h2>
  <div class="vazio">Esta parte ainda não fala com o carro. Use o scanner da bancada para ela.</div></div>`;

/** Uma linha de lista que abre no toque (é assim que o Danilo quer as programações). */
export function Item({ nome, dir, aberto, abrir, children }) {
  return html`<div class=${"item" + (aberto ? " aberto" : "")}>
    <button type="button" aria-expanded=${aberto} onClick=${abrir}>
      <span class="nome">${nome}</span>${dir}<span class="seta">${aberto ? "⌄" : "›"}</span></button>
    ${aberto ? html`<div class="dentro">${children}</div>` : null}
  </div>`;
}

export { Ic };
