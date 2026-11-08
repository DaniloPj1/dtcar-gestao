-- Cenários do supabase/v45.sql (aviso de contas a pagar no WhatsApp). Datas relativas a hoje em Brasília.
\set ON_ERROR_STOP 1
create or replace function pg_temp.confere(ok boolean, nome text) returns void language plpgsql as $$
begin if not coalesce(ok, false) then raise exception 'FALHOU: %', nome; end if; raise notice 'OK: %', nome; end $$;
create temp table h as select (now() at time zone 'America/Sao_Paulo')::date d;

-- 1) "amanhã" vai até o próximo dia útil
select pg_temp.confere(public.contas_aviso_ate('2026-11-13') = '2026-11-16', 'sexta 13/11 → até segunda 16/11');
select pg_temp.confere(public.contas_aviso_ate('2026-11-14') = '2026-11-16', 'sábado → até segunda');
select pg_temp.confere(public.contas_aviso_ate('2026-11-15') = '2026-11-16', 'domingo → segunda');
select pg_temp.confere(public.contas_aviso_ate('2026-11-10') = '2026-11-11', 'terça → quarta');
select pg_temp.confere(public.contas_aviso_reais(1234.5) = 'R$ 1.234,50', 'valor em reais');
select pg_temp.confere(public.contas_aviso_reais(0.07) = 'R$ 0,07', 'centavos');

-- 2) sem contas: nada sai
select pg_temp.confere(public.contas_aviso_texto('manha') is null, 'sem contas: sem texto');
select pg_temp.confere(public.contas_aviso_enviar('manha') is null and not exists (select 1 from public.zap_teste), 'sem contas: nada na fila');

-- 3) contas
insert into public.fornecedores (id, razao, fantasia) values ('00000000-0000-0000-0000-0000000000f1', 'Companhia Brasileira de Distribuição', 'CIA BRA');
insert into public.contas (descricao, favorecido, fornecedor_id, valor, vencimento, parcela, parcelas, status)
select x.* from h, lateral (values
  ('Peças', '', '00000000-0000-0000-0000-0000000000f1'::uuid, 320.00, h.d - 3, null::int, null::int, 'aberta'),
  ('Energia', 'Luz e Força Santa Maria', null, 691.64, h.d, null, null, 'aberta'),
  ('Peças CRZ', 'CRZ Peças', null, 226.66, h.d + 1, 3, 4, 'aberta'),
  ('Paga ontem', 'Já paga', null, 100, h.d - 1, null, null, 'paga'),
  ('Cancelada', 'Cancelada', null, 100, h.d, null, null, 'cancelada'),
  ('Longe', 'Daqui a 20 dias', null, 999, h.d + 20, null, null, 'aberta')) x(a, b, c, e, f, g, i, j);

select pg_temp.confere(t like '%Vencidas* — 1 · R$ 320,00%' and t like '%CIA BRA%', 'manhã: vencida com nome do fornecedor')
  from (select public.contas_aviso_texto('manha') t) z;
select pg_temp.confere(t like '%Vencem hoje* — 1 · R$ 691,64%' and t like '%Luz e Força%', 'manhã: vence hoje') from (select public.contas_aviso_texto('manha') t) z;
select pg_temp.confere(t like '%Vencem %CRZ Peças · parc. 3/4 · R$ 226,66%', 'manhã: vence amanhã com parcela') from (select public.contas_aviso_texto('manha') t) z;
select pg_temp.confere(t not like '%Já paga%' and t not like '%Cancelada%' and t not like '%Daqui a 20%', 'paga, cancelada e futura ficam fora')
  from (select public.contas_aviso_texto('manha') t) z;
select pg_temp.confere(t like '%Total: R$ 1.238,30*%', 'manhã: total') from (select public.contas_aviso_texto('manha') t) z;
select pg_temp.confere(t not like '%CRZ%' and t like '%Total: R$ 1.011,64*%', 'tarde: sem as de amanhã') from (select public.contas_aviso_texto('tarde') t) z;

-- 4) envio pelo agendamento (sem login), uma vez por turno
select pg_temp.confere(public.contas_aviso_enviar('manha') is not null, 'manhã: entrou na fila');
select pg_temp.confere(public.contas_aviso_enviar('manha') is null and (select count(*) from public.zap_teste) = 1, 'manhã: não repete no mesmo dia');
select pg_temp.confere(public.contas_aviso_enviar('manha', true) is not null, 'forçar manda de novo');
select pg_temp.confere((select count(*) from public.zap_teste) = 2, 'duas mensagens na fila');
select pg_temp.confere((select contas from public.contas_avisos where turno = 'manha') = 3, 'registro com 3 contas');

-- 5) tarde: deu baixa em tudo o que venceu → nada sai
update public.contas set status = 'paga' where vencimento <= (select d from h) and status = 'aberta';
select pg_temp.confere(public.contas_aviso_enviar('tarde') is null and (select count(*) from public.zap_teste) = 2, 'tarde: tudo baixado, sem aviso');
select pg_temp.confere(public.contas_aviso_texto('manha') like '%CRZ%' and public.contas_aviso_texto('manha') not like '%Vencidas%', 'só a de amanhã continua na manhã');

-- 6) sem número de alerta: nada sai e não quebra
update public.whatsapp_conexao set alerta_telefone = '';
select pg_temp.confere(public.contas_aviso_enviar('manha', true) is null, 'sem número de alerta: sem fila');
update public.whatsapp_conexao set alerta_telefone = '5527997696545';

-- 7) login que não é administrador é recusado
set teste.uid = '00000000-0000-0000-0000-00000000000b'; set teste.admin = '0';
do $$ begin perform public.contas_aviso_texto('manha'); raise exception 'FALHOU: não-admin leu'; exception when others then
  if sqlerrm like 'FALHOU%' then raise; end if; raise notice 'OK: não-admin recusado (%)', sqlerrm; end $$;
reset teste.uid; reset teste.admin;

-- 8) agendamentos
select pg_temp.confere((select count(*) from cron.job where jobname like 'dtcar-contas-aviso-%') = 2
  and (select schedule from cron.job where jobname = 'dtcar-contas-aviso-09h') = '0 12 * * *'
  and (select schedule from cron.job where jobname = 'dtcar-contas-aviso-16h') = '0 19 * * *', 'agendamentos 09h e 16h de Brasília');

-- 9) mais de 10 contas no grupo: corta com "e mais"
insert into public.contas (descricao, favorecido, valor, vencimento) select 'X', 'Conta ' || g, 10, (select d from h) - 1 from generate_series(1, 13) g;
select pg_temp.confere(t like '%Vencidas* — 13 ·%' and t like '%… e mais 3 conta(s)%', 'grupo grande cortado em 10') from (select public.contas_aviso_texto('tarde') t) z;
\echo '--- exemplo da mensagem (manhã) ---'
select public.contas_aviso_texto('manha');
