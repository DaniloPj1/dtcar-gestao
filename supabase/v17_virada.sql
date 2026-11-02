-- =====================================================================
-- DTCar Gestão — v17: virada definitiva (backup BACKUP_OSOFICINA3.0_000123, 02/11/2026)
--
-- Rode UMA VEZ, no SQL Editor do Supabase, LOGO DEPOIS da última carga do
-- OS Oficina (modo espelho) e ANTES de lançar qualquer coisa nova.
-- Se rodar de novo, não duplica nada (O.S. já ajustadas são puladas).
-- Se qualquer O.S. não estiver como no backup 000123, NADA é gravado
-- e aparece o erro com o número da O.S.
--
-- 1. Regra nova: O.S. do sistema antigo marcada "a receber" NÃO conta como paga
--    (até a v16, toda O.S. entregue do OS Oficina era tratada como quitada).
-- 2. Acerta as 42 O.S. abertas do OS Oficina conforme o Danilo informou em 02/11:
--    - "desconto" que era entrada já recebida vira recibo de entrada (data da abertura)
--      e o valor da O.S. volta a ser o valor cheio;
--    - entregues aguardando pagamento ficam "Entregue · a receber" com as parcelas
--      (vencimentos provisórios marcados na observação da parcela);
--    - etapas: em execução, aguardando pagamento no pátio, fechada, excluída.
-- 3. Numeração das vendas de balcão continua a partir da 419 do OS Oficina.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Regra de pagamento das O.S. do sistema antigo
-- ---------------------------------------------------------------------
create or replace function public.ordens_situacao_pagamento() returns trigger language plpgsql as $$
begin
  if new.status = 'entregue' and new.checkin->'legado' is not null
     and coalesce((new.checkin->'legado'->>'a_receber')::boolean, false) = false then
    new.finalizada_em := coalesce(new.finalizada_em, new.entregue_em, now());
  elsif new.status = 'entregue' and new.recebido >= new.total - 0.009 then
    new.finalizada_em := coalesce(new.finalizada_em, now());
  else
    new.finalizada_em := null;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 2. Ajuste das O.S. abertas herdadas
-- acao: receber (entregue, a receber) | execucao | pronto (aguardando pagamento no pátio)
--       | fechar | excluir | manter
-- total_antes / desc_antes: como a O.S. veio do backup (conferência)
-- entrada: parte do "desconto" que era dinheiro já recebido (vira recibo)
-- venc: vencimentos das parcelas do saldo (dias depois da abertura, ou datas fixas)
-- ---------------------------------------------------------------------
drop table if exists virada_mapa;
create temp table virada_mapa (numero int primary key, acao text, total_antes numeric, desc_antes numeric, entrada numeric, remover_pecas boolean,
  dias int[], datas date[], forma text, nota text);
