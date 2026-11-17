# Compras (v59, 16/11/2026): pesquisa pela placa, preço de cada fornecedor numa linha (origem e data), informar preço, carrinho,
# pedidos por fornecedor (finalizar, voltar ao carrinho, cancelar, texto do pedido), Ajustes › Fornecedores conectados (senha nunca
# volta), banco sem o v59 (aviso, não quebra), mecânico sem acesso. PC e celular.
# Uso: python3 teste/teste_compras.py [pasta das fotos]
import subprocess, time, sys, os, tempfile, re
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8793", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=""): (ok if c else falhas).append(n if c or not extra else n + " :: " + str(extra)[:500])
U = "http://localhost:8793/"; TMP = sys.argv[1] if len(sys.argv) > 1 else tempfile.mkdtemp()
PREP = """(() => { const db = window.__DB;
  db.veiculos.push({ id: 'vx', placa: 'ONX2A20', marca: 'CHEVROLET', modelo: 'ONIX 10MT LT', ano: '2020', cliente_id: 'c1', km_atual: 10, motor: '' });
  // cubo de roda CDRD0314 (Perfect) do Onix: preço informado na AutoPeças hoje e preço velho na DPK
  db.compras_precos.push({ id: 'cp1', fornecedor_id: 'f1', codigo: 'CDRD0314', codigo_norm: 'CDRD0314', marca: 'PERFECT', descricao: 'CUBO DE RODA', preco: 189.9, estoque: 5, prazo: 'amanhã', origem: 'manual', consultado_em: new Date().toISOString() });
  db.compras_precos.push({ id: 'cp2', fornecedor_id: 'f2', codigo: 'CDRD-0314', codigo_norm: 'CDRD0314', marca: 'PERFECT', descricao: 'CUBO DE RODA', preco: 150, estoque: null, prazo: '', origem: 'manual', consultado_em: new Date(Date.now() - 20 * 864e5).toISOString() });
  const base = db.ordens.find(o => o.id === 'o3');
  db.ordens.push({ ...base, id: 'ox', numero: 1950, status: 'execucao', veiculo_id: 'vx', veiculo: { placa: 'ONX2A20', marca: 'CHEVROLET', modelo: 'ONIX 10MT LT', ano: '2020' }, total: 0 }); })();"""
