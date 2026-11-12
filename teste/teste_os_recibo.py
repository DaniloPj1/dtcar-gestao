# O.S. Recibo (12/11/2026): O.S. › Imprimir O.S. › "O.S. Recibo" → #/imprimir/osrecibo/<id>[?motor=0].
# Confere: a opção só aparece na O.S. paga (fechada); dados do cliente/veículo, itens aprovados, total, "Recebemos de",
# prazo e condições da garantia com a data de validade, cuidados do motor (e sem eles com motor=0), uma folha A4 no caso
# da Parati (O.S. 1854, 25 itens), o aviso na tela quando a O.S. não está paga, e que a O.S. normal continua igual.
# Também abre no celular sem rolagem lateral.
# Uso: python3 teste/teste_os_recibo.py   (precisa de: pip install playwright && playwright install chromium; pdfinfo)
import subprocess, time, sys, os, tempfile, re, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8768", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra))
U = "http://localhost:8768/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
ITENS = [("peca", d, q, v) for d, q, v in [
  ("BRONZINA DE BIELA VW GOL/VOYAGE/SAVEIRO AP 85/", 1, 97), ("BRONZINA CENTRAL VW GOL 1.0 MI AT 8/16V — METAL LEVE", 1, 142.55),
  ("BOMBA DE ÓLEO VW GOL/SAVEIRO AP 1.6/1.8/2.0 86/", 1, 241.5), ("JG PISTÃO ML 1MM", 1, 980), ("RETENTOR VOLANTE VW GOL/PASSAT/SANTANA", 1, 280),
  ("JUNTA DO MOTOR VW GOL/SAVEIRO/SANTANA 1.6/1.8 MI", 1, 478), ("ARRUELA DE ENCOSTO", 2, 128), ("PARAFUSO DO CABEÇOTE VW GOL/VOYAGE/SAVEIRO 82/96", 1, 138.35),
  ("TUCHO DE VALVULA VW GOL/PARATI/SAVEIRO/SANTANA AP", 1, 237), ("BOMBA D'ÁGUA VW GOL/SAVEIRO/SANTANA 97/ MI", 1, 119),
  ("VALVULA TERMOSTÁTICA VW GOL/SAVEIRO AP 1.6/1.8 86", 1, 57.2), ("PLUG DE INJEÇÃO FIAT PALIO 1.0/1.5 / GOL 1.6 MI", 1, 49),
  ("FILTRO DE OLEO VW GOL/PASSAT/SANTANA", 1, 21.25), ("FILTRO DE COMBUSTÍVEL VW GOL G2/G3 MI 97/", 1, 24), ("SILICONE PRETO 85G ULTRA 999", 2, 55),
  ("OLEO MOTOR", 4, 48), ("THINNER LIMPEZA", 1, 75), ("CABEÇOTE COMPLETO (MONTADO)", 1, 2800), ("ADITIVO", 4, 35),
  ("COXIM DO RADIADOR VW GOL PARATI SAVEIRO", 1, 35.7), ("CARCACA BOMBA D'AGUA VW GOL/SAVEIRO AP", 1, 155.96),
  ("JUNTA CABECOTE VW GOL 1.6/1.8 (METALICA)", 1, 0), ("TENSOR DA CORREIA DE ACESSORIO", 1, 270)]] + [
  ("servico", "SERVIÇO DE MOTOR", 1, 3500), ("terceiro", "Retífica", 1, 2985)]
PREP = """([itens, pago, recibos]) => { const db = window.__DB;
  db.ordens.unshift({ id: 'p1', numero: 1854, status: 'entregue', cliente_id: 'c1', veiculo_id: 'v1', mecanico_nome: 'FRANCISCO', criado_em: '2026-10-06T14:54:00-03:00',
    entregue_em: '2026-11-12T16:00:00-03:00', km_saida: 182340, garantia_dias: 90, total: 13384.51, recebido: pago ? 13384.51 : 0, finalizada_em: pago ? '2026-11-12T16:05:00-03:00' : null,
    forma_pagamento: 'Pix', cliente: { nome: 'Miqueias', telefone: '27995302524' }, veiculo: { placa: 'MRE1D03', marca: 'Volkswagen', modelo: 'Parati 1.6', ano: '1999', cor: 'Vermelha' }, checkin: { feito: true }, tabela_preco: 'vista' });
  itens.forEach(([tipo, descricao, qtd, valor_unit], n) => db.os_itens.push({ id: 'pi' + n, ordem_id: 'p1', tipo, descricao, qtd, valor_unit, desconto: 0, aprovado: true, executado: true, posicao: n }));
  db.recibos = (db.recibos || []).filter(r => r.ordem_id !== 'p1').concat(recibos.map((r, n) => ({ id: 'pr' + n, numero: 900 + n, ordem_id: 'p1', criado_em: r[0] + 'T16:05:00-03:00', data: r[0], forma: r[1], valor: r[2], pagador: 'Miqueias' }))); }"""
def abrir(b, rota, w=1366, h=900, pago=True, recibos=(("2026-11-12", "Pix", 13384.51),)):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
  pg.goto(U + "#/ordens"); pg.wait_for_timeout(1500)
  pg.evaluate(PREP, [ITENS, pago, [list(r) for r in recibos]])
  pg.goto(U + rota); pg.wait_for_timeout(1600)
  return pg
