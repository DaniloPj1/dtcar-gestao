-- Cenários do v61 (comissão por quinzena). Roda depois de montar_banco.sh (até v60) + v61. Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test', '{"nome": "Zé"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('66666666-6666-6666-6666-666666666666', 'outro@oficina.test', '{"nome": "Beto"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;
insert into public.perfis (id, nome, papel, ativo) values ('66666666-6666-6666-6666-666666666666', 'Beto', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;

insert into public.funcionarios (id, nome, apelido, perfil_id, comissao_pct, salario, horas_mes)
values ('00000000-0000-0000-0000-0000000000e1', 'JOSE DA SILVA', 'Zé', '88888888-8888-8888-8888-888888888888', 40, 2000, 220),
       ('00000000-0000-0000-0000-0000000000e2', 'ROBERTO LIMA', 'Beto', '66666666-6666-6666-6666-666666666666', 30, 2000, 220)
on conflict (id) do update set comissao_pct = excluded.comissao_pct, perfil_id = excluded.perfil_id;

insert into public.clientes (id, nome) values ('00000000-0000-0000-0000-0000000000c9', 'Ana Souza') on conflict (id) do nothing;
insert into public.veiculos (id, cliente_id, placa, marca, modelo) values ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000c9', 'ABC1D23', 'Fiat', 'Uno') on conflict (id) do nothing;
-- serviços do catálogo, para o GRUPO vir de produtos.categoria
insert into public.produtos (id, codigo, descricao, tipo, categoria, preco_vista)
values ('00000000-0000-0000-0000-0000000000d1', 9001, 'TROCA DE OLEO', 'servico', 'MECANICA', 120),
       ('00000000-0000-0000-0000-0000000000d2', 9002, 'REVISAO DE FREIOS', 'servico', 'FREIOS', 300)
on conflict (id) do update set categoria = excluded.categoria;

-- O.S. 701 em execução e O.S. 702 JÁ ENTREGUE E PAGA (a comissão vira custo nela também: decisão do Danilo)
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, total)
values ('00000000-0000-0000-0000-000000000701', 701, 'execucao', '00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000f9', '{"nome": "Ana Souza"}', '{"placa": "ABC1D23"}', 1000, 0),
       ('00000000-0000-0000-0000-000000000702', 702, 'entregue', '00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000f9', '{"nome": "Ana Souza"}', '{"placa": "ABC1D23"}', 2000, 0)
on conflict (id) do nothing;

-- pode rodar de novo no mesmo banco
delete from public.comissoes where funcionario_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
delete from public.funcionario_lanc where funcionario_id in ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000e2');
delete from public.servico_apontamentos where ordem_id in ('00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000702');
delete from public.os_itens where ordem_id in ('00000000-0000-0000-0000-000000000701', '00000000-0000-0000-0000-000000000702');
update public.config set dados = dados - 'comissao' where id = 1;

-- itens: dois serviços e uma peça na 701; um serviço na 702 (entregue)
insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit, custo_unit, desconto, produto_id, aprovado)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000701', 'servico', 'TROCA DE OLEO', 1, 120, 0, 0, '00000000-0000-0000-0000-0000000000d1', true),
       ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-000000000701', 'servico', 'REVISAO DE FREIOS', 1, 300, 0, 0, '00000000-0000-0000-0000-0000000000d2', true),
       ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-000000000701', 'peca', 'FILTRO DE OLEO', 1, 50, 20, 0, null, true),
       ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-000000000702', 'servico', 'TROCA DE OLEO', 2, 100, 0, 20, '00000000-0000-0000-0000-0000000000d1', true);

-- apontamentos finalizados: Zé fez o óleo da 701 (sozinho) e o freio da 701 DIVIDIDO com o Beto; o óleo da 702 é do Zé, fora da quinzena
insert into public.servico_apontamentos (id, ordem_id, os_numero, perfil_id, perfil_nome, situacao, inicio, fim, itens_executados)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-000000000701', 701, '88888888-8888-8888-8888-888888888888', 'Zé', 'finalizado', '2026-11-05 09:00-03', '2026-11-05 11:00-03',
        array['00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2']::uuid[]),
       ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000701', 701, '66666666-6666-6666-6666-666666666666', 'Beto', 'finalizado', '2026-11-06 09:00-03', '2026-11-06 10:00-03',
        array['00000000-0000-0000-0000-0000000000a2']::uuid[]),
       ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-000000000702', 702, '88888888-8888-8888-8888-888888888888', 'Zé', 'finalizado', '2026-10-20 09:00-03', '2026-10-20 10:00-03',
        array['00000000-0000-0000-0000-0000000000a4']::uuid[]);

