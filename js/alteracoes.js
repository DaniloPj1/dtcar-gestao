// Etapa 3 do programa para Windows: alterar O.S. sem internet.
// No programa com o banco do PC carregado, sem internet, as três gravações da O.S. (campos/etapa, peças e serviços, histórico)
// vão para o banco do PC (a tela já mostra) e para a fila de envio (js/fila.js). Quando a internet volta, a fila é enviada na
// ordem em que tudo foi feito, com as regras de conflito de api.sincronizarAlteracao (js/api.js).
//
// Regras do que pode ser feito sem internet (o resto continua precisando do servidor, com aviso claro):
//   - O.S. em aberto (orçamento, aprovado/execução, aguardando pagamento): editar dados, peças e serviços, mudar a etapa, cancelar.
//   - Não: entregar/retirar/receber/fechar (recibo e pagamento ficam no servidor), mexer em O.S. fechada ou cancelada,
//     fotos e assinaturas.
//   - O.S. com número provisório (PROV-NN) continua com a tela própria até ser numerada.
// Enquanto uma O.S. tem alteração na fila, TUDO dela passa pela fila (mesmo com internet), para nada ser gravado fora de ordem.
import { fila } from "./fila.js";
import { gravarLocal, removerLocal, umLocal, porOrdemLocal, leitorLocal, metaLocal } from "./replica.js";
import { uuid } from "./util.js";

const FECHADAS = ["entregue", "cancelado"];
// campos da entrega/retirada (inclusive de O.S. recusada, que continua "recusado"): só com internet
const CAMPOS_ENTREGA = ["entregue_em", "km_saida", "assinatura_entrega", "garantia_dias", "forma_pagamento"];
const agora = () => new Date().toISOString();

// comparação pelo conteúdo: o banco devolve objetos (jsonb) com as chaves em outra ordem e datas com hora noutro formato
// ("…Z" × "…+00:00"); sem isso, uma alteração reenviada ou em sequência viraria conflito falso
const canon = v => v == null ? null
  : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !isNaN(Date.parse(v)) ? new Date(v).toISOString()
  : Array.isArray(v) ? v.map(canon)
  : typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canon(v[k])]))
  : v;
export const iguais = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
// conteúdo de um item sem as datas do servidor (a base da conferência de conflito é o conteúdo, não a data:
// várias alterações seguidas do mesmo item feitas aqui não entram em conflito entre si)
const SEM_DATA = ["atualizado_em", "criado_em"];
export const conteudoItem = i => Object.fromEntries(Object.entries(i || {}).filter(([k]) => !SEM_DATA.includes(k) && !k.startsWith("_")));
export const mesmoConteudo = (base, atual) => Object.keys(base).every(k => iguais(base[k], atual[k]));

// trava única para o banco do PC: gravações daqui, troca de uma O.S. pela versão do online, réplica + reaplicação da fila e a
// leitura da O.S. com pendência acontecem uma de cada vez (nunca a tela lê ou grava no meio de uma troca)
let trava = Promise.resolve();
export function comTrava(fn) { const r = trava.then(fn, fn); trava = r.catch(() => {}); return r; }

/** o servidor tem a função de envio (supabase/v15.sql)? Sem ela, sem internet o programa só consulta */
export async function podeAlterarSemInternet() { try { return (await metaLocal("v15")) === "true"; } catch (e) { return false; } }

// geração da carga do sistema antigo (espelho) em que a alteração foi feita: outra carga recria as O.S. com os mesmos ids.
// Vale a dos ajustes que a tela está usando (vêm do online quando há internet); sem eles, a do banco do PC.
let geracaoTela;
export const definirGeracaoEspelho = g => { geracaoTela = g || null; };
async function geracaoEspelho() {
  if (geracaoTela !== undefined) return geracaoTela;
  try { const c = await leitorLocal.config(); return (c && c.ultimoEspelho && c.ultimoEspelho.em) || null; } catch (e) { return null; }
}

async function ordemAberta(id) {
  const o = await umLocal("ordens", id);
  if (!o) throw new Error("Sem internet: esta O.S. não está no banco do PC. A alteração fica para quando a conexão voltar.");
  if (FECHADAS.includes(o.status)) throw new Error("Sem internet: O.S. " + (o.status === "entregue" ? "entregue" : "cancelada") + " não pode ser alterada. Aguarde a conexão.");
  return o;
}

/** campos e etapa da O.S. (api.atualizarOrdem). sempre: enfileira mesmo sem diferença para o banco do PC (falha no meio do envio online) */
export const alterarOrdemOffline = (id, patch, opt) => comTrava(() => alterarOrdem(id, patch, opt));
async function alterarOrdem(id, patch, { sempre = false } = {}) {
  if (patch.status === "entregue" || CAMPOS_ENTREGA.some(k => k in patch))
    throw new Error("Sem internet: entregar, retirar, receber e fechar a O.S. precisam de internet (recibo e pagamento ficam no servidor).");
  const o = await ordemAberta(id);
  const antes = Object.fromEntries(Object.keys(patch).map(k => [k, o[k] ?? null]));
  if (!sempre && Object.keys(patch).every(k => iguais(o[k], patch[k]))) return; // nada mudou
  await fila.adicionar({ id: uuid(), tipo: "alterar_os", ordem_id: id, numero: o.numero, criado_em: agora(), espelho: await geracaoEspelho(), status_base: o.status, patch, antes });
  await gravarLocal("ordens", [{ ...o, ...patch }]);
}

