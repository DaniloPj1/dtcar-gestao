// Óleo e filtros por veículo (pedido do Danilo em 14/11/2026) — etapa 1: pesquisa por modelo, só leitura.
// Não grava nada: lê o catálogo guardado no sistema (js/catalogodados.js, funciona sem internet) e o estoque já carregado.
// Regras da pesquisa e do que mostrar: js/catalogo.js.
// Tela resumida (pedido do Danilo no mesmo dia): óleo em uma linha por resposta diferente, UMA aplicação de filtros (a que melhor casa)
// e cada filtro em uma linha; norma, fonte, observações do catálogo e as outras versões ficam atrás de botões.
import { html, useState, useEffect, useMemo } from "../lib.js";
import { useApp, Modal, Vazio } from "../ui.js";
import { lsGet, lsSet, qtdFmt, normPlaca, placaValida, exPlaca, reais } from "../util.js";
import { consultarPlaca, paraResumo } from "../placa.js";
import { carregarCatalogo, pesquisar, pesquisarVeiculo, indiceEstoque, filtroParaMostrar, resumoOleo, periodoTexto, TIPOS_FILTRO, MARCAS_PRINCIPAIS, LIMITE_BUSCA } from "../catalogo.js";

const cods = l => l && l.length ? l.join(" / ") : "—";
const OLEO_NO_RESUMO = 3;

// um filtro numa linha: "Óleo  [Em estoque] MANN W7283 (5 un.)" ou "Ar  Tecfil ARL2219 · Mahle — · MANN —"
function LinhaFiltro({ rotulo, f, onConversao }) {
  if (!f) return html`<div class="of-filtro"><span class="of-tipo">${rotulo}</span><span class="of-nada">sem código no catálogo</span></div>`;
  return html`<div class=${"of-filtro" + (f.estoque ? " of-tem" : "")}>
    <span class="of-tipo">${rotulo}</span>
    ${f.estoque
      ? html`<span class="of-cods">${f.estoque.map(e => html`<span class="of-est-item" key=${e.codigo}><em>Em estoque</em><b>${e.marca ? e.marca + " " : ""}${e.codigo}</b> (${qtdFmt(e.qtd)} un.)</span>`)}</span>`
      : html`<span class="of-cods">${MARCAS_PRINCIPAIS.map(m => html`<span class="of-marca" key=${m}><small>${m === "MAHLE" ? "Mahle" : m}</small> <b class=${f.principais[m].length ? "" : "of-traco"}>${cods(f.principais[m])}</b></span>`)}
          ${f.semSaldo.length ? html`<span class="of-semsaldo">Cadastrado, sem saldo: ${f.semSaldo.map(e => (e.marca ? e.marca + " " : "") + e.codigo).join(", ")}</span>` : null}</span>`}
    <button type="button" class="btn btn-sm of-conv" disabled=${!f.conversao.length} title=${f.conversao.length ? "Ver o mesmo filtro em outras marcas" : "Sem conversão para este código"}
      onClick=${() => onConversao({ rotulo, f })}>Conversão</button>
  </div>`;
}

// tipos: quando vem, mostra só esses filtros da aplicação (bloco "No seu estoque")
function Aplicacao({ a, cat, estoque, onConversao, tipos, detalhes }) {
  const linhas = useMemo(() => TIPOS_FILTRO.filter(([k]) => !tipos || tipos.includes(k)).map(([k, t]) => [k, t, filtroParaMostrar(cat, estoque, a.marca, a[k])]), [a, cat, estoque, tipos]);
  return html`<article class="of-app">
    <header><b>${a.montadora} ${a.modelo}</b> <span class="sub">${[a.versao, a.motor, periodoTexto(a)].filter(Boolean).join(" · ")}</span></header>
    ${linhas.map(([k, t, f]) => html`<${LinhaFiltro} key=${k} rotulo=${t} f=${f} onConversao=${x => onConversao({ ...x, a })} />`)}
    ${detalhes || tipos ? html`<footer class="sub">Catálogo ${a.catalogo}${detalhes && a.obs ? " · " + a.obs : ""}</footer>` : null}
  </article>`;
}

