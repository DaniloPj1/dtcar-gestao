// Teste do backup de leitura (v35): js/backupleitura.js (páginas + planilha) e supabase/functions/email/backup.ts (3 passos,
// zip com senha, envio, falhas). Banco, pasta do Supabase e Microsoft são falsos; o zip e a planilha são de verdade.
// Rodar: deno run -A teste/teste_backup_leitura.ts
// Confere também o tempo de cada passo com o volume real da oficina (1.900+ O.S.): a função do Supabase tem 2 s de processamento.
import { BlobReader, TextWriter, Uint8ArrayReader, Uint8ArrayWriter, ZipReader } from "npm:@zip.js/zip.js@2.24.0";
import * as G from "../js/backupleitura.js";
import { executarEEncadear, iniciar, LIMITE_ANEXO, passo, rodar, situacaoBackup, type DepsBackup, type Passo } from "../supabase/functions/email/backup.ts";
import { tratar } from "../supabase/functions/email/acoes.ts";

const ok: string[] = [], falhas: string[] = [];
const confere = (n: string, c: boolean, extra: unknown = "") => (c ? ok : falhas).push(n + (!c && extra !== "" ? " :: " + JSON.stringify(extra).slice(0, 400) : ""));
const SENHA = "senha-do-teste-123456";

