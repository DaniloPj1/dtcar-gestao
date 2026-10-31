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
const crypto = require("crypto");
const sha256 = dados => crypto.createHash("sha256").update(dados).digest("hex");
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
function hashesDoSw(texto) { const m = /const INTEGRIDADE = (\{[^\n]*\});/.exec(texto || ""); try { return m ? JSON.parse(m[1]) : null; } catch (e) { return null; } }
/** Caminho dentro da pasta base, sem escapar por "..", pasta vizinha de nome parecido ou atalho (link) do Windows */
function confinar(base, rel) {
  if (typeof rel !== "string" || rel.includes("\0")) throw new Error("Caminho inválido");
  base = path.resolve(base);
  const alvo = path.resolve(base, rel.replace(/[\\/]+/g, path.sep)), trecho = path.relative(base, alvo);
  if (!trecho || trecho === ".." || trecho.startsWith(".." + path.sep) || path.isAbsolute(trecho)) throw new Error("Caminho inválido");
  let atual = base; // a própria base pode ser um link (Documentos no OneDrive); o que está dentro dela, não
  for (const parte of trecho.split(path.sep)) { atual = path.join(atual, parte); try { if (fs.lstatSync(atual).isSymbolicLink()) throw new Error("Caminho inválido"); } catch (e) { if (e.code !== "ENOENT") throw e; } }
  return alvo;
}
/** Cópia baixada válida: mesma versão, todos os arquivos presentes e, quando o site publica a integridade, idênticos ao publicado */
function copiaCompleta(pasta, versao) {
  try {
    const sw = fs.readFileSync(path.join(pasta, "sw.js"), "utf8"), lista = arquivosDoSw(sw), hashes = hashesDoSw(sw);
    return versaoDoSw(sw) === versao && lista.includes("index.html") &&
      lista.every(rel => { const arq = confinar(pasta, rel); return fs.statSync(arq).isFile() && !!hashes && !!hashes[rel] && sha256(fs.readFileSync(arq)) === hashes[rel]; });
  } catch (e) { return false; }
}
function versaoEmbutida() { try { return versaoDoSw(fs.readFileSync(path.join(siteEmbutido(), "sw.js"), "utf8")); } catch (e) { return 0; } }
let raizAtual = null, versaoAtual = 0;
function escolherSite() {
  const atual = lerJSON(path.join(pastaSites(), "atual.json")); // { versao, pasta, arquivos }
  const vEmb = versaoEmbutida();
  // a cópia baixada só vale se estiver completa (todos os arquivos da lista); senão volta para a do instalador e baixa de novo
  const completa = atual && atual.pasta === "v" + atual.versao && copiaCompleta(path.join(pastaSites(), atual.pasta), atual.versao);
  if (atual && !completa) { try { fs.rmSync(path.join(pastaSites(), "atual.json"), { force: true }); } catch (e) {} }
  if (completa && atual.versao > vEmb) { raizAtual = path.join(pastaSites(), atual.pasta); versaoAtual = atual.versao; }
  else { raizAtual = siteEmbutido(); versaoAtual = vEmb; }
}

// a troca para as telas novas só acontece quando a página recarrega (nunca mistura arquivos de duas versões)
let trocaPendente = false;
// serve os arquivos das telas a partir do disco (forma recomendada pelo Electron: net.fetch de file://)
async function servir(req) {
  const u = new URL(req.url);
  if (u.protocol !== ESQUEMA + ":" || u.hostname !== HOST) return new Response("Proibido", { status: 403 });
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index.html";
  let arq; try { arq = confinar(raizAtual, rel); } catch (e) { return new Response("Proibido", { status: 403 }); }
  if (!fs.existsSync(arq)) return new Response("Não encontrado", { status: 404 });
  // sem cache do navegador: depois de trocar as telas, o "Atualizar agora" carregava os módulos .js antigos guardados na
  // memória do Chromium (o programa dizia "v25" e rodava a v24). Arquivo local: ler de novo não custa nada.
  const r = await net.fetch(pathToFileURL(arq).toString());
  const h = new Headers(r.headers); h.set("Cache-Control", "no-store");
  return new Response(r.body, { status: r.status, headers: h });
}

