// Óleo e filtros por veículo (pedido do Danilo em 14/11/2026) — etapa 1: pesquisa por modelo, só leitura.
// Não grava nada: lê o catálogo guardado no sistema (js/catalogodados.js, funciona sem internet) e o estoque já carregado.
// Regras da pesquisa e do que mostrar: js/catalogo.js.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { useApp, Modal, Vazio } from "../ui.js";
import { lsGet, lsSet, qtdFmt } from "../util.js";
import { carregarCatalogo, pesquisar, indiceEstoque, filtroParaMostrar, periodoTexto, TIPOS_FILTRO, MARCAS_PRINCIPAIS, LIMITE_BUSCA } from "../catalogo.js";

const cods = l => l && l.length ? l.join(" / ") : "—";

function LinhaFiltro({ rotulo, f, onConversao }) {
  if (!f) return html`<div class="of-filtro of-sem"><span class="of-tipo">${rotulo}</span><span class="of-nada">sem código neste catálogo</span></div>`;
  return html`<div class=${"of-filtro" + (f.estoque ? " of-tem" : "")}>
    <span class="of-tipo">${rotulo}</span>
    ${f.estoque
      ? html`<div class="of-estoque">${f.estoque.map(e => html`<span class="of-est-item" key=${e.codigo}><em>Em estoque</em><b>${e.marca ? e.marca + " " : ""}${e.codigo}</b><span>${qtdFmt(e.qtd)} un.</span></span>`)}</div>`
      : html`<div class="of-marcas">${MARCAS_PRINCIPAIS.map(m => html`<span class="of-marca" key=${m}><small>${m}</small><b class=${f.principais[m].length ? "" : "of-traco"}>${cods(f.principais[m])}</b></span>`)}
          ${f.semSaldo.length ? html`<span class="of-semsaldo">Cadastrado, sem saldo: ${f.semSaldo.map(e => (e.marca ? e.marca + " " : "") + e.codigo).join(", ")}</span>` : null}</div>`}
    <button type="button" class="btn btn-sm of-conv" disabled=${!f.conversao.length} title=${f.conversao.length ? "Ver o mesmo filtro em outras marcas" : "Sem conversão para este código"}
      onClick=${() => onConversao({ rotulo, f })}>Conversão</button>
  </div>`;
}

// tipos: quando vem, mostra só esses filtros da aplicação (bloco "No seu estoque")
function Aplicacao({ a, cat, estoque, onConversao, tipos }) {
  const linhas = useMemo(() => TIPOS_FILTRO.filter(([k]) => !tipos || tipos.includes(k)).map(([k, t]) => [k, t, filtroParaMostrar(cat, estoque, a.marca, a[k])]), [a, cat, estoque, tipos]);
  return html`<article class="of-app">
    <header><h3>${a.montadora} ${a.modelo}</h3>
      <p class="sub">${[a.versao, a.motor, periodoTexto(a)].filter(Boolean).join(" · ")}</p></header>
    ${linhas.map(([k, t, f]) => html`<${LinhaFiltro} key=${k} rotulo=${t} f=${f} onConversao=${x => onConversao({ ...x, a })} />`)}
    <footer class="sub">Catálogo ${a.catalogo}${a.obs ? " · " + a.obs : ""}</footer>
  </article>`;
}

function ConversaoModal({ c, onFechar }) {
  const { f, rotulo, a } = c;
  const marcas = f.conversao.filter(x => !x.original), originais = f.conversao.filter(x => x.original);
  const bloco = (titulo, l) => !l.length ? null : html`<h4 class="sub-titulo">${titulo}</h4>
    <div class="of-conv-lista">${l.map(x => html`<div key=${x.marca}><span>${x.marca}</span><b>${x.codigos.join(" / ")}</b></div>`)}</div>`;
  return html`<${Modal} titulo=${"Conversão · filtro de " + rotulo.toLowerCase()} onFechar=${onFechar}>
    <p class="sub">${a.montadora} ${a.modelo}${a.motor ? " · " + a.motor : ""}${periodoTexto(a) ? " · " + periodoTexto(a) : ""}</p>
    ${f.estoque ? html`<div class="aviso ok">Em estoque: ${f.estoque.map(e => (e.marca ? e.marca + " " : "") + e.codigo + " (" + qtdFmt(e.qtd) + " un.)").join(", ")}</div>` : null}
    ${bloco("Outras marcas", marcas)}${bloco("Código original da montadora", originais)}
    <p class="sub">Conversão do catálogo Tecfil 2026. Confira a peça antes de aplicar.</p>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button></div>
  </${Modal}>`;
}

