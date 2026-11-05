# Teste do supabase/v34.sql (WhatsApp etapa 4: PDF na fila) num Postgres local, SEM o banco da oficina:
# monta o esquema mínimo (teste/v34_esquema.sql), roda v22–v26, v32 e o v34 (duas vezes) e confere.
# Rodar: PGHOST=... PGPORT=... PGUSER=postgres python3 teste/teste_v34.py
import subprocess, os, json, re, uuid
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANCO = "dtcar_teste_v34"
ADM, CONS = "00000000-0000-0000-0000-00000000000a", "00000000-0000-0000-0000-00000000000b"
ok, falhas = [], []
def confere(n, c, x=""): (ok if c else falhas).append(n + (f" ({x})" if x else ""))
def roda(arq, texto=None, banco=BANCO):
    if texto is None: texto = open(os.path.join(RAIZ, arq), encoding="utf8").read()
    texto = re.sub(r"create extension if not exists pg_(net|cron);", "", texto)
    return subprocess.run(["psql", "-d", banco, "-q", "-v", "ON_ERROR_STOP=1"], input=texto, capture_output=True, text=True)
def sql(comando, papel=None, uid=ADM):
    pre = f"set teste.uid = '{uid}';" + (f"set role {papel};" if papel else "")
    r = subprocess.run(["psql", "-d", BANCO, "-At", "-v", "ON_ERROR_STOP=1", "-c", pre + comando], capture_output=True, text=True)
    return "\n".join(l for l in r.stdout.splitlines() if l not in ("SET",)).strip(), r.stderr.strip()
def js(comando, papel="authenticated", uid=ADM):
    s, e = sql(comando, papel, uid)
    try: return json.loads(s), e
    except Exception: return s, e
q = lambda v: "'" + json.dumps(v).replace("'", "''") + "'::jsonb"

subprocess.run(["psql", "-q", "-c", f"drop database if exists {BANCO}", "-c", f"create database {BANCO}"], check=True, capture_output=True)
r = roda("teste/v34_esquema.sql"); confere("esquema mínimo", r.returncode == 0, r.stderr[-300:])
for f in ("v22", "v23", "v24", "v25", "v26", "v32"):
    r = roda(f"supabase/{f}.sql"); confere(f"{f} roda", r.returncode == 0, r.stderr[-300:])
for i in range(2):
    r = roda("supabase/v34.sql"); confere(f"v34 roda (vez {i + 1})", r.returncode == 0, r.stderr[-400:])

SEMPRE = {"inicio": "00:00", "fim": "23:59", "sabado_fim": "23:59", "dias": [1, 2, 3, 4, 5, 6, 7], "intervalo_min": 25, "intervalo_max": 70, "por_hora": 20, "por_dia": 80}
sql(f"update whatsapp_conexao set situacao = 'conectado', regras = {q(SEMPRE)}, proximo_envio = null, dono = 'android', dono_id = 'm1', dono_ate = now() + interval '90 seconds'")
CHAVE, _ = sql("select whatsapp_motor_nova_chave()", "authenticated")
confere("chave do motor gerada", CHAVE.startswith("dtm_"), CHAVE)

def arquivo(nome="Orcamento_01887_ABC1D23.pdf", path=None, bytes_=180000):
    return {"path": path or f"2026/11/{uuid.uuid4()}.pdf", "nome": nome, "tipo": "application/pdf", "bytes": bytes_, "origem": "O.S. 1887 (orçamento)"}
def na_pasta(a): sql(f"insert into storage.objects (bucket_id, name) values ('whatsapp-envio', '{a['path']}')")

# ---------- pasta ----------
b, _ = sql("select public::text || '|' || file_size_limit || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'whatsapp-envio'")
confere("pasta whatsapp-envio privada, 5 MB, só PDF", b == "false|5242880|application/pdf", b)

# ---------- prévia e gravação com PDF ----------
A1 = arquivo()
r, e = js(f"select whatsapp_enfileirar({q({'ordem_numero': 1887, 'texto': 'Segue o orçamento.', 'arquivo': A1, 'modelo': 'orcamento'})}, false)")
confere("prévia com PDF: sem erro, mostra o arquivo e o modelo", isinstance(r, dict) and r.get("erros") == [] and r["arquivo"]["nome"] == A1["nome"] and r["modelo"] == "orcamento", (r, e))
confere("prévia usa o cliente da O.S.", isinstance(r, dict) and r["telefone"] == "5527999990002" and r["cliente"]["nome"] == "João da Silva", r)
r, _ = js(f"select whatsapp_enfileirar({q({'ordem_numero': 1887, 'texto': 'Segue o orçamento.', 'arquivo': A1})}, true)")
confere("gravar com PDF que não está na pasta: recusa", isinstance(r, dict) and not r["gravado"] and any("pasta" in x for x in r["erros"]), r)
na_pasta(A1)
r, _ = js(f"select whatsapp_enfileirar({q({'ordem_numero': 1887, 'texto': 'Segue o orçamento.', 'arquivo': A1, 'modelo': 'orcamento', 'pedido': 'manda o orçamento'})}, true)")
confere("gravar com PDF na pasta: entra na fila", isinstance(r, dict) and r["gravado"] and r["arquivo"] == A1["nome"], r)
F1 = r["id"] if isinstance(r, dict) else 0
g, _ = js(f"select to_jsonb(f) from whatsapp_fila f where id = {F1}", None)
confere("fila guarda arquivo (path, nome, tipo, bytes, origem) e modelo",
        isinstance(g, dict) and g["arquivo"]["path"] == A1["path"] and g["arquivo"]["bytes"] == 180000 and g["arquivo"]["origem"] == A1["origem"] and g["modelo"] == "orcamento", g)
