/**
 * UDS (ISO 14229) pelo adaptador ELM327 — a conversa com UM módulo de cada vez.
 *
 * O js/obd.js fala o OBD-II, que é a língua comum: ele pergunta "qual a rotação" e QUALQUER carro
 * responde. Só que o OBD-II é obrigatório por lei para emissão, e por isso é pequeno: não tem
 * atuador, não tem aprendizado, não tem o câmbio, não tem o ABS, não tem o airbag. Tudo isso o
 * carro tem, mas em outra língua — o UDS — e falando com cada módulo pelo endereço dele.
 *
 * O QUE MUDA NA PRÁTICA
 * No OBD-II o adaptador grita no barramento e quem quiser responde. No UDS o pedido vai para um
 * endereço (o "cabeçalho"), e só aquele módulo responde. Então antes de qualquer pergunta é preciso
 * dizer ao adaptador com quem ele vai falar — é o que `abrir()` faz.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ
 * Não tem tabela de identificador por marca inventada aqui. O número do dado (DID) e o da rotina
 * (RID) mudam de família para família de módulo, e chutar isso num sistema que vai rodar numa
 * oficina é pior que não ter: um palpite errado vira um laudo errado. Aqui ficam só (a) o que a
 * própria norma define, (b) o que o CARRO responde quando perguntado, e (c) o acervo do projeto,
 * que fica em js/udsdados.js. O resto é descoberta, e ela é feita perguntando — ver `sondar()`.
 */
import { juntarLinhas, bytesDe, dtcDe, comando, plugin } from "./obd.js";
import acervo from "./udsdados.js";

/* ------------------------------------------------------------------ respostas negativas */

/**
 * Códigos de resposta negativa da ISO 14229-1, na frase que o mecânico precisa ler.
 *
 * Esta tabela é metade do valor do UDS numa oficina. Quando o módulo RECUSA, ele não diz só "não":
 * ele diz POR QUE não — motor ligado, temperatura baixa, câmbio fora de neutro, freio solto, tensão
 * caída. Isso deixa de ser erro e passa a ser instrução: o aparelho conta ao mecânico o que fazer
 * para o teste rodar. Por isso cada código tem o nome técnico (para conferir na norma) e a frase.
 */
export const NRC = {
  0x10: ["generalReject", "O módulo recusou o pedido, sem dizer o motivo."],
  0x11: ["serviceNotSupported", "Este módulo não tem esse serviço."],
  0x12: ["subFunctionNotSupported", "O módulo tem o serviço, mas não essa opção dele."],
  0x13: ["incorrectMessageLengthOrInvalidFormat", "O pedido foi montado com tamanho errado."],
  0x14: ["responseTooLong", "A resposta não cabe de uma vez."],
  0x21: ["busyRepeatRequest", "O módulo está ocupado. Vale pedir de novo."],
  0x22: ["conditionsNotCorrect", "O módulo TEM essa função, mas as condições do carro não permitem agora."],
  0x24: ["requestSequenceError", "Falta um passo antes deste (abrir a sessão ou destravar)."],
  0x25: ["noResponseFromSubnetComponent", "Um módulo da rede não respondeu."],
  0x26: ["failurePreventsExecutionOfRequestedAction", "Existe uma falha gravada que impede esta ação."],
  0x31: ["requestOutOfRange", "Este módulo não tem esse identificador — ou ele não vale nesta sessão."],
  0x33: ["securityAccessDenied", "O módulo TEM essa função, mas ela é protegida: precisa destravar."],
  0x34: ["authenticationRequired", "A função exige autenticação do aparelho."],
  0x35: ["invalidKey", "A chave enviada não serviu."],
  0x36: ["exceedNumberOfAttempts", "Chave errada vezes demais. O módulo travou as tentativas."],
  0x37: ["requiredTimeDelayNotExpired", "Precisa esperar antes de tentar destravar de novo."],
  0x70: ["uploadDownloadNotAccepted", "O módulo não aceitou transferência."],
  0x72: ["generalProgrammingFailure", "Falhou ao gravar no módulo."],
  0x73: ["wrongBlockSequenceCounter", "Os blocos saíram fora de ordem."],
  0x78: ["requestCorrectlyReceivedResponsePending", "O módulo recebeu e está trabalhando. A resposta vem."],
  0x7e: ["subFunctionNotSupportedInActiveSession", "Essa opção não vale na sessão aberta agora."],
  0x7f: ["serviceNotSupportedInActiveSession", "Esse serviço não vale na sessão aberta agora."],
  0x81: ["rpmTooHigh", "Rotação alta demais para este teste."],
  0x82: ["rpmTooLow", "Rotação baixa demais para este teste."],
  0x83: ["engineIsRunning", "Desligue o motor para este teste."],
  0x84: ["engineIsNotRunning", "Ligue o motor para este teste."],
  0x85: ["engineRunTimeTooLow", "O motor precisa ficar mais tempo trabalhando antes."],
  0x86: ["temperatureTooHigh", "Temperatura alta demais. Deixe esfriar."],
  0x87: ["temperatureTooLow", "Temperatura baixa demais. Aqueça o motor."],
  0x88: ["vehicleSpeedTooHigh", "Velocidade alta demais. Pare o carro."],
  0x89: ["vehicleSpeedTooLow", "O carro precisa estar andando para este teste."],
  0x8a: ["throttlePedalTooHigh", "Solte o acelerador."],
  0x8b: ["throttlePedalTooLow", "Pise no acelerador."],
  0x8c: ["transmissionRangeNotInNeutral", "Ponha o câmbio em neutro."],
  0x8d: ["transmissionRangeNotInGear", "Ponha o câmbio na marcha."],
  0x8f: ["brakeSwitchNotClosed", "Pise no freio e segure."],
  0x90: ["shifterLeverNotInPark", "Ponha a alavanca em P."],
  0x91: ["torqueConverterClutchLocked", "O conversor está travado. Não dá para rodar agora."],
  0x92: ["voltageTooHigh", "Tensão alta demais."],
  0x93: ["voltageTooLow", "Tensão baixa demais. Confira a bateria e o alternador."],
};

/** Frase para o mecânico a partir do código de recusa. */
export const textoNrc = n => (NRC[n] || [null, "O módulo recusou (código " + hx(n) + ")."])[1];
/** Nome técnico, para conferir na norma. */
export const nomeNrc = n => (NRC[n] || ["desconhecido"])[0];

const hx = (n, d = 2) => Number(n).toString(16).toUpperCase().padStart(d, "0");
export const hex2 = n => hx(n, 2);
export const hex4 = n => hx(n, 4);

/* ------------------------------------------------------------------ faixas da norma */

/**
 * Onde cada número de ROTINA mora, pela ISO 14229-1 (igual em 2013 e em 2020).
 * Serve para a varredura não andar onde não faz sentido: a rotina de serviço de um carro está na
 * faixa do fabricante, e é só nela que o app procura. As de programação e a de apagar memória ficam
 * fora, e o plugin nativo também as recusa — ver rotinaNaFaixa() no ObdPlugin.java.
 */
