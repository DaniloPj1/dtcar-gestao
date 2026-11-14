// Óleo e filtros por veículo (pedido do Danilo em 14/11/2026) — regras da pesquisa, num lugar só.
// Sem window/document: serve para a tela e, depois, para a ficha do veículo, a O.S. e o conector.
// Os dados ficam em js/catalogodados.js (arquivo gerado, ~2 MB), carregado só quando a tela abre (carregarCatalogo).
//
// Formato dos dados:
//   oleo:    [montadora, modelo, motor, anoDe, anoAte, litros, viscosidade, norma, fonte, aviso]   (0 = ano não informado / sem limite)
//   filtros: [catálogo, montadora, modelo, versão, motor, anoDe, anoAte, óleo, ar, combustível, cabine, observação]
//            (cada campo de filtro pode trazer mais de um código, separados por espaço)
//   conv:    { códigoTecfil: [[marca, código], ...] }  — conversão da Tecfil 2026; marca com "*" no fim = código original da montadora
//
// Regras do Danilo (14/11/2026):
//   - óleo: só litros, viscosidade e norma (a marca do óleo não importa);
//   - filtro que está no ESTOQUE (saldo maior que zero) aparece sozinho, com o botão de conversão: a prioridade é o estoque;
//   - fora do estoque, aparecem só Tecfil, Mahle e MANN; as outras marcas ficam atrás do botão "Conversão";
//   - é dado de catálogo: a tela manda conferir, e fonte que discorda de outra é marcada.
import { norm } from "./util.js";

export const TIPOS_FILTRO = [["oleo", "Óleo"], ["ar", "Ar"], ["combustivel", "Combustível"], ["cabine", "Cabine"]];
export const MARCAS_PRINCIPAIS = ["Tecfil", "MAHLE", "MANN"];
const NOME_MARCA = { TECFIL: "Tecfil", MAHLE: "MAHLE", MANN: "MANN", WEGA: "Wega", BOSCH: "Bosch", VOX: "Vox", FRAM: "Fram", WIX: "Wix" };
const nomeMarca = m => NOME_MARCA[String(m).toUpperCase()] || m;
const chaveMarca = m => norm(m).replace(/[^a-z0-9]/g, "");

let carga = null;
// carrega os dados uma vez só (a tela mostra "Carregando o catálogo…" enquanto isso)
export function carregarCatalogo() {
  if (!carga) carga = import("./catalogodados.js").then(m => prepararCatalogo(m.default)).catch(e => { carga = null; throw e; });
  return carga;
}

// Código de filtro do jeito que dá para comparar: sem espaço, traço, barra, "S/NF" nem o nome da marca escrito junto
// ("C231071 MANN", "HU 7008Z", "OC259 S/NF" e "0 986 B02 510" viram C231071, HU7008Z, OC259 e 0986B02510).
const PALAVRAS_FORA = /\b(S\/?\s?NF|C\/?\s?NF|MANN(?:\s*-?\s*FILTER)?|TECFIL|MAHLE|METAL\s+LEVE|BOSCH|VOX|WEGA|FRAM|WIX|AC\s?DELCO|DELPHI|MAGNETI?\s+MARELLI|HENGST|ORIGINAL)\b/g;
export const normCodigo = s => String(s ?? "").toUpperCase().replace(PALAVRAS_FORA, " ").replace(/[^A-Z0-9]/g, "");

