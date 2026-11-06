-- Cenários do supabase/v40.sql (teste/teste_v40.sh). Para no primeiro que falhar.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHOU: %', m; end if; end $$;
-- erro esperado: roda o comando e confere o texto da mensagem
create or replace function pg_temp.erro(cmd text, trecho text) returns void language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlerrm ilike '%' || trecho || '%' then return; end if;
    raise exception 'FALHOU: esperava erro com "%", veio "%"', trecho, sqlerrm;
  end;
  raise exception 'FALHOU: esperava erro com "%" e passou', trecho;
end $$;

insert into public.clientes (id, nome, codigo, telefone) values ('00000000-0000-0000-0000-0000000000c1', 'Ana Souza', 1, '27999990000'), ('00000000-0000-0000-0000-0000000000c2', 'Bruno Lima', 2, '27988880000');
insert into public.veiculos (id, placa, marca, modelo, ano, cliente_id) values ('00000000-0000-0000-0000-0000000000f1', 'ABC1D23', 'Fiat', 'Uno', '2015', '00000000-0000-0000-0000-0000000000c1'),
  ('00000000-0000-0000-0000-0000000000f2', 'XYZ9K88', 'VW', 'Gol', '2018', '00000000-0000-0000-0000-0000000000c2');
insert into public.produtos (id, codigo, descricao, custo, estoque_atual) values ('00000000-0000-0000-0000-0000000000a1', 100, 'Pastilha dianteira', 50, 10);
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada)
values ('00000000-0000-0000-0000-000000000001', 1, 'diagnostico', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '{"nome": "Ana Souza", "telefone": "27999990000"}', '{"placa": "ABC1D23", "marca": "Fiat", "modelo": "Uno"}', 1000),
       ('00000000-0000-0000-0000-000000000002', 2, 'diagnostico', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1',
        '{"nome": "Ana Souza", "telefone": "27999990000"}', '{"placa": "ABC1D23"}', 1500);
select null from public.agente_lancar_itens_os('{"numero": 1, "itens": [{"tipo": "servico", "descricao": "Troca de pastilhas", "qtd": 1, "valor_unit": 200},
  {"tipo": "peca", "descricao": "Pastilha", "codigo": "100", "qtd": 2, "valor_unit": 100}]}', true);
select null from pg_temp.ok((select estoque_atual from public.produtos where codigo = 100) = 8, 'lançar reserva 2 pastilhas');

