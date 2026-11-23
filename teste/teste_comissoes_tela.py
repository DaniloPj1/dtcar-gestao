# RH › Comissões por serviço (v64, 23/11/2026): a O.S. entregue cai na tela e cada serviço vai para o nome de um
# funcionário, com o percentual à mão. O que o mecânico apontou no app já vem sugerido.
# Uso: python3 teste/teste_comissoes_tela.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8781", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or extra == "" else n + " :: " + str(extra))
U = "http://localhost:8781/"

# Uma O.S. entregue em novembro com dois serviços e uma peça; o Alex apontou um serviço no app e indicou o outro ao Tiago.
PREP = """(() => { const db = window.__DB;
  db.funcionarios.push(
    { id: 'fa', nome: 'ALEX FRANCISCO', apelido: 'BAIXINHO', perfil_id: 'p2', comissao_pct: 45, ativo: true, vinculo: 'mei', salario: 0, horas_mes: 220, he_pct: 50, admissao: '2026-01-01', jornada: null },
    { id: 'ft', nome: 'TIAGO BOLZANI', apelido: 'MAMUTE', perfil_id: 'p1', comissao_pct: 30, ativo: true, vinculo: 'socio', salario: 0, horas_mes: 220, he_pct: 50, admissao: '2026-01-01', jornada: null });
  db.ordens.push({ id: 'oc', numero: 1933, status: 'entregue', entregue_em: '2026-11-10T15:00:00-03:00', criado_em: '2026-11-09T10:00:00-03:00',
    cliente: { nome: 'MARBRASA NORTE' }, veiculo: { placa: 'HXV9E12', marca: 'Toyota', modelo: 'HILUX' }, total: 760, recebido: 760, tecnico_id: 'fa' });
  db.os_itens.push(
    { id: 'cs1', ordem_id: 'oc', tipo: 'servico', descricao: 'SUBST. PASTILHA E DISCO DE FREIO DIANTEIRO', qtd: 2, valor_unit: 90, desconto: 0, aprovado: true, posicao: 0 },
    { id: 'cs2', ordem_id: 'oc', tipo: 'servico', descricao: 'SUBST. SEMI-EIXO DIANTEIRO ESQUERDO', qtd: 1, valor_unit: 280, desconto: 0, aprovado: true, posicao: 1 },
    { id: 'cp1', ordem_id: 'oc', tipo: 'peca', descricao: 'JOGO DE PASTILHAS', qtd: 1, valor_unit: 300, desconto: 0, aprovado: true, posicao: 2 });
  db.apontamentos = [{ id: 'apc', ordem_id: 'oc', os_numero: 1933, perfil_id: 'p2', perfil_nome: 'Alexandro Francisco', situacao: 'finalizado',
    inicio: '2026-11-10T09:00:00-03:00', fim: '2026-11-10T14:00:00-03:00', pausas: [], itens_executados: ['cs1'],
    indicacoes: [{ item_id: 'cs2', descricao: 'SEMI-EIXO', para_id: 'p1', para_nome: 'Tiago Bolzani', em: '2026-11-10T14:00:00-03:00', visto_em: null }] }];
})();"""

