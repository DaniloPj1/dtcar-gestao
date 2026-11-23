/**
 * Programação de bico — o código que vem da retífica entrando na ECU.
 *
 * O PROBLEMA, do jeito que ele aparece na oficina: o bico volta recodificado, com um código novo
 * gravado no corpo dele. Esse código tem de entrar na ECU, senão o módulo continua corrigindo pelo
 * bico velho. Bico trocado e não codificado fica com a correção no valor padrão, e isso descasa a
 * referência dos outros cilindros — o motor trabalha, mas trabalha errado.
 *
 * O QUE O CÓDIGO É: a ECU guarda, por cilindro, uma correção que faz AQUELE bico se comportar como
 * se fosse uma peça média perfeita. A correção mexe na vazão e no ponto, em todo o mapa de
 * trabalho, não só na marcha lenta. É por isso que o valor não é "aproximado": ou é o do bico, ou
 * está errado.
 *
 * O QUE ESTE ARQUIVO TEM: as regras do CÓDIGO — formato, conjunto de caracteres, o que é válido e
 * o que não é, e como ele vira bytes para a gravação. É a parte que vale para qualquer carro e que
 * dá para conferir sem o carro na frente.
 *
 * O QUE ELE NÃO TEM, de propósito: o identificador (DID) de cada cilindro em cada família de ECU.
 * Isso muda de família para família e não existe tabela pública confiável; chutar seria gravar no
 * lugar errado. O número sai do acervo do projeto, do container de diagnóstico da família ou da
 * descoberta pela própria ECU — e, enquanto não houver, a tela diz que não tem, em vez de tentar.
 *
 * A TRAVA QUE SOBRA: a gravação em si é o serviço 0x2E e está pronta. Quase toda ECU exige
 * destravar antes (0x27), e a conta da chave depende da família. Onde ela não existe, o app vai
 * até a porta e para na porta — e diz isso com clareza.
 */

/**
 * Os caracteres que um código IMA aceita, e SÓ eles.
 *
 * Esta é a conferência mais útil do arquivo, porque pega o erro mais comum de todos: digitação.
 * Repare no que NÃO está aqui — 0, 9, I, J e Q. O conjunto foi escolhido assim justamente para não
 * haver confusão entre 0 e O, entre 1 e I, entre 9 e g. Então "0" num código é sempre a letra O
 * lida errado, e "I" é sempre o número 1: o app avisa em vez de gravar o que foi digitado.
 */
export const CARACTERES_IMA = "12345678ABCDEFGHKLMNOPRSTUVWXYZ";
/** Os parecidos, para o aviso dizer o que a pessoa provavelmente quis escrever. */
export const CONFUSOES = { "0": "O", "9": "P", "I": "1", "J": "1", "Q": "O" };

export const IMA_TAMANHO = 7;          // Bosch: 7 caracteres gravados a laser no corpo do bico
export const DELPHI_TAMANHO = 20;      // Delphi: código longo, que precisa de conversão antes
/** Código todo em A é o valor de fábrica "sem correção": não é código de bico nenhum. */
export const IMA_VAZIO = "AAAAAAA";

const limpar = c => String(c == null ? "" : c).toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * Diz de que tipo é o código, pelo TAMANHO — que é o que separa os dois na prática.
 * Curto (7) é o IMA da Bosch, que entra direto. Longo (20) é o da Delphi, que precisa ser
 * convertido antes de a ECU aceitar.
 */
export function tipoDoCodigo(cru) {
  const c = limpar(cru);
  if (!c) return "vazio";
  if (c.length === IMA_TAMANHO) return "ima";
  if (c.length === DELPHI_TAMANHO) return "delphi";
  if (c.length >= 8 && c.length <= 12) return "longo-bosch";
  return "desconhecido";
}

/**
 * Confere um código IMA e devolve { ok, codigo, erro, dica }.
 * Quando dá para saber o que a pessoa quis escrever, a dica já traz o código corrigido — mas a
 * correção NÃO é aplicada sozinha: quem confirma é o mecânico, olhando o bico.
 */
