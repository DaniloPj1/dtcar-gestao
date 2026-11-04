// DTCar Gestão — leitura de boletos e notas que chegam por e-mail (função "email").
// Funções puras: acham a linha digitável (com conferência dos dígitos, banco, valor e vencimento) e resumem o XML da NF-e.
// Servem à conferência de boletos (Fase 4 do agente). Nada aqui grava nada.

const BANCOS: Record<string, string> = {
  "001": "Banco do Brasil", "033": "Santander", "041": "Banrisul", "070": "BRB", "077": "Inter", "104": "Caixa", "136": "Unicred",
  "197": "Stone", "208": "BTG Pactual", "212": "Original", "237": "Bradesco", "260": "Nubank", "290": "PagBank", "323": "Mercado Pago",
  "336": "C6 Bank", "341": "Itaú", "380": "PicPay", "403": "Cora", "422": "Safra", "655": "Votorantim", "748": "Sicredi", "756": "Sicoob",
};

const digitos = (s: string) => s.replace(/\D/g, "");

/** dígito do módulo 10 (campos da linha digitável) */
export function mod10(n: string): number {
  let soma = 0, peso = 2;
  for (let i = n.length - 1; i >= 0; i--) {
    let p = Number(n[i]) * peso;
    if (p > 9) p = Math.floor(p / 10) + (p % 10);
    soma += p; peso = peso === 2 ? 1 : 2;
  }
  return (10 - (soma % 10)) % 10;
}

