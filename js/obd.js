/* Leitura de diagnóstico OBD pelo adaptador ELM327 (pedido do Danilo em 18/11/2026).
 *
 * Este arquivo é o lado do site: ele é quem entende de OBD. A parte nativa (plugin do Capacitor
 * "DtcarObd", em app/plugins/obd/) só abre o Bluetooth, manda uma linha de texto e devolve o que o
 * adaptador respondeu. Toda a interpretação acontece aqui, então ela é testada sem celular e sem
 * carro (teste/teste_obd.mjs) e muda sem gerar APK novo, como o resto das telas.
 *
 * O que dá para ler com OBD-II genérico, em qualquer carro: códigos de falha do MOTOR, dados ao
 * vivo, chassi, prontidão dos monitores, a foto do momento da falha e os resultados dos testes de
 * bordo. O que NÃO dá: ABS, airbag, câmbio e imobilizador (protocolo próprio de cada montadora),
 * quilometragem do painel (não existe no OBD-II) e qualquer atuação ou programação.
 *
 * Nada aqui grava no banco: a etapa 1 só mostra na tela.
 * Sem window/document no carregamento, para rodar no teste pelo node.
 */

/* ============================================================ parte pura (testável)
 * As funções abaixo só mexem em texto e número: é o que o teste cobre.
 */

/** respostas que o ELM327 dá quando não conseguiu falar com o carro */
const RECUSAS = [
  ["UNABLE TO CONNECT", "O adaptador não conseguiu falar com o carro. Ligue a ignição (chave na posição 2)."],
  ["NO DATA", "O módulo não respondeu a este pedido."],
  ["CAN ERROR", "Erro na rede do carro. Confira se o adaptador está bem encaixado na tomada."],
  ["BUS INIT", "O adaptador não conseguiu iniciar a conversa com o carro."],
  ["BUS ERROR", "Erro na rede do carro."],
  ["BUFFER FULL", "A resposta veio maior do que o adaptador aguenta. Tente de novo."],
  ["STOPPED", "A leitura foi interrompida."],
  ["ERROR", "O adaptador recusou o comando."],
  ["?", "O adaptador não entendeu o comando."],
];

const soHex = t => String(t).replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
const parear = h => (h.length % 2 ? h.slice(0, -1) : h);   // meio byte no fim: descarta

/**
 * Texto cru do adaptador → { respostas: [hex, …], hex, erro }.
 *
 * ATENÇÃO, a parte que mais importa: num carro com mais de um módulo no barramento (motor e
 * câmbio, comum em VW e GM), o ELM327 imprime UMA LINHA POR MÓDULO. Colar tudo num hex só faz o
 * começo da resposta do segundo módulo ser lido como dado do primeiro, e aí saem **códigos de
 * falha que não existem no carro**. Num laudo de oficina isso é o pior defeito possível.
 * Por isso cada resposta fica separada em `respostas`. Só os pedaços numerados ("0:", "1:"…), que
 * são uma resposta longa de um mesmo módulo, são juntados.
 * `hex` continua sendo a primeira resposta, que é o caso normal (um módulo só).
 */
export function juntarLinhas(texto) {
  const bruto = String(texto == null ? "" : texto);
  const linhas = bruto.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
    .filter(l => !/^SEARCHING/i.test(l) && l !== ">");
  if (!linhas.length) return { respostas: [], hex: "", erro: "O adaptador não respondeu." };
  const juntas = linhas.join(" ").toUpperCase();
  for (const [marca, motivo] of RECUSAS) {
    // "?" só vale quando é a resposta inteira; dentro de outra frase não quer dizer nada
    if (marca === "?" ? linhas.some(l => l === "?") : juntas.includes(marca)) return { respostas: [], hex: "", erro: motivo };
  }
  const blocos = [];
  let longa = null;                                        // resposta longa em construção
  for (const l of linhas) {
    if (/^[0-9A-F]:/i.test(l)) {                           // pedaço numerado: mesma resposta
      if (!longa) { longa = { hex: "" }; blocos.push(longa); }
      longa.hex += soHex(l.slice(2));
      continue;
    }
    if (/^[0-9A-F]{3}$/i.test(soHex(l))) {                 // tamanho total: começa uma resposta longa
      longa = { hex: "" }; blocos.push(longa);
      continue;
    }
    blocos.push({ hex: soHex(l) });                        // resposta de um quadro: é dela mesma
    longa = null;
  }
  const respostas = blocos.map(b => parear(b.hex)).filter(Boolean);
  if (!respostas.length) return { respostas: [], hex: "", erro: "A resposta veio sem dado." };
  return { respostas, hex: respostas[0], erro: "" };
}

