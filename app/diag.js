/**
 * As telas "No carro": ler o carro (OBD), módulos, atuadores, aprendizados, programar bico e
 * parâmetros. Saíram do app/telas.js em 21/11/2026 para o diagnóstico ter arquivo próprio.
 * A conexão com o adaptador mora em js/obdsessao.js, acima destas telas.
 */
import { html, useState, useEffect, useRef } from "../js/lib.js";
import { api } from "../js/api.js";
import { fmtData, fmtKm } from "../js/util.js";
import { podeApagarObd, podeAtuarObd, podeAprenderObd, podeGravarObd } from "../js/appacesso.js";
import * as param from "../js/obdparam.js";
import * as obd from "../js/obd.js";
import * as uds from "../js/uds.js";
import * as bico from "../js/bico.js";
import * as sessao from "../js/obdsessao.js";
import * as registro from "../js/obdregistro.js";
import { usarExplicacoes, FalhaExplicada, NotaDasFontes, Digital, Grafico, registrarAcao, ligarCaderno, subirPendentes, cadernoAtual } from "./diagpartes.js";
import * as grafico from "../js/obdgrafico.js";
import { usarMapa, CarroDaVez, CarroInteiro, LeiturasDoModulo, Mapeando } from "./diagcarro.js";
import { HondaLista, Condicoes } from "./diaghonda.js";
import * as confere from "../js/obdconfere.js";
import * as compara from "../js/obdcompara.js";
import * as faixas from "../js/obdfaixa.js";
import * as laudo from "../js/obdlaudo.js";
import * as falhasCat from "../js/obdfalhas.js";
import { pdfLaudo, garantirJsPDF } from "../js/pdflaudo.js";
import { entregarArquivo } from "../js/pdf.js";
import { useApp, Ic, ir, Cartao, KV, Campo, Quadro, usarPlaca, BuscaPlaca, Veiculo, Tela, usarPasso } from "./comum.js";

const SELO_DTC = { atual: ["ATUAL", "ruim"], pendente: ["PENDENTE", "atencao"], permanente: ["PERMANENTE", "atencao"] };

// Mostrador do painel de dados ao vivo: arco de 270° com o número grande no meio, como num scanner.
// O rótulo é SEMPRE escrito (quem lê está embaixo do carro, com pressa: ponteiro sozinho não informa).
// R e as voltas do arco são fixos para o desenho não depender de medir a tela.
const M_R = 34, M_VOLTA = 2 * Math.PI * M_R, M_ARCO = M_VOLTA * 0.75;
/** número do jeito que se escreve aqui: vírgula decimal */
const numBR = n => String(n).replace(".", ",");
// As ZONAS da faixa de trabalho dentro da escala da leitura (pedido do Danilo, 21/11/2026: "o rail
// trabalha de x a y — barra com uma tonalidade antes do x e outra depois do y"). Devolve as três
// partes em fração da escala (0 a 1), ou null quando não há faixa ou ela não cabe na escala.
function zonasDe(l, f) {
  if (!f || !(l.ate > l.de) || !(f.ate > f.de)) return null;
  // A barra APROXIMA: mostra uma faixa de largura igual à de trabalho para cada lado, sem sair da
  // escala da leitura. (Na escala inteira o rail, que vai a 2.000 bar, espremia a faixa num canto.)
  const larg = f.ate - f.de;
  const min = Math.max(l.de, f.de - larg), max = Math.min(l.ate, f.ate + larg);
  if (!(max > min)) return null;
  const pos = x => Math.max(0, Math.min(1, (x - min) / (max - min)));
  const a = pos(f.de), b = pos(f.ate);
  return b > a ? { a, b, min, max, parte: pos(l.valor) } : null;
}

function Mostrador({ l, f }) {
  const tem = typeof l.de === "number" && typeof l.ate === "number" && l.ate > l.de;
  const parte = tem ? Math.max(0, Math.min(1, (l.valor - l.de) / (l.ate - l.de))) : 0;
  const zs = tem ? zonasDe(l, f) : null;
  return html`<div class=${"mostrador" + (zs ? " com-faixa" : "")} data-situacao=${f ? f.situacao : null} title=${f ? f.fonte : null} data-pid=${l.pid} data-chave=${l.chave}>
    <div class="mostrador-rot">${l.rotulo}</div>
    ${tem ? html`<svg class="mostrador-arco" viewBox="0 0 86 86" aria-hidden="true">
      <g transform="rotate(135 43 43)">
        ${zs ? null : html`<circle cx="43" cy="43" r=${M_R} class="trilho" stroke-dasharray=${M_ARCO + " " + M_VOLTA} />`}
        ${zs ? html`
          <circle cx="43" cy="43" r=${M_R} class="zona antes" stroke-dasharray=${(M_ARCO * zs.a) + " " + M_VOLTA} />
          <circle cx="43" cy="43" r=${M_R} class="zona trabalho" stroke-dasharray=${(M_ARCO * (zs.b - zs.a)) + " " + M_VOLTA} stroke-dashoffset=${-M_ARCO * zs.a} />
          <circle cx="43" cy="43" r=${M_R} class="zona depois" stroke-dasharray=${(M_ARCO * (1 - zs.b)) + " " + M_VOLTA} stroke-dashoffset=${-M_ARCO * zs.b} />
          <circle cx="43" cy="43" r=${M_R} class="agulha" stroke-dasharray=${"3 " + M_VOLTA} stroke-dashoffset=${-(M_ARCO * zs.parte - 1.5)} />`
        : html`<circle cx="43" cy="43" r=${M_R} class="cheio" stroke-dasharray=${(M_ARCO * parte) + " " + M_VOLTA} />`}
      </g>
    </svg>` : null}
    <div class=${"mostrador-num" + (tem ? " dentro" : "") + (String(numBR(l.valor)).length > 4 ? " longo" : "")}>
      <b>${numBR(l.valor)}</b>${l.unidade ? html`<span>${l.unidade}</span>` : null}
    </div>
    ${zs ? html`<div class="mostrador-pes faixa">${numBR(f.de)} a ${numBR(f.ate)}</div>`
      : tem ? html`<div class="mostrador-pes"><span>${numBR(l.de)}</span><span>${numBR(l.ate)}</span></div>` : null}
  </div>`;
}

// Uma leitura na visão LISTA: cabe mais na tela que o mostrador e continua mostrando a posição
// na escala, numa barra fina. O rótulo é sempre escrito e o valor fica grande, porque quem lê
// está embaixo do carro.
function LinhaViva({ l, f }) {
  const tem = typeof l.de === "number" && typeof l.ate === "number" && l.ate > l.de;
  const parte = tem ? Math.max(0, Math.min(1, (l.valor - l.de) / (l.ate - l.de))) : 0;
  const zs = tem ? zonasDe(l, f) : null;
  const pc = x => (x * 100).toFixed(1) + "%";
  return html`<div class="linha-viva" data-situacao=${f ? f.situacao : null} title=${f ? f.fonte : null} data-pid=${l.pid} data-chave=${l.chave}>
    <div class="linha-viva-topo">
      <span class="linha-viva-rot">${l.rotulo}</span>
      <b class="linha-viva-num">${numBR(l.valor)}${l.unidade ? html`<span>${l.unidade}</span>` : null}</b>
    </div>
    ${zs ? html`<div class="barra-zonas" data-de=${f.de} data-ate=${f.ate}>
        <div class="barra-zonas-trilho">
          <span class="zona antes" style=${"width:" + pc(zs.a)}></span>
          <span class="zona trabalho" style=${"width:" + pc(zs.b - zs.a)}></span>
          <span class="zona depois" style=${"width:" + pc(1 - zs.b)}></span>
          <i class="agulha" style=${"left:" + pc(zs.parte)}></i>
        </div>
        <div class="barra-zonas-pes"><span class="pe-de" style=${"left:" + pc(zs.a)}>${numBR(f.de)}</span><span class="pe-ate" style=${"left:" + pc(zs.b)}>${numBR(f.ate)}</span></div>
      </div>`
      : tem ? html`<div class="linha-viva-barra"><i style=${"width:" + (parte * 100).toFixed(1) + "%"}></i></div>` : null}
  </div>`;
}

// A conversa da leitura de combustível: o quanto o módulo está corrigindo, em português, com as
// causas que costumam explicar aquilo. NUNCA dá veredito — faixa de normalidade por motor só a
// montadora publica, e quem decide é o mecânico com o carro na frente.
function Combustivel({ v }) {
  const r = obd.leituraCombustivel(v, param.limites());
  const cor = r.situacao === "grave" ? "ruim" : r.situacao === "atencao" ? "atencao" : r.situacao === "normal" ? "" : "atencao";
  const selo = r.situacao === "grave" ? "NO LIMITE" : r.situacao === "atencao" ? "CORRIGINDO" : r.situacao === "normal" ? "EM ORDEM" : "SEM DADOS";
  return html`<div class="comb" id="obd-comb">
    <div class="comb-topo"><span class=${"selo " + cor}>${selo}</span></div>
    ${r.bancos.length ? html`<div class="comb-bancos">
      ${r.bancos.map(b => html`<div key=${b.nome} class="comb-banco" data-banco=${b.nome}>
        <span class="comb-banco-n">${b.nome}</span>
        <b>${String(b.total).replace(".", ",")}<i>%</i></b>
        <span class="comb-banco-p">curto ${b.curto === null ? "—" : String(b.curto).replace(".", ",")} · longo ${b.longo === null ? "—" : String(b.longo).replace(".", ",")}</span>
      </div>`)}
    </div>` : null}
    ${r.frases.map((f, i) => html`<p key=${i} class="comb-frase">${f}</p>`)}
    ${r.causas.length ? html`<div class="comb-causas">
      <h3>O que costuma explicar isso</h3>
      <ul>${r.causas.map(c => html`<li key=${c}>${c}</li>`)}</ul>
      <div class="nota">Lista geral do OBD, não é diagnóstico deste motor: a faixa de normalidade de cada modelo só a montadora publica. Confira com o carro na frente.</div>
    </div>` : null}
  </div>`;
}

/**
 * Parâmetros de referência (pedido do Danilo, 20/11/2026). Tela de LEITURA, sem formulário:
 * quem corrige é o Claude, no arquivo `js/obdparam.js` — o Danilo confere no Raven, manda a foto no chat
 * e o valor entra como conferido, com o carro e a data (decisão dele em 20/11/2026, à tarde).
 * Assim cada correção fica no histórico do repositório e ninguém digita número errado no celular.
 * A distinção entre o conferido e o suposto é DISCRETA, como ele pediu: tonalidade de cinza + a palavra
 * escrita miúda ao lado (a regra da casa é nunca deixar só a cor falando) e uma legenda no rodapé.
 */
function Parametros() {
  const [abrir, setAbrir] = useState(false);
  const lista = param.lista();
  const Linha = ({ p }) => html`<div class=${"par-linha nv-" + p.nivelAtual} data-param=${p.id}>
    <div class="par-topo">
      <span class="par-nome">${p.nome}</span>
      <b class="par-valor">${param.textoDe(p)}</b>
    </div>
    <div class="par-pe">
      <span class="par-nivel">${param.nivel(p.nivelAtual).nome}</span>
      ${p.onde === "modelo" ? html`<span class="par-modelo">${p.modelo}</span>` : null}
      ${p.usado ? html`<span class="par-usado">o app usa</span>` : null}
    </div>
    ${p.conferencia ? html`<div class="par-fonte">${param.textoConferencia(p.conferencia)}</div>` : null}
    <div class="par-fonte">${p.fonte}</div>
  </div>`;
  const usados = lista.filter(p => p.usado);
  const resto = lista.filter(p => !p.usado);
  return html`<${Cartao} titulo="Parâmetros de referência" id="obd-parametros">
    <button type="button" class="btn-barra claro" id="obd-param-abrir" onClick=${() => setAbrir(x => !x)}>
      ${abrir ? "FECHAR OS PARÂMETROS" : "VER PARÂMETROS (" + lista.length + ")"}</button>
    ${abrir ? html`
      <div class="sec"><h3>O app decide por estes</h3>${usados.map(p => html`<${Linha} key=${p.id} p=${p} />`)}</div>
      <div class="sec"><h3>Referência, só para comparar</h3>${resto.map(p => html`<${Linha} key=${p.id} p=${p} />`)}</div>
      <div class="par-legenda">
        <span class="nv-conferido">conferido aqui</span>
        <span class="nv-norma">norma</span>
        <span class="nv-montadora">montadora</span>
        <span class="nv-suposto">suposto, a conferir</span>
      </div>
      <div class="par-fonte">Não existe tabela pública de faixa normal para motor flex brasileiro — nem GM, nem Fiat, nem VW, nem Honda. Confira no Raven e mande a foto no chat: o valor entra aqui com o carro e a data, e sobe para "conferido aqui".</div>
    ` : null}
  </${Cartao}>`;
}

