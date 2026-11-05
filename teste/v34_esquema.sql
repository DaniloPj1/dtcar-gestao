-- Esquema mínimo para testar o WhatsApp (v22–v26, v32 e v34) num Postgres local, sem o banco da oficina.
-- Papéis ao estilo Supabase, auth.uid() trocável pela variável "teste.uid", storage/cron/net de mentira.
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;
grant usage on schema public to anon, authenticated, service_role;
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('teste.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated, service_role;

create table public.perfis (id uuid primary key, nome text not null default '', papel text not null default 'consultor', ativo boolean not null default true);
create or replace function public.e_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and papel = 'admin' and ativo) $$;
grant execute on function public.e_admin() to anon, authenticated, service_role;
insert into public.perfis values ('00000000-0000-0000-0000-00000000000a', 'Danilo', 'admin', true), ('00000000-0000-0000-0000-00000000000b', 'Consultor', 'consultor', true);

create table public.clientes (id uuid primary key default gen_random_uuid(), nome text not null, telefone text, telefone2 text, telefone3 text, atualizado_em timestamptz default now());
create table public.ordens (id uuid primary key default gen_random_uuid(), numero int unique, cliente_id uuid, cliente jsonb not null default '{}', veiculo jsonb not null default '{}',
  status text not null default 'diagnostico', total numeric(12,2) not null default 0, recebido numeric(12,2) not null default 0, finalizada_em timestamptz, criado_em timestamptz not null default now());
create or replace function public.agente_etapa(o public.ordens) returns text language sql immutable as $$ select o.status $$;
create table public.segredos (chave text primary key, valor text);

create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, created_at timestamptz not null default now());
alter table storage.objects enable row level security;
create schema if not exists cron;
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) returning jobid $$;
create or replace function cron.unschedule(id bigint) returns boolean language sql as $$ delete from cron.job where jobid = id returning true $$;
create schema if not exists net;

insert into public.clientes (id, nome, telefone) values ('11111111-1111-1111-1111-111111111111', 'Marbrasa Norte Mineradora Ltda', '27999990001'),
  ('22222222-2222-2222-2222-222222222222', 'João da Silva', '(27) 99999-0002');
insert into public.ordens (numero, cliente_id, cliente, veiculo, status, total) values
  (1887, '22222222-2222-2222-2222-222222222222', '{"nome": "João da Silva", "telefone": "27999990002"}', '{"placa": "ABC1D23", "marca": "VW", "modelo": "Gol"}', 'aguardando', 291),
  (1890, null, '{"nome": "Cliente sem cadastro", "telefone": "27988887777"}', '{"placa": "XYZ9A88"}', 'pronto', 100);
