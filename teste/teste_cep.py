# Busca do endereço pelo CEP (js/cep.js) nas fichas de cliente e de fornecedor, com ViaCEP e OpenCEP de mentira
# (nenhuma chamada sai para a internet): preenche só campo em branco, cai para o OpenCEP quando o ViaCEP falha,
# não repete a consulta do mesmo CEP, não consulta ao abrir cadastro pronto, e sem internet não trava nem avisa.
# Uso: python3 teste/teste_cep.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8791", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
U = "http://localhost:8791/"
VIA = {"29705390": {"cep": "29705-390", "logradouro": "Rodovia Gether Lopes de Farias", "complemento": "", "bairro": "Carlos Germano Naumann", "localidade": "Colatina", "uf": "ES", "ibge": "3201506", "ddd": "27"},
       "01310100": {"cep": "01310-100", "logradouro": "Avenida Paulista", "bairro": "Bela Vista", "localidade": "São Paulo", "uf": "SP", "ibge": "3550308"},
       "29712000": {"cep": "29712-000", "logradouro": "", "bairro": "", "localidade": "Colatina", "uf": "ES", "ibge": "3201506"}}
OPEN = {"29100010": {"cep": "29100-010", "logradouro": "Avenida Champagnat", "complemento": "", "bairro": "Centro", "localidade": "Vila Velha", "uf": "ES", "ibge": "3205200"}}
chamadas = []; modo = {"via": "ok"}
def via(route):
    c = route.request.url.rstrip("/").split("/")[-2]; chamadas.append("viacep:" + c)
    if modo["via"] == "fora": return route.abort()
    if modo["via"] == "erro500": return route.fulfill(status=500, body="erro")
    route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(VIA.get(c) or {"erro": "true"}))
