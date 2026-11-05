# Teste do supabase/v36.sql (WhatsApp: aviso de resposta, resposta pelo WhatsApp do Danilo com rascunho da IA e resumo)
# num Postgres local, SEM o banco da oficina: monta o esquema mínimo (teste/v34_esquema.sql), roda v22–v26, v32, v34 e
# o v36 (duas vezes) e confere os cenários.
# Rodar: PGHOST=... PGPORT=... PGUSER=postgres python3 teste/teste_v36.py
import subprocess, os, json, re
RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BANCO = "dtcar_teste_v36"
ADM = "00000000-0000-0000-0000-00000000000a"
DANILO, LUIZ, JOAO, ESTRANHO, FORN = "5527997696545", "5527981161503", "5527999990002", "5527988776655", "5527933334444"
ok, falhas = [], []
def confere(n, c, x=""): (ok if c else falhas).append(n + (f" ({x})" if x else ""))
def roda(arq, texto=None):
    if texto is None: texto = open(os.path.join(RAIZ, arq), encoding="utf8").read()
    texto = re.sub(r"create extension if not exists pg_(net|cron);", "", texto)
    return subprocess.run(["psql", "-d", BANCO, "-q", "-v", "ON_ERROR_STOP=1"], input=texto, capture_output=True, text=True)
def sql(comando, papel=None, uid=ADM):
    pre = f"set teste.uid = '{uid}';" + (f"set role {papel};" if papel else "")
    r = subprocess.run(["psql", "-d", BANCO, "-At", "-v", "ON_ERROR_STOP=1", "-c", pre + comando], capture_output=True, text=True)
    return "\n".join(l for l in r.stdout.splitlines() if l not in ("SET",)).strip(), r.stderr.strip()
def js(comando, papel=None):
    s, e = sql(comando, papel)
    try: return json.loads(s), e
    except Exception: return s, e
q = lambda v: "'" + json.dumps(v).replace("'", "''") + "'::jsonb"

subprocess.run(["psql", "-q", "-c", f"drop database if exists {BANCO}", "-c", f"create database {BANCO}"], check=True, capture_output=True)
r = roda("teste/v34_esquema.sql"); confere("esquema mínimo", r.returncode == 0, r.stderr[-300:])
r = roda(None, """
create table public.fornecedores (id uuid primary key default gen_random_uuid(), nome text not null, telefone text not null default '');
insert into public.fornecedores (nome, telefone) values ('Distribuidora de Peças X', '27933334444');
insert into public.clientes (id, nome, telefone) values ('33333333-3333-3333-3333-333333333333', 'Luiz Patrus', '');
insert into public.ordens (numero, cliente_id, cliente, veiculo, status, total, finalizada_em) values
  (1835, '33333333-3333-3333-3333-333333333333', '{"nome": "Luiz Patrus"}', '{"placa": "MSS9H86", "modelo": "Siena"}', 'entregue', 500, now() - interval '40 days');
-- pg_net de mentira: guarda os chamados
create table net.chamadas (id bigserial primary key, url text, body jsonb);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$ insert into net.chamadas (url, body) values (url, body) returning id $$;
""")
confere("esquema extra (fornecedores, pg_net de mentira)", r.returncode == 0, r.stderr[-300:])
for f in ("v22", "v23", "v24", "v25", "v26", "v32", "v34"):
    r = roda(f"supabase/{f}.sql"); confere(f"{f} roda", r.returncode == 0, r.stderr[-300:])
# mensagem de antes do v36: não pode gerar aviso
sql(f"insert into whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto) values ('ANTIGA', '{JOAO}@s.whatsapp.net', '{JOAO}', false, 'mensagem velha')")
sql("insert into whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, em) values ('ANTIGA2', '5527955554444@s.whatsapp.net', '5527955554444', true, 'Bom dia', now() - interval '10 hours')")
for i in range(2):
    r = roda("supabase/v36.sql"); confere(f"v36 roda (vez {i + 1})", r.returncode == 0, r.stderr[-400:])
v, _ = sql("select aviso from whatsapp_mensagens where msg_id = 'ANTIGA'")
confere("mensagem de antes do v36 fica como antiga", v == "antiga", v)
v, _ = sql("select round(extract(epoch from ate - now()) / 3600) from whatsapp_vigias where chave = whatsapp_chave_tel('5527955554444')")
confere("conversa aberta pela oficina antes do v36 já fica vigiada (48 h da mensagem)", v == "38", v)

SEMPRE = {"inicio": "00:00", "fim": "23:59", "sabado_fim": "23:59", "dias": [1, 2, 3, 4, 5, 6, 7], "intervalo_min": 25, "intervalo_max": 70, "por_hora": 20, "por_dia": 80}
CFG = {"juntar_s": 0, "silencio_inicio": "00:00", "silencio_fim": "00:00"}
sql(f"update whatsapp_conexao set situacao = 'conectado', regras = {q(SEMPRE)}, avisos = {q(CFG)}, alerta_telefone = '{DANILO}', proximo_envio = null, dono = 'android', dono_id = 'm1', dono_ate = now() + interval '90 seconds'")

