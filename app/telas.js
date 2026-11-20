// Telas do app DTCar (celular), feitas a partir do protótipo aprovado pelo Danilo em 16/11/2026 (gen_proto.py / Design "App DTCar").
// Cada tela usa as MESMAS regras do sistema (js/api.js, js/placa.js, js/cpf.js, js/cep.js, js/catalogo.js, js/pecas.js), só com o
// desenho do app: cabeçalho azul, abas, título com ícone, cartões com faixa azul, campos grandes, rodapé com ação e Início/Ajuda.
// Regras do Danilo (16/11/2026): o app NÃO abre O.S. e NÃO lança item nem preço; o orçamento pelo app é um PEDIDO (o mecânico escreve o que é
// para orçar e envia; o Danilo monta o orçamento no sistema; a O.S. e o orçamento abertos aceitam "mais coisas a orçar"); a placa digitada vale
// só na tela em que foi digitada (sair da tela sem gravar limpa tudo); o botão Voltar do celular volta de tela em tela e só sai do app no Início;
// NENHUMA tela do sistema abre dentro do app: tudo (O.S., histórico, orçamento) é desenhado aqui, no leiaute do app, e sem preço para o mecânico.
import { html, render, createContext, useState, useEffect, useRef, useMemo, useContext } from "../js/lib.js";
import { useLayoutEffect } from "../vendor/preact-htm.js";
import { api } from "../js/api.js";
import { soDig, norm, normPlaca, placaValida, exPlaca, fmtTel, fmtData, fmtKm, hojeISO, numOS, numORC, reais, fmtDoc, lsGet, lsSet, linkWhats } from "../js/util.js";
import { consultarPlaca, paraFicha, anoFabMod } from "../js/placa.js";
import { carregarCatalogo, pesquisar, pesquisarVeiculo, indiceEstoque, filtroParaMostrar, resumoOleo, periodoTexto, TIPOS_FILTRO, MARCAS_PRINCIPAIS } from "../js/catalogo.js";
import { carregarPecas, pecasDoVeiculo, filtrarPecas, agruparEquivalentes, conversaoDoItem, chaveDaPeca } from "../js/pecas.js";
import { copiaClienteDig } from "../js/clientedig.js";
import { pode, STATUS, situacaoOS, cfgCompleta } from "../js/regras.js";
import { ICONE_D, catalogoDoApp, nomeItemApp, opcoesPosicao } from "../js/appmecanico.js";
import { acessoApp, foraDoHorario, podeApagarObd } from "../js/appacesso.js";
import * as param from "../js/obdparam.js";
import { MAIUSC } from "../js/maiusculas.js";
import * as obd from "../js/obd.js";

const LS_VISTOS = "dtcar-app-avisos-vistos";   // ids dos orçamentos aprovados/recusados que a pessoa já viu (avisos do app)
const ABERTA = o => !["entregue", "cancelado", "recusado"].includes(o.status);   // O.S. em andamento (orçamento, execução ou aguardando pagamento)
const ORC_ABERTO = o => o.situacao === "elaboracao" || o.situacao === "enviado";
/** Regra do Danilo (17/11/2026): o mecânico só vê os orçamentos que ele mesmo abriu; administrador e consultor veem todos */
const ORC_MEU = (o, perfil) => perfil.papel !== "mecanico" || o.consultor_id === perfil.id || o.criado_por === perfil.id;
const etapaTexto = o => (situacaoOS(o) || STATUS[o.status] || {}).t || o.status;
const SIT_ORC = { elaboracao: "Em elaboração no sistema", enviado: "Enviado ao cliente", aprovado: "Aprovado · virou O.S.", recusado: "Recusado" };
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

/* ---------------- ícones (os mesmos do protótipo) ---------------- */
const P = {
  orc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/>',
  os: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  ag: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  oleo: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
  peca: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
  help: '<path d="M12 21a9 9 0 1 0-9-9c0 1.6.4 3 1.2 4.2L3 21l4.8-1.2A9 9 0 0 0 12 21z"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.6M12 16.5h.01"/>',
  exit: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  home: '<path d="M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5"/>',
  car: '<path d="M5 17h14M5 17v-6l2-5h10l2 5v6M5 17v2M19 17v2M8 13h.01M16 13h.01M5 11h14"/>',
  down: '<path d="M6 9l6 6 6-6"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v5M14 11v5"/>',
  check: '<path d="M5 12l5 5 10-11"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  clip: '<path d="M9 4h6v3H9z"/><path d="M7 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><path d="M8 12h8M8 16h5"/>',
  hist: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  obd: '<rect x="4" y="7" width="16" height="10" rx="3"/><path d="M8 17v3M16 17v3M9 11h.01M12 11h.01M15 11h.01"/>',
  zap: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c0 3 2.5 5.5 5.5 6.5l1.5-1.5 2 1-.5 1.8c-4.5.6-9.4-4.3-8.8-8.8L10.5 7l1 2z"/>',
};
const Ic = ({ n, t = 24, sw = 2 }) => html`<svg width=${t} height=${t} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0" dangerouslySetInnerHTML=${{ __html: P[n] }}></svg>`;

/* ---------------- botões do Início e abas (ordem aprovada pelo Danilo) ---------------- */
const TELAS = [
  { r: "servico", ic: "os", barra: "INICIAR SERVIÇO", aba: "Iniciar serviço", titulo: "INICIAR SERVIÇO" },
  { r: "oleo", ic: "oleo", barra: "ÓLEO (APLICAÇÃO)", aba: "Óleo (aplicação)", titulo: "ÓLEO (APLICAÇÃO)" },
  { r: "orcamento", ic: "orc", barra: "ORÇAMENTOS", aba: "Orçamentos", titulo: "ORÇAMENTOS" },
  { r: "agendar", ic: "ag", barra: "AGENDAR", aba: "Agendar", titulo: "AGENDAR SERVIÇO" },
  { r: "agenda", ic: "ag", barra: "AGENDA", aba: "Agenda", titulo: "AGENDA" },
  { r: "peca", ic: "peca", barra: "CONSULTAR PEÇA POR CATÁLOGO", aba: "Consultar peça por catálogo", titulo: "CONSULTAR PEÇA POR CATÁLOGO" },
  { r: "historico", ic: "hist", barra: "HISTÓRICO DE SERVIÇOS", aba: "Histórico de serviços", titulo: "HISTÓRICO DE SERVIÇOS" },
  { r: "meus", ic: "hist", barra: "MEUS SERVIÇOS", aba: "Meus serviços", titulo: "MEUS SERVIÇOS" },
  { r: "osconsulta", ic: "clip", barra: "CONSULTAR O.S.", aba: "Consultar O.S.", titulo: "CONSULTAR O.S." },
  { r: "obd", ic: "obd", barra: "DIAGNÓSTICO OBD", aba: "Diagnóstico OBD", titulo: "DIAGNÓSTICO OBD" },
];
const ROTAS_RE = /^#\/(inicio|ajuda|servico|oleo|orcamento|agendar|agenda|peca|historico|meus|osconsulta|obd)$/;
const ir = r => { location.hash = "#/" + r; };
const rotaAtual = () => { const m = /^#\/([a-z]+)/.exec(location.hash || ""); return m ? m[1] : "inicio"; };

/* ---------------- pedaços comuns ---------------- */
function Cabecalho() {
  const { sair } = useApp();
  return html`<header class="cab"><div class="cab-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" />
    <button type="button" class="sair" onClick=${sair}><${Ic} n="exit" t=${22} /> Sair</button></div></header>`;
}
function Abas({ ativa }) {
  const { telas, avisos, indicacoes } = useApp();
  return html`<nav class="abas" aria-label="Telas">${TELAS.filter(t => telas.includes(t.r)).map(t => html`<a key=${t.r} href=${"#/" + t.r} aria-current=${t.r === ativa ? "page" : undefined}><${Ic} n=${t.ic} t=${18} sw=${1.9} /><span>${t.aba}</span>${t.r === "orcamento" && avisos.length ? html`<span class="bolinha" aria-label=${avisos.length + " aviso(s)"}>${avisos.length}</span>` : t.r === "servico" && indicacoes.length ? html`<span class="bolinha" aria-label=${indicacoes.length + " indicação(ões)"}>${indicacoes.length}</span>` : null}</a>`)}</nav>`;
}
function Titulo({ tela, ajuda }) {
  const t = TELAS.find(x => x.r === tela);
  return html`<div class="titulo"><div class="meio"><${Ic} n=${t.ic} t=${22} sw=${1.9} /><b>${t.titulo}</b></div>
    <button type="button" class="ajuda" aria-label="Ajuda desta tela" onClick=${ajuda}><${Ic} n="help" t=${24} sw=${1.8} /></button></div>`;
}
const Cartao = ({ titulo, children, id }) => html`<section class="cartao" id=${id}><h2>${titulo}</h2><div>${children}</div></section>`;
const KV = ({ a, b, p }) => html`<div class="kv"><span>${a}:</span><i></i><b class=${p ? "p" : ""}>${b}</b></div>`;
function Campo({ id, rotulo, children }) { return html`<div class="campo"><label for=${id}>${rotulo}</label>${children}</div>`; }
function Rodape({ tela, acao }) {
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (!el) return; const mede = () => document.documentElement.style.setProperty("--rodape-h", el.offsetHeight + "px"); mede();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(mede) : null; if (ro) ro.observe(el); return () => { if (ro) ro.disconnect(); }; }, []);
  return html`<div class="rodape" ref=${ref}>${acao || null}
    <nav class="nav" aria-label="Navegação"><a href="#/inicio" aria-current=${tela === "inicio" ? "page" : undefined}><${Ic} n="home" t=${22} sw=${1.9} />Início</a>
    <a href="#/ajuda" aria-current=${tela === "ajuda" ? "page" : undefined}><${Ic} n="help" t=${22} sw=${1.9} />Ajuda</a></nav></div>`;
}
function Quadro({ titulo, onFechar, children }) {
  // registrado antes de a tela ser pintada: o botão Voltar do celular já encontra o quadro aberto
  useLayoutEffect(() => { const k = e => e.key === "Escape" && onFechar(); document.addEventListener("keydown", k); quadros.push(onFechar); return () => { document.removeEventListener("keydown", k); const i = quadros.indexOf(onFechar); if (i >= 0) quadros.splice(i, 1); }; }, []);
  return html`<div class="fundo-quadro" onClick=${e => { if (e.target === e.currentTarget) onFechar(); }}><section class="quadro" role="dialog" aria-modal="true" aria-label=${titulo}><h2>${titulo}</h2>${children}</section></div>`;
}
/** nome do carro para as telas */
const nomeVeic = v => [v.marca, v.modelo].filter(Boolean).join(" ");

/* ---------------- veículo: busca pela placa (um lugar só para todas as telas) ----------------
 * Regra do Danilo: placa do cadastro usa o cadastro (sem custo); placa nova consulta a função "placa" (básica), que guarda a cópia
 * no banco da DTCar. A placa vale só na tela em que foi digitada: sair da tela limpa (pedido do Danilo, 16/11/2026). */
/** Placa buscada no Início fica guardada (sessionStorage) até uma nova busca ou "limpar": sair da tela e voltar mostra o mesmo carro
 *  (pedido do Danilo, 16/11/2026 à noite). As outras telas continuam sem memória: a placa vale só ali. */
const CH_PLACA_INICIO = "dtcar-app-placa-inicio";
const lerPlacaGuardada = () => { try { const v = JSON.parse(sessionStorage.getItem(CH_PLACA_INICIO) || "null"); return v && v.veic ? v : { texto: "" }; } catch (e) { return { texto: "" }; } };
// guarda o carro e, do dono, só id/nome/telefone (não a ficha inteira)
const guardarPlaca = p => { try { if (p && p.veic) { const c = p.veic.cliente; sessionStorage.setItem(CH_PLACA_INICIO, JSON.stringify({ texto: p.texto, veic: { ...p.veic, cliente: c ? { id: c.id, nome: c.nome, telefone: c.telefone || "" } : null } })); } else sessionStorage.removeItem(CH_PLACA_INICIO); } catch (e) { /* sem espaço */ } };
export const limparPlacaGuardada = () => guardarPlaca(null);
function usarPlaca(guardar = false) {
  const { dados } = useApp();
  const [placa, setPlacaBruto] = useState(() => guardar ? lerPlacaGuardada() : { texto: "" });
  const setPlaca = p => { setPlacaBruto(p); if (guardar) guardarPlaca(p); };
  const buscar = async (texto) => {
    const p = normPlaca(texto);
    if (!placaValida(p)) { setPlaca({ texto, erro: "Digite a placa inteira (ABC1234 ou ABC1D23)." }); return null; }
    const cad = dados.veiculos.find(v => v.placa === p);
    if (cad) {
      const cli = dados.clientes.find(c => c.id === cad.cliente_id) || null;
      const v = { placa: p, id: cad.id, marca: cad.marca || "", modelo: cad.modelo || "", ano: cad.ano || anoFabMod(cad.ano_fab, cad.ano_mod) || "", cor: cad.cor || "", motor: cad.motor || "", combustivel: cad.combustivel || "", km_atual: cad.km_atual, cliente: cli, origem: "cadastro" };
      setPlaca({ texto: p, veic: v }); return v;
    }
    setPlaca({ texto: p, buscando: true });
    const r = await consultarPlaca(p, "basico", { manual: true });
    if (r.ok && r.encontrado) {
      const d = r.dados || {}, f = paraFicha(d);
      const v = { placa: p, id: null, marca: f.marca, modelo: f.modelo, ano: anoFabMod(f.ano_fab, f.ano_mod), ano_fab: f.ano_fab, ano_mod: f.ano_mod, cor: f.cor, motor: f.motor, combustivel: f.combustivel, chassi: f.chassi, renavam: f.renavam, cliente: null, origem: r.origem === "api" ? "api" : "copia" };
      setPlaca({ texto: p, veic: v }); return v;
    }
    setPlaca({ texto: p, naoAchou: true, motivo: r.ok ? "Placa não encontrada na consulta." : r.semRede ? "Sem internet para consultar a placa." : r.sem_saldo ? "Sem saldo no API Placas." : r.desligada ? "Consulta de placa desligada." : (r.erro || "A consulta não respondeu.") });
    return null;
  };
  const limpar = () => setPlaca({ texto: "" });
  return { placa, buscar, limpar, veic: placa.veic || null };
}
function BuscaPlaca({ id, titulo = "Buscar por placa", pl }) {
  const { placa, buscar, limpar } = pl;
  const [t, setT] = useState(placa.texto || "");
  useEffect(() => { setT(placa.texto || ""); }, [placa.texto]);
  // a busca lê o valor direto do campo: Enter logo depois de digitar não pode pegar o texto antigo (corrida de estado)
  const campo = useRef(null);
  const buscarAgora = () => buscar(campo.current ? campo.current.value : t);
  const v = placa.veic;
  const linha = placa.buscando ? html`<div class="achou buscando" role="status">Consultando a placa…</div>`
    : v ? html`<div class="achou" role="status"><${Ic} n="check" t=${16} sw=${2.4} />${v.origem === "cadastro" ? "Placa gravada no banco da DTCar" : v.origem === "copia" ? "Placa consultada antes: sem custo" : "Placa nova: consultada e gravada"}</div>`
    : placa.naoAchou ? html`<div class="achou nao" role="status">${placa.motivo} Digite o modelo abaixo.</div>`
    : placa.erro ? html`<div class="achou nao" role="status">${placa.erro}</div>` : null;
  return html`<${Cartao} titulo=${titulo}>${linha}
    <${Campo} id=${id} rotulo="Placa"><div class="linha"><input id=${id} ref=${campo} class="inp placa" autocomplete="off" autocapitalize="characters" maxlength="8" placeholder="ABC1D23" value=${t}
        onInput=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === "Enter") buscarAgora(); }} onBlur=${e => { const x = e.target.value; if (normPlaca(x).length === 7 && normPlaca(x) !== placa.texto && !placa.buscando) buscar(x); }} />
      <button type="button" class="btn-busca g" aria-label="Buscar pela placa" onClick=${buscarAgora}><${Ic} n="search" t=${22} /></button>
      ${t ? html`<button type="button" class="btn-busca g" style="background:#fff;color:#6b727b;border:1px solid #d3d7dc" aria-label="Limpar a placa" onClick=${() => { setT(""); limpar(); }}><${Ic} n="trash" t=${20} /></button>` : null}</div></${Campo}>
    <div class="nota">Placa já gravada não gera nova consulta paga. Placa nova é consultada uma vez e fica salva.</div></${Cartao}>`;
}
function Veiculo({ v }) {
  if (!v) return null;
  return html`<div class="veic" id="veic"><div class="lado"><${Ic} n="car" t=${44} sw=${1.6} /><small>${v.marca || "—"}</small></div>
    <div class="dados"><div>Placa: <b>${exPlaca(v.placa)}</b></div><div>Marca: <b>${(v.marca || "—").toUpperCase()}</b></div><div>Modelo: <b>${(v.modelo || "—").toUpperCase()}</b></div><div>Ano: <b>${v.ano || "—"}</b></div>
      ${v.cliente ? html`<div>Dono: <b>${v.cliente.nome}</b></div>` : null}</div></div>`;
}
/** quando a placa não está em lugar nenhum: modelo e ano à mão */
function ModeloAMao({ valor, onMuda }) {
  return html`<${Cartao} titulo="Carro"><div class="grade-cep" style="grid-template-columns:minmax(0,1fr) 110px">
    <${Campo} id="mm-modelo" rotulo="Modelo do carro"><input id="mm-modelo" class="inp" autocomplete="off" placeholder="Ex.: onix 1.0, hilux 2.8" value=${valor.modelo} onInput=${e => onMuda({ ...valor, modelo: e.target.value })} /></${Campo}>
    <${Campo} id="mm-ano" rotulo="Ano"><input id="mm-ano" class="inp livre" inputmode="numeric" maxlength="4" placeholder="Opcional" value=${valor.ano} onInput=${e => onMuda({ ...valor, ano: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></${Campo}></div></${Cartao}>`;
}

/* ---------------- INÍCIO ---------------- */
function Inicio() {
  const { perfil, telas, dados, avisos, indicacoes, recarregarServicos } = useApp();
  const { placa, buscar, limpar } = usarPlaca(true);
  useEffect(() => { recarregarServicos(); }, []);   // ao voltar ao Início, atualiza serviços abertos e indicações (a bolinha)
  const [t, setT] = useState(placa.texto || "");
  const [ajuda, setAjuda] = useState(false), [osAberta, setOsAberta] = useState(null);
  const v = placa.veic;
  // consulta rápida da placa (pedido do Danilo, 16/11/2026): O.S. e orçamentos em aberto do carro e o histórico, tudo sem preço
  const ordens = useMemo(() => v ? ordensDoVeiculo(dados, v) : [], [dados.ordens, v]);
  const abertas = ordens.filter(ABERTA), fechadas = ordens.filter(o => !ABERTA(o));
  const orcs = useMemo(() => v ? (dados.orcamentos || []).filter(o => ORC_ABERTO(o) && ORC_MEU(o, perfil) && (o.veiculo_id && o.veiculo_id === v.id || normPlaca((o.veiculo || {}).placa) === v.placa)) : [], [dados.orcamentos, v]);
  const papel = { admin: "Administrador", consultor: "Consultor", mecanico: "Mecânico" }[perfil.papel] || "";
  return html`<div class="app">
    <header class="cab"><div class="cab-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" /><${SairBotao} /></div>
      <div class="cab-busca"><div class="rotulo">Placa<${Ic} n="down" t=${16} /></div>
        <div class="caixa"><input id="ini-placa" type="text" placeholder="Digite aqui a placa" aria-label="Placa" autocomplete="off" autocapitalize="characters" maxlength="8" value=${t} onInput=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === "Enter") buscar(e.target.value); }} />
          <button type="button" class="limpar" aria-label="Limpar" onClick=${() => { setT(""); limpar(); }}><${Ic} n="trash" t=${20} /></button>
          <button type="button" class="btn-busca" aria-label="Buscar placa" onClick=${() => buscar((document.getElementById("ini-placa") || {}).value || t)}><${Ic} n="search" t=${20} /></button></div>
        <button type="button" class="ajuda" aria-label="Ajuda" onClick=${() => setAjuda(true)}><${Ic} n="help" t=${30} sw=${1.7} /></button></div>
      <div class="cab-texto">${placa.buscando ? "Consultando a placa…" : placa.erro || placa.motivo || "Digite a placa para consultar o veículo. Toda placa buscada fica gravada no banco da DTCar."}</div></header>
    <main class="folha inicio">
      ${v ? html`<${Veiculo} v=${v} />
        <${Cartao} titulo="Situação do carro" id="ini-situacao">
          ${!abertas.length && !orcs.length ? html`<div class="nota">Nenhuma O.S. nem orçamento em aberto para esta placa.</div>` : null}
          ${abertas.map(o => html`<button type="button" key=${o.id} class="item-linha toque" onClick=${() => setOsAberta(o)}><span><b>${numOS(o.numero)}</b> · ${etapaTexto(o)}<br /><span class="nota">${fmtData((o.criado_em || "").slice(0, 10))}${o.mecanico_nome ? " · " + o.mecanico_nome : ""}${o.reclamacao ? " · " + String(o.reclamacao).slice(0, 60) : ""}</span></span><${Ic} n="down" t=${18} /></button>`)}
          ${orcs.map(o => html`<button type="button" key=${o.id} class="item-linha toque" onClick=${() => ir("orcamento")}><span><b>${numORC(o.numero)}</b> · ${SIT_ORC[o.situacao] || o.situacao}<br /><span class="nota">${fmtData((o.criado_em || "").slice(0, 10))} · ${String(o.reclamacao || "").split("\n")[0].slice(0, 60)}</span></span><${Ic} n="down" t=${18} /></button>`)}
          ${fechadas.length ? html`<div class="sec"><h3>Histórico de serviços</h3>${fechadas.slice(0, 5).map(o => html`<button type="button" key=${o.id} class="item-linha toque" onClick=${() => setOsAberta(o)}><span><b>${fmtData((o.criado_em || "").slice(0, 10))}</b>${o.km_entrada ? " · " + fmtKm(o.km_entrada) : ""}<br /><span class="nota">${numOS(o.numero)} · ${o.reclamacao ? String(o.reclamacao).slice(0, 70) : etapaTexto(o)}</span></span><${Ic} n="down" t=${18} /></button>`)}
            ${fechadas.length > 5 ? html`<button type="button" class="link" onClick=${() => ir("historico")}>Ver todo o histórico</button>` : null}</div>` : null}</${Cartao}>` : null}
      <div class="nota" style="padding:0 6px">Olá, <b>${perfil.nome.split(" ")[0]}</b> · ${papel}</div>
      ${TELAS.filter(b => telas.includes(b.r)).map(b => html`<button type="button" key=${b.r} class="barra" onClick=${() => ir(b.r)}><span class="bola"><${Ic} n=${b.ic} t=${20} sw=${1.9} /></span><span>${b.barra}</span>${b.r === "orcamento" && avisos.length ? html`<span class="bolinha" aria-label=${avisos.length + " aviso(s)"}>${avisos.length}</span>` : b.r === "servico" && indicacoes.length ? html`<span class="bolinha" aria-label=${indicacoes.length + " indicação(ões)"}>${indicacoes.length}</span>` : null}</button>`)}
      ${osAberta ? html`<${OSDetalhe} o=${osAberta} onFechar=${() => setOsAberta(null)} />` : null}
      ${!telas.length ? html`<div class="vazio">Nenhuma tela liberada para o seu login. Peça ao administrador (Sistema › Equipe).</div>` : null}
    </main>
    <${Rodape} tela="inicio" />
    ${ajuda ? html`<${Quadro} titulo="Como usar o Início" onFechar=${() => setAjuda(false)}>
      <p>Digite a placa e toque na lupa: aparecem as O.S. e os orçamentos em aberto do carro e o histórico de serviços (sem preço). Toque em uma O.S. para ver. Depois escolha o que fazer nos botões azuis: cada tela tem a própria busca de placa.</p>
      <p class="nota">Placa que está no cadastro não custa nada. Placa nova é consultada uma vez e fica gravada no banco da DTCar.</p>
      <button type="button" class="btn-acao" onClick=${() => setAjuda(false)}>Entendi</button></${Quadro}>` : null}
  </div>`;
}
function SairBotao() { const { sair } = useApp(); return html`<button type="button" class="sair" onClick=${sair}><${Ic} n="exit" t=${22} /> Sair</button>`; }

