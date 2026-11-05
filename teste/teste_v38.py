# Teste do supabase/v38.sql (WhatsApp: "pacote" de mensagens para o mesmo número) num Postgres local, SEM o banco
# da oficina: monta o esquema mínimo (teste/v34_esquema.sql), roda v22–v26, v32, v34, v36 e o v38 (duas vezes).
# Rodar: PGHOST=... PGPORT=... PGUSER=postgres python3 teste/teste_v38.py
import subprocess, os, json, re
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANCO = "dtcar_teste_v38"
ADM = "00000000-0000-0000-0000-00000000000a"
VALMIR, OUTRO = "5527997976646", "5527981161503"
ok, falhas = [], []
def confere(n, c, x=""): (ok if c else falhas).append(n + (f" ({x})" if x else ""))
def roda(arq, texto=None):
    if texto is None: texto = open(os.path.join(RAIZ, arq), encoding="utf8").read()
    texto = re.sub(r"create extension if not exists pg_(net|cron);", "", texto)
    return subprocess.run(["psql", "-d", BANCO, "-q", "-v", "ON_ERROR_STOP=1"], input=texto, capture_output=True, text=True)
def sql(comando):
    r = subprocess.run(["psql", "-d", BANCO, "-At", "-v", "ON_ERROR_STOP=1", "-c", f"set teste.uid = '{ADM}';" + comando],
                       capture_output=True, text=True)
    return "\n".join(l for l in r.stdout.splitlines() if l not in ("SET",) and not l.startswith(("INSERT ", "UPDATE ", "DELETE "))).strip(), r.stderr.strip()
q = lambda v: "'" + json.dumps(v).replace("'", "''") + "'::jsonb"

subprocess.run(["psql", "-q", "-c", f"drop database if exists {BANCO}", "-c", f"create database {BANCO}"], check=True, capture_output=True)
r = roda("teste/v34_esquema.sql"); confere("esquema mínimo", r.returncode == 0, r.stderr[-300:])
r = roda(None, """
create table public.fornecedores (id uuid primary key default gen_random_uuid(), nome text not null, telefone text not null default '');
create table net.chamadas (id bigserial primary key, url text, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.chamadas (url, body) values (url, body) returning id $$;
""")
confere("esquema extra", r.returncode == 0, r.stderr[-300:])
for f in ("v22", "v23", "v24", "v25", "v26", "v32", "v34"):
    r = roda(f"supabase/{f}.sql"); confere(f"{f} roda", r.returncode == 0, r.stderr[-300:])
r = roda("supabase/v38.sql"); confere("v38 sem o v36: recusa com explicação", r.returncode != 0 and "Rode o v36" in r.stderr, r.stderr[-200:])
r = roda("supabase/v36.sql"); confere("v36 roda", r.returncode == 0, r.stderr[-300:])
for i in range(2):
    r = roda("supabase/v38.sql"); confere(f"v38 roda (vez {i + 1})", r.returncode == 0, r.stderr[-400:])

SEMPRE = {"inicio": "00:00", "fim": "23:59", "sabado_fim": "23:59", "dias": [1, 2, 3, 4, 5, 6, 7], "intervalo_min": 25, "intervalo_max": 70, "por_hora": 20, "por_dia": 80}
sql(f"update whatsapp_conexao set situacao = 'conectado', regras = {q(SEMPRE)}, avisos = '{{}}'::jsonb, proximo_envio = null, dono = 'android', dono_id = 'm1', dono_ate = now() + interval '90 seconds'")

def poe(tel, texto, atraso_min=0):
    v, e = sql(f"insert into whatsapp_fila (telefone, texto, criado_em) values ('{tel}', '{texto}', now() + interval '{atraso_min} minutes') returning id")
    return int(v.splitlines()[0])
def pega():
    sql("update whatsapp_conexao set proximo_envio = null where id = 1")
    v, e = sql("select whatsapp_pegar_proxima('android', 'm1', true)")
    return json.loads(v) if v else {"erro": e}
