# Robô do e-mail (pedido do Danilo em 24/11/2026): tela que fica aberta no tablet da recepção conferindo a caixa.
# Confere: a lista com a categoria escrita, os anexos (se abrem e se já estão no sistema), o aviso curto no WhatsApp,
# o ligar/desligar que fica guardado no aparelho, e celular e PC.
# Uso: python3 teste/teste_robo_email.py
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8791", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
def txt(pg, sel="main"): return pg.inner_text(sel).replace("\xa0", " ")
U = "http://localhost:8791/"
# a caixa de mentira: contabilidade com XML de NF que JÁ está no sistema, boleto que ainda NÃO está, e um link que não baixa
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
    chk("explica que só olha e avisa", "não lança" in t and "não responde" in t, t[:400])
    chk("começa desligado e convida a ligar", "Ligar o robô" in t and "Desligado" in t, t[:400])
    pg.fill("#rb-tel", "27999990000")
    pg.click("button:has-text('Ligar o robô')"); pg.wait_for_timeout(3000)
    t = txt(pg)
    chk("lista os e-mails com a categoria escrita", "Importante" in t and "Útil" in t, t[:600])
    chk("mostra remetente e assunto", "Loredo Contabilidade" in t and "Guias do mês" in t, t[:600])
    chk("o anexo que é só link aparece como problema", "não dá para ler" in t or "não baixa" in t, t[:900])
    chk("a NF que já está no sistema aparece como conferida", "NF já no sistema" in t, t[:900])
    chk("o boleto que ainda não entrou aparece como pendência", "boleto falta lançar" in t, t[:900])
    chk("o cartão com pendência fica marcado", pg.locator(".rb-com-prob").count() >= 1)
    zaps = pg.evaluate("(window.__ZAP_ENVIOS || []).map(z => z.texto)")
    chk("manda o aviso curto no WhatsApp, no estilo pedido", any('e-mail de Loredo Contabilidade "' in z for z in zaps), zaps)
    chk("o aviso vai para o número digitado",
        all(z.get("telefone") == "27999990000" for z in pg.evaluate("window.__ZAP_ENVIOS || []")), pg.evaluate("window.__ZAP_ENVIOS || []"))
    chk("não reconfere o mesmo e-mail duas vezes",
        pg.evaluate("(window.__EMAIL_CHAMADAS || []).filter(a => a === 'anexo').length") == 3,
        pg.evaluate("window.__EMAIL_CHAMADAS || []"))
    pg.click("button:has-text('Conferir agora')"); pg.wait_for_timeout(1500)
    chk("conferir de novo não manda aviso repetido", len(pg.evaluate("window.__ZAP_ENVIOS || []")) == len(zaps), pg.evaluate("window.__ZAP_ENVIOS || []"))
    # desligar fica guardado no tablet
    pg.click("button:has-text('Desligar o robô')"); pg.wait_for_timeout(400)
    pg.reload(); pg.wait_for_timeout(2000)
    chk("ligado/desligado e telefone ficam guardados neste tablet",
        "Ligar o robô" in txt(pg) and pg.input_value("#rb-tel") == "27999990000", txt(pg)[:300])
    ctx.close()

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