/* ---------------- moldura das telas de dentro ---------------- */
function Tela({ tela, acao, children, ajuda }) {
  const [aj, setAj] = useState(false);
  return html`<div class="app"><${Cabecalho} />
    <main class="folha"><${Abas} ativa=${tela} /><${Titulo} tela=${tela} ajuda=${() => setAj(true)} />${children}</main>
    <${Rodape} tela=${tela} acao=${acao} />
    ${aj ? html`<${Quadro} titulo="Ajuda" onFechar=${() => setAj(false)}><p>${ajuda}</p><button type="button" class="btn-acao" onClick=${() => setAj(false)}>Entendi</button></${Quadro}>` : null}</div>`;
}

/* ---------------- CLIENTE: busca no cadastro (nome, telefone, CPF ou placa) ---------------- */
function BuscaClienteQuadro({ onEscolha, onFechar }) {
  const { dados } = useApp(); const [q, setQ] = useState("");
  const n = norm(q), d = soDig(q), p = normPlaca(q);
  const res = n.length < 2 && d.length < 4 ? [] : dados.clientes.filter(x => norm(x.nome).includes(n) || (d.length >= 4 && (soDig(x.telefone).includes(d) || soDig(x.doc).includes(d)))
    || (p.length >= 5 && dados.veiculos.some(v => v.cliente_id === x.id && (v.placa || "").includes(p)))).slice(0, 8);
  return html`<${Quadro} titulo="Buscar cliente no cadastro" onFechar=${onFechar}>
    <input id="bc-q" class="inp livre" autocomplete="off" placeholder="Nome, telefone, CPF ou placa" value=${q} onInput=${e => setQ(e.target.value)} />
    <div class="lista-itens">${res.map(c => html`<button type="button" key=${c.id} class="item-linha" style="text-align:left;background:none;border:0;border-bottom:1px solid #d3d7dc;color:#16191d;font-weight:500;min-height:48px;justify-content:space-between" onClick=${() => onEscolha(c)}>
      <span><b style="font-size:14.5px">${c.nome}</b><br /><span class="nota">${c.telefone ? fmtTel(c.telefone) : "sem telefone"}${c.doc ? " · " + fmtDoc(c.doc) : ""}</span></span><${Ic} n="check" t=${18} /></button>`)}
      ${q && !res.length ? html`<div class="vazio">Nenhum cliente encontrado.</div>` : null}</div>
    <button type="button" class="link" onClick=${onFechar}>Fechar</button></${Quadro}>`;
}

/* ---------------- ORÇAMENTOS: pedido pelo app, abertos e avisos (regras do Danilo, 16/11/2026) ----------------
 * No app ninguém lança item nem preço. "+ Pedido de orçamento" = placa (ou nome do cliente) + o texto do que é para orçar → função "pedido" →
 * aparece no sistema como orçamento em elaboração, com aviso de novo pedido. Enquanto aberto, fica aqui em "Orçamentos abertos" e qualquer um da
 * equipe acrescenta mais coisas. Aprovado no sistema: quem pediu recebe o aviso aqui ("virou a O.S. nnnn"). */
const vistos = () => { const l = lsGet(LS_VISTOS, []); return Array.isArray(l) ? l : []; };
/** avisos de quem pediu: orçamentos respondidos (aprovado/recusado) que a pessoa ainda não viu */
function avisosDe(orcamentos, perfil) {
  const v = vistos();
  return (orcamentos || []).filter(o => (o.situacao === "aprovado" || o.situacao === "recusado") && o.consultor_id === perfil.id && !v.includes(o.id))
    .sort((a, b) => String(b.respondido_em || b.atualizado_em || "").localeCompare(String(a.respondido_em || a.atualizado_em || "")));
}
const marcarVisto = id => lsSet(LS_VISTOS, vistos().concat([id]).slice(-200));
/** o pedido do orçamento com as linhas acrescentadas ("— Nome, data: texto") */
const Pedido = ({ texto }) => html`<div class="pedido">${String(texto || "").split("\n").filter(Boolean).map((l, i) => html`<div key=${i} class=${l.startsWith("— ") ? "acrescimo" : ""}>${l}</div>`)}</div>`;

function PedidoNovo({ onFeito, onCancelar }) {
  const { avisar } = useApp(); const pl = usarPlaca();
  // veio de "Iniciar serviço" (carro sem O.S.): a placa já chega buscada; contato continua opcional
  useEffect(() => { let p = ""; try { p = sessionStorage.getItem(CH_PLACA_PEDIDO) || ""; sessionStorage.removeItem(CH_PLACA_PEDIDO); } catch (e) { /* nada */ } if (p) pl.buscar(p); }, []);
  const [mao, setMao] = useState({ modelo: "", ano: "" }), [nome, setNome] = useState(""), [whats, setWhats] = useState(""), [texto, setTexto] = useState(""), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false), [itens, setItens] = useState([]);
  const v = pl.veic, trava = useRef(false);
  const enviar = async () => {
    if (trava.current) return;
    const t = texto.trim();
    if (!v && !normPlaca(pl.placa.texto) && !nome.trim()) return setErro("Busque a placa ou informe o nome do cliente.");
    if (t.length < 3 && !itens.length) return setErro("Marque os itens nos sistemas do carro ou escreva o que é para orçar.");
    if (itens.some(i => i.falta)) return setErro("Escolha a posição dos itens marcados (dianteira, traseira…).");
    const tel = soDig(whats); if (tel && (tel.length < 10 || tel.length > 11)) return setErro("Informe o WhatsApp com DDD.");
    setErro(""); trava.current = true; setSalvando(true);
    try {
      const cli = v && v.cliente ? v.cliente : null;
      const r = await api.pedido.novo({ texto: t, itens: itens.map(i => ({ descricao: i.descricao, qtd: i.qtd })), placa: v ? v.placa : normPlaca(pl.placa.texto), veiculo_id: v && v.id ? v.id : "", cliente_id: cli ? cli.id : "",
        veiculo: v ? { marca: v.marca || "", modelo: v.modelo || "", ano: String(v.ano || "") } : { marca: "", modelo: mao.modelo.trim().toUpperCase(), ano: mao.ano },
        cliente: cli ? { nome: cli.nome, telefone: cli.telefone || "" } : { nome: MAIUSC(nome.trim()), telefone: tel } });
      onFeito(r);
    } catch (x) { avisar("Não foi possível enviar o pedido: " + (x.message || x), true); }
    finally { trava.current = false; setSalvando(false); }
  };
  const acao = html`<div class="acao"><button type="button" class="btn-acao" id="pd-enviar" disabled=${salvando} onClick=${enviar}>${salvando ? "Enviando…" : "Enviar para o sistema"}</button></div>`;
  return html`<${Tela} tela="orcamento" acao=${acao} ajuda="Busque a placa (ou escreva o nome do cliente), escreva embaixo o que é para orçar e toque em Enviar. O pedido chega ao sistema com aviso; lá o orçamento é montado com os preços. Enquanto estiver aberto, você pode acrescentar mais coisas aqui em Orçamentos.">
    ${erro ? html`<div class="erro" role="alert">${erro}</div>` : null}
    <${BuscaPlaca} id="pd-placa" pl=${pl} /><${Veiculo} v=${v} />
    ${!v ? html`<${ModeloAMao} valor=${mao} onMuda=${setMao} />` : null}
    ${!(v && v.cliente) ? html`<${Cartao} titulo="Cliente (se souber)">
      <${Campo} id="pd-nome" rotulo="Nome"><input id="pd-nome" class="inp" autocomplete="off" placeholder="Nome do cliente" value=${nome} onInput=${e => setNome(e.target.value)} /></${Campo}>
      <${Campo} id="pd-whats" rotulo="WhatsApp"><input id="pd-whats" class="inp livre" inputmode="tel" autocomplete="off" placeholder="(27) 90000-0000" value=${whats} onInput=${e => setWhats(e.target.value)} onBlur=${() => { const d = soDig(whats); if (d.length >= 10) setWhats(fmtTel(d)); }} /></${Campo}></${Cartao}>` : null}
    <${Cartao} titulo="Sistemas do carro" id="pd-sistemas"><div class="nota" style="margin-bottom:4px">Toque no sistema e marque o que precisa. Os itens chegam ao orçamento sem preço; os valores são lançados no sistema.</div>
      <${SistemasCarro} onMuda=${setItens} />
      ${itens.length ? html`<div class="lista-marcados" id="pd-marcados"><b>Marcados (${itens.length})</b>${itens.map((i, n) => html`<div key=${n} class=${i.falta ? "falta" : ""}>${i.qtd > 1 ? i.qtd + "× " : ""}${i.descricao}${i.falta ? " — falta a posição" : ""}</div>`)}</div>` : null}</${Cartao}>
    <${Cartao} titulo="Observação (opcional)" id="pd-texto">
      <textarea id="pd-area" class="area" rows="4" placeholder="O que não está na lista, o que o cliente reclamou, o que você viu no carro" value=${texto} onInput=${e => setTexto(e.target.value)}></textarea></${Cartao}>
    <button type="button" class="link" onClick=${onCancelar}>Cancelar e voltar aos orçamentos</button>
  </${Tela}>`;
}

function Orcamentos() {
  const { dados, avisos, avisar, recarregarOrcamentos, perfil } = useApp();
  const [abertoId, setAbertoId] = useState("");   // barra de uma linha: o conteúdo só aparece ao tocar (regra do Danilo, 17/11/2026)
  const [novo, setNovo] = useState(() => { try { return !!sessionStorage.getItem(CH_PLACA_PEDIDO); } catch (e) { return false; } }), [feito, setFeito] = useState(null), [acrescentar, setAcrescentar] = useState(null), [texto, setTexto] = useState(""), [salvando, setSalvando] = useState(false), [q, setQ] = useState("");
  const abertos = useMemo(() => (dados.orcamentos || []).filter(ORC_ABERTO).filter(o => ORC_MEU(o, perfil)).filter(o => { const n = norm(q), p = normPlaca(q); return !q.trim() || norm((o.cliente || {}).nome).includes(n) || (p.length >= 3 && normPlaca((o.veiculo || {}).placa).includes(p)) || String(o.numero) === soDig(q) || norm(o.reclamacao).includes(n); }).sort((a, b) => b.numero - a.numero), [dados.orcamentos, q]);
  const [acrItens, setAcrItens] = useState([]);
  const gravarAcrescimo = async () => {
    const t = texto.trim(); if (t.length < 3 && !acrItens.length) return avisar("Marque os itens ou escreva o que é para acrescentar.", true);
    if (acrItens.some(i => i.falta)) return avisar("Escolha a posição dos itens marcados.", true);
    setSalvando(true);
    try { await api.pedido.acrescentar(acrescentar.id, t, acrItens.map(i => ({ descricao: i.descricao, qtd: i.qtd }))); avisar("Acrescentado ao " + numORC(acrescentar.numero) + ". O sistema foi avisado."); setAcrescentar(null); setTexto(""); await recarregarOrcamentos(); }
    catch (x) { avisar("Não foi possível acrescentar: " + (x.message || x), true); } finally { setSalvando(false); }
  };
  usarPasso(novo, () => setNovo(false));
  if (novo) return html`<${PedidoNovo} onCancelar=${() => setNovo(false)} onFeito=${async r => { setNovo(false); setFeito(r); await recarregarOrcamentos(); }} />`;
  const veicTxt = o => [exPlaca((o.veiculo || {}).placa), (o.veiculo || {}).marca, (o.veiculo || {}).modelo].filter(Boolean).join(" ");
  const acao = html`<div class="acao"><button type="button" class="btn-acao" id="orc-novo" onClick=${() => setNovo(true)}>+ Pedido de orçamento</button></div>`;
  return html`<${Tela} tela="orcamento" acao=${acao} ajuda="“+ Pedido de orçamento”: escreva o que é para orçar e envie; o sistema monta o orçamento com os preços. Os orçamentos abertos ficam aqui até serem aprovados ou recusados, e você pode acrescentar mais coisas. Quando o orçamento que você pediu for aprovado, o aviso aparece aqui com o número da O.S.">
    ${avisos.length ? html`<${Cartao} titulo="Avisos" id="orc-avisos">${avisos.map(o => html`<div class="aviso-orc" key=${o.id}>
      <div><b>${numORC(o.numero)} ${o.situacao === "aprovado" ? "aprovado" : "recusado"}</b>${o.situacao === "aprovado" && o.os_numero ? html` · virou a <b>${numOS(o.os_numero)}</b>` : null}<br /><span class="nota">${veicTxt(o)}${(o.cliente || {}).nome ? " · " + o.cliente.nome : ""}${o.situacao === "recusado" && o.motivo ? " · motivo: " + o.motivo : ""}</span></div>
      <button type="button" class="btn-barra curto claro" data-visto=${o.id} onClick=${() => { marcarVisto(o.id); recarregarOrcamentos(); }}>OK</button></div>`)}</${Cartao}>` : null}
    <${Cartao} titulo="Orçamentos abertos" id="orc-abertos">
      <input id="orc-busca" class="inp livre" autocomplete="off" placeholder="Buscar por placa, cliente ou número" value=${q} onInput=${e => setQ(e.target.value)} />
      ${!abertos.length ? html`<div class="vazio">${q ? "Nenhum orçamento aberto com esse texto." : perfil.papel === "mecanico" ? "Nenhum pedido de orçamento seu em aberto. Toque em “+ Pedido de orçamento” para pedir um." : "Nenhum orçamento em aberto. Toque em “+ Pedido de orçamento” para pedir um."}</div>` : html`<div class="nota">Toque num orçamento para ver o pedido.</div>`}</${Cartao}>
    ${abertos.map(o => html`<section class=${"orc-item" + (abertoId === o.id ? " aberto" : "")} key=${o.id}>
      <button type="button" class="orc-barra" data-orc=${o.id} aria-expanded=${abertoId === o.id ? "true" : "false"} onClick=${() => setAbertoId(abertoId === o.id ? "" : o.id)}>
        <b>${numORC(o.numero)}</b><span class="orc-veic">${veicTxt(o) || (o.cliente || {}).nome || "—"}</span><span class="orc-sit">${o.situacao === "elaboracao" ? "Em elaboração" : o.situacao === "enviado" ? "Enviado" : (SIT_ORC[o.situacao] || o.situacao)}</span><${Ic} n="down" t=${18} /></button>
      ${abertoId === o.id ? html`<div class="orc-corpo">
        <${KV} a="Veículo" b=${veicTxt(o) || "—"} p />${(o.cliente || {}).nome ? html`<${KV} a="Cliente" b=${o.cliente.nome} p />` : null}
        <${KV} a="Pedido em" b=${fmtData((o.criado_em || "").slice(0, 10)) + (o.consultor_nome ? " · " + o.consultor_nome : "")} p />
        <${Pedido} texto=${o.reclamacao} />
        ${o.validade ? html`<div class="nota">Válido até ${fmtData(o.validade)}.</div>` : null}
        <button type="button" class="btn-barra claro" data-acrescentar=${o.id} onClick=${() => { setAcrescentar(o); setTexto(""); setAcrItens([]); }}><${Ic} n="orc" t=${20} />Acrescentar ao pedido</button></div>` : null}</section>`)}
    ${acrescentar ? html`<${Quadro} titulo=${"Acrescentar ao " + numORC(acrescentar.numero)} onFechar=${() => setAcrescentar(null)}>
      <p class="nota">${veicTxt(acrescentar)}. O que mais é para orçar neste carro?</p>
      <${SistemasCarro} onMuda=${setAcrItens} />
      ${acrItens.length ? html`<div class="lista-marcados"><b>Marcados (${acrItens.length})</b>${acrItens.map((i, n) => html`<div key=${n} class=${i.falta ? "falta" : ""}>${i.qtd > 1 ? i.qtd + "× " : ""}${i.descricao}</div>`)}</div>` : null}
      <textarea id="ac-area" class="area" rows="3" placeholder="Observação (opcional): o que não está na lista" value=${texto} onInput=${e => setTexto(e.target.value)}></textarea>
      <button type="button" class="btn-acao" id="ac-gravar" disabled=${salvando} onClick=${gravarAcrescimo}>${salvando ? "Gravando…" : "Acrescentar"}</button>
      <button type="button" class="link" onClick=${() => setAcrescentar(null)}>Cancelar</button></${Quadro}>` : null}
    ${feito ? html`<${Quadro} titulo=${numORC(feito.numero) + " enviado"} onFechar=${() => setFeito(null)}>
      <p>O pedido chegou ao sistema com o aviso de novo orçamento. Quando for aprovado, o aviso aparece aqui em Orçamentos.</p>
      <button type="button" class="btn-acao" id="pd-entendi" onClick=${() => setFeito(null)}>Entendi</button></${Quadro}>` : null}
  </${Tela}>`;
}


/* ---------------- SISTEMAS DO CARRO: marcar os itens do orçamento (o mesmo do app do mecânico; pedido do Danilo, 18/11/2026) ----------------
 * A lista vem de js/appmecanico.js (padrão + ajustes do administrador em Sistema › App do mecânico). Sem preço: os itens vão para o
 * orçamento com valor zero e o Danilo põe os valores no sistema. onMuda recebe [{ descricao, qtd }]. */
const IcPeca = ({ nome, t = 30 }) => html`<svg width=${t} height=${t} viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONE_D[nome] || ICONE_D.chave || ""} /></svg>`;
function SistemasCarro({ onMuda }) {
  const { cfg } = useApp();
  const sistemas = useMemo(() => catalogoDoApp(cfg).filter(s => s.pecas.length), [cfg]);
  const [ativo, setAtivo] = useState(""), [pick, setPick] = useState({});   // pick: { "<sis>|<peça>": { q, pos } }
  const chave = (s, p) => s.id + "|" + p.orig;
  useEffect(() => {
    const itens = [];
    sistemas.forEach(s => s.pecas.forEach(p => { const v = pick[chave(s, p)]; if (v) itens.push({ descricao: nomeItemApp(p, v), qtd: p.tipo === "par" || p.tipo === "cont" ? v.q : 1, falta: opcoesPosicao(p).lista.length > 0 && !v.pos }); }));
    onMuda(itens);
  }, [pick]);
  const muda = (k, v) => setPick(o => { const n = { ...o }; if (v) n[k] = v; else delete n[k]; if (v && k === "sd|Bandeja / balança") delete n["sd|Bucha da bandeja"]; return n; });
  const sis = sistemas.find(s => s.id === ativo);
  usarPasso(!!ativo, () => setAtivo(""));
  const marcadosEm = s => s.pecas.filter(p => pick[chave(s, p)]).length;
  if (!sis) return html`<div class="sis-carro" id="sis-carro">${sistemas.map(s => html`<button type="button" key=${s.id} class="sistema" data-sis=${s.id} onClick=${() => setAtivo(s.id)}>
      <${IcPeca} nome=${s.icone} t=${34} /><span>${s.nome}</span>${marcadosEm(s) ? html`<em class="bolinha">${marcadosEm(s)}</em>` : null}</button>`)}</div>`;
  return html`<div class="sis-pecas" id="sis-pecas">
    <div class="linha"><button type="button" class="btn-busca g" aria-label="Voltar aos sistemas" style="background:#fff;color:#2f6fb5;border:1.5px solid #2f6fb5" onClick=${() => setAtivo("")}>‹</button>
      <div class="res-titulo" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px"><${IcPeca} nome=${sis.icone} t=${24} />${sis.nome.toUpperCase()}</div></div>
    ${sis.pecas.map(p => { const k = chave(sis, p), v = pick[k], op = opcoesPosicao(p);
      const qtd = p.tipo === "par" ? html`<div class="peca-q">${[1, 2].map(n => html`<button type="button" key=${n} aria-pressed=${v && v.q === n ? "true" : "false"} onClick=${() => muda(k, v && v.q === n ? null : { q: n, pos: v ? v.pos : "" })}>${n}</button>`)}</div>`
        : p.tipo === "cont" ? html`<div class="peca-q"><button type="button" aria-label="Menos" onClick=${() => muda(k, v && v.q > 1 ? { ...v, q: v.q - 1 } : null)}>−</button><b>${v ? v.q : 0}</b><button type="button" aria-label="Mais" onClick=${() => muda(k, { q: (v ? v.q : 0) + 1, pos: v ? v.pos : "" })}>+</button></div>` : null;
      return html`<div key=${k} class=${"peca-app" + (v ? " on" : "")} data-peca=${p.orig}>
        <button type="button" class="peca-topo" aria-pressed=${v ? "true" : "false"} onClick=${() => { if (p.tipo === "par" || p.tipo === "cont") muda(k, v ? null : { q: 1, pos: "" }); else muda(k, v ? null : { q: 1, pos: "" }); }}>
          <span class="peca-ic"><${IcPeca} nome=${p.icone} t=${30} /></span><span class="peca-nome">${p.nome}</span><span class="peca-cx">${v ? html`<${Ic} n="check" t=${16} sw=${2.6} />` : null}</span></button>
        ${v && (qtd || op.lista.length) ? html`<div class="peca-op">${qtd}
          ${op.lista.length ? html`<div class="peca-pos">${op.lista.map(nm => { const at = v.pos ? v.pos.split(", ") : [], on = op.multi ? at.includes(nm) : v.pos === nm;
            return html`<button type="button" key=${nm} aria-pressed=${on ? "true" : "false"} onClick=${() => muda(k, { ...v, pos: op.multi ? (on ? at.filter(x => x !== nm) : at.concat([nm])).join(", ") : (on ? "" : nm) })}>${nm}</button>`; })}</div>` : null}
          ${op.lista.length && !v.pos ? html`<span class="nota">Escolha a posição.</span>` : null}</div>` : null}</div>`; })}
    <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => setAtivo("")}>Pronto: voltar aos sistemas</button></div>`;
}

