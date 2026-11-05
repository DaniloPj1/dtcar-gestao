-- Cenários do v37 (cada um para com erro se o resultado não for o esperado)
\set ON_ERROR_STOP 1
update public.config set dados = '{"formasPagamento":["PIX","Dinheiro","Cartão de débito","Cartão de crédito","Boleto"],
  "contasFinanceiras":[{"nome":"Sicredi"},{"nome":"PicPay PJ"},{"nome":"Espécie"}],"contaRecebimento":"Sicredi"}' where id = 1;
insert into public.clientes (id, nome, doc) values ('00000000-0000-0000-0000-0000000000c1', 'Tadeu Veiculos Ltda', '12.345.678/0001-90');
insert into public.ordens (id, numero, status, cliente, cliente_id, veiculo, total, checkin) values
  ('00000000-0000-0000-0000-000000000001', 1868, 'entregue', '{"nome":"Tadeu Veiculos Ltda"}', '00000000-0000-0000-0000-0000000000c1', '{"placa":"QPR8A02","marca":"Chevrolet","modelo":"COBALT"}', 150, '{"legado":{"a_receber":true}}'),
  ('00000000-0000-0000-0000-000000000002', 1869, 'entregue', '{"nome":"Tadeu Veiculos Ltda"}', '00000000-0000-0000-0000-0000000000c1', '{"placa":"PPE2I96"}', 2525, '{"legado":{"a_receber":true}}'),
  ('00000000-0000-0000-0000-000000000003', 1870, 'pronto', '{}', null, '{}', 300, '{}'),
  ('00000000-0000-0000-0000-000000000004', 1871, 'execucao', '{}', null, '{}', 300, '{}'),
  ('00000000-0000-0000-0000-000000000005', 1872, 'entregue', '{"nome":"Maria"}', null, '{}', 1000, '{}');
insert into public.receber (ordem_id, cliente_nome, parcela, parcelas, valor, vencimento) values
  ('00000000-0000-0000-0000-000000000001', 'Tadeu', 1, 1, 150, '2026-11-06'),
  ('00000000-0000-0000-0000-000000000002', 'Tadeu', 1, 1, 2525, '2026-11-06'),
  ('00000000-0000-0000-0000-000000000005', 'Maria', 1, 2, 500, '2026-11-10'),
  ('00000000-0000-0000-0000-000000000005', 'Maria', 2, 2, 500, '2026-12-10');

