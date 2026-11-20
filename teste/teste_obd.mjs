// Leitura OBD pelo ELM327 (18/11/2026): a parte do js/obd.js que interpreta a resposta do adaptador.
// Roda sem celular e sem carro, com respostas de verdade de adaptador (inclusive as torcidas).
// Uso: node teste/teste_obd.mjs
import { juntarLinhas, bytesDe, dadosDa, dtcDe, codigosDa, codigosDeTodas, primeiraDe, vinDe, valorPid, monitoresDe, testesDe, suportados, motivoDe, PIDS, GRUPOS, FAIXAS_PID, leiturasPara, gruposPara, tipoDeMotor, leituraCombustivel, PIDS_COMBUSTIVEL, respostaApagar, resultadoApagar, registroApagar, AVISOS_APAGAR, PIDS_AJUSTE, falhaPorCilindro, conferirOdometro, cilindroDoMid, nomeTeste, MIDS_FALHA, FALHA_DESTAQUE } from "../js/obd.js";
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
chk("rotação: 1A F8 = 1726 rpm", valorPid("410C1AF8", 0x0c)[0].valor === 1726);
chk("temperatura do motor: 7B = 83 °C", valorPid("41057B", 0x05)[0].valor === 83);
chk("temperatura abaixo de zero (A-40 negativo)", valorPid("410514", 0x05)[0].valor === -20);
chk("carga do motor: FF = 100%", valorPid("4104FF", 0x04)[0].valor === 100);
chk("ajuste de combustível: 128 = 0%, 151 = +18%", valorPid("410680", 0x06)[0].valor === 0 && valorPid("410697", 0x06)[0].valor === 18);
chk("ajuste de combustível negativo", valorPid("410670", 0x06)[0].valor === -12.5);
chk("avanço de ignição: 80 = 0°", valorPid("410E80", 0x0e)[0].valor === 0);
chk("tensão do módulo: 14100 mV = 14,1 V", valorPid("41423714", 0x42)[0].valor === 14.1);
chk("tensão do módulo baixa (bateria fraca): 3729 mV = 3,7 V", valorPid("41420E91", 0x42)[0].valor === 3.7);
chk("MAF de dois bytes", valorPid("4110013A", 0x10)[0].valor === 3.14);
chk("PID de um byte com resposta curta demais não vira leitura", valorPid("4105", 0x05).length === 0);
chk("PID que não é o pedido não vira leitura", valorPid("41051E", 0x0c).length === 0);
chk("foto da falha (serviço 02) pula o número da foto", valorPid("420C001AF8", 0x0c, 0x02)[0].valor === 1726);
{
  // Um PID pode trazer vários números (sonda: lambda e tensão). `partes` é a lista deles; o PID
  // simples é a sua própria parte única. Estas conferências valem para TODA parte.
  const partesDe = p => p.partes || [p];
  const todas = PIDS.flatMap(p => partesDe(p).map(parte => ({ p, parte })));
  chk("toda leitura tem rótulo, conta e nº de bytes",
    PIDS.every(p => p.bytes >= 1 && p.bytes <= 9 && partesDe(p).every(x => typeof x.rotulo === "string" && x.rotulo && typeof x.conta === "function")));
  // A conta só pode usar os bytes que o PID declara: ler d[2] num PID de 2 bytes daria NaN no
  // carro de verdade e a leitura sumiria da tela sem ninguém entender por quê.
  const erradas = todas.filter(({ p, parte }) => {
    for (const b of [0x00, 0x7f, 0xff]) {
      const d = new Array(p.bytes).fill(b);
      try { if (parte.quando && !parte.quando(d)) continue; } catch (e) { return true; }
      const v = parte.conta(d);
      if (typeof v !== "number" || !isFinite(v)) return true;
    }
    return false;
  });
  chk("a conta de cada leitura cabe nos bytes que o PID declara", !erradas.length, erradas.map(x => x.parte.rotulo));
  const semEscala = todas.filter(({ parte }) => (typeof parte.de === "number") !== (typeof parte.ate === "number"));
  chk("escala do mostrador vem completa ou não vem", !semEscala.length, semEscala.map(x => x.parte.rotulo));
  const escalaTorta = todas.filter(({ parte }) => typeof parte.de === "number" && parte.ate <= parte.de);
  chk("fim da escala sempre maior que o começo", !escalaTorta.length, escalaTorta.map(x => x.parte.rotulo));
  const rotuloRepetido = todas.map(x => x.parte.rotulo).filter((r, i, a) => a.indexOf(r) !== i);
  chk("nenhum rótulo repetido (o mecânico tem de saber qual é qual)", !rotuloRepetido.length, rotuloRepetido);
  const chaveRepetida = todas.map(({ p, parte }) => p.pid * 100 + partesDe(p).indexOf(parte)).filter((c, i, a) => a.indexOf(c) !== i);
  chk("cada leitura tem chave própria", !chaveRepetida.length, chaveRepetida);
}

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
  const t = testesDe("46" + "7101" + "9A" + "0064" + "0000" + "00C8");
  chk("escala desconhecida: número cru, sem unidade, e ainda diz se passou", t[0].escalaConhecida === false && t[0].unidade === "" && t[0].valor === 100 && t[0].passou === true, t[0]);
  chk("MID sem nome padronizado vira 'Monitor $71'", t[0].nome === "Monitor $71", t[0]);
  chk("o monitor de falha de combustão, esse tem nome", testesDe("46" + "A10B" + "24" + "0000" + "0000" + "FFFF")[0].nome.includes("Falha de combustão"));
}
{
  const t = testesDe("46" + "2101010064000000C8" + "2102010032000000C8");
  chk("vários testes na mesma resposta", t.length === 2 && t[1].tid === 2, t);
}
chk("resposta de testes fora do padrão devolve lista vazia", testesDe("410C1AF8").length === 0);

