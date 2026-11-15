# Peças por veículo na O.S. e no orçamento (15/11/2026): botão "Peças deste veículo" no incluir peça, lista por grupo com foto, medidas,
# aplicação e conversão; "Usar" leva a descrição e o código para o item, o valor é digitado; nada entra no estoque. PC e celular.
# Uso: python3 teste/teste_pecas_tela.py [pasta das fotos]
import subprocess, time, sys, os, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8791", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra)[:500])
U = "http://localhost:8791/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
PREP = """(() => { const db = window.__DB;
  db.veiculos.push({ id: 'vx', placa: 'ONX2A20', marca: 'CHEVROLET', modelo: 'ONIX 10MT LT', ano: '2020', cliente_id: 'c1', km_atual: 10, motor: '', ficha_oleo: null });
  db.veiculos.push({ id: 'vz', placa: 'ZZZ9A99', marca: 'Marca Inventada', modelo: 'Carro Que Nao Existe', ano: '2015', cliente_id: 'c1', km_atual: 10, motor: '' });
  const base = db.ordens.find(o => o.id === 'o3');
  db.ordens.push({ ...base, id: 'ox', numero: 1950, status: 'diagnostico', veiculo_id: 'vx', veiculo: { placa: 'ONX2A20', marca: 'CHEVROLET', modelo: 'ONIX 10MT LT', ano: '2020' }, total: 0 });
  db.ordens.push({ ...base, id: 'oz', numero: 1951, status: 'diagnostico', veiculo_id: 'vz', veiculo: { placa: 'ZZZ9A99', marca: 'Marca Inventada', modelo: 'Carro Que Nao Existe', ano: '2015' }, total: 0 }); })();"""