/* ---------------- O.S. no leiaute do app (nada do sistema abre dentro do app — regra do Danilo, 16/11/2026) ----------------
 * Só leitura, sem preço para quem não vê valores. Enquanto a O.S. está em andamento, o mecânico responsável (e administrador/consultor)
 * acrescenta "itens a orçar": vai para o histórico da O.S. (evento "a_orcar") e o sistema avisa. */
function OSDetalhe({ o, onFechar }) {
  const { perfil, avisar } = useApp();
  const ver = pode(perfil, "verValores");
  const [det, setDet] = useState(null), [erro, setErro] = useState(""), [texto, setTexto] = useState(""), [salvando, setSalvando] = useState(false), [escrevendo, setEscrevendo] = useState(false);
  const [osItens, setOsItens] = useState([]);
  const carregar = () => api.ordem(o.id).then(d => { setDet(d); setErro(""); }).catch(() => setErro("Não deu para carregar os itens da O.S. (sem internet?)."));
  useEffect(() => { let vivo = true; api.ordem(o.id).then(d => vivo && setDet(d)).catch(() => vivo && setErro("Não deu para carregar os itens da O.S. (sem internet?).")); return () => { vivo = false; }; }, [o.id]);
  const responsavel = perfil.papel === "admin" || perfil.papel === "consultor" || (o.mecanico_id && o.mecanico_id === perfil.id);
  const podeOrcar = ABERTA(o) && responsavel;
  const itens = (det && det.itens || []).filter(i => i.aprovado !== false), serv = itens.filter(i => i.tipo === "servico"), pecas = itens.filter(i => i.tipo !== "servico");
  const aOrcar = (det && det.eventos || []).filter(e => e.tipo === "a_orcar");
  const gravar = async () => {
    if (osItens.some(i => i.falta)) return avisar("Escolha a posição dos itens marcados.", true);
    const t = [osItens.map(i => (i.qtd > 1 ? i.qtd + "x " : "") + i.descricao).join("; "), texto.trim()].filter(Boolean).join(" · "); if (t.length < 3) return avisar("Marque os itens ou escreva o que é para orçar.", true);
    setSalvando(true);
    try { await api.evento(o.id, "a_orcar", t, perfil.nome); avisar("Itens a orçar enviados ao sistema para a " + numOS(o.numero) + "."); setTexto(""); setOsItens([]); setEscrevendo(false); await carregar(); }
    catch (x) { avisar("Não foi possível enviar: " + (x.message || x), true); } finally { setSalvando(false); }
  };
  const veic = o.veiculo || {};
  return html`<${Quadro} titulo=${numOS(o.numero)} onFechar=${onFechar}>
    <div class="os-cab"><span class="etapa">${etapaTexto(o)}</span>${o.mecanico_nome ? html`<span class="nota">Responsável: ${o.mecanico_nome}</span>` : null}</div>
    <${KV} a="Abertura" b=${fmtData((o.criado_em || "").slice(0, 10)) + (o.km_entrada ? " · " + fmtKm(o.km_entrada) : "")} />
    <${KV} a="Veículo" b=${[exPlaca(veic.placa), veic.marca, veic.modelo].filter(Boolean).join(" ") || "—"} p />
    ${(o.cliente || {}).nome ? html`<${KV} a="Cliente" b=${o.cliente.nome} p />` : null}
    ${o.reclamacao ? html`<div class="sec"><h3>O que o cliente pediu</h3><${Pedido} texto=${o.reclamacao} /></div>` : null}
    ${erro ? html`<div class="nota">${erro}</div>` : !det ? html`<div class="nota">Carregando os itens…</div>` : html`
      <div class="sec"><h3>Serviços</h3>${serv.length ? serv.map(i => html`<div class="check" key=${i.id}><${Ic} n="check" t=${16} sw=${2.4} />${i.descricao}${i.executado ? html` <span class="selo">Feito</span>` : null}</div>`) : html`<div class="nota">Nenhum serviço lançado.</div>`}</div>
      <div class="sec"><h3>Peças</h3>${pecas.length ? pecas.map(i => html`<div class="check" key=${i.id}><${Ic} n="peca" t=${16} sw=${2.2} />${Number(i.quantidade) > 1 ? i.quantidade + "× " : ""}${i.descricao}</div>`) : html`<div class="nota">Nenhuma peça lançada.</div>`}</div>
      ${ver ? html`<${KV} a="Total" b=${reais(o.total)} />` : null}`}
    ${aOrcar.length ? html`<div class="sec"><h3>Itens a orçar (pedidos pelo app)</h3>${aOrcar.map(e => html`<div class="acrescimo" key=${e.id}>— ${e.usuario_nome || "App"}, ${fmtData((e.criado_em || "").slice(0, 10))}: ${e.texto}</div>`)}</div>` : null}
    ${podeOrcar ? (escrevendo ? html`<div class="sec"><h3>Mais itens a orçar nesta O.S.</h3>
        <${SistemasCarro} onMuda=${setOsItens} />
        ${osItens.length ? html`<div class="lista-marcados"><b>Marcados (${osItens.length})</b>${osItens.map((x, n) => html`<div key=${n} class=${x.falta ? "falta" : ""}>${x.qtd > 1 ? x.qtd + "× " : ""}${x.descricao}</div>`)}</div>` : null}
        <textarea id="os-area" class="area" rows="3" placeholder="Ex.: vi a bucha da bandeja rasgada; orçar também o terminal" value=${texto} onInput=${e => setTexto(e.target.value)}></textarea>
        <button type="button" class="btn-acao" id="os-orcar-gravar" disabled=${salvando} onClick=${gravar}>${salvando ? "Enviando…" : "Enviar para o sistema"}</button>
        <button type="button" class="link" onClick=${() => setEscrevendo(false)}>Cancelar</button></div>`
      : html`<button type="button" class="btn-barra claro" id="os-orcar" onClick=${() => setEscrevendo(true)}><${Ic} n="orc" t=${20} />Acrescentar itens a orçar</button>`) : null}
    ${!podeOrcar && ABERTA(o) ? html`<div class="nota">Só o mecânico responsável por esta O.S. (ou o administrador/consultor) acrescenta itens a orçar.</div>` : null}
    <button type="button" class="link" onClick=${onFechar}>Fechar</button></${Quadro}>`;
}

/* ---------------- AGENDAR ---------------- */
const SERVICOS = ["Revisão", "Troca de óleo", "Freios", "Suspensão", "Outro serviço"];
const HORAS = ["07:30", "08:30", "09:30", "10:30", "13:00", "14:00", "15:00", "16:00"];
const SEM = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"], SEM_EXT = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
/** Páscoa (algoritmo de Meeus) */
function pascoa(ano) { const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1; return new Date(ano, mes - 1, dia); }
/** Feriados do ano: nacionais (lei), os móveis, o do Espírito Santo (N. Sra. da Penha) e o de Colatina (aniversário, 22/08). { "AAAA-MM-DD": nome } */
export function feriadosDoAno(ano) {
  const f = { [ano + "-01-01"]: "Confraternização Universal", [ano + "-04-21"]: "Tiradentes", [ano + "-05-01"]: "Dia do Trabalho", [ano + "-09-07"]: "Independência", [ano + "-10-12"]: "N. Sra. Aparecida",
    [ano + "-11-02"]: "Finados", [ano + "-11-15"]: "Proclamação da República", [ano + "-11-20"]: "Consciência Negra", [ano + "-12-25"]: "Natal", [ano + "-08-22"]: "Aniversário de Colatina" };
  const p = pascoa(ano), dd = n => { const x = new Date(p); x.setDate(p.getDate() + n); return iso(x); };
  f[dd(-48)] = "Carnaval"; f[dd(-47)] = "Carnaval"; f[dd(-2)] = "Sexta-feira Santa"; f[dd(60)] = "Corpus Christi"; f[dd(8)] = "N. Sra. da Penha (ES)";
  return f;
}
function Agendar() {
  const { dados, avisar, perfil } = useApp();
  const pl = usarPlaca();
  const hoje = hojeISO();
  const [a, setA] = useState(() => ({ clienteId: "", nome: "", whats: "", servico: 0, outro: "", data: hoje, hora: "", horaOutra: "", aviso: true, mes: hoje.slice(0, 7) }));
  const [busca, setBusca] = useState(false), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false), [feito, setFeito] = useState(null), [agenda, setAgenda] = useState({});
  const set = p => setA(o => ({ ...o, ...p }));
  useEffect(() => { const v = pl.veic; if (v && v.cliente && !a.clienteId && !a.nome) set({ clienteId: v.cliente.id, nome: v.cliente.nome, whats: v.cliente.telefone ? fmtTel(v.cliente.telefone) : "" }); }, [pl.veic]);
  // agendamentos do mês (só leitura): o dia mostra quantos já tem
  const [ano, mes] = a.mes.split("-").map(Number);
  useEffect(() => { let vivo = true; const de = a.mes + "-01", ate = iso(new Date(ano, mes, 0));
    api.agenda.listar({ de, ate }).then(l => { if (!vivo) return; const m = {}; (l || []).filter(x => x.situacao !== "cancelado").forEach(x => { m[x.data] = (m[x.data] || 0) + 1; }); setAgenda(m); }).catch(() => {});
    return () => { vivo = false; }; }, [a.mes]);
  const feriados = useMemo(() => feriadosDoAno(ano), [ano]);
  const primeiro = new Date(ano, mes - 1, 1), nDias = new Date(ano, mes, 0).getDate();
  const celulas = [...Array(primeiro.getDay()).fill(null), ...Array.from({ length: nDias }, (_, i) => iso(new Date(ano, mes - 1, i + 1)))];
  const mudarMes = n => { const d = new Date(ano, mes - 1 + n, 1); set({ mes: iso(d).slice(0, 7) }); };
  const servico = a.servico === SERVICOS.length - 1 ? a.outro.trim() : SERVICOS[a.servico];
  const hora = a.hora === "outra" ? a.horaOutra : a.hora;
  const dia = new Date(a.data + "T12:00:00");
  const resumo = (servico || "Serviço") + " · " + SEM_EXT[dia.getDay()] + ", " + a.data.slice(8, 10) + "/" + a.data.slice(5, 7) + (hora ? " às " + hora : "") + (feriados[a.data] ? " (feriado: " + feriados[a.data] + ")" : "");
  const trava = useRef(false);
  const gravar = async () => {
    if (trava.current) return;
    if (!a.nome.trim()) return setErro("Informe o nome do cliente.");
    if (!servico) return setErro("Escreva o serviço combinado.");
    if (a.data < hoje) return setErro("O dia já passou.");
    if (a.hora === "outra" && !/^\d{2}:\d{2}$/.test(a.horaOutra)) return setErro("Digite o horário como 08:00.");
    const tel = soDig(a.whats); if (tel && (tel.length < 10 || tel.length > 11)) return setErro("O WhatsApp precisa ter DDD (10 ou 11 números).");
    setErro(""); trava.current = true; setSalvando(true);
    try {
      const v = pl.veic, cli = dados.clientes.find(c => c.id === a.clienteId) || null;
      const r = await api.agenda.salvar({ data: a.data, hora: hora || null, situacao: "agendado", cliente_id: cli ? cli.id : null, veiculo_id: v && v.id ? v.id : null,
        cliente: cli ? { nome: cli.nome, telefone: cli.telefone || "" } : copiaClienteDig({ nome: a.nome, telefone: tel }),
        veiculo: v ? { placa: v.placa, marca: v.marca || "", modelo: v.modelo || "", ano: v.ano || "" } : { placa: "", marca: "", modelo: "", ano: "" },
        servico, obs: "Agendado pelo app.", motivo: "" });
      const zap = perfil.papel === "admin" && a.aviso && tel ? linkWhats(tel, mensagemAgenda(a.nome, servico, a.data, hora, v)) : "";
      setAgenda(m => ({ ...m, [a.data]: (m[a.data] || 0) + 1 }));
      setFeito({ r, zap });
    } catch (x) { setErro(x.message || String(x)); } finally { trava.current = false; setSalvando(false); }
  };
  // aviso pelo WhatsApp: só o administrador, num botão pequeno ao lado do resumo (pedido do Danilo, 16/11/2026 à noite)
  const admin = perfil.papel === "admin", avisa = admin && a.aviso;
  const acao = html`<div class="acao">
    <div class="resumo-linha"><div class="resumo">${resumo}</div>
      ${admin ? html`<button type="button" class=${"zap-mini" + (a.aviso ? " on" : "")} aria-pressed=${a.aviso ? "true" : "false"} title=${a.aviso ? "Vai abrir a confirmação no WhatsApp" : "Avisar o cliente pelo WhatsApp"} aria-label="Avisar o cliente pelo WhatsApp" onClick=${() => set({ aviso: !a.aviso })}><${Ic} n="zap" t=${20} sw=${1.8} /></button>` : null}</div>
    <button type="button" class="btn-acao" disabled=${salvando} onClick=${gravar}>${salvando ? "Gravando…" : avisa ? "Agendar e avisar o cliente" : "Agendar serviço"}</button></div>`;
  return html`<${Tela} tela="agendar" acao=${acao} ajuda="Busque a placa (opcional), informe o cliente, escolha o serviço, o dia no calendário (feriados em laranja; o número no canto é quantos serviços já tem no dia) e o horário. Com “Avisar o cliente” marcado, a mensagem de confirmação abre pronta no WhatsApp para você enviar.">
    ${erro ? html`<div class="erro" role="alert">${erro}</div>` : null}
    <${BuscaPlaca} id="ag-placa" titulo="Veículo" pl=${pl} /><${Veiculo} v=${pl.veic} />
    <${Cartao} titulo="Cliente">
      <${Campo} id="ag-nome" rotulo="Nome do cliente"><div class="linha"><input id="ag-nome" class="inp" autocomplete="off" placeholder="Nome" value=${a.nome} onInput=${e => set({ nome: e.target.value, clienteId: "" })} />
        <button type="button" class="btn-busca g" aria-label="Buscar cliente" onClick=${() => setBusca(true)}><${Ic} n="search" t=${22} /></button></div></${Campo}>
      <${Campo} id="ag-whats" rotulo="Contato (WhatsApp)"><input id="ag-whats" class="inp livre" inputmode="tel" autocomplete="off" placeholder="(27) 90000-0000" value=${a.whats} onInput=${e => set({ whats: e.target.value })} onBlur=${() => { const t = soDig(a.whats); if (t.length >= 10) set({ whats: fmtTel(t) }); }} /></${Campo}></${Cartao}>
    <${Cartao} titulo="Serviço"><div class="chips" role="group" aria-label="Serviço">${SERVICOS.map((s, i) => html`<button type="button" key=${s} class="btn-chip" aria-pressed=${a.servico === i ? "true" : "false"} onClick=${() => set({ servico: i })}>${s}</button>`)}</div>
      ${a.servico === SERVICOS.length - 1 ? html`<input id="ag-outro" class="inp livre" autocomplete="off" placeholder="Qual serviço?" value=${a.outro} onInput=${e => set({ outro: e.target.value })} />` : null}</${Cartao}>
    <${Cartao} titulo="Dia" id="ag-dia"><div class="dias-nav"><button type="button" aria-label="Mês anterior" disabled=${a.mes <= hoje.slice(0, 7)} onClick=${() => mudarMes(-1)}>‹</button><span id="ag-mes">${MESES[mes - 1]} de ${ano}</span><button type="button" aria-label="Próximo mês" onClick=${() => mudarMes(1)}>›</button></div>
      <div class="cal-sem" aria-hidden="true">${SEM.map(x => html`<span key=${x}>${x}</span>`)}</div>
      <div class="cal" role="group" aria-label="Dia">${celulas.map((d, i) => d === null ? html`<span key=${"v" + i}></span>` : html`<button type="button" key=${d} class=${"cal-dia" + (feriados[d] ? " feriado" : "") + (new Date(d + "T12:00:00").getDay() === 0 ? " domingo" : "")} disabled=${d < hoje} aria-pressed=${a.data === d ? "true" : "false"} aria-label=${SEM_EXT[new Date(d + "T12:00:00").getDay()] + " " + d.slice(8, 10) + (feriados[d] ? ", feriado: " + feriados[d] : "") + (agenda[d] ? ", " + agenda[d] + " agendado(s)" : "")} onClick=${() => set({ data: d })}>${+d.slice(8, 10)}${agenda[d] ? html`<i>${agenda[d]}</i>` : null}</button>`)}</div>
      <div class="cal-legenda"><span><b class="lg feriado"></b>Feriado</span><span><b class="lg sel"></b>Dia escolhido</span><span><i>2</i>serviços já agendados</span></div>
      ${feriados[a.data] ? html`<div class="nota" id="ag-feriado"><span class="selo atencao">Feriado</span>${feriados[a.data]}. Dá para agendar mesmo assim.</div>` : null}</${Cartao}>
    <${Cartao} titulo="Horário"><div class="horas" role="group" aria-label="Horário">${HORAS.map(h => html`<button type="button" key=${h} class="hora" aria-pressed=${a.hora === h ? "true" : "false"} onClick=${() => set({ hora: h })}>${h}</button>`)}
        <button type="button" class="hora" aria-pressed=${a.hora === "outra" ? "true" : "false"} onClick=${() => set({ hora: "outra" })}>Outro</button>
        <button type="button" class="hora" aria-pressed=${a.hora === "" ? "true" : "false"} onClick=${() => set({ hora: "" })}>Sem hora</button></div>
      ${a.hora === "outra" ? html`<input id="ag-hora" class="inp livre" type="time" value=${a.horaOutra} onInput=${e => set({ horaOutra: e.target.value })} />` : null}</${Cartao}>
    ${busca ? html`<${BuscaClienteQuadro} onEscolha=${c => { set({ clienteId: c.id, nome: c.nome, whats: c.telefone ? fmtTel(c.telefone) : "" }); setBusca(false); }} onFechar=${() => setBusca(false)} />` : null}
    ${feito ? html`<${Quadro} titulo="Agendado" onFechar=${() => { setFeito(null); ir("inicio"); }}>
      <p>${resumo}.</p>
      ${feito.zap ? html`<a class="btn-acao" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href=${feito.zap} target="_blank" rel="noopener">Abrir a mensagem no WhatsApp</a><p class="nota">A mensagem abre pronta; quem envia é você.</p>` : null}
      <button type="button" class="link" onClick=${() => { setFeito(null); ir("inicio"); }}>Voltar ao Início</button></${Quadro}>` : null}
  </${Tela}>`;
}
/** mensagem no padrão da DTCar (saudação, "senhor", tópicos, assinatura) */
function mensagemAgenda(nome, servico, data, hora, v) {
  const h = new Date().getHours(), saud = h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
  const d = new Date(data + "T12:00:00");
  return `${saud}, Sr. ${nome.trim().split(" ")[0]}!\n\nConfirmamos o agendamento do senhor na DTCar:\n• Serviço: ${servico}\n• Dia: ${SEM_EXT[d.getDay()].toLowerCase()}, ${fmtData(data)}${hora ? "\n• Horário: " + hora : ""}${v ? "\n• Veículo: " + [nomeVeic(v), exPlaca(v.placa)].filter(Boolean).join(" ") : ""}\n\nQualquer imprevisto, é só avisar por aqui.\n\nDTCar Centro Automotivo\n*Mensagem gerada pelo sistema Gestão DTCar*`;
}

