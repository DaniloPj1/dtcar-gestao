// Óleo e filtros por veículo (pedido do Danilo em 14/11/2026) — regras da pesquisa, num lugar só.
// Sem window/document: serve para a tela e, depois, para a ficha do veículo, a O.S. e o conector.
// Os dados ficam em js/catalogodados.js (arquivo gerado, ~2 MB), carregado só quando a tela abre (carregarCatalogo).
//
// Formato dos dados:
//   oleo:    [montadora, modelo, motor, anoDe, anoAte, litros, viscosidade, norma, fonte, aviso]   (0 = ano não informado / sem limite)
//   filtros: [catálogo, montadora, modelo, versão, motor, anoDe, anoAte, óleo, ar, combustível, cabine, observação]
//            (cada campo de filtro pode trazer mais de um código, separados por espaço)
//   conv:    { códigoTecfil: [[marca, código], ...] }  — conversão da Tecfil 2026; marca com "*" no fim = código original da montadora
//
// Regras do Danilo (14/11/2026):
//   - óleo: só litros, viscosidade e norma (a marca do óleo não importa);
//   - filtro que está no ESTOQUE (saldo maior que zero) aparece sozinho, com o botão de conversão: a prioridade é o estoque;
//   - fora do estoque, aparecem só Tecfil, Mahle e MANN; as outras marcas ficam atrás do botão "Conversão";
//   - é dado de catálogo: a tela manda conferir, e fonte que discorda de outra é marcada.
import { norm } from "./util.js";

export const TIPOS_FILTRO = [["oleo", "Óleo"], ["ar", "Ar"], ["combustivel", "Combustível"], ["cabine", "Cabine"]];
export const MARCAS_PRINCIPAIS = ["Tecfil", "MAHLE", "MANN"];
const NOME_MARCA = { TECFIL: "Tecfil", MAHLE: "MAHLE", MANN: "MANN", WEGA: "Wega", BOSCH: "Bosch", VOX: "Vox", FRAM: "Fram", WIX: "Wix" };
const nomeMarca = m => NOME_MARCA[String(m).toUpperCase()] || m;
const chaveMarca = m => norm(m).replace(/[^a-z0-9]/g, "");

let carga = null;
// carrega os dados uma vez só (a tela mostra "Carregando o catálogo…" enquanto isso)
export function carregarCatalogo() {
  if (!carga) carga = import("./catalogodados.js").then(m => prepararCatalogo(m.default)).catch(e => { carga = null; throw e; });
  return carga;
}

// Código de filtro do jeito que dá para comparar: sem espaço, traço, barra, "S/NF" nem o nome da marca escrito junto
// ("C231071 MANN", "HU 7008Z", "OC259 S/NF" e "0 986 B02 510" viram C231071, HU7008Z, OC259 e 0986B02510).
const PALAVRAS_FORA = /\b(S\/?\s?NF|C\/?\s?NF|MANN(?:\s*-?\s*FILTER)?|TECFIL|MAHLE|METAL\s+LEVE|BOSCH|VOX|WEGA|FRAM|WIX|AC\s?DELCO|DELPHI|MAGNETI?\s+MARELLI|HENGST|ORIGINAL)\b/g;
export const normCodigo = s => String(s ?? "").toUpperCase().replace(PALAVRAS_FORA, " ").replace(/[^A-Z0-9]/g, "");

