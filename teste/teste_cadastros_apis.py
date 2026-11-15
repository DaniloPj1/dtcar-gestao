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
CNPJ = {"27462217000331": {"cnpj": "27462217000331", "razao_social": "GRANITOS DE TESTE LTDA", "nome_fantasia": "Granitos Teste", "descricao_tipo_de_logradouro": "RODOVIA", "logradouro": "BR 259", "numero": "KM 28",
         "complemento": "GALPAO 2", "bairro": "BAUNILHA", "municipio": "COLATINA", "uf": "ES", "cep": "29715000", "ddd_telefone_1": "2737221234", "email": "CONTATO@GRANITOSTESTE.COM.BR", "descricao_situacao_cadastral": "ATIVA"},
        "33000167000101": {"cnpj": "33000167000101", "razao_social": "DISTRIBUIDORA DE PECAS TESTE S A", "nome_fantasia": "", "descricao_tipo_de_logradouro": "AVENIDA", "logradouro": "PAULISTA", "numero": "1000",
         "complemento": "", "bairro": "BELA VISTA", "municipio": "SAO PAULO", "uf": "SP", "cep": "01310100", "ddd_telefone_1": "1133334444", "email": "", "descricao_situacao_cadastral": "ATIVA"}}
chamadas_cnpj = []; modo = {"brasilapi": "ok"}
def brasilapi(route):
    c = route.request.url.rstrip("/").split("/")[-1]; chamadas_cnpj.append("brasilapi:" + c)
    if modo["brasilapi"] == "fora": return route.abort()
    if c in CNPJ: route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(CNPJ[c]))
    else: route.fulfill(status=404, content_type="application/json", headers={"access-control-allow-origin": "*"}, body='{"message":"CNPJ nao encontrado"}')
