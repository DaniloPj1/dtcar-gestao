# Boletos Sicredi (CNAB240 híbrido) de ponta a ponta com dados simulados (teste/mock.js):
# parcela "Boleto" → remessa → retorno com registro e QR Code → retorno com pagamento (recibo + baixa da parcela),
# retorno repetido recusado, cliente sem endereço bloqueado, arquivo de teste e PDF.
# Uso: python3 teste/teste_boletos.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, json, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); erros = []; ok = []; falhas = []
def chk(n, c): (ok if c else falhas).append(n)

def reg(campos):
    """monta uma linha de 240 posições a partir de {posição inicial (1-based): texto}"""
    l = [" "] * 240
    for ini, txt in campos.items():
        for k, ch in enumerate(txt): l[ini - 1 + k] = ch
    return "".join(l)

def retorno(seq, titulos):
    L = [reg({1: "74800000", 18: "2", 19: "49016409000195", 53: "00523", 59: "000000085453", 71: "7", 73: "DTCAR CENTRO AUTOMOTIVO LTDA", 103: "SICREDI", 143: "2", 144: "04112026", 152: "060000", 158: str(seq).zfill(6), 164: "081"}),
         reg({1: "74800011T01", 14: "040", 18: "2", 19: "049016409000195"})]
    n = 0
    for t in titulos:
        n += 1; L.append(reg({1: "7480001", 8: "3", 9: str(n).zfill(5), 14: "T", 16: t["mov"], 38: t["nn"], 59: t.get("seu", ""), 74: "10122026", 82: str(int(round(t["valor"] * 100))).zfill(15), 131: "09", 199: str(int(round(t.get("tarifa", 0) * 100))).zfill(15), 214: t.get("motivo", "00").ljust(10)}))
        n += 1; L.append(reg({1: "7480001", 8: "3", 9: str(n).zfill(5), 14: "U", 16: t["mov"], 18: "0" * 15, 78: str(int(round(t.get("pago", 0) * 100))).zfill(15), 93: str(int(round(t.get("pago", 0) * 100))).zfill(15), 138: t.get("data", "05112026"), 146: t.get("data", "05112026")}))
        if t.get("url"):
            n += 1; L.append(reg({1: "7480001", 8: "3", 9: str(n).zfill(5), 14: "Y", 16: t["mov"], 18: "03", 82: t["url"], 159: "TXID0000000000000000000000001"}))
    L.append(reg({1: "74800015", 18: str(n + 2).zfill(6)}))
    L.append(reg({1: "74899999", 18: "000001", 24: str(len(L) + 1).zfill(6)}))
    return "\r\n".join(L) + "\r\n"

