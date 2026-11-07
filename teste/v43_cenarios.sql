-- Cenários do v43 (as datas são relativas a hoje)
\set ON_ERROR_STOP 1
do $$
declare r jsonb; g uuid := gen_random_uuid(); hoje date := current_date; d0 date := date_trunc('month', current_date)::date + 9; i int; n int;
begin
  -- aluguel lançado como "Todo mês" em 12 contas, a partir do dia 10 do mês corrente
  for i in 0..11 loop
    insert into public.contas (descricao, categoria, valor, vencimento, parcela, parcelas, grupo, origem)
    values ('Aluguel', 'Fixa', 5500, (d0 + make_interval(months => i))::date, i + 1, 12, g, 'recorrente');
  end loop;
  -- 1. tornar fixa: ficam só as que vencem em até 30 dias; as demais são canceladas (não apagadas)
  r := public.tornar_despesa_fixa((select id from public.contas where vencimento = d0));
  n := (select count(*) from public.contas where grupo = g and status = 'aberta');
  assert n between 1 and 2 and (select count(*) from public.contas where grupo = g) = 12, '1 abertas: ' || n || ' ' || r::text;
  assert (select bool_and(vencimento <= greatest(d0, hoje + 30)) from public.contas where grupo = g and status = 'aberta'), '1 até 30 dias';
  assert (select bool_and(fixa and parcelas is null) from public.contas where grupo = g and status = 'aberta'), '1 marcada fixa';
  -- 2. gerar de novo não repete
  assert public.gerar_despesas_fixas(30) = 0 and (select count(*) from public.contas where grupo = g and status = 'aberta') = n, '2 não repete';
  -- 3. com horizonte maior, lança uma por mês, no mesmo dia, com o valor da mais recente (reajuste)
  update public.contas set valor = 6000 where id = (select id from public.contas where grupo = g and status = 'aberta' order by vencimento desc limit 1);
  i := public.gerar_despesas_fixas(100);
  assert i >= 2, '3 lançou: ' || i;
  assert (select bool_and(extract(day from vencimento) = 10 and valor = 6000) from public.contas where grupo = g and status = 'aberta' and criado_por = 'Danilo'), '3 dia e valor';
  assert (select count(*) = count(distinct vencimento) from public.contas where grupo = g and status <> 'cancelada'), '3 um por mês';
  -- 4. dia 31: fevereiro vai no último dia e março volta para 31
  assert public.mes_seguinte('2027-01-31', 31) = '2027-02-28' and public.mes_seguinte('2027-02-28', 31) = '2027-03-31', '4 dia 31';
  -- 5. encerrar: para de lançar
  perform public.encerrar_despesa_fixa(g);
  assert public.gerar_despesas_fixas(400) = 0, '5 encerrada';
  -- 5b. escolhendo a ÚLTIMA da sequência, também ficam só as de até 30 dias (Codex, 07/11)
  insert into public.contas (descricao, categoria, valor, vencimento, parcela, parcelas, grupo, origem)
  select 'Internet', 'Fixa', 100, (d0 + make_interval(months => k))::date, k + 1, 12, '00000000-0000-0000-0000-0000000000f2', 'recorrente' from generate_series(0, 11) k;
  r := public.tornar_despesa_fixa((select id from public.contas where descricao = 'Internet' order by vencimento desc limit 1));
  assert (select bool_and(vencimento <= hoje + 30) from public.contas where descricao = 'Internet' and status = 'aberta')
     and (select count(*) from public.contas where descricao = 'Internet' and status = 'aberta') between 1 and 2, '5b só até 30 dias: ' || r::text;
  -- 5c. cancelar a primeira cobrança não muda o dia: começou 31/01, a de fevereiro é 28/02, a de março volta para 31
  insert into public.contas (descricao, valor, vencimento, grupo, origem, fixa, status) values
    ('Seguro', 50, '2027-01-31', '00000000-0000-0000-0000-0000000000f3', 'recorrente', true, 'cancelada'),
    ('Seguro', 50, '2027-02-28', '00000000-0000-0000-0000-0000000000f3', 'recorrente', true, 'aberta');
  perform public.gerar_despesas_fixas(('2027-03-31'::date - current_date) + 1);
  assert exists (select 1 from public.contas where descricao = 'Seguro' and vencimento = '2027-03-31'), '5c dia 31 mantido';
  -- 5d. cancelar uma mensalidade gerada (uma a uma) não faz ela voltar
  update public.contas set status = 'cancelada' where descricao = 'Seguro' and vencimento = '2027-03-31';
  perform public.gerar_despesas_fixas(('2027-03-31'::date - current_date) + 1);
  assert (select status from public.contas where descricao = 'Seguro' and vencimento = '2027-03-31') = 'cancelada'
     and (select count(*) from public.contas where descricao = 'Seguro' and vencimento = '2027-03-31') = 1, '5d cancelada não volta';
  -- 5e. sequência com uma cobrança distante já cancelada antes da conversão: os meses do meio voltam, a cancelada não
  insert into public.contas (descricao, valor, vencimento, grupo, origem, status, obs)
  select 'Software', 30, (d0 + make_interval(months => k))::date, '00000000-0000-0000-0000-0000000000f4', 'recorrente',
         case when k = 5 then 'cancelada' else 'aberta' end, '' from generate_series(0, 5) k;
  r := public.tornar_despesa_fixa((select id from public.contas where descricao = 'Software' order by vencimento limit 1));
  perform public.gerar_despesas_fixas(((d0 + interval '5 months')::date - current_date) + 1);
  assert (select count(*) from public.contas where descricao = 'Software' and status = 'aberta') = 5
     and (select status from public.contas where descricao = 'Software' and vencimento = (d0 + interval '5 months')::date and obs = '') = 'cancelada', '5e meses do meio voltam';
  -- 5f. despesa nova com a única cobrança cancelada continua (não encerra sozinha)
  insert into public.contas (descricao, valor, vencimento, grupo, origem, fixa, status) values
    ('Alarme', 80, current_date + 5, '00000000-0000-0000-0000-0000000000f5', 'recorrente', true, 'cancelada');
  perform public.gerar_despesas_fixas(40);
  assert exists (select 1 from public.contas where descricao = 'Alarme' and status = 'aberta'), '5f continua';
  -- 6. parcelado não vira fixa; sem administrador não lança
  insert into public.contas (descricao, valor, vencimento, origem, parcela, parcelas) values ('Compra parcelada', 100, hoje, 'parcelado', 1, 3);
  begin perform public.tornar_despesa_fixa((select id from public.contas where descricao = 'Compra parcelada')); assert false, '6 parcelado aceito';
  exception when raise_exception then null; end;
  raise notice 'OK: v43 (11 cenários)';
end $$;
