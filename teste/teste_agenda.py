# Agenda da oficina (v54, etapa 1) com dados simulados (teste/mock.js): agendar (cadastro e sem cadastro), agenda livre,
# confirmar, remarcar, cancelar com motivo, "Chegou: abrir O.S." (liga a O.S.), "Fazer orçamento" (liga o orçamento),
# mecânico só consulta, aviso sem o v54, celular (até 640px) e PC independentes.
# Uso: python3 teste/teste_agenda.py   (precisa de: pip install playwright && playwright install chromium)
import subprocess, time, sys, os, datetime
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SAIDA = os.path.join(RAIZ, "teste", "telas"); os.makedirs(SAIDA, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8767", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok = []; falhas = []; erros = []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
U = "http://localhost:8767/"
HOJE = datetime.date.today().isoformat()
AG = "window.__DB.agendamentos || []"
try:
  with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    pg.on("pageerror", lambda e: erros.append("PAGEERR " + str(e)))
    pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    pg.goto(U + "#/agenda"); pg.wait_for_timeout(2000)
    t = pg.inner_text("main")
    chk("semana: segunda a sábado, com hoje marcado", all(d in t for d in ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"]) and "Hoje" in t, t[:400])
    chk("PC: 6 colunas lado a lado", pg.evaluate("getComputedStyle(document.querySelector('.ag-dias')).gridTemplateColumns.split(' ').length") == 6)
    chk("menu lateral: item Agenda", pg.locator(".lateral button:has-text('Agenda')").count() == 1)
    chk("menu lateral cabe sem rolar", pg.evaluate("(() => { const l = document.querySelector('.lateral'); return l.scrollHeight <= l.clientHeight + 1; })()"))

    # 1. agendar cliente do cadastro, com horário
    pg.click(".painel-topo button:has-text('+ Agendar')"); pg.wait_for_timeout(400)
    pg.fill("#ag-cli", "Cliente Teste"); pg.wait_for_timeout(300); pg.click(".busca-cli .linha:has-text('Cliente Teste')"); pg.wait_for_timeout(300)
    pg.select_option("#ag-vei", "v1"); pg.fill("#ag-hora", "08:00"); pg.fill("#ag-serv", "Revisão dos 40 mil")
    pg.click(".modal .btn-pri:has-text('Agendar')"); pg.wait_for_timeout(600)
    a = pg.evaluate(AG)
    chk("agendado: gravado com cliente, veículo e horário", len(a) == 1 and a[0]["cliente_id"] == "c1" and a[0]["veiculo_id"] == "v1" and a[0]["veiculo"]["placa"] == "ABC1D23" and a[0]["hora"] == "08:00:00" and a[0]["data"] == HOJE, a)
    t = pg.inner_text(".ag-dia.ag-hoje")
    chk("aparece no dia de hoje com horário e situação escrita", "08:00" in t and "Cliente Teste" in t and "Revisão dos 40 mil" in t and "Agendado" in t, t)

    # 2. sem cadastro, mesmo horário (agenda livre); placa do cadastro puxa o veículo e o dono
    pg.click(".painel-topo button:has-text('+ Agendar')"); pg.wait_for_timeout(400)
    pg.click(".modal .seg button:has-text('Sem cadastro')"); pg.fill("#ag-nome", "Maria por telefone"); pg.fill("#ag-tel", "27988887777")
    pg.fill("#ag-modelo", "Gol 1.0"); pg.fill("#ag-hora", "08:00"); pg.fill("#ag-serv", "Troca de óleo")
    pg.click(".modal .btn-pri:has-text('Agendar')"); pg.wait_for_timeout(600)
    a = pg.evaluate(AG)
    chk("agenda livre: dois no mesmo horário", len(a) == 2 and a[1]["cliente"]["nome"] == "Maria por telefone" and not a[1]["cliente_id"] and a[1]["veiculo"]["modelo"] == "Gol 1.0", a)
    pg.click(".painel-topo button:has-text('+ Agendar')"); pg.wait_for_timeout(400)
    pg.click(".modal .seg button:has-text('Sem cadastro')"); pg.fill("#ag-placa", "QXN1E49"); pg.wait_for_timeout(300)
    chk("placa do cadastro puxa o dono e o veículo", "Ministério" in pg.inner_text(".modal") or "Cliente Teste" in pg.inner_text(".modal"), pg.inner_text(".modal")[:300])
    # trocar de cliente tira o carro do cliente anterior
    pg.click(".modal .fechar"); pg.wait_for_timeout(300)
    pg.click(".painel-topo button:has-text('+ Agendar')"); pg.wait_for_timeout(400)
    pg.fill("#ag-cli", "Cliente Teste"); pg.wait_for_timeout(300); pg.click(".busca-cli .linha:has-text('Cliente Teste')"); pg.wait_for_timeout(300)
    pg.select_option("#ag-vei", "v1"); pg.wait_for_timeout(200)
    pg.click(".modal .achado button:has-text('Trocar')"); pg.wait_for_timeout(200)
    chk("tirar o cliente limpa o veículo dele", pg.input_value("#ag-placa") == "" and pg.input_value("#ag-modelo") == "")
    pg.fill("#ag-cli", "Cliente Teste"); pg.wait_for_timeout(300); pg.click(".busca-cli .linha:has-text('Cliente Teste')"); pg.wait_for_timeout(300)
    chk("cliente com mais de um carro: nenhum carro escolhido sozinho", pg.input_value("#ag-placa") == "" and pg.input_value("#ag-modelo") == "")
    pg.click(".modal .fechar"); pg.wait_for_timeout(300)
    pg.click(".painel-topo button:has-text('+ Agendar')"); pg.wait_for_timeout(400)
    pg.click(".modal .btn-pri:has-text('Agendar')"); pg.wait_for_timeout(300)
    chk("sem cliente e serviço não grava", "Informe o cliente" in pg.inner_text(".modal") and len(pg.evaluate(AG)) == 2)
    pg.click(".modal .fechar"); pg.wait_for_timeout(300)

    # 3. confirmar, remarcar (volta para agendado e conta), cancelar com motivo
    pg.click(".ag-item:has-text('Cliente Teste')"); pg.wait_for_timeout(400)
    pg.click(".modal button:has-text('Cliente confirmou')"); pg.wait_for_timeout(500)
    chk("confirmado", pg.evaluate(AG)[0]["situacao"] == "confirmado" and "Confirmado" in pg.inner_text(".ag-item:has-text('Cliente Teste')"))
    pg.click(".ag-item:has-text('Cliente Teste')"); pg.wait_for_timeout(400)
    pg.fill("#ag-hora", "14:30"); pg.wait_for_timeout(200)
    chk("aviso de remarcação antes de salvar", "conta como remarcação" in pg.inner_text(".modal"))
    pg.click(".modal .btn-pri:has-text('Salvar')"); pg.wait_for_timeout(500)
    a = pg.evaluate(AG)[0]
    chk("remarcado: conta, guarda o anterior e volta para agendado", a["remarcacoes"] == 1 and a["hora_anterior"] == "08:00:00" and a["situacao"] == "agendado", a)
    t = pg.inner_text(".ag-item:has-text('Cliente Teste')")
    chk("lista mostra 'Remarcado 1 vez' e a nova hora", "Remarcado 1 vez" in t and "14:30" in t, t)
    chk("ordem do dia por horário", pg.evaluate("[...document.querySelectorAll('.ag-dia.ag-hoje .ag-item .ag-hora')].map(e => e.innerText)") == ["08:00", "14:30"])
    pg.click(".ag-item:has-text('Maria')"); pg.wait_for_timeout(400)
    pg.click(".modal button:has-text('Cancelar agendamento')"); pg.wait_for_timeout(300)
    pg.click(".modal .chip-f:has-text('Cliente desmarcou')"); pg.click(".modal .modal .btn-pri:has-text('Cancelar agendamento')"); pg.wait_for_timeout(500)
    a = pg.evaluate(AG)[1]
    chk("cancelado com motivo", a["situacao"] == "cancelado" and a["motivo"] == "Cliente desmarcou", a)
    chk("cancelado some da semana", pg.locator(".ag-item:has-text('Maria')").count() == 0)
    pg.check(".ag-canc input"); pg.wait_for_timeout(200)
    chk("'Mostrar cancelados' traz de volta, riscado e com a situação escrita", pg.locator(".ag-item.s-cancelado:has-text('Maria')").count() == 1 and "Cancelado" in pg.inner_text(".ag-item:has-text('Maria')"))
    chk("PC: cartões do dia com largura de leitura (sem texto quebrado letra a letra)", pg.evaluate("Math.min(...[...document.querySelectorAll('.ag-item .ag-meio')].map(e => e.getBoundingClientRect().width))") > 120)
    pg.screenshot(path=SAIDA + "/agenda-pc.png")

    # 4. busca
    pg.fill(".ag-busca", "abc1d"); pg.wait_for_timeout(700)
    chk("busca por placa", "Resultado da busca" in pg.inner_text("main") and "Cliente Teste" in pg.inner_text("section.card:has-text('Resultado da busca')"))
    pg.fill(".ag-busca", ""); pg.wait_for_timeout(400)

    # 5. Fazer orçamento: abre o orçamento novo preenchido e liga ao agendamento
    pg.click(".ag-item:has-text('Cliente Teste')"); pg.wait_for_timeout(400)
    pg.click(".modal button:has-text('Fazer orçamento')"); pg.wait_for_timeout(1000)
    chk("orçamento novo preenchido com o serviço", "#/orcamento/novo" in pg.url and pg.input_value("#orc-pedido") == "Revisão dos 40 mil", pg.url)
    pg.click(".orc-acoes .btn-pri:has-text('Salvar orçamento')"); pg.wait_for_timeout(900)
    a = pg.evaluate(AG)[0]; orc = pg.evaluate("window.__DB.orcamentos[0]")
    chk("orçamento ligado ao agendamento", a["orcamento_id"] == orc["id"] and a["orc_numero"] == orc["numero"] and orc["cliente_id"] == "c1" and a["situacao"] == "agendado", [a, orc])

    # 6. Chegou: abrir O.S. — Nova O.S. preenchida; ao abrir, o agendamento fica "Chegou" com o número
    pg.goto(U + "#/agenda"); pg.wait_for_timeout(1200)
    chk("lista mostra o orçamento ligado", "ORC-0000" in pg.inner_text(".ag-item:has-text('Cliente Teste')"))
    pg.click(".ag-item:has-text('Cliente Teste')"); pg.wait_for_timeout(400)
    pg.click(".modal button:has-text('Chegou: abrir O.S.')"); pg.wait_for_timeout(1200)
    chk("Nova O.S. preenchida pela agenda", "#/entrada" in pg.url and "Veio da agenda" in pg.inner_text("main") and pg.input_value("#recl") == "Revisão dos 40 mil" and pg.input_value("#placa") in ("ABC1D23", "ABC-1D23"), pg.inner_text("main")[:300])
    pg.fill("#km", "1500"); pg.click("button.btn-pri:has-text('Abrir O.S.')"); pg.wait_for_timeout(600)
    if pg.locator(".modal button:has-text('Abrir outra')").count(): pg.click(".modal button:has-text('Abrir outra')")  # o carro do teste já tem O.S. aberta
    pg.wait_for_timeout(1500)
    a = pg.evaluate(AG)[0]
    chk("agendamento virou 'Chegou' com a O.S.", a["situacao"] == "chegou" and a["os_numero"] == 1899 and a["ordem_id"] == "n1899", a)
    chk("O.S. aberta com o serviço combinado", pg.evaluate("window.__DB.ordens.find(o => o.id === 'n1899').reclamacao") == "Revisão dos 40 mil")
    pg.goto(U + "#/agenda"); pg.wait_for_timeout(1200)
    t = pg.inner_text(".ag-item:has-text('Cliente Teste')")
    chk("lista mostra 'Chegou' e o número da O.S.", "Chegou" in t and "OS 01899" in t, t)
    pg.click(".ag-item:has-text('Cliente Teste')"); pg.wait_for_timeout(400)
    chk("chegou: só consulta, com link da O.S.", pg.locator(".modal .btn-pri:has-text('Salvar')").count() == 0 and "OS 01899" in pg.inner_text(".modal"))
    pg.click(".modal .fechar")

    # 7. outra semana e domingo só quando tem agendamento
    pg.click(".ag-semana button[aria-label='Próxima semana']"); pg.wait_for_timeout(700)
    chk("próxima semana sem 'Hoje'", "Hoje" not in pg.inner_text(".ag-dias") and pg.locator(".ag-semana button:has-text('Esta semana')").is_enabled())
    dom = pg.evaluate("(() => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7) + 7); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })()")
    pg.evaluate("window.__DB.agendamentos.push({ id: 'agdom', data: '%s', hora: null, situacao: 'agendado', cliente: { nome: 'Plantão' }, veiculo: {}, servico: 'Socorro', remarcacoes: 0, mensagens: {} })" % dom)
    pg.click(".ag-semana button[aria-label='Semana anterior']"); pg.wait_for_timeout(500); pg.click(".ag-semana button[aria-label='Próxima semana']"); pg.wait_for_timeout(700)
    chk("domingo aparece quando tem agendamento (7 colunas)", "Domingo" in pg.inner_text(".ag-dias") and pg.evaluate("getComputedStyle(document.querySelector('.ag-dias')).gridTemplateColumns.split(' ').length") == 7)

    # 7b. O.S. aberta sem internet a partir da agenda: liga assim que a O.S. tem número, em qualquer tela (sem abrir a agenda)
    off = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    off.on("pageerror", lambda e: erros.append("PAGEERR off " + str(e)))
    off.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    off.add_init_script("window.__DB.agendamentos = [{ id: 'agoff', data: '%s', hora: null, situacao: 'agendado', cliente: { nome: 'Sem rede' }, veiculo: {}, servico: 'Embreagem', remarcacoes: 0, mensagens: {} }]; localStorage.setItem('dtcar-agenda-vinculos', JSON.stringify([{ agendaId: 'agoff', ordemId: 'o2' }, { agendaId: 'agx', ordemId: 'ainda-PROV' }]))" % HOJE)
    off.goto(U + "#/ordens"); off.wait_for_timeout(2500)
    a = off.evaluate("window.__DB.agendamentos.find(x => x.id === 'agoff')")
    chk("O.S. aberta sem internet: ligada ao agendamento fora da tela da agenda", a["situacao"] == "chegou" and a["os_numero"] == 1898, a)
    chk("ligação de O.S. ainda sem número continua guardada", off.evaluate("JSON.parse(localStorage.getItem('dtcar-agenda-vinculos')).map(x => x.agendaId)") == ["agx"])
    # 8. sem o v54: avisa e esconde o botão
    pg.evaluate("window.__SEM_V54 = true"); pg.goto(U + "#/painel"); pg.wait_for_timeout(300); pg.goto(U + "#/agenda"); pg.wait_for_timeout(900)
    chk("sem o v54: aviso e sem '+ Agendar'", "supabase/v54.sql" in pg.inner_text("main") and pg.locator("button:has-text('+ Agendar')").count() == 0)

    # 9. mecânico: vê a agenda, não grava
    mec = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    mec.on("pageerror", lambda e: erros.append("PAGEERR mec " + str(e)))
    mec.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    mec.add_init_script("window.__DB.perfis.reverse(); window.__DB.agendamentos = [{ id: 'ag1', data: '%s', hora: '09:00:00', situacao: 'agendado', cliente: { nome: 'Fulano' }, veiculo: { placa: 'ABC1D23' }, servico: 'Freio', remarcacoes: 0, mensagens: {} }]" % HOJE)
    mec.goto(U + "#/agenda"); mec.wait_for_timeout(2000)
    chk("mecânico vê a agenda", "Fulano" in mec.inner_text("main") and mec.locator("button:has-text('+ Agendar')").count() == 0)
    mec.click(".ag-item:has-text('Fulano')"); mec.wait_for_timeout(400)
    chk("mecânico: sem botões de gravar", mec.locator(".modal button:has-text('Chegou')").count() == 0 and mec.locator(".modal .btn-pri").count() == 0 and mec.is_disabled("#ag-serv"))

    # 10. celular: um dia embaixo do outro, sem rolagem para o lado; item no menu "Mais"
    cel = b.new_context(viewport={"width": 393, "height": 852}).new_page()
    cel.on("pageerror", lambda e: erros.append("PAGEERR cel " + str(e)))
    cel.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    cel.add_init_script("window.__DB.agendamentos = [{ id: 'ag1', data: '%s', hora: '09:00:00', situacao: 'confirmado', cliente: { nome: 'Fulano de Tal com nome comprido' }, veiculo: { placa: 'ABC1D23', modelo: 'Uno' }, servico: 'Troca das pastilhas de freio dianteiras e revisão do sistema', remarcacoes: 0, mensagens: {} }]" % HOJE)
    cel.goto(U + "#/agenda"); cel.wait_for_timeout(2000)
    chk("celular: uma coluna", cel.evaluate("getComputedStyle(document.querySelector('.ag-dias')).gridTemplateColumns.split(' ').length") == 1)
    chk("celular: sem rolagem para o lado", cel.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    cel.screenshot(path=SAIDA + "/agenda-celular.png", full_page=True)
    cel.click(".ag-item:has-text('Fulano')"); cel.wait_for_timeout(400)
    chk("celular: botões do dia em largura total", cel.evaluate("(() => { const b = document.querySelector('.ag-acoes-dia .btn'), c = document.querySelector('.ag-acoes-dia'); return Math.abs(b.getBoundingClientRect().width - c.getBoundingClientRect().width) < 2; })()"))
    cel.screenshot(path=SAIDA + "/agenda-celular-modal.png")
    cel.click(".modal .fechar"); cel.goto(U + "#/mais"); cel.wait_for_timeout(800)
    chk("celular: Agenda no menu Mais", cel.locator(".linha:has-text('Agenda')").count() == 1)
    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("erros de página:", erros or "nenhum")
sys.exit(1 if falhas or erros else 0)
