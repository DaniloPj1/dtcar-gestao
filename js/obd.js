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

/**
 * bytes = quantos bytes de dado o PID devolve; casas = casas depois da vírgula ao mostrar;
 * vivo = muda o tempo todo com o motor (entra em toda volta da leitura contínua). Os de `vivo: false`
 * (distâncias e aquecimentos desde o apagamento) praticamente não mudam enquanto o carro está no
 * elevador: lê uma vez e pronto, para a roda não gastar tempo com eles.
 */
export const PIDS = [
  { pid: 0x0c, rotulo: "Rotação", unidade: "rpm", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 4, casas: 0, vivo: true },
  { pid: 0x05, rotulo: "Temperatura do motor", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0, vivo: true },
  { pid: 0x04, rotulo: "Carga do motor", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true },
  { pid: 0x11, rotulo: "Borboleta", unidade: "%", bytes: 1, conta: d => d[0] * 100 / 255, casas: 0, vivo: true },
  { pid: 0x06, rotulo: "Ajuste curto de combustível", unidade: "%", bytes: 1, conta: d => (d[0] - 128) * 100 / 128, casas: 1, vivo: true },
  { pid: 0x07, rotulo: "Ajuste longo de combustível", unidade: "%", bytes: 1, conta: d => (d[0] - 128) * 100 / 128, casas: 1, vivo: true },
  { pid: 0x0e, rotulo: "Avanço de ignição", unidade: "°", bytes: 1, conta: d => (d[0] / 2) - 64, casas: 1, vivo: true },
  { pid: 0x0f, rotulo: "Temperatura do ar admitido", unidade: "°C", bytes: 1, conta: d => d[0] - 40, casas: 0, vivo: true },
  { pid: 0x0b, rotulo: "Pressão no coletor", unidade: "kPa", bytes: 1, conta: d => d[0], casas: 0, vivo: true },
  { pid: 0x10, rotulo: "Fluxo de ar (MAF)", unidade: "g/s", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 100, casas: 2, vivo: true },
  { pid: 0x42, rotulo: "Tensão do módulo", unidade: "V", bytes: 2, conta: d => ((d[0] * 256) + d[1]) / 1000, casas: 1, vivo: true },
  { pid: 0x1f, rotulo: "Motor ligado há", unidade: "s", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: true },
  { pid: 0x21, rotulo: "Distância com a luz acesa", unidade: "km", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: false },
  { pid: 0x31, rotulo: "Distância desde o apagamento", unidade: "km", bytes: 2, conta: d => (d[0] * 256) + d[1], casas: 0, vivo: false },
  { pid: 0x30, rotulo: "Aquecimentos desde o apagamento", unidade: "", bytes: 1, conta: d => d[0], casas: 0, vivo: false },
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
 * o limite, então dá para ver a margem que sobra. A escala para mostrar em unidade de verdade só
 * existe aqui onde está conferida; o que não está aparece como número cru, sem unidade inventada.
 * Dá para crescer conferindo contra o Raven, aos poucos.
 */
const ESCALAS = {
  0x01: [1, ""], 0x07: [0.25, "rpm"], 0x09: [1, "km/h"], 0x0b: [0.001, "V"], 0x12: [1, "s"],
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
    const sinal = comSinal(uas);
    const cru = inteiro16(d[i + 3], d[i + 4], sinal);
    const minimo = inteiro16(d[i + 5], d[i + 6], sinal);
    const maximo = inteiro16(d[i + 7], d[i + 8], sinal);
    const escala = ESCALAS[uas];
    const conv = v => escala ? arred(v * escala[0], 3) : v;
    testes.push({
      mid, tid, nome: nomeMid(mid),
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
const FAIXAS_PID = [0x00, 0x20, 0x40, 0x60];
const FAIXAS_MID = [0x00, 0x20, 0x40, 0x60];

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
    const v = valorPid(primeiraDe(r.respostas, 0x01), pid, 0x01);
    if (v) linhas.push(v);
  }
  return linhas;
}

/** quantas vezes um PID pode não responder antes de sair da roda */
const PACIENCIA = 2;
/** tempo de espera de cada leitura da roda: curto, para um PID mudo não travar o ritmo */
const ESPERA_VIVO = 1500;
/** respiro entre uma volta e outra, para a roda não monopolizar o aparelho */
const PAUSA_VOLTA = 60;

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
export async function lerAoVivoSeguido(pidsSuportados, aoValor, continuar) {
  const quais = PIDS.filter(p => !pidsSuportados || !pidsSuportados.length || pidsSuportados.includes(p.pid));
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
      const v = r.erro ? null : valorPid(primeiraDe(r.respostas, 0x01), p.pid, 0x01);
      if (v) {
        mudos[p.pid] = 0;
        leuAlgo = true;
        aoValor(v, volta);
      } else {
        mudos[p.pid] = (mudos[p.pid] || 0) + 1;
      }
    }
    // volta inteira sem ninguém responder: o carro desligou ou o adaptador saiu. Parar é melhor que
    // girar à toa gastando bateria e deixando a tela mentindo que está lendo.
    if (!leuAlgo) return volta;
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
    const v = valorPid(primeiraDe(r.respostas, 0x02), pid, 0x02);
    if (v) linhas.push(v);
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
  for (const mid of mids.filter(m => m % 0x20 !== 0).slice(0, 32)) {  // trava: nunca varre tudo
    const r = await pedir("06" + mid.toString(16).toUpperCase().padStart(2, "0"), 5000);
    if (r.erro) continue;
    for (const t of testesDe(primeiraDe(r.respostas, 0x06))) testes.push(t);
  }
  return { testes, erro: "" };
}
