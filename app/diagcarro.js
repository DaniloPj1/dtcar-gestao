/**
 * O carro inteiro, POR MÓDULO (Etapa 3, e pedido do Danilo em 21/11/2026):
 *  - procura todos os módulos e mostra SÓ OS QUE RESPONDERAM, cada um com as suas falhas;
 *  - as leituras ao vivo de um módulo (ABS, câmbio, painel…), pelo mapa do modelo;
 *  - as quatro rodas do ABS lado a lado.
 * Módulo que não respondeu não vira cartão: fica numa linha só, recolhida, para quem quiser ver.
 */
import { html, useState, useEffect, useRef } from "../js/lib.js";
import * as obd from "../js/obd.js";
import * as uds from "../js/uds.js";
import * as sessao from "../js/obdsessao.js";
import * as modelo from "../js/obdmodelo.js";
import * as varredura from "../js/obdvarredura.js";
import * as grafico from "../js/obdgrafico.js";
import * as cadernoRegras from "../js/obdmapa.js";
import { Ic, Cartao, usarPlaca, BuscaPlaca, Veiculo } from "./comum.js";
import { usarExplicacoes, FalhaExplicada, NotaDasFontes, Grafico } from "./diagpartes.js";

/** O mapa do modelo do carro da vez (ou nada, se não há mapa para ele). */
export function usarMapa(carro) {
  const c = carro || {};
  const entrada = modelo.acharModelo(c.marca, c.modelo);
  const [dados, setDados] = useState(null);
  useEffect(() => {
    let vivo = true; setDados(null);
    if (entrada) modelo.carregar(entrada).then(d => { if (vivo) setDados(d); }).catch(() => {});
    return () => { vivo = false; };
  }, [entrada && entrada.arquivo]);
  return { entrada, dados, modulos: dados ? modelo.modulosDoModelo(dados, c.marca, c.ano) : [], comandos: dados ? modelo.comandosDoAno(dados, c.ano) : [] };
}

/** Qual é o carro: mostra o que a sessão já sabe, ou pede a placa. Sem placa as telas continuam funcionando. */
export function CarroDaVez({ st }) {
  const pl = usarPlaca();
  const c = st.carro || {};
  useEffect(() => {
    if (pl.veic) sessao.definirCarro({ placa: String(pl.veic.placa || "").toUpperCase(), marca: pl.veic.marca || "", modelo: pl.veic.modelo || "", ano: pl.veic.ano || "", veiculo_id: pl.veic.id || null });
  }, [pl.veic && pl.veic.placa]);
  if (c.marca || c.modelo) {
    const mapa = modelo.acharModelo(c.marca, c.modelo);
    return html`<div class="carro-vez" id="carro-vez"><b>${[c.marca, c.modelo].filter(Boolean).join(" ")}${c.ano ? " · " + c.ano : ""}${c.placa ? " · " + c.placa : ""}</b>
      <span>${mapa ? "Tem mapa de módulos e leituras para este modelo (" + mapa.sinais + " leituras)." : "Não há mapa aberto para este modelo: o app procura nos endereços padrão e anota o que este carro responder."}</span></div>`;
  }
  return html`<${BuscaPlaca} id="carro-vez-placa" titulo="Placa do carro (para o app saber o modelo)" pl=${pl} />${pl.veic ? html`<${Veiculo} v=${pl.veic} />` : null}`;
}

/** A lista de onde procurar: os módulos do mapa do modelo e os endereços que a norma reserva. */
export function alvosDe(mapa) {
  const out = [];
  for (const m of (mapa && mapa.modulos) || []) out.push({ pedido: m.pedido, resposta: m.resposta, nome: m.nome, doMapa: true });
  for (const e of uds.ENDERECOS_PADRAO) if (!out.some(x => x.pedido === e.pedido)) out.push({ pedido: e.pedido, resposta: e.resposta, nome: e.nome || "Módulo " + e.pedido, doMapa: false });
  return out;
}