def resultado(fid, ok_=True):
    _, e = sql(f"select whatsapp_resultado('android', 'm1', {fid}, {'true' if ok_ else 'false'}, 'M{fid}', '', {'null' if ok_ else repr('falhou')})")
    return e
def intervalo():
    v, _ = sql("select extract(epoch from proximo_envio - now())::int from whatsapp_conexao where id = 1")
    return int(v)

# 1) pacote: O.S. + NF-e + NFS-e para o mesmo número, e depois outro cliente
a, b_, c, d = poe(VALMIR, "O.S. 1897"), poe(VALMIR, "NF-e 21"), poe(VALMIR, "NFS-e 134"), poe(OUTRO, "Outro cliente")
m = pega(); confere("pega a primeira", m.get("mensagem", {}).get("id") == a, m)
e = resultado(a); confere("resultado grava", not e, e)
i = intervalo(); confere("mesmo número em seguida: intervalo de 3 s", 1 <= i <= 3, i)
m = pega(); resultado(b_); i = intervalo(); confere("segunda do pacote: 3 s", 1 <= i <= 3, i)
m = pega(); resultado(c); i = intervalo(); confere("última do pacote (a seguinte é outro número): intervalo normal", 24 <= i <= 70, i)
m = pega(); confere("depois vem o outro número", m.get("mensagem", {}).get("id") == d, m)
resultado(d); i = intervalo(); confere("fila vazia depois: intervalo normal", 24 <= i <= 70, i)
v, _ = sql(f"select count(*) from whatsapp_mensagens where fila_id in ({a},{b_},{c},{d})")
confere("as 4 aparecem na conversa", v == "4", v)

# 2) falha no meio do pacote: intervalo normal (não emenda)
x, y = poe(VALMIR, "a"), poe(VALMIR, "b")
pega(); resultado(x, False); i = intervalo(); confere("falha: intervalo normal", 24 <= i <= 70, i)
sql(f"update whatsapp_fila set status = 'cancelada' where id = {y}")

# 3) mesma pessoa, mas a próxima entrou na fila mais de 5 min depois: não é pacote
x, y = poe(VALMIR, "antes"), poe(VALMIR, "bem depois", 6)
pega(); resultado(x); i = intervalo(); confere("entrou mais de 5 min depois: intervalo normal", 24 <= i <= 70, i)
sql(f"update whatsapp_fila set status = 'cancelada' where id = {y}")

# 4) trava: no máximo 6 seguidas para o mesmo número em 5 minutos
sql(f"delete from whatsapp_fila where telefone = '{OUTRO}'")
sql(f"update whatsapp_fila set enviada_em = now() - interval '10 minutes' where status = 'enviada'")
ids = [poe(OUTRO, f"m{k}") for k in range(8)]
seq = []
for k in range(7):
    pega(); resultado(ids[k]); seq.append(intervalo())
confere("trava: 5 com 3 s, a 6ª enviada já passa ao intervalo normal", all(1 <= s <= 3 for s in seq[:5]) and all(s >= 24 for s in seq[5:]), seq)

# 5) mensagem interna (celular do Danilo) passa na frente: o pacote não emenda com ela
sql("update whatsapp_fila set status = 'cancelada' where status = 'pendente'")
x, y = poe(VALMIR, "p1"), poe(VALMIR, "p2")
m = pega(); confere("pega a do cliente", m.get("mensagem", {}).get("id") == x, m)
sql(f"insert into whatsapp_fila (telefone, texto, interno) values ('5527997696545', 'aviso interno', true)")
resultado(x); i = intervalo()
confere("a próxima é a interna (outro número): intervalo normal", 24 <= i <= 70, i)

# 6) resultado repetido / de outro dono: não mexe no intervalo
sql("update whatsapp_conexao set proximo_envio = now() + interval '50 seconds' where id = 1")
resultado(x); i = intervalo(); confere("resultado repetido não muda o intervalo", 45 <= i <= 50, i)