function ConversaoModal({ c, onFechar }) {
  const { f, rotulo, a } = c;
  const marcas = f.conversao.filter(x => !x.original), originais = f.conversao.filter(x => x.original);
  const bloco = (titulo, l) => !l.length ? null : html`<h4 class="sub-titulo">${titulo}</h4>
    <div class="of-conv-lista">${l.map(x => html`<div key=${x.marca}><span>${x.marca}</span><b>${x.codigos.join(" / ")}</b></div>`)}</div>`;
  return html`<${Modal} titulo=${"Conversão · filtro de " + rotulo.toLowerCase()} onFechar=${onFechar}>
    <p class="sub">${a.montadora} ${a.modelo}${a.motor ? " · " + a.motor : ""}${periodoTexto(a) ? " · " + periodoTexto(a) : ""}</p>
    ${f.estoque ? html`<div class="aviso ok">Em estoque: ${f.estoque.map(e => (e.marca ? e.marca + " " : "") + e.codigo + " (" + qtdFmt(e.qtd) + " un.)").join(", ")}</div>` : null}
    ${bloco("Outras marcas", marcas)}${bloco("Código original da montadora", originais)}
    <p class="sub">Conversão do catálogo Tecfil 2026. Confira a peça antes de aplicar.</p>
    <div class="acoes"><span class="espaco"></span><button type="button" class="btn" onClick=${onFechar}>Fechar</button></div>
  </${Modal}>`;
}

