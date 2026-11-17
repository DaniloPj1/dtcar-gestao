// Compras (v59, pedido do Danilo em 16/11/2026).
// Aba Fornecedores: a peça é pesquisada NOS PORTAIS dos fornecedores (com o login do Danilo) e o preço e o estoque de cada um aparecem numa
// tabela só, do mais barato para o mais caro, só com estoque; põe no carrinho e, ao comprar, o carrinho vira um pedido por fornecedor,
// que o Danilo finaliza em cada fornecedor depois. Nada é comprado sozinho. O acervo de peças do sistema fica dentro da O.S. (17/11/2026).
// Também aqui: o cartão "Fornecedores conectados" dos Ajustes (tipo de acesso, endereço, usuário e senha — a senha vai para
// segredos e nunca volta para a tela).
// Etapa 2 (consulta AO VIVO, pedido do Danilo em 16/11/2026): o botão "Consultar fornecedores" de cada peça manda os códigos dela para a
// função "compras", que entra nos portais (DPK, Rolemar Master, Pellegrino) com o login guardado, busca e grava os preços com origem
// "Ao vivo" e a hora. Uma consulta por clique, nunca varredura. O Portal Toli (SMS, Oracle APEX) fica para o robô do programa do PC.
// Regras (preços, menor preço, pesquisa, texto do pedido, robô pelo endereço): js/compraspecas.js.
import { html, useState, useEffect, useMemo, useCallback } from "../lib.js";
import { api } from "../api.js";
import { useApp, Modal, Vazio, Campo, Texto, Dinheiro, Seg, Abas, I } from "../ui.js";
import { normPlaca, placaValida, exPlaca, reais, fmtDataHora, fmtData, qtdFmt, parseValor, linkWhats, lsGet, lsSet, num2 } from "../util.js";
import { etapaOS } from "../regras.js";
import { consultarPlaca, paraResumo } from "../placa.js";
import { ORIGEM_TEXTO, SITUACOES_PEDIDO, numPedido, nomeFornecedor, totalLinha, arred2, indiceOfertas, agruparCarrinho, textoPedido,
  NOME_ROBO, roboDaConexao, ondeConsulta, linhasCotacao, corDoFornecedor } from "../compraspecas.js";

const LS_BUSCA = "dtcar-compras-busca";
// tabela ausente = o v59 ainda não foi rodado (a api já traduz; aqui vale também para a resposta crua)
const semV59 = e => /compras_/.test((e && e.message) || "") && /does not exist|schema cache|Could not find/i.test(e.message) ? "Para usar Compras, rode o supabase/v59.sql no Supabase." : "";
const horaBrasilia = () => Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" })) % 24;
const dataPreco = o => !o.em ? "sem data" : o.origem === "ultima_compra" ? fmtData(o.em) : fmtDataHora(o.em);
const fornecedoresAtivos = l => (l || []).filter(f => f.ativo !== false).slice().sort((a, b) => nomeFornecedor(a).localeCompare(nomeFornecedor(b), "pt-BR"));

/* ---------------- tela principal: Pesquisar | Carrinho | Pedidos ---------------- */
export function Compras({ params = {} }) {
  const { dados, ir } = useApp();
  const [aba, setAba] = useState(["fornecedores", "carrinho", "pedidos"].includes(params.aba) ? params.aba : "fornecedores");
  const [d, setD] = useState(null), [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    try {
      const [precos, carrinho, pedidos, conexoes, vinculos] = await Promise.all([api.compras.precos.listar(), api.compras.carrinho.listar(), api.compras.pedidos.listar(),
        api.compras.conexoes.listar(), api.vinculos.listar().catch(() => [])]);
      setD({ precos, carrinho, pedidos, conexoes, vinculos }); setErro("");
    } catch (e) { setErro(semV59(e) || e.message || "Não deu para abrir as compras agora."); }
  }, []);
  useEffect(() => { carregar(); }, []);
  const trocar = k => { setAba(k); ir("/compras" + (k === "fornecedores" ? "" : "?aba=" + k)); };
  if (erro) return html`<div class="pagina"><section class="card"><h2>Compras</h2><div class="aviso" id="cp-erro">${erro}</div>
    <div class="acoes"><button type="button" class="btn" onClick=${carregar}>Tentar de novo</button></div></section></div>`;
  if (!d) return html`<div class="pagina"><${Vazio}>Carregando as compras…</${Vazio}></div>`;
  const aFinalizar = d.pedidos.filter(p => p.situacao === "a_finalizar").length;
  return html`<div class="pagina cp-pagina">
    <${Abas} abas=${[["fornecedores", "Fornecedores"], ["carrinho", "Carrinho" + (d.carrinho.length ? " (" + d.carrinho.length + ")" : "")], ["pedidos", "Pedidos aos fornecedores" + (aFinalizar ? " (" + aFinalizar + " a finalizar)" : "")]]} ativa=${aba} onTroca=${trocar} />
    ${aba === "fornecedores" ? html`<${Cotacao} d=${d} recarregar=${carregar} irCarrinho=${() => trocar("carrinho")} />`
      : aba === "carrinho" ? html`<${Carrinho} d=${d} recarregar=${carregar} irPedidos=${() => trocar("pedidos")} irPesquisa=${() => trocar("pesquisar")} />`
      : html`<${Pedidos} d=${d} recarregar=${carregar} />`}
  </div>`;
}

/* ---------------- aba Fornecedores: a pesquisa é NO FORNECEDOR (protótipo aprovado; pedidos do Danilo em 17/11/2026) ----------------
 * "Não quero que a pesquisa seja no meu sistema: quero que pesquise a peça no fornecedor." O que for digitado (código ou descrição) vai
 * como está para a busca de cada portal, como se fosse digitado lá; a placa vai junto (os portais que buscam por placa usam; os outros
 * ignoram — em preparação). Resultado: UMA tabela Fornecedor | Código | Preço | Estoque | Prazo | Origem | Carrinho, só com estoque
 * disponível. O acervo de peças do sistema fica só dentro da O.S., ao incluir peça. Carrinho resumido ao lado para gerar os pedidos. */