export const FAIXAS_RID = [
  { de: 0x0000, ate: 0x00ff, nome: "reservada pela norma", procurar: false },
  { de: 0x0100, ate: 0x01ff, nome: "tacógrafo", procurar: false },
  { de: 0x0200, ate: 0xdfff, nome: "rotina do fabricante", procurar: true },
  { de: 0xe000, ate: 0xe1ff, nome: "teste de emissão (OBD)", procurar: false },
  { de: 0xe200, ate: 0xe2ff, nome: "sucateamento e segurança", procurar: false },
  { de: 0xe300, ate: 0xefff, nome: "reservada pela norma", procurar: false },
  { de: 0xf000, ate: 0xfeff, nome: "do fornecedor do sistema", procurar: false },
  { de: 0xff00, ate: 0xffff, nome: "programação e apagar memória", procurar: false },
];
export const faixaRid = n => FAIXAS_RID.find(f => n >= f.de && n <= f.ate) || null;
/** A faixa onde o app procura rotina de serviço. É a mesma que o nativo deixa passar. */
export const RID_DE = 0x0200, RID_ATE = 0xdfff;
export const ridDeServico = n => n >= RID_DE && n <= RID_ATE;

/* ------------------------------------------------------------------ sessões e serviços */

export const SESSAO = { comum: 0x01, programacao: 0x02, estendida: 0x03 };
/** Serviços que não mudam nada no carro: são os únicos em que vale repetir o pedido. */
export const SERVICOS_SO_LEITURA = [0x10, 0x19, 0x22, 0x24, 0x3e];
export const SV = {
  sessao: 0x10, reiniciar: 0x11, apagar: 0x14, falhas: 0x19, lerDado: 0x22,
  lerEscala: 0x24, destravar: 0x27, gravar: 0x2e, atuar: 0x2f, rotina: 0x31, presenca: 0x3e,
};
/** Opções do controle de atuador (0x2F), como a norma numera. */
export const ATUAR = { devolver: 0x00, comoCongelado: 0x01, comoPadrao: 0x02, ajustar: 0x03 };
/** Subfunções da rotina (0x31). */
export const ROTINA = { comecar: 0x01, parar: 0x02, resultado: 0x03 };

/* ------------------------------------------------------------------ a conversa */

const P = () => { const p = plugin(); if (!p) throw new Error("sem-plugin"); return p; };

/**
 * Prepara o adaptador para falar com UM módulo.
 *
 * `pedido` é o endereço para onde a pergunta vai e `resposta` o que o módulo usa para responder.
 * Em 11 bits a conta é quase sempre resposta = pedido + 8 (o motor pede em 7E0 e responde em 7E8),
 * e é esse o padrão quando só o pedido é informado. Em 29 bits os dois são escritos por extenso.
 *
 * O controle de fluxo (ATFC*) é o que faz resposta comprida chegar inteira: sem ele, o módulo manda
 * o primeiro quadro, fica esperando a autorização para continuar e a leitura volta pela metade.
 */
export async function abrir({ pedido, resposta, bits29 = false, esperaMs = 1000 } = {}) {
  const ped = String(pedido || "").toUpperCase().replace(/[^0-9A-F]/g, "");
  if (!(ped.length === 3 || ped.length === 8)) throw new Error("endereco-invalido");
  const resp = String(resposta || (ped.length === 3 ? hx(parseInt(ped, 16) + 8, 3) : "")).toUpperCase().replace(/[^0-9A-F]/g, "");
  // Endereço de 8 dígitos É de 29 bits: quem chama não precisa lembrar de avisar. (Antes dependia
  // do parâmetro, e apontar um módulo de Honda pela tela abria o protocolo de 11 bits.)
  await comando("ATSP" + (bits29 || ped.length === 8 ? "7" : "6"), 2000);   // CAN de 500 kbit, 29 ou 11 bits
  await comando("ATCAF1", 2000);                        // o adaptador monta e desmonta os quadros
  await comando("ATSH" + ped, 2000);
  if (resp) await comando("ATCRA" + resp, 2000);        // escuta só este módulo
  await comando("ATFCSH" + ped, 2000);
  await comando("ATFCSD300000", 2000);                  // "pode mandar o resto, sem pausa"
  await comando("ATFCSM1", 2000);
  await comando("ATST" + hx(Math.max(1, Math.min(255, Math.round(esperaMs / 4))), 2), 2000);
  // ESPERA FIXA. O adaptador vem com a espera "adaptativa" ligada: ele encurta o tempo de escuta pelo
  // que mediu nas respostas rápidas. No City do Danilo (21/11/2026) a abertura de sessão respondia em
  // 130 ms e TODA leitura de dado voltava "NO DATA" em 150 ms, e a resposta que vem depois do "estou
  // trabalhando" (78) se perdia: o adaptador parava de escutar antes de o módulo responder. Com a
  // adaptação desligada vale o tempo inteiro do ATST. APK antigo não aceita o comando: segue como antes.
  try { await comando("ATAT0", 2000); } catch (e) { /* APK anterior a 22/11/2026 */ }
  return { pedido: ped, resposta: resp };
}

/** Volta o adaptador ao jeito do OBD-II comum (sem cabeçalho fixo, sem filtro). */
export async function fechar() {
  try { await comando("ATCRA", 2000); } catch (e) { /* adaptador que não aceita: segue */ }
  // O controle de fluxo volta ao automático: senão a resposta longa do motor (o chassi, por exemplo)
  // continuaria recebendo o "pode mandar o resto" no endereço do módulo anterior e não chegaria inteira.
  try { await comando("ATFCSM0", 2000); } catch (e) { /* segue */ }
  try { await comando("ATAT1", 2000); } catch (e) { /* APK antigo: nunca saiu do adaptativo */ }
  try { await comando("ATSP0", 2000); } catch (e) { /* segue */ }
}

/**
 * Manda um pedido de UDS e devolve { dados, nrc, nomeNrc, texto, hex, erro }.
 *
 * Duas coisas que todo aparelho de verdade trata e que é tentador esquecer:
 *  - 0x78 "recebi e estou trabalhando": o módulo pede mais tempo. Não é erro. Rotina de aprendizado
 *    manda isso várias vezes seguidas, e quem trata como erro conclui que o carro não tem a função.
 *  - a resposta tem de COMEÇAR com o serviço + 0x40. Procurar no meio do texto é o que faz dado de
 *    um módulo ser lido como se fosse de outro (a mesma armadilha que o js/obd.js descreve).
 */
export async function pedir(cmd, servico, esperaMs = 5000, tentativasPendente = 6) {
  const cru = await comando(cmd, esperaMs);
  let r = juntarLinhas(cru);
  if (r.erro) return { dados: null, nrc: null, texto: r.erro, hex: "", erro: r.erro };
  // O 0x78 ("recebi e estou trabalhando") pede mais tempo. O ELM327 não tem comando de "só ler",
  // então insistir significa mandar o pedido DE NOVO — e isso só pode ser feito com pedido que não
  // muda nada no carro. Por isso a insistência vale apenas para os serviços de leitura; para
  // qualquer outro o 0x78 sobe como está, e quem chamou decide (é o que rodarAprendizado faz,
  // perguntando o resultado de tempos em tempos). Antes daqui havia um reenvio para qualquer
  // serviço, e um ATRV no meio que podia engolir a resposta atrasada: achado da revisão
  // independente de 20/11/2026.
  const podeInsistir = SERVICOS_SO_LEITURA.includes(servico);
  for (let i = 0; podeInsistir && i < tentativasPendente; i++) {
    if (negativaDe(r.hex, servico) !== 0x78) break;
    await new Promise(f => setTimeout(f, 400));
    const outra = await comando(cmd, esperaMs).catch(() => "");
    const nova = juntarLinhas(outra);
    if (nova.erro) break;
    r = nova;
  }
  const n = negativaDe(r.hex, servico);
  if (n != null) {
    return { dados: null, nrc: n, nomeNrc: nomeNrc(n), texto: textoNrc(n), hex: r.hex, erro: "" };
  }
  const esperado = hx(servico + 0x40, 2);
  if (!r.hex.startsWith(esperado)) {
    return { dados: null, nrc: null, texto: "O módulo respondeu outra coisa.", hex: r.hex, erro: "resposta-inesperada" };
  }
  return { dados: bytesDe(r.hex.slice(2)), nrc: null, texto: "", hex: r.hex, erro: "" };
}