export function validarIma(cru) {
  const c = limpar(cru);
  if (!c) return { ok: false, codigo: "", erro: "Digite o código que está no bico." };
  if (c === IMA_VAZIO) {
    return { ok: false, codigo: c, erro: "Esse é o valor de fábrica, sem correção — não é o código de um bico. Confira o que está gravado na peça." };
  }
  if (c.length !== IMA_TAMANHO) {
    const t = tipoDoCodigo(c);
    if (t === "delphi") {
      return { ok: false, codigo: c, tipo: "delphi",
        erro: "Esse é um código Delphi, de 20 caracteres. Ele precisa ser convertido antes de a ECU aceitar, e essa conversão o app ainda não tem." };
    }
    return { ok: false, codigo: c,
      erro: "O código IMA tem " + IMA_TAMANHO + " caracteres, e esse tem " + c.length + "." };
  }
  const fora = [...c].filter(x => !CARACTERES_IMA.includes(x));
  if (fora.length) {
    const unicos = [...new Set(fora)];
    const trocas = unicos.filter(x => CONFUSOES[x]);
    let dica = "";
    if (trocas.length === unicos.length) {
      const corrigido = [...c].map(x => CONFUSOES[x] || x).join("");
      dica = "Pelo parecido, deve ser " + corrigido + ". Confira no bico.";
      return { ok: false, codigo: c, corrigido, dica,
        erro: "O código IMA não usa " + unicos.join(", ") + ". " + unicos.map(x => x + " é " + CONFUSOES[x]).join("; ") + "." };
    }
    return { ok: false, codigo: c, erro: "O código IMA não usa " + unicos.join(", ") + "." };
  }
  return { ok: true, codigo: c, tipo: "ima", erro: "" };
}

/**
 * O código vira bytes para a gravação: cada caractere é uma letra, e vai como texto.
 * (É assim que o campo aparece na adaptação: sete posições de texto.)
 */
