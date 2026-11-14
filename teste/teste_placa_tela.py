# Consulta do veículo pela placa (v55) nas telas, com dados simulados (teste/mock.js):
# ficha do veículo (busca sozinha, "Buscar dados pela placa", "Consulta completa", consultar de novo, placa trocada),
# Nova O.S., orçamento, agenda, Ajustes (situação, saldo, liga/desliga) e os casos de consulta desligada, sem saldo e sem internet.
# Regra do Danilo: só consulta quando o sistema ainda não tem os dados.
# Uso: python3 teste/teste_placa_tela.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8772", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
U = "http://localhost:8772/"
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 950}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    ch = lambda: pg.evaluate("((window.__PLACA || {}).chamadas || []).filter(c => c.acao !== 'saldo')")
    val = lambda sel: pg.input_value(sel)
    txt = lambda sel: pg.inner_text(sel).replace("\xa0", " ")   # "R$ 0,20" sai com espaço que não quebra
    def nova_ficha():
      pg.goto(U + "#/cadastros?aba=veiculos"); pg.wait_for_timeout(900)
      pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(400)

    # ================= ficha do veículo =================
    pg.goto(U + "#/cadastros?aba=veiculos"); pg.wait_for_timeout(2500)
    pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(400)
    pg.fill("#v-placa", "ABC1D23"); pg.wait_for_timeout(1200)   # já cadastrada
    chk("placa já cadastrada: não consulta e avisa", len(ch()) == 0 and "Esta placa já está no cadastro" in pg.inner_text(".modal") and pg.query_selector("#v-consulta-completa") is None, ch())
    pg.fill("#v-placa", "INT8C3"); pg.wait_for_timeout(900)
    chk("placa incompleta: não consulta", len(ch()) == 0)
    pg.fill("#v-placa", "INT8C36"); pg.wait_for_timeout(1500)
    c = ch()
    chk("placa nova: uma consulta básica", len(c) == 1 and c[0]["acao"] == "basico" and c[0]["placa"] == "INT8C36", c)
    chk("preencheu marca, modelo, anos, cor, motor e combustível", val("#v-marca") == "Volkswagen" and val("#v-modelo") == "CROSSFOX" and val("#v-ano_fab") == "2007"
        and val("#v-ano_mod") == "2008" and val("#v-cor") == "Prata" and val("#v-motor") == "1.6" and pg.get_attribute("button[aria-pressed='true']:has-text('Flex'), .seg button.ativo:has-text('Flex')", "class") is not None,
        [val("#v-" + k) for k in ["marca", "modelo", "ano_fab", "ano_mod", "cor", "motor"]])
    chk("aviso de dados preenchidos", "Dados preenchidos pela placa" in pg.inner_text(".modal"))
    chk("com tudo preenchido, some o botão de buscar e fica a consulta completa", pg.query_selector("#v-buscar-placa") is None and pg.query_selector("#v-consulta-completa") is not None)
    pg.screenshot(path=SAIDA + "/placa-1-ficha-auto.png")
    # trocar a placa desfaz o que veio da placa antiga e busca a nova
    pg.evaluate("window.__PLACA.dados = { marca: 'Fiat', modelo: 'STRADA FIRE FLEX', ano_fab: 2012, ano_mod: 2013, cor: 'Branca', combustivel: 'Flex', motor: '1.4', municipio: 'Colatina', uf: 'ES', final_chassi: '04251' }")
    pg.fill("#v-placa", "MTQ5E67"); pg.wait_for_timeout(1500)
    chk("placa trocada: os dados da placa antiga saem e entram os da nova", val("#v-marca") == "Fiat" and val("#v-modelo") == "STRADA FIRE FLEX" and val("#v-ano_fab") == "2012" and val("#v-cor") == "Branca" and len(ch()) == 2,
        [val("#v-marca"), val("#v-modelo"), val("#v-ano_fab"), val("#v-cor"), len(ch())])
    pg.evaluate("delete window.__PLACA.dados")
    pg.fill("#v-placa", "INT8C36"); pg.wait_for_timeout(1300)
    chk("voltou à placa anterior: dados dela de novo, sem outra consulta (já vista nesta sessão)", val("#v-marca") == "Volkswagen" and val("#v-modelo") == "CROSSFOX" and len(ch()) == 2, [val("#v-marca"), len(ch())])
    # consulta completa
    pg.fill("#v-cor", "Azul")
    pg.click("#v-consulta-completa"); pg.wait_for_timeout(1200)
    c = ch()
    chk("botão: consulta completa", len(c) == 3 and c[2]["acao"] == "completa" and "forcar" not in c[2], c)
    chk("completa preencheu chassi e Renavam, sem trocar o que foi digitado", val("#v-chassi") == "9BWZZZ377VT004251" and val("#v-renavam") == "00123456789" and val("#v-cor") == "Azul")
    chk("nº do motor nas observações", "Nº do motor: BAH123456" in val("#v-obs"))
    t = txt(".placa-consulta")
    chk("mostra o custo, o que preencheu e o que veio na consulta", "R$ 0,20" in t and "Preenchido: chassi, Renavam" in t and "Na consulta:" in t and "nº do motor BAH123456" in t and "emplacado em Colatina/ES" in t, t)
    pg.screenshot(path=SAIDA + "/placa-2-ficha-completa.png")
    # chassi diferente do da consulta: avisa e deixa usar o da consulta
    pg.fill("#v-chassi", "9BWZZZ377VT004259"); pg.wait_for_timeout(300)
    t = pg.inner_text(".placa-consulta")
    chk("chassi diferente da consulta: aviso", "Chassi diferente" in t and "9BWZZZ377VT004259" in t and "9BWZZZ377VT004251" in t, t)
    pg.screenshot(path=SAIDA + "/placa-3-chassi-diferente.png")
    pg.click(".placa-dif button:has-text('Usar o da consulta')"); pg.wait_for_timeout(300)
    chk("usar o da consulta corrige o chassi e o aviso some", val("#v-chassi") == "9BWZZZ377VT004251" and "Chassi diferente" not in pg.inner_text(".placa-consulta"))
    # já tem chassi e Renavam: pergunta antes de pagar de novo
    pg.click("#v-consulta-completa"); pg.wait_for_timeout(500)
    chk("já tem chassi e Renavam: pergunta antes de consultar de novo", "Consultar de novo?" in pg.inner_text("body") and len(ch()) == 3)
    pg.click("[aria-label='Consultar de novo?'] button:has-text('Voltar')"); pg.wait_for_timeout(400)
    chk("voltou: nada foi consultado", len(ch()) == 3)
    pg.click("#v-consulta-completa"); pg.wait_for_timeout(400)
    pg.click("[aria-label='Consultar de novo?'] button:has-text('Consultar de novo')"); pg.wait_for_timeout(1000)
    c = ch()
    chk("confirmou: consulta de novo com forcar", len(c) == 4 and c[3]["acao"] == "completa" and c[3].get("forcar") is True, c)
    chk("consultar de novo não duplica o nº do motor nas observações", val("#v-obs").count("Nº do motor") == 1, val("#v-obs"))
    pg.click("text=Salvar cadastro"); pg.wait_for_timeout(1200)
    v = pg.evaluate("window.__DB.veiculos.find(v => v.placa === 'INT8C36')")
    chk("veículo salvo com os dados", bool(v) and v["marca"] == "Volkswagen" and v["chassi"] == "9BWZZZ377VT004251" and v["ano_fab"] == 2007 and v["ano_mod"] == 2008 and v["ano"] == "2007/2008"
        and v["combustivel"] == "Flex" and v["cor"] == "Azul" and "BAH123456" in v["obs"], v)
    # trocar a placa depois da completa tira chassi, Renavam e o nº do motor da placa antiga
    nova_ficha(); n = len(ch())
    pg.fill("#v-placa", "NOV1A11"); pg.wait_for_timeout(1300)
    pg.click("#v-consulta-completa"); pg.wait_for_timeout(1100)
    chk("completa na placa nova", val("#v-chassi") == "9BWZZZ377VT004251" and "BAH123456" in val("#v-obs") and len(ch()) == n + 2)
    pg.fill("#v-placa", "NOV1A1"); pg.wait_for_timeout(500)
    chk("placa trocada depois da completa: chassi, Renavam e nº do motor saem", val("#v-chassi") == "" and val("#v-renavam") == "" and "BAH123456" not in val("#v-obs") and val("#v-marca") == "",
        [val("#v-chassi"), val("#v-renavam"), val("#v-obs"), val("#v-marca")])
    # placa que a consulta não acha
    pg.fill("#v-placa", "ZZZ9Z99"); pg.wait_for_timeout(1500)
    chk("placa não encontrada: avisa e deixa preencher", "não achou esta placa" in pg.inner_text(".modal") and val("#v-marca") == "")
    # quem já digitou marca e modelo não é atropelado nem gera consulta; o botão busca o que falta
    n = len(ch())
    pg.fill("#v-placa", ""); pg.fill("#v-marca", "Fiat"); pg.fill("#v-modelo", "UNO"); pg.fill("#v-placa", "DEF5G67"); pg.wait_for_timeout(1300)
    chk("marca e modelo já digitados: não consulta sozinho", len(ch()) == n and val("#v-marca") == "Fiat")
    pg.click("#v-buscar-placa"); pg.wait_for_timeout(1100)
    t = txt(".placa-consulta")
    chk("botão Buscar dados pela placa: completa o que falta sem trocar o digitado", len(ch()) == n + 1 and ch()[-1]["acao"] == "basico" and val("#v-marca") == "Fiat" and val("#v-modelo") == "UNO"
        and val("#v-ano_fab") == "2007" and val("#v-cor") == "Prata" and "Preenchido: ano de fabricação, ano do modelo, cor, combustível, motor" in t and "R$ 0,03" in t, t)
    pg.click(".modal button:has-text('Cancelar')"); pg.wait_for_timeout(300)

    # veículo já cadastrado com dado faltando: nada sozinho; o botão busca só o que falta
    nova_ficha()
    pg.fill("#v-marca", "Chevrolet"); pg.fill("#v-modelo", "S10"); pg.fill("#v-cor", "Branco"); pg.fill("#v-placa", "FAL7A77"); pg.wait_for_timeout(1200)
    n = len(ch())
    pg.click("text=Salvar cadastro"); pg.wait_for_timeout(1300)
    pg.click("button:has-text('Editar ficha')"); pg.wait_for_timeout(1300)
    chk("ficha de veículo cadastrado: não consulta sozinho", len(ch()) == n and val("#v-placa").replace("-", "") == "FAL7A77" and val("#v-ano_fab") == "", [len(ch()) - n, val("#v-placa")])
    pg.click("#v-buscar-placa"); pg.wait_for_timeout(1100)
    chk("cadastrado com dado faltando: o botão busca e preenche só os vazios", len(ch()) == n + 1 and val("#v-marca") == "Chevrolet" and val("#v-modelo") == "S10" and val("#v-cor") == "Branco" and val("#v-ano_fab") == "2007" and val("#v-motor") == "1.6",
        [val("#v-marca"), val("#v-modelo"), val("#v-cor"), val("#v-ano_fab")])
    pg.click(".modal button:has-text('Cancelar')"); pg.wait_for_timeout(300)

    # ================= Nova O.S. =================
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1800); n = len(ch())
    pg.fill("#placa", "ABC1D23"); pg.wait_for_timeout(1200)
    chk("Nova O.S.: placa cadastrada usa o cadastro, sem consulta", len(ch()) == n and "Já cadastrado" in pg.inner_text("body"))
    pg.fill("#placa", "GHI2J34"); pg.wait_for_timeout(1600)
    chk("Nova O.S.: placa nova preenche o veículo", len(ch()) == n + 1 and val("#v-marca") == "Volkswagen" and val("#v-modelo") == "CROSSFOX" and val("#v-ano") == "2008" and val("#v-cor") == "Prata" and val("#v-motor") == "1.6"
        and "Dados preenchidos pela placa" in pg.inner_text(".placa-nova"), [len(ch()) - n, val("#v-marca"), val("#v-ano")])
    pg.screenshot(path=SAIDA + "/placa-4-nova-os.png")
    pg.fill("#placa", ""); pg.wait_for_timeout(200)
    pg.fill("#placa", "GHI2J34"); pg.wait_for_timeout(1300)
    chk("Nova O.S.: mesma placa de novo não consulta outra vez", len(ch()) == n + 1 and val("#v-marca") == "Volkswagen")
    # abre a O.S. e confere o veículo gravado (o ano de fabricação veio da consulta; a tela só mostra o ano do modelo)
    chk("Nova O.S.: o cliente escolhido antes continua", "Cliente Teste" in pg.inner_text("main"))
    pg.fill("#km", "45000"); pg.fill("#recl", "Barulho na suspensão")
    pg.click("button.btn-pri:has-text('Abrir O.S.')"); pg.wait_for_timeout(1800)
    v = pg.evaluate("window.__DB.veiculos.find(v => v.placa === 'GHI2J34')")
    chk("Nova O.S.: veículo novo gravado com ano de fabricação e do modelo da consulta", bool(v) and v["ano_fab"] == 2007 and v["ano_mod"] == 2008 and v["ano"] == "2007/2008" and v["marca"] == "Volkswagen" and v["cor"] == "Prata"
        and v["combustivel"] == "Flex" and v["motor"] == "1.6", v or (pg.inner_text(".erros") if pg.query_selector(".erros") else "sem veículo gravado"))
    o = pg.evaluate("window.__DB.ordens.find(o => (o.veiculo || {}).placa === 'GHI2J34')")
    chk("Nova O.S.: a O.S. abriu com o veículo da consulta", bool(o) and o["veiculo"]["marca"] == "Volkswagen" and o["veiculo"]["modelo"] == "CROSSFOX", o and o.get("veiculo"))
    # quem mexe no ano na tela: vale o da tela para os dois anos (o de fabricação da consulta já não serve)
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
    pg.fill("#placa", "ABC1D23"); pg.wait_for_timeout(700)
    pg.fill("#placa", "ANO1A11"); pg.wait_for_timeout(1500)
    pg.fill("#v-ano", "2010"); pg.fill("#km", "1000"); pg.fill("#recl", "Revisão")
    pg.click("button.btn-pri:has-text('Abrir O.S.')"); pg.wait_for_timeout(1800)
    v = pg.evaluate("window.__DB.veiculos.find(v => v.placa === 'ANO1A11')")
    chk("Nova O.S.: ano trocado na tela vale para fabricação e modelo", bool(v) and v["ano_fab"] == 2010 and v["ano_mod"] == 2010 and v["ano"] == "2010", v)

    # ================= orçamento =================
    pg.goto(U + "#/orcamento/novo"); pg.wait_for_timeout(1800); n = len(ch())
    pg.fill("#orc-placa", "KLM3N45"); pg.wait_for_timeout(1600)
    chk("orçamento: placa nova preenche marca, modelo e ano", len(ch()) == n + 1 and val("#orc-marca") == "Volkswagen" and val("#orc-modelo") == "CROSSFOX" and val("#orc-ano") == "2008", [len(ch()) - n, val("#orc-marca")])
    pg.fill("#orc-placa", "ABC1D23"); pg.wait_for_timeout(1300)
    chk("orçamento: trocou para placa do cadastro — sai o da consulta e entra o do cadastro, sem consulta", len(ch()) == n + 1 and val("#orc-modelo") == "Uno" and val("#orc-marca") == "Fiat", [len(ch()) - n, val("#orc-marca"), val("#orc-modelo")])

    # ================= agenda =================
    pg.evaluate("window.onbeforeunload = null"); pg.goto(U + "#/painel"); pg.wait_for_timeout(600)
    if pg.query_selector("button:has-text('Sair sem salvar')"): pg.click("button:has-text('Sair sem salvar')"); pg.wait_for_timeout(400)
    pg.goto(U + "#/agenda"); pg.wait_for_timeout(1500); n = len(ch())
    pg.click("button:has-text('Agendar'), button:has-text('Novo agendamento')"); pg.wait_for_timeout(600)
    if pg.query_selector("#ag-placa"):
      pg.fill("#ag-placa", "PQR4S56"); pg.wait_for_timeout(1600)
      chk("agenda: placa nova preenche o veículo", len(ch()) == n + 1 and val("#ag-modelo") == "Volkswagen CROSSFOX", [len(ch()) - n, val("#ag-modelo")])
      pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
    else:
      chk("agenda: abriu o agendamento novo", False, pg.inner_text("body")[:200])

    # ================= Ajustes =================
    pg.goto(U + "#/ajustes"); pg.wait_for_timeout(1500)
    t = pg.inner_text("#cartao-placa")
    chk("Ajustes: mostra que está ligada, o saldo e o uso do mês", "Ligada" in t and "Saldo no API Placas" in t and "R$ " in t and "Este mês:" in t and "consultas pagas" in t, t)
    pg.locator("#cartao-placa").scroll_into_view_if_needed(); pg.screenshot(path=SAIDA + "/placa-5-ajustes.png")
    # desliga a busca automática
    pg.click("#cartao-placa input[type=checkbox]"); pg.wait_for_timeout(200)
    pg.click("button:has-text('Salvar ajustes')"); pg.wait_for_timeout(900)
    chk("Ajustes: busca automática desligada fica gravada", pg.evaluate("window.__DB.config.placaAuto") is False)
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500); n = len(ch())
    pg.fill("#placa", "TUV5X67"); pg.wait_for_timeout(1400)
    chk("busca automática desligada: Nova O.S. não consulta sozinha e mostra o botão", len(ch()) == n and val("#v-marca") == "" and pg.query_selector(".placa-buscar") is not None)
    pg.click(".placa-buscar"); pg.wait_for_timeout(1100)
    chk("…e o botão busca na hora", len(ch()) == n + 1 and val("#v-marca") == "Volkswagen")
    pg.goto(U + "#/ajustes"); pg.wait_for_timeout(1200)
    pg.click("#cartao-placa input[type=checkbox]"); pg.wait_for_timeout(200); pg.click("button:has-text('Salvar ajustes')"); pg.wait_for_timeout(900)
    chk("Ajustes: religou a busca automática", pg.evaluate("window.__DB.config.placaAuto") is True)

    # ================= consulta ainda não ligada / sem saldo / sem internet =================
    pg.goto(U + "#/painel"); pg.wait_for_timeout(300)
    pg.reload(); pg.wait_for_timeout(2200)   # esquece o que foi visto nesta sessão
    pg.evaluate("window.__PLACA = { situacao: 'desligada', chamadas: [] }")
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
    pg.fill("#placa", "DES1L11"); pg.wait_for_timeout(1400)
    t = pg.inner_text(".placa-nova")
    chk("consulta ainda não ligada: a tela segue como sempre (sem aviso de erro), com o botão para tentar", len(ch()) == 1 and "Preencha os dados do veículo" in t and "Não deu" not in t and pg.query_selector(".placa-buscar") is not None, t)
    pg.fill("#placa", "DES2L22"); pg.wait_for_timeout(1400)
    chk("…e não fica insistindo a cada placa (pausa de 5 minutos)", len(ch()) == 1, len(ch()))
    pg.click(".placa-buscar"); pg.wait_for_timeout(900)
    chk("…mas o botão tenta na hora e diz o motivo", len(ch()) == 2 and "ainda não foi ligada" in pg.inner_text(".placa-nova"), pg.inner_text(".placa-nova"))
    pg.goto(U + "#/ajustes"); pg.wait_for_timeout(1300)
    chk("Ajustes: mostra que ainda não está ligada", "Ainda não está ligada" in pg.inner_text("#cartao-placa"), pg.inner_text("#cartao-placa"))
    # servidor sem resposta (o que o navegador vê se a função ainda não foi publicada e ele não consegue ler a recusa)
    pg.reload(); pg.wait_for_timeout(2200)
    pg.evaluate("window.__PLACA = { situacao: 'semresposta', chamadas: [] }")
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
    pg.fill("#placa", "SEM1R11"); pg.wait_for_timeout(1400)
    pg.fill("#placa", "SEM2R22"); pg.wait_for_timeout(1400)
    t = pg.inner_text(".placa-nova")
    chk("servidor sem resposta: a tela segue normal, sem insistir a cada placa", len(ch()) == 1 and "Preencha os dados do veículo" in t and "Não deu" not in t, [len(ch()), t])
    pg.click(".placa-buscar"); pg.wait_for_timeout(900)
    chk("…e o botão tenta na hora e explica", len(ch()) == 2 and "Sem resposta da consulta de placa" in pg.inner_text(".placa-nova"), pg.inner_text(".placa-nova"))
    pg.goto(U + "#/ajustes"); pg.wait_for_timeout(1300)
    chk("Ajustes: sem resposta do servidor não vira erro de tela", "Não deu para conferir" in pg.inner_text("#cartao-placa") and "Sem resposta da consulta de placa" in pg.inner_text("#cartao-placa"), pg.inner_text("#cartao-placa"))
    pg.reload(); pg.wait_for_timeout(2200)
    pg.evaluate("window.__PLACA = { situacao: 'saldo', chamadas: [] }")
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
    pg.fill("#placa", "SLD1A11"); pg.wait_for_timeout(1400)
    chk("sem saldo: avisa para colocar saldo e deixa preencher à mão", "Acabou o saldo da consulta de placa" in pg.inner_text(".placa-nova") and val("#v-marca") == "", pg.inner_text(".placa-nova"))
    pg.reload(); pg.wait_for_timeout(2200)
    pg.evaluate("window.__PLACA = { chamadas: [] }")
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1200)
    ctx.set_offline(True)
    pg.fill("#placa", "OFF1A11"); pg.wait_for_timeout(1400)
    chk("sem internet: não consulta e a tela segue normal", len(ch()) == 0 and "Preencha os dados do veículo" in pg.inner_text(".placa-nova") and "Não deu" not in pg.inner_text(".placa-nova"), pg.inner_text(".placa-nova"))
    ctx.set_offline(False)

    # ================= saldo acabando =================
    pg.reload(); pg.wait_for_timeout(2200)
    pg.evaluate("window.__PLACA = { saldo: 50, chamadas: [] }")
    pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
    pg.fill("#placa", "BXO1A11"); pg.wait_for_timeout(1500)
    chk("saldo acabando: avisa junto com o preenchimento", "Saldo da consulta de placa acabando (R$ 0,47)" in txt(".placa-nova") and val("#v-marca") == "Volkswagen", pg.inner_text(".placa-nova"))

    # ================= mecânico: a Nova O.S. busca a básica; na ficha ele só consulta (sem botões) =================
    ctx2 = b.new_context(viewport={"width": 1400, "height": 950}); pm = ctx2.new_page()
    pm.on("pageerror", lambda e: erros.append("PAGEERR mecânico " + str(e)))
    pm.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pm.add_init_script("if (window.__DB) window.__DB.perfis[0].papel = 'mecanico';")
    pm.goto(U + "#/entrada"); pm.wait_for_timeout(2500)
    pm.fill("#placa", "MEC1A11"); pm.wait_for_timeout(1600)
    cm = pm.evaluate("((window.__PLACA || {}).chamadas || [])")
    chk("mecânico: a Nova O.S. busca a básica pela placa", len(cm) == 1 and cm[0]["acao"] == "basico" and pm.input_value("#v-marca") == "Volkswagen", cm)
    pm.goto(U + "#/veiculo/v1"); pm.wait_for_timeout(1500)
    if pm.query_selector("button:has-text('Editar ficha'), button:has-text('Ver ficha')"):
      pm.click("button:has-text('Editar ficha'), button:has-text('Ver ficha')"); pm.wait_for_timeout(600)
      chk("mecânico: na ficha não há botões de consulta", pm.query_selector("#v-consulta-completa") is None and pm.query_selector("#v-buscar-placa") is None)
    ctx2.close()
    b.close()
finally:
  srv.terminate()
print("\n".join("OK " + x for x in ok)); print("FALHAS", falhas); print("ERROS", erros)
sys.exit(1 if falhas or erros else 0)