export function prepararCatalogo(d) {
  const texto = (m, ...p) => norm([d.montadoras[m], ...p].join(" ")).replace(/(\d),(\d)/g, "$1.$2").replace(/[()\/,;]/g, " ");
  const oleo = d.oleo.map(r => ({ montadora: d.montadoras[r[0]], modelo: r[1], motor: r[2], de: r[3], ate: r[4], litros: r[5], viscosidade: r[6], norma: r[7],
    fonte: d.fontesOleo[r[8]], aviso: r[9] || "", _t: texto(r[0], r[1], r[2]), _m: norm(r[1]) }));
  const filtros = d.filtros.map(r => ({ marca: d.marcas[r[0]], catalogo: d.catalogos[r[0]], ordem: r[0], montadora: d.montadoras[r[1]], modelo: r[2], versao: r[3], motor: r[4], de: r[5], ate: r[6],
    oleo: r[7] ? r[7].split(" ") : [], ar: r[8] ? r[8].split(" ") : [], combustivel: r[9] ? r[9].split(" ") : [], cabine: r[10] ? r[10].split(" ") : [], obs: r[11] || "",
    _t: texto(r[1], r[2], r[3], r[4]), _m: norm(r[2]) }));
  // de qualquer código (de qualquer marca) para o(s) código(s) Tecfil equivalentes
  const paraTecfil = new Map();
  const liga = (cod, tec) => { const k = normCodigo(cod); if (!k) return; const l = paraTecfil.get(k); if (!l) paraTecfil.set(k, [tec]); else if (!l.includes(tec)) l.push(tec); };
  for (const tec of Object.keys(d.conv)) { liga(tec, tec); for (const [, cod] of d.conv[tec]) liga(cod, tec); }
  return { versao: d.versao, oleo: podarDivergencias(oleo), oleoTotal: oleo.length, filtros, conv: d.conv, marcasConv: d.marcasConv, paraTecfil };
}

// "gm onix 1.0 2018" → palavras ["chevrolet", "onix", "1.0"] e ano 2018 (o ano também pode vir no campo próprio)
const APELIDOS = { gm: "chevrolet", vw: "volkswagen", volks: "volkswagen", mb: "mercedes", mercedes: "mercedes", citroën: "citroen", "pick-up": "pick", pickup: "pick" };
export function lerBusca(txt, anoCampo) {
  let ano = Number(anoCampo) || 0; const palavras = [];
  for (const p of norm(txt).replace(/(\d),(\d)/g, "$1.$2").replace(/[()\/,;]/g, " ").split(/\s+/).filter(Boolean)) {
    if (/^(19[5-9]\d|20[0-4]\d)$/.test(p)) { if (!ano) ano = Number(p); continue; }
    const cil = p.match(/^(\d)[.,](\d)$/); // "1,0" e "1.0" são a mesma coisa
    palavras.push(cil ? cil[1] + "." + cil[2] : APELIDOS[p] || p);
  }
  return { palavras, ano: ano >= 1950 && ano <= 2049 ? ano : 0 };
}
const serve = (r, ano) => !ano || ((!r.de || ano >= r.de) && (!r.ate || ano <= r.ate));
// nota da linha: todas as palavras têm de aparecer; palavra inteira no nome do modelo vale mais ("gol" antes de "golf")
function nota(r, palavras) {
  let n = 0;
  for (const p of palavras) {
    if (!r._t.includes(p)) return -1;
    const inteira = new RegExp("(^|[^a-z0-9.])" + p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "($|[^a-z0-9.])");
    n += inteira.test(r._m) ? 3 : inteira.test(r._t) ? 2 : r._m.includes(p) ? 1 : 0;
  }
  return n;
}
const E_DIESEL = /diesel|\btdi\b|\bcrdi\b|\bctdi\b|\btd\b|\bhdi\b|\bdci\b|\bcdi\b|multijet|duratorq/, E_OTTO = /flex|gasolina|etanol|alcool|\bgnv\b/;
const E_TURBO = /turbo|\btsi\b|tgdi|\bthp\b|t-?jet|\bgse\b|\btb\b/;
function notaExtras(r, extras) {
  if (!extras) return 0; let n = 0;
  for (const p of extras.inteiras || []) if (!new RegExp("(^|[^a-z0-9])" + p + "($|[^a-z0-9])").test(r._m)) return -99;   // nome do modelo tem de ser palavra inteira (gol não é golf)
  for (const p of extras.palavras || []) if (r._t.includes(p)) n += 0.5;
  if (extras.diesel === true) n += E_DIESEL.test(r._t) ? 1 : E_OTTO.test(r._t) ? -3 : 0;
  if (extras.diesel === false) n += E_DIESEL.test(r._t) ? -3 : 0;
  if (extras.diesel !== true && extras.turbo !== undefined) n += E_TURBO.test(r._t) === extras.turbo ? 0.5 : -1;   // aspirado não puxa a linha do turbo, e vice-versa
  return n;
}
const porNota = (a, b) => b._n - a._n || a.montadora.localeCompare(b.montadora) || a.modelo.localeCompare(b.modelo, "pt-BR", { numeric: true }) || (b.de || 0) - (a.de || 0);

