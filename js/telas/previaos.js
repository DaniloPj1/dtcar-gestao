// Pré-visualização da O.S. ao lado da lista (pedido do Danilo em 23/11/2026, protótipo aprovado):
// tocar numa O.S. abre o resumo num painel de 1/3 à direita, SEM sair da lista. Dali ele decide se
// abre a O.S. inteira. SÓ LEITURA: este arquivo não grava nada; os botões levam para as telas de sempre.
import { html, useState, useEffect } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Vazio } from "../ui.js";
import { reais, numOS, fmtData, fmtTel, tempoDesde, linkWhats } from "../util.js";
import { ETAPAS, etapaOS, situacaoOS, pode } from "../regras.js";

const n = v => Number(v) || 0;
const COR = { orcamento: "pv-orc", execucao: "pv-exe", pagamento: "pv-pag", fechada: "pv-fec", recusado: "pv-rec", cancelado: "pv-can" };

/** Trilha do andamento: o que já passou, onde está agora e o que falta — nome sempre escrito. */
function trilha(o) {
  const etapa = etapaOS(o), ordem = ETAPAS.map(([k, t]) => ({ k, t }));
  const atual = ordem.findIndex(e => e.k === etapa);
  if (["recusado", "cancelado"].includes(o.status))
    return [{ t: "Aberta", cls: "ok", q: fmtData(o.criado_em) }, { t: o.status === "recusado" ? "Recusada pelo cliente" : "Cancelada", cls: "at", q: "" }];
  return ordem.map((e, i) => ({ t: e.t, cls: i < atual ? "ok" : i === atual ? "at" : "", q: i === 0 ? fmtData(o.criado_em) : i === atual && o.entregue_em ? fmtData(o.entregue_em) : "" }));
}

