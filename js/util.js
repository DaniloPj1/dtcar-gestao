// Formatação, validação e cálculos
export const soDig = s => String(s ?? "").replace(/\D/g, "");
export const norm = s => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));

export function validaCPF(v) {
  const c = soDig(v); if (c.length !== 11 || /^(\d)\1+$/.test(c)) return false;
  let s = 0; for (let i = 0; i < 9; i++) s += +c[i] * (10 - i); let d = (s * 10) % 11; if (d === 10) d = 0; if (d !== +c[9]) return false;
  s = 0; for (let i = 0; i < 10; i++) s += +c[i] * (11 - i); d = (s * 10) % 11; if (d === 10) d = 0; return d === +c[10];
}
export function validaCNPJ(v) {
  const c = soDig(v); if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false;
  const dv = n => { const p = n === 12 ? [5,4,3,2,9,8,7,6,5,4,3,2] : [6,5,4,3,2,9,8,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < n; i++) s += +c[i] * p[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
  return dv(12) === +c[12] && dv(13) === +c[13];
}
export const docValido = v => { const d = soDig(v); return d.length === 11 ? validaCPF(d) : d.length === 14 ? validaCNPJ(d) : false; };
export function fmtDoc(v) { const d = soDig(v); if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4"); if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5"); return v || ""; }
export function fmtTel(v) { const t = soDig(v); if (t.length === 11) return t.replace(/(\d{2})(\d{5})(\d{4})/, "($1) $2-$3"); if (t.length === 10) return t.replace(/(\d{2})(\d{4})(\d{4})/, "($1) $2-$3"); return v || ""; }
export const normPlaca = p => String(p ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 7);
export const placaValida = p => /^[A-Z]{3}\d[A-Z\d]\d{2}$/.test(p);
export const exPlaca = p => (p && /^[A-Z]{3}\d{4}$/.test(p)) ? p.slice(0, 3) + "-" + p.slice(3) : (p || "");

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
export const reais = n => BRL.format(Number(n) || 0);
export const num2 = n => (Number(n) || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const qtdFmt = n => (Number(n) || 0).toLocaleString("pt-BR", { maximumFractionDigits: 3 });
/** "1.234,56" | "1234.56" | "1234,5" -> 1234.56 */
export function parseValor(s) {
  if (typeof s === "number") return s;
  let t = String(s ?? "").trim().replace(/[R$\s]/g, "");
  if (!t) return 0;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  const n = Number(t); return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
export const arred = n => Math.round((Number(n) || 0) * 100) / 100;
export const fmtKm = n => (n === null || n === undefined || n === "") ? "—" : Number(n).toLocaleString("pt-BR") + " km";
export const fmtDataHora = iso => iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
export const fmtData = d => { if (!d) return "—"; const x = typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + "T12:00:00") : new Date(d); return x.toLocaleDateString("pt-BR"); };
export const hojeISO = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
export const somaDias = (iso, n) => { const d = iso ? new Date(iso) : new Date(); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
export const numOS = n => "OS " + String(n ?? "").padStart(5, "0");
export const numRecibo = n => "Recibo " + String(n ?? "").padStart(5, "0");
export const endCompleto = c => c ? ([[c.rua, c.complemento].filter(Boolean).join(" "), c.bairro, [c.cidade, c.uf].filter(Boolean).join("/"), c.cep ? "CEP " + c.cep : ""].filter(Boolean).join(", ") || c.endereco || "") : "";
export function tempoDesde(iso) {
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (min < 60) return min + " min"; const hh = Math.floor(min / 60); if (hh < 24) return hh + " h"; const d = Math.floor(hh / 24); return d + (d === 1 ? " dia" : " dias");
}
export function lsGet(k) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
export function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

export function linkWhats(telefone, texto) {
  let t = soDig(telefone); if (t.length === 10 || t.length === 11) t = "55" + t;
  return "https://wa.me/" + t + "?text=" + encodeURIComponent(texto);
}

/** Reduz a imagem antes do envio (fotos de celular têm 3–8 MB) */
export async function reduzirImagem(file, max, formato = "image/jpeg", qualidade = 0.72) {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((ok, falha) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => falha(new Error("formato")); i.src = url; });
    const w = img.naturalWidth, hh = img.naturalHeight, esc = Math.min(1, max / Math.max(w, hh));
    const W = Math.max(1, Math.round(w * esc)), H = Math.max(1, Math.round(hh * esc));
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const ctx = c.getContext("2d");
    if (formato === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H); }
    ctx.drawImage(img, 0, 0, W, H);
    const blob = await new Promise(ok => c.toBlob(ok, formato, qualidade));
    if (!blob) throw new Error("conversao");
    return { blob, w: W, h: H };
  } finally { URL.revokeObjectURL(url); }
}

