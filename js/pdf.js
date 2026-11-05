// Documentos em PDF: checklist de entrada, orçamento e ordem de serviço
import { exPlaca, fmtDoc, fmtTel, fmtKm, fmtDataHora, fmtData, reais, qtdFmt, totais, totalItem, numOS, somaDias, endCompleto } from "./util.js";
import { secoesCheckin, achados, QUALIDADE, termoEntradaFinal, TERMO_GARANTIA, TERMO_ORCAMENTO, STATUS, situacaoOS, TABELAS_PRECO } from "./regras.js";

const AZUL = [10, 75, 208], TINTA = [20, 26, 36], CINZA = [96, 106, 122], LINHA = [208, 214, 223], FUNDO = [243, 245, 248];
const COR = { ok: [18, 122, 70], warn: [160, 95, 0], bad: [189, 49, 41], info: AZUL, na: CINZA };
const W = 210, H = 297, M = 12, CW = W - 2 * M, MEIA = (CW - 4) / 2;

// Leitor de imagem trocável: o navegador usa o padrão abaixo; a função "email" do Supabase (que gera o PDF para anexar)
// troca por um que lê a pasta de fotos direto (lá não existe FileReader nem Image). O api.js é carregado só quando
// precisa, para este arquivo também rodar fora do navegador.
let leitorImagem = null;
export function usarLeitorImagem(f) { leitorImagem = f; }

async function imagem(caminho) {
  if (leitorImagem) return leitorImagem(caminho);
  const { api } = await import(new URL("./api.js", import.meta.url).href);
  const url = caminho.startsWith("app:") ? caminho.slice(4) : await api.urlArquivo(caminho);
  const blob = await (await fetch(url)).blob();
  const data = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(blob); });
  const dim = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = falha; i.src = data; });
  return { data, ...dim, fmt: /png/i.test(blob.type) || data.startsWith("data:image/png") ? "PNG" : "JPEG" };
}

function novoDoc() {
  const doc = new globalThis.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const d = { doc, y: M };
  d.cor = c => doc.setTextColor(c[0], c[1], c[2]);
  d.fonte = (estilo, tam) => { doc.setFont("helvetica", estilo); doc.setFontSize(tam); };
  d.espaco = alt => { if (d.y + alt > H - 16) { doc.addPage(); d.y = M; return true; } return false; };
  d.linhaH = (y, cor = LINHA, larg = 0.25) => { doc.setDrawColor(cor[0], cor[1], cor[2]); doc.setLineWidth(larg); doc.line(M, y, W - M, y); };
  return d;
}

async function cabecalho(d, cfg, titulo, linhas) {
  const { doc } = d; let xT = M;
  const logo = cfg.logo || "app:icons/logo-preto.png";
  if (logo) {
    try { const im = await imagem(logo); const r = Math.min(34 / im.w, 18 / im.h); const lw = im.w * r, lh = im.h * r;
      doc.addImage(im.data, im.fmt, M, d.y + (18 - lh) / 2, lw, lh, undefined, "FAST"); xT = M + lw + 5; } catch (e) {}
  }
  d.fonte("bold", 13); d.cor(TINTA); doc.text(cfg.nome || "Oficina", xT, d.y + 5);
  d.fonte("normal", 7.5); d.cor(CINZA);
  const larg = 116 - (xT - M);
  const end = doc.splitTextToSize(cfg.endereco || "", larg).slice(0, 2)
    .concat([[cfg.telefone && ("Tel.: " + cfg.telefone), cfg.cnpj && ("CNPJ: " + cfg.cnpj)].filter(Boolean).join("   ·   ")].filter(Boolean));
  doc.text(end, xT, d.y + 9.5);
  d.fonte("bold", 11); d.cor(AZUL); doc.text(titulo, W - M, d.y + 5, { align: "right" });
  linhas.forEach((l, i) => { d.fonte(i === 0 ? "bold" : "normal", i === 0 ? 9.5 : 8); d.cor(i === 0 ? TINTA : CINZA); doc.text(l, W - M, d.y + 10.5 + i * 4.3, { align: "right" }); });
  d.y += 22; d.linhaH(d.y, AZUL, 0.8); d.y += 5;
}

function caixasClienteVeiculo(d, o) {
  const { doc } = d, v = o.veiculo || {}, c = o.cliente || {};
  const caixa = (x, titulo, pares) => {
    d.fonte("normal", 8.5);
    const linhas = pares.map(([k, val]) => ({ k, t: doc.splitTextToSize(String(val || "—"), MEIA - 30) }));
    const alt = 9 + linhas.reduce((a, l) => a + l.t.length * 4.1, 0) + 1;
    return { alt, desenha: (y0, altF) => {
      doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.setLineWidth(0.3); doc.roundedRect(x, y0, MEIA, altF, 1.5, 1.5, "S");
      d.fonte("bold", 7.5); d.cor(CINZA); doc.text(titulo, x + 3.5, y0 + 5.2);
      let yy = y0 + 10;
      for (const l of linhas) { d.fonte("normal", 8); d.cor(CINZA); doc.text(l.k, x + 3.5, yy); d.fonte("bold", 8.5); d.cor(TINTA); doc.text(l.t, x + 26, yy); yy += l.t.length * 4.1; }
    } };
  };
  const a = caixa(M, "VEÍCULO", [["Placa", exPlaca(v.placa)], ["Marca/modelo", [v.marca, v.modelo].filter(Boolean).join(" ")], ["Ano / cor", [v.ano, v.cor].filter(Boolean).join(" · ")], ["Motor", v.motor]]);
  const b = caixa(M + MEIA + 4, "CLIENTE", [["Nome", c.nome], ["CPF/CNPJ", c.doc ? fmtDoc(c.doc) : "Não informado"], ["Telefone", fmtTel(c.telefone)], ["Endereço", c.endereco]]);
  const alt = Math.max(a.alt, b.alt); a.desenha(d.y, alt); b.desenha(d.y, alt); d.y += alt + 4;
}

