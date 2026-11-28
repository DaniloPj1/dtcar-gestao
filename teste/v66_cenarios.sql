-- Cenários do v66 (mecânico inicia o serviço pela placa, sem O.S.). Roda depois de montar_banco.sh (até v65) + v66.
-- O que precisa valer: o mecânico grava o apontamento só com a placa, sem O.S.; não abre dois do mesmo carro ao mesmo tempo;
-- quando a O.S. da placa é aberta (por qualquer caminho), o apontamento se liga sozinho; O.S. recusada não pega; outra placa
-- não pega; avulso velho (mais de 30 dias) não pega; apagar a O.S. solta o avulso em vez de apagá-lo; nada mexe em O.S.,
-- estoque ou financeiro; e os apontamentos de antes continuam como estavam.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test', '{"nome": "Zé"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;
insert into public.clientes (id, nome) values ('00000000-0000-0000-0000-0000000006c1', 'Transportadora X') on conflict (id) do nothing;
insert into public.veiculos (id, cliente_id, placa, marca, modelo) values ('00000000-0000-0000-0000-0000000006f1', '00000000-0000-0000-0000-0000000006c1', 'QWE4R56', 'VW', 'Delivery') on conflict (id) do nothing;
delete from public.servico_apontamentos where avulso or ordem_id in ('00000000-0000-0000-0000-000000006601', '00000000-0000-0000-0000-000000006602', '00000000-0000-0000-0000-000000006603');
delete from public.ordens where id in ('00000000-0000-0000-0000-000000006601', '00000000-0000-0000-0000-000000006602', '00000000-0000-0000-0000-000000006603');

create temp table antes as select (select count(*) from public.estoque_mov) mov, (select count(*) from public.contas) contas,
  (select count(*) from public.recibos) recibos, (select count(*) from public.os_itens) itens;
grant select on antes to authenticated;

-- o mecânico grava pelo app (com o login dele)
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
set role authenticated;

-- 1. começa só com a placa (escrita de qualquer jeito), sem O.S.
do $$ declare a public.servico_apontamentos; begin
  insert into public.servico_apontamentos (perfil_id, perfil_nome, placa, veiculo_id, avulso)
    values ('88888888-8888-8888-8888-888888888888', 'Zé', 'qwe-4r56', '00000000-0000-0000-0000-0000000006f1', true) returning * into a;
  if a.ordem_id is not null or a.situacao <> 'andamento' then raise exception 'FALHOU 1: %', row_to_json(a); end if;
end $$;

-- 2. não abre o mesmo carro duas vezes enquanto não finaliza
do $$ begin
  begin
    insert into public.servico_apontamentos (perfil_id, perfil_nome, placa, avulso) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'QWE4R56', true);
    raise exception 'FALHOU 2: abriu o mesmo carro duas vezes';
  exception when unique_violation then null; end;
end $$;

-- 3. sem O.S. e sem placa não grava
do $$ begin
  begin
    insert into public.servico_apontamentos (perfil_id, perfil_nome, placa, avulso) values ('88888888-8888-8888-8888-888888888888', 'Zé', ' - ', true);
    raise exception 'FALHOU 3: gravou sem O.S. e sem placa';
  exception when check_violation then null; end;
end $$;

-- 4. finaliza escrevendo o que fez
update public.servico_apontamentos set situacao = 'finalizado', fim = now(), feito_texto = 'Troca da embreagem (peça da empresa)'
 where avulso and placa_limpa(placa) = 'QWE4R56';

reset role;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

-- avulso velho (40 dias) e avulso de outra placa: não podem ser pegos
insert into public.servico_apontamentos (perfil_id, perfil_nome, placa, avulso, situacao, inicio, fim)
values ('88888888-8888-8888-8888-888888888888', 'Zé', 'QWE4R56', true, 'finalizado', now() - interval '40 days', now() - interval '40 days'),
       ('88888888-8888-8888-8888-888888888888', 'Zé', 'ZZZ9Z99', true, 'finalizado', now() - interval '1 day', now() - interval '1 day');

-- 5. O.S. recusada da placa não pega o avulso
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, total)
values ('00000000-0000-0000-0000-000000006603', 6603, 'recusado', '00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006f1', '{"nome": "Transportadora X"}', '{"placa": "QWE4R56"}', 1000, 0);
do $$ begin
  if exists (select 1 from public.servico_apontamentos where ordem_id = '00000000-0000-0000-0000-000000006603') then raise exception 'FALHOU 5: ligou em O.S. recusada'; end if;
