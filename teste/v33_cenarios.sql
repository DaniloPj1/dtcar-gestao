-- Cenários do supabase/v33.sql (teste/teste_v33.sh): NF anexada à O.S.
\set ON_ERROR_STOP 1
create or replace function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; raise notice 'ok: %', msg; end $$;
select pg_temp.confere((select not public and file_size_limit = 5242880 from storage.buckets where id = 'notas'), 'pasta notas privada, até 5 MB');
select pg_temp.confere(not has_table_privilege('anon', 'public.os_notas', 'select'), 'anônimo não lê');
select pg_temp.confere(not has_table_privilege('agente_leitura', 'public.os_notas', 'select'), 'agente_leitura não lê');
select pg_temp.confere((select count(*) from information_schema.table_constraints where table_name = 'os_notas' and constraint_type = 'FOREIGN KEY') = 0, 'sem chave estrangeira (o espelho do sistema antigo não apaga a NF)');
set role authenticated;
set dtcar.uid = '00000000-0000-0000-0000-00000000000a';
insert into public.os_notas (os_numero, placa, numero_nf, arquivo, nome_arquivo, tipo_arquivo) values (1887, 'ABC1D23', '131', '1887/a.pdf', 'NF 131.pdf', 'application/pdf'),
  (1887, 'ABC1D23', '131', '1887/a.xml', 'NF 131.xml', 'application/xml');
insert into storage.objects (bucket_id, name) values ('notas', '1887/a.pdf');
select pg_temp.confere((select count(*) from public.os_notas where os_numero = 1887) = 2 and (select count(*) from storage.objects where bucket_id = 'notas') = 1, 'administrador grava e lê PDF e XML da NF');
set dtcar.uid = '00000000-0000-0000-0000-00000000000b';
select pg_temp.confere((select count(*) from public.os_notas) = 0 and (select count(*) from storage.objects where bucket_id = 'notas') = 0, 'consultor não vê notas nem arquivos');
do $$ begin
  insert into public.os_notas (os_numero, arquivo) values (1, 'y.pdf');
  raise exception 'consultor gravou';
exception when insufficient_privilege then null; end $$;
select pg_temp.confere(true, 'consultor não grava');
reset role;
