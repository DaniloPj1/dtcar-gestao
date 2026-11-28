// Barra superior do computador: título da tela, busca rápida (F3), situação da conexão e da pasta de dados,
// botão Nova O.S. e troca de tema. Atalhos: F2 nova O.S., F3 busca, F4 O.S. em aberto, F6 produtos.
import { html, useState, useEffect, useRef, useMemo } from "../lib.js";
import { useApp, I, Modal } from "../ui.js";
import { norm, soDig, normPlaca, exPlaca, fmtTel, fmtDataHora, numOS, numORC, lsGet, lsSet } from "../util.js";
import { api } from "../api.js";
import { pode, STATUS, situacaoOS, ABERTOS } from "../regras.js";
import { temaEfetivo, temaEscolhido, aplicarTema, ligarRelogioDoTema, CLARO_DE, CLARO_ATE } from "../tema.js";

const ICON_SOL = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>`;
const ICON_LUA = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>`;
const ICON_BUSCA = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L21 21"/></svg>`;

/** Botão de tema: Claro → Escuro → Automático */
export function BotaoTema({ classe, comTexto }) {
  const [, setN] = useState(0);
  useEffect(() => { const f = () => setN(n => n + 1); window.addEventListener("dtcar-tema", f); const m = matchMedia("(prefers-color-scheme: dark)"); m.addEventListener && m.addEventListener("change", f);
    return () => { window.removeEventListener("dtcar-tema", f); m.removeEventListener && m.removeEventListener("change", f); }; }, []);
  useEffect(ligarRelogioDoTema, []);   // tema por horário: troca sozinho às 6h e às 18h com o sistema aberto
  const esc = temaEscolhido(), ef = temaEfetivo();
  // Claro → Escuro → Automático (segue o Windows) → Por horário (claro das 6h às 18h) → Claro…
  const prox = esc === "claro" ? "escuro" : esc === "escuro" ? "auto" : esc === "auto" ? "horario" : "claro";
  const NOME = { claro: "Tema claro", escuro: "Tema escuro", auto: "Tema automático", horario: "Tema pelo horário" };
  const rot = NOME[esc] || NOME.auto;
  const dica = esc === "horario" ? "Tema pelo horário: claro das " + CLARO_DE + "h às " + CLARO_ATE + "h, escuro no resto" : rot;
  return html`<button type="button" class=${classe || "btn btn-sm"} title=${dica + " · clique para " + NOME[prox].toLowerCase()} aria-label=${rot} onClick=${() => aplicarTema(prox)}>
    ${ef === "escuro" ? ICON_LUA : ICON_SOL}${comTexto ? html`<span>${rot}</span>` : null}</button>`;
}

