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
import { useApp, Ic, ir, Cartao, KV, Campo, Quadro, usarPlaca, BuscaPlaca, Veiculo, Tela, usarPasso } from "./comum.js";

const SELO_DTC = { atual: ["ATUAL", "ruim"], pendente: ["PENDENTE", "atencao"], permanente: ["PERMANENTE", "atencao"] };

// Mostrador do painel de dados ao vivo: arco de 270° com o número grande no meio, como num scanner.
// O rótulo é SEMPRE escrito (quem lê está embaixo do carro, com pressa: ponteiro sozinho não informa).
// R e as voltas do arco são fixos para o desenho não depender de medir a tela.
const M_R = 34, M_VOLTA = 2 * Math.PI * M_R, M_ARCO = M_VOLTA * 0.75;
/** número do jeito que se escreve aqui: vírgula decimal */
const numBR = n => String(n).replace(".", ",");
function Mostrador({ l }) {
  const tem = typeof l.de === "number" && typeof l.ate === "number" && l.ate > l.de;
  const parte = tem ? Math.max(0, Math.min(1, (l.valor - l.de) / (l.ate - l.de))) : 0;
  return html`<div class="mostrador" data-pid=${l.pid} data-chave=${l.chave}>
    <div class="mostrador-rot">${l.rotulo}</div>
    ${tem ? html`<svg class="mostrador-arco" viewBox="0 0 86 86" aria-hidden="true">
      <g transform="rotate(135 43 43)">
        <circle cx="43" cy="43" r=${M_R} class="trilho" stroke-dasharray=${M_ARCO + " " + M_VOLTA} />
        <circle cx="43" cy="43" r=${M_R} class="cheio" stroke-dasharray=${(M_ARCO * parte) + " " + M_VOLTA} />
      </g>
    </svg>` : null}
    <div class=${"mostrador-num" + (tem ? " dentro" : "")}>
      <b>${numBR(l.valor)}</b>${l.unidade ? html`<span>${l.unidade}</span>` : null}
    </div>
    ${tem ? html`<div class="mostrador-pes"><span>${numBR(l.de)}</span><span>${numBR(l.ate)}</span></div>` : null}
  </div>`;
}

