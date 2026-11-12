-- Cenários do v53 (orçamento aprovado vira O.S.). Roda depois de montar_banco.sh (até v52) + v53. Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.config (id, dados) values (1, '{"garantiaDias": 90, "condicoesPadrao": "Pagamento na retirada."}') on conflict (id) do update set dados = excluded.dados;
insert into public.produtos (id, tipo, descricao, unidade, custo, preco_vista, estoque_atual, controla_estoque, ativo) values
  ('00000000-0000-0000-0000-0000000000a1', 'produto', 'FILTRO DE OLEO', 'UN', 10, 25, 5, true, true),
  ('00000000-0000-0000-0000-0000000000a2', 'produto', 'PASTILHA DIANTEIRA', 'JG', 60, 150, 2, true, true);

-- orçamento por telefone: cliente e carro sem cadastro, 3 itens
select public.orcamento_salvar('{"id": "00000000-0000-0000-0000-00000000c001", "cliente": {"nome": "Maria Souza", "telefone": "(27) 99999-0000"},
  "veiculo": {"placa": "ABC1D23", "marca": "Fiat", "modelo": "Uno", "ano": "2015"}, "reclamacao": "Troca de óleo e barulho no freio", "obs": "Peças originais.",
  "validade": "2099-12-31", "desconto": 10, "situacao": "enviado",
  "itens": [{"id": "00000000-0000-0000-0000-00000000d001", "tipo": "peca", "descricao": "FILTRO DE OLEO", "produto_id": "00000000-0000-0000-0000-0000000000a1", "qtd": 1, "valor_unit": 25, "custo_unit": 10},
            {"id": "00000000-0000-0000-0000-00000000d002", "tipo": "peca", "descricao": "PASTILHA DIANTEIRA", "produto_id": "00000000-0000-0000-0000-0000000000a2", "qtd": 1, "valor_unit": 150, "custo_unit": 60},
            {"id": "00000000-0000-0000-0000-00000000d003", "tipo": "servico", "descricao": "TROCA DE OLEO", "qtd": 1, "valor_unit": 60}]}'::jsonb);
create temp table antes as select (select last_value from public.os_numero_seq) os_seq, (select is_called from public.os_numero_seq) chamada, (select count(*) from public.ordens) ordens;