export function PreviaOS({ id, onFechar, acoes }) {
  const { ir, perfil, dados } = useApp();
  const ver = pode(perfil, "verValores");
  const [o, setO] = useState(null), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true; setO(null); setErro("");
    if (!id) return;
    // a lista já tem o essencial: mostra na hora e completa com os itens quando chegarem
    const daLista = (dados.ordens || []).find(x => x.id === id);
    if (daLista) setO({ ...daLista, itens: null });
    // a resposta completa COMPLETA o que a lista já tinha (nunca apaga: o banco do PC pode devolver menos campos)
    api.ordem(id).then(r => { if (!vivo) return;
      setO(p => { const base = p || daLista || {}; const novo = { ...base };
        for (const [k, v] of Object.entries(r || {})) if (v !== null && v !== undefined && v !== "") novo[k] = v;
        novo.itens = (r && r.itens) || []; return novo; }); })
      .catch(e => { if (vivo) { if (daLista) setO(x => ({ ...x, itens: [] })); else setErro(e.message); } });
    return () => { vivo = false; }; }, [id]);

  if (!id) return html`<aside class="pv pv-vazio">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 9h8M8 13h5"/></svg>
    <b>Toque numa O.S. para ver o resumo</b>
    <span>O resumo abre aqui do lado, sem sair da lista. Dali você decide se abre a O.S. inteira.</span></aside>`;
  if (erro) return html`<aside class="pv pv-vazio"><${Vazio}>${erro}<//></aside>`;
  if (!o) return html`<aside class="pv pv-vazio"><span class="dica">Abrindo o resumo…</span></aside>`;

  const st = situacaoOS(o), etapa = etapaOS(o), cli = o.cliente || {}, vei = o.veiculo || {};
  const total = n(o.total), recebido = n(o.recebido), falta = Math.max(0, total - recebido);
  const itens = o.itens || [];
  const servicos = itens.filter(i => i.tipo === "servico"), pecas = itens.filter(i => i.tipo !== "servico");
  const linha = i => html`<div key=${i.id}><span>${i.descricao}</span><span class="q">${n(i.quantidade) > 1 ? n(i.quantidade) + "×" : ""}</span>
    ${ver ? html`<b>${reais(n(i.valor_unitario) * n(i.quantidade))}</b>` : null}</div>`;

  return html`<aside class=${"pv " + (COR[etapa] || "pv-can")}>
    <header class="pv-cab">
      <div class="pv-id"><span>${numOS(o.numero)} · aberta em ${fmtData(o.criado_em)}</span>
        <strong>${[vei.marca, vei.modelo].filter(Boolean).join(" ") || "Veículo"}</strong>
        <em>${[vei.ano, vei.cor, o.km_entrada ? n(o.km_entrada).toLocaleString("pt-BR") + " km" : ""].filter(Boolean).join(" · ")}</em></div>
      ${vei.placa ? html`<${Placa} placa=${vei.placa} />` : null}
      <button type="button" class="pv-fechar" aria-label="Fechar o resumo" onClick=${onFechar}>×</button>
    </header>
    <div class="pv-etapa"><i aria-hidden="true"></i>${st.t}${o.situacao ? " · " + o.situacao : ""}</div>
    <div class="pv-corpo">
      <section><h4>Cliente e veículo</h4>
        <dl class="pv-kv">
          <dt>Cliente</dt><dd>${cli.nome || "—"}</dd>
          ${cli.telefone ? html`<dt>Telefone</dt><dd>${fmtTel(cli.telefone)}</dd>` : null}
          <dt>Mecânico</dt><dd>${o.mecanico_nome || "—"}</dd>
          ${o.box ? html`<dt>Box</dt><dd>${o.box}</dd>` : null}
          <dt>Previsão</dt><dd>${o.previsao_entrega ? fmtData(o.previsao_entrega) : "a combinar"}</dd>
          <dt>No pátio há</dt><dd>${tempoDesde(o.criado_em)}</dd>
        </dl></section>
      ${o.reclamacao ? html`<section><h4>Reclamação do cliente</h4><p class="pv-txt">${o.reclamacao}</p></section>` : null}
      <section><h4>Itens lançados</h4>
        ${o.itens === null ? html`<span class="dica">Carregando os itens…</span>`
          : itens.length ? html`<div class="pv-itens">
              ${servicos.length ? html`<h5>Serviços</h5>${servicos.map(linha)}` : null}
              ${pecas.length ? html`<h5>Peças e terceiros</h5>${pecas.map(linha)}` : null}</div>`
          : html`<${Vazio}>Nenhum item lançado ainda.<//>`}
        ${ver ? html`<div class="pv-tot"><span>Total da O.S.</span><b>${reais(total)}</b></div>
          <dl class="pv-kv"><dt>Recebido</dt><dd>${recebido ? reais(recebido) : "—"}</dd>
            <dt>Falta receber</dt><dd class=${falta ? "c-bad" : ""}>${falta ? reais(falta) : "—"}</dd></dl>` : null}</section>
      <section><h4>Andamento</h4>
        <div class="pv-trilha">${trilha(o).map((t, i) => html`<div key=${i} class=${t.cls}><i aria-hidden="true"></i>${t.t}<time>${t.q}</time></div>`)}</div></section>
    </div>
    <footer class="pv-pe">
      ${acoes ? acoes({ ...o, cliente: cli, veiculo: vei }) : null}
      <div class="pv-duo">
        <button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + o.id)}>Abrir a O.S. inteira →</button>
        <button type="button" class="btn btn-sm" onClick=${() => ir("/imprimir/os/" + o.id)}>Imprimir</button>
      </div>
      ${cli.telefone ? html`<div class="pv-duo">
        <button type="button" class="btn btn-sm" onClick=${() => window.open(linkWhats(cli.telefone, "Olá, " + String(cli.nome || "").split(" ")[0] + "! "), "_blank", "noopener")}>WhatsApp do cliente</button>
        <button type="button" class="btn btn-sm" onClick=${() => ir("/os/" + o.id + "#itens")}>Lançar itens</button></div>` : null}
    </footer>
  </aside>`;
}