// Uma leitura na visão LISTA: cabe mais na tela que o mostrador e continua mostrando a posição
// na escala, numa barra fina. O rótulo é sempre escrito e o valor fica grande, porque quem lê
// está embaixo do carro.
function LinhaViva({ l }) {
  const tem = typeof l.de === "number" && typeof l.ate === "number" && l.ate > l.de;
  const parte = tem ? Math.max(0, Math.min(1, (l.valor - l.de) / (l.ate - l.de))) : 0;
  return html`<div class="linha-viva" data-pid=${l.pid} data-chave=${l.chave}>
    <div class="linha-viva-topo">
      <span class="linha-viva-rot">${l.rotulo}</span>
      <b class="linha-viva-num">${numBR(l.valor)}${l.unidade ? html`<span>${l.unidade}</span>` : null}</b>
    </div>
    ${tem ? html`<div class="linha-viva-barra"><i style=${"width:" + (parte * 100).toFixed(1) + "%"}></i></div>` : null}
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
  const { dados, cfg, perfil } = useApp();
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
    try { return window.localStorage.getItem("obd_jeito") === "lista" ? "lista" : "painel"; } catch (e) { return "painel"; }
  });
  const trocarJeito = j => {
    setJeito(j);
    try { window.localStorage.setItem("obd_jeito", j); } catch (e) { /* sem espaço: segue sem guardar */ }
  };
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
  useEffect(() => { (async () => {
    let l = [];
    try { l = JSON.parse(window.localStorage.getItem("obd_pendentes") || "[]"); } catch (e) { return; }
    if (!l.length) return;
    const restam = [];
    for (const reg of l) {
      const { guardado_em, ...linha } = reg;
      try { await api.obd.registrar(linha); } catch (e) { restam.push(reg); }
    }
    try { window.localStorage.setItem("obd_pendentes", JSON.stringify(restam)); } catch (e) { /* segue */ }
  })(); }, []);

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
    try { await fn(); } catch (e) { setErro(obd.motivoDe(e)); } finally { setOcupado(""); }
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
    const minha = ++contador.current;
    rodada.current = minha;
    setErro("");
    setRes(null);                                                   // uma leitura por vez na tela
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
        (v, volta) => { if (rodada.current === minha) setVivo(x => ({ valores: Object.assign({}, (x && x.valores) || {}, { [v.chave]: v }), volta, rodando: true, modo })); },
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
      window.localStorage.setItem("obd_pendentes", JSON.stringify(l.slice(-20)));
    } catch (e) { /* sem espaço: o aviso na tela é o que resta */ }
  };
  const carregarAnteriores = async () => {
    try { setAntesApagados(await api.obd.listar({ placa, limite: 5 })); } catch (e) { setAntesApagados(null); }
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
    const odometro = await obd.lerOdometro(lig.pidsSuportados);
    guardar("conf", { monitores, chassi, odometro });
  }); };

  const v = pl.veic;
  // o chassi do cadastro vem da ficha do veículo (a busca por placa não carrega esse campo)
  const noBanco = v && v.id ? dados.veiculos.find(x => x.id === v.id) : null;
  const chassiCadastro = String((noBanco && noBanco.chassi) || (v && v.chassi) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  return html`<${Tela} tela="obd" ajuda="Encaixe o adaptador na tomada do carro, ligue a ignição (chave na posição 2) e conecte. O app lê o módulo do MOTOR: códigos de falha, dados ao vivo, chassi, prontidão dos monitores, a foto do momento da falha e os testes de bordo. ABS, airbag e câmbio não saem por aqui: isso continua no scanner da oficina. Nesta etapa nada é gravado e nenhuma falha é apagada.">

    ${!temPlugin ? html`<${Cartao} titulo="Precisa do APK novo">
      <p class="nota" style="font-size:13.5px">A leitura OBD é a primeira coisa do app que depende de uma parte nativa: o Bluetooth do adaptador não existe dentro das telas do site. Gere o APK novo em GitHub › Actions › "App DTCar (gerar APK)", desinstale o app antigo do celular e instale o novo. Depois disso as telas voltam a chegar sozinhas, como sempre.</p>
    </${Cartao}>` : null}

    ${temPlugin ? html`
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
          <div class="kv"><span>Situação:</span><i></i><b><span class="selo">CONECTADO</span>${lig.nome}</b></div>
          ${lig.protocolo ? html`<${KV} a="Protocolo" b=${lig.protocolo} p />` : null}
          ${lig.versao ? html`<${KV} a="Adaptador" b=${lig.versao} p />` : null}
          ${lig.aviso ? html`<div class="erro" id="obd-clone">${lig.aviso}</div>` : null}
          <button type="button" class="btn-barra claro" id="obd-desligar" style="justify-content:center" onClick=${desligar} disabled=${!!ocupado}>DESCONECTAR</button>
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
        <button type="button" class="btn-barra claro" id="obd-foto" onClick=${lerFoto}>FOTO DO MOMENTO DA FALHA</button>
        <button type="button" class="btn-barra claro" id="obd-cilindros" onClick=${lerCilindros}>FALHA POR CILINDRO</button>
        <button type="button" class="btn-barra claro" id="obd-testes" onClick=${lerTestes}>TESTES DE BORDO</button>
        ${podeApagar ? html`<button type="button" class="btn-barra apagar" id="obd-apagar" onClick=${abrirApagar}>APAGAR FALHAS (FICA REGISTRADO)</button>` : null}
        <div class="nota">${falhasVivo && falhasVivo.novas.length ? "Apareceu código com o motor trabalhando. Toque no botão vermelho para ver quais."
          : vivo && vivo.rodando ? "Pedir outra leitura para os dados ao vivo: o adaptador atende um pedido por vez."
          : "Nada é gravado e nenhuma falha é apagada nesta etapa."}</div>
      </${Cartao}>` : null}

      ${lig && !ocupado ? html`<${Cartao} titulo="Serviços avançados" id="obd-avancado">
        <button type="button" class="btn-barra claro" id="obd-conf" onClick=${lerConf}>CHASSI, MONITORES E ODÔMETRO</button>
        <button type="button" class="btn-barra claro" id="obd-calib" onClick=${lerCalib}>CALIBRAÇÃO DO MÓDULO (REPROGRAMAÇÃO)</button>
        <button type="button" class="btn-barra claro" id="obd-ciclo" onClick=${lerCiclo}>TESTE DRIVE: MONITORES DESTE CICLO</button>
        <button type="button" class="btn-barra claro" id="obd-contadores" onClick=${lerContadores}>CONTADORES DE USO DOS MONITORES</button>
        <div class="nota">Leituras de perícia, não de reparo do dia: dizem se o módulo foi reprogramado, se o reparo fechou o monitor no test-drive e se os monitores deste carro chegam a rodar no uso real.</div>
      </${Cartao}>` : null}

      ${/* Os parâmetros saíram daqui e viraram tela (20/11/2026): eram um cartão para abrir e fechar
            no meio da leitura, e é o que se consulta para discutir um laudo — merece tela própria.
            Aqui fica só o caminho, para quem está lendo o carro e quer conferir a referência. */
        !ocupado ? html`<button type="button" class="btn-barra claro" id="obd-ir-parametros" onClick=${() => ir("parametros")}>
          <${Ic} n="sliders" t=${20} />VER OS PARÂMETROS DE REFERÊNCIA</button>` : null}

      ${lig && !ocupado && disponiveis.length ? html`<${Cartao} titulo="Quais leituras mostrar" id="obd-escolha">
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

      ${res && res.o === "falhas" ? html`<${Cartao} titulo=${"Falhas do motor" + (res.d.falhas.length ? " (" + res.d.falhas.length + ")" : "")} id="obd-r-falhas">
        ${!res.d.falhas.length ? html`<div class="vazio">Nenhuma falha gravada no módulo do motor.</div>` : null}
        ${res.d.falhas.map(f => html`<div key=${f.codigo + f.situacao} class="obd-dtc">
          <b>${f.codigo}</b><span class=${"selo " + SELO_DTC[f.situacao][1]}>${SELO_DTC[f.situacao][0]}</span></div>`)}
        ${res.d.falhas.length ? html`<div class="nota">O código é o que o módulo gravou; a descrição de código de montadora (P1 em diante) não é pública. ATUAL está confirmada, PENDENTE apareceu uma vez e ainda não confirmou, PERMANENTE só sai depois que o módulo refizer os testes.</div>` : null}
        ${res.d.variosModulos ? html`<div class="nota">Mais de um módulo do carro respondeu: a lista junta os códigos de todos. Sem o cabeçalho ligado não dá para dizer qual código é de qual módulo.</div>` : null}
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
          const comFaixa = lidos.filter(l => typeof l.de === "number");
          const resto = lidos.filter(l => typeof l.de !== "number");
          return html`
            <div class="obd-filtro" role="group" aria-label="Como mostrar os dados ao vivo">
              <button type="button" id="obd-jeito-painel" class=${jeito === "painel" ? "esc" : ""} aria-pressed=${jeito === "painel"} onClick=${() => trocarJeito("painel")}>PAINEL</button>
              <button type="button" id="obd-jeito-lista" class=${jeito === "lista" ? "esc" : ""} aria-pressed=${jeito === "lista"} onClick=${() => trocarJeito("lista")}>LISTA</button>
            </div>
            ${jeito === "painel" ? html`
              ${comFaixa.length ? html`<div class="painel-obd">${comFaixa.map(l => html`<${Mostrador} key=${l.chave} l=${l} />`)}</div>` : null}
              ${resto.length ? html`<div class="painel-resto">${resto.map(l => html`<${LinhaViva} key=${l.chave} l=${l} />`)}</div>` : null}`
            : html`<div class="lista-viva">
                ${obd.GRUPOS.map(g => {
                  const doGrupo = lidos.filter(l => obd.grupoDaLeitura(l) === g.id);
                  if (!doGrupo.length) return null;
                  return html`<div key=${g.id} class="lista-viva-grupo">
                    <h3>${g.nome}</h3>
                    ${doGrupo.map(l => html`<${LinhaViva} key=${l.chave} l=${l} />`)}
                  </div>`;
                })}
              </div>`}`;
        })()}
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

      <div class="nota" style="padding:0 2px 4px">Leitura de motor e emissões. ABS, airbag, câmbio e imobilizador exigem o scanner da oficina. O OBD-II não informa a quilometragem do painel.</div>
    ` : null}
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
  useEffect(() => {
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
  usarPasso(!!mod, () => { setMod(null); setFalhas(null); setEpti(null); });

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
    if (d.nrc != null) { setErro(d.texto); return; }
    setFalhas(d.codigos.map(uds.falhaPronta));
  };
  const descobrir = async () => {
    setOcupado("Perguntando ao módulo o que ele tem…"); setErro("");
    const r = await sessao.tomar("a descoberta", async () => {
      await uds.sessao(uds.SESSAO.estendida);
      return uds.descobrirEpti({ aoAndar: t => setOcupado(t) });
    });
    setOcupado("");
    if (!r.ok) { setErro(r.texto || "Não deu para perguntar."); return; }
    setEpti(r.r);
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
    setFalhas(null); await lerFalhas();
  };

  return html`<${Tela} tela="modulos" ajuda="Procura quem responde no carro e lê a falha de cada módulo, um por um. O OBD comum só fala com o motor e só mostra o que é de emissão; aqui aparecem câmbio, ABS, airbag e o resto — cada falha com a causa elétrica, quando o módulo informa o tipo.">
    ${!obd.disponivel() ? html`<div class="vazio">Esta tela funciona no aplicativo instalado no celular (APK), que é quem conversa com o adaptador.</div>`
      : !uds.podeAgir() ? html`<${PrecisaApk} />` : html`
      <${Adaptador} compacto=${!!st.ligado} />
      ${!mod ? html`<${EscolherModulo} aoEscolher=${escolher} />` : html`
        <${Cartao} titulo=${mod.nome || "Módulo " + mod.pedido} id="mod-escolhido">
          <${KV} a="Pede em" b=${mod.pedido} />
          <${KV} a="Responde em" b=${mod.resposta} />
          <button type="button" class="btn-barra" onClick=${lerFalhas} disabled=${!!ocupado || !!st.dono}><${Ic} n="obd" t=${20} />LER AS FALHAS DESTE MÓDULO</button>
          <button type="button" class="btn-barra claro" onClick=${descobrir} disabled=${!!ocupado || !!st.dono}><${Ic} n="search" t=${20} />PERGUNTAR O QUE ELE TEM</button>
          <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => { setMod(null); setFalhas(null); setEpti(null); sessao.soltarModulo(); }} disabled=${!!st.dono}>TROCAR DE MÓDULO</button>
        </${Cartao}>
        ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
        ${erro ? html`<div class="erro">${erro}</div>` : null}
        ${falhas ? html`<${Cartao} titulo=${"Falhas (" + falhas.length + ")"} id="mod-falhas">
          ${!falhas.length ? html`<div class="nota">Nenhuma falha gravada neste módulo.</div>` : falhas.map(f => html`
            <div key=${f.rotulo} class="diag-falha">
              <div class="diag-falha-topo"><b>${f.rotulo}</b>${f.pedeLuz ? html`<span class="selo ruim">LUZ NO PAINEL</span>` : null}</div>
              ${f.causa ? html`<div class="diag-falha-causa">${f.causa}</div>` : html`<div class="nota">O tipo ${hexDoTipo(f.tipoFalha)} não está na tabela da norma que o app tem: o número fica aí, sem palpite de causa.</div>`}
              <div class="nota">${f.situacaoTexto}</div>
            </div>`)}
          ${falhas.length && podeApagar ? html`<button type="button" class="btn-barra claro" style="justify-content:center;margin-top:8px" onClick=${apagar} disabled=${!!ocupado || !!st.dono}>APAGAR AS FALHAS DESTE MÓDULO</button>` : null}
          ${falhas.length && !podeApagar ? html`<div class="nota">Apagar falha não está liberado para o seu login.</div>` : null}
          ${falhas.length && podeApagar ? html`<p class="nota">O apagamento POR MÓDULO ainda não fica registrado no banco — a tabela de registro do OBD só aceita o apagar do OBD-II. Anote na O.S. o que foi apagado.</p>` : null}
        </${Cartao}>` : null}
        ${epti ? html`<${Cartao} titulo="O que o módulo respondeu" id="mod-epti">
          ${epti.sistemas.length ? html`<div class="sec"><h3>Sistemas que ele cuida</h3>
            ${epti.sistemas.map(s => html`<div key=${s.id} class="kv"><span>${s.id}:</span><i></i><b>${s.nome || "não está na lista da norma"}</b></div>`)}</div>` : null}
          <${KV} a="Rotinas que aceita" b=${epti.rotinas.length ? epti.rotinas.length + " rotina(s)" : "nenhuma informada"} />
          <${KV} a="Atuadores que aceita" b=${epti.atuadores.length ? epti.atuadores.length + " atuador(es)" : "nenhum informado"} />
          ${epti.invertido ? html`<div class="nota">Este módulo responde no jeito do rascunho da norma, com os dois identificadores trocados. O app corrigiu pelo conteúdo.</div>` : null}
          ${epti.avisos.map((a, i) => html`<div key=${i} class="nota">${a}</div>`)}
        </${Cartao}>` : null}
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
  const testar = async did => {
    setAlvo(null); setAndando({ passos: [] }); cancelar.current = false;
    // comAcao: pega a vez, para a leitura de fundo E TRAVA O DESLIGAMENTO enquanto o teste corre.
    // Sem a trava, trocar de tela ou de módulo no meio derrubava a conexão antes de o controle da
    // saída ser devolvido ao módulo — e saída presa no comando do aparelho queima peça.
    const r = await sessao.comAcao("o teste de atuador", () => uds.testarAtuador(did, {
      segundos: 5,
      pausar: sessao.pausar, retomar: sessao.retomar,
      continuar: () => !cancelar.current,
      aoAndar: p => setAndando({ passos: p.passos }),
    }));
    setAndando(a => ({ passos: (a && a.passos) || [], fim: r.ok ? r.r : { ok: false, texto: r.texto || "Não deu para rodar o teste." } }));
  };

  return html`<${Tela} tela="atuadores" ajuda="Manda o módulo acionar uma saída para você conferir no carro se a peça responde. O comando é curto de propósito, por segurança da própria norma, então o app fica repetindo enquanto o teste corre — e devolve o controle ao módulo no fim, no erro e se você sair.">
    ${!pode ? html`<${SemPermissao} o="Teste de atuador" />`
      : !obd.disponivel() ? html`<div class="vazio">Esta tela funciona no aplicativo instalado no celular (APK).</div>`
      : !uds.podeAgir() ? html`<${PrecisaApk} />` : html`
      <${Adaptador} compacto=${!!st.ligado} />
      ${!mod ? html`<${EscolherModulo} aoEscolher=${escolher} />` : html`
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
          <p class="nota">Este teste não fica registrado no banco: a tabela de registro do OBD ainda não aceita atuador. O apagar falha, sim, fica.</p>
        </${Cartao}>` : null}
      `}
    `}
    ${alvo ? html`<${Quadro} titulo="Acionar esta saída?" onFechar=${() => setAlvo(null)}>
      <p>O módulo vai acionar a saída <b>${hex4Txt(alvo.did)}</b> por cinco segundos. Antes de confirmar:</p>
      <p class="nota">• Veja se não há ninguém com a mão perto de ventoinha, correia ou polia.<br />
      • Saída de luz, bomba e ventoinha é segura de testar. Saída que move peça grande, não.<br />
      • O app devolve o controle ao módulo no fim. Se não conseguir, ele avisa e aí é desligar a chave.</p>
      <button type="button" class="btn-acao" onClick=${() => testar(alvo.did)}>ACIONAR AGORA</button>
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
  const rodar = async rid => {
    setAlvo(null); setAndando({ passos: [] }); cancelar.current = false;
    const r = await sessao.comAcao("o aprendizado", () => uds.rodarAprendizado(rid, {
      segundosMax: 120,
      pausar: sessao.pausar, retomar: sessao.retomar,
      continuar: () => !cancelar.current,
      aoAndar: p => setAndando({ passos: p.passos }),
    }));
    setAndando(a => ({ passos: (a && a.passos) || [], fim: r.ok ? r.r : { ok: false, texto: r.texto || "Não deu para rodar a rotina." } }));
  };

  return html`<${Tela} tela="aprendizados" ajuda="Roda rotina de aprendizado e calibração no módulo: adaptação, reset de serviço, zero do sensor de ângulo. O módulo trabalha sozinho depois do começar, e o app acompanha até terminar. Se ele recusar, a frase diz o que fazer — pôr em neutro, pisar no freio, aquecer o motor.">
    ${!pode ? html`<${SemPermissao} o="Rodar aprendizado" />`
      : !obd.disponivel() ? html`<div class="vazio">Esta tela funciona no aplicativo instalado no celular (APK).</div>`
      : !uds.podeAgir() ? html`<${PrecisaApk} />` : html`
      <${Adaptador} compacto=${!!st.ligado} />
      ${!mod ? html`<${EscolherModulo} aoEscolher=${escolher} />` : html`
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
          <p class="nota">Esta rotina não fica registrada no banco: a tabela de registro do OBD ainda não aceita aprendizado.</p>
        </${Cartao}>` : null}
      `}
    `}
    ${alvo ? html`<${Quadro} titulo="Rodar esta rotina?" onFechar=${() => setAlvo(null)}>
      <p>O módulo vai rodar a rotina <b>${hex4Txt(alvo.rid)}</b>. Aprendizado muda o jeito do módulo trabalhar, e não tem botão de desfazer.</p>
      <p class="nota">• Deixe a chave ligada e não mexa no carro enquanto a rotina corre.<br />
      • Se o módulo pedir condição (neutro, freio, temperatura), o app mostra o que falta.<br />
      • Pode levar até dois minutos.</p>
      <button type="button" class="btn-acao" onClick=${() => rodar(alvo.rid)}>RODAR AGORA</button>
      <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => setAlvo(null)}>Cancelar</button>
    </${Quadro}>` : null}
  </${Tela}>`;
}

