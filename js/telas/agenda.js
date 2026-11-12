// Agenda da oficina (v54, pedido do Danilo em 12/11/2026): serviços agendados por dia e horário.
// Agenda livre: sem limite de carros por dia ou horário (decisão do Danilo: "controlado por mim").
// No dia, o agendamento vira O.S. ("Chegou: abrir O.S.", que preenche a Nova O.S.) ou orçamento ("Fazer orçamento").
// A agenda não mexe em O.S., estoque nem financeiro: só guarda o vínculo. Nenhuma mensagem sai sozinha (etapa 3:
// botões que abrem a mensagem pronta para o Danilo conferir e enviar).
// Sem internet: só consulta (banco do PC). Gravar precisa de internet.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, BuscaCliente } from "../ui.js";
import { norm, fmtData, fmtTel, fmtDataHora, hojeISO, somaDias, exPlaca, normPlaca, placaValida, lsGet, lsSet, numOS, numORC } from "../util.js";
import { pode, SITUACOES_AGENDA, AGENDA_ATIVA } from "../regras.js";
import { prepararNovaOSAgenda, LS_VINCULOS } from "./entrada.js";

const FALTA_V54 = e => /agendamentos|does not exist|schema cache|could not find|404/i.test((e && e.message) || "");
export const AVISO_V54 = "A agenda precisa do arquivo supabase/v54.sql, que o administrador roda uma vez no Supabase.";
export const LS_ORC_AGENDA = "dtcar-orc-da-agenda";       // orçamento novo aberto a partir da agenda (orcamentos.js lê e apaga)
const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGOS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const dia = iso => new Date(iso + "T12:00:00");
/** segunda-feira da semana do dia (domingo fica na semana que termina nele) */
export const inicioSemana = iso => { const d = dia(iso); return somaDias(iso, -((d.getDay() + 6) % 7)); };
const ddmm = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
export const horaCurta = h => (h ? String(h).slice(0, 5) : "");
const nomeVeic = v => [exPlaca(v.placa), v.marca, v.modelo].filter(Boolean).join(" ");
const Pill = ({ a }) => { const s = SITUACOES_AGENDA[a.situacao] || { t: a.situacao, cor: "muted" }; return html`<span class=${"pill p-" + s.cor}>${s.t}</span>`; };
/** ordem do dia: horário marcado primeiro (cedo → tarde), sem horário no fim */
export const ordemDoDia = (a, b) => (horaCurta(a.hora) || "99") < (horaCurta(b.hora) || "99") ? -1 : (horaCurta(a.hora) || "99") > (horaCurta(b.hora) || "99") ? 1 : 0;

/** O.S. aberta sem internet a partir da agenda: assim que ela recebe o número definitivo, liga ao agendamento */
export async function ligarPendentes(ordens) {
  const l = lsGet(LS_VINCULOS) || []; if (!l.length) return false;
  let mudou = false; const resta = [];
  for (const v of l) {
    const o = (ordens || []).find(x => x.id === v.ordemId);
    if (!o || typeof o.numero !== "number") { resta.push(v); continue; }
    try { await api.agenda.salvar({ id: v.agendaId, situacao: "chegou", ordem_id: o.id, os_numero: o.numero }); mudou = true; } catch (e) { resta.push(v); }
  }
  lsSet(LS_VINCULOS, resta);
  return mudou;
}

