-- =====================================================================
-- DTCar Gestão — v40: conector do Claude "sem amarras" (06/11/2026)
--
-- Pedido do Danilo (06/11/2026): o agente faz no sistema tudo o que ele pedir.
--   * O.S.: mudar etapa (enviar orçamento, aprovar, concluir, entregar, retirar,
--     recusar, cancelar, reabrir, voltar etapa, excluir), alterar e remover itens,
--     incluir itens, editar dados, trocar cliente ou veículo.
--   * Cadastros: criar, editar e excluir cliente e veículo.
--   * Financeiro: lançar conta a pagar, dar baixa (pagar), desfazer, editar,
--     cancelar e excluir; atualizar saldos; transferir entre contas;
--     cancelar recibo; recibo de sinal/adiantamento em O.S. ainda não entregue.
--   * Estoque: entrada, saída e ajuste; cadastrar, editar, inativar e excluir produto.
--
-- Decisões do Danilo (06/11/2026): pode APAGAR, com histórico; prévia e "sim"
-- só nas ações com dinheiro (a regra fica no texto do conector).
--
-- Como funciona: o conector chama agente_fazer(acao, p, gravar). Cada ação é
-- feita de verdade numa transação; na PRÉVIA (gravar = false) tudo é desfeito
-- no fim (rollback do bloco) e volta o resultado que daria — a prévia mostra
-- exatamente o que vai acontecer. Gravações em O.S. passam pela
-- sincronizar_alteracao_os (v15), para não conflitar com a fila sem internet.
-- Tudo vai para agente_acoes (antes e depois) e para o histórico da O.S.
-- Exige administrador. Rode depois do v39. Pode rodar mais de uma vez.
-- Nenhuma tabela nova: nada muda no backup, no banco do PC nem no espelho.
-- =====================================================================

-- ---------- utilidades ----------
create or replace function public.agente_hoje() returns date language sql stable as $$
  select (now() at time zone 'America/Sao_Paulo')::date $$;

create or replace function public.agente_quem() returns text language sql stable security invoker set search_path = public as $$
  select coalesce((select nullif(nome, '') from public.perfis where id = auth.uid()), 'administrador') $$;

create or replace function public.agente_registrar(p_ferramenta text, p jsonb, p_tabela text, p_registro text, p_antes jsonb, p_depois jsonb)
returns void language sql volatile security invoker set search_path = public as $$
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values (p_ferramenta, coalesce(p->>'pedido', ''), p_tabela, coalesce(p_registro, ''), p_antes, p_depois, public.agente_quem()) $$;

-- contas da empresa (Ajustes › saldo por conta) e a conta informada conferida sem acento/maiúscula
create or replace function public.agente_contas_nomes() returns text[] language sql stable security invoker set search_path = public as $$
  select coalesce((select array_agg(c->>'nome') from public.config, jsonb_array_elements(coalesce(dados->'contasFinanceiras', '[]'::jsonb)) c
                   where id = 1 and coalesce(c->>'nome', '') <> ''), array['Sicredi', 'PicPay PJ', 'Espécie']) $$;

create or replace function public.agente_conta_valida(p_nome text) returns text language plpgsql stable security invoker set search_path = public as $$
declare v text; todas text[] := public.agente_contas_nomes();
begin
  select c into v from unnest(todas) c where lower(public.unaccent_simples(c)) = lower(public.unaccent_simples(trim(coalesce(p_nome, '')))) limit 1;
  if v is null then raise exception 'Conta "%" não existe. Contas: %.', coalesce(p_nome, ''), array_to_string(todas, ', '); end if;
  return v;
end $$;

-- só as chaves que são colunas da tabela, fora as proibidas; chave desconhecida = erro com a lista
create or replace function public.agente_campos(p_tabela text, p_campos jsonb, p_proibidos text[]) returns jsonb
language plpgsql stable set search_path = public as $$
declare k text; cols text[]; ok jsonb := '{}';
begin
  if p_campos is null or jsonb_typeof(p_campos) <> 'object' then return '{}'; end if;
  select array_agg(attname::text) into cols from pg_attribute where attrelid = ('public.' || p_tabela)::regclass and attnum > 0 and not attisdropped;
  for k in select jsonb_object_keys(p_campos) loop
    if k = any (p_proibidos) then raise exception 'O campo "%" não se muda por aqui.', k; end if;
    if not (k = any (cols)) then
      raise exception 'O campo "%" não existe em %. Campos: %.', k, p_tabela,
        array_to_string(array(select c from unnest(cols) c where not (c = any (p_proibidos)) order by c), ', ');
    end if;
    ok := ok || jsonb_build_object(k, p_campos->k);
  end loop;
  return ok;
end $$;

-- grava campos da O.S. pela função da sincronização (base = o que está no banco agora)
create or replace function public.agente_patch_os(p_id uuid, p_patch jsonb) returns void
language plpgsql volatile security invoker set search_path = public as $$
declare o public.ordens; r jsonb; oj jsonb;
begin
  if p_patch is null or p_patch = '{}'::jsonb then return; end if;
  select * into o from public.ordens where id = p_id for update;
  oj := to_jsonb(o);
  r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'alterar_os', 'ordem_id', p_id, 'status_base', o.status,
         'antes', (select coalesce(jsonb_object_agg(k, oj->k), '{}') from jsonb_object_keys(p_patch) k), 'patch', p_patch), false);
  if r ? 'conflito' then raise exception 'Não gravei: %', r->>'conflito'; end if;
end $$;

-- grava itens (alterados com id) e remove itens pela função da sincronização
create or replace function public.agente_itens_gravar(p_ordem uuid, p_itens jsonb, p_removidos jsonb) returns void
language plpgsql volatile security invoker set search_path = public as $$
declare r jsonb; v_antes jsonb := '{}'; it jsonb; cur public.os_itens; k text;
begin
  if coalesce(jsonb_array_length(p_itens), 0) = 0 and coalesce(jsonb_array_length(p_removidos), 0) = 0 then return; end if;
  perform 1 from public.ordens where id = p_ordem for update;
  for it in select * from jsonb_array_elements(coalesce(p_itens, '[]')) loop
    select * into cur from public.os_itens where id = (it->>'id')::uuid;
    if found then v_antes := v_antes || jsonb_build_object(cur.id::text, to_jsonb(cur) - 'atualizado_em' - 'criado_em'); end if;
  end loop;
  for k in select jsonb_array_elements_text(coalesce(p_removidos, '[]')) loop
    select * into cur from public.os_itens where id = k::uuid;
    if found then v_antes := v_antes || jsonb_build_object(cur.id::text, to_jsonb(cur) - 'atualizado_em' - 'criado_em'); end if;
  end loop;
  r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'itens_os', 'ordem_id', p_ordem, 'itens', coalesce(p_itens, '[]'),
         'removidos', coalesce(p_removidos, '[]'), 'antes', jsonb_build_object('status', (select status from public.ordens where id = p_ordem), 'itens', v_antes)), false);
  if r ? 'conflito' then raise exception 'Não gravei: %', r->>'conflito'; end if;
end $$;

