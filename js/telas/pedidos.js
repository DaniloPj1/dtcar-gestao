// Pedidos de compra por fornecedor (cupons, pré-vendas, romaneios) para conferir na hora de pagar.
// Tabela pre_notas (supabase/v19.sql) + conferência (supabase/v31.sql). Sem foto: só fornecedor, documento,
// data, valor e O.S. O Claude registra pelo conector (registrar_pre_nota); aqui o Danilo filtra, confere e inclui à mão.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Modal, Dinheiro, Vazio } from "../ui.js";
import { reais, fmtData, hojeISO, norm, soDig, arred, numOS } from "../util.js";
import { BuscaFornecedor } from "./financeiro.js";

const LS = "dtcar-pedidos-filtros";
const primeiroDoMes = () => hojeISO().slice(0, 8) + "01";
const SITS = [["aberta", "Em aberto"], ["conferida", "Conferidos"], ["", "Todos"]];
/** nome do fornecedor do pedido: o do cadastro, se houver; senão o que veio no cupom */
export const nomeDoPedido = (p, forns) => { const f = p.fornecedor_id && forns.find(x => x.id === p.fornecedor_id); return f ? (f.fantasia || f.razao) : (p.fornecedor_nome || "—"); };

/** Inclusão manual de um pedido (o Claude registra pelo conector; aqui é para quando o Danilo lança na mão) */
function NovoPedido({ onFechar, onSalvo }) {
  const { dados, perfil } = useApp();
  const [p, setP] = useState({ fornecedor_id: null, fornecedor_nome: "", documento: "", data: hojeISO(), total: 0, os: "", obs: "" });
  const [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const muda = o => { setP(x => ({ ...x, ...o })); setErro(""); };
  const salvar = async () => {
    if (!p.fornecedor_id && !p.fornecedor_nome) return setErro("Informe o fornecedor.");
    if (!p.documento.trim()) return setErro("Informe o nº do cupom, pedido ou pré-venda.");
    if (!p.data) return setErro("Informe a data do pedido.");
    if (!(p.total > 0)) return setErro("Informe o valor total (já com desconto).");
    let o = null;
    if (p.os) { o = dados.ordens.find(x => String(x.numero) === soDig(p.os)); if (!o) return setErro("O.S. " + p.os + " não encontrada."); }
    const f = p.fornecedor_id && dados.fornecedores.find(x => x.id === p.fornecedor_id);
    setSalvando(true);
    try {
      await api.preNotas.incluir({ data: p.data, fornecedor_id: p.fornecedor_id, fornecedor_nome: f ? (f.fantasia || f.razao) : p.fornecedor_nome, fornecedor_cnpj: f ? soDig(f.cnpj) : "",
        documento: p.documento.trim(), total: arred(p.total), ordem_id: o ? o.id : null, os_numero: o ? o.numero : null, placa: o ? ((o.veiculo || {}).placa || "") : "", obs: p.obs.trim(), criado_por: perfil.nome });
      onSalvo();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Novo pedido de compra" onFechar=${onFechar}>
    <div class="campo"><label for="pc-forn">Fornecedor <i>*</i></label><${BuscaFornecedor} id="pc-forn" valor=${p.fornecedor_id} texto=${p.fornecedor_nome}
      onEscolha=${f => muda({ fornecedor_id: f ? f.id : null, fornecedor_nome: "" })} onTexto=${t => muda({ fornecedor_nome: t, fornecedor_id: null })} /></div>
    <div class="grade">
      <${Campo} id="pc-doc" rotulo="Nº do cupom / pedido" obrig><${Texto} id="pc-doc" placeholder="ex.: PV 57941" valor=${p.documento} onMuda=${v => muda({ documento: v })} /></${Campo}>
      <${Campo} id="pc-data" rotulo="Data" obrig><input id="pc-data" type="date" class="inp" value=${p.data} onInput=${e => muda({ data: e.target.value })} /></${Campo}>
      <${Campo} id="pc-total" rotulo="Valor total (com desconto)" obrig><${Dinheiro} id="pc-total" valor=${p.total} onMuda=${v => muda({ total: v })} /></${Campo}>
      <${Campo} id="pc-os" rotulo="O.S. (se for para uma)"><${Texto} id="pc-os" inputmode="numeric" placeholder="ex.: 1854" valor=${p.os} onMuda=${v => muda({ os: v })} /></${Campo}>
    </div>
    <${Campo} id="pc-obs" rotulo="Observação"><${Texto} id="pc-obs" valor=${p.obs} onMuda=${v => muda({ obs: v })} /></${Campo}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${salvar}>Registrar pedido</button></div>
  </${Modal}>`;
}

export function PedidosCompra() {
  const { dados, perfil, avisar, confirmar } = useApp();
  const [f, setF] = useState(() => { let s = null; try { s = JSON.parse(localStorage.getItem(LS) || "null"); } catch (e) {}
    return { de: primeiroDoMes(), ate: hojeISO(), forn: "", sit: "aberta", q: "", ...(s || {}) }; });
  const [lista, setLista] = useState(null), [erro, setErro] = useState(""), [sel, setSel] = useState([]), [novo, setNovo] = useState(false);
  const muda = o => setF(x => { const n = { ...x, ...o }; try { localStorage.setItem(LS, JSON.stringify(n)); } catch (e) {} return n; });
  const carregar = () => { setLista(null); setSel([]); api.preNotas.listar({ de: f.de, ate: f.ate }).then(setLista).catch(e => { setErro(/pre_notas|does not exist|schema cache|404/i.test(e.message) ? "A tabela de pedidos ainda não existe: rode o supabase/v19.sql e o v31.sql no Supabase." : e.message); setLista([]); }); };
  useEffect(carregar, [f.de, f.ate]);
  const nome = p => nomeDoPedido(p, dados.fornecedores);
  const fornecedores = useMemo(() => [...new Set((lista || []).map(nome))].sort((a, b) => a.localeCompare(b)), [lista, dados.fornecedores]);
  const filtrados = (lista || []).filter(p => (!f.forn || nome(p) === f.forn) && (!f.sit || (f.sit === "aberta" ? p.situacao === "aberta" : p.situacao !== "aberta"))
    && (!f.q || [p.documento, p.placa, p.os_numero, p.obs].some(x => norm(x).includes(norm(f.q))) || String(p.total).includes(f.q.replace(/\./g, "").replace(",", "."))));
  const grupos = useMemo(() => { const g = new Map(); for (const p of filtrados) { const k = nome(p); if (!g.has(k)) g.set(k, []); g.get(k).push(p); } return [...g.entries()].sort((a, b) => a[0].localeCompare(b[0])); }, [filtrados]);
  const soma = l => arred(l.reduce((s, p) => s + Number(p.total), 0));
  const abertos = (lista || []).filter(p => p.situacao === "aberta");
  const selecionados = filtrados.filter(p => sel.includes(p.id));
  const marca = id => setSel(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  const marcaGrupo = l => { const ids = l.map(p => p.id), todos = ids.every(i => sel.includes(i)); setSel(s => todos ? s.filter(i => !ids.includes(i)) : [...new Set([...s, ...ids])]); };
  const atualizar = async (ids, patch, msg) => { try { await api.preNotas.atualizar(ids, patch); avisar(msg); carregar(); } catch (e) { avisar(e.message, true); } };
  const conferir = () => atualizar(selecionados.map(p => p.id), { situacao: "conferida", conferida_em: new Date().toISOString(), conferida_por: perfil.nome },
    selecionados.length + " pedido(s) conferido(s): " + reais(soma(selecionados)) + ".");
  const reabrir = () => atualizar(selecionados.map(p => p.id), { situacao: "aberta", conferida_em: null, conferida_por: "", conta_id: null }, "Pedido(s) de volta para em aberto.");
  const cancelar = async () => { if (!(await confirmar({ titulo: "Cancelar pedido(s)?", texto: "O(s) " + selecionados.length + " pedido(s) saem da lista (não são apagados: ficam como cancelados).", botao: "Cancelar pedido(s)", perigo: true }))) return;
    atualizar(selecionados.map(p => p.id), { situacao: "cancelada" }, "Pedido(s) cancelado(s)."); };
  const exportar = () => {
    const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"', n2 = v => Number(v || 0).toFixed(2).replace(".", ",");
    const linhas = [["Fornecedor", "Data", "Documento", "O.S.", "Placa", "Valor", "Situação", "Conferido em", "Observação"].map(esc).join(";")];
    for (const [k, l] of grupos) for (const p of l) linhas.push([k, fmtData(p.data), p.documento, p.os_numero || "", p.placa, n2(p.total), p.situacao === "aberta" ? "Em aberto" : "Conferido", p.conferida_em ? fmtData(p.conferida_em) : "", p.obs].map(esc).join(";"));
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = "pedidos-dtcar-" + f.de + "-a-" + f.ate + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  return html`<div class="pagina larga financeiro pedidos">
    <div class="painel-topo"><div><h1>Pedidos de compra</h1><span class="sub">Cupons e pré-vendas dos fornecedores, para conferir na hora de pagar</span></div>
      <div class="acoes"><button type="button" class="btn" onClick=${() => { location.hash = "#/financeiro"; }}>Contas a pagar</button><button type="button" class="btn btn-pri" onClick=${() => setNovo(true)}>+ Novo pedido</button></div></div>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="kpis fin-kpis">
      <div class="kpi"><span>Em aberto no período</span><b class="kpi-din">${reais(soma(abertos))}</b><small>${abertos.length} pedido(s)</small></div>
      <div class="kpi kpi-forte"><span>Total filtrado</span><b class="kpi-din">${reais(soma(filtrados))}</b><small>${filtrados.length} pedido(s)</small></div>
    </div>
    <section class="card">
      <div class="fin-filtros">
        <div class="fin-periodo">
          <label class="filtro"><span>De</span><input type="date" class="inp" aria-label="Data inicial" value=${f.de} onInput=${e => e.target.value && muda({ de: e.target.value })} /></label>
          <label class="filtro"><span>Até</span><input type="date" class="inp" aria-label="Data final" value=${f.ate} onInput=${e => e.target.value && muda({ ate: e.target.value })} /></label>
          <label class="filtro"><span>Fornecedor</span><select class="inp" aria-label="Fornecedor" value=${f.forn} onChange=${e => muda({ forn: e.target.value })}><option value="">Todos</option>${fornecedores.map(x => html`<option value=${x}>${x}</option>`)}</select></label>
          <label class="filtro"><span>Buscar</span><input class="inp" type="search" aria-label="Buscar pedido" placeholder="Documento, O.S., placa ou valor" value=${f.q} onInput=${e => muda({ q: e.target.value })} /></label>
        </div>
        <div class="chips rolagem" role="group" aria-label="Situação">${SITS.map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (f.sit === k ? " ativo" : "")} onClick=${() => muda({ sit: k })}>${t}</button>`)}</div>
      </div>
      ${selecionados.length ? html`<div class="barra-sel" role="region" aria-label="Selecionados"><b>${selecionados.length} selecionado(s) · ${reais(soma(selecionados))}</b><span class="espaco"></span>
        ${selecionados.some(p => p.situacao === "aberta") ? html`<button type="button" class="btn btn-sm btn-pri" onClick=${conferir}>Marcar como conferidos</button>` : null}
        ${selecionados.some(p => p.situacao !== "aberta") ? html`<button type="button" class="btn btn-sm" onClick=${reabrir}>Voltar para em aberto</button>` : null}
        <button type="button" class="btn btn-sm" onClick=${cancelar}>Cancelar</button></div>` : null}
      ${!lista ? html`<${Vazio}>Carregando…</${Vazio}>` : !grupos.length ? html`<${Vazio}>Nenhum pedido no período com esses filtros.</${Vazio}>`
        : grupos.map(([k, l]) => html`<div class="pedidos-grupo" key=${k}>
          <div class="pedidos-forn"><label><input type="checkbox" aria-label=${"Selecionar todos de " + k} checked=${l.every(p => sel.includes(p.id))} onChange=${() => marcaGrupo(l)} /> <b>${k}</b></label>
            <span class="sub">${l.length} pedido(s)</span><b class="num">${reais(soma(l))}</b></div>
          ${l.map(p => html`<label key=${p.id} class=${"linha pedido-linha" + (p.situacao !== "aberta" ? " conferido" : "")}>
            <input type="checkbox" aria-label=${"Selecionar " + p.documento} checked=${sel.includes(p.id)} onChange=${() => marca(p.id)} />
            <span class="meio"><strong>${p.documento || "sem nº"}</strong><span>${[fmtData(p.data), p.os_numero ? numOS(p.os_numero) : "", p.placa, p.obs].filter(Boolean).join(" · ")}</span></span>
            <span class="dir"><b>${reais(p.total)}</b><span class=${"pill p-" + (p.situacao === "aberta" ? "warn" : "ok")}>${p.situacao === "aberta" ? "Em aberto" : "Conferido" + (p.conferida_em ? " em " + fmtData(p.conferida_em) : "")}</span></span></label>`)}
        </div>`)}
      ${filtrados.length ? html`<div class="acoes"><span class="espaco"></span><button type="button" class="btn btn-sm" onClick=${exportar}>Exportar planilha</button></div>` : null}
    </section>
    ${novo ? html`<${NovoPedido} onFechar=${() => setNovo(false)} onSalvo=${() => { setNovo(false); avisar("Pedido registrado."); carregar(); }} />` : null}
  </div>`;
}

/** No pagamento de uma conta: pedidos em aberto do mesmo fornecedor, para conferir e marcar junto com o pagamento */
export function PedidosNoPagamento({ conta, marcados, onMarca }) {
  const { dados } = useApp();
  const [l, setL] = useState(null);
  const nomeSemCadastro = conta.fornecedor_id ? "" : (conta.favorecido || "");
  useEffect(() => { if (!api.preNotas || (!conta.fornecedor_id && !nomeSemCadastro)) { setL([]); return; }
    api.preNotas.abertasDo(conta.fornecedor_id, nomeSemCadastro).then(x => { setL(x); onMarca(x.map(p => p.id)); }).catch(() => setL([])); }, [conta.id]);
  if (!l || !l.length) return null;
  const soma = arred(l.filter(p => marcados.includes(p.id)).reduce((s, p) => s + Number(p.total), 0));
  const dif = arred(Number(conta.valor) - soma);
  return html`<div class="pedidos-pagamento"><b>Pedidos em aberto de ${nomeDoPedido(l[0], dados.fornecedores)}</b>
    ${l.map(p => html`<label key=${p.id} class="pedido-pag"><input type="checkbox" checked=${marcados.includes(p.id)} onChange=${() => onMarca(marcados.includes(p.id) ? marcados.filter(x => x !== p.id) : [...marcados, p.id])} />
      <span>${fmtData(p.data)} · ${p.documento}${p.os_numero ? " · " + numOS(p.os_numero) : ""}</span><b>${reais(p.total)}</b></label>`)}
    <span class="dica">Marcados: ${reais(soma)}${marcados.length ? (Math.abs(dif) < 0.01 ? " — bate com o valor da conta." : " — diferença de " + reais(Math.abs(dif)) + (dif > 0 ? " a mais na conta." : " a menos na conta.")) : ""} Os marcados ficam como conferidos ao confirmar o pagamento.</span>
  </div>`;
}
