# Modo app do sistema (aberto de dentro do app do celular com ?app=1), com dados simulados (teste/mock.js):
# sem menu do computador, "‹ Início" volta ao app, telas novas (peça por catálogo e histórico) e a regra do Danilo:
# no app só o administrador altera O.S.; o consultor só consulta. Fora do app nada muda.
# Uso: python3 teste/teste_app_modo.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8769", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
BASE = "http://localhost:8769/"
def abrir(b, papel, url, larg=390, alt=800, apk=True):
    ctx = b.new_context(viewport={"width": larg, "height": alt}, is_mobile=larg < 700, has_touch=larg < 700)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e))); pg.on("dialog", lambda d: d.accept())
    pg.add_init_script("window.__PAPEL = %s;" % ("'" + papel + "'" if papel else "null"))
    if apk: pg.add_init_script("window.__voltar = null; window.__hist = []; window.Capacitor = { Plugins: { App: { addListener: (ev, fn) => { if (ev === 'backButton') window.__voltar = fn; return Promise.resolve({ remove(){} }); } } } };")  # dentro do APK existe window.Capacitor (plugin App de mentira)
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.goto(url); pg.wait_for_timeout(2000)
    return ctx, pg
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    # 1) modo app: casca do sistema
    ctx, pg = abrir(b, None, BASE + "?app=1#/oleo-filtros")
    chk("body ganha a marca modo-app", pg.evaluate("document.body.classList.contains('modo-app')"))
    chk("barra de baixo escondida", not pg.is_visible(".nav"))
    chk("menu do computador escondido", not pg.is_visible(".lateral"))
    chk("aparece ‹ Início", pg.is_visible(".app-voltar"))
    chk("tela de óleo abre", pg.is_visible("#of-q"))
    chk("sem barra de busca do computador", pg.locator(".barra-topo, .bt-busca").count() == 0 or not pg.is_visible(".barra-topo"))
    chk("sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth") <= 392, pg.evaluate("document.documentElement.scrollWidth"))
    pg.goto(BASE + "#/pecas"); pg.wait_for_selector("#pc-placa", timeout=15000)
    chk("rota de peças por catálogo abre", pg.is_visible("#pc-placa") and pg.is_visible("text=Peças por catálogo"))
    pg.fill("#pc-placa", "ABC1D23"); pg.wait_for_timeout(1200)
    chk("placa do cadastro é reconhecida (sem consulta paga)", "do cadastro" in pg.inner_text("#pc-faixa") and "Fiat" in pg.inner_text("#pc-faixa"), pg.inner_text("#pc-faixa") if pg.locator("#pc-faixa").count() else "sem faixa")
    pg.goto(BASE + "#/historico"); pg.wait_for_selector("#hs-q", timeout=15000)
    chk("histórico pede a busca", pg.is_visible("#hs-q"))
    pg.fill("#hs-q", "ABC1D23"); pg.wait_for_timeout(500)
    n = pg.locator(".hs-linha").count(); chk("histórico lista as O.S. da placa", n >= 2, n)
    pg.locator(".hs-linha").first.click(); pg.wait_for_timeout(800)
    chk("tocar numa O.S. do histórico abre a O.S.", "#/os/" in pg.url, pg.url)
    pg.click(".app-voltar"); pg.wait_for_timeout(700)
    chk("‹ Início volta para a tela de botões do app", pg.url.endswith("/app/index.html") or "/app/" in pg.url, pg.url)
    ctx.close()
    # 2) administrador no app altera; consultor no app só consulta; consultor fora do app altera (nada mudou)
    def acoes_os(papel, url):
        ctx, pg = abrir(b, papel, url); txt = pg.inner_text("body"); ctx.close(); return txt
    adm = acoes_os(None, BASE + "?app=1#/os/o3")
    chk("admin no app vê as ações da O.S. (Receber e fechar)", "Receber e fechar" in adm or "Entregar e fechar" in adm, adm[:200])
    con = acoes_os("consultor", BASE + "?app=1#/os/o3")
    chk("consultor no app NÃO vê ações de alterar a O.S.", not any(t in con for t in ["Receber e fechar", "Entregar e fechar", "Entregar sem receber", "Serviço concluído", "Aprovar"]), con[:300])
    fora = acoes_os("consultor", BASE + "#/os/o3")
    chk("consultor FORA do app continua alterando (regra normal)", "Receber e fechar" in fora or "Entregar e fechar" in fora, fora[:200])
    # lista de O.S.: consultor no app sem botões de avançar / receber
    def menu_lista(papel, url):
        ctx, pg = abrir(b, papel, url); pg.locator("button[aria-label='Mais opções da OS 01897']").first.click(); pg.wait_for_timeout(300)
        itens = pg.locator("[role=menuitem]").all_inner_texts(); ctx.close(); return itens
    m_adm = menu_lista(None, BASE + "?app=1#/ordens?filtro=todas")
    chk("admin no app: menu da O.S. na lista tem Cancelar O.S.", "Cancelar O.S." in m_adm, m_adm)
    m_con = menu_lista("consultor", BASE + "?app=1#/ordens?filtro=todas")
    chk("consultor no app: menu da O.S. na lista sem Cancelar nem avanço, só consulta", "Cancelar O.S." not in m_con and "Abrir O.S." in m_con and "Imprimir O.S." in m_con, m_con)
    m_fora = menu_lista("consultor", BASE + "#/ordens?filtro=todas")
    chk("consultor FORA do app: menu da lista como antes (Cancelar O.S.)", "Cancelar O.S." in m_fora, m_fora)
    # 3) orçamento e agenda continuam disponíveis para o consultor no app
    ctx, pg = abrir(b, "consultor", BASE + "?app=1#/orcamento/novo"); chk("consultor abre novo orçamento no app", pg.locator("input, textarea").count() > 2); ctx.close()
    ctx, pg = abrir(b, "consultor", BASE + "?app=1#/agenda"); chk("consultor abre a agenda no app", pg.is_visible("text=Agenda") or pg.locator(".card").count() > 0); ctx.close()
    ctx, pg = abrir(b, "consultor", BASE + "?app=1#/entrada"); chk("consultor abre Nova O.S. no app", pg.locator("input").count() > 2); ctx.close()
    # link com ?app=1 aberto num navegador comum (sem o APK): não entra no modo app
    ctx, pg = abrir(b, "consultor", BASE + "?app=1#/os/o3", apk=False)
    chk("?app=1 fora do APK é ignorado", not pg.evaluate("document.body.classList.contains('modo-app')") and ("Receber e fechar" in pg.inner_text("body") or "Entregar e fechar" in pg.inner_text("body"))); ctx.close()
    # O.S. em execução: consultor no app não troca o técnico nem põe foto; admin sim
    ctx, pg = abrir(b, "consultor", BASE + "?app=1#/os/o2")
    chk("consultor no app: técnico da O.S. em execução travado", pg.locator("#mec").is_disabled())
    chk("consultor no app: sem + Foto na O.S. em execução", pg.locator("label[for=foto-exec]").count() == 0); ctx.close()
    ctx, pg = abrir(b, None, BASE + "?app=1#/os/o2")
    chk("admin no app: técnico liberado na O.S. em execução", not pg.locator("#mec").is_disabled()); ctx.close()
    ctx, pg = abrir(b, "consultor", BASE + "#/os/o2", apk=False)
    chk("consultor fora do app: técnico liberado como antes", not pg.locator("#mec").is_disabled()); ctx.close()
    # botão Voltar do celular dentro do sistema aberto pelo app: volta uma página; sem página atrás, volta aos botões do app
    ctx, pg = abrir(b, None, BASE + "?app=1#/oleo-filtros")
    chk("modo app registra o botão Voltar", pg.evaluate("typeof window.__voltar") == "function")
    pg.evaluate("location.hash = '#/pecas'"); pg.wait_for_selector("#pc-placa", timeout=15000)  # como no sistema: troca de tela pelo hash
    pg.evaluate("window.__voltar()"); pg.wait_for_timeout(700)
    chk("Voltar com página atrás volta uma página (óleo)", "#/oleo-filtros" in pg.url, pg.url)
    ctx.close()
    ctx2 = b.new_context(viewport={"width": 390, "height": 800}, is_mobile=True, has_touch=True); pg2 = ctx2.new_page()
    pg2.add_init_script("window.__PAPEL = null;"); pg2.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg2.add_init_script("window.__voltar = null; window.Capacitor = { Plugins: { App: { addListener: (ev, fn) => { if (ev === 'backButton') window.__voltar = fn; return Promise.resolve({ remove(){} }); } } } }; Object.defineProperty(window.history, 'length', { get: () => 1 });")
    pg2.goto(BASE + "?app=1#/oleo-filtros"); pg2.wait_for_timeout(2000); pg2.evaluate("window.__voltar()"); pg2.wait_for_timeout(700)
    chk("Voltar sem página atrás volta aos botões do app", pg2.url.endswith("/app/index.html"), pg2.url); ctx2.close()
    # entrou pelos botões do app (?app=1) e ainda não navegou: Voltar volta aos botões mesmo com histórico na aba
    ctx, pg = abrir(b, None, BASE + "?app=1#/oleo-filtros"); pg.evaluate("window.__voltar()"); pg.wait_for_timeout(700)
    chk("Voltar logo ao abrir a tela do sistema volta aos botões do app", pg.url.endswith("/app/index.html"), pg.url); ctx.close()
    # 4) fora do app (PC): tudo como antes
    ctx, pg = abrir(b, None, BASE + "#/painel", 1366, 768)
    chk("PC: sem a marca modo-app", not pg.evaluate("document.body.classList.contains('modo-app')"))
    chk("PC: menu lateral visível", pg.is_visible(".lateral"))
    chk("PC: sem botão ‹ Início", pg.locator(".app-voltar").count() == 0); ctx.close()
    ctx, pg = abrir(b, None, BASE + "#/painel")
    chk("celular normal: barra de baixo visível e sem ‹ Início", pg.is_visible(".nav") and pg.locator(".app-voltar").count() == 0); ctx.close()
    b.close()
finally:
    srv.terminate()
print(len(ok), "ok;", len(falhas), "falhas")
for f in falhas: print("FALHA:", f)
for e in erros: print(e)
sys.exit(1 if falhas or erros else 0)