insert into virada_mapa values
  -- Marbrasa: boletos, vencimento provisório 30 dias da abertura
  (1745, 'receber', 1500.00, 3854.84, 3854.84, false, '{30}', null, 'Boleto', 'Marbrasa: vencimento provisório (30 dias da abertura); confirmar pelo boleto.'),
  (1770, 'receber', 1995.00,    0.00,    0.00, false, '{30}', null, 'Boleto', 'Marbrasa: vencimento provisório (30 dias da abertura); confirmar pelo boleto.'),
  (1823, 'receber', 1735.95, 3735.95, 3735.95, false, '{30}', null, 'Boleto', 'Marbrasa: vencimento provisório (30 dias da abertura); confirmar pelo boleto.'),
  (1865, 'receber', 2105.41,    0.00,    0.00, false, '{30}', null, 'Boleto', 'Marbrasa: vencimento provisório (30 dias da abertura); confirmar pelo boleto.'),
  (1873, 'receber',  710.00,    0.00,    0.00, false, '{30}', null, 'Boleto', 'Marbrasa: vencimento provisório (30 dias da abertura); confirmar pelo boleto.'),
  (1874, 'receber', 2160.35,    0.00,    0.00, false, '{30}', null, 'Boleto', 'Marbrasa: vencimento provisório (30 dias da abertura); confirmar pelo boleto.'),
  (1892, 'receber', 1660.00,    0.00,    0.00, false, '{30}', null, 'Boleto', 'Marbrasa: vencimento provisório (30 dias da abertura); confirmar pelo boleto.'),
  -- Granicap: 2 boletos de 15 dias (provisório: contado da abertura). 1843: 1ª parcela já recebida
  (1843, 'receber',  858.70,  895.30,  895.30, false, '{30}', null, 'Boleto', 'Granicap: 2ª parcela (a 1ª entrou como entrada); vencimento provisório.'),
  (1887, 'receber', 5235.50,  328.43,    0.00, false, '{15,30}', null, 'Boleto', 'Granicap: 2 boletos de 15 dias; vencimentos provisórios (contados da abertura). Desconto de R$ 328,43 mantido.'),
  -- Tadeu Veículos e Ministério Vale do Rio Doce: pagamento nesta semana
  (1868, 'receber',  150.00,    0.00,    0.00, false, null, '{2026-11-06}', '', 'Pagamento combinado para esta semana (data provisória).'),
  (1869, 'receber', 2525.00,    0.00,    0.00, false, null, '{2026-11-06}', '', 'Pagamento combinado para esta semana (data provisória).'),
  (1897, 'receber', 2592.73,    0.00,    0.00, false, null, '{2026-11-06}', '', 'Pagamento combinado para esta semana (data provisória).'),
  -- 20 dias contados da abertura
  (1841, 'receber',  301.20,    0.00,    0.00, false, '{20}', null, '', 'Pagamento em 20 dias da abertura.'),
  (1866, 'receber',  100.00,    0.00,    0.00, false, '{20}', null, '', 'Pagamento em 20 dias da abertura.'),
  (1871, 'receber',  400.00,    0.00,    0.00, false, '{20}', null, '', 'Pagamento em 20 dias da abertura.'),
  (1894, 'receber', 1719.80,    0.00,    0.00, false, '{20}', null, '', 'Pagamento em 20 dias da abertura.'),
  (1886, 'receber',  373.14,    0.00,    0.00, false, '{20}', null, '', 'Pagamento em 20 dias da abertura.'),
  (1881, 'receber',  348.00,    0.00,    0.00, false, '{20}', null, '', 'Pagamento em 20 dias da abertura.'),
  (1847, 'receber', 5908.97,    0.00,    0.00, false, '{20}', null, '', 'Entregue aguardando pagamento; vencimento provisório (20 dias da abertura).'),
  (1893, 'receber',  784.00,    0.00,    0.00, false, '{20}', null, '', 'Entregue aguardando pagamento; vencimento provisório (20 dias da abertura).'),
  -- desconto = entrada já recebida; serviço entregue aguardando o restante (vencimento provisório: hoje)
  (1031, 'receber', 1210.00, 1200.00, 1200.00, false, null, '{2026-11-02}', '', 'Entrada recebida; saldo com vencimento provisório.'),
  (1678, 'receber', 13971.70, 25000.00, 25000.00, false, null, '{2026-11-02}', '', 'Entrada recebida; saldo com vencimento provisório.'),
  (1766, 'receber',  280.00,  450.00,  450.00, false, null, '{2026-11-02}', '', 'Entrada recebida; saldo com vencimento provisório.'),
  (1782, 'receber', 3867.32, 4000.00, 4000.00, false, null, '{2026-11-02}', '', 'Entrada recebida; saldo com vencimento provisório.'),
  (1816, 'receber',  919.70,  600.00,  600.00, false, null, '{2026-11-02}', '', 'Entrada recebida; saldo com vencimento provisório.'),
  -- etapas informadas pelo Danilo
  (894,  'execucao', 2232.40,   0.00, 0.00, false, null, null, '', 'Serviço parado no pátio.'),
  (1767, 'execucao', 2661.33,   0.00, 0.00, false, null, null, '', 'Serviço parado no pátio.'),
  (1850, 'execucao', 4615.84,   0.00, 0.00, false, null, null, '', 'Serviço em execução.'),
  (1854, 'execucao', 12985.40,  0.00, 0.00, false, null, null, '', 'Serviço em execução.'),
  (1827, 'execucao', 26991.83, 1480.72, 0.00, false, null, null, '', 'Serviço em execução. Desconto de R$ 1.480,72 mantido.'),
  (1789, 'pronto',   2588.00,   0.00, 0.00, false, null, null, '', 'Serviço concluído, veículo no pátio aguardando pagamento.'),
  (1819, 'pronto',   4092.60,   0.00, 0.00, false, null, null, '', 'Serviço concluído, veículo no pátio aguardando pagamento.'),
  (1862, 'pronto',   3474.00,   0.00, 0.00, false, null, null, '', 'Serviço concluído, veículo no pátio aguardando pagamento.'),
  (1884, 'pronto',    600.00, 3640.00, 0.00, true,  null, null, '', 'Peças retiradas a pedido do Danilo; fica só o serviço de R$ 600,00. Veículo no pátio aguardando pagamento.'),
  (1899, 'pronto',      0.00, 2023.00, 2023.00, false, null, null, '', 'Recebida integralmente. Corrigir o cadastro do cliente e do veículo e depois entregar para fechar.'),
  (1783, 'fechar',    280.00,   0.00, 0.00, false, null, null, '', 'Fechada na virada a pedido do Danilo.'),
  (1764, 'excluir',     0.00, 3831.80, 0.00, false, null, null, '', 'Orçamento excluído na virada.'),
  (1859, 'excluir',     0.00, 3793.70, 0.00, false, null, null, '', 'Orçamento excluído na virada.'),
  (1898, 'manter',   5077.00,   0.00, 0.00, false, null, null, '', ''),
  (1889, 'manter',    827.00,   0.00, 0.00, false, null, null, '', ''),
  (1902, 'manter',      0.00,   0.00, 0.00, false, null, null, '', ''),
  (1903, 'manter',      0.00,   0.00, 0.00, false, null, null, '', '');

