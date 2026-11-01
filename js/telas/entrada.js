// Abertura rápida de O.S. e checklist de entrada (opcional, feito a partir da O.S.)
import { html, useState, useEffect, useRef, useCallback } from "../lib.js";
import { api, estaSemRede } from "../api.js";
import { fila, servidorResponde } from "../fila.js";
import { local, erroDeRede } from "../local.js";
import { useApp, Placa, Campo, Texto, Area, Seg, Abas, SecaoChecklist, PadAssinatura, Foto } from "../ui.js";
import { soDig, norm, uuid, docValido, fmtDoc, fmtTel, normPlaca, placaValida, exPlaca, fmtKm, fmtDataHora, lsGet, lsSet, reduzirImagem, numOS, endCompleto } from "../util.js";
import { SECOES_CHECKLIST, SECOES_EXTERNO, COMBUSTIVEL, COMBUSTIVEIS, SLOTS_FOTO, SLOTS_OBRIG, extrasDe, secoesCheckin, achados, termoEntradaFinal } from "../regras.js";

export const LS_NOVA = "dtcar-nova-os-v1";
export const ORIGENS = ["Indicação", "Cliente antigo", "Google", "Instagram / Facebook", "Passou em frente", "Outro"];

function vazioNova() {
  return { placa: "", veiculoId: "", vNovo: { marca: "", modelo: "", ano: "", cor: "", motor: "", combustivel: "" }, clienteId: "", modoCliente: "busca",
    cNovo: { nome: "", telefone: "", doc: "", endereco: "", bairro: "", origem: "" }, buscaCliente: "", km: "", kmConfirmado: false, reclamacao: "", consultorId: "", box: "", contato: "" };
}
/** Deixa a Nova O.S. pré-preenchida com um veículo (usado em Cadastros) */
export function prepararNovaOS(v) { lsSet(LS_NOVA, { ...vazioNova(), placa: v.placa, veiculoId: v.id, clienteId: v.cliente_id || "" }); }

function validarNova(f, dados) {
  const e = [], v = dados.veiculos.find(x => x.id === f.veiculoId);
  if (!placaValida(f.placa)) e.push("Informe uma placa válida (ABC1234 ou ABC1D23).");
  if (!f.veiculoId && placaValida(f.placa)) {
    if (!f.vNovo.marca.trim()) e.push("Informe a marca do veículo.");
    if (!f.vNovo.modelo.trim()) e.push("Informe o modelo do veículo.");
    const ano = +f.vNovo.ano; if (!(ano >= 1950 && ano <= new Date().getFullYear() + 1)) e.push("Informe o ano do veículo com 4 dígitos.");
  }
  const cli = dados.clientes.find(c => c.id === f.clienteId);
  if (cli && cli.situacao === "bloqueado") e.push("Cliente bloqueado: " + (cli.restricao || "verifique o cadastro") + ". Não é possível abrir O.S.");
  if (!f.clienteId) {
    if (f.modoCliente !== "novo") e.push("Selecione um cliente ou cadastre um novo.");
    else {
      if (!f.cNovo.nome.trim()) e.push("Informe o nome do cliente.");
      const t = soDig(f.cNovo.telefone); if (t.length < 10 || t.length > 11) e.push("Informe o telefone com DDD.");
      else { const dupT = dados.clientes.find(c => soDig(c.telefone) === t); if (dupT) e.push("Este telefone já está cadastrado para " + dupT.nome + ". Selecione-o na busca."); }
      if (f.cNovo.doc.trim()) {
        if (!docValido(f.cNovo.doc)) e.push("CPF/CNPJ inválido. Confira os dígitos ou deixe em branco.");
        else { const dup = dados.clientes.find(c => soDig(c.doc) === soDig(f.cNovo.doc)); if (dup) e.push("Já existe um cliente com este CPF/CNPJ: " + dup.nome + ". Selecione-o na busca."); }
      }
    }
  }
  const km = parseInt(soDig(f.km), 10);
  if (f.km === "" || !(km >= 0)) e.push("Informe o KM de entrada.");
  else if (v && v.km_atual && km < v.km_atual && !f.kmConfirmado) e.push("O KM informado é menor que o último registrado (" + fmtKm(v.km_atual) + "). Confira o painel ou confirme a divergência.");
  if (!f.reclamacao.trim()) e.push("Descreva o motivo da visita ou a reclamação do cliente.");
  if (!f.consultorId) e.push("Selecione o consultor responsável.");
  return e;
}

