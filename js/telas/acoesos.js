// Ações rápidas da O.S. (usadas na lista e dentro da O.S.): cancelar com motivo e avançar etapa
import { html, useState, useEffect, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Area, Texto, Modal, Seg, Dinheiro, I } from "../ui.js";
import { numOS, somaDias, totais, reais, soDig, fmtKm, hojeISO, arred, linkWhats, fmtData, parseValor } from "../util.js";
import { referenteOS, ContaEntrada } from "./recibos.js";
import { pode } from "../regras.js";
import { PrazoReceber, validarPrazo, lancarParcelas, abaterParcelas, semPrazo } from "./receber.js";

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
  // Orçamento → Aprovado (execução) → Aguardando pagamento → Fechada
  if ((st === "diagnostico" || st === "aguardando") && pode(perfil, "aprovar")) return { rot: "Aprovar", dica: "Cliente aprovou: aprova os itens do orçamento e libera a execução", tipo: "autorizar" };
  if (st === "execucao" && pode(perfil, "executar")) return { rot: "Serviço concluído", dica: "Serviço pronto: a O.S. passa para Aguardando pagamento", tipo: "pronto" };
  if (st === "pronto" && pode(perfil, "entregar")) return { rot: "Receber e fechar", dica: "Registrar pagamento e entrega e fechar a O.S.", tipo: "abrir", acao: "receber" };
  if (st === "recusado" && !o.entregue_em && pode(perfil, "entregar")) return { rot: "Registrar retirada", dica: "Cliente retirou o veículo sem o serviço", tipo: "abrir", acao: "entregar" };
  if (st === "entregue" && o.recebido !== undefined && !o.finalizada_em && pode(perfil, "entregar")) return { rot: "Receber", dica: "Registrar o pagamento e fechar a O.S.", tipo: "abrir", acao: "receber" };
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
    if (!itens.length) throw new Error("Inclua peças ou serviços na " + numOS(o.numero) + " antes de aprovar.");
    const semValor = itens.filter(i => !i.fornecida_cliente && !(Number(i.valor_unit) > 0));
    if (semValor.length) throw new Error("Informe o valor de: " + semValor.map(i => i.descricao).join(", ") + ".");
    const pend = itens.filter(i => i.aprovado === null || i.aprovado === undefined);
    if (!itens.some(i => i.aprovado === true) && !pend.length) throw new Error("A O.S. não tem itens para autorizar.");
    const novos = itens.map(i => (i.aprovado === null || i.aprovado === undefined) ? { ...i, aprovado: true } : i);
    await api.salvarItens(o.id, novos, []);
    const t = totais(novos, r.desconto, true);
    const registro = { em: new Date().toISOString(), por: (r.cliente || {}).nome || "", forma: "Autorizado (registrado por " + perfil.nome + ")", obs: "", assinatura: "" };
    await api.atualizarOrdem(o.id, { status: "execucao", total: t.total, custo: t.custo,
      aprovacao: r.aprovacao ? { ...registro, anteriores: (r.aprovacao.anteriores || []).concat([{ ...r.aprovacao, anteriores: undefined }]) } : registro });
    await ev("Cliente autorizou o orçamento (" + pend.length + " item(ns), " + reais(t.total) + "). Liberado para execução.");
    return "Aprovado. O.S. em execução.";
  }
  if (etapa.tipo === "pronto") {
    const pend = itens.filter(i => i.aprovado === null || i.aprovado === undefined);
    if (pend.length) throw new Error("Há itens adicionais aguardando aprovação. Abra a O.S. e registre a decisão do cliente.");
    await api.atualizarOrdem(o.id, { status: "pronto" });
    await ev("Serviço concluído. Aguardando pagamento.");
    return "Serviço concluído: aguardando pagamento.";
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
  const [km, setKm] = useState(""), [forma, setForma] = useState(o.forma_pagamento || ""), [contaDest, setContaDest] = useState(""), [valor, setValor] = useState(0), [receber, setReceber] = useState(true), [imprimir, setImprimir] = useState(true), [prazo, setPrazo] = useState(null);
  const [desc, setDesc] = useState(0); // v50: desconto no quadro de receber
  const v12 = !api.temV12 || api.temV12();
  const carregar = async primeira => {
    try {
      const [ord, recs, parcs] = await Promise.all([api.ordem(o.id), api.recibos.listar({ ordemId: o.id }), v12 && api.receber ? api.receber.daOrdem(o.id).catch(() => []) : []]);
      const t = totais(ord.itens || [], ord.desconto, true);
      const pago = recs.filter(x => !x.cancelado).reduce((s, x) => s + Number(x.valor), 0);
      const saldo = arred(Math.max(0, t.total - pago));
      setR({ ord, t, pago, saldo, parc: (parcs || []).filter(p => p.status === "aberta"), pend: (ord.itens || []).filter(i => i.aprovado === null || i.aprovado === undefined) });
      if (primeira) setKm(String(ord.km_saida || ord.km_entrada || "")); setValor(saldo); setDesc(Number(ord.desconto) || 0);
    } catch (e) { setErro(e.message); }
  };
  useEffect(() => { carregar(true); }, [o.id]);
  const jaEntregue = o.status === "entregue";
  const podeDesc = !!api.descontoOS && pode(perfil, "orcar") && !(r && r.ord.finalizada_em);
  const mudouDesc = !!r && Math.abs((Number(desc) || 0) - (Number(r.ord.desconto) || 0)) > 0.005;
  const aplicarDesc = async () => {
    setOcupado(true); setErro("");
    try { const x = await api.descontoOS(o.id, Number(desc) || 0, "no recebimento", true);
      avisar("Desconto aplicado: total " + reais(x.total) + "." + ((x.avisos || []).length ? " " + x.avisos.join(" ") : ""));
      if (x.fechou) { await recarregar(["ordens", "receber"]); onFeito && onFeito(); return; }
      await carregar(false); }
    catch (e) { setErro(e.message); } finally { setOcupado(false); }
  };
  const falta = r && v12 ? semPrazo(r.saldo, r.parc, receber ? valor : 0) : 0; // parte do saldo que ainda precisa de prazo
  const confirmar = async () => {
    if (!r) return;
    if (mudouDesc) return setErro("Aplique o desconto antes (botão \"Aplicar desconto\"): o saldo muda.");
    if (r.pend.length) return setErro("Há itens aguardando aprovação do cliente. Abra a O.S. e registre a decisão antes de encerrar.");
    const k = parseInt(soDig(km), 10);
    if (!jaEntregue && !(k >= (r.ord.km_entrada || 0))) return setErro("O KM de saída não pode ser menor que o de entrada (" + fmtKm(r.ord.km_entrada) + ").");
    if (receber && r.saldo > 0) { if (!forma) return setErro("Informe a forma de pagamento."); if (!contaDest) return setErro("Informe em qual conta o dinheiro entrou."); if (!(Number(valor) > 0)) return setErro("Informe o valor recebido."); if (Number(valor) > r.saldo + 0.009) return setErro("O valor é maior que o saldo de " + reais(r.saldo) + "."); }
    if (falta > 0.009) { const ep = validarPrazo(prazo, falta); if (ep) return setErro(ep); }
    setOcupado(true);
    try {
      if (!jaEntregue) {
        await api.atualizarOrdem(o.id, { status: "entregue", km_saida: k, entregue_em: new Date().toISOString(), forma_pagamento: (receber ? forma : prazo && prazo.forma) || r.ord.forma_pagamento || "", garantia_dias: r.ord.garantia_dias || Number(cfg.garantiaDias) || 90, total: r.t.total, custo: r.t.custo, situacao: "" });
        const v = dados.veiculos.find(x => x.id === r.ord.veiculo_id); if (v && k > (v.km_atual || 0)) await api.veiculos.salvar({ id: v.id, km_atual: k });
        await api.evento(o.id, "entrega", "Veículo entregue com " + fmtKm(k) + " (encerramento pela lista).", perfil.nome);
      }
      let recibo = null;
      if (receber && r.saldo > 0) {
        const cli = dados.clientes.find(c => c.id === r.ord.cliente_id);
        recibo = await api.recibos.salvar({ ordem_id: o.id, cliente_id: r.ord.cliente_id || null, pagador: (r.ord.cliente || {}).nome || "", doc: soDig((cli && cli.doc) || (r.ord.cliente || {}).doc || ""), valor: Number(valor),
          referente: referenteOS({ ...r.ord, total: r.t.total }), forma, conta_destino: contaDest, data: hojeISO(), obs: "", emitido_por: perfil.nome });
        await api.evento(o.id, "recibo", "Recibo " + String(recibo.numero).padStart(5, "0") + " emitido: " + reais(recibo.valor) + " (" + forma + ").", perfil.nome);
        if (r.parc.length) await abaterParcelas(o.id, recibo.valor, recibo, perfil);
      }
      if (falta > 0.009) await lancarParcelas({ ...o, ...r.ord }, prazo, perfil);
      const quitou = !receber ? r.saldo <= 0 : Number(valor) >= r.saldo - 0.009;
      avisar(numOS(o.numero) + (quitou ? " encerrada e finalizada." : jaEntregue ? (receber ? ": pagamento parcial registrado." : ": prazo de recebimento registrado.") : " entregue; fica a receber" + (falta > 0.009 && prazo ? " (" + prazo.forma + ", " + prazo.parcelas.length + "x)." : ".")));
      await recarregar(["ordens", "veiculos", "produtos", "receber"]); onFeito && onFeito();
      if (recibo && imprimir) ir("/imprimir/recibo/" + recibo.id);
    } catch (e) { setErro(e.message); setOcupado(false); }
  };
  return html`<${Modal} titulo=${(jaEntregue ? "Receber e finalizar " : "Encerrar ") + numOS(o.numero)} onFechar=${onFechar}>
    <p class="sub">${o.veiculo && o.veiculo.placa} · ${[o.veiculo && o.veiculo.marca, o.veiculo && o.veiculo.modelo].filter(Boolean).join(" ")} · ${o.cliente && o.cliente.nome}</p>
    ${!r && !erro ? html`<div class="carregando">Calculando…</div>` : null}
    ${r ? html`
      <div class="encerrar-resumo"><div><span>Total aprovado</span><b>${reais(r.t.total)}</b></div><div><span>Já recebido</span><b>${reais(r.pago)}</b></div><div class="forte"><span>Saldo</span><b>${reais(r.saldo)}</b></div></div>
      ${podeDesc ? html`<div class="campo enc-desc"><label for="enc-desc">Desconto na O.S. <small class="sub">valor dos itens ${reais(r.t.subtotal)}</small></label>
        <div class="enc-desc-linha"><${CampoDesconto} id="enc-desc" subtotal=${r.t.subtotal} valor=${desc} onMuda=${v => { setDesc(v); setErro(""); }} />
          ${mudouDesc ? html`<button type="button" class="btn btn-sm btn-pri" disabled=${ocupado} onClick=${aplicarDesc}>Aplicar desconto</button>` : null}</div>
        ${mudouDesc ? html`<span class="dica">Total com o desconto: ${reais(Math.max(0, r.t.subtotal - (Number(desc) || 0)))}. Parcelas a receber que passarem do saldo novo são reduzidas.</span>` : null}</div>` : null}
      ${r.pend.length ? html`<div class="aviso">${r.pend.length} item(ns) aguardando aprovação. Abra a O.S. para registrar a decisão do cliente.</div>` : null}
      ${!jaEntregue ? html`<${Campo} id="enc-km" rotulo="KM de saída" obrig><input id="enc-km" class="inp" inputmode="numeric" value=${km ? Number(soDig(km)).toLocaleString("pt-BR") : ""} onInput=${e => { setKm(soDig(e.target.value).slice(0, 7)); setErro(""); }} /></${Campo}>` : null}
      ${r.saldo > 0 ? html`
        <div class="campo"><label>Pagamento</label><${Seg} rotulo="Pagamento" opcoes=${[["Receber agora", "ok"], [jaEntregue ? "Combinar prazo" : "Entregar e receber depois", "warn"]]} valor=${receber ? "Receber agora" : jaEntregue ? "Combinar prazo" : "Entregar e receber depois"} onEscolha=${v => { setReceber(v === "Receber agora"); setErro(""); }} /></div>
        ${receber ? html`<div class="campo"><label>Forma de pagamento <i>*</i></label><${Seg} rotulo="Forma" opcoes=${(cfg.formasPagamento || []).map(x => [x, "info"])} valor=${forma} onEscolha=${v => { setForma(v); setErro(""); }} /></div>
          <${ContaEntrada} forma=${forma} valor=${contaDest} onMuda=${v => { setContaDest(v); setErro(""); }} />
          <${Campo} id="enc-valor" rotulo="Valor recebido" dica=${Number(valor) < r.saldo - 0.009 ? "Pagamento parcial: a O.S. continua a receber " + reais(r.saldo - Number(valor)) + "." : "Quitando o saldo, a O.S. é finalizada."}><${Dinheiro} id="enc-valor" valor=${valor} onMuda=${v => { setValor(v); setErro(""); }} /></${Campo}>
          <label class="linha-check"><input type="checkbox" checked=${imprimir} onChange=${e => setImprimir(e.target.checked)} /><span>Abrir o recibo para imprimir</span></label>` : null}`
      : html`<div class="info">Nada a receber: a O.S. será finalizada${jaEntregue ? "" : " ao registrar a entrega"}.</div>`}
      ${r.parc.length ? html`<div class="info">Parcelas em aberto desta O.S.: ${r.parc.map(p => reais(p.valor) + " em " + fmtData(p.vencimento)).join(" · ")}.${receber ? " O valor recebido abate primeiro a parcela mais antiga." : ""}</div>` : null}
      ${falta > 0.009 ? html`<div class="bloco-prazo"><h4>${receber ? "Prazo do restante" : "Prazo de recebimento"} · ${reais(falta)}</h4><${PrazoReceber} saldo=${falta} valor=${prazo} onMuda=${p => { setPrazo(p); setErro(""); }} /></div>` : null}
      ${!v12 && r.saldo > 0 ? html`<div class="aviso">Para combinar prazo e parcelas, o banco precisa da atualização <b>supabase/v12.sql</b>.</div>` : null}` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><button type="button" class="btn-link" onClick=${() => { onFechar(); ir("/os/" + o.id); }}>Abrir a O.S.</button><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-pri" disabled=${!r || ocupado || mudouDesc} onClick=${confirmar}>${ocupado ? "Registrando…" : jaEntregue ? (receber ? "Registrar pagamento" : "Salvar prazo") : receber && r && r.saldo > 0 ? "Encerrar e receber" : "Registrar entrega"}</button></div>
  </${Modal}>`;
}