// ---------------- dados falsos ----------------
type L = Record<string, any>;
let seq = 0;
const id = () => "00000000-0000-4000-8000-" + String(++seq).padStart(12, "0");
function dados(nOS = 40) {
  const clientes: L[] = [], veiculos: L[] = [], ordens: L[] = [], os_itens: L[] = [], recibos: L[] = [], receber: L[] = [];
  const nomes = ["JOSÉ DA SILVA", "MARIA SOUZA", "GRANICAP GRANITOS CAPIXABAS LTDA", "Tadeu & Filhos", "<script>alert('x')</script> Cliente"];
  for (let i = 0; i < Math.max(5, Math.round(nOS / 3.7)); i++) clientes.push({ id: id(), codigo: i + 1, nome: nomes[i % nomes.length] + (i >= nomes.length ? " " + i : ""), telefone: "27999" + String(100000 + i), doc: "", email: "", rua: "Rua A, " + i, bairro: "Centro", cidade: "Colatina", uf: "ES", cep: "29700000", situacao: "liberado", ficha: { x: 1 }, criado_em: "2025-01-01T12:00:00Z" });
  for (let i = 0; i < Math.round(nOS / 1.85); i++) veiculos.push({ id: id(), placa: "ABC" + (i % 10) + String.fromCharCode(65 + (i % 26)) + String(10 + (i % 90)), marca: "VW", modelo: "GOL 1.0", ano: "2015", cor: "PRATA", cliente_id: clientes[i % clientes.length].id, km_atual: 100000 + i });
  const status = ["diagnostico", "aguardando", "execucao", "pronto", "entregue", "entregue", "entregue", "recusado", "cancelado"];
  for (let n = 1; n <= nOS; n++) {
    const v = veiculos[n % veiculos.length], c = clientes.find((x) => x.id === v.cliente_id)!, st = n <= 9 ? status[n - 1] : n > nOS - 30 && n % 5 === 0 ? "execucao" : "entregue";
    const quitada = st === "entregue" && n !== 6; // a 6 foi entregue e ainda não foi paga
    const criado = new Date(Date.UTC(2021, 0, 1) + n * 0.9 * 86400000).toISOString();
    const o: L = { id: id(), numero: n, status: st, cliente_id: c.id, veiculo_id: v.id, cliente: { nome: c.nome, telefone: c.telefone }, veiculo: { placa: v.placa, marca: v.marca, modelo: v.modelo },
      km_entrada: v.km_atual, reclamacao: "Barulho na suspensão <b>forte</b>", diagnostico: "", checkin: { grande: "x".repeat(50) }, assinatura_entrada: "assinaturas/a.png", desconto: 0, total: 0, recebido: 0,
      garantia_dias: 90, criado_em: criado, entregue_em: st === "entregue" ? criado : null, finalizada_em: quitada ? criado : null, mecanico_nome: "PEDRO" };
    let tot = 0;
    for (let k = 0; k < 6; k++) { const it = { id: id(), ordem_id: o.id, tipo: k % 3 === 0 ? "servico" : "peca", descricao: k % 3 === 0 ? "MÃO DE OBRA" : "PASTILHA DIANT", codigo: k % 3 ? "N-" + k : "", qtd: 1 + (k % 2), valor_unit: 50 + k * 10, desconto: 0, custo_unit: 0, aprovado: ["diagnostico", "aguardando"].includes(st) ? null : true, posicao: k };
      tot += it.qtd * it.valor_unit; os_itens.push(it); }
    o.total = tot; if (quitada) { o.recebido = tot; recibos.push({ id: id(), numero: recibos.length + 1, ordem_id: o.id, pagador: c.nome, valor: tot, forma: "PIX", data: criado.slice(0, 10), cancelado: false, conta_destino: "Sicredi" }); }
    if (st === "entregue" && !quitada) receber.push({ id: id(), ordem_id: o.id, cliente_nome: c.nome, parcela: 1, parcelas: 2, valor: tot / 2, vencimento: "2026-11-20", status: "aberta", forma: "boleto" });
    ordens.push(o);
  }
  const produtos = Array.from({ length: Math.round(nOS / 2.5) }, (_, i) => ({ id: id(), codigo: i + 1, tipo: "produto", descricao: "PEÇA " + i, referencia: "R" + i, estoque_atual: i % 7, custo: "12.50", preco_vista: "25.00", ativo: true }));
  const fornecedores = [{ id: id(), razao: "DPK COMERCIAL AUTOMOTIVA S.A.", fantasia: "DPK", cnpj: "45987005026588", telefone: "", email: "", cidade: "Serra", uf: "ES" }];
  const contas = Array.from({ length: 20 }, (_, i) => ({ id: id(), descricao: "Boleto " + i, favorecido: "DPK", valor: "100.00", vencimento: "2026-11-" + String(10 + i).padStart(2, "0"), status: i % 2 ? "paga" : "aberta", pago_em: i % 2 ? "2026-11-01" : null, conta_origem: i % 2 ? "Sicredi" : "" }));
  const vendas = [{ id: id(), numero: 420, cliente: { nome: "BALCÃO" }, total: "80.00", forma_pagamento: "PIX", status: "concluida", criado_em: "2026-11-03T15:00:00Z" }];
  const venda_itens = [{ id: id(), venda_id: vendas[0].id, descricao: "ÓLEO 5W30", qtd: 4, valor_unit: 20 }];
  return { sistema: "dtcar-gestao", gerado_em: "2026-11-05T21:00:10Z", config: { nome: "DTCAR CENTRO AUTOMOTIVO" }, tabelas: { clientes, veiculos, produtos, fornecedores, ordens, os_itens, recibos, receber, contas, vendas, venda_itens } };
}

