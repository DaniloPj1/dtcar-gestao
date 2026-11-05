-- Cenários do v35 (teste/teste_v35.sh). Cada "assert" que falha para o teste com a mensagem.
\set ON_ERROR_STOP 1
create function pg_temp.confere(c boolean, msg text) returns void language plpgsql as $$ begin if not coalesce(c, false) then raise exception 'FALHOU: %', msg; end if; end $$;

-- estrutura
select pg_temp.confere((select count(*) = 2 from cron.job where jobname in ('dtcar-backup-leitura', 'dtcar-backup-leitura-vigia')), 'dois agendamentos (rodando o SQL 2 vezes não duplica)');
select pg_temp.confere((select schedule = '0 21 * * *' from cron.job where jobname = 'dtcar-backup-leitura'), 'backup às 21h UTC = 18h de Brasília');
select pg_temp.confere((select schedule = '40 21 * * *' from cron.job where jobname = 'dtcar-backup-leitura-vigia'), 'conferência às 18h40');
select pg_temp.confere((select command like '%x-dtcar-cron%' and command like '%/functions/v1/email%' from cron.job where jobname = 'dtcar-backup-leitura'), 'chama a função email com o segredo do agendamento');
select pg_temp.confere((select not public from storage.buckets where id = 'backup-leitura'), 'pasta backup-leitura é privada');
select pg_temp.confere((select dados -> 'backupLeitura' -> 'emails' = '["centroautomotivodtcar@hotmail.com", "danilo.pj1@hotmail.com"]'::jsonb and (dados -> 'backupLeitura' ->> 'ativo')::boolean from public.config), 'e-mails padrão: oficina e Danilo, ligado');
select pg_temp.confere((select dados ->> 'nome' = 'DTCAR CENTRO AUTOMOTIVO' from public.config), 'não apaga o resto da configuração');
-- configuração já trocada pela tela não é sobrescrita por um novo "rodar o SQL"
update public.config set dados = jsonb_set(dados, '{backupLeitura,emails}', '["outro@exemplo.com"]');
\i /tmp/v35_teste.sql
select pg_temp.confere((select dados -> 'backupLeitura' -> 'emails' = '["outro@exemplo.com"]'::jsonb from public.config), 'rodar de novo não troca os e-mails escolhidos na tela');

-- quem lê o histórico: só o administrador
insert into public.perfis values ('00000000-0000-0000-0000-00000000000a', 'admin', true), ('00000000-0000-0000-0000-00000000000b', 'consultor', true);
insert into public.backup_execucoes (situacao, passo, iniciado_em) values ('ok', 'enviar', '2026-11-04 21:00:05+00');
set role authenticated; set teste.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.confere((select count(*) = 0 from public.backup_execucoes), 'consultor não vê o histórico');
set teste.uid = '00000000-0000-0000-0000-00000000000a';
select pg_temp.confere((select count(*) = 1 from public.backup_execucoes), 'administrador vê o histórico');
do $$ begin insert into public.backup_execucoes (situacao) values ('ok'); raise exception 'FALHOU: tela gravou no histórico'; exception when insufficient_privilege then null; end $$;
do $$ begin perform public.backup_leitura_vigiar(); raise exception 'FALHOU: tela chamou a conferência'; exception when insufficient_privilege then null; end $$;
reset role; reset teste.uid;

-- 1) dia com envio ok: nada a avisar
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-04 21:40:00+00') ->> 'acao' = 'ok'), 'dia com envio ok: sem aviso');
select pg_temp.confere((select count(*) = 0 from public.avisos_teste), 'nenhum aviso no WhatsApp');

-- 2) agendamento nem rodou: avisa uma vez e registra
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-05 21:40:00+00') ->> 'acao' = 'avisado'), 'dia sem backup: avisa');
select pg_temp.confere((select count(*) = 1 and bool_and(texto like '%NÃO foi enviado%' and texto like '%não rodou%') from public.avisos_teste), 'aviso explica que o agendamento não rodou');
select pg_temp.confere((select count(*) = 1 from public.backup_execucoes where situacao = 'erro' and erro like '%não rodou%' and detalhe ? 'avisado_em'), 'fica no histórico como falha');
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-05 21:45:00+00') ->> 'acao' = 'ja_avisado'), 'segunda conferência do mesmo dia não repete');
select pg_temp.confere((select count(*) = 1 from public.avisos_teste), 'um aviso só');

-- 3) falhou com motivo: o aviso leva o motivo
insert into public.backup_execucoes (situacao, passo, iniciado_em, erro) values ('erro', 'enviar', '2026-11-06 21:00:03+00', 'enviar: A Microsoft pediu para conectar o e-mail de novo.');
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-06 21:40:00+00') ->> 'acao' = 'avisado'), 'falha: avisa');
select pg_temp.confere((select texto like '%Motivo: enviar: A Microsoft pediu%' from public.avisos_teste order by id desc limit 1), 'aviso com o motivo da falha');

-- 4) travou no meio: vira falha com o passo
insert into public.backup_execucoes (situacao, passo, iniciado_em) values ('rodando', 'planilha', '2026-11-07 21:00:02+00');
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-07 21:40:00+00') ->> 'acao' = 'avisado'), 'travado: avisa');
select pg_temp.confere((select situacao = 'erro' and erro like '%Parou no passo "planilha"%' from public.backup_execucoes where iniciado_em = '2026-11-07 21:00:02+00'), 'travado vira falha com o passo');

-- 5) falhou às 18h e o Danilo gerou pelo botão às 18h20 com sucesso: não avisa
insert into public.backup_execucoes (situacao, passo, iniciado_em, erro) values ('erro', 'paginas', '2026-11-08 21:00:02+00', 'paginas: x');
insert into public.backup_execucoes (situacao, passo, iniciado_em, origem) values ('ok', 'enviar', '2026-11-08 21:20:00+00', 'tela');
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-08 21:40:00+00') ->> 'acao' = 'ok'), 'gerado depois pelo botão: sem aviso');

-- 6) desligado na tela: não avisa
update public.config set dados = jsonb_set(dados, '{backupLeitura,ativo}', 'false');
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-09 21:40:00+00') ->> 'acao' = 'desligado'), 'desligado: sem aviso');
update public.config set dados = jsonb_set(dados, '{backupLeitura,ativo}', 'true');

-- 7) sem a função de aviso do WhatsApp (banco sem o v32): registra e não quebra
drop function public.whatsapp_alerta_na_fila(text);
select pg_temp.confere((select public.backup_leitura_vigiar('2026-11-10 21:40:00+00') ->> 'acao' = 'avisado'), 'sem o v32: registra sem quebrar');