/** Desconto da O.S. em reais ou em % do valor dos itens (v50): um campo acompanha o outro */
export function CampoDesconto({ id, subtotal, valor, onMuda, disabled }) {
  const pct = Number(subtotal) > 0 && Number(valor) > 0 ? arred(Number(valor) / Number(subtotal) * 100) : 0;
  const fmt = v => v ? String(v).replace(".", ",") : "";
  const [txt, setTxt] = useState(fmt(pct)), foco = useRef(false);
  useEffect(() => { if (!foco.current) setTxt(fmt(pct)); }, [pct]);
  return html`<div class="desc-os"><${Dinheiro} id=${id} valor=${valor} disabled=${disabled} onMuda=${v => onMuda(arred(Math.max(0, v)))} />
    <div class="inp-suf desc-pct"><input id=${id + "-pct"} class="inp" inputmode="decimal" aria-label="Desconto em porcentagem" disabled=${disabled} value=${txt}
      onFocus=${() => { foco.current = true; }} onInput=${e => { setTxt(e.target.value); onMuda(arred(Number(subtotal) * Math.min(100, Math.max(0, parseValor(e.target.value))) / 100)); }}
      onBlur=${() => { foco.current = false; setTxt(fmt(pct)); }} /><span>%</span></div></div>`;
}

