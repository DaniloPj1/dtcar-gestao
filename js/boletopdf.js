// PDF do boleto Sicredi emitido pela oficina (modelo do "Manual CNAB 240", item 10).
// Tudo em texto (o Sicredi não homologa boleto em imagem); código de barras "2 de 5 intercalado"
// desenhado em barras e QR Code Pix desenhado em módulos.
import { barrasI25, linhaFmt, nossoNumeroFmt, pixCopiaCola, textoCnab } from "./cnab.js";
import { qrMatriz } from "./qr.js";

const W = 210, M = 10, CW = W - 2 * M;
const brl = v => Number(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dataBR = iso => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
const docFmt = d => { d = String(d || "").replace(/\D/g, ""); return d.length === 14 ? d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5") : d.length === 11 ? d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4") : d; };
export const codigoBeneficiario = cob => String(cob.cooperativa).padStart(4, "0") + "." + String(cob.posto).padStart(2, "0") + "." + String(cob.beneficiario).padStart(5, "0");
export const ESPECIES = { "03": "DMI", "05": "DSI", "12": "NP", "17": "RC", "99": "OS" };

/** Texto das instruções (juros e multa), igual ao que foi para o banco. */
export function instrucoes(cob) {
  const l = [];
  if (Number(cob.jurosMes) > 0) l.push("APOS O VENCIMENTO, JUROS DE " + brl(cob.jurosMes) + "% AO MES.");
  if (Number(cob.multa) > 0) l.push("APOS O VENCIMENTO, MULTA DE " + brl(cob.multa) + "%.");
  if (cob.mensagem) l.push(textoCnab(cob.mensagem).slice(0, 80));
  return l;
}

/**
 * Monta o PDF de um ou mais boletos (um por página) e devolve o documento jsPDF.
 * b = linha da tabela "boletos"; cob = cfg.cobranca; emp = { nome, cnpj, endereco }.
 */
export function pdfBoletos(lista, cob, emp) {
  const doc = new globalThis.jspdf.jsPDF({ unit: "mm", format: "a4" });
  lista.forEach((b, i) => { if (i) doc.addPage(); pagina(doc, b, cob, emp); });
  return doc;
}