r, _ = js(f"select whatsapp_enfileirar({q({'ordem_numero': 1887, 'texto': 'Segue o orçamento.', 'arquivo': A1})}, true)")
confere("mesmo texto + mesmo PDF em 10 min: não repete", isinstance(r, dict) and not r["gravado"] and any("10 minutos" in x for x in r["erros"]), r)

# arquivo inválido
for nome, ruim in [("caminho fora do padrão", arquivo(path="../segredos/x.pdf")), ("outra pasta/extensão", arquivo(path="2026/11/x.jpg")),
                   ("não é PDF", {**arquivo(), "tipo": "image/png"}), ("nome com barra", arquivo(nome="a/b.pdf")), ("grande demais", arquivo(bytes_=6_000_000))]:
    r, _ = js(f"select whatsapp_enfileirar({q({'telefone': '27999990002', 'texto': 'x ' + nome, 'arquivo': ruim})}, false)")
    confere("arquivo inválido recusado: " + nome, isinstance(r, dict) and any("Arquivo inválido" in x for x in r["erros"]), r)

# só o PDF, sem texto
A2 = arquivo("OS_01890_XYZ9A88.pdf"); na_pasta(A2)
r, _ = js(f"select whatsapp_enfileirar({q({'ordem_numero': 1890, 'texto': '', 'arquivo': A2})}, true)")
confere("só o PDF (sem texto) entra; O.S. sem cliente cadastrado usa o telefone da O.S.",
        isinstance(r, dict) and r["gravado"] and r["telefone"] == "5527988887777" and r["cliente"]["nome"] == "Cliente sem cadastro", r)
F2 = r["id"] if isinstance(r, dict) else 0
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': '27999990002', 'texto': '  '})}, false)")
confere("sem texto e sem PDF: mensagem vazia", isinstance(r, dict) and "Mensagem vazia." in r["erros"], r)
_, e = sql("insert into whatsapp_fila (telefone, texto) values ('5527999990002', '')")
confere("banco recusa linha sem texto e sem arquivo", "whatsapp_fila_texto_ou_arquivo" in e, e)
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': '27999990002', 'texto': 'Olá'})}, true)")
confere("texto sem PDF continua igual", isinstance(r, dict) and r["gravado"] and r.get("arquivo") is None, r)
F3 = r["id"] if isinstance(r, dict) else 0
_, e = sql(f"select whatsapp_enfileirar({q({'telefone': '27999990002', 'texto': 'x', 'arquivo': arquivo()})}, false)", "authenticated", CONS)
confere("consultor não envia", "administrador" in e, e)

# ---------- quem não sabe enviar PDF (zap antiga, motor 3.1) não recebe mensagem com PDF ----------
p, _ = js(f"select whatsapp_motor_proxima('{CHAVE}', 'm1')", "anon")
confere("motor antigo (sem p_com_arquivo): pula as com PDF e pega só a de texto", isinstance(p, dict) and p["mensagem"]["id"] == F3 and p["mensagem"]["arquivo"] is None, p)
_, e = sql(f"select whatsapp_motor_arquivo('{CHAVE}', {F3})", "service_role")
confere("mensagem sem arquivo não dá link", "sem arquivo" in e, e)
sql(f"select whatsapp_motor_resultado('{CHAVE}', 'm1', {F3}, true, 'MSG3', '', null)", "anon")
sql("update whatsapp_conexao set proximo_envio = null")
p, _ = js(f"select whatsapp_motor_proxima('{CHAVE}', 'm1')", "anon")
confere("motor antigo: com só mensagens com PDF, fila vazia para ele", isinstance(p, dict) and p.get("motivo") == "fila vazia", p)
n2, _ = sql("select count(*) from pg_proc where proname in ('whatsapp_pegar_proxima', 'whatsapp_motor_proxima')")
confere("sem funções repetidas (a de 2 parâmetros foi trocada)", n2 == "2", n2)