do $$
declare r jsonb;
begin
  -- 1. prévia: dinheiro vai para Espécie, valor = saldo, não grava
  r := public.agente_receber_os('{"numero":1868,"forma":"dinheiro"}', false);
  assert (r->>'pode_receber')::boolean and not (r->>'gravado')::boolean and r->>'conta_entrada' = 'Espécie' and (r->>'valor')::numeric = 150
         and r->>'forma' = 'Dinheiro' and (r->>'vai_fechar')::boolean, '1 prévia: ' || r::text;
  assert not exists (select 1 from public.recibos), '1 prévia gravou';
  -- 2. grava: recibo, parcela paga, O.S. fechada, histórico
  r := public.agente_receber_os('{"numero":1868,"forma":"Dinheiro","pedido":"Tadeu pagou em dinheiro"}', true);
  assert (r->>'gravado')::boolean and (r->>'fechada')::boolean, '2 gravou: ' || r::text;
  assert (select count(*) from public.recibos where ordem_id = '00000000-0000-0000-0000-000000000001' and valor = 150 and conta_destino = 'Espécie'
          and doc = '12345678000190' and referente like '%nº 01868 – Chevrolet COBALT placa QPR8A02') = 1, '2 recibo';
  assert (select status = 'paga' and recibo_id is not null from public.receber where ordem_id = '00000000-0000-0000-0000-000000000001'), '2 parcela';
  assert (select finalizada_em is not null and recebido = 150 from public.ordens where numero = 1868), '2 fechada';
  assert exists (select 1 from public.eventos where texto like '%agente (Claude): R$ 150,00 (Dinheiro, conta Espécie)%'), '2 evento';
  assert exists (select 1 from public.agente_acoes where ferramenta = 'receber_os' and pedido = 'Tadeu pagou em dinheiro'), '2 histórico';
  -- 3. de novo na mesma O.S.: já fechada
  r := public.agente_receber_os('{"numero":1868,"forma":"Dinheiro"}', true);
  assert not (r->>'pode_receber')::boolean and r::text like '%já está fechada%', '3 fechada: ' || r::text;
  -- 4. PIX sem conta: conta padrão de recebimento
  r := public.agente_receber_os('{"numero":1869,"forma":"pix"}', false);
  assert r->>'conta_entrada' = 'Sicredi', '4 conta padrão: ' || r::text;
  -- 5. conta e forma inexistentes
  r := public.agente_receber_os('{"numero":1869,"forma":"cheque","conta":"Itaú"}', false);
  assert not (r->>'pode_receber')::boolean and r::text like '%Forma de pagamento %cheque% não existe%' and r::text like '%Conta %Itaú% não existe%', '5 forma/conta: ' || r::text;
  -- 6. valor maior que o saldo
  r := public.agente_receber_os('{"numero":1869,"forma":"Dinheiro","valor":3000}', false);
  assert not (r->>'pode_receber')::boolean and r::text like '%maior que o saldo%', '6 valor: ' || r::text;
  -- 7. no pátio e em execução: recusa
  r := public.agente_receber_os('{"numero":1870,"forma":"Dinheiro"}', true);
  assert not (r->>'pode_receber')::boolean and r::text like '%ainda está no pátio%', '7 pátio: ' || r::text;
  r := public.agente_receber_os('{"numero":1871,"forma":"Dinheiro"}', true);
  assert not (r->>'pode_receber')::boolean, '7 execução: ' || r::text;
  -- 8. parcial em 2 parcelas: 700 baixa a 1ª (500) e divide a 2ª (200 paga + 300 em aberto); não fecha
  r := public.agente_receber_os('{"numero":1872,"forma":"PIX","conta":"picpay pj","valor":700,"data":"2026-11-01"}', true);
  assert (r->>'gravado')::boolean and not (r->>'fechada')::boolean and r->>'conta_entrada' = 'PicPay PJ', '8 parcial: ' || r::text;
  assert (select count(*) from public.receber where ordem_id = '00000000-0000-0000-0000-000000000005' and status = 'paga') = 2, '8 pagas';
  assert (select valor = 300 and vencimento = '2026-12-10' from public.receber where ordem_id = '00000000-0000-0000-0000-000000000005' and status = 'aberta'), '8 resto';
  assert (select recebido = 700 and finalizada_em is null from public.ordens where numero = 1872), '8 recebido';
  -- 9. repetido em 10 minutos: pede confirmação; com confirmação, quita e fecha (300)
  insert into public.recibos (ordem_id, pagador, valor, forma) values ('00000000-0000-0000-0000-000000000005', 'Maria', 100, 'PIX');
  update public.recibos set cancelado = true where valor = 100;  -- recibo cancelado não conta como repetido nem como recebido
  r := public.agente_receber_os('{"numero":1872,"forma":"PIX","valor":700}', false);
  assert not (r->>'pode_receber')::boolean, '9a valor > saldo: ' || r::text;
  insert into public.recibos (ordem_id, pagador, valor, forma) values ('00000000-0000-0000-0000-000000000004', 'X', 300, 'PIX'); -- outra O.S.: não conta
  r := public.agente_receber_os('{"numero":1872,"forma":"PIX"}', true);
  assert (r->>'gravado')::boolean and (r->>'fechada')::boolean and (r->>'valor')::numeric = 300, '9b quitou: ' || r::text;
  -- 10. data no futuro e O.S. inexistente
  r := public.agente_receber_os('{"numero":1869,"forma":"Dinheiro","data":"2099-01-01"}', false);
  assert r::text like '%futuro%', '10 futuro: ' || r::text;
  begin perform public.agente_receber_os('{"numero":9999,"forma":"Dinheiro"}', false); assert false, '10 inexistente';
  exception when others then assert sqlerrm like '%não encontrada%', sqlerrm; end;
  -- 11. mesmo valor há menos de 10 min na mesma O.S.: pede confirmação
  insert into public.ordens (id, numero, status, cliente, veiculo, total) values ('00000000-0000-0000-0000-000000000006', 1873, 'entregue', '{}', '{}', 400);
  insert into public.recibos (ordem_id, pagador, valor, forma) values ('00000000-0000-0000-0000-000000000006', 'Y', 200, 'PIX');
  r := public.agente_receber_os('{"numero":1873,"forma":"PIX","valor":200}', false);
  assert not (r->>'pode_receber')::boolean and r::text like '%menos de 10 minutos%', '11 repetido: ' || r::text;
  r := public.agente_receber_os('{"numero":1873,"forma":"PIX","valor":200,"receber_mesmo_repetido":true}', true);
  assert (r->>'gravado')::boolean and (r->>'fechada')::boolean, '11 confirmado: ' || r::text;
  raise notice 'OK: v37 (11 cenários)';
end $$;