/** O carro inteiro: procura, e mostra só quem respondeu, com as falhas de cada um. */
export function CarroInteiro({ st, mapa, aoAbrir, aoVarrer }) {
  const [andando, setAndando] = useState("");
  const [lista, setLista] = useState(null);
  const [erro, setErro] = useState("");
  const [verCalados, setVerCalados] = useState(false);
  const parar = useRef(false);
  const disponiveis = (lista || []).filter(m => m.respondeu);
  const calados = (lista || []).filter(m => !m.respondeu && m.doMapa);
  const explicadas = usarExplicacoes(disponiveis.flatMap(m => m.falhas), st.carro);
  // Saiu da tela no meio da varredura: para depois da consulta em curso e solta o adaptador.
  useEffect(() => () => { parar.current = true; }, []);
  const varrer = async () => {
    setErro(""); setLista(null); parar.current = false;
    const alvos = alvosDe(mapa);
    const r = await sessao.tomar("a leitura do carro inteiro", async () => {
      const l = await varredura.varrer(alvos, { abrir: uds.abrir, sessao: uds.sessao, lerFalhas: uds.lerFalhas, comum: uds.SESSAO.comum, estendida: uds.SESSAO.estendida },
        { aoAndar: (m, i, n) => setAndando("Perguntando ao " + (m.nome || m.pedido) + " (" + i + " de " + n + ")…"), continuar: () => !parar.current, pronta: uds.falhaPronta });
      await uds.fechar();
      return l;
    }, { pausaFundo: true });
    setAndando("");
    if (!r.ok) { setErro(r.texto || "Não deu para ler o carro."); return; }
    setLista(r.r);
    if (aoVarrer) aoVarrer(r.r, alvos);
  };
  return html`<${Cartao} titulo="O carro inteiro, por módulo" id="carro-inteiro">
    ${!st.ligado ? html`<div class="nota">Conecte o adaptador primeiro.</div>` : html`
      ${!andando ? html`<button type="button" class="btn-barra" id="carro-varrer" onClick=${varrer} disabled=${!!st.dono}><${Ic} n="modulo" t=${22} />LER TODOS OS MÓDULOS</button>`
        : html`<div class="carregando" id="carro-andando">${andando}</div><button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => { parar.current = true; }}>PARAR</button>`}
      ${erro ? html`<div class="erro">${erro}</div>` : null}
      ${lista && !disponiveis.length ? html`<div class="vazio">Nenhum módulo respondeu. Confira a ignição ligada e o adaptador.</div>` : null}
      ${disponiveis.length ? html`<div class="nota" id="carro-resumo">${disponiveis.length === 1 ? "1 módulo respondeu" : disponiveis.length + " módulos responderam"}, com ${(n => (n === 0 ? "nenhuma falha gravada" : n === 1 ? "1 falha ao todo" : n + " falhas ao todo"))(varredura.resumo(disponiveis).falhas)}.</div>` : null}
      ${disponiveis.map(m => html`<div key=${m.pedido} class="obd-mod" data-modulo=${m.pedido}>
        <h3 class="obd-mod-t">${m.nome}<span>${m.recusou ? "não entregou as falhas" + (m.erro ? " — " + m.erro : "") : m.falhas.length ? m.falhas.length + (m.falhas.length === 1 ? " falha" : " falhas") : "sem falha gravada"}</span></h3>
        ${m.falhas.map(f => html`<div key=${f.rotulo} class="diag-falha">
          <div class="diag-falha-topo"><b>${f.rotulo}</b>${f.pedeLuz ? html`<span class="selo ruim">LUZ NO PAINEL</span>` : null}</div>
          <${FalhaExplicada} e=${explicadas[f.codigo]} />
          <div class="diag-falha-tipo">${f.causa ? html`Tipo de falha: <b>${f.causa}</b>. ` : null}Situação: ${f.situacaoTexto}.</div>
        </div>`)}
        <button type="button" class="fx-mais abrir-mod" onClick=${() => aoAbrir(m)} disabled=${!!st.dono}>Abrir este módulo (leituras ao vivo, apagar)</button>
      </div>`)}
      ${disponiveis.some(m => m.falhas.length) ? html`<${NotaDasFontes} />` : null}
      ${calados.length ? html`<button type="button" class="fx-mais" id="carro-calados" onClick=${() => setVerCalados(!verCalados)}>${calados.length} módulo(s) do mapa deste modelo não responderam ${verCalados ? "· esconder" : "· ver quais"}</button>` : null}
      ${verCalados ? html`<div class="nota">${calados.map(m => m.nome).join(", ")}. Pode ser módulo que este carro não tem, fusível ou ignição: fica anotado na conferência.</div>` : null}
    `}
  </${Cartao}>`;
}

/**
 * As leituras AO VIVO de um módulo já apontado, pelo mapa do modelo. Lista ou gráfico.
 * A roda só gira com a tela aberta, um pedido por vez, e solta o adaptador entre uma volta e outra
 * (é o que deixa o botão de apagar e o de trocar de módulo responderem).
 */