const LS_COT = "dtcar-compras-cot";
/** detalhe da conexão gravado pelo servidor pode trazer a hora em ISO (2026-11-17T13:05:15.263Z): mostra no horário de Brasília */
const detalheLegivel = t => String(t || "").replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g, m => fmtDataHora(m));
const SITUACAO_CURTA = { ok: "Conectado", erro: "Com erro", aguardando: "Aguardando a primeira consulta" };
/** Fichinha de cada fornecedor conectado: logado (conectado) ou não, com o motivo. Pedido do Danilo em 17/11/2026. */
function SituacaoFornecedores({ conexoes, nomeDe, cor = () => "" }) {
  if (!conexoes.length) return null;
  return html`<div class="cot-situacoes" id="cot-situacoes" aria-label="Situação dos fornecedores">${conexoes.map(c => { const robo = roboDaConexao(c), onde = ondeConsulta(robo);
    const sit = onde === "pc" ? "pc" : !onde ? "sem_robo" : c.situacao === "ok" ? "ok" : c.situacao === "erro" ? "erro" : "aguardando";
    const texto = sit === "pc" ? "pelo programa do PC (em preparação)" : sit === "sem_robo" ? "portal não reconhecido" : SITUACAO_CURTA[sit];
    return html`<span key=${c.id} class=${"cot-sit cot-sit-" + sit} data-forn=${nomeDe(c.fornecedor_id)} title=${detalheLegivel(c.detalhe)} style=${"--forn:" + cor(c.fornecedor_id)}><i aria-hidden="true"></i><b>${nomeDe(c.fornecedor_id)}</b> · ${texto}${sit === "erro" && c.detalhe ? html`<small>: ${detalheLegivel(c.detalhe).slice(0, 90)}</small>` : null}</span>`; })}</div>`;
}
function Cotacao({ d, recarregar, irCarrinho }) {
  const { dados } = useApp();
  const g = lsGet(LS_COT) || {};
  const [placaTxt, setPlacaTxt] = useState(g.placa || ""), [txt, setTxt] = useState(g.txt || "");
  const [vivo, setVivo] = useState(null), [aoCarrinho, setAoCarrinho] = useState(null);
  const [visao, setVisao] = useState(g.visao === "lista" ? "lista" : "cards");   // Cards | Lista, como na DPK (pedido do Danilo em 17/11/2026)
  const [tamanho, setTamanho] = useState(["p", "m", "g"].includes(g.tamanho) ? g.tamanho : "m");   // tamanho dos cards
  const [soForn, setSoForn] = useState(""), [soMarca, setSoMarca] = useState("");   // filtros: fornecedor e marca da peça (fabricante)
  useEffect(() => { lsSet(LS_COT, { placa: placaTxt, txt, visao, tamanho }); }, [placaTxt, txt, visao, tamanho]);
  const cor = id => corDoFornecedor(id, dados.fornecedores);
  const placa = normPlaca(placaTxt), ePlaca = placaValida(placa);
  const doCadastro = useMemo(() => ePlaca ? dados.veiculos.find(v => v.placa === placa) || null : null, [ePlaca, placa, dados.veiculos]);
  const [cons, setCons] = useState(null);
  // placa fora do cadastro: 1º a consulta GRÁTIS pelos portais com login (DPK/Rolemar, ação "placa" da função; pedido do Danilo em
  // 17/11/2026); só se nenhum portal conhecer a placa cai na consulta de placa de sempre (API Placas, com cópia)
  useEffect(() => {
    if (!ePlaca || doCadastro) { setCons(null); return; }
    let v = true; setCons({ placa, buscando: true });
    const t = setTimeout(async () => {
      let r = null;
      const p = await api.compras.aoVivo({ acao: "placa", placa });
      if (!v) return;   // a placa mudou ou saiu da aba enquanto o portal respondia: não gasta a consulta paga com a placa antiga
      if (p && p.ok && p.encontrado && p.modelo) r = { ok: true, encontrado: true, portal: p.fornecedor, modelo: p.modelo };
      else r = await consultarPlaca(placa, "basico", { manual: true });
      if (v) setCons({ placa, r });
    }, 600);
    return () => { v = false; clearTimeout(t); };
  }, [ePlaca, placa, doCadastro]);
  const cr = cons && cons.placa === placa ? cons.r : null;
  const daConsulta = cr && cr.ok && cr.encontrado ? (cr.portal ? { modelo: cr.modelo } : paraResumo(cr.dados || {})) : null;
  const veiculo = doCadastro || daConsulta;
  const nomeVeic = v => v.modelo && !v.marca ? v.modelo : [v.marca, v.modelo, v.ano_mod || v.ano].filter(Boolean).join(" ");
  const idx = useMemo(() => indiceOfertas({ precos: d.precos, vinculos: d.vinculos, produtos: dados.produtos, fornecedores: dados.fornecedores }), [d.precos, d.vinculos, dados.produtos, dados.fornecedores]);
  const conectados = d.conexoes.filter(c => c.ativo !== false);
  const nomeDe = id => nomeFornecedor(dados.fornecedores.find(f => f.id === id));
  const noServidor = conectados.filter(c => ondeConsulta(roboDaConexao(c)) === "servidor");
  const noPC = conectados.filter(c => ondeConsulta(roboDaConexao(c)) === "pc");
  // o que vai para os fornecedores: exatamente o que foi digitado (código ou descrição), como se fosse digitado no portal; a placa vai junto
  const alvo = useMemo(() => { const t = txt.trim(); return { termos: t.length >= 3 ? [t] : [] }; }, [txt]);
  const consultar = async () => {
    if (!alvo.termos.length || (vivo && vivo.buscando)) return;
    setVivo({ buscando: true, termos: alvo.termos });
    setSoForn(""); setSoMarca("");
    const r = await api.compras.aoVivo({ termos: alvo.termos, placa: ePlaca ? placa : "", veiculo: veiculo ? nomeVeic(veiculo) : "", conexoes: noServidor.map(c => c.id) });
    setVivo({ r, termos: alvo.termos });
    if (r && r.ok) await recarregar();
  };
  const res = useMemo(() => linhasCotacao({ resposta: vivo && vivo.r && vivo.r.ok ? vivo.r : null, idx, codigos: vivo && vivo.termos ? vivo.termos : alvo.termos, fornecedores: dados.fornecedores }), [vivo, idx, alvo.termos, dados.fornecedores]);
  const grupos = useMemo(() => agruparCarrinho(d.carrinho, dados.fornecedores), [d.carrinho, dados.fornecedores]);
  const totalCar = arred2(grupos.reduce((s, x) => s + x.total, 0));
  const podeConsultar = !!alvo.termos.length && !!noServidor.length && !(vivo && vivo.buscando);
  return html`<div class="cot">
    <div class="cot-principal">
      <section class="card cot-busca">
        <span class="sub">Pesquisar a peça nos fornecedores (a busca é feita no portal de cada um, com o seu login)</span>
        <div class="cp-campos">
          <label class="cp-campo cp-campo-placa"><span>Placa (opcional)</span><input id="cot-placa" class="inp" autocomplete="off" maxlength="8" placeholder="ABC1D23" value=${placaTxt} onInput=${e => setPlacaTxt(e.target.value.toUpperCase())} /></label>
          <label class="cp-campo cp-campo-txt"><span>Código ou descrição da peça (vai como está para o fornecedor)</span>
            <input id="cot-txt" class="inp" type="search" autocomplete="off" placeholder="Ex.: WK84213, pastilha de freio" value=${txt} onInput=${e => setTxt(e.target.value)} onKeyDown=${e => { if (e.key === "Enter" && podeConsultar) consultar(); }} /></label>
          <button type="button" class="btn btn-pri cot-consultar" id="cot-consultar" disabled=${!podeConsultar} onClick=${consultar}>${vivo && vivo.buscando ? "Consultando…" : "Consultar fornecedores"}</button>
        </div>
        ${ePlaca ? html`<div class=${"of-placa" + (veiculo ? "" : " of-placa-sem")} id="cot-veiculo" role="status"><b>${exPlaca(placa)}</b>
          ${doCadastro ? html`<span>do cadastro: ${nomeVeic(doCadastro)}</span>` : cons && cons.buscando ? html`<span>consultando a placa…</span>`
            : daConsulta ? html`<span>${cr.portal ? "pela " + cr.portal + " (sem custo): " : "pela consulta da placa: "}${nomeVeic(daConsulta)}</span>` : cr ? html`<span>placa não encontrada. Pesquise pelo código (deixe a placa em branco).</span>` : null}
          ${veiculo ? html`<span class="of-entendido">A placa vai junto na busca dos portais que aceitam placa (em preparação); o que vale hoje é o texto da peça.</span>` : null}</div>` : null}
        <${SituacaoFornecedores} conexoes=${conectados} nomeDe=${nomeDe} cor=${cor} />
        <p class="sub" id="cot-origem">${noServidor.length
          ? html`Consulta ao vivo em <b>${noServidor.map(c => nomeDe(c.fornecedor_id)).filter(Boolean).join(", ")}</b> com o seu login.${noPC.length ? " " + noPC.map(c => nomeDe(c.fornecedor_id)).filter(Boolean).join(", ") + ": pelo programa do PC, em preparação." : ""} Só aparece peça com estoque no fornecedor.`
          : html`Nenhum fornecedor com portal reconhecido. Conecte em Ajustes › Fornecedores conectados (endereço do portal, usuário e senha).`}</p>
      </section>
      ${vivo && vivo.r && !vivo.r.ok ? html`<div class="aviso aviso-erro" id="cot-erro">${vivo.r.erro}</div>` : null}
      ${res.linhas.length || res.semResposta.length ? (() => {
        const fornsRes = [...new Map(res.linhas.map(o => [o.fornecedor_id, o.fornecedor])).entries()];
        const marcas = [...new Set(res.linhas.map(o => o.marca).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
        const mostradas = res.linhas.filter(o => (!soForn || o.fornecedor_id === soForn) && (!soMarca || o.marca === soMarca));
        const estoqueTxt = o => o.estoque === null || o.estoque === undefined ? "disponível no fornecedor" : qtdFmt(o.estoque) + " un. no estoque" + (o.prazo ? " · " + o.prazo : "");
        const origemTxt = o => ORIGEM_TEXTO[o.origem].toLowerCase() + " · " + dataPreco(o);
        return html`<section class="card cot-resultado">
        <div class="cot-topo">
          <span class="sub" id="cot-res-info"><b>${mostradas.length}</b> ${mostradas.length === 1 ? "resultado" : "resultados"} com estoque${res.semEstoque ? html` · <span class="c-warn">${res.semEstoque} sem estoque ${res.semEstoque === 1 ? "não aparece" : "não aparecem"}</span>` : null}</span>
          <div class="cot-filtros">
            <select id="cot-forn-filtro" class="inp" aria-label="Fornecedor" value=${soForn} onChange=${e => setSoForn(e.target.value)}><option value="">Todos os fornecedores</option>${fornsRes.map(([id, n]) => html`<option key=${id} value=${id}>${n}</option>`)}</select>
            <select id="cot-marca-filtro" class="inp" aria-label="Marca da peça" value=${soMarca} onChange=${e => setSoMarca(e.target.value)}><option value="">Todas as marcas</option>${marcas.map(m => html`<option key=${m} value=${m}>${m}</option>`)}</select>
            <div class="seg cot-visao" role="group" aria-label="Como mostrar"><button type="button" class=${visao === "cards" ? "ativo" : ""} id="cot-ver-cards" onClick=${() => setVisao("cards")}>Cards</button><button type="button" class=${visao === "lista" ? "ativo" : ""} id="cot-ver-lista" onClick=${() => setVisao("lista")}>Lista</button></div>
            ${visao === "cards" ? html`<div class="seg cot-tamanho" role="group" aria-label="Tamanho dos cards">${[["p", "Pequeno"], ["m", "Médio"], ["g", "Grande"]].map(([k, n]) => html`<button type="button" key=${k} class=${tamanho === k ? "ativo" : ""} onClick=${() => setTamanho(k)}>${n}</button>`)}</div>` : null}
          </div>
        </div>
        ${visao === "cards" ? html`<div class=${"cot-cards cot-t-" + tamanho}>${mostradas.map(o => html`<article key=${o.chave} class=${"cot-card" + (o.menor ? " cot-menor" : "") + (o.antigo ? " cp-velho" : "")} data-forn=${o.fornecedor} style=${"--forn:" + cor(o.fornecedor_id)}>
            <div class="cot-card-forn"><b>${o.fornecedor}</b>${o.menor ? html`<span class="pill p-ok cp-selo-menor">menor preço</span>` : null}</div>
            <div class="cot-card-foto">${o.foto ? html`<img src=${o.foto} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${e => { e.target.parentNode.classList.add("sem"); }} />` : null}<span class="cot-sem-foto">sem foto</span></div>
            <div class="cot-card-corpo"><strong>${o.descricao || o.codigo}</strong>
              <b class="cot-card-preco">${reais(o.preco)}</b>
              <span class="cot-card-est">${estoqueTxt(o)}</span>
              <span class="cot-card-cod">Fabricante: <b>${o.marca || "—"}</b></span>
              <span class="cot-card-cod">Cód. de fábrica: <b>${o.codigo}</b></span>
              <small class="cot-card-ori">${origemTxt(o)}${o.antigo ? html` <span class="c-warn">(há ${o.idade} dias)</span>` : null}</small></div>
            <button type="button" class=${"btn cp-add" + (o.menor ? " btn-pri" : "")} onClick=${() => setAoCarrinho(o)}>${I.carrinho}<span>Adicionar</span></button>
          </article>`)}</div>`
        : html`<div class="cot-lista">${mostradas.map(o => html`<div key=${o.chave} class=${"cot-linha" + (o.menor ? " cot-menor" : "") + (o.antigo ? " cp-velho" : "")} data-forn=${o.fornecedor} style=${"--forn:" + cor(o.fornecedor_id)}>
            <span class="cot-l-foto">${o.foto ? html`<img src=${o.foto} alt="" loading="lazy" referrerpolicy="no-referrer" onError=${e => { e.target.style.display = "none"; }} />` : null}</span>
            <span class="cot-l-peca"><b class="cot-l-forn">${o.fornecedor}</b>${o.menor ? html` <span class="pill p-ok cp-selo-menor">menor preço</span>` : null}<strong>${o.descricao || o.codigo}</strong><small>${[o.marca, o.codigo].filter(Boolean).join(" ")} · ${origemTxt(o)}</small></span>
            <span class="cot-l-preco"><b>${reais(o.preco)}</b><small>${estoqueTxt(o)}</small></span>
            <span class="cot-l-acao"><button type="button" class=${"btn btn-sm cp-add" + (o.menor ? " btn-pri" : "")} onClick=${() => setAoCarrinho(o)}>${I.carrinho}<span>Adicionar</span></button></span>
          </div>`)}</div>`}
        ${res.semResposta.length ? html`<div class="cot-sem-lista">${res.semResposta.map(x => html`<div key=${"s" + x.fornecedor_id} class="cot-sem" data-forn=${x.fornecedor} style=${"--forn:" + cor(x.fornecedor_id)}><b>${x.fornecedor}</b><span>${x.motivo}</span></div>`)}</div>` : null}
      </section>`; })() : vivo && !vivo.buscando && vivo.r && vivo.r.ok ? html`<div class="vazio" id="cot-nada">Nenhum fornecedor tem essa peça em estoque agora.</div>`
      : !vivo ? html`<${Vazio}>Digite o código ou a descrição da peça e clique em “Consultar fornecedores”. A busca é feita no portal de cada fornecedor; aparece o preço e o estoque de cada um, do mais barato para o mais caro.</${Vazio}>` : null}
    </div>
    <aside class="card cot-carrinho" id="cot-carrinho">
      <h3>Carrinho</h3>
      ${grupos.length ? html`${grupos.map(x => html`<div class="cot-car-forn" key=${x.fornecedor_id}><span class="cot-car-nome">${x.fornecedor}</span>
          ${x.itens.map(i => html`<div class="cot-car-item" key=${i.id}><span>${i.descricao} × ${qtdFmt(i.qtd)}</span><span>${reais(totalLinha(i))}</span></div>`)}</div>`)}
        <div class="cot-car-total"><span>Total</span><b>${reais(totalCar)}</b></div>
        <button type="button" class="btn btn-pri" id="cot-gerar" onClick=${irCarrinho}>Gerar pedidos por fornecedor</button>
        <span class="dica">Os pedidos são criados aqui e finalizados em cada fornecedor, um a um.</span>`
        : html`<span class="dica">Vazio. Use “Carrinho” no preço do fornecedor escolhido.</span>`}
    </aside>
    ${aoCarrinho ? html`<${AoCarrinho} o=${aoCarrinho} e=${null} placa=${ePlaca ? placa : ""} onFechar=${() => setAoCarrinho(null)} noPortal=${aoCarrinho.origem === "ao_vivo" && aoCarrinho.conexao ? aoCarrinho : null}
      onSalvo=${async ir => { setAoCarrinho(null); await recarregar(); if (ir) irCarrinho(); }} />` : null}
  </div>`;
}

