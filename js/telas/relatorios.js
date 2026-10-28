// Relatório de produtos e serviços vendidos (O.S. entregues e vendas de balcão)
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Seg, Vazio } from "../ui.js";
import { norm, reais, qtdFmt, hojeISO, fmtData } from "../util.js";

const inicioMes = () => hojeISO().slice(0, 8) + "01";
const ORDEM = [["valor", "Faturamento"], ["qtd", "Quantidade"], ["margem", "Margem"], ["descricao", "Descrição"]];

export function Relatorios() {
  const { cfg } = useApp();
  const [de, setDe] = useState(inicioMes()), [ate, setAte] = useState(hojeISO());
  const [origem, setOrigem] = useState("todas"), [tipo, setTipo] = useState("produto"), [q, setQ] = useState(""), [ordem, setOrdem] = useState("valor");
  const [linhas, setLinhas] = useState(null), [erro, setErro] = useState("");
  useEffect(() => { setLinhas(null); setErro("");
    const ini = new Date(de + "T00:00:00"), fim = new Date(new Date(ate + "T00:00:00").getTime() + 86400000);
    api.relatorioVendidos(ini.toISOString(), fim.toISOString()).then(setLinhas).catch(e => { setErro(e.message); setLinhas([]); }); }, [de, ate]);
  const dados = useMemo(() => {
    const g = new Map();
    for (const l of linhas || []) {
      if (origem !== "todas" && l.origem !== origem) continue;
      if (tipo !== "todos" && l.tipo !== tipo) continue;
      if (q && !norm(l.descricao).includes(norm(q)) && !norm(l.referencia).includes(norm(q)) && String(l.codigo) !== q.trim()) continue;
      const k = l.produto_id || "d:" + norm(l.descricao) + l.tipo;
      const x = g.get(k) || { ...l, qtd: 0, valor: 0, custo: 0, vezes: 0, os: 0, balcao: 0 };
      x.qtd += Number(l.qtd); x.valor += Number(l.valor); x.custo += Number(l.custo); x.vezes += Number(l.vezes); x[l.origem === "os" ? "os" : "balcao"] += Number(l.qtd);
      g.set(k, x);
    }
    const l = [...g.values()].map(x => ({ ...x, margem: x.custo > 0 ? (x.valor - x.custo) / x.valor * 100 : null }));
    const f = { valor: (a, b) => b.valor - a.valor, qtd: (a, b) => b.qtd - a.qtd, margem: (a, b) => (b.margem ?? -999) - (a.margem ?? -999), descricao: (a, b) => a.descricao.localeCompare(b.descricao) }[ordem];
    return l.sort(f);
  }, [linhas, origem, tipo, q, ordem]);
  const tot = dados.reduce((t, x) => ({ qtd: t.qtd + x.qtd, valor: t.valor + x.valor, custo: t.custo + x.custo, comCusto: t.comCusto + (x.custo > 0 ? x.valor : 0) }), { qtd: 0, valor: 0, custo: 0, comCusto: 0 });
  const exportar = () => {
    const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"', n = v => String((Number(v) || 0).toFixed(2)).replace(".", ",");
    const L = [["Código", "Descrição", "Referência", "Tipo", "Qtd. total", "Qtd. em O.S.", "Qtd. no balcão", "Faturamento", "Custo", "Margem %"].map(esc).join(";")];
    for (const x of dados) L.push([x.codigo || "", x.descricao, x.referencia || "", x.tipo === "servico" ? "Serviço" : x.tipo === "produto" ? "Produto" : "Outro", String(x.qtd).replace(".", ","), String(x.os).replace(".", ","), String(x.balcao).replace(".", ","), n(x.valor), n(x.custo), x.margem === null ? "" : n(x.margem)].map(esc).join(";"));
    const blob = new Blob(["﻿" + L.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `vendidos-${de}-a-${ate}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  return html`<div class="pagina larga relatorio">
    <div class="painel-topo"><div><h1>Produtos vendidos</h1><span class="sub">O.S. entregues e vendas de balcão de ${fmtData(de)} a ${fmtData(ate)}</span></div>
      <div class="acoes so-tela"><button type="button" class="btn" disabled=${!dados.length} onClick=${exportar}>Exportar planilha</button><button type="button" class="btn btn-pri" disabled=${!dados.length} onClick=${() => window.print()}>Imprimir</button></div></div>
    <section class="card filtros-rel so-tela">
      <div class="grade">
        <div class="campo"><label for="rel-de">De</label><input id="rel-de" type="date" class="inp" value=${de} onInput=${e => e.target.value && setDe(e.target.value)} /></div>
        <div class="campo"><label for="rel-ate">Até</label><input id="rel-ate" type="date" class="inp" value=${ate} onInput=${e => e.target.value && setAte(e.target.value)} /></div>
        <div class="campo"><label for="rel-q">Filtrar</label><input id="rel-q" class="inp" placeholder="Descrição, código ou referência" value=${q} onInput=${e => setQ(e.target.value)} /></div>
        <div class="campo"><label for="rel-ord">Ordenar por</label><select id="rel-ord" class="inp" value=${ordem} onChange=${e => setOrdem(e.target.value)}>${ORDEM.map(([k, t]) => html`<option value=${k}>${t}</option>`)}</select></div>
      </div>
      <div class="acoes"><${Seg} rotulo="Tipo" opcoes=${[["Produtos", "info"], ["Serviços", "info"], ["Tudo", "info"]]} valor=${{ produto: "Produtos", servico: "Serviços", todos: "Tudo" }[tipo]} onEscolha=${v => setTipo({ Produtos: "produto", Serviços: "servico", Tudo: "todos" }[v])} />
        <${Seg} rotulo="Origem" opcoes=${[["O.S. e balcão", "info"], ["Só O.S.", "info"], ["Só balcão", "info"]]} valor=${{ todas: "O.S. e balcão", os: "Só O.S.", balcao: "Só balcão" }[origem]} onEscolha=${v => setOrigem({ "O.S. e balcão": "todas", "Só O.S.": "os", "Só balcão": "balcao" }[v])} /></div>
    </section>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="kpis rel-kpis">
      <div class="kpi"><span>Itens diferentes</span><b class="kpi-din">${dados.length}</b></div>
      <div class="kpi"><span>Quantidade vendida</span><b class="kpi-din">${qtdFmt(tot.qtd)}</b></div>
      <div class="kpi kpi-forte"><span>Faturamento</span><b class="kpi-din">${reais(tot.valor)}</b></div>
      <div class="kpi"><span>Margem bruta</span><b class="kpi-din">${tot.comCusto ? Math.round((tot.comCusto - tot.custo) / tot.comCusto * 100) + "%" : "—"}</b><small>${tot.comCusto < tot.valor * 0.8 ? "Custo lançado em " + Math.round(tot.comCusto / (tot.valor || 1) * 100) + "% do faturamento" : "nos itens com custo"}</small></div>
    </div>
    <section class="card">
      ${!linhas ? html`<div class="esqueleto"></div>` : dados.length ? html`<div class="tabela-rolagem"><table class="tab-rel">
        <thead><tr><th>Cód.</th><th>Descrição</th><th class="num">Qtd.</th><th class="num">Em O.S.</th><th class="num">Balcão</th><th class="num">Faturamento</th><th class="num">Custo</th><th class="num">Margem</th></tr></thead>
        <tbody>${dados.map((x, n) => html`<tr key=${n}><td class="cod">${x.codigo || ""}</td><td>${x.descricao}${x.referencia ? html`<small>${x.referencia}</small>` : null}${!x.produto_id ? html`<small>sem cadastro</small>` : null}</td>
          <td class="num">${qtdFmt(x.qtd)}</td><td class="num">${x.os ? qtdFmt(x.os) : ""}</td><td class="num">${x.balcao ? qtdFmt(x.balcao) : ""}</td><td class="num">${reais(x.valor)}</td><td class="num">${x.custo ? reais(x.custo) : ""}</td>
          <td class=${"num" + (x.margem !== null && x.margem < 20 ? " c-bad" : "")}>${x.margem === null ? "—" : Math.round(x.margem) + "%"}</td></tr>`)}</tbody>
        <tfoot><tr><td></td><td>Total</td><td class="num">${qtdFmt(tot.qtd)}</td><td></td><td></td><td class="num">${reais(tot.valor)}</td><td class="num">${reais(tot.custo)}</td><td></td></tr></tfoot></table></div>`
        : html`<${Vazio}>Nada vendido neste período com esses filtros.</${Vazio}>`}
    </section>
    <p class="dica">Considera O.S. entregues (pela data de entrega) e vendas de balcão concluídas. Peças fornecidas pelo cliente e itens não aprovados ficam de fora. ${cfg.nome}.</p>
  </div>`;
}
