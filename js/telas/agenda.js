// Agenda da oficina (v54, pedido do Danilo em 12/11/2026): serviços agendados por dia e horário.
// Agenda livre: sem limite de carros por dia ou horário (decisão do Danilo: "controlado por mim").
// No dia, o agendamento vira O.S. ("Chegou: abrir O.S.", que preenche a Nova O.S.) ou orçamento ("Fazer orçamento").
// A agenda não mexe em O.S., estoque nem financeiro: só guarda o vínculo. Nenhuma mensagem sai sozinha (etapa 3:
// botões que abrem a mensagem pronta para o Danilo conferir e enviar).
// Sem internet: só consulta (banco do PC). Gravar precisa de internet.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { fila } from "../fila.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, BuscaCliente } from "../ui.js";
import { norm, fmtData, fmtTel, fmtDataHora, hojeISO, somaDias, exPlaca, normPlaca, placaValida, lsGet, lsSet, numOS, numORC } from "../util.js";
import { pode } from "../regras.js";
import { prepararNovaOSAgenda, LS_VINCULOS } from "./entrada.js";
import { usePlaca, PlacaBusca, soVazios, tirarPreenchidos, paraResumo } from "../placa.js";

/* ---------------- agenda da oficina (v54, pedido do Danilo em 12/11/2026) ----------------
 * Gravadas no banco: agendado, confirmado, chegou (virou O.S.), faltou, cancelado (com motivo). "Remarcado" não é situação:
 * trocar o dia ou o horário conta uma remarcação (o gatilho do v54 calcula e volta "confirmado" para "agendado").
 * Agenda livre: sem limite de carros por dia ou horário (decisão do Danilo). O nome da situação sempre aparece escrito.
 * Fica aqui (e não em js/regras.js) porque regras.js é usado pela função "email" travado num commit: mexer nele obriga a republicar. */
export const SITUACOES_AGENDA = {
  agendado: { t: "Agendado", cor: "info" },
  confirmado: { t: "Confirmado", cor: "ok" },
  chegou: { t: "Chegou", cor: "brand" },
  faltou: { t: "Faltou", cor: "warn" },
  cancelado: { t: "Cancelado", cor: "bad" },
};
/** ainda vai acontecer (conta no dia e aparece nas próximas) */
export const AGENDA_ATIVA = ["agendado", "confirmado"];

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
const chaveVinculo = v => (v.orcamentoId ? "orc:" + v.orcamentoId : "ag:" + v.agendaId) + ">" + v.ordemId;
let ligando = Promise.resolve(false);
export function ligarPendentes(ordens) { ligando = ligando.catch(() => false).then(() => ligarAgora(ordens)); return ligando; } // uma de cada vez
async function ligarAgora(ordens) {
  const l = lsGet(LS_VINCULOS) || []; if (!l.length) return false;
  let mudou = false; const feitas = [];
  for (const v of l) {
    const o = (ordens || []).find(x => x.id === v.ordemId);
    if (!o || typeof o.numero !== "number") continue;
    if (v.orcamentoId) {
      // a O.S. do orçamento já tinha número: só vale depois que a chegada (KM) foi enviada. Na fila (ou em conflito): espera.
      // Fora da fila e sem KM (alteração descartada) ou O.S. cancelada: a chegada não foi gravada — esquece, sem marcar a agenda.
      let naFila = false; try { naFila = (await fila.listar()).some(op => op.ordem_id === o.id || op.id === o.id); } catch (e) { naFila = true; }
      if (naFila) continue;
      if (!o.km_entrada || o.status === "cancelado") { feitas.push(chaveVinculo(v)); continue; }
    }
    try {
      // chegada registrada sem internet na O.S. de um orçamento: todos os agendamentos desse orçamento; senão, o agendamento da Nova O.S.
      if (v.orcamentoId) await api.agenda.chegouPeloOrcamento(v.orcamentoId, o);
      else await api.agenda.salvar({ id: v.agendaId, situacao: "chegou", ordem_id: o.id, os_numero: o.numero });
      mudou = true; feitas.push(chaveVinculo(v));
    } catch (e) { /* fica para a próxima */ }
  }
  // tira só as que foram feitas, relendo a lista: o que foi guardado enquanto esta rodava (outra chegada sem internet) continua lá
  if (feitas.length) lsSet(LS_VINCULOS, (lsGet(LS_VINCULOS) || []).filter(v => !feitas.includes(chaveVinculo(v))));
  return mudou;
}

