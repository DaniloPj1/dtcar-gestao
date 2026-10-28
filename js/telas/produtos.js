// Cadastro de produtos e serviços (modelo do OS Oficina 3.0) e controle de estoque
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, Dinheiro } from "../ui.js";
import { norm, reais, qtdFmt, fmtDataHora, parseValor, precoPelaMargem, margemDoPreco, arred } from "../util.js";
import { pode, UNIDADES, TABELAS_PRECO } from "../regras.js";
import { linkImagem } from "../nfe.js";

export const estoqueBaixo = p => p.tipo === "produto" && p.ativo !== false && p.controla_estoque && p.avisar_estoque_baixo && Number(p.estoque_min) > 0 && Number(p.estoque_atual) <= Number(p.estoque_min);
const pct = v => (Number(v) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

const VAZIO = { tipo: "produto", descricao: "", referencia: "", codigo_barras: "", unidade: "UN", categoria: "", marca: "", localizacao: "", estoque_min: 0, estoque_atual: 0,
  custo: 0, margem_vista: 0, preco_vista: 0, margem_prazo: 0, preco_prazo: 0, margem_atacado: 0, preco_atacado: 0, cobranca: "fixo", horas: 0,
  controla_estoque: true, vender_sem_estoque: true, avisar_estoque_baixo: true, obs: "", ativo: true };

export function FormProduto({ inicial, onFechar, onSalvo }) {
  const { dados, cfg, perfil, avisar, confirmar, recarregar } = useApp();
  const [p, setP] = useState(() => ({ ...VAZIO, ...inicial }));
  const [erro, setErro] = useState(""), [estoque, setEstoque] = useState(false);
  const podeEd = pode(perfil, "cadastrar"), ver = pode(perfil, "verValores");
  const set = o => { setP(x => ({ ...x, ...o })); setErro(""); };
  const servico = p.tipo === "servico";
  const listas = useMemo(() => ({ cat: [...new Set(dados.produtos.map(x => x.categoria).filter(Boolean))].sort(), marca: [...new Set(dados.produtos.map(x => x.marca).filter(Boolean))].sort() }), [dados.produtos]);
  const mudarCusto = c => { const o = { custo: c }; for (const t of ["vista", "prazo", "atacado"]) if (Number(p["margem_" + t]) > 0) o["preco_" + t] = precoPelaMargem(c, p["margem_" + t]); else if (c > 0) o["margem_" + t] = margemDoPreco(c, p["preco_" + t]); set(o); };
  const linhaPreco = t => html`<div class="linha-preco" key=${t}><span>${TABELAS_PRECO[t]}</span>
    <div class="inp-suf"><input id=${"p-m-" + t} class="inp" inputmode="decimal" aria-label=${"Margem " + TABELAS_PRECO[t]} value=${String(p["margem_" + t] ?? "").replace(".", ",")}
      onInput=${e => { const m = parseValor(e.target.value); set({ ["margem_" + t]: m, ...(Number(p.custo) > 0 ? { ["preco_" + t]: precoPelaMargem(p.custo, m) } : {}) }); }} /><span>%</span></div>
    <${Dinheiro} id=${"p-v-" + t} valor=${p["preco_" + t]} onMuda=${v => set({ ["preco_" + t]: v, ...(Number(p.custo) > 0 ? { ["margem_" + t]: margemDoPreco(p.custo, v) } : {}) })} /></div>`;
  const salvar = async () => {
    if (!p.descricao.trim()) return setErro("Informe a descrição.");
    if (!servico && Number(p.custo) > 0 && ["vista", "prazo", "atacado"].some(t => Number(p["preco_" + t]) > 0 && Number(p["preco_" + t]) < Number(p.custo)))
      if (!await confirmar({ titulo: "Margem negativa", texto: "Algum preço de venda está abaixo do custo. Salvar mesmo assim?", botao: "Salvar" })) return;
    const { id, codigo, criado_em, atualizado_em, ...resto } = p;
    const reg = { ...resto, descricao: p.descricao.trim(), unidade: (p.unidade || "UN").toUpperCase(), controla_estoque: !servico && p.controla_estoque, avisar_estoque_baixo: !servico && p.avisar_estoque_baixo,
      preco_prazo: Number(p.preco_prazo) || Number(p.preco_vista) || 0, preco_atacado: Number(p.preco_atacado) || Number(p.preco_vista) || 0 };
    if (id) delete reg.estoque_atual; // saldo só muda por movimento de estoque
    try { const r = await api.produtos.salvar(id ? { id, ...reg } : reg); avisar(servico ? "Serviço salvo." : "Produto salvo."); await recarregar(["produtos"]); onSalvo ? onSalvo(r) : onFechar(); }
    catch (e) { setErro(e.message); }
  };
  const excluir = async () => {
    if (!await confirmar({ titulo: "Excluir " + (servico ? "serviço" : "produto"), texto: "Se ele já foi usado em O.S., prefira desmarcar “Ativo”: as O.S. antigas continuam com a descrição, mas perdem o vínculo com o cadastro.", botao: "Excluir", perigo: true })) return;
    try { await api.produtos.excluir(p.id); avisar("Excluído."); recarregar(["produtos"], { completo: true }); onFechar(); } catch (e) { setErro(e.message); }
  };
  if (estoque) return html`<${EstoqueModal} produto=${p} onFechar=${async novo => { setEstoque(false); if (novo !== undefined) set({ estoque_atual: novo }); }} />`;
  return html`<${Modal} titulo=${p.id ? (servico ? "Cadastro de serviço" : "Cadastro de produto") : (servico ? "Novo serviço" : "Novo produto")} largo onFechar=${onFechar}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <fieldset disabled=${!podeEd} class="sem-borda form-ficha">
      <div class="grade ficha-topo">
        <${Campo} id="p-codigo" rotulo="Código"><input id="p-codigo" class="inp" disabled value=${p.id ? p.codigo : "automático"} /></${Campo}>
        <div class="campo"><label>Tipo</label><${Seg} rotulo="Tipo" opcoes=${[["Produto / peça", "info"], ["Serviço / mão de obra", "info"]]} valor=${servico ? "Serviço / mão de obra" : "Produto / peça"} onEscolha=${v => set({ tipo: v.startsWith("Serviço") ? "servico" : "produto", unidade: v.startsWith("Serviço") ? "SERV" : (p.unidade === "SERV" ? "UN" : p.unidade) })} /></div>
      </div>
      <${Campo} id="p-desc" rotulo="Descrição" obrig><${Texto} id="p-desc" valor=${p.descricao} onMuda=${v => set({ descricao: v })} /></${Campo}>
      ${!servico && (p.referencia || p.descricao) ? html`<a class="btn-link" href=${linkImagem(p.referencia, p.marca, p.referencia ? "" : p.descricao)} target="_blank" rel="noopener">Ver imagem do produto no Google</a>` : null}
      ${!servico ? html`<div class="grade">
        <${Campo} id="p-ref" rotulo="Referência / código do fabricante"><${Texto} id="p-ref" valor=${p.referencia} onMuda=${v => set({ referencia: v })} /></${Campo}>
        <${Campo} id="p-barra" rotulo="Código de barras"><${Texto} id="p-barra" inputmode="numeric" valor=${p.codigo_barras} onMuda=${v => set({ codigo_barras: v })} /></${Campo}>
        <${Campo} id="p-marca" rotulo="Marca"><${Texto} id="p-marca" list="p-marcas" valor=${p.marca} onMuda=${v => set({ marca: v })} /><datalist id="p-marcas">${listas.marca.map(x => html`<option value=${x} />`)}</datalist></${Campo}>
        <${Campo} id="p-un" rotulo="Unidade"><${Texto} id="p-un" list="p-uns" valor=${p.unidade} onMuda=${v => set({ unidade: v.toUpperCase().slice(0, 6) })} /><datalist id="p-uns">${UNIDADES.map(x => html`<option value=${x} />`)}</datalist></${Campo}>
        <${Campo} id="p-loc" rotulo="Localização física"><${Texto} id="p-loc" placeholder="ex.: prateleira 3" valor=${p.localizacao} onMuda=${v => set({ localizacao: v })} /></${Campo}>
      </div>` : null}
      <${Campo} id="p-cat" rotulo="Grupo / categoria"><${Texto} id="p-cat" list="p-cats" valor=${p.categoria} onMuda=${v => set({ categoria: v })} /><datalist id="p-cats">${listas.cat.map(x => html`<option value=${x} />`)}</datalist></${Campo}>
      ${!servico ? html`<h4 class="sub-titulo">Estoque</h4>
        <div class="grade">
          <${Campo} id="p-min" rotulo="Estoque mínimo"><input id="p-min" class="inp" inputmode="decimal" value=${String(p.estoque_min ?? "").replace(".", ",")} onInput=${e => set({ estoque_min: parseValor(e.target.value) })} /></${Campo}>
          <${Campo} id="p-atual" rotulo=${p.id ? "Estoque atual" : "Estoque inicial"} dica=${p.id ? "Altere pelo botão Movimentar estoque." : ""}>
            <input id="p-atual" class="inp" inputmode="decimal" disabled=${!!p.id} value=${String(p.estoque_atual ?? "").replace(".", ",")} onInput=${e => set({ estoque_atual: parseValor(e.target.value) })} /></${Campo}>
          ${p.id && ver ? html`<div class="campo"><label>&nbsp;</label><button type="button" class="btn" onClick=${() => setEstoque(true)}>Movimentar estoque</button></div>` : null}
        </div>
        <label class="linha-check"><input type="checkbox" checked=${p.controla_estoque} onChange=${e => set({ controla_estoque: e.target.checked })} /><span>Controlar estoque (baixa automática ao entregar a O.S.)</span></label>
        <label class="linha-check"><input type="checkbox" checked=${p.avisar_estoque_baixo} onChange=${e => set({ avisar_estoque_baixo: e.target.checked })} /><span>Avisar no painel quando o estoque ficar no mínimo</span></label>
        <label class="linha-check"><input type="checkbox" checked=${p.vender_sem_estoque} onChange=${e => set({ vender_sem_estoque: e.target.checked })} /><span>Permitir lançar na O.S. mesmo sem estoque</span></label>` : html`
        <div class="campo"><label>Cobrança</label><${Seg} rotulo="Cobrança" opcoes=${[["Preço fechado", "info"], ["Por hora", "info"]]} valor=${p.cobranca === "hora" ? "Por hora" : "Preço fechado"} onEscolha=${v => set({ cobranca: v === "Por hora" ? "hora" : "fixo" })} /></div>
        ${p.cobranca === "hora" ? html`<${Campo} id="p-horas" rotulo="Tempo padrão (horas)" dica=${"No orçamento: horas × valor-hora (" + reais(cfg.valorHora || 0) + "/h, definido em Ajustes)."}><input id="p-horas" class="inp" inputmode="decimal" value=${String(p.horas || "").replace(".", ",")} onInput=${e => set({ horas: parseValor(e.target.value) })} /></${Campo}>` : null}`}
      ${ver && !(servico && p.cobranca === "hora") ? html`<h4 class="sub-titulo">Preços</h4>
        ${!servico ? html`<${Campo} id="p-custo" rotulo="Preço de custo"><${Dinheiro} id="p-custo" valor=${p.custo} onMuda=${mudarCusto} /></${Campo}>` : null}
        <div class="tabela-precos">${!servico ? html`<div class="linha-preco cab"><span>Tabela</span><span>Margem sobre o custo</span><span>Preço de venda</span></div>` : null}
          ${servico ? html`<${Campo} id="p-v-vista" rotulo="Preço"><${Dinheiro} id="p-v-vista" valor=${p.preco_vista} onMuda=${v => set({ preco_vista: v, preco_prazo: v, preco_atacado: v })} /></${Campo}>` : ["vista", "prazo", "atacado"].map(linhaPreco)}</div>
        ${!servico && Number(p.custo) > 0 && Number(p.preco_vista) > 0 && Number(p.preco_vista) < Number(p.custo) ? html`<span class="dica erro">Atenção: o preço à vista está abaixo do custo (margem negativa).</span>` : null}` : null}
      <${Campo} id="p-obs" rotulo=${servico ? "Observações" : "Aplicação / observações"}><${Area} id="p-obs" placeholder=${servico ? "" : "ex.: GOL G1 1.8 8V; GOL G2 1.6 8V"} valor=${p.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
      <label class="linha-check"><input type="checkbox" checked=${p.ativo !== false} onChange=${e => set({ ativo: e.target.checked })} /><span>Ativo (aparece na busca da O.S.)</span></label>
    </fieldset>
    ${p.id && !servico ? html`<${FornecedoresDoProduto} id=${p.id} />` : null}
    <div class="acoes">${p.id && pode(perfil, "excluir") ? html`<button type="button" class="btn btn-perigo" onClick=${excluir}>Excluir</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${onFechar}>${podeEd ? "Cancelar" : "Fechar"}</button>${podeEd ? html`<button type="button" class="btn btn-pri" onClick=${salvar}>Salvar</button>` : null}</div>
  </${Modal}>`;
}

/* ---------------- fornecedores e códigos do produto ---------------- */
function FornecedoresDoProduto({ id }) {
  const { dados, perfil } = useApp();
  const [l, setL] = useState(null);
  useEffect(() => { api.vinculos.doProduto(id).then(setL).catch(() => setL([])); }, [id]);
  if (!l || !l.length) return null;
  return html`<h4 class="sub-titulo">Fornecedores</h4><div class="lista">${l.map(v => { const f = dados.fornecedores.find(x => x.id === v.fornecedor_id) || {};
    return html`<div class="linha" key=${v.id}><span class="meio"><strong>${f.fantasia || f.razao || "Fornecedor"}</strong><span>código ${v.codigo}${Number(v.fator) !== 1 ? " · " + qtdFmt(v.fator) + " un. por " + (v.unidade || "unidade") : ""}${v.ultima_compra ? " · última compra " + new Date(v.ultima_compra + "T12:00").toLocaleDateString("pt-BR") : ""}</span></span>
      ${pode(perfil, "verValores") && v.ultimo_custo ? html`<b>${reais(v.ultimo_custo)}</b>` : null}</div>`; })}</div>`;
}

/* ---------------- movimentação de estoque ---------------- */
export function EstoqueModal({ produto, onFechar }) {
  const { avisar, recarregar } = useApp();
  const [tipo, setTipo] = useState("entrada"), [qtd, setQtd] = useState(""), [custo, setCusto] = useState(0), [obs, setObs] = useState("");
  const [movs, setMovs] = useState(null), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  useEffect(() => { api.estoque.movimentos(produto.id).then(setMovs).catch(() => setMovs([])); }, [produto.id]);
  const q = parseValor(qtd);
  const novo = tipo === "entrada" ? Number(produto.estoque_atual) + q : tipo === "saida" ? Number(produto.estoque_atual) - q : q;
  const confirmar = async () => {
    if (tipo !== "ajuste" && !(q > 0)) return setErro("Informe a quantidade.");
    if (tipo === "ajuste" && !(q >= 0)) return setErro("Informe o saldo contado.");
    setSalvando(true);
    try { const r = await api.estoque.movimentar(produto.id, tipo, q, tipo === "entrada" ? custo : null, obs); avisar("Estoque atualizado: " + qtdFmt(r) + " " + produto.unidade + "."); await recarregar(["produtos"]); onFechar(Number(r)); }
    catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  const ROT = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste", estorno: "Estorno" };
  return html`<${Modal} titulo="Movimentar estoque" onFechar=${() => onFechar()}>
    <div class="total-item"><span>${produto.descricao}</span><b>${qtdFmt(produto.estoque_atual)} ${produto.unidade}</b></div>
    <${Seg} rotulo="Tipo de movimento" opcoes=${[["Entrada (compra)", "ok"], ["Saída avulsa", "warn"], ["Ajuste de inventário", "info"]]} valor=${{ entrada: "Entrada (compra)", saida: "Saída avulsa", ajuste: "Ajuste de inventário" }[tipo]}
      onEscolha=${v => { setTipo(v.startsWith("Entrada") ? "entrada" : v.startsWith("Saída") ? "saida" : "ajuste"); setErro(""); }} />
    <div class="grade">
      <${Campo} id="e-qtd" rotulo=${tipo === "ajuste" ? "Saldo contado" : "Quantidade"}><input id="e-qtd" class="inp" inputmode="decimal" value=${qtd} onInput=${e => { setQtd(e.target.value); setErro(""); }} /></${Campo}>
      ${tipo === "entrada" ? html`<${Campo} id="e-custo" rotulo="Custo unitário (opcional)" dica="Atualiza o custo e recalcula os preços pelas margens."><${Dinheiro} id="e-custo" valor=${custo} onMuda=${setCusto} /></${Campo}>` : null}
    </div>
    <${Campo} id="e-obs" rotulo="Observação"><${Texto} id="e-obs" placeholder=${tipo === "entrada" ? "Nota fiscal, fornecedor" : "Motivo"} valor=${obs} onMuda=${setObs} /></${Campo}>
    ${qtd !== "" ? html`<div class="total-item"><span>Saldo após o movimento</span><b class=${novo < 0 ? "c-bad" : ""}>${qtdFmt(novo)} ${produto.unidade}</b></div>` : null}
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${() => onFechar()}>Voltar</button><button type="button" class="btn btn-pri" disabled=${salvando} onClick=${confirmar}>Confirmar</button></div>
    <h4 class="sub-titulo">Últimos movimentos</h4>
    ${!movs ? html`<span class="dica">Carregando…</span>` : movs.length ? html`<table class="tab-mov"><tbody>${movs.map(m => html`<tr key=${m.id}><td>${fmtDataHora(m.criado_em)}</td><td>${ROT[m.tipo]}${m.obs ? html`<small>${m.obs}</small>` : null}</td>
      <td class=${Number(m.qtd) < 0 ? "c-bad" : "c-ok"}>${Number(m.qtd) > 0 ? "+" : ""}${qtdFmt(m.qtd)}</td><td>${qtdFmt(m.saldo)}</td></tr>`)}</tbody></table>` : html`<span class="dica">Nenhum movimento registrado.</span>`}
  </${Modal}>`;
}

/* ---------------- lista ---------------- */
export function ProdutosLista() {
  const { dados, perfil, ir } = useApp();
  const [q, setQ] = useState(""), [filtro, setFiltro] = useState("todos"), [ed, setEd] = useState(null), [lim, setLim] = useState(80);
  const ver = pode(perfil, "verValores"), podeCad = pode(perfil, "cadastrar");
  useEffect(() => setLim(80), [q, filtro]);
  const lista = useMemo(() => {
    const n = norm(q), cod = /^\d+$/.test(q.trim()) ? +q.trim() : null;
    let l = dados.produtos.filter(p => filtro === "inativos" ? p.ativo === false : p.ativo !== false);
    if (filtro === "produto" || filtro === "servico") l = l.filter(p => p.tipo === filtro);
    if (filtro === "baixo") l = l.filter(estoqueBaixo);
    if (n) l = l.filter(p => p.codigo === cod || norm(p.descricao).includes(n) || norm(p.referencia).includes(n) || norm(p.marca).includes(n) || norm(p.categoria).includes(n) || norm(p.obs).includes(n) || (p.codigo_barras && p.codigo_barras === q.trim()));
    return [...l].sort((a, b) => a.descricao.localeCompare(b.descricao));
  }, [dados.produtos, q, filtro]);
  const valorEstoque = useMemo(() => dados.produtos.filter(p => p.tipo === "produto" && p.ativo !== false).reduce((s, p) => s + Math.max(0, Number(p.estoque_atual)) * Number(p.custo || 0), 0), [dados.produtos]);
  const nBaixo = dados.produtos.filter(estoqueBaixo).length;
  const exportar = () => {
    const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"', n2 = v => String(Number(v || 0).toFixed(2)).replace(".", ",");
    const linhas = [["Código", "Tipo", "Descrição", "Referência", "Marca", "Grupo", "Unidade", "Localização", "Estoque", "Mínimo", "Custo", "À vista", "A prazo", "Atacado"].map(esc).join(";")];
    for (const p of lista) linhas.push([p.codigo, p.tipo === "servico" ? "Serviço" : "Produto", p.descricao, p.referencia, p.marca, p.categoria, p.unidade, p.localizacao, String(p.estoque_atual).replace(".", ","), String(p.estoque_min).replace(".", ","), n2(p.custo), n2(p.preco_vista), n2(p.preco_prazo), n2(p.preco_atacado)].map(esc).join(";"));
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "produtos-dtcar-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  return html`
    <div class="linha-add"><input id="busca-prod" class="inp" aria-label="Buscar produto" placeholder="Descrição, código, referência, marca ou aplicação" value=${q} onInput=${e => setQ(e.target.value)} />
      ${podeCad ? html`<button type="button" class="btn" onClick=${() => ir("/nfe")}>Entrada de nota (XML)</button><button type="button" class="btn btn-pri" onClick=${() => setEd({ tipo: filtro === "servico" ? "servico" : "produto", unidade: filtro === "servico" ? "SERV" : "UN" })}>+ Novo</button>` : null}</div>
    <div class="chips rolagem">${[["todos", "Todos"], ["produto", "Produtos / peças"], ["servico", "Serviços"], ["baixo", "Estoque baixo" + (nBaixo ? " (" + nBaixo + ")" : "")], ["inativos", "Inativos"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (filtro === k ? " ativo" : "")} onClick=${() => setFiltro(k)}>${t}</button>`)}</div>
    <section class="card"><div class="secao-topo"><h3>${lista.length} item(ns)</h3>${ver ? html`<span class="sub">Estoque a custo: <b>${reais(valorEstoque)}</b></span><button type="button" class="btn btn-sm" onClick=${exportar}>Exportar planilha</button>` : null}</div>
      ${lista.length ? html`<div class="lista">${lista.slice(0, lim).map(p => { const baixo = estoqueBaixo(p); return html`<button type="button" key=${p.id} class=${"linha linha-prod" + (p.ativo === false ? " inativo" : "")} onClick=${() => setEd(p)}>
        <span class="cod">${p.codigo}</span>
        <span class="meio"><strong>${p.descricao}</strong><span>${[p.tipo === "servico" ? (p.cobranca === "hora" ? "Serviço por hora" : "Serviço") : null, p.referencia, p.marca, p.categoria, p.localizacao ? "local " + p.localizacao : null].filter(Boolean).join(" · ")}</span></span>
        <span class="dir">${ver ? html`<b>${p.tipo === "servico" && p.cobranca === "hora" ? qtdFmt(p.horas) + " h" : Number(p.preco_vista) ? reais(p.preco_vista) : html`<span class="c-warn">sem preço</span>`}</b>` : null}
          ${p.tipo === "produto" && p.controla_estoque ? html`<small class=${baixo ? "c-bad" : Number(p.estoque_atual) <= 0 ? "c-warn" : ""}>${qtdFmt(p.estoque_atual)} ${p.unidade}${baixo ? " · baixo" : ""}</small>` : null}</span></button>`; })}</div>
        ${lista.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 200)}>Mostrar mais (${lista.length - lim})</button>` : null}`
        : html`<${Vazio}>Nenhum item encontrado.</${Vazio}>`}
    </section>
    ${ed ? html`<${FormProduto} inicial=${ed} onFechar=${() => setEd(null)} onSalvo=${() => setEd(null)} />` : null}`;
}