create temp table antes61 as select (select count(*) from public.ordens) ordens, (select count(*) from public.estoque_mov) mov,
  (select count(*) from public.contas) contas, (select count(*) from public.recibos) recibos, (select count(*) from public.receber) receber;

-- 1. matriz: ficha → padrão do mecânico → exceção por grupo
do $$ begin
  if public.comissao_pct('00000000-0000-0000-0000-0000000000e1', 'MECANICA', 40) <> 40 then raise exception 'FALHOU 1a: sem matriz, vale a ficha'; end if;
  update public.config set dados = jsonb_set(dados, '{comissao}', '{"padrao": {"00000000-0000-0000-0000-0000000000e1": 45}}'::jsonb) where id = 1;
  if public.comissao_pct('00000000-0000-0000-0000-0000000000e1', 'MECANICA', 40) <> 45 then raise exception 'FALHOU 1b: padrão do mecânico não venceu a ficha'; end if;
  update public.config set dados = jsonb_set(dados, '{comissao,matriz}', '{"00000000-0000-0000-0000-0000000000e1": {"freios": 60}}'::jsonb) where id = 1;
  if public.comissao_pct('00000000-0000-0000-0000-0000000000e1', 'FREIOS', 40) <> 60 then raise exception 'FALHOU 1c: exceção do grupo não venceu o padrão'; end if;
  if public.comissao_pct('00000000-0000-0000-0000-0000000000e1', 'MECANICA', 40) <> 45 then raise exception 'FALHOU 1d: a exceção vazou para outro grupo'; end if;
  if public.comissao_pct('00000000-0000-0000-0000-0000000000e2', '', null) <> 0 then raise exception 'FALHOU 1e: sem nada, zero'; end if;
end $$;

-- 2. a quinzena 1 a 15/11: Zé tem o óleo inteiro (45% de 120 = 54) e metade do freio (60% de 150 = 90); a peça não entra
do $$ declare q jsonb; z jsonb; it jsonb; begin
  q := public.comissao_quinzena('2026-11-01', '2026-11-15');
  z := (select x from jsonb_array_elements(q) x where x->>'funcionario_id' = '00000000-0000-0000-0000-0000000000e1');
  if z is null then raise exception 'FALHOU 2a: o Zé não apareceu na quinzena: %', q; end if;
  if (z->>'servicos')::int <> 2 then raise exception 'FALHOU 2b: serviços do Zé: %', z; end if;
  if (z->>'total')::numeric <> 144 then raise exception 'FALHOU 2c: total do Zé deveria ser 144 (54 + 90): %', z; end if;
  it := (select x from jsonb_array_elements(z->'itens') x where x->>'item_id' = '00000000-0000-0000-0000-0000000000a2');
  if (it->>'fracao')::numeric <> 0.5 or (it->>'base')::numeric <> 150 or (it->>'pct')::numeric <> 60 then raise exception 'FALHOU 2d: freio dividido ao meio: %', it; end if;
  if it->>'dividido_com' <> 'Beto' then raise exception 'FALHOU 2e: dividido com: %', it; end if;
  if (z->'itens') @> '[{"descricao": "FILTRO DE OLEO"}]'::jsonb then raise exception 'FALHOU 2f: peça entrou na comissão'; end if;
  if (z->'itens') @> '[{"os_numero": 702}]'::jsonb then raise exception 'FALHOU 2g: serviço de outra quinzena entrou'; end if;
  -- Beto: metade do freio a 30% da ficha (sem matriz) = 45
  if (select (x->>'total')::numeric from jsonb_array_elements(q) x where x->>'funcionario_id' = '00000000-0000-0000-0000-0000000000e2') <> 45
    then raise exception 'FALHOU 2h: total do Beto deveria ser 45: %', q; end if;
  -- "Puxar O.S.": o serviço da 702, de fora da quinzena, entra quando o Danilo pede
  q := public.comissao_quinzena('2026-11-01', '2026-11-15', '00000000-0000-0000-0000-0000000000e1', array['00000000-0000-0000-0000-0000000000a4']::uuid[]);
  if not ((q->0->'itens') @> '[{"os_numero": 702}]'::jsonb) then raise exception 'FALHOU 2i: puxar O.S. não trouxe o serviço: %', q; end if;
  -- a mão de obra da 702 é 2 x 100 - 20 = 180, com 45% = 81
  if (select (x->>'valor')::numeric from jsonb_array_elements(q->0->'itens') x where x->>'os_numero' = '702') <> 81
    then raise exception 'FALHOU 2j: desconto do item não entrou na mão de obra: %', q; end if;
end $$;

