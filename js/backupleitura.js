// Backup de leitura: cópia dos dados que abre em qualquer computador, sem o DTCar Gestão no ar.
// Monta (1) páginas HTML navegáveis, com busca por nº da O.S., placa ou cliente, que abrem direto do disco, sem internet,
// e (2) uma planilha Excel (.xlsx) com uma aba por tabela.
// Este arquivo só monta o conteúdo (texto); quem chama faz o zip com senha:
//   - função "email" no Supabase (supabase/functions/email/backup.ts), todo dia às 18h, para os e-mails da oficina;
//   - programa para Windows (Grau 2, versão futura), a partir do banco do PC.
// Por isso NÃO usa window/document nem outra biblioteca. Mesmo formato de dados do backup restaurável ({ tabelas, config, gerado_em }).
// A cópia de leitura não volta para o sistema: para restaurar, continua valendo o backup .json.gz (Sistema › Backup).
import { etapaOS } from "./regras.js";
import { fmtTel, fmtDoc, exPlaca, totais, totalItem, endCompleto } from "./util.js";

/** Tabelas lidas para a cópia de leitura (o resto do backup restaurável não entra: notas, estoque, agente, boletos…) */
export const TABELAS_LEITURA = ["clientes", "veiculos", "produtos", "fornecedores", "ordens", "os_itens", "recibos", "receber", "contas", "vendas", "venda_itens"];

// Formatadores criados uma vez: toLocaleString a cada chamada fica ~100 vezes mais lento com milhares de itens.
const FUSO = "America/Sao_Paulo";
const F_BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const F_QTD = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const F_NUM = new Intl.NumberFormat("pt-BR");
const F_DH = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: FUSO });
const F_DIA = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: FUSO }); // AAAA-MM-DD em Brasília
const reais = n => F_BRL.format(Number(n) || 0);
const qtd = n => F_QTD.format(Number(n) || 0);
const dataHora = iso => { if (!iso) return ""; const d = new Date(iso); return isNaN(d) ? "" : F_DH.format(d); };
/** dia em Brasília (AAAA-MM-DD) de uma data com hora, ou a própria data quando já é só o dia */
export const diaBR = v => { if (!v) return ""; if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const d = new Date(v); return isNaN(d) ? "" : F_DIA.format(d); };
const data = v => { const d = diaBR(v); return d ? d.split("-").reverse().join("/") : ""; };
const n5 = n => String(n ?? "").padStart(5, "0");
const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Texto seguro dentro do HTML (nome de cliente, descrição, observação: tudo vem de fora) */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** Pedaço de nome de arquivo: sem acento nem símbolo (abre no Windows, no celular e no 7-Zip) */
const nomeArq = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9 -]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);

/* ---------------- etapa e pasta de cada O.S. ---------------- */
/** Nome da situação, sempre por extenso (nunca só a cor) */
export function nomeSituacao(o) {
  const e = etapaOS(o);
  if (e === "orcamento") return "Orçamento";
  if (e === "execucao") return "Aprovado · em execução";
  if (e === "pagamento") return o.status === "entregue" ? "Entregue · a receber" : "Aguardando pagamento · no pátio";
  if (e === "fechada") return "Fechada";
  if (e === "recusado") return "Recusada";
  if (e === "cancelado") return "Cancelada";
  return String(o.status || "");
}
/** Pasta da O.S. dentro do zip. Abertas: um arquivo por O.S.; fechadas: um arquivo por mês de abertura; recusadas e canceladas: por ano. */
export function lugarDaOS(o) {
  const e = etapaOS(o), dia = diaBR(o.criado_em) || "0000-00-00", ano = dia.slice(0, 4), mes = Number(dia.slice(5, 7)) || 1;
  const sozinha = pasta => ({ pasta, arquivo: `OS ${n5(o.numero)} - ${exPlaca(o.veiculo && o.veiculo.placa) || "sem placa"} - ${nomeArq(o.cliente && o.cliente.nome) || "sem cliente"}.html`, aberta: true });
  if (e === "orcamento") return sozinha("OS/1-Orcamento");
  if (e === "execucao") return sozinha("OS/2-Aprovado-em-execucao");
  if (e === "pagamento") return sozinha(o.status === "entregue" ? "OS/4-Entregue-a-receber" : "OS/3-Aguardando-pagamento-no-patio");
  if (e === "fechada") return { pasta: `OS/5-Fechadas/${ano}`, arquivo: `${ano}-${String(mes).padStart(2, "0")}-${MESES[mes - 1]}.html`, aberta: false };
  return { pasta: "OS/6-Recusadas-e-canceladas", arquivo: `${ano}.html`, aberta: false };
}

