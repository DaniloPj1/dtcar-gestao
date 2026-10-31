# Teste com a camada real do Supabase contra um servidor falso local (sem tocar no banco de produção):
# servidor responde, depois "pendura" sem responder; confere tempo-limite, modo sem rede e O.S. guardadas.
# Uso: python3 teste/teste_rede.py
# Teste com a camada REAL do Supabase (sem mock): servidor falso que responde, depois "cai" sem responder
# (como DNS/rota pendurada no Windows). Mede se as telas param de esperar e se a O.S. guardada abre.
import subprocess, sys, time, json, base64
from playwright.sync_api import sync_playwright
import os
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8766", "-d", RAIZ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1); ok, falhas, log = [], [], []
def chk(n, c): (ok if c else falhas).append(n)
b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")
exp = int(time.time()) + 3600
jwt = b64({"alg": "HS256", "typ": "JWT"}) + "." + b64({"sub": "u1", "exp": exp, "role": "authenticated", "aud": "authenticated"}) + ".x"
sessao = {"access_token": jwt, "token_type": "bearer", "expires_in": 3600, "expires_at": exp, "refresh_token": "r", "user": {"id": "u1", "email": "d@x", "aud": "authenticated", "role": "authenticated"}}
PERFIL = {"id": "u1", "nome": "Danilo", "email": "d@x", "papel": "admin", "ativo": True}
ORDENS = [{"id": "o1", "numero": 1900, "status": "execucao", "cliente": {"nome": "Cliente A", "telefone": ""}, "veiculo": {"placa": "ABC1D23", "marca": "Fiat", "modelo": "Uno"}, "cliente_id": None, "veiculo_id": None, "total": 100, "recebido": 0, "criado_em": "2026-10-30T10:00:00Z", "atualizado_em": "2026-10-30T10:00:00Z", "checkin": {}},
          {"id": "o2", "numero": 1899, "status": "entregue", "cliente": {"nome": "Cliente B", "telefone": ""}, "veiculo": {"placa": "XYZ9A88", "marca": "VW", "modelo": "Gol"}, "cliente_id": None, "veiculo_id": None, "total": 300, "recebido": 0, "criado_em": "2026-10-29T10:00:00Z", "atualizado_em": "2026-10-29T10:00:00Z", "entregue_em": "2026-10-30T10:00:00Z", "checkin": {}}]
estado = {"modo": "ok"}
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
def resposta(u, accept):
    obj = "vnd.pgrst.object" in (accept or "")
    if "/rest/v1/perfis" in u: body = PERFIL if obj else [PERFIL]
    elif "/rest/v1/config" in u: body = {"dados": {}} if obj else []
    elif "/rest/v1/ordens" in u:
        if obj: body = next((o for o in ORDENS if "id=eq." + o["id"] in u), ORDENS[0])
        else: body = ORDENS
    elif "/rest/v1/rpc/" in u: body = {}
    elif "/auth/v1/health" in u: body = {"ok": True}
    else: body = {} if obj else []
    return body
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*"); self.send_header("Access-Control-Allow-Headers", "*"); self.send_header("Access-Control-Allow-Methods", "*")
    def do_OPTIONS(self): self.send_response(204); self.cors(); self.end_headers()
    def responder(self):
        if estado["modo"] == "pendura": log.append("pendurado " + self.path[:50]); time.sleep(90); return
        body = json.dumps(resposta(self.path, self.headers.get("accept"))).encode()
        self.send_response(200); self.cors(); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
    do_GET = responder; do_POST = responder; do_HEAD = responder
