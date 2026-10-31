// Teste do programa para Windows (Electron) sem internet: abre as telas do disco, ponte com a pasta de dados e trava de caminho.
// Uso (Linux com xvfb): cd desktop && npm install && node preparar.js && cd .. && xvfb-run -a node teste/teste_programa.js
const { execFileSync } = require("child_process"), fs = require("fs"), os = require("os"), path = require("path");
const D = path.join(__dirname, "..", "desktop"), casa = fs.mkdtempSync(path.join(os.tmpdir(), "dtcar-")), saida = path.join(casa, "saida.json");
const bin = process.platform === "win32" ? path.join(D, "node_modules", "electron", "dist", "electron.exe") : path.join(D, "node_modules", "electron", "dist", "electron");
try { execFileSync(bin, [D, "--no-sandbox", "--proxy-server=127.0.0.1:9"], { env: { ...process.env, HOME: casa, USERPROFILE: casa, APPDATA: casa, DTCAR_TESTE_SAIDA: saida }, stdio: "ignore", timeout: 60000 }); } catch (e) {}
const r = JSON.parse(fs.readFileSync(saida, "utf8")), falhas = [];
// sw.js atualizado? (lista e integridade batendo com os arquivos; senão o programa recusa as telas novas)
const sw = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8"), crypto = require("crypto");
const hashes = JSON.parse(/const INTEGRIDADE = (\{[^\n]*\});/.exec(sw)[1]);
for (const [arq, h] of Object.entries(hashes)) if (crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, "..", arq))).digest("hex") !== h) falhas.push("sw.js desatualizado (" + arq + "): rode python3 tools_sw.py");
if (/Carregando DTCar/.test(r.texto) || !/ENTRAR|Painel/i.test(r.texto)) falhas.push("telas não abriram sem internet: " + r.texto.slice(0, 80));
if (!r.ponte) falhas.push("ponte dtcarDesktop ausente");
if (!/DTCar Gestão$/.test(r.pasta.caminho)) falhas.push("pasta de dados fora de Documentos\\DTCar Gestão");
if (r.fora !== "bloqueado") falhas.push("gravou fora da pasta de dados");
if (!(r.info.versaoTelas > 0)) falhas.push("versão das telas desconhecida");
console.log(falhas.length ? "FALHAS " + JSON.stringify(falhas) : "OK: programa abre sem internet (telas v" + r.info.versaoTelas + ")");
process.exit(falhas.length ? 1 : 0);
