// PDF do Resumo de O.S. em aberto (pedido do Danilo em 13/11/2026): o MESMO leiaute da tela de impressão (ResumoOS em
// js/telas/imprimir.js), no padrão do PDF da O.S. (js/pdf.js: cabeçalho, quadros de cliente e veículo, tabelas de itens).
// Mudou um, mude o outro. Contas e textos em js/resumoos.js. Usado pela função "email" (anexo do WhatsApp e do e-mail):
// sem window/document no carregamento. Arquivo separado do js/pdf.js de propósito: a O.S. normal não muda.
import { reais, qtdFmt, totalItem } from "./util.js";
import { rotuloNoResumo, fechoDaOS } from "./resumoos.js";

const TINTA = [20, 26, 36], CINZA = [96, 106, 122], AZUL_ESC = [10, 47, 128], BORDA = [197, 204, 214], GRADE = [215, 220, 227], CAB_TAB = [238, 241, 245];
const FUNDO_TOT = [246, 247, 249], TEXTO2 = [51, 59, 71], ROT = [91, 101, 115], BRANCO = [255, 255, 255];
const W = 210, H = 297, M = 12, CW = W - 2 * M, MEIA = (CW - 4) / 2;
const ROW = 5, HC = 5.2, TI = 8.4, LL = 3.6;   // linha de item, cabeçalho/total de tabela, corpo do item e entrelinha

// Leitor de imagem trocável (logo): o navegador lê do site; a função "email" troca por um que lê direto (igual ao js/pdf.js).
let leitorImagem = null;
export function usarLeitorImagem(f) { leitorImagem = f; }
async function imagem(caminho) {
  if (leitorImagem) return leitorImagem(caminho);
  const url = caminho.startsWith("app:") ? caminho.slice(4) : caminho;
  const blob = await (await fetch(url)).blob();
  const data = await new Promise((ok, falha) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = falha; r.readAsDataURL(blob); });
  const dim = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok({ w: i.naturalWidth, h: i.naturalHeight }); i.onerror = falha; i.src = data; });
  return { data, ...dim, fmt: /png/i.test(blob.type) ? "PNG" : "JPEG" };
}