export const LIMITE_BUSCA = 40;
// Pesquisa por modelo (e ano). Devolve as linhas de óleo e as aplicações de filtros que servem, da melhor para a pior.
// extras (busca pela placa): palavras-chave que não são obrigatórias, mas põem na frente a linha que as tem (versão, turbo, 16v…),
// e o combustível do carro, que empurra para trás a linha de outro combustível (diesel x flex/gasolina).
export function pesquisar(cat, txt, anoCampo, extras) {
  const { palavras, ano } = lerBusca(txt, anoCampo);
  if (!palavras.length || palavras.join("").length < 2) return { palavras, ano, oleo: [], filtros: [], outros: [], totalOleo: 0, totalFiltros: 0 };
  // com o ano informado, a linha que diz de que ano é vem antes da que não diz; a conferida pela oficina vem antes de todas
  const acha = lista => lista.map(r => { const n = nota(r, palavras); const x = n < 0 || !serve(r, ano) ? -99 : notaExtras(r, extras); return x <= -99 ? null : { ...r, _n: n + (ano && (r.de || r.ate) ? 1 : 0) + (/^Conferido/.test(r.fonte || "") ? 5 : 0) + x }; }).filter(Boolean).sort(porNota);
  const oleo = acha(cat.oleo), todos = acha(cat.filtros);
  const tecfil = todos.filter(f => f.ordem === 0), outros = todos.filter(f => f.ordem !== 0).sort((a, b) => b._n - a._n || a.ordem - b.ordem || porNota(a, b));
  return { palavras, ano, oleo: marcarDivergencias(oleo.slice(0, LIMITE_BUSCA)), totalOleo: oleo.length,
    filtros: (tecfil.length ? tecfil : outros).slice(0, LIMITE_BUSCA), totalFiltros: tecfil.length || outros.length,
    outros: tecfil.length ? outros.slice(0, LIMITE_BUSCA) : [], principal: tecfil.length ? "Tecfil" : "" };
}

// Fontes que copiam a mesma tabela contam como uma só (Ipiranga e Maxon trazem os mesmos números).
const familia = fonte => /ipiranga|maxon/i.test(fonte) ? "ipiranga-maxon" : fonte;
const cilindradas = r => [...new Set((r.motor + " " + r.modelo).match(/\b\d\.\d\b/g) || [])].sort().join("+");
// só tabela contra tabela: linha conferida no manual ou indicada por loja não entra na comparação; turbo só compara com turbo
const eTabela = r => !/^(Conferido|Indicado)/.test(r.fonte);
const turbo = r => /turbo|\btb\b|\btd\b|tgdi|tsi|thp|t-?jet|\bgse\b|diesel|tdi|crdi|ctdi|duratorq|multijet|\bhdi\b|\bdci\b|\bcdi\b/i.test(r.motor + " " + r.modelo);
const litrosNum = l => Number(String(l).replace(",", ".")) || 0;
const cruzam = (a, b) => (!a.de && !a.ate) || (!b.de && !b.ate) || ((a.de || 0) <= (b.ate || 9999) && (b.de || 0) <= (a.ate || 9999));
/** Viscosidades de uma linha ("5W30 ou 10W40" → ["5W30","10W40"]) */
export const viscosidades = r => [...new Set(String(r.viscosidade || "").toUpperCase().split(/\s+OU\s+|\s*\/\s*|\s*,\s*/).map(x => x.replace(/\s|-/g, "")).filter(Boolean))];
const mesmaViscosidade = (a, b) => { const va = viscosidades(a), vb = viscosidades(b); return !va.length || !vb.length || va.some(v => vb.includes(v)); };
const mesmoMotor = (a, b) => eTabela(a) && eTabela(b) && turbo(a) === turbo(b) && familia(b.fonte) !== familia(a.fonte) && b.montadora === a.montadora && cilindradas(b) === cilindradas(a)
  && (b._m === a._m || b._m.startsWith(a._m + " ") || a._m.startsWith(b._m + " ")) && cruzam(a, b);