def rodar(b, nome, w, h):
  T = lambda t: "[" + nome + "] " + t
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(PREP)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1200); pg.goto(U + "#/os/ox"); pg.wait_for_timeout(1500)
  pg.click("button:has-text('Produtos e serviços')"); pg.wait_for_timeout(300)
  np = pg.evaluate("window.__DB.produtos.length")
  pg.click(".grupo-itens:has-text('Peças') button:has-text('+ Incluir')"); pg.wait_for_timeout(400)
  chk(T("incluir peça: botão 'Peças deste veículo'"), pg.locator("#cat-pecas-veic").count() == 1)
  pg.click("#cat-pecas-veic"); pg.wait_for_timeout(1500)
  chk(T("lista de peças do Onix 2020 por grupo"), pg.locator("#pv .pv-item").count() >= 6 and pg.locator("#pv .pv-grupo h4").count() >= 4 and "ONIX" in pg.inner_text("#pv .info"), pg.inner_text("[role=dialog]")[:300])
  chk(T("avisa que é dado de catálogo e manda conferir"), "confira" in pg.inner_text("#pv .info").lower() and "Perfect" in pg.inner_text("#pv .info"))
  chk(T("peça traz descrição, aplicação e código"), "CUBO DE RODA DIANTEIRO" in pg.inner_text(".pv-item[data-cod=CDRD0314]") and "ONIX" in pg.inner_text(".pv-item[data-cod=CDRD0314] .pv-apl") and "CDRD0314" in pg.inner_text(".pv-item[data-cod=CDRD0314] .pv-cod"))
  chk(T("foto da peça carregada (miniatura do catálogo)"), pg.evaluate("(() => { const i = [...document.querySelectorAll('#pv img.pv-foto')]; return i.length > 0 && i.some(x => x.complete && x.naturalWidth > 0); })()"))
  chk(T("sem rolagem lateral"), pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  pg.screenshot(path=os.path.join(TMP, "pecas_lista_" + nome + ".png"))
  cod = pg.evaluate("(() => { const d = [...document.querySelectorAll('#pv .pv-item')].map(x => x.dataset.cod); return d; })()")
  pg.fill("#pv-busca", "cubo"); pg.wait_for_timeout(300)
  chk(T("filtro de texto"), pg.locator("#pv .pv-item").count() >= 1 and all("CUBO" in t for t in pg.locator("#pv .pv-item strong").all_inner_texts()), pg.locator("#pv .pv-item strong").all_inner_texts())
  pg.fill("#pv-busca", ""); pg.select_option("#pv-grupo", "Bucha"); pg.wait_for_timeout(300)
  chk(T("filtro por grupo"), pg.locator("#pv .pv-grupo h4").all_inner_texts() == ["Bucha"], pg.locator("#pv .pv-grupo h4").all_inner_texts())
  pg.select_option("#pv-grupo", ""); pg.wait_for_timeout(200)
  com = pg.evaluate("""(async () => { const { carregarPecas } = await import('/js/pecas.js'); const c = await carregarPecas(); const na = [...document.querySelectorAll('#pv .pv-item')].map(x => x.dataset.cod);
    const p = na.map(k => c.pecas.find(x => x.codigo === k)); const a = p.find(x => x.oem.length || x.conv.length), s = p.find(x => !x.oem.length && !x.conv.length); return { com: a && a.codigo, oem: a && a.oem[0], sem: s && s.codigo }; })()""")
  if com["com"]:
    pg.click(".pv-item[data-cod=" + com["com"] + "] .pv-conversao"); pg.wait_for_timeout(200)
    chk(T("botão Conversão abre os códigos da montadora e das outras marcas"), pg.locator("#pv-conv-" + com["com"]).count() == 1 and (not com["oem"] or com["oem"] in pg.inner_text("#pv-conv-" + com["com"])), pg.inner_text(".pv-item[data-cod=" + com["com"] + "]"))
    pg.screenshot(path=os.path.join(TMP, "pecas_conversao_" + nome + ".png"))
    pg.click(".pv-item[data-cod=" + com["com"] + "] .pv-conversao"); pg.wait_for_timeout(200)
    chk(T("clicar de novo fecha a conversão"), pg.locator("#pv-conv-" + com["com"]).count() == 0)
  else: chk(T("alguma peça do Onix tem conversão"), False, cod)
  if com["sem"]:
    pg.click(".pv-item[data-cod=" + com["sem"] + "] .pv-conversao"); pg.wait_for_timeout(200)
    chk(T("peça sem conversão: diz que o catálogo não traz"), "não traz conversão" in pg.inner_text("#pv-conv-" + com["sem"]))
  alvo = com["com"] or "CDRD0314"
  pg.click(".pv-item[data-cod=" + alvo + "] .pv-usar"); pg.wait_for_timeout(400)
  desc = pg.input_value("#it-desc"); codigo = pg.input_value("#it-cod")
  chk(T("Usar: descrição em maiúsculas e código (montadora + marca) no item"), desc == desc.upper() and len(desc) > 5 and "PERFECT " + alvo in codigo and (not com["oem"] or codigo.startswith(com["oem"])), [desc, codigo])
  chk(T("item fica só desta O.S. (não entra no cadastro nem no estoque)"), "não entra no cadastro" in pg.inner_text("[role=dialog]"))
  pg.fill("#it-custo", "100,00"); pg.wait_for_timeout(150); pg.fill("#it-venda", "150,00"); pg.wait_for_timeout(200)
  pg.screenshot(path=os.path.join(TMP, "pecas_item_" + nome + ".png"))
  pg.click("[role=dialog] button.btn-pri:has-text('Salvar item')"); pg.wait_for_timeout(500)
  chk(T("item entrou na lista da O.S. com o valor digitado"), desc in pg.inner_text(".grupo-itens:has-text('Peças')") and "150,00" in pg.inner_text(".grupo-itens:has-text('Peças')"), pg.inner_text(".grupo-itens:has-text('Peças')")[:300])
  chk(T("nenhum produto novo no cadastro"), pg.evaluate("window.__DB.produtos.length") == np)
  # voltar ao cadastro de produtos e carro que o catálogo não conhece
  pg.click(".grupo-itens:has-text('Peças') button:has-text('+ Incluir')"); pg.wait_for_timeout(300); pg.click("#cat-pecas-veic"); pg.wait_for_timeout(800)
  pg.click("#pv-voltar"); pg.wait_for_timeout(300)
  chk(T("Voltar: de volta à busca do cadastro de produtos"), pg.locator("#cat-busca").count() == 1)
  pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
  pg2 = pg.context.new_page(); pg2.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg2.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg2.add_init_script(PREP)
  pg2.goto(U + "#/painel"); pg2.wait_for_timeout(1200); pg2.goto(U + "#/os/oz"); pg2.wait_for_timeout(1500)
  pg2.click("button:has-text('Produtos e serviços')"); pg2.wait_for_timeout(300)
  pg2.click(".grupo-itens:has-text('Peças') button:has-text('+ Incluir')"); pg2.wait_for_timeout(300); pg2.click("#cat-pecas-veic"); pg2.wait_for_timeout(1200)
  chk(T("carro fora do catálogo: avisa e deixa voltar"), pg2.locator("#pv-vazio").count() == 1 and pg2.locator("#pv-voltar").count() == 1)
  pg2.click("#pv-voltar"); pg2.wait_for_timeout(200); pg2.keyboard.press("Escape"); pg2.wait_for_timeout(200)
  pg2.click(".grupo-itens:has-text('Serviços / mão de obra') button:has-text('+ Incluir')"); pg2.wait_for_timeout(300)
  chk(T("serviço: não tem o botão de peças do veículo"), pg2.locator("#cat-pecas-veic").count() == 0 and pg2.locator("#cat-busca").count() == 1)
  pg2.close(); pg.close()
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    rodar(b, "pc", 1366, 768); rodar(b, "celular", 390, 780)
    b.close()
finally: srv.terminate()
for n in ok: print("OK   ", n)
print(len(ok), "OK,", len(falhas), "falhas,", len(erros), "erros de página")
for f in falhas: print("FALHA", f)
for e in erros: print("ERRO ", e)
sys.exit(1 if falhas or erros else 0)
