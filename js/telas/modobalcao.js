// Modo balcão: o mesmo sistema com a cara do OS Oficina 3.0 (barra de menus, barra de ícones, área de trabalho
// com o fundo da DTCar, menu de O.S. em janela e barra de status). Mesmas telas, regras e banco de dados.
import { html, useState, useEffect, useRef } from "../lib.js";
import { useApp, Modal, I } from "../ui.js";
import { normPlaca, soDig, lsGet, lsSet } from "../util.js";
import { pode, ABERTOS } from "../regras.js";
import { temaEfetivo, temaEscolhido, aplicarTema } from "../tema.js";

const LS = "dtcar-modo";
export const modoBalcao = () => lsGet(LS) === "balcao";
export const usarModo = m => { lsSet(LS, m === "balcao" ? "balcao" : null); location.hash = m === "balcao" ? "#/inicio" : "#/painel"; location.reload(); };

const MAIS_I = {
  os: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 00-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 005.2-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>`,
  placa: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="2"/><path d="M2.5 9.5h19M7 13.5h10"/></svg>`,
  lupa: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/></svg>`,
  impressora: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 9V3h10v6M7 17H4v-7h16v7h-3"/><path d="M7 14h10v7H7z"/></svg>`,
  cancelar: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 8.5l7 7M15.5 8.5l-7 7"/></svg>`,
  ok: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/></svg>`,
  relogio: html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
};

/** Menus de texto (como no sistema antigo). Cada item: [rótulo, rota ou ação, permissão, atalho] */
function menus(perfil) {
  const m = [
    ["Cadastros", [["Clientes", "/cadastros"], ["Veículos", "/cadastros?aba=veiculos"], ["Produtos e serviços", "/cadastros?aba=produtos", "", "F6"], ["Fornecedores", "/cadastros?aba=fornecedores"], ["Funcionários", "/funcionarios", "financeiro"]]],
    ["O.S. / Orçamento", [["Nova ordem / orçamento", "/entrada", "entrada", "F2"], ["Alterar / consultar", "#consultar", "", "F3"], ["Pesquisar pendentes", "/ordens?filtro=abertas", "", "F4"], ["Pesquisar finalizados", "/ordens?filtro=entregue"], ["Rastrear por placa", "#placa", "", "F7"], ["Menu de O.S.", "#menu-os", "", "F8"]]],
    ["Vendas", [["Venda de balcão", "/balcao", "verValores"], ["Vendas realizadas", "/balcao?aba=historico", "verValores"], ["Recibos", "/recibos", "verValores"]]],
    ["Compras", [["Notas da SEFAZ", "/sefaz", "cadastrar"], ["Entrada de nota (XML)", "/nfe", "cadastrar"]]],
    ["Contas", [["Contas a pagar", "/financeiro", "financeiro"]]],
    ["Relatórios", [["Central de relatórios", "/relatorios", "verValores"], ["Painel de resultados", "/painel"]]],
    ["Sistema", [["Equipe", "/equipe", "ajustes"], ["Ajustes", "/ajustes", "ajustes"], ["Backup", "/backup", "ajustes"], ["Importar OS Oficina", "/importar", "ajustes"], ["Voltar ao modo moderno", "#moderno"], ["Sair", "#sair"]]],
  ];
  return m.map(([t, itens]) => [t, itens.filter(i => !i[2] || pode(perfil, i[2]))]).filter(([, itens]) => itens.length);
}
const ICONES = [
  ["Clientes", "/cadastros", I.pessoas, "c-azul"], ["Veículos", "/cadastros?aba=veiculos", I.carro, "c-azul"], ["Produtos", "/cadastros?aba=produtos", I.caixa, "c-verm"],
  ["Funcion.", "/funcionarios", I.pessoas, "c-verde", "financeiro"], "|",
  ["Nova O.S.", "/entrada", I.mais, "c-verde", "entrada"], ["O.S.", "#menu-os", MAIS_I.os, "c-laranja"], ["Placas", "#placa", MAIS_I.placa, "c-verm"], ["Pendentes", "/ordens?filtro=abertas", MAIS_I.relogio, "c-amarelo"], "|",
  ["Vendas", "/balcao", I.carrinho, "c-verde", "verValores"], ["Recibo", "/recibos", I.recibo, "c-cinza", "verValores"], ["Contas", "/financeiro", I.dinheiro, "c-verde", "financeiro"],
  ["SEFAZ", "/sefaz", I.nuvem, "c-azul", "cadastrar"], ["Relatório", "/relatorios", I.grafico, "c-roxo", "verValores"], "|", ["Painel", "/painel", I.painel, "c-cinza"],
];

export function BarraBalcao({ rota }) {
  const { perfil, ir, sair } = useApp();
  const [aberto, setAberto] = useState(null), [janela, setJanela] = useState(null);
  const ref = useRef(null);
  const acao = r => {
    setAberto(null);
    if (r === "#consultar") setJanela({ tipo: "consultar" });
    else if (r === "#placa") setJanela({ tipo: "placa" });
    else if (r === "#menu-os") setJanela({ tipo: "menu" });
    else if (r === "#moderno") usarModo("moderno");
    else if (r === "#sair") sair();
    else ir(r);
  };
  useEffect(() => {
    const fora = e => { if (ref.current && !ref.current.contains(e.target)) setAberto(null); };
    const teclas = e => {
      const mapa = { F2: pode(perfil, "entrada") ? "/entrada" : null, F3: "#consultar", F4: "/ordens?filtro=abertas", F6: "/cadastros?aba=produtos", F7: "#placa", F8: "#menu-os" };
      if (mapa[e.key] && !document.querySelector(".fundo-modal")) { e.preventDefault(); acao(mapa[e.key]); }
    };
    document.addEventListener("pointerdown", fora); document.addEventListener("keydown", teclas);
    return () => { document.removeEventListener("pointerdown", fora); document.removeEventListener("keydown", teclas); };
  }, []);
  return html`<div class="balcao-topo" ref=${ref}>
    <nav class="balcao-menus" aria-label="Menus">${menus(perfil).map(([t, itens]) => html`<div class="bm" key=${t}>
      <button type="button" aria-expanded=${aberto === t ? "true" : "false"} onClick=${() => setAberto(aberto === t ? null : t)} onMouseEnter=${() => aberto && setAberto(t)}>${t}</button>
      ${aberto === t ? html`<div class="bm-lista" role="menu">${itens.map(([r, dest, , at]) => html`<button type="button" role="menuitem" key=${r} onClick=${() => acao(dest)}><span>${r}</span>${at ? html`<kbd>${at}</kbd>` : null}</button>`)}</div>` : null}
    </div>`)}</nav>
    <nav class="balcao-icones" aria-label="Atalhos">${ICONES.filter(x => x === "|" || !x[4] || pode(perfil, x[4])).map((x, n) => x === "|" ? html`<span class="sep" key=${"s" + n}></span>`
      : html`<button type="button" key=${x[0]} class=${"bi " + x[3]} aria-current=${rota === x[1] ? "page" : undefined} onClick=${() => acao(x[1])}><span class="bi-ic">${x[2]}</span><span>${x[0]}</span></button>`)}</nav>
    ${janela && janela.tipo === "menu" ? html`<${MenuOS} onFechar=${() => setJanela(null)} abrir=${t => setJanela({ tipo: t })} />` : null}
    ${janela && (janela.tipo === "consultar" || janela.tipo === "placa" || janela.tipo === "imprimir" || janela.tipo === "cancelar")
      ? html`<${Localizar} tipo=${janela.tipo} onFechar=${() => setJanela(null)} />` : null}
  </div>`;
}

/** Janela "Menu de O.S." no modelo do sistema antigo */
function MenuOS({ onFechar, abrir }) {
  const { ir, perfil } = useApp();
  const vai = r => { onFechar(); ir(r); };
  const b = (t, ic, fn, cls, perm) => perm && !pode(perfil, perm) ? null : html`<button type="button" class=${"mo-bt " + (cls || "")} onClick=${fn}><span class="mo-ic">${ic}</span><span>${t}</span></button>`;
  return html`<${Modal} titulo="Ordem de serviço / orçamento" onFechar=${onFechar}>
    <div class="menu-os">
      ${b("Nova ordem / orçamento", I.mais, () => vai("/entrada"), "c-verde", "entrada")}
      ${b("Alterar / consultar", I.editar, () => abrir("consultar"), "c-azul")}
      ${b("Cancelar", MAIS_I.cancelar, () => abrir("cancelar"), "c-verm", "aprovar")}
      ${b("Finalizar / concluir", MAIS_I.ok, () => vai("/ordens?filtro=pronto"), "c-verde", "entregar")}
      ${b("Emitir / imprimir", MAIS_I.impressora, () => abrir("imprimir"), "c-cinza")}
      ${b("Rastrear por placa", MAIS_I.placa, () => abrir("placa"), "c-verm")}
      ${b("Pesquisar pendentes", MAIS_I.relogio, () => vai("/ordens?filtro=abertas"), "c-amarelo")}
      ${b("Pesquisar finalizados", MAIS_I.lupa, () => vai("/ordens?filtro=entregue"), "c-azul")}
      ${b("Relatório", I.grafico, () => vai("/relatorios"), "c-roxo", "verValores")}
      ${b("Sair do menu", I.sair, onFechar, "c-cinza")}
    </div>
  </${Modal}>`;
}

/** Localiza O.S. pelo número ou veículo pela placa */
function Localizar({ tipo, onFechar }) {
  const { dados, ir } = useApp();
  const [q, setQ] = useState(""), [msg, setMsg] = useState("");
  const titulo = { consultar: "Alterar / consultar O.S.", placa: "Rastrear por placa", imprimir: "Emitir / imprimir O.S.", cancelar: "Cancelar O.S." }[tipo];
  const ir2 = r => { onFechar(); ir(r); };
  const buscar = e => {
    e.preventDefault(); setMsg("");
    const d = soDig(q), p = normPlaca(q);
    if (tipo !== "placa" && d && d.length <= 6 && d === q.trim()) {
      const o = dados.ordens.find(x => String(x.numero) === String(+d));
      if (!o) return setMsg("O.S. " + d + " não encontrada.");
      return ir2(tipo === "imprimir" ? "/imprimir/os/" + o.id : "/os/" + o.id);
    }
    if (p.length >= 5) {
      const v = dados.veiculos.filter(x => x.placa && x.placa.includes(p));
      if (!v.length) return setMsg("Nenhum veículo com a placa " + p + ".");
      if (tipo === "placa" || v.length > 1) return ir2(v.length === 1 ? "/veiculo/" + v[0].id : "/cadastros?aba=veiculos&q=" + p);
      const os = dados.ordens.filter(o => o.veiculo_id === v[0].id && (tipo === "imprimir" || ABERTOS.includes(o.status)));
      if (!os.length) return ir2("/veiculo/" + v[0].id);
      return ir2(tipo === "imprimir" ? "/imprimir/os/" + os[0].id : "/os/" + os[0].id);
    }
    setMsg(tipo === "placa" ? "Digite a placa (pelo menos 5 caracteres)." : "Digite o número da O.S. ou a placa.");
  };
  return html`<${Modal} titulo=${titulo} onFechar=${onFechar}>
    <form onSubmit=${buscar}>
      <label class="campo" for="loc-q"><span class="sub">${tipo === "placa" ? "Placa do veículo" : "Número da O.S. ou placa"}</span>
        <input id="loc-q" class="inp inp-placa" autofocus autocomplete="off" value=${q} onInput=${e => setQ(e.target.value.toUpperCase())} /></label>
      ${tipo === "cancelar" ? html`<p class="sub">A O.S. abre na tela de edição; o cancelamento é feito por lá, com o motivo registrado no histórico.</p>` : null}
      ${msg ? html`<div class="aviso">${msg}</div>` : null}
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button><button type="submit" class="btn btn-pri">Localizar</button></div>
    </form>
  </${Modal}>`;
}

/** Área de trabalho: fundo da DTCar, como a tela inicial do sistema antigo */
export function AreaTrabalho() {
  const { dados, ir } = useApp();
  const abertas = dados.ordens.filter(o => ABERTOS.includes(o.status));
  const prontas = abertas.filter(o => o.status === "pronto").length;
  return html`<div class="area-trabalho">
    <div class="at-resumo">
      <button type="button" onClick=${() => ir("/ordens?filtro=abertas")}><b>${abertas.length}</b><span>O.S. em aberto</span></button>
      <button type="button" onClick=${() => ir("/ordens?filtro=pronto")}><b>${prontas}</b><span>prontas para retirada</span></button>
    </div>
    <p class="at-dica">F2 nova O.S. · F3 consultar · F4 pendentes · F6 produtos · F7 placa · F8 menu de O.S.</p>
  </div>`;
}

/** Barra de status no rodapé */
export function StatusBalcao() {
  const { perfil, cfg } = useApp();
  const [agora, setAgora] = useState(new Date()), [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const t = setInterval(() => setAgora(new Date()), 30000); const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener("online", on); window.addEventListener("offline", off); return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); }; }, []);
  return html`<footer class="balcao-status">
    <span>${(cfg.cidade || "").toUpperCase()} · ${agora.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}</span>
    <span class="espaco"></span>
    <span class=${online ? "st-on" : "st-off"}>${online ? "● Conectado" : "● Sem internet"}</span>
    <span>${agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
    <${BotaoTema} classe="st-tema" /><span>${perfil.nome}</span><span>DTCar Gestão</span>
  </footer>`;
}

/** Botão de tema: Claro → Escuro → Automático */
export function BotaoTema({ classe }) {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN(n => n + 1); window.addEventListener("dtcar-tema", f); const m = matchMedia("(prefers-color-scheme: dark)"); m.addEventListener && m.addEventListener("change", f);
    return () => { window.removeEventListener("dtcar-tema", f); m.removeEventListener && m.removeEventListener("change", f); }; }, []);
  const esc = temaEscolhido(), ef = temaEfetivo();
  const prox = esc === "claro" ? "escuro" : esc === "escuro" ? "auto" : "claro";
  const rot = esc === "auto" ? "Tema automático (" + ef + ")" : esc === "claro" ? "Tema claro" : "Tema escuro";
  return html`<button type="button" class=${classe || "btn btn-sm"} title=${"Trocar para tema " + { claro: "claro", escuro: "escuro", auto: "automático" }[prox]} onClick=${() => aplicarTema(prox)}>${ef === "escuro" ? "☾" : "☀"} ${rot}</button>`;
}
