# Cadastros começando pelo que as consultas preenchem (pedido do Danilo em 15/11/2026):
# cliente pelo CPF, endereço pelo CEP, veículo pela placa. Confere a ordem dos campos na ficha do cliente, na Nova O.S.
# (cliente novo, agora com CEP), na ficha do fornecedor e na ficha do veículo, no PC e no celular, e o que é gravado.
# ViaCEP de mentira e dados simulados (teste/mock.js): nenhuma chamada sai para a internet.
# Uso: python3 teste/teste_cadastros_apis.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8793", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
U = "http://localhost:8793/"
VIA = {"29705390": {"cep": "29705-390", "logradouro": "Rodovia Gether Lopes de Farias", "bairro": "Carlos Germano Naumann", "localidade": "Colatina", "uf": "ES", "ibge": "3201506"},
       "29100010": {"cep": "29100-010", "logradouro": "Avenida Champagnat", "bairro": "Centro", "localidade": "Vila Velha", "uf": "ES", "ibge": "3205200"}}
def via(route):
    c = route.request.url.rstrip("/").split("/")[-2]
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(VIA.get(c) or {"erro": "true"}))
# posição de cada campo na ordem em que a pessoa passa por eles (ordem do documento)
ORDEM = "(ids => { const t = Array.from(document.querySelectorAll('input, select, textarea')); return ids.map(i => t.findIndex(e => e.id === i)); })"
def crescente(l): return all(x >= 0 for x in l) and all(a < b for a, b in zip(l, l[1:]))
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    for nome, vp in (("pc", {"width": 1400, "height": 950}), ("celular", {"width": 390, "height": 800})):
      ctx = b.new_context(viewport=vp); pg = ctx.new_page()
      pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
      pg.route("https://viacep.com.br/**", via); pg.route("https://opencep.com/**", lambda r: r.fulfill(status=404, body="{}"))
      pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
      T = lambda s: nome + ": " + s
      val = lambda sel: pg.input_value(sel)
      ordem = lambda ids: pg.evaluate(ORDEM + "(" + json.dumps(ids) + ")")
      larg = lambda: pg.evaluate("document.documentElement.scrollWidth")

      # ================= ficha do cliente =================
      pg.goto(U + "#/cadastros?aba=clientes"); pg.wait_for_timeout(2500)
      pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(500)
      o = ordem(["c-doc", "c-nome", "c-fantasia", "c-telefone", "c-cep", "c-rua", "c-complemento", "c-bairro", "c-cidade", "c-uf"])
      chk(T("cliente: começa pelo CPF, depois nome e telefone; endereço começa pelo CEP"), crescente(o), o)
      chk(T("cliente: o CPF está à vista ao abrir, sem trocar de aba"), pg.is_visible("#c-doc") and pg.is_visible("#c-cep"))
      pg.fill("#c-doc", "529.982.247-25"); pg.wait_for_timeout(1500)
      chk(T("cliente: CPF preenche o nome"), val("#c-nome") == "MARIA APARECIDA DE SOUZA", val("#c-nome"))
      pg.fill("#c-cep", "29100010"); pg.wait_for_timeout(1000)
      chk(T("cliente: CEP preenche rua, bairro, cidade e UF"), val("#c-rua") == "Avenida Champagnat" and val("#c-bairro") == "Centro" and val("#c-cidade") == "Vila Velha" and val("#c-uf") == "ES",
          [val("#c-rua"), val("#c-bairro"), val("#c-cidade"), val("#c-uf")])
      pg.click(".modal button:has-text('Documentos, filiação e crédito')"); pg.wait_for_timeout(300)
      chk(T("cliente: na aba de documentos ficam RG e nascimento (preenchido pelo CPF); o CPF não aparece duas vezes"), val("#c-nasc") == "1985-07-15" and pg.locator("#c-doc").count() == 1 and pg.query_selector("#c-rg") is not None)
      chk(T("cliente: a ficha não passa da largura da tela"), larg() <= vp["width"] + 2, larg())
      pg.click(".modal button:has-text('Endereço e contatos')"); pg.wait_for_timeout(200)
      pg.screenshot(path=SAIDA + "/cadapi-cliente-" + nome + ".png")
      pg.fill("#c-telefone", "27988880001"); pg.click(".modal button.btn-pri:has-text('Salvar')"); pg.wait_for_timeout(900)
      c = pg.evaluate("window.__DB.clientes.find(c => c.doc === '52998224725')")
      chk(T("cliente gravado com CPF, nome, nascimento e o endereço do CEP"), bool(c) and c["nome"] == "MARIA APARECIDA DE SOUZA" and c.get("nascimento") == "1985-07-15" and c["cep"] == "29100-010"
          and c["cidade"] == "Vila Velha" and c["rua"] == "Avenida Champagnat", c or (pg.inner_text(".erros") if pg.query_selector(".erros") else "não gravou"))

      # ================= ficha do veículo =================
      pg.goto(U + "#/cadastros?aba=veiculos"); pg.wait_for_timeout(1200)
      pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(500)
      o = ordem(["v-placa", "v-ano_fab", "v-ano_mod", "v-cor", "v-marca", "v-modelo"])
      chk(T("veículo: começa pela placa"), o[0] >= 0 and all(x > o[0] for x in o[1:]), o)
      pg.fill("#v-placa", "INT8C36"); pg.wait_for_timeout(1600)
      chk(T("veículo: a placa preenche marca, modelo e anos"), val("#v-marca") == "Volkswagen" and val("#v-modelo") == "CROSSFOX" and val("#v-ano_fab") == "2007", [val("#v-marca"), val("#v-modelo")])
      pg.keyboard.press("Escape"); pg.wait_for_timeout(200)

      # ================= ficha do fornecedor =================
      pg.goto(U + "#/cadastros?aba=fornecedores"); pg.wait_for_timeout(1200)
      bt = pg.query_selector("button:has-text('+ Novo')")
      if bt:
        bt.click(); pg.wait_for_timeout(500)
        o = ordem(["fo-cnpj", "fo-razao", "fo-fantasia", "fo-cep", "fo-endereco", "fo-bairro", "fo-cidade", "fo-uf"])
        chk(T("fornecedor: começa pelo CNPJ; endereço começa pelo CEP"), crescente(o), o)
        pg.fill("#fo-cep", "29705390"); pg.wait_for_timeout(1000)
        chk(T("fornecedor: CEP preenche o endereço"), val("#fo-endereco") == "Rodovia Gether Lopes de Farias" and val("#fo-cidade") == "Colatina", [val("#fo-endereco"), val("#fo-cidade")])
        chk(T("fornecedor: a ficha não passa da largura da tela"), larg() <= vp["width"] + 2, larg())
        pg.screenshot(path=SAIDA + "/cadapi-fornecedor-" + nome + ".png")
      else: chk(T("fornecedor: botão + Novo"), False)

      # ================= Nova O.S.: cliente novo =================
      pg.evaluate("localStorage.removeItem('dtcar-nova-os-v1')"); pg.goto(U + "#/painel"); pg.wait_for_timeout(300)
      pg.evaluate("localStorage.removeItem('dtcar-nova-os-v1')"); pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
      o = ordem(["placa"]); primeiro = pg.evaluate("(Array.from(document.querySelectorAll('main input, main select, main textarea'))[0] || {}).id")
      chk(T("Nova O.S.: começa pela placa"), primeiro == "placa", primeiro)
      pg.fill("#placa", "ABC1D23"); pg.wait_for_timeout(700)
      pg.click("button:has-text('Trocar')"); pg.wait_for_timeout(300); pg.click("button:has-text('Novo cliente')"); pg.wait_for_timeout(300)
      o = ordem(["placa", "c-doc", "c-nome", "c-tel", "c-cep", "c-end", "c-bairro"])
      chk(T("Nova O.S.: cliente novo começa pelo CPF, depois nome e telefone; endereço começa pelo CEP"), crescente(o), o)
      pg.fill("#c-doc", "714.287.938-60"); pg.wait_for_timeout(1500)
      pg.fill("#c-cep", "29100010"); pg.wait_for_timeout(1000)
      chk(T("Nova O.S.: CPF preenche o nome e o CEP preenche rua e bairro"), val("#c-nome") == "MARIA APARECIDA DE SOUZA" and val("#c-end") == "Avenida Champagnat" and val("#c-bairro") == "Centro",
          [val("#c-nome"), val("#c-end"), val("#c-bairro")])
      chk(T("Nova O.S.: o aviso do CEP diz a cidade"), "Vila Velha/ES" in pg.inner_text(".campo:has(#c-cep)"))
      chk(T("Nova O.S.: a tela não passa da largura"), larg() <= vp["width"] + 2, larg())
      pg.query_selector("#c-doc").scroll_into_view_if_needed(); pg.screenshot(path=SAIDA + "/cadapi-novaos-" + nome + ".png")
      pg.fill("#c-end", "Avenida Champagnat, 100"); pg.fill("#c-tel", "27988887777"); pg.fill("#km", "45000"); pg.fill("#recl", "Barulho na suspensão")
      pg.click("button.btn-pri:has-text('Abrir O.S.')"); pg.wait_for_timeout(800)
      for _ in range(3):
        bt = pg.query_selector(".modal button.btn-pri, .modal button.btn-perigo")
        if not bt: break
        bt.click(); pg.wait_for_timeout(800)
      pg.wait_for_timeout(1200)
      c = pg.evaluate("window.__DB.clientes.find(c => c.doc === '71428793860')")
      chk(T("Nova O.S.: cliente novo gravado com o CEP, a cidade e a UF do CEP"), bool(c) and c.get("cep") == "29100-010" and c["cidade"] == "Vila Velha" and c["uf"] == "ES" and c["rua"] == "Avenida Champagnat, 100"
          and c["bairro"] == "Centro" and c["endereco"] == "Avenida Champagnat, 100, Centro, Vila Velha/ES" and c.get("nascimento") == "1985-07-15", c or "não gravou")
      # sem CEP continua Colatina/ES, como sempre foi
      pg.evaluate("localStorage.removeItem('dtcar-nova-os-v1')"); pg.goto(U + "#/painel"); pg.wait_for_timeout(300); pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
      pg.fill("#placa", "ABC1D23"); pg.wait_for_timeout(700)
      pg.click("button:has-text('Trocar')"); pg.wait_for_timeout(300); pg.click("button:has-text('Novo cliente')"); pg.wait_for_timeout(300)
      pg.fill("#c-nome", "Cliente Sem Cep"); pg.fill("#c-tel", "27988886666"); pg.fill("#c-end", "Rua Um, 10"); pg.fill("#km", "46000"); pg.fill("#recl", "Revisão")
      # CEP digitado e apagado: a cidade do CEP não fica
      pg.fill("#c-cep", "29100010"); pg.wait_for_timeout(900); pg.fill("#c-cep", ""); pg.wait_for_timeout(300)
      pg.click("button.btn-pri:has-text('Abrir O.S.')"); pg.wait_for_timeout(800)
      for _ in range(3):
        bt = pg.query_selector(".modal button.btn-pri, .modal button.btn-perigo")
        if not bt: break
        bt.click(); pg.wait_for_timeout(800)
      pg.wait_for_timeout(1200)
      c = pg.evaluate("window.__DB.clientes.find(c => c.nome === 'Cliente Sem Cep')")
      chk(T("Nova O.S.: sem CEP (ou CEP apagado) o cliente continua em Colatina/ES"), bool(c) and c["cidade"] == "Colatina" and c["uf"] == "ES" and not c.get("cep") and c["endereco"].endswith("Colatina/ES"), c or "não gravou")
      ctx.close()
    b.close()
finally:
  srv.terminate()
print(len(ok), "ok"); [print("  FALHA:", f) for f in falhas]; [print("  ", e) for e in erros[:8]]
sys.exit(1 if falhas or erros else 0)
