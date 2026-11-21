/**
 * A conexão com o adaptador, viva ACIMA das telas.
 *
 * POR QUE ISTO EXISTE: o diagnóstico deixou de ser uma tela e passou a ser uma família de telas —
 * leitura do dia a dia, módulos do carro, atuadores, aprendizados, programar bico, parâmetros. No
 * app cada troca de tela desmonta a anterior, e a conexão morava dentro da tela do OBD. Do jeito
 * antigo, sair da leitura para testar um atuador derrubava o adaptador e obrigava a conectar de
 * novo — com o carro no elevador e o mecânico com a mão suja.
 *
 * Então a conexão mora aqui, num módulo, que não é desmontado quando a tela troca. As telas
 * ASSINAM e recebem o estado; quem desliga é sair da família de diagnóstico, não trocar de tela.
 *
 * DUAS COISAS QUE O ELM327 OBRIGA:
 *  1. UM PEDIDO POR VEZ. O adaptador não atende dois. Por isso existe a tomada (`tomar`): quem vai
 *     conversar pega a vez, e quem não conseguiu espera em vez de atropelar. Sem isso, abrir a tela
 *     de atuador enquanto a leitura ao vivo roda faz a resposta de um pedido voltar para o outro.
 *  2. A LEITURA DE FUNDO TEM DE PARAR antes de um comando que age no carro. É o que o projeto
 *     aberto do MG elétrico faz, e é por isso que `pausar`/`retomar` são parte da tomada, e não
 *     uma gentileza: o comando de acionamento no meio da roda de leitura volta trocado.
 *
 * Não tem window nem document: dá para testar sem navegador.
 */
import * as obd from "./obd.js";
import * as uds from "./uds.js";

/** As telas que formam a família de diagnóstico. Sair de TODAS elas é que desliga o adaptador. */
export const FAMILIA = ["obd", "modulos", "atuadores", "aprendizados", "bico", "parametros"];
export const naFamilia = rota => FAMILIA.includes(rota);

const estadoInicial = () => ({
  acaoCorrendo: false,
  ligado: false,
  ligando: false,
  aparelho: null,          // { nome, endereco }
  protocolo: "",
  versao: "",
  aviso: "",
  pidsSuportados: [],
  modulo: null,            // { pedido, resposta, nome } quando está falando UDS com um módulo
  carro: null,             // { placa, marca, modelo, ano, veiculo_id, chassiCadastro, vin } — o carro em que o adaptador está
  erro: "",
  dono: "",                // quem tem a vez agora ("" = livre)
});

let st = estadoInicial();
const ouvintes = new Set();
// Quem só OBSERVA (o caderno do carro) não é tela: não segura a conexão quando todas as telas saem.
const observadores = new Set();
export function observar(fn) { observadores.add(fn); return () => observadores.delete(fn); }
const avisar = () => {
  st = { ...st, acaoCorrendo: emAcao > 0 };
  for (const f of [...ouvintes]) { try { f(st); } catch (e) { /* tela já saiu */ } }
  for (const f of [...observadores]) { try { f(st); } catch (e) { /* segue */ } }
};
const mexer = p => { st = { ...st, ...p }; avisar(); };

/** A tela assina e recebe o estado a cada mudança. Devolve a função de cancelar. */
export function assinar(fn) {
  ouvintes.add(fn);
  try { fn(st); } catch (e) { /* segue */ }
  return () => ouvintes.delete(fn);
}
export const estado = () => st;

/* ------------------------------------------------------------------ ligar e desligar */

// O ÚLTIMO ADAPTADOR (pedido do Danilo, 21/11/2026): o app guarda em qual adaptador conectou por
// último, e o botão CONECTAR vai direto nele, sem a pessoa apontar qual. Fica no aparelho.
const CHAVE_ULTIMO = "obd_ultimo_adaptador";
const cofreLocal = () => { try { return typeof window !== "undefined" ? window.localStorage : null; } catch (e) { return null; } };
export function ultimoAparelho() {
  try { const c = cofreLocal(); const v = c && JSON.parse(c.getItem(CHAVE_ULTIMO) || "null"); return v && v.endereco ? v : null; } catch (e) { return null; }
}
function lembrarAparelho(ap) { try { const c = cofreLocal(); if (c && ap && ap.endereco) c.setItem(CHAVE_ULTIMO, JSON.stringify({ endereco: ap.endereco, nome: ap.nome || "" })); } catch (e) { /* sem espaço */ } }
export function esquecerAparelho() { try { const c = cofreLocal(); if (c) c.removeItem(CHAVE_ULTIMO); } catch (e) { /* segue */ } }