export function LeiturasDoModulo({ st, mod, comandos }) {
  const meus = (comandos || []).filter(c => c.p === mod.pedido);
  const [valores, setValores] = useState({});
  const [rodando, setRodando] = useState(false);
  const [jeito, setJeito] = useState("lista");
  const [escolha, setEscolha] = useState([]);
  const [recusa, setRecusa] = useState("");
  const [voltas, setVoltas] = useState(0);
  const gira = useRef(0);
  const historia = useRef({});
  useEffect(() => () => { gira.current = 0; }, []);
  useEffect(() => sessao.registrarLeituraDeFundo(() => { gira.current = 0; setRodando(false); }, () => {}), []);
  if (!meus.length) return null;
  const lidos = Object.keys(valores).map(k => valores[k]);
  const rodas = lidos.filter(l => l.roda);
  const ligar = async () => {
    if (gira.current) { gira.current = 0; setRodando(false); return; }
    const minha = Date.now(); gira.current = minha; setRodando(true); historia.current = {};
    // primeiro o que muda depressa (frequência do mapa), e no máximo 24 pedidos por volta
    const fila = meus.slice().sort((a, b) => (a.q || 1) - (b.q || 1)).slice(0, 24);
    while (gira.current === minha) {
      const r = await sessao.tomar("as leituras do módulo", () => modelo.lerModulo(fila, uds.pedir, { continuar: () => gira.current === minha }));
      if (gira.current !== minha) break;
      if (!r.ok) { setRecusa(r.texto || ""); break; }
      const novo = {};
      for (const c of r.r) for (const s of c.sinais) {
        const l = { chave: s.id, rotulo: s.nome, unidade: s.unidade, valor: s.numero ? s.valor : s.texto,
          texto: s.texto, grupo: s.grupo, traduzido: s.traduzido, situacao: c.situacao, roda: s.roda };
        novo[s.id] = l; grafico.anotarPonto(historia.current, l);
      }
      setValores(v => Object.assign({}, v, novo)); setVoltas(n => n + 1);
      await new Promise(f => setTimeout(f, 150));
    }
    if (gira.current === minha) { gira.current = 0; }
    setRodando(false);
  };
  const trocar = k => { const r = grafico.trocar(escolha, k, lidos); setEscolha(r.lista); setRecusa(r.recusa); };
  const porGrupo = {};
  for (const l of lidos) (porGrupo[l.grupo || "Outros"] || (porGrupo[l.grupo || "Outros"] = [])).push(l);
  return html`<${Cartao} titulo=${"Leituras do " + (mod.nome || "módulo")} id="mod-leituras">
    <button type="button" class=${"btn-barra" + (rodando ? " claro" : "")} id="mod-vivo" onClick=${ligar} disabled=${!rodando && !!st.dono}><${Ic} n="obd" t=${20} />${rodando ? "PARAR AS LEITURAS" : "LEITURAS AO VIVO DESTE MÓDULO"}</button>
    ${rodando || voltas ? html`<div class="obd-vivo-topo">${rodando ? html`<span class="selo vivo">AO VIVO</span>` : html`<span class="selo atencao">PARADO</span>`}<span class="nota">${lidos.length} leitura(s) · ${voltas} volta(s)</span></div>` : html`<div class="nota">${meus.reduce((n, c) => n + c.z.length, 0)} leituras no mapa deste módulo. Só aparecem as que este carro responder.</div>`}
    ${rodas.length >= 2 && jeito !== "grafico" ? html`<div class="rodas" id="mod-rodas">${rodas.slice(0, 4).map(l => html`<div key=${l.chave} class="roda"><span>${l.rotulo.replace("Roda ", "").replace(" (velocidade)", "")}</span><b>${l.texto}</b><i>${l.unidade}</i></div>`)}</div>
      <button type="button" class="fx-mais" id="mod-rodas-grafico" onClick=${() => { setJeito("grafico"); setEscolha(rodas.slice(0, 4).map(l => l.chave)); setRecusa(""); }}>Ver as rodas juntas no gráfico</button>` : null}
    ${lidos.length ? html`<div class="obd-filtro" role="group" aria-label="Como mostrar as leituras">
      <button type="button" class=${jeito === "lista" ? "esc" : ""} aria-pressed=${jeito === "lista"} onClick=${() => setJeito("lista")}>LISTA</button>
      <button type="button" id="mod-jeito-grafico" class=${jeito === "grafico" ? "esc" : ""} aria-pressed=${jeito === "grafico"} onClick=${() => setJeito("grafico")}>GRÁFICO</button></div>` : null}
    ${lidos.length && jeito === "grafico" ? html`<${Grafico} lidos=${lidos} historia=${historia.current} escolha=${escolha} aoTrocar=${trocar} recusa=${recusa} />` : null}
    ${lidos.length && jeito === "lista" ? Object.keys(porGrupo).sort().map(g => html`<div key=${g} class="lista-viva-grupo"><h3>${g}</h3>
      ${porGrupo[g].map(l => html`<div key=${l.chave} class="kv"><span>${l.rotulo}${!l.traduzido ? html` <span class="fx-en">em inglês</span>` : null}${l.situacao === "nao-conferido" ? html` <span class="fx-en">não conferido p/ este ano</span>` : null}:</span><i></i><b>${l.texto}${l.unidade ? " " + l.unidade : ""}</b></div>`)}</div>`) : null}
    <div class="fx-origem">Mapa de leituras de comunidade (OBDb), por modelo. Não é definição de fábrica.</div>
  </${Cartao}>`;
}