export function prepararCatalogo(d) {
  const texto = (m, ...p) => norm([d.montadoras[m], ...p].join(" ")).replace(/(\d),(\d)/g, "$1.$2").replace(/[()\/,;]/g, " ");
  const oleo = d.oleo.map(r => ({ montadora: d.montadoras[r[0]], modelo: r[1], motor: r[2], de: r[3], ate: r[4], litros: r[5], viscosidade: r[6], norma: r[7],
    fonte: d.fontesOleo[r[8]], aviso: r[9] || "", _t: texto(r[0], r[1], r[2]), _m: norm(r[1]) }));
  const filtros = d.filtros.map(r => ({ marca: d.marcas[r[0]], catalogo: d.catalogos[r[0]], ordem: r[0], montadora: d.montadoras[r[1]], modelo: r[2], versao: r[3], motor: r[4], de: r[5], ate: r[6],
    oleo: r[7] ? r[7].split(" ") : [], ar: r[8] ? r[8].split(" ") : [], combustivel: r[9] ? r[9].split(" ") : [], cabine: r[10] ? r[10].split(" ") : [], obs: r[11] || "",
    _t: texto(r[1], r[2], r[3], r[4]), _m: norm(r[2]) }));
  // de qualquer código (de qualquer marca) para o(s) código(s) Tecfil equivalentes
  const paraTecfil = new Map();
  const liga = (cod, tec) => { const k = normCodigo(cod); if (!k) return; const l = paraTecfil.get(k); if (!l) paraTecfil.set(k, [tec]); else if (!l.includes(tec)) l.push(tec); };
  for (const tec of Object.keys(d.conv)) { liga(tec, tec); for (const [, cod] of d.conv[tec]) liga(cod, tec); }
  return { versao: d.versao, oleo, filtros, conv: d.conv, marcasConv: d.marcasConv, paraTecfil };
}

// "gm onix 1.0 2018" → palavras ["chevrolet", "onix", "1.0"] e ano 2018 (o ano também pode vir no campo próprio)
const APELIDOS = { gm: "chevrolet", vw: "volkswagen", volks: "volkswagen", mb: "mercedes", mercedes: "mercedes", citroën: "citroen", "pick-up": "pick", pickup: "pick" };
export function lerBusca(txt, anoCampo) {
  let ano = Number(anoCampo) || 0; const palavras = [];
  for (const p of norm(txt).replace(/(\d),(\d)/g, "$1.$2").replace(/[()\/,;]/g, " ").split(/\s+/).filter(Boolean)) {
    if (/^(19[5-9]\d|20[0-4]\d)$/.test(p)) { if (!ano) ano = Number(p); continue; }
    const cil = p.match(/^(\d)[.,](\d)$/); // "1,0" e "1.0" são a mesma coisa
    palavras.push(cil ? cil[1] + "." + cil[2] : APELIDOS[p] || p);
  }
  return { palavras, ano: ano >= 1950 && ano <= 2049 ? ano : 0 };
}
const serve = (r, ano) => !ano || ((!r.de || ano >= r.de) && (!r.ate || ano <= r.ate));
// nota da linha: todas as palavras têm de aparecer; palavra inteira no nome do modelo vale mais ("gol" antes de "golf")
function nota(r, palavras) {
  let n = 0;
  for (const p of palavras) {
    if (!r._t.includes(p)) return -1;
    const inteira = new RegExp("(^|[^a-z0-9.])" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9.])");
    n += inteira.test(r._m) ? 3 : inteira.test(r._t) ? 2 : r._m.includes(p) ? 1 : 0;
  }
  return n;
}
const porNota = (a, b) => b._n - a._n || a.montadora.localeCompare(b.montadora) || a.modelo.localeCompare(b.modelo, "pt-BR", { numeric: true }) || (b.de || 0) - (a.de || 0);

export const LIMITE_BUSCA = 40;
// Pesquisa por modelo (e ano). Devolve as linhas de óleo e as aplicações de filtros que servem, da melhor para a pior.
export function pesquisar(cat, txt, anoCampo) {
  const { palavras, ano } = lerBusca(txt, anoCampo);
  if (!palavras.length || palavras.join("").length < 2) return { palavras, ano, oleo: [], filtros: [], outros: [], totalOleo: 0, totalFiltros: 0 };
  // com o ano informado, a linha que diz de que ano é vem antes da que não diz; a conferida pela oficina vem antes de todas
  const acha = lista => lista.map(r => { const n = nota(r, palavras); return n < 0 || !serve(r, ano) ? null : { ...r, _n: n + (ano && (r.de || r.ate) ? 1 : 0) + (/^Conferido/.test(r.fonte || "") ? 5 : 0) }; }).filter(Boolean).sort(porNota);
  const oleo = acha(cat.oleo), todos = acha(cat.filtros);
  const tecfil = todos.filter(f => f.ordem === 0), outros = todos.filter(f => f.ordem !== 0).sort((a, b) => b._n - a._n || a.ordem - b.ordem || porNota(a, b));
  return { palavras, ano, oleo: marcarDivergencias(oleo.slice(0, LIMITE_BUSCA)), totalOleo: oleo.length,
    filtros: (tecfil.length ? tecfil : outros).slice(0, LIMITE_BUSCA), totalFiltros: tecfil.length || outros.length,
    outros: tecfil.length ? outros.slice(0, LIMITE_BUSCA) : [], principal: tecfil.length ? "Tecfil" : "" };
}

