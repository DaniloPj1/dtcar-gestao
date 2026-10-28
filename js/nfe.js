// Leitura do XML da NF-e (modelo 55, versão 4.00) e reconhecimento dos produtos já cadastrados
import { norm, soDig, arred } from "./util.js";

const tag = (el, nome) => el ? el.getElementsByTagNameNS("*", nome)[0] || null : null;
const txt = (el, nome) => { const t = tag(el, nome); return t ? t.textContent.trim() : ""; };
const num = (el, nome) => { const v = parseFloat(txt(el, nome)); return Number.isFinite(v) ? v : 0; };

/** Converte o texto do XML em { nota, fornecedor, itens }. Lança erro com mensagem clara se não for NF-e. */
export function lerNFe(xmlTexto) {
  const doc = new DOMParser().parseFromString(xmlTexto, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("O arquivo não é um XML válido.");
  const inf = tag(doc, "infNFe");
  if (!inf) throw new Error("Este XML não é uma NF-e (não encontrei o grupo infNFe). Use o XML da nota de compra que o fornecedor envia por e-mail.");
  const ide = tag(inf, "ide"), emit = tag(inf, "emit"), end = tag(emit, "enderEmit"), tot = tag(inf, "ICMSTot");
  const chave = (inf.getAttribute("Id") || "").replace(/^NFe/, "") || txt(tag(doc, "protNFe"), "chNFe");
  const nota = { chave: soDig(chave), numero: txt(ide, "nNF"), serie: txt(ide, "serie"), emissao: txt(ide, "dhEmi") || txt(ide, "dEmi"), valor_total: num(tot, "vNF"),
    modelo: txt(ide, "mod"), natureza: txt(ide, "natOp") };
  const fornecedor = { cnpj: soDig(txt(emit, "CNPJ") || txt(emit, "CPF")), razao: txt(emit, "xNome"), fantasia: txt(emit, "xFant"), ie: txt(emit, "IE"),
    telefone: soDig(txt(end, "fone")), endereco: [txt(end, "xLgr"), txt(end, "nro"), txt(end, "xCpl")].filter(Boolean).join(", "), bairro: txt(end, "xBairro"),
    cidade: txt(end, "xMun"), uf: txt(end, "UF"), cep: txt(end, "CEP") };
  const itens = [...inf.getElementsByTagNameNS("*", "det")].map(det => {
    const p = tag(det, "prod"), imp = tag(det, "imposto");
    const qtd = num(p, "qCom") || 1, vProd = num(p, "vProd");
    const vIPI = num(tag(imp, "IPI"), "vIPI"), vST = num(tag(imp, "ICMS"), "vICMSST");
    const extras = num(p, "vFrete") + num(p, "vSeg") + num(p, "vOutro") - num(p, "vDesc") + vIPI + vST;
    const ean = [txt(p, "cEAN"), txt(p, "cEANTrib")].find(e => /^\d{8,14}$/.test(e)) || "";
    return { n: +det.getAttribute("nItem") || 0, codigo: txt(p, "cProd"), ean, descricao_nf: txt(p, "xProd"), ncm: txt(p, "NCM"), cfop: txt(p, "CFOP"), unidade: txt(p, "uCom").toUpperCase(),
      qtd, valor_unit_nf: num(p, "vUnCom"), total_nf: vProd, extras: arred(extras), custo_unit: Math.round((vProd + extras) / qtd * 10000) / 10000 };
  });
  if (!itens.length) throw new Error("A nota não tem itens.");
  return { nota, fornecedor, itens };
}

/** Pontuação simples de semelhança entre descrições (palavras em comum) */
function semelhanca(a, b) {
  const pa = new Set(norm(a).split(/[^a-z0-9]+/).filter(x => x.length > 1)), pb = new Set(norm(b).split(/[^a-z0-9]+/).filter(x => x.length > 1));
  if (!pa.size || !pb.size) return 0;
  let c = 0; for (const x of pa) if (pb.has(x)) c++;
  return c / Math.min(pa.size, pb.size);
}
const chaveRef = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** Procura o produto de cada item: vínculo do fornecedor, código de barras, referência e descrição parecida. */
export function reconhecer(itens, { fornecedorId, produtos, vinculos }) {
  const ativos = produtos.filter(p => p.tipo === "produto");
  return itens.map(it => {
    const v = fornecedorId && vinculos.find(x => x.fornecedor_id === fornecedorId && x.codigo === it.codigo);
    if (v && ativos.some(p => p.id === v.produto_id)) return { ...it, acao: "vincular", produto_id: v.produto_id, fator: Number(v.fator) || 1, como: "vinculo" };
    const porEan = it.ean && ativos.find(p => p.codigo_barras === it.ean);
    if (porEan) return { ...it, acao: "vincular", produto_id: porEan.id, fator: 1, como: "ean" };
    const r = chaveRef(it.codigo);
    const porRef = r.length >= 3 && ativos.find(p => p.referencia && (chaveRef(p.referencia) === r || (r.length >= 4 && chaveRef(p.referencia).startsWith(r))));
    if (porRef) return { ...it, acao: "vincular", produto_id: porRef.id, fator: 1, como: "referencia" };
    const sugestoes = ativos.map(p => ({ p, s: semelhanca(it.descricao_nf, p.descricao) })).filter(x => x.s >= 0.6).sort((a, b) => b.s - a.s).slice(0, 3).map(x => x.p.id);
    return { ...it, acao: "novo", produto_id: null, fator: 1, como: sugestoes.length ? "parecido" : "nenhum", sugestoes };
  });
}

/** Link para ver a imagem do produto no Google Imagens */
export const linkImagem = (...partes) => "https://www.google.com/search?tbm=isch&q=" + encodeURIComponent(partes.filter(Boolean).join(" ").trim());
