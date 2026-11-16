# Ficha de óleo e filtros no veículo (14/11/2026, v57): card na página do veículo (#/veiculo/ID), "Preencher pelo catálogo" com as versões
# do carro e as respostas de óleo, ficha gravada (e motor, se o cadastro não tinha), selo "Do catálogo, confira" → "Confirmado pela oficina",
# estoque na ficha, carro fora do catálogo (preencher à mão), card escondido antes do SQL v57 e sem rolagem lateral no celular.
# Uso: python3 teste/teste_ficha_oleo.py [pasta das fotos]   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8772", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra))
U = "http://localhost:8772/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
PREP = """(() => { const db = window.__DB; db.produtos.push({ id: 'f1', codigo: 901, tipo: 'produto', ativo: true, unidade: 'UN', controla_estoque: true, descricao: 'FILTRO OLEO', referencia: 'OC259 MANN', marca: 'MANN', estoque_atual: 5, categoria: 'FILTROS LUB', preco_vista: 40 });
  db.veiculos.push({ id: 'v3', placa: 'XYZ9A87', marca: 'Marca Inventada', modelo: 'Carro Que Nao Existe', ano: '2015', cliente_id: 'c1', km_atual: 10, motor: '', ficha_oleo: null });
  db.veiculos.push({ id: 'v5', placa: 'ONX2A21', marca: 'Chevrolet', modelo: 'ONIX', ano: '2021', cliente_id: 'c1', km_atual: 10, motor: '1.0', ficha_oleo: null });
  db.veiculos.push({ id: 'v4', placa: 'OLD1A11', marca: 'Fiat', modelo: 'Palio', ano: '2012', cliente_id: 'c1', km_atual: 10, motor: '' }); })();"""   # v4: sem a coluna (SQL v57 ainda não rodou)
