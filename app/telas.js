// Telas do app DTCar (celular), feitas a partir do protótipo aprovado pelo Danilo em 16/11/2026 (gen_proto.py / Design "App DTCar").
// Cada tela usa as MESMAS regras do sistema (js/api.js, js/placa.js, js/cpf.js, js/cep.js, js/catalogo.js, js/pecas.js), só com o
// desenho do app: cabeçalho azul, abas, título com ícone, cartões com faixa azul, campos grandes, rodapé com ação e Início/Ajuda.
// Regras do Danilo (16/11/2026): no app, O.S. que já existe só é alterada no login do administrador (a tela da O.S. do sistema, em modo app,
// é só leitura para o consultor); o app NÃO abre O.S. (botão retirado); a placa digitada vale só na tela em que foi digitada (sair da tela
// sem gravar limpa tudo); o botão Voltar do celular volta de tela em tela e só sai do app no Início.
import { html, render, createContext, useState, useEffect, useRef, useMemo, useContext } from "../js/lib.js";
import { useLayoutEffect } from "../vendor/preact-htm.js";
import { api } from "../js/api.js";
import { soDig, norm, normPlaca, placaValida, exPlaca, fmtTel, fmtData, fmtKm, hojeISO, somaDias, numOS, numORC, reais, validaCPF, docValido, fmtDoc, lsGet, lsSet, linkWhats, endCompleto } from "../js/util.js";
import { consultarPlaca, paraFicha, anoFabMod } from "../js/placa.js";
import { consultarCPF, ehAdmin } from "../js/cpf.js";
import { consultarCep, fmtCep } from "../js/cep.js";
import { carregarCatalogo, pesquisar, pesquisarVeiculo, indiceEstoque, filtroParaMostrar, resumoOleo, periodoTexto, TIPOS_FILTRO, MARCAS_PRINCIPAIS } from "../js/catalogo.js";
import { carregarPecas, pecasDoVeiculo, filtrarPecas, agruparEquivalentes, conversaoDoItem, chaveDaPeca } from "../js/pecas.js";
import { copiaClienteDig, erroClienteDig } from "../js/clientedig.js";
import { pode, STATUS, situacaoOS, cfgCompleta } from "../js/regras.js";
import { ICONE_D } from "../js/appmecanico.js";
import { MAIUSC } from "../js/maiusculas.js";

const SISTEMA = "../index.html?app=1";   // telas do sistema abertas de dentro do app (modo app: sem menu do PC, "‹ Início")
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
};
const Ic = ({ n, t = 24, sw = 2 }) => html`<svg width=${t} height=${t} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width=${sw} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0" dangerouslySetInnerHTML=${{ __html: P[n] }}></svg>`;

