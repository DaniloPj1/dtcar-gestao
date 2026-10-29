// Pasta de dados no computador (Chrome/Edge no Windows): além da cópia interna do navegador, o sistema grava
// os dados em arquivos numa pasta escolhida na primeira abertura (ex.: Documentos\DTCar Gestão):
//   dados\dtcar-dados.json      cópia completa mais recente (clientes, veículos, produtos, O.S., ajustes)
//   dados\fila-envio.json       O.S. abertas sem internet que ainda não foram enviadas
//   copias\dtcar-AAAA-MM-DD.json uma cópia por dia, guardadas por 30 dias
// Se o navegador perder a cópia interna, o sistema recupera pela pasta.
import { local } from "./local.js";

const NOME_PASTA = "DTCar Gestão", DIAS_COPIAS = 30;
export const pastaSuportada = () => typeof window.showDirectoryPicker === "function";

let estado = { configurada: false, permissao: "", nome: "", ultimaGravacao: null, erro: "" };
const ouvintes = new Set();
const avisa = () => { for (const f of ouvintes) f({ ...estado }); };
export const ouvirPasta = f => { ouvintes.add(f); f({ ...estado }); return () => ouvintes.delete(f); };
export const estadoPasta = () => ({ ...estado });

async function raiz() { return local.ler("pasta:handle"); }
async function permissao(h, pedir) {
  if (!h || !h.queryPermission) return "denied";
  let p = await h.queryPermission({ mode: "readwrite" });
  if (p === "prompt" && pedir) p = await h.requestPermission({ mode: "readwrite" });
  return p;
}

/** Lê a situação ao abrir o programa (sem pedir nada ao usuário) */
export async function iniciarPasta() {
  if (!pastaSuportada()) { estado = { ...estado, configurada: false, permissao: "sem-suporte" }; avisa(); return estado; }
  const h = await raiz();
  estado = { ...estado, configurada: !!h, nome: h ? h.name : "", permissao: h ? await permissao(h, false) : "", ultimaGravacao: (await local.ler("pasta:ultima")) || null };
  avisa(); return estado;
}

/** Abre a janela do Windows para escolher onde criar a pasta "DTCar Gestão" (precisa de um clique do usuário) */
export async function escolherPasta() {
  const base = await window.showDirectoryPicker({ id: "dtcar-dados", mode: "readwrite", startIn: "documents" });
  const h = base.name === NOME_PASTA ? base : await base.getDirectoryHandle(NOME_PASTA, { create: true });
  await h.getDirectoryHandle("dados", { create: true }); await h.getDirectoryHandle("copias", { create: true });
  await escrever(h, ["LEIA-ME.txt"], "Pasta de dados do DTCar Gestão neste computador.\r\n\r\n" +
    "dados\\dtcar-dados.json  - cópia completa mais recente dos cadastros e O.S. (atualizada automaticamente)\r\n" +
    "dados\\fila-envio.json   - O.S. abertas sem internet aguardando envio ao servidor\r\n" +
    "copias\\                 - uma cópia por dia, guardadas por " + DIAS_COPIAS + " dias\r\n\r\n" +
    "Não apague nem edite estes arquivos. O servidor (Supabase) continua sendo a base principal; esta pasta serve para trabalhar sem internet e como cópia de segurança local.\r\n");
  await local.gravar("pasta:handle", h);
  estado = { ...estado, configurada: true, nome: h.name, permissao: "granted", erro: "" }; avisa();
  return h;
}
/** Religa a permissão (o navegador pode pedir de novo depois de reiniciar) */
export async function reconectarPasta() {
  const h = await raiz(); if (!h) return false;
  const p = await permissao(h, true); estado = { ...estado, permissao: p }; avisa(); return p === "granted";
}
export async function esquecerPasta() { await local.gravar("pasta:handle", null); estado = { ...estado, configurada: false, nome: "", permissao: "" }; avisa(); }

async function escrever(h, caminho, texto) {
  let d = h; for (const p of caminho.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
  const arq = await d.getFileHandle(caminho[caminho.length - 1], { create: true });
  const w = await arq.createWritable(); await w.write(texto); await w.close();
}
async function ler(h, caminho) {
  try { let d = h; for (const p of caminho.slice(0, -1)) d = await d.getDirectoryHandle(p); const f = await (await d.getFileHandle(caminho[caminho.length - 1])).getFile(); return JSON.parse(await f.text()); }
  catch (e) { return null; }
}
async function pronta() { const h = await raiz(); if (!h) return null; return (await permissao(h, false)) === "granted" ? h : null; }

let ultimaCopia = 0;
/** Grava a cópia completa (chamado depois de cada atualização da cópia interna, no máximo a cada 60 s) */
export async function gravarDadosNaPasta(copia, forcar) {
  if (!forcar && Date.now() - ultimaCopia < 60000) return false;
  const h = await pronta(); if (!h) return false;
  try {
    const txt = JSON.stringify({ sistema: "dtcar-gestao", tipo: "copia-local", ...copia });
    await escrever(h, ["dados", "dtcar-dados.json"], txt);
    const dia = new Date().toISOString().slice(0, 10);
    await escrever(h, ["copias", "dtcar-" + dia + ".json"], txt);
    // apaga cópias diárias mais antigas que o limite
    const dc = await h.getDirectoryHandle("copias", { create: true }), nomes = [];
    for await (const [n] of dc.entries()) if (/^dtcar-\d{4}-\d{2}-\d{2}\.json$/.test(n)) nomes.push(n);
    nomes.sort().reverse().slice(DIAS_COPIAS).forEach(n => dc.removeEntry(n).catch(() => {}));
    ultimaCopia = Date.now(); const agora = new Date().toISOString(); await local.gravar("pasta:ultima", agora);
    estado = { ...estado, ultimaGravacao: agora, erro: "" }; avisa(); return true;
  } catch (e) { estado = { ...estado, erro: e.message }; avisa(); return false; }
}
/** Grava a fila de envio (pequena; sempre que muda) */
export async function gravarFilaNaPasta(fila) {
  const h = await pronta(); if (!h) return false;
  try { await escrever(h, ["dados", "fila-envio.json"], JSON.stringify({ atualizado_em: new Date().toISOString(), fila }, null, 1)); return true; } catch (e) { return false; }
}
/** Recupera da pasta o que o navegador perdeu (cópia completa e fila) */
export async function lerDaPasta() {
  const h = await pronta(); if (!h) return null;
  return { copia: await ler(h, ["dados", "dtcar-dados.json"]), fila: ((await ler(h, ["dados", "fila-envio.json"])) || {}).fila || [] };
}
