-- Cenários do v52 (orçamento separado da O.S., etapa 1). Roda depois de montar_banco.sh (até v51) + v52. Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test', '{"nome": "Zé"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;
insert into public.config (id, dados) values (1, '{}') on conflict (id) do nothing;

create temp table antes as select (select count(*) from public.ordens) ordens, (select last_value from public.os_numero_seq) os_seq,
  (select count(*) from public.estoque_mov) mov, (select count(*) from public.estoque_reserva) reserva, (select count(*) from public.contas) contas, (select count(*) from public.recibos) recibos;
insert into public.produtos (id, tipo, descricao, unidade, custo, preco_vista, estoque_atual, controla_estoque, ativo)
  values ('00000000-0000-0000-0000-0000000000a1', 'produto', 'FILTRO DE OLEO', 'UN', 10, 25, 3, true, true);

-- 1. novo orçamento sem cadastro de cliente nem carro na oficina: número próprio, total e custo calculados, nada em O.S./estoque/financeiro
do $$ declare r jsonb; r2 jsonb; begin
  r := public.orcamento_salvar('{"cliente": {"nome": "Maria por telefone", "telefone": "27999990000"}, "veiculo": {"placa": "ABC1D23", "modelo": "Uno"},
    "reclamacao": "Quer preço de troca de óleo", "validade": "2026-11-21", "desconto": 5,
    "itens": [{"tipo": "peca", "descricao": "FILTRO DE OLEO", "produto_id": "00000000-0000-0000-0000-0000000000a1", "qtd": 1, "valor_unit": 25, "custo_unit": 10},
              {"tipo": "peca", "descricao": "OLEO 5W30", "qtd": 4, "valor_unit": 40, "custo_unit": 24.5, "desconto": 10},
              {"tipo": "servico", "descricao": "TROCA DE OLEO", "qtd": 1, "valor_unit": 60}]}'::jsonb);
  if (r->>'numero')::int <> 1 then raise exception 'FALHOU 1: número do orçamento devia ser 1 (%)', r->>'numero'; end if;
  if (r->>'total')::numeric <> 230 then raise exception 'FALHOU 1b: total devia ser 25 + 150 + 60 - 5 = 230 (%)', r->>'total'; end if;
  if (r->>'custo')::numeric <> 108 then raise exception 'FALHOU 1c: custo devia ser 10 + 98 = 108 (%)', r->>'custo'; end if;
  if r->>'situacao' <> 'elaboracao' or r->>'consultor_nome' <> 'Danilo' then raise exception 'FALHOU 1d: situação/consultor (%)', r; end if;
  if jsonb_array_length(r->'itens') <> 3 or (r->'itens'->2->>'posicao')::int <> 3 then raise exception 'FALHOU 1e: itens'; end if;
  r2 := public.orcamento_salvar('{"cliente": {"nome": "João"}, "itens": []}'::jsonb);
  if (r2->>'numero')::int <> 2 then raise exception 'FALHOU 1f: segundo número (%)', r2->>'numero'; end if;
end $$;
do $$ declare a record; begin
  select * into a from antes;
  if (select count(*) from public.ordens) <> a.ordens or (select last_value from public.os_numero_seq) <> a.os_seq then raise exception 'FALHOU 2: orçamento gastou número ou criou O.S.'; end if;
  if (select count(*) from public.estoque_mov) <> a.mov or (select count(*) from public.estoque_reserva) <> a.reserva then raise exception 'FALHOU 2b: orçamento mexeu no estoque'; end if;
  if (select estoque_atual from public.produtos where id = '00000000-0000-0000-0000-0000000000a1') <> 3 then raise exception 'FALHOU 2c: saldo do produto mudou'; end if;
  if (select count(*) from public.contas) <> a.contas or (select count(*) from public.recibos) <> a.recibos then raise exception 'FALHOU 2d: orçamento mexeu no financeiro'; end if;
end $$;

-- 3. editar: troca item, remove outro, recusa um item (sai do total), envia (grava enviado_em uma vez)
do $$ declare o jsonb; r jsonb; ids uuid[]; env timestamptz; begin
  select to_jsonb(x) into o from public.orcamentos x where numero = 1;
  select array_agg(id order by posicao) into ids from public.orcamento_itens where orcamento_id = (o->>'id')::uuid;
  r := public.orcamento_salvar(jsonb_build_object('id', o->>'id', 'cliente', o->'cliente', 'veiculo', o->'veiculo', 'validade', '2026-11-21', 'situacao', 'enviado', 'desconto', 0,
    'itens', jsonb_build_array(
      jsonb_build_object('id', ids[1], 'tipo', 'peca', 'descricao', 'FILTRO DE OLEO', 'qtd', 2, 'valor_unit', 25, 'custo_unit', 10),
      jsonb_build_object('id', ids[3], 'tipo', 'servico', 'descricao', 'TROCA DE OLEO', 'qtd', 1, 'valor_unit', 60, 'aprovado', false),
      jsonb_build_object('tipo', 'terceiro', 'descricao', 'ALINHAMENTO FORA', 'qtd', 1, 'valor_unit', 100, 'custo_unit', 70))));
  if (r->>'total')::numeric <> 150 or (r->>'custo')::numeric <> 90 then raise exception 'FALHOU 3: total 150 e custo 90 esperados (% / %)', r->>'total', r->>'custo'; end if;
  if jsonb_array_length(r->'itens') <> 3 or exists (select 1 from public.orcamento_itens where id = ids[2]) then raise exception 'FALHOU 3b: item removido continua'; end if;
  if r->>'situacao' <> 'enviado' or r->>'enviado_em' is null then raise exception 'FALHOU 3c: enviado'; end if;
  env := (r->>'enviado_em')::timestamptz;
  r := public.orcamento_salvar(jsonb_build_object('id', o->>'id', 'cliente', o->'cliente', 'situacao', 'enviado', 'itens', r->'itens'));
  if (r->>'enviado_em')::timestamptz <> env then raise exception 'FALHOU 3d: enviado_em mudou ao salvar de novo'; end if;
end $$;

-- 4. recusa exige motivo; recusado continua consultável; reabrir limpa o motivo
do $$ declare o public.orcamentos; r jsonb; begin
  select * into o from public.orcamentos where numero = 1;
  begin perform public.orcamento_salvar(jsonb_build_object('id', o.id, 'cliente', o.cliente, 'situacao', 'recusado', 'itens', '[]'::jsonb)); raise exception 'FALHOU 4: recusou sem motivo';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; if sqlerrm not like '%motivo%' then raise exception 'FALHOU 4a: mensagem (%)', sqlerrm; end if; end;
  if (select count(*) from public.orcamento_itens where orcamento_id = o.id) <> 3 then raise exception 'FALHOU 4b: a recusa que deu erro apagou itens'; end if;
  r := public.orcamento_salvar(jsonb_build_object('id', o.id, 'cliente', o.cliente, 'situacao', 'recusado', 'motivo', 'Achou caro',
        'itens', (select jsonb_agg(to_jsonb(i)) from public.orcamento_itens i where i.orcamento_id = o.id)));
  if r->>'situacao' <> 'recusado' or r->>'motivo' <> 'Achou caro' or r->>'respondido_em' is null then raise exception 'FALHOU 4c: recusado (%)', r; end if;
  r := public.orcamento_salvar(jsonb_build_object('id', o.id, 'cliente', o.cliente, 'situacao', 'elaboracao', 'itens', r->'itens'));
  if r->>'situacao' <> 'elaboracao' or r->>'motivo' <> '' or r->>'respondido_em' is not null then raise exception 'FALHOU 4d: reabrir (%)', r; end if;
end $$;

-- 5. validações: sem cliente, quantidade zero, desconto maior que os itens, "aprovado" só pela etapa 2, aprovado não se altera
do $$ declare o public.orcamentos; begin
  begin perform public.orcamento_salvar('{"cliente": {"nome": " "}, "itens": []}'::jsonb); raise exception 'FALHOU 5: sem cliente';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.orcamento_salvar('{"cliente": {"nome": "X"}, "itens": [{"tipo": "peca", "descricao": "A", "qtd": 0, "valor_unit": 1}]}'::jsonb); raise exception 'FALHOU 5b: qtd zero';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.orcamento_salvar('{"cliente": {"nome": "X"}, "desconto": 50, "itens": [{"tipo": "peca", "descricao": "A", "qtd": 1, "valor_unit": 10}]}'::jsonb); raise exception 'FALHOU 5c: desconto maior';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  begin perform public.orcamento_salvar('{"cliente": {"nome": "X"}, "situacao": "aprovado", "itens": []}'::jsonb); raise exception 'FALHOU 5d: aprovado pela gravação';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
  select * into o from public.orcamentos where numero = 2;
  update public.orcamentos set situacao = 'aprovado' where id = o.id;
  begin perform public.orcamento_salvar(jsonb_build_object('id', o.id, 'cliente', o.cliente, 'itens', '[]'::jsonb)); raise exception 'FALHOU 5e: alterou orçamento aprovado';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; if sqlerrm not like '%já virou O.S.%' then raise exception 'FALHOU 5f: mensagem (%)', sqlerrm; end if; end;
  if (select count(*) from public.orcamentos) <> 2 then raise exception 'FALHOU 5g: gravação recusada deixou orçamento (%)', (select count(*) from public.orcamentos); end if;
end $$;

-- 6. mecânico lê e não grava (função e regra de acesso da tabela)
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ begin
  begin perform public.orcamento_salvar('{"cliente": {"nome": "X"}, "itens": []}'::jsonb); raise exception 'FALHOU 6: mecânico gravou';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.orcamentos; if n <> 2 then raise exception 'FALHOU 6b: mecânico devia ler os 2 (%)', n; end if;
  update public.orcamentos set obs = 'x'; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU 6c: mecânico alterou % linha(s)', n; end if;
  delete from public.orcamento_itens; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU 6d: mecânico apagou itens'; end if;
end $$;
reset role;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

-- 7. exclusão avisa o banco do PC; restauração de backup aceita as tabelas e a sequência não repete número
do $$ declare o public.orcamentos; b jsonb; bi jsonb; r jsonb; begin
  select * into o from public.orcamentos where numero = 1;
  select jsonb_agg(to_jsonb(x)) into b from public.orcamentos x where id = o.id;
  select jsonb_agg(to_jsonb(x)) into bi from public.orcamento_itens x where orcamento_id = o.id;
  delete from public.orcamentos where id = o.id;
  if not exists (select 1 from public.exclusoes where tabela = 'orcamentos' and registro = o.id::text) then raise exception 'FALHOU 7: exclusão não registrada'; end if;
  if (select count(*) from public.exclusoes e where e.tabela = 'orcamento_itens' and e.registro in (select x->>'id' from jsonb_array_elements(bi) x)) <> 3 then raise exception 'FALHOU 7b: exclusão dos itens'; end if;
  b := jsonb_set(b, '{0,numero}', '40');
  perform public.restaurar_tabela('orcamentos', b); perform public.restaurar_tabela('orcamento_itens', bi);
  if (select numero from public.orcamentos where id = o.id) <> 40 or (select count(*) from public.orcamento_itens where orcamento_id = o.id) <> 3 then raise exception 'FALHOU 7c: restauração'; end if;
  r := public.orcamento_salvar('{"cliente": {"nome": "Depois do backup"}, "itens": []}'::jsonb);
  if (r->>'numero')::int <> 41 then raise exception 'FALHOU 7d: número depois da restauração devia ser 41 (%)', r->>'numero'; end if;
end $$;

-- 8. papel de leitura do agente: lê o orçamento sem a cópia do cliente (telefone)
do $$ begin
  if has_column_privilege('agente_leitura', 'public.orcamentos', 'cliente', 'select') then raise exception 'FALHOU 8: agente_leitura lê a cópia do cliente'; end if;
  if not has_column_privilege('agente_leitura', 'public.orcamentos', 'total', 'select') or not has_table_privilege('agente_leitura', 'public.orcamento_itens', 'select') then raise exception 'FALHOU 8b: agente_leitura sem leitura'; end if;
end $$;

select 'v52 OK' as resultado;