seq = [0]
def recebe(tel, texto, tipo="texto", responde_a=None, de_mim=False):
    seq[0] += 1; mid = f"R{seq[0]}"
    m = {"msg_id": mid, "jid": tel + "@s.whatsapp.net", "telefone": tel, "nome": "", "de_mim": de_mim, "texto": texto, "tipo": tipo}
    if responde_a: m["responde_a"] = responde_a
    sql(f"select whatsapp_guardar_mensagens({q([m])})")
    return mid
def envia_tudo():
    """Simula o motor: pega e envia tudo o que estiver liberado (sem intervalo)."""
    saidas = []
    for _ in range(30):
        sql("update whatsapp_conexao set proximo_envio = null, dono_ate = now() + interval '90 seconds' where id = 1")
        r, e = js("select whatsapp_pegar_proxima('android', 'm1', true)")
        if not isinstance(r, dict) or "mensagem" not in r: break
        m = r["mensagem"]; seq[0] += 1; mid = f"E{seq[0]}"
        sql(f"select whatsapp_resultado('android', 'm1', {m['id']}, true, '{mid}', '{m['telefone']}@s.whatsapp.net', null)")
        saidas.append({**m, "msg_id": mid})
    return saidas
def para(saidas, tel): return [s for s in saidas if s["telefone"] == tel]
def ultimo_aviso(tipo):
    r, _ = js(f"select to_jsonb(a) from whatsapp_avisos a where tipo = '{tipo}' order by id desc limit 1")
    return r if isinstance(r, dict) else {}

# ---------- 1. a oficina abre a conversa → vigia de 48 h ----------
r, e = js(f"set teste.uid = '{ADM}'; select whatsapp_enfileirar({q({'telefone': LUIZ, 'cliente_id': '33333333-3333-3333-3333-333333333333', 'texto': 'Boa tarde, Luiz! Qual o problema do carro?'})}, true)")
s = envia_tudo()
confere("mensagem da oficina sai", len(para(s, LUIZ)) == 1, s)
v, _ = sql(f"select round(extract(epoch from ate - desde) / 3600) from whatsapp_vigias where chave = whatsapp_chave_tel('{LUIZ}')")
confere("vigia aberta por 48 h", v == "48", v)

# ---------- 2. o cliente responde → aviso no celular do Danilo ----------
recebe(LUIZ, "Boa tarde! Está fazendo barulho na suspensão dianteira.")
recebe(LUIZ, "Pode ser quarta de manhã?")
s = envia_tudo()
av = para(s, DANILO)
confere("um aviso só para as duas mensagens seguidas (juntou)", len(av) == 1, s)
txt = av[0]["texto"] if av else ""
confere("aviso traz nome, veículo e as mensagens", "*Luiz Patrus*" in txt and "Siena MSS9H86" in txt and "barulho na suspensão" in txt and "quarta de manhã" in txt, txt)
AVISO_MSG = av[0]["msg_id"] if av else ""
f, _ = js(f"select to_jsonb(f) from whatsapp_fila f where id = {av[0]['id'] if av else 0}")
confere("aviso é interno, origem sistema", isinstance(f, dict) and f["interno"] and f["origem"] == "sistema", f)
v, _ = sql("select count(*) from whatsapp_vigias where chave = whatsapp_chave_tel('" + DANILO + "')")
confere("mensagem para o Danilo não abre vigia", v == "0", v)

# ---------- 3. juntar: com espera, a mensagem fica presa até liberar_em ----------
sql(f"update whatsapp_conexao set avisos = avisos || '{{\"juntar_s\": 45}}' where id = 1")
recebe(LUIZ, "Esqueci: o carro é 2010.")
s = envia_tudo()
confere("aviso com espera de 45 s não sai antes", len(para(s, DANILO)) == 0, s)
recebe(LUIZ, "Obrigado")
f, _ = js("select to_jsonb(f) from whatsapp_fila f where interno and status = 'pendente' order by id desc limit 1")
confere("segunda mensagem entra no mesmo aviso pendente", isinstance(f, dict) and "2010" in f["texto"] and "Obrigado" in f["texto"] and f["texto"].count("Responda em cima") == 1, f)
sql("update whatsapp_fila set liberar_em = now() - interval '1 second' where interno and status = 'pendente'")
s = envia_tudo(); confere("depois de liberar_em, sai", len(para(s, DANILO)) == 1, s)
sql(f"update whatsapp_conexao set avisos = avisos || '{{\"juntar_s\": 0}}' where id = 1")

