# Teste do supabase/v25.sql (fila do WhatsApp, mensagens, regras contra bloqueio) num Postgres local
# com papéis ao estilo Supabase. Precisa do esquema da oficina, do v22–v24; roda o v25 e desfaz no fim.
# Rodar: PGHOST=... PGPORT=... PGUSER=postgres python3 teste/teste_v25.py <banco>
import subprocess, sys, os, json
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANCO = sys.argv[1] if len(sys.argv) > 1 else "f1"
ok, falhas = [], []
def confere(n, c, x=""): (ok if c else falhas).append(n + (f" ({x})" if x else ""))
def sql(comando, papel=None):
    pre = f"set role {papel};" if papel else ""
    r = subprocess.run(["psql", "-d", BANCO, "-At", "-v", "ON_ERROR_STOP=1", "-c", pre + comando], capture_output=True, text=True)
    return "\n".join(l for l in r.stdout.splitlines() if l != "SET").strip(), r.stderr.strip()
def js(comando, papel="authenticated"):
    s, e = sql(comando, papel)
    try: return json.loads(s), e
    except Exception: return s, e
q = lambda v: "'" + json.dumps(v).replace("'", "''") + "'::jsonb"

for f in ("v24.sql", "v25.sql"):
    subprocess.run(["psql", "-d", BANCO, "-q", "-v", "ON_ERROR_STOP=1", "-f", os.path.join(RAIZ, "supabase", f)], check=True, capture_output=True)
SEMPRE = {"inicio": "00:00", "fim": "23:59", "sabado_fim": "23:59", "dias": [1, 2, 3, 4, 5, 6, 7], "intervalo_min": 25, "intervalo_max": 70, "por_hora": 20, "por_dia": 80}
sql("set session_replication_role = replica; update perfis set papel = 'admin', ativo = true where id = auth.uid()")
sql("delete from whatsapp_fila; delete from whatsapp_mensagens; delete from whatsapp_optout; delete from whatsapp_sessao")
sql(f"update whatsapp_conexao set situacao = 'conectado', regras = {q(SEMPRE)}, proximo_envio = null, dono = 'android', dono_id = 'm1', dono_ate = now() + interval '90 seconds'")
cli, _ = sql("select id || '|' || nome || '|' || telefone from clientes where telefone ~ '^27\\d{9}$' order by nome limit 1")
CID, CNOME, CTEL = cli.split("|")
os_num, _ = sql(f"select coalesce((select numero from ordens where cliente_id = '{CID}' order by numero desc limit 1), 0)")

# --- pôr na fila ---
r, e = js(f"select whatsapp_enfileirar({q({'telefone': CTEL, 'texto': 'Olá! Seu carro está pronto.'})}, false)")
confere("prévia confere e não grava", r.get("gravado") is False and not r["erros"] and r["cliente"]["nome"] == CNOME and r["telefone"] == "55" + CTEL, e or r)
r, e = js(f"select whatsapp_enfileirar({q({'telefone': CTEL, 'texto': 'Olá! Seu carro está pronto.', 'pedido': 'avisar pronto'})}, true)")
confere("grava na fila", r.get("gravado") is True and r["id"] > 0, e or r)
FID = r.get("id")
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': CTEL, 'texto': 'Olá! Seu carro está pronto.'})}, true)")
confere("mesma mensagem em 10 min é recusada", r.get("gravado") is False and any("10 minutos" in x for x in r["erros"]), r)
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': '21 90000-1234', 'texto': 'oi'})}, true)")
confere("telefone que não é de cliente é recusado", any("cliente cadastrado" in x for x in r["erros"]), r)
r, _ = js(f"select whatsapp_enfileirar({q({'cliente_id': CID, 'texto': 'Veja: https://bit.ly/abc'})}, true)")
confere("link encurtado é recusado", any("encurtado" in x for x in r["erros"]), r)
r, _ = js(f"select whatsapp_enfileirar({q({'cliente_id': CID, 'texto': 'Pelo cadastro do cliente'})}, false)")
confere("pelo cliente_id usa o telefone do cadastro", r["telefone"] == "55" + CTEL and not r["erros"], r)
r, _ = js(f"select whatsapp_enfileirar({q({'cliente_id': CID, 'telefone': '27 98888-7777', 'texto': 'x'})}, false)")
confere("telefone de outro com cliente_id é recusado", any("não é do cliente" in x or "cliente cadastrado" in x for x in r["erros"]), r)
if os_num != "0":
    r, _ = js(f"select whatsapp_enfileirar({q({'ordem_numero': int(os_num), 'texto': 'Sobre a O.S.'})}, false)")
    confere("pela O.S. usa o cliente da O.S.", r["cliente"]["id"] == CID and r["ordem_numero"] == int(os_num), r)
