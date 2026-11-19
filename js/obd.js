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

/** Texto cru do adaptador → { hex, erro }. Junta as linhas de resposta longa ("0:", "1:"…) e tira o enfeite. */
export function juntarLinhas(texto) {
  const bruto = String(texto == null ? "" : texto);
  const linhas = bruto.split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)
    .filter(l => !/^SEARCHING/i.test(l) && l !== ">");
  if (!linhas.length) return { hex: "", erro: "O adaptador não respondeu." };
  const juntas = linhas.join(" ").toUpperCase();
  for (const [marca, motivo] of RECUSAS) {
    // "?" só vale quando é a resposta inteira; dentro de outra frase não quer dizer nada
    if (marca === "?" ? linhas.some(l => l === "?") : juntas.includes(marca)) return { hex: "", erro: motivo };
  }
  const comPrefixo = linhas.some(l => /^[0-9A-F]:/i.test(l));
  let hex = "";
  for (const l of linhas) {
    let p = l;
    if (/^[0-9A-F]:/i.test(p)) p = p.slice(2);                       // pedaço de resposta longa
    else if (comPrefixo && /^[0-9A-F]{3}$/i.test(p.replace(/\s/g, ""))) continue; // tamanho total, não é dado
    hex += p.replace(/[^0-9A-Fa-f]/g, "");
  }
  hex = hex.toUpperCase();
  if (hex.length % 2) hex = hex.slice(0, -1);                         // meio byte no fim: descarta
  if (!hex) return { hex: "", erro: "A resposta veio sem dado." };
  return { hex, erro: "" };
}

/** hex em texto → lista de números */
export function bytesDe(hex) {
  const b = [];
  for (let i = 0; i + 1 < hex.length; i += 2) b.push(parseInt(hex.substr(i, 2), 16));
  return b;
}

/**
 * Tira a "casca" da resposta: confere o serviço que voltou e devolve só os dados.
 * No OBD-II a resposta do serviço 01 volta como 41, a do 03 como 43, e assim por diante (+0x40).
 */
export function dadosDa(hex, servico) {
  const esperado = (servico + 0x40).toString(16).toUpperCase().padStart(2, "0");
  const i = hex.indexOf(esperado);
  if (i < 0 || i % 2) return null;
  return bytesDe(hex.slice(i + 2));
}

/** Dois bytes → código de falha no jeito que a oficina lê (P0171, U0100…). */
export function dtcDe(a, b) {
  const letra = ["P", "C", "B", "U"][(a >> 6) & 0x3];
  const primeiro = (a >> 4) & 0x3;
  const resto = (((a & 0x0f) << 8) | b).toString(16).toUpperCase().padStart(3, "0");
  return letra + primeiro + resto;
}

/**
 * Resposta dos serviços 03 (confirmadas), 07 (pendentes) e 0A (permanentes) → lista de códigos.
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

/** Serviço 09 PID 02 → chassi (VIN). */
export function vinDe(hex) {
  const d = dadosDa(hex, 0x09);
  if (!d || d.length < 2 || d[0] !== 0x02) return "";
  let dados = d.slice(1);
  if (dados.length === 18 || dados.length > 17) dados = dados.slice(dados.length - 17); // tira a contagem da frente
  const txt = dados.map(b => String.fromCharCode(b)).join("");
  const limpo = txt.replace(/[^A-HJ-NPR-Z0-9]/gi, "").toUpperCase();
  return limpo.length === 17 ? limpo : "";
}

/* ---- dados ao vivo (serviço 01) ---- */

const arred = (n, casas) => Math.round(n * Math.pow(10, casas)) / Math.pow(10, casas);

/** bytes = quantos bytes de dado o PID devolve; casas = casas depois da vírgula ao mostrar */
export const PIDS = [
  { pid: 0x0c, rotulo: "Rotação", unidade: "rpm", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 4, casas: 0 },
  { pid: 0x05, rotulo: "Temperatura do motor", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0 },
  { pid: 0x04, rotulo: "Carga do motor", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0 },
  { pid: 0x11, rotulo: "Borboleta", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0 },
  { pid: 0x06, rotulo: "Ajuste curto de combustível", unidade: "%", bytes: 1, conta: d => (d[0] - 128) * 100 / 128, casas: 1 },
  { pid: 0x07, rotulo: "Ajuste longo de combustível", unidade: "%", bytes: 1, conta: d => (d[0] - 128) * 100 / 128, casas: 1 },
  { pid: 0x0e, rotulo: "Avanço de ignição", unidade: "°", bytes: 1, conta: d => (d[0] / 2) - 64, casas: 1 },
  { pid: 0x0f, rotulo: "Temperatura do ar admitido", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0 },
  { pid: 0x0b, rotulo: "Pressão no coletor", unidade: "kPa", bytes: 1, conta: d => d[0], casas: 0 },
  { pid: 0x10, rotulo: "Fluxo de ar (MAF)", unidade: "g/s", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 100, casas: 2 },
  { pid: 0x42, rotulo: "Tensão do módulo", unidade: "V", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 1000, casas: 1 },
  { pid: 0x1f, rotulo: "Motor ligado há", unidade: "s", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0 },
  { pid: 0x21, rotulo: "Distância com a luz acesa", unidade: "km", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0 },
  { pid: 0x31, rotulo: "Distância desde o apagamento", unidade: "km", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0 },
  { pid: 0x30, rotulo: "Aquecimentos desde o apagamento", unidade: "", bytes: 1, conta: d => d[0], casas: 0 },
];

