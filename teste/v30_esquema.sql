-- Esquema mínimo para testar supabase/v30.sql (Documentos do RH) num Postgres local (teste/teste_v30.sh).
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'agente_leitura') then create role agente_leitura; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('dtcar.uid', true), '')::uuid $$;
create table public.perfis (id uuid primary key, nome text not null default '', papel text not null default 'pendente', ativo boolean not null default true);
create or replace function public.e_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel = 'admin') $$;
insert into public.perfis values ('00000000-0000-0000-0000-00000000000a', 'Danilo', 'admin', true), ('00000000-0000-0000-0000-00000000000b', 'Consultor', 'consultor', true);
-- pasta de arquivos do Supabase (o mínimo)
create schema if not exists storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema public, storage to authenticated;
grant select, insert, delete on storage.objects to authenticated;
