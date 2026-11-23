// Parâmetros de referência do diagnóstico OBD (pedido do Danilo em 20/11/2026).
// Sem window/document: roda no app, no sistema e em teste, e pode ir para o conector depois.
//
// A REGRA, que vale para tudo aqui: todo número aparece com o NÍVEL DE CONFIANÇA ao lado.
// O Danilo tem o Raven como contraprova, então valor sem documento de montadora não é motivo para
// deixar a tela vazia — é motivo para marcar "suposto, a conferir". O que ele conferir vira o nível
// mais alto e passa a valer. Com o tempo, a referência dos motores daqui sai dos próprios carros da
// oficina, que é o que não existe publicado em lugar nenhum.
//
// QUEM CORRIGE É O CLAUDE, AQUI NO ARQUIVO (decisão do Danilo, 20/11/2026): ele confere no Raven, manda a
// foto no chat e o valor entra como `conferido` no parâmetro, com o carro e a data. Não há formulário no
// app: a tela é só de leitura. Assim cada correção fica no histórico do repositório, dá para rever de onde
// veio e some o risco de alguém digitar errado no celular com o carro ligado na frente.

/** Do mais forte para o mais fraco. A tela mostra tonalidade + a palavra escrita (nunca só a cor). */
export const NIVEIS = [
  { id: "conferido", nome: "Conferido aqui", ordem: 0 },
  { id: "norma", nome: "Norma", ordem: 1 },
  { id: "montadora", nome: "Montadora", ordem: 2 },
  { id: "suposto", nome: "Suposto, a conferir", ordem: 3 },
];
export const nivel = id => NIVEIS.find(n => n.id === id) || NIVEIS[3];

/* usado: o app decide alguma coisa com este número. Os outros são referência na tela.
 * onde: "geral" vale para qualquer carro; "modelo" só para o motor citado. */
