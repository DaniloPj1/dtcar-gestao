// DTCar Mecânico — VERSÃO DE TESTE (dados fictícios, sem login real e sem ligação com o banco).
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
class Component extends DCLogic {
constructor(props) {
super(props);
var agora = Date.now();
this.state = {
aba: 'veiculos', aberto: null, folha: null, itemFolha: null,
kmInput: '', kmErro: '', busca: '', aviso: '', nova: null, proxOS: 1924, proxORC: 57, editando: false, addTexto: '', addOuvindo: false, foraWifi: false, notifs: [], admIdx: 0, logado: false, bloqueado: false, senha: '', loginMotivo: '', svAberto: null,
veic: [
{ id: 1, placa: 'RBA2C47', modelo: 'Toyota Hilux 2.8 Diesel 2019', os: '1921', queixa: 'Revisão com troca de óleo e freios dianteiros', kmEntrada: 84050, status: 'andamento', acumulado: 0, inicio: agora - 1512000, motivo: '', kmFinal: null,
  itens: [
  { id: 1, nome: 'Subst. de óleo e filtros', qtd: '', tipo: 'Serviço', feito: true, por: 'Carlos', pecas: ['Óleo de motor 5W-30 · 7,9 L', 'Filtro de óleo · 1 un', 'Filtro de ar · 1 un'] },
  { id: 2, nome: 'Subst. de pastilhas de freio dianteiras', qtd: '', tipo: 'Serviço', feito: true, por: 'Rafael', pecas: ['Pastilhas de freio dianteiras · 1 jogo'] },
  { id: 3, nome: 'Revisão geral', qtd: '', tipo: 'Serviço', feito: false, por: '' }
  ] },
{ id: 2, placa: 'QXT8F15', modelo: 'Chevrolet Onix 1.0 2020', os: '1923', queixa: 'Barulho na suspensão dianteira', kmEntrada: 61200, status: 'aguardando', acumulado: 0, inicio: null, motivo: '', kmFinal: null,
  itens: [
  { id: 1, nome: 'Subst. de bieletas dianteiras', qtd: '', tipo: 'Serviço', feito: false, por: '', pecas: ['Bieleta dianteira · 2 un'] },
  { id: 2, nome: 'Subst. de buchas da bandeja', qtd: '', tipo: 'Serviço', feito: false, por: '', pecas: ['Bucha da bandeja · 2 un'] },
  { id: 3, nome: 'Alinhamento de direção', qtd: '', tipo: 'Serviço', feito: false, por: '' }
  ] },
{ id: 3, placa: 'PPK5H90', modelo: 'Volkswagen Gol 1.6 2015', os: '1917', queixa: 'Troca da correia dentada', kmEntrada: 132480, status: 'pausado', acumulado: 2940, inicio: null, motivo: 'Aguardando peça', kmFinal: null,
  itens: [
  { id: 1, nome: 'Subst. de correia dentada', qtd: '', tipo: 'Serviço', feito: false, por: '', pecas: ['Kit correia dentada · 1 kit'] },
  { id: 2, nome: 'Subst. de bomba d\u2019água', qtd: '', tipo: 'Serviço', feito: true, por: 'Carlos' }
  ] }
]
};
}
componentWillUnmount() {
clearTimeout(this._a);
clearTimeout(this._f);
}
entenderTexto(texto) {
var R = [
[/filtro de [oó]leo/, [['Filtro de óleo', 'Peça']]],
[/filtro de ar( |$)/, [['Filtro de ar do motor', 'Peça']]],
[/filtro de combust/, [['Filtro de combustível', 'Peça']]],
[/cabine|ar.condicionado/, [['Filtro de cabine', 'Peça']]],
[/fluido de freio/, [['Troca do fluido de freio', 'Serviço']]],
[/pastilha.*tras/, [['Pastilhas de freio traseiras (jogo)', 'Peça'], ['Mão de obra: troca de pastilhas', 'Serviço']]],
[/pastilha/, [['Pastilhas de freio dianteiras (jogo)', 'Peça'], ['Mão de obra: troca de pastilhas', 'Serviço']]],
[/disco/, [['Discos de freio dianteiros (par)', 'Peça']]],
[/amortecedor.*tras/, [['Amortecedores traseiros (par)', 'Peça']]],
[/amortecedor/, [['Amortecedores dianteiros (par)', 'Peça']]],
[/bieleta/, [['Bieletas dianteiras (par)', 'Peça']]],
[/suspens|barulho/, [['Diagnóstico de suspensão', 'Serviço']]],
[/alinhamento/, [['Alinhamento', 'Serviço']]],
[/balanceamento/, [['Balanceamento', 'Serviço']]],
[/correia/, [['Kit correia dentada', 'Peça'], ['Mão de obra: correia dentada', 'Serviço']]],
[/bateria/, [['Bateria', 'Peça']]],
[/vela/, [['Jogo de velas de ignição', 'Peça']]],
[/arrefec|radiador|aditivo/, [['Troca do líquido de arrefecimento', 'Serviço']]],
[/[oó]leo/, [['Óleo de motor', 'Peça'], ['Mão de obra: troca de óleo', 'Serviço']]]
];
var out = [], vistos = {}, id = 1;
texto.split(/[,;\n.]+|\s+e\s+/).forEach(function (f) {
var t = f.trim(); if (!t) return;
var low = t.toLowerCase(), achou = null;
for (var k = 0; k < R.length; k++) { if (R[k][0].test(low)) { achou = R[k][1]; break; } }
if (!achou) { out.push({ id: id++, disse: t, nome: t.charAt(0).toUpperCase() + t.slice(1), tipo: 'Conferir: não encontrei no cadastro', conferir: true }); return; }
achou.forEach(function (a) { if (vistos[a[0]]) return; vistos[a[0]] = 1; out.push({ id: id++, disse: t, nome: a[0], tipo: a[1], conferir: false }); });
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
var self = this, s = this.state, eu = 'Carlos';
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
abrir: function () { self.setState({ aberto: v.id, editando: false, svAberto: null }); } };
});

var v = s.veic.filter(function (x) { return x.id === s.aberto; })[0] || null;
var d = { tituloLista: '', simAdm: false, podeAdd: false, addRotulo: '', addAjuda: '', doc: '', recusado: false, editando: false, mostraEditar: false, editarTexto: '', placa: '', modelo: '', os: '', queixa: '', kmEntrada: '', statusNome: '', chipBg: '#fff', chipFg: '#000', linha: '', temLinha: false, orcamento: false, progresso: '', itens: [], equipe: '', motivo: '', kmFinal: '', mostraIniciar: false, mostraPausar: false, mostraRetomar: false, finalizado: false };
if (v) {
var st = ST[v.status];
var pode = v.status === 'andamento';
var editavel = v.status !== 'finalizado' && v.status !== 'recusado';
var emEdicao = v.status === 'orcamento';
var aprovada = v.status === 'aguardando' || v.status === 'andamento' || v.status === 'pausado';
var nomes = [];
v.itens.forEach(function (i) { if (i.feito && nomes.indexOf(i.por) < 0) nomes.push(i.por); });
d = {
doc: docDe(v), recusado: v.status === 'recusado', editando: emEdicao, mostraEditar: false, editarTexto: '', tituloLista: v.os ? 'Serviços da O.S.' : 'Minha lista', simAdm: aprovada, podeAdd: editavel, addRotulo: emEdicao ? '+ Adicionar item à lista' : '+ Sugerir serviço ao administrador', addAjuda: emEdicao ? 'Você pode alterar a lista enquanto for orçamento.' : 'Depois de aprovada, a lista só muda pelo sistema principal. Sua sugestão fica aguardando aprovação.',
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
situacao: i.pend ? 'Aguardando aprovação do administrador' : i.feito ? ('Feito por ' + (i.por === eu ? 'você' : i.por)) : 'Pendente',
situacaoCor: i.feito ? '#17592c' : '#6b4300',
marcar: function () {
if (!pode) { self.avisar(v.status === 'finalizado' ? 'Serviço já finalizado.' : v.status === 'orcamento' ? 'Ainda é orçamento. Aguarde virar O.S.' : 'Inicie ou retome o serviço para apontar.'); return; }
self.mudar(v.id, function (x) { return Object.assign({}, x, { itens: x.itens.map(function (k) { return k.id === i.id ? Object.assign({}, k, { feito: !k.feito, por: k.feito ? '' : eu }) : k; }) }); });
},
outro: function () {
if (!pode) { self.avisar(v.status === 'orcamento' ? 'O.S. ainda em orçamento.' : 'Inicie ou retome o serviço para apontar.'); return; }
self.setState({ folha: 'mec', itemFolha: i.id });
}
};
})
};
}

