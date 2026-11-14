# Etapa 3 de óleo e filtros (14/11/2026): botão "Óleo e filtros da ficha" na O.S. — lança de uma vez o óleo e os filtros do ESTOQUE.
# Confere: botão só com ficha no veículo, aviso de ficha não confirmada, óleo pela viscosidade e litros da ficha, filtro do estoque pela
# conversão, filtro sem saldo não é lançado (mostra o código), itens gravados pela O.S. (um salvamento só) com preço e produto, item que já
# está na O.S. vem desmarcado, estoque insuficiente barra, O.S. sem ficha sem botão, celular sem rolagem lateral.
# Uso: python3 teste/teste_lancar_ficha.py [pasta das fotos]   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8773", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra))
U = "http://localhost:8773/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
PREP = """(() => { const db = window.__DB; const p = (id, d, o) => db.produtos.push({ id, codigo: 900 + db.produtos.length, tipo: 'produto', ativo: true, unidade: 'UNI', controla_estoque: true, descricao: d, referencia: '', marca: '', estoque_atual: 0, categoria: '', preco_vista: 10, custo: 5, vender_sem_estoque: false, ...o });
  p('o1', 'OLEO 5W30 SEMI-SINT MAX', { unidade: 'LTR', categoria: 'OLEO MOTOR', marca: 'BPROAUTO', estoque_atual: 16, preco_vista: 52.75, custo: 25 });
  p('o2', 'OLEO 5W30 LUBRAX TOP AUTO SQ SINT', { unidade: 'LTR', categoria: 'OLEO MOTOR', marca: 'LUBRAX', estoque_atual: 3, preco_vista: 56.88, custo: 31 });
  p('f1', 'FILTRO DE OLEO TOYOTA HILUX', { referencia: 'W 7283 MANN', marca: 'MANN', categoria: 'FILTROS LUB', estoque_atual: 3, preco_vista: 49.8, custo: 24.9 });
  db.produtos.push({ id: 's1', codigo: 990, tipo: 'servico', ativo: true, unidade: 'UNI', descricao: 'SUBST. DE OLEO E FILTRO', preco_vista: 80, preco_prazo: 80, cobranca: 'fixo', categoria: 'SERVICOS' });
  const v2 = db.veiculos.find(v => v.id === 'v2'); v2.combustivel = 'Diesel'; v2.ficha_oleo = { litros: '8', viscosidade: '5W30', norma: '', marca: 'Tecfil', filtros: { oleo: ['PSL916'], ar: ['ARL2219'], combustivel: [], cabine: [] }, origem: 'catalogo' };
  db.os_itens = db.os_itens || []; })();"""
