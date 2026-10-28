-- =====================================================================
-- DTCar Gestão — versão 5
-- Contas a pagar (boletos e duplicatas), serviço de terceiros com custo
-- e margem, relatórios por item de O.S. e restauração de backup.
-- Rode DEPOIS do v4.sql. Pode ser executado mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Serviço de terceiros: novo tipo no cadastro de produtos e serviços,
-- com prestador padrão. Na O.S., o item guarda o prestador e a conta.
-- ---------------------------------------------------------------------
alter table public.produtos drop constraint if exists produtos_tipo_check;
alter table public.produtos add constraint produtos_tipo_check check (tipo in ('produto', 'servico', 'terceiro'));
alter table public.produtos add column if not exists fornecedor_id uuid references public.fornecedores (id) on delete set null;
alter table public.fornecedores add column if not exists prestador boolean not null default false;
alter table public.fornecedores add column if not exists categoria_padrao text not null default '';
alter table public.os_itens add column if not exists fornecedor_id uuid references public.fornecedores (id) on delete set null;
alter table public.os_itens add column if not exists conta_id uuid;

-- ---------------------------------------------------------------------
-- Contas a pagar
-- ---------------------------------------------------------------------
create table if not exists public.contas (
  id uuid primary key default gen_random_uuid(),
  descricao text not null,
  fornecedor_id uuid references public.fornecedores (id) on delete set null,
  favorecido text not null default '',
  categoria text not null default '',
  documento text not null default '',
  valor numeric(12, 2) not null check (valor >= 0),
  emissao date,
  vencimento date not null,
  linha_digitavel text not null default '',
  codigo_barras text not null default '',
  parcela int,
  parcelas int,
  grupo uuid,
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  pago_em date,
  valor_pago numeric(12, 2),
  juros numeric(12, 2) not null default 0,
  desconto numeric(12, 2) not null default 0,
  forma_pagamento text not null default '',
  origem text not null default 'manual' check (origem in ('manual', 'boleto', 'nfe', 'os', 'recorrente', 'parcelado')),
  chave_nfe text not null default '',
  nota_id uuid references public.notas_entrada (id) on delete set null,
  ordem_id uuid references public.ordens (id) on delete set null,
  anexo text not null default '',
  obs text not null default '',
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists contas_vencimento on public.contas (status, vencimento);
create index if not exists contas_pago_em on public.contas (pago_em);
create index if not exists contas_atualizado on public.contas (atualizado_em);
-- o mesmo boleto não entra duas vezes; a mesma duplicata da mesma NF também não
create unique index if not exists contas_codigo_barras_unico on public.contas (codigo_barras) where codigo_barras <> '' and status <> 'cancelada';
create unique index if not exists contas_duplicata_unica on public.contas (chave_nfe, documento) where chave_nfe <> '';
drop trigger if exists contas_atualizado on public.contas;
create trigger contas_atualizado before update on public.contas for each row execute function public.toca_atualizado();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'os_itens_conta_id_fkey') then
    alter table public.os_itens add constraint os_itens_conta_id_fkey foreign key (conta_id) references public.contas (id) on delete set null;
  end if;
end $$;

grant select, insert, update, delete on public.contas to authenticated;
alter table public.contas enable row level security;
drop policy if exists contas_ler on public.contas;
drop policy if exists contas_incluir on public.contas;
drop policy if exists contas_alterar on public.contas;
drop policy if exists contas_excluir on public.contas;
-- financeiro é só do administrador
create policy contas_ler on public.contas for select to authenticated using (public.e_admin());
create policy contas_incluir on public.contas for insert to authenticated with check (public.e_admin());
create policy contas_alterar on public.contas for update to authenticated using (public.e_admin()) with check (public.e_admin());
create policy contas_excluir on public.contas for delete to authenticated using (public.e_admin());