/* ---------------- dois módulos respondendo: o defeito mais grave ----------------
 * Num carro com motor e câmbio no barramento o ELM327 imprime uma linha por módulo. Colar tudo num
 * hex só fazia o começo da resposta do segundo módulo virar dado do primeiro, e saíam CÓDIGOS QUE
 * NÃO EXISTEM NO CARRO. Estes testes fecham essa porta.
 */
{
  const r = juntarLinhas("4300\r430201710300\r>");
  chk("duas linhas = duas respostas separadas, não um hex colado", r.respostas.length === 2 && r.respostas[0] === "4300" && r.respostas[1] === "430201710300", r);
  const { codigos, modulos } = codigosDeTodas(r.respostas, 0x03);
  chk("dois módulos: junta os códigos de verdade dos dois", codigos.join() === "P0171,P0300" && modulos === 2, { codigos, modulos });
  chk("NÃO inventa P0043/P0201/C3103 (o que o hex colado produzia)", !codigos.includes("P0043") && !codigos.includes("P0201") && !codigos.includes("C3103"), codigos);
}
{
  // o hex colado, se alguém voltar a juntar as linhas, não pode mais ser aceito: o serviço tem de
  // estar no COMEÇO da resposta, nunca encontrado no meio do texto
  chk("dado só é lido quando o serviço está no começo da resposta", dadosDa("4300430201710300", 0x03).length === 7 && dadosDa("FF4300", 0x03) === null);
  chk("resposta de outro módulo não é 'aproveitada' por quem procura outro serviço", primeiraDe(["4300", "410C1AF8"], 0x01) === "410C1AF8" && primeiraDe(["4300"], 0x01) === "");
}
{
  const r = juntarLinhas("430201710300\r>");
  chk("um módulo só continua com uma resposta", r.respostas.length === 1 && r.hex === "430201710300");
  chk("codigosDeTodas com um módulo", codigosDeTodas(r.respostas, 0x03).modulos === 1);
}
{
  // resposta longa de um módulo (pedaços numerados) NÃO pode ser confundida com vários módulos
  const r = juntarLinhas("014\r0: 49 02 01 39 42 57\r1: 5A 5A 5A 33 37 37 56\r2: 54 30 30 34 32 35 31\r>");
  chk("resposta longa continua sendo UMA resposta", r.respostas.length === 1, r.respostas);
  chk("chassi sai certo da resposta longa", vinDe(r.hex) === "9BWZZZ377VT004251");
}
chk("chassi com enchimento 00 nos quadros é lido", vinDe("490201" + "00".repeat(3) + "3942575A5A5A3337375654303034323531") === "9BWZZZ377VT004251");

