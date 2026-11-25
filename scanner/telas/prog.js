/**
 * PROGRAMAÇÕES AVANÇADAS do DTCar Scanner — a aba que o Danilo pediu em 25/11/2026 para guardar
 * teste de atuador, aprendizados e programações num lugar só, TUDO EM LISTA, com a informação
 * escondida e aberta no toque.
 *
 * Esta é a única tela do Scanner que ESCREVE NO CARRO. Quem manda os comandos é o motor do site
 * (js/uds.js e js/bico.js), o mesmo do app do celular: a trava que devolve o controle da saída ao
 * módulo no fim, no erro e ao sair da tela mora lá, conferida por 141 testes do UDS.
 *
 * O Danilo decidiu em 25/11/2026 que o tablet não pede senha ("senha só para entrar no sistema"):
 * quem está com o tablet na mão pode acionar e gravar. Em troca, TODA ação fica registrada no
 * próprio tablet — data, placa, módulo e o que o módulo respondeu.
 */
import { html, useState, useEffect, useRef } from "../../js/lib.js";
import * as obd from "../../js/obd.js";
import * as uds from "../../js/uds.js";
import * as sessao from "../../js/obdsessao.js";
import * as bico from "../../js/bico.js";
import { Cab, Trabalhando, Falhou, Item, useApp, Ic, lerCofre, gravarCofre } from "../comum.js";

const CHAVE_REGISTRO = "scanner_acoes";
const MODULOS = [
  { pedido: "7E0", resposta: "7E8", nome: "Motor" },
  { pedido: "18DA10F1", resposta: "18DAF110", nome: "Motor (29 bits)" },
  { pedido: "7E1", resposta: "7E9", nome: "Câmbio" },
];
const hex4 = n => "0x" + Number(n).toString(16).toUpperCase().padStart(4, "0");
const agora = () => new Date().toLocaleString("pt-BR");

/** Guarda no tablet o que foi feito no carro. Sem login, é este o rastro. */
function registrar(placa, o) {
  gravarCofre(CHAVE_REGISTRO, [{ em: agora(), placa: placa || "", ...o }].concat(lerCofre(CHAVE_REGISTRO, [])).slice(0, 120));
}

/* ------------------------------------------------------------------ a tela */

