// Leitura OBD pelo ELM327 (18/11/2026): a parte do js/obd.js que interpreta a resposta do adaptador.
// Roda sem celular e sem carro, com respostas de verdade de adaptador (inclusive as torcidas).
// Uso: node teste/teste_obd.mjs
import { juntarLinhas, bytesDe, dadosDa, dtcDe, codigosDa, vinDe, valorPid, monitoresDe, testesDe, suportados, motivoDe, PIDS } from "../js/obd.js";
const ok = [], falhas = [];
const chk = (n, c, extra) => (c ? ok : falhas).push(c ? n : n + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));

/* ---------------- juntar as linhas que o adaptador manda ---------------- */
chk("resposta simples: tira o enfeite e sobe o hex", juntarLinhas("41 0C 1A F8\r\r>").hex === "410C1AF8");
chk("sem espaço (ATS0 ligado) funciona igual", juntarLinhas("410C1AF8\r>").hex === "410C1AF8");
chk("SEARCHING... é descartado", juntarLinhas("SEARCHING...\r41 00 BE 3E B8 11\r>").hex === "4100BE3EB811");
{
  // resposta longa no CAN: vem o tamanho total numa linha e os pedaços numerados
  const r = juntarLinhas("014\r0: 49 02 01 39 42 57\r1: 5A 5A 5A 33 37 37 56\r2: 54 30 30 34 32 35 31\r>");
  chk("resposta longa: junta os pedaços e descarta a linha do tamanho", r.hex === "490201394257" + "5A5A5A33373756" + "54303034323531", r);
}
chk("meio byte no fim é descartado em vez de virar número errado", juntarLinhas("41 0C 1A F").hex === "410C1A");
for (const [txt, pedaco] of [["NO DATA", "não respondeu"], ["UNABLE TO CONNECT", "ignição"], ["CAN ERROR", "rede do carro"], ["BUFFER FULL", "maior"], ["STOPPED", "interrompida"], ["ERROR", "recusou"]]) {
  const r = juntarLinhas(txt + "\r>");
  chk("recusa do adaptador reconhecida: " + txt, !r.hex && r.erro.includes(pedaco), r);
}
chk("'?' sozinho é recusa; dentro de outra frase não é", !juntarLinhas("?\r>").hex && juntarLinhas("41 0C 1A F8\r>").erro === "");
chk("resposta vazia dá erro, não hex vazio silencioso", !!juntarLinhas("").erro && !!juntarLinhas("\r\r>").erro);

/* ---------------- casca da resposta ---------------- */
chk("bytesDe", bytesDe("410C1AF8").join() === "65,12,26,248");
chk("dadosDa confere o serviço (01 responde 41)", dadosDa("410C1AF8", 0x01).join() === "12,26,248");
chk("dadosDa recusa resposta de outro serviço", dadosDa("430171", 0x01) === null);

/* ---------------- códigos de falha ---------------- */
chk("dtcDe: P0171", dtcDe(0x01, 0x71) === "P0171");
chk("dtcDe: as quatro letras", [[0x01, 0x71, "P0171"], [0x43, 0x00, "C0300"], [0x81, 0x30, "B0130"], [0xc1, 0x00, "U0100"]].every(([a, b, e]) => dtcDe(a, b) === e));
chk("dtcDe: primeiro dígito 1, 2 e 3 (código de montadora)", dtcDe(0x11, 0x23) === "P1123" && dtcDe(0x21, 0x00) === "P2100" && dtcDe(0x30, 0x00) === "P3000");
chk("dtcDe: letra e dígito hexadecimal no fim", dtcDe(0x04, 0x2f) === "P042F");
chk("serviço 03 com a quantidade na frente (CAN)", codigosDa("4302017103 00".replace(/\s/g, ""), 0x03).join() === "P0171,P0300");
chk("serviço 03 sem a quantidade (protocolo antigo), com enchimento 0000", codigosDa("43017103000000", 0x03).join() === "P0171,P0300");
chk("nenhum código: lista vazia, não erro", codigosDa("4300", 0x03).length === 0 && codigosDa("430000000000", 0x03).length === 0);
chk("código repetido não entra duas vezes", codigosDa("430201710171", 0x03).join() === "P0171");
chk("serviço 07 (pendentes) e 0A (permanentes) usam a mesma conta", codigosDa("47010130", 0x07).join() === "P0130" && codigosDa("4A010171", 0x0a).join() === "P0171");
chk("resposta de outro serviço devolve null (a tela avisa em vez de mentir)", codigosDa("410C1AF8", 0x03) === null);
{
  // um código só, com a quantidade 01 — o "01" da frente não pode ser lido como parte do código
  const c = codigosDa("4301" + "0171", 0x03);
  chk("quantidade 01 com um código: sai P0171, não dois códigos", c.join() === "P0171", c);
}