/* ---------------- ÓLEO (APLICAÇÃO) ---------------- */
function Oleo() {
  const { dados } = useApp(); const pl = usarPlaca();
  const [cat, setCat] = useState(null), [erro, setErro] = useState(""), [mao, setMao] = useState({ modelo: "", ano: "" }), [verFiltros, setVerFiltros] = useState(true);
  useEffect(() => { carregarCatalogo().then(setCat).catch(() => setErro("Não deu para carregar o catálogo. Confira a internet e tente de novo.")); }, []);
  const estoque = useMemo(() => indiceEstoque(dados.produtos), [dados.produtos]);
  const v = pl.veic;
  const r = useMemo(() => { if (!cat) return null; if (v) return pesquisarVeiculo(cat, { marca: v.marca, modelo: v.modelo, ano: v.ano, motor: v.motor, combustivel: v.combustivel }, "").r; if (mao.modelo.trim().length >= 2) return pesquisar(cat, mao.modelo, mao.ano); return null; }, [cat, v, mao]);
  const oleos = useMemo(() => r ? resumoOleo(r.oleo, r.ano) : [], [r]);
  const apl = r && r.filtros[0];
  const filtro = (k) => filtroParaMostrar(cat, estoque, apl.marca, apl[k]);
  return html`<${Tela} tela="oleo" ajuda="Busque a placa: o app mostra a quantidade e a viscosidade do óleo do motor e os filtros do carro, com o que há no estoque. É dado de catálogo: confira antes de aplicar.">
    <${BuscaPlaca} id="ol-placa" pl=${pl} /><${Veiculo} v=${v} />
    ${!v ? html`<${ModeloAMao} valor=${mao} onMuda=${setMao} />` : null}
    ${erro ? html`<div class="erro">${erro}</div>` : !cat ? html`<div class="carregando">Carregando o catálogo…</div>` : null}
    ${cat && r && !oleos.length && !r.filtros.length ? html`<div class="vazio">Nada no catálogo para ${v ? nomeVeic(v) : mao.modelo}. ${v ? "Tente digitar o modelo de outro jeito, sem a placa." : "Tente só o nome do modelo."}</div>` : null}
    ${cat && oleos.length ? html`<${Cartao} titulo="Óleo do motor" id="ol-oleo">
      ${oleos.map((g, i) => html`<div key=${i} class=${"oleo-linha" + (i ? " outra" : "")}>${i ? html`<div class="nota">Outra resposta do catálogo:</div>` : null}
        <div class="visc">${g.viscosidade || "—"}</div><${KV} a="Litragem" b=${g.litros ? g.litros + " L" : "—"} /><${KV} a="Viscosidade" b=${g.viscosidade || "—"} />
        <${KV} a="Carro" b=${g.linha.modelo + " " + (g.linha.motor || "") + (periodoTexto(g.linha) ? " · " + periodoTexto(g.linha) : "")} p /><${KV} a="Norma" b=${g.linha.norma || "—"} p /><${KV} a="Fonte" b=${g.linha.fonte || "catálogo"} p />
        ${g.linha.aviso ? html`<div class="nota"><span class="selo atencao">Atenção</span>${g.linha.aviso}</div>` : null}</div>`)}
      <div class="nota">Dado de catálogo: confira no manual antes de aplicar.</div></${Cartao}>` : null}
    ${cat && apl ? html`<button type="button" class="btn-barra" aria-expanded=${verFiltros ? "true" : "false"} onClick=${() => setVerFiltros(!verFiltros)}><${Ic} n="sliders" t=${22} />${verFiltros ? "Ocultar filtros" : "Ver filtros"}</button>
      ${verFiltros ? html`<${Cartao} titulo="Filtros" id="ol-filtros"><div class="nota" style="margin-bottom:2px">${apl.montadora} ${apl.modelo} ${[apl.versao, apl.motor, periodoTexto(apl)].filter(Boolean).join(" · ")} · catálogo ${apl.catalogo}</div>
        ${TIPOS_FILTRO.map(([k, t]) => { const f = filtro(k); return html`<div class="sec" key=${k}><h3>Filtro de ${t.toLowerCase() === "óleo" ? "óleo" : t.toLowerCase() === "ar" ? "ar do motor" : t.toLowerCase() === "cabine" ? "ar-condicionado" : t.toLowerCase()}</h3>
          ${!f ? html`<div class="nota">Sem código no catálogo.</div>` : html`<div class="cab2"><span>Fabricante:</span><span>Código:</span></div>
            ${f.estoque ? f.estoque.map(e => html`<${KV} key=${e.codigo} a=${e.marca || "Estoque"} b=${html`<span class="selo">Em estoque · ${e.qtd} un.</span>${e.codigo}`} p />`) : null}
            ${!f.estoque ? MARCAS_PRINCIPAIS.map(m => html`<${KV} key=${m} a=${m === "MAHLE" ? "Mahle" : m} b=${f.principais[m].length ? f.principais[m].join(" / ") : "—"} p />`) : null}
            ${f.semSaldo && f.semSaldo.length ? html`<div class="nota">Cadastrado, sem saldo: ${f.semSaldo.map(e => (e.marca ? e.marca + " " : "") + e.codigo).join(", ")}</div>` : null}
            ${f.conversao && f.conversao.length ? html`<div class="nota">Conversão: ${f.conversao.slice(0, 4).map(c => c.marca + " " + c.codigos.join("/")).join(" · ")}</div>` : null}`}</div>`; })}
        <div class="nota">Filtro com saldo no estoque aparece primeiro. Conversão Tecfil 2026.</div></${Cartao}>` : null}` : null}
  </${Tela}>`;
}

/* ---------------- CONSULTAR PEÇA POR CATÁLOGO ---------------- */
const LS_LISTA = "dtcar-app-lista-pecas";
// Sistemas do carro (pedido do Danilo, 16/11/2026): o resultado só aparece depois de tocar no sistema. Cada grupo do catálogo cai num sistema.
const SISTEMAS = [
  { id: "fr", nome: "Freios", icone: "disco", re: /freio|pin[cç]a|cilindro mestre|cilindro de roda|servo|hidrov|hydrov|lona|sapata|tambor|disco|pastilha/i },
  { id: "tr", nome: "Transmissão", icone: "engrenagem", re: /embreagem|homocin|junta fixa|tulipa|semieixo|tripe[cç]a|trizeta|junta deslizante|cardan|cruzeta|coroa|pinh[aã]o|c[aâ]mbio|diferencial|flange|luva|garfo|mancal central|planet|veloc[ií]metro|transmiss/i },
  { id: "di", nome: "Direção", icone: "volante", re: /dire[cç][aã]o|terminal|axial|ponteira|barra de liga|barra central|barra lateral/i },
  { id: "su", nome: "Suspensão", icone: "amortecedor", re: /amortecedor|mola|bandeja|bra[cç]o|piv[oô]|bieleta|bucha|batente|estabiliz|tirante|barra de rea|cubo|mancal do cubo|suspens|pino|apoio|prato/i },
  { id: "mo", nome: "Motor", icone: "motor", re: /motor|junta|cabe[cç]ote|bomba d|bomba de [oó]leo|reservat|anel|mangueira|abra[cç]adeira|acelerador|correia|coxim|suporte|filtro|palheta|parafuso/i },
];
const OUTROS_RE = /mola a g[aá]s/i; // mola do capô e do porta-malas não é suspensão
const sistemaDoGrupo = g => { if (OUTROS_RE.test(g || "")) return "ou"; const x = SISTEMAS.find(sis => sis.re.test(g || "")); return x ? x.id : "ou"; };
const IcSis = ({ nome, t = 30 }) => html`<svg width=${t} height=${t} viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d=${ICONE_D[nome] || ICONE_D.chave}></path></svg>`;
function Peca() {
  const { dados, avisar } = useApp(); const pl = usarPlaca();
  const [cat, setCat] = useState(null), [erro, setErro] = useState(""), [mao, setMao] = useState({ modelo: "", ano: "" }), [sis, setSis] = useState(""), [txt, setTxt] = useState(""), [lim, setLim] = useState(20), [lista, setLista] = useState(() => lsGet(LS_LISTA) || []), [verLista, setVerLista] = useState(false);
  useEffect(() => { carregarPecas().then(setCat).catch(() => setErro("Não deu para abrir o catálogo de peças. Confira a internet.")); }, []);
  useEffect(() => { lsSet(LS_LISTA, lista); }, [lista]);
  const v = pl.veic;
  const veic = v ? { marca: v.marca, modelo: v.modelo, ano: v.ano_mod || v.ano } : mao.modelo.trim().length >= 2 ? { marca: "", modelo: mao.modelo.trim(), ano: mao.ano } : null;
  useEffect(() => { setSis(""); setTxt(""); setLim(20); }, [v && v.placa, veic && veic.modelo]);
  const estoque = useMemo(() => dados.produtos.filter(p => p.ativo !== false && p.tipo === "produto" && p.referencia && Number(p.estoque_atual) > 0).map(p => ({ id: p.id, ref: p.referencia, descricao: p.descricao, qtd: Number(p.estoque_atual), preco: p.preco_vista })), [dados.produtos]);
  const r = useMemo(() => { if (!cat || !veic) return null; const x = pecasDoVeiculo(cat, veic); return { ...x, grupos: agruparEquivalentes(x.grupos, estoque) }; }, [cat, veic && veic.marca, veic && veic.modelo, veic && veic.ano, estoque]);
  const porSistema = useMemo(() => { const m = {}; (r ? r.grupos : []).forEach(g => { const k = sistemaDoGrupo(g.grupo); m[k] = (m[k] || 0) + g.itens.length; }); return m; }, [r]);
  const grupos = useMemo(() => r && sis ? filtrarPecas(r.grupos.filter(g => sistemaDoGrupo(g.grupo) === sis), txt) : [], [r, sis, txt]);
  const itens = grupos.flatMap(g => g.itens.map(e => ({ ...e, grupo: g.grupo })));
  const precoRef = e => { const p = e.estoque ? dados.produtos.find(x => x.id === e.estoque.id) : null; return p && p.preco_vista ? reais(p.preco_vista) : "—"; };
  const adicionar = e => { const p = e.peca; if (lista.some(x => x.codigo === p.codigo && x.marca === p.marca)) return avisar("Já está na lista."); setLista(l => l.concat([{ marca: p.marca, codigo: p.codigo, oem: chaveDaPeca(p), descricao: p.descricao, placa: v ? v.placa : "", carro: veic ? [veic.marca, veic.modelo, veic.ano].filter(Boolean).join(" ") : "", estoque: e.estoque ? e.estoque.descricao + " (" + e.estoque.qtd + " un)" : "" }])); avisar("Item adicionado à lista."); };
  const textoLista = () => lista.map((x, i) => `${i + 1}. ${x.descricao} — ${x.marca} ${x.codigo}${x.oem !== x.codigo ? " (orig. " + x.oem + ")" : ""}${x.carro ? " · " + x.carro : ""}${x.placa ? " · " + exPlaca(x.placa) : ""}`).join("\n");
  const compartilhar = async () => { const t = "Lista de peças · DTCar\n" + textoLista(); try { if (navigator.share) await navigator.share({ title: "Lista de peças", text: t }); else { await navigator.clipboard.writeText(t); avisar("Lista copiada."); } } catch (e) { /* cancelou */ } };
  const sisAtual = SISTEMAS.find(x => x.id === sis);
  usarPasso(!!sis, () => setSis(""));
  const [fotoAberta, setFotoAberta] = useState(null);
  return html`<${Tela} tela="peca" ajuda="Busque a placa (ou digite o modelo), toque no sistema do carro (freios, suspensão…) e veja as peças de catálogo que servem nele, com conversão de marcas e o que há no estoque. “Adicionar item” monta uma lista para cotar ou enviar.">
    <${BuscaPlaca} id="pc-placa" pl=${pl} /><${Veiculo} v=${v} />
    ${!v ? html`<${ModeloAMao} valor=${mao} onMuda=${setMao} />` : null}
    ${erro ? html`<div class="erro">${erro}</div>` : veic && !cat ? html`<div class="carregando">Carregando o catálogo de peças…</div>` : null}
    ${r && !r.total ? html`<div class="vazio">Nenhuma peça de catálogo para ${r.entendido || nomeVeic(veic)}.</div>` : null}
    ${r && r.total && !sis ? html`<${Cartao} titulo="Escolha o sistema" id="pc-sistemas">
      <div class="sistemas">${SISTEMAS.concat([{ id: "ou", nome: "Outros", icone: "chave" }]).map(x => html`<button type="button" key=${x.id} class="sistema" disabled=${!porSistema[x.id]} data-sistema=${x.id} onClick=${() => { setSis(x.id); setTxt(""); setLim(20); }}><${IcSis} nome=${x.icone} /><span>${x.nome}</span><small>${porSistema[x.id] || 0} ${porSistema[x.id] === 1 ? "peça" : "peças"}</small></button>`)}</div>
      ${r.entendido ? html`<div class="nota">Buscando por: <b>${r.entendido}</b>${r.ano ? "" : " (sem ano: aparecem todos os anos)"}</div>` : null}</${Cartao}>` : null}
    ${r && sis ? html`<section class="cartao liso" id="pc-busca">
      <div class="linha"><button type="button" class="btn-busca g" aria-label="Voltar aos sistemas" style="background:#fff;color:#2f6fb5;border:1.5px solid #2f6fb5" onClick=${() => setSis("")}>‹</button>
        <div class="res-titulo" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px"><${IcSis} nome=${sisAtual ? sisAtual.icone : "chave"} t=${22} />${sisAtual ? sisAtual.nome.toUpperCase() : "OUTROS"}</div></div>
      <div class="linha"><input id="pc-q" class="inp livre" type="search" autocomplete="off" placeholder="Pesquisar peça: bandeja, pastilha, código…" value=${txt} onInput=${e => { setTxt(e.target.value); setLim(20); }} /><span class="btn-busca g" aria-hidden="true"><${Ic} n="search" t=${22} /></span></div></section>
      ${itens.length ? html`<div class="res-titulo">RESULTADO DA PESQUISA (${itens.length})</div>
      ${itens.slice(0, lim).map(e => { const p = e.peca, conv = conversaoDoItem(e); return html`<section class="cartao liso" key=${p.marca + p.codigo}>
        ${p.foto ? html`<${FotoPeca} p=${p} onAbrir=${() => setFotoAberta(e)} />` : null}
        <button type="button" class="btn-barra" style="justify-content:center" onClick=${() => adicionar(e)}>Adicionar item</button>
        <${KV} a="Marca" b=${p.marca} /><${KV} a="Descrição" b=${p.descricao} p /><${KV} a="Código" b=${p.codigo} />
        ${p.oem && p.oem.length ? html`<${KV} a="Cód. montadora" b=${p.oem.slice(0, 2).join(" / ")} p />` : null}
        <${KV} a="Aplicação" b=${(e.aplicacoes || []).slice(0, 2).join(" · ") || "—"} p />
        ${p.medidas ? html`<${KV} a="Medidas" b=${p.medidas} p />` : null}
        <${KV} a="Valor de referência" b=${precoRef(e)} />
        ${e.estoque ? html`<div class="nota"><span class="selo">Tem no estoque</span>${e.estoque.descricao} (${e.estoque.qtd} un)</div>` : null}
        ${conv.length ? html`<div class="nota">Conversão: ${conv.slice(0, 4).map(c => c.marca.replace("Montadora (original)", "Montadora") + " " + c.codigos.slice(0, 2).join(" / ")).join(" · ")}${conv.length > 4 ? " · e mais " + (conv.length - 4) : ""}</div>` : null}
        ${e.conferir ? html`<div class="nota"><span class="selo atencao">Confira a versão</span>catálogo antigo para este ano</div>` : null}</section>`; })}
      ${itens.length > lim ? html`<button type="button" class="btn-barra claro" style="justify-content:center" onClick=${() => setLim(lim + 20)}>Ver mais (${itens.length - lim})</button>` : null}` : html`<div class="vazio">Nada com esse filtro.</div>`}` : null}
    <div style="margin-top:auto;flex-shrink:0"><button type="button" class="btn-barra curto" onClick=${() => setVerLista(true)}><${Ic} n="share" t=${20} />Ver lista (${lista.length})</button></div>
    ${fotoAberta ? html`<${Quadro} titulo=${fotoAberta.peca.marca + " " + fotoAberta.peca.codigo} onFechar=${() => setFotoAberta(null)}>
      <${FotoPeca} p=${fotoAberta.peca} grande />
      <p><b>${fotoAberta.peca.descricao}</b></p>
      ${fotoAberta.peca.medidas ? html`<${KV} a="Medidas" b=${fotoAberta.peca.medidas} p />` : null}
      <${KV} a="Aplicação" b=${(fotoAberta.aplicacoes || []).slice(0, 4).join(" · ") || "—"} p />
      <button type="button" class="btn-acao" onClick=${() => { adicionar(fotoAberta); setFotoAberta(null); }}>Adicionar item</button>
      <button type="button" class="link" onClick=${() => setFotoAberta(null)}>Fechar</button></${Quadro}>` : null}
    ${verLista ? html`<${Quadro} titulo=${"Lista de peças (" + lista.length + ")"} onFechar=${() => setVerLista(false)}>
      ${!lista.length ? html`<div class="vazio">A lista está vazia. Toque em “Adicionar item” nas peças.</div>` : html`<div class="lista-itens">${lista.map((x, i) => html`<div class="item-linha" key=${i}><span><b>${x.descricao}</b><br /><span class="nota">${x.marca} ${x.codigo}${x.carro ? " · " + x.carro : ""}${x.estoque ? " · estoque: " + x.estoque : ""}</span></span><button type="button" aria-label="Tirar da lista" onClick=${() => setLista(l => l.filter((_, j) => j !== i))}>Tirar</button></div>`)}</div>
        <button type="button" class="btn-acao" onClick=${compartilhar}>Enviar / copiar a lista</button>
        <button type="button" class="link" onClick=${() => { if (window.confirm("Limpar a lista?")) setLista([]); }}>Limpar a lista</button>`}
      <button type="button" class="link" onClick=${() => setVerLista(false)}>Fechar</button></${Quadro}>` : null}
  </${Tela}>`;
}

/* ---------------- HISTÓRICO DE SERVIÇOS ---------------- */
const ordensDoVeiculo = (dados, v) => dados.ordens.filter(o => !o._pendente && ((v.id && o.veiculo_id === v.id) || ((o.veiculo || {}).placa || "") === v.placa)).sort((a, b) => (b.criado_em || "").localeCompare(a.criado_em || ""));
function Historico() {
  const { dados } = useApp(); const pl = usarPlaca();
  const v = pl.veic;
  const ordens = useMemo(() => v ? ordensDoVeiculo(dados, v) : [], [dados.ordens, v]);
  const [itens, setItens] = useState({}), [erro, setErro] = useState(""), [aberta, setAberta] = useState(null);
  useEffect(() => { let vivo = true; setErro(""); const ids = ordens.map(o => o.id).filter(id => !itens[id]); if (!ids.length) return;
    api.itensDasOrdens(ids.slice(0, 60)).then(l => { if (!vivo) return; const m = {}; ids.forEach(id => { m[id] = []; }); l.forEach(i => { (m[i.ordem_id] = m[i.ordem_id] || []).push(i); }); setItens(x => ({ ...x, ...m })); })
      .catch(() => vivo && setErro("Não deu para carregar os serviços de cada O.S. (sem internet?). Mostrando só o que o cliente pediu."));
    return () => { vivo = false; }; }, [ordens]);
  const servicos = o => { const l = (itens[o.id] || []).filter(i => i.tipo === "servico" && i.aprovado !== false).map(i => i.descricao); if (l.length) return l; return o.reclamacao ? [o.reclamacao] : []; };
  return html`<${Tela} tela="historico" ajuda="Busque a placa: aparecem todas as O.S. do carro, da mais nova para a mais antiga, com a data, o KM e os serviços feitos. Toque em uma O.S. para ver os detalhes (sem preço).">
    <${BuscaPlaca} id="hs-placa" pl=${pl} /><${Veiculo} v=${v} />
    ${erro ? html`<div class="nota" style="padding:0 6px">${erro}</div>` : null}
    ${!v ? html`<div class="vazio">Digite a placa para ver o histórico de serviços.</div>` : !ordens.length ? html`<div class="vazio">Nenhuma O.S. deste veículo no sistema.</div>` : null}
    ${ordens.map(o => html`<${Cartao} key=${o.id} titulo=${fmtData((o.criado_em || "").slice(0, 10)) + (o.km_entrada ? " · " + fmtKm(o.km_entrada) : "")}>
      ${servicos(o).length ? servicos(o).map((s, i) => html`<div class="check" key=${i}><${Ic} n="check" t=${16} sw=${2.4} />${s}</div>`) : html`<div class="nota">${itens[o.id] ? "Sem serviço lançado." : "Carregando…"}</div>`}
      <div class="nota">${numOS(o.numero)} · ${(situacaoOS(o) || STATUS[o.status] || {}).t || o.status}${o.mecanico_nome ? " · " + o.mecanico_nome : ""}</div>
      <button type="button" class="btn-barra" style="justify-content:center" data-os=${o.id} onClick=${() => setAberta(o)}><${Ic} n="os" t=${22} />Ver ${numOS(o.numero)}</button></${Cartao}>`)}
    ${aberta ? html`<${OSDetalhe} o=${aberta} onFechar=${() => setAberta(null)} />` : null}
  </${Tela}>`;
}

/* ---------------- foto da peça (acervo do catálogo: catalogo/fotos/<pasta>/<foto>.jpg; sempre que houver, aparece) ---------------- */
const urlFotoPeca = p => new URL("../catalogo/fotos/" + p.pasta + "/" + p.foto + ".jpg", import.meta.url).href;
function FotoPeca({ p, grande = false, onAbrir = null }) {
  const [falhou, setFalhou] = useState(false);
  if (!p.foto || falhou) return null;
  const img = html`<img class=${grande ? "foto-peca grande" : "foto-peca"} loading=${grande ? "eager" : "lazy"} alt=${"Foto da peça " + p.codigo} src=${urlFotoPeca(p)} onError=${() => setFalhou(true)} />`;
  return onAbrir ? html`<button type="button" class="foto-peca-btn" aria-label=${"Ampliar a foto da peça " + p.codigo} onClick=${onAbrir}>${img}</button>` : img;
}

/* ---------------- CONSULTAR O.S. ---------------- */
function OSConsulta() {
  const { dados, perfil } = useApp(); const pl = usarPlaca();
  const v = pl.veic, ver = pode(perfil, "verValores");
  const ordens = useMemo(() => v ? ordensDoVeiculo(dados, v) : [], [dados.ordens, v]);
  const [q, setQ] = useState(""), [aberta, setAberta] = useState(null);
  const porNumero = useMemo(() => { const d = soDig(q); if (!d) return []; return dados.ordens.filter(o => String(o.numero) === String(+d)).slice(0, 3); }, [q, dados.ordens]);
  const lista = v ? ordens : porNumero;
  return html`<${Tela} tela="osconsulta" ajuda="Busque a placa (ou digite o número da O.S.) e veja as O.S. do carro com abertura, situação e serviços. “Ver O.S.” mostra os serviços e as peças; na O.S. em andamento, o responsável acrescenta itens a orçar.">
    <${BuscaPlaca} id="oc-placa" pl=${pl} /><${Veiculo} v=${v} />
    ${!v ? html`<${Cartao} titulo="Ou pelo número da O.S."><input id="oc-num" class="inp livre" inputmode="numeric" autocomplete="off" placeholder="Ex.: 1927" value=${q} onInput=${e => setQ(e.target.value)} /></${Cartao}>` : null}
    ${!lista.length ? html`<div class="vazio">${v ? "Nenhuma O.S. deste veículo." : "Digite a placa ou o número da O.S."}</div>` : null}
    ${lista.map(o => html`<${Cartao} key=${o.id} titulo=${numOS(o.numero)}>
      <${KV} a="Abertura" b=${fmtData((o.criado_em || "").slice(0, 10))} /><${KV} a="Situação" b=${(situacaoOS(o) || STATUS[o.status] || {}).t || o.status} />
      <${KV} a="Serviços" b=${o.reclamacao ? String(o.reclamacao).slice(0, 80) : "—"} p />
      ${ver ? html`<${KV} a="Total" b=${reais(o.total)} />` : null}
      ${!v && (o.veiculo || {}).placa ? html`<${KV} a="Veículo" b=${[(o.veiculo || {}).modelo, exPlaca(o.veiculo.placa)].filter(Boolean).join(" · ")} p />` : null}
      <button type="button" class="btn-barra" data-os=${o.id} onClick=${() => setAberta(o)}><${Ic} n="os" t=${22} />Ver O.S.</button></${Cartao}>`)}
    ${aberta ? html`<${OSDetalhe} o=${aberta} onFechar=${() => setAberta(null)} />` : null}
  </${Tela}>`;
}


