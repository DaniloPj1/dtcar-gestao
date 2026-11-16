# Teste do app do sistema (pasta app/, o que vira o APK): entrar, só administrador/consultor, digital, tela inicial e as telas do protótipo
# (Óleo, + Orçamento, + O.S., Agendar, Peça por catálogo, Histórico, Consultar O.S.) gravando num Supabase de mentira.
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
CLI = [{'id': 'c1', 'nome': 'JOÃO DA SILVA', 'telefone': '27999990000', 'doc': '12345678909', 'cep': '29700-000', 'cidade': 'Colatina', 'uf': 'ES', 'rua': 'RUA EXEMPLO, 100', 'bairro': 'CENTRO', 'situacao': 'liberado'}]
VEI = [{'id': 'v1', 'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015', 'ano_fab': 2014, 'ano_mod': 2015, 'cor': 'PRATA', 'cliente_id': 'c1', 'km_atual': 80000}]
PROD = [{'id': 'p1', 'codigo': 1, 'tipo': 'produto', 'descricao': 'FILTRO OLEO TECFIL PSL560', 'referencia': 'PSL560', 'categoria': 'Filtros', 'ativo': True, 'estoque_atual': 4, 'preco_vista': 35}]
ORD = [{'id': 'o1', 'numero': 1900, 'status': 'entregue', 'cliente_id': 'c1', 'veiculo_id': 'v1', 'km_entrada': 75000, 'total': 450, 'criado_em': '2026-09-02T10:00:00-03:00', 'entregue_em': '2026-09-03T10:00:00-03:00', 'finalizada_em': '2026-09-03T10:00:00-03:00', 'recebido': 450, 'reclamacao': 'Troca de óleo e filtros', 'cliente': {'nome': 'JOÃO DA SILVA'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015'}, 'mecanico_nome': 'Carlos'},
       {'id': 'o2', 'numero': 1920, 'status': 'execucao', 'cliente_id': 'c1', 'veiculo_id': 'v1', 'km_entrada': 80000, 'total': 900, 'criado_em': '2026-11-10T10:00:00-03:00', 'recebido': 0, 'reclamacao': 'Revisão e freios', 'cliente': {'nome': 'JOÃO DA SILVA'}, 'veiculo': {'placa': 'ABC1D23', 'marca': 'Volkswagen', 'modelo': 'GOL 1.0', 'ano': '2014/2015'}}]
ITENS = [{'id': 'i1', 'ordem_id': 'o1', 'tipo': 'servico', 'descricao': 'SUBST. DE ÓLEO E FILTROS', 'aprovado': True, 'qtd': 1, 'valor_unit': 100, 'desconto': 0, 'posicao': 0},
         {'id': 'i2', 'ordem_id': 'o2', 'tipo': 'servico', 'descricao': 'REVISÃO COMPLETA', 'aprovado': True, 'qtd': 1, 'valor_unit': 300, 'desconto': 0, 'posicao': 0},
         {'id': 'i3', 'ordem_id': 'o2', 'tipo': 'servico', 'descricao': 'PASTILHAS DE FREIO DIANTEIRAS', 'aprovado': True, 'qtd': 1, 'valor_unit': 200, 'desconto': 0, 'posicao': 1}]
class Fake:
    def __init__(s, papel='admin', ativo=True): s.papel, s.ativo, s.pedidos, s.refresh, s.n = papel, ativo, [], 'r0', 0; s.gravados = []
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
            if '/rest/v1/perfis' in u:
                pf = {'id': UID, 'nome': 'Fulano de Teste', 'papel': s.papel, 'ativo': s.ativo}; return resp(route, pf if 'id=eq.' in u else [pf])
            if rq.method == 'POST' and '/rest/v1/' in u:
                corpo = json.loads(rq.post_data or '{}'); tab = u.split('/rest/v1/')[1].split('?')[0]; s.gravados.append((tab, corpo))
                if tab == 'clientes': return resp(route, {**corpo, 'id': 'c-novo'})
                if tab == 'veiculos': return resp(route, {**corpo, 'id': 'v-novo'})
                if tab == 'ordens': return resp(route, {'id': 'o-novo', 'numero': 1921})
                if tab == 'agendamentos': return resp(route, {**corpo, 'id': 'ag-novo'})
                if tab == 'rpc/orcamento_salvar': return resp(route, {'id': 'orc-novo', 'numero': 12, 'situacao': 'elaboracao', 'cliente': corpo.get('p', {}).get('cliente', {}), 'veiculo': corpo.get('p', {}).get('veiculo', {}), 'itens': []})
                return resp(route, {})
            if rq.method == 'PATCH' and '/rest/v1/' in u:
                corpo = json.loads(rq.post_data or '{}'); tab = u.split('/rest/v1/')[1].split('?')[0]; s.gravados.append((tab, corpo)); return resp(route, {**(VEI[0] if tab == 'veiculos' else {}), **corpo})
            if '/rest/v1/clientes' in u: return resp(route, CLI)
            if '/rest/v1/veiculos' in u: return resp(route, VEI)
            if '/rest/v1/produtos' in u: return resp(route, PROD)
            if '/rest/v1/ordens' in u: return resp(route, ORD)
            if '/rest/v1/os_itens' in u: return resp(route, ITENS)
            if '/rest/v1/config' in u: return resp(route, {'dados': {'validadeDias': 7, 'garantiaDias': 90}})
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
        # cada botão abre a tela do app correspondente (desenho do protótipo), sem sair do app
        TITULOS = ['ÓLEO (APLICAÇÃO)', 'NOVO ORÇAMENTO', 'NOVA O.S.', 'AGENDAR SERVIÇO', 'CONSULTAR PEÇA POR CATÁLOGO', 'HISTÓRICO DE SERVIÇOS', 'CONSULTAR O.S.']
        ROTAS = ['oleo', 'orcamento', 'os', 'agendar', 'peca', 'historico', 'osconsulta']
        for i, rota in enumerate(ROTAS):
            pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra', timeout=10000); pg.click('.barra >> nth=%d' % i); pg.wait_for_selector('.titulo b', timeout=10000)
            t(pg.url.endswith('#/' + rota) and pg.inner_text('.titulo b') == TITULOS[i], 'botão %d abre %s: %s / %s' % (i + 1, rota, pg.url, pg.inner_text('.titulo b')))
            t(pg.locator('.abas a[aria-current=page]').count() == 1 and pg.locator('.cab img').count() == 1, 'tela %s tem as abas e o cabeçalho azul' % rota)
            t(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'tela %s sem rolagem lateral' % rota)
        pg.click('.nav >> text=Ajuda'); pg.wait_for_timeout(400); t('Seu acesso' in textos(pg) and 'teste@dtcar.com' in textos(pg) and '1.2.0' in textos(pg), 'ajuda mostra o acesso e a versão')
        t(pg.locator('#bloco-digital').count() == 0, 'sem plugin o interruptor da digital não aparece')
        # recarregar mantém a sessão (sem digital)
        pg.reload(); pg.wait_for_selector('.nav', timeout=10000); pg.wait_for_timeout(300); t('AJUDA' in textos(pg), 'recarregar mantém a sessão e a rota')
        # sair
        pg.click('text=SAIR DO APP'); pg.wait_for_timeout(400); t(pg.is_visible('#f-login'), 'sair volta para a entrada')
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
        t('Este app é para o administrador e o consultor' in textos(pg) and pg.evaluate('window.__cofre') is None, 'papel mudado para mecânico é barrado na digital'); ctx.close()
        # 8) telas do protótipo com as regras do sistema (dados de mentira)
        f = Fake(); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t(pg.evaluate("getComputedStyle(document.querySelector('.barra')).backgroundColor") == 'rgb(47, 111, 181)', 'botões na cor azul da DTCar')
        t(pg.locator('.barra').first.bounding_box()['height'] >= 44, 'botão com altura de toque')
        # Início: placa do cadastro → carro aparece, sem consulta paga
        buscar_placa(pg); t('GOL 1.0' in textos(pg) and 'JOÃO DA SILVA' in textos(pg), 'placa do cadastro mostra o carro e o dono no Início')
        t(not any('/functions/v1/placa' in p[2] for p in f.pedidos), 'placa do cadastro não chama a consulta paga')
        # Óleo: litragem, viscosidade e filtros, com o estoque na frente
        tela(pg, 'oleo'); pg.wait_for_selector('#ol-oleo', timeout=20000); tx = textos(pg)
        t('Litragem' in tx and ' L' in tx and 'Viscosidade' in tx, 'óleo mostra litragem e viscosidade pela placa')
        t('Filtro de óleo' in tx and 'Em estoque' in tx and 'PSL560' in tx, 'filtro de óleo do estoque aparece em primeiro: %s' % ('PSL560' in tx))
        pg.click('text=Ocultar filtros'); pg.wait_for_timeout(200); t(pg.locator('#ol-filtros').count() == 0 and pg.is_visible('text=Ver filtros'), 'botão esconde os filtros')
        # Peça por catálogo: resultado, adicionar à lista, ver lista
        tela(pg, 'peca'); pg.wait_for_selector('.res-titulo', timeout=30000)
        t('RESULTADO DA PESQUISA' in textos(pg) and pg.locator('text=Adicionar item').count() > 0, 'peças do catálogo aparecem pela placa')
        pg.fill('#pc-q', 'amortecedor'); pg.wait_for_timeout(400); n1 = pg.locator('text=Adicionar item').count(); t(n1 > 0 and 'AMORTECEDOR' in textos(pg).upper(), 'filtro por texto funciona')
        pg.locator('text=Adicionar item').first.click(); pg.wait_for_timeout(300); t('Ver lista (1)' in textos(pg), 'adicionar item põe na lista')
        pg.click('button:has-text("Ver lista (1)")'); pg.wait_for_selector('.quadro', timeout=5000); t(pg.locator('.quadro .item-linha').count() == 1, 'quadro da lista mostra o item: %s' % pg.evaluate("document.querySelector('.quadro').innerHTML.slice(0,600)"))
        pg.click('.quadro >> text=Tirar'); pg.wait_for_timeout(200); t('Ver lista (0)' in textos(pg) or 'A lista está vazia' in textos(pg), 'tirar da lista'); pg.click('.quadro >> text=Fechar'); pg.wait_for_timeout(200)
        # Histórico: O.S. do carro, da mais nova para a mais antiga, com os serviços
        tela(pg, 'historico'); pg.wait_for_selector('text=REVISÃO COMPLETA', timeout=10000); tx = textos(pg)
        t(tx.index('10/11/2026') < tx.index('02/09/2026') and 'PASTILHAS DE FREIO DIANTEIRAS' in tx and 'SUBST. DE ÓLEO E FILTROS' in tx, 'histórico lista as O.S. com os serviços, da mais nova para a mais antiga')
        t('80.000 km' in tx and 'OS 01920' in tx, 'histórico mostra KM e número da O.S.')
        # Consultar O.S.: abertura, situação, serviços, total e link para a O.S. no modo app
        tela(pg, 'osconsulta'); tx = textos(pg)
        t('OS 01920' in tx and 'Aprovado · em execução' in tx and 'R$\xa0900,00' in tx and 'Fechada' in tx, 'consulta de O.S. mostra situação escrita e total')
        t(pg.locator('a:has-text("Abrir O.S.")').first.get_attribute('href') == '../index.html?app=1#/os/o2', 'Abrir O.S. abre a O.S. do sistema no modo app')
        t('Somente leitura' not in tx, 'administrador não vê o aviso de somente leitura')
        # + O.S.: cliente e veículo preenchidos pela placa, grava cliente/veículo/O.S. como a Nova O.S. do sistema
        tela(pg, 'os'); pg.wait_for_timeout(300)
        t(pg.input_value('#f-placa') == 'ABC1D23' and pg.input_value('#f-mm') == 'Volkswagen GOL 1.0' and pg.input_value('#f-nome') == 'JOÃO DA SILVA', 'Nova O.S. entra com o carro e o dono da placa buscada')
        pg.click('text=Abrir O.S.'); pg.wait_for_timeout(400); t('Informe o KM atual' in textos(pg) and 'Descreva o motivo' in textos(pg), 'Nova O.S. exige KM e motivo')
        pg.fill('#f-km', '81000'); pg.fill('#f-motivo', 'Barulho na suspensão'); pg.click('text=Abrir O.S.'); pg.wait_for_timeout(3000); print('DBG', [p[:2] for p in f.pedidos[-6:]], er, pg.locator('.toast').all_inner_texts(), pg.locator('.erro').all_inner_texts()); pg.wait_for_selector('.quadro', timeout=10000)
        t('OS 01921 aberta' in textos(pg), 'O.S. aberta com o número do servidor')
        o = f.tabela('ordens'); t(len(o) == 1 and o[0]['km_entrada'] == 81000 and o[0]['reclamacao'] == 'Barulho na suspensão' and o[0]['status'] == 'diagnostico' and o[0]['cliente_id'] == 'c1' and o[0]['veiculo_id'] == 'v1' and o[0]['consultor_id'] == UID, 'O.S. gravada como a Nova O.S. do sistema: %s' % (o and o[0]))
        t(f.tabela('veiculos') and f.tabela('veiculos')[0].get('km_atual') == 81000, 'KM do veículo atualizado')
        t(not f.tabela('clientes'), 'cliente do cadastro não é cadastrado de novo')
        t(pg.locator('.quadro a:has-text("Ver a O.S.")').get_attribute('href') == '../index.html?app=1#/os/o-novo', 'quadro leva à O.S. no sistema')
        pg.click('.quadro >> text=Voltar ao Início'); pg.wait_for_selector('.barra', timeout=5000)
        # + O.S. com cliente e carro novos: cadastra os dois antes da O.S.
        f.gravados.clear(); pg.evaluate("localStorage.removeItem('dtcar-app-form-os')")
        pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra'); pg.click('button[aria-label=Limpar]'); tela(pg, 'os'); pg.wait_for_timeout(300)
        pg.fill('#f-nome', 'Maria Nova'); pg.fill('#f-whats', '27988887777'); pg.fill('#f-placa', 'XYZ9A88'); pg.fill('#f-mm', 'CHEVROLET ONIX 1.0'); pg.fill('#f-ano', '2020'); pg.fill('#f-cor', 'branco'); pg.fill('#f-km', '50000'); pg.fill('#f-motivo', 'Revisão')
        pg.click('text=Abrir O.S.'); pg.wait_for_selector('.quadro', timeout=10000)
        c = f.tabela('clientes'); v = f.tabela('veiculos'); o = f.tabela('ordens')
        t(len(c) == 1 and c[0]['nome'] == 'MARIA NOVA' and c[0]['telefone'] == '27988887777' and c[0]['cidade'] == 'Colatina', 'cliente novo cadastrado em maiúsculas com Colatina/ES: %s' % (c and c[0]))
        t(len(v) == 1 and v[0]['placa'] == 'XYZ9A88' and v[0]['marca'] == 'CHEVROLET' and v[0]['modelo'] == 'ONIX 1.0' and v[0]['ano_mod'] == 2020 and v[0]['cor'] == 'BRANCO' and v[0]['cliente_id'] == 'c-novo', 'veículo novo cadastrado: %s' % (v and v[0]))
        t(len(o) == 1 and o[0]['cliente_id'] == 'c-novo' and o[0]['veiculo_id'] == 'v-novo', 'O.S. ligada ao cliente e ao veículo novos')
        pg.click('.quadro >> text=Voltar ao Início'); pg.wait_for_selector('.barra')
        # achados da revisão: trocar a placa tira o carro anterior; trocar o CPF tira nome/nascimento da consulta; KM menor pede confirmação; toque duplo não grava em dobro
        f.gravados.clear(); pg.evaluate("localStorage.removeItem('dtcar-app-form-os')"); buscar_placa(pg); tela(pg, 'os'); pg.wait_for_timeout(300)
        t(pg.input_value('#f-mm') == 'Volkswagen GOL 1.0', 'carro do Início entra no formulário')
        pg.fill('#f-placa', 'XYZ9A88'); pg.wait_for_timeout(200); t(pg.input_value('#f-mm') == '' and pg.input_value('#f-ano') == '' and pg.input_value('#f-cor') == '', 'trocar a placa tira marca, modelo, ano e cor do carro anterior')
        pg.goto(URL + '#/ajuda'); pg.wait_for_selector('.nav'); tela(pg, 'os'); pg.wait_for_timeout(300); t(pg.input_value('#f-placa') == 'XYZ9A88' and pg.input_value('#f-mm') == '', 'ir à Ajuda e voltar não devolve o carro do Início por cima do digitado')
        pg.fill('#f-placa', 'ABC1D23'); pg.locator('#f-placa').blur(); pg.wait_for_timeout(400); t(pg.input_value('#f-mm') == 'Volkswagen GOL 1.0', 'placa do cadastro preenche de novo')
        pg.fill('#f-km', '70000'); pg.fill('#f-motivo', 'Teste'); pg.click('.acao .btn-acao'); pg.wait_for_timeout(400)
        t('menor que o último registrado' in textos(pg) and not f.tabela('ordens'), 'KM menor que o registrado não abre a O.S. sem confirmar')
        pg.click('.marcar:has-text("O KM está certo")'); pg.wait_for_timeout(200); pg.click('.acao .btn-acao'); pg.wait_for_selector('.quadro', timeout=10000); t(len(f.tabela('ordens')) == 1 and f.tabela('ordens')[0]['checkin']['kmDivergente'] is True, 'com a confirmação abre e marca o KM divergente')
        pg.click('.quadro >> text=Voltar ao Início'); pg.wait_for_selector('.barra')
        # CPF consultado (administrador) → nome e nascimento; mudou um dígito → saem
        f.gravados.clear(); pg.evaluate("localStorage.removeItem('dtcar-app-form-os')"); pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra'); pg.click('button[aria-label=Limpar]'); tela(pg, 'os'); pg.wait_for_timeout(300)
        pg.route('**/functions/v1/cpf', lambda r: r.fulfill(status=200, content_type='application/json', body=json.dumps({'ok': True, 'encontrado': True, 'origem': 'api', 'dados': {'nome': 'Carlos Consultado', 'nascimento': '1980-05-10'}}), headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*'}))
        pg.fill('#f-cpf', '52998224725'); pg.click('button[aria-label="Buscar pelo CPF"]'); pg.wait_for_timeout(600); t(pg.input_value('#f-nome') == 'CARLOS CONSULTADO', 'administrador: CPF fora do cadastro preenche o nome pela consulta')
        pg.fill('#f-cpf', '52998224726'); pg.wait_for_timeout(200); t(pg.input_value('#f-nome') == '', 'trocar o CPF tira o nome que veio da consulta')
        pg.fill('#f-cpf', ''); pg.fill('#f-nome', 'Outra Pessoa'); pg.fill('#f-whats', '27977776666'); pg.fill('#f-placa', 'QQQ1A11'); pg.fill('#f-mm', 'FIAT UNO'); pg.fill('#f-ano', '2012'); pg.fill('#f-km', '10'); pg.fill('#f-motivo', 'x')
        pg.click('.acao .btn-acao'); pg.wait_for_selector('.quadro', timeout=10000); t('nascimento' not in f.tabela('clientes')[0], 'nascimento do CPF trocado não vai para o cadastro de outra pessoa: %s' % f.tabela('clientes')[0])
        pg.click('.quadro >> text=Voltar ao Início'); pg.wait_for_selector('.barra')
        # toque duplo: uma O.S. só
        f.gravados.clear(); pg.evaluate("localStorage.removeItem('dtcar-app-form-os')"); buscar_placa(pg); tela(pg, 'os'); pg.wait_for_timeout(300); pg.fill('#f-km', '90000'); pg.fill('#f-motivo', 'Dois toques')
        pg.evaluate("(() => { const b = document.querySelector('.acao .btn-acao'); b.click(); b.click(); })()"); pg.wait_for_selector('.quadro', timeout=10000); pg.wait_for_timeout(500)
        t(len(f.tabela('ordens')) == 1, 'dois toques seguidos abrem uma O.S. só: %d' % len(f.tabela('ordens')))
        pg.click('.quadro >> text=Voltar ao Início'); pg.wait_for_selector('.barra')
        # + Orçamento: cria pelo orcamento_salvar com itens vazios e manda incluir os itens no sistema
        f.gravados.clear(); buscar_placa(pg); tela(pg, 'orcamento'); pg.wait_for_timeout(300); pg.fill('#f-motivo', 'Pastilhas'); pg.click('text=Criar orçamento'); pg.wait_for_selector('.quadro', timeout=10000)
        orc = f.tabela('rpc/orcamento_salvar'); t(len(orc) == 1 and orc[0]['p']['cliente_id'] == 'c1' and orc[0]['p']['veiculo_id'] == 'v1' and orc[0]['p']['veiculo']['placa'] == 'ABC1D23' and orc[0]['p']['itens'] == [] and orc[0]['p']['situacao'] == 'elaboracao', 'orçamento criado pela mesma função do sistema: %s' % (orc and orc[0]['p']))
        t('ORC-00012 criado' in textos(pg) and pg.locator('.quadro a:has-text("Incluir os itens")').get_attribute('href') == '../index.html?app=1#/orcamento/orc-novo', 'quadro leva aos itens do orçamento')
        pg.click('.quadro >> text=Voltar ao Início'); pg.wait_for_selector('.barra')
        # Agendar: serviço, dia e horário; grava na agenda e abre a mensagem do WhatsApp pronta
        f.gravados.clear(); tela(pg, 'agendar'); pg.wait_for_timeout(300)
        t(pg.input_value('#ag-nome') == 'JOÃO DA SILVA' and pg.input_value('#ag-whats') == '(27) 99999-0000', 'agendar entra com o dono do carro')
        pg.click('.btn-chip:has-text("Freios")'); pg.click('.hora:has-text("09:30")'); dia = pg.locator('.dia:not([disabled])').last; dia.click(); pg.wait_for_timeout(200)
        t('Freios' in pg.inner_text('.acao .resumo') and '09:30' in pg.inner_text('.acao .resumo'), 'resumo mostra serviço, dia e horário')
        pg.click('text=Agendar e avisar o cliente'); pg.wait_for_selector('.quadro', timeout=10000)
        ag = f.tabela('agendamentos'); t(len(ag) == 1 and ag[0]['servico'] == 'Freios' and ag[0]['hora'] == '09:30' and ag[0]['cliente_id'] == 'c1' and ag[0]['veiculo_id'] == 'v1' and ag[0]['situacao'] == 'agendado', 'agendamento gravado: %s' % (ag and ag[0]))
        zap = pg.locator('.quadro a:has-text("WhatsApp")').get_attribute('href'); t(zap.startswith('https://wa.me/5527999990000') and 'Freios' in __import__('urllib.parse').parse.unquote(zap) and 'Mensagem%20gerada%20pelo%20sistema' in zap.replace('+', '%20'), 'mensagem do WhatsApp pronta no padrão da DTCar: %s' % zap[:80])
        t(not er, 'sem erro de script nas telas: %s' % er); ctx.close()
        # consultor: vê os valores e o aviso de somente leitura na consulta de O.S.
        f = Fake('consultor'); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg); buscar_placa(pg); tela(pg, 'osconsulta'); tx = textos(pg)
        t('R$\xa0900,00' in tx and 'Somente leitura' in tx, 'consultor vê valores e o aviso de que só o administrador altera O.S.')
        # consultor não consulta CPF fora do cadastro (regra: só o administrador)
        tela(pg, 'os'); pg.fill('#f-cpf', '52998224725'); pg.click('button[aria-label="Buscar pelo CPF"]'); pg.wait_for_timeout(400)
        t('só do administrador' in textos(pg) and not any('/functions/v1/cpf' in p[2] for p in f.pedidos), 'consultor não dispara a consulta paga de CPF'); ctx.close()
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
