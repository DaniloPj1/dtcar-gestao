/**
 * FALHAS DO CARRO no DTCar Scanner.
 *
 * Regras do Danilo que esta tela cumpre:
 *  - o botão de APAGAR fica junto da leitura: ninguém sai da tela para achar o botão (23/11/2026);
 *  - APAGADA some da lista; só continua o que o módulo ainda tiver;
 *  - fica registrado o que foi apagado, com o KM do painel;
 *  - sem avisos de rotina.
 */
import { html, useState, useEffect, useRef } from "../../js/lib.js";
import * as obd from "../../js/obd.js";
import * as sessao from "../../js/obdsessao.js";
import * as falhasCat from "../../js/obdfalhas.js";
import { Cab, Trabalhando, Falhou, useApp, Ic, lerCofre, gravarCofre } from "../comum.js";

const CHAVE_APAGADOS = "scanner_apagados";
const SELO = { atual: ["ATUAL", "ruim"], pendente: ["PENDENTE", "atencao"], permanente: ["PERMANENTE", "atencao"] };
const hoje = () => new Date().toLocaleDateString("pt-BR");

/** Um código, com a descrição e as causas de onde se procura. */
function Codigo({ f, e }) {
  const selo = SELO[f.situacao] || ["", ""];
  return html`<div class=${"dtc " + f.situacao}>
    <div class="topo">
      <span class="cod" style=${"color:var(--" + (f.situacao === "atual" ? "ruim" : "atencao") + ")"}>${f.codigo}</span>
      <span class=${"selo " + selo[1]}>${selo[0]}</span>
      ${f.modulo ? html`<span class="selo rede">${f.modulo}</span>` : null}
      ${e && e.fonte ? html`<span style="margin-left:auto;font-size:11.5px;color:var(--meio)">${e.fonte}</span>` : null}
    </div>
    <div class="desc">${(e && e.descricao) || "Sem descrição nas bases abertas para este código."}</div>
    ${e && e.causas && e.causas.length ? html`<div class="causas">
      ${e.causas.map(c => html`<div key=${c.texto}>${c.texto}</div>`)}</div>` : null}
  </div>`;
}