-- 3. lançar a quinzena do Zé: grava comissão, custo nos itens da O.S. e lançamento na folha
do $$ declare r jsonb; c public.comissoes; begin
  r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e1', 'inicio', '2026-11-01', 'fim', '2026-11-15',
    'usuario_nome', 'Danilo', 'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a1'),
                                                         jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a2'))));
  if (r->>'total')::numeric <> 144 or (r->>'servicos')::int <> 2 then raise exception 'FALHOU 3a: lançamento: %', r; end if;
  select * into c from public.comissoes where id = (r->>'id')::uuid;
  if c.situacao <> 'lancado' or c.competencia <> '2026-11-01' or c.mao_de_obra <> 270 then raise exception 'FALHOU 3b: %', to_jsonb(c); end if;
  -- custo nos itens: 54 no óleo, 90 na metade do freio que é dele
  if (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a1') <> 54 then raise exception 'FALHOU 3c: custo do óleo'; end if;
  if (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a2') <> 90 then raise exception 'FALHOU 3d: custo do freio'; end if;
  -- lançamento da folha
  if (select valor from public.funcionario_lanc where id = c.lanc_id) <> 144
     or (select tipo from public.funcionario_lanc where id = c.lanc_id) <> 'comissao'
     or (select competencia from public.funcionario_lanc where id = c.lanc_id) <> '2026-11-01'
    then raise exception 'FALHOU 3e: folha: %', (select to_jsonb(l) from public.funcionario_lanc l where l.id = c.lanc_id); end if;
  -- os serviços lançados não voltam a aparecer para lançar
  if (select (x->>'servicos')::int from jsonb_array_elements(public.comissao_quinzena('2026-11-01', '2026-11-15', '00000000-0000-0000-0000-0000000000e1')) x) <> 0
    then raise exception 'FALHOU 3f: serviço já lançado continuou a contar'; end if;
end $$;

-- 4. a parte do Beto SOMA no custo do mesmo item, não substitui
do $$ declare r jsonb; begin
  r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e2', 'inicio', '2026-11-01', 'fim', '2026-11-15',
    'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a2'))));
  if (r->>'total')::numeric <> 45 then raise exception 'FALHOU 4a: comissão do Beto: %', r; end if;
  if (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a2') <> 135 then
    raise exception 'FALHOU 4b: o custo do freio deveria ser 90 + 45 = 135, está %', (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a2'); end if;
end $$;

-- 5. O.S. JÁ ENTREGUE também recebe o custo (decisão do Danilo), e o percentual digitado vence a matriz
do $$ declare r jsonb; begin
  r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e1', 'inicio', '2026-10-16', 'fim', '2026-10-31',
    'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a4', 'pct', 50))));
  if (r->>'total')::numeric <> 90 then raise exception 'FALHOU 5a: 50%% de 180 = 90, veio %', r; end if;   -- percentual digitado venceu os 45 da matriz
  if (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a4') <> 45 then  -- 90 / qtd 2
    raise exception 'FALHOU 5b: custo por unidade na O.S. entregue: %', (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a4'); end if;
  if (select status from public.ordens where id = '00000000-0000-0000-0000-000000000702') <> 'entregue' then raise exception 'FALHOU 5c: mexeu no status da O.S.'; end if;
end $$;

-- 6. o que não pode: mesma quinzena duas vezes, serviço já lançado, serviço que o mecânico não apontou, peça
do $$ declare r jsonb; begin
  begin r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e1', 'inicio', '2026-11-01', 'fim', '2026-11-15',
      'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a1'))));
    raise exception 'FALHOU 6a: lançou a mesma quinzena duas vezes';
  exception when others then if sqlerrm not like '%já foi lançada%' then raise; end if; end;
  begin r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e1', 'inicio', '2026-12-01', 'fim', '2026-12-15',
      'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a1'))));
    raise exception 'FALHOU 6b: lançou o mesmo serviço duas vezes';
  exception when unique_violation then null; end;
  begin r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e2', 'inicio', '2026-12-01', 'fim', '2026-12-15',
      'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a1'))));
    raise exception 'FALHOU 6c: lançou serviço que o Beto não apontou';
  exception when others then if sqlerrm not like '%não serve para comissão%' then raise; end if; end;
  begin r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e1', 'inicio', '2026-12-01', 'fim', '2026-12-15',
      'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a3'))));
    raise exception 'FALHOU 6d: lançou comissão de peça';
  exception when others then if sqlerrm not like '%não serve para comissão%' then raise; end if; end;
  -- a tentativa que falhou não deixou lançamento pela metade
  if exists (select 1 from public.comissoes where inicio = '2026-12-01') then raise exception 'FALHOU 6e: sobrou comissão de tentativa que falhou'; end if;
end $$;