/* ---------------- página ---------------- */
const CSS = `:root{--preto:#16191d;--azul:#174f94;--fundo:#eceef0;--borda:#c9ced4;--texto:#16191d;--fraco:#5b636d;--ok:#1d7a3e;--alerta:#a15c00;--ruim:#b42318}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:15px/1.45 Barlow,"Segoe UI",system-ui,Arial,sans-serif;background:var(--fundo);color:var(--texto)}
header.topo{background:var(--preto);color:#fff;padding:12px 16px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline}header.topo b{font-size:18px}header.topo span{color:#b9c0c8;font-size:13px}
nav.menu{background:#fff;border-bottom:1px solid var(--borda);padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px 16px}nav.menu a{color:var(--azul);text-decoration:none;font-weight:600}
main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:22px;margin:4px 0 12px}h2{font-size:18px;margin:0 0 6px}a{color:var(--azul)}
.folha{background:#fff;border:1px solid var(--borda);padding:16px;margin:0 0 16px;page-break-after:always}
.cab{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;border-bottom:2px solid var(--preto);padding-bottom:8px;margin-bottom:10px}.cab small{color:var(--fraco)}
.sit{display:inline-block;font-weight:700;border:1px solid currentColor;padding:1px 8px;border-radius:3px;font-size:13px}.s-orc{color:var(--alerta)}.s-exe{color:var(--azul)}.s-pag{color:var(--ok)}.s-fec{color:var(--fraco)}.s-rec{color:var(--ruim)}
.grade{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0}.box{border:1px solid var(--borda);padding:8px 10px}.box h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--fraco)}
.rolar{overflow-x:auto;-webkit-overflow-scrolling:touch}table{width:100%;border-collapse:collapse;background:#fff;font-size:14px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--borda);vertical-align:top}
th{background:#f4f5f6;font-weight:600}td.n,th.n{text-align:right;white-space:nowrap}tfoot td,tfoot th{border-bottom:0}tfoot tr:last-child th{font-size:15px}
.campo{display:block;margin:6px 0}.campo b{font-weight:600}.aviso{background:#fff7e0;border:1px solid #e3c06a;padding:8px 10px;margin:10px 0}.dica{color:var(--fraco);font-size:13px}
input[type=search]{width:100%;padding:10px 12px;font:inherit;border:1px solid var(--borda);border-radius:4px;background:#fff}.cartoes{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
.cartoes a{flex:1 1 180px;background:#fff;border:1px solid var(--borda);padding:10px;text-decoration:none;color:var(--texto)}.cartoes a b{display:block;font-size:20px;color:var(--azul)}
button{font:inherit;padding:6px 14px;border:1px solid var(--azul);background:var(--azul);color:#fff;border-radius:4px;cursor:pointer}
@media(max-width:640px){main{padding:10px}.grade{grid-template-columns:1fr}.folha{padding:10px}th,td{padding:4px 6px}}
@media print{header.topo,nav.menu,.naoimp{display:none}body{background:#fff}main{padding:0;max-width:none}.folha{border:0;padding:0}}`;

function pagina(titulo, raiz, corpo, ctx, script = "") {
  const r = raiz;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(titulo)} — DTCar Gestão (cópia de leitura)</title><link rel="stylesheet" href="${r}estilo.css"></head><body>
