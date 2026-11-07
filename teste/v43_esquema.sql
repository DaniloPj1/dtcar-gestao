-- Esquema mínimo para testar supabase/v43.sql (teste/teste_v43.sh): contas como no v5, perfis e e_admin.
\set ON_ERROR_STOP 1
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
create table public.perfis (id uuid primary key, nome text not null default '');
insert into public.perfis values ('00000000-0000-0000-0000-00000000000a', 'Danilo');
create or replace function public.e_admin() returns boolean language sql as $$ select coalesce(current_setting('teste.admin', true), '1') = '1' $$;
create table public.contas (id uuid primary key default gen_random_uuid(), descricao text not null, fornecedor_id uuid, favorecido text not null default '',
  categoria text not null default '', documento text not null default '', valor numeric(12, 2) not null check (valor >= 0), emissao date, vencimento date not null,
  linha_digitavel text not null default '', codigo_barras text not null default '', parcela int, parcelas int, grupo uuid,
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')), pago_em date, valor_pago numeric(12, 2),
  origem text not null default 'manual' check (origem in ('manual', 'boleto', 'nfe', 'os', 'recorrente', 'parcelado')),
  obs text not null default '', criado_por text not null default '', criado_em timestamptz not null default now());
