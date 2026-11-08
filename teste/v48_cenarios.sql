-- Testa supabase/v47.sql + v48.sql (conteúdo do site institucional) num Postgres local: RLS de administrador, histórico sem
-- alterar/apagar e leitura pública só da versão publicada.
\set ON_ERROR_STOP 1
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
end $$;
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $$ select nullif(current_setting('teste.uid', true), '')::uuid $$;
create or replace function public.e_admin() returns boolean language sql as $$ select coalesce(current_setting('teste.admin', true), '1') = '1' $$;
grant usage on schema public, auth to anon, authenticated;
grant execute on function auth.uid(), public.e_admin() to anon, authenticated;
create schema if not exists storage;
create table if not exists storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table if not exists storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant usage on schema storage to authenticated; grant select, insert, update, delete on storage.objects to authenticated;
\i supabase/v47.sql
\i supabase/v48.sql
\i supabase/v48.sql
create or replace function pg_temp.c(ok boolean, n text) returns void language plpgsql as $$ begin if not coalesce(ok,false) then raise exception 'FALHOU: %', n; end if; raise notice 'OK: %', n; end $$;
select pg_temp.c(public.site_conteudo_publicado() = '{}'::jsonb, 'sem publicação devolve vazio');
select pg_temp.c((select public and file_size_limit = 5242880 from storage.buckets where id = 'site'), 'pasta site pública, 5 MB');

-- administrador grava rascunho e publica
set role authenticated;
select set_config('teste.admin', '1', false);
insert into public.site_rascunho (id, dados) values (1, '{"campos":{"h1":"Oi"}}');
update public.site_rascunho set dados = '{"campos":{"h1":"Olá"}}' where id = 1;
insert into public.site_publicacoes (dados, observacao) values ('{"campos":{"h1":"Primeira"}}', 'v1');
insert into public.site_publicacoes (dados) values ('{"campos":{"h1":"Segunda"}}');
insert into storage.objects (bucket_id, name) values ('site', 'admin.jpg');
do $$ begin insert into storage.objects (bucket_id, name) values ('notas', 'x.pdf'); raise exception 'FALHOU: gravou fora da pasta site'; exception when insufficient_privilege then raise notice 'OK: política só vale para a pasta site'; end $$;
reset role;
select pg_temp.c(public.site_conteudo_publicado()->'dados'->'campos'->>'h1' = 'Segunda', 'publicada mais recente');
select pg_temp.c(public.site_conteudo_publicado() ? 'versao' and not public.site_conteudo_publicado() ? 'publicado_por', 'visitante não vê quem publicou');

-- histórico não muda
set role authenticated;
do $$ begin update public.site_publicacoes set observacao = 'x'; raise exception 'FALHOU: alterou publicação'; exception when insufficient_privilege then raise notice 'OK: publicação não se altera'; end $$;
do $$ begin delete from public.site_publicacoes; raise exception 'FALHOU: apagou publicação'; exception when insufficient_privilege then raise notice 'OK: publicação não se apaga'; end $$;

-- não administrador não lê nem grava
select set_config('teste.admin', '0', false);
select pg_temp.c((select count(*) from public.site_rascunho) = 0, 'não admin não lê rascunho');
select pg_temp.c((select count(*) from public.site_publicacoes) = 0, 'não admin não lê histórico');
do $$ begin insert into public.site_publicacoes (dados) values ('{}'); raise exception 'FALHOU: não admin publicou'; exception when insufficient_privilege then raise notice 'OK: não admin não publica'; end $$;
do $$ begin insert into storage.objects (bucket_id, name) values ('site', 'a.jpg'); raise exception 'FALHOU: não admin enviou foto'; exception when insufficient_privilege then raise notice 'OK: não admin não envia foto'; end $$;
reset role;

-- visitante: só a função
set role anon;
select pg_temp.c(public.site_conteudo_publicado()->'dados'->'campos'->>'h1' = 'Segunda', 'visitante lê a publicada');
do $$ begin perform 1 from public.site_publicacoes; raise exception 'FALHOU: visitante leu a tabela'; exception when insufficient_privilege then raise notice 'OK: visitante não lê a tabela'; end $$;
do $$ begin perform 1 from public.site_rascunho; raise exception 'FALHOU: visitante leu o rascunho'; exception when insufficient_privilege then raise notice 'OK: visitante não lê o rascunho'; end $$;
reset role;

-- tamanho máximo
do $$ begin insert into public.site_publicacoes (dados) values (jsonb_build_object('x', repeat('a', 300001))); raise exception 'FALHOU: aceitou conteúdo gigante'; exception when check_violation then raise notice 'OK: conteúdo gigante recusado'; end $$;

-- v48: data e autor só do banco; versão no ar = última gravada
set role authenticated;
select set_config('teste.admin', '1', false);
do $$ begin insert into public.site_publicacoes (dados, publicado_em) values ('{"campos":{"h1":"Futuro"}}', '2099-01-01'); raise exception 'FALHOU: aceitou data'; exception when insufficient_privilege then raise notice 'OK: data de publicação não vem do navegador'; end $$;
do $$ begin delete from public.site_rascunho; raise exception 'FALHOU: apagou rascunho'; exception when insufficient_privilege then raise notice 'OK: rascunho não se apaga'; end $$;
do $$ begin truncate public.site_publicacoes; raise exception 'FALHOU: truncate'; exception when insufficient_privilege then raise notice 'OK: histórico sem TRUNCATE'; end $$;
update public.site_rascunho set dados = '{"x":1}', atualizado_em = now() where id = 1;
insert into public.site_publicacoes (dados) values ('{"campos":{"h1":"Terceira"}}');
reset role;
update public.site_publicacoes set publicado_em = '2099-01-01' where observacao = 'v1';
select pg_temp.c(public.site_conteudo_publicado()->'dados'->'campos'->>'h1' = 'Terceira', 'no ar fica a última gravada, mesmo com data adulterada');