<header class="topo"><b>DTCar Gestão — cópia de leitura</b><span>${esc(ctx.oficina)} · dados de ${esc(dataHora(ctx.gerado))}</span></header>
<nav class="menu naoimp"><a href="${r}ABRIR-AQUI.html">Início e busca</a><a href="${r}Cadastros/Clientes.html">Clientes</a><a href="${r}Cadastros/Veiculos.html">Veículos</a><a href="${r}Cadastros/Produtos.html">Produtos</a><a href="${r}Cadastros/Fornecedores.html">Fornecedores</a><a href="${r}Financeiro/A-receber.html">A receber</a><a href="${r}Financeiro/A-pagar.html">A pagar</a><a href="${r}Financeiro/Recibos.html">Recibos</a><a href="${r}Vendas/Vendas-de-balcao.html">Vendas</a></nav>
<main>${corpo}</main>${script}</body></html>`;
}
/** tabela simples: cab = [[título, numérico?]], linhas já em HTML seguro */
function tabela(cab, linhas, rodape = "") {
  return `<div class="rolar"><table><thead><tr>${cab.map(([t, n]) => `<th${n ? ' class="n"' : ""}>${esc(t)}</th>`).join("")}</tr></thead><tbody>${
    linhas.map(l => `<tr${l.id ? ` id="${l.id}"` : ""}>${(l.c || l).map((x, i) => `<td${cab[i] && cab[i][1] ? ' class="n"' : ""}>${x}</td>`).join("")}</tr>`).join("")}</tbody>${rodape}</table></div>`;
}
const classeSit = o => ({ orcamento: "s-orc", execucao: "s-exe", pagamento: "s-pag", fechada: "s-fec" }[etapaOS(o)] || "s-rec");

/* ---------------- uma O.S. (mesmas informações da impressão) ---------------- */
function blocoOS(o, x, ctx) {
  const itens = (x.itens.get(o.id) || []).slice().sort((a, b) => (a.posicao || 0) - (b.posicao || 0));
  const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(o.status) && itens.some(i => i.aprovado === true);
  const lista = itens.filter(i => aprov ? i.aprovado === true : i.aprovado !== false), recusados = aprov ? itens.filter(i => i.aprovado === false) : [];
  const t = totais(itens, o.desconto, aprov);
  const c = { ...(o.cliente || {}), ...(x.cli.get(o.cliente_id) || {}) }, v = { ...(o.veiculo || {}), ...(x.vei.get(o.veiculo_id) || {}) };
  const tels = [c.telefone, c.telefone2, c.telefone3].filter(Boolean).map(fmtTel).join(" / ");
  const linha = i => [esc(i.descricao) + (i.fornecida_cliente ? " (peça do cliente)" : i.qualidade === "usada" ? " (usada, autorizada)" : ""), esc(i.codigo),
    i.horas ? qtd(i.horas) + " h" : qtd(i.qtd), i.fornecida_cliente ? "—" : reais(i.valor_unit), i.fornecida_cliente ? "—" : reais(totalItem(i))];
  const tipos = [["servico", "Serviços"], ["peca", "Produtos"], ["terceiro", "Serviços de terceiros"]];
  const tabelas = tipos.map(([tp, nome]) => { const l = lista.filter(i => (i.tipo || "peca") === tp); return l.length ? tabela([[nome], ["Ref."], ["Qtd.", 1], ["Unit.", 1], ["Total", 1]], l.map(linha)) : ""; }).join("");
  const somas = [["Produtos", t.pecas], ["Serviços", t.servicos], ["Serviços de terceiros", t.terceiros], ["Desconto", -t.desconto]].filter(([, val]) => Number(val));
  const recs = (x.recibos.get(o.id) || []).filter(r => !r.cancelado), parc = x.parcelas.get(o.id) || [];
  const campo = (r, val) => val === null || val === undefined || String(val).trim() === "" ? "" : `<span class="campo"><b>${esc(r)}:</b> ${esc(val)}</span>`;
  return `<article class="folha" id="os-${o.numero}">
