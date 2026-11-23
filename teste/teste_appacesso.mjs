// Quem pode fazer o quê no app do celular (js/appacesso.js), com atenção ao que AGE no carro.
// Roda em node, sem navegador: é a parte que decide, e ela precisa estar certa mesmo sem tela.
// Uso: node teste/teste_appacesso.mjs
import {
  TELAS_APP, PERMISSOES_OBD, telasDoPapel, acessoApp,
  podeApagarObd, podeAtuarObd, podeAprenderObd, podeGravarObd, podeNoObd,
} from "../js/appacesso.js";
const ok = [], falhas = [];
const chk = (n, c, extra) => (c ? ok : falhas).push(c ? n : n + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));

const adm = { id: "a1", papel: "admin", ativo: true, nome: "Danilo" };
const mec = { id: "m1", papel: "mecanico", ativo: true, nome: "Mecânico" };
const cons = { id: "c1", papel: "consultor", ativo: true, nome: "Consultor" };
const pend = { id: "p1", papel: "pendente", ativo: true, nome: "Pendente" };
const cfgCom = marcas => ({ appAcessos: { m1: { entra: true, telas: TELAS_APP.map(t => t[0]), ...marcas } } });

/* ---------------- as telas ---------------- */
chk("quinze telas no app", TELAS_APP.length === 15, TELAS_APP.length);
for (const r of ["obd", "modulos", "atuadores", "aprendizados", "bico", "parametros"])
  chk("a tela de diagnóstico está na lista: " + r, TELAS_APP.some(t => t[0] === r));
chk("toda tela tem nome escrito", TELAS_APP.every(t => t[1] && t[1].length > 3));
chk("os nomes dizem o que a tela FAZ no carro",
  TELAS_APP.find(t => t[0] === "atuadores")[1].includes("aciona")
  && TELAS_APP.find(t => t[0] === "bico")[1].includes("grava"));

/* ---------------- as permissões do que age no carro ---------------- */
chk("quatro permissões", PERMISSOES_OBD.length === 4);
chk("cada uma tem marca, nome, tela e aviso", PERMISSOES_OBD.every(p => p.length === 4 && p.every(x => x && x.length)));
chk("cada uma aponta para tela(s) que existem",
  PERMISSOES_OBD.every(([, , tela]) => (Array.isArray(tela) ? tela : [tela]).every(x => TELAS_APP.some(t => t[0] === x))));
chk("o aviso explica a consequência, não só o nome",
  PERMISSOES_OBD.every(([, , , aviso]) => aviso.length > 25));

/* ---------------- o administrador sempre pode ---------------- */
for (const [nome, f] of [["apagar", podeApagarObd], ["atuar", podeAtuarObd], ["aprender", podeAprenderObd], ["gravar", podeGravarObd]])
  chk("administrador pode " + nome + " sem nada gravado", f({}, adm));

/* ---------------- quem não é administrador só com a marca ---------------- */
chk("mecânico com todas as telas e NENHUMA marca não faz nada no carro",
  !podeApagarObd(cfgCom({}), mec) && !podeAtuarObd(cfgCom({}), mec)
  && !podeAprenderObd(cfgCom({}), mec) && !podeGravarObd(cfgCom({}), mec));
chk("com a marca de atuar, atua — e só isso",
  podeAtuarObd(cfgCom({ obd_atuar: true }), mec)
  && !podeAprenderObd(cfgCom({ obd_atuar: true }), mec)
  && !podeGravarObd(cfgCom({ obd_atuar: true }), mec)
  && !podeApagarObd(cfgCom({ obd_atuar: true }), mec));
chk("com a marca de gravar, grava — e só isso",
  podeGravarObd(cfgCom({ obd_gravar: true }), mec) && !podeAtuarObd(cfgCom({ obd_gravar: true }), mec));
