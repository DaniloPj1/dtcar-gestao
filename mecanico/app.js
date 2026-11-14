// DTCar Mecânico — ETAPA 1: login real e LEITURA dos dados reais (O.S. em que o usuário é o técnico, cadastro de veículos,
// catálogo de óleo). NADA do que é feito no app é gravado no banco: apontamentos, orçamento e KM ficam só na tela.
// Este arquivo tem duas partes: (1) um desenhador pequeno, que monta a tela a partir do modelo
// que está no index.html (<template id="tela">); (2) a lógica das telas (class Component).
(function () {
"use strict";

// ---------- (1) desenhador ----------
var app = document.getElementById("app");
var modelo = document.getElementById("tela").content;
var INTEIRO = /^\s*\{\{([^}]+)\}\}\s*$/;
var instancia = null, desenhando = false, pendente = false, chaveTela = "";

function olhar(escopo, caminho) {
  caminho = caminho.trim();
  if (caminho === "true") return true;
  if (caminho === "false") return false;
  var partes = caminho.split("."), v = escopo;
  for (var i = 0; i < partes.length; i++) { if (v == null) return undefined; v = v[partes[i]]; }
  return v;
}
function texto(escopo, t) {
  return t.replace(/\{\{([^}]+)\}\}/g, function (_, c) { var v = olhar(escopo, c); return v == null ? "" : String(v); });
}
function ligar(el, tipo) {
  el.addEventListener(tipo, function (e) { var h = el.__h && el.__h[tipo]; if (h) h(e); });
}
function montar(no, escopo, pai) {
  if (no.nodeType === 3) { pai.appendChild(document.createTextNode(texto(escopo, no.data))); return; }
  if (no.nodeType !== 1) return;
  var nome = no.localName, i, filhos = no.childNodes;
  if (nome === "sc-if") {
    var m0 = INTEIRO.exec(no.getAttribute("value") || "");
    if (m0 && olhar(escopo, m0[1])) for (i = 0; i < filhos.length; i++) montar(filhos[i], escopo, pai);
    return;
  }
  if (nome === "sc-for") {
    var m1 = INTEIRO.exec(no.getAttribute("list") || ""), lista = (m1 && olhar(escopo, m1[1])) || [], como = no.getAttribute("as") || "item";
    lista.forEach(function (item, idx) {
      var e2 = Object.create(escopo); e2[como] = item; e2.$index = idx;
      for (var j = 0; j < filhos.length; j++) montar(filhos[j], e2, pai);
    });
    return;
  }
  var el = document.createElementNS(no.namespaceURI, nome);
  el.__h = {};
  for (i = 0; i < no.attributes.length; i++) {
    var a = no.attributes[i], n = a.name, m = INTEIRO.exec(a.value);
    if (n.indexOf("hint-") === 0) continue;
    if (n.indexOf("on") === 0 && m) {
      var tipo = n.slice(2).toLowerCase(); if (tipo === "change") tipo = "input";
      var fn = olhar(escopo, m[1]); if (typeof fn === "function") el.__h[tipo] = fn;
    } else if (m) {
      var v = olhar(escopo, m[1]);
      if (n === "value") el.__v = v == null ? "" : String(v);
      else if (v === true) el.setAttribute(n, "");
      else if (v !== false && v != null) el.setAttribute(n, String(v));
    } else el.setAttribute(n, texto(escopo, a.value));
  }
  for (i = 0; i < filhos.length; i++) montar(filhos[i], escopo, el);
  if ("__v" in el) el.value = el.__v;
  if (el.hasAttribute("muted")) el.muted = true;
  Object.keys(el.__h).forEach(function (t) { ligar(el, t); });
  pai.appendChild(el);
}
function tipos(el) { return el.__h ? Object.keys(el.__h).sort().join(",") : ""; }
// troca só o que mudou: mantém o cursor nos campos, a rolagem e o vídeo tocando
function ajustar(pai, velho, novo) {
  if (!velho) { pai.appendChild(novo); return; }
  if (velho.nodeType !== novo.nodeType || velho.nodeName !== novo.nodeName || tipos(velho) !== tipos(novo)) { pai.replaceChild(novo, velho); return; }
  if (velho.nodeType === 3) { if (velho.data !== novo.data) velho.data = novo.data; return; }
  var i, a;
  for (i = velho.attributes.length - 1; i >= 0; i--) { a = velho.attributes[i]; if (!novo.hasAttribute(a.name)) velho.removeAttribute(a.name); }
  for (i = 0; i < novo.attributes.length; i++) { a = novo.attributes[i]; if (velho.getAttribute(a.name) !== a.value) velho.setAttribute(a.name, a.value); }
  velho.__h = novo.__h;
  if ("__v" in novo) { velho.__v = novo.__v; if (velho.value !== novo.__v) velho.value = novo.__v; }
  var fv = Array.prototype.slice.call(velho.childNodes), fn = Array.prototype.slice.call(novo.childNodes);
  for (i = 0; i < Math.max(fv.length, fn.length); i++) {
    if (i >= fn.length) velho.removeChild(fv[i]); else ajustar(velho, fv[i], fn[i]);
  }
}
function desenhar() {
  if (desenhando) { pendente = true; return; }
  desenhando = true;
  try {
    do {
      pendente = false;
      var vals = instancia.renderVals(), caixa = document.createElement("div"), nos = modelo.childNodes;
      for (var i = 0; i < nos.length; i++) montar(nos[i], vals, caixa);
      var fv = Array.prototype.slice.call(app.childNodes), fn = Array.prototype.slice.call(caixa.childNodes);
      for (i = 0; i < Math.max(fv.length, fn.length); i++) { if (i >= fn.length) app.removeChild(fv[i]); else ajustar(app, fv[i], fn[i]); }
      var chave = ["telaLogin", "telaBloqueio", "telaLista", "telaVeiculo", "telaNova", "telaOleo"].map(function (k) { return vals[k] ? 1 : 0; }).join("") +
        "|" + (vals.d ? vals.d.placa : "") + "|" + (vals.n ? vals.n.passoNome : "");
      if (chave !== chaveTela) { chaveTela = chave; Array.prototype.forEach.call(app.querySelectorAll("div"), function (d) { if (d.scrollTop) d.scrollTop = 0; }); }
    } while (pendente);
  } finally { desenhando = false; }
}
function DCLogic(props) { this.props = props || {}; this.state = {}; }
DCLogic.prototype.setState = function (o) { this.state = Object.assign({}, this.state, o); if (instancia === this) desenhar(); };
DCLogic.prototype.forceUpdate = function () { if (instancia === this) desenhar(); };

