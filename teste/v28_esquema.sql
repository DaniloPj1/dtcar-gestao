-- Esquema mínimo para testar o supabase/v28.sql num Postgres local (sem tocar no banco real)
do $$ begin create role authenticated; exception when others then null; end $$;
do $$ begin create role anon; exception when others then null; end $$;
create table if not exists public.papel_teste (gestor boolean not null);
insert into public.papel_teste values (true);
create or replace function public.e_gestor() returns boolean language sql as $$ select gestor from public.papel_teste limit 1 $$;
create or replace function public.e_membro() returns boolean language sql as $$ select true $$;
create or replace function public.e_admin() returns boolean language sql as $$ select gestor from public.papel_teste limit 1 $$;
create or replace function public.toca_atualizado() returns trigger language plpgsql as $$ begin new.atualizado_em := clock_timestamp(); return new; end $$;
create table if not exists public.exclusoes (id bigint generated always as identity primary key, tabela text, registro text, em timestamptz default now());
create or replace function public.registra_exclusao() returns trigger language plpgsql as $$ begin insert into public.exclusoes (tabela, registro) values (tg_table_name, old.id::text); return old; end $$;
create table if not exists public.estornos_saldo (id uuid primary key default gen_random_uuid(), conta text, valor numeric, origem text, registro uuid, original_em timestamptz);
