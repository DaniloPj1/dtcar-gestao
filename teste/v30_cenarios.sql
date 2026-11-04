-- Cenários do supabase/v30.sql (teste/teste_v30.sh).
\set ON_ERROR_STOP 1
create or replace function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; raise notice 'ok: %', msg; end $$;
select pg_temp.confere((select not public and file_size_limit = 15728640 from storage.buckets where id = 'rh'), 'pasta rh privada, até 15 MB');
select pg_temp.confere(not has_table_privilege('anon', 'public.rh_documentos', 'select'), 'anônimo não lê');
select pg_temp.confere(not has_table_privilege('agente_leitura', 'public.rh_documentos', 'select'), 'agente_leitura não lê (salário e dado pessoal)');
-- administrador grava e lê
set role authenticated;
set dtcar.uid = '00000000-0000-0000-0000-00000000000a';
insert into public.rh_documentos (competencia, tipo, titulo, arquivo, origem, email_id, anexo_id) values ('2026-10', 'pro_labore', 'PRO LABORE', '2026-10/a.pdf', 'email', 'M1', 'A1');
insert into storage.objects (bucket_id, name) values ('rh', '2026-10/a.pdf');
select pg_temp.confere((select count(*) from public.rh_documentos) = 1 and (select count(*) from storage.objects where bucket_id = 'rh') = 1, 'administrador grava e lê documento e arquivo');
do $$ begin
  insert into public.rh_documentos (competencia, tipo, arquivo, origem, email_id, anexo_id) values ('2026-10', 'recibo', '2026-10/b.pdf', 'email', 'M1', 'A1');
  raise exception 'aceitou anexo repetido';
exception when unique_violation then null; end $$;
select pg_temp.confere(true, 'o mesmo anexo do e-mail não entra duas vezes');
do $$ begin
  insert into public.rh_documentos (competencia, tipo, arquivo) values ('10/2026', 'recibo', 'x.pdf');
  raise exception 'aceitou mês inválido';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.rh_documentos (competencia, tipo, arquivo) values ('2026-10', 'ferias', 'x.pdf');
  raise exception 'aceitou tipo inválido';
exception when check_violation then null; end $$;
select pg_temp.confere(true, 'mês e tipo inválidos recusados');
insert into public.rh_documentos (competencia, tipo, arquivo, origem) values ('2026-10', 'das', 'm1.pdf', 'manual'), ('2026-10', 'das', 'm2.pdf', 'manual');
select pg_temp.confere((select count(*) from public.rh_documentos where origem = 'manual') = 2, 'vários documentos manuais (sem e-mail) convivem');
-- consultor não vê nada e não grava
set dtcar.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.confere((select count(*) from public.rh_documentos) = 0 and (select count(*) from storage.objects where bucket_id = 'rh') = 0, 'consultor não vê documentos nem arquivos');
do $$ begin
  insert into public.rh_documentos (competencia, tipo, arquivo) values ('2026-10', 'recibo', 'y.pdf');
  raise exception 'consultor gravou';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('rh', 'y.pdf');
  raise exception 'consultor enviou arquivo';
exception when insufficient_privilege then null; end $$;
select pg_temp.confere(true, 'consultor não grava documento nem arquivo');
reset role;