/* ---------------- serviço 06 com valor negativo ----------------
 * Na tabela de escalas do J1979 os identificadores de $80 em diante são COM SINAL. Lendo tudo como
 * sem sinal, um valor negativo virava ~65000 e o "passou" INVERTIA — veredito errado é pior que
 * número cru.
 */
{
  // valor -100 (0xFF9C), limites -200 (0xFF38) a +200 (0x00C8), escala $80 (com sinal): passou
  const t = testesDe("46" + "2101" + "80" + "FF9C" + "FF38" + "00C8");
  chk("escala com sinal: valor negativo é negativo", t[0].valor === -100 && t[0].minimo === -200, t[0]);
  chk("escala com sinal: veredito certo (passou)", t[0].passou === true && t[0].comSinal === true, t[0]);
}
{
  // mesmo registro lido como sem sinal daria 65436, acima do limite: o veredito mudaria
  const t = testesDe("46" + "2101" + "01" + "FF9C" + "FF38" + "00C8");
  chk("escala sem sinal continua sem sinal", t[0].valor === 65436 && t[0].comSinal === false, t[0]);
}

/* ---------------- faixas de PID ----------------
 * Só o pedido 0100 cobre os PIDs $01 a $20. Sem andar nas faixas, a tensão do módulo ($42) e as
 * distâncias desde o apagamento ($21 e $31) NUNCA apareceriam, mesmo o carro tendo.
 */
chk("faixa $20 lê os PIDs de $21 a $40", suportados("4120" + "80018001", 0x01, 0x20).join() === "33,48,49,64");
chk("faixa $40 lê os PIDs de $41 a $60", suportados("4140" + "40000000", 0x01, 0x40).join() === "66");
chk("os PIDs altos da lista existem nas faixas certas", [0x21, 0x30, 0x31].every(p => p > 0x20 && p <= 0x40) && 0x42 > 0x40);
chk("a última posição de cada faixa é o aviso da faixa seguinte", suportados("4100" + "00000001", 0x01, 0x00).join() === "32" && suportados("4120" + "00000001", 0x01, 0x20).join() === "64");


/* ---------------- leituras novas (19/11/2026) ----------------
 * Valores conferidos contra a tabela de fórmulas do J1979. Cada um com um número que um mecânico
 * reconhece no carro, para a conta estar errada doer aqui e não no laudo.
 */
