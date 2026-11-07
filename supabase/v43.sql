-- =====================================================================
-- DTCar Gestão — v43: despesa fixa sem fim (aluguel, internet…) que mostra só a próxima.
--
-- Pedido do Danilo (04/11/2026): "a cobrança do aluguel fixa, mas que só mostre a que vai vencer em 30 dias,
-- não uma sequência de 12x". Antes, "Todo mês" lançava N contas de uma vez (o aluguel virou 12 contas de
-- R$ 5.500 e inflava o "Total em aberto").
--
-- Agora uma despesa fixa é um grupo de contas (contas.grupo) marcado com contas.fixa = true:
--   * a conta mais recente (não cancelada) do grupo é o modelo: descrição, favorecido, categoria e valor;
--     a geração parte da última cobrança já vencida (pagamento adiantado não pula os meses do meio);
--   * gerar_despesas_fixas() lança a do mês seguinte só quando ela vence em até 30 dias (mesmo dia do mês;
--     dia 31 em mês curto vira o último dia). Não repete: índice único (grupo, vencimento) nas fixas;
--   * reajuste = alterar o valor da conta mais recente; encerrar = fixa = false no grupo.
-- As telas chamam gerar_despesas_fixas() ao carregar as contas abertas (js/api.js); a previsão de caixa
-- projeta os meses seguintes sem gravar nada.
--
-- Coluna sem "not null" de propósito: backup antigo restaurado (restaurar_tabela) vem sem ela e fica null
-- (= não é fixa).
-- Rode depois do v5. Pode rodar mais de uma vez.
-- Espelho: contas a pagar não são limpas pelo espelho; igual antes e depois da virada.
-- =====================================================================

alter table public.contas add column if not exists fixa boolean default false;
create unique index if not exists contas_fixa_mes on public.contas (grupo, vencimento) where fixa and status <> 'cancelada';
create index if not exists contas_fixa on public.contas (grupo) where fixa;

-- mesmo dia do mês seguinte (31/01 → 28/02; 10/11 → 10/12)
create or replace function public.mes_seguinte(d date, dia int) returns date
language sql immutable as $$
  select least(date_trunc('month', d + interval '1 month')::date + (dia - 1),
               (date_trunc('month', d + interval '1 month') + interval '1 month - 1 day')::date)
$$;

create or replace function public.gerar_despesas_fixas(p_dias int default 30) returns int
language plpgsql volatile security invoker set search_path = public as $$
declare m public.contas; prox date; base date; dia int; n int := 0; v_nome text;
begin
  if not public.e_admin() then return 0; end if;   -- só o administrador lança contas (como lancar_contas)
  select nome into v_nome from public.perfis where id = auth.uid();
  -- modelo de cada despesa fixa: a conta mais recente não cancelada do grupo; se todas foram canceladas uma a uma,
  -- a mais recente delas (cancelar cobranças não encerra a despesa: para isso há "Encerrar despesa fixa")
  -- (as substituídas na conversão nunca servem de modelo)
  for m in select distinct on (grupo) * from public.contas where fixa and grupo is not null
             and (status <> 'cancelada' or obs not like '%Substituída pela despesa fixa%')
           order by grupo, (status <> 'cancelada') desc, vencimento desc, criado_em desc loop
    -- dia do mês da primeira conta do grupo, mesmo cancelada (começou dia 31: fevereiro vai no dia 28, março volta para 31;
    -- cancelar uma cobrança não muda o calendário da despesa)
    select extract(day from min(vencimento))::int into dia from public.contas c where c.grupo = m.grupo;
    -- de onde começar (separado do modelo): a última cobrança do grupo que já venceu; se todas são futuras, a primeira.
    -- Assim uma mensalidade paga adiantado (ex.: janeiro pago em novembro) não pula dezembro (Codex, 07/11)
    select coalesce(max(vencimento) filter (where vencimento <= current_date), min(vencimento)) into base
      from public.contas c where c.grupo = m.grupo and (c.status <> 'cancelada' or c.obs not like '%Substituída pela despesa fixa%');
    prox := public.mes_seguinte(coalesce(base, m.vencimento), dia);
    while prox <= current_date + coalesce(p_dias, 30) loop
      -- mês a mês: não lança onde já há cobrança do grupo nesse vencimento, inclusive a cancelada uma a uma pelo Danilo
      -- (não volta); só as canceladas pela conversão em despesa fixa ("Substituída pela despesa fixa") são relançadas
      if not exists (select 1 from public.contas c where c.grupo = m.grupo and c.vencimento = prox
                     and (c.status <> 'cancelada' or c.obs not like '%Substituída pela despesa fixa%')) then
        insert into public.contas (descricao, fornecedor_id, favorecido, categoria, valor, vencimento, grupo, origem, fixa, obs, criado_por)
        values (m.descricao, m.fornecedor_id, m.favorecido, m.categoria, m.valor, prox, m.grupo, 'recorrente', true, '', coalesce(v_nome, 'despesa fixa'))
        on conflict do nothing;
        if found then n := n + 1; end if;
      end if;
      prox := public.mes_seguinte(prox, dia);
    end loop;
  end loop;
  return n;
