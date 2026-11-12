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
    # 7c. orçamento do agendamento já aprovado (v53): "Chegou" liga à O.S. que já existe e abre ela (não abre O.S. vazia)
    ap = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    ap.on("pageerror", lambda e: erros.append("PAGEERR ap " + str(e)))
    ap.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    ap.add_init_script("""window.__DB.orcamentos = [{ id: 'orcA', numero: 5, situacao: 'aprovado', ordem_id: 'o4', os_numero: 1896, cliente: { nome: 'Cliente Teste' }, veiculo: {}, itens: [] }];
      const o4 = window.__DB.ordens.find(o => o.id === 'o4'); Object.assign(o4, { orcamento_id: 'orcA', orcamento_numero: 5, km_entrada: null, checkin: { aguardando_veiculo: true } });
      window.__DB.agendamentos = [{ id: 'agA', data: '%s', hora: '10:00:00', situacao: 'confirmado', cliente_id: 'c1', cliente: { nome: 'Cliente Teste' }, veiculo: { placa: 'ABC1D23' }, servico: 'Pastilhas', orcamento_id: 'orcA', orc_numero: 5, remarcacoes: 0, mensagens: {} },
        { id: 'agB', data: '%s', hora: '11:00:00', situacao: 'agendado', cliente_id: 'c1', cliente: { nome: 'Outro do mesmo ORC' }, veiculo: {}, servico: 'Pastilhas', orcamento_id: 'orcA', orc_numero: 5, remarcacoes: 0, mensagens: {} }];""" % (HOJE, HOJE))
    ap.goto(U + "#/agenda"); ap.wait_for_timeout(2000)
    ap.click(".ag-item:has-text('10:00')"); ap.wait_for_timeout(400)
    ap.click(".modal button:has-text('Chegou: abrir O.S.')"); ap.wait_for_timeout(1500)
    a = ap.evaluate("window.__DB.agendamentos.find(x => x.id === 'agA')")
    chk("orçamento aprovado: 'Chegou' liga à O.S. existente e abre ela", "#/os/o4" in ap.url and a["situacao"] == "chegou" and a["os_numero"] == 1896 and a["ordem_id"] == "o4" and len(ap.evaluate("window.__DB.ordens")) == 6, [ap.url, a])
    # chegada registrada direto na O.S. do orçamento: o outro agendamento desse orçamento também fica "Chegou"
    ap.click("button:has-text('Registrar chegada')"); ap.wait_for_timeout(300)
    ap.fill("#os-chegada-km", "1500"); ap.click(".modal .btn-pri:has-text('Registrar chegada')"); ap.wait_for_timeout(1200)
    b2 = ap.evaluate("window.__DB.agendamentos.find(x => x.id === 'agB')")
    chk("chegada registrada na O.S. do orçamento: agendamento fica 'Chegou'", b2["situacao"] == "chegou" and b2["os_numero"] == 1896, b2)
    # 7d. chegada na O.S. do orçamento sem conseguir falar com a agenda: fica guardada e é feita quando as O.S. recarregam
    ap.evaluate("window.__DB.agendamentos.find(x => x.id === 'agB').situacao = 'agendado'; window.__ag_off = window.__API_MOCK.agenda.chegouPeloOrcamento; window.__API_MOCK.agenda.chegouPeloOrcamento = async () => { throw new Error('Failed to fetch'); }; 0")
    ap.evaluate("(async () => { const m = await import('./js/telas/entrada.js'); m.guardarChegadaAgenda('orcA', 'o4'); })()"); ap.wait_for_timeout(200)
    chk("chegada sem internet: guardada no aparelho", ap.evaluate("JSON.parse(localStorage.getItem('dtcar-agenda-vinculos'))") == [{"orcamentoId": "orcA", "ordemId": "o4"}])
    ap.evaluate("window.__API_MOCK.agenda.chegouPeloOrcamento = window.__ag_off; (async () => { const m = await import('./js/telas/agenda.js'); await m.ligarPendentes(window.__DB.ordens); })()"); ap.wait_for_timeout(500)
    b2 = ap.evaluate("window.__DB.agendamentos.find(x => x.id === 'agB')")
    chk("internet de volta: agendamento do orçamento fica 'Chegou'", b2["situacao"] == "chegou" and ap.evaluate("localStorage.getItem('dtcar-agenda-vinculos')") == "[]", b2)
    # 7e. pendência guardada enquanto a ligação está no meio (resposta lenta): não some
    ap.evaluate("""localStorage.setItem('dtcar-agenda-vinculos', JSON.stringify([{ agendaId: 'agA', ordemId: 'o4' }]));
      window.__ag_lento = window.__API_MOCK.agenda.salvar; window.__API_MOCK.agenda.salvar = async p => { await new Promise(r => setTimeout(r, 400)); return window.__ag_lento(p); }; 0""")
    ap.evaluate("""(async () => { const ag = await import('./js/telas/agenda.js'), en = await import('./js/telas/entrada.js');
      const p = ag.ligarPendentes(window.__DB.ordens); await new Promise(r => setTimeout(r, 100)); en.guardarChegadaAgenda('orcZ', 'o3'); await p; })()""")
    ap.wait_for_timeout(300)
    chk("pendência guardada no meio da ligação continua guardada", ap.evaluate("JSON.parse(localStorage.getItem('dtcar-agenda-vinculos'))") == [{"orcamentoId": "orcZ", "ordemId": "o3"}], ap.evaluate("localStorage.getItem('dtcar-agenda-vinculos')"))
    # 7f. chegada guardada que ainda está na fila (ou em conflito) não marca a agenda; sem KM no online (descartada) é esquecida
    r = ap.evaluate("""(async () => { const ag = await import('./js/telas/agenda.js'), fi = await import('./js/fila.js');
      const b = window.__DB.agendamentos.find(x => x.id === 'agB'); b.situacao = 'agendado';
      localStorage.setItem('dtcar-agenda-vinculos', JSON.stringify([{ orcamentoId: 'orcA', ordemId: 'o4' }]));
      await fi.fila.adicionar({ id: 'alt1', tipo: 'alterar_os', ordem_id: 'o4', criado_em: new Date().toISOString(), conflito: true });
      await ag.ligarPendentes(window.__DB.ordens); const naFila = [b.situacao, localStorage.getItem('dtcar-agenda-vinculos')];
      await fi.fila.remover('alt1'); const o4 = { ...window.__DB.ordens.find(o => o.id === 'o4'), km_entrada: null };
      await ag.ligarPendentes([o4]); return [naFila, b.situacao, localStorage.getItem('dtcar-agenda-vinculos')]; })()""")
    chk("chegada ainda na fila: agenda espera", r[0][0] == "agendado" and "orcA" in r[0][1], r)
    chk("chegada descartada (sem KM no online): agenda não marca e esquece", r[1] == "agendado" and r[2] == "[]", r)
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
    # ---- etapa 2: quadro "Agenda da semana" no Início
    ini = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    ini.on("pageerror", lambda e: erros.append("PAGEERR ini " + str(e)))
    ini.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    ini.add_init_script("""window.__DB.agendamentos = [
      { id: 'i1', data: '%(h)s', hora: '08:00:00', situacao: 'confirmado', cliente_id: 'c1', cliente: { nome: 'Cliente Teste' }, veiculo: { placa: 'ABC1D23' }, servico: 'Revisão', remarcacoes: 0, mensagens: {} },
      { id: 'i2', data: '%(h)s', hora: null, situacao: 'agendado', cliente: { nome: 'Sem Hora' }, veiculo: {}, servico: 'Óleo', remarcacoes: 0, mensagens: {} },
      { id: 'i3', data: '%(h)s', hora: '09:00:00', situacao: 'cancelado', motivo: 'x', cliente: { nome: 'Cancelado Some' }, veiculo: {}, servico: 'Freio', remarcacoes: 0, mensagens: {} },
      { id: 'i4', data: '%(h)s', hora: '10:00:00', situacao: 'agendado', cliente: { nome: 'Três' }, veiculo: {}, servico: 'A', remarcacoes: 0, mensagens: {} },
      { id: 'i5', data: '%(h)s', hora: '11:00:00', situacao: 'agendado', cliente: { nome: 'Quatro' }, veiculo: {}, servico: 'B', remarcacoes: 0, mensagens: {} },
      { id: 'i6', data: '%(h)s', hora: '12:00:00', situacao: 'agendado', cliente: { nome: 'Cinco Escondido' }, veiculo: {}, servico: 'C', remarcacoes: 0, mensagens: {} }];""" % {"h": HOJE})
    ini.goto(U + "#/painel"); ini.wait_for_timeout(2500)
    chk("Início: janela 'Agenda da semana' logo depois do pátio", ini.evaluate("(() => { const j = [...document.querySelectorAll('.grade-painel .janela')].map(e => e.className.match(/j-(\\w+)/)[1]); return j.indexOf('agenda') === j.indexOf('patio') + 1; })()"), ini.evaluate("[...document.querySelectorAll('.grade-painel .janela')].map(e => e.className)"))
    t = ini.inner_text(".j-agenda")
    chk("Início: semana com hoje, horário, cliente e situação escrita", "Agenda da semana" in t and "Hoje" in t and "08:00" in t and "Cliente Teste" in t and "Confirmado" in t, t[:500])
    chk("Início: cancelado não aparece e o que passa de 4 vira '+ 1 neste dia'", "Cancelado Some" not in t and "Sem Hora" not in t and "Cinco Escondido" in t and "+ 1 neste dia" in t and "5 agendado(s)" in t, t[:500])
    chk("Início PC: 6 dias lado a lado", ini.evaluate("getComputedStyle(document.querySelector('.ags-dias')).gridTemplateColumns.split(' ').length") == 6)
    ini.screenshot(path=SAIDA + "/agenda-inicio-pc.png")
    ini.click(".ags-item:has-text('Cliente Teste')"); ini.wait_for_timeout(400)
    chk("Início: clicar abre o agendamento", "Chegou: abrir O.S." in ini.inner_text(".modal"))
    ini.click(".modal button:has-text('Faltou')"); ini.wait_for_timeout(600)
    chk("Início: mudou a situação e o quadro atualizou", "Faltou" in ini.inner_text(".ags-item:has-text('Cliente Teste')") and "4 agendado(s)" in ini.inner_text(".j-agenda"))
    ini.click(".ags-cab >> nth=0"); ini.wait_for_timeout(700)
    chk("Início: clicar no dia abre a Agenda", "#/agenda?d=" in ini.url)
    ini.evaluate("window.__SEM_V54 = true"); ini.goto(U + "#/painel"); ini.wait_for_timeout(1200)
    chk("Início: sem o v54 a janela só avisa", "supabase/v54.sql" in ini.inner_text(".j-agenda"))
    # painel já personalizado antes (sem a janela): ela entra uma vez; depois de salvo com painelV6, respeita a remoção
    cfgp = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    cfgp.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    cfgp.add_init_script("window.__DB.config = { ...window.__DB.config, painel: [{ k: 'busca', tam: 12 }, { k: 'patio', tam: 12 }, { k: 'quadro', tam: 12 }], painelV5: true }")
    cfgp.goto(U + "#/painel"); cfgp.wait_for_timeout(2200)
    chk("Início: painel personalizado ganha a janela uma vez", cfgp.locator(".j-agenda").count() == 1)
    cfgp.add_init_script("window.__DB.config.painelV6 = true"); cfgp.reload(); cfgp.wait_for_timeout(2200)
    chk("Início: removida pelo administrador (painelV6) não volta", cfgp.locator(".j-agenda").count() == 0 and cfgp.locator(".j-patio").count() == 1)
    celi = b.new_context(viewport={"width": 393, "height": 852}).new_page()
    celi.on("pageerror", lambda e: erros.append("PAGEERR celi " + str(e)))
    celi.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    celi.add_init_script("window.__DB.agendamentos = [{ id: 'i1', data: '%s', hora: '08:00:00', situacao: 'agendado', cliente: { nome: 'Fulano de Tal com nome bem comprido mesmo' }, veiculo: { placa: 'ABC1D23' }, servico: 'Troca das pastilhas dianteiras e revisão completa do sistema de freio', remarcacoes: 0, mensagens: {} }]" % HOJE)
    celi.goto(U + "#/painel"); celi.wait_for_timeout(2500)
    chk("Início celular: só hoje e dias com agendamento, em uma coluna", celi.evaluate("[...document.querySelectorAll('.ags-dia')].filter(e => getComputedStyle(e).display !== 'none').length") == 1 and celi.evaluate("getComputedStyle(document.querySelector('.ags-dias')).gridTemplateColumns.split(' ').length") == 1)
    chk("Início celular: sem rolagem para o lado", celi.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    celi.locator(".j-agenda").scroll_into_view_if_needed(); celi.screenshot(path=SAIDA + "/agenda-inicio-celular.png")
    # ---- visão do mês: calendário inteiro, dia com serviço agendado em azul
    import calendar
    d0 = datetime.date.today(); outro = d0.replace(day=20 if d0.day != 20 else 21).isoformat()
    cal = b.new_context(viewport={"width": 1366, "height": 768}).new_page()
    cal.on("pageerror", lambda e: erros.append("PAGEERR cal " + str(e)))
    cal.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    cal.add_init_script("""window.__DB.agendamentos = [
      { id: 'm1', data: '%(h)s', hora: '08:00:00', situacao: 'agendado', cliente: { nome: 'De Hoje' }, veiculo: {}, servico: 'Revisão', remarcacoes: 0, mensagens: {} },
      { id: 'm2', data: '%(o)s', hora: '09:00:00', situacao: 'confirmado', cliente: { nome: 'Do Dia Vinte' }, veiculo: {}, servico: 'Óleo', remarcacoes: 0, mensagens: {} },
      { id: 'm3', data: '%(o)s', hora: '10:00:00', situacao: 'agendado', cliente: { nome: 'Outro do Vinte' }, veiculo: {}, servico: 'Freio', remarcacoes: 0, mensagens: {} },
      { id: 'm4', data: '%(c)s', hora: '10:00:00', situacao: 'cancelado', motivo: 'x', cliente: { nome: 'Só Cancelado' }, veiculo: {}, servico: 'Freio', remarcacoes: 0, mensagens: {} }];""" % {"h": HOJE, "o": outro, "c": d0.replace(day=5 if d0.day not in (5,) else 6).isoformat()})
    cal.goto(U + "#/agenda"); cal.wait_for_timeout(2000)
    chk("abre na semana por padrão, com o seletor Semana | Mês", cal.locator(".ag-dias").count() == 1 and cal.inner_text(".ag-visao").split() == ["Semana", "Mês"])
    cal.click(".ag-visao button:has-text('Mês')"); cal.wait_for_timeout(800)
    ndias = calendar.monthrange(d0.year, d0.month)[1]
    chk("mês: calendário inteiro (todos os dias do mês)", cal.evaluate("document.querySelectorAll('.ag-cal-dia:not(.fora)').length") == ndias and cal.evaluate("document.querySelectorAll('.ag-cal-dia').length") % 7 == 0)
    azuis = cal.evaluate("[...document.querySelectorAll('.ag-cal-dia.com')].map(e => e.querySelector('b').innerText + ':' + e.querySelector('span').innerText.trim())")
    chk("mês: só os dias com serviço agendado ficam em azul, com a quantidade", sorted(azuis) == sorted([str(d0.day) + ":1 agend.", outro[8:].lstrip("0") + ":2 agend."]), azuis)
    cores = cal.evaluate("(() => { const c = getComputedStyle(document.querySelector('.ag-cal-dia.com')).backgroundColor, l = getComputedStyle(document.querySelector('.ag-cal-dia:not(.com):not(.fora)')).backgroundColor; return [c, l]; })()")
    chk("mês: azul da DTCar no dia com agenda, diferente do dia livre", cores[0] == "rgb(10, 75, 208)" and cores[0] != cores[1], cores)
    chk("mês: legenda escrita e total do mês", "Dia em azul" in cal.inner_text(".ag-mes") and "3 agendado(s)" in cal.inner_text(".ag-barra"))
    chk("mês: hoje selecionado mostra os serviços de hoje", "De Hoje" in cal.inner_text(".ag-mes .ag-lista"))
    cal.click(".ag-cal-dia:not(.fora):has(b:text-is('%s'))" % outro[8:].lstrip("0")); cal.wait_for_timeout(300)
    t = cal.inner_text(".ag-mes")
    chk("mês: clicar no dia mostra os agendamentos dele", "Do Dia Vinte" in t and "Outro do Vinte" in t and "De Hoje" not in cal.inner_text(".ag-mes .ag-lista"), t[-300:])
    cal.screenshot(path=SAIDA + "/agenda-mes-pc.png")
    cal.click(".ag-semana button[aria-label='Próximo mês']"); cal.wait_for_timeout(700)
    chk("mês: próximo mês sem dias azuis e 'Este mês' liberado", cal.locator(".ag-cal-dia.com:not(.fora)").count() == 0 and cal.locator(".ag-semana button:has-text('Este mês')").is_enabled())
    cal.reload(); cal.wait_for_timeout(2000)
    chk("mês: a escolha fica guardada no aparelho", cal.locator(".ag-cal").count() == 1)
    cal.click(".ag-visao button:has-text('Semana')"); cal.wait_for_timeout(600)
    chk("volta para a semana", cal.locator(".ag-dias").count() == 1 and cal.locator(".ag-cal").count() == 0)
    celm = b.new_context(viewport={"width": 393, "height": 852}).new_page()
    celm.on("pageerror", lambda e: erros.append("PAGEERR celm " + str(e)))
    celm.add_init_script("try { localStorage.setItem('dtcar-agenda-visao', '\"mes\"') } catch (e) {}")
    celm.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js"))
    celm.add_init_script("window.__DB.agendamentos = [{ id: 'm1', data: '%s', hora: '08:00:00', situacao: 'agendado', cliente: { nome: 'De Hoje' }, veiculo: {}, servico: 'Revisão', remarcacoes: 0, mensagens: {} }]" % HOJE)
    celm.goto(U + "#/agenda"); celm.wait_for_timeout(2200)
    chk("celular: calendário do mês cabe na tela (7 colunas, sem rolagem para o lado)", celm.evaluate("getComputedStyle(document.querySelector('.ag-cal')).gridTemplateColumns.split(' ').length") == 7 and celm.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
    celm.screenshot(path=SAIDA + "/agenda-mes-celular.png")
    b.close()
finally:
  srv.terminate()
print("OK", len(ok)); print("FALHAS", falhas); print("erros de página:", erros or "nenhum")
sys.exit(1 if falhas or erros else 0)
