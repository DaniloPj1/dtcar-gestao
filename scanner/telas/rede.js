/**
 * MAPA DA REDE CAN do DTCar Scanner — a tela que o Danilo reorganizou em 25/11/2026:
 * quadros grandes, informação grande num quadro só, informação curta em dois quadros.
 *
 * A varredura é a mesma do app do celular (js/obdvarredura.js) e o cruzamento com os códigos de
 * rede mora em js/obdrede.js, conferido sem navegador.
 */
import { html, useState, useEffect, useRef } from "../../js/lib.js";
import * as obd from "../../js/obd.js";
import * as uds from "../../js/uds.js";
import * as sessao from "../../js/obdsessao.js";
import * as modelo from "../../js/obdmodelo.js";
import * as varredura from "../../js/obdvarredura.js";
import * as rede from "../../js/obdrede.js";
import { Cab, Trabalhando, Falhou, useApp, Ic } from "../comum.js";

/** Onde procurar: os módulos do mapa deste modelo e os endereços que a norma reserva. */
export function alvosDe(modulos) {
  const out = [];
  for (const m of modulos || []) out.push({ pedido: m.pedido, resposta: m.resposta, nome: m.nome, doMapa: true });
  for (const e of uds.ENDERECOS_PADRAO) {
    if (!out.some(x => x.pedido === e.pedido)) out.push({ pedido: e.pedido, resposta: e.resposta, nome: e.nome || "Endereço " + e.pedido, doMapa: false });
  }
  return out;
}

const SIT = {
  respondeu: ["RESPONDEU", "certo"],
  recusou: ["RECUSOU", "atencao"],
  mudo: ["MUDO", "mudo"],
  fora: ["FORA DA REDE", "ruim"],
};

/** Uma linha de módulo: endereço, nome, o que aconteceu por escrito e as falhas que ele tem. */
function Modulo({ m, fora }) {
  const sit = m.recusou ? "recusou" : m.respondeu ? "respondeu" : fora ? "fora" : "mudo";
  const [rotulo, cor] = SIT[sit];
  const quantas = (m.falhas || []).length;
  return html`<div class=${"mod" + (sit === "fora" ? " fora" : "")} data-modulo=${m.pedido}>
    <span class="end" style=${"color:var(--" + (cor === "mudo" ? "meio" : cor) + ")"}>${m.pedido}</span>
    <span class="nome">${m.nome || "Sem nome no catálogo"}
      ${m.erro ? html`<small>${m.erro}</small>` : quantas ? html`<small>${quantas} falha(s) gravada(s)</small>` : null}</span>
    <span class=${"selo " + cor}>${rotulo}</span>
    <span class="ms">${m.respondeu && !m.recusou ? (quantas ? quantas + " falha(s)" : "sem falha") : ""}</span>
  </div>`;
}