/* ---------------- PROGRAMAR BICO ---------------- */
function Bico() {
  const st = usarSessao();
  const { cfg, perfil } = useApp();
  const pl = usarPlaca();
  const [cilindros, setCilindros] = useState(4);
  const [itens, setItens] = useState(() => [1, 2, 3, 4].map(c => ({ cilindro: c, codigo: "", trocado: false })));
  const [mostrarPlano, setMostrarPlano] = useState(false);
  const pode = podeGravarObd(cfg, perfil);
  usarPasso(mostrarPlano, () => setMostrarPlano(false));

  const trocarQtd = n => {
    setCilindros(n);
    setItens(anteriores => Array.from({ length: n }, (_, i) => anteriores[i] || { cilindro: i + 1, codigo: "", trocado: false }));
  };
  const mexer = (i, p) => setItens(l => l.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const conf = bico.conferirConjunto(itens, cilindros);
  const plano = bico.plano({ cilindros: conf.paraGravar, temChave: false });

  return html`<${Tela} tela="bico" ajuda="Grava na ECU o código que veio escrito no bico recodificado. O código IMA tem 7 caracteres e não usa 0, 9, I, J nem Q — então o app confere a digitação antes de qualquer coisa. Só grava o cilindro que você marcar como trocado.">
    ${!pode ? html`<${SemPermissao} o="Programar bico" />` : html`
      <${BuscaPlaca} id="bico-placa" titulo="Placa do carro (opcional)" pl=${pl} />
      ${pl.veic ? html`<${Veiculo} v=${pl.veic} />` : null}

      <${Cartao} titulo="Onde o app chega hoje" id="bico-limite">
        <p>A gravação em si está pronta, e a conferência do código também. O que falta para fechar a corrente, e é honesto dizer antes de você digitar:</p>
        <div class="passo">1. O número do campo de cada cilindro muda de família para família de ECU, e não existe tabela pública confiável. Sem ele o app não sabe ONDE gravar.</div>
        <div class="passo">2. Quase toda ECU exige destravar a adaptação antes (o 0x27), e a conta da chave depende da família.</div>
        <p class="nota">Então hoje esta tela confere o código, monta o plano e mostra onde para. Ela não grava no escuro: gravar no campo errado de uma ECU diesel é prejuízo, não é tentativa.</p>
      </${Cartao}>

      <${Cartao} titulo="Os códigos dos bicos" id="bico-codigos">
        <${Campo} id="bico-qtd" rotulo="Quantos cilindros">
          <select id="bico-qtd" value=${String(cilindros)} onChange=${e => trocarQtd(Number(e.target.value))}>
            ${[3, 4, 5, 6, 8].map(n => html`<option key=${n} value=${String(n)}>${n} cilindros</option>`)}
          </select>
        </${Campo}>
        ${itens.map((it, i) => {
          const v = it.codigo ? bico.validarIma(it.codigo) : null;
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
          </div>`;
        })}
        <p class="nota">O código está gravado a laser no corpo do bico. Ele não usa 0, 9, I, J nem Q: o que parece 0 é a letra O, e o que parece I é o número 1.</p>
      </${Cartao}>

      ${conf.avisos.length ? html`<${Cartao} titulo="Confira antes" id="bico-avisos">
        ${conf.avisos.map((a, i) => html`<div key=${i} class=${a.grave ? "erro" : "nota"}>${a.t}</div>`)}
      </${Cartao}>` : null}

      ${/* O plano só aparece quando NÃO há aviso grave. Mostrar o plano com um código repetido ou
            inválido na tela faz parecer que está pronto para gravar, e o que se lê é a sequência,
            não o aviso. Primeiro resolve o aviso; depois aparece o que vai acontecer no carro. */
        conf.podeGravar ? html`<${Cartao} titulo="O que vai acontecer no carro" id="bico-plano">
        ${plano.map((p, i) => html`<div key=${i} class=${"passo" + (p.trava ? " ruim" : "")}>${i + 1}. ${p.t}</div>`)}
        <button type="button" class="btn-barra" disabled=${true} style="justify-content:center">GRAVAR (falta o número do campo desta ECU)</button>
        <p class="nota">O botão fica desligado de propósito enquanto o app não souber o campo certo desta família de ECU. Quando entrar, ele liga — e a sequência é essa aí, com a leitura de volta conferindo o que ficou gravado.</p>
      </${Cartao}>` : null}
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
