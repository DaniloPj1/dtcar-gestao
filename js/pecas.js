// Peças por veículo (pedido do Danilo em 15/11/2026) — regras da pesquisa, num lugar só. Sem window/document.
// Ideia do Danilo: ao montar a O.S., o sistema lê o modelo e o ano do carro e mostra só as peças de catálogo que servem nele, com a foto,
// as medidas e a conversão para outras marcas; ele escolhe e digita o valor da peça que vai comprar. NÃO depende do estoque e não cria
// produto: o catálogo é uma base separada (js/pecasdados.js, arquivo gerado por catalogo/gerar_pecas.py, carregado só quando se abre a busca).
//
// Formato dos dados:
//   catalogos: [marca, edição, pasta das fotos, ano de referência do catálogo]
//   pecas:     [catálogo, código, grupo, descrição, medidas, foto, [códigos da montadora], [[marca, código]], emBreve, embalagem]
//   apl:       [peça, montadora, modelo, anoDe, anoAte, observação]      (0 = sem limite)
//
// Regras do Danilo:
//   - a "chave" da peça é o código da montadora; quando o catálogo não traz, vale o código da própria marca (Perfect);
//   - dentro de cada peça fica o botão de conversão para as outras marcas;
//   - é dado de catálogo: a tela sempre manda conferir antes de comprar.
import { norm } from "./util.js";
import { chavesDoVeiculo } from "./catalogo.js";

let carga = null;
export function carregarPecas() {
  if (!carga) carga = import("./pecasdados.js").then(m => prepararPecas(m.default)).catch(e => { carga = null; throw e; });
  return carga;
}
const APELIDOS = { gm: "chevrolet", general: "chevrolet", vw: "volkswagen", volks: "volkswagen", mb: "mercedes", benz: "mercedes", "m.benz": "mercedes", citroën: "citroen", vwcaminhoes: "volkswagen" };
const palavras = s => norm(s).replace(/(\d),(\d)/g, "$1.$2").split(/[^a-z0-9.]+/).map(x => x.replace(/^\.+|\.+$/g, "")).filter(Boolean);
const marcaTok = s => [...new Set(palavras(s).map(x => APELIDOS[x] || x).filter(x => x.length > 1 && x !== "motors"))];

export function prepararPecas(d) {
  const pecas = d.pecas.map((r, n) => ({ n, marca: d.catalogos[r[0]][0], edicao: d.catalogos[r[0]][1], pasta: d.catalogos[r[0]][2], anoCat: d.catalogos[r[0]][3] || 0, codigo: r[1], grupo: d.grupos[r[2]], descricao: r[3], medidas: r[4],
    foto: r[5], oem: r[6], conv: r[7], breve: !!r[8], emb: r[9] || "", apl: [] }));
  const palMod = new Map(); // o mesmo nome de modelo aparece em milhares de aplicações: separa as palavras uma vez só
  const apl = d.apl.map(r => { const modelo = d.modelos[r[2]]; let t = palMod.get(r[2]); if (!t) palMod.set(r[2], t = palavras(modelo));
    const a = { peca: pecas[r[0]], montadora: d.montadoras[r[1]], modelo, de: r[3], ate: r[4], obs: d.obs[r[5]], _m: marcaTok(d.montadoras[r[1]]), _t: t };
    a._cil = a._t.filter(x => /^\d\.\d$/.test(x)); a.peca.apl.push(a); return a; });
  return { versao: d.versao, catalogos: d.catalogos.map(c => ({ marca: c[0], edicao: c[1] })), grupos: d.grupos, pecas, apl };
}

/** Código que vai para a O.S.: o da montadora quando o catálogo traz; senão o da marca (regra do Danilo). A marca e o código dela vão juntos, para a compra. */
export const chaveDaPeca = p => p.oem.length ? p.oem[0] : p.codigo;
export const codigoParaItem = p => p.oem.length ? p.oem[0] + " (" + p.marca.toUpperCase() + " " + p.codigo + ")" : p.marca.toUpperCase() + " " + p.codigo;
export const textoAplicacao = a => [a.montadora, a.modelo, a.de && a.ate ? a.de + "/" + a.ate : a.de ? a.de + " em diante" : a.ate ? "até " + a.ate : "", a.obs].filter(Boolean).join(" ");
/** Conversão da peça: códigos da montadora e das outras marcas, por marca */
export function conversaoDaPeca(p) {
  const out = []; if (p.oem.length) out.push({ marca: "Montadora (original)", codigos: p.oem });
  const m = new Map(); for (const [marca, cod] of p.conv) { if (!m.has(marca)) m.set(marca, []); if (!m.get(marca).includes(cod)) m.get(marca).push(cod); }
  for (const [marca, codigos] of m) out.push({ marca, codigos });
  return out;
}