export function OleoFiltros() {
  const { dados } = useApp();
  const guardado = lsGet("dtcar-oleo-filtros") || {};
  const [q, setQ] = useState(guardado.q || ""), [ano, setAno] = useState(guardado.ano || "");
  const [cat, setCat] = useState(null), [erro, setErro] = useState(""), [conv, setConv] = useState(null), [verOutros, setVerOutros] = useState(false);
  const carregar = () => { setErro(""); carregarCatalogo().then(setCat).catch(() => setErro("Não deu para carregar o catálogo neste aparelho. Abra o sistema uma vez com internet e tente de novo.")); };
  useEffect(carregar, []);
  useEffect(() => { lsSet("dtcar-oleo-filtros", { q, ano }); setVerOutros(false); }, [q, ano]);
  const estoque = useMemo(() => indiceEstoque(dados.produtos), [dados.produtos]);
  const r = useMemo(() => cat ? pesquisar(cat, q, ano) : null, [cat, q, ano]);
  // A prioridade é o estoque: aplicação de outro catálogo (MANN, Wega, Bosch, Vox) que tem filtro no estoque aparece sem precisar abrir
  // "outros catálogos" — só quando esse filtro do estoque ainda não apareceu nas aplicações de cima.
  const outrosComEstoque = useMemo(() => {
    if (!r || !cat) return [];
    const noEstoque = a => TIPOS_FILTRO.flatMap(([k]) => { const f = filtroParaMostrar(cat, estoque, a.marca, a[k]); return f && f.estoque ? f.estoque.map(e => k + ":" + e.codigo) : []; });
    const vistos = new Set(r.filtros.flatMap(noEstoque)), l = [];
    for (const a of r.outros) { const novos = noEstoque(a).filter(c => !vistos.has(c)); if (!novos.length) continue; novos.forEach(c => vistos.add(c)); l.push({ a, tipos: [...new Set(novos.map(c => c.split(":")[0]))] }); if (l.length >= 6) break; }
    return l;
  }, [r, cat, estoque]);
  const buscou = r && r.palavras.length > 0 && r.palavras.join("").length >= 2;
  const app = (a, tipos) => html`<${Aplicacao} key=${(tipos ? "e" : "") + a.marca + a.modelo + a.versao + a.motor + a.de + a.ate + a.oleo + a.ar} a=${a} cat=${cat} estoque=${estoque} onConversao=${setConv} tipos=${tipos} />`;

  return html`<div class="pagina of-pagina">
    <section class="card">
      <h2>Óleo e filtros por veículo</h2>
      <div class="of-busca">
        <label class="of-campo of-campo-modelo"><span>Modelo do carro</span>
          <input id="of-q" class="inp" type="search" autocomplete="off" placeholder="Ex.: onix 1.0, hilux 2.8, gol 1.6" value=${q} onInput=${e => setQ(e.target.value)} /></label>
        <label class="of-campo of-campo-ano"><span>Ano</span>
          <input id="of-ano" class="inp" inputmode="numeric" maxlength="4" placeholder="Opcional" value=${ano} onInput=${e => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
      </div>
      <p class="sub">Dado de catálogo: confira no carro ou no manual antes de aplicar. O filtro que está no seu estoque aparece primeiro.</p>
    </section>
    ${erro ? html`<div class="aviso aviso-erro">${erro} <button type="button" class="btn-link" onClick=${carregar}>Tentar de novo</button></div>` : null}
    ${!cat && !erro ? html`<${Vazio}>Carregando o catálogo…</${Vazio}>` : null}
    ${cat && !buscou ? html`<${Vazio}>Digite o modelo do carro. Dá para juntar marca, motor e ano: "gm onix 1.0 2018".</${Vazio}>` : null}
    ${cat && buscou && !r.oleo.length && !r.filtros.length ? html`<${Vazio}>Nada no catálogo para "${q.trim()}"${r.ano ? " em " + r.ano : ""}. Tente só o nome do modelo, sem a versão.</${Vazio}>` : null}

    ${cat && buscou && r.oleo.length ? html`<section class="card" id="of-oleo">
      <h2>Óleo do motor</h2>
      <div class="of-oleos">${r.oleo.map((o, i) => html`<div class=${"of-oleo" + (o.divergente ? " of-div" : "")} key=${i}>
        <div class="of-oleo-carro"><b>${o.montadora} ${o.modelo}</b><span class="sub">${[o.motor, periodoTexto(o)].filter(Boolean).join(" · ")}</span></div>
        <div class="of-oleo-num"><span class="of-litros"><small>Litros</small><b>${o.litros || "—"}</b></span><span class="of-visc"><small>Viscosidade</small><b>${o.viscosidade || "—"}</b></span></div>
        <div class="of-oleo-pe"><span class="sub">${o.norma ? "Norma: " + o.norma + " · " : ""}Fonte: ${o.fonte}</span>
          ${o.divergente ? html`<span class="of-selo of-selo-div">Fontes divergentes: ${o.divergente}. Confira.</span>` : null}
          ${o.aviso ? html`<span class="of-selo of-selo-aviso">${o.aviso}</span>` : null}</div>
      </div>`)}</div>
      ${r.totalOleo > r.oleo.length ? html`<p class="sub">Mostrando ${r.oleo.length} de ${r.totalOleo}. Escreva o motor ou o ano para afinar.</p>` : null}
    </section>` : null}

    ${cat && buscou && (r.filtros.length || outrosComEstoque.length) ? html`<section class="card" id="of-filtros">
      <h2>Filtros</h2>
      ${outrosComEstoque.length ? html`<h4 class="sub-titulo">No seu estoque</h4>${outrosComEstoque.map(x => app(x.a, x.tipos))}<h4 class="sub-titulo">Catálogo ${r.principal}</h4>` : null}
      ${r.filtros.map(a => app(a))}
      ${r.totalFiltros > r.filtros.length ? html`<p class="sub">Mostrando ${r.filtros.length} de ${r.totalFiltros}. Escreva o motor ou o ano para afinar.</p>` : null}
      ${r.outros.length ? html`<button type="button" class="btn of-outros" aria-expanded=${verOutros ? "true" : "false"} onClick=${() => setVerOutros(!verOutros)}>${verOutros ? "Esconder" : "Ver"} outros catálogos (MANN, Wega, Bosch, Vox): ${r.outros.length}${r.outros.length >= LIMITE_BUSCA ? "+" : ""}</button>` : null}
      ${verOutros ? r.outros.map(a => app(a)) : null}
    </section>` : null}
    ${conv ? html`<${ConversaoModal} c=${conv} onFechar=${() => setConv(null)} />` : null}
  </div>`;
}