/** dígito geral do código de barras (módulo 11, pesos 2 a 9; 0, 10 e 11 viram 1) */
export function mod11Boleto(n: string): number {
  let soma = 0, peso = 2;
  for (let i = n.length - 1; i >= 0; i--) { soma += Number(n[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const d = 11 - (soma % 11);
  return d === 0 || d === 10 || d === 11 ? 1 : d;
}

/** Vencimento pelo fator (FEBRABAN): o fator 9999 foi 21/02/2025 e voltou a 1000 em 22/02/2025. */
export function vencimentoDoFator(fator: number, hoje = new Date()): string | null {
  if (!fator) return null; // boleto sem vencimento
  const dia = (base: string, n: number) => { const d = new Date(base + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d; };
  const antigo = dia("1997-10-07", fator), novo = dia("2025-02-22", fator - 1000);
  // fica com a data mais perto de hoje (boletos de antes de 2025 ainda aparecem em e-mails antigos)
  const d = Math.abs(novo.getTime() - hoje.getTime()) <= Math.abs(antigo.getTime() - hoje.getTime()) ? novo : antigo;
  return d.toISOString().slice(0, 10);
}

export interface Boleto { linha: string; tipo: "bancario" | "arrecadacao"; banco?: string; banco_nome?: string; valor?: number; vencimento?: string | null; digitos_ok: boolean; codigo_barras?: string }

/** Confere uma linha digitável de boleto bancário (47 números). */
export function lerLinhaBancaria(l: string, hoje = new Date()): Boleto {
  const d = digitos(l);
  const c1 = d.slice(0, 9), c2 = d.slice(10, 20), c3 = d.slice(21, 31);
  const camposOk = mod10(c1) === Number(d[9]) && mod10(c2) === Number(d[20]) && mod10(c3) === Number(d[31]);
  const barras = d.slice(0, 4) + d[32] + d.slice(33, 47) + c1.slice(4) + c2 + c3; // 44 números
  const geralOk = mod11Boleto(barras.slice(0, 4) + barras.slice(5)) === Number(d[32]);
  const banco = d.slice(0, 3);
  return { linha: d, tipo: "bancario", banco, banco_nome: BANCOS[banco], valor: Number(d.slice(37, 47)) / 100,
    vencimento: vencimentoDoFator(Number(d.slice(33, 37)), hoje), digitos_ok: camposOk && geralOk, codigo_barras: barras };
}

/** Confere uma linha de arrecadação (contas de consumo, tributos: 48 números, começa com 8). */
export function lerLinhaArrecadacao(l: string): Boleto {
  const d = digitos(l);
  const blocos = [0, 12, 24, 36].map((i) => d.slice(i, i + 12));
  const moeda = d[2]; // 6 ou 7: módulo 10; 8 ou 9: módulo 11
  const dv = (b: string) => (moeda === "6" || moeda === "7") ? mod10(b) : (() => {
    let soma = 0, peso = 2; for (let i = b.length - 1; i >= 0; i--) { soma += Number(b[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
    const r = soma % 11; return r === 0 || r === 1 ? 0 : 11 - r; })();
  const barras = blocos.map((b) => b.slice(0, 11)).join("");
  // dígitos de cada bloco e o dígito geral (4ª posição do código de barras, calculado sem ela)
  const ok = blocos.every((b) => dv(b.slice(0, 11)) === Number(b[11])) && dv(barras.slice(0, 3) + barras.slice(4)) === Number(barras[3]);
  const valorEfetivo = moeda === "6" || moeda === "8";
  return { linha: d, tipo: "arrecadacao", valor: valorEfetivo ? Number(barras.slice(4, 15)) / 100 : undefined, digitos_ok: ok, codigo_barras: barras };
}

/** Acha linhas digitáveis num texto (corpo do e-mail ou PDF do boleto). */
export function acharBoletos(texto: string, hoje = new Date()): Boleto[] {
  const achados = new Map<string, Boleto>();
  const t = String(texto || "");
  // bancário: 5.5 5.6 5.6 1 14 (com ou sem pontos e espaços)
  for (const m of t.matchAll(/\b\d{5}[.\s]?\d{5}\s*\d{5}[.\s]?\d{6}\s*\d{5}[.\s]?\d{6}\s*\d\s*\d{14}\b/g)) {
    const d = digitos(m[0]); if (d.length === 47 && !achados.has(d)) achados.set(d, lerLinhaBancaria(d, hoje));
  }
  // arrecadação: 4 blocos de 11 + dígito (começa com 8)
  for (const m of t.matchAll(/\b8\d{10}[-\s]?\d\s*\d{11}[-\s]?\d\s*\d{11}[-\s]?\d\s*\d{11}[-\s]?\d\b/g)) {
    const d = digitos(m[0]); if (d.length === 48 && !achados.has(d)) achados.set(d, lerLinhaArrecadacao(d));
  }
  return [...achados.values()];
}

/** Chaves de acesso de NF-e (44 números) citadas num texto. */
export function acharChavesNFe(texto: string): string[] {
  const s = new Set<string>();
  for (const m of String(texto || "").matchAll(/\b(\d{4}\s?){10}\d{4}\b/g)) {
    const d = digitos(m[0]);
    if (d.length === 44 && /^(1[1-7]|2[1-9]|3[1-5]|4[1-3]|5[0-3])/.test(d) && (d.slice(20, 22) === "55" || d.slice(20, 22) === "65")) s.add(d);
  }
  return [...s];
}

const tag = (xml: string, nome: string) => (xml.match(new RegExp("<(?:\\w+:)?" + nome + "[^>]*>([^<]*)</(?:\\w+:)?" + nome + ">")) || [])[1]?.trim();
const bloco = (xml: string, nome: string) => (xml.match(new RegExp("<(?:\\w+:)?" + nome + "[\\s>][\\s\\S]*?</(?:\\w+:)?" + nome + ">")) || [])[0] || "";

export interface ResumoNFe { chave?: string; numero?: string; serie?: string; emissao?: string; emitente?: { cnpj?: string; nome?: string }; destinatario?: { cnpj?: string; nome?: string };
  valor?: number; itens: number; duplicatas: Array<{ numero?: string; vencimento?: string; valor?: number }>; cancelamento?: boolean }

/** Resumo de um XML de NF-e (nota, nota processada ou evento). null se não for NF-e. */
export function resumirNFe(xml: string): ResumoNFe | null {
  if (!/<(?:\w+:)?infNFe\b/.test(xml)) {
    if (/<(?:\w+:)?infEvento\b/.test(xml) && /110111/.test(xml)) return { chave: tag(xml, "chNFe"), itens: 0, duplicatas: [], cancelamento: true };
    return null;
  }
  const emit = bloco(xml, "emit"), dest = bloco(xml, "dest"), ide = bloco(xml, "ide"), total = bloco(xml, "ICMSTot");
  const id = (xml.match(/<(?:\w+:)?infNFe[^>]*\bId="NFe(\d{44})"/) || [])[1];
  const num = (v?: string) => v === undefined || v === "" ? undefined : Number(v);
  return {
    chave: id || tag(xml, "chNFe"), numero: tag(ide, "nNF"), serie: tag(ide, "serie"), emissao: (tag(ide, "dhEmi") || tag(ide, "dEmi") || "").slice(0, 10) || undefined,
    emitente: { cnpj: tag(emit, "CNPJ") || tag(emit, "CPF"), nome: tag(emit, "xFant") || tag(emit, "xNome") },
    destinatario: { cnpj: tag(dest, "CNPJ") || tag(dest, "CPF"), nome: tag(dest, "xNome") },
    valor: num(tag(total, "vNF")),
    itens: (xml.match(/<(?:\w+:)?det\s+nItem=/g) || []).length,
    duplicatas: [...xml.matchAll(/<(?:\w+:)?dup>([\s\S]*?)<\/(?:\w+:)?dup>/g)].map((m) => ({ numero: tag(m[1], "nDup"), vencimento: tag(m[1], "dVenc"), valor: num(tag(m[1], "vDup")) })),
  };
}
