// Ficha de óleo e filtros no veículo (pedido do Danilo em 14/11/2026) — etapa 2 de "Óleo e filtros por veículo".
// Aparece na página do veículo. "Preencher pelo catálogo" mostra as versões do carro (motor) e as respostas de óleo; a oficina escolhe a
// certa e a ficha fica gravada em veiculos.ficha_oleo (supabase/v57.sql) — e o motor, quando o cadastro não tinha. Selo "Do catálogo, confira"
// até alguém confirmar. Só aparece depois de rodar o v57 (a coluna existe na linha do veículo).
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Modal } from "../ui.js";
import { fmtData } from "../util.js";
import { pode } from "../regras.js";
import { carregarCatalogo, pesquisarVeiculo, indiceEstoque, filtroParaMostrar, resumoOleo, periodoTexto, TIPOS_FILTRO } from "../catalogo.js";
import { LinhaFiltro, ConversaoModal } from "./oleofiltros.js";

const lista = t => String(t || "").split(/\s*[\/,;]\s*/).map(x => x.trim()).filter(Boolean);
const texto = l => (l || []).join(" / ");
const VAZIO = { litros: "", viscosidade: "", norma: "", oleo: "", ar: "", combustivel: "", cabine: "" };
const deFicha = f => !f ? { ...VAZIO } : { litros: f.litros || "", viscosidade: f.viscosidade || "", norma: f.norma || "", ...Object.fromEntries(TIPOS_FILTRO.map(([k]) => [k, texto((f.filtros || {})[k])])) };

