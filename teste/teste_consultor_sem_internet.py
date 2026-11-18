# Consultor responsável da Nova O.S. com e sem internet (dados simulados em teste/mock.js).
# Sem internet o sistema entra com a sessão do PC e a lista de perfis do servidor vem vazia: quem está logado,
# sendo administrador ou consultor, tem de continuar aparecendo (e já marcado) no campo do consultor.
# Uso: python3 teste/teste_consultor_sem_internet.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))

U = "http://localhost:8766/"
CAMPO = ".campo:has-text('Consultor responsável')"

def abrir(pg, quem=None, perfis_vazios=False, largura=1600):
  """Abre a Nova O.S. com o login ('p2' = Carlos Mecânico) e a situação da lista de perfis pedidos."""
  pg.set_viewport_size({"width": largura, "height": 950})
  pg.add_init_script("window.__PERFIL_ID = %s; window.__PERFIS_VAZIOS = %s;" % (
    ("'" + quem + "'") if quem else "null", "true" if perfis_vazios else "false"))
  pg.goto(U + "#/entrada"); pg.wait_for_timeout(2200)

def marcado(pg):
  """Nome do consultor que está marcado no campo, ou '' quando nenhum está."""
  b = pg.query_selector(CAMPO + " .seg button[aria-pressed='true']")
  return b.inner_text().strip() if b else ""

def erros_ao_abrir(pg):
  """Lista de erros que a tela mostra ao tentar abrir a O.S. com o formulário vazio."""
  pg.click(".rodape-acoes .btn-pri"); pg.wait_for_timeout(700)
  cx = pg.query_selector(".erros")
  return cx.inner_text() if cx else ""

try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    def nova_pagina():
      ctx = b.new_context(viewport={"width": 1600, "height": 950}); pg = ctx.new_page()
      pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
      pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
      return ctx, pg

    # 1) Com internet, administrador: o próprio nome já vem marcado (como sempre foi)
    ctx, pg = nova_pagina(); abrir(pg)
    chk("com internet: o consultor já vem marcado com o nome de quem entrou", marcado(pg) == "Danilo", marcado(pg))
    chk("com internet: não pede consultor", "Selecione o consultor responsável." not in erros_ao_abrir(pg))
    pg.screenshot(path=SAIDA + "/consultor-com-internet.png"); ctx.close()

    # 2) SEM INTERNET (lista de perfis vazia), administrador: continua marcado — é a correção
    ctx, pg = nova_pagina(); abrir(pg, perfis_vazios=True)
    chk("sem internet: o administrador aparece no campo do consultor", marcado(pg) == "Danilo", marcado(pg))
    chk("sem internet: a tela não mostra 'Nenhum consultor liberado'", "Nenhum consultor liberado" not in pg.inner_text(CAMPO))
    chk("sem internet: não pede consultor", "Selecione o consultor responsável." not in erros_ao_abrir(pg))
    pg.screenshot(path=SAIDA + "/consultor-sem-internet.png"); ctx.close()

    # 3) SEM INTERNET no celular: mesma coisa (telas independentes)
    ctx, pg = nova_pagina(); abrir(pg, perfis_vazios=True, largura=390)
    chk("celular, sem internet: o administrador aparece no campo do consultor", marcado(pg) == "Danilo", marcado(pg))
    pg.screenshot(path=SAIDA + "/consultor-sem-internet-celular.png"); ctx.close()

    # 4) Com internet, mecânico: a regra continua — ele escolhe o consultor da lista
    ctx, pg = nova_pagina(); abrir(pg, quem="p2")
    chk("mecânico: o consultor da oficina aparece para escolher", "Danilo" in pg.inner_text(CAMPO), pg.inner_text(CAMPO))
    chk("mecânico: nada vem marcado sozinho", marcado(pg) == "", marcado(pg))
    chk("mecânico: a tela pede o consultor", "Selecione o consultor responsável." in erros_ao_abrir(pg))
    ctx.close()

    # 5) SEM INTERNET, mecânico: ninguém para escolher — a O.S. não pode ficar travada
    ctx, pg = nova_pagina(); abrir(pg, quem="p2", perfis_vazios=True)
    chk("mecânico sem internet: avisa que não há consultor liberado", "Nenhum consultor liberado" in pg.inner_text(CAMPO))
    e = erros_ao_abrir(pg)
    chk("mecânico sem internet: a abertura não trava no consultor", "Selecione o consultor responsável." not in e, e)
    chk("mecânico sem internet: os outros avisos continuam", "placa" in e.lower(), e)
    ctx.close()

    b.close()
finally:
  srv.terminate()

print("\n".join("  ok  " + x for x in ok))
if erros: print("\n".join("ERRO NA PÁGINA: " + x for x in erros))
if falhas or erros:
  print("\n".join("FALHOU " + x for x in falhas)); print("\n%d passaram, %d falharam" % (len(ok), len(falhas) + len(erros))); sys.exit(1)
print("\n%d verificações, todas passaram" % len(ok))
