/**
 * DTCar Scanner — o app de diagnóstico do tablet da oficina (pedido do Danilo, 25/11/2026).
 *
 * É SEPARADO do app do sistema: aqui não há O.S., estoque nem financeiro, e não há login. Só o
 * carro. As telas vêm do site (/scanner/), então mudar tela não exige APK novo — o APK carrega só
 * a parte nativa (o Bluetooth do adaptador ELM327).
 *
 * Quem entende de OBD é o motor do próprio site (js/obd.js, js/uds.js, js/bico.js...), o MESMO que
 * o app do celular usa: aqui não há cópia da lógica, só a tela do tablet.
 *
 * A PLACA é a primeira coisa que o app pede e fica guardada até ser trocada em ALTERAR PLACA. O
 * menu lateral só aparece DENTRO de uma leitura; no Início são cards de ícone.
 */
import { html, render, useState, useEffect, useRef } from "../js/lib.js";
import * as obd from "../js/obd.js";
import * as sessao from "../js/obdsessao.js";
import * as confere from "../js/obdconfere.js";
import { consultarPlaca, paraResumo, anoFabMod } from "../js/placa.js";
import { normPlaca, placaValida, fmtKm } from "../js/util.js";
import { Ctx, TELAS, ir, rotaDe, raizDa, useApp, Sinal, PlacaId, Falhou, Trabalhando, Ic, lerCofre, gravarCofre } from "./comum.js";
import { AoVivo } from "./telas/aovivo.js";
import { Graficos } from "./telas/graficos.js";
import { Falhas } from "./telas/falhas.js";
import { Rede } from "./telas/rede.js";
import { Prog, Atuador, Aprender, Bico } from "./telas/prog.js";

const COMP = { aovivo: AoVivo, graficos: Graficos, falhas: Falhas, rede: Rede, prog: Prog,
  atuador: Atuador, aprender: Aprender, bico: Bico };

const CHAVE_PLACA = "scanner_placa";
const CHAVE_RECENTES = "scanner_placas_recentes";

/** O selo da conferência do chassi. O nome vai SEMPRE escrito: em P&B, cor sozinha não informa. */
const SELO_CHASSI = {
  ok: ["BATE COM A PLACA", "certo"],
  atencao: ["CONFERIR A PLACA", "atencao"],
  "sem-dado": ["SEM COMPARAÇÃO", "mudo"],
  ruim: ["CONFERIR A PLACA — O CHASSI É DE OUTRO CARRO", "ruim"],
};

/* ------------------------------------------------------------------ barra lateral */

/** O menu lateral — só aparece dentro de uma leitura (pedido do Danilo). */
function Rail({ rota }) {
  return html`<nav class="rail" aria-label="Funções">
    <div class="marca">DTCar<br /><span>SCANNER</span></div>
    <a href="#/inicio"><${Ic} n="carro" t=${23} />Início</a>
    ${TELAS.map(t => html`<a key=${t.r} href=${"#/" + t.r} aria-current=${t.r === raizDa(rota) ? "page" : undefined}>
      <${Ic} n=${t.ic} t=${23} />${t.nome}</a>`)}
  </nav>`;
}

/* ------------------------------------------------------------------ tela da placa */

function Porta() {
  const { trocarPlaca } = useApp();
  const [v, setV] = useState("");
  const recentes = lerCofre(CHAVE_RECENTES, []);
  const limpa = normPlaca(v), pode = placaValida(limpa);
  const entrar = p => { trocarPlaca(p); ir("inicio"); };
  return html`<div class="porta">
    <div class="cabeca">
      <img src="../icons/logo-branco.png" alt="DTCar Centro Automotivo" />
      <div><h1>Qual carro vai ler?</h1><p>A placa fica guardada até o senhor trocar em ALTERAR PLACA.</p></div>
    </div>
    <form class="meio" onSubmit=${e => { e.preventDefault(); if (pode) entrar(limpa); }}>
      <label for="pl">PLACA DO VEÍCULO</label>
      <input id="pl" name="placa" value=${v} autocomplete="off" autocapitalize="characters" spellcheck="false"
        maxlength="7" placeholder="AAA0A00" onInput=${e => setV(normPlaca(e.target.value))} />
      <button type="submit" class="bt cheio alto" id="sc-entrar" disabled=${!pode}>LER ESTE CARRO</button>
      ${recentes.length ? html`<div><label>ÚLTIMOS CARROS</label>
        <div class="recentes">${recentes.map(p => html`<button key=${p} type="button" onClick=${() => entrar(p)}>${p}</button>`)}</div>
      </div>` : null}
    </form>
  </div>`;
}