# ---------- 4. número desconhecido, propaganda e fornecedor: sem aviso ----------
recebe(ESTRANHO, "Olá! Temos uma promoção imperdível de tráfego pago para sua oficina")
recebe("5527977001122", "Boa tarde, vocês fazem alinhamento?")
recebe(FORN, "Chegou o pedido de vocês")
s = envia_tudo()
confere("desconhecido, propaganda e fornecedor não geram aviso", len(para(s, DANILO)) == 0, s)
v, _ = sql(f"select string_agg(aviso, ',' order by id) from whatsapp_mensagens where telefone in ('{ESTRANHO}', '5527977001122', '{FORN}')")
confere("vão para o resumo", v == "resumo,resumo,resumo", v)

# ---------- 5. cliente com O.S. (sem vigia) gera aviso ----------
recebe(JOAO, "O orçamento foi aprovado, podem fazer.")
s = envia_tudo(); a = para(s, DANILO)
confere("cliente com O.S. aberta avisa mesmo sem vigia", len(a) == 1 and "*João da Silva*" in a[0]["texto"] and "O.S. 1887" in a[0]["texto"], a)
AVISO_JOAO = a[0]["msg_id"] if a else ""

# ---------- 6. Danilo responde citando o aviso → rascunho pela IA ----------
sql("delete from net.chamadas")
recebe(DANILO, "fala pra ele que quarta 8h ta ok e que o problema pode ser bucha", responde_a=AVISO_MSG)
r = ultimo_aviso("rascunho")
confere("resposta citando o aviso vira rascunho do cliente certo", r.get("situacao") == "pendente" and r.get("cliente_nome") == "Luiz Patrus" and "quarta 8h" in (r.get("base") or ""), r)
v, _ = sql("select count(*) from net.chamadas where body ->> 'acao' = 'assistente'")
confere("a função zap é chamada na hora (pg_net)", v == "1", v)
v, _ = sql(f"select aviso from whatsapp_mensagens where telefone = '{DANILO}' and not de_mim order by id desc limit 1")
confere("mensagem do Danilo fica como comando", v == "comando", v)
v, _ = sql("select count(*) from whatsapp_vigias where chave = whatsapp_chave_tel('" + DANILO + "')")
confere("mensagem do Danilo não abre vigia nem aviso", v == "0", v)

p, _ = js("select whatsapp_assistente_pegar(3)", "service_role")
confere("IA pega o rascunho com o contexto da conversa", isinstance(p, list) and len(p) == 1 and p[0]["cliente"] == "Luiz Patrus" and any("barulho" in c["texto"] for c in p[0]["conversa"]) and p[0]["veiculo"] == "Siena MSS9H86", p)
RID = p[0]["id"] if isinstance(p, list) and p else 0
p2, _ = js("select whatsapp_assistente_pegar(3)", "service_role")
confere("não pega o mesmo rascunho duas vezes", p2 == [], p2)
PROPOSTA = "Boa tarde, Luiz! Quarta-feira às 8h está confirmado. Pelo que você descreveu, pode ser a bucha da suspensão; vamos avaliar no dia."
sql(f"select whatsapp_assistente_resultado({RID}, '{PROPOSTA}', 'claude-haiku-5-5', null, false)", "service_role")
s = envia_tudo(); rs = para(s, DANILO)
confere("rascunho vai para o Danilo com instrução de OK", len(rs) == 1 and PROPOSTA in rs[0]["texto"] and "*OK*" in rs[0]["texto"] and "Rascunho para Luiz Patrus" in rs[0]["texto"], rs)
RASC_MSG = rs[0]["msg_id"] if rs else ""
confere("nada foi para o cliente sem OK", len(para(s, LUIZ)) == 0, s)

# ---------- 7. correção citando o rascunho ----------
recebe(DANILO, "tira a parte da bucha", responde_a=RASC_MSG)
r = ultimo_aviso("rascunho")
confere("correção vira novo rascunho com o anterior junto", r.get("situacao") == "pendente" and r.get("anterior") == PROPOSTA and r.get("base") == "tira a parte da bucha", r)
v, _ = sql(f"select situacao from whatsapp_avisos where id = {RID}")
confere("rascunho anterior fica substituído", v == "substituido", v)
p, _ = js("select whatsapp_assistente_pegar(3)", "service_role")
RID2 = p[0]["id"] if isinstance(p, list) and p else 0
P2 = "Boa tarde, Luiz! Quarta-feira às 8h está confirmado."
sql(f"select whatsapp_assistente_resultado({RID2}, '{P2}', 'claude-haiku-5-5', null, false)", "service_role")
s = envia_tudo(); RASC2 = para(s, DANILO)[0]["msg_id"] if para(s, DANILO) else ""

# OK citando o rascunho antigo: avisa que já foi substituído
recebe(DANILO, "ok", responde_a=RASC_MSG)
s = envia_tudo()
confere("OK no rascunho substituído não envia e explica", len(para(s, LUIZ)) == 0 and any("substituído" in x["texto"] for x in para(s, DANILO)), s)