def minha(route):
    c = route.request.url.rstrip("/").split("/")[-1]; chamadas_cnpj.append("minhareceita:" + c)
    if c in CNPJ: route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(CNPJ[c]))
    else: route.fulfill(status=404, content_type="application/json", headers={"access-control-allow-origin": "*"}, body='{"message":"nao encontrado"}')
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
      pg.route("https://brasilapi.com.br/**", brasilapi); pg.route("https://minhareceita.org/**", minha); del chamadas_cnpj[:]; modo["brasilapi"] = "ok"
      fora = []
      pg.on("request", lambda r: fora.append(r.url) if r.url.startswith("http") and not r.url.startswith(U) and not any(h in r.url for h in ("viacep.com.br", "opencep.com", "brasilapi.com.br", "minhareceita.org", "fonts.g")) else None)
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
      some = lambda: [i for i in ["c-telefone2", "c-telefone3", "c-email", "c-contato", "c-tipo", "c-origem"] if pg.query_selector("#" + i) is not None]
      chk(T("pessoa física: sem Telefone 2 e 3, E-mail, Pessoa de contato, Tipo de cliente e Como conheceu"), some() == [], some())
      pg.fill("#c-doc", "529.982.247-25"); pg.wait_for_timeout(1500)
      chk(T("pessoa física com CPF: os campos continuam fora"), some() == [], some())
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

      # ----- nome em maiúsculas (regra do Danilo) e empresa pelo CNPJ
      pg.goto(U + "#/painel"); pg.wait_for_timeout(300); pg.goto(U + "#/cadastros?aba=clientes"); pg.wait_for_timeout(1200)
      pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(500)
      pg.fill("#c-nome", "joão da silva júnior"); pg.fill("#c-telefone", "27988880002")
      chk(T("cliente: o campo do nome já mostra em maiúsculas"), pg.evaluate("getComputedStyle(document.querySelector('#c-nome')).textTransform") == "uppercase")
      pg.click(".modal button.btn-pri:has-text('Salvar')"); pg.wait_for_timeout(900)
      c = pg.evaluate("window.__DB.clientes.find(c => c.telefone === '27988880002')")
      chk(T("REGRA: nome do cliente gravado em MAIÚSCULAS, com acento"), bool(c) and c["nome"] == "JOÃO DA SILVA JÚNIOR", c)
      pg.goto(U + "#/painel"); pg.wait_for_timeout(300); pg.goto(U + "#/cadastros?aba=clientes"); pg.wait_for_timeout(1200)
      pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(500); n = len(chamadas_cnpj)
      pg.fill("#c-doc", "27.462.217/0003-31"); pg.wait_for_timeout(1500)
      chk(T("empresa: CNPJ busca uma vez e preenche razão social, fantasia, telefone e e-mail"), chamadas_cnpj[n:] == ["brasilapi:27462217000331"] and val("#c-nome") == "GRANITOS DE TESTE LTDA" and val("#c-fantasia") == "GRANITOS TESTE"
          and val("#c-telefone") == "(27) 3722-1234" and val("#c-email") == "contato@granitosteste.com.br", [chamadas_cnpj[n:], val("#c-nome"), val("#c-fantasia"), val("#c-telefone"), val("#c-email") if pg.query_selector("#c-email") else "sem campo"])
      chk(T("empresa: CNPJ preenche o endereço (rua com número, complemento, bairro, cidade, UF e CEP)"), val("#c-rua") == "RODOVIA BR 259, KM 28" and val("#c-complemento") == "GALPAO 2" and val("#c-bairro") == "BAUNILHA"
          and val("#c-cidade") == "Colatina" and val("#c-uf") == "ES" and val("#c-cep") == "29715-000", [val("#c-rua"), val("#c-complemento"), val("#c-bairro"), val("#c-cidade"), val("#c-cep")])
      chk(T("empresa: com CNPJ a ficha mostra Telefone 2 e 3, E-mail, Contato, Tipo e Como conheceu"), len(some()) == 6, some())
      chk(T("empresa: aviso do CNPJ junto do campo"), "preenchidos pelo CNPJ" in pg.inner_text(".modal"))
      pg.screenshot(path=SAIDA + "/cadapi-empresa-" + nome + ".png")
      pg.fill("#c-doc", "33.000.167/0001-01"); pg.wait_for_timeout(1500)
      chk(T("empresa: CNPJ trocado troca os dados e tira o que era da outra"), val("#c-nome") == "DISTRIBUIDORA DE PECAS TESTE S A" and val("#c-fantasia") == "" and val("#c-cidade") == "Sao Paulo" and val("#c-uf") == "SP" and val("#c-complemento") == "",
          [val("#c-nome"), val("#c-fantasia"), val("#c-cidade"), val("#c-complemento")])
      pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
      # cadastro antigo de pessoa física que já tinha e-mail: o campo continua à vista (nada some sem a pessoa ver)
      pg.evaluate("Object.assign(window.__DB.clientes.find(c => c.id === 'c1'), { email: 'cliente@teste.com', telefone2: '' })")
      pg.goto(U + "#/painel"); pg.wait_for_timeout(300); pg.goto(U + "#/cadastros?aba=clientes"); pg.wait_for_timeout(1200)
      pg.evaluate("location.hash = '#/cliente/c1'"); pg.wait_for_timeout(900)
      bt = pg.query_selector("button:has-text('Editar cadastro')")
      if bt:
        bt.click(); pg.wait_for_timeout(500)
        chk(T("pessoa física antiga com e-mail gravado: só o e-mail continua à vista"), some() == ["c-email"] and val("#c-email") == "cliente@teste.com", some())
        pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
      else: chk(T("abrir a ficha de um cliente que já existe"), False, pg.inner_text("main")[:200])

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
        n = len(chamadas_cnpj); modo["brasilapi"] = "fora"
        pg.fill("#fo-cnpj", "33.000.167/0001-01"); pg.wait_for_timeout(1800)
        chk(T("fornecedor: CNPJ preenche razão social, telefone e endereço (BrasilAPI fora: cai para a Minha Receita)"), "minhareceita:33000167000101" in chamadas_cnpj[n:] or chamadas_cnpj[n:] == []
            and val("#fo-razao") == "DISTRIBUIDORA DE PECAS TESTE S A", [chamadas_cnpj[n:], val("#fo-razao")])
        chk(T("fornecedor: dados da empresa nos campos"), val("#fo-razao") == "DISTRIBUIDORA DE PECAS TESTE S A" and val("#fo-tel") == "(11) 3333-4444" and val("#fo-endereco") == "AVENIDA PAULISTA, 1000"
            and val("#fo-cidade") == "Sao Paulo" and val("#fo-uf") == "SP" and val("#fo-cep") == "01310-100", [val("#fo-razao"), val("#fo-tel"), val("#fo-endereco"), val("#fo-cidade"), val("#fo-cep")])
        modo["brasilapi"] = "ok"; pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(500)
        pg.fill("#fo-razao", "Fornecedor Digitado"); n = len(chamadas_cnpj); pg.fill("#fo-cnpj", "27.462.217/0003-31"); pg.wait_for_timeout(1300)
        chk(T("REGRA: fornecedor com a razão social já digitada não consulta nem é trocado"), chamadas_cnpj[n:] == [] and val("#fo-razao") == "Fornecedor Digitado", chamadas_cnpj[n:])
        pg.fill("#fo-cnpj", ""); pg.fill("#fo-razao", "")
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
      c = pg.evaluate("window.__DB.clientes.find(c => c.nome === 'CLIENTE SEM CEP')")
      chk(T("Nova O.S.: sem CEP (ou CEP apagado) o cliente continua em Colatina/ES"), bool(c) and c["cidade"] == "Colatina" and c["uf"] == "ES" and not c.get("cep") and c["endereco"].endswith("Colatina/ES"), c or "não gravou")

      # ================= produtos e serviços em maiúsculas =================
      pg.goto(U + "#/cadastros?aba=produtos"); pg.wait_for_timeout(1200)
      bt = pg.query_selector("button:has-text('+ Novo produto'), button:has-text('+ Produto'), button:has-text('+ Novo')")
      if bt:
        bt.click(); pg.wait_for_timeout(500)
        pg.fill("#p-desc", "pastilha de freio dianteira cerâmica")
        chk(T("produto: o campo da descrição já mostra em maiúsculas"), pg.evaluate("getComputedStyle(document.querySelector('#p-desc')).textTransform") == "uppercase")
        pg.click("[role=dialog] button:has-text('Salvar')"); pg.wait_for_timeout(900)
        pr = pg.evaluate("window.__DB.produtos.find(p => /PASTILHA DE FREIO DIANTEIRA/i.test(p.descricao))")
        chk(T("REGRA: descrição do produto gravada em MAIÚSCULAS"), bool(pr) and pr["descricao"] == "PASTILHA DE FREIO DIANTEIRA CERÂMICA", pr and pr["descricao"])
      else: chk(T("produtos: botão de novo produto"), False, pg.inner_text("main")[:300])

      # ================= orçamento com cliente só digitado =================
      pg.goto(U + "#/orcamento/novo"); pg.wait_for_timeout(1500)
      pg.click(".seg button:has-text('Sem cadastro')"); pg.wait_for_timeout(300)
      o = ordem(["orc-doc", "orc-nome", "orc-tel", "orc-cep", "orc-end", "orc-bairro"])
      chk(T("orçamento: cliente digitado começa pelo CPF, depois nome e telefone; endereço começa pelo CEP"), crescente(o), o)
      pg.fill("#orc-doc", "862.883.667-57"); pg.wait_for_timeout(1500)
      pg.fill("#orc-cep", "29100010"); pg.wait_for_timeout(1000)
      chk(T("orçamento: CPF preenche o nome e o CEP o endereço"), val("#orc-nome") == "MARIA APARECIDA DE SOUZA" and val("#orc-end") == "Avenida Champagnat" and val("#orc-bairro") == "Centro", [val("#orc-nome"), val("#orc-end")])
      chk(T("orçamento: a tela não passa da largura"), larg() <= vp["width"] + 2, larg())
      pg.query_selector("#orc-doc").scroll_into_view_if_needed(); pg.screenshot(path=SAIDA + "/cadapi-orcamento-" + nome + ".png")
      pg.fill("#orc-tel", "27988885555"); pg.fill("#orc-placa", "MTQ5E67"); pg.wait_for_timeout(1500)
      pg.evaluate("""(async () => { const m = await import('/js/api.js'); })()""")
      orc = pg.evaluate("""(async () => { const id = 'orc-cad-' + Date.now(); const db = window.__DB; db.orcamentos = db.orcamentos || [];
        return null; })()""")
      # grava pelo botão da tela
      bt = pg.query_selector("button:has-text('Salvar orçamento'), button.btn-pri:has-text('Salvar')")
      if bt: bt.click(); pg.wait_for_timeout(1200)
      oc = pg.evaluate("(window.__DB.orcamentos || []).find(o => (o.cliente || {}).doc === '86288366757')")
      chk(T("orçamento gravado com a cópia do cliente: CPF, nascimento, CEP, rua, bairro e cidade"), bool(oc) and oc["cliente"]["nome"] == "MARIA APARECIDA DE SOUZA" and oc["cliente"].get("nascimento") == "1985-07-15"
          and oc["cliente"].get("cep") == "29100-010" and oc["cliente"].get("rua") == "Avenida Champagnat" and oc["cliente"].get("cidade") == "Vila Velha", oc and oc["cliente"] or (pg.inner_text(".erros") if pg.query_selector(".erros") else "não gravou"))
      if oc:
        # aprovação: o banco cadastra o cliente com nome e telefone; a tela completa o cadastro com o CPF e o endereço
        r = pg.evaluate("""(async id => { const { api } = await import('/js/api.js'); const { completarClienteNovo } = await import('/js/clientedig.js'); const db = window.__DB;
          const o = db.orcamentos.find(x => x.id === id); if (!o.itens || !o.itens.length) o.itens = [{ id: 'i1', tipo: 'servico', descricao: 'REVISAO', qtd: 1, valor_unit: 100, desconto: 0, aprovado: null }];
          const a = await api.orcamentos.aprovar(id, { por: 'Maria', forma: 'WhatsApp', gravar: true }); const aviso = a.cliente_novo ? await completarClienteNovo(api, a.ordem_id, o.cliente) : 'não era novo';
          const os = db.ordens.find(x => x.id === a.ordem_id); return { a, aviso, cli: db.clientes.find(c => c.id === os.cliente_id) }; })""", oc["id"])
        c = r["cli"]
        chk(T("orçamento aprovado: o cliente novo fica no cadastro com CPF, nascimento e endereço do orçamento"), r["aviso"] == "" and c.get("doc") == "86288366757" and c.get("nascimento") == "1985-07-15" and c.get("cep") == "29100-010"
            and c.get("cidade") == "Vila Velha" and c.get("rua") == "Avenida Champagnat" and c.get("bairro") == "Centro", r)

      # achados da revisão: CPF repetido não derruba o endereço e o aviso diz o que faltou; documento pela metade não grava em silêncio
      r = pg.evaluate("""(async () => { const { api } = await import('/js/api.js'); const { completarClienteNovo, erroClienteDig, copiaClienteDig } = await import('/js/clientedig.js'); const db = window.__DB;
        const novo = { id: 'cli-rev', nome: 'NOVO DO ORCAMENTO', telefone: '27911112222' }; db.clientes.push(novo); db.ordens.push({ id: 'os-rev', numero: 99001, status: 'execucao', cliente_id: 'cli-rev', cliente: {}, veiculo: {} });
        const salvar = api.clientes.salvar; api.clientes.salvar = async o => { if (o.doc) throw new Error('duplicate key value violates unique constraint "clientes_doc_unico"'); return salvar(o); };
        const aviso = await completarClienteNovo(api, 'os-rev', { nome: 'x', doc: '52998224725', nascimento: '1985-07-15', cep: '29100-010', rua: 'Rua A, 1', bairro: 'Centro', cidade: 'Vila Velha', uf: 'ES' });
        api.clientes.salvar = salvar;
        return { aviso, cli: db.clientes.find(c => c.id === 'cli-rev'), meio: erroClienteDig({ doc: '529.982.247' }), bom: erroClienteDig({ doc: '529.982.247-25' }), vazio: erroClienteDig({ doc: '' }), copia: copiaClienteDig({ nome: 'a', doc: '529.982.247' }) }; })()""")
      chk(T("orçamento aprovado com CPF que já é de outro cliente: o endereço vai, o CPF e o nascimento não, e a tela diz o que faltou"), "não foi para o cadastro" in r["aviso"] and r["cli"].get("cep") == "29100-010"
          and r["cli"].get("rua") == "Rua A, 1" and not r["cli"].get("doc") and not r["cli"].get("nascimento"), r)
      chk(T("CPF/CNPJ pela metade: a tela avisa antes de gravar (válido e vazio passam)"), "incompleto ou inválido" in r["meio"] and r["bom"] == "" and r["vazio"] == "", r)
      pg.goto(U + "#/orcamento/novo"); pg.wait_for_timeout(1500)
      pg.click(".seg button:has-text('Sem cadastro')"); pg.wait_for_timeout(300)
      pg.fill("#orc-nome", "cliente com cpf pela metade"); pg.fill("#orc-doc", "529.982.247"); pg.wait_for_timeout(300); n = pg.evaluate("(window.__DB.orcamentos || []).length")
      bt = pg.query_selector("button:has-text('Salvar orçamento'), button.btn-pri:has-text('Salvar')")
      if bt: bt.click(); pg.wait_for_timeout(900)
      chk(T("orçamento: CPF pela metade não grava e a tela diz por quê"), pg.evaluate("(window.__DB.orcamentos || []).length") == n and "incompleto ou inválido" in pg.inner_text("main"), pg.inner_text("main")[:200])

      # ================= agenda com cliente só digitado =================
      pg.goto(U + "#/agenda"); pg.wait_for_timeout(1500)
      pg.click(".painel-topo button:has-text('+ Agendar')"); pg.wait_for_timeout(500)
      pg.click(".modal .seg button:has-text('Sem cadastro')"); pg.wait_for_timeout(300)
      o = ordem(["ag-doc", "ag-nome", "ag-tel", "ag-cep", "ag-end", "ag-bairro"])
      chk(T("agenda: cliente digitado começa pelo CPF, depois nome e telefone; endereço começa pelo CEP"), crescente(o), o)
      pg.fill("#ag-doc", "153.509.460-56"); pg.wait_for_timeout(1500)
      pg.fill("#ag-cep", "29705390"); pg.wait_for_timeout(1000)
      chk(T("agenda: CPF preenche o nome e o CEP o endereço"), val("#ag-nome") == "MARIA APARECIDA DE SOUZA" and val("#ag-end") == "Rodovia Gether Lopes de Farias", [val("#ag-nome"), val("#ag-end")])
      chk(T("agenda: o quadro não passa da largura"), larg() <= vp["width"] + 2, larg())
      pg.screenshot(path=SAIDA + "/cadapi-agenda-" + nome + ".png")
      # agendamento salvo e reaberto: trocado o CPF, o nascimento do CPF antigo sai da cópia (não vai para o cadastro de outra pessoa)
      pg.fill("#ag-tel", "27988883333"); pg.fill("#ag-serv", "Revisão dos 40 mil"); pg.wait_for_timeout(200)
      pg.click(".modal button.btn-pri:has-text('Agendar')"); pg.wait_for_timeout(1200)
      ag1 = pg.evaluate("(window.__DB.agendamentos || []).find(a => (a.cliente || {}).doc === '15350946056')")
      chk(T("agenda gravada com a cópia do cliente: CPF, nascimento, CEP e endereço"), bool(ag1) and ag1["cliente"].get("nascimento") == "1985-07-15" and ag1["cliente"].get("cep") == "29705-390"
          and ag1["cliente"]["nome"] == "MARIA APARECIDA DE SOUZA", ag1 and ag1["cliente"] or (pg.inner_text(".modal .erros") if pg.query_selector(".modal .erros") else "não gravou"))
      if ag1:
        if pg.query_selector(".modal"): pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
        alvo = pg.query_selector("main button:has-text('MARIA APARECIDA DE SOUZA')")
        if alvo:
          alvo.click(); pg.wait_for_timeout(600)
          ed = pg.query_selector(".modal button:has-text('Editar'), .modal button:has-text('Alterar')")
          if ed and pg.query_selector("#ag-doc") is None: ed.click(); pg.wait_for_timeout(400)
        if pg.query_selector("#ag-doc") and not pg.is_disabled("#ag-doc"):
          pg.fill("#ag-doc", "529.982.247-25"); pg.wait_for_timeout(1300)
          pg.click(".modal button.btn-pri:has-text('Salvar')"); pg.wait_for_timeout(1200)
          ag2 = pg.evaluate("(window.__DB.agendamentos || []).find(a => (a.cliente || {}).doc === '52998224725')")
          chk(T("REVISÃO: agendamento reaberto com o CPF trocado não leva o nascimento do CPF antigo"), bool(ag2) and not ag2["cliente"].get("nascimento"), ag2 and ag2["cliente"])
        else: chk(T("reabrir o agendamento para trocar o CPF"), False, pg.inner_text("body")[:200])
      ag = {"id": "ag-teste", "cliente_id": "", "veiculo_id": "", "servico": "Revisão", "veiculo": {"placa": "KLM3N45", "marca": "Fiat", "modelo": "ARGO", "ano": "2020"},
            "cliente": {"nome": "MARIA APARECIDA DE SOUZA", "telefone": "27988884444", "doc": "15350946056", "nascimento": "1985-07-15", "cep": "29100-010", "rua": "Avenida Champagnat, 5", "bairro": "Centro", "cidade": "Vila Velha", "uf": "ES"}}
      pg.keyboard.press("Escape"); pg.wait_for_timeout(300)
      pg.evaluate("""(async ag => { const m = await import('/js/telas/entrada.js'); m.prepararNovaOSAgenda(ag, window.__DB); })""", ag)
      pg.goto(U + "#/painel"); pg.wait_for_timeout(300); pg.goto(U + "#/entrada"); pg.wait_for_timeout(1500)
      chk(T("agenda → Nova O.S.: CPF, nome, telefone, CEP, endereço e bairro do agendamento já vêm preenchidos"), val("#c-doc") == "153.509.460-56" and val("#c-nome") == "MARIA APARECIDA DE SOUZA" and val("#c-cep") == "29100-010"
          and val("#c-end") == "Avenida Champagnat, 5" and val("#c-bairro") == "Centro", [val("#c-doc"), val("#c-nome"), val("#c-cep"), val("#c-end")] if pg.query_selector("#c-doc") else pg.inner_text("main")[:200])
      pg.fill("#km", "12000"); pg.fill("#recl", "Revisão")
      pg.click("button.btn-pri:has-text('Abrir O.S.')"); pg.wait_for_timeout(800)
      for _ in range(3):
        bt = pg.query_selector(".modal button.btn-pri, .modal button.btn-perigo")
        if not bt: break
        bt.click(); pg.wait_for_timeout(800)
      pg.wait_for_timeout(1200)
      c = pg.evaluate("window.__DB.clientes.find(c => c.doc === '15350946056')")
      chk(T("agenda → Nova O.S.: cliente novo gravado com CPF, nascimento, CEP e a cidade do agendamento"), bool(c) and c.get("nascimento") == "1985-07-15" and c.get("cep") == "29100-010" and c["cidade"] == "Vila Velha" and c["uf"] == "ES",
          c or (pg.inner_text(".erros") if pg.query_selector(".erros") else "não gravou"))
      chk(T("nenhuma chamada para outro endereço da internet"), fora == [], fora[:3])
      ctx.close()
    b.close()
finally:
  srv.terminate()
print(len(ok), "ok"); [print("  FALHA:", f) for f in falhas]; [print("  ", e) for e in erros[:8]]
sys.exit(1 if falhas or erros else 0)