/** Se a resposta for negativa (7F <serviço> <código>), devolve o código. Senão, null. */
export function negativaDe(hex, servico) {
  const b = bytesDe(String(hex || ""));
  if (b.length < 3 || b[0] !== 0x7f) return null;
  if (servico != null && b[1] !== servico) return null;
  return b[2];
}

/* ------------------------------------------------------------------ leitura */

export const sessao = tipo => pedir(hx(SV.sessao, 2) + hx(tipo, 2), SV.sessao, 5000);
export const presenca = () => pedir(hx(SV.presenca, 2) + "80", SV.presenca, 2000);
export const lerDado = did => pedir(hx(SV.lerDado, 2) + hx(did, 4), SV.lerDado, 6000);

/**
 * Lê a ESCALA de um dado (0x24).
 *
 * Achado da pesquisa de 20/11/2026, e resolve de verdade um problema que vinha sendo contornado por
 * catálogo: o próprio módulo informa em que unidade e em que faixa aquele valor vem. Até aqui a
 * escala era adivinhada ou lida de arquivo de rótulo; com isto, quando o módulo responde, quem
 * manda é ele. Continua valendo a distinção que o projeto já fazia: ESCALA é o tamanho do
 * mostrador, não a faixa de normalidade do motor — quem diz o que é normal é a especificação.
 */
export const lerEscala = did => pedir(hx(SV.lerEscala, 2) + hx(did, 4), SV.lerEscala, 6000)
  .then(r => ({ ...r, escala: r.dados ? escalaDe(r.dados) : null }));

/**
 * Lê o byte de escala do 0x24: os 4 bits de cima dizem o TIPO e os 4 de baixo o TAMANHO em bytes.
 * Os tipos são os da ISO 14229-1. O que a oficina ganha com isto é não precisar adivinhar como
 * desmontar o valor: o módulo diz se é número sem sinal, com sinal, bit, BCD ou texto.
 */
export const TIPOS_ESCALA = {
  0x0: "número sem sinal", 0x1: "número com sinal", 0x2: "bit", 0x3: "BCD compactado",
  0x4: "BCD por byte", 0x5: "texto", 0x6: "vírgula flutuante", 0x7: "lista",
  0x8: "campo de bits", 0x9: "estendido", 0xa: "fórmula", 0xb: "unidade", 0xc: "data",
};
export function escalaDe(dados) {
  // dados: [DID alto, DID baixo, byte de escala, ...]
  //
  // Nem todo byte depois do eco do identificador é byte de escala: os tipos 9 (estendido),
  // A (fórmula) e B (unidade) são seguidos de bytes de EXTENSÃO, cuja quantidade vem no nibble de
  // baixo do próprio byte de escala. Tratar extensão como escala inventava item de escala na tela
  // quando o módulo usa fórmula ou unidade — achado da revisão independente de 20/11/2026.
  const d = (dados || []).slice(2);
  const COM_EXTENSAO = [0x9, 0xa, 0xb];
  const itens = [];
  for (let i = 0; i < d.length; i++) {
    const b = d[i], tipo = (b >> 4) & 0x0f, tamanho = b & 0x0f;
    itens.push({ tipo, nomeTipo: TIPOS_ESCALA[tipo] || "desconhecido", tamanho });
    if (COM_EXTENSAO.includes(tipo)) i += tamanho;   // pula os bytes de extensão deste item
  }
  return itens;
}

/** Falhas do módulo, por situação (0x19 subfunção 02). A máscara 0xFF pede todas. */
export async function lerFalhas(mascara = 0xff) {
  const r = await pedir(hx(SV.falhas, 2) + "02" + hx(mascara, 2), SV.falhas, 8000);
  if (r.dados == null) return { codigos: [], ...r };
  return { codigos: falhasDe(r.dados), ...r };
}

/**
 * Interpreta o corpo da resposta de falhas do UDS (0x19 02).
 *
 * A resposta vem assim: o ECO DA SUBFUNÇÃO (02), a máscara de disponibilidade e, depois, QUATRO
 * bytes por falha — três do código e um da situação. São DOIS bytes a descartar no começo, não um:
 * o eco da subfunção é fácil de esquecer, e esquecer desloca tudo em um byte. Quando isso acontece
 * o aparelho não dá erro: ele mostra códigos de falha que não existem no carro, e num laudo de
 * oficina esse é o pior defeito possível (o mesmo cuidado que o js/obd.js descreve para o ELM327).
 *
 * São quatro bytes por falha, e não dois como no OBD-II, porque o terceiro é o TIPO DE FALHA — o
 * número que aparece depois do traço quando a falha é escrita por extenso (no catálogo do Honda,
 * por exemplo, o 49 de um U3000-49). A tabela da ISO 14229-1 que o acervo já tem traduz esse byte.
 */
export function falhasDe(dados) {
  const d = (dados || []).slice(2);
  const codigos = [];
  for (let i = 0; i + 3 < d.length; i += 4) {
    codigos.push({ codigo: dtcDe(d[i], d[i + 1]), tipoFalha: d[i + 2], situacao: d[i + 3] });
  }
  return codigos;
}

/* ------------------------------------------------------------------ descoberta por recusa */

/**
 * Pergunta se uma rotina existe SEM rodar nada.
 *
 * O jeito é pedir o RESULTADO dela (subfunção 03), que não aciona nem aprende: o que interessa é
 * como o módulo recusa. A norma separa os motivos, e cada um conta uma coisa diferente:
 *   requestOutOfRange (0x31) → o módulo não conhece esse número (ou ele não vale nesta sessão)
 *   conditionsNotCorrect (0x22) → EXISTE, e o carro só não está do jeito que ela pede
 *   securityAccessDenied (0x33) → EXISTE, e é protegida: precisa de chave
 *   subFunction…InActiveSession (0x7E/0x7F) → EXISTE, e pede outra sessão
 * Com isso dá para mapear um módulo inteiro sem executar uma única rotina.
 *
 * Um cuidado que o AUTOSAR deixa claro e que é fácil errar: ao receber a rotina o módulo confere se
 * a permissão vale na sessão ABERTA e, se não valer, responde o mesmo 0x31 de "não existe". Então
 * 0x31 sozinho não prova ausência — prova ausência NAQUELA sessão. Por isso `existe` fica em
 * "talvez" quando a sessão é a comum, e a varredura roda na sessão estendida.
 */
export async function sondar(rid, { sessaoAtual = SESSAO.estendida } = {}) {
  if (!ridDeServico(rid)) return { rid, existe: false, motivo: "fora-da-faixa", texto: "Fora da faixa de rotina de veículo." };
  // Vai pelo MÉTODO PRÓPRIO do nativo, e não pelo comando(): o serviço 0x31 não é de leitura, e o
  // portão do nativo o recusa — com razão. Pedir o RESULTADO (subfunção 03) não aciona nem aprende
  // nada, mas ainda é o serviço 0x31, então passa pelo mesmo caminho conferido das outras rotinas.
  // (Antes isto ia pelo comando() e a sondagem simplesmente nunca funcionava: achado da revisão
  // independente de 20/11/2026.)
  const r = await rodarRotina(rid, ROTINA.resultado, "", 5000).catch(e => ({ erro: (e && e.message) || "falhou", texto: "" }));
  return { rid, ...vereditoDaSonda(r, sessaoAtual) };
}

