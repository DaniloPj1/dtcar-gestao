-- =====================================================================
-- DTCar Gestão — v49: consulta de notas da SEFAZ NA HORA, às 8h e às 16h de Brasília.
--
-- Problema (visto em 08/11/2026): o robô da SEFAZ roda no GitHub Actions com o agendamento "*/10 * * * *", mas o
-- GitHub atrasa ou pula esses horários. No dia 08/11 rodou só 4 ou 5 vezes, e a consulta das 8h saiu perto das 13h15.
--
-- Decisão do Danilo: continuam só 2 consultas automáticas por dia (8h e 16h). Não mudam os horários nem a espera de
-- 1 hora pedida pela SEFAZ. O robô (worker/sefaz.mjs) continua decidindo SE consulta (ultimoHorario, proxima_consulta,
-- pedido feito na tela). Este SQL só faz o robô RODAR na hora certa:
--   * 8h e 16h (pg_cron, 11h e 19h UTC): o Supabase pede ao GitHub, pelo pg_net, para rodar o workflow sefaz.yml
--     (POST /repos/DaniloPj1/dtcar-gestao/actions/workflows/sefaz.yml/dispatches, ref "main"). O workflow já aceita
--     workflow_dispatch. O agendamento de 10 em 10 minutos do GitHub fica como reserva.
--   * 9h e 17h (vigia, 12h e 20h UTC): se a ultima_consulta da SEFAZ não passou do horário (8h/16h) de hoje, manda
--     um aviso interno ao WhatsApp do Danilo (whatsapp_alerta_na_fila, v32/v36), no máximo um por horário, com o
--     motivo (agendamento não rodou, GitHub recusou o token, robô ainda não rodou, SEFAZ pediu espera, erro do robô).
--
-- Token do GitHub: fica na tabela segredos, chave 'github_actions'. NUNCA no repositório nem neste SQL: o Danilo grava
-- à mão no SQL Editor (token "fine-grained", só deste repositório, só com Actions: Read and write):
--   insert into public.segredos (chave, valor) values ('github_actions', '<cole o token aqui>')
--   on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
-- Sem token gravado: o pedido das 8h/16h e o vigia não fazem nada e não dão erro (o robô segue só pelo agendamento
-- do GitHub, como antes do v49). Busca de notas desligada na tela (sefaz_config.ativo = false): também não fazem nada.
--
-- Tabela sefaz_disparos: registro de cada pedido ao GitHub e de cada aviso (log operacional, como contas_avisos e
-- backup_execucoes): fora do backup, do banco do PC e do espelho — não é dado da oficina e não precisa voltar numa
-- restauração. Igual antes e depois da virada.
--
-- Teste manual (só no SQL Editor; as funções não ficam abertas para o site):
--   select public.sefaz_disparar(8);   -- pede ao GitHub para rodar o robô agora (não repete se o das 8h de hoje já foi)
--   select public.sefaz_vigiar(8);     -- confere a consulta das 8h de hoje (avisa no máximo uma vez)
--   select * from public.sefaz_disparos order by dia desc, horario desc;
-- Rode depois do v36. Pode rodar mais de uma vez.
-- =====================================================================

-- pg_net e pg_cron já foram ligados no v32/v35.

create table if not exists public.sefaz_disparos (
  dia date not null,                                   -- dia em Brasília
  horario int not null check (horario in (8, 16)),     -- horário da consulta automática (Brasília)
  situacao text not null default 'chamado' check (situacao in ('chamado', 'erro')),
  pedido_id bigint,                                    -- id do pedido no pg_net (net._http_response)
  chamado_em timestamptz,
  resposta text not null default '',                   -- o que o GitHub respondeu (lido pelo vigia)
  aviso_em timestamptz,                                -- quando o vigia avisou (um aviso por horário)
  aviso_fila bigint,                                   -- id da mensagem na fila do WhatsApp
  aviso_texto text not null default '',
  aviso_motivo text not null default '',               -- por que o aviso não entrou na fila, se não entrou
  primary key (dia, horario)
);
alter table public.sefaz_disparos enable row level security;
drop policy if exists sefaz_disparos_ler on public.sefaz_disparos;
create policy sefaz_disparos_ler on public.sefaz_disparos for select to authenticated using (public.e_admin());
revoke insert, update, delete on public.sefaz_disparos from anon, authenticated;

-- Token do GitHub gravado em segredos (null = não gravado)
create or replace function public.sefaz_token_github() returns text
language sql stable security definer set search_path = public as $$
  select nullif(btrim(valor), '') from public.segredos where chave = 'github_actions'
$$;

-- Pede ao GitHub para rodar o robô da SEFAZ (workflow sefaz.yml). Chamada pelo pg_cron às 8h e às 16h.
create or replace function public.sefaz_disparar(p_horario int, p_agora timestamptz default now()) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_token text := public.sefaz_token_github();
  v_dia date := (p_agora at time zone 'America/Sao_Paulo')::date;
  v_ativo boolean; v_id bigint; v_ant public.sefaz_disparos;
