// Etapa 3 de óleo e filtros (14/11/2026): na O.S., "Óleo e filtros da ficha" lança de uma vez o óleo e os filtros que estão no ESTOQUE.
// Filtro sem saldo não é lançado (só aparece o código para comprar). Nada é gravado aqui: devolve os itens para a O.S. (que grava como
// qualquer item incluído à mão, com a baixa do estoque de sempre). Regras: js/fichaos.js.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { useApp, Modal } from "../ui.js";
import { uuid, reais, qtdFmt, precoTabela, exPlaca } from "../util.js";
import { carregarCatalogo, indiceEstoque } from "../catalogo.js";
import { candidatosOleo, filtrosDaFicha, litrosDaFicha } from "../fichaos.js";

const num = t => Number(String(t).replace(",", ".")) || 0;

export function LancarFicha({ o, v, itens, tabela, onFechar, onLancar }) {
  const { dados } = useApp();
  const f = v.ficha_oleo;
  const [cat, setCat] = useState(null), [erro, setErro] = useState("");
  useEffect(() => { let vivo = true; carregarCatalogo().then(c => vivo && setCat(c)).catch(() => vivo && setErro("Não deu para carregar o catálogo neste aparelho.")); return () => { vivo = false; }; }, []);
  const estoque = useMemo(() => indiceEstoque(dados.produtos), [dados.produtos]);
  const lt = useMemo(() => litrosDaFicha(f.litros), [f.litros]);
  const diesel = /diesel/i.test(v.combustivel || "") ? true : null;
  const oleos = useMemo(() => candidatosOleo(dados.produtos, f.viscosidade, lt.qtd, diesel), [dados.produtos, f.viscosidade, lt.qtd, diesel]);
  const filtros = useMemo(() => cat ? filtrosDaFicha(cat, estoque, dados.produtos, f) : [], [cat, estoque, dados.produtos, f]);
  const jaNaOS = id => itens.some(i => i.produto_id === id);
  const [sel, setSel] = useState({}), [oleoId, setOleoId] = useState(""), [qOleo, setQOleo] = useState(lt.qtd ? String(lt.qtd).replace(".", ",") : ""), [qtds, setQtds] = useState({});
  useEffect(() => { if (oleos.length && !oleoId) { setOleoId(oleos[0].id); setSel(s => ({ ...s, oleo: !jaNaOS(oleos[0].id) && lt.qtd > 0 })); } }, [oleos]);
  useEffect(() => { setSel(s => { const n = { ...s }; for (const x of filtros) if (!(x.k in n)) n[x.k] = !!x.produto && !jaNaOS(x.produto.id); return n; }); }, [filtros]);
  const prodOleo = oleos.find(p => p.id === oleoId) || null;
  const linhas = [];   // o que vai para a O.S.
  if (sel.oleo && prodOleo && num(qOleo) > 0) linhas.push({ p: prodOleo, qtd: num(qOleo) });
  for (const x of filtros) if (sel[x.k] && x.produto) linhas.push({ p: x.produto, qtd: num(qtds[x.k] || 1) || 1 });
  const falta = linhas.find(l => l.p.controla_estoque && Number(l.p.estoque_atual) < l.qtd && !l.p.vender_sem_estoque);
  const total = linhas.reduce((s, l) => s + l.qtd * precoTabela(l.p, tabela), 0);
  const lancar = () => {
    if (!linhas.length) return setErro("Marque pelo menos um item.");
    if (falta) return setErro("Estoque insuficiente de " + falta.p.descricao + ": há " + qtdFmt(falta.p.estoque_atual) + " " + falta.p.unidade + ".");
    onLancar(linhas.map(({ p, qtd }) => ({ id: uuid(), tipo: "peca", descricao: p.descricao, produto_id: p.id, codigo: p.referencia || String(p.codigo), qtd, valor_unit: precoTabela(p, tabela), custo_unit: Number(p.custo) || 0, qualidade: "original" })));
  };
  const confirmada = f.origem === "oficina";
  return html`<${Modal} titulo=${"Óleo e filtros da ficha · " + (o.veiculo && o.veiculo.placa ? exPlaca(o.veiculo.placa) : v.modelo)} largo onFechar=${onFechar}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <p class="sub">${v.marca} ${v.modelo}${v.motor ? " · " + v.motor : ""} — ficha: <b>${f.litros} L ${f.viscosidade || ""}</b>
      <span class=${"fo-selo " + (confirmada ? "fo-ok" : "fo-cat")}>${confirmada ? "Confirmada pela oficina" : "Do catálogo, confira"}</span></p>
    ${!confirmada ? html`<p class="sub" id="lf-aviso">Esta ficha ainda não foi confirmada: confira o óleo e os filtros antes de lançar.</p>` : null}
    <h4 class="sub-titulo">Óleo (${f.litros} L, ${f.viscosidade || "sem viscosidade"})</h4>
    ${!oleos.length ? html`<p class="sub" id="lf-sem-oleo">${lt.qtd ? "Nenhum óleo de motor " + (f.viscosidade || "") + " no estoque." : "A ficha não tem litros."} Lance à mão se for comprar.</p>`
      : html`<div class="lf-linha"><label><input type="checkbox" id="lf-oleo" checked=${!!sel.oleo} onChange=${e => setSel(s => ({ ...s, oleo: e.target.checked }))} /> </label>
        <select id="lf-oleo-prod" class="inp" value=${oleoId} onChange=${e => setOleoId(e.target.value)}>${oleos.map(p => html`<option key=${p.id} value=${p.id}>${p.descricao}${p.marca ? " · " + p.marca : ""} · ${qtdFmt(p.estoque_atual)} ${p.unidade} · ${reais(precoTabela(p, tabela))}/${p.unidade}${jaNaOS(p.id) ? " (já na O.S.)" : ""}</option>`)}</select>
        <input id="lf-oleo-qtd" class="inp lf-qtd" inputmode="decimal" value=${qOleo} onInput=${e => setQOleo(e.target.value)} aria-label="Litros" /><span class="sub">L</span></div>
        ${lt.duvida ? html`<p class="sub" id="lf-litros-duvida">O catálogo trouxe mais de um valor de litros (${f.litros}): confira a quantidade.</p>` : null}`}
    <h4 class="sub-titulo">Filtros (só o que está no estoque)</h4>
    ${!cat && !erro ? html`<span class="dica">Carregando o catálogo…</span>` : null}
    ${filtros.map(x => html`<div key=${x.k} class=${"lf-linha" + (x.produto ? "" : " lf-sem")} id=${"lf-f-" + x.k}>
      <label><input type="checkbox" checked=${!!sel[x.k]} disabled=${!x.produto} onChange=${e => setSel(s => ({ ...s, [x.k]: e.target.checked }))} /> <b>${x.rotulo}</b></label>
      ${x.produto ? html`<span class="lf-desc">${x.produto.marca ? x.produto.marca + " " : ""}${x.produto.referencia || x.produto.descricao} · ${qtdFmt(x.produto.estoque_atual)} un. · ${reais(precoTabela(x.produto, tabela))}${jaNaOS(x.produto.id) ? " · já está na O.S." : ""}</span>
          <input class="inp lf-qtd" inputmode="decimal" value=${qtds[x.k] || "1"} onInput=${e => setQtds(q => ({ ...q, [x.k]: e.target.value }))} aria-label=${"Quantidade do filtro de " + x.rotulo.toLowerCase()} />`
        : html`<span class="lf-desc sub">sem estoque. Código: ${x.principais}</span>`}</div>`)}
    <p class="sub">Total dos itens marcados: <b id="lf-total">${reais(total)}</b>. Mão de obra não entra aqui.</p>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" id="lf-lancar" onClick=${lancar}>Lançar ${linhas.length} ${linhas.length === 1 ? "item" : "itens"}</button></div>
  </${Modal}>`;
}