end $$;

-- 6. a O.S. da placa é aberta (placa escrita com traço na cópia do veículo): o avulso recente se liga sozinho
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, total)
values ('00000000-0000-0000-0000-000000006601', 6601, 'diagnostico', '00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006f1', '{"nome": "Transportadora X"}', '{"placa": "QWE-4R56"}', 1000, 0);
do $$ declare n int; o int; v int; z int; begin
  select count(*) into n from public.servico_apontamentos where ordem_id = '00000000-0000-0000-0000-000000006601' and os_numero = 6601 and ligado_em is not null and feito_texto like 'Troca da embreagem%';
  select count(*) into o from public.servico_apontamentos where avulso and ordem_id is null and inicio < now() - interval '30 days';
  select count(*) into z from public.servico_apontamentos where avulso and ordem_id is null and placa = 'ZZZ9Z99';
  if n <> 1 then raise exception 'FALHOU 6: não ligou (%).', n; end if;
  if o <> 1 then raise exception 'FALHOU 6b: ligou avulso de mais de 30 dias'; end if;
  if z <> 1 then raise exception 'FALHOU 6c: ligou avulso de outra placa'; end if;
end $$;

-- 7. apagar a O.S. (espelho zerado na transição) solta o avulso em vez de apagá-lo; abrindo de novo, liga de novo
delete from public.ordens where id = '00000000-0000-0000-0000-000000006601';
do $$ begin
  if not exists (select 1 from public.servico_apontamentos where avulso and ordem_id is null and feito_texto like 'Troca da embreagem%') then raise exception 'FALHOU 7: o avulso sumiu com a O.S.'; end if;
end $$;
-- O.S. sem a placa na cópia, só com o veículo: liga pelo cadastro do veículo
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, total)
values ('00000000-0000-0000-0000-000000006602', 6602, 'diagnostico', '00000000-0000-0000-0000-0000000006c1', '00000000-0000-0000-0000-0000000006f1', '{"nome": "Transportadora X"}', '{}', 1000, 0);
do $$ begin
  if not exists (select 1 from public.servico_apontamentos where ordem_id = '00000000-0000-0000-0000-000000006602' and feito_texto like 'Troca da embreagem%') then raise exception 'FALHOU 7b: não ligou de novo'; end if;
end $$;

-- 8. depois de ligado, a comissão o vê como um apontamento normal: o item lançado na O.S. e marcado entra na quinzena
insert into public.funcionarios (id, nome, funcao, perfil_id) values ('00000000-0000-0000-0000-0000000006e1', 'Zé Mecânico', 'Mecânico', '88888888-8888-8888-8888-888888888888') on conflict (id) do nothing;
do $$ declare it uuid; r jsonb; begin
  insert into public.os_itens (ordem_id, tipo, descricao, qtd, valor_unit, posicao) values ('00000000-0000-0000-0000-000000006602', 'servico', 'EMBREAGEM - MÃO DE OBRA', 1, 300, 1) returning id into it;
  update public.servico_apontamentos set itens_executados = array[it] where ordem_id = '00000000-0000-0000-0000-000000006602' and avulso;
  if not exists (select 1 from public.servico_apontamentos where ordem_id = '00000000-0000-0000-0000-000000006602' and it = any (itens_executados)) then raise exception 'FALHOU 8'; end if;
  delete from public.os_itens where id = it;
end $$;

-- 9. nada mexeu em estoque nem financeiro
do $$ declare a record; begin select * into a from antes;
  if (select count(*) from public.estoque_mov) <> a.mov or (select count(*) from public.contas) <> a.contas or (select count(*) from public.recibos) <> a.recibos then raise exception 'FALHOU 9: mexeu em estoque/financeiro'; end if;
end $$;

-- limpeza
delete from public.servico_apontamentos where avulso;
delete from public.ordens where id in ('00000000-0000-0000-0000-000000006602', '00000000-0000-0000-0000-000000006603');
delete from public.funcionarios where id = '00000000-0000-0000-0000-0000000006e1';
select 'v66 OK' as resultado;
