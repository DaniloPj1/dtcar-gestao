import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Status, Vazio } from "../ui.js";
import { reais, numOS, tempoDesde, fmtData, hojeISO, norm, normPlaca, soDig, lsGet, fmtTel } from "../util.js";
import { STATUS, ABERTOS, pode } from "../regras.js";
import { LS_NOVA } from "./entrada.js";

const DIA = 86400000;
const diasDesde = iso => (Date.now() - new Date(iso)) / DIA;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const reaisCurto = v => v >= 10000 ? "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : reais(v);

export function LinhaOS({ o, verValores, onClick }) {
  const atrasada = ["diagnostico", "aguardando", "execucao"].includes(o.status) && o.previsao_entrega && o.previsao_entrega < hojeISO();
  return html`<button type="button" class="linha" onClick=${onClick}><${Placa} placa=${o.veiculo.placa} />
    <span class="meio"><strong>${o.veiculo.marca} ${o.veiculo.modelo}</strong><span>${numOS(o.numero)} · ${o.cliente.nome}${o.mecanico_nome ? " · " + o.mecanico_nome : ""}</span></span>
    <span class="dir">${verValores && Number(o.total) > 0 ? html`<b>${reais(o.total)}</b>` : null}<${Status} s=${o.status} />
      <small class=${atrasada ? "c-bad" : ""}>${o.status === "entregue" ? fmtData(o.entregue_em) : atrasada ? "previsão vencida" : tempoDesde(o.criado_em)}</small></span></button>`;
}

/* ---------------- períodos ---------------- */
const PERIODOS = [["7d", "7 dias"], ["mes", "Este mês"], ["mesant", "Mês passado"], ["ano", "Este ano"], ["12m", "12 meses"]];
function intervalo(p) {
  const agora = new Date(), hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const m = (a, mes) => new Date(a, mes, 1);
  let ini, fim = new Date(agora.getTime() + 1), iniA, fimA, grupo = "dia", titulo;
  if (p === "7d") { ini = new Date(hoje.getTime() - 6 * DIA); iniA = new Date(ini.getTime() - 7 * DIA); fimA = ini; titulo = "7 dias anteriores"; }
  else if (p === "mes") { ini = m(agora.getFullYear(), agora.getMonth()); iniA = m(agora.getFullYear(), agora.getMonth() - 1); fimA = new Date(iniA.getFullYear(), iniA.getMonth(), Math.min(agora.getDate(), 28), 23, 59); titulo = "mesmo período do mês passado"; }
  else if (p === "mesant") { ini = m(agora.getFullYear(), agora.getMonth() - 1); fim = m(agora.getFullYear(), agora.getMonth()); iniA = m(agora.getFullYear(), agora.getMonth() - 2); fimA = ini; titulo = "mês anterior"; }
  else if (p === "ano") { ini = m(agora.getFullYear(), 0); iniA = m(agora.getFullYear() - 1, 0); fimA = new Date(agora.getFullYear() - 1, agora.getMonth(), agora.getDate(), 23, 59); grupo = "mes"; titulo = "mesmo período do ano passado"; }
  else { ini = m(agora.getFullYear(), agora.getMonth() - 11); iniA = m(agora.getFullYear(), agora.getMonth() - 23); fimA = ini; grupo = "mes"; titulo = "12 meses anteriores"; }
  return { ini, fim, iniA, fimA, grupo, titulo };
}
const dentro = (iso, a, b) => { if (!iso) return false; const t = new Date(iso); return t >= a && t < b; };
const saidas = (ordens, a, b) => ordens.filter(o => (o.status === "entregue" || o.status === "recusado") && dentro(o.entregue_em, a, b) && Number(o.total) > 0);
function metricas(ordens, a, b) {
  const sa = saidas(ordens, a, b);
  const fat = sa.reduce((s, o) => s + Number(o.total || 0), 0), custo = sa.reduce((s, o) => s + Number(o.custo || 0), 0);
  const entregues = sa.filter(o => o.status === "entregue");
  const prazo = entregues.length ? entregues.reduce((s, o) => s + (new Date(o.entregue_em) - new Date(o.criado_em)) / DIA, 0) / entregues.length : 0;
  const decididos = ordens.filter(o => dentro(o.orcamento_enviado_em || o.criado_em, a, b) && ["execucao", "pronto", "entregue", "recusado"].includes(o.status));
  const aprov = decididos.filter(o => o.status !== "recusado").length;
  const entradas = ordens.filter(o => dentro(o.criado_em, a, b) && o.status !== "cancelado").length;
  return { sa, fat, custo, margem: fat - custo, n: sa.length, ticket: sa.length ? fat / sa.length : 0, prazo, taxaAprov: decididos.length ? aprov / decididos.length : null, decididos: decididos.length, entradas };
}
function Delta({ atual, anterior, inverso }) {
  if (!anterior) return null;
  const d = (atual - anterior) / anterior * 100; if (!isFinite(d)) return null;
  const bom = inverso ? d < 0 : d > 0;
  return html`<em class=${"delta " + (Math.abs(d) < 1 ? "" : bom ? "c-ok" : "c-bad")}>${d > 0 ? "▲" : d < 0 ? "▼" : "■"} ${Math.abs(d).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</em>`;
}

