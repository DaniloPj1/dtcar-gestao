# Teste do app do sistema (pasta app/, o que vira o APK): entrar, só administrador/consultor, digital, tela inicial e a abertura das telas reais.
# O Supabase e o plugin da digital são de mentira (montados aqui). Confere também que nada é gravado no banco
# e que a pasta app/www (a tela "Sem internet" que vai dentro do APK) está certa.
# Uso: python3 teste/teste_app_sistema.py   (precisa de: pip install playwright pillow && playwright install chromium)
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.run([sys.executable, os.path.join(raiz, 'app', 'montar_www.py')], check=True, stdout=subprocess.DEVNULL)
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8766', '-d', raiz], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = 0
def t(c, m):
    global ok
    assert c, m; ok += 1
UID = '22222222-2222-2222-2222-222222222222'
ROTULOS = ['ÓLEO (APLICAÇÃO)', '+ ORÇAMENTO', '+ O.S.', 'AGENDAR', 'CONSULTAR PEÇA POR CATÁLOGO', 'HISTÓRICO DE SERVIÇOS', 'CONSULTAR O.S.']
# plugin da digital de mentira: o "cofre" (window.__cofre) sobrevive a recarregar a página; __ok controla se a leitura passa
PLUGIN = """
['__cofre', '__ok'].forEach(function (k) { Object.defineProperty(window, k, { configurable: true,
  get: function () { var v = sessionStorage.getItem(k); return v === null ? (k === '__ok' ? true : null) : JSON.parse(v); },
  set: function (v) { sessionStorage.setItem(k, JSON.stringify(v)); } }); });
window.__chamadas = [];
window.Capacitor = { Plugins: { NativeBiometric: {
  isAvailable: () => Promise.resolve({ isAvailable: window.__disp !== false }),
  verifyIdentity: (o) => { window.__chamadas.push('verify'); return window.__ok ? Promise.resolve() : Promise.reject(new Error('cancelado')); },
  setCredentials: (o) => { window.__chamadas.push('set'); window.__cofre = o; return Promise.resolve(); },
  getCredentials: (o) => window.__cofre ? Promise.resolve(window.__cofre) : Promise.reject(new Error('vazio')),
  deleteCredentials: (o) => { window.__chamadas.push('del'); window.__cofre = null; return Promise.resolve(); } } } };
"""
class Fake:
    def __init__(s, papel='admin', ativo=True): s.papel, s.ativo, s.pedidos, s.refresh, s.n = papel, ativo, [], 'r0', 0
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
            if '/rest/v1/perfis' in u: return resp(route, {'id': UID, 'nome': 'Fulano de Teste', 'papel': s.papel, 'ativo': s.ativo})
            return resp(route, [])
        pg.route('**/*.supabase.co/**', h)
    def escritas(s): return [p for p in s.pedidos if p[0] in ('POST', 'PATCH', 'PUT', 'DELETE') and '/auth/v1/' not in p[1]]
def abrir(br, fake, url, plugin=True, disponivel=True, antes=None):
    ctx = br.new_context(viewport={'width': 390, 'height': 800}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); erros = []
    pg.on('pageerror', lambda e: erros.append(str(e)))
    fake.instalar(pg)
    if plugin: pg.add_init_script(PLUGIN + ('' if disponivel else 'window.__disp=false;'))
    if antes: pg.add_init_script(antes)
    pg.goto(url); pg.wait_for_timeout(500)
    return ctx, pg, erros
def entrar(pg, email='teste@dtcar.com', senha='certa'):
    pg.fill('#lg-email', email); pg.fill('#lg-senha', senha); pg.click('button[type=submit]'); pg.wait_for_timeout(700)
