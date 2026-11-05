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
    sql("select whatsapp_avisos_processar(50)")  # quem grava (motor/zap) pede o tratamento logo depois
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
    sql("select whatsapp_avisos_processar(50)")  # agendamento de 1 min / próxima chamada do motor
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
    js("select whatsapp_assistente_pegar(3)", "service_role")
    sql(f"select whatsapp_assistente_resultado({RF}, null, null, 'HTTP 529', false)", "service_role")
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
sql("select whatsapp_avisos_processar(50)")
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

# ---------- 19b. OK citando mensagem que não é aviso/rascunho: não aprova o rascunho de ninguém (Codex P1) ----------
sql("update whatsapp_avisos set criado_em = now() - interval '1 hour'")
recebe(LUIZ, "Pode ser sexta de manhã?")
s = envia_tudo(); AV = para(s, DANILO)[-1]["msg_id"] if para(s, DANILO) else None
recebe(DANILO, "sexta 8h ok", responde_a=AV)
RX = ultimo_aviso("rascunho")["id"]; js("select whatsapp_assistente_pegar(3)", "service_role")
sql(f"select whatsapp_assistente_resultado({RX}, 'Sexta às 8h está ótimo!', 'claude-haiku-5-5', null, false)", "service_role")
s = envia_tudo()
recebe(DANILO, "ok", responde_a="MENSAGEM-QUALQUER-DA-OFICINA")
s = envia_tudo(); v, _ = sql(f"select situacao from whatsapp_avisos where id = {RX}")
confere("OK em cima de mensagem desconhecida não envia ao cliente", len(para(s, LUIZ)) == 0 and v == "aguardando_ok", (v, s))
confere("OK em cima de mensagem desconhecida explica", any("Nada foi enviado" in x["texto"] and "só vale em cima do *rascunho*" in x["texto"] for x in para(s, DANILO)), s)
sql(f"update whatsapp_avisos set situacao = 'cancelado' where id = {RX}")

# ---------- 19c. número de alerta com PARAR: interna também não sai (Codex P1) ----------
sql(f"insert into whatsapp_optout (telefone) values (whatsapp_chave_tel('{DANILO}')) on conflict do nothing")
iid, _ = sql("select whatsapp_interno('teste interno com PARAR')")
s = envia_tudo(); v, _ = sql(f"select status from whatsapp_fila where id = {iid}")
confere("interna para número com PARAR: cancelada, não sai", len(para(s, DANILO)) == 0 and v == "cancelada", (v, s))
sql(f"delete from whatsapp_optout where telefone = whatsapp_chave_tel('{DANILO}')")

# ---------- 19d. silêncio conferido na retirada (Codex P2) ----------
sql(f"update whatsapp_conexao set regras = {q({**SEMPRE, 'dias': []})} where id = 1")
iid, _ = sql("select whatsapp_interno('aviso antes do silêncio')")
v, _ = sql(f"select fora_horario from whatsapp_fila where id = {iid}")
confere("interna criada fora do silêncio: liberada fora do horário", v == "t", v)
sql("update whatsapp_conexao set avisos = avisos || '{\"silencio_inicio\": \"00:00\", \"silencio_fim\": \"23:59\"}' where id = 1")
s = envia_tudo(); v, _ = sql(f"select status from whatsapp_fila where id = {iid}")
confere("entrou no silêncio antes de sair: espera", v == "pendente" and len(para(s, DANILO)) == 0, (v, s))
sql("update whatsapp_conexao set avisos = avisos || '{\"silencio_inicio\": \"00:00\", \"silencio_fim\": \"00:00\"}' where id = 1")
s = envia_tudo(); v, _ = sql(f"select status from whatsapp_fila where id = {iid}")
confere("fora do silêncio: sai", v == "enviada", v)
sql(f"update whatsapp_conexao set regras = {q(SEMPRE)} where id = 1")

