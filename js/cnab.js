// Cobrança Sicredi por arquivo (CNAB240 híbrido: boleto + QR Code Pix).
// Segue o "Manual CNAB 240" do Sicredi, versão 3.0 (maio/2026), e o arquivo-modelo
// "COB Modelo CNAB240 híbrido" do Portal de Homologação. Este arquivo não fala com o
// banco nem com a tela: só monta e lê os arquivos e calcula os números do boleto.

/* ---------------------------------------------------------------- campos */
const SEM_ACENTO = s => String(s == null ? "" : s).normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Texto aceito pelo Sicredi: maiúsculas, sem acento, só os símbolos permitidos no manual (item 6.4). */
export const textoCnab = s => SEM_ACENTO(s).toUpperCase().replace(/Ç/g, "C").replace(/[^A-Z0-9 !*\-()[\]{},.;:/%+=]/g, " ").replace(/\s+/g, " ").trim();
const so = s => String(s == null ? "" : s).replace(/\D/g, "");
/** numérico: alinhado à direita com zeros */
export const N = (v, t) => { const d = so(v); if (d.length > t) throw new Error("Número maior que o campo (" + t + " posições): " + v); return d.padStart(t, "0"); };
/** alfanumérico: alinhado à esquerda com brancos (corta o excesso) */
export const A = (v, t) => textoCnab(v).slice(0, t).padEnd(t, " ");
const B = t => " ".repeat(t);
const Z = t => "0".repeat(t);
/** valor em reais → centavos sem vírgula */
export const V = (v, t) => N(Math.round(Number(v || 0) * 100), t);
const dataDDMMAAAA = iso => { const [a, m, d] = String(iso).slice(0, 10).split("-"); return d + m + a; };
const isoDeDDMMAAAA = s => /^\d{8}$/.test(s) && s !== "00000000" ? s.slice(4, 8) + "-" + s.slice(2, 4) + "-" + s.slice(0, 2) : null;
const somaDiasISO = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

function linha(partes, tipo) {
  const l = partes.join("");
  if (l.length !== 240) throw new Error("Registro " + tipo + " com " + l.length + " posições (deveria ter 240).");
  return l;
}

