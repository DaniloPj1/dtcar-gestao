# Teste do app do mecânico (pasta mecanico/), etapa 1: login real, leitura das O.S. do técnico, placa, serviços, óleo.
# O Supabase é de mentira (respostas montadas aqui). Confere também que o app NÃO grava nada no banco.
# Uso: python3 teste/teste_app_mecanico.py   (precisa de: pip install playwright && playwright install chromium)
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', raiz], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = 0
def t(c, m):
    global ok
    assert c, m; ok += 1
UID = '11111111-1111-1111-1111-111111111111'
ORDENS = [
 {'id': 'o1', 'numero': 2001, 'status': 'execucao', 'cliente': {'nome': 'Cliente Teste'}, 'veiculo': {'placa': 'abc1d23', 'marca': 'Toyota', 'modelo': 'HILUX CD4X4 SRV', 'ano': '2019', 'motor': 'Diesel'}, 'km_entrada': 84050, 'km_saida': None, 'reclamacao': 'Revisão'},
 {'id': 'o2', 'numero': 2002, 'status': 'diagnostico', 'cliente': {}, 'veiculo': {'placa': 'XYZ9A88', 'marca': 'Chevrolet', 'modelo': 'PRISMA 1.4AT LT', 'ano': '2017/2018'}, 'km_entrada': 0, 'km_saida': None, 'reclamacao': 'Barulho'}]
ITENS = [
 {'id': 'i1', 'ordem_id': 'o1', 'tipo': 'servico', 'descricao': 'SUBST. DE OLEO E FILTROS', 'qtd': 1, 'aprovado': True, 'executado': True, 'posicao': 0},
 {'id': 'i2', 'ordem_id': 'o1', 'tipo': 'servico', 'descricao': 'SUBST. PASTILHAS DIANT.', 'qtd': 1, 'aprovado': True, 'executado': False, 'posicao': 1},
 {'id': 'i3', 'ordem_id': 'o1', 'tipo': 'peca', 'descricao': 'OLEO 5W30 1L', 'qtd': 8, 'aprovado': True, 'executado': False, 'posicao': 2},
 {'id': 'i4', 'ordem_id': 'o1', 'tipo': 'servico', 'descricao': 'ITEM RECUSADO', 'qtd': 1, 'aprovado': False, 'executado': False, 'posicao': 3},
 {'id': 'i5', 'ordem_id': 'o2', 'tipo': 'servico', 'descricao': 'DIAGNOSTICO', 'qtd': 1, 'aprovado': None, 'executado': False, 'posicao': 0}]
# descrições já lançadas nas O.S. (o corretor aprende com elas)
HIST = [{'descricao': d, 'tipo': tp} for d, tp, n in [('M.O SUBST. AMORTECEDOR DIANT', 'servico', 6), ('AMORTECEDOR DIANTEIRO', 'peca', 9), ('KIT AMORT. TRASEIRO C/COXIM', 'peca', 4),
  ('SUBST. COXIM DO AMORTECEDOR DIANTEIRO', 'servico', 5), ('AMORTECEDOR TRAZEIRO', 'peca', 1), ('AMORTECEDOR TRASEIRO', 'peca', 7), ('ALINHAMENTO', 'servico', 10), ('PASTILHA DE FREIO DIANTEIRA', 'peca', 8)] for _ in range(n)]
