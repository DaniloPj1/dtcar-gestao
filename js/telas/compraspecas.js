// Compras (v59, pedido do Danilo em 16/11/2026) — etapa 1.
// Pesquisa a peça pela PLACA do carro (essencial, pedido do Danilo) ou pelo código/descrição, mostra o preço de cada fornecedor
// numa tela só (com a origem e a data de cada preço), põe no carrinho e, ao comprar, o carrinho vira um pedido por fornecedor,
// que o Danilo finaliza em cada fornecedor depois (site, WhatsApp ou vendedor). Nada é comprado sozinho.
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
import { carregarPecas, pecasDoVeiculo, filtrarPecas, agruparEquivalentes, conversaoDoItem, chaveDaPeca } from "../pecas.js";
import { FotoPeca } from "./pecasveiculo.js";
import { DIAS_ATUAL, ORIGEM_TEXTO, SITUACOES_PEDIDO, numPedido, nomeFornecedor, totalLinha, arred2, codigosDaLinha, indiceOfertas, ofertasDaLinha,
  precosSoltos, buscarNoCatalogo, agruparCarrinho, textoPedido, normCodigo, NOME_ROBO, roboDaConexao, ondeConsulta, termosDaLinha, resumoAoVivo } from "../compraspecas.js";

const LS_BUSCA = "dtcar-compras-busca";
// tabela ausente = o v59 ainda não foi rodado (a api já traduz; aqui vale também para a resposta crua)
const semV59 = e => /compras_/.test((e && e.message) || "") && /does not exist|schema cache|Could not find/i.test(e.message) ? "Para usar Compras, rode o supabase/v59.sql no Supabase." : "";
const horaBrasilia = () => Number(new Date().toLocaleString("en-US", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" })) % 24;
const dataPreco = o => !o.em ? "sem data" : o.origem === "ultima_compra" ? fmtData(o.em) : fmtDataHora(o.em);
const fornecedoresAtivos = l => (l || []).filter(f => f.ativo !== false).slice().sort((a, b) => nomeFornecedor(a).localeCompare(nomeFornecedor(b), "pt-BR"));

/* ---------------- tela principal: Pesquisar | Carrinho | Pedidos ---------------- */
export function Compras({ params = {} }) {
  const { dados, ir } = useApp();
  const [aba, setAba] = useState(["pesquisar", "carrinho", "pedidos"].includes(params.aba) ? params.aba : "pesquisar");
  const [d, setD] = useState(null), [erro, setErro] = useState("");
  const carregar = useCallback(async () => {
    try {
      const [precos, carrinho, pedidos, conexoes, vinculos] = await Promise.all([api.compras.precos.listar(), api.compras.carrinho.listar(), api.compras.pedidos.listar(),
        api.compras.conexoes.listar(), api.vinculos.listar().catch(() => [])]);
      setD({ precos, carrinho, pedidos, conexoes, vinculos }); setErro("");
    } catch (e) { setErro(semV59(e) || e.message || "Não deu para abrir as compras agora."); }
  }, []);
  useEffect(() => { carregar(); }, []);
  const trocar = k => { setAba(k); ir("/compras" + (k === "pesquisar" ? "" : "?aba=" + k)); };
  if (erro) return html`<div class="pagina"><section class="card"><h2>Compras</h2><div class="aviso" id="cp-erro">${erro}</div>
    <div class="acoes"><button type="button" class="btn" onClick=${carregar}>Tentar de novo</button></div></section></div>`;
  if (!d) return html`<div class="pagina"><${Vazio}>Carregando as compras…</${Vazio}></div>`;
  const aFinalizar = d.pedidos.filter(p => p.situacao === "a_finalizar").length;
  return html`<div class="pagina cp-pagina">
    <${Abas} abas=${[["pesquisar", "Pesquisar peça"], ["carrinho", "Carrinho" + (d.carrinho.length ? " (" + d.carrinho.length + ")" : "")], ["pedidos", "Pedidos aos fornecedores" + (aFinalizar ? " (" + aFinalizar + " a finalizar)" : "")]]} ativa=${aba} onTroca=${trocar} />
    ${aba === "pesquisar" ? html`<${Pesquisa} d=${d} recarregar=${carregar} irCarrinho=${() => trocar("carrinho")} />`
      : aba === "carrinho" ? html`<${Carrinho} d=${d} recarregar=${carregar} irPedidos=${() => trocar("pedidos")} irPesquisa=${() => trocar("pesquisar")} />`
      : html`<${Pedidos} d=${d} recarregar=${carregar} />`}
  </div>`;
}

/* ---------------- pesquisa: placa primeiro ---------------- */
function Pesquisa({ d, recarregar, irCarrinho }) {
  const { dados } = useApp();
  const g = lsGet(LS_BUSCA) || {};
  const [placaTxt, setPlacaTxt] = useState(g.placa || ""), [txt, setTxt] = useState(g.txt || ""), [grupo, setGrupo] = useState("");
  const [cat, setCat] = useState(null), [erroCat, setErroCat] = useState("");
  const [aberta, setAberta] = useState(""), [detalhe, setDetalhe] = useState(null), [informar, setInformar] = useState(null), [aoCarrinho, setAoCarrinho] = useState(null);
  const [vivo, setVivo] = useState(null);   // { chave, buscando, r } da última consulta ao vivo (uma por clique)
  useEffect(() => { lsSet(LS_BUSCA, { placa: placaTxt, txt }); }, [placaTxt, txt]);
  useEffect(() => { let vivo = true; carregarPecas().then(c => vivo && setCat(c)).catch(() => vivo && setErroCat("Não deu para abrir o catálogo de peças agora. Abra o sistema uma vez com internet e tente de novo.")); return () => { vivo = false; }; }, []);
  // placa: a do cadastro vale sem custo; fora do cadastro, a consulta básica da função "placa" (guarda a cópia, não paga duas vezes)
  const placa = normPlaca(placaTxt), ePlaca = placaValida(placa);
  const doCadastro = useMemo(() => ePlaca ? dados.veiculos.find(v => v.placa === placa) || null : null, [ePlaca, placa, dados.veiculos]);
  const [cons, setCons] = useState(null);
  useEffect(() => {
    if (!ePlaca || doCadastro) { setCons(null); return; }
    let vivo = true; setCons({ placa, buscando: true });
    const t = setTimeout(() => consultarPlaca(placa, "basico", { manual: true }).then(x => { if (vivo) setCons({ placa, r: x }); }), 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [ePlaca, placa, doCadastro]);
  const cr = cons && cons.placa === placa ? cons.r : null;
  const daConsulta = cr && cr.ok && cr.encontrado ? paraResumo(cr.dados || {}) : null;
  const veiculo = doCadastro || daConsulta;
  const estoque = useMemo(() => dados.produtos.filter(p => p.ativo !== false && p.tipo === "produto" && p.referencia && Number(p.estoque_atual) > 0)
    .map(p => ({ id: p.id, ref: p.referencia, descricao: p.descricao, qtd: Number(p.estoque_atual) })), [dados.produtos]);
  const idx = useMemo(() => indiceOfertas({ precos: d.precos, vinculos: d.vinculos, produtos: dados.produtos, fornecedores: dados.fornecedores }), [d.precos, d.vinculos, dados.produtos, dados.fornecedores]);
  // resultado: com placa, as peças do carro (o texto filtra dentro delas); sem placa, a pesquisa no catálogo pelo código ou pela descrição
  const base = useMemo(() => {
    if (!cat) return null;
    if (ePlaca) { if (!veiculo) return null; const x = pecasDoVeiculo(cat, veiculo); return { modo: "placa", entendido: x.entendido, ano: x.ano, total: x.total, grupos: agruparEquivalentes(x.grupos, estoque) }; }
    if (txt.trim().length < 3) return null;
    const x = buscarNoCatalogo(cat, txt); return { ...x, grupos: agruparEquivalentes(x.grupos, estoque) };
  }, [cat, ePlaca, veiculo, txt, estoque]);
  const grupos = useMemo(() => !base ? [] : (base.modo === "placa" ? filtrarPecas(base.grupos, txt) : base.grupos).filter(x => !grupo || x.grupo === grupo), [base, txt, grupo]);
  const mostrados = useMemo(() => { const s = new Set(); for (const x of grupos) for (const e of x.itens) for (const k of codigosDaLinha(e)) s.add(k); return s; }, [grupos]);
  const soltos = useMemo(() => !ePlaca && txt.trim().length >= 3 ? precosSoltos(idx, txt, mostrados) : [], [ePlaca, txt, idx, mostrados]);
  const linhas = grupos.reduce((n, x) => n + x.itens.length, 0);
  const conectados = d.conexoes.filter(c => c.ativo !== false);
  const nomeDe = id => nomeFornecedor(dados.fornecedores.find(f => f.id === id));
  const noServidor = conectados.filter(c => ondeConsulta(roboDaConexao(c)) === "servidor");
  const noPC = conectados.filter(c => ondeConsulta(roboDaConexao(c)) === "pc");
  // consulta ao vivo: manda os códigos para a função "compras" (ela entra nos portais com o login guardado) e recarrega os preços
  const consultar = async (termos, chave) => {
    if (vivo && vivo.buscando) return;
    if (!termos.length) { setVivo({ chave, r: { ok: false, erro: "Esta peça não tem código para consultar." } }); return; }
    setVivo({ chave, buscando: true });
    const r = await api.compras.aoVivo({ termos, conexoes: noServidor.map(c => c.id) });
    setVivo({ chave, r });
    if (r && r.ok) await recarregar();
  };
  const estadoVivo = chave => vivo && vivo.chave === chave ? (vivo.buscando ? "Consultando os fornecedores…" : resumoAoVivo(vivo.r, nomeDe)) : "";
  const nomeVeic = v => [v.marca, v.modelo, v.ano_mod || v.ano].filter(Boolean).join(" ");

  return html`
    <section class="card cp-busca">
      <div class="cp-campos">
        <label class="cp-campo cp-campo-placa"><span>Placa do veículo</span>
          <input id="cp-placa" class="inp" autocomplete="off" maxlength="8" placeholder="ABC1D23" value=${placaTxt}
            onInput=${e => { setPlacaTxt(e.target.value.toUpperCase()); setGrupo(""); }} /></label>
        <label class="cp-campo cp-campo-txt"><span>${ePlaca ? "Filtrar as peças do carro" : "Ou código / descrição da peça"}</span>
          <input id="cp-txt" class="inp" type="search" autocomplete="off" placeholder=${ePlaca ? "Ex.: pastilha, amortecedor, código" : "Ex.: N1234, amortecedor dianteiro"} value=${txt} onInput=${e => setTxt(e.target.value)} /></label>
        ${placaTxt || txt ? html`<button type="button" class="btn cp-limpar" onClick=${() => { setPlacaTxt(""); setTxt(""); setGrupo(""); }}>Limpar</button>` : null}
      </div>
      ${ePlaca ? html`<div class=${"of-placa" + (veiculo ? "" : " of-placa-sem")} id="cp-veiculo" role="status"><b>${exPlaca(placa)}</b>
        ${doCadastro ? html`<span>do cadastro: ${nomeVeic(doCadastro)}</span>`
          : cons && cons.buscando ? html`<span>fora do cadastro: consultando a placa…</span>`
          : daConsulta ? html`<span>fora do cadastro, pela consulta da placa: ${nomeVeic(daConsulta)}${cr.origem === "api" && cr.valor_centavos ? " (consulta paga: " + reais(cr.valor_centavos / 100) + ")" : " (sem custo: já consultada antes)"}</span>`
          : cr && cr.ok ? html`<span>placa não encontrada na consulta. Pesquise pelo código ou pela descrição (deixe a placa em branco).</span>`
          : cr ? html`<span>fora do cadastro e a consulta não respondeu${cr.semRede ? " (sem internet)" : cr.sem_saldo ? " (sem saldo no API Placas)" : cr.desligada ? " (consulta de placa desligada)" : ""}. Pesquise pelo código ou pela descrição.</span>` : null}
        ${base && base.entendido ? html`<span class="of-entendido">Buscando por: <b>${base.entendido}</b></span>` : null}</div>` : null}
      <p class="sub" id="cp-origem">${noServidor.length
        ? html`<b>Consultar fornecedores</b> em cada peça busca ao vivo em <b>${noServidor.map(c => nomeDe(c.fornecedor_id)).filter(Boolean).join(", ")}</b> com o seu login (uma consulta por clique).${noPC.length ? " " + noPC.map(c => nomeDe(c.fornecedor_id)).filter(Boolean).join(", ") + ": pelo programa do PC, em preparação." : ""}`
        : conectados.length ? html`Fornecedores conectados: <b>${conectados.map(c => nomeDe(c.fornecedor_id)).filter(Boolean).join(", ")}</b>. Nenhum deles tem portal reconhecido para a consulta ao vivo: confira o endereço em Ajustes › Fornecedores conectados.`
        : html`Os preços vêm do que você informar (o que o vendedor passou) e da última compra das notas de entrada. Para consultar ao vivo, conecte os fornecedores em Ajustes › Fornecedores conectados.`}
        ${" "}Preço com mais de ${DIAS_ATUAL} dias não conta como menor preço.</p>
      ${!ePlaca && txt.trim().length >= 3 && noServidor.length ? html`<div class="acoes cp-vivo-livre"><button type="button" class="btn btn-sm" id="cp-consultar-livre" disabled=${!!(vivo && vivo.buscando)} onClick=${() => consultar([txt.trim()], "livre:" + txt.trim())}><span>Consultar fornecedores com “${txt.trim()}”</span></button>
        ${estadoVivo("livre:" + txt.trim()) ? html`<span class="dica cp-vivo-estado" role="status">${estadoVivo("livre:" + txt.trim())}</span>` : null}</div>` : null}
    </section>
    ${erroCat ? html`<div class="aviso aviso-erro">${erroCat}</div>` : null}
    ${!cat && !erroCat ? html`<${Vazio}>Carregando o catálogo de peças…</${Vazio}>` : null}
    ${cat && !ePlaca && txt.trim().length < 3 ? html`<${Vazio}>Digite a placa do carro para ver as peças que servem nele e o preço de cada fornecedor. Sem a placa, pesquise pelo código ou pela descrição da peça.</${Vazio}>` : null}
    ${base && !linhas && !soltos.length ? html`<div class="vazio" id="cp-nada">${base.modo === "placa"
      ? (base.total ? "Nada com esse filtro nas peças do carro." : html`Nenhuma peça de catálogo para ${base.entendido || "este veículo"}. Pesquise pelo código ou pela descrição (deixe a placa em branco).`)
      : html`Nada no catálogo para "${txt.trim()}".`}
      <div class="acoes"><button type="button" class="btn btn-sm" id="cp-informar-livre" onClick=${() => setInformar({ livre: txt.trim() })}>Informar preço para outro código</button></div></div>` : null}
    ${base && linhas ? html`<section class="card cp-resultado">
      <div class="cp-res-topo"><span class="sub" id="cp-res-info"><b>${linhas} ${linhas === 1 ? "peça" : "peças"}</b>${base.modo === "placa" ? " para " + base.entendido : base.modo === "codigo" ? " com esse código" : ""}${base.cortado ? " (mostrando as " + linhas + " primeiras: escreva mais para afinar)" : ""}. Dado de catálogo: confira a aplicação antes de comprar.</span>
        ${base.modo === "placa" && base.grupos.length > 1 ? html`<select id="cp-grupo" class="inp pv-sel" aria-label="Grupo de peças" value=${grupo} onChange=${e => setGrupo(e.target.value)}>
          <option value="">Todos os grupos</option>${base.grupos.map(x => html`<option key=${x.grupo} value=${x.grupo}>${x.grupo} (${x.itens.length})</option>`)}</select>` : null}</div>
      <div class="cp-lista">${grupos.map(x => html`<div key=${x.grupo} class="pv-grupo"><h4>${x.grupo}</h4>
        ${x.itens.map(e => html`<${LinhaPeca} key=${e.peca.marca + e.peca.codigo} e=${e} idx=${idx} aberta=${aberta === e.peca.codigo} onConversao=${() => setAberta(aberta === e.peca.codigo ? "" : e.peca.codigo)}
          onAmpliar=${() => setDetalhe(e)} onInformar=${() => setInformar({ e })} onCarrinho=${o => setAoCarrinho({ o, e })}
          aoVivo=${noServidor.length ? { estado: estadoVivo(e.peca.marca + e.peca.codigo), ocupado: !!(vivo && vivo.buscando), consultar: () => consultar(termosDaLinha(e), e.peca.marca + e.peca.codigo) } : null} />`)}</div>`)}</div>
    </section>` : null}
    ${soltos.length ? html`<section class="card" id="cp-soltos"><h3>Preços informados com esse código (fora do catálogo)</h3>
      <${TabelaOfertas} ofertas=${soltos.map(o => ({ ...o, menor: false }))} onCarrinho=${o => setAoCarrinho({ o, e: null })} /></section>` : null}
    ${detalhe ? html`<${DetalhePeca} e=${detalhe} onFechar=${() => setDetalhe(null)} />` : null}
    ${informar ? html`<${InformarPreco} e=${informar.e} livre=${informar.livre} onFechar=${() => setInformar(null)} onSalvo=${async () => { setInformar(null); await recarregar(); }} />` : null}
    ${aoCarrinho ? html`<${AoCarrinho} o=${aoCarrinho.o} e=${aoCarrinho.e} placa=${ePlaca ? placa : ""} onFechar=${() => setAoCarrinho(null)}
      onSalvo=${async ir => { setAoCarrinho(null); await recarregar(); if (ir) irCarrinho(); }} />` : null}`;
}

/* uma peça da pesquisa, com os preços de cada fornecedor */
function LinhaPeca({ e, idx, aberta, onConversao, onAmpliar, onInformar, onCarrinho, aoVivo }) {
  const p = e.peca, conv = conversaoDoItem(e);
  const ofertas = useMemo(() => ofertasDaLinha(idx, codigosDaLinha(e)), [idx, e]);
  return html`<div class="pv-item cp-item" data-cod=${p.codigo} data-todos=${"|" + [p.codigo, ...(e.alternativas || []).map(a => a.codigo)].join("|") + "|"}>
    <${FotoPeca} p=${p} onAbrir=${onAmpliar} />
    <div class="pv-meio"><strong>${p.descricao}</strong>
      ${p.medidas ? html`<span class="pv-med">${p.medidas}</span>` : null}
      <span class="pv-apl">${e.conferir ? html`<b class="c-warn">Confira a versão: </b>` : null}${e.aplicacoes.slice(0, 3).join(" · ")}${e.aplicacoes.length > 3 ? " · e mais " + (e.aplicacoes.length - 3) : ""}</span>
      ${e.estoque ? html`<span class="pv-estoque"><b>Tem no estoque:</b> ${e.estoque.descricao} (${qtdFmt(e.estoque.qtd)} un)</span>` : null}
      <span class="pv-cod">${p.oem.length ? "Cód. montadora " + chaveDaPeca(p) + " · " : ""}${p.marca} ${p.codigo}${(e.alternativas || []).length ? " · equivalentes: " + e.alternativas.slice(0, 3).map(a => a.marca + " " + a.codigo).join(", ") + (e.alternativas.length > 3 ? "…" : "") : ""}</span>
      ${aberta ? html`<div class="pv-conv">${conv.length ? conv.map(c => html`<div key=${c.marca}><span>${c.marca}</span><b>${c.codigos.join(" / ")}</b></div>`)
        : html`<span class="dica">O catálogo ${p.marca} não traz conversão para esta peça.</span>`}</div>` : null}</div>
    <div class="pv-botoes">${aoVivo ? html`<button type="button" class="btn btn-sm btn-pri cp-consultar" disabled=${aoVivo.ocupado} onClick=${aoVivo.consultar}>Consultar fornecedores</button>` : null}
      <button type="button" class="btn btn-sm cp-informar" onClick=${onInformar}>Informar preço</button>
      <button type="button" class="btn btn-sm pv-conversao" aria-expanded=${aberta} onClick=${onConversao}>Conversão</button></div>
    <div class="cp-precos">${aoVivo && aoVivo.estado ? html`<span class="dica cp-vivo-estado" role="status">${aoVivo.estado}</span>` : null}
      ${ofertas.length ? html`<${TabelaOfertas} ofertas=${ofertas} onCarrinho=${onCarrinho} />`
      : html`<span class="dica cp-sem-preco">Nenhum preço ainda para esta peça.${aoVivo ? " Clique em “Consultar fornecedores” para buscar ao vivo, ou use" : " Use"} “Informar preço” com o valor que o fornecedor passou.</span>`}</div>
  </div>`;
}

/* preços de uma peça: um por fornecedor e código, do menor para o maior */
function TabelaOfertas({ ofertas, onCarrinho }) {
  return html`<div class="cp-ofertas" role="table" aria-label="Preços nos fornecedores">
    ${ofertas.map(o => html`<div key=${o.chave} role="row" class=${"cp-oferta" + (o.menor ? " cp-menor" : "") + (o.antigo || o.origem === "ultima_compra" ? " cp-velho" : "")} data-forn=${o.fornecedor}>
      <span role="cell" class="cp-of-forn"><b>${o.fornecedor}</b>${o.menor ? html` <span class="pill p-ok cp-selo-menor">Menor preço</span>` : null}</span>
      <span role="cell" class="cp-of-cod">${[o.marca, o.codigo].filter(Boolean).join(" ")}</span>
      <span role="cell" class="cp-of-preco"><b>${reais(o.preco)}</b></span>
      <span role="cell" class="cp-of-est">${o.estoque === null || o.estoque === undefined ? "" : o.estoque > 0 ? qtdFmt(o.estoque) + " un no fornecedor" : html`<b class="c-bad">sem estoque no fornecedor</b>`}${o.prazo ? (o.estoque !== null && o.estoque !== undefined ? " · " : "") + o.prazo : ""}</span>
      <span role="cell" class="cp-of-origem"><b>${ORIGEM_TEXTO[o.origem]}</b> · ${dataPreco(o)}${o.antigo ? html` <span class="c-warn">(há ${o.idade === null ? "?" : o.idade} dias: confirme)</span>` : null}
        ${o.ultima ? html`<small>última compra: ${reais(o.ultima.preco)} em ${fmtData(o.ultima.em)}</small>` : null}</span>
      <span role="cell" class="cp-of-acao"><button type="button" class=${"btn btn-sm cp-add" + (o.menor ? " btn-pri" : "")} onClick=${() => onCarrinho(o)}>${I.carrinho}<span>Carrinho</span></button></span>
    </div>`)}</div>`;
}

/* peça ampliada (clicar na foto): foto grande, medidas, aplicações e conversão */
function DetalhePeca({ e, onFechar }) {
  const p = e.peca, conv = conversaoDoItem(e);
  return html`<${Modal} titulo=${p.descricao} onFechar=${onFechar} largo>
    <div class="pv-grande" id="cp-detalhe"><${FotoPeca} p=${p} grande />
      <div class="pv-meio"><span class="pv-cod">${p.grupo} · ${p.marca} ${p.codigo}${p.emb ? " · embalagem com " + p.emb : ""}</span>
        <div class="pv-bloco"><h5>Medidas</h5>${p.medidas ? html`<span class="pv-med">${p.medidas}</span>` : html`<span class="dica">O catálogo não traz medidas separadas para esta peça.</span>`}</div>
        <div class="pv-bloco"><h5>Serve em</h5>${e.conferir ? html`<span class="c-warn"><b>Confira a versão do carro.</b></span>` : null}<ul class="pv-aplis">${e.aplicacoes.map((a, n) => html`<li key=${n}>${a}</li>`)}</ul></div>
        <div class="pv-bloco"><h5>Conversão</h5>${conv.length ? html`<div class="pv-conv">${conv.map(c => html`<div key=${c.marca}><span>${c.marca}</span><b>${c.codigos.join(" / ")}</b></div>`)}</div>`
          : html`<span class="dica">O catálogo ${p.marca} não traz conversão para esta peça.</span>`}</div></div></div>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button></div>
  </${Modal}>`;
}

/* preço que o vendedor passou: fornecedor, a peça (marca e código), preço, estoque e prazo. O banco grava a data e a origem "Informado". */
function InformarPreco({ e, livre, onFechar, onSalvo }) {
  const { dados, avisar } = useApp();
  const forns = fornecedoresAtivos(dados.fornecedores);
  // opções de peça: a da linha, as equivalentes, a conversão e o código da montadora
  const opcoes = useMemo(() => {
    if (!e) return [];
    const l = [[e.peca.marca, e.peca.codigo, e.peca.descricao]], vistos = new Set([normCodigo(e.peca.codigo)]);
    const add = (marca, cod) => { const k = normCodigo(cod); if (k.length < 3 || vistos.has(k)) return; vistos.add(k); l.push([marca === "Montadora (original)" ? "ORIGINAL" : marca, cod, e.peca.descricao]); };
    for (const a of e.alternativas || []) add(a.marca, a.codigo);
    for (const c of conversaoDoItem(e)) for (const cod of c.codigos) add(c.marca, cod);
    return l;
  }, [e]);
  const [forn, setForn] = useState(forns.length === 1 ? forns[0].id : ""), [op, setOp] = useState(e ? "0" : "outro");
  const [codigo, setCodigo] = useState(livre || ""), [marca, setMarca] = useState(""), [desc, setDesc] = useState(e ? e.peca.descricao : "");
  const [preco, setPreco] = useState(0), [est, setEst] = useState(""), [prazo, setPrazo] = useState(""), [erro, setErro] = useState(""), [salvando, setSalvando] = useState(false);
  const escolhida = op === "outro" ? [marca, codigo, desc] : opcoes[Number(op)];
  const salvar = async () => {
    if (!forn) return setErro("Escolha o fornecedor.");
    if (!escolhida || normCodigo(escolhida[1]).length < 2) return setErro("Informe o código da peça no fornecedor.");
    if (!escolhida[2] || !String(escolhida[2]).trim()) return setErro("Informe a descrição da peça.");
    if (!(preco > 0)) return setErro("Informe o preço.");
    const estoque = String(est).trim() === "" ? null : parseValor(est);
    if (estoque !== null && !(estoque >= 0)) return setErro("Estoque no fornecedor inválido.");
    setSalvando(true); setErro("");
    try { await api.compras.precos.salvar({ fornecedor_id: forn, codigo: escolhida[1], marca: escolhida[0], descricao: escolhida[2], preco, estoque, prazo }); avisar("Preço guardado."); await onSalvo(); }
    catch (x) { setErro(x.message); } finally { setSalvando(false); }
  };
  return html`<${Modal} titulo="Informar preço do fornecedor" onFechar=${onFechar}>
    ${e ? html`<p class="sub">${e.peca.descricao}</p>` : null}
    ${!forns.length ? html`<div class="aviso">Nenhum fornecedor no cadastro. Cadastre em Cadastros › Fornecedores.</div>` : null}
    <${Campo} id="cp-pr-forn" rotulo="Fornecedor" obrig><select id="cp-pr-forn" class="inp" value=${forn} onChange=${x => setForn(x.target.value)}>
      <option value="">Escolha…</option>${forns.map(f => html`<option key=${f.id} value=${f.id}>${nomeFornecedor(f)}</option>`)}</select></${Campo}>
    ${e ? html`<${Campo} id="cp-pr-peca" rotulo="Peça que o fornecedor tem (marca e código)" obrig><select id="cp-pr-peca" class="inp" value=${op} onChange=${x => setOp(x.target.value)}>
      ${opcoes.map((o, n) => html`<option key=${n} value=${String(n)}>${o[0]} ${o[1]}</option>`)}<option value="outro">Outro código (digitar)</option></select></${Campo}>` : null}
    ${op === "outro" ? html`<div class="grade">
      <${Campo} id="cp-pr-cod" rotulo="Código" obrig><${Texto} id="cp-pr-cod" valor=${codigo} onMuda=${setCodigo} /></${Campo}>
      <${Campo} id="cp-pr-marca" rotulo="Marca"><${Texto} id="cp-pr-marca" class="inp maiusc" valor=${marca} onMuda=${v => setMarca(v.toUpperCase())} /></${Campo}></div>
      ${!e ? html`<${Campo} id="cp-pr-desc" rotulo="Descrição da peça" obrig><${Texto} id="cp-pr-desc" class="inp maiusc" valor=${desc} onMuda=${v => setDesc(v.toUpperCase())} /></${Campo}>` : null}` : null}
    <div class="grade">
      <${Campo} id="cp-pr-preco" rotulo="Preço (cada)" obrig><${Dinheiro} id="cp-pr-preco" valor=${preco} onMuda=${setPreco} /></${Campo}>
      <${Campo} id="cp-pr-est" rotulo="Estoque no fornecedor" dica="Opcional."><${Texto} id="cp-pr-est" inputmode="decimal" valor=${est} onMuda=${setEst} /></${Campo}>
      <${Campo} id="cp-pr-prazo" rotulo="Prazo de entrega" dica="Opcional. Ex.: amanhã cedo."><${Texto} id="cp-pr-prazo" valor=${prazo} onMuda=${setPrazo} /></${Campo}>
    </div>
    <p class="sub">O preço fica guardado com a data de hoje como “Informado”. O mesmo código no mesmo fornecedor troca o preço anterior.</p>
    ${erro ? html`<div class="erros" role="alert">${erro}</div>` : null}
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Voltar</button>
      <button type="button" class="btn btn-pri" id="cp-pr-salvar" disabled=${salvando} onClick=${salvar}>${salvando ? "Guardando…" : "Guardar preço"}</button></div>
  </${Modal}>`;
}

/* pôr no carrinho: quantidade e, se quiser, a O.S. para a qual a peça vai */
function AoCarrinho({ o, e, placa, onFechar, onSalvo }) {
  const { dados, avisar } = useApp();
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
      avisar("No carrinho: " + qtdFmt(q) + " x " + desc + " (" + o.fornecedor + ")."); await onSalvo(!continuar);
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
          <span>${SITUACAO_CONEXAO[c.situacao] || c.situacao}${c.detalhe ? ": " + c.detalhe : ""}</span>
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