function pagina(doc, b, cob, emp) {
  const fonte = (e, t) => { doc.setFont("helvetica", e); doc.setFontSize(t); };
  const linhaH = (y, x1 = M, x2 = W - M, l = 0.25) => { doc.setLineWidth(l); doc.line(x1, y, x2, y); };
  const caixa = (x, y, w, h, rot, val, opts = {}) => {
    doc.setLineWidth(0.2); doc.rect(x, y, w, h);
    fonte("normal", 6); doc.text(rot, x + 1, y + 2.4);
    fonte(opts.negrito ? "bold" : "normal", opts.tam || 8.5);
    const linhas = Array.isArray(val) ? val : [String(val == null ? "" : val)];
    linhas.forEach((t, k) => doc.text(t, opts.direita ? x + w - 1.2 : x + 1, y + 6 + k * 3.4, opts.direita ? { align: "right" } : undefined));
  };
  const cab = (y, titulo) => {
    fonte("bold", 15); doc.text("Sicredi", M, y + 6);
    doc.setLineWidth(0.5); doc.line(M + 25, y + 1, M + 25, y + 8); doc.line(M + 45, y + 1, M + 45, y + 8);
    fonte("bold", 13); doc.text("748-X", M + 35, y + 6.2, { align: "center" });
    fonte("bold", 10.5); doc.text(titulo, W - M, y + 6, { align: "right" });
    linhaH(y + 8.5, M, W - M, 0.5);
  };
  const p = b.pagador || {}, ben = codigoBeneficiario(cob), esp = ESPECIES[cob.especie || "03"] || "DMI";
  const enderecoPag = [p.endereco, p.bairro].filter(Boolean).join(", "), cidadePag = [p.cidade, p.uf].filter(Boolean).join(" - ") + (p.cep ? "  CEP " + String(p.cep).replace(/(\d{5})(\d{3})/, "$1-$2") : "");
  const benef = (emp.nome || "") + "  CNPJ " + docFmt(emp.cnpj);

  /* ---------- recibo do pagador ---------- */
  let y = 12;
  cab(y, "RECIBO DO PAGADOR");
  y += 10;
  caixa(M, y, 120, 9, "Beneficiário", benef);
  caixa(M + 120, y, 40, 9, "Agência/Código beneficiário", ben);
  caixa(M + 160, y, 30, 9, "Vencimento", dataBR(b.vencimento), { negrito: true, direita: true });
  y += 9;
  caixa(M, y, 120, 9, "Pagador", (p.nome || b.pagador_nome || "") + "  " + docFmt(p.doc || b.pagador_doc));
  caixa(M + 120, y, 40, 9, "Nosso número", nossoNumeroFmt(b.nosso_numero));
  caixa(M + 160, y, 30, 9, "(=) Valor do documento", brl(b.valor), { negrito: true, direita: true });
  y += 9;
  caixa(M, y, 120, 9, "Referente a", textoCnab(b.descricao).slice(0, 70));
  caixa(M + 120, y, 40, 9, "Nº do documento", b.seu_numero || "");
  caixa(M + 160, y, 30, 9, "Data do documento", dataBR(b.emissao), { direita: true });
  y += 9;
  fonte("normal", 7);
  doc.text("Linha digitável: " + linhaFmt(b.linha_digitavel), M, y + 4);
  doc.text("Endereço do beneficiário: " + (emp.endereco || ""), M, y + 8);
  y += 14;
  doc.setLineDashPattern([1, 1], 0); linhaH(y, M, W - M, 0.2); doc.setLineDashPattern([], 0);
  fonte("normal", 6); doc.text("Corte na linha pontilhada", W - M, y - 1, { align: "right" });

  /* ---------- ficha de compensação ---------- */
  y = 150;
  fonte("bold", 15); doc.text("Sicredi", M, y + 6);
  doc.setLineWidth(0.5); doc.line(M + 25, y + 1, M + 25, y + 8); doc.line(M + 45, y + 1, M + 45, y + 8);
  fonte("bold", 13); doc.text("748-X", M + 35, y + 6.2, { align: "center" });
  fonte("bold", 10.5); doc.text(linhaFmt(b.linha_digitavel), W - M, y + 6, { align: "right" });
  linhaH(y + 8.5, M, W - M, 0.5);
  y += 9;
  const X = M + 145, WD = CW - 145; // coluna da direita
  caixa(M, y, 145, 9, "Local de pagamento", "PAGAVEL PREFERENCIALMENTE EM CANAIS ELETRONICOS DA SUA INSTITUICAO FINANCEIRA", { tam: 7.5 });
  caixa(X, y, WD, 9, "Vencimento", dataBR(b.vencimento), { negrito: true, direita: true });
  y += 9;
  caixa(M, y, 145, 9, "Beneficiário", benef, { tam: 8 });
  caixa(X, y, WD, 9, "Agência/Código beneficiário", ben, { direita: true });
  y += 9;
  caixa(M, y, 30, 9, "Data do documento", dataBR(b.emissao));
  caixa(M + 30, y, 35, 9, "Nº do documento", b.seu_numero || "");
  caixa(M + 65, y, 25, 9, "Espécie doc.", esp);
  caixa(M + 90, y, 15, 9, "Aceite", "N");
  caixa(M + 105, y, 40, 9, "Data do processamento", dataBR(b.emissao));
  caixa(X, y, WD, 9, "Nosso número", nossoNumeroFmt(b.nosso_numero), { direita: true });
  y += 9;
  caixa(M, y, 30, 9, "Uso do banco", "");
  caixa(M + 30, y, 20, 9, "Carteira", "1");
  caixa(M + 50, y, 15, 9, "Espécie", "R$");
  caixa(M + 65, y, 40, 9, "Quantidade", "");
  caixa(M + 105, y, 40, 9, "Valor", "");
  caixa(X, y, WD, 9, "(=) Valor do documento", brl(b.valor), { negrito: true, direita: true });
  y += 9;
  // instruções + QR Code Pix
  const altInstr = 45;
  doc.setLineWidth(0.2); doc.rect(M, y, 145, altInstr);
  fonte("normal", 6); doc.text("Instruções (texto de responsabilidade do beneficiário)", M + 1, y + 2.4);
  fonte("normal", 7.5);
  instrucoes(cob).forEach((t, k) => doc.text(t, M + 1, y + 6.5 + k * 3.6));
  // pela API o Sicredi devolve o código Pix pronto; pelo arquivo de retorno vem só o endereço (URL) do QR Code
  const emv = !b.qr_url ? "" : /^000201/.test(b.qr_url) ? b.qr_url : pixCopiaCola(b.qr_url, emp.nome, emp.cidade || "COLATINA");
  if (emv) {
    const m = qrMatriz(emv), lado = 32, mod = lado / (m.length + 8), x0 = M + 145 - lado - 3, y0 = y + 3;
    doc.setFillColor(0, 0, 0);
    m.forEach((l, r) => l.forEach((c, k) => { if (c) doc.rect(x0 + (k + 4) * mod, y0 + (r + 4) * mod, mod + 0.01, mod + 0.01, "F"); }));
    fonte("bold", 7); doc.text("Pague com Pix", x0 + lado / 2, y0 + lado + 3, { align: "center" });
    fonte("normal", 6); doc.text("Aponte a câmera do app do banco", x0 + lado / 2, y0 + lado + 5.6, { align: "center" });
  } else {
    fonte("normal", 6.5); doc.text("QR Code Pix: disponível depois do registro no banco.", M + 1, y + altInstr - 2.5);
  }
  [["(-) Desconto / Abatimento", ""], ["(-) Outras deduções", ""], ["(+) Mora / Multa", ""], ["(+) Outros acréscimos", ""], ["(=) Valor cobrado", ""]]
    .forEach(([r], k) => caixa(X, y + k * 9, WD, 9, r, ""));
  y += altInstr;
  doc.setLineWidth(0.2); doc.rect(M, y, CW, 16);
  fonte("normal", 6); doc.text("Pagador", M + 1, y + 2.4);
  fonte("normal", 8);
  doc.text((p.nome || b.pagador_nome || "") + "   " + (String(p.doc || b.pagador_doc).replace(/\D/g, "").length === 14 ? "CNPJ " : "CPF ") + docFmt(p.doc || b.pagador_doc), M + 1, y + 6);
  doc.text(textoCnab(enderecoPag).slice(0, 90), M + 1, y + 9.5);
  doc.text(textoCnab(cidadePag), M + 1, y + 13);
  fonte("normal", 6); doc.text("Beneficiário final:", M + 120, y + 13);
  y += 16;
  fonte("normal", 6); doc.text("Autenticação mecânica - Ficha de compensação", W - M, y + 3, { align: "right" });

  /* ---------- código de barras: início a 5 mm da margem, centro a 12 mm do fim da folha, 103 x 13 mm ---------- */
  const barras = barrasI25(b.codigo_barras), total = barras.reduce((s, x) => s + x, 0), un = 103 / total, alt = 13, yb = 297 - 12 - alt / 2;
  let x = 5; doc.setFillColor(0, 0, 0);
  barras.forEach((w, k) => { if (k % 2 === 0) doc.rect(x, yb, w * un, alt, "F"); x += w * un; });
}

/** Nome do arquivo PDF */
export const nomePdf = b => "boleto-" + (b.os_numero ? "os" + b.os_numero + "-" : "") + nossoNumeroFmt(b.nosso_numero).replace(/\D/g, "") + ".pdf";
