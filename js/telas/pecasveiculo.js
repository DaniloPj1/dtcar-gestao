// Peças que servem no veículo da O.S. / do orçamento (pedido do Danilo em 15/11/2026). Só leitura: escolhe a peça do catálogo e devolve
// para o item da O.S., onde o valor é digitado. Não depende do estoque e não cria produto. Regras: js/pecas.js.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { carregarPecas, pecasDoVeiculo, filtrarPecas, conversaoDoItem, chaveDaPeca, agruparEquivalentes } from "../pecas.js";

const SITE = "https://gestao.dtcarcentroautomotivo.com.br/";
// fotos: miniaturas em catalogo/fotos/<pasta>/ (não entram no pacote sem internet; sem rede a peça aparece sem foto)
const urlFoto = (p, doSite) => (doSite ? SITE : new URL("../../", import.meta.url).href) + "catalogo/fotos/" + p.pasta + "/" + p.foto + ".jpg";
// onAbrir: a foto vira botão e abre a peça ampliada (pedido do Danilo: clicar na foto e ver grande, com as medidas)
function FotoPeca({ p, grande = false, onAbrir = null }) {
  const [passo, setPasso] = useState(0); // 0 = endereço do próprio sistema; 1 = site; 2 = sem foto
  const cls = grande ? "pv-fotona" : "pv-foto";
  if (!p.foto || passo > 1) return onAbrir ? html`<button type="button" class=${cls + " pv-semfoto pv-abre"} aria-label=${"Ver detalhes da peça " + p.codigo} onClick=${onAbrir}>sem foto</button>`
    : html`<span class=${cls + " pv-semfoto"} aria-hidden="true">sem foto</span>`;
  const img = html`<img class=${onAbrir ? "" : cls} loading=${grande ? "eager" : "lazy"} alt=${"Foto da peça " + p.codigo} src=${urlFoto(p, passo === 1)} onError=${() => setPasso(n => n + 1)} />`;
  return onAbrir ? html`<button type="button" class=${cls + " pv-abre"} aria-label=${"Ampliar a foto da peça " + p.codigo} title="Ampliar a foto e ver as medidas" onClick=${onAbrir}>${img}</button>` : img;
}
// A peça ampliada: foto grande, medidas, todas as aplicações do carro e a conversão
function PecaGrande({ e, onUsar, onFechar }) {
  const p = e.peca, conv = conversaoDoItem(e);
  return html`<div class="pv-grande" id="pv-grande">
    <${FotoPeca} p=${p} grande />
    <div class="pv-meio"><span class="pv-cod">${p.grupo} · ${p.marca} ${p.codigo}${p.emb ? " · embalagem com " + p.emb : ""}${p.breve ? " · em breve no catálogo" : ""}</span>
      <strong class="pv-titulo">${p.descricao}</strong>
      <div class="pv-bloco"><h5>Medidas</h5>${p.medidas ? html`<span class="pv-med" id="pv-grande-med">${p.medidas}</span>` : html`<span class="dica" id="pv-grande-med">O catálogo não traz medidas separadas para esta peça${e.aplicacoes.some(a => /mm|dentes|furos|Ø/i.test(a)) ? ": veja nas aplicações abaixo" : ""}.</span>`}</div>
      <div class="pv-bloco"><h5>Serve em</h5>${e.conferir ? html`<span class="c-warn"><b>Confira a versão do carro.</b></span>` : null}
        <ul class="pv-aplis">${e.aplicacoes.map((a, n) => html`<li key=${n}>${a}</li>`)}</ul></div>
      <div class="pv-bloco"><h5>Conversão</h5>${conv.length ? html`<div class="pv-conv">${conv.map(c => html`<div key=${c.marca}><span>${c.marca}</span><b>${c.codigos.join(" / ")}</b></div>`)}</div>`
        : html`<span class="dica">O catálogo ${p.marca} não traz conversão para esta peça.</span>`}</div>
      <div class="acoes"><button type="button" class="btn" id="pv-grande-voltar" onClick=${onFechar}>Voltar à lista</button><span class="espaco"></span>
        <button type="button" class="btn btn-pri" id="pv-grande-usar" onClick=${() => onUsar(p)}>Usar esta peça</button></div></div></div>`;
}

