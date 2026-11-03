-- =====================================================================
-- DTCar Gestão — v25: WhatsApp, etapa 3 — fila de envio, mensagens e regras contra bloqueio.
--
-- O Claude (pelo conector, com ordem do Danilo) e a tela colocam mensagens na FILA. Quem está
-- com a vez da conexão (motor do Android ou, sem ele, a função "zap" do Supabase) pega a próxima
-- mensagem liberada pelas regras e envia. Mensagens recebidas ficam guardadas para o Claude ler.
--
-- Regras contra bloqueio (whatsapp_conexao.regras, ajustáveis):
--   * só em horário comercial (seg–sex 08h–18h, sáb 08h–12h); fora dele só com "fora_horario"
--     (ordem do Danilo);
--   * intervalo aleatório entre envios (25–70 s) e limites por hora (20) e por dia (80);
--   * só para telefone de CLIENTE CADASTRADO; nada de link encurtado; mensagem igual para o mesmo
--     número em 10 min é recusada;
--   * quem responder PARAR (ou SAIR) não recebe mais mensagens (whatsapp_optout).
--
-- Tabelas novas: whatsapp_fila, whatsapp_mensagens, whatsapp_optout. Só o administrador lê
-- (tela e conector); gravação só pelas funções abaixo. Ficam FORA do backup e do espelho do
-- sistema antigo (não são O.S., cadastro, dinheiro nem estoque). LGPD: guardam texto das conversas
-- com clientes; mídia não é guardada (só o tipo).
--
-- Rode depois do v24. Pode rodar mais de uma vez.
-- =====================================================================

alter table public.whatsapp_conexao add column if not exists regras jsonb not null default
  '{"inicio": "08:00", "fim": "18:00", "sabado_fim": "12:00", "dias": [1, 2, 3, 4, 5, 6],
    "intervalo_min": 25, "intervalo_max": 70, "por_hora": 20, "por_dia": 80}'::jsonb;
alter table public.whatsapp_conexao add column if not exists proximo_envio timestamptz;  -- intervalo entre envios
grant select (regras, proximo_envio) on public.whatsapp_conexao to authenticated;

create table if not exists public.whatsapp_fila (
  id bigint generated always as identity primary key,
  telefone text not null,                       -- 55 + DDD + número
  texto text not null check (length(texto) between 1 and 2000),
  cliente_id uuid,                              -- sem chave estrangeira: o espelho recarrega clientes
  cliente_nome text not null default '',
  ordem_numero int,
  origem text not null default 'claude' check (origem in ('claude', 'tela')),
  pedido_por text not null default '',
  fora_horario boolean not null default false,  -- liberada fora do horário comercial (ordem do Danilo)
  status text not null default 'pendente' check (status in ('pendente', 'enviando', 'enviada', 'erro', 'cancelada')),
  erro text,
  msg_id text,
  criado_em timestamptz not null default now(),
  pego_em timestamptz,
  pego_por text,
  enviada_em timestamptz
);
create index if not exists whatsapp_fila_status on public.whatsapp_fila (status, id);

create table if not exists public.whatsapp_mensagens (
  id bigint generated always as identity primary key,
  msg_id text unique,
  jid text not null,
  telefone text not null default '',            -- só dígitos (pode faltar o 9 em números antigos)
  nome text not null default '',                -- nome do perfil no WhatsApp
  de_mim boolean not null default false,
  texto text not null default '',
  tipo text not null default 'texto',
  em timestamptz not null default now(),
  fila_id bigint,
  lida boolean not null default false,          -- já lida pelo Claude/tela
  gravada_em timestamptz not null default now()
);
create index if not exists whatsapp_mensagens_tel on public.whatsapp_mensagens (right(telefone, 8), em desc);
create index if not exists whatsapp_mensagens_em on public.whatsapp_mensagens (em desc);

create table if not exists public.whatsapp_optout (
  telefone text primary key,                    -- últimos 8 dígitos + DDD quando houver (ver whatsapp_chave_tel)
  em timestamptz not null default now(),
  texto text not null default ''
);

