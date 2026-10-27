-- =====================================================================
-- DTCar Gestão — estrutura do banco de dados (Supabase / PostgreSQL)
-- Cole este arquivo inteiro no SQL Editor do Supabase e clique em "Run".
-- Pode ser executado mais de uma vez sem duplicar nada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Perfis da equipe (1 por usuário do Supabase Auth)
-- O PRIMEIRO usuário cadastrado vira administrador automaticamente.
-- Os demais entram como "pendente" até o administrador liberar.
-- ---------------------------------------------------------------------
create table if not exists public.perfis (
  id uuid primary key references auth.users (id) on delete cascade,
  nome text not null default '',
  email text not null default '',
  papel text not null default 'pendente' check (papel in ('admin', 'consultor', 'mecanico', 'pendente')),
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

create or replace function public.novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfis (id, nome, email, papel)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'nome', ''), split_part(new.email, '@', 1)),
    coalesce(new.email, ''),
    case when exists (select 1 from public.perfis where papel = 'admin') then 'pendente' else 'admin' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists ao_criar_usuario on auth.users;
create trigger ao_criar_usuario after insert on auth.users
  for each row execute function public.novo_usuario();

create or replace function public.e_membro() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel in ('admin', 'consultor', 'mecanico'))
$$;

create or replace function public.e_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel = 'admin')
$$;

-- Impede que alguém que não seja admin altere o próprio papel
create or replace function public.protege_papel() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.papel is distinct from old.papel or new.ativo is distinct from old.ativo) and not public.e_admin() then
    raise exception 'Somente o administrador pode alterar papel ou status de usuários';
  end if;
  return new;
end $$;
drop trigger if exists protege_papel on public.perfis;
create trigger protege_papel before update on public.perfis
  for each row execute function public.protege_papel();

-- ---------------------------------------------------------------------
-- Configuração da oficina (linha única)
-- ---------------------------------------------------------------------
create table if not exists public.config (
  id int primary key default 1 check (id = 1),
  dados jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now()
);
insert into public.config (id, dados) values (1, jsonb_build_object(
  'nome', 'DTCAR CENTRO AUTOMOTIVO',
  'endereco', 'Rod. Gether Lopes de Farias, 491 - São Silvano, Colatina - ES, 29705-390',
  'telefone', '(27) 99769-6545',
  'cnpj', '49.016.409/0001-95'
)) on conflict (id) do nothing;

-- ---------------------------------------------------------------------
-- Clientes e veículos
-- ---------------------------------------------------------------------
create table if not exists public.clientes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  telefone text not null default '',
  doc text not null default '',
  email text not null default '',
  endereco text not null default '',
  obs text not null default '',
  criado_em timestamptz not null default now()
);
create unique index if not exists clientes_doc_unico on public.clientes (doc) where doc <> '';

create table if not exists public.veiculos (
  id uuid primary key default gen_random_uuid(),
  placa text not null unique,
  marca text not null default '',
  modelo text not null default '',
  ano text not null default '',
  cor text not null default '',
  motor text not null default '',
  cliente_id uuid references public.clientes (id) on delete restrict,
  km_atual int,
  criado_em timestamptz not null default now()
);
create index if not exists veiculos_cliente on public.veiculos (cliente_id);