end $$;
grant execute on function public.gerar_despesas_fixas(int) to authenticated;
grant execute on function public.mes_seguinte(date, int) to authenticated;

-- transforma uma conta (ou a sequência "Todo mês" dela) em despesa fixa sem fim: marca o grupo como fixo e
-- cancela (não apaga) as contas em aberto que vencem depois de 30 dias — elas voltam uma por mês, sozinhas
create or replace function public.tornar_despesa_fixa(p_conta uuid) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare c public.contas; g uuid; v_canc int := 0;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador mexe nas despesas fixas.'; end if;
  select * into c from public.contas where id = p_conta;
  if c.id is null then raise exception 'Conta não encontrada.'; end if;
  if c.status = 'cancelada' then raise exception 'A conta está cancelada.'; end if;
  g := coalesce(c.grupo, gen_random_uuid());
  if c.grupo is null then update public.contas set grupo = g where id = c.id; end if;
  -- só a sequência mensal (ou a conta avulsa) vira fixa; parcelamento de compra não
  if c.origem = 'parcelado' then raise exception 'Conta parcelada não vira despesa fixa.'; end if;
  -- ficam só as que vencem em até 30 dias, qualquer que seja a conta escolhida; se nenhuma vence nesse prazo,
  -- fica a mais próxima (é o modelo das próximas)
  update public.contas set status = 'cancelada', obs = trim(obs || ' Substituída pela despesa fixa (lançada um mês por vez).')
    where grupo = g and status = 'aberta' and vencimento > current_date + 30
      and id <> (select x.id from public.contas x where x.grupo = g and x.status = 'aberta' order by x.vencimento, x.id limit 1);
  get diagnostics v_canc = row_count;
  update public.contas set fixa = true, origem = case when origem = 'manual' then 'recorrente' else origem end, parcela = null, parcelas = null
    where grupo = g and status <> 'cancelada';
  -- as canceladas também ficam marcadas: a previsão e a geração enxergam o histórico inteiro do grupo
  update public.contas set fixa = true where grupo = g and status = 'cancelada' and fixa is distinct from true;
  return jsonb_build_object('grupo', g, 'canceladas', v_canc, 'lancadas', public.gerar_despesas_fixas(30));
end $$;
grant execute on function public.tornar_despesa_fixa(uuid) to authenticated;

-- encerra a despesa fixa (ex.: saiu do galpão): para de lançar as próximas; as já lançadas ficam como estão
create or replace function public.encerrar_despesa_fixa(p_grupo uuid) returns int
language plpgsql volatile security invoker set search_path = public as $$
declare n int;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador mexe nas despesas fixas.'; end if;
  update public.contas set fixa = false where grupo = p_grupo and fixa;
  get diagnostics n = row_count;
  return n;
end $$;
grant execute on function public.encerrar_despesa_fixa(uuid) to authenticated;