// ---------------- gerador: páginas ----------------
const bk = dados(40);
const { arquivos, resumo } = G.montarPaginas(bk);
const mapa = new Map(arquivos);
const nomes = [...mapa.keys()];
confere("tem ABRIR-AQUI, LEIA-ME, estilo e cadastros", ["ABRIR-AQUI.html", "LEIA-ME.txt", "estilo.css", "Cadastros/Clientes.html", "Cadastros/Veiculos.html", "Cadastros/Produtos.html", "Cadastros/Fornecedores.html", "Financeiro/A-receber.html", "Financeiro/A-pagar.html", "Financeiro/Recibos.html", "Vendas/Vendas-de-balcao.html"].every((n) => mapa.has(n)), nomes.slice(0, 20));
const naPasta = (p: string) => nomes.filter((n) => n.startsWith(p));
confere("orçamentos (1 e 2) um arquivo cada, nome só com o número", naPasta("OS/1-Orcamento/").join("|") === "OS/1-Orcamento/OS 00001.html|OS/1-Orcamento/OS 00002.html", naPasta("OS/1-Orcamento/"));
confere("nenhum nome de arquivo leva cliente ou placa (a lista de nomes do zip fica aberta)", !nomes.some((n) => /JOSE|MARIA|GRANICAP|ABC\d/i.test(n)), nomes.filter((n) => /JOSE|MARIA|ABC\d/i.test(n)).slice(0, 3));
confere("em execução na pasta 2", naPasta("OS/2-Aprovado-em-execucao/").some((n) => n.includes("OS 00003")));
confere("pronta no pátio na pasta 3", naPasta("OS/3-Aguardando-pagamento-no-patio/").some((n) => n.includes("OS 00004")));
confere("entregue sem pagar na pasta 4", naPasta("OS/4-Entregue-a-receber/").some((n) => n.includes("OS 00006")) && naPasta("OS/4-Entregue-a-receber/").length === 1);
confere("fechadas agrupadas por mês de abertura", naPasta("OS/5-Fechadas/2021/").length >= 1 && naPasta("OS/5-Fechadas/").every((n) => /^OS\/5-Fechadas\/\d{4}\/\d{4}-\d{2}-[a-z]+\.html$/.test(n)), naPasta("OS/5-Fechadas/").slice(0, 3));
confere("recusadas e canceladas por ano", naPasta("OS/6-Recusadas-e-canceladas/").length === 1);
confere("nome de arquivo sem símbolo nem acento", nomes.every((n) => /^[A-Za-z0-9 ./_-]+$/.test(n)), nomes.filter((n) => !/^[A-Za-z0-9 ./_-]+$/.test(n)));
const todasHTML = arquivos.filter(([n]) => n.endsWith(".html")).map(([, c]) => c).join("\n");
confere("nome de cliente com <script> não vira código", !todasHTML.includes("<script>alert") && todasHTML.includes("&lt;script&gt;alert(&#39;x&#39;)"));
confere("reclamação com <b> aparece como texto", todasHTML.includes("&lt;b&gt;forte&lt;/b&gt;"));
const inicio = mapa.get("ABRIR-AQUI.html")!;
const scripts = [...inicio.matchAll(/<script>([\s\S]*?)<\/script>/g)];
confere("um script só (busca) e os dados não fecham a tag", scripts.length === 1 && !/<\/script/i.test(scripts[0][1]) && scripts[0][1].includes("\\u003cscript"));
confere("índice com todas as O.S.", (scripts[0][1].match(/\[\d+,"/g) || []).length === 40);
confere("situações por extenso (nunca só a cor)", todasHTML.includes("Entregue · a receber") && todasHTML.includes("Aprovado · em execução") && todasHTML.includes("Aguardando pagamento · no pátio") && todasHTML.includes(">Fechada<"));
const fech = arquivos.find(([n]) => n.startsWith("OS/5-Fechadas/"))!;
confere("O.S. fechada tem âncora e total", /id="os-\d+"/.test(fech[1]) && fech[1].includes("R$"), fech[0]);
confere("páginas usam o estilo pelo caminho certo", fech[1].includes('href="../../../estilo.css"') && mapa.get("Cadastros/Clientes.html")!.includes('href="../estilo.css"'));
confere("links do índice apontam para arquivos que existem", JSON.parse(scripts[0][1].match(/var D=(\[[\s\S]*?\]);/)![1].replace(/\\u003c/g, "<")).every((d: unknown[]) => mapa.has(String(d[6]).split("#")[0])));
const linksCli = [...mapa.get("Cadastros/Clientes.html")!.matchAll(/href="\.\.\/([^"#]+)/g)].map((m) => decodeURI(m[1]));
confere("links dos clientes para as O.S. existem", linksCli.length > 0 && linksCli.every((l) => l === "estilo.css" || l === "ABRIR-AQUI.html" || mapa.has(l)), linksCli.filter((l) => !mapa.has(l)).slice(0, 3));
confere("checklist e assinaturas não entram nas páginas", !todasHTML.includes("x".repeat(50)) && !todasHTML.includes("assinaturas/a.png"));
confere("resumo com contagens", resumo.os === 40 && resumo.os_abertas === 11 && resumo.clientes === bk.tabelas.clientes.length, resumo);
confere("datas no horário de Brasília (00h30 UTC = dia anterior)", G.diaBR("2026-11-05T00:30:00Z") === "2026-11-04" && G.pastaRaiz("2026-11-05T21:00:00Z") === "DTCar-Backup-2026-11-05");
confere("O.S. legado a receber fica aberta", G.lugarDaOS({ numero: 1745, status: "entregue", recebido: 0, finalizada_em: null, criado_em: "2026-10-01T12:00:00Z", veiculo: { placa: "AAA1A11" }, cliente: { nome: "MARBRASA" } }).pasta === "OS/4-Entregue-a-receber");

// ---------------- gerador: planilha ----------------
async function zipSimples(partes: Array<[string, string]>) {
  const { ZipWriter, TextReader, configure } = await import("npm:@zip.js/zip.js@2.24.0"); configure({ useWebWorkers: false });
  const w = new ZipWriter(new Uint8ArrayWriter()); for (const [n, c] of partes) await w.add(n, new TextReader(c)); return await w.close();
}
const partes = G.montarPlanilha(bk);
const xlsx = await zipSimples(partes);
confere("planilha com 11 abas", partes.filter(([n]) => n.startsWith("xl/worksheets/")).length === 11);
const temPython = (() => { try { return new Deno.Command("python3", { args: ["-c", "import openpyxl"] }).outputSync().success; } catch (_) { return false; } })();
if (temPython) {
  const arq = await Deno.makeTempFile({ suffix: ".xlsx" }); await Deno.writeFile(arq, xlsx);
  const r = new Deno.Command("python3", { args: ["-c", `import openpyxl,json,sys
wb=openpyxl.load_workbook(sys.argv[1]);o=wb["O.S."];c=wb["Clientes"];i=wb["Itens das O.S."]
h=[x.value for x in o[1]];print(json.dumps({"abas":wb.sheetnames,"os":o.max_row-1,"h":h,"total":o.cell(2,h.index("total")+1).value,"cli":c.max_row-1,"itens":i.max_row-1,"ch":[x.value for x in c[1]]}))`, arq] }).outputSync();
  const out = new TextDecoder().decode(r.stdout), err = new TextDecoder().decode(r.stderr);
  try {
    const j = JSON.parse(out);
    confere("planilha abre no Excel (openpyxl) com as abas", j.abas[0] === "O.S." && j.abas.length === 11, j.abas);
    confere("aba O.S. com uma linha por O.S. e total numérico", j.os === 40 && typeof j.total === "number", j);
    confere("itens e clientes completos", j.itens === bk.tabelas.os_itens.length && j.cli === bk.tabelas.clientes.length);
    confere("planilha sem id, ficha e checklist", !j.ch.includes("id") && !j.ch.includes("ficha") && !j.h.includes("checkin"), j.ch);
  } catch (_) { confere("planilha abre no Excel (openpyxl)", false, err.slice(-300)); }
} else console.log("(openpyxl não instalado: conferência da planilha pelo Python pulada)");

// ---------------- função: banco, pasta e e-mail falsos ----------------
function banco(bkDados: L) {
  const t: Record<string, L[]> = { ...bkDados.tabelas, config: [{ id: 1, dados: { nome: "DTCAR", backupLeitura: { ativo: true, emails: ["centroautomotivodtcar@hotmail.com", "dono@exemplo.com"] } } }], backup_execucoes: [] };
  const pasta = new Map<string, Uint8Array>();
  let ide = 0;
  const q = (nome: string) => {
    let lista = () => t[nome] || (t[nome] = []);
    let filtros: Array<(r: L) => boolean> = [], ord: [string, boolean] | null = null, de = 0, ate = Infinity, lim = Infinity, op = "select", val: any = null;
    const exec = () => {
      if (op === "insert") { const linhas = (Array.isArray(val) ? val : [val]).map((v: L) => ({ id: ++ide, iniciado_em: new Date().toISOString(), detalhe: {}, ...v })); lista().push(...linhas); return { data: linhas, error: null }; }
      let r = lista().filter((x) => filtros.every((f) => f(x)));
      if (op === "update") { r.forEach((x) => Object.assign(x, val)); return { data: r, error: null }; }
      if (ord) { const [c, asc] = ord; r = r.slice().sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      return { data: r.slice(de, Math.min(ate + 1, de + lim)).map((x) => ({ ...x })), error: null };
    };
    const b: any = {
      select: () => b, insert: (v: unknown) => { op = "insert"; val = v; return b; }, update: (v: unknown) => { op = "update"; val = v; return b; },
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; }, lt: (c: string, v: any) => { filtros.push((r) => r[c] < v); return b; }, gt: (c: string, v: any) => { filtros.push((r) => r[c] > v); return b; }, order: (c: string, o?: { ascending?: boolean }) => { ord = [c, o?.ascending !== false]; return b; },
      range: (a: number, z: number) => { de = a; ate = z; return b; }, limit: (n: number) => { lim = n; return b; },
      maybeSingle: async () => { const r = exec(); return { data: r.data[0] || null, error: null }; }, single: async () => { const r = exec(); return { data: r.data[0], error: null }; },
      then: (ok: (v: unknown) => unknown, er: (e: unknown) => unknown) => Promise.resolve(exec()).then(ok, er),
    };
    return b;
  };
  const storage = { from: () => ({
    upload: async (c: string, blob: Blob) => { pasta.set(c, new Uint8Array(await blob.arrayBuffer())); return { error: null }; },
    download: async (c: string) => pasta.has(c) ? { data: new Blob([pasta.get(c)!]), error: null } : { data: null, error: { message: "não existe" } },
    list: async (pre: string) => ({ data: [...new Set([...pasta.keys()].filter((k) => pre ? k.startsWith(pre + "/") : true).map((k) => pre ? k.slice(pre.length + 1) : k.split("/")[0]))].map((name) => ({ name })), error: null }),
    remove: async (l: string[]) => { l.forEach((k) => pasta.delete(k)); return { error: null }; },
  }) };
  return { db: { from: q, rpc: () => ({ data: null, error: null }), storage } as any, t, pasta };
}
function deps(b: ReturnType<typeof banco>, extra: Partial<DepsBackup> = {}, env: Record<string, string> = { BACKUP_SENHA: SENHA }) {
  const enviados: Array<{ para: string[]; assunto: string; texto: string; anexos: Array<{ nome: string; bytes: Uint8Array }> }> = [];
  const tempos: Record<string, number> = {}, chamadas: string[] = [];
  const d: DepsBackup = { adm: b.db, env: (k) => env[k], gerador: async () => G as any, enviarEmail: async (m) => { enviados.push(m); },
    // como na função: o passo roda e chama o seguinte (aqui direto, até o fim); mede o tempo de cada chamada
    chamarPasso: async (exec: number, p: Passo) => { const t0 = performance.now(); let fim = 0; const corre = executarEEncadear({ ...d, chamarPasso: async (e2, p2) => { fim = performance.now(); chamadas.push(p2); await d.chamarPasso(e2, p2); } }, exec, p);
      await corre; tempos[p] = Math.max(tempos[p] || 0, Math.round((fim || performance.now()) - t0)); }, ...extra };
  return { d, enviados, tempos, chamadas };
}
async function abrirZip(bytes: Uint8Array, senha?: string) {
  const r = new ZipReader(new Uint8ArrayReader(bytes), senha ? { password: senha } : {});
  const ents = await r.getEntries(); return { ents, ler: async (n: string) => { const e = ents.find((x) => x.filename === n); return e ? await e.getData!(new TextWriter(), senha ? { password: senha } : {}) : null; } };
}

// fluxo completo
{
  const b = banco(dados(60)), { d, enviados } = deps(b);
  const r = await iniciar(d, "agendamento");
  await rodar(d, r.exec);
  const ex = b.t.backup_execucoes[0];
  confere("execução termina como enviada", ex.situacao === "ok" && ex.passo === "enviar" && ex.terminado_em, ex);
  confere("um e-mail para os 2 endereços com 1 zip", enviados.length === 1 && enviados[0].para.join(",") === "centroautomotivodtcar@hotmail.com,dono@exemplo.com" && enviados[0].anexos.length === 1, enviados.map((e) => e.para));
  confere("assunto com a data de Brasília", enviados[0].assunto === "Backup de leitura DTCar Gestão — 05/11/2026" || /Backup de leitura DTCar Gestão — \d{2}\/\d{2}\/\d{4}/.test(enviados[0].assunto), enviados[0].assunto);
  confere("texto explica como abrir e não traz a senha", /7-Zip/.test(enviados[0].texto) && !enviados[0].texto.includes(SENHA));
  const z = enviados[0].anexos[0];
  confere("nome do zip com a data", /^DTCar-Backup-\d{4}-\d{2}-\d{2}\.zip$/.test(z.nome), z.nome);
  const { ents, ler } = await abrirZip(z.bytes, SENHA);
  const raiz = z.nome.replace(/\.zip$/, "") + "/";
  confere("tudo dentro de uma pasta só", ents.every((e) => e.filename.startsWith(raiz)));
  confere("zip criptografado (AES)", ents.every((e) => e.encrypted));
  confere("zip tem as páginas e a planilha", !!ents.find((e) => e.filename === raiz + "ABRIR-AQUI.html") && !!ents.find((e) => e.filename === raiz + "Planilha/DTCar-dados.xlsx"));
  confere("abre com a senha certa", (await ler(raiz + "ABRIR-AQUI.html") || "").includes("Buscar O.S."));
  let recusou = false; try { await (await abrirZip(z.bytes, "senha-errada")).ler(raiz + "ABRIR-AQUI.html"); } catch (_) { recusou = true; }
  confere("senha errada não abre", recusou);
  let semSenha = false; try { await (await abrirZip(z.bytes)).ler(raiz + "ABRIR-AQUI.html"); } catch (_) { semSenha = true; }
  confere("sem senha não abre", semSenha);
  confere("pasta temporária apagada depois do envio", b.pasta.size === 0, [...b.pasta.keys()]);
  confere("histórico guarda tamanho, tempos e quantidades (sem dados de cliente)", ex.detalhe.zips[0].bytes === z.bytes.length && ex.detalhe.ms.planilha >= 0 && ex.detalhe.resumo.os === 60 && !JSON.stringify(ex.detalhe).includes("JOSÉ"), ex.detalhe);
}
// sem senha: nada começa e nada sai
{
  const b = banco(dados(10)), { d, enviados } = deps(b, {}, {});
  let msg = ""; try { await iniciar(d, "agendamento"); } catch (e) { msg = (e as Error).message; }
  confere("sem BACKUP_SENHA não começa", /BACKUP_SENHA/.test(msg) && enviados.length === 0 && b.t.backup_execucoes.length === 0, msg);
  const curta = deps(b, {}, { BACKUP_SENHA: "senha-de-15-let" }); let m2 = ""; try { await iniciar(curta.d, "tela"); } catch (e) { m2 = (e as Error).message; }
  confere("senha curta (menos de 16) recusada", /16 letras/.test(m2), m2);
}
// desligado na tela: o agendamento não roda; o botão roda
{
  const b = banco(dados(10)); b.t.config[0].dados.backupLeitura.ativo = false;
  const { d } = deps(b); let msg = ""; try { await iniciar(d, "agendamento"); } catch (e) { msg = (e as Error).message; }
  confere("desligado: agendamento não roda", /desligado/.test(msg), msg);
  const r = await iniciar(d, "tela"); confere("desligado: o botão ainda gera", r.exec > 0);
}
// e-mail falhou: execução vira falha com o motivo e a pasta é limpa
{
  const b = banco(dados(10)), { d } = deps(b, { enviarEmail: async () => { throw new Error("A Microsoft pediu para conectar o e-mail de novo"); } });
  const r = await iniciar(d, "agendamento"); await rodar(d, r.exec);
  const ex = b.t.backup_execucoes[0];
  confere("falha no envio fica registrada com o motivo", ex.situacao === "erro" && /^enviar: A Microsoft pediu/.test(ex.erro), ex.erro);
  confere("falha no envio limpa a pasta temporária", b.pasta.size === 0, [...b.pasta.keys()]);
}
// passo fora de ordem e execução já terminada
{
  const b = banco(dados(10)), { d } = deps(b);
  const r = await iniciar(d, "tela");
  let m = ""; try { await passo(d, r.exec, "enviar"); } catch (e) { m = (e as Error).message; }
  confere("passo fora de ordem recusado", /Fora de ordem/.test(m), m);
  const r2 = await iniciar(d, "tela");
  confere("não começa outro enquanto um está rodando", r2.ja_rodando === true && r2.exec === r.exec);
}
// grande demais para um e-mail: dois zips; e se um sozinho passar, erro claro
{
  const b = banco(dados(1910)), { d, enviados, tempos } = deps(b);
  const r = await iniciar(d, "agendamento"); await rodar(d, r.exec);
  const ex = b.t.backup_execucoes[0];
  const total = ex.detalhe.zips ? ex.detalhe.zips.reduce((s: number, z: any) => s + z.bytes, 0) : 0;
  confere("volume real (1.910 O.S.) envia", ex.situacao === "ok", ex.erro);
  confere("volume real cabe no limite do anexo", ex.detalhe.zips && ex.detalhe.zips.every((z: any) => z.bytes <= LIMITE_ANEXO), ex.detalhe.zips);
  console.log(`volume real: ${ex.detalhe.zips?.length} zip(s), ${(total / 1048576).toFixed(2)} MB; tempo por passo (ms): planilha ${tempos.planilha}, páginas ${tempos.paginas}, envio ${tempos.enviar}`);
  confere("cada passo bem abaixo de 2 s de processamento (folga: < 1,5 s aqui)", tempos.planilha < 1500 && tempos.paginas < 1500 && tempos.enviar < 1500, tempos);
  confere("e-mail com o zip do volume real", enviados.length >= 1);
}
// zip grande demais para um e-mail: páginas e planilha em dois e-mails; se um sozinho passar, erro claro
{
  const b = banco(dados(200)), c1 = deps(b, { limiteAnexo: 0 }), { d, enviados } = c1;
  const tam = { unico: 0 };
  // descobre o tamanho do zip único e põe o limite entre ele e as partes
  const sonda = deps(banco(dados(200))); const r0 = await iniciar(sonda.d, "tela"); await rodar(sonda.d, r0.exec);
  tam.unico = sonda.enviados[0].anexos[0].bytes.length;
  d.limiteAnexo = tam.unico - 1;
  const r = await iniciar(d, "agendamento"); await rodar(d, r.exec);
  const ex = b.t.backup_execucoes[0];
  confere("acima do limite: dois e-mails (páginas e planilha), cada um com senha", ex.situacao === "ok" && enviados.length === 2 && /paginas\.zip$/.test(enviados[0].anexos[0].nome) && /planilha\.zip$/.test(enviados[1].anexos[0].nome) && /\(1 de 2\)/.test(enviados[0].assunto), enviados.map((e) => e.assunto));
  const p2 = await abrirZip(enviados[1].anexos[0].bytes, SENHA);
  confere("zip da planilha com senha e com a planilha", p2.ents.length === 1 && p2.ents[0].encrypted && p2.ents[0].filename.endsWith("Planilha/DTCar-dados.xlsx"));
  confere("dividir o zip roda o passo das páginas de novo noutra chamada (um zip grande por chamada)", JSON.stringify(c1.chamadas) === JSON.stringify(["paginas", "paginas", "enviar"]), c1.chamadas);
  // 2º e-mail falhou: registra quantos saíram
  const b3 = banco(dados(200)); let n3 = 0;
  const x3 = deps(b3, { limiteAnexo: tam.unico - 1, enviarEmail: async () => { if (++n3 === 2) throw new Error("Microsoft: erro 503"); } });
  const r3 = await iniciar(x3.d, "agendamento"); await rodar(x3.d, r3.exec);
  confere("2º e-mail falhou: registra 'enviou 1 de 2'", b3.t.backup_execucoes[0].situacao === "erro" && /enviou 1 de 2 e-mails; o 2º falhou: Microsoft: erro 503/.test(b3.t.backup_execucoes[0].erro), b3.t.backup_execucoes[0].erro);
  const b2 = banco(dados(200)), x2 = deps(b2, { limiteAnexo: 1000 });
  const r2 = await iniciar(x2.d, "agendamento"); await rodar(x2.d, r2.exec);
  confere("parte sozinha acima do limite: erro claro e nada enviado", b2.t.backup_execucoes[0].situacao === "erro" && /acima do limite/.test(b2.t.backup_execucoes[0].erro) && x2.enviados.length === 0 && b2.pasta.size === 0, b2.t.backup_execucoes[0].erro);
}
// tela: situação e "Gerar e enviar agora" pelo tratar()
{
  const b = banco(dados(10)), { d } = deps(b);
  const st = await situacaoBackup(b.db, (k) => ({ BACKUP_SENHA: SENHA } as Record<string, string>)[k]);
  confere("situação: senha cadastrada e e-mails", st.senha_cadastrada === true && st.config.emails.length === 2 && st.horario === "todo dia às 18h");
  const st2 = await situacaoBackup(b.db, () => undefined);
  // execução travada há mais de 10 minutos: a consulta de situação marca como falha e libera o botão
  b.t.backup_execucoes.push({ id: 99, situacao: "rodando", passo: "planilha", iniciado_em: new Date(Date.now() - 11 * 60000).toISOString(), detalhe: {} });
  const st4 = await situacaoBackup(b.db, () => SENHA);
  const trav = b.t.backup_execucoes.find((x) => x.id === 99)!;
  confere("travada há 10+ min vira falha ao abrir a tela (libera o botão)", trav.situacao === "erro" && /Parou no meio/.test(trav.erro) && !st4.execucoes.some((x: any) => x.situacao === "rodando"), trav);
  b.t.backup_execucoes = b.t.backup_execucoes.filter((x) => x.id !== 99);
  confere("situação sem senha avisa (sem mostrar a senha)", st2.senha_cadastrada === false && !JSON.stringify(st2).includes(SENHA));
  let bg: Promise<unknown> | null = null;
  const r = await tratar("backup_leitura", {}, { usuario: b.db, adm: b.db, env: (k) => ({ BACKUP_SENHA: SENHA } as Record<string, string>)[k], backup: async () => d, segundoPlano: (p) => { bg = p; } }) as any;
  await bg;
  confere("botão começa e roda em segundo plano", r.exec > 0 && /começou/.test(r.aviso) && b.t.backup_execucoes[0].situacao === "ok", r);
  const s = await tratar("backup_situacao", {}, { usuario: b.db, adm: b.db, env: () => SENHA }) as any;
  confere("tratar(backup_situacao) lista as execuções", s.execucoes.length === 1);
  b.t.config[0].dados.backupLeitura.emails = ["x@y.com", "invalido", "a@b.com", "c@d.com", "e@f.com"];
  const s3 = await situacaoBackup(b.db, () => SENHA);
  confere("no máximo 3 e-mails válidos", s3.config.emails.join(",") === "x@y.com,a@b.com,c@d.com", s3.config.emails);
}

console.log(`\n${ok.length} OK, ${falhas.length} falha(s)`);
for (const f of falhas) console.log("FALHOU: " + f);
if (falhas.length) Deno.exit(1);
