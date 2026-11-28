# Filtro por data de vencimento nas telas que guardam pagamento ou documento (pedido do Danilo em 25/11/2026,
# decisão de 28/11: é um filtro A MAIS, não substitui o período que a tela já tinha):
# contas a pagar, contas a receber e boletos. Atalhos: vencidos, vencem hoje, 7 dias, 30 dias, mês e período escolhido.
# Uso: python3 teste/teste_filtro_vencimento.py
import subprocess, time, sys, os, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8797", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra)[:400])
U = "http://localhost:8797/"; TMP = tempfile.mkdtemp()

# contas a pagar, parcelas a receber e boletos com vencimento ontem, hoje, daqui a 3 dias e daqui a 60 dias
PREP = """(() => { const db = window.__DB;
  const dia = n => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  window.__DIAS = { ontem: dia(-1), hoje: dia(0), tres: dia(3), longe: dia(60) };
  db.contas = [
    { id: 'k1', descricao: 'ALUGUEL ATRASADO', favorecido: 'Imobiliária', valor: 1000, vencimento: dia(-1), status: 'aberta', categoria: 'Aluguel', origem: 'manual', criado_em: dia(-10) },
    { id: 'k2', descricao: 'ENERGIA DE HOJE', favorecido: 'EDP', valor: 800, vencimento: dia(0), status: 'aberta', categoria: 'Energia', origem: 'manual', criado_em: dia(-10) },
    { id: 'k3', descricao: 'INTERNET EM TRES DIAS', favorecido: 'Operadora', valor: 300, vencimento: dia(3), status: 'aberta', categoria: 'Internet', origem: 'manual', criado_em: dia(-10) },
    { id: 'k4', descricao: 'SEGURO LA NA FRENTE', favorecido: 'Seguradora', valor: 500, vencimento: dia(60), status: 'aberta', categoria: 'Seguro', origem: 'manual', criado_em: dia(-10) } ];
  db.receber = [
    { id: 'r1', cliente_nome: 'CLIENTE ATRASADO', valor: 400, vencimento: dia(-1), status: 'aberta', forma: 'Boleto', parcela: 1, parcelas: 1, descricao: 'O.S. 1', ordem_id: null },
    { id: 'r2', cliente_nome: 'CLIENTE DE HOJE', valor: 250, vencimento: dia(0), status: 'aberta', forma: 'Pix', parcela: 1, parcelas: 1, descricao: 'O.S. 2', ordem_id: null },
    { id: 'r3', cliente_nome: 'CLIENTE DE TRES DIAS', valor: 150, vencimento: dia(3), status: 'aberta', forma: 'Boleto', parcela: 1, parcelas: 1, descricao: 'O.S. 3', ordem_id: null },
    { id: 'r4', cliente_nome: 'CLIENTE LA NA FRENTE', valor: 900, vencimento: dia(60), status: 'aberta', forma: 'Boleto', parcela: 1, parcelas: 1, descricao: 'O.S. 4', ordem_id: null } ];
  db.boletos = [
    { id: 'b1', pagador_nome: 'PAGADOR ATRASADO', valor: 400, vencimento: dia(-1), situacao: 'registrado', nosso_numero: '000000001', os_numero: 1, emissao: dia(-10) },
    { id: 'b2', pagador_nome: 'PAGADOR DE HOJE', valor: 250, vencimento: dia(0), situacao: 'registrado', nosso_numero: '000000002', os_numero: 2, emissao: dia(-10) },
    { id: 'b3', pagador_nome: 'PAGADOR LA NA FRENTE', valor: 900, vencimento: dia(60), situacao: 'registrado', nosso_numero: '000000003', os_numero: 3, emissao: dia(-10) } ];
})();"""