function faixa(d, celulas) {
  const { doc } = d, lc = CW / celulas.length;
  doc.setFillColor(FUNDO[0], FUNDO[1], FUNDO[2]); doc.roundedRect(M, d.y, CW, 13, 1.5, 1.5, "F");
  celulas.forEach(([k, val], i) => { const x = M + i * lc + 3.5; d.fonte("bold", 6.8); d.cor(CINZA); doc.text(k, x, d.y + 4.8); d.fonte("bold", 9.2); d.cor(TINTA); doc.text(doc.splitTextToSize(String(val ?? "—"), lc - 5)[0] || "—", x, d.y + 10); });
  d.y += 17;
}

function bloco(d, titulo, texto, corT) {
  const { doc } = d; d.fonte("normal", 9);
  const t = doc.splitTextToSize(texto || "—", CW - 7), alt = 9 + t.length * 4.3;
  d.espaco(alt);
  doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.setLineWidth(0.3); doc.roundedRect(M, d.y, CW, alt, 1.5, 1.5, "S");
  d.fonte("bold", 7.5); d.cor(corT || CINZA); doc.text(titulo, M + 3.5, d.y + 5.2);
  d.fonte("normal", 9); d.cor(TINTA); doc.text(t, M + 3.5, d.y + 10);
  d.y += alt + 4;
}

function titulo(d, t) { d.espaco(12); d.fonte("bold", 8.5); d.cor(AZUL); d.doc.text(t, M, d.y + 3.5); d.y += 6; }

/** Tabela simples com quebra de página. colunas: [{t, w, a:'left'|'right'}] */
function tabela(d, colunas, linhas) {
  const { doc } = d;
  const cabec = () => {
    doc.setFillColor(FUNDO[0], FUNDO[1], FUNDO[2]); doc.rect(M, d.y, CW, 6.5, "F");
    let x = M; d.fonte("bold", 7.2); d.cor(CINZA);
    colunas.forEach(c => { doc.text(c.t, c.a === "right" ? x + c.w - 2 : x + 2, d.y + 4.4, { align: c.a === "right" ? "right" : "left" }); x += c.w; });
    d.y += 6.5;
  };
  d.espaco(14); cabec();
  for (const l of linhas) {
    d.fonte("normal", 8.4);
    const cel = l.celulas.map((v, i) => doc.splitTextToSize(String(v ?? ""), colunas[i].w - 4));
    const alt = Math.max(...cel.map(c => c.length)) * 3.9 + 2.8;
    if (d.espaco(alt)) cabec();
    let x = M;
    cel.forEach((c, i) => { d.fonte(i === l.negrito ? "bold" : "normal", 8.4); d.cor(l.cor && l.cor[i] ? l.cor[i] : TINTA);
      doc.text(c, colunas[i].a === "right" ? x + colunas[i].w - 2 : x + 2, d.y + 4.2, { align: colunas[i].a === "right" ? "right" : "left" }); x += colunas[i].w; });
    d.y += alt; d.linhaH(d.y);
  }
  d.y += 3;
}

function caixaTotais(d, t, comDesconto) {
  const { doc } = d;
  const linhas = [["Mão de obra", t.servicos], ["Peças", t.pecas]];
  if (t.terceiros) linhas.push(["Serviços de terceiros", t.terceiros]);
  if (comDesconto && t.desconto) linhas.push(["Desconto", -t.desconto]);
  const alt = linhas.length * 5 + 11; d.espaco(alt);
  const x = W - M - 80;
  doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.setLineWidth(0.3); doc.roundedRect(x, d.y, 80, alt, 1.5, 1.5, "S");
  let yy = d.y + 5.5;
  for (const [k, v] of linhas) { d.fonte("normal", 8.6); d.cor(CINZA); doc.text(k, x + 4, yy); d.cor(TINTA); doc.text(reais(v), x + 76, yy, { align: "right" }); yy += 5; }
  doc.setFillColor(AZUL[0], AZUL[1], AZUL[2]); doc.rect(x, yy - 2.5, 80, 8.5, "F");
  d.fonte("bold", 10.5); doc.setTextColor(255, 255, 255); doc.text("TOTAL", x + 4, yy + 3.2); doc.text(reais(t.total), x + 76, yy + 3.2, { align: "right" });
  d.y += alt + 4;
}

