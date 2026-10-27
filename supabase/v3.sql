-- =====================================================================
-- DTCar Gestão — versão 3
-- Cadastros no modelo do OS Oficina 3.0 (clientes, veículos, produtos e
-- serviços), estoque, recibos de pagamento e resumo do painel no servidor.
-- Rode DEPOIS do schema.sql. Pode ser executado mais de uma vez.
-- =====================================================================

create or replace function public.e_gestor() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.perfis where id = auth.uid() and ativo and papel in ('admin', 'consultor'))
$$;

-- ---------------------------------------------------------------------
-- Clientes: ficha completa (Endereço e contatos / Filiação e avaliação
-- financeira / Informações, observações e histórico)
-- ---------------------------------------------------------------------
create sequence if not exists public.clientes_codigo_seq;
alter table public.clientes
  add column if not exists codigo int,
  add column if not exists fantasia text not null default '',
  add column if not exists rua text not null default '',
  add column if not exists complemento text not null default '',
  add column if not exists bairro text not null default '',
  add column if not exists cidade text not null default '',
  add column if not exists uf text not null default '',
  add column if not exists cep text not null default '',
  add column if not exists telefone2 text not null default '',
  add column if not exists telefone3 text not null default '',
  add column if not exists contato text not null default '',
  add column if not exists rg text not null default '',
  add column if not exists orgao_emissor text not null default '',
  add column if not exists ie text not null default '',
  add column if not exists im text not null default '',
  add column if not exists tipo_cliente text not null default '',
  add column if not exists situacao text not null default 'liberado',
  add column if not exists restricao text not null default '',
  add column if not exists ficha jsonb not null default '{}'::jsonb,
  add column if not exists historico text not null default '',
  add column if not exists atualizado_em timestamptz not null default now();
do $$ begin
  alter table public.clientes add constraint clientes_situacao_ok check (situacao in ('liberado', 'restrito', 'bloqueado'));
exception when duplicate_object then null; end $$;
-- código do sistema anterior (gravado na observação da importação)
update public.clientes set codigo = (substring(obs from 'Importado do OS Oficina 3\.0 \(código (\d+)\)'))::int
  where codigo is null and obs ~ 'Importado do OS Oficina 3\.0 \(código \d+\)';
select setval('public.clientes_codigo_seq', greatest(coalesce((select max(codigo) from public.clientes), 0), 1));
update public.clientes set codigo = nextval('public.clientes_codigo_seq') where codigo is null;
alter table public.clientes alter column codigo set default nextval('public.clientes_codigo_seq');
alter table public.clientes alter column codigo set not null;
create unique index if not exists clientes_codigo_unico on public.clientes (codigo);
create index if not exists clientes_atualizado on public.clientes (atualizado_em);

-- ---------------------------------------------------------------------
-- Veículos: ficha cadastral do veículo
-- ---------------------------------------------------------------------
alter table public.veiculos
  add column if not exists ano_fab int,
  add column if not exists ano_mod int,
  add column if not exists chassi text not null default '',
  add column if not exists renavam text not null default '',
  add column if not exists combustivel text not null default '',
  add column if not exists motorista text not null default '',
  add column if not exists revisao_data date,
  add column if not exists revisao_km int,
  add column if not exists oleo_data date,
  add column if not exists oleo_km int,
  add column if not exists filtro_data date,
  add column if not exists filtro_km int,
  add column if not exists atualizado_em timestamptz not null default now();
update public.veiculos set
  ano_fab = nullif(substring(ano from '^(\d{4})'), '')::int,
  ano_mod = coalesce(nullif(substring(ano from '/(\d{4})$'), '')::int, nullif(substring(ano from '^(\d{4})'), '')::int)
  where ano_fab is null and ano ~ '^\d{4}';
update public.veiculos set combustivel = case lower(motor) when 'deesel' then 'Diesel' when 'gas' then 'GNV' when 'alcool' then 'Etanol' else initcap(motor) end, motor = ''
  where combustivel = '' and lower(motor) in ('gasolina', 'diesel', 'deesel', 'flex', 'alcool', 'etanol', 'gas', 'gnv');
create index if not exists veiculos_atualizado on public.veiculos (atualizado_em);