do $$
declare r jsonb; n int; o public.ordens; v_id uuid;
begin
  -- 1. prévia não grava nada
  select count(*) into n from public.agente_acoes;
  r := public.agente_fazer('alterar_os', '{"numero": 1, "acao": "aprovar"}', false);
  perform pg_temp.ok((r->>'gravado')::boolean = false and r->>'status' = 'execucao', 'prévia mostra execução sem gravar');
  perform pg_temp.ok((select status from public.ordens where numero = 1) = 'diagnostico', 'prévia não mudou a O.S.');
  perform pg_temp.ok((select count(*) from public.agente_acoes) = n, 'prévia não registrou histórico');

  -- 2. aprovar
  r := public.agente_fazer('alterar_os', '{"numero": 1, "acao": "aprovar", "pedido": "cliente aprovou"}', true);
  select * into o from public.ordens where numero = 1;
  perform pg_temp.ok(o.status = 'execucao' and o.total = 400 and o.aprovacao is not null, 'aprovada, total 400');
  perform pg_temp.ok(not exists (select 1 from public.os_itens where ordem_id = o.id and aprovado is not true), 'itens aprovados');

  -- 3. alterar quantidade da peça (estoque acompanha)
  select id into v_id from public.os_itens where ordem_id = o.id and tipo = 'peca';
  r := public.agente_fazer('alterar_os', jsonb_build_object('numero', 1, 'itens_alterar', jsonb_build_array(jsonb_build_object('id', v_id, 'qtd', 3))), true);
  perform pg_temp.ok((select total from public.ordens where numero = 1) = 500, 'qtd 3: total 500');
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 100) = 7, 'estoque 7');
  -- produto que não pode ser vendido sem estoque: não passa do disponível (7 + 3 já reservados = 10)
  update public.produtos set vender_sem_estoque = false where codigo = 100;
  perform pg_temp.erro(format($c$select public.agente_fazer('alterar_os', '{"numero": 1, "itens_alterar": [{"id": "%s", "qtd": 11}]}', true)$c$, v_id), 'estoque insuficiente');
  r := public.agente_fazer('alterar_os', jsonb_build_object('numero', 1, 'itens_alterar', jsonb_build_array(jsonb_build_object('id', v_id, 'qtd', 10))), false);
  perform pg_temp.erro(format($c$select public.agente_fazer('alterar_os', '{"numero": 1, "itens_alterar": [{"id": "%s", "qtd": -1}]}', true)$c$, v_id), 'maior que zero');
  update public.produtos set vender_sem_estoque = true where codigo = 100;
  -- marcar como peça do cliente zera o preço (prévia)
  r := public.agente_fazer('alterar_os', jsonb_build_object('numero', 1, 'itens_alterar', jsonb_build_array(jsonb_build_object('id', v_id, 'peca_do_cliente', true))), false);
  perform pg_temp.ok((r->>'total')::numeric = 200, 'peça do cliente sai do total: ' || (r->>'total'));

  -- 4. remover o serviço; 5. incluir outro (entra aprovado)
  select id into v_id from public.os_itens where ordem_id = o.id and tipo = 'servico';
  r := public.agente_fazer('alterar_os', jsonb_build_object('numero', 1, 'itens_remover', jsonb_build_array(v_id),
         'itens_incluir', '[{"tipo": "servico", "descricao": "Mão de obra freio", "qtd": 1, "valor_unit": 150}]'::jsonb), true);
  perform pg_temp.ok((select total from public.ordens where numero = 1) = 450, 'remove 200, inclui 150: total 450');
  perform pg_temp.ok((select aprovado from public.os_itens where ordem_id = o.id and descricao = 'Mão de obra freio'), 'incluído aprovado');

  -- 6. dados (com apelidos) e campo inexistente
  r := public.agente_fazer('alterar_os', '{"numero": 1, "dados": {"km": 1200, "obs": "cliente espera", "box": "B2", "previsao": "2026-11-10"}}', true);
  select * into o from public.ordens where numero = 1;
  perform pg_temp.ok(o.km_entrada = 1200 and o.obs_internas = 'cliente espera' and o.box = 'B2' and o.previsao_entrega = '2026-11-10', 'dados gravados');
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "dados": {"cor_do_ceu": "azul"}}', true)$c$, 'não existe em ordens');
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "dados": {"total": 1}}', true)$c$, 'não se muda por aqui');

  -- 7. concluir; 8. sinal no pátio pelo receber_os
  r := public.agente_fazer('alterar_os', '{"numero": 1, "acao": "concluir"}', true);
  perform pg_temp.ok((select status from public.ordens where numero = 1) = 'pronto', 'concluída');
  r := public.agente_receber_os('{"numero": 1, "forma": "PIX", "valor": 100}', true);
  perform pg_temp.ok((r->>'gravado')::boolean and (select recebido from public.ordens where numero = 1) = 100, 'sinal de 100 no pátio');
  perform pg_temp.ok((select finalizada_em from public.ordens where numero = 1) is null, 'sinal não fecha');

  -- 9. entregar a prazo (parcela) ; 10. receber o resto fecha
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "acao": "entregar", "km_saida": 900}', true)$c$, 'não pode ser menor');
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "acao": "entregar", "km_saida": 1300, "parcelas": [{"valor": 500, "vencimento": "2026-12-01"}]}', true)$c$, 'deve ser igual ao saldo');
  r := public.agente_fazer('alterar_os', '{"numero": 1, "acao": "entregar", "km_saida": 1300, "parcelas": [{"valor": 350, "vencimento": "2026-12-01"}]}', true);
  select * into o from public.ordens where numero = 1;
  perform pg_temp.ok(o.status = 'entregue' and o.km_saida = 1300 and o.finalizada_em is null, 'entregue a receber');
  perform pg_temp.ok((select count(*) from public.receber where ordem_id = o.id and status = 'aberta' and valor = 350) = 1, 'parcela de 350');
  perform pg_temp.ok((select km_atual from public.veiculos where placa = 'ABC1D23') = 1300, 'km do veículo');
  r := public.agente_receber_os('{"numero": 1, "forma": "Dinheiro"}', true);
  perform pg_temp.ok((select finalizada_em from public.ordens where numero = 1) is not null and r->>'conta_entrada' = 'Espécie', 'quitou e fechou (dinheiro → Espécie)');

  -- O.S. fechada: itens e desconto não mudam; cancelar recusado
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "dados": {"desconto": 50}}', true)$c$, 'não mudam');
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "acao": "cancelar", "motivo": "x"}', true)$c$, 'já saiu');
  -- 11. reabrir; 12. cancelar recibo reabre a parcela
  r := public.agente_fazer('alterar_os', '{"numero": 1, "acao": "reabrir"}', true);
  perform pg_temp.ok((select status from public.ordens where numero = 1) = 'pronto', 'reaberta para o pátio');
  r := public.agente_fazer('cancelar_recibo', jsonb_build_object('numero', (select max(numero) from public.recibos), 'motivo', 'teste'), true);
  perform pg_temp.ok((r->>'parcelas_reabertas')::int = 1 and (select status from public.receber where ordem_id = o.id and valor = 350) = 'aberta', 'recibo cancelado, parcela em aberto');
  perform pg_temp.ok((select recebido from public.ordens where numero = 1) = 100, 'recebido volta a 100');

  -- boleto em aberto impede cancelar
  insert into public.boletos (ordem_id, situacao, valor, vencimento, nosso_numero) values (o.id, 'registrado', 10, current_date, '260000099');
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "acao": "cancelar", "motivo": "x"}', true)$c$, 'boleto Sicredi');
  delete from public.boletos;
  -- 13. cancelar O.S. devolve o estoque e cancela parcelas
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "acao": "cancelar"}', true)$c$, 'motivo');
  r := public.agente_fazer('alterar_os', '{"numero": 1, "acao": "cancelar", "motivo": "Cliente desistiu"}', true);
  perform pg_temp.ok((select status from public.ordens where numero = 1) = 'cancelado', 'cancelada');
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 100) = 10, 'estoque devolvido');
  perform pg_temp.ok(not exists (select 1 from public.receber where ordem_id = o.id and status = 'aberta'), 'parcelas canceladas');

  -- 14. excluir: recusa com recibo válido; depois de cancelar o recibo, exclui
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 1, "acao": "excluir"}', true)$c$, 'recibos válidos');
  r := public.agente_fazer('cancelar_recibo', jsonb_build_object('numero', (select min(numero) from public.recibos)), true);
  r := public.agente_fazer('alterar_os', '{"numero": 1, "acao": "excluir"}', true);
  perform pg_temp.ok(not exists (select 1 from public.ordens where numero = 1), 'O.S. excluída');
  perform pg_temp.ok((select antes->'ordem'->>'numero' from public.agente_acoes where ferramenta = 'alterar_os' and depois->>'excluida' = 'true') = '1', 'cópia no histórico');

  -- 15. orçamento: enviar, voltar, recusar, retirar; trocar cliente e veículo
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 2, "acao": "enviar_orcamento"}', true)$c$, 'Inclua peças');
  r := public.agente_fazer('alterar_os', '{"numero": 2, "itens_incluir": [{"tipo": "servico", "descricao": "Revisão", "qtd": 1, "valor_unit": 300}], "acao": "enviar_orcamento"}', true);
  perform pg_temp.ok((select status from public.ordens where numero = 2) = 'aguardando', 'orçamento enviado');
  r := public.agente_fazer('alterar_os', '{"numero": 2, "acao": "voltar_etapa"}', true);
  perform pg_temp.ok((select status from public.ordens where numero = 2) = 'diagnostico', 'voltou para elaboração');
  r := public.agente_fazer('alterar_os', '{"numero": 2, "cliente_id": "00000000-0000-0000-0000-0000000000c2", "placa": "xyz-9k88"}', true);
  select * into o from public.ordens where numero = 2;
  perform pg_temp.ok(o.cliente_id = '00000000-0000-0000-0000-0000000000c2' and o.cliente->>'nome' = 'Bruno Lima' and o.veiculo->>'placa' = 'XYZ9K88', 'cliente e veículo trocados');
  r := public.agente_fazer('alterar_os', '{"numero": 2, "acao": "recusar"}', true);
  perform pg_temp.ok((select status from public.ordens where numero = 2) = 'recusado' and (select total from public.ordens where numero = 2) = 0, 'recusada, total 0');
  r := public.agente_fazer('alterar_os', '{"numero": 2, "acao": "retirar", "km_saida": 1500}', true);
  perform pg_temp.ok((select entregue_em from public.ordens where numero = 2) is not null, 'retirada');
  r := public.agente_fazer('alterar_os', '{"numero": 2, "acao": "reabrir"}', true);
  perform pg_temp.ok((select status from public.ordens where numero = 2) = 'diagnostico', 'recusada reaberta');
  perform pg_temp.erro($c$select public.agente_fazer('alterar_os', '{"numero": 2, "acao": "voar"}', true)$c$, 'não existe');