/** hex em texto → lista de números */
export function bytesDe(hex) {
  const b = [];
  for (let i = 0; i + 1 < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
  return b;
}

/**
 * Tira a "casca" de UMA resposta e devolve só os dados.
 * No OBD-II a resposta do serviço 01 volta como 41, a do 03 como 43, e assim por diante (+0x40).
 * A resposta tem de COMEÇAR com esse byte: procurar no meio do texto é o que fazia dado de um
 * módulo ser lido como se fosse de outro.
 */
export function dadosDa(hex, servico) {
  const esperado = (servico + 0x40).toString(16).toUpperCase().padStart(2, "0");
  if (!hex.startsWith(esperado)) return null;
  return bytesDe(hex.slice(2));
}

/** Dois bytes → código de falha no jeito que a oficina lê (P0171, U0100…). */
export function dtcDe(a, b) {
  const letra = ["P", "C", "B", "U"][(a >> 6) & 0x3];
  const primeiro = (a >> 4) & 0x3;
  const resto = (((a & 0x0f) << 8) | b).toString(16).toUpperCase().padStart(3, "0");
  return letra + primeiro + resto;
}

/**
 * UMA resposta dos serviços 03 (confirmadas), 07 (pendentes) ou 0A (permanentes) → lista de códigos.
 * Alguns carros mandam a quantidade antes dos códigos e outros não; os dois casos são aceitos.
 */
export function codigosDa(hex, servico) {
  const d = dadosDa(hex, servico);
  if (!d) return null;
  let dados = d;
  // quantidade na frente: o resto tem de dar exatamente 2 bytes por código
  if (d.length >= 1 && d.length - 1 === d[0] * 2 && d[0] > 0) dados = d.slice(1);
  const codigos = [];
  for (let i = 0; i + 1 < dados.length; i += 2) {
    if (dados[i] === 0 && dados[i + 1] === 0) continue;               // enchimento
    const c = dtcDe(dados[i], dados[i + 1]);
    if (!codigos.includes(c)) codigos.push(c);
  }
  return codigos;
}

/**
 * TODAS as respostas de um pedido de falha → { codigos, modulos }.
 * Com mais de um módulo respondendo, os códigos de cada um entram na lista (um scanner faz o
 * mesmo). Resposta que não começa com o serviço certo é descartada, nunca "aproveitada".
 */
export function codigosDeTodas(respostas, servico) {
  const codigos = [];
  let modulos = 0;
  for (const hex of respostas || []) {
    const c = codigosDa(hex, servico);
    if (!c) continue;
    modulos++;
    for (const x of c) if (!codigos.includes(x)) codigos.push(x);
  }
  return { codigos, modulos };
}

/** A primeira resposta que serve para o serviço pedido (o resto é de outro módulo). */
export function primeiraDe(respostas, servico) {
  for (const hex of respostas || []) if (dadosDa(hex, servico)) return hex;
  return "";
}

/** Serviço 09 PID 02 → chassi (VIN). */
export function vinDe(hex) {
  const d = dadosDa(hex, 0x09);
  if (!d || d.length < 2 || d[0] !== 0x02) return "";
  let dados = d.slice(1).filter(b => b !== 0x00);                     // tira o enchimento dos quadros
  if (dados.length > 17) dados = dados.slice(dados.length - 17);      // tira a contagem da frente
  const txt = dados.map(b => String.fromCharCode(b)).join("");
  const limpo = txt.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
  return limpo.length === 17 ? limpo : "";
}

/* ---- dados ao vivo (serviço 01) ---- */

const arred = (n, casas) => Math.round(n * Math.pow(10, casas)) / Math.pow(10, casas);
/** 16 bits em complemento de dois (pressão de vapor do tanque pode ser negativa: é vácuo) */
const sinal16 = v => (v > 0x7fff ? v - 0x10000 : v);

/**
 * Grupos das leituras, na ordem em que aparecem na escolha. `so` diz para qual tipo de motor o
 * grupo interessa: a tela usa isso só para ORDENAR e para não oferecer, antes de ligar no carro, o
 * que não faz sentido nele (num flex não adianta oferecer rail nem DPF). Quem decide de verdade o
 * que aparece continua sendo o CARRO: a lista que ele responde em 0100/0120/0140 é a palavra final,
 * porque nenhuma consulta de placa sabe quais sensores aquele módulo expõe.
 */
export const GRUPOS = [
  { id: "motor", nome: "Motor", so: null },
  { id: "ar", nome: "Ar e admissão", so: null },
  { id: "combustivel", nome: "Combustível", so: null },
  { id: "sondas", nome: "Sondas", so: "otto" },
  { id: "catalisador", nome: "Catalisador", so: "otto" },
  // Não é "diesel": o PID da pressão do rail é "diesel OU gasolina de injeção direta", e EGR e
  // turbo existem nos dois. Quem decide continua sendo o carro — por isso aqui não há `so`.
  { id: "injecao", nome: "Injeção, EGR e turbo", so: null },
  { id: "evap", nome: "Tanque e cânister", so: "otto" },
  { id: "eletrico", nome: "Elétrico", so: null },
  { id: "contadores", nome: "Contadores", so: null },
];

/**
 * bytes = quantos bytes de dado o PID devolve; casas = casas depois da vírgula ao mostrar;
 * vivo = muda o tempo todo com o motor (entra em toda volta da leitura contínua). Os de `vivo: false`
 * (distâncias e aquecimentos desde o apagamento) praticamente não mudam enquanto o carro está no
 * elevador: lê uma vez e pronto, para a roda não gastar tempo com eles.
 */
export const PIDS = [
  { pid: 0x0c, rotulo: "Rotação", unidade: "rpm", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 4, casas: 0, vivo: true, de: 0, ate: 8000, grupo: "motor" },
  { pid: 0x05, rotulo: "Temperatura do motor", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0, vivo: true, de: -40, ate: 150, grupo: "motor" },
  { pid: 0x04, rotulo: "Carga do motor", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "motor" },
  { pid: 0x11, rotulo: "Borboleta", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x06, rotulo: "Ajuste curto de combustível", unidade: "%", bytes: 1, conta: d => (d[0] - 128) * 100 / 128, casas: 1, vivo: true, de: -25, ate: 25, grupo: "combustivel" },
  { pid: 0x07, rotulo: "Ajuste longo de combustível", unidade: "%", bytes: 1, conta: d => (d[0] - 128) * 100 / 128, casas: 1, vivo: true, de: -25, ate: 25, grupo: "combustivel" },
  { pid: 0x0e, rotulo: "Avanço de ignição", unidade: "°", bytes: 1, conta: d => (d[0] / 2) - 64, casas: 1, vivo: true, de: -30, ate: 60, grupo: "motor" },
  { pid: 0x0f, rotulo: "Temperatura do ar admitido", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0, vivo: true, de: -40, ate: 100, grupo: "ar" },
  { pid: 0x0b, rotulo: "Pressão no coletor", unidade: "kPa", bytes: 1, conta: d => d[0], casas: 0, vivo: true, de: 0, ate: 255, grupo: "ar" },
  { pid: 0x10, rotulo: "Fluxo de ar (MAF)", unidade: "g/s", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 100, casas: 2, vivo: true, de: 0, ate: 200, grupo: "ar" },
  { pid: 0x42, rotulo: "Tensão do módulo", unidade: "V", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 1000, casas: 1, vivo: true, de: 0, ate: 16, grupo: "eletrico" },
  { pid: 0x1f, rotulo: "Motor ligado há", unidade: "s", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: true, grupo: "contadores" },
  { pid: 0x21, rotulo: "Distância com a luz acesa", unidade: "km", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: false, grupo: "contadores" },
  { pid: 0x31, rotulo: "Distância desde o apagamento", unidade: "km", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: false, grupo: "contadores" },
  { pid: 0x30, rotulo: "Aquecimentos desde o apagamento", unidade: "", bytes: 1, conta: d => d[0], casas: 0, vivo: false, grupo: "contadores" },
  { pid: 0x0d, rotulo: "Velocidade", unidade: "km/h", bytes: 1, conta: d => d[0], casas: 0, vivo: true, de: 0, ate: 200, grupo: "motor" },
  { pid: 0x43, rotulo: "Carga absoluta", unidade: "%", bytes: 2, conta: d => ((d[0] * 256) + d[1]) * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "motor" },
  { pid: 0x5c, rotulo: "Temperatura do óleo", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0, vivo: true, de: -40, ate: 150, grupo: "motor" },
  { pid: 0x61, rotulo: "Torque pedido ao motor", unidade: "%", bytes: 1, conta: d => d[0] - 125, casas: 0, vivo: true, de: -25, ate: 100, grupo: "motor" },
  { pid: 0x62, rotulo: "Torque entregue pelo motor", unidade: "%", bytes: 1, conta: d => d[0] - 125, casas: 0, vivo: true, de: -25, ate: 100, grupo: "motor" },
  { pid: 0x63, rotulo: "Torque de referência do motor", unidade: "Nm", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: false, grupo: "motor" },
  { pid: 0x45, rotulo: "Borboleta relativa", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x47, rotulo: "Borboleta absoluta B", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x48, rotulo: "Borboleta absoluta C", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x4c, rotulo: "Borboleta comandada pelo módulo", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x49, rotulo: "Pedal do acelerador D", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x4a, rotulo: "Pedal do acelerador E", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x4b, rotulo: "Pedal do acelerador F", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x5a, rotulo: "Pedal relativo", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "ar" },
  { pid: 0x33, rotulo: "Pressão do ar (barométrica)", unidade: "kPa", bytes: 1, conta: d => d[0], casas: 0, vivo: true, de: 0, ate: 110, grupo: "ar" },
  { pid: 0x46, rotulo: "Temperatura do ar de fora", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0, vivo: true, de: -40, ate: 60, grupo: "ar" },
  { pid: 0x08, rotulo: "Ajuste curto de combustível (banco 2)", unidade: "%", bytes: 1, conta: d => (d[0] * 100 / 128) - 100, casas: 1, vivo: true, de: -25, ate: 25, grupo: "combustivel" },
  { pid: 0x09, rotulo: "Ajuste longo de combustível (banco 2)", unidade: "%", bytes: 1, conta: d => (d[0] * 100 / 128) - 100, casas: 1, vivo: true, de: -25, ate: 25, grupo: "combustivel" },
  { pid: 0x44, rotulo: "Mistura comandada (lambda)", unidade: "", bytes: 2, conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, vivo: true, de: 0, ate: 2, grupo: "combustivel" },
  { pid: 0x0a, rotulo: "Pressão de combustível", unidade: "kPa", bytes: 1, conta: d => d[0] * 3, casas: 0, vivo: true, de: 0, ate: 765, grupo: "combustivel" },
  { pid: 0x2f, rotulo: "Nível do tanque", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: false, de: 0, ate: 100, grupo: "combustivel" },
  { pid: 0x52, rotulo: "Etanol no tanque", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: false, de: 0, ate: 100, grupo: "combustivel" },
  { pid: 0x3c, rotulo: "Temperatura do catalisador (banco 1, sonda 1)", unidade: "°C", bytes: 2, conta: d => (((d[0] * 256) + d[1]) / 10) - 40, casas: 0, vivo: true, de: 0, ate: 900, grupo: "catalisador" },
  { pid: 0x3d, rotulo: "Temperatura do catalisador (banco 2, sonda 1)", unidade: "°C", bytes: 2, conta: d => (((d[0] * 256) + d[1]) / 10) - 40, casas: 0, vivo: true, de: 0, ate: 900, grupo: "catalisador" },
  { pid: 0x3e, rotulo: "Temperatura do catalisador (banco 1, sonda 2)", unidade: "°C", bytes: 2, conta: d => (((d[0] * 256) + d[1]) / 10) - 40, casas: 0, vivo: true, de: 0, ate: 900, grupo: "catalisador" },
  { pid: 0x3f, rotulo: "Temperatura do catalisador (banco 2, sonda 2)", unidade: "°C", bytes: 2, conta: d => (((d[0] * 256) + d[1]) / 10) - 40, casas: 0, vivo: true, de: 0, ate: 900, grupo: "catalisador" },
  { pid: 0x23, rotulo: "Pressão do rail", unidade: "kPa", bytes: 2, conta: d => ((d[0] * 256) + d[1]) * 10, casas: 0, vivo: true, de: 0, ate: 200000, grupo: "injecao" },
  { pid: 0x59, rotulo: "Pressão do rail (absoluta)", unidade: "kPa", bytes: 2, conta: d => ((d[0] * 256) + d[1]) * 10, casas: 0, vivo: true, de: 0, ate: 200000, grupo: "injecao" },
  { pid: 0x22, rotulo: "Pressão do rail (sobre o vácuo do coletor)", unidade: "kPa", bytes: 2, conta: d => ((d[0] * 256) + d[1]) * 0.079, casas: 1, vivo: true, de: 0, ate: 5177, grupo: "injecao" },
  { pid: 0x5d, rotulo: "Tempo de injeção", unidade: "°", bytes: 2, conta: d => (((d[0] * 256) + d[1]) / 128) - 210, casas: 1, vivo: true, de: -30, ate: 30, grupo: "injecao" },
  { pid: 0x5e, rotulo: "Consumo de combustível", unidade: "L/h", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 20, casas: 2, vivo: true, de: 0, ate: 40, grupo: "injecao" },
  { pid: 0x2c, rotulo: "EGR comandada", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "injecao" },
  { pid: 0x2d, rotulo: "Erro da EGR", unidade: "%", bytes: 1, conta: d => (d[0] * 100 / 128) - 100, casas: 1, vivo: true, de: -100, ate: 100, grupo: "injecao" },
  { pid: 0x2e, rotulo: "Purga do cânister comandada", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true, de: 0, ate: 100, grupo: "evap" },
  { pid: 0x32, rotulo: "Pressão de vapor do tanque", unidade: "Pa", bytes: 2, conta: d => sinal16((d[0] * 256) + d[1]) / 4, casas: 1, vivo: true, de: -2000, ate: 2000, grupo: "evap" },
  { pid: 0x53, rotulo: "Pressão de vapor do tanque (absoluta)", unidade: "kPa", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 200, casas: 2, vivo: true, de: 0, ate: 328, grupo: "evap" },
  { pid: 0x54, rotulo: "Pressão de vapor do tanque (ampla)", unidade: "Pa", bytes: 2, conta: d => sinal16((d[0] * 256) + d[1]), casas: 0, vivo: true, de: -32767, ate: 32768, grupo: "evap" },
  { pid: 0x4d, rotulo: "Tempo com a luz acesa", unidade: "min", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: false, grupo: "contadores" },
  { pid: 0x4e, rotulo: "Tempo desde o apagamento", unidade: "min", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: false, grupo: "contadores" },
  { pid: 0xa6, rotulo: "Odômetro do módulo", unidade: "km", bytes: 4, conta: d => (((d[0] * 16777216) + (d[1] * 65536) + (d[2] * 256) + d[3]) / 10), casas: 0, vivo: false, grupo: "contadores" },

  // SONDAS (19/11/2026). Cada PID de sonda traz DOIS números no mesmo pedido, por isso a tabela
  // aceita `partes`. Banda estreita (0x14–0x1B): tensão e o ajuste que aquela sonda provoca —
  // quando o segundo byte vem 0xFF, aquela sonda não entra na conta do ajuste e a parte some.
  // Banda larga (0x24–0x2B): lambda de verdade e tensão. Planta dos bytes conferida no J1979.
  { pid: 0x14, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 1 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 1 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x15, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 2 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 2 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x16, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 3 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 3 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x17, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 4 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 4 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x18, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 5 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 5 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x19, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 6 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 6 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x1a, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 7 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 7 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x1b, bytes: 2, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda 8 (tensão)", unidade: "V", conta: d => d[0] / 200, casas: 3, de: 0, ate: 1.275 },
    { rotulo: "Sonda 8 (ajuste pela sonda)", unidade: "%", conta: d => (d[1] * 100 / 128) - 100, casas: 1, de: -25, ate: 25,
      quando: d => d[1] !== 0xff },
  ] },
  { pid: 0x24, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 1 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 1 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  { pid: 0x25, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 2 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 2 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  { pid: 0x26, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 3 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 3 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  { pid: 0x27, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 4 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 4 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  { pid: 0x28, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 5 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 5 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  { pid: 0x29, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 6 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 6 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  { pid: 0x2a, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 7 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 7 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  { pid: 0x2b, bytes: 4, grupo: "sondas", vivo: true, partes: [
    { rotulo: "Sonda larga 8 (lambda)", unidade: "", conta: d => ((d[0] * 256) + d[1]) * 2 / 65536, casas: 3, de: 0, ate: 2 },
    { rotulo: "Sonda larga 8 (tensão)", unidade: "V", conta: d => ((d[2] * 256) + d[3]) * 8 / 65536, casas: 3, de: 0, ate: 8 },
  ] },
  // TEMPERATURA DO ESCAPE: 9 bytes, o primeiro é o mapa de quais dos quatro sensores existem;
  // só aparece o sensor que o próprio carro marcou como presente.
  { pid: 0x78, bytes: 9, grupo: "injecao", vivo: true, partes: [
    { rotulo: "Temperatura do escape (banco 1, sensor 1)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[1] * 256) + d[2]) / 10) - 40, quando: d => (d[0] & (1 << 0)) !== 0 },
    { rotulo: "Temperatura do escape (banco 1, sensor 2)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[3] * 256) + d[4]) / 10) - 40, quando: d => (d[0] & (1 << 1)) !== 0 },
    { rotulo: "Temperatura do escape (banco 1, sensor 3)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[5] * 256) + d[6]) / 10) - 40, quando: d => (d[0] & (1 << 2)) !== 0 },
    { rotulo: "Temperatura do escape (banco 1, sensor 4)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[7] * 256) + d[8]) / 10) - 40, quando: d => (d[0] & (1 << 3)) !== 0 },
  ] },
  { pid: 0x79, bytes: 9, grupo: "injecao", vivo: true, partes: [
    { rotulo: "Temperatura do escape (banco 2, sensor 1)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[1] * 256) + d[2]) / 10) - 40, quando: d => (d[0] & (1 << 0)) !== 0 },
    { rotulo: "Temperatura do escape (banco 2, sensor 2)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[3] * 256) + d[4]) / 10) - 40, quando: d => (d[0] & (1 << 1)) !== 0 },
    { rotulo: "Temperatura do escape (banco 2, sensor 3)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[5] * 256) + d[6]) / 10) - 40, quando: d => (d[0] & (1 << 2)) !== 0 },
    { rotulo: "Temperatura do escape (banco 2, sensor 4)", unidade: "°C", casas: 0, de: -40, ate: 1000,
      conta: d => (((d[7] * 256) + d[8]) / 10) - 40, quando: d => (d[0] & (1 << 3)) !== 0 },
  ] },
];

/**
 * Resposta de um PID do serviço 01 (ou 02, a foto da falha) → LISTA de leituras.
 * É lista porque um PID pode trazer mais de um número: a sonda manda lambda E tensão no mesmo
 * pedido, e a temperatura do escape manda até quatro sensores. Cada leitura ganha uma `chave`
 * própria (pid + a posição dentro dele), que é por onde a tela identifica cada mostrador.
 * PID simples devolve uma lista de um só.
 */
export function valorPid(hex, pid, servico = 0x01) {
  const linha = PIDS.find(p => p.pid === pid);
  if (!linha) return [];
  const d = dadosDa(hex, servico);
  if (!d || d.length < 2 || d[0] !== pid) return [];
  const dados = servico === 0x02 ? d.slice(2) : d.slice(1);           // o serviço 02 traz o nº da foto
  if (dados.length < linha.bytes) return [];
  const partes = linha.partes || [linha];
  const saida = [];
  partes.forEach((parte, i) => {
    // `quando` deixa a parte dizer que não existe neste carro (sonda ausente, sensor fora do mapa)
    if (parte.quando) { try { if (!parte.quando(dados)) return; } catch (e) { return; } }
    let valor;
    try { valor = parte.conta(dados); } catch (e) { return; }
    if (typeof valor !== "number" || !isFinite(valor)) return;
    saida.push({
      pid, parte: i, chave: pid * 100 + i,
      rotulo: parte.rotulo, unidade: parte.unidade,
      valor: arred(valor, parte.casas), de: parte.de, ate: parte.ate,
    });
  });
  return saida;
}

/* ---- prontidão dos monitores (serviço 01, PID 01) ----
 * É o que diz se a falha foi apagada há pouco: monitor "não pronto" significa que o módulo foi
 * zerado e ainda não terminou os próprios testes.
 */
const MONITORES_BASE = [
  ["Falha de combustão", 0], ["Sistema de combustível", 1], ["Componentes", 2],
];
const MONITORES_OTTO = [
  ["Catalisador", 0], ["Catalisador aquecido", 1], ["Sistema EVAP", 2], ["Ar secundário", 3],
  ["Fluido do ar-condicionado", 4], ["Sonda lambda", 5], ["Aquecedor da sonda", 6], ["EGR / VVT", 7],
];

/** Resposta do PID 01 → { luzAcesa, quantidade, diesel, monitores: [{nome, pronto}] } */
export function monitoresDe(hex) {
  const d = dadosDa(hex, 0x01);
  if (!d || d.length < 5 || d[0] !== 0x01) return null;
  const [, a, b, c, e] = d;
  const diesel = ((b >> 3) & 1) === 1;
  const monitores = [];
  for (const [nome, bit] of MONITORES_BASE) {
    if (((b >> bit) & 1) === 1) monitores.push({ nome, pronto: ((b >> (bit + 4)) & 1) === 0 });
  }
  // A terceira e a quarta letra só valem para motor a gasolina/flex; no diesel os monitores são outros,
  // e o padrão não diz quais: nesse caso só mostramos os três de cima, sem inventar nome.
  if (!diesel) {
    for (const [nome, bit] of MONITORES_OTTO) {
      if (((c >> bit) & 1) === 1) monitores.push({ nome, pronto: ((e >> bit) & 1) === 0 });
    }
  }
  return {
    luzAcesa: ((a >> 7) & 1) === 1,
    quantidade: a & 0x7f,
    diesel,
    monitores,
    prontos: monitores.filter(m => m.pronto).length,
    total: monitores.length,
  };
}

/* ---- resultados dos testes de bordo (serviço 06) ----
 * Mostra o catalisador e a sonda PIORANDO antes de dar código: cada teste vem com o valor medido e
 * o limite, então dá para ver a margem que sobra. A escala para mostrar em unidade de verdade só
 * existe aqui onde está conferida; o que não está aparece como número cru, sem unidade inventada.
 * Dá para crescer conferindo contra o Raven, aos poucos.
 */
const ESCALAS = {
  0x01: [1, ""], 0x07: [0.25, "rpm"], 0x09: [1, "km/h"], 0x0b: [0.001, "V"], 0x12: [1, "s"],
  0x24: [1, "contagens"],   // "counts, 1 count/bit" — é a escala das contagens de falha de combustão
};

/** Na tabela de escalas do J1979 os identificadores de $80 em diante são valores COM SINAL. */
const comSinal = uas => uas >= 0x80;
const inteiro16 = (alto, baixo, sinal) => {
  const v = (alto << 8) | baixo;
  return sinal && v > 0x7fff ? v - 0x10000 : v;
};

/** Nomes que o padrão define. O resto fica como "Monitor $XX": melhor sem nome que com nome errado. */
function nomeMid(mid) {
  if (mid >= 0x01 && mid <= 0x04) return "Sonda lambda · banco 1, sensor " + mid;
  if (mid >= 0x05 && mid <= 0x08) return "Sonda lambda · banco 2, sensor " + (mid - 4);
  if (mid >= 0x21 && mid <= 0x24) return "Catalisador · banco " + (mid - 0x20);
  if (mid === MID_FALHA_GERAL) return "Falha de combustão · geral";
  if (cilindroDoMid(mid)) return "Falha de combustão · cilindro " + cilindroDoMid(mid);
  return "Monitor $" + mid.toString(16).toUpperCase().padStart(2, "0");
}

/* ---- Falha de combustão por cilindro (serviço 06) ----
 * O módulo CONTA cada falha de combustão por cilindro. É o número que o corte de bico procura, só que
 * sem cortar nada: o próprio carro diz quantas vezes o cilindro 3 falhou.
 * $A1 é o monitor geral e $A2 em diante é um por cilindro ($A2 = cilindro 1). Em cada um:
 * TID $0B = média dos últimos 10 ciclos de condução; TID $0C = o ciclo atual. Contagem de 0 a 65.535. */
export const MID_FALHA_GERAL = 0xa1, MID_CILINDRO_1 = 0xa2, CILINDROS_MAX = 12;
export const TID_MEDIA_10 = 0x0b, TID_CICLO = 0x0c;
/** $A2 → 1, $A3 → 2 … $AD → 12. Qualquer outro MID devolve 0. */
export const cilindroDoMid = mid => (mid >= MID_CILINDRO_1 && mid < MID_CILINDRO_1 + CILINDROS_MAX ? mid - MID_CILINDRO_1 + 1 : 0);
export const MIDS_FALHA = [MID_FALHA_GERAL].concat(Array.from({ length: CILINDROS_MAX }, (_, i) => MID_CILINDRO_1 + i));
export function nomeTeste(mid, tid) {
  if (cilindroDoMid(mid) || mid === MID_FALHA_GERAL) {
    if (tid === TID_MEDIA_10) return "Média dos últimos 10 ciclos";
    if (tid === TID_CICLO) return "Neste ciclo de condução";
  }
  return "";
}

/** Resposta de um MID do serviço 06 → lista de testes com valor, limites e passou/não passou */
export function testesDe(hex) {
  const d = dadosDa(hex, 0x06);
  if (!d) return [];
  const testes = [];
  for (let i = 0; i + 8 < d.length; i += 9) {
    const mid = d[i], tid = d[i + 1], uas = d[i + 2];
    if (!mid) continue;
    const sinal = comSinal(uas);
    const cru = inteiro16(d[i + 3], d[i + 4], sinal);
    const minimo = inteiro16(d[i + 5], d[i + 6], sinal);
    const maximo = inteiro16(d[i + 7], d[i + 8], sinal);
    const escala = ESCALAS[uas];
    const conv = v => escala ? arred(v * escala[0], 3) : v;
    testes.push({
      mid, tid, nome: nomeMid(mid), teste: nomeTeste(mid, tid),
      valor: conv(cru), minimo: conv(minimo), maximo: conv(maximo),
      unidade: escala ? escala[1] : "",
      escalaConhecida: !!escala,
      comSinal: sinal,
      passou: cru >= minimo && cru <= maximo,
    });
  }
  return testes;
}

/** Bitmask de "quais existem" (serviço 06 MID 00, serviço 01 PID 00…) → lista de números disponíveis */
export function suportados(hex, servico, grupo) {
  const d = dadosDa(hex, servico);
  if (!d || d.length < 5 || d[0] !== grupo) return [];
  const lista = [];
  for (let byte = 0; byte < 4; byte++) {
    for (let bit = 0; bit < 8; bit++) {
      if ((d[1 + byte] >> (7 - bit)) & 1) lista.push(grupo + byte * 8 + bit + 1);
    }
  }
  return lista;
}

/* ============================================================ ponte com o plugin nativo */

/** O plugin só existe dentro do APK. No navegador comum não existe, e a tela avisa. */
export function plugin() {
  const C = typeof window !== "undefined" ? window.Capacitor : null;
  if (!C) return null;
  if (C.Plugins && C.Plugins.DtcarObd) return C.Plugins.DtcarObd;
  if (typeof C.registerPlugin === "function") {
    try { return C.registerPlugin("DtcarObd"); } catch (e) { /* APK antigo, sem o plugin */ }
  }
  return null;
}

export const disponivel = () => !!plugin();

/** motivos que o plugin devolve → frase para o mecânico */
const MOTIVOS = {
  "sem-permissao": "O app precisa da permissão de Bluetooth. Toque em Permitir quando o Android pedir.",
  "sem-bluetooth": "Este celular não tem Bluetooth.",
  "bluetooth-desligado": "Ligue o Bluetooth do celular.",
  "sem-endereco": "Escolha o adaptador.",
  "endereco-invalido": "Adaptador não reconhecido. Pareie de novo nos Ajustes do Android.",
  "nao-conectou": "Não conectou no adaptador. Confira se ele está encaixado na tomada do carro e pareado no celular.",
  "sem-conexao": "A conexão com o adaptador caiu. Conecte de novo.",
  "conexao-caiu": "A conexão com o adaptador caiu no meio da leitura. Conecte de novo.",
  "sem-comando": "Comando vazio.",
  "comando-recusado": "Este comando não é permitido nesta etapa (a leitura não escreve no carro).",
  "falhou": "O adaptador respondeu de um jeito que o app não esperava.",
  "demorou": "O adaptador não respondeu no tempo. Confira o encaixe na tomada e tente de novo.",
};
export const motivoDe = e => MOTIVOS[e && (e.message || e.code || e)] || "Não deu para falar com o adaptador.";

const P = () => {
  const p = plugin();
  if (!p) throw new Error("sem-plugin");
  return p;
};

export const permissao = () => P().permissao();
export const pedirPermissao = () => P().pedirPermissao();
export const listar = () => P().listar().then(r => (r && r.aparelhos) || []);
export const situacao = () => P().situacao();
export const conectar = endereco => P().conectar({ endereco });
export const desconectar = () => P().desconectar().catch(() => ({ conectado: false }));

/**
 * Manda um comando e devolve o texto cru.
 * O tempo-limite daqui é a rede de segurança: se a parte nativa parar de responder por qualquer
 * motivo, a tela mostra o aviso em vez de ficar em "Lendo…" para sempre.
 */
export function comando(cmd, esperaMs) {
  const espera = esperaMs || 5000;
  const pedido = P().comando({ cmd, esperaMs: espera }).then(r => (r && r.resposta) || "");
  const relogio = new Promise((_, falhar) => setTimeout(() => falhar(new Error("demorou")), espera + 4000));
  return Promise.race([pedido, relogio]);
}

/** Manda um comando de OBD e já devolve { respostas, hex, erro }. */
export const pedir = (cmd, esperaMs) => comando(cmd, esperaMs).then(juntarLinhas);

/* ---- preparar o adaptador ----
 * ATZ reinicia, ATE0 tira o eco, ATL0 e ATS0 tiram quebra de linha e espaço (resposta menor),
 * ATH0 tira o cabeçalho e ATSP0 deixa o adaptador descobrir sozinho o protocolo do carro.
 */
const INICIO = [["ATZ", 3000], ["ATE0", 2000], ["ATL0", 2000], ["ATS0", 2000], ["ATH0", 2000], ["ATSP0", 2000]];

/** Faixas de PID e de MID: a última posição de cada faixa avisa que existe a faixa seguinte. */
// As faixas vão até $C0 porque o odômetro do módulo é o PID $A6: sem andar até lá ele nunca
// apareceria. Andar não custa nada em carro que não tem — a varredura para na primeira faixa que
// não avisa a seguinte.
export const FAIXAS_PID = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0];
// Até $C0 como as faixas de PID: as contagens de falha de combustão por cilindro são os MIDs $A1-$AD e,
// sem andar até lá, nenhuma delas apareceria.
const FAIXAS_MID = [0x00, 0x20, 0x40, 0x60, 0x80, 0xa0, 0xc0];

/**
 * Anda nas faixas de um serviço e junta tudo o que o carro informa que tem.
 * Sem andar nas faixas, o serviço 01 só devolveria os PIDs de $01 a $20 — e aí a tensão do módulo
 * ($42) e as distâncias desde o apagamento ($21 e $31) nunca apareceriam na tela.
 */
async function suportadosEmFaixas(servico, faixas) {
  const todos = [];
  const sv = servico.toString(16).toUpperCase().padStart(2, "0");
  for (const base of faixas) {
    const r = await pedir(sv + base.toString(16).toUpperCase().padStart(2, "0"), 6000);
    if (r.erro) break;
    const hex = primeiraDe(r.respostas, servico);
    if (!hex) break;
    const achados = suportados(hex, servico, base);
    for (const x of achados) if (!todos.includes(x)) todos.push(x);
    if (!achados.includes(base + 0x20)) break;                        // sem aviso de faixa seguinte: para aqui
  }
  return todos;
}

/** Prepara o adaptador e descobre o protocolo. Devolve { protocolo, pidsSuportados }. */
export async function iniciar() {
  for (const [cmd, espera] of INICIO) await comando(cmd, espera);
  // o primeiro pedido de verdade é o que faz o adaptador achar o protocolo do carro: pode demorar
  const primeiro = await pedir("0100", 12000);
  if (primeiro.erro) throw new Error(primeiro.erro);
  const protocolo = (await comando("ATDP", 3000)).replace(/[\r\n>]/g, "").trim();
  const base = suportados(primeiraDe(primeiro.respostas, 0x01), 0x01, 0x00);
  const resto = base.includes(0x20) ? await suportadosEmFaixas(0x01, FAIXAS_PID.slice(1)) : [];
  const pidsSuportados = base.concat(resto.filter(p => !base.includes(p)));
  return { protocolo, pidsSuportados };
}

/* ---- leituras de alto nível ---- */

/** Códigos de falha, com a situação de cada um. */
export async function lerFalhas() {
  const pedidos = [["03", 0x03, "atual"], ["07", 0x07, "pendente"], ["0A", 0x0a, "permanente"]];
  const falhas = [];
  const erros = [];
  let variosModulos = false;
  for (const [cmd, servico, situacao] of pedidos) {
    const r = await pedir(cmd, 8000);
    if (r.erro) { erros.push({ situacao, erro: r.erro }); continue; }
    const { codigos, modulos } = codigosDeTodas(r.respostas, servico);
    if (!modulos) { erros.push({ situacao, erro: "Resposta fora do padrão." }); continue; }
    if (modulos > 1) variosModulos = true;
    for (const c of codigos) if (!falhas.some(f => f.codigo === c && f.situacao === situacao)) falhas.push({ codigo: c, situacao });
  }
  return { falhas, erros, variosModulos };
}

/** Dados ao vivo, uma volta só: os PIDs que o carro disse que tem. */
export async function lerAoVivo(pidsSuportados) {
  const quais = PIDS.map(p => p.pid).filter(p => !pidsSuportados || !pidsSuportados.length || pidsSuportados.includes(p));
  const linhas = [];
  for (const pid of quais) {
    const r = await pedir("01" + pid.toString(16).toUpperCase().padStart(2, "0"), 4000);
    if (r.erro) continue;
    for (const v of valorPid(primeiraDe(r.respostas, 0x01), pid, 0x01)) linhas.push(v);
  }
  return linhas;
}

/**
 * As leituras que valem para este carro, na ordem dos grupos.
 * `suportados` é o que o CARRO respondeu (manda sempre); `escolhidos` é o que o mecânico marcou no
 * filtro (vazio = todas as que o carro tiver).
 */
export function leiturasPara(suportados, escolhidos) {
  const temLista = suportados && suportados.length;
  const marcou = escolhidos && escolhidos.length;
  const ordem = GRUPOS.map(g => g.id);
  return PIDS
    .filter(p => (!temLista || suportados.includes(p.pid)) && (!marcou || escolhidos.includes(p.pid)))
    .slice()
    .sort((a, b) => ordem.indexOf(a.grupo) - ordem.indexOf(b.grupo));
}

/* ---- LEITURA DE COMBUSTÍVEL (pedido do Danilo, 19/11/2026) ----
 * O que mais chega na oficina é carro com a injeção perdida no reconhecimento do combustível: a
 * qualidade do que se vende varia e o módulo leva tempo para reaprender. Esta é a leitura do
 * primeiro contato — quanto o módulo está CORRIGINDO para o motor andar.
 *
 * O número que importa é a soma do ajuste curto com o longo: é a correção que vale agora.
 * Positivo = o módulo está PONDO combustível (a mistura estava pobre). Negativo = está TIRANDO
 * (estava rica). As faixas abaixo são as gerais do OBD, as mesmas que qualquer scanner usa —
 * NÃO são a faixa de normalidade daquele motor, que só a montadora publica. A tela mostra os
 * números e as causas possíveis; quem decide é o mecânico.
 */
export const PIDS_COMBUSTIVEL = [0x06, 0x07, 0x08, 0x09, 0x52, 0x44, 0x0a, 0x23, 0x59, 0x22, 0x5d,
  0x5e, 0x2f, 0x04, 0x0c, 0x05, 0x10, 0x14, 0x15, 0x16, 0x17, 0x24, 0x25, 0x26, 0x27];
/** daqui para cima o ajuste merece olhada; daqui para cima está no limite */
export const AJUSTE_ATENCAO = 10, AJUSTE_GRAVE = 25;

/** A correção de um banco a partir dos valores já lidos (chave = pid * 100 + parte). */
function bancoDe(v, pidCurto, pidLongo, nome) {
  const c = v[pidCurto * 100], l = v[pidLongo * 100];
  if (!c && !l) return null;
  const curto = c ? c.valor : null, longo = l ? l.valor : null;
  return { nome, curto, longo, total: arred((curto || 0) + (longo || 0), 1) };
}

const umaCasa = n => String(arred(n, 1)).replace(".", ",");

/**
 * Lê o que já veio dos dados ao vivo e devolve a conversa pronta.
 * `valores` = { chave: leitura }, do jeito que a tela guarda.
 */
export function leituraCombustivel(valores) {
  const v = valores || {};
  const bancos = [bancoDe(v, 0x06, 0x07, "Banco 1"), bancoDe(v, 0x08, 0x09, "Banco 2")].filter(Boolean);
  const etanol = v[0x52 * 100] ? v[0x52 * 100].valor : null;
  const frases = [], causas = [];
  let situacao = "sem_dados", pior = null;

  if (!bancos.length) {
    frases.push("Este módulo não informou o ajuste de combustível, então não dá para dizer quanto ele está corrigindo.");
  } else {
    pior = bancos.reduce((a, b) => (!a || Math.abs(b.total) > Math.abs(a.total) ? b : a), null);
    const t = pior.total, abs = Math.abs(t);
    const onde = bancos.length > 1 ? " no " + pior.nome.toLowerCase() : "";
    if (abs < AJUSTE_ATENCAO) {
      situacao = "normal";
      frases.push("O módulo está corrigindo " + umaCasa(t) + "%" + onde + " — dentro do que se espera de um motor em ordem.");
    } else {
      situacao = abs >= AJUSTE_GRAVE ? "grave" : "atencao";
      frases.push("O módulo está " + (t > 0 ? "PONDO" : "TIRANDO") + " " + umaCasa(abs) + "% de combustível" + onde +
        ": sozinha, a mistura estava " + (t > 0 ? "pobre" : "rica") + ".");
      if (abs >= AJUSTE_GRAVE) frases.push("Passou de " + AJUSTE_GRAVE + "%: é correção no limite, e costuma vir junto com luz acesa.");
      (t > 0
        ? ["Entrada de ar falsa (mangueira, junta, respiro)", "Medidor de ar (MAF) sujo ou lendo baixo",
           "Pressão de combustível baixa: bomba ou filtro", "Bico entupido", "Sonda lenta ou envenenada",
           "Combustível com MAIS álcool do que o módulo calculou"]
        : ["Bico vazando ou com vazão alta", "Pressão de combustível alta: regulador",
           "Medidor de ar (MAF) lendo alto", "Sonda presa em rica", "Cânister empurrando vapor para o motor",
           "Combustível com MENOS álcool do que o módulo calculou"]).forEach(c => causas.push(c));
    }
    if (bancos.length > 1) {
      const dif = Math.abs(bancos[0].total - bancos[1].total);
      if (dif >= AJUSTE_ATENCAO) frases.push("Os dois bancos estão longe um do outro (" + umaCasa(dif) +
        "% de diferença): procure do lado que corrige mais, não no que é comum aos dois.");
    }
  }

  if (etanol !== null) frases.push("Combustível no tanque, pela conta do módulo: " + umaCasa(etanol) + "% de etanol — o resto é gasolina.");
  else frases.push("Este carro não informa a porcentagem de etanol: a maioria dos flex calcula pela sonda e nem todo módulo publica essa conta.");

  return { situacao, bancos, pior, etanol, frases, causas, atencao: AJUSTE_ATENCAO, grave: AJUSTE_GRAVE };
}

/** O grupo de uma leitura já lida (a tela usa para separar painel e lista por assunto). */
export function grupoDaLeitura(l) {
  const linha = PIDS.find(p => p.pid === l.pid);
  return linha ? linha.grupo : "";
}

/** Onde a leitura entra na ordem da tela: pela posição do PID na tabela e depois pela parte. */
export function ordemDaLeitura(l) {
  const i = PIDS.findIndex(p => p.pid === l.pid);
  return (i < 0 ? 999 : i) * 100 + (l.parte || 0);
}

/** Os grupos que têm pelo menos uma leitura neste carro, para montar o filtro. */
export function gruposPara(suportados, combustivel) {
  const lista = leiturasPara(suportados, null);
  const tipo = tipoDeMotor(combustivel);
  return GRUPOS
    .filter(g => !g.so || !tipo || g.so === tipo)
    .map(g => Object.assign({}, g, { leituras: lista.filter(p => p.grupo === g.id) }))
    .filter(g => g.leituras.length);
}

/** "DIESEL", "Álcool/Gasolina", "Flex"… → "diesel" | "otto" | null (quando não dá para saber) */
export function tipoDeMotor(combustivel) {
  const t = String(combustivel || "").toUpperCase();
  if (!t) return null;
  if (t.includes("DIESEL")) return "diesel";
  if (/ALCOOL|ÁLCOOL|GASOLINA|FLEX|ETANOL|GNV|HIBRIDO|HÍBRIDO/.test(t)) return "otto";
  return null;
}

/** quantas vezes um PID pode não responder antes de sair da roda */
const PACIENCIA = 2;
/** tempo de espera de cada leitura da roda: curto, para um PID mudo não travar o ritmo */
const ESPERA_VIVO = 1500;
/** respiro entre uma volta e outra, para a roda não monopolizar o aparelho */
const PAUSA_VOLTA = 60;
/** de quantas em quantas voltas a roda dá uma olhada nas falhas */
const VOLTAS_ATE_FALHA = 8;

/**
 * Dados ao vivo DE VERDADE: fica girando e avisando a cada valor que chega, até mandarem parar.
 *
 * O ELM327 atende um pedido por vez, então "tempo real" aqui é uma roda rápida: pede um PID, mostra
 * o que voltou na hora, pede o seguinte. Avisar valor por valor (e não no fim da volta) é o que faz
 * a tela se mexer o tempo todo em vez de piscar de vez em quando.
 *
 * Três coisas que mantêm o ritmo:
 *  - PID que não responde duas vezes sai da roda (carro que não tem aquele dado não atrasa o resto);
 *  - os que não mudam (distâncias, aquecimentos) só entram na primeira volta;
 *  - a espera de cada leitura é curta.
 *
 * `aoValor(valor, volta)` é chamado a cada leitura boa. `continuar()` é perguntado o tempo todo:
 * devolveu falso, a roda para. Devolve o número de voltas completadas.
 */
export async function lerAoVivoSeguido(pidsSuportados, aoValor, continuar, opc = {}) {
  const quais = leiturasPara(pidsSuportados, opc.escolhidos);
  if (!quais.length) return 0;
  const mudos = {};
  let volta = 0;
  while (continuar()) {
    volta++;
    let leuAlgo = false;
    for (const p of quais) {
      if (!continuar()) return volta - 1;
      if ((mudos[p.pid] || 0) >= PACIENCIA) continue;                 // já não responde: fora da roda
      if (volta > 1 && !p.vivo) continue;                             // não muda: lido só na 1ª volta
      const r = await pedir("01" + p.pid.toString(16).toUpperCase().padStart(2, "0"), ESPERA_VIVO);
      const lidos = r.erro ? [] : valorPid(primeiraDe(r.respostas, 0x01), p.pid, 0x01);
      if (lidos.length) {
        mudos[p.pid] = 0;
        leuAlgo = true;
        for (const v of lidos) aoValor(v, volta);
      } else {
        mudos[p.pid] = (mudos[p.pid] || 0) + 1;
      }
    }
    // volta inteira sem ninguém responder: o carro desligou ou o adaptador saiu. Parar é melhor que
    // girar à toa gastando bateria e deixando a tela mentindo que está lendo.
    if (!leuAlgo) return volta;
    // De vez em quando dá uma olhada nas falhas SEM parar a roda: falha que nasce com o motor
    // trabalhando (o mecânico acelerando, mexendo num chicote) é justamente a que interessa pegar,
    // e ela não apareceria até alguém lembrar de abrir a tela de falhas. Um pedido a cada
    // VOLTAS_ATE_FALHA voltas custa quase nada perto das 12 leituras de cada volta.
    if (opc.aoFalhas && volta % VOLTAS_ATE_FALHA === 0 && continuar()) {
      const r = await pedir("03", ESPERA_VIVO);
      if (!r.erro) {
        const { codigos, modulos } = codigosDeTodas(r.respostas, 0x03);
        if (modulos) opc.aoFalhas(codigos);
      }
    }
    await new Promise(r => setTimeout(r, PAUSA_VOLTA));
  }
  return volta;
}

/**
 * A foto do momento em que a falha gravou (serviço 02): diz se deu com o motor frio, em carga, etc.
 * Só pede os PIDs que o carro informou ter, senão são 15 pedidos de 4 s num carro que responde
 * NO DATA à maioria — perto de um minuto de espera para nada.
 */
export async function lerFoto(pidsSuportados) {
  const quais = PIDS.map(p => p.pid).filter(p => !pidsSuportados || !pidsSuportados.length || pidsSuportados.includes(p));
  const linhas = [];
  for (const pid of quais) {
    const r = await pedir("02" + pid.toString(16).toUpperCase().padStart(2, "0") + "00", 4000);
    if (r.erro) continue;
    for (const v of valorPid(primeiraDe(r.respostas, 0x02), pid, 0x02)) linhas.push(v);
  }
  return linhas;
}

/** Prontidão dos monitores. */
export async function lerMonitores() {
  const r = await pedir("0101", 5000);
  if (r.erro) throw new Error(r.erro);
  const m = monitoresDe(primeiraDe(r.respostas, 0x01));
  if (!m) throw new Error("Resposta fora do padrão.");
  return m;
}

/** Chassi lido no módulo (pode não existir em carro mais antigo). */
export async function lerChassi() {
  const r = await pedir("0902", 8000);
  if (r.erro) return "";
  return vinDe(primeiraDe(r.respostas, 0x09));
}

/** Resultados dos testes de bordo (serviço 06), MID por MID. */
export async function lerTestes() {
  const base = await pedir("0600", 6000);
  if (base.erro) return { testes: [], erro: base.erro };
  const primeira = suportados(primeiraDe(base.respostas, 0x06), 0x06, 0x00);
  const resto = primeira.includes(0x20) ? await suportadosEmFaixas(0x06, FAIXAS_MID.slice(1)) : [];
  const mids = primeira.concat(resto.filter(m => !primeira.includes(m)));
  const testes = [];
  // As contagens de falha de combustão vêm no fim da lista ($A1-$AD) e eram justamente as que a trava
  // de 32 cortava. Elas vão na frente; o resto vem depois, com a trava inteira.
  const deFalha = mids.filter(m => MIDS_FALHA.includes(m));
  const demais = mids.filter(m => m % 0x20 !== 0 && !deFalha.includes(m));
  for (const mid of deFalha.concat(demais).slice(0, 48)) {  // trava: nunca varre tudo
    const r = await pedir("06" + mid.toString(16).toUpperCase().padStart(2, "0"), 5000);
    if (r.erro) continue;
    for (const t of testesDe(primeiraDe(r.respostas, 0x06))) testes.push(t);
  }
  return { testes, erro: "" };
}

/* ---- Falha de combustão por cilindro: o que o corte de bico procura, sem cortar nada ----
 * O módulo já conta cada falha por cilindro. A regra de leitura é COMPARAR OS CILINDROS ENTRE SI:
 * número absoluto não diz nada (depende do motor e de quanto o carro andou desde o apagamento);
 * um cilindro destoando dos outros é que aponta ignição, combustível ou compressão daquele cilindro.
 * A tela não dá veredito — mostra as contagens e diz onde procurar. */
export const FALHA_DESTAQUE = 3;      // quantas vezes acima do segundo pior para apontar um cilindro
export const FALHA_MINIMA = 10;       // abaixo disso é ruído: não aponta ninguém
export function falhaPorCilindro(testes) {
  const porCil = new Map();
  for (const t of testes || []) {
    const cil = cilindroDoMid(t.mid);
    if (!cil || typeof t.valor !== "number") continue;
    const e = porCil.get(cil) || { cilindro: cil };
    if (t.tid === TID_CICLO) e.ciclo = t.valor;
    else if (t.tid === TID_MEDIA_10) e.media = t.valor;
    porCil.set(cil, e);
  }
  const cilindros = Array.from(porCil.values()).filter(c => typeof c.ciclo === "number" || typeof c.media === "number")
    .sort((a, b) => a.cilindro - b.cilindro);
  if (!cilindros.length) return null;                 // carro que não informa: a tela diz isso, não inventa zero
  const conta = c => (typeof c.ciclo === "number" ? c.ciclo : c.media);
  const total = cilindros.reduce((soma, c) => soma + conta(c), 0);
  const ordem = cilindros.slice().sort((a, b) => conta(b) - conta(a));
  const pior = ordem[0], segundo = ordem[1];
  const destacado = total && conta(pior) >= FALHA_MINIMA && (!segundo || conta(pior) >= FALHA_DESTAQUE * Math.max(conta(segundo), 1)) ? pior : null;
  const frases = [];
  let situacao;
  if (!total) {
    situacao = "limpo";
    frases.push("Nenhuma falha de combustão contada nos cilindros desde o último apagamento.");
  } else if (destacado) {
    situacao = "um_cilindro";
    frases.push("O cilindro " + destacado.cilindro + " conta muito mais que os outros (" + conta(destacado) +
      (segundo ? " contra " + conta(segundo) + " do segundo" : "") + "). É nele que se procura: ignição, combustível ou compressão.");
  } else {
    situacao = "espalhado";
    frases.push("As contagens estão parecidas entre os cilindros (" + total + " no total). Falha espalhada costuma ser de algo comum a todos: combustível, pressão, admissão falsa ou compressão geral.");
  }
  const avisos = [
    "Compare os cilindros entre si, não com um número fixo: o que vale é um destoar dos outros.",
    "O módulo conta desde o último apagamento; carro apagado há pouco mostra contagem baixa mesmo com defeito.",
  ];
  if (cilindros.length > 1) avisos.push("Alguns módulos mandam esta lista na ordem de ignição, não na ordem dos cilindros, e há motor que lista cilindro que não existe. Confira o número no carro antes de abrir.");
  return { cilindros, total, pior, segundo, destacado, situacao, frases, avisos };
}

/* ---- Odômetro do módulo contra o KM do cadastro (PID $A6) ----
 * Poucos carros publicam, mas onde publica dá para confrontar. A tela NUNCA acusa: módulo trocado,
 * painel trocado e módulo que conta a própria distância explicam divergência sem ninguém ter mexido. */
export const ODOMETRO_TOLERANCIA = 1000;   // km a menos que ainda cabe em arredondamento e troca de painel
const kmBR = n => Math.round(n).toLocaleString("pt-BR");
export function conferirOdometro(kmModulo, kmCadastro) {
  const m = Number(kmModulo), c = Number(kmCadastro);
  if (!isFinite(m) || m <= 0) return null;
  if (!isFinite(c) || c <= 0) return { situacao: "sem_cadastro", modulo: m, frase: "O cadastro não tem KM para comparar com o do módulo." };
  const dif = Math.round(m - c);
  if (dif === 0) return { situacao: "acima", modulo: m, cadastro: c, diferenca: 0, frase: "Bate com o KM do cadastro." };
  if (dif > 0) return { situacao: "acima", modulo: m, cadastro: c, diferenca: dif,
    frase: "O módulo conta " + kmBR(dif) + " km a mais que o último KM registrado aqui — é o que o carro andou desde então." };
  const falta = -dif;
  if (falta <= ODOMETRO_TOLERANCIA) return { situacao: "perto", modulo: m, cadastro: c, diferenca: dif,
    frase: "O módulo conta " + kmBR(falta) + " km a menos que o cadastro — diferença pequena, cabe em arredondamento." };
  return { situacao: "abaixo", modulo: m, cadastro: c, diferenca: dif,
    frase: "O módulo conta " + kmBR(falta) + " km A MENOS que o último KM registrado aqui. Isso não acusa ninguém: módulo ou painel trocado dá nisso, e há módulo que conta a própria distância. Mas é para conferir antes de fechar a O.S." };
}

/** Só as contagens de falha de combustão (13 MIDs em vez de varrer o serviço 06 inteiro). */
export async function lerFalhaCilindros() {
  const base = await pedir("0600", 6000);
  if (base.erro) return { testes: [], cilindros: null, erro: base.erro };
  const primeira = suportados(primeiraDe(base.respostas, 0x06), 0x06, 0x00);
  const resto = primeira.includes(0x20) ? await suportadosEmFaixas(0x06, FAIXAS_MID.slice(1)) : [];
  const tem = primeira.concat(resto.filter(m => !primeira.includes(m))).filter(m => MIDS_FALHA.includes(m));
  const testes = [];
  for (const mid of tem) {
    const r = await pedir("06" + mid.toString(16).toUpperCase().padStart(2, "0"), 5000);
    if (r.erro) continue;
    for (const t of testesDe(primeiraDe(r.respostas, 0x06))) testes.push(t);
  }
  return { testes, cilindros: falhaPorCilindro(testes), erro: "" };
}

/** Odômetro do módulo (PID $A6), em km. Devolve null quando o carro não informa. */
export async function lerOdometro(pidsSuportados) {
  if (pidsSuportados && pidsSuportados.length && !pidsSuportados.includes(0xa6)) return null;
  const r = await pedir("01A6", 4000);
  if (r.erro) return null;
  const v = valorPid(primeiraDe(r.respostas, 0x01), 0xa6, 0x01);
  return v.length ? v[0].valor : null;
}

/* ---- O que entra na tela sem ninguém pedir (regra do Danilo, 20/11/2026) ----
 * "colocar na tela as leituras padrões e deixar em filtro as outras leituras disponíveis para poder
 * adicionar, e uma opção no filtro de adicionar todas."
 * Mostrar 40 mostradores de uma vez é o mesmo que não mostrar nenhum: ninguém acha o que procura com o
 * carro ligado na frente. Estas são as que o mecânico olha primeiro em qualquer carro; o resto continua
 * a um toque, no filtro. A lista do CARRO manda sempre: padrão que o carro não tem não aparece.
 * Cada volta a menos também deixa as que ficaram atualizarem mais rápido. */
export const PIDS_PADRAO = [
  0x0c,  // rotação
  0x05,  // temperatura do motor
  0x04,  // carga do motor
  0x11,  // borboleta
  0x06,  // ajuste curto
  0x07,  // ajuste longo
  0x0e,  // avanço de ignição
  0x0f,  // temperatura do ar admitido
  0x0b,  // pressão no coletor
  0x10,  // fluxo de ar (MAF)
  0x0d,  // velocidade
  0x42,  // tensão do módulo
];
/** No diesel, ajuste de combustível não existe e a pressão do rail é o que se olha primeiro. */
export const PIDS_PADRAO_DIESEL = [0x0c, 0x05, 0x04, 0x11, 0x0e, 0x0f, 0x0b, 0x10, 0x0d, 0x42, 0x23, 0x5c];
/** As padrão que ESTE carro tem. Sem lista do carro, devolve as padrão mesmo (a tela avisa de onde veio). */
export function padraoPara(suportados, combustivel) {
  const base = tipoDeMotor(combustivel) === "diesel" ? PIDS_PADRAO_DIESEL : PIDS_PADRAO;
  const tem = suportados && suportados.length;
  return base.filter(p => !tem || suportados.includes(p));
}
/**
 * Como a escolha fica guardada no aparelho, em um lugar só (e aceitando o formato antigo, que era só
 * uma lista de PIDs): "padrao" | "todas" | lista de PIDs.
 */
export function escolhaGuardada(valor) {
  if (valor === "todas") return { modo: "todas", pids: [] };
  if (Array.isArray(valor)) return valor.length ? { modo: "escolha", pids: valor.slice() } : { modo: "todas", pids: [] };
  if (valor && typeof valor === "object" && valor.modo) return { modo: valor.modo, pids: Array.isArray(valor.pids) ? valor.pids.slice() : [] };
  return { modo: "padrao", pids: [] };
}
/** Os PIDs que valem agora, a partir do modo escolhido. Devolve null quando é "todas" (= sem filtro). */
export function pidsDaEscolha(escolha, suportados, combustivel) {
  const e = escolhaGuardada(escolha);
  if (e.modo === "todas") return null;
  if (e.modo === "escolha") return e.pids;
  return padraoPara(suportados, combustivel);
}