# ---------- 8. OK → vai para o cliente ----------
recebe(DANILO, "OK!", responde_a=RASC2)
s = envia_tudo()
cl = para(s, LUIZ)
confere("OK manda o rascunho para o cliente", len(cl) == 1 and cl[0]["texto"] == P2, s)
confere("Danilo recebe a confirmação", any("Na fila para *Luiz Patrus*" in x["texto"] for x in para(s, DANILO)), s)
f, _ = js(f"select to_jsonb(f) from whatsapp_fila f where id = {cl[0]['id'] if cl else 0}")
confere("mensagem ao cliente: origem assistente, não interna", isinstance(f, dict) and f["origem"] == "assistente" and not f["interno"], f)
recebe(DANILO, "ok", responde_a=RASC2)
s = envia_tudo()
confere("segundo OK não reenvia", len(para(s, LUIZ)) == 0 and any("já está enviado" in x["texto"] for x in para(s, DANILO)), s)

# ---------- 9. sem citação: um cliente só nos últimos 30 min → vale ----------
sql("update whatsapp_avisos set criado_em = now() - interval '1 hour'")
recebe(JOAO, "Que horas fica pronto?")
envia_tudo()
recebe(DANILO, "[áudio 0:05] Fica pronto amanhã à tarde.")
r = ultimo_aviso("rascunho")
confere("sem citação, com um cliente recente: rascunho para ele (sem a marca do áudio)", r.get("cliente_nome") == "João da Silva" and r.get("base") == "Fica pronto amanhã à tarde.", r)
# dois clientes recentes e sem citação: explica
recebe(LUIZ, "Combinado, obrigado!")
envia_tudo()
recebe(DANILO, "beleza")
s = envia_tudo()
confere("sem citação e com dois clientes recentes: explica como responder", any("Não sei para qual cliente" in x["texto"] for x in para(s, DANILO)), s)
recebe(DANILO, "e agora?")
s = envia_tudo()
confere("explicação no máximo uma vez a cada 10 min", not any("Não sei para qual cliente" in x["texto"] for x in para(s, DANILO)), s)

# ---------- 10. CANCELAR ----------
p, _ = js("select whatsapp_assistente_pegar(3)", "service_role")
for it in (p if isinstance(p, list) else []):
    sql(f"select whatsapp_assistente_resultado({it['id']}, 'Boa tarde! Fica pronto amanhã à tarde.', 'claude-haiku-5-5', null, false)", "service_role")
s = envia_tudo(); rj = [x for x in para(s, DANILO) if "João da Silva" in x["texto"]]
recebe(DANILO, "cancelar", responde_a=rj[0]["msg_id"] if rj else None)
s = envia_tudo()
confere("CANCELAR não envia e confirma", len(para(s, JOAO)) == 0 and any("Cancelado" in x["texto"] for x in para(s, DANILO)), s)

# ---------- 11. IA falhou: tenta 3 vezes, depois vai o texto do Danilo ----------
sql("update whatsapp_avisos set criado_em = now() - interval '1 hour'")
recebe(LUIZ, "Posso levar na quarta às 7h30?")
s = envia_tudo(); AV = [x for x in para(s, DANILO)][-1]["msg_id"]
recebe(DANILO, "pode sim", responde_a=AV)
RF = ultimo_aviso("rascunho")["id"]
for t in range(3):
    p, _ = js("select whatsapp_assistente_pegar(3)", "service_role")
    confere(f"IA: tentativa {t + 1} pega o rascunho", isinstance(p, list) and len(p) == 1, p)
    sql(f"select whatsapp_assistente_resultado({RF}, null, null, 'HTTP 529', false)", "service_role")
    if t == 0:
        p, _ = js("select whatsapp_assistente_pegar(3)", "service_role")
        confere("IA: depois de falhar, espera 45 s para tentar de novo", p == [], p)
    sql(f"update whatsapp_avisos set atualizado_em = now() - interval '1 minute' where id = {RF}")
s = envia_tudo(); x = [m for m in para(s, DANILO) if "Rascunho" in m["texto"]]
confere("depois de 3 falhas, rascunho com o texto do Danilo e aviso de sem IA", len(x) == 1 and "pode sim" in x[0]["texto"] and "Sem revisão da IA" in x[0]["texto"], s)

