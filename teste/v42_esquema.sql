-- Tabelas que o v42 usa, além do esquema do v40 (teste/teste_v42.sh)
\set ON_ERROR_STOP 1
alter table public.fornecedores add column ie text not null default '', add column telefone text not null default '', add column email text not null default '',
  add column endereco text not null default '', add column bairro text not null default '', add column cidade text not null default '', add column uf text not null default '',
  add column cep text not null default '';
alter table public.produtos add column localizacao text not null default '', add column categoria text not null default '', add column estoque_min numeric(12,3) not null default 0,
  add column avisar_estoque_baixo boolean not null default true, add column obs text not null default '';
alter table public.contas add column grupo uuid, add column chave_nfe text not null default '', add column nota_id uuid, add column ordem_id uuid;
create unique index contas_duplicata_unica on public.contas (chave_nfe, documento) where chave_nfe <> '';
create table public.produto_fornecedor (id uuid primary key default gen_random_uuid(), produto_id uuid not null references public.produtos (id) on delete cascade,
  fornecedor_id uuid not null references public.fornecedores (id) on delete cascade, codigo text not null, ean text not null default '', descricao text not null default '',
  unidade text not null default '', fator numeric(12,4) not null default 1, ultimo_custo numeric(12,4), ultima_compra date, unique (fornecedor_id, codigo));
create table public.notas_entrada (id uuid primary key default gen_random_uuid(), chave text not null default '', numero text not null default '', serie text not null default '',
  fornecedor_id uuid, emissao timestamptz, valor_total numeric(12,2) not null default 0, itens jsonb not null default '[]', usuario_nome text not null default '', criado_em timestamptz not null default now());
create table public.nfe_recebidas (id uuid primary key default gen_random_uuid(), chave text not null unique, cnpj_emitente text not null default '', nome_emitente text not null default '',
  numero text not null default '', emissao timestamptz, valor numeric(14,2) not null default 0, xml text, status text not null default 'nova', nota_id uuid,
  contas_lancadas boolean not null default false);
create or replace function public.nfe_recebida_lancada() returns trigger language plpgsql as $$
begin update public.nfe_recebidas set status = 'lancada', nota_id = new.id where chave = new.chave; return new; end $$;
create trigger notas_entrada_sefaz after insert on public.notas_entrada for each row execute function public.nfe_recebida_lancada();
create or replace function public.e_admin() returns boolean language sql as $$ select true $$;
