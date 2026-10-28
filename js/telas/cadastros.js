// Cadastros no modelo do OS Oficina 3.0: clientes (3 abas), veículos (ficha cadastral) e produtos/serviços
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Campo, Texto, Area, Seg, Abas, Modal, Vazio, I, Dinheiro, BuscaCliente } from "../ui.js";
import { soDig, norm, docValido, fmtDoc, fmtTel, normPlaca, placaValida, exPlaca, fmtKm, reais, fmtData, numOS, linkWhats, qtdFmt, hojeISO, endCompleto } from "../util.js";
import { pode, ABERTOS, SITUACAO_CLIENTE, COMBUSTIVEIS, ESTADO_CIVIL } from "../regras.js";
import { LinhaOS } from "./painel.js";
import { prepararNovaOS, ORIGENS } from "./entrada.js";
import { ProdutosLista } from "./produtos.js";
import { FornecedoresLista } from "./compras.js";

const DIA = 86400000;
const meses = iso => Math.floor((Date.now() - new Date(iso)) / (30.4 * DIA));
const dataDe = iso => iso ? String(iso).slice(0, 10) : "";
const quandoCadastro = (dataNova, original) => dataNova && dataNova !== dataDe(original) ? dataNova + "T12:00:00-03:00" : undefined;
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
export const SitCliente = ({ c }) => c && c.situacao && c.situacao !== "liberado" ? html`<span class=${"pill p-" + SITUACAO_CLIENTE[c.situacao].cor}>${SITUACAO_CLIENTE[c.situacao].t}</span>` : null;

/* =================== FICHA DO CLIENTE (formulário) =================== */
const FICHA_VAZIA = { sexo: "", estado_civil: "", pai: "", mae: "", naturalidade: "", nacionalidade: "", conjuge: "", escolaridade: "", profissao: "", trabalho: "", tel_trabalho: "", melhor_horario: "", renda: 0, limite: 0, avaliador: "", ocorrencia: "" };
const CLIENTE_VAZIO = { nome: "", fantasia: "", telefone: "", telefone2: "", telefone3: "", email: "", contato: "", doc: "", rg: "", orgao_emissor: "", ie: "", im: "", nascimento: "",
  rua: "", complemento: "", bairro: "", cidade: "Colatina", uf: "ES", cep: "", tipo_cliente: "", origem: "", situacao: "liberado", restricao: "", obs: "", historico: "", ficha: FICHA_VAZIA };
export const edCliente = c => c ? { tipo: "cliente", id: c.id, d: { ...CLIENTE_VAZIO, ...c, ficha: { ...FICHA_VAZIA, ...(c.ficha || {}) }, telefone: fmtTel(c.telefone), telefone2: fmtTel(c.telefone2), telefone3: fmtTel(c.telefone3), doc: fmtDoc(c.doc), data: dataDe(c.criado_em), nascimento: c.nascimento || "" }, erros: [] }
  : { tipo: "cliente", d: { ...CLIENTE_VAZIO, data: hojeISO() }, erros: [] };