// valorPid devolve LISTA (um PID pode trazer vários números); `vp` pega a primeira leitura e
// `vps` a lista inteira, para os PIDs de sonda e de temperatura do escape.
const vps = (pid, dados) => valorPid("41" + pid + dados, parseInt(pid, 16), 0x01);
const vp = (pid, dados) => vps(pid, dados)[0] || null;
chk("velocidade", vp("0D", "50").valor === 80);
chk("pressão do rail: 5000 x 10 = 50.000 kPa (500 bar, diesel)", vp("23", "1388").valor === 50000);
chk("pressão do rail absoluta usa a mesma escala", vp("59", "1388").valor === 50000);
chk("pressão do rail sobre o vácuo é outra escala (x0,079)", vp("22", "1388").valor === 395);
chk("tempo de injeção: 2,5° (não é o avanço de ignição)", vp("5D", "6A40").valor === 2.5 && vp("5D", "6A40").rotulo.includes("injeção"));
chk("tempo de injeção negativo (atrasado)", vp("5D", "6540").valor === -7.5);
chk("consumo instantâneo 3,5 L/h", vp("5E", "0046").valor === 3.5);
chk("EGR comandada 50%", vp("2C", "80").valor === 50);
chk("erro da EGR zero quando vem 128", vp("2D", "80").valor === 0);
chk("temperatura do catalisador 450 °C", vp("3C", "1324").valor === 450);
chk("os quatro pontos do catalisador existem e têm nomes diferentes", [0x3c, 0x3d, 0x3e, 0x3f].every(p => PIDS.some(x => x.pid === p)) && new Set([0x3c, 0x3d, 0x3e, 0x3f].map(p => PIDS.find(x => x.pid === p).rotulo)).size === 4);
chk("etanol no tanque 27%", vp("52", "45").valor === 27);
chk("nível do tanque 50%", vp("2F", "80").valor === 50);
chk("mistura comandada = 1,000 quando vem 0x8000", vp("44", "8000").valor === 1);
chk("temperatura do óleo 90 °C", vp("5C", "82").valor === 90);
chk("torque entregue zero quando vem 125", vp("62", "7D").valor === 0);
chk("torque de referência 300 Nm", vp("63", "012C").valor === 300);
chk("pressão de vapor do tanque é NEGATIVA quando é vácuo", vp("32", "FFFC").valor === -1);
chk("pressão de vapor ampla também tem sinal", vp("54", "FFFF").valor === -1);
chk("odômetro do módulo: 1.500.000 ÷ 10 = 150.000 km", vp("A6", "0016E360").valor === 150000);
chk("odômetro é de 4 bytes", PIDS.find(p => p.pid === 0xa6).bytes === 4);
chk("ajuste de combustível do banco 2 existe, separado do banco 1", [0x06, 0x07, 0x08, 0x09].every(p => PIDS.some(x => x.pid === p)) && vp("08", "80").valor === 0);
chk("pressão barométrica em kPa", vp("33", "65").valor === 101);
chk("pedal e borboleta: todas as tomadas do padrão", [0x45, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x5a].every(p => PIDS.some(x => x.pid === p)));
chk("tempo com a luz acesa em minutos", vp("4D", "003C").valor === 60);
chk("dado de PID errado não vira leitura (resposta de outro PID)", valorPid("410D50", 0x23, 0x01).length === 0);
chk("faixas andam até $C0, senão o odômetro ($A6) nunca sairia", FAIXAS_PID[FAIXAS_PID.length - 1] >= 0xa0);

/* ---------------- sondas e temperatura do escape (19/11/2026) ----------------
 * Estes PIDs trazem MAIS DE UM número no mesmo pedido. Valores conferidos contra a planta de
 * bytes do J1979.
 */
{
  // Banda estreita: tensão (A/200) e o ajuste que a sonda provoca ((100/128)B - 100).
  const sonda1 = vps("14", "99" + "80");
  chk("sonda banda larga… não: banda estreita devolve DOIS números", sonda1.length === 2);
  chk("tensão da sonda: 0x99 ÷ 200 = 0,765 V", sonda1[0].valor === 0.765 && sonda1[0].unidade === "V");
  chk("ajuste da sonda zero quando vem 128", sonda1[1].valor === 0);
  chk("as duas leituras do mesmo PID têm chaves diferentes", sonda1[0].chave !== sonda1[1].chave);
  const semAjuste = vps("14", "99" + "FF");
  chk("segundo byte 0xFF: esta sonda não entra na conta do ajuste e some da tela", semAjuste.length === 1 && semAjuste[0].unidade === "V");

  // Banda larga: lambda ((2/65536)(256A+B)) e tensão ((8/65536)(256C+D)).
  const larga = vps("24", "8000" + "4000");
  chk("sonda banda larga: lambda 1,000 com 0x8000", larga.length === 2 && larga[0].valor === 1);
  chk("sonda banda larga: tensão 2,000 V com 0x4000", larga[1].valor === 2 && larga[1].unidade === "V");
  chk("lambda pobre aparece acima de 1", vps("24", "C0004000")[0].valor === 1.5);
  chk("as oito sondas de cada tipo existem", [0x14, 0x1b, 0x24, 0x2b].every(p => PIDS.some(x => x.pid === p)));

  // Escape: 9 bytes, o primeiro diz quais dos quatro sensores existem.
  const doisSensores = vps("78", "03" + "1324" + "16A8" + "0000" + "0000");
  chk("temperatura do escape: só saem os sensores que o carro marcou como presentes", doisSensores.length === 2);
  chk("escape sensor 1 = 450 °C", doisSensores[0].valor === 450);
  chk("escape sensor 2 = 540 °C", doisSensores[1].valor === 540);
  chk("nenhum sensor marcado: nenhuma leitura (não inventa 0 °C)", vps("78", "00" + "1324" + "00000000000000").length === 0);
  chk("o quarto sensor também sai quando marcado", vps("78", "08" + "0000" + "0000" + "0000" + "1324")[0].valor === 450);
  chk("escape dos dois bancos", [0x78, 0x79].every(p => PIDS.some(x => x.pid === p)));
}

