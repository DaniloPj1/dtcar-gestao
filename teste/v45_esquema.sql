-- Esquema mínimo para testar supabase/v45.sql (teste/teste_v45.sh): contas, fornecedores, e_admin, pg_cron e a fila
-- interna do WhatsApp (whatsapp_interno de verdade é do v36; aqui só grava o texto numa tabela).
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema if not exists auth;
-- teste.uid vazio = agendamento (sem login)
create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create or replace function public.e_admin() returns boolean language sql as $$ select coalesce(current_setting('teste.admin', true), '1') = '1' $$;
create table public.fornecedores (id uuid primary key default gen_random_uuid(), razao text not null, fantasia text not null default '');
create table public.contas (id uuid primary key default gen_random_uuid(), descricao text not null, fornecedor_id uuid, favorecido text not null default '',
  valor numeric(12, 2) not null, vencimento date not null, parcela int, parcelas int,
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')));
create table public.zap_teste (id bigserial primary key, texto text);
create table public.whatsapp_conexao (id int primary key, alerta_telefone text);
insert into public.whatsapp_conexao values (1, '5527997696545');
create or replace function public.whatsapp_interno(p_texto text, p_esperar_s int default 0) returns bigint language plpgsql as $$
declare v_id bigint; begin
  if coalesce((select alerta_telefone from public.whatsapp_conexao where id = 1), '') = '' then return null; end if;
  insert into public.zap_teste (texto) values (p_texto) returning id into v_id; return v_id; end $$;
create schema if not exists cron;
create table cron.job (jobname text primary key, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$
  insert into cron.job values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning 1::bigint $$;
create or replace function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname = n returning true $$;
