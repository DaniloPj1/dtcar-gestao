-- Cenários do v31 (cada um para com erro se o resultado não for o esperado)
\set ON_ERROR_STOP 1
insert into public.fornecedores (id, cnpj, razao, fantasia) values
  ('00000000-0000-0000-0000-0000000000f1', '20.149.617/0003-42', 'BIANCARDI AUTO PECAS LTDA', 'Biancardi'),
  ('00000000-0000-0000-0000-0000000000f2', '08894919000188', 'SOMAX IMPORTADORA E DISTRIBUIDORA LTDA', 'Somax'),
  ('00000000-0000-0000-0000-0000000000f3', '', 'AUTO PECAS CENTRO', ''),
  ('00000000-0000-0000-0000-0000000000f4', '', 'AUTO PECAS NORTE', '');
insert into public.ordens (id, numero, status, cliente, veiculo, total) values
  ('00000000-0000-0000-0000-000000000001', 1854, 'execucao', '{"nome":"Cliente Diversos"}', '{"placa":"MRE1D03"}', 13177.06);

do $$
declare r jsonb;
begin
  -- 1. prévia: acha a Biancardi pelo CNPJ, liga à O.S. e não grava
  r := public.agente_registrar_pre_nota('{"fornecedor":"Biancardi","fornecedor_cnpj":"20149617000342","documento":"PV 57941","data":"2026-11-03","total":250.74,"os_numero":1854}', false);
  assert (r->>'pode_registrar')::boolean and not (r->>'gravado')::boolean and (r->>'fornecedor_cadastrado')::boolean and r->>'placa' = 'MRE1D03', '1 prévia: ' || r::text;
  assert (select count(*) from public.pre_notas) = 0, '1 não gravou';
  -- 2. grava: fornecedor ligado, O.S. e placa, histórico do agente
  r := public.agente_registrar_pre_nota('{"fornecedor":"Biancardi","fornecedor_cnpj":"20149617000342","documento":"PV 57941","data":"2026-11-03","total":250.74,"os_numero":1854,"pedido":"cupom da Parati"}', true);
  assert (r->>'gravado')::boolean, '2 gravou: ' || r::text;
  assert (select fornecedor_id = '00000000-0000-0000-0000-0000000000f1' and os_numero = 1854 and placa = 'MRE1D03' and total = 250.74 and situacao = 'aberta'
          and ordem_id = '00000000-0000-0000-0000-000000000001' and fornecedor_nome = 'Biancardi' from public.pre_notas where documento = 'PV 57941'), '2 linha';
  assert (select count(*) from public.agente_acoes where ferramenta = 'registrar_pre_nota') = 1, '2 histórico';
  -- 3. repetido (mesmo fornecedor + documento): recusa sem confirmação, grava com confirmação
  r := public.agente_registrar_pre_nota('{"fornecedor":"Biancardi","documento":"pv 57941","data":"2026-11-03","total":250.74}', true);
  assert not (r->>'pode_registrar')::boolean and r::text like '%já foi registrado%' and (select count(*) from public.pre_notas) = 1, '3 repetido: ' || r::text;
  r := public.agente_registrar_pre_nota('{"fornecedor":"Biancardi","documento":"pv 57941","data":"2026-11-03","total":250.74,"registrar_mesmo_repetido":true}', true);
  assert (r->>'gravado')::boolean and (select count(*) from public.pre_notas) = 2, '3 confirmado';
  update public.pre_notas set situacao = 'cancelada' where documento = 'pv 57941';
  -- 4. pelo nome (fantasia), sem CNPJ
  r := public.agente_registrar_pre_nota('{"fornecedor":"somax","documento":"Pedido 35136","data":"2026-11-03","total":117,"os_numero":"1854"}', true);
  assert (r->>'gravado')::boolean and (select fornecedor_id = '00000000-0000-0000-0000-0000000000f2' from public.pre_notas where documento = 'Pedido 35136'), '4 somax: ' || r::text;
  -- 5. fornecedor sem cadastro: grava pelo nome, com aviso; nome que bate em dois cadastros também fica sem ligação
  r := public.agente_registrar_pre_nota('{"fornecedor":"Moto Capichaba","documento":"NFC-e 132568","data":"2026-11-04","total":417}', true);
  assert (r->>'gravado')::boolean and not (r->>'fornecedor_cadastrado')::boolean and r::text like '%sem cadastro%', '5 sem cadastro: ' || r::text;
  r := public.agente_registrar_pre_nota('{"fornecedor":"auto pecas","documento":"77","data":"2026-11-04","total":10}', false);
  assert not (r->>'fornecedor_cadastrado')::boolean, '5 ambíguo: ' || r::text;
  -- 6. erros: sem documento, valor zero, data inválida, O.S. inexistente
  r := public.agente_registrar_pre_nota('{"fornecedor":"Biancardi","documento":"","data":"2026-13-40","total":0,"os_numero":9999}', true);
  assert not (r->>'pode_registrar')::boolean and jsonb_array_length(r->'erros') = 4, '6 erros: ' || r::text;
  -- 7. lista por fornecedor e período com totais (abertas)
  r := public.agente_pre_notas(null, '2026-11-01', '2026-11-30', 'abertas');
  assert (r->>'quantidade')::int = 3 and (r->>'total')::numeric = 784.74 and jsonb_array_length(r->'fornecedores') = 3, '7 lista: ' || r::text;
  r := public.agente_pre_notas('biancardi', '2026-11-01', '2026-11-30', 'abertas');
  assert (r->>'quantidade')::int = 1 and (r->>'total')::numeric = 250.74, '7 filtro: ' || r::text;
  -- 8. conferida no acerto sai das abertas e aparece nas conferidas
  update public.pre_notas set situacao = 'conferida', conferida_em = now(), conferida_por = 'Danilo' where documento = 'PV 57941' and situacao = 'aberta';
  r := public.agente_pre_notas('biancardi', '2026-11-01', '2026-11-30', 'abertas');
  assert (r->>'quantidade')::int = 0 and (r->>'total')::numeric = 0, '8 abertas: ' || r::text;
  r := public.agente_pre_notas('biancardi', '2026-11-01', '2026-11-30', 'conferidas');
  assert (r->>'quantidade')::int = 1, '8 conferidas: ' || r::text;
  raise notice 'OK: v31 (8 cenários)';
end $$;