/* ---------------- escolher o que aparece (19/11/2026) ----------------
 * Quem manda é o CARRO: a lista que ele responde. A placa só serve para ordenar e para não
 * oferecer, antes de ligar, grupo que não existe naquele motor.
 */
chk("toda leitura tem grupo, e grupo que existe", PIDS.every(p => p.grupo && GRUPOS.some(g => g.id === p.grupo)));
chk("sem lista do carro, mostra todas", leiturasPara(null, null).length === PIDS.length);
chk("o carro manda: PID fora da lista dele não aparece", leiturasPara([0x0c, 0x05], null).map(p => p.pid).join() === "12,5");
chk("marcar no filtro reduz, mas nunca acrescenta o que o carro não tem",
  leiturasPara([0x0c, 0x05], [0x0c, 0x42]).map(p => p.pid).join() === "12");
chk("marcar nada = todas as que o carro tiver", leiturasPara([0x0c, 0x05, 0x42], []).length === 3);
chk("sai na ordem dos grupos, não na ordem em que foi marcado",
  leiturasPara([0x42, 0x0c], [0x42, 0x0c]).map(p => p.grupo).join() === "motor,eletrico");
chk("diesel não recebe grupo de sonda nem de cânister", !gruposPara(null, "DIESEL").some(g => ["sondas", "catalisador", "evap"].includes(g.id)));
chk("injeção/EGR/turbo vale nos dois: rail e tempo de injeção também existem em gasolina de injeção direta",
  ["DIESEL", "Álcool/Gasolina"].every(c => gruposPara(null, c).some(g => g.id === "injecao")));
chk("sem saber o combustível, oferece tudo o que o carro tem", gruposPara(null, "").length >= gruposPara(null, "DIESEL").length);
chk("grupo sem nenhuma leitura no carro não aparece no filtro", gruposPara([0x0c], "").map(g => g.id).join() === "motor");
chk("cada grupo do filtro vem com as leituras dele", gruposPara([0x0c, 0x42], "").every(g => g.leituras.length > 0));
chk("tipo de motor pelo combustível do cadastro", [tipoDeMotor("DIESEL"), tipoDeMotor("Diesel S10"), tipoDeMotor("Álcool/Gasolina"), tipoDeMotor("FLEX"), tipoDeMotor("Gasolina"), tipoDeMotor(""), tipoDeMotor(null)].join() === "diesel,diesel,otto,otto,otto,,");

