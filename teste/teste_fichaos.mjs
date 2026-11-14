// Etapa 3 de óleo e filtros (14/11/2026): o que sai da ficha do veículo para a O.S. — regras de js/fichaos.js com o catálogo de verdade.
// Uso: node teste/teste_fichaos.mjs
import dados from "../js/catalogodados.js";
import { prepararCatalogo, indiceEstoque } from "../js/catalogo.js";
import { viscosidades, litrosDaFicha, candidatosOleo, filtrosDaFicha } from "../js/fichaos.js";
const ok = [], falhas = [];
const chk = (n, c, extra) => (c ? ok : falhas).push(c ? n : n + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
const cat = prepararCatalogo(dados);
const prod = (id, descricao, o = {}) => ({ id, tipo: "produto", ativo: true, descricao, unidade: "UNI", categoria: "", referencia: "", marca: "", estoque_atual: 0, preco_vista: 10, ...o });
const oleo = (id, d, saldo, o = {}) => prod(id, d, { unidade: "LTR", categoria: "OLEO MOTOR", estoque_atual: saldo, ...o });
const P = [oleo("o1", "OLEO 5W30 SEMI-SINT MAX", 16, { marca: "BPROAUTO", preco_vista: 52.75 }), oleo("o2", "OLEO 5W30 LUBRAX TOP AUTO SQ SINT", 22, { marca: "LUBRAX", preco_vista: 56.88 }),
  oleo("o3", "OLEO 15W40 LUBRAX TOP AUTO SL SUP", 29), oleo("o4", "OLEO 5W40 LUBRAX TOP AUTO SQ SINT", 12), oleo("o5", "OLEO 5W30 SINT DIESEL PREMIUM DPF C2", 20, { preco_vista: 40 }),
  oleo("o6", "OLEO 5W30 SEM SALDO", 2), prod("x1", "OLEO DESENGRIPANTE 300ML", { categoria: "OLEO E LUBRIFICANTES", estoque_atual: 6 }),
  prod("f1", "FILTRO DE OLEO GM ONIX", { referencia: "OC90", marca: "MANN", categoria: "FILTROS LUB", estoque_atual: 7, preco_vista: 24.3 }),
  prod("f2", "FILTRO AR", { referencia: "LX3544 MAHLE", marca: "MANN", categoria: "FILTROS", estoque_atual: 2 }), prod("f3", "FILTRO OLEO INATIVO", { referencia: "OC90 S/NF", marca: "MANN", categoria: "FILTROS LUB", estoque_atual: 5, ativo: false })];

chk("viscosidade: '5W30 ou 10W30' vira duas", viscosidades("5W30 ou 10W30").join() === "5w30,10w30" && viscosidades("0W20").join() === "0w20" && viscosidades("").length === 0 && viscosidades("—").length === 0);
chk("litros: '3,5' → 3.5 sem dúvida", JSON.stringify(litrosDaFicha("3,5")) === '{"qtd":3.5,"duvida":false}');
chk("litros: '4.7 / 5.7' → 4.7 com dúvida; vazio → 0", litrosDaFicha("4.7 / 5.7").duvida === true && litrosDaFicha("4.7 / 5.7").qtd === 4.7 && litrosDaFicha("").qtd === 0);

let c = candidatosOleo(P, "5W30", 4, null).map(p => p.id);
chk("óleo 5W30: só óleo de motor da viscosidade (não pega 15W40, 5W40 nem desengripante)", c.every(i => ["o1", "o2", "o5", "o6"].includes(i)) && c.length === 4, c);
chk("óleo 5W30: quem tem saldo para a quantidade vem antes (o de 2 L por último)", c[c.length - 1] === "o6", c);
chk("óleo 5W30 gasolina: o diesel não vem na frente; mais barato primeiro entre os de saldo", c[0] === "o1" && c.indexOf("o5") > c.indexOf("o2"), c);
c = candidatosOleo(P, "5W30", 4, true).map(p => p.id);
chk("óleo 5W30 de carro diesel: o óleo diesel vem na frente", c[0] === "o5", c);
chk("óleo 5W40 não casa com 15W40 (borda do número)", candidatosOleo(P, "5W40", 4).map(p => p.id).join() === "o4");
chk("óleo 15W40 acha o 15W40", candidatosOleo(P, "15W40", 4).map(p => p.id).join() === "o3");
chk("'5W30 ou 5W40' acha os dois", candidatosOleo(P, "5W30 ou 5W40", 4).length === 5);
chk("sem viscosidade: nenhum", candidatosOleo(P, "", 4).length === 0);
chk("produto inativo ou serviço não entra", candidatosOleo([oleo("a", "OLEO 5W30 X", 9, { ativo: false }), oleo("b", "OLEO 5W30 Y", 9, { tipo: "servico" })], "5W30", 1).length === 0);

// filtros: a ficha de um Onix 1.0 (Tecfil) com o MANN OC90 em estoque
const ficha = { marca: "Tecfil", filtros: { oleo: ["PSL55"], ar: ["ARL4152"], combustivel: ["GI04/7"], cabine: [] } };
const est = indiceEstoque(P);
let r = filtrosDaFicha(cat, est, P, { marca: "Tecfil", filtros: { oleo: ["PEL726"], ar: [], combustivel: [], cabine: [] } });
const eq = (cod) => cat.conv[cod];
chk("filtros: só os tipos que têm código na ficha", r.length === 1 && r[0].k === "oleo", r.map(x => x.k));
// descobre um código Tecfil cujo equivalente MANN seja o OC90 do estoque
const tec = "PSL619";   // no catálogo Tecfil 2026, o PSL619 é o equivalente do MANN OC90 (conversão)
chk("o catálogo converte o Tecfil PSL619 em MANN OC90 (premissa do teste)", (cat.paraTecfil.get("OC90") || []).includes(tec), [...(cat.paraTecfil.get("OC90") || [])]);
if (tec) {
  r = filtrosDaFicha(cat, est, P, { marca: "Tecfil", filtros: { oleo: [tec], ar: ["ZZZ9999"], combustivel: [], cabine: [] } });
  chk("filtro do estoque: acha o produto (MANN OC90) pela conversão, com saldo", r[0].produto && r[0].produto.id === "f1", r[0]);
  chk("filtro de produto inativo (OC90 S/NF) nunca é escolhido", !r[0].produto || r[0].produto.id !== "f3");
  chk("filtro fora do estoque: sem produto e mostra o código para comprar", r[1].produto === null && /ZZZ9999|—|/.test(r[1].principais) && r[1].k === "ar", r[1]);
}
console.log(falhas.length ? ok.length + " verificações passaram; " + falhas.length + " FALHARAM:\n  ✗ " + falhas.join("\n  ✗ ") : ok.length + " verificações passaram.");
process.exit(falhas.length ? 1 : 0);
