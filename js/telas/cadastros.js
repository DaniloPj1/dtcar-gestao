import { html, useState } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Campo, Texto, Abas, Modal, Vazio } from "../ui.js";
import { soDig, norm, docValido, fmtDoc, fmtTel, normPlaca, placaValida, exPlaca, fmtKm, reais } from "../util.js";
import { pode } from "../regras.js";
import { LinhaOS } from "./painel.js";

export function Cadastros() {
  const { dados, perfil, avisar, confirmar, ir, recarregar } = useApp();
  const [aba, setAba] = useState("clientes"), [q, setQ] = useState(""), [ed, setEd] = useState(null);
  const n = norm(q), qd = soDig(q), p = normPlaca(q);
  const podeCad = pode(perfil, "cadastrar"), ver = pode(perfil, "verValores");
  const clientes = dados.clientes.filter(c => !n || norm(c.nome).includes(n) || (qd.length >= 3 && (soDig(c.telefone).includes(qd) || soDig(c.doc).includes(qd))));
  const veiculos = dados.veiculos.filter(v => !n || (p.length >= 3 && v.placa.includes(p)) || norm(v.modelo).includes(n) || norm(v.marca).includes(n));
  const nomeCli = id => (dados.clientes.find(c => c.id === id) || {}).nome || "Sem cliente";
  const set = (k, v) => setEd(o => ({ ...o, erros: [], d: { ...o.d, [k]: v } }));

  const salvar = async () => {
    const d = ed.d, erros = [];
    if (ed.tipo === "cliente") {
      if (!d.nome.trim()) erros.push("Informe o nome.");
      const t = soDig(d.telefone); if (t.length < 10 || t.length > 11) erros.push("Informe o telefone com DDD.");
      if (d.doc && !docValido(d.doc)) erros.push("CPF/CNPJ inválido.");
      if (d.doc && dados.clientes.some(c => c.id !== ed.id && soDig(c.doc) && soDig(c.doc) === soDig(d.doc))) erros.push("Já existe outro cliente com este CPF/CNPJ.");
    } else {
      const pl = normPlaca(d.placa);
      if (!placaValida(pl)) erros.push("Placa inválida.");
      if (dados.veiculos.some(v => v.id !== ed.id && v.placa === pl)) erros.push("Já existe um veículo com esta placa.");
      if (!d.marca.trim() || !d.modelo.trim()) erros.push("Informe marca e modelo.");
      const ano = +d.ano; if (!(ano >= 1950 && ano <= new Date().getFullYear() + 1)) erros.push("Ano inválido.");
    }
    if (erros.length) return setEd({ ...ed, erros });
    try {
      if (ed.tipo === "cliente") await api.clientes.salvar({ ...(ed.id ? { id: ed.id } : {}), nome: d.nome.trim(), telefone: soDig(d.telefone), doc: soDig(d.doc), email: (d.email || "").trim(), endereco: (d.endereco || "").trim(), obs: (d.obs || "").trim() });
      else await api.veiculos.salvar({ ...(ed.id ? { id: ed.id } : {}), placa: normPlaca(d.placa), marca: d.marca.trim(), modelo: d.modelo.trim(), ano: String(d.ano), cor: (d.cor || "").trim(), motor: (d.motor || "").trim(), cliente_id: d.cliente_id || null });
      setEd(null); avisar("Cadastro salvo."); recarregar([ed.tipo === "cliente" ? "clientes" : "veiculos"]);
    } catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  const excluir = async () => {
    if (ed.tipo === "cliente") { const nv = dados.veiculos.filter(v => v.cliente_id === ed.id).length; if (nv) return setEd({ ...ed, erros: ["Este cliente tem " + nv + " veículo(s) vinculado(s). Transfira ou exclua o veículo antes."] }); }
    else { const no = dados.ordens.filter(o => o.veiculo_id === ed.id).length; if (no) return setEd({ ...ed, erros: ["Este veículo tem " + no + " O.S. no histórico e não pode ser excluído."] }); }
    if (!await confirmar({ titulo: "Excluir cadastro", texto: "Esta ação não pode ser desfeita.", botao: "Excluir", perigo: true })) return;
    try { await (ed.tipo === "cliente" ? api.clientes : api.veiculos).excluir(ed.id); setEd(null); avisar("Cadastro excluído."); recarregar([ed.tipo === "cliente" ? "clientes" : "veiculos"]); }
    catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  const historico = ed && ed.id ? dados.ordens.filter(o => ed.tipo === "cliente" ? o.cliente_id === ed.id : o.veiculo_id === ed.id) : [];
  const gasto = historico.filter(o => o.status === "entregue").reduce((s, o) => s + Number(o.total || 0), 0);

  return html`<div class="pagina">
    <${Abas} abas=${[["clientes", "Clientes (" + dados.clientes.length + ")"], ["veiculos", "Veículos (" + dados.veiculos.length + ")"]]} ativa=${aba} onTroca=${setAba} />
    <div class="linha-add"><input id="busca-cad" class="inp" aria-label="Buscar" placeholder=${aba === "clientes" ? "Buscar nome, telefone ou CPF" : "Buscar placa ou modelo"} value=${q} onInput=${e => setQ(e.target.value)} />
      ${podeCad ? html`<button type="button" class="btn btn-pri" onClick=${() => setEd(aba === "clientes" ? { tipo: "cliente", d: { nome: "", telefone: "", doc: "", email: "", endereco: "", obs: "" }, erros: [] } : { tipo: "veiculo", d: { placa: "", marca: "", modelo: "", ano: "", cor: "", motor: "", cliente_id: "" }, erros: [] })}>+ Novo</button>` : null}</div>
    <section class="card">
      ${aba === "clientes" ? (clientes.length ? html`<div class="lista">${clientes.map(c => html`<button type="button" key=${c.id} class="linha" onClick=${() => setEd({ tipo: "cliente", id: c.id, d: { ...c, telefone: fmtTel(c.telefone), doc: fmtDoc(c.doc) }, erros: [] })}>
          <span class="meio"><strong>${c.nome}</strong><span>${fmtTel(c.telefone)}${c.doc ? " · " + fmtDoc(c.doc) : ""}</span></span><span class="sub">${dados.veiculos.filter(v => v.cliente_id === c.id).length} veíc. · ${dados.ordens.filter(o => o.cliente_id === c.id).length} O.S.</span></button>`)}</div>`
          : html`<${Vazio}>Nenhum cliente. Eles também são cadastrados na entrada do veículo.</${Vazio}>`)
      : (veiculos.length ? html`<div class="lista">${veiculos.map(v => html`<button type="button" key=${v.id} class="linha" onClick=${() => setEd({ tipo: "veiculo", id: v.id, d: { ...v, cliente_id: v.cliente_id || "" }, erros: [] })}>
          <${Placa} placa=${v.placa} /><span class="meio"><strong>${v.marca} ${v.modelo} ${v.ano}</strong><span>${nomeCli(v.cliente_id)} · ${fmtKm(v.km_atual)}</span></span><span class="sub">${dados.ordens.filter(o => o.veiculo_id === v.id).length} O.S.</span></button>`)}</div>`
          : html`<${Vazio}>Nenhum veículo. Eles também são cadastrados na entrada.</${Vazio}>`)}
    </section>
    ${ed ? html`<${Modal} titulo=${(ed.id ? (podeCad ? "Editar " : "") : "Novo ") + (ed.tipo === "cliente" ? "cliente" : "veículo")} onFechar=${() => setEd(null)}>
      ${ed.erros.length ? html`<div class="erros">${ed.erros.join(" ")}</div>` : null}
      <fieldset disabled=${!podeCad} class="sem-borda">
      ${ed.tipo === "cliente" ? html`<div class="grade">
          <${Campo} id="e-nome" rotulo="Nome" obrig><${Texto} id="e-nome" valor=${ed.d.nome} onMuda=${v => set("nome", v)} /></${Campo}>
          <${Campo} id="e-tel" rotulo="Telefone / WhatsApp" obrig><input id="e-tel" class="inp" inputmode="tel" value=${ed.d.telefone} onBlur=${e => set("telefone", fmtTel(e.target.value))} onInput=${e => set("telefone", e.target.value)} /></${Campo}>
          <${Campo} id="e-doc" rotulo="CPF ou CNPJ"><input id="e-doc" class="inp" inputmode="numeric" value=${ed.d.doc} onBlur=${e => set("doc", fmtDoc(e.target.value))} onInput=${e => set("doc", e.target.value)} /></${Campo}>
          <${Campo} id="e-email" rotulo="E-mail"><${Texto} id="e-email" type="email" valor=${ed.d.email} onMuda=${v => set("email", v)} /></${Campo}>
          <${Campo} id="e-end" rotulo="Endereço"><${Texto} id="e-end" valor=${ed.d.endereco} onMuda=${v => set("endereco", v)} /></${Campo}>
          <${Campo} id="e-obs" rotulo="Observações"><${Texto} id="e-obs" valor=${ed.d.obs} onMuda=${v => set("obs", v)} /></${Campo}></div>`
      : html`<div class="grade">
          <${Campo} id="e-placa" rotulo="Placa" obrig><input id="e-placa" class="inp inp-placa" value=${exPlaca(normPlaca(ed.d.placa))} onInput=${e => set("placa", normPlaca(e.target.value))} /></${Campo}>
          <${Campo} id="e-marca" rotulo="Marca" obrig><${Texto} id="e-marca" valor=${ed.d.marca} onMuda=${v => set("marca", v)} /></${Campo}>
          <${Campo} id="e-modelo" rotulo="Modelo" obrig><${Texto} id="e-modelo" valor=${ed.d.modelo} onMuda=${v => set("modelo", v)} /></${Campo}>
          <${Campo} id="e-ano" rotulo="Ano" obrig><${Texto} id="e-ano" inputmode="numeric" valor=${ed.d.ano} onMuda=${v => set("ano", soDig(v).slice(0, 4))} /></${Campo}>
          <${Campo} id="e-cor" rotulo="Cor"><${Texto} id="e-cor" valor=${ed.d.cor} onMuda=${v => set("cor", v)} /></${Campo}>
          <${Campo} id="e-motor" rotulo="Motor"><${Texto} id="e-motor" valor=${ed.d.motor} onMuda=${v => set("motor", v)} /></${Campo}>
          <${Campo} id="e-cli" rotulo="Proprietário"><select id="e-cli" class="inp" value=${ed.d.cliente_id || ""} onChange=${e => set("cliente_id", e.target.value)}>
            <option value="">Sem cliente</option>${dados.clientes.map(c => html`<option key=${c.id} value=${c.id}>${c.nome}</option>`)}</select></${Campo}></div>
          ${ed.id ? html`<span class="dica">Último KM: ${fmtKm(ed.d.km_atual)}. Atualizado automaticamente na entrada e na entrega.</span>` : null}`}
      </fieldset>
      ${ed.id ? html`<div class="campo"><label>Histórico de O.S.${ver && gasto ? " · " + reais(gasto) + " em serviços entregues" : ""}</label>
        ${historico.length ? html`<div class="lista">${historico.map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => { setEd(null); ir("/os/" + o.id); }} />`)}</div>` : html`<span class="dica">Nenhuma O.S.</span>`}</div>` : null}
      <div class="acoes">${ed.id && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}<span class="espaco"></span>
        <button type="button" class="btn" onClick=${() => setEd(null)}>${podeCad ? "Cancelar" : "Fechar"}</button>${podeCad ? html`<button type="button" class="btn btn-pri" onClick=${salvar}>Salvar</button>` : null}</div>
    </${Modal}>` : null}
  </div>`;
}