function Obd() {
  const { dados, cfg, perfil, telas: minhasTelas } = useApp();
  const outrasTelas = [
    { r: "modulos", curto: "ABS, câmbio, airbag", rotulo: "MÓDULOS DO CARRO (ABS, CÂMBIO, AIRBAG…)" },
    { r: "atuadores", curto: "atuadores", rotulo: "ATUADORES" },
    { r: "aprendizados", curto: "aprendizados", rotulo: "APRENDIZADOS E CALIBRAÇÕES" },
    { r: "bico", curto: "programar bico", rotulo: "PROGRAMAR BICO" },
  ].filter(o => (minhasTelas || []).includes(o.r));
  const pl = usarPlaca();
  const [aparelhos, setAparelhos] = useState(null);
  // A conexão mora em js/obdsessao.js, acima das telas: trocar para a tela de atuador e voltar não
  // derruba mais o adaptador. `lig` continua com o mesmo formato de antes, montado a partir dela,
  // para o resto desta tela não precisar mudar.
  const ses = usarSessao();
  const lig = ses.ligado ? {
    nome: (ses.aparelho || {}).nome || "", endereco: (ses.aparelho || {}).endereco || "",
    protocolo: ses.protocolo, versao: ses.versao, aviso: ses.aviso, pidsSuportados: ses.pidsSuportados,
  } : null;
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  // UMA leitura por vez na tela (pedido do Danilo, 19/11/2026): abrir falhas tira os dados ao vivo
  // da frente. Empilhar cartão em cima de cartão faz o mecânico rolar a tela procurando o que
  // acabou de pedir, e no celular isso é pior que não mostrar.
  const [res, setRes] = useState(null);         // { o: "falhas"|"conf"|"foto"|"testes", d: ... }
  const temPlugin = obd.disponivel();
  // Dados ao vivo DE VERDADE: uma roda que fica girando e atualizando a tela a cada valor que chega.
  // `rodada` é uma caixa (não estado) porque a roda precisa enxergar o valor NOVO a cada volta;
  // estado dentro de função que já começou continuaria valendo o antigo e ela nunca pararia.
  // Guarda o NÚMERO da rodada que pode girar (0 = parar tudo), não um sim/não: se o mecânico
  // parar e ligar de novo antes de a leitura em andamento voltar (até 1,5 s), a roda velha
  // continuaria girando junto com a nova, ou desligaria a nova ao terminar. Cada roda só
  // obedece e só se desliga se o número ainda for o dela.
  const rodada = useRef(0);
  const contador = useRef(0);
  // Painel de mostradores ou lista: o Danilo pediu as duas, escolhidas por filtro (19/11/2026).
  // A escolha fica guardada: quem gosta de uma não quer trocar a cada carro.
  const [jeito, setJeito] = useState(() => {
    try { const j = window.localStorage.getItem("obd_jeito"); return ["lista", "digital", "grafico"].includes(j) ? j : "painel"; } catch (e) { return "painel"; }
  });
  const trocarJeito = j => {
    setJeito(j);
    try { window.localStorage.setItem("obd_jeito", j); } catch (e) { /* sem espaço: segue sem guardar */ }
  };
  // GRÁFICO (pedido do Danilo, 21/11/2026): até 3 gráficos; leituras da mesma unidade dividem um. A história de cada leitura
  // fica numa caixa (não em estado): quem redesenha a tela é o valor novo chegando, e guardar ponto
  // não pode custar um desenho a mais. A escolha fica guardada: quem acompanha rotação e sonda num
  // carro quer as mesmas no próximo.
  const historia = useRef({});
  const [noGrafico, setNoGrafico] = useState(() => { try { const l = JSON.parse(window.localStorage.getItem("obd_grafico") || "[]"); return Array.isArray(l) ? l.slice(0, grafico.GRAFICOS_MAX * grafico.LINHAS_MAX) : []; } catch (e) { return []; } });
  const [graficoRecusa, setGraficoRecusa] = useState("");
  const trocarGrafico = chave => {
    const r = grafico.trocar(noGrafico, chave, vivo ? Object.keys(vivo.valores).map(k => vivo.valores[k]) : []);
    setGraficoRecusa(r.recusa); setNoGrafico(r.lista);
    try { window.localStorage.setItem("obd_grafico", JSON.stringify(r.lista)); } catch (e) { /* segue sem guardar */ }
  };
  // O CARRO COMPARADO COM ELE MESMO (Etapa 1): a roda de leitura alimenta um resumo por sinal e por
  // regime; quando ela para, o resumo é guardado sozinho e posto ao lado das leituras anteriores
  // deste carro. Precisa da placa: sem saber qual é o carro não há com quem comparar.
  const sessaoCmp = useRef(null);
  const [comparado, setComparado] = useState(null);     // { achados, sessoes, guardou } | { semPlaca } | { pouco }
  // A FAIXA DE TRABALHO ao lado de cada leitura (pedido do Danilo, 21/11/2026): as leituras anteriores
  // DESTE carro, carregadas quando a placa é conhecida. Sem elas vale a referência da tabela.
  const [anteriores, setAnteriores] = useState([]);
  const [vivo, setVivo] = useState(null);       // { valores: {chave: leitura}, volta, rodando, modo }
  // Falhas vigiadas DURANTE a leitura ao vivo: a roda pergunta de tempos em tempos e, se o módulo
  // gravar código com o motor trabalhando, o botão de falhas fica vermelho na hora.
  const [falhasVivo, setFalhasVivo] = useState(null);   // { codigos: [], novas: [] }
  const baseFalhas = useRef(null);              // os códigos que já existiam quando a roda começou
  // Quais leituras mostrar. Vazio = todas as que o carro tiver. Fica guardado POR PLACA: cada carro
  // tem o seu conjunto, e quem lê um Hilux não quer a mesma lista de um Gol.
  // Regra do Danilo (20/11/2026): a tela abre com as leituras PADRÃO; o resto fica no filtro, para
  // acrescentar, e há um botão que põe todas. Guardado por placa como { modo, pids }.
  const [escolha, setEscolha] = useState({ modo: "padrao", pids: [] });
  const [abrirEscolha, setAbrirEscolha] = useState(false);
  // Apagar a falha, com registro (v62, decisão do Danilo em 19/11/2026). Quem apaga é decidido no sistema
  // (Sistema › Equipe, por pessoa); aqui a tela só mostra o botão para quem pode. O passo "confirmar" existe
  // porque apagar é o único comando que sai daqui PARA o carro, e não tem volta: a foto do momento da falha
  // some junto.
  const [apagar, setApagar] = useState(null);   // { passo: "confirmar"|"feito", km, antes, comb, r, depois, combDepois, registro }
  const [antesApagados, setAntesApagados] = useState(null);   // apagamentos anteriores DESTE carro
  const podeApagar = podeApagarObd(cfg, perfil);
  const explicadas = usarExplicacoes(res && res.o === "falhas" ? res.d.falhas : null, ses.carro);

  // Sair da tela PARA a roda de leitura, mas não desliga o adaptador: quem desliga é sair de toda a
  // família de diagnóstico, e isso o js/obdsessao.js resolve (ver saindoDaTela). A roda precisa
  // parar aqui porque ela é desta tela.
  useEffect(() => () => { rodada.current = 0; }, []);
  // A roda de leitura ao vivo se registra como leitura de fundo: qualquer comando que AJA no carro,
  // em qualquer tela da família, para ela antes e a retoma depois. Sem isto o ELM327 atende os dois
  // pedidos ao mesmo tempo e a resposta volta trocada.
  useEffect(() => sessao.registrarLeituraDeFundo(
    () => { rodada.current = 0; setVivo(v => (v ? { ...v, rodando: false } : v)); },
    () => { /* a volta é por conta do mecânico: religar a roda sozinho assustaria */ },
  ), []);

  const placa = String((pl.veic && pl.veic.placa) || pl.placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const guardado = (chave, valor) => {
    const k = "obd_" + chave + (placa ? "_" + placa : "");
    try {
      if (valor === undefined) { const t = window.localStorage.getItem(k); return t ? JSON.parse(t) : null; }
      window.localStorage.setItem(k, JSON.stringify(valor));
    } catch (e) { /* sem espaço ou JSON estragado: segue sem memória */ }
    return null;
  };
  // Registro de apagamento que ficou no aparelho (sem internet na hora): sobe sozinho quando a tela abre.
  // (o que ficou guardado no aparelho sobe por subirPendentes, um envio só por vez: ver app/diagpartes.js)

  // Ao trocar de placa, recupera o que foi marcado naquele carro e o que ele respondeu da última vez.
  useEffect(() => {
    setEscolha(obd.escolhaGuardada(guardado("leituras")));
    setAntesApagados(null);
    if (placa && podeApagar) carregarAnteriores();
  }, [placa]);
  // O que o carro tem: a lista que ELE respondeu manda. Enquanto não há conexão, vale a da última
  // vez (só para o mecânico já poder marcar o que quer antes de encaixar o adaptador).
  const antesDeLigar = guardado("suportados");
  // Conectado mas com lista vazia (o módulo não respondeu o 0100) NÃO é "a lista deste carro": seria o
  // catálogo inteiro passando por lista do carro, e aí apareceria EGR em carro que não tem.
  const listaDoCarro = !!(lig && Array.isArray(lig.pidsSuportados) && lig.pidsSuportados.length);
  const suportados = (listaDoCarro && lig.pidsSuportados) || (Array.isArray(antesDeLigar) && antesDeLigar.length ? antesDeLigar : null);
  const combustivel = (pl.veic && (pl.veic.combustivel || pl.veic.combustivel_descricao)) || "";
  const gruposDoCarro = obd.gruposPara(suportados, combustivel);
  const disponiveis = obd.leiturasPara(suportados, null);
  // Os PIDs que valem agora: null quando é "todas" (sem filtro nenhum).
  const escolhidas = obd.pidsDaEscolha(escolha, suportados, combustivel);
  const valendo = obd.leiturasPara(suportados, escolhidas);

  const guardarEscolha = e => { setEscolha(e); guardado("leituras", e); };
  // Marcar ou desmarcar uma leitura parte do que está na tela AGORA (padrão ou todas) e vira escolha à mão.
  const marcar = (pid, marcado) => {
    const base = valendo.map(l => l.pid);
    const nova = marcado ? base.concat([pid]).filter((x, i, a) => a.indexOf(x) === i) : base.filter(x => x !== pid);
    const todas = nova.length === disponiveis.length && disponiveis.every(l => nova.includes(l.pid));
    guardarEscolha(todas ? { modo: "todas", pids: [] } : { modo: "escolha", pids: nova });
  };
  const marcarTodas = () => guardarEscolha({ modo: "todas", pids: [] });
  const marcarPadrao = () => guardarEscolha({ modo: "padrao", pids: [] });

  async function rodar(aviso, fn) {
    setErro(""); setOcupado(aviso);
    // Esta tela fala OBD-II genérico. Se a pessoa veio de Módulos com o ABS (ou outro) apontado, o
    // adaptador ainda está com o endereço e o filtro dele: solta antes, senão o pedido vai ao módulo errado.
    // E não fala por cima de uma ação em curso (atuador, aprendizado, gravação): os pedidos se misturariam
    // aos dela, no módulo dela. soltarModulo() não espera ação — por isso a recusa é aqui.
    if (sessao.estado().acaoCorrendo) { setOcupado(""); setErro("O adaptador está ocupado com uma ação em outro módulo (atuador, aprendizado ou gravação). Espere terminar."); return; }
    try { await sessao.soltarModulo(); await fn(); } catch (e) { setErro(obd.motivoDe(e)); } finally { setOcupado(""); }
  }

  const procurar = () => rodar("Procurando o adaptador…", async () => {
    const p = await obd.permissao();
    if (!p.concedida) {
      const q = await obd.pedirPermissao();
      if (!q.concedida) throw new Error("sem-permissao");
    }
    const lista = await obd.listar();
    setAparelhos(lista);
  });

  const ligar = ap => rodar("Conectando em " + ap.nome + "…", async () => {
    const st = await sessao.ligar({ endereco: ap.endereco, nome: ap.nome });
    if (st.erro) throw new Error(st.erro);
    if (placa && st.pidsSuportados && st.pidsSuportados.length) guardado("suportados", st.pidsSuportados);
    setRes(null); setVivo(null); setFalhasVivo(null);
  });

  const desligar = () => rodar("Desconectando…", async () => {
    rodada.current = 0;
    await sessao.desligar();
    setRes(null); setAparelhos(null); setVivo(null); setFalhasVivo(null);
  });

  // Guardar uma leitura TROCA o que está na tela: é o "uma de cada vez". E qualquer leitura nova
  // para a roda antes, porque o adaptador atende um pedido por vez.
  const guardar = (o, d) => { setVivo(null); setRes({ o, d }); };
  const pararVivo = () => { rodada.current = 0; };

  const lerFalhas = () => { pararVivo(); return rodar("Lendo as falhas…", async () => {
    const f = await obd.lerFalhas();
    setFalhasVivo(null);                                            // já está na tela: o aviso cumpriu o papel
    guardar("falhas", f);
  }); };
  async function alternarVivo(modo = "todos") {
    if (rodada.current) {                                           // tocar de novo para parar…
      const mesmo = vivo && vivo.modo === modo;
      rodada.current = 0;
      if (mesmo) return;                                            // …mas trocar de modo recomeça
      await new Promise(r => setTimeout(r, 120));
    }
    if (sessao.estado().acaoCorrendo) { setErro("O adaptador está ocupado com uma ação em outro módulo (atuador, aprendizado ou gravação). Espere terminar."); return; }
    await sessao.soltarModulo();                                    // idem: o ao vivo é OBD-II genérico
    const minha = ++contador.current;
    rodada.current = minha;
    setErro("");
    setRes(null);                                                   // uma leitura por vez na tela
    historia.current = {};
    // Trocar de modo com uma leitura em curso: o resumo do que já foi lido é guardado ANTES de a
    // sessão nova tomar o lugar (senão as amostras anteriores sumiam sem registro).
    const anterior = sessaoCmp.current; sessaoCmp.current = null;
    if (anterior && placa) { const h = compara.resumo(anterior); if (h) registrarAcao("sessao", perfil, h, undefined, Object.assign({}, sessao.carro())).catch(() => {}); }
    sessaoCmp.current = compara.novaSessao(); setComparado(null);
    setVivo({ valores: {}, volta: 0, rodando: true, modo });
    // Referência das falhas: o que já estava gravado quando a roda começou. Só o que aparecer
    // DEPOIS disso é "falha nova". Sem leitura de falhas antes, a primeira olhada vira a referência.
    baseFalhas.current = res && res.o === "falhas"
      ? res.d.falhas.filter(f => f.situacao === "atual").map(f => f.codigo)
      : null;
    setFalhasVivo(null);
    try {
      await obd.lerAoVivoSeguido(
        lig.pidsSuportados,
        (v, volta) => { if (rodada.current === minha) { grafico.anotarPonto(historia.current, v); if (sessaoCmp.current) compara.anotar(sessaoCmp.current, v); } if (rodada.current === minha) setVivo(x => ({ valores: Object.assign({}, (x && x.valores) || {}, { [v.chave]: v }), volta, rodando: true, modo })); },
        () => rodada.current === minha,
        {
          escolhidos: modo === "combustivel" ? obd.PIDS_COMBUSTIVEL : escolhidas,
          aoFalhas: codigos => {
            if (rodada.current !== minha) return;
            if (baseFalhas.current === null) baseFalhas.current = codigos.slice();
            setFalhasVivo({ codigos, novas: codigos.filter(c => !baseFalhas.current.includes(c)) });
          },
        },
      );
    } catch (e) {
      if (rodada.current === minha) setErro(obd.motivoDe(e));
    } finally {
      if (rodada.current === minha) rodada.current = 0;              // não desliga a roda de outra rodada
      setVivo(x => (x && x.rodando && !rodada.current ? Object.assign({}, x, { rodando: false }) : x));
    }
  }
  /* ---- Apagar a falha, com registro (v62) ----
   * A ordem importa: lê o que está lá, lê o ajuste de combustível, apaga, e lê os dois de novo. O "depois"
   * é o que dá valor ao registro: mostra se o código voltou na hora (defeito acontecendo agora) e o módulo
   * recomeçando a aprender o combustível do zero. */
  const abrirApagar = () => { pararVivo(); return rodar("Lendo o que está gravado…", async () => {
    const f = await obd.lerFalhas();
    const comb = await obd.lerCombustivelRapido(lig.pidsSuportados);
    setRes(null); setVivo(null);
    setApagar({ passo: "confirmar", km: "", antes: f.falhas, comb });
  }); };
  const apagarAgora = () => rodar("Apagando as falhas…", async () => {
    const antes = apagar.antes || [], comb = apagar.comb || null, km = apagar.km;
    const r = await obd.apagarFalhas();
    if (!r.ok) { setApagar(a => Object.assign({}, a, { passo: "confirmar", erro: r.erro })); return; }
    // o módulo precisa de um instante para refazer a lista antes de valer a pena perguntar de novo
    await new Promise(x => setTimeout(x, 1500));
    let depois = null, combDepois = null;
    try { depois = (await obd.lerFalhas()).falhas; } catch (e) { depois = null; }
    try { combDepois = await obd.lerCombustivelRapido(lig.pidsSuportados); } catch (e) { combDepois = null; }
    const chassi = await obd.lerChassi().catch(() => "");
    if (chassi) sessao.definirCarro({ vin: chassi });
    const registro = obd.registroApagar({
      perfil_id: perfil.id, perfil_nome: perfil.nome,
      placa, veiculo_id: (v && v.id) || null, km, vin: chassi,
      antes, depois, combustivel: comb, combustivel_depois: combDepois,
      leituras: vivo ? Object.keys(vivo.valores).map(k => vivo.valores[k]) : [],
    });
    let gravado = "";
    try { await api.obd.registrar(registro); gravado = "ok"; }
    catch (e) { gravado = e.message || "não deu para registrar"; guardarPendente(registro); }
    setApagar({ passo: "feito", antes, comb, depois, combDepois, km, resultado: obd.resultadoApagar(antes, depois), gravado });
    setFalhasVivo(null); baseFalhas.current = null;
    if (placa) carregarAnteriores();
  });
  // Apagou e a internet caiu na hora de registrar: o registro fica guardado no aparelho e sobe sozinho na
  // próxima vez que a tela abrir com internet. Apagamento sem registro é exatamente o que não pode sobrar.
  const guardarPendente = reg => {
    try {
      const l = JSON.parse(window.localStorage.getItem("obd_pendentes") || "[]");
      l.push(Object.assign({ guardado_em: new Date().toISOString() }, reg));
      // mesma fila e mesmo limite de js/obdregistro.js (80): cortar em 20 aqui apagava laudos e gravações de bico à espera
      window.localStorage.setItem("obd_pendentes", JSON.stringify(l.slice(-80)));
    } catch (e) { /* sem espaço: o aviso na tela é o que resta */ }
  };
  const carregarAnteriores = async () => {
    try { setAntesApagados(await api.obd.listar({ placa, tipo: "apagar", limite: 5 })); } catch (e) { setAntesApagados(null); }
  };

  const lerFoto = () => { pararVivo(); return rodar("Lendo a foto da falha…", async () => guardar("foto", await obd.lerFoto(lig.pidsSuportados))); };
  const lerTestes = () => { pararVivo(); return rodar("Lendo os testes de bordo…", async () => guardar("testes", await obd.lerTestes())); };
  const lerCilindros = () => { pararVivo(); return rodar("Contando falha por cilindro…", async () => guardar("cilindros", await obd.lerFalhaCilindros(param.limites()))); };
  // SERVIÇOS AVANÇADOS (20/11/2026): calibração do módulo, teste drive e contadores de uso.
  // Tudo leitura, tudo pelo mesmo adaptador genérico — nada aqui precisa de APK novo.
  const lerCalib = () => { pararVivo(); return rodar("Lendo a calibração do módulo…", async () => {
    const c = await obd.lerCalibracao();
    const antes = guardado("calib");
    const comparado = obd.compararCalibracao(antes, c);
    if (c.cvn.length) guardado("calib", { calid: c.calid, cvn: c.cvn, em: new Date().toISOString() });
    guardar("calib", Object.assign({}, c, { comparado, antes }));
  }); };
  const lerCiclo = () => { pararVivo(); return rodar("Lendo os monitores deste ciclo…", async () => {
    const ciclo = await obd.lerMonitoresCiclo();
    let desde = null;
    try { desde = await obd.lerMonitores(); } catch (e) { desde = null; }
    guardar("ciclo", { ciclo, desde });
  }); };
  const lerContadores = () => { pararVivo(); return rodar("Lendo os contadores de uso…", async () => {
    const diesel = obd.tipoDeMotor(combustivel) === "diesel" || obd.tipoPeloModulo(suportados) === "diesel";
    guardar("contadores", await obd.lerContadores(diesel));
  }); };
  const lerConf = () => { pararVivo(); return rodar("Lendo chassi, monitores e odômetro…", async () => {
    const monitores = await obd.lerMonitores();
    const chassi = await obd.lerChassi();
    if (chassi) sessao.definirCarro({ vin: chassi });
    const odometro = await obd.lerOdometro(lig.pidsSuportados);
    guardar("conf", { monitores, chassi, odometro, conferencia: confere.conferir({ avisoAdaptador: lig.aviso, versao: lig.versao, vinLido: chassi, chassiCadastro }) });
  }); };

  useEffect(() => {
    let vivoAqui = true; setAnteriores([]);
    if (!placa) return undefined;
    api.obd.listar({ placa, tipo: "sessao", limite: 8 }).then(l => { if (vivoAqui) setAnteriores((l || []).map(x => x.dados).filter(Boolean)); }).catch(() => {});
    return () => { vivoAqui = false; };
  }, [placa]);
  // A roda parou: fecha o resumo, compara com as leituras anteriores DESTE carro e guarda sozinho.
  const rodandoAgora = !!(vivo && vivo.rodando);
  // Saiu da tela com a leitura ao vivo ainda rodando: o resumo é guardado na saída (uma vez só —
  // quem guarda zera sessaoCmp, então o efeito de baixo e esta limpeza nunca gravam os dois).
  const placaRef = useRef(placa); placaRef.current = placa;
  useEffect(() => () => {
    const s = sessaoCmp.current; sessaoCmp.current = null;
    if (!s || !placaRef.current) return;
    const hoje = compara.resumo(s);
    if (hoje) registrarAcao("sessao", perfil, hoje).catch(() => {});
  }, []);
  useEffect(() => {
    if (rodandoAgora || !sessaoCmp.current) return;
    const s = sessaoCmp.current; sessaoCmp.current = null;
    const hoje = compara.resumo(s);
    if (!hoje) { setComparado({ pouco: true }); return; }
    if (!placa) { setComparado({ semPlaca: true }); return; }
    const carroDaLeitura = Object.assign({}, sessao.carro());       // antes de esperar: a placa pode mudar no meio
    (async () => {
      let ant = [];
      try { ant = (await api.obd.listar({ placa, tipo: "sessao", limite: 6 })).map(l => l.dados).filter(Boolean); } catch (e) { ant = []; }
      const c = compara.comparar(hoje, ant);
      const guardou = await registrarAcao("sessao", perfil, hoje, undefined, carroDaLeitura);
      setComparado({ achados: c.achados, sessoes: c.sessoes, guardou });
    })();
  }, [rodandoAgora]);

  // LAUDO (Etapa 3): lê de novo o que importa, monta o conteúdo, sela com SHA-256 e guarda. Depois de
  // guardado ninguém altera: a tabela não tem alteração e o selo denuncia qualquer mudança.
  const gerarLaudo = () => { const leituras = vivo ? Object.keys(vivo.valores).map(k => vivo.valores[k]).filter(l => typeof l.valor === "number") : []; pararVivo(); return rodar("Montando o laudo…", async () => {
    const f = await obd.lerFalhas();
    let monitores = null, chassi = "", odometro = null;
    try { monitores = await obd.lerMonitores(); } catch (e) { monitores = null; }
    try { chassi = await obd.lerChassi(); } catch (e) { chassi = ""; }
    try { odometro = await obd.lerOdometro(lig.pidsSuportados); } catch (e) { odometro = null; }
    if (chassi) sessao.definirCarro({ vin: chassi });
    const carro = Object.assign({}, sessao.carro(), { vin: chassi || sessao.carro().vin || "" });
    const conferencia = confere.conferir({ avisoAdaptador: lig.aviso, versao: lig.versao, vinLido: chassi, chassiCadastro });
    const explicacoes = await falhasCat.explicarTodos(f.falhas, carro);
    const separado = f.porModulo && f.porModulo.length > 1;
    const dados = laudo.montar({ carro, quem: perfil, oficina: (cfg && cfg.nome) || "", km: typeof odometro === "number" ? odometro : (odometro && odometro.km) || null, conferencia,
      modulos: separado ? f.porModulo.map(m => ({ nome: m.nome, endereco: m.endereco, falhas: m.falhas.map(x => ({ codigo: x.codigo, situacao: SELO_DTC[x.situacao][0] })) })) : [],
      falhasJuntas: separado ? [] : f.falhas.map(x => ({ codigo: x.codigo, situacao: SELO_DTC[x.situacao][0] })), monitores, odometro, leituras, explicacoes, erros: f.erros || [] });
    const selo = await registro.selar(dados);
    const linha = registro.linha("laudo", perfil, carro, dados, { km: dados.km, codigos: f.falhas });
    linha.selo = selo;
    const g = await registro.guardar(api.obd.registrar, registro.cofreDe(window.localStorage), linha);
    guardar("laudo", { dados, selo, gravado: g.gravado ? "Laudo guardado no banco." : g.pendente ? "Laudo guardado no aparelho: sobe sozinho quando o banco aceitar (sem internet, ou falta rodar o supabase/v63.sql)." : "NÃO deu para guardar o laudo: gere o PDF agora." });
  }); };
  const pdfDoLaudo = async () => {
    try { await garantirJsPDF(); const b = pdfLaudo(res.d.dados, res.d.selo, cfg || {}); await entregarArquivo(b, "laudo-" + (res.d.dados.carro.placa || "carro") + "-" + res.d.selo.slice(0, 8) + ".pdf"); }
    catch (e) { setErro((e && e.message) || "Não deu para gerar o PDF."); }
  };

  // UMA TELA POR VEZ (pedido do Danilo, 21/11/2026): abriu as falhas, só as falhas na tela; abriu os
  // dados ao vivo, só eles; pôs o gráfico, só o gráfico. O menu de leituras vira uma tira de abas no
  // alto, e o resto (placa, adaptador, avisos de outras leituras) sai da frente até voltar.
  // TELA LIMPA (pedido do Danilo, 21/11/2026, depois de usar no carro): no menu ficam só as três leituras
  // do dia a dia; o resto fica guardado dentro de um botão e abre ao toque. Com uma leitura aberta (foco)
  // tudo volta a aparecer na tira de abas, para trocar de leitura sem voltar ao menu.
  const [aberto, setAberto] = useState({ mais: false, avancado: false, outros: false, adaptador: false });
  const abrirGrupo = k => setAberto(x => ({ ...x, [k]: !x[k] }));
  const foco = !!(res || vivo || apagar);
  const vistaAtual = apagar ? "apagar" : vivo ? (vivo.modo === "combustivel" ? "combustivel" : "vivo") : res ? res.o : "";
  const sairDoFoco = () => { pararVivo(); setRes(null); setVivo(null); setApagar(null); setAbrirEscolha(false); };
  usarPasso(foco, sairDoFoco);

  const v = pl.veic;
  // O carro da vez sobe para a sessão: as outras telas do diagnóstico (módulos, atuadores…) passam
  // a saber a marca sem pedir a placa de novo.
  // Só publica o que foi escolhido AQUI. Entrar nesta tela sem placa não pode apagar o carro que
  // Módulos ou Programar bico já tinham identificado; limpar a placa depois de escolher, sim.
  const publicouCarro = useRef(false);
  useEffect(() => {
    if (!placa && !publicouCarro.current) return;
    publicouCarro.current = true;
    sessao.definirCarro({ placa, marca: (v && v.marca) || "", modelo: (v && v.modelo) || "", ano: (v && v.ano) || "", veiculo_id: (v && v.id) || null });
  }, [placa, v && v.id, ses.ligado]);
  // o chassi do cadastro vem da ficha do veículo (a busca por placa não carrega esse campo)
  const noBanco = v && v.id ? dados.veiculos.find(x => x.id === v.id) : null;
  const chassiCadastro = String((noBanco && noBanco.chassi) || (v && v.chassi) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  const botoesAvancados = html`
        <button type="button" class="btn-barra claro" id="obd-conf" onClick=${lerConf}>CHASSI, MONITORES E ODÔMETRO</button>
        <button type="button" class="btn-barra claro" id="obd-laudo" onClick=${gerarLaudo}>LAUDO DO CARRO (SELADO)</button>
        <button type="button" class="btn-barra claro" id="obd-calib" onClick=${lerCalib}>CALIBRAÇÃO DO MÓDULO (REPROGRAMAÇÃO)</button>
        <button type="button" class="btn-barra claro" id="obd-ciclo" onClick=${lerCiclo}>TESTE DRIVE: MONITORES DESTE CICLO</button>
        <button type="button" class="btn-barra claro" id="obd-contadores" onClick=${lerContadores}>CONTADORES DE USO DOS MONITORES</button>
`;
  return html`<${Tela} tela="obd" ajuda="Encaixe o adaptador na tomada do carro, ligue a ignição (chave na posição 2) e conecte. O app lê o módulo do MOTOR: códigos de falha, dados ao vivo, chassi, prontidão dos monitores, a foto do momento da falha e os testes de bordo. ABS, airbag e câmbio não saem por aqui: isso continua no scanner da oficina. Nesta etapa nada é gravado e nenhuma falha é apagada.">

    ${!temPlugin ? html`<${Cartao} titulo="Precisa do APK novo">
      <p class="nota" style="font-size:13.5px">A leitura OBD é a primeira coisa do app que depende de uma parte nativa: o Bluetooth do adaptador não existe dentro das telas do site. Gere o APK novo em GitHub › Actions › "App DTCar (gerar APK)", desinstale o app antigo do celular e instale o novo. Depois disso as telas voltam a chegar sozinhas, como sempre.</p>
    </${Cartao}>` : null}

    ${temPlugin ? html`<div class=${foco ? "obd-tela obd-foco" + (vivo && jeito === "grafico" ? " obd-so-grafico" : "") : "obd-tela"} id="obd-tela" data-vista=${vistaAtual}>
      ${foco ? html`<button type="button" class="foco-voltar" id="obd-voltar-menu" onClick=${sairDoFoco}>‹ Todas as leituras</button>` : null}
      <${BuscaPlaca} id="obd-placa" titulo="Placa do carro (opcional)" pl=${pl} />
      ${v ? html`<${Veiculo} v=${v} />` : null}

      <${Cartao} titulo="Adaptador" id="obd-adaptador">
        ${!lig ? html`
          <p class="nota" style="margin-bottom:8px">Encaixe o adaptador na tomada do carro e ligue a ignição (chave na posição 2). Com o motor desligado e a chave fora, o módulo não responde.</p>
          <button type="button" class="btn-barra" id="obd-procurar" onClick=${procurar} disabled=${!!ocupado}><${Ic} n="obd" t=${22} />PROCURAR ADAPTADOR</button>
          ${aparelhos && !aparelhos.length ? html`<div class="vazio">Nenhum aparelho pareado. Pareie o adaptador uma vez nos Ajustes do Android (Bluetooth) e volte aqui.</div>` : null}
          ${aparelhos && aparelhos.length ? html`<div class="sec"><h3>Aparelhos pareados</h3>
            ${aparelhos.map(ap => html`<button key=${ap.endereco} type="button" class="obd-ap" onClick=${() => ligar(ap)} disabled=${!!ocupado}>
              <b>${ap.nome}</b><span>${ap.endereco}</span></button>`)}
            <div class="nota">Toque no seu adaptador para conectar.</div></div>` : null}
        ` : html`
          <button type="button" class="btn-barra claro" id="obd-adaptador-abrir" aria-expanded=${aberto.adaptador} onClick=${() => abrirGrupo("adaptador")}>
            <span class="selo">CONECTADO</span>${lig.nome}</button>
          ${lig.aviso ? html`<div class="erro" id="obd-clone">${lig.aviso}</div>` : null}
          ${aberto.adaptador ? html`
            ${lig.protocolo ? html`<${KV} a="Protocolo" b=${lig.protocolo} p />` : null}
            ${lig.versao ? html`<${KV} a="Adaptador" b=${lig.versao} p />` : null}
            <button type="button" class="btn-barra claro" id="obd-desligar" style="justify-content:center" onClick=${desligar} disabled=${!!ocupado}>DESCONECTAR</button>` : null}
        `}
      </${Cartao}>

      ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
      ${erro ? html`<div class="erro">${erro}</div>` : null}

      ${lig && !ocupado ? html`<${Cartao} titulo="Ler do carro" id="obd-acoes">
        <button type="button" class=${"btn-barra" + (vivo && vivo.rodando && vivo.modo === "combustivel" ? " claro" : "")} id="obd-combustivel" onClick=${() => alternarVivo("combustivel")}>
          <${Ic} n="obd" t=${22} />${vivo && vivo.rodando && vivo.modo === "combustivel" ? "PARAR A LEITURA DE COMBUSTÍVEL" : "LEITURA DE COMBUSTÍVEL"}</button>
        <button type="button" class=${"btn-barra" + (vivo && vivo.rodando && vivo.modo !== "combustivel" ? " claro" : "")} id="obd-vivo" onClick=${() => alternarVivo("todos")}>
          ${vivo && vivo.rodando && vivo.modo !== "combustivel" ? "PARAR OS DADOS AO VIVO" : "DADOS AO VIVO"}</button>
        <button type="button" class=${"btn-barra" + (falhasVivo && falhasVivo.codigos.length ? " alerta" : "")} id="obd-falhas" onClick=${lerFalhas}>
          ${falhasVivo && falhasVivo.novas.length ? "FALHA NOVA AGORA (" + falhasVivo.novas.length + ") · VER"
            : falhasVivo && falhasVivo.codigos.length ? "FALHA NO MÓDULO (" + falhasVivo.codigos.length + ") · VER"
            : "LER FALHAS"}</button>
        ${!foco ? html`<button type="button" class="btn-barra claro" id="obd-mais-abrir" aria-expanded=${aberto.mais} onClick=${() => abrirGrupo("mais")}>MAIS LEITURAS</button>` : null}
        ${foco || aberto.mais ? html`
        <button type="button" class="btn-barra claro" id="obd-foto" onClick=${lerFoto}>FOTO DO MOMENTO DA FALHA</button>
        <button type="button" class="btn-barra claro" id="obd-cilindros" onClick=${lerCilindros}>FALHA POR CILINDRO</button>
        <button type="button" class="btn-barra claro" id="obd-testes" onClick=${lerTestes}>TESTES DE BORDO</button>
        ${podeApagar ? html`<button type="button" class="btn-barra apagar" id="obd-apagar" onClick=${abrirApagar}>APAGAR FALHAS (FICA REGISTRADO)</button>` : null}` : null}
        ${!foco ? html`<button type="button" class="btn-barra claro" id="obd-avancado-abrir" aria-expanded=${aberto.avancado} onClick=${() => abrirGrupo("avancado")}>SERVIÇOS AVANÇADOS</button>` : null}
        ${!foco && aberto.avancado ? html`${botoesAvancados}
          <button type="button" class="btn-barra claro" id="obd-ir-parametros" onClick=${() => ir("parametros")}>PARÂMETROS DE REFERÊNCIA</button>` : null}
        ${!foco && outrasTelas.length ? html`<button type="button" class="btn-barra claro" id="obd-outros-abrir" aria-expanded=${aberto.outros} onClick=${() => abrirGrupo("outros")}>OUTROS MÓDULOS</button>` : null}
        ${!foco && aberto.outros ? outrasTelas.map(o => html`<button key=${o.r} type="button" class="btn-barra claro" id=${"obd-ir-" + o.r} onClick=${() => ir(o.r)}>${o.rotulo}</button>`) : null}
        <div class="nota">${falhasVivo && falhasVivo.novas.length ? "Apareceu código com o motor trabalhando. Toque no botão vermelho para ver quais."
          : vivo && vivo.rodando ? "Pedir outra leitura para os dados ao vivo: o adaptador atende um pedido por vez."
          : ""}</div>
      </${Cartao}>` : null}

      ${lig && !ocupado && foco ? html`<${Cartao} titulo="Serviços avançados" id="obd-avancado">${botoesAvancados}</${Cartao}>` : null}

      ${/* Os parâmetros saíram daqui e viraram tela (20/11/2026): eram um cartão para abrir e fechar
            no meio da leitura, e é o que se consulta para discutir um laudo — merece tela própria.
            Aqui fica só o caminho, para quem está lendo o carro e quer conferir a referência. */
        !ocupado && (!lig || foco) ? html`<button type="button" class="btn-barra claro" id="obd-ir-parametros" onClick=${() => ir("parametros")}>
          <${Ic} n="sliders" t=${20} />VER OS PARÂMETROS DE REFERÊNCIA</button>` : null}

      ${lig && !ocupado && disponiveis.length && (foco || aberto.avancado) ? html`<${Cartao} titulo="Quais leituras mostrar" id="obd-escolha">
        <button type="button" class="btn-barra claro" id="obd-escolher" onClick=${() => setAbrirEscolha(x => !x)}>
          ${(abrirEscolha ? "FECHAR A ESCOLHA" : "ESCOLHER LEITURAS") + " (" + valendo.length + " de " + disponiveis.length + ")"}</button>
        ${abrirEscolha ? html`
          <div class="obd-filtro" role="group" aria-label="Quais leituras ficam na tela">
            <button type="button" id="obd-padrao" class=${escolha.modo === "padrao" ? "esc" : ""} aria-pressed=${escolha.modo === "padrao"} onClick=${marcarPadrao}>SÓ AS PADRÃO</button>
            <button type="button" id="obd-todas" class=${escolha.modo === "todas" ? "esc" : ""} aria-pressed=${escolha.modo === "todas"} onClick=${marcarTodas}>TODAS DO CARRO</button>
          </div>
          <div class="nota">${escolha.modo === "padrao" ? "Na tela estão as leituras padrão, as que se olha primeiro em qualquer carro. Marque abaixo para acrescentar as outras."
            : escolha.modo === "todas" ? "Na tela estão TODAS as que este carro tem. Quanto mais leitura, mais devagar cada uma atualiza."
            : "Você escolheu à mão o que fica na tela."}</div>
          ${gruposDoCarro.map(g => html`<div key=${g.id} class="sec"><h3>${g.nome}</h3>
            ${g.leituras.map(l => html`<label key=${l.pid} class="obd-cx">
              <input type="checkbox" data-pid=${l.pid} checked=${!escolhidas || escolhidas.includes(l.pid)}
                onChange=${e => marcar(l.pid, e.target.checked)} />
              <span>${l.rotulo}${l.unidade ? " (" + l.unidade + ")" : ""}</span></label>`)}
          </div>`)}
          <div class=${listaDoCarro ? "nota" : "erro"}>${listaDoCarro
            ? "A lista acima é a que ESTE carro respondeu agora: o que ele não tem não aparece aqui, por mais que o modelo costume ter."
            : (Array.isArray(antesDeLigar) && antesDeLigar.length
              ? "Esta é a lista que este carro respondeu da ÚLTIMA vez. Conecte para ela valer de novo."
              : "Ainda não sei o que este carro tem: esta é a lista GERAL do OBD, não a dele. Conecte o adaptador e ela vira a deste carro — aí some o que ele não tiver.")}${placa ? " A escolha fica guardada para a placa " + placa + "." : " A escolha fica guardada neste aparelho."}</div>
        ` : null}
      </${Cartao}>` : null}

      ${res && res.o === "cilindros" ? html`<${Cartao} titulo="Falha de combustão por cilindro" id="obd-r-cilindros">
        ${!res.d.cilindros ? html`<div class="vazio">Este módulo não publica a contagem por cilindro.${res.d.erro ? " (" + res.d.erro + ")" : ""}</div>` : html`
          <div class="kv"><span>Situação:</span><i></i><b><span class=${"selo " + (res.d.cilindros.situacao === "limpo" ? "" : res.d.cilindros.situacao === "um_cilindro" ? "ruim" : "atencao")}>${
            res.d.cilindros.situacao === "limpo" ? "NENHUMA" : res.d.cilindros.situacao === "um_cilindro" ? "CILINDRO " + res.d.cilindros.destacado.cilindro : "ESPALHADA"}</span></b></div>
          <div class="cil-lista">
            ${(() => {
              const maior = Math.max.apply(null, res.d.cilindros.cilindros.map(c => (typeof c.ciclo === "number" ? c.ciclo : c.media)).concat([1]));
              return res.d.cilindros.cilindros.map(c => {
                const n = typeof c.ciclo === "number" ? c.ciclo : c.media;
                const destaque = res.d.cilindros.destacado && res.d.cilindros.destacado.cilindro === c.cilindro;
                return html`<div key=${c.cilindro} class=${"cil-linha" + (destaque ? " pior" : "")} data-cilindro=${c.cilindro}>
                  <span class="cil-nome">Cilindro ${c.cilindro}</span>
                  <div class="cil-barra"><i style=${"width:" + Math.max(2, Math.round((n / maior) * 100)) + "%"}></i></div>
                  <b class="cil-num">${numBR(n)}</b>
                </div>`;
              });
            })()}
          </div>
          ${res.d.cilindros.cilindros.some(c => typeof c.media === "number" && typeof c.ciclo === "number") ? html`<div class="nota">Número grande = falhas neste ciclo de condução. A média dos últimos 10 ciclos está nos detalhes abaixo.</div>` : null}
          ${res.d.cilindros.frases.map(f => html`<p key=${f} class="cil-frase">${f}</p>`)}
          <ul class="apg-avisos">${res.d.cilindros.avisos.map(a => html`<li key=${a}>${a}</li>`)}</ul>
          ${obd.avisoMidDaMarca(v && v.marca) ? html`<div class="erro" id="obd-aviso-gm">${obd.avisoMidDaMarca(v.marca)}</div>` : null}
          <div class="sec"><h3>Como o módulo respondeu</h3>
            ${res.d.testes.map(t => html`<div key=${t.mid + "-" + t.tid} class="kv"><span>${t.nome}${t.teste ? " · " + t.teste : ""}</span><i></i><b>${numBR(t.valor)}${t.unidade ? " " + t.unidade : ""}</b></div>`)}
          </div>`}
      </${Cartao}>` : null}

      ${apagar && apagar.passo === "confirmar" ? html`<${Cartao} titulo="Apagar as falhas?" id="obd-apagar-cx">
        ${apagar.erro ? html`<div class="erro">${apagar.erro}</div>` : null}
        <div class="apg-antes">
          ${!apagar.antes.length ? html`<div class="vazio">Não há código gravado agora. Apagar vai zerar as adaptações e a prontidão do mesmo jeito.</div>`
            : html`<div class="nota" style="margin-bottom:6px">Vai apagar ${apagar.antes.length} código${apagar.antes.length === 1 ? "" : "s"}:</div>
              ${apagar.antes.map(f => html`<div key=${f.codigo + f.situacao} class="obd-dtc"><b>${f.codigo}</b><span class=${"selo " + SELO_DTC[f.situacao][1]}>${SELO_DTC[f.situacao][0]}</span></div>`)}`}
        </div>
        ${apagar.comb && apagar.comb.pior ? html`<div class="nota">Ajuste de combustível agora: ${numBR(apagar.comb.pior.total)}% — some com o apagamento e o módulo recomeça a aprender.</div>` : null}
        <ul class="apg-avisos">${obd.AVISOS_APAGAR.map(a => html`<li key=${a}>${a}</li>`)}</ul>
        <${Campo} id="obd-km" rotulo="KM do painel (ajuda no registro)">
          <input id="obd-km" class="inp" type="number" inputmode="numeric" value=${apagar.km}
            onInput=${e => setApagar(a => Object.assign({}, a, { km: e.target.value }))} /></${Campo}>
        <div class="nota">Fica registrado quem apagou, de qual carro, com que KM e quais códigos estavam lá. ${perfil.nome}, ${placa ? "placa " + placa : "sem placa informada"}.</div>
        <button type="button" class="btn-barra apagar" id="obd-apagar-ok" onClick=${apagarAgora}>APAGAR AGORA</button>
        <button type="button" class="btn-barra claro" id="obd-apagar-nao" style="justify-content:center" onClick=${() => setApagar(null)}>Não apagar</button>
      </${Cartao}>` : null}

      ${apagar && apagar.passo === "feito" ? html`<${Cartao} titulo="Falhas apagadas" id="obd-apagar-feito">
        <div class="kv"><span>Resultado:</span><i></i><b><span class=${"selo " + (apagar.resultado.situacao === "limpo" ? "" : apagar.resultado.situacao === "voltou" ? "ruim" : "atencao")}>${
          apagar.resultado.situacao === "limpo" ? "LIMPOU" : apagar.resultado.situacao === "voltou" ? "O CÓDIGO VOLTOU" : apagar.resultado.situacao === "sobrou" ? "SOBROU CÓDIGO" : "NÃO CONFERIDO"}</span></b></div>
        <div class="nota">${apagar.resultado.frase}</div>
        ${apagar.depois && apagar.depois.length ? html`<div class="sec"><h3>O que ficou no módulo</h3>
          ${apagar.depois.map(f => html`<div key=${f.codigo + f.situacao} class="obd-dtc"><b>${f.codigo}</b><span class=${"selo " + SELO_DTC[f.situacao][1]}>${SELO_DTC[f.situacao][0]}</span></div>`)}</div>` : null}
        ${apagar.comb && apagar.comb.pior ? html`<div class="kv"><span>Ajuste antes:</span><i></i><b>${numBR(apagar.comb.pior.total)}%</b></div>` : null}
        ${apagar.combDepois && apagar.combDepois.pior ? html`<div class="kv"><span>Ajuste depois:</span><i></i><b>${numBR(apagar.combDepois.pior.total)}%</b></div>` : null}
        ${apagar.combDepois ? html`<div class="nota">O módulo recomeçou a aprender: o ajuste só volta a dizer alguma coisa depois de o carro rodar. A prontidão dos monitores também zerou.</div>` : null}
        <div class=${apagar.gravado === "ok" ? "nota" : "erro"}>${apagar.gravado === "ok"
          ? "Registrado: " + perfil.nome + (placa ? " · " + placa : "") + (apagar.km ? " · " + apagar.km + " km" : "")
          : "APAGOU, MAS NÃO REGISTROU (" + apagar.gravado + "). O registro ficou guardado no celular e sobe sozinho quando este app abrir com internet."}</div>
        <button type="button" class="btn-barra claro" id="obd-apagar-fim" style="justify-content:center" onClick=${() => setApagar(null)}>Pronto</button>
      </${Cartao}>` : null}

      ${podeApagar && antesApagados && antesApagados.length && !apagar ? html`<${Cartao} titulo="Já foi apagado neste carro" id="obd-apagados">
        ${antesApagados.map(a => html`<div key=${a.id} class="kv"><span>${fmtData(a.criado_em)}</span><i></i><b>${a.perfil_nome || "—"}${a.km ? " · " + a.km + " km" : ""}${(a.codigos || []).length ? " · " + (a.codigos || []).map(c => c.codigo).join(", ") : ""}</b></div>`)}
        <div class="nota">Monitor que ainda não terminou e falha que "não existia" podem ser disto: o carro ainda não rodou o bastante depois do apagamento.</div>
      </${Cartao}>` : null}

      ${res && res.o === "falhas" ? html`<${Cartao} titulo=${(res.d.porModulo && res.d.porModulo.length > 1 ? "Falhas por módulo" : "Falhas do motor") + (res.d.falhas.length ? " (" + res.d.falhas.length + ")" : "")} id="obd-r-falhas">
        ${!res.d.falhas.length ? html`<div class="vazio">Nenhuma falha gravada no módulo do motor.</div>` : null}
        ${(res.d.porModulo && res.d.porModulo.length > 1 ? res.d.porModulo : [{ endereco: "", nome: "", falhas: res.d.falhas }]).map(m => html`<div key=${m.endereco} class=${m.nome ? "obd-mod" : ""} data-modulo=${m.endereco}>
          ${m.nome ? html`<h3 class="obd-mod-t">${m.nome}<span>${m.falhas.length ? m.falhas.length + (m.falhas.length === 1 ? " falha" : " falhas") : "sem falha gravada"}</span></h3>` : null}
          ${m.falhas.map(f => html`<div key=${f.codigo + f.situacao} class="obd-dtc-bloco"><div class="obd-dtc">
            <b>${f.codigo}</b><span class=${"selo " + SELO_DTC[f.situacao][1]}>${SELO_DTC[f.situacao][0]}</span></div>
            <${FalhaExplicada} e=${explicadas[f.codigo]} /></div>`)}
        </div>`)}
        ${res.d.falhas.length ? html`<${NotaDasFontes} />` : null}
        ${res.d.falhas.length ? html`<div class="nota">O código é o que o módulo gravou. ATUAL está confirmada, PENDENTE apareceu uma vez e ainda não confirmou, PERMANENTE só sai depois que o módulo refizer os testes.</div>` : null}
        ${res.d.variosModulos && res.d.porModulo && res.d.porModulo.length > 1 ? html`<div class="nota">Mais de um módulo respondeu: as falhas estão separadas por módulo. Só aparece quem respondeu.</div>` : null}
        ${res.d.variosModulos && !(res.d.porModulo && res.d.porModulo.length > 1) ? html`<div class="nota">Mais de um módulo do carro respondeu, mas este adaptador não deixou separar: a lista junta os códigos de todos.</div>` : null}
        ${res.d.erros.length ? html`<div class="nota">Não respondeu: ${res.d.erros.map(e => e.situacao + " (" + e.erro + ")").join("; ")}</div>` : null}
      </${Cartao}>` : null}

      ${vivo ? html`<${Cartao} titulo=${vivo.modo === "combustivel" ? "Combustível" : "Dados ao vivo"} id="obd-r-vivo">
        <div class="obd-vivo-topo">
          ${vivo.rodando ? html`<span class="selo vivo">AO VIVO</span><span class="nota">atualizando sem parar · ${vivo.volta} volta${vivo.volta === 1 ? "" : "s"}</span>`
            : html`<span class="selo atencao">PARADO</span><span class="nota">valores da última leitura · toque em DADOS AO VIVO para voltar a girar</span>`}
        </div>
        ${!Object.keys(vivo.valores).length ? html`<div class="carregando">${vivo.rodando ? "Lendo o motor…" : "O módulo não respondeu nenhum dado ao vivo."}</div>` : null}
        ${vivo.modo === "combustivel" && Object.keys(vivo.valores).length ? html`<${Combustivel} v=${vivo.valores} />` : null}
        ${(() => {
          const lidos = Object.keys(vivo.valores).map(k => vivo.valores[k]).sort((a, b) => obd.ordemDaLeitura(a) - obd.ordemDaLeitura(b));
          if (!lidos.length) return null;
          // em que regime o carro está AGORA, para escolher a faixa que se aplica
          const ag = k => (vivo.valores[k] && typeof vivo.valores[k].valor === "number" ? vivo.valores[k].valor : undefined);
          const estadoAgora = (sessaoCmp.current && sessaoCmp.current.estado) || { rpm: ag(0x0c * 100), velocidade: ag(0x0d * 100), temperatura: ag(0x05 * 100) };
          const ctxFaixa = { rpm: ag(0x0c * 100), regime: vivo.rodando ? compara.regimeDe(estadoAgora) : null, sessoes: anteriores, carro: { modelo: (v && v.modelo) || "", motor: (v && v.motor) || "" } };
          const fx = l => faixas.faixaPara(l, ctxFaixa);
          const comFaixa = lidos.filter(l => typeof l.de === "number");
          const resto = lidos.filter(l => typeof l.de !== "number");
          return html`
            <div class="obd-filtro" role="group" aria-label="Como mostrar os dados ao vivo">
              <button type="button" id="obd-jeito-lista" class=${jeito === "lista" ? "esc" : ""} aria-pressed=${jeito === "lista"} onClick=${() => trocarJeito("lista")}>LISTA</button>
              <button type="button" id="obd-jeito-painel" class=${jeito === "painel" ? "esc" : ""} aria-pressed=${jeito === "painel"} onClick=${() => trocarJeito("painel")}>PONTEIRO</button>
              <button type="button" id="obd-jeito-digital" class=${jeito === "digital" ? "esc" : ""} aria-pressed=${jeito === "digital"} onClick=${() => trocarJeito("digital")}>DIGITAL</button>
              <button type="button" id="obd-jeito-grafico" class=${jeito === "grafico" ? "esc" : ""} aria-pressed=${jeito === "grafico"} onClick=${() => trocarJeito("grafico")}>GRÁFICO</button>
            </div>
            ${jeito === "grafico" ? html`<${Grafico} lidos=${lidos} historia=${historia.current} escolha=${noGrafico} aoTrocar=${trocarGrafico} recusa=${graficoRecusa} faixaDe=${fx} />`
            : jeito === "digital" ? html`<div class="digitais">${lidos.map(l => html`<${Digital} key=${l.chave} l=${l} f=${fx(l)} />`)}</div>`
            : jeito === "painel" ? html`
              ${comFaixa.length ? html`<div class="painel-obd">${comFaixa.map(l => html`<${Mostrador} key=${l.chave} l=${l} f=${fx(l)} />`)}</div>` : null}
              ${resto.length ? html`<div class="painel-resto">${resto.map(l => html`<${LinhaViva} key=${l.chave} l=${l} f=${fx(l)} />`)}</div>` : null}`
            : html`<div class="lista-viva">
                ${obd.GRUPOS.map(g => {
                  const doGrupo = lidos.filter(l => obd.grupoDaLeitura(l) === g.id);
                  if (!doGrupo.length) return null;
                  return html`<div key=${g.id} class="lista-viva-grupo">
                    <h3>${g.nome}</h3>
                    ${doGrupo.map(l => html`<${LinhaViva} key=${l.chave} l=${l} f=${fx(l)} />`)}
                  </div>`;
                })}
              </div>`}`;
        })()}
      </${Cartao}>` : null}

      ${res && res.o === "laudo" ? html`<${Cartao} titulo="Laudo do carro" id="obd-r-laudo">
        ${laudo.linhas(res.d.dados, "").map((l, i) => html`<div key=${i} class=${"laudo-" + l.t}>${l.x}</div>`)}
        <div class="laudo-selo" id="obd-laudo-selo"><b>SELADO</b> · ${res.d.selo.slice(0, 16)}…</div>
        <div class="nota">${res.d.gravado} Depois de guardado ninguém altera: o selo é a conta do conteúdo, e qualquer mudança faz ele deixar de conferir.</div>
        <button type="button" class="btn-barra" id="obd-laudo-pdf" style="justify-content:center" onClick=${pdfDoLaudo}><${Ic} n="share" t=${20} />PDF DO LAUDO (COMPARTILHAR OU BAIXAR)</button>
      </${Cartao}>` : null}

      ${comparado && !comparado.pouco ? html`<${Cartao} titulo="Este carro comparado com ele mesmo" id="obd-comparado">
        ${comparado.semPlaca ? html`<div class="nota">Busque a placa antes de ler: sem saber qual é o carro, a leitura não é guardada e não há com quem comparar.</div>` : html`
          ${comparado.sessoes < 2 ? html`<div class="nota">${comparado.sessoes === 0 ? "Primeira leitura guardada deste carro." : "Segunda leitura guardada deste carro."} A comparação começa na terceira: uma leitura só não é o normal de um carro.</div>` : null}
          ${comparado.sessoes >= 2 && !comparado.achados.length ? html`<div class="nota"><b>SEM MUDANÇA.</b> Em marcha lenta e em cruzeiro, com o motor quente, este carro marcou o mesmo que nas ${comparado.sessoes} leituras anteriores.</div>` : null}
          ${comparado.achados.map(a => html`<div key=${a.chave + a.regime} class="conf-item"><span class="selo atencao">MUDOU</span><div><b>${a.rotulo}</b> · ${compara.REGIMES[a.regime]}: hoje ${String(a.hoje).replace(".", ",")} ${a.unidade}; antes entre ${String(a.de).replace(".", ",")} e ${String(a.ate).replace(".", ",")}.<br />${a.texto}</div></div>`)}
          <div class="fx-origem">${comparado.guardou} Só entram na comparação as leituras com o motor quente, em marcha lenta ou em velocidade constante.</div>`}
      </${Cartao}>` : null}

      ${res && res.o === "calib" ? html`<${Cartao} titulo="Calibração do módulo" id="obd-r-calib">
        ${!res.d.calid.length && !res.d.cvn.length ? html`<div class="vazio">Este módulo não informa a calibração (serviço 09 $04/$06).${res.d.erro ? " " + res.d.erro : ""}</div>` : null}
        ${res.d.calid.map((c, i) => html`<${KV} key=${"ca" + i} a=${"Calibração" + (res.d.calid.length > 1 ? " " + (i + 1) : "")} b=${c} p />`)}
        ${res.d.cvn.map((c, i) => html`<${KV} key=${"cv" + i} a=${"CVN" + (res.d.cvn.length > 1 ? " " + (i + 1) : "")} b=${c} p />`)}
        ${res.d.comparado ? html`<div class=${res.d.comparado.situacao === "igual" ? "nota" : "erro"}>
          <b>${res.d.comparado.situacao === "igual" ? "SEM MUDANÇA" : "MUDOU"}</b> — ${res.d.comparado.frase}${res.d.antes && res.d.antes.em ? " (leitura anterior em " + fmtData(res.d.antes.em) + ")" : ""}</div>`
          : res.d.cvn.length ? html`<div class="nota">Primeira leitura deste carro: guardei a calibração${placa ? " da placa " + placa : ""} para comparar na próxima vez.</div>` : null}
        ${res.d.cvn.length ? html`<div class="nota">O CVN é a impressão digital do que está gravado no módulo: muda quando o módulo é reprogramado. <b>Não existe lista pública do CVN certo de cada carro</b> — a comparação só vale contra a leitura anterior deste mesmo carro. (Regra: CARB 13 CCR 1968.2.)</div>` : null}
      </${Cartao}>` : null}

      ${res && res.o === "ciclo" ? html`<${Cartao} titulo="Teste drive: monitores deste ciclo" id="obd-r-ciclo">
        <div class="kv"><span>Neste ciclo:</span><i></i><b>${res.d.ciclo.prontos} de ${res.d.ciclo.total} completos</b></div>
        ${res.d.ciclo.monitores.map(m => html`<div key=${m.nome} class="kv"><span>${m.nome}:</span><i></i><b>${m.pronto
          ? html`<span class="selo">COMPLETOU</span>`
          : html`<span class="selo atencao">NÃO RODOU AINDA</span>`}${res.d.desde ? (res.d.desde.monitores.find(x => x.nome === m.nome) || {}).pronto === true ? " · pronto desde o apagamento" : "" : ""}</b></div>`)}
        <div class="nota">Esta leitura zera a cada vez que a chave liga. Serve para <b>provar o reparo no test-drive</b>: conserte, rode o carro e veja o monitor fechar — sem precisar apagar nada.</div>
        <div class="nota">"Completou" não quer dizer "passou": o resultado está nas falhas e nos testes de bordo.</div>
      </${Cartao}>` : null}

      ${res && res.o === "contadores" ? html`<${Cartao} titulo="Contadores de uso dos monitores" id="obd-r-contadores">
        ${!res.d ? html`<div class="vazio">Este módulo não informa os contadores de uso (serviço 09 $08/$0B).</div>` : html`
          <${KV} a="Ciclos contados pelo módulo" b=${numBR(res.d.ciclos)} p />
          <${KV} a="Partidas" b=${numBR(res.d.ignicoes)} p />
          ${res.d.itens.map(i => html`<div key=${i.posicao} class="kv"><span>${i.nome}:</span><i></i><b>${
            i.razao === null ? "—" : html`${numBR(i.razao)}${i.razao < (param.limites().razao || obd.RAZAO_MINIMA) ? html` <span class="selo atencao">RODA POUCO</span>` : ""}`} <span class="sub">(${numBR(i.numerador)}/${numBR(i.denominador)})</span></b></div>`)}
          <div class="nota">Quantas vezes cada monitor rodou contra quantas vezes poderia ter rodado. Razão baixa explica o carro que "nunca fica pronto" para inspeção. A referência de 0,336 é a mínima exigida pela CARB e pela regra europeia — <b>é referência, não reprovação</b>.</div>
          <div class="nota">A ordem dos campos desta resposta foi conferida só em fonte secundária, então cada linha mostra também a posição. Confira o nome antes de pôr num laudo.</div>`}
      </${Cartao}>` : null}

      ${res && res.o === "conf" ? html`<${Cartao} titulo="Chassi, monitores e odômetro" id="obd-r-conf">
        ${res.d.conferencia ? html`<div class="sec" id="obd-conferencia"><h3>Esta leitura vale?</h3>
          <div class=${"conf-frase" + (res.d.conferencia.situacao === "ruim" ? " erro" : "")}>${res.d.conferencia.frase}</div>
          ${res.d.conferencia.itens.map(i => html`<div key=${i.chave} class="conf-item"><span class=${"selo" + (i.situacao === "ruim" ? " ruim" : i.situacao === "atencao" ? " atencao" : "")}>${i.situacao === "ok" ? "CONFERE" : i.situacao === "ruim" ? "NÃO VALE" : i.situacao === "atencao" ? "ATENÇÃO" : "SEM DADO"}</span><div><b>${i.titulo}.</b> ${i.texto}</div></div>`)}</div>` : null}
        ${res.d.chassi ? html`<${KV} a="Chassi lido no módulo" b=${res.d.chassi} p />` : html`<div class="nota">O módulo não informou o chassi (comum em carro mais antigo).</div>`}
        ${res.d.chassi && chassiCadastro ? html`<div class="kv"><span>Confronto:</span><i></i><b>${res.d.chassi === chassiCadastro
          ? html`<span class="selo">CONFERE</span>igual ao cadastro`
          : html`<span class="selo ruim">DIVERGE</span>cadastro: ${chassiCadastro}`}</b></div>` : null}
        ${(() => {
          // Odômetro do módulo contra o KM do cadastro (pedido do Danilo, 19/11/2026). Poucos carros publicam.
          if (res.d.odometro === null || res.d.odometro === undefined) return html`<div class="nota">Este módulo não publica o odômetro (a maioria não publica: o KM do painel não existe no OBD-II).</div>`;
          const conf = obd.conferirOdometro(res.d.odometro, noBanco && noBanco.km_atual);
          const ruim = conf && conf.situacao === "abaixo";
          return html`<div id="obd-odometro">
            <${KV} a="Odômetro do módulo" b=${fmtKm(res.d.odometro) + " km"} p />
            ${conf && conf.cadastro ? html`<div class="kv"><span>KM do cadastro:</span><i></i><b>${fmtKm(conf.cadastro)} km ${ruim ? html`<span class="selo ruim">CONFIRA</span>` : html`<span class="selo">BATE</span>`}</b></div>` : null}
            ${conf ? html`<div class=${ruim ? "erro" : "nota"}>${conf.frase}</div>` : null}
          </div>`;
        })()}
        <div class="kv"><span>Luz de injeção:</span><i></i><b>${res.d.monitores.luzAcesa ? html`<span class="selo ruim">ACESA</span>` : html`<span class="selo">APAGADA</span>`}${res.d.monitores.quantidade} código(s) no módulo</b></div>
        <div class="sec"><h3>Monitores de emissão (${res.d.monitores.prontos} de ${res.d.monitores.total} prontos)</h3>
          ${res.d.monitores.monitores.map(m => html`<div key=${m.nome} class="kv"><span>${m.nome}:</span><i></i><b>${m.pronto ? html`<span class="selo">PRONTO</span>` : html`<span class="selo atencao">NÃO PRONTO</span>`}</b></div>`)}
          ${res.d.monitores.prontos < res.d.monitores.total ? html`<div class="nota">Monitor não pronto quer dizer que o módulo foi zerado há pouco e ainda não terminou os próprios testes: a falha foi apagada antes de o carro chegar. Confira a distância desde o apagamento em "Dados ao vivo".</div>` : null}
          ${res.d.monitores.diesel ? html`<div class="nota">Motor a diesel: o padrão não define quais monitores existem além dos três de base, então só esses aparecem.</div>` : null}
        </div>
      </${Cartao}>` : null}

      ${res && res.o === "foto" ? html`<${Cartao} titulo="Foto do momento da falha" id="obd-r-foto">
        ${!res.d.length ? html`<div class="vazio">O módulo não guardou a foto do momento da falha.</div>` : null}
        ${res.d.map(l => html`<${KV} key=${l.chave} a=${l.rotulo} b=${numBR(l.valor) + (l.unidade ? " " + l.unidade : "")} />`)}
        ${res.d.length ? html`<div class="nota">Como o carro estava no instante em que a falha gravou: diz se deu com o motor frio, em carga ou em marcha lenta.</div>` : null}
      </${Cartao}>` : null}

      ${res && res.o === "testes" ? html`<${Cartao} titulo="Testes de bordo" id="obd-r-testes">
        ${res.d.erro ? html`<div class="nota">${res.d.erro}</div>` : null}
        ${!res.d.testes.length && !res.d.erro ? html`<div class="vazio">Este carro não devolveu resultado de teste de bordo.</div>` : null}
        ${res.d.testes.map((t, i) => html`<div key=${i} class="obd-teste">
          <div class="obd-teste-n">${t.nome}${t.tid ? " · teste " + t.tid : ""}</div>
          <div class="obd-teste-v"><b>${t.valor}${t.unidade ? " " + t.unidade : ""}</b>
            <span>limite ${t.minimo} a ${t.maximo}${t.unidade ? " " + t.unidade : ""}</span>
            ${t.passou ? html`<span class="selo">PASSOU</span>` : html`<span class="selo ruim">FORA DO LIMITE</span>`}</div>
          ${!t.escalaConhecida ? html`<div class="nota">Número cru: a escala deste teste não está conferida, então não inventamos unidade. O passou/não passou vem da comparação com o limite do próprio módulo e vale do mesmo jeito.</div>` : null}
        </div>`)}
        ${res.d.testes.length ? html`<div class="nota">É aqui que o catalisador e a sonda aparecem piorando ANTES de dar código: veja quanta margem sobra até o limite.</div>` : null}
        ${res.d.testes.length ? html`<div class="nota">Monitor que ainda não rodou costuma devolver um <b>valor padrão de fábrica</b>, não uma medição (a Ford documenta isso para o EVAP). Antes de usar um número daqui, veja em "Teste drive" se aquele monitor completou.</div>` : null}
      </${Cartao}>` : null}


    </div>` : null}
  </${Tela}>`;
}

/* ---------------- raiz: dados, rota, aviso ---------------- */
/* ================================================================ FAMÍLIA DO DIAGNÓSTICO ========
 * Até 19/11/2026 o diagnóstico era UMA tela com tudo dentro: adaptador, dados ao vivo, falhas,
 * foto do momento, monitores, testes de bordo, falha por cilindro, odômetro, apagar e parâmetros.
 * Ela passou de 500 linhas e já obrigava a rolar procurando o que acabou de ser pedido.
 *
 * Com o UDS entrando (módulos, atuadores, aprendizados, programar bico) manter uma tela só era
 * impossível. Então virou família, e a conexão passou a viver ACIMA das telas (js/obdsessao.js):
 * trocar de tela não derruba mais o adaptador, que é o que importa com o carro no elevador.
 *
 * O que cada uma faz:
 *   Ler o carro (obd)  → o dia a dia: dados ao vivo, falhas, apagar. Não mudou de comportamento.
 *   Módulos (modulos)  → procura quem responde no carro e lê a falha de cada módulo.
 *   Atuadores          → aciona uma saída, com a volta garantida.
 *   Aprendizados       → roda calibração e adaptação.
 *   Programar bico     → grava o código que veio da retífica.
 *   Parâmetros         → a referência, que era um cartão escondido dentro do OBD.
 */

/** Liga a tela à conexão compartilhada e devolve o estado dela. */
function usarSessao() {
  const [st, setSt] = useState(() => sessao.estado());
  const { perfil } = useApp();
  useEffect(() => {
    ligarCaderno(perfil);                 // o caderno do carro: anota sozinho, sem botão (Etapa 4)
    subirPendentes();                     // o que ficou guardado no aparelho sobe quando a tela abre
    sessao.entrandoNaTela();
    const cancelar = sessao.assinar(setSt);
    return () => { cancelar(); sessao.saindoDaTela(); };
  }, []);
  return st;
}

/** O cartão do adaptador, igual em todas as telas da família. */
function Adaptador({ compacto = false }) {
  const st = usarSessao();
  const [aparelhos, setAparelhos] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const procurar = async () => {
    setErro(""); setOcupado("Procurando o adaptador…");
    try {
      const p = await obd.permissao();
      if (!p.concedida) { const q = await obd.pedirPermissao(); if (!q.concedida) throw new Error("sem-permissao"); }
      setAparelhos(await obd.listar());
    } catch (e) { setErro(obd.motivoDe(e)); } finally { setOcupado(""); }
  };
  const ligar = async ap => {
    setErro(""); setOcupado("Conectando em " + ap.nome + "…");
    const r = await sessao.ligar({ endereco: ap.endereco, nome: ap.nome });
    if (r.erro) setErro(r.erro);
    setOcupado("");
  };
  if (st.ligado && compacto) {
    return html`<div class="diag-ligado">
      <span class="selo">CONECTADO</span> ${(st.aparelho || {}).nome || "adaptador"}
      ${st.modulo ? html` · <b>${st.modulo.nome || st.modulo.pedido}</b>` : null}
      ${st.dono ? html` · <span class="nota">ocupado com ${st.dono}</span>` : null}
    </div>`;
  }
  return html`<${Cartao} titulo="Adaptador" id="diag-adaptador">
    ${!st.ligado ? html`
      <p class="nota" style="margin-bottom:8px">Encaixe o adaptador na tomada do carro e ligue a ignição (chave na posição 2). Com a chave fora, o módulo não responde.</p>
      <button type="button" class="btn-barra" id="diag-procurar" onClick=${procurar} disabled=${!!ocupado || st.ligando}><${Ic} n="obd" t=${22} />PROCURAR ADAPTADOR</button>
      ${aparelhos && !aparelhos.length ? html`<div class="vazio">Nenhum aparelho pareado. Pareie o adaptador uma vez nos Ajustes do Android (Bluetooth) e volte aqui.</div>` : null}
      ${aparelhos && aparelhos.length ? html`<div class="sec"><h3>Aparelhos pareados</h3>
        ${aparelhos.map(ap => html`<button key=${ap.endereco} type="button" class="obd-ap" onClick=${() => ligar(ap)} disabled=${!!ocupado || st.ligando}><b>${ap.nome}</b><span>${ap.endereco}</span></button>`)}
        <div class="nota">Toque no seu adaptador para conectar.</div></div>` : null}
    ` : html`
      <div class="kv"><span>Situação:</span><i></i><b><span class="selo">CONECTADO</span>${(st.aparelho || {}).nome || ""}</b></div>
      ${st.protocolo ? html`<${KV} a="Protocolo" b=${st.protocolo} p />` : null}
      ${st.modulo ? html`<${KV} a="Falando com" b=${st.modulo.nome || st.modulo.pedido} p />` : null}
      ${st.aviso ? html`<div class="erro" id="diag-clone">${st.aviso}</div>` : null}
      <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => sessao.desligar()} disabled=${!!st.dono}>DESCONECTAR</button>
    `}
    ${ocupado || st.ligando ? html`<div class="carregando">${ocupado || "Conectando…"}</div>` : null}
    ${erro || st.erro ? html`<div class="erro">${erro || st.erro}</div>` : null}
  </${Cartao}>`;
}

/** Aviso padrão de quem não tem permissão para aquela ação. */
const SemPermissao = ({ o }) => html`<div class="vazio" id="diag-sem-permissao">
  <b>${o} não está liberado para o seu login.</b><br />
  <span class="nota">Quem libera é o administrador, em Sistema › Equipe, pessoa por pessoa.</span></div>`;

/** Aviso de APK antigo: a tela existe, mas o aparelho não tem a camada que age no carro. */
const PrecisaApk = () => html`<div class="vazio" id="diag-apk">
  <b>Este APK ainda não tem a parte que conversa com os módulos.</b><br />
  <span class="nota">As telas vêm do site e já estão aqui, mas falar UDS com um módulo depende da parte nativa do app. Instale o APK novo e volte.</span></div>`;

/** Escolha do módulo: os endereços padrão e, depois, o que o acervo conhece. */
function EscolherModulo({ aoEscolher }) {
  const st = usarSessao();
  const [fam, setFam] = useState("");
  const [ocupado, setOcupado] = useState("");
  const [achados, setAchados] = useState(null);
  const procurar = async () => {
    setOcupado("Procurando módulos no carro…"); setAchados(null);
    const encontrados = [];
    for (const e of uds.ENDERECOS_PADRAO) {
      setOcupado("Perguntando em " + e.pedido + "…");
      const r = await sessao.tomar("a procura de módulos", async () => {
        await uds.abrir({ pedido: e.pedido, resposta: e.resposta });
        // Abrir a sessão é a pergunta: módulo que está ali responde, mesmo que seja para recusar.
        // Quem não está ali não responde nada, e é o `erro` que diz isso. Recusa NEGATIVA conta
        // como presente, mas é anotada: pode ser um gateway respondendo pelo barramento, e não o
        // módulo daquele endereço. (Antes isto era `s.nrc == null || s.nrc != null`, que é sempre
        // verdadeiro — a conferência não existia: achado da revisão independente de 20/11/2026.)
        const s = await uds.sessao(uds.SESSAO.comum);
        if (s.erro) return null;
        return { respondeu: true, recusou: s.nrc != null, texto: s.texto || "" };
      });
      if (r.ok && r.r && r.r.respondeu) encontrados.push({ ...e, recusou: r.r.recusou });
    }
    setAchados(encontrados); setOcupado("");
  };
  return html`<${Cartao} titulo="Com qual módulo falar" id="diag-modulo">
    ${!st.ligado ? html`<div class="nota">Conecte o adaptador primeiro.</div>` : html`
      <button type="button" class="btn-barra" onClick=${procurar} disabled=${!!ocupado || !!st.dono}><${Ic} n="modulo" t=${22} />PROCURAR MÓDULOS NO CARRO</button>
      ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
      ${achados && !achados.length ? html`<div class="vazio">Nenhum módulo respondeu nos endereços padrão. Escolha a família abaixo e tente pelo endereço do acervo.</div>` : null}
      ${achados && achados.length ? html`<div class="sec"><h3>Responderam</h3>
        ${achados.map(m => html`<button key=${m.pedido} type="button" class="obd-ap" onClick=${() => aoEscolher(m)}>
          <b>${m.nome || "Módulo " + m.pedido}</b><span>pede em ${m.pedido} · responde em ${m.resposta}${m.recusou ? " · respondeu recusando (pode ser o gateway)" : ""}</span></button>`)}</div>` : null}
      <div class="sec"><h3>Ou pelo acervo (${uds.quantosModulos()} módulos)</h3>
        <${Campo} id="diag-fam" rotulo="Família">
          <select id="diag-fam" value=${fam} onChange=${e => setFam(e.target.value)}>
            <option value="">Escolha a família…</option>
            ${uds.familias().map(f => html`<option key=${f} value=${f}>${f}</option>`)}
          </select>
        </${Campo}>
        ${fam ? uds.modulosDa(fam).slice(0, 40).map(m => html`<button key=${m.pedido + m.resposta} type="button" class="obd-ap" onClick=${() => aoEscolher(m)}>
          <b>${m.nome || "Módulo " + m.pedido}</b><span>pede em ${m.pedido} · responde em ${m.resposta}</span></button>`) : null}
        ${fam && uds.modulosDa(fam).length > 40 ? html`<div class="nota">Mostrando os 40 primeiros de ${uds.modulosDa(fam).length}.</div>` : null}
      </div>
      <p class="nota">O endereço do acervo é de outro carro da mesma família: se o módulo não responder, não é defeito — é que neste carro ele está em outro endereço.</p>
    `}
  </${Cartao}>`;
}

/* ---------------- MÓDULOS DO CARRO ---------------- */
function Modulos() {
  const st = usarSessao();
  const { cfg, perfil } = useApp();
  const [mod, setMod] = useState(null);
  const [falhas, setFalhas] = useState(null);
  const [epti, setEpti] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const podeApagar = podeApagarObd(cfg, perfil);
  const explicadasMod = usarExplicacoes(falhas, st.carro);
  const mapa = usarMapa(st.carro);
  const [regApagar, setRegApagar] = useState("");
  // Uma tela por vez também aqui: falhas, leituras ao vivo ou "o que ele tem" — nunca empilhadas.
  const [vistaMod, setVistaMod] = useState("");
  usarPasso(!!mod, () => { setMod(null); setFalhas(null); setEpti(null); setVistaMod(""); });

  const escolher = async m => {
    setErro(""); setFalhas(null); setEpti(null);
    const r = await sessao.apontarModulo(m);
    if (!r.ok) { setErro(r.texto || "Não deu para falar com este módulo."); return; }
    setMod(m);
  };
  const lerFalhas = async () => {
    setOcupado("Lendo as falhas do módulo…"); setErro("");
    const r = await sessao.tomar("a leitura de falhas", async () => {
      await uds.sessao(uds.SESSAO.estendida);
      return uds.lerFalhas(0xff);
    });
    setOcupado("");
    if (!r.ok) { setErro(r.texto || "Não deu para ler."); return; }
    const d = r.r;
    // Sem resposta (NO DATA, STOPPED…) NÃO é "sem falhas": é leitura que não aconteceu.
    if (d.nrc != null || d.erro || !Array.isArray(d.codigos)) { setErro(d.texto || "O módulo não respondeu à leitura de falhas. Nada foi lido — confira a ignição e tente de novo."); return; }
    setFalhas(d.codigos.map(uds.falhaPronta)); setVistaMod("falhas");
  };
  const descobrir = async () => {
    setOcupado("Perguntando ao módulo o que ele tem…"); setErro("");
    const r = await sessao.tomar("a descoberta", async () => {
      await uds.sessao(uds.SESSAO.estendida);
      return uds.descobrirEpti({ aoAndar: t => setOcupado(t) });
    });
    setOcupado("");
    if (!r.ok) { setErro(r.texto || "Não deu para perguntar."); return; }
    setEpti(r.r); setVistaMod("epti");
  };
  const apagar = async () => {
    setOcupado("Apagando as falhas deste módulo…"); setErro("");
    const r = await sessao.tomar("o apagamento", async () => {
      await uds.sessao(uds.SESSAO.estendida);
      return uds.apagarDoModulo();
    }, { pausaFundo: true });
    setOcupado("");
    if (!r.ok) { setErro(r.texto || "Não deu para apagar."); return; }
    if (r.r.nrc != null) { setErro(r.r.texto); return; }
    const antes = (falhas || []).map(f => ({ codigo: f.rotulo, situacao: f.situacaoTexto }));
    // Pedido enviado e resposta perdida (STOPPED, NO DATA): pode ter apagado ou não. Fica registrado
    // COMO INCERTO, e a tela diz isso — não vira apagamento confirmado.
    const incerto = !!r.r.erro;
    if (incerto) setErro("O pedido de apagar foi enviado, mas a resposta do módulo se perdeu (" + (r.r.texto || r.r.erro) + "). Pode ter apagado ou não: confira na leitura abaixo.");
    setRegApagar(await registrarAcao("apagar_modulo", perfil, Object.assign({ modulo: mod, antes }, incerto ? { resultado: "sem-confirmacao" } : {}), { codigos: antes }));
    setFalhas(null); await lerFalhas();
  };

  return html`<${Tela} tela="modulos" ajuda="Procura quem responde no carro e lê a falha de cada módulo, um por um. O OBD comum só fala com o motor e só mostra o que é de emissão; aqui aparecem câmbio, ABS, airbag e o resto — cada falha com a causa elétrica, quando o módulo informa o tipo.">
    ${!obd.disponivel() ? html`<div class="vazio">Esta tela funciona no aplicativo instalado no celular (APK), que é quem conversa com o adaptador.</div>`
      : !uds.podeAgir() ? html`<${PrecisaApk} />` : html`
      <${Adaptador} compacto=${!!st.ligado} />
      <${CarroDaVez} st=${st} />
      <${Mapeando} st=${st} mapa=${mapa} parado=${!!mod} caderno=${cadernoAtual} />
      ${!mod ? html`<${CarroInteiro} st=${st} mapa=${mapa} aoAbrir=${escolher} /><${EscolherModulo} aoEscolher=${escolher} />` : html`
        <div class=${vistaMod ? "mod-tela mod-foco" : "mod-tela"} id="mod-tela" data-vista=${vistaMod}>
        <${Cartao} titulo=${mod.nome || "Módulo " + mod.pedido} id="mod-escolhido">
          <${KV} a="Pede em" b=${mod.pedido} />
          <${KV} a="Responde em" b=${mod.resposta} />
          <button type="button" class="btn-barra" onClick=${lerFalhas} disabled=${!!ocupado || !!st.dono}><${Ic} n="obd" t=${20} />LER AS FALHAS DESTE MÓDULO</button>
          ${mapa.comandos.some(c => c.p === mod.pedido) ? html`<button type="button" class="btn-barra claro" id="mod-ver-leituras" onClick=${() => setVistaMod("leituras")} disabled=${!!st.dono && vistaMod !== "leituras"}><${Ic} n="obd" t=${20} />LEITURAS AO VIVO</button>` : null}
          <button type="button" class="btn-barra claro" onClick=${descobrir} disabled=${!!ocupado || !!st.dono}><${Ic} n="search" t=${20} />PERGUNTAR O QUE ELE TEM</button>
          <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => { setMod(null); setFalhas(null); setEpti(null); setVistaMod(""); sessao.soltarModulo(); }} disabled=${!!st.dono}>TROCAR DE MÓDULO</button>
        </${Cartao}>
        ${vistaMod === "leituras" ? html`<${LeiturasDoModulo} st=${st} mod=${mod} comandos=${mapa.comandos} />` : null}
        ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
        ${erro ? html`<div class="erro">${erro}</div>` : null}
        ${falhas && vistaMod === "falhas" ? html`<${Cartao} titulo=${"Falhas (" + falhas.length + ")"} id="mod-falhas">
          ${!falhas.length ? html`<div class="nota">Nenhuma falha gravada neste módulo.</div>` : falhas.map(f => html`
            <div key=${f.rotulo} class="diag-falha">
              <div class="diag-falha-topo"><b>${f.rotulo}</b>${f.pedeLuz ? html`<span class="selo ruim">LUZ NO PAINEL</span>` : null}</div>
              <${FalhaExplicada} e=${explicadasMod[f.codigo]} />
              <div class="diag-falha-tipo">${f.causa ? html`Tipo de falha: <b>${f.causa}</b>. ` : html`Tipo ${hexDoTipo(f.tipoFalha)}, que a tabela da norma do app não tem. `}Situação: ${f.situacaoTexto}.</div>
            </div>`)}
          ${falhas.length ? html`<${NotaDasFontes} />` : null}
          ${falhas.length && podeApagar ? html`<button type="button" class="btn-barra claro" style="justify-content:center;margin-top:8px" onClick=${apagar} disabled=${!!ocupado || !!st.dono}>APAGAR AS FALHAS DESTE MÓDULO</button>` : null}
          ${falhas.length && !podeApagar ? html`<div class="nota">Apagar falha não está liberado para o seu login.</div>` : null}
          ${regApagar ? html`<p class="nota" id="mod-reg-apagar">Apagamento anterior: ${regApagar}</p>` : null}
        </${Cartao}>` : null}
        ${epti && vistaMod === "epti" ? html`<${Cartao} titulo="O que o módulo respondeu" id="mod-epti">
          ${epti.sistemas.length ? html`<div class="sec"><h3>Sistemas que ele cuida</h3>
            ${epti.sistemas.map(s => html`<div key=${s.id} class="kv"><span>${s.id}:</span><i></i><b>${s.nome || "não está na lista da norma"}</b></div>`)}</div>` : null}
          <${KV} a="Rotinas que aceita" b=${epti.rotinas.length ? epti.rotinas.length + " rotina(s)" : "nenhuma informada"} />
          <${KV} a="Atuadores que aceita" b=${epti.atuadores.length ? epti.atuadores.length + " atuador(es)" : "nenhum informado"} />
          ${epti.invertido ? html`<div class="nota">Este módulo responde no jeito do rascunho da norma, com os dois identificadores trocados. O app corrigiu pelo conteúdo.</div>` : null}
          ${epti.avisos.map((a, i) => html`<div key=${i} class="nota">${a}</div>`)}
        </${Cartao}>` : null}
        </div>
      `}
    `}
  </${Tela}>`;
}
const hexDoTipo = n => (n == null ? "" : Number(n).toString(16).toUpperCase().padStart(2, "0"));

/* ---------------- ATUADORES ---------------- */
function Atuadores() {
  const st = usarSessao();
  const { cfg, perfil } = useApp();
  const [mod, setMod] = useState(null);
  const [lista, setLista] = useState(null);
  const [alvo, setAlvo] = useState(null);       // { did } a confirmar
  const [duvida, setDuvida] = useState(false);  // o módulo respondeu de forma ambígua: trava até confirmar
  const [andando, setAndando] = useState(null); // { passos: [] }
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const pode = podeAtuarObd(cfg, perfil);
  usarPasso(!!alvo, () => setAlvo(null));

  const escolher = async m => {
    setErro(""); setLista(null); setDuvida(false);
    const r = await sessao.apontarModulo(m);
    if (!r.ok) { setErro(r.texto || "Não deu para falar com este módulo."); return; }
    setMod(m);
  };
  const descobrir = async () => {
    setOcupado("Perguntando ao módulo quais atuadores ele aceita…"); setErro("");
    const r = await sessao.tomar("a descoberta", async () => {
      await uds.sessao(uds.SESSAO.estendida);
      return uds.descobrirEpti({ aoAndar: t => setOcupado(t) });
    });
    setOcupado("");
    if (!r.ok) { setErro(r.texto || "Não deu para perguntar."); return; }
    setLista(r.r.atuadores.map(n => ({ did: n })));
    // Dúvida TRAVA o acionamento. Quando o módulo responde números que cabem nas duas leituras, o
    // app não sabe se a lista é de atuador ou de rotina — e acionar o número errado é mandar 2F num
    // identificador de rotina. Aviso sozinho não protege ninguém: o mecânico tem de confirmar.
    setDuvida(!!r.r.duvida);
    if (!r.r.atuadores.length) setErro("Este módulo não informou nenhum atuador. Isso não quer dizer que ele não tenha: quer dizer que ele não responde pela norma de inspeção, e o app não vai adivinhar o número da saída.");
  };
  // `cancelar` é uma caixa, não estado: a roda do teste precisa ver o valor NOVO a cada volta, e
  // estado dentro de função que já começou continuaria valendo o antigo.
  const cancelar = useRef(false);
  const [condOk, setCondOk] = useState(false);
  // Cada alvo confirma as SUAS condições: abrir ou fechar outro item zera a confirmação anterior.
  useEffect(() => { setCondOk(false); }, [alvo]);
  const testar = async (did, hd = null, antes = null) => {
    setAlvo(null); setCondOk(false); setAndando({ passos: [] }); cancelar.current = false;
    // comAcao: pega a vez, para a leitura de fundo E TRAVA O DESLIGAMENTO enquanto o teste corre.
    // Sem a trava, trocar de tela ou de módulo no meio derrubava a conexão antes de o controle da
    // saída ser devolvido ao módulo — e saída presa no comando do aparelho queima peça.
    const r = await sessao.comAcao("o teste de atuador", () => uds.testarAtuador(did, {
      segundos: hd ? hd.segundos : 5, ...(hd ? { valor: hd.valor } : {}),
      pausar: sessao.pausar, retomar: sessao.retomar,
      continuar: () => !cancelar.current,
      aoAndar: p => setAndando({ passos: p.passos }),
    }));
    setAndando(a => ({ passos: (a && a.passos) || [], fim: r.ok ? r.r : { ok: false, texto: r.texto || "Não deu para rodar o teste." } }));
    // Fica registrado quem acionou o quê, em que módulo e o que o módulo respondeu (Etapa 1).
    const reg = await registrarAcao("atuar", perfil, { modulo: sessao.estado().modulo, did: hex4Txt(did), ...(hd ? { honda: hd.chave, nome: hd.nome, antes } : {}), ok: !!(r.ok && r.r && r.r.ok), texto: (r.ok && r.r && r.r.texto) || r.texto || "" });
    setAndando(a => (a ? { ...a, registro: reg } : a));
  };

  return html`<${Tela} tela="atuadores" ajuda="Manda o módulo acionar uma saída para você conferir no carro se a peça responde. O comando é curto de propósito, por segurança da própria norma, então o app fica repetindo enquanto o teste corre — e devolve o controle ao módulo no fim, no erro e se você sair.">
    ${!pode ? html`<${SemPermissao} o="Teste de atuador" />`
      : !obd.disponivel() ? html`<div class="vazio">Esta tela funciona no aplicativo instalado no celular (APK).</div>`
      : !uds.podeAgir() ? html`<${PrecisaApk} />` : html`
      <${Adaptador} compacto=${!!st.ligado} />
      ${!mod ? html`<${CarroDaVez} st=${st} /><${HondaLista} tipo="atuadores" st=${st} travado=${!!andando} aoPronto=${({ mod: m, item, antes }) => { setMod(m); setLista(null); setAlvo({ did: item.did, honda: item, antes }); }} /><${EscolherModulo} aoEscolher=${escolher} />` : html`
        <${Cartao} titulo=${mod.nome || "Módulo " + mod.pedido} id="atu-modulo">
          <button type="button" class="btn-barra" onClick=${descobrir} disabled=${!!ocupado || !!st.dono}><${Ic} n="search" t=${20} />VER OS ATUADORES DESTE MÓDULO</button>
          <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => { setMod(null); setLista(null); sessao.soltarModulo(); }} disabled=${!!st.dono || st.acaoCorrendo || !!andando}>TROCAR DE MÓDULO</button>
        </${Cartao}>
        ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
        ${erro ? html`<div class="erro">${erro}</div>` : null}
        ${lista && lista.length ? html`<${Cartao} titulo=${"Atuadores (" + lista.length + ")"} id="atu-lista">
          <p class="nota">O módulo informou o NÚMERO de cada saída, não o nome dela — o nome está num anexo da norma que o app não tem. Acione e confira no carro o que se moveu.</p>
          ${duvida ? html`<div class="erro" id="atu-duvida">
            <b>O app não tem certeza de que esta lista é de atuador.</b><br />
            Este módulo respondeu números que cabem tanto na leitura de rotina quanto na de atuador, então pode ser que esta seja a lista de ROTINAS. Acionar um número de rotina como se fosse saída é mandar o comando errado.<br />
            <button type="button" class="link" onClick=${() => setDuvida(false)}>Conferi o número no manual do módulo e quero testar mesmo assim</button>
          </div>` : null}
          ${lista.map(a => html`<button key=${a.did} type="button" class="obd-ap" onClick=${() => setAlvo(a)} disabled=${!!st.dono || !!andando || duvida}>
            <b>Saída ${hex4Txt(a.did)}</b><span>${duvida ? "travado: o app não tem certeza da lista" : "toque para testar"}</span></button>`)}
        </${Cartao}>` : null}
        ${andando ? html`<${Cartao} titulo="Teste em andamento" id="atu-andando">
          ${andando.passos.map((p, i) => html`<div key=${i} class=${"passo " + (p.o === "nao-devolveu" ? "ruim" : p.o === "devolveu" || p.o === "acionou" ? "bom" : "")}>${p.t}</div>`)}
          ${andando.fim ? html`<div class=${andando.fim.ok ? "nota" : "erro"}>${andando.fim.texto}</div>
            <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => setAndando(null)}>FECHAR</button>`
            : html`<div class="carregando">Acionando… confira no carro.</div>
              <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => { cancelar.current = true; }}>PARAR AGORA</button>`}
          ${andando.registro ? html`<p class="nota" id="atu-registro">${andando.registro}</p>` : null}
        </${Cartao}>` : null}
      `}
    `}
    ${alvo ? html`<${Quadro} titulo="Acionar esta saída?" onFechar=${() => setAlvo(null)}>
      ${alvo.honda ? html`<p><b>${alvo.honda.nome}</b> (saída ${hex4Txt(alvo.did)}), por ${alvo.honda.segundos} segundos. ${alvo.honda.ver}</p>
        <${Condicoes} item=${alvo.honda} aoMudar=${setCondOk} />` : html`<p>O módulo vai acionar a saída <b>${hex4Txt(alvo.did)}</b> por cinco segundos. Antes de confirmar:</p>`}
      <p class="nota">• Veja se não há ninguém com a mão perto de ventoinha, correia ou polia.<br />
      • Saída de luz, bomba e ventoinha é segura de testar. Saída que move peça grande, não.<br />
      • O app devolve o controle ao módulo no fim. Se não conseguir, ele avisa e aí é desligar a chave.</p>
      <button type="button" class="btn-acao" id="atu-acionar" disabled=${!!alvo.honda && !condOk} onClick=${() => testar(alvo.did, alvo.honda || null, alvo.antes || null)}>ACIONAR AGORA</button>
      <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => setAlvo(null)}>Cancelar</button>
    </${Quadro}>` : null}
  </${Tela}>`;
}
const hex4Txt = n => (n == null ? "" : Number(n).toString(16).toUpperCase().padStart(4, "0"));