/* ---------------------------------------------------------- dígitos */
/** Módulo 11 do Sicredi (pesos 2 a 9 da direita para a esquerda; 10 ou 11 → 0). */
export function mod11(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { soma += Number(num[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const dv = 11 - (soma % 11);
  return dv > 9 ? 0 : dv;
}
/** DV geral do código de barras: 0, 10 ou 11 viram 1. */
export function mod11Barras(num) { const d = mod11(num); return d === 0 ? 1 : d; }
export function mod10(num) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { let p = Number(num[i]) * peso; if (p > 9) p = Math.floor(p / 10) + (p % 10); soma += p; peso = peso === 2 ? 1 : 2; }
  return (10 - (soma % 10)) % 10;
}

/**
 * Nosso Número (manual, item 4): AA/BXXXXX-D → 9 dígitos "AABXXXXXD".
 * AA = ano, B = byte de geração (2 a 9 quando o boleto é emitido pela empresa), XXXXX = sequencial.
 * DV pelo módulo 11 sobre cooperativa(4) + posto(2) + beneficiário(5) + AA + B + XXXXX.
 */
export function nossoNumero(cob, ano, seq) {
  const aa = N(ano % 100, 2), b = N(cob.byte || 2, 1), x = N(seq, 5);
  if (Number(b) < 2) throw new Error("O byte de geração do Nosso Número precisa ser de 2 a 9.");
  const base = N(cob.cooperativa, 4) + N(cob.posto, 2) + N(cob.beneficiario, 5) + aa + b + x;
  return aa + b + x + mod11(base);
}
/** "262000016" → "26/200001-6" */
export const nossoNumeroFmt = nn => nn && nn.length === 9 ? nn.slice(0, 2) + "/" + nn.slice(2, 8) + "-" + nn[8] : nn || "";

/** Fator de vencimento: dias desde 07/10/1997; a partir de 22/02/2025 recomeça em 1000 (manual, item 10.7). */
export function fatorVencimento(iso) {
  const dia = 86400000, v = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  const virada = Date.UTC(2025, 1, 22);
  if (v >= virada) return 1000 + Math.round((v - virada) / dia);
  return Math.round((v - Date.UTC(1997, 9, 7)) / dia);
}

/** Campo livre (25 posições, manual item 10.3). */
export function campoLivre(cob, nn, valor) {
  const s = "1" + "1" + N(nn, 9) + N(cob.cooperativa, 4) + N(cob.posto, 2) + N(cob.beneficiario, 5) + (Number(valor) > 0 ? "1" : "0") + "0";
  return s + mod11(s);
}
/** Código de barras (44) e linha digitável (47). */
export function codigoBarras(cob, nn, valor, vencimento) {
  const livre = campoLivre(cob, nn, valor);
  const semDv = "748" + "9" + N(fatorVencimento(vencimento), 4) + V(valor, 10) + livre;
  const dv = mod11Barras(semDv);
  return semDv.slice(0, 4) + dv + semDv.slice(4);
}
export function linhaDigitavel(barras) {
  const c1 = barras.slice(0, 4) + barras.slice(19, 24), c2 = barras.slice(24, 34), c3 = barras.slice(34, 44);
  return c1 + mod10(c1) + c2 + mod10(c2) + c3 + mod10(c3) + barras[4] + barras.slice(5, 19);
}
/** "74891.10727 00003.101656 02006.231019 1 37260000015035" */
export function linhaFmt(l) {
  if (!l || l.length !== 47) return l || "";
  return l.slice(0, 5) + "." + l.slice(5, 10) + " " + l.slice(10, 15) + "." + l.slice(15, 21) + " " + l.slice(21, 26) + "." + l.slice(26, 32) + " " + l[32] + " " + l.slice(33);
}

/* ------------------------------------------------------- Pix copia e cola */
export function crc16(s) {
  let crc = 0xffff;
  for (const ch of new TextEncoder().encode(s)) {
    crc ^= ch << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}
const tlv = (id, v) => id + String(v.length).padStart(2, "0") + v;
/** Código "copia e cola" do QR Code dinâmico a partir da URL (location) que vem no retorno (manual, item 12). */
export function pixCopiaCola(url, nome = "PIX", cidade = "COLATINA") {
  const loc = String(url || "").trim().replace(/^https?:\/\//i, "");
  if (!loc) return "";
  const conta = tlv("00", "br.gov.bcb.pix") + tlv("25", loc);
  const nm = textoCnab(nome).replace(/[^A-Z0-9 ]/g, "").slice(0, 25) || "PIX", cd = textoCnab(cidade).replace(/[^A-Z0-9 ]/g, "").slice(0, 15) || "CIDADE";
  const corpo = tlv("00", "01") + tlv("01", "12") + tlv("26", conta) + tlv("52", "0000") + tlv("53", "986") + tlv("58", "BR") + tlv("59", nm) + tlv("60", cd) + tlv("62", tlv("05", "***")) + "6304";
  return corpo + crc16(corpo);
}

/* ------------------------------------------------------------ remessa */
/** Chave Pix aleatória como o banco entregou (minúsculas e hífens, como no arquivo-modelo). */
const chavePix = c => { const k = String(c || "").trim(); if (!/^[0-9a-fA-F-]{32,36}$/.test(k)) throw new Error("A chave Pix precisa ser a chave aleatória (formato 1a2b3c4d-…)."); return k.toLowerCase().padEnd(77, " "); };
/**
 * Confere a configuração da carteira de cobrança. Devolve a lista de problemas ("" = ok).
 * cob = { cooperativa, posto, beneficiario, conta, contaDv, cnpj, nome, byte, chavePix, jurosMes, multa, especie }
 */
export function conferirCarteira(cob) {
  const e = [];
  if (!cob) return ["Preencha os dados da carteira de cobrança."];
  if (so(cob.cooperativa).length < 1 || so(cob.cooperativa).length > 4) e.push("Cooperativa (agência) com até 4 dígitos.");
  if (so(cob.posto).length < 1 || so(cob.posto).length > 2) e.push("Posto com até 2 dígitos.");
  if (so(cob.beneficiario).length < 1 || so(cob.beneficiario).length > 5) e.push("Código do beneficiário com até 5 dígitos.");
  if (!so(cob.conta) || so(cob.conta).length > 12) e.push("Número da conta corrente.");
  if (so(cob.contaDv).length !== 1) e.push("Dígito da conta corrente.");
  if (![11, 14].includes(so(cob.cnpj).length)) e.push("CNPJ da empresa.");
  if (!textoCnab(cob.nome)) e.push("Nome da empresa.");
  if (!(Number(cob.byte) >= 2 && Number(cob.byte) <= 9)) e.push("Byte de geração do Nosso Número (2 a 9).");
  if (!String(cob.chavePix || "").trim()) e.push("Chave Pix aleatória da conta Sicredi (obrigatória no boleto com QR Code).");
  return e;
}

/** Confere um boleto antes de entrar na remessa. Devolve a lista de problemas. */
export function conferirBoleto(b, hoje) {
  const e = [], p = b.pagador || {};
  if (!(Number(b.valor) > 0)) e.push("valor");
  if (!b.vencimento) e.push("vencimento");
  else if (hoje && b.vencimento < hoje) e.push("vencimento já passou");
  if (![11, 14].includes(so(p.doc).length)) e.push("CPF/CNPJ do cliente");
  if (!textoCnab(p.nome)) e.push("nome do cliente");
  if (!textoCnab(p.endereco)) e.push("endereço do cliente");
  if (so(p.cep).length !== 8) e.push("CEP do cliente");
  if (!textoCnab(p.cidade)) e.push("cidade do cliente");
  if (!/^[A-Z]{2}$/.test(textoCnab(p.uf))) e.push("UF do cliente");
  if (!/^\d{9}$/.test(b.nosso_numero || "")) e.push("Nosso Número");
  return e;
}

/**
 * Monta o arquivo de remessa (texto com CRLF).
 * boletos: [{ movimento: "01" entrada | "02" pedido de baixa, nosso_numero, seu_numero, vencimento, valor, emissao, uso_empresa, pagador: {...} }]
 * opcoes: { sequencia, data (Date), especie }
 */
export function montarRemessa(cob, boletos, opcoes) {
  const erros = conferirCarteira(cob);
  if (erros.length) throw new Error("Carteira de cobrança incompleta: " + erros.join(" "));
  if (!boletos.length) throw new Error("Nenhum boleto para a remessa.");
  const quando = opcoes.data || new Date(), seq = Number(opcoes.sequencia);
  if (!(seq >= 1)) throw new Error("Número da remessa inválido.");
  const dd = String(quando.getDate()).padStart(2, "0") + String(quando.getMonth() + 1).padStart(2, "0") + quando.getFullYear();
  const hh = [quando.getHours(), quando.getMinutes(), quando.getSeconds()].map(x => String(x).padStart(2, "0")).join("");
  const cnpj = so(cob.cnpj), tipo = cnpj.length === 14 ? "2" : "1";
  const ag = N(cob.cooperativa, 5), conta = N(cob.conta, 12), dvc = N(cob.contaDv, 1), nome = A(cob.nome, 30);
  const L = [];
  // Header do arquivo (8.2)
  L.push(linha(["748", "0000", "0", B(9), tipo, N(cnpj, 14), B(20), ag, B(1), conta, dvc, B(1), nome, A("SICREDI", 30), B(10), "1", dd, hh, N(seq, 6), "081", "01600", B(69)], "header do arquivo"));
  // Header do lote (8.3)
  L.push(linha(["748", "0001", "1", "R", "01", B(2), "040", B(1), tipo, N(cnpj, 15), B(20), ag, B(1), conta, dvc, B(1), nome, B(40), B(40), N(seq, 8), dd, Z(8), B(33)], "header do lote"));
  let reg = 0;
  const det = (seg, corpo) => { reg++; return linha(["748", "0001", "3", N(reg, 5), seg, B(1), ...corpo], "segmento " + seg); };
  const juros = Number(cob.jurosMes || 0), multa = Number(cob.multa || 0);
  for (const b of boletos) {
    const mov = b.movimento || "01", p = b.pagador || {};
    if (mov === "01") { const pr = conferirBoleto(b); if (pr.length) throw new Error("Boleto " + nossoNumeroFmt(b.nosso_numero) + ": falta " + pr.join(", ") + "."); }
    const doc = so(p.doc), venc = b.vencimento, mais1 = venc ? dataDDMMAAAA(somaDiasISO(venc, 1)) : Z(8);
    // Segmento P (8.4)
    L.push(det("P", [mov, ag, B(1), conta, dvc, B(1), A(N(b.nosso_numero, 9), 20), "1", "1", "1", "2", "2",
      A(String(b.seu_numero || "").replace(/\s/g, ""), 15), venc ? dataDDMMAAAA(venc) : Z(8), V(b.valor, 15), Z(5), B(1), N(opcoes.especie || cob.especie || "03", 2), "N",
      dataDDMMAAAA(b.emissao), juros > 0 ? "2" : "3", juros > 0 ? mais1 : Z(8), juros > 0 ? V(juros, 15) : Z(15),
      "0", Z(8), Z(15), Z(15), Z(15), A(b.uso_empresa || "", 25), "3", "00", "1", "000", "09", Z(10), B(1)]));
    // Segmento Q (8.5)
    L.push(det("Q", [mov, doc.length === 14 ? "2" : "1", N(doc, 15), A(p.nome, 40), A(p.endereco, 40), A(p.bairro, 15), N(so(p.cep) || 0, 8), A(p.cidade, 15), A(p.uf, 2),
      "0", Z(15), B(40), "000", B(20), B(8)]));
    // Segmento R (8.6): multa a partir do dia seguinte ao vencimento (data posterior tiraria o QR Code)
    L.push(det("R", [mov, "0", Z(8), Z(15), "0", Z(8), Z(15), multa > 0 ? "2" : "0", multa > 0 ? mais1 : Z(8), multa > 0 ? V(multa, 15) : Z(15),
      B(110), Z(8), "000", Z(5), B(1), Z(12), "0", B(1), "0", B(9)]));
    // Segmento Y04 (8.9): obrigatório no boleto híbrido, só na entrada
    if (mov === "01") L.push(det("Y", ["01", "04", B(50), B(2), B(9), B(1), chavePix(cob.chavePix), B(35), B(47)]));
  }
  // Trailer do lote (8.10): header do lote + detalhes + trailer
  L.push(linha(["748", "0001", "5", B(9), N(reg + 2, 6), Z(6), Z(17), Z(6), Z(17), Z(6), Z(17), Z(6), Z(17), B(8), B(117)], "trailer do lote"));
  // Trailer do arquivo (8.11): total de linhas
  L.push(linha(["748", "9999", "9", B(9), "000001", N(L.length + 1, 6), "000000", B(205)], "trailer do arquivo"));
  return L.join("\r\n") + "\r\n";
}

/** Nome do arquivo de remessa: CCCCCMDD.XXX (manual, item 6.1). */
export function nomeRemessa(cob, data, numeroNoDia) {
  const mes = "123456789OND"[data.getMonth()];
  return N(cob.beneficiario, 5) + mes + String(data.getDate()).padStart(2, "0") + "." + String(numeroNoDia || 1).padStart(3, "0");
}

/* ------------------------------------------------------------ retorno */
export const MOVIMENTOS = {
  "02": "Entrada confirmada", "03": "Entrada rejeitada", "06": "Liquidação", "07": "Desconto confirmado", "08": "Cancelamento de desconto confirmado",
  "09": "Baixa", "12": "Abatimento confirmado", "13": "Cancelamento de abatimento confirmado", "14": "Alteração de vencimento confirmada",
  "17": "Liquidação após baixa", "19": "Protesto confirmado", "20": "Sustação de protesto confirmada", "23": "Remessa a cartório", "24": "Retirada de cartório",
  "26": "Instrução rejeitada", "27": "Alteração de dados confirmada", "28": "Débito de tarifas", "30": "Alteração de dados rejeitada", "36": "Baixa rejeitada",
  "51": "Título DDA reconhecido pelo pagador", "52": "Título DDA não reconhecido pelo pagador", "61": "Liquidação Pix", "91": "Intenção de pagamento",
  P1: "Confirmado com QR Code", P2: "Confirmado sem QR Code", P3: "Chave Pix inválida", P6: "TXID em duplicidade ou inválido"
};
export const REJEICOES = {
  "01": "Código do banco inválido", "02": "Código do registro inválido", "03": "Código do segmento inválido", "04": "Movimento não permitido para a carteira", "05": "Movimento inválido",
  "06": "CPF/CNPJ do beneficiário inválido", "07": "Cooperativa/conta inválida", "08": "Nosso Número inválido", "09": "Nosso Número duplicado", "10": "Carteira inválida",
  "11": "Forma de cadastramento inválida", "12": "Tipo de documento inválido", "13": "Emissão do boleto inválida", "14": "Distribuição do boleto inválida", "15": "Características da cobrança incompatíveis",
  "16": "Vencimento inválido", "17": "Vencimento anterior à emissão", "18": "Vencimento fora do prazo", "20": "Valor inválido", "21": "Espécie inválida", "22": "Espécie não permitida",
  "23": "Aceite inválido", "24": "Data de emissão inválida", "25": "Emissão posterior à entrada", "26": "Código de juros inválido", "27": "Juros inválidos", "28": "Código do desconto inválido",
  "29": "Desconto maior ou igual ao valor", "33": "Abatimento inválido", "34": "Abatimento maior ou igual ao valor", "37": "Código de protesto inválido", "38": "Prazo de protesto inválido",
  "44": "Moeda inválida", "45": "Nome do pagador não informado", "46": "CPF/CNPJ do pagador inválido", "47": "Endereço do pagador não informado", "48": "CEP inválido",
  "57": "Código da multa inválido", "58": "Data da multa inválida", "59": "Multa inválida", "60": "Movimento para título não cadastrado", "61": "Liquidação Pix", "62": "Tipo de impressão inválido",
  "63": "Entrada para título já cadastrado", "79": "Data de juros inválida", "86": "Seu Número inválido", A4: "Pagador DDA", CZ: "Instrução inválida"
};
const LIQUIDACAO = ["06", "17", "61"];
export const ehLiquidacao = mov => LIQUIDACAO.includes(mov);
const dinheiro = s => Number(so(s) || 0) / 100;
const motivos = (mov, s) => { const c = (s || "").trim().match(/.{1,2}/g) || []; return c.filter(x => x && x !== "00").map(x => (["02", "03", "26", "30"].includes(mov) ? REJEICOES[x] : null) || x); };

/**
 * Lê o arquivo de retorno (.CRT). Devolve { cabecalho, titulos: [...], avisos: [...] }.
 * Cada título: { nosso_numero, movimento, descricao, motivos, vencimento, valor, uso_empresa, seu_numero, tarifa,
 *                acrescimos, desconto, abatimento, valor_pago, valor_liquido, data_ocorrencia, data_credito, qr_url, txid }
 */
export function lerRetorno(texto) {
  const linhas = String(texto || "").split(/\r?\n/).map(l => l.replace(/\s+$/, "")).filter(l => l.length);
  if (!linhas.length) throw new Error("Arquivo vazio.");
  const h = linhas[0].padEnd(240, " ");
  if (h.slice(0, 3) !== "748" || h[7] !== "0") throw new Error("Este não é um arquivo do Sicredi (o cabeçalho não começa com 748).");
  if (h[142] !== "2") throw new Error("Este arquivo é de remessa, não de retorno.");
  const cab = { cnpj: h.slice(18, 32).trim(), conta: h.slice(58, 70), data: isoDeDDMMAAAA(h.slice(143, 151)), hora: h.slice(151, 157), sequencia: Number(h.slice(157, 163)) || 0 };
  const titulos = [], avisos = [];
  let atual = null;
  for (const bruta of linhas.slice(1)) {
    const l = bruta.padEnd(240, " ");
    if (l[7] !== "3") continue;
    const seg = l[13], mov = l.slice(15, 17);
    if (seg === "T") {
      atual = { nosso_numero: so(l.slice(37, 46)), movimento: mov, descricao: MOVIMENTOS[mov] || "Movimento " + mov, seu_numero: l.slice(58, 73).trim(),
        vencimento: isoDeDDMMAAAA(l.slice(73, 81)), valor: dinheiro(l.slice(81, 96)), uso_empresa: l.slice(105, 130).trim(),
        pagador_doc: so(l.slice(133, 148)), pagador_nome: l.slice(148, 188).trim(), tarifa: dinheiro(l.slice(198, 213)), motivos: motivos(mov, l.slice(213, 223)) };
      titulos.push(atual);
    } else if (seg === "U" && atual) {
      Object.assign(atual, { acrescimos: dinheiro(l.slice(17, 32)), desconto: dinheiro(l.slice(32, 47)), abatimento: dinheiro(l.slice(47, 62)),
        valor_pago: dinheiro(l.slice(77, 92)), valor_liquido: dinheiro(l.slice(92, 107)), data_ocorrencia: isoDeDDMMAAAA(l.slice(137, 145)), data_credito: isoDeDDMMAAAA(l.slice(145, 153)) });
    } else if (seg === "Y" && atual && l.slice(17, 19) === "03") {
      const url = l.slice(81, 158).trim(), txid = l.slice(158, 193).trim();
      if (url) atual.qr_url = url;
      if (txid) atual.txid = txid;
      if (["P1", "P2", "P3", "P6"].includes(mov)) atual.qr_situacao = MOVIMENTOS[mov];
    } else if (seg !== "U" && seg !== "Y") avisos.push("Segmento " + seg + " ignorado.");
  }
  return { cabecalho: cab, titulos, avisos };
}

/* ------------------------------------------------------ código de barras I25 */
const I25 = ["00110", "10001", "01001", "11000", "00101", "10100", "01100", "00011", "10010", "01010"];
/** Barras do "2 de 5 intercalado": lista de larguras alternando barra/espaço (1 = estreita, 3 = larga). */
export function barrasI25(num) {
  if (num.length % 2) num = "0" + num;
  const r = [1, 1, 1, 1]; // início: barra, espaço, barra, espaço estreitos
  for (let i = 0; i < num.length; i += 2) {
    const a = I25[+num[i]], b = I25[+num[i + 1]];
    for (let k = 0; k < 5; k++) { r.push(a[k] === "1" ? 3 : 1); r.push(b[k] === "1" ? 3 : 1); }
  }
  r.push(3, 1, 1); // fim: barra larga, espaço, barra
  return r;
}