end $$;
-- excluir O.S. com peça reservada no estoque (estorno aponta para a O.S.)
insert into public.ordens (id, numero, status, cliente_id, cliente, veiculo) values ('00000000-0000-0000-0000-000000000003', 3, 'diagnostico', '00000000-0000-0000-0000-0000000000c1', '{"nome": "Ana"}', '{}');
select null from public.agente_lancar_itens_os('{"numero": 3, "itens": [{"tipo": "peca", "descricao": "Pastilha", "codigo": "100", "qtd": 2, "valor_unit": 100}]}', true);
select null from public.agente_fazer('alterar_os', '{"numero": 3, "acao": "excluir"}', true);
select null from pg_temp.ok(not exists (select 1 from public.ordens where numero = 3) and (select estoque_atual from public.produtos where codigo = 100) = 10, 'excluída com a peça de volta ao estoque');
select 'ok: O.S.' as cenario;

-- ---------- cadastros ----------
do $$
declare r jsonb;
begin
  r := public.agente_fazer('salvar_cadastro', '{"tipo": "cliente", "codigo": 2, "campos": {"telefone": "(27) 98888-1111", "nome": "Bruno Lima Filho"}}', true);
  perform pg_temp.ok((select telefone from public.clientes where codigo = 2) = '27988881111', 'telefone só números');
  perform pg_temp.ok((select cliente->>'nome' from public.ordens where numero = 2) = 'Bruno Lima Filho', 'cópia na O.S. aberta');
  perform pg_temp.ok(not (r->'cadastro' ? 'telefone') and r->'alterado' ? 'telefone', 'resposta sem o telefone, com o que mudou');
  r := public.agente_fazer('salvar_cadastro', '{"tipo": "veiculo", "acao": "criar", "campos": {"placa": "qwe-1a23", "marca": "Ford", "modelo": "Ka", "cliente_id": "00000000-0000-0000-0000-0000000000c1"}}', true);
  perform pg_temp.ok(exists (select 1 from public.veiculos where placa = 'QWE1A23'), 'veículo criado');
  perform pg_temp.erro($c$select public.agente_fazer('salvar_cadastro', '{"tipo": "cliente", "acao": "excluir", "codigo": 2}', true)$c$, 'Não dá para excluir');
  r := public.agente_fazer('salvar_cadastro', '{"tipo": "veiculo", "acao": "excluir", "placa": "QWE1A23"}', true);
  perform pg_temp.ok(not exists (select 1 from public.veiculos where placa = 'QWE1A23'), 'veículo excluído');
