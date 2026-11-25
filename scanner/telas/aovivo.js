/**
 * DADOS AO VIVO do DTCar Scanner.
 *
 * Decisões do Danilo (25/11/2026):
 *  - o COMBUSTÍVEL entra nas leituras padrão: não é mais um botão à parte, e a análise do ajuste
 *    aparece embaixo dos mostradores;
 *  - a FALHA POR CILINDRO fica ao vivo, relida pela própria roda, sem parar os mostradores;
 *  - sem avisos: o que não funciona é que ganha um selo EM DESENVOLVIMENTO.
 */
import { html, useState, useEffect, useRef } from "../../js/lib.js";
import * as obd from "../../js/obd.js";
import * as sessao from "../../js/obdsessao.js";
import * as param from "../../js/obdparam.js";
import * as faixas from "../../js/obdfaixa.js";
import { Cab, Trabalhando, Falhou, useApp, ir } from "../comum.js";
import { Ic } from "../icones.js";

const numBR = n => String(n).replace(".", ",");
/** O valor como o motor já o arredondou (js/obd.js arredonda pelas casas de cada PID): só troca
 *  o ponto pela vírgula. Formatar de novo aqui jogava fora a casa decimal — lambda 0,97 virava 1. */
const mostrar = l => (typeof l.valor === "number" ? numBR(String(l.valor)) : "—");

/** Um mostrador. O rótulo vai SEMPRE escrito: quem lê está embaixo do carro, com pressa. */
function Vivo({ l, ctx }) {
  const f = faixas.faixaPara(l, ctx);
  const fora = f && f.aplica && f.situacao !== "dentro";
  let largura = 0, zonaDe = 0, zonaAte = 0;
  if (typeof l.valor === "number" && typeof l.de === "number" && typeof l.ate === "number" && l.ate > l.de) {
    const frac = v => Math.max(0, Math.min(1, (v - l.de) / (l.ate - l.de)));
    largura = frac(l.valor) * 100;
    if (f) { zonaDe = frac(f.de) * 100; zonaAte = frac(f.ate) * 100; }
  }
  return html`<div class=${"vv" + (fora ? " fora" : "")}>
    <div class="rot">${obd.nomeDaLeitura(l)}</div>
    <div class="num">${mostrar(l)}${l.unidade ? html`<i>${l.unidade}</i>` : null}</div>
    <div class="barra">
      ${f && f.aplica && zonaAte > zonaDe ? html`<u style=${"left:" + zonaDe + "%;width:" + (zonaAte - zonaDe) + "%"}></u>` : null}
      <i style=${"left:0;width:" + largura + "%"}></i>
    </div>
    ${f ? html`<div class="faixa">${f.aplica ? "Normal: " + f.texto : "Normal " + f.texto + " — não se aplica agora"}</div>` : null}
    ${fora ? html`<span class=${"selo sel " + (f.situacao === "acima" ? "ruim" : "atencao")}>${f.situacao === "acima" ? "ACIMA DA FAIXA" : "ABAIXO DA FAIXA"}</span>` : null}
  </div>`;
}

/** A análise do ajuste de combustível, embaixo dos mostradores (o quadro que era de um botão só). */
function Combustivel({ c }) {
  if (!c) return null;
  const selo = { normal: ["DENTRO DO ESPERADO", "certo"], atencao: ["CORRIGINDO MUITO", "atencao"],
    grave: ["CORREÇÃO NO LIMITE", "ruim"], sem_dados: ["SEM DADO DO MÓDULO", "mudo"] }[c.situacao];
  return html`<div class="ct">
    <h2>COMBUSTÍVEL — o quanto o módulo está corrigindo <span class=${"selo " + selo[1]}>${selo[0]}</span></h2>
    ${c.bancos.map(b => html`<div class="kv" key=${b.nome}><span>${b.nome}</span>
      <b>${numBR(b.total.toFixed(1))} % no total · curto ${numBR(b.curto.toFixed(1))} % · longo ${numBR(b.longo.toFixed(1))} %</b></div>`)}
    ${c.etanol !== null ? html`<div class="kv"><span>Etanol no tanque</span><b>${numBR(c.etanol.toFixed(0))} %</b></div>` : null}
    ${c.frases.map(f => html`<p key=${f} style="margin:9px 0 0;font-size:14px;line-height:1.45">${f}</p>`)}
    ${c.causas.length ? html`<h3>ONDE SE PROCURA</h3>
      <div class="dtc"><div class="causas">${c.causas.map(x => html`<div key=${x}>${x}</div>`)}</div></div>` : null}
  </div>`;
}

