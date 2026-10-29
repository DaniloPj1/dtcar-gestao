// Ações rápidas da O.S. (usadas na lista e dentro da O.S.): cancelar com motivo e avançar etapa
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Area, Modal, Seg, Dinheiro, I } from "../ui.js";
import { numOS, somaDias, totais, reais, soDig, fmtKm, hojeISO, arred, linkWhats } from "../util.js";
import { referenteOS } from "./recibos.js";
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

/**
 * Encerrar O.S. numa janela só: registra a entrega (se ainda não houve) e o pagamento (recibo).
 * Quitando o total, a O.S. fica finalizada. Vale para O.S. em execução (sem itens pendentes), pronta ou entregue a receber.
 */
export function EncerrarModal({ o, onFechar, onFeito }) {
  const { cfg, perfil, dados, avisar, recarregar, ir } = useApp();
  const [r, setR] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const [km, setKm] = useState(""), [forma, setForma] = useState(o.forma_pagamento || ""), [valor, setValor] = useState(0), [receber, setReceber] = useState(true), [imprimir, setImprimir] = useState(true);
  useEffect(() => { (async () => {
    try {
      const [ord, recs] = await Promise.all([api.ordem(o.id), api.recibos.listar({ ordemId: o.id })]);
      const t = totais(ord.itens || [], ord.desconto, true);
      const pago = recs.filter(x => !x.cancelado).reduce((s, x) => s + Number(x.valor), 0);
      const saldo = arred(Math.max(0, t.total - pago));
      setR({ ord, t, pago, saldo, pend: (ord.itens || []).filter(i => i.aprovado === null || i.aprovado === undefined) });
      setKm(String(ord.km_saida || ord.km_entrada || "")); setValor(saldo);
    } catch (e) { setErro(e.message); }
  })(); }, [o.id]);
  const jaEntregue = o.status === "entregue";
  const confirmar = async () => {
    if (!r) return;
    if (r.pend.length) return setErro("Há itens aguardando aprovação do cliente. Abra a O.S. e registre a decisão antes de encerrar.");
    const k = parseInt(soDig(km), 10);
    if (!jaEntregue && !(k >= (r.ord.km_entrada || 0))) return setErro("O KM de saída não pode ser menor que o de entrada (" + fmtKm(r.ord.km_entrada) + ").");
    if (receber && r.saldo > 0) { if (!forma) return setErro("Informe a forma de pagamento."); if (!(Number(valor) > 0)) return setErro("Informe o valor recebido."); if (Number(valor) > r.saldo + 0.009) return setErro("O valor é maior que o saldo de " + reais(r.saldo) + "."); }
    setOcupado(true);
    try {
      if (!jaEntregue) {
        await api.atualizarOrdem(o.id, { status: "entregue", km_saida: k, entregue_em: new Date().toISOString(), forma_pagamento: forma || r.ord.forma_pagamento || "", garantia_dias: r.ord.garantia_dias || Number(cfg.garantiaDias) || 90, total: r.t.total, custo: r.t.custo, situacao: "" });
        const v = dados.veiculos.find(x => x.id === r.ord.veiculo_id); if (v && k > (v.km_atual || 0)) await api.veiculos.salvar({ id: v.id, km_atual: k });
        await api.evento(o.id, "entrega", "Veículo entregue com " + fmtKm(k) + " (encerramento pela lista).", perfil.nome);
      }
      let recibo = null;
      if (receber && r.saldo > 0) {
        const cli = dados.clientes.find(c => c.id === r.ord.cliente_id);
        recibo = await api.recibos.salvar({ ordem_id: o.id, cliente_id: r.ord.cliente_id || null, pagador: (r.ord.cliente || {}).nome || "", doc: soDig((cli && cli.doc) || (r.ord.cliente || {}).doc || ""), valor: Number(valor),
          referente: referenteOS({ ...r.ord, total: r.t.total }), forma, data: hojeISO(), obs: "", emitido_por: perfil.nome });
        await api.evento(o.id, "recibo", "Recibo " + String(recibo.numero).padStart(5, "0") + " emitido: " + reais(recibo.valor) + " (" + forma + ").", perfil.nome);
      }
      const quitou = !receber ? r.saldo <= 0 : Number(valor) >= r.saldo - 0.009;
      avisar(numOS(o.numero) + (quitou ? " encerrada e finalizada." : jaEntregue ? ": pagamento parcial registrado." : " entregue; fica a receber."));
      await recarregar(["ordens", "veiculos", "produtos"]); onFeito && onFeito();
      if (recibo && imprimir) ir("/imprimir/recibo/" + recibo.id);
    } catch (e) { setErro(e.message); setOcupado(false); }
  };
  return html`<${Modal} titulo=${(jaEntregue ? "Receber e finalizar " : "Encerrar ") + numOS(o.numero)} onFechar=${onFechar}>
    <p class="sub">${o.veiculo && o.veiculo.placa} · ${[o.veiculo && o.veiculo.marca, o.veiculo && o.veiculo.modelo].filter(Boolean).join(" ")} · ${o.cliente && o.cliente.nome}</p>
    ${!r && !erro ? html`<div class="carregando">Calculando…</div>` : null}
    ${r ? html`
      <div class="encerrar-resumo"><div><span>Total aprovado</span><b>${reais(r.t.total)}</b></div><div><span>Já recebido</span><b>${reais(r.pago)}</b></div><div class="forte"><span>Saldo</span><b>${reais(r.saldo)}</b></div></div>
      ${r.pend.length ? html`<div class="aviso">${r.pend.length} item(ns) aguardando aprovação. Abra a O.S. para registrar a decisão do cliente.</div>` : null}
      ${!jaEntregue ? html`<${Campo} id="enc-km" rotulo="KM de saída" obrig><input id="enc-km" class="inp" inputmode="numeric" value=${km ? Number(soDig(km)).toLocaleString("pt-BR") : ""} onInput=${e => { setKm(soDig(e.target.value).slice(0, 7)); setErro(""); }} /></${Campo}>` : null}
      ${r.saldo > 0 ? html`
        <div class="campo"><label>Pagamento</label><${Seg} rotulo="Pagamento" opcoes=${[["Receber agora", "ok"], ["Entregar e receber depois", "warn"]]} valor=${receber ? "Receber agora" : "Entregar e receber depois"} onEscolha=${v => { setReceber(v === "Receber agora"); setErro(""); }} /></div>
        ${receber ? html`<div class="campo"><label>Forma de pagamento <i>*</i></label><${Seg} rotulo="Forma" opcoes=${(cfg.formasPagamento || []).map(x => [x, "info"])} valor=${forma} onEscolha=${v => { setForma(v); setErro(""); }} /></div>
          <${Campo} id="enc-valor" rotulo="Valor recebido" dica=${Number(valor) < r.saldo - 0.009 ? "Pagamento parcial: a O.S. continua a receber " + reais(r.saldo - Number(valor)) + "." : "Quitando o saldo, a O.S. é finalizada."}><${Dinheiro} id="enc-valor" valor=${valor} onMuda=${v => { setValor(v); setErro(""); }} /></${Campo}>
          <label class="linha-check"><input type="checkbox" checked=${imprimir} onChange=${e => setImprimir(e.target.checked)} /><span>Abrir o recibo para imprimir</span></label>` : null}`
      : html`<div class="info">Nada a receber: a O.S. será finalizada${jaEntregue ? "" : " ao registrar a entrega"}.</div>`}` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><button type="button" class="btn-link" onClick=${() => { onFechar(); ir("/os/" + o.id); }}>Abrir a O.S.</button><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-pri" disabled=${!r || ocupado} onClick=${confirmar}>${ocupado ? "Registrando…" : jaEntregue ? "Registrar pagamento" : receber && r && r.saldo > 0 ? "Encerrar e receber" : "Registrar entrega"}</button></div>
  </${Modal}>`;
}