// Outra fonte de tabela para o mesmo modelo, a mesma cilindrada e anos que se cruzam, com litros diferentes (>= 0,3 L)
// ou sem nenhuma viscosidade em comum (pedido do Danilo em 16/11/2026: "menos dúvidas no catálogo", Onix 5W30 x 0W20).
// Devolve { linha, tipo: "litros" | "viscosidade" } ou null.
const parceiraDivergente = (a, linhas) => {
  const ca = cilindradas(a); if (!ca || !eTabela(a)) return null;
  const la = litrosNum(a.litros);
  for (const b of linhas) {
    if (b === a || !mesmoMotor(a, b)) continue;
    if (la && litrosNum(b.litros) && Math.abs(litrosNum(b.litros) - la) >= 0.3) return { linha: b, tipo: "litros" };
    if (!mesmaViscosidade(a, b)) return { linha: b, tipo: "viscosidade" };
  }
  return null;
};
// Marca "divergente" a linha de óleo que tem outra fonte discordando (texto para a tela: "Texaco 2022 indica 0W20").
export function marcarDivergencias(linhas) {
  return linhas.map(a => { const d = parceiraDivergente(a, linhas); return d ? { ...a, divergente: d.linha.fonte + " indica " + (d.tipo === "litros" ? d.linha.litros + " L" : d.linha.viscosidade) } : a; });
}

