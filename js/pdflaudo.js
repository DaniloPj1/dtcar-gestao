// PDF do laudo de diagnóstico (js/obdlaudo.js). Preto e branco de propósito: a impressora da oficina
// só imprime assim, e nada no laudo depende de cor. Usa o jsPDF que o sistema já carrega.
import { linhas } from "./obdlaudo.js";

const W = 210, H = 297, M = 14;

/** Carrega o jsPDF quando a página ainda não o tem (o app do celular não o carrega de saída). */
export function garantirJsPDF(caminho = "../vendor/jspdf.umd.min.js") {
  if (globalThis.jspdf) return Promise.resolve();
  return new Promise((ok, falha) => { const s = document.createElement("script"); s.src = caminho; s.onload = () => ok(); s.onerror = () => falha(new Error("Não deu para carregar o gerador de PDF.")); document.head.appendChild(s); });
}

export function pdfLaudo(dados, selo, cfg = {}) {
  const doc = new globalThis.jspdf.jsPDF({ unit: "mm", format: "a4" });
  let y = M;
  const quebra = alt => { if (y + alt > H - 16) { doc.addPage(); y = M; } };
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold"); doc.setFontSize(11); doc.text(String(cfg.nome || dados.oficina || "DTCar Centro Automotivo"), M, y); y += 5;
  if (cfg.endereco || cfg.telefone) { doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.text([cfg.endereco, cfg.telefone].filter(Boolean).join("  ·  "), M, y); y += 4; }
  doc.setLineWidth(0.4); doc.line(M, y, W - M, y); y += 7;
  for (const l of linhas(dados, selo)) {
    const tam = l.t === "titulo" ? 14 : l.t === "sub" ? 10 : l.t === "nota" ? 7.5 : 9.5;
    doc.setFont("helvetica", l.t === "titulo" || l.t === "sub" ? "bold" : "normal"); doc.setFontSize(tam);
    if (l.t === "sub") { y += 3; quebra(8); doc.text(l.x, M, y); y += 1.5; doc.setLineWidth(0.2); doc.line(M, y, W - M, y); y += 4.5; continue; }
    if (l.t === "nota") y += 2;
    const partes = doc.splitTextToSize(l.x, W - 2 * M), alt = tam * 0.42;
    for (const p of partes) { quebra(alt + 1); doc.text(p, M, y); y += alt + (l.t === "titulo" ? 3 : 1); }
  }
  const np = doc.getNumberOfPages();
  for (let i = 1; i <= np; i++) { doc.setPage(i); doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.text("Laudo de diagnóstico · " + (dados.carro.placa || "") + (selo ? " · selo " + selo.slice(0, 12) : ""), M, H - 8); doc.text("Página " + i + " de " + np, W - M, H - 8, { align: "right" }); }
  return doc.output("blob");
}