/* ---------------- semana ---------------- */
export function Agenda({ params = {} }) {
  const { perfil, ir, avisar } = useApp();
  const hoje = hojeISO();
  const [seg, setSeg] = useState(() => inicioSemana(/^\d{4}-\d{2}-\d{2}$/.test(params.d || "") ? params.d : hoje));
  const [lista, setLista] = useState(null), [erro, setErro] = useState(""), [falta, setFalta] = useState(false);
  const [modal, setModal] = useState(null), [q, setQ] = useState(""), [achados, setAchados] = useState(null), [canc, setCanc] = useState(false), [versao, setVersao] = useState(0);
  const gestor = pode(perfil, "orcar");
  const fim = somaDias(seg, 6);
  // visão "Mês" (pedido do Danilo em 12/11/2026): calendário inteiro, com os dias que têm serviço agendado em azul.
  // A escolha (Semana | Mês) fica guardada no aparelho. Clicar num dia mostra os agendamentos dele embaixo.
  const [visao, setVisao] = useState(() => (lsGet("dtcar-agenda-visao") === "mes" && !params.d ? "mes" : "semana"));
  const [mes, setMes] = useState(() => hoje.slice(0, 7) + "-01"), [sel, setSel] = useState(hoje);
  const trocarVisao = v => { setVisao(v); lsSet("dtcar-agenda-visao", v); if (v === "mes") { const b = seg <= hoje && hoje <= fim ? hoje : seg; setMes(b.slice(0, 7) + "-01"); setSel(b); } else setSeg(inicioSemana(sel)); };
  const outroMes = n => { const d = dia(mes); d.setMonth(d.getMonth() + n); const m = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-01"; setMes(m); setSel(m === hoje.slice(0, 7) + "-01" ? hoje : m); };
  const gradeIni = inicioSemana(mes), ultimo = (() => { const d = dia(mes); d.setMonth(d.getMonth() + 1); d.setDate(0); return mes.slice(0, 8) + String(d.getDate()).padStart(2, "0"); })(), gradeFim = somaDias(inicioSemana(ultimo), 6);
  const de = visao === "mes" ? gradeIni : seg, ate = visao === "mes" ? gradeFim : fim;
  // só a consulta da semana que está na tela atualiza a lista (trocar de semana no meio de uma consulta não mistura as respostas)
  useEffect(() => { let vivo = true; setLista(null);
    api.agenda.listar({ de, ate }).then(l => { if (vivo) { setLista(l); setErro(""); } })
      .catch(e => { if (!vivo) return; if (FALTA_V54(e)) setFalta(true); else setErro(e.message); setLista([]); });
    return () => { vivo = false; }; }, [de, ate, versao]);
  // a ligação de O.S. aberta sem internet é feita em js/app.js (em qualquer tela); aqui só recarrega quando ela acontece
  useEffect(() => { const f = () => setVersao(x => x + 1); window.addEventListener("dtcar-agenda", f); return () => window.removeEventListener("dtcar-agenda", f); }, []);
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
  const ativos = (lista || []).filter(a => AGENDA_ATIVA.includes(a.situacao) && (visao !== "mes" || a.data.slice(0, 7) === mes.slice(0, 7))).length;
  const salvo = (r, msg) => { setModal(null); avisar(msg || "Agenda atualizada.");
    if (r && r.data && visao === "mes") { setMes(r.data.slice(0, 7) + "-01"); setSel(r.data); }
    else if (r && r.data && (r.data < seg || r.data > fim)) setSeg(inicioSemana(r.data));
    setVersao(x => x + 1); };
  const diasMes = useMemo(() => { const l = []; for (let d = gradeIni; d <= gradeFim; d = somaDias(d, 1)) l.push(d); return l; }, [gradeIni, gradeFim]);
  const nomeMes = (() => { const t = dia(mes).toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); })();
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
      <div class="seg ag-visao" role="group" aria-label="Ver a agenda por">${[["semana", "Semana"], ["mes", "Mês"]].map(([k, t]) => html`<button type="button" key=${k} class="s-info" aria-pressed=${visao === k ? "true" : "false"} onClick=${() => visao !== k && trocarVisao(k)}>${t}</button>`)}</div>
      ${visao === "mes" ? html`<div class="ag-semana" role="group" aria-label="Mês">
        <button type="button" class="btn btn-sm" aria-label="Mês anterior" onClick=${() => outroMes(-1)}>‹</button>
        <button type="button" class="btn btn-sm" disabled=${mes === hoje.slice(0, 7) + "-01"} onClick=${() => { setMes(hoje.slice(0, 7) + "-01"); setSel(hoje); }}>Este mês</button>
        <button type="button" class="btn btn-sm" aria-label="Próximo mês" onClick=${() => outroMes(1)}>›</button>
        <b class="ag-periodo">${nomeMes}</b>
        ${lista ? html`<span class="sub">${ativos} agendado(s)</span>` : null}</div>`
      : html`<div class="ag-semana" role="group" aria-label="Semana">
        <button type="button" class="btn btn-sm" aria-label="Semana anterior" onClick=${() => setSeg(somaDias(seg, -7))}>‹</button>
        <button type="button" class="btn btn-sm" disabled=${seg === inicioSemana(hoje)} onClick=${() => setSeg(inicioSemana(hoje))}>Esta semana</button>
        <button type="button" class="btn btn-sm" aria-label="Próxima semana" onClick=${() => setSeg(somaDias(seg, 7))}>›</button>
        <b class="ag-periodo">${ddmm(seg)} a ${fmtData(fim)}</b>
        ${lista ? html`<span class="sub">${ativos} agendado(s)</span>` : null}</div>`}
      <label class="ag-canc"><input type="checkbox" checked=${canc} onChange=${e => setCanc(e.target.checked)} /> Mostrar cancelados</label>
      <input class="inp ag-busca" type="search" aria-label="Buscar na agenda" placeholder="Buscar cliente, placa ou serviço" value=${q} onInput=${e => setQ(e.target.value)} />
    </div>
    ${filtrados ? html`<section class="card"><h3>Resultado da busca</h3>${filtrados.length ? html`<div class="ag-lista">${filtrados.sort((a, b) => a.data < b.data ? -1 : a.data > b.data ? 1 : ordemDoDia(a, b)).map(a => html`<${Linha} key=${a.id} a=${a} comDia />`)}</div>` : html`<${Vazio}>Nada encontrado do mês passado em diante.</${Vazio}>`}</section>` : null}
    ${!lista ? html`<div class="esqueleto"></div>` : visao === "mes" ? html`<section class="card ag-mes">
        <div class="ag-cal" role="grid" aria-label=${"Calendário de " + nomeMes}>
          ${["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"].map(n => html`<span key=${n} class="ag-cal-sem" role="columnheader">${n}</span>`)}
          ${diasMes.map(d => { const n = (lista || []).filter(a => a.data === d && AGENDA_ATIVA.includes(a.situacao)).length, fora = d.slice(0, 7) !== mes.slice(0, 7);
            return html`<button type="button" key=${d} role="gridcell" class=${"ag-cal-dia" + (n ? " com" : "") + (fora ? " fora" : "") + (d === hoje ? " ag-hoje" : "") + (d === sel ? " sel" : "")} aria-pressed=${d === sel ? "true" : "false"}
              aria-label=${fmtData(d) + (n ? ": " + n + " agendado(s)" : ": livre") + (d === hoje ? " (hoje)" : "")} onClick=${() => setSel(d)}>
              <b>${Number(d.slice(8))}</b>${n ? html`<span>${n}<i> agend.</i></span>` : null}</button>`; })}</div>
        <p class="dica ag-cal-legenda"><i class="ag-cal-amostra" aria-hidden="true"></i> Dia em azul: tem serviço agendado (o número é a quantidade). Clique num dia para ver.</p>
        <div class="ag-dia-cab ag-sel-cab"><b>${DIAS_LONGOS[dia(sel).getDay()]}</b><span>${fmtData(sel)}</span>${sel === hoje ? html`<em>Hoje</em>` : null}</div>
        ${doDia(sel).length ? html`<div class="ag-lista">${doDia(sel).map(a => html`<${Linha} key=${a.id} a=${a} />`)}</div>` : html`<p class="ag-vazio">Livre</p>`}
        ${gestor && !falta && sel >= hoje ? html`<button type="button" class="btn-link ag-add" onClick=${() => novo(sel)}>+ Agendar neste dia</button>` : null}
      </section>` : html`<div class=${"ag-dias n" + visiveis.length}>${visiveis.map(d => { const l = doDia(d), dw = dia(d).getDay();
      return html`<section key=${d} class=${"card ag-dia" + (d === hoje ? " ag-hoje" : "") + (d < hoje ? " ag-passado" : "")} aria-label=${DIAS_LONGOS[dw] + " " + fmtData(d)}>
        <div class="ag-dia-cab"><b>${DIAS_LONGOS[dw]}</b><span>${fmtData(d)}</span>${d === hoje ? html`<em>Hoje</em>` : null}<small>${l.filter(a => AGENDA_ATIVA.includes(a.situacao)).length || ""}</small></div>
        ${l.length ? html`<div class="ag-lista">${l.map(a => html`<${Linha} key=${a.id} a=${a} />`)}</div>` : html`<p class="ag-vazio">Livre</p>`}
        ${gestor && !falta && d >= hoje ? html`<button type="button" class="btn-link ag-add" onClick=${() => novo(d)}>+ Agendar</button>` : null}
      </section>`; })}</div>`}
    ${modal ? html`<${AgendaModal} a=${modal} onFechar=${() => setModal(null)} onSalvo=${salvo} />` : null}
  </div>`;
}

/* ---------------- quadro da semana no Início (etapa 2) ---------------- */
// Janela do painel: a semana atual (segunda a sábado; domingo só com agendamento), sem os cancelados. Clicar num agendamento abre
// o mesmo quadro da tela Agenda. No celular, só hoje e os dias com agendamento, um embaixo do outro.
const MAX_NO_DIA = 4;
export function SemanaJanela() {
  const { perfil, ir, avisar } = useApp();
  const hoje = hojeISO(), seg = inicioSemana(hoje), fim = somaDias(seg, 6);
  const [lista, setLista] = useState(null), [aviso, setAviso] = useState(""), [modal, setModal] = useState(null), [versao, setVersao] = useState(0);
  const gestor = pode(perfil, "orcar");
  useEffect(() => { let vivo = true;
    api.agenda.listar({ de: seg, ate: fim }).then(l => { if (vivo) { setLista(l); setAviso(""); } })
      .catch(e => { if (!vivo) return; setLista([]); setAviso(FALTA_V54(e) ? AVISO_V54 : "A agenda precisa de internet para aparecer aqui."); });
    return () => { vivo = false; }; }, [versao, seg]); // seg: sistema aberto de domingo para segunda consulta a semana nova
  useEffect(() => { const f = () => setVersao(x => x + 1); window.addEventListener("dtcar-agenda", f); window.addEventListener("dtcar-conectado", f);
    return () => { window.removeEventListener("dtcar-agenda", f); window.removeEventListener("dtcar-conectado", f); }; }, []);
  if (!lista) return html`<div class="esqueleto"></div>`;
  if (aviso) return html`<span class="dica">${aviso}</span>`;
  const vivos = lista.filter(a => a.situacao !== "cancelado");
  const dias = []; for (let i = 0; i < 7; i++) { const d = somaDias(seg, i); if (i < 6 || vivos.some(a => a.data === d)) dias.push(d); }
  const total = vivos.filter(a => AGENDA_ATIVA.includes(a.situacao)).length;
  return html`<div class="ags">
    <div class="ags-topo"><span class="sub">${total ? total + " agendado(s) de " + ddmm(seg) + " a " + ddmm(fim) : "Nenhum serviço agendado nesta semana."}</span>
      <span class="espaco"></span><button type="button" class="btn-link" onClick=${() => ir("/agenda")}>Abrir a agenda</button>
      ${gestor ? html`<button type="button" class="btn btn-sm" onClick=${() => setModal({ data: hoje, hora: "", situacao: "agendado", cliente_id: "", veiculo_id: "", cliente: { nome: "", telefone: "" }, veiculo: { placa: "", marca: "", modelo: "", ano: "" }, servico: "", obs: "", motivo: "", mensagens: {} })}>+ Agendar</button>` : null}</div>
    <div class=${"ags-dias n" + dias.length}>${dias.map(d => { const l = vivos.filter(a => a.data === d).sort(ordemDoDia), dw = dia(d).getDay(), n = l.filter(a => AGENDA_ATIVA.includes(a.situacao)).length;
      return html`<div key=${d} class=${"ags-dia" + (d === hoje ? " ag-hoje" : "") + (d < hoje ? " ag-passado" : "") + (l.length ? "" : " ags-livre")}>
        <button type="button" class="ags-cab" aria-label=${DIAS_LONGOS[dw] + " " + fmtData(d) + ": abrir na agenda"} onClick=${() => ir("/agenda?d=" + d)}><b>${DIAS[dw]}</b><span>${ddmm(d)}</span>${d === hoje ? html`<em>Hoje</em>` : null}<small>${n || ""}</small></button>
        ${l.length ? l.slice(0, MAX_NO_DIA).map(a => html`<button type="button" key=${a.id} class=${"ags-item s-" + a.situacao} onClick=${() => setModal(a)}>
            <span class="ags-linha"><b>${horaCurta(a.hora) || "Sem hora"}</b><span class="ags-sit">${(SITUACOES_AGENDA[a.situacao] || { t: a.situacao }).t}</span></span>
            <strong>${(a.cliente || {}).nome}</strong><span class="ags-serv">${[exPlaca((a.veiculo || {}).placa), a.servico].filter(Boolean).join(" · ")}</span></button>`)
          : html`<span class="ags-vazio">Livre</span>`}
        ${l.length > MAX_NO_DIA ? html`<button type="button" class="btn-link ags-mais" onClick=${() => ir("/agenda?d=" + d)}>+ ${l.length - MAX_NO_DIA} neste dia</button>` : null}
      </div>`; })}</div>
    ${modal ? html`<${AgendaModal} a=${modal} onFechar=${() => setModal(null)} onSalvo=${(r, msg) => { setModal(null); avisar(msg || "Agenda atualizada."); setVersao(x => x + 1); }} />` : null}
  </div>`;
}

/* ---------------- um agendamento ---------------- */
const MOTIVOS = ["Cliente desmarcou", "Cliente vai remarcar", "Fez em outra oficina", "Peça não chegou", "Oficina sem horário"];
export function AgendaModal({ a: inicial, onFechar, onSalvo }) {
  const { dados, cfg, perfil, avisar, confirmar, ir } = useApp();
  const novo = !inicial.id;
  const [a, setA] = useState(() => ({ ...inicial, hora: horaCurta(inicial.hora), cliente: { nome: "", telefone: "", ...(inicial.cliente || {}) }, veiculo: { placa: "", marca: "", modelo: "", ano: "", ...(inicial.veiculo || {}) } }));
  const [semCad, setSemCad] = useState(!novo && !inicial.cliente_id), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false), [sujo, setSujo] = useState(novo), [cancela, setCancela] = useState(null);
  const gestor = pode(perfil, "orcar"), trancado = !gestor || inicial._local || inicial.situacao === "chegou";
  const set = p => { setA(x => ({ ...x, ...p })); setSujo(true); setErro(""); };
  const veiculosCli = a.cliente_id ? dados.veiculos.filter(v => v.cliente_id === a.cliente_id) : [];
  // Placa fora do cadastro e sem marca/modelo: busca pela placa (v55). Placa do cadastro já é ligada pelo digitarPlaca, sem consulta.
  // Só em agendamento novo ou depois de a placa ser digitada nesta tela: abrir um agendamento antigo não consulta nem muda nada sozinho.
  const [mexeuPlaca, setMexeuPlaca] = useState(novo);
  const plAg = normPlaca(a.veiculo.placa);
  const tresCampos = dd => { const r = paraResumo(dd); return { marca: r.marca, modelo: r.modelo, ano: r.ano }; };
  const autoPlaca = usePlaca(a.veiculo.placa, { falta: mexeuPlaca && !trancado && !a.veiculo_id && !String(a.veiculo.marca || "").trim() && !String(a.veiculo.modelo || "").trim() && !dados.veiculos.some(v => v.placa === plAg),
    auto: cfg.placaAuto !== false, onDados: dd => { setA(x => ({ ...x, veiculo: soVazios(x.veiculo, tresCampos(dd)) })); setSujo(true); },
    onTrocou: dd => setA(x => ({ ...x, veiculo: tirarPreenchidos(x.veiculo, tresCampos(dd)) })) });
  const copiaVei = v => ({ placa: v.placa || "", marca: v.marca || "", modelo: v.modelo || "", ano: v.ano || "" });
  const escolherCliente = cid => { const c = dados.clientes.find(x => x.id === cid);
    // trocou de cliente: o carro do cliente anterior não pode ficar (abrir a O.S. trocaria o dono do carro no cadastro)
    const semVei = { veiculo_id: "", veiculo: { placa: "", marca: "", modelo: "", ano: "" } };
    if (!c) return set({ cliente_id: "", cliente: { nome: "", telefone: "" }, ...semVei });
    const vs = dados.veiculos.filter(v => v.cliente_id === cid), v = vs.length === 1 ? vs[0] : null;
    set({ cliente_id: cid, cliente: { nome: c.nome, telefone: c.telefone || "" }, ...(v ? { veiculo_id: v.id, veiculo: copiaVei(v) } : semVei) }); };
  const escolherVeiculo = vid => { const v = dados.veiculos.find(x => x.id === vid); set(v ? { veiculo_id: vid, veiculo: copiaVei(v) } : { veiculo_id: "" }); };
  // placa digitada que já está no cadastro: puxa o veículo e o dono
  const digitarPlaca = txt => { setMexeuPlaca(true); const p = normPlaca(txt), v = placaValida(p) ? dados.veiculos.find(x => x.placa === p) : null;
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
    // orçamento ligado já aprovado (v53): a O.S. existe e espera o carro — liga a ela e abre a O.S. para "Registrar chegada"
    if (r.orcamento_id) {
      setSalvando(true);
      try { const orc = await api.orcamentos.um(r.orcamento_id);
        if (orc && orc.situacao === "aprovado" && orc.ordem_id) {
          await api.agenda.salvar({ id: r.id, situacao: "chegou", ordem_id: orc.ordem_id, os_numero: orc.os_numero });
          avisar("O orçamento já virou a " + numOS(orc.os_numero) + ": registre a chegada nela."); onFechar(); ir("/os/" + orc.ordem_id); return; } }
      catch (e) { setErro("Não foi possível conferir o orçamento ligado: " + e.message); return; } finally { setSalvando(false); }
    }
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
    ${autoPlaca.botao || (autoPlaca.estado && autoPlaca.estado !== "quieto") ? html`<div class="placa-linha"><${PlacaBusca} c=${autoPlaca} /></div>` : null}
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