-- total e custo como a tela calcula (js/util.js, totais; mesma regra do v27)
create or replace function public.agente_totais_os(p_ordem uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  with o as (select * from public.ordens where id = p_ordem),
  conta as (
    select i.* from public.os_itens i, o where i.ordem_id = o.id
      and case when o.status in ('execucao', 'pronto', 'entregue', 'recusado') then i.aprovado is true else i.aprovado is distinct from false end)
  select jsonb_build_object(
    'total', greatest(0, coalesce((select sum(round(qtd * valor_unit - coalesce(desconto, 0), 2)) from conta), 0) - coalesce((select desconto from o), 0)),
    'custo', coalesce((select sum(round(qtd * custo_unit, 2)) from conta where tipo <> 'servico'), 0))
$$;

-- linha digitável (47/48) ou código de barras (44) → código de barras
create or replace function public.agente_barras(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 44 then return d; end if;
  if length(d) = 47 then return substr(d, 1, 4) || substr(d, 33, 1) || substr(d, 34, 14) || substr(d, 5, 5) || substr(d, 11, 10) || substr(d, 22, 10); end if;
  if length(d) = 48 and left(d, 1) = '8' then return substr(d, 1, 11) || substr(d, 13, 11) || substr(d, 25, 11) || substr(d, 37, 11); end if;
  return '';
end $$;

-- ---------- resumo da O.S. agora com o id dos itens (para alterar/remover) ----------
create or replace function public.agente_os_json(o public.ordens, p_itens boolean default true) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'id', o.id, 'numero', o.numero, 'etapa', public.agente_etapa(o), 'status', o.status,
    'aberta_em', o.criado_em, 'entregue_em', o.entregue_em, 'fechada_em', o.finalizada_em,
    'cliente', o.cliente->>'nome', 'cliente_id', o.cliente_id, 'veiculo_id', o.veiculo_id,
    'placa', o.veiculo->>'placa', 'veiculo', trim(concat_ws(' ', o.veiculo->>'marca', o.veiculo->>'modelo', o.veiculo->>'ano')),
    'km', o.km_entrada, 'km_saida', o.km_saida, 'reclamacao', o.reclamacao, 'diagnostico', o.diagnostico,
    'mecanico', o.mecanico_nome, 'consultor', o.consultor_nome, 'previsao_entrega', o.previsao_entrega, 'box', o.box,
    'total', o.total, 'desconto', o.desconto, 'recebido', coalesce(o.recebido, 0), 'motivo_cancelamento', o.motivo_cancelamento,
    'falta_receber', greatest(o.total - coalesce(o.recebido, 0), 0), 'forma_pagamento', o.forma_pagamento,
    'itens', case when p_itens then coalesce((
      select jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'descricao', i.descricao, 'codigo', i.codigo, 'qtd', i.qtd, 'valor_unit', i.valor_unit,
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

-- contas a pagar agora com o id (para dar baixa) e a conta de saída padrão
create or replace function public.agente_a_pagar(p_ate date default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare v_ate date := coalesce(p_ate, public.agente_hoje() + 7); hoje date := public.agente_hoje(); r jsonb;
begin
  perform public.agente_exige_admin();
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'descricao', c.descricao, 'favorecido', c.favorecido, 'documento', c.documento, 'vencimento', c.vencimento,
      'valor', c.valor, 'categoria', c.categoria, 'vencida', c.vencimento < hoje, 'tem_boleto', coalesce(c.linha_digitavel, '') <> '' or coalesce(c.codigo_barras, '') <> '')
      order by c.vencimento, c.valor desc), '[]'::jsonb) into r
  from public.contas c where c.status = 'aberta' and c.vencimento <= v_ate;
  return jsonb_build_object('ate', v_ate, 'contas', r, 'total', (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(r) x),
    'vencido', (select coalesce(sum((x->>'valor')::numeric), 0) from jsonb_array_elements(r) x where (x->>'vencida')::boolean),
    'conta_padrao_pagamento', (select dados->>'contaPagamento' from public.config where id = 1));
end $$;

-- =====================================================================
-- 1. O.S.
-- p: numero; acao (opcional): enviar_orcamento, aprovar, concluir, entregar, retirar, recusar, cancelar,
--    reabrir, voltar_etapa, excluir; dados {campo: valor}; cliente_id; placa ou veiculo_id;
--    itens_incluir [como lancar_itens_os]; itens_alterar [{id, campos...}]; itens_remover [id];
--    km_saida, forma_pagamento, garantia_dias, motivo, parcelas [{valor, vencimento, forma}] (entregar a prazo)
-- =====================================================================
create or replace function public.agente_alterar_os(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.ordens; cfg jsonb; v_acao text := lower(coalesce(trim(p->>'acao'), '')); v_quem text := public.agente_quem();
  feito text[] := '{}'; avisos text[] := '{}'; v_antes jsonb; v_patch jsonb := '{}'; v_dados jsonb := '{}';
  it jsonb; cur public.os_itens; v_mud jsonb; v_lista jsonb := '[]'; v_rem jsonb := '[]'; k text; v_prod public.produtos;
  v_cli public.clientes; v_vei public.veiculos; v_end text; v_km int; v_tot jsonb; v_pend int; v_rec numeric; v_n int; r jsonb;
  v_hoje date := public.agente_hoje(); pa jsonb; v_soma numeric := 0;
  c_proib text[] := array['id', 'numero', 'status', 'cliente_id', 'veiculo_id', 'cliente', 'veiculo', 'total', 'custo', 'recebido', 'finalizada_em',
                          'criado_em', 'atualizado_em', 'criado_por', 'estoque_baixado', 'checkin', 'assinatura_entrada', 'assinatura_entrega'];
  c_item text[] := array['tipo', 'descricao', 'qtd', 'valor_unit', 'custo_unit', 'desconto', 'aprovado', 'executado', 'fornecida_cliente', 'qualidade', 'fornecedor', 'posicao'];
begin
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1 for update;
  if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;
  select dados into cfg from public.config where id = 1;
  v_antes := public.agente_os_json(o);
  if v_acao not in ('', 'enviar_orcamento', 'aprovar', 'concluir', 'entregar', 'retirar', 'recusar', 'cancelar', 'reabrir', 'voltar_etapa', 'excluir') then
    raise exception 'Ação "%" não existe. Use: enviar_orcamento, aprovar, concluir, entregar, retirar, recusar, cancelar, reabrir, voltar_etapa ou excluir.', v_acao;
  end if;

  -- ---------- excluir (sai daqui) ----------
  if v_acao = 'excluir' then
    select coalesce(sum(valor), 0) into v_rec from public.recibos where ordem_id = o.id and not cancelado;
    if v_rec > 0 then raise exception 'A O.S. % tem % em recibos válidos. Cancele os recibos antes de excluir (ou cancele a O.S.).', o.numero, public.agente_reais(v_rec); end if;
    if exists (select 1 from public.fotos where ordem_id = o.id) then avisos := array_append(avisos, 'As fotos da O.S. ficam guardadas no armazenamento (só a ligação com a O.S. some).'); end if;
    perform public.agente_registrar('alterar_os', p, 'ordens', o.id::text,
      jsonb_build_object('ordem', to_jsonb(o), 'itens', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.os_itens i where i.ordem_id = o.id),
                         'parcelas', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.receber x where x.ordem_id = o.id)),
      jsonb_build_object('excluida', true));
    delete from public.ordens where id = o.id;
    return jsonb_build_object('os', o.numero, 'excluida', true, 'cliente', o.cliente->>'nome', 'placa', o.veiculo->>'placa', 'total', o.total, 'avisos', to_jsonb(avisos));
  end if;

  -- ---------- reabrir / voltar etapa primeiro (para depois poder mexer nos itens) ----------
  if v_acao = 'reabrir' then
    if o.status = 'entregue' then perform public.agente_patch_os(o.id, jsonb_build_object('status', 'pronto')); feito := array_append(feito, 'reaberta: volta para aguardando pagamento no pátio');
    elsif o.status in ('cancelado', 'recusado') then
      perform public.agente_patch_os(o.id, jsonb_build_object('status', 'diagnostico', 'orcamento_enviado_em', null, 'motivo_cancelamento', ''));
      feito := array_append(feito, 'reaberta: volta para orçamento');
    else raise exception 'A O.S. % está "%": reabrir vale para O.S. fechada, entregue, cancelada ou recusada (para voltar uma etapa, use voltar_etapa).', o.numero, public.agente_etapa(o); end if;
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (o.id, 'reabertura', 'O.S. reaberta pelo agente (Claude).', v_quem);
  elsif v_acao = 'voltar_etapa' then
    v_patch := case o.status when 'execucao' then jsonb_build_object('status', 'aguardando') when 'pronto' then jsonb_build_object('status', 'execucao')
                             when 'aguardando' then jsonb_build_object('status', 'diagnostico', 'orcamento_enviado_em', null) end;
    if v_patch is null then raise exception 'A O.S. % está "%": não há etapa anterior por aqui (O.S. entregue: use reabrir).', o.numero, public.agente_etapa(o); end if;
    perform public.agente_patch_os(o.id, v_patch); v_patch := '{}';
    feito := array_append(feito, 'voltou uma etapa');
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (o.id, 'reabertura', 'O.S. voltou uma etapa (agente, Claude).', v_quem);
  end if;

  -- ---------- trocar cliente / veículo e dados ----------
  if coalesce(p->>'cliente_id', '') <> '' then
    select * into v_cli from public.clientes where id = (p->>'cliente_id')::uuid;
    if v_cli.id is null then raise exception 'Cliente % não encontrado.', p->>'cliente_id'; end if;
    v_end := coalesce(nullif(concat_ws(', ', nullif(trim(concat_ws(' ', v_cli.rua, v_cli.complemento)), ''), nullif(v_cli.bairro, ''),
                 nullif(trim(concat_ws(' - ', nullif(v_cli.cidade, ''), nullif(v_cli.uf, ''))), '')), ''), v_cli.endereco, '');
    v_patch := v_patch || jsonb_build_object('cliente_id', v_cli.id,
      'cliente', coalesce(o.cliente, '{}') || jsonb_build_object('nome', v_cli.nome, 'telefone', coalesce(v_cli.telefone, ''), 'doc', coalesce(v_cli.doc, ''), 'endereco', v_end));
    feito := array_append(feito, 'cliente trocado para ' || v_cli.nome);
  end if;
  if coalesce(p->>'veiculo_id', '') <> '' or coalesce(p->>'placa', '') <> '' then
    select * into v_vei from public.veiculos
      where case when coalesce(p->>'veiculo_id', '') <> '' then id = (p->>'veiculo_id')::uuid
                 else placa = upper(regexp_replace(p->>'placa', '[^A-Za-z0-9]', '', 'g')) end;
    if v_vei.id is null then raise exception 'Veículo % não encontrado (cadastre antes com salvar_cadastro).', coalesce(p->>'placa', p->>'veiculo_id'); end if;
    v_patch := v_patch || jsonb_build_object('veiculo_id', v_vei.id,
      'veiculo', coalesce(o.veiculo, '{}') || jsonb_build_object('placa', v_vei.placa, 'marca', v_vei.marca, 'modelo', v_vei.modelo, 'ano', v_vei.ano, 'cor', coalesce(v_vei.cor, '')));
    if v_vei.cliente_id is distinct from coalesce((v_patch->>'cliente_id')::uuid, o.cliente_id) then
      avisos := array_append(avisos, 'O veículo ' || v_vei.placa || ' está cadastrado em nome de outro cliente.');
    end if;
    feito := array_append(feito, 'veículo trocado para ' || v_vei.placa);
  end if;
  -- apelidos de campos que o Danilo costuma falar
  v_dados := coalesce(p->'dados', '{}');
  if jsonb_typeof(v_dados) <> 'object' then raise exception 'dados deve ser um objeto {campo: valor}.'; end if;
  if v_dados ? 'km' then v_dados := (v_dados - 'km') || jsonb_build_object('km_entrada', v_dados->'km'); end if;
  if v_dados ? 'previsao' then v_dados := (v_dados - 'previsao') || jsonb_build_object('previsao_entrega', v_dados->'previsao'); end if;
  if v_dados ? 'mecanico' then v_dados := (v_dados - 'mecanico') || jsonb_build_object('mecanico_nome', v_dados->'mecanico'); end if;
  if v_dados ? 'obs' then v_dados := (v_dados - 'obs') || jsonb_build_object('obs_internas', v_dados->'obs'); end if;
  v_dados := public.agente_campos('ordens', v_dados, c_proib);
  if v_dados <> '{}'::jsonb then
    perform jsonb_populate_record(null::public.ordens, v_dados); -- confere o tipo de cada campo (data, número)
    v_patch := v_patch || v_dados;
    feito := array_append(feito, 'dados alterados: ' || (select string_agg(x, ', ') from jsonb_object_keys(v_dados) x));
  end if;
  if v_patch <> '{}'::jsonb then perform public.agente_patch_os(o.id, v_patch); v_patch := '{}'; end if;

  -- ---------- itens: alterar, remover, incluir ----------
  for it in select * from jsonb_array_elements(coalesce(p->'itens_alterar', '[]')) loop
    select * into cur from public.os_itens where id = nullif(it->>'id', '')::uuid and ordem_id = o.id;
    if cur.id is null then raise exception 'Item % não é da O.S. % (veja os ids em buscar_os).', coalesce(it->>'id', '?'), o.numero; end if;
    v_mud := '{}';
    for k in select jsonb_object_keys(it) loop
      if k in ('id', 'codigo') then continue; end if;
      if k = 'peca_do_cliente' then v_mud := v_mud || jsonb_build_object('fornecida_cliente', it->k); continue; end if;
      if not (k = any (c_item)) then raise exception 'Campo "%" do item não muda por aqui. Campos: %, codigo.', k, array_to_string(c_item, ', '); end if;
      v_mud := v_mud || jsonb_build_object(k, it->k);
    end loop;
    if coalesce(it->>'codigo', '') <> '' then
      select * into v_prod from public.produtos pr where pr.tipo = 'produto' and (pr.codigo::text = trim(it->>'codigo') or lower(coalesce(pr.codigo_barras, '')) = lower(trim(it->>'codigo'))) order by pr.ativo desc limit 1;
      if v_prod.id is null then raise exception 'Código % não existe no estoque.', it->>'codigo'; end if;
      v_mud := v_mud || jsonb_build_object('produto_id', v_prod.id, 'codigo', v_prod.codigo::text) || case when not (it ? 'custo_unit') then jsonb_build_object('custo_unit', v_prod.custo) else '{}' end;
    end if;
    perform jsonb_populate_record(cur, v_mud); -- confere os tipos
    v_lista := v_lista || jsonb_build_array((to_jsonb(cur) - 'atualizado_em' - 'criado_em') || v_mud);
  end loop;
  for k in select jsonb_array_elements_text(coalesce(p->'itens_remover', '[]')) loop
    if not exists (select 1 from public.os_itens where id = k::uuid and ordem_id = o.id) then raise exception 'Item % não é da O.S. %.', k, o.numero; end if;
    v_rem := v_rem || to_jsonb(k);
  end loop;
  if jsonb_array_length(v_lista) + jsonb_array_length(v_rem) > 0 then
    perform public.agente_itens_gravar(o.id, v_lista, v_rem);
    if jsonb_array_length(v_lista) > 0 then feito := array_append(feito, jsonb_array_length(v_lista) || ' item(ns) alterado(s)'); end if;
    if jsonb_array_length(v_rem) > 0 then feito := array_append(feito, jsonb_array_length(v_rem) || ' item(ns) removido(s)'); end if;
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
    values (o.id, 'itens', 'Agente (Claude): ' || array_to_string(array(select x from unnest(feito) x where x ~ 'item'), ', ') || '.', v_quem);
  end if;
  if jsonb_typeof(p->'itens_incluir') = 'array' and jsonb_array_length(p->'itens_incluir') > 0 then
    r := public.agente_lancar_itens_os(jsonb_build_object('numero', o.numero, 'itens', p->'itens_incluir', 'pedido', p->>'pedido',
           'lancar_mesmo_repetido', coalesce((p->>'lancar_mesmo_repetido')::boolean, false)), true);
    if not coalesce((r->>'pode_lancar')::boolean, false) then raise exception 'Itens não incluídos: %', (select string_agg(x, ' ') from jsonb_array_elements_text(r->'erros') x); end if;
    feito := array_append(feito, jsonb_array_length(p->'itens_incluir') || ' item(ns) incluído(s)');
    avisos := avisos || coalesce((select array_agg(x) from jsonb_array_elements_text(r->'avisos') x), '{}');
  end if;

  -- ---------- etapa ----------
  select * into o from public.ordens where id = o.id for update;
  select count(*) into v_pend from public.os_itens where ordem_id = o.id and aprovado is null;
  if v_acao = 'enviar_orcamento' then
    if o.status <> 'diagnostico' then raise exception 'A O.S. % está "%": só orçamento em elaboração é marcado como enviado.', o.numero, public.agente_etapa(o); end if;
    if not exists (select 1 from public.os_itens where ordem_id = o.id) then raise exception 'Inclua peças ou serviços antes de enviar o orçamento.'; end if;
    perform public.agente_patch_os(o.id, jsonb_build_object('status', 'aguardando', 'orcamento_enviado_em', now(),
      'validade_orcamento', v_hoje + coalesce(nullif(cfg->>'validadeDias', '')::int, 10)));
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (o.id, 'enviar', 'Orçamento marcado como enviado ao cliente (agente, Claude).', v_quem);
    feito := array_append(feito, 'orçamento enviado');
  elsif v_acao = 'aprovar' then
    if o.status not in ('diagnostico', 'aguardando', 'execucao', 'pronto', 'entregue') then raise exception 'A O.S. % está "%": não há o que aprovar.', o.numero, public.agente_etapa(o); end if;
    if not exists (select 1 from public.os_itens where ordem_id = o.id and aprovado is distinct from false) then raise exception 'A O.S. % não tem itens para aprovar.', o.numero; end if;
    select string_agg(descricao, ', ') into k from public.os_itens where ordem_id = o.id and aprovado is distinct from false and not fornecida_cliente and not (valor_unit > 0);
    if k is not null then raise exception 'Informe o valor de: %.', k; end if;
    perform public.agente_itens_gravar(o.id, (select coalesce(jsonb_agg((to_jsonb(i) - 'atualizado_em' - 'criado_em') || jsonb_build_object('aprovado', true)), '[]')
                                              from public.os_itens i where i.ordem_id = o.id and i.aprovado is null), '[]');
    if o.status in ('diagnostico', 'aguardando') then
      perform public.agente_patch_os(o.id, jsonb_build_object('status', 'execucao', 'aprovacao',
        jsonb_build_object('em', now(), 'por', coalesce(o.cliente->>'nome', ''), 'forma', 'Autorizado (registrado pelo agente a pedido de ' || v_quem || ')', 'obs', '', 'assinatura', '')
        || case when o.aprovacao is not null then jsonb_build_object('anteriores', coalesce(o.aprovacao->'anteriores', '[]') || jsonb_build_array(o.aprovacao - 'anteriores')) else '{}' end));
      feito := array_append(feito, 'aprovada: em execução');
    else feito := array_append(feito, v_pend || ' item(ns) adicional(is) aprovado(s)'); end if;
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (o.id, 'autorizar', 'Cliente autorizou (registrado pelo agente, Claude): ' || v_pend || ' item(ns).', v_quem);
  elsif v_acao = 'concluir' then
    if o.status <> 'execucao' then raise exception 'A O.S. % está "%": só O.S. em execução é concluída.', o.numero, public.agente_etapa(o); end if;
    if v_pend > 0 then raise exception 'Há % item(ns) aguardando aprovação. Use aprovar antes (ou remova).', v_pend; end if;
    perform public.agente_patch_os(o.id, jsonb_build_object('status', 'pronto'));
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (o.id, 'pronto', 'Serviço concluído. Aguardando pagamento (agente, Claude).', v_quem);
    feito := array_append(feito, 'serviço concluído: aguardando pagamento');
  elsif v_acao in ('entregar', 'retirar') then
    if v_acao = 'entregar' and o.status not in ('execucao', 'pronto') then raise exception 'A O.S. % está "%": entregar vale para O.S. em execução ou aguardando pagamento no pátio.', o.numero, public.agente_etapa(o); end if;
    if v_acao = 'retirar' and (o.status <> 'recusado' or o.entregue_em is not null) then raise exception 'Retirar vale para O.S. recusada com o veículo ainda na oficina.'; end if;
    if v_acao = 'entregar' and v_pend > 0 then raise exception 'Há % item(ns) aguardando aprovação. Use aprovar antes (ou remova).', v_pend; end if;
    if coalesce(p->>'km_saida', '') <> '' then
      v_km := nullif(regexp_replace(p->>'km_saida', '\D', '', 'g'), '')::int;
      if v_km < coalesce(o.km_entrada, 0) then raise exception 'O KM de saída (%) não pode ser menor que o de entrada (%).', v_km, o.km_entrada; end if;
    else v_km := o.km_entrada; avisos := array_append(avisos, 'KM de saída não informado: ficou o KM de entrada (' || coalesce(o.km_entrada::text, 'vazio') || ').'); end if;
    v_patch := jsonb_build_object('status', case when v_acao = 'retirar' then 'recusado' else 'entregue' end, 'km_saida', v_km, 'entregue_em', now(), 'situacao', '',
      'forma_pagamento', coalesce(nullif(trim(p->>'forma_pagamento'), ''), o.forma_pagamento, ''),
      'garantia_dias', coalesce(nullif(p->>'garantia_dias', '')::int, nullif(o.garantia_dias, 0), nullif(cfg->>'garantiaDias', '')::int, 90));
    perform public.agente_patch_os(o.id, v_patch); v_patch := '{}';
    if o.veiculo_id is not null and v_km is not null then update public.veiculos set km_atual = v_km where id = o.veiculo_id and coalesce(km_atual, 0) < v_km; end if;
    -- a prazo: parcelas a receber
    for pa in select * from jsonb_array_elements(coalesce(p->'parcelas', '[]')) loop
      if jsonb_typeof(pa->'valor') <> 'number' or (pa->>'valor')::numeric <= 0 or coalesce(pa->>'vencimento', '') !~ '^\d{4}-\d{2}-\d{2}$' then
        raise exception 'Cada parcela precisa de valor e vencimento (AAAA-MM-DD).'; end if;
      v_soma := v_soma + (pa->>'valor')::numeric;
    end loop;
    v_n := coalesce(jsonb_array_length(p->'parcelas'), 0);
    if v_n > 0 then
      v_tot := public.agente_totais_os(o.id);
      select coalesce(sum(valor), 0) into v_rec from public.recibos where ordem_id = o.id and not cancelado;
      if abs(v_soma - ((v_tot->>'total')::numeric - v_rec - coalesce((select sum(valor) from public.receber where ordem_id = o.id and status = 'aberta'), 0))) > 0.009 then
        avisos := array_append(avisos, 'As parcelas somam ' || public.agente_reais(v_soma) || ' e o saldo sem parcela é ' ||
          public.agente_reais((v_tot->>'total')::numeric - v_rec - coalesce((select sum(valor) from public.receber where ordem_id = o.id and status = 'aberta'), 0)) || '.');
      end if;
      insert into public.receber (ordem_id, cliente_id, cliente_nome, descricao, forma, parcela, parcelas, valor, vencimento, obs, criado_por)
      select o.id, o.cliente_id, coalesce(o.cliente->>'nome', ''), 'O.S. ' || o.numero, coalesce(nullif(x.e->>'forma', ''), nullif(trim(p->>'forma_pagamento'), ''), 'Boleto'),
             x.n, v_n, round((x.e->>'valor')::numeric, 2), (x.e->>'vencimento')::date, 'Lançado pelo agente (Claude).', v_quem
      from jsonb_array_elements(p->'parcelas') with ordinality x(e, n);
      feito := array_append(feito, v_n || ' parcela(s) a receber lançada(s)');
    end if;
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
    values (o.id, 'entrega', case when v_acao = 'retirar' then 'Veículo retirado sem execução' else 'Veículo entregue' end || coalesce(' com ' || v_km || ' km', '') || ' (agente, Claude).', v_quem);
    feito := array_append(feito, case when v_acao = 'retirar' then 'retirada registrada' else 'veículo entregue' end);
  elsif v_acao = 'recusar' then
    if o.status not in ('diagnostico', 'aguardando') then raise exception 'A O.S. % está "%": só orçamento é recusado (para desistir depois de aprovada, use cancelar).', o.numero, public.agente_etapa(o); end if;
    perform public.agente_itens_gravar(o.id, (select coalesce(jsonb_agg((to_jsonb(i) - 'atualizado_em' - 'criado_em') || jsonb_build_object('aprovado', false)), '[]')
                                              from public.os_itens i where i.ordem_id = o.id and i.aprovado is null), '[]');
    perform public.agente_patch_os(o.id, jsonb_build_object('status', 'recusado'));
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (o.id, 'recusa', 'Orçamento recusado pelo cliente (agente, Claude).', v_quem);
    feito := array_append(feito, 'orçamento recusado');
  elsif v_acao = 'cancelar' then
    if o.status = 'cancelado' then raise exception 'A O.S. % já está cancelada.', o.numero; end if;
    if coalesce(trim(p->>'motivo'), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
    select coalesce(sum(valor), 0) into v_rec from public.recibos where ordem_id = o.id and not cancelado;
    if v_rec > 0 then avisos := array_append(avisos, 'A O.S. tem ' || public.agente_reais(v_rec) || ' em recibos, que continuam valendo. Cancele-os com cancelar_recibo se for o caso.'); end if;
    if exists (select 1 from public.receber where ordem_id = o.id and status = 'aberta') then
      update public.receber set status = 'cancelada', obs = trim(obs || ' Cancelada com a O.S. (agente).') where ordem_id = o.id and status = 'aberta';
      avisos := array_append(avisos, 'As parcelas a receber em aberto foram canceladas.');
    end if;
    perform public.agente_patch_os(o.id, jsonb_build_object('status', 'cancelado', 'motivo_cancelamento', trim(p->>'motivo')));
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (o.id, 'cancelamento', 'O.S. cancelada pelo agente (Claude). Motivo: ' || trim(p->>'motivo') || '.', v_quem);
    feito := array_append(feito, 'cancelada');
  end if;

  -- ---------- total e custo de novo (itens ou etapa podem ter mudado) ----------
  select * into o from public.ordens where id = o.id;
  if o.status <> 'cancelado' then
    v_tot := public.agente_totais_os(o.id);
    if (v_tot->>'total')::numeric is distinct from o.total or (v_tot->>'custo')::numeric is distinct from o.custo then
      perform public.agente_patch_os(o.id, v_tot);
      if o.status in ('pronto', 'entregue') or coalesce(o.recebido, 0) > 0 then
        avisos := array_append(avisos, 'O total mudou de ' || public.agente_reais(o.total) || ' para ' || public.agente_reais((v_tot->>'total')::numeric) || ': confira recibos e parcelas.');
      end if;
    end if;
  end if;
  if array_length(feito, 1) is null then raise exception 'Nada a fazer: informe acao, dados, itens ou cliente/veículo.'; end if;

  select * into o from public.ordens where id = o.id;
  r := public.agente_os_json(o);
  perform public.agente_registrar('alterar_os', p, 'ordens', o.id::text, v_antes, r);
  return r || jsonb_build_object('feito', to_jsonb(feito), 'avisos', to_jsonb(avisos));
end $$;

-- =====================================================================
-- 2. Cadastro de cliente e veículo
-- p: tipo (cliente | veiculo); acao (criar | editar | excluir); id, ou codigo/placa; campos {..}
-- Editar nome/telefone/documento do cliente (ou dados do veículo) atualiza também a cópia nas O.S. em aberto.
-- =====================================================================
create or replace function public.agente_salvar_cadastro(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_tipo text := lower(coalesce(p->>'tipo', '')); v_acao text := lower(coalesce(p->>'acao', 'editar'));
  v_tab text; v_id uuid; v_antes jsonb; v_campos jsonb; v_cols text; v_novo jsonb; o public.ordens; v_n int := 0; k text; avisos text[] := '{}';
  c_proib text[] := array['id', 'codigo', 'criado_em', 'atualizado_em'];
begin
  if v_tipo not in ('cliente', 'veiculo') then raise exception 'tipo deve ser cliente ou veiculo.'; end if;
  if v_acao not in ('criar', 'editar', 'excluir') then raise exception 'acao deve ser criar, editar ou excluir.'; end if;
  v_tab := case v_tipo when 'cliente' then 'clientes' else 'veiculos' end;
  v_campos := public.agente_campos(v_tab, p->'campos', c_proib);
  -- telefone, documento e CEP só com números; placa em maiúsculas sem traço
  for k in select jsonb_object_keys(v_campos) loop
    if k in ('telefone', 'telefone2', 'telefone3', 'doc', 'cep') then v_campos := jsonb_set(v_campos, array[k], to_jsonb(regexp_replace(coalesce(v_campos->>k, ''), '\D', '', 'g'))); end if;
    if k = 'placa' then v_campos := jsonb_set(v_campos, array[k], to_jsonb(upper(regexp_replace(coalesce(v_campos->>k, ''), '[^A-Za-z0-9]', '', 'g')))); end if;
  end loop;

  if v_acao <> 'criar' then
    if coalesce(p->>'id', '') <> '' then v_id := (p->>'id')::uuid;
    elsif v_tipo = 'cliente' and coalesce(p->>'codigo', '') ~ '^\d+$' then select id into v_id from public.clientes where codigo = (p->>'codigo')::int;
    elsif v_tipo = 'veiculo' and coalesce(p->>'placa', '') <> '' then select id into v_id from public.veiculos where placa = upper(regexp_replace(p->>'placa', '[^A-Za-z0-9]', '', 'g'));
    end if;
    execute format('select to_jsonb(t) from public.%I t where id = $1', v_tab) into v_antes using v_id;
    if v_antes is null then raise exception '% não encontrado (informe id%).', initcap(v_tipo), case v_tipo when 'cliente' then ', ou codigo' else ', ou placa' end; end if;
  end if;

  if v_acao = 'excluir' then
    begin
      execute format('delete from public.%I where id = $1', v_tab) using v_id;
    exception when foreign_key_violation then
      raise exception 'Não dá para excluir: % tem O.S.%. Edite ou deixe o cadastro.', case v_tipo when 'cliente' then 'o cliente' else 'o veículo' end,
        case v_tipo when 'cliente' then ' ou veículos ligados' else ' ligadas' end;
    end;
    perform public.agente_registrar('salvar_cadastro', p, v_tab, v_id::text, v_antes, jsonb_build_object('excluido', true));
    return jsonb_build_object('tipo', v_tipo, 'excluido', true, 'cadastro', v_antes);
  end if;

  if v_campos = '{}'::jsonb then raise exception 'Informe os campos.'; end if;
  if v_acao = 'criar' then
    if v_tipo = 'cliente' and coalesce(v_campos->>'nome', '') = '' then raise exception 'Informe o nome do cliente.'; end if;
    if v_tipo = 'veiculo' and coalesce(v_campos->>'placa', '') = '' then raise exception 'Informe a placa.'; end if;
    select string_agg(format('%I', x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1) returning to_jsonb(%I.*)', v_tab, v_cols, v_cols, v_tab, v_tab)
      into v_novo using v_campos;
  else
    select string_agg(format('%I = r.%I', x, x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('update public.%I t set %s from jsonb_populate_record(null::public.%I, $1) r where t.id = $2 returning to_jsonb(t.*)', v_tab, v_cols, v_tab)
      into v_novo using v_campos, v_id;
    -- cópia nas O.S. em aberto
    for o in select * from public.ordens where (case v_tipo when 'cliente' then cliente_id else veiculo_id end) = v_id
               and status not in ('cancelado', 'recusado') and not (status = 'entregue' and finalizada_em is not null) loop
      if v_tipo = 'cliente' then
        perform public.agente_patch_os(o.id, jsonb_build_object('cliente', coalesce(o.cliente, '{}') || jsonb_build_object('nome', v_novo->>'nome', 'telefone', coalesce(v_novo->>'telefone', ''), 'doc', coalesce(v_novo->>'doc', ''))));
      else
        perform public.agente_patch_os(o.id, jsonb_build_object('veiculo', coalesce(o.veiculo, '{}') || jsonb_build_object('placa', v_novo->>'placa', 'marca', v_novo->>'marca', 'modelo', v_novo->>'modelo', 'ano', v_novo->>'ano', 'cor', coalesce(v_novo->>'cor', ''))));
      end if;
      v_n := v_n + 1;
    end loop;
    if v_n > 0 then avisos := array_append(avisos, v_n || ' O.S. em aberto atualizada(s) com o cadastro novo.'); end if;
  end if;
  perform public.agente_registrar('salvar_cadastro', p, v_tab, v_novo->>'id', v_antes, v_novo);
  return jsonb_build_object('tipo', v_tipo, 'acao', v_acao, 'cadastro', v_novo - 'ficha', 'avisos', to_jsonb(avisos));
end $$;

-- =====================================================================
-- 3. Contas a pagar
-- p: acao (lancar | pagar | desfazer | editar | cancelar | excluir)
--    lancar: contas [{descricao, valor, vencimento, fornecedor (nome ou CNPJ), favorecido, categoria, documento,
--            linha_digitavel ou codigo_barras, emissao, parcela, parcelas, obs}]
--    demais: id (de contas_a_pagar) ou busca (texto) + vencimento opcional
--    pagar: conta_origem (padrão: conta de pagamento dos Ajustes), pago_em (padrão hoje), juros, desconto, valor_pago, forma_pagamento
--    editar: campos {..}
-- =====================================================================
create or replace function public.agente_conta(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_acao text := lower(coalesce(p->>'acao', '')); c public.contas; v_antes jsonb; v_novo jsonb; cj jsonb; v_lista jsonb := '[]';
  f public.fornecedores; v_barras text; v_valor numeric; v_venc date; v_fator int; v_conta text; v_pago date; v_juros numeric; v_desc numeric; v_vp numeric;
  v_hoje date := public.agente_hoje(); v_n int; v_cols text; v_campos jsonb; avisos text[] := '{}'; v_cand jsonb;
begin
  if v_acao not in ('lancar', 'pagar', 'desfazer', 'editar', 'cancelar', 'excluir') then raise exception 'acao deve ser lancar, pagar, desfazer, editar, cancelar ou excluir.'; end if;

  if v_acao = 'lancar' then
    if jsonb_typeof(p->'contas') is distinct from 'array' or jsonb_array_length(p->'contas') = 0 then raise exception 'Informe contas: [{descricao, valor, vencimento}].'; end if;
    for cj in select * from jsonb_array_elements(p->'contas') loop
      f := null; v_barras := public.agente_barras(coalesce(nullif(cj->>'codigo_barras', ''), cj->>'linha_digitavel'));
      if coalesce(cj->>'linha_digitavel', cj->>'codigo_barras', '') <> '' and v_barras = '' then raise exception 'Código do boleto "%" não tem 44, 47 ou 48 dígitos.', coalesce(cj->>'linha_digitavel', cj->>'codigo_barras'); end if;
      -- valor e vencimento do próprio boleto bancário, se não vierem (fator de vencimento reiniciado em 22/02/2025)
      v_valor := nullif(cj->>'valor', '')::numeric; v_venc := nullif(cj->>'vencimento', '')::date;
      if v_barras <> '' and left(v_barras, 1) <> '8' then
        if v_valor is null then v_valor := substr(v_barras, 10, 10)::numeric / 100; end if;
        v_fator := substr(v_barras, 6, 4)::int;
        if v_venc is null and v_fator >= 1000 then v_venc := date '2025-02-22' + (v_fator - 1000); end if;
      end if;
      if coalesce(v_valor, 0) <= 0 then raise exception 'Conta "%": informe o valor.', coalesce(cj->>'descricao', ''); end if;
      if v_venc is null then raise exception 'Conta "%": informe o vencimento.', coalesce(cj->>'descricao', ''); end if;
      if coalesce(cj->>'fornecedor', '') <> '' then
        select * into f from public.fornecedores x
          where (length(regexp_replace(cj->>'fornecedor', '\D', '', 'g')) = 14 and regexp_replace(x.cnpj, '\D', '', 'g') = regexp_replace(cj->>'fornecedor', '\D', '', 'g'))
             or lower(x.razao) like '%' || lower(trim(cj->>'fornecedor')) || '%' or lower(x.fantasia) like '%' || lower(trim(cj->>'fornecedor')) || '%'
          order by (lower(x.fantasia) = lower(trim(cj->>'fornecedor')) or lower(x.razao) = lower(trim(cj->>'fornecedor'))) desc limit 1;
        if f.id is null then avisos := array_append(avisos, 'Fornecedor "' || (cj->>'fornecedor') || '" não está cadastrado: ficou só como favorecido.'); end if;
      end if;
      if v_barras <> '' and exists (select 1 from public.contas where codigo_barras = v_barras and status <> 'cancelada') then
        raise exception 'Este boleto já está lançado: %.', (select descricao || ', ' || public.agente_reais(valor) || ', vencimento ' || to_char(vencimento, 'DD/MM/YYYY') || ' (' || status || ')'
                                                           from public.contas where codigo_barras = v_barras and status <> 'cancelada' limit 1);
      end if;
      if v_barras = '' and exists (select 1 from public.contas where status = 'aberta' and abs(valor - v_valor) < 0.01 and abs(vencimento - v_venc) <= 5) then
        avisos := array_append(avisos, 'Já existe conta em aberto de ' || public.agente_reais(v_valor) || ' com vencimento próximo: confira se não é a mesma.');
      end if;
      insert into public.contas (descricao, fornecedor_id, favorecido, categoria, documento, valor, emissao, vencimento, linha_digitavel, codigo_barras,
                                 parcela, parcelas, origem, obs, criado_por)
      values (coalesce(nullif(trim(cj->>'descricao'), ''), 'Conta ' || coalesce(f.fantasia, f.razao, cj->>'favorecido', '')), f.id,
              coalesce(nullif(trim(cj->>'favorecido'), ''), nullif(f.fantasia, ''), f.razao, trim(coalesce(cj->>'fornecedor', ''))),
              coalesce(nullif(trim(cj->>'categoria'), ''), case when f.id is not null and to_jsonb(f) ? 'categoria_padrao' then to_jsonb(f)->>'categoria_padrao' end, ''),
              coalesce(cj->>'documento', ''), round(v_valor, 2), nullif(cj->>'emissao', '')::date, v_venc,
              regexp_replace(coalesce(cj->>'linha_digitavel', ''), '\D', '', 'g'), v_barras,
              nullif(cj->>'parcela', '')::int, nullif(cj->>'parcelas', '')::int, case when v_barras <> '' then 'boleto' else 'manual' end,
              trim(coalesce(cj->>'obs', '') || ' Lançada pelo agente (Claude).'), public.agente_quem())
      returning to_jsonb(contas.*) into v_novo;
      v_lista := v_lista || jsonb_build_array(jsonb_build_object('id', v_novo->>'id', 'descricao', v_novo->>'descricao', 'favorecido', v_novo->>'favorecido',
        'valor', (v_novo->>'valor')::numeric, 'vencimento', v_novo->>'vencimento', 'categoria', v_novo->>'categoria', 'boleto', v_barras <> ''));
      perform public.agente_registrar('conta_pagar', p, 'contas', v_novo->>'id', null, v_novo);
    end loop;
    return jsonb_build_object('acao', 'lancar', 'contas', v_lista, 'total', (select sum((x->>'valor')::numeric) from jsonb_array_elements(v_lista) x), 'avisos', to_jsonb(avisos));
  end if;

  -- localizar a conta
  if coalesce(p->>'id', '') <> '' then select * into c from public.contas where id = (p->>'id')::uuid for update;
  elsif coalesce(trim(p->>'busca'), '') <> '' then
    select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'descricao', x.descricao, 'favorecido', x.favorecido, 'vencimento', x.vencimento, 'valor', x.valor, 'situacao', x.status) order by x.vencimento), '[]'), count(*)
      into v_cand, v_n
    from public.contas x left join public.fornecedores fo on fo.id = x.fornecedor_id
    where (case when v_acao in ('pagar', 'cancelar') then x.status = 'aberta' when v_acao = 'desfazer' then x.status = 'paga' else true end)
      and (nullif(p->>'vencimento', '') is null or x.vencimento = (p->>'vencimento')::date)
      and (nullif(p->>'valor', '') is null or abs(x.valor - (p->>'valor')::numeric) < 0.01)
      and concat_ws(' ', x.descricao, x.favorecido, x.documento, fo.razao, fo.fantasia) ilike '%' || trim(p->>'busca') || '%';
    if v_n = 0 then raise exception 'Nenhuma conta encontrada para "%".', p->>'busca'; end if;
    if v_n > 1 then raise exception 'Achei % contas para "%": diga qual (id): %', v_n, p->>'busca', left(v_cand::text, 1500); end if;
    select * into c from public.contas where id = (v_cand->0->>'id')::uuid for update;
  else raise exception 'Informe o id da conta (contas_a_pagar) ou uma busca.'; end if;
  if c.id is null then raise exception 'Conta não encontrada.'; end if;
  v_antes := to_jsonb(c);

  if v_acao = 'pagar' then
    if c.status <> 'aberta' then raise exception 'A conta "%" está %.', c.descricao, c.status; end if;
    v_conta := public.agente_conta_valida(coalesce(nullif(trim(p->>'conta_origem'), ''), (select dados->>'contaPagamento' from public.config where id = 1)));
    v_pago := coalesce(nullif(p->>'pago_em', '')::date, v_hoje);
    if v_pago > v_hoje then raise exception 'A data do pagamento não pode ser no futuro.'; end if;
    v_juros := round(coalesce(nullif(p->>'juros', '')::numeric, 0), 2); v_desc := round(coalesce(nullif(p->>'desconto', '')::numeric, 0), 2);
    if nullif(p->>'valor_pago', '') is not null and not (p ? 'juros') and not (p ? 'desconto') then
      v_vp := round((p->>'valor_pago')::numeric, 2);
      if v_vp > c.valor then v_juros := v_vp - c.valor; elsif v_vp < c.valor then v_desc := c.valor - v_vp; end if;
    end if;
    v_vp := round(c.valor + v_juros - v_desc, 2);
    if v_pago > c.vencimento and v_juros = 0 then avisos := array_append(avisos, 'Pago ' || (v_pago - c.vencimento) || ' dia(s) depois do vencimento, sem juros informados.'); end if;
    update public.contas set status = 'paga', pago_em = v_pago, juros = v_juros, desconto = v_desc, valor_pago = v_vp, conta_origem = v_conta,
      forma_pagamento = coalesce(nullif(trim(p->>'forma_pagamento'), ''), nullif(forma_pagamento, ''), case when codigo_barras <> '' then 'Boleto' else '' end)
    where id = c.id;
  elsif v_acao = 'desfazer' then
    if c.status <> 'paga' then raise exception 'A conta "%" não está paga.', c.descricao; end if;
    update public.contas set status = 'aberta', pago_em = null, valor_pago = null, juros = 0, desconto = 0, conta_origem = '' where id = c.id;
  elsif v_acao = 'cancelar' then
    if c.status = 'cancelada' then raise exception 'A conta já está cancelada.'; end if;
    if c.status = 'paga' then raise exception 'A conta "%" está paga: desfaça o pagamento antes de cancelar.', c.descricao; end if;
    update public.contas set status = 'cancelada', obs = trim(obs || ' Cancelada pelo agente (Claude).') where id = c.id;
  elsif v_acao = 'excluir' then
    delete from public.contas where id = c.id;
    perform public.agente_registrar('conta_pagar', p, 'contas', c.id::text, v_antes, jsonb_build_object('excluida', true));
    return jsonb_build_object('acao', 'excluir', 'excluida', true, 'conta', jsonb_build_object('descricao', c.descricao, 'valor', c.valor, 'vencimento', c.vencimento, 'situacao', c.status));
  elsif v_acao = 'editar' then
    v_campos := public.agente_campos('contas', p->'campos', array['id', 'criado_em', 'atualizado_em', 'status', 'pago_registrado_em']);
    if v_campos ? 'linha_digitavel' then v_campos := v_campos || jsonb_build_object('codigo_barras', public.agente_barras(v_campos->>'linha_digitavel'), 'linha_digitavel', regexp_replace(v_campos->>'linha_digitavel', '\D', '', 'g')); end if;
    if v_campos ? 'conta_origem' and coalesce(v_campos->>'conta_origem', '') <> '' then v_campos := jsonb_set(v_campos, '{conta_origem}', to_jsonb(public.agente_conta_valida(v_campos->>'conta_origem'))); end if;
    if v_campos = '{}'::jsonb then raise exception 'Informe os campos a mudar.'; end if;
    select string_agg(format('%I = r.%I', x, x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('update public.contas t set %s from jsonb_populate_record(null::public.contas, $1) r where t.id = $2', v_cols) using v_campos, c.id;
  end if;
  select to_jsonb(x) into v_novo from public.contas x where x.id = c.id;
  perform public.agente_registrar('conta_pagar', p, 'contas', c.id::text, v_antes, v_novo);
  return jsonb_build_object('acao', v_acao, 'conta', jsonb_build_object('id', c.id, 'descricao', v_novo->>'descricao', 'favorecido', v_novo->>'favorecido',
    'valor', (v_novo->>'valor')::numeric, 'vencimento', v_novo->>'vencimento', 'situacao', v_novo->>'status', 'pago_em', v_novo->>'pago_em',
    'valor_pago', (v_novo->>'valor_pago')::numeric, 'juros', (v_novo->>'juros')::numeric, 'desconto', (v_novo->>'desconto')::numeric,
    'saiu_da_conta', v_novo->>'conta_origem', 'forma', v_novo->>'forma_pagamento'), 'avisos', to_jsonb(avisos));
end $$;

-- =====================================================================
-- 4. Saldos das contas (o mesmo "Atualizar saldos" da tela)
-- p: contas [{nome, saldo}] — conta não citada mantém o saldo calculado; nova = incluída;
--    conta_pagamento / conta_recebimento (opcionais)
-- =====================================================================
create or replace function public.agente_guardar_saldos(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare atuais jsonb := public.saldos_contas(); cfg jsonb; v_lista jsonb := '[]'; v_at jsonb; c jsonb; v_nome text; v_novas jsonb; v_pag text; v_rec text;
begin
  select dados into cfg from public.config where id = 1;
  if jsonb_typeof(p->'contas') is distinct from 'array' or jsonb_array_length(p->'contas') = 0 then raise exception 'Informe contas: [{nome, saldo}].'; end if;
  for c in select * from jsonb_array_elements(p->'contas') loop
    if coalesce(trim(c->>'nome'), '') = '' or jsonb_typeof(c->'saldo') <> 'number' then raise exception 'Cada conta precisa de nome e saldo.'; end if;
  end loop;
  -- as atuais (citadas com o saldo novo; as outras mantêm o calculado) + as novas
  for v_at in select * from jsonb_array_elements(coalesce(atuais, '[]')) loop
    select e into c from jsonb_array_elements(p->'contas') e where lower(public.unaccent_simples(e->>'nome')) = lower(public.unaccent_simples(v_at->>'nome')) limit 1;
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('nome', v_at->>'nome', 'antigo', v_at->>'nome', 'saldo', case when c is null then null else c->'saldo' end));
  end loop;
  for c in select * from jsonb_array_elements(p->'contas') loop
    if not exists (select 1 from jsonb_array_elements(coalesce(atuais, '[]')) x where lower(public.unaccent_simples(x->>'nome')) = lower(public.unaccent_simples(c->>'nome'))) then
      v_lista := v_lista || jsonb_build_array(jsonb_build_object('nome', trim(c->>'nome'), 'saldo', c->'saldo'));
    end if;
  end loop;
  v_pag := coalesce(nullif(trim(p->>'conta_pagamento'), ''), cfg->>'contaPagamento', ''); v_rec := coalesce(nullif(trim(p->>'conta_recebimento'), ''), cfg->>'contaRecebimento', '');
  v_novas := public.guardar_saldos_contas(v_lista, v_pag, v_rec, public.agente_quem());
  perform public.agente_registrar('atualizar_saldos', p, 'config', 'contasFinanceiras', atuais, v_novas);
  return jsonb_build_object('antes', (select jsonb_agg(jsonb_build_object('conta', x->>'nome', 'saldo_atual', (x->>'atual')::numeric)) from jsonb_array_elements(atuais) x),
    'depois', (select jsonb_agg(jsonb_build_object('conta', x->>'nome', 'saldo', (x->>'saldo')::numeric)) from jsonb_array_elements(v_novas) x),
    'conta_pagamento', v_pag, 'conta_recebimento', v_rec);
end $$;

-- =====================================================================
-- 5. Transferência entre contas (não é receita nem despesa)
-- p: acao (transferir | excluir); de, para, valor, data, obs; excluir: id
-- =====================================================================
create or replace function public.agente_transferencia(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', 'transferir')); t public.transferencias; v_data date; v_de text; v_para text;
begin
  if v_acao = 'excluir' then
    select * into t from public.transferencias where id = nullif(p->>'id', '')::uuid;
    if t.id is null then raise exception 'Transferência não encontrada (informe o id).'; end if;
    delete from public.transferencias where id = t.id;
    perform public.agente_registrar('transferir', p, 'transferencias', t.id::text, to_jsonb(t), jsonb_build_object('excluida', true));
    return jsonb_build_object('excluida', true, 'de', t.de_conta, 'para', t.para_conta, 'valor', t.valor, 'data', t.data);
  end if;
  if v_acao <> 'transferir' then raise exception 'acao deve ser transferir ou excluir.'; end if;
  v_de := public.agente_conta_valida(p->>'de'); v_para := public.agente_conta_valida(p->>'para');
  if v_de = v_para then raise exception 'Conta de origem e de destino são a mesma.'; end if;
  if jsonb_typeof(p->'valor') <> 'number' or (p->>'valor')::numeric <= 0 then raise exception 'Informe o valor.'; end if;
  v_data := coalesce(nullif(p->>'data', '')::date, public.agente_hoje());
  if v_data > public.agente_hoje() then raise exception 'A data não pode ser no futuro.'; end if;
  insert into public.transferencias (data, de_conta, para_conta, valor, obs, criado_por)
  values (v_data, v_de, v_para, round((p->>'valor')::numeric, 2), trim(coalesce(p->>'obs', '') || ' (agente, Claude)'), public.agente_quem()) returning * into t;
  perform public.agente_registrar('transferir', p, 'transferencias', t.id::text, null, to_jsonb(t));
  return jsonb_build_object('id', t.id, 'de', t.de_conta, 'para', t.para_conta, 'valor', t.valor, 'data', t.data,
    'saldos', (select jsonb_agg(jsonb_build_object('conta', x->>'nome', 'saldo_atual', (x->>'atual')::numeric)) from jsonb_array_elements(public.saldos_contas()) x));
end $$;

-- =====================================================================
-- 6. Cancelar recibo — e as parcelas que ele tinha baixado voltam a ficar em aberto
-- p: numero (do recibo), motivo
-- =====================================================================
create or replace function public.agente_recibo(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare r public.recibos; v_n int; o public.ordens;
begin
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número do recibo.'; end if;
  select * into r from public.recibos where numero = (p->>'numero')::int for update;
  if r.id is null then raise exception 'Recibo % não encontrado.', p->>'numero'; end if;
  if r.cancelado then raise exception 'O recibo % já está cancelado.', r.numero; end if;
  if exists (select 1 from public.boletos b where b.recibo_id = r.id) then
    raise exception 'O recibo % veio de um boleto pago no banco: cancele pela tela de Boletos Sicredi, se for mesmo o caso.', r.numero;
  end if;
  update public.recibos set cancelado = true, cancelado_motivo = 'Cancelado pelo agente (Claude) a pedido de ' || public.agente_quem() || ' em ' || to_char(public.agente_hoje(), 'DD/MM/YYYY')
    || coalesce(': ' || nullif(trim(p->>'motivo'), ''), '') where id = r.id;
  update public.receber set status = 'aberta', pago_em = null, recibo_id = null where recibo_id = r.id and status = 'paga';
  get diagnostics v_n = row_count;
  if r.ordem_id is not null then
    insert into public.eventos (ordem_id, tipo, texto, usuario_nome) values (r.ordem_id, 'recibo', 'Recibo ' || lpad(r.numero::text, 5, '0') || ' cancelado pelo agente (Claude).', public.agente_quem());
    select * into o from public.ordens where id = r.ordem_id;
  end if;
  perform public.agente_registrar('cancelar_recibo', p, 'recibos', r.id::text, to_jsonb(r), jsonb_build_object('cancelado', true, 'parcelas_reabertas', v_n));
  return jsonb_build_object('recibo', r.numero, 'valor', r.valor, 'pagador', r.pagador, 'forma', r.forma, 'conta', r.conta_destino, 'data', r.data, 'cancelado', true,
    'parcelas_reabertas', v_n, 'os', o.numero, 'etapa_os', case when o.id is not null then public.agente_etapa(o) end);
end $$;

-- =====================================================================
-- 7. Estoque: entrada, saída e ajuste (contagem)
-- p: movimentos [{codigo, tipo (entrada|saida|ajuste), qtd, custo (entrada), obs}]
-- =====================================================================
create or replace function public.agente_movimentar_estoque(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare m jsonb; pr public.produtos; v_novo numeric; v_lista jsonb := '[]'; v_tipo text;
begin
  if jsonb_typeof(p->'movimentos') is distinct from 'array' or jsonb_array_length(p->'movimentos') = 0 then raise exception 'Informe movimentos: [{codigo, tipo, qtd}].'; end if;
  for m in select * from jsonb_array_elements(p->'movimentos') loop
    v_tipo := lower(coalesce(m->>'tipo', ''));
    if v_tipo not in ('entrada', 'saida', 'ajuste') then raise exception 'Tipo "%" inválido: entrada, saida ou ajuste (ajuste = contagem, define o saldo).', m->>'tipo'; end if;
    if jsonb_typeof(m->'qtd') <> 'number' or ((m->>'qtd')::numeric <= 0 and v_tipo <> 'ajuste') or (m->>'qtd')::numeric < 0 then raise exception 'Quantidade inválida para %.', coalesce(m->>'codigo', '?'); end if;
    select * into pr from public.produtos x where x.tipo = 'produto' and (x.codigo::text = trim(coalesce(m->>'codigo', '')) or lower(coalesce(x.codigo_barras, '')) = lower(trim(coalesce(m->>'codigo', '')))) order by x.ativo desc limit 1;
    if pr.id is null then raise exception 'Código % não existe no estoque.', coalesce(m->>'codigo', '?'); end if;
    v_novo := public.movimentar_estoque(pr.id, v_tipo, (m->>'qtd')::numeric, nullif(m->>'custo', '')::numeric, trim(coalesce(m->>'obs', '') || ' (agente, Claude)'));
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('codigo', pr.codigo, 'descricao', pr.descricao, 'tipo', v_tipo, 'qtd', (m->>'qtd')::numeric,
      'saldo_antes', pr.estoque_atual, 'saldo_novo', v_novo, 'custo', coalesce(nullif(m->>'custo', '')::numeric, pr.custo)));
  end loop;
  perform public.agente_registrar('movimentar_estoque', p, 'estoque_mov', '', null, v_lista);
  return jsonb_build_object('movimentos', v_lista);
end $$;

-- =====================================================================
-- 8. Produto (e serviço do catálogo)
-- p: acao (criar | editar | inativar | ativar | excluir); codigo ou id; campos {..}; estoque_inicial (criar)
-- =====================================================================
create or replace function public.agente_produto(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v_acao text := lower(coalesce(p->>'acao', 'editar')); pr public.produtos; v_antes jsonb; v_novo jsonb; v_campos jsonb; v_cols text; avisos text[] := '{}'; v_usos int;
begin
  if v_acao not in ('criar', 'editar', 'inativar', 'ativar', 'excluir') then raise exception 'acao deve ser criar, editar, inativar, ativar ou excluir.'; end if;
  v_campos := public.agente_campos('produtos', p->'campos', array['id', 'codigo', 'estoque_atual', 'criado_em', 'atualizado_em']);
  if v_acao <> 'criar' then
    select * into pr from public.produtos x where (nullif(p->>'id', '') is not null and x.id = (p->>'id')::uuid) or (nullif(p->>'codigo', '') is not null and x.codigo::text = trim(p->>'codigo')) limit 1 for update;
    if pr.id is null then raise exception 'Produto não encontrado (informe codigo ou id).'; end if;
    v_antes := to_jsonb(pr);
  end if;
  if v_acao = 'excluir' then
    select count(*) into v_usos from public.os_itens where produto_id = pr.id;
    if v_usos > 0 then avisos := array_append(avisos, 'O produto estava em ' || v_usos || ' item(ns) de O.S.: os itens ficam, sem ligação com o estoque.'); end if;
    if exists (select 1 from public.estoque_reserva where produto_id = pr.id) then raise exception 'O produto está reservado em O.S. em aberto: tire das O.S. ou inative em vez de excluir.'; end if;
    delete from public.produtos where id = pr.id;
    perform public.agente_registrar('produto', p, 'produtos', pr.id::text, v_antes, jsonb_build_object('excluido', true));
    return jsonb_build_object('acao', 'excluir', 'excluido', true, 'codigo', pr.codigo, 'descricao', pr.descricao, 'estoque', pr.estoque_atual, 'avisos', to_jsonb(avisos));
  end if;
  if v_acao in ('inativar', 'ativar') then v_campos := v_campos || jsonb_build_object('ativo', v_acao = 'ativar'); end if;
  if v_campos = '{}'::jsonb and not (v_acao = 'criar' and p ? 'estoque_inicial') then raise exception 'Informe os campos.'; end if;
  if v_acao = 'criar' then
    if coalesce(trim(v_campos->>'descricao'), '') = '' then raise exception 'Informe a descrição.'; end if;
    select string_agg(format('%I', x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('insert into public.produtos (%s) select %s from jsonb_populate_record(null::public.produtos, $1) returning *', v_cols, v_cols) into pr using v_campos;
    if jsonb_typeof(p->'estoque_inicial') = 'number' and (p->>'estoque_inicial')::numeric > 0 then
      perform public.movimentar_estoque(pr.id, 'entrada', (p->>'estoque_inicial')::numeric, nullif(v_campos->>'custo', '')::numeric, 'Estoque inicial (agente, Claude)');
    end if;
  else
    select string_agg(format('%I = r.%I', x, x), ', ') into v_cols from jsonb_object_keys(v_campos) x;
    execute format('update public.produtos t set %s from jsonb_populate_record(null::public.produtos, $1) r where t.id = $2', v_cols) using v_campos, pr.id;
  end if;
  select to_jsonb(x) into v_novo from public.produtos x where x.id = pr.id;
  if (v_novo->>'tipo') = 'produto' and coalesce((v_novo->>'preco_vista')::numeric, 0) = 0 then avisos := array_append(avisos, 'Produto sem preço de venda à vista.'); end if;
  perform public.agente_registrar('produto', p, 'produtos', pr.id::text, v_antes, v_novo);
  return jsonb_build_object('acao', v_acao, 'produto', jsonb_build_object('codigo', (v_novo->>'codigo')::int, 'descricao', v_novo->>'descricao', 'tipo', v_novo->>'tipo',
    'estoque', (v_novo->>'estoque_atual')::numeric, 'custo', (v_novo->>'custo')::numeric, 'preco_vista', (v_novo->>'preco_vista')::numeric,
    'preco_prazo', (v_novo->>'preco_prazo')::numeric, 'ativo', (v_novo->>'ativo')::boolean, 'referencia', v_novo->>'referencia', 'marca', v_novo->>'marca'),
    'avisos', to_jsonb(avisos));
end $$;

-- =====================================================================
-- Entrada única do conector: faz de verdade; na prévia desfaz tudo no fim
-- =====================================================================
create or replace function public.agente_fazer(p_acao text, p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v jsonb; v_fn text;
begin
  perform public.agente_exige_admin();
  v_fn := case p_acao when 'alterar_os' then 'agente_alterar_os' when 'salvar_cadastro' then 'agente_salvar_cadastro'
                      when 'conta_pagar' then 'agente_conta' when 'atualizar_saldos' then 'agente_guardar_saldos'
                      when 'transferir' then 'agente_transferencia' when 'cancelar_recibo' then 'agente_recibo'
                      when 'movimentar_estoque' then 'agente_movimentar_estoque' when 'produto' then 'agente_produto' end;
  if v_fn is null then raise exception 'Ação desconhecida: %', p_acao; end if;
  begin
    execute format('select public.%I($1)', v_fn) into v using coalesce(p, '{}'::jsonb);
    if not coalesce(p_gravar, false) then raise exception using errcode = 'DT001', message = 'previa'; end if;
  exception when sqlstate 'DT001' then
    return v || jsonb_build_object('gravado', false, 'previa', true);
  end;
  return v || jsonb_build_object('gravado', true);
end $$;

-- =====================================================================
-- receber_os (v37) passa a aceitar sinal/adiantamento em O.S. ainda não entregue
-- (a tela já deixa: "Emitir recibo de pagamento (sinal / adiantamento)"). Só muda o bloco da etapa.
-- =====================================================================
do $$
declare src text;
begin
  select pg_get_functiondef('public.agente_receber_os(jsonb, boolean)'::regprocedure) into src;
  if src like '%v40: sinal%' then return; end if;
  src := replace(src,
$a$  if o.status = 'pronto' then
    erros := array_append(erros, 'A O.S. ' || o.numero || ' ainda está no pátio (aguardando pagamento, veículo não entregue). Entregue pela tela (pede o KM de saída) e depois receba.');
  elsif o.status <> 'entregue' then$a$,
$b$  if o.status in ('diagnostico', 'aguardando', 'execucao', 'pronto') then -- v40: sinal / adiantamento (a O.S. fecha quando for entregue e estiver quitada)
    avisos := array_append(avisos, 'A O.S. ' || o.numero || ' ainda não foi entregue: o recibo entra como sinal/adiantamento' || case when o.status = 'pronto' then ' (para fechar, entregue com alterar_os acao=entregar).' else '.' end);
  elsif o.status <> 'entregue' then$b$);
  src := replace(src, $a$  if o.status = 'entregue' and o.finalizada_em is null and v_falta <= 0.009 then$a$,
                      $b$  if o.status <> 'entregue' and v_falta <= 0.009 then erros := array_append(erros, 'A O.S. ' || o.numero || ' já está quitada.'); end if;
  if o.status = 'entregue' and o.finalizada_em is null and v_falta <= 0.009 then$b$);
  if src not like '%v40: sinal%' then raise exception 'v40: não reconheci a agente_receber_os do v37 (rode o v37 antes).'; end if;
  execute src;
end $$;

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array['agente_hoje()', 'agente_quem()', 'agente_registrar(text, jsonb, text, text, jsonb, jsonb)', 'agente_contas_nomes()', 'agente_conta_valida(text)',
    'agente_campos(text, jsonb, text[])', 'agente_patch_os(uuid, jsonb)', 'agente_itens_gravar(uuid, jsonb, jsonb)', 'agente_totais_os(uuid)', 'agente_barras(text)',
    'agente_os_json(public.ordens, boolean)', 'agente_a_pagar(date)', 'agente_alterar_os(jsonb)', 'agente_salvar_cadastro(jsonb)', 'agente_conta(jsonb)',
    'agente_guardar_saldos(jsonb)', 'agente_transferencia(jsonb)', 'agente_recibo(jsonb)', 'agente_movimentar_estoque(jsonb)', 'agente_produto(jsonb)',
    'agente_fazer(text, jsonb, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