-- ---------------------------------------------------------------------
-- Produtos e serviços (cadastro único, como no sistema anterior)
-- preço = custo × (1 + margem/100), com tabelas à vista, a prazo e atacado
-- ---------------------------------------------------------------------
create sequence if not exists public.produtos_codigo_seq start 1000;
create table if not exists public.produtos (
  id uuid primary key default gen_random_uuid(),
  codigo int not null default nextval('public.produtos_codigo_seq'),
  tipo text not null default 'produto' check (tipo in ('produto', 'servico')),
  descricao text not null,
  referencia text not null default '',
  codigo_barras text not null default '',
  unidade text not null default 'UN',
  categoria text not null default '',
  marca text not null default '',
  localizacao text not null default '',
  estoque_min numeric(12, 3) not null default 0,
  estoque_atual numeric(12, 3) not null default 0,
  custo numeric(12, 2) not null default 0,
  margem_vista numeric(9, 2) not null default 0,
  preco_vista numeric(12, 2) not null default 0,
  margem_prazo numeric(9, 2) not null default 0,
  preco_prazo numeric(12, 2) not null default 0,
  margem_atacado numeric(9, 2) not null default 0,
  preco_atacado numeric(12, 2) not null default 0,
  cobranca text not null default 'fixo' check (cobranca in ('fixo', 'hora')),
  horas numeric(6, 2) not null default 0,
  controla_estoque boolean not null default true,
  vender_sem_estoque boolean not null default true,
  avisar_estoque_baixo boolean not null default true,
  obs text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists produtos_codigo_unico on public.produtos (codigo);
create index if not exists produtos_atualizado on public.produtos (atualizado_em);

-- o antigo catálogo de serviços passa a fazer parte de Produtos e serviços
insert into public.produtos (id, tipo, descricao, categoria, cobranca, preco_vista, preco_prazo, preco_atacado, horas, ativo, controla_estoque, criado_em)
select s.id, 'servico', s.nome, s.categoria, s.cobranca, s.preco, s.preco, s.preco, s.horas, s.ativo, false, s.criado_em
from public.servicos s order by s.criado_em, s.nome
on conflict (id) do nothing;

alter table public.os_itens
  add column if not exists produto_id uuid references public.produtos (id) on delete set null,
  add column if not exists desconto numeric(10, 2) not null default 0;
update public.os_itens i set produto_id = i.servico_id
  where i.produto_id is null and i.servico_id is not null and exists (select 1 from public.produtos p where p.id = i.servico_id);
create index if not exists os_itens_produto on public.os_itens (produto_id);

-- ---------------------------------------------------------------------
-- O.S.: campos da tela do sistema anterior
-- ---------------------------------------------------------------------
alter table public.ordens
  add column if not exists box text not null default '',
  add column if not exists contato text not null default '',
  add column if not exists previsao_hora text not null default '',
  add column if not exists tabela_preco text not null default 'vista',
  add column if not exists situacao text not null default '',
  add column if not exists estoque_baixado boolean not null default false;
create index if not exists ordens_atualizado on public.ordens (atualizado_em);
-- O.S. já entregues antes do controle de estoque não geram baixa nem estorno
update public.ordens set estoque_baixado = true where status = 'entregue' and not estoque_baixado;

-- ---------------------------------------------------------------------
-- Estoque: movimentos e baixa automática na entrega da O.S.
-- ---------------------------------------------------------------------
create table if not exists public.estoque_mov (
  id bigint generated always as identity primary key,
  produto_id uuid not null references public.produtos (id) on delete cascade,
  ordem_id uuid references public.ordens (id) on delete set null,
  tipo text not null check (tipo in ('entrada', 'saida', 'ajuste', 'estorno')),
  qtd numeric(12, 3) not null,
  saldo numeric(12, 3) not null,
  custo_unit numeric(12, 2),
  obs text not null default '',
  usuario_nome text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists estoque_mov_produto on public.estoque_mov (produto_id, criado_em desc);

-- entrada (+), saída (−) ou ajuste (define o saldo). Na entrada, o custo informado atualiza o custo e os preços.
create or replace function public.movimentar_estoque(p_produto uuid, p_tipo text, p_qtd numeric, p_custo numeric default null, p_obs text default '')
returns numeric language plpgsql security definer set search_path = public as $$
declare p public.produtos; delta numeric; novo numeric; v_nome text;
begin
  if not public.e_gestor() then raise exception 'Seu usuário não tem permissão para esta ação.'; end if;
  if p_tipo not in ('entrada', 'saida', 'ajuste') then raise exception 'Tipo de movimento inválido'; end if;
  select * into p from public.produtos where id = p_produto for update;
  if not found then raise exception 'Produto não encontrado'; end if;
  delta := case p_tipo when 'entrada' then abs(p_qtd) when 'saida' then -abs(p_qtd) else p_qtd - p.estoque_atual end;
  novo := p.estoque_atual + delta;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  if p_tipo = 'entrada' and coalesce(p_custo, 0) > 0 then
    update public.produtos set estoque_atual = novo, custo = p_custo,
      preco_vista = case when margem_vista > 0 then round(p_custo * (1 + margem_vista / 100), 2) else preco_vista end,
      preco_prazo = case when margem_prazo > 0 then round(p_custo * (1 + margem_prazo / 100), 2) else preco_prazo end,
      preco_atacado = case when margem_atacado > 0 then round(p_custo * (1 + margem_atacado / 100), 2) else preco_atacado end
    where id = p_produto;
  else
    update public.produtos set estoque_atual = novo where id = p_produto;
  end if;
  insert into public.estoque_mov (produto_id, tipo, qtd, saldo, custo_unit, obs, usuario_nome)
  values (p_produto, p_tipo, delta, novo, nullif(p_custo, 0), coalesce(p_obs, ''), coalesce(v_nome, ''));
  return novo;
end $$;

-- baixa ao entregar; estorno se a O.S. for reaberta
create or replace function public.estoque_da_ordem() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record; novo numeric; sinal int; tipo_mov text;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'entregue' and not new.estoque_baixado then sinal := -1; tipo_mov := 'saida';
  elsif old.status = 'entregue' and new.status <> 'entregue' and new.estoque_baixado then sinal := 1; tipo_mov := 'estorno';
  else return new; end if;
  for r in
    select i.produto_id, sum(i.qtd) as qtd from public.os_itens i join public.produtos p on p.id = i.produto_id
    where i.ordem_id = new.id and i.tipo = 'peca' and i.aprovado is true and not i.fornecida_cliente and p.controla_estoque
    group by i.produto_id
  loop
    update public.produtos set estoque_atual = estoque_atual + sinal * r.qtd where id = r.produto_id returning estoque_atual into novo;
    insert into public.estoque_mov (produto_id, ordem_id, tipo, qtd, saldo, obs)
    values (r.produto_id, new.id, tipo_mov, sinal * r.qtd, novo, 'O.S. ' || lpad(new.numero::text, 5, '0'));
  end loop;
  new.estoque_baixado := (sinal = -1);
  return new;
end $$;
drop trigger if exists ordens_estoque on public.ordens;
create trigger ordens_estoque before update on public.ordens for each row execute function public.estoque_da_ordem();

-- ---------------------------------------------------------------------
-- Recibos de pagamento
-- ---------------------------------------------------------------------
create sequence if not exists public.recibos_numero_seq;
create table if not exists public.recibos (
  id uuid primary key default gen_random_uuid(),
  numero int not null default nextval('public.recibos_numero_seq'),
  ordem_id uuid references public.ordens (id) on delete set null,
  cliente_id uuid references public.clientes (id) on delete set null,
  pagador text not null,
  doc text not null default '',
  valor numeric(12, 2) not null check (valor > 0),
  referente text not null default '',
  forma text not null default '',
  data date not null default current_date,
  obs text not null default '',
  emitido_por text not null default '',
  cancelado boolean not null default false,
  cancelado_motivo text not null default '',
  criado_em timestamptz not null default now()
);
create unique index if not exists recibos_numero_unico on public.recibos (numero);
create index if not exists recibos_ordem on public.recibos (ordem_id);
create index if not exists recibos_data on public.recibos (data desc);

-- ---------------------------------------------------------------------
-- atualizado_em automático (o site busca só o que mudou)
-- ---------------------------------------------------------------------
drop trigger if exists clientes_atualizado on public.clientes;
create trigger clientes_atualizado before update on public.clientes for each row execute function public.toca_atualizado();
drop trigger if exists veiculos_atualizado on public.veiculos;
create trigger veiculos_atualizado before update on public.veiculos for each row execute function public.toca_atualizado();
drop trigger if exists produtos_atualizado on public.produtos;
create trigger produtos_atualizado before update on public.produtos for each row execute function public.toca_atualizado();

-- ---------------------------------------------------------------------
-- Regras de acesso
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.produtos, public.recibos to authenticated;
grant select on public.estoque_mov to authenticated;
grant usage, select on sequence public.clientes_codigo_seq, public.produtos_codigo_seq, public.recibos_numero_seq to authenticated;

alter table public.produtos enable row level security;
alter table public.estoque_mov enable row level security;
alter table public.recibos enable row level security;

drop policy if exists produtos_ler on public.produtos;
create policy produtos_ler on public.produtos for select to authenticated using (public.e_membro());
drop policy if exists produtos_incluir on public.produtos;
create policy produtos_incluir on public.produtos for insert to authenticated with check (public.e_gestor());
drop policy if exists produtos_alterar on public.produtos;
create policy produtos_alterar on public.produtos for update to authenticated using (public.e_gestor()) with check (public.e_gestor());
drop policy if exists produtos_excluir on public.produtos;
create policy produtos_excluir on public.produtos for delete to authenticated using (public.e_admin());

drop policy if exists estoque_mov_ler on public.estoque_mov;
create policy estoque_mov_ler on public.estoque_mov for select to authenticated using (public.e_membro());

drop policy if exists recibos_ler on public.recibos;
create policy recibos_ler on public.recibos for select to authenticated using (public.e_membro());
drop policy if exists recibos_incluir on public.recibos;
create policy recibos_incluir on public.recibos for insert to authenticated with check (public.e_gestor());
drop policy if exists recibos_alterar on public.recibos;
create policy recibos_alterar on public.recibos for update to authenticated using (public.e_gestor()) with check (public.e_gestor());

-- ---------------------------------------------------------------------
-- Resumo do painel calculado no servidor (uma consulta em vez de milhares de linhas)
-- ---------------------------------------------------------------------
create or replace function public.painel_resumo(p_ini timestamptz, p_fim timestamptz, p_grupo text default 'dia')
returns jsonb language sql stable set search_path = public as $$
  with sa as (
    select o.* from public.ordens o
    where o.status in ('entregue', 'recusado') and o.entregue_em >= p_ini and o.entregue_em < p_fim and o.total > 0
  ),
  it as (
    select i.tipo, lower(trim(i.descricao)) as chave, i.descricao,
           i.qtd * i.valor_unit - coalesce(i.desconto, 0) as valor, i.qtd * coalesce(i.custo_unit, 0) as custo
    from public.os_itens i join sa on sa.id = i.ordem_id
    where i.aprovado is not false
  ),
  dec as (
    select o.status from public.ordens o
    where coalesce(o.orcamento_enviado_em, o.criado_em) >= p_ini and coalesce(o.orcamento_enviado_em, o.criado_em) < p_fim
      and o.status in ('execucao', 'pronto', 'entregue', 'recusado')
  )
  select jsonb_build_object(
    'faturamento', coalesce((select sum(total) from sa), 0),
    'custo', coalesce((select sum(custo) from sa), 0),
    'saidas', (select count(*) from sa),
    'entregues', (select count(*) from sa where status = 'entregue'),
    'prazo_medio', (select avg(extract(epoch from (entregue_em - criado_em)) / 86400) from sa where status = 'entregue'),
    'entradas', (select count(*) from public.ordens where criado_em >= p_ini and criado_em < p_fim and status <> 'cancelado'),
    'decididos', (select count(*) from dec),
    'aprovados', (select count(*) from dec where status <> 'recusado'),
    'composicao', jsonb_build_object(
      'servico', coalesce((select sum(valor) from it where tipo = 'servico'), 0),
      'peca', coalesce((select sum(valor) from it where tipo = 'peca'), 0),
      'terceiro', coalesce((select sum(valor) from it where tipo = 'terceiro'), 0),
      'custo_peca', coalesce((select sum(custo) from it where tipo = 'peca'), 0),
      'peca_com_custo', coalesce((select sum(valor) from it where tipo = 'peca' and custo > 0), 0)),
    'top_servicos', coalesce((select jsonb_agg(t) from (
        select min(descricao) as nome, sum(valor) as v, count(*) as n from it where tipo = 'servico' group by chave order by sum(valor) desc limit 6) t), '[]'::jsonb),
    'top_pecas', coalesce((select jsonb_agg(t) from (
        select min(descricao) as nome, sum(valor) as v, count(*) as n from it where tipo = 'peca' group by chave order by sum(valor) desc limit 6) t), '[]'::jsonb),
    'formas', coalesce((select jsonb_agg(t) from (
        select coalesce(nullif(forma_pagamento, ''), 'Não informado') as forma, sum(total) as v from sa group by 1 order by 2 desc) t), '[]'::jsonb),
    'serie', coalesce((select jsonb_agg(t order by t.k) from (
        select to_char(date_trunc(case when p_grupo = 'mes' then 'month' else 'day' end, entregue_em at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as k, sum(total) as v
        from sa group by 1) t), '[]'::jsonb),
    'recebido', coalesce((select sum(valor) from public.recibos
        where not cancelado and data >= (p_ini at time zone 'America/Sao_Paulo')::date and data <= ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date), 0)
  )
$$;
grant execute on function public.painel_resumo(timestamptz, timestamptz, text) to authenticated;
grant execute on function public.movimentar_estoque(uuid, text, numeric, numeric, text) to authenticated;

-- ---------------------------------------------------------------------
-- Importação do OS Oficina 3.0 pelo site (somente administrador).
-- Completa os cadastros já importados sem apagar o que foi editado no
-- DTCar Gestão e inclui o que for novo. Pode ser repetida.
-- ---------------------------------------------------------------------
create or replace function public.importar_legado(p_tipo text, p_linhas jsonb, p_atualizar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n_ins int := 0; n_upd int := 0; pulados jsonb := '[]'::jsonb;
begin
  if not public.e_admin() then raise exception 'Somente o administrador pode importar dados.'; end if;

  if p_tipo = 'clientes' then
    create temp table x on commit drop as select * from jsonb_to_recordset(p_linhas) as x(
      id uuid, codigo int, nome text, telefone text, doc text, email text, endereco text, obs text, obs_antiga text, nascimento date, origem text, criado_em timestamptz,
      fantasia text, rua text, complemento text, bairro text, cidade text, uf text, cep text, telefone2 text, telefone3 text, contato text, rg text, orgao_emissor text,
      ie text, im text, tipo_cliente text, situacao text, restricao text, ficha jsonb, historico text);
    update public.clientes c set
      codigo = case when c.codigo = x.codigo or exists (select 1 from public.clientes o where o.codigo = x.codigo and o.id <> c.id) then c.codigo else x.codigo end,
      telefone = case when c.telefone = '' then coalesce(x.telefone, '') else c.telefone end,
      doc = case when c.doc = '' and coalesce(x.doc, '') <> '' and not exists (select 1 from public.clientes o where o.doc = x.doc and o.id <> c.id) then x.doc else c.doc end,
      email = case when c.email = '' then coalesce(x.email, '') else c.email end,
      endereco = case when c.endereco = '' then coalesce(x.endereco, '') else c.endereco end,
      nascimento = coalesce(c.nascimento, x.nascimento),
      obs = case when c.obs = x.obs_antiga then coalesce(x.obs, '') else c.obs end,
      fantasia = case when c.fantasia = '' then coalesce(x.fantasia, '') else c.fantasia end,
      rua = case when c.rua = '' then coalesce(x.rua, '') else c.rua end,
      complemento = case when c.complemento = '' then coalesce(x.complemento, '') else c.complemento end,
      bairro = case when c.bairro = '' then coalesce(x.bairro, '') else c.bairro end,
      cidade = case when c.cidade = '' then coalesce(x.cidade, '') else c.cidade end,
      uf = case when c.uf = '' then coalesce(x.uf, '') else c.uf end,
      cep = case when c.cep = '' then coalesce(x.cep, '') else c.cep end,
      telefone2 = case when c.telefone2 = '' then coalesce(x.telefone2, '') else c.telefone2 end,
      telefone3 = case when c.telefone3 = '' then coalesce(x.telefone3, '') else c.telefone3 end,
      contato = case when c.contato = '' then coalesce(x.contato, '') else c.contato end,
      rg = case when c.rg = '' then coalesce(x.rg, '') else c.rg end,
      orgao_emissor = case when c.orgao_emissor = '' then coalesce(x.orgao_emissor, '') else c.orgao_emissor end,
      ie = case when c.ie = '' then coalesce(x.ie, '') else c.ie end,
      im = case when c.im = '' then coalesce(x.im, '') else c.im end,
      tipo_cliente = case when c.tipo_cliente = '' then coalesce(x.tipo_cliente, '') else c.tipo_cliente end,
      situacao = case when c.situacao = 'liberado' and c.restricao = '' then coalesce(nullif(x.situacao, ''), 'liberado') else c.situacao end,
      restricao = case when c.restricao = '' then coalesce(x.restricao, '') else c.restricao end,
      ficha = coalesce(x.ficha, '{}'::jsonb) || c.ficha,
      historico = case when c.historico = '' then coalesce(x.historico, '') else c.historico end
    from x where c.id = x.id;
    get diagnostics n_upd = row_count;
    insert into public.clientes (id, codigo, nome, telefone, doc, email, endereco, obs, nascimento, origem, criado_em, fantasia, rua, complemento, bairro, cidade, uf, cep,
      telefone2, telefone3, contato, rg, orgao_emissor, ie, im, tipo_cliente, situacao, restricao, ficha, historico)
    select x.id, case when exists (select 1 from public.clientes o where o.codigo = x.codigo) then nextval('public.clientes_codigo_seq') else x.codigo end,
      x.nome, coalesce(x.telefone, ''), case when coalesce(x.doc, '') <> '' and not exists (select 1 from public.clientes o where o.doc = x.doc) then x.doc else '' end,
      coalesce(x.email, ''), coalesce(x.endereco, ''), coalesce(x.obs, ''), x.nascimento, coalesce(x.origem, ''), coalesce(x.criado_em, now()), coalesce(x.fantasia, ''),
      coalesce(x.rua, ''), coalesce(x.complemento, ''), coalesce(x.bairro, ''), coalesce(x.cidade, ''), coalesce(x.uf, ''), coalesce(x.cep, ''), coalesce(x.telefone2, ''),
      coalesce(x.telefone3, ''), coalesce(x.contato, ''), coalesce(x.rg, ''), coalesce(x.orgao_emissor, ''), coalesce(x.ie, ''), coalesce(x.im, ''), coalesce(x.tipo_cliente, ''),
      coalesce(nullif(x.situacao, ''), 'liberado'), coalesce(x.restricao, ''), coalesce(x.ficha, '{}'::jsonb), coalesce(x.historico, '')
    from x where not exists (select 1 from public.clientes c where c.id = x.id);
    get diagnostics n_ins = row_count;
    perform setval('public.clientes_codigo_seq', greatest((select max(codigo) from public.clientes), 1));

  elsif p_tipo = 'veiculos' then
    create temp table x on commit drop as select * from jsonb_to_recordset(p_linhas) as x(
      id uuid, placa text, marca text, modelo text, ano text, cor text, motor text, cliente_id uuid, km_atual int, obs text, obs_antiga text, criado_em timestamptz,
      ano_fab int, ano_mod int, chassi text, renavam text, combustivel text, motorista text, revisao_data date, revisao_km int, oleo_data date, oleo_km int, filtro_data date, filtro_km int);
    update public.veiculos v set
      marca = case when v.marca = '' then coalesce(x.marca, '') else v.marca end,
      modelo = case when v.modelo = '' then coalesce(x.modelo, '') else v.modelo end,
      ano = case when v.ano = '' then coalesce(x.ano, '') else v.ano end,
      cor = case when v.cor = '' then coalesce(x.cor, '') else v.cor end,
      cliente_id = coalesce(v.cliente_id, (select c.id from public.clientes c where c.id = x.cliente_id)),
      km_atual = nullif(greatest(coalesce(v.km_atual, 0), coalesce(x.km_atual, 0)), 0),
      obs = case when v.obs = x.obs_antiga or v.obs = '' then coalesce(x.obs, '') else v.obs end,
      ano_fab = coalesce(v.ano_fab, x.ano_fab), ano_mod = coalesce(v.ano_mod, x.ano_mod),
      chassi = case when v.chassi = '' then coalesce(x.chassi, '') else v.chassi end,
      renavam = case when v.renavam = '' then coalesce(x.renavam, '') else v.renavam end,
      combustivel = case when v.combustivel = '' then coalesce(x.combustivel, '') else v.combustivel end,
      motorista = case when v.motorista = '' then coalesce(x.motorista, '') else v.motorista end,
      revisao_data = coalesce(v.revisao_data, x.revisao_data), revisao_km = coalesce(v.revisao_km, x.revisao_km),
      oleo_data = coalesce(v.oleo_data, x.oleo_data), oleo_km = coalesce(v.oleo_km, x.oleo_km),
      filtro_data = coalesce(v.filtro_data, x.filtro_data), filtro_km = coalesce(v.filtro_km, x.filtro_km)
    from x where v.placa = x.placa;
    get diagnostics n_upd = row_count;
    insert into public.veiculos (id, placa, marca, modelo, ano, cor, motor, cliente_id, km_atual, obs, criado_em, ano_fab, ano_mod, chassi, renavam, combustivel, motorista,
      revisao_data, revisao_km, oleo_data, oleo_km, filtro_data, filtro_km)
    select x.id, x.placa, coalesce(x.marca, ''), coalesce(x.modelo, ''), coalesce(x.ano, ''), coalesce(x.cor, ''), coalesce(x.motor, ''),
      (select c.id from public.clientes c where c.id = x.cliente_id), x.km_atual, coalesce(x.obs, ''), coalesce(x.criado_em, now()), x.ano_fab, x.ano_mod,
      coalesce(x.chassi, ''), coalesce(x.renavam, ''), coalesce(x.combustivel, ''), coalesce(x.motorista, ''), x.revisao_data, x.revisao_km, x.oleo_data, x.oleo_km, x.filtro_data, x.filtro_km
    from x where not exists (select 1 from public.veiculos v where v.placa = x.placa) and not exists (select 1 from public.veiculos v where v.id = x.id);
    get diagnostics n_ins = row_count;

  elsif p_tipo = 'produtos' then
    create temp table x on commit drop as select * from jsonb_to_recordset(p_linhas) as x(
      id uuid, codigo int, tipo text, descricao text, referencia text, codigo_barras text, unidade text, categoria text, marca text, localizacao text,
      estoque_min numeric, estoque_atual numeric, custo numeric, margem_vista numeric, preco_vista numeric, margem_prazo numeric, preco_prazo numeric,
      margem_atacado numeric, preco_atacado numeric, controla_estoque boolean, vender_sem_estoque boolean, avisar_estoque_baixo boolean, obs text, criado_em timestamptz);
    if p_atualizar then
      update public.produtos p set referencia = x.referencia, codigo_barras = x.codigo_barras, unidade = x.unidade, categoria = x.categoria, marca = x.marca,
        localizacao = x.localizacao, estoque_min = x.estoque_min, estoque_atual = x.estoque_atual, custo = x.custo, margem_vista = x.margem_vista, preco_vista = x.preco_vista,
        margem_prazo = x.margem_prazo, preco_prazo = x.preco_prazo, margem_atacado = x.margem_atacado, preco_atacado = x.preco_atacado
      from x where p.id = x.id;
      get diagnostics n_upd = row_count;
    end if;
    insert into public.produtos (id, codigo, tipo, descricao, referencia, codigo_barras, unidade, categoria, marca, localizacao, estoque_min, estoque_atual, custo,
      margem_vista, preco_vista, margem_prazo, preco_prazo, margem_atacado, preco_atacado, controla_estoque, vender_sem_estoque, avisar_estoque_baixo, obs, criado_em)
    select x.id, case when x.rn > 1 or exists (select 1 from public.produtos o where o.codigo = x.codigo) then nextval('public.produtos_codigo_seq') else x.codigo end,
      x.tipo, x.descricao, coalesce(x.referencia, ''), coalesce(x.codigo_barras, ''), coalesce(nullif(x.unidade, ''), 'UN'), coalesce(x.categoria, ''), coalesce(x.marca, ''),
      coalesce(x.localizacao, ''), coalesce(x.estoque_min, 0), coalesce(x.estoque_atual, 0), coalesce(x.custo, 0), coalesce(x.margem_vista, 0), coalesce(x.preco_vista, 0),
      coalesce(x.margem_prazo, 0), coalesce(x.preco_prazo, 0), coalesce(x.margem_atacado, 0), coalesce(x.preco_atacado, 0), coalesce(x.controla_estoque, true),
      coalesce(x.vender_sem_estoque, true), coalesce(x.avisar_estoque_baixo, false), coalesce(x.obs, ''), coalesce(x.criado_em, now())
    from (select x.*, row_number() over (partition by x.codigo order by x.criado_em, x.descricao) as rn from x
          where not exists (select 1 from public.produtos p where p.id = x.id)) x;
    get diagnostics n_ins = row_count;
    -- serviço do cadastro antigo substitui o equivalente criado a partir do histórico
    update public.produtos h set ativo = false from x
      where x.tipo = 'servico' and h.tipo = 'servico' and h.id <> x.id and h.categoria = 'Histórico (sistema anterior)' and lower(h.descricao) = lower(x.descricao);

  elsif p_tipo = 'ordens' then
    create temp table x on commit drop as select * from jsonb_populate_recordset(null::public.ordens, p_linhas);
    update public.ordens o set box = case when o.box = '' then x.box else o.box end, contato = case when o.contato = '' then x.contato else o.contato end
      from x where o.id = x.id and (x.box <> '' or x.contato <> '');
    get diagnostics n_upd = row_count;
    select coalesce(jsonb_agg(x.numero order by x.numero), '[]'::jsonb) into pulados from x
      where not exists (select 1 from public.ordens o where o.id = x.id) and exists (select 1 from public.ordens o where o.numero = x.numero);
    insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, combustivel, funcionando, reclamacao, checkin, mecanico_nome,
      diagnostico, condicoes_pagamento, orcamento_enviado_em, aprovacao, desconto, total, custo, forma_pagamento, garantia_dias, entregue_em, obs_execucao, obs_internas,
      criado_em, box, contato, tabela_preco, estoque_baixado)
    select x.id, x.numero, x.status, (select c.id from public.clientes c where c.id = x.cliente_id), (select v.id from public.veiculos v where v.id = x.veiculo_id),
      x.cliente, x.veiculo, x.km_entrada, coalesce(x.combustivel, ''), coalesce(x.funcionando, ''), coalesce(x.reclamacao, ''), x.checkin, coalesce(x.mecanico_nome, ''),
      coalesce(x.diagnostico, ''), coalesce(x.condicoes_pagamento, ''), x.orcamento_enviado_em, x.aprovacao, x.desconto, x.total, x.custo, coalesce(x.forma_pagamento, ''),
      x.garantia_dias, x.entregue_em, coalesce(x.obs_execucao, ''), coalesce(x.obs_internas, ''), x.criado_em, coalesce(x.box, ''), coalesce(x.contato, ''),
      coalesce(x.tabela_preco, 'vista'), coalesce(x.estoque_baixado, false)
    from x where not exists (select 1 from public.ordens o where o.id = x.id or o.numero = x.numero);
    get diagnostics n_ins = row_count;
    perform setval('public.os_numero_seq', greatest((select max(numero) from public.ordens), 1));

  elsif p_tipo = 'itens' then
    create temp table x on commit drop as select * from jsonb_populate_recordset(null::public.os_itens, p_linhas);
    update public.os_itens i set produto_id = x.produto_id
      from x where i.id = x.id and i.produto_id is null and x.produto_id is not null and exists (select 1 from public.produtos p where p.id = x.produto_id);
    get diagnostics n_upd = row_count;
    insert into public.os_itens (id, ordem_id, tipo, descricao, codigo, fornecedor, qtd, valor_unit, custo_unit, horas, produto_id, desconto, fornecida_cliente, qualidade,
      adicional, aprovado, executado, posicao, criado_em)
    select x.id, x.ordem_id, x.tipo, x.descricao, coalesce(x.codigo, ''), '', x.qtd, x.valor_unit, coalesce(x.custo_unit, 0), x.horas,
      (select p.id from public.produtos p where p.id = x.produto_id), 0, false, '', false, x.aprovado, coalesce(x.executado, false), coalesce(x.posicao, 0), coalesce(x.criado_em, now())
    -- só para O.S. sem nenhum item (recém-importadas): não ressuscita itens removidos no DTCar Gestão
    from x where exists (select 1 from public.ordens o where o.id = x.ordem_id) and not exists (select 1 from public.os_itens i where i.ordem_id = x.ordem_id);
    get diagnostics n_ins = row_count;

  elsif p_tipo = 'eventos' then
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome, criado_em)
    select x.ordem_id, x.tipo, x.texto, x.usuario_nome, x.criado_em
    from jsonb_to_recordset(p_linhas) as x(ordem_id uuid, tipo text, texto text, usuario_nome text, criado_em timestamptz)
    where exists (select 1 from public.ordens o where o.id = x.ordem_id)
      and not exists (select 1 from public.eventos e where e.ordem_id = x.ordem_id and e.tipo = 'importacao');
    get diagnostics n_ins = row_count;
  else
    raise exception 'Tipo de importação desconhecido: %', p_tipo;
  end if;
  return jsonb_build_object('incluidos', n_ins, 'atualizados', n_upd, 'pulados', pulados);
end $$;
grant execute on function public.importar_legado(text, jsonb, boolean) to authenticated;
