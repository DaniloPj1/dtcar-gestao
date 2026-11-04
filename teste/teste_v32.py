# Teste do supabase/v32.sql (WhatsApp: status de entrega, alertas, conversa ligada ao cadastro, mídia, sem resposta)
# num Postgres local com papéis ao estilo Supabase. Precisa do esquema da oficina e do v20–v26 (com storage, cron e net
# de mentira: no teste as linhas "create extension" do v32 são ignoradas).
# Rodar: PGHOST=... PGPORT=... PGUSER=postgres python3 teste/teste_v32.py <banco>
import subprocess, sys, os, json, re
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

for f in ("v24.sql", "v25.sql", "v26.sql"):
    subprocess.run(["psql", "-d", BANCO, "-q", "-v", "ON_ERROR_STOP=1", "-f", os.path.join(RAIZ, "supabase", f)], check=True, capture_output=True)
v32 = open(os.path.join(RAIZ, "supabase", "v32.sql"), encoding="utf8").read()
v32 = re.sub(r"create extension if not exists pg_(net|cron);", "", v32)
for _ in range(2):  # pode rodar mais de uma vez
    r = subprocess.run(["psql", "-d", BANCO, "-q", "-v", "ON_ERROR_STOP=1"], input=v32, capture_output=True, text=True)
    confere("v32 roda (2 vezes)", r.returncode == 0, r.stderr[-400:])

SEMPRE = {"inicio": "00:00", "fim": "23:59", "sabado_fim": "23:59", "dias": [1, 2, 3, 4, 5, 6, 7], "intervalo_min": 25, "intervalo_max": 70, "por_hora": 20, "por_dia": 80}
sql("set session_replication_role = replica; update perfis set papel = 'admin', ativo = true where id = auth.uid()")
sql("delete from whatsapp_fila; delete from whatsapp_mensagens; delete from whatsapp_optout; delete from whatsapp_sessao")
sql(f"update whatsapp_conexao set situacao = 'conectado', regras = {q(SEMPRE)}, proximo_envio = null, dono = 'android', dono_id = 'm1', "
    "dono_ate = now() + interval '90 seconds', alertas = '{}', alerta_telefone = null, motor_hash = null, motor_visto = null")
sql("insert into whatsapp_sessao values ('creds', '{\"me\":{\"id\":\"x\"}}', now())")
cli, _ = sql("select id || '|' || nome || '|' || telefone from clientes where telefone ~ '^27\\d{9}$' order by nome limit 1")
CID, CNOME, CTEL = cli.split("|")

