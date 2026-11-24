# Tela "App do mecânico › itens da lista" (administrador), com dados simulados (teste/mock.js): troca de sistema, esconder/mostrar,
# renomear, opções (coifa interna/externa), acrescentar item com ícone, remover, e que o resultado vira o que o app do mecânico lê
# (js/appmecanico.js). Confere também que a tela só grava em config.appMecanico e preserva o resto da configuração.
# Uso: python3 teste/teste_app_mecanico_admin.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8768", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e))); pg.on("dialog", lambda d: d.accept())
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    # uma ficha de colaborador ainda SEM acesso ligado, para o campo "Colaborador" do novo acesso (24/11/2026)
    pg.add_init_script("""window.__DB.funcionarios.push(
      { id: 'faux', nome: 'JOAO AUXILIAR', apelido: '', funcao: 'AUXILIAR', perfil_id: null, comissao_pct: 0, ativo: true, vinculo: 'clt', salario: 1800, horas_mes: 220, he_pct: 50, jornada: {} },
      { id: 'fja', nome: 'JA TEM ACESSO', apelido: '', funcao: 'MECANICO', perfil_id: 'p2', comissao_pct: 40, ativo: true, vinculo: 'clt', salario: 2200, horas_mes: 220, he_pct: 50, jornada: {} });""")
    pg.goto("http://localhost:8768/#/painel"); pg.wait_for_timeout(800)
    grupos = pg.evaluate("[...document.querySelectorAll('.lateral-grupo')].map(n => n.firstElementChild.textContent.replace(/[▾▸]/g, '').trim())")
    grupos = pg.eval_on_selector_all(".lateral .lateral-grupo-tit", "l => l.map(e => e.textContent)")
    chk("menu em 5 grupos por departamento (o RH saiu de Cadastros em 24/11)", len(grupos) == 5 and all(g.startswith(n) for g, n in zip(grupos, ["Operação", "Cadastros", "Financeiro", "RH", "Sistema"])), grupos)
    pg.goto("http://localhost:8768/#/ajustes?aba=sistema"); pg.wait_for_timeout(800)
    chk("Ajustes guarda Equipe, Backup e Importar", all(pg.locator(".card:has-text('Mais do sistema') .linha:has-text('" + t + "')").count() == 1 for t in ["Equipe", "Backup", "Importar"]))
    pg.goto("http://localhost:8768/#/equipe"); pg.wait_for_timeout(800)
    # App do celular por pessoa (cfg.appAcessos): padrão do papel, ligar o mecânico com uma tela só, desligar o administrador não é possível para si? (é: só não desativa o próprio acesso)
    # criar o login e a senha do colaborador pelo sistema (função "equipe" de mentira)
    pg.click("#eq-novo"); pg.wait_for_selector("#na-nome")
    # 24/11/2026 (pedido do Danilo): o acesso já nasce ligado à ficha do colaborador
    chk("criar acesso oferece escolher o colaborador", pg.locator("#na-ficha").count() == 1)
    chk("só oferece ficha ativa e ainda sem acesso ligado",
        [o.strip() for o in pg.locator("#na-ficha option").all_inner_texts()][1:] == ["JOAO AUXILIAR · AUXILIAR"],
        pg.locator("#na-ficha option").all_inner_texts())
    pg.click("#na-salvar"); pg.wait_for_timeout(200); chk("criar acesso exige o nome", "nome" in pg.inner_text(".modal .erros"))
    pg.fill("#na-nome", "Beatriz Consultora"); pg.fill("#na-email", "be"); pg.click("#na-salvar"); pg.wait_for_timeout(200); chk("usuário curto demais é recusado", "Usuário" in pg.inner_text(".modal .erros"))
    pg.fill("#na-email", "Beatriz.C"); pg.fill("#na-senha", "12345678"); pg.click("#na-salvar"); pg.wait_for_timeout(200); chk("senha só com números é recusada", "letras e números" in pg.inner_text(".modal .erros"))
    pg.click("#na-senha-gerar"); pg.wait_for_timeout(100); gerada = pg.input_value("#na-senha"); chk("Gerar faz senha de 10 com letras e números", len(gerada) == 10 and any(c.isalpha() for c in gerada) and any(c.isdigit() for c in gerada), gerada)
    pg.select_option("#na-ficha", label="JOAO AUXILIAR · AUXILIAR"); pg.wait_for_timeout(200)
    pg.select_option("#na-papel", "consultor"); pg.click("#na-salvar"); pg.wait_for_selector("#cr-senha", timeout=5000)
    fic = pg.evaluate("window.__DB.funcionarios.find(f => f.id === 'faux')")
    chk("o acesso criado já fica ligado à ficha do colaborador", fic["perfil_id"] == "p3", fic)
    eq = pg.evaluate("window.__EQUIPE"); chk("função equipe recebe nome, usuário em minúsculas, senha e papel", eq[-1] == {"acao": "criar", "nome": "Beatriz Consultora", "login": "beatriz.c", "senha": gerada, "papel": "consultor"}, eq)
    chk("quadro mostra o usuário (sem o e-mail interno) e a senha para passar à pessoa", pg.inner_text("#cr-email") == "beatriz.c" and pg.inner_text("#cr-senha") == gerada)
    pg.click(".modal >> text=Entendi"); pg.wait_for_timeout(500)
    chk("a pessoa nova aparece na equipe com o papel escolhido e o bloco do app", pg.locator(".linha:has-text('Beatriz Consultora') select").input_value() == "consultor" and pg.locator(".app-acesso[data-acesso=p3]").count() == 1)
    pg.click("#eq-novo"); pg.wait_for_selector("#na-nome"); pg.fill("#na-nome", "Outra"); pg.fill("#na-email", "beatriz.c"); pg.fill("#na-senha", "Senha1234"); pg.click("#na-salvar"); pg.wait_for_timeout(300)
    chk("usuário já usado: a mensagem do servidor aparece no quadro", "Este usuário já tem acesso" in pg.inner_text(".modal .erros"))
    chk("na lista, o login interno aparece como usuário", "usuário beatriz.c" in pg.inner_text(".linha:has-text('Beatriz Consultora')")); pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
    # trocar a senha de um colaborador
    pg.locator(".linha:has-text('Carlos Mecânico') button:has-text('Trocar senha')").click(); pg.wait_for_selector("#ts-senha")
    pg.fill("#ts-senha", "curta"); pg.click("#ts-salvar"); pg.wait_for_timeout(200); chk("trocar senha recusa senha fraca", "8 ou mais" in pg.inner_text(".modal .erros"))
    pg.fill("#ts-senha", "NovaSenha26"); pg.click("#ts-salvar"); pg.wait_for_timeout(400)
    chk("trocar senha chama a função com o id e a senha", pg.evaluate("window.__EQUIPE")[-1] == {"acao": "senha", "id": "p2", "senha": "NovaSenha26"} and pg.locator("#ts-senha").count() == 0)
    chk("o próprio administrador não tem Trocar senha (é pela tela de entrar)", pg.locator(".linha:has-text('Danilo (você)') button:has-text('Trocar senha')").count() == 0)
    chk("Equipe mostra o bloco App do celular por pessoa", pg.locator(".app-acesso").count() == 3)
    mec = pg.locator(".app-acesso[data-acesso=p2]"); adm = pg.locator(".app-acesso[data-acesso=p1]")
    chk("mecânico começa fora do app (padrão do papel)", mec.locator("[role=switch]").get_attribute("aria-checked") == "false" and "padrão do papel" in mec.inner_text())
    chk("administrador começa com todas as telas (padrão do papel)", adm.locator("[role=switch]").get_attribute("aria-checked") == "true" and adm.locator("> .chips .chip-btn[aria-pressed=true]").count() == 14)
    mec.locator("[role=switch]").click(); pg.wait_for_timeout(500)
    cfg = lambda: pg.evaluate("window.__DB.config")
    # ao ligar, grava a lista inteira (14); o "Agendar" só some depois, no primeiro salvamento que passa pelas telas do papel
    chk("ligar o app para o mecânico grava em config.appAcessos com todas as telas", cfg()["appAcessos"]["p2"]["entra"] is True and len(cfg()["appAcessos"]["p2"]["telas"]) == 14 and cfg().get("espelhoLegado") is True, cfg())
    chk("mecânico liberado vê as 13 telas do papel marcadas (Agendar não é dele)", pg.locator(".app-acesso[data-acesso=p2] > .chips .chip-btn[aria-pressed=true]").count() == 13)
    # horário de uso do app (só para quem não é administrador)
    chk("administrador não tem horário de uso; mecânico tem", pg.locator(".app-acesso[data-acesso=p1] .horario-uso").count() == 0 and pg.locator(".app-acesso[data-acesso=p2] .horario-uso").count() == 1)
    pg.locator(".app-acesso[data-acesso=p2] .horario-uso .chip-btn", has_text="Só no horário de trabalho").click(); pg.wait_for_timeout(400)
    hz = lambda: pg.evaluate("window.__DB.config").get("appAcessos", {}).get("p2", {}).get("horario")
    chk("ligar o horário grava o padrão 07:30–18:00 seg–sáb", hz() == {"de": "07:30", "ate": "18:00", "dias": [1, 2, 3, 4, 5, 6]}, hz())
    pg.locator(".app-acesso[data-acesso=p2] .horario-uso .chip-btn", has_text="Sáb").click(); pg.wait_for_timeout(400)
    chk("desmarcar sábado grava os dias", hz()["dias"] == [1, 2, 3, 4, 5], hz())
    pg.locator(".app-acesso[data-acesso=p2] .inp-hora").first.fill("08:00"); pg.wait_for_timeout(400); chk("mudar a hora de início grava", hz()["de"] == "08:00", hz())
    pg.locator(".app-acesso[data-acesso=p2] .inp-hora").first.fill("19:00"); pg.wait_for_timeout(400); chk("início depois do fim é recusado (não grava)", hz()["de"] == "08:00" and "antes do fim" in pg.inner_text("body"), hz())
    pg.locator(".app-acesso[data-acesso=p2] .horario-uso .chip-btn", has_text="Sem limite").click(); pg.wait_for_timeout(400)
    chk("Sem limite apaga o horário e mantém as telas", hz() is None and len(pg.evaluate("window.__DB.config")["appAcessos"]["p2"]["telas"]) == 13)
    mec = pg.locator(".app-acesso[data-acesso=p2]")
    chk("Agendar fica desabilitado para o mecânico (a política do banco só aceita admin e consultor)",
        not mec.locator(".chip-btn", has_text="Agendar").is_enabled())
    chk("e fica habilitado para o administrador", adm.locator(".chip-btn", has_text="Agendar").is_enabled())
    for nome in ["Iniciar serviço", "Orçamentos (pedido)", "Agenda (lista)", "Consultar peça por catálogo", "Histórico de serviços", "Meus serviços (quinzena)", "Consultar O.S.", "Diagnóstico OBD (ELM327)", "Módulos do carro (UDS)", "Atuadores (aciona saída no carro)", "Aprendizados e calibrações", "Programar bico (grava na ECU)"]:
        mec.locator(".chip-btn", has_text=nome).click(); pg.wait_for_timeout(350); mec = pg.locator(".app-acesso[data-acesso=p2]")
    chk("desmarcar telas deixa só Óleo para o mecânico", cfg()["appAcessos"]["p2"]["telas"] == ["oleo"], cfg()["appAcessos"]["p2"])
    chk("Orçamentos (pedido) pode ser ligado para o mecânico", mec.locator(".chip-btn", has_text="Orçamentos (pedido)").is_enabled())
    pg.locator(".app-acesso[data-acesso=p1] [role=switch]").click(); pg.wait_for_timeout(400)
    chk("desligar o app do administrador grava entra=false", cfg()["appAcessos"]["p1"]["entra"] is False)
    pg.locator(".app-acesso[data-acesso=p1] [role=switch]").click(); pg.wait_for_timeout(400)
    chk("ligar de novo volta com as telas que tinha", cfg()["appAcessos"]["p1"]["entra"] is True and len(cfg()["appAcessos"]["p1"]["telas"]) == 14)
    chk("em Equipe, o menu marca Ajustes", pg.locator(".lateral button[aria-current=page]:has-text('Ajustes')").count() == 1)
    pg.goto("http://localhost:8768/#/app-mecanico"); pg.wait_for_timeout(800)
    chk("App do celular tem item no menu Sistema e o grupo fica marcado", pg.get_attribute(".lateral .lateral-grupo:last-of-type .lateral-grupo-tit", "aria-current") == "page")
    chk("aba tem o botão de baixar o APK do app do sistema", pg.locator("#baixar-app a[download][href='app/download/DTCar-app.apk']").count() == 1)
    chk("o arquivo do APK está publicado e é um APK", pg.evaluate("fetch('app/download/DTCar-app.apk').then(async r => { const b = new Uint8Array(await r.arrayBuffer()); return r.ok && b.length > 1000000 && b[0] === 0x50 && b[1] === 0x4b; })"))
    chk("tela abre com os 6 sistemas", pg.locator(".seg button").count() >= 6 and pg.locator(".am-linha").count() == 8, pg.locator(".am-linha").count())
    pg.goto("http://localhost:8768/#/painel"); pg.wait_for_timeout(600)
    chk("menu lateral cabe sem rolar (1366x768)", pg.evaluate("(() => { const l = document.querySelector('.lateral'); return l.scrollHeight <= l.clientHeight + 1; })()"))
    pg.goto("http://localhost:8768/#/app-mecanico"); pg.wait_for_timeout(600)
    # esconder
    pg.locator(".am-linha:has-text('Servo / cilindro mestre') button:has-text('Esconder')").click(); pg.wait_for_timeout(400)
    cfg = lambda: pg.evaluate("window.__DB.config")
    chk("esconder grava só em appMecanico e guarda o resto", cfg()["appMecanico"]["sistemas"]["fr"]["ocultos"] == ["Servo / cilindro mestre"] and cfg().get("espelhoLegado") is True, cfg())
    chk("item escondido fica apagado e com botão Mostrar", pg.locator(".am-linha.am-off:has-text('Servo')").count() == 1 and pg.locator(".am-linha:has-text('Servo') button:has-text('Mostrar')").count() == 1)
    # Transmissão: coifa da homocinética com opções
    pg.click(".seg button:has-text('Transmissão')"); pg.wait_for_timeout(300)
    pg.locator(".am-linha:has-text('Coifa da homocinética') button:has-text('Editar')").click(); pg.wait_for_timeout(300)
    chk("opções atuais aparecem para editar", pg.input_value("#am-ops") == "Interna, Externa")
    pg.fill("#am-ops", "Interna, Externa, Lado esquerdo"); pg.click(".modal button:has-text('Salvar'), .fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(500)
    chk("opções editadas gravadas", cfg()["appMecanico"]["sistemas"]["tr"]["opcoes"]["Coifa da homocinética"] == ["Interna", "Externa", "Lado esquerdo"], cfg())
    # renomear item de outro sistema
    pg.click(".seg button:has-text('Direção')"); pg.wait_for_timeout(300)
    pg.locator(".am-linha:has-text('Ponteira') button:has-text('Editar')").click(); pg.wait_for_timeout(300); pg.fill("#am-nome", "Ponteira de direção"); pg.click(".fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(500)
    chk("renomear grava o novo nome", cfg()["appMecanico"]["sistemas"]["di"]["renomes"] == {"Ponteira": "Ponteira de direção"}, cfg())
    # acrescentar item novo com ícone, 1 ou 2 e posição
    pg.click("button:has-text('+ Acrescentar item em Direção')"); pg.wait_for_timeout(300)
    chk("grade com os 63 ícones", pg.locator(".am-grade button").count() == 63, pg.locator(".am-grade button").count())
    pg.fill("#am-nome", "Terminal de direção"); pg.click(".am-grade button[title='Terminal']"); pg.click(".fundo-modal button:has-text('Diant. | Tras. | Os 2')"); pg.click(".fundo-modal button:has-text('1 ou 2')"); pg.click(".fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(500)
    n = cfg()["appMecanico"]["sistemas"]["di"]["novos"]
    chk("item novo gravado (nome, ícone, tipo, posição)", len(n) == 1 and n[0]["nome"] == "Terminal de direção" and n[0]["icone"] == "terminal" and n[0]["tipo"] == "par" and n[0]["pos"] == "chips", n)
    chk("item novo aparece na lista", pg.locator(".am-linha:has-text('Terminal de direção'):has-text('acrescentado por você')").count() == 1)
    # nome repetido é recusado
    pg.click("button:has-text('+ Acrescentar item em Direção')"); pg.wait_for_timeout(300); pg.fill("#am-nome", "terminal de direção"); pg.click(".fundo-modal button:has-text('Salvar')"); pg.wait_for_timeout(400)
    chk("nome repetido recusado", len(cfg()["appMecanico"]["sistemas"]["di"]["novos"]) == 1 and pg.locator(".fundo-modal").count() == 1)
    pg.click(".fundo-modal button:has-text('Cancelar')"); pg.wait_for_timeout(200)
    # o que o app lê
    r = pg.evaluate("""async () => { const m = await import('./js/appmecanico.js'); const c = m.catalogoDoApp(window.__DB.config); const di = c.find(s => s.id === 'di').pecas.map(p => p.nome); const fr = c.find(s => s.id === 'fr').pecas.map(p => p.nome);
      const tr = c.find(s => s.id === 'tr').pecas.find(p => p.orig === 'Coifa da homocinética').pm; return { di, fr, tr }; }""")
    chk("app: renomeado e novo presentes, servo escondido", "Ponteira de direção" in r["di"] and "Terminal de direção" in r["di"] and "Servo / cilindro mestre" not in r["fr"], r)
    chk("app: opções multi da coifa", r["tr"] == ["Interna", "Externa", "Lado esquerdo"], r)
    # remover item novo e mostrar o escondido
    pg.locator(".am-linha:has-text('Terminal de direção') button:has-text('Remover')").click(); pg.wait_for_timeout(400)
    chk("remover tira o item novo", cfg()["appMecanico"]["sistemas"]["di"]["novos"] == [])
    pg.click(".seg button:has-text('Freios')"); pg.wait_for_timeout(300); pg.locator(".am-linha:has-text('Servo') button:has-text('Mostrar')").click(); pg.wait_for_timeout(400)
    chk("mostrar de volta", cfg()["appMecanico"]["sistemas"]["fr"]["ocultos"] == [])
    # celular: a tela cabe
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(300)
    chk("celular: sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    chk("sem erro na página", not erros, erros)
    b.close()
finally:
  srv.terminate()
print(len(ok), "ok;", len(falhas), "falhas"); [print("FALHA:", f) for f in falhas]; sys.exit(1 if falhas else 0)