/**
 * O veredito da sondagem, separado do pedido para poder ser testado sem carro.
 * É aqui que mora o raciocínio: cada motivo de recusa conta uma coisa diferente sobre o módulo.
 */
export function vereditoDaSonda(r, sessaoAtual = SESSAO.estendida) {
  if (!r || r.erro) return { existe: null, motivo: "sem-resposta", texto: (r && r.texto) || "Sem resposta." };
  if (r.nrc == null) return { existe: true, motivo: "respondeu", texto: "Existe e respondeu o resultado.", dados: r.dados };
  if (r.nrc === 0x31) {
    // 0x31 na sessão comum NÃO prova ausência: o AUTOSAR manda o módulo responder exatamente isso
    // quando a permissão não vale na sessão aberta. Prova ausência só na sessão de diagnóstico.
    const certo = sessaoAtual !== SESSAO.comum;
    return { existe: certo ? false : null, motivo: "nao-conhece", nrc: r.nrc,
      texto: certo ? "Este módulo não tem esta rotina."
                   : "Não respondeu nesta sessão. Abra a sessão de diagnóstico e pergunte de novo." };
  }
  if (r.nrc === 0x22) return { existe: true, motivo: "falta-condicao", nrc: r.nrc, texto: r.texto };
  if (r.nrc === 0x33 || r.nrc === 0x34) return { existe: true, motivo: "protegida", nrc: r.nrc, texto: r.texto };
  if (r.nrc === 0x7e || r.nrc === 0x7f) return { existe: true, motivo: "outra-sessao", nrc: r.nrc, texto: r.texto };
  if (r.nrc === 0x12 || r.nrc === 0x13) return { existe: true, motivo: "outra-opcao", nrc: r.nrc, texto: r.texto };
  return { existe: null, motivo: "recusou", nrc: r.nrc, texto: r.texto };
}

/** O mesmo, para um dado (0x22): aqui pedir já é ler, então a resposta vale por si. */
export async function sondarDado(did) {
  const r = await lerDado(did);
  if (r.erro) return { did, existe: null, motivo: "sem-resposta", texto: r.texto || "Sem resposta." };
  if (r.nrc == null) return { did, existe: true, motivo: "respondeu", valor: r.dados ? r.dados.slice(2) : [], texto: "" };
  if (r.nrc === 0x31) return { did, existe: false, motivo: "nao-conhece", nrc: r.nrc, texto: r.texto };
  if (r.nrc === 0x33 || r.nrc === 0x34) return { did, existe: true, motivo: "protegida", nrc: r.nrc, texto: r.texto };
  return { did, existe: null, motivo: "recusou", nrc: r.nrc, texto: r.texto };
}

/* ------------------------------------------------------------------ o que age no carro */

/*
 * Tudo daqui para baixo passa pelos métodos PRÓPRIOS do plugin nativo (atuar, rotina, gravar,
 * destravar, reiniciarModulo), nunca pelo comando(). Quem confere o formato e a faixa é o nativo;
 * aqui fica a sequência, que é o que não pode sair errado.
 *
 * O que estas ações AINDA NÃO fazem: ficar registradas no banco. A tabela obd_leituras só aceita os
 * tipos "leitura" e "apagar", e estender isso é SQL. Até entrar, as telas dizem que o teste não fica
 * registrado — melhor isso do que dar a entender que fica.
 */

/** Diz se o APK instalado tem a camada que age no carro (APK antigo não tem). */
export const podeAgir = () => { const p = plugin(); return !!(p && typeof p.atuar === "function" && typeof p.rotina === "function"); };
/** O APK tem a gravação de dado no módulo do motor (gravarDado, de 21/11/2026 em diante)? */
export const podeGravar = () => { const p = plugin(); return !!(p && typeof p.gravarDado === "function"); };

/**
 * Pergunta ao módulo do motor se ele ACEITA gravar naquele campo, sem gravar nada (ver sondarGravacao
 * no nativo: manda o pedido com tamanho errado de propósito e lê em que degrau o módulo parou).
 * Devolve { aceita: true|false|null, motivo, texto, bytes }. null = não deu para saber.
 */
export async function aceitaGravar(did) {
  const p = plugin();
  if (!p || typeof p.sondarGravacao !== "function") return { aceita: null, motivo: "apk-antigo", texto: "O APK instalado não tem esta conferência." };
  const r = await p.sondarGravacao({ did: hx(did, 4) });
  return vereditoDaGravacao(r);
}
/** O veredito, separado do pedido para poder ser conferido sem carro. */
export function vereditoDaGravacao(r) {
  const lido = respostaDe({ resposta: (r && r.antes) || "" }, SV.lerDado);
  const bytes = lido.dados ? Math.max(0, lido.dados.length - 2) : 0;
  if (!r || !r.perguntou) {
    if (lido.nrc === 0x31) return { aceita: false, motivo: "nao-existe", bytes: 0, texto: "Este campo não existe neste módulo." };
    if (lido.nrc === 0x33) return { aceita: false, motivo: "protegido", bytes: 0, texto: "O módulo não deixa nem LER este campo sem destravar. O app não tem a chave: não dá para gravar." };
    if (bytes === 1) return { aceita: null, motivo: "um-byte", bytes, texto: "Este campo tem um byte só: perguntar se aceita gravar seria gravar, então o app não pergunta. Um código de bico não cabe em um byte — confira o número do campo." };
    return { aceita: null, motivo: "sem-leitura", bytes, texto: "O módulo não entregou o valor atual deste campo" + (lido.texto ? " (" + lido.texto + ")" : "") + "." };
  }
  const g = respostaDe({ resposta: r.resposta || "" }, 0x2e);
  if (g.erro) return { aceita: null, motivo: "sem-resposta", bytes, texto: "O módulo não respondeu à pergunta." };
  if (g.nrc === 0x13) return { aceita: true, motivo: "aceita", bytes, texto: "O módulo aceita gravar neste campo (" + bytes + " bytes)." };
  if (g.nrc === 0x33 || g.nrc === 0x34) return { aceita: false, motivo: "trancado", bytes, texto: "Este módulo exige DESTRAVAR antes de gravar, e o app não tem a chave desta família. A gravação não está disponível aqui." };
  if (g.nrc === 0x31) return { aceita: false, motivo: "so-leitura", bytes, texto: "Este campo é só de leitura neste módulo: não é nele que o código do bico é gravado." };
  if (g.nrc === 0x11 || g.nrc === 0x7f || g.nrc === 0x12) return { aceita: false, motivo: "sem-servico", bytes, texto: "Este módulo não tem gravação de dado nesta sessão de diagnóstico." };
  if (g.nrc === 0x22) return { aceita: false, motivo: "condicao", bytes, texto: "O módulo recusou pelas condições do carro agora (motor ligado, tensão, velocidade). Deixe a ignição ligada com o motor desligado e confira de novo." };
  if (g.nrc == null) return { aceita: null, motivo: "inesperado", bytes, texto: "O módulo respondeu de um jeito fora da norma. O app não libera a gravação sem ter certeza." };
  return { aceita: false, motivo: "recusou", bytes, texto: "O módulo recusou" + (g.texto ? ": " + g.texto : ".") };
}

