// Orçamentos (v52, pedido do Danilo em 10/11/2026): orçamento SEPARADO da O.S., com numeração própria (ORC-00001).
// Serve para quem pediu preço sem deixar o carro (telefone, WhatsApp, balcão). Não gasta número de O.S. e não mexe em
// estoque nem em financeiro. Só vira O.S. quando o cliente aprova (etapa 2). Carro que entra no pátio para diagnóstico
// continua nascendo como O.S. (Nova O.S.), como sempre.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, BuscaCliente } from "../ui.js";
import { lsGet, lsSet, norm, uuid, reais, fmtData, fmtTel, fmtDataHora, totais, numORC, hojeISO, somaDias, exPlaca, normPlaca, linkWhats } from "../util.js";
import { pode, SITUACOES_ORC, situacaoORC, TABELAS_PRECO } from "../regras.js";
import { pdfOS, entregarArquivo } from "../pdf.js";
import { ItemModal, ItemLinha } from "./ordem.js";
import { CampoDesconto } from "./acoesos.js";
import { LS_ORC_AGENDA } from "./agenda.js";

const FALTA_V53 = e => /orcamento_aprovar|schema cache|could not find|404/i.test((e && e.message) || "");
const FALTA_V52 = e => /orcamentos|orcamento_salvar|does not exist|schema cache|could not find|404/i.test((e && e.message) || "");
const AVISO_V52 = "Os orçamentos separados da O.S. precisam do arquivo supabase/v52.sql, que o administrador roda uma vez no Supabase.";
const primeiroNome = n => String(n || "").trim().split(/\s+/)[0] || "";
const nomeVeic = v => [v.marca, v.modelo].filter(Boolean).join(" ") || (v.placa ? "veículo " + exPlaca(v.placa) : "veículo");
const Pill = ({ o }) => { const s = SITUACOES_ORC[situacaoORC(o)] || { t: o.situacao, cor: "muted" }; return html`<span class=${"pill p-" + s.cor}>${s.t}</span>`; };

/** O orçamento no formato que o pdfOS entende (o mesmo PDF do orçamento da O.S., com o número ORC e o termo de orçamento) */
export const paraPDF = (o, itens) => ({ ...o, status: "diagnostico", situacao: "", itens, validade_orcamento: o.validade, obs_execucao: o.obs, km_entrada: null,
  mecanico_nome: "", forma_pagamento: "", garantia_dias: null, fotos: [] });
/** Texto do WhatsApp do orçamento separado: fala o número do orçamento, nunca número de O.S. */
export const msgOrcamento = (o, itens, cfg) => { const t = totais(itens, o.desconto), v = o.veiculo || {};
  return [`Olá, ${primeiroNome((o.cliente || {}).nome)}! Aqui é da ${cfg.nome}. Segue o orçamento ${numORC(o.numero)}${v.placa || v.modelo ? " do seu " + nomeVeic(v) : ""}.`, "",
    ...itens.filter(i => i.aprovado !== false).map(i => "• " + i.descricao + (i.fornecida_cliente ? " (peça do cliente)" : "")), "",
    `*Total: ${reais(t.total)}*`, ...(o.validade ? [`Válido até ${fmtData(o.validade)}.`] : []), "",
    "Para aprovar, responda *APROVADO*. Se preferir aprovar só parte dos itens, é só dizer quais."].join("\n"); };

