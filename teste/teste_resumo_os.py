# Resumo de O.S. em aberto (13/11/2026): ficha do cliente / ficha do veículo › "Resumo das O.S. em aberto"
# → #/imprimir/resumo/<id>?de=cliente|veiculo[&os=1927,1928][&itens=0].
# Confere: quais O.S. entram (em execução e aguardando pagamento marcadas; orçamento só marcando; fechada nunca), o cabeçalho
# (proprietário do cadastro pelo veículo; lista de placas pelo cliente), itens e totais de cada O.S., desconto, recebido e falta
# receber (colunas só quando usadas), total geral, "Só o resumo", o caso do Jeep em UMA folha A4, o aviso de nomes diferentes só
# na tela, os botões nas fichas, o mecânico sem acesso aos valores e o celular sem rolagem lateral.
# Uso: python3 teste/teste_resumo_os.py [pasta das fotos]   (precisa de: pip install playwright && playwright install chromium; pdfinfo)
import subprocess, time, sys, os, tempfile, re, json
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8771", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or extra == "" else n + " :: " + str(extra)[:500])
U = "http://localhost:8771/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()

JEEP = {"placa": "QOW8427", "marca": "JEEP", "modelo": "COMPASS", "ano": "2018"}
def os_(id, numero, status, cli, cli_nome, vei, copia, rec, total, criado, **k):
  return dict({"id": id, "numero": numero, "status": status, "cliente_id": cli, "veiculo_id": vei, "cliente": {"nome": cli_nome}, "veiculo": copia, "reclamacao": rec,
    "total": total, "recebido": 0, "desconto": 0, "finalizada_em": None, "criado_em": criado, "atualizado_em": criado, "checkin": {"feito": True}}, **k)