// ---------- atualização das telas pelo site ----------
let atualizando = false;
async function baixar(url) { const r = await net.fetch(url, { cache: "no-store" }); if (!r.ok) throw new Error(r.status + " " + url); return Buffer.from(await r.arrayBuffer()); }
async function atualizarSite() {
  if (atualizando) return; atualizando = true;
  try {
    const sw = (await baixar(SITE + "sw.js?d=" + Date.now())).toString("utf8");
    const v = versaoDoSw(sw), lista = arquivosDoSw(sw), hashes = hashesDoSw(sw);
    const jaBaixada = trocaPendente ? (lerJSON(path.join(pastaSites(), "atual.json")) || {}).versao || 0 : 0;
    if (!v || v <= Math.max(versaoAtual, jaBaixada) || !lista.includes("index.html")) return;
    if (!hashes || lista.some(rel => !hashes[rel])) throw new Error("lista de integridade ausente ou incompleta"); // sem conferência, não troca
    const nome = "v" + v, tmp = path.join(pastaSites(), nome + ".baixando"), fim = path.join(pastaSites(), nome);
    await fsp.rm(tmp, { recursive: true, force: true });
    for (const rel of lista.concat(["sw.js"])) {
      const dados = rel === "sw.js" ? Buffer.from(sw) : await baixar(SITE + rel + "?d=" + v);
      if (rel !== "sw.js" && sha256(dados) !== hashes[rel]) throw new Error("arquivo diferente do publicado: " + rel);
      const destino = confinar(tmp, rel); await fsp.mkdir(path.dirname(destino), { recursive: true }); await fsp.writeFile(destino, dados);
    }
    // o site pode ter sido publicado de novo no meio do download: só aceita se a versão continuar a mesma
    if (versaoDoSw((await baixar(SITE + "sw.js?d=" + Date.now())).toString("utf8")) !== v) throw new Error("versão mudou durante o download");
    await fsp.rm(fim, { recursive: true, force: true }); await fsp.rename(tmp, fim);
    await fsp.writeFile(path.join(pastaSites(), "atual.json"), JSON.stringify({ versao: v, pasta: nome, arquivos: lista.concat(["sw.js"]), em: new Date().toISOString() }));
    // guarda só a versão atual e a anterior
    for (const d of await fsp.readdir(pastaSites())) if (/^v\d+/.test(d) && d !== nome && d !== path.basename(raizAtual)) await fsp.rm(path.join(pastaSites(), d), { recursive: true, force: true }).catch(() => {});
    trocaPendente = true; // vale na próxima vez que a tela recarregar ("Atualizar agora")
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send("dtcar-nova-versao", v);
  } catch (e) { console.warn("[telas] atualização não concluída:", e && e.message); /* sem internet ou site fora do ar: segue com a cópia que já está no disco */ }
  finally { atualizando = false; }
}