# ---------- 12. OK AGORA fora do horário ----------
FECHADO = {**SEMPRE, "dias": []}
sql(f"update whatsapp_conexao set regras = {q(FECHADO)} where id = 1")
recebe(DANILO, "ok agora", responde_a=x[0]["msg_id"] if x else None)
f, _ = js(f"select to_jsonb(f) from whatsapp_fila f where telefone = '{LUIZ}' order by id desc limit 1")
confere("OK AGORA libera fora do horário", isinstance(f, dict) and f["fora_horario"] and f["texto"] == "pode sim" and f["status"] == "pendente", f)
s = envia_tudo()
confere("fora do horário: interno e liberado saem", len(para(s, LUIZ)) == 1 and len(para(s, DANILO)) >= 1, s)
# OK simples fora do horário fica esperando e o Danilo pode liberar com AGORA
recebe(LUIZ, "Fechado então.")
s = envia_tudo(); AV = para(s, DANILO)[-1]["msg_id"] if para(s, DANILO) else None
recebe(DANILO, "valeu Luiz, até quarta", responde_a=AV)
RG = ultimo_aviso("rascunho")["id"]; js("select whatsapp_assistente_pegar(3)", "service_role")
sql(f"select whatsapp_assistente_resultado({RG}, 'Valeu, Luiz! Até quarta.', 'claude-haiku-5-5', null, false)", "service_role")
s = envia_tudo(); R3 = para(s, DANILO)[-1]
confere("rascunho fora do horário avisa do OK AGORA", "OK AGORA" in R3["texto"], R3)
recebe(DANILO, "ok", responde_a=R3["msg_id"])
s = envia_tudo()
conf = [m for m in para(s, DANILO) if "Fora do horário" in m["texto"]]
confere("OK fora do horário: cliente espera, Danilo é avisado", len(para(s, LUIZ)) == 0 and len(conf) == 1, s)
recebe(DANILO, "agora", responde_a=conf[0]["msg_id"] if conf else None)
s = envia_tudo()
confere("AGORA em cima da confirmação libera a mensagem", len(para(s, LUIZ)) == 1 and para(s, LUIZ)[0]["texto"] == "Valeu, Luiz! Até quarta.", s)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)} where id = 1")

# ---------- 13. áudio do cliente espera a transcrição ----------
mid = recebe(LUIZ, "[audio]", tipo="audio")
v, _ = sql(f"select coalesce(aviso, 'nulo') from whatsapp_mensagens where msg_id = '{mid}'")
confere("áudio sem transcrição espera", v == "nulo", v)
sql(f"select whatsapp_guardar_midia({q({'msg_id': mid, 'transcricao': 'Vou levar o carro amanhã', 'duracao_s': 4})})")
s = envia_tudo()
confere("depois da transcrição, aviso com o texto do áudio", any("Vou levar o carro amanhã" in m["texto"] for m in para(s, DANILO)), s)
mid = recebe(LUIZ, "[audio]", tipo="audio")
sql(f"update whatsapp_mensagens set gravada_em = now() - interval '5 minutes' where msg_id = '{mid}'")
r, _ = js("select whatsapp_avisos_minuto()", "service_role")
v, _ = sql(f"select aviso from whatsapp_mensagens where msg_id = '{mid}'")
confere("áudio sem transcrição depois de 3 min: o agendamento avisa assim mesmo", v == "aviso", (v, r))
envia_tudo()

# ---------- 14. vigia vencida: contato sem O.S. vai para o resumo ----------
sql(f"update whatsapp_conexao set avisos = avisos || '{{}}' where id = 1")
sql("insert into whatsapp_vigias (chave, telefone, desde, ate) values (whatsapp_chave_tel('5527966665555'), '5527966665555', now() - interval '3 days', now() - interval '1 day')")
sql("insert into whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, aviso) values ('X1', '5527966665555@s.whatsapp.net', '5527966665555', true, 'Oi', 'antiga')")
recebe("5527966665555", "Respondendo uma semana depois")
v, _ = sql("select aviso from whatsapp_mensagens where telefone = '5527966665555' and not de_mim")
confere("vigia vencida e sem O.S.: resumo", v == "resumo", v)

# ---------- 15. resumo ----------
sid, _ = sql("select whatsapp_resumo_enviar()", "service_role")
t, _ = sql(f"select texto from whatsapp_fila where id = {sid or 0}")
confere("resumo agrupa por tipo de contato", "Resumo do WhatsApp" in t and "*Contatos com conversa anterior*" in t and "*Fornecedores*" in t
        and "Distribuidora de Peças X" in t and "*Números desconhecidos*" in t and "alinhamento" in t, t)
confere("propaganda só como contagem", "Propaganda: 1 mensagem" in t and "tráfego pago" not in t, t)
sid2, _ = sql("select whatsapp_resumo_enviar()", "service_role")
confere("sem mensagens novas, o resumo não sai", sid2 == "", sid2)
v, _ = sql("select count(*) from whatsapp_mensagens where aviso = 'resumo' and resumida_em is null")
confere("mensagens marcadas como resumidas", v == "0", v)