/** Valor total de um item (quantidade × valor unitário − desconto do item) */
export const totalItem = i => arred((Number(i.qtd) || 0) * (Number(i.valor_unit) || 0) - (Number(i.desconto) || 0));
/** Preço de venda de um produto na tabela escolhida (à vista, a prazo, atacado) */
export const precoTabela = (p, tabela) => Number(p[{ prazo: "preco_prazo", atacado: "preco_atacado" }[tabela] || "preco_vista"]) || Number(p.preco_vista) || 0;
export const precoPelaMargem = (custo, margem) => arred((Number(custo) || 0) * (1 + (Number(margem) || 0) / 100));
export const margemDoPreco = (custo, preco) => Number(custo) > 0 ? arred(((Number(preco) || 0) / Number(custo) - 1) * 100) : 0;

/** Valor por extenso em reais: 1234.5 -> "mil, duzentos e trinta e quatro reais e cinquenta centavos" */
export function extenso(valor) {
  const U = ["", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
  const D = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
  const C = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];
  const ate999 = n => {
    if (n === 100) return "cem";
    const c = Math.floor(n / 100), r = n % 100, partes = [];
    if (c) partes.push(C[c]);
    if (r) partes.push(r < 20 ? U[r] : D[Math.floor(r / 10)] + (r % 10 ? " e " + U[r % 10] : ""));
    return partes.join(" e ");
  };
  const inteiro = n => {
    if (n === 0) return "zero";
    const grupos = [], escalas = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
    let i = 0; while (n > 0) { grupos.push([n % 1000, i]); n = Math.floor(n / 1000); i++; }
    const ativos = grupos.filter(([g]) => g).reverse();
    return ativos.map(([g, e], k) => {
      let t = e === 1 && g === 1 ? "mil" : ate999(g) + (e ? " " + escalas[e][g === 1 ? 0 : 1] : "");
      if (k > 0) { const ultimo = k === ativos.length - 1; t = (ultimo && (g < 100 || g % 100 === 0) ? "e " : "") + t; }
      return t;
    }).join(" ").replace(/(mil|milhão|milhões|bilhão|bilhões) (?!e )/g, "$1, ");
  };
  const v = Math.round((Number(valor) || 0) * 100), r = Math.floor(v / 100), c = v % 100;
  const sr = r ? inteiro(r) + ((r % 1000000 === 0) ? " de" : "") + (r === 1 ? " real" : " reais") : "";
  const sc = c ? inteiro(c) + (c === 1 ? " centavo" : " centavos") : "";
  return sr && sc ? sr + " e " + sc : sr || sc || "zero reais";
}

/** Totais de uma O.S. a partir dos itens. aprovados=true considera só o que o cliente aprovou. */
export function totais(itens, desconto = 0, aprovados = false) {
  const t = { servicos: 0, pecas: 0, terceiros: 0, custoPecas: 0, custoTerceiros: 0, subtotal: 0, desconto: arred(desconto), total: 0, custo: 0, margem: 0, margemPct: 0, horas: 0 };
  for (const i of itens || []) {
    if (aprovados ? i.aprovado !== true : i.aprovado === false) continue;
    const v = totalItem(i);
    const c = arred((Number(i.qtd) || 0) * (Number(i.custo_unit) || 0));
    if (i.tipo === "servico") { t.servicos += v; t.horas += Number(i.horas) || 0; }
    else if (i.tipo === "peca") { t.pecas += v; t.custoPecas += c; }
    else { t.terceiros += v; t.custoTerceiros += c; }
  }
  t.subtotal = arred(t.servicos + t.pecas + t.terceiros);
  t.total = arred(Math.max(0, t.subtotal - t.desconto));
  t.custo = arred(t.custoPecas + t.custoTerceiros);
  t.margem = arred(t.total - t.custo);
  t.margemPct = t.total > 0 ? t.margem / t.total * 100 : 0;
  return t;
}
