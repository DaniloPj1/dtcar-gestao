-- Cenários do v56 (consulta completa só do administrador + acerto do valor da completa). Roda depois de montar_banco.sh (até v55) + v56.
-- Qualquer falha para o psql. Roda a partir da raiz do repositório (usa \i supabase/v56.sql).
\set ON_ERROR_STOP on
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test') on conflict do nothing;
insert into auth.users (id, email) values ('66666666-6666-6666-6666-666666666666', 'consultor@oficina.test') on conflict do nothing;
insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888', 'mecanico@oficina.test') on conflict do nothing;
insert into public.perfis (id, nome, papel, ativo) values ('99999999-9999-9999-9999-999999999999', 'Danilo', 'admin', true) on conflict (id) do update set papel = 'admin', ativo = true;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);   -- o administrador libera os outros
insert into public.perfis (id, nome, papel, ativo) values ('66666666-6666-6666-6666-666666666666', 'Ana', 'consultor', true) on conflict (id) do update set papel = 'consultor', ativo = true;
insert into public.perfis (id, nome, papel, ativo) values ('88888888-8888-8888-8888-888888888888', 'Zé', 'mecanico', true) on conflict (id) do update set papel = 'mecanico', ativo = true;

-- as consultas como ficaram gravadas em 14/11/2026 (a completa com R$ 0,03 e o saldo de antes do desconto inteiro) e outras para conferir
set role service_role;
insert into public.placa_consultas (placa, tipo, dados, valor_centavos, saldo_centavos) values
  ('MST2E41', 'basico', '{"marca": "Honda"}', 3, 4997),
  ('MST2E41', 'completa', '{"marca": "Honda", "chassi": "9C2KC15109R105292", "renavam": "00156589370"}', 3, 4994),
  ('ABC1234', 'completa', '{"chassi": "9BWZZZ377VT004251"}', 20, 977),      -- já certa: não muda
  ('DEF5678', 'completa', '{"chassi": "9BWZZZ377VT004252"}', 3, null),      -- sem saldo gravado: só o valor
  ('GHI9J12', 'completa', '{"chassi": "9BWZZZ377VT004253"}', 3, 10),        -- saldo nunca fica negativo
  ('JKL3M45', 'completa', '{"chassi": "9BWZZZ377VT004254"}', 25, 500);      -- gravada acima da tabela: não muda
reset role;
\i supabase/v56.sql
\i supabase/v56.sql

-- 1. o acerto: completa abaixo de R$ 0,20 vira R$ 0,20 e o saldo perde a diferença, uma vez só; o resto não muda
do $$ declare l record; begin
  select valor_centavos v, saldo_centavos s into l from public.placa_consultas where placa = 'MST2E41' and tipo = 'completa';
  if l.v <> 20 or l.s <> 4977 then raise exception 'FALHOU 1: MST2E41 completa ficou %/%', l.v, l.s; end if;
  select valor_centavos v, saldo_centavos s into l from public.placa_consultas where placa = 'MST2E41' and tipo = 'basico';
  if l.v <> 3 or l.s <> 4997 then raise exception 'FALHOU 1a: a básica mudou (%/%)', l.v, l.s; end if;
  select valor_centavos v, saldo_centavos s into l from public.placa_consultas where placa = 'ABC1234';
  if l.v <> 20 or l.s <> 977 then raise exception 'FALHOU 1b: completa já certa mudou (%/%)', l.v, l.s; end if;
  select valor_centavos v, saldo_centavos s into l from public.placa_consultas where placa = 'DEF5678';
  if l.v <> 20 or l.s is not null then raise exception 'FALHOU 1c: completa sem saldo (%/%)', l.v, l.s; end if;
  select valor_centavos v, saldo_centavos s into l from public.placa_consultas where placa = 'GHI9J12';
  if l.v <> 20 or l.s <> 0 then raise exception 'FALHOU 1d: saldo negativo (%/%)', l.v, l.s; end if;
  select valor_centavos v, saldo_centavos s into l from public.placa_consultas where placa = 'JKL3M45';
  if l.v <> 25 or l.s <> 500 then raise exception 'FALHOU 1e: completa acima da tabela mudou (%/%)', l.v, l.s; end if;
end $$;

-- 2. só o administrador lê a tabela (chassi e Renavam das consultas completas); ninguém grava, altera nem apaga pela tela
set role authenticated;
do $$ declare u text; begin
  perform set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
  if (select count(*) from public.placa_consultas) <> 6 then raise exception 'FALHOU 2: o administrador não leu as consultas'; end if;
  begin update public.placa_consultas set dados = '{}'; raise exception 'FALHOU 2a: a tela alterou';
  exception when insufficient_privilege then null; end;
  begin delete from public.placa_consultas; raise exception 'FALHOU 2b: a tela apagou';
  exception when insufficient_privilege then null; end;
  foreach u in array array['66666666-6666-6666-6666-666666666666', '88888888-8888-8888-8888-888888888888'] loop
    perform set_config('request.jwt.claim.sub', u, false);
    if (select count(*) from public.placa_consultas) <> 0 then raise exception 'FALHOU 3: % leu as consultas (só o administrador)', u; end if;
    begin insert into public.placa_consultas (placa, tipo, dados) values ('DEF5678', 'completa', '{"chassi": "FALSO"}'); raise exception 'FALHOU 3a: a tela gravou na cópia';
    exception when insufficient_privilege then null; end;
  end loop;
end $$;
reset role;
-- 3. sem login (anon) continua sem a tabela; a função (chave de servidor) continua lendo e gravando
set role anon;
do $$ begin
  begin perform count(*) from public.placa_consultas; raise exception 'FALHOU 4: anon leu';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
set role service_role;
do $$ begin
  if (select count(*) from public.placa_consultas) <> 6 then raise exception 'FALHOU 5: a função não leu a cópia'; end if;
  insert into public.placa_consultas (placa, tipo, valor_centavos, saldo_centavos) values ('NOP6Q78', 'completa', 20, 4957);
end $$;
reset role;
select 'v56 OK' as resultado;
