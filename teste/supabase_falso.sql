-- O mínimo do Supabase para montar o banco inteiro da oficina num Postgres local (teste/montar_banco.sh):
-- esquema auth (usuários e auth.uid() pelo "login" da sessão), papéis anon/authenticated/service_role,
-- pastas de arquivos (storage), agendamentos (cron) e chamadas web (net) de mentira.
-- Nada daqui vai para o Supabase de verdade.
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;

create schema if not exists auth;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb not null default '{}',
  raw_app_meta_data jsonb not null default '{}', created_at timestamptz not null default now(), last_sign_in_at timestamptz);
-- auth.uid(): o "login" da sessão vem de set_config('request.jwt.claim.sub', '<uuid>', false)
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'authenticated') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select jsonb_build_object('sub', auth.uid(), 'role', auth.role()) $$;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to service_role;

create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint,
  allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now(), owner uuid);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz);
alter table storage.objects enable row level security;
create or replace function storage.foldername(name text) returns text[] language sql immutable as $$
  select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
create or replace function storage.filename(name text) returns text language sql immutable as $$
  select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'), 1)] $$;
create or replace function storage.extension(name text) returns text language sql immutable as $$
  select reverse(split_part(reverse(name), '.', 1)) $$;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to authenticated, service_role;

-- agendamentos (pg_cron) de mentira: só guarda o que foi agendado
create schema if not exists cron;
create table if not exists cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text, active boolean default true);
create or replace function cron.schedule(p_nome text, p_quando text, p_comando text) returns bigint language plpgsql as $$
declare v bigint;
begin
  insert into cron.job (jobname, schedule, command) values (p_nome, p_quando, p_comando)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid into v;
  return v;
end $$;
create or replace function cron.unschedule(p_nome text) returns boolean language plpgsql as $$
begin delete from cron.job where jobname = p_nome; return found; end $$;
create or replace function cron.unschedule(p_id bigint) returns boolean language plpgsql as $$
begin delete from cron.job where jobid = p_id; return found; end $$;

-- chamadas web (pg_net) de mentira: guarda o pedido e devolve um número
create schema if not exists net;
create table if not exists net.pedidos (id bigserial primary key, url text, body jsonb, headers jsonb, criado_em timestamptz default now());
create table if not exists net._http_response (id bigint primary key, status_code int, content text, error_msg text, created timestamptz default now());
create or replace function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language plpgsql as $$
declare v bigint;
begin insert into net.pedidos (url, body, headers) values (url, body, headers) returning id into v; return v; end $$;
grant usage on schema net, cron to authenticated, service_role;

-- como o Supabase: tudo o que for criado no esquema public já nasce liberado para os papéis da API (quem barra é o RLS)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