/** Busca rápida: número da O.S., placa, nome/telefone do cliente */
function BuscaRapida() {
  const { dados, ir } = useApp();
  const [q, setQ] = useState(""), [aberta, setAberta] = useState(false), [sel, setSel] = useState(0);
  const ref = useRef(null), inp = useRef(null);
  useEffect(() => {
    const tecla = e => { if (e.key === "F3" || (e.key === "k" && (e.ctrlKey || e.metaKey))) { e.preventDefault(); inp.current && inp.current.focus(); inp.current && inp.current.select(); } };
    const fora = e => { if (ref.current && !ref.current.contains(e.target)) setAberta(false); };
    document.addEventListener("keydown", tecla); document.addEventListener("pointerdown", fora);
    return () => { document.removeEventListener("keydown", tecla); document.removeEventListener("pointerdown", fora); };
  }, []);
  const res = useMemo(() => {
    const t = q.trim(); if (t.length < 2) return [];
    const n = norm(t), d = soDig(t), p = normPlaca(t), out = [];
    // O.S. pelo número, pela placa ou pelo nome do cliente (pedido do Danilo em 22/11/2026: a busca promete "placa, O.S., cliente" e tem de achar pelos três)
    dados.ordens.filter(o => (d && d === t && d.length <= 6 && String(o.numero) === String(+d)) || (p.length >= 3 && ((o.veiculo && o.veiculo.placa) || "").includes(p)) || (n.length >= 3 && norm((o.cliente && o.cliente.nome) || "").includes(n)))
      .sort((x, y) => (ABERTOS.includes(y.status) ? 1 : 0) - (ABERTOS.includes(x.status) ? 1 : 0) || y.numero - x.numero).slice(0, 6)
      .forEach(o => out.push({ k: "os" + o.id, ic: I.lista, t: numOS(o.numero) + " · " + exPlaca(o.veiculo.placa), s: o.cliente.nome + " · " + (situacaoOS(o) || { t: o.status }).t, r: "/os/" + o.id }));
    dados.veiculos.filter(v => (p.length >= 3 && v.placa && v.placa.includes(p)) || (n.length >= 3 && norm([v.marca, v.modelo].filter(Boolean).join(" ")).includes(n))).slice(0, 6).forEach(v => out.push({ k: "v" + v.id, ic: I.carro, t: exPlaca(v.placa) + " · " + [v.marca, v.modelo].filter(Boolean).join(" "), s: ((dados.clientes.find(c => c.id === v.cliente_id) || {}).nome) || "sem proprietário", r: "/veiculo/" + v.id }));
    if (n.length >= 2) dados.clientes.filter(c => norm(c.nome).includes(n) || norm(c.fantasia).includes(n) || (d.length >= 4 && soDig(c.telefone).includes(d))).slice(0, 6)
      .forEach(c => out.push({ k: "c" + c.id, ic: I.pessoas, t: c.nome, s: [c.codigo ? "cód. " + c.codigo : "", c.telefone ? fmtTel(c.telefone) : ""].filter(Boolean).join(" · "), r: "/cliente/" + c.id }));
    return out.slice(0, 10);
  }, [q, dados]);
  useEffect(() => setSel(0), [q]);
  const abrir = r => { setQ(""); setAberta(false); inp.current && inp.current.blur(); ir(r.r); };
  const tecla = e => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel(s => Math.min(res.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel(s => Math.max(0, s - 1)); }
    else if (e.key === "Enter" && res[sel]) { e.preventDefault(); abrir(res[sel]); }
    else if (e.key === "Escape") { setQ(""); setAberta(false); e.target.blur(); }
  };
  return html`<div class="busca-rapida-topo" ref=${ref}>
    <span class="br-ic">${ICON_BUSCA}</span>
    <input ref=${inp} type="search" class="inp" aria-label="Busca rápida" placeholder="Buscar O.S., placa ou cliente" value=${q}
      onInput=${e => { setQ(e.target.value); setAberta(true); }} onFocus=${() => setAberta(true)} onKeyDown=${tecla} />
    <kbd>F3</kbd>
    ${aberta && q.trim().length >= 2 ? html`<div class="br-lista" role="listbox">${res.length ? res.map((r, i) => html`<button type="button" key=${r.k} role="option" aria-selected=${i === sel ? "true" : "false"} class=${i === sel ? "sel" : ""} onMouseEnter=${() => setSel(i)} onClick=${() => abrir(r)}>
        <span class="br-i">${r.ic}</span><span class="br-t"><b>${r.t}</b><small>${r.s}</small></span></button>`) : html`<div class="br-vazio">Nada encontrado para “${q}”.</div>`}</div>` : null}
  </div>`;
}

/** Situação da conexão, da fila e da pasta de dados */
function Situacao({ offline, pend, enviarFila }) {
  const { pasta, ir, guardadas } = useApp();
  const guardando = guardadas && guardadas.feitas + (guardadas.falhas || 0) < guardadas.total;
  const pastaRuim = pasta && pasta.configurada && pasta.permissao !== "granted";
  const [cls, txt, dica] = offline ? ["off", "Sem internet", "Modo consulta. Dá para abrir O.S. nova; ela recebe o número quando a conexão voltar."]
    : pend.length ? ["pend", pend.length + " aguardando envio", pend.some(op => op.conflito) ? "Há alteração com conflito: veja em Dados no computador." : "O.S. abertas e alterações feitas sem internet. Clique para enviar agora."]
    : pastaRuim ? ["pend", "Reconectar pasta", "O navegador pediu para confirmar o acesso à pasta de dados do PC."]
    : guardadas && guardadas.falhas && !guardando ? ["pend", guardadas.falhas + " O.S. não guardadas no PC", "Algumas O.S. não puderam ser copiadas para este computador. Veja em Dados no computador."]
    : guardando ? ["pend", "Guardando O.S. " + guardadas.feitas + "/" + guardadas.total, "Copiando as O.S. em aberto para este computador (para abrir sem internet). Não desligue a internet até terminar."]
    : ["on", "Conectado", pasta && pasta.ultimaGravacao ? "Pasta do PC gravada em " + fmtDataHora(pasta.ultimaGravacao) : "Dados sincronizados com o servidor"];
  return html`<button type="button" class=${"situacao s-" + cls} title=${dica} onClick=${() => pend.length && !offline ? enviarFila() : ir("/dados-locais")}><i></i><span>${txt}</span></button>`;
}

