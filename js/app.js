import { html, render, useState, useEffect, useCallback, useRef } from "./lib.js";
import { api } from "./api.js";
import { Ctx, Modal, I } from "./ui.js";
import { cfgCompleta, pode } from "./regras.js";
import { Conexao, Login, Pendente } from "./telas/login.js";
import { Painel, Ordens } from "./telas/painel.js";
import { Entrada } from "./telas/entrada.js";
import { Ordem } from "./telas/ordem.js";
import { Cadastros } from "./telas/cadastros.js";
import { Mais, Catalogo, Equipe, Ajustes } from "./telas/admin.js";

const lerRota = () => { const h = (location.hash || "").replace(/^#/, "") || "/painel"; return h.startsWith("/") ? h : "/" + h; };
const TITULOS = { painel: "Painel", entrada: "Nova entrada", ordens: "Ordens de serviço", os: "Ordem de serviço", cadastros: "Clientes e veículos", mais: "Mais", catalogo: "Catálogo de serviços", equipe: "Equipe", ajustes: "Ajustes" };
const NAV = [["/painel", "Painel", "painel"], ["/ordens", "O.S.", "lista"], ["/entrada", "Entrada", "mais"], ["/cadastros", "Cadastros", "pessoas"], ["/mais", "Mais", "menu"]];

function App() {
  const [sessao, setSessao] = useState(undefined);
  const [perfil, setPerfil] = useState(undefined);
  const [rota, setRota] = useState(lerRota());
  const [modoSenha, setModoSenha] = useState(/type=recovery/.test(location.hash));
  const [dados, setDados] = useState({ clientes: [], veiculos: [], servicos: [], ordens: [], perfis: [], carregado: false });
  const [cfg, setCfg] = useState(cfgCompleta({}));
  const [toast, setToast] = useState(null);
  const [conf, setConf] = useState(null);
  const ultimaCarga = useRef(0);

  useEffect(() => { const f = () => { setRota(lerRota()); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  useEffect(() => {
    api.auth.sessao().then(s => setSessao(s || null)).catch(() => setSessao(null));
    return api.auth.aoMudar((s, ev) => { if (ev === "PASSWORD_RECOVERY") setModoSenha(true); setSessao(s || null); });
  }, []);
  useEffect(() => {
    if (sessao === undefined) return;
    if (!sessao) { setPerfil(null); return; }
    api.meuPerfil(sessao.user.id).then(p => setPerfil(p || { id: sessao.user.id, nome: sessao.user.email, email: sessao.user.email, papel: "pendente" })).catch(() => setPerfil(null));
  }, [sessao && sessao.user && sessao.user.id]);

  const membro = perfil && perfil.ativo !== false && ["admin", "consultor", "mecanico"].includes(perfil.papel);
  const recarregar = useCallback(async (quais) => {
    const todos = ["clientes", "veiculos", "servicos", "ordens", "perfis", "config"];
    const lista = quais && quais.length ? quais : todos;
    try {
      const res = await Promise.all(lista.map(k => k === "config" ? api.config() : k === "perfis" ? api.perfis() : k === "ordens" ? api.ordens() : api[k].listar(k === "clientes" ? "nome" : k === "servicos" ? "nome" : "criado_em")));
      const novo = {}; lista.forEach((k, n) => { if (k === "config") setCfg(cfgCompleta(res[n])); else novo[k] = res[n]; });
      setDados(d => ({ ...d, ...novo, carregado: true })); ultimaCarga.current = Date.now();
    } catch (e) { setToast({ msg: "Erro ao carregar dados: " + e.message, erro: true }); }
  }, []);
  useEffect(() => { if (membro) recarregar(); }, [membro]);
  useEffect(() => {
    if (!membro) return;
    const atualiza = () => { if (document.visibilityState === "visible" && Date.now() - ultimaCarga.current > 30000) recarregar(["ordens", "clientes", "veiculos"]); };
    document.addEventListener("visibilitychange", atualiza); const t = setInterval(atualiza, 60000);
    return () => { document.removeEventListener("visibilitychange", atualiza); clearInterval(t); };
  }, [membro]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.erro ? 6000 : 3000); return () => clearTimeout(t); }, [toast]);

  const avisar = useCallback((msg, erro) => setToast({ msg, erro: !!erro }), []);
  const confirmar = useCallback(o => new Promise(res => setConf({ ...o, res })), []);
  const ir = useCallback(r => { if (lerRota() === r) { setRota(r); window.scrollTo(0, 0); } else location.hash = r; }, []);
  const sair = useCallback(async () => { await api.auth.sair(); setPerfil(null); setSessao(null); location.hash = "#/painel"; }, []);

  if (!api) return html`<${Conexao} />`;
  if (sessao === undefined || (sessao && perfil === undefined)) return html`<div class="carregando">Carregando…</div>`;
  if (modoSenha && sessao) return html`<${Login} modo="nova" />`;
  if (!sessao) return html`<${Login} />`;
  if (!membro) return html`<${Pendente} perfil=${perfil} sair=${sair} />`;

  const [, base, param] = rota.split("/");
  const restrito = { ajustes: "ajustes", equipe: "ajustes", entrada: "entrada" };
  let corpo;
  if (restrito[base] && !pode(perfil, restrito[base])) corpo = html`<div class="pagina"><div class="aviso">Seu papel não tem acesso a esta tela.</div></div>`;
  else if (!dados.carregado) corpo = html`<div class="carregando">Carregando dados…</div>`;
  else corpo = {
    painel: () => html`<${Painel} />`, ordens: () => html`<${Ordens} />`, entrada: () => html`<${Entrada} />`, os: () => html`<${Ordem} id=${param} />`,
    cadastros: () => html`<${Cadastros} />`, mais: () => html`<${Mais} />`, catalogo: () => html`<${Catalogo} />`, equipe: () => html`<${Equipe} />`, ajustes: () => html`<${Ajustes} />`,
  }[base]?.() || html`<${Painel} />`;

  const ctx = { sessao, perfil, cfg, dados, recarregar, avisar, confirmar, ir, sair };
  return html`<${Ctx.Provider} value=${ctx}>
    <header class="topo"><div class="topo-in"><button type="button" class="marca" onClick=${() => ir("/painel")}>DT<b>CAR</b><small>GESTÃO</small></button>
      <nav class="nav-desk" aria-label="Navegação">${NAV.map(([r, t]) => html`<button type="button" key=${r} aria-current=${"/" + base === r ? "page" : undefined} onClick=${() => ir(r)}>${t}</button>`)}</nav>
      <div class="titulo">${TITULOS[base] || ""}</div></div></header>
    <main>${corpo}</main>
    <nav class="nav" aria-label="Navegação principal"><div class="nav-in">${NAV.map(([r, t, ic]) => html`<button key=${r} type="button" class=${r === "/entrada" ? "nav-novo" : ""} aria-current=${"/" + base === r ? "page" : undefined} onClick=${() => ir(r)}>
      ${r === "/entrada" ? html`<span class="circ">${I[ic]}</span>` : I[ic]}<span>${t}</span></button>`)}</div></nav>
    ${toast ? html`<div class=${"toast" + (toast.erro ? " erro" : "")} role="status">${toast.msg}</div>` : null}
    ${conf ? html`<${Modal} titulo=${conf.titulo} onFechar=${() => { conf.res(false); setConf(null); }}><p>${conf.texto}</p>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${() => { conf.res(false); setConf(null); }}>Voltar</button>
      <button type="button" class=${"btn " + (conf.perigo ? "btn-perigo" : "btn-pri")} onClick=${() => { conf.res(true); setConf(null); }}>${conf.botao}</button></div></${Modal}>` : null}
  </${Ctx.Provider}>`;
}

render(html`<${App} />`, document.getElementById("raiz"));
