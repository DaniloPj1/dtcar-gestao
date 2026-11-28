# Revisão de telas pedida pelo Danilo em 25/11/2026:
#  - prévia lateral da O.S. com o preço de cada item (antes só saía o total);
#  - filtro de O.S. finalizadas em grade de 4 colunas, 6 linhas por vez, com "Ver mais 6 linhas";
#  - quadros de RH e de Sistema que escondem o conteúdo ao clicar no título (e lembram a escolha);
#  - proporção da tela por aba (Compacto, Médio, Largo), guardada por aba;
#  - "Limpar notificações" no sininho;
#  - tema que muda sozinho com o horário (claro das 6h às 18h).
# Uso: python3 teste/teste_revisao_telas.py [pasta das fotos]
import subprocess, time, sys, os, tempfile
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8795", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra)[:500])
U = "http://localhost:8795/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()

# 30 O.S. finalizadas (para a grade de 4 colunas encher mais de 6 linhas) e itens com preço na O.S. 1898
PREP = """(() => { const db = window.__DB;
  try { localStorage.setItem('dtcar-visao-os', 'cards'); } catch (e) {}   // a grade das finalizadas é a visão em cards
  const base = db.ordens.find(o => o.id === 'o2');
  for (let i = 0; i < 30; i++) db.ordens.push({ ...base, id: 'fin' + i, numero: 1700 + i, status: 'entregue', recebido: 300, total: 300,
    finalizada_em: '2026-11-0' + (1 + (i % 9)) + 'T10:00:00-03:00', entregue_em: '2026-11-0' + (1 + (i % 9)) + 'T10:00:00-03:00' });
  db.os_itens.push({ id: 'it1', ordem_id: 'o2', tipo: 'servico', descricao: 'TROCA DE OLEO E FILTRO', qtd: 1, valor_unit: 180, custo_unit: 0, aprovado: true });
  db.os_itens.push({ id: 'it2', ordem_id: 'o2', tipo: 'peca', descricao: 'FILTRO DE OLEO', qtd: 2, valor_unit: 45, custo_unit: 20, aprovado: true });
  db.os_itens.push({ id: 'it3', ordem_id: 'o2', tipo: 'peca', descricao: 'OLEO 5W30', qtd: 4, valor_unit: 60, custo_unit: 35, aprovado: true });
})();"""

