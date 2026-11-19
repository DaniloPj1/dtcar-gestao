-- Cenários do v62 (apagar falha no OBD, com registro). Roda depois de montar_banco.sh (até v61) + v62.
-- O que precisa valer: a equipe lê, cada um grava o seu, NINGUÉM altera o que já foi gravado, só o administrador apaga,
-- e a restauração do backup passa a aceitar a tabela nova.
\set ON_ERROR_STOP on
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
insert into auth.users (id, email, raw_user_meta_data) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test', '{"nome": "Zé"}') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;

-- 1. o mecânico registra o próprio apagamento; o banco não deixa gravar no nome de outro
set role authenticated;
select null from set_config('request.jwt.claim.sub', '88888888-8888-8888-8888-888888888888', false);
do $$ declare r public.obd_leituras; begin
  insert into public.obd_leituras (tipo, perfil_id, perfil_nome, placa, km, vin, codigos, codigos_depois, combustivel, combustivel_depois)
    values ('apagar', '88888888-8888-8888-8888-888888888888', 'Zé', 'ABC1D23', 152300, '9BWZZZ377VT004251',
            '[{"codigo":"P0171","situacao":"atual"}]'::jsonb, '[]'::jsonb, '{"pior":{"total":18}}'::jsonb, '{"pior":{"total":0}}'::jsonb)
    returning * into r;
  if r.tipo <> 'apagar' or r.km <> 152300 or r.codigos->0->>'codigo' <> 'P0171' then raise exception 'FALHOU 1: %', to_jsonb(r); end if;
  begin
    insert into public.obd_leituras (tipo, perfil_id, perfil_nome, placa) values ('apagar', '99999999-9999-9999-9999-999999999999', 'Danilo', 'XXX0X00');
    raise exception 'FALHOU 1b: mecânico gravou apagamento no nome de outra pessoa';
  exception when insufficient_privilege then null; end;
end $$;

-- 2. linha gravada NÃO muda mais: é registro, não rascunho
-- (sem política de update, o Postgres não acha linha para mudar: nada muda e nada estoura — o que importa é o registro ficar como está)
do $$ declare n int; begin
  begin update public.obd_leituras set km = 1 where placa = 'ABC1D23'; exception when insufficient_privilege then null; end;
  select count(*) into n from public.obd_leituras where placa = 'ABC1D23' and km = 152300;
  if n <> 1 then raise exception 'FALHOU 2: o registro foi alterado'; end if;
  begin delete from public.obd_leituras where placa = 'ABC1D23'; exception when insufficient_privilege then null; end;
  select count(*) into n from public.obd_leituras where placa = 'ABC1D23';
  if n <> 1 then raise exception 'FALHOU 2b: o mecânico apagou o próprio registro'; end if;
end $$;

-- 3. tipo inventado não entra; a equipe toda lê (o mecânico precisa ver se este carro já foi apagado antes)
do $$ declare n int; begin
  begin insert into public.obd_leituras (tipo, perfil_id, placa) values ('programar', '88888888-8888-8888-8888-888888888888', 'X');
    raise exception 'FALHOU 3: aceitou tipo fora da lista';
  exception when check_violation then null; end;
  select count(*) into n from public.obd_leituras where placa = 'ABC1D23';
  if n <> 1 then raise exception 'FALHOU 3b: a equipe não lê o registro (%)', n; end if;
end $$;

-- 4. o administrador apaga (engano), e o apagamento entra em exclusoes para o banco do PC acompanhar
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
do $$ declare id_ uuid; n int; begin
  insert into public.obd_leituras (tipo, perfil_id, perfil_nome, placa) values ('leitura', '99999999-9999-9999-9999-999999999999', 'Danilo', 'QQQ1Q11') returning id into id_;
  delete from public.obd_leituras where id = id_;
  select count(*) into n from public.exclusoes where tabela = 'obd_leituras' and registro = id_::text;
  if n <> 1 then raise exception 'FALHOU 4: exclusão não foi registrada para o banco do PC (%)', n; end if;
end $$;

-- 5. restauração do backup aceita a tabela nova (e continua recusando tabela que não é do backup)
do $$ declare r jsonb; begin
  delete from public.obd_leituras;
  r := public.restaurar_tabela('obd_leituras', jsonb_build_array(jsonb_build_object(
        'id', '00000000-0000-0000-0000-00000000ab01', 'tipo', 'apagar', 'perfil_id', '88888888-8888-8888-8888-888888888888',
        'perfil_nome', 'Zé', 'placa', 'ABC1D23', 'km', 152300, 'codigos', '[]'::jsonb, 'leituras', '[]'::jsonb,
        'vin', '', 'obs', '', 'criado_em', now(), 'atualizado_em', now())));
  if (r->>'incluidos')::int <> 1 then raise exception 'FALHOU 5: backup não voltou: %', r; end if;
  begin r := public.restaurar_tabela('segredos', '[]'::jsonb); raise exception 'FALHOU 5b: aceitou restaurar segredos';
  exception when others then if sqlerrm like 'FALHOU%' then raise; end if; end;
end $$;

-- 6. o espelho do sistema antigo NÃO apaga o registro: não existe no OS Oficina e é prova de quem mexeu no carro
reset role;
do $$ declare n int; begin
  perform public.espelho_legado_zerar();
  select count(*) into n from public.obd_leituras;
  if n <> 1 then raise exception 'FALHOU 6: o espelho levou o registro do OBD embora (%)', n; end if;
end $$;

select 'v62 OK' as resultado;
