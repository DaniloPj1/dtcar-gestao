/**
 * O mapa do carro por MODELO: em que endereço cada módulo responde e quais dados de montadora
 * (serviço 22 e 21) cada um entrega, com bit, escala e unidade.
 *
 * Origem: OBDb (github.com/OBDb), importado por tools_obdb.py para js/modelos/*.js. Carrega só o
 * arquivo do modelo que está na oficina.
 *
 * O QUE ISTO NÃO É: não é definição de fábrica. É levantamento de comunidade, por modelo, e cada
 * comando traz para quais anos ele foi conferido. A tela escreve "não conferido para este ano"
 * quando é o caso — escrito, não só numa cor.
 *
 * Não tem window nem document: dá para testar sem navegador.
 */
import indice from "./modelosdados.js";

const limpo = t => String(t || "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Z0-9]+/g, " ").trim();
const colado = t => limpo(t).replace(/ /g, "");
// O cadastro escreve a marca de vários jeitos; aqui é o nome que o OBDb usa.
const MARCAS = [[/CHEVROLET|^GM\b/, "CHEVROLET"], [/VOLKSWAGEN|^VW\b/, "VOLKSWAGEN"], [/MERCEDES/, "MERCEDES BENZ"], [/LAND ROVER/, "LAND ROVER"],
  [/CITROEN/, "CITROEN"], [/\bRAM\b/, "RAM"]];
const marcaPadrao = m => { const l = limpo(m); for (const [re, n] of MARCAS) if (re.test(l)) return n; return l.split(" ")[0] || ""; };

/**
 * Acha o modelo do cadastro na lista. Devolve a entrada do índice ou null.
 * Ganha o nome de modelo MAIS LONGO que couber: "COROLLA CROSS" não pode cair em "COROLLA".
 */
export function acharModelo(marca, modelo) {
  const m = marcaPadrao(marca), txt = colado(modelo);
  if (!m || !txt) return null;
  let melhor = null;
  for (const e of indice) {
    if (limpo(e.marca) !== m) continue;
    const nome = colado(e.modelo);
    if (nome && txt.includes(nome) && (!melhor || nome.length > colado(melhor.modelo).length)) melhor = e;
  }
  return melhor;
}
export const modelosComMapa = () => indice.slice();

const cargas = {};
let carregador = arq => import("./modelos/" + arq + ".js").then(m => m.default);
export const usarCarregador = fn => { carregador = fn; for (const k of Object.keys(cargas)) delete cargas[k]; };
/** Baixa o mapa do modelo (uma vez). */
export function carregar(entrada) {
  const a = entrada && entrada.arquivo;
  if (!a) return Promise.resolve(null);
  if (!cargas[a]) cargas[a] = carregador(a).catch(e => { delete cargas[a]; throw e; });
  return cargas[a];
}

/* ------------------------------------------------------------------ para que ano vale */
const casa = (f, ano) => !!f && ((f.de != null && ano >= f.de) || (f.ate != null && ano <= f.ate) || (f.anos || []).includes(ano));
/**
 * "conferido" | "nao-conferido" | "fora" — o comando para o ano do carro.
 * Regra do OBDb: `f` são os anos em que o comando vale; `df` os anos em que alguém só experimentou;
 * `nc` marca comando que ninguém confirmou ainda. Sem ano no cadastro, nada é dado como conferido
 * se o comando tiver qualquer restrição de ano.
 */
export function situacaoDoComando(c, ano) {
  const a = parseInt(String(ano || "").slice(-4), 10) || parseInt(ano, 10) || 0;
  if (c.nc) return "nao-conferido";
  if (!a) return c.f || c.df ? "nao-conferido" : "conferido";
  if (c.f) return casa(c.f, a) ? "conferido" : casa(c.df, a) ? "nao-conferido" : "fora";
  return casa(c.df, a) ? "nao-conferido" : "conferido";
}
/** Os comandos que servem para o ano, com a situação junto. */
export function comandosDoAno(dados, ano) {
  return ((dados && dados.comandos) || []).map(c => ({ ...c, situacao: situacaoDoComando(c, ano) })).filter(c => c.situacao !== "fora");
}

/* ------------------------------------------------------------------ os módulos */
const TIPO = { engine: "Motor", transmission: "Câmbio", battery: "Bateria", cluster: "Painel", bodyControl: "Carroceria (BCM)",
  hybridControl: "Sistema híbrido", tpms: "Pressão dos pneus", steering: "Direção", gateway: "Central de rede (gateway)", abs: "ABS",
  airbag: "Airbag", hvac: "Ar-condicionado", motor: "Motor elétrico", telematics: "Telemática" };
// Endereços que a norma do OBD em CAN reserva (ISO 15765-4): valem em qualquer carro.
const PADRAO_11 = { "7E0": "Motor", "7E1": "Câmbio" };
// Honda, 29 bits: duas fontes independentes batem (a ferramenta decodificada da Honda e o OBDb).
const HONDA_29 = { "0E": "Motor", "10": "Motor", "1E": "Câmbio", "28": "ABS/VSA", "30": "Direção elétrica", "53": "Airbag", "60": "Painel", "26": "Pressão dos pneus", "01": "Bateria" };

// Grupo VW: os nomes vêm do acervo de endereços UDS da VAG que o app já tem (catalogo/uds/modulos_vag.json).
const VAG_11 = { "713": "ABS/Freios", "715": "Airbag", "714": "Painel", "710": "Central de rede (gateway)", "70B": "Pressão dos pneus" };

/** Nome do módulo para a tela. Sem tipo conhecido, o endereço fica escrito e nada é inventado. */
export function nomeDoModulo(m, marca) {
  if (m.t && TIPO[m.t]) return TIPO[m.t];
  const p = String(m.p || "");
  if (p.length === 3 && PADRAO_11[p]) return PADRAO_11[p];
  if (p.length === 3 && /VOLKSWAGEN|^VW\b|AUDI|SEAT|SKODA/.test(limpo(marca)) && VAG_11[p]) return VAG_11[p];
  if (p.length === 8 && /HONDA|ACURA/.test(limpo(marca)) && HONDA_29[p.slice(4, 6)]) return HONDA_29[p.slice(4, 6)];
  return "Módulo " + (p.length === 8 ? p.slice(4, 6) : p);
}
/** Os módulos que o mapa diz que este modelo tem, prontos para apontar: { pedido, resposta, nome, sinais }. */
export function modulosDoModelo(dados, marca, ano) {
  const cmds = comandosDoAno(dados, ano);
  return ((dados && dados.modulos) || []).map(m => ({
    pedido: m.p, resposta: m.r, nome: nomeDoModulo(m, marca), tipo: m.t || "",
    sinais: cmds.filter(c => c.p === m.p).reduce((n, c) => n + c.z.length, 0),
  })).filter(m => m.sinais > 0);
}

/* ------------------------------------------------------------------ o valor de um sinal */
const UNIDADE = { percent: "%", celsius: "°C", fahrenheit: "°F", volts: "V", millivolts: "mV", degrees: "°", rpm: "rpm", milliseconds: "ms",
  seconds: "s", minutes: "min", hours: "h", kilometers: "km", miles: "mi", meters: "m", centimeters: "cm", millimeters: "mm",
  newtonMeters: "N·m", kilometersPerHour: "km/h", milesPerHour: "mph", bars: "bar", kilopascal: "kPa", psi: "psi", milliamps: "mA", amps: "A",
  liters: "L", gallons: "gal", ampereHours: "Ah", kilowattHours: "kWh", kilowatts: "kW", watts: "W", metersPerSecondSquared: "m/s²",
  metersPerSecond: "m/s", gramsPerSecond: "g/s", gravity: "g", ohms: "Ω", kiloohms: "kΩ", megaohms: "MΩ", milliohms: "mΩ", hertz: "Hz",
  milligramsPerStroke: "mg/curso", litersPerHour: "L/h", kilogramsPerHour: "kg/h", kilowattHoursPer100Kilometers: "kWh/100 km",
  gramsPerLiter: "g/L", radians: "rad" };
const LIGA = { offon: ["Desligado", "Ligado"], onoff: ["Ligado", "Desligado"], noyes: ["Não", "Sim"], yesno: ["Sim", "Não"] };
// Vocabulário padronizado do OBDb → o nome que a oficina usa. Faz o sinal de um Corolla e o de uma
// Spin caírem na mesma linha, com o mesmo nome.
const METRICA = { odometer: "Odômetro", speed: "Velocidade", transmissionFluidTemperature: "Temperatura do óleo do câmbio",
  fuelTankLevel: "Nível do tanque", gear: "Marcha", starterBatteryVoltage: "Tensão da bateria", engineOilTemperature: "Temperatura do óleo do motor",
  absoluteBoostPressure: "Pressão do turbo (absoluta)", boostPressure: "Pressão do turbo", frontLeftTirePressure: "Pneu dianteiro esquerdo (pressão)",
  frontRightTirePressure: "Pneu dianteiro direito (pressão)", rearLeftTirePressure: "Pneu traseiro esquerdo (pressão)",
  rearRightTirePressure: "Pneu traseiro direito (pressão)", frontLeftTireTemperature: "Pneu dianteiro esquerdo (temperatura)",
  frontRightTireTemperature: "Pneu dianteiro direito (temperatura)", rearLeftTireTemperature: "Pneu traseiro esquerdo (temperatura)",
  rearRightTireTemperature: "Pneu traseiro direito (temperatura)", intakeAirTemperature: "Temperatura do ar de admissão",
  barometricPressure: "Pressão atmosférica", engineCoolantTemperature: "Temperatura do motor", stateOfCharge: "Carga da bateria",
  stateOfHealth: "Saúde da bateria", fuelRange: "Autonomia", electricRange: "Autonomia elétrica", engineSpeed: "Rotação do motor",
  gearSelector: "Posição da alavanca", massAirFlow: "Fluxo de ar (MAF)", longitudinalAcceleration: "Aceleração longitudinal",
  lateralAcceleration: "Aceleração lateral", checkEngineLightOn: "Luz de injeção", tractionBatteryCurrent: "Corrente da bateria de tração",
  tractionBatteryVoltage: "Tensão da bateria de tração", tractionBatteryCapacity: "Capacidade da bateria de tração",
  cruiseSetSpeed: "Velocidade do piloto automático", cruiseActive: "Piloto automático", distanceSinceDTCsCleared: "Distância desde que apagaram as falhas",
  pluggedIn: "Na tomada", isCharging: "Carregando", engineLoad: "Carga do motor", absoluteEngineLoad: "Carga absoluta do motor", fuelRate: "Consumo",
  shortTermFuelTrim: "Ajuste de combustível (curto)", throttlePosition: "Borboleta", o2Lambda: "Lambda", cvtDeterioration: "Desgaste do CVT" };

export const unidadeDe = s => UNIDADE[s.u] || "";
// Velocidade de cada roda (módulo do ABS): o OBDb não padroniza o nome, mas escreve sempre parecido.
const RODA = [[/\b(front left|fl|lf|left front)\b/i, "dianteira esquerda"], [/\b(front right|fr|rf|right front)\b/i, "dianteira direita"],
  [/\b(rear left|rl|lr|left rear)\b/i, "traseira esquerda"], [/\b(rear right|rr|right rear)\b/i, "traseira direita"]];
/** "Roda dianteira esquerda (velocidade)" quando o sinal é a velocidade de UMA roda; senão "". */
export function nomeDaRoda(s) {
  const n = String(s.n || "");
  if (!/wheel/i.test(n) || !/speed/i.test(n) || /steering|average|pulse|count|raw/i.test(n)) return "";
  if (!/kilometersPerHour|milesPerHour/.test(s.u || "")) return "";
  for (const [re, nome] of RODA) if (re.test(n)) return "Roda " + nome + " (velocidade)" + (/high res/i.test(n) ? ", alta resolução" : "");
  return "";
}
/** Nome do sinal: o nosso quando sabemos o que é; senão o nome original, em inglês. */
export const nomeDoSinal = s => METRICA[s.k] || nomeDaRoda(s) || s.n || s.id;
export const nomeTraduzido = s => !!(METRICA[s.k] || nomeDaRoda(s));
/** Os sinais de velocidade por roda de um conjunto de comandos (para a tela pôr as quatro juntas). */
export const eRoda = s => !!nomeDaRoda(s);

/**
 * O valor de UM sinal a partir dos bytes de dado (depois do eco do identificador).
 * Devolve { valor, texto, unidade } ou null quando a resposta é curta demais ou o módulo marcou
 * o dado como ausente. Resposta curta NÃO vira zero: zero é leitura, e ausência não é.
 */
export function decodificar(s, bytes) {
  const b = bytes || [], ini = s.b || 0, n = s.l;
  if (ini + n > b.length * 8) return null;
  let cru = 0;
  if (s.le && n % 8 === 0 && ini % 8 === 0) {
    for (let i = n / 8 - 1; i >= 0; i--) cru = cru * 256 + b[ini / 8 + i];
  } else {
    for (let i = 0; i < n; i++) { const pos = ini + i; cru = cru * 2 + ((b[pos >> 3] >> (7 - (pos & 7))) & 1); }
  }
  if (s.s && n > 1 && cru >= Math.pow(2, n - 1)) cru -= Math.pow(2, n);
  if (s.mp && s.mp[String(cru)] != null) return { valor: cru, texto: String(s.mp[String(cru)]), unidade: "" };
  if (LIGA[s.u]) return { valor: cru, texto: LIGA[s.u][cru ? 1 : 0], unidade: "" };
  let v = cru * (s.m == null ? 1 : s.m) / (s.d == null ? 1 : s.d) + (s.a || 0);
  if ((s.nmn != null && v < s.nmn) || (s.nmx != null && v > s.nmx)) return null;
  v = Math.round(v * 100) / 100;
  if (s.u === "hex") return { valor: cru, texto: cru.toString(16).toUpperCase(), unidade: "" };
  return { valor: v, texto: String(v).replace(".", ","), unidade: unidadeDe(s), numero: true };
}

/** O texto do pedido para o adaptador e quantos bytes de eco descartar na resposta. */
export const pedidoDo = c => ({ cmd: c.s + c.i, servico: parseInt(c.s, 16), eco: c.s === "22" ? 2 : 1 });

/**
 * Lê os dados de UM módulo já apontado. `pedir` é uds.pedir (injetado para testar sem carro).
 * Devolve [{ comando, situacao, nrc, texto, sinais: [{ id, nome, traduzido, grupo, valor, texto, unidade }] }].
 * Recusa do módulo é ausência do dado, não erro (serviço 21 em adaptador barato, dado que o carro não tem).
 */
export async function lerModulo(comandos, pedir, { aoAndar = null, continuar = () => true } = {}) {
  const out = [];
  for (let i = 0; i < comandos.length && continuar(); i++) {
    const c = comandos[i], p = pedidoDo(c);
    if (aoAndar) { try { aoAndar(i + 1, comandos.length); } catch (e) { /* tela fechou */ } }
    const r = await pedir(p.cmd, p.servico, 3000);
    const item = { comando: p.cmd, situacao: c.situacao || "conferido", nrc: r.nrc == null ? null : r.nrc, texto: r.texto || "", sinais: [], ms: r.ms };
    if (r.dados && r.nrc == null) {
      const bytes = r.dados.slice(p.eco);
      for (const s of c.z) {
        const v = decodificar(s, bytes);
        if (v) item.sinais.push({ id: s.id, nome: nomeDoSinal(s), traduzido: nomeTraduzido(s), grupo: s.g || "", valor: v.valor, numero: !!v.numero, texto: v.texto, unidade: v.unidade, min: s.mn, max: s.mx, roda: eRoda(s) });
      }
    }
    out.push(item);
  }
  return out;
}