async function gradeFotos(d, fotos, rotuloSecao) {
  if (!fotos.length) return;
  const { doc } = d; d.espaco(60); titulo(d, rotuloSecao + " (" + fotos.length + ")");
  const cols = 3, gap = 4, cw = (CW - gap * (cols - 1)) / cols, ch = cw * 0.75;
  for (let i = 0; i < fotos.length; i += cols) {
    d.espaco(ch + 7);
    const linha = fotos.slice(i, i + cols);
    for (let j = 0; j < linha.length; j++) {
      const f = linha[j], x0 = M + j * (cw + gap);
      doc.setFillColor(FUNDO[0], FUNDO[1], FUNDO[2]); doc.rect(x0, d.y, cw, ch, "F");
      try { const im = await imagem(f.caminho); const r = Math.min(cw / im.w, ch / im.h); const iw = im.w * r, ih = im.h * r;
        doc.addImage(im.data, im.fmt, x0 + (cw - iw) / 2, d.y + (ch - ih) / 2, iw, ih, undefined, "FAST");
      } catch (e) { d.fonte("normal", 7.5); d.cor(CINZA); doc.text("Imagem indisponível", x0 + cw / 2, d.y + ch / 2, { align: "center" }); }
      d.fonte("bold", 7.5); d.cor(TINTA); doc.text(doc.splitTextToSize(f.rotulo || "Foto", cw)[0], x0, d.y + ch + 3.8);
    }
    d.y += ch + 7;
  }
  d.y += 2;
}

async function termoEAssinaturas(d, termo, esq, dir) {
  const { doc } = d; d.fonte("normal", 8);
  const t = doc.splitTextToSize(termo, CW - 7);
  d.espaco(t.length * 3.8 + 42);
  doc.setFillColor(FUNDO[0], FUNDO[1], FUNDO[2]); doc.roundedRect(M, d.y, CW, t.length * 3.8 + 6, 1.5, 1.5, "F");
  d.cor(TINTA); doc.text(t, M + 3.5, d.y + 5); d.y += t.length * 3.8 + 12;
  const yA = d.y + 20, la = (CW - 16) / 2;
  const ladoAss = async (lado, x) => {
    if (lado.imagem) { try { const im = await imagem(lado.imagem); const r = Math.min(la / im.w, 20 / im.h); doc.addImage(im.data, im.fmt, x + (la - im.w * r) / 2, yA - im.h * r - 0.5, im.w * r, im.h * r, undefined, "FAST"); } catch (e) {} }
    doc.setDrawColor(TINTA[0], TINTA[1], TINTA[2]); doc.setLineWidth(0.3); doc.line(x, yA, x + la, yA);
    d.fonte("bold", 8); d.cor(TINTA); doc.text(lado.rotulo, x + la / 2, yA + 4, { align: "center" });
    if (lado.nota) { d.fonte("normal", 6.8); d.cor(CINZA); doc.text(lado.nota, x + la / 2, yA + 8, { align: "center" }); }
  };
  await ladoAss(esq, M); await ladoAss(dir, M + la + 16);
  d.y = yA + 12;
}

function rodape(d, texto) {
  const { doc } = d, n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) { doc.setPage(i); d.fonte("normal", 7); d.cor(CINZA); doc.text(texto, M, H - 8); doc.text("Página " + i + " de " + n, W - M, H - 8, { align: "right" }); }
}

function linhasItens(itens, tipo, opts = {}) {
  return itens.filter(i => i.tipo === tipo).map(i => {
    const recusado = i.aprovado === false;
    const valor = recusado ? "não aprovado" : reais(totalItem(i));
    const desc = i.descricao + (i.adicional ? " (adicional)" : "") + (i.fornecedor && opts.fornecedor ? " · " + i.fornecedor : "");
    if (tipo === "servico") return { celulas: [desc, i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd), reais(i.valor_unit), valor], cor: recusado ? { 3: CINZA } : null };
    if (tipo === "peca") return { celulas: [i.codigo || "—", desc, i.fornecida_cliente ? "Do cliente" : (QUALIDADE[i.qualidade] || "—"), qtdFmt(i.qtd), i.fornecida_cliente ? "—" : reais(i.valor_unit), i.fornecida_cliente ? "—" : valor], cor: recusado ? { 5: CINZA } : null };
    return { celulas: [desc, qtdFmt(i.qtd), reais(i.valor_unit), valor], cor: recusado ? { 3: CINZA } : null };
  });
}
function tabelasItens(d, itens) {
  const s = linhasItens(itens, "servico"), p = linhasItens(itens, "peca"), t = linhasItens(itens, "terceiro", { fornecedor: true });
  if (s.length) { titulo(d, "MÃO DE OBRA"); tabela(d, [{ t: "Serviço", w: 112 }, { t: "Qtd / tempo", w: 24, a: "right" }, { t: "Unitário", w: 25, a: "right" }, { t: "Total", w: 25, a: "right" }], s); }
  if (p.length) { titulo(d, "PEÇAS E MATERIAIS"); tabela(d, [{ t: "Código", w: 24 }, { t: "Descrição", w: 62 }, { t: "Procedência", w: 34 }, { t: "Qtd", w: 14, a: "right" }, { t: "Unitário", w: 26, a: "right" }, { t: "Total", w: 26, a: "right" }], p); }
  if (t.length) { titulo(d, "SERVIÇOS DE TERCEIROS"); tabela(d, [{ t: "Descrição", w: 112 }, { t: "Qtd", w: 24, a: "right" }, { t: "Unitário", w: 25, a: "right" }, { t: "Total", w: 25, a: "right" }], t); }
}