/* ---------------- botões do Início e abas (ordem aprovada pelo Danilo) ---------------- */
const TELAS = [
  { r: "oleo", ic: "oleo", barra: "ÓLEO (APLICAÇÃO)", aba: "Óleo (aplicação)", titulo: "ÓLEO (APLICAÇÃO)" },
  { r: "orcamento", ic: "orc", barra: "+ ORÇAMENTO", aba: "+ Orçamento", titulo: "NOVO ORÇAMENTO" },
  { r: "agendar", ic: "ag", barra: "AGENDAR", aba: "Agendar", titulo: "AGENDAR SERVIÇO" },
  { r: "peca", ic: "peca", barra: "CONSULTAR PEÇA POR CATÁLOGO", aba: "Consultar peça por catálogo", titulo: "CONSULTAR PEÇA POR CATÁLOGO" },
  { r: "historico", ic: "hist", barra: "HISTÓRICO DE SERVIÇOS", aba: "Histórico de serviços", titulo: "HISTÓRICO DE SERVIÇOS" },
  { r: "osconsulta", ic: "clip", barra: "CONSULTAR O.S.", aba: "Consultar O.S.", titulo: "CONSULTAR O.S." },
];
const ir = r => { location.hash = "#/" + r; };
const rotaAtual = () => { const m = /^#\/([a-z]+)/.exec(location.hash || ""); return m ? m[1] : "inicio"; };

/* ---------------- pedaços comuns ---------------- */
function Cabecalho() {
  const { sair } = useApp();
  return html`<header class="cab"><div class="cab-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" />
    <button type="button" class="sair" onClick=${sair}><${Ic} n="exit" t=${22} /> Sair</button></div></header>`;
}
function Abas({ ativa }) {
  return html`<nav class="abas" aria-label="Telas">${TELAS.map(t => html`<a key=${t.r} href=${"#/" + t.r} aria-current=${t.r === ativa ? "page" : undefined}><${Ic} n=${t.ic} t=${18} sw=${1.9} /><span>${t.aba}</span></a>`)}</nav>`;
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
function usarPlaca() {
  const { dados } = useApp();
  const [placa, setPlaca] = useState({ texto: "" });
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
  const v = placa.veic;
  const linha = placa.buscando ? html`<div class="achou buscando" role="status">Consultando a placa…</div>`
    : v ? html`<div class="achou" role="status"><${Ic} n="check" t=${16} sw=${2.4} />${v.origem === "cadastro" ? "Placa gravada no banco da DTCar" : v.origem === "copia" ? "Placa consultada antes: sem custo" : "Placa nova: consultada e gravada"}</div>`
    : placa.naoAchou ? html`<div class="achou nao" role="status">${placa.motivo} Digite o modelo abaixo.</div>`
    : placa.erro ? html`<div class="achou nao" role="status">${placa.erro}</div>` : null;
  return html`<${Cartao} titulo=${titulo}>${linha}
    <${Campo} id=${id} rotulo="Placa"><div class="linha"><input id=${id} class="inp placa" autocomplete="off" autocapitalize="characters" maxlength="8" placeholder="ABC1D23" value=${t}
        onInput=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === "Enter") buscar(t); }} onBlur=${() => { if (normPlaca(t).length === 7 && normPlaca(t) !== placa.texto) buscar(t); }} />
      <button type="button" class="btn-busca g" aria-label="Buscar pela placa" onClick=${() => buscar(t)}><${Ic} n="search" t=${22} /></button>
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
  const { perfil } = useApp(); const { placa, buscar, limpar } = usarPlaca();
  const [t, setT] = useState("");
  const [ajuda, setAjuda] = useState(false);
  const papel = { admin: "Administrador", consultor: "Consultor" }[perfil.papel] || "";
  return html`<div class="app">
    <header class="cab"><div class="cab-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" /><${SairBotao} /></div>
      <div class="cab-busca"><div class="rotulo">Placa<${Ic} n="down" t=${16} /></div>
        <div class="caixa"><input id="ini-placa" type="text" placeholder="Digite aqui a placa" aria-label="Placa" autocomplete="off" autocapitalize="characters" maxlength="8" value=${t} onInput=${e => setT(e.target.value)} onKeyDown=${e => { if (e.key === "Enter") buscar(t); }} />
          <button type="button" class="limpar" aria-label="Limpar" onClick=${() => { setT(""); limpar(); }}><${Ic} n="trash" t=${20} /></button>
          <button type="button" class="btn-busca" aria-label="Buscar placa" onClick=${() => buscar(t)}><${Ic} n="search" t=${20} /></button></div>
        <button type="button" class="ajuda" aria-label="Ajuda" onClick=${() => setAjuda(true)}><${Ic} n="help" t=${30} sw=${1.7} /></button></div>
      <div class="cab-texto">${placa.buscando ? "Consultando a placa…" : placa.erro || placa.motivo || "Digite a placa para consultar o veículo. Toda placa buscada fica gravada no banco da DTCar."}</div></header>
    <main class="folha inicio">
      ${placa.veic ? html`<${Veiculo} v=${placa.veic} />` : null}
      <div class="nota" style="padding:0 6px">Olá, <b>${perfil.nome.split(" ")[0]}</b> · ${papel}</div>
      ${TELAS.map(b => html`<button type="button" key=${b.r} class="barra" onClick=${() => ir(b.r)}><span class="bola"><${Ic} n=${b.ic} t=${20} sw=${1.9} /></span><span>${b.barra}</span></button>`)}
    </main>
    <${Rodape} tela="inicio" />
    ${ajuda ? html`<${Quadro} titulo="Como usar o Início" onFechar=${() => setAjuda(false)}>
      <p>Digite a placa e toque na lupa para consultar o carro. Depois escolha o que fazer nos botões azuis: cada tela tem a própria busca de placa.</p>
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

/* ---------------- + ORÇAMENTO e + O.S. (mesmo formulário do protótipo: 1. Cliente, 2. Veículo) ---------------- */
const MARCAS_2 = ["LAND ROVER", "MERCEDES BENZ", "MERCEDES-BENZ", "ALFA ROMEO", "GREAT WALL", "ASTON MARTIN", "ROLLS ROYCE"];
const separarMarca = txt => { const t = String(txt || "").trim().toUpperCase(), m2 = MARCAS_2.find(m => t.startsWith(m + " ")); if (m2) return { marca: m2, modelo: t.slice(m2.length).trim() }; const i = t.indexOf(" "); return i < 0 ? { marca: t, modelo: "" } : { marca: t.slice(0, i), modelo: t.slice(i + 1) }; };
const vazio = () => ({ clienteId: "", doc: "", nome: "", cep: "", cidade: "", uf: "", endereco: "", whats: "", nascimento: "", veiculoId: "", placa: "", marcaModelo: "", marca: "", modelo: "", ano: "", cor: "", motivo: "", daPlaca: null, doCPF: null });
// campos do veículo que a busca da placa (cadastro ou consulta) preenche; trocou a placa, eles saem
const CAMPOS_VEIC = { veiculoId: "", marcaModelo: "", marca: "", modelo: "", ano: "", cor: "", daPlaca: null };

function NovoOrcamento() {
  const { dados, perfil, cfg, avisar } = useApp();
  // o formulário começa em branco a cada abertura: sair da tela sem gravar não deixa nada (pedido do Danilo)
  const [f, setF] = useState(vazio);
  const [cpf, setCpf] = useState(null), [cep, setCep] = useState(null), [erros, setErros] = useState([]), [busca, setBusca] = useState(false), [salvando, setSalvando] = useState(false), [feito, setFeito] = useState(null);
  const topo = useRef(null);
  const set = p => setF(o => ({ ...o, ...p }));
  const pl = usarPlaca();
  const clienteParaForm = c => ({ clienteId: c.id, doc: c.doc ? fmtDoc(c.doc) : "", nome: c.nome || "", cep: c.cep || "", cidade: c.cidade || "", uf: c.uf || "", endereco: [c.rua, c.bairro].filter(Boolean).join(" — ") || c.endereco || "", whats: c.telefone ? fmtTel(c.telefone) : "", nascimento: "", doCPF: null });
  const aplicarVeic = v => set({ veiculoId: v.id || "", placa: v.placa, marcaModelo: nomeVeic(v), marca: v.marca, modelo: v.modelo, ano: v.ano || "", cor: v.cor || "", daPlaca: v.id ? null : { ano_fab: v.ano_fab, ano_mod: v.ano_mod, chassi: v.chassi, renavam: v.renavam },
    ...(v.cliente && !f.clienteId && !f.nome ? clienteParaForm(v.cliente) : {}) });
  // CPF: 1º o cadastro (sem custo), 2º a consulta (só administrador), como na Nova O.S. do sistema
  const buscarCPF = async () => {
    const d = soDig(f.doc);
    const cad = dados.clientes.find(c => soDig(c.doc) && soDig(c.doc) === d);
    if (cad) { set(clienteParaForm(cad)); setCpf({ ok: "Cadastro encontrado" }); return; }
    if (d.length === 14) { setCpf({ erro: docValido(d) ? "CNPJ fora do cadastro: preencha os dados da empresa." : "CNPJ inválido." }); return; }
    if (!validaCPF(d)) { setCpf({ erro: "CPF inválido. Confira os 11 números." }); return; }
    if (!ehAdmin(perfil)) { setCpf({ erro: "CPF fora do cadastro. A consulta pelo CPF é só do administrador: preencha o nome." }); return; }
    setCpf({ buscando: true });
    const r = await consultarCPF(d, { manual: true });
    if (r.ok && r.encontrado && r.dados) { const nome = f.nome.trim() ? f.nome : MAIUSC(r.dados.nome || ""); set({ clienteId: "", nome, nascimento: r.dados.nascimento || "", doCPF: { cpf: d, nome: f.nome.trim() ? "" : nome, nascimento: r.dados.nascimento || "" } }); setCpf({ ok: "Nome encontrado pelo CPF" }); }
    else setCpf({ erro: r.ok ? (r.sem_creditos ? "CPF fora da base e sem créditos na consulta: preencha o nome." : "CPF não encontrado: preencha o nome.") : (r.vencida ? "A chave da consulta de CPF venceu: cadastre a nova em Ajustes do sistema." : r.erro || "A consulta não respondeu: preencha o nome.") });
  };
  const buscarCEP = async () => {
    setCep({ buscando: true });
    const r = await consultarCep(f.cep);
    if (r.ok && r.encontrado) { const d = r.dados; set({ cep: fmtCep(d.cep || f.cep), cidade: d.cidade || f.cidade, uf: d.uf || f.uf, endereco: f.endereco.trim() ? f.endereco : [d.rua, d.bairro].filter(Boolean).join(" — ") }); setCep({ ok: "Endereço encontrado" }); }
    else setCep({ erro: r.ok ? "CEP não encontrado: preencha o endereço." : r.erro });
  };
  const buscarPlacaAqui = async () => { const v = await pl.buscar(f.placa); if (v) aplicarVeic(v); };
  const escolherCliente = c => { set(clienteParaForm(c)); setCpf({ ok: "Cadastro encontrado" }); setBusca(false); };
  const trocarMarcaModelo = txt => { const s = separarMarca(txt); set({ marcaModelo: txt, marca: s.marca, modelo: s.modelo, veiculoId: "" }); };
  /** nascimento que veio da consulta do CPF que está no campo (nunca o de outro CPF) */
  const nascDoCPF = () => { const p = f.doCPF; return p && p.cpf === soDig(f.doc) && p.nascimento ? { nascimento: p.nascimento } : {}; };

  const validar = () => {
    const e = [], p = normPlaca(f.placa);
    if (f.placa.trim() && !placaValida(p)) e.push("A placa está incompleta (ABC1234 ou ABC1D23). Confira ou deixe em branco.");
    if (!f.clienteId) {
      if (!f.nome.trim()) e.push("Informe o nome do cliente.");
      const t = soDig(f.whats);
      if (t && (t.length < 10 || t.length > 11)) e.push("Informe o WhatsApp com DDD.");
      else if (t.length >= 10) { const dup = dados.clientes.find(c => soDig(c.telefone) === t); if (dup) e.push("Este telefone já é de " + dup.nome + ". Toque em “Buscar no cadastro” e escolha o cliente."); }
      if (f.doc.trim()) { if (!docValido(f.doc)) e.push("CPF/CNPJ inválido. Confira os números ou deixe em branco."); else { const dup = dados.clientes.find(c => soDig(c.doc) === soDig(f.doc)); if (dup) e.push("Já existe um cliente com este CPF/CNPJ: " + dup.nome + ". Toque na lupa do CPF."); } }
    } else { const cli = dados.clientes.find(c => c.id === f.clienteId); if (cli && cli.situacao === "bloqueado") e.push("Cliente bloqueado: " + (cli.restricao || "verifique o cadastro") + "."); }
    return e;
  };
  const enderecoNovo = () => { const [rua = "", bairro = ""] = f.endereco.split(/\s+—\s+|\s+-\s+/); const c = soDig(f.cep).length === 8 ? fmtCep(f.cep) : "";
    const cidade = (c && f.cidade.trim()) || "Colatina", uf = (c && f.uf.trim()) || "ES";
    return { rua: rua.trim(), bairro: bairro.trim(), cidade, uf, ...(c ? { cep: c } : {}) }; };

  const trava = useRef(false);
  const gravar = async () => {
    if (trava.current) return; // dois toques seguidos não gravam duas vezes
    const e = validar(); setErros(e); if (e.length) { topo.current && topo.current.scrollIntoView({ behavior: "smooth" }); return; }
    trava.current = true; setSalvando(true);
    try {
      const p = normPlaca(f.placa), veiCad = f.veiculoId ? dados.veiculos.find(v => v.id === f.veiculoId) : (p ? dados.veiculos.find(v => v.placa === p) : null);
      const cli = dados.clientes.find(c => c.id === f.clienteId) || null;
      // cliente só digitado: a cópia vai no orçamento (copiaClienteDig), como no orçamento do sistema; o cadastro acontece na aprovação
      const clienteDig = cli ? { nome: cli.nome, telefone: cli.telefone || "" } : copiaClienteDig({ nome: f.nome, telefone: soDig(f.whats), doc: f.doc, ...enderecoNovo(), ...nascDoCPF() });
      if (!cli && erroClienteDig({ doc: f.doc })) throw new Error(erroClienteDig({ doc: f.doc }));
      const validade = cfg.validadeDias ? somaDias(hojeISO(), Number(cfg.validadeDias)) : "";
      const r = await api.orcamentos.salvar({ cliente_id: cli ? cli.id : "", veiculo_id: veiCad ? veiCad.id : "", cliente: clienteDig,
        veiculo: { placa: p, marca: veiCad ? veiCad.marca || "" : f.marca, modelo: veiCad ? veiCad.modelo || "" : f.modelo, ano: String((veiCad ? veiCad.ano : f.ano) || "") }, reclamacao: f.motivo.trim(), obs: "", obs_internas: "", tabela_preco: "vista",
        condicoes_pagamento: cfg.condicoesPadrao || "", desconto: 0, validade, situacao: "elaboracao", motivo: "", itens: [] });
      setF(vazio()); setCpf(null); setCep(null); pl.limpar();
      setFeito({ id: r.id, numero: r.numero });
    } catch (x) { avisar("Não foi possível criar o orçamento: " + (x.message || x), true); }
    finally { trava.current = false; setSalvando(false); }
  };

  const auto = f.clienteId ? " auto" : "";
  const linhaCpf = cpf && cpf.buscando ? html`<div class="achou buscando">Consultando o CPF…</div>` : cpf && cpf.ok ? html`<div class="achou"><${Ic} n="check" t=${16} sw=${2.4} />${cpf.ok}</div>` : cpf && cpf.erro ? html`<div class="achou nao">${cpf.erro}</div>` : null;
  const placa = pl.placa;
  const linhaPlaca = placa.buscando && placa.texto === normPlaca(f.placa) ? html`<div class="achou buscando">Consultando a placa…</div>`
    : f.veiculoId ? html`<div class="achou"><${Ic} n="check" t=${16} sw=${2.4} />Placa gravada no banco da DTCar</div>`
    : f.daPlaca ? html`<div class="achou"><${Ic} n="check" t=${16} sw=${2.4} />Placa nova: consultada e gravada</div>`
    : placa.naoAchou && placa.texto === normPlaca(f.placa) ? html`<div class="achou nao">${placa.motivo} Digite a marca e o modelo.</div>` : null;
  const acao = html`<div class="acao"><button type="button" class="btn-acao" disabled=${salvando} onClick=${gravar}>${salvando ? "Gravando…" : "Criar orçamento"}</button></div>`;
  return html`<${Tela} tela="orcamento" acao=${acao} ajuda="Preencha o cliente (toque na lupa do CPF para buscar no cadastro) e o veículo (lupa da placa) e toque em Criar orçamento. Em seguida você inclui os serviços e as peças.">
    <div ref=${topo}></div>
    ${erros.length ? html`<div class="erro" role="alert">Corrija para continuar:<ul>${erros.map((x, i) => html`<li key=${i}>${x}</li>`)}</ul></div>` : null}
    <${Cartao} titulo="1. Cliente" id="c-cliente">${linhaCpf}
      <${Campo} id="f-cpf" rotulo="CPF ou CNPJ"><div class="linha"><input id="f-cpf" class="inp livre" inputmode="numeric" autocomplete="off" placeholder="000.000.000-00" value=${f.doc} onInput=${e => { const v = e.target.value, p = f.doCPF; const tira = p && p.cpf !== soDig(v) ? { nascimento: "", nome: p.nome && f.nome === p.nome ? "" : f.nome, doCPF: null } : {}; set({ doc: v, clienteId: "", ...tira }); setCpf(null); }} onBlur=${() => { if ([11, 14].includes(soDig(f.doc).length) && !f.clienteId && !f.nome.trim()) buscarCPF(); }} />
        <button type="button" class="btn-busca g" aria-label="Buscar pelo CPF" onClick=${buscarCPF}><${Ic} n="search" t=${22} /></button></div></${Campo}>
      <${Campo} id="f-nome" rotulo=${f.clienteId ? "Nome (do cadastro)" : "Nome"}><input id="f-nome" class=${"inp" + auto} autocomplete="off" placeholder="Nome do cliente" value=${f.nome} onInput=${e => set({ nome: e.target.value, clienteId: "" })} /></${Campo}>
      <button type="button" class="link" style="align-self:flex-start;background:none;border:0;color:#2f6fb5;font-weight:600;font-size:13px;min-height:36px;padding:0" onClick=${() => setBusca(true)}>Buscar no cadastro pelo nome, telefone ou placa</button>
      <div class="grade-cep"><${Campo} id="f-cep" rotulo="CEP"><div class="linha"><input id="f-cep" class="inp livre" inputmode="numeric" autocomplete="off" placeholder="29700-000" value=${f.cep} onInput=${e => { set({ cep: e.target.value }); setCep(null); }} onBlur=${() => { if (soDig(f.cep).length === 8 && !f.cidade) buscarCEP(); }} />
          <button type="button" class="btn-busca g" aria-label="Buscar pelo CEP" onClick=${buscarCEP}><${Ic} n="search" t=${22} /></button></div></${Campo}>
        <${Campo} id="f-cidade" rotulo="Cidade / UF"><input id="f-cidade" class="inp auto" autocomplete="off" placeholder="Colatina / ES" value=${[f.cidade, f.uf].filter(Boolean).join(" / ")} onInput=${e => { const [c = "", u = ""] = e.target.value.split("/"); set({ cidade: c.trim(), uf: u.trim().toUpperCase().slice(0, 2) }); }} /></${Campo}></div>
      ${cep && cep.erro ? html`<div class="achou nao">${cep.erro}</div>` : cep && cep.buscando ? html`<div class="achou buscando">Buscando o CEP…</div>` : null}
      <${Campo} id="f-end" rotulo="Endereço"><input id="f-end" class="inp" autocomplete="off" placeholder="Rua, número — bairro" value=${f.endereco} onInput=${e => set({ endereco: e.target.value })} /></${Campo}>
      <${Campo} id="f-whats" rotulo="WhatsApp"><input id="f-whats" class="inp livre" inputmode="tel" autocomplete="off" placeholder="(27) 90000-0000" value=${f.whats} onInput=${e => set({ whats: e.target.value })} onBlur=${() => { const t = soDig(f.whats); if (t.length >= 10) set({ whats: fmtTel(t) }); }} /></${Campo}></${Cartao}>
    <${Cartao} titulo="2. Veículo" id="c-veiculo">${linhaPlaca}
      <${Campo} id="f-placa" rotulo="Placa"><div class="linha"><input id="f-placa" class="inp placa" autocomplete="off" autocapitalize="characters" maxlength="8" placeholder="ABC1D23" value=${f.placa} onInput=${e => set({ ...CAMPOS_VEIC, placa: e.target.value })} onBlur=${() => { if (normPlaca(f.placa).length === 7 && !f.veiculoId && !f.marca) buscarPlacaAqui(); }} />
        <button type="button" class="btn-busca g" aria-label="Buscar pela placa" onClick=${buscarPlacaAqui}><${Ic} n="search" t=${22} /></button></div></${Campo}>
      <div class="nota">Placa já gravada não gera nova consulta paga. Placa nova é consultada uma vez e fica salva.</div>
      <${Campo} id="f-mm" rotulo=${f.veiculoId || f.daPlaca ? "Marca e modelo (preenchido pela busca)" : "Marca e modelo"}><input id="f-mm" class=${"inp" + (f.veiculoId || f.daPlaca ? " auto" : "")} autocomplete="off" placeholder="Ex.: VOLKSWAGEN GOL 1.0" value=${f.marcaModelo} onInput=${e => trocarMarcaModelo(e.target.value)} /></${Campo}>
      <div class="grade2"><${Campo} id="f-ano" rotulo="Ano"><input id="f-ano" class=${"inp livre" + (f.veiculoId || f.daPlaca ? " auto" : "")} inputmode="numeric" autocomplete="off" placeholder="2015" value=${f.ano} onInput=${e => set({ ano: e.target.value.replace(/[^\d/]/g, "").slice(0, 9) })} /></${Campo}>
        <${Campo} id="f-cor" rotulo="Cor"><input id="f-cor" class=${"inp" + (f.veiculoId || f.daPlaca ? " auto" : "")} autocomplete="off" placeholder="PRATA" value=${f.cor} onInput=${e => set({ cor: e.target.value })} /></${Campo}></div></${Cartao}>
    <${Cartao} titulo="3. Serviço pedido" id="c-servico">
      <${Campo} id="f-motivo" rotulo="O que o cliente quer orçar (opcional)"><textarea id="f-motivo" class="area" placeholder="Ex.: troca de pastilhas e discos" value=${f.motivo} onInput=${e => set({ motivo: e.target.value })}></textarea></${Campo}></${Cartao}>
    ${busca ? html`<${BuscaClienteQuadro} onEscolha=${escolherCliente} onFechar=${() => setBusca(false)} />` : null}
    ${feito ? html`<${Quadro} titulo=${numORC(feito.numero) + " criado"} onFechar=${() => setFeito(null)}>
      <p>Agora inclua os serviços e as peças do orçamento.</p>
      <a class="btn-acao" style="display:flex;align-items:center;justify-content:center;text-decoration:none" href=${SISTEMA + "#/orcamento/" + feito.id}>Incluir os itens</a>
      <button type="button" class="link" onClick=${() => { setFeito(null); ir("inicio"); }}>Voltar ao Início</button></${Quadro}>` : null}
  </${Tela}>`;
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
  const { dados, avisar } = useApp();
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
      const zap = a.aviso && tel ? linkWhats(tel, mensagemAgenda(a.nome, servico, a.data, hora, v)) : "";
      setAgenda(m => ({ ...m, [a.data]: (m[a.data] || 0) + 1 }));
      setFeito({ r, zap });
    } catch (x) { setErro(x.message || String(x)); } finally { trava.current = false; setSalvando(false); }
  };
  const acao = html`<div class="acao">
    <button type="button" class="marcar" aria-pressed=${a.aviso ? "true" : "false"} onClick=${() => set({ aviso: !a.aviso })}><span class="cx">${a.aviso ? html`<${Ic} n="check" t=${16} sw=${2.6} />` : null}</span>Avisar o cliente pelo WhatsApp</button>
    <div class="resumo">${resumo}</div>
    <button type="button" class="btn-acao" disabled=${salvando} onClick=${gravar}>${salvando ? "Gravando…" : a.aviso ? "Agendar e avisar o cliente" : "Agendar serviço"}</button></div>`;
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
  const [cat, setCat] = useState(null), [erro, setErro] = useState(""), [mao, setMao] = useState({ modelo: "", ano: "" }), [verFiltros, setVerFiltros] = useState(true), [detalhe, setDetalhe] = useState(false);
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
      ${oleos.slice(0, detalhe ? 3 : 1).map((g, i) => html`<div key=${i}><${KV} a="Litragem" b=${g.litros ? g.litros + " L" : "—"} /><${KV} a="Viscosidade" b=${g.viscosidade || "—"} />
        ${detalhe ? html`<${KV} a="Carro" b=${g.linha.modelo + " " + (g.linha.motor || "") + (periodoTexto(g.linha) ? " · " + periodoTexto(g.linha) : "")} p /><${KV} a="Norma" b=${g.linha.norma || "—"} p /><${KV} a="Fonte" b=${g.linha.fonte || "catálogo"} p />` : null}
        ${g.linha.aviso ? html`<div class="nota"><span class="selo atencao">Atenção</span>${g.linha.aviso}</div>` : null}</div>`)}
      <div class="nota">Dado de catálogo: confira no manual antes de aplicar.</div>
      <button type="button" class="btn-barra claro" onClick=${() => setDetalhe(!detalhe)}>${detalhe ? "Voltar ao resumo" : "Ver detalhes (norma e fontes)"}</button></${Cartao}>` : null}
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
  { id: "tr", nome: "Transmissão", icone: "engrenagem", re: /embreagem|homocin|tulipa|semieixo|tripe[cç]a|trizeta|junta deslizante|cardan|cruzeta|coroa|pinh[aã]o|c[aâ]mbio|diferencial|flange|luva|garfo|mancal central|planet|veloc[ií]metro|transmiss/i },
  { id: "di", nome: "Direção", icone: "volante", re: /dire[cç][aã]o|terminal|axial|ponteira|barra de liga|barra central|barra lateral/i },
  { id: "su", nome: "Suspensão", icone: "amortecedor", re: /amortecedor|mola|bandeja|bra[cç]o|piv[oô]|bieleta|bucha|batente|estabiliz|tirante|barra de rea|cubo|mancal do cubo|suspens|pino|apoio|prato/i },
  { id: "mo", nome: "Motor", icone: "motor", re: /motor|junta|cabe[cç]ote|bomba d|bomba de [oó]leo|reservat|anel|mangueira|abra[cç]adeira|acelerador|correia|coxim|suporte|filtro|palheta|parafuso/i },
];
const sistemaDoGrupo = g => { const x = SISTEMAS.find(sis => sis.re.test(g || "")); return x ? x.id : "ou"; };
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
  const [itens, setItens] = useState({}), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true; setErro(""); const ids = ordens.map(o => o.id).filter(id => !itens[id]); if (!ids.length) return;
    api.itensDasOrdens(ids.slice(0, 60)).then(l => { if (!vivo) return; const m = {}; ids.forEach(id => { m[id] = []; }); l.forEach(i => { (m[i.ordem_id] = m[i.ordem_id] || []).push(i); }); setItens(x => ({ ...x, ...m })); })
      .catch(() => vivo && setErro("Não deu para carregar os serviços de cada O.S. (sem internet?). Mostrando só o que o cliente pediu."));
    return () => { vivo = false; }; }, [ordens]);
  const servicos = o => { const l = (itens[o.id] || []).filter(i => i.tipo === "servico" && i.aprovado !== false).map(i => i.descricao); if (l.length) return l; return o.reclamacao ? [o.reclamacao] : []; };
  return html`<${Tela} tela="historico" ajuda="Busque a placa: aparecem todas as O.S. do carro, da mais nova para a mais antiga, com a data, o KM e os serviços feitos. Toque em uma O.S. para abrir.">
    <${BuscaPlaca} id="hs-placa" pl=${pl} /><${Veiculo} v=${v} />
    ${erro ? html`<div class="nota" style="padding:0 6px">${erro}</div>` : null}
    ${!v ? html`<div class="vazio">Digite a placa para ver o histórico de serviços.</div>` : !ordens.length ? html`<div class="vazio">Nenhuma O.S. deste veículo no sistema.</div>` : null}
    ${ordens.map(o => html`<${Cartao} key=${o.id} titulo=${fmtData((o.criado_em || "").slice(0, 10)) + (o.km_entrada ? " · " + fmtKm(o.km_entrada) : "")}>
      ${servicos(o).length ? servicos(o).map((s, i) => html`<div class="check" key=${i}><${Ic} n="check" t=${16} sw=${2.4} />${s}</div>`) : html`<div class="nota">${itens[o.id] ? "Sem serviço lançado." : "Carregando…"}</div>`}
      <div class="nota">${numOS(o.numero)} · ${(situacaoOS(o) || STATUS[o.status] || {}).t || o.status}${o.mecanico_nome ? " · " + o.mecanico_nome : ""}</div>
      <a class="btn-barra" style="text-decoration:none;justify-content:center" href=${SISTEMA + "#/os/" + o.id}><${Ic} n="os" t=${22} />Abrir ${numOS(o.numero)}</a></${Cartao}>`)}
  </${Tela}>`;
}

