-- Cenários do supabase/v33.sql, parte do e-mail (em cima do v29): o histórico guarda o nome dos anexos.
\set ON_ERROR_STOP 1
create or replace function pg_temp.confere(cond boolean, msg text) returns void language plpgsql as $$
begin if not coalesce(cond, false) then raise exception 'FALHOU: %', msg; end if; raise notice 'ok: %', msg; end $$;
insert into public.perfis (id, nome, papel) values ('00000000-0000-0000-0000-00000000000a', 'Danilo', 'admin') on conflict do nothing;
set role authenticated;
set dtcar.uid = '00000000-0000-0000-0000-00000000000a';
select public.email_registrar_envio('{"tipo":"enviar","para":"cliente@x.com","assunto":"O.S. 1887","texto":"Segue.","anexos":"OS_01887_ABC1D23.pdf, NF 131.pdf","pedido":"manda a OS"}');
select pg_temp.confere((select anexos from email_envios order by id desc limit 1) = 'OS_01887_ABC1D23.pdf, NF 131.pdf', 'histórico do e-mail guarda o nome dos anexos');
reset role;
select pg_temp.confere((select depois->>'anexos' from agente_acoes where ferramenta = 'email_enviar' order by em desc limit 1) = 'OS_01887_ABC1D23.pdf, NF 131.pdf', 'histórico do agente também');
set role authenticated;
select public.email_registrar_envio('{"tipo":"responder","para":"a@x.com","assunto":"RE: x","texto":"ok"}');
select pg_temp.confere((select anexos from email_envios order by id desc limit 1) = '', 'sem anexo continua funcionando');
reset role;
