// Leitura de boletos: linha digitável (47 ou 48 dígitos), código de barras (44),
// texto do PDF do boleto e câmera (onde o navegador suporta leitura de código de barras).
const so = s => String(s || "").replace(/\D/g, "");

const BANCOS = { "001": "Banco do Brasil", "021": "Banestes", "033": "Santander", "041": "Banrisul", "070": "BRB", "077": "Banco Inter", "085": "Ailos", "104": "Caixa",
  "136": "Unicred", "197": "Stone", "208": "BTG Pactual", "212": "Banco Original", "237": "Bradesco", "260": "Nubank", "290": "PagBank", "323": "Mercado Pago", "336": "C6 Bank",
  "341": "Itaú", "380": "PicPay", "403": "Cora", "422": "Safra", "748": "Sicredi", "756": "Sicoob" };
const SEGMENTOS = { 1: ["Prefeitura", "Impostos e taxas"], 2: ["Saneamento", "Água"], 3: ["Energia elétrica e gás", "Energia"], 4: ["Telecomunicações", "Telefone e internet"],
  5: ["Órgão governamental", "Impostos e taxas"], 6: ["Empresa / carnê", ""], 7: ["Multa de trânsito", "Impostos e taxas"], 9: ["Uso exclusivo do banco", ""] };

function mod10(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { let p = Number(num[i]) * peso; if (p > 9) p = Math.floor(p / 10) + (p % 10); soma += p; peso = peso === 2 ? 1 : 2; }
  return (10 - (soma % 10)) % 10;
}
function mod11Banco(num) { // DV geral do código de barras bancário
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { soma += Number(num[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const dv = 11 - (soma % 11); return dv === 0 || dv === 10 || dv === 11 ? 1 : dv;
}
function mod11Arrec(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { soma += Number(num[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = soma % 11; return r === 0 || r === 1 ? 0 : 11 - r;
}

const iso = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
/** Fator de vencimento: conta dias desde 07/10/1997; em 22/02/2025 voltou a 1000. Fica com a data mais próxima de hoje. */
export function dataDoFator(fator, hoje = new Date()) {
  fator = Number(fator); if (!fator) return null;
  const a = new Date(1997, 9, 7 + fator), b = new Date(2025, 1, 22 + fator - 1000);
  return iso(Math.abs(a - hoje) <= Math.abs(b - hoje) ? a : b);
}

function bancarioDeBarras(b) {
  const dvOk = mod11Banco(b.slice(0, 4) + b.slice(5)) === Number(b[4]);
  const c1 = b.slice(0, 4) + b.slice(19, 24), c2 = b.slice(24, 34), c3 = b.slice(34, 44);
  const linha = c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + b[4] + b.slice(5, 19);
  const banco = b.slice(0, 3);
  return { tipo: "bancario", ok: dvOk, codigo_barras: b, linha_digitavel: linha, banco, banco_nome: BANCOS[banco] || "Banco " + banco,
    valor: Number(b.slice(9, 19)) / 100, vencimento: dataDoFator(b.slice(5, 9)), categoria: "" };
}
function arrecDeBarras(b) {
  const modo = b[2], m = modo === "6" || modo === "7" ? mod10 : mod11Arrec;
  const dvOk = m(b.slice(0, 3) + b.slice(4)) === Number(b[3]);
  const blocos = [0, 11, 22, 33].map(i => b.slice(i, i + 11)), linha = blocos.map(x => x + m(x)).join("");
  const seg = SEGMENTOS[b[1]] || ["Arrecadação", ""];
  return { tipo: "arrecadacao", ok: dvOk, codigo_barras: b, linha_digitavel: linha, segmento: seg[0], categoria: seg[1],
    valor: modo === "6" || modo === "8" ? Number(b.slice(4, 15)) / 100 : 0, vencimento: null, valor_referencia: modo === "7" || modo === "9" };
}

/** Interpreta linha digitável ou código de barras. Retorna null se não reconhecer. */
export function lerBoleto(texto) {
  const d = so(texto);
  if (d.length === 44) return d[0] === "8" ? arrecDeBarras(d) : bancarioDeBarras(d);
  if (d.length === 47) {
    const camposOk = [[0, 9], [10, 20], [21, 31]].every(([i, f]) => mod10(d.slice(i, f)) === Number(d[f]));
    const b = d.slice(0, 4) + d[32] + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31);
    const r = bancarioDeBarras(b); return { ...r, ok: r.ok && camposOk, linha_digitavel: d };
  }
  if (d.length === 48 && d[0] === "8") {
    const b = [0, 12, 24, 36].map(i => d.slice(i, i + 11)).join("");
    const r = arrecDeBarras(b); const m = b[2] === "6" || b[2] === "7" ? mod10 : mod11Arrec;
    const blocosOk = [0, 12, 24, 36].every(i => m(d.slice(i, i + 11)) === Number(d[i + 11]));
    return { ...r, ok: r.ok && blocosOk, linha_digitavel: d };
  }
  return null;
}
export const fmtLinha = l => { const d = so(l);
  if (d.length === 47) return `${d.slice(0, 5)}.${d.slice(5, 10)} ${d.slice(10, 15)}.${d.slice(15, 21)} ${d.slice(21, 26)}.${d.slice(26, 32)} ${d[32]} ${d.slice(33)}`;
  if (d.length === 48) return [0, 12, 24, 36].map(i => d.slice(i, i + 11) + "-" + d[i + 11]).join(" ");
  return d; };

/** Procura uma linha digitável válida dentro de um texto qualquer (ex.: texto do PDF do boleto). */
export function acharNoTexto(texto) {
  const cands = String(texto || "").match(/\d[\d.\s-]{40,80}\d/g) || [];
  for (const c of cands) {
    const d = so(c);
    for (const n of [47, 48, 44]) for (let i = 0; i + n <= d.length; i++) { const r = lerBoleto(d.slice(i, i + n)); if (r && r.ok && (n !== 48 || d[i] === "8")) return r; }
  }
  return null;
}

/** Extrai o texto de um PDF (boleto) com o pdf.js, carregado só quando precisa. */
export async function textoDoPDF(arquivo) {
  const pdfjs = await import("../vendor/pdfjs/pdf.min.js");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("../vendor/pdfjs/pdf.worker.min.js", import.meta.url).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await arquivo.arrayBuffer()) }).promise;
  const partes = [];
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) { const c = await (await doc.getPage(p)).getTextContent(); partes.push(c.items.map(i => i.str).join(" ")); }
  return partes.join("\n");
}
/** Lê o PDF do boleto: linha digitável e CNPJs encontrados (o beneficiário costuma ser um deles). */
export async function lerPDFBoleto(arquivo) {
  const txt = await textoDoPDF(arquivo);
  const cnpjs = [...new Set((txt.match(/\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}/g) || []).map(so))];
  return { boleto: acharNoTexto(txt), cnpjs, texto: txt };
}

export const temCamera = () => typeof window !== "undefined" && "BarcodeDetector" in window && !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
