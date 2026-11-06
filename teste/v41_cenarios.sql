-- Cenários do supabase/v41.sql (teste/teste_v41.sh). Para no primeiro que falhar.
\set ON_ERROR_STOP 1
create or replace function pg_temp.ok(c boolean, m text) returns void language plpgsql as $$
begin if c is not true then raise exception 'FALHOU: %', m; end if; end $$;
create or replace function pg_temp.erro(cmd text, trecho text) returns void language plpgsql as $$
begin
  begin execute cmd; exception when others then
    if sqlerrm ilike '%' || trecho || '%' then return; end if;
    raise exception 'FALHOU: esperava erro com "%", veio "%"', trecho, sqlerrm;
  end;
  raise exception 'FALHOU: esperava erro com "%" e passou', trecho;
end $$;
-- boletos completo (v28)
drop table public.boletos;
create table public.boletos (id uuid primary key default gen_random_uuid(), receber_id uuid, ordem_id uuid, os_numero text not null default '', cliente_id uuid,
  pagador_nome text not null default '', pagador_doc text not null default '', pagador jsonb not null default '{}', descricao text not null default '',
  valor numeric(12,2) not null check (valor > 0), vencimento date not null, emissao date not null default current_date,
  nosso_numero text not null unique check (nosso_numero ~ '^[0-9]{9}$'), seu_numero text not null default '', codigo_barras text not null default '',
  linha_digitavel text not null default '', situacao text not null default 'gerado', ocorrencia text not null default '', qr_url text not null default '',
  txid text not null default '', recibo_id uuid, criado_por text not null default '', criado_em timestamptz not null default now());
alter table public.clientes add column cep text not null default '';
insert into public.clientes (id, nome, codigo, doc, rua, bairro, cidade, uf, cep) values ('00000000-0000-0000-0000-0000000000c1', 'Granicap Granitos', 1, '', 'Fazenda Kirmse', 'Baunilha', 'Colatina', 'es', '29715-000');
insert into public.ordens (id, numero, status, cliente_id, cliente, veiculo, total)
values ('00000000-0000-0000-0000-000000000001', 1887, 'entregue', '00000000-0000-0000-0000-0000000000c1', '{"nome": "Granicap Granitos"}', '{"placa": "ABC1D23"}', 1000);

select null from pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'não está ligada');
update public.config set dados = dados || '{"cobranca": {"modo": "api", "ambiente": "producao", "especie": "05", "jurosMes": 2, "multa": 2, "desde": "2026-11-04"}}' where id = 1;
select null from pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'falta CPF/CNPJ');
update public.clientes set doc = '27.462.217/0003-31';
select null from pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'não tem parcela em aberto');

do $$
declare r jsonb; b jsonb;
begin
  -- parcela nova do saldo (prévia não deixa a parcela)
  r := public.agente_fazer('boleto_preparar', jsonb_build_object('numero', 1887, 'vencimento', (public.agente_hoje() + 30)::text, 'nf', '131'), false);
  perform pg_temp.ok((r->>'total')::numeric = 1000 and not exists (select 1 from public.receber), 'prévia: 1 boleto de 1000, sem gravar parcela');
  b := r->'boletos'->0;
  perform pg_temp.ok(b->'boleto'->>'mensagem' = 'REF. O.S. 1887 - NF 131' and b->'boleto'->'pagador'->>'uf' = 'ES' and b->'boleto'->'pagador'->>'cep' = '29715000'
    and b->'boleto'->>'especie' = '05' and (b->'boleto'->>'juros_mes')::numeric = 2 and b->>'seu_numero' = '1887-1', 'dados do boleto como a tela: ' || b::text);
  -- de verdade: cria a parcela; grava o boleto devolvido pelo banco
  r := public.agente_fazer('boleto_preparar', jsonb_build_object('numero', 1887, 'vencimento', (public.agente_hoje() + 30)::text, 'valor', 600), true);
  perform pg_temp.ok((select count(*) from public.receber where forma = 'Boleto' and valor = 600) = 1, 'parcela de 600 criada');
  b := (r->'boletos'->0) - 'boleto';
  r := public.agente_fazer('boleto_gravar', b || '{"nosso_numero": "260000011", "linha_digitavel": "74891", "qr_code": "000201abc"}', true);
  perform pg_temp.ok((select situacao from public.boletos where nosso_numero = '260000011') = 'registrado', 'boleto gravado');
  perform pg_temp.ok(exists (select 1 from public.eventos where texto like 'Boleto Sicredi registrado%'), 'histórico da O.S.');
  -- a parcela com boleto não entra de novo; o saldo restante (400) vira outra parcela
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'não tem parcela em aberto');
  r := public.agente_fazer('boleto_preparar', jsonb_build_object('numero', 1887, 'vencimento', (public.agente_hoje() + 60)::text), false);
  perform pg_temp.ok((r->>'total')::numeric = 400, 'saldo restante 400');
  -- parcela antiga (antes de 04/11) e vencida são recusadas
  insert into public.receber (ordem_id, valor, vencimento, forma, criado_em) values ('00000000-0000-0000-0000-000000000001', 50, public.agente_hoje() + 5, 'Boleto', '2026-11-01');
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'PicPay');
  update public.receber set criado_em = now(), vencimento = public.agente_hoje() - 1 where valor = 50;
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'venceu');
end $$;
\echo 'OK: v41 (todos os cenários)'
