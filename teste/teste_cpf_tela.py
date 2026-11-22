# Consulta do cliente pelo CPF (função "cpf", API CPF) nas telas, com dados simulados (teste/mock.js):
# Nova O.S. (cliente novo), cadastro de cliente, Ajustes, e os casos de consulta desligada, sem crédito, limite,
# CPF já cadastrado, CNPJ e quem não é administrador. Regra do Danilo: só consulta quando o sistema ainda não tem os dados.
# Uso: python3 teste/teste_cpf_tela.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8774", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
U = "http://localhost:8774/"
CPF = "529.982.247-25"; CPF2 = "390.533.447-05"; FORA = "111.444.777-35"
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    def pagina(largura=1400, altura=950, antes=""):
      ctx = b.new_context(viewport={"width": largura, "height": altura}); pg = ctx.new_page()
      pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
      if antes: pg.add_init_script(antes)
      pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
      return pg
    pg = pagina()
    ch = lambda: pg.evaluate("((window.__CPF || {}).chamadas || []).filter(c => c.acao !== 'situacao')")
    val = lambda sel: pg.input_value(sel)
    def zera(): pg.evaluate("window.__CPF = { chamadas: [] }")
    def nova_os(q=None):
      q = q or pg
      q.evaluate("localStorage.removeItem('dtcar-nova-os-v1')"); q.goto(U + "#/painel"); q.wait_for_timeout(300)
      q.evaluate("localStorage.removeItem('dtcar-nova-os-v1')"); q.goto(U + "#/entrada"); q.wait_for_timeout(1500)
      q.fill("#placa", "ABC1D23"); q.wait_for_timeout(700)   # veículo do cadastro, com cliente
      q.click("button:has-text('Trocar')"); q.wait_for_timeout(300)
      q.click("button:has-text('Novo cliente')"); q.wait_for_timeout(300)

    # ================= Nova O.S.: cliente novo =================
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(2500)
    nova_os()
    chk("Nova O.S.: aba Novo cliente abriu", pg.query_selector("#c-doc") is not None and pg.query_selector("#c-nome") is not None)
    pg.fill("#c-doc", "529.982.247"); pg.wait_for_timeout(900)
    chk("CPF incompleto: não consulta", len(ch()) == 0)
    pg.fill("#c-doc", "529.982.247-26"); pg.wait_for_timeout(900)
    chk("CPF com dígito errado: não consulta", len(ch()) == 0)
    pg.fill("#c-doc", CPF); pg.wait_for_timeout(1500)
    c = ch()
    chk("CPF novo e nome em branco: uma consulta", len(c) == 1 and c[0]["acao"] == "consultar" and c[0]["cpf"] == "52998224725", c)
    chk("preencheu o nome", val("#c-nome") == "MARIA APARECIDA DE SOUZA", val("#c-nome"))
    chk("aviso de nome preenchido", "Nome preenchido pelo CPF" in pg.inner_text("main, body"))
    pg.screenshot(path=SAIDA + "/cpf-1-nova-os.png")
    # trocar o CPF tira o nome que veio do antigo e busca o novo
    pg.evaluate("window.__CPF.dados = { nome: 'JOSE CARLOS PEREIRA', nascimento: '1979-03-02' }")
    pg.fill("#c-doc", CPF2); pg.wait_for_timeout(1500)
    chk("CPF trocado: sai o nome do antigo e entra o do novo", val("#c-nome") == "JOSE CARLOS PEREIRA" and len(ch()) == 2, [val("#c-nome"), ch()])
    # nome digitado nunca é trocado
    nova_os(); zera()
    pg.fill("#c-nome", "Fulano Digitado"); pg.fill("#c-doc", CPF); pg.wait_for_timeout(1500)
    chk("REGRA: nome já digitado não consulta nem é trocado", len(ch()) == 0 and val("#c-nome") == "Fulano Digitado", ch())
    # o mesmo CPF não chama a função duas vezes com o programa aberto
    nova_os(); zera()
    pg.fill("#c-doc", CPF2); pg.wait_for_timeout(1500)
    chk("mesmo CPF de novo: responde do que já veio, sem nova chamada", len(ch()) == 0 and val("#c-nome") == "JOSE CARLOS PEREIRA", [ch(), val("#c-nome")])
    # CPF que a consulta não acha
    nova_os(); zera()
    pg.fill("#c-doc", FORA); pg.wait_for_timeout(1500)
    chk("CPF não encontrado: avisa e deixa preencher à mão", len(ch()) == 1 and val("#c-nome") == "" and "não achou este CPF" in pg.inner_text("body"))
    # CNPJ nunca consulta
    nova_os(); zera()
    pg.fill("#c-doc", "27.462.217/0003-31"); pg.wait_for_timeout(1200)
    chk("CNPJ: não consulta", len(ch()) == 0)
    # desligada: quieta na busca sozinha, com botão que diz o motivo
    nova_os(); pg.evaluate("window.__CPF = { chamadas: [], situacao: 'desligada' }")
    pg.fill("#c-doc", "153.509.460-56"); pg.wait_for_timeout(1500)
    chk("consulta desligada: tela segue como sempre, sem aviso de erro, com o botão", "Não deu para buscar" not in pg.inner_text("body") and pg.query_selector(".cpf-buscar") is not None and val("#c-nome") == "")
    pg.click(".cpf-buscar"); pg.wait_for_timeout(600)
    chk("pelo botão, diz o motivo", "ainda não foi ligada" in pg.inner_text("body"))
    pg.reload(); pg.wait_for_timeout(2000)   # programa reaberto: acaba a pausa de 5 minutos da busca sozinha
    # botão clicado com um CPF e o CPF trocado antes de a resposta chegar: o nome do primeiro não pode entrar no segundo
    pg.evaluate("window.__CPF = { chamadas: [], situacao: 'semresposta' }"); nova_os(); pg.evaluate("window.__CPF = { chamadas: [], situacao: 'semresposta' }")
    pg.fill("#c-doc", "135.792.468-28"); pg.wait_for_timeout(1300)
    if pg.query_selector(".cpf-buscar"):
      pg.evaluate("window.__CPF = { chamadas: [], demora: 1500 }"); pg.click(".cpf-buscar"); pg.wait_for_timeout(200)
      pg.fill("#c-doc", "246.813.579-28"); pg.wait_for_timeout(2600)
      chk("CPF trocado enquanto a resposta vinha: o nome do CPF antigo não entra", val("#c-nome") == "" and "Nome preenchido" not in pg.inner_text("body"), val("#c-nome"))
    else: chk("botão de buscar apareceu para o teste da troca no meio", False)
    pg.reload(); pg.wait_for_timeout(2000)
    # sem crédito
    nova_os(); pg.evaluate("window.__CPF = { chamadas: [], situacao: 'creditos' }")
    pg.fill("#c-doc", "862.883.667-57"); pg.wait_for_timeout(1500)
    chk("sem crédito da busca externa: avisa e deixa preencher à mão", "créditos da busca externa acabaram" in pg.inner_text("body") and val("#c-nome") == "")
    # o nascimento vai para o cadastro do cliente novo
    nova_os(); zera()
    pg.fill("#c-doc", "714.287.938-60"); pg.wait_for_timeout(1500)
    pg.fill("#c-tel", "27988887777"); pg.fill("#km", "45000"); pg.fill("#recl", "Barulho na suspensão")
    pg.click("button.btn-pri:has-text('Abrir O.S.')"); pg.wait_for_timeout(800)
    for _ in range(3):   # o veículo de teste já tem O.S. aberta e outro dono: a tela pergunta antes
      bt = pg.query_selector(".modal button.btn-pri, .modal button.btn-perigo")
      if not bt: break
      bt.click(); pg.wait_for_timeout(800)
    pg.wait_for_timeout(1200)
    cl = pg.evaluate("window.__DB.clientes.find(c => c.doc === '71428793860')")
    chk("Nova O.S.: cliente novo gravado com o nome e o nascimento da consulta", bool(cl) and cl["nome"] == "MARIA APARECIDA DE SOUZA" and cl.get("nascimento") == "1985-07-15",
        cl or (pg.inner_text(".erros") if pg.query_selector(".erros") else pg.evaluate("JSON.stringify(window.__DB.clientes.slice(-2)) + ' | ' + location.hash + ' | ' + document.body.innerText.slice(0, 300)")))
    # CPF que já está no cadastro: não consulta (a tela já avisa que o cliente existe)
    nova_os(); zera()
    pg.fill("#c-doc", "714.287.938-60"); pg.wait_for_timeout(1300)
    chk("REGRA: CPF que já está no cadastro não consulta", len(ch()) == 0 and val("#c-nome") == "", ch())

    # ================= cadastro de cliente =================
    zera()
    pg.goto(U + "#/cadastros?aba=clientes"); pg.wait_for_timeout(1500)
    pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(500)
    pg.click(".modal button:has-text('Documentos, filiação e crédito')"); pg.wait_for_timeout(300)
    pg.fill("#c-doc", "987.654.321-00"); pg.wait_for_timeout(1500)
    chk("cadastro: CPF novo preenche nome e data de nascimento", len(ch()) == 1 and val("#c-nome") == "MARIA APARECIDA DE SOUZA" and val("#c-nasc") == "1985-07-15", [ch(), val("#c-nome"), val("#c-nasc")])
    chk("cadastro: aviso junto do campo", "Nome preenchido pelo CPF" in pg.inner_text(".modal"))
    pg.screenshot(path=SAIDA + "/cpf-2-cadastro.png")
    pg.evaluate("window.__CPF.dados = { nome: 'ANA PAULA LIMA', nascimento: '' }")
    pg.fill("#c-doc", "168.995.350-09"); pg.wait_for_timeout(1500)
    chk("cadastro: CPF trocado troca o nome e tira o nascimento do antigo", val("#c-nome") == "ANA PAULA LIMA" and val("#c-nasc") == "", [val("#c-nome"), val("#c-nasc")])
    pg.fill("#c-nome", "Nome Que Eu Digitei"); pg.evaluate("window.__CPF.dados = null")
    pg.fill("#c-doc", "529.982.247-25"); pg.wait_for_timeout(1300)
    chk("cadastro: com nome digitado, trocar o CPF não consulta nem mexe no nome", val("#c-nome") == "Nome Que Eu Digitei")

    # ================= Ajustes =================
    pg.goto(U + "#/ajustes?aba=consultas"); pg.wait_for_timeout(1800)
    cart = pg.query_selector("#cartao-cpf")
    chk("Ajustes: cartão da consulta pelo CPF, ligada", cart is not None and "Ligada" in cart.inner_text() and "Só o administrador" in cart.inner_text())
    # cadastro da chave (a do plano grátis vence todo mês)
    chk("Ajustes: campo da chave escondido como senha e botão parado sem chave", pg.get_attribute("#cpf-chave", "type") == "password" and pg.is_disabled("#cpf-gravar-chave"))
    pg.fill("#cpf-chave", "curta"); pg.click("#cpf-gravar-chave"); pg.wait_for_timeout(300)
    chk("Ajustes: chave mal colada não é enviada", "Cole a chave inteira" in pg.inner_text("#cartao-cpf") and not any(c["acao"] == "gravar_chave" for c in pg.evaluate("window.__CPF.chamadas")))
    pg.fill("#cpf-chave", "chave-vencida-0000000"); pg.click("#cpf-gravar-chave"); pg.wait_for_timeout(500)
    chk("Ajustes: chave vencida é recusada com o motivo e continua no campo", "está vencida" in pg.inner_text("#cartao-cpf") and val("#cpf-chave") == "chave-vencida-0000000")
    pg.fill("#cpf-chave", "  chave-nova-renovada-123456 "); pg.click("#cpf-gravar-chave"); pg.wait_for_timeout(600)
    g = [c for c in pg.evaluate("window.__CPF.chamadas") if c["acao"] == "gravar_chave"]
    chk("Ajustes: chave nova gravada, campo limpo e data mostrada", g[-1]["chave"] == "chave-nova-renovada-123456" and val("#cpf-chave") == "" and "Chave gravada e aceita" in pg.inner_text("#cartao-cpf")
        and "Chave cadastrada em 15/11/2026" in pg.inner_text("#cpf-chave-em"), pg.inner_text("#cartao-cpf")[:300])
    chk("Ajustes: a chave não fica escrita na tela", "chave-nova-renovada" not in pg.content())
    pg.query_selector("#cartao-cpf").scroll_into_view_if_needed(); pg.screenshot(path=SAIDA + "/cpf-3-ajustes.png")
    # chave vencida: o administrador é avisado na hora, na própria tela do cliente
    nova_os(); pg.evaluate("window.__CPF = { chamadas: [], situacao: 'vencida' }")
    pg.fill("#c-doc", "248.135.790-60"); pg.wait_for_timeout(1500)
    chk("chave vencida: avisa na Nova O.S. e manda cadastrar em Ajustes", "chave da API CPF venceu" in pg.inner_text("body") and "Ajustes" in pg.inner_text(".cpf-aviso") and val("#c-nome") == "")
    pg.reload(); pg.wait_for_timeout(1500)
    pg.evaluate("window.__CPF = { chamadas: [], semChave: true }"); pg.goto(U + "#/painel"); pg.wait_for_timeout(300); pg.goto(U + "#/ajustes?aba=consultas"); pg.wait_for_timeout(1500)
    chk("Ajustes sem chave: avisa que falta cadastrar e mostra o campo", "Ainda não está ligada" in pg.inner_text("#cartao-cpf") and pg.query_selector("#cpf-chave") is not None)
    celA = pagina(390, 800); celA.goto(U + "#/ajustes?aba=consultas"); celA.wait_for_timeout(2500)
    la = celA.evaluate("document.documentElement.scrollWidth"); celA.query_selector("#cartao-cpf").scroll_into_view_if_needed(); celA.screenshot(path=SAIDA + "/cpf-5-ajustes-celular.png")
    chk("celular: Ajustes com o campo da chave não passa da largura", la <= 392, la)

    # ================= celular =================
    cel = pagina(390, 800)
    cel.goto(U + "#/entrada"); cel.wait_for_timeout(2500)
    nova_os(cel)
    cel.fill("#c-doc", CPF); cel.wait_for_timeout(1500)
    larg = cel.evaluate("document.documentElement.scrollWidth")
    chk("celular: preenche o nome e a tela não passa da largura", cel.input_value("#c-nome") == "MARIA APARECIDA DE SOUZA" and larg <= 392, larg)
    cel.query_selector("#c-doc").scroll_into_view_if_needed(); cel.screenshot(path=SAIDA + "/cpf-4-celular.png")

    # ================= quem não é administrador =================
    con = pagina(antes="window.__PAPEL = 'consultor'")
    con.goto(U + "#/entrada"); con.wait_for_timeout(2500)
    nova_os(con)
    con.fill("#c-doc", "529.982.247-25"); con.wait_for_timeout(1500)
    chc = con.evaluate("((window.__CPF || {}).chamadas || []).length")
    chk("SÓ ADMINISTRADOR: para o consultor não consulta, não preenche e não mostra botão", chc == 0 and con.input_value("#c-nome") == "" and con.query_selector(".cpf-buscar") is None and con.query_selector(".cpf-aviso") is None, chc)
    b.close()
finally:
  srv.terminate()
print(len(ok), "ok"); [print("  FALHA:", f) for f in falhas]; [print("  ", e) for e in erros[:8]]
sys.exit(1 if falhas or erros else 0)