_, e = sql(f"select whatsapp_enfileirar({q({'telefone': CTEL, 'texto': 'x'})}, true)", "anon")
confere("anon não põe na fila", "permission denied" in e, e)
sql("set session_replication_role = replica; update perfis set papel = 'mecanico' where id = auth.uid()")
_, e = sql(f"select whatsapp_enfileirar({q({'telefone': CTEL, 'texto': 'x'})}, true)", "authenticated")
confere("não administrador não põe na fila", "administrador" in e, e)
_, e = sql("select count(*) from whatsapp_fila", "authenticated")
confere("não administrador não lê a fila", e == "" and _ == "0" or "0" in _, _)
sql("set session_replication_role = replica; update perfis set papel = 'admin' where id = auth.uid()")

# --- envio: pegar, intervalo, resultado ---
r, _ = js("select whatsapp_pegar_proxima('android', 'outro')", "service_role")
confere("sem a vez não pega", r.get("motivo") == "sem a vez", r)
r, e = js("select whatsapp_pegar_proxima('android', 'm1')", "service_role")
confere("com a vez pega a primeira da fila", r.get("mensagem", {}).get("id") == FID, e or r)
s, _ = sql(f"select status from whatsapp_fila where id = {FID}")
confere("fica 'enviando'", s == "enviando")
_, e = sql(f"select whatsapp_resultado('android', 'm1', {FID}, true, 'MSG1', '55{CTEL}@s.whatsapp.net', null)", "service_role")
s, _ = sql(f"select status || '|' || (enviada_em is not null) || '|' || (select count(*) from whatsapp_mensagens where msg_id = 'MSG1' and de_mim) || '|' || (select proximo_envio > now() + interval '20 seconds' from whatsapp_conexao) from whatsapp_fila where id = {FID}")
confere("resultado: enviada, vai para a conversa e marca o intervalo", s == "enviada|true|1|true", e or s)
js(f"select whatsapp_enfileirar({q({'cliente_id': CID, 'texto': 'Segunda mensagem'})}, true)")
r, _ = js("select whatsapp_pegar_proxima('android', 'm1')", "service_role")
confere("intervalo entre envios respeitado", r.get("motivo") == "intervalo", r)
sql("update whatsapp_conexao set proximo_envio = null")
H = dict(SEMPRE, dias=[]); sql(f"update whatsapp_conexao set regras = {q(H)}")
r, _ = js("select whatsapp_pegar_proxima('android', 'm1')", "service_role")
confere("fora do horário não envia", r.get("motivo") == "fora do horário", r)
r, _ = js(f"select whatsapp_enfileirar({q({'cliente_id': CID, 'texto': 'Urgente', 'fora_horario': True})}, true)")
confere("fora do horário: aviso na prévia/gravação sem fora_horario", True)
r, _ = js("select whatsapp_pegar_proxima('android', 'm1')", "service_role")
confere("fora do horário: só sai a liberada pelo Danilo", r.get("mensagem", {}).get("texto") == "Urgente", r)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)}")
FID2, _ = sql("select id from whatsapp_fila where texto = 'Urgente'")
sql(f"select whatsapp_resultado('android', 'm1', {FID2}, false, null, null, 'número sem WhatsApp')", "service_role")
s, _ = sql(f"select status || '|' || erro from whatsapp_fila where id = {FID2}")
confere("erro no envio fica registrado", s == "erro|número sem WhatsApp", s)
sql("update whatsapp_conexao set proximo_envio = null; update whatsapp_fila set status = 'enviando', pego_em = now() - interval '6 minutes', pego_por = 'android' where texto = 'Segunda mensagem'")
r, _ = js("select whatsapp_pegar_proxima('android', 'm1')", "service_role")
s, _ = sql("select status from whatsapp_fila where texto = 'Segunda mensagem'")
confere("'enviando' esquecida vira erro (não reenvia sozinha)", s == "erro", s)
sql("update whatsapp_conexao set regras = jsonb_set(regras, '{por_hora}', '1')")
js(f"select whatsapp_enfileirar({q({'cliente_id': CID, 'texto': 'Terceira'})}, true)")
r, _ = js("select whatsapp_pegar_proxima('android', 'm1')", "service_role")
confere("limite por hora", r.get("motivo") == "limite por hora", r)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)}")