fake = ThreadingHTTPServer(("127.0.0.1", 9998), H); fake.daemon_threads = True
threading.Thread(target=fake.serve_forever, daemon=True).start()
try:
  with sync_playwright() as p:
    b = p.chromium.launch(); ctx = b.new_context(viewport={"width": 1400, "height": 900}); pg = ctx.new_page()
    pg.on("pageerror", lambda e: log.append("PAGEERR " + str(e)))
    cfg = open(os.path.join(RAIZ, "js", "config.js")).read().replace("https://vbbklawlbxznsemkgtvg.supabase.co", "http://127.0.0.1:9998")
    ctx.route("**/js/config.js", lambda r: r.fulfill(status=200, content_type="text/javascript", body=cfg))
    ctx.add_init_script("if (!sessionStorage.getItem('semente')) { localStorage.setItem('sb-127-auth-token', %s); sessionStorage.setItem('semente', '1'); }" % json.dumps(json.dumps(sessao)))
    U = "http://localhost:8766/"
    pg.goto(U + "#/ordens"); pg.wait_for_timeout(9000)  # carrega e guarda as O.S. em aberto (inclui aguardando pagamento)
    chk("online: lista carregou", "01900" in pg.inner_text("main"))
    chk("guardou O.S. em execução e a entregue a receber", pg.evaluate("""(async () => { const db = await new Promise(r => { const q = indexedDB.open('dtcar-local'); q.onsuccess = () => r(q.result); });
      const ler = k => new Promise(r => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => r(t.result); });
      return !!(await ler('os:o1')) && !!(await ler('os:o2')); })()"""))
    bk = pg.evaluate("import('./js/telas/backup.js').then(m => m.montarBackup({ perfil: { nome: 'teste' }, tolerante: true })).then(b => ({ n: Object.keys(b.tabelas).length, sistema: b.sistema, ordens: b.tabelas.ordens.length }))")
    chk("backup completo monta todas as tabelas (%s)" % bk, bk["sistema"] == "dtcar-gestao" and bk["n"] >= 20 and bk["ordens"] == 2)
    # cai: o servidor para de responder (sem erro imediato)
    estado["modo"] = "pendura"
    t0 = time.time(); pg.evaluate("location.hash = '#/painel'"); pg.wait_for_timeout(300)
    pg.evaluate("window.__r = null; import('./js/api.js').then(m => m.api.contas.abertas()).then(() => window.__r = 'ok', e => window.__r = 'erro: ' + e.message)")
    for i in range(40):
        if pg.evaluate("window.__r"): break
        pg.wait_for_timeout(500)
    dt = time.time() - t0
    chk("servidor pendurado: falha em até ~16 s (antes: sem fim) [%.1fs]" % dt, pg.evaluate("window.__r") is not None and dt < 18)
    # o sistema percebe e entra no modo sem internet (próxima carga falha) e daí tudo é imediato
    pg.evaluate("import('./js/api.js').then(m => m.definirSemRede(true))")
    t0 = time.time(); pg.evaluate("location.hash = '#/os/o2'"); pg.wait_for_timeout(1500)
    chk("sem rede: O.S. guardada (aguardando pagamento) abre na hora", "Cliente B" in pg.inner_text("main") or "XYZ9A88" in pg.inner_text("main"))
    pg.evaluate("location.hash = '#/caixa'"); pg.wait_for_timeout(800)
    print("caixa:", pg.inner_text("main")[:200].replace("\n", " | "))
    pg.screenshot(path=os.path.join(RAIZ, "teste", "telas", "r1-os-offline.png"))
    # dia seguinte sem internet: login vencido e servidor sem resposta → abre direto com o login guardado (sem tela de login)
    venc = dict(sessao); venc["expires_at"] = int(time.time()) - 600
    pg.evaluate("localStorage.setItem('sb-127-auth-token', %s)" % json.dumps(json.dumps(venc)))
    ctx.clear_cookies(); pg2 = ctx.new_page(); t0 = time.time()
    pg2.add_init_script("localStorage.setItem('sb-127-auth-token', %s)" % json.dumps(json.dumps(venc)))
    pg2.goto(U + "#/ordens"); 
    abriu = False
    for i in range(40):
        tx = pg2.inner_text("body")
        if "01900" in tx: abriu = True; break
        pg2.wait_for_timeout(500)
    dt = time.time() - t0
    chk("login vencido + sem servidor: abre com o login guardado em %.1fs" % dt, abriu and "ENTRAR" not in pg2.inner_text("body") and dt < 14)
    b.close()
except Exception as e:
    falhas.append("EXCECAO " + str(e).split("\n")[0])
finally: srv.terminate()
print("OK", len(ok), ok); print("FALHAS", falhas); print("\n".join(log[-8:]))