/* ---------------- Checklist de entrada ---------------- */
export async function pdfEntrada(o, cfg) {
  const d = novoDoc(), { doc } = d, ck = o.checkin || {};
  await cabecalho(d, cfg, "CHECKLIST TÉCNICO DE ENTRADA", [numOS(o.numero), "Entrada: " + fmtDataHora(o.criado_em)]);
  caixasClienteVeiculo(d, o);
  faixa(d, [["DATA / HORA", fmtDataHora(o.criado_em)], ["KM DE ENTRADA", fmtKm(o.km_entrada)], ["COMBUSTÍVEL", o.combustivel], ["FUNCIONANDO", o.funcionando], ["CONSULTOR", o.consultor_nome]]);
  bloco(d, "MOTIVO DA VISITA / RECLAMAÇÃO DO CLIENTE", o.reclamacao);
  const secoes = secoesCheckin(ck.itensExtras), ach = achados(ck.resp, secoes).filter(a => a.s !== "info");
  if (ach.length) {
    d.fonte("normal", 8.5);
    const linhas = ach.map(a => doc.splitTextToSize(a.l + ": " + a.v + (a.obs ? " - " + a.obs : ""), CW - 12));
    const alt = 9 + linhas.reduce((s, l) => s + l.length * 4.1, 0) + 1; d.espaco(alt);
    doc.setDrawColor(COR.bad[0], COR.bad[1], COR.bad[2]); doc.setLineWidth(0.4); doc.roundedRect(M, d.y, CW, alt, 1.5, 1.5, "S");
    d.fonte("bold", 7.5); d.cor(COR.bad); doc.text("ITENS QUE NECESSITAM DE ATENÇÃO (" + ach.length + ")", M + 3.5, d.y + 5.2);
    let yy = d.y + 10;
    ach.forEach((a, i) => { const k = COR[a.s]; doc.setFillColor(k[0], k[1], k[2]); doc.circle(M + 5, yy - 1.1, 0.9, "F"); d.fonte("normal", 8.5); d.cor(TINTA); doc.text(linhas[i], M + 8, yy); yy += linhas[i].length * 4.1; });
    d.y += alt + 4;
  }
  for (const s of secoes) {
    const cel = s.itens.map(it => { const r = (ck.resp || {})[it.k] || {}; d.fonte("italic", 7); return { l: it.l, v: r.v || "Não avaliado", s: r.s || "na", obs: r.obs ? doc.splitTextToSize("Obs.: " + r.obs, MEIA - 6) : [] }; });
    const linhas = []; for (let i = 0; i < cel.length; i += 2) linhas.push(cel.slice(i, i + 2));
    const altL = l => 5.6 + Math.max(...l.map(x => x.obs.length * 3.3));
    d.espaco(8 + altL(linhas[0])); titulo(d, s.titulo.toUpperCase());
    for (const l of linhas) {
      const a = altL(l); d.espaco(a);
      l.forEach((x, j) => { const x0 = M + j * (MEIA + 4);
        doc.setDrawColor(LINHA[0], LINHA[1], LINHA[2]); doc.setLineWidth(0.2); doc.line(x0, d.y, x0 + MEIA, d.y);
        d.fonte("normal", 8.5); d.cor(TINTA); doc.text(doc.splitTextToSize(x.l, MEIA - 34)[0], x0 + 1, d.y + 4);
        d.fonte("bold", 8.5); d.cor(COR[x.s] || CINZA); doc.text(x.v, x0 + MEIA - 1, d.y + 4, { align: "right" });
        if (x.obs.length) { d.fonte("italic", 7); d.cor(CINZA); doc.text(x.obs, x0 + 1, d.y + 7.6); } });
      d.y += a;
    }
    d.y += 3;
  }
  bloco(d, "OBJETOS DE VALOR DECLARADOS NO VEÍCULO", ck.objetosValor || "Nenhum declarado");
  if (ck.observacoes) bloco(d, "OBSERVAÇÕES", ck.observacoes);
  await gradeFotos(d, (o.fotos || []).filter(f => f.etapa === "entrada"), "REGISTRO FOTOGRÁFICO");
  await termoEAssinaturas(d, ck.termo || termoEntradaFinal(cfg),
    { rotulo: "Cliente: " + (o.assinante_entrada || (o.cliente || {}).nome || ""), imagem: o.assinatura_entrada, nota: o.assinatura_entrada ? "Assinado na tela em " + fmtDataHora(o.criado_em) : "" },
    { rotulo: "Consultor: " + (o.consultor_nome || "") });
  rodape(d, numOS(o.numero) + "  ·  Checklist de entrada  ·  " + exPlaca((o.veiculo || {}).placa) + "  ·  " + (cfg.nome || ""));
  return doc.output("blob");
}