def paginas(pg, nome):
  pdf = os.path.join(TMP, nome + ".pdf"); pg.pdf(path=pdf, format="A4", prefer_css_page_size=True)
  return int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout).group(1))
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    pg = abrir(b, "#/imprimir/osrecibo/p1")
    t = pg.inner_text(".folha.osrec").replace("\xa0", " ")
    for k in ["RECIBO DE ORDEM DE SERVIÇO", "O.S. Nº 01854", "Miqueias", "MRE1D03", "182.340", "12/11/2026", "FRANCISCO", "CABEÇOTE COMPLETO (MONTADO)",
              "SERVIÇO DE MOTOR", "Retífica", "VALOR TOTAL DA O.S.: R$ 13.384,51", "Recebemos de", "treze mil", "pago em pix", "dando plena quitação",
              "90 (noventa) dias", "válida até 10/02/2027", "troca de óleo e filtro aos 1.000 km", "TROCA DE ÓLEO E FILTRO DE ÓLEO AOS 1.000 KM", "3.000 rpm",
              "Declaro ter recebido o veículo"]:
      chk("com motor: tem " + k, k.lower() in t.lower(), k)
    chk("paga: sem o aviso de O.S. não paga", "ainda não está paga" not in t)
    n = paginas(pg, "parati_motor"); chk("Parati (25 itens, com motor): até 2 folhas A4", n <= 2, n)
    pg.screenshot(path=os.path.join(TMP, "osrecibo_pc.png"), full_page=True)
    pg.click(".imp-barra button:has-text('Sem cuidados do motor')"); pg.wait_for_timeout(1200)
    t2 = pg.inner_text(".folha.osrec")
    chk("sem motor: rota com motor=0", pg.evaluate("location.hash") == "#/imprimir/osrecibo/p1?motor=0")
    chk("sem motor: sem a seção de cuidados", "CUIDADOS PARA NÃO PERDER" not in t2.upper() and "1.000 KM" not in t2.upper())
    chk("sem motor: continua com prazo e condições", "PRAZO E CONDIÇÕES DA GARANTIA" in t2.upper() and "90 (noventa) dias" in t2)
    pg.close()
    # dois pagamentos: soma, formas e a lista
    pg = abrir(b, "#/imprimir/osrecibo/p1", recibos=(("2026-11-10", "Dinheiro", 5000), ("2026-11-12", "Pix", 8384.51)))
    t = pg.inner_text(".folha.osrec").replace("\xa0", " ")
    chk("dois pagamentos: soma", "R$ 13.384,51" in t and "dinheiro, Pix" in t, t[:0])
    chk("dois pagamentos: lista com datas", "10/11/2026 · Dinheiro · R$ 5.000,00" in t and "12/11/2026 · Pix · R$ 8.384,51" in t)
    chk("pago em: data do último recibo", "Pago em 12/11/2026" in t); pg.close()
    # O.S. não paga: aviso na tela (não sai na impressão)
    pg = abrir(b, "#/imprimir/osrecibo/p1", pago=False, recibos=())
    chk("não paga: aviso na tela", "ainda não está paga" in pg.inner_text(".folha.osrec"))
    chk("não paga: aviso fora da impressão", pg.evaluate("document.querySelector('.osr-aviso').classList.contains('so-tela')")); pg.close()
    # janela do Imprimir: opção só na O.S. paga, com a caixa dos cuidados do motor
    pg = abrir(b, "#/os/p1")
    pg.click("button:has-text('Imprimir O.S.')"); pg.wait_for_timeout(500)
    chk("janela (paga): mostra O.S. Recibo", pg.query_selector(".modal button:has-text('O.S. Recibo')") is not None)
    pg.click(".modal button:has-text('O.S. Recibo')"); pg.wait_for_timeout(300)
    chk("janela: cuidados do motor marcados", pg.is_checked(".modal .linha-check input"))
    pg.uncheck(".modal .linha-check input"); pg.click(".modal button:has-text('Visualizar e imprimir')"); pg.wait_for_timeout(1500)
    chk("janela: abre sem o motor", pg.evaluate("location.hash") == "#/imprimir/osrecibo/p1?motor=0" and pg.query_selector(".folha.osrec") is not None)
    pg.click(".imp-barra button:has-text('Voltar')"); pg.wait_for_timeout(1200)
    pg.click("button:has-text('Imprimir O.S.')"); pg.wait_for_timeout(500)
    pg.click(".modal button:has-text('Visualizar e imprimir')"); pg.wait_for_timeout(1500)
    chk("janela: Folha A4 continua abrindo a O.S. normal", pg.evaluate("location.hash").startswith("#/imprimir/os/p1") and pg.query_selector(".folha.os-a4") is not None)
    chk("O.S. normal: continua 'Não vale como recibo'", "não vale como recibo" in pg.inner_text(".folha.os-a4").lower())
    pg.close()
    pg = abrir(b, "#/os/p1", pago=False, recibos=())
    pg.click("button:has-text('Imprimir O.S.')"); pg.wait_for_timeout(500)
    chk("janela (a receber): sem O.S. Recibo", pg.query_selector(".modal button:has-text('O.S. Recibo')") is None); pg.close()
    # celular
    pg = abrir(b, "#/imprimir/osrecibo/p1", 393, 852)
    chk("celular: sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    pg.screenshot(path=os.path.join(TMP, "osrecibo_celular.png"), full_page=True); pg.close()
    b.close()
finally:
  srv.terminate()
chk("sem erros de página", not erros, erros)
for f in falhas: print("FALHOU:", f)
print(f"{len(ok)} OK, {len(falhas)} falha(s)")
sys.exit(1 if falhas else 0)