/* ---------------- chassi ---------------- */
{
  const ascii = "9BWZZZ377VT004251".split("").map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("");
  chk("chassi com a contagem na frente", vinDe("4902" + "01" + ascii) === "9BWZZZ377VT004251");
  chk("chassi sem a contagem", vinDe("4902" + ascii) === "9BWZZZ377VT004251");
  chk("chassi curto (carro antigo) devolve vazio em vez de lixo", vinDe("490201" + ascii.slice(0, 20)) === "");
  chk("resposta de outro serviço não vira chassi", vinDe("410C1AF8") === "");
}

/* ---------------- dados ao vivo ---------------- */
chk("rotação: 1A F8 = 1726 rpm", valorPid("410C1AF8", 0x0c).valor === 1726);
chk("temperatura do motor: 7B = 83 °C", valorPid("41057B", 0x05).valor === 83);
chk("temperatura abaixo de zero (A-40 negativo)", valorPid("410514", 0x05).valor === -20);
chk("carga do motor: FF = 100%", valorPid("4104FF", 0x04).valor === 100);
chk("ajuste de combustível: 128 = 0%, 151 = +18%", valorPid("410680", 0x06).valor === 0 && valorPid("410697", 0x06).valor === 18);
chk("ajuste de combustível negativo", valorPid("410670", 0x06).valor === -12.5);
chk("avanço de ignição: 80 = 0°", valorPid("410E80", 0x0e).valor === 0);
chk("tensão do módulo: 14100 mV = 14,1 V", valorPid("41423714", 0x42).valor === 14.1);
chk("tensão do módulo baixa (bateria fraca): 3729 mV = 3,7 V", valorPid("41420E91", 0x42).valor === 3.7);
chk("MAF de dois bytes", valorPid("4110013A", 0x10).valor === 3.14);
chk("PID de um byte com resposta curta demais devolve null", valorPid("4105", 0x05) === null);
chk("PID que não é o pedido devolve null", valorPid("41051E", 0x0c) === null);
chk("foto da falha (serviço 02) pula o número da foto", valorPid("420C001AF8", 0x0c, 0x02).valor === 1726);
chk("todo PID da lista tem rótulo, conta e nº de bytes", PIDS.every(p => typeof p.rotulo === "string" && p.rotulo && typeof p.conta === "function" && (p.bytes === 1 || p.bytes === 2)));

