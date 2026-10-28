-- =====================================================================
-- DTCar Gestão — versão 8
-- Ciência nota por nota e vínculo de nota fiscal de compra com O.S.
-- (custo da peça vindo da nota, histórico na O.S. e margem nos relatórios).
-- Rode DEPOIS do v7.sql. Pode ser executado mais de uma vez.
-- =====================================================================

-- ciência pedida manualmente e opção de não dar ciência em uma nota
alter table public.nfe_recebidas drop constraint if exists nfe_recebidas_manifestacao_pedida_check;
alter table public.nfe_recebidas add constraint nfe_recebidas_manifestacao_pedida_check
  check (manifestacao_pedida in ('', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada'));
alter table public.nfe_recebidas add column if not exists sem_ciencia boolean not null default false;
alter table public.nfe_recebidas drop constraint if exists nfe_recebidas_status_check;
alter table public.nfe_recebidas add constraint nfe_recebidas_status_check check (status in ('nova', 'lancada', 'ignorada', 'vinculada'));
grant update (status, obs, contas_lancadas, sem_ciencia) on public.nfe_recebidas to authenticated;

create or replace function public.pedir_manifestacao(p_chave text, p_tipo text, p_justificativa text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Apenas o administrador registra manifestações.'; end if;
  if p_tipo not in ('ciencia', 'confirmada', 'desconhecida', 'nao_realizada') then raise exception 'Manifestação inválida.'; end if;
  if p_tipo = 'nao_realizada' and length(trim(coalesce(p_justificativa, ''))) < 15 then raise exception 'Escreva uma justificativa com pelo menos 15 caracteres.'; end if;
  update public.nfe_recebidas set manifestacao_pedida = p_tipo, justificativa_pedida = left(trim(coalesce(p_justificativa, '')), 255), manifestacao_erro = '',
    sem_ciencia = case when p_tipo = 'ciencia' then false else sem_ciencia end
  where chave = p_chave;
  if not found then raise exception 'Nota não encontrada.'; end if;
end $$;

-- ---------------------------------------------------------------------
-- Vínculo nota fiscal × O.S.
-- ---------------------------------------------------------------------
alter table public.os_itens add column if not exists nfe_chave text not null default '';
alter table public.os_itens add column if not exists nfe_ref text not null default '';

create table if not exists public.nfe_os_vinculos (
  id uuid primary key default gen_random_uuid(),
  chave text not null,
  ordem_id uuid not null references public.ordens (id) on delete cascade,
  item_id uuid not null references public.os_itens (id) on delete cascade,
  nf_item int,                         -- número do item na nota (null = nota inteira ou valor informado)
  descricao_nf text not null default '',
  custo_total numeric(12, 2) not null default 0,
  usuario_nome text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists nfe_os_vinculos_chave on public.nfe_os_vinculos (chave);
create index if not exists nfe_os_vinculos_ordem on public.nfe_os_vinculos (ordem_id);
grant select on public.nfe_os_vinculos to authenticated;
alter table public.nfe_os_vinculos enable row level security;
drop policy if exists nfe_os_vinculos_ler on public.nfe_os_vinculos;
create policy nfe_os_vinculos_ler on public.nfe_os_vinculos for select to authenticated using (public.e_gestor());

create or replace function public.fmt_reais(v numeric) returns text language sql immutable as $$ select 'R$ ' || replace(to_char(coalesce(v, 0), 'FM999999990.00'), '.', ',') $$;

-- p = { chave, ordem_id, itens: [{ item_id, nf_item, descricao_nf, custo_total }] }
-- grava o custo das peças da O.S. a partir da nota, sem mexer no estoque
create or replace function public.vincular_nfe_os(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare n record; o record; it jsonb; item record; quem text; total numeric := 0; venda numeric := 0; n_itens int := 0; ref text; linhas text := '';
begin
  if not public.e_gestor() then raise exception 'Seu usuário não pode vincular notas.'; end if;
  perform set_config('dtcar.sem_estoque', '1', true);
  select * into n from public.nfe_recebidas where chave = p->>'chave';
  if not found then raise exception 'Nota não encontrada.'; end if;
  select * into o from public.ordens where id = (p->>'ordem_id')::uuid;
  if not found then raise exception 'O.S. não encontrada.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  ref := 'NF ' || n.numero || ' – ' || coalesce(nullif(n.nome_emitente, ''), n.cnpj_emitente);
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    select * into item from public.os_itens where id = (it->>'item_id')::uuid and ordem_id = o.id;
    if not found then raise exception 'Item não pertence a esta O.S.'; end if;
    delete from public.nfe_os_vinculos where item_id = item.id;
    insert into public.nfe_os_vinculos (chave, ordem_id, item_id, nf_item, descricao_nf, custo_total, usuario_nome)
    values (n.chave, o.id, item.id, nullif(it->>'nf_item', '')::int, coalesce(it->>'descricao_nf', ''), (it->>'custo_total')::numeric, coalesce(quem, ''));
    update public.os_itens set custo_unit = round((it->>'custo_total')::numeric / greatest(item.qtd, 0.001), 2), nfe_chave = n.chave, nfe_ref = ref where id = item.id;
    total := total + (it->>'custo_total')::numeric;
    venda := venda + item.qtd * item.valor_unit - item.desconto;
    n_itens := n_itens + 1;
    linhas := linhas || case when n_itens > 1 then '; ' else '' end || item.descricao || ' custo ' || public.fmt_reais((it->>'custo_total')::numeric);
  end loop;
  if n_itens = 0 then raise exception 'Escolha pelo menos um item da O.S.'; end if;
  -- custo da O.S. (peças e terceiros que contam no total)
  update public.ordens set custo = (select coalesce(sum(round(i.qtd * i.custo_unit, 2)), 0) from public.os_itens i
    where i.ordem_id = o.id and i.tipo <> 'servico' and not i.fornecida_cliente
      and (case when o.status in ('execucao', 'pronto', 'entregue', 'recusado') then i.aprovado is true else i.aprovado is distinct from false end))
  where id = o.id;
  insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
  values (o.id, 'nota', ref || ' vinculada: ' || linhas || '. Custo total ' || public.fmt_reais(total) || ', vendido ' || public.fmt_reais(venda) || '.', coalesce(quem, ''));
  update public.nfe_recebidas set status = 'vinculada' where id = n.id and status = 'nova';
  return jsonb_build_object('itens', n_itens, 'custo', total, 'venda', venda, 'ordem', o.numero);
end $$;
grant execute on function public.vincular_nfe_os(jsonb) to authenticated;

-- relatório por item passa a mostrar de qual nota veio o custo
drop function if exists public.relatorio_itens(timestamptz, timestamptz, text);
create function public.relatorio_itens(p_ini timestamptz, p_fim timestamptz, p_base text default 'entrega')
returns table (ordem_id uuid, numero int, status text, criado_em timestamptz, entregue_em timestamptz, cliente_id uuid, cliente text, placa text, veiculo text,
  km int, mecanico text, forma_pagamento text, ordem_total numeric, ordem_desconto numeric, legado boolean,
  item_id uuid, tipo text, descricao text, codigo text, fornecedor text, fornecedor_id uuid, produto_id uuid, qtd numeric, valor_unit numeric, desconto numeric,
  custo_unit numeric, horas numeric, aprovado boolean, executado boolean, fornecida_cliente boolean, nfe_ref text)
language sql stable security invoker set search_path = public as $$
  select o.id, o.numero, o.status, o.criado_em, o.entregue_em, o.cliente_id, o.cliente->>'nome', o.veiculo->>'placa',
    trim(concat_ws(' ', o.veiculo->>'marca', o.veiculo->>'modelo')), o.km_entrada::int, o.mecanico_nome, o.forma_pagamento, o.total, o.desconto,
    o.checkin->'legado' is not null,
    i.id, i.tipo, i.descricao, i.codigo, i.fornecedor, i.fornecedor_id, i.produto_id, i.qtd, i.valor_unit, i.desconto, i.custo_unit, i.horas, i.aprovado, i.executado, i.fornecida_cliente, i.nfe_ref
  from public.ordens o left join public.os_itens i on i.ordem_id = o.id
  where (case when p_base = 'abertura' then o.criado_em else o.entregue_em end) >= p_ini
    and (case when p_base = 'abertura' then o.criado_em else o.entregue_em end) < p_fim
$$;
grant execute on function public.relatorio_itens(timestamptz, timestamptz, text) to authenticated;

-- backup passa a incluir os vínculos
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos') then
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
    for r in select * from jsonb_array_elements(p_linhas) loop
      begin execute q using jsonb_build_array(r); exception when others then erros := erros + 1; end;
    end loop;
  end;
  execute format('select count(*) from public.%I', p_tabela) into depois;
  return jsonb_build_object('incluidos', depois - antes, 'erros', erros);
end $$;
