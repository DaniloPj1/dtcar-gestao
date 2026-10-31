// Banco de dados no PC (etapa 2 do programa): SQLite embutido no próprio programa (node:sqlite, sem instalar nada).
// Guarda uma réplica de TODAS as tabelas do online, linha a linha em JSON (o formato do servidor), para as telas funcionarem
// sem internet. O arquivo fica em %APPDATA%\DTCar Gestao\banco\dtcar.db (fora do OneDrive, que pode corromper banco aberto);
// uma cópia por dia vai para Documentos\DTCar Gestão\banco\ (14 dias).
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");

let db = null, arquivo = "";
function abrir(pastaUsuario) {
  if (db) return db;
  const dir = path.join(pastaUsuario, "banco"); fs.mkdirSync(dir, { recursive: true });
  arquivo = path.join(dir, "dtcar.db");
  db = new DatabaseSync(arquivo);
  db.exec(`pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = off;
    create table if not exists linhas (tabela text not null, id text not null, dados text not null, ordem_id text, atualizado_em text,
      primary key (tabela, id)) without rowid;
    create index if not exists linhas_ordem on linhas (tabela, ordem_id);
    create table if not exists meta (chave text primary key, valor text);`);
  return db;
}
const chave = (tabela, l) => tabela === "estoque_reserva" ? String(l.item_id) : String(l.id);
function gravarLinhas(tabela, linhas) {
  const ins = db.prepare("insert into linhas (tabela, id, dados, ordem_id, atualizado_em) values (?, ?, ?, ?, ?) on conflict (tabela, id) do update set dados = excluded.dados, ordem_id = excluded.ordem_id, atualizado_em = excluded.atualizado_em");
  for (const l of linhas) ins.run(tabela, chave(tabela, l), JSON.stringify(l), l.ordem_id != null ? String(l.ordem_id) : null, l.atualizado_em || l.criado_em || null);
}
function transacao(fn) { db.exec("begin"); try { const r = fn(); db.exec("commit"); return r; } catch (e) { db.exec("rollback"); throw e; } }
const lista = rows => "[" + rows.map(r => r.dados).join(",") + "]"; // devolve texto JSON (mais leve para atravessar a ponte)

function registrar(ipcMain, app, pastaDados) {
  const pronto = () => abrir(app.getPath("userData"));
  ipcMain.handle("banco:info", () => { pronto(); const n = db.prepare("select tabela, count(*) n from linhas where tabela not like '%~novo' group by tabela").all();
    return { arquivo, tamanho: fs.existsSync(arquivo) ? fs.statSync(arquivo).size : 0, tabelas: Object.fromEntries(n.map(x => [x.tabela, x.n])) }; });
  // substitui a tabela inteira (carga completa)
  ipcMain.handle("banco:substituir", (e, tabela, texto) => { pronto(); const linhas = JSON.parse(texto);
    transacao(() => { db.prepare("delete from linhas where tabela = ?").run(tabela); gravarLinhas(tabela, linhas); }); return linhas.length; });
  // inclui/atualiza só as linhas recebidas (carga do que mudou)
  ipcMain.handle("banco:mesclar", (e, tabela, texto) => { pronto(); const linhas = JSON.parse(texto); transacao(() => gravarLinhas(tabela, linhas)); return linhas.length; });
  ipcMain.handle("banco:remover", (e, tabela, ids) => { pronto(); const d = db.prepare("delete from linhas where tabela = ? and id = ?");
    transacao(() => { for (const id of ids) d.run(tabela, String(id)); }); return ids.length; });
  // apaga as linhas que não existem mais no servidor (conferência dos ids)
  ipcMain.handle("banco:manterSo", (e, tabela, ids) => { pronto(); const tem = new Set(ids.map(String));
    const locais = db.prepare("select id from linhas where tabela = ?").all(tabela).map(r => r.id).filter(id => !tem.has(id));
    const d = db.prepare("delete from linhas where tabela = ? and id = ?"); transacao(() => { for (const id of locais) d.run(tabela, id); }); return locais.length; });
  // carga completa em duas fases: grava em "<tabela>~novo" e só troca todas juntas no fim (falha no meio não mistura cargas)
  ipcMain.handle("banco:preparar", (e, tabela, texto) => { pronto(); const linhas = JSON.parse(texto);
    transacao(() => { db.prepare("delete from linhas where tabela = ?").run(tabela + "~novo"); gravarLinhas(tabela + "~novo", linhas); }); return linhas.length; });
  ipcMain.handle("banco:promover", (e, tabelas) => { pronto(); transacao(() => { for (const t of tabelas) {
    db.prepare("delete from linhas where tabela = ?").run(t); db.prepare("update linhas set tabela = ? where tabela = ?").run(t, t + "~novo"); } }); return true; });
  ipcMain.handle("banco:descartarPreparo", () => { pronto(); db.prepare("delete from linhas where tabela like '%~novo'").run(); return true; });
  ipcMain.handle("banco:listar", (e, tabela) => { pronto(); return lista(db.prepare("select dados from linhas where tabela = ?").all(tabela)); });
  ipcMain.handle("banco:porOrdem", (e, tabela, ordemId) => { pronto(); return lista(db.prepare("select dados from linhas where tabela = ? and ordem_id = ?").all(tabela, String(ordemId))); });
  ipcMain.handle("banco:um", (e, tabela, id) => { pronto(); const r = db.prepare("select dados from linhas where tabela = ? and id = ?").get(tabela, String(id)); return r ? r.dados : null; });
  ipcMain.handle("banco:maiorData", (e, tabela) => { pronto(); const r = db.prepare("select max(atualizado_em) m from linhas where tabela = ?").get(tabela); return r ? r.m : null; });
  ipcMain.handle("banco:meta", (e, k, v) => { pronto(); if (v === undefined) { const r = db.prepare("select valor from meta where chave = ?").get(k); return r ? r.valor : null; }
    db.prepare("insert into meta (chave, valor) values (?, ?) on conflict (chave) do update set valor = excluded.valor").run(k, v == null ? null : String(v)); return true; });
  // zera tudo (carga do sistema antigo no modo espelho, ou troca de usuário)
  ipcMain.handle("banco:zerar", () => { pronto(); transacao(() => { db.exec("delete from linhas; delete from meta;"); }); return true; });
  // cópia do dia em Documentos\DTCar Gestão\banco (arquivo SQLite completo e consistente)
  ipcMain.handle("banco:copiaDoDia", async () => {
    pronto(); const dir = path.join(pastaDados(), "banco"); fs.mkdirSync(dir, { recursive: true });
    const dia = new Date().toISOString().slice(0, 10), destino = path.join(dir, "dtcar-" + dia + ".db");
    if (fs.existsSync(destino)) fs.rmSync(destino);
    db.exec("vacuum into '" + destino.replace(/'/g, "''") + "'");
    const nomes = fs.readdirSync(dir).filter(n => /^dtcar-\d{4}-\d{2}-\d{2}\.db$/.test(n)).sort().reverse();
    for (const n of nomes.slice(14)) fs.rmSync(path.join(dir, n), { force: true });
    return destino;
  });
}
module.exports = { registrar };