-- ---------------------------------------------------------------------
-- Catálogo de serviços (mão de obra)
--   cobranca = 'fixo' -> usa preco
--   cobranca = 'hora' -> usa horas x valor-hora configurado
-- ---------------------------------------------------------------------
create table if not exists public.servicos (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  categoria text not null default 'Geral',
  cobranca text not null default 'fixo' check (cobranca in ('fixo', 'hora')),
  preco numeric(10, 2) not null default 0,
  horas numeric(6, 2) not null default 0,
  ativo boolean not null default true,
  criado_em timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Ordens de serviço (do check-in à entrega)
-- status: diagnostico -> aguardando -> execucao -> pronto -> entregue
--         (ou recusado / cancelado)
-- ---------------------------------------------------------------------
create sequence if not exists public.os_numero_seq start 1;

create table if not exists public.ordens (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('public.os_numero_seq'),
  status text not null default 'diagnostico'
    check (status in ('diagnostico', 'aguardando', 'execucao', 'pronto', 'entregue', 'recusado', 'cancelado')),
  cliente_id uuid references public.clientes (id) on delete restrict,
  veiculo_id uuid references public.veiculos (id) on delete restrict,
  cliente jsonb not null default '{}'::jsonb,   -- cópia dos dados no momento da entrada
  veiculo jsonb not null default '{}'::jsonb,
  km_entrada int,
  combustivel text not null default '',
  funcionando text not null default '',
  reclamacao text not null default '',
  checkin jsonb not null default '{}'::jsonb,   -- respostas do checklist, objetos, termo
  consultor_id uuid references public.perfis (id) on delete set null,
  consultor_nome text not null default '',
  mecanico_id uuid references public.perfis (id) on delete set null,
  mecanico_nome text not null default '',
  assinatura_entrada text not null default '',
  assinante_entrada text not null default '',
  diagnostico text not null default '',
  previsao_entrega date,
  condicoes_pagamento text not null default '',
  orcamento_enviado_em timestamptz,
  validade_orcamento date,
  aprovacao jsonb,
  desconto numeric(10, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  custo numeric(12, 2) not null default 0,
  forma_pagamento text not null default '',
  garantia_dias int not null default 90,
  km_saida int,
  entregue_em timestamptz,
  assinatura_entrega text not null default '',
  obs_execucao text not null default '',
  obs_internas text not null default '',
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists ordens_status on public.ordens (status);
create index if not exists ordens_veiculo on public.ordens (veiculo_id);
create index if not exists ordens_criado on public.ordens (criado_em desc);

create or replace function public.toca_atualizado() returns trigger language plpgsql as $$
begin new.atualizado_em = now(); return new; end $$;
drop trigger if exists ordens_atualizado on public.ordens;
create trigger ordens_atualizado before update on public.ordens
  for each row execute function public.toca_atualizado();

create table if not exists public.os_itens (
  id uuid primary key default gen_random_uuid(),
  ordem_id uuid not null references public.ordens (id) on delete cascade,
  tipo text not null check (tipo in ('servico', 'peca', 'terceiro')),
  descricao text not null,
  codigo text not null default '',
  fornecedor text not null default '',
  qtd numeric(10, 3) not null default 1,
  valor_unit numeric(10, 2) not null default 0,
  custo_unit numeric(10, 2) not null default 0,
  horas numeric(6, 2),
  servico_id uuid references public.servicos (id) on delete set null,
  fornecida_cliente boolean not null default false,
  qualidade text not null default '',            -- original | paralela | usada
  adicional boolean not null default false,      -- incluído depois do orçamento aprovado
  aprovado boolean,                              -- null = aguardando decisão do cliente
  executado boolean not null default false,
  posicao int not null default 0,
  criado_em timestamptz not null default now()
);
create index if not exists os_itens_ordem on public.os_itens (ordem_id);

create table if not exists public.fotos (
  id uuid primary key default gen_random_uuid(),
  ordem_id uuid not null references public.ordens (id) on delete cascade,
  caminho text not null,
  rotulo text not null default '',
  etapa text not null default 'entrada',          -- entrada | execucao | entrega
  largura int,
  altura int,
  criado_em timestamptz not null default now()
);
create index if not exists fotos_ordem on public.fotos (ordem_id);

create table if not exists public.eventos (
  id bigint generated always as identity primary key,
  ordem_id uuid not null references public.ordens (id) on delete cascade,
  tipo text not null,
  texto text not null default '',
  usuario_nome text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists eventos_ordem on public.eventos (ordem_id);

-- ---------------------------------------------------------------------
-- Regras de acesso (Row Level Security)
--   membros (admin, consultor, mecânico): leem e gravam o dia a dia
--   somente admin: exclui registros, altera configuração, catálogo e equipe
-- ---------------------------------------------------------------------
alter table public.perfis   enable row level security;
alter table public.config   enable row level security;
alter table public.clientes enable row level security;
alter table public.veiculos enable row level security;
alter table public.servicos enable row level security;
alter table public.ordens   enable row level security;
alter table public.os_itens enable row level security;
alter table public.fotos    enable row level security;
alter table public.eventos  enable row level security;

drop policy if exists perfis_ler on public.perfis;
create policy perfis_ler on public.perfis for select to authenticated using (id = auth.uid() or public.e_membro());
drop policy if exists perfis_editar on public.perfis;
create policy perfis_editar on public.perfis for update to authenticated using (id = auth.uid() or public.e_admin()) with check (id = auth.uid() or public.e_admin());

drop policy if exists config_ler on public.config;
create policy config_ler on public.config for select to authenticated using (public.e_membro());
drop policy if exists config_gravar on public.config;
create policy config_gravar on public.config for all to authenticated using (public.e_admin()) with check (public.e_admin());

do $$
declare t text;
begin
  foreach t in array array['clientes', 'veiculos', 'ordens', 'os_itens', 'fotos', 'eventos'] loop
    execute format('drop policy if exists %1$s_ler on public.%1$s', t);
    execute format('create policy %1$s_ler on public.%1$s for select to authenticated using (public.e_membro())', t);
    execute format('drop policy if exists %1$s_incluir on public.%1$s', t);
    execute format('create policy %1$s_incluir on public.%1$s for insert to authenticated with check (public.e_membro())', t);
    execute format('drop policy if exists %1$s_alterar on public.%1$s', t);
    execute format('create policy %1$s_alterar on public.%1$s for update to authenticated using (public.e_membro()) with check (public.e_membro())', t);
  end loop;
end $$;

-- exclusões: itens e fotos podem ser removidos pela equipe (edição de orçamento);
-- clientes, veículos e ordens só pelo administrador
drop policy if exists os_itens_excluir on public.os_itens;
create policy os_itens_excluir on public.os_itens for delete to authenticated using (public.e_membro());
drop policy if exists fotos_excluir on public.fotos;
create policy fotos_excluir on public.fotos for delete to authenticated using (public.e_membro());
drop policy if exists clientes_excluir on public.clientes;
create policy clientes_excluir on public.clientes for delete to authenticated using (public.e_admin());
drop policy if exists veiculos_excluir on public.veiculos;
create policy veiculos_excluir on public.veiculos for delete to authenticated using (public.e_admin());
drop policy if exists ordens_excluir on public.ordens;
create policy ordens_excluir on public.ordens for delete to authenticated using (public.e_admin());

drop policy if exists servicos_ler on public.servicos;
create policy servicos_ler on public.servicos for select to authenticated using (public.e_membro());
drop policy if exists servicos_gravar on public.servicos;
create policy servicos_gravar on public.servicos for all to authenticated using (public.e_admin()) with check (public.e_admin());

-- ---------------------------------------------------------------------
-- Armazenamento de fotos e assinaturas (bucket privado)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos', 'fotos', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

drop policy if exists fotos_storage_ler on storage.objects;
create policy fotos_storage_ler on storage.objects for select to authenticated using (bucket_id = 'fotos' and public.e_membro());
drop policy if exists fotos_storage_incluir on storage.objects;
create policy fotos_storage_incluir on storage.objects for insert to authenticated with check (bucket_id = 'fotos' and public.e_membro());
drop policy if exists fotos_storage_excluir on storage.objects;
create policy fotos_storage_excluir on storage.objects for delete to authenticated using (bucket_id = 'fotos' and public.e_membro());

-- ---------------------------------------------------------------------
-- Catálogo inicial: nomes de serviços comuns SEM PREÇO.
-- Preencha os valores na tela "Catálogo" antes de usar no orçamento.
-- ---------------------------------------------------------------------
insert into public.servicos (nome, categoria, cobranca)
select v.nome, v.categoria, v.cobranca
from (values
  ('Diagnóstico com scanner', 'Injeção eletrônica', 'fixo'),
  ('Diagnóstico elétrico', 'Injeção eletrônica', 'hora'),
  ('Limpeza de bicos injetores', 'Injeção eletrônica', 'fixo'),
  ('Alinhamento', 'Pneus', 'fixo'),
  ('Balanceamento (por roda)', 'Pneus', 'fixo'),
  ('Montagem de pneu (por roda)', 'Pneus', 'fixo'),
  ('Troca de pastilhas (eixo)', 'Freios', 'fixo'),
  ('Troca de discos e pastilhas (eixo)', 'Freios', 'fixo'),
  ('Troca de fluido de freio', 'Freios', 'fixo'),
  ('Troca de amortecedores (par)', 'Suspensão e direção', 'fixo'),
  ('Troca de bandeja (lado)', 'Suspensão e direção', 'fixo'),
  ('Troca de terminal de direção (lado)', 'Suspensão e direção', 'fixo'),
  ('Troca de óleo e filtro', 'Mecânica geral', 'fixo'),
  ('Troca de correia dentada', 'Mecânica geral', 'hora'),
  ('Serviço mecânico (por hora)', 'Mecânica geral', 'hora')
) as v (nome, categoria, cobranca)
where not exists (select 1 from public.servicos);
