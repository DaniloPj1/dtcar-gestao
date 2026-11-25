# Teste do DTCar Scanner (pasta scanner/, o app de OBD do tablet): a placa como porta de entrada,
# os cards do Início, o sinal verde de conectado, os dados ao vivo com combustível e falha por
# cilindro juntos, o chassi e os monitores no quadro do carro, os gráficos com Exibir/Voltar, as
# falhas com o botão de apagar na própria tela, o mapa da rede CAN e as programações avançadas.
#
# O adaptador ELM327 é de mentira: o MESMO de teste/teste_app_sistema.py, lido de lá para não haver
# duas cópias que possam divergir. O Supabase não é usado (o Scanner não tem login).
# Uso: python3 teste/teste_scanner.py   (precisa de: pip install playwright && playwright install chromium)
import re, sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright

raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
subprocess.run([sys.executable, os.path.join(raiz, 'scanner', 'montar_www.py')], check=True, stdout=subprocess.DEVNULL)

# o adaptador de mentira sai do teste do app do sistema: uma fonte só
_fonte = open(os.path.join(raiz, 'teste', 'teste_app_sistema.py'), encoding='utf-8').read()
_bloco = re.search(r'^FAKE_OBD = """(.*?)^"""([^\n]*)', _fonte, re.S | re.M)
FAKE_OBD = _bloco.group(1)
# o bloco de lá termina com .replace('__VIN__', '...'): aplica os mesmos aqui, senão o adaptador de
# mentira devolve o nome do espaço reservado em vez do chassi
for _de, _para in re.findall(r"\.replace\('([^']+)', '([^']*)'\)", _bloco.group(2)):
    FAKE_OBD = FAKE_OBD.replace(_de, _para)
assert 'DtcarObd' in FAKE_OBD and '__VIN__' not in FAKE_OBD, 'nao achei o adaptador de mentira em teste_app_sistema.py'

# O Scanner não tem login e carrega o js/api.js. NADA no teste pode falar com o Supabase de
# verdade: toda chamada ao supabase.co é cortada aqui. É o mesmo que acontece no pátio sem
# internet — a consulta da placa falha e a tela segue pelo VIN lido do próprio carro.
SUPABASE = '**supabase.co/**'

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8771', '-d', raiz], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
ok = 0
def t(c, m):
    global ok
    assert c, m
    ok += 1

TABLET = {'width': 1280, 'height': 800}
BASE = 'http://localhost:8771/scanner/'