// ---------- pasta de dados em Documentos (usada pelo js/pasta.js) ----------
const caminhoSeguro = rel => confinar(pastaDados(), String(rel));
ipcMain.handle("pasta:info", async () => { await fsp.mkdir(path.join(pastaDados(), "dados"), { recursive: true }); await fsp.mkdir(path.join(pastaDados(), "copias"), { recursive: true }); return { caminho: pastaDados(), nome: NOME_PASTA }; });
// gravações no mesmo arquivo entram em fila (a última pedida é a que fica); arquivo temporário com nome único
const gravacoes = new Map();
ipcMain.handle("pasta:escrever", async (e, rel, texto) => {
  const a = caminhoSeguro(rel), anterior = gravacoes.get(a) || Promise.resolve();
  const tarefa = anterior.catch(() => {}).then(async () => {
    await fsp.mkdir(path.dirname(a), { recursive: true });
    const t = a + "." + crypto.randomUUID() + ".tmp";
    try { await fsp.writeFile(t, String(texto), { encoding: "utf8", flag: "wx" }); await fsp.rename(t, a); return true; }
    finally { await fsp.rm(t, { force: true }).catch(() => {}); }
  });
  gravacoes.set(a, tarefa);
  try { return await tarefa; } finally { if (gravacoes.get(a) === tarefa) gravacoes.delete(a); }
});
ipcMain.handle("pasta:ler", async (e, rel) => { try { return await fsp.readFile(caminhoSeguro(rel), "utf8"); } catch (x) { return null; } });
ipcMain.handle("pasta:listar", async (e, rel) => { try { return await fsp.readdir(caminhoSeguro(rel)); } catch (x) { return []; } });
ipcMain.handle("pasta:remover", async (e, rel) => { await fsp.rm(caminhoSeguro(rel), { force: true }); return true; });
ipcMain.handle("pasta:abrir", async () => { await fsp.mkdir(pastaDados(), { recursive: true }); return shell.openPath(pastaDados()); });
// banco de dados no PC (etapa 2)
require("./banco.js").registrar(ipcMain, app, pastaDados);
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
  // o programa nunca abre janelas novas nem sai das próprias telas: o que for de fora vai para o navegador do Windows
  w.webContents.setWindowOpenHandler(({ url }) => { if (externo(url)) shell.openExternal(url); return { action: "deny" }; });
  // telas novas já baixadas entram quando a janela recarrega por inteiro (botão "Atualizar agora")
  w.webContents.on("did-start-navigation", (ev, url, mesmaPagina, quadroPrincipal) => {
    const d = ev && typeof ev === "object" && "url" in ev ? ev : { url, isSameDocument: mesmaPagina, isMainFrame: quadroPrincipal };
    if (trocaPendente && d.isMainFrame && !d.isSameDocument && String(d.url).startsWith(`${ESQUEMA}://${HOST}/`)) { trocaPendente = false; escolherSite(); }
  });
  w.webContents.on("will-navigate", (ev, url) => { if (url.startsWith(`${ESQUEMA}://${HOST}/`)) return; ev.preventDefault(); if (externo(url)) shell.openExternal(url); });
  w.loadURL(`${ESQUEMA}://${HOST}/index.html`);
  // teste automático (teste/teste_programa.sh): grava o que apareceu na tela e fecha
  const msgs = []; if (process.env.DTCAR_TESTE_SAIDA) { w.webContents.on("console-message", (e, l, m) => msgs.push(String(m || (e && e.message) || "").slice(0, 200)));
    w.webContents.session.webRequest.onErrorOccurred(d => msgs.push("ERRO " + d.url + " " + d.error)); }
  if (process.env.DTCAR_TESTE_SAIDA) w.webContents.once("did-finish-load", () => setTimeout(async () => {
    const r = await w.webContents.executeJavaScript(`(async () => ({ texto: document.body.innerText.slice(0, 400), ponte: !!window.dtcarDesktop,
      pasta: await window.dtcarDesktop.pasta.info(), info: await window.dtcarDesktop.info(),
      fora: await window.dtcarDesktop.pasta.escrever("../fora.txt", "x").then(() => "gravou", () => "bloqueado") }))()`).catch(e => ({ erro: e.message }));
    // recarrega a janela e confere de novo (troca de telas baixadas só no recarregamento)
    const antes = { ...r, msgs };
    w.webContents.reload();
    w.webContents.once("did-finish-load", () => setTimeout(async () => {
      antes.depoisDeRecarregar = await w.webContents.executeJavaScript("window.dtcarDesktop.info()").catch(e => ({ erro: e.message }));
      fs.writeFileSync(process.env.DTCAR_TESTE_SAIDA, JSON.stringify(antes, null, 1)); app.quit();
    }, 1500));
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
