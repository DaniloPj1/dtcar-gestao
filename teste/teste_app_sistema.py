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
ROTULOS = ['ÓLEO (APLICAÇÃO)', 'ORÇAMENTOS', 'AGENDAR', 'CONSULTAR PEÇA POR CATÁLOGO', 'HISTÓRICO DE SERVIÇOS', 'CONSULTAR O.S.']
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
    def __init__(s, papel='admin', ativo=True, acessos=None): s.papel, s.ativo, s.pedidos, s.refresh, s.n = papel, ativo, [], 'r0', 0; s.gravados = []; s.acessos = acessos; s.eventos = []; s.orcs = json.loads(json.dumps(ORCS)); s.funcao_pedido = []
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
            if '/rest/v1/agendamentos' in u and rq.method == 'GET': return resp(route, [{'id': 'ag1', 'data': HOJE, 'hora': '08:00', 'situacao': 'agendado'}, {'id': 'ag2', 'data': HOJE, 'hora': '09:00', 'situacao': 'cancelado'}])
            if '/rest/v1/perfis' in u:
                pf = {'id': UID, 'nome': 'Fulano de Teste', 'papel': s.papel, 'ativo': s.ativo}; return resp(route, pf if 'id=eq.' in u else [pf])
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
        barras = rotulos(pg); t(barras == ROTULOS, 'seis botões na ordem do protótipo, sem + O.S.: %s' % barras)
        t(pg.locator('.quadro').count() == 0, 'sem plugin não oferece a digital')
        t(not f.escritas(), 'não grava nada no banco: %s' % f.escritas())
        # cada botão abre a tela real do sistema, no modo app (?app=1), levando a marca de modo app
        # cada botão abre a tela do app correspondente (desenho do protótipo), sem sair do app
        TITULOS = ['ÓLEO (APLICAÇÃO)', 'ORÇAMENTOS', 'AGENDAR SERVIÇO', 'CONSULTAR PEÇA POR CATÁLOGO', 'HISTÓRICO DE SERVIÇOS', 'CONSULTAR O.S.']
        ROTAS = ['oleo', 'orcamento', 'agendar', 'peca', 'historico', 'osconsulta']
        for i, rota in enumerate(ROTAS):
            pg.goto(URL + '#/inicio'); pg.wait_for_selector('.barra', timeout=10000); pg.click('.barra >> nth=%d' % i); pg.wait_for_selector('.titulo b', timeout=10000)
            t(pg.url.endswith('#/' + rota) and pg.inner_text('.titulo b') == TITULOS[i], 'botão %d abre %s: %s / %s' % (i + 1, rota, pg.url, pg.inner_text('.titulo b')))
            t(pg.locator('.abas a[aria-current=page]').count() == 1 and pg.locator('.cab img').count() == 1, 'tela %s tem as abas e o cabeçalho azul' % rota)
            t(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'tela %s sem rolagem lateral' % rota)
            t(pg.evaluate("getComputedStyle(document.querySelector('.rodape')).position") == 'fixed' and pg.evaluate("getComputedStyle(document.querySelector('.rodape')).borderTopColor") == 'rgb(47, 111, 181)', 'tela %s: rodapé fixo com a linha azul' % rota)
            t(pg.locator('#os').count() == 0 and '+ O.S.' not in pg.locator('.abas').inner_text(), 'tela %s sem a aba + O.S.' % rota)
        pg.click('.nav >> text=Ajuda'); pg.wait_for_timeout(400); t('Seu acesso' in textos(pg) and 'teste@dtcar.com' in textos(pg) and '1.4.0' in textos(pg), 'ajuda mostra o acesso e a versão')
        t(pg.locator('#bloco-digital').count() == 0, 'sem plugin o interruptor da digital não aparece')
        # recarregar mantém a sessão (sem digital)
        pg.reload(); pg.wait_for_selector('.nav', timeout=10000); pg.wait_for_timeout(300); t('AJUDA' in textos(pg), 'recarregar mantém a sessão e a rota')
        # sair
        pg.click('text=SAIR DO APP'); pg.wait_for_timeout(400); t(pg.is_visible('#f-login'), 'sair volta para a entrada')
        pg.reload(); pg.wait_for_timeout(500); t(pg.is_visible('#f-login'), 'depois de sair, recarregar pede a senha')
        t(not er, 'sem erro de script: %s' % er); ctx.close()
        # 3) consultor entra; mecânico, pendente e inativo não
        f = Fake('consultor'); ctx, pg, er = abrir(br, f, URL, plugin=False); entrar(pg)
        t('Consultor' in textos(pg) and pg.locator('.barra').count() == 6, 'consultor entra'); ctx.close()
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
        t('ORC-00005' in tx and 'Barulho na suspensão' in tx and 'Enviado ao cliente' in tx and 'ORC-00006' not in tx.split('Orçamentos abertos')[1], 'lista só os orçamentos abertos, com o pedido escrito')
        t(pg.locator('.bolinha').count() >= 1 and pg.locator('.abas .bolinha').inner_text() == '1', 'a aba Orçamentos mostra 1 aviso')
        pg.click('button[data-visto="orc2"]'); pg.wait_for_timeout(500); t('ORC-00006 aprovado' not in textos(pg) and pg.locator('.bolinha').count() == 0, 'OK no aviso tira o aviso (fica guardado no aparelho)')
        # função ainda não publicada no Supabase (404 sem CORS): a mensagem diz a causa certa, não "sem internet" (bug visto pelo Danilo em 16/11 às 21h)
        f.sem_funcao = True; pg.click('button[data-acrescentar="orc1"]'); pg.fill('#ac-area', 'Palhetas'); pg.click('#ac-gravar'); pg.wait_for_timeout(1500)
        t('falta publicar a função "pedido"' in textos(pg) and 'Confira a internet' not in textos(pg), 'função não publicada: avisa que falta publicar, não culpa a internet: %s' % textos(pg)[-300:])
        f.sem_funcao = False; pg.click('#ac-gravar'); pg.wait_for_timeout(800)
        t(f.funcao_pedido[-1] == {'acao': 'acrescentar', 'id': 'orc1', 'texto': 'Palhetas'} and '— Fulano de Teste, 16/11/2026 15:31: Palhetas' in textos(pg), 'acrescentar manda o texto para a função pedido e mostra a linha no pedido')
        pg.click('#orc-novo'); pg.wait_for_selector('#pd-area'); pg.click('#pd-enviar'); pg.wait_for_timeout(300); t('Busque a placa ou informe o nome' in textos(pg), 'pedido novo exige placa ou cliente')
        pg.wait_for_timeout(600); pg.fill('#pd-placa', 'abc1d23'); pg.keyboard.press('Enter'); pg.wait_for_selector('#veic', timeout=5000); t('JOÃO DA SILVA' in textos(pg) and pg.locator('#pd-nome').count() == 0, 'placa do cadastro traz carro e dono; não pede o nome')
        pg.click('#pd-enviar'); pg.wait_for_timeout(300); t('Escreva o que é para orçar' in textos(pg), 'pedido novo exige o texto')
        pg.fill('#pd-area', 'Pastilhas e discos dianteiros'); pg.evaluate("(() => { const b = document.querySelector('#pd-enviar'); b.click(); b.click(); })()"); pg.wait_for_selector('.quadro', timeout=10000); pg.wait_for_timeout(400)
        novos = [d for d in f.funcao_pedido if d['acao'] == 'novo']
        t(len(novos) == 1 and novos[0]['texto'] == 'Pastilhas e discos dianteiros' and novos[0]['placa'] == 'ABC1D23' and novos[0]['veiculo_id'] == 'v1' and novos[0]['cliente_id'] == 'c1' and novos[0]['cliente']['nome'] == 'JOÃO DA SILVA' and 'itens' not in novos[0] and not f.tabela('rpc/orcamento_salvar'), 'pedido vai pela função pedido (sem item, sem preço, sem orcamento_salvar; dois toques = um pedido): %s' % novos)
        t('ORC-00012 enviado' in textos(pg) and pg.locator('a[href*="index.html"]').count() == 0, 'quadro confirma o envio sem levar ao sistema')
        pg.click('#pd-entendi'); pg.wait_for_timeout(400); t('ORC-00012' in textos(pg) and 'Pastilhas e discos dianteiros' in textos(pg), 'o pedido novo aparece em Orçamentos abertos')
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
        t(pg.locator('.cal-dia[aria-pressed=true] i').inner_text() == '1', 'o dia mostra quantos serviços já tem (cancelado não conta)')
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
        tela(pg, 'orcamento'); t(pg.locator('#orc-novo').count() == 1 and 'R$' not in textos(pg), 'mecânico liberado pede orçamento, sem preço'); ctx.close()
        del ORD[1]['mecanico_id']; del ORD[1]['mecanico_nome']
        # 9) a tela "Sem internet" que vai dentro do APK (app/www): abre sozinha, com a logo, e tem o botão de tentar de novo
        f = Fake(); ctx, pg, er = abrir(br, f, 'http://localhost:8766/app/www/index.html', plugin=False)
        t('Sem internet' in textos(pg) and pg.is_visible('text=Tentar de novo'), 'app/www mostra a tela Sem internet')
        t(pg.evaluate("document.querySelector('img').naturalWidth") > 0, 'logo carrega em app/www')
        t(sorted(os.listdir(os.path.join(raiz, 'app', 'www'))) == ['icons', 'index.html'], 'app/www leva só a tela offline e a logo'); ctx.close()
        # 10) configuração do Capacitor: abre o app direto do site
        cfg = json.load(open(os.path.join(raiz, 'app', 'capacitor.config.json')))
        t(cfg['server']['url'] == 'https://gestao.dtcarcentroautomotivo.com.br/app/' and cfg['server']['errorPath'] == 'index.html', 'Capacitor abre o app do site e usa a tela offline em caso de erro')
        pk = json.load(open(os.path.join(raiz, 'app', 'package.json'))); t('@capacitor/app' in pk['dependencies'] and pk['version'] == '1.4.0', 'plugin App (botão Voltar) no APK e versão 1.4.0')
        br.close()
    print('OK: %d conferências' % ok)
finally:
    srv.terminate()