# ---------- 19e. texto longo sem IA: o rascunho mostra exatamente o que vai com o OK (Codex P2) ----------
sql("update whatsapp_avisos set criado_em = now() - interval '1 hour'")
recebe(LUIZ, "Pode detalhar o orçamento?")
s = envia_tudo(); AV = para(s, DANILO)[-1]["msg_id"] if para(s, DANILO) else None
LONGO = ("Explicação longa do serviço. " * 70)[:1900] + "FIM-OCULTO"
recebe(DANILO, LONGO, responde_a=AV)
RL = ultimo_aviso("rascunho")["id"]
sql(f"select whatsapp_assistente_resultado({RL}, null, null, 'sem chave', true)", "service_role")
s = envia_tudo(); rr = [x for x in para(s, DANILO) if "Rascunho" in x["texto"]]
prop, _ = sql(f"select proposta from whatsapp_avisos where id = {RL}")
confere("texto longo: o rascunho mostra a proposta inteira e avisa do corte", len(rr) == 1 and prop in rr[0]["texto"] and "Texto longo" in rr[0]["texto"] and len(rr[0]["texto"]) <= 2000 and "FIM-OCULTO" not in prop, (len(prop), len(rr[0]["texto"]) if rr else None))
recebe(DANILO, "ok", responde_a=rr[0]["msg_id"] if rr else None)
s = envia_tudo(); enviado = para(s, LUIZ)
confere("texto longo: com o OK vai exatamente o que foi mostrado", len(enviado) == 1 and enviado[0]["texto"] == prop, len(enviado[0]["texto"]) if enviado else None)

# ---------- 19f. revisão independente: OK só vale EM CIMA do rascunho ----------
def novo_rascunho(texto_cli, texto_dan, proposta, mandar=True):
    sql("update whatsapp_avisos set criado_em = now() - interval '1 hour'")
    sql("update whatsapp_avisos set situacao = 'cancelado' where tipo = 'rascunho' and situacao = 'aguardando_ok'")
    recebe(LUIZ, texto_cli)
    s = envia_tudo(); av = para(s, DANILO)[-1]["msg_id"] if para(s, DANILO) else None
    recebe(DANILO, texto_dan, responde_a=av)
    rid = ultimo_aviso("rascunho")["id"]; js("select whatsapp_assistente_pegar(3)", "service_role")
    sql(f"select whatsapp_assistente_resultado({rid}, '{proposta}', 'claude-haiku-5-5', null, false)", "service_role")
    rmsg = None
    if mandar:
        s = envia_tudo(); r = [x for x in para(s, DANILO) if "Rascunho" in x["texto"]]; rmsg = r[-1]["msg_id"] if r else None
    return rid, av, rmsg