def rodar(b, nome, w, h):
  T = lambda t: "[" + nome + "] " + t
  pg = b.new_context(viewport={"width": w, "height": h}).new_page()
  pg.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(PREP)
  pg.goto(U + "#/painel"); pg.wait_for_timeout(1200)
  # 1280x720 já não cabia na main (731 px); a regra da oficina é 1366x768
  if w > 900: chk(T("menu lateral: Compras em Operação" + (" e o menu cabe sem rolar" if h >= 768 else "")), pg.locator(".lateral button:has-text('Compras')").count() == 1 and (h < 768 or pg.evaluate("document.querySelector('.lateral').scrollHeight <= document.querySelector('.lateral').clientHeight + 1")), pg.evaluate("[document.querySelector('.lateral').scrollHeight, document.querySelector('.lateral').clientHeight]"))
  else: pg.goto(U + "#/mais"); pg.wait_for_timeout(500); chk(T("menu Mais: item Compras"), pg.locator(".linha:has-text('Compras')").count() == 1)
  pg.goto(U + "#/compras"); pg.wait_for_timeout(1500)
  chk(T("tela abre com placa em destaque e sem resultado"), pg.locator("#cp-placa").count() == 1 and "Digite a placa" in pg.inner_text("main"))
  # 1. pela placa
  pg.fill("#cp-placa", "onx2a20"); pg.wait_for_timeout(2500)
  chk(T("placa do cadastro: veículo reconhecido sem consulta paga"), "do cadastro" in pg.inner_text("#cp-veiculo") and "ONIX" in pg.inner_text("#cp-veiculo") and pg.evaluate("(window.__PLACA && window.__PLACA.chamadas || []).length") == 0)
  chk(T("peças do carro por grupo"), pg.locator(".cp-item").count() >= 6 and pg.locator(".cp-lista .pv-grupo h4").count() >= 4)
  chk(T("sem rolagem lateral"), pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  it = pg.locator('.cp-item[data-todos*="|CDRD0314|"]')
  chk(T("cubo de roda: dois fornecedores, do menor para o maior preço"), it.locator(".cp-oferta").count() == 2 and it.locator(".cp-oferta").all_inner_texts()[0].startswith("DPK"), it.locator(".cp-oferta").all_inner_texts())
  chk(T("preço velho (20 dias) marcado para confirmar e não é o menor; o de hoje leva o selo"), "há 20 dias" in it.locator('.cp-oferta[data-forn="DPK DISTRIBUIDORA"]').inner_text() and it.locator('.cp-oferta[data-forn="AutoPeças"] .cp-selo-menor').count() == 1 and it.locator('.cp-oferta[data-forn="DPK DISTRIBUIDORA"] .cp-selo-menor').count() == 0)
  chk(T("origem e data em cada preço"), "Informado" in it.locator('.cp-oferta[data-forn="AutoPeças"]').inner_text() and "5 un no fornecedor" in it.locator('.cp-oferta[data-forn="AutoPeças"]').inner_text() and "amanhã" in it.locator('.cp-oferta[data-forn="AutoPeças"]').inner_text())
  pg.screenshot(path=os.path.join(TMP, "compras_pesquisa_" + nome + ".png"))
  pg.fill("#cp-txt", "cubo de roda"); pg.wait_for_timeout(300)
  chk(T("filtro de texto dentro das peças do carro"), pg.locator(".cp-item").count() >= 1 and all("CUBO" in t for t in pg.locator(".cp-item strong").all_inner_texts()), pg.locator(".cp-item strong").all_inner_texts())
  # 2. informar preço (vendedor passou) numa peça sem preço
  sem = pg.locator(".cp-item:has(.cp-sem-preco)").first
  chk(T("peça sem preço diz para informar"), sem.count() == 1)
  pg.fill("#cp-txt", ""); pg.wait_for_timeout(300)
  sem = pg.locator(".cp-item:has(.cp-sem-preco)").first; cod = sem.get_attribute("data-cod")
  sem.locator(".cp-informar").click(); pg.wait_for_timeout(300)
  chk(T("Informar preço: fornecedor, peça (marca e código) e preço"), pg.locator("#cp-pr-forn").count() == 1 and pg.locator("#cp-pr-peca").count() == 1 and cod in pg.locator("#cp-pr-peca").inner_text())
  pg.click("#cp-pr-salvar"); pg.wait_for_timeout(200)
  chk(T("sem fornecedor: avisa"), "Escolha o fornecedor" in pg.inner_text("[role=dialog]"))
  pg.select_option("#cp-pr-forn", "f2"); pg.fill("#cp-pr-preco", "77,50"); pg.fill("#cp-pr-est", "3"); pg.fill("#cp-pr-prazo", "2 dias"); pg.click("#cp-pr-salvar"); pg.wait_for_timeout(600)
  it2 = pg.locator('.cp-item[data-cod="' + cod + '"]')
  chk(T("preço informado aparece na peça como Informado de hoje, 3 un, 2 dias"), it2.locator(".cp-oferta").count() == 1 and "77,50" in it2.inner_text() and "Informado" in it2.inner_text() and "3 un no fornecedor" in it2.inner_text() and "2 dias" in it2.inner_text(), it2.inner_text()[:400])
  chk(T("um preço só não leva selo de menor"), it2.locator(".cp-selo-menor").count() == 0)
  # 3. carrinho: menor preço do cubo + a peça informada
  it.locator('.cp-oferta[data-forn="AutoPeças"] .cp-add').click(); pg.wait_for_timeout(300)
  chk(T("Pôr no carrinho: quantidade, O.S. e placa já preenchida"), pg.locator("#cp-add-qtd").count() == 1 and pg.input_value("#cp-add-placa") == "ONX2A20")
  pg.fill("#cp-add-qtd", "2"); pg.fill("#cp-add-os", "1950"); pg.click("#cp-add-continuar"); pg.wait_for_timeout(500)
  chk(T("Pôr e continuar: segue na pesquisa, carrinho com 1 na aba"), pg.locator("#cp-placa").count() == 1 and "Carrinho (1)" in pg.inner_text(".abas"))
  it2.locator(".cp-add").click(); pg.wait_for_timeout(300); pg.click("#cp-add-ir"); pg.wait_for_timeout(600)
  chk(T("Pôr e ver o carrinho: dois fornecedores, totais certos"), pg.locator(".cp-forn").count() == 2 and "379,80" in pg.locator('.cp-forn[data-forn="AutoPeças"]').inner_text() and "77,50" in pg.locator('.cp-forn[data-forn="DPK DISTRIBUIDORA"]').inner_text() and "457,30" in pg.inner_text("#cp-total"), pg.inner_text(".cp-carrinho")[:400])
  chk(T("item do carrinho mostra O.S. e placa"), "O.S. 1950" in pg.inner_text(".cp-carrinho") and "ONX2A20" in pg.inner_text(".cp-carrinho"))
  pg.screenshot(path=os.path.join(TMP, "compras_carrinho_" + nome + ".png"))
  # mudar a quantidade recalcula
  q = pg.locator('.cp-forn[data-forn="AutoPeças"] .cp-ic-qtd input'); q.fill("3"); q.press("Enter"); pg.wait_for_timeout(500)
  chk(T("quantidade alterada: total do fornecedor e do carrinho"), "569,70" in pg.locator('.cp-forn[data-forn="AutoPeças"]').inner_text() and "647,20" in pg.inner_text("#cp-total"), pg.inner_text("#cp-total"))
  chk(T("sem rolagem lateral no carrinho"), pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  # 4. gerar pedidos
  pg.click("#cp-gerar"); pg.wait_for_timeout(300)
  chk(T("confirma antes de gerar, dizendo os fornecedores"), "AutoPeças" in pg.inner_text("[role=dialog]") and "DPK" in pg.inner_text("[role=dialog]"))
  pg.click("[role=dialog] .btn-pri"); pg.wait_for_timeout(800)
  chk(T("dois pedidos a finalizar, um por fornecedor, carrinho vazio"), pg.locator(".cp-pedido").count() == 2 and "A finalizar no fornecedor" in pg.inner_text(".cp-pedidos") and pg.evaluate("window.__DB.compras_carrinho.length") == 0, pg.inner_text(".cp-pedidos")[:300])
  chk(T("o pedido guarda os itens com O.S. e placa"), "O.S. 1950" in pg.locator(".cp-pedido:has-text('AutoPeças')").inner_text() and "569,70" in pg.locator(".cp-pedido:has-text('AutoPeças')").inner_text())
  chk(T("nada no estoque, O.S. ou financeiro"), pg.evaluate("window.__DB.produtos.length") == 4 and pg.evaluate("window.__DB.os_itens.filter(i => i.ordem_id === 'ox').length") == 0 and pg.evaluate("window.__DB.contas.length") == 4)
  pg.screenshot(path=os.path.join(TMP, "compras_pedidos_" + nome + ".png"))
  # texto do pedido no padrão das mensagens
  pg.locator(".cp-pedido:has-text('AutoPeças') .cp-texto").click(); pg.wait_for_timeout(300)
  txt = pg.input_value("#cp-texto-pedido")
  chk(T("texto do pedido: saudação com Sr., itens em tópicos, assinatura e marca do sistema"), txt.startswith(("Bom dia, Sr. Joao!", "Boa tarde, Sr. Joao!", "Boa noite, Sr. Joao!")) and "• 3 x CUBO DE RODA" in txt and "DTCar Centro Automotivo" in txt and txt.endswith("*Mensagem gerada pelo sistema Gestão DTCar*"), txt)
  chk(T("fornecedor com telefone: botão Abrir no WhatsApp"), pg.locator("[role=dialog] a:has-text('Abrir no WhatsApp')").count() == 1 and "wa.me/5527988887777" in pg.locator("[role=dialog] a:has-text('Abrir no WhatsApp')").get_attribute("href"))
  pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
  # voltar ao carrinho, finalizar e cancelar
  pg.locator(".cp-pedido:has-text('DPK') .cp-voltar").click(); pg.wait_for_timeout(200); pg.click("[role=dialog] .btn-pri"); pg.wait_for_timeout(600)
  chk(T("Voltar para o carrinho: pedido cancelado, item de volta"), pg.locator(".cp-pedido").count() == 1 and pg.evaluate("window.__DB.compras_carrinho.length") == 1 and "Carrinho (1)" in pg.inner_text(".abas"))
  pg.locator(".cp-pedido:has-text('AutoPeças') .cp-finalizar").click(); pg.wait_for_timeout(200); pg.fill("#cp-fin-doc", "PV 4567"); pg.click("#cp-fin-ok"); pg.wait_for_timeout(600)
  chk(T("finalizado some de 'a finalizar'"), pg.locator(".cp-pedido").count() == 0)
  pg.click(".seg button:has-text('Finalizados')"); pg.wait_for_timeout(300)
  chk(T("Finalizados: com nº no fornecedor e quem finalizou"), pg.locator(".cp-pedido").count() == 1 and "PV 4567" in pg.inner_text(".cp-pedido") and "Finalizado" in pg.inner_text(".cp-pedido .pill"))
  pg.click(".cp-desfazer"); pg.wait_for_timeout(500); pg.click(".seg button:has-text('A finalizar')"); pg.wait_for_timeout(300)
  pg.locator(".cp-pedido .cp-cancelar").click(); pg.wait_for_timeout(200); pg.click("#cp-can-ok"); pg.wait_for_timeout(200)
  chk(T("cancelar exige motivo"), "Informe o motivo" in pg.inner_text("[role=dialog]"))
  pg.fill("#cp-can-motivo", "achei mais barato"); pg.click("#cp-can-ok"); pg.wait_for_timeout(500); pg.click(".seg button:has-text('Cancelados')"); pg.wait_for_timeout(300)
  chk(T("Cancelados: dois, com o motivo escrito"), pg.locator(".cp-pedido").count() == 2 and "achei mais barato" in pg.inner_text(".cp-pedidos") and "Voltou para o carrinho" in pg.inner_text(".cp-pedidos"))
  # 5. sem placa: pesquisa por código e última compra da nota
  pg.goto(U + "#/compras"); pg.wait_for_timeout(800); pg.fill("#cp-placa", ""); pg.fill("#cp-txt", "KYB-334"); pg.wait_for_timeout(500)
  chk(T("código fora do catálogo: mostra o preço da última compra (nota) da DPK"), pg.locator("#cp-soltos").count() == 1 and "610,00" in pg.inner_text("#cp-soltos") and "Última compra" in pg.inner_text("#cp-soltos") and "01/10/2026" in pg.inner_text("#cp-soltos"), pg.inner_text("main")[:400])
  pg.fill("#cp-txt", "amortecedor dianteiro"); pg.wait_for_timeout(600)
  chk(T("pesquisa por descrição no catálogo, sem placa"), pg.locator(".cp-item").count() >= 3 and all("AMORTECEDOR" in t for t in pg.locator(".cp-item strong").all_inner_texts()[:5]))
  # 6. Ajustes › Fornecedores conectados (senha nunca volta)
  pg.goto(U + "#/ajustes"); pg.wait_for_timeout(1000)
  chk(T("Ajustes: cartão Fornecedores conectados"), pg.locator("#cp-conexoes").count() == 1 and "Nenhum fornecedor conectado" in pg.inner_text("#cp-conexoes"))
  pg.click("#cp-conectar"); pg.wait_for_timeout(300); pg.select_option("#cp-cx-forn", "f1"); pg.fill("#cp-cx-end", "ws.autopecas.com/api"); pg.click("#cp-cx-salvar"); pg.wait_for_timeout(200)
  chk(T("endereço sem https: avisa"), "https://" in pg.inner_text("[role=dialog] .erros"))
  pg.fill("#cp-cx-end", "https://ws.autopecas.com/api"); pg.fill("#cp-cx-usu", "oficina01"); pg.fill("#cp-cx-senha", "S3nh@"); pg.click("#cp-cx-salvar"); pg.wait_for_timeout(600)
  chk(T("conectado: webservice, usuário, senha guardada; a senha não aparece na tela"), "AutoPeças" in pg.inner_text("#cp-conexoes") and "senha guardada" in pg.inner_text("#cp-conexoes") and "S3nh@" not in pg.content() and pg.evaluate("window.__SEGREDOS['compras_acesso:' + window.__DB.compras_fornecedores[0].id]") == "S3nh@")
  pg.locator("#cp-conexoes .cp-conexao button:has-text('Editar')").click(); pg.wait_for_timeout(300)
  chk(T("editar: campo da senha vem vazio e diz quando foi guardada"), pg.input_value("#cp-cx-senha") == "" and "Guardada em" in pg.inner_text("[role=dialog]") and pg.locator("#cp-cx-apagar").count() == 1)
  pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
  pg.goto(U + "#/compras"); pg.wait_for_timeout(800)
  chk(T("Compras avisa quais fornecedores estão conectados (sem portal reconhecido: sem botão de consulta ao vivo)"), "Fornecedores conectados: AutoPeças" in pg.inner_text("#cp-origem") and "portal reconhecido" in pg.inner_text("#cp-origem") and pg.locator(".cp-consultar").count() == 0, pg.inner_text("#cp-origem"))
  pg.screenshot(path=os.path.join(TMP, "compras_conexoes_" + nome + ".png"))
  # 6b. etapa 2: consulta AO VIVO pela função "compras" (de mentira): portal reconhecido pelo endereço, Testar conexão, botão por peça, preço "Ao vivo"
  pg.goto(U + "#/ajustes"); pg.wait_for_timeout(1000)
  pg.click("#cp-conectar"); pg.wait_for_timeout(300); pg.select_option("#cp-cx-forn", "f2"); pg.click("button:has-text('Portal (site)')"); pg.fill("#cp-cx-end", "https://www.dpk.com.br/#/"); pg.wait_for_timeout(200)
  chk(T("Ajustes: robô reconhecido pelo endereço ao digitar"), "Robô reconhecido: DPK" in pg.inner_text("#cp-cx-robo"), pg.inner_text("[role=dialog]")[:300])
  pg.fill("#cp-cx-usu", "danilo@dtcar.com"); pg.fill("#cp-cx-senha", "S3nh@dpk"); pg.click("#cp-cx-salvar"); pg.wait_for_timeout(600)
  dpk = pg.locator('.cp-conexao[data-robo="dpk"]')
  chk(T("conexão DPK: robô, consulta pelo servidor e botão Testar conexão; AutoPeças sem robô e sem o botão"), dpk.count() == 1 and "Robô: DPK" in dpk.inner_text() and "pelo servidor" in dpk.inner_text() and dpk.locator(".cp-testar").count() == 1
      and pg.locator('.cp-conexao[data-robo=""] .cp-testar').count() == 0 and "não reconhecido" in pg.locator('.cp-conexao[data-robo=""]').inner_text() and "S3nh@dpk" not in pg.content(), pg.inner_text("#cp-conexoes")[:500])
  dpk.locator(".cp-testar").click(); pg.wait_for_timeout(800)
  chk(T("Testar conexão: a função faz o login de teste e a situação vira Conectado"), "Conectou e buscou: 1 preço" in pg.inner_text('.cp-conexao[data-robo="dpk"]') and "Conectado" in pg.inner_text('.cp-conexao[data-robo="dpk"]') and pg.evaluate("window.__AOVIVO[0].acao") == "testar" and pg.evaluate("window.__DB.compras_precos.filter(p => p.origem === 'ao_vivo').length") == 0, pg.inner_text('.cp-conexao[data-robo="dpk"]'))
  pg.screenshot(path=os.path.join(TMP, "compras_conexoes_robo_" + nome + ".png"))
  pg.goto(U + "#/compras"); pg.wait_for_timeout(800)
  chk(T("Compras: avisa que a consulta ao vivo busca na DPK"), "ao vivo" in pg.inner_text("#cp-origem") and "DPK DISTRIBUIDORA" in pg.inner_text("#cp-origem"), pg.inner_text("#cp-origem"))
  pg.fill("#cp-txt", ""); pg.fill("#cp-placa", "onx2a20"); pg.wait_for_timeout(2500)
  it = pg.locator('.cp-item[data-todos*="|CDRD0314|"]')
  chk(T("cada peça tem o botão Consultar fornecedores"), it.locator(".cp-consultar").count() == 1 and pg.locator(".cp-consultar").count() >= 6)
  antes = pg.evaluate("window.__AOVIVO.length")
  it.locator(".cp-consultar").click(); pg.wait_for_timeout(1200)
  chamada = pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1]")
  chk(T("clique: uma chamada só, com os códigos da peça e dos equivalentes (no máximo 6) e só a conexão com robô"), pg.evaluate("window.__AOVIVO.length") == antes + 1 and "CDRD0314" in [c.upper().replace(" ", "") for c in chamada["termos"]] and 1 <= len(chamada["termos"]) <= 6 and len(chamada["conexoes"]) == 1, chamada)
  chk(T("resultado: linha Ao vivo da DPK com preço, estoque e a hora; resumo da consulta na peça"), "Ao vivo" in it.inner_text() and "63,24" in it.inner_text() and "12 un no fornecedor" in it.inner_text() and re.search(r"\d\d/\d\d/\d{4},? \d\d:\d\d", it.inner_text()) is not None and "DPK DISTRIBUIDORA:" in it.locator(".cp-vivo-estado").inner_text() and "preço" in it.locator(".cp-vivo-estado").inner_text(), it.inner_text()[:600])
  chk(T("preço ao vivo de hoje leva o selo de menor preço"), it.locator('.cp-oferta[data-forn="DPK DISTRIBUIDORA"].cp-menor').count() >= 1, it.locator(".cp-oferta").all_inner_texts())
  chk(T("sem rolagem lateral com a consulta"), pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  pg.screenshot(path=os.path.join(TMP, "compras_aovivo_" + nome + ".png"))
  # função fora do ar / não publicada: aviso na peça, nada quebra
  pg.evaluate("window.__AOVIVO_RESPOSTA = { ok: false, desligada: true, erro: 'A consulta aos fornecedores ainda não foi ligada: falta publicar a função \"compras\" no Supabase.' }")
  it2 = pg.locator(".cp-item").nth(0); it2.locator(".cp-consultar").click(); pg.wait_for_timeout(800)
  chk(T("função não publicada: o aviso aparece na peça e a tela segue"), "falta publicar" in it2.locator(".cp-vivo-estado").inner_text() and pg.locator("#cp-placa").count() == 1)
  pg.evaluate("window.__AOVIVO_RESPOSTA = null")
  # sem placa: consulta pelo texto digitado
  pg.fill("#cp-placa", ""); pg.fill("#cp-txt", "WK84213"); pg.wait_for_timeout(600)
  chk(T("sem placa: botão para consultar os fornecedores com o código digitado"), pg.locator("#cp-consultar-livre").count() == 1 and "WK84213" in pg.inner_text("#cp-consultar-livre"))
  pg.click("#cp-consultar-livre"); pg.wait_for_timeout(1200)
  res = pg.inner_text("#cp-soltos") if pg.locator("#cp-soltos").count() else pg.inner_text(".cp-resultado") if pg.locator(".cp-resultado").count() else ""
  chk(T("código digitado: consulta e mostra o preço Ao vivo (na peça do catálogo ou fora dele)"), pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1].termos") == ["WK84213"] and "Ao vivo" in res and "63,24" in res and "DPK DISTRIBUIDORA:" in pg.inner_text(".cp-vivo-livre"), res[:500])
  pg.fill("#cp-txt", "")
  # 7. banco sem o v59: aviso, não quebra
  pg2 = pg.context.new_page(); pg2.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg2.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg2.add_init_script("window.__SEM_V59 = true;")
  pg2.goto(U + "#/painel"); pg2.wait_for_timeout(1000); pg2.goto(U + "#/compras"); pg2.wait_for_timeout(1200)
  chk(T("sem o v59: aviso para rodar o SQL"), "v59.sql" in pg2.inner_text("#cp-erro"), pg2.inner_text("main")[:300])
  pg2.goto(U + "#/ajustes"); pg2.wait_for_timeout(1000)
  chk(T("sem o v59: Ajustes abre e o cartão só avisa"), pg2.locator("#a-nome").count() == 1 and "v59.sql" in pg2.inner_text("#cp-conexoes"))
  pg2.close()
  # 8. mecânico não entra
  pg3 = pg.context.new_page(); pg3.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg3.add_init_script("window.__PAPEL = 'mecanico';")
  pg3.goto(U + "#/painel"); pg3.wait_for_timeout(1000); pg3.goto(U + "#/compras"); pg3.wait_for_timeout(800)
  chk(T("mecânico: sem acesso à tela e sem o item no menu"), "não tem acesso" in pg3.inner_text("main") and pg3.locator("button:has-text('Compras')").count() == 0)
  pg3.close()

with sync_playwright() as p:
  b = p.chromium.launch()
  rodar(b, "pc", 1366, 768); rodar(b, "pc-pequeno", 1280, 720); rodar(b, "celular", 390, 844)
  b.close()
srv.terminate()
for f in falhas: print("FALHOU:", f)
for e in erros: print("ERRO JS:", e)
print(len(ok), "ok,", len(falhas), "falhas,", len(erros), "erros de página. Fotos em", TMP)
sys.exit(1 if falhas or erros else 0)