begin
  if p_horario not in (8, 16) then raise exception 'Horário inválido: %', p_horario; end if;
  -- sem token: não faz nada (o agendamento do GitHub continua de reserva)
  if v_token is null then return jsonb_build_object('acao', 'sem_token'); end if;
  select ativo into v_ativo from public.sefaz_config where id = 1;
  if not coalesce(v_ativo, false) then return jsonb_build_object('acao', 'desligado'); end if;
  -- um pedido por horário por dia (agendamento + teste manual ao mesmo tempo não pedem duas vezes)
  perform pg_advisory_xact_lock(hashtext('dtcar-sefaz-disparar'));
  select * into v_ant from public.sefaz_disparos where dia = v_dia and horario = p_horario;
  if v_ant.situacao = 'chamado' then return jsonb_build_object('acao', 'ja_chamado', 'pedido_id', v_ant.pedido_id); end if;
  begin
    v_id := net.http_post(
      url := 'https://api.github.com/repos/DaniloPj1/dtcar-gestao/actions/workflows/sefaz.yml/dispatches',
      body := '{"ref":"main"}'::jsonb,
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || v_token,
        'Accept', 'application/vnd.github+json',
        'X-GitHub-Api-Version', '2022-11-28',
        'User-Agent', 'dtcar-gestao-sefaz',
        'Content-Type', 'application/json'),
      timeout_milliseconds := 15000);
  exception when others then
    insert into public.sefaz_disparos (dia, horario, situacao, chamado_em, resposta)
    values (v_dia, p_horario, 'erro', p_agora, 'Não foi possível chamar o GitHub: ' || left(sqlerrm, 200))
    on conflict (dia, horario) do update set situacao = 'erro', chamado_em = excluded.chamado_em, resposta = excluded.resposta;
    return jsonb_build_object('acao', 'erro', 'erro', sqlerrm);
  end;
  insert into public.sefaz_disparos (dia, horario, situacao, pedido_id, chamado_em)
  values (v_dia, p_horario, 'chamado', v_id, p_agora)
  on conflict (dia, horario) do update set situacao = 'chamado', pedido_id = excluded.pedido_id, chamado_em = excluded.chamado_em, resposta = '';
  return jsonb_build_object('acao', 'chamado', 'pedido_id', v_id);
end $$;

-- O que o GitHub respondeu ao pedido (pg_net guarda as respostas por algumas horas em net._http_response).
-- '' = aceito (204). Outro texto = motivo da recusa ou da falha.
create or replace function public.sefaz_resposta_github(p_pedido_id bigint) returns text
language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  if p_pedido_id is null then return 'o pedido ao GitHub não foi feito'; end if;
  select status_code, content, error_msg, timed_out into r from net._http_response where id = p_pedido_id;
  if not found then return 'o GitHub não respondeu ao pedido (sem resposta registrada)'; end if;
  if r.status_code = 204 then return ''; end if;
  if r.status_code is null then
    return 'falha ao chamar o GitHub' || case when coalesce(r.timed_out, false) then ' (tempo esgotado)' else '' end
           || coalesce(': ' || left(nullif(r.error_msg, ''), 200), '');
  end if;
  if r.status_code = 401 then
    return 'o GitHub recusou o token (401): ele venceu ou foi apagado. Crie um token novo e grave em segredos (github_actions)';
  end if;
  if r.status_code in (403, 404) then
    return 'o GitHub recusou o pedido (' || r.status_code || '): o token não tem a permissão "Actions: Read and write" deste repositório';
  end if;
  return 'o GitHub respondeu ' || r.status_code || coalesce(': ' || left(nullif(r.content, ''), 200), '');
end $$;

-- Vigia (9h e 17h): a consulta do horário saiu? Se não, avisa o Danilo no WhatsApp, uma vez por horário.
create or replace function public.sefaz_vigiar(p_horario int, p_agora timestamptz default now()) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_dia date := (p_agora at time zone 'America/Sao_Paulo')::date;
  v_marco timestamptz; c public.sefaz_config; d public.sefaz_disparos; v_resp text; v_motivo text; v_txt text;
  v_fila bigint; v_falha text := '';
