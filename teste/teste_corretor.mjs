// Confere que o corretor do módulo (js/corretor.js, usado pelo App DTCar) e a cópia do app do mecânico
// (mecanico/app.js, que não é módulo) respondem IGUAL aos mesmos casos — a regra das cópias (como whats.js).
// Uso: node teste/teste_corretor.mjs
import { readFileSync } from "node:fs";
import { novoVocabulario, corrigirFrase } from "../js/corretor.js";

const casos = JSON.parse(readFileSync(new URL("./casos_corretor.json", import.meta.url)));
const fonte = readFileSync(new URL("../mecanico/app.js", import.meta.url), "utf8");
const ini = fonte.indexOf("function semAcento(t)"), fim = fonte.indexOf("var E_SERVICO");
const copia = new Function(fonte.slice(ini, fim) + "; return { novoVocabulario, corrigirFrase };")();

let ok = 0, falhas = [];
const voc1 = novoVocabulario([]), voc2 = copia.novoVocabulario([]);
for (const [entrada, esperado] of casos) {
  const a = corrigirFrase(voc1, entrada), b = copia.corrigirFrase(voc2, entrada);
  if (a === esperado && b === esperado) ok++; else falhas.push(`${entrada}: módulo="${a}" mecânico="${b}" esperado="${esperado}"`);
}
// e o núcleo dos dois arquivos tem de ser o MESMO texto (mudou um, mude o outro)
const mod = readFileSync(new URL("../js/corretor.js", import.meta.url), "utf8");
const nucleoMod = mod.slice(mod.indexOf("function semAcento(t)"), mod.indexOf("\nexport {"));
const nucleoMec = fonte.slice(ini, fim);
if (nucleoMod.trim() === nucleoMec.trim()) ok++; else falhas.push("os núcleos de js/corretor.js e mecanico/app.js divergem");

console.log(ok + " OK" + (falhas.length ? "\nFALHAS:\n" + falhas.join("\n") : ""));
process.exit(falhas.length ? 1 : 0);
