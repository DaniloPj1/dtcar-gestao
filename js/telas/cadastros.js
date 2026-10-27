import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Campo, Texto, Area, Seg, Abas, Modal, Vazio, I } from "../ui.js";
import { soDig, norm, docValido, fmtDoc, fmtTel, normPlaca, placaValida, exPlaca, fmtKm, reais, fmtData, numOS, linkWhats, qtdFmt } from "../util.js";
import { pode, ABERTOS } from "../regras.js";
import { LinhaOS } from "./painel.js";
import { prepararNovaOS, ORIGENS } from "./entrada.js";

const DIA = 86400000;
const meses = iso => Math.floor((Date.now() - new Date(iso)) / (30.4 * DIA));
function resumoClientes(ordens) {
  const r = new Map();
  for (const o of ordens) {
    if (!o.cliente_id || o.status === "cancelado") continue;
    const x = r.get(o.cliente_id) || { n: 0, gasto: 0, ultima: "", aberta: false };
    x.n++; if (o.status === "entregue") x.gasto += Number(o.total || 0);
    const t = o.entregue_em || o.criado_em; if (t > x.ultima) x.ultima = t;
    if (ABERTOS.includes(o.status)) x.aberta = true;
    r.set(o.cliente_id, x);
  }
  return r;
}
const msgRetorno = (c, v, cfg, ultima) => `Olá, ${c.nome.split(" ")[0]}! Aqui é da ${cfg.nome}.\n\n` +
  (v ? `Já faz ${meses(ultima)} meses desde a última visita do seu ${[v.marca, v.modelo].filter(Boolean).join(" ")} (${exPlaca(v.placa)}). ` : `Já faz ${meses(ultima)} meses desde a sua última visita. `) +
  `Que tal agendarmos uma revisão? É só responder esta mensagem que combinamos o melhor dia e horário.`;

