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
SEMEAR = """window.__DB.os_itens.find(i => i.id === 'i1').descricao = 'REVISAO GERAL';
  window.__DB.perfis.push({ id: 'p3', nome: 'Beto Mecânico', email: 'b@x', papel: 'mecanico', ativo: true });
  window.__DB.funcionarios.push(
    { id: 'fmec1', nome: 'CARLOS MECANICO', apelido: 'Carlos', perfil_id: 'p2', comissao_pct: 40, comissao_grupos: {}, salario: 2200, horas_mes: 220, he_pct: 50, vinculo: 'clt', ativo: true, jornada: {} },
    { id: 'fmec2', nome: 'ROBERTO LIMA', apelido: 'Beto', perfil_id: 'p3', comissao_pct: 30, comissao_grupos: {}, salario: 2000, horas_mes: 220, he_pct: 50, vinculo: 'clt', ativo: true, jornada: {} });"""
NOME = SEMEAR
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
    chk("matriz salva na ficha do funcionário, não no config (que a equipe toda lê)",
        pg.evaluate("window.__DB.funcionarios.find(f => f.id === 'fmec1').comissao_pct") == 45 and not pg.evaluate("!!window.__DB.config.comissao"),
        pg.evaluate("[window.__DB.funcionarios.find(f => f.id === 'fmec1').comissao_pct, window.__DB.config.comissao]"))
    t = txt(pg)
    chk("o novo padrão vale na quinzena (45% de 600 = 270)", "R$ 270,00" in t, t[:400])

    # 7. puxar O.S. INTEIRA para um mecânico (pedido do Danilo, 24/11/2026)
    pg.click(".painel-topo button:has-text('Puxar O.S.')"); pg.wait_for_timeout(600)
    m = txt(pg, ".modal")
    chk("puxar O.S.: diz para que serve (outra quinzena, fechada, adiantar)",
        "outra quinzena" in m and "fechada" in m and "adiantar" in m, m[:400])
    # a O.S. 1898 tem um serviço e nenhum apontamento: é o caso que antes ficava de fora
    pg.fill("#cm-busca", "1898"); pg.click(".modal button:has-text('Procurar')"); pg.wait_for_timeout(1200)
    m = txt(pg, ".modal")
    chk("acha a O.S. pelo número e lista o serviço com a mão de obra",
        "TROCA DE AMORTECEDORES DIANTEIROS" in m and "R$ 350,00" in m, m[:400])
    chk("peça não entra na comissão", "AMORTECEDOR DIANT TOYOTA HILUX" not in m, m[:400])
    chk("um seletor só, para a O.S. inteira", pg.locator(".modal #cm-para").count() == 1 and pg.locator(".modal .cm-puxar-quem").count() == 0)
    chk("o botão só libera depois de escolher o mecânico", pg.locator("#cm-puxar-tudo").is_disabled())
    pg.select_option("#cm-para", label="Beto"); pg.wait_for_timeout(300)
    m = txt(pg, ".modal")
    chk("escolhido o mecânico, o botão diz quantos serviços vão", not pg.locator("#cm-puxar-tudo").is_disabled()
        and "Puxar 1 serviço" in pg.locator("#cm-puxar-tudo").inner_text(), pg.locator("#cm-puxar-tudo").inner_text())
    chk("a linha mostra para quem o serviço vai", "vai para Beto" in m, m[:400])
    pg.click("#cm-puxar-tudo"); pg.wait_for_timeout(1800)
    aps = pg.evaluate("(window.__DB.apontamentos || []).filter(a => a.perfil_id === 'p3' && (a.itens_executados || []).includes('i4'))")
    chk("gravou o apontamento no nome do mecânico escolhido", len(aps) == 1, aps)
    chk("o apontamento nasce finalizado, para entrar no histórico do app",
        bool(aps) and aps[0]["situacao"] == "finalizado" and bool(aps[0]["fim"]), aps)
    chk("o apontamento fica na O.S. certa", bool(aps) and aps[0]["ordem_id"] == "o2" and aps[0]["os_numero"] == 1898, aps)
    t = txt(pg)
    chk("a O.S. puxada entra na quinzena no nome dele", "TROCA DE AMORTECEDORES DIANTEIROS" in t and "Beto" in t, t[:600])

    # desmarcar tira o serviço da puxada
    pg.click(".painel-topo button:has-text('Puxar O.S.')"); pg.wait_for_timeout(600)
    pg.fill("#cm-busca", "1898"); pg.click(".modal button:has-text('Procurar')"); pg.wait_for_timeout(1200)
    pg.select_option("#cm-para", label="Carlos"); pg.wait_for_timeout(200)
    pg.locator(".modal .cm-puxar-itens input[type=checkbox]").first.uncheck(); pg.wait_for_timeout(300)
    chk("desmarcando tudo, não há o que puxar", pg.locator("#cm-puxar-tudo").is_disabled())
    pg.keyboard.press("Escape"); pg.wait_for_timeout(400)

    # 8b. serviço dividido entre DOIS mecânicos: o percentual de um não pode vazar para o outro
    dois = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    dois.on("pageerror", lambda e: erros.append("PAGEERR dois " + str(e)))
    dois.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    dois.add_init_script(NOME)
    dois.add_init_script("""window.__DB.apontamentos = null;
      window.__API_MOCK.apontamentos.listar = async () => (window.__DB.aps || (window.__DB.aps = [
        { id: 'ap1', ordem_id: window.__DB.ordens[0].id, os_numero: window.__DB.ordens[0].numero, perfil_id: 'p2', perfil_nome: 'Carlos', situacao: 'finalizado', inicio: new Date(Date.now()-7200000).toISOString(), fim: new Date(Date.now()-3600000).toISOString(), itens_executados: ['i1'], indicacoes: [], pausas: [] },
        { id: 'ap2', ordem_id: window.__DB.ordens[0].id, os_numero: window.__DB.ordens[0].numero, perfil_id: 'p3', perfil_nome: 'Beto', situacao: 'finalizado', inicio: new Date(Date.now()-7200000).toISOString(), fim: new Date(Date.now()-3600000).toISOString(), itens_executados: ['i1'], indicacoes: [], pausas: [] }]));""")
    dois.goto(U + "#/comissao"); dois.wait_for_timeout(2400)
    t = txt(dois)
    chk("dividido: os dois mecânicos aparecem", "Carlos" in t and "Beto" in t, t[:300])
    pcts = dois.locator(".cm-linhas li .cm-pct-campo input")
    chk("dividido: cada um com o seu percentual (40 e 30)", [pcts.nth(i).input_value() for i in range(pcts.count())] == ["40", "30"],
        [pcts.nth(i).input_value() for i in range(pcts.count())])
    chk("dividido: metade da mão de obra para cada (R$ 300,00 de base)", t.count("parte dele: R$ 300,00") == 2, t[:600])
    pcts.first.fill("10"); dois.wait_for_timeout(500)
    depois = [pcts.nth(i).input_value() for i in range(pcts.count())]
    chk("dividido: digitar o percentual de um NÃO mexe no do outro", depois == ["10", "30"], depois)
    botoes = [dois.locator(".cm-bloco").nth(i).locator("button.btn-pri").inner_text().replace("\xa0", " ") for i in range(dois.locator(".cm-bloco").count())]
    chk("dividido: cada botão com o total do seu mecânico", "R$ 30,00" in botoes[0] and "R$ 90,00" in botoes[1], botoes)
    dois.locator(".cm-linhas li input[type=checkbox]").first.uncheck(); dois.wait_for_timeout(400)
    marcados = [dois.locator(".cm-linhas li input[type=checkbox]").nth(i).is_checked() for i in range(2)]
    chk("dividido: desmarcar o de um NÃO desmarca o do outro", marcados == [False, True], marcados)
    dois.locator(".cm-linhas li input[type=checkbox]").first.check(); dois.wait_for_timeout(300)

    # 8c. percentual fora de 0 a 100 trava o lançamento
    pcts.first.fill("250"); dois.wait_for_timeout(500)
    chk("percentual acima de 100 desliga o botão de lançar", dois.locator(".cm-bloco").first.locator("button.btn-pri").is_disabled())
    chk("percentual fora da faixa fica marcado no campo", dois.locator(".cm-linhas li .cm-pct-campo input.inp-erro").count() >= 1)
    pcts.first.fill("40"); dois.wait_for_timeout(400)

    # 8d. custo que o serviço já tinha antes da comissão volta no cancelamento
    dois.evaluate("window.__DB.os_itens.find(i => i.id === 'i1').custo_unit = 50")
    dois.click(".cm-bloco >> nth=0 >> button.btn-pri"); dois.wait_for_timeout(600)
    dois.click(".modal .btn-pri"); dois.wait_for_timeout(1400)
    chk("custo = o que já existia (50) + a comissão (120)", dois.evaluate(CUSTO) == 170, dois.evaluate(CUSTO))
    dois.click(".cm-lancados button:has-text('Cancelar')"); dois.wait_for_timeout(600)
    dois.click(".modal .btn-perigo:has-text('Cancelar o lançamento')"); dois.wait_for_timeout(1400)
    chk("cancelar devolve o custo que já existia (50), não zera", dois.evaluate(CUSTO) == 50, dois.evaluate(CUSTO))

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
    # 9. a folha NÃO soma a comissão automática por cima da já lançada, nem quando a consulta das comissões falha
    #    (era o pior erro da 1a revisão: sem internet a tela inventava comissão)
    HOJE_SEM = """window.__DB.funcionarios.push({ id: 'fmec9', nome: 'CARLOS MECANICO', apelido: 'Carlos', perfil_id: 'p2', comissao_pct: 40, comissao_grupos: {}, salario: 2000, horas_mes: 220, he_pct: 50, vinculo: 'clt', ativo: true, admissao: '2020-01-01', jornada: {} });
      const hoje = new Date(), comp = hoje.getFullYear() + '-' + String(hoje.getMonth()+1).padStart(2,'0') + '-01';
      window.__DB.ordens[2].status = 'entregue'; window.__DB.ordens[2].entregue_em = hoje.toISOString().slice(0,10);
      window.__DB.ordens[2].mecanico_id = 'p2'; window.__DB.ordens[2].mecanico_nome = 'Carlos Mecânico';
      window.__DB.funcionario_lanc.push({ id: 'l9', funcionario_id: 'fmec9', competencia: comp, data: hoje.toISOString().slice(0,10), tipo: 'comissao', qtd: 1, valor: 300, descricao: 'Comissão da quinzena' });
      window.__DB.comissoes.push({ id: 'c9', funcionario_id: 'fmec9', funcionario_nome: 'Carlos', inicio: comp, fim: comp, competencia: comp, servicos: 1, total: 300, situacao: 'lancado', lanc_id: 'l9', itens: [] });"""
    for rotulo, quebrar in [("consultando as comissões", False), ("com a consulta das comissões falhando", True)]:
      fo = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
      fo.on("pageerror", lambda e: erros.append("PAGEERR folha " + str(e)))
      fo.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
      fo.add_init_script(HOJE_SEM)
      if quebrar: fo.add_init_script("window.__API_MOCK.comissao.lancamentos = async () => { throw new Error('TypeError: Failed to fetch'); };")
      fo.goto(U + "#/funcionario/fmec9?aba=mes"); fo.wait_for_timeout(2600)
      tf = txt(fo)
      chk("folha " + rotulo + ": comissão é só a lançada (R$ 300,00), sem a automática de 40%",
          "R$ 300,00" in tf and "R$ 540,00" not in tf and "R$ 840,00" not in tf, [l for l in tf.split("\n") if "R$" in l][:10])
      # sabendo que foi lançada, a tela nem oferece apagar; sem saber, o botão fica (e o banco barra com mensagem clara)
      if not quebrar:
        chk("folha " + rotulo + ": não oferece apagar o lançamento da comissão à mão",
            "lançada na tela de Comissão" in tf, tf[:300])
      else:
        chk("folha " + rotulo + ": avisa que não deu para conferir a comissão da quinzena",
            "não foi possível conferir a comissão da quinzena" in tf, tf[:300])
      fo.close()

    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("erros de página:", erros or "nenhum")
sys.exit(1 if falhas or erros else 0)
