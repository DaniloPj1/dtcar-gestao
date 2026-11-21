// UDS (ISO 14229) pelo ELM327 (20/11/2026): a parte do js/uds.js que decide, sem carro e sem celular.
// O que importa aqui é o RACIOCÍNIO: como a recusa do módulo é lida, o que prova e o que não prova.
// Uso: node teste/teste_uds.mjs
import {
  NRC, textoNrc, nomeNrc, negativaDe, respostaDe, falhasDe, vereditoDaSonda, escalaDe, TIPOS_ESCALA,
  FAIXAS_RID, faixaRid, ridDeServico, RID_DE, RID_ATE, SESSAO, SV, ATUAR, ROTINA, hex2, hex4,
  textoTipoFalha, codigoCom, situacaoDe, resumoSituacao, falhaPronta,
  EPTI, sistemasEpti, nomeSistemaEpti, didsEpti, nomeDidEpti, eptiTemAnexoCD,
  listaDe16, decidirRotinaAtuador,
  ENDERECOS_PADRAO, familias, modulosDa, quantosModulos, versaoAcervo,
} from "../js/uds.js";
const ok = [], falhas = [];
const chk = (n, c, extra) => (c ? ok : falhas).push(c ? n : n + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));

/* ---------------- resposta negativa ---------------- */
chk("negativa do 0x31 é reconhecida", negativaDe("7F3122", 0x31) === 0x22);
chk("negativa de OUTRO serviço não é confundida", negativaDe("7F2231", 0x31) === null);
chk("negativa sem o serviço pedido ainda é lida", negativaDe("7F3133") === 0x33);
chk("resposta boa não é lida como negativa", negativaDe("710131", 0x31) === null);
chk("resposta curta não explode", negativaDe("7F", 0x31) === null && negativaDe("", 0x31) === null);

/* ---------------- a tabela que vira instrução para o mecânico ----------------
   Metade do valor do UDS na oficina: o módulo não diz só "não", diz por quê. */
chk("0x22 é condição, não ausência", textoNrc(0x22).includes("condições") && nomeNrc(0x22) === "conditionsNotCorrect");
chk("0x33 é proteção, não ausência", textoNrc(0x33).includes("destravar") && nomeNrc(0x33) === "securityAccessDenied");
chk("0x31 é o 'não conheço'", nomeNrc(0x31) === "requestOutOfRange");
chk("0x78 é 'estou trabalhando', e a frase não assusta", textoNrc(0x78).includes("resposta vem"));
for (const [n, pedaco] of [[0x83, "Desligue o motor"], [0x84, "Ligue o motor"], [0x87, "Aqueça"],
                           [0x8c, "neutro"], [0x8f, "freio"], [0x90, "em P"], [0x93, "bateria"]])
  chk("recusa vira instrução: " + hex2(n) + " → " + pedaco, textoNrc(n).includes(pedaco), textoNrc(n));
chk("código que a norma não lista ainda dá frase com o número", textoNrc(0x5a).includes("5A"));
chk("toda entrada tem nome técnico e frase", Object.values(NRC).every(v => v.length === 2 && v[0] && v[1]));

/* ---------------- faixas de rotina da ISO 14229-1 ---------------- */
chk("a faixa de procura é a do fabricante", RID_DE === 0x0200 && RID_ATE === 0xdfff);
for (const r of [0x0200, 0x1234, 0xa001, 0xad6e, 0xdfff]) chk("procura em " + hex4(r), ridDeServico(r));
for (const r of [0x0000, 0x00ff, 0x0100, 0x01ff, 0xe000, 0xe200, 0xff00, 0xffff]) chk("NÃO procura em " + hex4(r), !ridDeServico(r));
chk("apagar memória (FF00) cai na faixa de programação", faixaRid(0xff00).nome.includes("programação"));
chk("tacógrafo é faixa própria", faixaRid(0x0150).nome === "tacógrafo");
chk("só uma faixa é de procurar", FAIXAS_RID.filter(f => f.procurar).length === 1);
chk("as faixas cobrem tudo sem buraco", (() => {
  let p = 0x0000;
  for (const f of FAIXAS_RID) { if (f.de !== p) return false; p = f.ate + 1; }
  return p === 0x10000;
})(), FAIXAS_RID.map(f => hex4(f.de) + "-" + hex4(f.ate)));