export const PARAMETROS = [
  // ---- os que o app usa para dizer alguma coisa ----
  { id: "ajuste_atencao", nome: "Ajuste de combustível: começa a chamar atenção", valor: 10, unidade: "%",
    nivel: "suposto", onde: "geral", usado: true,
    fonte: "Faixa que a reparação usa. Não existe limite público de montadora para motor flex brasileiro." },
  { id: "ajuste_grave", nome: "Ajuste de combustível: correção no limite", valor: 25, unidade: "%",
    nivel: "montadora", onde: "geral", usado: true,
    fonte: "Ford, OBD System Operation Summary: acusa falha com ajuste longo acima de 25% junto com o curto acima de 5%. O limite do ajuste curto é ±25%." },
  { id: "falha_minima", nome: "Falha por cilindro: contagem mínima para apontar um cilindro", valor: 10, unidade: "contagens",
    nivel: "suposto", onde: "geral", usado: true,
    fonte: "Trava nossa, para contagem miúda não virar diagnóstico. Sem fonte de montadora." },
  { id: "falha_destaque", nome: "Falha por cilindro: quantas vezes acima do segundo pior", valor: 3, unidade: "x",
    nivel: "suposto", onde: "geral", usado: true,
    fonte: "Trava nossa. A regra documentada é comparar os cilindros entre si, sem número fixo." },
  { id: "razao_ipt", nome: "Contadores de uso: razão mínima do monitor", valor: 0.336, unidade: "",
    nivel: "norma", onde: "geral", usado: true,
    fonte: "CARB 13 CCR 1968.2 e Regulamento (CE) 692/2008: 0,336 para catalisador, sonda, EGR e VVT; 0,260 para partida a frio e ar secundário." },

  // ---- referência de norma ----
  { id: "misfire_tipo_a", nome: "Falha de combustão tipo A (dano ao catalisador): janela", valor: 200, unidade: "rotações",
    nivel: "norma", onde: "geral", usado: false,
    fonte: "CARB 13 CCR 1968.2 (3.2.1). O percentual de falha dentro da janela é calibração de cada montadora." },
  { id: "misfire_tipo_b", nome: "Falha de combustão tipo B (emissão): janela", valor: 1000, unidade: "rotações",
    nivel: "norma", onde: "geral", usado: false,
    fonte: "CARB 13 CCR 1968.2 (3.2.2): o percentual que faria a emissão passar de 1,5× o padrão." },
  { id: "inspecao_incompletos", nome: "Monitores incompletos aceitos em inspeção (EUA)", valor: 1, unidade: "monitor",
    nivel: "norma", onde: "geral", usado: false,
    fonte: "40 CFR 85.2222: até 1 incompleto para 2001 em diante (até 2 para 1996–2000). No Brasil não há regra equivalente publicada." },

  // ---- referência de montadora (Ford 2001, o próprio documento chama de 'típico') ----
  { id: "cat_razao", nome: "Catalisador: razão sonda traseira ÷ dianteira que reprova", valor: 0.75, unidade: "",
    nivel: "montadora", onde: "geral", usado: false,
    fonte: "Ford: acima de 0,75 por banco; 0,60 em escape em Y. Em flex o limite SOBE com o etanol: 0,50 com E10 até 0,90 com E85." },
  { id: "cat_dano", nome: "Catalisador: temperatura de dano", valor: 871, unidade: "°C",
    nivel: "montadora", onde: "geral", usado: false,
    fonte: "Ford: 871 °C no convencional (Pt/Pd/Rh), 899 °C no avançado e 982 °C no de paládio. É temperatura de DANO, não de trabalho." },
  { id: "tensao_monitores", nome: "Abaixo desta tensão o módulo suspende os monitores", valor: 11, unidade: "V",
    nivel: "montadora", onde: "geral", usado: false,
    fonte: "Ford. Explica monitor que nunca completa em carro com bateria fraca." },
  { id: "combustivel_monitores", nome: "Abaixo deste nível de tanque os monitores de combustível param", valor: 15, unidade: "%",
    nivel: "montadora", onde: "geral", usado: false, fonte: "Ford." },
  { id: "sensor_baixo", nome: "Sensor analógico fora de faixa: mínimo", valor: 0.2, unidade: "V",
    nivel: "montadora", onde: "geral", usado: false, fonte: "Ford: abaixo de 0,20 V ou acima de 4,80 V o módulo acusa fora de faixa." },
  { id: "sensor_alto", nome: "Sensor analógico fora de faixa: máximo", valor: 4.8, unidade: "V",
    nivel: "montadora", onde: "geral", usado: false, fonte: "Ford." },
  { id: "sonda_amplitude", nome: "Sonda dianteira lenta: amplitude abaixo de", valor: 0.5, unidade: "V",
    nivel: "montadora", onde: "geral", usado: false, fonte: "Ford: amplitude menor que 0,5 V no teste de onda quadrada de 1,5 Hz." },
  { id: "aquecimento_max", nome: "Aquecimento do motor: tempo máximo para chegar perto do termostato", valor: 800, unidade: "s",
    nivel: "montadora", onde: "geral", usado: false,
    fonte: "Ford: alvo é a abertura do termostato menos 20 °F (termostato de 195 °F → ~79 °C), em 300 a 800 s." },

  // ---- referência por modelo (único motor com tabela pública completa) ----
  { id: "rail_lenta_1kd", nome: "Pressão do rail em marcha lenta", de: 300, ate: 400, unidade: "bar",
    nivel: "montadora", onde: "modelo", modelo: "Toyota Hilux 1KD-FTV (3.0 diesel)", usado: false,
    fonte: "Manual de reparo Toyota (DR201E): 30 a 40 MPa. Outras páginas do mesmo manual dão 20–40 e 25–35 MPa, conforme a versão." },
  { id: "rail_wot_1kd", nome: "Pressão do rail a 3.500 rpm com acelerador a fundo", valor: 1500, unidade: "bar",
    nivel: "montadora", onde: "modelo", modelo: "Toyota Hilux 1KD-FTV (3.0 diesel)", usado: false,
    fonte: "Manual Toyota (DR201E): mínimo 150 MPa." },
  { id: "rail_alvo_dif", nome: "Diferença aceita entre pressão real e pressão alvo", valor: 50, unidade: "bar",
    nivel: "montadora", onde: "modelo", modelo: "Toyota Hilux 1KD-FTV (3.0 diesel)", usado: false,
    fonte: "Manual Toyota 1KD: em marcha lenta estável, diferença de até 5.000 kPa. A pressão ALVO não sai por OBD genérico, só por PID de montadora." },
  { id: "maf_lenta_1kd", nome: "MAF em marcha lenta", de: 5, ate: 12, unidade: "g/s",
    nivel: "montadora", onde: "modelo", modelo: "Toyota Hilux 1KD-FTV (3.0 diesel)", usado: false,
    fonte: "Manual Toyota (DR201E). A 3.000 rpm sem carga: 75 a 95 g/s." },

  // ---- suposto: circula na reparação, sem documento de montadora. Entra para ser conferido no Raven ----
  { id: "rail_lenta_geral", nome: "Pressão do rail em marcha lenta (common rail, geral)", de: 250, ate: 550, unidade: "bar",
    nivel: "suposto", onde: "geral", usado: false,
    fonte: "Fóruns e fornecedores de bancada. NÃO há documento Bosch, Delphi ou Denso público. A conferir no Raven." },
  { id: "rail_partida", nome: "Pressão mínima do rail para o motor pegar", valor: 250, unidade: "bar",
    nivel: "suposto", onde: "geral", usado: false, fonte: "Reparação, sem documento. A conferir no Raven." },
  { id: "rail_injetar", nome: "Pressão a partir da qual o bico injeta", valor: 350, unidade: "bar",
    nivel: "suposto", onde: "geral", usado: false, fonte: "Reparação, sem documento. A conferir no Raven." },
  { id: "maf_por_litro", nome: "MAF esperado em marcha lenta, por litro de cilindrada", valor: 1, unidade: "g/s por litro",
    nivel: "suposto", onde: "geral", usado: false,
    fonte: "Regra de oficina; as próprias fontes discordam (0,8–1,2 e 1,0–2,0). O único dado de montadora que achamos (Hilux 3.0 diesel: 5–12 g/s) já foge dela." },
  /* ---- CONFERIDO NO RAVEN, no carro (23/11/2026) ----
   * O Danilo pôs o Raven (Scanner 3) na Amarok QMT4A86 — VW Amarok 2.0 16V 4 cil. Bi-Turbo Diesel
   * 180 cv 16-22, módulo Bosch EDC17CP54 — e filmou as leituras com as faixas que a ferramenta
   * mostra. Estas são as primeiras faixas CONFERIDAS do app: não são suposição de reparação nem
   * palpite nosso, são o que uma ferramenta de oficina mostra para este motor. */
  { id: "arrefecimento_edc17cp54", nome: "Temperatura do motor em trabalho", de: 80, ate: 100, unidade: "°C",
    nivel: "conferido", onde: "modelo", modelo: "VW Amarok 2.0 BiTDI (Bosch EDC17CP54, 2016-22)", usado: false,
    fonte: "Raven Scanner 3 na Amarok QMT4A86, 23/11/2026. A leitura marcou 75 °C em vermelho, fora da faixa." },
  { id: "rail_lenta_edc17cp54", nome: "Pressão do rail em marcha lenta", de: 280, ate: 360, unidade: "bar",
    nivel: "conferido", onde: "modelo", modelo: "VW Amarok 2.0 BiTDI (Bosch EDC17CP54, 2016-22)", usado: false,
    fonte: "Raven Scanner 3 na Amarok QMT4A86, 23/11/2026. O nosso app leu 327 a 332 bar em lenta no mesmo carro: dentro." },
  { id: "lenta_edc17cp54", nome: "Rotação em marcha lenta", de: 750, ate: 930, unidade: "rpm",
    nivel: "conferido", onde: "modelo", modelo: "VW Amarok 2.0 BiTDI (Bosch EDC17CP54, 2016-22)", usado: false,
    fonte: "Raven Scanner 3 na Amarok QMT4A86, 23/11/2026." },
  { id: "iat_edc17cp54", nome: "Temperatura do ar de admissão", de: 30, ate: 65, unidade: "°C",
    nivel: "conferido", onde: "modelo", modelo: "VW Amarok 2.0 BiTDI (Bosch EDC17CP54, 2016-22)", usado: false,
    fonte: "Raven Scanner 3 na Amarok QMT4A86, 23/11/2026." },
  { id: "consumo_lenta_edc17cp54", nome: "Consumo em marcha lenta", de: 0.5, ate: 0.8, unidade: "L/h",
    nivel: "conferido", onde: "modelo", modelo: "VW Amarok 2.0 BiTDI (Bosch EDC17CP54, 2016-22)", usado: false,
    fonte: "Raven Scanner 3 na Amarok QMT4A86, 23/11/2026. Não sai por OBD genérico: fica aqui de referência." },
  { id: "bateria_motor_ligado", nome: "Tensão da bateria com o motor ligado", de: 12.5, ate: 14.7, unidade: "V",
    nivel: "conferido", onde: "geral", usado: false,
    fonte: "Raven Scanner 3 na Amarok QMT4A86, 23/11/2026 (faixa que a ferramenta usa, não é de um motor só). O nosso app leu 14,0 V no mesmo carro." },
  { id: "arrefecimento_trabalho", nome: "Temperatura do motor em trabalho", de: 80, ate: 105, unidade: "°C",
    nivel: "suposto", onde: "geral", usado: false,
    fonte: "Reparação: do termostato abrindo (82 a 92 °C na maioria dos motores) até a ventoinha entrar (100 a 105 °C). Era de 85 a 105 e marcava ABAIXO um motor a 82 °C, que é normal (23/11/2026). Não achamos faixa normal nem temperatura de dano publicada por montadora nenhuma. A conferir no Raven." },
];