end $$;
select 'ok: cadastros' as cenario;

-- ---------- contas a pagar, saldos, transferências ----------
insert into public.fornecedores (cnpj, razao, fantasia) values ('45987005026588', 'Comercial Automotiva S.A.', 'DPK');
do $$
declare r jsonb; v_id uuid; s numeric;
begin
  -- lançar pelo código do boleto: valor e vencimento saem dele
  r := public.agente_fazer('conta_pagar', '{"acao": "lancar", "contas": [{"descricao": "Boleto DPK NF 1", "fornecedor": "dpk",
        "linha_digitavel": "7489111111.22222222222.33333333333 4 1636 0000012345"}]}', true);
  select id into v_id from public.contas where descricao = 'Boleto DPK NF 1';
  perform pg_temp.ok((select valor from public.contas where id = v_id) = 123.45 and (select vencimento from public.contas where id = v_id) = '2026-11-20', 'valor e vencimento do boleto');
  perform pg_temp.ok((select fornecedor_id is not null and favorecido = 'DPK' and origem = 'boleto' from public.contas where id = v_id), 'fornecedor achado');
  perform pg_temp.erro($c$select public.agente_fazer('conta_pagar', '{"acao": "lancar", "contas": [{"descricao": "de novo", "linha_digitavel": "74891111112222222222233333333333416360000012345"}]}', true)$c$, 'já está lançado');
  insert into public.fornecedores (cnpj, razao, fantasia) values ('11111111000111', 'Auto Peças Um', 'AUTO UM'), ('22222222000122', 'Auto Peças Dois', 'AUTO DOIS');
  perform pg_temp.erro($c$select public.agente_fazer('conta_pagar', '{"acao": "lancar", "contas": [{"descricao": "x", "valor": 1, "vencimento": "2026-12-01", "fornecedor": "auto"}]}', false)$c$, 'bate com 3');
  perform pg_temp.ok(r->'avisos'->>0 like '%dígitos verificadores%', 'linha com dígito errado avisa');
  r := public.agente_fazer('conta_pagar', '{"acao": "lancar", "contas": [{"descricao": "Energia", "valor": 691.64, "vencimento": "2026-11-09"}, {"descricao": "Energia dezembro", "valor": 700, "vencimento": "2026-12-09"}]}', true);
  -- busca ambígua
  perform pg_temp.erro($c$select public.agente_fazer('conta_pagar', '{"acao": "pagar", "busca": "energia"}', false)$c$, 'Achei 2 contas');
  -- prévia não paga
  r := public.agente_fazer('conta_pagar', '{"acao": "pagar", "busca": "energia", "vencimento": "2026-11-09"}', false);
  perform pg_temp.ok(r->'conta'->>'saiu_da_conta' = 'Sicredi' and (select status from public.contas where descricao = 'Energia') = 'aberta', 'prévia do pagamento (conta padrão)');
  select (x->>'atual')::numeric into s from jsonb_array_elements(public.saldos_contas()) x where x->>'nome' = 'PicPay PJ';
  r := public.agente_fazer('conta_pagar', '{"acao": "pagar", "busca": "energia", "vencimento": "2026-11-09", "conta_origem": "picpay pj", "valor_pago": 700}', true);
  perform pg_temp.ok((select status = 'paga' and juros = 8.36 and valor_pago = 700 and conta_origem = 'PicPay PJ' from public.contas where descricao = 'Energia'), 'paga com juros pelo PicPay');
  perform pg_temp.ok((select (x->>'atual')::numeric from jsonb_array_elements(public.saldos_contas()) x where x->>'nome' = 'PicPay PJ') = s - 700, 'saldo do PicPay caiu 700');
  perform pg_temp.erro($c$select public.agente_fazer('conta_pagar', '{"acao": "pagar", "busca": "Boleto DPK", "conta_origem": "Itaú"}', true)$c$, 'não existe');
  perform pg_temp.erro($c$select public.agente_fazer('conta_pagar', '{"acao": "editar", "busca": "Energia", "vencimento": "2026-11-09", "campos": {"valor_pago": 800}}', true)$c$, 'desfazer e pague de novo');
  r := public.agente_fazer('conta_pagar', '{"acao": "desfazer", "busca": "Energia", "vencimento": "2026-11-09"}', true);
  perform pg_temp.ok((select status from public.contas where descricao = 'Energia') = 'aberta', 'pagamento desfeito');
  r := public.agente_fazer('conta_pagar', jsonb_build_object('acao', 'editar', 'id', v_id, 'campos', jsonb_build_object('categoria', 'Fornecedores de peças')), true);
  perform pg_temp.ok((select categoria from public.contas where id = v_id) = 'Fornecedores de peças', 'conta editada');
  r := public.agente_fazer('conta_pagar', '{"acao": "cancelar", "busca": "Energia dezembro"}', true);
  perform pg_temp.ok((select status from public.contas where descricao = 'Energia dezembro') = 'cancelada', 'conta cancelada');
  r := public.agente_fazer('conta_pagar', '{"acao": "excluir", "busca": "Energia dezembro"}', true);
  perform pg_temp.ok(not exists (select 1 from public.contas where descricao = 'Energia dezembro'), 'conta excluída');

  -- saldos: só o Sicredi muda, o resto mantém o calculado
  r := public.agente_fazer('atualizar_saldos', '{"contas": [{"nome": "sicredi", "saldo": 1500}]}', true);
  perform pg_temp.ok((select (c->>'saldo')::numeric from public.config, jsonb_array_elements(dados->'contasFinanceiras') c where c->>'nome' = 'Sicredi') = 1500, 'Sicredi 1500');
  perform pg_temp.ok(jsonb_array_length((select dados->'contasFinanceiras' from public.config)) = 3, 'continuam 3 contas');

  -- transferência
  perform pg_temp.erro($c$select public.agente_fazer('transferir', '{"de": "Sicredi", "para": "sicredi", "valor": 10}', true)$c$, 'mesma');
  r := public.agente_fazer('transferir', '{"de": "Sicredi", "para": "Espécie", "valor": 100}', true);
  perform pg_temp.ok((select count(*) from public.transferencias) = 1, 'transferência gravada');
  r := public.agente_fazer('transferir', jsonb_build_object('acao', 'excluir', 'id', (select id from public.transferencias limit 1)), true);
  perform pg_temp.ok((select count(*) from public.transferencias) = 0, 'transferência excluída');
