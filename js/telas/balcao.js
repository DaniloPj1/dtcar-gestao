// Venda de balcão: peças e serviços sem O.S., com baixa de estoque, recibo e comprovante
import { html, useState, useEffect, useMemo, useRef } from "../lib.js";
import { api } from "../api.js";
import { useApp, Campo, Texto, Seg, Modal, Vazio, Dinheiro, BuscaCliente, Abas } from "../ui.js";
import { norm, soDig, reais, qtdFmt, fmtDataHora, fmtDoc, uuid, arred, precoTabela, totalItem, hojeISO, lsGet, lsSet, parseValor } from "../util.js";
import { pode, TABELAS_PRECO } from "../regras.js";
import { ReciboModal } from "./recibos.js";

const LS = "dtcar-balcao-v1";
const vazio = () => ({ itens: [], clienteId: "", nomeAvulso: "", docAvulso: "", tabela: "vista", desconto: 0, forma: "", obs: "" });

function Venda() {
  const { dados, cfg, perfil, avisar, recarregar, ir } = useApp();
  const [v, setV] = useState(() => ({ ...vazio(), ...(lsGet(LS) || {}) }));
  const [q, setQ] = useState(""), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false), [feita, setFeita] = useState(null), [recibo, setRecibo] = useState(false), [avulso, setAvulso] = useState(null);
  const busca = useRef(null);
  useEffect(() => { lsSet(LS, v); }, [v]);
  const set = o => { setV(x => ({ ...x, ...o })); setErro(""); };
  const cli = dados.clientes.find(c => c.id === v.clienteId);
  const res = useMemo(() => { const n = norm(q), t = q.trim(), cod = /^\d+$/.test(t) ? +t : null; if (!n) return [];
    return dados.produtos.filter(p => p.ativo !== false && p.tipo !== "terceiro" && (p.codigo === cod || p.codigo_barras === t || norm(p.descricao).includes(n) || norm(p.referencia).includes(n) || norm(p.marca).includes(n) || norm(p.obs).includes(n))).slice(0, 10); }, [q, dados.produtos]);
  const adicionar = p => {
    setV(x => { const ex = x.itens.find(i => i.produto_id === p.id);
      if (ex) return { ...x, itens: x.itens.map(i => i === ex ? { ...i, qtd: Number(i.qtd) + 1 } : i) };
      return { ...x, itens: x.itens.concat([{ k: uuid(), produto_id: p.id, tipo: p.tipo, descricao: p.descricao, codigo: p.referencia || String(p.codigo), qtd: 1, valor_unit: p.tipo === "servico" && p.cobranca === "hora" ? arred((Number(p.horas) || 1) * (Number(cfg.valorHora) || 0)) : precoTabela(p, x.tabela), desconto: 0 }]) }; });
    setQ(""); setErro(""); busca.current && busca.current.focus();
  };
  const enter = e => { if (e.key !== "Enter") return; e.preventDefault(); const t = q.trim(); if (!t) return;
    const exato = dados.produtos.find(p => p.ativo !== false && (p.codigo_barras === t || String(p.codigo) === t || (p.referencia && norm(p.referencia) === norm(t))));
    if (exato) adicionar(exato); else if (res.length === 1) adicionar(res[0]); };
  const setItem = (k, o) => setV(x => ({ ...x, itens: x.itens.map(i => i.k === k ? { ...i, ...o } : i) }));
  const tirar = k => setV(x => ({ ...x, itens: x.itens.filter(i => i.k !== k) }));
  const trocarTabela = t => setV(x => ({ ...x, tabela: t, itens: x.itens.map(i => { const p = dados.produtos.find(y => y.id === i.produto_id); return p && p.tipo === "produto" ? { ...i, valor_unit: precoTabela(p, t) } : i; }) }));
  const sub = arred(v.itens.reduce((s, i) => s + totalItem(i), 0)), total = arred(Math.max(0, sub - (Number(v.desconto) || 0)));
  const faltas = v.itens.map(i => ({ i, p: dados.produtos.find(p => p.id === i.produto_id) })).filter(({ i, p }) => p && p.tipo === "produto" && p.controla_estoque && Number(p.estoque_atual) < Number(i.qtd));
  const finalizar = async () => {
    if (!v.itens.length) return setErro("Inclua pelo menos um item.");
    if (!v.forma) return setErro("Escolha a forma de pagamento.");
    if (v.itens.some(i => !(Number(i.qtd) > 0))) return setErro("Há item com quantidade zerada.");
    if (cli && cli.situacao === "bloqueado") return setErro("Cliente bloqueado: " + (cli.restricao || "verifique o cadastro") + ".");
    setSalvando(true);
    try {
      const cliente = cli ? { nome: cli.nome, doc: cli.doc || "", telefone: cli.telefone || "" } : { nome: v.nomeAvulso.trim() || "Consumidor", doc: soDig(v.docAvulso) };
      const r = await api.vendas.finalizar({ cliente_id: cli ? cli.id : null, cliente, tabela_preco: v.tabela, desconto: Number(v.desconto) || 0, forma_pagamento: v.forma, obs: v.obs.trim(),
        itens: v.itens.map(i => ({ produto_id: i.produto_id, tipo: i.tipo, descricao: i.descricao, codigo: i.codigo, qtd: Number(i.qtd), valor_unit: Number(i.valor_unit), desconto: Number(i.desconto) || 0 })) });
      setFeita(r); setV(vazio()); lsSet(LS, null); avisar("Venda " + String(r.numero).padStart(5, "0") + " concluída."); recarregar(["produtos"]);
    } catch (e) { setErro(e.message); } finally { setSalvando(false); }
  };
  if (feita) return html`<section class="card venda-ok"><h2>Venda ${String(feita.numero).padStart(5, "0")} concluída</h2>
    <div class="total-item"><span>${feita.cliente.nome} · ${feita.forma_pagamento}</span><b>${reais(feita.total)}</b></div>
    <div class="acoes">
      <button type="button" class="btn btn-pri" onClick=${() => ir("/imprimir/venda/" + feita.id)}>Imprimir comprovante (A4)</button>
      <button type="button" class="btn" onClick=${() => ir("/imprimir/venda/" + feita.id + "?formato=cupom")}>Cupom 80 mm</button>
      <button type="button" class="btn" onClick=${() => setRecibo(true)}>Emitir recibo</button>
      <span class="espaco"></span><button type="button" class="btn" onClick=${() => setFeita(null)}>Nova venda</button></div>
    ${recibo ? html`<${ReciboModal} venda=${feita} valor=${feita.total} forma=${feita.forma_pagamento} onFechar=${() => setRecibo(false)} onEmitido=${r => { setRecibo(false); ir("/imprimir/recibo/" + r.id); }} />` : null}
  </section>`;
  return html`<div class="balcao">
    <section class="card balcao-itens">
      <div class="busca-rapida"><input ref=${busca} id="balcao-busca" class="inp" type="search" autocomplete="off" autofocus placeholder="Código, código de barras, descrição ou referência" aria-label="Buscar produto ou serviço"
        value=${q} onInput=${e => setQ(e.target.value)} onKeyDown=${enter} />
        ${res.length ? html`<div class="lista busca-res">${res.map(p => html`<button type="button" key=${p.id} class="linha" onClick=${() => adicionar(p)}><span class="cod">${p.codigo}</span>
          <span class="meio"><strong>${p.descricao}</strong><span>${[p.tipo === "servico" ? "Serviço" : null, p.referencia, p.marca, p.tipo === "produto" && p.controla_estoque ? "estoque " + qtdFmt(p.estoque_atual) + " " + p.unidade : null].filter(Boolean).join(" · ")}</span></span>
          <b>${reais(p.tipo === "servico" && p.cobranca === "hora" ? (Number(p.horas) || 1) * (Number(cfg.valorHora) || 0) : precoTabela(p, v.tabela))}</b></button>`)}</div>` : null}</div>
      <div class="secao-topo"><h3>Itens da venda</h3><button type="button" class="btn btn-sm" onClick=${() => setAvulso({ descricao: "", valor: 0, tipo: "produto" })}>+ Item avulso</button></div>
      ${v.itens.length ? html`<div class="carrinho">${v.itens.map(i => { const p = dados.produtos.find(x => x.id === i.produto_id); const falta = p && p.tipo === "produto" && p.controla_estoque && Number(p.estoque_atual) < Number(i.qtd);
        return html`<div class="cart-linha" key=${i.k}>
          <div class="meio"><strong>${i.descricao}</strong><span class="sub">${[i.codigo, i.tipo === "servico" ? "serviço" : null, p && p.tipo === "produto" && p.controla_estoque ? "estoque " + qtdFmt(p.estoque_atual) : null].filter(Boolean).join(" · ")}${falta ? html` <b class="c-bad">sem estoque suficiente</b>` : null}</span></div>
          <div class="cart-qtd"><button type="button" class="btn btn-sm" aria-label="Diminuir" onClick=${() => setItem(i.k, { qtd: Math.max(1, Number(i.qtd) - 1) })}>−</button>
            <input class="inp" inputmode="decimal" aria-label=${"Quantidade de " + i.descricao} value=${String(i.qtd).replace(".", ",")} onInput=${e => setItem(i.k, { qtd: parseValor(e.target.value) })} />
            <button type="button" class="btn btn-sm" aria-label="Aumentar" onClick=${() => setItem(i.k, { qtd: Number(i.qtd) + 1 })}>+</button></div>
          <div class="cart-val"><${Dinheiro} id=${"cv-" + i.k} valor=${i.valor_unit} onMuda=${x => setItem(i.k, { valor_unit: x })} /></div>
          <b class="cart-tot">${reais(totalItem(i))}</b>
          <button type="button" class="fechar" aria-label=${"Remover " + i.descricao} onClick=${() => tirar(i.k)}>×</button></div>`; })}</div>`
        : html`<${Vazio}>Leia o código de barras ou busque o produto acima. Enter adiciona o item encontrado.</${Vazio}>`}
    </section>
    <aside class="card balcao-resumo">
      <div class="campo"><label for="bal-cli">Cliente</label>
        ${v.clienteId ? html`<${BuscaCliente} id="bal-cli" valor=${v.clienteId} onEscolha=${id => set({ clienteId: id })} />`
          : html`<${BuscaCliente} id="bal-cli" valor="" onEscolha=${id => set({ clienteId: id })} />
            <div class="grade"><${Campo} id="bal-nome" rotulo="Ou nome avulso"><${Texto} id="bal-nome" placeholder="Consumidor" valor=${v.nomeAvulso} onMuda=${x => set({ nomeAvulso: x })} /></${Campo}>
              <${Campo} id="bal-doc" rotulo="CPF/CNPJ (opcional)"><input id="bal-doc" class="inp" inputmode="numeric" value=${v.docAvulso} onBlur=${e => set({ docAvulso: fmtDoc(e.target.value) })} onInput=${e => set({ docAvulso: e.target.value })} /></${Campo}></div>`}</div>
      <div class="campo"><label>Tabela de preços</label><${Seg} rotulo="Tabela" opcoes=${Object.values(TABELAS_PRECO).map(t => [t, "info"])} valor=${TABELAS_PRECO[v.tabela]} onEscolha=${t => trocarTabela(Object.keys(TABELAS_PRECO).find(k => TABELAS_PRECO[k] === t))} /></div>
      <div class="campo"><label>Forma de pagamento</label><${Seg} rotulo="Pagamento" opcoes=${(cfg.formasPagamento || []).map(x => [x, "info"])} valor=${v.forma} onEscolha=${x => set({ forma: x })} /></div>
      <div class="totais">
        <div><span>Subtotal (${v.itens.length} ${v.itens.length === 1 ? "item" : "itens"})</span><b>${reais(sub)}</b></div>
        <div><span>Desconto</span><${Dinheiro} id="bal-desc" valor=${v.desconto} onMuda=${x => set({ desconto: x })} /></div>
        <div class="tot"><span>Total</span><b>${reais(total)}</b></div></div>
      <${Campo} id="bal-obs" rotulo="Observação"><${Texto} id="bal-obs" valor=${v.obs} onMuda=${x => set({ obs: x })} /></${Campo}>
      ${faltas.length ? html`<div class="aviso">${faltas.length} item(ns) acima do estoque. ${faltas.some(({ p }) => !p.vender_sem_estoque) ? "Há produto que não pode ser vendido sem estoque." : "A venda deixará o estoque negativo."}</div>` : null}
      ${erro ? html`<div class="erros">${erro}</div>` : null}
      <button type="button" class="btn btn-pri btn-grande" disabled=${salvando} onClick=${finalizar}>${salvando ? "Concluindo…" : "Concluir venda · " + reais(total)}</button>
      ${v.itens.length ? html`<button type="button" class="btn-link perigo" onClick=${() => setV(vazio())}>Limpar venda</button>` : null}
    </aside>
    ${avulso ? html`<${Modal} titulo="Item avulso" onFechar=${() => setAvulso(null)}>
      <${Seg} rotulo="Tipo" opcoes=${[["Produto", "info"], ["Serviço", "info"]]} valor=${avulso.tipo === "servico" ? "Serviço" : "Produto"} onEscolha=${t => setAvulso({ ...avulso, tipo: t === "Serviço" ? "servico" : "produto" })} />
      <${Campo} id="av-desc" rotulo="Descrição"><${Texto} id="av-desc" valor=${avulso.descricao} onMuda=${x => setAvulso({ ...avulso, descricao: x })} /></${Campo}>
      <${Campo} id="av-val" rotulo="Valor"><${Dinheiro} id="av-val" valor=${avulso.valor} onMuda=${x => setAvulso({ ...avulso, valor: x })} /></${Campo}>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${() => setAvulso(null)}>Cancelar</button>
        <button type="button" class="btn btn-pri" disabled=${!avulso.descricao.trim() || !(avulso.valor > 0)} onClick=${() => { setV(x => ({ ...x, itens: x.itens.concat([{ k: uuid(), produto_id: null, tipo: avulso.tipo, descricao: avulso.descricao.trim(), codigo: "", qtd: 1, valor_unit: avulso.valor, desconto: 0 }]) })); setAvulso(null); }}>Incluir</button></div>
    </${Modal}>` : null}
  </div>`;
}

