-- =====================================================================
-- DTCar Gestão — versão 12 (já inclui tudo da versão 11)
-- 1. Entrega do veículo separada do recebimento: a O.S. entregue fica
--    "a receber" até os recibos quitarem o total; aí é finalizada.
--    Motivo obrigatório no cancelamento.
-- 2. Contas a receber: prazo e parcelas (boleto, promissória…), com
--    baixa por recibo e alerta de vencimento.
-- Rode DEPOIS do v10.sql. Não precisa rodar o v11. Pode ser executado
-- mais de uma vez.
-- =====================================================================
-- Parte 1 — conteúdo do v11 (entrega separada do recebimento; motivo do cancelamento)
alter table public.ordens add column if not exists recebido numeric(12, 2) not null default 0;
alter table public.ordens add column if not exists finalizada_em timestamptz;
alter table public.ordens add column if not exists motivo_cancelamento text not null default '';

-- soma dos recibos válidos da O.S.; finaliza quando o veículo já saiu e o total foi quitado
create or replace function public.recalcular_recebido(p_ordem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v numeric; o record;
begin
  if p_ordem is null then return; end if;
  select coalesce(sum(valor), 0) into v from public.recibos where ordem_id = p_ordem and not cancelado;
  select * into o from public.ordens where id = p_ordem;
  if not found then return; end if;
  update public.ordens set recebido = v,
    finalizada_em = case when o.status = 'entregue' and v >= o.total - 0.009 then coalesce(o.finalizada_em, now()) else null end
  where id = p_ordem;
end $$;

create or replace function public.recibos_recalcula() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public.recalcular_recebido(old.ordem_id); return null; end if;
  perform public.recalcular_recebido(new.ordem_id);
  if tg_op = 'UPDATE' and old.ordem_id is distinct from new.ordem_id then perform public.recalcular_recebido(old.ordem_id); end if;
  return null;
end $$;
drop trigger if exists recibos_recalcula on public.recibos;
create trigger recibos_recalcula after insert or update or delete on public.recibos for each row execute function public.recibos_recalcula();

-- ao entregar, reabrir ou mudar o total, a situação de pagamento é refeita
create or replace function public.ordens_situacao_pagamento() returns trigger language plpgsql as $$
begin
  if new.status = 'entregue' and new.checkin->'legado' is not null then new.finalizada_em := coalesce(new.finalizada_em, new.entregue_em, now());
  elsif new.status = 'entregue' and new.recebido >= new.total - 0.009 then new.finalizada_em := coalesce(new.finalizada_em, now());
  else new.finalizada_em := null; end if;
  return new;
end $$;
drop trigger if exists ordens_situacao_pagamento on public.ordens;
create trigger ordens_situacao_pagamento before update of status, total, recebido on public.ordens for each row execute function public.ordens_situacao_pagamento();

-- situação atual: recibos já emitidos e O.S. importadas do sistema antigo (entregues = pagas no sistema antigo)
update public.ordens o set recebido = coalesce((select sum(r.valor) from public.recibos r where r.ordem_id = o.id and not r.cancelado), 0);
update public.ordens set finalizada_em = coalesce(entregue_em, now()) where status = 'entregue' and checkin->'legado' is not null and finalizada_em is null;
update public.ordens set finalizada_em = coalesce(entregue_em, now()) where status = 'entregue' and recebido >= total - 0.009 and finalizada_em is null;

-- =====================================================================
-- Parte 2 — contas a receber: prazo e parcelas (boleto, promissória…)
-- =====================================================================
create table if not exists public.receber (
  id uuid primary key default gen_random_uuid(),
  ordem_id uuid references public.ordens (id) on delete cascade,
  cliente_id uuid references public.clientes (id) on delete set null,
  cliente_nome text not null default '',
  descricao text not null default '',
  forma text not null default '',
  parcela int not null default 1,
  parcelas int not null default 1,
  valor numeric(12, 2) not null check (valor > 0),
  vencimento date not null,
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  pago_em date,
  recibo_id uuid references public.recibos (id) on delete set null,
  obs text not null default '',
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists receber_venc on public.receber (status, vencimento);
create index if not exists receber_ordem on public.receber (ordem_id);
drop trigger if exists receber_toca on public.receber;
create trigger receber_toca before update on public.receber for each row execute function public.toca_atualizado();
alter table public.receber enable row level security;
drop policy if exists receber_ler on public.receber;
create policy receber_ler on public.receber for select to authenticated using (public.e_membro());
drop policy if exists receber_gravar on public.receber;
create policy receber_gravar on public.receber for all to authenticated using (public.e_gestor()) with check (public.e_gestor());

-- recibo cancelado: a parcela paga por ele volta a ficar em aberto
create or replace function public.recibo_cancelado_reabre() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelado and not old.cancelado then update public.receber set status = 'aberta', pago_em = null, recibo_id = null where recibo_id = new.id; end if;
  return null;
end $$;
drop trigger if exists recibo_cancelado_reabre on public.recibos;
create trigger recibo_cancelado_reabre after update of cancelado on public.recibos for each row execute function public.recibo_cancelado_reabre();

-- backup: a restauração passa a aceitar a tabela de contas a receber
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber') then
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
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;

-- =====================================================================
-- Parte 3 — espelho do sistema antigo (OS Oficina): antes de carregar o backup,
-- apaga cadastros, O.S., recibos, vendas, estoque e contas a receber, para o
-- DTCar Gestão ficar exatamente igual ao sistema antigo. Preserva: equipe, ajustes,
-- fornecedores, contas a pagar, notas de entrada e da SEFAZ, funcionários e certificado.
-- Só o administrador; usado pela tela Importar (modo espelho), que baixa um backup antes.
-- =====================================================================
create or replace function public.espelho_legado_zerar()
returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := '{}'::jsonb; n bigint;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador pode zerar os dados para o espelho do sistema antigo.'; end if;
  perform set_config('dtcar.sem_estoque', '1', true); -- não devolve estoque ao apagar itens
  delete from public.receber where true;              get diagnostics n = row_count; r := r || jsonb_build_object('receber', n);
  delete from public.estoque_reserva where true;
  delete from public.estoque_mov where true;           get diagnostics n = row_count; r := r || jsonb_build_object('estoque_mov', n);
  delete from public.recibos where true;               get diagnostics n = row_count; r := r || jsonb_build_object('recibos', n);
  delete from public.venda_itens where true;
  delete from public.vendas where true;                get diagnostics n = row_count; r := r || jsonb_build_object('vendas', n);
  delete from public.nfe_os_vinculos where true;
  delete from public.eventos where true;
  delete from public.fotos where true;
  delete from public.os_itens where true;              get diagnostics n = row_count; r := r || jsonb_build_object('os_itens', n);
  update public.contas set ordem_id = null where ordem_id is not null;
  delete from public.ordens where true;                get diagnostics n = row_count; r := r || jsonb_build_object('ordens', n);
  delete from public.veiculos where true;              get diagnostics n = row_count; r := r || jsonb_build_object('veiculos', n);
  delete from public.clientes where true;              get diagnostics n = row_count; r := r || jsonb_build_object('clientes', n);
  delete from public.produto_fornecedor where true;
  delete from public.produtos where true;              get diagnostics n = row_count; r := r || jsonb_build_object('produtos', n);
  perform setval('public.os_numero_seq', 1, false);
  perform setval('public.clientes_codigo_seq', 1, false);
  perform setval('public.produtos_codigo_seq', 1, false);
  return r;
end $$;
revoke all on function public.espelho_legado_zerar() from public, anon;
grant execute on function public.espelho_legado_zerar() to authenticated;