/* ---------------- leitura de combustível (19/11/2026) ----------------
 * O que importa é a SOMA do ajuste curto com o longo. A tela mostra o número e as causas
 * possíveis; nunca dá veredito, porque faixa de normalidade por motor só a montadora publica.
 */
{
  const leitura = (c1, l1, c2, l2, etanol) => {
    const v = {};
    if (c1 !== null) v[0x06 * 100] = { valor: c1 };
    if (l1 !== null) v[0x07 * 100] = { valor: l1 };
    if (c2 !== null) v[0x08 * 100] = { valor: c2 };
    if (l2 !== null) v[0x09 * 100] = { valor: l2 };
    if (etanol !== undefined) v[0x52 * 100] = { valor: etanol };
    return leituraCombustivel(v);
  };
  const ok = leitura(1.5, 2.0, null, null);
  chk("motor em ordem: soma pequena, nenhuma causa listada", ok.situacao === "normal" && !ok.causas.length && ok.bancos[0].total === 3.5);
  const pobre = leitura(6, 12, null, null);
  chk("somando 18%: o módulo está PONDO combustível", pobre.situacao === "atencao" && pobre.frases[0].includes("PONDO") && pobre.frases[0].includes("18"));
  chk("mistura pobre lista entrada de ar falsa entre as causas", pobre.causas.some(c => c.toLowerCase().includes("ar falsa")));
  chk("e lista combustível com MAIS álcool do que o módulo calculou", pobre.causas.some(c => c.includes("MAIS álcool")));
  const rica = leitura(-5, -25, null, null);
  chk("somando -30%: está TIRANDO combustível e passou do limite", rica.situacao === "grave" && rica.frases[0].includes("TIRANDO") && rica.frases[1].includes("limite"));
  chk("mistura rica lista bico vazando e MENOS álcool", rica.causas.some(c => c.includes("vazando")) && rica.causas.some(c => c.includes("MENOS álcool")));
  const doisBancos = leitura(2, 1, 6, 12, 27);
  chk("com dois bancos, manda procurar do lado que corrige mais", doisBancos.pior.nome === "Banco 2" && doisBancos.frases.some(f => f.includes("longe um do outro")));
  chk("o etanol do tanque entra na conversa", doisBancos.frases.some(f => f.includes("27") && f.includes("etanol")));
  const semEtanol = leitura(0, 0, null, null);
  chk("carro que não informa etanol: diz isso em vez de inventar", semEtanol.frases.some(f => f.includes("não informa")));
  const nada = leituraCombustivel({});
  chk("módulo sem ajuste: diz que não dá para afirmar nada", nada.situacao === "sem_dados" && !nada.bancos.length);
  chk("a lista do combustível tem os dois bancos, o etanol e o lambda", [0x06, 0x07, 0x08, 0x09, 0x52, 0x44].every(p => PIDS_COMBUSTIVEL.includes(p)));
  chk("e só pede o que existe na tabela de leituras", PIDS_COMBUSTIVEL.every(p => PIDS.some(x => x.pid === p)));
  chk("nenhuma frase dá veredito de defeito", [ok, pobre, rica].every(r => !r.frases.join(" ").toLowerCase().includes("o problema é")));
}

/* ---------------- frases de erro ---------------- */
chk("motivo em português para cada recusa do plugin", ["sem-permissao", "bluetooth-desligado", "nao-conectou", "sem-conexao"].every(e => motivoDe(new Error(e)).length > 10 && !motivoDe(new Error(e)).includes("-")));
chk("motivo desconhecido não fica em branco", motivoDe(new Error("coisa-nova")).length > 10);
chk("comando recusado pelo nativo tem frase própria", motivoDe(new Error("comando-recusado")).includes("não escreve no carro"));
chk("demora tem frase própria", motivoDe(new Error("demorou")).includes("tempo"));

