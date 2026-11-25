/**
 * O MAPA DA REDE CAN: cruza a varredura (quem respondeu) com os códigos de rede (U) que os módulos
 * gravaram, e diz com quanta certeza dá para afirmar que um módulo saiu da rede.
 *
 * Por que cruzar: a varredura sozinha não prova nada — módulo que não responde pode simplesmente não
 * existir nesta versão do carro, estar atrás do gateway ou dormindo. O código U é o próprio carro
 * dizendo que perdeu de vista um companheiro. Os dois juntos é que viram diagnóstico.
 *
 * O QUE ESTE ARQUIVO NÃO FAZ: dizer QUAL endereço um código U aponta. "U0151" significa "perdi o
 * módulo de restrição", e qual endereço é esse muda de marca para marca. Sem tabela por marca, o app
 * aponta os CANDIDATOS (quem está calado) em vez de afirmar. Afirmar errado aqui manda o mecânico
 * abrir chicote no lugar errado.
 *
 * Sem window nem document: dá para testar sem navegador.
 */

/** Código de rede: o grupo U da norma SAE J2012 (comunicação entre módulos). */
export const eCodigoDeRede = c => /^U[0-3][0-9A-F]{3}$/i.test(String(c || "").trim().toUpperCase());
const soCodigo = c => String(c || "").toUpperCase().trim().split(/[-:\s]/)[0];
/** Sem acento, para a comparação não depender de como o texto foi escrito. */
const semAcento = t => String(t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
/** Código que o módulo tem AGORA (não é histórico/intermitente). */
const eAtual = f => !/histor|intermit|passad|antig/.test(semAcento((f && (f.situacao || f.situacaoTexto)) || ""));

/** Separa a varredura em quem respondeu, quem recusou e quem ficou mudo. */
export function separar(lista) {
  const l = lista || [];
  return {
    responderam: l.filter(m => m.respondeu && !m.recusou),
    recusaram: l.filter(m => m.respondeu && m.recusou),
    mudos: l.filter(m => !m.respondeu),
  };
}

/** Os códigos de rede que os módulos entregaram, com o módulo que gravou cada um. */
export function codigosDeRede(lista) {
  const out = [];
  for (const m of lista || []) {
    for (const f of m.falhas || []) {
      const c = soCodigo(f.codigo || f.rotulo);
      if (!eCodigoDeRede(c)) continue;
      out.push({ codigo: c, rotulo: f.rotulo || c, modulo: m.nome || m.pedido, pedido: m.pedido,
        atual: eAtual(f), situacao: f.situacaoTexto || f.situacao || "" });
    }
  }
  return out;
}

/**
 * O veredito. Devolve { situacao, titulo, texto } por grau de certeza, do mais firme ao mais fraco:
 *  confirmado   — alguém está calado E algum módulo gravou código de rede ATUAL;
 *  contradicao  — tem código de rede, mas ninguém do mapa deste modelo está calado;
 *  indicio      — tem calado, e nenhum módulo reclamou de ninguém;
 *  limpo        — ninguém calado e nenhum código de rede.
 * `doMapa` separa o que o mapa do modelo esperava do que é só endereço da norma: módulo que o mapa
 * esperava e não respondeu pesa; endereço da norma que não respondeu quase sempre não existe.
 */
export function cruzar(lista) {
  const { responderam, recusaram, mudos } = separar(lista);
  const codigos = codigosDeRede(lista);
  const atuais = codigos.filter(c => c.atual);
  const mudosDoMapa = mudos.filter(m => m.doMapa);
  const nomesMudos = mudosDoMapa.map(m => m.nome || m.pedido);
  const vereditos = [];

  if (atuais.length && mudosDoMapa.length) {
    const quem = mudosDoMapa.length === 1
      ? "O " + nomesMudos[0] + " está fora da rede."
      : "Há " + mudosDoMapa.length + " módulos fora da rede: " + nomesMudos.join(", ") + ".";
    vereditos.push({ chave: "confirmado", situacao: "ruim", titulo: "CONFIRMADO", nota: "os dois lados batem",
      texto: quem + " Não respondeu na varredura e " + (atuais.length === 1 ? "o " + atuais[0].modulo + " gravou " + atuais[0].codigo
        : atuais.length + " módulos gravaram código de rede") + ", dizendo que perdeu companheiro. Procure alimentação, massa e o chicote até " +
        (mudosDoMapa.length === 1 ? "ele" : "eles") + "." });
  } else if (atuais.length) {
    vereditos.push({ chave: "contradicao", situacao: "atencao", titulo: "CONTRADIÇÃO", nota: "vale conferir",
      texto: "Há código de rede gravado (" + atuais.map(c => c.codigo).join(", ") + "), mas todo módulo do mapa deste modelo respondeu. " +
        "Pode ser código que ficou de um defeito já resolvido, ou módulo que falta no mapa — veja se algum endereço respondeu sem nome." });
  } else if (mudosDoMapa.length) {
    vereditos.push({ chave: "indicio", situacao: "mudo", titulo: "SÓ INDÍCIO", nota: "não dá para afirmar",
      texto: (mudosDoMapa.length === 1 ? "O " + nomesMudos[0] + " não respondeu" : nomesMudos.join(", ") + " não responderam") +
        ", e nenhum módulo reclamou de companheiro perdido. Pode não existir nesta versão, estar atrás do gateway ou dormindo. Não é defeito por isso." });
  } else {
    vereditos.push({ chave: "limpo", situacao: "certo", titulo: "REDE EM ORDEM", nota: "nada a apontar",
      texto: "Todo módulo esperado respondeu e nenhum deles gravou código de rede." });
  }

  // Os históricos entram como observação separada: não sustentam veredito, mas não se joga fora.
  const historicos = codigos.filter(c => !c.atual);
  if (historicos.length) {
    vereditos.push({ chave: "historico", situacao: "mudo", titulo: "HISTÓRICO", nota: "já aconteceu",
      texto: historicos.map(c => c.codigo + " no " + c.modulo).join("; ") + ". Código que o módulo guardou de uma perda que não está acontecendo agora." });
  }
  // Quem recusou entregar as falhas existe e está vivo: isso é informação, não falta de resposta.
  if (recusaram.length) {
    vereditos.push({ chave: "recusou", situacao: "atencao", titulo: "RECUSOU", nota: "existe, e está vivo",
      texto: recusaram.map(m => (m.nome || m.pedido) + (m.erro ? " — " + m.erro : "")).join("; ") +
        ". Respondeu à rede mas não entregou as falhas: pede senha, ou não aceita com o carro parado." });
  }
  return { vereditos, codigos, responderam, recusaram, mudos, mudosDoMapa };
}
