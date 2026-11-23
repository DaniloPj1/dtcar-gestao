/**
 * Pedaços comuns das telas do app: ícones, moldura (cabeçalho, abas, título, rodapé), cartão, quadro
 * e a busca do carro pela placa. Saíram do app/telas.js em 21/11/2026, quando ele passou de 2.100
 * linhas: as telas da oficina (telas.js) e as do carro (diag.js) usam os mesmos pedaços daqui.
 */
import { html, createContext, useState, useEffect, useRef, useContext } from "../js/lib.js";
import { useLayoutEffect } from "../vendor/preact-htm.js";
import { normPlaca, placaValida, exPlaca } from "../js/util.js";
import { consultarPlaca, paraFicha, anoFabMod } from "../js/placa.js";

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
  modulo: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  atuador: '<path d="M13 2L5 13h5l-1 9 8-11h-5l1-9z"/>',
  aprender: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
  bico: '<path d="M10 3h4v5l2 3v6a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-6l2-3z"/><path d="M12 19v3M9.5 11h5"/>',
  zap: '<path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3z"/><path d="M9 8.5c0 3 2.5 5.5 5.5 6.5l1.5-1.5 2 1-.5 1.8c-4.5.6-9.4-4.3-8.8-8.8L10.5 7l1 2z"/>',
};
const Ic = ({ n, t = 24, sw = 2 }) => html`<svg width=${t} height=${t} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0" dangerouslySetInnerHTML=${{ __html: P[n] }}></svg>`;

/* ---------------- botões do Início e abas (ordem aprovada pelo Danilo) ---------------- */
/* ---------------- botões do Início e abas ----------------
 * O `grupo` existe desde 20/11/2026, quando o diagnóstico deixou de ser uma tela e virou família.
 * Com 15 telas, uma lista única no Início é uma parede de botões e a tira de abas vira uma régua
 * que ninguém lê. Com grupo, o Início separa por título e a tira de abas mostra só as telas do
 * grupo em que a pessoa está — na oficina ela vê as da oficina; no diagnóstico, as do carro.
 */
