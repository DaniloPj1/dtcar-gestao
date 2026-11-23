# O Painel e o Painel Financeiro leem a MESMA fonte (js/numeros.js). Este teste trava isso:
# os números que aparecem no Painel têm de ser idênticos aos da tela do Painel Financeiro.
# Sem banco real: Supabase de mentira (teste/mock.js).
import re, subprocess, sys, threading, http.server, functools, socketserver
from playwright.sync_api import sync_playwright

RAIZ = "/home/claude/dtcar-gestao"
ok, falhas = 0, []
def chk(nome, cond, extra=""):
    global ok
    if cond: ok += 1; print("OK ", nome)
    else: falhas.append(nome); print("FALHA", nome, extra)

class Quieto(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def numeros(txt):
    return [x.replace(".", "").replace(",", ".") for x in re.findall(r"R\$[\s\u00a0]?-?[\d.]+,\d{2}", txt)]

socketserver.TCPServer.allow_reuse_address = True
srv = socketserver.TCPServer(("127.0.0.1", 8769), functools.partial(Quieto, directory=RAIZ))
threading.Thread(target=srv.serve_forever, daemon=True).start()
U = "http://127.0.0.1:8769/index.html"
with sync_playwright() as p:
    nav = p.chromium.launch()
    pg = nav.new_page(viewport={"width": 1680, "height": 1200})
    erros = []
    pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.add_init_script(open(RAIZ + "/teste/mock.js").read())

    pg.goto(U + "#/painel"); pg.wait_for_timeout(2500)
    txt = pg.inner_text("main").lower()   # as faixas aparecem em caixa alta pelo CSS
    chk("painel: as faixas de dinheiro estão na tela",
        all(t in txt for t in ["resultado do mês", "fluxo de caixa", "análise no período", "para onde foi o dinheiro"]))
    chk("painel: os três quadros de gasto aparecem lado a lado",
        all(t in txt for t in ["categorias de gasto", "gastos por subcategoria", "gasto com peças por fornecedor"]))
    pain = pg.inner_text(".j-resultado") + "\n" + pg.inner_text(".j-caixames")

    pg.goto(U + "#/painel-financeiro"); pg.wait_for_timeout(2500)
    fin = pg.inner_text("main")

    # faturamento, custo, margem, entradas, saídas e saldo do mês: os mesmos valores nas duas telas
    for rot in ["Faturamento", "Custo de peças e terceiros", "Margem bruta", "Entradas no mês", "Saídas no mês", "Saldo no mês"]:
        a = re.search(re.escape(rot).replace(r"\ ", r"\s") + r"[\s\n+]*(R\$[\s\u00a0]?-?[\d.]+,\d{2})", pain)
        b = re.search(re.escape(rot) + r"[\s\n+]*(R\$[\s\u00a0]?-?[\d.]+,\d{2})", fin)
        chk("mesmo número nas duas telas: " + rot, a and b and a.group(1).replace("+", "").replace("\u00a0", " ").strip() == b.group(1).replace("+", "").replace("\u00a0", " ").strip(),
            (a.group(1) if a else "painel?") + " x " + (b.group(1) if b else "financeiro?"))

    # o tamanho da tela é escolha do dono e fica guardada no aparelho
    pg.goto(U + "#/painel"); pg.wait_for_timeout(1500)
    pg.click(".tam-tela button:has-text('Compacto')"); pg.wait_for_timeout(400)
    chk("tamanho: compacto aperta a página", pg.evaluate("document.documentElement.dataset.tela") == "compacto")
    largura = pg.evaluate("document.querySelector('.pagina').getBoundingClientRect().width")
    pg.click(".tam-tela button:has-text('Largo')"); pg.wait_for_timeout(400)
    chk("tamanho: largo abre a página", pg.evaluate("document.querySelector('.pagina').getBoundingClientRect().width") > largura)
    pg.reload(); pg.wait_for_timeout(1800)
    chk("tamanho: a escolha fica guardada no aparelho", pg.evaluate("document.documentElement.dataset.tela") == "largo")

    # celular: nada disso muda o aparelho pequeno
    cel = nav.new_page(viewport={"width": 390, "height": 840})
    cel.add_init_script(open(RAIZ + "/teste/mock.js").read())
    cel.goto(U + "#/painel"); cel.wait_for_timeout(2000)
    chk("celular: o filtro de tamanho não aparece", cel.evaluate("getComputedStyle(document.querySelector('.tam-tela')).display") == "none")
    chk("celular: os blocos de dinheiro ficam um embaixo do outro",
        cel.evaluate("(() => { const g = document.querySelector('.pn-g4'); return !g || g.getBoundingClientRect().width < 420; })()"))
    cel.close(); pg.close(); nav.close()
srv.shutdown()
print(f"\n{ok} OK, {len(falhas)} falha(s), {len(erros)} erro(s) de página")
if falhas or erros: print("FALHAS", falhas, erros); sys.exit(1)