export function Falhas() {
  const { st, carro } = useApp();
  const [lendo, setLendo] = useState("");
  const [erro, setErro] = useState("");
  const [res, setRes] = useState(null);        // { falhas, erros }
  const [expl, setExpl] = useState({});
  const [apagar, setApagar] = useState(null);  // { km, antes } | { feito, antes, restaram }
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  const apagados = lerCofre(CHAVE_APAGADOS, []).filter(a => a.placa === (carro && carro.placa));

  const ler = () => {
    setErro(""); setApagar(null); setLendo("Lendo as falhas do carro…");
    return sessao.tomar("a leitura de falhas", async () => {
      const f = await obd.lerFalhas();
      if (!vivo.current) return;
      setRes(f);
      const e = await falhasCat.explicarTodos(f.falhas, { marca: (carro && carro.marca) || "", vin: (carro && carro.vin) || "" });
      if (vivo.current) setExpl(e);
    }).then(r => { if (r && r.ok === false) setErro(r.texto || ""); })
      .catch(e => setErro(obd.motivoDe(e)))
      .finally(() => { if (vivo.current) setLendo(""); });
  };

  const abrirApagar = () => setApagar({ km: "", antes: (res && res.falhas) || [] });

  const apagarAgora = () => {
    const antes = (apagar && apagar.antes) || [], km = (apagar && apagar.km) || "";
    setErro(""); setLendo("Apagando as falhas…");
    return sessao.comAcao("o apagamento das falhas", async () => {
      const r = await obd.apagarFalhas();
      if (!r.ok) { if (vivo.current) setErro(r.erro || "O módulo não aceitou apagar."); return; }
      await new Promise(f => setTimeout(f, 1500));            // o módulo refaz a lista antes de valer perguntar
      const depois = await obd.lerFalhas();
      if (!vivo.current) return;
      // APAGADA SOME: a lista passa a ser só o que o módulo ainda tem
      setRes(depois);
      const restaram = depois.falhas.map(f => f.codigo);
      setApagar({ feito: true, antes, restaram });
      gravarCofre(CHAVE_APAGADOS, [{ placa: (carro && carro.placa) || "", data: hoje(), km,
        codigos: antes.map(f => f.codigo), restaram }].concat(lerCofre(CHAVE_APAGADOS, [])).slice(0, 40));
    }).then(r => { if (r && r.ok === false) setErro(r.texto || ""); })
      .catch(e => setErro(obd.motivoDe(e)))
      .finally(() => { if (vivo.current) setLendo(""); });
  };

  const falhas = (res && res.falhas) || [];
  // O botão aparece JUNTO dos códigos (é o pedido do Danilo: não sair da tela para achar o botão).
  // Enquanto o app ainda está buscando as descrições, ele fica visível e desligado, em vez de sumir.
  const podeApagar = st.ligado && res && falhas.length > 0;

  return html`<div class="corpo">
    <${Cab} titulo=${"Falhas do carro" + (res ? " · " + falhas.length + " código(s)" : "")}>
      <button type="button" class="bt" id="sc-ler-falhas" onClick=${ler} disabled=${!st.ligado || !!lendo}>
        <${Ic} n="falha" t=${19} /> ${res ? "LER DE NOVO" : "LER FALHAS"}</button>
      ${podeApagar && !apagar ? html`<button type="button" class="bt perigo" id="sc-abrir-apagar" onClick=${abrirApagar} disabled=${!!lendo}>
        <${Ic} n="apagar" t=${19} /> APAGAR ESTAS FALHAS</button>` : null}
    </${Cab}>
    <div class="rolo">
      ${!st.ligado ? html`<div class="ct"><div class="vazio">Conecte o adaptador no Início para ler este carro.</div></div>` : null}
      ${lendo ? html`<${Trabalhando} texto=${lendo} />` : null}
      <${Falhou} texto=${erro} />

      ${apagar && apagar.feito ? html`<div class="ct" style="border-left:4px solid var(--certo)">
        <h2>APAGADO <span class="selo certo">${apagar.antes.length} CÓDIGO(S)</span></h2>
        <div class="kv"><span>O que estava gravado</span><b>${apagar.antes.map(f => f.codigo).join(", ") || "—"}</b></div>
        <div class="kv"><span>Continuou no módulo</span><b>${apagar.restaram.length ? apagar.restaram.join(", ") : "nada"}</b></div>
        ${apagar.restaram.length ? html`<p style="margin:10px 0 0;font-size:14.5px;line-height:1.45">
          O que continuou é defeito acontecendo AGORA: o módulo gravou de novo na hora.</p>` : null}
      </div>` : null}

      ${apagar && !apagar.feito ? html`<div class="ct" style="border:1px solid var(--ruim)">
        <h2 style="color:var(--perigo)">APAGAR — o que acontece</h2>
        <p style="margin:0 0 11px;font-size:14.5px;line-height:1.5">Some o código e a foto do momento.
          Zera as adaptações e a prontidão dos monitores. O carro precisa rodar de novo para os monitores fecharem.</p>
        <label for="sc-km" style="font-size:12.5px;font-weight:600;color:var(--meio);display:block;margin-bottom:5px">KM DO PAINEL</label>
        <input id="sc-km" inputmode="numeric" value=${apagar.km}
          onInput=${e => setApagar(a => ({ ...a, km: e.target.value.replace(/\D/g, "").slice(0, 7) }))}
          style="width:220px;height:50px;border:1.5px solid var(--anel);border-radius:8px;padding:0 12px;font-size:17px" />
        <div class="bt-linha" style="margin-top:13px">
          <button type="button" class="bt perigo alto" id="sc-apagar-agora" onClick=${apagarAgora} disabled=${!!lendo}>APAGAR AGORA</button>
          <button type="button" class="bt" onClick=${() => setApagar(null)} disabled=${!!lendo}>NÃO APAGAR</button>
        </div>
      </div>` : null}

      ${res && !falhas.length ? html`<div class="ct"><h2>NENHUM CÓDIGO GRAVADO</h2>
        <div class="vazio">O módulo não tem código agora.</div></div>` : null}
      ${falhas.map(f => html`<${Codigo} key=${f.codigo + f.situacao} f=${f} e=${expl[falhasCat.soCodigo(f.codigo)]} />`)}

      ${apagados.length ? html`<div class="ct"><h2>JÁ FOI APAGADO NESTE CARRO</h2>
        ${apagados.map((a, i) => html`<div class="kv" key=${i}><span>${a.data}${a.km ? " · " + a.km + " km" : ""}</span>
          <b>${a.codigos.join(", ") || "—"}</b></div>`)}
      </div>` : null}
    </div>
  </div>`;
}
