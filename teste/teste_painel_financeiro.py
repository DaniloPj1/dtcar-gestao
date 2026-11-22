# Painel Financeiro (22/11/2026): tela nova em Financeiro, só leitura, no estilo do protótipo "Painel DTCar".
# Confere: KPIs do mês (entradas, saídas, saldo, saldo das contas), resultado do mês (faturamento, custo, margem),
# gastos por categoria, troca de mês pelos chips, meta de entradas (orçado × realizado, só administrador),
# menu lateral SEM barra de rolagem em 1366x768 (o item novo não pode estourar a altura), celular empilhado
# e papel sem acesso. Nada das telas existentes é alterado por esta tela.
# Uso: python3 teste/teste_painel_financeiro.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8771", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c else n + " :: " + str(extra))
U = "http://localhost:8771/"

SEMEAR = """(() => {
  const db = window.__DB, agora = new Date(), a = agora.getFullYear(), m = agora.getMonth();
  const dia = (mes, d) => { const x = new Date(a, mes, d, 12); return x.toISOString().slice(0, 10); };
  const iso = (mes, d) => new Date(a, mes, d, 12).toISOString();
  db.recibos = [
    { id: "rf1", numero: 10, valor: 1000, data: dia(m, 5), criado_em: iso(m, 5) },
    { id: "rf2", numero: 11, valor: 500, data: dia(m, 10), criado_em: iso(m, 10) },
    { id: "rf3", numero: 12, valor: 999, data: dia(m, 11), criado_em: iso(m, 11), cancelado: true },
    { id: "rf4", numero: 9, valor: 2000, data: dia(m - 1, 15), criado_em: iso(m - 1, 15) },
  ];
  db.contas.push({ id: "kf1", descricao: "Energia do mês", favorecido: "EDP", categoria: "Energia", valor: 800, vencimento: dia(m, 8), status: "paga", pago_em: dia(m, 8), valor_pago: 800, origem: "recorrente" });
  db.ordens.push({ id: "of1", numero: 1990, status: "entregue", recebido: 900, entregue_em: iso(m, 6), criado_em: iso(m, 4),
    cliente: { nome: "Cliente Painel" }, veiculo: { placa: "PNF1A11", marca: "Fiat", modelo: "Uno" }, total: 900 });
  db.os_itens.push({ id: "if1", ordem_id: "of1", tipo: "servico", descricao: "REVISAO", qtd: 1, valor_unit: 600, desconto: 0, aprovado: true },
    { id: "if2", ordem_id: "of1", tipo: "peca", descricao: "FILTRO", qtd: 1, valor_unit: 300, desconto: 0, custo_unit: 300, aprovado: true });
  db.vendas = [{ id: "vf1", status: "concluida", criado_em: iso(m, 7), total: 100, custo: 40, forma_pagamento: "PIX" }];
  db.config.contasFinanceiras = [{ nome: "Sicredi", saldo: 5000, em: agora.toISOString() }];
})()"""

def abrir(b, w=1366, h=900, papel=None):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
  if papel: pg.add_init_script("window.__PAPEL = %r" % papel)
  pg.add_init_script(SEMEAR)  # roda logo depois do mock, antes do app carregar
  pg.goto(U + "#/painel-financeiro"); pg.wait_for_timeout(1800)
  return pg, pg.evaluate("new Date().getMonth()")