/* ---------------- Orçamento ---------------- */
export async function pdfOrcamento(o, cfg) {
  const d = novoDoc(), { doc } = d;
  const emissao = o.orcamento_enviado_em || new Date().toISOString();
  const validade = o.validade_orcamento || somaDias(emissao, Number(cfg.validadeDias) || 10);
  await cabecalho(d, cfg, "ORÇAMENTO", [numOS(o.numero), "Emissão: " + fmtData(emissao), "Válido até: " + fmtData(validade)]);
  caixasClienteVeiculo(d, o);
  faixa(d, [["ENTRADA", fmtData(o.criado_em)], ["KM", fmtKm(o.km_entrada)], ["PREVISÃO DE ENTREGA", o.previsao_entrega ? fmtData(o.previsao_entrega) : "A combinar"], ["VALIDADE", fmtData(validade)], ["CONSULTOR", o.consultor_nome]]);
  bloco(d, "RECLAMAÇÃO DO CLIENTE", o.reclamacao);
  bloco(d, "DIAGNÓSTICO TÉCNICO", o.diagnostico || "—", AZUL);
  const itens = o.itens || [];
  tabelasItens(d, itens);
  const aprovado = !!o.aprovacao;
  caixaTotais(d, totais(itens, o.desconto, aprovado), true);
  bloco(d, "CONDIÇÕES DE PAGAMENTO", o.condicoes_pagamento || cfg.condicoesPadrao || "A combinar");
  const ap = o.aprovacao;
  await termoEAssinaturas(d, (cfg.termoOrcamento || TERMO_ORCAMENTO),
    { rotulo: ap ? "Aprovado por: " + ap.por : "Aprovação do cliente", imagem: ap && ap.assinatura, nota: ap ? fmtDataHora(ap.em) + " · " + ap.forma : "Data: ____/____/______" },
    { rotulo: "Consultor: " + (o.consultor_nome || "") });
  rodape(d, numOS(o.numero) + "  ·  Orçamento  ·  " + exPlaca((o.veiculo || {}).placa) + "  ·  " + (cfg.nome || ""));
  return doc.output("blob");
}

/* ---------------- Ordem de serviço: o MESMO leiaute da impressão do sistema (ViaOS em js/telas/imprimir.js) ----------------
   Mudou a impressão da O.S.? Mude aqui também (o e-mail e o botão PDF usam esta função). */
const AZUL_ESC = [10, 47, 128], BORDA = [197, 204, 214], GRADE = [215, 220, 227], CAB_TAB = [238, 241, 245], FUNDO_TOT = [246, 247, 249], TEXTO2 = [51, 59, 71], ROT = [91, 101, 115];

/** Linhas corridas "Rótulo valor" que quebram entre campos; desenha (ou só mede, com desenhar=false). Devolve a altura. */
function linhasCorridas(d, x, y, larg, linhas, desenhar) {
  const { doc } = d, LH = 4.2, GAP = 3.5; let cy = y;
  for (const partes of linhas) {
    const ps = partes.filter(p => p && p.v !== null && p.v !== undefined && String(p.v).trim() !== "" && p.v !== "—");
    if (!ps.length) continue;
    let cx = x;
    for (const p of ps) {
      const tamV = p.tam || 8.6;
      d.fonte("bold", 7.2); const wr = p.r ? doc.getTextWidth(p.r + " ") : 0;
      d.fonte(p.b === false ? "normal" : "bold", tamV);
      let partesV = [String(p.v)], wv = doc.getTextWidth(partesV[0]);
      if (cx > x && cx + wr + wv > x + larg) { cx = x; cy += LH; }
      if (cx + wr + wv > x + larg) partesV = doc.splitTextToSize(String(p.v), x + larg - cx - wr);
      if (desenhar) {
        if (p.r) { d.fonte("bold", 7.2); d.cor(ROT); doc.text(p.r, cx, cy); }
        d.fonte(p.b === false ? "normal" : "bold", tamV); d.cor(p.cor || TINTA);
        partesV.forEach((t, i) => doc.text(t, cx + wr, cy + i * LH));
      }
      d.fonte(p.b === false ? "normal" : "bold", tamV);
      cy += (partesV.length - 1) * LH;
      cx += wr + doc.getTextWidth(partesV[partesV.length - 1]) + GAP;
    }
    cy += LH;
  }
  return cy - y;
}