# ---------- 16. fila: internas primeiro e fora dos limites ----------
sql("update whatsapp_fila set status = 'cancelada' where status = 'pendente'")
sql("update whatsapp_fila set enviada_em = now() - interval '2 days' where status = 'enviada'")
LIM = {**SEMPRE, "por_hora": 1}
sql(f"update whatsapp_conexao set regras = {q(LIM)} where id = 1")
js(f"set teste.uid = '{ADM}'; select whatsapp_enfileirar({q({'telefone': JOAO, 'texto': 'Mensagem ao cliente A'})}, true)")
js(f"set teste.uid = '{ADM}'; select whatsapp_enfileirar({q({'telefone': JOAO, 'texto': 'Mensagem ao cliente B'})}, true)")
sql("select whatsapp_interno('aviso interno de teste')")
s = envia_tudo()
confere("interna sai primeiro", len(s) >= 1 and s[0]["telefone"] == DANILO, s)
confere("limite por hora vale para clientes, não para interna", len(para(s, JOAO)) == 1, s)
sql("select whatsapp_interno('outra interna')")
s = envia_tudo()
confere("com o limite atingido, a interna ainda sai", len(para(s, DANILO)) == 1 and len(para(s, JOAO)) == 0, s)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)} where id = 1")
envia_tudo()

# ---------- 17. silêncio (22h–7h): interna espera o horário comercial ----------
v, _ = sql("select whatsapp_no_silencio('{\"silencio_inicio\": \"22:00\", \"silencio_fim\": \"07:00\"}', '2026-11-05 02:00:00-03') || ',' || whatsapp_no_silencio('{\"silencio_inicio\": \"22:00\", \"silencio_fim\": \"07:00\"}', '2026-11-05 10:00:00-03') || ',' || whatsapp_no_silencio('{\"silencio_inicio\": \"22:00\", \"silencio_fim\": \"07:00\"}', '2026-11-05 22:30:00-03')")
confere("silêncio 22h–7h", v == "true,false,true", v)

# ---------- 18. desligado e sem número de alerta ----------
sql(f"update whatsapp_conexao set avisos = avisos || '{{\"ligado\": false}}' where id = 1")
recebe(JOAO, "teste desligado")
v, _ = sql("select aviso from whatsapp_mensagens order by id desc limit 1")
confere("desligado: não avisa", v == "desligado", v)
sql(f"update whatsapp_conexao set avisos = avisos || '{{\"ligado\": true}}', alerta_telefone = null where id = 1")
recebe(JOAO, "teste sem número")
v, _ = sql("select aviso from whatsapp_mensagens order by id desc limit 1")
confere("sem número de alerta: não avisa", v == "sem_numero", v)
sql(f"update whatsapp_conexao set alerta_telefone = '{DANILO}' where id = 1")

# ---------- 19. PARAR do Danilo não bloqueia o número dele; PARAR do cliente continua valendo ----------
recebe(DANILO, "parar")
v, _ = sql(f"select count(*) from whatsapp_optout where telefone = whatsapp_chave_tel('{DANILO}')")
confere("PARAR do Danilo não vira recusa", v == "0", v)
recebe(ESTRANHO, "PARAR")
v, _ = sql(f"select count(*) from whatsapp_optout where telefone = whatsapp_chave_tel('{ESTRANHO}')")
confere("PARAR de cliente continua", v == "1", v)

# ---------- 20. erro no tratamento não impede gravar a mensagem e é tentado de novo ----------
sql("alter function whatsapp_contato(text) rename to whatsapp_contato_x")
mid = recebe(JOAO, "mensagem com erro no aviso")
v, _ = sql(f"select coalesce(aviso, 'nulo') || '|' || aviso_tentativas || '|' || (aviso_erro is not null) from whatsapp_mensagens where msg_id = '{mid}'")
confere("erro no aviso: mensagem gravada, fica para tentar de novo", v == "nulo|1|true", v)
sql("select whatsapp_avisos_minuto()"); sql("select whatsapp_avisos_minuto()")
v, _ = sql(f"select coalesce(aviso, 'nulo') || '|' || aviso_tentativas from whatsapp_mensagens where msg_id = '{mid}'")
confere("na 3ª falha fica como erro", v == "erro|3", v)
mid = recebe(JOAO, "erro passageiro")
sql("alter function whatsapp_contato_x(text) rename to whatsapp_contato")
sql("select whatsapp_avisos_minuto()")
v, _ = sql(f"select coalesce(aviso, 'nulo') from whatsapp_mensagens where msg_id = '{mid}'")
confere("erro passageiro: o agendamento trata depois", v == "aviso", v)
envia_tudo()