function Historico() {
  const { ir } = useApp();
  const [dia, setDia] = useState(hojeISO()), [lista, setLista] = useState(null);
  useEffect(() => { setLista(null); const ini = new Date(dia + "T00:00:00"), fim = new Date(ini.getTime() + 86400000);
    api.vendas.listar({ de: ini.toISOString(), ate: fim.toISOString() }).then(setLista).catch(() => setLista([])); }, [dia]);
  const ok = (lista || []).filter(x => x.status === "concluida"), total = ok.reduce((s, x) => s + Number(x.total), 0);
  return html`<div class="pagina-col">
    <div class="linha-add"><input type="date" class="inp" aria-label="Dia" value=${dia} onInput=${e => e.target.value && setDia(e.target.value)} /></div>
    <section class="card"><div class="secao-topo"><h3>${ok.length} venda(s) · ${reais(total)}</h3></div>
      ${!lista ? html`<span class="dica">Carregando…</span>` : lista.length ? html`<div class="lista">${lista.map(x => html`<button type="button" key=${x.id} class=${"linha" + (x.status === "cancelada" ? " inativo" : "")} onClick=${() => ir("/imprimir/venda/" + x.id)}>
        <span class="cod">${String(x.numero).padStart(5, "0")}</span><span class="meio"><strong>${(x.cliente || {}).nome || "Consumidor"}${x.status === "cancelada" ? html` <span class="pill p-bad">Cancelada</span>` : null}</strong><span>${fmtDataHora(x.criado_em)} · ${x.forma_pagamento}${x.vendedor_nome ? " · " + x.vendedor_nome : ""}</span></span><b>${reais(x.total)}</b></button>`)}</div>`
        : html`<${Vazio}>Nenhuma venda neste dia.</${Vazio}>`}</section></div>`;
}

export function Balcao({ params = {} }) {
  const { perfil } = useApp();
  const [aba, setAba] = useState(params.aba === "historico" ? "historico" : "venda");
  if (!pode(perfil, "verValores")) return html`<div class="pagina"><div class="aviso">Seu papel não tem acesso à venda de balcão.</div></div>`;
  return html`<div class="pagina larga">
    <${Abas} abas=${[["venda", "Nova venda"], ["historico", "Vendas do dia"]]} ativa=${aba} onTroca=${setAba} />
    ${aba === "venda" ? html`<${Venda} />` : html`<${Historico} />`}
  </div>`;
}
