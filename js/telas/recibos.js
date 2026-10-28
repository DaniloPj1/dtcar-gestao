// Recibos de pagamento: emissão (pela O.S. ou avulso) e consulta
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, Dinheiro, BuscaCliente } from "../ui.js";
import { norm, soDig, reais, fmtData, fmtDoc, numOS, numRecibo, hojeISO, exPlaca, extenso } from "../util.js";
import { pode } from "../regras.js";

export const referenteOS = o => `pagamento da Ordem de Serviço nº ${String(o.numero).padStart(5, "0")}` +
  (o.veiculo && o.veiculo.placa ? ` – ${[o.veiculo.marca, o.veiculo.modelo].filter(Boolean).join(" ")} placa ${exPlaca(o.veiculo.placa)}` : "");

/** Emite recibo. ordem: O.S. (opcional); valor: sugestão (saldo da O.S.) */
export function ReciboModal({ ordem, venda, valor, forma, onFechar, onEmitido }) {
  const { cfg, dados, perfil, avisar } = useApp();
  const cli0 = ordem ? dados.clientes.find(c => c.id === ordem.cliente_id) : null;
  const [r, setR] = useState(() => ({
    cliente_id: ordem ? ordem.cliente_id || "" : venda ? venda.cliente_id || "" : "", pagador: ordem ? (ordem.cliente || {}).nome || "" : venda ? (venda.cliente || {}).nome || "" : "",
    doc: fmtDoc((cli0 && cli0.doc) || (ordem && ordem.cliente && ordem.cliente.doc) || (venda && venda.cliente && venda.cliente.doc) || ""),
    valor: Number(valor) > 0 ? Number(valor) : 0, referente: ordem ? referenteOS(ordem) : venda ? "pagamento da venda de balcão nº " + String(venda.numero).padStart(5, "0") : "",
    forma: forma || (ordem && ordem.forma_pagamento) || "", data: hojeISO(), obs: "" }));
  const [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const set = p => { setR(x => ({ ...x, ...p })); setErro(""); };
  const escolherCliente = id => { const c = dados.clientes.find(x => x.id === id); set({ cliente_id: id, ...(c ? { pagador: c.nome, doc: fmtDoc(c.doc) } : {}) }); };
  const emitir = async () => {
    if (!r.pagador.trim()) return setErro("Informe quem pagou.");
    if (!(Number(r.valor) > 0)) return setErro("Informe o valor recebido.");
    if (!r.referente.trim()) return setErro("Informe a que se refere o pagamento.");
    if (!r.forma) return setErro("Informe a forma de pagamento.");
    setSalvando(true);
    try {
      const novo = await api.recibos.salvar({ ordem_id: ordem ? ordem.id : null, ...(venda ? { venda_id: venda.id } : {}), cliente_id: r.cliente_id || null, pagador: r.pagador.trim(), doc: soDig(r.doc), valor: Number(r.valor),
        referente: r.referente.trim(), forma: r.forma, data: r.data || hojeISO(), obs: r.obs.trim(), emitido_por: perfil.nome });
      if (ordem) await api.evento(ordem.id, "recibo", `${numRecibo(novo.numero)} emitido: ${reais(novo.valor)} (${novo.forma}).`, perfil.nome).catch(() => {});
      avisar(numRecibo(novo.numero) + " emitido."); onEmitido ? onEmitido(novo) : onFechar();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Emitir recibo de pagamento" onFechar=${onFechar}>
    ${ordem ? html`<span class="sub">${numOS(ordem.numero)} · ${(ordem.cliente || {}).nome}</span>` : venda ? html`<span class="sub">Venda de balcão ${String(venda.numero).padStart(5, "0")}</span>` : html`<div class="campo"><label for="r-cli">Cliente cadastrado (opcional)</label><${BuscaCliente} id="r-cli" valor=${r.cliente_id} onEscolha=${escolherCliente} /></div>`}
    <div class="grade">
      <${Campo} id="r-pag" rotulo="Recebemos de" obrig><${Texto} id="r-pag" valor=${r.pagador} onMuda=${v => set({ pagador: v })} /></${Campo}>
      <${Campo} id="r-doc" rotulo="CPF / CNPJ"><input id="r-doc" class="inp" inputmode="numeric" value=${r.doc} onBlur=${e => set({ doc: fmtDoc(e.target.value) })} onInput=${e => set({ doc: e.target.value })} /></${Campo}>
      <${Campo} id="r-valor" rotulo="Valor recebido" obrig><${Dinheiro} id="r-valor" valor=${r.valor} onMuda=${v => set({ valor: v })} /></${Campo}>
      <${Campo} id="r-data" rotulo="Data do pagamento"><input id="r-data" type="date" class="inp" value=${r.data} onInput=${e => set({ data: e.target.value })} /></${Campo}>
    </div>
    ${Number(r.valor) > 0 ? html`<span class="dica">${extenso(r.valor)}</span>` : null}
    <${Campo} id="r-ref" rotulo="Referente a" obrig><${Area} id="r-ref" style=${{ minHeight: "64px" }} valor=${r.referente} onMuda=${v => set({ referente: v })} /></${Campo}>
    <div class="campo"><label>Forma de pagamento <i>*</i></label><${Seg} rotulo="Forma de pagamento" opcoes=${(cfg.formasPagamento || []).map(x => [x, "info"])} valor=${r.forma} onEscolha=${v => set({ forma: v })} /></div>
    <${Campo} id="r-obs" rotulo="Observação"><${Texto} id="r-obs" placeholder="ex.: parcela 1 de 2, sinal" valor=${r.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${emitir}>${salvando ? "Emitindo…" : "Emitir e imprimir"}</button></div>
  </${Modal}>`;
}

/* ---------------- lista de recibos ---------------- */
const mesAtual = () => hojeISO().slice(0, 7);
export function Recibos() {
  const { perfil, ir } = useApp();
  const [mes, setMes] = useState(mesAtual()), [q, setQ] = useState(""), [lista, setLista] = useState(null), [novo, setNovo] = useState(false), [erro, setErro] = useState("");
  const carregar = () => { setLista(null); const [a, m] = mes.split("-").map(Number); const fim = new Date(a, m, 0).getDate();
    api.recibos.listar({ de: mes + "-01", ate: mes + "-" + String(fim).padStart(2, "0") }).then(setLista).catch(e => { setErro(e.message); setLista([]); }); };
  useEffect(carregar, [mes]);
  const filtrados = useMemo(() => { const n = norm(q), d = soDig(q); return (lista || []).filter(r => !n || norm(r.pagador).includes(n) || norm(r.referente).includes(n) || (d && String(r.numero) === String(+d))); }, [lista, q]);
  const validos = filtrados.filter(r => !r.cancelado), total = validos.reduce((s, r) => s + Number(r.valor), 0);
  const porForma = useMemo(() => { const g = new Map(); for (const r of validos) g.set(r.forma || "—", (g.get(r.forma || "—") || 0) + Number(r.valor)); return [...g.entries()].sort((a, b) => b[1] - a[1]); }, [filtrados]);
  return html`<div class="pagina">
    <div class="linha-add"><input type="month" class="inp" aria-label="Mês" value=${mes} onInput=${e => e.target.value && setMes(e.target.value)} />
      ${pode(perfil, "verValores") ? html`<button type="button" class="btn btn-pri" onClick=${() => setNovo(true)}>+ Recibo avulso</button>` : null}</div>
    <input id="busca-rec" class="inp" aria-label="Buscar recibo" placeholder="Número, nome ou referência" value=${q} onInput=${e => setQ(e.target.value)} />
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <section class="card"><div class="secao-topo"><h3>${validos.length} recibo(s) · ${reais(total)}</h3></div>
      ${porForma.length > 1 ? html`<ul class="ranking">${porForma.map(([f, v]) => html`<li key=${f}><span>${f}</span><b>${reais(v)}</b></li>`)}</ul>` : null}
      ${!lista ? html`<span class="dica">Carregando…</span>` : filtrados.length ? html`<div class="lista">${filtrados.map(r => html`<button type="button" key=${r.id} class=${"linha" + (r.cancelado ? " inativo" : "")} onClick=${() => ir("/imprimir/recibo/" + r.id)}>
        <span class="cod">${String(r.numero).padStart(5, "0")}</span><span class="meio"><strong>${r.pagador}${r.cancelado ? html` <span class="pill p-bad">Cancelado</span>` : null}</strong><span>${fmtData(r.data)} · ${r.forma} · ${r.referente}</span></span>
        <span class="dir"><b>${reais(r.valor)}</b></span></button>`)}</div>` : html`<${Vazio}>Nenhum recibo neste mês.</${Vazio}>`}
    </section>
    ${novo ? html`<${ReciboModal} onFechar=${() => setNovo(false)} onEmitido=${r => { setNovo(false); ir("/imprimir/recibo/" + r.id); }} />` : null}
  </div>`;
}