/** Desenha o resumo inteiro num documento novo. lim = até onde o conteúdo pode ir na folha (mm). */
function desenhar(d, cfg, logo, detalhe, lim) {
  const doc = new globalThis.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const g = { y: M };
  const cor = c => doc.setTextColor(c[0], c[1], c[2]);
  const fonte = (estilo, tam) => { doc.setFont("helvetica", estilo); doc.setFontSize(tam); };
  const traco = (c, l) => { doc.setDrawColor(c[0], c[1], c[2]); doc.setLineWidth(l); };
  const fundo = c => doc.setFillColor(c[0], c[1], c[2]);
  const espaco = alt => { if (g.y + alt > lim) { doc.addPage(); g.y = M; return true; } return false; };
  const quebra = (t, larg) => doc.splitTextToSize(String(t ?? ""), larg);

  // ---- cabeçalho: logo · empresa · título, números e data (como no PDF da O.S.)
  let xT = M;
  if (logo) { const r = Math.min(36 / logo.w, 13 / logo.h), lw = logo.w * r, lh = logo.h * r;
    try { doc.addImage(logo.data, logo.fmt, M, g.y + (15 - lh) / 2, lw, lh, undefined, "FAST"); xT = M + lw + 4; } catch (e) {} }
  fonte("bold", 12.5); cor(TINTA); doc.text(String(cfg.nome || "Oficina"), xT, g.y + 4.5);
  fonte("normal", 7.8); cor(TEXTO2);
  const lEmp = [cfg.endereco, [cfg.telefone ? "Tel. " + cfg.telefone : "", cfg.cnpj ? "CNPJ " + cfg.cnpj : ""].filter(Boolean).join(" · ")].filter(Boolean);
  doc.text(lEmp.flatMap(l => quebra(l, 125 - (xT - M))).slice(0, 3), xT, g.y + 8.8);
  fonte("bold", 11.5); cor(TINTA); doc.text("RESUMO DE ORDENS DE SERVIÇO", W - M, g.y + 4.2, { align: "right" });
  fonte("bold", 16); doc.text(d.numeroCab ? "Nº " + d.numeroCab : d.tituloQtd, W - M, g.y + 10.6, { align: "right" });
  fonte("normal", 8); doc.text("Emitido em " + d.emitidoEm, W - M, g.y + 14.6, { align: "right" });
  g.y += 17.5; traco(TINTA, 0.6); doc.line(M, g.y, W - M, g.y); g.y += 3;

  // ---- cliente e veículo(s), compactos (linhas corridas: "Rótulo valor" que quebram entre campos)
  const corridas = (x, y, larg, linhas, pintar) => {
    const LH = 4.2, GAP = 3.5; let cy = y;
    for (const partes of linhas) {
      const ps = partes.filter(p => p && p.v !== null && p.v !== undefined && String(p.v).trim() !== "");
      if (!ps.length) continue;
      let cx = x;
      for (const p of ps) {
        const tam = p.tam || 8.6, est = p.b === false ? "normal" : "bold";
        fonte("bold", 7.2); const wr = p.r ? doc.getTextWidth(p.r + " ") : 0;
        fonte(est, tam);
        let partesV = [String(p.v)]; const wv = doc.getTextWidth(partesV[0]);
        if (cx > x && cx + wr + wv > x + larg) { cx = x; cy += LH; }
        if (cx + wr + wv > x + larg) partesV = quebra(p.v, x + larg - cx - wr);
        if (pintar) {
          if (p.r) { fonte("bold", 7.2); cor(ROT); doc.text(p.r, cx, cy); }
          fonte(est, tam); cor(p.cor || TINTA); partesV.forEach((t, i) => doc.text(t, cx + wr, cy + i * LH));
        }
        fonte(est, tam);
        cy += (partesV.length - 1) * LH;
        cx += wr + doc.getTextWidth(partesV[partesV.length - 1]) + GAP;
      }
      cy += LH;
    }
    return cy - y;
  };
  const c = d.cli, v = d.vei;
  const ladoC = c ? [[{ v: c.nome, tam: 9.2 }, { v: c.codigo != null ? "(cód. " + c.codigo + ")" : "", b: false, cor: ROT, tam: 8 }],
    [{ r: "CPF/CNPJ", v: c.doc }, { r: "Tel.", v: c.telefone }], [{ r: "End.", v: c.endereco, b: false }]] : [[{ v: "Clientes diferentes nas O.S.", b: false }]];
  const ladoV = v ? [[{ v: v.placa, tam: 9.2 }, { v: v.modelo }], [{ r: "Ano", v: v.ano }, { r: "Cor", v: v.cor }]]
    : [d.veiculos.flatMap(x => [{ v: x.placa }, { v: x.modelo, b: false }])];
  const largB = MEIA - 6, y0 = g.y;
  const altB = Math.max(corridas(M + 3, 0, largB, ladoC, false), corridas(M + MEIA + 7, 0, largB, ladoV, false)) + 7.6;
  [[M, "CLIENTE", ladoC], [M + MEIA + 4, v ? "VEÍCULO" : "VEÍCULOS", ladoV]].forEach(([x, tit, ls]) => {
    traco(BORDA, 0.25); doc.roundedRect(x, y0, MEIA, altB, 1, 1, "S");
    fonte("bold", 7.2); cor(AZUL_ESC); doc.text(tit, x + 3, y0 + 3.9);
    corridas(x + 3, y0 + 7.8, largB, ls, true);
  });
  g.y = y0 + altB + 2.5;

  // ---- peças de tabela
  const linhaCel = (cols, yL, alt, textos, o = {}) => {
    if (o.fundo) { fundo(o.fundo); doc.rect(M, yL, CW, alt, "F"); }
    traco(o.borda || GRADE, 0.2); doc.rect(M, yL, CW, alt, "S");
    let x = M;
    cols.forEach((col, i) => {
      if (i > 0) doc.line(x, yL, x, yL + alt);
      const t = textos[i];
      if (t !== undefined && t !== null) { fonte(o.estilo || "normal", o.tam || TI); cor(o.cor || TINTA);
        doc.text(t, col.a === "right" ? x + col.w - 1.8 : x + 1.8, yL + (o.base || 3.6), { align: col.a === "right" ? "right" : "left", lineHeightFactor: LL / ((o.tam || TI) * 0.3528) }); }
      x += col.w;
    });
  };
  const colunasItens = itens => {
    const comRef = itens.some(i => i.codigo), comDesc = itens.some(i => Number(i.desconto) > 0);
    const cols = [{ t: "" }].concat(comRef ? [{ t: "REF.", w: 26 }] : [], [{ t: "QTD.", w: 15, a: "right" }, { t: "UNIT.", w: 26, a: "right" }],
      comDesc ? [{ t: "DESC.", w: 22, a: "right" }] : [], [{ t: "TOTAL", w: 27, a: "right" }]);
    cols[0].w = CW - cols.slice(1).reduce((s, x) => s + x.w, 0);
    return { cols, comRef, comDesc };
  };
  const linhasDoItem = (i, cols, comRef) => {
    fonte("normal", TI);
    const desc = quebra(i.descricao + (i.fornecida_cliente ? " (peça do cliente)" : i.qualidade === "usada" ? " (usada, autorizada)" : ""), cols[0].w - 3.6);
    const ref = comRef ? quebra(i.codigo || "", 26 - 3.6) : [];
    return { desc, ref, alt: Math.max(desc.length, ref.length || 1) * LL + (ROW - LL) };
  };
  const altTabela = itens => { if (!itens.length) return 0; const { cols, comRef } = colunasItens(itens);
    return HC + itens.reduce((s, i) => s + linhasDoItem(i, cols, comRef).alt, 0) + HC + 1.8; };
  const tabela = (titulo, itens, rotTotal, total) => {
    if (!itens.length) return;
    const { cols, comRef, comDesc } = colunasItens(itens); cols[0].t = titulo;
    const cab = () => { linhaCel(cols, g.y, HC, cols.map(x => x.t), { fundo: CAB_TAB, borda: BORDA, estilo: "bold", tam: 7.2, base: 3.6 }); g.y += HC; };
    espaco(HC + ROW + HC); cab();
    for (const i of itens) {
      const l = linhasDoItem(i, cols, comRef);
      if (espaco(l.alt)) cab();
      const t = [l.desc].concat(comRef ? [l.ref] : [], [i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd), i.fornecida_cliente ? "—" : reais(i.valor_unit)],
        comDesc ? [Number(i.desconto) ? reais(i.desconto) : ""] : [], [i.fornecida_cliente ? "—" : reais(totalItem(i))]);
      linhaCel(cols, g.y, l.alt, t); g.y += l.alt;
    }
    espaco(HC);
    const xUlt = W - M - cols[cols.length - 1].w;
    fundo(FUNDO_TOT); doc.rect(M, g.y, CW, HC, "F"); traco(GRADE, 0.2); doc.rect(M, g.y, CW, HC, "S"); doc.line(xUlt, g.y, xUlt, g.y + HC);
    fonte("bold", TI); cor(TINTA); doc.text(rotTotal, xUlt - 1.8, g.y + 3.65, { align: "right" }); doc.text(reais(total), W - M - 1.8, g.y + 3.65, { align: "right" });
    g.y += HC + 1.8;
  };

  // ---- cada O.S.: faixa com o número (e o veículo, a reclamação curta, a abertura e a etapa), itens e fecho
  const medeFaixa = b => {
    fonte("bold", 9.5); const tit = "ORDEM DE SERVIÇO Nº " + b.n5, wT = doc.getTextWidth(tit);
    fonte("normal", 9); let extra = (b.faixaVeiculo ? "  ·  " + b.faixaVeiculo : "") + (b.recNaFaixa ? "  ·  " + b.reclamacao : "");
    if (extra && wT + doc.getTextWidth(extra) > CW - 6) extra = quebra(extra, CW - 6 - wT)[0];
    const wE = extra ? doc.getTextWidth(extra) : 0;
    fonte("normal", 7.8); const dir = (b.aberta ? "Aberta em " + b.aberta + "   ·   " : "") + b.situacao, wD = doc.getTextWidth(dir);
    const duas = wT + wE + 6 + wD > CW - 6;   // sem espaço na linha: a abertura e a etapa descem, como na tela
    return { tit, wT, extra, dir, duas, alt: duas ? 10.4 : 6.5 };
  };
  const medeRec = b => { if (!b.reclamacao || b.recNaFaixa) return null;
    fonte("bold", 8.2); const wr = doc.getTextWidth("Reclamação: "); fonte("normal", 8.2); const ls = quebra(b.reclamacao, CW - wr - 1);
    return { wr, ls, alt: ls.length * LL + 1.4 }; };
  const altFecho = b => fechoDaOS(b).reduce((s, l) => s + (l.forte ? 6.2 : 4.8), 0);
  const semItens = b => !b.pecas.length && !b.servicos.length && !b.terceiros.length;
  const altBloco = b => { const r = medeRec(b); return medeFaixa(b).alt + 1.5 + (r ? r.alt : 0) + altTabela(b.pecas) + altTabela(b.servicos) + altTabela(b.terceiros) + (semItens(b) ? 5 : 0) - 1.8 + altFecho(b) + 3.5; };
  const blocoOS = b => {
    const alt = altBloco(b);
    if (g.y + alt > lim && alt <= lim - M && g.y > M) { doc.addPage(); g.y = M; }   // O.S. que cabe numa folha não fica cortada
    const f = medeFaixa(b); espaco(f.alt + 1.5 + HC + ROW);
    fundo(TINTA); doc.rect(M, g.y, CW, f.alt, "F");
    fonte("bold", 9.5); cor(BRANCO); doc.text(f.tit, M + 3, g.y + 4.5);
    if (f.extra) { fonte("normal", 9); doc.text(f.extra, M + 3 + f.wT, g.y + 4.5); }
    fonte("normal", 7.8); doc.text(f.dir, W - M - 3, g.y + (f.duas ? 8.5 : 4.4), { align: "right" });
    g.y += f.alt + 1.5;
    const r = medeRec(b);
    if (r) { espaco(r.alt); fonte("bold", 8.2); cor(TINTA); doc.text("Reclamação:", M, g.y + 2.8); fonte("normal", 8.2); doc.text(r.ls, M + r.wr, g.y + 2.8, { lineHeightFactor: LL / (8.2 * 0.3528) }); g.y += r.alt; }
    tabela("PRODUTOS E PEÇAS", b.pecas, "Total de produtos", b.t.pecas);
    tabela("SERVIÇOS", b.servicos, "Total de serviços", b.t.servicos);
    tabela("SERVIÇOS DE TERCEIROS", b.terceiros, "Total de serviços de terceiros", b.t.terceiros);
    if (semItens(b)) { fonte("normal", 8.2); cor(TEXTO2); doc.text("Sem itens lançados.", M, g.y + 2.8); g.y += 5; }
    else g.y -= 1.8;
    // fecho: desconto (se houver), total da O.S. e, com algum recebimento, recebido e falta receber
    const linhas = fechoDaOS(b), aF = altFecho(b);
    espaco(aF);
    fundo(CAB_TAB); doc.rect(M, g.y, CW, aF, "F"); traco(BORDA, 0.2); doc.rect(M, g.y, CW, aF, "S"); traco(TINTA, 0.5); doc.line(M, g.y, W - M, g.y);
    let yy = g.y;
    for (const l of linhas) {
      const a = l.forte ? 6.2 : 4.8, base = l.forte ? 4.3 : 3.4, tam = l.forte ? 9.5 : TI;
      fonte(l.forte ? "bold" : "normal", tam); cor(TINTA); doc.text(l.r, W - M - 27 - 1.8, yy + base, { align: "right" });
      fonte("bold", tam); doc.text((l.menos ? "- " : "") + reais(l.v), W - M - 1.8, yy + base, { align: "right" });
      yy += a;
    }
    g.y += aF + 3.5;
  };
  if (detalhe) d.blocos.forEach(blocoOS);

  // ---- resumo geral: uma linha por O.S. e o total geral
  const nW = d.colunas.length <= 3 ? 32 : 28;
  const colsG = [{ t: "RESUMO GERAL" }].concat(d.colunas.map(x => ({ t: x.t.toUpperCase(), w: nW, a: "right" })));
  colsG[0].w = CW - nW * d.colunas.length;
  const linhasG = d.blocos.map(b => { fonte("normal", TI); const rot = quebra(rotuloNoResumo(b, d), colsG[0].w - 3.6);
    return { b, rot, alt: (rot.length + (detalhe ? 0 : 1)) * LL + (ROW - LL) }; });
  const altG = HC + linhasG.reduce((s, l) => s + l.alt, 0) + 7.6;
  if (g.y + altG > lim && altG <= lim - M && g.y > M) { doc.addPage(); g.y = M; }
  const cabG = () => { linhaCel(colsG, g.y, HC, colsG.map(x => x.t), { fundo: CAB_TAB, borda: BORDA, estilo: "bold", tam: 7.2, base: 3.6 }); g.y += HC; };
  cabG();
  for (const l of linhasG) {
    if (espaco(l.alt)) cabG();
    linhaCel(colsG, g.y, l.alt, [l.rot].concat(d.colunas.map(x => reais(x.de(l.b)))));
    // só o resumo: a etapa escrita em cada linha (no detalhado ela está na faixa da O.S.)
    if (!detalhe) { fonte("normal", 7.4); cor(ROT); doc.text(quebra(l.b.situacao, colsG[0].w - 3.6)[0] || "", M + 1.8, g.y + 3.6 + l.rot.length * LL); }
    g.y += l.alt;
  }
  espaco(7.6);
  fundo(TINTA); doc.rect(M, g.y, CW, 7.6, "F"); cor(BRANCO);
  fonte("bold", 10.5); doc.text("TOTAL GERAL", M + 1.8, g.y + 5.1);
  d.colunas.forEach((x, i) => { const ultima = i === d.colunas.length - 1; fonte("bold", ultima ? 11.5 : 9);
    doc.text(reais(x.soma), W - M - (d.colunas.length - 1 - i) * nW - 1.8, g.y + (ultima ? 5.2 : 5), { align: "right" }); });
  g.y += 7.6 + 3;

  // ---- nota e rodapé do documento
  fonte("normal", 7.2); const tl = quebra(d.nota, CW);
  espaco(tl.length * 3.1 + 10); cor(TEXTO2); doc.text(tl, M, g.y + 2.6); g.y += tl.length * 3.1 + 3;
  traco(BORDA, 0.25); doc.line(M, g.y + 0.5, W - M, g.y + 0.5);
  fonte("bold", 7.2); cor(ROT); doc.text("NÃO VALE COMO RECIBO DE PAGAMENTO", W / 2, g.y + 4, { align: "center" }); g.y += 7;
  return doc;
}

/** d = dadosResumoOS(...) de js/resumoos.js. ext.itens === false: só o quadro "Resumo geral" (sem os itens de cada O.S.). */
export async function pdfResumoOS(d, cfg, ext = {}) {
  const detalhe = ext.itens !== false;
  let logo = null; try { logo = await imagem(cfg.logo || "app:icons/logo-preto.png"); } catch (e) {}
  // uma folha só: usa a folha quase até o fim (sem rodapé de página). Passou de uma: refaz deixando lugar para "Página i de n".
  let doc = desenhar(d, cfg, logo, detalhe, H - 10);
  const np1 = doc.getNumberOfPages();
  if (np1 > 1) {
    doc = desenhar(d, cfg, logo, detalhe, H - 15);
    const np = doc.getNumberOfPages(), quem = d.vei ? d.vei.placa : d.cli ? d.cli.nome : "";
    for (let i = 1; i <= np; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(CINZA[0], CINZA[1], CINZA[2]);
      doc.text(["Resumo de O.S.", quem, cfg.nome || ""].filter(Boolean).join("  ·  "), M, H - 8); doc.text("Página " + i + " de " + np, W - M, H - 8, { align: "right" }); }
  }
  return doc.output("blob");
}