/* ------------------------------------------------------------------ o adaptador */

function Adaptador() {
  const { st } = useApp();
  const [aparelhos, setAparelhos] = useState(null);
  const [erro, setErro] = useState("");
  const procurar = async outro => {
    setErro("");
    try {
      const ultimo = sessao.ultimoAparelho();
      if (ultimo && !outro) return void sessao.ligar(ultimo);
      const p = await obd.permissao();
      if (p && !p.concedida) await obd.pedirPermissao();
      const lista = await obd.listar();
      setAparelhos(lista);
      // UM adaptador pareado é o caso da oficina: conecta direto, sem o mecânico tocar duas vezes
      // numa lista de um item só.
      if (lista.length === 1 && !outro) sessao.ligar(lista[0]);
    } catch (e) { setErro(obd.motivoDe(e)); }
  };
  if (!obd.disponivel()) {
    return html`<div class="ct"><h2>ADAPTADOR</h2>
      <div class="vazio">O Bluetooth do adaptador existe só dentro do APK do Scanner.
      Aberto pelo navegador, as telas aparecem mas não há leitura.</div></div>`;
  }
  if (st.ligado) {
    return html`<div class="ct"><h2>ADAPTADOR</h2>
      <div class="kv"><span>Aparelho</span><b>${(st.aparelho && st.aparelho.nome) || "conectado"}</b></div>
      ${st.protocolo ? html`<div class="kv"><span>Protocolo</span><b>${st.protocolo}</b></div>` : null}
      ${st.versao ? html`<div class="kv"><span>Versão</span><b>${st.versao}</b></div>` : null}
      <div class="bt-linha" style="margin-top:12px">
        <button type="button" class="bt" id="sc-desconectar" onClick=${() => sessao.desligar()} disabled=${st.acaoCorrendo}>DESCONECTAR</button>
      </div>
      <${Falhou} texto=${st.aviso} />
    </div>`;
  }
  return html`<div class="ct"><h2>ADAPTADOR</h2>
    <div class="bt-linha">
      <button type="button" class="bt cheio alto" id="sc-conectar" onClick=${() => procurar(false)} disabled=${st.ligando}>
        <${Ic} n="vivo" t=${20} /> ${st.ligando ? "CONECTANDO…" : "CONECTAR"}</button>
      ${sessao.ultimoAparelho() ? html`<button type="button" class="bt" id="sc-outro" onClick=${() => procurar(true)} disabled=${st.ligando}>OUTRO ADAPTADOR</button>` : null}
    </div>
    ${aparelhos && aparelhos.length ? html`<div class="lista" style="margin-top:12px">
      ${aparelhos.map(a => html`<div class="item" key=${a.endereco}>
        <button type="button" onClick=${() => sessao.ligar(a)}><span class="nome">${a.nome}</span><span class="seta">›</span></button>
      </div>`)}</div>` : null}
    ${aparelhos && !aparelhos.length ? html`<div class="vazio">Nenhum aparelho pareado. Pareie o adaptador uma vez nos Ajustes do Android (Bluetooth) e volte aqui.</div>` : null}
    <${Falhou} texto=${erro || st.erro} />
  </div>`;
}

/* ------------------------------------------------------------------ o carro, com chassi e monitores */

/**
 * O quadro do carro. CHASSI E MONITORES ficam AQUI, junto dos dados do carro, quando o VIN é lido
 * (pedido do Danilo, 25/11/2026) — não numa tela à parte.
 */
