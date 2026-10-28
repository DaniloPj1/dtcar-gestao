-- =====================================================================
-- DTCar Gestão — versão 4
-- Fornecedores, entrada de mercadoria pelo XML da NF-e, venda de balcão
-- e resumo do painel incluindo as vendas. Rode DEPOIS do v3.sql.
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fornecedores e vínculo produto × fornecedor (código do fornecedor)
-- ---------------------------------------------------------------------
create table if not exists public.fornecedores (
  id uuid primary key default gen_random_uuid(),
  cnpj text not null default '',
  razao text not null,
  fantasia text not null default '',
  ie text not null default '',
  telefone text not null default '',
  email text not null default '',
  endereco text not null default '',
  bairro text not null default '',
  cidade text not null default '',
  uf text not null default '',
  cep text not null default '',
  contato text not null default '',
  obs text not null default '',
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists fornecedores_cnpj_unico on public.fornecedores (cnpj) where cnpj <> '';
create index if not exists fornecedores_atualizado on public.fornecedores (atualizado_em);
drop trigger if exists fornecedores_atualizado on public.fornecedores;
create trigger fornecedores_atualizado before update on public.fornecedores for each row execute function public.toca_atualizado();

create table if not exists public.produto_fornecedor (
  id uuid primary key default gen_random_uuid(),
  produto_id uuid not null references public.produtos (id) on delete cascade,
  fornecedor_id uuid not null references public.fornecedores (id) on delete cascade,
  codigo text not null,                 -- código do produto no fornecedor (cProd da NF-e)
  ean text not null default '',
  descricao text not null default '',   -- descrição como vem na nota
  unidade text not null default '',
  fator numeric(12, 4) not null default 1 check (fator > 0), -- 1 unidade da nota = fator unidades no estoque
  ultimo_custo numeric(12, 4),
  ultima_compra date,
  criado_em timestamptz not null default now(),
  unique (fornecedor_id, codigo)
);
create index if not exists produto_fornecedor_produto on public.produto_fornecedor (produto_id);

create table if not exists public.notas_entrada (
  id uuid primary key default gen_random_uuid(),
  chave text not null default '',
  numero text not null default '',
  serie text not null default '',
  fornecedor_id uuid references public.fornecedores (id) on delete set null,
  emissao timestamptz,
  valor_total numeric(12, 2) not null default 0,
  itens jsonb not null default '[]'::jsonb,
  usuario_nome text not null default '',
  criado_em timestamptz not null default now()
);
create unique index if not exists notas_entrada_chave on public.notas_entrada (chave) where chave <> '';

-- ---------------------------------------------------------------------
-- Venda de balcão
-- ---------------------------------------------------------------------
create sequence if not exists public.vendas_numero_seq;
create table if not exists public.vendas (
  id uuid primary key default gen_random_uuid(),
  numero int not null default nextval('public.vendas_numero_seq'),
  cliente_id uuid references public.clientes (id) on delete set null,
  cliente jsonb not null default '{}'::jsonb,
  tabela_preco text not null default 'vista',
  subtotal numeric(12, 2) not null default 0,
  desconto numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  custo numeric(12, 2) not null default 0,
  forma_pagamento text not null default '',
  obs text not null default '',
  status text not null default 'concluida' check (status in ('concluida', 'cancelada')),
  vendedor_nome text not null default '',
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  cancelada_em timestamptz,
  cancelada_motivo text not null default ''
);
create unique index if not exists vendas_numero_unico on public.vendas (numero);
create index if not exists vendas_criado on public.vendas (criado_em desc);

create table if not exists public.venda_itens (
  id uuid primary key default gen_random_uuid(),
  venda_id uuid not null references public.vendas (id) on delete cascade,
  produto_id uuid references public.produtos (id) on delete set null,
  tipo text not null default 'produto' check (tipo in ('produto', 'servico')),
  descricao text not null,
  codigo text not null default '',
  qtd numeric(12, 3) not null default 1,
  valor_unit numeric(12, 2) not null default 0,
  desconto numeric(12, 2) not null default 0,
  custo_unit numeric(12, 4) not null default 0,
  posicao int not null default 0
);
create index if not exists venda_itens_venda on public.venda_itens (venda_id);

alter table public.recibos add column if not exists venda_id uuid references public.vendas (id) on delete set null;
alter table public.estoque_mov add column if not exists venda_id uuid references public.vendas (id) on delete set null;
alter table public.estoque_mov drop constraint if exists estoque_mov_tipo_check;
alter table public.estoque_mov add constraint estoque_mov_tipo_check check (tipo in ('entrada', 'saida', 'ajuste', 'estorno'));

-- finaliza a venda de uma vez: grava, baixa o estoque e confere o saldo
create or replace function public.finalizar_venda(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.vendas; it jsonb; pr public.produtos; v_nome text; sub numeric := 0; cus numeric := 0; n int := 0; novo numeric;
begin
  if not public.e_gestor() then raise exception 'Seu usuário não tem permissão para vender.'; end if;
  if jsonb_array_length(coalesce(p->'itens', '[]'::jsonb)) = 0 then raise exception 'Inclua pelo menos um item.'; end if;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  insert into public.vendas (cliente_id, cliente, tabela_preco, desconto, forma_pagamento, obs, vendedor_nome)
  values (nullif(p->>'cliente_id', '')::uuid, coalesce(p->'cliente', '{}'::jsonb), coalesce(nullif(p->>'tabela_preco', ''), 'vista'),
          coalesce((p->>'desconto')::numeric, 0), coalesce(p->>'forma_pagamento', ''), coalesce(p->>'obs', ''), coalesce(v_nome, ''))
  returning * into v;
  for it in select * from jsonb_array_elements(p->'itens') loop
    pr := null;
    if nullif(it->>'produto_id', '') is not null then select * into pr from public.produtos where id = (it->>'produto_id')::uuid for update; end if;
    if pr.id is not null and pr.tipo = 'produto' and pr.controla_estoque and not pr.vender_sem_estoque and pr.estoque_atual < (it->>'qtd')::numeric then
      raise exception 'Estoque insuficiente de % (há % %).', pr.descricao, trim(to_char(pr.estoque_atual, 'FM999990.###')), pr.unidade;
    end if;
    insert into public.venda_itens (venda_id, produto_id, tipo, descricao, codigo, qtd, valor_unit, desconto, custo_unit, posicao)
    values (v.id, pr.id, case when coalesce(pr.tipo, it->>'tipo') = 'servico' then 'servico' else 'produto' end, it->>'descricao', coalesce(it->>'codigo', ''),
            (it->>'qtd')::numeric, (it->>'valor_unit')::numeric, coalesce((it->>'desconto')::numeric, 0), coalesce(pr.custo, coalesce((it->>'custo_unit')::numeric, 0)), n);
    sub := sub + (it->>'qtd')::numeric * (it->>'valor_unit')::numeric - coalesce((it->>'desconto')::numeric, 0);
    cus := cus + (it->>'qtd')::numeric * coalesce(pr.custo, coalesce((it->>'custo_unit')::numeric, 0));
    if pr.id is not null and pr.tipo = 'produto' and pr.controla_estoque then
      update public.produtos set estoque_atual = estoque_atual - (it->>'qtd')::numeric where id = pr.id returning estoque_atual into novo;
      insert into public.estoque_mov (produto_id, venda_id, tipo, qtd, saldo, obs, usuario_nome)
      values (pr.id, v.id, 'saida', -(it->>'qtd')::numeric, novo, 'Venda balcão ' || lpad(v.numero::text, 5, '0'), coalesce(v_nome, ''));
    end if;
    n := n + 1;
  end loop;
  update public.vendas set subtotal = round(sub, 2), total = greatest(0, round(sub - desconto, 2)), custo = round(cus, 2) where id = v.id returning * into v;
  return to_jsonb(v);
end $$;

create or replace function public.cancelar_venda(p_id uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.vendas; r record; novo numeric; v_nome text;
begin
  if not public.e_gestor() then raise exception 'Seu usuário não tem permissão para cancelar vendas.'; end if;
  select * into v from public.vendas where id = p_id for update;
  if not found or v.status = 'cancelada' then raise exception 'Venda não encontrada ou já cancelada.'; end if;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  for r in select i.produto_id, sum(i.qtd) qtd from public.venda_itens i join public.produtos p on p.id = i.produto_id
           where i.venda_id = p_id and p.tipo = 'produto' and p.controla_estoque group by i.produto_id loop
    update public.produtos set estoque_atual = estoque_atual + r.qtd where id = r.produto_id returning estoque_atual into novo;
    insert into public.estoque_mov (produto_id, venda_id, tipo, qtd, saldo, obs, usuario_nome)
    values (r.produto_id, p_id, 'estorno', r.qtd, novo, 'Cancelamento da venda ' || lpad(v.numero::text, 5, '0'), coalesce(v_nome, ''));
  end loop;
  update public.vendas set status = 'cancelada', cancelada_em = now(), cancelada_motivo = coalesce(p_motivo, '') where id = p_id;
  update public.recibos set cancelado = true, cancelado_motivo = 'Venda ' || lpad(v.numero::text, 5, '0') || ' cancelada' where venda_id = p_id and not cancelado;
end $$;

-- ---------------------------------------------------------------------
-- Entrada de mercadoria pelo XML da NF-e
-- p = { nota:{chave,numero,serie,emissao,valor_total}, fornecedor:{cnpj,razao,...},
--       itens:[{acao:'vincular'|'novo'|'ignorar', produto_id, codigo, ean, descricao_nf, unidade, fator, qtd, custo_unit, atualizar_custo, novo:{...}}] }
-- ---------------------------------------------------------------------
create or replace function public.importar_nfe(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare f jsonb := p->'fornecedor'; nt jsonb := p->'nota'; it jsonb; nv jsonb; forn uuid; pid uuid; v_nome text; ean text;
  qtd_est numeric; custo_est numeric; fator numeric; novo numeric; n_novo int := 0; n_vinc int := 0; n_ign int := 0; resumo jsonb := '[]'::jsonb; nota_ref text;
begin
  if not public.e_gestor() then raise exception 'Seu usuário não tem permissão para dar entrada em notas.'; end if;
  if coalesce(nt->>'chave', '') <> '' and exists (select 1 from public.notas_entrada where chave = nt->>'chave') then
    raise exception 'Esta nota já foi importada (chave %).', nt->>'chave';
  end if;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  -- fornecedor: localiza pelo CNPJ, completa o que estiver vazio
  select id into forn from public.fornecedores where cnpj <> '' and cnpj = coalesce(f->>'cnpj', '');
  if forn is null then
    insert into public.fornecedores (cnpj, razao, fantasia, ie, telefone, email, endereco, bairro, cidade, uf, cep)
    values (coalesce(f->>'cnpj', ''), coalesce(nullif(f->>'razao', ''), 'Fornecedor sem nome'), coalesce(f->>'fantasia', ''), coalesce(f->>'ie', ''), coalesce(f->>'telefone', ''),
            coalesce(f->>'email', ''), coalesce(f->>'endereco', ''), coalesce(f->>'bairro', ''), coalesce(f->>'cidade', ''), coalesce(f->>'uf', ''), coalesce(f->>'cep', ''))
    returning id into forn;
  else
    update public.fornecedores set fantasia = case when fantasia = '' then coalesce(f->>'fantasia', '') else fantasia end,
      ie = case when ie = '' then coalesce(f->>'ie', '') else ie end, telefone = case when telefone = '' then coalesce(f->>'telefone', '') else telefone end,
      endereco = case when endereco = '' then coalesce(f->>'endereco', '') else endereco end, bairro = case when bairro = '' then coalesce(f->>'bairro', '') else bairro end,
      cidade = case when cidade = '' then coalesce(f->>'cidade', '') else cidade end, uf = case when uf = '' then coalesce(f->>'uf', '') else uf end,
      cep = case when cep = '' then coalesce(f->>'cep', '') else cep end where id = forn;
  end if;
  nota_ref := 'NF ' || coalesce(nullif(nt->>'numero', ''), '?') || ' – ' || coalesce(nullif(f->>'fantasia', ''), f->>'razao', '');
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    if it->>'acao' = 'ignorar' then n_ign := n_ign + 1; continue; end if;
    fator := greatest(coalesce((it->>'fator')::numeric, 1), 0.0001);
    ean := case when coalesce(it->>'ean', '') ~ '^\d{8,14}$' then it->>'ean' else '' end; -- "SEM GTIN" e similares ficam vazios
    qtd_est := (it->>'qtd')::numeric * fator;
    custo_est := round((it->>'custo_unit')::numeric / fator, 4);
    if it->>'acao' = 'novo' then
      nv := coalesce(it->'novo', '{}'::jsonb);
      insert into public.produtos (tipo, descricao, referencia, codigo_barras, unidade, categoria, marca, localizacao, estoque_min, estoque_atual, custo,
        margem_vista, preco_vista, margem_prazo, preco_prazo, margem_atacado, preco_atacado, controla_estoque, vender_sem_estoque, avisar_estoque_baixo, obs)
      values ('produto', coalesce(nullif(nv->>'descricao', ''), it->>'descricao_nf'), coalesce(nv->>'referencia', it->>'codigo', ''), ean,
        coalesce(nullif(nv->>'unidade', ''), 'UN'), coalesce(nv->>'categoria', ''), coalesce(nv->>'marca', ''), coalesce(nv->>'localizacao', ''), coalesce((nv->>'estoque_min')::numeric, 0), 0, custo_est,
        coalesce((nv->>'margem_vista')::numeric, 0), round(custo_est * (1 + coalesce((nv->>'margem_vista')::numeric, 0) / 100), 2),
        coalesce((nv->>'margem_prazo')::numeric, 0), round(custo_est * (1 + coalesce((nv->>'margem_prazo')::numeric, (nv->>'margem_vista')::numeric, 0) / 100), 2),
        coalesce((nv->>'margem_atacado')::numeric, 0), round(custo_est * (1 + coalesce((nv->>'margem_atacado')::numeric, (nv->>'margem_vista')::numeric, 0) / 100), 2),
        true, true, coalesce((nv->>'estoque_min')::numeric, 0) > 0, coalesce(nv->>'obs', ''))
      returning id into pid;
      n_novo := n_novo + 1;
    else
      pid := (it->>'produto_id')::uuid;
      if not exists (select 1 from public.produtos where id = pid) then raise exception 'Produto vinculado não encontrado: %', it->>'descricao_nf'; end if;
      n_vinc := n_vinc + 1;
    end if;
    insert into public.produto_fornecedor (produto_id, fornecedor_id, codigo, ean, descricao, unidade, fator, ultimo_custo, ultima_compra)
    values (pid, forn, coalesce(it->>'codigo', ''), ean, coalesce(it->>'descricao_nf', ''), coalesce(it->>'unidade', ''), fator,
            (it->>'custo_unit')::numeric, coalesce((nt->>'emissao')::date, current_date))
    on conflict (fornecedor_id, codigo) do update set produto_id = excluded.produto_id, ean = excluded.ean, descricao = excluded.descricao, unidade = excluded.unidade,
      fator = excluded.fator, ultimo_custo = excluded.ultimo_custo, ultima_compra = excluded.ultima_compra;
    update public.produtos set estoque_atual = estoque_atual + qtd_est,
      codigo_barras = case when codigo_barras = '' then ean else codigo_barras end,
      custo = case when coalesce((it->>'atualizar_custo')::boolean, true) then custo_est else custo end,
      preco_vista = case when coalesce((it->>'atualizar_custo')::boolean, true) and margem_vista > 0 then round(custo_est * (1 + margem_vista / 100), 2) else preco_vista end,
      preco_prazo = case when coalesce((it->>'atualizar_custo')::boolean, true) and margem_prazo > 0 then round(custo_est * (1 + margem_prazo / 100), 2) else preco_prazo end,
      preco_atacado = case when coalesce((it->>'atualizar_custo')::boolean, true) and margem_atacado > 0 then round(custo_est * (1 + margem_atacado / 100), 2) else preco_atacado end
    where id = pid returning estoque_atual into novo;
    insert into public.estoque_mov (produto_id, tipo, qtd, saldo, custo_unit, obs, usuario_nome)
    values (pid, 'entrada', qtd_est, novo, custo_est, nota_ref, coalesce(v_nome, ''));
    resumo := resumo || jsonb_build_array(jsonb_build_object('produto_id', pid, 'codigo', it->>'codigo', 'descricao', it->>'descricao_nf', 'qtd', qtd_est, 'custo', custo_est, 'acao', it->>'acao'));
  end loop;
  insert into public.notas_entrada (chave, numero, serie, fornecedor_id, emissao, valor_total, itens, usuario_nome)
  values (coalesce(nt->>'chave', ''), coalesce(nt->>'numero', ''), coalesce(nt->>'serie', ''), forn, nullif(nt->>'emissao', '')::timestamptz,
          coalesce((nt->>'valor_total')::numeric, 0), resumo, coalesce(v_nome, ''));
  return jsonb_build_object('fornecedor_id', forn, 'novos', n_novo, 'vinculados', n_vinc, 'ignorados', n_ign);
end $$;

-- ---------------------------------------------------------------------
-- Painel: inclui as vendas de balcão
-- ---------------------------------------------------------------------
create or replace function public.painel_resumo(p_ini timestamptz, p_fim timestamptz, p_grupo text default 'dia')
returns jsonb language sql stable set search_path = public as $$
  with sa as (
    select o.* from public.ordens o
    where o.status in ('entregue', 'recusado') and o.entregue_em >= p_ini and o.entregue_em < p_fim and o.total > 0
  ),
  vb as (select v.* from public.vendas v where v.status = 'concluida' and v.criado_em >= p_ini and v.criado_em < p_fim),
  it as (
    select i.tipo, lower(trim(i.descricao)) as chave, i.descricao,
           i.qtd * i.valor_unit - coalesce(i.desconto, 0) as valor, i.qtd * coalesce(i.custo_unit, 0) as custo
    from public.os_itens i join sa on sa.id = i.ordem_id
    where i.aprovado is not false
    union all
    select case when vi.tipo = 'servico' then 'servico' else 'peca' end, lower(trim(vi.descricao)), vi.descricao,
           vi.qtd * vi.valor_unit - vi.desconto, vi.qtd * vi.custo_unit
    from public.venda_itens vi join vb on vb.id = vi.venda_id
  ),
  dec as (
    select o.status from public.ordens o
    where coalesce(o.orcamento_enviado_em, o.criado_em) >= p_ini and coalesce(o.orcamento_enviado_em, o.criado_em) < p_fim
      and o.status in ('execucao', 'pronto', 'entregue', 'recusado')
  ),
  mov as (
    select total, custo, forma_pagamento, entregue_em as quando from sa
    union all select total, custo, forma_pagamento, criado_em from vb
  )
  select jsonb_build_object(
    'faturamento', coalesce((select sum(total) from mov), 0),
    'faturamento_os', coalesce((select sum(total) from sa), 0),
    'balcao', coalesce((select sum(total) from vb), 0),
    'balcao_n', (select count(*) from vb),
    'custo', coalesce((select sum(custo) from mov), 0),
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
        select coalesce(nullif(forma_pagamento, ''), 'Não informado') as forma, sum(total) as v from mov group by 1 order by 2 desc) t), '[]'::jsonb),
    'serie', coalesce((select jsonb_agg(t order by t.k) from (
        select to_char(date_trunc(case when p_grupo = 'mes' then 'month' else 'day' end, quando at time zone 'America/Sao_Paulo'), 'YYYY-MM-DD') as k, sum(total) as v
        from mov group by 1) t), '[]'::jsonb),
    'recebido', coalesce((select sum(valor) from public.recibos
        where not cancelado and data >= (p_ini at time zone 'America/Sao_Paulo')::date and data <= ((p_fim - interval '1 second') at time zone 'America/Sao_Paulo')::date), 0)
  )
$$;

-- ---------------------------------------------------------------------
-- Regras de acesso
-- ---------------------------------------------------------------------
grant select, insert, update, delete on public.fornecedores, public.produto_fornecedor to authenticated;
grant select on public.notas_entrada, public.vendas, public.venda_itens to authenticated;
grant usage, select on sequence public.vendas_numero_seq to authenticated;
alter table public.fornecedores enable row level security;
alter table public.produto_fornecedor enable row level security;
alter table public.notas_entrada enable row level security;
alter table public.vendas enable row level security;
alter table public.venda_itens enable row level security;
do $$
declare t text;
begin
  foreach t in array array['fornecedores', 'produto_fornecedor', 'notas_entrada', 'vendas', 'venda_itens'] loop
    execute format('drop policy if exists %1$s_ler on public.%1$s', t);
    execute format('create policy %1$s_ler on public.%1$s for select to authenticated using (public.e_membro())', t);
  end loop;
  foreach t in array array['fornecedores', 'produto_fornecedor'] loop
    execute format('drop policy if exists %1$s_incluir on public.%1$s', t);
    execute format('create policy %1$s_incluir on public.%1$s for insert to authenticated with check (public.e_gestor())', t);
    execute format('drop policy if exists %1$s_alterar on public.%1$s', t);
    execute format('create policy %1$s_alterar on public.%1$s for update to authenticated using (public.e_gestor()) with check (public.e_gestor())', t);
    execute format('drop policy if exists %1$s_excluir on public.%1$s', t);
    execute format('create policy %1$s_excluir on public.%1$s for delete to authenticated using (public.e_admin())', t);
  end loop;
end $$;
grant execute on function public.finalizar_venda(jsonb) to authenticated;
grant execute on function public.cancelar_venda(uuid, text) to authenticated;
grant execute on function public.importar_nfe(jsonb) to authenticated;
grant execute on function public.painel_resumo(timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- Estoque reservado pela O.S.: a peça sai do estoque quando entra na O.S.
-- e volta se for removida, recusada (não aprovada) ou se a O.S. for cancelada.
-- A tabela estoque_reserva guarda quanto cada item já baixou.
-- ---------------------------------------------------------------------
create table if not exists public.estoque_reserva (
  item_id uuid primary key,
  ordem_id uuid not null,
  produto_id uuid not null references public.produtos (id) on delete cascade,
  qtd numeric(12, 3) not null
);
create index if not exists estoque_reserva_produto on public.estoque_reserva (produto_id);
alter table public.estoque_reserva enable row level security;
drop policy if exists estoque_reserva_ler on public.estoque_reserva;
create policy estoque_reserva_ler on public.estoque_reserva for select to authenticated using (public.e_membro());
grant select on public.estoque_reserva to authenticated;

create or replace function public.estoque_sincroniza_item(p_item uuid, p_ordem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it public.os_itens; st text; num int; res public.estoque_reserva; quer_prod uuid; quer_qtd numeric := 0; delta numeric; novo numeric; v_nome text;
begin
  if current_setting('dtcar.sem_estoque', true) = '1' then return; end if;
  select * into it from public.os_itens where id = p_item;
  select status, numero into st, num from public.ordens where id = p_ordem;
  if it.id is not null and it.tipo = 'peca' and it.produto_id is not null and not it.fornecida_cliente and it.aprovado is distinct from false
     and coalesce(st, 'cancelado') <> 'cancelado'
     and exists (select 1 from public.produtos p where p.id = it.produto_id and p.tipo = 'produto' and p.controla_estoque) then
    quer_prod := it.produto_id; quer_qtd := it.qtd;
  end if;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  select * into res from public.estoque_reserva where item_id = p_item;
  if res.item_id is not null and (quer_prod is null or res.produto_id <> quer_prod) then
    update public.produtos set estoque_atual = estoque_atual + res.qtd where id = res.produto_id returning estoque_atual into novo;
    insert into public.estoque_mov (produto_id, ordem_id, tipo, qtd, saldo, obs, usuario_nome)
    values (res.produto_id, p_ordem, 'estorno', res.qtd, novo, 'Retirado da O.S. ' || lpad(coalesce(num, 0)::text, 5, '0'), coalesce(v_nome, ''));
    delete from public.estoque_reserva where item_id = p_item; res := null;
  end if;
  if quer_prod is null then return; end if;
  delta := quer_qtd - coalesce(res.qtd, 0);
  if delta = 0 then return; end if;
  update public.produtos set estoque_atual = estoque_atual - delta where id = quer_prod returning estoque_atual into novo;
  insert into public.estoque_mov (produto_id, ordem_id, tipo, qtd, saldo, obs, usuario_nome)
  values (quer_prod, p_ordem, case when delta > 0 then 'saida' else 'estorno' end, -delta, novo, 'O.S. ' || lpad(coalesce(num, 0)::text, 5, '0'), coalesce(v_nome, ''));
  insert into public.estoque_reserva (item_id, ordem_id, produto_id, qtd) values (p_item, p_ordem, quer_prod, quer_qtd)
  on conflict (item_id) do update set produto_id = excluded.produto_id, qtd = excluded.qtd;
end $$;

create or replace function public.estoque_item_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.estoque_sincroniza_item(coalesce(new.id, old.id), coalesce(new.ordem_id, old.ordem_id));
  return null;
end $$;
drop trigger if exists os_itens_estoque on public.os_itens;
create trigger os_itens_estoque after insert or update or delete on public.os_itens for each row execute function public.estoque_item_gatilho();

create or replace function public.estoque_ordem_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if (old.status = 'cancelado') <> (new.status = 'cancelado') then
    for r in select id from public.os_itens where ordem_id = new.id loop perform public.estoque_sincroniza_item(r.id, new.id); end loop;
  end if;
  return null;
end $$;
-- a baixa na entrega (versão 3) dá lugar à baixa no lançamento
drop trigger if exists ordens_estoque on public.ordens;
drop trigger if exists ordens_estoque_status on public.ordens;
create trigger ordens_estoque_status after update of status on public.ordens for each row execute function public.estoque_ordem_gatilho();

-- itens de O.S. já entregues pelo DTCar Gestão (baixados na entrega): registra a reserva sem mexer no saldo
insert into public.estoque_reserva (item_id, ordem_id, produto_id, qtd)
select i.id, i.ordem_id, i.produto_id, i.qtd from public.os_itens i join public.ordens o on o.id = i.ordem_id join public.produtos p on p.id = i.produto_id
where o.status = 'entregue' and o.estoque_baixado and o.checkin->'legado' is null and i.tipo = 'peca' and i.aprovado is true and not i.fornecida_cliente and p.controla_estoque
on conflict (item_id) do nothing;
-- O.S. abertas pelo DTCar Gestão: baixa agora as peças já lançadas (as herdadas do sistema antigo ficam de fora)
do $$ declare r record; begin
  for r in select i.id, i.ordem_id from public.os_itens i join public.ordens o on o.id = i.ordem_id
           where o.status in ('diagnostico', 'aguardando', 'execucao', 'pronto') and o.checkin->'legado' is null and i.produto_id is not null loop
    perform public.estoque_sincroniza_item(r.id, r.ordem_id);
  end loop;
end $$;

-- a importação do sistema antigo não mexe no estoque (o saldo já vem do backup)
do $$ begin
  if position('dtcar.sem_estoque' in pg_get_functiondef('public.importar_legado(text,jsonb,boolean)'::regprocedure)) = 0 then
    execute replace(pg_get_functiondef('public.importar_legado(text,jsonb,boolean)'::regprocedure),
      'if not public.e_admin() then raise exception ''Somente o administrador pode importar dados.''; end if;',
      'if not public.e_admin() then raise exception ''Somente o administrador pode importar dados.''; end if;
  perform set_config(''dtcar.sem_estoque'', ''1'', true);');
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Relatório de produtos e serviços vendidos (O.S. entregues + balcão)
-- ---------------------------------------------------------------------
create or replace function public.relatorio_vendidos(p_ini timestamptz, p_fim timestamptz)
returns table (origem text, tipo text, produto_id uuid, codigo int, descricao text, referencia text, qtd numeric, valor numeric, custo numeric, vezes bigint)
language sql stable set search_path = public as $$
  with linhas as (
    select 'os'::text as origem, case when i.tipo = 'servico' then 'servico' when i.tipo = 'peca' then 'produto' else 'outro' end as tipo,
           i.produto_id, i.descricao, i.qtd, i.qtd * i.valor_unit - coalesce(i.desconto, 0) as valor, i.qtd * coalesce(i.custo_unit, 0) as custo
    from public.os_itens i join public.ordens o on o.id = i.ordem_id
    where o.status = 'entregue' and o.entregue_em >= p_ini and o.entregue_em < p_fim and i.aprovado is not false and not i.fornecida_cliente
    union all
    select 'balcao', vi.tipo, vi.produto_id, vi.descricao, vi.qtd, vi.qtd * vi.valor_unit - vi.desconto, vi.qtd * vi.custo_unit
    from public.venda_itens vi join public.vendas v on v.id = vi.venda_id
    where v.status = 'concluida' and v.criado_em >= p_ini and v.criado_em < p_fim
  )
  select l.origem, l.tipo, l.produto_id, max(p.codigo), coalesce(max(p.descricao), min(l.descricao)), max(p.referencia),
         sum(l.qtd), round(sum(l.valor), 2), round(sum(l.custo), 2), count(*)
  from linhas l left join public.produtos p on p.id = l.produto_id
  group by l.origem, l.tipo, l.produto_id, case when l.produto_id is null then lower(trim(l.descricao)) end
$$;
grant execute on function public.relatorio_vendidos(timestamptz, timestamptz) to authenticated;