// Fontes que copiam a mesma tabela contam como uma só (Ipiranga e Maxon trazem os mesmos números).
const familia = fonte => /ipiranga|maxon/i.test(fonte) ? "ipiranga-maxon" : fonte;
const cilindradas = r => [...new Set((r.motor + " " + r.modelo).match(/\b\d\.\d\b/g) || [])].sort().join("+");
// só tabela contra tabela: linha conferida no manual ou indicada por loja não entra na comparação; turbo só compara com turbo
const eTabela = r => !/^(Conferido|Indicado)/.test(r.fonte);
const turbo = r => /turbo|\btb\b|\btd\b|tgdi|tsi|thp|t-?jet|\bgse\b|diesel|tdi|crdi|ctdi|duratorq|multijet|\bhdi\b|\bdci\b|\bcdi\b/i.test(r.motor + " " + r.modelo);
const litrosNum = l => Number(String(l).replace(",", ".")) || 0;
const cruzam = (a, b) => (!a.de && !a.ate) || (!b.de && !b.ate) || ((a.de || 0) <= (b.ate || 9999) && (b.de || 0) <= (a.ate || 9999));
// Marca "divergente" a linha de óleo que tem outra fonte, para o mesmo modelo, a mesma cilindrada e anos que se cruzam, com litros diferentes.
export function marcarDivergencias(linhas) {
  return linhas.map(a => {
    const ca = cilindradas(a), la = litrosNum(a.litros); if (!ca || !la || !eTabela(a)) return a;
    const outra = linhas.find(b => b !== a && eTabela(b) && turbo(a) === turbo(b) && familia(b.fonte) !== familia(a.fonte) && b.montadora === a.montadora && cilindradas(b) === ca
      && (b._m === a._m || b._m.startsWith(a._m + " ") || a._m.startsWith(b._m + " ")) && cruzam(a, b) && litrosNum(b.litros) && Math.abs(litrosNum(b.litros) - la) >= 0.3);
    return outra ? { ...a, divergente: outra.fonte + " indica " + outra.litros + " L" } : a;
  });
}

// Resumo do óleo para a tela (pedido do Danilo em 14/11/2026: "algo mais resumido"): uma linha por resposta diferente.
// Linhas com os mesmos litros e a mesma viscosidade viram uma só (conta quantas fontes concordam); a linha de tabela com erro
// conhecido (tem aviso) não entra no resumo, só nos detalhes. Devolve [{ litros, viscosidade, linha, fontes, divergente }].
export const linhaSuspeita = r => eTabela(r) && !!r.aviso;
export function resumoOleo(linhas) {
  const grupos = new Map();
  for (const r of linhas) {
    if (linhaSuspeita(r)) continue;
    const k = litrosNum(r.litros) + "|" + norm(r.viscosidade).split(/\s+ou\s+/).sort().join("/");
    const g = grupos.get(k) || { litros: r.litros, viscosidade: r.viscosidade, linha: r, familias: new Set(), divergente: false };
    g.familias.add(familia(r.fonte)); g.divergente = g.divergente || !!r.divergente; grupos.set(k, g);
  }
  // primeiro a conferida pela oficina, depois a resposta em que mais fontes concordam (empate: a ordem da pesquisa)
  return [...grupos.values()].map((g, i) => ({ litros: g.litros, viscosidade: g.viscosidade, linha: g.linha, fontes: g.familias.size, divergente: g.divergente, _i: i }))
    .sort((a, b) => (eTabela(a.linha) - eTabela(b.linha)) || b.fontes - a.fontes || a._i - b._i).map(({ _i, ...g }) => g);
}