// Pedido do Danilo em 14/11/2026: "temos que eliminar essa divergência, na dúvida exclua o mais duvidoso e o mais antigo".
// Quando duas tabelas discordam, fica a mais recente e mais confiável; a outra é descartada. Ordem (da mais duvidosa para a melhor):
// Petronas 2014 (a mais antiga) < Ipiranga/Maxon (mesma base, "sem data, até ~2017"; o 2022 do Maxon é só a data da publicação) < Omnicraft/Motorcraft 2019 < Texaco 2022.
// Linha conferida pela oficina ou indicada por loja nunca é descartada. Só descarta quando existe a outra fonte para o mesmo modelo.
// Viscosidade (16/11/2026): a mesma regra, mas só quando as duas linhas falam do mesmo período (ou a mais antiga não tem período): período
// diferente costuma ser outra versão do motor (Onix 1.0 5 marchas 5W30 x 6 marchas 0W20), e aí as duas ficam e a tela mostra o aviso.
export const idadeFonte = f => /petronas/i.test(f) ? 0 : /ipiranga|maxon/i.test(f) ? 1 : /omnicraft|motorcraft/i.test(f) ? 2 : /texaco/i.test(f) ? 3 : 2;
const mesmoPeriodo = (velha, nova) => (!velha.de && !velha.ate) || ((velha.de || 0) === (nova.de || 0) && (velha.ate || 0) === (nova.ate || 0));
export function podarDivergencias(linhas) {
  const grupos = new Map();
  for (const r of linhas) { const k = r.montadora + "|" + cilindradas(r); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  const fora = new Set();
  for (const g of grupos.values()) {
    if (g.length < 2) continue;
    for (const a of g) for (const b of g) {
      if (a === b || !eTabela(a) || !eTabela(b) || idadeFonte(a.fonte) >= idadeFonte(b.fonte)) continue;
      const d = parceiraDivergente(a, [b]);
      if (d && (d.tipo === "litros" || mesmoPeriodo(a, b))) fora.add(a);
    }
  }
  return linhas.filter(r => !fora.has(r));
}

// Resumo do óleo para a tela (pedido do Danilo em 14/11/2026: "algo mais resumido"): uma linha por resposta diferente.
// Linhas com os mesmos litros e a mesma viscosidade viram uma só (conta quantas fontes concordam); a linha de tabela com erro
// conhecido (tem aviso) não entra no resumo, só nos detalhes. Devolve [{ litros, viscosidade, linha, fontes, divergente }].
export const linhaSuspeita = r => eTabela(r) && !!r.aviso;
// Pedido do Danilo em 14/11/2026: "entregar o mais próximo do ano e o mais confiável". Com o ano do carro, a resposta de cima é a da linha
// cujo período está mais perto do ano (período curto e que contém o ano ganha de "em diante" e de linha sem ano); empate: a conferida pela
// oficina, depois a fonte mais nova, depois a resposta em que mais fontes concordam.
const distanciaAno = (r, ano) => !ano ? 0 : (!r.de && !r.ate) ? 1000 : ((r.ate || ano + 40) - (r.de || ano - 40));
const contemAno = (r, ano) => !ano || (!r.de && !r.ate) ? 0 : ((r.de || 0) <= ano && ano <= (r.ate || 9999) ? 0 : 1);
// 16/11/2026: linha cujo período contém o ano vem antes de linha que não contém; o período mais curto continua ganhando da fonte mais nova
// (a tabela mais nova às vezes estica o período: a Texaco põe o Onix 3 cilindros "2015 a 2021", e ele só existe desde 2020).
const melhorLinha = (a, b, ano) => (eTabela(a) - eTabela(b)) || contemAno(a, ano) - contemAno(b, ano) || distanciaAno(a, ano) - distanciaAno(b, ano) || idadeFonte(b.fonte) - idadeFonte(a.fonte);
export function resumoOleo(linhas, ano) {
  const grupos = new Map();
  for (const r of linhas) {
    if (linhaSuspeita(r)) continue;
    const k = litrosNum(r.litros) + "|" + norm(r.viscosidade).split(/\s+ou\s+/).sort().join("/");
    const g = grupos.get(k) || { litros: r.litros, viscosidade: r.viscosidade, linha: r, familias: new Set(), divergente: false };
    if (melhorLinha(r, g.linha, ano) < 0) g.linha = r; // a linha que representa a resposta é a mais próxima do ano e mais confiável
    g.familias.add(familia(r.fonte)); g.divergente = eTabela(g.linha) && (g.divergente || !!r.divergente); grupos.set(k, g); // linha conferida pela oficina não leva o selo de divergente
  }
  return [...grupos.values()].map((g, i) => ({ litros: g.litros, viscosidade: g.viscosidade, linha: g.linha, fontes: g.familias.size, divergente: g.divergente, _i: i }))
    .sort((a, b) => melhorLinha(a.linha, b.linha, ano) || b.fontes - a.fontes || a._i - b._i).map(({ _i, ...g }) => g);
}

// Pedido do Danilo em 16/11/2026: "que apareça um sinal de atenção com a questão no sistema". Quando o resumo tem, para o mesmo motor
// (mesma cilindrada; turbo e aspirado contam juntos), respostas sem nenhuma viscosidade em comum, devolve o texto do aviso (a resposta de cima é a do catálogo
// mais atual; as outras são listadas com o motor/versão e a fonte, para a pessoa conferir no manual). Sem a questão, devolve "".
export function avisoOleo(resumo) {
  const top = resumo[0]; if (!top) return "";
  const t = top.linha, ct = cilindradas(t);
  const outras = resumo.slice(1).filter(g => { const l = g.linha; return (!ct || cilindradas(l) === ct) && cruzam(l, t) && !mesmaViscosidade(l, t); });   // turbo x aspirado entra de propósito: é a dúvida mais comum (Onix 1.0)
  if (!outras.length) return "";
  const desc = g => g.viscosidade + " (" + [g.linha.motor, periodoTexto(g.linha), g.linha.fonte].filter(Boolean).join(" · ") + ")";
  const maisNova = outras.every(g => idadeFonte(g.linha.fonte) <= idadeFonte(t.fonte));
  return "Atenção: o catálogo traz viscosidades diferentes para este modelo. A resposta de cima, " + top.viscosidade + ", é a que melhor casa com o ano" + (maisNova ? " e vem do catálogo mais atual" : "") + " ("
    + [t.motor, periodoTexto(t), t.fonte].filter(Boolean).join(" · ") + "). Também aparece " + outras.map(desc).join(" e ") + ". Confira a versão do motor no manual ou na etiqueta do carro.";
}

// ---------- Busca pela placa: do veículo (cadastro ou consulta da placa) para a pesquisa, por PALAVRAS-CHAVE ----------
// O modelo vem escrito de muitos jeitos ("PRISMA 1.4MT LT", "HILUX CD4X4 SRV", "I/TOYOTA COROLLA XEI20FLEX"). Em vez de comparar o texto
// inteiro, tiramos as palavras-chave: marca, nome do modelo, cilindrada (do modelo ou do campo motor) e ano; o resto (versão, turbo,
// 16v, combustível) só ajuda a pôr a linha certa na frente. Se a combinação mais exigente não acha nada, afrouxa: sem a marca, depois sem
// a cilindrada. Devolve { r, consulta, ano, entendido, chaves } — "entendido" é o que a tela mostra para a pessoa conferir.
// Cadastro escrito do jeito do documento do carro ("VW/GOL 1.0 GIV", "CHEV/ONIX JOY/CHEV/ONIX JOY", "M.BENZ313CDI/SPRINTERF", "TOYOTA HILUX" na marca Ford):
// tira o prefixo da marca antes da barra, a marca escrita no começo do modelo e corrige os erros de digitação mais comuns de modelo.
const MARCAS_NO_MODELO = new Set(["vw", "gm", "chev", "chevrolet", "volkswagen", "volks", "hyundai", "toyota", "fiat", "ford", "honda", "renault", "nissan", "jeep", "peugeot", "citroen", "mitsubishi", "kia", "bmw", "audi", "iveco", "ivecofiat", "m.benz", "mbenz", "mercedes", "lr", "chery", "caoa"]);
export function limparModelo(m) {
  m = m.replace(/^i\s*\/\s*/, "");
  const partes = m.split("/").map(x => x.trim()).filter(Boolean);
  // "marca/modelo...": a parte da esquerda é só a marca (uma palavra, sem número de cilindrada) e some; o que vem depois de uma segunda barra é repetição
  if (partes.length > 1 && /^[a-z][a-z0-9.\-]{0,13}$/.test(partes[0]) && !/\d\.\d/.test(partes[0])) m = partes[1];
  return m;
}
const ALIAS_MODELO = { hillux: ["hilux"], hiluxsw4: ["hilux", "sw4"], swsrxa4rd: ["hilux", "sw4"], corola: ["corolla"], ecosporte: ["ecosport"], crosfox: ["crossfox"], paratti: ["parati"], ideia: ["idea"], disc: ["discovery"], sprinterf: ["sprinter"] };
const STEMS_MODELO = ["sprinter", "daily"];   // "516 SPRINTER", "312D SPRINTER M", "DAILY4912 VAN1": o nome do modelo é a palavra-raiz
function apelidarModelo(t) {
  if (t.some(x => /^[3-5]\d\dcdi/.test(x))) return ["sprinter", ...t.filter(x => !/^[3-5]\d\dcdi/.test(x))];   // "311CDISTREETC", "313CDI": Sprinter
  const st = STEMS_MODELO.find(w => t.some(x => x.startsWith(w)));
  if (st) return [st, ...t.filter(x => !x.startsWith(st) && !/^\d{3}[a-z]?$/.test(x))];
  const a = ALIAS_MODELO[t[0]];
  return a ? [...a, ...t.slice(1)] : t;
}
const COMECO_COMPOSTO = new Set(["novo", "nova", "new", "grand", "gran", "grande", "land", "range", "santa", "monte", "pick", "space", "cross"]);
const SEM_VALOR = new Set(["mt", "at", "aut", "mec", "cv", "hp", "de", "da", "do", "e", "c", "com", "p", "4p", "2p", "5p", "3p", "i", "imp"]);
export function chavesDoVeiculo(v) {
  const marca = [...new Set(norm(v.marca).replace(/^i\s*\/\s*/, "").split(/[^a-z0-9]+/).filter(x => x.length > 1).map(x => APELIDOS[x] || x))].slice(0, 2);
  let m = limparModelo(norm(v.modelo)).replace(/(\d),(\d)/g, "$1.$2")
    .replace(/(\d\.\d)(?=[a-z])/g, "$1 ").replace(/([a-z])(\d\.\d)/g, "$1 $2");   // "1.4MT" → "1.4 MT"; "XEI2.0" → "XEI 2.0"
  let t = m.split(/[^a-z0-9.]+/).filter(Boolean);
  // "TOYOTA COROLLA": a marca veio repetida no modelo; "T/CITROEN C4", "I/TOYOTA COROLLA": letra de importado e marca na frente
  while (t.length > 1 && (t[0].length === 1 || MARCAS_NO_MODELO.has(t[0]) || (marca.length && marca.includes(APELIDOS[t[0]] || t[0])))) t = t.slice(1);
  t = apelidarModelo(t);
  const nome = t.length > 1 && COMECO_COMPOSTO.has(t[0]) ? [t[0], t[1]] : t.slice(0, 1);
  const resto = t.slice(nome.length);
  let cil = (resto.find(x => /^\d\.\d$/.test(x)) || "");
  // cilindrada sem ponto, como vem do documento: "ONIX 10MT", "SANDERO EXPR 10", "COROLLA XEI20FLEX" → 1.0, 1.0, 2.0
  if (!cil) { const g = resto.map(x => x.match(/^(?:[a-z]{2,})?([1-6])(\d)(?:mt|at|m|a|t|flex|fl|tb|glx?\d?p?|gls)?$/)).find(Boolean); if (g) cil = g[1] + "." + g[2]; }
  if (!cil) { const mm = String(v.motor || "").replace(",", ".").match(/(?<![\d.])(\d\.\d)(?!\d)/) || String(v.motor || "").match(/(?<!\d)([1-6])(\d)\d{2}(?!\d)/); if (mm) cil = mm[2] !== undefined ? mm[1] + "." + mm[2] : mm[1]; }
  const comb = norm(v.combustivel), diesel = /diesel/.test(comb) || /diesel|\btdi\b|\bcrdi\b/.test(m) ? true : comb && /flex|gasolina|etanol|alcool|gnv/.test(comb) ? false : null;
  const extras = resto.filter(x => x !== cil && x.length > 1 && !SEM_VALOR.has(x) && !/^\d+[a-z]{0,4}$/.test(x) || /^\d{1,2}v$/.test(x));
  const anos = String(v.ano_mod || v.ano || v.ano_fab || "").match(/(19|20)\d\d/g) || [];
  return { marca, nome, cil, extras, diesel, ano: anos.length ? Number(anos[anos.length - 1]) : 0 };   // "2015/2016": vale o ano do modelo
}
export function pesquisarVeiculo(cat, v, anoCampo) {
  const c = chavesDoVeiculo(v), ano = Number(anoCampo) || c.ano;
  // "NOVO GOL": os catálogos de filtro não escrevem o "novo"; o nome que vale é a última palavra
  const base = c.nome.length > 1 && /^(novo|nova|new)$/.test(c.nome[0]) ? c.nome.slice(1) : c.nome;
  const extras = { palavras: c.extras, diesel: c.diesel, inteiras: base, turbo: E_TURBO.test(norm(v.modelo) + " " + norm(v.motor)) };
  if (!c.nome.length) return { r: null, consulta: "", ano, chaves: c, entendido: "" };
  const tentativas = [[...c.marca, ...base, c.cil], [...base, c.cil], [...c.marca, ...base], base].map(l => l.filter(Boolean).join(" "));
  let r = null, consulta = "";
  for (const q of [...new Set(tentativas)]) { const x = pesquisar(cat, q, ano, extras); if (x.oleo.length || x.filtros.length) { if (!r || (!r.filtros.length && x.filtros.length)) { r = x; consulta = q; } if (x.filtros.length && x.oleo.length) break; } }
  const entendido = [c.nome.join(" ").toUpperCase(), c.cil, c.diesel === true ? "diesel" : "", ano || ""].filter(Boolean).join(" ");
  return { r, consulta, ano, chaves: c, entendido };
}

export const periodoTexto = r => r.de && r.ate ? (r.de === r.ate ? String(r.de) : r.de + " a " + r.ate) : r.de ? r.de + " em diante" : r.ate ? "até " + r.ate : "";

// Estoque de filtros: código comparável → produtos do cadastro (a mesma peça pode estar em dois cadastros, com e sem "S/NF").
export function indiceEstoque(produtos) {
  const idx = new Map();
  for (const p of produtos || []) {
    if (p.tipo && p.tipo !== "produto") continue; if (p.ativo === false || !p.referencia) continue;
    if (!/filtr/i.test((p.categoria || "") + " " + (p.descricao || ""))) continue;
    const k = normCodigo(p.referencia); if (k.length < 3) continue;
    const e = idx.get(k) || { codigo: k, marca: "", qtd: 0, ids: [], descricao: p.descricao || "" };
    e.qtd += Math.max(0, Number(p.estoque_atual) || 0); e.ids.push(p.id);
    // a marca escrita na referência vale mais que o campo marca ("LX3544 MAHLE" cadastrado como MANN)
    const naRef = String(p.referencia).toUpperCase().match(/\b(MANN|TECFIL|MAHLE|BOSCH|VOX|WEGA|FRAM|WIX)\b/);
    if (!e.marca || naRef) e.marca = nomeMarca(naRef ? naRef[1] : p.marca || "");
    idx.set(k, e);
  }
  return idx;
}

// Todos os códigos equivalentes a um código de filtro, por marca: { Tecfil: [...], MANN: [...], "Toyota*": [...] }
export function equivalentes(cat, marca, codigo) {
  const k = normCodigo(codigo), tecs = cat.paraTecfil.get(k) || (chaveMarca(marca) === "tecfil" ? [String(codigo).toUpperCase()] : []);
  const out = {}; const poe = (m, c) => { const l = out[m] || (out[m] = []); if (!l.some(x => normCodigo(x) === normCodigo(c))) l.push(c); };
  poe(nomeMarca(marca), codigo);
  for (const t of tecs) { poe("Tecfil", t); for (const [mi, c] of cat.conv[t] || []) poe(nomeMarca(cat.marcasConv[mi]), c); }
  return out;
}

// O que mostrar para UM filtro de uma aplicação (ex.: o filtro de óleo da Hilux 2.8):
//   { codigos, estoque: [{marca, codigo, qtd}] | null, semSaldo: [...], principais: {Tecfil, MAHLE, MANN}, conversao: [{marca, codigos, original}] }
export function filtroParaMostrar(cat, estoque, marca, codigos) {
  if (!codigos || !codigos.length) return null;
  const eq = {};
  for (const c of codigos) for (const [m, l] of Object.entries(equivalentes(cat, marca, c))) for (const x of l) { const d = eq[m] || (eq[m] = []); if (!d.includes(x)) d.push(x); }
  const noEstoque = [], semSaldo = [], vistos = new Set();
  for (const [m, l] of Object.entries(eq)) for (const c of l) {
    const e = estoque && estoque.get(normCodigo(c)); if (!e || vistos.has(e.codigo)) continue; vistos.add(e.codigo);
    (e.qtd > 0 ? noEstoque : semSaldo).push({ marca: e.marca || m.replace(/\*$/, ""), codigo: c, qtd: e.qtd, ids: e.ids });
  }
  const principais = Object.fromEntries(MARCAS_PRINCIPAIS.map(m => [m, eq[m] || []]));
  const conversao = Object.entries(eq).filter(([m]) => noEstoque.length || !MARCAS_PRINCIPAIS.includes(m))
    .map(([m, l]) => ({ marca: m.replace(/\*$/, ""), original: m.endsWith("*"), codigos: l }))
    .sort((a, b) => (a.original - b.original) || (MARCAS_PRINCIPAIS.indexOf(b.marca) >= 0) - (MARCAS_PRINCIPAIS.indexOf(a.marca) >= 0) || a.marca.localeCompare(b.marca));
  return { codigos, estoque: noEstoque.length ? noEstoque : null, semSaldo, principais, conversao };
}
