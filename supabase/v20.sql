-- =====================================================================
-- DTCar Gestão — v20: Fase 1 do agente de IA (conector do Claude).
--
-- Funções que o conector "agente" (supabase/functions/agente) chama em nome
-- do usuário que autorizou o acesso no app do Claude. Todas rodam com as
-- permissões desse usuário (security invoker: as regras de acesso valem
-- normalmente) e exigem ADMINISTRADOR.
--
--   Consultas: agente_buscar_os, agente_listar_os, agente_buscar_cliente,
--              agente_estoque, agente_a_receber, agente_a_pagar,
--              agente_notas_sefaz, agente_preparar_envio
--              (o saldo das contas usa saldos_contas(), do v18)
--   Gravação:  agente_abrir_os — com p_gravar = false só confere e mostra o
--              que vai fazer (prévia). Com p_gravar = true abre a O.S. numa
--              transação só (cliente, veículo, O.S., histórico da O.S. e
--              histórico do agente em agente_acoes).
--
-- Rode depois do v19. Pode rodar mais de uma vez. Não muda nada nas telas.
-- Espelho: desligado desde a virada. O que o agente gravar (clientes,
-- veículos e O.S.) segue a mesma regra do que é lançado pelas telas.
-- =====================================================================

-- só o administrador usa o agente
create or replace function public.agente_exige_admin() returns void
language plpgsql stable security invoker set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'O agente só atende o administrador.'; end if;
end $$;

-- valor em reais no padrão brasileiro (R$ 1.234,56), sem depender do idioma do banco
create or replace function public.agente_reais(v numeric) returns text
language sql immutable set search_path = public as $$
  select 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,')
$$;

-- etapa da O.S. com o mesmo texto das telas (js/regras.js, situacaoOS)
create or replace function public.agente_etapa(o public.ordens) returns text
language sql immutable set search_path = public as $$
  select case
    when o.status = 'diagnostico' then 'Orçamento em elaboração'
    when o.status = 'aguardando' then 'Orçamento enviado, aguardando aprovação'
    when o.status = 'execucao' then 'Aprovado · em execução'
    when o.status = 'pronto' then 'Aguardando pagamento · veículo no pátio'
    when o.status = 'entregue' and o.finalizada_em is null then 'Aguardando pagamento · veículo entregue'
    when o.status = 'entregue' then 'Fechada'
    when o.status = 'recusado' then 'Recusada'
    when o.status = 'cancelado' then 'Cancelada'
    else o.status end
$$;

-- resumo de uma O.S. (sem documento e endereço do cliente)
create or replace function public.agente_os_json(o public.ordens, p_itens boolean default true) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'numero', o.numero, 'etapa', public.agente_etapa(o), 'status', o.status,
    'aberta_em', o.criado_em, 'entregue_em', o.entregue_em, 'fechada_em', o.finalizada_em,
    'cliente', o.cliente->>'nome', 'cliente_id', o.cliente_id,
    'placa', o.veiculo->>'placa', 'veiculo', trim(concat_ws(' ', o.veiculo->>'marca', o.veiculo->>'modelo', o.veiculo->>'ano')),
    'km', o.km_entrada, 'reclamacao', o.reclamacao, 'diagnostico', o.diagnostico,
    'mecanico', o.mecanico_nome, 'consultor', o.consultor_nome, 'previsao_entrega', o.previsao_entrega,
    'total', o.total, 'desconto', o.desconto, 'recebido', coalesce(o.recebido, 0),
    'falta_receber', greatest(o.total - coalesce(o.recebido, 0), 0), 'forma_pagamento', o.forma_pagamento,
    'itens', case when p_itens then coalesce((
      select jsonb_agg(jsonb_build_object('tipo', i.tipo, 'descricao', i.descricao, 'codigo', i.codigo, 'qtd', i.qtd, 'valor_unit', i.valor_unit,
        'desconto', i.desconto, 'total', round(coalesce(i.qtd, 0) * coalesce(i.valor_unit, 0) - coalesce(i.desconto, 0), 2), 'custo_unit', i.custo_unit,
        'aprovado', i.aprovado, 'executado', i.executado, 'peca_do_cliente', i.fornecida_cliente) order by i.posicao, i.criado_em)
      from public.os_itens i where i.ordem_id = o.id), '[]'::jsonb) end,
    'recibos', case when p_itens then coalesce((
      select jsonb_agg(jsonb_build_object('numero', r.numero, 'data', r.data, 'valor', r.valor, 'forma', r.forma, 'conta', r.conta_destino) order by r.data)
      from public.recibos r where r.ordem_id = o.id and not r.cancelado), '[]'::jsonb) end,
    'parcelas_abertas', case when p_itens then coalesce((
      select jsonb_agg(jsonb_build_object('parcela', p.parcela || '/' || p.parcelas, 'vencimento', p.vencimento, 'valor', p.valor, 'forma', p.forma) order by p.vencimento)
      from public.receber p where p.ordem_id = o.id and p.status = 'aberta'), '[]'::jsonb) end)
