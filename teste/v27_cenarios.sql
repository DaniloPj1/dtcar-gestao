-- Cenários do v27 (cada um para com erro se o resultado não for o esperado)
\set ON_ERROR_STOP 1
insert into public.ordens (id, numero, status, cliente, veiculo, total, finalizada_em) values
  ('00000000-0000-0000-0000-000000000001', 1904, 'diagnostico', '{"nome":"Eduardo"}', '{"placa":"MSA9B73"}', 0, null),
  ('00000000-0000-0000-0000-000000000002', 1905, 'execucao', '{}', '{}', 100, null),
  ('00000000-0000-0000-0000-000000000003', 1906, 'entregue', '{}', '{}', 50, now()),
  ('00000000-0000-0000-0000-000000000004', 1907, 'entregue', '{}', '{}', 200, null),
  ('00000000-0000-0000-0000-000000000005', 1908, 'pronto', '{}', '{}', 80, null),
  ('00000000-0000-0000-0000-000000000006', 1909, 'cancelado', '{}', '{}', 0, null);
insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit, aprovado) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 'servico', 'Alinhamento', 1, 100, true),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000004', 'servico', 'Revisão', 1, 200, true),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000005', 'servico', 'Balanceamento', 1, 80, true);

do $$
declare r jsonb;
begin
  -- 1. orçamento: entra no orçamento (sem aprovação própria), como antes
  r := public.agente_lancar_itens_os('{"numero":1904,"itens":[{"tipo":"servico","descricao":"Diagnóstico","qtd":1,"valor_unit":120}]}', true);
  assert (r->>'gravado')::boolean and (select aprovado is null from public.os_itens where descricao = 'Diagnóstico'), '1 orçamento: ' || r::text;
  -- 2. execução: entra APROVADO e soma no total (100 + 150)
  r := public.agente_lancar_itens_os('{"numero":1905,"itens":[{"tipo":"peca","descricao":"Pastilha","qtd":1,"valor_unit":150}]}', true);
  assert (r->>'gravado')::boolean and (select total from public.ordens where numero = 1905) = 250, '2 total: ' || r::text;
  assert (select aprovado is true and adicional and not executado from public.os_itens where descricao = 'Pastilha'), '2 aprovado';
  -- 3. no pátio (pronto): aprovado, executado, soma (80 + 40) e avisa para conferir recebimento
  r := public.agente_lancar_itens_os('{"numero":1908,"itens":[{"tipo":"servico","descricao":"Rodízio de pneus","qtd":1,"valor_unit":40}]}', true);
  assert (r->>'gravado')::boolean and (select total from public.ordens where numero = 1908) = 120, '3 total: ' || r::text;
  assert (select aprovado is true and executado from public.os_itens where descricao = 'Rodízio de pneus'), '3 executado';
  assert r::text like '%aguardando pagamento%', '3 aviso: ' || r::text;
  -- 4. entregue sem quitar (aguardando pagamento): pode (200 + 35)
  r := public.agente_lancar_itens_os('{"numero":1907,"itens":[{"tipo":"servico","descricao":"Taxa","qtd":1,"valor_unit":35}]}', true);
  assert (r->>'gravado')::boolean and (select total from public.ordens where numero = 1907) = 235, '4 entregue aberta: ' || r::text;
  -- 5. entregue e quitada (fechada): recusa
  r := public.agente_lancar_itens_os('{"numero":1906,"itens":[{"tipo":"servico","descricao":"X","qtd":1,"valor_unit":1}]}', true);
  assert not (r->>'pode_lancar')::boolean and r::text like '%O.S. aberta%', '5 fechada: ' || r::text;
  -- 6. cancelada: recusa
  r := public.agente_lancar_itens_os('{"numero":1909,"itens":[{"tipo":"servico","descricao":"X","qtd":1,"valor_unit":1}]}', false);
  assert not (r->>'pode_lancar')::boolean, '6 cancelada: ' || r::text;
  -- 7. histórico diz que entrou aprovado
  assert exists (select 1 from public.eventos where texto like '%já aprovados e cobrados%'), '7 evento';
  raise notice 'OK: v27 (7 cenários)';
end $$;