def abrir(b, w, h, os_id):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(PREP)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1200); pg.goto(U + "#/os/" + os_id); pg.wait_for_timeout(1800)
  aba = pg.get_by_role("tab", name="Produtos e serviços")
  if aba.count(): aba.first.click(); pg.wait_for_timeout(400)
  return pg
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    pg = abrir(b, 1366, 768, "o2")   # Hilux, em execução, com ficha
    chk("O.S. do veículo com ficha: botão 'Óleo e filtros da ficha' nas peças", pg.locator("#os-ficha-oleo").count() == 1, pg.locator("button").all_inner_texts()[:30])
    pg.locator("#os-ficha-oleo").click(); pg.wait_for_timeout(1500)
    chk("modal: avisa que a ficha não foi confirmada", pg.locator("#lf-aviso").count() == 1)
    sel = pg.locator("#lf-oleo-prod")
    chk("óleo: só óleos 5W30 do estoque, o com saldo para 8 L primeiro (BProAuto)", sel.locator("option").count() == 2 and "SEMI-SINT MAX" in sel.locator("option").first.inner_text(), sel.locator("option").all_inner_texts())
    chk("óleo: litros da ficha (8) já na quantidade e marcado", pg.input_value("#lf-oleo-qtd") == "8" and pg.locator("#lf-oleo").is_checked())
    linhas = pg.locator(".lf-linha")
    txt = " | ".join(linhas.all_inner_texts()).replace("\n", " ")
    chk("filtro de óleo: MANN W 7283 do estoque (3 un.)", "7283" in txt and "3 un." in txt, txt)
    chk("filtro de ar sem estoque: não marca e mostra o código para comprar", "sem estoque" in txt and "ARL2219" in txt, txt)
    chk("mão de obra: serviço de troca de óleo do cadastro já marcado", pg.locator("#lf-mo-sel").is_checked() and "SUBST. DE OLEO E FILTRO" in pg.locator("#lf-mo-prod").inner_text())
    chk("total = 8 L × 52,75 + filtro 49,80 + mão de obra 80 = R$ 551,80", pg.locator("#lf-total").inner_text().replace("\xa0", " ") == "R$ 551,80", pg.locator("#lf-total").inner_text())
    chk("botão diz 'Lançar 3 itens'", pg.locator("#lf-lancar").inner_text() == "Lançar 3 itens")
    pg.screenshot(path=os.path.join(TMP, "lancar_ficha_pc.png"))
    pg.locator("#lf-lancar").click(); pg.wait_for_timeout(2000)
    it = pg.evaluate("() => (window.__DB.os_itens || []).filter(i => i.ordem_id === 'o2').map(i => ({ d: i.descricao, q: i.qtd, v: i.valor_unit, p: i.produto_id, t: i.tipo }))")
    novos = [x for x in it if x["p"]]
    chk("gravou os 3 itens novos na O.S. (óleo 8 L, filtro 1 un. e a mão de obra), sem mexer nos 3 que já tinha, com preço e produto do estoque", len(it) == 6 and len(novos) == 3 and any(x["p"] == "s1" and x["t"] == "servico" and x["q"] == 1 and x["v"] == 80 for x in it) and any(x["p"] == "o1" and x["q"] == 8 and x["v"] == 52.75 for x in it) and any(x["p"] == "f1" and x["q"] == 1 and x["v"] == 49.8 for x in it), it)
    chk("itens aparecem na lista de peças da O.S.", "SEMI-SINT MAX" in pg.locator("body").inner_text() and "TOYOTA HILUX" in pg.locator("body").inner_text())
    pg.locator("#os-ficha-oleo").click(); pg.wait_for_timeout(1200)
    chk("abrir de novo: o que já está na O.S. vem desmarcado e avisa", not pg.locator("#lf-oleo").is_checked() and "já na O.S." in pg.locator("#lf-oleo-prod").inner_text() and "já está na O.S." in " ".join(pg.locator(".lf-linha").all_inner_texts()), pg.locator("#lf-lancar").inner_text())
    pg.locator("#lf-oleo").check(); pg.fill("#lf-oleo-qtd", "30"); pg.locator("#lf-lancar").click(); pg.wait_for_timeout(500)
    chk("estoque insuficiente (30 L, há 16): barra e avisa", pg.locator(".erros", has_text="Estoque insuficiente").count() == 1, pg.locator(".erros").all_inner_texts())
    # orçamento separado (ORC): o mesmo botão, sem reserva de estoque (30 L passa) e com a mão de obra
    po = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    po.on("pageerror", lambda e: erros.append(str(e)))
    po.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); po.add_init_script(PREP)
    po.add_init_script("window.addEventListener('load', () => { window.__DB.orcamentos = [{ id: 'orc1', numero: 7, situacao: 'elaboracao', cliente_id: 'c1', veiculo_id: 'v2', cliente: { nome: 'Cliente Teste', telefone: '27999990000' }, veiculo: { placa: 'QXN1E49', marca: 'Toyota', modelo: 'Hilux', ano: '2018' }, reclamacao: 'Revisão', tabela_preco: 'vista', itens: [], desconto: 0, total: 0, custo: 0 }]; });")
    po.goto(U + "#/painel"); po.wait_for_timeout(1200); po.goto(U + "#/orcamento/orc1"); po.wait_for_timeout(1800)
    chk("orçamento: botão 'Óleo e filtros da ficha' com o veículo do cadastro", po.locator("#orc-ficha-oleo").count() == 1, po.locator("button").all_inner_texts()[:25])
    po.locator("#orc-ficha-oleo").click(); po.wait_for_timeout(1500)
    po.fill("#lf-oleo-qtd", "30")
    po.locator("#lf-lancar").click(); po.wait_for_timeout(800)
    chk("orçamento: sem erro de estoque e o modal fecha", po.locator(".erros", has_text="Estoque insuficiente").count() == 0 and po.locator("#lf-lancar").count() == 0, po.locator(".erros").all_inner_texts())
    corpo = po.locator("body").inner_text()
    chk("orçamento: óleo, filtro e mão de obra entram na lista", "SEMI-SINT MAX" in corpo and "TOYOTA HILUX" in corpo and "SUBST. DE OLEO E FILTRO" in corpo, corpo[:300])
    po.locator("#orc-total").wait_for(); po.get_by_role("button", name="Salvar orçamento").click(); po.wait_for_timeout(1000)
    gr = po.evaluate("() => (window.__DB.orcamentos[0].itens || []).map(i => ({ t: i.tipo, q: i.qtd, p: i.produto_id }))")
    chk("orçamento: salvou os 3 itens (óleo 30 L, filtro, serviço)", len(gr) == 3 and any(x["p"] == "o1" and x["q"] == 30 for x in gr) and any(x["t"] == "servico" for x in gr), gr)
    # O.S. sem ficha no veículo
    p2 = abrir(b, 1366, 768, "o3")   # Uno, sem ficha
    chk("O.S. de veículo sem ficha: sem o botão", p2.locator("#os-ficha-oleo").count() == 0)
    # celular
    pc = abrir(b, 390, 844, "o2")
    chk("celular: botão aparece", pc.locator("#os-ficha-oleo").count() == 1)
    pc.locator("#os-ficha-oleo").click(); pc.wait_for_timeout(1200)
    chk("celular: modal sem rolagem lateral", not pc.evaluate("() => document.documentElement.scrollWidth > innerWidth") and pc.locator("#lf-lancar").is_visible())
    pc.screenshot(path=os.path.join(TMP, "lancar_ficha_celular.png"))
    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("ERROS", erros)
