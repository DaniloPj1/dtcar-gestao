import { html, useState, useMemo } from "../lib.js";
import { useApp, Placa, Status, Abas, Vazio } from "../ui.js";
import { reais, numOS, tempoDesde, fmtData, hojeISO, norm, normPlaca, soDig, lsGet } from "../util.js";
import { STATUS, ABERTOS, pode } from "../regras.js";

export function LinhaOS({ o, verValores, onClick }) {
  return html`<button type="button" class="linha" onClick=${onClick}><${Placa} placa=${o.veiculo.placa} />
    <span class="meio"><strong>${o.veiculo.marca} ${o.veiculo.modelo}</strong><span>${numOS(o.numero)} · ${o.cliente.nome}</span></span>
    <span class="dir">${verValores && Number(o.total) > 0 ? html`<b>${reais(o.total)}</b>` : null}<${Status} s=${o.status} /><small>${o.status === "entregue" ? fmtData(o.entregue_em) : tempoDesde(o.criado_em)}</small></span></button>`;
}

const diasDesde = iso => (Date.now() - new Date(iso)) / 86400000;

export function Painel() {
  const { dados, perfil, ir } = useApp();
  const ver = pode(perfil, "verValores");
  const abertas = dados.ordens.filter(o => ABERTOS.includes(o.status));
  const minhas = perfil.papel === "mecanico" ? abertas.filter(o => o.mecanico_id === perfil.id) : null;
  const agora = new Date(), mes = agora.getMonth(), ano = agora.getFullYear();
  const doMes = dados.ordens.filter(o => (o.status === "entregue" || o.status === "recusado") && o.entregue_em && new Date(o.entregue_em).getMonth() === mes && new Date(o.entregue_em).getFullYear() === ano);
  const fat = doMes.reduce((s, o) => s + Number(o.total || 0), 0), custo = doMes.reduce((s, o) => s + Number(o.custo || 0), 0);
  const aguard = abertas.filter(o => o.status === "aguardando");
  const alertas = [];
  abertas.forEach(o => {
    if (o.status === "aguardando" && o.validade_orcamento && o.validade_orcamento < hojeISO()) alertas.push([o, "Orçamento vencido em " + fmtData(o.validade_orcamento) + " sem resposta"]);
    else if (o.status === "aguardando" && o.orcamento_enviado_em && diasDesde(o.orcamento_enviado_em) > 2) alertas.push([o, "Orçamento sem resposta há " + Math.floor(diasDesde(o.orcamento_enviado_em)) + " dias"]);
    if (o.status === "diagnostico" && diasDesde(o.criado_em) > 2) alertas.push([o, "Em diagnóstico há " + Math.floor(diasDesde(o.criado_em)) + " dias sem orçamento"]);
    if (o.status === "pronto" && diasDesde(o.atualizado_em) > 2) alertas.push([o, "Pronto há " + Math.floor(diasDesde(o.atualizado_em)) + " dias e não retirado"]);
    if (["diagnostico", "aguardando", "execucao"].includes(o.status) && o.previsao_entrega && o.previsao_entrega < hojeISO()) alertas.push([o, "Previsão de entrega (" + fmtData(o.previsao_entrega) + ") vencida"]);
  });
  const rasc = lsGet("dtcar-entrada-v1"), temRasc = rasc && (rasc.placa || rasc.clienteId);
  const coluna = s => { const l = abertas.filter(o => o.status === s);
    return html`<section class="card coluna"><div class="secao-topo"><h3>${STATUS[s].t}</h3><span class=${"pill p-" + STATUS[s].cor}>${l.length}</span></div>
      ${l.length ? html`<div class="lista">${l.map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma.</span>`}</section>`; };
  return html`<div class="pagina larga">
    ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri btn-grande" onClick=${() => ir("/entrada")}>${temRasc ? "Continuar entrada em andamento" + (rasc.placa ? " · " + rasc.placa : "") : "+ Nova entrada de veículo"}</button>` : null}
    <div class="kpis">
      <div class="kpi destaque"><b>${abertas.length}</b><span>O.S. abertas</span></div>
      <div class="kpi"><b>${aguard.length}</b><span>Aguardando aprovação</span>${ver && aguard.length ? html`<small>${reais(aguard.reduce((s, o) => s + Number(o.total || 0), 0))}</small>` : null}</div>
      <div class="kpi"><b>${abertas.filter(o => o.status === "pronto").length}</b><span>Prontos p/ retirada</span></div>
      ${ver ? html`<div class="kpi"><b class="kpi-din">${reais(fat)}</b><span>Faturado no mês</span><small>${doMes.length} saídas · ticket ${reais(doMes.length ? fat / doMes.length : 0)}</small></div>
        <div class="kpi"><b>${fat ? Math.round((fat - custo) / fat * 100) : 0}%</b><span>Margem bruta do mês</span><small>${reais(fat - custo)} sobre peças e terceiros</small></div>` : null}
    </div>
    ${ver ? html`<p class="dica">Faturamento não é lucro: a margem acima desconta só peças e terceiros. Impostos do Simples, salários, aluguel e taxas de cartão ainda saem dela.</p>` : null}
    ${alertas.length ? html`<section class="card alerta"><h3>Precisa de atenção (${alertas.length})</h3><div class="lista">${alertas.map(([o, t], n) => html`<button type="button" key=${n} class="linha" onClick=${() => ir("/os/" + o.id)}><${Placa} placa=${o.veiculo.placa} /><span class="meio"><strong>${t}</strong><span>${numOS(o.numero)} · ${o.cliente.nome}</span></span></button>`)}</div></section>` : null}
    ${minhas ? html`<section class="card"><h3>Minhas O.S. em andamento</h3>${minhas.length ? html`<div class="lista">${minhas.map(o => html`<${LinhaOS} key=${o.id} o=${o} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma O.S. atribuída a você.</span>`}</section>` : null}
    <div class="colunas">${["diagnostico", "aguardando", "execucao", "pronto"].map(coluna)}</div>
  </div>`;
}

export function Ordens() {
  const { dados, perfil, ir } = useApp();
  const ver = pode(perfil, "verValores");
  const [q, setQ] = useState(""), [filtro, setFiltro] = useState("abertas");
  const lista = useMemo(() => { const n = norm(q), p = normPlaca(q), d = soDig(q);
    return dados.ordens.filter(o => (filtro === "todas" || (filtro === "abertas" ? ABERTOS.includes(o.status) : o.status === filtro))
      && (!n || norm(o.cliente.nome).includes(n) || (p.length >= 3 && (o.veiculo.placa || "").includes(p)) || norm(o.veiculo.modelo).includes(n) || (d && String(o.numero).includes(String(+d)))));
  }, [q, filtro, dados.ordens]);
  return html`<div class="pagina">
    <div class="campo"><label for="busca-os">Buscar por placa, cliente, modelo ou número</label><input id="busca-os" class="inp" value=${q} onInput=${e => setQ(e.target.value)} /></div>
    <div class="chips rolagem">${[["abertas", "Abertas"], ["todas", "Todas"], ...Object.entries(STATUS).map(([k, v]) => [k, v.curto])].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (filtro === k ? " ativo" : "")} onClick=${() => setFiltro(k)}>${t}</button>`)}</div>
    <section class="card"><div class="secao-topo"><h2>Ordens de serviço</h2><span class="sub">${lista.length}</span></div>
      ${lista.length ? html`<div class="lista">${lista.map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<${Vazio}>${dados.ordens.length ? "Nenhuma O.S. com esse filtro." : "Nenhuma O.S. ainda. Elas são abertas na entrada do veículo."}</${Vazio}>`}
    </section></div>`;
}