/* -------- falha de combustão por cilindro (serviço 06, MIDs $A1-$AD) -------- */
chk("$A2 é o cilindro 1 e $AD é o 12", cilindroDoMid(0xa2) === 1 && cilindroDoMid(0xad) === 12);
chk("$A1 é o monitor geral, não um cilindro", cilindroDoMid(0xa1) === 0);
chk("MID fora da faixa não vira cilindro", cilindroDoMid(0x21) === 0 && cilindroDoMid(0xae) === 0);
chk("os dois testes de cada cilindro têm nome", nomeTeste(0xa4, 0x0c).includes("ciclo") && nomeTeste(0xa4, 0x0b).includes("10 ciclos"));
chk("TID desconhecido não ganha nome inventado", nomeTeste(0xa4, 0x77) === "" && nomeTeste(0x21, 0x0c) === "");
chk("a lista de MIDs de falha tem o geral e os 12 cilindros", MIDS_FALHA.length === 13 && MIDS_FALHA[0] === 0xa1);
{
  const t = (mid, tid, valor) => ({ mid, tid, valor });
  const quatro = [t(0xa2, 0x0c, 2), t(0xa3, 0x0c, 1), t(0xa4, 0x0c, 340), t(0xa5, 0x0c, 0)];
  const r = falhaPorCilindro(quatro);
  chk("junta um cilindro por MID", r.cilindros.length === 4 && r.cilindros[0].cilindro === 1);
  chk("aponta o cilindro que destoa", r.situacao === "um_cilindro" && r.destacado.cilindro === 3, r.frases);
  chk("e diz onde procurar naquele cilindro", r.frases[0].includes("ignição") && r.frases[0].includes("compressão"));
  const zerado = falhaPorCilindro([t(0xa2, 0x0c, 0), t(0xa3, 0x0c, 0)]);
  chk("tudo zero é 'nenhuma', sem alarde", zerado.situacao === "limpo" && zerado.total === 0);
  const parelho = falhaPorCilindro([t(0xa2, 0x0c, 40), t(0xa3, 0x0c, 38), t(0xa4, 0x0c, 44), t(0xa5, 0x0c, 41)]);
  chk("contagem parelha não acusa cilindro nenhum", parelho.situacao === "espalhado" && !parelho.destacado, parelho.frases);
  chk("falha espalhada aponta causa comum a todos", parelho.frases[0].includes("comum"));
  const ruido = falhaPorCilindro([t(0xa2, 0x0c, 3), t(0xa3, 0x0c, 0), t(0xa4, 0x0c, 0)]);
  chk("contagem miúda é ruído: não aponta ninguém", !ruido.destacado, ruido);
  const quase = falhaPorCilindro([t(0xa2, 0x0c, 30), t(0xa3, 0x0c, 20)]);
  chk("o dobro não basta para apontar (a trava é " + FALHA_DESTAQUE + "x)", !quase.destacado);
  chk("sem contagem nenhuma devolve nada, em vez de inventar zero", falhaPorCilindro([]) === null && falhaPorCilindro([t(0x21, 0x0c, 5)]) === null);
  chk("usa o ciclo atual quando existe e a média quando só ela existe",
    falhaPorCilindro([t(0xa2, 0x0b, 99), t(0xa2, 0x0c, 7)]).cilindros[0].ciclo === 7 && falhaPorCilindro([t(0xa3, 0x0b, 5)]).cilindros[0].media === 5);
  chk("os avisos dizem que se compara entre cilindros e desde o apagamento",
    r.avisos.some(a => a.includes("entre si")) && r.avisos.some(a => a.includes("apagamento")));
  chk("avisa da ordem de ignição e do cilindro que não existe", r.avisos.some(a => a.includes("ordem de ignição")));
  chk("nenhuma frase dá veredito de peça", !r.frases.concat(r.avisos).some(f => /troque|substitua|está queimad/i.test(f)));
}