/* ---------------- CONSULTAR O.S. ---------------- */
function OSConsulta() {
  const { dados, perfil } = useApp(); const pl = usarPlaca();
  const v = pl.veic, ver = pode(perfil, "verValores");
  const ordens = useMemo(() => v ? ordensDoVeiculo(dados, v) : [], [dados.ordens, v]);
  const [q, setQ] = useState("");
  const porNumero = useMemo(() => { const d = soDig(q); if (!d) return []; return dados.ordens.filter(o => String(o.numero) === String(+d)).slice(0, 3); }, [q, dados.ordens]);
  const lista = v ? ordens : porNumero;
  return html`<${Tela} tela="osconsulta" ajuda="Busque a placa (ou digite o número da O.S.) e veja as O.S. do carro com abertura, situação, serviços e total. “Abrir O.S.” mostra a O.S. completa.">
    <${BuscaPlaca} id="oc-placa" pl=${pl} /><${Veiculo} v=${v} />
    ${!v ? html`<${Cartao} titulo="Ou pelo número da O.S."><input id="oc-num" class="inp livre" inputmode="numeric" autocomplete="off" placeholder="Ex.: 1927" value=${q} onInput=${e => setQ(e.target.value)} /></${Cartao}>` : null}
    ${!lista.length ? html`<div class="vazio">${v ? "Nenhuma O.S. deste veículo." : "Digite a placa ou o número da O.S."}</div>` : null}
    ${lista.map(o => html`<${Cartao} key=${o.id} titulo=${numOS(o.numero)}>
      <${KV} a="Abertura" b=${fmtData((o.criado_em || "").slice(0, 10))} /><${KV} a="Situação" b=${(situacaoOS(o) || STATUS[o.status] || {}).t || o.status} />
      <${KV} a="Serviços" b=${o.reclamacao ? String(o.reclamacao).slice(0, 80) : "—"} p />
      ${ver ? html`<${KV} a="Total" b=${reais(o.total)} />` : null}
      ${!v && (o.veiculo || {}).placa ? html`<${KV} a="Veículo" b=${[(o.veiculo || {}).modelo, exPlaca(o.veiculo.placa)].filter(Boolean).join(" · ")} p />` : null}
      <a class="btn-barra" style="text-decoration:none" href=${SISTEMA + "#/os/" + o.id}><${Ic} n="os" t=${22} />Abrir O.S.</a></${Cartao}>`)}
    ${lista.length && perfil.papel !== "admin" ? html`<div class="info"><b>Somente leitura.</b> Alterar uma O.S. existente só é possível no login do administrador.</div>` : null}
  </${Tela}>`;
}

