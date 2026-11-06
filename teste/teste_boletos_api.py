# Boletos pela API do Sicredi (função "sicredi") com dados simulados (teste/mock.js): Dados da carteira › API,
# teste de ligação no Sandbox, registro na hora com QR Code, Atualizar pagamentos (Pix vira recibo + baixa), pedido de baixa.
# Uso: python3 teste/teste_boletos_api.py
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); erros = []; ok = []; falhas = []
def chk(n, c, x=None): (ok if c else falhas).append(n if c or x is None else n + " (" + str(x) + ")")
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1600, "height": 950}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.add_init_script("""(() => { const d = window.__DB;
      d.config = { nome: "DTCAR CENTRO AUTOMOTIVO LTDA", cnpj: "49016409000195", cidade: "Colatina", espelhoLegado: false, cobranca: { modo: "api", ambiente: "sandbox", jurosMes: 2, multa: 2 } };
      Object.assign(d.clientes[0], { doc: "52998224725", rua: "Rua das Flores, 100", bairro: "Centro", cep: "29700-000", cidade: "Colatina", uf: "ES" });
      d.receber.push({ id: "r1", ordem_id: "o3", cliente_id: "c1", cliente_nome: "Cliente Teste", descricao: "OS 01897", forma: "Boleto", parcela: 1, parcelas: 2, valor: 450.5, vencimento: "2026-12-10", status: "aberta", criado_em: "2026-11-05T09:00:00-03:00" },
        { id: "r2", ordem_id: "o3", cliente_id: "c1", cliente_nome: "Cliente Teste", descricao: "OS 01897", forma: "Boleto", parcela: 2, parcelas: 2, valor: 450.5, vencimento: "2027-01-10", status: "aberta", criado_em: "2026-11-05T09:00:00-03:00" },
        { id: "r0", ordem_id: "o3", cliente_id: "c1", cliente_nome: "Cliente Teste", descricao: "OS 01823", forma: "Boleto", parcela: 1, parcelas: 1, valor: 1735.95, vencimento: "2026-11-20", status: "aberta", criado_em: "2026-11-02T15:00:00-03:00" });
      d.recibos = []; })()""")
    U = "http://localhost:8767/"
    pg.goto(U + "#/boletos"); pg.wait_for_timeout(2000)
    corpo = pg.inner_text("body")
    chk("modo API no subtítulo", "API do Sicredi (ambiente de teste)" in corpo)
    chk("aviso de Sandbox", "ambiente de teste do Sicredi (Sandbox)" in corpo)
    chk("sem chave Pix exigida pela API", "Chave Pix" not in corpo)
    chk("Sandbox: botão Registrar desligado", pg.is_disabled("button:has-text('Registrar no Sicredi')"))
    chk("parcela antiga (boleto já emitido fora) não aparece para emitir", "OS 01823" not in pg.inner_text(".lista") and "Emitir (2)" in corpo)
    chk("aviso das parcelas antigas", "1 parcela(s) de antes de 04/11/2026" in corpo and "PicPay" in corpo)
    chk("sem arquivo de teste no modo API", pg.query_selector("button:has-text('Arquivo de teste')") is None)
    # teste de ligação
    pg.click("button:has-text('Dados da carteira')"); pg.wait_for_timeout(400)
    pg.click("[role=dialog] button:has-text('Testar ligação (Sandbox)')"); pg.wait_for_timeout(600)
    t = pg.inner_text("[role=dialog]")
    chk("teste de ligação mostra os passos", "Token recebido" in t and "com QR Code Pix" in t)
    chk("teste não grava boleto", pg.evaluate("(window.__DB.boletos || []).length") == 0)
    pg.evaluate("window.__SICREDI_SEM_CODIGO = true")
    pg.click("[role=dialog] button:has-text('Conferir acesso de produção')"); pg.wait_for_timeout(500)
    chk("produção sem código de acesso: diz o que falta", "SICREDI_CODIGO_ACESSO" in pg.inner_text("[role=dialog]"))
    pg.evaluate("window.__SICREDI_SEM_CODIGO = false")
    pg.select_option("#cb-amb", "producao"); pg.click("[role=dialog] button:has-text('Salvar')"); pg.wait_for_timeout(800)
    chk("carteira salva em produção", pg.evaluate("window.__DB.config.cobranca.ambiente") == "producao" and pg.evaluate("window.__DB.config.cobranca.modo") == "api")
    # registrar 2 boletos
    pg.fill(".lista label:has-text('parcela 1/2') input.nf-boleto", "131")
    chk("digitar a NF não marca nem desmarca a parcela", not pg.is_checked(".lista label:has-text('parcela 1/2') input[type=checkbox]"))
    pg.check(".lista label:has-text('parcela 1/2') input[type=checkbox]"); pg.check(".lista label:has-text('parcela 2/2') input[type=checkbox]")
    pg.click("button:has-text('Registrar no Sicredi')"); pg.wait_for_timeout(400)
    chk("confirmação diz que registra agora", "registrados no banco AGORA" in pg.inner_text("[role=dialog]"))
    pg.click("[role=dialog] button:has-text('Registrar')"); pg.wait_for_timeout(1500)
    bol = pg.evaluate("window.__DB.boletos")
    chamadas = pg.evaluate("window.__SICREDI.chamadas.filter(c => c.acao === 'emitir')")
    chk("2 boletos registrados pela API", len(bol) == 2 and all(x["situacao"] == "registrado" and not x.get("remessa_id") for x in bol))
    chk("boleto com Pix copia e cola da API", bol[0]["qr_url"].startswith("000201") and bol[0]["txid"])
    chk("emitir: juros, multa e pagador vão ao servidor", chamadas[0]["boleto"]["juros_mes"] == 2 and chamadas[0]["boleto"]["multa"] == 2 and chamadas[0]["boleto"]["pagador"]["cep"] == "29700000" and chamadas[0]["ambiente"] == "producao")
    chk("referência com O.S., NF e parcela vai ao banco", chamadas[0]["boleto"]["mensagem"] == "REF. O.S. 1897 - NF 131 - PARCELA 1/2", chamadas[0]["boleto"].get("mensagem"))
    chk("sem NF: referência só com O.S. e parcela", chamadas[1]["boleto"]["mensagem"] == "REF. O.S. 1897 - PARCELA 2/2")
    chk("NF gravada na descrição do boleto", "NF 131" in bol[0]["descricao"] and "NF" not in bol[1]["descricao"])
    chk("emitir: id do título = parcela (rastreio)", chamadas[0]["boleto"]["id_titulo"] == "r1")
    chk("resultado mostra nosso número", "registrado, nosso número" in pg.inner_text("[role=dialog]"))
    pg.screenshot(path=SAIDA + "/ba1-registrado.png")
    pg.click("[role=dialog] button:has-text('Fechar')"); pg.wait_for_timeout(300)
    # PDF com o Pix da API
    pg.click(".abas button:has-text('Em aberto')"); pg.wait_for_timeout(400)
    with pg.expect_download() as d1:
        pg.click(".lista .linha:has-text('parcela 1/2') button:has-text('PDF')")
    chk("PDF gerado", open(d1.value.path(), "rb").read()[:4] == b"%PDF")
    # pagamento por Pix aparece no Atualizar pagamentos
    nn1 = bol[0]["nosso_numero"]
    pg.evaluate("(nn) => { window.__SICREDI.situacao[nn] = 'LIQUIDADO PIX'; window.__SICREDI.valorPago = 455.0; }", nn1)
    pg.click("button:has-text('Atualizar pagamentos')"); pg.wait_for_timeout(1500)
    t = pg.inner_text("[role=dialog]")
    rec = pg.evaluate("window.__DB.recibos"); parc = pg.evaluate("window.__DB.receber.find(p => p.id === 'r1')")
    chk("pago por Pix: recibo na conta Sicredi", len(rec) == 1 and rec[0]["valor"] == 455 and rec[0]["forma"] == "Pix" and rec[0]["conta_destino"] == "Sicredi")
    chk("pago: parcela baixada e data do banco", parc["status"] == "paga" and pg.evaluate("window.__DB.boletos[0].data_pagamento") == "2026-11-06")
    chk("o outro continua em aberto", "pago por Pix" in t and pg.evaluate("window.__DB.boletos[1].situacao") == "registrado")
    pg.click("[role=dialog] button:has-text('Fechar')"); pg.wait_for_timeout(300)
    pg.click("button:has-text('Atualizar pagamentos')"); pg.wait_for_timeout(1200)
    chk("atualizar de novo não duplica recibo", len(pg.evaluate("window.__DB.recibos")) == 1)
    pg.click("[role=dialog] button:has-text('Fechar')"); pg.wait_for_timeout(300)
    # baixa pela API
    pg.click(".abas button:has-text('Em aberto')"); pg.wait_for_timeout(300)
    pg.click(".lista .linha:has-text('parcela 2/2') button:has-text('Pedir baixa')"); pg.wait_for_timeout(300)
    pg.click("[role=dialog] button:has-text('Pedir baixa')"); pg.wait_for_timeout(1000)
    chk("baixa pedida pela API", pg.evaluate("window.__DB.boletos[1].situacao") == "baixa_pedida" and any(c["acao"] == "baixar" for c in pg.evaluate("window.__SICREDI.chamadas")))
    pg.click("button:has-text('Atualizar pagamentos')"); pg.wait_for_timeout(1200)
    chk("depois da consulta: baixado", pg.evaluate("window.__DB.boletos[1].situacao") == "baixado")
    chk("parcela 2 continua em aberto (baixa não recebe)", pg.evaluate("window.__DB.receber.find(p => p.id === 'r2').status") == "aberta")
    pg.screenshot(path=SAIDA + "/ba2-atualizado.png")
    # v41: reserva do Claude sem resposta do banco — sem PDF/linha/WhatsApp, só "Liberar reserva"
    pg.evaluate("""window.__DB.boletos.push({ id: 'res1', receber_id: 'r2', ordem_id: null, os_numero: '1887', pagador_nome: 'Reserva Teste', pagador_doc: '', pagador: {},
      descricao: 'O.S. 1887', valor: 50, vencimento: '2026-12-20', emissao: '2026-11-06', nosso_numero: '000123456', seu_numero: '1887-9', codigo_barras: '', linha_digitavel: '',
      situacao: 'gerado', ocorrencia: 'Reservado pelo agente', qr_url: '', txid: '', criado_por: 'Danilo', criado_em: '2026-11-06T10:00:00Z' })""")
    pg.goto(U + "#/painel"); pg.wait_for_timeout(500); pg.goto(U + "#/boletos"); pg.wait_for_timeout(1500)
    pg.click(".abas button:has-text('Em aberto')"); pg.wait_for_timeout(300)
    lin = pg.locator(".lista .linha:has-text('Reserva Teste')")
    chk("reserva aparece como reservada, sem PDF/Copiar/WhatsApp", lin.count() == 1 and "Reservado pelo Claude" in lin.inner_text()
        and lin.locator("button:has-text('PDF'), button:has-text('Copiar linha'), a:has-text('WhatsApp'), button:has-text('Pedir baixa')").count() == 0)
    lin.locator("button:has-text('Liberar reserva')").click(); pg.wait_for_timeout(300)
    pg.click("[role=dialog] button:has-text('Liberar')"); pg.wait_for_timeout(800)
    chk("liberar a reserva: vira rejeitado (a parcela pode receber boleto)", pg.evaluate("window.__DB.boletos.find(x => x.id === 'res1').situacao") == "rejeitado")
    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("\n".join(erros) or "sem erros de página")
sys.exit(1 if falhas or erros else 0)