export async function ligar({ endereco, nome } = {}) {
  if (st.ligando) return st;
  mexer({ ligando: true, erro: "" });
  try {
    await obd.conectar(endereco);
    const r = await obd.iniciar();
    mexer({
      ligado: true, ligando: false, aparelho: { nome: nome || "", endereco },
      protocolo: r.protocolo || "", versao: r.versao || "", aviso: r.aviso || "",
      pidsSuportados: r.pidsSuportados || [], erro: "", modulo: null,
    });
    lembrarAparelho({ endereco, nome: nome || "" });
  } catch (e) {
    mexer({ ligado: false, ligando: false, erro: obd.motivoDe(e) });
  }
  return st;
}

/**
 * Quantas ações que AGEM no carro estão correndo agora.
 *
 * Existe por um defeito que a revisão independente de 20/11/2026 apontou e que podia QUEIMAR PEÇA:
 * o teste de atuador mantém a saída acionada repetindo o comando, e desfaz isso devolvendo o
 * controle ao módulo no fim. Se a conexão caísse no meio — trocar de tela, sair da família, tocar
 * em "trocar de módulo" — a devolução falhava e a saída ficava presa no comando do aparelho.
 *
 * Com este contador, desligar e soltar o módulo ficam BLOQUEADOS enquanto uma ação corre, e a saída
 * da tela não derruba a conexão. É trava, não sugestão: quem acionou é quem devolve.
 */
let emAcao = 0;
export const temAcaoCorrendo = () => emAcao > 0;

/**
 * Envolve uma ação que age no carro: pega a vez, para a leitura de fundo, trava o desligamento
 * enquanto corre e devolve tudo no fim, aconteça o que acontecer.
 */
export async function comAcao(quem, tarefa) {
  if (st.dono) {
    return { ok: false, ocupado: st.dono, texto: "O adaptador está ocupado com " + st.dono + ". Espere terminar." };
  }
  emAcao++;
  try {
    return await tomar(quem, tarefa, { pausaFundo: true });
  } finally {
    emAcao = Math.max(0, emAcao - 1);
    avisar();
  }
}

export async function desligar() {
  // Não desliga por cima de uma ação em curso: a saída acionada tem de ser devolvida primeiro.
  if (emAcao) return;
  pararTudo();
  try { if (st.modulo) await uds.fechar(); } catch (e) { /* segue */ }
  try { await obd.desconectar(); } catch (e) { /* segue */ }
  st = estadoInicial();
  avisar();
}

/**
 * Sair de uma tela da família NÃO desliga na hora: espera um instante.
 * Trocar de tela desmonta a que sai antes de montar a que entra, então um desligamento imediato
 * cortaria a conexão no meio de uma troca entre duas telas de diagnóstico. A espera curta é
 * cancelada pela tela seguinte, e só vira desligamento de verdade quando ninguém assume.
 */
// A CONEXÃO FICA (pedido do Danilo, 21/11/2026): uma vez conectado, o adaptador continua ligado no
// carro até o app ser fechado, o adaptador sair da tomada ou a pessoa tocar em DESCONECTAR. Sair das
// telas do carro (voltar ao Início, abrir uma O.S.) NÃO desliga mais. Antes desligava ao sair da família.
let relogioSaida = null;
export function saindoDaTela() {
  if (relogioSaida) { clearTimeout(relogioSaida); relogioSaida = null; }
}
export function entrandoNaTela() {
  if (relogioSaida) { clearTimeout(relogioSaida); relogioSaida = null; }
}

/* ------------------------------------------------------------------ a vez de conversar */

const pausadores = new Set();   // quem tem leitura de fundo rodando e sabe parar e voltar

/**
 * Registra uma leitura de fundo que precisa parar quando outra coisa for conversar com o carro.
 * `parar` e `voltar` são da própria tela: ela sabe como interromper a roda dela.
 */
export function registrarLeituraDeFundo(parar, voltar) {
  const p = { parar, voltar };
  pausadores.add(p);
  return () => pausadores.delete(p);
}