/* ---------------- o veredito da sondagem: o que cada recusa PROVA ---------------- */
{
  const neg = (nrc) => ({ dados: null, nrc, texto: textoNrc(nrc), erro: "" });
  chk("respondeu o resultado → existe",
    vereditoDaSonda({ dados: [3, 0, 1], nrc: null, erro: "" }).existe === true);
  chk("0x22 → EXISTE, só falta condição",
    vereditoDaSonda(neg(0x22)).existe === true && vereditoDaSonda(neg(0x22)).motivo === "falta-condicao");
  chk("0x33 → EXISTE, protegida",
    vereditoDaSonda(neg(0x33)).existe === true && vereditoDaSonda(neg(0x33)).motivo === "protegida");
  chk("0x7E → EXISTE, pede outra sessão", vereditoDaSonda(neg(0x7e)).existe === true);
  chk("0x12 → EXISTE, outra opção", vereditoDaSonda(neg(0x12)).existe === true);
  // o ponto mais fácil de errar: 0x31 só prova ausência NA SESSÃO DE DIAGNÓSTICO
  chk("0x31 na sessão de diagnóstico → não existe",
    vereditoDaSonda(neg(0x31), SESSAO.estendida).existe === false);
  chk("0x31 na sessão comum → NÃO prova nada (fica em talvez)",
    vereditoDaSonda(neg(0x31), SESSAO.comum).existe === null);
  chk("e a frase na sessão comum manda abrir a sessão de diagnóstico",
    vereditoDaSonda(neg(0x31), SESSAO.comum).texto.includes("sessão de diagnóstico"));
  chk("sem resposta não vira 'não existe'",
    vereditoDaSonda({ erro: "conexao-caiu", texto: "caiu" }).existe === null);
  chk("recusa que a norma não lista fica em talvez, não em não",
    vereditoDaSonda(neg(0x10)).existe === null);
  chk("rotina fora da faixa nem é perguntada ao carro", !ridDeServico(0xff00));
}

/* ---------------- falhas por módulo (0x19 02): QUATRO bytes, não dois ---------------- */
{
  // A resposta é: eco da subfunção (02), máscara de disponibilidade (FF) e QUATRO bytes por falha.
  // Os dois primeiros bytes são descartados — esquecer o eco desloca tudo em um byte e o aparelho
  // passa a mostrar códigos que NÃO EXISTEM no carro, sem dar erro nenhum. Foi exatamente o que o
  // teste do navegador pegou em 20/11/2026, com o teste de unidade passando por repetir o engano.
  const f = falhasDe([0x02, 0xff, 0x01, 0x71, 0x2b, 0x2f, 0xc0, 0x21, 0x08, 0xa7]);
  chk("duas falhas lidas", f.length === 2, f);
  chk("o código sai no jeito da oficina", f[0].codigo === "P0171", f[0]);
  chk("o TIPO DE FALHA é guardado", f[0].tipoFalha === 0x2b, f[0]);
  chk("a situação é guardada", f[0].situacao === 0x2f, f[0]);
  chk("o segundo código é da família U", f[1].codigo.startsWith("U"), f[1]);
  // a armadilha: um byte a mais ou a menos não pode virar código inventado
  chk("o eco da subfunção NÃO entra no código", f[0].codigo !== "U3F01" && !f.some(x => x.codigo === "U3F01"), f);
  chk("sobra de bytes não vira falha inventada", falhasDe([0x02, 0xff, 0x01, 0x71, 0x2b]).length === 0);
  chk("módulo sem falha devolve lista vazia", falhasDe([0x02, 0xff]).length === 0);
  chk("dado vazio não explode", falhasDe([]).length === 0 && falhasDe(null).length === 0 && falhasDe([0x02]).length === 0);
}

