-- Cenários do v63: os tipos novos entram, tipo desconhecido não entra, as linhas antigas continuam valendo, e o selo é guardado.
do $$
declare t text; n int;
begin
  foreach t in array array['leitura','apagar','atuar','aprender','apagar_modulo','gravar_bico','sessao','laudo','mapa'] loop
    insert into public.obd_leituras (tipo, perfil_nome, placa, dados) values (t, 'Teste', 'TST0A00', jsonb_build_object('tipo', t));
  end loop;
  select count(*) into n from public.obd_leituras where placa = 'TST0A00';
  if n <> 9 then raise exception 'FALHOU: eram para entrar 9 tipos, entraram %', n; end if;
  begin
    insert into public.obd_leituras (tipo, placa) values ('qualquer', 'TST0A00');
    raise exception 'FALHOU: tipo desconhecido entrou';
  exception when check_violation then null; end;
  -- linha do jeito antigo (sem dados e sem selo) continua entrando: é o apagar do OBD-II da v62
  insert into public.obd_leituras (tipo, placa, codigos) values ('apagar', 'TST0A01', '[{"codigo":"P0301"}]'::jsonb);
  insert into public.obd_leituras (tipo, placa, dados, selo) values ('laudo', 'TST0A02', '{"versao":1}'::jsonb, repeat('a', 64));
  select count(*) into n from public.obd_leituras where tipo = 'laudo' and length(selo) = 64 and dados->>'versao' = '1';
  if n <> 1 then raise exception 'FALHOU: o laudo não guardou dados e selo'; end if;
  -- continua sem política de UPDATE: linha gravada não muda
  select count(*) into n from pg_policies where schemaname = 'public' and tablename = 'obd_leituras' and cmd = 'UPDATE';
  if n <> 0 then raise exception 'FALHOU: apareceu política de alteração na obd_leituras'; end if;
  raise notice 'ok';
end $$;
select 'v63 OK' as resultado;
