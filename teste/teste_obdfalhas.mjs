// Conferências da busca de código de falha (js/obdfalhas.js) contra os arquivos gerados de verdade.
import * as f from "../js/obdfalhas.js";
let n = 0; const t = (c, m) => { n++; if (!c) { console.error("FALHOU: " + m); process.exit(1); } };

t(f.eGenerico("P0301") && f.eGenerico("P2A00") && f.eGenerico("P3400") && f.eGenerico("U0100") && f.eGenerico("U3000") && f.eGenerico("B0001") && f.eGenerico("C0035"), "genéricos");
t(!f.eGenerico("P1456") && !f.eGenerico("P3000") && !f.eGenerico("B1318") && !f.eGenerico("C1234") && !f.eGenerico("U1000") && !f.eGenerico("XYZ"), "montadora não é genérico");
t(f.soCodigo("p0301-00") === "P0301" && f.soCodigo("U0100:87") === "U0100" && f.soCodigo(" P0420 ") === "P0420", "tira o sufixo do tipo");
t(f.marcaDe("Chevrolet").arquivo === "gm" && f.marcaDe("VW - VolksWagen").arquivo === "vw" && f.marcaDe("JEEP").arquivo === "chrysler", "marca do cadastro");
t(f.marcaDe("Renault") === null && f.marcaDe("Toyota", "9BWZZZ") === null, "marca sem tabela não é adivinhada pelo chassi");
t(f.marcaDe("", "93HGM2660GZ123456").arquivo === "honda" && f.marcaDe("", "9BGKS48T0FG000000").arquivo === "gm" && f.marcaDe("", "XXX") === null, "sem cadastro, vale o chassi");

const a = await f.explicar("P0301");
t(a.achou && a.generico && a.descricao && a.causas.length > 10 && a.origemCausas.includes("Honda"), "P0301 tem descrição e causas, e diz que as causas são da Honda");
t(a.causas.some(c => c.nivel === 1) && a.secoes.some(s => s.chave === "viu"), "P0301 mantém os níveis e as seções");
const b = await f.explicar("P0171-00");
t(b.achou && b.codigo === "P0171" && b.causas.length >= 10, "P0171 (título lixo na Honda) usa o texto SAE e mantém as causas");
const gm = await f.explicar("B1000", { marca: "Chevrolet" });
t(gm.achou && gm.marca === "GM" && !gm.causas.length && /GM/.test(gm.origem) && /não conferida/.test(gm.origem), "montadora: tabela da marca, sem causa, origem escrita");
const fam = await f.explicar("P1000", { marca: "Fiat" });
t(fam.achou && fam.marca === "Chrysler" && /divide códigos/.test(fam.origem), "Fiat procura na família quando não tem");
const semMarca = await f.explicar("P1456", { marca: "Renault" });
t(!semMarca.pt || semMarca.achou || /não há tabela/.test(semMarca.origem), "marca sem tabela cai na lista geral ou diz que não há");
const ruim = await f.explicar("ZZZZ");
t(!ruim.achou && /formato/.test(ruim.origem), "código fora do formato não inventa");
const vw = await f.explicar("P1023", { marca: "Volkswagen" });
t(vw.achou && vw.marca === "Volkswagen", "VW acha código de montadora");
const todos = await f.explicarTodos([{ codigo: "P0301" }, { codigo: "P0301-11" }, { codigo: "P0420" }], {});
t(Object.keys(todos).length === 2 && todos.P0420.achou, "lista: sem repetir código");
f.usarCarregador(() => Promise.reject(new Error("sem rede")));
const off = await f.explicar("P0301");
t(!off.achou && /sem internet/.test(off.origem), "sem internet não rejeita: diz o motivo");
// nenhuma causa pode sair marcada como português sem estar no arquivo de tradução conferida
console.log(n + " conferências dos códigos de falha passaram.");
