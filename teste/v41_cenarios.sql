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
alter table public.clientes add column cep text not null default '';
insert into public.clientes (id, nome, codigo, doc, rua, bairro, cidade, uf, cep) values ('00000000-0000-0000-0000-0000000000c1', 'Granicap Granitos', 1, '', 'Fazenda Kirmse', 'Baunilha', 'Colatina', 'es', '29715-000');
insert into public.ordens (id, numero, status, cliente_id, cliente, veiculo, total)
values ('00000000-0000-0000-0000-000000000001', 1887, 'entregue', '00000000-0000-0000-0000-0000000000c1', '{"nome": "Granicap Granitos"}', '{"placa": "ABC1D23"}', 1000);

select null from pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'não está ligada');
update public.config set dados = dados || '{"cobranca": {"modo": "api", "ambiente": "producao", "especie": "05", "jurosMes": 2, "multa": 2, "desde": "2026-11-04"}}' where id = 1;
select null from pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'falta CPF/CNPJ');
update public.clientes set doc = '27.462.217/0003-31';
select null from pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'em aberto sem boleto');

do $$
declare r jsonb; b jsonb; v_par uuid;
begin
  -- parcela nova do saldo (prévia não deixa parcela nem reserva)
  r := public.agente_fazer('boleto_preparar', jsonb_build_object('numero', 1887, 'vencimento', (public.agente_hoje() + 30)::text, 'nf', '131'), false);
  perform pg_temp.ok((r->>'total')::numeric = 1000 and not exists (select 1 from public.receber) and not exists (select 1 from public.boletos), 'prévia: 1 boleto de 1000, nada gravado');
  b := r->'boletos'->0;
  perform pg_temp.ok(b->'boleto'->>'mensagem' = 'REF. O.S. 1887 - NF 131' and b->'boleto'->'pagador'->>'uf' = 'ES' and b->'boleto'->'pagador'->>'cep' = '29715000'
    and b->'boleto'->>'especie' = '05' and (b->'boleto'->>'juros_mes')::numeric = 2 and b->'boleto'->>'seu_numero' = '1887-1', 'dados do boleto como a tela: ' || b::text);
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887, "valor": 50}', false)$c$, 'Valor sem vencimento');
  perform pg_temp.erro(format($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887, "vencimento": "%s", "valor": 1500}', false)$c$, public.agente_hoje() + 30), 'até o saldo');
  -- de verdade: cria a parcela e a reserva ("aguardando o banco") antes do Sicredi
  r := public.agente_fazer('boleto_preparar', jsonb_build_object('numero', 1887, 'vencimento', (public.agente_hoje() + 30)::text, 'valor', 600), true);
  b := r->'boletos'->0;
  perform pg_temp.ok((select count(*) from public.receber where forma = 'Boleto' and valor = 600) = 1, 'parcela de 600 criada');
  perform pg_temp.ok((select situacao = 'gerado' and nosso_numero like '000%' from public.boletos where id = (b->>'reserva_id')::uuid), 'reserva gravada');
  -- reservada: outra emissão não pega a mesma parcela
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'sem boleto');
  r := public.agente_fazer('boleto_gravar', jsonb_build_object('reserva_id', b->>'reserva_id', 'nosso_numero', '260000011', 'linha_digitavel', '74891', 'qr_code', '000201abc'), true);
  perform pg_temp.ok((select situacao from public.boletos where nosso_numero = '260000011') = 'registrado', 'reserva virou o boleto registrado');
  perform pg_temp.erro(format($c$select public.agente_fazer('boleto_gravar', '{"reserva_id": "%s", "nosso_numero": "260000012"}', true)$c$, b->>'reserva_id'), 'não encontrada');
  perform pg_temp.ok(exists (select 1 from public.eventos where texto like 'Boleto Sicredi registrado%'), 'histórico da O.S.');
  -- o banco recusou: reserva e parcela criada saem
  r := public.agente_fazer('boleto_preparar', jsonb_build_object('numero', 1887, 'vencimento', (public.agente_hoje() + 60)::text), true);
  perform pg_temp.ok((r->>'total')::numeric = 400, 'saldo restante 400');
  r := public.agente_fazer('boleto_desfazer', jsonb_build_object('reservas', jsonb_build_array(r->'boletos'->0->>'reserva_id'), 'parcela_criada', r->>'parcela_criada', 'motivo', 'CEP inválido'), true);
  perform pg_temp.ok((r->>'reservas_desfeitas')::int = 1 and (r->>'parcela_apagada')::boolean and (select count(*) from public.receber) = 1, 'desfeito: só a parcela de 600 continua');
  -- parcela Pix na mesma data não entra; Cartão só com parcela=N
  insert into public.receber (ordem_id, valor, vencimento, forma, parcela, parcelas) values ('00000000-0000-0000-0000-000000000001', 100, public.agente_hoje() + 60, 'PIX', 2, 2);
  r := public.agente_fazer('boleto_preparar', jsonb_build_object('numero', 1887, 'vencimento', (public.agente_hoje() + 60)::text), false);
  perform pg_temp.ok(jsonb_array_length(r->'boletos') = 1 and (r->>'total')::numeric = 300, 'só a parcela nova (300), não a Pix do mesmo dia');
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'sem boleto');
  r := public.agente_fazer('boleto_preparar', '{"numero": 1887, "parcela": 2}', false);
  perform pg_temp.ok((r->>'total')::numeric = 100 and r->'avisos'->>0 like '%passa para Boleto%', 'parcela=2 (Pix) vira boleto com aviso');
  -- antiga (antes de 04/11) fica de fora com aviso; escolhida, é recusada
  update public.receber set forma = 'Boleto', criado_em = '2026-11-01' where valor = 100;
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887}', false)$c$, 'PicPay');
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887, "parcela": 2}', false)$c$, 'PicPay');
  update public.receber set criado_em = now(), vencimento = public.agente_hoje() - 1 where valor = 100;
  perform pg_temp.erro($c$select public.agente_fazer('boleto_preparar', '{"numero": 1887, "parcela": 2}', false)$c$, 'venceu');
  -- índice: um boleto ativo por parcela
  select receber_id into v_par from public.boletos where nosso_numero = '260000011';
  perform pg_temp.erro(format($c$insert into public.boletos (receber_id, valor, vencimento, nosso_numero, situacao) values ('%s', 1, current_date, '000999999', 'gerado')$c$, v_par), 'duplicate key');
end $$;
\echo 'OK: v41 (todos os cenários)'