/* ---------------- prontidão dos monitores ---------------- */
{
  // A = 0x83: luz acesa + 3 códigos. B = 0x07: os três de base disponíveis e completos.
  // C = 0x61 (catalisador, sonda, aquecedor da sonda), D = 0x21 (catalisador e aquecedor incompletos)
  const m = monitoresDe("4101830761 21".replace(/\s/g, ""));
  chk("luz acesa e quantidade de códigos", m.luzAcesa === true && m.quantidade === 3, m);
  chk("não é diesel", m.diesel === false);
  const nomes = m.monitores.map(x => x.nome + (x.pronto ? ":ok" : ":falta"));
  chk("monitor disponível e completo = pronto; incompleto = falta", nomes.includes("Catalisador:falta") && nomes.includes("Sonda lambda:falta") && nomes.includes("Aquecedor da sonda:ok"), nomes);
  chk("monitor não disponível não entra na lista", !nomes.some(n => n.startsWith("Sistema EVAP")), nomes);
  chk("contagem de prontos bate com a lista", m.prontos === m.monitores.filter(x => x.pronto).length && m.total === m.monitores.length);
}
{
  const m = monitoresDe("41010007" + "0000");
  chk("sem luz e sem código", m.luzAcesa === false && m.quantidade === 0);
  chk("todos os monitores de base prontos", m.monitores.length === 3 && m.monitores.every(x => x.pronto), m.monitores);
}
{
  // B com o bit 3 ligado = motor a diesel: os monitores das duas últimas letras não são padronizados
  const m = monitoresDe("4101000FFFFF");
  chk("diesel: marca diesel e não inventa nome de monitor", m.diesel === true && m.monitores.length === 3, m);
}
chk("resposta curta de monitores devolve null", monitoresDe("410100") === null);

/* ---------------- quais PIDs/MIDs o carro tem ---------------- */
chk("suportados: bitmask do PID 00", suportados("4100" + "80000000", 0x01, 0x00).join() === "1");
chk("suportados: vários bits", suportados("4100" + "BE3EB811", 0x01, 0x00).slice(0, 5).join() === "1,3,4,5,6");
chk("suportados: nada disponível = lista vazia", suportados("4100" + "00000000", 0x01, 0x00).length === 0);

/* ---------------- testes de bordo (serviço 06) ---------------- */
{
  // MID 21 (catalisador banco 1), TID 01, escala 0x01 (número cru): valor 100, limites 0 a 200 → passou
  const t = testesDe("46" + "2101" + "01" + "0064" + "0000" + "00C8");
  chk("teste de bordo: nome do catalisador e passou", t.length === 1 && t[0].nome.startsWith("Catalisador") && t[0].passou === true, t);
  chk("teste de bordo: valor e limites", t[0].valor === 100 && t[0].minimo === 0 && t[0].maximo === 200, t[0]);
}
{
  // valor acima do limite máximo → não passou
  const t = testesDe("46" + "2101" + "01" + "01F4" + "0000" + "00C8");
  chk("valor fora do limite: não passou", t[0].passou === false, t[0]);
}
{
  // escala 0x0B = volts (0,001). Sonda do banco 1 sensor 1.
  const t = testesDe("46" + "0101" + "0B" + "01C2" + "0064" + "02BC");
  chk("escala conhecida: converte para volt", t[0].escalaConhecida === true && t[0].unidade === "V" && t[0].valor === 0.45, t[0]);
}
{
  // escala que não está na tabela: mostra o número cru, sem unidade inventada
  const t = testesDe("46" + "A101" + "9A" + "0064" + "0000" + "00C8");
  chk("escala desconhecida: número cru, sem unidade, e ainda diz se passou", t[0].escalaConhecida === false && t[0].unidade === "" && t[0].valor === 100 && t[0].passou === true, t[0]);
  chk("MID sem nome padronizado vira 'Monitor $A1'", t[0].nome === "Monitor $A1", t[0]);
}
{
  const t = testesDe("46" + "2101010064000000C8" + "2102010032000000C8");
  chk("vários testes na mesma resposta", t.length === 2 && t[1].tid === 2, t);
}
chk("resposta de testes fora do padrão devolve lista vazia", testesDe("410C1AF8").length === 0);

/* ---------------- frases de erro ---------------- */
chk("motivo em português para cada recusa do plugin", ["sem-permissao", "bluetooth-desligado", "nao-conectou", "sem-conexao"].every(e => motivoDe(new Error(e)).length > 10 && !motivoDe(new Error(e)).includes("-")));
chk("motivo desconhecido não fica em branco", motivoDe(new Error("coisa-nova")).length > 10);

console.log(falhas.length ? ok.length + " verificações passaram; " + falhas.length + " FALHARAM:\n  ✗ " + falhas.join("\n  ✗ ") : ok.length + " verificações passaram.");
process.exit(falhas.length ? 1 : 0);
