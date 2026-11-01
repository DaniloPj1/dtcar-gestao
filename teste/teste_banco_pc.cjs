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
const hoje = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10); // data local (perto da meia-noite o dia UTC já virou)
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
  contas: [{ id: "k1", descricao: "Aluguel da oficina", favorecido: "Imobiliária", valor: 3000, vencimento: hoje, status: "aberta", criado_em: agora, atualizado_em: agora }],
  funcionarios: [{ id: "f1", nome: "Carlos Mecânico", ativo: true, criado_em: agora, atualizado_em: agora }],
  recibos: [{ id: "r1", numero: 10, ordem_id: "o2", valor: 100, data: hoje, forma: "PIX", pagador: "Cliente A", criado_em: agora, atualizado_em: agora }],
};
let modo = "ok", cfgSrv = {}; const atraso = { ms: 0, rota: "" }; // resposta lenta de propósito (teste de concorrência)
const sessao = (() => { const b = o => Buffer.from(JSON.stringify(o)).toString("base64url"); const exp = Math.floor(Date.now() / 1000) + 3600;
  return { access_token: b({ alg: "HS256" }) + "." + b({ sub: "u1", exp, role: "authenticated" }) + ".x", token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "r",
    user: { id: "u1", email: "d@x", aud: "authenticated", role: "authenticated" } }; })();
// filtros do PostgREST usados pelo sistema: coluna=eq.valor e coluna=in.(a,b)
const filtrar = (l, sp) => { for (const [k, v] of sp) { if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(k)) continue;
  if (v.startsWith("eq.")) l = l.filter(x => String(x[k]) === v.slice(3));
  else if (v.startsWith("in.(")) { const s = new Set(v.slice(4, -1).split(",").map(x => x.replace(/^"|"$/g, ""))); l = l.filter(x => s.has(String(x[k]))); } }
  return l; };
let seqEvento = 100;
// a função do supabase/v15.sql, imitada aqui (a de verdade é testada no Postgres pelo teste/teste_v15.sh)
const canon = v => v == null ? null : typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) && !isNaN(Date.parse(v)) ? new Date(v).toISOString()
  : Array.isArray(v) ? v.map(canon) : typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => [k, canon(v[k])])) : v;