/**
 * Grava UM dado no módulo do motor e devolve { gravou, antes, nrc, texto }.
 * Quem lê o valor antigo é o NATIVO, no mesmo passo, e ele só grava se o módulo o entregou: `antes`
 * (bytes) é o que estava lá, e é com ele que se desfaz. O nativo recusa qualquer módulo que não
 * seja o do motor e a faixa de identificação (chassi, número de peça).
 */
export async function gravarDado(did, valorHex, esperaMs = 8000) {
  const r = await plugin().gravarDado({ did: hx(did, 4), valor: String(valorHex || "").toUpperCase(), esperaMs });
  const lido = respostaDe({ resposta: (r && r.antes) || "" }, SV.lerDado);
  if (!r || !r.gravou) {
    return { gravou: false, antes: null, nrc: lido.nrc, texto: "O módulo não entregou o valor atual deste campo" + (lido.texto ? " (" + lido.texto + ")" : "") + ". Sem o valor antigo não dá para desfazer, então nada foi gravado." };
  }
  const g = respostaDe({ resposta: r.resposta || "" }, 0x2e);
  // Três desfechos, e o do meio não é recusa: o pedido de escrita FOI ENVIADO e a resposta se perdeu
  // (tempo estourado, STOPPED). O módulo pode ter gravado. `incerto` mantém o valor antigo na mão de
  // quem chamou, para dar para desfazer.
  const antes = lido.dados ? lido.dados.slice(2) : [];
  // 0x78 = "recebi, ainda estou processando": a escrita pode se completar depois. Também é incerto.
  if (g.nrc === 0x78) return { gravou: false, incerto: true, antes, nrc: 0x78, texto: "O módulo recebeu o pedido de gravação e respondeu que ainda está processando (78). Pode ter gravado ou não." };
  if (r.caiu || (g.nrc == null && (g.erro || !g.dados))) return { gravou: false, incerto: true, antes, nrc: null, texto: "O pedido de gravação foi enviado, mas a resposta do módulo se perdeu (" + (r.caiu ? "a conexão caiu" : g.erro || "sem resposta") + "). Pode ter gravado ou não." };
  return { gravou: g.nrc == null, antes, nrc: g.nrc, texto: g.texto || "" };
}

export const respostaDe = (r, servico) => {
  const j = juntarLinhas((r && r.resposta) || "");
  if (j.erro) return { dados: null, nrc: null, texto: j.erro, hex: "", erro: j.erro };
  const n = negativaDe(j.hex, servico);
  if (n != null) return { dados: null, nrc: n, nomeNrc: nomeNrc(n), texto: textoNrc(n), hex: j.hex, erro: "" };
  const esperado = hx(servico + 0x40, 2);
  if (!j.hex.startsWith(esperado)) return { dados: null, nrc: null, texto: "O módulo respondeu outra coisa.", hex: j.hex, erro: "resposta-inesperada" };
  return { dados: bytesDe(j.hex.slice(2)), nrc: null, texto: "", hex: j.hex, erro: "" };
};

/** Aciona uma saída do módulo (0x2F, opção 03 = ajuste de curta duração). */
export const acionar = (did, valor = "", esperaMs = 8000) =>
  P().atuar({ did: hx(did, 4), opcao: hx(ATUAR.ajustar, 2), valor: String(valor || "").toUpperCase(), esperaMs })
    .then(r => respostaDe(r, SV.atuar));

/** Devolve o controle da saída ao módulo (0x2F, opção 00). É o passo que NUNCA pode faltar. */
export const devolver = (did, esperaMs = 6000) =>
  P().atuar({ did: hx(did, 4), opcao: hx(ATUAR.devolver, 2), valor: "", esperaMs })
    .then(r => respostaDe(r, SV.atuar));

/** Rotina de serviço (0x31). */
export const rodarRotina = (rid, sub = ROTINA.comecar, dados = "", esperaMs = 15000) =>
  P().rotina({ sub: hx(sub, 2), rotina: hx(rid, 4), dados: String(dados || "").toUpperCase(), esperaMs })
    .then(r => respostaDe(r, SV.rotina));

/*
 * NÃO EXISTEM, de propósito: gravar (0x2E) e destravar (0x27).
 *
 * O plugin nativo não expõe mais esses dois métodos — saíram na reconferência da revisão
 * independente de 20/11/2026, porque nenhuma tela os usava. Método publicado que ninguém chama é
 * superfície de ataque de graça, e o 0x2E é escrita de CALIBRAÇÃO: é por ele que se mexe em
 * codificação de variante, canal de adaptação, imobilizador e configuração de airbag.
 *
 * Então a promessa deste APK é mais forte do que "não regrava módulo": ele não escreve nada de
 * calibração em módulo nenhum. Ele aciona atuador, roda rotina de serviço, reinicia módulo e apaga
 * falha — e é só isso.
 *
 * Quando a programação de bico tiver o número do campo por família de ECU, os dois voltam, com
 * lista de identificadores permitidos em vez de escrita livre.
 */

/** Reinicia o módulo (0x11): vários só passam a valer o dado gravado depois disto. */
export const reiniciarModulo = (tipo = "01", esperaMs = 10000) =>
  P().reiniciarModulo({ tipo, esperaMs }).then(r => respostaDe(r, SV.reiniciar));

/** Apaga as falhas de UM módulo (0x14 FF FF FF), pelo método próprio do nativo. */
export const apagarDoModulo = (esperaMs = 10000) =>
  P().apagar({ modo: "uds", esperaMs }).then(r => respostaDe(r, SV.apagar));

/* ------------------------------------------------------------------ o teste de atuador */

/**
 * Teste de atuador do começo ao fim, com a volta garantida.
 *
 * A ordem é a que os dois projetos abertos que fazem isto de verdade usam, e cada passo existe por
 * um motivo que já custou caro a alguém:
 *
 *  1. PARAR a leitura de fundo. O ELM327 atende um pedido por vez; se a roda de dados ao vivo
 *     continuar perguntando, o comando de acionamento entra no meio e a resposta volta trocada.
 *     (É assim que o projeto do MG elétrico faz, e por isso o `pausar` é obrigatório aqui.)
 *  2. Abrir a sessão de diagnóstico: fora dela a maioria dos módulos recusa o 0x2F.
 *  3. Acionar, e repetir o acionamento mais ou menos uma vez por segundo. Isso não é capricho: o
 *     "ajuste de curta duração" é curto DE PROPÓSITO — o módulo devolve a saída sozinho se o
 *     aparelho calar. É a trava de segurança da própria norma, e o jeito de manter o atuador
 *     acionado é continuar pedindo.
 *  4. DEVOLVER o controle ao módulo, sempre: no fim, no erro, no cancelamento e se a conexão cair.
 *     Tenta duas vezes. Atuador que fica preso no comando do aparelho é atuador que queima.
 *  5. Voltar para a sessão comum.
 */
