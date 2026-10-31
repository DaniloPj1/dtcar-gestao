// Teste da troca de telas do programa (Electron): o site publica uma versão nova → o programa baixa, avisa "Nova versão" e,
// ao recarregar ("Atualizar agora"), passa a usar as telas novas. Também confere que, depois de fechar e abrir, continua na nova.
// Uso (Linux): cd desktop && npm install && node preparar.js && cd .. && xvfb-run -a desktop/node_modules/electron/dist/electron teste/teste_troca_telas.cjs --no-sandbox
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto");
const casa = fs.mkdtempSync(path.join(os.tmpdir(), "dtcar-troca-"));
process.env.HOME = casa; process.env.APPDATA = casa; process.env.USERPROFILE = casa;
const PORTA = 9977; process.env.DTCAR_SITE = "http://127.0.0.1:" + PORTA + "/";

// "site publicado": cópia das telas do instalador com versão 99 e uma marca num arquivo (com o hash certo na lista de integridade)
const embutido = path.join(__dirname, "..", "desktop", "site"), publicado = path.join(casa, "publicado");
fs.cpSync(embutido, publicado, { recursive: true });
const ARQ = "js/util.js", MARCA = "\nwindow.__telasV99 = true;\n";
fs.appendFileSync(path.join(publicado, ARQ), MARCA);
const hash = crypto.createHash("sha256").update(fs.readFileSync(path.join(publicado, ARQ))).digest("hex");
let sw = fs.readFileSync(path.join(publicado, "sw.js"), "utf8");
sw = sw.replace(/const CACHE = "dtcar-v\d+"/, 'const CACHE = "dtcar-v99"').replace(new RegExp('"' + ARQ.replace(/[./]/g, "\\$&") + '": *"[0-9a-f]+"'), '"' + ARQ + '": "' + hash + '"');
if (!sw.includes(hash)) throw new Error("teste: não consegui trocar o hash de " + ARQ);
fs.writeFileSync(path.join(publicado, "sw.js"), sw);
const TIPOS = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };
const srv = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/+/, "") || "index.html";
  const arq = path.join(publicado, rel);
  if (!arq.startsWith(publicado) || !fs.existsSync(arq) || !fs.statSync(arq).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": TIPOS[path.extname(arq)] || "application/octet-stream" }); res.end(fs.readFileSync(arq));
});
srv.listen(PORTA);

const { app } = require("electron");
const espera = ms => new Promise(r => setTimeout(r, ms));
const resultado = { ok: [], falhas: [] }; const chk = (n, c, extra) => resultado[c ? "ok" : "falhas"].push(c ? n : n + (extra ? " ⟶ " + extra : ""));
app.on("browser-window-created", async (e, w) => {
  const js = c => w.webContents.executeJavaScript(c);
  const carregou = () => new Promise(r => w.webContents.once("did-finish-load", r));
  try {
    await carregou();
    const antes = await js("window.dtcarDesktop.info()");
    chk("abre com as telas do instalador (v" + antes.versaoTelas + ")", antes.telasDoInstalador && antes.versaoTelas < 99);
    // espera o aviso de nova versão (o programa baixa 0,5 s depois de abrir no modo de teste)
    let aviso = false; for (let i = 0; i < 60 && !aviso; i++) { await espera(500); aviso = await js("window.dtcarDesktop.novaVersao()"); }
    chk("baixou a versão nova e avisou", aviso);
    w.webContents.reload(); await carregou(); await espera(1500); // "Atualizar agora"
    const depois = await js("window.dtcarDesktop.info()"), marca = await js(`import("./${ARQ}").then(() => !!window.__telasV99)`);
    chk("depois de atualizar: telas v99", depois.versaoTelas === 99 && !depois.telasDoInstalador, JSON.stringify(depois));
    chk("depois de atualizar: arquivo novo em uso", marca);
    // outra recarga continua na nova (não volta para a do instalador)
    w.webContents.reload(); await carregou(); await espera(1000);
    const de_novo = await js("window.dtcarDesktop.info()");
    chk("recarregando de novo continua na v99", de_novo.versaoTelas === 99, JSON.stringify(de_novo));
  } catch (x) { resultado.falhas.push("EXCECAO " + x.message); }
  console.log("RESULTADO " + JSON.stringify(resultado)); srv.close(); app.quit();
});
require("../desktop/main.js");
