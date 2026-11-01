# Teste de ponta a ponta com dados simulados (teste/mock.js): fluxo da O.S. em 4 etapas, prazo e parcelas,
# contas a receber, previsão de caixa, modo espelho e abertura sem internet.
# Uso: python3 teste/teste_fluxo.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys
from playwright.sync_api import sync_playwright
import os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # pasta do repositório
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); erros = []; ok = []; falhas = []
def chk(n, c): (ok if c else falhas).append(n)
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1600, "height": 950}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    U = "http://localhost:8765/"; ordem = lambda i: pg.evaluate("window.__DB.ordens.find(o => o.id === '%s')" % i)
    pg.goto(U + "#/ordens"); pg.wait_for_timeout(2500)
    chk("4 etapas no resumo", all(pg.query_selector(".os-resumo .osr-" + k) for k in ["orcamento", "execucao", "pagamento", "fechada"]))
    pg.screenshot(path=SAIDA + "/u1-ordens.png")
    t = pg.inner_text(".linha-os-acoes:has-text('01896')")
    chk("orçamento: botão Aprovar", "Aprovar" in t)
    t = pg.inner_text(".linha-os-acoes:has-text('01898')")
    chk("execução: botão Serviço concluído", "Serviço concluído" in t)
    # aprova o2 pendente e conclui o serviço
    pg.evaluate("window.__DB.os_itens.forEach(i => { if (i.ordem_id === 'o2') { i.aprovado = true; i.executado = true; } })")
    pg.click(".linha-os-acoes:has-text('01898') .btn-avancar"); pg.wait_for_timeout(1200)
    chk("concluído → aguardando pagamento", ordem("o2")["status"] == "pronto")
    t = pg.inner_text(".linha-os-acoes:has-text('01898')")
    chk("pagamento: botão Receber e fechar", "Receber e fechar" in t and "Aguard. pagamento" in t)
    # entregar e receber depois com boleto 3x
    pg.click(".linha-os-acoes:has-text('01898') .btn-encerrar"); pg.wait_for_timeout(900)
    pg.click("[role=dialog] .seg button:has-text('Entregar e receber depois')"); pg.wait_for_timeout(300)
    chk("prazo aparece", pg.query_selector("[role=dialog] .prazo-receber") is not None)
    pg.click("[role=dialog] button.btn-pri"); pg.wait_for_timeout(300)
    chk("prazo exige forma", "forma combinada" in pg.inner_text("[role=dialog] .erros"))
    pg.click("[role=dialog] .prazo-receber .seg button:has-text('Boleto')"); pg.wait_for_timeout(200)
    pg.select_option("#pr-n", "3"); pg.wait_for_timeout(300)
    pg.screenshot(path=SAIDA + "/u2-prazo.png")
    n_linhas = pg.evaluate("document.querySelectorAll('[role=dialog] .tab-parcelas tbody tr').length")
    chk("3 parcelas na tabela", n_linhas == 3)
    pg.click("[role=dialog] button.btn-pri"); pg.wait_for_timeout(1500)
    o2 = ordem("o2"); rec = pg.evaluate("window.__DB.receber.filter(p => p.ordem_id === 'o2')")
    chk("entregue, não fechada", o2["status"] == "entregue" and not o2.get("finalizada_em"))
    chk("3 parcelas gravadas somando o total", len(rec) == 3 and abs(sum(r["valor"] for r in rec) - o2["total"]) < 0.01 and all(r["forma"] == "Boleto" for r in rec))
    pg.select_option(".os-filtros select >> nth=0", "pagamento"); pg.wait_for_timeout(400)
    t = pg.inner_text(".lista")
    chk("lista mostra vencimento", "01898" in t and "Vencimento" in t)
    # vence uma parcela no passado: alertas
    pg.evaluate("window.__DB.receber.find(p => p.parcela === 1).vencimento = '2026-10-01'")
    pg.goto(U + "#/receber"); pg.wait_for_timeout(1500)
    t = pg.inner_text("main")
    chk("contas a receber: vencida", "Vencidas" in t and "Vencida há" in t)
    chk("selo no menu lateral", pg.query_selector(".lateral .lat-badge") is not None)
    pg.screenshot(path=SAIDA + "/u3-receber.png")
    # receber parcela 1 parcial
    pg.click(".conta-linha.s-vencida .btn-encerrar"); pg.wait_for_timeout(600)
    pg.click("[role=dialog] .seg button:has-text('PIX')"); pg.fill("#rp-valor", "500,00"); pg.uncheck("[role=dialog] input[type=checkbox]")
    pg.click("[role=dialog] button.btn-pri"); pg.wait_for_timeout(1500)
    rec = pg.evaluate("window.__DB.receber.filter(p => p.ordem_id === 'o2')")
    p1 = [r for r in rec if r["parcela"] == 1]
    chk("parcial: parcela paga 500 + restante aberto", len(p1) == 2 and any(r["status"] == "paga" and r["valor"] == 500 for r in p1) and any(r["status"] == "aberta" for r in p1))
    chk("recibo da parcela", pg.evaluate("window.__DB.recibos.some(r => r.ordem_id === 'o2' && r.valor === 500)"))
    # O.S.: parcelas + trilha 4 etapas
    pg.goto(U + "#/os/o2"); pg.wait_for_timeout(1500)
    t = pg.inner_text("main")
    chk("O.S. trilha 4 etapas", pg.evaluate("[...document.querySelectorAll('.trilha li')].map(l => l.textContent).join('|')") == "Orçamento|Aprovado · em execução|Aguardando pagamento|Fechada")
    pg.screenshot(path=SAIDA + "/u4-os.png", full_page=True)
    # receber o resto pela O.S. → fecha e baixa as parcelas
    pg.click("button:has-text('Receber pagamento')"); pg.wait_for_timeout(900)
    pg.click("[role=dialog] .seg button:has-text('Dinheiro')"); pg.uncheck("[role=dialog] input[type=checkbox]"); pg.click("[role=dialog] button.btn-pri"); pg.wait_for_timeout(1500)
    rec = pg.evaluate("window.__DB.receber.filter(p => p.ordem_id === 'o2')")
    chk("quitou: O.S. fechada e parcelas pagas", bool(ordem("o2").get("finalizada_em")) and all(r["status"] == "paga" for r in rec))
    # aprovar orçamento direto (o4 aguardando) pela lista
    pg.goto(U + "#/ordens"); pg.wait_for_timeout(1200)
    pg.click(".linha-os-acoes:has-text('01896') .btn-avancar"); pg.wait_for_timeout(1200)
    chk("aprovar → execução", ordem("o4")["status"] == "execucao")
    # painel
    pg.goto(U + "#/painel"); pg.wait_for_timeout(1500)
    pg.screenshot(path=SAIDA + "/u5-painel.png")
    # importar: modo espelho visível
    pg.goto(U + "#/importar"); pg.wait_for_timeout(1000)
    chk("importar: espelho ligado", "Modo espelho ligado" in pg.inner_text("main"))
    # previsão de caixa
    # dia 10 do mês que vem (o teste clica em "Próximo mês"; data fixa quebrava quando o mês virava)
    pg.evaluate("(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); d.setDate(10); const v = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-10';"
                " window.__DB.contas.push({ id: 'k9', descricao: 'Aluguel', favorecido: 'Imobiliária', valor: 3000, vencimento: v, status: 'aberta' }); })()")
    pg.goto(U + "#/caixa"); pg.wait_for_timeout(1500)
    pg.click(".caixa-mes button[aria-label='Próximo mês']"); pg.wait_for_timeout(1200)
    pg.fill("#cx-saldo", "1.000,00"); pg.wait_for_timeout(400)
    t = pg.inner_text("main")
    chk("caixa: aluguel nas saídas", "Imobiliária" in t and "3.000,00" in t)
    chk("caixa: saldo fica negativo", "fica negativo" in t)
    pg.screenshot(path=SAIDA + "/u7-caixa.png", full_page=True)
    # O.S. em aberto guardadas por inteiro (inclui aguardando pagamento) e telas que só funcionam online
    pg.goto(U + "#/dados-locais"); pg.wait_for_timeout(2500)
    t = pg.inner_text("main")
    chk("O.S. guardadas no aparelho", "O.S. em aberto guardadas por inteiro" in t and " de " in t)
    ctx.set_offline(True); pg.evaluate("window.dispatchEvent(new Event('offline'))"); pg.wait_for_timeout(300)
    pg.goto(U + "#/financeiro"); pg.wait_for_timeout(800)
    chk("sem internet: contas a pagar avisa que precisa de internet", "precisa de internet" in pg.inner_text("main"))
    pg.goto(U + "#/funcionarios"); pg.wait_for_timeout(800)
    chk("sem internet: funcionários avisa", "precisa de internet" in pg.inner_text("main"))
    pg.goto(U + "#/ordens"); pg.wait_for_timeout(800)
    chk("sem internet: aviso falso do index.html não aparece", "não guarda o programa" not in pg.inner_text("body"))
    ctx.set_offline(False)
    b.close()
    # ===== offline: SW instala, desliga a rede e reabre =====
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 900}); pg = ctx.new_page()
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.goto(U); pg.wait_for_timeout(1500)
    pg.evaluate("navigator.serviceWorker.ready"); pg.wait_for_timeout(2500)
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_timeout(3000)
    txt = pg.inner_text("body")
    chk("offline: o programa abre", "Sem internet" in txt or "Painel" in txt)
    pg.screenshot(path=SAIDA + "/u6-offline.png")
    b.close()
except Exception as e:
    falhas.append("EXCECAO " + str(e).split("\n")[0])
finally: srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("\n".join(erros) or "sem erros de página")