const NOVO = /^(novo|nova|new)$/;
// "hb20x" do documento casa com "HB20 X" do catálogo (duas palavras seguidas que, juntas, dão o nome)
const temPalavra = (t, x) => t.includes(x) || t.some((y, i) => i + 1 < t.length && y + t[i + 1] === x);
/**
 * Peças de catálogo que servem no veículo { marca, modelo, ano | ano_mod, motor, combustivel }.
 * Casa a montadora (quando o veículo tem marca), o nome do modelo como palavra inteira (gol não é golf) e o ano dentro da faixa.
 * Aplicação que cita outra cilindrada sai; a que cita versão, câmbio ou motor aparece com o texto do catálogo para a pessoa conferir.
 * Devolve { entendido, ano, total, grupos: [{ grupo, itens: [{ peca, aplicacoes: [texto], conferir }] }] }.
 */
export function pecasDoVeiculo(cat, v, anoCampo) {
  const c = chavesDoVeiculo(v || {}), ano = Number(anoCampo) || c.ano;
  const nome = c.nome.length > 1 && NOVO.test(c.nome[0]) ? c.nome.slice(1) : c.nome;
  const entendido = [c.marca.join(" ").toUpperCase(), nome.join(" ").toUpperCase(), c.cil, ano || ""].filter(Boolean).join(" ");
  if (!nome.length) return { entendido: "", ano, total: 0, grupos: [] };
  const extras = new Set(c.extras);
  const achados = new Map();
  for (const a of cat.apl) {
    if (c.marca.length && a._m.length && !a._m.some(x => c.marca.includes(x))) continue;
    if (!nome.every(x => temPalavra(a._t, x))) continue;
    if (ano && ((a.de && ano < a.de) || (a.ate && ano > a.ate))) continue;
    if (c.cil && a._cil.length && !a._cil.includes(c.cil)) continue;
    // o que sobra no texto do catálogo além do nome do carro (versão, câmbio, motor): a pessoa confere
    const sobra = a._t.filter(x => !nome.includes(x) && !nome.some(n => n.startsWith(x) || n.endsWith(x)) && !NOVO.test(x) && x !== c.cil && !extras.has(x) && !/^(todos|os|modelos|e|de|da|do|com|sem)$/.test(x));
    const e = achados.get(a.peca.n) || { peca: a.peca, aplicacoes: [], conferir: true, pontos: 0 };
    // catálogo mais antigo que o carro e aplicação "de tal ano em diante": pode ser de uma geração anterior do modelo
    const velho = !!(ano && a.de && !a.ate && a.peca.anoCat && ano > a.peca.anoCat);
    e.aplicacoes.push(textoAplicacao(a) + (velho ? " (catálogo de " + a.peca.anoCat + ": confira se vale para " + ano + ")" : "")); if (!sobra.length && !a.obs && !velho) e.conferir = false;
    e.pontos = Math.max(e.pontos, (velho ? -3 : 0) + (sobra.length ? 0 : 2) + a._t.filter(x => extras.has(x)).length);
    achados.set(a.peca.n, e);
  }
  const porGrupo = new Map();
  for (const e of achados.values()) { if (!porGrupo.has(e.peca.grupo)) porGrupo.set(e.peca.grupo, []); porGrupo.get(e.peca.grupo).push(e); }
  const grupos = [...porGrupo.entries()].sort((a, b) => a[0].localeCompare(b[0], "pt-BR"))
    .map(([grupo, itens]) => ({ grupo, itens: itens.sort((a, b) => b.pontos - a.pontos || a.peca.descricao.localeCompare(b.peca.descricao, "pt-BR") || a.peca.codigo.localeCompare(b.peca.codigo)) }));
  return { entendido, ano, total: achados.size, grupos };
}
/** Filtro de texto dentro do resultado (descrição, código, medidas, conversão) */
export function filtrarPecas(grupos, txt) {
  const q = palavras(txt); if (!q.length) return grupos;
  const serve = e => { const t = norm([e.peca.descricao, e.peca.codigo, e.peca.medidas, e.peca.grupo, e.peca.oem.join(" "), e.peca.conv.map(x => x.join(" ")).join(" ")].join(" ")); return q.every(x => t.includes(x)); };
  return grupos.map(g => ({ grupo: g.grupo, itens: g.itens.filter(serve) })).filter(g => g.itens.length);
}