export async function testarAtuador(did, opc = {}) {
  let { valor = "" } = opc;
  const { segundos = 5, intervaloMs = 1000, pausar = null, retomar = null,
          aoAndar = null, continuar = () => true } = opc;
  const passos = [];
  const anota = (o, t) => { passos.push({ o, t }); if (aoAndar) { try { aoAndar({ o, t, passos: passos.slice() }); } catch (e) { /* tela fechou */ } } };
  let pausou = false;
  try {
    if (pausar) { await pausar(); pausou = true; anota("pausa", "Leitura ao vivo parada para o comando não se atropelar."); }
    const s = await sessao(SESSAO.estendida);
    if (s.nrc != null) return { ok: false, passos, texto: s.texto, nrc: s.nrc };
    anota("sessao", "Sessão de diagnóstico aberta.");
    // O 0x2F pede bytes de estado junto, e quantos depende do atuador — e isso está num anexo da
    // norma que não temos. Então tenta sem, e se o módulo reclamar do TAMANHO (0x13) tenta com um
    // byte e com dois. Pedido de tamanho errado é recusado pelo módulo sem acionar nada, então a
    // tentativa é segura. Antes só tentava sem, e na prática o teste não acionava quase nada.
    let primeira = null, usado = valor;
    for (const tentativa of [valor, valor || "01", valor || "0100"]) {
      primeira = await acionar(did, tentativa);
      usado = tentativa;
      if (primeira.nrc !== 0x13) break;
      anota("tamanho", "O módulo pediu o comando com mais dados. Tentando de outro jeito.");
    }
    // 0x78 e 0x21 não são recusa: o módulo recebeu e está trabalhando. Tratar como recusa fazia o
    // app desistir COM O COMANDO JÁ ACEITO — achado da revisão independente de 20/11/2026.
    if (primeira.nrc === 0x78 || primeira.nrc === 0x21) {
      anota("andando", "O módulo recebeu e está trabalhando.");
    } else if (primeira.nrc != null || primeira.erro) {
      anota("recusou", primeira.texto || "O módulo não aceitou o comando.");
      return { ok: false, passos, texto: primeira.texto, nrc: primeira.nrc };
    }
    valor = usado;
    anota("acionou", "Acionado. Confira no carro.");
    const fim = Date.now() + Math.max(1, segundos) * 1000;
    while (Date.now() < fim && continuar()) {
      await new Promise(f => setTimeout(f, intervaloMs));
      if (!continuar()) break;
      const r = await acionar(did, valor, 4000).catch(() => ({ erro: "conexao-caiu" }));
      if (r.erro || r.nrc != null) { anota("parou", r.texto || "O módulo interrompeu o teste."); break; }
    }
    return { ok: true, passos, texto: "Teste terminado." };
  } catch (e) {
    anota("erro", "Deu problema no meio do teste. O controle está sendo devolvido ao módulo.");
    return { ok: false, passos, texto: "Deu problema no meio do teste.", erro: (e && e.message) || "falhou" };
  } finally {
    // devolver o controle é o passo que não pode falhar: duas tentativas, aconteça o que acontecer
    let devolveu = false;
    for (let i = 0; i < 2 && !devolveu; i++) {
      try { const d = await devolver(did); devolveu = !d.erro && d.nrc == null; } catch (e) { devolveu = false; }
      if (!devolveu) await new Promise(f => setTimeout(f, 400));
    }
    anota(devolveu ? "devolveu" : "nao-devolveu", devolveu
      ? "Controle devolvido ao módulo."
      : "NÃO deu para devolver o controle. Desligue a chave para o módulo reassumir a saída.");
    try { await sessao(SESSAO.comum); } catch (e) { /* já caiu: a chave desligada resolve */ }
    if (pausou && retomar) { try { await retomar(); } catch (e) { /* tela fechou */ } }
  }
}

/**
 * Roda uma rotina de aprendizado ou calibração e acompanha até terminar.
 *
 * Diferente do atuador, aqui o módulo trabalha sozinho depois do "começar": o aparelho só pergunta
 * o resultado (subfunção 03) de tempos em tempos. O 0x78 "estou trabalhando" é tratado como
 * andamento, não como erro — rotina de aprendizado manda isso por vários segundos.
 */
export async function rodarAprendizado(rid, {
  dados = "", segundosMax = 120, intervaloMs = 1500, pausar = null, retomar = null,
  aoAndar = null, continuar = () => true,
} = {}) {
  const passos = [];
  const anota = (o, t) => { passos.push({ o, t }); if (aoAndar) { try { aoAndar({ o, t, passos: passos.slice() }); } catch (e) { /* tela fechou */ } } };
  let pausou = false, comecou = false, terminou = false;
  try {
    if (pausar) { await pausar(); pausou = true; anota("pausa", "Leitura ao vivo parada."); }
    const s = await sessao(SESSAO.estendida);
    if (s.nrc != null) return { ok: false, passos, texto: s.texto, nrc: s.nrc };
    anota("sessao", "Sessão de diagnóstico aberta.");
    // A conexão pode cair DEPOIS de o pedido sair: a promessa rejeitada é tratada como "enviado, sem
    // resposta" (rotina possivelmente começada), não como erro genérico.
    const c = await rodarRotina(rid, ROTINA.comecar, dados).catch(() => ({ erro: "conexao-caiu", texto: "a conexão caiu" }));
    // 0x78 e 0x21 querem dizer que o módulo RECEBEU e está trabalhando. Tratar como recusa fazia o
    // app desistir com a rotina já correndo dentro do módulo, e sem mandar o "parar" — achado da
    // revisão independente de 20/11/2026.
    if (c.nrc != null && c.nrc !== 0x78 && c.nrc !== 0x21) {
      anota("recusou", c.texto || "O módulo não aceitou começar.");
      return { ok: false, passos, texto: c.texto, nrc: c.nrc };
    }
    if (c.erro) {
      // O pedido de início FOI ENVIADO e a resposta se perdeu: a rotina pode estar rodando. Marca como
      // começada para o `finally` mandar parar — e avisar se a parada não for confirmada.
      comecou = true;
      const t = "O pedido para começar foi enviado, mas a resposta do módulo se perdeu. A rotina pode ter começado; o app mandou interromper.";
      anota("incerto", t);
      return { ok: false, passos, texto: t, incerto: true };
    }
    comecou = true;
    anota("comecou", "Rotina começou. Não desligue a chave.");
    const fim = Date.now() + Math.max(1, segundosMax) * 1000;
    while (Date.now() < fim && continuar()) {
      await new Promise(f => setTimeout(f, intervaloMs));
      if (!continuar()) break;
      const r = await rodarRotina(rid, ROTINA.resultado, "", 8000).catch(() => ({ erro: "conexao-caiu" }));
      if (r.erro) { anota("sem-resposta", "O módulo parou de responder."); return { ok: false, passos, texto: "O módulo parou de responder." }; }
      if (r.nrc === 0x78 || r.nrc === 0x21) { anota("andando", "Trabalhando…"); continue; }
      if (r.nrc != null) { anota("recusou", r.texto); return { ok: false, passos, texto: r.texto, nrc: r.nrc }; }
      terminou = true;
      anota("pronto", "Rotina concluída.");
      return { ok: true, passos, texto: "Rotina concluída.", dados: r.dados };
    }
    // acabou o tempo com o módulo ainda trabalhando: parar é mais seguro que deixar correndo solto
    // …mas só diz que PAROU se o módulo confirmar. Recusa ou silêncio na parada não é parada.
    const pr = await rodarRotina(rid, ROTINA.parar, "", 6000).catch(() => ({ erro: "conexao-caiu" }));
    terminou = true;                                  // a parada já foi pedida: o finally não repete
    if (pr.erro || pr.nrc != null) {
      const t = "A rotina não terminou no tempo e o módulo NÃO confirmou a interrupção" + (pr.texto ? " (" + pr.texto + ")" : "") + ". Ela pode estar rodando: desligue a chave e aguarde antes de mexer no carro.";
      anota("nao-parou", t);
      return { ok: false, passos, texto: t, paradaNaoConfirmada: true };
    }
    anota("tempo", "Passou do tempo e a rotina foi interrompida.");
    return { ok: false, passos, texto: "Passou do tempo e a rotina foi interrompida." };
  } catch (e) {
    return { ok: false, passos, texto: "Deu problema no meio da rotina.", erro: (e && e.message) || "falhou" };
  } finally {
    // Se a rotina COMEÇOU e não chegou ao fim, manda parar antes de sair. Deixar rotina de
    // aprendizado correndo solta dentro do módulo é o que não pode acontecer.
    if (comecou && !terminou) {
      const pr = await rodarRotina(rid, ROTINA.parar, "", 6000).catch(() => ({ erro: "conexao-caiu" }));
      if (pr.erro || pr.nrc != null) anota("nao-parou", "O módulo NÃO confirmou a interrupção da rotina. Ela pode estar rodando: desligue a chave e aguarde.");
      else anota("parou", "Rotina interrompida no módulo.");
    }
    try { await sessao(SESSAO.comum); } catch (e) { /* segue */ }
    if (pausou && retomar) { try { await retomar(); } catch (e) { /* tela fechou */ } }
  }
}