-- 7. consultor não lança nem cancela
set role authenticated;
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ declare r jsonb; begin
  begin r := public.comissao_lancar('{"funcionario_id": "00000000-0000-0000-0000-0000000000e1", "inicio": "2026-09-01", "fim": "2026-09-15", "itens": [{"item_id": "00000000-0000-0000-0000-0000000000a1"}]}'::jsonb);
    raise exception 'FALHOU 7a: mecânico lançou comissão';
  exception when others then if sqlerrm not like '%administrador%' and sqlerrm not like '%row-level security%' then raise; end if; end;
  begin r := public.comissao_cancelar((select id from public.comissoes limit 1));
    raise exception 'FALHOU 7b: mecânico cancelou comissão';
  exception when others then if sqlerrm not like '%administrador%' and sqlerrm not like '%row-level security%' then raise; end if; end;
end $$;
reset role;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

-- 8. cancelar: tira o custo do item (o que é de outro mecânico fica), apaga o lançamento da folha e libera o serviço
do $$ declare c public.comissoes; v_lanc uuid; r jsonb; begin
  select * into c from public.comissoes where funcionario_id = '00000000-0000-0000-0000-0000000000e1' and inicio = '2026-11-01' and situacao = 'lancado';
  v_lanc := c.lanc_id;
  r := public.comissao_cancelar(c.id, 'erro de digitação');
  if (select situacao from public.comissoes where id = c.id) <> 'cancelado' then raise exception 'FALHOU 8a: não cancelou'; end if;
  if exists (select 1 from public.funcionario_lanc where id = v_lanc) then raise exception 'FALHOU 8b: lançamento da folha ficou'; end if;
  if (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a1') <> 0 then raise exception 'FALHOU 8c: custo do óleo não voltou a zero'; end if;
  if (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a2') <> 45 then
    raise exception 'FALHOU 8d: o freio deveria ficar só com os 45 do Beto, está %', (select custo_unit from public.os_itens where id = '00000000-0000-0000-0000-0000000000a2'); end if;
  if (select (x->>'servicos')::int from jsonb_array_elements(public.comissao_quinzena('2026-11-01', '2026-11-15', '00000000-0000-0000-0000-0000000000e1')) x) <> 2
    then raise exception 'FALHOU 8e: os serviços não voltaram para a quinzena'; end if;
  -- cancelar duas vezes não desfaz nada a mais
  begin r := public.comissao_cancelar(c.id); raise exception 'FALHOU 8f: cancelou duas vezes';
  exception when others then if sqlerrm not like '%já está cancelado%' then raise; end if; end;
  -- depois de cancelar, a quinzena pode ser lançada de novo
  r := public.comissao_lancar(jsonb_build_object('funcionario_id', '00000000-0000-0000-0000-0000000000e1', 'inicio', '2026-11-01', 'fim', '2026-11-15',
    'itens', jsonb_build_array(jsonb_build_object('item_id', '00000000-0000-0000-0000-0000000000a1'))));
  if (r->>'total')::numeric <> 54 then raise exception 'FALHOU 8g: relançamento: %', r; end if;
end $$;

-- 10. o custo GUARDADO na O.S. passa a contar a mão de obra (agente_totais_os + ordens.custo)
do $$ declare t jsonb; begin
  -- 701: óleo 54 (Zé) + freio 45 (Beto) + peça 20 = 119
  t := public.agente_totais_os('00000000-0000-0000-0000-000000000701');
  if (t->>'custo')::numeric <> 119 then raise exception 'FALHOU 10a: custo da 701 deveria ser 119, veio %', t; end if;
  if (select custo from public.ordens where id = '00000000-0000-0000-0000-000000000701') <> 119 then
    raise exception 'FALHOU 10b: ordens.custo da 701 não acompanhou: %', (select custo from public.ordens where id = '00000000-0000-0000-0000-000000000701'); end if;
  -- 702 (entregue): 45 por unidade x 2 = 90, e o total do cliente NÃO muda
  if (select custo from public.ordens where id = '00000000-0000-0000-0000-000000000702') <> 90 then
    raise exception 'FALHOU 10c: ordens.custo da O.S. entregue: %', (select custo from public.ordens where id = '00000000-0000-0000-0000-000000000702'); end if;
  if (public.agente_totais_os('00000000-0000-0000-0000-000000000702')->>'total')::numeric <> 180 then
    raise exception 'FALHOU 10d: a comissão mexeu no total do cliente'; end if;
end $$;

-- 9. comissão não mexe em estoque, contas, recibos, contas a receber nem cria O.S.
do $$ declare a record; begin
  select * into a from antes61;
  if a.ordens <> (select count(*) from public.ordens) or a.mov <> (select count(*) from public.estoque_mov)
     or a.contas <> (select count(*) from public.contas) or a.recibos <> (select count(*) from public.recibos)
     or a.receber <> (select count(*) from public.receber)
    then raise exception 'FALHOU 9: a comissão mexeu em estoque/financeiro'; end if;
end $$;

select 'v61: todos os cenários passaram' as resultado;
