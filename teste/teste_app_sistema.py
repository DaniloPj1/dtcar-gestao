# Teste do app do sistema (pasta app/, o que vira o APK): entrar, só administrador/consultor, digital, tela inicial e as telas do protótipo
# (Óleo, Orçamentos como pedido, Agendar, Peça por catálogo, Histórico, Consultar O.S.) gravando num Supabase de mentira.
# O Supabase e o plugin da digital são de mentira (montados aqui). Confere também que nada é gravado no banco
# e que a pasta app/www (a tela "Sem internet" que vai dentro do APK) está certa.
# Uso: python3 teste/teste_app_sistema.py   (precisa de: pip install playwright pillow && playwright install chromium)
import re, sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.run([sys.executable, os.path.join(raiz, 'app', 'montar_www.py')], check=True, stdout=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '-d', raiz], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = 0
def t(c, m):
    global ok
    assert c, m; ok += 1
UID = '22222222-2222-2222-2222-222222222222'
import datetime; HOJE = datetime.date.today().isoformat()
# Desde 20/11/2026 o Início separa por grupo: primeiro o que se faz na oficina, depois o que se faz
# no carro (o diagnóstico, que deixou de ser uma tela e virou família de seis).
ROTULOS_OFICINA = ['INICIAR SERVIÇO', 'ÓLEO (APLICAÇÃO)', 'ORÇAMENTOS', 'AGENDAR', 'AGENDA', 'CONSULTAR PEÇA POR CATÁLOGO', 'HISTÓRICO DE SERVIÇOS', 'MEUS SERVIÇOS', 'CONSULTAR O.S.']
ROTULOS_CARRO = ['LER O CARRO (OBD)', 'MÓDULOS DO CARRO', 'ATUADORES', 'APRENDIZADOS', 'PROGRAMAR BICO', 'PARÂMETROS DE REFERÊNCIA']
ROTULOS = ROTULOS_OFICINA + ROTULOS_CARRO
# plugin da digital de mentira: o "cofre" (window.__cofre) sobrevive a recarregar a página; __ok controla se a leitura passa
PLUGIN = """
['__cofre', '__ok'].forEach(function (k) { Object.defineProperty(window, k, { configurable: true,
  get: function () { var v = sessionStorage.getItem(k); return v === null ? (k === '__ok' ? true : null) : JSON.parse(v); },
  set: function (v) { sessionStorage.setItem(k, JSON.stringify(v)); } }); });
window.__chamadas = []; window.__voltar = null; window.__app = [];
window.Capacitor = { Plugins: { App: { addListener: (ev, fn) => { if (ev === 'backButton') window.__voltar = fn; return Promise.resolve({ remove: () => {} }); }, minimizeApp: () => { window.__app.push('minimize'); return Promise.resolve(); }, exitApp: () => { window.__app.push('exit'); return Promise.resolve(); } }, NativeBiometric: {
  isAvailable: () => Promise.resolve({ isAvailable: window.__disp !== false }),
  verifyIdentity: (o) => { window.__chamadas.push('verify'); return window.__ok ? Promise.resolve() : Promise.reject(new Error('cancelado')); },
  setCredentials: (o) => { window.__chamadas.push('set'); window.__cofre = o; return Promise.resolve(); },
  getCredentials: (o) => window.__cofre ? Promise.resolve(window.__cofre) : Promise.reject(new Error('vazio')),
  deleteCredentials: (o) => { window.__chamadas.push('del'); window.__cofre = null; return Promise.resolve(); } } } };
"""
# adaptador ELM327 de mentira: responde como um de verdade, inclusive "NO DATA" no que o carro não tem
FAKE_OBD = """
window.__obd = { cmds: [], chamadas: [], conectado: false };
/* O PORTÃO, igual ao do plugin nativo (ObdPlugin.permitido). O teste em Python confere que as
   listas aqui são as MESMAS do Java — se alguém mudar um lado só, o teste reprova. */
window.__AT_PERMITIDOS = ['ATZ','ATE0','ATL0','ATS0','ATH0','ATH1','ATSP0','ATDP','ATDPN','ATRV','ATI','ATCAF1','ATCRA','ATSP6','ATSP7'];
window.__SERVICOS_LEITURA = ['01','02','03','06','07','09','0A','19','21','22','24','3E'];
window.__UDS_LEITURA = ['19','22','24','3E'];
window.__SERVICOS_PROIBIDOS = ['34','35','36','37'];
window.__portao = function (cru) {
  var c = String(cru == null ? '' : cru).trim().replace(/[ \t]/g, '').toUpperCase();
  if (!c) return false;
  var hexN = function (t, n) { return t.length === n && new RegExp('^[0-9A-F]{' + n + '}$').test(t); };
  var parN = function (t) { return t.length % 2 === 0 && (t === '' || /^[0-9A-F]+$/.test(t)); };
  if (c.indexOf('AT') === 0) {
    if (window.__AT_PERMITIDOS.indexOf(c) >= 0) return true;
    var diag = function (e) { if (hexN(e, 3)) { var n = parseInt(e, 16); return n >= 0x600 && n <= 0x7FF; } return hexN(e, 8) && (e.indexOf('18DA') === 0 || e.indexOf('18DB') === 0); };
    if (c.indexOf('ATSH') === 0) return diag(c.slice(4));
    if (c.indexOf('ATCRA') === 0) return hexN(c.slice(5), 3) || hexN(c.slice(5), 8);
    if (c.indexOf('ATFCSH') === 0) return diag(c.slice(6));
    if (c.indexOf('ATFCSD') === 0) return c === 'ATFCSD300000';
    if (c.indexOf('ATFCSM') === 0) return c.length === 7 && c[6] >= '0' && c[6] <= '2';
    if (c.indexOf('ATST') === 0) return hexN(c.slice(4), 2);
    return false;
  }
  if (!/^[0-9A-F]+$/.test(c) || c.length % 2 !== 0 || c.length < 2) return false;
  var sv = c.slice(0, 2);
  if (window.__SERVICOS_PROIBIDOS.indexOf(sv) >= 0) return false;
  if (sv === '10') return c === '1001' || c === '1003';
  if (sv === '21') return c.length === 4;
  if (window.__SERVICOS_LEITURA.indexOf(sv) >= 0) {
    return c.length <= (window.__UDS_LEITURA.indexOf(sv) >= 0 ? 32 : 14);
  }
  return false;
};
window.Capacitor = window.Capacitor || { Plugins: {} };
window.Capacitor.Plugins = window.Capacitor.Plugins || {};
var R = {
  'ATZ': 'ELM327 v1.5', 'ATE0': 'OK', 'ATL0': 'OK', 'ATS0': 'OK', 'ATH0': 'OK', 'ATSP0': 'OK',
  'ATDP': 'ISO 15765-4 (CAN 11/500)',
  '0100': '4100BFFF9803', '0120': '4120B81FE01F', '0140': '41407E9C70DD',
  '0160': '4160E0000101', '0180': '418000000001', '01A0': '41A004000000',
  '03': '4300\\r430201710300', '07': '47010130', '0A': '4A00',   // duas linhas: motor e câmbio respondendo
  '0101': '410183076121',
  '0902': '490201__VIN__',
  '010C': '410C1AF8', '0105': '41057B', '0104': '41043C', '0111': '41111A', '0106': '410697',
  '0107': '41078A', '010E': '410E88', '010F': '410F46', '010B': '410B62', '0110': '4110013A',
  '0142': '41423714', '011F': '411F0384', '0121': '41210026', '0131': '41310026', '0130': '41300006',
  // leituras novas de 19/11/2026
  '010D': '410D50', '010A': '410A32', '0108': '41088A', '0109': '41097A',
  '0123': '41231388', '0159': '41591388', '0122': '41221388', '015D': '415D6A40', '015E': '415E0046',
  '012C': '412C80', '012D': '412D80', '012E': '412E20', '012F': '412F80', '0132': '4132FFFC',
  '0133': '413365', '013C': '413C1324', '013D': '413D1324', '013E': '413E1194', '013F': '413F1194',
  '0143': '414300B4', '0144': '41448000', '0145': '41451A', '0146': '41464A', '0147': '41471A',
  '0149': '41491A', '014C': '414C1A', '014D': '414D003C', '014E': '414E0078',
  '0152': '415245', '0153': '41530BB8', '0154': '4154FFFF', '015A': '415A1A', '015C': '415C82',
  '0161': '41617D', '0162': '41627D', '0163': '4163012C', '01A6': '41A60016E360',
  // sondas e temperatura do escape (dois números no mesmo pedido)
  '0114': '41149980', '0115': '411566FF',
  '0124': '412480004000', '0125': '41258CCC4000',
  '0178': '4178031324 16A8 0000 0000'.replace(/ /g, ''),
  '020C00': '420C001AF8', '020500': '42050050', '021100': '42110030',
  // serviços avançados: calibração, CVN, contadores de uso e monitores deste ciclo
  'ATI': 'ELM327 v1.5',                       // versão que nunca existiu: o app tem de avisar que é clone
  '0904': '49040141424331323344454634353647484937',
  '0906': '490601' + '1A2B3C4D',
  '0908': '490808' + '0100' + '0050' + '0014' + '0064' + '0005' + '0064',
  '0141': '414100076101',
  '0600': '4600FF000001', '0620': '4620F0000001', '0640': '464000000001', '0660': '466000000001',
  '0680': '468000000001', '06A0': '46A0F8000000',
  '0621': '4621010100640000012C',
  // contagem de falha de combustão por cilindro: MID $A2 = cilindro 1, TID $0B média de 10 ciclos, $0C ciclo atual
  '06A1': '46A10B2400000000FFFF',
  '06A2': '46A20B2400010000FFFFA20C2400020000FFFF',
  '06A3': '46A30B2400010000FFFFA30C2400010000FFFF',
  '06A4': '46A40B2400B40000FFFFA40C2401540000FFFF',
  '06A5': '46A50B2400000000FFFFA50C2400000000FFFF',
  // ---- UDS (20/11/2026): ajuste do adaptador, sessão e os identificadores do ePTI ----
  'ATCAF1': 'OK', 'ATCAF0': 'OK', 'ATSP6': 'OK', 'ATAL': 'OK', 'ATAR': 'OK', 'ATCRA': 'OK',
  'ATSH7E0': 'OK', 'ATCRA7E8': 'OK', 'ATFCSH7E0': 'OK', 'ATFCSD300000': 'OK', 'ATFCSM1': 'OK',
  'ATSH7E1': 'OK', 'ATCRA7E9': 'OK', 'ATFCSH7E1': 'OK', 'ATST32': 'OK', 'ATSTFA': 'OK',
  '1001': '5001003200C8', '1003': '5003003200C8',
  '22F190': '62F190' + '__VIN__',
  '22FA19': '62FA1901',                                   // edição 1 da norma
  '22FA21': '62FA21000B0012',                             // cuida do ABS e do controle de estabilidade
  '22FA20': '62FA20FA19FA20FA21FA22FA23FA24',             // os dados que ele tem
  '22FA22': '62FA220200AD6E',                             // rotinas: dentro da faixa do fabricante
  '22FA23': '62FA23F101FA30',                             // atuadores: identificador de dado, parte alta
  '22FA24': '62FA240100',
  // falha por módulo: QUATRO bytes por falha (o terceiro é o tipo, que dá a causa elétrica)
  '1902FF': '5902FF0171132F' + 'C021490A',
  '14FFFFFF': '54'
};
window.__R = R;
window.Capacitor.Plugins.DtcarObd = {
  permissao: function () { window.__obd.chamadas.push('permissao'); return Promise.resolve({ concedida: true, pedeNaHora: true }); },
  pedirPermissao: function () { window.__obd.chamadas.push('pedirPermissao'); return Promise.resolve({ concedida: true }); },
  listar: function () { window.__obd.chamadas.push('listar'); return Promise.resolve({ aparelhos: [{ nome: 'vLinker FS', endereco: 'AA:BB:CC:DD:EE:FF' }] }); },
  situacao: function () { return Promise.resolve({ conectado: window.__obd.conectado, nome: 'vLinker FS', endereco: 'AA:BB:CC:DD:EE:FF' }); },
  conectar: function (o) { window.__obd.chamadas.push('conectar'); window.__obd.conectado = true; return Promise.resolve({ conectado: true, nome: 'vLinker FS', endereco: o.endereco }); },
  desconectar: function () { window.__obd.chamadas.push('desconectar'); window.__obd.conectado = false; return Promise.resolve({ conectado: false }); },
  // Cada coisa que age no carro tem método PRÓPRIO no plugin, nunca o comando() — é assim no APK de
  // verdade, e é a garantia de que uma leitura não vira comando. O teste usa os mesmos nomes.
  // como o nativo: agir exige UM módulo escolhido, nunca o endereço de difusão
  __umModulo: function () {
    var c = window.__obd.cabecalho || '';
    if (!c) return false;
    if (c.length === 3) { var n = parseInt(c, 16); return n !== 0x7DF && n >= 0x600 && n <= 0x7FF; }
    return c.length === 8 && c.indexOf('18DA') === 0;
  },
  sondarGravacao: function (o) {
    // pergunta "aceita gravar?" sem gravar: o campo 2A99 exige destravar (33); os outros aceitam (13 = só o tamanho não bateu)
    window.__obd.chamadas.push('sondarGravacao:' + o.did);
    var cab = String(window.__obd.cabecalho || '').toUpperCase(), n = parseInt(o.did, 16);
    if (!/^[0-9A-F]{4}$/.test(o.did) || (n >= 0xF180 && n <= 0xF1FF)) return Promise.reject(new Error('did-protegido'));
    if (cab !== '7E0' && cab !== '18DA10F1') return Promise.reject(new Error('so-modulo-do-motor'));
    return Promise.resolve({ perguntou: true, antes: '62' + o.did + '41414141414141', resposta: (o.did === '2A99' ? '7F2E33' : '7F2E13') + '\\r\\r>' });
  },
  gravarDado: function (o) {
    // o mesmo portão do nativo: só o módulo do motor, nunca a identificação, e só com o valor antigo lido
    window.__obd.chamadas.push('gravarDado:' + o.did + ':' + o.valor);
    var cab = String(window.__obd.cabecalho || '').toUpperCase(), n = parseInt(o.did, 16);
    if (!/^[0-9A-F]{4}$/.test(o.did) || (n >= 0xF180 && n <= 0xF1FF)) return Promise.reject(new Error('did-protegido'));
    if (cab !== '7E0' && cab !== '18DA10F1') return Promise.reject(new Error('so-modulo-do-motor'));
    window.__obd.dado = window.__obd.dado || {};
    var antes = window.__obd.dado[o.did] || '41414141414141';
    if (o.did === '2A99') return Promise.resolve({ gravou: true, antes: '62' + o.did + antes, resposta: '7F2E33\\r\\r>' });
    window.__obd.dado[o.did] = o.valor;
    return Promise.resolve({ gravou: true, antes: '62' + o.did + antes + '\\r\\r>', resposta: '6E' + o.did + '\\r\\r>' });
  },
  atuar: function (o) {
    window.__obd.chamadas.push('atuar:' + o.did + ':' + o.opcao);
    if (!window.Capacitor.Plugins.DtcarObd.__umModulo()) return Promise.reject(new Error('sem-modulo-escolhido'));
    return Promise.resolve({ resposta: '6F' + o.did + o.opcao + '\\r\\r>' });
  },
  rotina: function (o) {
    window.__obd.chamadas.push('rotina:' + o.rotina + ':' + o.sub);
    if (!window.Capacitor.Plugins.DtcarObd.__umModulo()) return Promise.reject(new Error('sem-modulo-escolhido'));
    // a primeira pergunta do resultado diz "estou trabalhando"; a segunda diz que terminou
    if (o.sub === '03') {
      window.__obd.voltas = (window.__obd.voltas || 0) + 1;
      if (window.__obd.voltas < 2) return Promise.resolve({ resposta: '7F3178\\r\\r>' });
      return Promise.resolve({ resposta: '7103' + o.rotina + '00\\r\\r>' });
    }
    return Promise.resolve({ resposta: '71' + o.sub + o.rotina + '\\r\\r>' });
  },
  // gravar (0x2E) e destravar (0x27) NÃO existem no plugin de verdade enquanto nenhuma tela
  // os usa, então também não existem aqui. O teste confere que o Java não os tem.
  reiniciarModulo: function (o) { window.__obd.chamadas.push('reiniciarModulo'); return Promise.resolve({ resposta: '5101\\r\\r>' }); },
  // apagar tem método PRÓPRIO no plugin (nunca passa pelo comando): é assim no APK de verdade
  apagar: function () {
    window.__obd.apagados = (window.__obd.apagados || 0) + 1;
    if (!window.__obd.conectado) return Promise.reject(new Error('sem-conexao'));
    if (window.__obd.recusaApagar) return Promise.resolve({ resposta: '7F 04 22\\r\\r>' });
    window.__obd.limpo = true;            // módulo de verdade: os códigos somem e as adaptações zeram
    return Promise.resolve({ resposta: '44\\r\\r>' });
  },
  comando: function (o) {
    var c = String(o.cmd || '').toUpperCase();
    window.__obd.cmds.push(c);
    if (!window.__obd.conectado) return Promise.reject(new Error('sem-conexao'));
    // O adaptador de mentira aplica A MESMA LISTA BRANCA do plugin nativo (ver PORTAO abaixo).
    // Antes ele não aplicava nada, e por isso nenhum teste de navegador provava o portão: comando
    // que o APK recusaria passava no teste. Foi assim que a sondagem de rotina, que ia pelo
    // comando() e era recusada no aparelho de verdade, passou verde aqui.
    if (!window.__portao(c)) return Promise.reject(new Error('comando-recusado'));
    if (c.indexOf('ATSH') === 0) window.__obd.cabecalho = c.slice(4);
    else if (c.indexOf('ATSP') === 0 || c === 'ATZ' || c === 'ATD' || c === 'ATWS') window.__obd.cabecalho = '';
    // cabeçalho ligado (ATH1): a resposta vem com o endereço de quem respondeu, como no adaptador de verdade
    // O carro de mentira tem TRÊS módulos: motor (7E0), câmbio (7E1) e ABS (713). Nos outros endereços
    // ninguém responde — é assim que o teste prova que a tela só mostra módulo disponível.
    if (window.__obd.cabecalho && ['7E0', '7E1', '713', '18DA10F1'].indexOf(window.__obd.cabecalho) < 0 && c.indexOf('AT') !== 0) return Promise.resolve({ resposta: 'NO DATA\\r\\r>' });
    // ABS do Polo: as quatro rodas no dado 03E8 (40,0 / 40,0 / 39,5 / 12,0 km/h — a traseira direita divergindo)
    if (window.__obd.cabecalho === '713' && c === '2203E8') { window.__obd.roda = (window.__obd.roda || 0) + 1; return Promise.resolve({ resposta: '6203E801900190018B00' + (120 + window.__obd.roda).toString(16).toUpperCase() + '\\r\\r>' }); }
    if (window.__obd.cabecalho === '713' && c.indexOf('22') === 0) return Promise.resolve({ resposta: '7F2231\\r\\r>' });
    if (window.__obd.dado && c.indexOf('22') === 0 && window.__obd.dado[c.slice(2)]) return Promise.resolve({ resposta: '62' + c.slice(2) + window.__obd.dado[c.slice(2)] + '\\r\\r>' });
    // Honda: o dado 266C (onde mora o bit do aprendizado do VTC), 40 bytes
    if (window.__obd.cabecalho === '18DA10F1' && c === '22266C') return Promise.resolve({ resposta: '62266C' + new Array(41).join('5A') + '\\r\\r>' });
    if (c === 'ATH1') { window.__obd.h1 = true; return Promise.resolve({ resposta: 'OK\\r\\r>' }); }
    if (c === 'ATH0' || c === 'ATZ') window.__obd.h1 = false;
    if (window.__obd.h1 && !window.__obd.limpo && !window.__obd.falhaNova && (c === '03' || c === '07' || c === '0A')) {
      return Promise.resolve({ resposta: (c === '03' ? '7E8024300\\r7E906430201710300' : c === '07' ? '7E80447010130' : '7E8024A00') + '\\r\\r>' });
    }
    if (window.__obd.limpo && (c === '03' || c === '07' || c === '0A')) return Promise.resolve({ resposta: (c === '03' ? '4300' : c === '07' ? '4700' : '4A00') + '\\r\\r>' });
    if (window.__obd.limpo && (c === '0106' || c === '0107')) return Promise.resolve({ resposta: '41' + c.slice(2) + '80\\r\\r>' });   // ajuste zerado: o módulo recomeça
    if (c === '03' && window.__obd.falhaNova) return Promise.resolve({ resposta: '4301' + window.__obd.falhaNova + '\\r\\r>' });
    if (c === '010C') {   // rotação sobe a cada leitura: é assim que o teste vê a tela se mexer
      window.__obd.rpm = (window.__obd.rpm || 800) + 100;
      var cru = window.__obd.rpm * 4;
      return Promise.resolve({ resposta: '410C' + ('000' + cru.toString(16).toUpperCase()).slice(-4) + '\\r\\r>' });
    }
    return Promise.resolve({ resposta: (R[c] === undefined ? 'NO DATA' : R[c]) + '\\r\\r>' });
  }
};
""".replace('__VIN__', '3942575A5A5A3337375654303034323531')
CLI = [{'id': 'c1', 'nome': 'JOÃO DA SILVA', 'telefone': '27999990000', 'doc': '12345678909', 'cep': '29700-000', 'cidade': 'Colatina', 'uf': 'ES', 'rua': 'RUA EXEMPLO, 100', 'bairro': 'CENTRO', 'situacao': 'liberado'}]
VEI = [{'id': 'v1', 'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015', 'ano_fab': 2014, 'ano_mod': 2015, 'cor': 'PRATA', 'cliente_id': 'c1', 'km_atual': 80000}]
PROD = [{'id': 'p1', 'codigo': 1, 'tipo': 'produto', 'descricao': 'FILTRO OLEO TECFIL PSL560', 'referencia': 'PSL560', 'categoria': 'Filtros', 'ativo': True, 'estoque_atual': 4, 'preco_vista': 35}]
ORD = [{'id': 'o1', 'numero': 1900, 'status': 'entregue', 'cliente_id': 'c1', 'veiculo_id': 'v1', 'km_entrada': 75000, 'total': 450, 'criado_em': '2026-09-02T10:00:00-03:00', 'entregue_em': '2026-09-03T10:00:00-03:00', 'finalizada_em': '2026-09-03T10:00:00-03:00', 'recebido': 450, 'reclamacao': 'Troca de óleo e filtros', 'cliente': {'nome': 'JOÃO DA SILVA'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015'}, 'mecanico_nome': 'Carlos'},
       {'id': 'o2', 'numero': 1920, 'status': 'execucao', 'cliente_id': 'c1', 'veiculo_id': 'v1', 'km_entrada': 80000, 'total': 900, 'criado_em': '2026-11-10T10:00:00-03:00', 'recebido': 0, 'reclamacao': 'Revisão e freios', 'cliente': {'nome': 'JOÃO DA SILVA'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015'}}]
ITENS = [{'id': 'i1', 'ordem_id': 'o1', 'tipo': 'servico', 'descricao': 'SUBST. DE ÓLEO E FILTROS', 'aprovado': True, 'qtd': 1, 'valor_unit': 100, 'desconto': 0, 'posicao': 0},
         {'id': 'i2', 'ordem_id': 'o2', 'tipo': 'servico', 'descricao': 'REVISÃO COMPLETA', 'aprovado': True, 'qtd': 1, 'valor_unit': 300, 'desconto': 0, 'posicao': 0},
         {'id': 'i3', 'ordem_id': 'o2', 'tipo': 'servico', 'descricao': 'PASTILHAS DE FREIO DIANTEIRAS', 'aprovado': True, 'qtd': 1, 'valor_unit': 200, 'desconto': 0, 'posicao': 1}]
ORCS = [{'id': 'orc1', 'numero': 5, 'situacao': 'enviado', 'cliente_id': 'c1', 'veiculo_id': 'v1', 'cliente': {'nome': 'JOÃO DA SILVA'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015'}, 'reclamacao': 'Barulho na suspensão', 'obs_internas': 'Pedido pelo app — Fulano de Teste, 15/11/2026 09:00', 'consultor_id': UID, 'consultor_nome': 'Fulano de Teste', 'criado_em': '2026-11-15T12:00:00Z', 'atualizado_em': '2026-11-15T12:00:00Z', 'total': 0, 'validade': '2026-11-30'},
        {'id': 'orc2', 'numero': 6, 'situacao': 'aprovado', 'cliente_id': 'c1', 'veiculo_id': 'v1', 'cliente': {'nome': 'JOÃO DA SILVA'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015'}, 'reclamacao': 'Troca de óleo', 'obs_internas': 'Pedido pelo app — Fulano de Teste, 14/11/2026 09:00', 'consultor_id': UID, 'consultor_nome': 'Fulano de Teste', 'criado_em': '2026-11-14T12:00:00Z', 'atualizado_em': '2026-11-15T12:00:00Z', 'respondido_em': '2026-11-15T12:00:00Z', 'ordem_id': 'o2', 'os_numero': 1920, 'total': 300},
        {'id': 'orc3', 'numero': 7, 'situacao': 'aprovado', 'cliente': {'nome': 'OUTRO'}, 'veiculo': {'placa': 'QQQ1Q11'}, 'reclamacao': 'x', 'obs_internas': '', 'consultor_id': 'outra-pessoa', 'consultor_nome': 'Outra', 'criado_em': '2026-11-14T12:00:00Z', 'atualizado_em': '2026-11-15T12:00:00Z', 'ordem_id': 'o9', 'os_numero': 1999, 'total': 1}]
class Fake:
    def __init__(s, papel='admin', ativo=True, acessos=None): s.papel, s.ativo, s.pedidos, s.refresh, s.n = papel, ativo, [], 'r0', 0; s.gravados = []; s.acessos = acessos; s.eventos = []; s.apont = []; s.vistos = []; s.orcs = json.loads(json.dumps(ORCS)); s.funcao_pedido = []
    def instalar(s, pg):
        def resp(route, corpo, st=200): route.fulfill(status=st, content_type='application/json', body=json.dumps(corpo), headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*'})
        def sessao(email='teste@dtcar.com'):
            s.n += 1; s.refresh = 'r%d' % s.n
            return {'access_token': 'a.b.c', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'refresh_token': s.refresh,
                    'user': {'id': UID, 'email': email, 'aud': 'authenticated', 'role': 'authenticated'}}
        def h(route):
            rq = route.request; u = rq.url
            s.pedidos.append((rq.method, u.split('.co')[1].split('?')[0], u))
            if rq.method == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
            if '/auth/v1/token' in u:
                d = json.loads(rq.post_data or '{}')
                if 'grant_type=refresh_token' in u:
                    if d.get('refresh_token') != s.refresh: return resp(route, {'error': 'invalid_grant', 'error_description': 'Invalid Refresh Token', 'msg': 'Invalid Refresh Token'}, 400)
                    return resp(route, sessao())
                if d.get('password') != 'certa': return resp(route, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials', 'msg': 'Invalid login credentials'}, 400)
                return resp(route, sessao(d.get('email')))
            if '/auth/v1/logout' in u: return route.fulfill(status=204, headers={'access-control-allow-origin': '*'})
            if '/auth/v1/health' in u: return resp(route, {'name': 'GoTrue'})
            if '/functions/v1/pedido' in u and getattr(s, 'sem_funcao', False): return route.fulfill(status=404, content_type='application/json', body='{"code":"NOT_FOUND"}')  # sem CORS: o navegador vê erro de rede
            if '/functions/v1/pedido' in u:
                d = json.loads(rq.post_data or '{}'); s.funcao_pedido.append(d)
                if d.get('acao') == 'novo':
                    n = 12 + len([x for x in s.funcao_pedido if x.get('acao') == 'novo']) - 1
                    o = {'id': 'orc-app%d' % n, 'numero': n, 'situacao': 'elaboracao', 'cliente_id': d.get('cliente_id') or None, 'veiculo_id': d.get('veiculo_id') or None, 'cliente': d.get('cliente') or {}, 'veiculo': {'placa': d.get('placa', ''), **(d.get('veiculo') or {})}, 'reclamacao': d['texto'], 'obs_internas': 'Pedido pelo app — Fulano de Teste, 16/11/2026 15:30', 'consultor_id': UID, 'consultor_nome': 'Fulano de Teste', 'criado_em': '2026-11-16T18:30:00Z', 'atualizado_em': '2026-11-16T18:30:00Z', 'total': 0}
                    s.orcs.insert(0, o); return resp(route, {'ok': True, 'id': o['id'], 'numero': n})
                o = next((x for x in s.orcs if x['id'] == d.get('id')), None)
                if not o: return resp(route, {'ok': False, 'erro': 'Este orçamento não existe mais.'}, 400)
                o['reclamacao'] = o['reclamacao'] + '\n— Fulano de Teste, 16/11/2026 15:31: ' + d['texto']; o['atualizado_em'] = '2026-11-16T18:31:00Z'
                return resp(route, {'ok': True, 'id': o['id'], 'numero': o['numero']})
            if '/rest/v1/agendamentos' in u and rq.method == 'GET': return resp(route, [{'id': 'ag1', 'data': HOJE, 'hora': '08:00', 'situacao': 'agendado', 'cliente': {'nome': 'JOÃO DA SILVA'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0'}, 'servico': 'Revisão', 'mecanico_id': UID, 'mecanico_nome': 'Fulano de Teste'},
                {'id': 'ag2', 'data': HOJE, 'hora': '09:00', 'situacao': 'cancelado', 'cliente': {'nome': 'X'}, 'veiculo': {}, 'servico': 'Óleo'}, {'id': 'ag3', 'data': HOJE, 'hora': '10:00', 'situacao': 'agendado', 'cliente': {'nome': 'MARIA'}, 'veiculo': {'placa': 'QXN1E49', 'modelo': 'ONIX'}, 'servico': 'Freios', 'mecanico_id': 'outra-pessoa', 'mecanico_nome': 'Beto'}])
            if '/rest/v1/rpc/apontamento_visto' in u:
                d = json.loads(rq.post_data or '{}'); s.vistos.append(d.get('p_id'))
                for a in s.apont:
                    if a['id'] == d.get('p_id'): a['indicacoes'] = [{**i, 'visto_em': '2026-11-16T19:00:00Z'} if i.get('para_id') == UID else i for i in a.get('indicacoes') or []]
                return resp(route, None)
            if '/rest/v1/servico_apontamentos' in u:
                if rq.method == 'POST':
                    d = json.loads(rq.post_data or '{}'); s.gravados.append(('servico_apontamentos', d))
                    if any(a['perfil_id'] == d['perfil_id'] and a['ordem_id'] == d['ordem_id'] and a['situacao'] != 'finalizado' for a in s.apont): return resp(route, {'code': '23505', 'message': 'duplicate key value violates unique constraint "servico_apontamentos_aberto"'}, 409)
                    a = {'id': 'ap%d' % (len(s.apont) + 1), 'inicio': '2026-11-16T18:50:00Z', 'fim': None, 'motivo_pausa': '', 'pausas': [], 'itens_executados': [], 'indicacoes': [], 'obs': '', **d}; s.apont.append(a); return resp(route, a)
                if rq.method == 'PATCH':
                    d = json.loads(rq.post_data or '{}'); s.gravados.append(('servico_apontamentos', d)); i = u.split('id=eq.')[1].split('&')[0]
                    for a in s.apont:
                        if a['id'] == i: a.update(d); return resp(route, a)
                    return resp(route, {'message': 'not found'}, 404)
                l = s.apont
                if 'perfil_id=eq.' in u: l = [a for a in l if ('perfil_id=eq.' + a['perfil_id']) in u]
                if 'situacao=neq.finalizado' in u: l = [a for a in l if a['situacao'] != 'finalizado']
                return resp(route, l)
            if '/rest/v1/perfis' in u:
                pf = {'id': UID, 'nome': 'Fulano de Teste', 'papel': s.papel, 'ativo': s.ativo}; return resp(route, pf if 'id=eq.' in u else [pf, {'id': 'outra-pessoa', 'nome': 'Beto Mecânico', 'papel': 'mecanico', 'ativo': True}])
            if rq.method == 'POST' and '/rest/v1/' in u:
                corpo = json.loads(rq.post_data or '{}'); tab = u.split('/rest/v1/')[1].split('?')[0]; s.gravados.append((tab, corpo))
                if tab == 'clientes': return resp(route, {**corpo, 'id': 'c-novo'})
                if tab == 'veiculos': return resp(route, {**corpo, 'id': 'v-novo'})
                if tab == 'ordens': return resp(route, {'id': 'o-novo', 'numero': 1921})
                if tab == 'agendamentos': return resp(route, {**corpo, 'id': 'ag-novo'})
                if tab == 'eventos': ev = {**corpo, 'id': 'ev%d' % (len(s.eventos) + 1), 'criado_em': corpo.get('criado_em') or '2026-11-16T18:40:00Z'}; s.eventos.append(ev); return resp(route, ev)
                return resp(route, {})
            if rq.method == 'PATCH' and '/rest/v1/' in u:
                corpo = json.loads(rq.post_data or '{}'); tab = u.split('/rest/v1/')[1].split('?')[0]; s.gravados.append((tab, corpo)); return resp(route, {**(VEI[0] if tab == 'veiculos' else {}), **corpo})
            if '/rest/v1/clientes' in u: return resp(route, CLI)
            if '/rest/v1/veiculos' in u: return resp(route, VEI)
            if '/rest/v1/produtos' in u: return resp(route, PROD)
            if '/rest/v1/ordens' in u: return resp(route, ORD)
            if '/rest/v1/os_itens' in u: return resp(route, ITENS)
            if '/rest/v1/orcamentos' in u: return resp(route, s.orcs)
            if '/rest/v1/eventos' in u: return resp(route, [e for e in s.eventos if 'ordem_id=eq.' not in u or ('ordem_id=eq.' + e['ordem_id']) in u])
            if '/rest/v1/config' in u:
                if getattr(s, 'config_erro', False): return resp(route, {'message': 'fora do ar'}, 500)
                return resp(route, {'dados': {'validadeDias': 7, 'garantiaDias': 90, **({'appAcessos': s.acessos} if s.acessos else {})}})
            return resp(route, [])
        pg.route('**/*.supabase.co/**', h)
    def escritas(s): return [p for p in s.pedidos if p[0] in ('POST', 'PATCH', 'PUT', 'DELETE') and '/auth/v1/' not in p[1]]
    def tabela(s, nome): return [c for tb, c in s.gravados if tb == nome]
def abrir(br, fake, url, plugin=True, disponivel=True, antes=None):
    ctx = br.new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('dialog', lambda d: d.accept())
    fake.instalar(pg)
    if plugin: pg.add_init_script(PLUGIN + ('' if disponivel else 'window.__disp=false;'))
    if antes: pg.add_init_script(antes)
    pg.goto(url); pg.wait_for_timeout(500)
    return ctx, pg, erros
def entrar(pg, email='teste@dtcar.com', senha='certa'):
    pg.fill('#lg-email', email); pg.fill('#lg-senha', senha); pg.click('button[type=submit]'); pg.wait_for_timeout(700)
    if pg.locator('.barra').count(): pg.wait_for_timeout(900)  # as telas carregam os dados do sistema
def tela(pg, r): pg.goto(URL + '#/' + r); pg.wait_for_selector('.titulo b', timeout=15000); pg.wait_for_timeout(600)
def buscar_placa(pg, placa='abc1d23'): pg.fill('#ini-placa', placa); pg.click('button[aria-label="Buscar placa"]'); pg.wait_for_selector('#veic', timeout=5000)
def textos(pg): return pg.inner_text('body')
def rotulos(pg): return [re.sub(r'\s*\d+$', '', b).strip() for b in pg.locator('.barra').all_inner_texts()]  # sem a bolinha de avisos
URL = 'http://localhost:8766/app/index.html'
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        # 1) tela de entrada, erros de preenchimento e senha errada
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False)
        t(pg.is_visible('#f-login'), 'abre na tela de entrada')
        pg.click('button[type=submit]'); t('Digite o seu usuário ou e-mail' in textos(pg), 'pede o usuário ou e-mail')
        pg.fill('#lg-email', 'a@b.com'); pg.click('button[type=submit]'); t('Digite a sua senha' in textos(pg), 'pede a senha')
        entrar(pg, 'a@b.com', 'errada'); t('E-mail ou senha incorretos' in textos(pg), 'senha errada avisa')
        t(pg.input_value('#lg-email') == 'a@b.com', 'mantém o e-mail digitado após o erro')
        pg.click('.ver'); t(pg.get_attribute('#lg-senha', 'type') == 'text', 'botão Mostrar revela a senha')
        # 2) login certo como administrador, sem plugin (navegador): sem oferta de digital
        entrar(pg); t('Olá, Fulano' in textos(pg) and 'Administrador' in textos(pg), 'entra como administrador')
        barras = rotulos(pg); t(barras == ROTULOS, 'quinze botões na ordem combinada, sem + O.S.: %s' % barras)
        # o grupo tem título, e o do carro vem depois do da oficina: com 15 botões, lista única é parede
        titulos_grupo = [x.strip() for x in pg.locator('.grupo-t').all_inner_texts()]
        t(titulos_grupo == ['NA OFICINA', 'NO CARRO'], 'dois grupos, com título, na ordem (o CSS põe em maiúsculas): %s' % titulos_grupo)
        t(pg.locator('.grupo').count() == 2, 'os botões ficam dentro dos dois grupos')
        t(pg.locator('.quadro').count() == 0, 'sem plugin não oferece a digital')
        t(not f.escritas(), 'não grava nada no banco: %s' % f.escritas())
        # cada botão abre a tela real do sistema, no modo app (?app=1), levando a marca de modo app
        # cada botão abre a tela do app correspondente (desenho do protótipo), sem sair do app
        TITULOS = ['INICIAR SERVIÇO', 'ÓLEO (APLICAÇÃO)', 'ORÇAMENTOS', 'AGENDAR SERVIÇO', 'AGENDA', 'CONSULTAR PEÇA POR CATÁLOGO', 'HISTÓRICO DE SERVIÇOS', 'MEUS SERVIÇOS', 'CONSULTAR O.S.',
                   'LER O CARRO (OBD)', 'MÓDULOS DO CARRO', 'TESTE DE ATUADOR', 'APRENDIZADOS E CALIBRAÇÕES', 'PROGRAMAR BICO', 'PARÂMETROS DE REFERÊNCIA']
        ROTAS = ['servico', 'oleo', 'orcamento', 'agendar', 'agenda', 'peca', 'historico', 'meus', 'osconsulta',
                 'obd', 'modulos', 'atuadores', 'aprendizados', 'bico', 'parametros']
        for i, rota in enumerate(ROTAS):
            pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra', timeout=10000); pg.click('.barra >> nth=%d' % i); pg.wait_for_selector('.titulo b', timeout=10000)
            t(pg.url.endswith('#/' + rota) and pg.inner_text('.titulo b') == TITULOS[i], 'botão %d abre %s: %s / %s' % (i + 1, rota, pg.url, pg.inner_text('.titulo b')))
            t(pg.locator('.abas a[aria-current=page]').count() == 1 and pg.locator('.cab img').count() == 1, 'tela %s tem as abas e o cabeçalho azul' % rota)
            t(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'tela %s sem rolagem lateral' % rota)
            t(pg.evaluate("getComputedStyle(document.querySelector('.rodape')).position") == 'fixed' and pg.evaluate("getComputedStyle(document.querySelector('.rodape')).borderTopColor") == 'rgb(47, 111, 181)', 'tela %s: rodapé fixo com a linha azul' % rota)
            t(pg.locator('#os').count() == 0 and '+ O.S.' not in pg.locator('.abas').inner_text(), 'tela %s sem a aba + O.S.' % rota)
        pg.click('.nav >> text=Ajuda'); pg.wait_for_timeout(400); t('Seu acesso' in textos(pg) and 'teste@dtcar.com' in textos(pg) and '1.6.0' in textos(pg), 'ajuda mostra o acesso e a versão')
        t(pg.locator('#bloco-digital').count() == 0, 'sem plugin o interruptor da digital não aparece')
        # recarregar mantém a sessão (sem digital)
        pg.reload(); pg.wait_for_selector('.nav', timeout=10000); pg.wait_for_timeout(300); t('AJUDA' in textos(pg), 'recarregar mantém a sessão e a rota')
        # sair
        pg.click('text=SAIR DO APP'); pg.wait_for_timeout(400); t(pg.is_visible('#f-login'), 'sair volta para a entrada')
        pg.reload(); pg.wait_for_timeout(500); t(pg.is_visible('#f-login'), 'depois de sair, recarregar pede a senha')
        t(not er, 'sem erro de script: %s' % er); ctx.close()
        # 3) consultor entra; mecânico, pendente e inativo não
        f = Fake('consultor'); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t('Consultor' in textos(pg) and pg.locator('.barra').count() == len(ROTULOS), 'consultor entra com as %d telas' % len(ROTULOS)); ctx.close()
        for papel, ativo in (('mecanico', True), ('pendente', True), ('admin', False)):
            f = Fake(papel, ativo); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
            t(('não está liberado' in textos(pg) or 'acesso liberado pelo administrador' in textos(pg)) and pg.locator('.barra').count() == 0, 'recusa %s ativo=%s (padrão do papel)' % (papel, ativo))
            pg.reload(); pg.wait_for_timeout(500); t(pg.is_visible('#f-login'), 'recusado não fica logado após recarregar (%s)' % papel); ctx.close()
        # 3b) acessos definidos pelo administrador em Sistema › Equipe (config.appAcessos)
        f = Fake('consultor', True, {UID: {'entra': False, 'telas': []}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t('não está liberado para o seu login' in textos(pg) and pg.locator('.barra').count() == 0, 'consultor desligado em Equipe não entra'); ctx.close()
        f = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['oleo', 'historico']}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        barras = rotulos(pg); t(barras == ['ÓLEO (APLICAÇÃO)', 'HISTÓRICO DE SERVIÇOS'] and 'Mecânico' in textos(pg), 'mecânico liberado vê só as telas marcadas: %s' % barras)
        tela(pg, 'oleo'); t(pg.locator('.abas a').count() == 2, 'abas só das telas liberadas')
        pg.goto(URL + '#/agendar'); pg.wait_for_timeout(600); t(pg.locator('.barra').count() == 2 and pg.locator('#ag-nome').count() == 0, 'tela não liberada cai no Início')
        pg.goto(URL + '#/ajuda'); pg.wait_for_timeout(500); t('Óleo (aplicação), Histórico de serviços' in textos(pg), 'Ajuda mostra as telas liberadas'); ctx.close()
        f = Fake('admin', True, {UID: {'entra': True, 'telas': []}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t(pg.locator('.barra').count() == 0 and 'Nenhuma tela liberada' in textos(pg), 'liberado sem tela: entra e vê o aviso'); ctx.close()
        # horário de uso (Equipe): fora dele o colaborador não entra; o administrador entra sempre; a agenda do mecânico não tem o aviso do WhatsApp
        fora = {'de': '00:00', 'ate': '00:01', 'dias': [0, 1, 2, 3, 4, 5, 6]}; dentro = {'de': '00:00', 'ate': '23:59', 'dias': [0, 1, 2, 3, 4, 5, 6]}
        f = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['oleo', 'agendar'], 'horario': fora}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t('Fora do horário de trabalho' in textos(pg) and pg.locator('.barra').count() == 0 and pg.is_visible('#f-login'), 'mecânico fora do horário de uso não entra e vê o horário')
        ctx.close()
        f = Fake('admin', True, {UID: {'entra': True, 'telas': ['oleo'], 'horario': fora}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t(pg.locator('.barra').count() == 1, 'administrador não tem limite de horário'); ctx.close()
        f = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['oleo', 'agendar'], 'horario': dentro}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t(pg.locator('.barra').count() == 2, 'mecânico dentro do horário entra'); tela(pg, 'agendar')
        t(pg.locator('.zap-mini').count() == 0 and pg.locator('.marcar').count() == 0 and pg.locator('button:has-text("Agendar serviço")').count() == 1, 'mecânico agenda sem o aviso pelo WhatsApp (só o administrador avisa)'); ctx.close()
        f = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['oleo', 'orcamento']}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t(rotulos(pg) == ['ÓLEO (APLICAÇÃO)', 'ORÇAMENTOS'], 'mecânico liberado pode pedir orçamento (o pedido não tem preço)'); ctx.close()
        # Ajustes fora do ar no login: não entra (nem libera por padrão)
        f = Fake('consultor', True, {UID: {'entra': False, 'telas': []}}); f.config_erro = True; ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t('Confira a internet' in textos(pg) and pg.locator('.barra').count() == 0, 'sem os Ajustes no login, o app não libera ninguém'); ctx.close()
        # 4) digital: oferta depois do primeiro login, "agora não", e ligar
        f = Fake(); ctx, pg, er = abrir(br, f, URL); entrar(pg)
        t(pg.is_visible('.quadro') and 'Entrar com a digital?' in textos(pg), 'oferece a digital após o primeiro login')
        pg.click('text=Agora não'); t(pg.locator('.quadro').count() == 0, 'agora não fecha o quadro')
        pg.reload(); pg.wait_for_timeout(600); t(pg.locator('.quadro').count() == 0, 'depois de recusar não oferece de novo')
        pg.goto(URL + '#/ajuda'); pg.wait_for_selector('#bloco-digital', timeout=10000); pg.wait_for_timeout(200)
        t(pg.is_visible('#bloco-digital') and pg.get_attribute('[data-acao=chave-digital]', 'aria-checked') == 'false', 'Ajuda mostra a chave desligada')
        pg.click('[data-acao=chave-digital]'); pg.wait_for_timeout(500)
        cofre = pg.evaluate('window.__cofre')
        t(cofre and cofre['password'] == f.refresh and cofre['server'] == 'br.com.dtcarcentroautomotivo.gestao', 'cofre guarda só a chave de renovação: %s' % cofre)
        t(cofre['password'] != 'certa', 'a senha nunca vai para o cofre')
        t(pg.get_attribute('[data-acao=chave-digital]', 'aria-checked') == 'true', 'chave fica ligada')
        t(pg.evaluate("localStorage.getItem('dtcar-app-digital')") == '1', 'marca a digital como ligada')
        # 5) app aberto de novo (a leitura da digital vale só até fechar o app): pede a digital e usa a sessão do aparelho
        pg.evaluate("sessionStorage.removeItem('dtcar-app-aberto')"); pg.evaluate('window.__chamadas = []'); pg.reload(); pg.wait_for_timeout(2500)
        t('Fulano' in textos(pg) and pg.locator('.nav').count() == 1, 'reabrir com a digital entra no app')
        t(pg.evaluate("sessionStorage.getItem('dtcar-app-aberto')") == '1', 'marca que a digital já foi lida nesta abertura')
        # voltando do sistema para a tela de botões (mesma abertura): não pede a digital de novo
        pg.reload(); pg.wait_for_timeout(1200)  # a lista de chamadas do plugin recomeça a cada carga da página
        t(pg.locator('.nav').count() == 1 and pg.evaluate('window.__chamadas.filter(x => x === "verify").length') == 0, 'voltar do sistema não pede a digital de novo')
        t(pg.evaluate('window.__cofre')['password'] == f.refresh, 'cofre acompanha a chave da sessão atual')
        # sair com a digital: só tranca
        n0 = len(f.pedidos); pg.click('text=SAIR DO APP'); pg.wait_for_timeout(2500)
        t('verify' in pg.evaluate('window.__chamadas'), 'sair com a digital tranca: ao abrir de novo pede a digital')
        t(any(p[1] == '/auth/v1/token' and 'refresh_token' in p[2] for p in f.pedidos[n0:]), 'depois de trancar, a sessão volta pelo cofre (não ficou no aparelho)')
        t(pg.evaluate("localStorage.getItem('dtcar-app-digital')") == '1' and pg.evaluate('window.__cofre') is not None, 'sair com a digital mantém o cofre')
        # digital cancelada: mostra o botão e avisa
        pg.evaluate("window.__ok = false; sessionStorage.removeItem('dtcar-app-aberto')"); pg.reload(); pg.wait_for_timeout(1200)
        t(pg.is_visible('text=ENTRAR COM A DIGITAL'), 'tela da digital aparece'); t('Não deu para ler a digital' in textos(pg) or pg.is_visible('#aviso'), 'avisa quando a leitura falha')
        # usar senha: apaga o cofre
        pg.click('text=Entrar com e-mail e senha'); pg.wait_for_timeout(600)
        t(pg.is_visible('#f-login') and pg.evaluate('window.__cofre') is None and pg.evaluate("localStorage.getItem('dtcar-app-digital')") is None, 'entrar com senha apaga o cofre e a marca')
        t(not f.escritas(), 'nenhuma gravação no banco'); t(not er, 'sem erro de script: %s' % er); ctx.close()
        # 6) chave de renovação inválida no cofre: volta para a senha e apaga o cofre
        f = Fake(); ctx, pg, er = abrir(br, f, URL); entrar(pg); pg.click('text=LIGAR A DIGITAL'); pg.wait_for_timeout(500)
        f.refresh = 'outra'; pg.evaluate("Object.keys(localStorage).filter(k => k.indexOf('auth-token') > 0).forEach(k => localStorage.removeItem(k)); sessionStorage.removeItem('dtcar-app-aberto')"); pg.reload(); pg.wait_for_timeout(1500)
        t(pg.is_visible('#f-login') and 'Entre com a senha de novo' in textos(pg), 'cofre vencido pede a senha')
        t(pg.evaluate('window.__cofre') is None, 'cofre vencido é apagado'); ctx.close()
        # 7) perfil não permitido na digital: recusa e apaga o cofre
        f = Fake(); ctx, pg, er = abrir(br, f, URL); entrar(pg); pg.click('text=LIGAR A DIGITAL'); pg.wait_for_timeout(500)
        f.papel = 'mecanico'; pg.evaluate("sessionStorage.removeItem('dtcar-app-aberto')"); pg.reload(); pg.wait_for_timeout(1500)
        t('Este app não está liberado para o seu login' in textos(pg) and pg.evaluate('window.__cofre') is None, 'papel mudado para mecânico é barrado na digital'); ctx.close()
        # 8) telas do protótipo com as regras do sistema (dados de mentira)
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t(pg.evaluate("getComputedStyle(document.querySelector('.barra')).backgroundColor") == 'rgb(47, 111, 181)', 'botões na cor azul da DTCar')
        t(pg.locator('.barra').first.bounding_box()['height'] >= 44, 'botão com altura de toque')
        # Início: placa do cadastro → carro aparece, sem consulta paga; a placa NÃO passa para as outras telas
        buscar_placa(pg); t('GOL 1.0' in textos(pg) and 'JOÃO DA SILVA' in textos(pg), 'placa do cadastro mostra o carro e o dono no Início')
        t(not any('/functions/v1/placa' in p[2] for p in f.pedidos), 'placa do cadastro não chama a consulta paga')
        tela(pg, 'oleo'); t(pg.input_value('#ol-placa') == '' and pg.locator('#veic').count() == 0, 'a placa do Início não vai para a tela de óleo')
        def placa_na_tela(id_):
            pg.fill('#' + id_, 'abc1d23'); pg.click('button[aria-label="Buscar pela placa"]'); pg.wait_for_selector('#veic', timeout=5000)
        # Óleo: litragem, viscosidade e filtros, com o estoque na frente
        placa_na_tela('ol-placa'); pg.wait_for_selector('#ol-oleo', timeout=20000); tx = textos(pg)
        t('Litragem' in tx and ' L' in tx and 'Viscosidade' in tx, 'óleo mostra litragem e viscosidade pela placa')
        t(pg.locator('.oleo-linha .visc').count() >= 1 and pg.locator('.oleo-linha .visc').first.inner_text().strip() not in ('', '—') and 'Norma' in tx and 'Fonte' in tx and pg.locator('text=Ver detalhes').count() == 0 and 'Ver +' not in tx, 'viscosidade em destaque com norma e fonte à vista, sem "Ver detalhes"')
        t('Filtro de óleo' in tx and 'Em estoque' in tx and 'PSL560' in tx, 'filtro de óleo do estoque aparece em primeiro')
        pg.click('text=Ocultar filtros'); pg.wait_for_timeout(200); t(pg.locator('#ol-filtros').count() == 0 and pg.is_visible('text=Ver filtros'), 'botão esconde os filtros')
        # sair da tela e voltar: a placa foi embora
        tela(pg, 'peca'); tela(pg, 'oleo'); t(pg.input_value('#ol-placa') == '' and pg.locator('#veic').count() == 0, 'sair da tela sem gravar limpa a placa')
        # Peça por catálogo: sistemas primeiro, resultado só depois de tocar no sistema
        tela(pg, 'peca'); placa_na_tela('pc-placa'); pg.wait_for_selector('#pc-sistemas', timeout=30000)
        t(pg.locator('.res-titulo').count() == 0 and pg.locator('text=Adicionar item').count() == 0, 'antes de escolher o sistema não aparece resultado')
        nomes = pg.locator('.sistema span').all_inner_texts(); t(nomes == ['Freios', 'Transmissão', 'Direção', 'Suspensão', 'Motor', 'Outros'], 'sistemas com ícone: %s' % nomes)
        t(not pg.locator('.sistema[data-sistema=fr]').is_disabled() and 'peças' in pg.locator('.sistema[data-sistema=fr]').inner_text(), 'Freios mostra a quantidade de peças')
        pg.click('.sistema[data-sistema=fr]'); pg.wait_for_selector('.res-titulo', timeout=10000); tx = textos(pg).upper()
        t('RESULTADO DA PESQUISA' in tx and 'FREIO' in tx and 'AMORTECEDOR' not in tx, 'só peças de freio no resultado de Freios')
        # fotos do acervo do catálogo: miniatura na peça que tem foto; toca e amplia (16/11 à noite)
        pg.wait_for_timeout(800); nf = pg.locator('.foto-peca-btn').count(); t(nf >= 1, 'peças de freio com foto mostram a miniatura: %d' % nf)
        src = pg.locator('.foto-peca-btn img').first.get_attribute('src'); t('/catalogo/fotos/' in src and src.endswith('.jpg'), 'a miniatura vem do acervo catalogo/fotos: %s' % src)
        pg.locator('.foto-peca-btn').first.click(); pg.wait_for_selector('.quadro .foto-peca.grande', timeout=5000); t('Aplicação' in textos(pg) and pg.locator('.quadro button:has-text("Adicionar item")').count() == 1, 'a foto ampliada abre com a aplicação e o botão de adicionar')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(300); t(pg.locator('.quadro').count() == 0 and pg.locator('.res-titulo').count() >= 1 and pg.locator('#pc-sistemas').count() == 0, 'fechar a foto ampliada volta ao resultado')
        pg.click('button[aria-label="Voltar aos sistemas"]'); pg.wait_for_selector('#pc-sistemas'); pg.click('.sistema[data-sistema=su]'); pg.wait_for_selector('.res-titulo', timeout=10000)
        t('AMORTECEDOR' in textos(pg).upper(), 'Suspensão mostra amortecedores')
        pg.fill('#pc-q', 'amortecedor'); pg.wait_for_timeout(400); n1 = pg.locator('text=Adicionar item').count(); t(n1 > 0, 'filtro por texto dentro do sistema')
        pg.locator('text=Adicionar item').first.click(); pg.wait_for_timeout(300); t('Ver lista (1)' in textos(pg), 'adicionar item põe na lista')
        pg.click('button:has-text("Ver lista (1)")'); pg.wait_for_selector('.quadro', timeout=5000); t(pg.locator('.quadro .item-linha').count() == 1, 'quadro da lista mostra o item')
        pg.click('.quadro >> text=Tirar'); pg.wait_for_timeout(200); t('A lista está vazia' in textos(pg), 'tirar da lista'); pg.click('.quadro >> text=Fechar'); pg.wait_for_timeout(200)
        # Histórico: O.S. do carro, da mais nova para a mais antiga, com os serviços
        tela(pg, 'historico'); placa_na_tela('hs-placa'); pg.wait_for_selector('text=REVISÃO COMPLETA', timeout=10000); tx = textos(pg)
        t(tx.index('10/11/2026') < tx.index('02/09/2026') and 'PASTILHAS DE FREIO DIANTEIRAS' in tx and 'SUBST. DE ÓLEO E FILTROS' in tx, 'histórico lista as O.S. com os serviços, da mais nova para a mais antiga')
        t('80.000 km' in tx and 'OS 01920' in tx, 'histórico mostra KM e número da O.S.')
        # Consultar O.S.: abertura, situação, serviços, total e link para a O.S. no modo app
        tela(pg, 'osconsulta'); placa_na_tela('oc-placa'); tx = textos(pg)
        t('OS 01920' in tx and 'Aprovado · em execução' in tx and 'R$\xa0900,00' in tx and 'Fechada' in tx, 'consulta de O.S. mostra situação escrita e total')
        t(pg.locator('a[href*="index.html"]').count() == 0 and pg.locator('button[data-os="o2"]').count() == 1, 'nenhum link para o sistema: a O.S. abre no leiaute do app')
        pg.click('button[data-os="o2"]'); pg.wait_for_selector('.quadro', timeout=10000); pg.wait_for_timeout(500); q = pg.inner_text('.quadro')
        t('OS 01920' in q and 'Aprovado · em execução' in q and 'REVISÃO COMPLETA' in q and 'PASTILHAS DE FREIO DIANTEIRAS' in q and 'R$\xa0900,00' in q, 'quadro da O.S. no app: etapa escrita, serviços e total (administrador vê valores)')
        pg.click('#os-orcar'); pg.fill('#os-area', 'Orçar também o terminal de direção'); pg.click('#os-orcar-gravar'); pg.wait_for_timeout(700)
        t(len(f.tabela('eventos')) == 1 and f.tabela('eventos')[0]['tipo'] == 'a_orcar' and f.tabela('eventos')[0]['texto'] == 'Orçar também o terminal de direção' and f.tabela('eventos')[0]['usuario_nome'] == 'Fulano de Teste', 'itens a orçar vão para o histórico da O.S. (evento a_orcar) com o nome: %s' % f.tabela('eventos'))
        t('Orçar também o terminal de direção' in pg.inner_text('.quadro') and 'Itens a orçar' in pg.inner_text('.quadro'), 'o quadro mostra o que foi pedido')
        pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        pg.click('button[data-os="o1"]'); pg.wait_for_selector('.quadro'); pg.wait_for_timeout(400); t(pg.locator('#os-orcar').count() == 0 and 'Fechada' in pg.inner_text('.quadro'), 'O.S. fechada não aceita itens a orçar'); pg.keyboard.press('Escape')
        # Orçamentos: avisos (aprovado), abertos, pedido novo pelo app (sem item e sem preço) e acréscimo ao pedido
        tela(pg, 'orcamento'); tx = textos(pg)
        t('ORC-00006 aprovado' in tx and 'OS 01920' in tx and 'ORC-00007' not in tx, 'aviso de aprovado só para quem pediu, com o número da O.S.')
        # barra de uma linha (regra do Danilo, 17/11): o pedido só aparece ao tocar
        t('ORC-00005' in tx and 'Enviado' in tx and 'Barulho na suspensão' not in tx and 'ORC-00006' not in tx.split('Orçamentos abertos')[1], 'lista só os orçamentos abertos, fechados numa barra de uma linha')
        pg.click('button[data-orc="orc1"]'); pg.wait_for_timeout(300); t('Barulho na suspensão' in textos(pg) and pg.locator('button[data-acrescentar="orc1"]').count() == 1, 'tocar na barra abre o pedido e o botão de acrescentar')
        t(pg.locator('.bolinha').count() >= 1 and pg.locator('.abas .bolinha').inner_text() == '1', 'a aba Orçamentos mostra 1 aviso')
        pg.click('button[data-visto="orc2"]'); pg.wait_for_timeout(500); t('ORC-00006 aprovado' not in textos(pg) and pg.locator('.bolinha').count() == 0, 'OK no aviso tira o aviso (fica guardado no aparelho)')
        # função ainda não publicada no Supabase (404 sem CORS): a mensagem diz a causa certa, não "sem internet" (bug visto pelo Danilo em 16/11 às 21h)
        f.sem_funcao = True; pg.click('button[data-acrescentar="orc1"]'); pg.fill('#ac-area', 'Palhetas'); pg.click('#ac-gravar'); pg.wait_for_timeout(1500)
        t('falta publicar a função "pedido"' in textos(pg) and 'Confira a internet' not in textos(pg), 'função não publicada: avisa que falta publicar, não culpa a internet: %s' % textos(pg)[-300:])
        f.sem_funcao = False; pg.click('#ac-gravar'); pg.wait_for_timeout(800)
        t(f.funcao_pedido[-1] == {'acao': 'acrescentar', 'id': 'orc1', 'texto': 'Palhetas'} and '— Fulano de Teste, 16/11/2026 15:31: Palhetas' in textos(pg), 'acrescentar manda o texto para a função pedido e mostra a linha no pedido')
        pg.click('#orc-novo'); pg.wait_for_selector('#pd-area'); pg.click('#pd-enviar'); pg.wait_for_timeout(300); t('Busque a placa ou informe o nome' in textos(pg), 'pedido novo exige placa ou cliente')
        pg.wait_for_timeout(600); pg.fill('#pd-placa', 'abc1d23'); pg.keyboard.press('Enter'); pg.wait_for_selector('#veic', timeout=5000); t('JOÃO DA SILVA' in textos(pg) and pg.locator('#pd-nome').count() == 0, 'placa do cadastro traz carro e dono; não pede o nome')
        pg.click('#pd-enviar'); pg.wait_for_timeout(300); t('Marque os itens nos sistemas do carro ou escreva' in textos(pg), 'pedido novo exige itens ou texto')
        # sistemas do carro (18/11): Freios → pastilha pede a posição; marca Dianteira; bieleta 2 un.
        t(pg.locator('#sis-carro [data-sis]').count() >= 6 and 'Freios' in pg.inner_text('#sis-carro'), 'pedido mostra os sistemas do carro com ícones')
        pg.click('#sis-carro [data-sis="fr"]'); pg.wait_for_selector('#sis-pecas'); pg.click('[data-peca="Pastilha de freio"] .peca-topo'); pg.wait_for_timeout(200)
        pg.click('#pd-enviar'); pg.wait_for_timeout(300); t('Escolha a posição' in textos(pg), 'item marcado sem posição não envia')
        pg.click('[data-peca="Pastilha de freio"] .peca-pos button:has-text("Diant.")'); pg.click('button:has-text("Pronto: voltar aos sistemas")'); pg.click('#sis-carro [data-sis="sd"]'); pg.wait_for_selector('#sis-pecas')
        pg.click('[data-peca="Bieleta"] .peca-topo'); pg.click('[data-peca="Bieleta"] .peca-q button:has-text("2")'); pg.click('button:has-text("Pronto: voltar aos sistemas")'); pg.wait_for_timeout(200)
        t('SUBST. PASTILHA DE FREIO DIANTEIRA' in pg.inner_text('#pd-marcados') and '2× SUBST. BIELETA' in pg.inner_text('#pd-marcados') and pg.locator('#sis-carro [data-sis="fr"] .bolinha').inner_text() == '1', 'lista dos marcados com nome, posição e quantidade')
        pg.fill('#pd-area', 'Pastilhas e discos dianteiros'); pg.evaluate("(() => { const b = document.querySelector('#pd-enviar'); b.click(); b.click(); })()"); pg.wait_for_selector('.quadro', timeout=10000); pg.wait_for_timeout(400)
        novos = [d for d in f.funcao_pedido if d['acao'] == 'novo']
        t(len(novos) == 1 and novos[0]['texto'] == 'Pastilhas e discos dianteiros' and novos[0].get('itens') == [{'descricao': 'SUBST. PASTILHA DE FREIO DIANTEIRA', 'qtd': 1}, {'descricao': 'SUBST. BIELETA', 'qtd': 2}] and novos[0]['placa'] == 'ABC1D23' and novos[0]['veiculo_id'] == 'v1' and novos[0]['cliente_id'] == 'c1' and novos[0]['cliente']['nome'] == 'JOÃO DA SILVA' and not any('valor_unit' in i for i in novos[0]['itens']) and not f.tabela('rpc/orcamento_salvar'), 'pedido vai pela função pedido (itens sem preço, sem orcamento_salvar; dois toques = um pedido): %s' % novos)
        t('ORC-00012 enviado' in textos(pg) and pg.locator('a[href*="index.html"]').count() == 0, 'quadro confirma o envio sem levar ao sistema')
        pg.click('#pd-entendi'); pg.wait_for_timeout(400); t('ORC-00012' in textos(pg), 'o pedido novo aparece em Orçamentos abertos'); pg.click('button[data-orc="orc-app12"]'); pg.wait_for_timeout(300); t('Pastilhas e discos dianteiros' in textos(pg), 'abrir a barra do pedido novo mostra o texto')
        # pedido para carro fora do cadastro: modelo à mão e cliente digitado
        pg.click('#orc-novo'); pg.wait_for_selector('#pd-area'); pg.wait_for_timeout(800); pg.fill('#pd-placa', 'XYZ9A88'); pg.keyboard.press('Enter'); pg.wait_for_selector('.achou.nao:has-text("Digite o modelo")', timeout=8000)
        pg.fill('#mm-modelo', 'onix 1.0'); pg.fill('#mm-ano', '2020'); pg.fill('#pd-nome', 'Maria Nova'); pg.fill('#pd-whats', '27988887777'); pg.fill('#pd-area', 'Troca de óleo'); pg.click('#pd-enviar'); pg.wait_for_selector('.quadro', timeout=10000)
        d = f.funcao_pedido[-1]; t(d['placa'] == 'XYZ9A88' and d['veiculo'] == {'marca': '', 'modelo': 'ONIX 1.0', 'ano': '2020'} and d['cliente'] == {'nome': 'MARIA NOVA', 'telefone': '27988887777'} and d['veiculo_id'] == '' and not f.tabela('clientes') and not f.tabela('veiculos'), 'carro e cliente só digitados vão no pedido, sem cadastrar: %s' % d)
        pg.click('#pd-entendi'); pg.wait_for_timeout(200)
        pg.click('#orc-novo'); pg.wait_for_selector('#pd-area'); pg.wait_for_timeout(800); pg.fill('#pd-placa', 'abc1d23'); pg.keyboard.press('Enter'); pg.wait_for_selector('#veic'); pg.goto(URL + '#/ajuda'); pg.wait_for_selector('.nav'); tela(pg, 'orcamento')
        t(pg.locator('#pd-area').count() == 0 and pg.locator('#orc-abertos').count() == 1, 'sair do pedido sem enviar volta à lista e limpa tudo')
        # Início: consulta rápida da placa mostra O.S. e orçamentos abertos e o histórico, e abre a O.S. no app
        pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra'); buscar_placa(pg); pg.wait_for_selector('#ini-situacao'); tx = pg.inner_text('#ini-situacao')
        t('OS 01920' in tx and 'Aprovado · em execução' in tx and 'ORC-00005' in tx and 'ORC-00012' in tx and 'Histórico de serviços' in tx and 'OS 01900' in tx and 'R$' not in tx, 'Início: situação da placa com O.S. e orçamentos abertos e o histórico, sem preço')
        pg.click('#ini-situacao button:has-text("OS 01920")'); pg.wait_for_selector('.quadro'); pg.wait_for_timeout(600); t('REVISÃO COMPLETA' in pg.inner_text('.quadro'), 'tocar na O.S. do Início abre o quadro da O.S.'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        # Agendar: calendário do mês inteiro com feriados; grava na agenda e abre a mensagem do WhatsApp pronta
        f.gravados.clear(); tela(pg, 'agendar'); placa_na_tela('ag-placa'); pg.wait_for_timeout(300)
        t(pg.input_value('#ag-nome') == 'JOÃO DA SILVA' and pg.input_value('#ag-whats') == '(27) 99999-0000', 'agendar entra com o dono do carro')
        t(pg.locator('.cal-dia').count() >= 28 and pg.locator('.cal-sem span').count() == 7, 'calendário do mês inteiro')
        t(pg.locator('.cal-dia[aria-pressed=true]').inner_text().startswith(str(int(HOJE[8:10]))) and str(int(HOJE[8:10])) in pg.locator('.cal-dia[aria-pressed=true]').inner_text(), 'hoje vem marcado')
        t(pg.locator('.cal-dia[aria-pressed=true] i').inner_text() == '2', 'o dia mostra quantos serviços já tem (cancelado não conta)')
        # vai até dezembro: Natal em laranja (feriado), com o nome ao escolher
        while 'dezembro' not in pg.locator('#ag-mes').inner_text(): pg.click('button[aria-label="Próximo mês"]'); pg.wait_for_timeout(150)
        natal = pg.locator('.cal-dia.feriado', has_text='25'); t(natal.count() == 1 and 'Natal' in natal.get_attribute('aria-label') and pg.evaluate("getComputedStyle(document.querySelector('.cal-dia.feriado')).backgroundColor") == 'rgb(255, 241, 220)', 'feriado em cor diferente com o nome: %s' % (natal.count() and natal.get_attribute('aria-label')))
        natal.click(); pg.wait_for_timeout(200); t('Natal' in pg.inner_text('#ag-feriado') and 'feriado: Natal' in pg.inner_text('.acao .resumo'), 'escolher o feriado avisa e deixa agendar')
        # virada de ano e feriados móveis (Páscoa 2025/2026/2027), conferidos pelo próprio módulo
        pg.click('button[aria-label="Próximo mês"]'); pg.wait_for_timeout(200); t('janeiro de %d' % (int(HOJE[:4]) + 1) in pg.locator('#ag-mes').inner_text() and pg.locator('.cal-dia.feriado', has_text='1').first.get_attribute('aria-label').endswith('Confraternização Universal'), 'calendário vira o ano e marca o Ano-Novo')
        fer = pg.evaluate("""async () => { const m = await import('./telas.js'); const f26 = m.feriadosDoAno(2026), f27 = m.feriadosDoAno(2027), f25 = m.feriadosDoAno(2025);
          return [f26['2026-04-03'], f26['2026-02-16'], f26['2026-02-17'], f26['2026-06-04'], f26['2026-04-13'], f27['2027-03-26'], f25['2025-04-18'], f26['2026-08-22'], f26['2026-11-20']]; }""")
        t(fer == ['Sexta-feira Santa', 'Carnaval', 'Carnaval', 'Corpus Christi', 'N. Sra. da Penha (ES)', 'Sexta-feira Santa', 'Sexta-feira Santa', 'Aniversário de Colatina', 'Consciência Negra'], 'feriados móveis e locais certos: %s' % fer)
        while 'dezembro' not in pg.locator('#ag-mes').inner_text(): pg.click('button[aria-label="Mês anterior"]'); pg.wait_for_timeout(150)
        while 'dezembro' in pg.locator('#ag-mes').inner_text(): pg.click('button[aria-label="Mês anterior"]'); pg.wait_for_timeout(150)
        t(pg.locator('button[aria-label="Mês anterior"]').is_disabled(), 'não volta para antes do mês atual')
        pg.click('.btn-chip:has-text("Freios")'); pg.click('.hora:has-text("09:30")'); pg.locator('.cal-dia:not([disabled])').last.click(); pg.wait_for_timeout(200)
        dia_escolhido = pg.locator('.cal-dia[aria-pressed=true]').get_attribute('aria-label')
        t('Freios' in pg.inner_text('.acao .resumo') and '09:30' in pg.inner_text('.acao .resumo'), 'resumo mostra serviço, dia e horário')
        t(pg.locator('.zap-mini').count() == 1 and pg.locator('.marcar').count() == 0, 'aviso pelo WhatsApp é um botão pequeno (sem o botão grande)')
        pg.click('text=Agendar e avisar o cliente'); pg.wait_for_selector('.quadro', timeout=10000)
        ag = f.tabela('agendamentos'); t(len(ag) == 1 and ag[0]['servico'] == 'Freios' and ag[0]['hora'] == '09:30' and ag[0]['cliente_id'] == 'c1' and ag[0]['veiculo_id'] == 'v1' and ag[0]['situacao'] == 'agendado' and ag[0]['data'][:7] == HOJE[:7], 'agendamento gravado: %s' % (ag and ag[0]))
        zap = pg.locator('.quadro a:has-text("WhatsApp")').get_attribute('href'); t(zap.startswith('https://wa.me/5527999990000') and 'Freios' in __import__('urllib.parse').parse.unquote(zap) and 'Mensagem%20gerada%20pelo%20sistema' in zap.replace('+', '%20'), 'mensagem do WhatsApp pronta no padrão da DTCar')
        pg.click('.quadro >> text=Voltar ao Início'); pg.wait_for_selector('.barra')
        t(not er, 'sem erro de script nas telas: %s' % er); ctx.close()
        # botão Voltar do celular (plugin App de mentira): fecha o quadro, volta ao Início e só no Início deixa o app de lado
        f = Fake(); ctx, pg, er = abrir(br, f, URL); entrar(pg); t(pg.is_visible('.quadro'), 'quadro da digital aberto')
        t(pg.evaluate('typeof window.__voltar') == 'function', 'o app registra o botão Voltar do celular')
        pg.evaluate('window.__voltar()'); pg.wait_for_timeout(300); t(pg.locator('.quadro').count() == 0 and pg.evaluate('window.__app') == [], 'Voltar fecha o quadro da digital sem sair do app')
        tela(pg, 'peca'); pg.click('button:has-text("Ver lista")'); pg.wait_for_selector('.quadro')
        pg.evaluate('window.__voltar()'); pg.wait_for_timeout(300); t(pg.locator('.quadro').count() == 0 and pg.url.endswith('#/peca'), 'Voltar fecha o quadro e fica na tela')
        # Voltar volta uma tela por vez (pedido do Danilo, 16/11 à noite): inicio → peca → oleo → historico, e volta na ordem
        tela(pg, 'oleo'); tela(pg, 'historico')
        pg.evaluate('window.__voltar()'); pg.wait_for_timeout(400); t(pg.url.endswith('#/oleo'), 'Voltar sai do Histórico para o Óleo (tela anterior), não para o Início: %s' % pg.url)
        pg.evaluate('window.__voltar()'); pg.wait_for_timeout(400); t(pg.url.endswith('#/peca'), 'Voltar de novo vai para Peças: %s' % pg.url)
        # dentro de Peças: sistema escolhido é um passo; o Voltar desfaz antes de trocar de tela
        placa_na_tela('pc-placa'); pg.wait_for_selector('#pc-sistemas', timeout=30000); pg.click('.sistema[data-sistema=fr]'); pg.wait_for_selector('.res-titulo', timeout=10000)
        pg.evaluate('window.__voltar()'); pg.wait_for_timeout(400); t(pg.url.endswith('#/peca') and pg.locator('#pc-sistemas').count() == 1, 'Voltar com o sistema escolhido volta para a escolha dos sistemas')
        pg.evaluate('window.__voltar()'); pg.wait_for_timeout(400); t(pg.url.endswith('#/inicio') and pg.evaluate('window.__app') == [], 'Voltar numa tela vai ao Início sem sair do app')
        pg.evaluate('window.__voltar()'); pg.wait_for_timeout(300); t(pg.evaluate('window.__app') == ['minimize'], 'Voltar no Início deixa o app de lado (não encerra)')
        # voltou ao Início pela barra de baixo: o Voltar no Início continua deixando o app de lado (revisão: a pilha não pode levar de volta a Peças)
        tela(pg, 'peca'); pg.click('.nav a[href="#/inicio"]'); pg.wait_for_timeout(400); pg.evaluate('window.__voltar()'); pg.wait_for_timeout(300)
        t(pg.evaluate('window.__app') == ['minimize', 'minimize'] and pg.url.endswith('#/inicio'), 'Voltar no Início (depois de passar por Peças) deixa o app de lado, não volta a Peças')
        # placa do Início fica guardada ao sair e voltar; some ao limpar
        pg.goto(URL + '#/inicio'); pg.wait_for_selector('#ini-placa'); buscar_placa(pg); tela(pg, 'oleo'); pg.goto(URL + '#/inicio'); pg.wait_for_selector('#ini-placa'); pg.wait_for_timeout(400)
        t(pg.locator('#veic').count() == 1 and pg.input_value('#ini-placa') == 'ABC1D23', 'a placa buscada no Início continua lá depois de sair e voltar')
        pg.click('button[aria-label="Limpar"]'); pg.wait_for_timeout(200); tela(pg, 'oleo'); pg.goto(URL + '#/inicio'); pg.wait_for_selector('#ini-placa'); pg.wait_for_timeout(300)
        t(pg.locator('#veic').count() == 0 and pg.input_value('#ini-placa') == '', 'limpar tira a placa guardada'); ctx.close()
        # Iniciar serviço (v60): O.S. pela placa → iniciar; um por vez; pausar com motivo; retomar; finalizar marcando o feito e indicando responsável
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg); tela(pg, 'servico')
        t('Qual carro vai mexer' in textos(pg) and pg.locator('[data-iniciar]').count() == 0, 'sem placa: pede o carro')
        pg.fill('#sv-placa', 'abc1d23'); pg.keyboard.press('Enter'); pg.wait_for_selector('[data-iniciar="o2"]', timeout=8000); pg.wait_for_timeout(600); tx = textos(pg)
        t('OS 01920' in tx and 'Revisão e freios' in tx and 'REVISÃO COMPLETA' in tx and 'R$' not in tx and pg.locator('[data-iniciar]').count() == 1, 'placa com O.S. aberta mostra o que fazer, sem preço, só a O.S. aberta (a fechada não)')
        pg.click('[data-iniciar="o2"]'); pg.wait_for_selector('[data-pausar]', timeout=8000); pg.wait_for_timeout(400)
        t(f.apont and f.apont[-1]['ordem_id'] == 'o2' and f.apont[-1]['perfil_id'] == UID and f.apont[-1]['situacao'] == 'andamento', 'Iniciar grava o apontamento em andamento: %s' % (f.apont[-1:] or None))
        t('Em andamento · OS 01920' in textos(pg) and pg.locator('#sv-placa').count() == 1, 'o serviço em andamento aparece no topo e ainda dá para buscar outro carro')
        # outro carro com O.S. aberta não inicia enquanto há um em andamento
        f_ord = ORD[1]; pg.fill('#sv-placa', 'abc1d23'); pg.keyboard.press('Enter'); pg.wait_for_timeout(800)
        t(pg.locator('[data-iniciar]').count() == 0, 'a O.S. que já está em andamento não aparece de novo para iniciar')
        pg.click('[data-pausar]'); pg.wait_for_selector('.quadro'); pg.click('.btn-chip:has-text("Aguardando peças")'); pg.click('#sv-pausar-ok'); pg.wait_for_timeout(600)
        t(f.apont[-1]['situacao'] == 'pausado' and f.apont[-1]['motivo_pausa'] == 'Aguardando peças' and len(f.apont[-1]['pausas']) == 1 and 'Pausado · OS 01920' in textos(pg), 'pausar grava o motivo e a hora: %s' % f.apont[-1])
        pg.click('[data-retomar]'); pg.wait_for_timeout(600)
        t(f.apont[-1]['situacao'] == 'andamento' and f.apont[-1]['pausas'][0].get('retomado_em'), 'retomar fecha a pausa')
        pg.click('[data-finalizar]'); pg.wait_for_selector('#sv-fim-ok'); pg.check('[data-feito="i2"]'); pg.select_option('[data-resp="i3"]', 'outra-pessoa'); pg.click('#sv-fim-ok'); pg.wait_for_timeout(800)
        ap = f.apont[-1]; t(ap['situacao'] == 'finalizado' and ap['fim'] and ap['itens_executados'] == ['i2'] and ap['indicacoes'][0]['para_id'] == 'outra-pessoa' and ap['indicacoes'][0]['descricao'] == 'PASTILHAS DE FREIO DIANTEIRAS', 'finalizar grava itens executados e a indicação do responsável: %s' % ap)
        t(any(tb == 'os_itens' and any(x.get('executado') is True and x.get('id') == 'i2' and 'valor_unit' not in x and 'aprovado' not in x for x in (c if isinstance(c, list) else [c])) for tb, c in f.gravados), 'o item feito fica marcado como executado na O.S. (só a coluna executado, sem preço)')
        t(pg.locator('[data-pausar]').count() == 0 and pg.locator('[data-finalizar]').count() == 0, 'depois de finalizar não há serviço aberto')
        # carro sem O.S. aberta: vai para o pedido de orçamento com a placa já buscada (contato opcional)
        pg.fill('#sv-placa', 'qxn1e49'); pg.keyboard.press('Enter'); pg.wait_for_selector('#sv-pedir', timeout=8000); pg.click('#sv-pedir'); pg.wait_for_selector('#pd-area', timeout=8000); pg.wait_for_timeout(800)
        t(pg.url.endswith('#/orcamento') and pg.input_value('#pd-placa') == 'QXN1E49', 'sem O.S.: abre o pedido de orçamento com a placa: %s' % pg.input_value('#pd-placa'))
        # indicação recebida: aviso com OK (marca como visto)
        f.apont.append({'id': 'ap-x', 'ordem_id': 'o2', 'os_numero': 1920, 'perfil_id': 'outra-pessoa', 'perfil_nome': 'Beto Mecânico', 'situacao': 'finalizado', 'inicio': '2026-11-16T12:00:00Z', 'fim': '2026-11-16T13:00:00Z', 'motivo_pausa': '', 'pausas': [], 'itens_executados': [], 'indicacoes': [{'item_id': 'i3', 'descricao': 'ALINHAMENTO', 'para_id': UID, 'para_nome': 'Fulano de Teste', 'em': '2026-11-16T13:00:00Z', 'visto_em': None}]})
        pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra'); pg.wait_for_timeout(1500)
        t(pg.locator('.barra:has-text("INICIAR SERVIÇO") .bolinha').inner_text() == '1', 'indicação para mim aparece na bolinha de Iniciar serviço')
        tela(pg, 'servico'); pg.wait_for_selector('[data-indicacao="ap-x"]'); t('Beto Mecânico' in textos(pg) and 'ALINHAMENTO' in textos(pg), 'o aviso diz quem indicou e o quê')
        pg.click('[data-indicacao="ap-x"]'); pg.wait_for_timeout(800); t(f.vistos == ['ap-x'] and pg.locator('[data-indicacao]').count() == 0, 'OK marca a indicação como vista')
        # Agenda (lista): administrador vê todos com o mecânico; Meus serviços: por quinzena
        tela(pg, 'agenda'); pg.wait_for_timeout(800); tx = textos(pg)
        t('JOÃO DA SILVA' in tx and 'MARIA' in tx and 'Beto' in tx and 'Revisão' in tx and pg.locator('.ag-item').count() == 2, 'administrador vê todos os agendamentos (cancelado não) com o mecânico')
        tela(pg, 'meus'); pg.wait_for_timeout(800); tx = textos(pg)
        t('1 carro(s)' in tx and 'OS 01920' in tx and ('1 a 15' in tx or '16 a' in tx) and 'Beto' not in tx.split('MEUS SERVIÇOS')[1], 'Meus serviços agrupa por quinzena e mostra só os meus')
        t(not er, 'sem erro de script no serviço: %s' % er); ctx.close()
        # mecânico: na agenda só os dele
        f = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['agenda', 'servico']}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg); tela(pg, 'agenda'); pg.wait_for_timeout(800); tx = textos(pg)
        t('JOÃO DA SILVA' in tx and 'MARIA' not in tx and pg.locator('.ag-item').count() == 1, 'mecânico vê só os agendamentos em que é o mecânico'); ctx.close()
        # consultor: vê os valores e o aviso de somente leitura na consulta de O.S.
        f = Fake('consultor'); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg); tela(pg, 'osconsulta'); placa_na_tela('oc-placa'); tx = textos(pg)
        t('R$\xa0900,00' in tx and 'Somente leitura' not in tx, 'consultor vê valores'); ctx.close()
        # mecânico liberado: sem preço em lugar nenhum; só o responsável pela O.S. acrescenta itens a orçar
        ORD[1]['mecanico_id'] = UID; ORD[1]['mecanico_nome'] = 'Fulano de Teste'
        f = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['orcamento', 'osconsulta', 'historico']}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        tela(pg, 'osconsulta'); placa_na_tela('oc-placa'); tx = textos(pg); t('R$' not in tx and 'Total' not in tx, 'mecânico não vê preço na consulta de O.S.')
        pg.click('button[data-os="o2"]'); pg.wait_for_selector('.quadro'); pg.wait_for_timeout(400); q = pg.inner_text('.quadro')
        t('R$' not in q and pg.locator('#os-orcar').count() == 1 and 'Responsável: Fulano de Teste' in q, 'mecânico responsável vê a O.S. sem preço e pode acrescentar itens a orçar'); pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
        ORD[1]['mecanico_id'] = 'outro'; ORD[1]['mecanico_nome'] = 'Outro Mecânico'; ctx.close()
        f = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['orcamento', 'osconsulta']}}); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        tela(pg, 'osconsulta'); placa_na_tela('oc-placa'); pg.click('button[data-os="o2"]'); pg.wait_for_selector('.quadro'); pg.wait_for_timeout(400)
        t(pg.locator('#os-orcar').count() == 0 and 'Só o mecânico responsável' in pg.inner_text('.quadro'), 'mecânico que não é o responsável não acrescenta itens a orçar'); pg.keyboard.press('Escape')
        tela(pg, 'orcamento'); t(pg.locator('#orc-novo').count() == 1 and 'R$' not in textos(pg), 'mecânico liberado pede orçamento, sem preço')
        # regra (17/11): o mecânico só vê os orçamentos que ele mesmo abriu (orc1 foi aberto por ele; orc-de-outro não)
        f.orcs.append({'id': 'orc-de-outro', 'numero': 9, 'situacao': 'elaboracao', 'cliente': {'nome': 'OUTRO CLIENTE'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0'}, 'reclamacao': 'pedido de outro', 'obs_internas': '', 'consultor_id': 'outra-pessoa', 'consultor_nome': 'Outra', 'criado_em': '2026-11-16T18:00:00Z', 'atualizado_em': '2026-11-16T18:00:00Z'})
        pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra'); pg.wait_for_timeout(1500); tela(pg, 'orcamento'); pg.wait_for_timeout(600); tx = textos(pg)
        t('ORC-00005' in tx and 'ORC-00009' not in tx, 'mecânico vê só os orçamentos que ele abriu: %s' % ('ORC-00009' in tx))

        ctx.close()
        del ORD[1]['mecanico_id']; del ORD[1]['mecanico_nome']
        # 8-B) DIAGNÓSTICO OBD (18/11/2026): leitura pelo adaptador ELM327, com um adaptador de mentira.
        # Etapa 1: só leitura. Confere que nada é gravado no banco e que nenhuma falha é apagada no carro.
        ctx.close()
        # sem o plugin nativo (APK antigo ou navegador comum): a tela explica em vez de quebrar
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg); tela(pg, 'obd')
        t('Precisa do APK novo' in textos(pg), 'sem o plugin nativo a tela manda gerar o APK novo')
        t(pg.locator('#obd-procurar').count() == 0, 'sem o plugin não oferece procurar adaptador')
        t(not er, 'tela do OBD sem plugin não dá erro de página: %s' % er); ctx.close()
        # com o adaptador de mentira
        VEI[0]['chassi'] = '9BWZZZ377VT004251'
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False, antes=FAKE_OBD); entrar(pg); tela(pg, 'obd')
        # guarda: se o plugin de mentira tiver erro de sintaxe ele simplesmente não registra, e aí
        # TODOS os testes do OBD falhariam por um motivo que não é o do app. Falhar aqui, com esta
        # frase, economiza a caça ao defeito errado.
        t(pg.evaluate("!!(window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.DtcarObd)"),
          'o plugin de mentira registrou (sem erro de sintaxe no FAKE_OBD)')
        t(pg.evaluate("typeof window.Capacitor.Plugins.DtcarObd.atuar === 'function'"),
          'e tem a camada que age no carro, como o APK novo')
        t(pg.is_visible('#obd-procurar'), 'com o plugin a tela oferece procurar o adaptador')
        pg.fill('#obd-placa', 'abc1d23'); pg.click('button[aria-label="Buscar pela placa"]'); pg.wait_for_selector('#veic', timeout=8000)
        pg.click('#obd-procurar'); pg.wait_for_selector('.obd-ap', timeout=10000)
        t('vLinker FS' in textos(pg), 'lista o adaptador pareado')
        t(pg.evaluate("window.__obd.chamadas.includes('permissao')"), 'confere a permissão de Bluetooth antes de listar')
        pg.click('.obd-ap'); pg.wait_for_selector('#obd-acoes', timeout=15000); tx = textos(pg)
        t('CONECTADO' in tx and 'ISO 15765-4' in tx, 'conecta e mostra o protocolo do carro: %s' % ('ISO 15765-4' in tx))
        cmds = pg.evaluate("window.__obd.cmds")
        t(cmds[:6] == ['ATZ', 'ATE0', 'ATL0', 'ATS0', 'ATH0', 'ATSP0'], 'prepara o adaptador na ordem certa: %s' % cmds[:6])
        # falhas
        pg.click('#obd-falhas'); pg.wait_for_selector('#obd-r-falhas', timeout=15000); tx = pg.inner_text('#obd-r-falhas')
        t('P0171' in tx and 'P0300' in tx and 'P0130' in tx, 'lê as falhas das três situações: %s' % tx.replace('\n', ' ')[:120])
        t('ATUAL' in tx and 'PENDENTE' in tx, 'mostra a situação de cada falha escrita, não só a cor')
        t(pg.locator('#obd-r-falhas .selo.ruim').count() == 2, 'as duas confirmadas vêm com o selo vermelho')
        # a falha vem explicada: descrição, causas prováveis e de onde o texto veio (js/obdfalhas.js)
        pg.wait_for_selector('#obd-r-falhas .fx-causas', timeout=15000); fx = pg.inner_text('#obd-r-falhas')
        t('CAUSAS PROVÁVEIS' in fx.upper() and 'Honda' in fx and 'SAE' in fx and fx.count('servem de roteiro') == 1, 'a falha lida vem com causas prováveis e a origem escrita: ' + fx[:200])
        t(pg.locator('#obd-r-falhas .fx-desc').count() >= 2, 'cada código tem a descrição embaixo')
        # UMA TELA POR VEZ (pedido do Danilo, 21/11/2026): com as falhas abertas, só elas na tela
        t(pg.locator('#obd-r-falhas').is_visible() and not pg.locator('#obd-placa').is_visible() and not pg.locator('#obd-adaptador').is_visible(), 'com as falhas abertas, a placa e o adaptador saem da frente')
        t(pg.locator('#obd-vivo').is_visible() and pg.locator('#obd-voltar-menu').is_visible(), 'o menu de leituras vira a tira de abas no alto, com o voltar')
        pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(200); pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'foco-falhas-celular.png'))
        cx = pg.locator('#obd-r-falhas').bounding_box(); t(cx and cx['y'] < 420, 'com a tira de abas, as falhas começam no alto da tela, sem rolar: y=%s' % (cx and round(cx['y'])))
        pg.click('#obd-voltar-menu'); pg.wait_for_timeout(300)
        t(not pg.query_selector('#obd-r-falhas') and pg.locator('#obd-adaptador').is_visible(), 'voltar traz o menu inteiro de novo')
        pg.click('#obd-falhas'); pg.wait_for_selector('#obd-r-falhas', timeout=15000)
        pg.eval_on_selector('#obd-r-falhas', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'falhas-explicadas-celular.png'))
        # LAUDO SELADO (Etapa 3): lê, monta, sela e guarda — e o que foi guardado leva o selo
        ng = len(f.gravados); pg.click('#obd-laudo'); pg.wait_for_selector('#obd-r-laudo', timeout=30000); tl = pg.inner_text('#obd-r-laudo')
        t('LAUDO DE DIAGNÓSTICO' in tl and 'MOTOR' in tl.upper() and 'P0171' in tl and 'SELADO' in tl and 'Não é parecer sobre peça' in tl, 'o laudo traz o carro, as falhas por módulo e diz que não é parecer de peça: ' + tl[:120].replace(chr(10), ' '))
        t('EM QUE CONDIÇÃO' in tl, 'o laudo diz em que condição a leitura foi feita')
        pg.eval_on_selector('#obd-r-laudo', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'laudo-celular.png'))
        lg = [c for (tab, c) in f.gravados[ng:] if tab == 'obd_leituras' and c.get('tipo') == 'laudo']
        t(len(lg) == 1 and len(lg[0].get('selo') or '') == 64 and lg[0]['dados']['carro']['placa'] == lg[0]['placa'], 'o laudo vai para o banco com o selo de 64 dígitos: %s' % [list(x.keys())[:4] for x in lg])
        pg.click('#obd-falhas'); pg.wait_for_selector('#obd-r-falhas', timeout=15000)
        t('P0043' not in tx and 'C3103' not in tx and 'P0201' not in tx, 'com dois módulos respondendo NÃO inventa código: %s' % tx.replace('\n', ' ')[:140])
        t('Mais de um módulo' in tx, 'avisa que mais de um módulo respondeu')
        # SEPARADO POR MÓDULO (pedido do Danilo, 21/11/2026): só quem respondeu aparece, cada um com as suas falhas
        mods = pg.locator('#obd-r-falhas .obd-mod'); t(mods.count() == 2, 'as falhas vêm separadas pelos dois módulos que responderam: %d' % mods.count())
        t('MOTOR' in mods.nth(0).inner_text().upper() and 'P0130' in mods.nth(0).inner_text() and 'P0171' not in mods.nth(0).inner_text(), 'o motor fica só com o código dele: ' + mods.nth(0).inner_text()[:80].replace(chr(10), ' '))
        t('CÂMBIO' in mods.nth(1).inner_text().upper() and 'P0171' in mods.nth(1).inner_text() and 'P0300' in mods.nth(1).inner_text(), 'e o câmbio com os dele')
        t(pg.evaluate('window.__obd.h1') is False, 'o cabeçalho é desligado de novo depois de separar')
        # chassi e monitores
        pg.click('#obd-conf'); pg.wait_for_selector('#obd-r-conf', timeout=15000); tx = pg.inner_text('#obd-r-conf')
        t('9BWZZZ377VT004251' in tx and 'CONFERE' in tx, 'confronta o chassi do módulo com o do cadastro: %s' % tx.replace('\n', ' ')[:120])
        t('ACESA' in tx, 'diz que a luz de injeção está acesa')
        t('NÃO PRONTO' in tx and 'apagada antes de o carro chegar' in tx, 'monitor não pronto avisa que a falha foi apagada há pouco')
        # chassi diferente do cadastro: a tela acusa
        VEI[0]['chassi'] = '9BWZZZ377VT999999'
        ctx.close(); f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False, antes=FAKE_OBD); entrar(pg); tela(pg, 'obd')
        pg.fill('#obd-placa', 'abc1d23'); pg.click('button[aria-label="Buscar pela placa"]'); pg.wait_for_selector('#veic', timeout=8000)
        pg.click('#obd-procurar'); pg.wait_for_selector('.obd-ap', timeout=10000); pg.click('.obd-ap'); pg.wait_for_selector('#obd-acoes', timeout=15000)
        pg.click('#obd-conf'); pg.wait_for_selector('#obd-r-conf', timeout=15000)
        t('DIVERGE' in pg.inner_text('#obd-r-conf'), 'chassi diferente do cadastro aparece como DIVERGE')
        # dados ao vivo, foto da falha e testes de bordo
        # DADOS AO VIVO DE VERDADE (pedido do Danilo em 19/11/2026): tem de ir mudando sozinho
        def rpm_na_tela():                       # serve nos dois jeitos: mostrador e lista
            for alvo in ('#obd-r-vivo [data-pid="12"] .mostrador-num b', '#obd-r-vivo [data-pid="12"] .linha-viva-num'):
                if pg.query_selector(alvo):
                    return re.sub(r'[^\d.,]', '', pg.inner_text(alvo)).strip()
            return None
        pg.click('#obd-vivo'); pg.wait_for_selector('#obd-r-vivo', timeout=20000)
        pg.wait_for_selector('#obd-r-vivo .selo.vivo', timeout=10000)
        t('AO VIVO' in pg.inner_text('#obd-r-vivo'), 'mostra que está ao vivo')
        a = rpm_na_tela(); pg.wait_for_timeout(1500); b = rpm_na_tela()
        t(a and b and a != b, 'o valor muda SOZINHO, sem tocar em nada: %s -> %s' % (a, b))
        t(re.search(r'\d+ volta', pg.inner_text('#obd-r-vivo')), 'mostra quantas voltas já deu')
        pg.eval_on_selector('#obd-r-vivo', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'obd-painel-celular.png'))
        t(pg.is_enabled('#obd-falhas'), 'as outras leituras continuam clicáveis durante a roda (elas a interrompem)')
        # REGRA DO DANILO (20/11/2026): a tela abre com as leituras PADRÃO, não com tudo
        padrao_n = pg.locator('#obd-r-vivo [data-pid]').count()
        t(5 <= padrao_n <= 14, 'o painel abre só com as padrão: %d mostradores' % padrao_n)
        t(pg.query_selector('#obd-r-vivo [data-pid="12"]') and pg.query_selector('#obd-r-vivo [data-pid="5"]'), 'rotação e temperatura do motor entre elas')
        t(not pg.query_selector('#obd-r-vivo [data-pid="35"]'), 'pressão do rail NÃO entra sozinha num carro flex')
        pg.click('#obd-vivo'); pg.wait_for_timeout(500)                     # para a roda para mexer no filtro
        pg.click('#obd-escolher'); pg.wait_for_timeout(300)
        pg.click('#obd-todas'); pg.wait_for_timeout(300)
        pg.click('#obd-escolher'); pg.wait_for_timeout(200)
        pg.click('#obd-vivo'); pg.wait_for_selector('#obd-r-vivo .selo.vivo', timeout=20000); pg.wait_for_timeout(2500)
        t(pg.locator('#obd-r-vivo [data-pid]').count() > padrao_n, 'com "todas do carro" o painel cresce: %d' % pg.locator('#obd-r-vivo [data-pid]').count())
        tx = pg.inner_text('#obd-r-vivo')
        t('14,1' in tx or '14.1' in tx, 'a tensão do módulo aparece na tela: %s' % tx.replace('\n', ' ')[:160])
        # AS LEITURAS NOVAS CHEGAM NA TELA (pedido do Danilo em 19/11/2026)
        def na_tela(pid):
            e = pg.query_selector('#obd-r-vivo [data-pid="%d"]' % pid)
            return e.inner_text().replace('\n', ' ') if e else None
        t('80' in (na_tela(0x0d) or ''), 'velocidade: %s' % na_tela(0x0d))
        t('50000' in (na_tela(0x23) or '').replace('.', ''), 'pressão do rail (500 bar): %s' % na_tela(0x23))
        t('2,5' in (na_tela(0x5d) or '') or '2.5' in (na_tela(0x5d) or ''), 'tempo de injeção: %s' % na_tela(0x5d))
        t('27' in (na_tela(0x52) or ''), 'etanol no tanque: %s' % na_tela(0x52))
        t('90' in (na_tela(0x5c) or ''), 'temperatura do óleo: %s' % na_tela(0x5c))
        t('450' in (na_tela(0x3c) or ''), 'temperatura do catalisador: %s' % na_tela(0x3c))
        t(na_tela(0xa6) and '150000' in na_tela(0xa6).replace('.', ''), 'odômetro do módulo: %s' % na_tela(0xa6))
        cmds0 = pg.evaluate("window.__obd.cmds")
        t('0160' in cmds0 and '01A0' in cmds0, 'anda nas faixas altas, senão o odômetro ($A6) nunca sairia')
        t(pg.locator('#obd-r-vivo .mostrador, #obd-r-vivo .linha-viva').count() >= 30, 'o painel mostra as dezenas de leituras: %d' % pg.locator('#obd-r-vivo .mostrador, #obd-r-vivo .linha-viva').count())
        # UM PEDIDO, DOIS NÚMEROS: sonda e temperatura do escape (pedido do Danilo em 19/11/2026)
        def chave(c):
            e = pg.query_selector('#obd-r-vivo [data-chave="%d"]' % c)
            return e.inner_text().replace('\n', ' ') if e else None
        t(chave(0x14 * 100 + 0) and '0,765' in chave(0x14 * 100 + 0), 'tensão da sonda 1: %s' % chave(0x14 * 100 + 0))
        t(chave(0x14 * 100 + 1), 'e o ajuste daquela sonda, do MESMO pedido: %s' % chave(0x14 * 100 + 1))
        t(chave(0x15 * 100 + 0) and not chave(0x15 * 100 + 1), 'sonda 2 veio com 0xFF no ajuste: só a tensão aparece')
        t(chave(0x24 * 100 + 0) and '1' in chave(0x24 * 100 + 0), 'sonda banda larga, lambda: %s' % chave(0x24 * 100 + 0))
        t(chave(0x24 * 100 + 1), 'e a tensão dela')
        t(chave(0x78 * 100 + 0) and '450' in chave(0x78 * 100 + 0), 'escape sensor 1: %s' % chave(0x78 * 100 + 0))
        t(chave(0x78 * 100 + 1) and '540' in chave(0x78 * 100 + 1), 'escape sensor 2: %s' % chave(0x78 * 100 + 1))
        t(not chave(0x78 * 100 + 2) and not chave(0x78 * 100 + 3), 'os sensores de escape que o carro não tem não aparecem')
        t('0178' in pg.evaluate("window.__obd.cmds"), 'a temperatura do escape é pedida de verdade')
        t('83' in tx, 'a temperatura do motor aparece na tela')
        cmds = pg.evaluate("window.__obd.cmds")
        t('0120' in cmds and '0140' in cmds, 'anda nas faixas de PID ($20 e $40), senão os PIDs altos nunca sairiam: %s' % [c for c in cmds if c.startswith('01')][:8])
        t('0142' in cmds and '0131' in cmds, 'pede a tensão do módulo ($42) e a distância desde o apagamento ($31)')
        t(cmds.count('0131') <= 2, 'o que não muda (distância desde o apagamento) é lido uma vez, não a cada volta: %d vezes' % cmds.count('0131'))
        t(cmds.count('010C') > 3, 'o que muda é relido a cada volta: rotação pedida %d vezes' % cmds.count('010C'))
        # tocar de novo para a roda
        pg.click('#obd-vivo'); pg.wait_for_timeout(1000)
        t('PARADO' in pg.inner_text('#obd-r-vivo'), 'tocar de novo para a roda')
        parado = rpm_na_tela(); pg.wait_for_timeout(1200)
        t(rpm_na_tela() == parado, 'parado fica parado: o valor não muda mais')
        # FILTRO DAS LEITURAS (pedido do Danilo em 19/11/2026)
        pg.click('#obd-escolher'); pg.wait_for_timeout(300)
        t(pg.query_selector('#obd-todas') and pg.query_selector('#obd-padrao'), 'o filtro tem "só as padrão" e "todas do carro"')
        t('respondeu agora' in pg.inner_text('#obd-escolha'), 'conectado, a tela diz que a lista é a que ESTE carro respondeu: %s' % [l for l in pg.inner_text('#obd-escolha').split('\n') if 'lista' in l][:1])
        t(pg.locator('#obd-escolha .obd-cx').count() >= 30, 'lista as leituras deste carro para marcar: %d' % pg.locator('#obd-escolha .obd-cx').count())
        t(pg.locator('#obd-escolha .sec h3').count() >= 3, 'separadas por grupo')
        # REGRA DO DANILO (20/11/2026): padrão na tela, o resto no filtro, e um botão que põe todas
        total_cx = pg.locator('#obd-escolha .obd-cx').count()
        t(pg.locator('#obd-escolha input:checked').count() == total_cx and pg.get_attribute('#obd-todas', 'aria-pressed') == 'true', '"todas do carro" deixa tudo marcado')
        pg.click('#obd-padrao'); pg.wait_for_timeout(300)
        marcadas = pg.locator('#obd-escolha input:checked').count()
        t(5 <= marcadas <= 14 and marcadas < total_cx, '"só as padrão" volta para as padrão: %d de %d' % (marcadas, total_cx))
        t(pg.get_attribute('#obd-padrao', 'aria-pressed') == 'true', 'e o filtro mostra em que modo está')
        t(pg.is_checked('#obd-escolha input[data-pid="12"]') and pg.is_checked('#obd-escolha input[data-pid="5"]'), 'rotação e temperatura do motor estão entre as padrão')
        t(not pg.is_checked('#obd-escolha input[data-pid="166"]'), 'odômetro NÃO é padrão: fica para quem quiser acrescentar')
        guard = pg.evaluate("JSON.parse(window.localStorage.getItem(Object.keys(window.localStorage).filter(k => k.indexOf('obd_leituras') === 0)[0]))")
        t(isinstance(guard, dict) and guard.get('modo') == 'padrao', 'a escolha fica guardada por carro, com o modo: %s' % guard)
        def conta_filtro():
            m = re.search(r'\((\d+) de (\d+)\)', pg.inner_text('#obd-escolher'))
            return (int(m.group(1)), int(m.group(2))) if m else (None, None)
        antes_n, total_n = conta_filtro()
        t(antes_n == marcadas and total_n >= 30, 'a conta do botão bate com o que está na tela: %s de %s' % (antes_n, total_n))
        pg.uncheck('#obd-escolha input[data-pid="5"]'); pg.wait_for_timeout(300)
        t(conta_filtro() == (marcadas - 1, total_n), 'desmarcar reduz a conta: %s' % str(conta_filtro()))
        pg.check('#obd-escolha input[data-pid="166"]'); pg.wait_for_timeout(300)
        t(conta_filtro() == (marcadas, total_n), 'e marcar uma do filtro acrescenta na tela: %s' % str(conta_filtro()))
        chaves = pg.evaluate("Object.keys(window.localStorage).filter(k => k.indexOf('obd_leituras') === 0)")
        t(len(chaves) == 1, 'a escolha é guardada numa chave por carro: %s' % chaves)
        guardadas = pg.evaluate("JSON.parse(window.localStorage.getItem(%r))" % chaves[0]) if chaves else None
        t(isinstance(guardadas, dict) and guardadas.get('modo') == 'escolha' and 5 not in guardadas.get('pids', []) and 166 in guardadas.get('pids', []),
          'guardada como escolha à mão, sem o que saiu e com o que entrou: %s' % str(guardadas)[:120])
        pg.click('#obd-todas'); pg.wait_for_timeout(300)
        t(pg.locator('#obd-escolha input:checked').count() == pg.locator('#obd-escolha .obd-cx').count(), '"todas" remarca tudo')
        pg.click('#obd-escolher'); pg.wait_for_timeout(200)

        # FALHA QUE NASCE DURANTE A LEITURA AO VIVO: a barra tem de ficar vermelha
        pg.evaluate("window.__obd.falhaNova = '0301'")       # P0301
        pg.click('#obd-vivo'); pg.wait_for_selector('#obd-falhas.alerta', timeout=30000)
        t('FALHA' in pg.inner_text('#obd-falhas'), 'o botão de falhas avisa durante a leitura: %s' % pg.inner_text('#obd-falhas'))
        pg.click('#obd-falhas'); pg.wait_for_selector('#obd-r-falhas', timeout=20000)
        t('P0301' in pg.inner_text('#obd-r-falhas'), 'e o código aparece ao abrir')
        t('alerta' not in (pg.get_attribute('#obd-falhas', 'class') or ''), 'visto o código, o botão volta ao normal')
        pg.evaluate("window.__obd.falhaNova = null")

        # LEITURA DE COMBUSTÍVEL (pedido do Danilo em 19/11/2026): a do primeiro contato
        pg.click('#obd-combustivel'); pg.wait_for_selector('#obd-comb', timeout=30000)
        tc = pg.inner_text('#obd-comb')
        t('Combustível' in pg.inner_text('#obd-r-vivo'), 'o cartão troca de nome no modo combustível')
        t('PONDO' in tc or 'TIRANDO' in tc or 'ordem' in tc, 'diz quanto o módulo está corrigindo: %s' % tc.replace('\n', ' ')[:120])
        t(pg.locator('#obd-comb .comb-banco').count() == 2, 'mostra os dois bancos separados')
        t('27' in tc and 'etanol' in tc, 'e o etanol do tanque: %s' % [l for l in tc.split('\n') if 'etanol' in l][:1])
        t('montadora publica' in tc or not pg.query_selector('#obd-comb .comb-causas'), 'quando lista causas, avisa que é lista geral e não diagnóstico')
        cmdsc = pg.evaluate("window.__obd.cmds.slice(-40)")
        t(not [c for c in cmdsc if c in ('0121', '0131', '01A6')], 'no modo combustível não pede o que não interessa (distâncias, odômetro)')
        t('0106' in pg.evaluate("window.__obd.cmds") and '0152' in pg.evaluate("window.__obd.cmds"), 'pede o ajuste e o etanol')
        pg.eval_on_selector('#obd-r-vivo', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'obd-combustivel-celular.png'))
        pg.click('#obd-combustivel'); pg.wait_for_timeout(600)

        # UMA LEITURA POR VEZ (pedido do Danilo em 19/11/2026)
        pg.click('#obd-vivo'); pg.wait_for_selector('#obd-r-vivo .selo.vivo', timeout=10000)
        pg.click('#obd-falhas'); pg.wait_for_selector('#obd-r-falhas', timeout=20000)
        t(not pg.query_selector('#obd-r-vivo'), 'abrir as falhas tira os dados ao vivo da tela')
        t('PARAR' not in pg.inner_text('#obd-vivo'), 'e para a roda junto')
        pg.click('#obd-conf'); pg.wait_for_selector('#obd-r-conf', timeout=20000)
        t(not pg.query_selector('#obd-r-falhas'), 'cada leitura nova troca a anterior, não empilha')
        pg.click('#obd-vivo'); pg.wait_for_selector('#obd-r-vivo', timeout=20000)
        t(not pg.query_selector('#obd-r-conf'), 'voltar aos dados ao vivo tira o cartão anterior')
        pg.click('#obd-vivo'); pg.wait_for_timeout(800)
        # OS DOIS JEITOS COM FILTRO (pedido do Danilo em 19/11/2026)
        t(pg.query_selector('#obd-r-vivo .painel-obd'), 'começa no painel de mostradores')
        t(pg.query_selector('#obd-r-vivo [data-pid="12"] .mostrador-arco .cheio'), 'o mostrador da rotação tem o arco desenhado')
        risco = pg.get_attribute('#obd-r-vivo [data-pid="12"] .mostrador-arco .cheio', 'stroke-dasharray')
        t(risco and float(risco.split()[0]) > 0, 'o arco está preenchido conforme o valor: %s' % risco)
        t('8000' in pg.inner_text('#obd-r-vivo [data-pid="12"]'), 'o fim da escala da rotação aparece no mostrador')
        pg.click('#obd-jeito-lista'); pg.wait_for_timeout(300)
        # FAIXA DE TRABALHO ao lado da leitura (pedido do Danilo, 21/11/2026)
        ft = pg.locator('#obd-r-vivo [data-pid="5"] .faixa-txt')
        t(ft.count() == 1 and '85 a 105' in ft.inner_text() and 'suposto' in ft.inner_text().lower() and ft.get_attribute('data-situacao') in ('dentro', 'acima', 'abaixo'), 'a temperatura do motor traz a faixa de trabalho, de onde veio e onde a leitura está: ' + (ft.inner_text().replace(chr(10), ' ') if ft.count() else 'sem faixa'))
        t(any(p in ft.inner_text() for p in ('DENTRO', 'ACIMA', 'ABAIXO')), 'a situação vem ESCRITA, não só na cor')
        bz = pg.locator('#obd-r-vivo [data-pid="5"] .barra-zonas')
        t(bz.count() == 1 and bz.locator('.zona.antes').count() == 1 and bz.locator('.zona.trabalho').count() == 1 and bz.locator('.zona.depois').count() == 1 and bz.locator('.agulha').count() == 1, 'a barra tem as três zonas (antes, faixa de trabalho, depois) e a agulha do valor de agora')
        cores = pg.evaluate("() => ['antes','trabalho','depois'].map(k => getComputedStyle(document.querySelector('#obd-r-vivo [data-pid=\"5\"] .barra-zonas .zona.' + k)).backgroundColor)")
        t(len(set(cores)) == 3, 'cada zona tem a sua tonalidade: ' + str(cores))
        lz = pg.evaluate("() => { const q = k => document.querySelector('#obd-r-vivo [data-pid=\"5\"] .barra-zonas .zona.' + k).getBoundingClientRect(); const a = q('antes'), w = q('trabalho'), d = q('depois'); const tot = a.width + w.width + d.width; return [a.width / tot, w.width / tot, d.width / tot]; }")
        t(all(abs(v - 1 / 3) < 0.02 for v in lz), 'a barra aproxima: a faixa 85 a 105 ocupa o terço do meio (escala 65 a 125): ' + str([round(v, 3) for v in lz]))
        t(bz.locator('.barra-zonas-pes').inner_text().split() == ['85', '105'], 'os dois limites vêm escritos embaixo da barra')
        t(pg.locator('#obd-r-vivo [data-pid="12"] .barra-zonas').count() == 0 and pg.locator('#obd-r-vivo [data-pid="12"] .linha-viva-barra').count() == 1, 'sem faixa, a barra continua a simples')
        t(pg.locator('#obd-r-vivo [data-pid="12"] .faixa-txt').count() == 0, 'leitura sem referência nem histórico fica sem faixa: nada inventado')
        t(not pg.query_selector('#obd-r-vivo .painel-obd'), 'o filtro LISTA troca o painel pela lista')
        t('Rota' in pg.inner_text('#obd-r-vivo') and 'rpm' in pg.inner_text('#obd-r-vivo'), 'na lista os nomes e as unidades continuam escritos')
        t(pg.query_selector('#obd-r-vivo .lista-viva-grupo h3'), 'a lista vem separada por grupo')
        pg.eval_on_selector('#obd-r-vivo', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(400)
        pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'obd-lista-celular.png'))
        t(pg.query_selector('#obd-r-vivo [data-pid="12"] .linha-viva-barra i'), 'cada linha da lista mostra a posição na escala')
        t(rpm_na_tela(), 'o valor da rotação aparece na lista: %s' % rpm_na_tela())
        t(pg.evaluate("window.localStorage.getItem('obd_jeito')") == 'lista', 'a escolha do jeito fica guardada')
        pg.click('#obd-jeito-painel'); pg.wait_for_timeout(300)
        t(pg.query_selector('#obd-r-vivo .painel-obd'), 'o filtro PAINEL volta aos mostradores')
        # DIGITAL e GRÁFICO (pedido do Danilo, 21/11/2026)
        pg.click('#obd-jeito-digital'); pg.wait_for_timeout(300)
        t(pg.locator('#obd-r-vivo .digital').count() >= 3 and not pg.query_selector('#obd-r-vivo .painel-obd'), 'o filtro DIGITAL mostra os números grandes, sem ponteiro')
        pg.click('#obd-jeito-grafico'); pg.wait_for_selector('#obd-grafico', timeout=5000)
        t(pg.locator('#obd-grafico .graf-faixa').count() == 0 and 'até 3 gráficos' in pg.inner_text('#obd-grafico-aviso'), 'o GRÁFICO começa pedindo para escolher, e diz o limite')
        bts = pg.locator('#obd-grafico .graf-escolha button'); nb = bts.count()
        t(nb >= 4, 'o gráfico oferece as leituras que estão chegando: %d' % nb)
        for k in range(nb):
            if pg.query_selector('#graf-abrir') and pg.get_attribute('#graf-abrir', 'aria-expanded') != 'true': pg.click('#graf-abrir')
            pg.locator('#obd-grafico .graf-escolha button[data-chave]').nth(k).click(); pg.wait_for_timeout(60)
        nf = pg.locator('#obd-grafico .graf-faixa').count()
        t(nf == 3, 'tocando em todas as leituras, ficam 3 gráficos e não mais: %d' % nf)
        t(pg.locator('#obd-grafico .graf-leg').count() >= 3 and pg.locator('#obd-grafico .graf-faixa >> nth=0').locator('.graf-leg').count() <= 4, 'cada gráfico tem a legenda escrita, com no máximo 4 leituras')
        t('Já tem 3 gráficos' in pg.inner_text('#obd-grafico-aviso') or 'já tem 4' in pg.inner_text('#obd-grafico-aviso'), 'o que não coube é recusado com aviso escrito: ' + pg.inner_text('#obd-grafico-aviso'))
        pg.click('#graf-abrir'); pg.wait_for_timeout(200)
        t(pg.locator('#obd-grafico .graf-escolha button[data-chave]').count() == 0 and not pg.locator('#obd-escolha').is_visible() and not pg.locator('#obd-placa').is_visible(), 'com os gráficos na tela, só eles aparecem: a lista de escolha e o resto saem da frente')
        liguei = not pg.query_selector('#obd-r-vivo .selo.vivo')
        if liguei: pg.click('#obd-vivo')
        pg.wait_for_selector('#obd-grafico .graf-linha', timeout=30000, state='attached')
        t(pg.locator('#obd-grafico .graf-linha').count() >= 1, 'com a roda girando o traço aparece')
        pg.eval_on_selector('#obd-grafico', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'grafico-celular.png'))
        antes_leg = pg.locator('#obd-grafico .graf-leg').count(); pg.click('#graf-abrir'); pg.locator('#obd-grafico .graf-escolha button.esc').first.click(); pg.wait_for_timeout(200)
        t(pg.locator('#obd-grafico .graf-leg').count() == antes_leg - 1, 'tocar numa escolhida tira ela do gráfico')
        if liguei: pg.click('#obd-vivo'); pg.wait_for_timeout(1800)
        pg.click('#obd-jeito-painel'); pg.wait_for_timeout(300)
        t(pg.evaluate("window.localStorage.getItem('obd_jeito')") == 'painel', 'volta a guardar painel')
        # parar e ligar de novo: a roda nova tem de girar. (A sobreposição de duas rodas só
        # acontece com adaptador lento, que este de mentira não imita — por isso a defesa é o
        # número da rodada em app/telas.js; aqui conferimos o que o mecânico vê.)
        pg.click('#obd-vivo'); pg.wait_for_timeout(1200)
        t('AO VIVO' in pg.inner_text('#obd-r-vivo'), 'ligar de novo volta a girar')
        c = rpm_na_tela(); pg.wait_for_timeout(1200)
        t(c and rpm_na_tela() != c, 'depois de parar e ligar, o valor volta a mudar sozinho')
        pg.click('#obd-vivo'); pg.wait_for_timeout(600)
        pg.click('#obd-foto'); pg.wait_for_selector('#obd-r-foto', timeout=20000)
        t('instante em que a falha gravou' in pg.inner_text('#obd-r-foto'), 'foto do momento da falha explica para que serve')
        pg.click('#obd-testes'); pg.wait_for_selector('#obd-r-testes', timeout=25000); tx = pg.inner_text('#obd-r-testes')
        t('Catalisador' in tx and 'PASSOU' in tx, 'testes de bordo chegam até o catalisador (faixa $21): %s' % tx.replace('\n', ' ')[:140])
        t('limite' in tx, 'mostra a margem que sobra até o limite')

        # FALHA DE COMBUSTÃO POR CILINDRO (pedido do Danilo em 19/11/2026): o que o corte de bico procura,
        # sem cortar nada — o próprio módulo conta.
        n_antes = len(pg.evaluate("window.__obd.cmds"))
        pg.click('#obd-cilindros'); pg.wait_for_selector('#obd-r-cilindros', timeout=25000)
        so_cil = pg.evaluate("window.__obd.cmds")[n_antes:]
        tc2 = pg.inner_text('#obd-r-cilindros')
        t(pg.locator('#obd-r-cilindros .cil-linha').count() == 4, 'mostra um cilindro por linha: %d' % pg.locator('#obd-r-cilindros .cil-linha').count())
        t('CILINDRO 3' in tc2, 'aponta o cilindro que destoa: %s' % [l for l in tc2.split('\n') if 'ilindro 3' in l][:1])
        t('340' in tc2, 'com a contagem do módulo')
        t('ignição' in tc2 and 'compressão' in tc2, 'e diz onde procurar naquele cilindro')
        t('pior' in (pg.get_attribute('#obd-r-cilindros [data-cilindro="3"]', 'class') or ''), 'a barra do cilindro 3 vem marcada')
        t('Compare os cilindros entre si' in tc2, 'avisa que a comparação é entre cilindros, não com número fixo')
        t('apagamento' in tc2, 'e que a contagem é desde o último apagamento')
        t('ordem de ignição' in tc2, 'avisa que alguns módulos mandam na ordem de ignição')
        t('06A4' in pg.evaluate("window.__obd.cmds"), 'pede os MIDs de falha de combustão de verdade')
        t('06A4' in so_cil and not [c for c in so_cil if c in ('0621', '0601')], 'o botão só lê o que precisa, não varre o serviço 06 inteiro: %s' % so_cil)

        # ODÔMETRO DO MÓDULO CONTRA O KM DO CADASTRO (pedido do Danilo em 19/11/2026)
        pg.click('#obd-conf'); pg.wait_for_selector('#obd-r-conf', timeout=25000)
        to = pg.inner_text('#obd-r-conf')
        t(pg.query_selector('#obd-odometro'), 'o cartão traz o odômetro do módulo')
        t('150.000' in to, 'com o número lido no módulo: %s' % [l for l in to.split('\n') if '150' in l][:1])
        t('80.000' in to, 'e o KM do cadastro ao lado')
        t('a mais' in to, 'módulo acima do cadastro é o normal, e a tela explica: %s' % [l for l in to.split('\n') if 'a mais' in l][:1])
        t('01A6' in pg.evaluate("window.__obd.cmds"), 'o odômetro é pedido de verdade')
        # SERVIÇOS AVANÇADOS (20/11/2026): calibração, teste drive e contadores de uso
        t(pg.query_selector('#obd-avancado'), 'tem o quadro de serviços avançados')
        t(pg.query_selector('#obd-conf') and pg.query_selector('#obd-calib') and pg.query_selector('#obd-ciclo') and pg.query_selector('#obd-contadores'),
          'com chassi, calibração, teste drive e contadores')
        pg.click('#obd-calib'); pg.wait_for_selector('#obd-r-calib', timeout=25000)
        tcal = pg.inner_text('#obd-r-calib')
        t('ABC123DEF456GHI7' in tcal, 'lê a calibração do módulo: %s' % [l for l in tcal.split('\n') if 'ABC' in l][:1])
        t('1A2B3C4D' in tcal, 'e o CVN')
        t('Primeira leitura' in tcal, 'primeira vez: guarda para comparar depois')
        t('lista pública' in tcal, 'e avisa que não existe lista pública do CVN certo')
        pg.click('#obd-calib'); pg.wait_for_selector('#obd-r-calib', timeout=25000); pg.wait_for_timeout(300)
        t('SEM MUDANÇA' in pg.inner_text('#obd-r-calib'), 'lendo de novo, compara com a anterior: %s' % [l for l in pg.inner_text('#obd-r-calib').split('\n') if 'MUDAN' in l][:1])
        pg.evaluate("const k = Object.keys(window.localStorage).find(x => x.indexOf('obd_calib') === 0); const v = JSON.parse(window.localStorage.getItem(k)); v.cvn = ['99999999']; window.localStorage.setItem(k, JSON.stringify(v))")
        pg.click('#obd-calib'); pg.wait_for_selector('#obd-r-calib', timeout=25000); pg.wait_for_timeout(300)
        t('MUDOU' in pg.inner_text('#obd-r-calib') and 'remap' in pg.inner_text('#obd-r-calib'),
          'CVN diferente com a mesma calibração aponta reprogramação: %s' % [l for l in pg.inner_text('#obd-r-calib').split('\n') if 'MUDOU' in l][:1])
        pg.click('#obd-ciclo'); pg.wait_for_selector('#obd-r-ciclo', timeout=25000)
        tcic = pg.inner_text('#obd-r-ciclo')
        t('COMPLETOU' in tcic or 'NÃO RODOU' in tcic, 'teste drive lista os monitores deste ciclo')
        t('provar o reparo' in tcic, 'e explica para que serve: %s' % [l for l in tcic.split('\n') if 'provar' in l][:1])
        t('0141' in pg.evaluate("window.__obd.cmds"), 'pede o PID $41 de verdade')
        pg.click('#obd-contadores'); pg.wait_for_selector('#obd-r-contadores', timeout=25000)
        tcon = pg.inner_text('#obd-r-contadores')
        t('Catalisador' in tcon and '0,2' in tcon, 'contadores mostram a razão de cada monitor: %s' % [l for l in tcon.split('\n') if 'Catalisador' in l][:1])
        t('RODA POUCO' in tcon, 'e marcam o que roda pouco (razão abaixo da mínima da CARB)')
        t('fonte secundária' in tcon, 'avisando que a ordem dos campos não veio de fonte primária')
        t('0908' in pg.evaluate("window.__obd.cmds"), 'pede os contadores de verdade')

        # CLONE: "v1.5" nunca existiu
        t(pg.query_selector('#obd-clone'), 'adaptador que se diz v1.5 é denunciado como clone')
        t('nunca existiu' in pg.inner_text('#obd-clone'), 'com o motivo escrito: %s' % pg.inner_text('#obd-clone')[:80])

        # PARÂMETROS DE REFERÊNCIA: era um cartão escondido dentro desta tela e virou TELA (20/11/2026),
        # porque é o que se consulta para discutir um laudo. Aqui fica só o caminho para ela.
        t(pg.query_selector('#obd-ir-parametros'), 'a leitura tem o caminho para os parâmetros')
        t(not pg.query_selector('#obd-parametros'), 'e o cartão não está mais duplicado aqui dentro')
        # APAGAR A FALHA, COM REGISTRO (v62, decisão do Danilo em 19/11/2026)
        t(pg.query_selector('#obd-apagar'), 'o administrador tem o botão de apagar falhas')
        t('REGISTRADO' in pg.inner_text('#obd-apagar'), 'e o botão já avisa que fica registrado: %s' % pg.inner_text('#obd-apagar'))
        pg.click('#obd-apagar'); pg.wait_for_selector('#obd-apagar-cx', timeout=25000)
        cx = pg.inner_text('#obd-apagar-cx')
        t('P0171' in cx, 'a confirmação mostra o que vai ser apagado: %s' % cx.replace('\n', ' ')[:90])
        t(pg.locator('#obd-apagar-cx .apg-avisos li').count() == 3, 'e os avisos antes do botão')
        t('conserta' not in cx and 'adaptações' in cx, 'a confirmação traz só o que não é óbvio: o que some e o que zera')
        t('prontidão' in cx.lower() and 'combustível' in cx.lower(), 'avisa que zera a prontidão e o aprendizado de combustível')
        t('ABC1D23' in cx and 'Fulano' in cx, 'diz quem vai apagar e de qual carro: %s' % [l for l in cx.split('\n') if 'Fulano' in l][:1])
        t(pg.query_selector('#obd-km'), 'pede o KM do painel para o registro')
        pg.fill('#obd-km', '152300')
        t(not pg.evaluate("window.__obd.apagados || 0"), 'até aqui NADA foi apagado no carro')
        pg.click('#obd-apagar-ok'); pg.wait_for_selector('#obd-apagar-feito', timeout=30000)
        fe = pg.inner_text('#obd-apagar-feito')
        t(pg.evaluate("window.__obd.apagados") == 1, 'apagou uma vez só')
        t('LIMPOU' in fe, 'diz o que sobrou: %s' % fe.replace('\n', ' ')[:90])
        t('Ajuste depois' in fe, 'mostra o ajuste de combustível antes e depois')
        todos_reg = f.tabela('obd_leituras'); reg = [x for x in todos_reg if x.get('tipo') == 'apagar']
        t(len(reg) == 1, 'gravou UM registro do apagamento: %d' % len(reg))
        r0 = reg[0] if reg else {}
        t(r0.get('tipo') == 'apagar' and r0.get('perfil_nome') == 'Fulano de Teste', 'registro diz quem apagou: %s' % r0.get('perfil_nome'))
        t(r0.get('placa') == 'ABC1D23' and r0.get('km') == 152300, 'com a placa e o KM: %s / %s' % (r0.get('placa'), r0.get('km')))
        t([c['codigo'] for c in r0.get('codigos') or []] and 'P0171' in [c['codigo'] for c in r0.get('codigos') or []], 'e os códigos que estavam lá: %s' % r0.get('codigos'))
        t(r0.get('codigos_depois') == [], 'e o que sobrou depois (lista vazia, não nulo)')
        t(r0.get('vin'), 'o chassi lido entra no registro: %s' % r0.get('vin'))
        t('04' not in pg.evaluate("window.__obd.cmds"), 'o 04 NÃO passou pelo comando: foi pelo método próprio do plugin')
        pg.click('#obd-apagar-fim'); pg.wait_for_timeout(300)
        # módulo que recusa (motor ligado): avisa e não inventa que apagou
        pg.evaluate("window.__obd.recusaApagar = true; window.__obd.limpo = false")
        pg.click('#obd-apagar'); pg.wait_for_selector('#obd-apagar-cx', timeout=25000)
        pg.click('#obd-apagar-ok'); pg.wait_for_timeout(2500)
        t(not pg.query_selector('#obd-apagar-feito'), 'módulo que recusa não vira "apagou"')
        t('MOTOR DESLIGADO' in pg.inner_text('#obd-apagar-cx'), 'e a tela diz o que fazer: %s' % [l for l in pg.inner_text('#obd-apagar-cx').split('\n') if 'MOTOR' in l][:1])
        t(len([x for x in f.tabela('obd_leituras') if x.get('tipo') == 'apagar']) == 1, 'recusa não grava registro novo')
        pg.click('#obd-apagar-nao'); pg.evaluate("window.__obd.recusaApagar = false"); pg.wait_for_timeout(300)

        # o que esta etapa NÃO faz
        cmds = pg.evaluate("window.__obd.cmds")
        t('04' not in cmds and not [c for c in cmds if c.startswith('04')], 'nenhum comando de apagar falha (04) é enviado ao carro')
        t(not [c for c in cmds if c.startswith('2E') or c.startswith('34') or c.startswith('27')], 'nenhum comando de escrita no carro é enviado')
        # a leitura em si não grava nada: os únicos POST permitidos são o registro do apagamento e a
        # conferência de parâmetro, os dois gravados de propósito pelo próprio teste
        outras = [p for p in f.escritas() if 'obd_leituras' not in p[1]]
        t(not outras, 'a tela do OBD só grava o registro do apagamento, mais nada: %s' % outras)
        t('ABS, airbag' in textos(pg), 'a tela avisa que ABS, airbag e câmbio não saem por aqui')
        t(not er, 'tela do OBD sem erro de página: %s' % er)

        # ---- A CONEXÃO SOBREVIVE À TROCA DE TELA (20/11/2026) ----
        # Era assim até ontem: sair da tela desconectava. Com o diagnóstico virando família de seis
        # telas, isso passou a ser um defeito — ir da leitura para o atuador derrubava o adaptador e
        # obrigava a conectar de novo, com o carro no elevador. Agora a conexão mora acima das telas
        # (js/obdsessao.js) e quem desliga é sair de TODA a família.
        pg.evaluate("window.__obd.chamadas.length = 0")
        pg.goto(URL + '#/atuadores'); pg.wait_for_selector('.titulo b', timeout=10000); pg.wait_for_timeout(700)
        t(not pg.evaluate("window.__obd.chamadas.includes('desconectar')"),
          'ir da leitura para outra tela de diagnóstico NÃO desconecta: %s' % pg.evaluate("window.__obd.chamadas"))
        t(pg.query_selector('.diag-ligado'), 'e a tela nova já aparece com o adaptador ligado')
        t('CONECTADO' in pg.inner_text('.diag-ligado'), 'numa linha só, sem repetir o cartão inteiro')

        # ---- MÓDULOS DO CARRO: a falha com a causa elétrica ----
        pg.goto(URL + '#/modulos'); pg.wait_for_selector('.titulo b', timeout=10000)
        t(pg.query_selector('#diag-adaptador') or pg.query_selector('.diag-ligado'), 'a tela de módulos mostra o adaptador')
        pg.wait_for_selector('#diag-modulo', timeout=10000)
        # O CARRO INTEIRO POR MÓDULO (pedido do Danilo, 21/11/2026): só módulo disponível aparece
        pg.evaluate("import('../js/obdsessao.js').then(m => m.definirCarro({ placa: 'POL0A00', marca: 'Volkswagen', modelo: 'POLO 1.0 TSI', ano: '2020' }))"); pg.wait_for_timeout(600)
        t('mapa de módulos' in pg.inner_text('#carro-vez'), 'a tela sabe o carro e diz que há mapa para o modelo: ' + pg.inner_text('#carro-vez')[:90])
        pg.click('#carro-varrer'); pg.wait_for_selector('#carro-resumo', timeout=60000)
        ci = pg.inner_text('#carro-inteiro'); nm = pg.locator('#carro-inteiro .obd-mod').count()
        t(nm == 3, 'aparecem os 3 módulos que responderam, e só eles: %d' % nm)
        t('MOTOR' in ci.upper() and 'CÂMBIO' in ci.upper() and 'ABS/FREIOS' in ci.upper(), 'cada módulo com o nome escrito: ' + ci[:160].replace(chr(10), ' '))
        t('AIRBAG' not in ci.upper() and 'PAINEL' not in ci.upper() and '7E3' not in ci, 'módulo que não respondeu NÃO vira cartão na tela')
        t(pg.locator('#carro-inteiro .obd-mod >> nth=0').locator('.diag-falha').count() >= 1, 'as falhas vêm dentro do módulo de quem são')
        t(pg.query_selector('#carro-calados') and 'não responderam' in pg.inner_text('#carro-calados'), 'os calados ficam numa linha só, recolhida')
        pg.eval_on_selector('#carro-inteiro', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'carro-inteiro-celular.png'))
        pg.click('#carro-inteiro .obd-mod[data-modulo="713"] .abrir-mod'); pg.wait_for_selector('#mod-ver-leituras', timeout=15000); pg.click('#mod-ver-leituras'); pg.wait_for_selector('#mod-leituras', timeout=15000)
        pg.click('#mod-vivo'); pg.wait_for_selector('#mod-rodas', timeout=30000)
        tr = pg.inner_text('#mod-rodas')
        t('DIANTEIRA ESQUERDA' in tr.upper() and 'TRASEIRA DIREITA' in tr.upper() and '40' in tr and '39,5' in tr, 'as quatro rodas do ABS lado a lado, com nome e valor: ' + tr.replace(chr(10), ' ')[:140])
        pg.click('#mod-rodas-grafico'); pg.wait_for_selector('#mod-leituras .graf-linha', timeout=30000, state='attached')
        t(pg.locator('#mod-leituras .graf-faixa').count() == 1 and pg.locator('#mod-leituras .graf-leg').count() == 4, 'as 4 rodas no MESMO gráfico, cada uma com a sua legenda')
        pg.click('#mod-vivo'); pg.wait_for_timeout(1500)
        pg.eval_on_selector('#mod-leituras', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'modulo-rodas-celular.png'))
        pg.click('text=TROCAR DE MÓDULO'); pg.wait_for_selector('#diag-modulo', timeout=10000)
        pg.click('#diag-modulo .btn-barra'); pg.wait_for_timeout(2500)
        t(pg.locator('#diag-modulo .obd-ap').count() > 0, 'a procura acha módulo que responde')
        t('7E0' in pg.inner_text('#diag-modulo'), 'e mostra o endereço de quem respondeu')
        pg.click('#diag-modulo .obd-ap >> nth=0'); pg.wait_for_selector('#mod-escolhido', timeout=10000)
        pg.click('#mod-escolhido .btn-barra >> nth=0'); pg.wait_for_selector('#mod-falhas', timeout=15000)
        tf = pg.inner_text('#mod-falhas')
        t('P0171-13' in tf, 'a falha sai com o sufixo do tipo: %s' % tf.split(chr(10))[:3])
        t('circuito aberto' in tf and 'Tipo de falha' in tf, 'e o tipo vira CAUSA ELÉTRICA, que o OBD comum não dá')
        t('confirmada' in tf, 'com a situação do código escrita')
        # o tipo 0x49 do segundo código também está na tabela
        t('falha eletrônica interna' in tf, 'o segundo código também ganha a causa')
        t('APAGAR AS FALHAS DESTE MÓDULO' in tf, 'o administrador pode apagar por módulo')

        # ---- ATUADORES: confirma antes, e DEVOLVE o controle ----
        # HONDA COM NOME (Etapa 1): só aparece em Honda, pede as condições por escrito, e registra
        pg.goto(URL + '#/atuadores'); pg.wait_for_selector('#diag-modulo', timeout=10000)
        t(not pg.query_selector('#honda-lista'), 'em carro que não é Honda a lista da Honda não existe')
        pg.evaluate("import('../js/obdsessao.js').then(m => m.definirCarro({ placa: 'HND0A00', marca: 'Honda', modelo: 'CITY EX', ano: '2016' }))"); pg.wait_for_selector('#honda-lista', timeout=5000)
        th = pg.inner_text('#honda-lista'); t('Eletroventilador' in th and 'purga' in th and 'simulado' in th, 'os atuadores da Honda vêm com NOME, e a tela diz que foram conferidos em módulo simulado')
        pg.click('#honda-lista [data-chave="ventoinha"]'); pg.wait_for_selector('#honda-condicoes', timeout=20000)
        t(pg.locator('#atu-acionar').is_disabled(), 'sem confirmar as condições o botão de acionar fica desligado')
        nc = pg.locator('#honda-condicoes input').count(); t(nc == 5, 'a ventoinha tem as 5 condições da ferramenta: %d' % nc)
        for k in range(nc - 1): pg.locator('#honda-condicoes input').nth(k).check()
        t(pg.locator('#atu-acionar').is_disabled(), 'faltando UMA condição continua desligado')
        pg.locator('#honda-condicoes input').nth(nc - 1).check(); pg.wait_for_timeout(200)
        na = len(f.gravados); pg.click('#atu-acionar'); pg.wait_for_selector('#atu-registro', timeout=40000)
        ch = pg.evaluate('window.__obd.chamadas'); t('atuar:013C:03' in ch and 'atuar:013C:00' in ch, 'aciona a saída 013C e devolve o controle: %s' % [x for x in ch if x.startswith('atuar:013C')][:4])
        t(pg.evaluate('window.__obd.cabecalho') in ('18DA10F1', '') and any(x == 'ATSH18DA10F1' for x in pg.evaluate('window.__obd.cmds')), 'no módulo do motor da Honda, em 29 bits')
        ra = [c for (tab, c) in f.gravados[na:] if tab == 'obd_leituras' and c.get('tipo') == 'atuar']
        t(len(ra) == 1 and ra[0]['dados'].get('honda') == 'ventoinha' and ra[0]['placa'] == 'HND0A00', 'o teste de atuador fica REGISTRADO, com quem e em qual carro: %s' % [x.get('dados', {}).get('did') for x in ra])
        pg.goto(URL + '#/aprendizados'); pg.wait_for_selector('#honda-lista', timeout=10000)
        pg.click('#honda-lista [data-chave="manut_1"]'); pg.wait_for_selector('#honda-erro', timeout=20000)
        t('painel' in pg.inner_text('#honda-erro').lower() or 'Painel' in pg.inner_text('#honda-erro'), 'módulo que não responde: o item não roda, e a tela diz qual módulo faltou: ' + pg.inner_text('#honda-erro')[:80])
        pg.click('#honda-lista [data-chave="vtc"]'); pg.wait_for_selector('#honda-antes', timeout=20000)
        t('5A' in pg.inner_text('#honda-antes') and pg.locator('#apr-rodar').is_disabled(), 'o valor antigo é lido e mostrado antes, e rodar exige as condições')
        for k in range(pg.locator('#honda-condicoes input').count()): pg.locator('#honda-condicoes input').nth(k).check()
        na = len(f.gravados); pg.click('#apr-rodar'); pg.wait_for_selector('#apr-registro', timeout=60000)
        t('rotina:0218:01' in pg.evaluate('window.__obd.chamadas'), 'roda a rotina do VTC (0218)')
        rp = [c for (tab, c) in f.gravados[na:] if tab == 'obd_leituras' and c.get('tipo') == 'aprender']
        t(len(rp) == 1 and rp[0]['dados'].get('antes') == '5A' and rp[0]['dados'].get('honda') == 'vtc', 'o aprendizado fica registrado COM o valor antigo: %s' % [x.get('dados', {}).get('antes') for x in rp])
        pg.evaluate("import('../js/obdsessao.js').then(async m => { await m.soltarModulo(); m.definirCarro({ placa: 'ABC1D23', marca: 'Volkswagen', modelo: 'GOL 1.0', ano: '2015' }); })"); pg.wait_for_timeout(500)
        pg.goto(URL + '#/atuadores'); pg.wait_for_selector('#diag-modulo', timeout=10000)
        pg.click('#diag-modulo .btn-barra'); pg.wait_for_timeout(2500)
        pg.click('#diag-modulo .obd-ap >> nth=0'); pg.wait_for_selector('#atu-modulo', timeout=10000)
        pg.click('#atu-modulo .btn-barra >> nth=0'); pg.wait_for_selector('#atu-lista', timeout=15000)
        t('F101' in pg.inner_text('#atu-lista'), 'lista os atuadores que o MÓDULO informou: %s' % pg.inner_text('#atu-lista')[:90])
        t('não o nome dela' in pg.inner_text('#atu-lista'), 'e diz que o nome está em anexo que o app não tem')
        # ---- a trava da DÚVIDA ----
        # Quando o módulo responde números que cabem nas duas leituras, o app não sabe se a lista é
        # de atuador ou de rotina. Aviso sozinho não protege: o acionamento fica TRAVADO até o
        # mecânico confirmar que conferiu o número. Reparo pedido na reconferência da revisão.
        pg.evaluate("window.__R['22FA23'] = '62FA230300'")   # número que cabe nas duas leituras
        pg.click('#atu-modulo .btn-barra >> nth=0'); pg.wait_for_selector('#atu-duvida', timeout=15000)
        t('não tem certeza' in pg.inner_text('#atu-duvida'), 'o app avisa que não tem certeza da lista')
        t(pg.locator('#atu-lista .obd-ap >> nth=0').is_disabled(), 'e o acionamento fica TRAVADO')
        pg.click('#atu-duvida .link'); pg.wait_for_timeout(400)
        t(not pg.locator('#atu-lista .obd-ap >> nth=0').is_disabled(), 'destrava só depois de o mecânico confirmar')
        pg.evaluate("window.__R['22FA23'] = '62FA23F101FA30'")
        pg.click('#atu-modulo .btn-barra >> nth=0'); pg.wait_for_selector('#atu-lista', timeout=15000)
        t(not pg.query_selector('#atu-duvida'), 'com resposta clara, não há dúvida')

        pg.click('#atu-lista .obd-ap >> nth=0'); pg.wait_for_selector('.quadro', timeout=10000)
        tq = pg.inner_text('.quadro')
        t('mão perto de ventoinha' in tq, 'antes de acionar, avisa do risco: %s' % tq[:70])
        pg.click('.quadro .btn-acao'); pg.wait_for_selector('#atu-andando', timeout=10000)
        pg.wait_for_timeout(8000)
        ta = pg.inner_text('#atu-andando')
        t('Controle devolvido ao módulo' in ta, 'o teste DEVOLVE o controle ao módulo no fim: %s' % ta[-90:])
        ch = pg.evaluate("window.__obd.chamadas")
        t(any(c.startswith('atuar:F101:03') for c in ch), 'acionou pela opção 03 (ajuste de curta duração)')
        t(any(c.startswith('atuar:F101:00') for c in ch), 'e devolveu pela opção 00')
        t(sum(1 for c in ch if c.startswith('atuar:F101:03')) > 1, 'repetindo o acionamento enquanto o teste corre')

        # ---- APRENDIZADOS: o "estou trabalhando" não é tratado como erro ----
        pg.goto(URL + '#/aprendizados'); pg.wait_for_selector('#diag-modulo', timeout=10000)
        pg.click('#diag-modulo .btn-barra'); pg.wait_for_timeout(2500)
        pg.click('#diag-modulo .obd-ap >> nth=0'); pg.wait_for_selector('#apr-modulo', timeout=10000)
        pg.click('#apr-modulo .btn-barra >> nth=0'); pg.wait_for_selector('#apr-lista', timeout=15000)
        t('AD6E' in pg.inner_text('#apr-lista'), 'lista as rotinas que o módulo informou')
        # SONDAR SEM RODAR NADA: ia pelo comando(), que o nativo recusa (0x31 não é de leitura), e
        # por isso nunca funcionava. Agora vai pelo método próprio `rotina` com subfunção 03.
        # O adaptador de mentira aplica a lista branca, então este teste prova de verdade.
        pg.evaluate("window.__obd.chamadas.length = 0; window.__obd.voltas = 0")
        pg.click('#apr-modulo .btn-barra >> nth=1'); pg.wait_for_timeout(6000)
        ch2 = pg.evaluate("window.__obd.chamadas")
        t(any(c.startswith('rotina:') and c.endswith(':03') for c in ch2),
          'a sondagem vai pelo método próprio, pedindo o RESULTADO (subfunção 03): %s' % ch2[:4])
        t(not any(c == 'comando-recusado' for c in ch2), 'e não é recusada pelo portão')
        t('não é permitido' not in textos(pg), 'a tela não mostra recusa do portão na sondagem')
        pg.evaluate("window.__obd.voltas = 0")
        pg.click('#apr-lista .obd-ap >> nth=0'); pg.wait_for_selector('.quadro', timeout=10000)
        t('não tem botão de desfazer' in pg.inner_text('.quadro'), 'avisa que aprendizado não se desfaz')
        pg.click('.quadro .btn-acao'); pg.wait_for_selector('#apr-andando', timeout=10000)
        pg.wait_for_timeout(6000)
        tap = pg.inner_text('#apr-andando')
        t('Trabalhando' in tap, 'o 0x78 do módulo aparece como ANDAMENTO, não como erro: %s' % tap[:80])
        t('Rotina concluída' in tap, 'e a rotina chega ao fim')

        # ---- PROGRAMAR BICO: a conferência de digitação, que é o que mais vale ----
        pg.goto(URL + '#/bico'); pg.wait_for_selector('#bico-codigos', timeout=10000)
        t(pg.query_selector('#bico-limite'), 'a tela diz, antes de tudo, onde o app chega hoje')
        t('NÃO tem tabela' in pg.inner_text('#bico-limite') and 'administrador' in pg.inner_text('#bico-limite'), 'e que o campo vem do manual e a gravação pede o administrador')
        pg.fill('.bico-cod >> nth=0', 'C2GKLL0'); pg.wait_for_timeout(300)
        t1 = pg.inner_text('#bico-codigos')
        t('não usa 0' in t1, 'zero no lugar do O é pego: %s' % [l for l in t1.split(chr(10)) if 'não usa' in l][:1])
        t('C2GKLLO' in t1, 'e o app diz qual é o código certo')
        pg.click('#bico-codigos .link'); pg.wait_for_timeout(300)
        t(pg.input_value('.bico-cod >> nth=0') == 'C2GKLLO', 'o atalho corrige o código digitado')
        pg.fill('.bico-cod >> nth=0', 'AAAAAAA'); pg.wait_for_timeout(300)
        t('fábrica' in pg.inner_text('#bico-codigos'), 'AAAAAAA é recusado como valor de fábrica')
        pg.fill('.bico-cod >> nth=0', 'C2GKLLO')
        pg.check('.bico-marca input >> nth=0'); pg.wait_for_timeout(400)
        t(pg.query_selector('#bico-plano'), 'marcado o cilindro trocado, aparece o plano')
        tp = pg.inner_text('#bico-plano')
        t('ler e guardar' in tp and 'ler de volta' in tp, 'o plano lê e guarda antes de gravar, e confere lendo de volta')
        t(not pg.query_selector('#bico-gravar') and 'campo' in pg.inner_text('#bico-falta'), 'sem o campo da ECU não existe botão de gravar, e a tela diz o que falta')
        pg.fill('.bico-campo >> nth=0', 'F190'); pg.wait_for_timeout(300)
        t(not pg.query_selector('#bico-gravar') and not pg.query_selector('#bico-conferir') and 'identificação' in pg.inner_text('#bico-codigos'), 'campo de identificação (chassi) é recusado na digitação')
        pg.fill('.bico-campo >> nth=0', '2A10'); pg.wait_for_timeout(300)
        t(not pg.query_selector('#bico-gravar'), 'a opção de gravar NÃO aparece antes de o módulo dizer que aceita')
        pg.click('#bico-conferir'); pg.wait_for_selector('#bico-aceite', timeout=20000)
        t('ACEITA' in pg.inner_text('#bico-aceite') and 'sondarGravacao:2A10' in pg.evaluate('window.__obd.chamadas'), 'o app pergunta ao módulo se aceita gravar: ' + pg.inner_text('#bico-aceite')[:90].replace(chr(10), ' '))
        t(not any(x.startswith('gravarDado') for x in pg.evaluate('window.__obd.chamadas')), 'e a pergunta não grava nada')
        t(pg.query_selector('#bico-gravar') and not pg.locator('#bico-gravar').is_disabled(), 'módulo aceitou: a opção de gravar aparece')
        pg.eval_on_selector('#bico-plano', "e => e.scrollIntoView({block:'start'})"); pg.wait_for_timeout(300); pg.screenshot(path=os.path.join(raiz, 'teste', 'telas', 'bico-aceite-celular.png'))
        pg.click('#bico-gravar'); pg.wait_for_selector('#bico-adm-ok', timeout=5000)
        t(not any(x.startswith('gravarDado') for x in pg.evaluate('window.__obd.chamadas')), 'nada é gravado antes da autorização do administrador')
        t(pg.locator('#bico-adm-ok').is_disabled(), 'sem login e senha o botão de autorizar fica desligado')
        # cancelar com a conferência do administrador em curso NÃO pode gravar depois (achado do Codex)
        pg.fill('#bico-adm-email', 'adm@dtcar.com'); pg.fill('#bico-adm-senha', 'certa'); pg.evaluate("document.querySelector('#bico-adm-ok').click(); [...document.querySelectorAll('.quadro button')].find(b => b.textContent.trim() === 'Cancelar').click()"); pg.wait_for_timeout(2500)
        t(not any(x.startswith('gravarDado') for x in pg.evaluate('window.__obd.chamadas')) and not pg.query_selector('#bico-desfazer'), 'cancelou durante a conferência: nada é gravado quando a resposta chega')
        pg.click('#bico-gravar'); pg.wait_for_selector('#bico-adm-ok', timeout=5000)
        pg.fill('#bico-adm-email', 'errado@dtcar.com'); pg.fill('#bico-adm-senha', 'senha-errada'); pg.click('#bico-adm-ok'); pg.wait_for_selector('#bico-adm-erro', timeout=10000)
        t(not any(x.startswith('gravarDado') for x in pg.evaluate('window.__obd.chamadas')) and pg.input_value('#bico-adm-senha') == '', 'login errado não grava e a senha é apagada do campo: ' + pg.inner_text('#bico-adm-erro'))
        pg.fill('#bico-adm-email', 'adm@dtcar.com'); pg.fill('#bico-adm-senha', 'certa'); pg.click('#bico-adm-ok'); pg.wait_for_selector('#bico-desfazer', timeout=30000)
        ch = pg.evaluate('window.__obd.chamadas'); gr = [x for x in ch if x.startswith('gravarDado')]
        t(len(gr) == 1 and gr[0].startswith('gravarDado:2A10:'), 'grava UMA vez, no campo informado: %s' % gr)
        ta = pg.inner_text('#bico-andando')
        t('Conferido' in ta and '7E0' in ta, 'aponta o módulo do motor, grava e confere lendo de volta: ' + ta.replace(chr(10), ' ')[:200])
        t('Registrado' in ta or 'guardado no aparelho' in ta, 'e o registro de quem gravou e quem autorizou é feito ou guardado')
        t(not pg.evaluate("Object.keys(window.localStorage).some(k => /password|senha/i.test(window.localStorage.getItem(k) || '') || /autoriza/.test(k))"), 'a senha do administrador não fica guardada no aparelho')
        pg.click('#bico-desfazer'); pg.wait_for_timeout(2500)
        gr = [x for x in pg.evaluate('window.__obd.chamadas') if x.startswith('gravarDado')]
        t(len(gr) == 2 and gr[1] == 'gravarDado:2A10:41414141414141' and 'voltou para o valor' in pg.inner_text('#bico-andando'), 'DESFAZER grava de volta o valor que estava: %s' % gr)
        pg.fill('.bico-campo >> nth=0', '2A99'); pg.wait_for_timeout(300)
        t(not pg.query_selector('#bico-gravar'), 'trocou o campo: a opção de gravar some até conferir de novo')
        pg.click('#bico-conferir'); pg.wait_for_selector('#bico-aceite', timeout=20000)
        t('NÃO ACEITA' in pg.inner_text('#bico-aceite') and 'DESTRAVAR' in pg.inner_text('#bico-aceite') and not pg.query_selector('#bico-gravar'), 'módulo que exige destravar: a opção de gravar NÃO aparece, e a tela diz por quê')
        t(len([x for x in pg.evaluate('window.__obd.chamadas') if x.startswith('gravarDado')]) == 2, 'e nada foi gravado nele')
        # o cilindro não marcado não entra
        pg.fill('.bico-cod:not(.bico-campo) >> nth=1', 'C2GKLLO'); pg.wait_for_timeout(300)
        pg.check('.bico-marca input >> nth=1'); pg.wait_for_timeout(400)
        t('mesmo código' in pg.inner_text('#bico-avisos'), 'dois cilindros com o mesmo código são barrados')
        t(not pg.query_selector('#bico-plano'), 'e o plano não aparece enquanto houver aviso grave')
        pg.goto(URL + '#/obd'); pg.wait_for_selector('.titulo b', timeout=10000)
        pg.goto(URL + '#/obd'); pg.wait_for_selector('.titulo b', timeout=10000); pg.wait_for_timeout(700)
        t(not pg.evaluate("window.__obd.chamadas.includes('desconectar')"), 'voltar para a leitura também não desconecta')
        # sair da família, sim: aí o adaptador é liberado e a bateria do carro agradece
        pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra', timeout=10000); pg.wait_for_timeout(900)
        t(pg.evaluate("window.__obd.chamadas.includes('desconectar')"), 'sair da família de diagnóstico desconecta o adaptador')

        # ---- TELA DE PARÂMETROS (era um cartão dentro da leitura até 20/11/2026) ----
        # Só de LEITURA: quem corrige é o Claude, no arquivo. Fica em tela porque é o que se
        # consulta para discutir um laudo, e cartão escondido dentro da leitura ninguém abre.
        pg.goto(URL + '#/parametros'); pg.wait_for_selector('#obd-parametros', timeout=15000)
        t(pg.inner_text('.titulo b').strip() == 'PARÂMETROS DE REFERÊNCIA', 'a tela de parâmetros abre')
        t(pg.query_selector('#param-escala'), 'e explica a diferença entre escala e faixa normal')
        t('0x24' in pg.inner_text('#param-escala'), 'citando o serviço que pede a escala ao próprio módulo')
        pg.click('#obd-param-abrir'); pg.wait_for_timeout(400)
        tpar = pg.inner_text('#obd-parametros')
        t(pg.locator('#obd-parametros .par-linha').count() >= 20, 'lista os parâmetros: %d' % pg.locator('#obd-parametros .par-linha').count())
        t(pg.locator('#obd-parametros .nv-montadora').count() > 0 and pg.locator('#obd-parametros .nv-suposto').count() > 0 and pg.locator('#obd-parametros .nv-norma').count() > 0,
          'com as tonalidades por nível de confiança')
        t('SUPOSTO, A CONFERIR' in tpar.upper(), 'o nível vem ESCRITO, não só na cor')
        t(pg.query_selector('#obd-parametros .par-legenda'), 'e tem legenda discreta')
        t('Ford' in tpar and 'CARB' in tpar, 'cada número mostra a fonte: %s' % [l for l in tpar.split('\n') if 'Ford' in l][:1])
        t('250 a 550 bar' in tpar, 'os valores sem documento aparecem marcados como suposto')
        t(not pg.query_selector('[data-conferir]') and not pg.query_selector('[data-gravar]'),
          'NÃO tem formulário: a correção vem pelo chat, não digitada no celular')
        t('mande a foto no chat' in tpar, 'e a tela explica como se corrige: %s' % [l for l in tpar.split('\n') if 'chat' in l][:1])
        ctx.close()
        # MECÂNICO LIBERADO PARA O OBD, MAS SEM PERMISSÃO DE APAGAR (decisão do Danilo: apagar é do administrador,
        # que libera por pessoa em Sistema › Equipe). Sem a chave ligada, o botão nem existe na tela dele.
        f2 = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['obd']}}); ctx2, pg2, er2 = abrir(br, f2, URL, plugin=False, antes=FAKE_OBD); entrar(pg2); tela(pg2, 'obd')
        pg2.click('#obd-procurar'); pg2.wait_for_selector('.obd-ap', timeout=20000); pg2.click('.obd-ap'); pg2.wait_for_selector('#obd-acoes', timeout=30000)
        t(pg2.query_selector('#obd-falhas'), 'o mecânico liberado lê as falhas')
        t(not pg2.query_selector('#obd-apagar'), 'mas NÃO tem o botão de apagar sem o administrador liberar')
        ctx2.close()
        f2 = Fake('mecanico', True, {UID: {'entra': True, 'telas': ['obd'], 'obd_apagar': True}}); ctx2, pg2, er2 = abrir(br, f2, URL, plugin=False, antes=FAKE_OBD); entrar(pg2); tela(pg2, 'obd')
        pg2.click('#obd-procurar'); pg2.wait_for_selector('.obd-ap', timeout=20000); pg2.click('.obd-ap'); pg2.wait_for_selector('#obd-acoes', timeout=30000)
        t(pg2.query_selector('#obd-apagar'), 'liberado por pessoa, o botão aparece para ele')
        ctx2.close()
        del VEI[0]['chassi']

        # 9) a tela "Sem internet" que vai dentro do APK (app/www): abre sozinha, com a logo, e tem o botão de tentar de novo
        f = Fake(); ctx, pg, er = abrir(br, f, 'http://localhost:8766/app/www/index.html', plugin=False)
        t('Sem internet' in textos(pg) and pg.is_visible('text=Tentar de novo'), 'app/www mostra a tela Sem internet')
        t(pg.evaluate("document.querySelector('img').naturalWidth") > 0, 'logo carrega em app/www')
        t(sorted(os.listdir(os.path.join(raiz, 'app', 'www'))) == ['icons', 'index.html'], 'app/www leva só a tela offline e a logo'); ctx.close()
        # 10) configuração do Capacitor: abre o app direto do site
        cfg = json.load(open(os.path.join(raiz, 'app', 'capacitor.config.json')))
        t(cfg['server']['url'] == 'https://gestao.dtcarcentroautomotivo.com.br/app/' and cfg['server']['errorPath'] == 'index.html', 'Capacitor abre o app do site e usa a tela offline em caso de erro')
        pk = json.load(open(os.path.join(raiz, 'app', 'package.json'))); t('@capacitor/app' in pk['dependencies'] and pk['version'] == '1.6.0', 'plugin App (botão Voltar) no APK e versão 1.6.0')
        t(pk['dependencies'].get('dtcar-obd') == 'file:plugins/obd', 'plugin local do OBD declarado como dependência do APK')
        pl = json.load(open(os.path.join(raiz, 'app', 'plugins', 'obd', 'package.json'))); t(pl['capacitor']['android']['src'] == 'android', 'o plugin do OBD se apresenta ao Capacitor como módulo Android')
        mf = open(os.path.join(raiz, 'app', 'plugins', 'obd', 'android', 'src', 'main', 'AndroidManifest.xml')).read()
        pedidas = re.findall(r'<uses-permission[^>]*android:name="android\.permission\.([A-Z_]+)"', mf)
        t('BLUETOOTH_CONNECT' in pedidas, 'permissão de Bluetooth no manifesto do plugin: %s' % pedidas)
        t('BLUETOOTH_SCAN' not in pedidas, 'NÃO pede BLUETOOTH_SCAN: o app só usa aparelho já pareado, e pedir isso escreveria "posição de aparelhos próximos" no aviso do Android: %s' % pedidas)
        t(not [x for x in pedidas if 'LOCATION' in x], 'nenhuma permissão de localização: %s' % pedidas)
        t(sorted(pedidas) == ['BLUETOOTH', 'BLUETOOTH_ADMIN', 'BLUETOOTH_CONNECT'], 'só as permissões de Bluetooth necessárias: %s' % sorted(pedidas))
        jv = open(os.path.join(raiz, 'app', 'plugins', 'obd', 'android', 'src', 'main', 'java', 'br', 'com', 'dtcarcentroautomotivo', 'obd', 'ObdPlugin.java')).read()
        lista_branca = jv.split('SERVICOS_LEITURA')[1].split(';')[0]
        t('SERVICOS_LEITURA' in jv and '"04"' not in lista_branca, 'a lista branca do comando() continua sem o serviço 04: %s' % lista_branca.replace('\n', ' ')[-70:])
        t('public void apagar(' in jv and 'return porUds ? "14FFFFFF" : "04";' in jv,
          'apagar é método próprio do plugin, com o comando escrito no código (04 no OBD-II, 14 FF FF FF no UDS)')
        t('comando-recusado' in jv, 'o nativo recusa comando fora da lista branca')
        # Cada coisa que AGE no carro tem método próprio, com nome: nenhuma passa pelo comando().
        for metodo in ('atuar', 'rotina', 'reiniciarModulo'):
            t(('public void %s(' % metodo) in jv, '%s é método próprio do plugin' % metodo)
        # E a promessa que a oficina pode fazer: este app NÃO regrava módulo.
        proibidos = jv.split('SERVICOS_PROIBIDOS')[1].split(';')[0]
        for sv in ('"34"', '"35"', '"36"', '"37"'):
            t(sv in proibidos, 'serviço de transferência %s está proibido no nativo' % sv)
        t('c.equals("1001") || c.equals("1003")' in jv,
          'a sessão de PROGRAMAÇÃO (10 02) não passa do portão: só a comum e a estendida')
        t('rotinaNaFaixa' in jv and '0x0200' in jv and '0xDFFF' in jv,
          'a faixa da rotina de veículo é conferida no nativo, não no site')
        # A faixa de identificação (F180-F1FF) não se grava: chassi e número de peça não são dado
        # de calibração, e gravar chassi é coisa que só se faz com má intenção.
        t('didGravavel' in jv and '0xF180' in jv and '0xF1FF' in jv,
          'a faixa de identificação do módulo é protegida contra gravação, no nativo')
        # Resposta atrasada de um pedido não pode entrar na resposta do seguinte: seria mostrar as
        # falhas de um módulo com o nome de outro.
        t('descartarAtrasado' in jv and 'descartarAtrasado(in);' in jv,
          'a entrada é esvaziada antes de cada envio')
        # Agir em DIFUSÃO (7DF) mandaria o comando para todos os módulos: um reiniciarModulo assim
        # reinicia o carro inteiro. Os métodos que agem exigem UM módulo escolhido.
        # Difusão por REGRA, não por lista de dois endereços: em 29 bits, um funcional com outra
        # origem passaria numa lista. 11 bits: barra o funcional 7DF e o que está fora de 600-7FF.
        # 29 bits: exige o prefixo 18DA, que é o endereçamento de UM módulo.
        t('emDifusao' in jv and '0x7DF' in jv and 'startsWith("18DA")' in jv,
          'o nativo recusa agir em difusão, por regra e não por lista')
        for metodo in ('atuar', 'rotina', 'reiniciarModulo'):
            corpo = jv.split('public void %s(' % metodo)[1].split('\n    }')[0]
            t('emDifusao()' in corpo, '%s confere se há UM módulo escolhido' % metodo)
        # ---- as listas do adaptador de mentira são AS MESMAS do Java ----
        # Sem isto o portão do teste e o do aparelho poderiam divergir, e o teste de navegador
        # voltaria a não provar nada.
        def lista_java(nome):
            bloco = jv.split(nome + ' = ')[1].split(';')[0]
            return sorted(re.findall(r'"([0-9A-Fa-z]+)"', bloco))
        fk = open(os.path.join(raiz, 'teste', 'teste_app_sistema.py'), encoding='utf-8').read()
        def lista_fake(nome):
            bloco = fk.split('window.__' + nome + ' = ')[1].split(';')[0]
            return sorted(re.findall(r"'([0-9A-Fa-z]+)'", bloco))
        for nome in ('AT_PERMITIDOS', 'SERVICOS_LEITURA', 'UDS_LEITURA', 'SERVICOS_PROIBIDOS'):
            j, f = lista_java(nome), lista_fake(nome)
            t(j == f, 'a lista %s do teste é igual à do Java: Java=%s teste=%s' % (nome, j, f))
        # ---- e o que importa de verdade: a DECISÃO, sonda por sonda ----
        # teste/obd_java/sondas.txt é a fonte única; o teste do Java confere o portão de verdade
        # contra o MESMO arquivo. Comparar lista não basta: no caso do ATCAF0 as listas estavam
        # iguais e a regra em volta não.
        sondas = []
        for linha in open(os.path.join(raiz, 'teste', 'obd_java', 'sondas.txt'), encoding='utf-8'):
            x = linha.strip()
            if not x or x.startswith('#'):
                continue
            sondas.append([x.startswith('sim'), x[4:] if len(x) > 3 else ''])
        t(len(sondas) >= 100, 'o arquivo de sondas tem conteúdo: %d' % len(sondas))
        # a página do teste já fechou aqui: o espelho roda numa página em branco, só com o portão
        pp = br.new_page(); pp.add_init_script(FAKE_OBD.replace('__VIN__', '')); pp.goto('about:blank')
        erradas = pp.evaluate('''(ss) => ss.filter(x => window.__portao(x[1]) !== x[0]).map(x => (x[0] ? 'devia aceitar ' : 'devia recusar ') + JSON.stringify(x[1]))''', sondas)
        pp.close()
        t(not erradas, 'o espelho em JavaScript decide igual ao Java nas %d sondas: %s' % (len(sondas), erradas[:6]))
        br.close()
    print('OK: %d conferências' % ok)
finally:
    srv.terminate()