var itemSel = v ? v.itens.filter(function (i) { return i.id === s.itemFolha; })[0] : null;
var mecanicos = ['Rafael', 'João', 'Marcos'].map(function (n) {
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

var base = [
{ modelo: 'Toyota Hilux 2.8 Diesel 2019', placa: 'RBA2C47', litros: '7,9 L', visc: '5W-30' },
{ modelo: 'Chevrolet Onix 1.0 2020', placa: 'QXT8F15', litros: '3,5 L', visc: '5W-30' },
{ modelo: 'Volkswagen Gol 1.6 2015', placa: 'PPK5H90', litros: '3,5 L', visc: '5W-40' },
{ modelo: 'Fiat Strada 1.4 2018', placa: '', litros: '2,7 L', visc: '5W-30' },
{ modelo: 'Ford Ranger 3.2 Diesel 2017', placa: '', litros: '9,8 L', visc: '5W-30' },
{ modelo: 'Hyundai HB20 1.0 2019', placa: '', litros: '3,6 L', visc: '5W-30' }
];
var q = s.busca.trim().toLowerCase();
var oleos = base.filter(function (o) { return !q || (o.modelo + ' ' + o.placa).toLowerCase().indexOf(q) >= 0; });

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
telaLista: naLista && s.aba === 'veiculos', telaVeiculo: !!v && !N && !fora, telaNova: !!N && !fora, telaBloqueio: fora && s.bloqueado, telaLogin: fora && !s.bloqueado, senha: s.senha, loginMotivo: s.loginMotivo, temMotivo: !!s.loginMotivo, sim: true, wifiSimTexto: s.foraWifi ? 'Versão de teste · simulando FORA do Wi-Fi da oficina (tocar para mudar)' : 'Versão de teste · qualquer senha serve · simulando NO Wi-Fi da oficina (tocar para mudar)', n: n,
notifs: s.notifs.map(function (t) { return { titulo: t.titulo, texto: t.texto, abrir: function () { self.setState({ notifs: self.state.notifs.filter(function (k) { return k.id !== t.id; }), folha: null, aberto: t.veicId, nova: null }); } }; }),
temNotifs: s.notifs.length > 0, semNotifs: s.notifs.length === 0, qtdNotifs: String(s.notifs.length), sinoRotulo: 'Notificações: ' + s.notifs.length, folhaNotifs: s.folha === 'notifs' && !fora, telaOleo: naLista && s.aba === 'oleo', mostraAbas: naLista,
lista: lista, d: d, oleos: oleos, semOleo: oleos.length === 0, busca: s.busca,
abaVeicCor: s.aba === 'veiculos' ? azul : cinza, abaVeicBorda: s.aba === 'veiculos' ? azul : '#ffffff',
abaOleoCor: s.aba === 'oleo' ? azul : cinza, abaOleoBorda: s.aba === 'oleo' ? azul : '#ffffff',
aviso: s.aviso, temAviso: !!s.aviso,
folhaPausa: s.folha === 'pausa' && !fora, folhaMec: s.folha === 'mec' && !fora, folhaKm: s.folha === 'km' && !fora, folhaAdd: s.folha === 'add' && !fora, addTexto: s.addTexto, addFalarBg: s.addOuvindo ? '#16191d' : '#ffffff', addFalarFg: s.addOuvindo ? '#ffffff' : '#16191d', addFalarTexto: s.addOuvindo ? 'Ouvindo…' : 'Falar',
itemFolha: itemSel ? itemSel.nome : '', mecanicos: mecanicos, motivos: motivos,
kmInput: s.kmInput, kmErro: s.kmErro, temKmErro: !!s.kmErro,
novaAbrir: function () { self.setState({ nova: { passo: 'foto', placaInput: '', placa: '', modelo: '', detalhe: '', cadastrado: false, cliente: '', kmAnterior: null, clienteInput: '', foneInput: '', kmInput: '', texto: '', ouvindo: false, itens: [] } }); },
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
setN({ ouvindo: true });
self._f = setTimeout(function () {
var atual = self.state.nova; if (!atual) return;
var ex = 'trocar óleo e filtro de óleo, pastilha dianteira, barulho na suspensão, alinhamento, limpeza de bico';
setN({ ouvindo: false, texto: atual.texto ? atual.texto.replace(/[\s,]+$/, '') + ', ' + ex : ex });
}, 1600);
},
entender: function () {
if (!N.texto.trim()) { self.avisar('Escreva ou fale o que precisa ser feito.'); return; }
setN({ passo: 'lista', itens: self.entenderTexto(N.texto) });
},
corrigir: function () { setN({ passo: 'itens' }); },
abrirOS: function () {
if (!N.itens.length) { self.avisar('A lista está vazia.'); return; }
var num = String(s.proxORC).padStart(4, '0');
var novoV = { id: Date.now(), placa: N.placa, modelo: N.modelo, os: '', orc: num, queixa: N.texto.trim(), kmEntrada: parseInt(N.kmInput, 10), status: 'orcamento', acumulado: 0, inicio: null, motivo: '', kmFinal: null,
itens: N.itens.map(function (i, k) { return { id: k + 1, nome: i.nome, qtd: i.conferir ? 'a conferir' : (i.tipo === 'Serviço' ? '1 serviço' : '1 un'), tipo: i.conferir ? 'Conferir' : i.tipo, feito: false, por: '', disse: i.disse, depois: false }; }) };
self.setState({ veic: [novoV].concat(s.veic), nova: null, proxORC: s.proxORC + 1, aba: 'veiculos' });
self.avisar('ORC ' + num + ' enviado para a oficina.');
},
irVeiculos: function () { self.setState({ aba: 'veiculos' }); },
irOleo: function () { self.setState({ aba: 'oleo' }); },
voltar: function () { self.setState({ aberto: null, folha: null, editando: false }); },
onBusca: function (e) { self.setState({ busca: e.target.value }); },
onKm: function (e) { self.setState({ kmInput: e.target.value.replace(/[^0-9]/g, ''), kmErro: '' }); },
fecharFolha: function () { clearTimeout(self._g); self.setState({ folha: null, itemFolha: null, kmErro: '', addOuvindo: false }); },
alternarEdicao: function () { self.setState({ editando: !s.editando }); },
addAbrir: function () { self.setState({ folha: 'add', addTexto: '', addOuvindo: false }); },
onAddTexto: function (e) { self.setState({ addTexto: e.target.value }); },
addFalar: function () {
if (s.addOuvindo) return;
self.setState({ addOuvindo: true });
self._g = setTimeout(function () { var t = self.state.addTexto; var ex = 'disco de freio, fluido de freio'; self.setState({ addOuvindo: false, addTexto: t ? t.replace(/[\s,]+$/, '') + ', ' + ex : ex }); }, 1400);
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
simFimExpediente: function () { clearTimeout(self._f); clearTimeout(self._g); self.setState({ logado: false, bloqueado: false, senha: '', aberto: null, nova: null, folha: null, editando: false, loginMotivo: 'Fora do horário comercial (7h às 18h). Digite sua senha para entrar.' }); },
onSenha: function (e) { self.setState({ senha: e.target.value }); },
alternarWifi: function () { self.setState({ foraWifi: !s.foraWifi }); },
entrar: function () {
if (!s.senha) { self.avisar('Digite sua senha.'); return; }
if (s.foraWifi) { self.setState({ bloqueado: true, senha: '' }); return; }
self.setState({ logado: true, bloqueado: false, senha: '' });
},
tentarWifi: function () { if (s.foraWifi) { self.avisar('Ainda fora do Wi-Fi da oficina.'); return; } self.setState({ logado: true, bloqueado: false }); },
voltarLogin: function () { self.setState({ bloqueado: false }); },
simVoltarWifi: function () { self.setState({ foraWifi: false }); self.avisar('Wi-Fi da oficina conectado. Toque em Tentar de novo.'); },
abrirNotifs: function () { self.setState({ folha: 'notifs' }); },
simRecusar: function () { if (!v) return; self.mudar(v.id, function (x) { return Object.assign({}, x, { status: 'recusado' }); }); self.avisar('Orçamento recusado.'); },
onPlaca: function (e) { setN({ placaInput: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7) }); },
buscarPlaca: function () {
var pl = N.placaInput;
if (!/^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$/.test(pl)) { self.avisar('Placa incompleta ou fora do padrão.'); return; }
var ja = s.veic.filter(function (x) { return x.placa === pl && x.status !== 'finalizado' && x.status !== 'recusado'; })[0];
if (ja) { self.avisar('Esse veículo já está na sua lista (' + docDe(ja) + ').'); return; }
if (pl === 'OZR3B82') setN({ passo: 'dados', placa: pl, modelo: 'Fiat Strada 1.4 2018', detalhe: 'Branca · Flex', cadastrado: true, cliente: 'José Almeida', kmAnterior: 97310 });
else setN({ passo: 'dados', placa: pl, modelo: 'Jeep Renegade 1.8 2021', detalhe: 'Prata · Flex', cadastrado: false, cliente: '', kmAnterior: null });
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
if ("serviceWorker" in navigator) window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
})();