function FormFicha({ v, cat, onFechar }) {
  const { avisar, recarregar } = useApp();
  const f = v.ficha_oleo;
  const pv = useMemo(() => cat ? pesquisarVeiculo(cat, v) : null, [cat, v]);
  const r = pv && pv.r;
  const apps = useMemo(() => r ? r.filtros.slice(0, 8) : [], [r]);
  const oleos = useMemo(() => r ? resumoOleo(r.oleo, r.ano).slice(0, 5) : [], [r]);
  const [ia, setIa] = useState(-1), [io, setIo] = useState(-1), [c, setC] = useState(deFicha(f)), [confirma, setConfirma] = useState(false), [erro, setErro] = useState(""), [gravando, setGravando] = useState(false);
  const escolheOleo = i => { setIo(i); const o = oleos[i]; setC(x => ({ ...x, litros: o.litros, viscosidade: o.viscosidade || "", norma: o.linha.norma || "" })); };
  // escolher a versão (motor) já marca a resposta de óleo da mesma cilindrada, quando o catálogo de óleo tem
  const oleoDoMotor = a => { const cil = (String(a.motor || "").match(/\d\.\d/) || [])[0]; return cil ? oleos.findIndex(o => (String(o.linha.motor).match(/\d\.\d/g) || []).includes(cil)) : -1; };
  const escolheApp = i => { setIa(i); const a = apps[i]; setC(x => ({ ...x, ...Object.fromEntries(TIPOS_FILTRO.map(([k]) => [k, texto(a[k])])) })); const j = oleoDoMotor(a); if (j >= 0) escolheOleo(j); };
  useEffect(() => { if (f) return; if (oleos.length) escolheOleo(0); if (apps.length) escolheApp(0); }, [apps, oleos]);   // sem ficha: já deixa a melhor resposta marcada
  const set = (k, x) => { setErro(""); setC(o => ({ ...o, [k]: x })); };
  const app = ia >= 0 ? apps[ia] : null;
  const motorNovo = !String(v.motor || "").trim() && app && app.motor ? app.motor : "";
  const salvar = async () => {
    if (!String(c.litros).trim()) return setErro("Informe os litros de óleo.");
    const agora = new Date().toISOString();
    const ficha = { litros: String(c.litros).trim(), viscosidade: String(c.viscosidade).trim(), norma: String(c.norma).trim(), filtros: Object.fromEntries(TIPOS_FILTRO.map(([k]) => [k, lista(c[k])])),
      marca: app ? app.marca : (f && f.marca) || "Tecfil", base: app ? "Catálogo " + app.catalogo + ": " + [app.modelo, app.versao, app.motor, periodoTexto(app)].filter(Boolean).join(" · ") : (f && f.base) || "",
      origem: confirma ? "oficina" : "catalogo", em: agora, ...(confirma ? { confirmado_em: agora } : {}) };
    setGravando(true);
    try { await api.veiculos.salvar({ id: v.id, ficha_oleo: ficha, ...(motorNovo ? { motor: motorNovo } : {}) }); await recarregar(["veiculos"]); avisar("Ficha de óleo e filtros salva."); onFechar(); }
    catch (e) { setErro(e.message); setGravando(false); }
  };
  const Op = ({ nome, i, sel, onEscolha, children }) => html`<label class=${"fo-op" + (sel ? " fo-sel" : "")}><input type="radio" name=${nome} checked=${sel} onChange=${() => onEscolha(i)} /><span>${children}</span></label>`;
  return html`<${Modal} titulo=${"Óleo e filtros · " + v.marca + " " + v.modelo} largo onFechar=${onFechar}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    ${!pv ? html`<span class="dica">Carregando o catálogo…</span>`
      : html`<p class="sub" id="fo-entendido">${pv.entendido ? "Buscando por: " + pv.entendido + "." : "Não deu para ler o modelo."} ${!String(v.motor || "").trim() ? "O cadastro não tem o motor: escolha a versão certa abaixo." : "Motor do cadastro: " + v.motor + "."}</p>`}
    ${apps.length ? html`<h4 class="sub-titulo">Versão do carro (filtros)</h4><div class="fo-ops" id="fo-apps">${apps.map((a, i) => html`<${Op} key=${i} nome="fo-app" i=${i} sel=${ia === i} onEscolha=${escolheApp}>
      <b>${[a.versao, a.motor].filter(Boolean).join(" · ") || a.modelo}</b> <small>${[a.modelo, periodoTexto(a)].filter(Boolean).join(" · ")}</small>
      <small class="fo-cods">${TIPOS_FILTRO.map(([k, t]) => t + " " + (a[k].join("/") || "—")).join(" · ")}</small></${Op}>`)}</div>` : null}
    ${oleos.length ? html`<h4 class="sub-titulo">Óleo do motor</h4><div class="fo-ops" id="fo-oleos">${oleos.map((o, i) => html`<${Op} key=${i} nome="fo-oleo" i=${i} sel=${io === i} onEscolha=${escolheOleo}>
      <b>${o.litros} L ${o.viscosidade || ""}</b> <small>${[o.linha.motor, periodoTexto(o.linha)].filter(Boolean).join(" · ")}</small></${Op}>`)}</div>` : null}
    ${pv && !apps.length && !oleos.length ? html`<p class="sub">Este carro não está no catálogo. Preencha à mão abaixo.</p>` : null}
    <h4 class="sub-titulo">Ficha (dá para ajustar)</h4>
    <div class="grade fo-campos">
      <label class="campo"><span>Litros</span><input id="fo-litros" class="inp" value=${c.litros} onInput=${e => set("litros", e.target.value)} /></label>
      <label class="campo"><span>Viscosidade</span><input id="fo-visc" class="inp" value=${c.viscosidade} onInput=${e => set("viscosidade", e.target.value)} /></label>
      ${TIPOS_FILTRO.map(([k, t]) => html`<label class="campo" key=${k}><span>Filtro de ${t.toLowerCase()}</span><input id=${"fo-" + k} class="inp" placeholder="códigos separados por /" value=${c[k]} onInput=${e => set(k, e.target.value)} /></label>`)}
    </div>
    ${motorNovo ? html`<p class="sub" id="fo-motor-novo">Vai gravar também o motor no cadastro: <b>${motorNovo}</b>.</p>` : null}
    <label class="fo-confirma"><input id="fo-confirma" type="checkbox" checked=${confirma} onChange=${e => setConfirma(e.target.checked)} /> Conferi na oficina e confirmo (sem isso fica "Do catálogo, confira")</label>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" id="fo-salvar" disabled=${gravando} onClick=${salvar}>${gravando ? "Salvando…" : "Salvar ficha"}</button></div>
  </${Modal}>`;
}