<div class="cab"><div><h2>${aprov ? "ORDEM DE SERVIÇO" : "ORÇAMENTO"} Nº ${n5(o.numero)}</h2><span class="sit ${classeSit(o)}">${esc(nomeSituacao(o))}</span></div>
<div><small>Aberta em ${esc(dataHora(o.criado_em))}${o.entregue_em ? "<br>Entregue em " + esc(dataHora(o.entregue_em)) : o.previsao_entrega ? "<br>Previsão " + esc(data(o.previsao_entrega)) : ""}${o.finalizada_em ? "<br>Fechada em " + esc(dataHora(o.finalizada_em)) : ""}</small></div></div>
<div class="grade"><div class="box"><h4>Cliente</h4><b>${esc(c.nome)}</b>${c.codigo ? ` <small>(cód. ${esc(c.codigo)})</small>` : ""}<br>${esc(tels)}${c.doc ? " · " + esc(fmtDoc(c.doc)) : ""}${c.email ? "<br>" + esc(c.email) : ""}<br>${esc(endCompleto(c) || c.endereco)}</div>
<div class="box"><h4>Veículo</h4><b>${esc(exPlaca(v.placa))}</b> ${esc([v.marca, v.modelo, v.ano, v.cor].filter(Boolean).join(" "))}${v.chassi ? "<br>Chassi " + esc(v.chassi) : ""}<br>KM entrada: ${o.km_entrada ?? "—"}${o.km_saida ? " · KM saída: " + esc(o.km_saida) : ""}</div></div>
${campo("Reclamação do cliente", o.reclamacao)}${campo("Diagnóstico", o.diagnostico)}${tabelas || '<p class="dica">Sem itens.</p>'}
${recusados.length ? `<p class="dica">Não aprovados pelo cliente: ${recusados.map(i => esc(i.descricao)).join("; ")}</p>` : ""}
<div class="rolar"><table><tfoot>${somas.map(([r, val]) => `<tr><td>${esc(r)}</td><td class="n">${reais(val)}</td></tr>`).join("")}<tr><th>Total</th><th class="n">${reais(t.total)}</th></tr>
${recs.length ? `<tr><td>Recebido</td><td class="n">${reais(recs.reduce((s, r) => s + Number(r.valor || 0), 0))}</td></tr>` : ""}</tfoot></table></div>
${recs.length ? `<p><b>Recibos:</b> ${recs.map(r => `nº ${esc(r.numero)} de ${esc(data(r.data))}, ${reais(r.valor)}${r.forma ? " (" + esc(r.forma) + ")" : ""}`).join("; ")}</p>` : ""}
${parc.length ? `<p><b>Parcelas:</b> ${parc.map(p => `${esc(p.parcela)}/${esc(p.parcelas)} vence ${esc(data(p.vencimento))}, ${reais(p.valor)} — ${p.status === "paga" ? "paga" : p.status === "cancelada" ? "cancelada" : "em aberto"}`).join("; ")}</p>` : ""}
${campo("Condições de pagamento", o.condicoes_pagamento)}${campo("Forma de pagamento", o.forma_pagamento)}${campo("Mecânico", o.mecanico_nome)}${campo("Consultor", o.consultor_nome)}
${campo("Observações da execução", o.obs_execucao)}${campo("Observações internas", o.obs_internas)}${campo("Motivo do cancelamento", o.motivo_cancelamento)}
${o.garantia_dias && aprov ? `<p class="dica">Garantia do serviço: ${esc(o.garantia_dias)} dias.</p>` : ""}
<p class="naoimp"><button type="button" onclick="print()">Imprimir</button></p></article>`;
}

/* ---------------- montagem ---------------- */
function indices(T) {
  const agrupar = (lista, chave) => { const m = new Map(); for (const l of lista || []) { const k = l[chave]; if (!k) continue; if (!m.has(k)) m.set(k, []); m.get(k).push(l); } return m; };
  return { cli: new Map((T.clientes || []).map(c => [c.id, c])), vei: new Map((T.veiculos || []).map(v => [v.id, v])),
    itens: agrupar(T.os_itens, "ordem_id"), recibos: agrupar(T.recibos, "ordem_id"), parcelas: agrupar(T.receber, "ordem_id"),
    veiDoCli: agrupar(T.veiculos, "cliente_id"), osDoCli: agrupar(T.ordens, "cliente_id"), numOS: new Map((T.ordens || []).map(o => [o.id, o.numero])),
    vendaItens: agrupar(T.venda_itens, "venda_id") };
}
/** Nome da pasta principal do zip: DTCar-Backup-AAAA-MM-DD (dia em Brasília) */
export const pastaRaiz = gerado => "DTCar-Backup-" + (diaBR(gerado || new Date().toISOString()) || "sem-data");

/**
 * Páginas HTML da cópia de leitura.
 * @returns {{ arquivos: Array<[string, string]>, resumo: object }} caminhos relativos à pasta principal
 */
export function montarPaginas(bk) {
  const T = bk.tabelas || {}, cfg = bk.config || {}, gerado = bk.gerado_em || new Date().toISOString();
  const ctx = { oficina: cfg.nome || "DTCar Centro Automotivo", gerado }, x = indices(T), arquivos = [];
  const ordens = (T.ordens || []).slice().sort((a, b) => (a.numero || 0) - (b.numero || 0));
  // O.S.: abertas uma por arquivo; fechadas por mês; recusadas/canceladas por ano
  const grupos = new Map(), indice = [];
  for (const o of ordens) {
    const l = lugarDaOS(o), caminho = l.pasta + "/" + l.arquivo;
    if (!grupos.has(caminho)) grupos.set(caminho, { l, lista: [] });
    grupos.get(caminho).lista.push(o);
    indice.push([o.numero, (o.veiculo && o.veiculo.placa) || "", (o.cliente && o.cliente.nome) || "", diaBR(o.criado_em), nomeSituacao(o), Number(o.total) || 0, caminho + (l.aberta ? "" : "#os-" + o.numero), l.aberta ? 1 : 0]);
  }
  for (const [caminho, { l, lista }] of grupos) {
    const raiz = "../".repeat(l.pasta.split("/").length);
    const titulo = l.aberta ? `O.S. ${lista[0].numero}` : l.arquivo.replace(/\.html$/, "").replace(/-/g, " ");
    const sumario = l.aberta ? "" : `<h1>O.S. ${l.pasta.includes("Fechadas") ? "fechadas" : "recusadas e canceladas"} — ${esc(titulo)}</h1><p class="dica">${lista.length} O.S. Use Ctrl+F para procurar nesta página.</p>
<div class="rolar naoimp"><table><thead><tr><th>O.S.</th><th>Placa</th><th>Cliente</th><th class="n">Total</th></tr></thead><tbody>${lista.map(o => `<tr><td><a href="#os-${o.numero}">${o.numero}</a></td><td>${esc(exPlaca(o.veiculo && o.veiculo.placa))}</td><td>${esc(o.cliente && o.cliente.nome)}</td><td class="n">${reais(o.total)}</td></tr>`).join("")}</tbody></table></div>`;
    arquivos.push([caminho, pagina(titulo, raiz, sumario + lista.map(o => blocoOS(o, x, ctx)).join("\n"), ctx)]);
  }
  // início: contagens e busca (os dados vão dentro da página: funciona aberta direto do disco)
  const abertas = indice.filter(d => d[7]), cont = p => abertas.filter(d => d[6].startsWith(p)).length;
  const cartoes = [["OS/1-Orcamento", "Orçamentos"], ["OS/2-Aprovado-em-execucao", "Aprovadas · em execução"], ["OS/3-Aguardando-pagamento-no-patio", "Aguardando pagamento · no pátio"], ["OS/4-Entregue-a-receber", "Entregues · a receber"]];
  const dados = JSON.stringify(indice).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
  const inicio = `<h1>Início</h1><div class="aviso">Cópia <b>somente para leitura</b>, gerada em ${esc(dataHora(gerado))}. Ela não volta para o sistema: para restaurar dados, use o backup .json.gz (Sistema › Backup).</div>
