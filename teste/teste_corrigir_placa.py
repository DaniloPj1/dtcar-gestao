# "Corrigir pela placa" na página do veículo (15/11/2026, v139): consulta completa, prévia do que muda, grava só o que ficar marcado.
# Uso: python3 teste/teste_corrigir_placa.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8774", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra))
U = "http://localhost:8774/"
PREP = """(() => { const db = window.__DB; db.veiculos.push({ id: 'h1', placa: 'MTE3901', marca: 'Toyota', modelo: 'TOYOTA/HILUX', ano: '2010', ano_fab: 2010, ano_mod: 2010, cor: 'Preta', combustivel: 'Gasolina', motor: '', chassi: '', renavam: '', obs: '', cliente_id: 'c1', km_atual: 10, ficha_oleo: null });
  window.__PLACA = { dados: { marca: 'Toyota', modelo: 'HILUX CD4X2 SR', ano_fab: 2010, ano_mod: 2010, cor: 'Preta', combustivel: 'Gasolina', motor: '2.7' } }; })();"""
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    def abrir(w, h, id_):
      pg = b.new_context(viewport={"width": w, "height": h}).new_page()
      pg.on("pageerror", lambda e: erros.append(str(e)))
      pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(PREP)
      pg.goto(U + "#/painel"); pg.wait_for_timeout(1200); pg.goto(U + "#/veiculo/" + id_); pg.wait_for_timeout(1500)
      return pg
    pg = abrir(1366, 768, "h1")
    ch = lambda: pg.evaluate("(window.__PLACA.chamadas || []).filter(c => c.acao !== 'saldo')")
    chk("botão ao lado de 'Imprimir ficha'", pg.locator("#vei-corrigir-placa").count() == 1 and "Imprimir ficha" in pg.locator(".det-cab .acoes").inner_text())
    pg.click("#vei-corrigir-placa"); pg.wait_for_timeout(500)
    chk("pergunta antes de consultar e diz o custo", "Corrigir pela placa" in pg.inner_text("body") and "0,20" in pg.inner_text("body").replace("\xa0", " ") and len(ch()) == 0)
    pg.click("[aria-label='Corrigir pela placa'] button:has-text('Consultar')"); pg.wait_for_timeout(1500)
    c = ch()
    chk("uma consulta completa da placa do veículo", len(c) == 1 and c[0]["acao"] == "completa" and c[0]["placa"] == "MTE3901", c)
    lista = pg.locator("#cp-lista").inner_text()
    chk("prévia mostra modelo, motor, chassi, Renavam e nº do motor", all(x in lista for x in ["HILUX CD4X2 SR", "2.7", "9BWZZZ377VT004251", "00123456789", "BAH123456"]), lista)
    chk("prévia não lista o que já está igual (marca, cor, combustível, anos)", not any(x in lista for x in ["Marca", "Cor", "Combustível", "Ano de"]), lista)
    chk("custo e origem escritos", "Consulta feita agora" in pg.inner_text("#cp-custo"))
    pg.locator("#cp-lista label", has_text="Renavam").locator("input").uncheck()   # desmarca o Renavam
    pg.click("#cp-gravar"); pg.wait_for_timeout(1500)
    v = pg.evaluate("() => window.__DB.veiculos.find(v => v.id === 'h1')")
    chk("gravou o marcado: modelo, motor, chassi e nº do motor nas observações", v["modelo"] == "HILUX CD4X2 SR" and v["motor"] == "2.7" and v["chassi"] == "9BWZZZ377VT004251" and "BAH123456" in v["obs"], v)
    chk("não gravou o desmarcado (Renavam)", v["renavam"] == "", v["renavam"])
    chk("não mexeu em KM, dono nem ficha", v["km_atual"] == 10 and v["cliente_id"] == "c1" and v["ficha_oleo"] is None)
    chk("fechou a prévia e a página mostra o modelo novo", pg.locator("#cp-lista").count() == 0 and "HILUX CD4X2 SR" in pg.inner_text(".det-cab"))
    # de novo: o cadastro já tem chassi, mas ainda falta o Renavam → a consulta paga outra vez só se não houver cópia; aqui o mock responde da API
    pg.click("#vei-corrigir-placa"); pg.wait_for_timeout(400)
    pg.click("[aria-label='Corrigir pela placa'] button:has-text('Consultar')"); pg.wait_for_timeout(1500)
    chk("segunda vez: só o Renavam sobrou para corrigir", "Renavam" in pg.locator("#cp-lista").inner_text() and "Chassi" not in pg.locator("#cp-lista").inner_text(), pg.locator("#cp-lista").inner_text())
    pg.click("button:has-text('Cancelar')"); pg.wait_for_timeout(300)
    chk("cancelar não grava", pg.evaluate("() => window.__DB.veiculos.find(v => v.id === 'h1').renavam") == "")
    # celular: botão aparece e a prévia não rola para o lado
    pc = abrir(390, 844, "h1")
    chk("celular: botão aparece", pc.locator("#vei-corrigir-placa").count() == 1)
    pc.click("#vei-corrigir-placa"); pc.wait_for_timeout(400)
    pc.click("[aria-label='Corrigir pela placa'] button:has-text('Consultar')"); pc.wait_for_timeout(1500)
    chk("celular: prévia sem rolagem lateral", pc.locator("#cp-lista").count() == 1 and not pc.evaluate("() => document.documentElement.scrollWidth > innerWidth"))
    b.close()
finally:
  srv.terminate()
print("\n".join("OK " + x for x in ok)); print("FALHAS", falhas); print("ERROS", erros)
sys.exit(1 if falhas or erros else 0)