do $$ declare t text; begin
  foreach t in array array['whatsapp_fila', 'whatsapp_mensagens', 'whatsapp_optout'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.e_admin())', t || '_ler', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
      execute format('revoke all on public.%I from agente_leitura', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Auxiliares
-- ---------------------------------------------------------------------
-- chave de comparação de telefone: DDD + últimos 8 dígitos (o 9 do celular às vezes falta no WhatsApp)
create or replace function public.whatsapp_chave_tel(p text) returns text language sql immutable as $$
  select case when length(d) >= 10 then substr(d, length(d) - case when length(d) in (11, 13) then 10 else 9 end, 2) || right(d, 8)
              else right(d, 8) end
    from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') d) x
$$;

-- dentro do horário de envio agora? (horário de Brasília)
create or replace function public.whatsapp_no_horario(r jsonb, p_quando timestamptz default now()) returns boolean
language sql stable as $$
  select extract(isodow from l) = any (select jsonb_array_elements_text(coalesce(r -> 'dias', '[1,2,3,4,5,6]'))::int)
     and l::time >= coalesce(r ->> 'inicio', '08:00')::time
     and l::time < case when extract(isodow from l) = 6 then coalesce(r ->> 'sabado_fim', r ->> 'fim', '12:00')
                        else coalesce(r ->> 'fim', '18:00') end::time
    from (select p_quando at time zone 'America/Sao_Paulo' l) x
$$;

-- ---------------------------------------------------------------------
-- Pôr na fila (Claude pelo conector, ou tela). Só administrador. p_gravar=false: só confere (prévia).
-- p: {telefone?, cliente_id?, ordem_numero?, texto, fora_horario?, origem?, pedido?}
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_enfileirar(p jsonb, p_gravar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_txt text := btrim(coalesce(p ->> 'texto', ''));
  v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
  v_cli public.clientes; v_os public.ordens; v_r jsonb; v_erros text[] := '{}'; v_avisos text[] := '{}';
  v_id bigint; v_fora boolean := coalesce((p ->> 'fora_horario')::boolean, false); v_hoje int;
begin
  if not public.e_admin() then raise exception 'Só o administrador envia WhatsApp.'; end if;
  select regras into v_r from public.whatsapp_conexao where id = 1;
  if nullif(p ->> 'ordem_numero', '') is not null then
    select * into v_os from public.ordens where numero = (p ->> 'ordem_numero')::int;
    if v_os.id is null then v_erros := v_erros || ('O.S. ' || (p ->> 'ordem_numero') || ' não encontrada.'); end if;
  end if;
  if nullif(p ->> 'cliente_id', '') is not null then
    select * into v_cli from public.clientes where id = (p ->> 'cliente_id')::uuid;
  elsif v_os.cliente_id is not null then
    select * into v_cli from public.clientes where id = v_os.cliente_id;
  end if;
  if v_tel = '' and v_cli.id is not null then v_tel := regexp_replace(coalesce(nullif(v_cli.telefone, ''), v_cli.telefone2, ''), '\D', '', 'g'); end if;
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel !~ '^55\d{10,11}$' then v_erros := v_erros || 'Telefone inválido: use DDD + número (ex.: 27 99999-0000).'::text; end if;
  -- só cliente cadastrado com esse telefone
  if v_cli.id is null and v_tel ~ '^55\d{10,11}$' then
    select * into v_cli from public.clientes c
     where public.whatsapp_chave_tel(v_tel) in (public.whatsapp_chave_tel(c.telefone), public.whatsapp_chave_tel(c.telefone2), public.whatsapp_chave_tel(c.telefone3))
       and coalesce(c.telefone, '') || coalesce(c.telefone2, '') || coalesce(c.telefone3, '') <> ''
     order by c.atualizado_em desc nulls last limit 1;
  end if;
  if v_cli.id is null then v_erros := v_erros || 'Telefone não pertence a nenhum cliente cadastrado: só envio para cliente cadastrado.'::text;
  elsif v_tel ~ '^55\d{10,11}$' and public.whatsapp_chave_tel(v_tel) not in (public.whatsapp_chave_tel(v_cli.telefone), public.whatsapp_chave_tel(v_cli.telefone2), public.whatsapp_chave_tel(v_cli.telefone3)) then
    v_erros := v_erros || ('O telefone não é do cliente ' || v_cli.nome || '.');
  end if;
  if v_txt = '' then v_erros := v_erros || 'Mensagem vazia.'::text; end if;
  if length(v_txt) > 2000 then v_erros := v_erros || 'Mensagem longa demais (máximo 2000 caracteres).'::text; end if;
  if v_txt ~* '(bit\.ly|tinyurl|cutt\.ly|goo\.gl|t\.co/|is\.gd|ow\.ly|encurtador|rebrand\.ly|shorturl)' then
    v_erros := v_erros || 'Sem link encurtado: use o endereço completo.'::text;
  end if;
  if exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(v_tel)) then
    v_erros := v_erros || 'Este cliente pediu para não receber mensagens (respondeu PARAR).'::text;
  end if;
  if exists (select 1 from public.whatsapp_fila f where public.whatsapp_chave_tel(f.telefone) = public.whatsapp_chave_tel(v_tel) and f.texto = v_txt
              and f.status in ('pendente', 'enviando', 'enviada') and f.criado_em > now() - interval '10 minutes') then
    v_erros := v_erros || 'Esta mesma mensagem para este número já está na fila ou foi enviada há menos de 10 minutos.'::text;
  end if;
  select count(*) into v_hoje from public.whatsapp_fila
   where status in ('pendente', 'enviando', 'enviada') and criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_hoje >= coalesce((v_r ->> 'por_dia')::int, 80) then v_erros := v_erros || ('Limite do dia atingido (' || v_hoje || ' mensagens).'); end if;
  if not public.whatsapp_no_horario(v_r) and not v_fora then
    v_avisos := v_avisos || 'Fora do horário comercial: a mensagem sai no próximo horário de envio (para mandar agora, só com ordem do Danilo: fora_horario).'::text;
  end if;
  if (select situacao from public.whatsapp_conexao where id = 1) <> 'conectado' then
    v_avisos := v_avisos || 'O WhatsApp da oficina não está conectado agora: a mensagem fica na fila até conectar.'::text;
  end if;

  if array_length(v_erros, 1) > 0 or not p_gravar then
    return jsonb_build_object('gravado', false, 'erros', to_jsonb(v_erros), 'avisos', to_jsonb(v_avisos),
      'telefone', v_tel, 'cliente', jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome), 'ordem_numero', v_os.numero, 'texto', v_txt,
      'pendentes_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente'));
  end if;
  insert into public.whatsapp_fila (telefone, texto, cliente_id, cliente_nome, ordem_numero, origem, pedido_por, fora_horario)
  values (v_tel, v_txt, v_cli.id, coalesce(v_cli.nome, ''), v_os.numero, coalesce(nullif(p ->> 'origem', ''), 'claude'),
          left(coalesce(p ->> 'pedido', ''), 300), v_fora)
  returning id into v_id;
  return jsonb_build_object('gravado', true, 'id', v_id, 'avisos', to_jsonb(v_avisos), 'telefone', v_tel,
    'cliente', jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome), 'ordem_numero', v_os.numero,
    'posicao_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente' and id <= v_id));
