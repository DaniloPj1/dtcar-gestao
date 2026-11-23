// A folha precisa distinguir "a comissão não foi lançada" de "não consegui ler as comissões" (v61).
// Só "a tabela não existe" (banco ainda sem o v61) vira lista vazia; todo o resto tem de estourar, senão a folha
// soma a comissão automática por cima de uma já lançada e inventa dinheiro.
// Uso: node teste/teste_comissao_erros.mjs

const { semTabelaComissao } = await import("../js/local.js");
const casos = [
  // banco sem o v61: pode tratar como "não há comissão"
  [{ message: 'relation "public.comissoes" does not exist' }, true],
  [{ message: "Could not find the table 'public.comissao_itens' in the schema cache" }, true],
  [{ code: "PGRST205", message: "qualquer coisa" }, true],
  // tudo o mais tem de estourar
  [{ message: "permission denied for table comissoes" }, false],
  [{ message: "canceling statement due to statement timeout" }, false],
  [{ message: "TypeError: Failed to fetch" }, false],
  [{ message: "JWT expired" }, false],
  [{ message: 'relation "public.ordens" does not exist' }, false],
  [null, false],
];
const falhas = [];
for (const [erro, esperado] of casos) {
  const r = semTabelaComissao(erro);
  if (r !== esperado) falhas.push(JSON.stringify(erro) + " -> " + r + " (esperado " + esperado + ")");
}
console.log("OK", casos.length - falhas.length);
console.log("FALHAS", falhas);
process.exit(falhas.length ? 1 : 0);
