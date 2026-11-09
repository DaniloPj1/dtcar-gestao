-- Cenários do v49 (consulta da SEFAZ na hora). Horários em UTC: 11h = 8h de Brasília, 19h = 16h.
\set ON_ERROR_STOP 1
do $$
declare r jsonb; n int;
begin
  -- 1. agendamentos
  if (select count(*) from cron.job where jobname like 'dtcar-sefaz-%') <> 4 then raise exception 'FALHOU: 4 agendamentos'; end if;
  if (select schedule from cron.job where jobname = 'dtcar-sefaz-08h') <> '0 11 * * *' then raise exception 'FALHOU: 8h'; end if;
  if (select schedule from cron.job where jobname = 'dtcar-sefaz-16h') <> '0 19 * * *' then raise exception 'FALHOU: 16h'; end if;
  if (select schedule from cron.job where jobname = 'dtcar-sefaz-vigia-09h') <> '0 12 * * *' then raise exception 'FALHOU: vigia 9h'; end if;
  if (select schedule from cron.job where jobname = 'dtcar-sefaz-vigia-17h') <> '0 20 * * *' then raise exception 'FALHOU: vigia 17h'; end if;
  if (select command from cron.job where jobname = 'dtcar-sefaz-08h') not like '%sefaz_disparar(8)%' then raise exception 'FALHOU: comando 8h'; end if;
  if (select command from cron.job where jobname = 'dtcar-sefaz-vigia-17h') not like '%sefaz_vigiar(16)%' then raise exception 'FALHOU: comando vigia 17h'; end if;

  -- 2. sem token: nada é chamado, nada é avisado, sem erro (mesmo com a busca ligada e a consulta atrasada)
  update public.sefaz_config set ativo = true where id = 1;
  r := public.sefaz_disparar(8, '2026-11-09 11:00Z');
  if r ->> 'acao' <> 'sem_token' then raise exception 'FALHOU: sem token %', r; end if;
  r := public.sefaz_vigiar(8, '2026-11-09 12:00Z');
  if r ->> 'acao' <> 'sem_token' then raise exception 'FALHOU: vigia sem token %', r; end if;
  insert into public.segredos values ('github_actions', '   ');   -- token em branco também conta como sem token
  if public.sefaz_disparar(8, '2026-11-09 11:00Z') ->> 'acao' <> 'sem_token' then raise exception 'FALHOU: token em branco'; end if;
  if (select count(*) from net.chamadas) <> 0 or (select count(*) from public.zap_teste) <> 0 or (select count(*) from public.sefaz_disparos) <> 0 then
    raise exception 'FALHOU: sem token chamou/avisou/gravou'; end if;
  update public.segredos set valor = 'token-de-teste' where chave = 'github_actions';

  -- 3. busca desligada na tela: não chama
  update public.sefaz_config set ativo = false where id = 1;
  if public.sefaz_disparar(8, '2026-11-09 11:00Z') ->> 'acao' <> 'desligado' then raise exception 'FALHOU: desligado'; end if;
  if public.sefaz_vigiar(8, '2026-11-09 12:00Z') ->> 'acao' <> 'desligado' then raise exception 'FALHOU: vigia desligado'; end if;
  if (select count(*) from net.chamadas) <> 0 then raise exception 'FALHOU: desligado chamou'; end if;
  update public.sefaz_config set ativo = true where id = 1;

  -- 4. 8h: chama o GitHub uma vez só
  r := public.sefaz_disparar(8, '2026-11-09 11:00Z');
  if r ->> 'acao' <> 'chamado' then raise exception 'FALHOU: chamar %', r; end if;
  r := public.sefaz_disparar(8, '2026-11-09 11:00:30Z');
  if r ->> 'acao' <> 'ja_chamado' then raise exception 'FALHOU: repetir %', r; end if;
  if (select count(*) from net.chamadas) <> 1 then raise exception 'FALHOU: chamou mais de uma vez'; end if;
  if (select url from net.chamadas) <> 'https://api.github.com/repos/DaniloPj1/dtcar-gestao/actions/workflows/sefaz.yml/dispatches' then raise exception 'FALHOU: url'; end if;
  if (select body ->> 'ref' from net.chamadas) <> 'main' then raise exception 'FALHOU: ref'; end if;
  if (select headers ->> 'Authorization' from net.chamadas) <> 'Bearer token-de-teste' then raise exception 'FALHOU: token no cabeçalho'; end if;
  if (select headers ->> 'User-Agent' from net.chamadas) is null then raise exception 'FALHOU: User-Agent'; end if;
  if (select dia from public.sefaz_disparos where horario = 8) <> date '2026-11-09' then raise exception 'FALHOU: dia'; end if;

  -- 5. GitHub aceitou (204) e a consulta saiu às 8h01: o vigia das 9h não avisa
  insert into net._http_response (id, status_code) select id, 204 from net.chamadas;
  update public.sefaz_config set ultima_consulta = '2026-11-09 11:01Z', worker_em = '2026-11-09 11:01Z' where id = 1;
  r := public.sefaz_vigiar(8, '2026-11-09 12:00Z');
  if r ->> 'acao' <> 'ok' then raise exception 'FALHOU: consulta saiu %', r; end if;
  if (select count(*) from public.zap_teste) <> 0 then raise exception 'FALHOU: avisou com a consulta feita'; end if;

  -- 6. 16h: GitHub recusou o token (401) → o vigia das 17h avisa UMA vez, com o motivo
  r := public.sefaz_disparar(16, '2026-11-09 19:00Z');
  insert into net._http_response (id, status_code, content) values ((r ->> 'pedido_id')::bigint, 401, '{"message":"Bad credentials"}');
  r := public.sefaz_vigiar(16, '2026-11-09 20:00Z');
  if r ->> 'acao' <> 'avisado' then raise exception 'FALHOU: avisar 401 %', r; end if;
  if (select texto from public.zap_teste order by id desc limit 1) not like '%16h não saiu%token%' then raise exception 'FALHOU: texto 401: %', (select texto from public.zap_teste order by id desc limit 1); end if;
  r := public.sefaz_vigiar(16, '2026-11-09 20:05Z');
  if r ->> 'acao' <> 'ja_avisado' then raise exception 'FALHOU: avisar de novo %', r; end if;
  if (select count(*) from public.zap_teste) <> 1 then raise exception 'FALHOU: mais de um aviso no horário'; end if;
  if (select aviso_em from public.sefaz_disparos where dia = '2026-11-09' and horario = 16) is null then raise exception 'FALHOU: aviso não registrado'; end if;

  -- 7. dia seguinte, o agendamento das 8h não rodou: o vigia avisa que não houve pedido
  r := public.sefaz_vigiar(8, '2026-11-10 12:00Z');
  if r ->> 'acao' <> 'avisado' or r ->> 'motivo' not like '%não rodou%' then raise exception 'FALHOU: sem pedido %', r; end if;
  if public.sefaz_vigiar(8, '2026-11-10 12:10Z') ->> 'acao' <> 'ja_avisado' then raise exception 'FALHOU: sem pedido 2x'; end if;

  -- 8. GitHub aceitou, mas o robô ainda não rodou (fila do GitHub)
  r := public.sefaz_disparar(16, '2026-11-10 19:00Z');
  insert into net._http_response (id, status_code) values ((r ->> 'pedido_id')::bigint, 204);
  r := public.sefaz_vigiar(16, '2026-11-10 20:00Z');
  if r ->> 'motivo' not like '%ainda não rodou%' then raise exception 'FALHOU: fila do GitHub %', r; end if;

  -- 9. SEFAZ pediu espera (consulta pedida na tela às 15h40): o motivo diz até quando
  r := public.sefaz_disparar(8, '2026-11-11 11:00Z');
  insert into net._http_response (id, status_code) values ((r ->> 'pedido_id')::bigint, 204);
  update public.sefaz_config set ultima_consulta = '2026-11-11 10:40Z', proxima_consulta = '2026-11-11 11:42Z', worker_em = '2026-11-11 11:01Z' where id = 1;
  r := public.sefaz_vigiar(8, '2026-11-11 12:00Z');
  if r ->> 'motivo' not like '%espera até 08:42%' then raise exception 'FALHOU: espera da SEFAZ %', r; end if;

  -- 10. robô rodou com erro
  r := public.sefaz_disparar(16, '2026-11-11 19:00Z');
  insert into net._http_response (id, status_code) values ((r ->> 'pedido_id')::bigint, 204);
  update public.sefaz_config set proxima_consulta = null, worker_em = '2026-11-11 19:02Z', worker_erro = 'O certificado venceu' where id = 1;
  r := public.sefaz_vigiar(16, '2026-11-11 20:00Z');
  if r ->> 'motivo' not like '%certificado venceu%' then raise exception 'FALHOU: erro do robô %', r; end if;

  -- 11. 23h de Brasília ainda é o mesmo dia (02h UTC do dia seguinte)
  if public.sefaz_vigiar(16, '2026-11-12 02:00Z') ->> 'acao' <> 'ja_avisado' then raise exception 'FALHOU: dia de Brasília'; end if;

  -- 12. site não chama as funções
  if has_function_privilege('authenticated', 'public.sefaz_disparar(int, timestamptz)', 'execute') then raise exception 'FALHOU: site chama disparar'; end if;
  if has_function_privilege('authenticated', 'public.sefaz_vigiar(int, timestamptz)', 'execute') then raise exception 'FALHOU: site chama vigiar'; end if;
  raise notice 'OK: v49 (SEFAZ na hora)';
end $$;
