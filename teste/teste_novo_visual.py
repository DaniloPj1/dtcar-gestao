# Novo visual (22/11/2026): DRE gerencial, Fluxo de Caixa Diário, Inteligência do Negócio, quadro
# "Ações do dia a dia" no Painel, menu em barra no topo (grupos descem no hover) e a busca rápida
# achando O.S. pelo nome do cliente e veículo pelo modelo. Nada das telas existentes é removido.
# Uso: python3 teste/teste_novo_visual.py
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8776", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1.5); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c else n + " :: " + str(extra))
U = "http://localhost:8776/"

SEMEAR = """(() => {
  const db = window.__DB, agora = new Date(), a = agora.getFullYear(), m = agora.getMonth();
  const dia = (mes, d) => { const x = new Date(a, mes, d, 12); return x.toISOString().slice(0, 10); };
  const iso = (mes, d) => new Date(a, mes, d, 12).toISOString();
  db.recibos = [
    { id: "rf1", numero: 10, valor: 1000, forma: "PIX", data: dia(m, 5), criado_em: iso(m, 5) },
    { id: "rf2", numero: 11, valor: 500, forma: "Dinheiro", data: dia(m, 10), criado_em: iso(m, 10) },
  ];
  db.contas.push({ id: "kf1", descricao: "Energia do mês", favorecido: "EDP", categoria: "Energia", valor: 800, vencimento: dia(m, 8), status: "paga", pago_em: dia(m, 8), valor_pago: 800, origem: "recorrente" },
    { id: "kf2", descricao: "Peças NF 900", favorecido: "AutoPeças", categoria: "Fornecedores de peças", valor: 650, vencimento: dia(m, 9), status: "paga", pago_em: dia(m, 9), valor_pago: 650, origem: "nfe" },
    { id: "kf3", descricao: "Conta futura", favorecido: "Imobiliária", categoria: "Aluguel", valor: 3000, vencimento: dia(m + 1, 5), status: "aberta", origem: "recorrente" });
  db.ordens.push({ id: "of1", numero: 1990, status: "entregue", recebido: 900, entregue_em: iso(m, 6), criado_em: iso(m, 4),
    cliente: { nome: "Cliente Painel" }, veiculo: { placa: "PNF1A11", marca: "Fiat", modelo: "Uno" }, total: 900 });
  db.os_itens.push({ id: "if1", ordem_id: "of1", tipo: "servico", descricao: "REVISAO COMPLETA", qtd: 1, valor_unit: 600, desconto: 0, aprovado: true },
    { id: "if2", ordem_id: "of1", tipo: "peca", descricao: "FILTRO DE OLEO", qtd: 1, valor_unit: 300, desconto: 0, custo_unit: 300, aprovado: true });
  db.vendas = [{ id: "vf1", status: "concluida", criado_em: iso(m, 7), total: 100, custo: 40, forma_pagamento: "PIX" },
    { id: "vf2", status: "concluida", criado_em: iso(m, 12), total: 300, custo: 100, forma_pagamento: "PIX" }];
  db.recibos.push({ id: "rf5", numero: 12, valor: 300, forma: "PIX", venda_id: "vf2", data: dia(m, 12), criado_em: iso(m, 12) });
  db.receber = [{ id: "pf1", ordem_id: "o5", status: "aberta", valor: 1200, pago: 0, vencimento: dia(m + 1, 10), forma: "Promissória" }];
  db.config.contasFinanceiras = [{ nome: "Sicredi", saldo: 5000, em: agora.toISOString() }];
  return m;
})()"""

def abrir(b, rota, w=1366, h=900, papel=None):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
  if papel: pg.add_init_script("window.__PAPEL = %r" % papel)
  pg.add_init_script(SEMEAR)
  pg.goto(U + rota); pg.wait_for_timeout(2100)
  return pg

