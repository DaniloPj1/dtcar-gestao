-- Esquema mínimo para testar supabase/v29.sql (e-mail da oficina) num Postgres local (teste/teste_v29.sh).
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'agente_leitura') then create role agente_leitura; end if;
end $$;
create schema if not exists auth;
-- o "usuário logado" do teste vem da configuração dtcar.uid (troca entre administrador e consultor)
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('dtcar.uid', true), '')::uuid $$;
create table public.perfis (id uuid primary key, nome text not null default '', email text not null default '', papel text not null default 'pendente', ativo boolean not null default true);
create or replace function public.e_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel = 'admin') $$;
create table public.fornecedores (id uuid primary key default gen_random_uuid(), razao text not null, fantasia text not null default '', email text not null default '',
  ativo boolean not null default true, prestador boolean not null default false);
create table public.clientes (id uuid primary key default gen_random_uuid(), nome text not null, email text not null default '');
create table public.agente_acoes (id uuid primary key default gen_random_uuid(), em timestamptz not null default now(), ferramenta text not null, pedido text not null default '',
  tabela text not null default '', registro text not null default '', antes jsonb, depois jsonb, confirmado_por text not null default '');
insert into public.perfis values ('00000000-0000-0000-0000-00000000000a', 'Danilo', 'danilo@exemplo.com', 'admin', true),
                                 ('00000000-0000-0000-0000-00000000000b', 'Consultor', 'consultor@exemplo.com', 'consultor', true),
                                 ('00000000-0000-0000-0000-00000000000c', 'Ex-funcionário', 'saiu@exemplo.com', 'consultor', false);
insert into public.fornecedores (razao, fantasia, email, prestador) values ('DPK COMERCIAL AUTOMOTIVA SA', 'DPK', 'Cobranca@DPK.com.br; nfe@dpk.com.br', false),
  ('RETIFICA X LTDA', '', 'retifica@x.com.br', true), ('SEM EMAIL LTDA', '', '', false), ('LIXO', '', 'nao-e-email', false);
insert into public.fornecedores (razao, email, ativo) values ('INATIVO LTDA', 'inativo@y.com.br', false);
insert into public.clientes (nome, email) values ('Marbrasa', 'financeiro@marbrasa.com.br'), ('Cliente com o mesmo do fornecedor', 'nfe@dpk.com.br'), ('Sem', '');
