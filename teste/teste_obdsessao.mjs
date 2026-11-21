// A conexão compartilhada do diagnóstico (20/11/2026): js/obdsessao.js, sem celular e sem carro.
// O que importa aqui é o que o ELM327 obriga: um pedido por vez, e a leitura de fundo parando antes
// de qualquer comando que aja no carro.
// Uso: node teste/teste_obdsessao.mjs
import * as sessao from "../js/obdsessao.js";
const ok = [], falhas = [];
const chk = (n, c, extra) => (c ? ok : falhas).push(c ? n : n + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
const espera = ms => new Promise(f => setTimeout(f, ms));

/* ---------------- a família de telas ---------------- */
chk("a família tem as seis telas do diagnóstico", sessao.FAMILIA.length === 6);
for (const r of ["obd", "modulos", "atuadores", "aprendizados", "bico", "parametros"])
  chk("na família: " + r, sessao.naFamilia(r));
for (const r of ["inicio", "oleo", "orcamento", "servico"])
  chk("fora da família: " + r, !sessao.naFamilia(r));

/* ---------------- assinar: a tela recebe o estado ---------------- */
sessao.reiniciarParaTeste();
{
  let recebido = 0, ultimo = null;
  const cancelar = sessao.assinar(st => { recebido++; ultimo = st; });
  chk("assinar entrega o estado na hora", recebido === 1 && ultimo !== null);
  chk("começa desligado e sem módulo", ultimo.ligado === false && ultimo.modulo === null && ultimo.dono === "");
  cancelar();
}

/* ---------------- a vez de conversar: um pedido por vez ----------------
   O ELM327 não atende dois pedidos. Quem não conseguiu a vez é recusado COM MOTIVO, em vez de
   ficar esperando sem explicação — no celular, comando pendurado é pior que comando recusado. */
sessao.reiniciarParaTeste();
{
  let soltar;
  const presa = new Promise(f => { soltar = f; });
  const primeira = sessao.tomar("a leitura", () => presa);
  await espera(10);
  chk("quem pegou a vez aparece no estado", sessao.estado().dono === "a leitura", sessao.estado().dono);
  const segunda = await sessao.tomar("o atuador", async () => "não devia rodar");
  chk("a segunda é recusada na hora", segunda.ok === false, segunda);
  chk("e diz quem está com o adaptador", (segunda.texto || "").includes("a leitura"), segunda.texto);
  chk("e diz o nome de quem ocupa", segunda.ocupado === "a leitura");
  soltar("pronto");
  const r1 = await primeira;
  chk("a primeira termina normal", r1.ok === true && r1.r === "pronto", r1);
  chk("e a vez fica livre depois", sessao.estado().dono === "");
}

/* ---------------- a mesma dona pode continuar ---------------- */
sessao.reiniciarParaTeste();
{
  let soltar; const presa = new Promise(f => { soltar = f; });
  const a = sessao.tomar("a leitura", () => presa);
  await espera(10);
  const b = await sessao.tomar("a leitura", async () => "segunda vez");
  chk("duas tarefas com o MESMO nome não correm juntas: a segunda é recusada (revisão do Codex)", b.ok === false && b.ocupado === "a leitura", b);
  soltar("fim"); await a;
}

/* ---------------- erro dentro da tarefa não deixa a vez travada ---------------- */
sessao.reiniciarParaTeste();
{
  const r = await sessao.tomar("a gravação", async () => { throw new Error("falhou"); });
  chk("tarefa que estoura devolve recusa, não explode", r.ok === false, r);
  chk("e a vez é liberada mesmo com erro", sessao.estado().dono === "");
  const depois = await sessao.tomar("o atuador", async () => "consegui");
  chk("o próximo consegue a vez", depois.ok === true, depois);
}

/* ---------------- conexão caída vira ESTADO, não só mensagem ----------------
   Sem isto a tela continuaria mostrando "conectado" depois de o adaptador cair. */
sessao.reiniciarParaTeste();
{
  const r = await sessao.tomar("a leitura", async () => { throw new Error("conexao-caiu"); });
  chk("conexão caída é recusa", r.ok === false);
  chk("e o estado passa a desligado", sessao.estado().ligado === false && !!sessao.estado().erro, sessao.estado());
}

/* ---------------- a leitura de fundo para antes do comando que age ----------------
   É a lição do projeto aberto do MG elétrico: comando de acionamento no meio da roda de leitura
   volta trocado, porque o adaptador atende um por vez. */
sessao.reiniciarParaTeste();
{
  const log = [];
  const cancelar = sessao.registrarLeituraDeFundo(() => log.push("parou"), () => log.push("voltou"));
  const r = await sessao.tomar("o atuador", async () => { log.push("comandou"); return 1; }, { pausaFundo: true });
  chk("com pausaFundo, a ordem é parar, comandar e voltar",
    log.join(">") === "parou>comandou>voltou", log);
  chk("e a tarefa roda normal", r.ok === true);
  log.length = 0;
  await sessao.tomar("a leitura", async () => { log.push("leu"); return 1; });
  chk("sem pausaFundo, a leitura de fundo não é mexida", log.join(">") === "leu", log);
  log.length = 0;
  await sessao.tomar("o atuador", async () => { throw new Error("falhou"); }, { pausaFundo: true });
  chk("a leitura de fundo VOLTA mesmo quando o comando falha", log.includes("voltou"), log);
  cancelar();
  log.length = 0;
  await sessao.tomar("o atuador", async () => 1, { pausaFundo: true });
  chk("depois de cancelar o registro, não há mais o que parar", log.length === 0, log);
}

/* ---------------- pararTudo: usado ao desligar ---------------- */
sessao.reiniciarParaTeste();
{
  const log = [];
  sessao.registrarLeituraDeFundo(() => log.push("parou"), () => log.push("voltou"));
  sessao.pararTudo();
  chk("pararTudo para a roda e não a retoma", log.join(">") === "parou", log);
}

/* ---------------- sair da tela não desliga na hora ----------------
   Trocar entre duas telas de diagnóstico desmonta a primeira antes de montar a segunda. Um
   desligamento imediato cortaria a conexão no meio da troca — e era exatamente o defeito antigo. */
sessao.reiniciarParaTeste();
{
  const cancelar = sessao.assinar(() => {});
  sessao.saindoDaTela();
  sessao.entrandoNaTela();        // a tela seguinte assumiu: o desligamento é cancelado
  await espera(500);
  chk("a tela seguinte cancela o desligamento", sessao.estado().ligado === false);  // segue desligado porque nunca ligou
  chk("e ninguém explodiu no caminho", true);
  cancelar();
}

console.log(falhas.length ? ok.length + " ok, " + falhas.length + " FALHARAM:\n  " + falhas.join("\n  ")
                          : ok.length + " conferências da conexão compartilhada passaram.");
process.exit(falhas.length ? 1 : 0);