$$;

-- 1. O.S. pelo número, ou as últimas O.S. de uma placa
create or replace function public.agente_buscar_os(p_numero int default null, p_placa text default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_placa text := upper(regexp_replace(coalesce(p_placa, ''), '[^A-Za-z0-9]', '', 'g')); r jsonb;
begin
  perform public.agente_exige_admin();
  if p_numero is not null then
    select public.agente_os_json(o) into r from public.ordens o where o.numero = p_numero;
    return coalesce(r, jsonb_build_object('erro', 'O.S. ' || p_numero || ' não encontrada.'));
  end if;
  if v_placa = '' then raise exception 'Informe o número da O.S. ou a placa.'; end if;
  -- as 5 últimas; só a mais recente vem com itens, recibos e parcelas
  select jsonb_build_object('placa', v_placa, 'ordens', coalesce(jsonb_agg(public.agente_os_json(o, x.rn = 1) order by x.rn), '[]'::jsonb)) into r
  from (select a.id, row_number() over (order by a.criado_em desc) rn from public.ordens a
        where upper(regexp_replace(coalesce(a.veiculo->>'placa', ''), '[^A-Za-z0-9]', '', 'g')) = v_placa
           or a.veiculo_id in (select v.id from public.veiculos v where v.placa = v_placa)) x
  join public.ordens o on o.id = x.id
  where x.rn <= 5;
  return r;
end $$;

-- 2. O.S. em aberto por etapa: orcamento, execucao, pagamento ou todas
create or replace function public.agente_listar_os(p_etapa text default 'todas') returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  perform public.agente_exige_admin();
  if coalesce(p_etapa, 'todas') not in ('orcamento', 'execucao', 'pagamento', 'todas') then
    raise exception 'Etapa inválida. Use orcamento, execucao, pagamento ou todas.';
  end if;
  select coalesce(jsonb_agg(public.agente_os_json(o, false) order by o.numero), '[]'::jsonb) into r
  from public.ordens o
  where case coalesce(p_etapa, 'todas')
    when 'orcamento' then o.status in ('diagnostico', 'aguardando')
    when 'execucao' then o.status = 'execucao'
    when 'pagamento' then o.status = 'pronto' or (o.status = 'entregue' and o.finalizada_em is null)
    else o.status in ('diagnostico', 'aguardando', 'execucao', 'pronto') or (o.status = 'entregue' and o.finalizada_em is null) end;
  return jsonb_build_object('etapa', coalesce(p_etapa, 'todas'), 'quantidade', jsonb_array_length(r), 'ordens', r);
end $$;

-- 3. cliente por nome, código, telefone ou placa (sem documento e endereço)
create or replace function public.agente_buscar_cliente(p_texto text) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare q text := lower(trim(coalesce(p_texto, ''))); d text := regexp_replace(coalesce(p_texto, ''), '\D', '', 'g');
  pl text := upper(regexp_replace(coalesce(p_texto, ''), '[^A-Za-z0-9]', '', 'g')); r jsonb;
begin
  perform public.agente_exige_admin();
  if length(q) < 2 then raise exception 'Digite pelo menos 2 letras do nome, o código, o telefone ou a placa.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'codigo', c.codigo, 'nome', c.nome, 'fantasia', c.fantasia, 'telefone', c.telefone, 'cidade', c.cidade,
      'situacao', c.situacao, 'restricao', c.restricao,
      'veiculos', coalesce((select jsonb_agg(jsonb_build_object('placa', v.placa, 'veiculo', trim(concat_ws(' ', v.marca, v.modelo, v.ano)), 'km', v.km_atual))
                            from public.veiculos v where v.cliente_id = c.id), '[]'::jsonb),
      'ultima_os', (select jsonb_build_object('numero', o.numero, 'etapa', public.agente_etapa(o), 'data', o.criado_em)
                    from public.ordens o where o.cliente_id = c.id order by o.criado_em desc limit 1),
      'em_aberto', (select coalesce(sum(greatest(o.total - coalesce(o.recebido, 0), 0)), 0) from public.ordens o
                    where o.cliente_id = c.id and (o.status = 'pronto' or (o.status = 'entregue' and o.finalizada_em is null)))
    ) order by c.nome), '[]'::jsonb) into r
  from (select * from public.clientes c
        where lower(c.nome) like '%' || q || '%' or lower(coalesce(c.fantasia, '')) like '%' || q || '%'
           or (d <> '' and c.codigo::text = d)
           or (length(d) >= 8 and regexp_replace(concat_ws(' ', c.telefone, c.telefone2, c.telefone3), '\D', '', 'g') like '%' || d || '%')
           or (length(pl) = 7 and c.id in (select v.cliente_id from public.veiculos v where v.placa = pl))
        order by c.nome limit 10) c;
  return r;