-- 1. prévia: confere, não grava nada e não gasta número de O.S.
do $$ declare r jsonb; a record; begin
  r := public.orcamento_aprovar('00000000-0000-0000-0000-00000000c001', array['00000000-0000-0000-0000-00000000d002']::uuid[], '', '', false);
  if not (r->>'pode_aprovar')::boolean or (r->>'gravado')::boolean then raise exception 'FALHOU 1: prévia (%)', r; end if;
  if (r->>'itens_aprovados')::int <> 2 or (r->>'itens_nao_aprovados')::int <> 1 or (r->>'total')::numeric <> 75 then raise exception 'FALHOU 1b: conta da prévia (%)', r; end if;
  if not (r->>'cliente_novo')::boolean or not (r->>'veiculo_novo')::boolean then raise exception 'FALHOU 1c: cliente/veículo novos (%)', r; end if;
  select * into a from antes;
  if (select count(*) from public.ordens) <> a.ordens or (select last_value from public.os_numero_seq) <> a.os_seq or (select is_called from public.os_numero_seq) <> a.chamada then raise exception 'FALHOU 1d: a prévia criou O.S. ou gastou número'; end if;
  if (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000a1') <> 5 then raise exception 'FALHOU 1e: a prévia mexeu no estoque'; end if;
  if (select situacao from public.orcamentos where id = '00000000-0000-0000-0000-00000000c001') <> 'enviado' then raise exception 'FALHOU 1f: a prévia mudou o orçamento'; end if;
end $$;

-- 2. aprovação parcial: a pastilha fica de fora. O.S. com o próximo número, já em execução, com vínculo, itens, desconto e observação
do $$ declare r jsonb; os public.ordens; oc public.orcamentos; n int; begin
  r := public.orcamento_aprovar('00000000-0000-0000-0000-00000000c001', array['00000000-0000-0000-0000-00000000d002']::uuid[], 'Maria (por WhatsApp)', 'WhatsApp', true);
  if not (r->>'gravado')::boolean then raise exception 'FALHOU 2: não gravou (%)', r; end if;
  select * into os from public.ordens where id = (r->>'ordem_id')::uuid;
  select * into oc from public.orcamentos where id = '00000000-0000-0000-0000-00000000c001';
  if os.status <> 'execucao' or os.numero <> (r->>'os_numero')::int then raise exception 'FALHOU 2a: O.S. devia nascer em execução (%)', os.status; end if;
  if os.orcamento_id <> oc.id or os.orcamento_numero <> oc.numero or oc.ordem_id <> os.id or oc.os_numero <> os.numero or oc.situacao <> 'aprovado' or oc.respondido_em is null then raise exception 'FALHOU 2b: vínculo dos dois lados'; end if;
  if os.total <> 75 or os.desconto <> 10 or os.custo <> 10 or oc.total <> 75 then raise exception 'FALHOU 2c: valores (% % % %)', os.total, os.desconto, os.custo, oc.total; end if;
  if os.km_entrada is not null or not (os.checkin->>'aguardando_veiculo')::boolean or (os.checkin->>'feito')::boolean then raise exception 'FALHOU 2d: entrada pendente (%)', os.checkin; end if;
  if os.aprovacao->>'por' <> 'Maria (por WhatsApp)' or os.aprovacao->>'forma' <> 'WhatsApp' then raise exception 'FALHOU 2e: aprovação (%)', os.aprovacao; end if;
  if os.obs_execucao not like 'Peças originais.%NÃO aprovados pelo cliente: PASTILHA DIANTEIRA.' then raise exception 'FALHOU 2f: observação da O.S. (%)', os.obs_execucao; end if;
  if os.cliente->>'nome' <> 'Maria Souza' or os.veiculo->>'placa' <> 'ABC1D23' or os.reclamacao <> 'Troca de óleo e barulho no freio' or os.condicoes_pagamento <> 'Pagamento na retirada.' then raise exception 'FALHOU 2g: cópia dos dados'; end if;
  select count(*) into n from public.os_itens where ordem_id = os.id and aprovado is true;
  if n <> 2 or exists (select 1 from public.os_itens where ordem_id = os.id and descricao = 'PASTILHA DIANTEIRA') then raise exception 'FALHOU 2h: itens da O.S.'; end if;
  if (select aprovado from public.orcamento_itens where id = '00000000-0000-0000-0000-00000000d002') is not false or (select count(*) from public.orcamento_itens where orcamento_id = oc.id and aprovado is true) <> 2 then raise exception 'FALHOU 2i: marcação no orçamento'; end if;
  -- cadastro criado na aprovação
  if (select count(*) from public.clientes where nome = 'Maria Souza' and telefone = '27999990000') <> 1 or (select cliente_id from public.veiculos where placa = 'ABC1D23') <> os.cliente_id then raise exception 'FALHOU 2j: cadastro do cliente/veículo'; end if;
  -- estoque: só o item aprovado saiu
  if (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000a1') <> 4 then raise exception 'FALHOU 2k: baixa do item aprovado'; end if;
  if (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000a2') <> 2 then raise exception 'FALHOU 2l: item não aprovado mexeu no estoque'; end if;
  if (select count(*) from public.estoque_reserva where ordem_id = os.id) <> 1 then raise exception 'FALHOU 2m: reserva'; end if;
  if not exists (select 1 from public.eventos where ordem_id = os.id and tipo = 'abertura' and texto like '%ORC-00001%' and texto like '%PASTILHA DIANTEIRA%') then raise exception 'FALHOU 2n: histórico'; end if;
  if (select count(*) from public.recibos) <> 0 or (select count(*) from public.contas) <> 0 then raise exception 'FALHOU 2o: mexeu no financeiro'; end if;
end $$;

-- 3. não aprova duas vezes; aprovado não se altera
do $$ begin
  begin perform public.orcamento_aprovar('00000000-0000-0000-0000-00000000c001', '{}', '', '', true); raise exception 'FALHOU 3: aprovou duas vezes';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; if sqlerrm not like '%já foi aprovado%' then raise exception 'FALHOU 3a: mensagem (%)', sqlerrm; end if; end;
  if (select count(*) from public.ordens where orcamento_id = '00000000-0000-0000-0000-00000000c001') <> 1 then raise exception 'FALHOU 3b: duas O.S. do mesmo orçamento'; end if;
end $$;

-- 4. a O.S. nascida do orçamento segue a vida normal: registrar o KM de chegada pela sincronização
do $$ declare os public.ordens; r jsonb; begin
  select * into os from public.ordens where orcamento_id = '00000000-0000-0000-0000-00000000c001';
  r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'alterar_os', 'ordem_id', os.id, 'status_base', os.status, 'antes', jsonb_build_object('km_entrada', null, 'checkin', os.checkin),
        'patch', jsonb_build_object('km_entrada', 51000, 'checkin', os.checkin - 'aguardando_veiculo')), false);
  if r ? 'conflito' then raise exception 'FALHOU 4: %', r; end if;
  if (select km_entrada from public.ordens where id = os.id) <> 51000 then raise exception 'FALHOU 4b: km'; end if;
end $$;

-- 5. recusas: sem item aprovado, sem telefone, sem placa, recusado, telefone de outro cliente, desconto maior que o aprovado
do $$ declare r jsonb; begin
  perform public.orcamento_salvar('{"id": "00000000-0000-0000-0000-00000000c002", "cliente": {"nome": "João sem telefone"}, "veiculo": {"modelo": "Gol"}, "desconto": 20,
    "itens": [{"id": "00000000-0000-0000-0000-00000000d011", "tipo": "servico", "descricao": "REVISAO", "qtd": 1, "valor_unit": 100},
              {"id": "00000000-0000-0000-0000-00000000d012", "tipo": "servico", "descricao": "LAVAGEM", "qtd": 1, "valor_unit": 15}]}'::jsonb);
  r := public.orcamento_aprovar('00000000-0000-0000-0000-00000000c002', array['00000000-0000-0000-0000-00000000d011']::uuid[], '', '', true);
  if (r->>'gravado')::boolean or (r->>'pode_aprovar')::boolean then raise exception 'FALHOU 5: aprovou com erros (%)', r; end if;
  if r->>'erros' not like '%telefone com DDD%' or r->>'erros' not like '%placa%' or r->>'erros' not like '%desconto%' then raise exception 'FALHOU 5a: erros esperados (%)', r->'erros'; end if;
  r := public.orcamento_aprovar('00000000-0000-0000-0000-00000000c002', array['00000000-0000-0000-0000-00000000d011', '00000000-0000-0000-0000-00000000d012']::uuid[], '', '', true);
  if r->>'erros' not like '%Nenhum item aprovado%' then raise exception 'FALHOU 5b: sem item (%)', r->'erros'; end if;
  if (select count(*) from public.ordens where orcamento_id = '00000000-0000-0000-0000-00000000c002') <> 0 or (select situacao from public.orcamentos where id = '00000000-0000-0000-0000-00000000c002') <> 'elaboracao' then raise exception 'FALHOU 5c: erro deixou rastro'; end if;
  begin perform public.orcamento_aprovar('00000000-0000-0000-0000-00000000c002', array['00000000-0000-0000-0000-00000000d001']::uuid[], '', '', false); raise exception 'FALHOU 5d: item de outro orçamento';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  -- telefone que já é de outro cliente (nome diferente): pede para escolher o cadastro
  perform public.orcamento_salvar('{"id": "00000000-0000-0000-0000-00000000c003", "cliente": {"nome": "Outra Pessoa", "telefone": "27999990000"}, "veiculo": {"placa": "XYZ9A88", "marca": "VW", "modelo": "Gol"},
    "itens": [{"tipo": "servico", "descricao": "REVISAO", "qtd": 1, "valor_unit": 100}]}'::jsonb);
  r := public.orcamento_aprovar('00000000-0000-0000-0000-00000000c003', '{}', '', '', true);
  if r->>'erros' not like '%já é de Maria Souza%' then raise exception 'FALHOU 5e: telefone duplicado (%)', r; end if;
  perform public.orcamento_salvar('{"id": "00000000-0000-0000-0000-00000000c003", "cliente": {"nome": "Outra Pessoa", "telefone": "27999990000"}, "situacao": "recusado", "motivo": "Achou caro",
    "itens": [{"tipo": "servico", "descricao": "REVISAO", "qtd": 1, "valor_unit": 100}]}'::jsonb);
  begin perform public.orcamento_aprovar('00000000-0000-0000-0000-00000000c003', '{}', '', '', true); raise exception 'FALHOU 5f: aprovou recusado';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; if sqlerrm not like '%recusado%' then raise exception 'FALHOU 5g: (%)', sqlerrm; end if; end;
end $$;

-- 6. cliente e veículo do cadastro, tudo aprovado: usa os cadastros, não duplica, e avisa da O.S. em andamento do mesmo carro
do $$ declare r jsonb; c uuid; v uuid; begin
  select id into c from public.clientes where nome = 'Maria Souza'; select id into v from public.veiculos where placa = 'ABC1D23';
  perform public.orcamento_salvar(jsonb_build_object('id', '00000000-0000-0000-0000-00000000c004', 'cliente_id', c, 'veiculo_id', v, 'cliente', jsonb_build_object('nome', 'Maria Souza', 'telefone', '27999990000'),
    'veiculo', jsonb_build_object('placa', 'ABC1D23'), 'itens', '[{"tipo": "peca", "descricao": "PASTILHA DIANTEIRA", "produto_id": "00000000-0000-0000-0000-0000000000a2", "qtd": 2, "valor_unit": 150, "custo_unit": 60}]'::jsonb));
  r := public.orcamento_aprovar('00000000-0000-0000-0000-00000000c004', null, '', '', true);
  if not (r->>'gravado')::boolean or (r->>'cliente_novo')::boolean or (r->>'veiculo_novo')::boolean then raise exception 'FALHOU 6: (%)', r; end if;
  if r->>'avisos' not like '%em andamento%' then raise exception 'FALHOU 6a: aviso da O.S. em andamento (%)', r->'avisos'; end if;
  if (select count(*) from public.clientes where nome = 'Maria Souza') <> 1 or (select count(*) from public.veiculos where placa = 'ABC1D23') <> 1 then raise exception 'FALHOU 6b: cadastro duplicado'; end if;
  if (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000a2') <> 0 then raise exception 'FALHOU 6c: baixa de 2 pastilhas'; end if;
  if (select obs_execucao from public.ordens where id = (r->>'ordem_id')::uuid) <> '' then raise exception 'FALHOU 6d: observação sem item recusado devia ficar vazia'; end if;
  if (select numero from public.ordens where id = (r->>'ordem_id')::uuid) <> (select max(numero) from public.ordens) then raise exception 'FALHOU 6e: próximo número'; end if;
end $$;

select 'v53 OK' as resultado;