/* ---------------- Sino: avisos que chegam do app do celular (pedido do Danilo, 16/11/2026) ----------------
 * Novo pedido de orçamento pelo app (e acréscimo a um pedido aberto) e "itens a orçar" escritos numa O.S. pelo app. Lidos a cada minuto
 * (api.avisosApp, só leitura); o que já foi visto fica guardado neste aparelho (dtcar-avisos-vistos). Só para quem orça (administrador e consultor). */
const LS_AVISOS = "dtcar-avisos-vistos";
/* "Limpar notificações" (pedido do Danilo em 25/11/2026): marcar como visto só tirava o número do sininho; a lista
   continuava cheia. Limpar guarda neste aparelho os avisos que ele já recebeu e tira da lista — sem apagar nada no
   banco, que é de onde a lista vem. Dá para ver de novo em "Ver os já recebidos". */
const LS_LIMPOS = "dtcar-avisos-limpos";
const avisosLimpos = () => lsGet(LS_LIMPOS) || [];
const vistosAvisos = () => { const l = lsGet(LS_AVISOS, []); return Array.isArray(l) ? l : []; };
const ICON_SINO = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>`;
/** Só um Sino consultando por vez: o do cabeçalho do celular (< 900px) ou o da barra do PC (revisão de 16/11/2026) */
function usarLargo() {
  const mq = typeof matchMedia === "function" ? matchMedia("(min-width: 900px)") : null;
  const [largo, setLargo] = useState(mq ? mq.matches : true);
  useEffect(() => { if (!mq) return; const f = e => setLargo(e.matches); mq.addEventListener("change", f); return () => mq.removeEventListener("change", f); }, []);
  return largo;
}
export function Sino({ classe }) {
  const largo = usarLargo();
  if (classe === "sino-cel" ? largo : !largo) return null;
  return html`<${SinoVivo} classe=${classe} />`;
}
function SinoVivo({ classe }) {
  const { perfil, ir, avisar } = useApp();
  const [lista, setLista] = useState([]), [aberto, setAberto] = useState(false), [vistos, setVistos] = useState(vistosAvisos), [erro, setErro] = useState(false);
  const [limpos, setLimpos] = useState(avisosLimpos), [verTodos, setVerTodos] = useState(false);
  const ref = useRef(null), ultimo = useRef(null);
  const ler = async () => { try { const l = await api.avisosApp(); setLista(l); setErro(false);
      // chegou pedido novo com o sistema aberto: aviso na tela
      const novos = l.filter(x => !vistosAvisos().includes(x.chave)).map(x => x.chave);
      if (ultimo.current && novos.some(k => !ultimo.current.includes(k))) avisar(l.find(x => x.chave === novos.find(k => !ultimo.current.includes(k))).tipo === "orcamento" ? "Novo pedido de orçamento pelo app do celular." : "Itens a orçar numa O.S., pelo app do celular.");
      ultimo.current = novos; } catch (e) { setErro(true); } };
  useEffect(() => { if (!pode(perfil, "orcar")) return; ler(); const i = setInterval(() => { if (navigator.onLine !== false && !document.hidden) ler(); }, 60000); return () => clearInterval(i); }, [perfil && perfil.id]);
  useEffect(() => { if (!aberto) return; const f = e => { if (ref.current && !ref.current.contains(e.target)) setAberto(false); }; document.addEventListener("mousedown", f); return () => document.removeEventListener("mousedown", f); }, [aberto]);
  if (!pode(perfil, "orcar")) return null;
  const naLista = verTodos ? lista : lista.filter(x => !limpos.includes(x.chave));
  const novos = naLista.filter(x => !vistos.includes(x.chave));
  const escondidos = lista.length - lista.filter(x => !limpos.includes(x.chave)).length;
  const marcar = chaves => { const v = [...new Set(vistosAvisos().concat(chaves))].slice(-300); lsSet(LS_AVISOS, v); setVistos(v); };
  const limpar = () => { const c = lista.map(x => x.chave);
    const l = [...new Set(avisosLimpos().concat(c))].slice(-300); lsSet(LS_LIMPOS, l); setLimpos(l);
    marcar(c); setVerTodos(false); };
  const abrir = x => { marcar([x.chave]); setAberto(false); ir(x.tipo === "orcamento" ? "/orcamento/" + x.id : "/os/" + x.id); };
  const veic = x => [exPlaca(x.veiculo.placa), x.veiculo.marca, x.veiculo.modelo].filter(Boolean).join(" ");
  return html`<div class=${"sino" + (classe ? " " + classe : "")} ref=${ref}>
    <button type="button" class=${"btn-icone sino-btn" + (novos.length ? " tem" : "")} title=${novos.length ? novos.length + " aviso(s) do app do celular" : "Avisos do app do celular"} aria-label=${"Avisos do app: " + novos.length + " novo(s)"} aria-expanded=${aberto ? "true" : "false"} onClick=${() => setAberto(!aberto)}>${ICON_SINO}${novos.length ? html`<span class="sino-n">${novos.length}</span>` : null}</button>
    ${aberto ? html`<div class="sino-lista" role="dialog" aria-label="Avisos do app do celular">
      <div class="sino-cab"><b>Avisos do app do celular</b>
        ${naLista.length ? html`<button type="button" class="btn btn-sm" id="sino-limpar" title="Tira os avisos da lista neste aparelho; nada é apagado no sistema" onClick=${limpar}>Limpar notificações</button>` : null}</div>
      ${erro ? html`<div class="sub" style="padding:8px 12px">Não deu para ler os avisos (sem internet?).</div>` : null}
      ${!naLista.length && !erro ? html`<div class="sub" style="padding:10px 12px">${lista.length ? "Avisos limpos. Nada novo por aqui." : "Nenhum pedido pelo app por enquanto."}</div>` : null}
      ${naLista.slice(0, 30).map(x => html`<button type="button" key=${x.chave} class=${"sino-item" + (vistos.includes(x.chave) ? "" : " novo")} onClick=${() => abrir(x)}>
        <strong>${x.tipo === "orcamento" ? (x.acrescimo ? "Mais itens no pedido " : "Novo pedido de orçamento ") + numORC(x.numero) : "Itens a orçar na " + numOS(x.numero)}</strong>
        <span>${[veic(x), x.cliente.nome, x.quem ? "por " + x.quem : "", fmtDataHora(x.quando)].filter(Boolean).join(" · ")}</span>
        <span class="sino-texto">${String(x.texto).split("\n").slice(-1)[0].slice(0, 120)}</span></button>`)}
      ${escondidos ? html`<button type="button" class="sino-rodape" id="sino-ver-limpos" onClick=${() => setVerTodos(!verTodos)}>${verTodos ? "Esconder os já recebidos" : "Ver os " + escondidos + " já recebidos"}</button>` : null}
    </div>` : null}</div>`;
}

/* ---------------- Proporção da tela, uma por aba (pedido do Danilo em 25/11/2026; refeito em 28/11/2026) ----------------
 * Cada aba tem a sua escolha — Compacto, Médio ou Largo —, guardada neste aparelho (dtcar-proporcao, uma entrada por aba).
 * Em 28/11 ele mostrou dois problemas: no Painel apareciam DOIS controles (o antigo, dentro do Painel, e este) e os
 * botões "não respondiam" — o antigo, global, mandava no CSS com mais força e anulava este. Agora é um mecanismo só:
 * este controle põe o tamanho da aba no `data-tela` da página, que é o que o CSS aprovado em 23/11 já usa. A escolha
 * antiga (global, feita no Painel) vira a escolha da aba Painel, para nada mudar no que ele já tinha arrumado.
 * Sem escolha (nenhum botão marcado), a aba fica como a tela já era. Com escolha, os três tamanhos são fixos e mudam a
 * tela de verdade em qualquer monitor — inclusive no 1366 da recepção: Compacto 1040px < Médio 1180px < Largo (tudo).
 * Clicar de novo no botão marcado volta ao padrão da tela. Só no PC: no celular a tela é sempre a largura do aparelho. */
const LS_PROP = "dtcar-proporcao";
const PROPORCOES = [["compacto", "Compacto"], ["medio", "Médio"], ["largo", "Largo"]];
function mapaProporcao() {
  const m = lsGet(LS_PROP) || {};
  const antigo = lsGet("dtcar-tela");   // escolha global de antes (botão que ficava dentro do Painel)
  if (antigo && !m.painel && antigo !== "medio") { m.painel = antigo; lsSet(LS_PROP, m); }
  if (antigo) { try { localStorage.removeItem("dtcar-tela"); } catch (e) {} }
  return m;
}
const porTamanho = t => { const r = document.documentElement; if (t) r.dataset.tela = t; else delete r.dataset.tela; };
export function Proporcao() {
  const { aba } = useApp();
  const largo = usarLargo();
  const [mapa, setMapa] = useState(mapaProporcao);
  const atual = mapa[aba] || "";
  useEffect(() => { porTamanho(atual); }, [aba, atual]);
  if (!largo) return null;
  const escolher = k => { const novo = { ...mapa }; if (k === atual) delete novo[aba]; else novo[aba] = k; lsSet(LS_PROP, novo); setMapa(novo); porTamanho(novo[aba] || ""); };
  return html`<div class="tam-tela prop-seg" role="group" aria-label="Tamanho desta tela">
    ${PROPORCOES.map(([k, t]) => html`<button type="button" key=${k} aria-pressed=${atual === k ? "true" : "false"}
      title=${atual === k ? "Clique de novo para voltar ao tamanho padrão desta tela" : "Tamanho desta aba: " + t.toLowerCase()} onClick=${() => escolher(k)}>${t}</button>`)}
  </div>`;
}

export function BarraTopo({ titulo, offline, pend, enviarFila }) {
  const { perfil, ir } = useApp();
  useEffect(() => {
    const tecla = e => {
      if (document.querySelector(".fundo-modal")) return;
      const mapa = { F2: pode(perfil, "entrada") ? "/entrada" : null, F4: "/ordens?filtro=abertas", F6: "/cadastros?aba=produtos" };
      if (mapa[e.key]) { e.preventDefault(); ir(mapa[e.key]); }
    };
    document.addEventListener("keydown", tecla); return () => document.removeEventListener("keydown", tecla);
  }, []);
  return html`<header class="barra-topo">
    <h1 class="bt-titulo">${titulo}</h1>
    <${BuscaRapida} />
    <div class="bt-dir">
      <${BotaoInstalar} />
      <${Situacao} offline=${offline} pend=${pend} enviarFila=${enviarFila} />
      <${Sino} />
      <${Proporcao} />
      <${BotaoTema} classe="btn-icone" />
      <button type="button" class="btn btn-sm bt-oleo" title="Óleo e filtros pelo modelo do carro" aria-label="Óleo e filtros" onClick=${() => ir("/oleo-filtros")}>${I.gota}<span>Óleo e filtros</span></button>
      ${pode(perfil, "financeiro") ? html`<button type="button" class="btn btn-sm bt-oleo bt-fin" title="Painel Financeiro: entradas, saídas, faturamento e meta do mês" aria-label="Painel Financeiro" onClick=${() => ir("/painel-financeiro")}>${I.grafico}<span>Painel Financeiro</span></button>` : null}
      ${pode(perfil, "orcar") ? html`<button type="button" class="btn btn-sm bt-novo-orc" title="Novo orçamento, sem abrir O.S." onClick=${() => ir("/orcamento/novo")}>${I.mais}<span>Novo orçamento</span></button>` : null}
      ${pode(perfil, "entrada") ? html`<button type="button" class="btn btn-pri btn-sm" title="Nova O.S. (F2)" onClick=${() => ir("/entrada")}>${I.mais}<span>Nova O.S.</span></button>` : null}
    </div>
  </header>`;
}

const ICON_INSTALAR = html`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4M12 7v6M9.5 10.5L12 13l2.5-2.5"/></svg>`;
export const URL_PROGRAMA = "https://github.com/DaniloPj1/dtcar-gestao/releases/latest/download/DTCar-Gestao-Setup.exe";
export const noPrograma = () => !!window.dtcarDesktop;
export const instalado = () => noPrograma() || matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || navigator.standalone === true;