def opn(route):
    c = route.request.url.rstrip("/").split("/")[-1]; chamadas.append("opencep:" + c)
    if modo.get("open") == "fora": return route.abort()
    if c in OPEN: route.fulfill(status=200, content_type="application/json", headers={"access-control-allow-origin": "*"}, body=json.dumps(OPEN[c]))
    else: route.fulfill(status=404, content_type="application/json", headers={"access-control-allow-origin": "*"}, body='{"error":"nao encontrado"}')
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    for nome, vp in (("pc", {"width": 1400, "height": 950}), ("celular", {"width": 390, "height": 800})):
      ctx = b.new_context(viewport=vp); pg = ctx.new_page(); del chamadas[:]; modo.clear(); modo["via"] = "ok"
      pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
      fora = []
      pg.on("request", lambda r: fora.append(r.url) if r.url.startswith("http") and not r.url.startswith(U) and "viacep.com.br" not in r.url and "opencep.com" not in r.url and "fonts.g" not in r.url else None)
      pg.route("https://viacep.com.br/**", via); pg.route("https://opencep.com/**", opn)
      pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
      val = lambda sel: pg.input_value(sel)
      dica = lambda: pg.inner_text(".campo:has(#c-cep)")
      T = lambda n: "[" + nome + "] " + n
      pg.goto(U + "#/cadastros"); pg.wait_for_timeout(2500)
      pg.click("button:has-text('+ Novo')"); pg.wait_for_timeout(500)
      chk(T("cliente novo abre com Colatina/ES e sem consulta"), val("#c-cidade") == "Colatina" and val("#c-uf") == "ES" and not chamadas, chamadas)
      pg.fill("#c-cep", "2970539"); pg.wait_for_timeout(500)
      chk(T("CEP incompleto: não consulta"), not chamadas, chamadas)
      pg.fill("#c-cep", "29705390"); pg.wait_for_timeout(900)
      chk(T("CEP completo: uma consulta, só no ViaCEP"), chamadas == ["viacep:29705390"], chamadas)
      chk(T("preencheu rua e bairro, manteve Colatina/ES"), val("#c-rua") == "Rodovia Gether Lopes de Farias" and val("#c-bairro") == "Carlos Germano Naumann" and val("#c-cidade") == "Colatina" and val("#c-uf") == "ES",
          [val("#c-rua"), val("#c-bairro"), val("#c-cidade"), val("#c-uf")])
      chk(T("aviso de endereço preenchido"), "Endereço preenchido pelo CEP (Colatina/ES)" in dica(), dica())
      pg.locator("#c-cep").blur(); pg.wait_for_timeout(200)
      chk(T("ao sair do campo o CEP fica 00000-000, sem consultar de novo"), val("#c-cep") == "29705-390" and len(chamadas) == 1, [val("#c-cep"), chamadas])
      pg.screenshot(path=SAIDA + "/cep-1-cliente-" + nome + ".png")
      # outro CEP: troca o que a busca tinha preenchido, inclusive a cidade que era a padrão
      pg.fill("#c-cep", "01310-100"); pg.wait_for_timeout(900)
      chk(T("CEP de outra cidade: troca rua, bairro, cidade e UF que vieram da busca"), val("#c-rua") == "Avenida Paulista" and val("#c-bairro") == "Bela Vista" and val("#c-cidade") == "São Paulo" and val("#c-uf") == "SP",
          [val("#c-rua"), val("#c-bairro"), val("#c-cidade"), val("#c-uf")])
      # o que a pessoa digitou não é trocado
      pg.fill("#c-rua", "Av. Paulista, 1000"); pg.fill("#c-bairro", "São Silvano"); pg.fill("#c-cidade", "Baixo Guandu")
      pg.fill("#c-cep", "29705390"); pg.wait_for_timeout(900)
      chk(T("não troca o que foi digitado e avisa a cidade do CEP"), val("#c-rua") == "Av. Paulista, 1000" and val("#c-bairro") == "São Silvano" and val("#c-cidade") == "Baixo Guandu" and val("#c-uf") == "ES"
          and "Este CEP é de Colatina/ES" in dica(), [val("#c-rua"), val("#c-bairro"), val("#c-cidade"), val("#c-uf"), dica()])
      chk(T("CEP já consultado: não chama de novo"), chamadas.count("viacep:29705390") == 1, chamadas)
      # CEP geral da cidade (sem rua): não apaga nada
      pg.fill("#c-rua", "Rua A, 10"); pg.fill("#c-bairro", ""); pg.fill("#c-cidade", "")
      pg.fill("#c-cep", "29712000"); pg.wait_for_timeout(900)
      chk(T("CEP geral: preenche a cidade e deixa rua e bairro como estavam"), val("#c-rua") == "Rua A, 10" and val("#c-bairro") == "" and val("#c-cidade") == "Colatina", [val("#c-rua"), val("#c-bairro"), val("#c-cidade")])
      # ViaCEP não conhece: tenta o OpenCEP
      pg.fill("#c-rua", ""); n = len(chamadas)
      pg.fill("#c-cep", "29100010"); pg.wait_for_timeout(900)
      chk(T("ViaCEP não conhece: o OpenCEP responde"), chamadas[n:] == ["viacep:29100010", "opencep:29100010"] and val("#c-rua") == "Avenida Champagnat" and val("#c-cidade") == "Vila Velha", [chamadas[n:], val("#c-rua"), val("#c-cidade")])
      # nenhum conhece
      n = len(chamadas); pg.fill("#c-cep", "99999999"); pg.wait_for_timeout(900)
      chk(T("nenhum conhece: avisa e não mexe no endereço"), "CEP não encontrado" in dica() and val("#c-rua") == "Avenida Champagnat" and len(chamadas) - n == 2, [dica(), chamadas[n:]])
      # ViaCEP fora do ar: OpenCEP de reserva
      modo["via"] = "fora"; OPEN["29700010"] = {"logradouro": "Avenida Getúlio Vargas", "bairro": "Centro", "localidade": "Colatina", "uf": "ES"}
      pg.fill("#c-rua", ""); pg.fill("#c-bairro", ""); pg.fill("#c-cep", "29700010"); pg.wait_for_timeout(1200)
      chk(T("ViaCEP fora do ar: OpenCEP preenche"), val("#c-rua") == "Avenida Getúlio Vargas" and val("#c-bairro") == "Centro", [val("#c-rua"), val("#c-bairro"), dica()])
      modo["via"] = "erro500"; modo["open"] = "fora"
      pg.fill("#c-cep", "29700020"); pg.wait_for_timeout(1200)
      chk(T("os dois fora: avisa para preencher à mão, sem erro na tela"), "Não deu para buscar o CEP agora" in dica() and val("#c-rua") == "Avenida Getúlio Vargas", dica())
      modo["via"] = "ok"; modo.pop("open")
      # sem internet: não chama e não avisa
      ctx.set_offline(True); n = len(chamadas)
      pg.fill("#c-cep", "29705000"); pg.wait_for_timeout(700)
      chk(T("sem internet: não consulta e não mostra aviso"), len(chamadas) == n and "CEP" == dica().strip().split("\n")[0] and len(dica().strip().split("\n")) == 1, [chamadas[n:], dica()])
      ctx.set_offline(False)
      # salvar grava o CEP formatado; reabrir não consulta
      pg.fill("#c-nome", "Cliente do CEP"); pg.fill("#c-telefone", "27988887777"); pg.fill("#c-cep", "29705390"); pg.wait_for_timeout(600)
      pg.click(".modal button:has-text('Salvar')"); pg.wait_for_timeout(900)
      c = pg.evaluate("window.__DB.clientes.find(c => c.nome === 'CLIENTE DO CEP')")
      chk(T("salvou o CEP como 29705-390 e o endereço completo"), bool(c) and c["cep"] == "29705-390" and "CEP 29705-390" in (c.get("endereco") or ""), c)
      n = len(chamadas)
      pg.click("button:has-text('Editar cadastro')"); pg.wait_for_timeout(600)   # depois de salvar, o sistema abre a página do cliente
      chk(T("abrir cadastro pronto não consulta o CEP"), pg.query_selector("#c-cep") is not None and val("#c-cep") == "29705-390" and len(chamadas) == n, [chamadas[n:]])

      # ================= fornecedor =================
      pg.goto(U + "#/cadastros?aba=fornecedores"); pg.wait_for_timeout(1200)
      pg.click("button:has-text('+ Novo'), button:has-text('Novo fornecedor')"); pg.wait_for_timeout(500)
      n = len(chamadas)
      pg.fill("#fo-cep", "01310100"); pg.wait_for_timeout(800)
      chk(T("fornecedor: preenche endereço, bairro, cidade e UF (CEP já guardado, sem nova consulta)"), val("#fo-endereco") == "Avenida Paulista" and val("#fo-bairro") == "Bela Vista" and val("#fo-cidade") == "São Paulo" and val("#fo-uf") == "SP" and len(chamadas) == n,
          [val("#fo-endereco"), val("#fo-bairro"), val("#fo-cidade"), val("#fo-uf"), chamadas[n:]])
      pg.screenshot(path=SAIDA + "/cep-2-fornecedor-" + nome + ".png")
      pg.fill("#fo-razao", "Fornecedor do CEP"); pg.click(".modal button:has-text('Salvar')"); pg.wait_for_timeout(800)
      f = pg.evaluate("window.__DB.fornecedores.find(c => c.razao === 'Fornecedor do CEP')")
      chk(T("fornecedor salvo com o CEP 01310-100"), bool(f) and f["cep"] == "01310-100" and f["cidade"] == "São Paulo", f)
      chk(T("nenhuma chamada para outro endereço da internet"), not fora, fora[:5])
      ctx.close()
    b.close()
finally:
  srv.terminate()
for n in ok: print("OK   ", n)
for n in falhas: print("FALHA", n)
for e in erros: print(e)
print("%d OK, %d falhas, %d erros de página" % (len(ok), len(falhas), len(erros)))
sys.exit(1 if falhas or erros else 0)