export function Rede() {
  const { st, carro } = useApp();
  const [andando, setAndando] = useState("");
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [mapa, setMapa] = useState(null);
  const parar = useRef(false);
  useEffect(() => () => { parar.current = true; }, []);

  // o mapa de módulos deste modelo, quando existe
  const c = carro || {};
  useEffect(() => {
    let vivo = true;
    setMapa(null);
    const entrada = modelo.acharModelo(c.marca, c.modelo);
    if (!entrada) return;
    modelo.carregar(entrada).then(d => { if (vivo) setMapa({ entrada, modulos: modelo.modulosDoModelo(d, c.marca, c.ano) }); }).catch(() => {});
    return () => { vivo = false; };
  }, [c.marca, c.modelo, c.ano]);

  const varrer = async () => {
    setErro(""); setLista(null); parar.current = false;
    const alvos = alvosDe(mapa && mapa.modulos);
    const r = await sessao.tomar("a varredura da rede", async () => {
      const l = await varredura.varrer(alvos,
        { abrir: uds.abrir, sessao: uds.sessao, lerFalhas: uds.lerFalhas, comum: uds.SESSAO.comum, estendida: uds.SESSAO.estendida },
        { aoAndar: (m, i, n) => setAndando("Perguntando ao " + (m.nome || m.pedido) + " (" + i + " de " + n + ")…"),
          continuar: () => !parar.current, pronta: uds.falhaPronta });
      await uds.fechar();
      return l;
    }, { pausaFundo: true });
    setAndando("");
    if (!r.ok) { setErro(r.texto || "Não deu para varrer a rede."); return; }
    setLista(r.r);
  };

  const cruz = lista ? rede.cruzar(lista) : null;
  const responderam = cruz ? cruz.responderam.concat(cruz.recusaram) : [];
  const mudos = cruz ? cruz.mudos : [];
  const foraDaRede = cruz && cruz.vereditos[0].chave === "confirmado" ? cruz.mudosDoMapa.map(m => m.pedido) : [];
  const metade = Math.ceil((responderam.length + mudos.length) / 2);
  const todos = responderam.concat(mudos);

  return html`<div class="corpo">
    <${Cab} titulo=${"Mapa da rede CAN" + (cruz ? " · " + cruz.responderam.length + " responderam" : "")}>
      ${andando
        ? html`<button type="button" class="bt perigo" onClick=${() => { parar.current = true; }}>PARAR</button>`
        : html`<button type="button" class="bt cheio" id="sc-varrer" onClick=${varrer} disabled=${!st.ligado || !!st.dono}>
            <${Ic} n="rede" t=${19} /> ${lista ? "VARRER DE NOVO" : "VARRER A REDE"}</button>`}
    </${Cab}>
    <div class="rolo">
      ${!st.ligado ? html`<div class="ct"><div class="vazio">Conecte o adaptador no Início para varrer este carro.</div></div>` : null}
      ${andando ? html`<${Trabalhando} texto=${andando} />` : null}
      <${Falhou} texto=${erro} />

      ${cruz ? html`<div class="ct" id="sc-veredito" style=${"border-left:5px solid var(--" + (cruz.vereditos[0].situacao === "mudo" ? "meio" : cruz.vereditos[0].situacao) + ")"}>
        <h2>O QUE DÁ PARA AFIRMAR</h2>
        ${cruz.vereditos.map(v => html`<div class="vd" key=${v.chave}>
          <div class="g" style=${"color:var(--" + (v.situacao === "mudo" ? "meio" : v.situacao) + ")"}>${v.titulo}<span>${v.nota}</span></div>
          <div class="t">${v.texto}</div>
        </div>`)}
      </div>` : null}

      ${todos.length ? html`<div class="ct" id="sc-modulos">
        <h2>OS MÓDULOS DA REDE — ${cruz.responderam.length} responderam, ${cruz.recusaram.length} recusaram, ${mudos.length} mudos</h2>
        <div class="par">
          <div>${todos.slice(0, metade).map(m => html`<${Modulo} key=${m.pedido} m=${m} fora=${foraDaRede.includes(m.pedido)} />`)}</div>
          <div>${todos.slice(metade).map(m => html`<${Modulo} key=${m.pedido} m=${m} fora=${foraDaRede.includes(m.pedido)} />`)}</div>
        </div>
      </div>` : null}

      ${cruz ? html`<div class="par">
        <div class="ct"><h2>O BARRAMENTO</h2>
          <div class="kv"><span>Protocolo</span><b>${st.protocolo || "—"}</b></div>
          <div class="kv"><span>Adaptador</span><b>${st.versao || "—"}</b></div>
          <div class="kv"><span>Endereços perguntados</span><b>${lista.length}</b></div>
          <div class="kv"><span>Mapa deste modelo</span><b>${mapa && mapa.modulos.length ? mapa.entrada.marca + " " + mapa.entrada.modelo + " · " + mapa.modulos.length + " módulos" : "não há mapa aberto"}</b></div>
        </div>
        <div class="ct"><h2>O QUE O CARRO DIZ — códigos de rede (U)</h2>
          ${cruz.codigos.length ? cruz.codigos.map(x => html`<div class="mod" key=${x.codigo + x.pedido}>
            <span class="end" style=${"color:var(--" + (x.atual ? "ruim" : "atencao") + ");min-width:62px"}>${x.codigo}</span>
            <span class="nome">${x.rotulo !== x.codigo ? x.rotulo : "Perdeu comunicação com um módulo"}
              <small>gravado no ${x.modulo}</small></span>
            <span class=${"selo " + (x.atual ? "ruim" : "atencao")}>${x.atual ? "ATUAL" : "HISTÓRICA"}</span>
          </div>`) : html`<div class="vazio">Nenhum módulo gravou código de rede.</div>`}
        </div>
      </div>` : null}
    </div>
  </div>`;
}
