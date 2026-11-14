// Óleo e filtros por veículo (14/11/2026): regras de js/catalogo.js com o catálogo de verdade (js/catalogodados.js).
// Confere a pesquisa por modelo e ano, o código comparável com o estoque, a prioridade do estoque e a conversão.
// Uso: node teste/teste_catalogo.mjs
import dados from "../js/catalogodados.js";
import { prepararCatalogo, pesquisar, lerBusca, normCodigo, indiceEstoque, filtroParaMostrar, equivalentes, periodoTexto, MARCAS_PRINCIPAIS } from "../js/catalogo.js";
const ok = [], falhas = [];
const chk = (n, c, extra) => (c ? ok : falhas).push(c ? n : n + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
const cat = prepararCatalogo(dados);

// --- código comparável: referências como estão no estoque da oficina (14/11/2026)
for (const [ref, esp] of [["C231071 MANN", "C231071"], ["C23023 S/NF", "C23023"], ["HU 7008Z", "HU7008Z"], ["0986B02510 BOSCH", "0986B02510"], ["0 986 B02 510", "0986B02510"],
  ["C31003/1", "C310031"], ["LX3544 MAHLE", "LX3544"], ["ART6098 TECFIL", "ART6098"], ["W 712/83", "W71283"], ["FS89/1", "FS891"]])
  chk("código comparável " + ref, normCodigo(ref) === esp, normCodigo(ref));

// --- leitura da busca
let b = lerBusca("GM Onix 1,0 2018");
chk("busca: gm vira chevrolet, 1,0 vira 1.0, ano separado", b.palavras.join(" ") === "chevrolet onix 1.0" && b.ano === 2018, b);
chk("busca: ano do campo vale", lerBusca("hilux", "2022").ano === 2022);
chk("busca vazia não devolve nada", pesquisar(cat, " ").oleo.length === 0 && pesquisar(cat, "a").filtros.length === 0);

// --- óleo: litros e viscosidade, sem marca de óleo
let r = pesquisar(cat, "onix 1.0", 2015);
chk("Onix 1.0 2015: tem óleo", r.oleo.length > 0, r.oleo.length);
chk("Onix 1.0 2015: 3,5 L 5W30 aparece", r.oleo.some(o => o.litros === "3,5" && o.viscosidade === "5W30"));
chk("Onix: nenhuma linha fora do ano", r.oleo.every(o => (!o.de || o.de <= 2015) && (!o.ate || o.ate >= 2015)), r.oleo.filter(o => o.de > 2015).map(o => o.motor));
chk("Onix: fonte sempre escrita", r.oleo.every(o => o.fonte));
chk("óleo: nenhuma fonte traz marca de óleo no lugar da viscosidade", cat.oleo.every(o => !/lubrax|mobil|castrol|selenia|shell|ipiranga f1|havoline/i.test(o.viscosidade)), cat.oleo.find(o => /lubrax|mobil|castrol/i.test(o.viscosidade)));
r = pesquisar(cat, "hilux 2.8", 2018);
chk("Hilux 2.8 2018: linha conferida no manual (7,9 L)", r.oleo.some(o => /Conferido/.test(o.fonte) && o.litros === "7,9"), r.oleo.map(o => o.fonte + " " + o.litros));
chk("Hilux 2.8 2018: a linha de 5,9 L leva o aviso", r.oleo.filter(o => o.litros === "5,9").every(o => /7,9 L/.test(o.aviso)) );
chk("Hilux 2.8 2018: 204 cv (2022+) não aparece", !r.oleo.some(o => /204/.test(o.motor)));
r = pesquisar(cat, "hilux 2.8", 2023);
chk("Hilux 2.8 2023: indicado por lojas, não conferido", r.oleo.some(o => /não conferido/.test(o.fonte) && /204/.test(o.motor)), r.oleo.map(o => o.fonte));
chk("Hilux 2.8 2023: filtros do 204 cv (PSL916 / ARL2219)", r.filtros.some(f => f.oleo.includes("PSL916") && f.ar.includes("ARL2219")), r.filtros.map(f => f.motor + " " + f.oleo));
chk("Hilux 2.8 2023: catálogo principal é a Tecfil", r.principal === "Tecfil" && r.filtros.every(f => f.marca === "Tecfil"));
r = pesquisar(cat, "gol 1.6");
chk("gol: o Gol vem antes do Golf", /^gol\b/i.test(r.filtros[0].modelo) && !/^golf/i.test(r.filtros[0].modelo), r.filtros.slice(0, 3).map(f => f.modelo));
r = pesquisar(cat, "onix 1.0", 2015);
const div = pesquisar(cat, "onix").oleo.filter(o => o.divergente);
chk("divergência: Ipiranga e Maxon não contam como duas fontes", div.every(o => !/Ipiranga|Maxon/.test(o.fonte) || !/Ipiranga|Maxon/.test(o.divergente)), div.map(o => o.fonte + " x " + o.divergente));
chk("período escrito", periodoTexto({ de: 2016, ate: 2021 }) === "2016 a 2021" && periodoTexto({ de: 2022, ate: 0 }) === "2022 em diante" && periodoTexto({ de: 0, ate: 2012 }) === "até 2012" && periodoTexto({ de: 0, ate: 0 }) === "");

// --- filtros: Tecfil, Mahle e MANN; o resto na conversão
const semEstoque = new Map();
let f = filtroParaMostrar(cat, semEstoque, "Tecfil", ["PSL916"]);
chk("PSL916 sem estoque: mostra as três marcas", !f.estoque && f.principais.Tecfil[0] === "PSL916" && f.principais.MANN.includes("W7283"), f.principais);
chk("PSL916: conversão sem Tecfil/Mahle/MANN e com Wega, Vox e Toyota original", !f.conversao.some(c => MARCAS_PRINCIPAIS.includes(c.marca)) && ["Wega", "Vox"].every(m => f.conversao.some(c => c.marca === m)) && f.conversao.some(c => c.marca === "Toyota" && c.original), f.conversao.map(c => c.marca));
chk("conversão: originais da montadora por último", f.conversao.findIndex(c => c.original) > f.conversao.findIndex(c => !c.original));
chk("filtro sem código não inventa nada", filtroParaMostrar(cat, semEstoque, "Tecfil", []) === null);
f = filtroParaMostrar(cat, semEstoque, "Tecfil", ["ARL2219"]);
chk("marca sem código fica vazia (traço na tela), sem puxar outra", f.principais.MANN.length === 0 && f.principais.MAHLE.length === 0 && f.principais.Tecfil[0] === "ARL2219", f.principais);

// --- prioridade do estoque
const prod = (referencia, marca, estoque_atual, mais = {}) => ({ id: referencia, tipo: "produto", ativo: true, descricao: "FILTRO " + referencia, categoria: "FILTROS LUB", referencia, marca, estoque_atual, ...mais });
const eqOleo = equivalentes(cat, "Tecfil", "PSL916");
chk("equivalentes do PSL916 trazem MANN W7283", (eqOleo.MANN || []).includes("W7283"), eqOleo);
let est = indiceEstoque([prod("W 7283 MANN", "MANN", 3), prod("W7283 S/NF", "MANN", 2), prod("JFO0215", "WEGA", 0), prod("KYB-334", "KAYABA", 4, { descricao: "AMORTECEDOR", categoria: "SUSPENSAO" }), prod("PSL916", "TECFIL", 5, { ativo: false })]);
chk("estoque: mesma peça com e sem S/NF soma o saldo", est.get("W7283").qtd === 5, est.get("W7283"));
chk("estoque: peça que não é filtro e produto inativo ficam de fora", !est.has("KYB334") && !est.has("PSL916"));
f = filtroParaMostrar(cat, est, "Tecfil", ["PSL916"]);
chk("em estoque: aparece só o do estoque (MANN W7283, 5 un.)", f.estoque && f.estoque.length === 1 && f.estoque[0].marca === "MANN" && f.estoque[0].qtd === 5, f.estoque);
chk("em estoque: a conversão passa a trazer também Tecfil e Mahle/MANN", f.conversao.some(c => c.marca === "Tecfil") && f.conversao.some(c => c.marca === "MANN"));
chk("saldo zerado não conta como estoque e fica avisado", f.semSaldo.some(s => s.codigo === "JFO0215") && !f.estoque.some(s => s.codigo === "JFO0215"), f.semSaldo);
est = indiceEstoque([prod("JFO0215", "WEGA", 0)]);
f = filtroParaMostrar(cat, est, "Tecfil", ["PSL916"]);
chk("só saldo zerado: volta para Tecfil, Mahle e MANN", !f.estoque && f.semSaldo.length === 1 && f.principais.Tecfil.length === 1);
est = indiceEstoque([prod("LX3544 MAHLE", "MANN", 2)]);
chk("marca escrita na referência vale mais que o campo marca", est.get("LX3544").marca === "MAHLE", est.get("LX3544"));
est = indiceEstoque([prod("0986B02510 BOSCH", "BOSCH", 4)]);
const apB = cat.filtros.find(a => a.marca === "Bosch" && a.ar.includes("0986B02510"));
chk("catálogo Bosch tem o 0986B02510", !!apB);
f = apB && filtroParaMostrar(cat, est, "Bosch", apB.ar);
chk("filtro Bosch do estoque achado pelo catálogo Bosch", f && f.estoque && f.estoque[0].marca === "Bosch" && f.estoque[0].qtd === 4, f && f.estoque);
est = indiceEstoque([prod("PSL916", "TECFIL", 2), prod("W7283", "MANN", 1)]);
f = filtroParaMostrar(cat, est, "Tecfil", ["PSL916"]);
chk("dois no estoque para o mesmo filtro: aparecem os dois", f.estoque.length === 2, f.estoque);

// --- o arquivo de dados
chk("dados: só os cinco catálogos de filtro (Mahle 2013 fora)", dados.catalogos.length === 5 && !dados.catalogos.some(c => /mahle/i.test(c)));
chk("dados: sem moto, caminhão e trator nas montadoras", !dados.montadoras.some(m => /^(YAMAHA|SCANIA|KAWASAKI|MASSEY|VALTRA|JOHN DEERE|DAFRA)/.test(m)), dados.montadoras.filter(m => /^(YAMAHA|SCANIA|KAWASAKI|MASSEY|VALTRA|JOHN DEERE|DAFRA)/.test(m)));
chk("dados: óleo sempre com litros ou viscosidade", dados.oleo.every(o => o[5] || o[6]));

console.log(ok.length + " verificações passaram" + (falhas.length ? "; " + falhas.length + " FALHARAM:" : "."));
for (const x of falhas) console.log("  ✗ " + x);
process.exit(falhas.length ? 1 : 0);