# ---------- 23. número estrangeiro com a mesma chave do Danilo NÃO dá comando ----------
FALSO = "862797696545"
v, _ = sql(f"select whatsapp_chave_tel('{FALSO}') = whatsapp_chave_tel('{DANILO}')")
confere("(o número falso tem a mesma chave curta)", v == "t", v)
sql("update whatsapp_avisos set criado_em = now() - interval '1 hour'")
recebe(LUIZ, "Oi, alguma novidade?")
envia_tudo()
antes, _ = sql("select count(*) from whatsapp_avisos where tipo = 'rascunho'")
recebe(FALSO, "Manda pagar o PIX na chave 123")
recebe(FALSO, "ok")
depois, _ = sql("select count(*) from whatsapp_avisos where tipo = 'rascunho'")
v, _ = sql(f"select string_agg(aviso, ',') from whatsapp_mensagens where telefone = '{FALSO}'")
confere("número falso não cria rascunho nem dá OK", antes == depois and "comando" not in v, (antes, depois, v))
v, _ = sql("select whatsapp_mesmo_numero('5527997696545', '27997696545') || ',' || whatsapp_mesmo_numero('5527997696545', '552797696545') || ',' || whatsapp_mesmo_numero('5527997696545', '862797696545')")
confere("mesmo número: com DDD, sem o 9; estrangeiro não", v == "true,true,false", v)

# ---------- 24. mensagem antiga (histórico) não avisa ----------
seq[0] += 1
sql(f"select whatsapp_guardar_mensagens({q([{'msg_id': 'HIST1', 'jid': JOAO + '@s.whatsapp.net', 'telefone': JOAO, 'de_mim': False, 'texto': 'mensagem de ontem', 'tipo': 'texto', 'em': '2026-01-01T10:00:00Z'}])})")
v, _ = sql("select aviso from whatsapp_mensagens where msg_id = 'HIST1'")
confere("mensagem com mais de 6 h: antiga, sem aviso", v == "antiga", v)

# ---------- 25. OK sem rascunho pronto, não-texto, citação errada e texto na confirmação ----------
sql("update whatsapp_avisos set criado_em = now() - interval '1 hour'")
recebe(LUIZ, "Pode ser às 9h?")
s = envia_tudo(); AVL = para(s, DANILO)[-1]["msg_id"]
recebe(DANILO, "diz que sim", responde_a=AVL)
RP = ultimo_aviso("rascunho")
recebe(DANILO, "ok", responde_a=AVL)
s = envia_tudo(); r2 = ultimo_aviso("rascunho")
confere("OK com rascunho ainda em preparo: avisa e não cria rascunho 'ok'", r2.get("id") == RP.get("id") and r2.get("situacao") == "pendente"
        and any("ainda está sendo preparado" in x["texto"] for x in para(s, DANILO)), (r2, s))
recebe(DANILO, "[figurinha]", tipo="figurinha", responde_a=AVL)
s = envia_tudo()
confere("figurinha não vira rascunho", ultimo_aviso("rascunho").get("id") == RP.get("id") and any("Só consigo usar texto" in x["texto"] for x in para(s, DANILO)), s)
mid = recebe(DANILO, "[audio]", tipo="audio", responde_a=AVL)
sql(f"select whatsapp_guardar_midia({q({'msg_id': mid, 'erro': 'Áudio sem fala reconhecida.'})})")
s = envia_tudo()
confere("áudio sem transcrição avisa o motivo", any("Não consegui transcrever" in x["texto"] for x in para(s, DANILO)), s)
recebe("5527944443333", "Bom dia, quanto custa uma revisão?")
sql("select whatsapp_resumo_enviar()", "service_role"); envia_tudo()
RESUMO = sql("select f.msg_id from whatsapp_avisos a join whatsapp_fila f on f.id = a.fila_id where a.tipo = 'resumo' order by a.id desc limit 1")[0]
confere("(resumo enviado para citar)", RESUMO != "", RESUMO)
recebe(DANILO, "responde esse aí", responde_a=RESUMO)
s = envia_tudo()
confere("citar o resumo não cria rascunho para outro cliente", ultimo_aviso("rascunho").get("id") == RP.get("id") and any("não é de um cliente" in x["texto"] for x in para(s, DANILO)), s)
js("select whatsapp_assistente_pegar(3)", "service_role")
sql(f"select whatsapp_assistente_resultado({RP['id']}, 'Pode sim, Luiz! Às 9h.', 'claude-haiku-5-5', null, false)", "service_role")
s = envia_tudo(); RS = para(s, DANILO)[-1]["msg_id"]
recebe(DANILO, "ok", responde_a=RS)
s = envia_tudo(); CONF = [x for x in para(s, DANILO) if "Na fila" in x["texto"]]
recebe(DANILO, "obrigado", responde_a=CONF[0]["msg_id"] if CONF else None)
s = envia_tudo()
confere("texto em cima da confirmação não vira mensagem ao cliente", ultimo_aviso("rascunho").get("id") == RP.get("id") and any("responda em cima do aviso" in x["texto"] for x in para(s, DANILO)), s)