export const porId = id => PARAMETROS.find(p => p.id === id) || null;

/** O que o Danilo conferiu no Raven, gravado no próprio parâmetro (campo `conferido`). */
const conferido = p => (p && p.conferido) || null;

/** Valor que vale agora: o conferido, se houver; senão o de referência. */
export function valorDe(id) {
  const p = porId(id);
  if (!p) return null;
  const c = conferido(p);
  if (c && typeof c.valor === "number") return c.valor;
  return typeof p.valor === "number" ? p.valor : null;
}
/** Faixa (de/ate) que vale agora, para os parâmetros que são faixa. */
export function faixaDe(id) {
  const p = porId(id);
  if (!p) return null;
  const c = conferido(p);
  const de = c && typeof c.de === "number" ? c.de : p.de;
  const ate = c && typeof c.ate === "number" ? c.ate : p.ate;
  return typeof de === "number" && typeof ate === "number" ? { de, ate } : null;
}
/** Nível que vale agora: o que foi conferido no Raven sobe para o nível mais alto. */
export function nivelDe(id) {
  const p = porId(id);
  if (!p) return "suposto";
  return conferido(p) ? "conferido" : p.nivel;
}
/** A lista inteira com o que vale agora — é o que a tela mostra. */
export function lista() {
  return PARAMETROS.map(p => Object.assign({}, p, {
    valorAtual: valorDe(p.id),
    faixaAtual: faixaDe(p.id),
    nivelAtual: nivelDe(p.id),
    conferencia: conferido(p),
  }));
}
/** Os limites que o app usa para decidir, já com o que foi conferido. */
export function limites() {
  return {
    atencao: valorDe("ajuste_atencao"), grave: valorDe("ajuste_grave"),
    minima: valorDe("falha_minima"), destaque: valorDe("falha_destaque"),
    razao: valorDe("razao_ipt"),
  };
}
/** Texto curto para a tela: "300 a 400 bar" ou "25 %". */
export function textoDe(p) {
  const n = x => String(x).replace(".", ",");
  if (p.faixaAtual) return n(p.faixaAtual.de) + " a " + n(p.faixaAtual.ate) + (p.unidade ? " " + p.unidade : "");
  if (typeof p.valorAtual === "number") return n(p.valorAtual) + (p.unidade ? " " + p.unidade : "");
  return "—";
}
/** Como escrever a procedência de um valor conferido, na tela. */
export function textoConferencia(c) {
  if (!c) return "";
  const partes = [];
  if (c.carro) partes.push(c.carro);
  if (c.obs) partes.push(c.obs);
  if (c.em) partes.push(c.em);
  return partes.length ? "Conferido no Raven: " + partes.join(" · ") : "Conferido no Raven.";
}