/* =================== NOVA O.S. =================== */
export function NovaOS() {
  const { dados, cfg, perfil, avisar, confirmar, ir, recarregar, atualizarPendentes } = useApp();
  const consultores = dados.perfis.filter(p => p.ativo !== false && (p.papel === "admin" || p.papel === "consultor"));
  const [f, setF] = useState(() => { const r = lsGet(LS_NOVA); return r && r.vNovo ? { ...vazioNova(), ...r } : vazioNova(); });
  const [erros, setErros] = useState([]);
  const [salvando, setSalvando] = useState("");
  const topo = useRef(null);
  useEffect(() => { lsSet(LS_NOVA, f); }, [f]);
  useEffect(() => { if (!f.consultorId && consultores.some(c => c.id === perfil.id)) setF(o => ({ ...o, consultorId: perfil.id })); }, [dados.perfis]);
  const muda = p => setF(o => ({ ...o, ...p }));
  const veiculo = dados.veiculos.find(v => v.id === f.veiculoId);
  const cliente = dados.clientes.find(c => c.id === f.clienteId);
  const abertaDoVeiculo = veiculo ? dados.ordens.find(o => o.veiculo_id === veiculo.id && ["diagnostico", "aguardando", "execucao", "pronto"].includes(o.status)) : null;

  const descartar = async () => { if (!await confirmar({ titulo: "Limpar formulário", texto: "Os dados preenchidos serão apagados.", botao: "Limpar", perigo: true })) return; lsSet(LS_NOVA, null); setF(vazioNova()); setErros([]); };
  const abrir = async (comChecklist) => {
    const e = validarNova(f, dados); setErros(e);
    if (e.length) { topo.current && topo.current.scrollIntoView({ behavior: "smooth" }); return; }
    if (abertaDoVeiculo && !await confirmar({ titulo: "Veículo com O.S. aberta", texto: `Este veículo já tem a ${numOS(abertaDoVeiculo.numero)} em andamento. Abrir outra O.S. mesmo assim?`, botao: "Abrir outra" })) return;
    setSalvando(comChecklist ? "ck" : "os");
    if (atualizarPendentes && !(await servidorResponde(api))) { await abrirSemInternet(); setSalvando(""); return; }
    try {
      let cli = cliente, cliId = f.clienteId;
      if (!cliId) { const rua = f.cNovo.endereco.trim(), bairro = (f.cNovo.bairro || "").trim();
        cli = await api.clientes.salvar({ nome: f.cNovo.nome.trim(), telefone: soDig(f.cNovo.telefone), doc: soDig(f.cNovo.doc), rua, bairro, cidade: "Colatina", uf: "ES",
          endereco: [rua, bairro, "Colatina/ES"].filter(Boolean).join(", "), origem: f.cNovo.origem || "" }); cliId = cli.id; }
      const km = parseInt(soDig(f.km), 10);
      let vei = veiculo;
      if (!vei) vei = await api.veiculos.salvar({ placa: f.placa, marca: f.vNovo.marca.trim(), modelo: f.vNovo.modelo.trim(), ano: String(f.vNovo.ano), ano_fab: +f.vNovo.ano || null, ano_mod: +f.vNovo.ano || null,
        cor: f.vNovo.cor.trim(), motor: f.vNovo.motor.trim(), combustivel: f.vNovo.combustivel || "", cliente_id: cliId, km_atual: km });
      else vei = await api.veiculos.salvar({ id: vei.id, cliente_id: cliId, km_atual: Math.max(km, vei.km_atual || 0) });
      const cons = consultores.find(c => c.id === f.consultorId);
      const ordem = await api.criarOrdem({
        status: "diagnostico", cliente_id: cliId, veiculo_id: vei.id,
        cliente: { nome: cli.nome, telefone: cli.telefone || "", doc: cli.doc || "", endereco: endCompleto(cli) },
        veiculo: { placa: vei.placa, marca: vei.marca, modelo: vei.modelo, ano: vei.ano, cor: vei.cor || "", motor: vei.combustivel || vei.motor || "" },
        km_entrada: km, reclamacao: f.reclamacao.trim(), box: (f.box || "").trim(), contato: (f.contato || "").trim(),
        checkin: { feito: false, kmAnterior: veiculo ? veiculo.km_atual : null, kmDivergente: !!(veiculo && veiculo.km_atual && km < veiculo.km_atual) },
        consultor_id: f.consultorId, consultor_nome: cons ? cons.nome : "",
        garantia_dias: Number(cfg.garantiaDias) || 90, condicoes_pagamento: cfg.condicoesPadrao || "",
      });
      await api.evento(ordem.id, "abertura", "O.S. aberta com " + fmtKm(km) + ".", perfil.nome);
      lsSet(LS_NOVA, null); setF(vazioNova());
      await recarregar(["clientes", "veiculos", "ordens"]);
      avisar(numOS(ordem.numero) + " aberta.");
      ir("/os/" + ordem.id + (comChecklist ? "/checklist" : ""));
    } catch (x) { avisar("Não foi possível abrir a O.S.: " + x.message, true); } finally { setSalvando(""); }
  };

  /** Sem internet: a O.S. vai para a fila com número provisório; o servidor numera quando a conexão voltar */
  const abrirSemInternet = async () => {
    try {
      const agora = new Date().toISOString(), ordemId = uuid(), prov = fila.proximoProvisorio();
      let cli = cliente, cliId = f.clienteId, novoCli = null;
      if (!cliId) { const rua = f.cNovo.endereco.trim(), bairro = (f.cNovo.bairro || "").trim(); cliId = uuid();
        novoCli = { id: cliId, nome: f.cNovo.nome.trim(), telefone: soDig(f.cNovo.telefone), doc: soDig(f.cNovo.doc), rua, bairro, cidade: "Colatina", uf: "ES",
          endereco: [rua, bairro, "Colatina/ES"].filter(Boolean).join(", "), origem: f.cNovo.origem || "" }; cli = novoCli; }
      const km = parseInt(soDig(f.km), 10);
      let vei = veiculo, novoVei = null, veiAtual = null;
      if (!vei) { novoVei = { id: uuid(), placa: f.placa, marca: f.vNovo.marca.trim(), modelo: f.vNovo.modelo.trim(), ano: String(f.vNovo.ano), ano_fab: +f.vNovo.ano || null, ano_mod: +f.vNovo.ano || null,
        cor: f.vNovo.cor.trim(), motor: f.vNovo.motor.trim(), combustivel: f.vNovo.combustivel || "", cliente_id: cliId, km_atual: km }; vei = novoVei; }
      else veiAtual = { id: vei.id, cliente_id: cliId, km_atual: Math.max(km, vei.km_atual || 0) };
      const cons = consultores.find(c => c.id === f.consultorId);
      const ordem = {
        id: ordemId, criado_em: agora, status: "diagnostico", cliente_id: cliId, veiculo_id: vei.id,
        cliente: { nome: cli.nome, telefone: cli.telefone || "", doc: cli.doc || "", endereco: endCompleto(cli) },
        veiculo: { placa: vei.placa, marca: vei.marca, modelo: vei.modelo, ano: vei.ano, cor: vei.cor || "", motor: vei.combustivel || vei.motor || "" },
        km_entrada: km, reclamacao: f.reclamacao.trim(), box: (f.box || "").trim(), contato: (f.contato || "").trim(),
        checkin: { feito: false, kmAnterior: veiculo ? veiculo.km_atual : null, kmDivergente: !!(veiculo && veiculo.km_atual && km < veiculo.km_atual), offline: { provisorio: prov, aberta_em: agora } },
        consultor_id: f.consultorId, consultor_nome: cons ? cons.nome : "",
        garantia_dias: Number(cfg.garantiaDias) || 90, condicoes_pagamento: cfg.condicoesPadrao || "",
      };
      await fila.adicionar({ id: ordemId, tipo: "abrir_os", criado_em: agora, provisorio: prov, usuario_nome: perfil.nome, cliente: novoCli, veiculo: novoVei, veiculoAtualizar: veiAtual, ordem,
        eventos: [{ tipo: "abertura", texto: "O.S. aberta com " + fmtKm(km) + " sem internet (" + prov + ").", usuario_nome: perfil.nome, criado_em: agora }] });
      await local.gravar("os:" + ordemId, { ...ordem, numero: prov, _pendente: true, _provisorio: prov, itens: [], fotos: [], eventos: [], desconto: 0, total: 0 });
      lsSet(LS_NOVA, null); setF(vazioNova());
      await atualizarPendentes();
      avisar(prov + " aberta sem internet. O número definitivo sai quando a conexão voltar.");
      ir("/os/" + ordemId);
    } catch (x) { avisar("Não foi possível guardar a O.S. neste aparelho: " + x.message, true); }
  };

  return html`<div class="pagina">
    <div ref=${topo}></div>
    ${erros.length ? html`<div class="erros" role="alert">Corrija para abrir a O.S.:<ul>${erros.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>` : null}
    <section class="card"><h3>Veículo</h3>
      <${Campo} id="placa" rotulo="Placa" obrig dica="Se o veículo já passou pela oficina, os dados aparecem.">
        <input id="placa" class="inp inp-placa" autocomplete="off" maxlength="8" value=${exPlaca(f.placa)}
          onInput=${e => { const p = normPlaca(e.target.value); const v = placaValida(p) ? dados.veiculos.find(x => x.placa === p) : null; muda({ placa: p, veiculoId: v ? v.id : "", clienteId: v ? (v.cliente_id || f.clienteId) : f.clienteId }); }} />
      </${Campo}>
      ${veiculo ? html`<div class="achado"><${Placa} placa=${veiculo.placa} /><div class="meio"><strong>${veiculo.marca} ${veiculo.modelo} ${veiculo.ano}</strong><div class="sub">Já cadastrado · último KM ${fmtKm(veiculo.km_atual)} · ${dados.ordens.filter(o => o.veiculo_id === veiculo.id).length} O.S. anteriores</div></div></div>
        ${abertaDoVeiculo ? html`<div class="aviso">Este veículo já está com a <b>${numOS(abertaDoVeiculo.numero)}</b> aberta (${abertaDoVeiculo.status === "pronto" ? "pronto para retirada" : "em andamento"}). <button type="button" class="btn-link" onClick=${() => ir("/os/" + abertaDoVeiculo.id)}>Abrir a O.S. existente</button></div>` : null}`
      : placaValida(f.placa) ? html`<div class="info">Placa nova. Preencha os dados do veículo.</div>
        <div class="grade">
          <${Campo} id="v-marca" rotulo="Marca" obrig><${Texto} id="v-marca" valor=${f.vNovo.marca} onMuda=${v => muda({ vNovo: { ...f.vNovo, marca: v } })} /></${Campo}>
          <${Campo} id="v-modelo" rotulo="Modelo" obrig><${Texto} id="v-modelo" valor=${f.vNovo.modelo} onMuda=${v => muda({ vNovo: { ...f.vNovo, modelo: v } })} /></${Campo}>
          <${Campo} id="v-ano" rotulo="Ano" obrig><${Texto} id="v-ano" inputmode="numeric" maxlength="4" valor=${f.vNovo.ano} onMuda=${v => muda({ vNovo: { ...f.vNovo, ano: soDig(v).slice(0, 4) } })} /></${Campo}>
          <${Campo} id="v-cor" rotulo="Cor"><${Texto} id="v-cor" valor=${f.vNovo.cor} onMuda=${v => muda({ vNovo: { ...f.vNovo, cor: v } })} /></${Campo}>
          <${Campo} id="v-motor" rotulo="Motor"><${Texto} id="v-motor" placeholder="ex.: 1.0 8V" valor=${f.vNovo.motor} onMuda=${v => muda({ vNovo: { ...f.vNovo, motor: v } })} /></${Campo}>
        </div>
        <div class="campo"><label>Combustível</label><${Seg} rotulo="Combustível" opcoes=${COMBUSTIVEIS.map(c => [c, "info"])} valor=${f.vNovo.combustivel} onEscolha=${v => muda({ vNovo: { ...f.vNovo, combustivel: v } })} /></div>` : null}
    </section>
    <section class="card"><h3>Cliente</h3>
      ${cliente ? html`<div class="achado"><div class="meio"><strong>${cliente.nome}</strong><div class="sub">cód. ${cliente.codigo ?? "—"} · ${fmtTel(cliente.telefone)}${cliente.doc ? " · " + fmtDoc(cliente.doc) : ""}</div></div>
          <button type="button" class="btn btn-sm" onClick=${() => muda({ clienteId: "", modoCliente: "busca" })}>Trocar</button></div>
        ${cliente.situacao && cliente.situacao !== "liberado" ? html`<div class=${cliente.situacao === "bloqueado" ? "erros" : "aviso"}><b>Cadastro ${cliente.situacao}:</b> ${cliente.restricao || "verifique o cadastro"}</div>` : null}`
      : html`<${Abas} abas=${[["busca", "Buscar cliente"], ["novo", "Novo cliente"]]} ativa=${f.modoCliente === "novo" ? "novo" : "busca"} onTroca=${k => muda({ modoCliente: k })} />
        ${f.modoCliente !== "novo" ? html`
          <${Campo} id="busca-cli" rotulo="Nome, telefone ou CPF"><${Texto} id="busca-cli" valor=${f.buscaCliente} onMuda=${v => muda({ buscaCliente: v })} /></${Campo}>
          ${(() => { const q = norm(f.buscaCliente), qd = soDig(f.buscaCliente);
            if (!q) return dados.clientes.length ? html`<span class="dica">${dados.clientes.length} clientes cadastrados. Digite para buscar.</span>` : html`<div class="vazio">Nenhum cliente cadastrado ainda. Use “Novo cliente”.</div>`;
            const r = dados.clientes.filter(c => norm(c.nome).includes(q) || norm(c.fantasia).includes(q) || (qd && String(c.codigo) === qd) || (qd.length >= 3 && (soDig(c.telefone).includes(qd) || soDig(c.doc).includes(qd)))).slice(0, 8);
            return r.length ? html`<div class="lista">${r.map(c => html`<button type="button" key=${c.id} class="linha" onClick=${() => muda({ clienteId: c.id })}><span class="meio"><strong>${c.nome}</strong><span>${fmtTel(c.telefone)}${c.doc ? " · " + fmtDoc(c.doc) : ""}</span></span><span class="btn btn-sm">Selecionar</span></button>`)}</div>`
              : html`<div class="vazio">Nenhum cliente encontrado. <button type="button" class="btn-link" onClick=${() => muda({ modoCliente: "novo", cNovo: { ...f.cNovo, nome: qd.length ? "" : f.buscaCliente, telefone: qd.length >= 10 ? fmtTel(qd) : f.cNovo.telefone } })}>Cadastrar novo</button></div>`; })()}`
        : html`<div class="grade">
          <${Campo} id="c-nome" rotulo="Nome completo" obrig><${Texto} id="c-nome" autocomplete="off" valor=${f.cNovo.nome} onMuda=${v => muda({ cNovo: { ...f.cNovo, nome: v } })} /></${Campo}>
          <${Campo} id="c-tel" rotulo="Telefone / WhatsApp" obrig><input id="c-tel" class="inp" inputmode="tel" value=${f.cNovo.telefone} onBlur=${e => muda({ cNovo: { ...f.cNovo, telefone: fmtTel(e.target.value) } })} onInput=${e => muda({ cNovo: { ...f.cNovo, telefone: e.target.value } })} /></${Campo}>
          <${Campo} id="c-doc" rotulo="CPF ou CNPJ" dica="Opcional. Necessário para nota fiscal em nome do cliente." erro=${f.cNovo.doc && soDig(f.cNovo.doc).length >= 11 && !docValido(f.cNovo.doc) ? "Número inválido" : ""}>
            <input id="c-doc" class="inp" inputmode="numeric" value=${f.cNovo.doc} onBlur=${e => muda({ cNovo: { ...f.cNovo, doc: fmtDoc(e.target.value) } })} onInput=${e => muda({ cNovo: { ...f.cNovo, doc: e.target.value } })} /></${Campo}>
          <${Campo} id="c-end" rotulo="Endereço (rua e número)"><${Texto} id="c-end" valor=${f.cNovo.endereco} onMuda=${v => muda({ cNovo: { ...f.cNovo, endereco: v } })} /></${Campo}>
          <${Campo} id="c-bairro" rotulo="Bairro"><${Texto} id="c-bairro" valor=${f.cNovo.bairro || ""} onMuda=${v => muda({ cNovo: { ...f.cNovo, bairro: v } })} /></${Campo}>
        </div>
        <div class="campo"><label>Como conheceu a DTCar?</label><${Seg} rotulo="Origem" opcoes=${ORIGENS.map(o => [o, "info"])} valor=${f.cNovo.origem} onEscolha=${v => muda({ cNovo: { ...f.cNovo, origem: v } })} /></div>`}`}
    </section>
    <section class="card"><h3>Entrada</h3>
      <${Campo} id="km" rotulo="KM de entrada" obrig dica=${veiculo && veiculo.km_atual ? "Último registro: " + fmtKm(veiculo.km_atual) : "Leia no painel do veículo."}>
        <input id="km" class="inp" inputmode="numeric" value=${f.km ? Number(soDig(f.km)).toLocaleString("pt-BR") : ""} onInput=${e => muda({ km: soDig(e.target.value).slice(0, 7), kmConfirmado: false })} /></${Campo}>
      ${veiculo && veiculo.km_atual && f.km !== "" && +soDig(f.km) < veiculo.km_atual ? html`<label class="aviso linha-check">
        <input type="checkbox" id="km-conf" checked=${f.kmConfirmado} onChange=${e => muda({ kmConfirmado: e.target.checked })} />
        <span>KM menor que o último registro (${fmtKm(veiculo.km_atual)}). Confirmo que o valor está correto (troca de painel ou erro anterior). A divergência ficará registrada.</span></label>` : null}
      <div class="grade">
        <${Campo} id="os-box" rotulo="Box / prisma"><${Texto} id="os-box" valor=${f.box || ""} onMuda=${v => muda({ box: v.slice(0, 10) })} /></${Campo}>
        <${Campo} id="os-contato" rotulo="Contato (quem trouxe)"><${Texto} id="os-contato" valor=${f.contato || ""} onMuda=${v => muda({ contato: v })} /></${Campo}>
      </div>
      <${Campo} id="recl" rotulo="Defeito reclamado / serviço solicitado" obrig dica="Use as palavras do cliente: o que sente, quando acontece, desde quando.">
        <${Area} id="recl" valor=${f.reclamacao} onMuda=${v => muda({ reclamacao: v })} /></${Campo}>
      <div class="campo"><label>Consultor responsável <i>*</i></label>
        ${consultores.length ? html`<${Seg} rotulo="Consultor" opcoes=${consultores.map(c => [c.nome, "info"])} valor=${(consultores.find(c => c.id === f.consultorId) || {}).nome} onEscolha=${v => muda({ consultorId: consultores.find(c => c.nome === v).id })} />`
          : html`<span class="dica">Nenhum consultor liberado. O administrador libera em Mais › Equipe.</span>`}</div>
    </section>
    <p class="dica">O checklist de entrada (combustível, avarias, pneus, fotos e assinatura) é opcional e pode ser feito agora ou depois, dentro da O.S.</p>
    ${f.placa || f.clienteId || f.reclamacao ? html`<button type="button" class="btn-link" onClick=${descartar}>Limpar formulário</button>` : null}
    <div class="rodape-acoes"><div class="in">
      <button type="button" class="btn" disabled=${!!salvando} onClick=${() => abrir(true)}>${salvando === "ck" ? "Abrindo…" : "Abrir + checklist"}</button>
      <button type="button" class="btn btn-pri" disabled=${!!salvando} onClick=${() => abrir(false)}>${salvando === "os" ? "Abrindo…" : "Abrir O.S."}</button>
    </div></div>
  </div>`;
}

/* =================== CHECKLIST DE ENTRADA (dentro da O.S.) =================== */
const ETAPAS = ["Chegada", "Checklist técnico", "Lataria, pneus e fotos", "Revisão e assinatura"];

function CartaoFoto({ f, obrigatoria, faltando, enviando, onArquivo, onRemover, onRotulo }) {
  const idc = "cam-" + f.slot, idg = "gal-" + f.slot, fixo = !f.slot.startsWith("x");
  return html`<div class=${"foto" + (faltando ? " faltando" : "")}>
    <div class="img">${f.caminho ? html`<${Foto} caminho=${f.caminho} alt=${f.rotulo} />` : html`<span class="sub">${enviando ? "Enviando…" : obrigatoria ? "Obrigatória" : "Sem foto"}</span>`}</div>
    <div class="rot">${fixo ? f.rotulo : html`<input id=${"rot-" + f.slot} aria-label="Legenda da foto" value=${f.rotulo} onInput=${e => onRotulo(e.target.value)} />`}</div>
    <div class="bts">
      ${f.caminho ? html`<button type="button" class="rem" onClick=${onRemover}>Remover</button>` : html`<label for=${idc}>Câmera</label>`}
      ${f.caminho ? html`<label for=${idc}>Refazer</label>` : html`<label for=${idg}>Galeria</label>`}
      <input id=${idc} class="vh" type="file" accept="image/*" capture="environment" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) onArquivo(a); }} />
      <input id=${idg} class="vh" type="file" accept="image/*" onChange=${e => { const a = e.target.files[0]; e.target.value = ""; if (a) onArquivo(a); }} />
    </div></div>`;
}

function estadoInicial(o) {
  const ck = o.checkin || {};
  const existentes = (o.fotos || []).filter(x => x.etapa === "entrada");
  const usadas = new Set();
  const fotos = SLOTS_FOTO.map(([slot, rotulo]) => {
    const e = existentes.find(x => x.rotulo === rotulo && !usadas.has(x.id)); if (e) usadas.add(e.id);
    return { slot, rotulo, caminho: e ? e.caminho : "", fotoId: e ? e.id : "", w: e ? e.largura : 0, h: e ? e.altura : 0 };
  }).concat(existentes.filter(x => !usadas.has(x.id)).map(x => ({ slot: "x" + x.id.slice(0, 8), rotulo: x.rotulo, caminho: x.caminho, fotoId: x.id, w: x.largura, h: x.altura })));
  return { etapa: 0, combustivel: o.combustivel || "", funcionando: o.funcionando || "", resp: ck.resp || {}, objetosValor: ck.objetosValor || "", observacoes: ck.observacoes || "",
    fotos, removidas: [], novas: [], assinante: o.assinante_entrada || "" };
}

export function ChecklistOS({ id }) {
  const { cfg, perfil, avisar, confirmar, ir, recarregar } = useApp();
  const LS = "dtcar-ck-" + id;
  const [o, setO] = useState(null);
  const [f, setF] = useState(null);
  const [val, setVal] = useState({ erros: [], faltando: new Set() });
  const [enviando, setEnviando] = useState({});
  const [salvando, setSalvando] = useState(false);
  const assinRef = useRef(null), topoRef = useRef(null);

  useEffect(() => { api.ordem(id).then(r => { setO(r); const rasc = lsGet(LS); setF(rasc && rasc.fotos ? rasc : estadoInicial(r)); }).catch(e => avisar("Não foi possível abrir a O.S.: " + e.message, true)); }, [id]);
  useEffect(() => { if (f) lsSet(LS, f); }, [f]);
  const muda = p => setF(x => ({ ...x, ...p }));
  const mudaResp = useCallback((k, r) => setF(x => ({ ...x, resp: { ...x.resp, [k]: r } })), []);
  if (!o || !f) return html`<div class="pagina"><div class="carregando">Abrindo checklist…</div></div>`;

  const rolar = () => setTimeout(() => topoRef.current && topoRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  const validar = et => {
    const e = [], falt = new Set();
    if (et === 0) { if (!f.combustivel) e.push("Marque o nível de combustível."); if (!f.funcionando) e.push("Informe se o veículo chegou funcionando."); }
    if (et === 1 || et === 2) {
      const secs = et === 1 ? SECOES_CHECKLIST.concat([{ itens: extrasDe(cfg.itensExtras) }]) : SECOES_EXTERNO;
      for (const s of secs) for (const it of s.itens) if (!f.resp[it.k]) falt.add(it.k);
      if (falt.size) e.push(falt.size + (falt.size === 1 ? " item ainda não avaliado." : " itens ainda não avaliados."));
      if (et === 2 && cfg.exigirFotos) { const sem = f.fotos.filter(x => SLOTS_OBRIG.includes(x.slot) && !x.caminho); sem.forEach(x => falt.add("foto-" + x.slot)); if (sem.length) e.push("Faltam fotos obrigatórias: " + sem.map(x => x.rotulo.toLowerCase()).join(", ") + "."); }
    }
    return { erros: e, faltando: falt };
  };
  const avancar = () => { const r = validar(f.etapa); setVal(r); if (r.erros.length) return rolar(); muda({ etapa: f.etapa + 1 }); setVal({ erros: [], faltando: new Set() }); rolar(); };
  const voltar = () => { muda({ etapa: Math.max(0, f.etapa - 1) }); setVal({ erros: [], faltando: new Set() }); rolar(); };
  const sair = async () => {
    if (f.novas.length || Object.keys(f.resp).length !== Object.keys((o.checkin || {}).resp || {}).length) {
      if (!await confirmar({ titulo: "Sair do checklist", texto: "O que foi preenchido fica guardado neste aparelho e você pode continuar depois.", botao: "Sair" })) return;
    }
    ir("/os/" + id);
  };
  const descartar = async () => {
    if (!await confirmar({ titulo: "Descartar alterações", texto: "As alterações deste checklist e as fotos novas serão apagadas.", botao: "Descartar", perigo: true })) return;
    api.removerArquivos(f.novas).catch(() => {}); lsSet(LS, null); ir("/os/" + id);
  };
  const enviarFoto = async (slot, arq) => {
    setEnviando(x => ({ ...x, [slot]: true }));
    try {
      const { blob, w, h } = await reduzirImagem(arq, 1280, "image/jpeg", 0.72);
      const caminho = await api.enviarArquivo("os/" + id + "/" + uuid() + ".jpg", blob, "image/jpeg");
      setF(x => {
        const ant = x.fotos.find(y => y.slot === slot);
        let removidas = x.removidas, novas = x.novas.concat([caminho]);
        if (ant && ant.caminho) { if (ant.fotoId) removidas = removidas.concat([{ id: ant.fotoId, caminho: ant.caminho }]); else { api.removerArquivos([ant.caminho]).catch(() => {}); novas = novas.filter(c => c !== ant.caminho); } }
        return { ...x, removidas, novas, fotos: x.fotos.map(y => y.slot === slot ? { ...y, caminho, fotoId: "", w, h } : y) };
      });
    } catch (e) { avisar(e && e.message === "formato" ? "Não foi possível ler esta imagem. Use JPG ou PNG." : "Falha ao enviar a foto: " + e.message, true); }
    finally { setEnviando(x => ({ ...x, [slot]: false })); }
  };
  const removerFoto = slot => setF(x => {
    const y = x.fotos.find(z => z.slot === slot); let removidas = x.removidas, novas = x.novas;
    if (y && y.caminho) { if (y.fotoId) removidas = removidas.concat([{ id: y.fotoId, caminho: y.caminho }]); else { api.removerArquivos([y.caminho]).catch(() => {}); novas = novas.filter(c => c !== y.caminho); } }
    const fixa = SLOTS_FOTO.some(([s]) => s === slot);
    return { ...x, removidas, novas, fotos: fixa ? x.fotos.map(z => z.slot === slot ? { ...z, caminho: "", fotoId: "", w: 0, h: 0 } : z) : x.fotos.filter(z => z.slot !== slot) };
  });
  const extras = f.fotos.filter(x => x.slot.startsWith("x"));

  const concluir = async () => {
    for (let et = 0; et < 3; et++) { const r = validar(et); if (r.erros.length) { muda({ etapa: et }); setVal(r); return rolar(); } }
    if (Object.values(enviando).some(Boolean)) return avisar("Aguarde o envio das fotos terminar.", true);
    // sem internet: fotos (novas ou removidas) e assinatura só com internet; nada é gravado pela metade e o rascunho fica guardado
    const novasFotos = f.fotos.some(x => x.caminho && !x.fotoId), assinou = assinRef.current && !assinRef.current.vazio();
    if (estaSemRede() && (f.removidas.length || novasFotos || assinou)) return avisar("Sem internet: fotos e assinatura do checklist só podem ser gravadas com internet. O rascunho fica guardado; conclua quando a conexão voltar.", true);
    setSalvando(true);
    try {
      let assinatura = o.assinatura_entrada || "";
      if (assinRef.current && !assinRef.current.vazio()) { const b = await assinRef.current.blob(); if (b) assinatura = await api.enviarArquivo("assinaturas/" + id + "-entrada-" + Date.now() + ".png", b, "image/png"); }
      for (const r of f.removidas) { try { await api.excluirFoto(r); } catch (e) { if (erroDeRede(e)) throw e; } }
      await api.incluirFotos(f.fotos.filter(x => x.caminho && !x.fotoId).map(x => ({ ordem_id: id, caminho: x.caminho, rotulo: x.rotulo, etapa: "entrada", largura: x.w, altura: x.h })));
      const jaFeito = !!(o.checkin && o.checkin.feito);
      await api.atualizarOrdem(id, {
        combustivel: f.combustivel, funcionando: f.funcionando, assinatura_entrada: assinatura, assinante_entrada: (f.assinante || o.cliente.nome || "").trim(),
        checkin: { ...(o.checkin || {}), feito: true, em: new Date().toISOString(), por: perfil.nome, resp: f.resp, itensExtras: cfg.itensExtras || [], objetosValor: f.objetosValor.trim(), observacoes: f.observacoes.trim(), termo: termoEntradaFinal(cfg) },
      });
      await api.evento(id, "checklist", jaFeito ? "Checklist de entrada atualizado." : "Checklist de entrada realizado.", perfil.nome);
      lsSet(LS, null); recarregar(["ordens"]); avisar("Checklist salvo na " + numOS(o.numero) + ".");
      ir("/os/" + id);
    } catch (e) { avisar("Não foi possível salvar: " + e.message + " Nada foi perdido; tente de novo.", true); }
    finally { setSalvando(false); }
  };

  const etapa0 = html`<section class="card"><h3>Chegada do veículo</h3>
      <div class="campo"><label>Nível de combustível <i>*</i></label>
        <div class="comb" role="group" aria-label="Nível de combustível">${COMBUSTIVEL.map(([t, n]) => html`<button type="button" key=${t} aria-pressed=${f.combustivel === t ? "true" : "false"} onClick=${() => muda({ combustivel: t })}><i style=${{ height: Math.round(4 + n * 18) + "px" }}></i>${t}</button>`)}</div></div>
      <div class="campo"><label>Veículo chegou funcionando? <i>*</i></label>
        <${Seg} rotulo="Veículo funcionando" opcoes=${[["Sim", "ok"], ["Não (guinchado / não liga)", "bad"]]} valor=${f.funcionando} onEscolha=${v => muda({ funcionando: v })} /></div>
    </section>`;
  const secCheck = SECOES_CHECKLIST.concat(extrasDe(cfg.itensExtras).length ? [{ id: "extras", titulo: "Itens adicionais", itens: extrasDe(cfg.itensExtras) }] : []);
  const etapa1 = html`${secCheck.map(s => html`<${SecaoChecklist} key=${s.id} s=${s} resp=${f.resp} onMuda=${mudaResp} faltando=${val.faltando} />`)}`;
  const etapa2 = html`
    ${SECOES_EXTERNO.map(s => html`<${SecaoChecklist} key=${s.id} s=${s} resp=${f.resp} onMuda=${mudaResp} faltando=${val.faltando} />`)}
    <section class="card"><h3>Objetos de valor no veículo</h3>
      <${Campo} id="obj" rotulo="O que o cliente deixou no veículo" dica="Deixe em branco se nada foi deixado. Oriente o cliente a retirar objetos de valor."><${Texto} id="obj" valor=${f.objetosValor} onMuda=${v => muda({ objetosValor: v })} /></${Campo}></section>
    <section class="card"><div class="secao-topo"><h3>Fotos</h3><span class="sub">${f.fotos.filter(x => x.caminho).length} enviadas</span></div>
      ${cfg.exigirFotos ? html`<span class="dica">As 4 laterais são obrigatórias. Elas protegem a oficina em caso de reclamação de avaria.</span>` : null}
      <div class="fotos">${f.fotos.map(x => html`<${CartaoFoto} key=${x.slot} f=${x} obrigatoria=${cfg.exigirFotos && SLOTS_OBRIG.includes(x.slot)} faltando=${val.faltando.has("foto-" + x.slot)} enviando=${enviando[x.slot]}
        onArquivo=${a => enviarFoto(x.slot, a)} onRemover=${() => removerFoto(x.slot)} onRotulo=${t => setF(y => ({ ...y, fotos: y.fotos.map(z => z.slot === x.slot ? { ...z, rotulo: t } : z) }))} />`)}</div>
      ${extras.length < 8 ? html`<button type="button" class="btn" onClick=${() => setF(y => ({ ...y, fotos: y.fotos.concat([{ slot: "x" + uuid().slice(0, 8), rotulo: "Detalhe " + (extras.length + 1), caminho: "", fotoId: "", w: 0, h: 0 }]) }))}>+ Foto de detalhe (avaria, peça, painel)</button>` : null}
    </section>`;
  const resumo = achados(f.resp, secoesCheckin(cfg.itensExtras));
  const etapa3 = html`
    <section class="card"><h3>Observado na entrada</h3>
      <div class="kv"><div><span>Combustível</span><b>${f.combustivel}</b></div><div><span>Funcionando</span><b>${f.funcionando}</b></div><div><span>Fotos</span><b>${f.fotos.filter(x => x.caminho).length}</b></div></div>
      ${resumo.length ? html`<ul class="res-lista">${resumo.map(a => html`<li key=${a.l}><span class=${"dot s-" + a.s}></span><span><b>${a.l}</b>: ${a.v}${a.obs ? " (" + a.obs + ")" : ""}</span></li>`)}</ul>` : html`<span class="sub">Nenhum item com problema registrado.</span>`}</section>
    <section class="card"><${Campo} id="obs-geral" rotulo="Observações gerais"><${Area} id="obs-geral" valor=${f.observacoes} onMuda=${v => muda({ observacoes: v })} /></${Campo}></section>
    <section class="card"><h3>Termo e assinatura do cliente</h3>
      <p class="termo">${termoEntradaFinal(cfg)}</p>
      <${Campo} id="assinante" rotulo="Nome de quem assina" dica="Preencha se quem entrega o veículo não for o titular."><${Texto} id="assinante" placeholder=${o.cliente.nome} valor=${f.assinante} onMuda=${v => muda({ assinante: v })} /></${Campo}>
      ${o.assinatura_entrada ? html`<span class="dica">Já existe uma assinatura registrada. Assine de novo apenas se quiser substituí-la.</span>` : null}
      <${PadAssinatura} apiRef=${assinRef} /></section>`;

  const ultima = f.etapa === ETAPAS.length - 1;
  return html`<div class="pagina">
    <div class="ck-cab"><button type="button" class="btn-link" onClick=${sair}>← ${numOS(o.numero)}</button>
      <span class="sub"><${Placa} placa=${o.veiculo.placa} /> ${o.veiculo.marca} ${o.veiculo.modelo} · ${o.cliente.nome}</span></div>
    <div class="etapas" ref=${topoRef}>
      <div class="etapas-barra n4">${ETAPAS.map((_, i) => html`<i key=${i} class=${i <= f.etapa ? "feito" : ""}></i>`)}</div>
      <div class="etapas-txt"><b>${ETAPAS[f.etapa]}</b><span>Etapa ${f.etapa + 1} de ${ETAPAS.length}</span></div></div>
    ${o.checkin && o.checkin.feito && f.etapa === 0 ? html`<div class="info">Checklist feito em ${fmtDataHora(o.checkin.em)} por ${o.checkin.por}. Você está editando.</div>` : null}
    ${val.erros.length ? html`<div class="erros" role="alert">Corrija para continuar:<ul>${val.erros.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>` : null}
    ${[etapa0, etapa1, etapa2, etapa3][f.etapa]}
    ${f.etapa === 0 ? html`<button type="button" class="btn-link perigo" onClick=${descartar}>Descartar alterações</button>` : null}
    <div class="rodape-acoes"><div class="in">
      ${f.etapa > 0 ? html`<button type="button" class="btn" onClick=${voltar}>Voltar</button>` : html`<button type="button" class="btn" onClick=${sair}>Sair</button>`}
      ${ultima ? html`<button type="button" class="btn btn-pri" disabled=${salvando} onClick=${concluir}>${salvando ? "Salvando…" : "Salvar checklist"}</button>`
        : html`<button type="button" class="btn btn-pri" onClick=${avancar}>Próximo: ${ETAPAS[f.etapa + 1]}</button>`}
    </div></div></div>`;
}