def abrir(b, w, h, rota):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(PREP)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1200); pg.goto(U + "#/veiculo/" + rota); pg.wait_for_timeout(1500)
  return pg
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    pg = abrir(b, 1366, 768, "v1")   # Fiat Uno 2015, sem motor no cadastro
    chk("página do veículo: card 'Óleo e filtros' aparece", pg.locator("#ficha-oleo").count() == 1)
    chk("sem ficha: mostra o botão 'Preencher pelo catálogo' e nenhum selo", pg.locator("#fo-abrir").inner_text() == "Preencher pelo catálogo" and pg.locator("#fo-selo").count() == 0)
    pg.locator("#fo-abrir").click(); pg.wait_for_timeout(1200)
    chk("modal: diz que o cadastro não tem o motor e o que entendeu", "não tem o motor" in pg.locator("#fo-entendido").inner_text() and "UNO" in pg.locator("#fo-entendido").inner_text(), pg.locator("#fo-entendido").inner_text() if pg.locator("#fo-entendido").count() else "")
    na = pg.locator("#fo-apps .fo-op").count(); no = pg.locator("#fo-oleos .fo-op").count()
    chk("modal: lista as versões do carro e as respostas de óleo", na >= 2 and no >= 1, [na, no])
    chk("modal: já vem a melhor versão e o melhor óleo marcados e os campos preenchidos", pg.locator("#fo-apps .fo-sel").count() == 1 and pg.locator("#fo-oleos .fo-sel").count() == 1 and pg.input_value("#fo-litros") != "" and pg.input_value("#fo-oleo") != "")
    pg.screenshot(path=os.path.join(TMP, "ficha_modal_pc.png"))
    pg.locator("#fo-apps .fo-op").nth(1).click(); pg.wait_for_timeout(200)
    cod2 = pg.input_value("#fo-oleo")
    chk("trocar para a versão 1.4 marca a resposta de óleo do 1.4", "1.4" in pg.locator("#fo-oleos .fo-sel").inner_text(), pg.locator("#fo-oleos .fo-sel").inner_text())
    chk("trocar a versão troca os códigos dos filtros", pg.locator("#fo-apps .fo-sel").count() == 1 and cod2 != "")
    chk("vai gravar o motor no cadastro (estava vazio)", pg.locator("#fo-motor-novo").count() == 1)
    litros = pg.input_value("#fo-litros")
    pg.locator("#fo-salvar").click(); pg.wait_for_timeout(1500)
    db = pg.evaluate("() => window.__DB.veiculos.find(v => v.id === 'v1')")
    chk("gravou a ficha no veículo (origem catálogo, filtros em lista)", db["ficha_oleo"] and db["ficha_oleo"]["origem"] == "catalogo" and db["ficha_oleo"]["litros"] == litros and db["ficha_oleo"]["filtros"]["oleo"], db["ficha_oleo"])
    chk("gravou o motor que o cadastro não tinha", bool(db["motor"]), db["motor"])
    chk("com ficha: quadro recolhido (só a linha de cima) e botão 'Mostrar'", pg.locator("#fo-corpo").count() == 0 and pg.locator("#ficha-oleo .of-filtro").count() == 0 and pg.locator("#fo-alternar").get_attribute("aria-expanded") == "false" and "Mostrar" in pg.locator("#fo-alternar").inner_text())
    pg.locator("#fo-alternar").click(); pg.wait_for_timeout(300)
    chk("clicar abre o quadro com os filtros e o botão vira 'Ocultar'", pg.locator("#fo-corpo").count() == 1 and pg.locator("#fo-alternar").get_attribute("aria-expanded") == "true" and "Ocultar" in pg.locator("#fo-alternar").inner_text())
    chk("card mostra litros, viscosidade e o selo 'Do catálogo, confira'", pg.locator("#fo-selo").inner_text() == "Do catálogo, confira" and pg.locator("#ficha-oleo .of-litros").inner_text() == litros + " L", pg.locator("#ficha-oleo").inner_text()[:200])
    chk("card mostra os 4 filtros", pg.locator("#ficha-oleo .of-filtro").count() == 4)
    pg.screenshot(path=os.path.join(TMP, "ficha_card_pc.png"))
    pg.locator("#fo-confirmar").click(); pg.wait_for_timeout(1000)
    chk("confirmar: selo vira 'Confirmado pela oficina' e o botão some", "Confirmado pela oficina" in pg.locator("#fo-selo").inner_text() and pg.locator("#fo-confirmar").count() == 0)
    db = pg.evaluate("() => window.__DB.veiculos.find(v => v.id === 'v1').ficha_oleo")
    chk("confirmar: grava origem 'oficina' e a data", db["origem"] == "oficina" and db["confirmado_em"], db)
    pg.locator("#fo-abrir").click(); pg.wait_for_timeout(1000)
    chk("refazer: abre com os valores da ficha, sem 'vai gravar motor' (já tem)", pg.input_value("#fo-litros") == litros and pg.locator("#fo-motor-novo").count() == 0)
    pg.fill("#fo-litros", "")
    pg.locator("#fo-salvar").click(); pg.wait_for_timeout(300)
    chk("sem litros: avisa e não grava", pg.locator(".erros", has_text="litros").count() == 1)
    pg.fill("#fo-litros", "9,9"); pg.locator("#fo-confirma").check(); pg.locator("#fo-salvar").click(); pg.wait_for_timeout(1000)
    db = pg.evaluate("() => window.__DB.veiculos.find(v => v.id === 'v1').ficha_oleo")
    chk("editar à mão: litros ajustados e 'confirmo' marcado fica confirmado", db["litros"] == "9,9" and db["origem"] == "oficina")
    # carro fora do catálogo: preencher à mão
    pg.goto(U + "#/veiculo/v3"); pg.wait_for_timeout(1200)
    pg.locator("#fo-abrir").click(); pg.wait_for_timeout(1200)
    chk("fora do catálogo: avisa e deixa preencher à mão", pg.locator(".sub", has_text="não está no catálogo").count() == 1 and pg.locator("#fo-apps").count() == 0)
    pg.fill("#fo-litros", "4,2"); pg.fill("#fo-visc", "5W30"); pg.fill("#fo-oleo", "XYZ1 / XYZ2"); pg.locator("#fo-salvar").click(); pg.wait_for_timeout(1000)
    db = pg.evaluate("() => window.__DB.veiculos.find(v => v.id === 'v3')")
    chk("fora do catálogo: ficha manual gravada, motor continua vazio", db["ficha_oleo"]["litros"] == "4,2" and db["ficha_oleo"]["filtros"]["oleo"] == ["XYZ1", "XYZ2"] and db["motor"] == "", db)
    # Onix 1.0 2021: o quadro de preencher mostra o sinal de atenção (5W30 turbo x 0W20 aspirado)
    pg.goto(U + "#/veiculo/v5"); pg.wait_for_timeout(1200)
    pg.locator("#fo-abrir").click(); pg.wait_for_timeout(1500)
    chk("Onix 2021: sinal de atenção no quadro da ficha, com 5W30 e 0W20", pg.locator("#fo-atencao").count() == 1 and "5W30" in pg.locator("#fo-atencao").inner_text() and "0W20" in pg.locator("#fo-atencao").inner_text(), pg.locator("#fo-atencao").inner_text() if pg.locator("#fo-atencao").count() else "")
    pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    # antes do SQL v57: o veículo não tem a coluna → card escondido
    pg.goto(U + "#/veiculo/v4"); pg.wait_for_timeout(1200)
    chk("antes do v57 (sem a coluna): o card não aparece", pg.locator("#ficha-oleo").count() == 0 and pg.locator(".det-cab").count() == 1)
    # celular
    pc = abrir(b, 390, 844, "v1")
    chk("celular: card aparece e a página não rola para o lado", pc.locator("#ficha-oleo").count() == 1 and not pc.evaluate("() => document.documentElement.scrollWidth > innerWidth"))
    pc.locator("#fo-abrir").click(); pc.wait_for_timeout(1000)
    chk("celular: modal sem rolagem lateral", not pc.evaluate("() => document.documentElement.scrollWidth > innerWidth"))
    pc.screenshot(path=os.path.join(TMP, "ficha_modal_celular.png"))
    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("ERROS", erros)