-- Lança várias contas de uma vez (duplicatas da NF, parcelas, recorrência).
-- Contas repetidas (mesmo código de barras ou mesma duplicata da mesma nota) são ignoradas.
create or replace function public.lancar_contas(p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare it jsonb; n int := 0; ign int := 0; quem text; nid uuid;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador lança contas.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  for it in select * from jsonb_array_elements(coalesce(p_linhas, '[]'::jsonb)) loop
    nid := null;
    if coalesce(it->>'chave_nfe', '') <> '' then select id into nid from public.notas_entrada where chave = it->>'chave_nfe'; end if;
    insert into public.contas (descricao, fornecedor_id, favorecido, categoria, documento, valor, emissao, vencimento, linha_digitavel, codigo_barras,
      parcela, parcelas, grupo, origem, chave_nfe, nota_id, ordem_id, obs, criado_por)
    values (coalesce(nullif(trim(it->>'descricao'), ''), 'Conta'), nullif(it->>'fornecedor_id', '')::uuid, coalesce(it->>'favorecido', ''), coalesce(it->>'categoria', ''),
      coalesce(it->>'documento', ''), (it->>'valor')::numeric, nullif(it->>'emissao', '')::date, (it->>'vencimento')::date,
      coalesce(it->>'linha_digitavel', ''), coalesce(it->>'codigo_barras', ''), nullif(it->>'parcela', '')::int, nullif(it->>'parcelas', '')::int,
      nullif(it->>'grupo', '')::uuid, coalesce(nullif(it->>'origem', ''), 'manual'), coalesce(it->>'chave_nfe', ''), nid,
      nullif(it->>'ordem_id', '')::uuid, coalesce(it->>'obs', ''), coalesce(quem, ''))
    on conflict do nothing;
    if found then n := n + 1; else ign := ign + 1; end if;
  end loop;
  return jsonb_build_object('lancadas', n, 'repetidas', ign);
end $$;
grant execute on function public.lancar_contas(jsonb) to authenticated;

-- ---------------------------------------------------------------------
-- Relatórios: itens das O.S. no período (por data de entrega ou de abertura).
-- Respeita as regras de acesso das tabelas (security invoker).
-- ---------------------------------------------------------------------
drop function if exists public.relatorio_itens(timestamptz, timestamptz, text);
create function public.relatorio_itens(p_ini timestamptz, p_fim timestamptz, p_base text default 'entrega')
returns table (ordem_id uuid, numero int, status text, criado_em timestamptz, entregue_em timestamptz, cliente_id uuid, cliente text, placa text, veiculo text,
  km int, mecanico text, forma_pagamento text, ordem_total numeric, ordem_desconto numeric, legado boolean,
  item_id uuid, tipo text, descricao text, codigo text, fornecedor text, fornecedor_id uuid, produto_id uuid, qtd numeric, valor_unit numeric, desconto numeric,
  custo_unit numeric, horas numeric, aprovado boolean, executado boolean, fornecida_cliente boolean)
language sql stable security invoker set search_path = public as $$
  select o.id, o.numero, o.status, o.criado_em, o.entregue_em, o.cliente_id, o.cliente->>'nome', o.veiculo->>'placa',
    trim(concat_ws(' ', o.veiculo->>'marca', o.veiculo->>'modelo')), o.km_entrada::int, o.mecanico_nome, o.forma_pagamento, o.total, o.desconto,
    o.checkin->'legado' is not null,
    i.id, i.tipo, i.descricao, i.codigo, i.fornecedor, i.fornecedor_id, i.produto_id, i.qtd, i.valor_unit, i.desconto, i.custo_unit, i.horas, i.aprovado, i.executado, i.fornecida_cliente
  from public.ordens o left join public.os_itens i on i.ordem_id = o.id
  where (case when p_base = 'abertura' then o.criado_em else o.entregue_em end) >= p_ini
    and (case when p_base = 'abertura' then o.criado_em else o.entregue_em end) < p_fim
$$;
grant execute on function public.relatorio_itens(timestamptz, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------
-- Restauração de backup: inclui só os registros que faltam no banco.
-- Nada que já existe é alterado. O estoque não é recalculado (os saldos
-- vêm do próprio backup).
-- ---------------------------------------------------------------------
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas') then
    raise exception 'Tabela não permitida: %', p_tabela;
  end if;
  perform set_config('dtcar.sem_estoque', '1', true);
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a where a.attrelid = ('public.' || p_tabela)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  execute format('select count(*) from public.%I', p_tabela) into antes;
  q := format('insert into public.%1$I (%2$s) overriding system value select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing', p_tabela, cols);
  begin
    execute q using p_linhas;
  exception when others then
    -- algum registro com problema (ex.: ligado a um usuário que não existe mais): tenta um a um
    for r in select * from jsonb_array_elements(p_linhas) loop
      begin execute q using jsonb_build_array(r); exception when others then erros := erros + 1; end;
    end loop;
  end;
  execute format('select count(*) from public.%I', p_tabela) into depois;
  return jsonb_build_object('incluidos', depois - antes, 'erros', erros);
end $$;
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;

-- estoque reservado: a função de sincronização respeita dtcar.sem_estoque (v4)
