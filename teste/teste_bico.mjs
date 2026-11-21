// Programação de bico (20/11/2026): as regras do código que vem da retífica.
// A conferência que mais importa é a de digitação — é o erro que mais acontece e o que mais custa.
// Uso: node teste/teste_bico.mjs
import {
  CARACTERES_IMA, CONFUSOES, IMA_TAMANHO, IMA_VAZIO, DELPHI_TAMANHO,
  tipoDoCodigo, validarIma, paraHex, deHex, FAMILIAS, familiaDe,
  conferirConjunto, plano, conferirGravacao,
} from "../js/bico.js";
const ok = [], falhas = [];
const chk = (n, c, extra) => (c ? ok : falhas).push(c ? n : n + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));

/* ---------------- o conjunto de caracteres ----------------
   O que NÃO está nele é o ponto: 0, 9, I, J e Q ficaram fora para não confundir com O, P e 1. */
chk("tem 31 caracteres", CARACTERES_IMA.length === 31, CARACTERES_IMA.length);
for (const c of "12345678ABCDEFGHKLMNOPRSTUVWXYZ") chk("aceita " + c, CARACTERES_IMA.includes(c));
for (const c of "09IJQ") chk("NÃO aceita " + c, !CARACTERES_IMA.includes(c));
chk("o código tem 7 caracteres", IMA_TAMANHO === 7);

/* ---------------- código válido ---------------- */
for (const c of ["C2GKLL0".replace("0", "O"), "ABCDEFG", "1234567", "ZYXWVUT", "C2GKLLO"])
  chk("válido: " + c, validarIma(c).ok, validarIma(c));
chk("espaço e minúscula não reprovam", validarIma(" c2gk llo ").ok && validarIma(" c2gk llo ").codigo === "C2GKLLO");
chk("hífen digitado não reprova", validarIma("C2G-KLLO").ok);

/* ---------------- o valor de fábrica NÃO é código de bico ---------------- */
{
  const v = validarIma(IMA_VAZIO);
  chk("AAAAAAA é recusado", !v.ok, v);
  chk("e a frase explica que é o valor de fábrica", v.erro.includes("fábrica"), v.erro);
}

/* ---------------- digitação: o erro que mais acontece ---------------- */
{
  const v = validarIma("C2GKLL0");          // zero no lugar do O
  chk("zero no lugar do O é pego", !v.ok, v);
  chk("e o app diz qual é o certo", v.corrigido === "C2GKLLO", v);
  chk("e a dica manda conferir no bico", (v.dica || "").includes("bico"), v.dica);
}
{
  const v = validarIma("I234567");          // I no lugar do 1
  chk("I no lugar do 1 é pego", !v.ok && v.corrigido === "1234567", v);
}
{
  const v = validarIma("ABCDEQG");
  chk("Q é pego e vira O na sugestão", !v.ok && v.corrigido === "ABCDEOG", v);
}
chk("letra que não tem parecido não ganha palpite", validarIma("ABCDE#G").corrigido === undefined);
for (const [errado, certo] of Object.entries(CONFUSOES)) chk("parecido mapeado: " + errado + " → " + certo, CARACTERES_IMA.includes(certo));

/* ---------------- tamanho errado, e o Delphi ---------------- */
chk("curto é recusado com o tamanho na frase", validarIma("ABC").erro.includes("3"));
chk("comprido é recusado", !validarIma("ABCDEFGH").ok);
{
  const longo = "BS011KR4BAGY3926RYWZ";
  chk("20 caracteres é reconhecido como Delphi", tipoDoCodigo(longo) === "delphi" && longo.length === DELPHI_TAMANHO);
  const v = validarIma(longo);
  chk("Delphi é recusado SEM fingir conversão", !v.ok && v.tipo === "delphi", v);
  chk("e o app diz que a conversão ele não tem", v.erro.includes("ainda não tem"), v.erro);
}
chk("vazio pede o código", validarIma("").erro.includes("Digite"));
chk("nulo não explode", !validarIma(null).ok && !validarIma(undefined).ok);
chk("tipo de vazio é vazio", tipoDoCodigo("") === "vazio" && tipoDoCodigo(null) === "vazio");

/* ---------------- virar bytes, e voltar ---------------- */
chk("o código vai como texto", paraHex("ABCDEFG") === "41424344454647", paraHex("ABCDEFG"));
chk("e volta igual", deHex("41424344454647") === "ABCDEFG");
chk("ida e volta de um código de verdade", deHex(paraHex("C2GKLLO")) === "C2GKLLO");
chk("byte de enfeite no fim não entra no texto", deHex("4142434445464700") === "ABCDEFG");
chk("hex torto não explode", deHex("ZZZZ") === "" && deHex("") === "" && deHex(null) === "");
/* paraHex CONFERE antes de virar bytes. Sem isso, um código Delphi de 20 caracteres viraria 40
   bytes que o plugin nativo aceitaria gravar — risco latente para o dia em que a gravação ligar.
   Correção da revisão independente de 20/11/2026. */