/* ---------------- escala pelo próprio módulo (0x24) ----------------
   Achado de 20/11/2026: em vez de adivinhar como desmontar o valor, o módulo informa. */
{
  const e = escalaDe([0xf1, 0x90, 0x51]);   // texto, 1 byte... 0x51 = tipo 5 (texto), tamanho 1
  chk("tipo e tamanho saem do mesmo byte", e[0].tipo === 0x5 && e[0].tamanho === 1, e);
  chk("o tipo vira nome", e[0].nomeTipo === "texto", e);
  chk("número com sinal é reconhecido", escalaDe([0, 0, 0x12])[0].nomeTipo === "número com sinal");
  chk("vários bytes de escala viram vários itens", escalaDe([0, 0, 0x02, 0x51]).length === 2);
  chk("tipo fora da tabela não finge nome", escalaDe([0, 0, 0xd1])[0].nomeTipo === "desconhecido");
  chk("a tabela de tipos é a da norma", TIPOS_ESCALA[0x0] === "número sem sinal" && TIPOS_ESCALA[0x5] === "texto");
  // Tipos 9 (estendido), A (fórmula) e B (unidade) são seguidos de bytes de EXTENSÃO, e a
  // quantidade vem no nibble de baixo. Tratar extensão como escala inventava item na tela quando o
  // módulo usa fórmula — correção da revisão independente de 20/11/2026.
  {
    const e = escalaDe([0xf1, 0x90, 0xa2, 0x11, 0x22, 0x51]);
    chk("fórmula com 2 bytes de extensão conta como UM item", e.length === 2, e);
    chk("e o item seguinte é lido certo", e[0].nomeTipo === "fórmula" && e[1].nomeTipo === "texto", e);
    chk("unidade também pula a extensão", escalaDe([0, 0, 0xb1, 0x0a, 0x00]).length === 2, escalaDe([0, 0, 0xb1, 0x0a, 0x00]));
    chk("sem extensão, cada byte é um item", escalaDe([0, 0, 0x02, 0x51, 0x12]).length === 3);
  }
}

/* ---------------- casca da resposta que vem dos métodos nativos ---------------- */
{
  chk("resposta boa do atuador é aceita", respostaDe({ resposta: "6F 01 00 03\r>" }, SV.atuar).nrc === null);
  chk("negativa do atuador vira frase", respostaDe({ resposta: "7F 2F 22\r>" }, SV.atuar).texto.includes("condições"));
  chk("resposta de OUTRO serviço não passa por boa",
    respostaDe({ resposta: "71 01 AD 6E\r>" }, SV.atuar).erro === "resposta-inesperada");
  chk("recusa do adaptador é repassada", !!respostaDe({ resposta: "NO DATA\r>" }, SV.atuar).erro);
  chk("resposta vazia não vira sucesso", !!respostaDe({}, SV.atuar).erro);
}

/* ---------------- números dos serviços e opções, como a norma põe ---------------- */
chk("serviços", SV.sessao === 0x10 && SV.falhas === 0x19 && SV.lerDado === 0x22 && SV.lerEscala === 0x24
  && SV.destravar === 0x27 && SV.gravar === 0x2e && SV.atuar === 0x2f && SV.rotina === 0x31 && SV.presenca === 0x3e);
chk("devolver o controle é a opção 00 e acionar é a 03", ATUAR.devolver === 0x00 && ATUAR.ajustar === 0x03);
chk("rotina: 01 começa, 02 para, 03 resultado", ROTINA.comecar === 1 && ROTINA.parar === 2 && ROTINA.resultado === 3);
chk("a sessão de programação é a 02 — e o nativo não deixa passar", SESSAO.programacao === 0x02);

/* ---------------- o byte de tipo de falha: o código ganha a causa elétrica ---------------- */
chk("0x13 é circuito aberto", textoTipoFalha(0x13) === "circuito aberto");
chk("0x11 é curto com a massa", textoTipoFalha(0x11).includes("massa"));
chk("0x12 é curto com o positivo", textoTipoFalha(0x12).includes("positivo"));
chk("0x71 é atuador travado", textoTipoFalha(0x71) === "atuador travado");
chk("0x49 decodifica o U3000-49 que está no catálogo", textoTipoFalha(0x49) === "falha eletrônica interna");
// a tabela cobre 111 dos 256 valores: o que falta devolve VAZIO, para a tela mostrar o número cru.
chk("valor que não está na tabela devolve vazio, não palpite", textoTipoFalha(0x2b) === "" && textoTipoFalha(0xaa) === "");
chk("termo que a oficina fala em inglês fica em inglês", textoTipoFalha(0x41).includes("checksum")
  && textoTipoFalha(0x47).includes("watchdog") && textoTipoFalha(0x88).includes("bus off")
  && textoTipoFalha(0xf9).includes("limp home"));
