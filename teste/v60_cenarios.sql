-- Cenários do v60 (serviço pelo mecânico no app + mecânico no agendamento). Roda depois de montar_banco.sh (até v59) + v60. Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test', '{"nome": "Zé"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('66666666-6666-6666-6666-666666666666', 'outro@oficina.test', '{"nome": "Beto"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;
insert into public.perfis (id, nome, papel, ativo) values ('66666666-6666-6666-6666-666666666666', 'Beto', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;
insert into public.clientes (id, nome) values ('00000000-0000-0000-0000-0000000000c1', 'Ana Souza') on conflict (id) do nothing;
insert into public.veiculos (id, cliente_id, placa, marca, modelo) values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'ABC1D23', 'Fiat', 'Uno') on conflict (id) do nothing;
insert into public.ordens (id, numero, status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, total)
values ('00000000-0000-0000-0000-000000000600', 600, 'execucao', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000f1', '{"nome": "Ana Souza"}', '{"placa": "ABC1D23", "marca": "Fiat", "modelo": "Uno"}', 1000, 0)
on conflict (id) do nothing;

create temp table antes as select (select count(*) from public.ordens) ordens, (select count(*) from public.estoque_mov) mov,
  (select count(*) from public.contas) contas, (select count(*) from public.recibos) recibos;
grant select on antes to authenticated;

-- 1. agendamento com mecânico: coluna nova aceita e some quando o perfil é apagado (set null)
do $$ declare a public.agendamentos; begin
  insert into public.agendamentos (id, data, cliente, servico, mecanico_id, mecanico_nome) values ('00000000-0000-0000-0000-00000000a601', '2026-12-10', '{"nome": "X"}', 'Óleo', '88888888-8888-8888-8888-888888888888', 'Zé') returning * into a;
  if a.mecanico_id is null or a.mecanico_nome <> 'Zé' then raise exception 'FALHOU 1: mecânico não gravou'; end if;
end $$;

-- 2. mecânico inicia o serviço na O.S.; não abre a mesma O.S. duas vezes enquanto não finaliza; outro mecânico pode
set role authenticated;
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ declare s public.servico_apontamentos; begin
  insert into public.servico_apontamentos (id, ordem_id, os_numero, perfil_id, perfil_nome) values ('00000000-0000-0000-0000-00000000ab01', '00000000-0000-0000-0000-000000000600', 600, '88888888-8888-8888-8888-888888888888', 'Zé') returning * into s;
  if s.situacao <> 'andamento' or s.inicio is null then raise exception 'FALHOU 2: início %', to_jsonb(s); end if;
  begin insert into public.servico_apontamentos (ordem_id, perfil_id, perfil_nome) values ('00000000-0000-0000-0000-000000000600', '88888888-8888-8888-8888-888888888888', 'Zé'); raise exception 'FALHOU 2b: abriu a mesma O.S. duas vezes';
  exception when unique_violation then null; end;
  -- mecânico não grava apontamento em nome de outro
  begin insert into public.servico_apontamentos (ordem_id, perfil_id, perfil_nome) values ('00000000-0000-0000-0000-000000000600', '66666666-6666-6666-6666-666666666666', 'Beto'); raise exception 'FALHOU 2c: gravou em nome de outro';
  exception when insufficient_privilege or others then if sqlerrm not like '%row-level security%' then raise; end if; end;
  -- pausa com motivo, retoma, finaliza marcando itens e indicando outro responsável
  update public.servico_apontamentos set situacao = 'pausado', motivo_pausa = 'Aguardando peças', pausas = pausas || jsonb_build_array(jsonb_build_object('em', now(), 'motivo', 'Aguardando peças')) where id = s.id returning * into s;
  if s.situacao <> 'pausado' or jsonb_array_length(s.pausas) <> 1 then raise exception 'FALHOU 2d: pausa'; end if;
  update public.servico_apontamentos set situacao = 'finalizado', fim = now(), itens_executados = '{}', indicacoes = '[{"item_id": null, "descricao": "Alinhamento", "para_id": "66666666-6666-6666-6666-666666666666", "para_nome": "Beto", "em": "2026-11-17T10:00:00Z", "visto_em": null}]' where id = s.id returning * into s;
  if s.situacao <> 'finalizado' or s.fim is null or s.atualizado_em < s.criado_em then raise exception 'FALHOU 2e: finalizar'; end if;
  -- depois de finalizar, pode abrir a mesma O.S. de novo (índice parcial)
  insert into public.servico_apontamentos (ordem_id, perfil_id, perfil_nome) values ('00000000-0000-0000-0000-000000000600', '88888888-8888-8888-8888-888888888888', 'Zé');
end $$;

-- 3. quem foi indicado marca como visto (só a própria indicação)
select null from set_config('request.jwt.claim.sub', '66666666-6666-6666-6666-666666666666', false);
do $$ declare s public.servico_apontamentos; begin
  perform public.apontamento_visto('00000000-0000-0000-0000-00000000ab01');
  select * into s from public.servico_apontamentos where id = '00000000-0000-0000-0000-00000000ab01';
  if s.indicacoes->0->>'visto_em' is null then raise exception 'FALHOU 3: visto não gravou'; end if;
  -- outro mecânico não altera o apontamento do Zé pela tabela
  update public.servico_apontamentos set obs = 'x' where id = s.id;
  select * into s from public.servico_apontamentos where id = s.id;
  if s.obs = 'x' then raise exception 'FALHOU 3b: outro mecânico alterou'; end if;
end $$;
reset role;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);

-- 4. exclusão avisa o banco do PC; backup restaura a tabela
do $$ declare n int; begin
  delete from public.servico_apontamentos where ordem_id = '00000000-0000-0000-0000-000000000600' and situacao = 'andamento';
  select count(*) into n from public.exclusoes where tabela = 'servico_apontamentos';
  if n < 1 then raise exception 'FALHOU 4: exclusão não registrada'; end if;
  perform public.restaurar_tabela('servico_apontamentos', (select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) from public.servico_apontamentos s));
end $$;

-- 5. nada de O.S., estoque ou financeiro mexido
do $$ declare a antes; begin
  select * into a from antes;
  if a.ordens <> (select count(*) from public.ordens) or a.mov <> (select count(*) from public.estoque_mov) or a.contas <> (select count(*) from public.contas) or a.recibos <> (select count(*) from public.recibos) then
    raise exception 'FALHOU 5: mexeu em O.S./estoque/financeiro'; end if;
end $$;
select 'v60 OK' as resultado;