do $$
declare
  m record; o record; novo_desc numeric; novo_total numeric; saldo numeric; venc date[]; n int; k int; v numeric; acum numeric;
  nome text; st text; feitos int := 0; pulados int := 0; rec_id uuid;
begin
  perform set_config('dtcar.sem_estoque', '1', true); -- O.S. do sistema antigo não mexem no estoque
  -- conferência: as 42 O.S. abertas do backup são exatamente as do mapa
  if (select count(*) from virada_mapa) <> 42 then raise exception 'Mapa da virada incompleto.'; end if;

  for m in select * from virada_mapa order by numero loop
    select * into o from public.ordens where numero = m.numero;
    if not found then
      if m.acao = 'excluir' then pulados := pulados + 1; continue; end if;
      raise exception 'O.S. % não encontrada. Rode a carga do backup 000123 antes deste ajuste.', m.numero;
    end if;
    if o.checkin->'legado' is null then raise exception 'O.S. % não veio do OS Oficina. Ajuste cancelado.', m.numero; end if;
    if o.status not in ('diagnostico', 'aguardando') or m.acao = 'manter' then pulados := pulados + 1; continue; end if; -- já ajustada
    if abs(o.total - m.total_antes) > 0.009 or abs(o.desconto - m.desc_antes) > 0.009 then
      raise exception 'O.S. % está diferente do backup 000123 (total %, desconto %). Ajuste cancelado.', m.numero, o.total, o.desconto;
    end if;
    nome := coalesce(nullif(o.cliente->>'nome', ''), 'Cliente');

    if m.acao = 'excluir' then
      delete from public.ordens where id = o.id;
      feitos := feitos + 1; continue;
    end if;

    if m.remover_pecas then delete from public.os_itens where ordem_id = o.id and tipo = 'peca'; end if;
    novo_desc := case when m.remover_pecas then 0 else o.desconto - m.entrada end;
    select coalesce(sum(round(qtd * valor_unit - desconto, 2)), 0) into novo_total from public.os_itens where ordem_id = o.id and aprovado is distinct from false;
    novo_total := greatest(0, novo_total - novo_desc);
    if abs(novo_total - (case when m.remover_pecas then 600 else m.total_antes + m.entrada end)) > 0.009 then
      raise exception 'O.S. %: o valor recalculado (%) não confere. Ajuste cancelado.', m.numero, novo_total;
    end if;

    st := case m.acao when 'receber' then 'entregue' when 'fechar' then 'entregue' else m.acao end;
    update public.os_itens set aprovado = true, executado = (st in ('pronto', 'entregue')) where ordem_id = o.id;
    update public.ordens set
      status = st,
      desconto = novo_desc,
      total = novo_total,
      aprovacao = coalesce(aprovacao, jsonb_build_object('em', criado_em, 'por', nome, 'forma', 'Sistema anterior', 'obs', 'Registrada na virada (02/11/2026)', 'assinatura', '')),
      entregue_em = case when st = 'entregue' then coalesce(entregue_em, criado_em) else null end,
      estoque_baixado = false,
      checkin = case when m.acao = 'receber' then jsonb_set(checkin, '{legado,a_receber}', 'true'::jsonb) else checkin end,
      obs_internas = trim(both E'\n' from obs_internas || E'\n' || 'Virada 02/11/2026: ' || m.nota),
      atualizado_em = now()
    where id = o.id;

    -- entrada que estava como desconto vira recibo
    if m.entrada > 0 then
      insert into public.recibos (ordem_id, cliente_id, pagador, doc, valor, referente, forma, data, obs, emitido_por)
      values (o.id, o.cliente_id, nome, coalesce(o.cliente->>'doc', ''), m.entrada,
              'Entrada da O.S. ' || lpad(o.numero::text, 6, '0') || ' (lançada como desconto no OS Oficina)', '', o.criado_em::date,
              'Recibo criado na virada (02/11/2026) a partir do desconto do OS Oficina.', 'Virada')
      returning id into rec_id;
    end if;

    -- parcelas do saldo
    if m.acao = 'receber' then
      saldo := novo_total - m.entrada;
      venc := coalesce(m.datas, (select array_agg((o.criado_em::date + d) order by d) from unnest(m.dias) d));
      n := array_length(venc, 1); acum := 0;
      if saldo > 0.009 then
        for k in 1..n loop
          v := case when k < n then round(saldo / n, 2) else saldo - acum end; acum := acum + v;
          insert into public.receber (ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento, obs, criado_por)
          values (o.id, o.cliente_id, nome, 'O.S. ' || lpad(o.numero::text, 6, '0') || ' · ' || coalesce(o.veiculo->>'placa', ''), m.forma,
                  case when m.numero = 1843 then 2 else k end, case when m.numero = 1843 then 2 else n end, v, venc[k], m.nota, 'Virada');
        end loop;
      end if;
    end if;

    insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
    values (o.id, 'virada', 'Virada 02/11/2026: ' || m.nota, 'Virada');
    feitos := feitos + 1;
  end loop;
  raise notice 'Virada: % O.S. ajustadas, % sem mudança ou já ajustadas.', feitos, pulados;
end $$;

-- ---------------------------------------------------------------------
-- 3. Vendas de balcão continuam a numeração do OS Oficina (última: 419)
-- ---------------------------------------------------------------------
select setval('public.vendas_numero_seq', greatest(419, (select coalesce(max(numero), 0) from public.vendas)));

-- Conferência (aparece no resultado)
select
  (select count(*) from public.ordens where status in ('diagnostico', 'aguardando')) as orcamentos,
  (select count(*) from public.ordens where status = 'execucao') as em_execucao,
  (select count(*) from public.ordens where status = 'pronto') as aguardando_pagto_patio,
  (select count(*) from public.ordens where status = 'entregue' and finalizada_em is null) as entregues_a_receber,
  (select sum(valor) from public.receber where status = 'aberta') as total_a_receber,
  (select sum(valor) from public.recibos where emitido_por = 'Virada') as entradas_recebidas,
  (select max(numero) from public.ordens) as ultima_os;
