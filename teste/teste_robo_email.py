# Robô do e-mail (pedido do Danilo em 24/11/2026): quem roda é o MOTOR DO TABLET, o mesmo do WhatsApp.
# Esta tela é só o painel: mostra o que o robô achou (email_robo, v64), liga/desliga e confere na hora.
# Uso: python3 teste/teste_robo_email.py
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8791", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
def txt(pg, sel="main"): return pg.inner_text(sel).replace("\xa0", " ")
U = "http://localhost:8791/"
# caixa de mentira: contabilidade com boleto que ainda NAO esta no sistema e um link que nao baixa; NF que JA esta
SEMEAR = """
window.__EMAIL_CAIXA = [
  { id: "m1", data: new Date().toISOString(), de: { nome: "Loredo Contabilidade", email: "dploredocontabilidade@gmail.com" },
    assunto: "Guias do mês", previa: "Seguem as guias.", lido: false, categoria: "importante", filtro: "ler",
    anexos: [{ id: "a1", nome: "DAS-11-2026.pdf", tamanho_kb: 120 }, { id: "a2", nome: "link.html", tamanho_kb: 0 }] },
  { id: "m2", data: new Date().toISOString(), de: { nome: "Auto Peças", email: "nf@autopecas.com.br" },
    assunto: "NF-e 1234", previa: "Segue XML.", lido: false, categoria: "util", filtro: "ler",
    anexos: [{ id: "a3", nome: "nfe.xml", tamanho_kb: 8 }] }
];
window.__EMAIL_ANEXOS = {
  a1: { nome: "DAS-11-2026.pdf", tamanho_kb: 120, texto: "DAS", boletos: [{ linha: "85800000046", codigo_barras: "858000000460", valor: 460, vencimento: "2026-12-20" }] },
  a2: { nome: "link.html", conteudo: "Este anexo não é um arquivo (é um e-mail ou link anexado): não dá para ler por aqui." },
  a3: { nome: "nfe.xml", tamanho_kb: 8, texto: "<xml/>", nfe: { chave: "35260112345678000199550010000012341000012340" } }
};
window.__DB.notas_entrada = [{ id: "ne1", chave: "35260112345678000199550010000012341000012340", numero: "1234" }];
"""
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 1366, "height": 768}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.add_init_script(SEMEAR)
    pg.goto(U + "#/robo"); pg.wait_for_timeout(2200)
    t = txt(pg)
    chk("abre a tela do robô pelas abas de WhatsApp e e-mail", "Robô do e-mail" in t, t[:300])
    chk("diz que quem roda é o programa do tablet, sem depender da tela",
        "programa do tablet" in t and "tela" in t and "apagada" in t, t[:600])
    chk("explica que só olha e avisa", "não lança" in t and "não responde" in t, t[:600])
    chk("começa desligado", "Ligar o robô" in t and "Desligado" in t, t[:400])
    chk("diz para onde vai o aviso", "número de alerta" in t, t[:700])
    # ligar grava nos ajustes (é daí que o motor do tablet obedece)
    pg.click("button:has-text('Ligar o robô')"); pg.wait_for_timeout(1200)
    chk("ligar grava a chave nos ajustes, que é o que o motor lê",
        pg.evaluate("((window.__DB.config || {}).roboEmail || {}).ligado") == True,
        pg.evaluate("(window.__DB.config || {}).roboEmail"))
    chk("a tela passa a dizer que o tablet está conferindo", "a cada 5 minutos" in txt(pg), txt(pg)[:500])
    # conferir agora: o mesmo ciclo que o motor faz
    pg.click("#rb-agora"); pg.wait_for_timeout(2000)
    t = txt(pg)
    chk("lista os e-mails com a categoria escrita", "Importante" in t and "Útil" in t, t[:800])
    chk("mostra remetente e assunto", "Loredo Contabilidade" in t and "Guias do mês" in t, t[:800])
    chk("o anexo que é só link aparece como problema", "não dá para ler" in t or "não baixa" in t, t[:1200])
    chk("a NF que já está no sistema aparece como conferida", "NF já no sistema" in t, t[:1200])
    chk("o boleto que ainda não entrou aparece como pendência", "boleto falta lançar" in t, t[:1200])
    chk("o cartão com pendência fica marcado", pg.locator(".rb-com-prob").count() >= 1)
    al = pg.evaluate("window.__ZAP_ALERTAS || []")
    chk("manda o aviso curto no WhatsApp, no estilo pedido",
        any('e-mail de Loredo Contabilidade "' in z for z in al), al)
    chk("não confere nem avisa o mesmo e-mail duas vezes",
        pg.evaluate("(window.__DB.email_robo || []).length") == 2 and len(al) == 2, al)
    pg.click("#rb-agora"); pg.wait_for_timeout(1500)
    chk("conferir de novo não repete nada", len(pg.evaluate("window.__ZAP_ALERTAS || []")) == 2,
        pg.evaluate("window.__ZAP_ALERTAS || []"))
    ctx.close()

    # sem o v64 no banco a tela avisa e não quebra
    c2 = b.new_context(viewport={"width": 1366, "height": 768}); p2 = c2.new_page()
    p2.on("pageerror", lambda e: erros.append("PAGEERR semv64 " + str(e)))
    p2.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); p2.add_init_script(SEMEAR)
    p2.add_init_script("window.__SEM_V64 = true;")
    p2.goto(U + "#/robo"); p2.wait_for_timeout(2000)
    chk("sem o v64 a tela manda rodar o SQL e trava os botões",
        "v64.sql" in txt(p2) and p2.locator("#rb-agora").is_disabled(), txt(p2)[:400])
    c2.close()

    cel = b.new_context(viewport={"width": 390, "height": 780}); pc = cel.new_page()
    pc.on("pageerror", lambda e: erros.append("PAGEERR cel " + str(e)))
    pc.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pc.add_init_script(SEMEAR)
    pc.goto(U + "#/robo"); pc.wait_for_timeout(2200)
    chk("no celular a tela abre e não vaza para os lados",
        pc.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1")
        and "Robô do e-mail" in txt(pc), txt(pc)[:200])
    cel.close(); b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("erros de página:", erros or "nenhum")
sys.exit(1 if falhas or erros else 0)
