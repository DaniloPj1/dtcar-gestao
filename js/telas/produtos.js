// Cadastro de produtos e serviços (modelo do OS Oficina 3.0) e controle de estoque
import { html, useState, useEffect, useMemo } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Area, Seg, Modal, Vazio, Dinheiro, useVisao, TrocaVisao } from "../ui.js";
import { norm, reais, qtdFmt, fmtDataHora, parseValor, precoPelaMargem, margemDoPreco, arred } from "../util.js";
import { pode, UNIDADES, TABELAS_PRECO, gruposDeProdutos, grupoCanonico, chaveGrupo } from "../regras.js";
import { linkImagem } from "../nfe.js";
import { BuscaFornecedor } from "./financeiro.js";

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
  const servico = p.tipo === "servico", terceiro = p.tipo === "terceiro", produto = p.tipo === "produto";
  const NOMES = { produto: "Produto / peça", servico: "Serviço / mão de obra", terceiro: "Serviço de terceiro" };
  const mudarTipo = t => set({ tipo: t, unidade: t === "produto" ? (p.unidade === "SERV" ? "UN" : p.unidade) : "SERV",
    ...(t === "terceiro" && !p.id && !Number(p.margem_vista) ? { margem_vista: Number(cfg.markupTerceiros) || 0, margem_prazo: Number(cfg.markupTerceiros) || 0, margem_atacado: Number(cfg.markupTerceiros) || 0 } : {}) });
  const listas = useMemo(() => ({ cat: gruposDeProdutos(dados.produtos, cfg).map(g => g.nome), marca: [...new Set(dados.produtos.map(x => x.marca).filter(Boolean))].sort() }), [dados.produtos, cfg.gruposProduto]);
  const mudarCusto = c => { const o = { custo: c }; for (const t of ["vista", "prazo", "atacado"]) if (Number(p["margem_" + t]) > 0) o["preco_" + t] = precoPelaMargem(c, p["margem_" + t]); else if (c > 0) o["margem_" + t] = margemDoPreco(c, p["preco_" + t]); set(o); };
  const linhaPreco = t => html`<div class="linha-preco" key=${t}><span>${TABELAS_PRECO[t]}</span>
    <div class="inp-suf"><input id=${"p-m-" + t} class="inp" inputmode="decimal" aria-label=${"Margem " + TABELAS_PRECO[t]} value=${String(p["margem_" + t] ?? "").replace(".", ",")}
      onInput=${e => { const m = parseValor(e.target.value); set({ ["margem_" + t]: m, ...(Number(p.custo) > 0 ? { ["preco_" + t]: precoPelaMargem(p.custo, m) } : {}) }); }} /><span>%</span></div>
    <${Dinheiro} id=${"p-v-" + t} valor=${p["preco_" + t]} onMuda=${v => set({ ["preco_" + t]: v, ...(Number(p.custo) > 0 ? { ["margem_" + t]: margemDoPreco(p.custo, v) } : {}) })} /></div>`;
  const salvar = async () => {
    if (!p.descricao.trim()) return setErro("Informe a descrição.");
    if (terceiro && !(Number(p.custo) > 0)) return setErro("Informe quanto o prestador cobra (custo).");
    if (!servico && Number(p.custo) > 0 && ["vista", "prazo", "atacado"].some(t => Number(p["preco_" + t]) > 0 && Number(p["preco_" + t]) < Number(p.custo)))
      if (!await confirmar({ titulo: "Margem negativa", texto: "Algum preço de venda está abaixo do custo. Salvar mesmo assim?", botao: "Salvar" })) return;
    const { id, codigo, criado_em, atualizado_em, ...resto } = p;
    const reg = { ...resto, descricao: p.descricao.trim(), unidade: (p.unidade || "UN").toUpperCase(), categoria: grupoCanonico(p.categoria, gruposDeProdutos(dados.produtos, cfg)), controla_estoque: produto && p.controla_estoque, avisar_estoque_baixo: produto && p.avisar_estoque_baixo, fornecedor_id: terceiro ? p.fornecedor_id || null : p.fornecedor_id || null,
      preco_prazo: Number(p.preco_prazo) || Number(p.preco_vista) || 0, preco_atacado: Number(p.preco_atacado) || Number(p.preco_vista) || 0 };
    if (id) delete reg.estoque_atual; // saldo só muda por movimento de estoque
    try { const r = await api.produtos.salvar(id ? { id, ...reg } : reg); avisar(produto ? "Produto salvo." : "Serviço salvo."); await recarregar(["produtos"]); onSalvo ? onSalvo(r) : onFechar(); }
    catch (e) { setErro(e.message); }
  };
  const excluir = async () => {
    if (!await confirmar({ titulo: "Excluir " + (produto ? "produto" : "serviço"), texto: "Se ele já foi usado em O.S., prefira desmarcar “Ativo”: as O.S. antigas continuam com a descrição, mas perdem o vínculo com o cadastro.", botao: "Excluir", perigo: true })) return;
    try { await api.produtos.excluir(p.id); avisar("Excluído."); recarregar(["produtos"], { completo: true }); onFechar(); } catch (e) { setErro(e.message); }
  };
  if (estoque) return html`<${EstoqueModal} produto=${p} onFechar=${async novo => { setEstoque(false); if (novo !== undefined) set({ estoque_atual: novo }); }} />`;
  return html`<${Modal} titulo=${(p.id ? "Cadastro de " : "Novo ") + (terceiro ? "serviço de terceiro" : servico ? "serviço" : "produto")} largo onFechar=${onFechar}>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <fieldset disabled=${!podeEd} class="sem-borda form-ficha">
      <div class="grade ficha-topo">
        <${Campo} id="p-codigo" rotulo="Código"><input id="p-codigo" class="inp" disabled value=${p.id ? p.codigo : "automático"} /></${Campo}>
        <div class="campo"><label>Tipo</label><${Seg} rotulo="Tipo" opcoes=${Object.values(NOMES).map(t => [t, "info"])} valor=${NOMES[p.tipo]} onEscolha=${v => mudarTipo(Object.keys(NOMES).find(k => NOMES[k] === v))} /></div>
      </div>
      <${Campo} id="p-desc" rotulo="Descrição" obrig><${Texto} id="p-desc" valor=${p.descricao} onMuda=${v => set({ descricao: v })} /></${Campo}>
      ${terceiro ? html`<div class="campo"><label for="p-prest">Prestador padrão</label><${BuscaFornecedor} id="p-prest" somentePrestador permitirTexto=${false} valor=${p.fornecedor_id} onEscolha=${f => set({ fornecedor_id: f ? f.id : null })} />
        <span class="dica">Quem executa o serviço (retífica, torno, guincho). Na O.S. dá para trocar.</span></div>` : null}
      ${produto && (p.referencia || p.descricao) ? html`<a class="btn-link" href=${linkImagem(p.referencia, p.marca, p.referencia ? "" : p.descricao)} target="_blank" rel="noopener">Ver imagem do produto no Google</a>` : null}
      ${produto ? html`<div class="grade">
        <${Campo} id="p-ref" rotulo="Referência / código do fabricante"><${Texto} id="p-ref" valor=${p.referencia} onMuda=${v => set({ referencia: v })} /></${Campo}>
        <${Campo} id="p-barra" rotulo="Código de barras"><${Texto} id="p-barra" inputmode="numeric" valor=${p.codigo_barras} onMuda=${v => set({ codigo_barras: v })} /></${Campo}>
        <${Campo} id="p-marca" rotulo="Marca"><${Texto} id="p-marca" list="p-marcas" valor=${p.marca} onMuda=${v => set({ marca: v })} /><datalist id="p-marcas">${listas.marca.map(x => html`<option value=${x} />`)}</datalist></${Campo}>
        <${Campo} id="p-un" rotulo="Unidade"><${Texto} id="p-un" list="p-uns" valor=${p.unidade} onMuda=${v => set({ unidade: v.toUpperCase().slice(0, 6) })} /><datalist id="p-uns">${UNIDADES.map(x => html`<option value=${x} />`)}</datalist></${Campo}>
        <${Campo} id="p-loc" rotulo="Localização física"><${Texto} id="p-loc" placeholder="ex.: prateleira 3" valor=${p.localizacao} onMuda=${v => set({ localizacao: v })} /></${Campo}>
      </div>` : null}
      <${Campo} id="p-cat" rotulo="Grupo / categoria"><${Texto} id="p-cat" list="p-cats" valor=${p.categoria} onMuda=${v => set({ categoria: v })} /><datalist id="p-cats">${listas.cat.map(x => html`<option value=${x} />`)}</datalist></${Campo}>
      ${terceiro ? null : produto ? html`<h4 class="sub-titulo">Estoque</h4>
        <div class="grade">
          <${Campo} id="p-min" rotulo="Estoque mínimo"><input id="p-min" class="inp" inputmode="decimal" value=${String(p.estoque_min ?? "").replace(".", ",")} onInput=${e => set({ estoque_min: parseValor(e.target.value) })} /></${Campo}>
          <${Campo} id="p-atual" rotulo=${p.id ? "Estoque atual" : "Estoque inicial"} dica=${p.id ? "Altere pelo botão Movimentar estoque." : ""}>
            <input id="p-atual" class="inp" inputmode="decimal" disabled=${!!p.id} value=${String(p.estoque_atual ?? "").replace(".", ",")} onInput=${e => set({ estoque_atual: parseValor(e.target.value) })} /></${Campo}>
          ${p.id && ver ? html`<div class="campo"><label>&nbsp;</label><button type="button" class="btn" onClick=${() => setEstoque(true)}>Movimentar estoque</button></div>` : null}
        </div>
        <label class="linha-check"><input type="checkbox" checked=${p.controla_estoque} onChange=${e => set({ controla_estoque: e.target.checked })} /><span>Controlar estoque (sai do estoque quando entra na O.S.)</span></label>
        <label class="linha-check"><input type="checkbox" checked=${p.avisar_estoque_baixo} onChange=${e => set({ avisar_estoque_baixo: e.target.checked })} /><span>Avisar no painel quando o estoque ficar no mínimo</span></label>
        <label class="linha-check"><input type="checkbox" checked=${p.vender_sem_estoque} onChange=${e => set({ vender_sem_estoque: e.target.checked })} /><span>Permitir lançar na O.S. mesmo sem estoque</span></label>` : html`
        <div class="campo"><label>Cobrança</label><${Seg} rotulo="Cobrança" opcoes=${[["Preço fechado", "info"], ["Por hora", "info"]]} valor=${p.cobranca === "hora" ? "Por hora" : "Preço fechado"} onEscolha=${v => set({ cobranca: v === "Por hora" ? "hora" : "fixo" })} /></div>
        ${p.cobranca === "hora" ? html`<${Campo} id="p-horas" rotulo="Tempo padrão (horas)" dica=${"No orçamento: horas × valor-hora (" + reais(cfg.valorHora || 0) + "/h, definido em Ajustes)."}><input id="p-horas" class="inp" inputmode="decimal" value=${String(p.horas || "").replace(".", ",")} onInput=${e => set({ horas: parseValor(e.target.value) })} /></${Campo}>` : null}`}
      ${ver && !(servico && p.cobranca === "hora") ? html`<h4 class="sub-titulo">Preços</h4>
        ${!servico ? html`<${Campo} id="p-custo" rotulo=${terceiro ? "Quanto o prestador cobra (custo)" : "Preço de custo"}><${Dinheiro} id="p-custo" valor=${p.custo} onMuda=${mudarCusto} /></${Campo}>` : null}
        <div class="tabela-precos">${!servico ? html`<div class="linha-preco cab"><span>Tabela</span><span>Margem sobre o custo</span><span>Preço de venda</span></div>` : null}
          ${servico ? html`<${Campo} id="p-v-vista" rotulo="Preço"><${Dinheiro} id="p-v-vista" valor=${p.preco_vista} onMuda=${v => set({ preco_vista: v, preco_prazo: v, preco_atacado: v })} /></${Campo}>` : ["vista", "prazo", "atacado"].map(linhaPreco)}</div>
        ${!servico && Number(p.custo) > 0 && Number(p.preco_vista) > 0 && Number(p.preco_vista) < Number(p.custo) ? html`<span class="dica erro">Atenção: o preço à vista está abaixo do custo (margem negativa).</span>` : null}
        ${terceiro && Number(p.custo) > 0 && Number(p.preco_vista) > 0 ? html`<div class="total-item"><span>Lucro da oficina à vista</span><b>${reais(Number(p.preco_vista) - Number(p.custo))} · ${pct(margemDoPreco(p.custo, p.preco_vista))}% sobre o custo</b></div>` : null}` : null}
      <${Campo} id="p-obs" rotulo=${produto ? "Aplicação / observações" : "Observações"}><${Area} id="p-obs" placeholder=${produto ? "ex.: GOL G1 1.8 8V; GOL G2 1.6 8V" : ""} valor=${p.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
      <label class="linha-check"><input type="checkbox" checked=${p.ativo !== false} onChange=${e => set({ ativo: e.target.checked })} /><span>Ativo (aparece na busca da O.S.)</span></label>
    </fieldset>
    ${p.id && produto ? html`<${FornecedoresDoProduto} id=${p.id} />` : null}
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
const LS_FILTROS_PROD = "dtcar-prod-filtros";
const FILTROS_PROD = { q: "", tipo: "todos", grupo: "", marca: "", sit: "" };
/** Situações do estoque (só produtos com controle de estoque entram em "com/sem estoque" e "abaixo do mínimo") */
const SITUACOES_PROD = [["", "Todas"], ["com", "Com estoque"], ["sem", "Sem estoque"], ["minimo", "Abaixo do mínimo"], ["inativos", "Inativos"]];
const SEM_GRUPO = "__sem__";
export const passaSituacao = (p, sit) => {
  if (sit === "inativos") return p.ativo === false;
  if (p.ativo === false) return false;
  if (!sit) return true;
  const est = p.tipo === "produto" && p.controla_estoque, n = Number(p.estoque_atual) || 0;
  if (sit === "com") return est && n > 0;
  if (sit === "sem") return est && n <= 0;
  if (sit === "minimo") return est && Number(p.estoque_min) > 0 && n <= Number(p.estoque_min);
  return true;
};
export const valorCusto = l => l.reduce((s, p) => s + (p.tipo === "produto" ? Math.max(0, Number(p.estoque_atual) || 0) * (Number(p.custo) || 0) : 0), 0);

export function ProdutosLista() {
  const { dados, perfil, ir, cfg, avisar, confirmar, recarregar } = useApp();
  const [f, setF] = useState(() => { try { return { ...FILTROS_PROD, ...(JSON.parse(localStorage.getItem(LS_FILTROS_PROD) || "null") || {}) }; } catch (e) { return { ...FILTROS_PROD }; } });
  const muda = o => setF(x => { const n = { ...x, ...o }; try { localStorage.setItem(LS_FILTROS_PROD, JSON.stringify(n)); } catch (e) {} return n; });
  const [ed, setEd] = useState(null), [lim, setLim] = useState(80), [marcados, setMarcados] = useState([]), [grupos, setGrupos] = useState(false), [defGrupo, setDefGrupo] = useState(null);
  const ver = pode(perfil, "verValores"), podeCad = pode(perfil, "cadastrar");
  const [visao, setVisao, largo] = useVisao("produtos");
  const q = f.q, filtro = f.tipo;
  useEffect(() => { setLim(80); setMarcados([]); }, [q, filtro, f.grupo, f.marca, f.sit]);
  const todosGrupos = useMemo(() => gruposDeProdutos(dados.produtos, cfg), [dados.produtos, cfg.gruposProduto]);
  const passaTipo = p => (filtro === "produto" || filtro === "servico" || filtro === "terceiro") ? p.tipo === filtro : true;
  const passaTexto = p => { const n = norm(q), cod = /^\d+$/.test(q.trim()) ? +q.trim() : null; return !n || p.codigo === cod || norm(p.descricao).includes(n) || norm(p.referencia).includes(n) || norm(p.marca).includes(n) || norm(p.categoria).includes(n) || norm(p.obs).includes(n) || (p.codigo_barras && p.codigo_barras === q.trim()); };
  const passaGrupo = p => !f.grupo || (f.grupo === SEM_GRUPO ? !chaveGrupo(p.categoria) : chaveGrupo(p.categoria) === f.grupo);
  const passaMarca = p => !f.marca || norm(p.marca) === norm(f.marca);
  // os filtros combinam entre si e com a busca; cada seletor conta com os OUTROS filtros aplicados
  const base = useMemo(() => dados.produtos.filter(p => passaTipo(p) && passaTexto(p) && passaSituacao(p, f.sit)), [dados.produtos, q, filtro, f.sit]);
  const lista = useMemo(() => base.filter(p => passaGrupo(p) && passaMarca(p)).sort((a, b) => a.descricao.localeCompare(b.descricao)), [base, f.grupo, f.marca]);
  const contaGrupos = useMemo(() => { const m = new Map(); let sem = 0; for (const p of base.filter(passaMarca)) { const k = chaveGrupo(p.categoria); if (k) m.set(k, (m.get(k) || 0) + 1); else sem++; }
    return { m, sem }; }, [base, f.marca]);
  const marcas = useMemo(() => { const m = new Map(); for (const p of base.filter(passaGrupo)) if (p.marca) { const k = norm(p.marca); const a = m.get(k) || { nome: p.marca, n: 0 }; a.n++; m.set(k, a); }
    if (f.marca && !m.has(norm(f.marca))) m.set(norm(f.marca), { nome: f.marca, n: 0 }); return [...m.values()].sort((a, b) => a.nome.localeCompare(b.nome)); }, [base, f.grupo, f.marca]);
  const valorEstoque = useMemo(() => valorCusto(lista), [lista]);
  const nBaixo = dados.produtos.filter(estoqueBaixo).length;
  const ativos = ["q", "grupo", "marca", "sit"].filter(k => f[k]).length + (filtro !== "todos" ? 1 : 0);
  const exportar = () => {
    const esc = v => '"' + String(v ?? "").replace(/"/g, '""') + '"', n2 = v => String(Number(v || 0).toFixed(2)).replace(".", ",");
    const linhas = [["Código", "Tipo", "Descrição", "Referência", "Marca", "Grupo", "Unidade", "Localização", "Estoque", "Mínimo", "Custo", "À vista", "A prazo", "Atacado"].map(esc).join(";")];
    for (const p of lista) linhas.push([p.codigo, { servico: "Serviço", terceiro: "Serviço de terceiro" }[p.tipo] || "Produto", p.descricao, p.referencia, p.marca, p.categoria, p.unidade, p.localizacao, String(p.estoque_atual).replace(".", ","), String(p.estoque_min).replace(".", ","), n2(p.custo), n2(p.preco_vista), n2(p.preco_prazo), n2(p.preco_atacado)].map(esc).join(";"));
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "produtos-dtcar-" + new Date().toISOString().slice(0, 10) + ".csv"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000);
  };
  const marcar = (id, on) => setMarcados(m => on ? [...new Set([...m, id])] : m.filter(x => x !== id));
  const todosMarcados = lista.length > 0 && lista.slice(0, lim).every(p => marcados.includes(p.id));
  const aplicarGrupo = async nome => {
    const cat = grupoCanonico(nome, todosGrupos);
    try { const n = await api.produtos.trocarGrupo({ ids: marcados, para: cat }); avisar(n + " produto(s) agora no grupo " + (cat || "“Sem grupo”") + "."); setDefGrupo(null); setMarcados([]); await recarregar(["produtos"]); }
    catch (e) { avisar("Não foi possível mudar o grupo: " + e.message, true); }
  };
  const relatorio = () => { const u = new URLSearchParams(); if (f.grupo) u.set("grupo", f.grupo); if (f.marca) u.set("marca", f.marca); if (f.sit && f.sit !== "inativos") u.set("sit", f.sit); if (q) u.set("q", q); ir("/relatorios?r=estoque&" + u.toString()); };
  const linhaCheck = p => podeCad ? html`<input type="checkbox" class="prod-check" aria-label=${"Marcar " + p.descricao} checked=${marcados.includes(p.id)} onClick=${e => e.stopPropagation()} onChange=${e => marcar(p.id, e.target.checked)} />` : null;
  return html`
    <div class="linha-add"><input id="busca-prod" class="inp" aria-label="Buscar produto" placeholder="Descrição, código, referência, marca ou aplicação" value=${q} onInput=${e => muda({ q: e.target.value })} />
      ${podeCad ? html`<button type="button" class="btn" onClick=${() => ir("/nfe")}>Entrada de nota (XML)</button><button type="button" class="btn btn-pri" onClick=${() => setEd({ tipo: ["servico", "terceiro"].includes(filtro) ? filtro : "produto", unidade: ["servico", "terceiro"].includes(filtro) ? "SERV" : "UN", ...(filtro === "terceiro" ? { margem_vista: Number(cfg.markupTerceiros) || 0, margem_prazo: Number(cfg.markupTerceiros) || 0, margem_atacado: Number(cfg.markupTerceiros) || 0 } : {}) })}>+ Novo</button>` : null}</div>
    <div class="chips rolagem" role="group" aria-label="Tipo">${[["todos", "Todos"], ["produto", "Produtos / peças"], ["servico", "Serviços"], ["terceiro", "Terceiros"]].map(([k, t]) => html`<button type="button" key=${k} class=${"chip-f" + (filtro === k ? " ativo" : "")} onClick=${() => muda({ tipo: k })}>${t}</button>`)}</div>
    <div class="prod-filtros">
      <label class="filtro"><span>Grupo</span><select id="prod-grupo" class="inp" value=${f.grupo} onChange=${e => muda({ grupo: e.target.value })}><option value="">Todos os grupos</option>
        ${todosGrupos.map(g => html`<option value=${g.chave}>${g.nome} (${contaGrupos.m.get(g.chave) || 0})</option>`)}<option value=${SEM_GRUPO}>Sem grupo (${contaGrupos.sem})</option></select></label>
      <label class="filtro"><span>Marca</span><select id="prod-marca" class="inp" value=${f.marca} onChange=${e => muda({ marca: e.target.value })}><option value="">Todas as marcas</option>${marcas.map(m => html`<option value=${m.nome}>${m.nome} (${m.n})</option>`)}</select></label>
      <label class="filtro"><span>Situação</span><select id="prod-sit" class="inp" value=${f.sit} onChange=${e => muda({ sit: e.target.value })}>${SITUACOES_PROD.map(([k, t]) => html`<option value=${k}>${t}${k === "minimo" && nBaixo ? " (" + nBaixo + " com aviso)" : ""}</option>`)}</select></label>
      ${ativos ? html`<button type="button" class="btn btn-sm" onClick=${() => muda({ ...FILTROS_PROD })}>Limpar filtros (${ativos})</button>` : null}
      ${podeCad ? html`<button type="button" class="btn btn-sm" onClick=${() => setGrupos(true)}>Grupos…</button>` : null}
    </div>
    <section class="card"><div class="secao-topo prod-total"><h3>${lista.length} item(ns)${ativos ? " no filtro" : ""}</h3>${ver ? html`<span class="sub">Estoque a custo${ativos ? " (filtro)" : ""}: <b class="prod-custo">${reais(valorEstoque)}</b></span><button type="button" class="btn btn-sm" onClick=${exportar}>Exportar planilha</button><button type="button" class="btn btn-sm" onClick=${relatorio}>Relatório / imprimir</button>` : null}${largo ? html`<${TrocaVisao} visao=${visao} onTroca=${setVisao} />` : null}</div>
      ${marcados.length ? html`<div class="prod-marcados" role="status"><b>${marcados.length}</b> marcado(s)<button type="button" class="btn btn-sm btn-pri" onClick=${() => setDefGrupo("")}>Definir grupo</button><button type="button" class="btn btn-sm" onClick=${() => setMarcados([])}>Desmarcar</button></div>` : null}
      ${lista.length && visao === "tabela" ? html`<div class="grade-dados"><table><thead><tr>${podeCad ? html`<th><input type="checkbox" aria-label="Marcar todos" checked=${todosMarcados} onChange=${e => setMarcados(e.target.checked ? lista.slice(0, lim).map(p => p.id) : [])} /></th>` : null}<th>Código</th><th>Referência</th><th>Descrição do produto / serviço</th><th>Un</th>
          ${ver ? html`<th class="num">Vl. à vista</th><th class="num">Vl. a prazo</th>` : null}<th class="num">Estoque</th><th>Grupo / categoria</th><th>Marca</th><th>Localização</th></tr></thead>
        <tbody>${lista.slice(0, lim).map(p => { const est = p.tipo === "produto" && p.controla_estoque, baixo = estoqueBaixo(p), zerado = est && Number(p.estoque_atual) <= 0;
          return html`<tr key=${p.id} tabindex="0" class=${p.ativo === false ? "g-inativo" : ""} onClick=${() => setEd(p)} onKeyDown=${e => e.key === "Enter" && setEd(p)}>
          ${podeCad ? html`<td class="prod-td-check">${linhaCheck(p)}</td>` : null}<td class="mono">${p.codigo}</td><td class="mono">${p.referencia || ""}</td><td>${p.descricao}</td><td>${p.unidade}</td>
          ${ver ? html`<td class="num">${Number(p.preco_vista) ? reais(p.preco_vista) : ""}</td><td class="num">${Number(p.preco_prazo) ? reais(p.preco_prazo) : ""}</td>` : null}
          <td class="num"><span class=${zerado ? "c-bad" : baixo ? "c-warn" : ""}>${est ? qtdFmt(p.estoque_atual) : p.tipo === "produto" ? "—" : "serviço"}</span></td><td>${p.categoria || ""}</td><td>${p.marca || ""}</td><td>${p.localizacao || ""}</td></tr>`; })}</tbody></table></div>
        ${lista.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 200)}>Mostrar mais (${lista.length - lim})</button>` : null}`
      : lista.length ? html`<div class="lista">${lista.slice(0, lim).map(p => { const baixo = estoqueBaixo(p); return html`<div key=${p.id} class=${"linha linha-prod" + (p.ativo === false ? " inativo" : "")}>
        ${linhaCheck(p)}<button type="button" class="linha-prod-abrir" onClick=${() => setEd(p)}>
        <span class="cod">${p.codigo}</span>
        <span class="meio"><strong>${p.descricao}</strong><span>${[p.tipo === "servico" ? (p.cobranca === "hora" ? "Serviço por hora" : "Serviço") : p.tipo === "terceiro" ? "Terceiro" + ((dados.fornecedores.find(f => f.id === p.fornecedor_id) || {}).razao ? " · " + (dados.fornecedores.find(f => f.id === p.fornecedor_id).fantasia || dados.fornecedores.find(f => f.id === p.fornecedor_id).razao) : "") : null, p.referencia, p.marca, p.categoria, p.localizacao ? "local " + p.localizacao : null].filter(Boolean).join(" · ")}</span></span>
        <span class="dir">${ver ? html`<b>${p.tipo === "servico" && p.cobranca === "hora" ? qtdFmt(p.horas) + " h" : Number(p.preco_vista) ? reais(p.preco_vista) : html`<span class="c-warn">sem preço</span>`}</b>` : null}
          ${p.tipo === "produto" && p.controla_estoque ? html`<small class=${baixo ? "c-bad" : Number(p.estoque_atual) <= 0 ? "c-warn" : ""}>${qtdFmt(p.estoque_atual)} ${p.unidade}${baixo ? " · baixo" : ""}</small>` : null}</span></button></div>`; })}</div>
        ${lista.length > lim ? html`<button type="button" class="btn" onClick=${() => setLim(lim + 200)}>Mostrar mais (${lista.length - lim})</button>` : null}`
        : html`<${Vazio}>${ativos ? "Nenhum item com esses filtros." : "Nenhum item encontrado."}</${Vazio}>`}
    </section>
    ${ed ? html`<${FormProduto} inicial=${ed} onFechar=${() => setEd(null)} onSalvo=${() => setEd(null)} />` : null}
    ${grupos ? html`<${GruposModal} onFechar=${() => setGrupos(false)} />` : null}
    ${defGrupo !== null ? html`<${Modal} titulo=${"Definir grupo de " + marcados.length + " produto(s)"} onFechar=${() => setDefGrupo(null)}>
      <${Campo} id="def-grupo" rotulo="Grupo" dica="Escolha um grupo da lista ou digite um nome novo. Em branco tira o grupo."><${Texto} id="def-grupo" list="def-grupos" valor=${defGrupo} onMuda=${setDefGrupo} /><datalist id="def-grupos">${todosGrupos.map(g => html`<option value=${g.nome} />`)}</datalist></${Campo}>
      <div class="acoes-modal"><button type="button" class="btn" onClick=${() => setDefGrupo(null)}>Cancelar</button><button type="button" class="btn btn-pri" onClick=${() => aplicarGrupo(defGrupo)}>Aplicar</button></div></${Modal}>` : null}`;
}