try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    def abrir(w, h, rota="#/comissoes?mes=2026-11", prep=PREP):
      pg = b.new_context(viewport={"width": w, "height": h}).new_page()
      pg.on("pageerror", lambda e: erros.append(str(e)))
      pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(prep)
      pg.goto(U + "#/painel"); pg.wait_for_timeout(1200); pg.goto(U + rota); pg.wait_for_timeout(1500)
      return pg

    pg = abrir(1366, 768)
    tx = pg.inner_text("main")
    chk("abre com as O.S. entregues do mês", "OS 01933" in tx and "MARBRASA NORTE" in tx, tx[:200])
    chk("diz quantos serviços faltam ratear", "2 serviços a ratear" in tx, tx[:300])
    chk("as três abas do RH estão na tela", pg.query_selector("[role=tab][aria-selected=true]:has-text('Comissões por serviço')") is not None)

    pg.click(".card .secao-topo:has-text('OS 01933')"); pg.wait_for_timeout(600)
    tx = pg.inner_text("main")
    chk("abre os serviços da O.S.", "SUBST. PASTILHA E DISCO DE FREIO DIANTEIRO" in tx and "SUBST. SEMI-EIXO DIANTEIRO ESQUERDO" in tx)
    chk("peça não entra na comissão", "JOGO DE PASTILHAS" not in tx, tx[:400])
    chk("mostra a mão de obra de cada linha", "180,00" in tx.replace("\xa0", " ") and "280,00" in tx.replace("\xa0", " "))

    linhas = pg.locator(".com-linha")
    chk("uma linha por serviço", linhas.count() == 2, linhas.count())
    l1, l2 = linhas.nth(0), linhas.nth(1)
    chk("serviço apontado no app já vem no nome de quem apontou", l1.locator("select").input_value() == "fa", l1.inner_text())
    chk("e vem marcado como vindo do app", l1.locator(".com-marca").count() == 1)
    chk("serviço indicado a outro vem no nome do indicado", l2.locator("select").input_value() == "ft", l2.inner_text())
    chk("o percentual oferecido é o do cadastro de cada um",
        l1.locator(".com-pct input").input_value() == "45" and l2.locator(".com-pct input").input_value() == "30",
        [l1.locator(".com-pct input").input_value(), l2.locator(".com-pct input").input_value()])
    chk("mostra a conta de cada linha antes de lançar", "81,00" in l1.inner_text().replace("\xa0", " ") and "84,00" in l2.inner_text().replace("\xa0", " "),
        [l1.inner_text(), l2.inner_text()])

    # o percentual é do Danilo: troca à mão e a conta acompanha
    l1.locator(".com-pct input").fill("50"); pg.wait_for_timeout(300)
    chk("trocou o percentual à mão e a comissão recalcula", "90,00" in l1.inner_text().replace("\xa0", " "), l1.inner_text())

    l1.locator("button:has-text('Lançar')").click(); pg.wait_for_timeout(900)
    g = pg.evaluate("() => window.__DB.os_item_comissoes")
    chk("gravou uma comissão para o serviço", len(g) == 1 and g[0]["item_id"] == "cs1" and g[0]["funcionario_id"] == "fa", g)
    chk("gravou base, percentual e valor congelados", g[0]["base"] == 180 and g[0]["percentual"] == 50 and g[0]["valor"] == 90, g[0])
    chk("gravou a competência pelo mês da entrega", g[0]["competencia"] == "2026-11-01", g[0]["competencia"])
    chk("guardou a O.S., a descrição e o nome de quem recebe",
        g[0]["os_numero"] == 1933 and "PASTILHA" in g[0]["descricao"] and g[0]["funcionario_nome"] == "BAIXINHO", g[0])
    chk("marcou que a sugestão veio do app", g[0]["origem"] == "app", g[0]["origem"])
    tx = pg.inner_text("main")
    chk("o cartão passa a dizer quanto falta", "Faltam 1 de 2" in tx, tx[:300])
    chk("o resumo do mês mostra o total por pessoa", "BAIXINHO" in tx and "90,00" in tx.replace("\xa0", " "))

    # dividir a mesma linha entre dois mecânicos
    l2.locator("button:has-text('+ Dividir com outro')").click(); pg.wait_for_timeout(300)
    chk("abriu uma segunda pessoa na mesma linha", l2.locator(".com-rat").count() == 2, l2.locator(".com-rat").count())
    l2.locator(".com-rat").nth(1).locator("select").select_option("fa")
    l2.locator(".com-rat").nth(1).locator("input").fill("20"); pg.wait_for_timeout(300)
    l2.locator("button:has-text('Lançar')").click(); pg.wait_for_timeout(900)
    g = pg.evaluate("() => window.__DB.os_item_comissoes.filter(c => c.item_id === 'cs2')")
    chk("a mesma linha foi dividida entre dois", len(g) == 2 and sorted(x["funcionario_id"] for x in g) == ["fa", "ft"], g)
    chk("cada um com o seu percentual e o seu valor",
        sorted((x["percentual"], x["valor"]) for x in g) == [(20, 56), (30, 84)], [(x["percentual"], x["valor"]) for x in g])
    tx = pg.inner_text("main")
    chk("O.S. inteira rateada mostra o selo e o total", "Rateada" in tx, tx[:300])

    # relançar o mesmo serviço substitui, não duplica
    l2.locator(".com-rat").nth(1).locator("button:has-text('Tirar')").click(); pg.wait_for_timeout(200)
    l2.locator("button:has-text('Lançar')").click(); pg.wait_for_timeout(900)
    g = pg.evaluate("() => window.__DB.os_item_comissoes.filter(c => c.item_id === 'cs2')")
    chk("relançar substitui o rateio daquele serviço (não duplica)", len(g) == 1 and g[0]["funcionario_id"] == "ft", g)

    # a folha do funcionário passa a contar pelo que foi rateado, e não pelo percentual cheio
    pg.goto(U + "#/funcionario/fa?mes=2026-11"); pg.wait_for_timeout(1500)
    pg.click("[role=tab]:has-text('Contabilidade do mês')"); pg.wait_for_timeout(1800)
    tx = pg.inner_text("main").replace("\xa0", " ")
    chk("a ficha do funcionário mostra a comissão por serviço", "Comissão por serviço" in tx and "90,00" in tx, tx[:400])
    chk("a O.S. rateada não conta mais pelo percentual cheio", "percentual cheio" in tx and "rateadas por serviço" in tx, tx[:600])

    # filtro "só as que faltam ratear"
    pg.goto(U + "#/comissoes?mes=2026-11"); pg.wait_for_timeout(1500)
    pg.locator(".com-chk input").check(); pg.wait_for_timeout(400)
    chk("filtro esconde a O.S. já rateada", "Todas as O.S. entregues neste mês já foram rateadas" in pg.inner_text("main"), pg.inner_text("main")[:300])

    # celular: a tela continua utilizável
    pgm = abrir(390, 780)
    pgm.click(".card .secao-topo:has-text('OS 01933')"); pgm.wait_for_timeout(600)
    chk("celular: os serviços e os campos aparecem", pgm.locator(".com-linha").count() == 2 and pgm.locator(".com-pct input").first.is_visible())
    chk("celular: nada estoura a largura", pgm.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 2"),
        pgm.evaluate("document.documentElement.scrollWidth + '>' + window.innerWidth"))

    # banco ainda sem o v64: a tela avisa e não quebra
    pg2 = abrir(1366, 768, prep=PREP + "window.__SEM_V64 = true;")
    chk("sem o v64 a tela avisa qual arquivo rodar", "supabase/v64.sql" in pg2.inner_text("main"), pg2.inner_text("main")[:300])
    chk("sem o v64 a folha continua funcionando", "Carregando" not in pg2.inner_text("main"))

    b.close()
finally:
  srv.terminate()
print("\n".join("OK " + x for x in ok))
print("\nOK", len(ok)); print("FALHAS", falhas); print("ERROS", erros)
sys.exit(1 if falhas or erros else 0)
