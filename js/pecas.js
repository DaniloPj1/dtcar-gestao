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

/* ---------- A mesma peça de marcas diferentes numa linha só (pedido do Danilo em 15/11/2026) ----------
 * Duas peças do mesmo grupo viram uma linha quando o catálogo diz que são equivalentes (uma cita o código da outra na conversão, ou as duas têm o
 * mesmo código da montadora) e não mudam posição (dianteira/traseira, lado, superior/inferior). Nunca junta duas peças da mesma marca: isso é modelo
 * diferente, não só marca diferente. A linha mostra a peça que está no estoque; sem estoque, a mais completa (código da montadora, foto, medidas).
 * As outras viram conversão. estoque = [{ ref, descricao, qtd }] (produtos ativos com saldo; ref = código/referência cadastrado). */
const nc = t => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const nm = t => { const m = String(t || "").toLowerCase().replace(/[^a-z0-9]/g, ""); return m.startsWith("hipper") ? "hipper" : m; };
const mesmaMarca = (a, b) => { a = nm(a); b = nm(b); return a === b || (a.length > 3 && b.startsWith(a)) || (b.length > 3 && a.startsWith(b)); };
const posicao = d => { const t = String(d || "").toUpperCase(); return { eixo: /DIANTEIR/.test(t) ? "D" : /TRASEIR/.test(t) ? "T" : "", nivel: /SUPERIOR/.test(t) ? "S" : /INFERIOR/.test(t) ? "I" : "", lado: /\bLD\/LE\b|\bLE\/LD\b|AMBOS/.test(t) ? "" : /\bLD\b|DIREIT/.test(t) ? "LD" : /\bLE\b|ESQUERD/.test(t) ? "LE" : "" }; };
const compativel = (a, b) => ["eixo", "nivel", "lado"].every(k => !a[k] || !b[k] || a[k] === b[k]);
const ORDEM_MARCA = ["Nakata", "Fremax", "Fras-le", "Controil", "Lonaflex", "Axios", "Perfect", "Hipper Freios", "Cofap"];
const completa = p => (p.oem.length ? 4 : 0) + (p.foto ? 2 : 0) + (p.medidas ? 1 : 0) + (p.conv.length ? 1 : 0) - ORDEM_MARCA.indexOf(p.marca) / 20;
const codigosDe = p => [p.codigo, ...p.oem, ...p.conv.map(c => c[1])].map(nc).filter(x => x.length >= 4);
export function agruparEquivalentes(grupos, estoque = []) {
  const emEstoque = new Map(); for (const x of estoque) { const k = nc(x.ref); if (k.length >= 4 && !emEstoque.has(k)) emEstoque.set(k, x); }
  return grupos.map(g => {
    const its = g.itens, pos = its.map(e => posicao(e.peca.descricao)), pai = its.map((_, i) => i);
    const raiz = i => { while (pai[i] !== i) { pai[i] = pai[pai[i]]; i = pai[i]; } return i; };
    const membrosDe = r => its.map((_, i) => i).filter(i => raiz(i) === r);
    // via = a peça que cita as duas como conversão: ela pode ter mais de uma peça da mesma marca como conversão (ex.: dois códigos Cofap para o mesmo amortecedor Nakata)
    const citados = new Map();
    const ligar = (i, j, via = null) => {
      const a = raiz(i), b = raiz(j); if (a === b) return;
      const ma = membrosDe(a), mb = membrosDe(b);
      const daVia = k => via !== null && (k === via || (citados.get(via) || new Set()).has(k));
      for (const x of ma) for (const y of mb) if (mesmaMarca(its[x].peca.marca, its[y].peca.marca) && !(daVia(x) && daVia(y))) return;
      pai[b] = a;
    };
    const porCodigo = new Map(); its.forEach((e, i) => { const k = nc(e.peca.codigo); if (!porCodigo.has(k)) porCodigo.set(k, []); porCodigo.get(k).push(i); });
    // 1) a conversão de uma cita o código da outra
    its.forEach((e, i) => { for (const [marca, cod] of e.peca.conv) for (const j of porCodigo.get(nc(cod)) || []) if (j !== i && mesmaMarca(marca, its[j].peca.marca) && compativel(pos[i], pos[j])) { if (!citados.has(i)) citados.set(i, new Set()); citados.get(i).add(j); } });
    for (const [i, js] of citados) for (const j of js) ligar(i, j, i);
    // 2) o mesmo código da montadora (só com posição conhecida nas duas)
    const porOem = new Map(); its.forEach((e, i) => e.peca.oem.forEach(o => { const k = nc(o); if (k.length >= 5) { if (!porOem.has(k)) porOem.set(k, []); porOem.get(k).push(i); } }));
    for (const ix of porOem.values()) for (let a = 0; a < ix.length; a++) for (let b = a + 1; b < ix.length; b++) if (pos[ix[a]].eixo && pos[ix[b]].eixo && compativel(pos[ix[a]], pos[ix[b]])) ligar(ix[a], ix[b]);
    const grupo = new Map(); its.forEach((e, i) => { const r = raiz(i); if (!grupo.has(r)) grupo.set(r, []); grupo.get(r).push(e); });
    const itens = [...grupo.values()].map(membros => {
      const casa = m => codigosDe(m.peca).map(k => emEstoque.get(k)).find(Boolean);
      const noEstoque = membros.find(m => emEstoque.has(nc(m.peca.codigo))) || membros.find(m => m.peca.oem.some(o => emEstoque.has(nc(o)))) || membros.find(casa);
      const escolhida = noEstoque || [...membros].sort((a, b) => completa(b.peca) - completa(a.peca))[0];
      const outros = membros.filter(m => m !== escolhida).map(m => m.peca);
      const aplicacoes = [...new Set(membros.flatMap(m => m.aplicacoes))];
      // estoque: qualquer código da linha (da peça escolhida ou das equivalentes) que exista no cadastro
      const est = membros.map(casa).find(Boolean) || null;
      return { ...escolhida, aplicacoes, alternativas: outros, estoque: est, pontos: Math.max(...membros.map(m => m.pontos)) };
    });
    itens.sort((a, b) => (b.estoque ? 1 : 0) - (a.estoque ? 1 : 0) || b.pontos - a.pontos || a.peca.descricao.localeCompare(b.peca.descricao, "pt-BR") || a.peca.codigo.localeCompare(b.peca.codigo));
    return { grupo: g.grupo, itens };
  });
}
/** Conversão da linha: a da peça escolhida mais as equivalentes (marca e código delas) */
export function conversaoDoItem(e) {
  const out = conversaoDaPeca(e.peca), acha = marca => { let x = out.find(o => mesmaMarca(o.marca, marca) || o.marca === marca); if (!x) { x = { marca, codigos: [] }; out.push(x); } return x; };
  const add = (marca, cod) => { if (!cod || mesmaMarca(marca, e.peca.marca)) return; const x = acha(marca); if (!x.codigos.includes(cod)) x.codigos.push(cod); };
  for (const a of e.alternativas || []) { add(a.marca, a.codigo); for (const o of a.oem) add("Montadora (original)", o); for (const [m, c] of a.conv) add(m, c); }
  return out;
}