# --- motor (chave do motor) ---
chave, _ = sql("select whatsapp_motor_nova_chave()", "authenticated")
r, e = js(f"select whatsapp_motor_proxima('{chave}', 'm1')", "anon")
confere("motor pega a próxima com a chave", r.get("mensagem", {}).get("texto") == "Terceira", e or r)
_, e = sql(f"select whatsapp_motor_proxima('dtm_{'0' * 64}', 'm1')", "anon")
confere("motor com chave errada: recusado", "inválida" in e, e)
_, e = sql("select whatsapp_pegar_proxima('android', 'm1')", "anon")
confere("anon não chama a interna", "permission denied" in e, e)

# --- recebidas, PARAR ---
msgs = [{"msg_id": "R1", "jid": f"55{CTEL}@s.whatsapp.net", "telefone": "55" + CTEL, "nome": "Cliente", "texto": "Obrigado! Passo aí às 17h"},
        {"msg_id": "R1", "jid": f"55{CTEL}@s.whatsapp.net", "telefone": "55" + CTEL, "texto": "repetida"},
        {"msg_id": "R2", "jid": "5527900000000@s.whatsapp.net", "telefone": "5527900000000", "nome": "Outro", "texto": "Parar."}]
n, e = sql(f"select whatsapp_motor_mensagens('{chave}', 'm1', {q(msgs)})", "anon")
confere("guarda recebidas sem repetir", n == "2", e or n)
s, _ = sql("select count(*) from whatsapp_optout where telefone = whatsapp_chave_tel('5527900000000')")
confere("'Parar.' registra a recusa", s == "1", s)
sql("insert into clientes (id, nome, telefone) values ('00000000-0000-0000-0000-00000000f001', 'Cliente que parou', '27900000000')")
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': '27 90000-0000', 'texto': 'Promoção'})}, true)")
confere("quem pediu PARAR não recebe", any("PARAR" in x for x in r["erros"]), r)
sql("delete from clientes where id = '00000000-0000-0000-0000-00000000f001'")

# --- leitura (Claude/tela) ---
r, e = js("select whatsapp_conversas(10, false)")
c1 = next((c for c in r if c["telefone"].endswith(CTEL[-8:])), None) if isinstance(r, list) else None
confere("conversas: cliente cadastrado, última mensagem e não lidas", c1 and c1["cliente"] == CNOME and c1["nao_lidas"] == 1 and "17h" in c1["ultima_mensagem"], e or r)
r, e = js(f"select whatsapp_mensagens_de('{CTEL}', 30, true)")
confere("mensagens de um número em ordem, com a enviada e a recebida", isinstance(r, dict) and [m["de"] for m in r["mensagens"]][-2:] == ["oficina", "Cliente"], e or r)
r, _ = js("select whatsapp_conversas(10, true)")
confere("depois de ler, some das não lidas", not any(c["telefone"].endswith(CTEL[-8:]) for c in r), r)
r, e = js("select whatsapp_resumo()")
confere("resumo: fila, motor e horário", isinstance(r, dict) and "fila" in r and r["envio_agora"].startswith("pelo motor") and r["no_horario_de_envio"] is True, e or r)
_, e = sql("select whatsapp_resumo()", "anon")
confere("anon não lê o resumo", "permission denied" in e, e)

# --- cancelar ---
js(f"select whatsapp_enfileirar({q({'cliente_id': CID, 'texto': 'Para cancelar'})}, true)")
FC, _ = sql("select id from whatsapp_fila where texto = 'Para cancelar'")
r, e = js(f"select whatsapp_cancelar({FC})")
confere("cancela pendente", isinstance(r, dict) and r["status"] == "cancelada", e or r)
_, e = sql(f"select whatsapp_cancelar({FID})", "authenticated")
confere("não cancela a que já saiu", "pendente" in e, e)

sql("delete from whatsapp_fila; delete from whatsapp_mensagens; delete from whatsapp_optout; update whatsapp_conexao set dono='', dono_id=null, dono_ate=null, motor_hash=null, motor_chave_em=null, proximo_envio=null")
print("\n".join("OK " + x for x in ok)); print("FALHAS", falhas)
if falhas: raise SystemExit(1)