/* ---------------- AJUDA (acesso, digital, versão, sair) ---------------- */
function Ajuda() {
  const { perfil, sair, nativo } = useApp();
  const [disp, setDisp] = useState(false), [ligada, setLigada] = useState(nativo.digital.ligada());
  useEffect(() => { nativo.digital.disponivel().then(setDisp); }, []);
  const alternar = async () => { if (ligada) { nativo.digital.desligar(); setLigada(false); } else { const ok = await nativo.digital.ativar(); setLigada(!!ok); } };
  return html`<div class="app"><${Cabecalho} /><main class="folha">
    <div class="titulo"><div class="meio"><${Ic} n="help" t=${22} sw=${1.9} /><b>AJUDA</b></div></div>
    <${Cartao} titulo="Seu acesso"><div class="linha-valor"><span>Nome</span><b>${perfil.nome}</b></div><div class="linha-valor"><span>E-mail</span><b>${perfil.email || ""}</b></div><div class="linha-valor"><span>Acesso</span><b>${{ admin: "Administrador", consultor: "Consultor" }[perfil.papel] || perfil.papel}</b></div>
      ${disp ? html`<div class="chave" id="bloco-digital"><span>Entrar com a digital</span><button type="button" role="switch" aria-label="Entrar com a digital" aria-checked=${ligada ? "true" : "false"} data-acao="chave-digital" onClick=${alternar}></button></div>` : null}
      <div class="nota">Neste app, alterar uma O.S. que já existe só é possível no login do administrador.</div></${Cartao}>
    <${Cartao} titulo="Como usar"><div class="nota">Cada tela tem a própria busca de placa (placa do cadastro não custa nada). Óleo e Peças mostram o catálogo com o que há no estoque. + Orçamento e Agendar gravam no sistema na hora. O botão Voltar do celular volta ao Início; no Início, sai do app.</div></${Cartao}>
    <${Cartao} titulo="Sobre o app"><div class="linha-valor"><span>Versão</span><b>${nativo.VERSAO}</b></div><div class="nota">DTCar Centro Automotivo. As telas chegam pelo site: não precisa instalar de novo quando algo muda.</div>
      <button type="button" class="btn-barra claro" style="justify-content:center" onClick=${sair}>SAIR DO APP</button></${Cartao}>
  </main><${Rodape} tela="ajuda" /></div>`;
}