/* ---------------- pôr no carrinho (a partir do preço de um fornecedor) ---------------- */
function AoCarrinho({ o, e, placa, onFechar, onSalvo, noPortal = null }) {
  const { dados, avisar } = useApp();
  const [portal, setPortal] = useState(!!noPortal);   // pôr também no carrinho do PORTAL do fornecedor (pedido do Danilo em 17/11/2026)
  const abertas = useMemo(() => dados.ordens.filter(x => !x._pendente && ["orcamento", "execucao", "pagamento"].includes(etapaOS(x))), [dados.ordens]);
  const [qtd, setQtd] = useState("1"), [os, setOs] = useState(""), [pl, setPl] = useState(placa || ""), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const desc = e ? e.peca.descricao : o.descricao || o.codigo;
  const salvar = async continuar => {
    const q = parseValor(qtd); if (!(q > 0)) return setErro("Informe a quantidade.");
    const n = String(os).trim() ? Number(String(os).replace(/\D/g, "")) : null;
    if (n !== null && !(n > 0)) return setErro("Número da O.S. inválido.");
    const daOS = n ? abertas.find(x => Number(x.numero) === n) : null;
    setSalvando(true); setErro("");
    try {
      await api.compras.carrinho.incluir({ fornecedor_id: o.fornecedor_id, codigo: o.codigo || (e ? e.peca.codigo : ""), marca: o.marca || (e ? e.peca.marca : ""), descricao: desc,
        qtd: q, preco: o.preco, origem_preco: o.origem, preco_em: o.em ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(o.em) ? o.em + "T12:00:00-03:00" : o.em).toISOString() : null,
        os_numero: n, placa: normPlaca(pl || (daOS && daOS.veiculo && daOS.veiculo.placa) || "") });
      let msg = "No carrinho: " + qtdFmt(q) + " x " + desc + " (" + o.fornecedor + ").";
      if (noPortal && portal) {
        const r = await api.compras.aoVivo({ acao: "carrinho_portal", conexao: noPortal.conexao, item: { codigo: o.codigo, descricao: desc, marca: o.marca || "", qtd: q, preco: o.preco, extra: noPortal.extra || null } });
        msg += r && r.ok ? " " + (r.detalhe || "Também no carrinho do portal.") : " No portal do fornecedor não entrou: " + ((r && r.erro) || "sem resposta") ;
      }
      avisar(msg); await onSalvo(!continuar);
    } catch (x) { setErro(x.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Pôr no carrinho" onFechar=${onFechar}>
    <div class="cp-resumo-add"><b>${desc}</b><span>${o.fornecedor} · ${[o.marca, o.codigo].filter(Boolean).join(" ")} · <b>${reais(o.preco)}</b> cada (${ORIGEM_TEXTO[o.origem].toLowerCase()} em ${dataPreco(o)})</span>
      ${o.antigo || o.origem === "ultima_compra" ? html`<span class="c-warn">Preço antigo: confirme com o fornecedor antes de fechar o pedido.</span>` : null}</div>
    <div class="grade">
      <${Campo} id="cp-add-qtd" rotulo="Quantidade" obrig><${Texto} id="cp-add-qtd" inputmode="decimal" valor=${qtd} onMuda=${setQtd} /></${Campo}>
      <${Campo} id="cp-add-os" rotulo="Para a O.S." dica="Opcional."><input id="cp-add-os" class="inp" inputmode="numeric" list="cp-os-abertas" value=${os} onInput=${x => setOs(x.target.value)} />
        <datalist id="cp-os-abertas">${abertas.slice(0, 80).map(x => html`<option key=${x.id} value=${String(x.numero)}>${exPlaca(x.veiculo && x.veiculo.placa)} · ${x.cliente && x.cliente.nome}</option>`)}</datalist></${Campo}>
      <${Campo} id="cp-add-placa" rotulo="Placa" dica="Opcional."><${Texto} id="cp-add-placa" valor=${pl} onMuda=${v => setPl(v.toUpperCase())} /></${Campo}>
    </div>
    ${noPortal ? html`<label class="linha-check" id="cp-add-portal"><input type="checkbox" checked=${portal} onChange=${e => setPortal(e.target.checked)} /><span>Pôr também no carrinho do portal ${o.fornecedor} (com o seu login), para só fechar o pedido lá</span></label>` : null}
    ${erro ? html`<div class="erros" role="alert">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn" id="cp-add-continuar" disabled=${salvando} onClick=${() => salvar(true)}>Pôr e continuar pesquisando</button>
      <button type="button" class="btn btn-pri" id="cp-add-ir" disabled=${salvando} onClick=${() => salvar(false)}>Pôr e ver o carrinho</button></div>
  </${Modal}>`;
}

/* ---------------- carrinho: por fornecedor; gerar os pedidos ---------------- */
function Carrinho({ d, recarregar, irPedidos, irPesquisa }) {
  const { dados, avisar, confirmar } = useApp();
  const grupos = useMemo(() => agruparCarrinho(d.carrinho, dados.fornecedores), [d.carrinho, dados.fornecedores]);
  const total = arred2(grupos.reduce((s, g) => s + g.total, 0));
  const [gerando, setGerando] = useState(false);
  const mudar = async (i, patch) => { try { await api.compras.carrinho.atualizar(i.id, patch); await recarregar(); } catch (e) { avisar(e.message, true); } };
  const tirar = async i => { try { await api.compras.carrinho.excluir(i.id); await recarregar(); } catch (e) { avisar(e.message, true); } };
  const gerar = async () => {
    if (!(await confirmar({ titulo: "Gerar pedidos", botao: "Gerar " + grupos.length + (grupos.length === 1 ? " pedido" : " pedidos"),
      texto: "O carrinho vira um pedido por fornecedor: " + grupos.map(g => g.fornecedor + " (" + reais(g.total) + ")").join(", ") + ". Depois finalize cada pedido no fornecedor e marque como finalizado." }))) return;
    setGerando(true);
    try { const r = await api.compras.pedidos.gerar(null); avisar((r || []).length + ((r || []).length === 1 ? " pedido gerado: " : " pedidos gerados: ") + (r || []).map(x => numPedido(x.numero) + " " + x.fornecedor).join(", ") + ".");
      await recarregar(); irPedidos(); }
    catch (e) { avisar(e.message, true); } finally { setGerando(false); }
  };
  if (!grupos.length) return html`<div class="vazio" id="cp-carrinho-vazio">O carrinho está vazio. Pesquise a peça e use “Carrinho” no preço do fornecedor escolhido.
    <div class="acoes"><button type="button" class="btn btn-sm" onClick=${irPesquisa}>Pesquisar peça</button></div></div>`;
  return html`<div class="cp-carrinho">
    ${grupos.map(g => html`<section class="card cp-forn" key=${g.fornecedor_id} data-forn=${g.fornecedor}>
      <div class="cp-forn-topo"><h3>${g.fornecedor}</h3><b class="cp-forn-total">${reais(g.total)}</b></div>
      <div class="cp-itens">${g.itens.map(i => html`<${ItemCarrinho} key=${i.id} i=${i} onMudar=${p => mudar(i, p)} onTirar=${() => tirar(i)} />`)}</div>
    </section>`)}
    <section class="card cp-fecho"><div class="cp-forn-topo"><span>Total do carrinho (${grupos.length} ${grupos.length === 1 ? "fornecedor" : "fornecedores"})</span><b id="cp-total">${reais(total)}</b></div>
      <p class="sub">Cada fornecedor vira um pedido separado. O sistema não compra nada sozinho: você finaliza cada pedido no fornecedor.</p>
      <div class="acoes"><span class="espaco"></span><button type="button" class="btn btn-pri" id="cp-gerar" disabled=${gerando} onClick=${gerar}>${gerando ? "Gerando…" : "Gerar pedidos por fornecedor"}</button></div></section>
  </div>`;
}

function ItemCarrinho({ i, onMudar, onTirar }) {
  const [qtd, setQtd] = useState(qtdFmt(i.qtd)), [preco, setPreco] = useState(num2(i.preco));
  useEffect(() => { setQtd(qtdFmt(i.qtd)); setPreco(num2(i.preco)); }, [i.qtd, i.preco]);
  const fimQtd = () => { const q = parseValor(qtd); if (q > 0 && q !== Number(i.qtd)) onMudar({ qtd: q }); else setQtd(qtdFmt(i.qtd)); };
  const fimPreco = () => { const v = parseValor(preco); if (v >= 0 && arred2(v) !== Number(i.preco)) onMudar({ preco: arred2(v) }); else setPreco(num2(i.preco)); };
  return html`<div class="cp-item-car" data-id=${i.id}>
    <div class="cp-ic-desc"><b>${i.descricao}</b><span class="sub">${[i.marca, i.codigo].filter(Boolean).join(" ")}${i.os_numero ? " · O.S. " + i.os_numero : ""}${i.placa ? " · " + exPlaca(i.placa) : ""}
      · preço ${ORIGEM_TEXTO[i.origem_preco].toLowerCase()}${i.preco_em ? " em " + (i.origem_preco === "ultima_compra" ? fmtData(i.preco_em) : fmtDataHora(i.preco_em)) : ""}</span></div>
    <label class="cp-ic-qtd"><span>Qtd</span><input class="inp" inputmode="decimal" aria-label=${"Quantidade de " + i.descricao} value=${qtd} onInput=${e => setQtd(e.target.value)} onBlur=${fimQtd} onKeyDown=${e => e.key === "Enter" && e.target.blur()} /></label>
    <label class="cp-ic-preco"><span>Preço</span><div class="inp-din"><span>R$</span><input class="inp" inputmode="decimal" aria-label=${"Preço de " + i.descricao} value=${preco} onInput=${e => setPreco(e.target.value)} onBlur=${fimPreco} onKeyDown=${e => e.key === "Enter" && e.target.blur()} /></div></label>
    <b class="cp-ic-total">${reais(totalLinha(i))}</b>
    <button type="button" class="btn btn-sm cp-tirar" aria-label=${"Tirar " + i.descricao + " do carrinho"} onClick=${onTirar}>Tirar</button>
  </div>`;
}

/* ---------------- pedidos: um por fornecedor ---------------- */
function Pedidos({ d, recarregar }) {
  const { dados, avisar, confirmar } = useApp();
  const [filtro, setFiltro] = useState("A finalizar"), [texto, setTexto] = useState(null), [finalizar, setFinalizar] = useState(null), [cancelar, setCancelar] = useState(null);
  const sit = { "A finalizar": "a_finalizar", "Finalizados": "finalizado", "Cancelados": "cancelado" }[filtro];
  const lista = d.pedidos.filter(p => p.situacao === sit);
  const conexao = fid => d.conexoes.find(c => c.fornecedor_id === fid);
  const forn = fid => dados.fornecedores.find(f => f.id === fid);
  const atualizar = async (p, patch, msg) => { try { await api.compras.pedidos.atualizar(p.id, patch); avisar(msg); await recarregar(); return true; } catch (e) { avisar(e.message, true); return false; } };
  const voltar = async p => {
    if (!(await confirmar({ titulo: "Voltar para o carrinho", botao: "Voltar para o carrinho", texto: "Os itens do " + numPedido(p.numero).toLowerCase() + " voltam para o carrinho (para trocar quantidade, preço ou fornecedor) e este pedido fica cancelado." }))) return;
    try { await api.compras.pedidos.voltar(p.id); avisar("Itens de volta no carrinho."); await recarregar(); } catch (e) { avisar(e.message, true); }
  };
  const n = s => d.pedidos.filter(p => p.situacao === s).length;
  return html`<div class="cp-pedidos">
    <${Seg} rotulo="Situação dos pedidos" opcoes=${[["A finalizar", "info"], ["Finalizados", "info"], ["Cancelados", "info"]]} valor=${filtro} onEscolha=${setFiltro} />
    <p class="sub">A finalizar: ${n("a_finalizar")} · Finalizados: ${n("finalizado")} · Cancelados: ${n("cancelado")}</p>
    ${!lista.length ? html`<${Vazio}>${sit === "a_finalizar" ? "Nenhum pedido a finalizar. Os pedidos nascem do carrinho (Gerar pedidos por fornecedor)." : "Nenhum pedido aqui."}</${Vazio}>` : null}
    ${lista.map(p => { const st = SITUACOES_PEDIDO[p.situacao], c = conexao(p.fornecedor_id), f = forn(p.fornecedor_id);
      return html`<section class="card cp-pedido" key=${p.id} data-num=${p.numero}>
        <div class="cp-forn-topo"><h3>${numPedido(p.numero)} · ${p.fornecedor_nome}</h3><span class=${"pill p-" + st.cor}>${st.t}</span></div>
        <span class="sub">Gerado em ${fmtDataHora(p.criado_em)}${p.criado_por_nome ? " por " + p.criado_por_nome : ""}${p.situacao === "finalizado" ? " · finalizado em " + fmtDataHora(p.finalizado_em) + (p.finalizado_por_nome ? " por " + p.finalizado_por_nome : "") + (p.documento ? " · nº no fornecedor: " + p.documento : "") : ""}${p.situacao === "cancelado" ? " · motivo: " + p.motivo : ""}</span>
        <div class="cp-itens">${(p.itens || []).map(i => html`<div class="cp-item-ped" key=${i.id}><span><b>${qtdFmt(i.qtd)} x ${i.descricao}</b> <span class="sub">${[i.marca, i.codigo].filter(Boolean).join(" ")}${i.os_numero ? " · O.S. " + i.os_numero : ""}${i.placa ? " · " + exPlaca(i.placa) : ""}</span></span>
          <span class="cp-ip-val">${reais(i.preco)} · <b>${reais(totalLinha(i))}</b></span></div>`)}</div>
        <div class="cp-forn-topo"><span>Total</span><b class="cp-forn-total">${reais(p.total)}</b></div>
        ${p.situacao === "a_finalizar" ? html`<div class="acoes cp-ped-acoes">
          <button type="button" class="btn btn-sm cp-texto" onClick=${() => setTexto({ p, f })}>${I.whats}<span>Texto do pedido</span></button>
          ${c && c.endereco && c.tipo === "portal" ? html`<a class="btn btn-sm" href=${c.endereco} target="_blank" rel="noopener noreferrer">Abrir o site do fornecedor</a>` : null}
          <button type="button" class="btn btn-sm cp-voltar" onClick=${() => voltar(p)}>Voltar para o carrinho</button>
          <button type="button" class="btn btn-sm cp-cancelar" onClick=${() => setCancelar(p)}>Cancelar</button><span class="espaco"></span>
          <button type="button" class="btn btn-sm btn-pri cp-finalizar" onClick=${() => setFinalizar(p)}>Marcar como finalizado</button></div>`
        : p.situacao === "finalizado" ? html`<div class="acoes"><button type="button" class="btn-link cp-desfazer" onClick=${() => atualizar(p, { situacao: "a_finalizar" }, "O pedido voltou para a finalizar.")}>Desfazer: voltar para a finalizar</button></div>` : null}
      </section>`; })}
    ${texto ? html`<${TextoPedido} p=${texto.p} f=${texto.f} onFechar=${() => setTexto(null)} />` : null}
    ${finalizar ? html`<${Finalizar} p=${finalizar} onFechar=${() => setFinalizar(null)} onOk=${async doc => { if (await atualizar(finalizar, { situacao: "finalizado", documento: doc }, numPedido(finalizar.numero) + " finalizado.")) setFinalizar(null); }} />` : null}
    ${cancelar ? html`<${Cancelar} p=${cancelar} onFechar=${() => setCancelar(null)} onOk=${async m => { if (await atualizar(cancelar, { situacao: "cancelado", motivo: m }, numPedido(cancelar.numero) + " cancelado.")) setCancelar(null); }} />` : null}
  </div>`;
}

function TextoPedido({ p, f, onFechar }) {
  const txt = useMemo(() => textoPedido(p, p.itens || [], { contato: f && f.contato, hora: horaBrasilia() }), [p, f]);
  const [copiado, setCopiado] = useState(false);
  const copiar = async () => { try { await navigator.clipboard.writeText(txt); setCopiado(true); } catch (e) { const t = document.getElementById("cp-texto-pedido"); if (t) { t.select(); document.execCommand && document.execCommand("copy"); setCopiado(true); } } };
  return html`<${Modal} titulo=${"Texto do " + numPedido(p.numero).toLowerCase()} onFechar=${onFechar}>
    <p class="sub">Para mandar ao fornecedor pelo WhatsApp ou e-mail. Quem envia é você.</p>
    <textarea id="cp-texto-pedido" class="inp cp-texto-area" readonly value=${txt}></textarea>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button>
      ${f && f.telefone ? html`<a class="btn" href=${linkWhats(f.telefone, txt)} target="_blank" rel="noopener noreferrer">Abrir no WhatsApp</a>` : null}
      <button type="button" class="btn btn-pri" id="cp-copiar" onClick=${copiar}>${copiado ? "Copiado" : "Copiar texto"}</button></div>
  </${Modal}>`;
}

function Finalizar({ p, onFechar, onOk }) {
  const [doc, setDoc] = useState(p.documento || "");
  return html`<${Modal} titulo=${"Finalizar " + numPedido(p.numero).toLowerCase()} onFechar=${onFechar}>
    <p>Confirme que o pedido de <b>${p.fornecedor_nome}</b> (${reais(p.total)}) foi fechado no fornecedor.</p>
    <${Campo} id="cp-fin-doc" rotulo="Nº do pedido no fornecedor" dica="Opcional: o número que o fornecedor deu (pré-venda, pedido)."><${Texto} id="cp-fin-doc" valor=${doc} onMuda=${setDoc} /></${Campo}>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-pri" id="cp-fin-ok" onClick=${() => onOk(doc.trim())}>Marcar como finalizado</button></div>
  </${Modal}>`;
}

function Cancelar({ p, onFechar, onOk }) {
  const [m, setM] = useState(""), [erro, setErro] = useState("");
  return html`<${Modal} titulo=${"Cancelar " + numPedido(p.numero).toLowerCase()} onFechar=${onFechar}>
    <p>O pedido de <b>${p.fornecedor_nome}</b> fica cancelado e não volta. Para mudar itens, use “Voltar para o carrinho”.</p>
    <${Campo} id="cp-can-motivo" rotulo="Motivo" obrig><${Texto} id="cp-can-motivo" valor=${m} onMuda=${setM} /></${Campo}>
    ${erro ? html`<div class="erros" role="alert">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-perigo" id="cp-can-ok" onClick=${() => m.trim() ? onOk(m.trim()) : setErro("Informe o motivo.")}>Cancelar pedido</button></div>
  </${Modal}>`;
}

/* ---------------- Ajustes › Fornecedores conectados (só o administrador) ---------------- */
const TIPOS = [["Webservice", "webservice"], ["Portal (site)", "portal"], ["Sem integração", "sem_integracao"]];
const SITUACAO_CONEXAO = { aguardando: "Aguardando a primeira consulta", ok: "Conectado", erro: "Com erro" };
const PORTAIS_DICA = "Portais reconhecidos pelo endereço: www.dpk.com.br, rolemarmaster.com, compreonline.pellegrino.com.br (consulta pelo servidor) e portal.tolidistribuidora.com.br (pelo programa do PC, em preparação).";
export function CartaoFornecedoresConectados() {
  const { dados } = useApp();
  const [l, setL] = useState(null), [acessos, setAcessos] = useState([]), [erro, setErro] = useState(""), [edita, setEdita] = useState(null), [teste, setTeste] = useState(null);
  // "Testar conexão": a função "compras" entra no portal com o login guardado e faz uma busca de teste, sem gravar preço
  const testar = async c => {
    setTeste({ id: c.id, rodando: true });
    const r = await api.compras.aoVivo({ acao: "testar", conexao: c.id });
    setTeste({ id: c.id, r }); await carregar();
  };
  const carregar = async () => { try { const [c, a] = await Promise.all([api.compras.conexoes.listar(), api.compras.acessos()]); setL(c); setAcessos(a || []); setErro(""); } catch (e) { setErro(semV59(e) || e.message); } };
  useEffect(() => { if (api.compras) carregar(); else setErro("Para usar Compras, rode o supabase/v59.sql no Supabase."); }, []);
  const nome = id => nomeFornecedor(dados.fornecedores.find(f => f.id === id)) || "Fornecedor fora do cadastro";
  const acesso = id => acessos.find(a => a.id === id);
  return html`<section class="card" id="cp-conexoes"><h2>Fornecedores conectados</h2>
    <span class="sub">Fornecedores que a tela Compras consulta ao vivo com o seu login. A senha fica guardada só no servidor e nunca volta para a tela.
      ${" " + PORTAIS_DICA}</span>
    ${erro ? html`<div class="aviso">${erro}</div>` : !l ? html`<span class="dica">Carregando…</span>` : html`
      ${l.length ? html`<div class="lista">${l.map(c => { const a = acesso(c.id), robo = roboDaConexao(c), onde = ondeConsulta(robo), t = teste && teste.id === c.id ? teste : null;
        return html`<div class="linha cp-conexao" key=${c.id} data-forn=${nome(c.fornecedor_id)} data-robo=${robo || ""}><span class="meio"><strong>${nome(c.fornecedor_id)}${c.ativo === false ? " (desligado)" : ""}</strong>
          <span>${(TIPOS.find(t => t[1] === c.tipo) || TIPOS[0])[0]}${c.endereco ? " · " + c.endereco : ""}${c.usuario ? " · usuário " + c.usuario : ""} · ${a ? "senha guardada em " + fmtData(a.gravado_em) : "sem senha guardada"}</span>
          <span class="cp-robo">${c.tipo === "sem_integracao" ? "Sem consulta ao vivo (preços informados e última compra)."
            : onde === "servidor" ? html`Robô: <b>${NOME_ROBO[robo]}</b> · consulta pelo servidor`
            : onde === "pc" ? html`Robô: <b>${NOME_ROBO[robo]}</b> · consulta pelo programa do PC (em preparação; o código do SMS do primeiro acesso entra junto)`
            : html`<b class="c-warn">Portal não reconhecido pelo endereço.</b> ${PORTAIS_DICA}`}</span>
          <span>${SITUACAO_CONEXAO[c.situacao] || c.situacao}${c.detalhe ? ": " + detalheLegivel(c.detalhe) : ""}</span>
          ${t ? html`<span class="cp-teste" role="status">${t.rodando ? "Testando a conexão…" : t.r && t.r.ok ? (t.r.no_pc ? "Este portal é consultado pelo programa do PC (em preparação)." : "Conectou e buscou: " + ((t.r.ofertas || []).length) + " preço(s) de teste.") : "Não conectou: " + ((t.r && t.r.erro) || "sem resposta")}</span>` : null}</span>
          <span class="cp-conexao-botoes">${onde === "servidor" && c.ativo !== false && a ? html`<button type="button" class="btn btn-sm cp-testar" disabled=${!!(t && t.rodando)} onClick=${() => testar(c)}>Testar conexão</button>` : null}
          <button type="button" class="btn btn-sm" onClick=${() => setEdita(c)}>Editar</button></span></div>`; })}</div>` : html`<span class="dica">Nenhum fornecedor conectado.</span>`}
      <div class="acoes"><button type="button" class="btn" id="cp-conectar" onClick=${() => setEdita({})}>+ Conectar fornecedor</button></div>`}
    ${edita ? html`<${EditarConexao} c=${edita} ja=${(l || []).map(x => x.fornecedor_id)} acesso=${edita.id ? acesso(edita.id) : null} onFechar=${() => setEdita(null)} onSalvo=${async () => { setEdita(null); await carregar(); }} />` : null}
  </section>`;
}

function EditarConexao({ c, ja, acesso, onFechar, onSalvo }) {
  const { dados, avisar, confirmar } = useApp();
  const forns = fornecedoresAtivos(dados.fornecedores).filter(f => c.fornecedor_id === f.id || !ja.includes(f.id));
  const [x, setX] = useState({ fornecedor_id: "", tipo: "webservice", endereco: "", usuario: "", ativo: true, obs: "", ...c });
  const [senha, setSenha] = useState(""), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const set = p => setX(o => ({ ...o, ...p }));
  const salvar = async () => {
    if (!x.fornecedor_id) return setErro("Escolha o fornecedor.");
    const end = x.endereco.trim();
    if (end && !/^https?:\/\//i.test(end)) return setErro("O endereço começa com https://");
    setSalvando(true); setErro("");
    try {
      const r = await api.compras.conexoes.salvar({ id: x.id, fornecedor_id: x.fornecedor_id, tipo: x.tipo, endereco: end, usuario: x.usuario.trim(), ativo: x.ativo, obs: x.obs.trim() });
      if (senha) await api.compras.gravarAcesso(r.id, senha);
      avisar("Fornecedor conectado salvo."); await onSalvo();
    } catch (e) { setErro(e.message); } finally { setSalvando(false); setSenha(""); }
  };
  const apagarSenha = async () => { if (!(await confirmar({ titulo: "Apagar a senha guardada", texto: "A senha deste fornecedor sai do servidor. Para consultar de novo, digite a senha outra vez.", botao: "Apagar a senha", perigo: true }))) return;
    try { await api.compras.gravarAcesso(c.id, ""); avisar("Senha apagada."); await onSalvo(); } catch (e) { setErro(e.message); } };
  const remover = async () => { if (!(await confirmar({ titulo: "Desconectar fornecedor", texto: "A conexão e a senha guardada saem. O cadastro do fornecedor, os preços e os pedidos continuam.", botao: "Desconectar", perigo: true }))) return;
    try { await api.compras.conexoes.excluir(c.id); avisar("Fornecedor desconectado."); await onSalvo(); } catch (e) { setErro(e.message); } };
  return html`<${Modal} titulo=${c.id ? "Fornecedor conectado" : "Conectar fornecedor"} onFechar=${onFechar}>
    ${c.id ? html`<p><b>${nomeFornecedor(dados.fornecedores.find(f => f.id === c.fornecedor_id))}</b></p>`
      : html`<${Campo} id="cp-cx-forn" rotulo="Fornecedor (do cadastro)" obrig><select id="cp-cx-forn" class="inp" value=${x.fornecedor_id} onChange=${e => set({ fornecedor_id: e.target.value })}>
        <option value="">Escolha…</option>${forns.map(f => html`<option key=${f.id} value=${f.id}>${nomeFornecedor(f)}</option>`)}</select></${Campo}>`}
    <div class="campo"><label>Acesso</label><${Seg} rotulo="Tipo de acesso" opcoes=${TIPOS.map(t => [t[0], "info"])} valor=${(TIPOS.find(t => t[1] === x.tipo) || TIPOS[0])[0]} onEscolha=${t => set({ tipo: TIPOS.find(y => y[0] === t)[1] })} /></div>
    ${x.tipo !== "sem_integracao" ? html`
      <${Campo} id="cp-cx-end" rotulo=${x.tipo === "portal" ? "Endereço do portal" : "Endereço do webservice"} dica=${"Começa com https://. É pelo endereço que o sistema sabe qual robô usar. " + PORTAIS_DICA}><${Texto} id="cp-cx-end" valor=${x.endereco} onMuda=${v => set({ endereco: v })} /></${Campo}>
      ${(() => { const robo = roboDaConexao({ endereco: x.endereco }); return x.endereco.trim()
        ? html`<p class="dica" id="cp-cx-robo">${robo ? "Robô reconhecido: " + NOME_ROBO[robo] + (ondeConsulta(robo) === "pc" ? " (consulta pelo programa do PC, em preparação)." : (robo === "rolemar" ? ". Usuário = o CNPJ da oficina." : ". Usuário = o e-mail de login no portal.")) : "Portal não reconhecido: a consulta ao vivo não vai funcionar neste endereço."}</p>` : null; })()}
      <div class="grade">
        <${Campo} id="cp-cx-usu" rotulo="Usuário (login no fornecedor)"><${Texto} id="cp-cx-usu" autocomplete="off" valor=${x.usuario} onMuda=${v => set({ usuario: v })} /></${Campo}>
        <${Campo} id="cp-cx-senha" rotulo=${x.tipo === "webservice" ? "Senha ou chave do webservice" : "Senha"} dica=${acesso ? "Guardada em " + fmtData(acesso.gravado_em) + ". Digite só para trocar." : "Fica guardada só no servidor."}>
          <input id="cp-cx-senha" class="inp" type="password" autocomplete="new-password" value=${senha} onInput=${e => setSenha(e.target.value)} /></${Campo}>
      </div>
      ${acesso ? html`<button type="button" class="btn-link" id="cp-cx-apagar" onClick=${apagarSenha}>Apagar a senha guardada</button>` : null}` : html`<p class="sub">Sem integração: a tela Compras usa os preços que você informar e a última compra das notas.</p>`}
    <label class="linha-check"><input type="checkbox" checked=${x.ativo !== false} onChange=${e => set({ ativo: e.target.checked })} /><span>Ligado (consultar este fornecedor)</span></label>
    <${Campo} id="cp-cx-obs" rotulo="Observação"><${Texto} id="cp-cx-obs" valor=${x.obs} onMuda=${v => set({ obs: v })} /></${Campo}>
    ${erro ? html`<div class="erros" role="alert">${erro}</div>` : null}
    <div class="acoes">${c.id ? html`<button type="button" class="btn btn-perigo" id="cp-cx-remover" onClick=${remover}>Desconectar</button>` : null}<span class="espaco"></span>
      <button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-pri" id="cp-cx-salvar" disabled=${salvando} onClick=${salvar}>${salvando ? "Salvando…" : "Salvar"}</button></div>
  </${Modal}>`;
}
