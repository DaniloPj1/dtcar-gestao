#!/usr/bin/env python3
"""Sino de avisos do app do celular no sistema (pedido do Danilo, 16/11/2026): novo pedido de orçamento pelo app e itens a orçar
numa O.S. aparecem no sino (PC e celular), abrem o orçamento/a O.S. e ficam marcados como vistos neste aparelho. Supabase de mentira.
Rodar: python3 teste/teste_avisos_app.py"""
import subprocess, time, sys, os
from playwright.sync_api import sync_playwright
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ok, falhas = [], []
def chk(n, c, extra=''): (ok if c else falhas).append(n if c or not extra else n + ' :: ' + str(extra))
SEMENTE = """
window.addEventListener('DOMContentLoaded', () => {});
(function () { const db = window.__DB; if (!db) return;
  db.orcamentos = db.orcamentos || [];
  db.orcamentos.push({ id: 'orc-app-1', numero: 41, situacao: 'elaboracao', cliente: { nome: 'JOÃO DA SILVA' }, veiculo: { placa: 'ABC1D23', marca: 'Volkswagen', modelo: 'GOL 1.0' }, reclamacao: 'Pastilhas e discos dianteiros', obs_internas: 'Pedido pelo app — Carlos Mecânico, 16/11/2026 15:30', consultor_nome: 'Carlos Mecânico', criado_em: '2026-11-16T18:30:00Z', atualizado_em: '2026-11-16T18:30:00Z', itens: [], total: 0 });
  db.orcamentos.push({ id: 'orc-sis-1', numero: 42, situacao: 'elaboracao', cliente: { nome: 'OUTRO' }, veiculo: { placa: 'QQQ1Q11' }, reclamacao: 'feito no sistema', obs_internas: '', consultor_nome: 'Danilo', criado_em: '2026-11-16T18:30:00Z', atualizado_em: '2026-11-16T18:30:00Z', itens: [], total: 0 });
  db.eventos = db.eventos || []; db.eventos.push({ id: 'ev-a1', ordem_id: 'o1', tipo: 'a_orcar', texto: 'Orçar também o terminal', usuario_nome: 'Carlos Mecânico', criado_em: '2026-11-16T18:40:00Z' });
})();
"""
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8769", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL); time.sleep(1)
erros = []
def abrir(b, larg, papel="admin"):
    ctx = b.new_context(viewport={"width": larg, "height": 800 if larg < 700 else 768}, is_mobile=larg < 700, has_touch=larg < 700)
    pg = ctx.new_page(); pg.on("pageerror", lambda e: erros.append(str(e)))
    pg.add_init_script("window.__PAPEL = '%s';" % papel); pg.add_init_script(path=os.path.join(RAIZ, "teste", "mock.js")); pg.add_init_script(SEMENTE)
    pg.goto("http://localhost:8769/#/painel"); pg.wait_for_timeout(1500); return ctx, pg