/* ---------------- APRENDIZADOS ---------------- */
function Aprendizados() {
  const st = usarSessao();
  const { cfg, perfil } = useApp();
  const [mod, setMod] = useState(null);
  const [lista, setLista] = useState(null);
  const [alvo, setAlvo] = useState(null);
  const [duvida, setDuvida] = useState(false);
  const [andando, setAndando] = useState(null);
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  const pode = podeAprenderObd(cfg, perfil);
  usarPasso(!!alvo, () => setAlvo(null));

  const escolher = async m => {
    setErro(""); setLista(null); setDuvida(false);
    const r = await sessao.apontarModulo(m);
    if (!r.ok) { setErro(r.texto || "Não deu para falar com este módulo."); return; }
    setMod(m);
  };
  const descobrir = async () => {
    setOcupado("Perguntando ao módulo quais rotinas ele aceita…"); setErro("");
    const r = await sessao.tomar("a descoberta", async () => {
      await uds.sessao(uds.SESSAO.estendida);
      return uds.descobrirEpti({ aoAndar: t => setOcupado(t) });
    });
    setOcupado("");
    if (!r.ok) { setErro(r.texto || "Não deu para perguntar."); return; }
    setLista(r.r.rotinas.map(n => ({ rid: n, sabido: true })));
    setDuvida(!!r.r.duvida);
    if (!r.r.rotinas.length) setErro("Este módulo não informou rotina nenhuma pela norma de inspeção. Dá para sondar por faixa abaixo: a sondagem PERGUNTA sem rodar nada.");
  };
  /** Sondagem por faixa: pergunta sem executar, e lê o jeito da recusa. */
  const sondar = async () => {
    setErro(""); const achados = [];
    const marcos = [0x0200, 0x0201, 0x0202, 0x0203, 0x0300, 0x0301, 0x0400, 0x0401,
                    0xa001, 0xa002, 0xa003, 0xad6e, 0xb001, 0xc001, 0xd001];
    const r = await sessao.tomar("a sondagem", async () => {
      await uds.sessao(uds.SESSAO.estendida);
      for (const rid of marcos) {
        setOcupado("Perguntando pela rotina " + hex4Txt(rid) + "…");
        const v = await uds.sondar(rid, { sessaoAtual: uds.SESSAO.estendida });
        if (v.existe === true) achados.push({ rid, motivo: v.motivo, texto: v.texto });
      }
      return achados;
    });
    setOcupado("");
    if (!r.ok) { setErro(r.texto || "Não deu para sondar."); return; }
    setLista((r.r || []).map(a => ({ rid: a.rid, sabido: false, motivo: a.motivo, texto: a.texto })));
    setDuvida(false);   // a sondagem não tem dúvida: ela perguntou por número de rotina e o módulo confirmou
    if (!(r.r || []).length) setErro("Nenhuma das rotinas sondadas existe neste módulo. A sondagem olha alguns números conhecidos da faixa do fabricante, não a faixa inteira: ela não prova que o módulo não tem nenhuma.");
  };
  const cancelar = useRef(false);
  const [condOk, setCondOk] = useState(false);
  // Cada alvo confirma as SUAS condições: abrir ou fechar outro item zera a confirmação anterior.
  useEffect(() => { setCondOk(false); }, [alvo]);
  const rodar = async (rid, hd = null, antes = null) => {
    setAlvo(null); setCondOk(false); setAndando({ passos: [] }); cancelar.current = false;
    const r = await sessao.comAcao("o aprendizado", () => uds.rodarAprendizado(rid, {
      segundosMax: hd ? hd.segundosMax : 120, ...(hd ? { dados: hd.dados } : {}),
      pausar: sessao.pausar, retomar: sessao.retomar,
      continuar: () => !cancelar.current,
      aoAndar: p => setAndando({ passos: p.passos }),
    }));
    setAndando(a => ({ passos: (a && a.passos) || [], fim: r.ok ? r.r : { ok: false, texto: r.texto || "Não deu para rodar a rotina." } }));
    const reg = await registrarAcao("aprender", perfil, { modulo: sessao.estado().modulo, rotina: hex4Txt(rid), ...(hd ? { honda: hd.chave, nome: hd.nome, antes } : {}), ok: !!(r.ok && r.r && r.r.ok), texto: (r.ok && r.r && r.r.texto) || r.texto || "" });
    setAndando(a => (a ? { ...a, registro: reg } : a));
  };

  return html`<${Tela} tela="aprendizados" ajuda="Roda rotina de aprendizado e calibração no módulo: adaptação, reset de serviço, zero do sensor de ângulo. O módulo trabalha sozinho depois do começar, e o app acompanha até terminar. Se ele recusar, a frase diz o que fazer — pôr em neutro, pisar no freio, aquecer o motor.">
    ${!pode ? html`<${SemPermissao} o="Rodar aprendizado" />`
      : !obd.disponivel() ? html`<div class="vazio">Esta tela funciona no aplicativo instalado no celular (APK).</div>`
      : !uds.podeAgir() ? html`<${PrecisaApk} />` : html`
      <${Adaptador} compacto=${!!st.ligado} />
      ${!mod ? html`<${CarroDaVez} st=${st} /><${HondaLista} tipo="aprendizados" st=${st} travado=${!!andando} aoPronto=${({ mod: m, item, antes }) => { setMod(m); setLista(null); setAlvo({ rid: item.rid, honda: item, antes }); }} /><${EscolherModulo} aoEscolher=${escolher} />` : html`
        <${Cartao} titulo=${mod.nome || "Módulo " + mod.pedido} id="apr-modulo">
          <button type="button" class="btn-barra" onClick=${descobrir} disabled=${!!ocupado || !!st.dono}><${Ic} n="search" t=${20} />VER AS ROTINAS DESTE MÓDULO</button>
          <button type="button" class="btn-barra claro" onClick=${sondar} disabled=${!!ocupado || !!st.dono}><${Ic} n="aprender" t=${20} />SONDAR SEM RODAR NADA</button>
          <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => { setMod(null); setLista(null); sessao.soltarModulo(); }} disabled=${!!st.dono || st.acaoCorrendo || !!andando}>TROCAR DE MÓDULO</button>
        </${Cartao}>
        ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
        ${erro ? html`<div class="erro">${erro}</div>` : null}
        ${lista && lista.length ? html`<${Cartao} titulo=${"Rotinas (" + lista.length + ")"} id="apr-lista">
          <p class="nota">O módulo informa o NÚMERO da rotina, não o nome: o nome está num anexo da norma que o app não tem. Rode uma por vez e veja o resultado no carro.</p>
          ${duvida ? html`<div class="erro" id="apr-duvida">
            <b>O app não tem certeza de que esta lista é de rotina.</b><br />
            Este módulo respondeu números que cabem tanto na leitura de rotina quanto na de atuador, então pode ser que esta seja a lista de ATUADORES. Rodar um número de atuador como se fosse rotina é mandar o comando errado.<br />
            <button type="button" class="link" onClick=${() => setDuvida(false)}>Conferi o número no manual do módulo e quero rodar mesmo assim</button>
          </div>` : null}
          ${lista.map(a => html`<button key=${a.rid} type="button" class="obd-ap" onClick=${() => setAlvo(a)} disabled=${!!st.dono || !!andando || duvida}>
            <b>Rotina ${hex4Txt(a.rid)}</b><span>${duvida ? "travado: o app não tem certeza da lista" : (a.texto || "toque para rodar")}</span></button>`)}
        </${Cartao}>` : null}
        ${andando ? html`<${Cartao} titulo="Rotina em andamento" id="apr-andando">
          ${andando.passos.map((p, i) => html`<div key=${i} class=${"passo " + (p.o === "pronto" ? "bom" : p.o === "recusou" ? "ruim" : "")}>${p.t}</div>`)}
          ${andando.fim ? html`<div class=${andando.fim.ok ? "nota" : "erro"}>${andando.fim.texto}</div>
            <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => setAndando(null)}>FECHAR</button>`
            : html`<div class="carregando">Trabalhando… não desligue a chave.</div>
              <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => { cancelar.current = true; }}>PARAR AGORA</button>`}
          ${andando.registro ? html`<p class="nota" id="apr-registro">${andando.registro}</p>` : null}
        </${Cartao}>` : null}
      `}
    `}
    ${alvo ? html`<${Quadro} titulo="Rodar esta rotina?" onFechar=${() => setAlvo(null)}>
      ${alvo.honda ? html`<p><b>${alvo.honda.nome}</b> (rotina ${hex4Txt(alvo.rid)}). ${alvo.honda.aviso}</p>
        <p class="nota" id="honda-antes">Valor atual lido e guardado antes de rodar: <b>${alvo.antes}</b>. Fica no registro junto com quem rodou.</p>
        <${Condicoes} item=${alvo.honda} aoMudar=${setCondOk} />` : html`<p>O módulo vai rodar a rotina <b>${hex4Txt(alvo.rid)}</b>. Aprendizado muda o jeito do módulo trabalhar, e não tem botão de desfazer.</p>`}
      <p class="nota">• Deixe a chave ligada e não mexa no carro enquanto a rotina corre.<br />
      • Se o módulo pedir condição (neutro, freio, temperatura), o app mostra o que falta.<br />
      • Pode levar até dois minutos.</p>
      <button type="button" class="btn-acao" id="apr-rodar" disabled=${!!alvo.honda && !condOk} onClick=${() => rodar(alvo.rid, alvo.honda || null, alvo.antes || null)}>RODAR AGORA</button>
      <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => setAlvo(null)}>Cancelar</button>
    </${Quadro}>` : null}
  </${Tela}>`;
}

