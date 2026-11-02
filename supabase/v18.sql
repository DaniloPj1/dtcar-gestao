-- =====================================================================
-- DTCar Gestão — v18: saldo por conta (Sicredi, PicPay, Espécie…),
-- de qual conta saiu cada pagamento, em qual conta entrou cada recibo
-- e transferências entre contas.
--
-- As contas (bancos e caixa) e o saldo informado de cada uma ficam em
-- Ajustes do sistema (config, "contasFinanceiras"). O saldo atual de cada
-- conta = saldo informado + recibos que entraram nela − contas pagas por ela
-- ± transferências, tudo registrado depois do saldo informado.
--
-- Rode depois do v17. Pode rodar mais de uma vez. O site funciona antes do
-- SQL (sem gravar a conta de origem/destino e sem transferências).
-- Período de transição: o espelho do sistema antigo já foi desligado (virada
-- de 02/11/2026). As transferências são PRESERVADAS por uma carga do espelho
-- (dinheiro real da empresa, como as contas a pagar); a coluna conta_destino
-- dos recibos some junto com os recibos se o espelho for religado.
-- =====================================================================

-- 1. de qual conta saiu o pagamento / em qual conta entrou o recibo
alter table public.contas add column if not exists conta_origem text not null default '';
alter table public.recibos add column if not exists conta_destino text not null default '';
-- instante em que a baixa foi registrada (não muda quando a conta paga é editada depois); usado no saldo por conta
alter table public.contas add column if not exists pago_registrado_em timestamptz;
create or replace function public.contas_registra_baixa() returns trigger language plpgsql as $$
begin
  if new.status = 'paga' and (tg_op = 'INSERT' or old.status is distinct from 'paga') then new.pago_registrado_em := coalesce(new.pago_registrado_em, now());
  elsif new.status <> 'paga' then new.pago_registrado_em := null;
  end if;
  return new;
end $$;
drop trigger if exists contas_registra_baixa on public.contas;
create trigger contas_registra_baixa before insert or update of status on public.contas for each row execute function public.contas_registra_baixa();

-- 2. transferências entre contas da empresa
create table if not exists public.transferencias (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  de_conta text not null,
  para_conta text not null,
  valor numeric(12, 2) not null check (valor > 0),
  obs text not null default '',
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (de_conta <> para_conta)
);
create index if not exists transferencias_data on public.transferencias (data);
create index if not exists transferencias_atualizado on public.transferencias (atualizado_em);
drop trigger if exists transferencias_toca on public.transferencias;
create trigger transferencias_toca before update on public.transferencias for each row execute function public.toca_atualizado();
-- exclusão avisada ao banco do PC (supabase/v13.sql)
drop trigger if exists transferencias_exclusao on public.transferencias;
create trigger transferencias_exclusao after delete on public.transferencias for each row execute function public.registra_exclusao();

grant select, insert, update, delete on public.transferencias to authenticated;
alter table public.transferencias enable row level security;
drop policy if exists transferencias_ler on public.transferencias;
drop policy if exists transferencias_gravar on public.transferencias;
-- financeiro é só do administrador
create policy transferencias_ler on public.transferencias for select to authenticated using (public.e_admin());
create policy transferencias_gravar on public.transferencias for all to authenticated using (public.e_admin()) with check (public.e_admin());

-- 3. backup: a restauração passa a aceitar as transferências
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias') then
    raise exception 'Tabela não permitida: %', p_tabela;
  end if;
  perform set_config('dtcar.sem_estoque', '1', true);
  -- backup feito antes da v18 não tem as colunas novas: sem isso elas viriam nulas e a linha seria recusada
  if p_tabela = 'contas' then
    p_linhas := (select coalesce(jsonb_agg(jsonb_build_object('conta_origem', '') || jsonb_strip_nulls(e)), '[]'::jsonb) from jsonb_array_elements(p_linhas) e);
  elsif p_tabela = 'recibos' then
    p_linhas := (select coalesce(jsonb_agg(jsonb_build_object('conta_destino', '') || jsonb_strip_nulls(e)), '[]'::jsonb) from jsonb_array_elements(p_linhas) e);
  end if;
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