function tabelaOS(d, tituloTab, itens, total) {
  if (!itens.length) return;
  const { doc } = d;
  const comRef = itens.some(i => i.codigo), comDesc = itens.some(i => Number(i.desconto) > 0);
  const cols = [{ t: tituloTab }];
  if (comRef) cols.push({ t: "REF.", w: 26 });
  cols.push({ t: "QTD.", w: 15, a: "right" }, { t: "UNIT.", w: 26, a: "right" });
  if (comDesc) cols.push({ t: "DESC.", w: 22, a: "right" });
  cols.push({ t: "TOTAL", w: 27, a: "right" });
  cols[0].w = CW - cols.slice(1).reduce((s, c) => s + c.w, 0);
  const borda = (cor, larg) => { doc.setDrawColor(cor[0], cor[1], cor[2]); doc.setLineWidth(larg); };
  const linhaCel = (y0, alt, textos, opts = {}) => {
    if (opts.fundo) { doc.setFillColor(opts.fundo[0], opts.fundo[1], opts.fundo[2]); doc.rect(M, y0, CW, alt, "F"); }
    borda(opts.borda || GRADE, 0.2); doc.rect(M, y0, CW, alt, "S");
    let x = M;
    cols.forEach((c, i) => {
      if (i > 0 && !opts.semColunas) doc.line(x, y0, x, y0 + alt);
      const t = textos[i]; if (t !== undefined && t !== null) {
        d.fonte(opts.estilo || "normal", opts.tam || 8.6); d.cor(opts.cor || TINTA);
        doc.text(t, c.a === "right" ? x + c.w - 1.8 : x + 1.8, y0 + (opts.base || 4.3), { align: c.a === "right" ? "right" : "left" });
      }
      x += c.w;
    });
  };
  const cabec = () => { linhaCel(d.y, 6.3, cols.map(c => c.t), { fundo: CAB_TAB, borda: BORDA, estilo: "bold", tam: 7.2, cor: TINTA, base: 4.2 }); d.y += 6.3; };
  d.espaco(20); cabec();
  for (const i of itens) {
    d.fonte("normal", 8.6);
    const desc = i.descricao + (i.fornecida_cliente ? " (peça do cliente)" : i.qualidade === "usada" ? " (usada, autorizada)" : "");
    const linhasDesc = doc.splitTextToSize(desc, cols[0].w - 3.6);
    const ref = comRef ? doc.splitTextToSize(i.codigo || "", 26 - 3.6) : [];
    const alt = Math.max(linhasDesc.length, ref.length || 1) * 3.8 + 2.6;
    if (d.espaco(alt)) cabec();
    const t = [linhasDesc];
    if (comRef) t.push(ref);
    t.push(i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd), i.fornecida_cliente ? "—" : reais(i.valor_unit));
    if (comDesc) t.push(Number(i.desconto) ? reais(i.desconto) : "");
    t.push(i.fornecida_cliente ? "—" : reais(totalItem(i)));
    linhaCel(d.y, alt, t, { base: 4.1 }); d.y += alt;
  }
  d.espaco(6.3);
  const xUlt = W - M - cols[cols.length - 1].w;
  doc.setFillColor(FUNDO_TOT[0], FUNDO_TOT[1], FUNDO_TOT[2]); doc.rect(M, d.y, CW, 6.3, "F");
  borda(GRADE, 0.2); doc.rect(M, d.y, CW, 6.3, "S"); doc.line(xUlt, d.y, xUlt, d.y + 6.3);
  d.fonte("bold", 8.6); d.cor(TINTA);
  doc.text(total[0], xUlt - 1.8, d.y + 4.3, { align: "right" }); doc.text(reais(total[1]), W - M - 1.8, d.y + 4.3, { align: "right" });
  d.y += 6.3 + 3;
}