export function PecasVeiculo({ veiculo, onUsar, onVoltar, estoque = [], onUsarProduto = null }) {
  const [cat, setCat] = useState(null), [erro, setErro] = useState(""), [txt, setTxt] = useState(""), [grupo, setGrupo] = useState(""), [aberta, setAberta] = useState(""), [grande, setGrande] = useState(null);
  useEffect(() => { let vivo = true; carregarPecas().then(c => vivo && setCat(c)).catch(() => vivo && setErro("Não deu para abrir o catálogo de peças agora.")); return () => { vivo = false; }; }, []);
  const r = useMemo(() => { if (!cat) return null; const x = pecasDoVeiculo(cat, veiculo); return { ...x, grupos: agruparEquivalentes(x.grupos, estoque.map(e => ({ ref: e.ref, descricao: e.descricao, qtd: e.qtd, id: e.id }))) }; }, [cat, veiculo, estoque]);
  const grupos = useMemo(() => r ? filtrarPecas(r.grupos, txt).filter(g => !grupo || g.grupo === grupo) : [], [r, txt, grupo]);
  const voltar = html`<button type="button" class="btn" id="pv-voltar" onClick=${onVoltar}>Voltar ao cadastro de produtos</button>`;
  if (erro) return html`<div class="erros">${erro}</div><div class="acoes">${voltar}</div>`;
  if (!r) return html`<span class="dica">Carregando o catálogo de peças…</span>`;
  const nomeV = [veiculo.marca, veiculo.modelo, veiculo.ano_mod || veiculo.ano].filter(Boolean).join(" ");
  if (!r.total) return html`<div class="vazio" id="pv-vazio">Nenhuma peça de catálogo para ${nomeV || "este veículo"}${r.entendido ? " (entendido: " + r.entendido + ")" : ""}.
      Catálogos carregados: ${cat.catalogos.map(c => c.marca).join(", ")}.</div><div class="acoes">${voltar}</div>`;
  if (grande) return html`<${PecaGrande} e=${grande} onUsar=${onUsar} onFechar=${() => setGrande(null)} />`;
  return html`<div class="pv" id="pv">
    <div class="info"><span><strong>${r.grupos.reduce((n, g) => n + g.itens.length, 0)} ${r.total === 1 ? "peça" : "peças"}</strong> para ${r.entendido}${r.ano ? "" : " (sem ano no cadastro: aparecem todos os anos)"}. Dado de catálogo (${cat.catalogos.map(c => c.marca).join(", ")}): confira a aplicação antes de comprar.</span></div>
    <div class="cat-topo"><input id="pv-busca" class="inp" type="search" autocomplete="off" aria-label="Filtrar as peças" placeholder="Filtrar: bandeja, cubo, código…" value=${txt} onInput=${e => setTxt(e.target.value)} />
      <select id="pv-grupo" class="inp pv-sel" aria-label="Grupo de peças" value=${grupo} onChange=${e => setGrupo(e.target.value)}>
        <option value="">Todos os grupos</option>${r.grupos.map(g => html`<option key=${g.grupo} value=${g.grupo}>${g.grupo} (${g.itens.length})</option>`)}</select>${voltar}</div>
    <div class="pv-lista">${grupos.map(g => html`<div key=${g.grupo} class="pv-grupo"><h4>${g.grupo}</h4>
      ${g.itens.map(e => { const p = e.peca, conv = conversaoDoItem(e), ab = aberta === p.codigo;
        return html`<div key=${p.codigo} class="pv-item" data-cod=${p.codigo} data-todos=${"|" + [p.codigo, ...(e.alternativas || []).map(a => a.codigo)].join("|") + "|"}>
          <${FotoPeca} p=${p} onAbrir=${() => setGrande(e)} />
          <div class="pv-meio"><strong>${p.descricao}</strong>
            ${p.medidas ? html`<span class="pv-med">${p.medidas}</span>` : null}
            <span class="pv-apl">${e.conferir ? html`<b class="c-warn">Confira a versão: </b>` : null}${e.aplicacoes.slice(0, 3).join(" · ")}${e.aplicacoes.length > 3 ? " · e mais " + (e.aplicacoes.length - 3) : ""}</span>
            ${e.estoque ? html`<span class="pv-estoque"><b>Tem no estoque:</b> ${e.estoque.descricao} (${e.estoque.qtd} un)</span>` : null}
            ${conv.length ? html`<span class="pv-resumo"><b>Conversão:</b> ${conv.slice(0, 4).map(c => c.marca.replace("Montadora (original)", "Montadora") + " " + c.codigos.slice(0, 2).join(" / ")).join(" · ")}${conv.length > 4 ? " · e mais " + (conv.length - 4) : ""}</span>` : null}
            <span class="pv-cod">${p.oem.length ? "Cód. montadora " + chaveDaPeca(p) + " · " : ""}${p.marca} ${p.codigo}${p.emb ? " · embalagem com " + p.emb : ""}${p.breve ? " · em breve no catálogo" : ""}</span>
            ${ab ? html`<div class="pv-conv" id=${"pv-conv-" + p.codigo.replace(/[^A-Za-z0-9]+/g, "_")}>${conv.length ? conv.map(c => html`<div key=${c.marca}><span>${c.marca}</span><b>${c.codigos.join(" / ")}</b></div>`)
              : html`<span class="dica">O catálogo ${p.marca} não traz conversão para esta peça.</span>`}</div>` : null}</div>
          <div class="pv-botoes">${e.estoque && onUsarProduto ? html`<button type="button" class="btn btn-sm btn-pri pv-usar-estoque" onClick=${() => onUsarProduto(e.estoque.id)}>Usar do estoque</button>` : null}<button type="button" class=${"btn btn-sm pv-usar" + (e.estoque ? "" : " btn-pri")} onClick=${() => onUsar(p)}>Usar</button>
            <button type="button" class="btn btn-sm pv-conversao" aria-expanded=${ab} onClick=${() => setAberta(ab ? "" : p.codigo)}>Conversão</button></div></div>`; })}</div>`)}
      ${!grupos.length ? html`<div class="vazio">Nada com esse filtro.</div>` : null}</div></div>`;
}