try:
  with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1600, "height": 950}, accept_downloads=True); pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.add_init_script("""(() => { const d = window.__DB;
      d.config = { nome: "DTCAR CENTRO AUTOMOTIVO LTDA", cnpj: "49016409000195", endereco: "Rod. Gether Lopes de Farias, 491", cidade: "Colatina", espelhoLegado: false,
        cobranca: { chavePix: "093a8b6a-6e9d-4ed1-922a-ebb1c4452963", jurosMes: 2, multa: 2 } };
      Object.assign(d.clientes[0], { doc: "52998224725", rua: "Rua das Flores, 100", bairro: "Centro", cep: "29700-000", cidade: "Colatina", uf: "ES" });
      d.clientes.push({ id: "c2", nome: "Sem Endereço Ltda", telefone: "27988887777", doc: "", situacao: "liberado" });
      d.receber.push({ id: "r1", ordem_id: "o3", cliente_id: "c1", cliente_nome: "Cliente Teste", descricao: "OS 01897 · ABC1D23", forma: "Boleto", parcela: 1, parcelas: 2, valor: 450.5, vencimento: "2026-12-10", status: "aberta", criado_em: "2026-11-05T09:00:00-03:00" },
        { id: "r2", ordem_id: "o4", cliente_id: "c2", cliente_nome: "Sem Endereço Ltda", descricao: "OS 01896", forma: "Boleto", parcela: 1, parcelas: 1, valor: 300, vencimento: "2026-12-15", status: "aberta", criado_em: "2026-11-05T09:00:00-03:00" },
        { id: "r3", ordem_id: "o4", cliente_id: "c1", cliente_nome: "Cliente Teste", descricao: "OS 01896", forma: "Promissória", parcela: 1, parcelas: 1, valor: 99, vencimento: "2026-12-15", status: "aberta", criado_em: "2026-11-05T09:00:00-03:00" });
      d.recibos = []; })()""")
    U = "http://localhost:8766/"
    pg.goto(U + "#/receber"); pg.wait_for_timeout(2000)
    chk("contas a receber: botão Boletos Sicredi", pg.query_selector("button:has-text('Boletos Sicredi')") is not None)
    pg.click("button:has-text('Boletos Sicredi')"); pg.wait_for_timeout(1500)
    corpo = pg.inner_text("body")
    chk("tela de boletos abre", "Boletos Sicredi" in corpo and "0523.16.85453" in corpo)
    chk("só parcelas Boleto (promissória fora)", "Emitir (2)" in corpo)
    chk("cliente sem cadastro completo bloqueado", "Falta no cadastro" in corpo and "CPF/CNPJ do cliente" in corpo)
    caixas = pg.query_selector_all(".lista input[type=checkbox]")
    chk("checkbox do cliente sem endereço desabilitado", any(c.is_disabled() for c in caixas))
    pg.screenshot(path=SAIDA + "/b1-emitir.png")
    # arquivo de teste para homologação (nada é gravado)
    pg.check(".lista label:has-text('Cliente Teste') input[type=checkbox]")
    with pg.expect_download() as d1:
        pg.click("button:has-text('Arquivo de teste')")
    teste_nome = d1.value.suggested_filename
    pg.wait_for_timeout(1500)
    chk("arquivo de teste: nome CCCCCMDD.9xx", teste_nome.startswith("85453") and ".9" in teste_nome)
    chk("arquivo de teste não grava boleto", pg.evaluate("(window.__DB.boletos || []).length") == 0)
    # remessa real
    pg.check(".lista label:has-text('Cliente Teste') input[type=checkbox]")
    pg.click("button:has-text('Gerar remessa')"); pg.wait_for_timeout(500)
    chk("pede confirmação com valor", "450,50" in pg.inner_text("[role=dialog]"))
    with pg.expect_download() as d2:
        pg.click("button:has-text('Gerar arquivo')")
    caminho = d2.value.path(); remessa = open(caminho, encoding="ascii", newline="").read()
    pg.wait_for_timeout(1200)
    linhas = remessa.split("\r\n")[:-1]
    chk("remessa: todas as linhas com 240 posições", all(len(l) == 240 for l in linhas))
    chk("remessa: termina com CRLF", remessa.endswith("\r\n"))
    chk("remessa: segmentos P Q R Y", [l[13] for l in linhas[2:-2]] == ["P", "Q", "R", "Y"])
    chk("remessa: chave Pix no Y04", "093a8b6a-6e9d-4ed1-922a-ebb1c4452963" in linhas[5] and linhas[5][17:19] == "04")
    chk("remessa: CEP e UF do cliente", linhas[3][128:136] == "29700000" and linhas[3][151:153] == "ES")
    chk("remessa: valor e vencimento", linhas[2][85:100] == "000000000045050" and linhas[2][77:85] == "10122026")
    chk("remessa: juros 2% a.m. a partir do dia seguinte", linhas[2][117] == "2" and linhas[2][118:126] == "11122026" and linhas[2][126:141] == "000000000000200")
    chk("remessa: multa 2% no segmento R", linhas[4][65] == "2" and linhas[4][74:89] == "000000000000200")
    chk("remessa: trailer conta as linhas", linhas[-1][23:29] == str(len(linhas)).zfill(6))
    bol = pg.evaluate("window.__DB.boletos")
    chk("boleto gravado aguardando o banco", len(bol) == 1 and bol[0]["situacao"] == "gerado" and bol[0]["remessa_id"])
    nn = bol[0]["nosso_numero"]
    chk("nosso número 26/2xxxxx-D", len(nn) == 9 and nn[:3] == "262")
    chk("linha digitável válida (leitor do sistema)", pg.evaluate("import('/js/boleto.js').then(m => { const r = m.lerBoleto('%s'); return r.ok && r.valor === 450.5 && r.vencimento === '2026-12-10'; })" % bol[0]["linha_digitavel"]))
    pg.click("[role=dialog] button:has-text('Fechar')"); pg.wait_for_timeout(300)
    corpo = pg.inner_text("body")
    chk("parcela sai da lista de emitir", "Emitir (1)" in corpo)
    # retorno 1: entrada confirmada + QR Code
    tmp = tempfile.mkdtemp()
    r1 = os.path.join(tmp, "85453N05.CRT"); open(r1, "w", newline="").write(retorno(1, [{ "mov": "02", "nn": nn, "valor": 450.5, "url": "pix-qrcode.sicredi.com.br/qr/v2/cobv/c1f7e23631cd49c8be2ec56551f12977" }, { "mov": "28", "nn": nn, "valor": 450.5, "tarifa": 1.9, "motivo": "13" }]))
    pg.click(".abas button:has-text('Retorno e arquivos')"); pg.wait_for_timeout(400)
    pg.set_input_files("input[type=file]", r1); pg.wait_for_timeout(1500)
    b0 = pg.evaluate("window.__DB.boletos[0]")
    chk("retorno: boleto registrado", b0["situacao"] == "registrado")
    chk("retorno: QR Code guardado", b0["qr_url"].startswith("pix-qrcode.sicredi.com.br"))
    chk("retorno: tarifa somada", abs(b0["tarifa"] - 1.9) < 0.001)
    pg.screenshot(path=SAIDA + "/b2-retorno.png")
    pg.click("[role=dialog] button:has-text('Fechar')"); pg.wait_for_timeout(300)
    # o mesmo arquivo de novo é recusado
    pg.set_input_files("input[type=file]", r1); pg.wait_for_timeout(1000)
    chk("retorno repetido recusado", "já foi importado" in pg.inner_text(".erros"))
    # PDF do boleto com QR
    pg.click(".abas button:has-text('Em aberto')"); pg.wait_for_timeout(400)
    with pg.expect_download() as d3:
        pg.click(".lista button:has-text('PDF')")
    pdf = open(d3.value.path(), "rb").read()
    chk("PDF do boleto gerado", pdf[:4] == b"%PDF" and len(pdf) > 5000 and d3.value.suggested_filename.startswith("boleto-os1897"))
    open(os.path.join(SAIDA, "b3-boleto.pdf"), "wb").write(pdf)
    chk("WhatsApp com linha e Pix copia e cola", "br.gov.bcb.pix" in (pg.get_attribute(".lista a:has-text('WhatsApp')", "href") or "").replace("%2F", "/").replace("%2E", "."))
    # retorno 2: liquidação por Pix (61) com juros
    r2 = os.path.join(tmp, "85453N06.CRT"); open(r2, "w", newline="").write(retorno(2, [{ "mov": "61", "nn": nn, "valor": 450.5, "pago": 460.0, "data": "06112026" }]))
    pg.click(".abas button:has-text('Retorno e arquivos')"); pg.wait_for_timeout(400)
    pg.set_input_files("input[type=file]", r2); pg.wait_for_timeout(1800)
    b0 = pg.evaluate("window.__DB.boletos[0]"); rec = pg.evaluate("window.__DB.recibos"); parc = pg.evaluate("window.__DB.receber.find(p => p.id === 'r1')")
    chk("pagamento: boleto pago por Pix", b0["situacao"] == "pago" and b0["forma_pagamento"] == "Pix" and b0["data_pagamento"] == "2026-11-06")
    chk("pagamento: um recibo na conta Sicredi", len(rec) == 1 and rec[0]["valor"] == 460 and rec[0]["conta_destino"] == "Sicredi" and rec[0]["forma"] == "Pix" and b0["recibo_id"] == rec[0]["id"])
    chk("pagamento: recibo cita juros", "juros/multa" in rec[0]["obs"])
    chk("pagamento: parcela baixada", parc["status"] == "paga" and parc["recibo_id"] == rec[0]["id"])
    pg.screenshot(path=SAIDA + "/b4-pago.png")
    pg.click("[role=dialog] button:has-text('Fechar')"); pg.wait_for_timeout(300)
    # o mesmo pagamento em outro arquivo não vira segundo recibo
    r3 = os.path.join(tmp, "85453N07.CRT"); open(r3, "w", newline="").write(retorno(3, [{ "mov": "06", "nn": nn, "valor": 450.5, "pago": 460.0 }, { "mov": "02", "nn": "269999990", "valor": 1 }]))
    pg.set_input_files("input[type=file]", r3); pg.wait_for_timeout(1500)
    corpo = pg.inner_text("[role=dialog]")
    chk("pagamento repetido não duplica recibo", len(pg.evaluate("window.__DB.recibos")) == 1 and "já registrado" in corpo)
    chk("nosso número desconhecido avisado", "não encontrado" in corpo)
    pg.click("[role=dialog] button:has-text('Fechar')"); pg.wait_for_timeout(300)
    chk("arquivos guardados (2 remessa/retorno + 3 retornos)", pg.evaluate("window.__DB.boletos_arquivos.length") == 4)
    # tela no celular
    pg.set_viewport_size({"width": 390, "height": 844}); pg.wait_for_timeout(500)
    pg.click(".abas button:has-text('Pagos')"); pg.wait_for_timeout(400)
    chk("celular: sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    pg.screenshot(path=SAIDA + "/b5-celular.png")
    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("\n".join(erros) or "sem erros de página")
sys.exit(1 if falhas or erros else 0)
