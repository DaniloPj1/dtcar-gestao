# Ficha do salão (11/11/2026): O.S. › Imprimir O.S. › "Ficha do salão" → #/imprimir/salao/<id>.
# Confere a lista tirada da reclamação ("//", frases, vazia → serviços lançados, muitos itens), o aviso de orçamento,
# que cada caso imprime em UMA folha A4 e que a janela do Imprimir leva à ficha. Também abre no celular.
# Uso: python3 teste/teste_ficha_salao.py   (precisa de: pip install playwright && playwright install chromium; pdfinfo)
import subprocess, time, sys, os, tempfile, re
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra))
U = "http://localhost:8767/"; TMP = tempfile.mkdtemp()
CASOS = {
  "barras": ("REVISAR  FREIOS // TROCAR OLEO E FILTROS // REVISAR SUSPENSÃO // REVISAR CRUZETAS // REVISAR ROLAMENTOS DE RODA // ",
             ["REVISAR FREIOS", "TROCAR OLEO E FILTROS", "REVISAR SUSPENSÃO", "REVISAR CRUZETAS", "REVISAR ROLAMENTOS DE RODA"]),
  "frases": ("Troca de óleo e filtros. Revisar freio e suspensão. Trocar a cabeça da manopla.",
             ["TROCA DE ÓLEO E FILTROS", "REVISAR FREIO E SUSPENSÃO", "TROCAR A CABEÇA DA MANOPLA"]),
  "vazia": ("", ["TROCA DE PASTILHAS"]),
  "lotada": (" // ".join("SERVIÇO NÚMERO %d COM TEXTO UM POUCO MAIS COMPRIDO PARA TESTAR" % i for i in range(1, 15)), None),
}
def abrir(b, rec, w=1366, h=900, status=None):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
  pg.goto(U + "#/ordens"); pg.wait_for_timeout(1500)
  pg.evaluate("([r, s]) => { const o = window.__DB.ordens.find(o => o.id === 'o4'); o.reclamacao = r; o.box = 'Box 2'; o.mecanico_nome = 'Alex Francisco'; if (s) o.status = s; }", [rec, status])
  pg.goto(U + "#/imprimir/salao/o4"); pg.wait_for_timeout(1500)
  return pg
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    for k, (rec, esperado) in CASOS.items():
      pg = abrir(b, rec)
      itens = pg.eval_on_selector_all(".salao .sl-lista li span", "l => l.map(e => e.textContent)")
      if esperado: chk(k + ": serviços da lista", itens == esperado, itens)
      else: chk(k + ": 14 serviços em 2 colunas", len(itens) == 14 and pg.evaluate("getComputedStyle(document.querySelector('.sl-lista')).display") == "grid", len(itens))
      chk(k + ": sem valores em reais", "R$" not in pg.inner_text(".salao"))
      chk(k + ": aviso de orçamento", "AVISE O CONSULTOR" in pg.inner_text(".salao"))
      if k == "vazia": chk("vazia: avisa que veio dos serviços lançados", "serviços lançados" in pg.inner_text(".salao"))
      pdf = os.path.join(TMP, k + ".pdf"); pg.pdf(path=pdf, format="A4", prefer_css_page_size=True)
      pags = re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout).group(1)
      chk(k + ": uma folha A4", pags == "1", pags)
      pg.close()
    pg = abrir(b, CASOS["barras"][0], status="execucao")
    chk("aprovada: sem o aviso de orçamento", "AVISE O CONSULTOR" not in pg.inner_text(".salao")); pg.close()
    # janela do Imprimir na O.S.
    pg = b.new_context(viewport={"width": 1366, "height": 900}).new_page(); pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.goto(U + "#/os/o4"); pg.wait_for_timeout(1800)
    pg.click("button:has-text('Imprimir O.S.')"); pg.wait_for_timeout(500)
    pg.click(".modal button:has-text('Ficha do salão')"); pg.wait_for_timeout(300)
    chk("janela: ficha esconde vias e valores", pg.query_selector(".modal .linha-check") is None and "Vias" not in pg.inner_text(".modal"))
    pg.click(".modal button:has-text('Visualizar e imprimir')"); pg.wait_for_timeout(1500)
    chk("janela: abre a ficha do salão", pg.evaluate("location.hash") == "#/imprimir/salao/o4" and pg.query_selector(".folha.salao") is not None)
    pg.click(".imp-barra button:has-text('Voltar')"); pg.wait_for_timeout(1200)
    pg.click("button:has-text('Imprimir O.S.')"); pg.wait_for_timeout(500)
    pg.click(".modal button:has-text('Visualizar e imprimir')"); pg.wait_for_timeout(1500)
    chk("janela: Folha A4 continua abrindo a O.S. normal", pg.evaluate("location.hash").startswith("#/imprimir/os/o4") and pg.query_selector(".folha.os-a4") is not None)
    # celular: cabe na largura sem rolar para o lado
    pg = abrir(b, CASOS["barras"][0], 393, 852)
    chk("celular: ficha sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("erros de página:", erros or "nenhum")
sys.exit(1 if falhas or erros else 0)