# ---------- status de entrega ----------
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': CTEL, 'texto': 'Seu carro está pronto.'})}, true)")
FID = r["id"]
js("select whatsapp_pegar_proxima('android', 'm1')", "service_role")
sql(f"select whatsapp_resultado('android', 'm1', {FID}, true, 'MSG1', '55{CTEL}@s.whatsapp.net', null)", "service_role")
s, _ = sql(f"select entrega from whatsapp_fila where id = {FID}")
confere("enviada pela fila nasce 'enviada'", s == "enviada", s)
s, _ = sql("select entrega from whatsapp_mensagens where msg_id = 'MSG1'")
confere("mensagem enviada nasce 'enviada'", s == "enviada", s)
n, e = sql(f"select whatsapp_guardar_entrega({q([{'msg_id': 'MSG1', 'status': 3, 'em': '2026-11-04T12:00:00Z'}])})", "service_role")
s, _ = sql(f"select entrega || '|' || (entregue_em is not null) || '|' || (lida_em is null) from whatsapp_fila where id = {FID}")
confere("tique duplo vira 'entregue' com a hora", n == "1" and s == "entregue|true|true", (n, s, e))
sql(f"select whatsapp_guardar_entrega({q([{'msg_id': 'MSG1', 'status': 2}])})", "service_role")
s, _ = sql("select entrega from whatsapp_mensagens where msg_id = 'MSG1'")
confere("confirmação atrasada não volta o status", s == "entregue", s)
sql(f"select whatsapp_guardar_entrega({q([{'msg_id': 'MSG1', 'status': 4}])})", "service_role")
s, _ = sql("select entrega || '|' || (lida_em is not null) from whatsapp_mensagens where msg_id = 'MSG1'")
confere("tique azul vira 'lida'", s == "lida|true", s)
sql(f"select whatsapp_guardar_entrega({q([{'msg_id': 'MSG1', 'status': 0}])})", "service_role")
s, _ = sql("select entrega from whatsapp_mensagens where msg_id = 'MSG1'")
confere("erro depois de lida é ignorado", s == "lida", s)
sql(f"select whatsapp_guardar_entrega({q([{'msg_id': 'NAO-EXISTE', 'status': 4}, {'msg_id': '', 'status': 3}, {'msg_id': 'MSG1', 'status': 9}])})", "service_role")
confere("status desconhecido ou mensagem que não existe não quebra", True)
_, e = sql(f"select whatsapp_guardar_entrega({q([{'msg_id': 'MSG1', 'status': 5}])})", "anon")
confere("anon não grava status direto", "permission denied" in e, e)
_, e = sql(f"select whatsapp_guardar_entrega({q([{'msg_id': 'MSG1', 'status': 5}])})", "authenticated")
confere("tela não grava status direto", "permission denied" in e, e)
# pelo motor (chave)
chave, _ = sql("select whatsapp_motor_nova_chave()", "authenticated")
_, e = sql(f"select whatsapp_motor_entrega('dtm_{'0' * 64}', 'm1', {q([{'msg_id': 'MSG1', 'status': 5}])})", "anon")
confere("motor com chave errada é recusado", "chave" in e.lower(), e)
n, e = sql(f"select whatsapp_motor_entrega('{chave}', 'm1', {q([{'msg_id': 'MSG1', 'status': 5}])})", "anon")
s, _ = sql("select entrega from whatsapp_mensagens where msg_id = 'MSG1'")
confere("motor com a chave grava 'ouvida'", s == "ouvida" and not e, (s, e))

# ---------- conversa ligada ao cadastro ----------
sql(f"insert into whatsapp_mensagens (msg_id, jid, telefone, nome, de_mim, texto, tipo, em) values "
    f"('R1', '55{CTEL}@s.whatsapp.net', '55{CTEL}', 'Cli', false, 'Obrigado!', 'texto', now() - interval '3 hours')")
r, e = js(f"select whatsapp_mensagens_de('{CTEL}', 30, false)")
oficina = [m for m in r["mensagens"] if m["de"] == "oficina"]
confere("ler mostra o status da enviada", oficina and oficina[0].get("entrega") == "ouvida", e or oficina)
recebida = [m for m in r["mensagens"] if m["de"] != "oficina"]
confere("recebida não tem status de entrega", recebida and "entrega" not in recebida[0], recebida)
confere("ler mostra o cliente cadastrado", r["cadastrado"] is True and r["cliente"]["nome"] == CNOME, r.get("cliente"))
confere("ler traz as O.S. abertas (lista)", isinstance(r["os_abertas"], list), r.get("os_abertas"))
r, e = js("select whatsapp_mensagens_de('21 90000-5555', 30, false)")
confere("número sem cadastro aparece como não cadastrado", r["cadastrado"] is False and r["cliente"] is None and r["os_abertas"] == [], e or r)
r, e = js("select whatsapp_conversas(10, false)")
c = [x for x in r if x["telefone"].endswith(CTEL)]
confere("conversas trazem cliente e cadastro", c and c[0]["cadastrado"] is True and c[0]["cliente"] == CNOME and "cliente_uuid" not in c[0], e or r)

# ---------- sem resposta ----------
sql("update whatsapp_mensagens set em = now() - interval '4 hours' where msg_id = 'MSG1'")
r, e = js("select whatsapp_resumo()")
confere("resumo lista conversa sem resposta há mais de 2 h", any(x["telefone"].endswith(CTEL) for x in r["sem_resposta"]), e or r.get("sem_resposta"))
sql(f"insert into whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, tipo, em) values ('R2', '55{CTEL}@s.whatsapp.net', '55{CTEL}', true, 'De nada', 'texto', now())")
r, _ = js("select whatsapp_resumo()")
confere("respondida sai da lista", not any(x["telefone"].endswith(CTEL) for x in r["sem_resposta"]), r.get("sem_resposta"))