# ---------- 26. limite do dia (enfileirar) não conta as internas ----------
sql("update whatsapp_fila set criado_em = now() - interval '2 days' where not interno")
DIA = {**SEMPRE, "por_dia": 2}
sql(f"update whatsapp_conexao set regras = {q(DIA)} where id = 1")
for i in range(5): sql(f"select whatsapp_interno('interna {i}')")
r, _ = js(f"set teste.uid = '{ADM}'; select whatsapp_enfileirar({q({'telefone': JOAO, 'texto': 'Mensagem do limite'})}, false)")
confere("internas não gastam o limite do dia dos clientes", isinstance(r, dict) and not any("Limite do dia" in x for x in r.get("erros", [])), r)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)} where id = 1")
envia_tudo()

# ---------- 27. silêncio decidido na hora de enviar ----------
FECH = {**SEMPRE, "dias": []}
sql(f"update whatsapp_conexao set regras = {q(FECH)}, avisos = avisos || '{{\"silencio_inicio\": \"00:00\", \"silencio_fim\": \"23:59\"}}' where id = 1")
sql("select whatsapp_interno('no silêncio')")
s = envia_tudo()
confere("no silêncio e fora do horário, a interna espera", len(para(s, DANILO)) == 0, s)
sql("update whatsapp_conexao set avisos = avisos || '{\"silencio_inicio\": \"00:00\", \"silencio_fim\": \"00:00\"}' where id = 1")
s = envia_tudo()
confere("fora do silêncio, a mesma interna sai (sem esperar o dia comercial)", len(para(s, DANILO)) == 1, s)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)} where id = 1")

# ---------- 28. velocidade: lote de 200 mensagens com o banco cheio ----------
import time
sql("""insert into clientes (id, nome, telefone) select gen_random_uuid(), 'Cli ' || g, '27999' || lpad(g::text, 6, '0') from generate_series(1, 2500) g;
insert into ordens (numero, cliente, veiculo, status, total) select 5000 + g, jsonb_build_object('nome', 'X', 'telefone', '27998' || lpad(g::text, 6, '0')), '{"placa": "AAA1A11", "modelo": "Gol"}', 'entregue', 100 from generate_series(1, 3000) g;
insert into whatsapp_fila (telefone, texto, origem, status) select '5527997' || lpad(g::text, 6, '0'), 'x', 'claude', 'cancelada' from generate_series(1, 3000) g;
insert into whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, aviso) select 'H' || g, 'x@s.whatsapp.net', '5527996' || lpad((g % 3000)::text, 6, '0'), g % 2 = 0, 'hist', 'antiga' from generate_series(1, 20000) g;
analyze""")
lote = [{"msg_id": f"L{i}", "jid": "x@s.whatsapp.net", "telefone": "552799" + str(i % 2 and 9 or 5) + str(i).zfill(6), "de_mim": False, "texto": "oi", "tipo": "texto"} for i in range(200)]
t0 = time.time(); v, e = sql(f"set statement_timeout = '3s'; select whatsapp_guardar_mensagens({q(lote)})"); dt = time.time() - t0
confere("200 mensagens gravadas em menos de 3 s com 2.500 clientes, 3.000 O.S. e 20 mil mensagens", v.endswith("200") and dt < 3, (round(dt, 2), v, e[:200]))

# ---------- 21. permissões ----------
for f in ("whatsapp_assistente_pegar(3)", "whatsapp_resumo_enviar()", "whatsapp_avisos_minuto()", "whatsapp_interno('x')",
          f"whatsapp_avisos_tratar(1)", "whatsapp_guardar_mensagens('[]')"):
    _, e = sql("select " + f, "authenticated")
    confere("site não chama " + f.split("(")[0], "permission denied" in e, e)
    _, e = sql("select " + f, "anon")
    confere("anônimo não chama " + f.split("(")[0], "permission denied" in e, e)
v, e = sql("select count(*) from whatsapp_avisos", "authenticated")
confere("administrador lê os avisos", v.isdigit() and int(v) > 0, (v, e))
v, e = sql("select count(*) from whatsapp_avisos", "authenticated", "00000000-0000-0000-0000-00000000000b")
confere("consultor não lê os avisos", v == "0", (v, e))
_, e = sql("insert into whatsapp_avisos (tipo) values ('ajuda')", "authenticated")
confere("site não grava avisos", "permission denied" in e, e)

# ---------- 22. agendamentos ----------
v, _ = sql("select string_agg(jobname || '=' || schedule, ',' order by jobname) from cron.job where jobname like 'dtcar-zap-%'")
confere("agendamentos: 1 min e resumo 08h/12h/17h30 (UTC)", "dtcar-zap-avisos=* * * * *" in v and "dtcar-zap-resumo-08h=0 11 * * *" in v
        and "dtcar-zap-resumo-12h=0 15 * * *" in v and "dtcar-zap-resumo-17h30=30 20 * * *" in v and "dtcar-zap-vigia=" in v, v)

for o in ok: print("OK", o)
print("FALHAS", falhas)
print(f"{len(ok)} OK, {len(falhas)} falhas")
