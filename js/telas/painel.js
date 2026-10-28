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

/* =================== janelas do painel =================== */
// tam: colunas de 12 no computador (3 = ¼, 4 = ⅓, 6 = ½, 8 = ⅔, 12 = inteira)
export const JANELAS = {
  busca: { t: "Busca rápida", tam: 12 },
  hoje: { t: "Resumo do dia", tam: 12 },
  patio: { t: "Pátio", tam: 12 },
  alertas: { t: "Precisa de atenção", tam: 8 },
  estoque: { t: "Estoque baixo", tam: 4 },
  quadro: { t: "Quadro de O.S.", tam: 12 },
  minhas: { t: "Minhas O.S.", tam: 12 },
  indicadores: { t: "Indicadores do período", tam: 12, valores: true, res: true },
  grafico: { t: "Faturamento no período", tam: 8, valores: true, res: true },
  composicao: { t: "Composição da receita", tam: 4, valores: true, res: true },
  servicos: { t: "Serviços que mais faturaram", tam: 4, valores: true, res: true },
  pecas: { t: "Peças que mais venderam", tam: 4, valores: true, res: true },
  formas: { t: "Formas de pagamento", tam: 4, valores: true, res: true },
  balcao: { t: "Vendas de balcão de hoje", tam: 4, valores: true },
  recibos: { t: "Últimos recibos", tam: 4, valores: true },
  manutencao: { t: "Manutenção programada vencendo", tam: 6, valores: true },
  recuperar: { t: "Clientes para recuperar", tam: 3, valores: true },
  aniversarios: { t: "Aniversariantes do mês", tam: 3, valores: true },
  contas: { t: "Contas a pagar", tam: 12, valores: true, fin: true },
};
export const LAYOUT_PADRAO = [["busca", 12], ["hoje", 12], ["patio", 12], ["contas", 12], ["alertas", 8], ["estoque", 4], ["quadro", 12], ["indicadores", 12], ["grafico", 8], ["composicao", 4],
  ["servicos", 4], ["pecas", 4], ["formas", 4], ["manutencao", 6], ["recuperar", 3], ["aniversarios", 3]].map(([k, tam]) => ({ k, tam }));
const TAMANHOS = [[3, "¼"], [4, "⅓"], [6, "½"], [8, "⅔"], [12, "Inteira"]];

function ContasJanela({ l }) {
  const { ir } = useApp();
  if (!l) return html`<span class="dica">Carregando…</span>`;
  const hoje = hojeISO(), sete = somaDiasISO(hoje, 7), soma = x => x.reduce((s, c) => s + Number(c.valor), 0);
  const venc = l.filter(c => c.vencimento < hoje), hj = l.filter(c => c.vencimento === hoje), sem = l.filter(c => c.vencimento > hoje && c.vencimento <= sete);
  return html`<div class="contas-janela"><div class="contas-mini">
      <div class=${venc.length ? "c-bad" : ""}><span>Vencidas</span><b>${reais(soma(venc))}</b><small>${venc.length}</small></div>
      <div class=${hj.length ? "c-warn" : ""}><span>Hoje</span><b>${reais(soma(hj))}</b><small>${hj.length}</small></div>
      <div><span>Próximos 7 dias</span><b>${reais(soma(sem))}</b><small>${sem.length}</small></div></div>
    ${l.length ? html`<ul class="ranking">${l.slice(0, 5).map(c => html`<li key=${c.id}><span>${c.descricao}</span><b class=${c.vencimento < hoje ? "c-bad" : ""}>${reais(c.valor)}</b><small>${fmtData(c.vencimento).slice(0, 5)}</small></li>`)}</ul>` : html`<span class="dica">Nenhuma conta em aberto.</span>`}
    <div class="acoes"><button type="button" class="btn btn-sm" onClick=${() => ir("/financeiro")}>Contas a pagar</button><button type="button" class="btn btn-sm" onClick=${() => ir("/financeiro?nova=pdf")}>Lançar boleto</button></div>
    <span class="dica">Total em aberto: ${reais(soma(l))}</span></div>`;
}