/* ---------------- cadastro dos grupos: criar, renomear, juntar ---------------- */
export function GruposModal({ onFechar }) {
  const { dados, cfg, avisar, confirmar, recarregar } = useApp();
  const grupos = useMemo(() => gruposDeProdutos(dados.produtos, cfg), [dados.produtos, cfg.gruposProduto]);
  const [novo, setNovo] = useState(""), [ren, setRen] = useState(null), [nome, setNome] = useState(""), [juntar, setJuntar] = useState(null), [alvo, setAlvo] = useState(""), [erro, setErro] = useState(""), [ocupado, setOcupado] = useState(false);
  // a lista oficial de nomes (cfg.gruposProduto) guarda a grafia escolhida e os grupos ainda sem produto
  const salvarLista = async lista => { await api.salvarConfig({ ...cfg, gruposProduto: [...new Map(lista.map(n => [chaveGrupo(n), String(n).trim()])).values()].filter(Boolean).sort((a, b) => a.localeCompare(b)) }); };
  const grafias = g => [...new Set(dados.produtos.map(p => p.categoria).filter(c => chaveGrupo(c) === g.chave))];
  const criar = async () => { const n = novo.trim(); if (!n) return;
    if (grupos.some(g => g.chave === chaveGrupo(n))) return setErro("Já existe o grupo “" + grupos.find(g => g.chave === chaveGrupo(n)).nome + "” (a diferença é só maiúscula, acento ou espaço).");
    setOcupado(true); try { await salvarLista([...grupos.map(g => g.nome), n]); await recarregar(["config"]); setNovo(""); avisar("Grupo criado."); } catch (e) { setErro(e.message); } setOcupado(false); };
  const renomear = async g => { const n = nome.trim(); if (!n) return setErro("Informe o nome.");
    const outro = grupos.find(x => x.chave === chaveGrupo(n) && x.chave !== g.chave); if (outro) return setErro("Já existe o grupo “" + outro.nome + "”. Para juntar os dois, use “Juntar”.");
    // a lista oficial vai primeiro: o gatilho do banco (v51) troca o nome digitado pela grafia oficial, e ela precisa ser a nova
    setOcupado(true); try { await salvarLista([...grupos.filter(x => x.chave !== g.chave).map(x => x.nome), n]); const k = await api.produtos.trocarGrupo({ de: grafias(g), para: n }); await recarregar(["produtos", "config"]); setRen(null); avisar("Grupo renomeado" + (k ? " em " + k + " produto(s)." : ".")); }
    catch (e) { setErro(e.message); } setOcupado(false); };
  const juntarEm = async g => { const d = grupos.find(x => x.chave === alvo); if (!d) return setErro("Escolha o grupo de destino.");
    if (!await confirmar({ titulo: "Juntar grupos", texto: "Os " + g.nTotal + " produto(s) de “" + g.nome + "” passam para “" + d.nome + "” e o grupo “" + g.nome + "” deixa de existir.", botao: "Juntar" })) return;
    setOcupado(true); try { const k = await api.produtos.trocarGrupo({ de: grafias(g), para: d.nome }); await salvarLista(grupos.filter(x => x.chave !== g.chave).map(x => x.nome)); await recarregar(["produtos", "config"]); setJuntar(null); avisar(k + " produto(s) passaram para " + d.nome + "."); }
    catch (e) { setErro(e.message); } setOcupado(false); };
  const excluir = async g => { if (g.nTotal) return setErro("O grupo tem produtos: renomeie ou junte com outro.");
    setOcupado(true); try { await salvarLista(grupos.filter(x => x.chave !== g.chave).map(x => x.nome)); await recarregar(["config"]); avisar("Grupo excluído."); } catch (e) { setErro(e.message); } setOcupado(false); };
  const semGrupo = dados.produtos.filter(p => p.ativo !== false && p.tipo === "produto" && !chaveGrupo(p.categoria)).length;
  return html`<${Modal} titulo="Grupos de produtos" onFechar=${onFechar} largo>
    <p class="sub">O grupo é o campo “Grupo / categoria” do produto. Renomear ou juntar muda todos os produtos do grupo de uma vez. Nomes que só diferem em maiúscula, acento ou espaço contam como o mesmo grupo.${semGrupo ? html` <b>${semGrupo} produto(s) sem grupo.</b>` : null}</p>
    ${erro ? html`<div class="erros">${erro}</div>` : null}
    <div class="linha-add"><input id="grupo-novo" class="inp" placeholder="Novo grupo (ex.: Freios)" value=${novo} onInput=${e => { setNovo(e.target.value); setErro(""); }} onKeyDown=${e => e.key === "Enter" && criar()} /><button type="button" class="btn btn-pri" disabled=${ocupado || !novo.trim()} onClick=${criar}>Criar grupo</button></div>
    <div class="lista grupos-lista">${grupos.map(g => html`<div class="linha" key=${g.chave}>
      ${ren === g.chave ? html`<span class="meio grupo-edita"><input class="inp" aria-label="Novo nome" value=${nome} onInput=${e => { setNome(e.target.value); setErro(""); }} onKeyDown=${e => e.key === "Enter" && renomear(g)} /><button type="button" class="btn btn-sm btn-pri" disabled=${ocupado} onClick=${() => renomear(g)}>Salvar</button><button type="button" class="btn btn-sm" onClick=${() => setRen(null)}>Cancelar</button></span>`
      : juntar === g.chave ? html`<span class="meio grupo-edita"><span>Juntar “${g.nome}” em</span><select class="inp" aria-label="Grupo de destino" value=${alvo} onChange=${e => setAlvo(e.target.value)}><option value="">Escolha…</option>${grupos.filter(x => x.chave !== g.chave).map(x => html`<option value=${x.chave}>${x.nome} (${x.nTotal})</option>`)}</select><button type="button" class="btn btn-sm btn-pri" disabled=${ocupado || !alvo} onClick=${() => juntarEm(g)}>Juntar</button><button type="button" class="btn btn-sm" onClick=${() => setJuntar(null)}>Cancelar</button></span>`
      : html`<span class="meio"><strong>${g.nome}</strong><span>${g.nTotal} produto(s)${grafias(g).length > 1 ? " · grafias no cadastro: " + grafias(g).join(", ") : ""}${g.nTotal ? " · estoque a custo " + reais(g.custo) : ""}</span></span>
        <span class="dir grupo-acoes"><button type="button" class="btn-link" onClick=${() => { setRen(g.chave); setNome(g.nome); setJuntar(null); setErro(""); }}>Renomear</button><button type="button" class="btn-link" onClick=${() => { setJuntar(g.chave); setAlvo(""); setRen(null); setErro(""); }}>Juntar</button>${!g.nTotal ? html`<button type="button" class="btn-link perigo" onClick=${() => excluir(g)}>Excluir</button>` : null}</span>`}
    </div>`)}${!grupos.length ? html`<${Vazio}>Nenhum grupo ainda.</${Vazio}>` : null}</div>
  </${Modal}>`;
}