export function Prog() {
  const { st, placa, carro } = useApp();
  const [mod, setMod] = useState(MODULOS[0]);
  const [achado, setAchado] = useState(null);     // { rotinas, atuadores, dados, avisos, duvida }
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const [aberto, setAberto] = useState("");       // qual item da lista está aberto
  const [andando, setAndando] = useState(null);   // { titulo, passos, fim }
  const cancelar = useRef(false);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; cancelar.current = true; }, []);

  const abrir = k => setAberto(x => (x === k ? "" : k));

  const descobrir = async () => {
    setErro(""); setAchado(null); setOcupado("Apontando o módulo…");
    const r = await sessao.tomar("a descoberta do módulo", async () => {
      await uds.abrir({ pedido: mod.pedido, resposta: mod.resposta, marca: (carro && carro.marca) || "", bits29: mod.pedido.length > 3 });
      const s = await uds.sessao(uds.SESSAO.estendida);
      if (s.nrc != null) return { recusou: s.texto };
      setOcupado("Perguntando o que este módulo aceita…");
      const d = await uds.descobrirEpti({ aoAndar: t => { if (vivo.current) setOcupado(t); } });
      await uds.fechar();
      return d;
    });
    if (!vivo.current) return;
    setOcupado("");
    if (!r.ok) return void setErro(r.texto || "Não deu para falar com este módulo.");
    if (r.r && r.r.recusou) return void setErro(r.r.recusou);
    setAchado(r.r);
  };

  /** Aciona uma saída. A trava de devolver o controle é do js/uds.js. */
  const acionar = async did => {
    setAberto(""); cancelar.current = false;
    setAndando({ titulo: "Saída " + hex4(did), passos: [] });
    const r = await sessao.comAcao("o teste de atuador", async () => {
      await uds.abrir({ pedido: mod.pedido, resposta: mod.resposta, marca: (carro && carro.marca) || "", bits29: mod.pedido.length > 3 });
      return uds.testarAtuador(did, { segundos: 5, pausar: sessao.pausar, retomar: sessao.retomar,
        continuar: () => !cancelar.current, aoAndar: p => { if (vivo.current) setAndando(a => ({ ...a, passos: p.passos })); } });
    });
    if (!vivo.current) return;
    const fim = r.ok ? r.r : { ok: false, texto: r.texto || "Não deu para rodar o teste." };
    setAndando(a => ({ ...(a || { titulo: "", passos: [] }), fim }));
    registrar(placa, { o: "atuador", modulo: mod.nome, did: hex4(did), ok: !!fim.ok, texto: fim.texto || "" });
  };

  /** Roda uma rotina de aprendizado/calibração. */
  const rodar = async rid => {
    setAberto("");
    setAndando({ titulo: "Rotina " + hex4(rid), passos: [{ o: "sessao", t: "Abrindo a sessão de diagnóstico…" }] });
    const r = await sessao.comAcao("o aprendizado", async () => {
      await uds.abrir({ pedido: mod.pedido, resposta: mod.resposta, marca: (carro && carro.marca) || "", bits29: mod.pedido.length > 3 });
      const s = await uds.sessao(uds.SESSAO.estendida);
      if (s.nrc != null) return { ok: false, texto: s.texto };
      const g = await uds.rodarRotina(rid, uds.ROTINA.comecar);
      await uds.fechar();
      return { ok: g.nrc == null && !g.erro, texto: g.texto || (g.nrc == null ? "O módulo aceitou e começou a rotina." : "") };
    });
    if (!vivo.current) return;
    const fim = r.ok ? r.r : { ok: false, texto: r.texto || "Não deu para rodar a rotina." };
    setAndando(a => ({ ...(a || { titulo: "", passos: [] }), fim }));
    registrar(placa, { o: "rotina", modulo: mod.nome, rid: hex4(rid), ok: !!fim.ok, texto: fim.texto || "" });
  };

  const feitos = lerCofre(CHAVE_REGISTRO, []).filter(x => !placa || x.placa === placa);

  return html`<div class="corpo">
    <${Cab} titulo="Programações avançadas">
      <span class="selo ruim">ESCREVE NO CARRO</span>
      <button type="button" class="bt cheio" id="sc-descobrir" onClick=${descobrir} disabled=${!st.ligado || !!ocupado || !!st.dono}>
        <${Ic} n="prog" t=${19} /> ${achado ? "PERGUNTAR DE NOVO" : "VER O QUE ESTE MÓDULO ACEITA"}</button>
    </${Cab}>
    <div class="rolo">
      ${!st.ligado ? html`<div class="ct"><div class="vazio">Conecte o adaptador no Início para abrir este módulo.</div></div>` : null}

      <div class="ct"><h2>MÓDULO</h2>
        <div class="bt-linha">${MODULOS.map(m => html`<button key=${m.pedido} type="button"
          class=${"bt" + (m.pedido === mod.pedido ? " cheio" : "")} onClick=${() => { setMod(m); setAchado(null); }}
          disabled=${!!ocupado || st.acaoCorrendo}>${m.nome} · ${m.pedido}</button>`)}</div>
      </div>

      ${ocupado ? html`<${Trabalhando} texto=${ocupado} />` : null}
      <${Falhou} texto=${erro} />

      ${andando ? html`<div class="ct" id="sc-andando" style=${"border-left:4px solid var(--" + (andando.fim ? (andando.fim.ok ? "certo" : "ruim") : "atencao") + ")"}>
        <h2>${andando.titulo}</h2>
        ${andando.passos.map((p, i) => html`<div class="kv" key=${i}><span>${p.t}</span><b></b></div>`)}
        ${andando.fim
          ? html`<p style=${"margin:10px 0 0;font-size:14.5px;font-weight:600;color:var(--" + (andando.fim.ok ? "certo" : "ruim") + ")"}>${andando.fim.texto}</p>
              <div class="bt-linha" style="margin-top:12px"><button type="button" class="bt" onClick=${() => setAndando(null)}>FECHAR</button></div>`
          : html`<${Trabalhando} texto="Acionando… confira no carro." />
              <div class="bt-linha" style="margin-top:12px"><button type="button" class="bt perigo" id="sc-parar-atuador"
                onClick=${() => { cancelar.current = true; }}>PARAR AGORA</button></div>`}
      </div>` : null}

      ${achado ? html`
        <div class="ct"><h2>TESTE DE ATUADOR — ${achado.atuadores.length} saída(s) que o módulo informou</h2>
          ${achado.duvida ? html`<${Falhou} texto="O módulo respondeu números que cabem tanto em rotina quanto em atuador: o app não tem certeza de que esta lista é de saída. Confira o número no manual do módulo antes de acionar." />` : null}
          <div class="lista">
            ${achado.atuadores.map(n => html`<${Item} key=${"a" + n} nome=${"Saída " + hex4(n)} aberto=${aberto === "a" + n}
              abrir=${() => abrir("a" + n)} dir=${html`<span class="selo rede">ATUADOR</span>`}>
              <div class="kv"><span>Módulo</span><b>${mod.nome} · ${mod.pedido}</b></div>
              <div class="kv"><span>Comando</span><b>UDS 0x2F · ${hex4(n)} · 5 segundos</b></div>
              <p style="margin:0;font-size:14px;line-height:1.5">O módulo informou o NÚMERO da saída, não o nome dela — o nome está num anexo da norma que o app não tem. Acione e confira no carro o que se moveu. O comando da norma é curto, então o app repete enquanto o teste corre e devolve o controle ao módulo no fim, no erro e se o senhor sair da tela.</p>
              <div class="bt-linha"><button type="button" class="bt perigo" id=${"sc-acionar-" + n}
                onClick=${() => acionar(n)} disabled=${!!andando || st.acaoCorrendo}>ACIONAR ESTA SAÍDA</button></div>
            </${Item}>`)}
          </div>
          ${!achado.atuadores.length ? html`<div class="vazio">Este módulo não informou atuador pela norma de inspeção. Não quer dizer que não tenha: quer dizer que o app não vai adivinhar o número da saída.</div>` : null}
        </div>

        <div class="ct"><h2>APRENDIZADOS E CALIBRAÇÕES — ${achado.rotinas.length} rotina(s)</h2>
          <div class="lista">
            ${achado.rotinas.map(n => html`<${Item} key=${"r" + n} nome=${"Rotina " + hex4(n)} aberto=${aberto === "r" + n}
              abrir=${() => abrir("r" + n)} dir=${html`<span class="selo atencao">${(uds.faixaRid(n) || {}).nome || "ROTINA"}</span>`}>
              <div class="kv"><span>Módulo</span><b>${mod.nome} · ${mod.pedido}</b></div>
              <div class="kv"><span>Comando</span><b>UDS 0x31 · começar · ${hex4(n)}</b></div>
              <div class="kv"><span>Faixa da norma</span><b>${(uds.faixaRid(n) || {}).nome || "fora das faixas conhecidas"}</b></div>
              <p style="margin:0;font-size:14px;line-height:1.5">Rotina muda o que o módulo aprendeu: zera adaptação, calibra sensor, inicia regeneração. Rodar no carro errado, ou fora da condição que a rotina pede, faz o módulo recusar — ou aprender errado. Confira no manual antes.</p>
              <div class="bt-linha"><button type="button" class="bt perigo" id=${"sc-rotina-" + n}
                onClick=${() => rodar(n)} disabled=${!!andando || st.acaoCorrendo}>RODAR ESTA ROTINA</button></div>
            </${Item}>`)}
          </div>
          ${!achado.rotinas.length ? html`<div class="vazio">Este módulo não informou rotina pela norma de inspeção.</div>` : null}
        </div>

        ${achado.dados && achado.dados.length ? html`<div class="ct"><h2>O QUE ESTE MÓDULO SABE INFORMAR — ${achado.dados.length}</h2>
          <div class="lista">
            ${achado.dados.map(d => html`<${Item} key=${"d" + d.did} nome=${d.nome || "Dado " + d.did} aberto=${aberto === "d" + d.did}
              abrir=${() => abrir("d" + d.did)} dir=${html`<span class="selo mudo">${d.did}</span>`}>
              <div class="kv"><span>Identificador</span><b>0x${d.did}</b></div>
              <p style="margin:0;font-size:14px;line-height:1.5">Leitura por identificador (UDS 0x22). Entra nos gráficos quando o mapa do modelo trouxer a conta deste dado.</p>
            </${Item}>`)}
          </div>
        </div>` : null}

        <${Bicos} mod=${mod} placa=${placa} travado=${!!andando || st.acaoCorrendo} />
      ` : null}

      ${achado && achado.avisos && achado.avisos.length ? html`<div class="ct"><h2>O QUE O MÓDULO AVISOU</h2>
        ${achado.avisos.map(a => html`<p key=${a} style="margin:6px 0;font-size:14px;line-height:1.45">${a}</p>`)}
      </div>` : null}

      ${feitos.length ? html`<div class="ct"><h2>JÁ FOI FEITO NESTE CARRO</h2>
        ${feitos.slice(0, 12).map((x, i) => html`<div class="kv" key=${i}>
          <span>${x.em} · ${x.modulo}</span>
          <b><span class=${"selo " + (x.ok ? "certo" : "ruim")}>${x.ok ? "ACEITOU" : "NÃO ACEITOU"}</span>
            ${" "}${x.o === "atuador" ? "saída " + x.did : x.o === "rotina" ? "rotina " + x.rid : "bico cil. " + x.cilindro}</b></div>`)}
      </div>` : null}
    </div>
  </div>`;
}