/* ------------------------------------------------------------------ o acervo do projeto */

/**
 * O byte de tipo de falha, em palavra.
 *
 * É a peça que completa o código. Um P0171 sozinho diz "mistura pobre no banco 1"; um P0171 com o
 * tipo 0x13 diz "mistura pobre no banco 1, circuito aberto". A primeira frase manda procurar; a
 * segunda manda onde procurar. E isto vale para QUALQUER carro que fale UDS, sem catálogo de marca.
 *
 * A tabela cobre 111 dos 256 valores possíveis do byte: é o que a fonte aberta trouxe, não a norma
 * inteira. Valor que não está nela devolve texto vazio DE PROPÓSITO, e a tela mostra o número cru —
 * "P0171-2B" sem causa é informação honesta; "P0171-2B, circuito aberto" chutado é laudo errado.
 */
export const textoTipoFalha = n => (acervo.tipoFalha || {})[String(n)] || "";

/** O código do jeito que a oficina escreve, com o sufixo do tipo: P0171-13. */
export function codigoCom(codigo, tipoFalha) {
  if (tipoFalha == null) return codigo;
  return codigo + "-" + hx(tipoFalha, 2);
}

/** Os bits de situação que estão ligados, em palavra. */
export function situacaoDe(byte) {
  const bits = acervo.situacao || [];
  const ligados = [];
  for (let i = 0; i < bits.length; i++) if ((byte >> i) & 1) ligados.push({ nome: bits[i][0], t: bits[i][1] });
  return ligados;
}
/** Resumo curto da situação, para caber na linha da tela. */
export function resumoSituacao(byte) {
  const l = situacaoDe(byte);
  if (!l.length) return "sem situação informada";
  const ordem = ["confirmada", "pendente", "falhou agora", "pede luz no painel"];
  const fortes = l.filter(x => ordem.includes(x.t)).sort((a, b) => ordem.indexOf(a.t) - ordem.indexOf(b.t));
  return (fortes.length ? fortes : l).map(x => x.t).join(" · ");
}

/** Uma falha do UDS, pronta para a tela. */
export function falhaPronta(f) {
  return {
    ...f,
    rotulo: codigoCom(f.codigo, f.tipoFalha),
    causa: textoTipoFalha(f.tipoFalha),
    situacaoTexto: resumoSituacao(f.situacao),
    pedeLuz: situacaoDe(f.situacao).some(x => x.nome === "warningIndicatorRequested"),
  };
}

/* ------------------------------------------------------------------ onde os módulos ficam */

/**
 * Os endereços de 11 bits que a norma reserva para diagnóstico: o pedido vai em 7E0 a 7E7 e a
 * resposta volta no mesmo número mais 8 (7E8 a 7EF). É por aqui que a varredura de um carro
 * desconhecido começa, porque não depende de saber a marca.
 *
 * Os três primeiros têm lugar conhecido e aparecem no mapa da VAG tirado do ODIS: 7E0 é o motor,
 * 7E1 o câmbio e 7E2 um segundo módulo de motor. Do 7E3 em diante o nome varia, e o app mostra o
 * endereço em vez de chutar quem é.
 */
export const ENDERECOS_PADRAO = [
  { pedido: "7E0", resposta: "7E8", nome: "Motor" },
  { pedido: "7E1", resposta: "7E9", nome: "Câmbio" },
  { pedido: "7E2", resposta: "7EA", nome: "Motor (segundo módulo)" },
  { pedido: "7E3", resposta: "7EB", nome: "" },
  { pedido: "7E4", resposta: "7EC", nome: "" },
  { pedido: "7E5", resposta: "7ED", nome: "" },
  { pedido: "7E6", resposta: "7EE", nome: "" },
  { pedido: "7E7", resposta: "7EF", nome: "" },
];

/** As famílias de módulo que o acervo tem, para a tela listar. */
export const familias = () => Object.keys(acervo.modulos || {}).sort();
/** Os módulos de uma família: { pedido, resposta, nome }. */
export const modulosDa = fam => ((acervo.modulos || {})[fam] || []).map(m => ({ pedido: m[0], resposta: m[1], nome: m[2] }));
/** Quantos módulos o acervo conhece, no total. */
export const quantosModulos = () => Object.values(acervo.modulos || {}).reduce((s, l) => s + l.length, 0);
export const versaoAcervo = () => acervo.versao || "";

/* ------------------------------------------------------------------ ePTI (ISO 20730) */

/*
 * O ePTI é a norma da inspeção técnica eletrônica, e faz uma coisa que nenhuma outra faz: padroniza
 * IGUAL PARA TODAS AS MARCAS a lista dos sistemas de segurança e os identificadores com que o
 * módulo informa o que ele tem, o que aceita rodar e o que aceita acionar.
 *
 * O que temos e o que não temos (conferido em 20/11/2026):
 *  - Anexo A, a lista de sistemas: temos inteira, 57 sistemas. Está no acervo.
 *  - Anexo B, Tabela B.1, os identificadores de dado: temos de FA19 a FA2A.
 *  - Anexos C (rotinas) e D (atuadores): NÃO temos, e não existem em base aberta — procurei na ISO,
 *    na UNECE, na CITA, na EGEA e em código aberto. Então o app não carrega lista de rotina nem de
 *    atuador: ele PERGUNTA AO CARRO. É exatamente para isso que os identificadores existem, e é
 *    mais confiável que tabela, porque a resposta é daquele módulo e não de um catálogo genérico.
 *
 * UMA ARMADILHA QUE CUSTARIA CARO: entre o rascunho de 2020 e a norma publicada de 2021 os dois
 * identificadores TROCARAM DE LUGAR. No rascunho FA22 era atuador e FA23 rotina; na norma publicada
 * FA22 é rotina e FA23 atuador. Um módulo feito na época do rascunho responde invertido. Por isso
 * `descobrirEpti` lê os dois e decide pelo CONTEÚDO: número na faixa de rotina do fabricante
 * (0x0200 a 0xDFFF) é rotina; o resto é identificador de atuador. Confiar no número do
 * identificador faria o aparelho pedir rotina e receber atuador.
 */
export const EPTI = {
  edicao: 0xfa19,        // edição da norma que o módulo segue
  dados: 0xfa20,         // quais dados ele tem
  sistemas: 0xfa21,      // quais sistemas de segurança ele cuida
  rotinas: 0xfa22,       // publicada: rotinas · rascunho: atuadores
  atuadores: 0xfa23,     // publicada: atuadores · rascunho: rotinas
  situacao: 0xfa24,      // situação dos sistemas e do autoteste
  odometro: 0xfa2a,      // valores dinâmicos de condução
};