/** Botão "Instalar no computador": usa a instalação do Chrome/Edge; sem ela, mostra o passo a passo */
export function BotaoInstalar({ classe, texto }) {
  const [evt, setEvt] = useState(window.__dtcarInstalar || null), [ajuda, setAjuda] = useState(false);
  useEffect(() => { const f = () => setEvt(window.__dtcarInstalar || null); window.addEventListener("dtcar-instalavel", f); return () => window.removeEventListener("dtcar-instalavel", f); }, []);
  if (instalado()) return null;
  const windows = /Windows/.test(navigator.userAgent);
  const instalar = async () => {
    if (!evt || windows) return setAjuda(true); // no Windows, o recomendado é o programa (abre sempre, mesmo sem internet)
    evt.prompt(); const r = await evt.userChoice.catch(() => null);
    if (r && r.outcome === "accepted") { window.__dtcarInstalar = null; setEvt(null); }
  };
  const edge = /Edg\//.test(navigator.userAgent), cel = /Android|iPhone|iPad/i.test(navigator.userAgent), ios = /iPhone|iPad/i.test(navigator.userAgent);
  return html`<button type="button" class=${classe || "btn btn-sm botao-instalar"} title="Instalar o DTCar Gestão neste aparelho (ícone na área de trabalho, abre sem internet)" onClick=${instalar}>${ICON_INSTALAR}<span>${texto || "Instalar"}</span></button>
    ${ajuda ? html`<${Modal} titulo="Instalar o DTCar Gestão" onFechar=${() => setAjuda(false)}>
      ${windows ? html`<div class="info"><b>Recomendado no computador da oficina: o programa para Windows.</b> Ele abre sempre, com ou sem internet, e guarda a cópia dos dados em Documentos\DTCar Gestão.
        <ol class="passos-pasta"><li>Clique em <b>Baixar o programa</b> e abra o arquivo baixado.</li><li>Se o Windows mostrar “O Windows protegeu o computador”, clique em <b>Mais informações</b> › <b>Executar assim mesmo</b> (o programa ainda não tem assinatura digital paga).</li><li>Entre com o seu login. O ícone <b>DTCar Gestão</b> fica na área de trabalho. Desinstale o ícone antigo do navegador para não confundir.</li></ol>
        <div class="acoes"><a class="btn btn-pri" href=${URL_PROGRAMA}>Baixar o programa para Windows</a></div></div>
        ${evt ? html`<p class="sub">Ou instale pelo navegador (depende da memória do navegador para abrir sem internet): <button type="button" class="btn-link" onClick=${() => { setAjuda(false); evt.prompt(); }}>instalar pelo navegador</button></p>` : null}` : null}
      ${windows ? null : location.protocol !== "https:" ? html`<div class="aviso">A instalação só funciona no endereço com <b>https://</b>. Aguarde o certificado do endereço novo ou use o endereço atual.</div>` : null}
      ${ios ? html`<ol class="passos-pasta"><li>No <b>Safari</b>, toque em <b>Compartilhar</b> (quadrado com seta).</li><li>Escolha <b>Adicionar à Tela de Início</b> e confirme.</li></ol>`
      : cel ? html`<ol class="passos-pasta"><li>No <b>Chrome</b>, toque no menu <b>⋮</b>.</li><li>Escolha <b>Instalar app</b> (ou <b>Adicionar à tela inicial</b>) e confirme.</li></ol>`
      : edge && !windows ? html`<ol class="passos-pasta"><li>No <b>Edge</b>, clique no menu <b>…</b> (canto superior direito).</li><li>Vá em <b>Aplicativos</b> › <b>Instalar este site como um aplicativo</b>.</li><li>Confirme em <b>Instalar</b>. O ícone vai para a área de trabalho e o menu Iniciar.</li></ol>`
      : windows ? null : html`<ol class="passos-pasta"><li>No <b>Chrome</b>, clique no ícone de instalar na barra de endereço (um monitor com uma seta), ao lado da estrela de favoritos.</li><li>Se não aparecer: menu <b>⋮</b> › <b>Transmitir, salvar e compartilhar</b> › <b>Instalar página como app</b>.</li><li>Confirme em <b>Instalar</b>. O ícone vai para a área de trabalho.</li></ol>`}
      <p class="sub">Se o navegador não mostrar a opção, o sistema já pode estar instalado neste computador: procure “DTCar Gestão” no menu Iniciar.</p>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn btn-pri" onClick=${() => setAjuda(false)}>Entendi</button></div></${Modal}>` : null}`;
}
