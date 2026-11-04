-- Esquema mínimo para testar supabase/v31.sql num Postgres local (teste/teste_v31.sh).
-- Usa o esquema do teste do v21 (O.S., perfis, agente_acoes, funções auxiliares) e acrescenta
-- fornecedores e pre_notas como no v4/v19.
\set ON_ERROR_STOP 1
\ir v21_esquema.sql
create table public.fornecedores (id uuid primary key default gen_random_uuid(), cnpj text not null default '', razao text not null,
  fantasia text not null default '', ativo boolean not null default true);
create table public.pre_notas (
  id uuid primary key default gen_random_uuid(), data date not null default current_date,
  fornecedor_id uuid references public.fornecedores (id) on delete set null, fornecedor_nome text not null default '', fornecedor_cnpj text not null default '',
  documento text not null default '', total numeric(12, 2) not null default 0, ordem_id uuid, os_numero int, placa text not null default '',
  fotos text[] not null default '{}', situacao text not null default 'aberta' check (situacao in ('aberta', 'conferida', 'triangulada', 'cancelada')),
  chave_nfe text not null default '', triangulada_em timestamptz, obs text not null default '', criado_por text not null default '',
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(), check (total >= 0));