async function pausarFundo() {
  for (const p of [...pausadores]) { try { await p.parar(); } catch (e) { /* segue */ } }
}
async function retomarFundo() {
  for (const p of [...pausadores]) { try { await p.voltar(); } catch (e) { /* segue */ } }
}
export const pausar = pausarFundo;
export const retomar = retomarFundo;
export function pararTudo() { for (const p of [...pausadores]) { try { p.parar(); } catch (e) { /* segue */ } } }

/**
 * Pega a vez de conversar com o adaptador, roda a tarefa e devolve a vez.
 *
 * `quem` é só para a tela poder dizer "o atuador está usando o adaptador". Se alguém já tem a vez,
 * recusa na hora em vez de enfileirar: no celular, comando que fica esperando sem explicação é
 * pior que comando recusado com motivo.
 *
 * Com `pausaFundo`, a leitura de fundo é parada antes e retomada depois — é o que todo comando que
 * AGE no carro precisa.
 */
/** Trabalho que o app faz sozinho, em segundo plano. Quem a pessoa pediu NÃO espera atrás dele sem fim. */
export const DE_FUNDO = "o mapeamento do carro";

export async function tomar(quem, tarefa, { pausaFundo = false } = {}) {
  // Se quem está com a vez é o trabalho de fundo, o pedido da pessoa espera a pergunta em curso
  // terminar (uma só, de até uns 2 s) em vez de ser recusado: o que a pessoa toca tem prioridade.
  for (let i = 0; st.dono === DE_FUNDO && quem !== DE_FUNDO && i < 40; i++) await new Promise(f => setTimeout(f, 100));
  // A vez é de UMA tarefa, não de um nome: duas tarefas com o mesmo nome (dois toques seguidos em
  // dois módulos) não podem correr juntas — os comandos se intercalariam e a primeira a terminar
  // soltaria a vez com a outra ainda falando.
  if (st.dono) {
    return { ok: false, ocupado: st.dono, texto: "O adaptador está ocupado com " + st.dono + ". Espere terminar." };
  }
  mexer({ dono: quem });
  let pausou = false;
  try {
    if (pausaFundo) { await pausarFundo(); pausou = true; }
    const r = await tarefa();
    return { ok: true, r };
  } catch (e) {
    const motivo = obd.motivoDe(e);
    // conexão caída é estado, não só erro: a tela precisa saber que não está mais ligado
    if (/conex|cone/i.test(motivo)) mexer({ ligado: false, erro: motivo, modulo: null });
    return { ok: false, texto: motivo, erro: (e && e.message) || "falhou" };
  } finally {
    mexer({ dono: "" });
    if (pausou) await retomarFundo();
  }
}

/* ------------------------------------------------------------------ falar com um módulo */

/**
 * Aponta o adaptador para um módulo e deixa a sessão pronta para o UDS.
 * Guarda qual módulo está apontado, porque toda tela da família precisa saber com quem está
 * falando — e porque trocar de módulo sem avisar é o jeito mais fácil de ler o dado de um e
 * escrever no outro.
 */
export async function apontarModulo(mod) {
  const r = await tomar("a conexão do módulo", async () => {
    await uds.abrir({ pedido: mod.pedido, resposta: mod.resposta });
    return true;
  });
  if (r.ok) mexer({ modulo: { ...mod } });
  return r;
}

export async function soltarModulo() {
  if (!st.modulo || emAcao) return;
  await tomar("a conexão do módulo", () => uds.fechar());
  mexer({ modulo: null });
}

/** Zera tudo (usado pelo teste). */
export function reiniciarParaTeste() {
  ouvintes.clear(); pausadores.clear(); emAcao = 0;
  if (relogioSaida) { clearTimeout(relogioSaida); relogioSaida = null; }
  st = estadoInicial();
}

/* ------------------------------------------------------------------ o carro da vez */
/**
 * O carro em que o adaptador está, visto por TODAS as telas da família. Antes só a tela "Ler o
 * carro" sabia a placa; a de módulos lia falha sem saber a marca e não tinha como explicar um
 * código de montadora. Quem descobre um pedaço (a placa buscada, o chassi lido do módulo) junta
 * aqui. Trocar de placa começa um carro novo: chassi lido de um carro não vale para o outro.
 */
export function definirCarro(parcial) {
  const antes = st.carro || {};
  const p = parcial || {};
  const trocou = p.placa !== undefined && antes.placa && p.placa !== antes.placa;
  const novo = Object.assign({}, trocou ? {} : antes, p);
  if (JSON.stringify(novo) !== JSON.stringify(st.carro)) mexer({ carro: novo });
}
export const carro = () => st.carro || {};