try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        # PC: sino na barra de cima com 2 avisos (pedido pelo app e itens a orçar); o orçamento feito no sistema não conta
        ctx, pg = abrir(b, 1366)
        chk("PC: sino visível na barra de cima", pg.locator(".barra-topo .sino-btn").is_visible() and not pg.locator(".sino-cel").is_visible())
        chk("PC: 2 avisos novos (pedido pelo app + itens a orçar), sem o orçamento feito no sistema", pg.locator(".barra-topo .sino-n").inner_text() == "2", pg.locator(".barra-topo .sino-n").all_inner_texts())
        pg.click(".barra-topo .sino-btn"); pg.wait_for_selector(".sino-lista"); tx = pg.inner_text(".sino-lista")
        chk("lista mostra o pedido com número, placa, quem e o texto", "Novo pedido de orçamento ORC-00041" in tx and "ABC1D23" in tx and "Carlos Mecânico" in tx and "Pastilhas e discos" in tx and "ORC-00042" not in tx, tx)
        chk("lista mostra os itens a orçar na O.S.", "Itens a orçar na OS 01890" in tx and "terminal" in tx, tx)
        pg.click(".sino-item:has-text('ORC-00041')"); pg.wait_for_timeout(800)
        chk("clicar abre o orçamento e tira 1 do sino", "#/orcamento/orc-app-1" in pg.url and pg.locator(".barra-topo .sino-n").inner_text() == "1", pg.url)
        pg.wait_for_selector("#orc-pedido"); chk("a tela do orçamento mostra o pedido escrito no app e a marca 'Pedido pelo app'", pg.input_value("#orc-pedido") == "Pastilhas e discos dianteiros" and pg.locator(".pill-app").count() == 1)
        pg.click(".barra-topo .sino-btn"); pg.wait_for_selector(".sino-lista"); pg.click(".sino-item:has-text('OS 01890')"); pg.wait_for_timeout(800)
        chk("clicar no aviso da O.S. abre a O.S. e zera o sino", "#/os/o1" in pg.url and pg.locator(".barra-topo .sino-n").count() == 0, pg.url)
        pg.reload(); pg.wait_for_timeout(1500); chk("vistos ficam guardados no aparelho (recarregar não traz de volta)", pg.locator(".barra-topo .sino-n").count() == 0)
        pg.wait_for_selector(".barra-topo .sino-btn"); pg.wait_for_timeout(300); pg.click(".barra-topo .sino-btn")
        pg.wait_for_selector(".sino-lista"); chk("a lista continua mostrando os avisos já vistos (sem destaque)", pg.locator(".sino-item").count() == 2 and pg.locator(".sino-item.novo").count() == 0)
        pg.keyboard.press("Escape"); pg.mouse.click(600, 400); pg.wait_for_timeout(200)
        # salvar o orçamento no sistema muda atualizado_em, mas NÃO é aviso novo; um acréscimo pelo app ("— Nome, data: ...") é
        pg.add_init_script("(function(){const o=(window.__DB||{orcamentos:[]}).orcamentos.find(o => o.id === 'orc-app-1'); if (o) o.atualizado_em = '2026-11-16T19:00:00Z';})()"); pg.reload(); pg.wait_for_selector(".barra-topo .sino-btn"); pg.wait_for_timeout(1200)
        chk("salvar o orçamento no sistema não vira aviso novo", pg.locator(".barra-topo .sino-n").count() == 0)
        pg.add_init_script("(function(){const o=(window.__DB||{orcamentos:[]}).orcamentos.find(o => o.id === 'orc-app-1'); if (o) o.reclamacao += '\\n— Carlos Mecânico, 16/11/2026 16:00: Verificar bateria';})()"); pg.reload(); pg.wait_for_selector(".barra-topo .sino-btn"); pg.wait_for_timeout(1200)
        chk("acréscimo pelo app vira aviso 'Mais itens no pedido'", pg.locator(".barra-topo .sino-n").inner_text() == "1")
        pg.click(".barra-topo .sino-btn"); pg.wait_for_selector(".sino-lista"); chk("texto do aviso de acréscimo", pg.locator(".sino-item.novo").inner_text().startswith("Mais itens no pedido ORC-00041"), pg.locator(".sino-item.novo").inner_text())
        ctx.close()
        # celular: sino no cabeçalho azul, lista cabe na tela
        ctx, pg = abrir(b, 390)
        chk("celular: sino no cabeçalho, o da barra do PC não aparece", pg.locator(".sino-cel .sino-btn").is_visible() and not pg.locator(".barra-topo").is_visible())
        chk("celular: 2 avisos", pg.locator(".sino-cel .sino-n").inner_text() == "2")
        pg.click(".sino-cel .sino-btn"); pg.wait_for_selector(".sino-lista"); box = pg.locator(".sino-lista").bounding_box()
        chk("celular: a lista cabe na largura da tela", box["x"] >= 0 and box["x"] + box["width"] <= 390, box)
        chk("celular: sem rolagem lateral", pg.evaluate("document.documentElement.scrollWidth") <= 390)
        pg.click(".sino-item:has-text('ORC-00041')"); pg.wait_for_timeout(800); chk("celular: abre o orçamento", "#/orcamento/orc-app-1" in pg.url)
        ctx.close()
        # mecânico não tem sino (não orça)
        ctx, pg = abrir(b, 1366, "mecanico"); chk("mecânico não vê o sino", pg.locator(".sino-btn").count() == 0); ctx.close()
        b.close()
    chk("sem erro de página", not erros, erros)
finally:
    srv.terminate()
print("%d ok; %d falhas" % (len(ok), len(falhas)))
for f in falhas: print("FALHA:", f)
sys.exit(1 if falhas else 0)
