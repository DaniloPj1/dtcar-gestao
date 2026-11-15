# Tela "App do mecânico › itens da lista" (administrador), com dados simulados (teste/mock.js): troca de sistema, esconder/mostrar,
# renomear, opções (coifa interna/externa), acrescentar item com ícone, remover, e que o resultado vira o que o app do mecânico lê
# (js/appmecanico.js). Confere também que a tela só grava em config.appMecanico e preserva o resto da configuração.
# Uso: python3 teste/teste_app_mecanico_admin.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8768", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e))); pg.on("dialog", lambda d: d.accept())
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.goto("http://localhost:8768/#/painel"); pg.wait_for_timeout(800)
    grupos = pg.evaluate("[...document.querySelectorAll('.lateral-grupo')].map(n => n.firstElementChild.textContent.replace(/[▾▸]/g, '').trim())")
    chk("menu em 4 grupos por departamento", grupos == ["Operação", "Cadastros", "Financeiro", "Sistema"], grupos)
    pg.goto("http://localhost:8768/#/ajustes"); pg.wait_for_timeout(800)
    chk("Ajustes guarda Equipe, Backup e Importar", all(pg.locator(".card:has-text('Mais do sistema') .linha:has-text('" + t + "')").count() == 1 for t in ["Equipe", "Backup", "Importar"]))
    pg.goto("http://localhost:8768/#/equipe"); pg.wait_for_timeout(800)
    chk("em Equipe, o menu marca Ajustes", pg.locator(".lateral button[aria-current=page]:has-text('Ajustes')").count() == 1)
    pg.goto("http://localhost:8768/#/app-mecanico"); pg.wait_for_timeout(800)
    chk("App do mecânico tem item no menu e aparece marcado", pg.locator(".lateral button[aria-current=page]:has-text('App do mecânico')").count() == 1)
    chk("tela abre com os 6 sistemas", pg.locator(".seg button").count() >= 6 and pg.locator(".am-linha").count() == 8, pg.locator(".am-linha").count())
    pg.goto("http://localhost:8768/#/painel"); pg.wait_for_timeout(600)
    chk("menu lateral cabe sem rolar (1366x768)", pg.evaluate("(() => { const l = document.querySelector('.lateral'); return l.scrollHeight <= l.clientHeight + 1; })()"))
    pg.goto("http://localhost:8768/#/app-mecanico"); pg.wait_for_timeout(600)
    # esconder
    pg.locator(".am-linha:has-text('Servo / cilindro mestre') button:has-text('Esconder')").click(); pg.wait_for_timeout(400)
    cfg = lambda: pg.evaluate("window.__DB.config")
    chk("esconder grava só em appMecanico e guarda o resto", cfg()["appMecanico"]["sistemas"]["fr"]["ocultos"] == ["Servo / cilindro mestre"] and cfg().get("espelhoLegado") is True, cfg())
    chk("item escondido fica apagado e com botão Mostrar", pg.locator(".am-linha.am-off:has-text('Servo')").count() == 1 and pg.locator(".am-linha:has-text('Servo') button:has-text('Mostrar')").count() == 1)
    # Transmissão: coifa da homocinética com opções
    pg.click(".seg button:has-text('Transmissão')"); pg.wait_for_timeout(300)
    pg.locator(".am-linha:has-text('Coifa da homocinética') button:has-text('Editar')").click(); pg.wait_for_timeout(300)
    chk("opções atuais aparecem para editar", pg.input_value("#am-ops") == "Interna, Externa")
    pg.fill("#am-ops", "Interna, Externa, Lado esquerdo"); pg.click(".modal button:has-text('Salvar'), .fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(500)
    chk("opções editadas gravadas", cfg()["appMecanico"]["sistemas"]["tr"]["opcoes"]["Coifa da homocinética"] == ["Interna", "Externa", "Lado esquerdo"], cfg())
    # renomear item de outro sistema
    pg.click(".seg button:has-text('Direção')"); pg.wait_for_timeout(300)
    pg.locator(".am-linha:has-text('Ponteira') button:has-text('Editar')").click(); pg.wait_for_timeout(300); pg.fill("#am-nome", "Ponteira de direção"); pg.click(".fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(500)
    chk("renomear grava o novo nome", cfg()["appMecanico"]["sistemas"]["di"]["renomes"] == {"Ponteira": "Ponteira de direção"}, cfg())
    # acrescentar item novo com ícone, 1 ou 2 e posição
    pg.click("button:has-text('+ Acrescentar item em Direção')"); pg.wait_for_timeout(300)
    chk("grade com os 63 ícones", pg.locator(".am-grade button").count() == 63, pg.locator(".am-grade button").count())
    pg.fill("#am-nome", "Terminal de direção"); pg.click(".am-grade button[title='Terminal']"); pg.click(".fundo-modal button:has-text('Diant. | Tras. | Os 2')"); pg.click(".fundo-modal button:has-text('1 ou 2')"); pg.click(".fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(500)
    n = cfg()["appMecanico"]["sistemas"]["di"]["novos"]
    chk("item novo gravado (nome, ícone, tipo, posição)", len(n) == 1 and n[0]["nome"] == "Terminal de direção" and n[0]["icone"] == "terminal" and n[0]["tipo"] == "par" and n[0]["pos"] == "chips", n)
    chk("item novo aparece na lista", pg.locator(".am-linha:has-text('Terminal de direção'):has-text('acrescentado por você')").count() == 1)
    # nome repetido é recusado
    pg.click("button:has-text('+ Acrescentar item em Direção')"); pg.wait_for_timeout(300); pg.fill("#am-nome", "terminal de direção"); pg.click(".fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(400)
    chk("nome repetido recusado", len(cfg()["appMecanico"]["sistemas"]["di"]["novos"]) == 1 and pg.locator(".fundo-modal").count() == 1)
    pg.click(".fundo-modal button:has-text('Cancelar')"); pg.wait_for_timeout(200)
    # o que o app lê
    r = pg.evaluate("""async () => { const m = await import('./js/appmecanico.js'); const c = m.catalogoDoApp(window.__DB.config); const di = c.find(s => s.id === 'di').pecas.map(p => p.nome); const fr = c.find(s => s.id === 'fr').pecas.map(p => p.nome);
      const tr = c.find(s => s.id === 'tr').pecas.find(p => p.orig === 'Coifa da homocinética').pm; return { di, fr, tr }; }""")
    chk("app: renomeado e novo presentes, servo escondido", "Ponteira de direção" in r["di"] and "Terminal de direção" in r["di"] and "Servo / cilindro mestre" not in r["fr"], r)
    chk("app: opções multi da coifa", r["tr"] == ["Interna", "Externa", "Lado esquerdo"], r)
    # remover item novo e mostrar o escondido
    pg.locator(".am-linha:has-text('Terminal de direção') button:has-text('Remover')").click(); pg.wait_for_timeout(400)
    chk("remover tira o item novo", cfg()["appMecanico"]["sistemas"]["di"]["novos"] == [])
    pg.click(".seg button:has-text('Freios')"); pg.wait_for_timeout(300); pg.locator(".am-linha:has-text('Servo') button:has-text('Mostrar')").click(); pg.wait_for_timeout(400)
    chk("mostrar de volta", cfg()["appMecanico"]["sistemas"]["fr"]["ocultos"] == [])
    # celular: a tela cabe
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    chk("celular: sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    chk("sem erro na página", not erros, erros)
    b.close()
finally:
  srv.terminate()
print(len(ok), "ok;", len(falhas), "falhas"); [print("FALHA:", f) for f in falhas]; sys.exit(1 if falhas else 0)