const GRUPOS = [
  { g: "oficina", t: "Na oficina" },
  { g: "diagnostico", t: "No carro" },
];
const TELAS = [
  { r: "servico", g: "oficina", ic: "os", barra: "INICIAR SERVIÇO", aba: "Iniciar serviço", titulo: "INICIAR SERVIÇO" },
  // 23/11/2026: MEUS SERVIÇOS subiu para o 2º lugar, a pedido do Danilo — o mecânico acompanha o
  // serviço dele sem caçar o botão no fim da lista.
  { r: "meus", g: "oficina", ic: "hist", barra: "MEUS SERVIÇOS", aba: "Meus serviços", titulo: "MEUS SERVIÇOS" },
  { r: "oleo", g: "oficina", ic: "oleo", barra: "ÓLEO (APLICAÇÃO)", aba: "Óleo (aplicação)", titulo: "ÓLEO (APLICAÇÃO)" },
  { r: "orcamento", g: "oficina", ic: "orc", barra: "ORÇAMENTOS", aba: "Orçamentos", titulo: "ORÇAMENTOS" },
  { r: "agendar", g: "oficina", ic: "ag", barra: "AGENDAR", aba: "Agendar", titulo: "AGENDAR SERVIÇO" },
  { r: "agenda", g: "oficina", ic: "ag", barra: "AGENDA", aba: "Agenda", titulo: "AGENDA" },
  { r: "peca", g: "oficina", ic: "peca", barra: "CONSULTAR PEÇA POR CATÁLOGO", aba: "Consultar peça por catálogo", titulo: "CONSULTAR PEÇA POR CATÁLOGO" },
  { r: "historico", g: "oficina", ic: "hist", barra: "HISTÓRICO DE SERVIÇOS", aba: "Histórico de serviços", titulo: "HISTÓRICO DE SERVIÇOS" },
  { r: "osconsulta", g: "oficina", ic: "clip", barra: "CONSULTAR O.S.", aba: "Consultar O.S.", titulo: "CONSULTAR O.S." },
  { r: "obd", g: "diagnostico", ic: "obd", barra: "LER O CARRO (OBD)", aba: "Ler o carro", titulo: "LER O CARRO (OBD)" },
  { r: "modulos", g: "diagnostico", ic: "modulo", barra: "MÓDULOS DO CARRO", aba: "Módulos", titulo: "MÓDULOS DO CARRO" },
  { r: "atuadores", g: "diagnostico", ic: "atuador", barra: "ATUADORES", aba: "Atuadores", titulo: "TESTE DE ATUADOR" },
  { r: "aprendizados", g: "diagnostico", ic: "aprender", barra: "APRENDIZADOS", aba: "Aprendizados", titulo: "APRENDIZADOS E CALIBRAÇÕES" },
  { r: "bico", g: "diagnostico", ic: "bico", barra: "PROGRAMAR BICO", aba: "Programar bico", titulo: "PROGRAMAR BICO" },
  { r: "parametros", g: "diagnostico", ic: "sliders", barra: "PARÂMETROS DE REFERÊNCIA", aba: "Parâmetros", titulo: "PARÂMETROS DE REFERÊNCIA" },
];
const grupoDa = r => (TELAS.find(t => t.r === r) || {}).g || "oficina";
const ROTAS_RE = /^#\/(inicio|ajuda|servico|oleo|orcamento|agendar|agenda|peca|historico|meus|osconsulta|obd|modulos|atuadores|aprendizados|bico|parametros)$/;
const ir = r => { location.hash = "#/" + r; };
const rotaAtual = () => { const m = /^#\/([a-z]+)/.exec(location.hash || ""); return m ? m[1] : "inicio"; };

/* ---------------- pedaços comuns ---------------- */
function Cabecalho() {
  const { sair } = useApp();
  return html`<header class="cab"><div class="cab-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" />
    <button type="button" class="sair" onClick=${sair}><${Ic} n="exit" t=${22} /> Sair</button></div></header>`;
}
/** A tira de abas mostra só as telas do grupo em que a pessoa está: com 15 telas, a tira inteira
 *  deixaria de ser navegação e viraria uma régua de rolar. */
function Abas({ ativa }) {
  const { telas, avisos, indicacoes, dados } = useApp();
  const meusAbertos = (dados && dados.meusAbertos || []).length;   // 23/11/2026: o mecânico vê na aba quantos serviços estão na mão dele
  const g = grupoDa(ativa);
  const minhas = TELAS.filter(t => t.g === g && telas.includes(t.r));
  return html`<nav class="abas" aria-label="Telas">${minhas.map(t => html`<a key=${t.r} href=${"#/" + t.r} aria-current=${t.r === ativa ? "page" : undefined}><${Ic} n=${t.ic} t=${18} sw=${1.9} /><span>${t.aba}</span>${t.r === "orcamento" && avisos.length ? html`<span class="bolinha" aria-label=${avisos.length + " aviso(s)"}>${avisos.length}</span>` : t.r === "servico" && indicacoes.length ? html`<span class="bolinha" aria-label=${indicacoes.length + " indicação(ões)"}>${indicacoes.length}</span>` : t.r === "meus" && meusAbertos ? html`<span class="bolinha" aria-label=${meusAbertos + " serviço(s) em aberto"}>${meusAbertos}</span>` : null}</a>`)}</nav>`;
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
// A PLACA DO CARRO EM DIAGNÓSTICO (pedido do Danilo, 21/11/2026): puxou a placa uma vez, ela vale em
// todas as telas do carro (ler, módulos, atuadores, aprendizados, bico) até trocar de placa ou tirar o
// adaptador — não se pede de novo a cada tela. Fica só na memória do app: fechar o app esquece.
let placaDoCarro = { texto: "" };
const ouvintesPlaca = new Set();
const mudarPlacaDoCarro = p => { placaDoCarro = p && p.veic ? p : { texto: "" }; for (const f of [...ouvintesPlaca]) { try { f(placaDoCarro); } catch (e) { /* tela saiu */ } } };
export const esquecerPlacaDoCarro = () => mudarPlacaDoCarro(null);
function usarPlaca(guardar = false) {
  const { dados } = useApp();
  const doCarro = guardar === "carro";
  const [placa, setPlacaBruto] = useState(() => doCarro ? placaDoCarro : guardar ? lerPlacaGuardada() : { texto: "" });
  useEffect(() => {
    if (!doCarro) return undefined;
    const f = p => setPlacaBruto(atual => (atual.veic || p.veic ? p : atual));   // não apaga o que a pessoa está digitando
    ouvintesPlaca.add(f); return () => ouvintesPlaca.delete(f);
  }, []);
  const setPlaca = p => { setPlacaBruto(p); if (doCarro) { if (p && p.veic) mudarPlacaDoCarro(p); else if (!p || !p.texto) mudarPlacaDoCarro(null); } else if (guardar) guardarPlaca(p); };
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
function SairBotao() { const { sair } = useApp(); return html`<button type="button" class="sair" onClick=${sair}><${Ic} n="exit" t=${22} /> Sair</button>`; }

/* ---------------- moldura das telas de dentro ---------------- */
function Tela({ tela, acao, children, ajuda }) {
  const [aj, setAj] = useState(false);
  return html`<div class="app"><${Cabecalho} />
    <main class="folha"><${Abas} ativa=${tela} /><${Titulo} tela=${tela} ajuda=${() => setAj(true)} />${children}</main>
    <${Rodape} tela=${tela} acao=${acao} />
    ${aj ? html`<${Quadro} titulo="Ajuda" onFechar=${() => setAj(false)}><p>${ajuda}</p><button type="button" class="btn-acao" onClick=${() => setAj(false)}>Entendi</button></${Quadro}>` : null}</div>`;
}
// quadros abertos (lista de peças, cliente, confirmação): o botão Voltar do celular fecha o de cima antes de trocar de tela
const quadros = [];
function usarPasso(ativo, desfazer) {
  useLayoutEffect(() => { if (!ativo) return; const f = () => desfazer(); quadros.push(f); return () => { const i = quadros.indexOf(f); if (i >= 0) quadros.splice(i, 1); }; }, [ativo]);
}

export { usarPasso, Ctx, useApp, P, Ic, GRUPOS, TELAS, grupoDa, ROTAS_RE, ir, rotaAtual, Cabecalho, Abas, Titulo, Cartao, KV, Campo, Rodape, Quadro, nomeVeic, usarPlaca, BuscaPlaca, Veiculo, ModeloAMao, SairBotao, Tela, quadros };