/* ---------------- PROGRAMAR BICO ---------------- */
function Bico() {
  const st = usarSessao();
  const { cfg, perfil } = useApp();
  const pl = usarPlaca();
  // O veículo consultado AQUI é o que vai para o registro da gravação (sessao.carro()).
  useEffect(() => { if (pl.veic) sessao.definirCarro({ placa: String(pl.veic.placa || "").toUpperCase(), marca: pl.veic.marca || "", modelo: pl.veic.modelo || "", ano: pl.veic.ano || "", veiculo_id: pl.veic.id || null }); }, [pl.veic]);
  const [cilindros, setCilindros] = useState(4);
  const [itens, setItens] = useState(() => [1, 2, 3, 4].map(c => ({ cilindro: c, codigo: "", trocado: false, campo: "" })));
  // A gravação voltou em 21/11/2026, por decisão do Danilo: só com o administrador autorizando com
  // o login dele NA HORA. O app não tem a tabela de "em que campo cada ECU guarda o bico" — nenhuma
  // base aberta tem — então o campo é informado por quem tem o manual da ECU, e nunca é chutado.
  const [autoriza, setAutoriza] = useState(null);      // { email, senha, erro, conferindo }
  const [andando, setAndando] = useState(null);        // { passos: [], fim }
  const [feito, setFeito] = useState(null);            // [{ cilindro, campo, antes, ok, texto }]
  const pode = podeGravarObd(cfg, perfil);
  usarPasso(!!autoriza, () => cancelarAutorizacao());

  const trocarQtd = n => {
    setCilindros(n);
    setItens(anteriores => Array.from({ length: n }, (_, i) => anteriores[i] || { cilindro: i + 1, codigo: "", trocado: false, campo: "" }));
  };
  const mexer = (i, p) => setItens(l => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const conf = bico.conferirConjunto(itens, cilindros);
  const paraGravar = conf.paraGravar.map(c => ({ ...c, campo: String((itens.find(x => x.cilindro === c.cilindro) || {}).campo || "").toUpperCase() }));
  const campoBom = c => /^[0-9A-F]{4}$/.test(c) && !(parseInt(c, 16) >= 0xf180 && parseInt(c, 16) <= 0xf1ff);
  const camposCertos = paraGravar.length > 0 && paraGravar.every(c => campoBom(c.campo)) && new Set(paraGravar.map(c => c.campo)).size === paraGravar.length;
  const falta = !uds.podeGravar() ? "O APK instalado é antigo: a gravação entra no APK novo."
    : !st.ligado ? "Conecte o adaptador."
    : !conf.podeGravar ? "Resolva o que está em “Confira antes”."
    : !camposCertos ? "Informe o campo de cada cilindro marcado (4 dígitos, do manual da ECU; um diferente para cada cilindro)."
    : st.dono ? "O adaptador está ocupado." : "";

  // A OPÇÃO DE GRAVAR SÓ APARECE NO MÓDULO QUE ACEITA (Danilo, 21/11/2026). O app pergunta ao módulo,
  // sem gravar nada, se ele aceita gravação naquele campo (uds.aceitaGravar). Só com "aceita" em todos
  // os cilindros marcados é que o botão de gravar passa a existir. Mudou um campo, pergunta de novo.
  const [aceite, setAceite] = useState(null);          // { assinatura, modulo, itens: [{ cilindro, campo, aceita, texto }] }
  const assinatura = paraGravar.map(c => c.cilindro + ":" + c.campo).join(",");
  const aceiteVale = !!(aceite && aceite.assinatura === assinatura);
  const moduloAceita = aceiteVale && aceite.itens.length > 0 && aceite.itens.every(x => x.aceita === true);
  const [conferindo, setConferindo] = useState(false);
  const conferirModulo = async () => {
    setConferindo(true); setFeito(null); setAndando(null);
    const itensAceite = []; let modulo = null;
    const r = await sessao.comAcao("a conferência do módulo", async () => {
      for (const m of [{ pedido: "7E0", resposta: "7E8" }, { pedido: "18DA10F1", resposta: "18DAF110" }]) {
        await uds.abrir(m);
        const se = await uds.sessao(uds.SESSAO.estendida);
        if (!se.erro && se.nrc == null) { modulo = m; break; }
      }
      if (!modulo) return false;
      for (const c of paraGravar) itensAceite.push({ cilindro: c.cilindro, campo: c.campo, ...(await uds.aceitaGravar(parseInt(c.campo, 16))) });
      await uds.fechar();
      return true;
    });
    setConferindo(false);
    setAceite({ assinatura, modulo, erro: !r.ok ? (r.texto || "Não deu para conferir.") : !modulo ? "O módulo do motor não abriu a sessão de diagnóstico." : "", itens: itensAceite });
  };

  // Cada pedido de autorização tem um número. Cancelar ou fechar o quadro troca o número, e a resposta
  // do servidor que chegar depois é de uma tentativa que não existe mais: NÃO grava. (Antes, cancelar
  // durante o "Conferindo…" só fechava o quadro e a gravação seguia: achado do Codex, 21/11/2026.)
  const tentativa = useRef(0);
  const cancelarAutorizacao = () => { tentativa.current++; setAutoriza(null); };
  // Saiu da tela com a autorização ainda "Conferindo…": a tentativa morre junto. Nada grava com a tela fechada.
  useEffect(() => () => { tentativa.current++; }, []);
  // Abrir outra autorização NÃO apaga o resultado anterior: o DESFAZER só some quando a volta é confirmada.
  const pedirAutorizacao = () => { tentativa.current++; setAutoriza({ email: "", senha: "", erro: "" }); };
  const autorizarEGravar = async () => {
    const minha = tentativa.current;
    setAutoriza(a => ({ ...a, erro: "", conferindo: true }));
    const adm = await api.auth.conferirAdmin(autoriza.email, autoriza.senha);
    if (tentativa.current !== minha) return;
    if (!adm.ok) { setAutoriza(a => ({ ...a, senha: "", conferindo: false, erro: adm.motivo })); return; }
    setAutoriza(null);
    await gravar(adm);
  };
  const gravar = async adm => {
    const passos = [], anota = t => { passos.push(t); setAndando({ passos: passos.slice() }); };
    const resultado = [];
    const r = await sessao.comAcao("a gravação do bico", async () => {
      anota("Apontando o módulo do motor…");
      let apontou = false;
      for (const m of [{ pedido: "7E0", resposta: "7E8" }, { pedido: "18DA10F1", resposta: "18DAF110" }]) {
        await uds.abrir(m);
        const s = await uds.sessao(uds.SESSAO.estendida);
        if (!s.erro && s.nrc == null) { apontou = true; anota("Módulo do motor respondeu em " + m.pedido + "."); break; }
      }
      if (!apontou) { anota("O módulo do motor não abriu a sessão de diagnóstico. Nada foi gravado."); return false; }
      for (const c of paraGravar) {
        const hexCod = bico.paraHex(c.codigo);
        anota("Cilindro " + c.cilindro + ": lendo o valor atual do campo " + c.campo + " e gravando " + c.codigo + "…");
        const g = await uds.gravarDado(parseInt(c.campo, 16), hexCod);
        const item = { cilindro: c.cilindro, campo: c.campo, codigo: c.codigo, antes: g.antes ? g.antes.map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("") : null, ok: false, texto: "" };
        if (g.incerto) {
          // Escrita enviada sem resposta: tratada como POSSIVELMENTE gravada — fica no registro e no DESFAZER.
          item.gravou = true; item.incerto = true;
          item.texto = g.texto + " Confira o campo antes de confiar; dá para desfazer.";
          resultado.push(item);
        } else if (!g.gravou) {
          item.texto = g.nrc === 0x33 ? "O módulo exige DESTRAVAR antes de gravar (resposta 33), e o app não tem a chave desta família. Não gravou."
            : g.texto || "O módulo recusou a gravação.";
        } else {
          // O módulo ACEITOU: o item entra no resultado JÁ, com o valor antigo, antes da leitura de
          // conferência. Se a conexão cair nessa leitura, a gravação continua registrada e dá para
          // desfazer — o pior caso é uma escrita feita que ninguém sabe que foi feita.
          item.gravou = true;
          item.texto = "O módulo aceitou a gravação, mas a conferência NÃO foi lida de volta. Confira antes de confiar; dá para desfazer.";
          resultado.push(item);
          const volta = await uds.lerDado(parseInt(c.campo, 16));
          const lido = volta.dados ? volta.dados.slice(2).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("") : "";
          const cf = bico.conferirGravacao(c.codigo, lido);
          item.ok = cf.ok; item.texto = cf.t; item.depois = lido;
        }
        anota("Cilindro " + c.cilindro + ": " + item.texto);
        if (!item.gravou) resultado.push(item);
        if (!item.ok) break;                      // parou num: não segue gravando os outros no escuro
      }
      await uds.fechar();
      return true;
    });
    // Junta com o que já estava por desfazer de uma gravação anterior (campos que esta não regravou).
    setFeito(ant => resultado.concat((ant || []).filter(x => x.antes && x.gravou && !resultado.some(y => y.gravou && y.campo === x.campo))));
    setAndando({ passos: passos.slice(), fim: true, erro: r.ok ? "" : (r.texto || "Não deu para gravar.") });
    if (resultado.length) {
      const reg = registro.linha("gravar_bico", perfil, sessao.carro(), { autorizado_por: { id: adm.id, nome: adm.nome }, cilindros: resultado });
      const g = await registro.guardar(api.obd.registrar, registro.cofreDe(window.localStorage), reg);
      setAndando(a => ({ ...a, registro: g.gravado ? "Registrado no banco." : g.pendente ? "Registro guardado no aparelho: sobe quando o banco aceitar (falta rodar o v63.sql ou não há internet)." : "NÃO deu para registrar: anote na O.S." }));
    }
  };
  /** Desfazer: grava de volta o valor que estava lá. Só existe porque o valor antigo foi guardado. */
  const desfazer = async () => {
    const voltar = (feito || []).filter(x => x.antes && x.gravou);
    const passos = [], anota = t => { passos.push(t); setAndando({ passos: passos.slice() }); };
    const voltaram = new Set();
    const r = await sessao.comAcao("desfazer a gravação do bico", async () => {
      for (const m of [{ pedido: "7E0", resposta: "7E8" }, { pedido: "18DA10F1", resposta: "18DAF110" }]) {
        await uds.abrir(m); const s = await uds.sessao(uds.SESSAO.estendida); if (!s.erro && s.nrc == null) break;
      }
      for (const x of voltar) {
        const g = await uds.gravarDado(parseInt(x.campo, 16), x.antes);
        if (g.gravou) voltaram.add(x);
        anota("Cilindro " + x.cilindro + ": " + (g.gravou ? "voltou para o valor que estava (" + x.antes + ")." : "NÃO voltou: " + (g.texto || "o módulo recusou") + ". Valor antigo: " + x.antes));
      }
      await uds.fechar();
    });
    // Só sai da recuperação o cilindro cuja volta o módulo CONFIRMOU. O resto continua com o DESFAZER.
    const faltam = (feito || []).filter(x => x.antes && x.gravou && !voltaram.has(x));
    setFeito(faltam.length ? faltam : null);
    setAndando({ passos: passos.slice(), fim: true, erro: !r.ok ? (r.texto || "Não deu para desfazer.") : faltam.length ? "Ainda falta voltar " + faltam.length + " cilindro(s): " + faltam.map(x => x.cilindro + " (valor antigo " + x.antes + ")").join(", ") + "." : "" });
  };

  return html`<${Tela} tela="bico" ajuda="Grava no módulo do motor o código que veio escrito no bico recodificado. O código IMA tem 7 caracteres e não usa 0, 9, I, J nem Q — o app confere a digitação antes. Só grava o cilindro que você marcar como trocado, lê e guarda o valor antigo antes, e pede o login do administrador na hora de gravar.">
    ${!pode ? html`<${SemPermissao} o="Programar bico" />` : html`
      <${BuscaPlaca} id="bico-placa" titulo="Placa do carro (opcional)" pl=${pl} />
      ${pl.veic ? html`<${Veiculo} v=${pl.veic} />` : null}
      ${obd.disponivel() ? html`<${Adaptador} compacto=${!!st.ligado} />` : null}

      <${Cartao} titulo="Antes de gravar, o que o app sabe e o que não sabe" id="bico-limite">
        <div class="passo">1. O app NÃO tem tabela de em qual campo cada ECU guarda o código do bico: nenhuma base aberta tem. O campo (4 dígitos) vem do manual da ECU e é você quem informa. Campo errado não é tentativa, é prejuízo.</div>
        <div class="passo">2. Muita ECU diesel exige destravar antes (resposta 33). O app não tem a chave de nenhuma família: nessas ele lê, tenta, mostra a recusa e não grava.</div>
        <div class="passo">3. O valor que estava no campo é lido e guardado antes. Se o módulo não entregar o valor antigo, o app não grava.</div>
        <p class="nota">A gravação só vai para o módulo do motor e só com o administrador autorizando com o login dele na hora.</p>
      </${Cartao}>

      <${Cartao} titulo="Os códigos dos bicos" id="bico-codigos">
        <${Campo} id="bico-qtd" rotulo="Quantos cilindros">
          <select id="bico-qtd" value=${String(cilindros)} onChange=${e => trocarQtd(Number(e.target.value))}>
            ${[3, 4, 5, 6, 8].map(n => html`<option key=${n} value=${String(n)}>${n} cilindros</option>`)}
          </select>
        </${Campo}>
        ${itens.map((it, i) => {
          const v = it.codigo ? bico.validarIma(it.codigo) : null;
          const cp = String(it.campo || "").toUpperCase();
          return html`<div key=${it.cilindro} class="bico-linha">
            <label class="bico-marca">
              <input type="checkbox" checked=${it.trocado} onChange=${e => mexer(i, { trocado: e.target.checked })} />
              <span>Cilindro ${it.cilindro} foi trocado</span>
            </label>
            <input type="text" class=${"bico-cod" + (v && !v.ok ? " ruim" : v && v.ok ? " bom" : "")} inputmode="text"
              autocomplete="off" autocapitalize="characters" maxlength="24" placeholder="Código do bico (7 caracteres)"
              aria-label=${"Código do bico do cilindro " + it.cilindro}
              value=${it.codigo} onInput=${e => mexer(i, { codigo: e.target.value.toUpperCase() })} />
            ${v && !v.ok ? html`<div class="erro">${v.erro}${v.dica ? " " + v.dica : ""}
              ${v.corrigido ? html`<button type="button" class="link" onClick=${() => mexer(i, { codigo: v.corrigido })}>usar ${v.corrigido}</button>` : null}</div>` : null}
            ${v && v.ok ? html`<div class="nota">Código válido. Vai gravado como ${bico.paraHex(v.codigo)}.</div>` : null}
            ${it.trocado ? html`<input type="text" class=${"bico-cod bico-campo" + (cp && !campoBom(cp) ? " ruim" : cp ? " bom" : "")} inputmode="text" autocomplete="off" autocapitalize="characters" maxlength="4"
              placeholder="Campo no módulo (4 dígitos, do manual da ECU)" aria-label=${"Campo do módulo para o cilindro " + it.cilindro}
              value=${it.campo} onInput=${e => mexer(i, { campo: e.target.value.toUpperCase().replace(/[^0-9A-F]/g, "") })} />` : null}
            ${it.trocado && cp && !campoBom(cp) ? html`<div class="erro">${cp.length < 4 ? "O campo tem 4 dígitos (0 a 9 e A a F)." : "Este campo é da identificação do módulo (chassi, número de peça): o app não grava nele."}</div>` : null}
          </div>`;
        })}
        <p class="nota">O código está gravado a laser no corpo do bico. Ele não usa 0, 9, I, J nem Q: o que parece 0 é a letra O, e o que parece I é o número 1.</p>
      </${Cartao}>

      ${conf.avisos.length ? html`<${Cartao} titulo="Confira antes" id="bico-avisos">
        ${conf.avisos.map((a, i) => html`<div key=${i} class=${a.grave ? "erro" : "nota"}>${a.t}</div>`)}
      </${Cartao}>` : null}

      ${/* O plano só aparece quando NÃO há aviso grave: com código repetido ou inválido na tela, o
            que se lê é a sequência, não o aviso. */
        conf.podeGravar ? html`<${Cartao} titulo="O que vai acontecer no carro" id="bico-plano">
        <div class="passo">1. Abrir a sessão de diagnóstico no módulo do motor.</div>
        ${paraGravar.map((c, i) => html`<div key=${c.cilindro} class="passo">${i + 2}. Cilindro ${c.cilindro}: ler e guardar o que está no campo ${c.campo || "(falta informar)"}, gravar ${c.codigo} e ler de volta para conferir.</div>`)}
        <div class="passo">${paraGravar.length + 2}. Parar no primeiro cilindro que não conferir. Registrar quem gravou e quem autorizou.</div>
        ${falta ? html`<p class="nota" id="bico-falta">${falta}</p>` : null}
        ${!falta && !moduloAceita ? html`<button type="button" class="btn-barra claro" id="bico-conferir" disabled=${conferindo || !!st.acaoCorrendo} style="justify-content:center" onClick=${conferirModulo}>${conferindo ? "Perguntando ao módulo…" : "CONFERIR SE ESTE MÓDULO ACEITA GRAVAR"}</button>
          <p class="nota">A pergunta não grava nada: o app manda um pedido que o módulo é obrigado a recusar e lê o motivo da recusa. A opção de gravar só aparece se o módulo aceitar.</p>` : null}
        ${aceiteVale ? html`<div id="bico-aceite">
          ${aceite.erro ? html`<div class="erro">${aceite.erro}</div>` : null}
          ${aceite.itens.map(x => html`<div key=${x.cilindro} class="conf-item"><span class=${"selo" + (x.aceita === true ? "" : x.aceita === false ? " ruim" : " atencao")}>${x.aceita === true ? "ACEITA" : x.aceita === false ? "NÃO ACEITA" : "NÃO SEI"}</span><div><b>Cilindro ${x.cilindro}, campo ${x.campo}.</b> ${x.texto}</div></div>`)}
          ${!aceite.erro && aceite.itens.length && !moduloAceita ? html`<div class="nota"><b>A gravação não está disponível neste módulo.</b> Por isso o botão de gravar não aparece.</div>` : null}
        </div>` : null}
        ${!falta && moduloAceita ? html`<button type="button" class="btn-barra" id="bico-gravar" disabled=${!!st.acaoCorrendo} style="justify-content:center" onClick=${pedirAutorizacao}>GRAVAR (pede o login do administrador)</button>` : null}
      </${Cartao}>` : null}

      ${andando ? html`<${Cartao} titulo=${andando.fim ? "Resultado" : "Gravando…"} id="bico-andando">
        ${andando.passos.map((p, i) => html`<div key=${i} class="passo">${p}</div>`)}
        ${andando.erro ? html`<div class="erro">${andando.erro}</div>` : null}
        ${andando.registro ? html`<div class="nota">${andando.registro}</div>` : null}
        ${andando.fim && feito && feito.some(x => x.antes && x.gravou) ? html`
          <button type="button" class="btn-barra claro" id="bico-desfazer" style="justify-content:center" onClick=${desfazer} disabled=${!!st.dono}>DESFAZER: VOLTAR O VALOR QUE ESTAVA</button>
          <p class="nota">Depois de gravar, alguns módulos só passam a usar o valor novo ao desligar e ligar a ignição. Leia as falhas do módulo: gravação certa não deixa código novo.</p>` : null}
      </${Cartao}>` : null}

      ${autoriza ? html`<${Quadro} titulo="Autorização do administrador" onFechar=${cancelarAutorizacao}>
        <p>Vai gravar no módulo do motor: ${paraGravar.map(c => "cilindro " + c.cilindro + " → " + c.codigo + " no campo " + c.campo).join("; ")}.</p>
        <${Campo} id="bico-adm-email" rotulo="Login do administrador (e-mail)">
          <input id="bico-adm-email" type="email" autocomplete="off" autocapitalize="none" spellcheck=${false} value=${autoriza.email} onInput=${e => setAutoriza(a => ({ ...a, email: e.target.value }))} />
        </${Campo}>
        <${Campo} id="bico-adm-senha" rotulo="Senha do administrador">
          <input id="bico-adm-senha" type="password" autocomplete="off" value=${autoriza.senha} onInput=${e => setAutoriza(a => ({ ...a, senha: e.target.value }))} />
        </${Campo}>
        ${autoriza.erro ? html`<div class="erro" id="bico-adm-erro">${autoriza.erro}</div>` : null}
        <p class="nota">A senha não fica guardada no aparelho. Quem está logado no app continua o mesmo.</p>
        <button type="button" class="btn-acao" id="bico-adm-ok" disabled=${!autoriza.email || !autoriza.senha || autoriza.conferindo} onClick=${autorizarEGravar}>${autoriza.conferindo ? "Conferindo…" : "AUTORIZAR E GRAVAR"}</button>
        <button type="button" class="btn-barra claro" style="justify-content:center;margin-top:8px" onClick=${cancelarAutorizacao}>Cancelar</button>
      </${Quadro}>` : null}
    `}
  </${Tela}>`;
}

/* ---------------- PARÂMETROS (era um cartão dentro do OBD) ---------------- */
function ParametrosTela() {
  return html`<${Tela} tela="parametros" ajuda="A referência de faixa normal que o app usa para decidir se um valor está bom ou ruim, com a fonte de cada uma. Fica aqui, e não escondida dentro da leitura, porque é o que você consulta para discutir um laudo.">
    <${Parametros} />
    <${Cartao} titulo="Escala e faixa normal não são a mesma coisa" id="param-escala">
      <p>Escala é o tamanho do mostrador: de onde até onde o ponteiro anda. Faixa normal é o que aquele motor deve marcar trabalhando bem. Misturar as duas é o jeito mais fácil de dar um laudo errado.</p>
      <p class="nota">Desde 20/11/2026 o app também sabe PEDIR a escala ao próprio módulo, pelo serviço 0x24 do UDS. Quando o módulo responde, quem manda é ele; o catálogo fica só para a faixa normal, que nenhum módulo informa.</p>
    </${Cartao}>
  </${Tela}>`;
}


export { Obd, Modulos, Atuadores, Aprendizados, Bico, ParametrosTela };
