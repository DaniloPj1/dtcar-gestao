/**
 * A conferência antes de valer: dizer se a leitura presta ANTES de alguém confiar nela.
 * (Etapa 1, frente 6 — a ideia do preflight da ferramenta da Honda.)
 *
 * Três perguntas, cada uma com resposta escrita:
 *  1. O adaptador é confiável?            (clone que se anuncia com versão que nunca existiu)
 *  2. O chassi lido é o do carro da O.S.? (confere contra o cadastro, não contra nada)
 *  3. Os módulos que este modelo tem responderam? Módulo CALADO é nomeado, em vez de virar uma
 *     linha ausente que ninguém percebe. Sem mapa do modelo, isso é dito — não é dado como certo.
 *
 * O resultado vai para a tela, para a sessão gravada e para o laudo: não existe leitura guardada
 * sem dizer em que condição foi feita.
 */
const soVin = t => String(t || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** situacao: "ok" | "atencao" | "ruim" | "sem-dado". */
export function conferir({ avisoAdaptador = "", versao = "", vinLido = "", chassiCadastro = "", esperados = null, varredura = null } = {}) {
  const itens = [];
  itens.push(avisoAdaptador
    ? { chave: "adaptador", situacao: "atencao", titulo: "Adaptador", texto: avisoAdaptador }
    : { chave: "adaptador", situacao: versao ? "ok" : "sem-dado", titulo: "Adaptador", texto: versao ? "Respondeu como " + versao + "." : "O adaptador não informou a versão." });

  const lido = soVin(vinLido), cad = soVin(chassiCadastro);
  if (!lido) itens.push({ chave: "chassi", situacao: "sem-dado", titulo: "Chassi", texto: "O módulo não informou o chassi" + (cad ? ": não deu para conferir com o cadastro." : ".") });
  else if (!cad) itens.push({ chave: "chassi", situacao: "sem-dado", titulo: "Chassi", texto: "Chassi lido: " + lido + ". Não há chassi no cadastro para comparar." });
  else if (lido === cad) itens.push({ chave: "chassi", situacao: "ok", titulo: "Chassi", texto: "O chassi lido é o do cadastro." });
  else itens.push({ chave: "chassi", situacao: "ruim", titulo: "Chassi", texto: "O chassi lido (" + lido + ") NÃO é o do cadastro (" + cad + "). Confira se a placa é deste carro antes de gravar qualquer coisa." });

  if (varredura) {
    const calados = [], vistos = varredura.filter(m => m.respondeu).length;
    for (const e of esperados || []) {
      const v = varredura.find(m => m.pedido === e.pedido);
      if (v && !v.respondeu) calados.push(e.nome);
    }
    if (!esperados || !esperados.length) itens.push({ chave: "modulos", situacao: "sem-dado", titulo: "Módulos", texto: vistos + " módulo(s) responderam. Não há mapa deste modelo para dizer se falta algum." });
    else if (calados.length) itens.push({ chave: "modulos", situacao: "atencao", titulo: "Módulos", calados,
      texto: "NÃO RESPONDEU: " + calados.join(", ") + ". Pode ser módulo que este carro não tem, fusível, ou ignição desligada — mas é para olhar, não para ignorar." });
    else itens.push({ chave: "modulos", situacao: "ok", titulo: "Módulos", texto: "Todos os " + esperados.length + " módulos do mapa deste modelo responderam." });
  }
  const pior = itens.some(i => i.situacao === "ruim") ? "ruim" : itens.some(i => i.situacao === "atencao") ? "atencao" : "ok";
  const frase = pior === "ruim" ? "ESTA LEITURA NÃO VALE para este carro até resolver o que está marcado."
    : pior === "atencao" ? "Leitura com ressalva: veja o que está marcado." : "Leitura em condição de valer.";
  return { situacao: pior, frase, itens, em: new Date().toISOString() };
}
