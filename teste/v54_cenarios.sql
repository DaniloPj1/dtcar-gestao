-- Cenários do v54 (agenda da oficina, etapa 1). Roda depois de montar_banco.sh (até v53) + v54. Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test', '{"nome": "Zé"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;

create temp table antes as select (select count(*) from public.ordens) ordens, (select count(*) from public.estoque_mov) mov,
  (select count(*) from public.contas) contas, (select count(*) from public.recibos) recibos;

-- 1. agendar: quem criou vem do perfil, sem remarcação; serviço e cliente obrigatórios; agenda livre (vários no mesmo horário)
do $$ declare a public.agendamentos; begin
  insert into public.agendamentos (id, data, hora, cliente, veiculo, servico)
    values ('00000000-0000-0000-0000-00000000a001', '2026-12-10', '08:00', '{"nome": "Marcos Augusto", "telefone": "27999990000"}', '{"placa": "OZK8H21"}', ' Revisão ')
    returning * into a;
  if a.situacao <> 'agendado' or a.remarcacoes <> 0 or a.criado_por_nome <> 'Danilo' or a.servico <> 'Revisão' then raise exception 'FALHOU 1: %', to_jsonb(a); end if;
  insert into public.agendamentos (data, hora, cliente, servico) values ('2026-12-10', '08:00', '{"nome": "Outro no mesmo horário"}', 'Alinhamento');
  insert into public.agendamentos (data, cliente, servico) values ('2026-12-10', '{"nome": "Sem horário"}', 'Óleo');
  begin insert into public.agendamentos (data, cliente, servico) values ('2026-12-10', '{"nome": "X"}', '  '); raise exception 'FALHOU 1b: aceitou sem serviço';
  exception when check_violation then null; end;
  begin insert into public.agendamentos (data, cliente, servico) values ('2026-12-10', '{"nome": ""}', 'Óleo'); raise exception 'FALHOU 1c: aceitou sem cliente';
  exception when check_violation then null; end;
end $$;

-- 2. confirmar e remarcar: trocar dia/hora conta remarcação, guarda o anterior, volta para "agendado" e esquece a confirmação
do $$ declare a public.agendamentos; begin
  update public.agendamentos set situacao = 'confirmado', mensagens = '{"confirmacao": "2026-12-01T10:00:00Z", "remarcar": "x"}' where id = '00000000-0000-0000-0000-00000000a001' returning * into a;
  if a.situacao <> 'confirmado' or a.remarcacoes <> 0 then raise exception 'FALHOU 2: confirmar contou remarcação'; end if;
  update public.agendamentos set obs = 'cliente pediu pela manhã', remarcacoes = 9 where id = a.id returning * into a;
  if a.remarcacoes <> 0 then raise exception 'FALHOU 2b: a tela conseguiu mudar remarcacoes (%)', a.remarcacoes; end if;
  update public.agendamentos set hora = '14:00' where id = a.id returning * into a;
  if a.remarcacoes <> 1 or a.data_anterior <> '2026-12-10' or a.hora_anterior <> '08:00' or a.situacao <> 'agendado' then raise exception 'FALHOU 2c: %', to_jsonb(a); end if;
  if a.mensagens ? 'confirmacao' or not a.mensagens ? 'remarcar' then raise exception 'FALHOU 2d: mensagens %', a.mensagens; end if;
  update public.agendamentos set data = '2026-12-11', situacao = 'agendado' where id = a.id returning * into a;
  if a.remarcacoes <> 2 or a.data_anterior <> '2026-12-10' or a.hora_anterior <> '14:00' then raise exception 'FALHOU 2e: %', to_jsonb(a); end if;
  update public.agendamentos set criado_por_nome = 'Outro' where id = a.id returning * into a;
  if a.criado_por_nome <> 'Danilo' then raise exception 'FALHOU 2f: quem criou mudou'; end if;
end $$;

-- 3. cancelar exige motivo; voltar a agendar limpa o motivo; chegou guarda a O.S. (a agenda não cria O.S.)
do $$ declare a public.agendamentos; x record; begin
  begin update public.agendamentos set situacao = 'cancelado' where id = '00000000-0000-0000-0000-00000000a001'; raise exception 'FALHOU 3: cancelou sem motivo';
  exception when check_violation then null; end;
  update public.agendamentos set situacao = 'cancelado', motivo = ' Cliente viajou ' where id = '00000000-0000-0000-0000-00000000a001' returning * into a;
  if a.motivo <> 'Cliente viajou' then raise exception 'FALHOU 3b: motivo (%)', a.motivo; end if;
  update public.agendamentos set situacao = 'agendado' where id = a.id returning * into a;
  if a.motivo <> '' then raise exception 'FALHOU 3c: motivo ficou'; end if;
  update public.agendamentos set situacao = 'chegou', ordem_id = gen_random_uuid(), os_numero = 1950 where id = a.id returning * into a;
  if a.situacao <> 'chegou' or a.os_numero <> 1950 then raise exception 'FALHOU 3d'; end if;
  select * into x from antes;
  if (select count(*) from public.ordens) <> x.ordens or (select count(*) from public.estoque_mov) <> x.mov
     or (select count(*) from public.contas) <> x.contas or (select count(*) from public.recibos) <> x.recibos then raise exception 'FALHOU 3e: a agenda mexeu em O.S., estoque ou financeiro'; end if;
  begin update public.agendamentos set situacao = 'remarcado' where id = a.id; raise exception 'FALHOU 3f: aceitou situação inválida';
  exception when check_violation then null; end;
end $$;

-- 4. mecânico lê e não grava nem apaga; consultor não apaga
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.agendamentos; if n <> 3 then raise exception 'FALHOU 4: mecânico devia ler os 3 (%)', n; end if;
  update public.agendamentos set obs = 'x'; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU 4b: mecânico alterou % linha(s)', n; end if;
  delete from public.agendamentos; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU 4c: mecânico apagou'; end if;
  begin insert into public.agendamentos (data, cliente, servico) values ('2026-12-12', '{"nome": "Y"}', 'Óleo'); raise exception 'FALHOU 4d: mecânico agendou';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
update public.perfis set papel = 'consultor' where id = '88888888-8888-8888-8888-888888888888';
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
set role authenticated;
do $$ declare n int; begin
  update public.agendamentos set obs = 'consultor anotou' where id = '00000000-0000-0000-0000-00000000a001'; get diagnostics n = row_count;
  if n <> 1 then raise exception 'FALHOU 4e: consultor não conseguiu alterar'; end if;
  delete from public.agendamentos; get diagnostics n = row_count; if n <> 0 then raise exception 'FALHOU 4f: consultor apagou'; end if;
end $$;
reset role;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

-- 5. exclusão avisa o banco do PC; restauração de backup aceita a agenda e mantém remarcações e quem criou
do $$ declare b jsonb; a public.agendamentos; begin
  select jsonb_agg(to_jsonb(x)) into b from public.agendamentos x where id = '00000000-0000-0000-0000-00000000a001';
  delete from public.agendamentos where id = '00000000-0000-0000-0000-00000000a001';
  if not exists (select 1 from public.exclusoes where tabela = 'agendamentos' and registro = '00000000-0000-0000-0000-00000000a001') then raise exception 'FALHOU 5: exclusão não registrada'; end if;
  perform public.restaurar_tabela('agendamentos', b);
  select * into a from public.agendamentos where id = '00000000-0000-0000-0000-00000000a001';
  if a.id is null or a.remarcacoes <> 2 or a.criado_por_nome <> 'Danilo' or a.os_numero <> 1950 then raise exception 'FALHOU 5b: restauração %', to_jsonb(a); end if;
end $$;

-- 6. papel de leitura do agente: lê a agenda sem a cópia do cliente (telefone)
do $$ begin
  if has_column_privilege('agente_leitura', 'public.agendamentos', 'cliente', 'select') then raise exception 'FALHOU 6: agente_leitura lê a cópia do cliente'; end if;
  if not has_column_privilege('agente_leitura', 'public.agendamentos', 'servico', 'select') then raise exception 'FALHOU 6b: agente_leitura sem leitura'; end if;
end $$;

-- 7. espelho do sistema antigo não apaga a agenda (tabela preservada)
do $$ begin
  if position('agendamentos' in pg_get_functiondef('public.espelho_legado_zerar()'::regprocedure)) > 0 then raise exception 'FALHOU 7: espelho mexe na agenda'; end if;
end $$;

select 'v54 OK' as resultado;