function CarroCard() {
  const { st, placa, carro, anotarLeituraDoCarro } = useApp();
  const [lendo, setLendo] = useState("");
  const [erro, setErro] = useState("");
  const ler = () => {
    setErro("");
    setLendo("Lendo chassi, monitores e odômetro…");
    sessao.tomar("a leitura do chassi", async () => {
      const monitores = await obd.lerMonitores().catch(() => null);
      const vin = await obd.lerChassi().catch(() => "");
      const odometro = await obd.lerOdometro(st.pidsSuportados).catch(() => null);
      anotarLeituraDoCarro({ vin, monitores, odometro });
    }).then(r => { if (r && r.ok === false) setErro(r.texto || ""); })
      .catch(e => setErro(obd.motivoDe(e)))
      .finally(() => setLendo(""));
  };
  const c = carro || { placa };
  const mon = c.monitores;
  return html`<div class="ct" id="sc-carro"><h2>O CARRO</h2>
    <div class="par">
      <div>
        <div class="kv"><span>Placa</span><b>${placa}</b></div>
        <div class="kv"><span>Marca</span><b>${c.marca || "—"}</b></div>
        <div class="kv"><span>Modelo</span><b>${c.modelo || "—"}</b></div>
        <div class="kv"><span>Ano</span><b>${c.ano || "—"}</b></div>
      </div>
      <div>
        <div class="kv"><span>Combustível</span><b>${c.combustivel || "—"}</b></div>
        <div class="kv"><span>Motor</span><b>${c.motor || "—"}</b></div>
        <div class="kv"><span>Cor</span><b>${c.cor || "—"}</b></div>
        <div class="kv"><span>Chassi lido do carro</span><b>${c.vin || "—"}</b></div>
      </div>
    </div>
    ${c.chassiItem ? html`<div class="kv"><span>Placa e chassi</span>
      <b><span class=${"selo " + SELO_CHASSI[c.chassiItem.situacao][1]} id="sc-confere-chassi">${SELO_CHASSI[c.chassiItem.situacao][0]}</span></b></div>` : null}
    ${typeof c.odometro === "number" ? html`<div class="kv"><span>Odômetro do módulo</span><b>${fmtKm(c.odometro)}</b></div>` : null}
    ${mon ? html`
      <h3>MONITORES DE EMISSÃO — ${mon.prontos} de ${mon.total} prontos</h3>
      <div class="kv"><span>Luz de injeção</span><b>
        <span class=${"selo " + (mon.luzAcesa ? "ruim" : "certo")}>${mon.luzAcesa ? "ACESA" : "APAGADA"}</span>
        ${" "}${mon.quantidade} código(s) no módulo</b></div>
      <div class="par">${[0, 1].map(col => html`<div key=${col}>
        ${mon.monitores.filter((_, i) => i % 2 === col).map(m => html`<div class="kv" key=${m.nome}><span>${m.nome}</span>
          <b><span class=${"selo " + (m.pronto ? "certo" : "atencao")}>${m.pronto ? "PRONTO" : "NÃO PRONTO"}</span></b></div>`)}
      </div>`)}</div>` : null}
    ${lendo ? html`<${Trabalhando} texto=${lendo} />` : html`
      <div class="bt-linha" style="margin-top:12px">
        <button type="button" class="bt" id="sc-ler-chassi" onClick=${ler} disabled=${!st.ligado || !!st.dono}>
          <${Ic} n="chassi" t=${19} /> ${c.vin ? "LER DE NOVO" : "LER CHASSI E MONITORES"}</button>
      </div>`}
    <${Falhou} texto=${erro} />
  </div>`;
}

/* ------------------------------------------------------------------ Início: os cards */

