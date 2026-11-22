// Corretor de escrita de oficina — o MESMO do app do mecânico (mecanico/app.js), agora como módulo para o
// App DTCar (app/telas.js) usar no pedido de orçamento. MUDOU UMA REGRA AQUI? Mude também a cópia do
// mecanico/app.js (ele não é módulo) e rode node teste/teste_corretor.mjs, que confere os casos nos dois.
// novoVocabulario(descricoes): descricoes = [{descricao, tipo}] das O.S. já lançadas (as mais novas);
// sem elas o corretor ainda funciona com o glossário fixo e as abreviações.
function semAcento(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
var PARADAS = { de: 1, 'do': 1, da: 1, dos: 1, das: 1, e: 1, o: 1, a: 1, os: 1, as: 1, com: 1, c: 1, p: 1, para: 1, no: 1, na: 1, em: 1, um: 1, uma: 1 };
var ABREV = { amort: 'amortecedor', amorts: 'amortecedores', amortec: 'amortecedor', diant: 'dianteiro', dian: 'dianteiro', tras: 'traseiro', dir: 'direito', esq: 'esquerdo', susp: 'suspensao',
  embr: 'embreagem', rolam: 'rolamento', rol: 'rolamento', hidr: 'hidraulica', comb: 'combustivel', past: 'pastilha', homoc: 'homocinetica', homo: 'homocinetica', estab: 'estabilizador',
  band: 'bandeja', term: 'terminal', alin: 'alinhamento', balanc: 'balanceamento', balan: 'balanceamento', corr: 'correia', cx: 'caixa', mot: 'motor', sup: 'superior', inf: 'inferior',
  bat: 'bateria', lamp: 'lampada', mang: 'mangueira', reserv: 'reservatorio', retent: 'retentor', filt: 'filtro', arref: 'arrefecimento', cabec: 'cabecote', valv: 'valvula', inj: 'injetor', radi: 'radiador' };
var GLOSSARIO = ('amortecedor amortecedores coxim batente coifa kit mola bieleta bandeja pivo bucha terminal barra axial estabilizador rolamento cubo homocinetica semieixo junta pastilha pastilhas disco discos ' +
  'tambor lona cilindro fluido freio flexivel pinca oleo filtro ar combustivel cabine vela velas cabo bobina correia dentada alternador tensor polia bomba agua radiador mangueira reservatorio aditivo ' +
  'valvula termostatica embreagem plato atuador volante caixa direcao hidraulica eletrica bateria lampada farol lanterna palheta limpador escapamento catalisador silencioso sensor sonda injetor bico ' +
  'corpo borboleta cabecote retentor carter motor cambio diferencial cruzeta alinhamento balanceamento cambagem suspensao dianteiro dianteira traseiro traseira direito direita esquerdo esquerda ' +
  'superior inferior substituicao subst troca trocar revisao limpeza regulagem diagnostico vazamento barulho arrefecimento').split(' ');
function distancia(a, b, limite) {
  if (Math.abs(a.length - b.length) > limite) return limite + 1;
  var ant = [], i, j;
  for (j = 0; j <= b.length; j++) ant[j] = j;
  for (i = 1; i <= a.length; i++) {
    var atual = [i], menor = i;
    for (j = 1; j <= b.length; j++) { atual[j] = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1)); if (atual[j] < menor) menor = atual[j]; }
    if (menor > limite) return limite + 1;
    ant = atual;
  }
  return ant[b.length];
}
function novoVocabulario(descricoes) {
  var freq = {}, frases = {};
  GLOSSARIO.forEach(function (w) { freq[w] = 5; });
  var voc = { freq: freq, frases: frases, lista: [] };
  (descricoes || []).forEach(function (d) { semAcento(d.descricao).split(/[^a-z0-9]+/).forEach(function (w) { if (w.length >= 2 && !/^\d+$/.test(w)) freq[w] = (freq[w] || 0) + 1; }); });
  voc.lista = Object.keys(freq).filter(function (w) { return freq[w] >= 3 && w.length >= 4; }).map(function (w) { return [w, freq[w]]; });
  // frases já usadas pela oficina, pela "chave" (palavras corrigidas, sem "de/do/com", em ordem): a escrita mais repetida é a que vale
  (descricoes || []).forEach(function (d) {
    var k = chaveFrase(voc, d.descricao); if (!k) return;
    var f = frases[k] || (frases[k] = { total: 0, escritas: {}, tipos: {} }), e = String(d.descricao).trim().toUpperCase();
    f.total++; f.escritas[e] = (f.escritas[e] || 0) + 1; f.tipos[d.tipo] = (f.tipos[d.tipo] || 0) + 1;
  });
  return voc;
}
function corrigirPalavra(voc, palavra) {
  var w = semAcento(palavra);
  if (!w || PARADAS[w] || /\d/.test(w)) return w;
  if (ABREV[w]) return ABREV[w];
  var f = voc.freq[w] || 0, melhor = null, i, x;
  if (f >= 3) return w;
  if (w.length >= 4) {   // começo de palavra ("amortec", "bielet")
    for (i = 0; i < voc.lista.length; i++) { x = voc.lista[i]; if (x[0].length >= w.length + 2 && x[0].indexOf(w) === 0 && (!melhor || x[1] > melhor[1])) melhor = x; }
    if (melhor) return melhor[0];
  }
  if (w.length >= 5) {   // pedaço de palavra ("ortecedor") e letra trocada ("amortesedor")
    for (i = 0; i < voc.lista.length; i++) { x = voc.lista[i]; if (x[0].length - w.length <= 3 && x[0].length > w.length && x[0].indexOf(w) >= 0 && (!melhor || x[1] > melhor[1])) melhor = x; }
    if (melhor) return melhor[0];
    var limite = w.length >= 8 ? 2 : 1, dMelhor = limite + 1;
    for (i = 0; i < voc.lista.length; i++) { x = voc.lista[i]; var dd = distancia(w, x[0], limite); if (dd < dMelhor || (dd === dMelhor && dd <= limite && melhor && x[1] > melhor[1])) { dMelhor = dd; melhor = x; } }
    if (melhor && dMelhor <= limite) return melhor[0];
  }
  return w;
}
function palavrasDe(t) { return String(t).trim().split(/\s+/).map(function (x) { return x.replace(/^[^0-9A-Za-zÀ-ÿ]+|[^0-9A-Za-zÀ-ÿ]+$/g, ''); }).filter(Boolean); }
var FEMININO = { dianteiro: 'dianteira', traseiro: 'traseira', direito: 'direita', esquerdo: 'esquerda' };
var NAO_E_A_PECA = { subst: 1, substituicao: 1, troca: 1, trocar: 1, kit: 1, jogo: 1, par: 1, mo: 1, m: 1, limpeza: 1, revisao: 1, regulagem: 1 };
function corrigirFrase(voc, t) {
  var ps = palavrasDe(t), abreviada = [];
  var out = ps.map(function (x, i) { if (/[\/.]/.test(x) && !/^[A-Za-zÀ-ÿ]+$/.test(x)) return semAcento(x); abreviada[i] = !!ABREV[semAcento(x)]; return corrigirPalavra(voc, x); });
  // "pastilha diant" → dianteira: a abreviação concorda com a peça (primeira palavra que não é "subst", "kit", "de"…)
  var peca = out.filter(function (w) { return !PARADAS[w] && !NAO_E_A_PECA[w]; })[0] || '';
  if (/a$/.test(peca)) out = out.map(function (w, i) { return abreviada[i] && FEMININO[w] ? FEMININO[w] : w; });
  return out.join(' ').toUpperCase();
}
function chaveFrase(voc, t) {
  return semAcento(t).split(/[^a-z0-9]+/).filter(function (w) { return w && !PARADAS[w]; }).map(function (w) { return ABREV[w] || w; }).sort().join(' ');
}

export { semAcento, novoVocabulario, corrigirPalavra, corrigirFrase, chaveFrase, palavrasDe, GLOSSARIO, ABREV, PARADAS };
