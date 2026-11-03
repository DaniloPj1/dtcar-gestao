# Teste do supabase/v24.sql (motor do WhatsApp no Android) num Postgres local com papéis ao estilo Supabase.
# Rodar: PGHOST=... PGPORT=... PGUSER=postgres python3 teste/teste_v24.py <banco>
# O banco precisa ter o esquema da oficina (perfis, e_admin) e o v22/v23; o teste roda o v24 e desfaz tudo no fim.
import subprocess, sys, os, json
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANCO = sys.argv[1] if len(sys.argv) > 1 else "f1"
ok, falhas = [], []
def confere(n, c, x=""): (ok if c else falhas).append(n + (f" ({x})" if x else ""))

def sql(comando, papel=None):
    """Roda como o papel pedido; devolve (saida, erro)."""
    pre = f"set role {papel};" if papel else ""
    r = subprocess.run(["psql", "-d", BANCO, "-At", "-v", "ON_ERROR_STOP=1", "-c", pre + comando], capture_output=True, text=True)
    saida = "\n".join(l for l in r.stdout.splitlines() if l != "SET")
    return saida.strip(), r.stderr.strip()

subprocess.run(["psql", "-d", BANCO, "-q", "-v", "ON_ERROR_STOP=1", "-f", os.path.join(RAIZ, "supabase", "v24.sql")], check=True, capture_output=True)
sql("set session_replication_role = replica; update perfis set papel = 'admin', ativo = true where id = auth.uid()")
sql("delete from whatsapp_sessao; update whatsapp_conexao set dono='', dono_id=null, dono_ate=null, motor_hash=null, pedido=null, situacao='conectado', numero='5527992470140'")
sql("insert into whatsapp_sessao values ('creds', '{\"me\":{\"id\":\"x\"}}', now()), ('k:session:a', '{\"v\":1}', now())")

# --- chave do motor ---
chave, e = sql("select whatsapp_motor_nova_chave()", "authenticated")
confere("administrador gera a chave", chave.startswith("dtm_") and len(chave) == 68, e or chave)
h, _ = sql("select motor_hash from whatsapp_conexao")
confere("banco guarda só o resumo da chave", h and chave not in h and len(h) == 64)
_, e = sql("select whatsapp_motor_nova_chave()", "anon")
confere("anon não gera chave", "permission denied" in e, e)
sql("set session_replication_role = replica; update perfis set papel = 'mecanico' where id = auth.uid()")
_, e = sql("select whatsapp_motor_nova_chave()", "authenticated")
confere("não administrador não gera chave", "administrador" in e, e)
sql("set session_replication_role = replica; update perfis set papel = 'admin' where id = auth.uid()")
_, e = sql("select motor_hash from whatsapp_conexao", "authenticated")
confere("tela não lê o resumo da chave", "permission denied" in e, e)
s, e = sql("select situacao, motor_visto from whatsapp_conexao", "authenticated")
confere("tela lê a situação", s.startswith("conectado") and not e, e)

# --- pulso e vez ---
q = lambda s: s.replace("'", "''")
def rpc(f, args, papel="anon"):
    s, e = sql(f"select public.{f}({args})", papel)
    return (json.loads(s) if s.startswith("{") else s), e
r, e = rpc("whatsapp_motor_pulso", f"'{chave}', 'm1', '{{\"versao\":\"1\"}}'")
confere("pulso com a chave: pega a vez", isinstance(r, dict) and r["vez"] is True and r["dono"] == "android", e or r)
r, e = rpc("whatsapp_motor_pulso", "'dtm_errada000000000000000000000000000000000000000000', 'm1'")
confere("pulso com chave errada: recusado", "inválida" in e, e)
r, e = rpc("whatsapp_motor_pulso", f"'{chave}', 'm2'")
confere("segundo motor não pega a vez de quem está com ela", r["vez"] is False, r)
_, e = sql("select whatsapp_pegar_vez('supabase', 'z1', 60)", "anon")
confere("anon não chama a vez interna", "permission denied" in e, e)
s, _ = sql("select whatsapp_pegar_vez('supabase', 'z1', 60)", "service_role")
confere("zap não pega a vez do motor ativo", s == "f", s)