/* -------- odômetro do módulo contra o KM do cadastro -------- */
chk("módulo acima do cadastro é o normal: diz quanto andou", conferirOdometro(150000, 148000).situacao === "acima" && conferirOdometro(150000, 148000).frase.includes("2.000"));
chk("igual ao cadastro bate", conferirOdometro(148000, 148000).diferenca === 0);
chk("pouco abaixo é arredondamento, não alarme", conferirOdometro(147500, 148000).situacao === "perto");
{
  const r = conferirOdometro(140000, 148000);
  chk("muito abaixo manda conferir", r.situacao === "abaixo" && r.frase.includes("8.000"));
  chk("mas NÃO acusa ninguém: lista as explicações inocentes", r.frase.includes("não acusa") && r.frase.toLowerCase().includes("painel trocado"));
}
chk("carro que não informa odômetro devolve nada", conferirOdometro(null, 148000) === null && conferirOdometro(0, 148000) === null);
chk("sem KM no cadastro não compara", conferirOdometro(150000, 0).situacao === "sem_cadastro");
/* ---------------- apagar a falha, com registro (v62, 19/11/2026) ---------------- */
chk("44 é apagou", respostaApagar(["44"]).ok && respostaApagar(["44 00"]).ok);
chk("um módulo que aceita basta", respostaApagar(["7F 04 22", "44"]).ok);
chk("7F 04 22 com o motor ligado manda desligar o motor", !respostaApagar(["7F0422"]).ok && respostaApagar(["7F0422"]).erro.includes("MOTOR DESLIGADO"));
chk("7F 04 11 diz que o módulo não aceita", respostaApagar(["7F 04 11"]).erro.includes("não aceita"));
chk("recusa desconhecida mostra o código, sem inventar motivo", respostaApagar(["7F 04 99"]).erro.includes("99"));
chk("sem resposta nenhuma não vira 'apagou'", !respostaApagar([]).ok && !respostaApagar(null).ok);
chk("resposta estranha avisa que NADA foi apagado", respostaApagar(["41 0C 1A F8"]).erro.includes("nada foi apagado"));
{
  const antes = [{ codigo: "P0171", situacao: "atual" }, { codigo: "P0300", situacao: "pendente" }];
  chk("limpou: diz que o código volta se o defeito continuar", resultadoApagar(antes, []).situacao === "limpo" && resultadoApagar(antes, []).frase.includes("volta"));
  chk("voltou na hora = defeito acontecendo agora", resultadoApagar(antes, antes).situacao === "voltou" && resultadoApagar(antes, antes).frase.includes("agora"));
  chk("sobrou código de outro módulo", resultadoApagar(antes, [{ codigo: "C1234", situacao: "atual" }]).situacao === "sobrou");
  chk("não deu para conferir não vira 'limpou'", resultadoApagar(antes, null).situacao === "nao_conferido");
  const r = registroApagar({ perfil_id: "p1", perfil_nome: "João", placa: "abc1d23", km: "152300", antes, depois: [], vin: "9BWZZZ377VT004251",
    combustivel: { pior: { total: 18 } }, combustivel_depois: { pior: { total: 0 } }, leituras: [{ chave: 501, rotulo: "Rotação", unidade: "rpm", valor: 820, de: 0, ate: 8000 }] });
  chk("registro: placa em maiúsculas e KM número", r.placa === "ABC1D23" && r.km === 152300, r);
  chk("registro: tipo apagar e quem apagou", r.tipo === "apagar" && r.perfil_id === "p1" && r.perfil_nome === "João");
  chk("registro: guarda o que estava lá antes", r.codigos.length === 2 && r.codigos[0].codigo === "P0171");
  chk("registro: o que sobrou é lista vazia, não nulo", Array.isArray(r.codigos_depois) && !r.codigos_depois.length);
  chk("registro: ajuste de combustível antes e depois", r.combustivel.pior.total === 18 && r.combustivel_depois.pior.total === 0);
  chk("registro: leitura guarda só o que interessa (sem a escala)", r.leituras[0].rotulo === "Rotação" && r.leituras[0].de === undefined);
  const sem = registroApagar({ antes: [], depois: null, km: "", placa: "" });
  chk("registro sem KM e sem placa não inventa nada", sem.km === null && sem.placa === "" && sem.codigos_depois === null && sem.perfil_id === null, sem);
  chk("KM bobo (0 ou texto) não entra", registroApagar({ antes: [], km: "0" }).km === null && registroApagar({ antes: [], km: "abc" }).km === null);
}
chk("os avisos de apagar dizem que NÃO conserta", AVISOS_APAGAR.some(a => a.includes("NÃO conserta")));
chk("os avisos falam do aprendizado de combustível e da prontidão", AVISOS_APAGAR.some(a => a.toLowerCase().includes("combustível")) && AVISOS_APAGAR.some(a => a.toLowerCase().includes("prontidão")));
chk("nenhum aviso promete conserto ou dá veredito", !AVISOS_APAGAR.some(a => /resolve|conserta o|arruma/i.test(a)));
chk("a passada curta do ajuste é curta mesmo (5 pedidos)", PIDS_AJUSTE.length === 5 && PIDS_AJUSTE.every(p => PIDS_COMBUSTIVEL.includes(p)));

console.log(falhas.length ? ok.length + " verificações passaram; " + falhas.length + " FALHARAM:\n  ✗ " + falhas.join("\n  ✗ ") : ok.length + " verificações passaram.");
process.exit(falhas.length ? 1 : 0);