end $$;
select 'ok: financeiro' as cenario;

-- ---------- estoque e produtos ----------
do $$
declare r jsonb;
begin
  r := public.agente_fazer('movimentar_estoque', '{"movimentos": [{"codigo": "100", "tipo": "entrada", "qtd": 5, "custo": 60}, {"codigo": "100", "tipo": "ajuste", "qtd": 12}]}', false);
  perform pg_temp.ok((select estoque_atual from public.produtos where codigo = 100) = 10, 'prévia do estoque não grava');
  r := public.agente_fazer('movimentar_estoque', '{"movimentos": [{"codigo": "100", "tipo": "entrada", "qtd": 5, "custo": 60}, {"codigo": "100", "tipo": "ajuste", "qtd": 12}]}', true);
  perform pg_temp.ok((select estoque_atual = 12 and custo = 60 from public.produtos where codigo = 100), 'entrada e contagem');
  perform pg_temp.erro($c$select public.agente_fazer('movimentar_estoque', '{"movimentos": [{"codigo": "999", "tipo": "saida", "qtd": 1}]}', true)$c$, 'não existe');
  r := public.agente_fazer('produto', '{"acao": "criar", "campos": {"descricao": "Filtro de óleo", "custo": 20, "preco_vista": 40}, "estoque_inicial": 4}', true);
  perform pg_temp.ok((select estoque_atual from public.produtos where descricao = 'Filtro de óleo') = 4, 'produto criado com estoque');
  r := public.agente_fazer('produto', jsonb_build_object('acao', 'editar', 'codigo', (select codigo from public.produtos where descricao = 'Filtro de óleo'), 'campos', '{"preco_vista": 45}'::jsonb), true);
  perform pg_temp.ok((select preco_vista from public.produtos where descricao = 'Filtro de óleo') = 45, 'preço editado');
  perform pg_temp.erro($c$select public.agente_fazer('produto', '{"acao": "editar", "codigo": "100", "campos": {"estoque_atual": 3}}', true)$c$, 'não se muda');
  r := public.agente_fazer('produto', jsonb_build_object('acao', 'inativar', 'codigo', (select codigo from public.produtos where descricao = 'Filtro de óleo')), true);
  perform pg_temp.ok(not (select ativo from public.produtos where descricao = 'Filtro de óleo'), 'inativado');
  r := public.agente_fazer('produto', jsonb_build_object('acao', 'excluir', 'codigo', (select codigo from public.produtos where descricao = 'Filtro de óleo')), true);
  perform pg_temp.ok(not exists (select 1 from public.produtos where descricao = 'Filtro de óleo'), 'excluído');
  perform pg_temp.erro($c$select public.agente_fazer('xyz', '{}', true)$c$, 'desconhecida');
end $$;
select 'ok: estoque' as cenario;
\echo 'OK: v40 (todos os cenários)'