/**
 * O MAPEAMENTO DO CARRO DESCONHECIDO (Etapa 4, mecanismo 2). Não tem botão: com o adaptador ligado,
 * carro SEM mapa aberto, parado, e ninguém usando o adaptador, o app faz UMA pergunta de leitura
 * por folga — quem responde em cada endereço de diagnóstico e a identificação de quem respondeu.
 * O caderno do carro (js/obdmapa.js) anota as respostas sozinho; aqui só se faz a pergunta.
 * Para sozinho quando a pessoa abre um módulo, sai da tela, ou o carro começa a andar.
 */
export function Mapeando({ st, mapa, parado, caderno }) {
  const [and, setAnd] = useState(null);
  const [motivo, setMotivo] = useState("");
  const semMapa = !!(st.carro && (st.carro.marca || st.carro.vin)) && !mapa.entrada;
  const pode = st.ligado && semMapa && !parado && !!caderno();
  useEffect(() => {
    if (!pode) return undefined;
    let vivo = true;
    (async () => {
      // Só com o carro PARADO, e isso é perguntado ao carro (velocidade, PID 0D) ANTES DE CADA PERGUNTA,
      // não só no começo: se o carro sair do lugar, a pergunta seguinte já não é feita. (Antes a
      // conferência era a cada 25 passos, o que deixava mais de 16 s de perguntas com o carro
      // andando: achado da revisão do Codex, 21/11/2026.)
      const velocidade = async () => {
        const v = await sessao.tomar(sessao.DE_FUNDO, async () => { await uds.fechar(); return obd.pedir("010D", 3000); });
        const hex = v.ok && v.r && !v.r.erro ? String(v.r.hex || "") : "";
        return /^410D[0-9A-F]{2}/.test(hex) ? parseInt(hex.slice(4, 6), 16) : null;
      };
      let primeira = true;
      while (vivo) {
        await new Promise(f => setTimeout(f, 700));                     // a folga: a tela e a pessoa vêm primeiro
        if (!vivo) break;
        if (sessao.estado().dono || sessao.estado().modulo || sessao.estado().acaoCorrendo) continue;
        const cad = caderno(); const p = cad && modeloDoPasso(cad);
        if (!p) { if (vivo) setAnd(a => ({ ...(a || {}), acabou: true })); break; }
        const kmh = await velocidade();
        if (!vivo) break;
        if (kmh === null) { setMotivo(primeira ? "O carro não informou a velocidade: sem a certeza de que está parado, o app não mapeia." : "O carro parou de informar a velocidade: mapeamento interrompido."); break; }
        if (kmh > 0) { setMotivo(primeira ? "Carro andando: o mapeamento só roda com o carro parado." : "O carro saiu do lugar: mapeamento interrompido."); break; }
        primeira = false;
        await sessao.tomar(sessao.DE_FUNDO, async () => {
          await uds.abrir({ pedido: p.pedido, resposta: p.resposta, esperaMs: 300 });
          if (p.tipo === "endereco") await uds.sessao(uds.SESSAO.comum); else await uds.lerDado(parseInt(p.did, 16));
        });
        if (vivo && cad) setAnd(andamentoDo(cad));
      }
      // Só fecha se ninguém assumiu um módulo enquanto isso: fechar tiraria o endereço e o filtro dele.
      await sessao.tomar(sessao.DE_FUNDO, () => (sessao.estado().modulo ? null : uds.fechar()));
    })();
    return () => { vivo = false; };
  }, [pode]);
  if (!st.ligado || !semMapa) return null;
  return html`<div class="mapeando" id="mapeando">
    <b>${and && and.acabou ? "Este carro foi mapeado." : "Mapeando este carro em segundo plano"}</b>
    <span>${motivo || (and ? and.feitos + " de " + and.total + " endereços perguntados · " + and.responderam + " módulo(s) responderam" : "Só perguntas de leitura, uma por vez, quando o adaptador está livre.")}
      O que este carro responder fica anotado sozinho para o próximo do mesmo modelo.</span></div>`;
}
const modeloDoPasso = cad => cadernoRegras.proximoPasso(cad);
const andamentoDo = cad => cadernoRegras.andamento(cad);
