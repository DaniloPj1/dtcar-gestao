// Copia as telas do site (raiz do repositório) para desktop/site, que vai dentro do instalador.
const fs = require("fs"), path = require("path");
const raiz = path.join(__dirname, ".."), destino = path.join(__dirname, "site");
fs.rmSync(destino, { recursive: true, force: true });
const sw = fs.readFileSync(path.join(raiz, "sw.js"), "utf8");
const lista = [...(/const ARQUIVOS = \[([\s\S]*?)\];/.exec(sw)[1]).matchAll(/"([^"]+)"/g)].map(m => m[1]).filter(a => a !== "./").concat(["sw.js"]);
for (const rel of lista) { const d = path.join(destino, rel); fs.mkdirSync(path.dirname(d), { recursive: true }); fs.copyFileSync(path.join(raiz, rel), d); }
fs.copyFileSync(path.join(raiz, "icons", "icon-512.png"), path.join(__dirname, "icone.png"));
console.log("Telas copiadas:", lista.length, "arquivos");