export function OleoFiltros() {
  const { dados } = useApp();
  const guardado = lsGet("dtcar-oleo-filtros") || {};
  const [q, setQ] = useState(guardado.q || ""), [ano, setAno] = useState(guardado.ano || "");
  const [cat, setCat] = useState(null), [erro, setErro] = useState(""), [conv, setConv] = useState(null);
  const [detOleo, setDetOleo] = useState(false), [versoes, setVersoes] = useState(false), [verOutros, setVerOutros] = useState(false);
  const carregar = () => { setErro(""); carregarCatalogo().then(setCat).catch(() => setErro("Não deu para carregar o catálogo neste aparelho. Abra o sistema uma vez com internet e tente de novo.")); };
  useEffect(carregar, []);
  useEffect(() => { lsSet("dtcar-oleo-filtros", { q, ano }); setDetOleo(false); setVersoes(false); setVerOutros(false); }, [q, ano]);
  const estoque = useMemo(() => indiceEstoque(dados.produtos), [dados.produtos]);
  // Busca pela placa (pedido do Danilo em 14/11/2026): placa do cadastro usa o cadastro, sem custo; placa de fora consulta a função
  // "placa" (básica), que guarda a cópia da consulta — quando o carro for cadastrado depois, não paga de novo. Esta tela não grava nada.
  const placa = normPlaca(q), ePlaca = placaValida(placa) && q.trim().replace(/[\s-]/g, "").length === 7;
  const doCadastro = useMemo(() => ePlaca ? dados.veiculos.find(v => v.placa === placa) || null : null, [ePlaca, placa, dados.veiculos]);
  const [cons, setCons] = useState(null);   // { placa, buscando } | { placa, r }
  useEffect(() => {
    if (!ePlaca || doCadastro) { setCons(null); return; }
    let vivo = true; setCons({ placa, buscando: true });
    const t = setTimeout(() => consultarPlaca(placa, "basico", { manual: true }).then(x => { if (vivo) setCons({ placa, r: x }); }), 600);
    return () => { vivo = false; clearTimeout(t); };
  }, [ePlaca, placa, doCadastro]);
  const daConsulta = cons && cons.placa === placa && cons.r && cons.r.ok && cons.r.encontrado ? paraResumo(cons.r.dados || {}) : null;
  const veiculo = doCadastro || daConsulta;
  const pv = useMemo(() => cat && ePlaca && veiculo ? pesquisarVeiculo(cat, veiculo, ano) : null, [cat, ePlaca, veiculo, ano]);
  const r = useMemo(() => !cat ? null : ePlaca ? (pv && pv.r) : pesquisar(cat, q, ano), [cat, q, ano, ePlaca, pv]);
  const oleos = useMemo(() => r ? resumoOleo(r.oleo) : [], [r]);
  // A prioridade é o estoque: aplicação de outro catálogo (MANN, Wega, Bosch, Vox) que tem filtro no estoque aparece sem precisar abrir
  // "outros catálogos" — só quando esse filtro do estoque ainda não apareceu na aplicação de cima.
  const outrosComEstoque = useMemo(() => {
    if (!r || !cat) return [];
    const noEstoque = a => TIPOS_FILTRO.flatMap(([k]) => { const f = filtroParaMostrar(cat, estoque, a.marca, a[k]); return f && f.estoque ? f.estoque.map(e => k + ":" + e.codigo) : []; });
    // Risco de peça errada (visto em 14/11/2026: Gol 1.6 2012 recebeu o filtro do Gol AP, "1996 em diante"): aplicação de outro catálogo
    // só entra aqui com o ano informado e período que não comece mais de 10 anos antes dele quando não tem ano final.
    const confiavel = a => !!r.ano && (a.de || a.ate) && (a.ate ? true : r.ano - a.de <= 10);
    const vistos = new Set(r.filtros.slice(0, 1).flatMap(noEstoque)), l = [];
    for (const a of r.outros) { if (!confiavel(a)) continue; const novos = noEstoque(a).filter(c => !vistos.has(c)); if (!novos.length) continue; novos.forEach(c => vistos.add(c)); l.push({ a, tipos: [...new Set(novos.map(c => c.split(":")[0]))] }); if (l.length >= 3) break; }
    return l;
  }, [r, cat, estoque]);
  const buscou = r && r.palavras.length > 0 && r.palavras.join("").length >= 2;
  const nomeVeic = v => [v.marca, v.modelo, v.ano].filter(Boolean).join(" ");
  const cr = cons && cons.placa === placa ? cons.r : null;
  const faixaPlaca = !ePlaca ? null : html`<div class=${"of-placa" + (veiculo ? "" : " of-placa-sem")} id="of-placa" role="status"><b>${exPlaca(placa)}</b>
    ${doCadastro ? html`<span>do cadastro: ${nomeVeic(doCadastro)}</span>`
      : cons && cons.buscando ? html`<span>fora do cadastro: consultando a placa…</span>`
      : daConsulta ? html`<span>fora do cadastro, pela consulta da placa: ${nomeVeic(daConsulta)}${cr.origem === "api" && cr.valor_centavos ? " (consulta paga: " + reais(cr.valor_centavos / 100) + ")" : " (sem custo: já consultada antes)"}</span>`
      : cr && cr.ok ? html`<span>placa não encontrada na consulta. Digite o modelo.</span>`
      : cr ? html`<span>fora do cadastro e a consulta não respondeu${cr.semRede ? " (sem internet)" : cr.sem_saldo ? " (sem saldo no API Placas)" : cr.desligada ? " (consulta de placa desligada)" : ""}. Digite o modelo.</span>` : null}
    ${pv && pv.entendido ? html`<span class="of-entendido">Buscando por: <b>${pv.entendido}</b></span>` : null}</div>`;
  const app = (a, tipos, detalhes) => html`<${Aplicacao} key=${(tipos ? "e" : "") + a.marca + a.modelo + a.versao + a.motor + a.de + a.ate + a.oleo + a.ar} a=${a} cat=${cat} estoque=${estoque} onConversao=${setConv} tipos=${tipos} detalhes=${detalhes} />`;
  const maisVersoes = r ? r.filtros.length - 1 : 0;

  return html`<div class="pagina of-pagina">
    <section class="card">
      <div class="of-busca">
        <label class="of-campo of-campo-modelo"><span>Modelo do carro ou placa</span>
          <input id="of-q" class="inp" type="search" autocomplete="off" placeholder="Ex.: onix 1.0, hilux 2.8 ou a placa" value=${q} onInput=${e => setQ(e.target.value)} /></label>
        <label class="of-campo of-campo-ano"><span>Ano</span>
          <input id="of-ano" class="inp" inputmode="numeric" maxlength="4" placeholder="Opcional" value=${ano} onInput=${e => setAno(e.target.value.replace(/\D/g, "").slice(0, 4))} /></label>
      </div>
      ${faixaPlaca}
      <p class="sub">Dado de catálogo: confira antes de aplicar.</p>
    </section>
    ${erro ? html`<div class="aviso aviso-erro">${erro} <button type="button" class="btn-link" onClick=${carregar}>Tentar de novo</button></div>` : null}
    ${!cat && !erro ? html`<${Vazio}>Carregando o catálogo…</${Vazio}>` : null}
    ${cat && !buscou && !ePlaca ? html`<${Vazio}>Digite o modelo do carro ou a placa. Dá para juntar marca, motor e ano: "gm onix 1.0 2018".</${Vazio}>` : null}
    ${cat && ePlaca && veiculo && !buscou ? html`<${Vazio}>Não achei "${pv ? pv.entendido : ""}" no catálogo. Digite o modelo do jeito mais simples (ex.: "gol 1.6").</${Vazio}>` : null}
    ${cat && buscou && !ePlaca && !r.oleo.length && !r.filtros.length ? html`<${Vazio}>Nada no catálogo para "${q.trim()}"${r.ano ? " em " + r.ano : ""}. Tente só o nome do modelo, sem a versão.</${Vazio}>` : null}

    ${cat && buscou && r.oleo.length ? html`<section class="card" id="of-oleo">
      <h2>Óleo do motor</h2>
      ${!detOleo ? html`<div class="of-oleos">
        ${oleos.slice(0, OLEO_NO_RESUMO).map((g, i) => html`<div class=${"of-oleo" + (g.divergente ? " of-div" : "")} key=${i}>
          <b class="of-litros">${g.litros ? g.litros + " L" : "—"}</b><b class="of-visc">${g.viscosidade || "—"}</b>
          <span class="of-oleo-carro">${g.linha.modelo} ${g.linha.motor}${periodoTexto(g.linha) ? " · " + periodoTexto(g.linha) : ""}</span>
          ${g.divergente ? html`<span class="of-selo of-selo-div">Fontes divergentes: confira</span>` : null}
          ${g.linha.aviso ? html`<span class="of-selo of-selo-aviso">${g.linha.aviso}</span>` : null}
        </div>`)}
        ${!oleos.length ? html`<p class="sub">As tabelas deste modelo têm erro conhecido. Veja os detalhes e confira no manual.</p>` : null}
      </div>` : html`<div class="of-oleos">${r.oleo.map((o, i) => html`<div class=${"of-oleo of-oleo-det" + (o.divergente ? " of-div" : "")} key=${i}>
        <b class="of-litros">${o.litros ? o.litros + " L" : "—"}</b><b class="of-visc">${o.viscosidade || "—"}</b>
        <span class="of-oleo-carro">${o.montadora} ${o.modelo} ${o.motor}${periodoTexto(o) ? " · " + periodoTexto(o) : ""}</span>
        <span class="sub of-oleo-pe">${o.norma ? "Norma: " + o.norma + " · " : ""}Fonte: ${o.fonte}</span>
        ${o.divergente ? html`<span class="of-selo of-selo-div">Fontes divergentes: ${o.divergente}. Confira.</span>` : null}
        ${o.aviso ? html`<span class="of-selo of-selo-aviso">${o.aviso}</span>` : null}
      </div>`)}
        ${r.totalOleo > r.oleo.length ? html`<p class="sub">Mostrando ${r.oleo.length} de ${r.totalOleo}. Escreva o motor ou o ano para afinar.</p>` : null}</div>`}
      <button type="button" class="btn btn-sm of-mais" id="of-det-oleo" aria-expanded=${detOleo ? "true" : "false"} onClick=${() => setDetOleo(!detOleo)}>${detOleo ? "Voltar ao resumo" : "Ver detalhes (norma e fontes: " + r.oleo.length + (r.totalOleo > r.oleo.length ? "+" : "") + ")"}</button>
    </section>` : null}

    ${cat && buscou && (r.filtros.length || outrosComEstoque.length) ? html`<section class="card" id="of-filtros">
      <h2>Filtros</h2>
      ${r.filtros.length ? app(r.filtros[0], null, versoes) : null}
      ${outrosComEstoque.length ? html`<h4 class="sub-titulo">Também no seu estoque</h4>${outrosComEstoque.map(x => app(x.a, x.tipos))}` : null}
      ${maisVersoes > 0 || r.outros.length ? html`<button type="button" class="btn btn-sm of-mais" id="of-versoes" aria-expanded=${versoes ? "true" : "false"} onClick=${() => setVersoes(!versoes)}>${versoes ? "Esconder outras versões" : "Ver outras versões" + (maisVersoes > 0 ? " (" + maisVersoes + (r.totalFiltros > r.filtros.length ? "+" : "") + ")" : "")}</button>` : null}
      ${versoes ? html`${r.filtros.slice(1).map(a => app(a, null, true))}
        ${r.totalFiltros > r.filtros.length ? html`<p class="sub">Mostrando ${r.filtros.length} de ${r.totalFiltros}. Escreva o motor ou o ano para afinar.</p>` : null}
        ${r.outros.length ? html`<button type="button" class="btn btn-sm of-outros" aria-expanded=${verOutros ? "true" : "false"} onClick=${() => setVerOutros(!verOutros)}>${verOutros ? "Esconder" : "Ver"} outros catálogos (MANN, Wega, Bosch, Vox): ${r.outros.length}${r.outros.length >= LIMITE_BUSCA ? "+" : ""}</button>` : null}
        ${verOutros ? r.outros.map(a => app(a, null, true)) : null}` : null}
    </section>` : null}
    ${conv ? html`<${ConversaoModal} c=${conv} onFechar=${() => setConv(null)} />` : null}
  </div>`;
}
