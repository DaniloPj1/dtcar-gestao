-- Cenários do v21 (cada um para com erro se o resultado não for o esperado)
\set ON_ERROR_STOP 1
insert into public.ordens (id, numero, status, cliente, veiculo, total) values
  ('00000000-0000-0000-0000-000000000001', 1904, 'diagnostico', '{"nome":"Eduardo"}', '{"placa":"MSA9B73"}', 0),
  ('00000000-0000-0000-0000-000000000002', 1905, 'execucao', '{}', '{}', 100),
  ('00000000-0000-0000-0000-000000000003', 1906, 'entregue', '{}', '{}', 50);
insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit, aprovado) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000002', 'servico', 'Alinhamento', 1, 100, true);
insert into public.produtos (codigo, descricao, custo, estoque_atual) values (500, 'OLEO 90 1L', 40, 5);

do $$
declare r jsonb; it text := '[
  {"tipo":"servico","descricao":"Desmontagem suspensão dianteira","qtd":1,"valor_unit":600},
  {"tipo":"servico","descricao":"Remoção e reparo diferencial dianteiro","qtd":1,"valor_unit":600},
  {"tipo":"peca","descricao":"Braço auxiliar","qtd":1,"valor_unit":298},
  {"tipo":"peca","descricao":"Thinner","qtd":2,"valor_unit":28},
  {"tipo":"peca","descricao":"Silicone veda junta","qtd":1,"valor_unit":45},
  {"tipo":"peca","descricao":"Retentor do diferencial","qtd":2,"valor_unit":45},
  {"tipo":"peca","descricao":"Óleo 90","qtd":3,"valor_unit":68,"codigo":"500"}]';
begin
  -- 1. prévia não grava
  r := public.agente_lancar_itens_os(jsonb_build_object('numero', 1904, 'itens', it::jsonb), false);
  assert (r->>'total_os')::numeric = 1893 and (r->>'pode_lancar')::boolean and not (r->>'gravado')::boolean, '1 prévia: ' || r;
  assert (select count(*) from public.os_itens where ordem_id = '00000000-0000-0000-0000-000000000001') = 0, '1 prévia gravou';
  assert (r->>'custo')::numeric = 120, '1 custo do estoque (3 x 40): ' || r->>'custo';
  -- 2. grava: itens, total, custo, estoque, histórico
  r := public.agente_lancar_itens_os(jsonb_build_object('numero', 1904, 'itens', it::jsonb, 'pedido', 'teste'), true);
  assert (r->>'gravado')::boolean, '2 gravado: ' || r;
  assert (select count(*) from public.os_itens where ordem_id = '00000000-0000-0000-0000-000000000001') = 7, '2 itens';
  assert (select total from public.ordens where numero = 1904) = 1893, '2 total da O.S.';
  assert (select custo from public.ordens where numero = 1904) = 120, '2 custo da O.S.';
  assert (select estoque_atual from public.produtos where codigo = 500) = 2, '2 baixa no estoque';
  assert (select count(*) from public.estoque_mov where tipo = 'saida') = 1, '2 movimento de estoque';
  assert (select count(*) from public.os_itens where ordem_id = '00000000-0000-0000-0000-000000000001' and produto_id is null and tipo = 'peca') = 4, '2 itens genéricos sem estoque';
  assert (select string_agg(descricao, '|' order by posicao) from public.os_itens where ordem_id = '00000000-0000-0000-0000-000000000001') like 'Desmontagem%|Óleo 90', '2 ordem dos itens';
  assert (select count(*) from public.eventos where ordem_id = '00000000-0000-0000-0000-000000000001' and tipo = 'itens') = 1, '2 evento';
  assert (select count(*) from public.agente_acoes where ferramenta = 'lancar_itens_os') = 1, '2 histórico do agente';
  -- 3. repetir o mesmo pedido: bloqueia (não duplica)
  r := public.agente_lancar_itens_os(jsonb_build_object('numero', 1904, 'itens', it::jsonb), true);
  assert not (r->>'pode_lancar')::boolean and jsonb_array_length(r->'erros') = 7, '3 repetido: ' || r;
  assert (select count(*) from public.os_itens where ordem_id = '00000000-0000-0000-0000-000000000001') = 7, '3 duplicou';
  -- 4. O.S. em execução: entra como adicional e não muda o total aprovado
  r := public.agente_lancar_itens_os('{"numero":1905,"itens":[{"tipo":"peca","descricao":"Pastilha","qtd":1,"valor_unit":150}]}', true);
  assert (r->>'gravado')::boolean and (select total from public.ordens where numero = 1905) = 100, '4 total aprovado mudou: ' || r;
  assert (select adicional and aprovado is null from public.os_itens where descricao = 'Pastilha'), '4 adicional';
  -- 5. O.S. entregue: recusa
  r := public.agente_lancar_itens_os('{"numero":1906,"itens":[{"tipo":"servico","descricao":"X","qtd":1,"valor_unit":1}]}', true);
  assert not (r->>'pode_lancar')::boolean, '5 entregue: ' || r;
  -- 6. código inexistente e tipo inválido
  r := public.agente_lancar_itens_os('{"numero":1904,"itens":[{"tipo":"peca","descricao":"Y","qtd":1,"valor_unit":1,"codigo":"999"},{"tipo":"outro","descricao":"Z","qtd":1,"valor_unit":1}]}', false);
  assert jsonb_array_length(r->'erros') = 2, '6 erros: ' || r;
  -- 7. O.S. inexistente
  begin perform public.agente_lancar_itens_os('{"numero":9999,"itens":[{"tipo":"servico","descricao":"X","qtd":1,"valor_unit":1}]}', false); assert false, '7 sem erro';
  exception when raise_exception then null; end;
  raise notice 'OK: v21 (7 cenários)';
end $$;
