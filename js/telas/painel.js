import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Status, Vazio, I } from "../ui.js";
import { reais, numOS, tempoDesde, fmtData, hojeISO, norm, normPlaca, soDig, lsGet, fmtTel, exPlaca, linkWhats } from "../util.js";
import { STATUS, ABERTOS, pode } from "../regras.js";
import { LS_NOVA } from "./entrada.js";
import { estoqueBaixo } from "./produtos.js";

const DIA = 86400000;
const diasDesde = iso => (Date.now() - new Date(iso)) / DIA;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const reaisCurto = v => v >= 10000 ? "R$ " + (v / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mil" : reais(v);

export function LinhaOS({ o, verValores, onClick }) {
  const atrasada = ["diagnostico", "aguardando", "execucao"].includes(o.status) && o.previsao_entrega && o.previsao_entrega < hojeISO();
  return html`<button type="button" class="linha" onClick=${onClick}><${Placa} placa=${o.veiculo.placa} />
    <span class="meio"><strong>${o.veiculo.marca} ${o.veiculo.modelo}${o.situacao ? html` <em class="tag">${o.situacao}</em>` : null}</strong><span>${numOS(o.numero)} · ${o.cliente.nome}${o.mecanico_nome ? " · " + o.mecanico_nome : ""}${o.box ? " · box " + o.box : ""}</span></span>
    <span class="dir">${verValores && Number(o.total) > 0 ? html`<b>${reais(o.total)}</b>` : null}<${Status} s=${o.status} />
      <small class=${atrasada ? "c-bad" : ""}>${o.status === "entregue" ? fmtData(o.entregue_em) : atrasada ? "previsão vencida" : tempoDesde(o.criado_em)}</small></span></button>`;
}

/* ---------------- períodos ---------------- */
const PERIODOS = [["hoje", "Hoje"], ["7d", "7 dias"], ["mes", "Este mês"], ["mesant", "Mês passado"], ["ano", "Este ano"], ["12m", "12 meses"]];
function intervalo(p) {
  const agora = new Date(), hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const m = (a, mes) => new Date(a, mes, 1);
  let ini, fim = new Date(agora.getTime() + 1000), iniA, fimA, grupo = "dia", titulo;
  if (p === "hoje") { ini = hoje; iniA = new Date(hoje.getTime() - 7 * DIA); fimA = new Date(iniA.getTime() + (agora - hoje)); titulo = "mesmo dia da semana passada"; }
  else if (p === "7d") { ini = new Date(hoje.getTime() - 6 * DIA); iniA = new Date(ini.getTime() - 7 * DIA); fimA = ini; titulo = "7 dias anteriores"; }
  else if (p === "mes") { ini = m(agora.getFullYear(), agora.getMonth()); iniA = m(agora.getFullYear(), agora.getMonth() - 1); fimA = new Date(iniA.getFullYear(), iniA.getMonth(), Math.min(agora.getDate(), 28), 23, 59); titulo = "mesmo período do mês passado"; }
  else if (p === "mesant") { ini = m(agora.getFullYear(), agora.getMonth() - 1); fim = m(agora.getFullYear(), agora.getMonth()); iniA = m(agora.getFullYear(), agora.getMonth() - 2); fimA = ini; titulo = "mês anterior"; }
  else if (p === "ano") { ini = m(agora.getFullYear(), 0); iniA = m(agora.getFullYear() - 1, 0); fimA = new Date(agora.getFullYear() - 1, agora.getMonth(), agora.getDate(), 23, 59); grupo = "mes"; titulo = "mesmo período do ano passado"; }
  else { ini = m(agora.getFullYear(), agora.getMonth() - 11); iniA = m(agora.getFullYear(), agora.getMonth() - 23); fimA = ini; grupo = "mes"; titulo = "12 meses anteriores"; }
  return { ini, fim, iniA, fimA, grupo, titulo };
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
      ${i % cadaRot === 0 ? html`<text x=${x + bw / 2} y=${H - 7} class="g-eixo" text-anchor="middle">${d.rot}</text>`  : null}</g>`; })}
  </svg></figure>`;
}
const chaveDia = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function serie(pontos, ini, fim, grupo) {
  const v = new Map((pontos || []).map(p => [p.k, Number(p.v)])), out = [];
  if (grupo === "mes") for (let d = new Date(ini.getFullYear(), ini.getMonth(), 1); d < fim; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) out.push({ rot: d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", ""), v: v.get(chaveDia(d)) || 0 });
  else for (let d = new Date(ini); d < fim; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) out.push({ rot: String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0"), v: v.get(chaveDia(d)) || 0 });
  return out;
}

/** Resultados do período calculados no servidor (uma chamada por período) */
function Resultados() {
  const [per, setPer] = useState(() => lsGet("dtcar-periodo") || "mes");
  const [r, setR] = useState(null), [ra, setRa] = useState(null), [erro, setErro] = useState("");
  const iv = useMemo(() => intervalo(per), [per]);
  useEffect(() => { let vivo = true; setR(null); setRa(null); setErro("");
    Promise.all([api.painel(iv.ini.toISOString(), iv.fim.toISOString(), iv.grupo), api.painel(iv.iniA.toISOString(), iv.fimA.toISOString(), iv.grupo)])
      .then(([a, b]) => { if (vivo) { setR(a); setRa(b); } }).catch(e => vivo && setErro(e.message));
    return () => { vivo = false; }; }, [per]);
  const escolher = p => { setPer(p); try { localStorage.setItem("dtcar-periodo", JSON.stringify(p)); } catch (e) {} };
  const k = (rot, valor, extra, alerta) => html`<div class=${"kpi" + (alerta ? " alerta-kpi" : "")}><span>${rot}</span><b class="kpi-din">${valor}</b>${extra ? html`<small>${extra}</small>` : null}</div>`;
  const cab = html`<div class="secao-topo"><h2>Resultados</h2>
    <div class="chips rolagem" role="tablist">${PERIODOS.map(([p, t]) => html`<button type="button" key=${p} role="tab" aria-selected=${per === p} class=${"chip-f" + (per === p ? " ativo" : "")} onClick=${() => escolher(p)}>${t}</button>`)}</div></div>`;
  if (erro) return html`<section class="card resultados">${cab}<div class="erros">Não foi possível calcular os resultados: ${erro}</div></section>`;
  if (!r) return html`<section class="card resultados">${cab}<div class="kpis carregando-kpis">${[1, 2, 3, 4, 5, 6].map(i => html`<div class="kpi esqueleto" key=${i}></div>`)}</div></section>`;
  const n = x => Number(x) || 0;
  const fat = n(r.faturamento), custo = n(r.custo), margem = fat - custo, ticket = r.saidas ? fat / r.saidas : 0, ant = ra || {};
  const comp = r.composicao || {}, totComp = n(comp.servico) + n(comp.peca) + n(comp.terceiro);
  const cobertura = n(comp.peca) ? n(comp.peca_com_custo) / n(comp.peca) : 1, duvidosa = cobertura < 0.8;
  const taxa = r.decididos ? r.aprovados / r.decididos : null;
  return html`<section class="card resultados">${cab}
    <div class="kpis">
      ${k("Faturamento", reais(fat), html`<${Delta} atual=${fat} anterior=${n(ant.faturamento)} /> vs ${iv.titulo}`)}
      ${k("Recebido (recibos)", reais(r.recebido), n(r.recebido) ? (fat ? Math.round(n(r.recebido) / fat * 100) + "% do faturado" : "") : "sem recibos emitidos no período")}
      ${k("Margem bruta", reais(margem), duvidosa ? "⚠ custo lançado em só " + Math.round(cobertura * 100) + "% das peças: margem superestimada" : (fat ? Math.round(margem / fat * 100) : 0) + "% (desconta peças e terceiros)", duvidosa)}
      ${k("Ticket médio", reais(ticket), html`${r.saidas} saídas <${Delta} atual=${r.saidas} anterior=${n(ant.saidas)} />`)}
      ${k("Aprovação de orçamentos", taxa === null ? "—" : Math.round(taxa * 100) + "%", r.decididos + " orçamentos decididos")}
      ${k("Prazo médio", r.prazo_medio ? n(r.prazo_medio).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " dias" : "—", "da entrada à entrega")}
      ${k("Entradas", r.entradas, html`O.S. abertas no período <${Delta} atual=${r.entradas} anterior=${n(ant.entradas)} />`)}
    </div>
    ${r.saidas && per !== "hoje" ? html`<${Barras} dados=${serie(r.serie, iv.ini, iv.fim, iv.grupo)} titulo=${"Faturamento por " + (iv.grupo === "mes" ? "mês" : "dia")} />` : !r.saidas ? html`<${Vazio}>Nenhuma O.S. entregue neste período.</${Vazio}>` : null}
    ${totComp ? html`<div class="duas-col">
      <div class="bloco-res"><h3>Composição da receita</h3>
        <div class="pilha" role="img" aria-label="Composição da receita">
          <i class="s1" style=${{ width: pct(comp.servico, totComp) + "%" }}></i><i class="s2" style=${{ width: pct(comp.peca, totComp) + "%" }}></i><i class="s3" style=${{ width: pct(comp.terceiro, totComp) + "%" }}></i></div>
        <ul class="legenda">
          <li><span class="q s1"></span>Mão de obra<b>${reais(comp.servico)} · ${pct(comp.servico, totComp)}%</b></li>
          <li><span class="q s2"></span>Peças<b>${reais(comp.peca)} · ${pct(comp.peca, totComp)}%</b></li>
          ${n(comp.terceiro) ? html`<li><span class="q s3"></span>Outros / terceiros<b>${reais(comp.terceiro)} · ${pct(comp.terceiro, totComp)}%</b></li>` : null}
        </ul>
        ${n(comp.peca) ? html`<span class="dica">Margem nas peças: ${n(comp.custo_peca) ? pct(n(comp.peca_com_custo) - n(comp.custo_peca), n(comp.peca_com_custo)) + "% nas peças com custo lançado" : "custo das peças não informado nas O.S."}</span>` : null}
      </div>
      <div class="bloco-res"><h3>Serviços que mais faturaram</h3>
        ${(r.top_servicos || []).length ? html`<ol class="ranking">${r.top_servicos.map((t, i) => html`<li key=${i}><span>${t.nome}</span><b>${reais(t.v)}</b><small>${t.n}×</small></li>`)}</ol>` : html`<span class="dica">Sem serviços no período.</span>`}</div>
      <div class="bloco-res"><h3>Peças que mais venderam</h3>
        ${(r.top_pecas || []).length ? html`<ol class="ranking">${r.top_pecas.map((t, i) => html`<li key=${i}><span>${t.nome}</span><b>${reais(t.v)}</b><small>${t.n}×</small></li>`)}</ol>` : html`<span class="dica">Sem peças no período.</span>`}</div>
      <div class="bloco-res"><h3>Formas de pagamento</h3>
        ${(r.formas || []).length ? html`<ul class="ranking">${r.formas.map(f => html`<li key=${f.forma}><span>${f.forma}</span><b>${reais(f.v)}</b><small>${pct(f.v, fat)}%</small></li>`)}</ul>
          <span class="dica">Desconte as taxas de cartão: o que entra no caixa é menor que o faturado.</span>` : html`<span class="dica">Sem pagamentos no período.</span>`}</div>
    </div>` : null}
    <p class="dica">Faturamento não é lucro: a margem acima desconta só peças e terceiros. Impostos do Simples, salários, aluguel e taxas de cartão ainda saem dela.</p>
  </section>`;
}

function Relacionamento() {
  const { dados, cfg, ir } = useApp();
  const ultima = useMemo(() => { const u = new Map(); for (const o of dados.ordens) { if (!o.cliente_id || o.status === "cancelado") continue; const t = o.entregue_em || o.criado_em; if (!u.has(o.cliente_id) || t > u.get(o.cliente_id)) u.set(o.cliente_id, t); } return u; }, [dados.ordens]);
  const abertos = new Set(dados.ordens.filter(o => ABERTOS.includes(o.status)).map(o => o.cliente_id));
  const recuperar = dados.clientes.filter(c => { const t = ultima.get(c.id); if (!t || abertos.has(c.id)) return false; const d = diasDesde(t); return d >= 180 && d <= 730 && soDig(c.telefone).length >= 10; });
  const mes = new Date().getMonth();
  const aniv = dados.clientes.filter(c => c.nascimento && Number(c.nascimento.slice(5, 7)) - 1 === mes);
  // manutenção programada vencendo (revisão, óleo, filtros) entre 30 dias atrás e 30 dias à frente
  const hoje = hojeISO(), lim = d => d >= somaDiasISO(hoje, -30) && d <= somaDiasISO(hoje, 30);
  const manut = dados.veiculos.map(v => { const p = [["revisão", v.revisao_data], ["troca de óleo", v.oleo_data], ["troca de filtros", v.filtro_data]].filter(([, d]) => d && lim(d)).sort((a, b) => a[1].localeCompare(b[1]))[0];
    return p ? { v, oque: p[0], data: p[1], c: dados.clientes.find(c => c.id === v.cliente_id) } : null; }).filter(x => x && x.c && soDig(x.c.telefone).length >= 10 && !abertos.has(x.c.id)).sort((a, b) => a.data.localeCompare(b.data));
  if (!recuperar.length && !aniv.length && !manut.length) return null;
  const lembrete = x => `Olá, ${x.c.nome.split(" ")[0]}! Aqui é da ${cfg.nome}.\n\nA ${x.oque} do seu ${[x.v.marca, x.v.modelo].filter(Boolean).join(" ")} (${exPlaca(x.v.placa)}) ${x.data < hoje ? "venceu em" : "vence em"} ${fmtData(x.data)}. Quer agendar? É só responder esta mensagem.`;
  return html`<section class="card"><h2>Relacionamento</h2><div class="duas-col">
    ${manut.length ? html`<div class="bloco-res"><h3>Manutenção programada vencendo (${manut.length})</h3><ul class="ranking">${manut.slice(0, 6).map(x => html`<li key=${x.v.id}><span>${exPlaca(x.v.placa)} · ${x.c.nome.split(" ")[0]} · ${x.oque}</span><b class=${x.data < hoje ? "c-bad" : ""}>${fmtData(x.data)}</b>
      <a class="btn btn-sm btn-whats" aria-label=${"WhatsApp para " + x.c.nome} href=${linkWhats(x.c.telefone, lembrete(x))} target="_blank" rel="noopener">${I.whats}</a></li>`)}</ul></div>` : null}
    ${recuperar.length ? html`<div class="bloco-res"><h3>Clientes para recuperar</h3><b class="kpi-num">${recuperar.length}</b>
      <span class="dica">Última visita entre 6 meses e 2 anos, sem O.S. aberta e com telefone.</span>
      <button type="button" class="btn btn-sm" onClick=${() => ir("/cadastros?filtro=recuperar")}>Ver lista e chamar no WhatsApp</button></div>` : null}
    ${aniv.length ? html`<div class="bloco-res"><h3>Aniversariantes do mês</h3><ul class="ranking">${aniv.slice(0, 8).map(c => html`<li key=${c.id}><span>${c.nome}</span><b>${c.nascimento.slice(8, 10)}/${c.nascimento.slice(5, 7)}</b></li>`)}</ul></div>` : null}
  </div></section>`;
}
const somaDiasISO = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return chaveDia(d); };

/** Busca rápida: placa, número da O.S., cliente ou telefone */
function BuscaRapida() {
  const { dados, ir } = useApp();
  const [q, setQ] = useState("");
  const n = norm(q), p = normPlaca(q), d = soDig(q);
  const res = useMemo(() => {
    if (q.trim().length < 2) return [];
    const os = dados.ordens.filter(o => (d && String(o.numero) === String(+d)) || (p.length >= 3 && (o.veiculo.placa || "").includes(p))).slice(0, 4).map(o => ({ k: "o" + o.id, t: numOS(o.numero) + " · " + (o.veiculo.placa || "") + " · " + o.cliente.nome, s: STATUS[o.status].curto, r: "/os/" + o.id }));
    const cl = n.length >= 3 ? dados.clientes.filter(c => norm(c.nome).includes(n) || (d.length >= 4 && soDig(c.telefone).includes(d))).slice(0, 4).map(c => ({ k: "c" + c.id, t: c.nome, s: c.telefone ? fmtTel(c.telefone) : "cliente", r: "/cliente/" + c.id })) : [];
    const ve = p.length >= 3 ? dados.veiculos.filter(v => v.placa.includes(p)).slice(0, 3).map(v => ({ k: "v" + v.id, t: v.placa + " · " + v.marca + " " + v.modelo, s: "veículo", r: "/veiculo/" + v.id })) : [];
    return [...os, ...ve, ...cl].slice(0, 8);
  }, [q, dados.ordens, dados.clientes, dados.veiculos]);
  return html`<div class="busca-rapida"><input id="busca-rapida" class="inp" type="search" autocomplete="off" placeholder="Buscar placa, nº da O.S., cliente ou telefone" aria-label="Busca rápida" value=${q} onInput=${e => setQ(e.target.value)}
      onKeyDown=${e => { if (e.key === "Enter" && res[0]) ir(res[0].r); }} />
    ${res.length ? html`<div class="lista busca-res">${res.map(x => html`<button type="button" key=${x.k} class="linha" onClick=${() => ir(x.r)}><span class="meio"><strong>${x.t}</strong></span><span class="sub">${x.s}</span></button>`)}</div>` : null}</div>`;
}

export function Painel() {
  const { dados, perfil, ir } = useApp();
  const ver = pode(perfil, "verValores");
  const [foco, setFoco] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const abertas = dados.ordens.filter(o => ABERTOS.includes(o.status));
  // O.S. herdadas do sistema anterior paradas há mais de 60 dias ficam agrupadas para não poluir o quadro
  const antigas = abertas.filter(o => o.legado && diasDesde(o.criado_em) > 60);
  const ativas = abertas.filter(o => !antigas.includes(o));
  const minhas = perfil.papel === "mecanico" ? ativas.filter(o => o.mecanico_id === perfil.id || (o.mecanico_nome && norm(o.mecanico_nome) === norm(perfil.nome))) : null;
  const hoje = hojeISO();
  const alertas = [];
  ativas.forEach(o => {
    if (o.status === "aguardando" && o.validade_orcamento && o.validade_orcamento < hoje) alertas.push([o, "Orçamento vencido em " + fmtData(o.validade_orcamento) + " sem resposta", "warn"]);
    else if (o.status === "aguardando" && o.orcamento_enviado_em && diasDesde(o.orcamento_enviado_em) > 2) alertas.push([o, "Orçamento sem resposta há " + Math.floor(diasDesde(o.orcamento_enviado_em)) + " dias", "warn"]);
    if (o.status === "diagnostico" && diasDesde(o.criado_em) > 2) alertas.push([o, "Em diagnóstico há " + Math.floor(diasDesde(o.criado_em)) + " dias sem orçamento", "warn"]);
    if (o.status === "pronto" && diasDesde(o.atualizado_em) > 2) alertas.push([o, "Pronto há " + Math.floor(diasDesde(o.atualizado_em)) + " dias e não retirado", "bad"]);
    if (["diagnostico", "aguardando", "execucao"].includes(o.status) && o.previsao_entrega && o.previsao_entrega < hoje) alertas.push([o, "Previsão de entrega (" + fmtData(o.previsao_entrega) + ") vencida", "bad"]);
  });
  alertas.sort((a, b) => (a[2] === "bad" ? 0 : 1) - (b[2] === "bad" ? 0 : 1));
  const baixo = dados.produtos.filter(estoqueBaixo);
  const rasc = lsGet(LS_NOVA), temRasc = rasc && (rasc.placa || rasc.clienteId || rasc.reclamacao);
  const hora = new Date().getHours(), saud = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const colunas = ["diagnostico", "aguardando", "execucao", "pronto"].filter(s => !foco || s === foco);
  const valorDe = s => ativas.filter(o => o.status === s).reduce((t, o) => t + Number(o.total || 0), 0);
  const deHoje = iso => iso && new Date(iso).toDateString() === new Date().toDateString();
  const entradasHoje = dados.ordens.filter(o => deHoje(o.criado_em) && o.status !== "cancelado").length;
  const saidasHoje = dados.ordens.filter(o => o.status === "entregue" && o.entregue_em && new Date(o.entregue_em).toDateString() === new Date().toDateString());
  const nAlerta = alertas.length + (baixo.length ? 1 : 0) + (antigas.length ? 1 : 0);

  return html`<div class="pagina larga">
    <div class="painel-topo"><div><h1>${saud}, ${perfil.nome.split(" ")[0]}</h1><span class="sub">${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</span></div>
      ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri" onClick=${() => ir("/entrada")}>${temRasc ? "Continuar O.S. em andamento" : "+ Nova O.S."}</button>` : null}</div>
    <${BuscaRapida} />
    <div class="hoje" role="group" aria-label="Resumo de hoje">
      <div><span>Entradas hoje</span><b>${entradasHoje}</b></div>
      <div><span>Entregas hoje</span><b>${saidasHoje.length}</b>${ver && saidasHoje.length ? html`<small>${reaisCurto(saidasHoje.reduce((s, o) => s + Number(o.total || 0), 0))}</small>` : null}</div>
      <div><span>No pátio</span><b>${ativas.length}</b>${ver ? html`<small>${reaisCurto(ativas.reduce((s, o) => s + Number(o.total || 0), 0))}</small>` : null}</div>
      <div class=${nAlerta ? "t-alerta" : ""}><span>Alertas</span><b>${nAlerta}</b></div>
    </div>
    <div class="patio" role="group" aria-label="Situação do pátio">
      ${["diagnostico", "aguardando", "execucao", "pronto"].map(s => { const n = ativas.filter(o => o.status === s).length; return html`<button type="button" key=${s} class=${"patio-item t-" + STATUS[s].cor + (foco === s ? " ativo" : "")} aria-pressed=${foco === s} onClick=${() => setFoco(foco === s ? "" : s)}>
        <b>${n}</b><span>${STATUS[s].t}</span>${ver && n ? html`<small>${reaisCurto(valorDe(s))}</small>` : null}</button>`; })}
    </div>
    ${nAlerta ? html`<section class="card alerta"><div class="secao-topo"><h3>Precisa de atenção (${nAlerta})</h3>${alertas.length > 5 ? html`<button type="button" class="btn-link" onClick=${() => setVerTodos(!verTodos)}>${verTodos ? "Mostrar menos" : "Ver todos"}</button>` : null}</div>
      <div class="lista">${(verTodos ? alertas : alertas.slice(0, 5)).map(([o, t, c], n) => html`<button type="button" key=${n} class="linha" onClick=${() => ir("/os/" + o.id)}><span class=${"dot s-" + c}></span><span class="meio"><strong>${t}</strong><span>${numOS(o.numero)} · ${exPlacaCurta(o)} · ${o.cliente.nome}</span></span></button>`)}
        ${baixo.length ? html`<button type="button" class="linha" onClick=${() => ir("/cadastros?aba=produtos")}><span class="dot s-warn"></span><span class="meio"><strong>${baixo.length} produto(s) com estoque no mínimo</strong><span>${baixo.slice(0, 3).map(p => p.descricao).join(" · ")}${baixo.length > 3 ? "…" : ""}</span></span></button>` : null}
        ${antigas.length ? html`<button type="button" class="linha" onClick=${() => ir("/ordens?filtro=herdadas")}><span class="dot s-info"></span><span class="meio"><strong>${antigas.length} O.S. antigas do sistema anterior ainda abertas</strong><span>Revise e encerre: entregue, recuse ou cancele cada uma.</span></span></button>` : null}</div></section>` : null}
    ${minhas ? html`<section class="card"><h3>Minhas O.S. em andamento</h3>${minhas.length ? html`<div class="lista">${minhas.map(o => html`<${LinhaOS} key=${o.id} o=${o} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma O.S. atribuída a você.</span>`}</section>` : null}
    <div class=${"colunas" + (foco ? " uma" : "")}>${colunas.map(s => { const l = ativas.filter(o => o.status === s).sort((a, b) => a.criado_em < b.criado_em ? -1 : 1);
      return html`<section class="card coluna" key=${s}><div class="secao-topo"><h3>${STATUS[s].t}</h3><span class=${"pill p-" + STATUS[s].cor}>${l.length}</span></div>
        ${l.length ? html`<div class="lista">${(foco ? l : l.slice(0, 6)).map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>
          ${!foco && l.length > 6 ? html`<button type="button" class="btn btn-sm" onClick=${() => setFoco(s)}>Ver todas (${l.length})</button>` : null}` : html`<span class="dica">Nenhuma.</span>`}</section>`; })}</div>
    ${ver ? html`<${Resultados} />` : null}
    ${ver ? html`<${Relacionamento} />` : null}
  </div>`;
}
const exPlacaCurta = o => (o.veiculo && o.veiculo.placa) || "sem placa";

export function Ordens({ params = {} }) {
  const { dados, perfil, ir } = useApp();
  const ver = pode(perfil, "verValores");
  const [q, setQ] = useState(""), [filtro, setFiltro] = useState(params.filtro || "abertas"), [lim, setLim] = useState(60);
  const lista = useMemo(() => { const n = norm(q), p = normPlaca(q), d = soDig(q);
    return dados.ordens.filter(o => (filtro === "todas" || (filtro === "abertas" ? ABERTOS.includes(o.status) : filtro === "herdadas" ? ABERTOS.includes(o.status) && o.legado : o.status === filtro))
      && (!n || norm(o.cliente.nome).includes(n) || (p.length >= 3 && (o.veiculo.placa || "").includes(p)) || norm(o.veiculo.modelo).includes(n) || (d && String(o.numero) === String(+d)) || norm(o.reclamacao).includes(n)));
  }, [q, filtro, dados.ordens]);
  useEffect(() => setLim(60), [q, filtro]);
  const soma = lista.reduce((s, o) => s + Number(o.total || 0), 0);
  return html`<div class="pagina">
    <div class="campo"><label for="busca-os">Buscar por placa, cliente, modelo, número ou reclamação</label><input id="busca-os" class="inp" value=${q} onInput=${e => setQ(e.target.value)} /></div>
    <div class="chips rolagem">${[["abertas", "Abertas"], ["todas", "Todas"], ...Object.entries(STATUS).map(([k, v]) => [k, v.curto]), ["herdadas", "Herdadas abertas"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (filtro === k ? " ativo" : "")} onClick=${() => setFiltro(k)}>${t}</button>`)}</div>
    <section class="card"><div class="secao-topo"><h2>Ordens de serviço</h2><span class="sub">${lista.length}${ver && soma ? " · " + reais(soma) : ""}</span></div>
      ${lista.length ? html`<div class="lista">${lista.slice(0, lim).map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>
        ${lista.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 100)}>Mostrar mais (${lista.length - lim} restantes)</button>` : null}`
        : html`<${Vazio}>${dados.ordens.length ? "Nenhuma O.S. com esse filtro." : "Nenhuma O.S. ainda."}</${Vazio}>`}
    </section></div>`;
}