# 7) a seguinte entra na fila DEPOIS de a anterior sair (o Claude enfileira uma de cada vez): o gatilho encurta o intervalo
sql("update whatsapp_fila set status = 'cancelada' where status = 'pendente'")
sql("update whatsapp_fila set enviada_em = now() - interval '10 minutes', pego_em = now() - interval '10 minutes' where status in ('enviada', 'erro')")
x = poe(VALMIR, "O.S. sozinha"); pega(); resultado(x); i = intervalo(); confere("sozinha na fila: intervalo normal", 24 <= i <= 70, i)
y = poe(VALMIR, "NF-e chegou depois"); i = intervalo(); confere("a seguinte do mesmo número chegou: intervalo cai para 3 s", 1 <= i <= 3, i)
pega(); resultado(y); i = intervalo(); confere("e não há mais nada: intervalo normal", 24 <= i <= 70, i)
z = poe(OUTRO, "outro número"); i = intervalo(); confere("outro número chegando não encurta", 20 <= i <= 70, i)
sql(f"update whatsapp_fila set status = 'cancelada' where id = {z}")
w = poe(VALMIR, "falha"); pega(); resultado(w, False); i = intervalo()
w2 = poe(VALMIR, "depois da falha"); i2 = intervalo(); confere("depois de uma falha: não encurta", abs(i2 - i) <= 1 and i2 >= 20, (i, i2))
sql(f"update whatsapp_fila set status = 'cancelada' where id = {w2}")
sql("update whatsapp_conexao set proximo_envio = null where id = 1")
sql(f"update whatsapp_fila set pego_em = now() - interval '1 minute', status = 'enviada' where id = {w}")
poe(VALMIR, "intervalo já livre"); v, _ = sql("select proximo_envio is null from whatsapp_conexao where id = 1")
confere("intervalo já livre: o gatilho não marca nada", v == "t", v)

# 8) a próxima do mesmo número não pode sair agora (PARAR, limite, fora do horário): sem intervalo curto
sql("update whatsapp_fila set status = 'cancelada' where status = 'pendente'")
sql("update whatsapp_fila set enviada_em = now() - interval '2 hours', pego_em = now() - interval '2 hours' where status in ('enviada', 'erro')")
x, y, z = poe(VALMIR, "q1"), poe(VALMIR, "q2"), poe(OUTRO, "q3")
pega(); sql(f"insert into whatsapp_optout (telefone) values (whatsapp_chave_tel('{VALMIR}'))")
resultado(x); i = intervalo(); confere("PARAR no meio do pacote: intervalo normal (o outro contato não ganha 3 s)", 24 <= i <= 70, i)
sql(f"delete from whatsapp_optout where telefone = whatsapp_chave_tel('{VALMIR}')")
sql("update whatsapp_fila set status = 'cancelada' where status = 'pendente'")
x, y = poe(VALMIR, "r1"), poe(VALMIR, "r2")
pega(); sql("update whatsapp_conexao set regras = regras || '{\"por_hora\": 1}'::jsonb where id = 1")
resultado(x); i = intervalo(); confere("limite por hora atingido: intervalo normal", 24 <= i <= 70, i)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)} where id = 1")
sql("update whatsapp_fila set status = 'cancelada' where status = 'pendente'")
x, y = poe(VALMIR, "s1"), poe(VALMIR, "s2")
pega(); sql("update whatsapp_conexao set regras = regras || '{\"dias\": []}'::jsonb where id = 1")
resultado(x); i = intervalo(); confere("fora do horário: intervalo normal", 24 <= i <= 70, i)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)} where id = 1")

# permissões
v, _ = sql("select has_function_privilege('authenticated', 'public.whatsapp_resultado(text, text, bigint, boolean, text, text, text)', 'execute')")
confere("authenticated não chama whatsapp_resultado", v == "f", v)
v, _ = sql("select has_function_privilege('anon', 'public.whatsapp_resultado(text, text, bigint, boolean, text, text, text)', 'execute')")
confere("anon não chama whatsapp_resultado", v == "f", v)

for n in ok: print("OK", n)
for n in falhas: print("FALHOU", n)
print("FALHAS", len(falhas))
raise SystemExit(1 if falhas else 0)
