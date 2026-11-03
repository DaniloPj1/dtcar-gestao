# Teste da tela de autorização do conector do Claude (consentimento.html), com o Supabase simulado.
# Rodar: python3 teste/teste_consentimento.py
import http.server, json, os, threading, functools
from playwright.sync_api import sync_playwright

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
import time
class Servidor(http.server.SimpleHTTPRequestHandler):
    # /auth/v1/oauth/authorizations/*: manda os cabeçalhos e só o começo do JSON, e pendura (corpo nunca termina)
    def do_GET(self):
        if self.path.startswith("/auth/v1/oauth/authorizations/"):
            self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", "500"); self.end_headers()
            self.wfile.write(b'{"authorization_id": "AU'); self.wfile.flush(); time.sleep(40); return
        return super().do_GET()
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Servidor, directory=RAIZ))
srv.RequestHandlerClass.log_message = lambda *a: None
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = f"http://127.0.0.1:{srv.server_port}/consentimento.html"
ok, falhas = [], []
def confere(nome, cond, extra=""): (ok if cond else falhas).append(nome + (f" ({extra})" if extra else ""))

USUARIO = {"id": "00000000-0000-0000-0000-000000000001", "email": "danilo@dtcar.test", "aud": "authenticated", "role": "authenticated"}
SESSAO = {"access_token": "tok", "refresh_token": "ref", "token_type": "bearer", "expires_in": 3600, "expires_at": 9999999999, "user": USUARIO}

def cenario(pw, *, pendurar=None, papel="admin", ja_autorizado=False, retorno="https://claude.ai/api/mcp/auth_callback", logado=False, auth_id="AUTH1", vencida=False):
    b = pw.chromium.launch(); ctx = b.new_context(); pg = ctx.new_page()
    estado = {"consent": None, "senha": None}
    def supa(route):
        req = route.request; u = req.url
        cors = {"access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*"}
        if req.method == "OPTIONS": return route.fulfill(status=204, headers=cors)
        if "/auth/v1/token" in u:
            estado["senha"] = json.loads(req.post_data or "{}").get("password")
            if estado["senha"] != "certa": return route.fulfill(status=400, headers=cors, json={"error": "invalid_grant", "error_description": "Invalid login credentials", "msg": "Invalid login credentials"})
            return route.fulfill(status=200, headers=cors, json=SESSAO)
        if pendurar and pendurar in u: return  # nunca responde (servidor "pendurado")
        if u.endswith("/consent"):
            estado["consent"] = json.loads(req.post_data or "{}").get("action")
            return route.fulfill(status=200, headers=cors, json={"redirect_url": retorno + "?code=COD&state=EST" if estado["consent"] == "approve" else retorno + "?error=access_denied"})
        if "/oauth/authorizations/" in u:
            if vencida and estado["senha"] is None:  # login guardado, mas o servidor não reconhece mais a sessão
                return route.fulfill(status=403, headers=cors, json={"code": 403, "error_code": "session_not_found", "msg": "Session from session_id claim in JWT does not exist"})
            if ja_autorizado: return route.fulfill(status=200, headers=cors, json={"redirect_url": retorno + "?code=JA"})
            return route.fulfill(status=200, headers=cors, json={"authorization_id": auth_id, "redirect_uri": retorno, "scope": "email",
                                                                  "client": {"id": "c1", "name": "Claude", "uri": "", "logo_uri": ""}, "user": {"id": USUARIO["id"], "email": USUARIO["email"]}})
        if "/rest/v1/perfis" in u:
            return route.fulfill(status=200, headers={**cors, "content-type": "application/json"}, body=json.dumps({"papel": papel, "ativo": True}))
        if "/auth/v1/user" in u: return route.fulfill(status=200, headers=cors, json=USUARIO)
        return route.fulfill(status=404, headers=cors, body="{}")
    pg.route("https://vbbklawlbxznsemkgtvg.supabase.co/**", supa)
    pg.route("https://claude.ai/**", lambda r: r.fulfill(status=200, body="<p>voltou ao Claude</p>", headers={"content-type": "text/html"}))
    pg.route("https://outro.exemplo/**", lambda r: r.fulfill(status=200, body="<p>outro</p>", headers={"content-type": "text/html"}))
    if logado:
        pg.goto(BASE)  # mesma origem: grava a sessão como o app guardaria
        pg.evaluate("s => localStorage.setItem('sb-vbbklawlbxznsemkgtvg-auth-token', JSON.stringify(s))", SESSAO)
    pg.goto(BASE + (f"?authorization_id={auth_id}" if auth_id else ""))
    return b, pg, estado