/* ---------------- INICIAR SERVIÇO (mecânico): O.S. pela placa → iniciar, pausar com motivo, finalizar marcando o que fez e indicando responsável ---------------- */
const MOTIVOS_PAUSA = ["Aguardando peças", "Aguardando aprovação do cliente", "Outro serviço na frente", "Fim do expediente", "Outro motivo"];
const hhmm = iso => iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "";
const minutosAp = s => { const ini = new Date(s.inicio).getTime(), fim = s.fim ? new Date(s.fim).getTime() : Date.now();
  const pausado = (Array.isArray(s.pausas) ? s.pausas : []).reduce((t, p) => t + (p.em ? ((p.retomado_em ? new Date(p.retomado_em).getTime() : (s.fim ? new Date(s.fim).getTime() : Date.now())) - new Date(p.em).getTime()) : 0), 0);
  return Math.max(0, Math.round((fim - ini - pausado) / 60000)); };
const tempoTxt = min => min >= 60 ? Math.floor(min / 60) + "h" + (min % 60 ? String(min % 60).padStart(2, "0") : "") : min + " min";
const CH_PLACA_PEDIDO = "dtcar-app-placa-pedido";   // placa levada de "Iniciar serviço" para o pedido de orçamento
/** O.S. (resumo do cabeçalho) + itens de serviço carregados, para a tela do serviço */
function usarOS(o) {
  const [det, setDet] = useState(null), [erro, setErro] = useState("");
  const carregar = () => api.ordem(o.id).then(d => { setDet(d); setErro(""); }).catch(() => setErro("Não deu para carregar os itens da O.S. (sem internet?)."));
  useEffect(() => { let vivo = true; setDet(null); api.ordem(o.id).then(d => vivo && setDet(d)).catch(() => vivo && setErro("Não deu para carregar os itens da O.S. (sem internet?).")); return () => { vivo = false; }; }, [o.id]);
  const servicos = (det && det.itens || []).filter(i => i.tipo === "servico" && i.aprovado !== false);
  const aOrcar = (det && det.eventos || []).filter(e => e.tipo === "a_orcar");
  return { det, erro, servicos, aOrcar, recarregar: carregar };
}
/** o que precisa ser feito no carro (sem preço) */
function OQueFazer({ o, os }) {
  return html`${o.reclamacao ? html`<div class="sec"><h3>O que o cliente pediu</h3><${Pedido} texto=${o.reclamacao} /></div>` : null}
    <div class="sec"><h3>Serviços</h3>${os.erro ? html`<div class="nota">${os.erro}</div>` : !os.det ? html`<div class="nota">Carregando…</div>` : os.servicos.length ? os.servicos.map(i => html`<div class="check" key=${i.id}><${Ic} n="check" t=${16} sw=${2.4} />${i.descricao}${i.executado ? html` <span class="selo">Feito</span>` : null}</div>`) : html`<div class="nota">Nenhum serviço lançado ainda (veja o pedido acima).</div>`}</div>
    ${os.aOrcar.length ? html`<div class="sec"><h3>Itens a orçar (pedidos pelo app)</h3>${os.aOrcar.map(e => html`<div class="acrescimo" key=${e.id}>— ${e.usuario_nome || "App"}: ${e.texto}</div>`)}</div>` : null}`;
}
function ServicoAberto({ s, o, onMudou }) {
  const { perfil, dados, avisar } = useApp();
  const os = usarOS(o);
  const [pausar, setPausar] = useState(false), [motivo, setMotivo] = useState(""), [outro, setOutro] = useState(""), [finalizar, setFinalizar] = useState(false), [feitos, setFeitos] = useState({}), [resp, setResp] = useState({}), [salvando, setSalvando] = useState(false);
  const veic = o.veiculo || {};
  const pessoas = (dados.perfis || []).filter(p => p.id !== perfil.id && p.ativo !== false && p.papel !== "pendente");
  const agora = () => new Date().toISOString();
  const gravar = async (patch, msg) => { setSalvando(true); try { await api.apontamentos.atualizar(s.id, patch); avisar(msg); await onMudou(); } catch (x) { avisar("Não deu: " + (x.message || x), true); } finally { setSalvando(false); } };
  const confirmarPausa = () => { const m = motivo === "Outro motivo" ? outro.trim() : motivo; if (!m) return avisar("Escolha o motivo da pausa.", true);
    setPausar(false); gravar({ situacao: "pausado", motivo_pausa: m, pausas: (Array.isArray(s.pausas) ? s.pausas : []).concat([{ em: agora(), motivo: m }]) }, "Serviço pausado: " + m + "."); };
  const retomar = () => { const ps = (Array.isArray(s.pausas) ? s.pausas : []).map((p, i, l) => i === l.length - 1 && !p.retomado_em ? { ...p, retomado_em: agora() } : p);
    gravar({ situacao: "andamento", motivo_pausa: "", pausas: ps }, "Serviço retomado."); };
  const confirmarFim = async () => {
    const exec = os.servicos.filter(i => feitos[i.id]);
    const ind = os.servicos.filter(i => !feitos[i.id] && !i.executado && resp[i.id]).map(i => { const p = pessoas.find(x => x.id === resp[i.id]); return { item_id: i.id, descricao: i.descricao, para_id: p.id, para_nome: p.nome, em: agora(), visto_em: null }; });
    setFinalizar(false); setSalvando(true);
    try {
      // os itens feitos ficam marcados na O.S. (mesmo caminho do sistema: salvarItens); se falhar, o apontamento ainda guarda a lista
      // só a coluna "executado" vai para a O.S. (o upsert do PostgREST grava só o que é enviado): nada de preço, quantidade ou aprovação da cópia antiga
      if (exec.length) { try { await api.salvarItens(o.id, exec.map(i => ({ id: i.id, posicao: i.posicao, executado: true })), []); } catch (e) { avisar("Os itens não puderam ser marcados na O.S. (" + (e.message || e) + "), mas o serviço foi finalizado.", true); } }
      const ps = (Array.isArray(s.pausas) ? s.pausas : []).map((p, i, l) => i === l.length - 1 && !p.retomado_em ? { ...p, retomado_em: agora() } : p);
      await api.apontamentos.atualizar(s.id, { situacao: "finalizado", fim: agora(), motivo_pausa: "", pausas: ps, itens_executados: exec.map(i => i.id), indicacoes: (Array.isArray(s.indicacoes) ? s.indicacoes : []).concat(ind) });
      avisar("Serviço finalizado" + (ind.length ? ": " + ind.length + " etapa(s) indicada(s) a outro responsável." : ".")); await onMudou();
    } catch (x) { avisar("Não deu para finalizar: " + (x.message || x), true); } finally { setSalvando(false); }
  };
  return html`<${Cartao} titulo=${(s.situacao === "pausado" ? "Pausado · " : "Em andamento · ") + numOS(o.numero)} id=${"sv-" + s.id}>
    <${KV} a="Veículo" b=${[exPlaca(veic.placa), veic.marca, veic.modelo].filter(Boolean).join(" ") || "—"} p />
    ${(o.cliente || {}).nome ? html`<${KV} a="Cliente" b=${o.cliente.nome} p />` : null}
    <${KV} a="Início" b=${new Date(s.inicio).toLocaleDateString("pt-BR") + " " + hhmm(s.inicio) + " · " + tempoTxt(minutosAp(s)) + " trabalhados"} p />
    ${s.situacao === "pausado" ? html`<div class="nota"><span class="selo atencao">Pausado</span>${s.motivo_pausa}</div>` : null}
    <${OQueFazer} o=${o} os=${os} />
    <div class="linha" style="gap:8px;flex-wrap:wrap">
      ${s.situacao === "pausado" ? html`<button type="button" class="btn-barra claro" data-retomar=${s.id} disabled=${salvando} onClick=${retomar}><${Ic} n="os" t=${20} />Retomar</button>`
        : html`<button type="button" class="btn-barra claro" data-pausar=${s.id} disabled=${salvando} onClick=${() => setPausar(true)}><${Ic} n="x" t=${20} />Pausar</button>`}
      <button type="button" class="btn-barra" data-finalizar=${s.id} disabled=${salvando || !os.det} onClick=${() => setFinalizar(true)}><${Ic} n="check" t=${20} />Finalizar</button></div>
    ${pausar ? html`<${Quadro} titulo="Pausar o serviço" onFechar=${() => setPausar(false)}>
      <p class="nota">Por que está pausando? O sistema fica sabendo.</p>
      <div class="chips" role="group" aria-label="Motivo">${MOTIVOS_PAUSA.map(m => html`<button type="button" key=${m} class="btn-chip" aria-pressed=${motivo === m ? "true" : "false"} onClick=${() => setMotivo(m)}>${m}</button>`)}</div>
      ${motivo === "Outro motivo" ? html`<input id="sv-outro" class="inp livre" autocomplete="off" placeholder="Qual?" value=${outro} onInput=${e => setOutro(e.target.value)} />` : null}
      <button type="button" class="btn-acao" id="sv-pausar-ok" onClick=${confirmarPausa}>Pausar</button>
      <button type="button" class="link" onClick=${() => setPausar(false)}>Cancelar</button></${Quadro}>` : null}
    ${finalizar ? html`<${Quadro} titulo="Finalizar o serviço" onFechar=${() => setFinalizar(false)}>
      <p class="nota">Marque o que você executou. O que não é seu, indique o responsável: a pessoa recebe o aviso no app.</p>
      ${os.servicos.length ? os.servicos.map(i => html`<div class="fim-item" key=${i.id}>
        <label class="marcar" style="min-height:40px"><input type="checkbox" data-feito=${i.id} checked=${!!feitos[i.id] || !!i.executado} disabled=${!!i.executado} onChange=${e => setFeitos(f => ({ ...f, [i.id]: e.target.checked }))} /><span>${i.descricao}${i.executado ? " (já feito)" : ""}</span></label>
        ${!feitos[i.id] && !i.executado ? html`<select class="inp livre" data-resp=${i.id} value=${resp[i.id] || ""} onChange=${e => setResp(r => ({ ...r, [i.id]: e.target.value }))}><option value="">Responsável: ninguém indicado</option>${pessoas.map(p => html`<option key=${p.id} value=${p.id}>${p.nome}</option>`)}</select>` : null}</div>`)
        : html`<div class="nota">Esta O.S. ainda não tem serviços lançados. Finalize mesmo assim ou acrescente itens a orçar na consulta da O.S.</div>`}
      <button type="button" class="btn-acao" id="sv-fim-ok" onClick=${confirmarFim}>Finalizar serviço</button>
      <button type="button" class="link" onClick=${() => setFinalizar(false)}>Cancelar</button></${Quadro}>` : null}
  </${Cartao}>`;
}
function Servico() {
  const { perfil, dados, avisar, indicacoes, recarregarServicos } = useApp(); const pl = usarPlaca();
  useEffect(() => { recarregarServicos(); }, []);
  const v = pl.veic;
  const meus = dados.meusAbertos || [], andamento = meus.find(x => x.situacao === "andamento"), pausados = meus.filter(x => x.situacao === "pausado");
  const ordemDe = s => dados.ordens.find(o => o.id === s.ordem_id) || { id: s.ordem_id, numero: s.os_numero, veiculo: {}, cliente: {} };
  const abertas = useMemo(() => v ? ordensDoVeiculo(dados, v).filter(ABERTA) : [], [dados.ordens, v]);
  const [iniciando, setIniciando] = useState(false);
  const iniciar = async o => {
    if (andamento) return avisar("Pause ou finalize o serviço em andamento antes de iniciar outro.", true);
    setIniciando(true);
    try { await api.apontamentos.abrir({ ordem_id: o.id, os_numero: o.numero, perfil_id: perfil.id, perfil_nome: perfil.nome }); avisar("Serviço iniciado na " + numOS(o.numero) + "."); pl.limpar(); await recarregarServicos(); }
    catch (x) { avisar("Não deu para iniciar: " + (x.message || x), true); } finally { setIniciando(false); }
  };
  const placaSem = v ? v.placa : (pl.placa.naoAchou ? normPlaca(pl.placa.texto) : "");   // carro sem O.S. (ou placa fora do cadastro): segue para o pedido de orçamento
  const pedirOrcamento = () => { try { sessionStorage.setItem(CH_PLACA_PEDIDO, placaSem); } catch (e) { /* nada */ } ir("orcamento"); };
  const verIndicacao = async i => { try { await api.apontamentos.visto(i.apontamento_id); await recarregarServicos(); } catch (x) { avisar("Não deu: " + (x.message || x), true); } };
  const ajuda = "Busque a placa: se o carro tem O.S. aberta, aparece o que precisa ser feito e o botão Iniciar serviço. Sem O.S., vá para o pedido de orçamento. Só um serviço em andamento por vez: para abrir outro, pause (com o motivo) ou finalize. Ao finalizar, marque o que você fez e indique o responsável pelo resto.";
  return html`<${Tela} tela="servico" ajuda=${ajuda}>
    ${indicacoes.length ? html`<${Cartao} titulo="Avisos" id="sv-avisos">${indicacoes.map(i => html`<div class="aviso-orc" key=${i.apontamento_id + i.item_id + i.em}>
      <div><b>${i.de_nome}</b> indicou você: <b>${i.descricao}</b>${i.os_numero ? " · " + numOS(i.os_numero) : ""}<br /><span class="nota">${new Date(i.em).toLocaleDateString("pt-BR")} ${hhmm(i.em)}</span></div>
      <button type="button" class="btn-barra curto claro" data-indicacao=${i.apontamento_id} onClick=${() => verIndicacao(i)}>OK</button></div>`)}</${Cartao}>` : null}
    ${andamento ? html`<${ServicoAberto} s=${andamento} o=${ordemDe(andamento)} onMudou=${recarregarServicos} />` : null}
    ${pausados.map(s => html`<${ServicoAberto} key=${s.id} s=${s} o=${ordemDe(s)} onMudou=${recarregarServicos} />`)}
    <${BuscaPlaca} id="sv-placa" titulo=${andamento ? "Outro carro (pause ou finalize antes)" : "Qual carro vai mexer?"} pl=${pl} /><${Veiculo} v=${v} />
    ${placaSem && !abertas.length ? html`<div class="vazio">${v ? "Este carro não tem O.S. aberta." : "Placa fora do cadastro e sem O.S."}<br /><button type="button" class="btn-acao" id="sv-pedir" style="margin-top:10px" onClick=${pedirOrcamento}>Pedir orçamento para este carro</button></div>` : null}
    ${abertas.filter(o => !meus.some(s => s.ordem_id === o.id)).map(o => html`<${CartaoOS} key=${o.id} o=${o} iniciar=${() => iniciar(o)} bloqueado=${!!andamento || iniciando} />`)}
  </${Tela}>`;
}
function CartaoOS({ o, iniciar, bloqueado }) {
  const os = usarOS(o);
  return html`<${Cartao} titulo=${numOS(o.numero) + " · " + etapaTexto(o)}>
    ${o.mecanico_nome ? html`<${KV} a="Responsável" b=${o.mecanico_nome} p />` : null}
    <${OQueFazer} o=${o} os=${os} />
    <button type="button" class="btn-acao" data-iniciar=${o.id} disabled=${bloqueado} onClick=${iniciar}>Iniciar serviço</button>
    ${bloqueado ? html`<div class="nota">Pause ou finalize o serviço em andamento para iniciar este.</div>` : null}</${Cartao}>`;
}

/* ---------------- AGENDA (lista): administrador vê todos; colaborador só os dele ---------------- */
const SIT_AG = { agendado: "Agendado", confirmado: "Confirmado", chegou: "Chegou", faltou: "Faltou", cancelado: "Cancelado" };
function AgendaLista() {
  const { perfil } = useApp();
  const [lista, setLista] = useState(null), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true; api.agenda.listar({ de: hojeISO() }).then(l => vivo && setLista(l)).catch(e => vivo && setErro("Não deu para carregar a agenda (" + (e.message || "sem internet") + ").")); return () => { vivo = false; }; }, []);
  const admin = perfil.papel === "admin";
  const minha = (lista || []).filter(a => a.situacao !== "cancelado" && (admin || a.mecanico_id === perfil.id));
  const dias = [...new Set(minha.map(a => a.data))];
  const diaTxt = d => { const x = new Date(d + "T12:00:00"); return SEM_EXT[x.getDay()] + ", " + d.slice(8, 10) + "/" + d.slice(5, 7); };
  return html`<${Tela} tela="agenda" ajuda=${admin ? "Todos os carros agendados daqui para a frente, por dia, com o mecânico de cada um." : "Os carros agendados para você mexer, por dia. O administrador define o mecânico no sistema."}>
    ${erro ? html`<div class="erro">${erro}</div>` : !lista ? html`<div class="carregando">Carregando a agenda…</div>` : null}
    ${lista && !dias.length ? html`<div class="vazio">${admin ? "Nenhum serviço agendado daqui para a frente." : "Nenhum carro agendado para você. Quando o administrador marcar um agendamento no seu nome, ele aparece aqui."}</div>` : null}
    ${dias.map(d => html`<${Cartao} key=${d} titulo=${diaTxt(d)}>${minha.filter(a => a.data === d).map(a => { const v = a.veiculo || {}; return html`<div class="ag-item" key=${a.id}>
      <div class="ag-hora">${a.hora ? String(a.hora).slice(0, 5) : "sem hora"}</div>
      <div class="ag-meio"><b>${[exPlaca(v.placa), v.marca, v.modelo].filter(Boolean).join(" ") || "Veículo a confirmar"}</b><span>${(a.cliente || {}).nome || ""}</span><span>${a.servico}</span>
        <span class="nota">${SIT_AG[a.situacao] || a.situacao}${admin ? " · " + (a.mecanico_nome || "mecânico não definido") : ""}</span></div></div>`; })}</${Cartao}>`)}
  </${Tela}>`;
}

/* ---------------- MEUS SERVIÇOS: carros em que a pessoa mexeu, por quinzena ---------------- */
const quinzenaDe = iso => { const d = new Date(iso); const q = d.getDate() <= 15 ? 1 : 2; return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + q; };
const quinzenaTxt = k => { const [a, m, q] = k.split("-"); const mes = MESES[Number(m) - 1]; const ult = new Date(Number(a), Number(m), 0).getDate(); return (q === "1" ? "1 a 15" : "16 a " + ult) + " de " + mes + " de " + a; };
function MeusServicos() {
  const { perfil, dados } = useApp();
  const [lista, setLista] = useState(null), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true; api.apontamentos.listar({ perfil_id: perfil.id, desde: new Date(Date.now() - 120 * 86400000).toISOString() }).then(l => vivo && setLista(l)).catch(e => vivo && setErro("Não deu para carregar (" + (e.message || "sem internet") + ").")); return () => { vivo = false; }; }, []);
  const grupos = useMemo(() => { const g = new Map(); (lista || []).forEach(s => { const k = quinzenaDe(s.inicio); (g.get(k) || g.set(k, []).get(k)).push(s); }); return [...g.entries()].sort((a, b) => b[0].localeCompare(a[0])); }, [lista]);
  const ordemDe = s => dados.ordens.find(o => o.id === s.ordem_id) || { numero: s.os_numero, veiculo: {} };
  return html`<${Tela} tela="meus" ajuda="Os carros em que você mexeu, por quinzena (1 a 15 e 16 ao fim do mês), com o tempo trabalhado em cada um. Vem do botão Iniciar serviço.">
    ${erro ? html`<div class="erro">${erro}</div>` : !lista ? html`<div class="carregando">Carregando…</div>` : null}
    ${lista && !grupos.length ? html`<div class="vazio">Nenhum serviço apontado ainda. Use “Iniciar serviço” quando pegar um carro.</div>` : null}
    ${grupos.map(([k, l]) => html`<${Cartao} key=${k} titulo=${quinzenaTxt(k)}>
      <div class="nota" style="margin-bottom:4px"><b>${new Set(l.map(s => s.ordem_id)).size}</b> carro(s) · <b>${l.length}</b> serviço(s) · <b>${tempoTxt(l.reduce((t, s) => t + minutosAp(s), 0))}</b></div>
      ${l.map(s => { const o = ordemDe(s), v = o.veiculo || {}; return html`<div class="ag-item" key=${s.id}><div class="ag-hora">${new Date(s.inicio).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</div>
        <div class="ag-meio"><b>${[exPlaca(v.placa), v.marca, v.modelo].filter(Boolean).join(" ") || numOS(o.numero)}</b><span>${numOS(o.numero)} · ${tempoTxt(minutosAp(s))} · ${s.situacao === "finalizado" ? "Finalizado" : s.situacao === "pausado" ? "Pausado" : "Em andamento"}</span>
          ${(s.itens_executados || []).length ? html`<span class="nota">${s.itens_executados.length} item(ns) executado(s)</span>` : null}</div></div>`; })}</${Cartao}>`)}
  </${Tela}>`;
}

/* ---------------- AJUDA (acesso, digital, versão, sair) ---------------- */
function Ajuda() {
  const { perfil, sair, nativo, telas } = useApp();
  const [disp, setDisp] = useState(false), [ligada, setLigada] = useState(nativo.digital.ligada());
  useEffect(() => { nativo.digital.disponivel().then(setDisp); }, []);
  const alternar = async () => { if (ligada) { nativo.digital.desligar(); setLigada(false); } else { const ok = await nativo.digital.ativar(); setLigada(!!ok); } };
  return html`<div class="app"><${Cabecalho} /><main class="folha">
    <div class="titulo"><div class="meio"><${Ic} n="help" t=${22} sw=${1.9} /><b>AJUDA</b></div></div>
    <${Cartao} titulo="Seu acesso"><div class="linha-valor"><span>Nome</span><b>${perfil.nome}</b></div><div class="linha-valor"><span>E-mail</span><b>${perfil.email || ""}</b></div><div class="linha-valor"><span>Acesso</span><b>${{ admin: "Administrador", consultor: "Consultor", mecanico: "Mecânico" }[perfil.papel] || perfil.papel}</b></div>
      <div class="linha-valor"><span>Telas liberadas</span><b>${telas.length ? TELAS.filter(t => telas.includes(t.r)).map(t => t.aba).join(", ") : "nenhuma"}</b></div>
      ${disp ? html`<div class="chave" id="bloco-digital"><span>Entrar com a digital</span><button type="button" role="switch" aria-label="Entrar com a digital" aria-checked=${ligada ? "true" : "false"} data-acao="chave-digital" onClick=${alternar}></button></div>` : null}
      <div class="nota">Neste app ninguém altera O.S. nem lança preço: o orçamento é um pedido que o sistema monta. Na O.S. em andamento, o responsável acrescenta itens a orçar.</div></${Cartao}>
    <${Cartao} titulo="Como usar"><div class="nota">Cada tela tem a própria busca de placa (placa do cadastro não custa nada). Óleo e Peças mostram o catálogo com o que há no estoque. Orçamentos manda o pedido para o sistema e mostra os abertos e os aprovados; Agendar grava na hora. O botão Voltar do celular volta ao Início; no Início, sai do app.</div></${Cartao}>
    <${Cartao} titulo="Sobre o app"><div class="linha-valor"><span>Versão</span><b>${nativo.VERSAO}</b></div><div class="nota">DTCar Centro Automotivo. As telas chegam pelo site: não precisa instalar de novo quando algo muda.</div>
      <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${sair}>SAIR DO APP</button></${Cartao}>
  </main><${Rodape} tela="ajuda" /></div>`;
}