/** Menu "Mais" de cada O.S. na lista */
export function MenuOS({ o, itens }) {
  const [aberto, setAberto] = useState(null), ref = useRef(null);
  // posição fixa na tela: o menu não fica cortado dentro da tabela com rolagem
  const abrir = e => { if (aberto) return setAberto(null); const r = e.currentTarget.getBoundingClientRect(), alto = 44 * itens.filter(Boolean).length + 12;
    setAberto({ top: r.bottom + alto + 8 > innerHeight ? Math.max(8, r.top - alto - 4) : r.bottom + 4, right: Math.max(8, innerWidth - r.right) }); };
  useEffect(() => { if (!aberto) return; const f = () => setAberto(null); addEventListener("scroll", f, true); addEventListener("resize", f); return () => { removeEventListener("scroll", f, true); removeEventListener("resize", f); }; }, [aberto]);
  useEffect(() => { if (!aberto) return; const f = e => { if (ref.current && !ref.current.contains(e.target)) setAberto(null); }; const k = e => e.key === "Escape" && setAberto(null);
    document.addEventListener("pointerdown", f); document.addEventListener("keydown", k); return () => { document.removeEventListener("pointerdown", f); document.removeEventListener("keydown", k); }; }, [aberto]);
  const vis = itens.filter(Boolean);
  if (!vis.length) return null;
  return html`<div class="menu-os-lista" ref=${ref}><button type="button" class="btn btn-sm btn-mais" aria-haspopup="menu" aria-expanded=${aberto ? "true" : "false"} aria-label=${"Mais opções da " + numOS(o.numero)} onClick=${abrir}>Mais ▾</button>
    ${aberto ? html`<div class="mol-lista" role="menu" style=${{ position: "fixed", top: aberto.top + "px", right: aberto.right + "px" }}>${vis.map(([t, fn, perigo]) => html`<button type="button" role="menuitem" key=${t} class=${perigo ? "perigo" : ""} onClick=${() => { setAberto(null); fn(); }}>${t}</button>`)}</div>` : null}</div>`;
}