function Inicio() {
  const { st, placa, trocarPlaca } = useApp();
  return html`<div class="corpo">
    <header class="cab">
      <h1>DTCar Scanner</h1>
      <${Sinal} st=${st} />
      <div class="dir">
        <${PlacaId} placa=${placa} />
        <button type="button" class="bt" id="sc-alterar-placa" onClick=${() => { trocarPlaca(""); ir("placa"); }}>ALTERAR PLACA</button>
      </div>
    </header>
    <div class="rolo">
      <div class="cards">
        ${TELAS.map(t => html`<button key=${t.r} type="button" class=${"card" + (t.grava ? " grava" : "")}
          id=${"sc-card-" + t.r} onClick=${() => ir(t.r)}>
          <${Ic} n=${t.ic} t=${54} sw=${1.7} />
          <b>${t.nome}</b>
          ${t.grava ? html`<span class="tag">ESCREVE NO CARRO</span>` : html`<small>${t.sub}</small>`}
        </button>`)}
      </div>
      <div class="par"><${Adaptador} /><${CarroCard} /></div>
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ o app */

function App() {
  const [rota, setRota] = useState(rotaDe);
  const [st, setSt] = useState(sessao.estado);
  const [placa, setPlaca] = useState(() => lerCofre(CHAVE_PLACA, ""));
  const [carro, setCarro] = useState(null);
  const buscando = useRef("");

  useEffect(() => {
    const ver = () => setRota(rotaDe());
    addEventListener("hashchange", ver);
    return () => removeEventListener("hashchange", ver);
  }, []);
  useEffect(() => sessao.assinar(setSt), []);
  useEffect(() => { if (!placa && rota !== "placa") ir("placa"); }, [placa, rota]);

  // o modelo do carro pela placa, para comparar com o VIN lido do próprio carro
  useEffect(() => {
    if (!placa || buscando.current === placa) return;
    buscando.current = placa;
    setCarro(null);
    sessao.definirCarro({ placa });
    (async () => {
      const r = await consultarPlaca(placa, "basico");
      if (buscando.current !== placa) return;                     // a placa já mudou: resposta velha
      if (r && r.ok && r.encontrado && r.dados) {
        const d = paraResumo(r.dados);
        const novo = { ...d, ano: d.ano || anoFabMod(r.dados.ano_fab, r.dados.ano_mod), chassi: r.dados.chassi || "", placa };
        setCarro(c => ({ ...novo, ...(c || {}) }));                // o que já foi lido do carro manda
        sessao.definirCarro({ placa, marca: novo.marca, modelo: novo.modelo, combustivel: novo.combustivel, chassiCadastro: novo.chassi });
      }
      // sem internet no pátio, ou placa que a consulta não achou: segue pelo VIN do próprio carro
    })();
  }, [placa]);

  const trocarPlaca = p => {
    const limpa = normPlaca(p);
    setPlaca(limpa);
    setCarro(null);
    buscando.current = "";
    gravarCofre(CHAVE_PLACA, limpa);
    if (limpa) gravarCofre(CHAVE_RECENTES, [limpa].concat(lerCofre(CHAVE_RECENTES, []).filter(x => x !== limpa)).slice(0, 6));
  };

  /**
   * O que foi lido do próprio carro. O VIN é conferido com o chassi do cadastro: AVISA e manda
   * conferir a placa, mas a leitura segue (decisão do Danilo, 25/11/2026).
   */
  const anotarLeituraDoCarro = ({ vin, monitores, odometro }) => {
    setCarro(c => {
      const base = c || { placa };
      const r = confere.conferir({ vinLido: vin || base.vin || "", chassiCadastro: base.chassi || "" });
      return { ...base, vin: vin || base.vin || "", monitores: monitores || base.monitores || null,
        odometro: typeof odometro === "number" ? odometro : base.odometro,
        chassiItem: r.itens.find(i => i.chave === "chassi") || null };
    });
    if (vin) sessao.definirCarro({ vin });
  };

  const ctx = { st, placa, carro, trocarPlaca, anotarLeituraDoCarro };
  if (rota === "placa" || !placa) return html`<${Ctx.Provider} value=${ctx}><${Porta} /></${Ctx.Provider}>`;
  if (rota === "inicio") return html`<${Ctx.Provider} value=${ctx}><div class="app"><${Inicio} /></div></${Ctx.Provider}>`;
  const Tela = COMP[rota] || AoVivo;
  return html`<${Ctx.Provider} value=${ctx}>
    <div class="app"><${Rail} rota=${rota} /><${Tela} /></div>
  </${Ctx.Provider}>`;
}

render(html`<${App} />`, document.getElementById("raiz"));

if ("serviceWorker" in navigator) {
  addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch(() => { /* segue sem guardar as telas */ }); });
}