end $$;

create or replace function public.whatsapp_cancelar(p_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_fila;
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe na fila do WhatsApp.'; end if;
  update public.whatsapp_fila set status = 'cancelada', erro = 'Cancelada pelo administrador.' where id = p_id and status = 'pendente' returning * into v;
  if v.id is null then raise exception 'Só dá para cancelar mensagem que ainda não saiu (pendente).'; end if;
  return to_jsonb(v);
end $$;

-- ---------------------------------------------------------------------
-- Envio: quem está com a vez pega a próxima mensagem liberada pelas regras
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_pegar_proxima(p_dono text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_conexao; v public.whatsapp_fila; v_hora int; v_dia int; v_no boolean;
begin
  select * into c from public.whatsapp_conexao where id = 1 for update;
  if not (c.dono = p_dono and c.dono_id = p_id and c.dono_ate > now()) then return jsonb_build_object('motivo', 'sem a vez'); end if;
  -- "enviando" esquecida (quem pegou caiu no meio): não reenvia sozinho — pode ter saído. Marca para conferir.
  update public.whatsapp_fila set status = 'erro', erro = 'Envio não confirmado (a conexão caiu no meio). Confira no WhatsApp antes de mandar de novo.'
   where status = 'enviando' and pego_em < now() - interval '5 minutes';
  if c.proximo_envio is not null and c.proximo_envio > now() then
    return jsonb_build_object('motivo', 'intervalo', 'proximo_envio', c.proximo_envio);
  end if;
  select count(*) filter (where enviada_em > now() - interval '1 hour'),
         count(*) filter (where enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    into v_hora, v_dia from public.whatsapp_fila where status = 'enviada' and enviada_em > now() - interval '1 day';
  if v_hora >= coalesce((c.regras ->> 'por_hora')::int, 20) then return jsonb_build_object('motivo', 'limite por hora'); end if;
  if v_dia >= coalesce((c.regras ->> 'por_dia')::int, 80) then return jsonb_build_object('motivo', 'limite do dia'); end if;
  -- pendente de quem pediu PARAR depois de entrar na fila: não sai
  update public.whatsapp_fila f set status = 'cancelada', erro = 'O cliente pediu para não receber mensagens (PARAR).'
   where f.status = 'pendente' and exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(f.telefone));
  v_no := public.whatsapp_no_horario(c.regras);
  select * into v from public.whatsapp_fila
   where status = 'pendente' and (v_no or fora_horario)
   order by id limit 1 for update skip locked;
  if v.id is null then return jsonb_build_object('motivo', case when v_no then 'fila vazia' else 'fora do horário' end); end if;
  update public.whatsapp_fila set status = 'enviando', pego_em = now(), pego_por = p_dono where id = v.id;
  return jsonb_build_object('mensagem', jsonb_build_object('id', v.id, 'telefone', v.telefone, 'texto', v.texto));
end $$;

-- resultado do envio: grava, registra na conversa e marca o próximo horário possível (intervalo aleatório)
create or replace function public.whatsapp_resultado(p_dono text, p_id text, p_fila_id bigint, p_ok boolean, p_msg_id text, p_jid text, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_fila; r jsonb; a int; b int;
begin
  update public.whatsapp_fila set status = case when p_ok then 'enviada' else 'erro' end,
         enviada_em = case when p_ok then now() end, msg_id = p_msg_id, erro = case when p_ok then null else left(p_erro, 300) end
   where id = p_fila_id and status = 'enviando' and pego_por = p_dono returning * into v;
  if v.id is null then return; end if;
  if p_ok then
    insert into public.whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, tipo, em, fila_id, lida)
    values (p_msg_id, coalesce(nullif(p_jid, ''), v.telefone || '@s.whatsapp.net'), v.telefone, true, v.texto, 'texto', now(), v.id, true)
    on conflict (msg_id) do update set fila_id = excluded.fila_id;
  end if;
  select regras into r from public.whatsapp_conexao where id = 1;
  a := coalesce((r ->> 'intervalo_min')::int, 25); b := greatest(a, coalesce((r ->> 'intervalo_max')::int, 70));
  update public.whatsapp_conexao set proximo_envio = now() + make_interval(secs => a + floor(random() * (b - a + 1))) where id = 1;
end $$;

-- mensagens recebidas (e as enviadas pelo próprio celular): guarda sem repetir; "PARAR"/"SAIR" registra a recusa
-- p_msgs: [{msg_id, jid, telefone, nome, de_mim, texto, tipo, em}]
create or replace function public.whatsapp_guardar_mensagens(p_msgs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare m jsonb; n int := 0; k int;
begin
  for m in select * from jsonb_array_elements(coalesce(p_msgs, '[]'::jsonb)) loop
    insert into public.whatsapp_mensagens (msg_id, jid, telefone, nome, de_mim, texto, tipo, em)
    values (m ->> 'msg_id', m ->> 'jid', regexp_replace(coalesce(m ->> 'telefone', ''), '\D', '', 'g'), left(coalesce(m ->> 'nome', ''), 80),
            coalesce((m ->> 'de_mim')::boolean, false), left(coalesce(m ->> 'texto', ''), 4000), coalesce(nullif(m ->> 'tipo', ''), 'texto'),
            coalesce((m ->> 'em')::timestamptz, now()))
    on conflict (msg_id) do nothing;
    get diagnostics k = row_count; n := n + k;
    if k > 0 and not coalesce((m ->> 'de_mim')::boolean, false) and coalesce(m ->> 'telefone', '') <> ''
       and lower(btrim(coalesce(m ->> 'texto', ''), E' .!\n')) in ('parar', 'pare', 'sair', 'stop', 'cancelar mensagens') then
      insert into public.whatsapp_optout (telefone, texto) values (public.whatsapp_chave_tel(m ->> 'telefone'), left(m ->> 'texto', 100))
      on conflict (telefone) do nothing;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Versões para o motor (chave do motor + vez, v24)
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_motor_proxima(p_chave text, p_id text) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_com_vez(p_chave, p_id);
  return public.whatsapp_pegar_proxima('android', p_id);
end $$;

create or replace function public.whatsapp_motor_resultado(p_chave text, p_id text, p_fila_id bigint, p_ok boolean, p_msg_id text, p_jid text, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_conferir(p_chave);  -- resultado vale mesmo se a vez acabou de vencer (a mensagem já saiu)
  perform public.whatsapp_resultado('android', p_id, p_fila_id, p_ok, p_msg_id, p_jid, p_erro);
end $$;

create or replace function public.whatsapp_motor_mensagens(p_chave text, p_id text, p_msgs jsonb) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_conferir(p_chave);
  return public.whatsapp_guardar_mensagens(p_msgs);
end $$;

-- ---------------------------------------------------------------------
-- Leitura para o Claude (conector) e a tela — só administrador
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.whatsapp_conexao;
begin
  if not public.e_admin() then raise exception 'Só o administrador vê o WhatsApp.'; end if;
  select * into c from public.whatsapp_conexao where id = 1;
  return jsonb_build_object(
    'situacao', c.situacao, 'numero', c.numero, 'detalhe', c.detalhe,
    'motor_do_android', case when c.motor_visto is null then 'nunca ligado'
                             when c.motor_visto > now() - interval '90 seconds' then case when (c.motor_info ->> 'conectado')::boolean then 'ligado e conectado' else 'ligado, sem conexão' end
                             else 'sem sinal desde ' || to_char(c.motor_visto at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') end,
    'envio_agora', case when c.dono = 'android' and c.dono_ate > now() then 'pelo motor do Android (na hora)'
                        else 'pelo Supabase sob demanda (alguns minutos de atraso)' end,
    'no_horario_de_envio', public.whatsapp_no_horario(c.regras), 'regras', c.regras,
    'fila', (select jsonb_build_object('pendentes', count(*) filter (where status = 'pendente'),
                                       'enviando', count(*) filter (where status = 'enviando'),
                                       'enviadas_hoje', count(*) filter (where status = 'enviada' and enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
                                       'com_erro_7_dias', count(*) filter (where status = 'erro' and criado_em > now() - interval '7 days'))
               from public.whatsapp_fila),
    'nao_lidas', (select count(*) from public.whatsapp_mensagens where not de_mim and not lida));
end $$;

-- conversas recentes (uma linha por número), com o cliente cadastrado quando achar
create or replace function public.whatsapp_conversas(p_limite int default 20, p_so_nao_lidas boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Só o administrador vê o WhatsApp.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) - 'chave' order by x.ultima_em desc) from (
    select g.*, (select c.nome from public.clientes c
                  where g.chave in (public.whatsapp_chave_tel(c.telefone), public.whatsapp_chave_tel(c.telefone2), public.whatsapp_chave_tel(c.telefone3))
                    and coalesce(c.telefone, '') || coalesce(c.telefone2, '') || coalesce(c.telefone3, '') <> '' limit 1) cliente
      from (select public.whatsapp_chave_tel(m.telefone) chave, max(m.telefone) telefone,
                   max(m.em) ultima_em, count(*) filter (where not m.de_mim and not m.lida) nao_lidas,
                   (array_agg(m.texto order by m.em desc))[1] ultima_mensagem, (array_agg(m.de_mim order by m.em desc))[1] ultima_de_mim,
                   max(nullif(m.nome, '')) nome_no_whatsapp
              from public.whatsapp_mensagens m where m.telefone <> ''
             group by public.whatsapp_chave_tel(m.telefone)
            having not p_so_nao_lidas or count(*) filter (where not m.de_mim and not m.lida) > 0
             order by max(m.em) desc limit least(greatest(coalesce(p_limite, 20), 1), 100)) g) x), '[]'::jsonb);
end $$;

-- mensagens de um número (mais novas por último); p_marcar_lidas marca as recebidas como lidas
create or replace function public.whatsapp_mensagens_de(p_telefone text, p_limite int default 30, p_marcar_lidas boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chave text := public.whatsapp_chave_tel(p_telefone); v jsonb;
begin
  if not public.e_admin() then raise exception 'Só o administrador vê o WhatsApp.'; end if;
  if length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) < 8 then raise exception 'Informe o telefone com DDD.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('em', em, 'de', case when de_mim then 'oficina' else coalesce(nullif(nome, ''), 'cliente') end,
                                               'texto', texto, 'tipo', tipo) order by em), '[]'::jsonb)
    into v from (select * from public.whatsapp_mensagens where public.whatsapp_chave_tel(telefone) = v_chave
                  order by em desc limit least(greatest(coalesce(p_limite, 30), 1), 200)) t;
  if p_marcar_lidas then update public.whatsapp_mensagens set lida = true where public.whatsapp_chave_tel(telefone) = v_chave and not lida; end if;
  return jsonb_build_object('telefone', p_telefone, 'mensagens', v,
    'na_fila', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status, 'texto', left(texto, 120), 'erro', erro, 'criado_em', criado_em) order by id), '[]'::jsonb)
                  from public.whatsapp_fila where public.whatsapp_chave_tel(telefone) = v_chave and status in ('pendente', 'enviando', 'erro') and criado_em > now() - interval '7 days'),
    'pediu_parar', exists (select 1 from public.whatsapp_optout where telefone = v_chave));
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  -- internas: só a chave de servidor (função zap)
  foreach f in array array['whatsapp_pegar_proxima(text, text)', 'whatsapp_resultado(text, text, bigint, boolean, text, text, text)', 'whatsapp_guardar_mensagens(jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
  -- motor (conferem a chave do motor)
  foreach f in array array['whatsapp_motor_proxima(text, text)', 'whatsapp_motor_resultado(text, text, bigint, boolean, text, text, text)', 'whatsapp_motor_mensagens(text, text, jsonb)'] loop
    execute 'revoke all on function public.' || f || ' from public, authenticated';
    execute 'grant execute on function public.' || f || ' to anon, service_role';
  end loop;
  -- administrador (tela e conector; conferem e_admin)
  foreach f in array array['whatsapp_enfileirar(jsonb, boolean)', 'whatsapp_cancelar(bigint)', 'whatsapp_resumo()', 'whatsapp_conversas(int, boolean)', 'whatsapp_mensagens_de(text, int, boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated, service_role';
  end loop;
end $$;

notify pgrst, 'reload schema';
