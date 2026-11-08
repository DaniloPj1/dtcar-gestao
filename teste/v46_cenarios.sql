\set ON_ERROR_STOP 1
create schema if not exists cron; create table cron.job (jobid serial, jobname text unique, schedule text, command text);
create or replace function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.job (jobname, schedule, command) values (n, s, c) on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command returning jobid::bigint $$;
create or replace function cron.unschedule(id int) returns boolean language sql as $$ delete from cron.job where jobid = id returning true $$;
\i supabase/v46.sql
\i supabase/v46.sql
create or replace function pg_temp.c(ok boolean, n text) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'FALHOU: %', n; end if; raise notice 'OK: %', n; end $$;
select pg_temp.c(public.pascoa(2026) = '2026-04-05', 'Páscoa 2026'), pg_temp.c(public.pascoa(2027) = '2027-03-28', 'Páscoa 2027'), pg_temp.c(public.pascoa(2028) = '2028-04-16', 'Páscoa 2028');
select pg_temp.c(public.feriado_nacional('2027-03-26') = 'Sexta-feira da Paixão', 'Paixão 2027');
select pg_temp.c(not public.backup_leitura_dia_util('2026-11-20'), 'Consciência Negra (sexta) sem backup');
select pg_temp.c(not public.backup_leitura_dia_util('2026-11-14'), 'sábado sem backup'), pg_temp.c(not public.backup_leitura_dia_util('2026-11-08'), 'domingo sem backup');
select pg_temp.c(public.backup_leitura_dia_util('2026-11-10'), 'terça com backup'), pg_temp.c(not public.backup_leitura_dia_util('2026-12-25'), 'Natal sem backup');
select pg_temp.c(public.backup_leitura_dia_util('2026-11-16'), 'segunda 16/11 com backup');
select pg_temp.c((select count(*) from cron.job where schedule like '% * * 1-5' and command like '%backup_leitura_dia_util()%') = 2, 'dois agendamentos seg–sex com a conferência');