DADOS = {
  "clientes": [
    {"id": "cr", "codigo": 509, "nome": "Renivaldo Luciano Nunes", "telefone": "69984042113", "cidade": "Santa Rita do Itueto", "uf": "MG", "situacao": "liberado"},
    {"id": "cd", "codigo": 1, "nome": "Cliente Diversos", "situacao": "liberado"},
    {"id": "cf", "codigo": 77, "nome": "Frota Teste Ltda", "doc": "11222333000181", "telefone": "2733334444", "rua": "Av. Brasil, 100", "bairro": "Centro", "cidade": "Colatina", "uf": "ES", "situacao": "liberado"},
    {"id": "cz", "codigo": 78, "nome": "Sem OS Aberta", "situacao": "liberado"}],
  "veiculos": [
    dict(JEEP, id="vj", cliente_id="cr", km_atual=0),
    {"id": "vf1", "placa": "PVA4G29", "marca": "Toyota", "modelo": "HILUX CS4X4", "ano": "2014", "cliente_id": "cf", "km_atual": 0},
    {"id": "vf2", "placa": "MSQ8C36", "marca": "Fiat", "modelo": "STRADA", "ano": "2009", "cliente_id": "cf", "km_atual": 0}],
  "ordens": [
    os_("j1", 1927, "execucao", "cd", "Cliente Diversos", "vj", JEEP, "Revisão", 2115.24, "2026-11-13T09:04:18-03:00"),
    os_("j2", 1928, "execucao", "cr", "Renivaldo Luciano Nunes", "vj", JEEP, "Revisão freio e suspensão ", 2644.20, "2026-11-13T11:15:00-03:00"),
    os_("j3", 1930, "diagnostico", "cr", "Renivaldo Luciano Nunes", "vj", JEEP, "Orçamento de pneus", 1800, "2026-11-13T12:00:00-03:00"),
    os_("j4", 1800, "entregue", "cr", "Renivaldo Luciano Nunes", "vj", JEEP, "Troca de óleo antiga", 300, "2026-09-01T09:00:00-03:00", recebido=300,
        finalizada_em="2026-09-02T10:00:00-03:00", entregue_em="2026-09-02T10:00:00-03:00"),
    os_("f1", 1874, "entregue", "cf", "Frota Teste Ltda", "vf1", {"placa": "PVA4G29", "marca": "Toyota", "modelo": "HILUX CS4X4", "ano": "2014"},
        "REVISAR FREIOS // TROCAR OLEO E FILTROS // REVISAR SUSPENSÃO // REVISAR CRUZETAS // REVISAR ROLAMENTOS DE RODA", 2160.35, "2026-10-14T08:58:00-03:00",
        recebido=1000, entregue_em="2026-10-20T17:00:00-03:00"),
    os_("f2", 1873, "pronto", "cf", "Frota Teste Ltda", "vf2", {"placa": "MSQ8C36", "marca": "Fiat", "modelo": "STRADA", "ano": "2009"}, "Embreagem", 710, "2026-10-14T08:45:00-03:00", desconto=40)],
  "itens": [("j1", t, d, q, v, c) for t, d, q, v, c in [
      ("peca", "Óleo 5W30 sintético – 5 L", 1, 290, ""), ("peca", "Filtro de óleo", 1, 28, ""), ("peca", "Filtro de ar do motor", 1, 58.49, ""),
      ("peca", "Filtro de ar da cabine", 1, 29.05, ""), ("peca", "Filtro de combustível", 1, 25, ""), ("servico", "Mão de obra troca de óleo e filtros", 1, 110, ""),
      ("peca", "Óleo de câmbio – 6 L", 1, 534, ""), ("servico", "Mão de obra troca de óleo do câmbio", 1, 250, ""), ("peca", "Trocador de calor do câmbio", 1, 440, ""),
      ("peca", "ADITIVO PARA RADIADOR PRONTO USO", 5, 34.14, "A010908000"), ("servico", "SUBST. DO TROCADOR DE CALOR", 1, 180, "")]]
    + [("j2", t, d, q, v, "") for t, d, q, v in [
      ("peca", "Pastilha freio traseira", 1, 299), ("peca", "Pastilha freio dianteira", 1, 244.40), ("peca", "Kit amortecedor traseiro", 2, 104), ("peca", "Bucha bandeja", 2, 88.40),
      ("peca", "Disco de Freio Dianteiro", 2, 273), ("servico", "Remoção da Balança para subst/ da bucha Maior", 2, 230), ("servico", "Remoção dos amort. traseiros p/substituição dos kit", 2, 150),
      ("servico", "Alinhamento 3d da direção", 1, 90), ("servico", "Subst. pastilha e disco dianteiro", 2, 80), ("servico", "Subst. pastilha de freio traseira", 2, 80)]]
    + [("j3", "peca", "Pneu 225/60 R17", 4, 450, ""), ("j4", "servico", "Troca de óleo", 1, 300, ""),
       ("f1", "peca", "Jogo de pastilhas", 1, 360.35, ""), ("f1", "servico", "Revisão geral", 1, 1800, ""),
       ("f2", "peca", "Kit embreagem", 1, 450, ""), ("f2", "servico", "Troca da embreagem", 1, 200, ""), ("f2", "terceiro", "Retífica do volante", 1, 100, "")],
}
PREP = "(d => { const db = window.__DB; if (!db) return; db.clientes.push(...d.clientes); db.veiculos.push(...d.veiculos); db.ordens.unshift(...d.ordens);" \
       " d.itens.forEach(([ordem_id, tipo, descricao, qtd, valor_unit, codigo], n) => db.os_itens.push({ id: 'ri' + n, ordem_id, tipo, descricao, qtd, valor_unit, codigo, desconto: 0, aprovado: true, executado: false, posicao: n })); })(" + json.dumps(DADOS) + ");"

def abrir(b, rota, w=1366, h=900, mecanico=False):
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
  pg.add_init_script(PREP)
  if mecanico: pg.add_init_script("window.__DB && (window.__DB.perfis[0].papel = 'mecanico');")
  pg.goto(U + rota); pg.wait_for_timeout(2200)
  return pg
def paginas(pg, nome):
  pdf = os.path.join(TMP, nome + ".pdf"); pg.pdf(path=pdf, format="A4", prefer_css_page_size=True)
  return int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout).group(1))
txt = lambda pg, sel=".folha.resos": pg.inner_text(sel).replace("\xa0", " ")

