-- Esquema mínimo para testar supabase/v49.sql (teste/teste_v49.sh): segredos, sefaz_config, pg_cron e pg_net FALSOS
-- (nenhuma chamada sai para o GitHub: net.http_post só grava o pedido numa tabela) e o aviso do WhatsApp (só grava o texto).
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create or replace function public.e_admin() returns boolean language sql as $$ select true $$;
create table public.segredos (chave text primary key, valor text not null, atualizado_em timestamptz not null default now());
create table public.sefaz_config (id int primary key, ativo boolean not null default true, ultima_consulta timestamptz,
  proxima_consulta timestamptz, worker_em timestamptz, worker_erro text not null default '', ultimo_erro text not null default '');
insert into public.sefaz_config (id, ativo) values (1, false);
create table public.zap_teste (id bigserial primary key, texto text);
create or replace function public.whatsapp_alerta_na_fila(p_texto text) returns bigint language plpgsql as $$
declare v_id bigint; begin insert into public.zap_teste (texto) values (p_texto) returning id into v_id; return v_id; end $$;
-- pg_net falso
create schema if not exists net;
create table net.chamadas (id bigserial primary key, url text, body jsonb, headers jsonb, timeout_milliseconds int);
create table net._http_response (id bigint primary key, status_code int, content text, error_msg text, timed_out boolean);
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds int default 5000) returns bigint language plpgsql as $$
declare v_id bigint; begin
  insert into net.chamadas (url, body, headers, timeout_milliseconds) values (url, body, headers, timeout_milliseconds) returning id into v_id;
  return v_id; end $$;
-- pg_cron falso
create schema if not exists cron;
create table cron.job (jobname text primary key, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
