import { html, useState, useEffect, useRef, useCallback } from "../lib.js";
import { api } from "../api.js";
import { useApp, Placa, Campo, Texto, Area, Seg, Abas, SecaoChecklist, PadAssinatura, Foto } from "../ui.js";
import { soDig, norm, uuid, docValido, fmtDoc, fmtTel, normPlaca, placaValida, exPlaca, fmtKm, lsGet, lsSet, reduzirImagem } from "../util.js";
import { SECOES_CHECKLIST, SECOES_EXTERNO, COMBUSTIVEL, SLOTS_FOTO, SLOTS_OBRIG, extrasDe, secoesCheckin, achados, termoEntradaFinal } from "../regras.js";

const LS = "dtcar-entrada-v1";
const ETAPAS = ["Veículo e cliente", "Entrada", "Checklist", "Lataria, pneus e fotos", "Revisão e assinatura"];
const MAX_EXTRAS = 8;

function vazio() {
  return { rid: uuid(), etapa: 0, placa: "", veiculoId: "", vNovo: { marca: "", modelo: "", ano: "", cor: "", motor: "" }, clienteId: "", modoCliente: "busca",
    cNovo: { nome: "", telefone: "", doc: "", endereco: "" }, buscaCliente: "", km: "", kmConfirmado: false, combustivel: "", funcionando: "", reclamacao: "",
    consultorId: "", resp: {}, objetosValor: "", observacoes: "", fotos: SLOTS_FOTO.map(([slot, rotulo]) => ({ slot, rotulo, caminho: "", w: 0, h: 0 })), assinante: "" };
}

function validar(et, f, ctx) {
  const e = [], falt = new Set(), { dados, cfg } = ctx;
  const v = dados.veiculos.find(x => x.id === f.veiculoId);
  if (et === 0) {
    if (!placaValida(f.placa)) e.push("Informe uma placa válida (ABC1234 ou ABC1D23).");
    if (!f.veiculoId) {
      if (!f.vNovo.marca.trim()) e.push("Informe a marca do veículo.");
      if (!f.vNovo.modelo.trim()) e.push("Informe o modelo do veículo.");
      const ano = +f.vNovo.ano; if (!(ano >= 1950 && ano <= new Date().getFullYear() + 1)) e.push("Informe o ano do veículo com 4 dígitos.");
    }
    if (!f.clienteId) {
      if (f.modoCliente !== "novo") e.push("Selecione um cliente ou cadastre um novo.");
      else {
        if (!f.cNovo.nome.trim()) e.push("Informe o nome do cliente.");
        const t = soDig(f.cNovo.telefone); if (t.length < 10 || t.length > 11) e.push("Informe o telefone com DDD.");
        if (f.cNovo.doc.trim()) {
          if (!docValido(f.cNovo.doc)) e.push("CPF/CNPJ inválido. Confira os dígitos ou deixe em branco.");
          else { const dup = dados.clientes.find(c => soDig(c.doc) === soDig(f.cNovo.doc)); if (dup) e.push("Já existe um cliente com este CPF/CNPJ: " + dup.nome + ". Selecione-o na busca."); }
        }
      }
    }
  }
  if (et === 1) {
    const km = parseInt(soDig(f.km), 10);
    if (f.km === "" || !(km >= 0)) e.push("Informe o KM de entrada.");
    else if (v && v.km_atual && km < v.km_atual && !f.kmConfirmado) e.push("O KM informado é menor que o último registrado (" + fmtKm(v.km_atual) + "). Confira o painel ou confirme a divergência.");
    if (!f.combustivel) e.push("Marque o nível de combustível.");
    if (!f.funcionando) e.push("Informe se o veículo chegou funcionando.");
    if (!f.reclamacao.trim()) e.push("Descreva o motivo da visita ou a reclamação do cliente.");
    if (!f.consultorId) e.push("Selecione o consultor responsável.");
  }
  if (et === 2 || et === 3) {
    const secs = et === 2 ? SECOES_CHECKLIST.concat([{ itens: extrasDe(cfg.itensExtras) }]) : SECOES_EXTERNO;
    for (const s of secs) for (const it of s.itens) if (!f.resp[it.k]) falt.add(it.k);
    if (falt.size) e.push(falt.size + (falt.size === 1 ? " item ainda não avaliado." : " itens ainda não avaliados."));
    if (et === 3 && cfg.exigirFotos) {
      const sem = f.fotos.filter(x => SLOTS_OBRIG.includes(x.slot) && !x.caminho);
      sem.forEach(x => falt.add("foto-" + x.slot));
      if (sem.length) e.push("Faltam fotos obrigatórias: " + sem.map(x => x.rotulo.toLowerCase()).join(", ") + ".");
    }
  }
  return { erros: e, faltando: falt };
}

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

