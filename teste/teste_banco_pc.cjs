// Teste do banco no PC (etapa 2a) no programa de verdade (Electron), contra um Supabase falso local:
// 1) com "internet": entra, replica as tabelas para o SQLite do PC;  2) "sem internet": reabre e confere O.S., impressão,
// contas a pagar e funcionários lidos do banco do PC.
// Uso (Linux): cd desktop && npm install && node preparar.js && cd .. && xvfb-run -a desktop/node_modules/electron/dist/electron teste/teste_banco_pc.cjs --no-sandbox
const http = require("http"), fs = require("fs"), os = require("os"), path = require("path");
const casa = fs.mkdtempSync(path.join(os.tmpdir(), "dtcar-banco-"));
process.env.HOME = casa; process.env.APPDATA = casa; process.env.USERPROFILE = casa;
const PORTA = 9988, URL_FALSA = "http://127.0.0.1:" + PORTA;
// as telas do instalador passam a falar com o servidor falso
const cfgArq = path.join(__dirname, "..", "desktop", "site", "js", "config.js");
fs.writeFileSync(cfgArq, fs.readFileSync(cfgArq, "utf8").replace(/https:\/\/[a-z0-9]+\.supabase\.co/, URL_FALSA));

const agora = new Date().toISOString();
const D = {
  perfis: [{ id: "u1", nome: "Danilo", email: "d@x", papel: "admin", ativo: true, criado_em: agora, atualizado_em: agora }],
  clientes: [{ id: "c1", nome: "Cliente A", telefone: "27999990000", criado_em: agora, atualizado_em: agora }],
  veiculos: [{ id: "v1", placa: "ABC1D23", marca: "Fiat", modelo: "Uno", cliente_id: "c1", criado_em: agora, atualizado_em: agora }],
  produtos: [{ id: "p1", codigo: 1, tipo: "produto", descricao: "PASTILHA DE FREIO", preco_vista: 120, estoque_atual: 4, criado_em: agora, atualizado_em: agora }],
  ordens: [{ id: "o1", numero: 1900, status: "execucao", cliente_id: "c1", veiculo_id: "v1", cliente: { nome: "Cliente A", telefone: "27999990000" }, veiculo: { placa: "ABC1D23", marca: "Fiat", modelo: "Uno", ano: "2015" },
    km_entrada: 1000, total: 240, recebido: 0, desconto: 0, checkin: {}, criado_em: agora, atualizado_em: agora },
    { id: "o2", numero: 1890, status: "entregue", cliente_id: "c1", veiculo_id: "v1", cliente: { nome: "Cliente A" }, veiculo: { placa: "ABC1D23", marca: "Fiat", modelo: "Uno" },
    total: 100, recebido: 100, finalizada_em: agora, entregue_em: agora, desconto: 0, checkin: {}, criado_em: agora, atualizado_em: agora }],
  os_itens: [{ id: "i1", ordem_id: "o1", tipo: "peca", descricao: "PASTILHA DE FREIO", qtd: 2, valor_unit: 120, desconto: 0, aprovado: true, executado: false, posicao: 0, criado_em: agora, atualizado_em: agora }],
  eventos: [{ id: 1, ordem_id: "o1", tipo: "abertura", texto: "O.S. aberta.", usuario_nome: "Danilo", criado_em: agora, atualizado_em: agora }],
  contas: [{ id: "k1", descricao: "Aluguel da oficina", favorecido: "Imobiliária", valor: 3000, vencimento: agora.slice(0, 10), status: "aberta", criado_em: agora, atualizado_em: agora }],
  funcionarios: [{ id: "f1", nome: "Carlos Mecânico", ativo: true, criado_em: agora, atualizado_em: agora }],
  recibos: [{ id: "r1", numero: 10, ordem_id: "o2", valor: 100, data: agora.slice(0, 10), forma: "PIX", pagador: "Cliente A", criado_em: agora, atualizado_em: agora }],
};
let modo = "ok";
const sessao = (() => { const b = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: b({ alg: "HS256" }) + "." + b({ sub: "u1", exp, role: "authenticated" }) + ".x", token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r",
    user: { id: "u1", email: "d@x", aud: "authenticated", role: "authenticated" } }; })();
const srv = http.createServer((req, res) => {
  if (modo === "fora") { req.socket.destroy(); return; }
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const u = new URL(req.url, URL_FALSA), m = /\/rest\/v1\/(\w+)/.exec(u.pathname), obj = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  let body = obj ? null : [];
  if (u.pathname.includes("/auth/v1/health")) body = { ok: true };
  else if (m && m[1] === "config") body = obj ? { dados: {} } : [{ id: 1, dados: {}, atualizado_em: agora }];
  else if (m && m[1] === "exclusoes") body = [];
  else if (m && m[1] === "rpc") body = {};
  else if (m && D[m[1]]) { let l = D[m[1]]; const id = u.searchParams.get("id"); if (id && id.startsWith("eq.")) l = l.filter(x => String(x.id) === id.slice(3));
    const oid = u.searchParams.get("ordem_id"); if (oid && oid.startsWith("eq.")) l = l.filter(x => x.ordem_id === oid.slice(3)); body = obj ? l[0] || null : l; }
  res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body));
});
srv.listen(PORTA);

