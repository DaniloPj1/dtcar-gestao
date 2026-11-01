-- Esquema mínimo (só as colunas usadas) para testar a função do supabase/v15.sql num Postgres local (teste/teste_v15.sh)
\set ON_ERROR_STOP 1
drop schema if exists public cascade; create schema public;
create table public.config (id int primary key, dados jsonb not null default '{}');
insert into public.config values (1, '{}');
create table public.ordens (id uuid primary key, numero int, status text not null default 'diagnostico', cliente jsonb not null default '{}', reclamacao text not null default '',
  obs_internas text not null default '', orcamento_enviado_em timestamptz, aprovacao jsonb, total numeric(12,2) not null default 0, previsao_entrega date,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create table public.os_itens (id uuid primary key, ordem_id uuid not null references public.ordens(id) on delete cascade, tipo text not null, descricao text not null,
  qtd numeric(10,3) not null default 1, valor_unit numeric(10,2) not null default 0, aprovado boolean, executado boolean not null default false, posicao int not null default 0,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create table public.eventos (id bigint generated always as identity primary key, ordem_id uuid not null references public.ordens(id) on delete cascade, tipo text not null,
  texto text not null default '', usuario_nome text not null default '', criado_em timestamptz not null default now());
create function public.toca() returns trigger language plpgsql as $$ begin new.atualizado_em := clock_timestamp(); return new; end $$;
create trigger t1 before update on public.ordens for each row execute function public.toca();
create trigger t2 before update on public.os_itens for each row execute function public.toca();
do $$ begin create role authenticated; exception when others then null; end $$; do $$ begin create role anon; exception when others then null; end $$;
