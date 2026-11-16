// App do sistema DTCar (celular / APK). Versão 1: entrar (e-mail e senha, depois a digital) e tela inicial de botões.
// Mesmo login do DTCar Gestão (Supabase Auth). Só administrador e consultor entram.
// Depois de entrar, as telas (Início com os 7 botões, Óleo, Orçamento, O.S., Agendar, Peças, Histórico, Consultar O.S., Ajuda) são as de
// telas.js, desenhadas a partir do protótipo aprovado. O app e o sistema usam a mesma sessão do Supabase (mesmo armazenamento).
// Este arquivo não grava nada no banco: só entra, cuida da digital e chama as telas.
(function () {
  'use strict';

  var VERSAO = '1.3.0';
  var SERVIDOR = 'br.com.dtcarcentroautomotivo.gestao'; // nome do "cofre" da digital no aparelho
  var CH_DIGITAL = 'dtcar-app-digital';   // "1" quando a entrada com a digital está ligada
  var CH_RECUSOU = 'dtcar-app-digital-recusada'; // "1" quando a pessoa disse "agora não"
  var CH_EMAIL = 'dtcar-app-email';
  var CH_NOME = 'dtcar-app-nome';
  var CH_ABERTO = 'dtcar-app-aberto';     // sessionStorage: a digital já foi lida desde que o app foi aberto
  var CH_MODO = 'dtcar-modo-app';         // sessionStorage: o sistema está aberto de dentro do app (js/modoapp.js); as telas marcam ao abrir uma O.S.
  var PAPEIS_OK = { admin: 'Administrador', consultor: 'Consultor', mecanico: 'Mecânico' };

  var sb = null;
  var E = { usuario: null, tela: 'iniciando', erro: '', ocupado: false, quadro: '' };

  // ---------- ícones (traço, mesmos do protótipo) ----------
  var IC = {
    oleo: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    orc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M12 12v5M9.5 14.5h5"/>',
    os: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
    ag: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    peca: '<path d="M21 8l-9-5-9 5v8l9 5 9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',
    hist: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    clip: '<path d="M9 4h6v3H9z"/><path d="M7 5H6a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1"/><path d="M8 12h8M8 16h5"/>',
    home: '<path d="M4 11l8-7 8 7M6 10v9h12v-9M10 19v-5h4v5"/>',
    help: '<path d="M12 21a9 9 0 1 0-9-9c0 1.6.4 3 1.2 4.2L3 21l4.8-1.2A9 9 0 0 0 12 21z"/><path d="M9.7 9.6a2.4 2.4 0 1 1 3.4 2.2c-.7.4-1.1.9-1.1 1.6M12 16.5h.01"/>',
    exit: '<path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
    digital: '<path d="M12 11v3c0 2.2-.5 4-1.5 5.5"/><path d="M8.5 12.5V11a3.5 3.5 0 0 1 7 0v2c0 2.6-.4 4.9-1.3 6.8"/><path d="M5 13v-2a7 7 0 0 1 14 0v2c0 1.6-.1 3.1-.4 4.5"/><path d="M5.5 16.5c-.2 1-.5 2-.9 3M8.5 16c-.2 1.3-.6 2.6-1.2 3.8"/>'
  };
  function svg(nome, tam, traco) {
    return '<svg width="' + tam + '" height="' + tam + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' + (traco || 1.9) + '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0">' + IC[nome] + '</svg>';
  }

  // ---------- guardados simples (nunca guardam senha) ----------
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) { /* sem espaço: segue sem guardar */ } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* nada */ } }
  function ssSet(k, v) { try { window.sessionStorage.setItem(k, v); } catch (e) { /* nada */ } }
  function ssGet(k) { try { return window.sessionStorage.getItem(k); } catch (e) { return null; } }
  function digitalLigada() { return lsGet(CH_DIGITAL) === '1'; }

  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var _av;
  function avisar(texto) {
    var el = document.getElementById('aviso'); if (!el) return;
    el.textContent = texto; el.hidden = false;
    clearTimeout(_av); _av = setTimeout(function () { el.hidden = true; }, 4500);
  }

  // ---------- digital (plugin do Capacitor; fora do APK não existe e a opção some) ----------
  function plugin() {
    var C = window.Capacitor; if (!C) return null;
    if (C.Plugins && C.Plugins.NativeBiometric) return C.Plugins.NativeBiometric;
    if (typeof C.registerPlugin === 'function') { try { return C.registerPlugin('NativeBiometric'); } catch (e) { /* sem plugin */ } }
    return null;
  }
  function digitalDisponivel() {
    var P = plugin(); if (!P) return Promise.resolve(false);
    return P.isAvailable().then(function (r) { return !!(r && r.isAvailable); }, function () { return false; });
  }
  function pedirDigital(texto) {
    return plugin().verifyIdentity({ reason: texto, title: 'DTCar', subtitle: texto, description: 'Use a sua digital.' });
  }
  function guardarToken(refresh) {
    var P = plugin(); if (!P || !digitalLigada() || !refresh) return Promise.resolve();
    return P.setCredentials({ username: lsGet(CH_EMAIL) || 'usuario', password: refresh, server: SERVIDOR }).catch(function () { /* sem cofre: pede senha na próxima */ });
  }
  function desligarDigital() {
    var P = plugin(); lsDel(CH_DIGITAL);
    if (P) P.deleteCredentials({ server: SERVIDOR }).catch(function () { /* nada */ });
  }

  // ---------- entrar ----------
  function mensagemDeErro(err) {
    var m = (err && err.message) || '';
    if (/invalid login|invalid credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (err && (err.name === 'AuthRetryableFetchError' || /fetch|network|timeout/i.test(m))) return 'Não consegui entrar. Confira a internet.';
    return 'Não consegui entrar. Tente de novo.';
  }
  function ehFalhaDeRede(err) { return !!err && (err.name === 'AuthRetryableFetchError' || /fetch|network|timeout/i.test(err.message || '')); }

  function entrarComSenha(email, senha) {
    E.ocupado = true; desenhar();
    return sb.auth.signInWithPassword({ email: email, password: senha }).then(function (r) {
      if (r.error || !r.data || !r.data.user) { E.ocupado = false; E.erro = mensagemDeErro(r.error); desenhar(); return; }
      return aposLogin(r.data.user, 'senha');
    }, function () { E.ocupado = false; E.erro = 'Não consegui entrar. Confira a internet.'; desenhar(); });
  }

  // confere o acesso: cadastro de acessos (perfis) + o que o administrador liberou para o app em Sistema › Equipe (config.appAcessos, js/appacesso.js)
  function aposLogin(user, origem) {
    return Promise.all([
      sb.from('perfis').select('id,nome,papel,ativo').eq('id', user.id).maybeSingle(),
      sb.from('config').select('dados').eq('id', 1).maybeSingle(),
      import('../js/appacesso.js')
    ]).then(function (rs) {
      var r = rs[0], cfg = (rs[1] && rs[1].data && rs[1].data.dados) || {}, acesso = rs[2].acessoApp(cfg, r.data);
      if (r.error) { E.ocupado = false; E.tela = 'login'; E.erro = 'Não consegui conferir o seu acesso. Confira a internet e tente de novo.'; desenhar(); return; }
      var pf = r.data;
      if (!pf || pf.ativo === false || !acesso.entra) {
        sb.auth.signOut({ scope: 'local' }).catch(function () { /* nada */ });
        desligarDigital(); try { window.sessionStorage.removeItem(CH_ABERTO); } catch (e) { /* nada */ }
        E.ocupado = false; E.tela = 'login'; E.usuario = null;
        E.erro = pf && pf.ativo !== false && pf.papel !== 'pendente' ? 'Este app não está liberado para o seu login. Peça ao administrador (Sistema › Equipe).' : 'Este app é para a equipe da DTCar com acesso liberado pelo administrador.'; desenhar(); return;
      }
      var nome = pf.nome || user.email, primeiro = String(nome).split(' ')[0];
      lsSet(CH_EMAIL, user.email); lsSet(CH_NOME, primeiro);
      E.usuario = { id: pf.id, nome: nome, primeiro: primeiro, papel: pf.papel, email: user.email, telas: acesso.telas };
      if (digitalLigada()) sb.auth.getSession().then(function (g) { var se = g && g.data && g.data.session; if (se) guardarToken(se.refresh_token); });
      E.ocupado = false; E.erro = ''; E.tela = 'app';
      if (!/^#\/(inicio|ajuda|oleo|orcamento|agendar|peca|historico|osconsulta)$/.test(location.hash)) location.hash = '#/inicio';
      desenhar();
      if (origem === 'senha') oferecerDigital();
    }, function () { E.ocupado = false; E.tela = 'login'; E.erro = 'Não consegui conferir o seu acesso. Confira a internet e tente de novo.'; desenhar(); });
  }

  function oferecerDigital() {
    if (digitalLigada() || lsGet(CH_RECUSOU) === '1') return;
    digitalDisponivel().then(function (ok) { if (ok) { E.quadro = 'digital'; desenhar(); } });
  }
  function ativarDigital() {
    if (!plugin()) return Promise.resolve(false);
    return pedirDigital('Confirme que é você').then(function () {
      return sb.auth.getSession();
    }).then(function (r) {
      var s = r && r.data && r.data.session; if (!s) throw new Error('sem sessão');
      return plugin().setCredentials({ username: E.usuario.email, password: s.refresh_token, server: SERVIDOR });
    }).then(function () {
      lsSet(CH_DIGITAL, '1'); lsDel(CH_RECUSOU); ssSet(CH_ABERTO, '1');
      avisar('Pronto: nas próximas vezes, entre com a digital.'); return true;
    }, function () { avisar('Não deu para ligar a digital. Tente de novo.'); return false; });
  }

  // tela da digital: lê a digital, pega o acesso guardado no cofre e renova a sessão
  function desbloquear() {
    if (E.ocupado) return;
    var P = plugin(); if (!P) { E.tela = 'login'; desenhar(); return; }
    E.ocupado = true; desenhar();
    pedirDigital('Entrar no app').then(function () {
      // a sessão do sistema continua no aparelho: usa ela; só se sumiu é que renova pela chave guardada no cofre
      return sb.auth.getSession().then(function (g) {
        var se = g && g.data && g.data.session;
        if (se) return { data: { session: se, user: se.user } };
        return P.getCredentials({ server: SERVIDOR }).then(function (c) {
          return sb.auth.refreshSession({ refresh_token: c.password });
        }, function () { return { error: { name: 'SemCofre', message: 'sem acesso guardado' } }; });
      });
    }, function () { return { cancelou: true }; }).then(function (r) {
      if (r.cancelou) { E.ocupado = false; desenhar(); avisar('Não deu para ler a digital. Tente de novo ou use a senha.'); return; }
      if (r.error || !r.data || !r.data.session) {
        E.ocupado = false;
        if (ehFalhaDeRede(r.error)) { desenhar(); avisar('Sem internet. Tente de novo quando voltar.'); return; }
        desligarDigital(); E.tela = 'login'; E.erro = 'Entre com a senha de novo.'; desenhar(); return;
      }
      ssSet(CH_ABERTO, '1');
      return guardarToken(r.data.session.refresh_token).then(function () { return aposLogin(r.data.user || r.data.session.user, 'digital'); });
    });
  }

  // a sessão que o Supabase guarda no aparelho (chave sb-...-auth-token): apagar sem encerrar no servidor
  function apagarSessaoLocal() {
    try { Object.keys(window.localStorage).filter(function (k) { return /^sb-.*-auth-token$/.test(k); }).forEach(function (k) { window.localStorage.removeItem(k); }); } catch (e) { /* nada */ }
  }
  // sair: com a digital ligada tranca — a chave de renovação vai para o cofre e some do aparelho (sem encerrar no servidor,
  // senão a do cofre deixaria de valer); a próxima abertura pede a digital. Sem digital, encerra a sessão (a do sistema também, é a mesma)
  function sair() {
    try { window.sessionStorage.removeItem(CH_ABERTO); window.sessionStorage.removeItem(CH_MODO); } catch (e) { /* nada */ }
    if (digitalLigada()) {
      sb.auth.getSession().then(function (g) { var se = g && g.data && g.data.session; return se ? guardarToken(se.refresh_token) : null; })
        .catch(function () { /* nada */ }).then(function () { apagarSessaoLocal(); location.hash = ''; location.reload(); });
      return;
    }
    sb.auth.signOut({ scope: 'local' }).catch(function () { /* nada */ });
    E.usuario = null; E.tela = 'login'; E.erro = ''; location.hash = ''; desenhar();
  }
  // na tela da digital: quer entrar com outro e-mail. Encerra aquela sessão e apaga o cofre
  function usarSenha() {
    var P = plugin();
    var fim = function () { desligarDigital(); try { window.sessionStorage.removeItem(CH_ABERTO); } catch (e) { /* nada */ } E.tela = 'login'; E.erro = ''; E.ocupado = false; desenhar(); };
    if (!P) { fim(); return; }
    P.getCredentials({ server: SERVIDOR }).then(function (c) { return sb.auth.refreshSession({ refresh_token: c.password }); })
      .then(function () { return sb.auth.signOut({ scope: 'local' }); }).catch(function () { /* melhor esforço */ }).then(fim);
  }

  // ---------- desenho das telas ----------
  function telaLogin() {
    var email = lsGet(CH_EMAIL) || '', nome = lsGet(CH_NOME);
    return '<main class="tela login"><div class="topo"><div class="topo-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo"></div></div>' +
      '<form class="folha-login" id="f-login" novalidate><h1>' + (nome ? 'Olá, ' + esc(nome) : 'Entrar') + '</h1>' +
      '<p class="nota-login">Use o mesmo e-mail e a mesma senha do DTCar Gestão. Este app é para o administrador e o consultor.</p>' +
      '<div class="campo-login"><label for="lg-email">E-mail</label><input id="lg-email" type="email" inputmode="email" autocomplete="username" autocapitalize="none" value="' + esc(email) + '"></div>' +
      '<div class="campo-login"><label for="lg-senha">Senha</label><div class="senha-linha"><input id="lg-senha" type="password" autocomplete="current-password">' +
      '<button type="button" class="ver" data-acao="ver" aria-label="Mostrar a senha">Mostrar</button></div></div>' +
      (E.erro ? '<p class="nota-login" role="alert" style="color:#a12a2a;font-weight:600">' + esc(E.erro) + '</p>' : '') +
      '<button type="submit" class="botao"' + (E.ocupado ? ' disabled' : '') + '>' + (E.ocupado ? 'ENTRANDO…' : 'ENTRAR') + '</button></form></main>';
  }
  function telaDigital() {
    var nome = lsGet(CH_NOME);
    return '<main class="tela login"><div class="topo"><div class="topo-linha"><img src="../icons/logo-branco-sm.png" alt="DTCar Centro Automotivo"></div></div>' +
      '<section class="folha-login"><h1>' + (nome ? 'Olá, ' + esc(nome) : 'Entrar') + '</h1><div class="digital-icone">' + svg('digital', 48, 1.6) + '</div>' +
      '<p class="nota-login" style="text-align:center">Toque no botão e use a sua digital para entrar.</p>' +
      (E.erro ? '<p class="nota-login" role="alert" style="color:#a12a2a;font-weight:600;text-align:center">' + esc(E.erro) + '</p>' : '') +
      '<button type="button" class="botao" data-acao="digital"' + (E.ocupado ? ' disabled' : '') + '>' + svg('digital', 22, 2) + (E.ocupado ? 'ENTRANDO…' : 'ENTRAR COM A DIGITAL') + '</button>' +
      '<button type="button" class="link" data-acao="usar-senha">Entrar com e-mail e senha</button></section></main>';
  }
  function quadroDigital() {
    return '<div class="fundo-quadro"><section class="quadro" role="dialog" aria-modal="true" aria-labelledby="q-t"><h2 id="q-t">Entrar com a digital?</h2>' +
      '<p>Nas próximas vezes você entra só com a sua digital, sem digitar a senha. A senha não fica guardada no aparelho.</p>' +
      '<button type="button" class="botao" data-acao="digital-sim">' + svg('digital', 22, 2) + 'LIGAR A DIGITAL</button>' +
      '<button type="button" class="link" data-acao="digital-nao">Agora não</button></section></div>';
  }

  // as telas de dentro do app (telas.js) são montadas uma vez, depois do login; o quadro da digital fica por cima
  var telas = null, montado = false;
  function montarTelas() {
    if (montado) return;
    montado = true;
    var raiz = document.getElementById('raiz');
    raiz.innerHTML = '<main class="tela"><p class="sem-js">Abrindo o DTCar…</p></main>';
    (telas ? Promise.resolve(telas) : import('./telas.js').then(function (m) { telas = m; return m; })).then(function (m) {
      if (E.tela !== 'app' || !E.usuario) return;
      m.montar(E.usuario, {
        VERSAO: VERSAO, sair: sair,
        digital: { disponivel: digitalDisponivel, ligada: digitalLigada, ativar: ativarDigital, desligar: function () { desligarDigital(); avisar('Digital desligada. Na próxima vez, entre com a senha.'); } }
      });
    }, function () { montado = false; raiz.innerHTML = '<main class="tela"><p class="sem-js">Não deu para abrir as telas. Confira a internet.</p><p style="text-align:center"><button type="button" class="botao" onclick="location.reload()">TENTAR DE NOVO</button></p></main>'; });
  }
  function desmontarTelas() { if (montado && telas) telas.desmontar(); montado = false; }

  // ---------- botão Voltar do celular (plugin App do Capacitor; fora do APK não existe) ----------
  // Pedido do Danilo (16/11/2026): o Voltar não pode sair do app. Fecha o quadro aberto, volta ao Início e, só no Início, deixa o app de lado.
  function pluginApp() {
    var C = window.Capacitor; if (!C) return null;
    if (C.Plugins && C.Plugins.App) return C.Plugins.App;
    if (typeof C.registerPlugin === 'function') { try { return C.registerPlugin('App'); } catch (e) { /* sem plugin */ } }
    return null;
  }
  function ligarVoltar() {
    var A = pluginApp(); if (!A || typeof A.addListener !== 'function') return;
    A.addListener('backButton', function () {
      if (E.quadro === 'digital') { lsSet(CH_RECUSOU, '1'); E.quadro = ''; desenhar(); return; } // Voltar fecha o quadro da digital como "Agora não"
      if (E.tela === 'app' && telas && telas.voltar()) return;
      if (E.tela === 'app' && !telas) { location.hash = '#/inicio'; return; }
      if (typeof A.minimizeApp === 'function') A.minimizeApp(); else if (typeof A.exitApp === 'function') A.exitApp();
    });
  }

  function desenhar() {
    var raiz = document.getElementById('raiz'), quadro = document.getElementById('quadro'); if (!raiz) return;
    if (E.tela === 'app' && E.usuario) {
      montarTelas();
      if (quadro) quadro.innerHTML = E.quadro === 'digital' ? quadroDigital() : '';
      return;
    }
    desmontarTelas();
    if (quadro) quadro.innerHTML = '';
    var html;
    if (E.tela === 'login') html = telaLogin();
    else if (E.tela === 'digital') html = telaDigital();
    else html = '<main class="tela"><p class="sem-js">Carregando o DTCar…</p></main>';
    // guarda o que foi digitado quando só o aviso de erro muda
    var campos = { e: (document.getElementById('lg-email') || {}).value, s: (document.getElementById('lg-senha') || {}).value };
    raiz.innerHTML = html;
    if (E.tela === 'login') {
      var ie = document.getElementById('lg-email'), is = document.getElementById('lg-senha');
      if (campos.e) ie.value = campos.e; if (campos.s) is.value = campos.s;
      if (E.erro && is) is.focus();
    }
  }

  // ---------- toques e envio do formulário ----------
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest && ev.target.closest('[data-acao]'); if (!el) return;
    var a = el.getAttribute('data-acao');
    if (a === 'sair') sair();
    else if (a === 'digital') desbloquear();
    else if (a === 'usar-senha') usarSenha();
    else if (a === 'ver') {
      var i = document.getElementById('lg-senha'); var mostrar = i.type === 'password';
      i.type = mostrar ? 'text' : 'password'; el.textContent = mostrar ? 'Ocultar' : 'Mostrar';
      el.setAttribute('aria-label', mostrar ? 'Ocultar a senha' : 'Mostrar a senha');
    }
    else if (a === 'digital-sim') { E.quadro = ''; desenhar(); ativarDigital(); }
    else if (a === 'digital-nao') { lsSet(CH_RECUSOU, '1'); E.quadro = ''; desenhar(); avisar('Tudo bem. Você pode ligar depois, na Ajuda.'); }
  });
  document.addEventListener('submit', function (ev) {
    if (ev.target.id !== 'f-login') return;
    ev.preventDefault();
    if (E.ocupado) return;
    var email = document.getElementById('lg-email').value.trim(), senha = document.getElementById('lg-senha').value;
    if (!email) { E.erro = 'Digite o seu e-mail.'; desenhar(); return; }
    if (!senha) { E.erro = 'Digite a sua senha.'; desenhar(); return; }
    E.erro = ''; entrarComSenha(email, senha);
  });

  // ---------- partida ----------
  function iniciar() {
    var cfg = window.DTCAR_CONFIG || {};
    if (!window.supabase || !cfg.SUPABASE_URL) {
      document.getElementById('raiz').innerHTML = '<main class="tela"><p class="sem-js">Sem conexão com o sistema. Abra o app de novo com internet.</p></main>'; return;
    }
    var digital = digitalLigada();
    // a sessão é a mesma do sistema (mesmo armazenamento do Supabase); com a digital ligada o app pede a digital a cada vez que é aberto
    sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false } });
    // o Supabase troca a chave de renovação de tempos em tempos: o cofre acompanha
    sb.auth.onAuthStateChange(function (evento, sessao) {
      if (evento === 'TOKEN_REFRESHED' && sessao) setTimeout(function () { guardarToken(sessao.refresh_token); }, 0);
    });
    if (digital && ssGet(CH_ABERTO) !== '1') {
      digitalDisponivel().then(function (ok) {
        if (ok) { E.tela = 'digital'; desenhar(); setTimeout(desbloquear, 300); }
        else { desligarDigital(); E.tela = 'login'; desenhar(); }
      });
      return;
    }
    sb.auth.getSession().then(function (r) {
      var s = r && r.data && r.data.session;
      if (s) aposLogin(s.user, 'sessao'); else { E.tela = 'login'; desenhar(); }
    }, function () { E.tela = 'login'; desenhar(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { ligarVoltar(); iniciar(); }); else { ligarVoltar(); iniciar(); }
})();