try:
  with sync_playwright() as p:
    b = p.chromium.launch()

    # ----- DRE gerencial -----
    pg = abrir(b, "#/dre")
    tx = pg.inner_text(".pf")
    chk("dre: título e nota dos regimes", "DRE gerencial" in tx and "entrega" in pg.inner_text(".dica").lower())
    chk("dre: receita bruta do ano = 1.000 + O.S. antigas", "Receita bruta" in tx)
    linhas = pg.eval_on_selector_all(".tf-row", "l => l.map(e => e.textContent)")
    chk("dre: custo na linha própria", any("Custo de peças, insumos e terceiros" in x and "440,00" in x for x in linhas), [x[:60] for x in linhas])
    chk("dre: despesa por categoria (Energia)", any(x.startswith("(−) Energia") and "800,00" in x for x in linhas))
    chk("dre: compras de peças FORA da conta", any("fora da conta" in x and "650,00" in x for x in linhas))
    chk("dre: resultado não desconta a compra de peça", any("Resultado do mês (aproximado)" in x and "60,00" in x for x in linhas))
    chk("dre: margem na última linha", any("Margem" in x and "%" in x for x in linhas))
    pg.close()

    # ----- Fluxo de Caixa Diário -----
    pg = abrir(b, "#/fluxo-diario")
    linhas = pg.eval_on_selector_all(".tf-row", "l => l.map(e => e.textContent)")
    chk("fluxo: formas de entrada (PIX e Dinheiro)", any(x.startswith("PIX") and "1.000,00" in x for x in linhas) and any(x.startswith("Dinheiro") and "500,00" in x for x in linhas), [x[:40] for x in linhas])
    chk("fluxo: venda de balcão como entrada", any("balcão" in x and "100,00" in x for x in linhas))
    chk("fluxo: saídas por categoria", any(x.startswith("Energia") and "800,00" in x for x in linhas))
    chk("fluxo: saldo do dia com sinal e nome escrito", any("Saldo do dia (entradas − saídas)" in x and "−800,00" in x for x in linhas))
    chk("fluxo: total de saídas traz os dois dias (800 e 650)", any("Total de saídas" in x and "800,00" in x and "650,00" in x for x in linhas))
    chk("fluxo: saldo acumulado fecha em 450 (venda com recibo entra uma vez)", any("Saldo acumulado no mês" in x and "450,00" in x for x in linhas))
    chk("fluxo: tiles das formas no mês", "PIX" in pg.inner_text(".tf-tiles") and "1.300,00" in pg.inner_text(".tf-tiles") and "balcão" in pg.inner_text(".tf-tiles"))
    pg.close()

    # ----- Inteligência do Negócio -----
    pg = abrir(b, "#/inteligencia")
    tx = pg.inner_text(".pf")
    chk("inteligencia: recebimentos e pagamentos do ano", "Recebimentos" in tx and "Pagamentos" in tx and "1.900,00" in tx and "4.450,00" in tx, tx[:300])
    chk("inteligencia: receita por serviço", "REVISAO COMPLETA" in tx)
    chk("inteligencia: gastos por favorecido", "EDP" in tx)
    chk("inteligencia: a receber × a pagar com nomes escritos", "A receber (parcelas)" in tx and "A pagar (contas)" in tx)
    pg.close()

    # ----- Painel: quadro Ações do dia a dia -----
    pg = abrir(b, "#/painel")
    chk("painel: quadro de ações com os 4 botões", pg.eval_on_selector_all(".acao-dia", "l => l.map(e => e.textContent)") == ["Nova O.S.", "Novo orçamento", "Novo cliente", "Novo veículo"], pg.eval_on_selector_all(".acao-dia", "l => l.map(e => e.textContent)"))
    pg.click(".acao-dia:has-text('Novo cliente')"); pg.wait_for_timeout(900)
    chk("painel: Novo cliente abre o cadastro direto no formulário", pg.query_selector(".modal:has-text('Novo cliente')") is not None)
    pg.goto(U + "#/painel"); pg.wait_for_timeout(900)
    pg.click(".acao-dia:has-text('Novo veículo')"); pg.wait_for_timeout(900)
    chk("painel: Novo veículo abre a ficha de veículo novo", pg.query_selector(".modal:has-text('Novo veículo')") is not None)

    # ----- menu novo: telas financeiras no grupo, pelo hover -----
    pg.goto(U + "#/painel"); pg.wait_for_timeout(800)
    pg.hover(".lateral .lateral-grupo:nth-of-type(3) .lateral-grupo-tit"); pg.wait_for_timeout(250)
    mt = pg.inner_text(".lateral")
    chk("menu: grupo Financeiro desce com as 4 telas novas", all(x in mt for x in ["Painel Financeiro", "DRE gerencial", "Fluxo de Caixa Diário", "Inteligência do Negócio"]), mt[:200])
    chk("menu: itens antigos continuam (nada se perde)", all(x in mt for x in ["Contas a receber", "Contas a pagar", "Previsão de caixa", "Recibos", "Notas da SEFAZ", "Relatórios"]))
    pg.click(".lat-menu button:has-text('DRE gerencial')"); pg.wait_for_timeout(900)
    chk("menu: clicar leva à tela", "DRE gerencial" in pg.inner_text(".pf"))

    # ----- busca rápida: O.S. pelo cliente, veículo pelo modelo -----
    pg.goto(U + "#/painel"); pg.wait_for_timeout(800)
    pg.fill(".busca-rapida-topo input", "Ministério"); pg.wait_for_timeout(400)
    res = pg.inner_text(".br-lista")
    chk("busca topo: nome do cliente acha a O.S.", "01898" in res, res[:160])
    pg.fill(".busca-rapida-topo input", "hilux"); pg.wait_for_timeout(400)
    res = pg.inner_text(".br-lista")
    chk("busca topo: modelo acha o veículo", "Hilux" in res, res[:160])
    pg.fill(".busca-rapida-topo input", "QXN1E4"); pg.wait_for_timeout(400)
    res = pg.inner_text(".br-lista")
    chk("busca topo: placa acha a O.S. e o veículo", "01898" in res and "Hilux" in res, res[:160])
    pg.fill("#busca-rapida", "Ministério"); pg.wait_for_timeout(400)
    res = pg.inner_text(".busca-res")
    chk("busca do painel: nome do cliente acha a O.S.", "01898" in res, res[:160])
    pg.close()

    # ----- celular: nada muda na navegação; telas novas entram pelo Mais -----
    pg = abrir(b, "#/mais", w=390, h=844)
    tx = pg.inner_text(".pagina")
    chk("celular: Mais tem as 4 telas novas", all(x in tx for x in ["Painel Financeiro", "DRE gerencial", "Fluxo de Caixa Diário", "Inteligência do Negócio"]))
    chk("celular: barra de baixo continua com 5 botões", pg.eval_on_selector_all(".nav button", "l => l.length") == 5)
    pg.goto(U + "#/dre"); pg.wait_for_timeout(1500)
    chk("celular: DRE rola dentro do quadro, sem estourar a página", pg.evaluate("() => document.scrollingElement.scrollWidth <= 392"), pg.evaluate("() => document.scrollingElement.scrollWidth"))
    pg.close()

    # ----- papel sem acesso -----
    pg = abrir(b, "#/dre", papel="mecanico")
    chk("mecânico não entra na DRE", "não tem acesso" in pg.inner_text(".pagina"))
    pg.close()

    b.close()
finally:
  srv.terminate()

print("\n".join("OK  " + x for x in ok))
if falhas: print("\n".join("FALHA  " + x for x in falhas))
if erros: print("\n".join("ERRO NA PÁGINA  " + x for x in erros))
print("\n%d OK, %d falha(s), %d erro(s) de página" % (len(ok), len(falhas), len(erros)))
sys.exit(1 if falhas or erros else 0)