begin
  if p_horario not in (8, 16) then raise exception 'Horário inválido: %', p_horario; end if;
  if public.sefaz_token_github() is null then return jsonb_build_object('acao', 'sem_token'); end if;
  select * into c from public.sefaz_config where id = 1;
  if not coalesce(c.ativo, false) then return jsonb_build_object('acao', 'desligado'); end if;
  v_marco := (v_dia + make_interval(hours => p_horario))::timestamp at time zone 'America/Sao_Paulo';
  if c.ultima_consulta >= v_marco then return jsonb_build_object('acao', 'ok', 'ultima_consulta', c.ultima_consulta); end if;
  perform pg_advisory_xact_lock(hashtext('dtcar-sefaz-disparar'));
  select * into d from public.sefaz_disparos where dia = v_dia and horario = p_horario;
  if d.aviso_em is not null then return jsonb_build_object('acao', 'ja_avisado'); end if;

  -- motivo
  if d.dia is null then
    v_motivo := 'o agendamento das ' || p_horario || 'h não rodou (não houve pedido ao GitHub).';
  elsif d.situacao = 'erro' then
    v_motivo := d.resposta || '.';
  else
    v_resp := public.sefaz_resposta_github(d.pedido_id);
    if v_resp <> '' then
      v_motivo := v_resp || '.';
    elsif c.proxima_consulta > v_marco then
      v_motivo := 'o GitHub rodou o robô, mas a SEFAZ pediu espera até '
                  || to_char(c.proxima_consulta at time zone 'America/Sao_Paulo', 'HH24:MI')
                  || ' (consulta feita pouco antes). A consulta sai no próximo giro do robô depois disso.';
    elsif c.worker_em >= v_marco and coalesce(c.worker_erro, '') <> '' then
      v_motivo := 'o robô rodou, mas deu erro: ' || left(c.worker_erro, 200) || '.';
    elsif c.worker_em >= v_marco and coalesce(c.ultimo_erro, '') <> '' then
      v_motivo := 'o robô rodou, mas a consulta falhou: ' || left(c.ultimo_erro, 200) || '.';
    elsif c.worker_em is null or c.worker_em < v_marco then
      v_motivo := 'o GitHub aceitou o pedido, mas o robô ainda não rodou (fila do GitHub).';
    else
      v_motivo := 'o robô rodou, mas não fez a consulta.';
    end if;
  end if;
  v_txt := '⚠️ DTCar Gestão: a consulta de notas da SEFAZ das ' || p_horario || 'h não saiu até as ' || (p_horario + 1) || 'h. '
           || 'Motivo: ' || v_motivo
           || ' Dá para pedir em Financeiro › Notas da SEFAZ › Consultar agora.';
  begin
    v_fila := public.whatsapp_alerta_na_fila(v_txt);
    if v_fila is null then v_falha := 'sem número de alerta cadastrado no WhatsApp (Sistema › WhatsApp)'; end if;
  exception when undefined_function then v_fila := null; v_falha := 'sem o v32 (aviso no WhatsApp)';
            when others then v_fila := null; v_falha := 'aviso no WhatsApp falhou: ' || left(sqlerrm, 200);
  end;
  insert into public.sefaz_disparos (dia, horario, situacao, resposta, aviso_em, aviso_fila, aviso_texto, aviso_motivo)
  values (v_dia, p_horario, 'erro', 'agendamento não rodou', p_agora, v_fila, v_txt, v_falha)
  on conflict (dia, horario) do update set
    resposta = case when sefaz_disparos.resposta = '' then coalesce(v_resp, '') else sefaz_disparos.resposta end,
    aviso_em = excluded.aviso_em, aviso_fila = excluded.aviso_fila, aviso_texto = excluded.aviso_texto, aviso_motivo = excluded.aviso_motivo;
  return jsonb_build_object('acao', 'avisado', 'fila', v_fila, 'motivo', v_motivo, 'falha_aviso', nullif(v_falha, ''));
end $$;

-- Só o agendamento (e o SQL Editor) chamam: nada aberto para o site nem para o agente.
revoke all on function public.sefaz_token_github() from public, anon, authenticated;
revoke all on function public.sefaz_disparar(int, timestamptz) from public, anon, authenticated;
revoke all on function public.sefaz_resposta_github(bigint) from public, anon, authenticated;
revoke all on function public.sefaz_vigiar(int, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Agendamentos (pg_cron em UTC; Brasília = UTC−3, sem horário de verão). Refaz se já existirem.
--   dtcar-sefaz-08h        '0 11 * * *'  pede ao GitHub o robô das 8h
--   dtcar-sefaz-16h        '0 19 * * *'  pede ao GitHub o robô das 16h
--   dtcar-sefaz-vigia-09h  '0 12 * * *'  confere a consulta das 8h
--   dtcar-sefaz-vigia-17h  '0 20 * * *'  confere a consulta das 16h
-- ---------------------------------------------------------------------
do $$ begin
  perform cron.unschedule(jobname) from cron.job
   where jobname in ('dtcar-sefaz-08h', 'dtcar-sefaz-16h', 'dtcar-sefaz-vigia-09h', 'dtcar-sefaz-vigia-17h');
end $$;
select cron.schedule('dtcar-sefaz-08h', '0 11 * * *', $cron$ select public.sefaz_disparar(8) $cron$);
select cron.schedule('dtcar-sefaz-16h', '0 19 * * *', $cron$ select public.sefaz_disparar(16) $cron$);
select cron.schedule('dtcar-sefaz-vigia-09h', '0 12 * * *', $cron$ select public.sefaz_vigiar(8) $cron$);
select cron.schedule('dtcar-sefaz-vigia-17h', '0 20 * * *', $cron$ select public.sefaz_vigiar(16) $cron$);

notify pgrst, 'reload schema';