# ---------- mídia ----------
sql(f"insert into whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, tipo, em) values "
    f"('A1', '55{CTEL}@s.whatsapp.net', '55{CTEL}', false, '[audio]', 'audio', now()), ('F1', '55{CTEL}@s.whatsapp.net', '55{CTEL}', false, '[imagem] painel', 'imagem', now())")
s, e = sql(f"select whatsapp_guardar_midia({q({'msg_id': 'A1', 'transcricao': ' o carro está fazendo barulho na roda ', 'duracao_s': 72, 'mime': 'audio/ogg'})})", "service_role")
t, _ = sql("select texto || '|' || (midia_path is null) from whatsapp_mensagens where msg_id = 'A1'")
confere("áudio transcrito vira o texto, sem guardar arquivo", s == "t" and t == "[áudio 1:12] o carro está fazendo barulho na roda|true", (s, t, e))
sql(f"select whatsapp_guardar_midia({q({'msg_id': 'F1', 'path': '2026/11/F1.jpg', 'mime': 'image/jpeg'})})", "service_role")
t, _ = sql("select midia_path || '|' || (midia_expira > now() + interval '29 days') || '|' || texto from whatsapp_mensagens where msg_id = 'F1'")
confere("foto guardada por 30 dias, texto mantido", t == "2026/11/F1.jpg|true|[imagem] painel", t)
s, _ = sql(f"select whatsapp_guardar_midia({q({'msg_id': 'NAO', 'path': 'x'})})", "service_role")
confere("mídia de mensagem que não existe devolve false", s == "f", s)
sql(f"select whatsapp_guardar_midia({q({'msg_id': 'A1', 'erro': 'Sem a chave do Groq.'})})", "service_role")
r, _ = js(f"select whatsapp_mensagens_de('{CTEL}', 30, false)")
a1 = [m for m in r["mensagens"] if m.get("tipo") == "audio"]
confere("falha da mídia aparece na leitura", a1 and a1[0].get("midia_nao_processada") == "Sem a chave do Groq.", a1)
sql("update whatsapp_mensagens set midia_expira = now() - interval '1 day' where msg_id = 'F1'")
s, _ = sql("select whatsapp_midia_vencida(10)", "service_role")
confere("foto vencida é listada para apagar", "2026/11/F1.jpg" in s, s)
s, _ = sql("select whatsapp_midia_apagada(array['2026/11/F1.jpg'])", "service_role")
t, _ = sql("select midia_path is null from whatsapp_mensagens where msg_id = 'F1'")
confere("depois de apagar, a foto sai do registro", s == "1" and t == "t", (s, t))
_, e = sql(f"select whatsapp_guardar_midia({q({'msg_id': 'F1', 'path': 'x'})})", "anon")
confere("anon não grava mídia", "permission denied" in e, e)
s, _ = sql("select count(*) from storage.buckets where id = 'whatsapp-midia' and not public")
confere("pasta das fotos é privada", s == "1", s)

