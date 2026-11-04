// Contas do boleto Sicredi e do arquivo CNAB240 (js/cnab.js e js/qr.js), sem navegador.
// Uso: node teste/teste_cnab.mjs
// Referências: "Manual CNAB 240" do Sicredi v3.0 (maio/2026) e o arquivo-modelo "COB Modelo CNAB240 híbrido"
// do Portal de Homologação (teste/cnab_modelo_sicredi.crm).
import fs from "fs";
import * as c from "../js/cnab.js";
import { qrMatriz } from "../js/qr.js";
const ok = [], falhas = [];
const chk = (n, v) => (v ? ok : falhas).push(n);
const dir = new URL(".", import.meta.url).pathname;

// manual, itens 4.5 e 10.4 (cooperativa 0165, posto 02, beneficiário 00623, ano 07, byte 2, sequencial 00003)
const ex = { cooperativa: "0165", posto: "02", beneficiario: "00623", byte: 2 };
chk("nosso número do exemplo do manual (07/200003-1)", c.nossoNumero(ex, 2007, 3) === "072000031");
chk("DV do campo livre do exemplo do manual = 8", c.campoLivre(ex, "072000031", 150.35).endsWith("108"));
chk("fator de vencimento 20/12/2007 = 3726", c.fatorVencimento("2007-12-20") === 3726);
chk("fator recomeça em 1000 em 22/02/2025", c.fatorVencimento("2025-02-22") === 1000 && c.fatorVencimento("2025-02-24") === 1002);
chk("CRC do Pix copia e cola do manual = 8A39", c.crc16("00020126910014br.gov.bcb.pix2569pix-qrcode.sicredi.com.br/qr/v2/cobv/c1f7e23631cd49c8be2ec56551f129775204000053039865802BR5903PIX6006Cidade62070503***6304") === "8A39");
// boleto da DTCar: o leitor de boletos do sistema (js/boleto.js) confere os dígitos
const cob = { cooperativa: "0523", posto: "16", beneficiario: "85453", conta: "85453", contaDv: "7", cnpj: "49016409000195", nome: "DTCAR CENTRO AUTOMOTIVO LTDA", byte: 2, chavePix: "093a8b6a-6e9d-4ed1-922a-ebb1c4452963", jurosMes: 2, multa: 2 };
const nn = c.nossoNumero(cob, 2026, 1), cb = c.codigoBarras(cob, nn, 1234.56, "2026-12-10"), ld = c.linhaDigitavel(cb);
const { lerBoleto } = await import("../js/boleto.js");
const lido = lerBoleto(ld);
chk("linha digitável aceita pelo leitor do sistema", lido.ok && lido.valor === 1234.56 && lido.vencimento === "2026-12-10" && lido.banco === "748" && lido.codigo_barras === cb);
chk("código de barras com 44 dígitos e campo livre do Sicredi", cb.length === 44 && cb.slice(19, 21) === "11" && cb.slice(21, 30) === nn && cb.slice(30, 41) === "05231685453");
chk("linha formatada", c.linhaFmt(ld).split(" ").length === 5);
chk("I25: 44 dígitos → 4 + 22×10 + 3 barras/espaços", c.barrasI25(cb).length === 4 + 220 + 3);

// remessa comparada com o arquivo-modelo do Sicredi (diferenças esperadas: o modelo é anterior ao manual 3.0)
const modelo = fs.readFileSync(dir + "cnab_modelo_sicredi.crm", "utf8").split(/\r?\n/).filter(Boolean).filter(l => l[13] !== "S");
const cm = { ...cob, cooperativa: "9999", conta: "24302", contaDv: "7", cnpj: "39000386000177", nome: "MODELO TESTE", chavePix: "ac5b44b6-b343-4e48-a37c-190aef7e5348", jurosMes: 0, multa: 2 };
const rem = c.montarRemessa(cm, [{ nosso_numero: "212000016", seu_numero: "72895683840351", vencimento: "2021-12-10", valor: 10, emissao: "2021-11-05",
  pagador: { doc: "49093094033", nome: "TESTES", endereco: "RUA ANTONIO TESTES, 001", bairro: "JARDIM ITALIA", cep: "86990000", cidade: "MARIALVA", uf: "PR" } }], { sequencia: 1, data: new Date(2021, 10, 5, 17, 57, 28) });
const g = rem.split("\r\n").filter(Boolean);
const dif = (a, b) => { const d = []; for (let k = 0; k < 240; k++) if (a[k] !== b[k]) d.push(k + 1); return d; };
const esperadas = [
  [103, 104, 105, 106, 107, 108, 109],          // header: literal "SICREDI" (manual 3.0); o modelo deixa em branco
  [],                                           // header do lote igual
  [118, 119, 120, 121, 122, 123, 125, 126, 141, 226], // P: juros isentos (o modelo usa R$ 0,03 ao dia) e dias para baixa "000" (manual)
  [],                                           // Q igual
  [67, 68, 69, 70, 71, 73, 74],                 // R: data da multa = vencimento + 1 (o modelo deixa zerada; o banco assume a mesma data)
  [13],                                         // Y: número do registro (o modelo tem o segmento S de mensagem antes)
  [23],                                         // trailer do lote: quantidade (sem o S)
  [29]];                                        // trailer do arquivo: quantidade (sem o S)