try:
  with sync_playwright() as p:
    b = p.chromium.launch()

    # ----- PC, administrador -----
    pg, mes = abrir(b)
    txt = lambda sel: pg.inner_text(sel)
    corpo = txt(".pf")
    chk("título da tela", "Painel Financeiro" in corpo)
    kpis = pg.eval_on_selector_all(".pf-kpi", "l => l.map(e => e.textContent)")
    chk("entradas do mês = R$ 1.500,00", any("Entradas no mês" in k and "1.500,00" in k for k in kpis), kpis)
    chk("saídas do mês = R$ 800,00", any("Saídas no mês" in k and "800,00" in k for k in kpis), kpis)
    chk("saldo do mês = R$ 700,00", any("Saldo no mês" in k and "700,00" in k for k in kpis), kpis)
    chk("saldo atual das contas = R$ 5.000,00", any("Saldo atual" in k and "5.000,00" in k for k in kpis), kpis)
    chk("faturamento do mês = R$ 1.000,00", any("Faturamento" in k and "1.000,00" in k for k in kpis), kpis)
    chk("custo do mês = R$ 340,00", any("Custo" in k and "340,00" in k for k in kpis), kpis)
    chk("margem bruta do mês = R$ 660,00", any("Margem bruta" in k and "660,00" in k for k in kpis), kpis)
    chk("gasto por categoria: Energia", "Energia" in txt(".pf-cats") and "800,00" in txt(".pf-cats"))
    chk("resumo do mês no gráfico", "Entradas:" in txt("#pf-resumo-mes"))
    chk("nome sempre escrito na legenda", "Entradas (recibos)" in corpo and "Saídas (contas pagas)" in corpo)

    # entrada pela barra de cima (como o Óleo e filtros): botão novo, e o menu lateral continua como era
    pg2 = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    pg2.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg2.goto(U + "#/painel"); pg2.wait_for_timeout(1400)
    chk("botão Painel Financeiro na barra de cima", pg2.eval_on_selector_all(".bt-fin", "l => l.length") == 1)
    pg2.click(".bt-fin"); pg2.wait_for_timeout(900)
    chk("botão leva à tela", "Painel Financeiro" in pg2.inner_text(".pf"))
    rolagem = pg2.evaluate("() => { const e = document.querySelector('.lateral'); return e ? e.scrollHeight - e.clientHeight : -1; }")
    chk("barra de menu sem rolagem em 1366x768", 0 <= rolagem <= 2, rolagem)
    chk("grupo Financeiro marcado nesta tela", pg2.get_attribute(".lateral .lateral-grupo:nth-of-type(3) .lateral-grupo-tit", "aria-current") == "page")
    pg2.close()

    # troca de mês pelos chips (mês anterior tem R$ 2.000,00 de entradas)
    if mes > 0:
      pg.eval_on_selector_all(".pf-meses .pf-mes", "(l, i) => l[i].click()", arg=mes - 1)
      pg.wait_for_timeout(400)
      kpis = pg.eval_on_selector_all(".pf-kpi", "l => l.map(e => e.textContent)")
      chk("mês anterior: entradas = R$ 2.000,00", any("Entradas no mês" in k and "2.000,00" in k for k in kpis), kpis)
      pg.eval_on_selector_all(".pf-meses .pf-mes", "(l, i) => l[i].click()", arg=mes); pg.wait_for_timeout(400)

    # meta de entradas (administrador define; anel mostra o percentual)
    chk("sem meta: explica o que é", "Sem meta definida" in txt(".pf"))
    pg.click("#pf-meta-abrir"); pg.wait_for_timeout(200)
    pg.fill("#pf-meta", "10000"); pg.click("#pf-meta-salvar"); pg.wait_for_timeout(800)
    chk("meta salva: orçado × realizado aparece", "da meta em" in txt(".pf"))
    chk("anel da meta = 15%", "15%" in txt(".pf-meta-mes"))
    pg.close()

    # ----- celular -----
    pg, _ = abrir(b, w=390, h=844)
    chk("celular: KPIs aparecem", "Entradas no mês" in txt(".pf"))
    chk("celular: sem rolagem horizontal", pg.evaluate("() => document.scrollingElement.scrollWidth <= 392"), pg.evaluate("() => document.scrollingElement.scrollWidth"))
    chk("celular: barra de baixo continua com 5 botões", pg.eval_on_selector_all(".nav button", "l => l.length") == 5)
    pg.goto(U + "#/mais"); pg.wait_for_timeout(900)
    chk("celular: entrada no menu Mais", "Painel Financeiro" in pg.inner_text(".pagina"))
    pg.close()

    # ----- papel sem acesso -----
    pg, _ = abrir(b, papel="mecanico")
    chk("mecânico não entra", "não tem acesso" in pg.inner_text(".pagina"))
    pg.close()

    b.close()
finally:
  srv.terminate()

print("\n".join("OK  " + x for x in ok))
if falhas: print("\n".join("FALHA  " + x for x in falhas))
if erros: print("\n".join("ERRO NA PÁGINA  " + x for x in erros))
print("\n%d OK, %d falha(s), %d erro(s) de página" % (len(ok), len(falhas), len(erros)))
sys.exit(1 if falhas or erros else 0)