const Ranking = ({ itens, vazio, total }) => itens && itens.length ? html`<ol class="ranking">${itens.map((t, i) => html`<li key=${i}><span>${t.nome}</span><b>${reais(t.v)}</b><small>${total ? pct(t.v, total) + "%" : t.n + "×"}</small></li>`)}</ol>` : html`<span class="dica">${vazio}</span>`;

function Indicadores({ r, ra, iv, per }) {
  const n = x => Number(x) || 0, fat = n(r.faturamento), margem = fat - n(r.custo), ticket = r.saidas ? n(r.faturamento_os ?? fat) / r.saidas : 0, ant = ra || {};
  const comp = r.composicao || {}, cobertura = n(comp.peca) ? n(comp.peca_com_custo) / n(comp.peca) : 1, duvidosa = cobertura < 0.8, taxa = r.decididos ? r.aprovados / r.decididos : null;
  const k = (rot, valor, extra, cls) => html`<div class=${"kpi" + (cls ? " " + cls : "")}><span>${rot}</span><b class="kpi-din">${valor}</b>${extra ? html`<small>${extra}</small>` : null}</div>`;
  return html`<div class="kpis">
    ${k("Faturamento", reais(fat), html`<${Delta} atual=${fat} anterior=${n(ant.faturamento)} /> ${iv.titulo}`, "kpi-forte")}
    ${k("Recebido em recibos", reais(r.recebido), n(r.recebido) && fat ? Math.round(n(r.recebido) / fat * 100) + "% do faturado" : "sem recibos no período")}
    ${k("Margem bruta", reais(margem), duvidosa ? "Custo lançado em " + Math.round(cobertura * 100) + "% das peças: valor superestimado" : (fat ? Math.round(margem / fat * 100) : 0) + "% do faturamento", duvidosa ? "alerta-kpi" : "")}
    ${k("Ticket médio das O.S.", reais(ticket), html`${r.saidas} saídas <${Delta} atual=${r.saidas} anterior=${n(ant.saidas)} />`)}
    ${r.balcao !== undefined ? k("Vendas de balcão", reais(r.balcao), r.balcao_n + " venda(s)") : null}
    ${k("Aprovação de orçamentos", taxa === null ? "—" : Math.round(taxa * 100) + "%", r.decididos + " decididos")}
    ${k("Prazo médio", r.prazo_medio ? n(r.prazo_medio).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " dias" : "—", "da entrada à entrega")}
    ${k("Entradas de O.S.", r.entradas, html`<${Delta} atual=${r.entradas} anterior=${n(ant.entradas)} />`)}
  </div>${per !== "hoje" ? null : null}`;
}

function Composicao({ r }) {
  const comp = r.composicao || {}, n = x => Number(x) || 0, tot = n(comp.servico) + n(comp.peca) + n(comp.terceiro);
  if (!tot) return html`<span class="dica">Sem itens no período.</span>`;
  return html`<div class="pilha" role="img" aria-label="Composição da receita"><i class="s1" style=${{ width: pct(comp.servico, tot) + "%" }}></i><i class="s2" style=${{ width: pct(comp.peca, tot) + "%" }}></i><i class="s3" style=${{ width: pct(comp.terceiro, tot) + "%" }}></i></div>
    <ul class="legenda"><li><span class="q s1"></span>Mão de obra<b>${reais(comp.servico)} · ${pct(comp.servico, tot)}%</b></li><li><span class="q s2"></span>Peças<b>${reais(comp.peca)} · ${pct(comp.peca, tot)}%</b></li>
      ${n(comp.terceiro) ? html`<li><span class="q s3"></span>Outros<b>${reais(comp.terceiro)} · ${pct(comp.terceiro, tot)}%</b></li>` : null}</ul>
    ${n(comp.custo_peca) ? html`<span class="dica">Margem nas peças com custo lançado: ${pct(n(comp.peca_com_custo) - n(comp.custo_peca), n(comp.peca_com_custo))}%</span>` : null}`;
}