chk("remessa: 8 linhas de 240 posições com CRLF", g.length === 8 && g.every(l => l.length === 240) && rem.endsWith("\r\n"));
g.forEach((l, i) => chk("remessa x modelo, linha " + (i + 1) + " (" + l.slice(0, 14).trim() + ")", JSON.stringify(dif(l, modelo[i])) === JSON.stringify(esperadas[i])));
// conferências
chk("carteira sem chave Pix é recusada", c.conferirCarteira({ ...cob, chavePix: "" }).length === 1);
chk("cliente sem CEP é recusado", c.conferirBoleto({ valor: 1, vencimento: "2030-01-01", nosso_numero: nn, pagador: { doc: "52998224725", nome: "A", endereco: "B", cidade: "C", uf: "ES" } }).includes("CEP do cliente"));
let erro = ""; try { c.montarRemessa({ ...cob, chavePix: "minha-chave@email.com" }, [{ nosso_numero: nn, vencimento: "2030-01-01", valor: 1, emissao: "2026-11-03", pagador: { doc: "52998224725", nome: "A", endereco: "B", cep: "29700000", cidade: "C", uf: "ES" } }], { sequencia: 1 }); } catch (e) { erro = e.message; }
chk("chave Pix que não é aleatória é recusada", /aleatória/.test(erro));
chk("texto sem acento e em maiúsculas", c.textoCnab("São Silvano, ação nº 5 ç") === "SAO SILVANO, ACAO N 5 C");
chk("nome do arquivo CCCCCMDD.XXX (outubro = O)", c.nomeRemessa(cob, new Date(2026, 9, 5), 2) === "85453O05.002");

// retorno: registro com QR, liquidação Pix e rejeição
const reg = campos => { const l = Array(240).fill(" "); for (const [i, t] of Object.entries(campos)) [...t].forEach((ch, k) => { l[+i - 1 + k] = ch; }); return l.join(""); };
const ret = [reg({ 1: "74800000", 18: "2", 19: "49016409000195", 143: "2", 144: "04112026", 158: "000003", 164: "081" }), reg({ 1: "74800011T01" }),
  reg({ 1: "7480001300001T", 16: "02", 38: nn, 74: "10122026", 82: "000000000123456" }), reg({ 1: "7480001300002U", 16: "02" }),
  reg({ 1: "7480001300003Y", 16: "P1", 18: "03", 82: "pix-qrcode.sicredi.com.br/qr/v2/cobv/abc", 159: "TX123" }),
  reg({ 1: "7480001300004T", 16: "61", 38: "262000027", 82: "000000000010000" }), reg({ 1: "7480001300005U", 16: "61", 78: "000000000010200", 93: "000000000010050", 138: "06112026", 146: "07112026" }),
  reg({ 1: "7480001300006T", 16: "03", 38: "262000035", 214: "4816" }), reg({ 1: "7480001300007U", 16: "03" }), reg({ 1: "74800015" }), reg({ 1: "74899999" })].join("\r\n");
const r = c.lerRetorno(ret);
chk("retorno: cabeçalho", r.cabecalho.cnpj === "49016409000195" && r.cabecalho.sequencia === 3 && r.cabecalho.data === "2026-11-04");
chk("retorno: entrada confirmada com QR", r.titulos[0].movimento === "02" && r.titulos[0].nosso_numero === nn && r.titulos[0].valor === 1234.56 && r.titulos[0].qr_url.endsWith("/abc") && r.titulos[0].txid === "TX123");
chk("retorno: liquidação Pix com valores e datas", c.ehLiquidacao(r.titulos[1].movimento) && r.titulos[1].valor_pago === 102 && r.titulos[1].valor_liquido === 100.5 && r.titulos[1].data_ocorrencia === "2026-11-06" && r.titulos[1].data_credito === "2026-11-07");
chk("retorno: motivos da rejeição traduzidos", r.titulos[2].motivos.join("|") === "CEP inválido|Data de vencimento inválida".replace("Data de vencimento inválida", "Vencimento inválido"));
let e2 = ""; try { c.lerRetorno(rem); } catch (e) { e2 = e.message; }
chk("arquivo de remessa não é aceito como retorno", /remessa/.test(e2));

// QR Code: tamanho e padrões fixos (a leitura real foi conferida com leitor de QR na criação)
const m = qrMatriz(c.pixCopiaCola("pix-qrcode.sicredi.com.br/qr/v2/cobv/c1f7e23631cd49c8be2ec56551f12977", "DTCAR CENTRO AUTOMOTIVO", "COLATINA"));
chk("QR do Pix: versão 10 (57 módulos) com localizadores", m.length === 57 && m[0].slice(0, 7).every(Boolean) && m[6].slice(0, 7).every(Boolean) && !m[1][1] && m[3][3]);

console.log("OK", ok.length); console.log("FALHAS", falhas);
process.exit(falhas.length ? 1 : 0);