try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    # ---------- pelo veículo: o caso do Jeep (duas O.S. em execução, uma em nome de "Cliente Diversos")
    pg = abrir(b, "#/imprimir/resumo/vj?de=veiculo")
    t = txt(pg)
    for k in ["RESUMO DE ORDENS DE SERVIÇO", "Nº 01927 e 01928", "Emitido em", "Renivaldo Luciano Nunes", "(cód. 509)", "(69) 98404-2113", "QOW-8427", "JEEP COMPASS", "2018",
              "ORDEM DE SERVIÇO Nº 01927 · Revisão", "ORDEM DE SERVIÇO Nº 01928 · Revisão freio e suspensão", "Aberta em 13/11/2026, 09:04 · Aprovado · em execução",
              "Óleo 5W30 sintético – 5 L", "A010908000", "R$ 170,70", "Total de produtos", "R$ 1.575,24", "Total de serviços", "R$ 540,00", "Total da O.S. 01927", "R$ 2.115,24",
              "Disco de Freio Dianteiro", "R$ 1.474,20", "R$ 1.170,00", "Total da O.S. 01928", "R$ 2.644,20",
              "O.S. 01927 · Revisão", "R$ 3.049,44", "R$ 1.710,00", "R$ 4.759,44", "Nenhum valor foi recebido até a emissão", "os valores podem mudar até o fechamento"]:
      chk("jeep: tem " + k, k in t, k)
    chk("jeep: total geral e rodapé escritos", "TOTAL GERAL" in t.upper() and "NÃO VALE COMO RECIBO DE PAGAMENTO" in t.upper())
    chk("jeep: sem colunas de recebido (nada recebido)", "Recebido" not in t and "Falta receber" not in t and "FALTA RECEBER" not in t.upper())
    chk("jeep: custo das peças nunca aparece", "custo" not in t.lower())
    chk("jeep: orçamento e O.S. fechada fora da folha", "01930" not in t and "01800" not in t and "Pneu 225/60" not in t)
    esc = pg.inner_text(".resos-escolha")
    chk("jeep: lista para marcar tem as 3 em aberto e não a fechada", all(k in esc for k in ["O.S. 01927", "O.S. 01928", "O.S. 01930"]) and "01800" not in esc, esc)
    marc = pg.evaluate("[...document.querySelectorAll('.resos-opcoes input')].map(i => i.checked)")
    chk("jeep: em execução marcadas, orçamento desmarcado", marc == [True, True, False], marc)
    chk("jeep: aviso de nomes diferentes só na tela", "nomes diferentes" in esc and "Cliente Diversos" in esc and pg.evaluate("!!document.querySelector('.resos-escolha.so-tela')"))
    chk("jeep: quadro de marcar não sai na impressão", pg.evaluate("matchMedia('print').matches === false") and "so-tela" in pg.get_attribute(".resos-escolha", "class"))
    n = paginas(pg, "resumo_jeep"); chk("jeep (21 itens): UMA folha A4", n == 1, n)
    pg.screenshot(path=os.path.join(TMP, "resumo_jeep_pc.png"), full_page=True)
    chk("título da aba (nome do PDF salvo)", pg.title() == "Resumo OS QOW8427", pg.title())
    # marcar o orçamento: entra, com a etapa escrita, e o título vira a quantidade
    pg.check(".resos-opcoes label:nth-child(3) input"); pg.wait_for_timeout(400)
    t = txt(pg)
    chk("orçamento marcado: entra com a etapa escrita", "ORDEM DE SERVIÇO Nº 01930" in t and "Orçamento em elaboração" in t and "Pneu 225/60 R17" in t, t[-900:])
    chk("orçamento marcado: título com a quantidade", "3 O.S. em aberto" in t and "Nº 01927 e 01928" not in t)
    chk("orçamento marcado: total geral soma os três", "R$ 6.559,44" in t and "Orçamento ainda não aprovado" in t)
    # só o resumo
    pg.click(".resos-escolha button:has-text('Só o resumo')"); pg.wait_for_timeout(400)
    t = txt(pg)
    chk("só o resumo: sem os itens", pg.query_selector(".resos-os") is None and "Disco de Freio" not in t)
    chk("só o resumo: etapa escrita em cada linha e total geral", t.count("Aprovado · em execução") == 2 and "Orçamento em elaboração" in t and "R$ 6.559,44" in t, t)
    # desmarcar tudo: aviso, sem folha
    for i in range(1, 4): pg.uncheck(f".resos-opcoes label:nth-child({i}) input")
    pg.wait_for_timeout(300)
    chk("nada marcado: pede para marcar e não mostra folha", pg.query_selector(".folha.resos") is None and "Marque pelo menos uma O.S." in pg.inner_text("body"))
    pg.close()
    # O.S. escolhidas pela rota
    pg = abrir(b, "#/imprimir/resumo/vj?de=veiculo&os=1928")
    t = txt(pg); chk("rota com os=1928: só ela", "Nº 01928" in t and "01927" not in t and "R$ 2.644,20" in t, t[:300])
    pg.click(".imp-barra button:has-text('Voltar')"); pg.wait_for_timeout(1200)
    pg.close()

    # ---------- pelo cliente: frota com dois veículos, desconto, terceiros e recebimento parcial
    pg = abrir(b, "#/imprimir/resumo/cf?de=cliente")
    t = txt(pg)
    for k in ["Nº 01873 e 01874", "Frota Teste Ltda", "(cód. 77)", "11.222.333/0001-81", "(27) 3333-4444", "Av. Brasil, 100", "PVA4G29", "MSQ8C36", "Toyota HILUX CS4X4", "Fiat STRADA",
              "ORDEM DE SERVIÇO Nº 01873 · MSQ8C36 Fiat STRADA · Embreagem", "Aguardando pagamento · veículo no pátio", "Aguardando pagamento · veículo entregue",
              "Reclamação: REVISAR FREIOS // TROCAR OLEO E FILTROS", "Retífica do volante", "Total de serviços de terceiros", "Desconto", "− R$ 40,00", "Total da O.S. 01873", "R$ 710,00",
              "Total da O.S. 01874", "R$ 2.160,35", "Recebido", "R$ 1.000,00", "Falta receber", "R$ 1.160,35", "R$ 2.870,35", "R$ 1.870,35",
              "O.S. 01874 · PVA4G29 · REVISAR FREIOS"]:
      chk("frota: tem " + k, k in t, k)
    chk("frota: quadro 'Veículos' (mais de um)", "VEÍCULOS" in t.upper() and "Clientes diferentes" not in t)
    chk("frota: sem a frase de nada recebido", "Nenhum valor foi recebido" not in t)
    cab = [x.strip().upper() for x in pg.eval_on_selector_all(".resos-geral thead th", "l => l.map(x => x.innerText)")]
    chk("frota (com recebimento): colunas total, recebido e falta receber", cab == ["RESUMO GERAL", "TOTAL", "RECEBIDO", "FALTA RECEBER"], cab)
    lin = [x.replace("\xa0", " ") for x in pg.eval_on_selector_all(".resos-geral tbody tr:first-child td, .resos-geral tfoot td", "l => l.map(x => x.innerText)")]
    chk("frota: linha da 1873 e total geral", lin[1:4] == ["R$ 710,00", "R$ 0,00", "R$ 710,00"] and lin[5:8] == ["R$ 2.870,35", "R$ 1.000,00", "R$ 1.870,35"], lin)
    chk("frota: sem aviso de nomes diferentes", "nomes diferentes" not in pg.inner_text(".resos-escolha"))
    n = paginas(pg, "resumo_frota"); chk("frota: uma folha A4", n == 1, n)
    pg.screenshot(path=os.path.join(TMP, "resumo_frota_pc.png"), full_page=True)
    chk("título da aba pelo cliente", pg.title() == "Resumo OS Frota Teste Ltda", pg.title())
    pg.close()
    # sem recebimento e com terceiros: produtos, serviços, terceiros e total
    pg = abrir(b, "#/imprimir/resumo/cf?de=cliente&os=1873")
    cab = [x.strip().upper() for x in pg.eval_on_selector_all(".resos-geral thead th", "l => l.map(x => x.innerText)")]
    chk("só a 1873 (sem recebimento, com terceiros): colunas", cab == ["RESUMO GERAL", "PRODUTOS", "SERVIÇOS", "TERCEIROS", "TOTAL"], cab)
    lin = [x.replace("\xa0", " ") for x in pg.eval_on_selector_all(".resos-geral tfoot td", "l => l.map(x => x.innerText)")]
    chk("só a 1873: total geral com o desconto", lin[1:] == ["R$ 450,00", "R$ 200,00", "R$ 100,00", "R$ 710,00"], lin)
    pg.close()

    # ---------- botões nas fichas
    pg = abrir(b, "#/veiculo/vj")
    chk("ficha do veículo: botão do resumo", pg.query_selector("button:has-text('Resumo das O.S. em aberto')") is not None)
    pg.click("button:has-text('Resumo das O.S. em aberto')"); pg.wait_for_timeout(1500)
    chk("ficha do veículo: abre o resumo pelo veículo", pg.evaluate("location.hash") == "#/imprimir/resumo/vj?de=veiculo" and pg.query_selector(".folha.resos") is not None)
    pg.click(".imp-barra button:has-text('Voltar')"); pg.wait_for_timeout(1200)
    chk("voltar: volta para a ficha do veículo", pg.evaluate("location.hash") == "#/veiculo/vj", pg.evaluate("location.hash")); pg.close()
    pg = abrir(b, "#/cliente/cf")
    pg.click("button:has-text('Resumo das O.S. em aberto')"); pg.wait_for_timeout(1500)
    chk("ficha do cliente: abre o resumo pelo cliente", pg.evaluate("location.hash") == "#/imprimir/resumo/cf?de=cliente" and pg.query_selector(".folha.resos") is not None); pg.close()
    pg = abrir(b, "#/cliente/cz")
    chk("cliente sem O.S. em aberto: sem o botão", pg.query_selector("button:has-text('Resumo das O.S. em aberto')") is None and pg.query_selector("button:has-text('Imprimir ficha')") is not None); pg.close()
    pg = abrir(b, "#/imprimir/resumo/cz?de=cliente")
    chk("rota direta sem O.S. em aberto: avisa e não mostra folha", "Nenhuma O.S. em aberto" in pg.inner_text("body") and pg.query_selector(".folha.resos") is None); pg.close()
    pg = abrir(b, "#/imprimir/resumo/naoexiste?de=veiculo")
    chk("veículo que não existe: mensagem", "Veículo não encontrado" in pg.inner_text("body")); pg.close()

    # ---------- mecânico (sem ver valores): rota recusada, botão escondido
    pg = abrir(b, "#/imprimir/resumo/vj?de=veiculo", mecanico=True)
    chk("mecânico: rota recusada sem mostrar valores", pg.query_selector(".folha.resos") is None and "acesso aos valores" in pg.inner_text("body"), pg.inner_text("body")[:300]); pg.close()
    pg = abrir(b, "#/veiculo/vj", mecanico=True)
    chk("mecânico: ficha do veículo sem o botão do resumo", pg.query_selector("button:has-text('Resumo das O.S. em aberto')") is None); pg.close()

    # ---------- celular
    for rota, nome in [("#/imprimir/resumo/vj?de=veiculo", "resumo_jeep_celular"), ("#/imprimir/resumo/cf?de=cliente", "resumo_frota_celular"),
                       ("#/imprimir/resumo/cf?de=cliente&os=1873", "resumo_4colunas_celular"), ("#/veiculo/vj", "ficha_veiculo_celular"), ("#/cliente/cf", "ficha_cliente_celular")]:
      pg = abrir(b, rota, 393, 852)
      chk("celular sem rolagem lateral: " + rota, pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), pg.evaluate("[document.documentElement.scrollWidth, window.innerWidth]"))
      pg.screenshot(path=os.path.join(TMP, nome + ".png"), full_page=True); pg.close()
    # a O.S. normal continua igual
    pg = abrir(b, "#/imprimir/os/j2")
    chk("O.S. normal: continua abrindo como antes", pg.query_selector(".folha.os-a4") is not None and pg.query_selector(".folha.resos") is None and "ORDEM DE SERVIÇO" in pg.inner_text(".folha.os-a4")); pg.close()
    b.close()
finally:
  srv.terminate()
chk("sem erros de página", not erros, erros)
for f in falhas: print("FALHOU:", f)
print(f"{len(ok)} OK, {len(falhas)} falha(s)")
sys.exit(1 if falhas else 0)
