/**
 * HONDA: os testes de atuador e os aprendizados que têm NOME, um por um. (Etapa 1, frentes 2 e 5.)
 *
 * De onde vem cada número: da ferramenta de diagnóstico da Honda (HDS), decodificada no projeto
 * aberto HondaDiagnosticSuite (arquivos actuator.rs e write.rs). Nada aqui foi deduzido: cada
 * identificador, cada condição e cada byte de conferência está escrito lá, com a linha de origem.
 *
 * O AVISO QUE O AUTOR DAQUELE PROJETO DÁ, e que vale aqui igual: estes testes foram conferidos
 * contra módulo SIMULADO, não contra carro. O primeiro carro de verdade é o que estiver na oficina.
 * Por isso cada um pede as condições por escrito, tem tempo máximo e devolve o controle no fim.
 *
 * Só aparece quando o carro é Honda. Em outra marca estes números não significam nada.
 */
export const eHonda = carro => /HONDA|ACURA/i.test((carro && carro.marca) || "") || /^(93H|1HG|JHM|2HG|19X|SHH|MRH|LUC)/i.test((carro && carro.vin) || "");

// Onde o módulo costuma responder (29 bits). O motor aparece em 0E (Accord 2015, na ferramenta) e
// em 10 (City, Civic, Fit, no OBDb): o app tenta os dois, nessa ordem, e usa o que abrir a sessão.
const END = a => ({ pedido: "18DA" + a + "F1", resposta: "18DAF1" + a });
export const MODULOS = {
  // CONFERIDO NO CARRO (City 2016 do Danilo, 21/11/2026): os dois endereços abrem sessão, mas o 0E
  // recusou o teste da ventoinha com "precisa destravar" (33). O motor do City é o 10 — por isso o 10
  // vem primeiro, e o app passa para o outro quando o primeiro recusa sem acionar nada.
  motor: { nome: "Motor (PGM-FI)", enderecos: [END("10"), END("0E")] },
  cvt: { nome: "Câmbio CVT", enderecos: [END("0E"), END("1E")] },
  painel: { nome: "Painel", enderecos: [END("60")] },
  abs: { nome: "ABS/VSA", enderecos: [END("28")] },
};

const C = {
  motor_desligado: "Motor DESLIGADO, com a ignição ligada",
  parado: "Carro parado",
  em_p: "Câmbio em P (ou ponto morto com freio de mão, no manual)",
  ac_desligado: "Ar-condicionado DESLIGADO",
  bateria_10_5: "Bateria acima de 10,5 V",
  bateria_10: "Bateria acima de 10 V",
  bateria_8: "Bateria acima de 8 V",
};

/** Testes de atuador (serviço 2F: aciona com 03 + valor, devolve com 00). */
export const ATUADORES = [
  { chave: "ventoinha", nome: "Eletroventilador do radiador", modulo: "motor", did: 0x013c, valor: "01", segundos: 10,
    condicoes: [C.motor_desligado, C.em_p, C.bateria_10_5, C.ac_desligado, C.parado], ver: "A ventoinha tem de girar. Mão longe das pás." },
  { chave: "compressor", nome: "Embreagem do compressor do ar-condicionado", modulo: "motor", did: 0x014a, valor: "01", segundos: 10,
    condicoes: [C.motor_desligado, C.em_p, C.bateria_8, C.parado], ver: "Ouve-se o estalo da embreagem do compressor." },
  { chave: "ventoinha_bateria", nome: "Ventoinha da bateria de 12 V", modulo: "motor", did: 0x0163, valor: "01", segundos: 10,
    condicoes: [C.motor_desligado, C.em_p, C.bateria_8, C.parado], ver: "Só existe em alguns modelos. Se o carro não tem, o módulo recusa." },
  { chave: "purga", nome: "Solenoide de purga do canister", modulo: "motor", did: 0x0137, valor: "01", segundos: 10,
    condicoes: [C.motor_desligado, C.em_p, C.bateria_10_5, C.parado], ver: "Ouve-se ou sente-se o solenoide estalando." },
];