/* ---------------- semana ---------------- */
export function Agenda({ params = {} }) {
  const { perfil, dados, ir, avisar } = useApp();
  const hoje = hojeISO();
  const [seg, setSeg] = useState(() => inicioSemana(/^\d{4}-\d{2}-\d{2}$/.test(params.d || "") ? params.d : hoje));
  const [lista, setLista] = useState(null), [erro, setErro] = useState(""), [falta, setFalta] = useState(false);
  const [modal, setModal] = useState(null), [q, setQ] = useState(""), [achados, setAchados] = useState(null), [canc, setCanc] = useState(false), [versao, setVersao] = useState(0);
  const gestor = pode(perfil, "orcar");
  const fim = somaDias(seg, 6);
  const carregar = () => api.agenda.listar({ de: seg, ate: fim }).then(l => { setLista(l); setErro(""); })
    .catch(e => { if (FALTA_V54(e)) setFalta(true); else setErro(e.message); setLista([]); });
  useEffect(() => { setLista(null); carregar(); }, [seg, versao]);
  useEffect(() => { ligarPendentes(dados.ordens).then(m => { if (m) setVersao(x => x + 1); }).catch(() => {}); }, [dados.ordens]);
  // busca: do mês passado em diante (cliente, placa ou serviço)
  useEffect(() => { const n = q.trim(); if (n.length < 2) { setAchados(null); return; }
    let vivo = true; const t = setTimeout(() => api.agenda.listar({ de: somaDias(hoje, -60) }).then(l => { if (vivo) setAchados(l); }).catch(() => vivo && setAchados([])), 250);
    return () => { vivo = false; clearTimeout(t); }; }, [q, versao]);
  const filtrados = useMemo(() => { if (!achados) return null; const n = norm(q), p = normPlaca(q);
    return achados.filter(a => norm((a.cliente || {}).nome).includes(n) || norm(a.servico).includes(n) || (p.length >= 3 && String((a.veiculo || {}).placa || "").includes(p)) || norm((a.veiculo || {}).modelo).includes(n)); }, [achados, q]);

  const dias = useMemo(() => { const l = []; for (let i = 0; i < 7; i++) l.push(somaDias(seg, i)); return l; }, [seg]);
  const doDia = d => (lista || []).filter(a => a.data === d && (canc || a.situacao !== "cancelado")).sort(ordemDoDia);
  // domingo só aparece se tiver alguém agendado
  const visiveis = dias.filter((d, i) => i < 6 || (lista || []).some(a => a.data === d));
  const ativos = (lista || []).filter(a => AGENDA_ATIVA.includes(a.situacao)).length;
  const salvo = (r, msg) => { setModal(null); avisar(msg || "Agenda atualizada."); if (r && r.data && (r.data < seg || r.data > fim)) setSeg(inicioSemana(r.data)); setVersao(x => x + 1); };
  const novo = d => setModal({ data: d && d >= hoje ? d : hoje, hora: "", situacao: "agendado", cliente_id: "", veiculo_id: "", cliente: { nome: "", telefone: "" }, veiculo: { placa: "", marca: "", modelo: "", ano: "" }, servico: "", obs: "", motivo: "", mensagens: {} });

  const Linha = ({ a, comDia }) => { const v = a.veiculo || {};
    return html`<button type="button" class=${"ag-item s-" + a.situacao} onClick=${() => setModal(a)}>
      <span class="ag-hora">${comDia ? html`<small>${DIAS[dia(a.data).getDay()]} ${ddmm(a.data)}</small>` : null}${horaCurta(a.hora) || "Sem hora"}</span>
      <span class="ag-meio"><strong>${(a.cliente || {}).nome}</strong>${nomeVeic(v) ? html`<span class="ag-vei">${nomeVeic(v)}</span>` : null}<span class="ag-serv">${a.servico}</span>
        ${a.remarcacoes ? html`<span class="ag-remarc">Remarcado ${a.remarcacoes > 1 ? a.remarcacoes + " vezes" : "1 vez"}</span>` : null}
        ${a.os_numero ? html`<span class="ag-vinc">${numOS(a.os_numero)}</span>` : a.orc_numero ? html`<span class="ag-vinc">${numORC(a.orc_numero)}</span>` : null}</span>
      <${Pill} a=${a} /></button>`; };

  return html`<div class="pagina larga agenda">
    <div class="painel-topo"><div><h1>Agenda</h1><span class="sub">Serviços agendados. No dia, o agendamento vira O.S. ou orçamento.</span></div>
      <div class="acoes">${gestor && !falta ? html`<button type="button" class="btn btn-pri" onClick=${() => novo(hoje)}>+ Agendar</button>` : null}</div></div>
    ${falta ? html`<div class="aviso">${AVISO_V54}</div>` : null}${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="ag-barra">
      <div class="ag-semana" role="group" aria-label="Semana">
        <button type="button" class="btn btn-sm" aria-label="Semana anterior" onClick=${() => setSeg(somaDias(seg, -7))}>‹</button>
        <button type="button" class="btn btn-sm" disabled=${seg === inicioSemana(hoje)} onClick=${() => setSeg(inicioSemana(hoje))}>Esta semana</button>
        <button type="button" class="btn btn-sm" aria-label="Próxima semana" onClick=${() => setSeg(somaDias(seg, 7))}>›</button>
        <b class="ag-periodo">${ddmm(seg)} a ${fmtData(fim)}</b>
        ${lista ? html`<span class="sub">${ativos} agendado(s)</span>` : null}</div>
      <label class="ag-canc"><input type="checkbox" checked=${canc} onChange=${e => setCanc(e.target.checked)} /> Mostrar cancelados</label>
      <input class="inp ag-busca" type="search" aria-label="Buscar na agenda" placeholder="Buscar cliente, placa ou serviço" value=${q} onInput=${e => setQ(e.target.value)} />
    </div>
    ${filtrados ? html`<section class="card"><h3>Resultado da busca</h3>${filtrados.length ? html`<div class="ag-lista">${filtrados.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : ordemDoDia(a, b)).map(a => html`<${Linha} key=${a.id} a=${a} comDia />`)}</div>` : html`<${Vazio}>Nada encontrado do mês passado em diante.</${Vazio}>`}</section>` : null}
    ${!lista ? html`<div class="esqueleto"></div>` : html`<div class=${"ag-dias n" + visiveis.length}>${visiveis.map(d => { const l = doDia(d), dw = dia(d).getDay();
      return html`<section key=${d} class=${"card ag-dia" + (d === hoje ? " ag-hoje" : "") + (d < hoje ? " ag-passado" : "")} aria-label=${DIAS_LONGOS[dw] + " " + fmtData(d)}>
        <div class="ag-dia-cab"><b>${DIAS_LONGOS[dw]}</b><span>${fmtData(d)}</span>${d === hoje ? html`<em>Hoje</em>` : null}<small>${l.filter(a => AGENDA_ATIVA.includes(a.situacao)).length || ""}</small></div>
        ${l.length ? html`<div class="ag-lista">${l.map(a => html`<${Linha} key=${a.id} a=${a} />`)}</div>` : html`<p class="ag-vazio">Livre</p>`}
        ${gestor && !falta && d >= hoje ? html`<button type="button" class="btn-link ag-add" onClick=${() => novo(d)}>+ Agendar</button>` : null}
      </section>`; })}</div>`}
    ${modal ? html`<${AgendaModal} a=${modal} onFechar=${() => setModal(null)} onSalvo=${salvo} />` : null}
  </div>`;
}