# ---------- motor pega e baixa ----------
p, _ = js(f"select whatsapp_motor_proxima('{CHAVE}', 'm1', true)", "anon")
m = isinstance(p, dict) and p.get("mensagem") or {}
confere("motor pega a 1ª com o arquivo", m.get("id") == F1 and m.get("arquivo", {}).get("path") == A1["path"] and m["arquivo"]["nome"] == A1["nome"], p)
a, e = js(f"select whatsapp_motor_arquivo('{CHAVE}', {F1})", "service_role")
confere("zap confere: mensagem 'enviando' pelo motor libera o caminho", isinstance(a, dict) and a.get("path") == A1["path"], (a, e))
_, e = sql(f"select whatsapp_motor_arquivo('dtm_{'0' * 64}', {F1})", "service_role")
confere("chave errada não libera o PDF", "Chave do motor" in e, e)
_, e = sql(f"select whatsapp_motor_arquivo('{CHAVE}', {F2})", "service_role")
confere("mensagem que o motor não pegou não libera o PDF", "não está sendo enviada" in e, e)
_, e = sql(f"select whatsapp_motor_arquivo('{CHAVE}', {F1})", "authenticated")
confere("site (authenticated) não chama whatsapp_motor_arquivo", "permission denied" in e, e)
_, e = sql(f"select whatsapp_motor_arquivo('{CHAVE}', {F1})", "anon")
confere("anon não chama whatsapp_motor_arquivo", "permission denied" in e, e)
sql(f"select whatsapp_motor_resultado('{CHAVE}', 'm1', {F1}, true, 'MSG1', '5527999990002@s.whatsapp.net', null)", "anon")
g, _ = js(f"select jsonb_build_object('st', f.status, 'tx', m.texto, 'tp', m.tipo) from whatsapp_fila f join whatsapp_mensagens m on m.fila_id = f.id where f.id = {F1}", None)
confere("texto + PDF: conversa registra o texto", isinstance(g, dict) and g["st"] == "enviada" and g["tx"] == "Segue o orçamento." and g["tp"] == "texto", g)
_, e = sql(f"select whatsapp_motor_arquivo('{CHAVE}', {F1})", "service_role")
confere("depois de enviada, o link não sai mais", "não está sendo enviada" in e, e)
sql("update whatsapp_conexao set proximo_envio = null")
p, _ = js(f"select whatsapp_motor_proxima('{CHAVE}', 'm1', true)", "anon")
confere("2ª: só o PDF", isinstance(p, dict) and p["mensagem"]["id"] == F2 and p["mensagem"]["texto"] == "" and p["mensagem"]["arquivo"]["nome"] == A2["nome"], p)
sql(f"select whatsapp_motor_resultado('{CHAVE}', 'm1', {F2}, true, 'MSG2', '', null)", "anon")
g, _ = js(f"select jsonb_build_object('tx', texto, 'tp', tipo) from whatsapp_mensagens where fila_id = {F2}", None)
confere("só PDF: conversa mostra [documento] nome", isinstance(g, dict) and g["tx"] == "[documento] " + A2["nome"] and g["tp"] == "documento", g)
# texto saiu e o PDF não (erro com msg_id): pedir de novo em 10 min é recusado (não manda o texto duas vezes)
A4 = arquivo("OS_01887_ABC1D23.pdf"); na_pasta(A4)
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': '27999990002', 'texto': 'Segue a O.S.', 'arquivo': A4})}, true)")
F4 = r["id"]; sql("update whatsapp_conexao set proximo_envio = null")
js(f"select whatsapp_motor_proxima('{CHAVE}', 'm1', true)", "anon")
sql(f"select whatsapp_motor_resultado('{CHAVE}', 'm1', {F4}, false, 'MSG4', '', 'O texto saiu, mas o PDF não: x')", "anon")
r, _ = js(f"select whatsapp_enfileirar({q({'telefone': '27999990002', 'texto': 'Segue a O.S.', 'arquivo': A4})}, true)")
confere("texto saiu e PDF não: repetir em 10 min é recusado", isinstance(r, dict) and not r["gravado"] and any("10 minutos" in x for x in r["erros"]), r)

# ---------- limpeza ----------
VELHO = arquivo("velho.pdf"); sql(f"insert into storage.objects (bucket_id, name, created_at) values ('whatsapp-envio', '{VELHO['path']}', now() - interval '31 days'), ('whatsapp-midia', '2026/09/x.jpg', now() - interval '40 days')")
v, _ = sql("select array_to_string(whatsapp_envio_vencido(50), ',')", "service_role")
confere("vencidos: só PDFs da whatsapp-envio com mais de 30 dias", v == VELHO["path"], v)
n, _ = sql(f"select whatsapp_envio_apagado(array['{A2['path']}'])", "service_role")
g, _ = sql(f"select (arquivo ->> 'apagado') from whatsapp_fila where id = {F2}")
confere("apagado marca a fila", n == "1" and g == "true", (n, g))
_, e = sql("select whatsapp_envio_vencido(10)", "authenticated")
confere("site não lista a pasta", "permission denied" in e, e)
c, _ = sql("select command from cron.job where jobname = 'dtcar-zap-limpar-midia'")
confere("agendamento único da limpeza inclui os PDFs", "whatsapp-envio" in c and sql("select count(*) from cron.job where jobname = 'dtcar-zap-limpar-midia'")[0] == "1", c[:80])

print("\n".join("OK " + x for x in ok)); print("FALHAS", falhas)
subprocess.run(["psql", "-q", "-c", f"drop database if exists {BANCO}"], capture_output=True)
raise SystemExit(1 if falhas else 0)