with sync_playwright() as pw:
    b, pg, _ = cenario(pw, auth_id=None)
    pg.wait_for_selector("#final:not([hidden])")
    confere("sem authorization_id: aviso", "falta o código" in pg.inner_text("#final"))
    b.close()

    b, pg, est = cenario(pw)
    pg.wait_for_selector("#entrar:not([hidden])")
    confere("sem login: pede e-mail e senha", True)
    pg.fill("#email", "danilo@dtcar.test"); pg.fill("#senha", "errada"); pg.click("#entrar button")
    pg.wait_for_function("document.getElementById('erroEntrar').textContent.length > 0")
    confere("senha errada: mensagem", "incorretos" in pg.inner_text("#erroEntrar"), pg.inner_text("#erroEntrar"))
    pg.fill("#senha", "certa"); pg.click("#entrar button")
    pg.wait_for_selector("#pedido:not([hidden])")
    confere("depois do login mostra o pedido", "Claude" in pg.inner_text("#cliente") and "danilo@dtcar.test" in pg.inner_text("#usuario"))
    confere("retorno claude.ai sem aviso", pg.inner_text("#destino") == "claude.ai" and pg.is_hidden("#avisoDestino"))
    confere("administrador sem aviso de papel", pg.is_hidden("#avisoPapel"))
    pg.click("#autorizar"); pg.wait_for_url("https://claude.ai/**")
    confere("autorizar: aprova e volta ao Claude com o código", est["consent"] == "approve" and "code=COD" in pg.url, pg.url)
    b.close()

    b, pg, est = cenario(pw, logado=True, papel="mecanico", retorno="https://outro.exemplo/cb")
    pg.wait_for_selector("#pedido:not([hidden])")
    confere("já logado: vai direto ao pedido", True)
    confere("retorno estranho: aviso", pg.is_visible("#avisoDestino"))
    confere("não administrador: aviso", pg.is_visible("#avisoPapel"))
    pg.click("#recusar"); pg.wait_for_url("https://outro.exemplo/**")
    confere("recusar: nega e volta com access_denied", est["consent"] == "deny" and "access_denied" in pg.url, pg.url)
    b.close()

    b, pg, est = cenario(pw, logado=True, vencida=True)
    pg.wait_for_selector("#entrar:not([hidden])")
    confere("login guardado vencido: pede para entrar de novo", "vencido" in pg.inner_text("#erroEntrar"), pg.inner_text("#erroEntrar"))
    pg.fill("#email", "danilo@dtcar.test"); pg.fill("#senha", "certa"); pg.click("#entrar button")
    pg.wait_for_selector("#pedido:not([hidden])")
    confere("login vencido: depois de entrar mostra o pedido", "Claude" in pg.inner_text("#cliente"))
    b.close()

    b, pg, est = cenario(pw, logado=True, ja_autorizado=True)
    pg.wait_for_url("https://claude.ai/**")
    confere("já autorizado antes: volta direto", "code=JA" in pg.url and est["consent"] is None)
    b.close()

    b, pg, est = cenario(pw, logado=True, pendurar="/oauth/authorizations/AUTH1")
    pg.wait_for_selector("#final:not([hidden])", timeout=25000)
    confere("servidor pendurado na leitura: aviso e Tentar de novo", "não respondeu a tempo" in pg.inner_text("#final") and pg.is_visible("#deNovo"), pg.inner_text("#final"))
    b.close()

    b, pg, est = cenario(pw, logado=True, pendurar="/consent")
    pg.wait_for_selector("#pedido:not([hidden])"); pg.click("#autorizar")
    pg.wait_for_function("document.getElementById('erroPedido').textContent.length > 0", timeout=25000)
    confere("servidor pendurado na aprovação: erro e botões liberados", "a tempo" in pg.inner_text("#erroPedido") and pg.is_enabled("#autorizar"), pg.inner_text("#erroPedido"))
    b.close()

    # corpo da resposta pendurado: o "Supabase" é o próprio servidor de teste (cabeçalhos chegam, o JSON não termina)
    b = pw.chromium.launch(); pg = b.new_page()
    local = f"http://127.0.0.1:{srv.server_port}"
    pg.route("**/js/config.js", lambda r: r.fulfill(status=200, headers={"content-type": "text/javascript"},
             body='window.DTCAR_CONFIG = { SUPABASE_URL: "' + local + '", SUPABASE_ANON_KEY: "sb_publishable_teste" };'))
    pg.goto(BASE)
    chave = pg.evaluate("u => window.supabase.createClient(u, 'x').auth.storageKey", local)
    pg.evaluate("([k, s]) => localStorage.setItem(k, JSON.stringify(s))", [chave, SESSAO])
    inicio = time.time(); pg.goto(BASE + "?authorization_id=AUTH1")
    pg.wait_for_selector("#final:not([hidden])", timeout=30000)
    confere("corpo da resposta pendurado: para no tempo-limite e oferece Tentar de novo", pg.is_visible("#deNovo") and time.time() - inicio < 25, f"{time.time() - inicio:.0f} s")
    b.close()

print("\n".join("OK " + x for x in ok)); print("FALHAS", falhas)
srv.shutdown()
if falhas: raise SystemExit(1)