// ---------- (2) lógica das telas ----------
function guardado(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
function guardar(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
// horário comercial do app: segunda a sábado, das 7h às 18h, pelo relógio de Brasília
function dentroDoHorario(agora) {
var p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false, weekday: 'short' }).formatToParts(agora || new Date());
var h = 0, dia = '';
p.forEach(function (x) { if (x.type === 'hour') h = Number(x.value) % 24; if (x.type === 'weekday') dia = x.value; });
return dia !== 'Sun' && h >= 7 && h < 18;
}
window.__dtcarHorario = dentroDoHorario;

// ---------- corretor da lista: abreviação e palavra errada viram a palavra que a oficina usa ----------
// O vocabulário vem das descrições já lançadas nas O.S. (carregado depois do login) mais um glossário fixo.
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
var E_SERVICO = /^(m\.?\s?o\b|mao de obra|subst|troca|trocar|revis|limpeza|limpar|regul|diagn|alinh|balanc|cambag|verific|conferir|reparo|reparar|remoc|remover|instal|montagem|desmont|aperto|sangria|scanner|teste)/;
window.__dtcarCorretor = { novo: novoVocabulario, palavra: corrigirPalavra, frase: corrigirFrase };
class Component extends DCLogic {
constructor(props) {
super(props);
var agora = Date.now();
this.state = {
carregando: false, erroCarga: '', usuario: null, emailSalvo: guardado('dtcar-mecanico-email'), nomeSalvo: guardado('dtcar-mecanico-nome'), emailInput: '', entrando: false, tecnicos: [], pecasOSAberto: false, cat: null, catErro: '',
aba: 'veiculos', aberto: null, folha: null, itemFolha: null,
kmInput: '', kmErro: '', busca: '', aviso: '', nova: null, proxOS: 1924, proxORC: 57, editando: false, addTexto: '', addOuvindo: false, foraWifi: false, notifs: [], admIdx: 0, logado: false, bloqueado: false, senha: '', loginMotivo: '', svAberto: null,
veic: []
};
}
componentWillUnmount() {
clearTimeout(this._a);
clearTimeout(this._f);
}
componentDidMount() {
var self = this, cfg = window.DTCAR_CONFIG || {};
if (!window.supabase || !cfg.SUPABASE_URL) { this.avisar('Sem conexão com o sistema.'); return; }
// guarda o login em separado do sistema principal: sair do app não tira o login do DTCar Gestão neste aparelho
this.sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { storageKey: 'dtcar-mecanico-auth', persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
this.sb.auth.getSession().then(function (r) {
var sessao = r && r.data && r.data.session;
if (!sessao) return;
if (!dentroDoHorario()) { self.encerrar('Fora do horário comercial (7h às 18h). Digite sua senha para entrar.'); return; }
self.entrouNoHorario = true; self.aposLogin(sessao.user);
});
// virou 18h com o app aberto: sai e pede a senha
this._h = setInterval(function () { if (self.state.logado && self.entrouNoHorario && !dentroDoHorario()) self.encerrar('Fora do horário comercial (7h às 18h). Digite sua senha para entrar.'); }, 60000);
}
encerrar(motivo) {
if (this.sb) this.sb.auth.signOut({ scope: 'local' }).catch(function () {});
this.setState({ logado: false, usuario: null, senha: '', veic: [], aberto: null, nova: null, folha: null, notifs: [], loginMotivo: motivo || '' });
}
aposLogin(user) {
var self = this;
this.sb.from('perfis').select('id,nome,papel,ativo').eq('id', user.id).maybeSingle().then(function (r) {
var pf = r.data;
if (r.error) { self.setState({ entrando: false }); self.avisar('Não consegui conferir o seu acesso. Tente de novo.'); return; }
if (!pf || pf.ativo === false || pf.papel !== 'admin') { self.setState({ entrando: false }); self.encerrar(''); self.avisar('Por enquanto o app está liberado só para o administrador.'); return; }
var nome = pf.nome || user.email, primeiro = nome.split(' ')[0];
guardar('dtcar-mecanico-email', user.email); guardar('dtcar-mecanico-nome', primeiro);
self.setState({ logado: true, entrando: false, senha: '', loginMotivo: '', emailSalvo: user.email, nomeSalvo: primeiro, usuario: { id: pf.id, nome: nome, primeiro: primeiro } });
self.carregar(); self.carregarVocabulario();
});
}
carregar() {
var self = this, u = this.state.usuario; if (!u) return;
this.setState({ carregando: true, erroCarga: '' });
var MAPA = { diagnostico: 'orcamento', aguardando: 'orcamento', execucao: 'aguardando', pronto: 'finalizado' };
this.sb.from('ordens').select('id,numero,status,cliente,veiculo,km_entrada,km_saida,reclamacao').eq('mecanico_id', u.id).in('status', Object.keys(MAPA)).order('numero', { ascending: false }).limit(60).then(function (r) {
if (r.error) throw r.error;
var ordens = r.data || [];
if (!ordens.length) return { ordens: ordens, itens: [] };
// sem preço: o app do mecânico não lê valores
return self.sb.from('os_itens').select('id,ordem_id,tipo,descricao,qtd,aprovado,executado,posicao').in('ordem_id', ordens.map(function (o) { return o.id; })).order('posicao').then(function (ri) {
if (ri.error) throw ri.error; return { ordens: ordens, itens: ri.data || [] };
});
}).then(function (x) {
var locais = self.state.veic.filter(function (v) { return !v.real; });   // orçamentos de teste criados no app continuam na tela
var reais = x.ordens.map(function (o) {
var vj = o.veiculo || {}, its = x.itens.filter(function (i) { return i.ordem_id === o.id && i.aprovado !== false; });
var qtd = function (i) { var n = Number(i.qtd) || 0; return n && n !== 1 ? ' · ' + String(n).replace('.', ',') : ''; };
return { id: o.id, real: true, placa: String(vj.placa || '').toUpperCase(), modelo: [vj.marca, vj.modelo, vj.ano].filter(Boolean).join(' '), dadosVeiculo: vj, os: String(o.numero), orc: '', queixa: o.reclamacao || '',
kmEntrada: o.km_entrada || 0, status: MAPA[o.status], acumulado: 0, inicio: null, motivo: '', kmFinal: o.km_saida || null,
itens: its.filter(function (i) { return i.tipo !== 'peca'; }).map(function (i) { return { id: i.id, nome: i.descricao, qtd: '', tipo: i.tipo === 'terceiro' ? 'Serviço de terceiro' : 'Serviço', feito: !!i.executado, por: '' }; }),
pecasOS: its.filter(function (i) { return i.tipo === 'peca'; }).map(function (i) { return i.descricao + qtd(i); }) };
});
self.setState({ veic: locais.concat(reais), carregando: false });
}).catch(function (e) { self.setState({ carregando: false, erroCarga: 'Não consegui carregar as O.S. Confira a internet e toque em Atualizar.' }); });
this.sb.rpc('tecnicos_lista').then(function (r) {
if (r.error || !r.data) return;
self.setState({ tecnicos: r.data.filter(function (t) { return t.perfil_id !== u.id; }).map(function (t) { return (t.apelido || t.nome || '').split(' ')[0]; }).filter(Boolean) });
});
}
carregarVocabulario() {
var self = this;
if (this._voc) return; this._voc = true;
var pagina = function (n) { return self.sb.from('os_itens').select('descricao,tipo').order('criado_em', { ascending: false }).range(n * 1000, n * 1000 + 999).then(function (r) { if (r.error) throw r.error; return r.data || []; }); };
Promise.all([pagina(0), pagina(1), pagina(2)]).then(function (ps) { self.voc = novoVocabulario(ps[0].concat(ps[1], ps[2])); })
.catch(function () { self._voc = false; });
}
buscarPlacaOleo(pl) {
var self = this;
this._placas = this._placas || {};
if (this._placas[pl]) return;
this._placas[pl] = { estado: 'buscando' };
var fim = function (o) { self._placas[pl] = o; self.forceUpdate(); };
this.sb.from('veiculos').select('placa,marca,modelo,ano,motor,combustivel').eq('placa', pl).limit(1).then(function (r) {
var vc = r.data && r.data[0];
if (vc) { fim({ estado: 'ok', origem: 'cadastro', dados: vc }); return; }
return self.sb.functions.invoke('placa', { body: { acao: 'basico', placa: pl } }).then(function (rp) {
var x = rp && rp.data, dd = x && x.dados;
if (!x || x.ok !== true || !x.encontrado || !dd) { fim({ estado: 'erro', msg: (x && x.erro) || 'Não achei essa placa.' }); return; }
var ano = dd.ano_fab && dd.ano_mod && dd.ano_fab !== dd.ano_mod ? dd.ano_fab + '/' + dd.ano_mod : (dd.ano_mod || dd.ano_fab || '');
fim({ estado: 'ok', origem: 'consulta', dados: { placa: pl, marca: dd.marca, modelo: dd.modelo, ano: String(ano), motor: dd.motor, combustivel: dd.combustivel } });
});
}).catch(function () { delete self._placas[pl]; fim({ estado: 'erro', msg: 'Sem resposta. Confira a internet.' }); delete self._placas[pl]; });
}
carregarCatalogo() {
var self = this;
if (this._cat) return; this._cat = true;
import('../js/catalogo.js').then(function (m) { self.catMod = m; return m.carregarCatalogo(); }).then(function (cat) { self.setState({ cat: cat }); })
.catch(function () { self._cat = false; self.setState({ catErro: 'Não consegui carregar o catálogo de óleo.' }); });
}
ouvir(aoTerminar) {
var R = window.SpeechRecognition || window.webkitSpeechRecognition, self = this;
if (!R) { this.avisar('Este navegador não tem ditado. Abra o app pelo Chrome ou use o microfone do teclado.'); return false; }
if (navigator.onLine === false) { this.avisar('O ditado precisa de internet.'); return false; }
var MOTIVO = { 'not-allowed': 'O microfone está bloqueado para este app. Libere em Configurações do site › Microfone.', 'service-not-allowed': 'O ditado está desligado neste celular. Use o microfone do teclado.',
  'no-speech': 'Não ouvi nada. Fale perto do celular e tente de novo.', 'audio-capture': 'Não achei o microfone do celular.', network: 'O ditado precisa de internet.', 'language-not-supported': 'Este celular não tem ditado em português.' };
var comecar = function () {
var r = new R(), falou = false; r.lang = 'pt-BR'; r.interimResults = false; r.maxAlternatives = 1; r.continuous = false;
r.onresult = function (e) { var t = ''; for (var i = 0; i < e.results.length; i++) t += e.results[i][0].transcript + ' '; falou = true; aoTerminar(t.trim()); };
r.onerror = function (e) { falou = true; aoTerminar(''); self.avisar(MOTIVO[e.error] || 'Não consegui ouvir (' + e.error + '). Use o microfone do teclado.'); };
r.onend = function () { aoTerminar(null); if (!falou) self.avisar(MOTIVO['no-speech']); };
try { r.start(); } catch (e) { aoTerminar(null); self.avisar('Não consegui ligar o ditado. Use o microfone do teclado.'); }
};
// pede a permissão do microfone antes: sem isso, no app instalado o ditado pode falhar calado
if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
navigator.mediaDevices.getUserMedia({ audio: true }).then(function (fluxo) { fluxo.getTracks().forEach(function (t) { t.stop(); }); comecar(); })
.catch(function () { aoTerminar(null); self.avisar(MOTIVO['not-allowed']); });
} else comecar();
return true;
}
entenderTexto(texto) {
var voc = this.voc || (this._vocBase = this._vocBase || novoVocabulario([]));
var out = [], vistos = {}, id = 1;
String(texto).split(/[,;\n]+|\s+e\s+|\.(?=\s|$)/).forEach(function (f) {
var t = f.trim(); if (!t) return;
var corrigida = corrigirFrase(voc, t), usada = voc.frases[chaveFrase(voc, corrigida)], nome = corrigida, tipo;
if (usada) {   // a oficina já lançou exatamente isso: usa a escrita mais repetida
nome = Object.keys(usada.escritas).sort(function (x, y) { return usada.escritas[y] - usada.escritas[x]; })[0];
tipo = (usada.tipos.peca || 0) >= (usada.tipos.servico || 0) + (usada.tipos.terceiro || 0) ? 'Peça' : 'Serviço';
} else tipo = E_SERVICO.test(semAcento(corrigida)) ? 'Serviço' : 'Peça';
var estranha = palavrasDe(corrigida).some(function (w) { w = semAcento(w); return w.length >= 4 && !/\d/.test(w) && !PARADAS[w] && !(voc.freq[w] > 0); });
if (vistos[nome]) return; vistos[nome] = 1;
out.push({ id: id++, disse: t, nome: nome, tipo: estranha ? 'Conferir a escrita: palavra que a oficina ainda não usou' : tipo, conferir: estranha });
});
return out;
}
mudar(id, fn) {
this.setState({ veic: this.state.veic.map(function (v) { return v.id === id ? fn(v) : v; }) });
}
avisar(msg) {
var self = this;
clearTimeout(this._a);
this.setState({ aviso: msg });
this._a = setTimeout(function () { self.setState({ aviso: '' }); }, 2800);
}
renderVals() {
var self = this, s = this.state, eu = s.usuario ? s.usuario.primeiro : 'Você';
var ST = {
orcamento: { nome: 'Orçamento enviado', bg: '#fff0cc', fg: '#6b4300' },
recusado: { nome: 'Recusado', bg: '#fbe3e0', fg: '#8f1d14' },
aguardando: { nome: 'Aguardando início', bg: '#f1e4ff', fg: '#4b2a80' },
andamento: { nome: 'Em andamento', bg: '#e1ebf7', fg: '#174f94' },
pausado: { nome: 'Pausado', bg: '#e1e4e8', fg: '#33383f' },
finalizado: { nome: 'Finalizado', bg: '#dff2e4', fg: '#17592c' }
};
var seg = function (v) { return Math.floor(v.acumulado + (v.inicio ? (Date.now() - v.inicio) / 1000 : 0)); };
var p2 = function (n) { return String(n).padStart(2, '0'); };
var hora = function (ts) { var dt = new Date(ts); return p2(dt.getHours()) + ':' + p2(dt.getMinutes()); };
var km = function (n) { return n == null ? '' : n.toLocaleString('pt-BR'); };
var SV = [
[/[oó]leo|filtro/i, 'Subst. de óleo e filtros'],
[/pastilha.*tras/i, 'Subst. de pastilhas de freio traseiras'], [/pastilha/i, 'Subst. de pastilhas de freio dianteiras'],
[/disco/i, 'Subst. de discos de freio dianteiros'], [/fluido de freio/i, 'Troca do fluido de freio'],
[/amortecedor.*tras/i, 'Subst. de amortecedores traseiros'], [/amortecedor/i, 'Subst. de amortecedores dianteiros'],
[/bieleta/i, 'Subst. de bieletas dianteiras'], [/suspens/i, 'Diagnóstico de suspensão'],
[/alinhamento/i, 'Alinhamento de direção'], [/balanceamento/i, 'Balanceamento'], [/correia/i, 'Subst. de correia dentada'],
[/bateria/i, 'Subst. de bateria'], [/vela/i, 'Subst. de velas de ignição'], [/arrefec/i, 'Troca do líquido de arrefecimento']
];
var servicoDe = function (nome) { for (var k = 0; k < SV.length; k++) { if (SV[k][0].test(nome)) return SV[k][1]; } return nome.charAt(0).toUpperCase() + nome.slice(1); };
var paraServicos = function (itens, jaTem, nota) {
var vistos = {}, out = []; (jaTem || []).forEach(function (n0) { vistos[n0] = 1; });
var mapa = {};
itens.forEach(function (i) { var n1 = servicoDe(i.nome); if (vistos[n1] && !mapa[n1]) return; if (!mapa[n1]) { vistos[n1] = 1; self._s = (self._s || 100) + 1; mapa[n1] = { id: self._s, nome: n1, qtd: '', tipo: 'Serviço', feito: false, por: '', nota: nota || '', pecas: [] }; out.push(mapa[n1]); } if (i.tipo !== 'Serviço') mapa[n1].pecas.push(i.nome); });
return out;
};
var notificar = function (titulo, texto, veicId) { self._n = (self._n || 0) + 1; self.setState({ notifs: [{ id: self._n, titulo: titulo, texto: texto, veicId: veicId }].concat(self.state.notifs) }); };
var docDe = function (v) { return v.os ? 'O.S. ' + v.os : 'ORC ' + v.orc; };
var prog = function (v) { var ok = v.itens.filter(function (i) { return !i.pend; }); var p = v.itens.length - ok.length; return ok.filter(function (i) { return i.feito; }).length + ' de ' + ok.length + (v.os ? (ok.length === 1 ? ' serviço' : ' serviços') : ' itens') + (p ? ' · ' + p + ' aguardando aprovação' : ''); };

var lista = s.veic.map(function (v) {
var st = ST[v.status];
return { placa: v.placa, modelo: v.modelo, doc: docDe(v), queixa: v.queixa, statusNome: st.nome, chipBg: st.bg, chipFg: st.fg, progresso: prog(v),
abrir: function () { self.setState({ aberto: v.id, editando: false, svAberto: null, pecasOSAberto: false }); } };
});

var v = s.veic.filter(function (x) { return x.id === s.aberto; })[0] || null;
var d = { orcTexto: '', simOrc: false, temPecasOS: false, pecasOSRotulo: '', pecasOSAberto: false, pecasOSTexto: '', tituloLista: '', simAdm: false, podeAdd: false, addRotulo: '', addAjuda: '', doc: '', recusado: false, editando: false, mostraEditar: false, editarTexto: '', placa: '', modelo: '', os: '', queixa: '', kmEntrada: '', statusNome: '', chipBg: '#fff', chipFg: '#000', linha: '', temLinha: false, orcamento: false, progresso: '', itens: [], equipe: '', motivo: '', kmFinal: '', mostraIniciar: false, mostraPausar: false, mostraRetomar: false, finalizado: false };
if (v) {
var st = ST[v.status];
var pode = v.status === 'andamento';
var editavel = v.status !== 'finalizado' && v.status !== 'recusado';
var emEdicao = v.status === 'orcamento';
var aprovada = v.status === 'aguardando' || v.status === 'andamento' || v.status === 'pausado';
var nomes = [];
v.itens.forEach(function (i) { if (i.feito && i.por && nomes.indexOf(i.por) < 0) nomes.push(i.por); });
d = {
doc: docDe(v), recusado: v.status === 'recusado', editando: emEdicao, mostraEditar: false, editarTexto: '', tituloLista: v.os ? 'Serviços da O.S.' : 'Minha lista', simAdm: aprovada && !v.real, simOrc: !v.real, orcTexto: v.real ? 'Orçamento no sistema. Aguardando aprovação.' : 'Orçamento de teste (não foi salvo no sistema).',
temPecasOS: !!(v.pecasOS && v.pecasOS.length), pecasOSRotulo: s.pecasOSAberto ? 'Ocultar peças da O.S.' : 'Ver peças da O.S. (' + (v.pecasOS ? v.pecasOS.length : 0) + ')', pecasOSAberto: s.pecasOSAberto, pecasOSTexto: (v.pecasOS || []).join('\n'), podeAdd: editavel, addRotulo: emEdicao ? '+ Adicionar item à lista' : '+ Sugerir serviço ao administrador', addAjuda: emEdicao ? 'Você pode alterar a lista enquanto for orçamento.' : 'Depois de aprovada, a lista só muda pelo sistema principal. Sua sugestão fica aguardando aprovação.',
placa: v.placa, modelo: v.modelo, os: v.os, queixa: v.queixa, kmEntrada: km(v.kmEntrada), statusNome: st.nome, chipBg: st.bg, chipFg: st.fg,
linha: v.status === 'andamento' && v.inicio ? 'Iniciado às ' + hora(v.inicio) : '', temLinha: v.status === 'andamento' && !!v.inicio, orcamento: v.status === 'orcamento', progresso: prog(v), motivo: v.motivo, kmFinal: km(v.kmFinal),
equipe: nomes.length ? nomes.map(function (n) { return n === eu ? 'Você (' + eu + ')' : n; }).join(', ') : 'Ninguém apontou item ainda',
mostraIniciar: v.status === 'aguardando', mostraPausar: v.status === 'andamento', mostraRetomar: v.status === 'pausado', finalizado: v.status === 'finalizado',
itens: v.itens.map(function (i) {
return {
nome: i.nome, qtd: i.qtd, tipo: i.tipo, linha: i.qtd ? i.tipo + ' · ' + i.qtd : i.tipo, temPecas: !!(i.pecas && i.pecas.length), aberto: s.svAberto === i.id && !!(i.pecas && i.pecas.length), pecasRotulo: s.svAberto === i.id ? 'Ocultar peças' : 'Ver peças (' + (i.pecas ? i.pecas.length : 0) + ')', pecasTexto: (i.pecas || []).join('\n'), alternar: function () { self.setState({ svAberto: s.svAberto === i.id ? null : i.id }); }, feito: i.feito, disse: i.disse || '', temDisse: !!i.disse, nota: i.pend ? 'Sugestão sua' : (i.nota || ''), temNota: !!(i.pend || i.nota),
modoApontar: !emEdicao && v.status !== 'recusado' && !i.pend, mostraOutro: !emEdicao && !i.feito && editavel && !i.pend, mostraRemover: emEdicao && !i.feito, rotuloRemover: 'Remover ' + i.nome,
remover: function () { self.mudar(v.id, function (x) { return Object.assign({}, x, { itens: x.itens.filter(function (k) { return k.id !== i.id; }) }); }); },
rotulo: (i.feito ? 'Desmarcar ' : 'Marcar como feito por mim: ') + i.nome,
caixaFundo: i.feito ? '#1b6b34' : '#ffffff', caixaBorda: i.feito ? '#1b6b34' : '#6b727c',
situacao: i.pend ? 'Aguardando aprovação do administrador' : i.feito ? (i.por ? 'Feito por ' + (i.por === eu ? 'você' : i.por) : 'Executado (marcado no sistema)') : 'Pendente',
situacaoCor: i.feito ? '#17592c' : '#6b4300',
marcar: function () {
if (!pode) { self.avisar(v.status === 'finalizado' ? 'Serviço já finalizado.' : v.status === 'orcamento' ? 'Ainda é orçamento. Aguarde virar O.S.' : 'Inicie ou retome o serviço para apontar.'); return; }
self.mudar(v.id, function (x) { return Object.assign({}, x, { itens: x.itens.map(function (k) { return k.id === i.id ? Object.assign({}, k, { feito: !k.feito, por: k.feito ? '' : eu }) : k; }) }); });
},
outro: function () {
if (!pode) { self.avisar(v.status === 'orcamento' ? 'O.S. ainda em orçamento.' : 'Inicie ou retome o serviço para apontar.'); return; }
if (!s.tecnicos.length) { self.avisar('Não há outro técnico cadastrado no sistema.'); return; }
self.setState({ folha: 'mec', itemFolha: i.id });
}
};
})
};
}

var itemSel = v ? v.itens.filter(function (i) { return i.id === s.itemFolha; })[0] : null;
var mecanicos = s.tecnicos.map(function (n) {
return { nome: n, escolher: function () {
if (!v) return;
self.mudar(v.id, function (x) { return Object.assign({}, x, { itens: x.itens.map(function (k) { return k.id === s.itemFolha ? Object.assign({}, k, { feito: true, por: n }) : k; }) }); });
self.setState({ folha: null, itemFolha: null });
} };
});
var motivos = ['Aguardando peça', 'Aguardando aprovação do cliente', 'Intervalo ou almoço', 'Fui para outro veículo'].map(function (n) {
return { nome: n, escolher: function () {
if (!v) return;
self.mudar(v.id, function (x) { return Object.assign({}, x, { status: 'pausado', acumulado: seg(x), inicio: null, motivo: n }); });
self.setState({ folha: null });
} };
});

var oleos = [], oleoVazioTexto = 'Nenhum veículo encontrado.';
if (s.aba === 'oleo') {
if (!s.cat) { oleoVazioTexto = s.catErro || 'Carregando o catálogo de óleo…'; }
else {
var M = self.catMod, q = s.busca.trim();
var linhaDe = function (titulo, placa, lista) {
if (!lista.length) return [{ modelo: titulo, placa: placa, litros: '—', visc: 'não achei' }];
return lista.slice(0, placa ? 1 : 4).map(function (x) { return { modelo: placa ? titulo : [x.linha.montadora, x.linha.modelo, x.linha.motor, M.periodoTexto(x.linha)].filter(Boolean).join(' '), placa: placa, litros: x.litros + ' L', visc: x.viscosidade }; });
};
var plq = q.toUpperCase().replace(/[^A-Z0-9]/g, '');
if (/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(plq)) {
var achada = (self._placas || {})[plq];
if (!achada || achada.estado === 'buscando') oleoVazioTexto = 'Buscando a placa ' + plq + '…';
else if (achada.estado === 'erro') oleoVazioTexto = achada.msg;
else {
var dv = achada.dados, pv2 = M.pesquisarVeiculo(s.cat, dv);
oleos = linhaDe([dv.marca, dv.modelo, dv.ano].filter(Boolean).join(' '), plq, pv2.r ? M.resumoOleo(pv2.r.oleo, pv2.r.ano) : []);
}
} else if (q.length >= 3) {
if (self._oq !== q) { var pr = M.pesquisar(s.cat, q); self._oq = q; self._or = linhaDe(q, '', M.resumoOleo(pr.oleo, pr.ano)); if (!pr.oleo.length) self._or = []; }
oleos = self._or; oleoVazioTexto = 'Não achei esse modelo no catálogo.';
} else {
var vistos = {};
s.veic.forEach(function (x) {
if (!x.dadosVeiculo || vistos[x.placa]) return; vistos[x.placa] = 1;
var pv = M.pesquisarVeiculo(s.cat, x.dadosVeiculo);
oleos = oleos.concat(linhaDe(x.modelo, x.placa, pv.r ? M.resumoOleo(pv.r.oleo, pv.r.ano) : []));
});
oleoVazioTexto = 'Digite o modelo para buscar (ex.: Onix 1.0).';
}
}
}

var N = s.nova;
var setN = function (o) { self.setState({ nova: Object.assign({}, self.state.nova, o) }); };
var n = { placaInput: '', foto: false, dados: false, itensPasso: false, listaPasso: false, passoNome: '', placa: '', modelo: '', detalhe: '', origem: '', origemBg: '#fff', origemFg: '#000', cadastrado: false, novo: false, cliente: '', kmAnterior: '', clienteInput: '', foneInput: '', kmInput: '', texto: '', falarBg: '#ffffff', falarFg: '#16191d', falarTexto: 'Falar', itens: [], total: '', vazio: false };
if (N) {
var nomes2 = { foto: 'Passo 1 de 4 · Placa', dados: 'Passo 2 de 4 · Dados do veículo', itens: 'Passo 3 de 4 · O que precisa ser feito', lista: 'Passo 4 de 4 · Conferir e enviar' };
n = {
foto: N.passo === 'foto', dados: N.passo === 'dados', itensPasso: N.passo === 'itens', listaPasso: N.passo === 'lista', passoNome: nomes2[N.passo],
placaInput: N.placaInput, placa: N.placa, modelo: N.modelo, detalhe: N.detalhe, cadastrado: N.cadastrado, novo: !N.cadastrado && N.passo === 'dados',
origem: N.cadastrado ? 'Encontrado no cadastro da oficina' : 'Placa nova · dados da consulta pela placa',
origemBg: N.cadastrado ? '#dff2e4' : '#e1ebf7', origemFg: N.cadastrado ? '#17592c' : '#174f94',
cliente: N.cliente, kmAnterior: km(N.kmAnterior), clienteInput: N.clienteInput, foneInput: N.foneInput, kmInput: N.kmInput, texto: N.texto,
falarBg: N.ouvindo ? '#16191d' : '#ffffff', falarFg: N.ouvindo ? '#ffffff' : '#16191d', falarTexto: N.ouvindo ? 'Ouvindo…' : 'Falar',
total: N.itens.length + (N.itens.length === 1 ? ' item' : ' itens'), vazio: N.itens.length === 0,
itens: N.itens.map(function (i) {
return { nome: i.nome, tipo: i.tipo, disse: i.disse, borda: i.conferir ? '#b26a00' : '#d5d9de', tipoCor: i.conferir ? '#8a4b00' : '#174f94', rotulo: 'Remover ' + i.nome,
remover: function () { setN({ itens: self.state.nova.itens.filter(function (k) { return k.id !== i.id; }) }); } };
})
};
}

var fora = !s.logado;
var naLista = !v && !N && !fora;
var azul = '#174f94', cinza = '#4a515b';
return {
telaLista: naLista && s.aba === 'veiculos', telaVeiculo: !!v && !N && !fora, telaNova: !!N && !fora, telaBloqueio: fora && s.bloqueado, telaLogin: fora && !s.bloqueado, senha: s.senha, loginMotivo: s.loginMotivo, temMotivo: !!s.loginMotivo, sim: true,  n: n,
notifs: s.notifs.map(function (t) { return { titulo: t.titulo, texto: t.texto, abrir: function () { self.setState({ notifs: self.state.notifs.filter(function (k) { return k.id !== t.id; }), folha: null, aberto: t.veicId, nova: null }); } }; }),
temNotifs: s.notifs.length > 0, semNotifs: s.notifs.length === 0, qtdNotifs: String(s.notifs.length), sinoRotulo: 'Notificações: ' + s.notifs.length, folhaNotifs: s.folha === 'notifs' && !fora, telaOleo: naLista && s.aba === 'oleo', mostraAbas: naLista,
lista: lista, d: d, oleos: oleos, semOleo: oleos.length === 0, oleoVazioTexto: oleoVazioTexto, busca: s.busca,
nomeUsuario: s.usuario ? s.usuario.primeiro : '', carregando: s.carregando, erroCarga: s.erroCarga, temErroCarga: !!s.erroCarga, listaVazia: !s.carregando && !s.erroCarga && s.veic.length === 0,
saudacao: s.emailSalvo && s.nomeSalvo ? 'Olá, ' + s.nomeSalvo : 'DTCar Mecânico', loginSub: s.entrando ? 'Entrando…' : s.emailSalvo ? 'Digite sua senha para entrar' : 'Entre com o e-mail e a senha do sistema', pedeEmail: !s.emailSalvo, temEmailSalvo: !!s.emailSalvo, emailInput: s.emailInput,
onEmail: function (e) { self.setState({ emailInput: e.target.value }); },
trocarUsuario: function () { guardar('dtcar-mecanico-email', ''); guardar('dtcar-mecanico-nome', ''); self.setState({ emailSalvo: '', nomeSalvo: '', emailInput: '', senha: '' }); },
atualizar: function () { self.carregar(); },
sair: function () { self.encerrar(''); },
alternarPecasOS: function () { self.setState({ pecasOSAberto: !s.pecasOSAberto }); },
abaVeicCor: s.aba === 'veiculos' ? azul : cinza, abaVeicBorda: s.aba === 'veiculos' ? azul : '#ffffff',
abaOleoCor: s.aba === 'oleo' ? azul : cinza, abaOleoBorda: s.aba === 'oleo' ? azul : '#ffffff',
aviso: s.aviso, temAviso: !!s.aviso,
folhaPausa: s.folha === 'pausa' && !fora, folhaMec: s.folha === 'mec' && !fora, folhaKm: s.folha === 'km' && !fora, folhaAdd: s.folha === 'add' && !fora, addTexto: s.addTexto, addFalarBg: s.addOuvindo ? '#16191d' : '#ffffff', addFalarFg: s.addOuvindo ? '#ffffff' : '#16191d', addFalarTexto: s.addOuvindo ? 'Ouvindo…' : 'Falar',
itemFolha: itemSel ? itemSel.nome : '', mecanicos: mecanicos, motivos: motivos,
kmInput: s.kmInput, kmErro: s.kmErro, temKmErro: !!s.kmErro,
novaAbrir: function () { self.setState({ nova: { passo: 'foto', buscando: false, dadosVeiculo: null, placaInput: '', placa: '', modelo: '', detalhe: '', cadastrado: false, cliente: '', kmAnterior: null, clienteInput: '', foneInput: '', kmInput: '', texto: '', ouvindo: false, itens: [] } }); },
novaVoltar: function () {
var ordem = ['foto', 'dados', 'itens', 'lista'], i = ordem.indexOf(N.passo);
clearTimeout(self._f);
if (i <= 0) self.setState({ nova: null }); else setN({ passo: ordem[i - 1], ouvindo: false });
},
onCliente: function (e) { setN({ clienteInput: e.target.value }); },
onFone: function (e) { setN({ foneInput: e.target.value }); },
onKmEntrada: function (e) { setN({ kmInput: e.target.value.replace(/[^0-9]/g, '') }); },
onTexto: function (e) { setN({ texto: e.target.value }); },
dadosOk: function () {
if (!N.cadastrado && !N.clienteInput.trim()) { self.avisar('Informe o nome do cliente.'); return; }
if (!N.kmInput) { self.avisar('Informe o KM de entrada.'); return; }
if (N.kmAnterior && parseInt(N.kmInput, 10) < N.kmAnterior) { self.avisar('KM menor que o da última visita (' + km(N.kmAnterior) + '). Confira.'); return; }
setN({ passo: 'itens' });
},
falar: function () {
if (N.ouvindo) return;
var ok = self.ouvir(function (t) {
var atual = self.state.nova; if (!atual) return;
if (t === null) { if (atual.ouvindo) setN({ ouvindo: false }); return; }
if (t) setN({ ouvindo: false, texto: atual.texto ? atual.texto.replace(/[\s,]+$/, '') + ', ' + t : t });
});
if (ok) setN({ ouvindo: true });
},
entender: function () {
if (!N.texto.trim()) { self.avisar('Escreva ou fale o que precisa ser feito.'); return; }
setN({ passo: 'lista', itens: self.entenderTexto(N.texto) });
},
corrigir: function () { setN({ passo: 'itens' }); },
abrirOS: function () {
if (!N.itens.length) { self.avisar('A lista está vazia.'); return; }
var num = String(s.proxORC).padStart(4, '0');
var novoV = { id: Date.now(), real: false, dadosVeiculo: N.dadosVeiculo || null, placa: N.placa, modelo: N.modelo, os: '', orc: num, queixa: N.texto.trim(), kmEntrada: parseInt(N.kmInput, 10), status: 'orcamento', acumulado: 0, inicio: null, motivo: '', kmFinal: null,
itens: N.itens.map(function (i, k) { return { id: k + 1, nome: i.nome, qtd: i.conferir ? 'a conferir' : (i.tipo === 'Serviço' ? '1 serviço' : '1 un'), tipo: i.conferir ? 'Conferir' : i.tipo, feito: false, por: '', disse: i.disse, depois: false }; }) };
self.setState({ veic: [novoV].concat(s.veic), nova: null, proxORC: s.proxORC + 1, aba: 'veiculos' });
self.avisar('Teste: o orçamento NÃO foi salvo no sistema.');
},
irVeiculos: function () { self.setState({ aba: 'veiculos' }); },
irOleo: function () { self.setState({ aba: 'oleo' }); self.carregarCatalogo(); },
voltar: function () { self.setState({ aberto: null, folha: null, editando: false }); },
onBusca: function (e) { var t = e.target.value, pl = t.toUpperCase().replace(/[^A-Z0-9]/g, ''); self.setState({ busca: t }); if (/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(pl) && self.sb) self.buscarPlacaOleo(pl); },
onKm: function (e) { self.setState({ kmInput: e.target.value.replace(/[^0-9]/g, ''), kmErro: '' }); },
fecharFolha: function () { clearTimeout(self._g); self.setState({ folha: null, itemFolha: null, kmErro: '', addOuvindo: false }); },
alternarEdicao: function () { self.setState({ editando: !s.editando }); },
addAbrir: function () { self.setState({ folha: 'add', addTexto: '', addOuvindo: false }); },
onAddTexto: function (e) { self.setState({ addTexto: e.target.value }); },
addFalar: function () {
if (s.addOuvindo) return;
var ok = self.ouvir(function (t) {
if (t === null) { if (self.state.addOuvindo) self.setState({ addOuvindo: false }); return; }
var at = self.state.addTexto;
if (t) self.setState({ addOuvindo: false, addTexto: at ? at.replace(/[\s,]+$/, '') + ', ' + t : t });
});
if (ok) self.setState({ addOuvindo: true });
},
addConfirmar: function () {
if (!v) return;
if (!s.addTexto.trim()) { self.avisar('Escreva ou fale o item.'); return; }
var novos = self.entenderTexto(s.addTexto), base0 = Date.now();
self.mudar(v.id, function (x) {
var tem = {}; x.itens.forEach(function (k) { tem[k.nome] = 1; });
var add = novos.filter(function (k) { return !tem[k.nome]; }).map(function (k, idx) { return { id: base0 + idx, nome: k.nome, qtd: k.conferir ? 'a conferir' : (k.tipo === 'Serviço' ? '1 serviço' : '1 un'), tipo: k.conferir ? 'Conferir' : k.tipo, feito: false, por: '', disse: k.disse, pend: x.status !== 'orcamento' }; });
return Object.assign({}, x, { itens: x.itens.concat(add) });
});
self.setState({ folha: null, addTexto: '' });
self.avisar(v.status === 'orcamento' ? 'Lista atualizada.' : 'Sugestão enviada para aprovação.');
},
simAprovar: function () { if (!v) return; var num = String(s.proxOS); self.mudar(v.id, function (x) { return Object.assign({}, x, { status: 'aguardando', os: num, itens: paraServicos(x.itens) }); }); self.setState({ proxOS: s.proxOS + 1 }); notificar('Orçamento aprovado', v.placa + ' virou a O.S. ' + num + '. Sua lista virou a lista de serviços.', v.id); self.avisar('Aprovado: virou a O.S. ' + num + '.'); },
simAdmAdd: function () {
if (!v) return;
var op = [['Subst. de palhetas do limpador', '', 'Serviço'], ['Troca do líquido de arrefecimento', '', 'Serviço'], ['Limpeza de bicos injetores', '', 'Serviço'], ['Subst. de lâmpadas do farol', '', 'Serviço']];
var o = op[s.admIdx % op.length];
self.mudar(v.id, function (x) { return Object.assign({}, x, { itens: x.itens.concat([{ id: Date.now(), nome: o[0], qtd: o[1], tipo: o[2], feito: false, por: '', nota: 'Incluído pelo administrador' }]) }); });
self.setState({ admIdx: s.admIdx + 1 });
notificar('Novo serviço na ' + docDe(v), v.placa + ': ' + o[0], v.id);
self.avisar('Notificação: novo serviço na ' + docDe(v) + '.');
},
simAdmAprova: function () {
if (!v) return;
var n0 = v.itens.filter(function (i) { return i.pend; }).length;
if (!n0) { self.avisar('Não há sugestão pendente neste carro.'); return; }
self.mudar(v.id, function (x) { var fixos = x.itens.filter(function (i) { return !i.pend; }); return Object.assign({}, x, { itens: fixos.concat(paraServicos(x.itens.filter(function (i) { return i.pend; }), fixos.map(function (i) { return i.nome; }), 'Sugestão sua, aprovada')) }); });
notificar('Sugestão aprovada', v.placa + ': ' + (n0 === 1 ? '1 sugestão entrou' : n0 + ' sugestões entraram') + ' na ' + docDe(v) + '.', v.id);
self.avisar('Notificação: sugestão aprovada.');
},
onSenha: function (e) { self.setState({ senha: e.target.value }); },
entrar: function () {
if (s.entrando || !self.sb) return;
var email = (s.emailSalvo || s.emailInput || '').trim();
if (!email) { self.avisar('Digite o seu e-mail.'); return; }
if (!s.senha) { self.avisar('Digite sua senha.'); return; }
self.setState({ entrando: true });
self.sb.auth.signInWithPassword({ email: email, password: s.senha }).then(function (r) {
if (r.error || !r.data || !r.data.user) { self.setState({ entrando: false, senha: '' }); self.avisar(/invalid/i.test((r.error && r.error.message) || '') ? 'E-mail ou senha incorretos.' : 'Não consegui entrar. Confira a internet.'); return; }
self.entrouNoHorario = dentroDoHorario();
self.aposLogin(r.data.user);
}).catch(function () { self.setState({ entrando: false }); self.avisar('Não consegui entrar. Confira a internet.'); });
},
tentarWifi: function () {}, voltarLogin: function () {}, simVoltarWifi: function () {},
abrirNotifs: function () { self.setState({ folha: 'notifs' }); },
simRecusar: function () { if (!v) return; self.mudar(v.id, function (x) { return Object.assign({}, x, { status: 'recusado' }); }); self.avisar('Orçamento recusado.'); },
onPlaca: function (e) { setN({ placaInput: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) }); },
buscarPlaca: function () {
var pl = N.placaInput;
if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(pl)) { self.avisar('Placa incompleta ou fora do padrão.'); return; }
var ja = s.veic.filter(function (x) { return x.placa === pl && x.status !== 'finalizado' && x.status !== 'recusado'; })[0];
if (ja) { self.avisar('Esse veículo já está na sua lista (' + docDe(ja) + ').'); return; }
if (N.buscando) return;
setN({ buscando: true }); self.avisar('Buscando a placa…');
var achou = function (o) { if (self.state.nova) setN(Object.assign({ passo: 'dados', placa: pl, buscando: false }, o)); };
self.sb.from('veiculos').select('id,placa,marca,modelo,ano,cor,combustivel,km_atual,cliente_id').eq('placa', pl).limit(1).then(function (r) {
var vc = r.data && r.data[0];
if (vc) {
var dv = { placa: pl, marca: vc.marca, modelo: vc.modelo, ano: vc.ano, combustivel: vc.combustivel };
var fim = function (nome) { achou({ modelo: [vc.marca, vc.modelo, vc.ano].filter(Boolean).join(' '), detalhe: [vc.cor, vc.combustivel].filter(Boolean).join(' · '), cadastrado: true, cliente: nome || 'Cliente não informado', kmAnterior: vc.km_atual || null, dadosVeiculo: dv }); };
if (!vc.cliente_id) { fim(''); return; }
self.sb.from('clientes').select('nome').eq('id', vc.cliente_id).maybeSingle().then(function (rc) { fim(rc.data && rc.data.nome); });
return;
}
// não está no cadastro: consulta pela placa (paga), a mesma função que o sistema usa
self.sb.functions.invoke('placa', { body: { acao: 'basico', placa: pl } }).then(function (rp) {
var x = rp && rp.data, dd = x && x.dados;
if (!x || x.ok !== true || !x.encontrado || !dd) { if (self.state.nova) setN({ buscando: false }); self.avisar((x && x.erro) || 'Não achei essa placa. Confira e tente de novo.'); return; }
var ano = dd.ano_fab && dd.ano_mod && dd.ano_fab !== dd.ano_mod ? dd.ano_fab + '/' + dd.ano_mod : (dd.ano_mod || dd.ano_fab || '');
achou({ modelo: [dd.marca, dd.modelo, ano].filter(Boolean).join(' '), detalhe: [dd.cor, dd.combustivel].filter(Boolean).join(' · '), cadastrado: false, cliente: '', kmAnterior: null, dadosVeiculo: { placa: pl, marca: dd.marca, modelo: dd.modelo, ano: String(ano), motor: dd.motor, combustivel: dd.combustivel } });
}).catch(function () { if (self.state.nova) setN({ buscando: false }); self.avisar('Sem resposta da consulta de placa.'); });
}).catch(function () { if (self.state.nova) setN({ buscando: false }); self.avisar('Não consegui consultar o cadastro. Confira a internet.'); });
},
iniciar: function () { if (v) self.mudar(v.id, function (x) { return Object.assign({}, x, { status: 'andamento', inicio: Date.now() }); }); },
retomar: function () { if (v) self.mudar(v.id, function (x) { return Object.assign({}, x, { status: 'andamento', inicio: Date.now(), motivo: '' }); }); },
abrirPausa: function () { self.setState({ folha: 'pausa' }); },
abrirFim: function () {
if (!v) return;
if (v.itens.some(function (i) { return i.pend; })) { self.avisar('Há sugestão aguardando aprovação. Fale com o administrador.'); return; }
var faltam = v.itens.filter(function (i) { return !i.feito; }).length;
if (faltam) { self.avisar(faltam === 1 ? 'Falta 1 serviço sem apontamento.' : 'Faltam ' + faltam + ' serviços sem apontamento.'); return; }
self.setState({ folha: 'km', kmInput: '', kmErro: '' });
},
confirmarFim: function () {
if (!v) return;
var n = parseInt(s.kmInput, 10);
if (!s.kmInput || isNaN(n)) { self.setState({ kmErro: 'Informe o KM final.' }); return; }
if (n < v.kmEntrada) { self.setState({ kmErro: 'O KM final não pode ser menor que o de entrada (' + km(v.kmEntrada) + ').' }); return; }
self.mudar(v.id, function (x) { return Object.assign({}, x, { status: 'finalizado', acumulado: seg(x), inicio: null, kmFinal: n }); });
self.setState({ folha: null, kmInput: '', kmErro: '' });
}
};
}
}

instancia = new Component({});
desenhar();
if (instancia.componentDidMount) instancia.componentDidMount();
if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
})();