/* ---------------- um agendamento ---------------- */
const MOTIVOS = ["Cliente desmarcou", "Cliente vai remarcar", "Fez em outra oficina", "Peça não chegou", "Oficina sem horário"];
export function AgendaModal({ a: inicial, onFechar, onSalvo }) {
  const { dados, perfil, avisar, confirmar, ir } = useApp();
  const novo = !inicial.id;
  const [a, setA] = useState(() => ({ ...inicial, hora: horaCurta(inicial.hora), cliente: { nome: "", telefone: "", ...(inicial.cliente || {}) }, veiculo: { placa: "", marca: "", modelo: "", ano: "", ...(inicial.veiculo || {}) } }));
  const [semCad, setSemCad] = useState(!novo && !inicial.cliente_id), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false), [sujo, setSujo] = useState(novo), [cancela, setCancela] = useState(null);
  const gestor = pode(perfil, "orcar"), trancado = !gestor || inicial._local || inicial.situacao === "chegou";
  const set = p => { setA(x => ({ ...x, ...p })); setSujo(true); setErro(""); };
  const veiculosCli = a.cliente_id ? dados.veiculos.filter(v => v.cliente_id === a.cliente_id) : [];
  const copiaVei = v => ({ placa: v.placa || "", marca: v.marca || "", modelo: v.modelo || "", ano: v.ano || "" });
  const escolherCliente = cid => { const c = dados.clientes.find(x => x.id === cid);
    if (!c) return set({ cliente_id: "", veiculo_id: "", cliente: { nome: "", telefone: "" } });
    const vs = dados.veiculos.filter(v => v.cliente_id === cid), v = vs.length === 1 ? vs[0] : null;
    set({ cliente_id: cid, cliente: { nome: c.nome, telefone: c.telefone || "" }, ...(v ? { veiculo_id: v.id, veiculo: copiaVei(v) } : { veiculo_id: "" }) }); };
  const escolherVeiculo = vid => { const v = dados.veiculos.find(x => x.id === vid); set(v ? { veiculo_id: vid, veiculo: copiaVei(v) } : { veiculo_id: "" }); };
  // placa digitada que já está no cadastro: puxa o veículo e o dono
  const digitarPlaca = txt => { const p = normPlaca(txt), v = placaValida(p) ? dados.veiculos.find(x => x.placa === p) : null;
    if (v && !a.veiculo_id) { const c = v.cliente_id ? dados.clientes.find(x => x.id === v.cliente_id) : null;
      if (c && (!a.cliente_id || a.cliente_id === c.id)) { setSemCad(false); return set({ veiculo_id: v.id, veiculo: copiaVei(v), cliente_id: c.id, cliente: { nome: c.nome, telefone: c.telefone || "" } }); }
      if (!a.cliente_id) return set({ veiculo_id: v.id, veiculo: copiaVei(v) }); }
    set({ veiculo: { ...a.veiculo, placa: p } }); };

  const validar = () => !a.data ? "Informe o dia." : !String(a.cliente.nome || "").trim() ? "Informe o cliente: escolha no cadastro ou digite o nome."
    : !String(a.servico || "").trim() ? "Escreva o serviço combinado." : "";
  /** grava (novo ou alteração) e devolve o agendamento como ficou no banco */
  const gravar = async (mudancas = {}, msg) => {
    const e = validar(); if (e) { setErro(e); return null; }
    setSalvando(true);
    try {
      const r = await api.agenda.salvar({ ...(novo ? {} : { id: a.id }), data: a.data, hora: a.hora || null, situacao: a.situacao || "agendado",
        cliente_id: a.cliente_id || null, veiculo_id: a.veiculo_id || null,
        cliente: { nome: String(a.cliente.nome).trim(), telefone: a.cliente.telefone || "" }, veiculo: { ...a.veiculo, placa: normPlaca(a.veiculo.placa) },
        servico: String(a.servico).trim(), obs: a.obs || "", motivo: a.motivo || "", ...mudancas });
      setSujo(false);
      if (msg !== false) onSalvo(r, msg || (novo ? "Agendado para " + fmtData(r.data) + (r.hora ? " às " + horaCurta(r.hora) : "") + "." : "Agendamento salvo."));
      return r;
    } catch (x) { setErro(FALTA_V54(x) ? AVISO_V54 : x.message); return null; } finally { setSalvando(false); }
  };
  const chegou = async () => { const r = sujo ? await gravar({}, false) : a; if (!r) return;
    prepararNovaOSAgenda(r, dados); onFechar(); ir("/entrada"); };
  const orcamento = async () => { const r = sujo ? await gravar({}, false) : a; if (!r) return;
    lsSet(LS_ORC_AGENDA, { agendaId: r.id, cliente_id: r.cliente_id || "", veiculo_id: r.veiculo_id || "", cliente: r.cliente, veiculo: r.veiculo, reclamacao: r.servico });
    onFechar(); ir("/orcamento/novo"); };
  const excluir = async () => { if (!await confirmar({ titulo: "Excluir agendamento", texto: "O agendamento some de vez. Se o cliente desmarcou, prefira “Cancelar agendamento”: ele continua na agenda com o motivo.", botao: "Excluir", perigo: true })) return;
    try { await api.agenda.excluir(a.id); onSalvo(null, "Agendamento excluído."); } catch (e) { setErro(e.message); } };
  const remarcado = !novo && (a.data !== inicial.data || a.hora !== horaCurta(inicial.hora));

  return html`<${Modal} titulo=${novo ? "Agendar serviço" : "Agendamento"} onFechar=${onFechar}>
    <div class="ag-modal">
    ${!novo ? html`<div class="ag-situacao"><${Pill} a=${inicial} /><span class="sub">${[inicial.criado_por_nome ? "agendado por " + inicial.criado_por_nome : "", inicial.criado_em ? "em " + fmtDataHora(inicial.criado_em) : ""].filter(Boolean).join(" ")}</span></div>` : null}
    ${inicial._local ? html`<div class="aviso">Sem internet: a agenda está só para consulta.</div>` : null}
    ${inicial.remarcacoes ? html`<div class="info">Remarcado ${inicial.remarcacoes > 1 ? inicial.remarcacoes + " vezes" : "1 vez"}. Antes: ${fmtData(inicial.data_anterior)}${inicial.hora_anterior ? " às " + horaCurta(inicial.hora_anterior) : ""}.</div>` : null}
    ${inicial.situacao === "cancelado" ? html`<div class="aviso">Cancelado. Motivo: <b>${inicial.motivo}</b></div>` : null}
    ${inicial.os_numero ? html`<div class="info">Chegou: virou a <button type="button" class="btn-link" onClick=${() => { onFechar(); ir("/os/" + inicial.ordem_id); }}>${numOS(inicial.os_numero)}</button>.</div>` : null}
    ${inicial.orc_numero ? html`<div class="info">Orçamento feito: <button type="button" class="btn-link" onClick=${() => { onFechar(); ir("/orcamento/" + inicial.orcamento_id); }}>${numORC(inicial.orc_numero)}</button>.</div>` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}

    <div class="grade ag-quando">
      <${Campo} id="ag-data" rotulo="Dia" obrig><input id="ag-data" type="date" class="inp" value=${a.data || ""} disabled=${trancado} onInput=${e => set({ data: e.target.value })} /></${Campo}>
      <${Campo} id="ag-hora" rotulo="Horário" dica="Opcional"><input id="ag-hora" type="time" class="inp" value=${a.hora || ""} disabled=${trancado} onInput=${e => set({ hora: e.target.value })} /></${Campo}></div>
    ${remarcado ? html`<p class="dica">Trocar o dia ou o horário conta como remarcação${inicial.situacao === "confirmado" ? " e o agendamento volta para “Agendado” (a confirmação era do horário antigo)" : ""}.</p>` : null}

    ${!trancado ? html`<${Seg} rotulo="Cliente" opcoes=${[["Do cadastro", "info"], ["Sem cadastro", "info"]]} valor=${semCad ? "Sem cadastro" : "Do cadastro"}
      onEscolha=${v => { const s = v === "Sem cadastro"; setSemCad(s); if (s && a.cliente_id) set({ cliente_id: "", veiculo_id: "" }); }} />` : null}
    ${!semCad && !trancado ? html`<div class="campo"><label for="ag-cli">Cliente</label><${BuscaCliente} id="ag-cli" valor=${a.cliente_id} onEscolha=${escolherCliente} /></div>` : null}
    ${semCad || trancado ? html`<div class="grade">
      <${Campo} id="ag-nome" rotulo="Nome do cliente" obrig><${Texto} id="ag-nome" valor=${a.cliente.nome} disabled=${trancado} onMuda=${v => set({ cliente: { ...a.cliente, nome: v } })} /></${Campo}>
      <${Campo} id="ag-tel" rotulo="Telefone (WhatsApp)"><${Texto} id="ag-tel" inputmode="tel" valor=${trancado ? fmtTel(a.cliente.telefone) : a.cliente.telefone} disabled=${trancado} onMuda=${v => set({ cliente: { ...a.cliente, telefone: v } })} /></${Campo}></div>` : null}
    ${!trancado && veiculosCli.length ? html`<div class="campo"><label for="ag-vei">Veículo do cadastro</label><select id="ag-vei" class="inp" value=${a.veiculo_id || ""} onChange=${e => escolherVeiculo(e.target.value)}>
      <option value="">Outro veículo (digitar)</option>${veiculosCli.map(v => html`<option value=${v.id}>${[exPlaca(v.placa), v.marca, v.modelo, v.ano].filter(Boolean).join(" ")}</option>`)}</select></div>` : null}
    <div class="grade ag-veic">
      <${Campo} id="ag-placa" rotulo="Placa"><${Texto} id="ag-placa" valor=${a.veiculo.placa} disabled=${trancado || !!a.veiculo_id} onMuda=${digitarPlaca} /></${Campo}>
      <${Campo} id="ag-modelo" rotulo="Veículo"><${Texto} id="ag-modelo" placeholder="Marca e modelo" valor=${[a.veiculo.marca, a.veiculo.modelo].filter(Boolean).join(" ")} disabled=${trancado || !!a.veiculo_id}
        onMuda=${v => set({ veiculo: { ...a.veiculo, marca: "", modelo: v } })} /></${Campo}></div>
    <${Campo} id="ag-serv" rotulo="Serviço combinado" obrig><${Area} id="ag-serv" rows="2" placeholder="Ex.: revisão dos 40 mil, troca de óleo e filtros" valor=${a.servico} disabled=${trancado} onMuda=${v => set({ servico: v })} /></${Campo}>
    <${Campo} id="ag-obs" rotulo="Anotação interna (o cliente não vê)"><${Area} id="ag-obs" rows="2" valor=${a.obs} disabled=${trancado} onMuda=${v => set({ obs: v })} /></${Campo}>

    ${!trancado ? html`<div class="ag-acoes">
      ${!novo && AGENDA_ATIVA.includes(inicial.situacao) ? html`<div class="ag-acoes-dia">
        <button type="button" class="btn btn-pri" disabled=${salvando} onClick=${chegou}>Chegou: abrir O.S.</button>
        ${!inicial.orc_numero ? html`<button type="button" class="btn" disabled=${salvando} onClick=${orcamento}>Fazer orçamento</button>` : null}
        ${inicial.situacao === "agendado" ? html`<button type="button" class="btn" disabled=${salvando} onClick=${() => gravar({ situacao: "confirmado" }, "Marcado como confirmado pelo cliente.")}>Cliente confirmou</button>` : null}
        <button type="button" class="btn" disabled=${salvando} onClick=${() => gravar({ situacao: "faltou" }, "Marcado como faltou.")}>Faltou</button>
        <button type="button" class="btn btn-recusa" disabled=${salvando} onClick=${() => setCancela("")}>Cancelar agendamento</button></div>` : null}
      ${!novo && !AGENDA_ATIVA.includes(inicial.situacao) ? html`<div class="ag-acoes-dia"><button type="button" class="btn" disabled=${salvando} onClick=${() => gravar({ situacao: "agendado", motivo: "" }, "Agendamento reaberto.")}>Voltar para agendado</button></div>` : null}
      <div class="acoes">${!novo && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}
        <span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button>
        <button type="button" class="btn btn-pri" disabled=${salvando || !sujo} onClick=${() => gravar()}>${salvando ? "Salvando…" : novo ? "Agendar" : "Salvar"}</button></div>
    </div>` : html`<div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button></div>`}
    </div>
    ${cancela !== null ? html`<${Modal} titulo="Cancelar agendamento" onFechar=${() => setCancela(null)}>
      <p class="sub">O agendamento continua na agenda, riscado, com o motivo.</p>
      <div class="chips">${MOTIVOS.map(m => html`<button type="button" key=${m} class=${"chip-f" + (cancela === m ? " ativo" : "")} onClick=${() => setCancela(m)}>${m}</button>`)}</div>
      <${Campo} id="ag-motivo" rotulo="Motivo" obrig><${Texto} id="ag-motivo" valor=${cancela} onMuda=${setCancela} /></${Campo}>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${() => setCancela(null)}>Voltar</button>
        <button type="button" class="btn btn-pri" disabled=${!cancela.trim() || salvando} onClick=${async () => { if (await gravar({ situacao: "cancelado", motivo: cancela.trim() }, "Agendamento cancelado.")) setCancela(null); }}>Cancelar agendamento</button></div>
    </${Modal}>` : null}
  </${Modal}>`;
}