end $$;

-- 4. estoque por descrição, código, referência ou marca
create or replace function public.agente_estoque(p_texto text) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare q text := lower(trim(coalesce(p_texto, ''))); r jsonb;
begin
  perform public.agente_exige_admin();
  if length(q) < 2 then raise exception 'Digite pelo menos 2 letras da peça, o código ou a referência.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'descricao', p.descricao, 'referencia', p.referencia, 'marca', p.marca,
      'estoque', p.estoque_atual, 'minimo', p.estoque_min, 'custo', p.custo, 'preco_vista', p.preco_vista, 'preco_prazo', p.preco_prazo,
      'local', p.localizacao, 'ativo', p.ativo) order by p.descricao), '[]'::jsonb) into r
  from (select * from public.produtos p
        where p.tipo = 'produto' and (lower(p.descricao) like '%' || q || '%' or lower(coalesce(p.referencia, '')) like '%' || q || '%'
           or lower(coalesce(p.marca, '')) like '%' || q || '%' or p.codigo::text = q or lower(coalesce(p.codigo_barras, '')) = q)
        order by p.ativo desc, p.descricao limit 20) p;
  return r;
end $$;

-- 5. contas a receber até uma data (parcelas abertas + O.S. aguardando pagamento sem parcela)
create or replace function public.agente_a_receber(p_ate date default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_ate date := coalesce(p_ate, (now() at time zone 'America/Sao_Paulo')::date + 7); hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  parc jsonb; os jsonb;
begin
  perform public.agente_exige_admin();
  select coalesce(jsonb_agg(jsonb_build_object('cliente', p.cliente_nome, 'os', o.numero, 'parcela', p.parcela || '/' || p.parcelas, 'vencimento', p.vencimento,
      'valor', p.valor, 'forma', p.forma, 'atrasada', p.vencimento < hoje) order by p.vencimento), '[]'::jsonb) into parc
  from public.receber p left join public.ordens o on o.id = p.ordem_id
  where p.status = 'aberta' and p.vencimento <= v_ate;
  select coalesce(jsonb_agg(jsonb_build_object('os', o.numero, 'cliente', o.cliente->>'nome', 'etapa', public.agente_etapa(o),
      'falta_receber', greatest(o.total - coalesce(o.recebido, 0), 0)) order by o.numero), '[]'::jsonb) into os
  from public.ordens o
  where (o.status = 'pronto' or (o.status = 'entregue' and o.finalizada_em is null)) and o.total - coalesce(o.recebido, 0) > 0
    and not exists (select 1 from public.receber p where p.ordem_id = o.id and p.status = 'aberta');
  return jsonb_build_object('ate', v_ate,
    'parcelas', parc, 'total_parcelas', (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(parc) x),
    'atrasado', (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(parc) x where (x->>'atrasada')::boolean),
    'os_sem_parcela', os, 'total_os_sem_parcela', (select coalesce(sum((x->>'falta_receber')::numeric), 0) from jsonb_array_elements(os) x));
end $$;

-- 6. contas a pagar em aberto até uma data (vencidas incluídas)
create or replace function public.agente_a_pagar(p_ate date default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_ate date := coalesce(p_ate, (now() at time zone 'America/Sao_Paulo')::date + 7); hoje date := (now() at time zone 'America/Sao_Paulo')::date; r jsonb;
begin
  perform public.agente_exige_admin();
  select coalesce(jsonb_agg(jsonb_build_object('descricao', c.descricao, 'favorecido', c.favorecido, 'documento', c.documento, 'vencimento', c.vencimento,
      'valor', c.valor, 'categoria', c.categoria, 'vencida', c.vencimento < hoje, 'tem_boleto', coalesce(c.linha_digitavel, '') <> '' or coalesce(c.codigo_barras, '') <> '')
      order by c.vencimento, c.valor desc), '[]'::jsonb) into r
  from public.contas c where c.status = 'aberta' and c.vencimento <= v_ate;
  return jsonb_build_object('ate', v_ate, 'contas', r, 'total', (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(r) x),
    'vencido', (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(r) x where (x->>'vencida')::boolean));
end $$;

-- 7. notas de compra recebidas da SEFAZ nos últimos dias
create or replace function public.agente_notas_sefaz(p_dias int default 7) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare r jsonb;
begin
  perform public.agente_exige_admin();
  select coalesce(jsonb_agg(jsonb_build_object('numero', n.numero, 'emitente', n.nome_emitente, 'cnpj', n.cnpj_emitente, 'emissao', n.emissao, 'valor', n.valor,
      'situacao', n.situacao, 'estoque', case n.status when 'lancada' then 'entrada feita' when 'ignorada' then 'ignorada' else 'sem entrada' end,
      'contas_lancadas', n.contas_lancadas, 'tem_xml', n.tem_xml, 'chave', n.chave) order by n.emissao desc), '[]'::jsonb) into r
  from public.nfe_recebidas n where n.emissao >= now() - make_interval(days => greatest(coalesce(p_dias, 7), 1));
  return jsonb_build_object('dias', coalesce(p_dias, 7), 'notas', r);
end $$;

-- 8. texto pronto para mandar a O.S. ou o recibo ao cliente (o envio é feito pelo Danilo)
create or replace function public.agente_preparar_envio(p_numero int, p_tipo text default 'os') returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare o public.ordens; tel text; nome text; txt text; it record; rc record; n int := 0;
begin
  perform public.agente_exige_admin();
  select * into o from public.ordens where numero = p_numero;
  if o.id is null then raise exception 'O.S. % não encontrada.', p_numero; end if;
  select c.telefone, c.nome into tel, nome from public.clientes c where c.id = o.cliente_id;
  tel := regexp_replace(coalesce(nullif(tel, ''), o.cliente->>'telefone', ''), '\D', '', 'g');
  nome := split_part(coalesce(nome, o.cliente->>'nome', ''), ' ', 1);
  if coalesce(p_tipo, 'os') = 'recibo' then
    select * into rc from public.recibos r where r.ordem_id = o.id and not r.cancelado order by r.criado_em desc limit 1;
    if rc.id is null then raise exception 'A O.S. % não tem recibo.', p_numero; end if;
    txt := 'Olá, ' || nome || '! Segue o recibo nº ' || rc.numero || ' da DTCar Centro Automotivo, referente à O.S. ' || o.numero
      || ' (' || coalesce(o.veiculo->>'placa', '') || '): ' || public.agente_reais(rc.valor) || ' recebidos em ' || to_char(rc.data, 'DD/MM/YYYY')
      || ' (' || rc.forma || '). Obrigado pela preferência!';
  else
    txt := 'Olá, ' || nome || '! Segue a O.S. ' || o.numero || ' da DTCar Centro Automotivo — ' || trim(concat_ws(' ', o.veiculo->>'marca', o.veiculo->>'modelo'))
      || ' ' || coalesce(o.veiculo->>'placa', '') || E'\n';
    for it in select i.descricao, i.qtd, round(coalesce(i.qtd, 0) * coalesce(i.valor_unit, 0) - coalesce(i.desconto, 0), 2) t from public.os_itens i
              where i.ordem_id = o.id and coalesce(i.aprovado, true) order by i.posicao, i.criado_em loop
      n := n + 1;
      txt := txt || E'\n• ' || it.descricao || case when it.qtd <> 1 then ' (' || translate(trim(trailing '.' from trim(trailing '0' from to_char(it.qtd, 'FM999990.000'))), '.', ',') || ')' else '' end
        || case when it.t <> 0 then ': ' || public.agente_reais(it.t) else '' end;
    end loop;
    if o.desconto > 0 then txt := txt || E'\nDesconto: ' || public.agente_reais(o.desconto); end if;
    txt := txt || E'\n\n*Total: ' || public.agente_reais(o.total) || '*';
    if coalesce(o.recebido, 0) > 0 and o.total > o.recebido then
      txt := txt || E'\nJá recebido: ' || public.agente_reais(o.recebido) || E'\nFalta: ' || public.agente_reais(o.total - o.recebido);
    end if;
    if o.status in ('diagnostico', 'aguardando') then txt := txt || E'\n\nPodemos seguir com o serviço?'; end if;
  end if;
  return jsonb_build_object('os', o.numero, 'tipo', coalesce(p_tipo, 'os'), 'cliente', o.cliente->>'nome', 'telefone', tel,
    'telefone_ok', length(tel) between 10 and 11, 'texto', txt, 'itens', n, 'id', o.id);
end $$;

-- 9. abrir O.S. (prévia com p_gravar = false, gravação com p_gravar = true)
--    p: placa, km, reclamacao, cliente_id (opcional), cliente {nome, telefone}, veiculo {marca, modelo, ano, cor, motor, combustivel},
--       box, contato, km_menor_confirmado, abrir_mesmo_com_aberta, pedido (o que o Danilo pediu)
create or replace function public.agente_abrir_os(p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_placa text := upper(regexp_replace(coalesce(p->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  v_km int; v_reclamacao text := trim(coalesce(p->>'reclamacao', ''));
  v_vei public.veiculos; v_cli public.clientes; v_aberta public.ordens; v_ord public.ordens;
  v_tel text := regexp_replace(coalesce(p->'cliente'->>'telefone', ''), '\D', '', 'g'); v_nome text := trim(coalesce(p->'cliente'->>'nome', ''));
  v_ano int; erros text[] := '{}'; avisos text[] := '{}'; cfg jsonb; v_perfil public.perfis; dup public.clientes; v_resumo jsonb; v_end text;
begin
  perform public.agente_exige_admin();
  if v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then erros := array_append(erros, 'Placa inválida (use ABC1234 ou ABC1D23).'); end if;
  if coalesce(p->>'km', '') ~ '^\s*[0-9][0-9.\s]*$' then v_km := regexp_replace(p->>'km', '\D', '', 'g')::int; else erros := array_append(erros, 'Informe o KM de entrada.'); end if;
  if v_reclamacao = '' then erros := array_append(erros, 'Informe o motivo da visita ou a reclamação do cliente.'); end if;

  select * into v_vei from public.veiculos where placa = v_placa;
  -- cliente: o informado, senão o dono do veículo, senão um cliente novo
  if nullif(p->>'cliente_id', '') is not null then
    select * into v_cli from public.clientes where id = (p->>'cliente_id')::uuid;
    if v_cli.id is null then erros := array_append(erros, 'Cliente informado não existe.'); end if;
  elsif v_vei.id is not null and v_vei.cliente_id is not null and v_nome = '' then
    select * into v_cli from public.clientes where id = v_vei.cliente_id;
  end if;
  if v_cli.id is null and nullif(p->>'cliente_id', '') is null then
    if v_nome = '' then erros := array_append(erros, 'Informe o nome do cliente (ou o cliente_id de um cliente cadastrado).');
    elsif length(v_tel) not between 10 and 11 then erros := array_append(erros, 'Informe o telefone do cliente com DDD.');
    else
      select * into dup from public.clientes c
        where regexp_replace(concat_ws(' ', c.telefone, c.telefone2, c.telefone3), '\D', '', 'g') like '%' || v_tel || '%' limit 1;
      if dup.id is not null then
        if lower(dup.nome) = lower(v_nome) then v_cli := dup;
        else erros := array_append(erros, ('Este telefone já é de ' || dup.nome || ' (cliente_id ' || dup.id || '). Confirme se é o mesmo cliente.')); end if;
      end if;
    end if;
  end if;
  if v_cli.id is not null and v_cli.situacao = 'bloqueado' then
    erros := array_append(erros, ('Cliente bloqueado: ' || coalesce(nullif(v_cli.restricao, ''), 'verifique o cadastro') || '. Não é possível abrir O.S.'));
  end if;
  -- veículo novo precisa de marca, modelo e ano
  if v_vei.id is null and v_placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
    if trim(coalesce(p->'veiculo'->>'marca', '')) = '' then erros := array_append(erros, 'Veículo novo: informe a marca.'); end if;
    if trim(coalesce(p->'veiculo'->>'modelo', '')) = '' then erros := array_append(erros, 'Veículo novo: informe o modelo.'); end if;
    v_ano := nullif(regexp_replace(coalesce(p->'veiculo'->>'ano', ''), '\D', '', 'g'), '')::int;
    if v_ano is null or v_ano < 1950 or v_ano > extract(year from now())::int + 1 then erros := array_append(erros, 'Veículo novo: informe o ano com 4 dígitos.'); end if;
  end if;
  if v_vei.id is not null and v_km is not null and coalesce(v_vei.km_atual, 0) > v_km then
    if coalesce((p->>'km_menor_confirmado')::boolean, false) then avisos := array_append(avisos, ('KM menor que o último registrado (' || v_vei.km_atual || '), confirmado.'));
    else erros := array_append(erros, ('O KM informado é menor que o último registrado (' || v_vei.km_atual || '). Confira ou confirme a divergência.')); end if;
  end if;
  if v_vei.id is not null then
    select * into v_aberta from public.ordens o where o.veiculo_id = v_vei.id and o.status in ('diagnostico', 'aguardando', 'execucao', 'pronto') order by o.criado_em desc limit 1;
    if v_aberta.id is not null then
      if coalesce((p->>'abrir_mesmo_com_aberta')::boolean, false) then avisos := array_append(avisos, ('O veículo já tem a O.S. ' || v_aberta.numero || ' em andamento (confirmado abrir outra).'));
      else erros := array_append(erros, ('O veículo já tem a O.S. ' || v_aberta.numero || ' em andamento. Abrir outra mesmo assim?')); end if;
    end if;
  end if;

  v_resumo := jsonb_build_object(
    'placa', v_placa, 'km', v_km, 'reclamacao', v_reclamacao,
    'veiculo', case when v_vei.id is not null then jsonb_build_object('cadastrado', true, 'descricao', trim(concat_ws(' ', v_vei.marca, v_vei.modelo, v_vei.ano)), 'km_anterior', v_vei.km_atual)
                    else jsonb_build_object('cadastrado', false, 'descricao', trim(concat_ws(' ', p->'veiculo'->>'marca', p->'veiculo'->>'modelo', p->'veiculo'->>'ano'))) end,
    'cliente', case when v_cli.id is not null then jsonb_build_object('cadastrado', true, 'id', v_cli.id, 'nome', v_cli.nome, 'telefone', v_cli.telefone)
                    else jsonb_build_object('cadastrado', false, 'nome', v_nome, 'telefone', v_tel) end,
    'avisos', to_jsonb(avisos));
  if array_length(erros, 1) > 0 then return v_resumo || jsonb_build_object('pode_abrir', false, 'erros', to_jsonb(erros)); end if;
  if not coalesce(p_gravar, false) then return v_resumo || jsonb_build_object('pode_abrir', true, 'gravado', false); end if;

  -- gravação (uma transação só)
  select dados into cfg from public.config where id = 1;
  select * into v_perfil from public.perfis where id = auth.uid();
  if v_cli.id is null then
    insert into public.clientes (nome, telefone, cidade, uf, endereco, origem)
    values (v_nome, v_tel, 'Colatina', 'ES', 'Colatina/ES', coalesce(p->'cliente'->>'origem', '')) returning * into v_cli;
  end if;
  if v_vei.id is null then
    insert into public.veiculos (placa, marca, modelo, ano, ano_fab, ano_mod, cor, motor, combustivel, cliente_id, km_atual)
    values (v_placa, trim(p->'veiculo'->>'marca'), trim(p->'veiculo'->>'modelo'), v_ano::text, v_ano, v_ano, trim(coalesce(p->'veiculo'->>'cor', '')),
            trim(coalesce(p->'veiculo'->>'motor', '')), coalesce(p->'veiculo'->>'combustivel', ''), v_cli.id, v_km) returning * into v_vei;
  else
    update public.veiculos set cliente_id = v_cli.id, km_atual = greatest(coalesce(km_atual, 0), v_km) where id = v_vei.id returning * into v_vei;
  end if;
  v_end := coalesce(nullif(concat_ws(', ', nullif(trim(concat_ws(' ', v_cli.rua, v_cli.complemento)), ''), nullif(v_cli.bairro, ''),
            nullif(concat_ws('/', nullif(v_cli.cidade, ''), nullif(v_cli.uf, '')), ''), case when coalesce(v_cli.cep, '') <> '' then 'CEP ' || v_cli.cep end), ''), v_cli.endereco, '');
  insert into public.ordens (status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, reclamacao, box, contato, checkin,
                             consultor_id, consultor_nome, garantia_dias, condicoes_pagamento)
  values ('diagnostico', v_cli.id, v_vei.id,
          jsonb_build_object('nome', v_cli.nome, 'telefone', coalesce(v_cli.telefone, ''), 'doc', coalesce(v_cli.doc, ''), 'endereco', v_end),
          jsonb_build_object('placa', v_vei.placa, 'marca', v_vei.marca, 'modelo', v_vei.modelo, 'ano', v_vei.ano, 'cor', coalesce(v_vei.cor, ''),
                             'motor', coalesce(nullif(v_vei.combustivel, ''), v_vei.motor, '')),
          v_km, v_reclamacao, trim(coalesce(p->>'box', '')), trim(coalesce(p->>'contato', '')),
          jsonb_build_object('feito', false, 'kmAnterior', (v_resumo->'veiculo'->>'km_anterior')::int,
                             'kmDivergente', coalesce((v_resumo->'veiculo'->>'km_anterior')::int, 0) > v_km, 'agente', true),
          auth.uid(), coalesce(v_perfil.nome, ''), coalesce((cfg->>'garantiaDias')::int, 90), coalesce(cfg->>'condicoesPadrao', ''))
  returning * into v_ord;
  insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
  values (v_ord.id, 'abertura', 'O.S. aberta pelo agente (Claude) com ' || replace(to_char(v_km, 'FM999,999,990'), ',', '.') || ' km.', coalesce(v_perfil.nome, ''));
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('abrir_os', coalesce(p->>'pedido', ''), 'ordens', v_ord.id::text, null,
          jsonb_build_object('numero', v_ord.numero, 'placa', v_placa, 'cliente', v_cli.nome, 'km', v_km, 'reclamacao', v_reclamacao,
                             'cliente_novo', not coalesce((v_resumo->'cliente'->>'cadastrado')::boolean, false),
                             'veiculo_novo', not coalesce((v_resumo->'veiculo'->>'cadastrado')::boolean, false)),
          coalesce(v_perfil.nome, ''));
  return v_resumo || jsonb_build_object('pode_abrir', true, 'gravado', true, 'numero', v_ord.numero, 'id', v_ord.id);
end $$;

-- acesso: só usuários logados (a função confere se é administrador)
do $$
declare f text;
begin
  foreach f in array array['agente_exige_admin()', 'agente_reais(numeric)', 'agente_etapa(public.ordens)', 'agente_os_json(public.ordens, boolean)', 'agente_buscar_os(int, text)', 'agente_listar_os(text)', 'agente_buscar_cliente(text)',
                           'agente_estoque(text)', 'agente_a_receber(date)', 'agente_a_pagar(date)', 'agente_notas_sefaz(int)',
                           'agente_preparar_envio(int, text)', 'agente_abrir_os(jsonb, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