def textos(pg): return pg.inner_text('body')
URL = 'http://localhost:8766/app/index.html'
try:
    with sync_playwright() as p:
        br = p.chromium.launch()
        # 1) tela de entrada, erros de preenchimento e senha errada
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False)
        t(pg.is_visible('#f-login'), 'abre na tela de entrada')
        pg.click('button[type=submit]'); t('Digite o seu e-mail' in textos(pg), 'pede o e-mail')
        pg.fill('#lg-email', 'a@b.com'); pg.click('button[type=submit]'); t('Digite a sua senha' in textos(pg), 'pede a senha')
        entrar(pg, 'a@b.com', 'errada'); t('E-mail ou senha incorretos' in textos(pg), 'senha errada avisa')
        t(pg.input_value('#lg-email') == 'a@b.com', 'mantém o e-mail digitado após o erro')
        pg.click('.ver'); t(pg.get_attribute('#lg-senha', 'type') == 'text', 'botão Mostrar revela a senha')
        # 2) login certo como administrador, sem plugin (navegador): sem oferta de digital
        entrar(pg); t('Olá, Fulano' in textos(pg) and 'Administrador' in textos(pg), 'entra como administrador')
        barras = pg.locator('.barra').all_inner_texts(); t([b.strip() for b in barras] == ROTULOS, 'sete botões na ordem do protótipo: %s' % barras)
        t(pg.locator('.quadro').count() == 0, 'sem plugin não oferece a digital')
        t(not f.escritas(), 'não grava nada no banco: %s' % f.escritas())
        # cada botão abre a tela real do sistema, no modo app (?app=1), levando a marca de modo app
        ROTAS = ['oleo-filtros', 'orcamento/novo', 'entrada', 'agenda', 'pecas', 'historico', 'ordens?filtro=todas']
        for i, rota in enumerate(ROTAS):
            ctx2, pg2, _ = abrir(br, f, URL, plugin=False); entrar(pg2)
            with pg2.expect_navigation():
                pg2.click('.barra >> nth=%d' % i)
            t(pg2.url == 'http://localhost:8766/index.html?app=1#/' + rota, 'botão %d abre o sistema em %s: %s' % (i + 1, rota, pg2.url))
            t(pg2.evaluate("sessionStorage.getItem('dtcar-modo-app')") == '1', 'botão %d marca o modo app' % (i + 1)); ctx2.close()
        pg.click('.menu >> text=Ajuda'); pg.wait_for_timeout(300); t('Seu acesso' in textos(pg) and 'teste@dtcar.com' in textos(pg) and '1.1.0' in textos(pg), 'ajuda mostra o acesso e a versão')
        t(pg.is_hidden('#bloco-digital'), 'sem plugin o interruptor da digital fica escondido')
        # recarregar mantém a sessão (sem digital)
        pg.reload(); pg.wait_for_timeout(600); t(pg.locator('.menu').count() == 1 and 'AJUDA' in textos(pg), 'recarregar mantém a sessão e a rota')
        # sair
        pg.click('text=SAIR DO APP'); pg.wait_for_timeout(300); t(pg.is_visible('#f-login'), 'sair volta para a entrada')
        pg.reload(); pg.wait_for_timeout(500); t(pg.is_visible('#f-login'), 'depois de sair, recarregar pede a senha')
        t(not er, 'sem erro de script: %s' % er); ctx.close()
        # 3) consultor entra; mecânico, pendente e inativo não
        f = Fake('consultor'); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t('Consultor' in textos(pg) and pg.locator('.barra').count() == 7, 'consultor entra'); ctx.close()
        for papel, ativo in (('mecanico', True), ('pendente', True), ('admin', False)):
            f = Fake(papel, ativo); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
            t('Este app é para o administrador e o consultor' in textos(pg) and pg.locator('.barra').count() == 0, 'recusa %s ativo=%s' % (papel, ativo))
            pg.reload(); pg.wait_for_timeout(500); t(pg.is_visible('#f-login'), 'recusado não fica logado após recarregar (%s)' % papel); ctx.close()
        # 4) digital: oferta depois do primeiro login, "agora não", e ligar
        f = Fake(); ctx, pg, er = abrir(br, f, URL); entrar(pg)
        t(pg.is_visible('.quadro') and 'Entrar com a digital?' in textos(pg), 'oferece a digital após o primeiro login')
        pg.click('text=Agora não'); t(pg.locator('.quadro').count() == 0, 'agora não fecha o quadro')
        pg.reload(); pg.wait_for_timeout(600); t(pg.locator('.quadro').count() == 0, 'depois de recusar não oferece de novo')
        pg.click('.menu >> text=Ajuda'); pg.wait_for_timeout(300)
        t(pg.is_visible('#bloco-digital') and pg.get_attribute('[data-acao=chave-digital]', 'aria-checked') == 'false', 'Ajuda mostra a chave desligada')
        pg.click('[data-acao=chave-digital]'); pg.wait_for_timeout(500)
        cofre = pg.evaluate('window.__cofre')
        t(cofre and cofre['password'] == f.refresh and cofre['server'] == 'br.com.dtcarcentroautomotivo.gestao', 'cofre guarda só a chave de renovação: %s' % cofre)
        t(cofre['password'] != 'certa', 'a senha nunca vai para o cofre')
        t(pg.get_attribute('[data-acao=chave-digital]', 'aria-checked') == 'true', 'chave fica ligada')
        t(pg.evaluate("localStorage.getItem('dtcar-app-digital')") == '1', 'marca a digital como ligada')
        # 5) app aberto de novo (a leitura da digital vale só até fechar o app): pede a digital e usa a sessão do aparelho
        pg.evaluate("sessionStorage.removeItem('dtcar-app-aberto')"); pg.evaluate('window.__chamadas = []'); pg.reload(); pg.wait_for_timeout(1500)
        t('Fulano' in textos(pg) and pg.locator('.menu').count() == 1, 'reabrir com a digital entra no app')
        t(pg.evaluate("sessionStorage.getItem('dtcar-app-aberto')") == '1', 'marca que a digital já foi lida nesta abertura')
        # voltando do sistema para a tela de botões (mesma abertura): não pede a digital de novo
        pg.reload(); pg.wait_for_timeout(1200)  # a lista de chamadas do plugin recomeça a cada carga da página
        t(pg.locator('.menu').count() == 1 and pg.evaluate('window.__chamadas.filter(x => x === "verify").length') == 0, 'voltar do sistema não pede a digital de novo')
        t(pg.evaluate('window.__cofre')['password'] == f.refresh, 'cofre acompanha a chave da sessão atual')
        # sair com a digital: só tranca
        pg.click('text=SAIR DO APP'); pg.wait_for_timeout(1500)
        t('verify' in pg.evaluate('window.__chamadas'), 'sair com a digital tranca: ao abrir de novo pede a digital')
        t(any(p[1] == '/auth/v1/token' and 'refresh_token' in p[2] for p in f.pedidos[-6:]), 'depois de trancar, a sessão volta pelo cofre (não ficou no aparelho)')
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
        t('Este app é para o administrador e o consultor' in textos(pg) and pg.evaluate('window.__cofre') is None, 'papel mudado para mecânico é barrado na digital'); ctx.close()
        # 8) celular 390px sem rolagem lateral e a barra de baixo fica à vista
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'sem rolagem lateral em 390px')
        t(pg.evaluate("getComputedStyle(document.querySelector('.barra')).backgroundColor") == 'rgb(47, 111, 181)', 'botões na cor azul da DTCar')
        t(pg.locator('.barra').first.bounding_box()['height'] >= 44, 'botão com altura de toque'); ctx.close()
        # 9) a tela "Sem internet" que vai dentro do APK (app/www): abre sozinha, com a logo, e tem o botão de tentar de novo
        f = Fake(); ctx, pg, er = abrir(br, f, 'http://localhost:8766/app/www/index.html', plugin=False)
        t('Sem internet' in textos(pg) and pg.is_visible('text=Tentar de novo'), 'app/www mostra a tela Sem internet')
        t(pg.evaluate("document.querySelector('img').naturalWidth") > 0, 'logo carrega em app/www')
        t(sorted(os.listdir(os.path.join(raiz, 'app', 'www'))) == ['icons', 'index.html'], 'app/www leva só a tela offline e a logo'); ctx.close()
        # 10) configuração do Capacitor: abre o app direto do site
        cfg = json.load(open(os.path.join(raiz, 'app', 'capacitor.config.json')))
        t(cfg['server']['url'] == 'https://gestao.dtcarcentroautomotivo.com.br/app/' and cfg['server']['errorPath'] == 'index.html', 'Capacitor abre o app do site e usa a tela offline em caso de erro')
        br.close()
    print('OK: %d conferências' % ok)
finally:
    srv.terminate()
