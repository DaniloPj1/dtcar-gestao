-- Esquema mínimo para testar supabase/v35.sql num Postgres local (teste/teste_v35.sh): papéis ao estilo Supabase,
-- config, segredos, e_admin(), storage.buckets e pg_cron/pg_net de mentira, e o aviso do WhatsApp (v32) que só anota.
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
create table public.perfis (id uuid primary key, papel text not null default 'pendente', ativo boolean not null default true);
grant select on public.perfis to authenticated;
create function public.e_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin' and ativo) $$;
grant execute on function public.e_admin() to authenticated;
create table public.config (id int primary key default 1, dados jsonb not null default '{}'::jsonb, atualizado_em timestamptz not null default now());
insert into public.config values (1, '{"nome": "DTCAR CENTRO AUTOMOTIVO"}');
create table public.segredos (chave text primary key, valor text not null);
insert into public.segredos values ('cron', 'segredo-de-teste');
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create schema cron;
create table cron.job (jobid serial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(p_nome text, p_quando text, p_cmd text) returns int language sql as $$
  insert into cron.job (jobname, schedule, command) values (p_nome, p_quando, p_cmd)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid $$;
create function cron.unschedule(p_id int) returns boolean language sql as $$ delete from cron.job where jobid = p_id returning true $$;
create schema net;
create function net.http_post(url text, headers jsonb, body jsonb, timeout_milliseconds int) returns bigint language sql as $$ select 1::bigint $$;
-- aviso no WhatsApp (v32): aqui só anota o texto
create table public.avisos_teste (id bigserial primary key, texto text);
create function public.whatsapp_alerta_na_fila(p_texto text) returns bigint language sql security definer as $$
  insert into public.avisos_teste (texto) values (p_texto) returning id $$;