chk("o rótulo sai com o sufixo", codigoCom("U3000", 0x49) === "U3000-49" && codigoCom("P0171", 0x13) === "P0171-13");
chk("sem tipo de falha, o código fica como está", codigoCom("P0171", null) === "P0171");

/* ---------------- os bits de situação ---------------- */
chk("oito bits, na ordem da norma", situacaoDe(0xff).length === 8);
chk("bit 0 é 'falhou agora'", situacaoDe(0x01)[0].t === "falhou agora");
chk("bit 3 é 'confirmada'", situacaoDe(0x08)[0].nome === "confirmedDTC");
chk("bit 7 é a luz do painel", situacaoDe(0x80)[0].nome === "warningIndicatorRequested");
chk("byte zero não inventa situação", situacaoDe(0).length === 0 && resumoSituacao(0).includes("sem situação"));
chk("o resumo põe o que importa na frente", resumoSituacao(0x0f).startsWith("confirmada"), resumoSituacao(0x0f));

/* ---------------- a falha pronta para a tela ---------------- */
{
  const f = falhaPronta({ codigo: "U3000", tipoFalha: 0x49, situacao: 0x88 });
  chk("rótulo com sufixo", f.rotulo === "U3000-49", f);
  chk("causa elétrica em palavra", f.causa === "falha eletrônica interna", f);
  chk("a luz do painel é apontada", f.pedeLuz === true, f);
  const g = falhaPronta({ codigo: "P0171", tipoFalha: 0x2b, situacao: 0x08 });
  chk("tipo fora da tabela: rótulo sai, causa fica vazia", g.rotulo === "P0171-2B" && g.causa === "", g);
  chk("sem pedido de luz não aponta luz", g.pedeLuz === false);
}

/* ---------------- onde os módulos ficam ---------------- */
chk("oito endereços padrão de 11 bits", ENDERECOS_PADRAO.length === 8);
chk("a resposta é o pedido + 8", ENDERECOS_PADRAO.every(e => parseInt(e.resposta, 16) === parseInt(e.pedido, 16) + 8));
chk("7E0 é o motor e 7E1 o câmbio", ENDERECOS_PADRAO[0].nome === "Motor" && ENDERECOS_PADRAO[1].nome === "Câmbio");
chk("do 7E3 em diante o nome fica vazio em vez de chutado",
  ENDERECOS_PADRAO.slice(3).every(e => e.nome === ""));
chk("o acervo tem famílias e módulos", familias().length >= 20 && quantosModulos() >= 200, { f: familias().length, m: quantosModulos() });
chk("a VAG está no acervo", familias().includes("VAG") && modulosDa("VAG").length === 90, modulosDa("VAG").length);
chk("todo módulo tem pedido e resposta", familias().every(f => modulosDa(f).every(m => m.pedido && m.resposta)));
chk("família que não existe devolve lista vazia", modulosDa("NAO EXISTE").length === 0);
chk("o acervo tem data", /^\d{4}-\d{2}-\d{2}$/.test(versaoAcervo()));

/* ---------------- ePTI (ISO 20730): a lista igual para todas as marcas ---------------- */
chk("57 sistemas no acervo", sistemasEpti().length === 57, sistemasEpti().length);
chk("ABS tem o nome que a oficina usa", nomeSistemaEpti("000B") === "Freio ABS");
chk("ESP também", nomeSistemaEpti(0x0012).includes("ESP"));
chk("airbag fica em inglês, como se fala", nomeSistemaEpti("0005") === "Airbag");
chk("número que a norma reserva não tem nome", nomeSistemaEpti("0000") === "" && nomeSistemaEpti("0017") === "");
chk("sistema fora da lista devolve vazio, não palpite", nomeSistemaEpti("FFFF") === "");
chk("todo sistema tem número, nome simbólico e nome em português",
  sistemasEpti().every(s => /^[0-9A-F]{4}$/.test(s.id) && s.sim && s.nome));
chk("12 identificadores de dado, 6 obrigatórios",
  didsEpti().length === 12 && didsEpti().filter(d => d.obrigatorio).length === 6);
// a norma PUBLICADA: FA22 rotina, FA23 atuador (no rascunho de 2020 era o contrário)
chk("FA22 é rotina e FA23 é atuador, como na norma publicada",
  nomeDidEpti("FA22").includes("Rotinas") && nomeDidEpti("FA23").includes("Atuadores"));
