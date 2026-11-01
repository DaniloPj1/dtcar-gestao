// Etapa 3 do programa para Windows: alterar O.S. sem internet.
// No programa com o banco do PC carregado, sem internet, as três gravações da O.S. (campos/etapa, peças e serviços, histórico)
// vão para o banco do PC (a tela já mostra) e para a fila de envio (js/fila.js). Quando a internet volta, a fila é enviada na
// ordem em que tudo foi feito, com as regras de conflito de api.sincronizarAlteracao (js/api.js).
//
// Regras do que pode ser feito sem internet (o resto continua precisando do servidor, com aviso claro):
//   - O.S. em aberto (orçamento, aprovado/execução, aguardando pagamento): editar dados, peças e serviços, mudar a etapa, cancelar.
//   - Não: entregar/receber/fechar (recibo e pagamento ficam no servidor), mexer em O.S. fechada ou cancelada, fotos e assinaturas.
//   - O.S. com número provisório (PROV-NN) continua com a tela própria até ser numerada.
import { fila } from "./fila.js";
import { gravarLocal, removerLocal, umLocal, porOrdemLocal } from "./replica.js";
import { uuid } from "./util.js";

const FECHADAS = ["entregue", "cancelado"];
const agora = () => new Date().toISOString();
// mesma comparação do envio (js/api.js), pelo conteúdo: o banco devolve objetos (jsonb) com as chaves em outra ordem e
// datas com hora noutro formato ("…Z" × "…+00:00"); sem isso, uma alteração reenviada ou em sequência viraria conflito falso
const canon = v => v == null ? null
  : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !isNaN(Date.parse(v)) ? new Date(v).toISOString()
  : Array.isArray(v) ? v.map(canon)
  : typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canon(v[k])]))
  : v;
export const iguais = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));

async function ordemAberta(id) {
  const o = await umLocal("ordens", id);
  if (!o) throw new Error("Sem internet: esta O.S. não está no banco do PC. A alteração fica para quando a conexão voltar.");
  if (FECHADAS.includes(o.status)) throw new Error("Sem internet: O.S. " + (o.status === "entregue" ? "entregue" : "cancelada") + " não pode ser alterada. Aguarde a conexão.");
  return o;
}

/** campos e etapa da O.S. (api.atualizarOrdem) */
export async function alterarOrdemOffline(id, patch) {
  if (patch.status === "entregue") throw new Error("Sem internet: entregar, receber e fechar a O.S. precisam de internet (recibo e pagamento ficam no servidor).");
  const o = await ordemAberta(id);
  const antes = Object.fromEntries(Object.keys(patch).map(k => [k, o[k] ?? null]));
  if (Object.keys(patch).every(k => iguais(o[k], patch[k]))) return; // nada mudou
  await fila.adicionar({ id: uuid(), tipo: "alterar_os", ordem_id: id, numero: o.numero, criado_em: agora(), patch, antes });
  await gravarLocal("ordens", [{ ...o, ...patch }]);
}

/** peças e serviços (api.salvarItens): só o que mudou de verdade vai para a fila */
export async function salvarItensOffline(ordemId, itens, removidos = []) {
  const o = await ordemAberta(ordemId);
  const atuais = new Map((await porOrdemLocal("os_itens", ordemId)).map(i => [String(i.id), i]));
  const linhas = itens.map((i, n) => {
    const l = { ...Object.fromEntries(Object.entries(i).filter(([k]) => !k.startsWith("_"))), ordem_id: ordemId, posicao: i.posicao ?? n };
    if (!l.id) l.id = uuid();
    return l;
  });
  const mudaram = linhas.filter(l => { const a = atuais.get(String(l.id)); return !a || Object.keys(l).some(k => !iguais(a[k], l[k])); });
  const rem = removidos.map(String).filter(id => atuais.has(id));
  if (!mudaram.length && !rem.length) return;
  // como estava cada item (data da última alteração no servidor; "novo" = criado aqui): base para conferir conflito no envio
  const base = Object.fromEntries([...mudaram.map(l => String(l.id)), ...rem].map(id => { const a = atuais.get(id); return [id, a ? a.atualizado_em || a.criado_em || null : "novo"]; }));
  await fila.adicionar({ id: uuid(), tipo: "itens_os", ordem_id: ordemId, numero: o.numero, criado_em: agora(), itens: mudaram, removidos: rem, antes: { status: o.status, itens: base } });
  await gravarLocal("os_itens", mudaram.map(l => ({ ...(atuais.get(String(l.id)) || {}), ...l })));
  await removerLocal("os_itens", rem);
}

/** histórico da O.S. (api.evento): fica com um número provisório no banco do PC até ser enviado */
export async function eventoOffline(ordem_id, tipo, texto, usuario_nome) {
  const o = await umLocal("ordens", ordem_id); if (!o) return; // histórico de O.S. que não está no PC: não trava a ação principal
  const criado_em = agora(), local_id = "local-" + uuid();
  await fila.adicionar({ id: uuid(), tipo: "evento_os", ordem_id, numero: o.numero, criado_em, local_id, evento: { ordem_id, tipo, texto, usuario_nome, criado_em } });
  await gravarLocal("eventos", [{ id: local_id, ordem_id, tipo, texto, usuario_nome, criado_em }]);
}

/** descrição curta de uma alteração da fila (tela Dados no computador e faixa da O.S.) */
export function descreverAlteracao(op) {
  const os = "O.S. " + String(op.numero || "").padStart(5, "0");
  if (op.tipo === "alterar_os") return os + ": " + (op.patch.status ? "etapa / dados" : "dados") + " (" + Object.keys(op.patch).length + " campo(s))";
  if (op.tipo === "itens_os") return os + ": " + op.itens.length + " peça(s)/serviço(s) incluídos ou alterados" + (op.removidos.length ? ", " + op.removidos.length + " removido(s)" : "");
  if (op.tipo === "evento_os") return os + ": histórico — " + op.evento.texto;
  return os;
}
export const ehAlteracao = op => op.tipo === "alterar_os" || op.tipo === "itens_os" || op.tipo === "evento_os";