/* ---------------- formulário de cliente / veículo ---------------- */
export function FormCadastro({ ed, setEd, onSalvo }) {
  const { dados, perfil, avisar, confirmar, recarregar } = useApp();
  const podeCad = pode(perfil, "cadastrar");
  const set = (k, v) => setEd(o => ({ ...o, erros: [], d: { ...o.d, [k]: v } }));
  const salvar = async () => {
    const d = ed.d, erros = [];
    if (ed.tipo === "cliente") {
      if (!d.nome.trim()) erros.push("Informe o nome.");
      const t = soDig(d.telefone); if (t && (t.length < 10 || t.length > 11)) erros.push("Telefone deve ter DDD + número.");
      if (!ed.id && !t) erros.push("Informe o telefone com DDD.");
      if (t && dados.clientes.some(c => c.id !== ed.id && soDig(c.telefone) === t)) erros.push("Este telefone já está cadastrado para outro cliente.");
      if (d.doc && !docValido(d.doc)) erros.push("CPF/CNPJ inválido.");
      if (d.doc && dados.clientes.some(c => c.id !== ed.id && soDig(c.doc) && soDig(c.doc) === soDig(d.doc))) erros.push("Já existe outro cliente com este CPF/CNPJ.");
    } else {
      const pl = normPlaca(d.placa);
      if (!placaValida(pl) && !(ed.id && pl === ed.placaOriginal)) erros.push("Placa inválida.");
      if (dados.veiculos.some(v => v.id !== ed.id && v.placa === pl)) erros.push("Já existe um veículo com esta placa.");
      if (!d.marca.trim() || !d.modelo.trim()) erros.push("Informe marca e modelo.");
    }
    if (erros.length) return setEd({ ...ed, erros });
    try {
      let r;
      if (ed.tipo === "cliente") r = await api.clientes.salvar({ ...(ed.id ? { id: ed.id } : {}), nome: d.nome.trim(), telefone: soDig(d.telefone), doc: soDig(d.doc), email: (d.email || "").trim(), endereco: (d.endereco || "").trim(), obs: (d.obs || "").trim(), nascimento: d.nascimento || null, origem: d.origem || "" });
      else r = await api.veiculos.salvar({ ...(ed.id ? { id: ed.id } : {}), placa: normPlaca(d.placa), marca: d.marca.trim(), modelo: d.modelo.trim(), ano: String(d.ano || ""), cor: (d.cor || "").trim(), motor: (d.motor || "").trim(), obs: (d.obs || "").trim(), cliente_id: d.cliente_id || null });
      setEd(null); avisar("Cadastro salvo."); await recarregar([ed.tipo === "cliente" ? "clientes" : "veiculos"]); onSalvo && onSalvo(r);
    } catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  const excluir = async () => {
    if (ed.tipo === "cliente") { const nv = dados.veiculos.filter(v => v.cliente_id === ed.id).length; if (nv) return setEd({ ...ed, erros: ["Este cliente tem " + nv + " veículo(s) vinculado(s). Transfira ou exclua o veículo antes."] }); }
    if (dados.ordens.some(o => (ed.tipo === "cliente" ? o.cliente_id : o.veiculo_id) === ed.id)) return setEd({ ...ed, erros: ["Este cadastro tem O.S. no histórico e não pode ser excluído."] });
    if (!await confirmar({ titulo: "Excluir cadastro", texto: "Esta ação não pode ser desfeita.", botao: "Excluir", perigo: true })) return;
    try { await (ed.tipo === "cliente" ? api.clientes : api.veiculos).excluir(ed.id); setEd(null); avisar("Cadastro excluído."); recarregar([ed.tipo === "cliente" ? "clientes" : "veiculos"]); }
    catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  return html`<${Modal} titulo=${(ed.id ? "Editar " : "Novo ") + (ed.tipo === "cliente" ? "cliente" : "veículo")} onFechar=${() => setEd(null)}>
    ${ed.erros.length ? html`<div class="erros">${ed.erros.join(" ")}</div>` : null}
    <fieldset disabled=${!podeCad} class="sem-borda">
    ${ed.tipo === "cliente" ? html`<div class="grade">
        <${Campo} id="e-nome" rotulo="Nome" obrig><${Texto} id="e-nome" valor=${ed.d.nome} onMuda=${v => set("nome", v)} /></${Campo}>
        <${Campo} id="e-tel" rotulo="Telefone / WhatsApp" obrig><input id="e-tel" class="inp" inputmode="tel" value=${ed.d.telefone} onBlur=${e => set("telefone", fmtTel(e.target.value))} onInput=${e => set("telefone", e.target.value)} /></${Campo}>
        <${Campo} id="e-doc" rotulo="CPF ou CNPJ"><input id="e-doc" class="inp" inputmode="numeric" value=${ed.d.doc} onBlur=${e => set("doc", fmtDoc(e.target.value))} onInput=${e => set("doc", e.target.value)} /></${Campo}>
        <${Campo} id="e-email" rotulo="E-mail"><${Texto} id="e-email" type="email" valor=${ed.d.email} onMuda=${v => set("email", v)} /></${Campo}>
        <${Campo} id="e-nasc" rotulo="Data de nascimento"><input id="e-nasc" type="date" class="inp" value=${ed.d.nascimento || ""} onInput=${e => set("nascimento", e.target.value)} /></${Campo}>
      </div>
      <${Campo} id="e-end" rotulo="Endereço"><${Texto} id="e-end" valor=${ed.d.endereco} onMuda=${v => set("endereco", v)} /></${Campo}>
      <div class="campo"><label>Como conheceu a DTCar?</label><${Seg} rotulo="Origem" opcoes=${ORIGENS.map(o => [o, "info"])} valor=${ed.d.origem} onEscolha=${v => set("origem", v)} /></div>
      <${Campo} id="e-obs" rotulo="Observações"><${Area} id="e-obs" valor=${ed.d.obs} onMuda=${v => set("obs", v)} /></${Campo}>`
    : html`<div class="grade">
        <${Campo} id="e-placa" rotulo="Placa" obrig><input id="e-placa" class="inp inp-placa" value=${exPlaca(normPlaca(ed.d.placa))} onInput=${e => set("placa", normPlaca(e.target.value))} /></${Campo}>
        <${Campo} id="e-marca" rotulo="Marca" obrig><${Texto} id="e-marca" valor=${ed.d.marca} onMuda=${v => set("marca", v)} /></${Campo}>
        <${Campo} id="e-modelo" rotulo="Modelo" obrig><${Texto} id="e-modelo" valor=${ed.d.modelo} onMuda=${v => set("modelo", v)} /></${Campo}>
        <${Campo} id="e-ano" rotulo="Ano"><${Texto} id="e-ano" valor=${ed.d.ano} onMuda=${v => set("ano", v.replace(/[^\d/]/g, "").slice(0, 9))} /></${Campo}>
        <${Campo} id="e-cor" rotulo="Cor"><${Texto} id="e-cor" valor=${ed.d.cor} onMuda=${v => set("cor", v)} /></${Campo}>
        <${Campo} id="e-motor" rotulo="Motor / combustível"><${Texto} id="e-motor" valor=${ed.d.motor} onMuda=${v => set("motor", v)} /></${Campo}>
      </div>
      <${Campo} id="e-cli" rotulo="Proprietário"><select id="e-cli" class="inp" value=${ed.d.cliente_id || ""} onChange=${e => set("cliente_id", e.target.value)}>
        <option value="">Sem cliente</option>${dados.clientes.map(c => html`<option key=${c.id} value=${c.id}>${c.nome}</option>`)}</select></${Campo}>
      <${Campo} id="e-vobs" rotulo="Observações (chassi, particularidades)"><${Area} id="e-vobs" valor=${ed.d.obs} onMuda=${v => set("obs", v)} /></${Campo}>
      ${ed.id ? html`<span class="dica">Último KM: ${fmtKm(ed.d.km_atual)}. Atualizado automaticamente na abertura e na entrega das O.S.</span>` : null}`}
    </fieldset>
    <div class="acoes">${ed.id && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${() => setEd(null)}>${podeCad ? "Cancelar" : "Fechar"}</button>${podeCad ? html`<button type="button" class="btn btn-pri" onClick=${salvar}>Salvar</button>` : null}</div>
  </${Modal}>`;
}
export const edCliente = c => c ? { tipo: "cliente", id: c.id, d: { ...c, telefone: fmtTel(c.telefone), doc: fmtDoc(c.doc), obs: c.obs || "", origem: c.origem || "", nascimento: c.nascimento || "" }, erros: [] }
  : { tipo: "cliente", d: { nome: "", telefone: "", doc: "", email: "", endereco: "", obs: "", origem: "", nascimento: "" }, erros: [] };
export const edVeiculo = (v, clienteId) => v ? { tipo: "veiculo", id: v.id, placaOriginal: v.placa, d: { ...v, obs: v.obs || "", cliente_id: v.cliente_id || "" }, erros: [] }
  : { tipo: "veiculo", d: { placa: "", marca: "", modelo: "", ano: "", cor: "", motor: "", obs: "", cliente_id: clienteId || "" }, erros: [] };

/* ---------------- lista ---------------- */
export function Cadastros({ params }) {
  const { dados, perfil, cfg, ir } = useApp();
  const [aba, setAba] = useState("clientes"), [q, setQ] = useState(""), [ed, setEd] = useState(null);
  const [filtro, setFiltro] = useState(params && params.filtro === "recuperar" ? "recuperar" : "todos"), [ordem, setOrdem] = useState(params && params.filtro === "recuperar" ? "ultima" : "nome");
  const [lim, setLim] = useState(80);
  const podeCad = pode(perfil, "cadastrar"), ver = pode(perfil, "verValores");
  const res = useMemo(() => resumoClientes(dados.ordens), [dados.ordens]);
  const n = norm(q), qd = soDig(q), p = normPlaca(q);
  const clientes = useMemo(() => {
    let l = dados.clientes.filter(c => !n || norm(c.nome).includes(n) || (qd.length >= 3 && (soDig(c.telefone).includes(qd) || soDig(c.doc).includes(qd))) || (p.length >= 3 && dados.veiculos.some(v => v.cliente_id === c.id && v.placa.includes(p))));
    if (filtro === "aberta") l = l.filter(c => (res.get(c.id) || {}).aberta);
    if (filtro === "recuperar") l = l.filter(c => { const r = res.get(c.id); if (!r || r.aberta || !r.ultima) return false; const d = (Date.now() - new Date(r.ultima)) / DIA; return d >= 180 && d <= 730; });
    if (filtro === "semtel") l = l.filter(c => soDig(c.telefone).length < 10);
    const g = c => res.get(c.id) || { gasto: 0, ultima: "" };
    if (ordem === "ultima") l = [...l].sort((a, b) => (g(b).ultima || "").localeCompare(g(a).ultima || ""));
    else if (ordem === "gasto") l = [...l].sort((a, b) => g(b).gasto - g(a).gasto);
    else l = [...l].sort((a, b) => a.nome.localeCompare(b.nome));
    return l;
  }, [dados.clientes, dados.veiculos, res, q, filtro, ordem]);
  const veiculos = useMemo(() => dados.veiculos.filter(v => !n || (p.length >= 3 && v.placa.includes(p)) || norm(v.modelo).includes(n) || norm(v.marca).includes(n)).sort((a, b) => a.placa.localeCompare(b.placa)), [dados.veiculos, q]);
  useEffect(() => setLim(80), [q, filtro, ordem, aba]);
  const nomeCli = id => (dados.clientes.find(c => c.id === id) || {}).nome || "Sem cliente";

  const exportar = () => {
    const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const linhas = [["Nome", "Telefone", "CPF/CNPJ", "E-mail", "Endereço", "Nascimento", "Origem", "Veículos", "O.S.", "Total gasto", "Última visita"].map(esc).join(";")];
    for (const c of clientes) { const r = res.get(c.id) || { n: 0, gasto: 0, ultima: "" };
      linhas.push([c.nome, fmtTel(c.telefone), fmtDoc(c.doc), c.email, c.endereco, c.nascimento ? fmtData(c.nascimento) : "", c.origem, dados.veiculos.filter(v => v.cliente_id === c.id).map(v => v.placa).join(" "), r.n, String(r.gasto.toFixed(2)).replace(".", ","), r.ultima ? fmtData(r.ultima) : ""].map(esc).join(";")); }
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "clientes-dtcar-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  const chamar = c => { const r = res.get(c.id); const v = dados.veiculos.find(x => x.cliente_id === c.id); window.open(linkWhats(c.telefone, msgRetorno(c, v, cfg, r.ultima)), "_blank", "noopener"); };

  return html`<div class="pagina">
    <${Abas} abas=${[["clientes", "Clientes (" + dados.clientes.length + ")"], ["veiculos", "Veículos (" + dados.veiculos.length + ")"]]} ativa=${aba} onTroca=${setAba} />
    <div class="linha-add"><input id="busca-cad" class="inp" aria-label="Buscar" placeholder=${aba === "clientes" ? "Nome, telefone, CPF ou placa" : "Placa, marca ou modelo"} value=${q} onInput=${e => setQ(e.target.value)} />
      ${podeCad ? html`<button type="button" class="btn btn-pri" onClick=${() => setEd(aba === "clientes" ? edCliente() : edVeiculo())}>+ Novo</button>` : null}</div>
    ${aba === "clientes" ? html`
      <div class="filtros">
        <div class="chips rolagem">${[["todos", "Todos"], ["aberta", "Com O.S. aberta"], ["recuperar", "Para recuperar"], ["semtel", "Sem telefone"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (filtro === k ? " ativo" : "")} onClick=${() => setFiltro(k)}>${t}</button>`)}</div>
        <select class="inp inp-curto" aria-label="Ordenar" value=${ordem} onChange=${e => setOrdem(e.target.value)}><option value="nome">Nome A–Z</option><option value="ultima">Última visita</option>${ver ? html`<option value="gasto">Maior gasto</option>` : null}</select>
      </div>
      ${filtro === "recuperar" ? html`<div class="info">Clientes com última visita entre 6 meses e 2 anos e sem O.S. aberta. Use o botão de WhatsApp para enviar um convite de revisão.</div>` : null}
      <section class="card"><div class="secao-topo"><h3>${clientes.length} cliente(s)</h3>${ver ? html`<button type="button" class="btn btn-sm" onClick=${exportar}>Exportar planilha</button>` : null}</div>
        ${clientes.length ? html`<div class="lista">${clientes.slice(0, lim).map(c => { const r = res.get(c.id) || { n: 0, gasto: 0, ultima: "" }; return html`<div class="linha linha-cli" key=${c.id}>
          <button type="button" class="meio botao-limpo" onClick=${() => ir("/cliente/" + c.id)}><strong>${c.nome}</strong><span>${c.telefone ? fmtTel(c.telefone) : "sem telefone"}${r.ultima ? " · última visita " + fmtData(r.ultima) : " · sem O.S."}</span></button>
          <span class="dir">${ver && r.gasto ? html`<b>${reais(r.gasto)}</b>` : null}<small>${r.n} O.S.</small></span>
          ${filtro === "recuperar" && soDig(c.telefone).length >= 10 ? html`<button type="button" class="btn btn-sm btn-whats" aria-label=${"WhatsApp para " + c.nome} onClick=${() => chamar(c)}>${I.whats}</button>` : null}</div>`; })}</div>
          ${clientes.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 200)}>Mostrar mais (${clientes.length - lim})</button>` : null}`
          : html`<${Vazio}>Nenhum cliente encontrado.</${Vazio}>`}
      </section>`
    : html`<section class="card"><h3>${veiculos.length} veículo(s)</h3>
        ${veiculos.length ? html`<div class="lista">${veiculos.slice(0, lim).map(v => html`<button type="button" key=${v.id} class="linha" onClick=${() => ir("/veiculo/" + v.id)}>
          <${Placa} placa=${v.placa} /><span class="meio"><strong>${v.marca} ${v.modelo} ${v.ano}</strong><span>${nomeCli(v.cliente_id)} · ${fmtKm(v.km_atual)}</span></span><span class="sub">${dados.ordens.filter(o => o.veiculo_id === v.id).length} O.S.</span></button>`)}</div>
          ${veiculos.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 200)}>Mostrar mais (${veiculos.length - lim})</button>` : null}`
          : html`<${Vazio}>Nenhum veículo encontrado.</${Vazio}>`}</section>`}
    ${ed ? html`<${FormCadastro} ed=${ed} setEd=${setEd} onSalvo=${r => r && r.id && ir((ed.tipo === "cliente" ? "/cliente/" : "/veiculo/") + r.id)} />` : null}
  </div>`;
}

/* ---------------- ficha do cliente ---------------- */
export function ClienteTela({ id }) {
  const { dados, perfil, cfg, ir } = useApp();
  const [ed, setEd] = useState(null);
  const c = dados.clientes.find(x => x.id === id);
  if (!c) return html`<div class="pagina"><button class="btn-link voltar" onClick=${() => ir("/cadastros")}>← Cadastros</button><${Vazio}>Cliente não encontrado.</${Vazio}></div>`;
  const ver = pode(perfil, "verValores");
  const veics = dados.veiculos.filter(v => v.cliente_id === id);
  const os = dados.ordens.filter(o => o.cliente_id === id);
  const entregues = os.filter(o => o.status === "entregue");
  const gasto = entregues.reduce((s, o) => s + Number(o.total || 0), 0);
  const ultima = os.reduce((m, o) => { const t = o.entregue_em || o.criado_em; return t > m ? t : m; }, "");
  const novaOS = v => { prepararNovaOS(v || { placa: "", id: "", cliente_id: id }); ir("/entrada"); };
  return html`<div class="pagina">
    <button type="button" class="btn-link voltar" onClick=${() => history.length > 1 ? history.back() : ir("/cadastros")}>← Voltar</button>
    <section class="card">
      <div class="ficha-cab"><div class="meio"><h2>${c.nome}</h2><span class="sub">${[c.telefone ? fmtTel(c.telefone) : "sem telefone", c.doc ? fmtDoc(c.doc) : "", c.email].filter(Boolean).join(" · ")}</span></div>
        <div class="acoes">${soDig(c.telefone).length >= 10 ? html`<a class="btn btn-sm btn-whats" href=${linkWhats(c.telefone, "Olá, " + c.nome.split(" ")[0] + "! ")} target="_blank" rel="noopener">${I.whats} WhatsApp</a>` : null}
          ${pode(perfil, "cadastrar") ? html`<button type="button" class="btn btn-sm" onClick=${() => setEd(edCliente(c))}>Editar</button>` : null}</div></div>
      <div class="kv">
        ${ver ? html`<div><span>Total em serviços</span><b>${reais(gasto)}</b></div><div><span>Ticket médio</span><b>${reais(entregues.length ? gasto / entregues.length : 0)}</b></div>` : null}
        <div><span>O.S.</span><b>${os.length}</b></div><div><span>Última visita</span><b>${ultima ? fmtData(ultima) : "—"}</b></div>
        <div><span>Cliente desde</span><b>${fmtData(c.criado_em)}</b></div>${c.origem ? html`<div><span>Como conheceu</span><b>${c.origem}</b></div>` : null}
        ${c.nascimento ? html`<div><span>Nascimento</span><b>${fmtData(c.nascimento)}</b></div>` : null}
      </div>
      ${c.endereco ? html`<div><span class="sub">Endereço</span><div>${c.endereco}</div></div>` : null}
      ${c.obs ? html`<div><span class="sub">Observações</span><div class="texto-pre">${c.obs}</div></div>` : null}
    </section>
    <section class="card"><div class="secao-topo"><h3>Veículos (${veics.length})</h3>${pode(perfil, "cadastrar") ? html`<button type="button" class="btn btn-sm" onClick=${() => setEd(edVeiculo(null, id))}>+ Veículo</button>` : null}</div>
      ${veics.length ? html`<div class="lista">${veics.map(v => html`<div class="linha" key=${v.id}><${Placa} placa=${v.placa} />
        <button type="button" class="meio botao-limpo" onClick=${() => ir("/veiculo/" + v.id)}><strong>${v.marca} ${v.modelo} ${v.ano}</strong><span>${fmtKm(v.km_atual)} · ${dados.ordens.filter(o => o.veiculo_id === v.id).length} O.S.</span></button>
        ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-sm" onClick=${() => novaOS(v)}>Nova O.S.</button>` : null}</div>`)}</div>` : html`<span class="dica">Nenhum veículo vinculado.</span>`}</section>
    <section class="card"><h3>Histórico de O.S.</h3>
      ${os.length ? html`<div class="lista">${os.map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma O.S.</span>`}</section>
    ${ed ? html`<${FormCadastro} ed=${ed} setEd=${setEd} />` : null}
  </div>`;
}

/* ---------------- ficha do veículo ---------------- */
export function VeiculoTela({ id }) {
  const { dados, perfil, ir } = useApp();
  const [ed, setEd] = useState(null);
  const [itens, setItens] = useState(null);
  const v = dados.veiculos.find(x => x.id === id);
  const os = useMemo(() => dados.ordens.filter(o => o.veiculo_id === id), [dados.ordens, id]);
  useEffect(() => { let vivo = true; const ids = os.filter(o => o.status === "entregue").map(o => o.id);
    if (!ids.length) { setItens([]); return; } api.itensDasOrdens(ids).then(r => vivo && setItens(r)).catch(() => vivo && setItens([])); return () => { vivo = false; }; }, [os.map(o => o.id).join()]);
  if (!v) return html`<div class="pagina"><button class="btn-link voltar" onClick=${() => ir("/cadastros")}>← Cadastros</button><${Vazio}>Veículo não encontrado.</${Vazio}></div>`;
  const ver = pode(perfil, "verValores");
  const dono = dados.clientes.find(c => c.id === v.cliente_id);
  const porOS = new Map(); (itens || []).forEach(i => { if (i.aprovado === false) return; if (!porOS.has(i.ordem_id)) porOS.set(i.ordem_id, []); porOS.get(i.ordem_id).push(i); });
  const entregues = os.filter(o => o.status === "entregue").sort((a, b) => (b.entregue_em || "").localeCompare(a.entregue_em || ""));
  return html`<div class="pagina">
    <button type="button" class="btn-link voltar" onClick=${() => history.length > 1 ? history.back() : ir("/cadastros")}>← Voltar</button>
    <section class="card">
      <div class="det-cab"><${Placa} placa=${v.placa} grande /><div class="meio"><h2>${v.marca} ${v.modelo}</h2><div class="sub">${[v.ano, v.cor, v.motor].filter(Boolean).join(" · ")}</div></div>
        ${pode(perfil, "cadastrar") ? html`<button type="button" class="btn btn-sm" onClick=${() => setEd(edVeiculo(v))}>Editar</button>` : null}</div>
      <div class="kv"><div><span>KM atual</span><b>${fmtKm(v.km_atual)}</b></div><div><span>Proprietário</span><b>${dono ? html`<button type="button" class="btn-link" onClick=${() => ir("/cliente/" + dono.id)}>${dono.nome}</button>` : "—"}</b></div>
        <div><span>O.S.</span><b>${os.length}</b></div>${ver ? html`<div><span>Total em serviços</span><b>${reais(entregues.reduce((s, o) => s + Number(o.total || 0), 0))}</b></div>` : null}</div>
      ${v.obs ? html`<div class="texto-pre sub">${v.obs}</div>` : null}
      ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri" onClick=${() => { prepararNovaOS(v); ir("/entrada"); }}>+ Nova O.S. para este veículo</button>` : null}
    </section>
    ${os.filter(o => o.status !== "entregue").length ? html`<section class="card"><h3>Em andamento e outras</h3><div class="lista">${os.filter(o => o.status !== "entregue").map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div></section>` : null}
    <section class="card"><h3>Histórico de serviços</h3>
      ${!entregues.length ? html`<span class="dica">Nenhum serviço entregue ainda.</span>` : !itens ? html`<span class="dica">Carregando…</span>`
      : html`<ol class="historico-vei">${entregues.map(o => html`<li key=${o.id}>
          <div class="hv-cab"><button type="button" class="btn-link" onClick=${() => ir("/os/" + o.id)}>${numOS(o.numero)}</button><span>${fmtData(o.entregue_em)}</span><span>${o.km_entrada ? fmtKm(o.km_entrada) : "KM não informado"}</span>${ver ? html`<b>${reais(o.total)}</b>` : null}</div>
          <ul>${(porOS.get(o.id) || []).map((i, n) => html`<li key=${n} class=${"hv-" + i.tipo}>${i.descricao}${i.tipo === "peca" && Number(i.qtd) !== 1 ? " (" + qtdFmt(i.qtd) + ")" : ""}</li>`)}</ul></li>`)}</ol>`}
    </section>
    ${ed ? html`<${FormCadastro} ed=${ed} setEd=${setEd} />` : null}
  </div>`;
}