export async function pdfOS(o, cfg, ext = {}) {
  const d = novoDoc(), { doc } = d;
  const cli = ext.cli || null, vei = ext.vei || null;
  const c = o.cliente || {}, v = o.veiculo || {}, itensTodos = o.itens || [];
  const aprov = ["execucao", "pronto", "entregue", "recusado"].includes(o.status) && itensTodos.some(i => i.aprovado === true);
  const orc = !aprov;
  const lista = itensTodos.filter(i => aprov ? i.aprovado === true : i.aprovado !== false);
  const t = totais(itensTodos, o.desconto, aprov);
  const dias = Number(o.garantia_dias) || Number(cfg.garantiaDias) || 90;
  const termo = orc ? (cfg.termoOrcamento || TERMO_ORCAMENTO)
    : (cfg.termoGarantia || TERMO_GARANTIA).replace(/\{dias\}/g, String(dias)) + (o.status === "entregue" ? " Garantia válida até " + fmtData(somaDias(o.entregue_em, dias)) + "." : "");

  // ---- cabeçalho: logo · empresa · título, número e data
  let xT = M;
  try { const im = await imagem(cfg.logo || "app:icons/logo-preto.png"); const r = Math.min(36 / im.w, 13 / im.h); const lw = im.w * r, lh = im.h * r;
    doc.addImage(im.data, im.fmt, M, d.y + (15 - lh) / 2, lw, lh, undefined, "FAST"); xT = M + lw + 4; } catch (e) {}
  d.fonte("bold", 12.5); d.cor(TINTA); doc.text(cfg.nome || "Oficina", xT, d.y + 4.5);
  d.fonte("normal", 7.8); d.cor(TEXTO2);
  const lEmp = [cfg.endereco, [cfg.telefone ? "Tel. " + cfg.telefone : "", cfg.cnpj ? "CNPJ " + cfg.cnpj : ""].filter(Boolean).join(" · ")].filter(Boolean);
  doc.text(lEmp.flatMap(l => doc.splitTextToSize(l, 125 - (xT - M))).slice(0, 3), xT, d.y + 8.8);
  d.fonte("bold", 11.5); d.cor(TINTA); doc.text(orc ? "ORÇAMENTO" : "ORDEM DE SERVIÇO", W - M, d.y + 4.2, { align: "right" });
  d.fonte("bold", 16); doc.text("Nº " + String(o.numero ?? "").padStart(5, "0"), W - M, d.y + 10.6, { align: "right" });
  d.fonte("normal", 8); doc.text(fmtDataHora(o.criado_em), W - M, d.y + 14.6, { align: "right" });
  d.y += 17.5; d.linhaH(d.y, TINTA, 0.6); d.y += 3;

  // ---- cliente e veículo, compactos (linhas corridas)
  const tels = [c.telefone, cli && cli.telefone2].filter(Boolean).map(fmtTel).join(" / ");
  const endereco = cli ? endCompleto(cli) : c.endereco;
  const ladoC = [[{ v: c.nome, tam: 9.2 }, { v: cli && cli.codigo ? "(cód. " + cli.codigo + ")" : "", b: false, cor: ROT, tam: 8 }],
    [{ r: "CPF/CNPJ", v: fmtDoc(c.doc || (cli && cli.doc) || "") }, { r: "Tel.", v: tels }, { r: "Contato", v: o.contato }],
    [{ r: "End.", v: endereco, b: false }]];
  const ladoV = [[{ v: exPlaca(v.placa), tam: 9.2 }, { v: [v.marca, v.modelo].filter(Boolean).join(" ") }],
    [{ r: "Ano", v: v.ano }, { r: "Cor", v: v.cor }, { r: "KM", v: o.km_entrada != null ? fmtKm(o.km_entrada) : "" },
     { r: "Comb.", v: (vei && vei.combustivel) || v.motor }, { r: "Box", v: o.box }, { r: "Chassi", v: vei && vei.chassi }]];
  const larg = MEIA - 6, y0 = d.y;
  const alt = Math.max(linhasCorridas(d, M + 3, 0, larg, ladoC, false), linhasCorridas(d, M + MEIA + 7, 0, larg, ladoV, false)) + 7.6;
  [[M, "CLIENTE", ladoC], [M + MEIA + 4, "VEÍCULO", ladoV]].forEach(([x, tit, ls]) => {
    doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.25); doc.roundedRect(x, y0, MEIA, alt, 1, 1, "S");
    d.fonte("bold", 7.2); d.cor(AZUL_ESC); doc.text(tit, x + 3, y0 + 3.9);
    linhasCorridas(d, x + 3, y0 + 7.8, larg, ls, true);
  });
  d.y = y0 + alt + 3;

  // ---- reclamação e diagnóstico (só se houver)
  const textos = [["Reclamação:", o.reclamacao], ["Diagnóstico:", o.diagnostico]].filter(([, x]) => x && String(x).trim());
  const blocoTexto = (pares) => {
    d.fonte("normal", 8.6);
    const ls = pares.map(([r, x]) => { d.fonte("bold", 8.6); const wr = doc.getTextWidth(r + " "); d.fonte("normal", 8.6); return { r, wr, t: doc.splitTextToSize(String(x), CW - 6 - wr) }; });
    const a = ls.reduce((s, l) => s + l.t.length * 3.9, 0) + 3.4; d.espaco(a);
    doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.25); doc.roundedRect(M, d.y, CW, a, 1, 1, "S");
    let yy = d.y + 4.4;
    for (const l of ls) { d.fonte("bold", 8.6); d.cor(TINTA); doc.text(l.r, M + 3, yy); d.fonte("normal", 8.6); doc.text(l.t, M + 3 + l.wr, yy); yy += l.t.length * 3.9; }
    d.y += a + 3;
  };
  if (textos.length) blocoTexto(textos);

  // ---- itens: produtos, serviços e terceiros, cada tabela com o seu total
  tabelaOS(d, "PRODUTOS E PEÇAS", lista.filter(i => i.tipo === "peca"), ["Total de produtos", t.pecas]);
  tabelaOS(d, "SERVIÇOS", lista.filter(i => i.tipo === "servico"), ["Total de serviços", t.servicos]);
  tabelaOS(d, "SERVIÇOS DE TERCEIROS", lista.filter(i => i.tipo === "terceiro"), ["Total de serviços de terceiros", t.terceiros]);
  if (o.obs_execucao) blocoTexto([["Observações:", o.obs_execucao]]);

  // ---- resumo: dados à esquerda, totais à direita
  const quando = o.status === "entregue" ? ["Entregue em", fmtDataHora(o.entregue_em)] : o.previsao_entrega ? ["Previsão", fmtData(o.previsao_entrega) + (o.previsao_hora ? " " + o.previsao_hora : "")] : null;
  const pares = [["Responsável", o.mecanico_nome], ["Consultor", o.consultor_nome],
    ["Situação", ((situacaoOS(o) || STATUS[o.status] || {}).t || "") + (o.situacao ? " · " + o.situacao : "")], quando,
    ["Pagamento", o.forma_pagamento], ["Condições", o.condicoes_pagamento],
    orc && o.validade_orcamento ? ["Válido até", fmtData(o.validade_orcamento)] : null,
    o.tabela_preco && o.tabela_preco !== "vista" ? ["Tabela", TABELAS_PRECO[o.tabela_preco]] : null]
    .filter(p => p && p[1] !== null && p[1] !== undefined && String(p[1]).trim() !== "" && p[1] !== "—");
  const linhasTot = [["Produtos", t.pecas], ["Serviços", t.servicos], ["Serviços de terceiros", t.terceiros], ["Desconto", -t.desconto]].filter(([, x]) => Number(x));
  const largEsq = 108, colE = (largEsq - 4) / 2, xTot = M + largEsq + 8, largTot = W - M - xTot;
  d.fonte("bold", 8.6);
  const celulas = pares.map(([r, x]) => ({ r, t: doc.splitTextToSize(String(x), colE - 1) }));
  const altLinha = []; for (let i = 0; i < celulas.length; i += 2) altLinha.push(3.4 + Math.max(...celulas.slice(i, i + 2).map(cc => cc.t.length)) * 3.8 + 1);
  const altEsq = altLinha.reduce((s, a) => s + a, 0);
  const altDir = (linhasTot.length > 1 ? linhasTot.length * 4.6 : 0) + 8;
  d.espaco(Math.max(altEsq, altDir) + 4);
  d.linhaH(d.y, BORDA, 0.25); d.y += 2.5;
  let yy = d.y;
  for (let i = 0; i < celulas.length; i += 2) {
    celulas.slice(i, i + 2).forEach((cc, j) => { const x = M + j * (colE + 4);
      d.fonte("normal", 6.8); d.cor(ROT); doc.text(cc.r, x, yy + 2.4); d.fonte("bold", 8.6); d.cor(TINTA); doc.text(cc.t, x, yy + 6); });
    yy += altLinha[i / 2];
  }
  let yt = d.y + 3.4;
  if (linhasTot.length > 1) for (const [r, x] of linhasTot) { d.fonte("normal", 9); d.cor(TINTA); doc.text(r, xTot, yt); d.fonte("bold", 9); doc.text(x < 0 ? "− " + reais(-x) : reais(x), W - M, yt, { align: "right" }); yt += 4.6; }
  doc.setDrawColor(TINTA[0], TINTA[1], TINTA[2]); doc.setLineWidth(0.6); doc.line(xTot, yt - 2.2, W - M, yt - 2.2);
  d.fonte("bold", 11.5); d.cor(TINTA); doc.text("Total", xTot, yt + 3.2); doc.text(reais(t.total), W - M, yt + 3.2, { align: "right" });
  d.y += Math.max(altEsq, altDir) + 1.5;

  // ---- termo
  d.fonte("normal", 7.2); const tl = doc.splitTextToSize(termo, CW);
  d.espaco(tl.length * 3.1 + 2); d.cor(TEXTO2); doc.text(tl, M, d.y + 2.6, { maxWidth: CW, align: "justify" }); d.y += tl.length * 3.1 + 2;

  // ---- assinaturas (e autorização), como na impressão
  const nota = !orc && o.aprovacao ? "Autorizado por " + o.aprovacao.por + " em " + fmtDataHora(o.aprovacao.em) + " (" + o.aprovacao.forma + "). Na retirada, o cliente declara receber o veículo com os serviços executados e testados." : "";
  d.fonte("normal", 7.8); const nl = nota ? doc.splitTextToSize(nota, CW) : [];
  d.espaco(30 + nl.length * 3.4);
  const la = (CW - 16) / 2, yA = d.y + 15;
  const assina = async (x, rotulo, img) => {
    if (img) { try { const im = await imagem(img); const r = Math.min(la / im.w, 13 / im.h); doc.addImage(im.data, im.fmt, x + (la - im.w * r) / 2, yA - im.h * r - 0.5, im.w * r, im.h * r, undefined, "FAST"); } catch (e) {} }
    doc.setDrawColor(TINTA[0], TINTA[1], TINTA[2]); doc.setLineWidth(0.25); doc.line(x, yA, x + la, yA);
    d.fonte("normal", 7.8); d.cor(TINTA); doc.text(doc.splitTextToSize(rotulo, la)[0], x + la / 2, yA + 3.6, { align: "center" });
  };
  if (orc) {
    d.fonte("normal", 8.6); d.cor(TINTA); doc.text("Autorizo a execução nas condições acima.", M, yA - 9);
    d.fonte("bold", 8.6); doc.text("(   ) Aprovado    (   ) Reprovado    Data: ____/____/______", M, yA - 4);
    await assina(M + la + 16, "Cliente: " + (c.nome || ""));
  } else {
    await assina(M, "Cliente: " + (c.nome || ""), o.assinatura_entrega);
    await assina(M + la + 16, "Oficina");
  }
  d.y = yA + 6;
  if (nl.length) { d.fonte("normal", 7.8); d.cor(TEXTO2); doc.text(nl, M, d.y + 1.5); d.y += nl.length * 3.4 + 1; }
  d.linhaH(d.y + 0.5, BORDA, 0.25);
  d.fonte("bold", 7.2); d.cor(ROT); doc.text("NÃO VALE COMO RECIBO DE PAGAMENTO", W / 2, d.y + 4, { align: "center" }); d.y += 7;

  // ---- fotos do serviço (o PDF leva; a impressão não)
  await gradeFotos(d, (o.fotos || []).filter(f => f.etapa !== "entrada"), "FOTOS DO SERVIÇO");
  const n = doc.getNumberOfPages();
  if (n > 1) rodape(d, numOS(o.numero) + "  ·  " + (orc ? "Orçamento" : "Ordem de serviço") + "  ·  " + exPlaca(v.placa) + "  ·  " + (cfg.nome || ""));
  return doc.output("blob");
}

/** Compartilha (celular: WhatsApp, e-mail...) ou baixa o arquivo */
export async function entregarArquivo(blob, nome) {
  const arq = new File([blob], nome, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [arq] })) {
    try { await navigator.share({ files: [arq], title: nome }); return "compartilhado"; }
    catch (e) { if (e && e.name === "AbortError") return "cancelado"; }
  }
  const url = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = url; a.download = nome; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return "baixado";
}
