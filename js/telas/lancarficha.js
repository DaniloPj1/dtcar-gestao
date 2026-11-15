// Etapa 3 de óleo e filtros (14/11/2026): na O.S., "Óleo e filtros da ficha" lança de uma vez o óleo e os filtros que estão no ESTOQUE.
// Filtro sem saldo não é lançado (só aparece o código para comprar). Nada é gravado aqui: devolve os itens para a O.S. (que grava como
// qualquer item incluído à mão, com a baixa do estoque de sempre). Regras: js/fichaos.js.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { useApp, Modal } from "../ui.js";
import { uuid, reais, qtdFmt, precoTabela, exPlaca, norm } from "../util.js";
import { carregarCatalogo, indiceEstoque } from "../catalogo.js";
import { candidatosOleo, filtrosDaFicha, litrosDaFicha, servicoPadrao } from "../fichaos.js";

const num = t => Number(String(t).replace(",", ".")) || 0;

// Mão de obra da troca: serviços do cadastro com "troca/subst." e "óleo" na descrição (ex.: "SUBST. DE ÓLEO E FILTRO"); o que já está na lista não é marcado de novo.
const eTrocaOleo = p => p.tipo === "servico" && p.ativo !== false && /\b(troca|trocar|subst\w*)\b/.test(norm(p.descricao)) && /oleo/.test(norm(p.descricao));
const itemServico = (p, tabela, valorHora) => p.cobranca === "hora"
  ? { tipo: "servico", horas: Number(p.horas) || 1, qtd: Number(p.horas) || 1, valor_unit: Number(valorHora) || 0 }
  : { tipo: "servico", horas: null, qtd: 1, valor_unit: precoTabela(p, tabela) };

// orcamento = true: o orçamento não reserva nem barra por falta de estoque (como o ItemModal)
export function LancarFicha({ o, v, itens, tabela, onFechar, onLancar, orcamento = false }) {
  const { dados, cfg } = useApp();
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
  const servicos = useMemo(() => (dados.produtos || []).filter(eTrocaOleo).sort((a, b) => a.descricao.localeCompare(b.descricao)), [dados.produtos]);
  const [servId, setServId] = useState(""), [servSel, setServSel] = useState(false);
  useEffect(() => { const p = servicoPadrao(servicos, v); if (p && !servId) { setServId(p.id); setServSel(!jaNaOS(p.id)); } }, [servicos]);
  const prodServ = servicos.find(p => p.id === servId) || null;
  const prodOleo = oleos.find(p => p.id === oleoId) || null;
  const linhas = [];   // o que vai para a O.S.
  if (sel.oleo && prodOleo && num(qOleo) > 0) linhas.push({ p: prodOleo, qtd: num(qOleo) });
  for (const x of filtros) if (sel[x.k] && x.produto) linhas.push({ p: x.produto, qtd: num(qtds[x.k] || 1) || 1 });
  const falta = orcamento ? null : linhas.find(l => l.p.controla_estoque && Number(l.p.estoque_atual) < l.qtd && !l.p.vender_sem_estoque);
  const itemMO = servSel && prodServ ? itemServico(prodServ, tabela, cfg.valorHora) : null;
  const total = linhas.reduce((s, l) => s + l.qtd * precoTabela(l.p, tabela), 0) + (itemMO ? itemMO.qtd * itemMO.valor_unit : 0);
  const lancar = () => {
    if (!linhas.length && !itemMO) return setErro("Marque pelo menos um item.");
    if (falta) return setErro("Estoque insuficiente de " + falta.p.descricao + ": há " + qtdFmt(falta.p.estoque_atual) + " " + falta.p.unidade + ".");
    const pecas = linhas.map(({ p, qtd }) => ({ id: uuid(), tipo: "peca", descricao: p.descricao, produto_id: p.id, codigo: p.referencia || String(p.codigo), qtd, valor_unit: precoTabela(p, tabela), custo_unit: Number(p.custo) || 0, qualidade: "original" }));
    // a mão de obra vai por último (a lista da O.S. agrupa por tipo, a ordem aqui só vale na gravação)
    onLancar(itemMO ? [...pecas, { id: uuid(), descricao: prodServ.descricao, produto_id: prodServ.id, servico_id: null, custo_unit: 0, qualidade: "", ...itemMO }] : pecas);
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
    <h4 class="sub-titulo">Mão de obra</h4>
    ${!servicos.length ? html`<p class="sub" id="lf-sem-mo">Nenhum serviço de troca de óleo no cadastro. Lance a mão de obra à mão.</p>`
      : html`<div class="lf-linha" id="lf-mo"><label><input type="checkbox" id="lf-mo-sel" checked=${servSel} onChange=${e => setServSel(e.target.checked)} /> </label>
        <select id="lf-mo-prod" class="inp" value=${servId} onChange=${e => { setServId(e.target.value); setServSel(!jaNaOS(e.target.value)); }}>${servicos.map(p => html`<option key=${p.id} value=${p.id}>${p.descricao} · ${p.cobranca === "hora" ? qtdFmt(p.horas) + " h" : reais(precoTabela(p, tabela))}${jaNaOS(p.id) ? " (já na lista)" : ""}</option>`)}</select></div>`}
    <p class="sub">Total dos itens marcados: <b id="lf-total">${reais(total)}</b>.</p>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Cancelar</button><button type="button" class="btn btn-pri" id="lf-lancar" onClick=${lancar}>Lançar ${linhas.length + (itemMO ? 1 : 0)} ${linhas.length + (itemMO ? 1 : 0) === 1 ? "item" : "itens"}</button></div>
  </${Modal}>`;
}