/** A contagem de falha de combustão por cilindro, ao vivo. */
function Cilindros({ c }) {
  if (!c) return null;
  if (!c.cilindros) {
    return html`<div class="ct"><h2>FALHA POR CILINDRO</h2>
      <div class="vazio">Este módulo não publica a contagem por cilindro.</div></div>`;
  }
  const d = c.cilindros;
  const selo = d.situacao === "limpo" ? ["NENHUMA", "certo"]
    : d.situacao === "um_cilindro" ? ["CILINDRO " + d.destacado.cilindro, "ruim"] : ["ESPALHADA", "atencao"];
  const conta = x => (typeof x.ciclo === "number" ? x.ciclo : x.media);
  const maior = Math.max.apply(null, d.cilindros.map(conta).concat([1]));
  return html`<div class="ct">
    <h2>FALHA POR CILINDRO <span class=${"selo " + selo[1]}>${selo[0]}</span>
      <span style="font-weight:400;color:var(--meio)"> · ${d.total} no total, desde o último apagamento</span></h2>
    ${d.cilindros.map(x => html`<div class="kv" key=${x.cilindro} data-cilindro=${x.cilindro}>
      <span>Cilindro ${x.cilindro}${d.destacado && d.destacado.cilindro === x.cilindro ? " — é nele que se procura" : ""}</span>
      <b style="display:flex;align-items:center;gap:9px;min-width:190px;justify-content:flex-end">
        <span class="barra" style="flex-grow:1;max-width:120px;height:9px;border-radius:5px;background:#e4e8ec;position:relative;overflow:hidden">
          <i style=${"position:absolute;top:0;bottom:0;left:0;width:" + (conta(x) / maior * 100) + "%;background:" +
            (d.destacado && d.destacado.cilindro === x.cilindro ? "var(--ruim)" : "var(--azul)")}></i></span>
        ${conta(x)}</b></div>`)}
    ${d.frases.map(f => html`<p key=${f} style="margin:9px 0 0;font-size:14px;line-height:1.45">${f}</p>`)}
  </div>`;
}

export function AoVivo() {
  const { st } = useApp();
  const [valores, setValores] = useState({});
  const [cil, setCil] = useState(null);
  const [rodando, setRodando] = useState(false);
  const [erro, setErro] = useState("");
  const rodada = useRef(0);
  const pend = useRef({});
  const ultimo = useRef(0);
  const desenho = useRef(null);

  const parar = () => { rodada.current = 0; setRodando(false); };
  useEffect(() => () => { rodada.current = 0; }, []);          // sair da tela para a roda

  const desenhar = minha => {
    const agora = Date.now();
    if (agora - ultimo.current < 250) {
      if (!desenho.current) desenho.current = setTimeout(() => { desenho.current = null; desenhar(minha); }, 250 - (agora - ultimo.current));
      return;
    }
    ultimo.current = agora;
    if (rodada.current !== minha) return;
    const novos = pend.current; pend.current = {};
    setValores(v => ({ ...v, ...novos }));
  };

  const comecar = async () => {
    if (!st.ligado || rodando) return;
    const minha = Date.now(); rodada.current = minha;
    setErro(""); setValores({}); setCil(null); setRodando(true);
    // O COMBUSTÍVEL JUNTO: as padrão deste carro mais os PIDs de combustível, sem repetir.
    const padrao = obd.padraoPara(st.pidsSuportados, (sessao.carro() || {}).combustivel);
    const escolhidos = padrao.concat(obd.PIDS_COMBUSTIVEL.filter(p => !padrao.includes(p)));
    try {
      await obd.lerAoVivoSeguido(
        st.pidsSuportados,
        (v) => { if (rodada.current !== minha) return; pend.current[v.chave] = v; desenhar(minha); },
        () => rodada.current === minha,
        {
          escolhidos,
          limitesCilindro: param.limites(),
          aoCilindros: c => { if (rodada.current === minha) setCil(c); },
        },
      );
    } catch (e) {
      if (rodada.current === minha) setErro(obd.motivoDe(e));
    } finally {
      if (rodada.current === minha) { rodada.current = 0; setRodando(false); }
    }
  };

  const lidos = Object.keys(valores).map(k => valores[k]).sort((a, b) => obd.ordemDaLeitura(a) - obd.ordemDaLeitura(b));
  const ctx = { ...param.limites(), leituras: valores, carro: sessao.carro() };
  const comb = lidos.length ? obd.leituraCombustivel(
    Object.keys(valores).reduce((o, k) => { const l = valores[k]; o[l.pid * 100] = l; return o; }, {}), param.limites()) : null;

  return html`<div class="corpo">
    <${Cab} titulo="Dados ao vivo">
      ${rodando
        ? html`<button type="button" class="bt perigo" id="sc-parar" onClick=${parar}>PARAR</button>`
        : html`<button type="button" class="bt cheio" id="sc-vivo" onClick=${comecar} disabled=${!st.ligado}>
            <${Ic} n="vivo" t=${19} /> LER AO VIVO</button>`}
      <button type="button" class="bt" onClick=${() => ir("graficos")}>VER EM GRÁFICO</button>
    </${Cab}>
    <div class="rolo">
      ${!st.ligado ? html`<div class="ct"><div class="vazio">Conecte o adaptador no Início para ler este carro.</div></div>` : null}
      ${rodando && !lidos.length ? html`<${Trabalhando} texto="Lendo o carro…" />` : null}
      <${Falhou} texto=${erro} />
      ${lidos.length ? html`<div class="vivos">${lidos.map(l => html`<${Vivo} key=${l.chave} l=${l} ctx=${ctx} />`)}</div>` : null}
      <${Cilindros} c=${cil} />
      <${Combustivel} c=${comb} />
    </div>
  </div>`;
}
