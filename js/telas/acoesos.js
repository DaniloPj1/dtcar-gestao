// Ações rápidas da O.S. (usadas na lista e dentro da O.S.): cancelar com motivo e avançar etapa
import { html, useState } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Area, Modal } from "../ui.js";
import { numOS, somaDias, totais, reais } from "../util.js";
import { pode } from "../regras.js";

export const MOTIVOS_CANCELAMENTO = ["Cliente desistiu do serviço", "Orçamento não aprovado", "Veículo retirado sem serviço", "O.S. aberta por engano / duplicada", "Peça indisponível", "Outro motivo"];

/** Caixa de cancelamento: o motivo é obrigatório e fica gravado na O.S. e no histórico */
export function CancelarModal({ o, onFechar, onFeito }) {
  const { perfil, avisar, recarregar } = useApp();
  const [motivo, setMotivo] = useState(""), [detalhe, setDetalhe] = useState(""), [ocupado, setOcupado] = useState(false), [erro, setErro] = useState("");
  const texto = [motivo, detalhe.trim()].filter(Boolean).join(": ");
  const confirmar = async () => {
    if (!motivo) return setErro("Escolha o motivo do cancelamento.");
    if (motivo === "Outro motivo" && !detalhe.trim()) return setErro("Descreva o motivo.");
    setOcupado(true);
    try {
      await api.atualizarOrdem(o.id, { status: "cancelado", ...(api.temV11 && api.temV11() ? { motivo_cancelamento: texto } : {}) });
      await api.evento(o.id, "cancelamento", "O.S. cancelada. Motivo: " + texto + ".", perfil.nome);
      avisar(numOS(o.numero) + " cancelada."); await recarregar(["ordens", "produtos"]); onFeito && onFeito();
    } catch (e) { setErro(e.message); setOcupado(false); }
  };
  return html`<${Modal} titulo=${"Cancelar " + numOS(o.numero)} onFechar=${onFechar}>
    <p class="sub">${o.veiculo && o.veiculo.placa ? o.veiculo.placa + " · " : ""}${o.cliente && o.cliente.nome}. A O.S. continua no histórico como cancelada; peças reservadas voltam ao estoque.</p>
    <div class="campo"><label>Motivo <i>*</i></label><div class="motivos">${MOTIVOS_CANCELAMENTO.map(m => html`<label key=${m} class="linha-check"><input type="radio" name="motivo-canc" checked=${motivo === m} onChange=${() => { setMotivo(m); setErro(""); }} /><span>${m}</span></label>`)}</div></div>
    <${Campo} id="canc-det" rotulo=${motivo === "Outro motivo" ? "Descreva o motivo" : "Detalhes (opcional)"} obrig=${motivo === "Outro motivo"}><${Area} id="canc-det" valor=${detalhe} onMuda=${v => { setDetalhe(v); setErro(""); }} /></${Campo}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-perigo" disabled=${ocupado} onClick=${confirmar}>${ocupado ? "Cancelando…" : "Cancelar O.S."}</button></div>
  </${Modal}>`;
}

/** Próxima etapa da O.S. a partir da lista: { rot, dica, fazer(ctx) } ou null */
export function proximaEtapa(o, perfil) {
  if (o._pendente) return null;
  const st = o.status;
  if (st === "diagnostico" && pode(perfil, "orcar")) return { rot: "Orçamento enviado", dica: "Marca o orçamento como enviado ao cliente", tipo: "enviar" };
  if (st === "aguardando" && pode(perfil, "aprovar")) return { rot: "Autorizado", dica: "Cliente autorizou: aprova todos os itens e libera a execução", tipo: "autorizar" };
  if (st === "execucao" && pode(perfil, "executar")) return { rot: "Pronto no pátio", dica: "Serviço concluído, veículo aguardando retirada", tipo: "pronto" };
  if (st === "pronto" && pode(perfil, "entregar")) return { rot: "Entregar", dica: "Registrar a entrega do veículo", tipo: "abrir", acao: "entregar" };
  if (st === "recusado" && !o.entregue_em && pode(perfil, "entregar")) return { rot: "Registrar retirada", dica: "Cliente retirou o veículo sem o serviço", tipo: "abrir", acao: "entregar" };
  if (st === "entregue" && o.recebido !== undefined && !o.finalizada_em && pode(perfil, "entregar")) return { rot: "Receber", dica: "Veículo entregue: registrar o pagamento e finalizar", tipo: "abrir", acao: "receber" };
  return null;
}

/** Executa a próxima etapa (as que não precisam de dados do usuário). Lança erro com orientação quando precisa abrir a O.S. */
export async function avancarEtapa(o, etapa, { perfil, cfg }) {
  const r = await api.ordem(o.id), itens = r.itens || [];
  const ev = t => api.evento(o.id, etapa.tipo, t, perfil.nome);
  if (etapa.tipo === "enviar") {
    if (!itens.length) throw new Error("Inclua peças ou serviços na " + numOS(o.numero) + " antes de enviar o orçamento.");
    const semValor = itens.filter(i => !i.fornecida_cliente && !(Number(i.valor_unit) > 0));
    if (semValor.length) throw new Error("Informe o valor de: " + semValor.map(i => i.descricao).join(", ") + ".");
    const agora = new Date().toISOString();
    await api.atualizarOrdem(o.id, { status: "aguardando", orcamento_enviado_em: agora, validade_orcamento: somaDias(agora, Number(cfg.validadeDias) || 10) });
    await ev("Orçamento marcado como enviado ao cliente.");
    return "Orçamento enviado. Aguardando autorização do cliente.";
  }
  if (etapa.tipo === "autorizar") {
    const pend = itens.filter(i => i.aprovado === null || i.aprovado === undefined);
    if (!itens.some(i => i.aprovado === true) && !pend.length) throw new Error("A O.S. não tem itens para autorizar.");
    const novos = itens.map(i => (i.aprovado === null || i.aprovado === undefined) ? { ...i, aprovado: true } : i);
    await api.salvarItens(o.id, novos, []);
    const t = totais(novos, r.desconto, true);
    const registro = { em: new Date().toISOString(), por: (r.cliente || {}).nome || "", forma: "Autorizado (registrado por " + perfil.nome + ")", obs: "", assinatura: "" };
    await api.atualizarOrdem(o.id, { status: "execucao", total: t.total, custo: t.custo,
      aprovacao: r.aprovacao ? { ...registro, anteriores: (r.aprovacao.anteriores || []).concat([{ ...r.aprovacao, anteriores: undefined }]) } : registro });
    await ev("Cliente autorizou o orçamento (" + pend.length + " item(ns), " + reais(t.total) + "). Liberado para execução.");
    return "Autorizado. O.S. em execução.";
  }
  if (etapa.tipo === "pronto") {
    const pend = itens.filter(i => i.aprovado === null || i.aprovado === undefined);
    if (pend.length) throw new Error("Há itens adicionais aguardando aprovação. Abra a O.S. e registre a decisão do cliente.");
    await api.atualizarOrdem(o.id, { status: "pronto" });
    await ev("Serviço concluído. Veículo pronto no pátio, aguardando retirada.");
    return "Pronto no pátio.";
  }
  throw new Error("Abra a O.S. para continuar.");
}