/* ---------------- raiz: dados, rota, aviso ---------------- */
const ROTAS = { inicio: Inicio, ajuda: Ajuda, oleo: Oleo, orcamento: NovoOrcamento, agendar: Agendar, peca: Peca, historico: Historico, osconsulta: OSConsulta };
// quadros abertos (lista de peças, cliente, confirmação): o botão Voltar do celular fecha o de cima antes de trocar de tela
const quadros = [];
function App({ usuario, nativo }) {
  const [rota, setRota] = useState(rotaAtual());
  const [dados, setDados] = useState({ clientes: [], veiculos: [], produtos: [], ordens: [], perfis: [], carregado: false, erro: "" });
  const [cfg, setCfg] = useState(cfgCompleta({}));
  const [placa, setPlaca] = useState({ texto: "" });
  const [toast, setToast] = useState(null);
  useEffect(() => { const f = () => { setRota(rotaAtual()); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  const avisar = (msg, erro) => { setToast({ msg, erro }); clearTimeout(avisar.t); avisar.t = setTimeout(() => setToast(null), 4500); };
  const carregar = async () => {
    try {
      const [clientes, veiculos, produtos, ordens, perfis, c] = await Promise.all([api.clientes.listar(), api.veiculos.listar(), api.produtos.listar(), api.ordens(), api.perfis().catch(() => []), api.config().catch(() => ({}))]);
      setDados({ clientes, veiculos, produtos, ordens, perfis, carregado: true, erro: "" }); setCfg(cfgCompleta(c));
    } catch (e) { setDados(d => ({ ...d, carregado: true, erro: "Não deu para carregar os dados do sistema (" + (e.message || "sem internet") + "). As buscas podem ficar incompletas." })); }
  };
  useEffect(() => { carregar(); }, []);
  const ctx = { perfil: usuario, dados, cfg, avisar, recarregar: carregar, sair: nativo.sair, nativo };
  const Tela = ROTAS[rota] || Inicio;
  return html`<${Ctx.Provider} value=${ctx}>
    ${dados.erro ? html`<div class="toast erro" role="alert" style="bottom:auto;top:8px">${dados.erro}</div>` : null}
    <${Tela} key=${rota} />
    ${toast ? html`<div class=${"toast" + (toast.erro ? " erro" : "")} role="status">${toast.msg}</div>` : null}</${Ctx.Provider}>`;
}

/** chamado pelo app.js depois do login (e da digital) */
export function montar(usuario, nativo) {
  if (!/^#\/(inicio|ajuda|oleo|orcamento|agendar|peca|historico|osconsulta)$/.test(location.hash)) location.hash = "#/inicio";
  const raiz = document.getElementById("raiz"); raiz.innerHTML = "";
  render(html`<${App} usuario=${usuario} nativo=${nativo} />`, raiz);
}
export function desmontar() { render(null, document.getElementById("raiz")); }
/** botão Voltar do celular (app.js): fecha o quadro aberto; senão vai para o Início; no Início devolve false (o app sai) */
export function voltar() {
  if (quadros.length) { quadros[quadros.length - 1](); return true; }
  if (rotaAtual() !== "inicio") { ir("inicio"); return true; }
  return false;
}
