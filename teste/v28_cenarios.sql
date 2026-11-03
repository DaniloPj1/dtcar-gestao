-- Cenários do v28 (saída comparada com teste/v28_esperado.txt)
\pset format unaligned
\pset tuples_only on
select 'nn1', public.cobranca_proximo('nosso_numero:2026');
select 'nn2', public.cobranca_proximo('nosso_numero:2026');
select 'outro ano', public.cobranca_proximo('nosso_numero:2027');
select 'remessa1', public.cobranca_proximo('remessa');
-- boleto gravado com número maior (ex.: backup restaurado): a sequência pula para depois dele
insert into public.boletos (valor, vencimento, nosso_numero) values (10, '2026-12-01', '262000417');
select 'depois do 41', public.cobranca_proximo('nosso_numero:2026');
insert into public.boletos_arquivos (tipo, sequencia) values ('remessa', 9);
select 'remessa depois da 9', public.cobranca_proximo('remessa');
-- nosso número repetido é recusado
do $$ begin insert into public.boletos (valor, vencimento, nosso_numero) values (10, '2026-12-01', '262000417'); raise notice 'ERRO: aceitou repetido';
exception when unique_violation then raise notice 'ok'; end $$;
select 'repetido recusado', count(*) from public.boletos where nosso_numero = '262000417';
-- retorno com o mesmo hash não entra duas vezes
insert into public.boletos_arquivos (tipo, hash) values ('retorno', 'abc');
do $$ begin insert into public.boletos_arquivos (tipo, hash) values ('retorno', 'abc'); exception when unique_violation then null; end $$;
select 'retorno unico', count(*) from public.boletos_arquivos where hash = 'abc';
-- sem permissão de gestor não emite
update public.papel_teste set gestor = false;
do $$ begin perform public.cobranca_proximo('remessa'); raise notice 'ERRO'; exception when others then null; end $$;
select 'sem permissao', valor from public.cobranca_contadores where chave = 'remessa';
update public.papel_teste set gestor = true;
-- chave desconhecida
do $$ begin perform public.cobranca_proximo('qualquer'); exception when others then raise notice 'ok'; end $$;
select 'restaurar aceita boletos', position('''boletos''' in pg_get_functiondef('public.restaurar_tabela(text, jsonb)'::regprocedure)) > 0;
