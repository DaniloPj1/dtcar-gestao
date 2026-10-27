import { html, render, useState, useEffect, useCallback, useRef } from "./lib.js";
import { api } from "./api.js";
import { Ctx, Modal, I } from "./ui.js";
import { cfgCompleta, pode } from "./regras.js";
import { Conexao, Login, Pendente } from "./telas/login.js";
import { Painel, Ordens } from "./telas/painel.js";
import { NovaOS, ChecklistOS } from "./telas/entrada.js";
import { Ordem } from "./telas/ordem.js";
import { Cadastros, ClienteTela, VeiculoTela } from "./telas/cadastros.js";
import { Mais, Equipe, Ajustes } from "./telas/admin.js";
import { Recibos } from "./telas/recibos.js";
import { Imprimir } from "./telas/imprimir.js";
import { Importar } from "./telas/importar.js";

const lerRota = () => { const h = (location.hash || "").replace(/^#/, "") || "/painel"; return h.startsWith("/") ? h : "/" + h; };
const TITULOS = { painel: "Painel", entrada: "Nova O.S.", ordens: "Ordens de serviço", os: "Ordem de serviço", cadastros: "Cadastros", cliente: "Cliente", veiculo: "Veículo", mais: "Mais", equipe: "Equipe", ajustes: "Ajustes", recibos: "Recibos", importar: "Importar do OS Oficina" };
const SINC = ["ordens", "clientes", "veiculos", "produtos"];
const NAV = [["/painel", "Painel", "painel"], ["/ordens", "O.S.", "lista"], ["/entrada", "Nova O.S.", "mais"], ["/cadastros", "Cadastros", "pessoas"], ["/mais", "Mais", "menu"]];

function App() {
  const [sessao, setSessao] = useState(undefined);
  const [perfil, setPerfil] = useState(undefined);
  const [rota, setRota] = useState(lerRota());
  const [modoSenha, setModoSenha] = useState(/type=recovery/.test(location.hash));
  const [dados, setDados] = useState({ clientes: [], veiculos: [], produtos: [], ordens: [], perfis: [], carregado: false });
  const [cfg, setCfg] = useState(cfgCompleta({}));
  const [toast, setToast] = useState(null);
  const [conf, setConf] = useState(null);
  const ultimaCarga = useRef(0);

  useEffect(() => { const f = () => { setRota(lerRota()); window.scrollTo(0, 0); }; window.addEventListener("hashchange", f); return () => window.removeEventListener("hashchange", f); }, []);
  useEffect(() => {
    if (!api) return;
    api.auth.sessao().then(s => setSessao(s || null)).catch(() => setSessao(null));
    return api.auth.aoMudar((s, ev) => { if (ev === "PASSWORD_RECOVERY") setModoSenha(true); setSessao(s || null); });
  }, []);
  useEffect(() => {
    if (!api || sessao === undefined) return;
    if (!sessao) { setPerfil(null); return; }
    api.meuPerfil(sessao.user.id).then(p => setPerfil(p || { id: sessao.user.id, nome: sessao.user.email, email: sessao.user.email, papel: "pendente" })).catch(() => setPerfil(null));
  }, [sessao && sessao.user && sessao.user.id]);

  const membro = perfil && perfil.ativo !== false && ["admin", "consultor", "mecanico"].includes(perfil.papel);
  const marcas = useRef({}); // maior atualizado_em já recebido por tabela (relógio do servidor)
  const marcar = (k, linhas) => { for (const l of linhas) if (l.atualizado_em && (!marcas.current[k] || l.atualizado_em > marcas.current[k])) marcas.current[k] = l.atualizado_em; };
  /** Carrega tabelas. Para O.S., clientes, veículos e produtos já carregados, busca só o que mudou (rápido);
   *  use { completo: true } depois de excluir registros. */
  const recarregar = useCallback(async (quais, opt = {}) => {
    const todos = ["clientes", "veiculos", "produtos", "ordens", "perfis", "config"];
    const lista = quais && quais.length ? quais : todos;
    try {
      const res = await Promise.all(lista.map(k => {
        if (k === "config") return api.config();
        if (k === "perfis") return api.perfis();
        const desde = !opt.completo && SINC.includes(k) && marcas.current[k];
        if (desde) return k === "ordens" ? api.ordens(desde) : api.alterados(k, desde);
        return k === "ordens" ? api.ordens() : api[k].listar(k === "clientes" ? "nome" : k === "produtos" ? "descricao" : "criado_em");
      }));
      const novo = {}, parcial = {};
      lista.forEach((k, n) => {
        if (k === "config") return setCfg(cfgCompleta(res[n]));
        const parc = !opt.completo && SINC.includes(k) && marcas.current[k];
        if (SINC.includes(k)) marcar(k, res[n]);
        (parc ? parcial : novo)[k] = res[n];
      });
      setDados(d => {
        const r = { ...d, ...novo, carregado: true };
        for (const [k, linhas] of Object.entries(parcial)) {
          if (!linhas.length) continue;
          const m = new Map(d[k].map(x => [x.id, x])); for (const l of linhas) m.set(l.id, { ...m.get(l.id), ...l });
          r[k] = k === "ordens" ? [...m.values()].sort((a, b) => b.numero - a.numero) : [...m.values()];
        }
        return r;
      });
      ultimaCarga.current = Date.now();
    } catch (e) { setToast({ msg: "Erro ao carregar dados: " + e.message, erro: true }); }
  }, []);
  useEffect(() => { if (membro) recarregar(); }, [membro]);
  useEffect(() => {
    if (!membro) return;
    let ultimaCompleta = Date.now();
    const atualiza = () => {
      if (document.visibilityState !== "visible" || Date.now() - ultimaCarga.current < 30000) return;
      const completo = Date.now() - ultimaCompleta > 15 * 60000; if (completo) ultimaCompleta = Date.now();
      recarregar(SINC, { completo });
    };
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

  const [caminho, qs] = rota.split("?");
  const [, base, param, sub] = caminho.split("/");
  const params = Object.fromEntries(new URLSearchParams(qs || ""));
  const restrito = { ajustes: "ajustes", equipe: "ajustes", importar: "ajustes", entrada: "entrada", recibos: "verValores" };
  const ctx = { sessao, perfil, cfg, dados, recarregar, avisar, confirmar, ir, sair };
  if (base === "imprimir" && dados.carregado) return html`<${Ctx.Provider} value=${ctx}><${Imprimir} tipo=${param} id=${sub} params=${params} key=${rota} /></${Ctx.Provider}>`;
  let corpo;
  if (restrito[base] && !pode(perfil, restrito[base])) corpo = html`<div class="pagina"><div class="aviso">Seu papel não tem acesso a esta tela.</div></div>`;
  else if (!dados.carregado) corpo = html`<div class="carregando">Carregando dados…</div>`;
  else corpo = {
    painel: () => html`<${Painel} />`, ordens: () => html`<${Ordens} params=${params} key=${qs || ""} />`, entrada: () => html`<${NovaOS} />`,
    os: () => sub === "checklist" ? (pode(perfil, "entrada") ? html`<${ChecklistOS} id=${param} key=${param} />` : html`<div class="pagina"><div class="aviso">Seu papel não pode fazer checklist.</div></div>`) : html`<${Ordem} id=${param} key=${param} />`,
    cliente: () => html`<${ClienteTela} id=${param} key=${param} />`, veiculo: () => html`<${VeiculoTela} id=${param} key=${param} />`,
    cadastros: () => html`<${Cadastros} params=${params} key=${qs || ""} />`, catalogo: () => html`<${Cadastros} params=${{ aba: "produtos" }} />`,
    mais: () => html`<${Mais} />`, equipe: () => html`<${Equipe} />`, ajustes: () => html`<${Ajustes} />`,
    recibos: () => html`<${Recibos} />`, importar: () => html`<${Importar} />`,
  }[base]?.() || html`<${Painel} />`;

  return html`<${Ctx.Provider} value=${ctx}>
    <header class="topo"><div class="topo-in"><button type="button" class="marca marca-logo" onClick=${() => ir("/painel")} aria-label="DTCar Centro Automotivo · Painel"><img src="icons/logo-branco-sm.png" alt="DTCar Centro Automotivo" /></button>
      <nav class="nav-desk" aria-label="Navegação">${NAV.map(([r, t]) => html`<button type="button" key=${r} aria-current=${"/" + base === r || (r === "/cadastros" && (base === "cliente" || base === "veiculo")) ? "page" : undefined} onClick=${() => ir(r)}>${t}</button>`)}</nav>
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
