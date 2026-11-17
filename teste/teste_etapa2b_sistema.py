# Etapa 2-B do app no SISTEMA (16/11/2026 à noite): campo "Mecânico que vai mexer" no agendamento e o relatório
# "Serviços por colaborador (app)". Roda com o Supabase de mentira (teste/mock.js). Uso: python3 teste/teste_etapa2b_sistema.py
import subprocess, sys, time, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8771", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
falhas, oks = [], []
def chk(nome, cond, extra=""): (oks if cond else falhas).append(nome + ("" if cond else " :: " + str(extra)))
erros = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        for largura, nome in [(1366, "PC"), (390, "celular")]:
            ctx = b.new_context(viewport={"width": largura, "height": 800}); pg = ctx.new_page(); pg.on("pageerror", lambda e: erros.append(str(e)))
            pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
            # agenda: novo agendamento tem o campo do mecânico e grava mecanico_id/nome
            pg.goto("http://localhost:8771/#/agenda"); pg.wait_for_timeout(1200)
            pg.locator("button:has-text('Agendar')").first.click(); pg.wait_for_selector("#ag-mec", timeout=8000)
            opcoes = pg.locator("#ag-mec option").all_inner_texts(); chk(nome + ": agendamento tem 'Mecânico que vai mexer' com a equipe", "Ainda não definido" in opcoes[0] and any("Carlos" in o for o in opcoes), opcoes)
            pg.locator(".modal .seg button:has-text('Sem cadastro')").click(); pg.wait_for_timeout(200)
            pg.fill("#ag-nome", "Cliente Teste"); pg.select_option("#ag-mec", "p2"); pg.fill("#ag-serv", "Revisão"); pg.wait_for_timeout(100)
            pg.locator(".modal .btn-pri:has-text('Agendar')").click(); pg.wait_for_timeout(800)
            ag = pg.evaluate("(window.__DB.agendamentos || []).slice(-1)[0]")
            chk(nome + ": grava mecanico_id e mecanico_nome", ag and ag.get("mecanico_id") == "p2" and ag.get("mecanico_nome") == "Carlos Mecânico", ag)
            # relatório: Serviços por colaborador (app)
            pg.goto("http://localhost:8771/#/relatorios"); pg.wait_for_timeout(800)
            chk(nome + ": o hub lista 'Serviços por colaborador (app)'", pg.locator(".hub-cartao:has-text('Serviços por colaborador')").count() == 1)
            pg.goto("http://localhost:8771/#/relatorios?r=colaboradores"); pg.wait_for_selector(".tab-rel", timeout=8000); pg.wait_for_timeout(400); tx = pg.inner_text("main") if pg.locator("main").count() else pg.inner_text("body")
            chk(nome + ": relatório mostra o colaborador, a O.S., o tempo (descontando a pausa) e a indicação", "Carlos Mecânico" in tx and "Finalizado" in tx and "1h30" in tx and "ALINHAMENTO → Danilo" in tx, tx[-600:])
            pg.select_option("#rel-quem", "p1"); pg.wait_for_timeout(400); chk(nome + ": filtro por colaborador esvazia quando a pessoa não tem apontamento", "Nenhum serviço apontado" in (pg.inner_text("main") if pg.locator("main").count() else pg.inner_text("body")))
            if largura == 390: chk("celular: relatório sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth") <= 390)
            ctx.close()
        b.close()
finally:
    srv.terminate()
print("%d ok; %d falhas" % (len(oks), len(falhas)))
for f in falhas: print("FALHA:", f)
print("erros de página:", erros or "nenhum")
if falhas or erros: sys.exit(1)
