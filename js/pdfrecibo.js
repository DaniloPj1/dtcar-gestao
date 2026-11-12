// PDF da O.S. Recibo (pedido do Danilo em 12/11/2026): o MESMO leiaute da tela de impressão (ViaOSRecibo em js/telas/imprimir.js).
// Mudou um, mude o outro. Textos e contas em js/osrecibo.js. Usado pela função "email" (anexo do WhatsApp e do e-mail):
// sem window/document no carregamento. Arquivo separado do js/pdf.js de propósito: a O.S. normal não muda.
import { exPlaca, fmtDoc, fmtTel, fmtKm, fmtData, reais, qtdFmt, totalItem, extenso } from "./util.js";
import { dadosOSRecibo, condicoesGarantia, CUIDADOS_MOTOR } from "./osrecibo.js";

const TINTA = [22, 25, 29], CINZA = [85, 85, 85], BORDA = [154, 160, 166], GRADE = [196, 200, 204], FUNDO = [236, 238, 240];
const W = 210, H = 297, MX = 12, MY = 10, CW = W - 2 * MX;

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

/** Texto com trechos em negrito ([{t, b}]) quebrando linha dentro da largura. Desenha (ou só mede) e devolve a altura. */
function corrido(d, x, y, larg, partes, tam, lh, desenhar) {
  const { doc } = d; let cx = x, cy = y;
  for (const p of partes) {
    d.fonte(p.b ? "bold" : "normal", tam);
    // quebra só nos espaços comuns: "R$ 13.384,51" (espaço não separável) nunca se divide
    const palavras = String(p.t).split(/( +)/).filter(s => s !== "");
    for (const w of palavras) {
      const ww = doc.getTextWidth(w);
      if (/^ +$/.test(w)) { if (cx > x) cx += ww; continue; }
      if (cx > x && cx + ww > x + larg) { cx = x; cy += lh; }
      if (desenhar) { d.cor(TINTA); doc.text(w, cx, cy); }
      cx += ww;
    }
  }
  return cy - y + lh;
}