# ---------- alertas ----------
_, e = sql("select whatsapp_alerta_config('123')", "authenticated")
confere("telefone de alerta inválido é recusado", "inválido" in e, e)
r, e = js("select whatsapp_alerta_config('27 99769-6545')")
confere("administrador define o telefone de alerta", r.get("alerta_telefone") == "5527997696545", e or r)
_, e = sql("select whatsapp_alerta_config('27999999999')", "anon")
confere("anon não define o telefone de alerta", "permission denied" in e, e)
_, e = sql("select whatsapp_vigiar()", "authenticated")
confere("tela não chama a vigia", "permission denied" in e, e)
sql("delete from whatsapp_fila")
# tudo bem: sem alerta
r, e = js("select whatsapp_vigiar()", "service_role")
confere("tudo funcionando: sem alerta", r["alertas"] == {}, e or r)
# motor sem sinal há 20 min
sql("update whatsapp_conexao set motor_visto = now() - interval '20 minutes', dono = '', dono_ate = null")
r, e = js("select whatsapp_vigiar()", "service_role")
confere("motor sem sinal vira alerta", "motor" in r["alertas"] and "sem sinal" in r["alertas"]["motor"]["texto"], e or r)
s, _ = sql("select count(*) || '|' || max(origem) || '|' || max(telefone) || '|' || bool_and(not fora_horario) from whatsapp_fila where status = 'pendente'")
confere("aviso vai para a fila do número de alerta, no horário", s == "1|sistema|5527997696545|true", s)
confere("com mensagem para sair e sem o motor, acorda a zap", r["acordar"] is True and r["motivo"] == "fila", r)
r, _ = js("select whatsapp_vigiar()", "service_role")
s, _ = sql("select count(*) from whatsapp_fila")
confere("alerta repetido não manda outro aviso", s == "1", s)
# motor volta antes do aviso sair: cancela
sql("update whatsapp_conexao set motor_visto = now()")
r, _ = js("select whatsapp_vigiar()", "service_role")
s, _ = sql("select status from whatsapp_fila order by id")
confere("motor voltou antes do aviso: aviso cancelado, sem 'voltou'", r["alertas"] == {} and s == "cancelada", (r, s))
# cai de novo, aviso sai, depois volta: manda "voltou"
sql("update whatsapp_conexao set motor_visto = now() - interval '20 minutes'")
js("select whatsapp_vigiar()", "service_role")
sql("update whatsapp_fila set status = 'enviada', enviada_em = now() where status = 'pendente'")
sql("update whatsapp_conexao set motor_visto = now()")
js("select whatsapp_vigiar()", "service_role")
s, _ = sql("select texto from whatsapp_fila where status = 'pendente'")
confere("motor voltou depois do aviso: manda 'voltou'", "voltou" in s, s)
sql("delete from whatsapp_fila")
# motor com a vez: não acorda a zap
sql("update whatsapp_conexao set dono = 'android', dono_ate = now() + interval '60 seconds', ultimo_teste = null")
r, _ = js("select whatsapp_vigiar()", "service_role")
confere("com o motor na vez, não acorda a zap", r["acordar"] is False, r)
# sem o motor, no horário, ninguém buscou recebidas há 15 min: acorda para buscar
sql("update whatsapp_conexao set dono = '', dono_ate = null")
r, _ = js("select whatsapp_vigiar()", "service_role")
confere("sem o motor, no horário, acorda para buscar recebidas", r["acordar"] is True and r["motivo"] == "buscar recebidas", r)
sql(f"update whatsapp_conexao set ultimo_teste = {q({'em': '2099-01-01T00:00:00Z'})}")
r, _ = js("select whatsapp_vigiar()", "service_role")
confere("buscou há pouco: não acorda", r["acordar"] is False, r)
# fila parada há mais de 30 min
sql(f"insert into whatsapp_fila (telefone, texto, origem, criado_em) values ('55{CTEL}', 'parada', 'claude', now() - interval '40 minutes')")
r, _ = js("select whatsapp_vigiar()", "service_role")
confere("fila parada vira alerta", "fila" in r["alertas"], r)
sql("delete from whatsapp_fila")
# desvinculado
sql("delete from whatsapp_sessao; update whatsapp_conexao set situacao = 'desligado'")
r, _ = js("select whatsapp_vigiar()", "service_role")
confere("celular desvinculado vira alerta (sem acordar a zap)", "desvinculado" in r["alertas"] and r["acordar"] is False and "motor" not in r["alertas"], r)
r, _ = js("select whatsapp_resumo()")
confere("resumo mostra os alertas", any(a["tipo"] == "desvinculado" for a in r["alertas"]) and r["alerta_telefone"] == "5527997696545", r.get("alertas"))
s, e = sql("select alertas::text, alerta_telefone from whatsapp_conexao", "authenticated")
confere("tela lê os alertas", "desvinculado" in s and not e, e or s)
s, _ = sql("select count(*) from cron.job where jobname in ('dtcar-zap-vigia', 'dtcar-zap-limpar-midia')")
confere("agendamentos criados uma vez só", s == "2", s)

# volta o banco ao estado de antes (para os outros testes)
sql("delete from whatsapp_fila; delete from whatsapp_mensagens; update whatsapp_conexao set alertas = '{}', alerta_telefone = null")
for n in ok: print("OK", n)
for n in falhas: print("FALHOU", n)
print("FALHAS", falhas)
sys.exit(1 if falhas else 0)