export function FichaOleo({ v }) {
  const { dados, perfil, avisar, recarregar } = useApp();
  const pode_ = pode(perfil, "cadastrar"), f = v.ficha_oleo;
  const [cat, setCat] = useState(null), [aberto, setAberto] = useState(false), [conv, setConv] = useState(null), [aberta, setAberta] = useState(false);
  useEffect(() => { let vivo = true; carregarCatalogo().then(c => vivo && setCat(c)).catch(() => {}); return () => { vivo = false; }; }, []);
  const estoque = useMemo(() => indiceEstoque(dados.produtos), [dados.produtos]);
  const confirmar = async () => {
    try { await api.veiculos.salvar({ id: v.id, ficha_oleo: { ...f, origem: "oficina", confirmado_em: new Date().toISOString() } }); await recarregar(["veiculos"]); avisar("Ficha confirmada."); }
    catch (e) { avisar(e.message); }
  };
  const confirmada = f && f.origem === "oficina";
  const selo = f ? html`<span class=${"fo-selo " + (confirmada ? "fo-ok" : "fo-cat")} id="fo-selo">${confirmada ? "Confirmado pela oficina" + (f.confirmado_em ? " em " + fmtData(f.confirmado_em) : "") : "Do catálogo, confira"}</span>` : null;
  const corpo = html`${f ? html`${cat ? TIPOS_FILTRO.map(([k, t]) => html`<${LinhaFiltro} key=${k} rotulo=${t} f=${filtroParaMostrar(cat, estoque, f.marca || "Tecfil", (f.filtros || {})[k])} onConversao=${x => setConv({ ...x, a: { montadora: v.marca, modelo: v.modelo, motor: v.motor } })} />`) : html`<span class="dica">Carregando o catálogo…</span>`}
      ${f.base ? html`<p class="sub">${f.base}</p>` : null}`
      : html`<span class="dica">Ainda não tem ficha. A escolha é feita uma vez por carro.</span>`}
    ${pode_ ? html`<div class="acoes fo-acoes"><button type="button" class="btn btn-sm" id="fo-abrir" onClick=${() => setAberto(true)}>${f ? "Refazer ou editar" : "Preencher pelo catálogo"}</button>
      ${f && !confirmada ? html`<button type="button" class="btn btn-sm" id="fo-confirmar" onClick=${confirmar}>Confirmar (conferi)</button>` : null}</div>` : null}`;
  // com ficha gravada o quadro fica recolhido: só a linha de cima aparece e, ao clicar, abre (pedido do Danilo em 15/11/2026)
  return html`<section class=${"card" + (f && !aberta ? " fo-recolhido" : "")} id="ficha-oleo">
    ${f ? html`<button type="button" class="fo-cab" id="fo-alternar" aria-expanded=${aberta} aria-controls="fo-corpo" onClick=${() => setAberta(a => !a)}>
        <h3>Óleo e filtros</h3><span class="fo-resumo"><b class="of-litros">${f.litros} L</b><b class="of-visc">${f.viscosidade || "—"}</b>${selo}</span><span class="fo-seta">${aberta ? "Ocultar" : "Mostrar"}<i aria-hidden="true">${aberta ? "▴" : "▾"}</i></span></button>
      ${aberta ? html`<div id="fo-corpo"><div class="fo-topo">${f.norma ? html`<span class="sub">${f.norma}</span>` : null}</div>${corpo}</div>` : null}`
      : html`<h3>Óleo e filtros</h3>${corpo}`}
    ${aberto ? html`<${FormFicha} v=${v} cat=${cat} onFechar=${() => setAberto(false)} />` : null}
    ${conv ? html`<${ConversaoModal} c=${conv} onFechar=${() => setConv(null)} />` : null}
  </section>`;
}