/** peças e serviços (api.salvarItens): só o que mudou de verdade vai para a fila (sempre: todos os enviados) */
export const salvarItensOffline = (ordemId, itens, removidos, opt) => comTrava(() => salvarItens(ordemId, itens, removidos || [], opt));
async function salvarItens(ordemId, itens, removidos = [], { sempre = false } = {}) {
  const o = await ordemAberta(ordemId);
  const atuais = new Map((await porOrdemLocal("os_itens", ordemId)).map(i => [String(i.id), i]));
  const linhas = itens.map((i, n) => {
    const l = { ...Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith("_"))), ordem_id: ordemId, posicao: i.posicao ?? n };
    if (!l.id) l.id = uuid();
    return l;
  });
  const mudaram = sempre ? linhas : linhas.filter(l => { const a = atuais.get(String(l.id)); return !a || Object.keys(conteudoItem(l)).some(k => !iguais(a[k], l[k])); });
  const rem = (removidos || []).map(String).filter(id => sempre || atuais.has(id));
  if (!mudaram.length && !rem.length) return;
  // base de cada item: o conteúdo como estava aqui ("novo" = criado aqui; null = não estava no banco do PC)
  const base = Object.fromEntries([...mudaram.map(l => String(l.id)), ...rem].map(id => { const a = atuais.get(id); return [id, a ? conteudoItem(a) : (rem.includes(id) ? null : "novo")]; }));
  await fila.adicionar({ id: uuid(), tipo: "itens_os", ordem_id: ordemId, numero: o.numero, criado_em: agora(), espelho: await geracaoEspelho(), itens: mudaram, removidos: rem, antes: { status: o.status, itens: base } });
  await gravarLocal("os_itens", mudaram.map(l => ({ ...(atuais.get(String(l.id)) || {}), ...l })));
  await removerLocal("os_itens", rem);
}

/** histórico da O.S. (api.evento). criado_em vem de quem chamou: é a identidade do evento (reenvio não duplica) */
export const eventoOffline = (ordem_id, tipo, texto, usuario_nome, criado_em) => comTrava(() => evento(ordem_id, tipo, texto, usuario_nome, criado_em || agora()));
async function evento(ordem_id, tipo, texto, usuario_nome, criado_em) {
  const o = await umLocal("ordens", ordem_id);
  const local_id = "local-" + uuid();
  await fila.adicionar({ id: uuid(), tipo: "evento_os", ordem_id, numero: o ? o.numero : "", criado_em, espelho: await geracaoEspelho(), local_id, evento: { ordem_id, tipo, texto, usuario_nome, criado_em } });
  if (o) await gravarLocal("eventos", [{ id: local_id, ordem_id, tipo, texto, usuario_nome, criado_em }]);
}

/** a réplica trouxe a versão do online: aplica de novo no banco do PC o que ainda está na fila (a tela continua mostrando o trabalho pendente) */
export const reaplicarPendentes = () => comTrava(reaplicar);
/** réplica do online + reaplicação da fila, sem ninguém ler ou gravar a O.S. no meio */
export const replicarComFila = fn => comTrava(async () => { try { return await fn(); } finally { await reaplicar(); } });
async function reaplicar() {
  const l = (await fila.listar()).filter(ehAlteracao).sort((a, b) => (a.criado_em < b.criado_em ? -1 : a.criado_em > b.criado_em ? 1 : a.seq - b.seq));
  for (const op of l) {
    try {
      if (op.tipo === "alterar_os") { const o = await umLocal("ordens", op.ordem_id); if (o) await gravarLocal("ordens", [{ ...o, ...op.patch }]); }
      else if (op.tipo === "itens_os") {
        const atuais = new Map((await porOrdemLocal("os_itens", op.ordem_id)).map(i => [String(i.id), i]));
        await gravarLocal("os_itens", op.itens.map(i => ({ ...(atuais.get(String(i.id)) || {}), ...i }))); await removerLocal("os_itens", op.removidos);
      } else if (op.tipo === "evento_os" && op.local_id) {
        if (await umLocal("ordens", op.ordem_id)) await gravarLocal("eventos", [{ id: op.local_id, ...op.evento }]);
      }
    } catch (e) { /* a próxima réplica tenta de novo */ }
  }
}

/** a O.S. tem alteração na fila (inclusive em conflito)? Então tudo dela passa pela fila, na ordem. */
export async function temPendente(ordemId) { return (await fila.listar()).some(op => ehAlteracao(op) && op.ordem_id === ordemId); }

/** descrição curta de uma alteração da fila (tela Dados no computador e faixa da O.S.) */
export function descreverAlteracao(op) {
  const os = "O.S. " + String(op.numero || "").padStart(5, "0");
  if (op.tipo === "alterar_os") return os + ": " + (op.patch.status ? "etapa / dados" : "dados") + " (" + Object.keys(op.patch).length + " campo(s))";
  if (op.tipo === "itens_os") return os + ": " + op.itens.length + " peça(s)/serviço(s) incluídos ou alterados" + (op.removidos.length ? ", " + op.removidos.length + " removido(s)" : "");
  if (op.tipo === "evento_os") return os + ": histórico — " + op.evento.texto;
  return os;
}
export const ehAlteracao = op => op.tipo === "alterar_os" || op.tipo === "itens_os" || op.tipo === "evento_os";