const eptiAcervo = () => acervo.epti || {};
/** Os sistemas de segurança que a norma lista: { id, sim, nome }. */
export const sistemasEpti = () => (eptiAcervo().sistemas || []).map(s => ({ id: s[0], sim: s[1], nome: s[2] }));
/** O nome em português de um sistema pelo número (aceita "000B" ou 0x000B). */
export function nomeSistemaEpti(id) {
  const t = typeof id === "number" ? hx(id, 4) : String(id || "").toUpperCase().padStart(4, "0");
  const s = (eptiAcervo().sistemas || []).find(x => x[0] === t);
  return s ? s[2] : "";
}
/** Os identificadores de dado da norma: { id, sim, nome, obrigatorio }. */
export const didsEpti = () => (eptiAcervo().dids || []).map(d => ({ id: d[0], sim: d[1], nome: d[2], obrigatorio: !!d[3] }));
export const nomeDidEpti = did => {
  const t = typeof did === "number" ? hx(did, 4) : String(did || "").toUpperCase();
  const d = (eptiAcervo().dids || []).find(x => x[0] === t);
  return d ? d.nome || d[2] : "";
};
/** Diz se o acervo tem a lista de rotina e de atuador da norma (hoje não tem: os anexos faltam). */
export const eptiTemAnexoCD = () => !eptiAcervo().semAnexoCD;

/**
 * Lê uma lista de números de 16 bits que o módulo devolve num identificador do ePTI.
 * O formato exato do registro está numa cláusula que não temos, então aqui a leitura é a óbvia
 * (pares de bytes) e o resultado é CONFERIDO: se não der número par de bytes, devolve o cru para a
 * tela mostrar em vez de inventar uma lista.
 */
export function listaDe16(dados) {
  const d = (dados || []).slice(2);               // os dois primeiros são o eco do identificador
  if (!d.length || d.length % 2 !== 0) return { lista: [], cru: d, certo: false };
  const lista = [];
  for (let i = 0; i + 1 < d.length; i += 2) lista.push((d[i] << 8) | d[i + 1]);
  return { lista, cru: d, certo: true };
}

/**
 * Decide qual lista é de rotina e qual é de atuador pelo CONTEÚDO, não pelo número do identificador.
 *
 * Existe porque os dois identificadores trocaram de lugar entre o rascunho de 2020 e a norma
 * publicada de 2021. O critério é o único confiável: número de rotina de veículo mora na faixa do
 * fabricante (0x0200 a 0xDFFF), que a ISO 14229-1 reserva para isso. Lista inteira dentro da faixa
 * é lista de rotina; fora dela é identificador de atuador.
 *
 * `la` é o que veio no FA22 e `lb` o que veio no FA23.
 */
export function decidirRotinaAtuador(la, lb) {
  const A = la || [], B = lb || [];
  // Para inverter, a prova tem de vir das DUAS listas e concordar. Uma lista só não basta:
  //  - número de ROTINA mora de 0x0100 a 0xE2FF (tacógrafo, fabricante, teste de emissão e
  //    segurança são todas faixas de rotina da ISO 14229-1 — não só a do fabricante);
  //  - identificador de ATUADOR é um identificador de dado, e os do ePTI moram na parte alta,
  //    de 0xF000 para cima.
  // Então só inverte quando o que veio no FA23 parece rotina E o que veio no FA22 parece atuador.
  // Qualquer outro caso fica como a norma publicada manda, marcado como `duvida`, para a tela
  // mostrar os dois rótulos e pedir confirmação — o app não decide sozinho o que vai ser acionado.
  const pareceRotina = l => l.length > 0 && l.every(n => n >= 0x0100 && n <= 0xe2ff);
  const pareceAtuador = l => l.length > 0 && l.every(n => n >= 0xf000);
  if (pareceRotina(B) && pareceAtuador(A)) return { rotinas: B, atuadores: A, invertido: true, duvida: false };
  const certo = pareceRotina(A) && (pareceAtuador(B) || B.length === 0);
  return { rotinas: A, atuadores: B, invertido: false, duvida: !certo && (A.length > 0 || B.length > 0) };
}


/**
 * Descobre, perguntando ao carro, o que este módulo tem — na ordem que a própria norma usa
 * (ISO 20730-1, cláusula 15): primeiro o que ele tem, só depois se age nele.
 *
 * Devolve { edicao, sistemas, dados, rotinas, atuadores, situacao, invertido, avisos }.
 * `invertido` fica verdadeiro quando o módulo respondeu no jeito do rascunho.
 */
export async function descobrirEpti({ aoAndar = null } = {}) {
  const r = { edicao: null, sistemas: [], dados: [], rotinas: [], atuadores: [], situacao: null, invertido: false, avisos: [] };
  const anota = t => { if (aoAndar) { try { aoAndar(t); } catch (e) { /* tela fechou */ } } };

  anota("Perguntando a edição da norma…");
  const ed = await lerDado(EPTI.edicao);
  if (ed.nrc == null && ed.dados) r.edicao = ed.dados.slice(2);
  else if (ed.nrc === 0x31) r.avisos.push("Este módulo não responde ao ePTI. A varredura segue pelo caminho comum do UDS.");

  anota("Perguntando quais sistemas de segurança ele cuida…");
  const sis = await lerDado(EPTI.sistemas);
  if (sis.nrc == null && sis.dados) {
    const l = listaDe16(sis.dados);
    r.sistemas = l.lista.map(n => ({ id: hx(n, 4), nome: nomeSistemaEpti(n) }));
    if (!l.certo) r.avisos.push("A lista de sistemas veio num formato que o app não reconheceu; mostrando o que chegou.");
  }

  anota("Perguntando quais dados ele sabe informar…");
  const dd = await lerDado(EPTI.dados);
  if (dd.nrc == null && dd.dados) r.dados = listaDe16(dd.dados).lista.map(n => ({ did: hx(n, 4), nome: nomeDidEpti(hx(n, 4)) }));

  // Os dois que trocaram de lugar entre o rascunho e a norma: lê os dois e decide pelo conteúdo.
  anota("Perguntando as rotinas e os atuadores que ele aceita…");
  const a = await lerDado(EPTI.rotinas);
  const b = await lerDado(EPTI.atuadores);
  const la = a.nrc == null && a.dados ? listaDe16(a.dados).lista : [];
  const lb = b.nrc == null && b.dados ? listaDe16(b.dados).lista : [];
  const d = decidirRotinaAtuador(la, lb);
  r.rotinas = d.rotinas; r.atuadores = d.atuadores; r.invertido = d.invertido; r.duvida = d.duvida;
  if (d.invertido) r.avisos.push("Este módulo responde no jeito do rascunho da norma, com os dois identificadores trocados. O app corrigiu pelo conteúdo da resposta.");
  if (d.duvida) r.avisos.push("Não deu para saber com certeza qual lista é de rotina e qual é de atuador: o módulo respondeu números que cabem nas duas leituras. Ficou como a norma publicada manda. Confira o número antes de acionar.");

  anota("Perguntando como está cada sistema…");
  const st = await lerDado(EPTI.situacao);
  if (st.nrc == null && st.dados) r.situacao = st.dados.slice(2);

  if (r.rotinas.length || r.atuadores.length) {
    // A norma prevê autenticação do aparelho de teste antes de acionar (ISO 20730-2, grupo CTG_2).
    // Então "o módulo lista" não quer dizer "o módulo deixa": muito provavelmente vai pedir o 0x27.
    r.avisos.push("O módulo listou o que aceita, mas a norma prevê autenticação do aparelho antes de acionar. Se pedir chave, o app avisa e para aí.");
  }
  return r;
}
