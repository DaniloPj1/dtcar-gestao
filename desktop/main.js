// DTCar Gestão para Windows (etapa 1 do programa instalável).
// O programa abre sempre, com ou sem internet: as telas ficam no disco do computador, não na memória do navegador.
//   - Telas: cópia que vem no instalador (resources/site) ou a versão mais nova baixada do site (pasta do usuário/site/<versão>).
//   - Atualização das telas: com internet, confere o sw.js publicado; se a versão mudou, baixa todos os arquivos numa pasta
//     nova e só troca quando tudo chegou inteiro. Atualização do próprio programa: electron-updater (GitHub Releases).
//   - Dados: nesta etapa o banco principal continua online (Supabase). A cópia local fica em Documentos\DTCar Gestão
//     (gravada pelo próprio sistema, sem precisar escolher pasta) e na cópia interna do programa.
const { app, BrowserWindow, protocol, net, ipcMain, shell, Menu, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = fs.promises;
const { pathToFileURL } = require("url");

const SITE = process.env.DTCAR_SITE || "https://gestao.dtcarcentroautomotivo.com.br/"; // DTCAR_SITE: só para teste
const ESQUEMA = "app", HOST = "dtcar";
const NOME_PASTA = "DTCar Gestão";

// pasta fixa dos dados internos do programa (%APPDATA%\DTCar Gestao), sem acento para evitar problemas no Windows
app.setPath("userData", path.join(app.getPath("appData"), "DTCar Gestao"));
protocol.registerSchemesAsPrivileged([{ scheme: ESQUEMA, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

const pastaUsuario = () => app.getPath("userData");
const pastaSites = () => path.join(pastaUsuario(), "site");
const siteEmbutido = () => app.isPackaged ? path.join(process.resourcesPath, "site") : path.join(__dirname, "site");
const pastaDados = () => path.join(app.getPath("documents"), NOME_PASTA);

// ---------- qual cópia das telas usar ----------
function lerJSON(arq) { try { return JSON.parse(fs.readFileSync(arq, "utf8")); } catch (e) { return null; } }
function versaoDoSw(texto) { const m = /const CACHE = "dtcar-v(\d+)"/.exec(texto || ""); return m ? Number(m[1]) : 0; }
function arquivosDoSw(texto) {
  const m = /const ARQUIVOS = \[([\s\S]*?)\];/.exec(texto || ""); if (!m) return [];
  return [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1]).filter(a => a !== "./" && !a.includes(".."));
}
function versaoEmbutida() { try { return versaoDoSw(fs.readFileSync(path.join(siteEmbutido(), "sw.js"), "utf8")); } catch (e) { return 0; } }
let raizAtual = null, versaoAtual = 0;
function escolherSite() {
  const atual = lerJSON(path.join(pastaSites(), "atual.json")); // { versao, pasta }
  const vEmb = versaoEmbutida();
  if (atual && atual.versao > vEmb && fs.existsSync(path.join(pastaSites(), atual.pasta, "index.html"))) { raizAtual = path.join(pastaSites(), atual.pasta); versaoAtual = atual.versao; }
  else { raizAtual = siteEmbutido(); versaoAtual = vEmb; }
}

// serve os arquivos das telas a partir do disco (forma recomendada pelo Electron: net.fetch de file://)
async function servir(req) {
  const u = new URL(req.url);
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html";
  const arq = path.normalize(path.join(raizAtual, rel));
  if (!arq.startsWith(path.normalize(raizAtual))) return new Response("Proibido", { status: 403 });
  if (!fs.existsSync(arq)) return new Response("Não encontrado", { status: 404 });
  return net.fetch(pathToFileURL(arq).toString());
}

// ---------- atualização das telas pelo site ----------
let atualizando = false;
async function baixar(url) { const r = await net.fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.status + " " + url); return Buffer.from(await r.arrayBuffer()); }
async function atualizarSite() {
  if (atualizando) return; atualizando = true;
  try {
    const sw = (await baixar(SITE + "sw.js?d=" + Date.now())).toString("utf8");
    const v = versaoDoSw(sw), lista = arquivosDoSw(sw);
    if (!v || v <= versaoAtual || !lista.includes("index.html")) return;
    const nome = "v" + v, tmp = path.join(pastaSites(), nome + ".baixando"), fim = path.join(pastaSites(), nome);
    await fsp.rm(tmp, { recursive: true, force: true });
    for (const rel of lista.concat(["sw.js"])) {
      const dados = rel === "sw.js" ? Buffer.from(sw) : await baixar(SITE + rel + "?d=" + v);
      const destino = path.join(tmp, rel); await fsp.mkdir(path.dirname(destino), { recursive: true }); await fsp.writeFile(destino, dados);
    }
    await fsp.rm(fim, { recursive: true, force: true }); await fsp.rename(tmp, fim);
    await fsp.writeFile(path.join(pastaSites(), "atual.json"), JSON.stringify({ versao: v, pasta: nome, em: new Date().toISOString() }));
    // guarda só a versão atual e a anterior
    for (const d of await fsp.readdir(pastaSites())) if (/^v\d+/.test(d) && d !== nome && d !== "v" + versaoAtual) await fsp.rm(path.join(pastaSites(), d), { recursive: true, force: true }).catch(() => {});
    escolherSite();
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("dtcar-nova-versao", v);
  } catch (e) { /* sem internet ou site fora do ar: segue com a cópia que já está no disco */ }
  finally { atualizando = false; }
}

// ---------- pasta de dados em Documentos (usada pelo js/pasta.js) ----------
function caminhoSeguro(rel) {
  const base = pastaDados(), arq = path.normalize(path.join(base, ...String(rel).split(/[\\/]+/)));
  if (!arq.startsWith(base)) throw new Error("Caminho inválido");
  return arq;
}
ipcMain.handle("pasta:info", async () => { await fsp.mkdir(path.join(pastaDados(), "dados"), { recursive: true }); await fsp.mkdir(path.join(pastaDados(), "copias"), { recursive: true }); return { caminho: pastaDados(), nome: NOME_PASTA }; });
ipcMain.handle("pasta:escrever", async (e, rel, texto) => { const a = caminhoSeguro(rel); await fsp.mkdir(path.dirname(a), { recursive: true }); const t = a + ".tmp"; await fsp.writeFile(t, texto, "utf8"); await fsp.rename(t, a); return true; });
ipcMain.handle("pasta:ler", async (e, rel) => { try { return await fsp.readFile(caminhoSeguro(rel), "utf8"); } catch (x) { return null; } });
ipcMain.handle("pasta:listar", async (e, rel) => { try { return await fsp.readdir(caminhoSeguro(rel)); } catch (x) { return []; } });
ipcMain.handle("pasta:remover", async (e, rel) => { await fsp.rm(caminhoSeguro(rel), { force: true }); return true; });
ipcMain.handle("pasta:abrir", async () => { await fsp.mkdir(pastaDados(), { recursive: true }); return shell.openPath(pastaDados()); });
ipcMain.handle("programa:info", () => ({ versaoPrograma: app.getVersion(), versaoTelas: versaoAtual, telasDoInstalador: raizAtual === siteEmbutido() }));

// ---------- janela ----------
function criarJanela() {
  const w = new BrowserWindow({
    width: 1400, height: 900, minWidth: 1000, minHeight: 650, show: false, backgroundColor: "#0f172a", title: "DTCar Gestão",
    icon: path.join(__dirname, "icone.png"), autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  w.once("ready-to-show", () => { w.maximize(); w.show(); });
  // links de fora (WhatsApp, GitHub, SEFAZ…) abrem no navegador do computador
  const externo = url => /^https?:|^mailto:|^tel:/i.test(url);
  w.webContents.setWindowOpenHandler(({ url }) => { if (externo(url)) { shell.openExternal(url); return { action: "deny" }; } return { action: "allow" }; });
  w.webContents.on("will-navigate", (ev, url) => { if (externo(url)) { ev.preventDefault(); shell.openExternal(url); } });
  w.loadURL(`${ESQUEMA}://${HOST}/index.html`);
  // teste automático (teste/teste_programa.sh): grava o que apareceu na tela e fecha
  const msgs = []; if (process.env.DTCAR_TESTE_SAIDA) { w.webContents.on("console-message", (e, l, m) => msgs.push(String(m || (e && e.message) || "").slice(0, 200)));
    w.webContents.session.webRequest.onErrorOccurred(d => msgs.push("ERRO " + d.url + " " + d.error)); }
  if (process.env.DTCAR_TESTE_SAIDA) w.webContents.once("did-finish-load", () => setTimeout(async () => {
    const r = await w.webContents.executeJavaScript(`(async () => ({ texto: document.body.innerText.slice(0, 400), ponte: !!window.dtcarDesktop,
      pasta: await window.dtcarDesktop.pasta.info(), info: await window.dtcarDesktop.info(),
      fora: await window.dtcarDesktop.pasta.escrever("../fora.txt", "x").then(() => "gravou", () => "bloqueado") }))()`).catch(e => ({ erro: e.message }));
    fs.writeFileSync(process.env.DTCAR_TESTE_SAIDA, JSON.stringify({ ...r, msgs }, null, 1)); app.quit();
  }, 6000));
  return w;
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { const w = BrowserWindow.getAllWindows()[0]; if (w) { if (w.isMinimized()) w.restore(); w.focus(); } });
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    // o nome "DTCar Gestão" entra no User-Agent; acento em cabeçalho HTTP quebra o carregamento das telas
    app.userAgentFallback = app.userAgentFallback.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\x20-\x7e]/g, "");
    await fsp.mkdir(pastaSites(), { recursive: true }).catch(() => {});
    escolherSite();
    protocol.handle(ESQUEMA, servir);
    criarJanela();
    setTimeout(atualizarSite, process.env.DTCAR_TESTE_SAIDA ? 500 : 5000); setInterval(atualizarSite, 30 * 60000);
    if (app.isPackaged) {
      try { const { autoUpdater } = require("electron-updater"); autoUpdater.autoDownload = true; autoUpdater.autoInstallOnAppQuit = true; autoUpdater.checkForUpdates().catch(() => {}); } catch (e) {}
    }
  });
  app.on("window-all-closed", () => app.quit());
}
process.on("uncaughtException", e => { try { dialog.showErrorBox("DTCar Gestão", "Erro inesperado: " + e.message); } catch (x) {} });