export const periodoTexto = r => r.de && r.ate ? (r.de === r.ate ? String(r.de) : r.de + " a " + r.ate) : r.de ? r.de + " em diante" : r.ate ? "até " + r.ate : "";

// Estoque de filtros: código comparável → produtos do cadastro (a mesma peça pode estar em dois cadastros, com e sem "S/NF").
export function indiceEstoque(produtos) {
  const idx = new Map();
  for (const p of produtos || []) {
    if (p.tipo && p.tipo !== "produto") continue; if (p.ativo === false || !p.referencia) continue;
    if (!/filtr/i.test((p.categoria || "") + " " + (p.descricao || ""))) continue;
    const k = normCodigo(p.referencia); if (k.length < 3) continue;
    const e = idx.get(k) || { codigo: k, marca: "", qtd: 0, ids: [], descricao: p.descricao || "" };
    e.qtd += Math.max(0, Number(p.estoque_atual) || 0); e.ids.push(p.id);
    // a marca escrita na referência vale mais que o campo marca ("LX3544 MAHLE" cadastrado como MANN)
    const naRef = String(p.referencia).toUpperCase().match(/\b(MANN|TECFIL|MAHLE|BOSCH|VOX|WEGA|FRAM|WIX)\b/);
    if (!e.marca || naRef) e.marca = nomeMarca(naRef ? naRef[1] : p.marca || "");
    idx.set(k, e);
  }
  return idx;
}

// Todos os códigos equivalentes a um código de filtro, por marca: { Tecfil: [...], MANN: [...], "Toyota*": [...] }
export function equivalentes(cat, marca, codigo) {
  const k = normCodigo(codigo), tecs = cat.paraTecfil.get(k) || (chaveMarca(marca) === "tecfil" ? [String(codigo).toUpperCase()] : []);
  const out = {}; const poe = (m, c) => { const l = out[m] || (out[m] = []); if (!l.some(x => normCodigo(x) === normCodigo(c))) l.push(c); };
  poe(nomeMarca(marca), codigo);
  for (const t of tecs) { poe("Tecfil", t); for (const [mi, c] of cat.conv[t] || []) poe(nomeMarca(cat.marcasConv[mi]), c); }
  return out;
}

// O que mostrar para UM filtro de uma aplicação (ex.: o filtro de óleo da Hilux 2.8):
//   { codigos, estoque: [{marca, codigo, qtd}] | null, semSaldo: [...], principais: {Tecfil, MAHLE, MANN}, conversao: [{marca, codigos, original}] }
export function filtroParaMostrar(cat, estoque, marca, codigos) {
  if (!codigos || !codigos.length) return null;
  const eq = {};
  for (const c of codigos) for (const [m, l] of Object.entries(equivalentes(cat, marca, c))) for (const x of l) { const d = eq[m] || (eq[m] = []); if (!d.includes(x)) d.push(x); }
  const noEstoque = [], semSaldo = [], vistos = new Set();
  for (const [m, l] of Object.entries(eq)) for (const c of l) {
    const e = estoque && estoque.get(normCodigo(c)); if (!e || vistos.has(e.codigo)) continue; vistos.add(e.codigo);
    (e.qtd > 0 ? noEstoque : semSaldo).push({ marca: e.marca || m.replace(/\*$/, ""), codigo: c, qtd: e.qtd, ids: e.ids });
  }
  const principais = Object.fromEntries(MARCAS_PRINCIPAIS.map(m => [m, eq[m] || []]));
  const conversao = Object.entries(eq).filter(([m]) => noEstoque.length || !MARCAS_PRINCIPAIS.includes(m))
    .map(([m, l]) => ({ marca: m.replace(/\*$/, ""), original: m.endsWith("*"), codigos: l }))
    .sort((a, b) => (a.original - b.original) || (MARCAS_PRINCIPAIS.indexOf(b.marca) >= 0) - (MARCAS_PRINCIPAIS.indexOf(a.marca) >= 0) || a.marca.localeCompare(b.marca));
  return { codigos, estoque: noEstoque.length ? noEstoque : null, semSaldo, principais, conversao };
}
