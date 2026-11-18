# Comissão por quinzena (v61) com dados simulados (teste/mock.js): a quinzena puxada dos apontamentos do app, percentual
# digitado na hora, lançamento (custo na O.S. + lançamento na folha), cancelamento, matriz de percentuais, extrato impresso,
# e celular (até 640px) e PC independentes.
# Uso: python3 teste/teste_comissao.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8781", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
# reais() escreve "R$ 600,00" com espaço fino (\xa0): o teste compara com espaço comum
def txt(pagina, sel="main"): return pagina.inner_text(sel).replace("\xa0", " ")
U = "http://localhost:8781/"
NOME = "window.__DB.os_itens.find(i => i.id === 'i1').descricao = 'REVISAO GERAL'"
CUSTO = "window.__DB.os_itens.find(i => i.id === 'i1').custo_unit || 0"
LANCS = "(window.__DB.funcionario_lanc || []).filter(l => l.tipo === 'comissao')"
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1366, "height": 768}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.add_init_script(NOME)
    pg.goto(U + "#/comissao"); pg.wait_for_timeout(2200)
    t = txt(pg)
    chk("abre a tela da comissão com o mecânico e o serviço apontado", "Carlos" in t and "REVISAO GERAL" in t, t[:300])
    chk("aba Comissão ao lado de Funcionários e folha", pg.locator(".abas button:has-text('Comissão')").count() == 1)
    chk("menu lateral cabe sem rolar", pg.evaluate("(() => { const l = document.querySelector('.lateral'); return l.scrollHeight <= l.clientHeight + 1; })()"))
    chk("cartão mostra a comissão de 40% de 600 = 240", "R$ 240,00" in t, t[:400])
    chk("mão de obra do serviço aparece", "R$ 600,00" in t, t[:400])

    # 1. percentual digitado na hora vence a matriz
    pct = pg.locator(".cm-linhas li .cm-pct-campo input").first
    pct.fill("50"); pg.wait_for_timeout(500)
    t = txt(pg)
    chk("digitar 50% recalcula para R$ 300,00", "R$ 300,00" in t, t[:400])
    chk("o botão de lançar mostra o total", pg.locator(".cm-bloco button:has-text('Lançar R$ 300,00')").count() == 1)

    # 2. desmarcar tira do lançamento
    pg.locator(".cm-linhas li input[type=checkbox]").first.uncheck(); pg.wait_for_timeout(400)
    chk("desmarcado: o botão de lançar desliga", pg.locator(".cm-bloco button:has-text('Lançar')").first.is_disabled())
    pg.locator(".cm-linhas li input[type=checkbox]").first.check(); pg.wait_for_timeout(400)

    # 3. lançar: a confirmação diz o que o lançamento faz
    pg.click(".cm-bloco button:has-text('Lançar R$ 300,00')"); pg.wait_for_timeout(600)
    conf = txt(pg, ".modal") if pg.locator(".modal").count() else txt(pg, "body")
    chk("a confirmação avisa que entra como custo na O.S.", "custo do serviço" in conf, conf[:400])
    chk("a confirmação avisa que entra na folha", "folha" in conf and "5º dia útil" in conf, conf[:400])
    chk("a confirmação avisa que trava o serviço", "não entram de novo" in conf, conf[:400])
    pg.click(".modal .btn-pri:has-text('Lançar R$ 300,00')"); pg.wait_for_timeout(1400)
    t = txt(pg)
    chk("depois de lançar, aparece em Já lançado nesta quinzena", "Já lançado nesta quinzena" in t, t[:300])
    chk("a comissão virou custo do serviço na O.S.", pg.evaluate(CUSTO) == 300, pg.evaluate(CUSTO))
    chk("entrou um lançamento de comissão na folha", pg.evaluate(LANCS + ".length") == 1 and pg.evaluate(LANCS + "[0].valor") == 300, pg.evaluate(LANCS))
    chk("o serviço lançado não conta de novo", "já lançado" in t, t[:600])
    pg.screenshot(path=SAIDA + "/comissao-pc.png", full_page=True)

    # 4. extrato impresso
    pg.click(".cm-lancados button:has-text('Extrato')"); pg.wait_for_timeout(1500)
    e = txt(pg, "body")
    chk("extrato: cabeçalho, mecânico e total", "EXTRATO DE COMISSÃO" in e and "Carlos" in e and "R$ 300,00" in e, e[:400])
    chk("extrato: traz o serviço e o percentual", "REVISAO GERAL" in e and "50%" in e, e[:500])
    pg.screenshot(path=SAIDA + "/comissao-extrato.png", full_page=True)
    pg.go_back(); pg.wait_for_timeout(1500)

    # 5. cancelar desfaz os três
    pg.click(".cm-lancados button:has-text('Cancelar')"); pg.wait_for_timeout(600)
    pg.click(".modal .btn-perigo:has-text('Cancelar o lançamento')"); pg.wait_for_timeout(1400)
    chk("cancelar tira o custo da O.S.", pg.evaluate(CUSTO) == 0, pg.evaluate(CUSTO))
    chk("cancelar apaga o lançamento da folha", pg.evaluate(LANCS + ".length") == 0, pg.evaluate(LANCS))
    t = txt(pg)
    chk("o serviço volta para a quinzena", "REVISAO GERAL" in t and "Já lançado nesta quinzena" not in t, t[:400])

    # 6. matriz de percentuais
    pg.click(".painel-topo button:has-text('Percentuais')"); pg.wait_for_timeout(600)
    m = txt(pg, ".modal")
    chk("matriz: padrão do mecânico e exceção por grupo", "Padrão de Carlos" in m and "Exceções por grupo" in m and "SUSPENSAO" in m, m[:400])
    pg.fill("#cm-padrao", "45"); pg.wait_for_timeout(300)
    pg.click(".acoes-modal button:has-text('Salvar percentuais')"); pg.wait_for_timeout(1500)
    chk("matriz salva em config.comissao", pg.evaluate("((window.__DB.config.comissao || {}).padrao || {}).fu1") == 45, pg.evaluate("window.__DB.config.comissao"))
    t = txt(pg)
    chk("o novo padrão vale na quinzena (45% de 600 = 270)", "R$ 270,00" in t, t[:400])

    # 7. puxar O.S.
    pg.click(".painel-topo button:has-text('Puxar O.S.')"); pg.wait_for_timeout(600)
    m = txt(pg, ".modal")
    chk("puxar O.S.: explica que só entra serviço apontado", "apontou no app" in m, m[:300])
    pg.click(".modal .fechar") if pg.locator(".modal .fechar").count() else pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)

    # 8. celular (até 640px) independente do PC
    cel = b.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True).new_page()
    cel.on("pageerror", lambda e: erros.append("PAGEERR celular " + str(e)))
    cel.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    cel.add_init_script(NOME)
    cel.goto(U + "#/comissao"); cel.wait_for_timeout(2200)
    tc = txt(cel)
    chk("celular: a tela abre com o mecânico e o serviço", "Carlos" in tc and "REVISAO GERAL" in tc, tc[:300])
    chk("celular: não rola para o lado", cel.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"),
        cel.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
    chk("celular: a linha do serviço empilha (2 colunas)", cel.evaluate("getComputedStyle(document.querySelector('.cm-linhas li')).gridTemplateColumns.split(' ').length") == 2,
        cel.evaluate("getComputedStyle(document.querySelector('.cm-linhas li')).gridTemplateColumns"))
    cel.screenshot(path=SAIDA + "/comissao-celular.png", full_page=True)
    chk("PC continua com 5 colunas na linha do serviço", pg.evaluate("getComputedStyle(document.querySelector('.cm-linhas li')).gridTemplateColumns.split(' ').length") == 5,
        pg.evaluate("getComputedStyle(document.querySelector('.cm-linhas li')).gridTemplateColumns"))
    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("erros de página:", erros or "nenhum")
sys.exit(1 if falhas or erros else 0)