const igualJ = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const SEM = k => k === "atualizado_em" || k === "criado_em";
function rpcSinc(op, forcar) {
  if (op.tipo === "ping") return { ok: "pong" };
  const o = D.ordens.find(x => x.id === op.ordem_id); if (!o) return { conflito: "a O.S. não existe mais no online" };
  if (!forcar && "espelho" in op && ((cfgSrv.ultimoEspelho && cfgSrv.ultimoEspelho.em) || "") !== (op.espelho || "")) return { conflito: "houve uma carga nova do sistema antigo depois desta alteração" };
  const agoraJa = new Date().toISOString(), fechou = b => ["entregue", "cancelado"].includes(o.status) && o.status !== b ? { conflito: "a O.S. foi " + (o.status === "entregue" ? "entregue" : "cancelada") + " no online" } : null;
  if (op.tipo === "alterar_os") {
    const ks = Object.keys(op.patch);
    if (ks.every(k => igualJ(o[k], op.patch[k]))) return { ok: true, reenvio: true };
    if (!forcar) { const f = fechou(op.status_base); if (f) return f; const mud = ks.filter(k => !igualJ(o[k], op.antes[k]) && !igualJ(o[k], op.patch[k])); if (mud.length) return { conflito: "no online alteraram " + mud.join(", ") }; }
    Object.assign(o, op.patch, { atualizado_em: agoraJa }); escritas.push(["RPC", "ordens", op.patch]); return { ok: true };
  }
  if (op.tipo === "itens_os") {
    if (!forcar) { const f = fechou(op.antes.status); if (f) return f;
      for (const it of op.itens) { const base = op.antes.itens[it.id], cur = D.os_itens.find(x => x.id === it.id);
        if (!cur) { if (base && typeof base === "object") return { conflito: "o item “" + it.descricao + "” foi removido no online" }; continue; }
        if (Object.keys(it).every(k => SEM(k) || igualJ(cur[k], it[k]))) continue;
        if (!base || typeof base !== "object") return { conflito: "o item “" + cur.descricao + "” já existe no online com outro conteúdo" };
        if (!Object.keys(base).every(k => SEM(k) || igualJ(cur[k], base[k]))) return { conflito: "o item “" + cur.descricao + "” foi alterado no online" }; }
      for (const id of op.removidos) { const base = op.antes.itens[id], cur = D.os_itens.find(x => x.id === id); if (!cur || !base || typeof base !== "object") continue;
        if (!Object.keys(base).every(k => SEM(k) || igualJ(cur[k], base[k]))) return { conflito: "o item “" + cur.descricao + "” foi alterado no online" }; } }
    D.os_itens = D.os_itens.filter(x => !(op.removidos.includes(x.id) && x.ordem_id === o.id));
    for (const it0 of op.itens) { const { atualizado_em, criado_em, ...it } = it0, cur = D.os_itens.find(x => x.id === it.id);
      if (cur) Object.assign(cur, it, { ordem_id: o.id, atualizado_em: agoraJa }); else D.os_itens.push({ ...it, ordem_id: o.id, criado_em: agoraJa, atualizado_em: agoraJa }); }
    escritas.push(["RPC", "os_itens", op.itens.length]); return { ok: true };
  }
  if (op.tipo === "evento_os") { const ev = op.evento;
    if (!D.eventos.some(e => e.ordem_id === o.id && e.tipo === ev.tipo && Date.parse(e.criado_em) === Date.parse(ev.criado_em))) D.eventos.push({ ...ev, id: ++seqEvento, atualizado_em: agoraJa });
    return { ok: true }; }
  return { conflito: "tipo desconhecido" };
}
const srv = http.createServer((req, res) => {
  if (modo === "fora") { req.socket.destroy(); return; }
  res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*"); res.setHeader("Access-Control-Allow-Methods", "*");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  let txt = ""; req.on("data", c => { txt += c; }); req.on("end", () => {
  const u = new URL(req.url, URL_FALSA), m = /\/rest\/v1\/(\w+)/.exec(u.pathname), obj = /vnd\.pgrst\.object/.test(req.headers.accept || "");
  let body = obj ? null : [];
  const t = m && m[1], agoraJa = new Date().toISOString();
  if (u.pathname.includes("/auth/v1/health")) body = { ok: true };
  else if (t === "config") body = obj ? { id: 1, dados: cfgSrv } : [{ id: 1, dados: cfgSrv, atualizado_em: agora }];
  else if (t === "exclusoes") body = [];
  else if (t === "rpc" && /\/rpc\/sincronizar_alteracao_os/.test(u.pathname)) { const b = JSON.parse(txt || "{}"); body = rpcSinc(b.p_op || {}, !!b.p_forcar); }
  else if (t === "rpc") body = {};
  else if (t && D[t] && req.method === "PATCH") { const alvo = filtrar(D[t], u.searchParams); const p = JSON.parse(txt || "{}"); for (const r of alvo) Object.assign(r, p, { atualizado_em: agoraJa }); escritas.push([req.method, t, p]); body = obj ? alvo[0] || null : alvo; }
  else if (t && D[t] && req.method === "DELETE") { const alvo = new Set(filtrar(D[t], u.searchParams)); D[t] = D[t].filter(r => !alvo.has(r)); escritas.push([req.method, t, [...alvo].map(r => r.id)]); body = []; }
  else if (t && D[t] && req.method === "POST") { const linhas = [].concat(JSON.parse(txt || "[]")), out = [];
    for (const l of linhas) { const i = l.id != null ? D[t].findIndex(r => String(r.id) === String(l.id)) : -1;
      if (i >= 0) { Object.assign(D[t][i], l, { atualizado_em: agoraJa }); out.push(D[t][i]); }
      else { const n = { ...l, id: l.id != null ? l.id : ++seqEvento, criado_em: l.criado_em || agoraJa, atualizado_em: agoraJa }; D[t].push(n); out.push(n); } }
    escritas.push([req.method, t, linhas]); body = obj ? out[0] || null : out; }
  else if (t && D[t]) { let l = filtrar(D[t], u.searchParams); const lim = Number(u.searchParams.get("limit")); if (lim) l = l.slice(0, lim); body = obj ? l[0] || null : l; }
  const responder = () => { res.writeHead(req.method === "POST" ? 201 : 200, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
  if (atraso.ms && atraso.rota && (u.pathname + u.search).includes(atraso.rota)) setTimeout(responder, atraso.ms); else responder();
  });
});
const escritas = [];
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
    await js(`location.hash = "#/painel"`); await espera(2000); t = ultimoTexto = await js("document.body.innerText");
    chk("painel sem internet: indicadores avisam (sem 'Failed to fetch')", !t.includes("Failed to fetch") && !t.includes("Não foi possível calcular"));
    const nBackup = await js(`import("./js/telas/backup.js").then(m => m.montarBackup({ perfil: { papel: "admin", nome: "Danilo" }, tolerante: false })).then(b => b.tabelas.ordens.length + "|" + b.tabelas.contas.length + "|" + (b.origem ? "pc" : "servidor"))`).catch(e => "ERRO " + e.message);
    chk("backup sem internet pelo banco do PC (" + nBackup + ")", nBackup === "2|1|pc");
    // a réplica nunca lê do banco do PC (carga completa sem internet falha e não mistura)
    const rep = await js(`import("./js/api.js").then(m => m.api.backup.tabela("ordens")).then(() => "leu", e => "falhou")`);
    chk("backup.tabela (usada pela réplica) não cai para o banco do PC", rep === "falhou");
    // ---------- etapa 3: alterar O.S. sem internet → fila → envio ao reconectar ----------
    const r3 = await js(`(async () => { const { api } = await import("./js/api.js"); const o = await api.ordem("o1");
      await api.salvarItens("o1", o.itens.concat([{ id: "i-novo", tipo: "servico", descricao: "MÃO DE OBRA FREIO", qtd: 1, valor_unit: 150, custo_unit: 0, desconto: 0, aprovado: true, executado: true }]), []);
      await api.atualizarOrdem("o1", { status: "pronto", reclamacao: "barulho no freio" });
      await api.evento("o1", "pronto", "Serviço concluído (teste sem internet).", "Danilo");
      const d = await api.ordem("o1"), f = await (await import("./js/fila.js")).fila.listar();
      return [d.itens.length, d.status, d.eventos.some(e => String(e.id).startsWith("local-")), f.length].join("|"); })()`).catch(e => "ERRO " + e.message);
    chk("sem internet: alteração da O.S. vai para o banco do PC e para a fila (" + r3 + ")", r3 === "2|pronto|true|3" && !escritas.length);
    const fechada = await js(`import("./js/api.js").then(m => m.api.atualizarOrdem("o2", { obs_internas: "x" })).then(() => "gravou", e => e.message)`);
    chk("sem internet: O.S. fechada não aceita alteração", /entregue/.test(fechada));
    const entregar = await js(`import("./js/api.js").then(m => m.api.atualizarOrdem("o1", { status: "entregue" })).then(() => "gravou", e => e.message)`);
    chk("sem internet: entregar/receber pede internet", /precisam de internet/.test(entregar));
    await js(`location.hash = "#/os/o1"`); await espera(2000); t = ultimoTexto = await js("document.body.innerText");
    chk("tela da O.S. mostra as alterações e o aviso de envio pendente", t.includes("Produtos e serviços (2)") && /alteração\(ões\) desta O.S. feita\(s\) sem internet/.test(t));
    // a internet volta: a fila vai para o online na ordem
    modo = "ok"; await js(`window.dispatchEvent(new Event("online"))`); await espera(9000);
    const o1 = D.ordens.find(x => x.id === "o1");
    const fila1 = await js(`import("./js/fila.js").then(m => m.fila.listar()).then(l => l.length)`);
    chk("ao reconectar: tudo enviado (O.S. " + o1.status + ", itens " + D.os_itens.filter(i => i.ordem_id === "o1").length + ", fila " + fila1 + ")",
      o1.status === "pronto" && o1.reclamacao === "barulho no freio" && D.os_itens.some(i => i.id === "i-novo") && D.eventos.some(e => e.texto.includes("teste sem internet")) && fila1 === 0);
    const locais = await js(`window.dtcarDesktop.banco.porOrdem("eventos", "o1").then(t => JSON.parse(t).filter(e => String(e.id).startsWith("local-")).length)`);
    chk("histórico provisório sai do banco do PC depois de enviado", locais === 0);
    // conflito: sem internet aqui muda a reclamação; no online alguém muda a mesma coisa
    modo = "fora"; await js(`import("./js/api.js").then(m => m.definirSemRede(true))`);
    await js(`import("./js/api.js").then(m => m.api.atualizarOrdem("o1", { reclamacao: "versão do PC" }))`);
    o1.reclamacao = "versão do online"; o1.atualizado_em = new Date().toISOString();
    modo = "ok"; await js(`window.dispatchEvent(new Event("online"))`); await espera(8000);
    const f2 = await js(`import("./js/fila.js").then(m => m.fila.listar()).then(l => l.map(x => (x.conflito ? "C" : "-") + ":" + x.erro).join(";"))`);
    chk("conflito detectado e nada gravado por cima (" + f2.slice(0, 120) + ")", f2.startsWith("C:Conflito") && o1.reclamacao === "versão do online");
    await js(`location.hash = "#/dados-locais"`); await espera(1500); t = ultimoTexto = await js("document.body.innerText");
    chk("Dados no computador lista o conflito com as opções", t.includes("Enviar por cima") && t.includes("Descartar desta O.S."));
    await js(`(async () => { const { fila } = await import("./js/fila.js"); const [op] = await fila.listar(); await fila.forcar(op.id); })()`);
    await js(`window.dispatchEvent(new Event("online"))`); await espera(1000);
    await js(`import("./js/fila.js").then(async m => { const { api } = await import("./js/api.js"); return m.fila.processar(api); })`); await espera(500);
    chk("“Enviar por cima” grava a versão do PC", o1.reclamacao === "versão do PC");
    // conflito em item: aqui muda a quantidade sem internet; no online alguém muda o mesmo item
    await espera(2500); // a réplica copia o que acabou de ser enviado
    modo = "fora"; await js(`import("./js/api.js").then(m => m.definirSemRede(true))`);
    const rItem = await js(`(async () => { const { api } = await import("./js/api.js"); const o = await api.ordem("o1"); const it = o.itens.find(i => i.id === "i1");
      await api.salvarItens("o1", o.itens.map(i => i.id === "i1" ? { ...i, qtd: 3 } : i), []); return (await import("./js/fila.js")).fila.listar().then(l => l.map(x => x.tipo).join(",")); })()`).catch(e => "ERRO " + e.message);
    const i1 = D.os_itens.find(i => i.id === "i1"); i1.valor_unit = 99; i1.atualizado_em = new Date(Date.now() + 1000).toISOString();
    modo = "ok"; await js(`window.dispatchEvent(new Event("online"))`); await espera(8000);
    const f3 = await js(`import("./js/fila.js").then(m => m.fila.listar()).then(l => l.map(x => x.tipo + ":" + (x.conflito ? "C" : "-")).join(";"))`);
    chk("conflito em item detectado (" + rItem + " → " + f3 + "), item do online intacto", f3 === "itens_os:C" && i1.qtd === 2 && i1.valor_unit === 99);
    const offline = async () => { modo = "fora"; await js(`import("./js/api.js").then(m => m.definirSemRede(true))`); };
    const online = async (ms = 8000) => { modo = "ok"; await js(`window.dispatchEvent(new Event("online"))`); await espera(ms); };
    const filaTxt = () => js(`import("./js/fila.js").then(m => m.fila.listar()).then(l => l.map(x => x.tipo + ":" + (x.conflito ? "C" : "-") + (x.conflito ? ":" + x.erro : "")).join(";"))`);
    // limpa a fila e, com internet, abre a O.S. do online (o banco do PC fica igual ao que a tela mostra)
    const limparFila = () => js(`(async () => { const { fila } = await import("./js/fila.js"); for (const op of await fila.listar()) await fila.remover(op.id);
      const { api } = await import("./js/api.js"); await api.ordem("o1"); })()`);
    const offlineJs = c => js(`(async () => { const { api } = await import("./js/api.js"); ${c} })()`).catch(e => "ERRO " + e.message);
    await limparFila();
    // várias alterações seguidas do mesmo item sem internet não entram em conflito entre si
    await offline();
    await offlineJs(`let o = await api.ordem("o1"); await api.salvarItens("o1", o.itens.map(i => i.id === "i1" ? { ...i, qtd: 5 } : i), []);
      o = await api.ordem("o1"); await api.salvarItens("o1", o.itens.map(i => i.id === "i1" ? { ...i, qtd: 6 } : i), []);`);
    await online();
    let ft = await filaTxt();
    chk("alterações seguidas do mesmo item: enviadas sem conflito falso (" + ft + ")", ft === "" && D.os_itens.find(i => i.id === "i1").qtd === 6);
    // com alteração em conflito, gravar de novo com internet entra na fila atrás (não passa na frente)
    await offline();
    await offlineJs(`await api.atualizarOrdem("o1", { obs_internas: "A (PC)" });`);
    o1.obs_internas = "S (online)"; o1.atualizado_em = new Date().toISOString();
    await online();
    await offlineJs(`await api.atualizarOrdem("o1", { obs_internas: "B (PC, com internet)" });`); await espera(2500);
    ft = await filaTxt();
    chk("O.S. com conflito: gravação com internet vai para a fila atrás (" + ft.replace(/:Conflito.*?(;|$)/g, "$1") + ")", ft.split(";").length === 2 && o1.obs_internas === "S (online)");
    await js(`(async () => { const { fila } = await import("./js/fila.js"); const [op] = await fila.listar(); await fila.forcar(op.id); const { api } = await import("./js/api.js"); await fila.processar(api); })()`); await espera(500);
    chk("enviar por cima e depois a seguinte: fica a última feita aqui", o1.obs_internas === "B (PC, com internet)" && (await filaTxt()) === "");
    // carga nova do sistema antigo depois da alteração: conflito (as O.S. são recriadas com os mesmos ids)
    await limparFila(); await offline();
    await offlineJs(`await api.atualizarOrdem("o1", { obs_internas: "antes da carga" });`);
    cfgSrv = { ultimoEspelho: { em: new Date().toISOString() } };
    await online();
    ft = await filaTxt();
    chk("carga nova do sistema antigo: conflito (" + ft.slice(0, 90) + ")", /carga nova do sistema antigo/.test(ft) && o1.obs_internas !== "antes da carga");
    await limparFila(); await espera(4000); // a nova carga continua valendo (a réplica já trouxe a geração nova para o banco do PC)
    // O.S. entregue no online depois da alteração: conflito; e a réplica não apaga a alteração pendente no banco do PC
    await offline();
    await offlineJs(`await api.atualizarOrdem("o1", { reclamacao: "feito sem internet" });`);
    o1.status = "entregue"; o1.atualizado_em = new Date().toISOString();
    await online(9000);
    ft = await filaTxt();
    const local1 = await js(`window.dtcarDesktop.banco.um("ordens", "o1").then(t => JSON.parse(t).reclamacao)`);
    chk("O.S. entregue no online: conflito (" + ft.slice(0, 80) + ")", /foi entregue no online/.test(ft) && o1.reclamacao !== "feito sem internet");
    chk("réplica com conflito pendente: o banco do PC continua com o trabalho pendente (" + local1 + ")", local1 === "feito sem internet");
    // descartar com internet: a O.S. do online vem mesmo com pendência (a tela de resolução não fica presa na versão do PC)
    const dupla = await offlineJs(`const a = await api.ordem("o1"), b = await api.ordemDoServidor("o1"); return a.reclamacao + "|" + b.reclamacao;`);
    chk("com conflito: api.ordem mostra a versão do PC e ordemDoServidor a do online (" + dupla + ")", dupla === "feito sem internet|" + o1.reclamacao);
    o1.status = "pronto"; await limparFila();
    // fila: incluir e tirar ao mesmo tempo não perde nenhuma
    const fl = await js(`(async () => { const { fila } = await import("./js/fila.js"); await fila.adicionar({ id: "x0", tipo: "evento_os", ordem_id: "zz", criado_em: "2020-01-01" });
      await Promise.all([fila.adicionar({ id: "x1", tipo: "evento_os", ordem_id: "zz", criado_em: "2020-01-02" }), fila.remover("x0"), fila.adicionar({ id: "x2", tipo: "evento_os", ordem_id: "zz", criado_em: "2020-01-03" })]);
      const ids = (await fila.listar()).map(x => x.id).join(","); for (const id of ["x1", "x2"]) await fila.remover(id); return ids; })()`);
    chk("fila: incluir e tirar ao mesmo tempo não perde nenhuma (" + fl + ")", fl === "x1,x2");
    // resposta do online que chega depois de uma alteração entrar na fila: a tela recebe a versão do PC (não a velha)
    atraso.ms = 1500; atraso.rota = "ordens?select=*&id=eq.o1";
    const velha = await offlineJs(`const p = api.ordem("o1"); await new Promise(r => setTimeout(r, 300));
      const { alterarOrdemOffline } = await import("./js/alteracoes.js"); await alterarOrdemOffline("o1", { obs_internas: "entrou na fila no meio" });
      return (await p).obs_internas;`);
    atraso.ms = 0;
    chk("resposta velha do online não volta para a tela (" + velha + ")", velha === "entrou na fila no meio");
    // descartar espera o envio em andamento terminar (nada é enviado depois do descarte)
    atraso.ms = 1500; atraso.rota = "rpc/sincronizar_alteracao_os";
    const ordemDesc = await js(`(async () => { const { fila } = await import("./js/fila.js"); const { api } = await import("./js/api.js"); const marcas = [];
      const p = fila.processar(api).then(() => marcas.push("envio terminou")); await new Promise(r => setTimeout(r, 300));
      await fila.semEnvio(async () => marcas.push("descarte rodou")); await p; return marcas.join(" > "); })()`);
    atraso.ms = 0;
    chk("descartar espera o envio em andamento (" + ordemDesc + ")", ordemDesc === "envio terminou > descarte rodou");
    await limparFila();
    // o aparelho não consegue guardar a fila: a alteração não é aceita (e o banco do PC não muda)
    await offline();
    const semGuardar = await offlineJs(`const { local } = await import("./js/local.js"); const g = local.gravar; local.gravar = async () => false;
      try { await api.atualizarOrdem("o1", { obs_internas: "não pode ficar" }); return "aceitou"; } catch (e) { return e.message; } finally { local.gravar = g; }`);
    const noPC = await js(`window.dtcarDesktop.banco.um("ordens", "o1").then(t => JSON.parse(t).obs_internas)`);
    chk("fila que não grava: alteração recusada e banco do PC intacto (" + noPC + ")", /Não foi possível guardar a fila/.test(semGuardar) && noPC !== "não pode ficar");
    await online(4000); await limparFila();
    // sem o supabase/v15.sql no servidor: sem internet continua só consulta, com aviso
    await js(`window.dtcarDesktop.banco.meta("v15", "false")`); await offline();
    const semV15 = await offlineJs(`await api.atualizarOrdem("o1", { obs_internas: "sem v15" }); return "gravou";`);
    chk("sem v15.sql: alteração sem internet recusada com aviso", /v15\.sql/.test(semV15));
    await js(`window.dtcarDesktop.banco.meta("v15", "true")`); await online(4000); await limparFila();
    modo = "fora"; w.webContents.reload(); await carregou(); await espera(5000);
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
