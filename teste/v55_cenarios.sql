-- Cenários do v55 (consulta do veículo pela placa). Roda depois de montar_banco.sh (até v54) + v55. Qualquer falha para o psql.
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test') on conflict do nothing;
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'consultor@oficina.test') on conflict do nothing;
insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test') on conflict do nothing;
insert into auth.users (id, email) values ('77777777-7777-7777-7777-777777777777', 'pendente@oficina.test') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);   -- o administrador libera os outros
insert into public.perfis (id, nome, papel, ativo) values ('66666666-6666-6666-6666-666666666666', 'Ana', 'consultor', true) on conflict (id) do update set papel = 'consultor', ativo = true;
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;
insert into public.perfis (id, nome, papel, ativo) values ('77777777-7777-7777-7777-777777777777', 'Novo', 'pendente', true) on conflict (id) do update set papel = 'pendente';

-- 1. a função (chave de servidor) grava, com a resposta inteira e o saldo; placa fora do padrão, tipo desconhecido e valor negativo são recusados
set role service_role;
insert into public.placa_consultas (placa, tipo, dados, resposta, valor_centavos, saldo_centavos, por)
  values ('INT8C36', 'basico', '{"marca": "Volkswagen", "modelo": "CROSSFOX"}', '{"basico": {"dados": {"marca": "VW"}}}', 3, 997, '99999999-9999-9999-9999-999999999999');
insert into public.placa_consultas (placa, tipo, dados, valor_centavos) values ('ABC1234', 'completa', '{"chassi": "9BWZZZ377VT004251"}', 20);
do $$ begin
  begin insert into public.placa_consultas (placa, tipo) values ('INT-8C36', 'basico'); raise exception 'FALHOU 1: aceitou placa com traço';
  exception when check_violation then null; end;
  begin insert into public.placa_consultas (placa, tipo) values ('INT8C36', 'fipe'); raise exception 'FALHOU 1b: aceitou tipo desconhecido';
  exception when check_violation then null; end;
  begin insert into public.placa_consultas (placa, tipo, valor_centavos) values ('INT8C36', 'basico', -1); raise exception 'FALHOU 1c: aceitou valor negativo';
  exception when check_violation then null; end;
end $$;
reset role;

-- 2. administrador e consultor leem; ninguém grava, altera nem apaga pela tela
set role authenticated;
do $$ declare u text; begin
  foreach u in array array['99999999-9999-9999-9999-999999999999', '66666666-6666-6666-6666-666666666666'] loop
    perform set_config('request.jwt.claim.sub', u, false);
    if (select count(*) from public.placa_consultas) <> 2 then raise exception 'FALHOU 2: % não leu as consultas', u; end if;
    if (select saldo_centavos from public.placa_consultas where placa = 'INT8C36') <> 997 then raise exception 'FALHOU 2a: saldo'; end if;
    begin insert into public.placa_consultas (placa, tipo, dados) values ('DEF5678', 'completa', '{"chassi": "FALSO"}'); raise exception 'FALHOU 2b: a tela gravou na cópia';
    exception when insufficient_privilege then null; end;
    begin update public.placa_consultas set dados = '{}'; raise exception 'FALHOU 2c: a tela alterou';
    exception when insufficient_privilege then null; end;
    begin delete from public.placa_consultas; raise exception 'FALHOU 2d: a tela apagou';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
-- 3. o mecânico e quem ainda não foi liberado não leem a tabela (o mecânico recebe os dados pela função)
do $$ declare u text; begin
  foreach u in array array['88888888-8888-8888-8888-888888888888', '77777777-7777-7777-7777-777777777777'] loop
    perform set_config('request.jwt.claim.sub', u, false);
    if (select count(*) from public.placa_consultas) <> 0 then raise exception 'FALHOU 3: % leu as consultas', u; end if;
  end loop;
end $$;
reset role;
-- 4. sem login (anon) nem a tabela existe para ele
set role anon;
do $$ begin
  begin perform count(*) from public.placa_consultas; raise exception 'FALHOU 4: anon leu';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
-- 5. fora do backup e do espelho: a restauração não aceita a tabela e a carga do sistema antigo não a apaga
do $$ declare r jsonb; begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
  begin r := public.restaurar_tabela('placa_consultas', '[]'::jsonb); raise exception 'FALHOU 5: a restauração aceitou placa_consultas (%)', r;
  exception when others then if sqlerrm like 'FALHOU 5%' then raise; end if; end;
end $$;
select 'v55 OK';