/* ---------------- DIAGNÓSTICO OBD (18/11/2026) ----------------
 * Etapa 1: só LEITURA. Nada é gravado no banco e nada é escrito no carro (não apaga falha).
 * O adaptador é lido pelo plugin nativo do APK (app/plugins/obd/); quem entende de OBD é o js/obd.js.
 * Serve para triagem na recepção e para conferir o reparo na entrega: é só motor e emissões.
 * ABS, airbag, câmbio e imobilizador NÃO saem por aqui (protocolo próprio de cada montadora) e o
 * OBD-II não tem quilometragem de painel. Isso está escrito na tela, para ninguém esperar o que não vem.
 */
const SELO_DTC = { atual: ["ATUAL", "ruim"], pendente: ["PENDENTE", "atencao"], permanente: ["PERMANENTE", "atencao"] };

// Mostrador do painel de dados ao vivo: arco de 270° com o número grande no meio, como num scanner.
// O rótulo é SEMPRE escrito (quem lê está embaixo do carro, com pressa: ponteiro sozinho não informa).
// R e as voltas do arco são fixos para o desenho não depender de medir a tela.
const M_R = 34, M_VOLTA = 2 * Math.PI * M_R, M_ARCO = M_VOLTA * 0.75;
/** número do jeito que se escreve aqui: vírgula decimal */
const numBR = n => String(n).replace(".", ",");
function Mostrador({ l }) {
  const tem = typeof l.de === "number" && typeof l.ate === "number" && l.ate > l.de;
  const parte = tem ? Math.max(0, Math.min(1, (l.valor - l.de) / (l.ate - l.de))) : 0;
  return html`<div class="mostrador" data-pid=${l.pid} data-chave=${l.chave}>
    <div class="mostrador-rot">${l.rotulo}</div>
    ${tem ? html`<svg class="mostrador-arco" viewBox="0 0 86 86" aria-hidden="true">
      <g transform="rotate(135 43 43)">
        <circle cx="43" cy="43" r=${M_R} class="trilho" stroke-dasharray=${M_ARCO + " " + M_VOLTA} />
        <circle cx="43" cy="43" r=${M_R} class="cheio" stroke-dasharray=${(M_ARCO * parte) + " " + M_VOLTA} />
      </g>
    </svg>` : null}
    <div class=${"mostrador-num" + (tem ? " dentro" : "")}>
      <b>${numBR(l.valor)}</b>${l.unidade ? html`<span>${l.unidade}</span>` : null}
    </div>
    ${tem ? html`<div class="mostrador-pes"><span>${numBR(l.de)}</span><span>${numBR(l.ate)}</span></div>` : null}
  </div>`;
}

// Uma leitura na visão LISTA: cabe mais na tela que o mostrador e continua mostrando a posição
// na escala, numa barra fina. O rótulo é sempre escrito e o valor fica grande, porque quem lê
// está embaixo do carro.
function LinhaViva({ l }) {
  const tem = typeof l.de === "number" && typeof l.ate === "number" && l.ate > l.de;
  const parte = tem ? Math.max(0, Math.min(1, (l.valor - l.de) / (l.ate - l.de))) : 0;
  return html`<div class="linha-viva" data-pid=${l.pid} data-chave=${l.chave}>
    <div class="linha-viva-topo">
      <span class="linha-viva-rot">${l.rotulo}</span>
      <b class="linha-viva-num">${numBR(l.valor)}${l.unidade ? html`<span>${l.unidade}</span>` : null}</b>
    </div>
    ${tem ? html`<div class="linha-viva-barra"><i style=${"width:" + (parte * 100).toFixed(1) + "%"}></i></div>` : null}
  </div>`;
}

// A conversa da leitura de combustível: o quanto o módulo está corrigindo, em português, com as
// causas que costumam explicar aquilo. NUNCA dá veredito — faixa de normalidade por motor só a
// montadora publica, e quem decide é o mecânico com o carro na frente.
function Combustivel({ v }) {
  const r = obd.leituraCombustivel(v);
  const cor = r.situacao === "grave" ? "ruim" : r.situacao === "atencao" ? "atencao" : r.situacao === "normal" ? "" : "atencao";
  const selo = r.situacao === "grave" ? "NO LIMITE" : r.situacao === "atencao" ? "CORRIGINDO" : r.situacao === "normal" ? "EM ORDEM" : "SEM DADOS";
  return html`<div class="comb" id="obd-comb">
    <div class="comb-topo"><span class=${"selo " + cor}>${selo}</span></div>
    ${r.bancos.length ? html`<div class="comb-bancos">
      ${r.bancos.map(b => html`<div key=${b.nome} class="comb-banco" data-banco=${b.nome}>
        <span class="comb-banco-n">${b.nome}</span>
        <b>${String(b.total).replace(".", ",")}<i>%</i></b>
        <span class="comb-banco-p">curto ${b.curto === null ? "—" : String(b.curto).replace(".", ",")} · longo ${b.longo === null ? "—" : String(b.longo).replace(".", ",")}</span>
      </div>`)}
    </div>` : null}
    ${r.frases.map((f, i) => html`<p key=${i} class="comb-frase">${f}</p>`)}
    ${r.causas.length ? html`<div class="comb-causas">
      <h3>O que costuma explicar isso</h3>
      <ul>${r.causas.map(c => html`<li key=${c}>${c}</li>`)}</ul>
      <div class="nota">Lista geral do OBD, não é diagnóstico deste motor: a faixa de normalidade de cada modelo só a montadora publica. Confira com o carro na frente.</div>
    </div>` : null}
  </div>`;
}

/**
 * Parâmetros de referência (pedido do Danilo, 20/11/2026). Caderno de bancada, não tela de
 * configuração: cada número aparece com o NÍVEL DE CONFIANÇA e com um campo para o valor que ele
 * conferiu no Raven. O conferido sobe para o nível mais alto e passa a valer.
 * Distinção DISCRETA, como ele pediu: tonalidade do texto + a palavra escrita miúda ao lado
 * (a regra da casa é nunca deixar só a cor falando) e uma legenda pequena no rodapé.
 */
function Parametros() {
  const { cfg, setCfg, perfil, avisar } = useApp();
  const admin = perfil.papel === "admin";
  const [abrir, setAbrir] = useState(false);
  const [editando, setEditando] = useState(null);     // id do parâmetro aberto para conferir
  const [f, setF] = useState({ valor: "", de: "", ate: "", carro: "", obs: "" });
  const [salvando, setSalvando] = useState(false);
  const lista = param.comAjustes(cfg);
  const num = t => { const n = Number(String(t).replace(",", ".")); return isFinite(n) ? n : undefined; };

  const abrirEdicao = p => {
    setEditando(p.id);
    setF({
      valor: typeof p.valorAtual === "number" && !p.faixaAtual ? String(p.valorAtual).replace(".", ",") : "",
      de: p.faixaAtual ? String(p.faixaAtual.de).replace(".", ",") : "",
      ate: p.faixaAtual ? String(p.faixaAtual.ate).replace(".", ",") : "",
      carro: (p.conferencia && p.conferencia.carro) || "", obs: (p.conferencia && p.conferencia.obs) || "",
    });
  };
  const gravar = async (id, limpar) => {
    setSalvando(true);
    try {
      const novo = limpar
        ? param.comConferencia(cfg, id, {})
        : param.comConferencia(cfg, id, { valor: num(f.valor), de: num(f.de), ate: num(f.ate), carro: f.carro, obs: f.obs });
      await api.salvarConfig(novo);
      setCfg(novo);
      setEditando(null);
      avisar(limpar ? "Voltou para o valor de referência." : "Conferência gravada.");
    } catch (e) { avisar("Não deu para gravar: " + (e.message || "sem internet"), true); }
    finally { setSalvando(false); }
  };

  const Linha = ({ p }) => {
    const n = param.nivel(p.nivelAtual);
    return html`<div class=${"par-linha nv-" + p.nivelAtual} data-param=${p.id}>
      <div class="par-topo">
        <span class="par-nome">${p.nome}</span>
        <b class="par-valor">${param.textoDe(p)}</b>
      </div>
      <div class="par-pe">
        <span class="par-nivel">${n.nome}</span>
        ${p.onde === "modelo" ? html`<span class="par-modelo">${p.modelo}</span>` : null}
        ${p.usado ? html`<span class="par-usado">o app usa</span>` : null}
        ${admin ? html`<button type="button" class="par-btn" data-conferir=${p.id} onClick=${() => abrirEdicao(p)}>Conferir</button>` : null}
      </div>
      <div class="par-fonte">${p.fonte}</div>
      ${p.conferencia && p.conferencia.em ? html`<div class="par-fonte">Conferido em ${fmtData(p.conferencia.em)}${p.conferencia.carro ? " · " + p.conferencia.carro : ""}${p.conferencia.obs ? " · " + p.conferencia.obs : ""}</div>` : null}
      ${editando === p.id ? html`<div class="par-edita">
        ${p.faixaAtual || (p.de !== undefined) ? html`
          <div class="par-campos">
            <label>de <input class="inp" inputmode="decimal" value=${f.de} onInput=${e => setF(x => ({ ...x, de: e.target.value }))} /></label>
            <label>até <input class="inp" inputmode="decimal" value=${f.ate} onInput=${e => setF(x => ({ ...x, ate: e.target.value }))} /></label>
          </div>`
        : html`<div class="par-campos"><label>valor <input class="inp" inputmode="decimal" value=${f.valor} onInput=${e => setF(x => ({ ...x, valor: e.target.value }))} /></label></div>`}
        <input class="inp" placeholder="Em qual carro conferiu (modelo, motor, ano)" value=${f.carro} onInput=${e => setF(x => ({ ...x, carro: e.target.value }))} />
        <input class="inp" placeholder="Observação (marcha lenta, acelerando…)" value=${f.obs} onInput=${e => setF(x => ({ ...x, obs: e.target.value }))} />
        <div class="par-acoes">
          <button type="button" class="btn-barra curto" data-gravar=${p.id} disabled=${salvando} onClick=${() => gravar(p.id, false)}>GRAVAR</button>
          <button type="button" class="btn-barra curto claro" disabled=${salvando} onClick=${() => setEditando(null)}>Cancelar</button>
          ${p.conferencia ? html`<button type="button" class="btn-barra curto claro" data-limpar=${p.id} disabled=${salvando} onClick=${() => gravar(p.id, true)}>Voltar à referência</button>` : null}
        </div>
      </div>` : null}
    </div>`;
  };

  const usados = lista.filter(p => p.usado);
  const resto = lista.filter(p => !p.usado);
  return html`<${Cartao} titulo="Parâmetros de referência" id="obd-parametros">
    <button type="button" class="btn-barra claro" id="obd-param-abrir" onClick=${() => setAbrir(x => !x)}>
      ${abrir ? "FECHAR OS PARÂMETROS" : "VER E CONFERIR PARÂMETROS (" + lista.length + ")"}</button>
    ${abrir ? html`
      <div class="sec"><h3>O app decide por estes</h3>${usados.map(p => html`<${Linha} key=${p.id} p=${p} />`)}</div>
      <div class="sec"><h3>Referência, só para comparar</h3>${resto.map(p => html`<${Linha} key=${p.id} p=${p} />`)}</div>
      <div class="par-legenda">
        <span class="nv-conferido">conferido aqui</span>
        <span class="nv-norma">norma</span>
        <span class="nv-montadora">montadora</span>
        <span class="nv-suposto">suposto, a conferir</span>
      </div>
      <div class="par-fonte">Não existe tabela pública de faixa normal para motor flex brasileiro — nem GM, nem Fiat, nem VW, nem Honda. O que você conferir no Raven vira a referência desta oficina.</div>
      ${!admin ? html`<div class="nota">Só o administrador altera.</div>` : null}
    ` : null}
  </${Cartao}>`;
}

