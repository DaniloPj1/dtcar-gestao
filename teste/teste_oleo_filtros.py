# Óleo e filtros por veículo (14/11/2026), etapa 1: tela de pesquisa por modelo (#/oleo-filtros), só leitura.
# Confere: botão da barra de cima do PC e "Mais" do celular, pesquisa por modelo e ano, litros e viscosidade, filtros com Tecfil/Mahle/MANN,
# prioridade do estoque (aparece só o do estoque + Conversão), saldo zerado, quadro de conversão, sem rolagem lateral no celular,
# menu lateral e barra de cima do PC cabendo em 1366x768 e que a tela não grava nada.
# Uso: python3 teste/teste_oleo_filtros.py [pasta das fotos]   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8771", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra))
U = "http://localhost:8771/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
# estoque de mentira: MANN do filtro de óleo da Hilux 204 cv (equivale ao Tecfil PSL916) com saldo; Wega do mesmo filtro zerado
PREP = """(() => { const db = window.__DB; const p = (id, referencia, marca, estoque_atual, categoria) => db.produtos.push({ id, codigo: 900 + db.produtos.length, tipo: 'produto', ativo: true, unidade: 'UN', controla_estoque: true,
    descricao: 'FILTRO ' + referencia, referencia, marca, estoque_atual, categoria, preco_vista: 50 });
  p('f1', 'W 7283 MANN', 'MANN', 3, 'FILTROS LUB'); p('f2', 'W7283 S/NF', 'MANN', 2, 'FILTROS LUB'); p('f3', 'JFA0288', 'WEGA', 0, 'FILTRO AR MOTOR'); p('f4', 'FAC889 S/NF', 'VOX', 4, 'FILTROS'); })();"""
def abrir(b, w, h):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
  pg.add_init_script(PREP)  # o estoque entra antes de o sistema carregar os produtos
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1500)
  return pg