chk("marca com valor que não é verdadeiro não vale",
  !podeAtuarObd({ appAcessos: { m1: { entra: true, telas: TELAS_APP.map(t => t[0]), obd_atuar: "sim" } } }, mec)
  && !podeAtuarObd({ appAcessos: { m1: { entra: true, telas: TELAS_APP.map(t => t[0]), obd_atuar: 1 } } }, mec));

/* ---------------- não existe permissão solta: sem a tela, não vale ----------------
   É a parte mais fácil de errar: marcar "pode testar atuador" e esquecer de dar a tela, ou tirar a
   tela e deixar a marca para trás. Nos dois casos a resposta tem de ser não. */
chk("marca de atuar SEM a tela de atuadores não vale",
  !podeAtuarObd({ appAcessos: { m1: { entra: true, telas: ["obd"], obd_atuar: true } } }, mec));
chk("marca de gravar SEM a tela do bico não vale",
  !podeGravarObd({ appAcessos: { m1: { entra: true, telas: ["obd", "atuadores"], obd_gravar: true } } }, mec));
chk("marca de apagar SEM nenhuma tela que apaga não vale",
  !podeApagarObd({ appAcessos: { m1: { entra: true, telas: ["parametros", "atuadores"], obd_apagar: true } } }, mec));
// o apagar vale nas DUAS telas que apagam: a leitura comum e Módulos do carro
chk("apagar vale com a tela do OBD",
  podeApagarObd({ appAcessos: { m1: { entra: true, telas: ["obd"], obd_apagar: true } } }, mec));
chk("apagar vale com a tela de Módulos (é onde apaga por módulo)",
  podeApagarObd({ appAcessos: { m1: { entra: true, telas: ["modulos"], obd_apagar: true } } }, mec));
chk("cada permissão exige uma das telas dela", PERMISSOES_OBD.every(([marca, , tela]) => {
  const quais = Array.isArray(tela) ? tela : [tela];
  return quais.every(t => podeNoObd({ appAcessos: { m1: { entra: true, telas: [t], [marca]: true } } }, mec, marca, tela))
    && !podeNoObd({ appAcessos: { m1: { entra: true, telas: ["parametros"], [marca]: true } } }, mec, marca, tela);
}));

/* ---------------- quem não entra no app não faz nada ---------------- */
chk("mecânico com entra=false não faz nada, mesmo com marca",
  !podeAtuarObd({ appAcessos: { m1: { entra: false, telas: TELAS_APP.map(t => t[0]), obd_atuar: true } } }, mec));
chk("pendente não entra nem faz", !acessoApp({}, pend).entra && !podeAtuarObd({}, pend));
chk("pessoa desativada não entra", !acessoApp({}, { ...mec, ativo: false }).entra);
chk("consultor entra por padrão mas não age no carro sem marca",
  acessoApp({}, cons).entra && !podeAtuarObd({}, cons) && !podeGravarObd({}, cons));
chk("mecânico sem nada gravado não entra", !acessoApp({}, mec).entra);

/* ---------------- as telas liberadas por padrão ---------------- */
chk("administrador e consultor têm todas as telas", telasDoPapel("admin").length === TELAS_APP.length && telasDoPapel("consultor").length === TELAS_APP.length);
chk("mecânico não ganha Agendar: o banco recusa a gravação desse papel (revisão do Codex, 23/11/2026)",
  !telasDoPapel("mecanico").includes("agendar") && telasDoPapel("mecanico").length === TELAS_APP.length - 1);
chk("administrador por padrão tem todas", acessoApp({}, adm).telas.length === TELAS_APP.length);

/* ---------------- nada explode com entrada estranha ---------------- */
chk("cfg nulo não explode", !podeAtuarObd(null, mec) && !podeAtuarObd(undefined, mec));
chk("perfil nulo não explode", !podeAtuarObd({}, null) && !acessoApp({}, null).entra);

console.log(falhas.length ? ok.length + " ok, " + falhas.length + " FALHARAM:\n  " + falhas.join("\n  ")
                          : ok.length + " conferências de quem pode o quê passaram.");
process.exit(falhas.length ? 1 : 0);