chk("os números do ePTI estão certos", EPTI.rotinas === 0xfa22 && EPTI.atuadores === 0xfa23
  && EPTI.sistemas === 0xfa21 && EPTI.dados === 0xfa20);
chk("o app sabe que não tem os anexos C e D", eptiTemAnexoCD() === false);

/* ---------------- a armadilha do rascunho: os dois trocaram de lugar ----------------
   Para inverter, a prova tem de vir das DUAS listas e concordar. Rotina mora de 0x0100 a 0xE2FF
   (tacógrafo, fabricante, teste de emissão e segurança são TODAS faixas de rotina da norma, não só
   a do fabricante); identificador de atuador é identificador de dado, e os do ePTI moram de 0xF000
   para cima. Exigir prova nos dois lados foi correção da revisão independente de 20/11/2026: antes,
   UMA entrada fora da faixa do fabricante virava a decisão e trocava rotina por atuador em silêncio. */
{
  const rotinas = [0x0200, 0xad6e, 0xa001];
  const atuadores = [0xf101, 0xfa30, 0xf2c0];
  const certo = decidirRotinaAtuador(rotinas, atuadores);
  chk("módulo na norma publicada: fica como veio, sem dúvida",
    !certo.invertido && !certo.duvida && certo.rotinas.length === 3 && certo.atuadores[0] === 0xf101, certo);
  const trocado = decidirRotinaAtuador(atuadores, rotinas);
  chk("módulo no jeito do rascunho: o app corrige pelo conteúdo", trocado.invertido === true && !trocado.duvida, trocado);
  chk("e as duas listas vão para o lugar certo",
    trocado.rotinas[1] === 0xad6e && trocado.atuadores[0] === 0xf101, trocado);

  // A parte que mais importa: faixa LEGÍTIMA de rotina fora da do fabricante não pode virar inversão
  for (const [nome, extra] of [["tacógrafo", 0x0150], ["teste de emissão", 0xe050], ["segurança", 0xe250]])
    chk("rotina com " + nome + " na lista NÃO inverte",
      decidirRotinaAtuador([0x0200, extra], atuadores).invertido === false, { nome, r: decidirRotinaAtuador([0x0200, extra], atuadores) });

  // Sem prova dos dois lados, não decide: marca dúvida para a tela pedir confirmação
  chk("FA22 vazio não força inversão, e marca dúvida",
    decidirRotinaAtuador([], rotinas).invertido === false && decidirRotinaAtuador([], rotinas).duvida === true);
  chk("as duas na faixa de rotina: dúvida, sem inverter",
    decidirRotinaAtuador([0x0200], [0x0300]).duvida === true && decidirRotinaAtuador([0x0200], [0x0300]).invertido === false);
  chk("nenhuma reconhecível: dúvida, e fica como a norma publicada manda",
    decidirRotinaAtuador([0xff00], [0xff01]).invertido === false && decidirRotinaAtuador([0xff00], [0xff01]).duvida === true);
  chk("só o FA22, sem FA23: fica certo e sem dúvida",
    decidirRotinaAtuador(rotinas, []).duvida === false && decidirRotinaAtuador(rotinas, []).invertido === false);
  chk("listas vazias não explodem e não geram dúvida",
    decidirRotinaAtuador([], []).rotinas.length === 0 && decidirRotinaAtuador([], []).duvida === false
    && decidirRotinaAtuador(null, null).atuadores.length === 0);
}

/* ---------------- a lista de 16 bits que o módulo devolve ---------------- */
{
  const l = listaDe16([0xfa, 0x22, 0x02, 0x00, 0xad, 0x6e]);
  chk("o eco do identificador é descartado e sobram os números", l.certo && l.lista.length === 2
    && l.lista[0] === 0x0200 && l.lista[1] === 0xad6e, l);
  chk("byte sobrando não vira número errado: devolve o cru e avisa", listaDe16([0xfa, 0x22, 0x02]).certo === false);
  chk("lista vazia não é tida como certa", listaDe16([0xfa, 0x22]).certo === false);
  chk("dado nulo não explode", listaDe16(null).lista.length === 0);
}

console.log(falhas.length ? ok.length + " ok, " + falhas.length + " FALHARAM:\n  " + falhas.join("\n  ")
                          : ok.length + " conferências do UDS passaram.");
process.exit(falhas.length ? 1 : 0);