# --- sessão ---
r, e = rpc("whatsapp_motor_ler", f"'{chave}', 'm1', array['creds','k:session:a','pareamento']")
confere("motor com a vez lê a sessão", isinstance(r, dict) and r.get("creds", {}).get("me", {}).get("id") == "x" and "pareamento" not in r, e or r)
r, e = rpc("whatsapp_motor_ler", f"'{chave}', 'm2', array['creds']")
confere("motor sem a vez não lê", "vez" in e, e)
_, e = sql("select * from whatsapp_sessao", "anon")
confere("anon não lê a tabela da sessão", "permission denied" in e, e)
_, e = rpc("whatsapp_motor_gravar", f"'{chave}', 'm1', '{{\"k:session:b\": {{\"v\": 2}}, \"pareamento\": {{\"x\":1}}, \"k:nulo\": null}}', array['k:session:a']")
s, _ = sql("select string_agg(chave, ',' order by chave) from whatsapp_sessao")
confere("gravar põe, tira e ignora 'pareamento' e nulos", s == "creds,k:session:b" and not e, e or s)
_, e = rpc("whatsapp_motor_situacao", f"'{chave}', 'm1', 'conectado', 'Motor do Android conectado', '5527992470140'")
s, _ = sql("select situacao||'|'||detalhe from whatsapp_conexao")
confere("situação gravada pelo motor", s == "conectado|Motor do Android conectado", e or s)
_, e = rpc("whatsapp_motor_situacao", f"'{chave}', 'm1', 'pareando', 'x'")
confere("motor não põe situação inválida", "inválida" in e, e)

# --- sem celular vinculado o motor não fica com a vez ---
sql("update whatsapp_sessao set valor = '{}' where chave = 'creds'")
r, _ = rpc("whatsapp_motor_pulso", f"'{chave}', 'm1'")
s, _ = sql("select coalesce(dono_ate::text, 'livre') from whatsapp_conexao")
confere("sem celular vinculado: motor solta e não pega a vez", r["vez"] is False and r["vinculado"] is False and s == "livre", str(r) + s)
sql("update whatsapp_sessao set valor = '{\"registered\": true}' where chave = 'creds'")
r, _ = rpc("whatsapp_motor_pulso", f"'{chave}', 'm1'")
confere("vinculado pelo código (registered): pega a vez", r["vez"] is True and r["vinculado"] is True, r)

# --- pedido de desconectar ---
sql("update whatsapp_conexao set pedido = 'desconectar'")
r, _ = rpc("whatsapp_motor_pulso", f"'{chave}', 'm1'")
confere("pulso entrega o pedido ao motor com a vez", r["pedido"] == "desconectar", r)
rpc("whatsapp_motor_apagar_sessao", f"'{chave}', 'm1'")
rpc("whatsapp_motor_situacao", f"'{chave}', 'm1', 'desligado', 'Desconectado pelo motor', '', true")
s, _ = sql("select (select count(*) from whatsapp_sessao)||'|'||situacao||'|'||coalesce(pedido,'-') from whatsapp_conexao")
confere("desconectar: sessão apagada, pedido limpo", s == "0|desligado|-", s)

# --- soltar, vencer e revogar ---
sql("insert into whatsapp_sessao values ('creds', '{\"me\":{\"id\":\"x\"}}', now())")
rpc("whatsapp_motor_soltar", f"'{chave}', 'm1'")
s, _ = sql("select whatsapp_pegar_vez('supabase', 'z1', 60)", "service_role")
confere("motor soltou: zap pega a vez", s == "t", s)
r, _ = rpc("whatsapp_motor_pulso", f"'{chave}', 'm1'")
confere("motor espera enquanto o zap está com a vez", r["vez"] is False and r["dono"] == "supabase", r)
sql("update whatsapp_conexao set dono_ate = now() - interval '1 second'")
r, _ = rpc("whatsapp_motor_pulso", f"'{chave}', 'm1'")
confere("vez vencida: motor pega de volta", r["vez"] is True, r)
_, e = sql("select whatsapp_motor_revogar()", "authenticated")
r, e2 = rpc("whatsapp_motor_pulso", f"'{chave}', 'm1'")
s, _ = sql("select whatsapp_pegar_vez('supabase', 'z2', 60)", "service_role")
confere("revogar: chave deixa de valer na hora", "inválida" in e2 and not e, e or e2)
confere("revogar: a vez do motor continua até vencer (ele ainda pode estar conectado)", s == "f", s)
sql("update whatsapp_conexao set dono_ate = now() - interval '1 second'")
s, _ = sql("select whatsapp_pegar_vez('supabase', 'z2', 60)", "service_role")
confere("revogar: depois de vencer, a função zap pega a vez", s == "t", s)

sql("update whatsapp_conexao set dono='', dono_id=null, dono_ate=null, motor_hash=null, motor_chave_em=null, motor_visto=null, motor_info=null, pedido=null")
print("\n".join("OK " + x for x in ok)); print("FALHAS", falhas)
if falhas: raise SystemExit(1)