try:
    with sync_playwright() as p:
        nav = p.chromium.launch()
        ctx = nav.new_context(viewport=TABLET)
        erros = []
        pg = ctx.new_page()
        pg.route(SUPABASE, lambda r: r.abort())
        pg.on('pageerror', lambda e: erros.append(str(e)))
        # erro de rede do Supabase cortado acima é esperado: não conta (vem sem texto, só com a URL)
        def _console(m):
            if m.type != 'error':
                return
            onde = ((m.location or {}).get('url') or '') + ' ' + m.text
            if 'favicon' in onde or 'supabase' in onde.lower():
                return
            erros.append(m.text + ' @ ' + onde.strip())
        pg.on('console', _console)
        pg.add_init_script(FAKE_OBD)
        pg.goto(BASE)
        pg.wait_for_selector('#pl', timeout=15000)

        # ---------- 1) a placa é a primeira coisa que o app pede ----------
        t(pg.is_visible('#pl'), 'o app abre pedindo a placa do carro')
        t(not pg.is_visible('.rail'), 'na tela da placa não há menu lateral')
        t(pg.is_disabled('#sc-entrar'), 'sem placa válida, não dá para entrar')
        pg.fill('#pl', 'abc1d23')
        t(pg.input_value('#pl') == 'ABC1D23', 'a placa digitada vira maiúscula sozinha')
        t(not pg.is_disabled('#sc-entrar'), 'com placa válida o botão libera')
        t(pg.eval_on_selector('#pl', 'e => getComputedStyle(e).height') == '72px',
          'o campo da placa é alto (dedo de mecânico, sem teclado virtual próprio)')
        pg.click('#sc-entrar')
        pg.wait_for_selector('.cards', timeout=10000)

        # ---------- 2) o Início são cards de ícone, sem menu lateral ----------
        t(not pg.is_visible('.rail'), 'no Início não há menu lateral: são cards')
        t(pg.eval_on_selector('.cards', 'e => getComputedStyle(e).gridTemplateColumns').count(' ') == 4,
          'deitado, as cinco funções cabem numa linha só')
        cards = pg.eval_on_selector_all('.cards .card b', 'es => es.map(e => e.textContent.trim())')
        t(cards == ['Ao vivo', 'Gráficos', 'Falhas', 'Rede CAN', 'Programações'],
          'os cinco cards do Início, na ordem: ' + str(cards))
        t(pg.eval_on_selector('.card', 'e => getComputedStyle(e).backgroundColor') == 'rgb(47, 111, 181)',
          'os cards são azuis da marca')
        t(pg.eval_on_selector('.card svg', 'e => e.getAttribute("width")') == '54',
          'o ícone dentro do card é grande (54 px)')
        t(pg.eval_on_selector('.card svg', 'e => getComputedStyle(e).stroke') == 'rgb(255, 255, 255)',
          'o ícone do card é branco')
        t(pg.eval_on_selector('#sc-card-prog', 'e => getComputedStyle(e).backgroundColor') == 'rgb(23, 79, 148)',
          'o card que escreve no carro tem o azul forte, diferente dos outros')
        t('ESCREVE NO CARRO' in pg.inner_text('#sc-card-prog'), 'o card das programações avisa que escreve no carro')
        t(pg.is_visible('.placa-id') and 'ABC1D23' in pg.inner_text('.placa-id'),
          'a placa fica à vista, no formato Mercosul')

        # ---------- 3) o sinal de conectado ----------
        t('SEM ADAPTADOR' in pg.inner_text('#sc-sinal'), 'sem adaptador, o sinal diz isso por escrito')
        t(pg.eval_on_selector('#sc-sinal', 'e => e.className').find('off') >= 0, 'o sinal começa apagado')
        pg.click('#sc-conectar')
        pg.wait_for_function("document.querySelector('#sc-sinal') && /CONECTADO/.test(document.querySelector('#sc-sinal').textContent)", timeout=15000)
        t('CONECTADO' in pg.inner_text('#sc-sinal'), 'conectado: o sinal diz CONECTADO')
        t(pg.eval_on_selector('#sc-sinal i', 'e => getComputedStyle(e).backgroundColor') == 'rgb(31, 122, 58)',
          'o sinal de conectado é verde')

        # ---------- 4) chassi e monitores JUNTO dos dados do carro ----------
        t(pg.is_visible('#sc-ler-chassi'), 'o quadro do carro tem o botão de ler chassi e monitores')
        pg.click('#sc-ler-chassi')
        pg.wait_for_function("document.querySelector('#sc-carro') && /MONITORES DE EMISSÃO/.test(document.querySelector('#sc-carro').textContent)", timeout=20000)
        carro = pg.inner_text('#sc-carro')
        t('MONITORES DE EMISSÃO' in carro, 'os monitores aparecem no mesmo quadro do carro')
        t('Chassi lido do carro' in carro, 'o chassi lido fica junto dos dados do carro')
        t(re.search(r'[A-HJ-NPR-Z0-9]{17}', carro) is not None, 'o chassi de 17 dígitos foi lido e mostrado')
        t('Luz de injeção' in carro, 'o quadro diz se a luz de injeção está acesa')
        t(pg.is_visible('#sc-confere-chassi'), 'a conferência da placa com o chassi aparece')
        t('PRONTO' in carro or 'NÃO PRONTO' in carro, 'cada monitor diz por escrito se está pronto')

        # ---------- 5) dados ao vivo: combustível e falha por cilindro juntos ----------
        pg.click('#sc-card-aovivo')
        pg.wait_for_selector('#sc-vivo', timeout=10000)
        t(pg.is_visible('.rail'), 'dentro de uma leitura o menu lateral aparece')
        t(pg.eval_on_selector('.rail', 'e => getComputedStyle(e).backgroundColor') == 'rgb(23, 79, 148)',
          'a barra lateral usa o azul que o Danilo escolheu')
        t(pg.eval_on_selector('.rail a[aria-current="page"]', 'e => getComputedStyle(e).backgroundColor') == 'rgb(255, 255, 255)',
          'o item do menu em que se está fica branco')
        pg.click('#sc-vivo')
        pg.wait_for_selector('.vivos .vv', timeout=25000)
        pg.wait_for_function("document.querySelectorAll('.vivos .vv').length >= 6", timeout=30000)
        rotulos = pg.eval_on_selector_all('.vivos .vv .rot', 'es => es.map(e => e.textContent.trim())')
        t(len(rotulos) >= 6, 'os mostradores ao vivo aparecem: ' + str(len(rotulos)))
        t(any('otação' in r for r in rotulos), 'a rotação está entre os mostradores')
        t(any('combustível' in r.lower() for r in rotulos),
          'o COMBUSTÍVEL vem nas leituras ao vivo por padrão (não é mais botão separado): ' + str(rotulos))
        t(not pg.query_selector('#obd-combustivel'), 'não existe mais um botão só de combustível')
        pg.wait_for_function("/COMBUSTÍVEL/.test(document.body.textContent)", timeout=20000)
        t('COMBUSTÍVEL' in pg.inner_text('.rolo'), 'a análise do ajuste de combustível fica embaixo dos mostradores')
        # a falha por cilindro entra sozinha, pela própria roda do ao vivo
        pg.wait_for_function("/FALHA POR CILINDRO/.test(document.body.textContent)", timeout=90000)
        t('FALHA POR CILINDRO' in pg.inner_text('.rolo'), 'a falha por cilindro aparece ao vivo, sem botão')
        t(pg.query_selector('[data-cilindro="1"]') is not None, 'a contagem sai cilindro por cilindro')
        t(pg.is_visible('#sc-parar'), 'com a leitura rodando há como parar')
        pg.click('#sc-parar')

        # ---------- 6) gráficos: escolher, EXIBIR, VOLTAR, até 4 ----------
        pg.click('.rail a[href="#/graficos"]')
        pg.wait_for_selector('#sc-gra-exibir', timeout=10000)
        t(pg.is_disabled('#sc-gra-exibir'), 'sem escolher nada, não há o que exibir')
        t('até 4 gráficos' in pg.inner_text('.ct h2'), 'a tela diz que cabem até 4 gráficos')
        marcas = pg.query_selector_all('.lista .item button[id^="sc-gra-p"]')
        t(len(marcas) >= 4, 'a lista de escolha traz as leituras deste carro: ' + str(len(marcas)))
        for b in marcas[:4]:
            b.click()
        t('(4)' in pg.inner_text('#sc-gra-exibir'), 'quatro leituras marcadas')
        pg.click('#sc-gra-exibir')
        pg.wait_for_selector('.gras .gra svg', timeout=30000)
        t(pg.is_visible('#sc-gra-voltar'), 'exibindo os gráficos, aparece o VOLTAR')
        t(not pg.query_selector('#sc-gra-exibir'), 'o EXIBIR sai de cena enquanto os gráficos estão abertos')
        qtd = len(pg.query_selector_all('.gras .gra'))
        t(1 <= qtd <= 4, 'no máximo 4 gráficos na tela: ' + str(qtd))
        t(pg.eval_on_selector('.gra .leg b', 'e => e.textContent').find(':') > 0,
          'cada linha do gráfico tem o valor escrito na legenda')
        pg.click('#sc-gra-voltar')
        pg.wait_for_selector('#sc-gra-exibir', timeout=10000)
        t(pg.is_visible('#sc-gra-exibir'), 'o VOLTAR traz de volta as opções de escolha')

        # ---------- 7) falhas: apagar na própria tela, e o que foi apagado some ----------
        pg.click('.rail a[href="#/falhas"]')
        pg.wait_for_selector('#sc-ler-falhas', timeout=10000)
        pg.click('#sc-ler-falhas')
        pg.wait_for_selector('.dtc .cod', timeout=30000)
        antes = pg.eval_on_selector_all('.dtc .cod', 'es => es.map(e => e.textContent.trim())')
        t(len(antes) > 0, 'as falhas do carro aparecem: ' + str(antes))
        t(pg.is_visible('#sc-abrir-apagar'), 'o botão de apagar está na MESMA tela da leitura')
        pg.click('#sc-abrir-apagar')
        pg.wait_for_selector('#sc-apagar-agora', timeout=10000)
        t(pg.is_visible('#sc-km'), 'antes de apagar, o app pede o KM do painel')
        pg.fill('#sc-km', '226220')
        pg.click('#sc-apagar-agora')
        pg.wait_for_function("/APAGADO/.test(document.body.textContent)", timeout=40000)
        depois = pg.eval_on_selector_all('.dtc .cod', 'es => es.map(e => e.textContent.trim())')
        t(len(depois) < len(antes), 'o que foi apagado SOME da lista: ' + str(antes) + ' -> ' + str(depois))
        t('JÁ FOI APAGADO NESTE CARRO' in pg.inner_text('.rolo'), 'fica registrado o que foi apagado, com o KM')

        # ---------- 8) mapa da rede CAN ----------
        pg.click('.rail a[href="#/rede"]')
        pg.wait_for_selector('#sc-varrer', timeout=10000)
        pg.click('#sc-varrer')
        pg.wait_for_selector('#sc-veredito', timeout=90000)
        ver = pg.inner_text('#sc-veredito')
        t('O QUE DÁ PARA AFIRMAR' in ver, 'a rede abre pelo veredito, não pela lista crua')
        t(any(x in ver for x in ['CONFIRMADO', 'CONTRADIÇÃO', 'SÓ INDÍCIO', 'REDE EM ORDEM']),
          'o veredito diz o grau de certeza por escrito: ' + ver[:60])
        t(pg.is_visible('#sc-modulos'), 'a lista de módulos aparece num quadro largo')
        sits = pg.eval_on_selector_all('#sc-modulos .mod .selo', 'es => es.map(e => e.textContent.trim())')
        t(len(sits) > 0 and all(s in ['RESPONDEU', 'RECUSOU', 'MUDO', 'FORA DA REDE'] for s in sits),
          'cada módulo diz por escrito o que aconteceu: ' + str(set(sits)))
        t(pg.eval_on_selector('#sc-modulos .par', 'e => getComputedStyle(e).gridTemplateColumns').count(' ') == 1,
          'a lista de módulos fica em duas colunas no quadro largo')
        t('O BARRAMENTO' in pg.inner_text('.rolo') and 'códigos de rede' in pg.inner_text('.rolo'),
          'o barramento e os códigos U ficam em dois quadros curtos, lado a lado')

        # ---------- 9) programações avançadas: cada função abre a SUA tela ----------
        pg.click('.rail a[href="#/prog"]')
        pg.wait_for_selector('#sc-descobrir', timeout=10000)
        t('ESCREVE NO CARRO' in pg.inner_text('.cab'), 'a aba avisa que esta é a tela que escreve no carro')
        atalhos = pg.eval_on_selector_all('.cards.tres .card b', 'es => es.map(e => e.textContent.trim())')
        t(atalhos == ['Teste de atuador', 'Aprendizados', 'Programar bico'],
          'a aba é um MENU das três funções, não as três empilhadas: ' + str(atalhos))
        t(len(pg.query_selector_all('.lista .item')) == 0, 'o menu não traz lista nenhuma: a lista é da tela de cada função')
        pg.click('#sc-descobrir')
        pg.wait_for_function("/que o módulo informou/.test(document.body.textContent)", timeout=60000)
        t('que o módulo informou' in pg.inner_text('.cards.tres'), 'depois de perguntar, cada card diz quantos o módulo informou')

        # cada card abre a tela inteira daquela função, com volta para o menu
        pg.click('#sc-abrir-atuador')
        pg.wait_for_selector('#sc-voltar-prog', timeout=10000)
        t('Teste de atuador' in pg.inner_text('.cab h1'), 'o card do atuador abre a TELA do teste de atuador')
        t('APRENDIZADOS' not in pg.inner_text('.rolo') and 'PROGRAMAR BICO' not in pg.inner_text('.rolo'),
          'na tela do atuador não há as outras duas funções embaixo')
        t(pg.eval_on_selector('.rail a[aria-current="page"]', 'e => e.textContent').find('Programa') >= 0,
          'o menu lateral continua aceso em Programações')
        itens = pg.query_selector_all('.lista .item > button')
        t(len(itens) > 0, 'a tela do atuador traz as saídas em lista: ' + str(len(itens)))
        t(pg.eval_on_selector('.lista .item > button', 'e => e.getAttribute("aria-expanded")') == 'false',
          'a informação começa escondida')
        t(len(pg.query_selector_all('.lista .item .dentro')) == 0, 'nada aberto antes do toque')
        itens[0].click()
        pg.wait_for_selector('.lista .item .dentro', timeout=10000)
        t(len(pg.query_selector_all('.lista .item .dentro')) == 1, 'o toque abre a informação daquele item, e só dele')
        dentro = pg.inner_text('.lista .item .dentro')
        t('Módulo' in dentro and 'Comando' in dentro, 'aberto, o item mostra o módulo e o comando que vai ser mandado')
        itens[0].click()
        t(len(pg.query_selector_all('.lista .item .dentro')) == 0, 'o segundo toque fecha de novo')
        pg.click('#sc-voltar-prog')
        pg.wait_for_selector('#sc-descobrir', timeout=10000)
        t(pg.is_visible('.cards.tres'), 'o botão PROGRAMAÇÕES volta para o menu das três funções')

        pg.click('#sc-abrir-aprender')
        pg.wait_for_selector('#sc-voltar-prog', timeout=10000)
        t('Aprendizados' in pg.inner_text('.cab h1'), 'o card dos aprendizados abre a tela dos aprendizados')
        t('SAÍDA' not in pg.inner_text('.rolo').upper().replace('SAÍDAS', ''), 'na tela dos aprendizados não há as saídas do atuador')
        pg.click('#sc-voltar-prog')
        pg.wait_for_selector('#sc-abrir-bico', timeout=10000)

        pg.click('#sc-abrir-bico')
        pg.wait_for_selector('#sc-voltar-prog', timeout=10000)
        t('Programar bico' in pg.inner_text('.cab h1'), 'o card do bico abre a tela de programar bico')
        cil = pg.eval_on_selector_all('.lista .item .nome', 'es => es.map(e => e.textContent.trim())')
        t(cil == ['Cilindro 1', 'Cilindro 2', 'Cilindro 3', 'Cilindro 4'], 'os cilindros vêm em lista: ' + str(cil))
        t(not pg.query_selector('#sc-bico-gravar'), 'o botão de gravar bico não existe antes do aceite do módulo')
        pg.click('.lista .item > button')
        pg.wait_for_selector('#sc-trocado-1', timeout=10000)
        t(pg.is_visible('#sc-trocado-1'), 'o toque abre o cilindro e mostra a marcação de bico trocado')
        pg.click('#sc-voltar-prog')
        pg.wait_for_selector('#sc-descobrir', timeout=10000)

        # ---------- 10) sem avisos, menos o EM DESENVOLVIMENTO ----------
        for rota in ['aovivo', 'graficos', 'falhas', 'rede', 'prog']:
            pg.click('.rail a[href="#/' + rota + '"]')
            pg.wait_for_timeout(250)
            t(len(pg.query_selector_all('.nota')) == 0, 'a tela ' + rota + ' não tem bloco de aviso de rotina')
        for rota in ['atuador', 'aprender', 'bico']:
            pg.goto(BASE + '#/' + rota)
            pg.wait_for_selector('#sc-voltar-prog', timeout=10000)
            t(len(pg.query_selector_all('.nota')) == 0, 'a tela ' + rota + ' não tem bloco de aviso de rotina')

        # ---------- 11) em pé (retrato) ----------
        pg.set_viewport_size({'width': 800, 'height': 1280})
        pg.click('.rail a[href="#/inicio"]')
        pg.wait_for_selector('.cards', timeout=10000)
        cols = pg.eval_on_selector('.cards', 'e => getComputedStyle(e).gridTemplateColumns')
        t(cols.count(' ') == 1, 'em pé, os cards ficam em duas colunas: ' + cols)
        pg.set_viewport_size(TABLET)

        # ---------- 12) a placa fica guardada até ser trocada ----------
        pg.reload()
        pg.wait_for_selector('.cards', timeout=15000)
        t('ABC1D23' in pg.inner_text('.placa-id'), 'ao reabrir, o app continua no mesmo carro')
        t(not pg.query_selector('#pl'), 'com placa guardada o app não pede a placa de novo')
        pg.click('#sc-alterar-placa')
        pg.wait_for_selector('#pl', timeout=10000)
        t(pg.is_visible('#pl'), 'ALTERAR PLACA volta a pedir a placa')
        t('ABC1D23' in pg.inner_text('.porta .recentes'), 'a placa anterior fica à mão em ÚLTIMOS CARROS')

        t(not erros, 'nenhum erro de JavaScript nas telas: ' + str(erros[:3]))
        nav.close()

    # ---------- 13) o que vai dentro do APK ----------
    cfg = json.load(open(os.path.join(raiz, 'scanner', 'capacitor.config.json')))
    t(cfg['appId'] == 'br.com.dtcarcentroautomotivo.scanner', 'o APK do Scanner tem id próprio, separado do app do sistema')
    t(cfg['appName'] == 'DTCar Scanner', 'o APK se chama DTCar Scanner')
    t(cfg['server']['url'] == 'https://gestao.dtcarcentroautomotivo.com.br/scanner/',
      'o APK abre as telas do site: mudar tela não exige APK novo')
    t(open(os.path.join(raiz, 'scanner', 'www', 'index.html'), encoding='utf-8').read().count('Sem internet') > 0,
      'a tela que vai dentro do APK é a de sem internet')
    pk = json.load(open(os.path.join(raiz, 'scanner', 'package.json')))
    t(pk['dependencies']['dtcar-obd'] == 'file:plugins/obd', 'o APK leva o plugin do adaptador OBD')
    jv = open(os.path.join(raiz, 'scanner', 'plugins', 'obd', 'android', 'src', 'main', 'java', 'br', 'com',
                           'dtcarcentroautomotivo', 'obd', 'ObdPlugin.java'), encoding='utf-8').read()
    t('public void atuar' in jv and 'public void gravarDado' in jv,
      'o plugin do Scanner é o completo (atuador e gravação), não o de só leitura')
    t('34' in re.search(r'PROIBIDOS[^;]*;', jv).group(0), 'o plugin continua barrando os serviços de regravação de firmware')
    sw = open(os.path.join(raiz, 'scanner', 'sw.js'), encoding='utf-8').read()
    t('dtcar-scanner-v' in sw, 'o Scanner tem cache próprio, sem mexer no do site')
    t(re.search(r'const ARQUIVOS = \[(.*?)\];', sw, re.S) is not None, 'o Scanner guarda as telas para abrir sem internet')

    print(str(ok) + ' conferências do DTCar Scanner passaram.')
finally:
    srv.terminate()