<div class="cartoes">${cartoes.map(([p, n]) => `<a href="#" data-filtro="${p}"><b>${cont(p)}</b>${esc(n)}</a>`).join("")}<a href="#" data-filtro="*"><b>${F_NUM.format(indice.length)}</b>Todas as O.S.</a></div>
<label for="q"><b>Buscar O.S.</b></label><input type="search" id="q" placeholder="Nº da O.S., placa ou nome do cliente" autocomplete="off">
<p id="info" class="dica"></p><div class="rolar"><table><thead><tr><th>O.S.</th><th>Placa</th><th>Cliente</th><th>Abertura</th><th>Situação</th><th class="n">Total</th></tr></thead><tbody id="res"></tbody></table></div>
<p class="dica">A planilha com todos os dados está em <b>Planilha/DTCar-dados.xlsx</b>.</p>`;
  const script = `<script>(function(){var D=${dados};
function nz(s){return String(s).normalize("NFD").replace(/[\\u0300-\\u036f]/g,"").toLowerCase()}
function e(s){return String(s).replace(/[&<>"']/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]})}
var F=new Intl.NumberFormat("pt-BR",{style:"currency",currency:"BRL"}),filtro="";
function mostra(){var q=nz(document.getElementById("q").value.trim()),qp=q.replace(/[^a-z0-9]/g,""),r;
if(q){r=D.filter(function(d){return String(d[0])===q||(qp.length>2&&nz(d[1]).replace(/[^a-z0-9]/g,"").indexOf(qp)>=0)||nz(d[2]).indexOf(q)>=0})}
else if(filtro==="*"){r=D.slice().reverse()}else if(filtro){r=D.filter(function(d){return d[6].indexOf(filtro)===0})}else{r=D.filter(function(d){return d[7]})}
document.getElementById("info").textContent=(q?r.length+" encontrada(s)":filtro==="*"?"Todas as O.S. (as 400 mais recentes; use a busca para as outras)":"O.S. em aberto: "+r.length)+" · total na cópia: "+D.length;
document.getElementById("res").innerHTML=r.slice(0,400).map(function(d){return'<tr><td><a href="'+encodeURI(d[6]).replace(/%23/g,"#")+'">'+d[0]+'</a></td><td>'+e(d[1])+'</td><td>'+e(d[2])+'</td><td>'+e(d[3].split("-").reverse().join("/"))+'</td><td><b>'+e(d[4])+'</b></td><td class="n">'+F.format(d[5])+'</td></tr>'}).join("")}
document.getElementById("q").addEventListener("input",function(){filtro="";mostra()});
Array.prototype.forEach.call(document.querySelectorAll("[data-filtro]"),function(a){a.addEventListener("click",function(ev){ev.preventDefault();document.getElementById("q").value="";filtro=a.getAttribute("data-filtro");mostra()})});mostra()})();</script>`;
  arquivos.push(["ABRIR-AQUI.html", pagina("Início", "", inicio, ctx, script)]);
  arquivos.push(["estilo.css", CSS]);
  // cadastros
  const linkOS = (o, de) => { const l = lugarDaOS(o); return `<a href="${de}${encodeURI(l.pasta + "/" + l.arquivo)}${l.aberta ? "" : "#os-" + o.numero}">${o.numero}</a>`; };
  const clientes = (T.clientes || []).slice().sort((a, b) => String(a.nome).localeCompare(String(b.nome), "pt-BR"));
  arquivos.push(["Cadastros/Clientes.html", pagina("Clientes", "../", `<h1>Clientes (${F_NUM.format(clientes.length)})</h1><p class="dica">Use Ctrl+F para procurar. Cada cliente mostra os veículos e as O.S.</p>` +
    tabela([["Cód."], ["Nome"], ["Telefones"], ["CPF/CNPJ"], ["Endereço"], ["Veículos"], ["O.S."]], clientes.map(c => ({ id: "cli-" + (c.codigo ?? c.id), c: [esc(c.codigo), "<b>" + esc(c.nome) + "</b>" + (c.situacao && c.situacao !== "liberado" ? ` <small>(${esc(c.situacao)})</small>` : "") + (c.email ? "<br><small>" + esc(c.email) + "</small>" : ""),
      esc([c.telefone, c.telefone2, c.telefone3].filter(Boolean).map(fmtTel).join(" / ")), esc(fmtDoc(c.doc)), esc(endCompleto(c) || c.endereco),
      (x.veiDoCli.get(c.id) || []).map(v => esc(exPlaca(v.placa))).join(", "), (x.osDoCli.get(c.id) || []).sort((a, b) => b.numero - a.numero).map(o => linkOS(o, "../")).join(" ")] }))), ctx)]);
  const veiculos = (T.veiculos || []).slice().sort((a, b) => String(a.placa).localeCompare(String(b.placa)));
  arquivos.push(["Cadastros/Veiculos.html", pagina("Veículos", "../", `<h1>Veículos (${F_NUM.format(veiculos.length)})</h1>` +
    tabela([["Placa"], ["Veículo"], ["Ano"], ["Cor"], ["KM", 1], ["Dono"]], veiculos.map(v => [`<b>${esc(exPlaca(v.placa))}</b>`, esc([v.marca, v.modelo].filter(Boolean).join(" ")), esc(v.ano), esc(v.cor),
      v.km_atual ? F_NUM.format(v.km_atual) : "", esc((x.cli.get(v.cliente_id) || {}).nome)])), ctx)]);
  const produtos = (T.produtos || []).slice().sort((a, b) => (a.codigo || 0) - (b.codigo || 0));
  arquivos.push(["Cadastros/Produtos.html", pagina("Produtos", "../", `<h1>Produtos e serviços (${F_NUM.format(produtos.length)})</h1>` +
    tabela([["Cód."], ["Descrição"], ["Ref."], ["Estoque", 1], ["Custo", 1], ["Venda à vista", 1], ["Situação"]], produtos.map(p => [esc(p.codigo), esc(p.descricao), esc(p.referencia),
      p.tipo === "servico" ? "serviço" : qtd(p.estoque_atual), reais(p.custo), reais(p.preco_vista), p.ativo === false ? "inativo" : ""])), ctx)]);
  const forn = (T.fornecedores || []).slice().sort((a, b) => String(a.razao).localeCompare(String(b.razao), "pt-BR"));
  arquivos.push(["Cadastros/Fornecedores.html", pagina("Fornecedores", "../", `<h1>Fornecedores (${F_NUM.format(forn.length)})</h1>` +
    tabela([["Razão social"], ["Fantasia"], ["CNPJ"], ["Telefone"], ["E-mail"], ["Cidade"]], forn.map(f => [esc(f.razao), esc(f.fantasia), esc(fmtDoc(f.cnpj)), esc(fmtTel(f.telefone)), esc(f.email), esc([f.cidade, f.uf].filter(Boolean).join("/"))])), ctx)]);
  // financeiro
  const ordId = new Map((T.ordens || []).map(o => [o.id, o]));
  const rec = (T.receber || []).filter(r => r.status !== "cancelada").sort((a, b) => String(a.vencimento).localeCompare(String(b.vencimento)));
  const hoje = diaBR(gerado), aberto = rec.filter(r => r.status === "aberta");
  arquivos.push(["Financeiro/A-receber.html", pagina("A receber", "../", `<h1>Contas a receber</h1><p>Em aberto: <b>${reais(aberto.reduce((s, r) => s + Number(r.valor || 0), 0))}</b> em ${aberto.length} parcela(s); vencidas: <b>${aberto.filter(r => r.vencimento < hoje).length}</b>.</p>` +
    tabela([["Vencimento"], ["Cliente"], ["O.S."], ["Parcela"], ["Forma"], ["Valor", 1], ["Situação"]], rec.map(r => { const o = ordId.get(r.ordem_id); return [esc(data(r.vencimento)), esc(r.cliente_nome || (o && o.cliente && o.cliente.nome)),
      o ? linkOS(o, "../") : "", `${esc(r.parcela)}/${esc(r.parcelas)}`, esc(r.forma), reais(r.valor), r.status === "paga" ? "paga em " + esc(data(r.pago_em)) : r.vencimento < hoje ? "<b>vencida</b>" : "em aberto"]; })), ctx)]);
  const pagar = (T.contas || []).filter(c => c.status !== "cancelada").sort((a, b) => String(b.vencimento).localeCompare(String(a.vencimento)));
  const pAberto = pagar.filter(c => c.status === "aberta");
  arquivos.push(["Financeiro/A-pagar.html", pagina("A pagar", "../", `<h1>Contas a pagar</h1><p>Em aberto: <b>${reais(pAberto.reduce((s, c) => s + Number(c.valor || 0), 0))}</b> em ${pAberto.length} conta(s).</p>` +
    tabela([["Vencimento"], ["Favorecido"], ["Descrição"], ["Documento"], ["Valor", 1], ["Situação"], ["Saiu da conta"]], pagar.map(c => [esc(data(c.vencimento)), esc(c.favorecido), esc(c.descricao), esc(c.documento), reais(c.valor),
      c.status === "paga" ? "paga em " + esc(data(c.pago_em)) : c.vencimento < hoje ? "<b>vencida</b>" : "em aberto", esc(c.conta_origem)])), ctx)]);
  const recibos = (T.recibos || []).slice().sort((a, b) => (b.numero || 0) - (a.numero || 0));
  arquivos.push(["Financeiro/Recibos.html", pagina("Recibos", "../", `<h1>Recibos (${F_NUM.format(recibos.length)})</h1>` +
    tabela([["Nº"], ["Data"], ["Pagador"], ["Referente"], ["O.S."], ["Forma"], ["Entrou na conta"], ["Valor", 1]], recibos.map(r => { const o = ordId.get(r.ordem_id); return [esc(r.numero), esc(data(r.data)), esc(r.pagador),
      esc(r.referente) + (r.cancelado ? " <b>(cancelado)</b>" : ""), o ? linkOS(o, "../") : "", esc(r.forma), esc(r.conta_destino), reais(r.valor)]; })), ctx)]);
  const vendas = (T.vendas || []).slice().sort((a, b) => (b.numero || 0) - (a.numero || 0));
  arquivos.push(["Vendas/Vendas-de-balcao.html", pagina("Vendas de balcão", "../", `<h1>Vendas de balcão (${F_NUM.format(vendas.length)})</h1>` +
    tabela([["Nº"], ["Data"], ["Cliente"], ["Itens"], ["Forma"], ["Total", 1]], vendas.map(v => [esc(v.numero), esc(dataHora(v.criado_em)), esc((v.cliente && v.cliente.nome) || (x.cli.get(v.cliente_id) || {}).nome),
      (x.vendaItens.get(v.id) || []).map(i => `${qtd(i.qtd)} × ${esc(i.descricao)}`).join("<br>") + (v.status === "cancelada" ? " <b>(cancelada)</b>" : ""), esc(v.forma_pagamento), reais(v.total)])), ctx)]);
  arquivos.push(["LEIA-ME.txt", [
    "DTCar Gestão — cópia de leitura", "", `Dados de ${dataHora(gerado)} (horário de Brasília).`, "",
    "Como abrir:", "  1. Extraia a pasta toda (7-Zip: botão direito > 7-Zip > Extrair aqui; pede a senha do backup).",
    "  2. Abra ABRIR-AQUI.html no navegador (Chrome, Edge, Firefox). Funciona sem internet.",
    "  3. A planilha com todos os dados está em Planilha\\DTCar-dados.xlsx (Excel, LibreOffice ou Google Planilhas).", "",
    "Pastas:", "  OS\\1 a 4  — O.S. em aberto, um arquivo por O.S., separadas pela situação.",
    "  OS\\5-Fechadas — um arquivo por mês de abertura, com todas as O.S. do mês (Ctrl+F para procurar).",
    "  OS\\6-Recusadas-e-canceladas — um arquivo por ano.", "  Cadastros, Financeiro e Vendas — listas completas.", "",
    "Esta cópia NÃO volta para o sistema. Para restaurar dados, use o backup .json.gz (Sistema > Backup).",
    "Tem dados de clientes (LGPD): guarde em local protegido e não compartilhe a senha.", ""].join("\r\n")]);
  const resumo = { os: ordens.length, os_abertas: abertas.length, clientes: (T.clientes || []).length, veiculos: (T.veiculos || []).length, produtos: (T.produtos || []).length,
    recibos: (T.recibos || []).length, a_receber: aberto.length, a_pagar: pAberto.length, arquivos: arquivos.length };
  return { arquivos, resumo };
}

/* ---------------- planilha (.xlsx feito à mão: só texto e número, sem biblioteca de fora) ---------------- */
// Colunas que não entram: dados internos sem uso para quem lê (identificadores) e conteúdo pesado (assinaturas, ficha do checklist).
const FORA = new Set(["criado_por", "checkin", "assinatura_entrada", "assinatura_entrega", "aprovacao", "ficha"]);
const MAX_CEL = 32000; // o Excel aceita até 32.767 letras por célula
const xmlTexto = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const letra = i => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
function aba(linhas) {
  const cols = [], vistos = new Set();
  for (const l of linhas) for (const k of Object.keys(l)) if (!vistos.has(k) && !FORA.has(k) && k !== "id" && !k.endsWith("_id")) { vistos.add(k); cols.push(k); }
  const cel = (v, ref, est) => {
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number" && isFinite(v)) return `<c r="${ref}"${est ? ` s="${est}"` : ""}><v>${v}</v></c>`;
    if (typeof v === "boolean") return `<c r="${ref}" t="inlineStr"><is><t>${v ? "sim" : "não"}</t></is></c>`;
    let s = typeof v === "object" ? JSON.stringify(v) : String(v);
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) s = dataHora(s); // data com hora vira horário de Brasília
    if (s.length > MAX_CEL) s = s.slice(0, MAX_CEL) + "…";
    return `<c r="${ref}" t="inlineStr"${est ? ` s="${est}"` : ""}><is><t xml:space="preserve">${xmlTexto(s)}</t></is></c>`;
  };
  const numerico = new Set(cols.filter(k => linhas.some(l => typeof l[k] === "number" || (typeof l[k] === "string" && /^-?\d+(\.\d+)?$/.test(l[k]) && /valor|total|preco|custo|qtd|desconto|recebido|juros|margem|estoque|km|horas|subtotal/.test(k)))));
  const partes = [`<row r="1">${cols.map((k, i) => cel(k, letra(i) + 1, 1)).join("")}</row>`];
  linhas.forEach((l, n) => partes.push(`<row r="${n + 2}">${cols.map((k, i) => { let v = l[k]; if (numerico.has(k) && typeof v === "string" && v !== "" && !isNaN(Number(v))) v = Number(v); return cel(v, letra(i) + (n + 2)); }).join("")}</row>`));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${partes.join("")}</sheetData>${linhas.length ? `<autoFilter ref="A1:${letra(Math.max(cols.length - 1, 0))}${linhas.length + 1}"/>` : ""}</worksheet>`;
}

/**
 * Partes do arquivo DTCar-dados.xlsx (cada uma é um texto; quem chama junta num zip SEM senha e põe o .xlsx dentro do zip do backup).
 * @returns {Array<[string, string]>}
 */
export function montarPlanilha(bk) {
  const T = bk.tabelas || {}, x = indices(T), num = id => x.numOS.get(id) ?? "", numVenda = new Map((T.vendas || []).map(v => [v.id, v.numero]));
  const nomeCli = id => (x.cli.get(id) || {}).nome || "";
  const abas = [
    ["O.S.", (T.ordens || []).slice().sort((a, b) => a.numero - b.numero).map(o => ({ numero: o.numero, situacao: nomeSituacao(o), abertura: o.criado_em, placa: (o.veiculo && o.veiculo.placa) || "",
      veiculo: [o.veiculo && o.veiculo.marca, o.veiculo && o.veiculo.modelo].filter(Boolean).join(" "), cliente: (o.cliente && o.cliente.nome) || nomeCli(o.cliente_id), telefone: (o.cliente && o.cliente.telefone) || "",
      km_entrada: o.km_entrada, reclamacao: o.reclamacao, diagnostico: o.diagnostico, desconto: o.desconto, total: o.total, recebido: o.recebido, mecanico: o.mecanico_nome,
      entregue_em: o.entregue_em, fechada_em: o.finalizada_em, forma_pagamento: o.forma_pagamento, obs_execucao: o.obs_execucao, obs_internas: o.obs_internas, motivo_cancelamento: o.motivo_cancelamento }))],
    ["Itens das O.S.", (T.os_itens || []).map(i => ({ os: num(i.ordem_id), ...i, total: totalItem(i) })).sort((a, b) => (a.os - b.os) || ((a.posicao || 0) - (b.posicao || 0)))],
    ["Clientes", (T.clientes || []).slice().sort((a, b) => (a.codigo || 0) - (b.codigo || 0))],
    ["Veículos", (T.veiculos || []).map(v => ({ ...v, dono: nomeCli(v.cliente_id) }))],
    ["Produtos", (T.produtos || []).slice().sort((a, b) => (a.codigo || 0) - (b.codigo || 0))],
    ["Fornecedores", T.fornecedores || []],
    ["Recibos", (T.recibos || []).map(r => ({ ...r, os: num(r.ordem_id) })).sort((a, b) => (a.numero || 0) - (b.numero || 0))],
    ["A receber", (T.receber || []).map(r => ({ ...r, os: num(r.ordem_id) }))],
    ["A pagar", (T.contas || []).map(c => ({ ...c, os: num(c.ordem_id) }))],
    ["Vendas", (T.vendas || []).map(v => ({ ...v, cliente: (v.cliente && v.cliente.nome) || nomeCli(v.cliente_id) }))],
    ["Itens das vendas", (T.venda_itens || []).map(i => ({ venda: numVenda.get(i.venda_id) ?? "", ...i }))],
  ];
  const arqs = abas.map(([, l], i) => [`xl/worksheets/sheet${i + 1}.xml`, aba(l)]);
  const nomesAba = abas.map(([n]) => xmlTexto(n.replace(/[\\/?*[\]:]/g, "").slice(0, 31)));
  return [
    ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${abas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`],
    ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`],
    ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${nomesAba.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>`],
    ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${abas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${abas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
    ["xl/styles.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`],
    ...arqs,
  ];
}
