// O.S. aberta sem internet, ainda na fila do aparelho (número provisório)
import { html } from "../lib.js";
import { useApp, Placa } from "../ui.js";
import { fmtDataHora, fmtKm, fmtTel } from "../util.js";

export function OSPendente({ o, op }) {
  const { ir, cfg } = useApp();
  return html`<div class="pagina">
    <div class="painel-topo"><div><h1>${o._provisorio} <span class="pill p-warn">aguardando número</span></h1>
      <span class="sub">Aberta sem internet em ${fmtDataHora(o.criado_em)} neste aparelho</span></div>
      <div class="acoes"><button type="button" class="btn" onClick=${() => ir("/ordens")}>← Ordens</button>
        <button type="button" class="btn btn-pri" onClick=${() => ir("/imprimir/os/" + o.id + "?valores=0")}>Imprimir entrada</button></div></div>
    <div class="faixa-offline">Esta O.S. está guardada só neste aparelho. Quando a internet voltar, ela é enviada sozinha e recebe o número definitivo na ordem de horário de abertura.
      Até lá não dá para lançar peças e serviços, fechar nem emitir recibo.${op && op.erro ? html`<br /><b>Problema no último envio:</b> ${op.erro}` : null}</div>
    <section class="card"><h3>Veículo</h3>
      <div class="acoes centro"><${Placa} placa=${o.veiculo.placa} grande /><span><b>${[o.veiculo.marca, o.veiculo.modelo].filter(Boolean).join(" ")}</b>
        <span class="sub"> ${[o.veiculo.ano, o.veiculo.cor].filter(Boolean).join(" · ")}</span><br /><span class="sub">Entrada com ${fmtKm(o.km_entrada)}${o.box ? " · box " + o.box : ""}</span></span></div></section>
    <section class="card"><h3>Cliente</h3><p><b>${o.cliente.nome}</b>${o.cliente.telefone ? " · " + fmtTel(o.cliente.telefone) : ""}</p>${o.contato ? html`<p class="sub">Contato: ${o.contato}</p>` : null}</section>
    ${o.reclamacao ? html`<section class="card"><h3>Reclamação do cliente</h3><p class="texto-pre">${o.reclamacao}</p></section>` : null}
    <section class="card"><h3>Atendimento</h3><p>Consultor: ${o.consultor_nome || "—"}</p><p class="sub">Garantia padrão de ${o.garantia_dias || cfg.garantiaDias} dias.</p></section>
  </div>`;
}