export function paraHex(codigo) {
  // CONFERE antes de virar bytes. Sem isto, um código Delphi de 20 caracteres (ou qualquer coisa
  // digitada) viraria 40 bytes que o plugin nativo aceitaria gravar. Enquanto a gravação não está
  // ligada o risco é latente, mas é justamente o tipo de coisa que passa batido quando a etapa
  // seguinte liga o botão. Achado da revisão independente de 20/11/2026.
  const v = validarIma(codigo);
  if (!v.ok) return "";
  return [...v.codigo].map(c => c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")).join("");
}
/** O caminho de volta, para mostrar o que já está gravado na ECU. */
export function deHex(hex) {
  const h = String(hex || "").replace(/[^0-9A-Fa-f]/g, "");
  let s = "";
  for (let i = 0; i + 1 < h.length; i += 2) {
    const n = parseInt(h.substr(i, 2), 16);
    if (n >= 0x20 && n < 0x7f) s += String.fromCharCode(n);
  }
  return s.trim().toUpperCase();
}

/**
 * Famílias de ECU e o que se sabe sobre codificação de bico em cada uma.
 *
 * Só entra aqui o que a pesquisa trouxe escrito, com a fonte. O que não se sabe fica como não
 * sabido: numa oficina, "não sei" é informação, e "talvez" gravado na ECU é prejuízo.
 */
export const FAMILIAS = [
  { ecu: "EDC15C7", codifica: false, nota: "Esta geração não usa codificação de bico." },
  { ecu: "EDC16C39", codifica: true, formato: "ima", nota: "Cada bico tem um número de calibração próprio, de 7 caracteres." },
  { ecu: "EDC17", codifica: true, formato: "ima", nota: "Pede destravar o módulo antes da adaptação." },
];
export const familiaDe = nome => {
  const n = String(nome || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!n) return null;
  // do mais específico para o mais geral: EDC16C39 antes de EDC16, EDC17 depois
  return FAMILIAS.slice().sort((a, b) => b.ecu.length - a.ecu.length).find(f => n.includes(f.ecu)) || null;
};

/**
 * Confere o conjunto de códigos de um motor antes de gravar qualquer um.
 *
 * Duas regras que vêm da prática e que são fáceis de passar batido:
 *  1. SÓ se mexe no cilindro cujo bico foi trocado. Regravar um cilindro que não foi trocado é
 *     substituir a correção certa por outra — o app não deixa isso acontecer por descuido.
 *  2. Dois cilindros com o MESMO código quase sempre é cópia errada de uma linha para a outra.
 *     Código de bico é único por peça; repetido é erro de digitação até prova em contrário.
 */
export function conferirConjunto(itens, cilindros) {
  const avisos = [];
  const lista = (itens || []).filter(i => i && limpar(i.codigo));
  const paraGravar = lista.filter(i => i.trocado);
  if (!paraGravar.length) avisos.push({ grave: true, t: "Marque quais cilindros tiveram o bico trocado. Só esses são gravados." });
  for (const i of lista) {
    const v = validarIma(i.codigo);
    if (!v.ok) avisos.push({ grave: true, cilindro: i.cilindro, t: "Cilindro " + i.cilindro + ": " + v.erro + (v.dica ? " " + v.dica : "") });
  }
  const vistos = new Map();
  for (const i of paraGravar) {
    const c = limpar(i.codigo);
    if (vistos.has(c)) avisos.push({ grave: true, t: "Cilindros " + vistos.get(c) + " e " + i.cilindro + " estão com o mesmo código. Código de bico é único por peça — confira as duas peças." });
    else vistos.set(c, i.cilindro);
  }
  const naoTrocados = lista.filter(i => !i.trocado && limpar(i.codigo));
  if (naoTrocados.length) {
    avisos.push({ grave: false, t: "Os cilindros " + naoTrocados.map(i => i.cilindro).join(", ") + " não estão marcados como trocados: o código deles fica como está, e não será gravado." });
  }
  if (cilindros && paraGravar.length === cilindros) {
    avisos.push({ grave: false, t: "Todos os " + cilindros + " cilindros serão gravados. Se não foram todos os bicos que foram trocados, desmarque os que ficaram." });
  }
  return { avisos, paraGravar, podeGravar: paraGravar.length > 0 && !avisos.some(a => a.grave) };
}

/**
 * O caminho da gravação, em passos, para a tela mostrar antes de começar.
 * Nada aqui roda: é o plano. Ele existe porque o mecânico tem direito de ver o que vai acontecer
 * no carro dele antes de autorizar — e porque cada passo pode falhar por um motivo diferente.
 */
export function plano({ cilindros = [], temChave = false, reiniciar = true } = {}) {
  const p = [
    { o: "sessao", t: "Abrir a sessão de diagnóstico no módulo do motor." },
    { o: "ler", t: "Ler o que está gravado hoje em cada cilindro, e guardar." },
  ];
  p.push(temChave
    ? { o: "destravar", t: "Destravar a adaptação do módulo." }
    : { o: "destravar", t: "Destravar a adaptação do módulo — e aqui é onde pode parar: a conta da chave desta família o app não tem.", trava: true });
  for (const c of cilindros) p.push({ o: "gravar", cilindro: c.cilindro, t: "Gravar o código do cilindro " + c.cilindro + ": " + limpar(c.codigo) + "." });
  p.push({ o: "conferir", t: "Ler de volta e conferir se o que ficou gravado é o que foi digitado." });
  if (reiniciar) p.push({ o: "reiniciar", t: "Reiniciar o módulo para o valor passar a valer." });
  p.push({ o: "falhas", t: "Ler as falhas do módulo: gravação certa não deixa código novo." });
  return p;
}

/** Compara o que foi digitado com o que a ECU devolveu na leitura de volta. */
export function conferirGravacao(digitado, lido) {
  const d = limpar(digitado), l = limpar(deHex(lido) || lido);
  if (!l) return { ok: false, t: "O módulo não devolveu o valor para conferir." };
  if (d === l) return { ok: true, t: "Conferido: ficou " + l + "." };
  return { ok: false, t: "O módulo ficou com " + l + ", e foi digitado " + d + ". NÃO rode o motor: grave de novo." };
}
