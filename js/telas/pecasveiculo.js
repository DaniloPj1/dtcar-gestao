// Peças que servem no veículo da O.S. / do orçamento (pedido do Danilo em 15/11/2026). Só leitura: escolhe a peça do catálogo e devolve
// para o item da O.S., onde o valor é digitado. Não depende do estoque e não cria produto. Regras: js/pecas.js.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { carregarPecas, pecasDoVeiculo, filtrarPecas, conversaoDaPeca, chaveDaPeca } from "../pecas.js";

const SITE = "https://gestao.dtcarcentroautomotivo.com.br/";
// fotos: miniaturas em catalogo/fotos/<pasta>/ (não entram no pacote sem internet; sem rede a peça aparece sem foto)
const urlFoto = (p, doSite) => (doSite ? SITE : new URL("../../", import.meta.url).href) + "catalogo/fotos/" + p.pasta + "/" + p.foto + ".jpg";
function FotoPeca({ p }) {
  const [passo, setPasso] = useState(0); // 0 = endereço do próprio sistema; 1 = site; 2 = sem foto
  if (!p.foto || passo > 1) return html`<span class="pv-foto pv-semfoto" aria-hidden="true">sem foto</span>`;
  return html`<img class="pv-foto" loading="lazy" alt=${"Foto da peça " + p.codigo} src=${urlFoto(p, passo === 1)} onError=${() => setPasso(n => n + 1)} />`;
}

export function PecasVeiculo({ veiculo, onUsar, onVoltar }) {
  const [cat, setCat] = useState(null), [erro, setErro] = useState(""), [txt, setTxt] = useState(""), [grupo, setGrupo] = useState(""), [aberta, setAberta] = useState("");
  useEffect(() => { let vivo = true; carregarPecas().then(c => vivo && setCat(c)).catch(() => vivo && setErro("Não deu para abrir o catálogo de peças agora.")); return () => { vivo = false; }; }, []);
  const r = useMemo(() => cat ? pecasDoVeiculo(cat, veiculo) : null, [cat, veiculo]);
  const grupos = useMemo(() => r ? filtrarPecas(r.grupos, txt).filter(g => !grupo || g.grupo === grupo) : [], [r, txt, grupo]);
  const voltar = html`<button type="button" class="btn" id="pv-voltar" onClick=${onVoltar}>Voltar ao cadastro de produtos</button>`;
  if (erro) return html`<div class="erros">${erro}</div><div class="acoes">${voltar}</div>`;
  if (!r) return html`<span class="dica">Carregando o catálogo de peças…</span>`;
  const nomeV = [veiculo.marca, veiculo.modelo, veiculo.ano_mod || veiculo.ano].filter(Boolean).join(" ");
  if (!r.total) return html`<div class="vazio" id="pv-vazio">Nenhuma peça de catálogo para ${nomeV || "este veículo"}${r.entendido ? " (entendido: " + r.entendido + ")" : ""}.
      Catálogos carregados: ${cat.catalogos.map(c => c.marca).join(", ")}.</div><div class="acoes">${voltar}</div>`;
  return html`<div class="pv" id="pv">
    <div class="info"><span><strong>${r.total} ${r.total === 1 ? "peça" : "peças"}</strong> para ${r.entendido}${r.ano ? "" : " (sem ano no cadastro: aparecem todos os anos)"}. Dado de catálogo (${cat.catalogos.map(c => c.marca).join(", ")}): confira a aplicação antes de comprar.</span></div>
    <div class="cat-topo"><input id="pv-busca" class="inp" type="search" autocomplete="off" aria-label="Filtrar as peças" placeholder="Filtrar: bandeja, cubo, código…" value=${txt} onInput=${e => setTxt(e.target.value)} />
      <select id="pv-grupo" class="inp pv-sel" aria-label="Grupo de peças" value=${grupo} onChange=${e => setGrupo(e.target.value)}>
        <option value="">Todos os grupos</option>${r.grupos.map(g => html`<option key=${g.grupo} value=${g.grupo}>${g.grupo} (${g.itens.length})</option>`)}</select>${voltar}</div>
    <div class="pv-lista">${grupos.map(g => html`<div key=${g.grupo} class="pv-grupo"><h4>${g.grupo}</h4>
      ${g.itens.map(e => { const p = e.peca, conv = conversaoDaPeca(p), ab = aberta === p.codigo;
        return html`<div key=${p.codigo} class="pv-item" data-cod=${p.codigo}>
          <${FotoPeca} p=${p} />
          <div class="pv-meio"><strong>${p.descricao}</strong>
            ${p.medidas ? html`<span class="pv-med">${p.medidas}</span>` : null}
            <span class="pv-apl">${e.conferir ? html`<b class="c-warn">Confira a versão: </b>` : null}${e.aplicacoes.slice(0, 3).join(" · ")}${e.aplicacoes.length > 3 ? " · e mais " + (e.aplicacoes.length - 3) : ""}</span>
            <span class="pv-cod">${p.oem.length ? "Cód. montadora " + chaveDaPeca(p) + " · " : ""}${p.marca} ${p.codigo}${p.breve ? " · em breve no catálogo" : ""}</span>
            ${ab ? html`<div class="pv-conv" id=${"pv-conv-" + p.codigo}>${conv.length ? conv.map(c => html`<div key=${c.marca}><span>${c.marca}</span><b>${c.codigos.join(" / ")}</b></div>`)
              : html`<span class="dica">O catálogo ${p.marca} não traz conversão para esta peça.</span>`}</div>` : null}</div>
          <div class="pv-botoes"><button type="button" class="btn btn-sm btn-pri pv-usar" onClick=${() => onUsar(p)}>Usar</button>
            <button type="button" class="btn btn-sm pv-conversao" aria-expanded=${ab} onClick=${() => setAberta(ab ? "" : p.codigo)}>Conversão</button></div></div>`; })}</div>`)}
      ${!grupos.length ? html`<div class="vazio">Nada com esse filtro.</div>` : null}</div></div>`;
}