/* ------------------------------------------------------------------ programar bico */

/**
 * PROGRAMAR BICO: gravar no módulo o código do ímã de cada bico trocado.
 *
 * O campo (identificador) onde cada ECU guarda o bico NÃO está em base aberta nenhuma: quem informa
 * é quem tem o manual da ECU, e o app NUNCA chuta. Antes de gravar, o app PERGUNTA ao módulo se ele
 * aceita gravação naquele campo (uds.aceitaGravar, que não grava nada) — e o botão de gravar só
 * existe quando a resposta é sim para todos os cilindros marcados.
 */
function Bicos({ mod, placa, travado }) {
  const [qtd, setQtd] = useState(4);
  const [itens, setItens] = useState(() => [1, 2, 3, 4].map(c => ({ cilindro: c, codigo: "", trocado: false, campo: "" })));
  const [aceite, setAceite] = useState(null);
  const [conferindo, setConferindo] = useState(false);
  const [andando, setAndando] = useState(null);
  const [aberto, setAberto] = useState(0);
  const vivo = useRef(true);
  useEffect(() => () => { vivo.current = false; }, []);

  const trocarQtd = n => {
    setQtd(n); setAceite(null);
    setItens(ant => Array.from({ length: n }, (_, i) => ant[i] || { cilindro: i + 1, codigo: "", trocado: false, campo: "" }));
  };
  const mexer = (i, p) => { setItens(l => l.map((x, j) => (j === i ? { ...x, ...p } : x))); setAceite(null); };

  const conf = bico.conferirConjunto(itens, qtd);
  const paraGravar = conf.paraGravar.map(c => ({ ...c, campo: String((itens.find(x => x.cilindro === c.cilindro) || {}).campo || "").toUpperCase() }));
  const campoBom = c => /^[0-9A-F]{4}$/.test(c) && !(parseInt(c, 16) >= 0xf180 && parseInt(c, 16) <= 0xf1ff);
  const camposCertos = paraGravar.length > 0 && paraGravar.every(c => campoBom(c.campo)) && new Set(paraGravar.map(c => c.campo)).size === paraGravar.length;
  const assinatura = paraGravar.map(c => c.cilindro + ":" + c.campo).join(",");
  const aceiteVale = !!(aceite && aceite.assinatura === assinatura);
  const moduloAceita = aceiteVale && !aceite.erro && aceite.itens.length > 0 && aceite.itens.every(x => x.aceita === true);

  const conferirModulo = async () => {
    setConferindo(true); setAndando(null);
    const itensAceite = [];
    const r = await sessao.comAcao("a conferência do módulo", async () => {
      await uds.abrir({ pedido: mod.pedido, resposta: mod.resposta, bits29: mod.pedido.length > 3 });
      const s = await uds.sessao(uds.SESSAO.estendida);
      if (s.nrc != null) return { aberto: false, texto: s.texto };
      for (const c of paraGravar) itensAceite.push({ cilindro: c.cilindro, campo: c.campo, ...(await uds.aceitaGravar(parseInt(c.campo, 16))) });
      await uds.fechar();
      return { aberto: true };
    });
    if (!vivo.current) return;
    setConferindo(false);
    setAceite({ assinatura, itens: itensAceite,
      erro: !r.ok ? (r.texto || "Não deu para conferir.") : !r.r.aberto ? (r.r.texto || "O módulo não abriu a sessão de diagnóstico.") : "" });
  };

  const gravar = async () => {
    const passos = [], anota = t => { passos.push(t); if (vivo.current) setAndando({ passos: passos.slice() }); };
    const feito = [];
    const r = await sessao.comAcao("a gravação do bico", async () => {
      anota("Apontando o " + mod.nome + "…");
      await uds.abrir({ pedido: mod.pedido, resposta: mod.resposta, bits29: mod.pedido.length > 3 });
      const s = await uds.sessao(uds.SESSAO.estendida);
      if (s.nrc != null) { anota("O módulo não abriu a sessão de diagnóstico. Nada foi gravado."); return feito; }
      for (const c of paraGravar) {
        anota("Cilindro " + c.cilindro + ": lendo o valor atual do campo " + c.campo + " e gravando " + c.codigo + "…");
        const g = await uds.gravarDado(parseInt(c.campo, 16), bico.paraHex(c.codigo));
        const item = { cilindro: c.cilindro, campo: c.campo, codigo: c.codigo, ok: g.nrc == null && !g.erro,
          antes: g.antes ? g.antes.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("") : null,
          texto: g.texto || (g.nrc == null ? "Gravado." : "") };
        feito.push(item);
        anota("Cilindro " + c.cilindro + ": " + (item.ok ? "gravado." : "NÃO gravou — " + (item.texto || "o módulo recusou.")));
        registrar(placa, { o: "bico", modulo: mod.nome, cilindro: c.cilindro, campo: c.campo, ok: item.ok, texto: item.texto });
        if (!item.ok) break;                       // não insiste nos outros depois de uma recusa
      }
      await uds.fechar();
      return feito;
    });
    if (!vivo.current) return;
    setAndando({ passos, feito: r.ok ? r.r : feito, erro: r.ok ? "" : (r.texto || "Não deu para gravar.") });
  };

  return html`<div class="ct" id="sc-bico"><h2>PROGRAMAR BICO — código do ímã de cada bico trocado</h2>
    <div class="bt-linha" style="margin-bottom:12px">
      ${[3, 4, 5, 6, 8].map(n => html`<button key=${n} type="button" class=${"bt" + (n === qtd ? " cheio" : "")}
        onClick=${() => trocarQtd(n)} disabled=${travado}>${n} CILINDROS</button>`)}
    </div>
    <div class="lista">
      ${itens.map((x, i) => {
        const t = bico.tipoDoCodigo(x.codigo), v = x.codigo ? bico.validarIma(x.codigo) : null;
        return html`<${Item} key=${x.cilindro} nome=${"Cilindro " + x.cilindro} aberto=${aberto === x.cilindro}
          abrir=${() => setAberto(a => (a === x.cilindro ? 0 : x.cilindro))}
          dir=${x.trocado ? html`<span class=${"selo " + (v && v.ok ? "certo" : "atencao")}>${x.codigo || "SEM CÓDIGO"}</span>` : html`<span class="selo mudo">NÃO TROCADO</span>`}>
          <div class="bt-linha">
            <button type="button" class=${"bt" + (x.trocado ? " cheio" : "")} onClick=${() => mexer(i, { trocado: !x.trocado })} disabled=${travado}>
              ${x.trocado ? "BICO TROCADO" : "MARCAR COMO TROCADO"}</button>
          </div>
          ${x.trocado ? html`
            <label style="font-size:12.5px;font-weight:600;color:var(--meio)">CÓDIGO DO ÍMÃ (7 caracteres, gravado a laser no corpo do bico)</label>
            <input value=${x.codigo} maxlength="20" autocapitalize="characters" spellcheck="false"
              onInput=${e => mexer(i, { codigo: e.target.value.toUpperCase().replace(/[^0-9A-Z]/g, "") })} disabled=${travado}
              style="width:260px;height:50px;border:1.5px solid var(--anel);border-radius:8px;padding:0 12px;font-family:var(--num);font-size:22px;letter-spacing:3px" />
            ${v && !v.ok ? html`<${Falhou} texto=${v.motivo} />` : null}
            ${t === "delphi" ? html`<p style="margin:0;font-size:14px">Código Delphi (20 caracteres): precisa de conversão antes de gravar.</p>` : null}
            <label style="font-size:12.5px;font-weight:600;color:var(--meio)">CAMPO DA ECU ONDE ESTE CILINDRO É GRAVADO (4 dígitos, do manual da ECU)</label>
            <input value=${x.campo} maxlength="4" autocapitalize="characters" spellcheck="false"
              onInput=${e => mexer(i, { campo: e.target.value.toUpperCase().replace(/[^0-9A-F]/g, "") })} disabled=${travado}
              style="width:150px;height:50px;border:1.5px solid var(--anel);border-radius:8px;padding:0 12px;font-family:var(--num);font-size:22px;letter-spacing:3px" />
            <p style="margin:0;font-size:13.5px;line-height:1.45;color:var(--meio)">O app não tem — e nenhuma base aberta tem — a tabela de em que campo cada ECU guarda o bico. Quem informa é quem tem o manual da ECU. O app nunca chuta esse número.</p>
          ` : null}
        </${Item}>`;
      })}
    </div>

    ${conf.avisos && conf.avisos.length ? html`<h3>CONFIRA ANTES</h3>
      ${conf.avisos.map(a => html`<p key=${a} style="margin:5px 0;font-size:14px;line-height:1.45">${a}</p>`)}` : null}

    ${aceiteVale && !moduloAceita ? html`<${Falhou} texto=${aceite.erro ||
      ("O módulo não aceita gravação em: " + aceite.itens.filter(x => !x.aceita).map(x => "cilindro " + x.cilindro + " (campo " + x.campo + ")").join(", ") + ". Confira o campo no manual da ECU.")} />` : null}

    <div class="bt-linha" style="margin-top:13px">
      ${!camposCertos
        ? html`<button type="button" class="bt" disabled>INFORME O CÓDIGO E O CAMPO DE CADA CILINDRO TROCADO</button>`
        : !moduloAceita
          ? html`<button type="button" class="bt cheio" id="sc-bico-conferir" onClick=${conferirModulo} disabled=${conferindo || travado}>
              ${conferindo ? "PERGUNTANDO AO MÓDULO…" : "PERGUNTAR SE O MÓDULO ACEITA (não grava nada)"}</button>`
          : html`<button type="button" class="bt perigo alto" id="sc-bico-gravar" onClick=${gravar} disabled=${travado}>
              GRAVAR ${paraGravar.length} BICO(S) NO MÓDULO</button>`}
    </div>

    ${andando ? html`<div style="margin-top:13px">
      ${andando.passos.map((p, i) => html`<div class="kv" key=${i}><span>${p}</span><b></b></div>`)}
      <${Falhou} texto=${andando.erro} />
      ${andando.feito && andando.feito.length ? html`<h3>RESULTADO</h3>
        ${andando.feito.map(f => html`<div class="kv" key=${f.cilindro}><span>Cilindro ${f.cilindro} · campo ${f.campo}</span>
          <b><span class=${"selo " + (f.ok ? "certo" : "ruim")}>${f.ok ? "GRAVADO" : "NÃO GRAVOU"}</span>
            ${f.antes ? " · antes estava " + f.antes : ""}</b></div>`)}` : null}
    </div>` : null}
  </div>`;
}