function Obd() {
  const { dados, cfg, perfil } = useApp();
  const pl = usarPlaca();
  const [aparelhos, setAparelhos] = useState(null);
  const [lig, setLig] = useState(null);          // { nome, endereco, protocolo, pidsSuportados }
  const [ocupado, setOcupado] = useState("");
  const [erro, setErro] = useState("");
  // UMA leitura por vez na tela (pedido do Danilo, 19/11/2026): abrir falhas tira os dados ao vivo
  // da frente. Empilhar cartão em cima de cartão faz o mecânico rolar a tela procurando o que
  // acabou de pedir, e no celular isso é pior que não mostrar.
  const [res, setRes] = useState(null);         // { o: "falhas"|"conf"|"foto"|"testes", d: ... }
  const temPlugin = obd.disponivel();
  // Dados ao vivo DE VERDADE: uma roda que fica girando e atualizando a tela a cada valor que chega.
  // `rodada` é uma caixa (não estado) porque a roda precisa enxergar o valor NOVO a cada volta;
  // estado dentro de função que já começou continuaria valendo o antigo e ela nunca pararia.
  // Guarda o NÚMERO da rodada que pode girar (0 = parar tudo), não um sim/não: se o mecânico
  // parar e ligar de novo antes de a leitura em andamento voltar (até 1,5 s), a roda velha
  // continuaria girando junto com a nova, ou desligaria a nova ao terminar. Cada roda só
  // obedece e só se desliga se o número ainda for o dela.
  const rodada = useRef(0);
  const contador = useRef(0);
  // Painel de mostradores ou lista: o Danilo pediu as duas, escolhidas por filtro (19/11/2026).
  // A escolha fica guardada: quem gosta de uma não quer trocar a cada carro.
  const [jeito, setJeito] = useState(() => {
    try { return window.localStorage.getItem("obd_jeito") === "lista" ? "lista" : "painel"; } catch (e) { return "painel"; }
  });
  const trocarJeito = j => {
    setJeito(j);
    try { window.localStorage.setItem("obd_jeito", j); } catch (e) { /* sem espaço: segue sem guardar */ }
  };
  const [vivo, setVivo] = useState(null);       // { valores: {chave: leitura}, volta, rodando, modo }
  // Falhas vigiadas DURANTE a leitura ao vivo: a roda pergunta de tempos em tempos e, se o módulo
  // gravar código com o motor trabalhando, o botão de falhas fica vermelho na hora.
  const [falhasVivo, setFalhasVivo] = useState(null);   // { codigos: [], novas: [] }
  const baseFalhas = useRef(null);              // os códigos que já existiam quando a roda começou
  // Quais leituras mostrar. Vazio = todas as que o carro tiver. Fica guardado POR PLACA: cada carro
  // tem o seu conjunto, e quem lê um Hilux não quer a mesma lista de um Gol.
  // Regra do Danilo (20/11/2026): a tela abre com as leituras PADRÃO; o resto fica no filtro, para
  // acrescentar, e há um botão que põe todas. Guardado por placa como { modo, pids }.
  const [escolha, setEscolha] = useState({ modo: "padrao", pids: [] });
  const [abrirEscolha, setAbrirEscolha] = useState(false);
  // Apagar a falha, com registro (v62, decisão do Danilo em 19/11/2026). Quem apaga é decidido no sistema
  // (Sistema › Equipe, por pessoa); aqui a tela só mostra o botão para quem pode. O passo "confirmar" existe
  // porque apagar é o único comando que sai daqui PARA o carro, e não tem volta: a foto do momento da falha
  // some junto.
  const [apagar, setApagar] = useState(null);   // { passo: "confirmar"|"feito", km, antes, comb, r, depois, combDepois, registro }
  const [antesApagados, setAntesApagados] = useState(null);   // apagamentos anteriores DESTE carro
  const podeApagar = podeApagarObd(cfg, perfil);

  // sair da tela fecha a conexão: o adaptador não aceita duas conversas e a bateria do carro agradece
  useEffect(() => () => { rodada.current = 0; if (obd.disponivel()) obd.desconectar(); }, []);

  const placa = String((pl.veic && pl.veic.placa) || pl.placa || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const guardado = (chave, valor) => {
    const k = "obd_" + chave + (placa ? "_" + placa : "");
    try {
      if (valor === undefined) { const t = window.localStorage.getItem(k); return t ? JSON.parse(t) : null; }
      window.localStorage.setItem(k, JSON.stringify(valor));
    } catch (e) { /* sem espaço ou JSON estragado: segue sem memória */ }
    return null;
  };
  // Registro de apagamento que ficou no aparelho (sem internet na hora): sobe sozinho quando a tela abre.
  useEffect(() => { (async () => {
    let l = [];
    try { l = JSON.parse(window.localStorage.getItem("obd_pendentes") || "[]"); } catch (e) { return; }
    if (!l.length) return;
    const restam = [];
    for (const reg of l) {
      const { guardado_em, ...linha } = reg;
      try { await api.obd.registrar(linha); } catch (e) { restam.push(reg); }
    }
    try { window.localStorage.setItem("obd_pendentes", JSON.stringify(restam)); } catch (e) { /* segue */ }
  })(); }, []);

  // Ao trocar de placa, recupera o que foi marcado naquele carro e o que ele respondeu da última vez.
  useEffect(() => {
    setEscolha(obd.escolhaGuardada(guardado("leituras")));
    setAntesApagados(null);
    if (placa && podeApagar) carregarAnteriores();
  }, [placa]);
  // O que o carro tem: a lista que ELE respondeu manda. Enquanto não há conexão, vale a da última
  // vez (só para o mecânico já poder marcar o que quer antes de encaixar o adaptador).
  const antesDeLigar = guardado("suportados");
  // Conectado mas com lista vazia (o módulo não respondeu o 0100) NÃO é "a lista deste carro": seria o
  // catálogo inteiro passando por lista do carro, e aí apareceria EGR em carro que não tem.
  const listaDoCarro = !!(lig && Array.isArray(lig.pidsSuportados) && lig.pidsSuportados.length);
  const suportados = (listaDoCarro && lig.pidsSuportados) || (Array.isArray(antesDeLigar) && antesDeLigar.length ? antesDeLigar : null);
  const combustivel = (pl.veic && (pl.veic.combustivel || pl.veic.combustivel_descricao)) || "";
  const gruposDoCarro = obd.gruposPara(suportados, combustivel);
  const disponiveis = obd.leiturasPara(suportados, null);
  // Os PIDs que valem agora: null quando é "todas" (sem filtro nenhum).
  const escolhidas = obd.pidsDaEscolha(escolha, suportados, combustivel);
  const valendo = obd.leiturasPara(suportados, escolhidas);

  const guardarEscolha = e => { setEscolha(e); guardado("leituras", e); };
  // Marcar ou desmarcar uma leitura parte do que está na tela AGORA (padrão ou todas) e vira escolha à mão.
  const marcar = (pid, marcado) => {
    const base = valendo.map(l => l.pid);
    const nova = marcado ? base.concat([pid]).filter((x, i, a) => a.indexOf(x) === i) : base.filter(x => x !== pid);
    const todas = nova.length === disponiveis.length && disponiveis.every(l => nova.includes(l.pid));
    guardarEscolha(todas ? { modo: "todas", pids: [] } : { modo: "escolha", pids: nova });
  };
  const marcarTodas = () => guardarEscolha({ modo: "todas", pids: [] });
  const marcarPadrao = () => guardarEscolha({ modo: "padrao", pids: [] });

  async function rodar(aviso, fn) {
    setErro(""); setOcupado(aviso);
    try { await fn(); } catch (e) { setErro(obd.motivoDe(e)); } finally { setOcupado(""); }
  }

  const procurar = () => rodar("Procurando o adaptador…", async () => {
    const p = await obd.permissao();
    if (!p.concedida) {
      const q = await obd.pedirPermissao();
      if (!q.concedida) throw new Error("sem-permissao");
    }
    const lista = await obd.listar();
    setAparelhos(lista);
  });

  const ligar = ap => rodar("Conectando em " + ap.nome + "…", async () => {
    await obd.conectar(ap.endereco);
    const i = await obd.iniciar();
    setLig({ nome: ap.nome, endereco: ap.endereco, protocolo: i.protocolo, versao: i.versao, aviso: i.aviso, pidsSuportados: i.pidsSuportados });
    if (placa && i.pidsSuportados && i.pidsSuportados.length) guardado("suportados", i.pidsSuportados);
    setRes(null); setVivo(null); setFalhasVivo(null);
  });

  const desligar = () => rodar("Desconectando…", async () => {
    rodada.current = 0;
    await obd.desconectar();
    setLig(null); setRes(null); setAparelhos(null); setVivo(null); setFalhasVivo(null);
  });

  // Guardar uma leitura TROCA o que está na tela: é o "uma de cada vez". E qualquer leitura nova
  // para a roda antes, porque o adaptador atende um pedido por vez.
  const guardar = (o, d) => { setVivo(null); setRes({ o, d }); };
  const pararVivo = () => { rodada.current = 0; };

  const lerFalhas = () => { pararVivo(); return rodar("Lendo as falhas…", async () => {
    const f = await obd.lerFalhas();
    setFalhasVivo(null);                                            // já está na tela: o aviso cumpriu o papel
    guardar("falhas", f);
  }); };
  async function alternarVivo(modo = "todos") {
    if (rodada.current) {                                           // tocar de novo para parar…
      const mesmo = vivo && vivo.modo === modo;
      rodada.current = 0;
      if (mesmo) return;                                            // …mas trocar de modo recomeça
      await new Promise(r => setTimeout(r, 120));
    }
    const minha = ++contador.current;
    rodada.current = minha;
    setErro("");
    setRes(null);                                                   // uma leitura por vez na tela
    setVivo({ valores: {}, volta: 0, rodando: true, modo });
    // Referência das falhas: o que já estava gravado quando a roda começou. Só o que aparecer
    // DEPOIS disso é "falha nova". Sem leitura de falhas antes, a primeira olhada vira a referência.
    baseFalhas.current = res && res.o === "falhas"
      ? res.d.falhas.filter(f => f.situacao === "atual").map(f => f.codigo)
      : null;
    setFalhasVivo(null);
    try {
      await obd.lerAoVivoSeguido(
        lig.pidsSuportados,
        (v, volta) => { if (rodada.current === minha) setVivo(x => ({ valores: Object.assign({}, (x && x.valores) || {}, { [v.chave]: v }), volta, rodando: true, modo })); },
        () => rodada.current === minha,
        {
          escolhidos: modo === "combustivel" ? obd.PIDS_COMBUSTIVEL : escolhidas,
          aoFalhas: codigos => {
            if (rodada.current !== minha) return;
            if (baseFalhas.current === null) baseFalhas.current = codigos.slice();
            setFalhasVivo({ codigos, novas: codigos.filter(c => !baseFalhas.current.includes(c)) });
          },
        },
      );
    } catch (e) {
      if (rodada.current === minha) setErro(obd.motivoDe(e));
    } finally {
      if (rodada.current === minha) rodada.current = 0;              // não desliga a roda de outra rodada
      setVivo(x => (x && x.rodando && !rodada.current ? Object.assign({}, x, { rodando: false }) : x));
    }
  }
  /* ---- Apagar a falha, com registro (v62) ----
   * A ordem importa: lê o que está lá, lê o ajuste de combustível, apaga, e lê os dois de novo. O "depois"
   * é o que dá valor ao registro: mostra se o código voltou na hora (defeito acontecendo agora) e o módulo
   * recomeçando a aprender o combustível do zero. */
  const abrirApagar = () => { pararVivo(); return rodar("Lendo o que está gravado…", async () => {
    const f = await obd.lerFalhas();
    const comb = await obd.lerCombustivelRapido(lig.pidsSuportados);
    setRes(null); setVivo(null);
    setApagar({ passo: "confirmar", km: "", antes: f.falhas, comb });
  }); };
  const apagarAgora = () => rodar("Apagando as falhas…", async () => {
    const antes = apagar.antes || [], comb = apagar.comb || null, km = apagar.km;
    const r = await obd.apagarFalhas();
    if (!r.ok) { setApagar(a => Object.assign({}, a, { passo: "confirmar", erro: r.erro })); return; }
    // o módulo precisa de um instante para refazer a lista antes de valer a pena perguntar de novo
    await new Promise(x => setTimeout(x, 1500));
    let depois = null, combDepois = null;
    try { depois = (await obd.lerFalhas()).falhas; } catch (e) { depois = null; }
    try { combDepois = await obd.lerCombustivelRapido(lig.pidsSuportados); } catch (e) { combDepois = null; }
    const chassi = await obd.lerChassi().catch(() => "");
    const registro = obd.registroApagar({
      perfil_id: perfil.id, perfil_nome: perfil.nome,
      placa, veiculo_id: (v && v.id) || null, km, vin: chassi,
      antes, depois, combustivel: comb, combustivel_depois: combDepois,
      leituras: vivo ? Object.keys(vivo.valores).map(k => vivo.valores[k]) : [],
    });
    let gravado = "";
    try { await api.obd.registrar(registro); gravado = "ok"; }
    catch (e) { gravado = e.message || "não deu para registrar"; guardarPendente(registro); }
    setApagar({ passo: "feito", antes, comb, depois, combDepois, km, resultado: obd.resultadoApagar(antes, depois), gravado });
    setFalhasVivo(null); baseFalhas.current = null;
    if (placa) carregarAnteriores();
  });
  // Apagou e a internet caiu na hora de registrar: o registro fica guardado no aparelho e sobe sozinho na
  // próxima vez que a tela abrir com internet. Apagamento sem registro é exatamente o que não pode sobrar.
  const guardarPendente = reg => {
    try {
      const l = JSON.parse(window.localStorage.getItem("obd_pendentes") || "[]");
      l.push(Object.assign({ guardado_em: new Date().toISOString() }, reg));
      window.localStorage.setItem("obd_pendentes", JSON.stringify(l.slice(-20)));
    } catch (e) { /* sem espaço: o aviso na tela é o que resta */ }
  };
  const carregarAnteriores = async () => {
    try { setAntesApagados(await api.obd.listar({ placa, limite: 5 })); } catch (e) { setAntesApagados(null); }
  };

  const lerFoto = () => { pararVivo(); return rodar("Lendo a foto da falha…", async () => guardar("foto", await obd.lerFoto(lig.pidsSuportados))); };
  const lerTestes = () => { pararVivo(); return rodar("Lendo os testes de bordo…", async () => guardar("testes", await obd.lerTestes())); };
  const lerCilindros = () => { pararVivo(); return rodar("Contando falha por cilindro…", async () => guardar("cilindros", await obd.lerFalhaCilindros())); };
  // SERVIÇOS AVANÇADOS (20/11/2026): calibração do módulo, teste drive e contadores de uso.
  // Tudo leitura, tudo pelo mesmo adaptador genérico — nada aqui precisa de APK novo.
  const lerCalib = () => { pararVivo(); return rodar("Lendo a calibração do módulo…", async () => {
    const c = await obd.lerCalibracao();
    const antes = guardado("calib");
    const comparado = obd.compararCalibracao(antes, c);
    if (c.cvn.length) guardado("calib", { calid: c.calid, cvn: c.cvn, em: new Date().toISOString() });
    guardar("calib", Object.assign({}, c, { comparado, antes }));
  }); };
  const lerCiclo = () => { pararVivo(); return rodar("Lendo os monitores deste ciclo…", async () => {
    const ciclo = await obd.lerMonitoresCiclo();
    let desde = null;
    try { desde = await obd.lerMonitores(); } catch (e) { desde = null; }
    guardar("ciclo", { ciclo, desde });
  }); };
  const lerContadores = () => { pararVivo(); return rodar("Lendo os contadores de uso…", async () => {
    const diesel = obd.tipoDeMotor(combustivel) === "diesel" || obd.tipoPeloModulo(suportados) === "diesel";
    guardar("contadores", await obd.lerContadores(diesel));
  }); };
  const lerConf = () => { pararVivo(); return rodar("Lendo chassi, monitores e odômetro…", async () => {
    const monitores = await obd.lerMonitores();
    const chassi = await obd.lerChassi();
    const odometro = await obd.lerOdometro(lig.pidsSuportados);
    guardar("conf", { monitores, chassi, odometro });
  }); };

  const v = pl.veic;
  // o chassi do cadastro vem da ficha do veículo (a busca por placa não carrega esse campo)
  const noBanco = v && v.id ? dados.veiculos.find(x => x.id === v.id) : null;
  const chassiCadastro = String((noBanco && noBanco.chassi) || (v && v.chassi) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

  return html`<${Tela} tela="obd" ajuda="Encaixe o adaptador na tomada do carro, ligue a ignição (chave na posição 2) e conecte. O app lê o módulo do MOTOR: códigos de falha, dados ao vivo, chassi, prontidão dos monitores, a foto do momento da falha e os testes de bordo. ABS, airbag e câmbio não saem por aqui: isso continua no scanner da oficina. Nesta etapa nada é gravado e nenhuma falha é apagada.">

    ${!temPlugin ? html`<${Cartao} titulo="Precisa do APK novo">
      <p class="nota" style="font-size:13.5px">A leitura OBD é a primeira coisa do app que depende de uma parte nativa: o Bluetooth do adaptador não existe dentro das telas do site. Gere o APK novo em GitHub › Actions › "App DTCar (gerar APK)", desinstale o app antigo do celular e instale o novo. Depois disso as telas voltam a chegar sozinhas, como sempre.</p>
    </${Cartao}>` : null}

    ${temPlugin ? html`
      <${BuscaPlaca} id="obd-placa" titulo="Placa do carro (opcional)" pl=${pl} />
      ${v ? html`<${Veiculo} v=${v} />` : null}

      <${Cartao} titulo="Adaptador" id="obd-adaptador">
        ${!lig ? html`
          <p class="nota" style="margin-bottom:8px">Encaixe o adaptador na tomada do carro e ligue a ignição (chave na posição 2). Com o motor desligado e a chave fora, o módulo não responde.</p>
          <button type="button" class="btn-barra" id="obd-procurar" onClick=${procurar} disabled=${!!ocupado}><${Ic} n="obd" t=${22} />PROCURAR ADAPTADOR</button>
          ${aparelhos && !aparelhos.length ? html`<div class="vazio">Nenhum aparelho pareado. Pareie o adaptador uma vez nos Ajustes do Android (Bluetooth) e volte aqui.</div>` : null}
          ${aparelhos && aparelhos.length ? html`<div class="sec"><h3>Aparelhos pareados</h3>
            ${aparelhos.map(ap => html`<button key=${ap.endereco} type="button" class="obd-ap" onClick=${() => ligar(ap)} disabled=${!!ocupado}>
              <b>${ap.nome}</b><span>${ap.endereco}</span></button>`)}
            <div class="nota">Toque no seu adaptador para conectar.</div></div>` : null}
        ` : html`
          <div class="kv"><span>Situação:</span><i></i><b><span class="selo">CONECTADO</span>${lig.nome}</b></div>
          ${lig.protocolo ? html`<${KV} a="Protocolo" b=${lig.protocolo} p />` : null}
          ${lig.versao ? html`<${KV} a="Adaptador" b=${lig.versao} p />` : null}
          ${lig.aviso ? html`<div class="erro" id="obd-clone">${lig.aviso}</div>` : null}
          <button type="button" class="btn-barra claro" id="obd-desligar" style="justify-content:center" onClick=${desligar} disabled=${!!ocupado}>DESCONECTAR</button>
        `}
      </${Cartao}>

      ${ocupado ? html`<div class="carregando">${ocupado}</div>` : null}
      ${erro ? html`<div class="erro">${erro}</div>` : null}

      ${lig && !ocupado ? html`<${Cartao} titulo="Ler do carro" id="obd-acoes">
        <button type="button" class=${"btn-barra" + (vivo && vivo.rodando && vivo.modo === "combustivel" ? " claro" : "")} id="obd-combustivel" onClick=${() => alternarVivo("combustivel")}>
          <${Ic} n="obd" t=${22} />${vivo && vivo.rodando && vivo.modo === "combustivel" ? "PARAR A LEITURA DE COMBUSTÍVEL" : "LEITURA DE COMBUSTÍVEL"}</button>
        <button type="button" class=${"btn-barra" + (vivo && vivo.rodando && vivo.modo !== "combustivel" ? " claro" : "")} id="obd-vivo" onClick=${() => alternarVivo("todos")}>
          ${vivo && vivo.rodando && vivo.modo !== "combustivel" ? "PARAR OS DADOS AO VIVO" : "DADOS AO VIVO"}</button>
        <button type="button" class=${"btn-barra" + (falhasVivo && falhasVivo.codigos.length ? " alerta" : "")} id="obd-falhas" onClick=${lerFalhas}>
          ${falhasVivo && falhasVivo.novas.length ? "FALHA NOVA AGORA (" + falhasVivo.novas.length + ") · VER"
            : falhasVivo && falhasVivo.codigos.length ? "FALHA NO MÓDULO (" + falhasVivo.codigos.length + ") · VER"
            : "LER FALHAS"}</button>
        <button type="button" class="btn-barra claro" id="obd-foto" onClick=${lerFoto}>FOTO DO MOMENTO DA FALHA</button>
        <button type="button" class="btn-barra claro" id="obd-cilindros" onClick=${lerCilindros}>FALHA POR CILINDRO</button>
        <button type="button" class="btn-barra claro" id="obd-testes" onClick=${lerTestes}>TESTES DE BORDO</button>
        ${podeApagar ? html`<button type="button" class="btn-barra apagar" id="obd-apagar" onClick=${abrirApagar}>APAGAR FALHAS (FICA REGISTRADO)</button>` : null}
        <div class="nota">${falhasVivo && falhasVivo.novas.length ? "Apareceu código com o motor trabalhando. Toque no botão vermelho para ver quais."
          : vivo && vivo.rodando ? "Pedir outra leitura para os dados ao vivo: o adaptador atende um pedido por vez."
          : "Nada é gravado e nenhuma falha é apagada nesta etapa."}</div>
      </${Cartao}>` : null}

      ${lig && !ocupado ? html`<${Cartao} titulo="Serviços avançados" id="obd-avancado">
        <button type="button" class="btn-barra claro" id="obd-conf" onClick=${lerConf}>CHASSI, MONITORES E ODÔMETRO</button>
        <button type="button" class="btn-barra claro" id="obd-calib" onClick=${lerCalib}>CALIBRAÇÃO DO MÓDULO (REPROGRAMAÇÃO)</button>
        <button type="button" class="btn-barra claro" id="obd-ciclo" onClick=${lerCiclo}>TESTE DRIVE: MONITORES DESTE CICLO</button>
        <button type="button" class="btn-barra claro" id="obd-contadores" onClick=${lerContadores}>CONTADORES DE USO DOS MONITORES</button>
        <div class="nota">Leituras de perícia, não de reparo do dia: dizem se o módulo foi reprogramado, se o reparo fechou o monitor no test-drive e se os monitores deste carro chegam a rodar no uso real.</div>
      </${Cartao}>` : null}

      ${!ocupado ? html`<${Parametros} />` : null}

      ${lig && !ocupado && disponiveis.length ? html`<${Cartao} titulo="Quais leituras mostrar" id="obd-escolha">
        <button type="button" class="btn-barra claro" id="obd-escolher" onClick=${() => setAbrirEscolha(x => !x)}>
          ${(abrirEscolha ? "FECHAR A ESCOLHA" : "ESCOLHER LEITURAS") + " (" + valendo.length + " de " + disponiveis.length + ")"}</button>
        ${abrirEscolha ? html`
          <div class="obd-filtro" role="group" aria-label="Quais leituras ficam na tela">
            <button type="button" id="obd-padrao" class=${escolha.modo === "padrao" ? "esc" : ""} aria-pressed=${escolha.modo === "padrao"} onClick=${marcarPadrao}>SÓ AS PADRÃO</button>
            <button type="button" id="obd-todas" class=${escolha.modo === "todas" ? "esc" : ""} aria-pressed=${escolha.modo === "todas"} onClick=${marcarTodas}>TODAS DO CARRO</button>
          </div>
          <div class="nota">${escolha.modo === "padrao" ? "Na tela estão as leituras padrão, as que se olha primeiro em qualquer carro. Marque abaixo para acrescentar as outras."
            : escolha.modo === "todas" ? "Na tela estão TODAS as que este carro tem. Quanto mais leitura, mais devagar cada uma atualiza."
            : "Você escolheu à mão o que fica na tela."}</div>
          ${gruposDoCarro.map(g => html`<div key=${g.id} class="sec"><h3>${g.nome}</h3>
            ${g.leituras.map(l => html`<label key=${l.pid} class="obd-cx">
              <input type="checkbox" data-pid=${l.pid} checked=${!escolhidas || escolhidas.includes(l.pid)}
                onChange=${e => marcar(l.pid, e.target.checked)} />
              <span>${l.rotulo}${l.unidade ? " (" + l.unidade + ")" : ""}</span></label>`)}
          </div>`)}
          <div class=${listaDoCarro ? "nota" : "erro"}>${listaDoCarro
            ? "A lista acima é a que ESTE carro respondeu agora: o que ele não tem não aparece aqui, por mais que o modelo costume ter."
            : (Array.isArray(antesDeLigar) && antesDeLigar.length
              ? "Esta é a lista que este carro respondeu da ÚLTIMA vez. Conecte para ela valer de novo."
              : "Ainda não sei o que este carro tem: esta é a lista GERAL do OBD, não a dele. Conecte o adaptador e ela vira a deste carro — aí some o que ele não tiver.")}${placa ? " A escolha fica guardada para a placa " + placa + "." : " A escolha fica guardada neste aparelho."}</div>
        ` : null}
      </${Cartao}>` : null}

      ${res && res.o === "cilindros" ? html`<${Cartao} titulo="Falha de combustão por cilindro" id="obd-r-cilindros">
        ${!res.d.cilindros ? html`<div class="vazio">Este módulo não publica a contagem por cilindro.${res.d.erro ? " (" + res.d.erro + ")" : ""}</div>` : html`
          <div class="kv"><span>Situação:</span><i></i><b><span class=${"selo " + (res.d.cilindros.situacao === "limpo" ? "" : res.d.cilindros.situacao === "um_cilindro" ? "ruim" : "atencao")}>${
            res.d.cilindros.situacao === "limpo" ? "NENHUMA" : res.d.cilindros.situacao === "um_cilindro" ? "CILINDRO " + res.d.cilindros.destacado.cilindro : "ESPALHADA"}</span></b></div>
          <div class="cil-lista">
            ${(() => {
              const maior = Math.max.apply(null, res.d.cilindros.cilindros.map(c => (typeof c.ciclo === "number" ? c.ciclo : c.media)).concat([1]));
              return res.d.cilindros.cilindros.map(c => {
                const n = typeof c.ciclo === "number" ? c.ciclo : c.media;
                const destaque = res.d.cilindros.destacado && res.d.cilindros.destacado.cilindro === c.cilindro;
                return html`<div key=${c.cilindro} class=${"cil-linha" + (destaque ? " pior" : "")} data-cilindro=${c.cilindro}>
                  <span class="cil-nome">Cilindro ${c.cilindro}</span>
                  <div class="cil-barra"><i style=${"width:" + Math.max(2, Math.round((n / maior) * 100)) + "%"}></i></div>
                  <b class="cil-num">${numBR(n)}</b>
                </div>`;
              });
            })()}
          </div>
          ${res.d.cilindros.cilindros.some(c => typeof c.media === "number" && typeof c.ciclo === "number") ? html`<div class="nota">Número grande = falhas neste ciclo de condução. A média dos últimos 10 ciclos está nos detalhes abaixo.</div>` : null}
          ${res.d.cilindros.frases.map(f => html`<p key=${f} class="cil-frase">${f}</p>`)}
          <ul class="apg-avisos">${res.d.cilindros.avisos.map(a => html`<li key=${a}>${a}</li>`)}</ul>
          ${obd.avisoMidDaMarca(v && v.marca) ? html`<div class="erro" id="obd-aviso-gm">${obd.avisoMidDaMarca(v.marca)}</div>` : null}
          <div class="sec"><h3>Como o módulo respondeu</h3>
            ${res.d.testes.map(t => html`<div key=${t.mid + "-" + t.tid} class="kv"><span>${t.nome}${t.teste ? " · " + t.teste : ""}</span><i></i><b>${numBR(t.valor)}${t.unidade ? " " + t.unidade : ""}</b></div>`)}
          </div>`}
      </${Cartao}>` : null}

      ${apagar && apagar.passo === "confirmar" ? html`<${Cartao} titulo="Apagar as falhas?" id="obd-apagar-cx">
        ${apagar.erro ? html`<div class="erro">${apagar.erro}</div>` : null}
        <div class="apg-antes">
          ${!apagar.antes.length ? html`<div class="vazio">Não há código gravado agora. Apagar vai zerar as adaptações e a prontidão do mesmo jeito.</div>`
            : html`<div class="nota" style="margin-bottom:6px">Vai apagar ${apagar.antes.length} código${apagar.antes.length === 1 ? "" : "s"}:</div>
              ${apagar.antes.map(f => html`<div key=${f.codigo + f.situacao} class="obd-dtc"><b>${f.codigo}</b><span class=${"selo " + SELO_DTC[f.situacao][1]}>${SELO_DTC[f.situacao][0]}</span></div>`)}`}
        </div>
        ${apagar.comb && apagar.comb.pior ? html`<div class="nota">Ajuste de combustível agora: ${numBR(apagar.comb.pior.total)}% — some com o apagamento e o módulo recomeça a aprender.</div>` : null}
        <ul class="apg-avisos">${obd.AVISOS_APAGAR.map(a => html`<li key=${a}>${a}</li>`)}</ul>
        <${Campo} id="obd-km" rotulo="KM do painel (ajuda no registro)">
          <input id="obd-km" class="inp" type="number" inputmode="numeric" value=${apagar.km}
            onInput=${e => setApagar(a => Object.assign({}, a, { km: e.target.value }))} /></${Campo}>
        <div class="nota">Fica registrado quem apagou, de qual carro, com que KM e quais códigos estavam lá. ${perfil.nome}, ${placa ? "placa " + placa : "sem placa informada"}.</div>
        <button type="button" class="btn-barra apagar" id="obd-apagar-ok" onClick=${apagarAgora}>APAGAR AGORA</button>
        <button type="button" class="btn-barra claro" id="obd-apagar-nao" style="justify-content:center" onClick=${() => setApagar(null)}>Não apagar</button>
      </${Cartao}>` : null}

      ${apagar && apagar.passo === "feito" ? html`<${Cartao} titulo="Falhas apagadas" id="obd-apagar-feito">
        <div class="kv"><span>Resultado:</span><i></i><b><span class=${"selo " + (apagar.resultado.situacao === "limpo" ? "" : apagar.resultado.situacao === "voltou" ? "ruim" : "atencao")}>${
          apagar.resultado.situacao === "limpo" ? "LIMPOU" : apagar.resultado.situacao === "voltou" ? "O CÓDIGO VOLTOU" : apagar.resultado.situacao === "sobrou" ? "SOBROU CÓDIGO" : "NÃO CONFERIDO"}</span></b></div>
        <div class="nota">${apagar.resultado.frase}</div>
        ${apagar.depois && apagar.depois.length ? html`<div class="sec"><h3>O que ficou no módulo</h3>
          ${apagar.depois.map(f => html`<div key=${f.codigo + f.situacao} class="obd-dtc"><b>${f.codigo}</b><span class=${"selo " + SELO_DTC[f.situacao][1]}>${SELO_DTC[f.situacao][0]}</span></div>`)}</div>` : null}
        ${apagar.comb && apagar.comb.pior ? html`<div class="kv"><span>Ajuste antes:</span><i></i><b>${numBR(apagar.comb.pior.total)}%</b></div>` : null}
        ${apagar.combDepois && apagar.combDepois.pior ? html`<div class="kv"><span>Ajuste depois:</span><i></i><b>${numBR(apagar.combDepois.pior.total)}%</b></div>` : null}
        ${apagar.combDepois ? html`<div class="nota">O módulo recomeçou a aprender: o ajuste só volta a dizer alguma coisa depois de o carro rodar. A prontidão dos monitores também zerou.</div>` : null}
        <div class=${apagar.gravado === "ok" ? "nota" : "erro"}>${apagar.gravado === "ok"
          ? "Registrado: " + perfil.nome + (placa ? " · " + placa : "") + (apagar.km ? " · " + apagar.km + " km" : "")
          : "APAGOU, MAS NÃO REGISTROU (" + apagar.gravado + "). O registro ficou guardado no celular e sobe sozinho quando este app abrir com internet."}</div>
        <button type="button" class="btn-barra claro" id="obd-apagar-fim" style="justify-content:center" onClick=${() => setApagar(null)}>Pronto</button>
      </${Cartao}>` : null}

      ${podeApagar && antesApagados && antesApagados.length && !apagar ? html`<${Cartao} titulo="Já foi apagado neste carro" id="obd-apagados">
        ${antesApagados.map(a => html`<div key=${a.id} class="kv"><span>${fmtData(a.criado_em)}</span><i></i><b>${a.perfil_nome || "—"}${a.km ? " · " + a.km + " km" : ""}${(a.codigos || []).length ? " · " + (a.codigos || []).map(c => c.codigo).join(", ") : ""}</b></div>`)}
        <div class="nota">Monitor que ainda não terminou e falha que "não existia" podem ser disto: o carro ainda não rodou o bastante depois do apagamento.</div>
      </${Cartao}>` : null}

      ${res && res.o === "falhas" ? html`<${Cartao} titulo=${"Falhas do motor" + (res.d.falhas.length ? " (" + res.d.falhas.length + ")" : "")} id="obd-r-falhas">
        ${!res.d.falhas.length ? html`<div class="vazio">Nenhuma falha gravada no módulo do motor.</div>` : null}
        ${res.d.falhas.map(f => html`<div key=${f.codigo + f.situacao} class="obd-dtc">
          <b>${f.codigo}</b><span class=${"selo " + SELO_DTC[f.situacao][1]}>${SELO_DTC[f.situacao][0]}</span></div>`)}
        ${res.d.falhas.length ? html`<div class="nota">O código é o que o módulo gravou; a descrição de código de montadora (P1 em diante) não é pública. ATUAL está confirmada, PENDENTE apareceu uma vez e ainda não confirmou, PERMANENTE só sai depois que o módulo refizer os testes.</div>` : null}
        ${res.d.variosModulos ? html`<div class="nota">Mais de um módulo do carro respondeu: a lista junta os códigos de todos. Sem o cabeçalho ligado não dá para dizer qual código é de qual módulo.</div>` : null}
        ${res.d.erros.length ? html`<div class="nota">Não respondeu: ${res.d.erros.map(e => e.situacao + " (" + e.erro + ")").join("; ")}</div>` : null}
      </${Cartao}>` : null}

      ${vivo ? html`<${Cartao} titulo=${vivo.modo === "combustivel" ? "Combustível" : "Dados ao vivo"} id="obd-r-vivo">
        <div class="obd-vivo-topo">
          ${vivo.rodando ? html`<span class="selo vivo">AO VIVO</span><span class="nota">atualizando sem parar · ${vivo.volta} volta${vivo.volta === 1 ? "" : "s"}</span>`
            : html`<span class="selo atencao">PARADO</span><span class="nota">valores da última leitura · toque em DADOS AO VIVO para voltar a girar</span>`}
        </div>
        ${!Object.keys(vivo.valores).length ? html`<div class="carregando">${vivo.rodando ? "Lendo o motor…" : "O módulo não respondeu nenhum dado ao vivo."}</div>` : null}
        ${vivo.modo === "combustivel" && Object.keys(vivo.valores).length ? html`<${Combustivel} v=${vivo.valores} />` : null}
        ${(() => {
          const lidos = Object.keys(vivo.valores).map(k => vivo.valores[k]).sort((a, b) => obd.ordemDaLeitura(a) - obd.ordemDaLeitura(b));
          if (!lidos.length) return null;
          const comFaixa = lidos.filter(l => typeof l.de === "number");
          const resto = lidos.filter(l => typeof l.de !== "number");
          return html`
            <div class="obd-filtro" role="group" aria-label="Como mostrar os dados ao vivo">
              <button type="button" id="obd-jeito-painel" class=${jeito === "painel" ? "esc" : ""} aria-pressed=${jeito === "painel"} onClick=${() => trocarJeito("painel")}>PAINEL</button>
              <button type="button" id="obd-jeito-lista" class=${jeito === "lista" ? "esc" : ""} aria-pressed=${jeito === "lista"} onClick=${() => trocarJeito("lista")}>LISTA</button>
            </div>
            ${jeito === "painel" ? html`
              ${comFaixa.length ? html`<div class="painel-obd">${comFaixa.map(l => html`<${Mostrador} key=${l.chave} l=${l} />`)}</div>` : null}
              ${resto.length ? html`<div class="painel-resto">${resto.map(l => html`<${LinhaViva} key=${l.chave} l=${l} />`)}</div>` : null}`
            : html`<div class="lista-viva">
                ${obd.GRUPOS.map(g => {
                  const doGrupo = lidos.filter(l => obd.grupoDaLeitura(l) === g.id);
                  if (!doGrupo.length) return null;
                  return html`<div key=${g.id} class="lista-viva-grupo">
                    <h3>${g.nome}</h3>
                    ${doGrupo.map(l => html`<${LinhaViva} key=${l.chave} l=${l} />`)}
                  </div>`;
                })}
              </div>`}`;
        })()}
      </${Cartao}>` : null}

      ${res && res.o === "calib" ? html`<${Cartao} titulo="Calibração do módulo" id="obd-r-calib">
        ${!res.d.calid.length && !res.d.cvn.length ? html`<div class="vazio">Este módulo não informa a calibração (serviço 09 $04/$06).${res.d.erro ? " " + res.d.erro : ""}</div>` : null}
        ${res.d.calid.map((c, i) => html`<${KV} key=${"ca" + i} a=${"Calibração" + (res.d.calid.length > 1 ? " " + (i + 1) : "")} b=${c} p />`)}
        ${res.d.cvn.map((c, i) => html`<${KV} key=${"cv" + i} a=${"CVN" + (res.d.cvn.length > 1 ? " " + (i + 1) : "")} b=${c} p />`)}
        ${res.d.comparado ? html`<div class=${res.d.comparado.situacao === "igual" ? "nota" : "erro"}>
          <b>${res.d.comparado.situacao === "igual" ? "SEM MUDANÇA" : "MUDOU"}</b> — ${res.d.comparado.frase}${res.d.antes && res.d.antes.em ? " (leitura anterior em " + fmtData(res.d.antes.em) + ")" : ""}</div>`
          : res.d.cvn.length ? html`<div class="nota">Primeira leitura deste carro: guardei a calibração${placa ? " da placa " + placa : ""} para comparar na próxima vez.</div>` : null}
        ${res.d.cvn.length ? html`<div class="nota">O CVN é a impressão digital do que está gravado no módulo: muda quando o módulo é reprogramado. <b>Não existe lista pública do CVN certo de cada carro</b> — a comparação só vale contra a leitura anterior deste mesmo carro. (Regra: CARB 13 CCR 1968.2.)</div>` : null}
      </${Cartao}>` : null}

      ${res && res.o === "ciclo" ? html`<${Cartao} titulo="Teste drive: monitores deste ciclo" id="obd-r-ciclo">
        <div class="kv"><span>Neste ciclo:</span><i></i><b>${res.d.ciclo.prontos} de ${res.d.ciclo.total} completos</b></div>
        ${res.d.ciclo.monitores.map(m => html`<div key=${m.nome} class="kv"><span>${m.nome}:</span><i></i><b>${m.pronto
          ? html`<span class="selo">COMPLETOU</span>`
          : html`<span class="selo atencao">NÃO RODOU AINDA</span>`}${res.d.desde ? (res.d.desde.monitores.find(x => x.nome === m.nome) || {}).pronto === true ? " · pronto desde o apagamento" : "" : ""}</b></div>`)}
        <div class="nota">Esta leitura zera a cada vez que a chave liga. Serve para <b>provar o reparo no test-drive</b>: conserte, rode o carro e veja o monitor fechar — sem precisar apagar nada.</div>
        <div class="nota">"Completou" não quer dizer "passou": o resultado está nas falhas e nos testes de bordo.</div>
      </${Cartao}>` : null}

      ${res && res.o === "contadores" ? html`<${Cartao} titulo="Contadores de uso dos monitores" id="obd-r-contadores">
        ${!res.d ? html`<div class="vazio">Este módulo não informa os contadores de uso (serviço 09 $08/$0B).</div>` : html`
          <${KV} a="Ciclos contados pelo módulo" b=${numBR(res.d.ciclos)} p />
          <${KV} a="Partidas" b=${numBR(res.d.ignicoes)} p />
          ${res.d.itens.map(i => html`<div key=${i.posicao} class="kv"><span>${i.nome}:</span><i></i><b>${
            i.razao === null ? "—" : html`${numBR(i.razao)}${i.razao < obd.RAZAO_MINIMA ? html` <span class="selo atencao">RODA POUCO</span>` : ""}`} <span class="sub">(${numBR(i.numerador)}/${numBR(i.denominador)})</span></b></div>`)}
          <div class="nota">Quantas vezes cada monitor rodou contra quantas vezes poderia ter rodado. Razão baixa explica o carro que "nunca fica pronto" para inspeção. A referência de 0,336 é a mínima exigida pela CARB e pela regra europeia — <b>é referência, não reprovação</b>.</div>
          <div class="nota">A ordem dos campos desta resposta foi conferida só em fonte secundária, então cada linha mostra também a posição. Confira o nome antes de pôr num laudo.</div>`}
      </${Cartao}>` : null}

      ${res && res.o === "conf" ? html`<${Cartao} titulo="Chassi, monitores e odômetro" id="obd-r-conf">
        ${res.d.chassi ? html`<${KV} a="Chassi lido no módulo" b=${res.d.chassi} p />` : html`<div class="nota">O módulo não informou o chassi (comum em carro mais antigo).</div>`}
        ${res.d.chassi && chassiCadastro ? html`<div class="kv"><span>Confronto:</span><i></i><b>${res.d.chassi === chassiCadastro
          ? html`<span class="selo">CONFERE</span>igual ao cadastro`
          : html`<span class="selo ruim">DIVERGE</span>cadastro: ${chassiCadastro}`}</b></div>` : null}
        ${(() => {
          // Odômetro do módulo contra o KM do cadastro (pedido do Danilo, 19/11/2026). Poucos carros publicam.
          if (res.d.odometro === null || res.d.odometro === undefined) return html`<div class="nota">Este módulo não publica o odômetro (a maioria não publica: o KM do painel não existe no OBD-II).</div>`;
          const conf = obd.conferirOdometro(res.d.odometro, noBanco && noBanco.km_atual);
          const ruim = conf && conf.situacao === "abaixo";
          return html`<div id="obd-odometro">
            <${KV} a="Odômetro do módulo" b=${fmtKm(res.d.odometro) + " km"} p />
            ${conf && conf.cadastro ? html`<div class="kv"><span>KM do cadastro:</span><i></i><b>${fmtKm(conf.cadastro)} km ${ruim ? html`<span class="selo ruim">CONFIRA</span>` : html`<span class="selo">BATE</span>`}</b></div>` : null}
            ${conf ? html`<div class=${ruim ? "erro" : "nota"}>${conf.frase}</div>` : null}
          </div>`;
        })()}
        <div class="kv"><span>Luz de injeção:</span><i></i><b>${res.d.monitores.luzAcesa ? html`<span class="selo ruim">ACESA</span>` : html`<span class="selo">APAGADA</span>`}${res.d.monitores.quantidade} código(s) no módulo</b></div>
        <div class="sec"><h3>Monitores de emissão (${res.d.monitores.prontos} de ${res.d.monitores.total} prontos)</h3>
          ${res.d.monitores.monitores.map(m => html`<div key=${m.nome} class="kv"><span>${m.nome}:</span><i></i><b>${m.pronto ? html`<span class="selo">PRONTO</span>` : html`<span class="selo atencao">NÃO PRONTO</span>`}</b></div>`)}
          ${res.d.monitores.prontos < res.d.monitores.total ? html`<div class="nota">Monitor não pronto quer dizer que o módulo foi zerado há pouco e ainda não terminou os próprios testes: a falha foi apagada antes de o carro chegar. Confira a distância desde o apagamento em "Dados ao vivo".</div>` : null}
          ${res.d.monitores.diesel ? html`<div class="nota">Motor a diesel: o padrão não define quais monitores existem além dos três de base, então só esses aparecem.</div>` : null}
        </div>
      </${Cartao}>` : null}

      ${res && res.o === "foto" ? html`<${Cartao} titulo="Foto do momento da falha" id="obd-r-foto">
        ${!res.d.length ? html`<div class="vazio">O módulo não guardou a foto do momento da falha.</div>` : null}
        ${res.d.map(l => html`<${KV} key=${l.chave} a=${l.rotulo} b=${numBR(l.valor) + (l.unidade ? " " + l.unidade : "")} />`)}
        ${res.d.length ? html`<div class="nota">Como o carro estava no instante em que a falha gravou: diz se deu com o motor frio, em carga ou em marcha lenta.</div>` : null}
      </${Cartao}>` : null}

      ${res && res.o === "testes" ? html`<${Cartao} titulo="Testes de bordo" id="obd-r-testes">
        ${res.d.erro ? html`<div class="nota">${res.d.erro}</div>` : null}
        ${!res.d.testes.length && !res.d.erro ? html`<div class="vazio">Este carro não devolveu resultado de teste de bordo.</div>` : null}
        ${res.d.testes.map((t, i) => html`<div key=${i} class="obd-teste">
          <div class="obd-teste-n">${t.nome}${t.tid ? " · teste " + t.tid : ""}</div>
          <div class="obd-teste-v"><b>${t.valor}${t.unidade ? " " + t.unidade : ""}</b>
            <span>limite ${t.minimo} a ${t.maximo}${t.unidade ? " " + t.unidade : ""}</span>
            ${t.passou ? html`<span class="selo">PASSOU</span>` : html`<span class="selo ruim">FORA DO LIMITE</span>`}</div>
          ${!t.escalaConhecida ? html`<div class="nota">Número cru: a escala deste teste não está conferida, então não inventamos unidade. O passou/não passou vem da comparação com o limite do próprio módulo e vale do mesmo jeito.</div>` : null}
        </div>`)}
        ${res.d.testes.length ? html`<div class="nota">É aqui que o catalisador e a sonda aparecem piorando ANTES de dar código: veja quanta margem sobra até o limite.</div>` : null}
        ${res.d.testes.length ? html`<div class="nota">Monitor que ainda não rodou costuma devolver um <b>valor padrão de fábrica</b>, não uma medição (a Ford documenta isso para o EVAP). Antes de usar um número daqui, veja em "Teste drive" se aquele monitor completou.</div>` : null}
      </${Cartao}>` : null}

      <div class="nota" style="padding:0 2px 4px">Leitura de motor e emissões. ABS, airbag, câmbio e imobilizador exigem o scanner da oficina. O OBD-II não informa a quilometragem do painel.</div>
    ` : null}
  </${Tela}>`;
}

/* ---------------- raiz: dados, rota, aviso ---------------- */
const ROTAS = { inicio: Inicio, ajuda: Ajuda, servico: Servico, oleo: Oleo, orcamento: Orcamentos, agendar: Agendar, agenda: AgendaLista, peca: Peca, historico: Historico, meus: MeusServicos, osconsulta: OSConsulta, obd: Obd };
// quadros abertos (lista de peças, cliente, confirmação): o botão Voltar do celular fecha o de cima antes de trocar de tela
const quadros = [];
/** Pilha das telas visitadas: o botão Voltar do celular volta para a tela anterior, uma por vez, e só sai do app no Início
 *  (pedido do Danilo, 16/11/2026 à noite). "voltando" evita empilhar a própria volta. */
const pilha = [];
let voltando = false;
function registrarRota(r) { if (voltando) { voltando = false; return; } if (r === "inicio") { pilha.length = 0; } if (pilha[pilha.length - 1] !== r) pilha.push(r); if (pilha.length > 30) pilha.splice(1, 1); }   // o Início é sempre o fundo da pilha
/** passo dentro de uma tela (formulário aberto, sistema escolhido): o Voltar desfaz o passo antes de trocar de tela */
function usarPasso(ativo, desfazer) {
  useLayoutEffect(() => { if (!ativo) return; const f = () => desfazer(); quadros.push(f); return () => { const i = quadros.indexOf(f); if (i >= 0) quadros.splice(i, 1); }; }, [ativo]);
}
function App({ usuario, nativo }) {
  const [rota, setRota] = useState(rotaAtual());
  // o aviso de "sem internet" some com um toque: na tela do OBD ele cobria os mostradores e assustava
  // sem motivo, porque a leitura do carro não passa pelo servidor
  const [semAviso, setSemAviso] = useState(false);
  const [dados, setDados] = useState({ clientes: [], veiculos: [], produtos: [], ordens: [], perfis: [], orcamentos: [], carregado: false, erro: "" });
  const [cfg, setCfg] = useState(cfgCompleta({})), [cfgOk, setCfgOk] = useState(false);
  const [placa, setPlaca] = useState({ texto: "" });
  const [toast, setToast] = useState(null);
  useEffect(() => { registrarRota(rotaAtual()); const f = () => { registrarRota(rotaAtual()); setRota(rotaAtual()); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  const avisar = (msg, erro) => { setToast({ msg, erro }); clearTimeout(avisar.t); avisar.t = setTimeout(() => setToast(null), 4500); };
  const desdeOS = useRef(null);   // última leitura das O.S. (a recarga de cada minuto só traz as alteradas desde então)
  const carregar = async () => {
    try {
      const [clientes, veiculos, produtos, ordens, perfis, c, orcamentos] = await Promise.all([api.clientes.listar(), api.veiculos.listar(), api.produtos.listar(), api.ordens(), api.perfis().catch(() => []), api.config().catch(() => null), api.orcamentos.listar().catch(() => [])]);
      setDados({ clientes, veiculos, produtos, ordens, perfis, orcamentos, carregado: true, erro: "" }); desdeOS.current = new Date(Date.now() - 60000).toISOString(); if (c) { setCfg(cfgCompleta(c)); setCfgOk(true); }
    } catch (e) { setDados(d => ({ ...d, carregado: true, erro: "Não deu para carregar os dados do sistema (" + (e.message || "sem internet") + "). As buscas podem ficar incompletas." })); }
  };
  useEffect(() => { carregar(); }, []);
  // orçamentos e O.S. de novo a cada minuto com o app aberto: é assim que o aviso de "aprovado" chega a quem pediu
  const [tick, setTick] = useState(0);
  // os orçamentos são poucos e vêm inteiros; as O.S. só as alteradas desde a última leitura (api.alterados), para não baixar tudo a cada minuto
  const recarregarOrcamentos = async () => {
    try {
      const agora = new Date().toISOString();
      const [orcamentos, mudadas] = await Promise.all([api.orcamentos.listar(), desdeOS.current ? api.alterados("ordens", desdeOS.current).catch(() => []) : Promise.resolve([])]);
      desdeOS.current = agora;
      setDados(d => { const porId = Object.fromEntries((mudadas || []).map(o => [o.id, o])); const ordens = mudadas && mudadas.length ? d.ordens.map(o => porId[o.id] || o).concat(mudadas.filter(o => !d.ordens.some(x => x.id === o.id))) : d.ordens; return { ...d, orcamentos, ordens }; });
    } catch (e) {} setTick(t => t + 1); };
  useEffect(() => { const i = setInterval(() => { if (navigator.onLine !== false && !document.hidden) recarregarOrcamentos(); }, 60000); const vis = () => { if (!document.hidden) recarregarOrcamentos(); }; document.addEventListener("visibilitychange", vis); return () => { clearInterval(i); document.removeEventListener("visibilitychange", vis); }; }, []);
  const avisos = useMemo(() => avisosDe(dados.orcamentos, usuario), [dados.orcamentos, tick]);
  // serviços abertos da pessoa e indicações feitas para ela (v60): com o v60 ausente, listar devolve [] e nada quebra
  const recarregarServicos = async () => { try { const [meusAbertos, indicacoes] = await Promise.all([api.apontamentos.listar({ perfil_id: usuario.id, abertos: true }), api.apontamentos.indicadasPara(usuario.id)]); setDados(d => ({ ...d, meusAbertos, indicacoes })); } catch (e) { /* sem internet: fica o que tinha */ } };
  useEffect(() => { recarregarServicos(); const i = setInterval(() => { if (navigator.onLine !== false && !document.hidden) recarregarServicos(); }, 60000); return () => clearInterval(i); }, []);
  const indicacoes = dados.indicacoes || [];
  // horário de uso (Sistema › Equipe): fora dele a tela trava até o horário voltar (o administrador não tem limite); o tick confere a cada minuto
  const acessoAgora = cfgOk ? acessoApp(cfg, usuario) : { horario: usuario.horario || null };
  const fora = usuario.papel === "admin" ? "" : foraDoHorario(acessoAgora.horario);
  if (fora) return html`<div class="app"><header class="cab"><div class="cab-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" /><button type="button" class="sair" onClick=${nativo.sair}><${Ic} n="exit" t=${22} /> Sair</button></div></header>
    <main class="folha inicio"><div class="vazio" id="fora-horario"><b>Fora do horário de uso.</b><br />${fora}</div></main></div>`;
  // telas liberadas: o que veio no login e, carregados os Ajustes, o que o administrador tem gravado agora (Sistema › Equipe)
  const telas = cfgOk ? acessoApp(cfg, usuario).telas : (usuario.telas || []);
  const ctx = { perfil: usuario, dados, cfg, setCfg, telas, avisos, indicacoes, avisar, recarregar: carregar, recarregarOrcamentos, recarregarServicos, sair: nativo.sair, nativo };
  const Tela = (ROTAS[rota] && (rota === "inicio" || rota === "ajuda" || telas.includes(rota))) ? ROTAS[rota] : Inicio; // tela não liberada cai no Início
  return html`<${Ctx.Provider} value=${ctx}>
    ${dados.erro && !semAviso ? html`<div class="toast erro" role="alert" style="bottom:auto;top:8px" onClick=${() => setSemAviso(true)}>
      ${rota === "obd" ? "Sem internet agora: a leitura do carro funciona do mesmo jeito (ela sai do adaptador, não do servidor). Só as buscas do sistema ficam incompletas." : dados.erro}
      <span class="toast-fechar">toque para fechar</span></div>` : null}
    <${Tela} key=${rota} />
    ${toast ? html`<div class=${"toast" + (toast.erro ? " erro" : "")} role="status">${toast.msg}</div>` : null}</${Ctx.Provider}>`;
}

/** chamado pelo app.js depois do login (e da digital) */
export function montar(usuario, nativo) {
  if (!ROTAS_RE.test(location.hash)) location.hash = "#/inicio";
  const raiz = document.getElementById("raiz"); raiz.innerHTML = "";
  render(html`<${App} usuario=${usuario} nativo=${nativo} />`, raiz);
}
export function desmontar() { limparPlacaGuardada(); pilha.length = 0; render(null, document.getElementById("raiz")); }
/** botão Voltar do celular (app.js): fecha o quadro aberto; senão vai para o Início; no Início devolve false (o app sai) */
export function voltar() {
  if (quadros.length) { quadros[quadros.length - 1](); return true; }
  if (rotaAtual() === "inicio") return false;   // no Início o Voltar deixa o app de lado, sempre
  if (pilha.length > 1 && pilha[pilha.length - 1] === rotaAtual()) { pilha.pop(); voltando = true; location.hash = "#/" + pilha[pilha.length - 1]; return true; }
  if (rotaAtual() !== "inicio") { ir("inicio"); return true; }
  return false;
}