const { app, BrowserWindow } = require("electron");
const espera = ms => new Promise(r => setTimeout(r, ms));
const resultado = { ok: [], falhas: [] }; let ultimoTexto = ""; const chk = (n, c) => resultado[c ? "ok" : "falhas"].push(c ? n : n + " ⟶ " + ultimoTexto.slice(ultimoTexto.indexOf("Sistema") > 0 ? ultimoTexto.indexOf("Backup") : 0, 900).replace(/\n/g, " | "));
app.on("browser-window-created", async (e, w) => {
  const js = c => w.webContents.executeJavaScript(c);
  const carregou = () => new Promise(r => w.webContents.once("did-finish-load", r));
  try {
    await carregou();
    await js(`localStorage.setItem("sb-127-auth-token", ${JSON.stringify(JSON.stringify(sessao))})`);
    w.webContents.reload(); await carregou(); await espera(9000); // entra, carrega e replica (3 s depois)
    const info = await js("window.dtcarDesktop.banco.info()");
    chk("réplica no banco do PC (" + JSON.stringify(info.tabelas) + ")", info.tabelas.ordens === 2 && info.tabelas.os_itens === 1 && info.tabelas.contas === 1 && info.tabelas.funcionarios === 1);
    // sem internet: o servidor derruba toda conexão
    modo = "fora";
    w.webContents.reload(); await carregou(); await espera(6000);
    let t = ultimoTexto = await js("document.body.innerText");
    chk("abre sem internet com dados do banco do PC", t.includes("Sem internet") && !t.includes("ENTRAR"));
    const nItens = await js(`import("./js/api.js").then(m => m.api.ordem("o1")).then(o => o.itens.length + "|" + (o._local ? "local" : "servidor"))`);
    chk("O.S. do banco do PC traz os itens (" + nItens + ")", nItens.startsWith("1|"));
    await js(`location.hash = "#/os/o1"`); await espera(2500); t = ultimoTexto = await js("document.body.innerText");
    chk("O.S. abre sem internet (tela da O.S.)", t.includes("OS 01900") && !t.includes("Abrindo O.S.") && !t.includes("Não foi possível abrir"));
    await js(`location.hash = "#/os/o2"`); await espera(2000); t = ultimoTexto = await js("document.body.innerText");
    chk("O.S. fechada também abre sem internet", t.includes("01890") || t.includes("Fechada"));
    await js(`location.hash = "#/imprimir/os/o1"`); await espera(2500); t = ultimoTexto = await js("document.body.innerText");
    chk("impressão da O.S. sem internet", t.includes("PASTILHA DE FREIO") && !t.includes("Preparando documento"));
    await js(`location.hash = "#/financeiro"`); await espera(2000); t = ultimoTexto = await js("document.body.innerText");
    chk("contas a pagar sem internet", t.includes("Aluguel da oficina") && !t.includes("precisa de internet"));
    await js(`location.hash = "#/funcionarios"`); await espera(2000); t = ultimoTexto = await js("document.body.innerText");
    chk("funcionários sem internet", t.includes("Carlos Mecânico"));
    await js(`location.hash = "#/recibos"`); await espera(2000); t = ultimoTexto = await js("document.body.innerText");
    chk("recibos sem internet", t.includes("Cliente A"));
    // programa recém-atualizado que nunca abriu com internet: banco do PC vazio → usa a cópia do navegador (não "aguardando liberação")
    await js("window.dtcarDesktop.banco.zerar()");
    w.webContents.reload(); await carregou(); await espera(6000); t = ultimoTexto = await js("document.body.innerText");
    chk("banco do PC vazio: abre com a cópia do navegador", t.includes("Sem internet") && !/aguardando libera/i.test(t) && t.includes("banco de dados do PC ainda não foi carregado"));
    await js(`location.hash = "#/os/o1"`); await espera(2500); t = ultimoTexto = await js("document.body.innerText");
    chk("banco do PC vazio: O.S. guardada abre", t.includes("01900") && !t.includes("Abrindo O.S.") && !t.includes("Não foi possível abrir"));
    // sem nenhuma cópia do acesso: avisa "Sem internet" (nunca "aguardando liberação" nem "Sair")
    await js(`import("./js/local.js").then(m => m.local.apagarTudo())`);
    w.webContents.reload(); await carregou(); await espera(6000); t = ultimoTexto = await js("document.body.innerText");
    chk("sem cópia do acesso: tela Sem internet", /sem internet/i.test(t) && !/aguardando libera/i.test(t));
    // com o acesso guardado mas sem nenhuma cópia dos dados: avisa em vez de "Carregando" sem fim
    await js(`import("./js/local.js").then(m => m.local.gravar("perfil:u1", ${JSON.stringify(D.perfis[0])}))`);
    fs.rmSync(path.join(app.getPath("documents"), "DTCar Gestão"), { recursive: true, force: true }); // cópia da pasta também some
    w.webContents.reload(); await carregou(); await espera(6000); t = ultimoTexto = await js("document.body.innerText");
    chk("sem cópia dos dados: aviso (não fica em Carregando)", t.includes("sem cópia dos dados") && !t.includes("Carregando dados"));
  } catch (x) { resultado.falhas.push("EXCECAO " + x.message); }
  fs.writeFileSync(path.join(casa, "resultado.json"), JSON.stringify(resultado, null, 1));
  console.log("RESULTADO " + JSON.stringify(resultado)); srv.close(); app.quit();
});
require("../desktop/main.js");