/** Desconto da O.S. depois do orçamento (v50): mostra o que muda (total, saldo, parcelas a receber) antes de aplicar */
export function DescontoModal({ o, subtotal, desconto, onFechar, onFeito }) {
  const { avisar } = useApp();
  const [valor, setValor] = useState(Number(desconto) || 0), [motivo, setMotivo] = useState(""), [prev, setPrev] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  useEffect(() => { let vivo = true; setErro("");
    const t = setTimeout(() => api.descontoOS(o.id, Number(valor) || 0, "", false).then(x => vivo && setPrev(x)).catch(e => { if (vivo) { setPrev(null); setErro(e.message); } }), 350);
    return () => { vivo = false; clearTimeout(t); }; }, [valor]);
  const aplicar = async () => {
    setOcupado(true); setErro("");
    try { const x = await api.descontoOS(o.id, Number(valor) || 0, motivo.trim(), true);
      avisar("Desconto aplicado: total " + reais(x.total) + "." + ((x.avisos || []).length ? " " + x.avisos.join(" ") : ""));
      onFeito && onFeito(x); }
    catch (e) { setErro(e.message); setOcupado(false); }
  };
  const avisos = prev ? (prev.avisos || []).filter(a => !/foi fechada/.test(a)) : [];
  return html`<${Modal} titulo=${"Desconto · " + numOS(o.numero)} onFechar=${onFechar}>
    <p class="sub">Valor dos itens ${reais(subtotal)}. O desconto entra no total da O.S.; parcelas a receber que passarem do saldo novo são reduzidas (a mais nova primeiro).</p>
    <${Campo} id="dsc-v" rotulo="Desconto (R$ ou %)"><${CampoDesconto} id="dsc-v" subtotal=${subtotal} valor=${valor} onMuda=${setValor} /></${Campo}>
    <${Campo} id="dsc-m" rotulo="Motivo (opcional, vai para o histórico)"><${Texto} id="dsc-m" valor=${motivo} onMuda=${setMotivo} /></${Campo}>
    ${prev ? html`<div class="encerrar-resumo"><div><span>Total com desconto</span><b>${reais(prev.total)}</b></div><div><span>Já recebido</span><b>${reais(prev.recebido)}</b></div><div class="forte"><span>Saldo</span><b>${reais(prev.saldo)}</b></div></div>
      ${(prev.parcelas_ajustadas || []).length ? html`<div class="info">Parcelas a receber: ${prev.parcelas_ajustadas.map(p => p.parcela + (p.cancelada ? " cancelada" : " de " + reais(p.valor_antes) + " para " + reais(p.valor))).join(" · ")}.</div>` : null}
      ${prev.fechou ? html`<div class="info">Com esse desconto a O.S. fica quitada e é fechada.</div>` : null}
      ${avisos.map(a => html`<div class="aviso" key=${a}>${a}</div>`)}` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-pri" disabled=${ocupado || !!erro || !prev} onClick=${aplicar}>${ocupado ? "Aplicando…" : "Aplicar desconto"}</button></div>
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