def rodar(b, nome, w, h):
  T = lambda t: "[" + nome + "] " + t
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(PREP)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1200)

  # ---------- 1. prévia lateral com o preço de cada item (item 4.1)
  pg.goto(U + "#/ordens?filtro=abertas"); pg.wait_for_timeout(1200)
  if w > 1100:
    pg.locator(".os-card:has-text('01898') .osc-corpo").first.click(); pg.wait_for_timeout(1500)
    pv = pg.locator(".pv")
    chk(T("prévia: cada item com quantidade × unitário e o total da linha"), pv.count() == 1
        and "TROCA DE OLEO E FILTRO" in pv.inner_text() and "1 × R$ 180,00" in pv.inner_text().replace(" ", " ")
        and "2 × R$ 45,00" in pv.inner_text().replace(" ", " ") and "R$ 90,00" in pv.inner_text().replace(" ", " "), pv.inner_text()[:500])
    chk(T("prévia: soma por grupo, desconto do item e total da O.S."), "Soma das peças e terceiros" in pv.inner_text()
        and "R$ 240,00" in pv.inner_text().replace("\u00a0", " ")   # item com desconto: 1 × 260 − 20 and "330,00" in pv.inner_text().replace(" ", " ")
        and "Total da O.S." in pv.inner_text(), repr(pv.inner_text().replace("\u00a0", " ")[-500:]))
    pg.screenshot(path=os.path.join(TMP, "previa_precos_" + nome + ".png"))

  # ---------- 2. O.S. finalizadas: grade de 4 colunas, 6 linhas por vez (item 4.2)
  pg.goto(U + "#/ordens?filtro=finalizadas"); pg.wait_for_timeout(1500)
  if w > 1100:
    pg.locator(".pv-fechar").click() if pg.locator(".pv-fechar").count() else None
    pg.wait_for_timeout(400)
    chk(T("finalizadas: grade (não as colunas por etapa) com 24 O.S. = 4 colunas × 6 linhas"), pg.locator(".os-grade4").count() == 1
        and pg.locator(".os-grade4 .os-card").count() == 24 and pg.locator(".os-colunas").count() == 0, pg.locator(".os-grade4 .os-card").count())
    chk(T("finalizadas: 4 colunas de verdade no PC"), pg.evaluate("getComputedStyle(document.querySelector('.os-grade4')).gridTemplateColumns.split(' ').length") == 4,
        pg.evaluate("getComputedStyle(document.querySelector('.os-grade4')).gridTemplateColumns"))
    chk(T("finalizadas: botão Ver mais 6 linhas com quantas faltam"), pg.locator("#os-ver-mais").count() == 1 and "6 linhas" in pg.inner_text("#os-ver-mais")
        and "restantes" in pg.inner_text("#os-ver-mais"), pg.inner_text("#os-ver-mais"))
    total_fin = pg.evaluate("window.__DB.ordens.filter(o => o.status === 'entregue' && o.finalizada_em).length")
    pg.click("#os-ver-mais"); pg.wait_for_timeout(600)
    chk(T("Ver mais: carrega mais 6 linhas e o botão some quando acaba"), pg.locator(".os-grade4 .os-card").count() == total_fin and pg.locator("#os-ver-mais").count() == 0,
        [pg.locator(".os-grade4 .os-card").count(), total_fin])
    pg.screenshot(path=os.path.join(TMP, "finalizadas_grade_" + nome + ".png"))
    # O.S. em aberto continua nas colunas por etapa
    pg.goto(U + "#/ordens?filtro=abertas"); pg.wait_for_timeout(1200)
    chk(T("em aberto: continua nas colunas por etapa, como antes"), pg.locator(".os-colunas").count() == 1 and pg.locator(".os-grade4").count() == 0)

  # ---------- 3. quadros de RH e de Sistema que dobram (item 4.3)
  for rota, tela in [("#/dados-locais", "Dados no computador"), ("#/ajustes", "Ajustes")]:
    pg.goto(U + rota); pg.wait_for_timeout(1500)
    if rota == "#/ajustes" and pg.locator(".aj-botoes button:has-text('Oficina')").count():
      pg.click(".aj-botoes button:has-text('Oficina')"); pg.wait_for_timeout(700)
    quadros = pg.locator("section.card.card-dobravel")
    if not quadros.count():
      chk(T(tela + ": tem quadro dobrável"), False, "nenhum section.card com título direto")
      continue
    if w > 900:
      cols = pg.evaluate("getComputedStyle(document.querySelector('.pagina-quadros')).gridTemplateColumns.split(' ').length") if pg.locator(".pagina-quadros").count() else 0
      chk(T(tela + ": os quadros ficam lado a lado quando a largura dá"), pg.locator(".pagina-quadros").count() == 1 and cols >= 2, cols)
      if quadros.count() >= 2:
        topos = pg.evaluate("[...document.querySelectorAll('main section.card')].slice(0,2).map(c => Math.round(c.getBoundingClientRect().top))")
        chk(T(tela + ": o segundo quadro fica ao lado do primeiro, não embaixo"), topos[0] == topos[1], topos)
    else:
      chk(T(tela + ": no celular os quadros continuam um embaixo do outro"),
          pg.evaluate("getComputedStyle(document.querySelector('main .pagina')).display") != "grid")
    chk(T(tela + ": os quadros ficam dobráveis e o título vira botão"), quadros.count() >= 1
        and quadros.first.locator(":scope > h2, :scope > h3, :scope > .secao-topo").first.get_attribute("role") == "button")
    alvo = quadros.first
    titulo = alvo.locator(":scope > h2, :scope > h3, :scope > .secao-topo").first
    nome_quadro = titulo.inner_text()
    titulo.click(); pg.wait_for_timeout(300)
    chk(T(tela + ": clicar no título esconde o conteúdo"), "card-dobrado" in (alvo.get_attribute("class") or "")
        and titulo.get_attribute("aria-expanded") == "false", alvo.get_attribute("class"))
    titulo.click(); pg.wait_for_timeout(300)
    chk(T(tela + ": clicar de novo mostra"), "card-dobrado" not in (alvo.get_attribute("class") or ""))
    titulo.click(); pg.wait_for_timeout(300)
    pg.reload(); pg.wait_for_timeout(1800)
    if rota == "#/ajustes" and pg.locator(".aj-botoes button:has-text('Oficina')").count():
      pg.click(".aj-botoes button:has-text('Oficina')"); pg.wait_for_timeout(700)
    fechado = pg.locator("section.card.card-dobrado")
    chk(T(tela + ": o que ele fechou continua fechado depois de recarregar"), fechado.count() >= 1
        and nome_quadro.split("\n")[0] in fechado.first.inner_text(), fechado.first.inner_text()[:120] if fechado.count() else "nenhum")
    pg.locator("section.card.card-dobrado").first.locator(":scope > h2, :scope > h3, :scope > .secao-topo").first.click(); pg.wait_for_timeout(300)
  pg.goto(U + "#/dados-locais"); pg.wait_for_timeout(1500)
  pg.screenshot(path=os.path.join(TMP, "quadros_dobraveis_" + nome + ".png"))
  # tela que não é de RH nem de Sistema não dobra
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1200)
  chk(T("tela fora de RH e Sistema não ganha quadro dobrável"), pg.locator("section.card.card-dobravel").count() == 0)

  # ---------- 4. proporção da tela por aba (item 4.4)
  if w > 900:
    pg.goto(U + "#/ordens"); pg.wait_for_timeout(1200)
    chk(T("proporção: os três botões na barra de cima"), pg.locator(".prop-seg button").count() == 3 and "Compacto" in pg.inner_text(".prop-seg"))
    pg.click(".prop-seg button:has-text('Compacto')"); pg.wait_for_timeout(400)
    largura_compacta = pg.evaluate("document.querySelector('.pagina').getBoundingClientRect().width")
    chk(T("Compacto: a página estreita e o <main> marca a escolha"), pg.evaluate("document.querySelector('main').dataset.prop") == "compacto" and largura_compacta <= 901, largura_compacta)
    pg.click(".prop-seg button:has-text('Largo')"); pg.wait_for_timeout(400)
    largura_larga = pg.evaluate("document.querySelector('.pagina').getBoundingClientRect().width")
    chk(T("Largo: a página usa a largura da tela"), largura_larga > largura_compacta, [largura_compacta, largura_larga])
    pg.goto(U + "#/cadastros"); pg.wait_for_timeout(1200)
    chk(T("a escolha é por aba: outra aba não herda o Largo"), pg.evaluate("document.querySelector('main').dataset.prop || ''") == "")
    pg.goto(U + "#/ordens"); pg.wait_for_timeout(1200)
    chk(T("voltando para a aba, a proporção dela volta"), pg.evaluate("document.querySelector('main').dataset.prop") == "largo")
    pg.click(".prop-seg button:has-text('Largo')"); pg.wait_for_timeout(400)
    chk(T("clicar na opção ligada volta ao padrão da tela"), pg.evaluate("document.querySelector('main').dataset.prop || ''") == "")

  # ---------- 5. limpar notificações no sininho (item 3.1)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1500)
  sino = pg.locator(".sino:visible .sino-btn")
  if sino.count():
    sino.first.click(); pg.wait_for_timeout(500)
    tinha = pg.locator(".sino-item").count()
    if tinha:
      chk(T("sininho: botão Limpar notificações"), pg.locator("#sino-limpar").count() == 1)
      pg.click("#sino-limpar"); pg.wait_for_timeout(400)
      chk(T("limpar: a lista fica vazia e o número some do sininho"), pg.locator(".sino-item").count() == 0
          and "Avisos limpos" in pg.inner_text(".sino-lista") and pg.locator(".sino-n").count() == 0, pg.inner_text(".sino-lista")[:200])
      chk(T("limpar: dá para ver os já recebidos de novo"), pg.locator("#sino-ver-limpos").count() == 1 and str(tinha) in pg.inner_text("#sino-ver-limpos"))
      pg.click("#sino-ver-limpos"); pg.wait_for_timeout(300)
      chk(T("ver os já recebidos: os avisos voltam à lista"), pg.locator(".sino-item").count() == tinha)
    else:
      chk(T("sininho sem avisos: nada a limpar"), pg.locator("#sino-limpar").count() == 0)

  # ---------- 6. tema pelo horário (item 3.7)
  chk(T("tema pelo horário: 7h claro, 19h escuro, meia-noite escuro"),
      pg.evaluate("""(async () => { const m = await import('/js/tema.js');
        return [m.temaDoHorario(7), m.temaDoHorario(19), m.temaDoHorario(0), m.temaDoHorario(6), m.temaDoHorario(17)].join(','); })()""")
      == "claro,escuro,escuro,claro,claro")
  pg.evaluate("""(async () => { const m = await import('/js/tema.js'); m.aplicarTema('horario'); })()"""); pg.wait_for_timeout(300)
  chk(T("tema pelo horário: o sistema entra no tema que a hora pede"),
      pg.evaluate("document.documentElement.dataset.tema") == pg.evaluate("new Date().getHours() >= 6 && new Date().getHours() < 18 ? 'claro' : 'escuro'"),
      pg.evaluate("document.documentElement.dataset.tema"))
  if w > 900:
    bt = pg.locator(".bt-dir button[aria-label^='Tema']")
    chk(T("tema pelo horário: o botão da barra diz o que está valendo"), bt.count() == 1 and "horário" in (bt.get_attribute("aria-label") or "").lower(),
        bt.get_attribute("aria-label") if bt.count() else "sem botão de tema")
  pg.evaluate("""(async () => { const m = await import('/js/tema.js'); m.aplicarTema('auto'); })()"""); pg.wait_for_timeout(200)
  chk(T("sem rolagem lateral em nenhuma das telas mexidas"), pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
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
