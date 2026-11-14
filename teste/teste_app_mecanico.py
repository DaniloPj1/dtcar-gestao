# Teste do app do mecânico (VERSÃO DE TESTE, pasta mecanico/): login, trava do Wi-Fi, orçamento, serviços, apontamento e óleo.
# Uso: python3 teste/teste_app_mecanico.py   (precisa de: pip install playwright && playwright install chromium)
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright
raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '-d', raiz], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = 0
def t(c, m):
    global ok
    assert c, m; ok += 1
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        pg = b.new_page(viewport={'width': 390, 'height': 844}, service_workers='block')
        erros = []; pg.on('pageerror', lambda e: erros.append(str(e))); pg.on('console', lambda m: m.type == 'error' and erros.append(m.text))
        pg.goto('http://localhost:8765/mecanico/'); pg.wait_for_selector('#lg-senha')
        t(pg.locator('video').count() == 1, 'vídeo no login'); t(pg.get_by_text('Olá, Carlos').count() == 1, 'saudação')
        pg.get_by_role('button', name='ENTRAR').click(); t(pg.get_by_text('Digite sua senha.').count() == 1, 'pede a senha')
        pg.fill('#lg-senha', 'abc'); t(pg.evaluate("document.activeElement.id") == 'lg-senha', 'cursor continua na senha')
        t(pg.evaluate("document.querySelector('video') === window.__v0 || (window.__v0 = document.querySelector('video'), true)"), 'guarda vídeo')
        pg.type('#lg-senha', 'd'); t(pg.evaluate("document.querySelector('video') === window.__v0"), 'vídeo não reinicia ao digitar')
        t(pg.input_value('#lg-senha') == 'abcd', 'senha digitada')
        # fora do wifi
        pg.get_by_text('simulando NO Wi-Fi').click(); pg.get_by_role('button', name='ENTRAR').click()
        t(pg.get_by_text('Conecte-se ao Wi-Fi da oficina').count() == 1, 'trava do wifi')
        pg.get_by_text('simular que conectou').click(); pg.get_by_role('button', name='Tentar de novo').click()
        t(pg.get_by_text('Meus veículos de hoje').count() == 1, 'lista de veículos'); t(pg.locator('video').count() == 0, 'sem vídeo fora do login')
        t(pg.get_by_text('2 de 3 serviços').count() == 1, 'progresso em serviços')
        # receber veículo
        pg.get_by_role('button', name='Receber veículo e fazer orçamento').click()
        pg.fill('#nv-placa', 'ozr3b82'); t(pg.input_value('#nv-placa') == 'OZR3B82', 'placa em maiúsculas')
        pg.get_by_role('button', name='Buscar veículo').click(); t(pg.get_by_text('Encontrado no cadastro da oficina').count() == 1, 'placa cadastrada')
        pg.fill('#nv-km', '98000'); pg.get_by_role('button', name='Continuar para os itens').click()
        pg.fill('#nv-texto', 'trocar oleo e filtro de oleo, pastilha dianteira, alinhamento, limpeza de bico')
        pg.get_by_role('button', name='Montar a lista').click(); t(pg.get_by_text('7 itens').count() == 1, 'lista com 7 itens')
        pg.get_by_role('button', name='Enviar orçamento para a oficina').click()
        t(pg.get_by_text('ORC 0057 enviado para a oficina.').count() == 1, 'orçamento enviado'); t(pg.get_by_text('Orçamento enviado', exact=True).count() == 1, 'etapa orçamento')
        pg.get_by_text('OZR3B82').click(); pg.get_by_role('button', name='Aprovar: vira O.S.').click()
        t(pg.get_by_text('Serviços da O.S.').count() == 1, 'virou lista de serviços'); t(pg.get_by_text('Subst. de óleo e filtros').count() == 1, 'serviço agrupado')
        pg.get_by_role('button', name='Ver peças (2)').first.click(); t(pg.get_by_text('Filtro de óleo').count() >= 1, 'peças do serviço')
        pg.get_by_role('button', name='Iniciar serviço').click(); t(pg.get_by_text('Iniciado às').count() == 1, 'iniciado, sem cronômetro')
        pg.get_by_role('button', name='Marcar como feito por mim: Subst. de óleo e filtros').click(); t(pg.get_by_text('Feito por você').count() == 1, 'apontado por mim')
        pg.get_by_role('button', name='Outro mecânico').first.click(); pg.get_by_role('button', name='Rafael').click(); t(pg.get_by_text('Feito por Rafael').count() == 1, 'apontado por outro')
        pg.get_by_role('button', name='Adm inclui um item').click(); t(pg.get_by_text('Incluído pelo administrador').count() == 1, 'item do adm')
        pg.get_by_role('button', name='Pausar').click(); pg.get_by_role('button', name='Aguardando peça').click(); t(pg.get_by_text('Motivo da pausa').count() == 1, 'pausa com motivo')
        pg.get_by_role('button', name='Voltar para meus veículos').click(); t(pg.get_by_role('button', name='Notificações: 2').count() == 1, 'sino com 2')
        pg.get_by_role('button', name='Óleo', exact=True).click(); pg.fill('#busca-oleo', 'hilux'); t(pg.get_by_text('7,9 L').count() == 1 and pg.get_by_text('Chevrolet Onix').count() == 0, 'busca de óleo')
        pg.get_by_role('button', name='Veículos', exact=True).click(); pg.get_by_text('simular fim do horário comercial').click()
        t(pg.get_by_text('Fora do horário comercial (7h às 18h)').count() == 1, 'saiu fora do horário')
        t(not erros, 'sem erro no console: ' + '; '.join(erros))
        # tela larga (PC): fica centralizado
        pg2 = b.new_page(viewport={'width': 1366, 'height': 768}, service_workers='block'); pg2.goto('http://localhost:8765/mecanico/'); pg2.wait_for_selector('#lg-senha')
        t(pg2.evaluate("document.getElementById('app').getBoundingClientRect().width") == 480, 'largura máxima no PC')
        # o sistema principal não mudou de comportamento: abre normalmente
        b.close()
    print(ok, 'verificações OK')
finally:
    srv.terminate()