# A) rascunho ainda na fila (Danilo não viu): "ok" solto não envia
rid, av, _ = novo_rascunho("Quanto ficou?", "fala o valor", "O valor ficou R$ 9.999", mandar=False)
sql("update whatsapp_avisos set criado_em = now() where id = " + str(rid))
recebe(DANILO, "ok")
s = envia_tudo(); v, _ = sql(f"select situacao from whatsapp_avisos where id = {rid}")
confere("A: ok solto com rascunho ainda não visto não envia", len(para(s, LUIZ)) == 0 and v == "aguardando_ok", (v, [x["texto"][:40] for x in s]))
# B) ok em cima do AVISO (não do rascunho): não envia o rascunho pendente
recebe(DANILO, "ok", responde_a=av)
s = envia_tudo(); v, _ = sql(f"select situacao from whatsapp_avisos where id = {rid}")
confere("B: ok em cima do aviso não envia o rascunho", len(para(s, LUIZ)) == 0 and v == "aguardando_ok", v)
# C) "agora" solto não libera nada
recebe(DANILO, "agora")
s = envia_tudo(); confere("C: agora solto não envia", len(para(s, LUIZ)) == 0, s)
# D) ok em cima do rascunho: envia (o caminho certo continua)
rid, av, rmsg = novo_rascunho("Posso buscar hoje?", "pode sim", "Pode sim, está pronto!")
recebe(DANILO, "ok", responde_a=rmsg)
s = envia_tudo(); confere("D: ok em cima do rascunho envia", len(para(s, LUIZ)) == 1 and para(s, LUIZ)[0]["texto"] == "Pode sim, está pronto!", s)
# E) corrida: rascunho cancelado antes do OK ser processado
rid, av, rmsg = novo_rascunho("E o filtro?", "trocamos", "Trocamos o filtro.")
sql(f"update whatsapp_avisos set situacao = 'cancelado' where id = {rid}")
r, _ = js(f"select whatsapp_assistente_enviar({rid}, false)")
confere("E: OK em rascunho já cancelado é recusado", isinstance(r, dict) and "erro" in r, r)
# F) número estrangeiro com os mesmos dígitos finais do Danilo não é o Danilo
ESTR = "27797696545"
v, _ = sql(f"select whatsapp_chave_tel('{ESTR}') = whatsapp_chave_tel('{DANILO}')")
mid = recebe(ESTR, "ok")
v2, _ = sql(f"select aviso from whatsapp_mensagens where msg_id = '{mid}'")
confere("F: número estrangeiro com a mesma chave não vira comando", v2 != "comando", (v, v2))
v3, _ = sql(f"select whatsapp_e_alerta('552797696545') || ',' || whatsapp_e_alerta('{DANILO}') || ',' || whatsapp_e_alerta('{ESTR}')")
confere("F: alerta com e sem o 9 vale; estrangeiro não", v3 == "true,true,false", v3)
# G) gravar recebidas não trata na hora (o insert nunca depende dos avisos)
sql(f"select whatsapp_guardar_mensagens({q([{'msg_id': 'G-SEM-TRATAR', 'jid': LUIZ + '@s.whatsapp.net', 'telefone': LUIZ, 'texto': 'oi', 'tipo': 'texto'}])})")
v, _ = sql("select coalesce(aviso, 'nulo') from whatsapp_mensagens where msg_id = 'G-SEM-TRATAR'")
confere("G: gravar não trata (fica para a chamada seguinte)", v == "nulo", v)
v, _ = sql("select whatsapp_avisos_processar(5) > 0")
v2, _ = sql("select coalesce(aviso, 'nulo') from whatsapp_mensagens where msg_id = 'G-SEM-TRATAR'")
confere("G: whatsapp_avisos_processar trata depois", v == "t" and v2 != "nulo", (v, v2))
v, e = sql("select has_function_privilege('anon', 'public.whatsapp_motor_avisos(text)', 'execute') || ',' || has_function_privilege('anon', 'public.whatsapp_avisos_processar(int)', 'execute')")
confere("G: motor chama o tratamento só com a chave; processar fechado", v == "true,false", v)
_, e = sql("select whatsapp_motor_avisos('chave-errada-chave-errada-chave-errada-chave-errada')", "anon")
confere("G: chave errada recusada", "inválida" in e, e[-120:])

# ---------- 19g. rodar o v36 de novo não apaga as pendências (Codex P1) ----------
sql(f"select whatsapp_guardar_mensagens({q([{'msg_id': 'PEND-REAPLICA', 'jid': LUIZ + '@s.whatsapp.net', 'telefone': LUIZ, 'texto': 'pendente', 'tipo': 'texto'}])})")
r = roda("supabase/v36.sql"); v, _ = sql("select coalesce(aviso, 'nulo') from whatsapp_mensagens where msg_id = 'PEND-REAPLICA'")
confere("v36 de novo: pendente continua pendente", r.returncode == 0 and v == "nulo", (r.returncode, v, r.stderr[-200:]))
sql("select whatsapp_avisos_processar(50)")

# ---------- 20. erro no tratamento não impede gravar a mensagem ----------
sql("alter table whatsapp_avisos rename to whatsapp_avisos_x")
mid = recebe(JOAO, "mensagem com erro no aviso")
v, _ = sql(f"select aviso || '|' || coalesce(aviso_erro, '') from whatsapp_mensagens where msg_id = '{mid}'")
confere("erro no aviso: mensagem gravada e marcada", v.startswith("erro|"), v)
sql("alter table whatsapp_avisos_x rename to whatsapp_avisos")

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