/* ---------------- lista ---------------- */
const FILTROS = [["", "Todos"], ["elaboracao", "Em elaboração"], ["enviado", "Enviados"], ["aprovado", "Aprovados"], ["recusado", "Recusados"], ["vencido", "Vencidos"]];
export function Orcamentos() {
  const { perfil, ir } = useApp();
  const [lista, setLista] = useState(null), [erro, setErro] = useState(""), [falta, setFalta] = useState(false), [f, setF] = useState(""), [q, setQ] = useState("");
  const gestor = pode(perfil, "orcar");
  useEffect(() => { api.orcamentos.listar().then(setLista).catch(e => { if (FALTA_V52(e)) setFalta(true); else setErro(e.message); setLista([]); }); }, []);
  const hoje = hojeISO();
  const conta = useMemo(() => { const c = {}; for (const o of lista || []) { const s = situacaoORC(o, hoje); c[s] = (c[s] || { n: 0, v: 0 }); c[s].n++; c[s].v += Number(o.total) || 0; } return c; }, [lista]);
  const vis = useMemo(() => { const n = norm(q), p = normPlaca(q);
    return (lista || []).filter(o => (!f || situacaoORC(o, hoje) === f) && (!n || norm((o.cliente || {}).nome).includes(n) || String(o.numero) === q.trim().replace(/\D/g, "") || (p.length >= 3 && String((o.veiculo || {}).placa || "").includes(p)) || norm((o.veiculo || {}).modelo).includes(n) || norm(o.reclamacao).includes(n))); }, [lista, f, q]);
  return html`<div class="pagina larga orcamentos">
    <div class="painel-topo"><div><h1>Orçamentos</h1><span class="sub">Preço para o cliente sem abrir O.S. Só vira O.S. quando ele aprova.</span></div>
      <div class="acoes">${gestor && !falta ? html`<button type="button" class="btn btn-pri" onClick=${() => ir("/orcamento/novo")}>+ Novo orçamento</button>` : null}</div></div>
    ${falta ? html`<div class="aviso">${AVISO_V52}</div>` : null}${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="kpis orc-kpis">${["elaboracao", "enviado", "aprovado", "recusado", "vencido"].map(k => html`<button type="button" key=${k} class=${"kpi" + (f === k ? " kpi-forte" : "")} onClick=${() => setF(f === k ? "" : k)}>
      <span>${SITUACOES_ORC[k].t}</span><b class="kpi-din">${reais((conta[k] || {}).v || 0)}</b><small>${(conta[k] || {}).n || 0} orçamento(s)</small></button>`)}</div>
    <section class="card">
      <div class="linha-add"><input id="busca-orc" class="inp" type="search" aria-label="Buscar orçamento" placeholder="Cliente, número, placa, modelo ou pedido" value=${q} onInput=${e => setQ(e.target.value)} /></div>
      <div class="chips rolagem" role="group" aria-label="Situação">${FILTROS.map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (f === k ? " ativo" : "")} onClick=${() => setF(k)}>${t}</button>`)}</div>
      ${!lista ? html`<div class="esqueleto"></div>` : !vis.length ? html`<${Vazio}>${lista.length ? "Nenhum orçamento com esses filtros." : "Nenhum orçamento ainda. Use “+ Novo orçamento” quando o cliente pedir preço sem deixar o carro."}</${Vazio}>`
        : html`<div class="lista">${vis.map(o => { const v = o.veiculo || {};
          return html`<button type="button" key=${o.id} class="linha linha-orc" onClick=${() => ir("/orcamento/" + o.id)}>
            <span class="cod">${numORC(o.numero)}</span>
            <span class="meio"><strong>${(o.cliente || {}).nome || "Sem nome"}</strong><span>${[[exPlaca(v.placa), v.marca, v.modelo].filter(Boolean).join(" "), o.reclamacao, o.validade ? "válido até " + fmtData(o.validade) : "", o.os_numero ? "virou O.S. " + o.os_numero : "", o.situacao === "recusado" && o.motivo ? "motivo: " + o.motivo : ""].filter(Boolean).join(" · ")}</span></span>
            <span class="dir"><b>${reais(o.total)}</b><${Pill} o=${o} /></span></button>`; })}</div>`}
    </section></div>`;
}

/* ---------------- um orçamento ---------------- */
const NOVO = cfg => ({ situacao: "elaboracao", cliente_id: "", veiculo_id: "", cliente: { nome: "", telefone: "" }, veiculo: { placa: "", marca: "", modelo: "", ano: "" }, reclamacao: "", obs: "", obs_internas: "",
  tabela_preco: "vista", condicoes_pagamento: cfg.condicoesPadrao || "", desconto: 0, validade: somaDias(hojeISO(), Number(cfg.validadeDias) || 10), motivo: "" });

export function Orcamento({ id }) {
  const { dados, cfg, perfil, avisar, confirmar, ir, recarregar } = useApp();
  const novo = id === "novo";
  // agenda (v54): "Fazer orçamento" no agendamento abre o orçamento novo já com o cliente, o veículo e o serviço
  const [daAgenda] = useState(() => { if (!novo) return null; const x = lsGet(LS_ORC_AGENDA); lsSet(LS_ORC_AGENDA, null); return x && x.agendaId ? x : null; });
  const [o, setO] = useState(() => !novo ? null : daAgenda ? { ...NOVO(cfg), cliente_id: daAgenda.cliente_id || "", veiculo_id: daAgenda.veiculo_id || "",
    cliente: { nome: "", telefone: "", ...(daAgenda.cliente || {}) }, veiculo: { placa: "", marca: "", modelo: "", ano: "", ...(daAgenda.veiculo || {}) }, reclamacao: daAgenda.reclamacao || "" } : NOVO(cfg)), [itens, setItens] = useState([]), [erro, setErro] = useState(""), [sujo, setSujo] = useState(false), [salvando, setSalvando] = useState(false);
  const [modal, setModal] = useState(null), [recusa, setRecusa] = useState(null), [semCad, setSemCad] = useState(!!(daAgenda && !daAgenda.cliente_id)), [aprovar, setAprovar] = useState(false);
  // aprovar: antes de abrir o quadro, grava o que estiver pendente (a aprovação lê o orçamento do banco)
  const abrirAprovar = async () => { if (!itens.length) return setErro("Inclua pelo menos um item antes de aprovar."); const base = sujo ? await gravar() : o; if (base) setAprovar(true); };
  const gestor = pode(perfil, "orcar"), ver = pode(perfil, "verValores");
  const carregar = () => api.orcamentos.um(id).then(r => { if (!r) return setErro("Orçamento não encontrado."); setO(r); setItens(r.itens || []); setSujo(false); setSemCad(!r.cliente_id); })
    .catch(e => setErro(FALTA_V52(e) ? AVISO_V52 : e.message));
  useEffect(() => { if (!novo) carregar(); }, [id]);
  if (erro && !o) return html`<div class="pagina"><div class="erros">${erro}</div><button type="button" class="btn" onClick=${() => ir("/orcamentos")}>Voltar aos orçamentos</button></div>`;
  if (!o) return html`<div class="carregando">Carregando orçamento…</div>`;

  const sit = situacaoORC(o), trancado = o.situacao === "aprovado" || !gestor || o._local, edita = !trancado && o.situacao !== "recusado";
  const set = p => { setO(x => ({ ...x, ...p })); setSujo(true); setErro(""); };
  const t = totais(itens, o.desconto);
  const veiculosCli = o.cliente_id ? dados.veiculos.filter(v => v.cliente_id === o.cliente_id) : [];
  const escolherCliente = cid => { const c = dados.clientes.find(x => x.id === cid);
    if (!c) return set({ cliente_id: "", veiculo_id: "", cliente: { nome: "", telefone: "" } });
    const vs = dados.veiculos.filter(v => v.cliente_id === cid), v = vs.length === 1 ? vs[0] : null;
    set({ cliente_id: cid, cliente: { nome: c.nome, telefone: c.telefone || "" }, ...(v ? { veiculo_id: v.id, veiculo: { placa: v.placa || "", marca: v.marca || "", modelo: v.modelo || "", ano: v.ano || "" } } : { veiculo_id: "" }) }); };
  const escolherVeiculo = vid => { const v = dados.veiculos.find(x => x.id === vid);
    set(v ? { veiculo_id: vid, veiculo: { placa: v.placa || "", marca: v.marca || "", modelo: v.modelo || "", ano: v.ano || "" } } : { veiculo_id: "" }); };
  const salvarItem = it => { const { _novo, _conta, ...i } = it; setItens(l => _novo ? l.concat([i]) : l.map(x => x.id === i.id ? i : x)); setSujo(true); setModal(null); };
  const excluirItem = it => { setItens(l => l.filter(x => x.id !== it.id)); setSujo(true); setModal(null); };
  const incluir = tipo => setModal({ _novo: true, id: uuid(), tipo, descricao: "", codigo: "", fornecedor: "", qtd: 1, valor_unit: 0, custo_unit: 0, desconto: 0, horas: null, fornecida_cliente: false, qualidade: tipo === "peca" ? "original" : "", aprovado: null });

  const validar = () => !String(o.cliente.nome || "").trim() ? "Informe o cliente: escolha no cadastro ou digite o nome." : Number(o.desconto) > t.subtotal + 0.001 ? "O desconto não pode ser maior que o valor dos itens." : "";
  /** grava cabeçalho e itens numa transação (orcamento_salvar); mudanças = troca de situação junto */
  const gravar = async (mudancas = {}, aviso = "Orçamento salvo.") => {
    const e = validar(); if (e) { setErro(e); return null; }
    setSalvando(true);
    try {
      const r = await api.orcamentos.salvar({ ...(novo ? {} : { id: o.id }), cliente_id: o.cliente_id || "", veiculo_id: o.veiculo_id || "",
        cliente: { nome: String(o.cliente.nome).trim(), telefone: o.cliente.telefone || "" }, veiculo: { ...o.veiculo, placa: normPlaca(o.veiculo.placa) },
        reclamacao: o.reclamacao, obs: o.obs, obs_internas: o.obs_internas, tabela_preco: o.tabela_preco, condicoes_pagamento: o.condicoes_pagamento, desconto: Number(o.desconto) || 0,
        validade: o.validade || "", situacao: o.situacao, motivo: o.motivo || "", ...mudancas, itens: itens.map((i, n) => ({ ...i, posicao: n + 1 })) });
      avisar(aviso); setO(r); setItens(r.itens || []); setSujo(false); setErro("");
      if (novo && daAgenda) await api.agenda.salvar({ id: daAgenda.agendaId, orcamento_id: r.id, orc_numero: r.numero }).catch(() => avisar("O orçamento foi salvo, mas não ficou ligado ao agendamento.", true));
      if (novo) ir("/orcamento/" + r.id);
      return r;
    } catch (e2) { setErro(FALTA_V52(e2) ? AVISO_V52 : e2.message); return null; } finally { setSalvando(false); }
  };
  const pdf = async () => { const base = sujo || novo ? await gravar() : o; if (!base) return;
    try { const cli = base.cliente_id ? dados.clientes.find(c => c.id === base.cliente_id) : null, vei = base.veiculo_id ? dados.veiculos.find(v => v.id === base.veiculo_id) : null;
      const blob = await pdfOS(paraPDF(base, base.itens || itens), cfg, { orcamento: true, cli, vei, numeroTexto: numORC(base.numero), situacaoTexto: SITUACOES_ORC[situacaoORC(base)].t });
      await entregarArquivo(blob, "Orcamento_" + numORC(base.numero) + (base.veiculo.placa ? "_" + base.veiculo.placa : "") + ".pdf"); }
    catch (e) { avisar("Não foi possível gerar o PDF: " + e.message, true); } };
  const whats = async () => { if (!o.cliente.telefone) return setErro("Informe o telefone do cliente para enviar pelo WhatsApp.");
    const base = sujo || novo ? await gravar() : o; if (!base) return;
    window.open(linkWhats(base.cliente.telefone, msgOrcamento(base, base.itens || itens, cfg)), "_blank", "noopener"); };
  const excluir = async () => { if (!await confirmar({ titulo: "Excluir orçamento", texto: numORC(o.numero) + " some de vez. Se o cliente recusou, prefira “Cliente recusou”: o orçamento continua na consulta com o motivo.", botao: "Excluir", perigo: true })) return;
    try { await api.orcamentos.excluir(o.id); avisar("Orçamento excluído."); ir("/orcamentos"); } catch (e) { setErro(e.message); } };

  return html`<div class="pagina orcamento">
    <div class="painel-topo"><div><button type="button" class="btn-link" onClick=${() => ir("/orcamentos")}>‹ Orçamentos</button>
        <h1>${novo ? "Novo orçamento" : "Orçamento " + numORC(o.numero)}</h1>
        <span class="sub">${novo ? "Não abre O.S. e não mexe no estoque." : html`<${Pill} o=${o} /> ${o.consultor_nome ? " · " + o.consultor_nome : ""} · criado em ${fmtDataHora(o.criado_em)}${o.enviado_em ? " · enviado em " + fmtDataHora(o.enviado_em) : ""}`}</span></div>
      <div class="acoes">${!novo ? html`<button type="button" class="btn" onClick=${pdf}>PDF / imprimir</button>` : null}
        ${!novo && gestor ? html`<button type="button" class="btn" onClick=${whats}>WhatsApp</button>` : null}</div></div>
    ${o._local ? html`<div class="aviso">Sem internet: o orçamento está só para consulta.</div>` : null}
    ${sit === "vencido" ? html`<div class="aviso">A validade passou em ${fmtData(o.validade)} sem resposta do cliente. Para reativar, troque a validade e salve.</div>` : null}
    ${o.situacao === "recusado" ? html`<div class="aviso">Recusado pelo cliente${o.respondido_em ? " em " + fmtDataHora(o.respondido_em) : ""}. Motivo: <b>${o.motivo}</b></div>` : null}
    ${o.situacao === "aprovado" ? html`<div class="info">Aprovado${o.os_numero ? html`: virou a <button type="button" class="btn-link" onClick=${() => ir("/os/" + o.ordem_id)}>O.S. ${o.os_numero}</button>` : ""}. Não pode mais ser alterado.</div>` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}

    <section class="card"><h3>Cliente e veículo</h3>
      ${edita ? html`<${Seg} rotulo="Cliente" opcoes=${[["Do cadastro", "info"], ["Sem cadastro", "info"]]} valor=${semCad ? "Sem cadastro" : "Do cadastro"}
        onEscolha=${v => { const s = v === "Sem cadastro"; setSemCad(s); if (s && o.cliente_id) set({ cliente_id: "", veiculo_id: "" }); }} />` : null}
      ${!semCad && edita ? html`<div class="campo"><label for="orc-cli">Cliente</label><${BuscaCliente} id="orc-cli" valor=${o.cliente_id} onEscolha=${escolherCliente} /></div>` : null}
      ${semCad || !edita ? html`<div class="grade">
        <${Campo} id="orc-nome" rotulo="Nome do cliente" obrig><${Texto} id="orc-nome" valor=${o.cliente.nome} disabled=${!edita} onMuda=${v => set({ cliente: { ...o.cliente, nome: v } })} /></${Campo}>
        <${Campo} id="orc-tel" rotulo="Telefone (WhatsApp)"><${Texto} id="orc-tel" inputmode="tel" valor=${edita ? o.cliente.telefone : fmtTel(o.cliente.telefone)} disabled=${!edita} onMuda=${v => set({ cliente: { ...o.cliente, telefone: v } })} /></${Campo}></div>` : null}
      ${edita && veiculosCli.length ? html`<div class="campo"><label for="orc-vei">Veículo do cadastro</label><select id="orc-vei" class="inp" value=${o.veiculo_id || ""} onChange=${e => escolherVeiculo(e.target.value)}>
        <option value="">Outro veículo (digitar)</option>${veiculosCli.map(v => html`<option value=${v.id}>${[exPlaca(v.placa), v.marca, v.modelo, v.ano].filter(Boolean).join(" ")}</option>`)}</select></div>` : null}
      <div class="grade orc-veic">
        <${Campo} id="orc-placa" rotulo="Placa"><${Texto} id="orc-placa" valor=${o.veiculo.placa} disabled=${!edita || !!o.veiculo_id} onMuda=${v => set({ veiculo: { ...o.veiculo, placa: normPlaca(v) } })} /></${Campo}>
        <${Campo} id="orc-marca" rotulo="Marca"><${Texto} id="orc-marca" valor=${o.veiculo.marca} disabled=${!edita || !!o.veiculo_id} onMuda=${v => set({ veiculo: { ...o.veiculo, marca: v } })} /></${Campo}>
        <${Campo} id="orc-modelo" rotulo="Modelo"><${Texto} id="orc-modelo" valor=${o.veiculo.modelo} disabled=${!edita || !!o.veiculo_id} onMuda=${v => set({ veiculo: { ...o.veiculo, modelo: v } })} /></${Campo}>
        <${Campo} id="orc-ano" rotulo="Ano"><${Texto} id="orc-ano" valor=${o.veiculo.ano} disabled=${!edita || !!o.veiculo_id} onMuda=${v => set({ veiculo: { ...o.veiculo, ano: v } })} /></${Campo}></div>
      <${Campo} id="orc-pedido" rotulo="O que o cliente pediu"><${Area} id="orc-pedido" rows="2" valor=${o.reclamacao} disabled=${!edita} onMuda=${v => set({ reclamacao: v })} /></${Campo}>
    </section>

    <section class="card"><div class="secao-topo"><h3>Peças e serviços</h3>
        ${edita ? html`<label class="filtro orc-tabela"><span>Tabela de preço</span><select id="orc-tabela" class="inp" value=${o.tabela_preco} onChange=${e => set({ tabela_preco: e.target.value })}>${Object.entries(TABELAS_PRECO).map(([k, n]) => html`<option value=${k}>${n}</option>`)}</select></label>` : null}</div>
      ${itens.length ? html`<div class="lista">${itens.map(i => html`<${ItemLinha} key=${i.id} i=${i} verValores=${ver} mostrarAprov=${false} onClick=${edita ? () => setModal(i) : null} rotuloExcluir="Excluir do orçamento" onExcluir=${edita ? () => excluirItem(i) : null} />`)}</div>`
        : html`<${Vazio}>Nenhum item ainda.</${Vazio}>`}
      ${edita ? html`<div class="acoes orc-incluir"><button type="button" class="btn" onClick=${() => incluir("peca")}>+ Produto / peça</button><button type="button" class="btn" onClick=${() => incluir("servico")}>+ Serviço</button><button type="button" class="btn" onClick=${() => incluir("terceiro")}>+ Serviço de terceiro</button></div>` : null}
      ${ver ? html`<div class="orc-totais">
        ${t.pecas ? html`<div><span>Produtos</span><b>${reais(t.pecas)}</b></div>` : null}${t.servicos ? html`<div><span>Serviços</span><b>${reais(t.servicos)}</b></div>` : null}${t.terceiros ? html`<div><span>Serviços de terceiros</span><b>${reais(t.terceiros)}</b></div>` : null}
        <div class="orc-desc"><label for="orc-desconto">Desconto</label><${CampoDesconto} id="orc-desconto" subtotal=${t.subtotal} valor=${o.desconto} disabled=${!edita} onMuda=${v => set({ desconto: v })} /></div>
        <div class="orc-total"><span>Total do orçamento</span><b id="orc-total">${reais(t.total)}</b></div>
        ${t.custo ? html`<small class="sub">Custo ${reais(t.custo)} · margem ${reais(t.total - t.custo)} (interno, não sai no orçamento)</small>` : null}</div>` : null}
    </section>

    <section class="card"><h3>Condições</h3>
      <div class="grade">
        <${Campo} id="orc-validade" rotulo="Válido até" dica=${"Padrão dos Ajustes: " + (Number(cfg.validadeDias) || 10) + " dias."}><input id="orc-validade" type="date" class="inp inp-curto" value=${o.validade || ""} disabled=${trancado} onInput=${e => set({ validade: e.target.value })} /></${Campo}>
        <${Campo} id="orc-cond" rotulo="Condições de pagamento"><${Texto} id="orc-cond" valor=${o.condicoes_pagamento} disabled=${!edita} onMuda=${v => set({ condicoes_pagamento: v })} /></${Campo}></div>
      <${Campo} id="orc-obs" rotulo="Observações (saem no orçamento)"><${Area} id="orc-obs" rows="2" valor=${o.obs} disabled=${!edita} onMuda=${v => set({ obs: v })} /></${Campo}>
      <${Campo} id="orc-obsint" rotulo="Anotações internas (o cliente não vê)"><${Area} id="orc-obsint" rows="2" valor=${o.obs_internas} disabled=${trancado} onMuda=${v => set({ obs_internas: v })} /></${Campo}>
    </section>

    ${!trancado ? html`<div class="acoes orc-acoes">
      ${!novo && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}
      <span class="espaco"></span>
      ${o.situacao === "recusado" ? html`<button type="button" class="btn" disabled=${salvando} onClick=${() => gravar({ situacao: "elaboracao", motivo: "" }, "Orçamento reaberto.")}>Reabrir orçamento</button>`
        : html`${!novo ? html`<button type="button" class="btn btn-recusa" disabled=${salvando} onClick=${() => setRecusa("")}>Cliente recusou</button>` : null}
          ${o.situacao === "elaboracao" && !novo ? html`<button type="button" class="btn" disabled=${salvando} onClick=${() => gravar({ situacao: "enviado" }, "Marcado como enviado ao cliente.")}>Marcar como enviado</button>` : null}
          ${o.situacao === "enviado" ? html`<button type="button" class="btn" disabled=${salvando} onClick=${() => gravar({ situacao: "elaboracao" }, "Voltou para em elaboração.")}>Voltar para elaboração</button>` : null}
          <button type="button" class=${"btn" + (novo || sujo ? " btn-pri" : "")} disabled=${salvando || (!sujo && !novo)} onClick=${() => gravar()}>${salvando ? "Salvando…" : "Salvar orçamento"}</button>
          ${!novo ? html`<button type="button" class=${"btn btn-aprovar" + (sujo ? "" : " btn-pri")} disabled=${salvando} onClick=${abrirAprovar}>Cliente aprovou: virar O.S.</button>` : null}`}
    </div>` : null}
    ${aprovar ? html`<${AprovarModal} o=${o} itens=${itens} ver=${ver} onFechar=${() => setAprovar(false)} onFeito=${r => { setAprovar(false); avisar("Orçamento aprovado: virou a O.S. " + r.os_numero + "."); recarregar(["ordens", "clientes", "veiculos", "produtos"]); ir("/os/" + r.ordem_id); }} />` : null}

    ${modal ? html`<${ItemModal} item=${modal} tabela=${o.tabela_preco} orcamento onSalvar=${salvarItem} onExcluir=${() => excluirItem(modal)} onFechar=${() => setModal(null)} />` : null}
    ${recusa !== null ? html`<${Modal} titulo="Cliente recusou o orçamento" onFechar=${() => setRecusa(null)}>
      <p class="sub">O orçamento continua na consulta, com o motivo. Serve para saber por que a oficina perde serviço.</p>
      <div class="chips">${["Achou caro", "Fez em outra oficina", "Desistiu do serviço", "Vai fazer depois", "Não respondeu"].map(m => html`<button type="button" key=${m} class=${"chip-f" + (recusa === m ? " ativo" : "")} onClick=${() => setRecusa(m)}>${m}</button>`)}</div>
      <${Campo} id="orc-motivo" rotulo="Motivo" obrig><${Texto} id="orc-motivo" valor=${recusa} onMuda=${setRecusa} /></${Campo}>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${() => setRecusa(null)}>Cancelar</button>
        <button type="button" class="btn btn-pri" disabled=${!recusa.trim() || salvando} onClick=${async () => { if (await gravar({ situacao: "recusado", motivo: recusa.trim() }, "Orçamento marcado como recusado.")) setRecusa(null); }}>Registrar recusa</button></div>
    </${Modal}>` : null}
  </div>`;
}

/* ---------------- aprovar: o que o cliente não tirar vira O.S.; o que tirar fica registrado como não aprovado ---------------- */
const FORMAS_APROV = ["WhatsApp", "Telefone", "Na oficina"];
function AprovarModal({ o, itens, ver, onFechar, onFeito }) {
  const { ir } = useApp();
  const [fora, setFora] = useState(() => itens.filter(i => i.aprovado === false).map(i => i.id)), [por, setPor] = useState((o.cliente || {}).nome || ""), [forma, setForma] = useState("WhatsApp");
  const [previa, setPrevia] = useState(null), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  const jaRecusados = useMemo(() => new Set(itens.filter(i => i.aprovado === false).map(i => i.id)), [itens]);
  const marca = (id, segue) => setFora(f => segue ? f.filter(x => x !== id) : [...new Set([...f, id])]);
  // a conferência é do banco (mesma função da gravação, sem gravar): cliente, veículo, desconto e avisos
  useEffect(() => { let vivo = true; setPrevia(null); setErro("");
    api.orcamentos.aprovar(o.id, { itensFora: fora, por, forma, gravar: false }).then(r => { if (vivo) setPrevia(r); })
      .catch(e => { if (vivo) setErro(FALTA_V53(e) ? "Aprovar e virar O.S. precisa do arquivo supabase/v53.sql, que o administrador roda uma vez no Supabase." : e.message); });
    return () => { vivo = false; }; }, [fora.join(",")]);
  const vao = itens.filter(i => !fora.includes(i.id)), t = totais(vao.map(i => ({ ...i, aprovado: null })), o.desconto);
  const confirmar = async () => { setOcupado(true); setErro("");
    try { const r = await api.orcamentos.aprovar(o.id, { itensFora: fora, por: por.trim(), forma, gravar: true });
      if (!r.gravado) { setPrevia(r); setOcupado(false); return; } onFeito(r); }
    catch (e) { setErro(e.message); setOcupado(false); } };
  const erros = (previa && previa.erros) || [], avisos = (previa && previa.avisos) || [];
  return html`<${Modal} titulo=${"Aprovar " + numORC(o.numero) + " e abrir a O.S."} largo onFechar=${onFechar}>
    <p class="sub">Desmarque o que o cliente <b>não</b> aprovou. O que ficar marcado vai para a O.S., já aprovado. O que for desmarcado não vai: fica registrado no orçamento e numa observação da O.S. como apontado pela oficina e não aprovado pelo cliente.</p>
    <div class="lista orc-aprov-lista">${itens.map(i => html`<label key=${i.id} class=${"linha orc-aprov-item" + (fora.includes(i.id) ? " fora" : "")}>
      <input type="checkbox" class="prod-check" checked=${!fora.includes(i.id)} disabled=${jaRecusados.has(i.id)} onChange=${e => marca(i.id, e.target.checked)} />
      <span class="meio"><strong>${i.descricao}</strong><span>${[{ peca: "Produto / peça", servico: "Serviço", terceiro: "Serviço de terceiro" }[i.tipo], fora.includes(i.id) ? "não aprovado pelo cliente" : "vai para a O.S."].join(" · ")}</span></span>
      ${ver ? html`<span class="dir"><b>${i.fornecida_cliente ? "—" : reais(i.qtd * i.valor_unit - (Number(i.desconto) || 0))}</b></span>` : null}</label>`)}</div>
    ${ver ? html`<div class="total-item"><span>${vao.length} item(ns) na O.S.${Number(o.desconto) ? " · desconto " + reais(o.desconto) : ""}</span><b id="orc-aprov-total">${reais(t.total)}</b></div>` : null}
    <div class="grade">
      <${Campo} id="orc-aprov-por" rotulo="Quem aprovou"><${Texto} id="orc-aprov-por" valor=${por} onMuda=${setPor} /></${Campo}>
      <div class="campo"><label>Como aprovou</label><${Seg} rotulo="Como aprovou" opcoes=${FORMAS_APROV.map(x => [x, "info"])} valor=${forma} onEscolha=${setForma} /></div></div>
    ${previa && (previa.cliente_novo || previa.veiculo_novo) && !erros.length ? html`<div class="info">${[previa.cliente_novo ? "O cliente será cadastrado" : "", previa.veiculo_novo ? "o veículo será cadastrado" : ""].filter(Boolean).join(" e ")} com os dados do orçamento.</div>` : null}
    <div class="info">A O.S. nasce sem KM de entrada: quando o carro chegar, a tela da O.S. pede o KM e oferece o checklist. As peças aprovadas saem do estoque agora.</div>
    ${avisos.map(a => html`<div class="aviso" key=${a}>${a}</div>`)}
    ${erros.length ? html`<div class="erros">${erros.map(x => html`<div key=${x}>${x}</div>`)}</div>` : null}${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes">${erros.length ? html`<button type="button" class="btn" onClick=${onFechar}>Corrigir no orçamento</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${onFechar}>Cancelar</button>
      <button type="button" class="btn btn-pri" disabled=${ocupado || !previa || !!erros.length || !vao.length} onClick=${confirmar}>${ocupado ? "Abrindo a O.S.…" : "Aprovar e abrir a O.S."}</button></div>
  </${Modal}>`;
}