export async function pdfOSRecibo(o, cfg, ext = {}) {
  const doc = new globalThis.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const d = { doc, y: MY };
  d.cor = c => doc.setTextColor(c[0], c[1], c[2]);
  d.fonte = (estilo, tam) => { doc.setFont("helvetica", estilo); doc.setFontSize(tam); };
  d.espaco = alt => { if (d.y + alt > H - 14) { doc.addPage(); d.y = MY; return true; } return false; };
  const motor = ext.motor !== false;
  const recibos = ext.recibos || [], cli = ext.cli || null;
  const c = o.cliente || {}, v = o.veiculo || {};
  const dd = dadosOSRecibo(o, recibos, cfg), t = dd.t;
  const docCli = c.doc || (cli && cli.doc) || "";
  const n5 = String(o.numero ?? "").padStart(5, "0");
  const linha = (x1, y1, x2, y2, cor, larg) => { doc.setDrawColor(cor[0], cor[1], cor[2]); doc.setLineWidth(larg); doc.line(x1, y1, x2, y2); };

  // ---- cabeçalho: logo à esquerda, empresa à direita, linha grossa
  try { const im = await imagem(cfg.logo || "app:icons/logo-preto.png"); const r = Math.min(46 / im.w, 19 / im.h);
    doc.addImage(im.data, im.fmt, MX, d.y, im.w * r, im.h * r, undefined, "FAST"); } catch (e) {}
  const emp = [cfg.cnpj ? "CNPJ " + cfg.cnpj : "", cfg.endereco || "", cfg.telefone ? "Telefone: " + cfg.telefone : ""].filter(Boolean);
  d.fonte("bold", 11); d.cor(TINTA); doc.text(String(cfg.nome || "Oficina").toUpperCase(), W - MX, d.y + 4, { align: "right" });
  d.fonte("normal", 8.2); const le = emp.flatMap(l => doc.splitTextToSize(l, 115)).slice(0, 4);
  le.forEach((l, i) => doc.text(l, W - MX, d.y + 8.4 + i * 3.7, { align: "right" }));
  d.y += 21; linha(MX, d.y, W - MX, d.y, TINTA, 0.9); d.y += 7;

  // ---- título e número
  d.fonte("bold", 17); d.cor(TINTA); doc.text("RECIBO DE ORDEM DE SERVIÇO", MX, d.y + 1.5);
  d.fonte("bold", 12); const tn = "O.S. Nº " + n5, wn = doc.getTextWidth(tn) + 7;
  doc.setDrawColor(TINTA[0], TINTA[1], TINTA[2]); doc.setLineWidth(0.7); doc.rect(W - MX - wn, d.y - 4.6, wn, 7.6, "S");
  doc.text(tn, W - MX - wn / 2, d.y + 0.8, { align: "center" });
  d.y += 5.6; d.fonte("normal", 8.4); doc.text("Pago em " + fmtData(dd.pagoEm) + (o.criado_em ? " · O.S. aberta em " + fmtData(o.criado_em) : ""), MX, d.y);
  d.y += 3;

  // ---- faixa preta com o título da seção
  const secao = (tit, junto = 10) => {
    d.espaco(6.5 + junto);
    doc.setFillColor(TINTA[0], TINTA[1], TINTA[2]); doc.rect(MX, d.y, CW, 5.4, "F");
    d.fonte("bold", 9.6); doc.setTextColor(255, 255, 255); doc.text(tit.toUpperCase(), MX + 2.5, d.y + 3.9);
    d.y += 6.6;
  };

  // ---- cliente e veículo (4 colunas: rótulo cinza | valor | rótulo | valor)
  secao("Cliente e veículo", 26);
  const veic = [v.marca, v.modelo, v.ano, v.cor].filter(Boolean).join(" – ");
  const linhasDados = [["Cliente", c.nome || "", "Telefone", fmtTel(c.telefone) || ""], ["Veículo", veic, "Placa", exPlaca(v.placa)],
    ["KM na entrega", o.km_saida ? fmtKm(o.km_saida) : "", "Data de entrega", dd.entrega ? fmtData(dd.entrega) : ""],
    ["Técnico", o.mecanico_nome || "", "CPF/CNPJ", docCli ? fmtDoc(docCli) : ""]];
  const cols = [30, 70, 30, CW - 130];
  for (const l of linhasDados) {
    d.fonte("normal", 8.6);
    const txt = l.map((s, i) => doc.splitTextToSize(String(s || ""), cols[i] - 3));
    const alt = Math.max(...txt.map(x => x.length)) * 3.7 + 2.2;
    let x = MX;
    l.forEach((_, i) => {
      if (i % 2 === 0) { doc.setFillColor(FUNDO[0], FUNDO[1], FUNDO[2]); doc.rect(x, d.y, cols[i], alt, "F"); }
      doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.25); doc.rect(x, d.y, cols[i], alt, "S");
      d.fonte(i % 2 === 0 ? "bold" : "normal", 8.6); d.cor(TINTA); doc.text(txt[i], x + 1.6, d.y + 3.6);
      x += cols[i];
    });
    d.y += alt;
  }
  d.y += 1;

  // ---- serviços e peças: uma tabela por tipo (descrição, ref., qtd., unit., total)
  secao("Serviços e peças", 12);
  const tabela = (tit, itens) => {
    if (!itens.length) return;
    const comRef = itens.some(i => i.codigo);
    const cs = [{ t: tit }].concat(comRef ? [{ t: "REF.", w: 24 }] : [], [{ t: "QTD.", w: 14, a: "r" }, { t: "UNIT.", w: 25, a: "r" }, { t: "TOTAL", w: 26, a: "r" }]);
    cs[0].w = CW - cs.slice(1).reduce((s, x) => s + x.w, 0);
    const cab = () => {
      doc.setFillColor(FUNDO[0], FUNDO[1], FUNDO[2]); doc.rect(MX, d.y, CW, 4.8, "F");
      let x = MX; d.fonte("bold", 7.8); d.cor(TINTA);
      cs.forEach(cc => { doc.setDrawColor(BORDA[0], BORDA[1], BORDA[2]); doc.setLineWidth(0.25); doc.rect(x, d.y, cc.w, 4.8, "S");
        doc.text(cc.t.toUpperCase(), cc.a ? x + cc.w - 1.5 : x + 1.5, d.y + 3.4, { align: cc.a ? "right" : "left" }); x += cc.w; });
      d.y += 4.8;
    };
    d.espaco(10); cab();
    for (const i of itens) {
      d.fonte("normal", 8);
      const desc = doc.splitTextToSize(i.descricao + (i.fornecida_cliente ? " (peça do cliente)" : ""), cs[0].w - 3);
      const ref = comRef ? doc.splitTextToSize(i.codigo || "", 21) : [];
      const alt = Math.max(desc.length, ref.length || 1) * 3.3 + 1.2;
      if (d.espaco(alt)) cab();
      const vals = [desc].concat(comRef ? [ref] : [], [i.horas ? qtdFmt(i.horas) + " h" : qtdFmt(i.qtd), i.fornecida_cliente ? "—" : reais(i.valor_unit), i.fornecida_cliente ? "—" : reais(totalItem(i))]);
      let x = MX;
      cs.forEach((cc, k) => { doc.setDrawColor(GRADE[0], GRADE[1], GRADE[2]); doc.setLineWidth(0.2); doc.rect(x, d.y, cc.w, alt, "S");
        d.fonte("normal", 8); d.cor(TINTA); doc.text(vals[k], cc.a ? x + cc.w - 1.5 : x + 1.5, d.y + 3, { align: cc.a ? "right" : "left" }); x += cc.w; });
      d.y += alt;
    }
    d.y += 1.6;
  };
  tabela("Produtos e peças", dd.pecas); tabela("Serviços", dd.servicos); tabela("Serviços de terceiros", dd.terceiros);
  d.espaco(9);
  d.fonte("bold", 12.5); d.cor(TINTA); doc.text("VALOR TOTAL DA O.S.: " + reais(t.total), W - MX, d.y + 4, { align: "right" });
  if (t.desconto) { const wt = doc.getTextWidth("VALOR TOTAL DA O.S.: " + reais(t.total)); d.fonte("normal", 9); doc.text("Desconto: − " + reais(t.desconto), W - MX - wt - 6, d.y + 4, { align: "right" }); }
  d.y += 7;

  // ---- pagamento: "Recebemos de..."
  const formas = dd.formas ? (dd.formas === dd.formas.toUpperCase() ? dd.formas : dd.formas.charAt(0).toLowerCase() + dd.formas.slice(1)) : "";
  const rec = [{ t: "Recebemos de " }, { t: c.nome || "", b: true }].concat(docCli ? [{ t: ", CPF/CNPJ " }, { t: fmtDoc(docCli), b: true }] : [],
    [{ t: ", a importância de " }, { t: reais(dd.valorPago), b: true }, { t: " (" + extenso(dd.valorPago) + "), referente à Ordem de Serviço nº " + n5 }],
    formas ? [{ t: ", pago em " }, { t: formas, b: true }] : [], [{ t: ", dando plena quitação." }]);
  // lista dos pagamentos (mais de um): medida já quebrada, linha a linha, com troca de página se precisar
  d.fonte("normal", 8.2);
  const lPag = [];
  if (dd.pagos.length > 1) for (const r of dd.pagos) {   // um pagamento nunca se divide entre duas linhas
    const p = fmtData(r.data) + " · " + (r.forma || "—") + " · " + reais(r.valor), ult = lPag.length ? lPag[lPag.length - 1] : null;
    if (ult !== null && doc.getTextWidth(ult + "     " + p) <= CW) lPag[lPag.length - 1] = ult + "     " + p; else lPag.push(p);
  }
  const altRec = corrido(d, MX, 0, CW, rec, 8.8, 3.9, false);
  secao("Pagamento", altRec + Math.min(lPag.length, 3) * 3.6);
  d.y += 3.2; d.y += corrido(d, MX, d.y, CW, rec, 8.8, 3.9, true) - 3.2;
  for (const l of lPag) { d.espaco(3.6); d.fonte("normal", 8.2); d.cor(TINTA); doc.text(l, MX, d.y + 3.2); d.y += 3.6; }
  if (lPag.length) d.y += 1;
  d.y += 1.5;

  // ---- prazo e condições da garantia (lista numerada)
  const cond = condicoesGarantia({ dias: dd.dias, numero: o.numero, telefone: cfg.telefone, motor, entrega: dd.entrega, validade: dd.validade });
  secao("Prazo e condições da garantia", 14);
  cond.forEach((cc, n) => {
    const partes = (cc.r ? [{ t: cc.r + " ", b: true }] : []).concat([{ t: cc.t }]);
    const alt = corrido(d, MX + 5, 0, CW - 5, partes, 8.6, 3.75, false) + 0.6;
    d.espaco(alt);
    d.fonte("normal", 8.6); d.cor(TINTA); doc.text((n + 1) + ".", MX + 3.6, d.y + 3.1, { align: "right" });
    corrido(d, MX + 5, d.y + 3.1, CW - 5, partes, 8.6, 3.75, true); d.y += alt;
  });
  d.y += 1;

  // ---- cuidados do motor: caixa com borda e o aviso dos 1.000 km tracejado
  if (motor) {
    const intro = [{ t: CUIDADOS_MOTOR.intro }], dest = [{ t: "! " + CUIDADOS_MOTOR.destaque + " " + CUIDADOS_MOTOR.destaque2, b: true }];
    const itens = CUIDADOS_MOTOR.itens.map(cc => [{ t: cc.r, b: true }].concat(cc.t ? [{ t: " " + cc.t }] : []));
    const aIntro = corrido(d, 0, 0, CW - 6, intro, 8.6, 3.75, false), aDest = corrido(d, 0, 0, CW - 10, dest, 8.6, 3.75, false);
    const aItens = itens.map(p => corrido(d, 0, 0, CW - 11, p, 8.6, 3.75, false) + 0.3);
    const altCaixa = 2.8 + aIntro + 1 + aDest + 3.4 + aItens.reduce((s, a) => s + a, 0) + 1.5;
    secao(CUIDADOS_MOTOR.titulo, altCaixa);
    d.espaco(altCaixa); const y0 = d.y;
    doc.setDrawColor(TINTA[0], TINTA[1], TINTA[2]); doc.setLineWidth(0.6); doc.rect(MX, y0, CW, altCaixa, "S");
    let y = y0 + 4.2;
    corrido(d, MX + 3, y, CW - 6, intro, 8.6, 3.75, true); y += aIntro + 0.4;
    doc.setLineDashPattern([1, 0.8], 0); doc.setLineWidth(0.4); doc.rect(MX + 3, y - 3.4, CW - 6, aDest + 2.6, "S"); doc.setLineDashPattern([], 0);
    corrido(d, MX + 5, y + 0.5, CW - 10, dest, 8.6, 3.75, true); y += aDest + 3.4;
    itens.forEach((p, k) => { doc.setFillColor(TINTA[0], TINTA[1], TINTA[2]); doc.circle(MX + 5.3, y - 1.1, 0.55, "F"); corrido(d, MX + 8, y, CW - 11, p, 8.6, 3.75, true); y += aItens[k]; });
    d.y = y0 + altCaixa + 2;
  }

  // ---- assinaturas
  d.espaco(26);
  d.y += 4; d.fonte("normal", 8.8); d.cor(TINTA); doc.text((cfg.cidade || "Colatina/ES") + ", " + fmtData(dd.pagoEm), MX, d.y);
  d.y += 13;
  const la = (CW - 12) / 2;
  [[MX, String(cfg.nome || "Oficina").toUpperCase(), cfg.cnpj ? "CNPJ " + cfg.cnpj : ""], [MX + la + 12, "Cliente: " + (c.nome || ""), "Declaro ter recebido o veículo e ciência deste termo"]].forEach(([x, a, b]) => {
    linha(x, d.y, x + la, d.y, TINTA, 0.4);
    d.fonte("bold", 8.6); d.cor(TINTA); doc.text(doc.splitTextToSize(a, la)[0], x + la / 2, d.y + 3.8, { align: "center" });
    d.fonte("normal", 8.2); doc.text(doc.splitTextToSize(b, la)[0] || "", x + la / 2, d.y + 7.4, { align: "center" });
  });
  d.y += 10;

  // ---- rodapé em todas as páginas
  const np = doc.getNumberOfPages();
  for (let i = 1; i <= np; i++) {
    doc.setPage(i); linha(MX, H - 9.5, W - MX, H - 9.5, GRADE, 0.2);
    d.fonte("normal", 7); d.cor(CINZA);
    doc.text("Gerado pelo sistema Gestão DTCar · O.S. " + n5 + " · " + exPlaca(v.placa) + (np > 1 ? " · Página " + i + " de " + np : ""), W / 2, H - 6.5, { align: "center" });
  }
  return doc.output("blob");
}