def rodar(b, nome, w, h):
  T = lambda t: "[" + nome + "] " + t
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(PREP)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1200)

  # ---------- contas a pagar
  pg.goto(U + "#/financeiro"); pg.wait_for_timeout(1800)
  chk(T("contas a pagar: o filtro de vencimento aparece com os atalhos"), pg.locator("#fin-venc-sel").count() == 1
      and "Vencidos" in pg.inner_text("#fin-venc") and "Período escolhido" in pg.inner_text("#fin-venc"))
  texto = pg.inner_text("main")
  chk(T("contas a pagar: sem filtro, as quatro contas aparecem"), all(x in texto for x in ["ALUGUEL ATRASADO", "ENERGIA DE HOJE", "INTERNET EM TRES DIAS", "SEGURO LA NA FRENTE"]), texto[:200])
  pg.select_option("#fin-venc-sel", "vencidos"); pg.wait_for_timeout(500)
  texto = pg.inner_text("main")
  chk(T("vencidos: só o que já venceu"), "ALUGUEL ATRASADO" in texto and "ENERGIA DE HOJE" not in texto and "SEGURO LA NA FRENTE" not in texto, texto[:300])
  pg.select_option("#fin-venc-sel", "hoje"); pg.wait_for_timeout(500)
  texto = pg.inner_text("main")
  chk(T("vencem hoje: só o de hoje"), "ENERGIA DE HOJE" in texto and "ALUGUEL ATRASADO" not in texto and "INTERNET EM TRES DIAS" not in texto)
  pg.select_option("#fin-venc-sel", "7d"); pg.wait_for_timeout(500)
  texto = pg.inner_text("main")
  chk(T("próximos 7 dias: hoje e os três dias, sem o atrasado nem o de 60 dias"),
      "ENERGIA DE HOJE" in texto and "INTERNET EM TRES DIAS" in texto and "ALUGUEL ATRASADO" not in texto and "SEGURO LA NA FRENTE" not in texto)
  pg.select_option("#fin-venc-sel", "pers"); pg.wait_for_timeout(400)
  chk(T("período escolhido: abre os campos de e até"), pg.locator("#fin-venc-de").count() == 1 and pg.locator("#fin-venc-ate").count() == 1)
  dias = pg.evaluate("window.__DIAS")
  pg.fill("#fin-venc-de", dias["hoje"]); pg.fill("#fin-venc-ate", dias["tres"]); pg.wait_for_timeout(600)
  texto = pg.inner_text("main")
  chk(T("período escolhido: só o que vence dentro dele"), "ENERGIA DE HOJE" in texto and "INTERNET EM TRES DIAS" in texto and "ALUGUEL ATRASADO" not in texto, texto[:300])
  chk(T("contas a pagar: o filtro de período da tela continua lá (é um filtro a mais)"), "Pela data de" in pg.inner_text("main") or pg.locator(".fin-periodo select").count() >= 1)
  pg.click("#fin-venc-limpar"); pg.wait_for_timeout(500)
  chk(T("limpar: todas voltam"), "ALUGUEL ATRASADO" in pg.inner_text("main") and "SEGURO LA NA FRENTE" in pg.inner_text("main"))
  pg.select_option("#fin-venc-sel", "vencidos"); pg.wait_for_timeout(400)
  pg.reload(); pg.wait_for_timeout(1800)
  chk(T("contas a pagar: o filtro continua escolhido depois de recarregar"), pg.input_value("#fin-venc-sel") == "vencidos")
  pg.click("#fin-venc-limpar"); pg.wait_for_timeout(400)

  # ---------- contas a receber
  pg.goto(U + "#/receber"); pg.wait_for_timeout(1800)
  chk(T("contas a receber: o mesmo filtro, com os mesmos atalhos"), pg.locator("#rec-venc-sel").count() == 1
      and [o.strip() for o in pg.locator("#rec-venc-sel option").all_inner_texts()][:3] == ["Todos os vencimentos", "Vencidos", "Vencem hoje"],
      pg.locator("#rec-venc-sel option").all_inner_texts())
  pg.select_option("#rec-venc-sel", "7d"); pg.wait_for_timeout(500)
  texto = pg.inner_text("main")
  chk(T("a receber nos próximos 7 dias: hoje e três dias"), "CLIENTE DE HOJE" in texto and "CLIENTE DE TRES DIAS" in texto
      and "CLIENTE ATRASADO" not in texto and "CLIENTE LA NA FRENTE" not in texto, texto[:300])
  chk(T("a receber: a tela diz quantas parcelas e quanto dá no filtro"), pg.locator("#rec-venc-resumo").count() == 1
      and "2 parcela" in pg.inner_text("#rec-venc-resumo") and "400,00" in pg.inner_text("#rec-venc-resumo"), pg.inner_text("#rec-venc-resumo"))
  pg.click("#rec-venc-limpar"); pg.wait_for_timeout(400)

  # ---------- boletos
  pg.goto(U + "#/boletos"); pg.wait_for_timeout(1800)
  if pg.locator(".abas button:has-text('Em aberto')").count(): pg.click(".abas button:has-text('Em aberto')"); pg.wait_for_timeout(800)
  if pg.locator("#bol-venc-sel").count():
    chk(T("boletos: o mesmo filtro de vencimento"), True)
    pg.select_option("#bol-venc-sel", "vencidos"); pg.wait_for_timeout(600)
    texto = pg.inner_text("main")
    chk(T("boletos vencidos: só o que passou do vencimento"), "PAGADOR ATRASADO" in texto and "PAGADOR DE HOJE" not in texto and "PAGADOR LA NA FRENTE" not in texto, texto[:300])
    pg.click("#bol-venc-limpar"); pg.wait_for_timeout(500)
    chk(T("boletos: limpar traz todos de volta"), "PAGADOR LA NA FRENTE" in pg.inner_text("main"))
  else:
    chk(T("boletos: o filtro de vencimento aparece na lista"), False, "aba de lista não abriu no teste")
  chk(T("sem rolagem lateral"), pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  pg.screenshot(path=os.path.join(TMP, "filtro_vencimento_" + nome + ".png"))
  pg.close()

with sync_playwright() as p:
  b = p.chromium.launch()
  rodar(b, "pc", 1366, 768); rodar(b, "celular", 390, 844)
  b.close()
srv.terminate()
for f in falhas: print("FALHOU:", f)
for e in erros: print("ERRO JS:", e)
print(len(ok), "ok,", len(falhas), "falhas,", len(erros), "erros de página. Fotos em", TMP)
sys.exit(1 if falhas or erros else 0)