export function FormCliente({ ed, setEd, onSalvo }) {
  const { dados, cfg, perfil, avisar, confirmar, recarregar, ir } = useApp();
  const [aba, setAba] = useState("end");
  const pode_ = pode(perfil, "cadastrar"), d = ed.d;
  const set = (k, v) => setEd(o => ({ ...o, erros: [], d: { ...o.d, [k]: v } }));
  const setF = (k, v) => setEd(o => ({ ...o, erros: [], d: { ...o.d, ficha: { ...o.d.ficha, [k]: v } } }));
  const T = (k, rot, extra = {}) => html`<${Campo} id=${"c-" + k} rotulo=${rot} obrig=${extra.obrig}><${Texto} id=${"c-" + k} valor=${d[k]} onMuda=${v => set(k, v)} ...${extra.attr || {}} /></${Campo}>`;
  const F = (k, rot, attr = {}) => html`<${Campo} id=${"f-" + k} rotulo=${rot}><${Texto} id=${"f-" + k} valor=${d.ficha[k]} onMuda=${v => setF(k, v)} ...${attr} /></${Campo}>`;
  const Tel = (k, rot, obrig) => html`<${Campo} id=${"c-" + k} rotulo=${rot} obrig=${obrig}><input id=${"c-" + k} class="inp" inputmode="tel" value=${d[k]} onBlur=${e => set(k, fmtTel(e.target.value))} onInput=${e => set(k, e.target.value)} /></${Campo}>`;
  const salvar = async () => {
    const erros = [];
    if (!d.nome.trim()) erros.push("Informe o nome ou a razão social.");
    const t = soDig(d.telefone); if (t && (t.length < 10 || t.length > 11)) erros.push("O telefone principal deve ter DDD + número.");
    if (!ed.id && !t) erros.push("Informe o telefone principal com DDD.");
    if (t && dados.clientes.some(c => c.id !== ed.id && soDig(c.telefone) === t)) erros.push("Este telefone já está cadastrado para outro cliente.");
    if (d.doc && !docValido(d.doc)) erros.push("CPF/CNPJ inválido.");
    if (d.doc && dados.clientes.some(c => c.id !== ed.id && soDig(c.doc) && soDig(c.doc) === soDig(d.doc))) erros.push("Já existe outro cliente com este CPF/CNPJ.");
    if (d.situacao !== "liberado" && !d.restricao.trim()) erros.push("Informe o motivo da " + (d.situacao === "bloqueado" ? "bloqueio" : "restrição") + ".");
    if (erros.length) return setEd({ ...ed, erros });
    const tx = k => String(d[k] || "").trim();
    const reg = { nome: tx("nome"), fantasia: tx("fantasia"), telefone: soDig(d.telefone), telefone2: soDig(d.telefone2).length >= 10 ? soDig(d.telefone2) : tx("telefone2"), telefone3: soDig(d.telefone3).length >= 10 ? soDig(d.telefone3) : tx("telefone3"),
      email: tx("email").toLowerCase(), contato: tx("contato"), doc: soDig(d.doc), rg: tx("rg"), orgao_emissor: tx("orgao_emissor").toUpperCase(), ie: tx("ie"), im: tx("im"), nascimento: d.nascimento || null,
      rua: tx("rua"), complemento: tx("complemento"), bairro: tx("bairro"), cidade: tx("cidade"), uf: tx("uf").toUpperCase().slice(0, 2), cep: tx("cep"), tipo_cliente: tx("tipo_cliente"), origem: d.origem || "",
      situacao: d.situacao, restricao: d.situacao === "liberado" ? "" : tx("restricao"), obs: tx("obs"), historico: tx("historico"),
      ficha: Object.fromEntries(Object.entries(d.ficha).filter(([, v]) => v !== "" && v !== 0 && v !== null)) };
    reg.endereco = endCompleto(reg);
    const quando = quandoCadastro(d.data, ed.id ? d.criado_em : ""); if (quando) reg.criado_em = quando;
    try {
      const r = await api.clientes.salvar({ ...(ed.id ? { id: ed.id } : {}), ...reg });
      setEd(null); avisar("Cliente salvo."); await recarregar(["clientes"]); onSalvo && onSalvo(r);
    } catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  const excluir = async () => {
    const nv = dados.veiculos.filter(v => v.cliente_id === ed.id).length; if (nv) return setEd({ ...ed, erros: ["Este cliente tem " + nv + " veículo(s) vinculado(s). Transfira ou exclua o veículo antes."] });
    if (dados.ordens.some(o => o.cliente_id === ed.id)) return setEd({ ...ed, erros: ["Este cliente tem O.S. no histórico e não pode ser excluído. Use a situação “Bloqueado”."] });
    if (!await confirmar({ titulo: "Excluir cliente", texto: "Esta ação não pode ser desfeita.", botao: "Excluir", perigo: true })) return;
    try { await api.clientes.excluir(ed.id); setEd(null); avisar("Cliente excluído."); recarregar(["clientes"], { completo: true }); } catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  const tipos = [...new Set([...(cfg.tiposCliente || []), ...dados.clientes.map(c => c.tipo_cliente).filter(Boolean)])].sort();
  return html`<${Modal} titulo=${ed.id ? "Cadastro de cliente" : "Novo cliente"} largo onFechar=${() => setEd(null)}>
    ${ed.erros.length ? html`<div class="erros">${ed.erros.join(" ")}</div>` : null}
    <fieldset disabled=${!pode_} class="sem-borda form-ficha">
      <div class="grade ficha-topo">
        <${Campo} id="c-codigo" rotulo="Código"><input id="c-codigo" class="inp" disabled value=${ed.id ? d.codigo : "automático"} /></${Campo}>
        <${Campo} id="c-data" rotulo="Data do cadastro"><input id="c-data" type="date" class="inp" value=${d.data || ""} onInput=${e => set("data", e.target.value)} /></${Campo}>
      </div>
      <div class="grade">
        ${T("nome", "Nome / razão social", { obrig: true })}
        ${T("fantasia", "Nome fantasia / apelido")}
        ${Tel("telefone", "Celular / WhatsApp", !ed.id)}
      </div>
      <div class="campo"><label>Situação do cadastro</label>
        <${Seg} rotulo="Situação" opcoes=${Object.entries(SITUACAO_CLIENTE).map(([, v]) => [v.t, v.cor])} valor=${SITUACAO_CLIENTE[d.situacao].t} onEscolha=${t => set("situacao", Object.keys(SITUACAO_CLIENTE).find(k => SITUACAO_CLIENTE[k].t === t))} />
        ${d.situacao !== "liberado" ? html`<span class="dica">${SITUACAO_CLIENTE[d.situacao].dica}</span>${T("restricao", "Motivo", { obrig: true })}` : null}</div>
      <${Abas} abas=${[["end", "Endereço e contatos"], ["fil", "Documentos, filiação e crédito"], ["obs", "Observações e histórico"]]} ativa=${aba} onTroca=${setAba} />
      ${aba === "end" ? html`<div class="aba-corpo">
        <div class="grade">${T("rua", "Endereço (rua e número)")}${T("complemento", "Complemento")}${T("bairro", "Bairro")}</div>
        <div class="grade">${T("cidade", "Cidade")}${T("uf", "UF", { attr: { maxlength: 2 } })}${T("cep", "CEP", { attr: { inputmode: "numeric" } })}</div>
        <div class="grade">${Tel("telefone2", "Telefone 2")}${Tel("telefone3", "Telefone 3")}${T("email", "E-mail", { attr: { type: "email" } })}${T("contato", "Pessoa de contato")}</div>
        <div class="grade">
          <${Campo} id="c-tipo" rotulo="Tipo de cliente"><${Texto} id="c-tipo" list="tipos-cli" valor=${d.tipo_cliente} onMuda=${v => set("tipo_cliente", v)} /><datalist id="tipos-cli">${tipos.map(t => html`<option value=${t} />`)}</datalist></${Campo}>
          <${Campo} id="c-origem" rotulo="Como conheceu a oficina"><select id="c-origem" class="inp" value=${d.origem} onChange=${e => set("origem", e.target.value)}><option value="">—</option>${ORIGENS.map(o => html`<option value=${o}>${o}</option>`)}</select></${Campo}>
        </div></div>`
      : aba === "fil" ? html`<div class="aba-corpo">
        <div class="grade">
          <${Campo} id="c-doc" rotulo="CPF ou CNPJ" erro=${d.doc && soDig(d.doc).length >= 11 && !docValido(d.doc) ? "Número inválido" : ""}><input id="c-doc" class="inp" inputmode="numeric" value=${d.doc} onBlur=${e => set("doc", fmtDoc(e.target.value))} onInput=${e => set("doc", e.target.value)} /></${Campo}>
          ${T("rg", "RG")}${T("orgao_emissor", "Órgão emissor")}${T("ie", "Inscrição estadual")}${T("im", "Inscrição municipal")}
          <${Campo} id="c-nasc" rotulo="Data de nascimento"><input id="c-nasc" type="date" class="inp" value=${d.nascimento || ""} onInput=${e => set("nascimento", e.target.value)} /></${Campo}>
        </div>
        <h4 class="sub-titulo">Filiação</h4>
        <div class="grade">
          <${Campo} id="f-sexo" rotulo="Sexo"><select id="f-sexo" class="inp" value=${d.ficha.sexo} onChange=${e => setF("sexo", e.target.value)}><option value="">—</option><option>Masculino</option><option>Feminino</option></select></${Campo}>
          <${Campo} id="f-civil" rotulo="Estado civil"><select id="f-civil" class="inp" value=${d.ficha.estado_civil} onChange=${e => setF("estado_civil", e.target.value)}><option value="">—</option>${ESTADO_CIVIL.map(x => html`<option>${x}</option>`)}</select></${Campo}>
          ${F("pai", "Nome do pai")}${F("mae", "Nome da mãe")}${F("conjuge", "Cônjuge")}${F("naturalidade", "Naturalidade")}${F("nacionalidade", "Nacionalidade")}${F("escolaridade", "Escolaridade")}
        </div>
        <h4 class="sub-titulo">Trabalho e avaliação financeira</h4>
        <div class="grade">
          ${F("profissao", "Profissão")}${F("trabalho", "Local de trabalho")}${F("tel_trabalho", "Telefone do trabalho", { inputmode: "tel" })}${F("melhor_horario", "Melhor horário para contato")}
          <${Campo} id="f-renda" rotulo="Renda / receita"><${Dinheiro} id="f-renda" valor=${d.ficha.renda} onMuda=${v => setF("renda", v)} /></${Campo}>
          <${Campo} id="f-limite" rotulo="Limite de crédito"><${Dinheiro} id="f-limite" valor=${d.ficha.limite} onMuda=${v => setF("limite", v)} /></${Campo}>
          ${F("avaliador", "Avaliado por")}
        </div></div>`
      : html`<div class="aba-corpo">
        <${Campo} id="c-obs" rotulo="Observações"><${Area} id="c-obs" valor=${d.obs} onMuda=${v => set("obs", v)} /></${Campo}>
        <${Campo} id="c-hist" rotulo="Histórico do cliente" dica="Anotações de atendimento, combinados e ocorrências."><${Area} id="c-hist" style=${{ minHeight: "140px" }} valor=${d.historico} onMuda=${v => set("historico", v)} /></${Campo}>
        ${F("ocorrencia", "Ocorrência")}</div>`}
    </fieldset>
    <div class="acoes">${ed.id && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}
      ${ed.id ? html`<button type="button" class="btn" onClick=${() => { setEd(null); ir("/imprimir/cliente/" + ed.id); }}>Imprimir ficha</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${() => setEd(null)}>${pode_ ? "Cancelar" : "Fechar"}</button>${pode_ ? html`<button type="button" class="btn btn-pri" onClick=${salvar}>Salvar cadastro</button>` : null}</div>
  </${Modal}>`;
}

/* =================== FICHA CADASTRAL DO VEÍCULO =================== */
const VEICULO_VAZIO = { placa: "", marca: "", modelo: "", ano_fab: "", ano_mod: "", cor: "", motor: "", combustivel: "", chassi: "", renavam: "", motorista: "", km_atual: "", cliente_id: "", obs: "",
  revisao_data: "", revisao_km: "", oleo_data: "", oleo_km: "", filtro_data: "", filtro_km: "" };
export const edVeiculo = (v, clienteId) => v ? { tipo: "veiculo", id: v.id, placaOriginal: v.placa, d: { ...VEICULO_VAZIO, ...Object.fromEntries(Object.entries(v).map(([k, x]) => [k, x ?? ""])), data: dataDe(v.criado_em) }, erros: [] }
  : { tipo: "veiculo", d: { ...VEICULO_VAZIO, cliente_id: clienteId || "", data: hojeISO() }, erros: [] };
export const anoVeiculo = (f, m) => { f = +f || 0; m = +m || 0; return f && m && f !== m ? `${f}/${m}` : String(m || f || ""); };

export function FormVeiculo({ ed, setEd, onSalvo }) {
  const { dados, perfil, avisar, confirmar, recarregar, ir } = useApp();
  const pode_ = pode(perfil, "cadastrar"), d = ed.d;
  const set = (k, v) => setEd(o => ({ ...o, erros: [], d: { ...o.d, [k]: v } }));
  const T = (k, rot, attr = {}, obrig) => html`<${Campo} id=${"v-" + k} rotulo=${rot} obrig=${obrig}><${Texto} id=${"v-" + k} valor=${d[k]} onMuda=${v => set(k, v)} ...${attr} /></${Campo}>`;
  const N = (k, rot, max = 7) => html`<${Campo} id=${"v-" + k} rotulo=${rot}><input id=${"v-" + k} class="inp" inputmode="numeric" value=${d[k] === "" || d[k] === null ? "" : Number(d[k]).toLocaleString("pt-BR").replace(/\./g, k.startsWith("ano") ? "" : ".")} onInput=${e => set(k, soDig(e.target.value).slice(0, max))} /></${Campo}>`;
  const D = (k, rot) => html`<${Campo} id=${"v-" + k} rotulo=${rot}><input id=${"v-" + k} type="date" class="inp" value=${d[k] || ""} onInput=${e => set(k, e.target.value)} /></${Campo}>`;
  const salvar = async () => {
    const erros = [], pl = normPlaca(d.placa), agora = new Date().getFullYear() + 1;
    if (!placaValida(pl) && !(ed.id && pl === ed.placaOriginal)) erros.push("Placa inválida (ABC1234 ou ABC1D23).");
    if (dados.veiculos.some(v => v.id !== ed.id && v.placa === pl)) erros.push("Placa já cadastrada.");
    if (!String(d.marca).trim() || !String(d.modelo).trim()) erros.push("Informe marca e modelo.");
    for (const k of ["ano_fab", "ano_mod"]) if (d[k] && !(+d[k] >= 1950 && +d[k] <= agora)) erros.push("Ano " + (k === "ano_fab" ? "de fabricação" : "do modelo") + " inválido.");
    if (d.chassi && String(d.chassi).replace(/\s/g, "").length !== 17) erros.push("O chassi tem 17 caracteres.");
    if (erros.length) return setEd({ ...ed, erros });
    const num = k => d[k] === "" || d[k] === null ? null : parseInt(soDig(d[k]), 10) || null;
    const reg = { placa: pl, marca: String(d.marca).trim(), modelo: String(d.modelo).trim(), ano_fab: num("ano_fab"), ano_mod: num("ano_mod") || num("ano_fab"), cor: String(d.cor).trim(), motor: String(d.motor).trim(),
      combustivel: d.combustivel || "", chassi: String(d.chassi).replace(/\s/g, "").toUpperCase(), renavam: soDig(d.renavam), motorista: String(d.motorista).trim(), km_atual: num("km_atual"),
      cliente_id: d.cliente_id || null, obs: String(d.obs).trim(), revisao_data: d.revisao_data || null, revisao_km: num("revisao_km"), oleo_data: d.oleo_data || null, oleo_km: num("oleo_km"), filtro_data: d.filtro_data || null, filtro_km: num("filtro_km") };
    reg.ano = anoVeiculo(reg.ano_fab, reg.ano_mod);
    const quando = quandoCadastro(d.data, ed.id ? d.criado_em : ""); if (quando) reg.criado_em = quando;
    try { const r = await api.veiculos.salvar({ ...(ed.id ? { id: ed.id } : {}), ...reg }); setEd(null); avisar("Veículo salvo."); await recarregar(["veiculos"]); onSalvo && onSalvo(r); }
    catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  const excluir = async () => {
    if (dados.ordens.some(o => o.veiculo_id === ed.id)) return setEd({ ...ed, erros: ["Este veículo tem O.S. no histórico e não pode ser excluído."] });
    if (!await confirmar({ titulo: "Excluir veículo", texto: "Esta ação não pode ser desfeita.", botao: "Excluir", perigo: true })) return;
    try { await api.veiculos.excluir(ed.id); setEd(null); avisar("Veículo excluído."); recarregar(["veiculos"], { completo: true }); } catch (e) { setEd({ ...ed, erros: [e.message] }); }
  };
  const marcas = useMemo(() => [...new Set(dados.veiculos.map(v => v.marca).filter(Boolean))].sort(), [dados.veiculos]);
  return html`<${Modal} titulo=${ed.id ? "Ficha cadastral do veículo" : "Novo veículo"} largo onFechar=${() => setEd(null)}>
    ${ed.erros.length ? html`<div class="erros">${ed.erros.join(" ")}</div>` : null}
    <fieldset disabled=${!pode_} class="sem-borda form-ficha">
      <div class="grade">
        <${Campo} id="v-placa" rotulo="Placa" obrig><input id="v-placa" class="inp inp-placa" value=${exPlaca(normPlaca(d.placa))} onInput=${e => set("placa", normPlaca(e.target.value))} /></${Campo}>
        ${N("ano_fab", "Ano fabricação", 4)}${N("ano_mod", "Ano modelo", 4)}${T("cor", "Cor")}
        <${Campo} id="v-data" rotulo="Data do cadastro"><input id="v-data" type="date" class="inp" value=${d.data || ""} onInput=${e => set("data", e.target.value)} /></${Campo}>
      </div>
      <div class="campo"><label for="v-dono">Proprietário</label><${BuscaCliente} id="v-dono" valor=${d.cliente_id} onEscolha=${v => set("cliente_id", v)} /></div>
      <div class="grade">
        ${T("motorista", "Motorista / condutor")}
        <${Campo} id="v-marca" rotulo="Marca" obrig><${Texto} id="v-marca" list="marcas-v" valor=${d.marca} onMuda=${v => set("marca", v)} /><datalist id="marcas-v">${marcas.map(m => html`<option value=${m} />`)}</datalist></${Campo}>
        ${T("modelo", "Modelo", {}, true)}${T("motor", "Motor", { placeholder: "ex.: 1.0 8V" })}
        ${T("chassi", "Chassi", { maxlength: 20, style: { textTransform: "uppercase" } })}${T("renavam", "Renavam", { inputmode: "numeric" })}${N("km_atual", "KM atual")}
      </div>
      <div class="campo"><label>Combustível</label><${Seg} rotulo="Combustível" opcoes=${COMBUSTIVEIS.map(c => [c, "info"])} valor=${d.combustivel} onEscolha=${v => set("combustivel", v)} /></div>
      <h4 class="sub-titulo">Manutenção programada</h4>
      <div class="grade grade-manut">
        ${D("revisao_data", "Revisão: data")}${N("revisao_km", "Revisão: KM")}
        ${D("oleo_data", "Troca de óleo: data")}${N("oleo_km", "Troca de óleo: KM")}
        ${D("filtro_data", "Troca de filtros: data")}${N("filtro_km", "Troca de filtros: KM")}
      </div>
      <${Campo} id="v-obs" rotulo="Observações"><${Area} id="v-obs" valor=${d.obs} onMuda=${v => set("obs", v)} /></${Campo}>
    </fieldset>
    <div class="acoes">${ed.id && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}
      ${ed.id ? html`<button type="button" class="btn" onClick=${() => { setEd(null); ir("/veiculo/" + ed.id); }}>Serviços executados</button><button type="button" class="btn" onClick=${() => { setEd(null); ir("/imprimir/veiculo/" + ed.id); }}>Imprimir ficha</button>` : null}
      <span class="espaco"></span><button type="button" class="btn" onClick=${() => setEd(null)}>${pode_ ? "Cancelar" : "Fechar"}</button>${pode_ ? html`<button type="button" class="btn btn-pri" onClick=${salvar}>Salvar cadastro</button>` : null}</div>
  </${Modal}>`;
}

/** compatibilidade: abre o formulário certo pelo tipo */
export function FormCadastro(p) { return p.ed.tipo === "cliente" ? html`<${FormCliente} ...${p} />` : html`<${FormVeiculo} ...${p} />`; }

/* =================== LISTAS =================== */
export function Cadastros({ params }) {
  const { dados, perfil, cfg, ir } = useApp();
  const [aba, setAba] = useState(params && ["veiculos", "produtos", "fornecedores"].includes(params.aba) ? params.aba : "clientes");
  const [q, setQ] = useState(""), [ed, setEd] = useState(null);
  const [filtro, setFiltro] = useState(params && params.filtro === "recuperar" ? "recuperar" : "todos"), [ordem, setOrdem] = useState(params && params.filtro === "recuperar" ? "ultima" : "nome");
  const [lim, setLim] = useState(80);
  const podeCad = pode(perfil, "cadastrar"), ver = pode(perfil, "verValores");
  const res = useMemo(() => resumoClientes(dados.ordens), [dados.ordens]);
  const n = norm(q), qd = soDig(q), p = normPlaca(q);
  const clientes = useMemo(() => {
    let l = dados.clientes.filter(c => !n || norm(c.nome).includes(n) || norm(c.fantasia).includes(n) || (qd && String(c.codigo) === qd) || (qd.length >= 3 && (soDig(c.telefone).includes(qd) || soDig(c.doc).includes(qd))) || (p.length >= 3 && dados.veiculos.some(v => v.cliente_id === c.id && v.placa.includes(p))));
    if (filtro === "aberta") l = l.filter(c => (res.get(c.id) || {}).aberta);
    if (filtro === "recuperar") l = l.filter(c => { const r = res.get(c.id); if (!r || r.aberta || !r.ultima) return false; const d = (Date.now() - new Date(r.ultima)) / DIA; return d >= 180 && d <= 730; });
    if (filtro === "semtel") l = l.filter(c => soDig(c.telefone).length < 10);
    if (filtro === "restricao") l = l.filter(c => c.situacao && c.situacao !== "liberado");
    const g = c => res.get(c.id) || { gasto: 0, ultima: "" };
    if (ordem === "ultima") l = [...l].sort((a, b) => (g(b).ultima || "").localeCompare(g(a).ultima || ""));
    else if (ordem === "gasto") l = [...l].sort((a, b) => g(b).gasto - g(a).gasto);
    else if (ordem === "codigo") l = [...l].sort((a, b) => (a.codigo || 0) - (b.codigo || 0));
    else l = [...l].sort((a, b) => a.nome.localeCompare(b.nome));
    return l;
  }, [dados.clientes, dados.veiculos, res, q, filtro, ordem]);
  const veiculos = useMemo(() => dados.veiculos.filter(v => !n || (p.length >= 3 && v.placa.includes(p)) || norm(v.modelo).includes(n) || norm(v.marca).includes(n) || (v.chassi && v.chassi.includes(q.toUpperCase().trim()))).sort((a, b) => a.placa.localeCompare(b.placa)), [dados.veiculos, q]);
  useEffect(() => setLim(80), [q, filtro, ordem, aba]);
  const nomeCli = id => (dados.clientes.find(c => c.id === id) || {}).nome || "Sem proprietário";
  const exportar = () => {
    const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"';
    const linhas = [["Código", "Nome", "Fantasia", "Telefone", "Telefone 2", "CPF/CNPJ", "RG", "E-mail", "Endereço", "Bairro", "Cidade", "UF", "CEP", "Nascimento", "Tipo", "Situação", "Origem", "Veículos", "O.S.", "Total gasto", "Última visita"].map(esc).join(";")];
    for (const c of clientes) { const r = res.get(c.id) || { n: 0, gasto: 0, ultima: "" };
      linhas.push([c.codigo, c.nome, c.fantasia, fmtTel(c.telefone), fmtTel(c.telefone2), fmtDoc(c.doc), c.rg, c.email, [c.rua, c.complemento].filter(Boolean).join(" ") || c.endereco, c.bairro, c.cidade, c.uf, c.cep, c.nascimento ? fmtData(c.nascimento) : "", c.tipo_cliente, (SITUACAO_CLIENTE[c.situacao] || {}).t, c.origem,
        dados.veiculos.filter(v => v.cliente_id === c.id).map(v => v.placa).join(" "), r.n, String(r.gasto.toFixed(2)).replace(".", ","), r.ultima ? fmtData(r.ultima) : ""].map(esc).join(";")); }
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "clientes-dtcar-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  const chamar = c => { const r = res.get(c.id); const v = dados.veiculos.find(x => x.cliente_id === c.id); window.open(linkWhats(c.telefone, msgRetorno(c, v, cfg, r.ultima)), "_blank", "noopener"); };
  const trocarAba = a => { setAba(a); setQ(""); };

  return html`<div class="pagina">
    <${Abas} abas=${[["clientes", "Clientes (" + dados.clientes.length + ")"], ["veiculos", "Veículos (" + dados.veiculos.length + ")"], ["produtos", "Produtos (" + dados.produtos.filter(x => x.ativo !== false).length + ")"], ["fornecedores", "Fornecedores (" + dados.fornecedores.length + ")"]]} ativa=${aba} onTroca=${trocarAba} />
    ${aba === "produtos" ? html`<${ProdutosLista} />` : aba === "fornecedores" ? html`<${FornecedoresLista} />` : html`
    <div class="linha-add"><input id="busca-cad" class="inp" aria-label="Buscar" placeholder=${aba === "clientes" ? "Nome, código, telefone, CPF ou placa" : "Placa, marca, modelo ou chassi"} value=${q} onInput=${e => setQ(e.target.value)} />
      ${podeCad ? html`<button type="button" class="btn btn-pri" onClick=${() => setEd(aba === "clientes" ? edCliente() : edVeiculo())}>+ Novo</button>` : null}</div>
    ${aba === "clientes" ? html`
      <div class="filtros">
        <div class="chips rolagem">${[["todos", "Todos"], ["aberta", "Com O.S. aberta"], ["recuperar", "Para recuperar"], ["semtel", "Sem telefone"], ["restricao", "Restritos e bloqueados"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (filtro === k ? " ativo" : "")} onClick=${() => setFiltro(k)}>${t}</button>`)}</div>
        <select class="inp inp-curto" aria-label="Ordenar" value=${ordem} onChange=${e => setOrdem(e.target.value)}><option value="nome">Nome A–Z</option><option value="codigo">Código</option><option value="ultima">Última visita</option>${ver ? html`<option value="gasto">Maior gasto</option>` : null}</select>
      </div>
      ${filtro === "recuperar" ? html`<div class="info">Clientes com última visita entre 6 meses e 2 anos e sem O.S. aberta. Use o botão de WhatsApp para enviar um convite de revisão.</div>` : null}
      <section class="card"><div class="secao-topo"><h3>${clientes.length} cliente(s)</h3>${ver ? html`<button type="button" class="btn btn-sm" onClick=${exportar}>Exportar planilha</button>` : null}</div>
        ${clientes.length ? html`<div class="lista">${clientes.slice(0, lim).map(c => { const r = res.get(c.id) || { n: 0, gasto: 0, ultima: "" }; return html`<div class="linha linha-cli" key=${c.id}>
          <span class="cod">${c.codigo ?? ""}</span>
          <button type="button" class="meio botao-limpo" onClick=${() => ir("/cliente/" + c.id)}><strong>${c.nome} <${SitCliente} c=${c} /></strong><span>${c.telefone ? fmtTel(c.telefone) : "sem telefone"}${c.fantasia ? " · " + c.fantasia : ""}${r.ultima ? " · última visita " + fmtData(r.ultima) : " · sem O.S."}</span></button>
          <span class="dir">${ver && r.gasto ? html`<b>${reais(r.gasto)}</b>` : null}<small>${r.n} O.S.</small></span>
          ${filtro === "recuperar" && soDig(c.telefone).length >= 10 ? html`<button type="button" class="btn btn-sm btn-whats" aria-label=${"WhatsApp para " + c.nome} onClick=${() => chamar(c)}>${I.whats}</button>` : null}</div>`; })}</div>
          ${clientes.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 200)}>Mostrar mais (${clientes.length - lim})</button>` : null}`
          : html`<${Vazio}>Nenhum cliente encontrado.</${Vazio}>`}
      </section>`
    : html`<section class="card"><h3>${veiculos.length} veículo(s)</h3>
        ${veiculos.length ? html`<div class="lista">${veiculos.slice(0, lim).map(v => html`<button type="button" key=${v.id} class="linha" onClick=${() => ir("/veiculo/" + v.id)}>
          <${Placa} placa=${v.placa} /><span class="meio"><strong>${v.marca} ${v.modelo} ${v.ano}</strong><span>${nomeCli(v.cliente_id)} · ${fmtKm(v.km_atual)}${v.combustivel ? " · " + v.combustivel : ""}</span></span><span class="sub">${dados.ordens.filter(o => o.veiculo_id === v.id).length} O.S.</span></button>`)}</div>
          ${veiculos.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 200)}>Mostrar mais (${veiculos.length - lim})</button>` : null}`
          : html`<${Vazio}>Nenhum veículo encontrado.</${Vazio}>`}</section>`}`}
    ${ed ? html`<${FormCadastro} ed=${ed} setEd=${setEd} onSalvo=${r => r && r.id && ir((ed.tipo === "cliente" ? "/cliente/" : "/veiculo/") + r.id)} />` : null}
  </div>`;
}

/* =================== FICHA DO CLIENTE (visualização) =================== */
export function ClienteTela({ id }) {
  const { dados, perfil, ir } = useApp();
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
  const f = c.ficha || {};
  const kv = (rot, v) => v ? html`<div><span>${rot}</span><b>${v}</b></div>` : null;
  const tels = [c.telefone, c.telefone2, c.telefone3].filter(Boolean).map(fmtTel).join(" · ");
  return html`<div class="pagina">
    <button type="button" class="btn-link voltar" onClick=${() => history.length > 1 ? history.back() : ir("/cadastros")}>← Voltar</button>
    <section class="card">
      <div class="ficha-cab"><div class="meio"><span class="sub">Cliente cód. ${c.codigo ?? "—"}${c.tipo_cliente ? " · " + c.tipo_cliente : ""}</span><h2>${c.nome} <${SitCliente} c=${c} /></h2>${c.fantasia ? html`<span class="sub">${c.fantasia}</span>` : null}</div>
        <div class="acoes">${soDig(c.telefone).length >= 10 ? html`<a class="btn btn-sm btn-whats" href=${linkWhats(c.telefone, "Olá, " + c.nome.split(" ")[0] + "! ")} target="_blank" rel="noopener">${I.whats} WhatsApp</a>` : null}
          <button type="button" class="btn btn-sm" onClick=${() => ir("/imprimir/cliente/" + c.id)}>Imprimir ficha</button>
          <button type="button" class="btn btn-sm" onClick=${() => setEd(edCliente(c))}>${pode(perfil, "cadastrar") ? "Editar cadastro" : "Ver cadastro"}</button></div></div>
      ${c.situacao && c.situacao !== "liberado" ? html`<div class=${c.situacao === "bloqueado" ? "erros" : "aviso"}><b>Cadastro ${SITUACAO_CLIENTE[c.situacao].t.toLowerCase()}:</b> ${c.restricao || "motivo não informado"}</div>` : null}
      <div class="kv">
        ${kv("Telefones", tels || "sem telefone")}${kv("CPF/CNPJ", c.doc ? fmtDoc(c.doc) : "")}${kv("RG", [c.rg, c.orgao_emissor].filter(Boolean).join(" "))}${kv("E-mail", c.email)}${kv("Contato", c.contato)}
        ${kv("Nascimento", c.nascimento ? fmtData(c.nascimento) : "")}${kv("Profissão", f.profissao)}${kv("Como conheceu", c.origem)}${kv("Cliente desde", fmtData(c.criado_em))}
        ${ver ? html`${kv("Total em serviços", reais(gasto))}${kv("Ticket médio", reais(entregues.length ? gasto / entregues.length : 0))}${f.limite ? kv("Limite de crédito", reais(f.limite)) : null}` : null}
        ${kv("O.S.", String(os.length))}${kv("Última visita", ultima ? fmtData(ultima) : "—")}
      </div>
      ${endCompleto(c) ? html`<div><span class="sub">Endereço</span><div>${endCompleto(c)}</div></div>` : null}
      ${c.obs ? html`<div><span class="sub">Observações</span><div class="texto-pre">${c.obs}</div></div>` : null}
      ${c.historico ? html`<details><summary class="sub">Histórico do cliente</summary><div class="texto-pre">${c.historico}</div></details>` : null}
    </section>
    <section class="card"><div class="secao-topo"><h3>Veículos (${veics.length})</h3>${pode(perfil, "cadastrar") ? html`<button type="button" class="btn btn-sm" onClick=${() => setEd(edVeiculo(null, id))}>+ Veículo</button>` : null}</div>
      ${veics.length ? html`<div class="lista">${veics.map(v => html`<div class="linha" key=${v.id}><${Placa} placa=${v.placa} />
        <button type="button" class="meio botao-limpo" onClick=${() => ir("/veiculo/" + v.id)}><strong>${v.marca} ${v.modelo} ${v.ano}</strong><span>${fmtKm(v.km_atual)} · ${dados.ordens.filter(o => o.veiculo_id === v.id).length} O.S.</span></button>
        ${pode(perfil, "entrada") && c.situacao !== "bloqueado" ? html`<button type="button" class="btn btn-sm" onClick=${() => novaOS(v)}>Nova O.S.</button>` : null}</div>`)}</div>` : html`<span class="dica">Nenhum veículo vinculado.</span>`}</section>
    <section class="card"><h3>Histórico de O.S.</h3>
      ${os.length ? html`<div class="lista">${os.map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div>` : html`<span class="dica">Nenhuma O.S.</span>`}</section>
    ${ed ? html`<${FormCadastro} ed=${ed} setEd=${setEd} />` : null}
  </div>`;
}

/* =================== FICHA DO VEÍCULO (visualização e serviços executados) =================== */
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
  const kv = (rot, x) => x ? html`<div><span>${rot}</span><b>${x}</b></div>` : null;
  const manut = [["Revisão", v.revisao_data, v.revisao_km], ["Troca de óleo", v.oleo_data, v.oleo_km], ["Troca de filtros", v.filtro_data, v.filtro_km]].filter(m => m[1] || m[2]);
  return html`<div class="pagina">
    <button type="button" class="btn-link voltar" onClick=${() => history.length > 1 ? history.back() : ir("/cadastros")}>← Voltar</button>
    <section class="card">
      <div class="det-cab"><${Placa} placa=${v.placa} grande /><div class="meio"><h2>${v.marca} ${v.modelo}</h2><div class="sub">${[v.ano, v.cor, v.motor, v.combustivel].filter(Boolean).join(" · ")}</div></div>
        <div class="acoes"><button type="button" class="btn btn-sm" onClick=${() => ir("/imprimir/veiculo/" + v.id)}>Imprimir ficha</button><button type="button" class="btn btn-sm" onClick=${() => setEd(edVeiculo(v))}>${pode(perfil, "cadastrar") ? "Editar ficha" : "Ver ficha"}</button></div></div>
      <div class="kv">${kv("KM atual", fmtKm(v.km_atual))}<div><span>Proprietário</span><b>${dono ? html`<button type="button" class="btn-link" onClick=${() => ir("/cliente/" + dono.id)}>${dono.nome}</button>` : "—"}</b></div>
        ${kv("Motorista", v.motorista)}${kv("Chassi", v.chassi)}${kv("Renavam", v.renavam)}${kv("O.S.", String(os.length))}${ver ? kv("Total em serviços", reais(entregues.reduce((s, o) => s + Number(o.total || 0), 0))) : null}</div>
      ${manut.length ? html`<div class="kv">${manut.map(([t, d, k]) => html`<div key=${t}><span>${t}</span><b>${[d ? fmtData(d) : "", k ? fmtKm(k) : ""].filter(Boolean).join(" · ")}</b></div>`)}</div>` : null}
      ${v.obs ? html`<div class="texto-pre sub">${v.obs}</div>` : null}
      ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri" onClick=${() => { prepararNovaOS(v); ir("/entrada"); }}>+ Nova O.S. para este veículo</button>` : null}
    </section>
    ${os.filter(o => o.status !== "entregue").length ? html`<section class="card"><h3>Em andamento e outras</h3><div class="lista">${os.filter(o => o.status !== "entregue").map(o => html`<${LinhaOS} key=${o.id} o=${o} verValores=${ver} onClick=${() => ir("/os/" + o.id)} />`)}</div></section>` : null}
    <section class="card"><h3>Serviços executados</h3>
      ${!entregues.length ? html`<span class="dica">Nenhum serviço entregue ainda.</span>` : !itens ? html`<span class="dica">Carregando…</span>`
      : html`<ol class="historico-vei">${entregues.map(o => html`<li key=${o.id}>
          <div class="hv-cab"><button type="button" class="btn-link" onClick=${() => ir("/os/" + o.id)}>${numOS(o.numero)}</button><span>${fmtData(o.entregue_em)}</span><span>${o.km_entrada ? fmtKm(o.km_entrada) : "KM não informado"}</span>${ver ? html`<b>${reais(o.total)}</b>` : null}</div>
          <ul>${(porOS.get(o.id) || []).map((i, n) => html`<li key=${n} class=${"hv-" + i.tipo}>${i.descricao}${i.tipo === "peca" && Number(i.qtd) !== 1 ? " (" + qtdFmt(i.qtd) + ")" : ""}</li>`)}</ul></li>`)}</ol>`}
    </section>
    ${ed ? html`<${FormCadastro} ed=${ed} setEd=${setEd} />` : null}
  </div>`;
}