export function Entrada() {
  const ctx = useApp(), { dados, cfg, perfil, avisar, confirmar, ir, recarregar } = ctx;
  const consultores = dados.perfis.filter(p => p.ativo !== false && (p.papel === "admin" || p.papel === "consultor"));
  const [f, setF] = useState(() => { const r = lsGet(LS); return r && r.fotos ? { ...vazio(), ...r } : vazio(); });
  const [val, setVal] = useState({ erros: [], faltando: new Set() });
  const [enviando, setEnviando] = useState({});
  const [salvando, setSalvando] = useState(false);
  const assinRef = useRef(null), topoRef = useRef(null);

  useEffect(() => { lsSet(LS, f); }, [f]);
  useEffect(() => { if (!f.consultorId && consultores.some(c => c.id === perfil.id)) setF(o => ({ ...o, consultorId: perfil.id })); }, [dados.perfis]);
  const muda = p => setF(o => ({ ...o, ...p }));
  const mudaResp = useCallback((k, r) => setF(o => ({ ...o, resp: { ...o.resp, [k]: r } })), []);
  const veiculo = dados.veiculos.find(v => v.id === f.veiculoId);
  const cliente = dados.clientes.find(c => c.id === f.clienteId);
  const rolar = () => setTimeout(() => topoRef.current && topoRef.current.scrollIntoView({ behavior: "smooth", block: "start" }), 30);

  const avancar = () => { const r = validar(f.etapa, f, ctx); setVal(r); if (r.erros.length) return rolar(); muda({ etapa: f.etapa + 1 }); setVal({ erros: [], faltando: new Set() }); rolar(); };
  const voltar = () => { muda({ etapa: Math.max(0, f.etapa - 1) }); setVal({ erros: [], faltando: new Set() }); rolar(); };
  const descartar = async () => {
    if (!await confirmar({ titulo: "Descartar entrada", texto: "Os dados preenchidos e as fotos enviadas desta entrada serão apagados.", botao: "Descartar", perigo: true })) return;
    api.removerArquivos(f.fotos.filter(x => x.caminho).map(x => x.caminho)).catch(() => {});
    lsSet(LS, null); setF(vazio()); setVal({ erros: [], faltando: new Set() });
  };

  const enviarFoto = async (slot, arq) => {
    setEnviando(o => ({ ...o, [slot]: true }));
    try {
      const { blob, w, h } = await reduzirImagem(arq, 1280, "image/jpeg", 0.72);
      const caminho = await api.enviarArquivo("entrada/" + f.rid + "/" + uuid() + ".jpg", blob, "image/jpeg");
      setF(o => { const ant = o.fotos.find(x => x.slot === slot); if (ant && ant.caminho) api.removerArquivos([ant.caminho]).catch(() => {});
        return { ...o, fotos: o.fotos.map(x => x.slot === slot ? { ...x, caminho, w, h } : x) }; });
    } catch (e) { avisar(e && e.message === "formato" ? "Não foi possível ler esta imagem. Use JPG ou PNG." : "Falha ao enviar a foto: " + e.message, true); }
    finally { setEnviando(o => ({ ...o, [slot]: false })); }
  };
  const removerFoto = slot => setF(o => {
    const x = o.fotos.find(y => y.slot === slot); if (x && x.caminho) api.removerArquivos([x.caminho]).catch(() => {});
    const fixa = SLOTS_FOTO.some(([s]) => s === slot);
    return { ...o, fotos: fixa ? o.fotos.map(y => y.slot === slot ? { ...y, caminho: "", w: 0, h: 0 } : y) : o.fotos.filter(y => y.slot !== slot) };
  });
  const extras = f.fotos.filter(x => x.slot.startsWith("x"));

  const finalizar = async () => {
    for (let et = 0; et < 4; et++) { const r = validar(et, f, ctx); if (r.erros.length) { muda({ etapa: et }); setVal(r); return rolar(); } }
    if (Object.values(enviando).some(Boolean)) return avisar("Aguarde o envio das fotos terminar.", true);
    setSalvando(true);
    try {
      let cli = cliente, cliId = f.clienteId;
      if (!cliId) { cli = await api.clientes.salvar({ nome: f.cNovo.nome.trim(), telefone: soDig(f.cNovo.telefone), doc: soDig(f.cNovo.doc), endereco: f.cNovo.endereco.trim() }); cliId = cli.id; }
      const km = parseInt(soDig(f.km), 10);
      let vei = veiculo;
      if (!vei) vei = await api.veiculos.salvar({ placa: f.placa, marca: f.vNovo.marca.trim(), modelo: f.vNovo.modelo.trim(), ano: String(f.vNovo.ano), cor: f.vNovo.cor.trim(), motor: f.vNovo.motor.trim(), cliente_id: cliId, km_atual: km });
      else vei = await api.veiculos.salvar({ id: vei.id, cliente_id: cliId, km_atual: Math.max(km, vei.km_atual || 0) });
      let assinatura = "";
      if (assinRef.current && !assinRef.current.vazio()) { const b = await assinRef.current.blob(); if (b) assinatura = await api.enviarArquivo("assinaturas/" + f.rid + "-entrada.png", b, "image/png"); }
      const cons = consultores.find(c => c.id === f.consultorId);
      const ordem = await api.criarOrdem({
        status: "diagnostico", cliente_id: cliId, veiculo_id: vei.id,
        cliente: { nome: cli.nome, telefone: cli.telefone || "", doc: cli.doc || "", endereco: cli.endereco || "" },
        veiculo: { placa: vei.placa, marca: vei.marca, modelo: vei.modelo, ano: vei.ano, cor: vei.cor || "", motor: vei.motor || "" },
        km_entrada: km, combustivel: f.combustivel, funcionando: f.funcionando, reclamacao: f.reclamacao.trim(),
        checkin: { resp: f.resp, itensExtras: cfg.itensExtras || [], objetosValor: f.objetosValor.trim(), observacoes: f.observacoes.trim(), termo: termoEntradaFinal(cfg),
          kmAnterior: veiculo ? veiculo.km_atual : null, kmDivergente: !!(veiculo && veiculo.km_atual && km < veiculo.km_atual) },
        consultor_id: f.consultorId, consultor_nome: cons ? cons.nome : "", assinatura_entrada: assinatura, assinante_entrada: (f.assinante || cli.nome || "").trim(),
        garantia_dias: Number(cfg.garantiaDias) || 90, condicoes_pagamento: cfg.condicoesPadrao || "",
      });
      await api.incluirFotos(f.fotos.filter(x => x.caminho).map(x => ({ ordem_id: ordem.id, caminho: x.caminho, rotulo: x.rotulo, etapa: "entrada", largura: x.w, altura: x.h })));
      await api.evento(ordem.id, "entrada", "Veículo recebido com " + fmtKm(km) + ".", perfil.nome);
      lsSet(LS, null); setF(vazio());
      await recarregar(["clientes", "veiculos", "ordens"]);
      avisar("Entrada registrada. O.S. aberta.");
      ir("/os/" + ordem.id);
    } catch (e) { avisar("Não foi possível salvar: " + e.message + " Nada foi perdido; tente de novo.", true); }
    finally { setSalvando(false); }
  };

  const etapa0 = html`
    <section class="card"><h3>Veículo</h3>
      <${Campo} id="placa" rotulo="Placa" obrig dica="Se o veículo já passou pela oficina, os dados aparecem.">
        <input id="placa" class="inp inp-placa" autocomplete="off" maxlength="8" value=${exPlaca(f.placa)}
          onInput=${e => { const p = normPlaca(e.target.value); const v = placaValida(p) ? dados.veiculos.find(x => x.placa === p) : null; muda({ placa: p, veiculoId: v ? v.id : "", clienteId: v ? (v.cliente_id || f.clienteId) : f.clienteId }); }} />
      </${Campo}>
      ${veiculo ? html`<div class="achado"><${Placa} placa=${veiculo.placa} /><div class="meio"><strong>${veiculo.marca} ${veiculo.modelo} ${veiculo.ano}</strong><div class="sub">Já cadastrado · último KM ${fmtKm(veiculo.km_atual)} · ${dados.ordens.filter(o => o.veiculo_id === veiculo.id).length} O.S. anteriores</div></div></div>`
      : placaValida(f.placa) ? html`<div class="info">Placa nova. Preencha os dados do veículo.</div>
        <div class="grade">
          <${Campo} id="v-marca" rotulo="Marca" obrig><${Texto} id="v-marca" valor=${f.vNovo.marca} onMuda=${v => muda({ vNovo: { ...f.vNovo, marca: v } })} /></${Campo}>
          <${Campo} id="v-modelo" rotulo="Modelo" obrig><${Texto} id="v-modelo" valor=${f.vNovo.modelo} onMuda=${v => muda({ vNovo: { ...f.vNovo, modelo: v } })} /></${Campo}>
          <${Campo} id="v-ano" rotulo="Ano" obrig><${Texto} id="v-ano" inputmode="numeric" maxlength="4" valor=${f.vNovo.ano} onMuda=${v => muda({ vNovo: { ...f.vNovo, ano: soDig(v).slice(0, 4) } })} /></${Campo}>
          <${Campo} id="v-cor" rotulo="Cor"><${Texto} id="v-cor" valor=${f.vNovo.cor} onMuda=${v => muda({ vNovo: { ...f.vNovo, cor: v } })} /></${Campo}>
          <${Campo} id="v-motor" rotulo="Motor"><${Texto} id="v-motor" placeholder="ex.: 1.0 8V flex" valor=${f.vNovo.motor} onMuda=${v => muda({ vNovo: { ...f.vNovo, motor: v } })} /></${Campo}>
        </div>` : null}
    </section>
    <section class="card"><h3>Cliente</h3>
      ${cliente ? html`<div class="achado"><div class="meio"><strong>${cliente.nome}</strong><div class="sub">${fmtTel(cliente.telefone)}${cliente.doc ? " · " + fmtDoc(cliente.doc) : ""}</div></div>
          <button type="button" class="btn btn-sm" onClick=${() => muda({ clienteId: "", modoCliente: "busca" })}>Trocar</button></div>`
      : html`<${Abas} abas=${[["busca", "Buscar cliente"], ["novo", "Novo cliente"]]} ativa=${f.modoCliente === "novo" ? "novo" : "busca"} onTroca=${k => muda({ modoCliente: k })} />
        ${f.modoCliente !== "novo" ? html`
          <${Campo} id="busca-cli" rotulo="Nome, telefone ou CPF"><${Texto} id="busca-cli" valor=${f.buscaCliente} onMuda=${v => muda({ buscaCliente: v })} /></${Campo}>
          ${(() => { const q = norm(f.buscaCliente), qd = soDig(f.buscaCliente);
            if (!q) return dados.clientes.length ? html`<span class="dica">${dados.clientes.length} clientes cadastrados. Digite para buscar.</span>` : html`<div class="vazio">Nenhum cliente cadastrado ainda. Use “Novo cliente”.</div>`;
            const r = dados.clientes.filter(c => norm(c.nome).includes(q) || (qd.length >= 3 && (soDig(c.telefone).includes(qd) || soDig(c.doc).includes(qd)))).slice(0, 8);
            return r.length ? html`<div class="lista">${r.map(c => html`<button type="button" key=${c.id} class="linha" onClick=${() => muda({ clienteId: c.id })}><span class="meio"><strong>${c.nome}</strong><span>${fmtTel(c.telefone)}${c.doc ? " · " + fmtDoc(c.doc) : ""}</span></span><span class="btn btn-sm">Selecionar</span></button>`)}</div>`
              : html`<div class="vazio">Nenhum cliente encontrado. <button type="button" class="btn-link" onClick=${() => muda({ modoCliente: "novo", cNovo: { ...f.cNovo, nome: qd.length ? "" : f.buscaCliente } })}>Cadastrar novo</button></div>`; })()}`
        : html`<div class="grade">
          <${Campo} id="c-nome" rotulo="Nome completo" obrig><${Texto} id="c-nome" autocomplete="off" valor=${f.cNovo.nome} onMuda=${v => muda({ cNovo: { ...f.cNovo, nome: v } })} /></${Campo}>
          <${Campo} id="c-tel" rotulo="Telefone / WhatsApp" obrig><input id="c-tel" class="inp" inputmode="tel" value=${f.cNovo.telefone} onBlur=${e => muda({ cNovo: { ...f.cNovo, telefone: fmtTel(e.target.value) } })} onInput=${e => muda({ cNovo: { ...f.cNovo, telefone: e.target.value } })} /></${Campo}>
          <${Campo} id="c-doc" rotulo="CPF ou CNPJ" dica="Opcional. Necessário para nota fiscal em nome do cliente." erro=${f.cNovo.doc && soDig(f.cNovo.doc).length >= 11 && !docValido(f.cNovo.doc) ? "Número inválido" : ""}>
            <input id="c-doc" class="inp" inputmode="numeric" value=${f.cNovo.doc} onBlur=${e => muda({ cNovo: { ...f.cNovo, doc: fmtDoc(e.target.value) } })} onInput=${e => muda({ cNovo: { ...f.cNovo, doc: e.target.value } })} /></${Campo}>
          <${Campo} id="c-end" rotulo="Endereço"><${Texto} id="c-end" valor=${f.cNovo.endereco} onMuda=${v => muda({ cNovo: { ...f.cNovo, endereco: v } })} /></${Campo}>
        </div>`}`}
    </section>`;

  const etapa1 = html`
    <section class="card"><h3>Dados de entrada</h3>
      <${Campo} id="km" rotulo="KM de entrada" obrig dica=${veiculo && veiculo.km_atual ? "Último registro: " + fmtKm(veiculo.km_atual) : "Leia no painel do veículo."}>
        <input id="km" class="inp" inputmode="numeric" value=${f.km ? Number(soDig(f.km)).toLocaleString("pt-BR") : ""} onInput=${e => muda({ km: soDig(e.target.value).slice(0, 7), kmConfirmado: false })} />
      </${Campo}>
      ${veiculo && veiculo.km_atual && f.km !== "" && +soDig(f.km) < veiculo.km_atual ? html`<label class="aviso linha-check">
        <input type="checkbox" id="km-conf" checked=${f.kmConfirmado} onChange=${e => muda({ kmConfirmado: e.target.checked })} />
        <span>KM menor que o último registro (${fmtKm(veiculo.km_atual)}). Confirmo que o valor está correto (troca de painel ou erro anterior). A divergência ficará registrada.</span></label>` : null}
      <div class="campo"><label>Nível de combustível <i>*</i></label>
        <div class="comb" role="group" aria-label="Nível de combustível">${COMBUSTIVEL.map(([t, n]) => html`<button type="button" key=${t} aria-pressed=${f.combustivel === t ? "true" : "false"} onClick=${() => muda({ combustivel: t })}><i style=${{ height: Math.round(4 + n * 18) + "px" }}></i>${t}</button>`)}</div></div>
      <div class="campo"><label>Veículo chegou funcionando? <i>*</i></label>
        <${Seg} rotulo="Veículo funcionando" opcoes=${[["Sim", "ok"], ["Não (guinchado / não liga)", "bad"]]} valor=${f.funcionando} onEscolha=${v => muda({ funcionando: v })} /></div>
      <${Campo} id="recl" rotulo="Motivo da visita / reclamação do cliente" obrig dica="Use as palavras do cliente: o que sente, quando acontece, desde quando.">
        <${Area} id="recl" valor=${f.reclamacao} onMuda=${v => muda({ reclamacao: v })} /></${Campo}>
    </section>
    <section class="card"><h3>Consultor responsável</h3>
      ${consultores.length ? html`<${Seg} rotulo="Consultor" opcoes=${consultores.map(c => [c.nome, "info"])} valor=${(consultores.find(c => c.id === f.consultorId) || {}).nome} onEscolha=${v => muda({ consultorId: consultores.find(c => c.nome === v).id })} />`
        : html`<span class="dica">Nenhum consultor liberado. O administrador libera em Equipe.</span>`}
    </section>`;

  const secCheck = SECOES_CHECKLIST.concat(extrasDe(cfg.itensExtras).length ? [{ id: "extras", titulo: "Itens adicionais", itens: extrasDe(cfg.itensExtras) }] : []);
  const etapa2 = html`${secCheck.map(s => html`<${SecaoChecklist} key=${s.id} s=${s} resp=${f.resp} onMuda=${mudaResp} faltando=${val.faltando} />`)}`;
  const etapa3 = html`
    ${SECOES_EXTERNO.map(s => html`<${SecaoChecklist} key=${s.id} s=${s} resp=${f.resp} onMuda=${mudaResp} faltando=${val.faltando} />`)}
    <section class="card"><h3>Objetos de valor no veículo</h3>
      <${Campo} id="obj" rotulo="O que o cliente deixou no veículo" dica="Deixe em branco se nada foi deixado. Oriente o cliente a retirar objetos de valor."><${Texto} id="obj" valor=${f.objetosValor} onMuda=${v => muda({ objetosValor: v })} /></${Campo}>
    </section>
    <section class="card"><div class="secao-topo"><h3>Fotos</h3><span class="sub">${f.fotos.filter(x => x.caminho).length} enviadas</span></div>
      ${cfg.exigirFotos ? html`<span class="dica">As 4 laterais são obrigatórias. Elas protegem a oficina em caso de reclamação de avaria.</span>` : null}
      <div class="fotos">${f.fotos.map(x => html`<${CartaoFoto} key=${x.slot} f=${x} obrigatoria=${cfg.exigirFotos && SLOTS_OBRIG.includes(x.slot)} faltando=${val.faltando.has("foto-" + x.slot)} enviando=${enviando[x.slot]}
        onArquivo=${a => enviarFoto(x.slot, a)} onRemover=${() => removerFoto(x.slot)} onRotulo=${t => setF(o => ({ ...o, fotos: o.fotos.map(y => y.slot === x.slot ? { ...y, rotulo: t } : y) }))} />`)}</div>
      ${extras.length < MAX_EXTRAS ? html`<button type="button" class="btn" onClick=${() => setF(o => ({ ...o, fotos: o.fotos.concat([{ slot: "x" + uuid().slice(0, 8), rotulo: "Detalhe " + (extras.length + 1), caminho: "", w: 0, h: 0 }]) }))}>+ Foto de detalhe (avaria, peça, painel)</button>` : null}
    </section>`;

  const resumo = achados(f.resp, secoesCheckin(cfg.itensExtras));
  const vR = veiculo || { placa: f.placa, ...f.vNovo }, cR = cliente || f.cNovo;
  const etapa4 = html`
    <section class="card"><div class="det-cab"><${Placa} placa=${vR.placa} grande /><div class="meio"><h2>${vR.marca} ${vR.modelo}</h2><div class="sub">${vR.ano}${vR.cor ? " · " + vR.cor : ""} · ${cR.nome}</div></div></div>
      <div class="kv"><div><span>KM</span><b>${fmtKm(soDig(f.km))}</b></div><div><span>Combustível</span><b>${f.combustivel}</b></div><div><span>Funcionando</span><b>${f.funcionando}</b></div><div><span>Consultor</span><b>${(consultores.find(c => c.id === f.consultorId) || {}).nome}</b></div></div>
      <div><span class="sub">Motivo da visita</span><div>${f.reclamacao}</div></div></section>
    <section class="card"><h3>Observado na entrada</h3>
      ${resumo.length ? html`<ul class="res-lista">${resumo.map(a => html`<li key=${a.l}><span class=${"dot s-" + a.s}></span><span><b>${a.l}</b>: ${a.v}${a.obs ? " (" + a.obs + ")" : ""}</span></li>`)}</ul>` : html`<span class="sub">Nenhum item com problema registrado.</span>`}</section>
    <section class="card"><${Campo} id="obs-geral" rotulo="Observações gerais"><${Area} id="obs-geral" valor=${f.observacoes} onMuda=${v => muda({ observacoes: v })} /></${Campo}></section>
    <section class="card"><h3>Termo e assinatura do cliente</h3>
      <p class="termo">${termoEntradaFinal(cfg)}</p>
      <${Campo} id="assinante" rotulo="Nome de quem assina" dica="Preencha se quem entrega o veículo não for o titular."><${Texto} id="assinante" placeholder=${cR.nome} valor=${f.assinante} onMuda=${v => muda({ assinante: v })} /></${Campo}>
      <${PadAssinatura} apiRef=${assinRef} /></section>`;

  const ultima = f.etapa === ETAPAS.length - 1;
  return html`<div class="pagina">
    <div class="etapas" ref=${topoRef}>
      <div class="etapas-barra">${ETAPAS.map((_, i) => html`<i key=${i} class=${i <= f.etapa ? "feito" : ""}></i>`)}</div>
      <div class="etapas-txt"><b>${ETAPAS[f.etapa]}</b><span>Etapa ${f.etapa + 1} de ${ETAPAS.length}</span></div></div>
    ${val.erros.length ? html`<div class="erros" role="alert">Corrija para continuar:<ul>${val.erros.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>` : null}
    ${[etapa0, etapa1, etapa2, etapa3, etapa4][f.etapa]}
    ${f.etapa === 0 && (f.placa || f.clienteId) ? html`<button type="button" class="btn-link" onClick=${descartar}>Descartar esta entrada</button>` : null}
    <div class="rodape-acoes"><div class="in">
      ${f.etapa > 0 ? html`<button type="button" class="btn" onClick=${voltar}>Voltar</button>` : html`<button type="button" class="btn" onClick=${() => ir("/painel")}>Sair</button>`}
      ${ultima ? html`<button type="button" class="btn btn-pri" disabled=${salvando} onClick=${finalizar}>${salvando ? "Salvando…" : "Finalizar e abrir O.S."}</button>`
        : html`<button type="button" class="btn btn-pri" onClick=${avancar}>Próximo: ${ETAPAS[f.etapa + 1]}</button>`}
    </div></div></div>`;
}