/**
 * Aprendizados e funções de serviço (serviço 31). `antes` é o dado lido e guardado ANTES de rodar
 * (identificador, posição do byte e quantos bytes) — a mesma disciplina da ferramenta de origem.
 */
export const APRENDIZADOS = [
  { chave: "vtc", nome: "Aprendizado do VTC (comando variável de válvulas)", modulo: "motor", rid: 0x0218, dados: "02", segundosMax: 20,
    condicoes: [C.motor_desligado, C.em_p], antes: { did: 0x266c, byte: 37, bytes: 1 },
    aviso: "Muda o valor aprendido pelo módulo do motor. Só rode se o serviço pedir (troca de atuador do comando, corrente ou módulo)." },
  { chave: "cvt_inclinacao", nome: "CVT: aprendizado do sensor de inclinação (primeira etapa)", modulo: "cvt", rid: 0x1148, dados: "", segundosMax: 15,
    condicoes: [C.motor_desligado, "Câmbio em P", "Carro em piso PLANO e nivelado", "Nenhuma falha gravada no câmbio"], antes: { did: 0x2340, byte: 29, bytes: 1 },
    aviso: "É só a PRIMEIRA etapa. A segunda etapa (rodando o carro) a ferramenta de origem não reproduz, e o app também não." },
  { chave: "manut_a", nome: "Painel: zerar o aviso de manutenção A (óleo)", modulo: "painel", rid: 0x7021, dados: "", segundosMax: 20,
    condicoes: ["Ignição ligada"], antes: { did: 0x7068, byte: 10, bytes: 2 }, aviso: "Zera a distância restante do item A." },
  ...[1, 2, 3, 4, 5].map(i => ({ chave: "manut_" + i, nome: "Painel: zerar o item de manutenção " + i, modulo: "painel", rid: 0x7021 + i, dados: "", segundosMax: 20,
    condicoes: ["Ignição ligada"], antes: { did: 0x7068, byte: 10 + 2 * i, bytes: 2 },
    // o item só é oferecido se o PRÓPRIO carro disser que tem: bit de habilitação no byte 7 do dado 7068
    habilita: { did: 0x7068, byte: 7, bit: 0x80 >> (i - 1) }, aviso: "Zera a distância restante do item " + i + "." })),
  { chave: "pastilha_entrar", nome: "Freio de estacionamento elétrico: ENTRAR no modo de troca de pastilha", modulo: "abs", rid: 0x40cf, dados: "", segundosMax: 30,
    condicoes: [C.parado, C.bateria_10, "Carro calçado: o freio de estacionamento vai SOLTAR"], antes: { did: 0x4009, byte: 15, bytes: 1 },
    aviso: "Os motores das pinças traseiras recolhem para trocar a pastilha. Só em carro com freio de estacionamento elétrico." },
  { chave: "pastilha_sair", nome: "Freio de estacionamento elétrico: SAIR do modo de troca de pastilha", modulo: "abs", rid: 0x40d0, dados: "", segundosMax: 30,
    condicoes: [C.parado, C.bateria_10, "Pastilhas e pinças montadas"], antes: { did: 0x4009, byte: 15, bytes: 1 },
    aviso: "As pinças voltam à operação normal. Rode sempre depois de entrar no modo." },
];

/** O valor guardado antes, a partir dos bytes do dado (sem o eco do identificador). null se a resposta é curta. */
export function valorAntes(a, bytes) {
  if (!a || !bytes || bytes.length < a.byte + a.bytes) return null;
  return bytes.slice(a.byte, a.byte + a.bytes).map(b => b.toString(16).toUpperCase().padStart(2, "0")).join("");
}
/** O carro diz que tem este item? true | false | null (não deu para ler). Item sem bit de habilitação é sempre oferecido. */
export function habilitado(item, bytes) {
  if (!item.habilita) return true;
  if (!bytes || bytes.length <= item.habilita.byte) return null;
  return (bytes[item.habilita.byte] & item.habilita.bit) !== 0;
}
