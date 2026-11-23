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
  chk(T("tela abre na aba Fornecedores (sem aba de acervo): placa opcional, campo da peça e botão"), pg.locator("#cot-placa").count() == 1 and pg.locator("#cot-txt").count() == 1 and "Acervo" not in pg.inner_text(".abas") and pg.locator("#cot-consultar").is_disabled())
  chk(T("sem fornecedor conectado: avisa para conectar em Ajustes"), "Ajustes" in pg.inner_text("#cot-origem"))
  # 1. placa do cadastro + código: a busca vai para o fornecedor como foi digitada (função de mentira), só com estoque
  pg.fill("#cot-placa", "onx2a20"); pg.fill("#cot-txt", "CDRD0314"); pg.wait_for_timeout(2500)
  chk(T("placa do cadastro: veículo reconhecido sem consulta paga"), "do cadastro" in pg.inner_text("#cot-veiculo") and "ONIX" in pg.inner_text("#cot-veiculo") and pg.evaluate("(window.__PLACA && window.__PLACA.chamadas || []).length") == 0)
  # placa fora do cadastro: 1º a consulta grátis pelo portal (ação "placa" da função de mentira)
  pg.evaluate("window.__AOVIVO_RESPOSTA = { ok: true, encontrado: true, placa: 'RST4E56', modelo: 'FIAT TORO 2.0 DIESEL 2020', fornecedor: 'DPK' }")
  pg.fill("#cot-placa", "RST4E56"); pg.wait_for_timeout(1500)
  chk(T("placa fora do cadastro: o modelo vem de graça pelo portal (DPK), sem a consulta paga"), "pela DPK (sem custo): FIAT TORO" in pg.inner_text("#cot-veiculo") and pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1].acao") == "placa" and pg.evaluate("(window.__PLACA && window.__PLACA.chamadas || []).length") == 0, pg.inner_text("#cot-veiculo"))
  # trocou a placa enquanto o portal respondia: a placa antiga NÃO vai para a consulta paga
  pg.evaluate("window.__AOVIVO_RESPOSTA = { ok: true, encontrado: false, placa: 'XYZ9A88' }; window.__AOVIVO_ATRASO = 1500; window.__PLACA = window.__PLACA || {}; window.__PLACA.chamadas = [];")
  pg.fill("#cot-placa", "XYZ9A88"); pg.wait_for_timeout(900); pg.fill("#cot-placa", ""); pg.wait_for_timeout(2200)
  chk(T("placa trocada antes do portal responder: nenhuma consulta paga da placa antiga"), not any("XYZ9A88" in str(c) for c in pg.evaluate("(window.__PLACA && window.__PLACA.chamadas) || []")), pg.evaluate("(window.__PLACA && window.__PLACA.chamadas) || []"))
  pg.evaluate("window.__AOVIVO_RESPOSTA = null; window.__AOVIVO_ATRASO = 0")
  pg.fill("#cot-placa", "onx2a20"); pg.wait_for_timeout(1200)
  chk(T("sem fornecedor com robô, o botão fica desligado"), pg.locator("#cot-consultar").is_disabled())
  # conecta a DPK (robô pelo endereço) e consulta
  pg.evaluate("window.__DB.compras_fornecedores.push({ id: 'cx-dpk', fornecedor_id: 'f2', tipo: 'portal', endereco: 'https://www.dpk.com.br', usuario: 'd@d.com', ativo: true, situacao: 'aguardando', detalhe: '', criado_em: new Date().toISOString() }); window.__SEGREDOS['compras_acesso:cx-dpk'] = 'x';")
  pg.goto(U + "#/compras?aba=carrinho"); pg.wait_for_timeout(500); pg.goto(U + "#/compras"); pg.wait_for_timeout(800)
  chk(T("DPK conectada: fichinha 'Aguardando a primeira consulta' e botão ligado"), pg.locator('#cot-situacoes .cot-sit[data-forn="DPK DISTRIBUIDORA"].cot-sit-aguardando').count() == 1 and pg.locator("#cot-consultar").is_enabled(), pg.inner_text("#cot-situacoes"))
  pg.evaluate("""window.__AOVIVO_RESPOSTA = { ok: true, em: new Date().toISOString(), resultados: [
    { conexao: 'cx-dpk', fornecedor_id: 'f2', ok: true, ofertas: [{ codigo: 'CDRD0314', marca: 'PERFECT', descricao: 'CUBO DE RODA', preco: 150, estoque: 4, prazo: '' }, { codigo: 'NKF8288', marca: 'NAKATA', descricao: 'CUBO DE RODA', preco: 120, estoque: 0, prazo: '' }] } ] }""")
  pg.click("#cot-consultar"); pg.wait_for_timeout(1200)
  chamada = pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1]")
  chk(T("a busca vai para o fornecedor como foi digitada, com a placa e o veículo junto"), chamada["termos"] == ["CDRD0314"] and chamada["placa"] == "ONX2A20" and "ONIX" in chamada["veiculo"] and chamada["conexoes"] == ["cx-dpk"], chamada)
  # peça pelo carro: a resposta diz para qual carro cada fornecedor filtrou
  pg.evaluate("""window.__AOVIVO_RESPOSTA = { ok: true, em: new Date().toISOString(), resultados: [
    { conexao: 'cx-dpk', fornecedor_id: 'f2', ok: true, veiculo: 'CHEVROLET ONIX 2020 1.0 FLEX', ofertas: [{ codigo: 'PD1512', marca: 'FRAS-LE', descricao: 'PASTILHA DE FREIO', preco: 120, estoque: 3, prazo: '' }] },
    { conexao: 'cx-r', fornecedor_id: 'f1', ok: true, sem_carro: 'este portal ainda busca sem o filtro do carro', ofertas: [] } ] }""")
  pg.fill("#cot-txt", "pastilha"); pg.click("#cot-consultar"); pg.wait_for_timeout(1000)
  chk(T("peça pelo carro: aviso diz o carro filtrado na DPK e quem ainda busca sem o filtro"), "só peças do CHEVROLET ONIX 2020" in pg.inner_text("#cot-carro") and "AutoPeças" in pg.inner_text("#cot-carro .cot-carro-sem") and pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1].veiculo").startswith("CHEVROLET ONIX"), pg.inner_text("#cot-carro"))
  pg.evaluate("""window.__AOVIVO_RESPOSTA = { ok: true, em: new Date().toISOString(), resultados: [
    { conexao: 'cx-dpk', fornecedor_id: 'f2', ok: true, ofertas: [{ codigo: 'CDRD0314', marca: 'PERFECT', descricao: 'CUBO DE RODA', preco: 150, estoque: 4, prazo: '' }, { codigo: 'NKF8288', marca: 'NAKATA', descricao: 'CUBO DE RODA', preco: 120, estoque: 0, prazo: '' }] } ] }""")
  pg.fill("#cot-txt", "CDRD0314"); pg.click("#cot-consultar"); pg.wait_for_timeout(1000)
  linhas = pg.locator(".cot-card")
  chk(T("tabela: DPK ao vivo (4 un) e AutoPeças informado (5 un), do mais barato para o mais caro; sem estoque fica de fora"), linhas.count() == 2 and linhas.nth(0).get_attribute("data-forn") == "DPK DISTRIBUIDORA" and "150,00" in linhas.nth(0).inner_text() and "4 un" in linhas.nth(0).inner_text()
      and linhas.nth(1).get_attribute("data-forn") == "AutoPeças" and "189,90" in linhas.nth(1).inner_text() and "NKF8288" not in pg.inner_text(".cot-resultado") and "1 sem estoque não aparece" in pg.inner_text(".cot-resultado"), pg.inner_text(".cot-resultado")[:600])
  chk(T("menor preço na DPK; origem ao vivo com hora e informado com data"), linhas.nth(0).locator(".cp-selo-menor").count() == 1 and "ao vivo" in linhas.nth(0).inner_text() and "informado" in linhas.nth(1).inner_text())
  chk(T("cards no estilo da DPK: foto, fabricante, cód. de fábrica, estoque em verde e Adicionar; cor por fornecedor"), "Fabricante: PERFECT" in linhas.nth(0).inner_text() and "Cód. de fábrica: CDRD0314" in linhas.nth(0).inner_text() and linhas.nth(0).locator(".cot-card-foto").count() == 1
      and linhas.nth(0).locator("button:has-text('Adicionar')").count() == 1 and linhas.nth(0).get_attribute("style") != linhas.nth(1).get_attribute("style"), linhas.nth(0).inner_text()[:300])
  pg.select_option("#cot-marca-filtro", "PERFECT"); pg.wait_for_timeout(200)
  chk(T("filtro por marca da peça e por fornecedor"), pg.locator(".cot-card").count() == 2 and pg.locator("#cot-forn-filtro option").count() == 3)
  pg.select_option("#cot-forn-filtro", "f1"); pg.wait_for_timeout(200)
  chk(T("filtro por fornecedor: só AutoPeças"), pg.locator(".cot-card").count() == 1 and pg.locator(".cot-card").nth(0).get_attribute("data-forn") == "AutoPeças")
  pg.select_option("#cot-forn-filtro", ""); pg.select_option("#cot-marca-filtro", ""); pg.wait_for_timeout(200)
  pg.click(".cot-tamanho button:has-text('Pequeno')"); pg.wait_for_timeout(200)
  chk(T("tamanho dos cards: Pequeno"), pg.locator(".cot-cards.cot-t-p").count() == 1)
  pg.click("#cot-ver-lista"); pg.wait_for_timeout(300)
  chk(T("Lista: as mesmas peças em linhas, sem cortar"), pg.locator(".cot-linha:not(.cot-sem)").count() == 2 and pg.locator(".cot-cards").count() == 0 and pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  pg.screenshot(path=os.path.join(TMP, "compras_fornecedores_lista_" + nome + ".png"))
  pg.click("#cot-ver-cards"); pg.click(".cot-tamanho button:has-text('Médio')"); pg.wait_for_timeout(300)
  chk(T("sem rolagem lateral"), pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
  pg.screenshot(path=os.path.join(TMP, "compras_fornecedores_" + nome + ".png"))
  pg.evaluate("window.__AOVIVO_RESPOSTA = null")
  # 3. carrinho: DPK (menor) e AutoPeças
  linhas.nth(0).locator(".cp-add").click(); pg.wait_for_timeout(300)
  chk(T("Pôr no carrinho: quantidade, O.S. e placa já preenchida; caixa 'também no carrinho do portal' marcada para o preço ao vivo"), pg.locator("#cp-add-qtd").count() == 1 and pg.input_value("#cp-add-placa") == "ONX2A20" and pg.locator("#cp-add-portal input").is_checked())
  pg.evaluate("window.__AOVIVO_RESPOSTA = { ok: true, robo: 'dpk', detalhe: 'No carrinho da DPK: 2 x CDRD0314.' }")
  pg.fill("#cp-add-qtd", "2"); pg.fill("#cp-add-os", "1950"); pg.click("#cp-add-continuar"); pg.wait_for_timeout(500)
  cp = pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1]")
  chk(T("Adicionar: o item vai também para o carrinho do portal (função carrinho_portal com os códigos internos) e o aviso diz"), cp["acao"] == "carrinho_portal" and cp["conexao"] == "cx-dpk" and cp["item"]["codigo"] == "CDRD0314" and cp["item"]["qtd"] == 2 and "carrinho da DPK" in pg.inner_text("body"), cp)
  pg.evaluate("window.__AOVIVO_RESPOSTA = null")
  chk(T("Pôr e continuar: segue na aba Fornecedores, carrinho com 1 na aba e no resumo ao lado"), pg.locator("#cot-txt").count() == 1 and "Carrinho (1)" in pg.inner_text(".abas") and "300,00" in pg.inner_text("#cot-carrinho"))
  pg.locator(".cot-card").nth(1).locator(".cp-add").click(); pg.wait_for_timeout(300)
  chk(T("preço informado (não ao vivo): sem a caixa do carrinho do portal"), pg.locator("#cp-add-portal").count() == 0)
  pg.fill("#cp-add-qtd", "3"); pg.fill("#cp-add-os", "1950"); pg.click("#cp-add-ir"); pg.wait_for_timeout(600)
  chk(T("Pôr e ver o carrinho: dois fornecedores, totais certos"), pg.locator(".cp-forn").count() == 2 and "569,70" in pg.locator('.cp-forn[data-forn="AutoPeças"]').inner_text() and "300,00" in pg.locator('.cp-forn[data-forn="DPK DISTRIBUIDORA"]').inner_text() and "869,70" in pg.inner_text("#cp-total"), pg.inner_text(".cp-carrinho")[:400])
  chk(T("item do carrinho mostra O.S. e placa"), "O.S. 1950" in pg.inner_text(".cp-carrinho") and "ONX2A20" in pg.inner_text(".cp-carrinho"))
  pg.screenshot(path=os.path.join(TMP, "compras_carrinho_" + nome + ".png"))
  # mudar a quantidade recalcula
  q = pg.locator('.cp-forn[data-forn="DPK DISTRIBUIDORA"] .cp-ic-qtd input'); q.fill("1"); q.press("Enter"); pg.wait_for_timeout(500)
  chk(T("quantidade alterada: total do fornecedor e do carrinho"), "150,00" in pg.locator('.cp-forn[data-forn="DPK DISTRIBUIDORA"]').inner_text() and "719,70" in pg.inner_text("#cp-total"), pg.inner_text("#cp-total"))
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
  # 5. sem placa: descrição vai como está; função não publicada / erro de senha aparecem sem quebrar
  pg.goto(U + "#/compras"); pg.wait_for_timeout(800); pg.fill("#cot-placa", ""); pg.fill("#cot-txt", "pastilha de freio"); pg.wait_for_timeout(300)
  pg.evaluate("window.__AOVIVO_RESPOSTA = { ok: false, desligada: true, erro: 'A consulta aos fornecedores ainda não foi ligada: falta publicar a função \"compras\" no Supabase.' }")
  pg.click("#cot-consultar"); pg.wait_for_timeout(800)
  chk(T("função não publicada: aviso claro e a tela segue"), "falta publicar" in pg.inner_text("#cot-erro") and pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1].termos") == ["pastilha de freio"])
  pg.evaluate("window.__AOVIVO_RESPOSTA = { ok: true, em: new Date().toISOString(), resultados: [ { conexao: 'cx-dpk', fornecedor_id: 'f2', ok: false, ofertas: [], erro: 'DPK recusou o login: confira o e-mail e a senha em Ajustes.' } ] }; window.__DB.compras_fornecedores[0].situacao = 'erro'; window.__DB.compras_fornecedores[0].detalhe = 'DPK recusou o login: confira o e-mail e a senha em Ajustes.'")
  pg.click("#cot-consultar"); pg.wait_for_timeout(800)
  chk(T("senha recusada: linha do fornecedor com o motivo e fichinha 'Com erro'"), pg.locator(".cot-sem").count() == 1 and "recusou o login" in pg.inner_text(".cot-sem") and pg.locator('#cot-situacoes .cot-sit-erro').count() == 1, pg.inner_text("#cot-situacoes"))
  pg.evaluate("window.__AOVIVO_RESPOSTA = null; window.__DB.compras_fornecedores = []; delete window.__SEGREDOS['compras_acesso:cx-dpk'];")
  # 6. Ajustes › Fornecedores conectados (senha nunca volta)
  pg.goto(U + "#/ajustes?aba=consultas"); pg.wait_for_timeout(1000)
  chk(T("Ajustes: cartão Fornecedores conectados"), pg.locator("#cp-conexoes").count() == 1 and "Nenhum fornecedor conectado" in pg.inner_text("#cp-conexoes"))
  pg.click("#cp-conectar"); pg.wait_for_timeout(300); pg.select_option("#cp-cx-forn", "f1"); pg.fill("#cp-cx-end", "ws.autopecas.com/api"); pg.click("#cp-cx-salvar"); pg.wait_for_timeout(200)
  chk(T("endereço sem https: avisa"), "https://" in pg.inner_text("[role=dialog] .erros"))
  pg.fill("#cp-cx-end", "https://ws.autopecas.com/api"); pg.fill("#cp-cx-usu", "oficina01"); pg.fill("#cp-cx-senha", "S3nh@"); pg.click("#cp-cx-salvar"); pg.wait_for_timeout(600)
  chk(T("conectado: webservice, usuário, senha guardada; a senha não aparece na tela"), "AutoPeças" in pg.inner_text("#cp-conexoes") and "senha guardada" in pg.inner_text("#cp-conexoes") and "S3nh@" not in pg.content() and pg.evaluate("window.__SEGREDOS['compras_acesso:' + window.__DB.compras_fornecedores[0].id]") == "S3nh@")
  pg.locator("#cp-conexoes .cp-conexao button:has-text('Editar')").click(); pg.wait_for_timeout(300)
  chk(T("editar: campo da senha vem vazio e diz quando foi guardada"), pg.input_value("#cp-cx-senha") == "" and "Guardada em" in pg.inner_text("[role=dialog]") and pg.locator("#cp-cx-apagar").count() == 1)
  pg.keyboard.press("Escape"); pg.wait_for_timeout(200)
  pg.goto(U + "#/compras"); pg.wait_for_timeout(800)
  chk(T("Compras: conexão sem portal reconhecido aparece na fichinha e o botão fica desligado"), pg.locator('#cot-situacoes .cot-sit[data-forn="AutoPeças"].cot-sit-sem_robo').count() == 1 and "portal reconhecido" in pg.inner_text("#cot-origem"), pg.inner_text("#cot-origem"))
  pg.screenshot(path=os.path.join(TMP, "compras_conexoes_" + nome + ".png"))
  # 6b. etapa 2: consulta AO VIVO pela função "compras" (de mentira): portal reconhecido pelo endereço, Testar conexão, botão por peça, preço "Ao vivo"
  pg.goto(U + "#/ajustes?aba=consultas"); pg.wait_for_timeout(1000)
  pg.click("#cp-conectar"); pg.wait_for_timeout(300); pg.select_option("#cp-cx-forn", "f2"); pg.click("button:has-text('Portal (site)')"); pg.fill("#cp-cx-end", "https://www.dpk.com.br/#/"); pg.wait_for_timeout(200)
  chk(T("Ajustes: robô reconhecido pelo endereço ao digitar"), "Robô reconhecido: DPK" in pg.inner_text("#cp-cx-robo"), pg.inner_text("[role=dialog]")[:300])
  pg.fill("#cp-cx-end", "https://compreonline.sama.com.br/"); pg.wait_for_timeout(150)
  chk(T("Ajustes: Compre Online de outra loja (Sama) também reconhecido, igual ao servidor"), "Robô reconhecido: Compre Online" in pg.inner_text("#cp-cx-robo"), pg.inner_text("#cp-cx-robo"))
  pg.fill("#cp-cx-end", "https://www.dpk.com.br/#/"); pg.wait_for_timeout(150)
  pg.fill("#cp-cx-usu", "danilo@dtcar.com"); pg.fill("#cp-cx-senha", "S3nh@dpk"); pg.click("#cp-cx-salvar"); pg.wait_for_timeout(600)
  dpk = pg.locator('.cp-conexao[data-robo="dpk"]')
  chk(T("conexão DPK: robô, consulta pelo servidor e botão Testar conexão; AutoPeças sem robô e sem o botão"), dpk.count() == 1 and "Robô: DPK" in dpk.inner_text() and "pelo servidor" in dpk.inner_text() and dpk.locator(".cp-testar").count() == 1
      and pg.locator('.cp-conexao[data-robo=""] .cp-testar').count() == 0 and "não reconhecido" in pg.locator('.cp-conexao[data-robo=""]').inner_text() and "S3nh@dpk" not in pg.content(), pg.inner_text("#cp-conexoes")[:500])
  dpk.locator(".cp-testar").click(); pg.wait_for_timeout(800)
  chk(T("Testar conexão: a função faz o login de teste e a situação vira Conectado"), "Conectou e buscou: 1 preço" in pg.inner_text('.cp-conexao[data-robo="dpk"]') and "Conectado" in pg.inner_text('.cp-conexao[data-robo="dpk"]') and pg.evaluate("window.__AOVIVO[window.__AOVIVO.length - 1].acao") == "testar" and pg.evaluate("window.__DB.compras_precos.filter(p => p.origem === 'ao_vivo').length") == 0, pg.inner_text('.cp-conexao[data-robo="dpk"]'))
  pg.screenshot(path=os.path.join(TMP, "compras_conexoes_robo_" + nome + ".png"))
  pg.goto(U + "#/compras"); pg.wait_for_timeout(800)
  chk(T("Compras: DPK conectada (fichinha verde) e aviso de consulta ao vivo"), pg.locator('#cot-situacoes .cot-sit[data-forn="DPK DISTRIBUIDORA"].cot-sit-ok').count() == 1 and "ao vivo" in pg.inner_text("#cot-origem") and "DPK DISTRIBUIDORA" in pg.inner_text("#cot-origem"), pg.inner_text("#cot-origem"))
  pg.fill("#cot-placa", ""); pg.fill("#cot-txt", "WK84213"); pg.wait_for_timeout(200); pg.click("#cot-consultar"); pg.wait_for_timeout(1200)
  chk(T("consulta de verdade pela função (de mentira): preço Ao vivo da DPK gravado em compras_precos"), pg.locator('.cot-card[data-forn="DPK DISTRIBUIDORA"]').count() == 1 and "63,24" in pg.inner_text(".cot-resultado") and pg.evaluate("window.__DB.compras_precos.filter(p => p.origem === 'ao_vivo').length") == 1, pg.inner_text(".cot-resultado")[:300])
  # 7. banco sem o v59: aviso, não quebra
  pg2 = pg.context.new_page(); pg2.on("pageerror", lambda e: erros.append(nome + ": " + str(e)))
  pg2.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg2.add_init_script("window.__SEM_V59 = true;")
  pg2.goto(U + "#/painel"); pg2.wait_for_timeout(1000); pg2.goto(U + "#/compras"); pg2.wait_for_timeout(1200)
  chk(T("sem o v59: aviso para rodar o SQL"), "v59.sql" in pg2.inner_text("#cp-erro"), pg2.inner_text("main")[:300])
  pg2.goto(U + "#/ajustes?aba=consultas"); pg2.wait_for_timeout(1000)
  chk(T("sem o v59: Ajustes abre e o cartão só avisa"), "v59.sql" in pg2.inner_text("#cp-conexoes"))
  pg2.click(".aj-botoes button:has-text('Oficina')"); pg2.wait_for_timeout(400)
  chk(T("Ajustes em abas: a aba Oficina tem os dados"), pg2.locator("#a-nome").count() == 1)
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