function VendasHoje() {
  const { ir } = useApp(); const [l, setL] = useState(null);
  useEffect(() => { const ini = new Date(); ini.setHours(0, 0, 0, 0); api.vendas.listar({ de: ini.toISOString() }).then(setL).catch(() => setL([])); }, []);
  if (!l) return html`<span class="dica">Carregando…</span>`;
  const ok = l.filter(v => v.status === "concluida");
  return html`<div class="numero-grande"><b>${reais(ok.reduce((s, v) => s + Number(v.total), 0))}</b><span>${ok.length} venda(s) hoje</span></div>
    <div class="acoes"><button type="button" class="btn btn-sm btn-pri" onClick=${() => ir("/balcao")}>Nova venda</button><button type="button" class="btn btn-sm" onClick=${() => ir("/balcao?aba=historico")}>Ver vendas</button></div>`;
}
function UltimosRecibos() {
  const { ir } = useApp(); const [l, setL] = useState(null);
  useEffect(() => { const d = new Date(Date.now() - 30 * DIA); api.recibos.listar({ de: chaveDia(d) }).then(x => setL(x.slice(0, 6))).catch(() => setL([])); }, []);
  if (!l) return html`<span class="dica">Carregando…</span>`;
  return l.length ? html`<ul class="ranking">${l.map(r => html`<li key=${r.id}><span><button type="button" class="btn-link" onClick=${() => ir("/imprimir/recibo/" + r.id)}>${String(r.numero).padStart(5, "0")}</button> ${r.pagador}</span><b class=${r.cancelado ? "riscado" : ""}>${reais(r.valor)}</b></li>`)}</ul>`
    : html`<span class="dica">Nenhum recibo nos últimos 30 dias.</span>`;
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
    const pr = n.length >= 3 ? dados.produtos.filter(x => x.ativo !== false && (norm(x.descricao).includes(n) || norm(x.referencia) === n)).slice(0, 3).map(x => ({ k: "p" + x.id, t: x.descricao, s: x.tipo === "produto" ? "estoque " + Number(x.estoque_atual).toLocaleString("pt-BR") : "serviço", r: "/cadastros?aba=produtos" })) : [];
    return [...os, ...ve, ...cl, ...pr].slice(0, 9);
  }, [q, dados.ordens, dados.clientes, dados.veiculos, dados.produtos]);
  return html`<div class="busca-rapida"><input id="busca-rapida" class="inp" type="search" autocomplete="off" placeholder="Buscar placa, nº da O.S., cliente, telefone ou produto" aria-label="Busca rápida" value=${q} onInput=${e => setQ(e.target.value)}
      onKeyDown=${e => { if (e.key === "Enter" && res[0]) ir(res[0].r); }} />
    ${res.length ? html`<div class="lista busca-res">${res.map(x => html`<button type="button" key=${x.k} class="linha" onClick=${() => ir(x.r)}><span class="meio"><strong>${x.t}</strong></span><span class="sub">${x.s}</span></button>`)}</div>` : null}</div>`;
}