def montar(pg, papel='admin', pedidos=None):
    def resp(route, corpo, st=200): route.fulfill(status=st, content_type='application/json', body=json.dumps(corpo), headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*'})
    def h(route):
        rq = route.request; u = rq.url
        if pedidos is not None: pedidos.append((rq.method, u.split('.co')[1].split('?')[0], u))
        if rq.method == 'OPTIONS': return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
        if '/auth/v1/token' in u:
            d = json.loads(rq.post_data or '{}')
            if d.get('password') != 'certa': return resp(route, {'error': 'invalid_grant', 'error_description': 'Invalid login credentials', 'msg': 'Invalid login credentials'}, 400)
            return resp(route, {'access_token': 'a.b.c', 'token_type': 'bearer', 'expires_in': 3600, 'expires_at': int(time.time()) + 3600, 'refresh_token': 'r', 'user': {'id': UID, 'email': d.get('email'), 'aud': 'authenticated', 'role': 'authenticated'}})
        if '/auth/v1/logout' in u: return route.fulfill(status=204, headers={'access-control-allow-origin': '*'})
        if '/rest/v1/perfis' in u: return resp(route, [{'id': UID, 'nome': 'Fulano de Teste', 'papel': papel, 'ativo': True}])
        if '/rest/v1/ordens' in u: return resp(route, ORDENS)
        if '/rest/v1/os_itens' in u: return resp(route, ITENS if 'ordem_id=' in u else ([h for h in HIST if 'tipo=eq.servico' not in u or h['tipo'] == 'servico'] if 'offset=0' in u or 'offset' not in u else []))
        if '/rest/v1/rpc/tecnicos_lista' in u: return resp(route, [{'tipo': 'acesso', 'id': UID, 'nome': 'Fulano de Teste', 'apelido': '', 'perfil_id': UID, 'funcao': 'admin'}, {'tipo': 'funcionario', 'id': 'f2', 'nome': 'Beltrano Silva', 'apelido': '', 'perfil_id': None, 'funcao': 'Mecânico'}])
        if '/rest/v1/veiculos' in u: return resp(route, [{'id': 'v9', 'placa': 'QQQ1A11', 'marca': 'Fiat', 'modelo': 'STRADA 1.4', 'ano': '2018', 'cor': 'Branca', 'combustivel': 'Flex', 'km_atual': 97310, 'cliente_id': 'c9'}] if 'QQQ1A11' in u else [])
        if '/rest/v1/clientes' in u: return resp(route, [{'nome': 'Cliente do Cadastro'}])
        if '/functions/v1/placa' in u: return resp(route, {'ok': True, 'encontrado': True, 'origem': 'api', 'valor_centavos': 3, 'dados': {'marca': 'Jeep', 'modelo': 'RENEGADE 1.8', 'ano_fab': 2020, 'ano_mod': 2021, 'cor': 'Prata', 'combustivel': 'Flex'}})
        return resp(route, [], 200)
    pg.route('**/*.supabase.co/**', h)
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); pg = ctx.new_page(); pedidos = []
        # ditado e microfone de mentira: "ouve" a palavra bieleta enquanto o botão está apertado
        pg.add_init_script("""window.SpeechRecognition = class { start() { window.__ouvindo = (window.__ouvindo || 0) + 1; this._t = setTimeout(() => this.onresult && this.onresult({ results: [[{ transcript: 'bieleta' }]] }), 60); }
          stop() { clearTimeout(this._t); setTimeout(() => this.onend && this.onend(), 10); } };
          Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia: async () => ({ getTracks: () => [] }) }, configurable: true });""")
        erros = []; pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and erros.append(m.text))
        montar(pg, pedidos=pedidos)
        pg.goto('http://localhost:8765/mecanico/'); pg.wait_for_selector('#lg-senha')
        t(pg.locator('video').count() == 1, 'vídeo no login'); t(pg.locator('#lg-email').count() == 1, 'primeira vez pede o e-mail')
        pg.get_by_role('button', name='ENTRAR').click(); t(pg.get_by_text('Digite o seu e-mail.').count() == 1, 'pede o e-mail')
        pg.fill('#lg-email', 'teste@exemplo.com'); pg.fill('#lg-senha', 'errada'); pg.get_by_role('button', name='ENTRAR').click()
        pg.get_by_text('E-mail ou senha incorretos.').wait_for(); t(True, 'senha errada não entra')
        pg.evaluate("window.__v0 = document.querySelector('video')"); pg.fill('#lg-senha', 'certa')
        t(pg.evaluate("document.querySelector('video') === window.__v0"), 'vídeo não reinicia ao digitar')
        pg.get_by_role('button', name='ENTRAR').click(); pg.get_by_text('O.S. 2001').wait_for()
        t(pg.get_by_text('Fulano · teste: nada é salvo').count() == 1, 'nome do usuário e aviso de teste')
        t(pg.get_by_text('ABC1D23').count() == 1 and pg.get_by_text('Toyota HILUX CD4X4 SRV 2019').count() == 1, 'O.S. real na lista')
        t(pg.get_by_text('1 de 2 serviços').count() == 1, 'conta só serviços aprovados (sem peça, sem recusado)')
        t(pg.get_by_text('Orçamento enviado').count() == 1, 'O.S. em orçamento aparece como orçamento')
        u_ord = [x[2] for x in pedidos if x[1] == '/rest/v1/ordens'][0]
        t('mecanico_id=eq.' + UID in u_ord, 'só as O.S. em que o usuário é o técnico'); t('total' not in u_ord and not [x for x in pedidos if x[1] == '/rest/v1/os_itens' and ('valor' in x[2] or 'custo' in x[2])], 'não lê preços')
        # detalhe
        pg.get_by_text('ABC1D23').click(); t(pg.get_by_text('SUBST. DE OLEO E FILTROS').count() == 1 and pg.get_by_text('ITEM RECUSADO').count() == 0, 'serviços da O.S.')
        t(pg.get_by_text('Executado (marcado no sistema)').count() == 1, 'executado no sistema'); t(pg.get_by_text('Adm inclui um item').count() == 0, 'sem simulação em O.S. real')
        pg.get_by_role('button', name='Ver peças da O.S. (1)').click(); t(pg.get_by_text('OLEO 5W30 1L · 8').count() == 1, 'peças da O.S.')
        embaixo = lambda nm: pg.evaluate("(n) => { const b = [...document.querySelectorAll('button')].find(x => x.textContent.trim().startsWith(n)); const r = b.getBoundingClientRect(); return [r.bottom, r.height]; }", nm)
        t(780 < embaixo('Iniciar serviço')[0] <= 844, 'Iniciar serviço fica na parte inferior' + str(embaixo('Iniciar serviço')))
        pg.get_by_role('button', name='Iniciar serviço').click(); pg.get_by_role('button', name='Marcar como feito por mim: SUBST. PASTILHAS DIANT.').click()
        t(pg.get_by_text('Feito por você').count() == 1, 'apontamento na tela')
        pg.get_by_role('button', name='Finalizar').click(); pg.fill('#km-final', '100'); pg.get_by_role('button', name='Confirmar e finalizar').click(); t(pg.get_by_text('não pode ser menor').count() == 1, 'KM final menor é recusado')
        pg.fill('#km-final', '84100'); pg.get_by_role('button', name='Confirmar e finalizar').click(); t(pg.get_by_text('Serviço finalizado · KM final 84.100').count() == 1, 'finaliza com KM')
        pg.get_by_role('button', name='Voltar para meus veículos').click()
        # receber veículo: cadastro e consulta
        pg.get_by_role('button', name='Receber veículo e fazer orçamento').click(); t(780 < embaixo('Buscar veículo')[0] <= 844, 'Buscar veículo fica na parte inferior' + str(embaixo('Buscar veículo'))); pg.fill('#nv-placa', 'qqq1a11'); pg.get_by_role('button', name='Buscar veículo').click()
        pg.get_by_text('Encontrado no cadastro da oficina').wait_for(); t(pg.get_by_text('Cliente do Cadastro').count() == 1 and pg.get_by_text('Fiat STRADA 1.4 2018').count() == 1, 'placa do cadastro')
        t(not [x for x in pedidos if x[1] == '/functions/v1/placa'], 'placa do cadastro não gasta consulta')
        pg.get_by_role('button', name='Voltar', exact=True).click(); pg.fill('#nv-placa', 'NOV4A00'); pg.get_by_role('button', name='Buscar veículo').click()
        pg.get_by_text('Placa nova · dados da consulta pela placa').wait_for(); t(pg.get_by_text('Jeep RENEGADE 1.8 2020/2021').count() == 1, 'placa nova pela consulta')
        pg.fill('#nv-cliente', 'Zé'); pg.fill('#nv-km', '5000'); t(780 < embaixo('Continuar para os itens')[0] <= 844, 'Continuar fica na parte inferior' + str(embaixo('Continuar para os itens'))); pg.get_by_role('button', name='Continuar para os itens').click()
        # nova tela: peças por sistema
        pg.get_by_role('button', name='Adicionar', exact=True).wait_for(); t(pg.get_by_text('Lista: 0').count() == 1, 'contador da lista começa em 0')
        pg.get_by_role('button', name='Adicionar', exact=True).click(); pg.get_by_text('Marque uma ou mais peças.').wait_for(); t(True, 'sem marcar nada não adiciona')
        pg.get_by_role('button', name='Pastilha de freio').click(); pg.get_by_role('button', name='Adicionar (1)').click(); pg.get_by_text('Escolha a posição de Pastilha de freio.').wait_for(); t(True, 'pastilha pede a posição')
        pg.get_by_role('button', name='Diant.', exact=True).click(); pg.get_by_role('button', name='Susp. dianteira').click()
        pg.get_by_role('button', name='Bandeja / balança', exact=True).click(); pg.get_by_role('button', name='Bieleta', exact=True).click(); pg.get_by_role('button', name='Bieleta, 2 unidades').click()
        pg.get_by_role('button', name='Adicionar (3)').click(); pg.get_by_text('3 itens na lista.').wait_for(); t(pg.get_by_text('Lista: 3').count() == 1, 'três itens na lista')
        pg.get_by_role('button', name='Avançar: ver a lista (3)').click(); t(pg.get_by_text('+ Adicionar mais itens').count() == 1, 'avançar leva à lista')
        nomes = lambda: pg.evaluate("[...document.querySelectorAll('div')].filter(d => d.style.fontSize === '16px' && d.style.fontWeight === '700' && d.style.lineHeight === '20px').map(d => d.textContent)")
        n0 = nomes(); t('SUBST. PASTILHA DE FREIO DIANTEIRA' in n0, 'pastilha com posição: ' + str(n0)); t('SUBST. BIELETA (2 UN)' in n0, 'bieleta com 2: ' + str(n0)); t('SUBST. BANDEJA / BALANÇA' in n0, 'bandeja: ' + str(n0))
        t(780 < embaixo('Concluir (teste')[0] <= 844, 'Concluir fica na parte inferior' + str(embaixo('Concluir (teste'))); pg.get_by_role('button', name='Concluir (teste: não salva)').click()
        t(pg.get_by_text('Teste: o orçamento NÃO foi salvo no sistema.').count() == 1, 'orçamento não é salvo')
        # óleo pelo catálogo real
        pg.get_by_role('button', name='Óleo', exact=True).click(); pg.get_by_text('7,9 L').wait_for(timeout=20000); t(pg.get_by_text('ABC1D23').count() == 1, 'óleo do veículo da O.S. pelo catálogo')
        pg.fill('#busca-oleo', 'onix 1.0'); pg.get_by_text('3,75 L').first.wait_for(); t(pg.evaluate("document.activeElement.id") == 'busca-oleo', 'busca de óleo mantém o cursor')
        antes = len([x for x in pedidos if x[1] == '/functions/v1/placa'])
        pg.fill('#busca-oleo', 'qqq-1a11'); pg.get_by_text('Fiat STRADA 1.4 2018').wait_for(); t(pg.get_by_text('QQQ1A11').count() == 1, 'óleo pela placa do cadastro')
        t(len([x for x in pedidos if x[1] == '/functions/v1/placa']) == antes, 'placa do cadastro não gasta consulta no óleo')
        pg.fill('#busca-oleo', 'nov4a00'); pg.get_by_text('Jeep RENEGADE 1.8 2020/2021').wait_for(); t(len([x for x in pedidos if x[1] == '/functions/v1/placa']) == antes + 1, 'placa nova no óleo consulta uma vez')
        pg.fill('#busca-oleo', 'nov4a0'); pg.fill('#busca-oleo', 'nov4a00'); pg.get_by_text('Jeep RENEGADE 1.8 2020/2021').wait_for(); t(len([x for x in pedidos if x[1] == '/functions/v1/placa']) == antes + 1, 'a mesma placa não é consultada de novo')
        # nada gravado no banco
        grav = [x for x in pedidos if x[0] not in ('GET', 'OPTIONS') and '/auth/' not in x[1] and x[1] not in ('/rest/v1/rpc/tecnicos_lista', '/functions/v1/placa')]
        t(not grav, 'o app não grava nada no banco: ' + str(grav))
        # login guardado em separado do sistema
        t(pg.evaluate("!!localStorage.getItem('dtcar-mecanico-auth') && !Object.keys(localStorage).some(k => /^sb-.*-auth-token$/.test(k))"), 'login separado do sistema principal')
        pg.get_by_role('button', name='Veículos', exact=True).click(); pg.get_by_role('button', name='Sair').click(); pg.wait_for_selector('#lg-senha')
        t(pg.get_by_text('Olá, Fulano').count() == 1 and pg.locator('#lg-email').count() == 0, 'login salvo: pede só a senha')
        t(pg.evaluate("[window.__dtcarHorario(new Date('2026-11-16T10:00:00-03:00')), window.__dtcarHorario(new Date('2026-11-16T18:00:00-03:00')), window.__dtcarHorario(new Date('2026-11-16T06:59:00-03:00')), window.__dtcarHorario(new Date('2026-11-14T17:59:00-03:00')), window.__dtcarHorario(new Date('2026-11-15T10:00:00-03:00'))].join()") == 'true,false,false,true,false', 'horário: seg a sáb, 7h às 18h')
        t(not erros, 'sem erro no console: ' + '; '.join(erros))
        # quem não é administrador não entra
        ctx2 = b.new_context(viewport={'width': 390, 'height': 844}, service_workers='block'); pg2 = ctx2.new_page(); montar(pg2, papel='mecanico')
        pg2.goto('http://localhost:8765/mecanico/'); pg2.fill('#lg-email', 'm@exemplo.com'); pg2.fill('#lg-senha', 'certa'); pg2.get_by_role('button', name='ENTRAR').click()
        pg2.get_by_text('liberado só para o administrador').wait_for(); t(pg2.locator('#lg-senha').count() == 1, 'outro papel fica no login')
        b.close()
    print(ok, 'verificações OK')
finally:
    srv.terminate()