/* ---------------- gráfico de barras (SVG) ---------------- */
function Barras({ dados, titulo }) {
  const max = Math.max(1, ...dados.map(d => d.v));
  const passo = [1, 2, 2.5, 5, 10].map(m => m * Math.pow(10, Math.floor(Math.log10(max)))).find(x => max / x <= 4) || max;
  const topo = Math.ceil(max / passo) * passo;
  const W = 640, H = 200, ml = 54, mb = 24, mt = 8, l = (W - ml - 8) / dados.length, bw = Math.max(2, Math.min(34, l * 0.7));
  const y = v => mt + (H - mt - mb) * (1 - v / topo);
  const marcas = []; for (let v = 0; v <= topo + 0.001; v += passo) marcas.push(v);
  const cadaRot = Math.ceil(dados.length / 12);
  return html`<figure class="grafico" aria-label=${titulo}><svg viewBox=${`0 0 ${W} ${H}`} role="img">
    ${marcas.map(v => html`<g key=${v}><line x1=${ml} x2=${W - 4} y1=${y(v)} y2=${y(v)} class="g-grade" /><text x=${ml - 6} y=${y(v) + 4} class="g-eixo" text-anchor="end">${reaisCurto(v).replace("R$ ", "")}</text></g>`)}
    ${dados.map((d, i) => { const x = ml + i * l + (l - bw) / 2; return html`<g key=${i}>
      <rect x=${x} y=${y(d.v)} width=${bw} height=${Math.max(0, H - mb - y(d.v))} rx="2" class=${d.v ? "g-barra" : "g-barra vazia"}><title>${d.rot}: ${reais(d.v)}</title></rect>
      ${i % cadaRot === 0 ? html`<text x=${x + bw / 2} y=${H - 7} class="g-eixo" text-anchor="middle">${d.rot}</text>` : null}</g>`; })}
  </svg></figure>`;
}
function serie(sa, ini, fim, grupo) {
  const out = [], idx = new Map();
  if (grupo === "mes") { for (let d = new Date(ini); d < fim; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) { const k = d.getFullYear() + "-" + d.getMonth(); idx.set(k, out.length); out.push({ rot: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), v: 0 }); } }
  else { for (let d = new Date(ini); d < fim; d = new Date(d.getTime() + DIA)) { const k = d.toDateString(); idx.set(k, out.length); out.push({ rot: String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"), v: 0 }); } }
  for (const o of sa) { const d = new Date(o.entregue_em); const k = grupo === "mes" ? d.getFullYear() + "-" + d.getMonth() : new Date(d.getFullYear(), d.getMonth(), d.getDate()).toDateString(); const i = idx.get(k); if (i !== undefined) out[i].v += Number(o.total || 0); }
  return out;
}

function Resultados() {
  const { dados, ir } = useApp();
  const [per, setPer] = useState(() => lsGet("dtcar-periodo") || "mes");
  const [itens, setItens] = useState(null);
  const iv = useMemo(() => intervalo(per), [per]);
  const m = useMemo(() => metricas(dados.ordens, iv.ini, iv.fim), [dados.ordens, iv]);
  const ant = useMemo(() => metricas(dados.ordens, iv.iniA, iv.fimA), [dados.ordens, iv]);
  const chave = m.sa.map(o => o.id).join(",");
  useEffect(() => { let vivo = true; setItens(null); if (!m.sa.length) { setItens([]); return; }
    api.itensDasOrdens(m.sa.map(o => o.id)).then(r => vivo && setItens(r)).catch(() => vivo && setItens([])); return () => { vivo = false; }; }, [chave]);
  const escolher = p => { setPer(p); try { localStorage.setItem("dtcar-periodo", JSON.stringify(p)); } catch (e) {} };

  const comp = useMemo(() => { if (!itens) return null; const c = { servico: 0, peca: 0, terceiro: 0, custoPeca: 0, custoTerc: 0 };
    for (const i of itens) { if (i.aprovado === false) continue; const v = Number(i.qtd) * Number(i.valor_unit), cu = Number(i.qtd) * Number(i.custo_unit || 0); c[i.tipo] += v; if (i.tipo === "peca") c.custoPeca += cu; if (i.tipo === "terceiro") c.custoTerc += cu; }
    c.total = c.servico + c.peca + c.terceiro; return c; }, [itens]);
  const top = useMemo(() => { if (!itens) return []; const g = new Map();
    for (const i of itens) { if (i.tipo !== "servico" || i.aprovado === false) continue; const k = norm(i.descricao); const x = g.get(k) || { nome: i.descricao, v: 0, n: 0 }; x.v += Number(i.qtd) * Number(i.valor_unit); x.n += 1; g.set(k, x); }
    return [...g.values()].sort((a, b) => b.v - a.v).slice(0, 6); }, [itens]);
  const formas = useMemo(() => { const g = new Map(); for (const o of m.sa) { const k = o.forma_pagamento || "Não informado"; g.set(k, (g.get(k) || 0) + Number(o.total || 0)); } return [...g.entries()].sort((a, b) => b[1] - a[1]); }, [m]);

  const k = (rot, valor, extra, alerta) => html`<div class=${"kpi" + (alerta ? " alerta-kpi" : "")}><span>${rot}</span><b class="kpi-din">${valor}</b>${extra ? html`<small>${extra}</small>` : null}</div>`;
  const cobertura = useMemo(() => { if (!itens) return null; let tot = 0, com = 0; for (const i of itens) { if (i.tipo === "servico" || i.aprovado === false) continue; const v = Number(i.qtd) * Number(i.valor_unit); tot += v; if (Number(i.custo_unit) > 0) com += v; } return tot ? com / tot : 1; }, [itens]);
  const margemDuvidosa = cobertura !== null && cobertura < 0.8;
  return html`<section class="card resultados">
    <div class="secao-topo"><h2>Resultados</h2>
      <div class="chips rolagem" role="tablist">${PERIODOS.map(([p, t]) => html`<button type="button" key=${p} role="tab" aria-selected=${per === p} class=${"chip-f" + (per === p ? " ativo" : "")} onClick=${() => escolher(p)}>${t}</button>`)}</div></div>
    <div class="kpis">
      ${k("Faturamento", reais(m.fat), html`<${Delta} atual=${m.fat} anterior=${ant.fat} /> vs ${iv.titulo}`)}
      ${k("Margem bruta", reais(m.margem), margemDuvidosa ? "⚠ custo lançado em só " + Math.round(cobertura * 100) + "% das peças: margem superestimada" : (m.fat ? Math.round(m.margem / m.fat * 100) : 0) + "% (desconta peças e terceiros)", margemDuvidosa)}
      ${k("Ticket médio", reais(m.ticket), html`${m.n} saídas <${Delta} atual=${m.n} anterior=${ant.n} />`)}
      ${k("Aprovação de orçamentos", m.taxaAprov === null ? "—" : Math.round(m.taxaAprov * 100) + "%", m.decididos + " orçamentos decididos")}
      ${k("Prazo médio", m.prazo ? m.prazo.toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " dias" : "—", "da entrada à entrega")}
      ${k("Entradas", m.entradas, html`O.S. abertas no período <${Delta} atual=${m.entradas} anterior=${ant.entradas} />`)}
    </div>
    ${m.n ? html`<${Barras} dados=${serie(m.sa, iv.ini, iv.fim, iv.grupo)} titulo="Faturamento por ${iv.grupo === "mes" ? "mês" : "dia"}" />` : html`<${Vazio}>Nenhuma O.S. entregue neste período.</${Vazio}>`}
    <div class="duas-col">
      <div class="bloco-res"><h3>Composição da receita</h3>
        ${!comp ? html`<span class="dica">Calculando…</span>` : !comp.total ? html`<span class="dica">Sem itens no período.</span>` : html`
          <div class="pilha" role="img" aria-label="Composição da receita">
            <i class="s1" style=${{ width: pct(comp.servico, comp.total) + "%" }}></i><i class="s2" style=${{ width: pct(comp.peca, comp.total) + "%" }}></i><i class="s3" style=${{ width: pct(comp.terceiro, comp.total) + "%" }}></i></div>
          <ul class="legenda">
            <li><span class="q s1"></span>Mão de obra<b>${reais(comp.servico)} · ${pct(comp.servico, comp.total)}%</b></li>
            <li><span class="q s2"></span>Peças<b>${reais(comp.peca)} · ${pct(comp.peca, comp.total)}%</b></li>
            ${comp.terceiro ? html`<li><span class="q s3"></span>Terceiros<b>${reais(comp.terceiro)} · ${pct(comp.terceiro, comp.total)}%</b></li>` : null}
          </ul>
          ${comp.peca ? html`<span class="dica">Margem nas peças: ${comp.custoPeca ? pct(comp.peca - comp.custoPeca, comp.peca) + "% (custo lançado em " + reais(comp.custoPeca) + ")" : "custo das peças não informado nas O.S."}</span>` : null}`}
      </div>
      <div class="bloco-res"><h3>Serviços que mais faturaram</h3>
        ${!itens ? html`<span class="dica">Calculando…</span>` : top.length ? html`<ol class="ranking">${top.map((t, i) => html`<li key=${i}><span>${t.nome}</span><b>${reais(t.v)}</b><small>${t.n}×</small></li>`)}</ol>` : html`<span class="dica">Sem serviços no período.</span>`}
      </div>
      <div class="bloco-res"><h3>Formas de pagamento</h3>
        ${formas.length ? html`<ul class="ranking">${formas.map(([f, v]) => html`<li key=${f}><span>${f}</span><b>${reais(v)}</b><small>${pct(v, m.fat)}%</small></li>`)}</ul>
          <span class="dica">Lembre de descontar as taxas de cartão: o valor que entra no caixa é menor que o faturado.</span>` : html`<span class="dica">Sem pagamentos no período.</span>`}
      </div>
    </div>
    <p class="dica">Faturamento não é lucro: a margem acima desconta só peças e terceiros. Impostos do Simples, salários, aluguel e taxas de cartão ainda saem dela.</p>
  </section>`;
}

function Relacionamento() {
  const { dados, ir } = useApp();
  const ultima = useMemo(() => { const u = new Map(); for (const o of dados.ordens) { if (!o.cliente_id || o.status === "cancelado") continue; const t = o.entregue_em || o.criado_em; if (!u.has(o.cliente_id) || t > u.get(o.cliente_id)) u.set(o.cliente_id, t); } return u; }, [dados.ordens]);
  const abertos = new Set(dados.ordens.filter(o => ABERTOS.includes(o.status)).map(o => o.cliente_id));
  const recuperar = dados.clientes.filter(c => { const t = ultima.get(c.id); if (!t || abertos.has(c.id)) return false; const d = diasDesde(t); return d >= 180 && d <= 730 && soDig(c.telefone).length >= 10; });
  const mes = new Date().getMonth();
  const aniv = dados.clientes.filter(c => c.nascimento && Number(c.nascimento.slice(5, 7)) - 1 === mes);
  if (!recuperar.length && !aniv.length) return null;
  return html`<section class="card"><h2>Relacionamento</h2><div class="duas-col">
    <div class="bloco-res"><h3>Clientes para recuperar</h3><b class="kpi-num">${recuperar.length}</b>
      <span class="dica">Última visita entre 6 meses e 2 anos, sem O.S. aberta e com telefone.</span>
      <button type="button" class="btn btn-sm" onClick=${() => ir("/cadastros?filtro=recuperar")}>Ver lista e chamar no WhatsApp</button></div>
    ${aniv.length ? html`<div class="bloco-res"><h3>Aniversariantes do mês</h3><ul class="ranking">${aniv.slice(0, 8).map(c => html`<li key=${c.id}><span>${c.nome}</span><b>${c.nascimento.slice(8, 10)}/${c.nascimento.slice(5, 7)}</b></li>`)}</ul></div>` : null}
  </div></section>`;
}

export function Painel() {
  const { dados, perfil, ir } = useApp();
  const ver = pode(perfil, "verValores");
  const [foco, setFoco] = useState("");
  const abertas = dados.ordens.filter(o => ABERTOS.includes(o.status));
  const minhas = perfil.papel === "mecanico" ? abertas.filter(o => o.mecanico_id === perfil.id || (o.mecanico_nome && norm(o.mecanico_nome) === norm(perfil.nome))) : null;
  const alertas = [];
  abertas.forEach(o => {
    if (o.status === "aguardando" && o.validade_orcamento && o.validade_orcamento < hojeISO()) alertas.push([o, "Orçamento vencido em " + fmtData(o.validade_orcamento) + " sem resposta", "warn"]);
    else if (o.status === "aguardando" && o.orcamento_enviado_em && diasDesde(o.orcamento_enviado_em) > 2) alertas.push([o, "Orçamento sem resposta há " + Math.floor(diasDesde(o.orcamento_enviado_em)) + " dias", "warn"]);
    if (o.status === "diagnostico" && diasDesde(o.criado_em) > 2) alertas.push([o, "Em diagnóstico há " + Math.floor(diasDesde(o.criado_em)) + " dias sem orçamento", "warn"]);
    if (o.status === "pronto" && diasDesde(o.atualizado_em) > 2) alertas.push([o, "Pronto há " + Math.floor(diasDesde(o.atualizado_em)) + " dias e não retirado", "bad"]);
    if (["diagnostico", "aguardando", "execucao"].includes(o.status) && o.previsao_entrega && o.previsao_entrega < hojeISO()) alertas.push([o, "Previsão de entrega (" + fmtData(o.previsao_entrega) + ") vencida", "bad"]);
  });
  const [verTodos, setVerTodos] = useState(false);
  const rasc = lsGet(LS_NOVA), temRasc = rasc && (rasc.placa || rasc.clienteId || rasc.reclamacao);
  const hora = new Date().getHours(), saud = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const colunas = ["diagnostico", "aguardando", "execucao", "pronto"].filter(s => !foco || s === foco);
  const valorDe = s => abertas.filter(o => o.status === s).reduce((t, o) => t + Number(o.total || 0), 0);

  return html`<div class="pagina larga">
    <div class="painel-topo"><div><h1>${saud}, ${perfil.nome.split(" ")[0]}</h1><span class="sub">${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</span></div>
      ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri" onClick=${() => ir("/entrada")}>${temRasc ? "Continuar O.S. em andamento" : "+ Nova O.S."}</button>` : null}</div>
    <div class="patio" role="group" aria-label="Situação do pátio">
      ${["diagnostico", "aguardando", "execucao", "pronto"].map(s => { const n = abertas.filter(o => o.status === s).length; return html`<button type="button" key=${s} class=${"patio-item t-" + STATUS[s].cor + (foco === s ? " ativo" : "")} aria-pressed=${foco === s} onClick=${() => setFoco(foco === s ? "" : s)}>
        <b>${n}</b><span>${STATUS[s].t}</span>${ver && n ? html`<small>${reaisCurto(valorDe(s))}</small>` : null}</button>`; })}
    </div>
    ${alertas.length ? html`<section class="card alerta"><div class="secao-topo"><h3>Precisa de atenção (${alertas.length})</h3>${alertas.length > 5 ? html`<button type="button" class="btn-link" onClick=${() => setVerTodos(!verTodos)}>${verTodos ? "Mostrar menos" : "Ver todos"}</button>` : null}</div>
      <div class="lista">${(verTodos ? alertas : alertas.slice(0, 5)).map(([o, t, c], n) => html`<button type="button" key=${n} class="linha" onClick=${() => ir("/os/" + o.id)}><span class=${"dot s-" + c}></span><span class="meio"><strong>${t}</strong><span>${numOS(o.numero)} · ${exPlacaCurta(o)} · ${o.cliente.nome}</span></span></button>`)}</div></section>` : null}
    ${minhas ? html`<section class="card"><h3>Minhas O.S. em andamento</h3>${minhas.length ? html`<div class="lista">${minhas.map(o => html`<${LinhaOS} key=${o.id} o=${o} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma O.S. atribuída a você.</span>`}</section>` : null}
    <div class=${"colunas" + (foco ? " uma" : "")}>${colunas.map(s => { const l = abertas.filter(o => o.status === s).sort((a, b) => a.criado_em < b.criado_em ? -1 : 1);
      return html`<section class="card coluna" key=${s}><div class="secao-topo"><h3>${STATUS[s].t}</h3><span class=${"pill p-" + STATUS[s].cor}>${l.length}</span></div>
        ${l.length ? html`<div class="lista">${l.map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma.</span>`}</section>`; })}</div>
    ${ver ? html`<${Resultados} />` : null}
    ${ver ? html`<${Relacionamento} />` : null}
  </div>`;
}
const exPlacaCurta = o => (o.veiculo && o.veiculo.placa) || "sem placa";

export function Ordens() {
  const { dados, perfil, ir } = useApp();
  const ver = pode(perfil, "verValores");
  const [q, setQ] = useState(""), [filtro, setFiltro] = useState("abertas"), [lim, setLim] = useState(60);
  const lista = useMemo(() => { const n = norm(q), p = normPlaca(q), d = soDig(q);
    return dados.ordens.filter(o => (filtro === "todas" || (filtro === "abertas" ? ABERTOS.includes(o.status) : o.status === filtro))
      && (!n || norm(o.cliente.nome).includes(n) || (p.length >= 3 && (o.veiculo.placa || "").includes(p)) || norm(o.veiculo.modelo).includes(n) || (d && String(o.numero) === String(+d)) || norm(o.reclamacao).includes(n)));
  }, [q, filtro, dados.ordens]);
  useEffect(() => setLim(60), [q, filtro]);
  const soma = lista.reduce((s, o) => s + Number(o.total || 0), 0);
  return html`<div class="pagina">
    <div class="campo"><label for="busca-os">Buscar por placa, cliente, modelo, número ou reclamação</label><input id="busca-os" class="inp" value=${q} onInput=${e => setQ(e.target.value)} /></div>
    <div class="chips rolagem">${[["abertas", "Abertas"], ["todas", "Todas"], ...Object.entries(STATUS).map(([k, v]) => [k, v.curto])].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (filtro === k ? " ativo" : "")} onClick=${() => setFiltro(k)}>${t}</button>`)}</div>
    <section class="card"><div class="secao-topo"><h2>Ordens de serviço</h2><span class="sub">${lista.length}${ver && soma ? " · " + reais(soma) : ""}</span></div>
      ${lista.length ? html`<div class="lista">${lista.slice(0, lim).map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>
        ${lista.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 100)}>Mostrar mais (${lista.length - lim} restantes)</button>` : null}`
        : html`<${Vazio}>${dados.ordens.length ? "Nenhuma O.S. com esse filtro." : "Nenhuma O.S. ainda."}</${Vazio}>`}
    </section></div>`;
}