export function Painel() {
  const { dados, perfil, cfg, ir, avisar, confirmar, recarregar } = useApp();
  const ver = pode(perfil, "verValores"), admin = pode(perfil, "ajustes");
  const [foco, setFoco] = useState("");
  const [verTodos, setVerTodos] = useState(false);
  const [editar, setEditar] = useState(false), [rascunho, setRascunho] = useState(null), [arrastando, setArrastando] = useState(null), [salvando, setSalvando] = useState(false);
  const [per, setPer] = useState(() => lsGet("dtcar-periodo") || "mes");
  const [r, setR] = useState(null), [ra, setRa] = useState(null), [erroRes, setErroRes] = useState("");
  const iv = useMemo(() => intervalo(per), [per]);

  // layout: definido pelo administrador (Ajustes), igual para toda a equipe; mecânico não vê janelas de valores
  const fin = pode(perfil, "financeiro");
  let salvo = Array.isArray(cfg.painel) && cfg.painel.length ? cfg.painel.filter(j => JANELAS[j.k]) : LAYOUT_PADRAO;
  // janela nova da versão 5: entra uma vez no layout já salvo, logo depois do pátio
  if (!cfg.painelV5 && !salvo.some(j => j.k === "contas")) { const i = salvo.findIndex(j => j.k === "patio"); salvo = [...salvo.slice(0, i + 1), { k: "contas", tam: 12 }, ...salvo.slice(i + 1)]; }
  const layout = editar ? rascunho : salvo;
  let visiveis = layout.filter(j => (ver || !JANELAS[j.k].valores) && (fin || !JANELAS[j.k].fin));
  const [contasAb, setContasAb] = useState(null), [sefazNovas, setSefazNovas] = useState(0);
  useEffect(() => { if (pode(perfil, "cadastrar") && api.sefaz) api.sefaz.novas().then(setSefazNovas).catch(() => {}); }, []);
  const [sefazCfg, setSefazCfg] = useState(null);
  useEffect(() => { if (pode(perfil, "ajustes") && api.sefaz) api.sefaz.config().then(setSefazCfg).catch(() => {}); }, []);
  useEffect(() => { if (fin) api.contas.abertas().then(setContasAb).catch(() => setContasAb([])); }, [fin]);
  if (perfil.papel === "mecanico" && !visiveis.some(j => j.k === "minhas")) visiveis = [{ k: "minhas", tam: 12 }, ...visiveis];
  const precisaRes = ver && visiveis.some(j => JANELAS[j.k].res);
  useEffect(() => { if (!precisaRes) return; let vivo = true; setR(null); setRa(null); setErroRes("");
    Promise.all([api.painel(iv.ini.toISOString(), iv.fim.toISOString(), iv.grupo), api.painel(iv.iniA.toISOString(), iv.fimA.toISOString(), iv.grupo)])
      .then(([a, b]) => { if (vivo) { setR(a); setRa(b); } }).catch(e => vivo && setErroRes(e.message));
    return () => { vivo = false; }; }, [per, precisaRes]);
  const escolherPer = p => { setPer(p); try { localStorage.setItem("dtcar-periodo", JSON.stringify(p)); } catch (e) {} };

  // ---- dados do quadro
  const abertas = dados.ordens.filter(o => ABERTOS.includes(o.status));
  const antigas = abertas.filter(o => o.legado && diasDesde(o.criado_em) > 60);
  const ativas = abertas.filter(o => !antigas.includes(o));
  const minhas = ativas.filter(o => o.mecanico_id === perfil.id || (o.mecanico_nome && norm(o.mecanico_nome) === norm(perfil.nome)));
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
  const extras = []; // alertas que não são de O.S.
  if (fin && contasAb) { const v = contasAb.filter(c => c.vencimento < hoje), h = contasAb.filter(c => c.vencimento === hoje);
    if (v.length) extras.push({ t: v.length + " conta(s) a pagar vencida(s): " + reais(v.reduce((s, c) => s + Number(c.valor), 0)), s: "Registre o pagamento ou renegocie.", cor: "bad", r: "/financeiro" });
    if (h.length) extras.push({ t: h.length + " conta(s) vencem hoje: " + reais(h.reduce((s, c) => s + Number(c.valor), 0)), s: "Contas a pagar", cor: "warn", r: "/financeiro" }); }
  if (sefazCfg && sefazCfg.validade && sefazCfg.ativo && (!sefazCfg.worker_em || Date.now() - new Date(sefazCfg.worker_em) > 3 * 3600000))
    extras.push({ t: "O robô da SEFAZ está parado", s: "As notas de compra não estão sendo buscadas. Veja os detalhes em Notas da SEFAZ.", cor: "bad", r: "/sefaz" });
  if (sefazNovas) extras.push({ t: sefazNovas + " nota(s) de compra nova(s) na SEFAZ", s: "Dê entrada no estoque, lance as duplicatas ou ignore.", cor: "info", r: "/sefaz" });
  if (admin) { const u = cfg.ultimoBackup, d = u ? Math.floor((Date.now() - new Date(u.em)) / DIA) : null;
    if (d === null || d > 7) extras.push({ t: d === null ? "Nenhum backup baixado ainda" : "Último backup há " + d + " dias", s: "Baixe uma cópia dos dados e guarde fora do computador.", cor: "warn", r: "/backup" }); }
  const baixo = dados.produtos.filter(estoqueBaixo);
  const deHoje = iso => iso && new Date(iso).toDateString() === new Date().toDateString();
  const entradasHoje = dados.ordens.filter(o => deHoje(o.criado_em) && o.status !== "cancelado").length;
  const saidasHoje = dados.ordens.filter(o => o.status === "entregue" && deHoje(o.entregue_em));
  const valorDe = s => ativas.filter(o => o.status === s).reduce((t, o) => t + Number(o.total || 0), 0);
  const nAlerta = alertas.length + (antigas.length ? 1 : 0) + extras.length;
  // relacionamento
  const ultima = useMemo(() => { const u = new Map(); for (const o of dados.ordens) { if (!o.cliente_id || o.status === "cancelado") continue; const t = o.entregue_em || o.criado_em; if (!u.has(o.cliente_id) || t > u.get(o.cliente_id)) u.set(o.cliente_id, t); } return u; }, [dados.ordens]);
  const clientesAbertos = new Set(abertas.map(o => o.cliente_id));
  const recuperar = dados.clientes.filter(c => { const t = ultima.get(c.id); if (!t || clientesAbertos.has(c.id)) return false; const d = diasDesde(t); return d >= 180 && d <= 730 && soDig(c.telefone).length >= 10; });
  const aniv = dados.clientes.filter(c => c.nascimento && Number(c.nascimento.slice(5, 7)) - 1 === new Date().getMonth()).sort((a, b) => a.nascimento.slice(8).localeCompare(b.nascimento.slice(8)));
  const lim = d => d >= somaDiasISO(hoje, -30) && d <= somaDiasISO(hoje, 30);
  const manut = dados.veiculos.map(v => { const p = [["revisão", v.revisao_data], ["troca de óleo", v.oleo_data], ["troca de filtros", v.filtro_data]].filter(([, d]) => d && lim(d)).sort((a, b) => a[1].localeCompare(b[1]))[0];
    return p ? { v, oque: p[0], data: p[1], c: dados.clientes.find(c => c.id === v.cliente_id) } : null; }).filter(x => x && x.c && soDig(x.c.telefone).length >= 10 && !clientesAbertos.has(x.c.id)).sort((a, b) => a.data.localeCompare(b.data));
  const lembrete = x => `Olá, ${x.c.nome.split(" ")[0]}! Aqui é da ${cfg.nome}.\n\nA ${x.oque} do seu ${[x.v.marca, x.v.modelo].filter(Boolean).join(" ")} (${exPlaca(x.v.placa)}) ${x.data < hoje ? "venceu em" : "vence em"} ${fmtData(x.data)}. Quer agendar? É só responder esta mensagem.`;

  const semRes = () => erroRes ? html`<div class="erros">Não foi possível calcular: ${erroRes}</div>` : html`<div class="esqueleto"></div>`;
  const conteudo = {
    busca: () => html`<${BuscaRapida} />`,
    hoje: () => html`<div class="hoje">
      <div><span>Entradas hoje</span><b>${entradasHoje}</b></div>
      <div><span>Entregas hoje</span><b>${saidasHoje.length}</b>${ver && saidasHoje.length ? html`<small>${reaisCurto(saidasHoje.reduce((s, o) => s + Number(o.total || 0), 0))}</small>` : null}</div>
      <div><span>No pátio</span><b>${ativas.length}</b>${ver ? html`<small>${reaisCurto(ativas.reduce((s, o) => s + Number(o.total || 0), 0))}</small>` : null}</div>
      <div class=${nAlerta ? "t-alerta" : ""}><span>Alertas</span><b>${nAlerta}</b></div></div>`,
    patio: () => html`<div class="patio" role="group" aria-label="Situação do pátio">
      ${["diagnostico", "aguardando", "execucao", "pronto"].map(s => { const n = ativas.filter(o => o.status === s).length; return html`<button type="button" key=${s} class=${"patio-item t-" + STATUS[s].cor + (foco === s ? " ativo" : "")} aria-pressed=${foco === s} onClick=${() => setFoco(foco === s ? "" : s)}>
        <b>${n}</b><span>${STATUS[s].t}</span>${ver && n ? html`<small>${reaisCurto(valorDe(s))}</small>` : null}</button>`; })}</div>`,
    alertas: () => nAlerta ? html`<div class="lista">${extras.map((x, n) => html`<button type="button" key=${"x" + n} class="linha" onClick=${() => ir(x.r)}><span class=${"dot s-" + x.cor}></span><span class="meio"><strong>${x.t}</strong><span>${x.s}</span></span></button>`)}${(verTodos ? alertas : alertas.slice(0, 6)).map(([o, t, c], n) => html`<button type="button" key=${n} class="linha" onClick=${() => ir("/os/" + o.id)}><span class=${"dot s-" + c}></span><span class="meio"><strong>${t}</strong><span>${numOS(o.numero)} · ${exPlacaCurta(o)} · ${o.cliente.nome}</span></span></button>`)}
        ${antigas.length ? html`<button type="button" class="linha" onClick=${() => ir("/ordens?filtro=herdadas")}><span class="dot s-info"></span><span class="meio"><strong>${antigas.length} O.S. antigas do sistema anterior ainda abertas</strong><span>Revise e encerre: entregue, recuse ou cancele cada uma.</span></span></button>` : null}</div>
        ${alertas.length > 6 ? html`<button type="button" class="btn-link" onClick=${() => setVerTodos(!verTodos)}>${verTodos ? "Mostrar menos" : "Ver todos (" + alertas.length + ")"}</button>` : null}` : html`<span class="dica">Tudo em dia.</span>`,
    estoque: () => baixo.length ? html`<ul class="ranking">${baixo.slice(0, 7).map(p => html`<li key=${p.id}><span>${p.descricao}</span><b class="c-bad">${Number(p.estoque_atual).toLocaleString("pt-BR")} ${p.unidade}</b><small>mín. ${Number(p.estoque_min).toLocaleString("pt-BR")}</small></li>`)}</ul>
        <button type="button" class="btn-link" onClick=${() => ir("/cadastros?aba=produtos")}>Ver produtos</button>` : html`<span class="dica">Nenhum produto abaixo do mínimo.</span>`,
    quadro: () => html`${foco ? html`<div class="filtro-ativo">Mostrando: ${STATUS[foco].t} <button type="button" class="btn-link" onClick=${() => setFoco("")}>mostrar todas</button></div>` : null}
      <div class=${"colunas" + (foco ? " uma" : "")}>${["diagnostico", "aguardando", "execucao", "pronto"].filter(s => !foco || s === foco).map(s => { const l = ativas.filter(o => o.status === s).sort((a, b) => a.criado_em < b.criado_em ? -1 : 1);
        return html`<section class="coluna" key=${s}><div class="secao-topo"><h4>${STATUS[s].t}</h4><span class=${"pill p-" + STATUS[s].cor}>${l.length}</span></div>
          ${l.length ? html`<div class="lista">${(foco ? l : l.slice(0, 6)).map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>
            ${!foco && l.length > 6 ? html`<button type="button" class="btn btn-sm" onClick=${() => setFoco(s)}>Ver todas (${l.length})</button>` : null}` : html`<span class="dica">Nenhuma.</span>`}</section>`; })}</div>`,
    minhas: () => minhas.length ? html`<div class="lista">${minhas.map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma O.S. atribuída a você.</span>`,
    indicadores: () => r ? html`<${Indicadores} r=${r} ra=${ra} iv=${iv} per=${per} />` : semRes(),
    grafico: () => !r ? semRes() : r.serie && r.serie.length && per !== "hoje" ? html`<${Barras} dados=${serie(r.serie, iv.ini, iv.fim, iv.grupo)} titulo=${"Faturamento por " + (iv.grupo === "mes" ? "mês" : "dia")} />` : html`<span class="dica">${per === "hoje" ? "Escolha um período maior para ver o gráfico." : "Nenhuma saída neste período."}</span>`,
    composicao: () => r ? html`<${Composicao} r=${r} />` : semRes(),
    servicos: () => r ? html`<${Ranking} itens=${r.top_servicos} vazio="Sem serviços no período." />` : semRes(),
    pecas: () => r ? html`<${Ranking} itens=${r.top_pecas} vazio="Sem peças no período." />` : semRes(),
    formas: () => r ? html`<${Ranking} itens=${(r.formas || []).map(f => ({ nome: f.forma, v: f.v }))} total=${Number(r.faturamento)} vazio="Sem pagamentos no período." />${(r.formas || []).length ? html`<span class="dica">Desconte as taxas de cartão: o que entra no caixa é menor que o faturado.</span>` : null}` : semRes(),
    balcao: () => html`<${VendasHoje} />`,
    recibos: () => html`<${UltimosRecibos} />`,
    manutencao: () => manut.length ? html`<ul class="ranking">${manut.slice(0, 7).map(x => html`<li key=${x.v.id}><span>${exPlaca(x.v.placa)} · ${x.c.nome.split(" ")[0]} · ${x.oque}</span><b class=${x.data < hoje ? "c-bad" : ""}>${fmtData(x.data)}</b>
      <a class="btn btn-sm btn-whats" aria-label=${"WhatsApp para " + x.c.nome} href=${linkWhats(x.c.telefone, lembrete(x))} target="_blank" rel="noopener">${I.whats}</a></li>`)}</ul>` : html`<span class="dica">Nenhuma revisão, troca de óleo ou filtro vencendo em 30 dias.</span>`,
    recuperar: () => html`<div class="numero-grande"><b>${recuperar.length}</b><span>sem visita entre 6 meses e 2 anos</span></div>${recuperar.length ? html`<button type="button" class="btn btn-sm" onClick=${() => ir("/cadastros?filtro=recuperar")}>Chamar no WhatsApp</button>` : null}`,
    contas: () => html`<${ContasJanela} l=${contasAb} />`,
    aniversarios: () => aniv.length ? html`<ul class="ranking">${aniv.slice(0, 7).map(c => html`<li key=${c.id}><span>${c.nome}</span><b>${c.nascimento.slice(8, 10)}/${c.nascimento.slice(5, 7)}</b></li>`)}</ul>` : html`<span class="dica">Nenhum neste mês.</span>`,
  };

  // ---- edição do layout (somente administrador)
  const iniciarEdicao = () => { setRascunho(salvo.map(j => ({ ...j }))); setEditar(true); };
  const mover = (i, d) => setRascunho(l => { const n = [...l], j = i + d; if (j < 0 || j >= n.length) return l; [n[i], n[j]] = [n[j], n[i]]; return n; });
  const soltar = (alvo) => { if (arrastando === null || arrastando === alvo) return; setRascunho(l => { const n = [...l]; const [x] = n.splice(arrastando, 1); n.splice(alvo, 0, x); return n; }); setArrastando(null); };
  const salvarLayout = async () => { setSalvando(true);
    try { await api.salvarConfig({ ...cfg, painel: rascunho, painelV5: true }); await recarregar(["config"]); setEditar(false); avisar("Painel salvo para toda a equipe."); } catch (e) { avisar(e.message, true); } finally { setSalvando(false); } };
  const restaurar = async () => { if (await confirmar({ titulo: "Restaurar painel padrão", texto: "As janelas voltam para a organização original.", botao: "Restaurar" })) setRascunho(LAYOUT_PADRAO.map(j => ({ ...j }))); };
  const ocultas = Object.keys(JANELAS).filter(k => !(rascunho || []).some(j => j.k === k));

  const hora = new Date().getHours(), saud = hora < 12 ? "Bom dia" : hora < 18 ? "Boa tarde" : "Boa noite";
  const rasc = lsGet(LS_NOVA), temRasc = rasc && (rasc.placa || rasc.clienteId || rasc.reclamacao);
  return html`<div class="pagina larga painel">
    <div class="painel-topo">
      <div><h1>${saud}, ${perfil.nome.split(" ")[0]}</h1><span class="sub">${new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</span></div>
      <div class="acoes">
        ${precisaRes ? html`<div class="periodo" role="group" aria-label="Período dos indicadores">${PERIODOS.map(([p, t]) => html`<button type="button" key=${p} aria-pressed=${per === p} onClick=${() => escolherPer(p)}>${t}</button>`)}</div>` : null}
        ${admin && !editar ? html`<button type="button" class="btn btn-sm" onClick=${iniciarEdicao}>${I.editar} Personalizar</button>` : null}
        ${pode(perfil, "verValores") ? html`<button type="button" class="btn" onClick=${() => ir("/balcao")}>Venda de balcão</button>` : null}
        ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri" onClick=${() => ir("/entrada")}>${temRasc ? "Continuar O.S." : "+ Nova O.S."}</button>` : null}
      </div></div>
    ${editar ? html`<div class="barra-edicao" role="region" aria-label="Personalizar painel">
      <div><b>Personalizando o painel</b><span class="sub">Arraste as janelas, mude o tamanho, remova ou adicione. O layout vale para toda a equipe.</span></div>
      <div class="acoes"><button type="button" class="btn btn-sm" onClick=${restaurar}>Restaurar padrão</button><button type="button" class="btn btn-sm" onClick=${() => setEditar(false)}>Cancelar</button>
        <button type="button" class="btn btn-sm btn-pri" disabled=${salvando} onClick=${salvarLayout}>${salvando ? "Salvando…" : "Salvar painel"}</button></div>
      ${ocultas.length ? html`<div class="chips adicionar-janela"><span class="sub">Adicionar janela:</span>${ocultas.map(k => html`<button type="button" key=${k} class="chip-f" onClick=${() => setRascunho(l => [...l, { k, tam: JANELAS[k].tam }])}>+ ${JANELAS[k].t}</button>`)}</div>` : null}
    </div>` : null}
    <div class=${"grade-painel" + (editar ? " editando" : "")}>
      ${visiveis.map((j, i) => { const def = JANELAS[j.k], idx = layout.indexOf(j); const semTitulo = ["busca", "hoje", "patio"].includes(j.k) && !editar;
        return html`<section key=${j.k} class=${"janela t" + j.tam + " j-" + j.k + (semTitulo ? " sem-moldura" : "") + (arrastando === idx ? " arrastando" : "")} style=${{ "--tam": j.tam }}
          draggable=${editar ? "true" : "false"} onDragStart=${e => { setArrastando(idx); e.dataTransfer.effectAllowed = "move"; }} onDragOver=${e => editar && e.preventDefault()} onDrop=${e => { e.preventDefault(); soltar(idx); }} onDragEnd=${() => setArrastando(null)}
          aria-label=${def.t}>
          ${editar ? html`<div class="janela-ctrl"><span class="pegador" aria-hidden="true">⠿</span><b>${def.t}</b>
            <select class="inp inp-curto" aria-label=${"Tamanho de " + def.t} value=${j.tam} onChange=${e => setRascunho(l => l.map(x => x.k === j.k ? { ...x, tam: +e.target.value } : x))}>${TAMANHOS.map(([v, t]) => html`<option value=${v}>${t}</option>`)}</select>
            <button type="button" class="btn btn-sm" aria-label="Mover para antes" onClick=${() => mover(idx, -1)}>↑</button><button type="button" class="btn btn-sm" aria-label="Mover para depois" onClick=${() => mover(idx, 1)}>↓</button>
            <button type="button" class="btn btn-sm btn-perigo" aria-label=${"Remover " + def.t} onClick=${() => setRascunho(l => l.filter(x => x.k !== j.k))}>Remover</button></div>`
          : !semTitulo ? html`<header class="janela-cab"><h3>${def.t}</h3>${def.res ? html`<span class="sub">${PERIODOS.find(p => p[0] === per)[1]}</span>` : j.k === "alertas" && nAlerta ? html`<span class="pill p-warn">${nAlerta}</span>` : null}</header>` : null}
          <div class="janela-corpo">${conteudo[j.k]()}</div></section>`; })}
    </div>
    ${ver ? html`<p class="dica rodape-painel">Faturamento não é lucro: a margem desconta só peças e terceiros. Impostos do Simples, salários, aluguel e taxas de cartão ainda saem dela.</p>` : null}
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
