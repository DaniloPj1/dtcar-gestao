-- =====================================================================
-- DTCar Gestão — v37: receber O.S. pelo conector do Claude (05/11/2026)
--
-- Pedido do Danilo: "o cliente pagou, dá baixa e finaliza" direto pelo conector.
-- Função agente_receber_os: faz no banco, numa transação só, o mesmo que o botão
-- "Receber e finalizar" da O.S. entregue faz na tela (js/telas/acoesos.js):
--   1. emite o recibo (forma, conta de entrada, data);
--   2. abate as parcelas a receber abertas da O.S., da mais antiga para a mais nova
--      (pagamento parcial divide a parcela, como baixarParcela em js/telas/receber.js);
--   3. o gatilho recibos_recalcula (v12) soma o recebido e, quitando o total da O.S.
--      entregue, ela vira "Fechada" sozinha.
-- Só para O.S. "Entregue · a receber" (a entrega pede o KM de saída e fica na tela).
-- Prévia com p_gravar=false; grava com true. Exige administrador. Histórico em
-- eventos e agente_acoes. Nada é apagado; desfazer = cancelar o recibo na tela.
-- Pode rodar mais de uma vez.
-- =====================================================================

create or replace function public.agente_receber_os(p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.ordens; cfg jsonb; v_perfil public.perfis; v_doc text := '';
  v_formas text[]; v_contas text[]; v_forma text; v_conta text; v_data date; v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_recebido numeric; v_falta numeric; v_valor numeric; v_resta numeric; v_parte numeric; v_quita boolean;
  v_rec public.recibos; pa public.receber; v_parcelas jsonb := '[]'; v_abertas numeric := 0;
  erros text[] := '{}'; avisos text[] := '{}'; v_res jsonb; v_ref text; v_veic text;
  v_repetido boolean := coalesce((p->>'receber_mesmo_repetido')::boolean, false);
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
  -- trava a O.S.: dois recebimentos juntos da mesma O.S. não leem o mesmo saldo
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1 for update;
  if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;

  select dados into cfg from public.config where id = 1;
  v_formas := coalesce((select array_agg(x) from jsonb_array_elements_text(cfg->'formasPagamento') x),
                       array['PIX', 'Dinheiro', 'Cartão de débito', 'Cartão de crédito', 'Boleto']);
  v_contas := coalesce((select array_agg(c->>'nome') from jsonb_array_elements(coalesce(cfg->'contasFinanceiras', '[]'::jsonb)) c where coalesce(c->>'nome', '') <> ''),
                       array['Sicredi', 'PicPay PJ', 'Espécie']);

  -- forma: a mesma lista da tela (Ajustes), sem diferença de maiúscula/acento
  select f into v_forma from unnest(v_formas) f where lower(public.unaccent_simples(f)) = lower(public.unaccent_simples(trim(coalesce(p->>'forma', '')))) limit 1;
  if v_forma is null then
    erros := array_append(erros, 'Forma de pagamento "' || coalesce(p->>'forma', '') || '" não existe. Use uma destas: ' || array_to_string(v_formas, ', ') || '.');
  end if;

  -- conta de entrada: a informada ou a sugestão da tela (contaSugerida em js/regras.js)
  if coalesce(trim(p->>'conta'), '') <> '' then
    select c into v_conta from unnest(v_contas) c where lower(public.unaccent_simples(c)) = lower(public.unaccent_simples(trim(p->>'conta'))) limit 1;
    if v_conta is null then erros := array_append(erros, 'Conta "' || (p->>'conta') || '" não existe. Contas: ' || array_to_string(v_contas, ', ') || '.'); end if;
  elsif v_forma is not null then
    if v_forma ~* 'dinheiro' then
      select c into v_conta from unnest(v_contas) c where c ~* '(esp[eé]cie|caixa|dinheiro)' limit 1;
    end if;
    if v_conta is null then
      v_conta := case when coalesce(cfg->>'contaRecebimento', '') = any (v_contas) then cfg->>'contaRecebimento'
                      else coalesce((select c from unnest(v_contas) c where c !~* '(esp[eé]cie|caixa|dinheiro)' limit 1), v_contas[1]) end;
    end if;
  end if;

  -- data do pagamento: hoje (Brasília) se não vier; nunca no futuro
  begin
    v_data := coalesce(nullif(trim(p->>'data'), '')::date, v_hoje);
  exception when others then erros := array_append(erros, 'Data inválida (use AAAA-MM-DD).'); v_data := v_hoje;
  end;
  if v_data > v_hoje then erros := array_append(erros, 'A data do pagamento não pode ser no futuro.'); end if;

  -- etapa: só "Entregue · a receber"
  if o.status = 'pronto' then
    erros := array_append(erros, 'A O.S. ' || o.numero || ' ainda está no pátio (aguardando pagamento, veículo não entregue). Entregue pela tela (pede o KM de saída) e depois receba.');
  elsif o.status <> 'entregue' then
    erros := array_append(erros, 'A O.S. ' || o.numero || ' está "' || public.agente_etapa(o) || '": só dá para receber O.S. entregue a receber.');
  elsif o.finalizada_em is not null then
    erros := array_append(erros, 'A O.S. ' || o.numero || ' já está fechada (paga).');
  end if;

  select coalesce(sum(valor), 0) into v_recebido from public.recibos where ordem_id = o.id and not cancelado;
  v_falta := round(greatest(0, coalesce(o.total, 0) - v_recebido), 2);
  if o.status = 'entregue' and o.finalizada_em is null and v_falta <= 0.009 then
    erros := array_append(erros, 'A O.S. ' || o.numero || ' não tem saldo a receber.');
  end if;

  -- valor: o que falta, se não vier; nunca mais que o saldo
  if p ? 'valor' and p->'valor' <> 'null'::jsonb then
    if jsonb_typeof(p->'valor') <> 'number' or (p->>'valor')::numeric <= 0 then
      erros := array_append(erros, 'Valor inválido.'); v_valor := 0;
    else v_valor := round((p->>'valor')::numeric, 2); end if;
  else v_valor := v_falta; end if;
  if v_valor > v_falta + 0.009 and v_falta > 0.009 then
    erros := array_append(erros, 'O valor (' || public.agente_reais(v_valor) || ') é maior que o saldo de ' || public.agente_reais(v_falta) || '.');
  end if;
  v_quita := v_valor >= v_falta - 0.009;
  if not v_quita and v_valor > 0 then avisos := array_append(avisos, 'Pagamento parcial: a O.S. continua a receber ' || public.agente_reais(v_falta - v_valor) || '.'); end if;

  -- recibo repetido: mesma O.S. e mesmo valor nos últimos 10 minutos
  if exists (select 1 from public.recibos r where r.ordem_id = o.id and not r.cancelado and r.valor = v_valor and r.criado_em > now() - interval '10 minutes') then
    if v_repetido then avisos := array_append(avisos, 'Já havia um recibo igual nos últimos 10 minutos (confirmado lançar de novo).');
    else erros := array_append(erros, 'Já foi lançado um recibo de ' || public.agente_reais(v_valor) || ' para esta O.S. há menos de 10 minutos. Lançar de novo mesmo assim?'); end if;
  end if;

  -- parcelas a receber que o pagamento vai baixar (da mais antiga para a mais nova)
  v_resta := v_valor;
  for pa in select * from public.receber where ordem_id = o.id and status = 'aberta' order by vencimento, parcela, id loop
    v_abertas := v_abertas + pa.valor;
    if v_resta > 0.009 then
      v_parte := least(v_resta, pa.valor);
      v_parcelas := v_parcelas || jsonb_build_array(jsonb_build_object('parcela', pa.parcela || '/' || pa.parcelas, 'vencimento', pa.vencimento,
        'valor', pa.valor, 'baixa', v_parte, 'fica_em_aberto', round(pa.valor - v_parte, 2)));
      v_resta := round(v_resta - v_parte, 2);
    end if;
  end loop;

  v_veic := nullif(trim(concat_ws(' ', o.veiculo->>'marca', o.veiculo->>'modelo')), '');
  v_res := jsonb_build_object('os', o.numero, 'id', o.id, 'etapa', public.agente_etapa(o), 'cliente', o.cliente->>'nome',
    'placa', o.veiculo->>'placa', 'veiculo', v_veic, 'total_os', o.total, 'ja_recebido', v_recebido, 'falta_receber', v_falta,
    'valor', v_valor, 'forma', v_forma, 'conta_entrada', v_conta, 'data', v_data,
    'parcelas_baixadas', v_parcelas, 'vai_fechar', v_quita, 'avisos', to_jsonb(avisos));
  if array_length(erros, 1) > 0 then return v_res || jsonb_build_object('pode_receber', false, 'erros', to_jsonb(erros)); end if;
  if not coalesce(p_gravar, false) then return v_res || jsonb_build_object('pode_receber', true, 'gravado', false); end if;

  -- ---------- gravação ----------
  select * into v_perfil from public.perfis where id = auth.uid();
  if o.cliente_id is not null then select coalesce(c.doc, '') into v_doc from public.clientes c where c.id = o.cliente_id; end if;
  -- "Referente a" igual ao da tela (referenteOS em js/telas/recibos.js)
  v_ref := 'pagamento da Ordem de Serviço nº ' || lpad(o.numero::text, 5, '0')
    || case when coalesce(o.veiculo->>'placa', '') <> '' then ' – ' || coalesce(v_veic || ' ', '') || 'placa '
         || case when (o.veiculo->>'placa') ~ '^[A-Z]{3}[0-9]{4}$' then left(o.veiculo->>'placa', 3) || '-' || right(o.veiculo->>'placa', 4) else o.veiculo->>'placa' end
       else '' end;
  insert into public.recibos (ordem_id, cliente_id, pagador, doc, valor, referente, forma, conta_destino, data, obs, emitido_por)
  values (o.id, o.cliente_id, coalesce(nullif(o.cliente->>'nome', ''), 'Cliente'), regexp_replace(coalesce(v_doc, ''), '\D', '', 'g'), v_valor, v_ref,
          v_forma, v_conta, v_data, 'Lançado pelo agente (Claude) a pedido do ' || coalesce(nullif(v_perfil.nome, ''), 'administrador') || '.', coalesce(v_perfil.nome, ''))
  returning * into v_rec;

  -- baixa das parcelas (o mesmo de baixarParcela: parcial deixa o resto numa parcela nova em aberto)
  v_resta := v_valor;
  for pa in select * from public.receber where ordem_id = o.id and status = 'aberta' order by vencimento, parcela, id for update loop
    exit when v_resta <= 0.009;
    v_parte := least(v_resta, pa.valor);
    if pa.valor - v_parte > 0.009 then
      insert into public.receber (ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento, obs, criado_por)
      values (pa.ordem_id, pa.cliente_id, pa.cliente_nome, pa.descricao, pa.forma, pa.parcela, pa.parcelas, round(pa.valor - v_parte, 2), pa.vencimento,
              'Restante após pagamento parcial de ' || public.agente_reais(v_parte), coalesce(v_perfil.nome, ''));
      update public.receber set status = 'paga', pago_em = v_data, recibo_id = v_rec.id, valor = round(v_parte, 2) where id = pa.id;
    else
      update public.receber set status = 'paga', pago_em = v_data, recibo_id = v_rec.id where id = pa.id;
    end if;
    v_resta := round(v_resta - v_parte, 2);
  end loop;

  insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
  values (o.id, 'recibo', 'Recibo ' || lpad(v_rec.numero::text, 5, '0') || ' emitido pelo agente (Claude): ' || public.agente_reais(v_valor)
          || ' (' || v_forma || ', conta ' || v_conta || ').', coalesce(v_perfil.nome, ''));
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('receber_os', coalesce(p->>'pedido', ''), 'recibos', v_rec.id::text,
          jsonb_build_object('numero', o.numero, 'total', o.total, 'recebido', v_recebido, 'parcelas_abertas', v_abertas),
          jsonb_build_object('numero', o.numero, 'recibo', v_rec.numero, 'valor', v_valor, 'forma', v_forma, 'conta', v_conta, 'data', v_data, 'parcelas', v_parcelas),
          coalesce(v_perfil.nome, ''));

  select * into o from public.ordens where id = o.id; -- o gatilho do recibo já somou o recebido e fechou, se quitou
  return v_res || jsonb_build_object('pode_receber', true, 'gravado', true, 'recibo', v_rec.numero, 'recibo_id', v_rec.id,
    'fechada', o.finalizada_em is not null, 'etapa', public.agente_etapa(o));
end $$;

-- comparação de forma/conta sem acento (sem depender da extensão unaccent)
create or replace function public.unaccent_simples(t text) returns text language sql immutable as $$
  select translate(coalesce(t, ''), 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC') $$;

revoke all on function public.agente_receber_os(jsonb, boolean) from public, anon;
grant execute on function public.agente_receber_os(jsonb, boolean) to authenticated;