chk("código inválido NÃO vira bytes", paraHex("C2GKLL0") === "" && paraHex("ABC") === "");
chk("código Delphi de 20 caracteres não vira bytes", paraHex("BS011KR4BAGY3926RYWZ") === "");
chk("AAAAAAA não vira bytes", paraHex("AAAAAAA") === "");
chk("vazio e nulo não viram bytes", paraHex("") === "" && paraHex(null) === "");
chk("código válido continua virando bytes", paraHex("C2GKLLO").length === 14);

/* ---------------- famílias: o que se sabe, e só ---------------- */
chk("EDC15C7 não codifica bico", familiaDe("EDC15C7").codifica === false);
chk("EDC16C39 codifica", familiaDe("Bosch EDC16C39").codifica === true);
chk("EDC17 codifica e pede destravar", familiaDe("3.0BTD EDC17 H21 0003").codifica === true
  && familiaDe("EDC17").nota.includes("destravar"));
chk("EDC15C7 ganha a resposta dele, não a do EDC15 genérico", familiaDe("EDC15C7").ecu === "EDC15C7");
chk("família que não está na lista devolve nada, em vez de chutar", familiaDe("Delphi DCM3.7") === null);
chk("família vazia devolve nada", familiaDe("") === null && familiaDe(null) === null);
chk("toda família tem nota escrita", FAMILIAS.every(f => f.nota && f.nota.length > 10));

/* ---------------- o conjunto do motor, antes de gravar ---------------- */
{
  const r = conferirConjunto([
    { cilindro: 1, codigo: "ABCDEFG", trocado: true },
    { cilindro: 2, codigo: "ABCDEFH", trocado: true },
  ], 4);
  chk("dois trocados e válidos: pode gravar", r.podeGravar, r.avisos);
  chk("grava só os dois marcados", r.paraGravar.length === 2);
}
{
  const r = conferirConjunto([{ cilindro: 1, codigo: "ABCDEFG", trocado: false }], 4);
  chk("nenhum marcado: NÃO grava", !r.podeGravar);
  chk("e pede para marcar quais foram trocados", r.avisos.some(a => a.t.includes("trocado")));
}
{
  // o erro clássico: copiar a linha de um cilindro para o outro
  const r = conferirConjunto([
    { cilindro: 1, codigo: "ABCDEFG", trocado: true },
    { cilindro: 3, codigo: "ABCDEFG", trocado: true },
  ], 4);
  chk("código repetido entre cilindros barra a gravação", !r.podeGravar, r.avisos);
  chk("e a frase diz que código de bico é único por peça", r.avisos.some(a => a.t.includes("único por peça")));
}
{
  const r = conferirConjunto([{ cilindro: 2, codigo: "ABCDEF0", trocado: true }], 4);
  chk("código inválido barra a gravação", !r.podeGravar);
  chk("e aponta o cilindro", r.avisos.some(a => a.cilindro === 2));
}
{
  const r = conferirConjunto([
    { cilindro: 1, codigo: "ABCDEFG", trocado: true },
    { cilindro: 2, codigo: "ABCDEFH", trocado: false },
  ], 4);
  chk("o não trocado é avisado, mas não impede", r.podeGravar
    && r.avisos.some(a => !a.grave && a.t.includes("não estão marcados")), r.avisos);
}
chk("lista vazia não explode", !conferirConjunto([], 4).podeGravar && !conferirConjunto(null, 4).podeGravar);

/* ---------------- o plano, que o mecânico vê antes de autorizar ---------------- */
{
  const p = plano({ cilindros: [{ cilindro: 1, codigo: "ABCDEFG" }], temChave: true });
  chk("o plano começa abrindo a sessão", p[0].o === "sessao");
  chk("lê o que está gravado ANTES de gravar", p.findIndex(x => x.o === "ler") < p.findIndex(x => x.o === "gravar"));
  chk("confere lendo de volta DEPOIS de gravar", p.findIndex(x => x.o === "conferir") > p.findIndex(x => x.o === "gravar"));
  chk("reinicia o módulo para o valor valer", p.some(x => x.o === "reiniciar"));
  chk("e termina lendo as falhas", p[p.length - 1].o === "falhas");
  chk("com chave, nenhum passo é trava", !p.some(x => x.trava));
}
{
  const p = plano({ cilindros: [{ cilindro: 1, codigo: "ABCDEFG" }], temChave: false });
  const d = p.find(x => x.o === "destravar");
  chk("sem chave, o destravar é marcado como trava", d.trava === true, d);
  chk("e o texto diz onde para", d.t.includes("pode parar"), d.t);
}

/* ---------------- a conferência de volta ---------------- */
chk("gravou igual: conferido", conferirGravacao("ABCDEFG", paraHex("ABCDEFG")).ok);
{
  const r = conferirGravacao("ABCDEFG", paraHex("ABCDEFH"));
  chk("gravou diferente: reprova", !r.ok, r);
  chk("e manda NÃO rodar o motor", r.t.includes("NÃO rode o motor"), r.t);
}
chk("módulo que não devolve valor reprova", !conferirGravacao("ABCDEFG", "").ok);

console.log(falhas.length ? ok.length + " ok, " + falhas.length + " FALHARAM:\n  " + falhas.join("\n  ")
                          : ok.length + " conferências da programação de bico passaram.");
process.exit(falhas.length ? 1 : 0);
