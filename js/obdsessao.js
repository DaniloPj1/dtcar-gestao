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
  erro: "",
  dono: "",                // quem tem a vez agora ("" = livre)
});

let st = estadoInicial();
const ouvintes = new Set();
const avisar = () => {
  st = { ...st, acaoCorrendo: emAcao > 0 };
  for (const f of [...ouvintes]) { try { f(st); } catch (e) { /* tela já saiu */ } }
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
  if (st.dono && st.dono !== quem) {
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
let relogioSaida = null;
export function saindoDaTela() {
  if (relogioSaida) clearTimeout(relogioSaida);
  relogioSaida = setTimeout(() => { relogioSaida = null; if (!ouvintes.size && !emAcao) desligar(); }, 400);
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
export async function tomar(quem, tarefa, { pausaFundo = false } = {}) {
  if (st.dono && st.dono !== quem) {
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