/** Resposta de um PID do serviço 01 (ou 02, a foto da falha) → { rotulo, valor, unidade } */
export function valorPid(hex, pid, servico = 0x01) {
  const linha = PIDS.find(p => p.pid === pid);
  if (!linha) return null;
  const d = dadosDa(hex, servico);
  if (!d || d.length < 2 || d[0] !== pid) return null;
  const dados = servico === 0x02 ? d.slice(2) : d.slice(1);           // o serviço 02 traz o nº da foto
  if (dados.length < linha.bytes) return null;
  let valor;
  try { valor = linha.conta(dados); } catch (e) { return null; }
  if (!isFinite(valor)) return null;
  return { pid, rotulo: linha.rotulo, unidade: linha.unidade, valor: arred(valor, linha.casas) };
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
 * o limite, então dá para ver a margem que sobra. O "passou/não passou" sai da comparação do valor
 * com o limite, que é padronizada. A escala para mostrar em unidade de verdade NÃO é: a tabela
 * abaixo tem só o que é certo, e o que não está nela aparece como número cru, sem unidade inventada.
 * Dá para crescer conferindo contra o Raven, aos poucos.
 */
const ESCALAS = {
  0x01: [1, ""], 0x07: [0.25, "rpm"], 0x09: [1, "km/h"], 0x0b: [0.001, "V"], 0x12: [1, "s"],
};

/** Nomes que o padrão define. O resto fica como "Monitor $XX": melhor sem nome que com nome errado. */
function nomeMid(mid) {
  if (mid >= 0x01 && mid <= 0x04) return "Sonda lambda · banco 1, sensor " + mid;
  if (mid >= 0x05 && mid <= 0x08) return "Sonda lambda · banco 2, sensor " + (mid - 4);
  if (mid >= 0x21 && mid <= 0x24) return "Catalisador · banco " + (mid - 0x20);
  return "Monitor $" + mid.toString(16).toUpperCase().padStart(2, "0");
}

/** Resposta de um MID do serviço 06 → lista de testes com valor, limites e passou/não passou */
export function testesDe(hex) {
  const d = dadosDa(hex, 0x06);
  if (!d) return [];
  const testes = [];
  for (let i = 0; i + 8 < d.length; i += 9) {
    const mid = d[i], tid = d[i + 1], uas = d[i + 2];
    if (!mid) continue;
    const cru = (d[i + 3] << 8) | d[i + 4];
    const minimo = (d[i + 5] << 8) | d[i + 6];
    const maximo = (d[i + 7] << 8) | d[i + 8];
    const escala = ESCALAS[uas];
    const conv = v => escala ? arred(v * escala[0], 3) : v;
    testes.push({
      mid, tid, nome: nomeMid(mid),
      valor: conv(cru), minimo: conv(minimo), maximo: conv(maximo),
      unidade: escala ? escala[1] : "",
      escalaConhecida: !!escala,
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

/** Manda um comando e devolve o texto cru. */
export const comando = (cmd, esperaMs) => P().comando({ cmd, esperaMs: esperaMs || 5000 }).then(r => (r && r.resposta) || "");

/** Manda um comando de OBD e já devolve { hex, erro }. */
export const pedir = (cmd, esperaMs) => comando(cmd, esperaMs).then(juntarLinhas);

/* ---- preparar o adaptador ----
 * ATZ reinicia, ATE0 tira o eco, ATL0 e ATS0 tiram quebra de linha e espaço (resposta menor),
 * ATH0 tira o cabeçalho e ATSP0 deixa o adaptador descobrir sozinho o protocolo do carro.
 */
const INICIO = [["ATZ", 3000], ["ATE0", 2000], ["ATL0", 2000], ["ATS0", 2000], ["ATH0", 2000], ["ATSP0", 2000]];

/** Prepara o adaptador e descobre o protocolo. Devolve { protocolo, pidsSuportados }. */
export async function iniciar() {
  for (const [cmd, espera] of INICIO) await comando(cmd, espera);
  // o primeiro pedido de verdade é o que faz o adaptador achar o protocolo do carro: pode demorar
  const primeiro = await pedir("0100", 12000);
  if (primeiro.erro) throw new Error(primeiro.erro);
  const protocolo = (await comando("ATDP", 3000)).replace(/[\r\n>]/g, "").trim();
  return { protocolo, pidsSuportados: suportados(primeiro.hex, 0x01, 0x00) };
}

/* ---- leituras de alto nível ---- */

/** Códigos de falha, com a situação de cada um. */
export async function lerFalhas() {
  const pedidos = [["03", "atual"], ["07", "pendente"], ["0A", "permanente"]];
  const falhas = [];
  const erros = [];
  for (const [cmd, situacao] of pedidos) {
    const r = await pedir(cmd, 8000);
    if (r.erro) { erros.push({ situacao, erro: r.erro }); continue; }
    const codigos = codigosDa(r.hex, parseInt(cmd, 16));
    if (!codigos) { erros.push({ situacao, erro: "Resposta fora do padrão." }); continue; }
    for (const c of codigos) if (!falhas.some(f => f.codigo === c && f.situacao === situacao)) falhas.push({ codigo: c, situacao });
  }
  return { falhas, erros };
}

/** Dados ao vivo: só os PIDs que o carro disse que tem. */
export async function lerAoVivo(pidsSuportados) {
  const quais = PIDS.map(p => p.pid).filter(p => !pidsSuportados || !pidsSuportados.length || pidsSuportados.includes(p));
  const linhas = [];
  for (const pid of quais) {
    const r = await pedir("01" + pid.toString(16).toUpperCase().padStart(2, "0"), 4000);
    if (r.erro) continue;
    const v = valorPid(r.hex, pid, 0x01);
    if (v) linhas.push(v);
  }
  return linhas;
}

/** A foto do momento em que a falha gravou (serviço 02): diz se deu com o motor frio, em carga, etc. */
export async function lerFoto() {
  const linhas = [];
  for (const { pid } of PIDS) {
    const r = await pedir("02" + pid.toString(16).toUpperCase().padStart(2, "0") + "00", 4000);
    if (r.erro) continue;
    const v = valorPid(r.hex, pid, 0x02);
    if (v) linhas.push(v);
  }
  return linhas;
}

/** Prontidão dos monitores. */
export async function lerMonitores() {
  const r = await pedir("0101", 5000);
  if (r.erro) throw new Error(r.erro);
  const m = monitoresDe(r.hex);
  if (!m) throw new Error("Resposta fora do padrão.");
  return m;
}

/** Chassi lido no módulo (pode não existir em carro mais antigo). */
export async function lerChassi() {
  const r = await pedir("0902", 8000);
  if (r.erro) return "";
  return vinDe(r.hex);
}

/**
 * Resultados dos testes de bordo (serviço 06), MID por MID.
 * Os MIDs vêm em faixas: o pedido 0600 diz quais existem de $01 a $20, o 0620 de $21 a $40, e assim
 * por diante. Sem andar nas faixas o catalisador (de $21 em diante) nunca apareceria.
 */
const FAIXAS_MID = [0x00, 0x20, 0x40, 0x60];

export async function lerTestes() {
  const mids = [];
  let erroPrimeira = "";
  for (const base of FAIXAS_MID) {
    const r = await pedir("06" + base.toString(16).toUpperCase().padStart(2, "0"), 6000);
    if (r.erro) {
      if (base === 0x00) erroPrimeira = r.erro;
      break;                                                          // faixa que não responde encerra a busca
    }
    const achados = suportados(r.hex, 0x06, base);
    for (const m of achados) if (!mids.includes(m)) mids.push(m);
    // a última posição de cada faixa é o aviso de que existe a faixa seguinte; sem ela, para aqui
    if (!achados.includes(base + 0x20)) break;
  }
  if (erroPrimeira) return { testes: [], erro: erroPrimeira };
  const testes = [];
  for (const mid of mids.filter(m => !FAIXAS_MID.includes(m)).slice(0, 32)) {   // trava: nunca varre tudo
    const r = await pedir("06" + mid.toString(16).toUpperCase().padStart(2, "0"), 5000);
    if (r.erro) continue;
    for (const t of testesDe(r.hex)) testes.push(t);
  }
  return { testes, erro: "" };
}