def buscar(pg, q, ano=""):
  pg.fill("#of-q", q); pg.fill("#of-ano", ano); pg.wait_for_timeout(500)
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- PC ----------
    pg = abrir(b, 1366, 768)
    chk("PC: botão 'Óleo e filtros' na barra de cima", pg.locator(".barra-topo button.bt-oleo").count() == 1 and pg.locator(".barra-topo button.bt-oleo").is_visible())
    rol = pg.evaluate("() => { const l = document.querySelector('.lateral'); return [l.scrollHeight, l.clientHeight]; }")
    chk("PC: menu lateral cabe em 1366x768 sem barra de rolagem", rol[0] <= rol[1], rol)
    cab = pg.evaluate("() => { const b = document.querySelector('.barra-topo'); return [b.scrollWidth, b.clientWidth]; }")
    chk("PC: a barra de cima continua cabendo em 1366", cab[0] <= cab[1], cab)
    pg.locator(".barra-topo button.bt-oleo").click(); pg.wait_for_timeout(1500)
    chk("PC: abre a tela", pg.locator("h2", has_text="Óleo e filtros por veículo").count() == 1 and "#/oleo-filtros" in pg.url)
    chk("PC: título da tela na barra de cima", pg.locator(".bt-titulo").inner_text() == "Óleo e filtros")
    chk("sem busca: pede o modelo, sem resultado", pg.locator("#of-oleo").count() == 0 and pg.locator(".vazio", has_text="Digite o modelo").count() == 1)
    buscar(pg, "hilux 2.8", "2023")
    chk("Hilux 2.8 2023: bloco do óleo com litros e viscosidade", pg.locator("#of-oleo .of-oleo").count() >= 1 and pg.locator("#of-oleo .of-litros b").first.inner_text() == "8" and pg.locator("#of-oleo .of-visc b").first.inner_text() == "5W30")
    chk("Hilux 204 cv: avisa que não foi conferido", pg.locator("#of-oleo .of-oleo").first.locator(".of-selo-aviso", has_text="Não conferido").count() == 1)
    chk("óleo: fonte sempre escrita", pg.locator("#of-oleo .of-oleo-pe", has_text="Fonte:").count() == pg.locator("#of-oleo .of-oleo").count())
    a = pg.locator("#of-filtros h4:has-text('Catálogo Tecfil') ~ .of-app").first
    chk("filtros: primeira aplicação da Tecfil é a 204 cv", "204cv" in a.locator("header").inner_text(), a.locator("header").inner_text())
    lo = a.locator(".of-filtro").nth(0)
    chk("filtro de óleo no estoque: aparece só o do estoque, com a quantidade somada", lo.locator(".of-est-item").count() == 1 and "MANN W7283" in lo.inner_text() and "5 un." in lo.inner_text() and "Em estoque" in lo.inner_text(), lo.inner_text())
    chk("filtro de óleo no estoque: não lista Tecfil/Mahle/MANN ao lado", lo.locator(".of-marca").count() == 0 and "PSL916" not in lo.inner_text())
    chk("filtro de óleo no estoque: tem o botão Conversão", lo.locator("button", has_text="Conversão").count() == 1)
    la = a.locator(".of-filtro").nth(1)
    chk("filtro de ar fora do estoque: Tecfil, Mahle e MANN (traço onde não há código)", la.locator(".of-marca").count() == 3 and "ARL2219" in la.inner_text() and la.locator(".of-traco").count() == 2, la.inner_text())
    chk("filtro de ar: cadastrado sem saldo fica avisado e não vira estoque", "Cadastrado, sem saldo" in la.inner_text() and "JFA0288" in la.inner_text() and la.locator(".of-est-item").count() == 0)
    chk("aplicação: catálogo escrito", "Catálogo Tecfil 2026" in a.locator("footer").inner_text())
    chk("outras marcas não aparecem fora da conversão", all(m not in a.inner_text() for m in ["JFO0215", "LB916", "PH3614", "90915YZZD4"]), a.inner_text())
    lo.locator("button", has_text="Conversão").click(); pg.wait_for_timeout(300)
    md = pg.locator(".modal")
    chk("conversão: abre com o estoque, as outras marcas e o original", md.count() == 1 and "Em estoque: MANN W7283 (5 un.)" in md.inner_text() and all(x in md.inner_text() for x in ["Tecfil", "PSL916", "Wega", "JFO0215", "Vox", "LB916", "Toyota", "90915YZZD4"]), md.inner_text())
    pg.screenshot(path=os.path.join(TMP, "pc_conversao.png"))
    md.locator("button", has_text="Fechar").last.click(); pg.wait_for_timeout(200)
    chk("conversão: fecha", pg.locator(".modal").count() == 0)
    pg.screenshot(path=os.path.join(TMP, "pc_hilux.png"), full_page=True)
    outros = pg.locator("button.of-outros")
    chk("outros catálogos ficam recolhidos atrás de um botão", outros.count() == 1 and outros.get_attribute("aria-expanded") == "false")
    n1 = pg.locator("#of-filtros .of-app").count(); outros.click(); pg.wait_for_timeout(300)
    chk("outros catálogos: abre ao clicar", pg.locator("#of-filtros .of-app").count() > n1 and pg.locator("#of-filtros footer", has_text="Catálogo MANN").count() >= 1)
    # filtro que só o catálogo de outra marca liga ao carro (cabine Vox FAC889): aparece em "No seu estoque" sem abrir os outros catálogos
    ne = pg.locator("#of-filtros h4", has_text="No seu estoque")
    chk("estoque achado por outro catálogo aparece em 'No seu estoque'", ne.count() == 1 and "Vox FAC889" in pg.locator("#of-filtros .of-app").first.inner_text() and "4 un." in pg.locator("#of-filtros .of-app").first.inner_text(), pg.locator("#of-filtros .of-app").first.inner_text())
    chk("'No seu estoque' vem antes do catálogo da Tecfil, que continua com o título", pg.locator("#of-filtros h4", has_text="Catálogo Tecfil").count() == 1)
    buscar(pg, "gm onix 1,0", "2015")
    chk("Onix 1.0 2015: 3,5 L e 5W30", pg.locator("#of-oleo .of-oleo", has_text="3,5").filter(has_text="5W30").count() >= 1)
    chk("Onix: filtros sem estoque mostram as três marcas", pg.locator("#of-filtros .of-app").first.locator(".of-filtro").nth(0).locator(".of-marca").count() == 3)
    pg.screenshot(path=os.path.join(TMP, "pc_onix.png"), full_page=True)
    buscar(pg, "xyzxyz")
    chk("modelo que não existe: mensagem clara", pg.locator(".vazio", has_text="Nada no catálogo").count() == 1)
    buscar(pg, "gol 1.6", "2012"); pg.goto(U + "#/painel"); pg.wait_for_timeout(600); pg.goto(U + "#/oleo-filtros"); pg.wait_for_timeout(1200)
    chk("a última busca fica guardada no aparelho", pg.input_value("#of-q") == "gol 1.6" and pg.input_value("#of-ano") == "2012" and pg.locator("#of-filtros .of-app").count() >= 1)
    chk("só leitura: estoque do cadastro não mudou", pg.evaluate("() => window.__DB.produtos.find(x => x.id === 'f1').estoque_atual") == 3)
    # ---------- celular ----------
    cel = abrir(b, 390, 844)
    cel.goto(U + "#/mais"); cel.wait_for_timeout(800)
    chk("celular: 'Mais' tem Óleo e filtros", cel.locator(".linha", has_text="Óleo e filtros").count() == 1)
    cel.locator(".linha", has_text="Óleo e filtros").click(); cel.wait_for_timeout(1500)
    buscar(cel, "hilux 2.8", "2023")
    chk("celular: resultado aparece", cel.locator("#of-oleo .of-oleo").count() >= 1 and cel.locator("#of-filtros .of-app").count() >= 1)
    larg = cel.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    chk("celular: sem rolagem lateral", larg[0] <= larg[1], larg)
    chk("celular: estoque primeiro também", "MANN W7283" in cel.locator("#of-filtros h4:has-text('Catálogo Tecfil') ~ .of-app").first.locator(".of-filtro").nth(0).inner_text())
    cel.screenshot(path=os.path.join(TMP, "cel_hilux.png"), full_page=True)
    cel.locator("#of-filtros h4:has-text('Catálogo Tecfil') ~ .of-app").first.locator("button", has_text="Conversão").first.click(); cel.wait_for_timeout(300)
    larg = cel.evaluate("() => [document.documentElement.scrollWidth, window.innerWidth]")
    chk("celular: conversão abre sem rolagem lateral", cel.locator(".modal").count() == 1 and larg[0] <= larg[1], larg)
    cel.screenshot(path=os.path.join(TMP, "cel_conversao.png"))
    chk("nenhum erro de script", not erros, erros[:3])
finally:
  srv.terminate()
print(len(ok), "verificações passaram" + ("; " + str(len(falhas)) + " FALHARAM:" if falhas else "."))
for f in falhas: print("  ✗", f)
print("fotos em", TMP); sys.exit(1 if falhas else 0)
