-- v61 (18/11/2026, pedido do Danilo): ORÇAMENTO SEPARADO DA O.S. — etapa 4: ferramentas do conector.
-- Até aqui o orçamento ORC só existia na tela: o conector não sabia listar, abrir, criar, alterar nem aprovar.
-- Daqui em diante o Claude faz pelo conector o mesmo que o Danilo faz na tela Orçamentos, com as MESMAS funções
-- do v52 (orcamento_salvar) e do v53 (orcamento_aprovar) — nada de caminho paralelo:
--
--   agente_orcamentos(p)          lista os orçamentos (situação calculada: "vencido" é validade passada sem resposta)
--   agente_buscar_orcamento(p)    um orçamento pelo número (5 = ORC-00005) ou pelo id, com os itens e os ids dos itens
--   agente_orcamento(p)           criar, editar, enviar, recusar, reabrir e excluir  → pelo agente_fazer, ação "orcamento"
--   agente_orcamento_aprovar(p)   aprovar e virar O.S.                               → pelo agente_fazer, ação "orcamento_aprovar"
--
-- Orçamento continua NÃO mexendo em estoque nem em financeiro: a baixa do estoque só acontece na aprovação, pelo
-- gatilho de sempre do os_itens (v53). Nenhuma tabela nova: as duas do v52 já estão no backup, na restauração, no
-- banco do PC e nas exclusões, e continuam preservadas pelo espelho do OS Oficina.
--
-- PEÇA COM CÓDIGO DO ESTOQUE (regra D3, como o v21 e o v40): o item com `codigo` é ligado ao produto do cadastro
-- (produto_id + custo do estoque), para a aprovação dar baixa de verdade. Sem código, é item genérico e não mexe no
-- estoque. O `produto_id` NÃO é aceito direto do conector: ele sai do código, que é conferido no cadastro.
--
-- PRÉVIA (confirmar=false): o agente_fazer faz e desfaz a transação, mas a SEQUÊNCIA do número não volta atrás.
-- Por isso criar um orçamento na prévia NÃO grava nada: confere tudo e devolve a conta sem número (o mesmo cuidado
-- da venda de balcão e do recibo avulso no v50). Nas demais ações o orçamento já tem número e a prévia é normal.
-- Aprovar na prévia usa o p_gravar = false do v53, que confere sem gastar número de O.S.
--
-- Período de transição: igual antes e depois da virada. Orçamento não existe no OS Oficina e nada aqui é lançamento
-- oficial; o espelho preserva as duas tabelas (v52).
-- Idempotente.

-- =====================================================================
-- 1. Leitura: lista e ficha do orçamento
-- =====================================================================

-- Situação para mostrar: a gravada ou "vencido" (em elaboração/enviado com a validade passada), como situacaoORC na tela.
-- stable, não immutable: lê o relógio (rotular de immutable viraria armadilha num índice ou coluna gerada).
create or replace function public.orc_situacao(p_situacao text, p_validade date) returns text
language sql stable set search_path = public as $$
  select case when p_situacao in ('elaboracao', 'enviado') and p_validade is not null
                and p_validade < (now() at time zone 'America/Sao_Paulo')::date
              then 'vencido' else p_situacao end $$;

-- Número no jeito da tela: 5 → ORC-00005
create or replace function public.orc_numero_texto(p_numero int) returns text
language sql immutable set search_path = public as $$ select 'ORC-' || lpad(coalesce(p_numero, 0)::text, 5, '0') $$;

-- Validade padrão do orçamento novo: cfg.validadeDias dos Ajustes (10 dias), como na tela.
create or replace function public.orc_validade_padrao() returns date
language sql stable set search_path = public as $$
  select public.agente_hoje() + coalesce(nullif((select dados->>'validadeDias' from public.config where id = 1), '')::int, 10) $$;

-- p: { situacao: todos|abertos|elaboracao|enviado|aprovado|recusado|vencido, busca (cliente, placa ou nº),
--      de, ate (criado em, no fuso de Brasília), limite (padrão 30, máx. 200) }
create or replace function public.agente_orcamentos(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  v_sit text := lower(coalesce(nullif(p->>'situacao', ''), 'todos'));
  v_busca text := trim(coalesce(p->>'busca', ''));
  v_de date := nullif(p->>'de', '')::date; v_ate date := nullif(p->>'ate', '')::date;
  v_lim int := least(greatest(coalesce(nullif(p->>'limite', '')::int, 30), 1), 200);
  -- só vira número quando cabe num int (telefone e CPF têm dígitos demais e estouravam a busca)
  v_num int := case when v_busca ~ '^\D*\d{1,9}\D*$' then nullif(regexp_replace(v_busca, '\D', '', 'g'), '')::int end;
  v_placa text := regexp_replace(v_busca, '[^A-Za-z0-9]', '', 'g');
  v jsonb;
begin
  perform public.agente_exige_admin();
  if v_sit not in ('todos', 'abertos', 'elaboracao', 'enviado', 'aprovado', 'recusado', 'vencido') then
    raise exception 'Situação desconhecida: %. Use todos, abertos, elaboracao, enviado, aprovado, recusado ou vencido.', v_sit;
  end if;
  select coalesce(jsonb_agg(x order by x->>'criado_em' desc), '[]'::jsonb) into v from (
    select jsonb_build_object(
             'id', o.id, 'numero', public.orc_numero_texto(o.numero), 'n', o.numero,
             'situacao', public.orc_situacao(o.situacao, o.validade),
             'cliente', coalesce(o.cliente->>'nome', ''), 'cliente_id', o.cliente_id,
             'placa', coalesce(o.veiculo->>'placa', ''),
             'veiculo', trim(coalesce(o.veiculo->>'marca', '') || ' ' || coalesce(o.veiculo->>'modelo', '') || ' ' || coalesce(o.veiculo->>'ano', '')),
             'pedido_do_cliente', left(o.reclamacao, 200), 'itens', (select count(*) from public.orcamento_itens i where i.orcamento_id = o.id),
             'total', o.total, 'desconto', o.desconto, 'validade', o.validade,
             'os_numero', o.os_numero, 'motivo', nullif(o.motivo, ''), 'consultor', nullif(o.consultor_nome, ''),
             'criado_em', o.criado_em) x
      from public.orcamentos o
     where (v_sit = 'todos'
            or (v_sit = 'abertos' and public.orc_situacao(o.situacao, o.validade) in ('elaboracao', 'enviado', 'vencido'))
            or public.orc_situacao(o.situacao, o.validade) = v_sit)
       and (v_busca = '' or o.cliente->>'nome' ilike '%' || v_busca || '%'
            or (v_placa <> '' and regexp_replace(coalesce(o.veiculo->>'placa', ''), '[^A-Za-z0-9]', '', 'g') ilike '%' || v_placa || '%')
            or (v_num is not null and o.numero = v_num))
       and (v_de is null or (o.criado_em at time zone 'America/Sao_Paulo')::date >= v_de)
       and (v_ate is null or (o.criado_em at time zone 'America/Sao_Paulo')::date <= v_ate)
     order by o.criado_em desc
     limit v_lim) t;
  return jsonb_build_object('situacao', v_sit, 'quantidade', jsonb_array_length(v), 'orcamentos', v,
    'sobre', 'Orçamento é preço para quem ainda não deixou o carro. Só vira O.S. quando o cliente aprova (aprovar_orcamento).');
end $$;

-- p: { numero (5 = ORC-00005) ou id }
-- Campo por campo, como o agente_os_json do v20: o telefone e o documento da cópia do cliente não saem.
create or replace function public.agente_buscar_orcamento(p jsonb default '{}'::jsonb) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare o public.orcamentos; v_num int := nullif(p->>'numero', '')::int; v_id uuid := nullif(p->>'id', '')::uuid;
begin
  perform public.agente_exige_admin();
  if v_id is null and v_num is null then raise exception 'Informe o número do orçamento (5 = ORC-00005) ou o id.'; end if;
  select * into o from public.orcamentos where (v_id is not null and id = v_id) or (v_id is null and numero = v_num);
  if o.id is null then raise exception 'Orçamento não encontrado: %.', coalesce(v_id::text, public.orc_numero_texto(v_num)); end if;
  return jsonb_build_object(
    'id', o.id, 'numero', public.orc_numero_texto(o.numero), 'n', o.numero,
    'situacao', public.orc_situacao(o.situacao, o.validade), 'situacao_gravada', o.situacao,
    'cliente', coalesce(o.cliente->>'nome', ''), 'cliente_id', o.cliente_id, 'cliente_no_cadastro', o.cliente_id is not null,
    'placa', coalesce(o.veiculo->>'placa', ''), 'veiculo_id', o.veiculo_id,
    'veiculo', trim(coalesce(o.veiculo->>'marca', '') || ' ' || coalesce(o.veiculo->>'modelo', '') || ' ' || coalesce(o.veiculo->>'ano', '')),
    'pedido_do_cliente', o.reclamacao, 'obs', o.obs, 'obs_internas', o.obs_internas,
    'tabela_preco', o.tabela_preco, 'condicoes_pagamento', o.condicoes_pagamento,
    'desconto', o.desconto, 'total', o.total, 'custo', o.custo, 'validade', o.validade,
    'enviado_em', o.enviado_em, 'respondido_em', o.respondido_em, 'motivo', nullif(o.motivo, ''),
    'ordem_id', o.ordem_id, 'os_numero', o.os_numero, 'consultor', nullif(o.consultor_nome, ''), 'criado_em', o.criado_em,
    'itens', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'descricao', i.descricao, 'codigo', nullif(i.codigo, ''),
                                 'no_estoque', i.produto_id is not null,
                                 'qtd', i.qtd, 'valor_unit', i.valor_unit, 'custo_unit', i.custo_unit, 'desconto', i.desconto,
                                 'total', round(i.qtd * i.valor_unit - i.desconto, 2), 'aprovado', i.aprovado,
                                 'peca_do_cliente', i.fornecida_cliente, 'qualidade', nullif(i.qualidade, ''))
                               order by i.posicao)
                         from public.orcamento_itens i where i.orcamento_id = o.id), '[]'::jsonb));
end $$;

-- =====================================================================
-- 2. Gravação: criar, editar, enviar, recusar, reabrir e excluir
-- =====================================================================

-- Confere um item vindo do conector: campo desconhecido é recusado (como o v40) e produto_id não vem de fora.
-- Devolve sempre true (ou levanta o erro), para poder ser usada num where.
create or replace function public.agente_orc_item_confere(it jsonb, p_com_id boolean default false) returns boolean
language plpgsql immutable set search_path = public as $$
declare k text;
  c_ok text[] := array['tipo', 'descricao', 'codigo', 'fornecedor', 'fornecedor_id', 'qtd', 'valor_unit', 'custo_unit',
                       'desconto', 'horas', 'fornecida_cliente', 'peca_do_cliente', 'qualidade', 'aprovado'];
begin
  if jsonb_typeof(it) <> 'object' then raise exception 'Cada item tem de ser um objeto {tipo, descricao, qtd, valor_unit...}.'; end if;
  for k in select jsonb_object_keys(it) loop
    if k = 'id' then
      if not p_com_id then raise exception 'Item com "id" só em itens_alterar (para incluir, não mande id).'; end if;
      continue;
    end if;
    if k = 'produto_id' then raise exception 'O produto do estoque vem pelo "codigo", não pelo produto_id.'; end if;
    if not (k = any (c_ok)) then raise exception 'Campo "%" do item não existe. Campos: %.', k, array_to_string(c_ok, ', '); end if;
  end loop;
  return true;
end $$;

-- Liga o item ao produto do cadastro pelo código (regra D3): com código dá baixa na aprovação; sem código é genérico.
-- CUIDADO: em itens_alterar o item chega MESCLADO com o do banco, então ele sempre tem 'codigo', 'custo_unit' e
-- 'produto_id' mesmo que o pedido não tenha mandado nada disso. Por isso quem chama diz o que veio no PEDIDO:
--   p_codigo_no_pedido: o pedido mandou 'codigo'. false = não mexe no vínculo com o estoque (nem liga, nem solta,
--     nem recusa) — mudar só a quantidade de uma peça lançada na tela não pode esbarrar no código dela.
--   p_custo_do_estoque: true puxa o custo do cadastro, false respeita o que veio; null decide pelo próprio item.
-- O código gravado pela tela pode ser a REFERÊNCIA do produto ou o código do catálogo de peças (js/telas/ordem.js),
-- não só o código do cadastro: a busca aceita código, código de barras e referência.
-- (uma versão de rascunho tinha só um argumento; sai para não ficar função solta no banco)
drop function if exists public.agente_orc_item_estoque(jsonb);
drop function if exists public.agente_orc_item_estoque(jsonb, boolean);
create or replace function public.agente_orc_item_estoque(it jsonb, p_custo_do_estoque boolean default null,
                                                          p_codigo_no_pedido boolean default true) returns jsonb
language plpgsql stable set search_path = public as $$
declare v_cod text := trim(coalesce(it->>'codigo', '')); v_tipo text := coalesce(it->>'tipo', ''); pr public.produtos;
  v_pega_custo boolean := coalesce(p_custo_do_estoque, not (it ? 'custo_unit'));
begin
  if coalesce((it->>'fornecida_cliente')::boolean, coalesce((it->>'peca_do_cliente')::boolean, false)) then
    -- peça trazida pelo cliente: sem preço, sem custo e fora do estoque (como o editor da tela e o v40)
    it := (it - 'peca_do_cliente') || jsonb_build_object('fornecida_cliente', true, 'valor_unit', 0, 'custo_unit', 0, 'desconto', 0, 'produto_id', null);
    return it;
  end if;
  it := (it - 'peca_do_cliente') || (case when it ? 'peca_do_cliente' then jsonb_build_object('fornecida_cliente', (it->>'peca_do_cliente')::boolean) else '{}'::jsonb end);
  -- o pedido não falou de código: o item fica como está (o vínculo que a tela gravou continua valendo)
  if not coalesce(p_codigo_no_pedido, true) then return it; end if;
  if v_cod = '' then
    -- código apagado de propósito: solta o produto do estoque, senão a aprovação continuaria
    -- baixando uma peça que já não tem código
    return it || jsonb_build_object('produto_id', null);
  end if;
  select * into pr from public.produtos x
    where (v_tipo = 'peca' and x.tipo = 'produto' or v_tipo <> 'peca' and x.tipo = 'servico' or v_tipo = '')
      and (x.codigo::text = v_cod or lower(coalesce(x.codigo_barras, '')) = lower(v_cod) or lower(coalesce(x.referencia, '')) = lower(v_cod))
    order by (x.codigo::text = v_cod) desc, x.ativo desc limit 1;
  if pr.id is null then
    if v_tipo = 'peca' then
      raise exception 'Código % não existe no estoque (conferi código, código de barras e referência). Tire o código para lançar como peça avulsa.', v_cod;
    end if;
    return it;   -- serviço ou terceiro com código livre: fica como está
  end if;
  return it || jsonb_build_object('produto_id', pr.id, 'codigo', pr.codigo::text)
            || case when v_pega_custo and pr.tipo = 'produto' then jsonb_build_object('custo_unit', pr.custo) else '{}'::jsonb end;
end $$;

-- p: { acao: criar|editar|enviar|recusar|reabrir|excluir (padrão: editar, ou criar quando não vem número/id),
--      numero|id, cliente_id, veiculo_id, cliente {nome, telefone, doc...}, veiculo {placa, marca, modelo, ano},
--      reclamacao, obs, obs_internas, tabela_preco, condicoes_pagamento, desconto, validade (AAAA-MM-DD) ou validade_dias,
--      itens [...] (troca a lista inteira) OU itens_incluir [...], itens_alterar [{id, ...}], itens_remover [id],
--      motivo (recusar), pedido }
create or replace function public.agente_orcamento(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.orcamentos; v_acao text; v_num int := nullif(p->>'numero', '')::int; v_id uuid := nullif(p->>'id', '')::uuid;
  v_sit text; v_itens jsonb := '[]'::jsonb; v_tira uuid[] := '{}'; it jsonb; v_pay jsonb; v_res jsonb; v_antes jsonb;
  v_sub numeric := 0; v_custo numeric := 0; v_desc numeric; v_val date; v_dias int := nullif(p->>'validade_dias', '')::int;
  v_mexe boolean := (p ? 'itens_incluir') or (p ? 'itens_alterar') or (p ? 'itens_remover');
begin
  perform public.agente_exige_admin();
  v_acao := lower(coalesce(nullif(p->>'acao', ''), case when v_num is null and v_id is null then 'criar' else 'editar' end));
  if v_acao not in ('criar', 'editar', 'enviar', 'recusar', 'reabrir', 'excluir') then
    raise exception 'Ação desconhecida: %. Use criar, editar, enviar, recusar, reabrir ou excluir.', v_acao;
  end if;
  if (p ? 'itens') and v_mexe then
    raise exception 'Mande a lista inteira (itens) OU as mexidas (itens_incluir, itens_alterar, itens_remover), não os dois.';
  end if;
  if (p ? 'situacao') then raise exception 'A situação muda pela acao: enviar, recusar ou reabrir.'; end if;

  if v_acao <> 'criar' then
    if v_id is null and v_num is null then raise exception 'Informe o número do orçamento (5 = ORC-00005) ou o id.'; end if;
    select * into o from public.orcamentos where (v_id is not null and id = v_id) or (v_id is null and numero = v_num) for update;
    if o.id is null then raise exception 'Orçamento não encontrado: %.', coalesce(v_id::text, public.orc_numero_texto(v_num)); end if;
  elsif v_num is not null or v_id is not null then
    raise exception 'Para criar não se informa número nem id: o número sai do sistema.';
  end if;

  -- excluir: só o administrador, e nunca o que já virou O.S. (o histórico da O.S. aponta para ele)
  if v_acao = 'excluir' then
    if not public.e_admin() then raise exception 'Só o administrador exclui orçamento.'; end if;
    if o.situacao = 'aprovado' or o.ordem_id is not null then
      raise exception 'O orçamento % virou a O.S. %: não pode ser excluído.', public.orc_numero_texto(o.numero), coalesce(o.os_numero::text, '?');
    end if;
    v_antes := to_jsonb(o);
    delete from public.orcamentos where id = o.id;   -- os itens saem junto (on delete cascade)
    perform public.agente_registrar('orcamento', p, 'orcamentos', o.id::text, v_antes, null);
    return jsonb_build_object('acao', 'excluir', 'numero', public.orc_numero_texto(o.numero), 'id', o.id,
      'cliente', coalesce(o.cliente->>'nome', ''), 'total', o.total, 'excluido', true);
  end if;

  -- situação de destino
  v_sit := case v_acao when 'enviar' then 'enviado' when 'recusar' then 'recusado' when 'reabrir' then 'elaboracao'
                       else coalesce(o.situacao, 'elaboracao') end;
  if v_acao = 'recusar' and trim(coalesce(p->>'motivo', o.motivo, '')) = '' then raise exception 'Informe o motivo da recusa.'; end if;

  -- itens: lista inteira (itens) ou mexidas na lista que já está lá
  if p ? 'itens' then
    if jsonb_typeof(p->'itens') <> 'array' then raise exception 'itens deve ser uma lista.'; end if;
    select coalesce(jsonb_agg(public.agente_orc_item_estoque(e, null, e ? 'codigo')), '[]'::jsonb) into v_itens
      from jsonb_array_elements(p->'itens') e where public.agente_orc_item_confere(e, true);
  else
    v_itens := coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'descricao', i.descricao, 'codigo', i.codigo,
                                   'fornecedor', i.fornecedor, 'fornecedor_id', i.fornecedor_id, 'produto_id', i.produto_id,
                                   'qtd', i.qtd, 'valor_unit', i.valor_unit, 'custo_unit', i.custo_unit, 'desconto', i.desconto,
                                   'horas', i.horas, 'fornecida_cliente', i.fornecida_cliente, 'qualidade', i.qualidade, 'aprovado', i.aprovado)
                                 order by i.posicao)
                          from public.orcamento_itens i where i.orcamento_id = o.id), '[]'::jsonb);
    if p ? 'itens_remover' then
      select coalesce(array_agg(x::uuid), '{}') into v_tira from jsonb_array_elements_text(p->'itens_remover') x;
      if exists (select 1 from unnest(v_tira) f where not exists (select 1 from public.orcamento_itens i where i.id = f and i.orcamento_id = o.id)) then
        raise exception 'Há item para remover que não é deste orçamento.';
      end if;
      select coalesce(jsonb_agg(e), '[]'::jsonb) into v_itens from jsonb_array_elements(v_itens) e where not ((e->>'id')::uuid = any(v_tira));
    end if;
    if p ? 'itens_alterar' then
      for it in select * from jsonb_array_elements(p->'itens_alterar') loop
        perform public.agente_orc_item_confere(it, true);
        if nullif(it->>'id', '') is null then raise exception 'Cada item de itens_alterar precisa do id (veja buscar_orcamento).'; end if;
        if not exists (select 1 from jsonb_array_elements(v_itens) e where e->>'id' = it->>'id') then
          raise exception 'Item % não está neste orçamento.', it->>'id';
        end if;
        select coalesce(jsonb_agg(case when e->>'id' = it->>'id'
                 then public.agente_orc_item_estoque(e || (it - 'id'), (it ? 'codigo') and not (it ? 'custo_unit'), it ? 'codigo')
                 else e end), '[]'::jsonb) into v_itens
          from jsonb_array_elements(v_itens) e;
      end loop;
    end if;
    if p ? 'itens_incluir' then
      if jsonb_typeof(p->'itens_incluir') <> 'array' then raise exception 'itens_incluir deve ser uma lista.'; end if;
      select v_itens || coalesce(jsonb_agg(public.agente_orc_item_estoque(e, null, e ? 'codigo')), '[]'::jsonb) into v_itens
        from jsonb_array_elements(p->'itens_incluir') e where public.agente_orc_item_confere(e, false);
    end if;
  end if;
  -- id de item que não é deste orçamento nunca entra (o orcamento_salvar o descartaria em silêncio e o total sairia errado)
  if exists (select 1 from jsonb_array_elements(v_itens) e
        where nullif(e->>'id', '') is not null
          and not exists (select 1 from public.orcamento_itens i where i.id = (e->>'id')::uuid and i.orcamento_id = o.id)) then
    raise exception 'Há item com id que não é deste orçamento (veja os ids em buscar_orcamento).';
  end if;
  if (select count(*) <> count(distinct e->>'id') from jsonb_array_elements(v_itens) e where nullif(e->>'id', '') is not null) then
    raise exception 'O mesmo item aparece duas vezes na lista.';
  end if;

  -- validade: data pronta, "vale N dias" ou, no orçamento novo, o padrão dos Ajustes (como a tela)
  v_val := case when p ? 'validade' then nullif(p->>'validade', '')::date
                when v_dias is not null then public.agente_hoje() + v_dias
                when o.id is null then public.orc_validade_padrao()
                else o.validade end;
  v_desc := coalesce(nullif(p->>'desconto', '')::numeric, o.desconto, 0);

  v_pay := jsonb_strip_nulls(jsonb_build_object(
    'id', o.id, 'situacao', v_sit,
    'cliente_id', case when p ? 'cliente_id' then nullif(p->>'cliente_id', '')::uuid else o.cliente_id end,
    'veiculo_id', case when p ? 'veiculo_id' then nullif(p->>'veiculo_id', '')::uuid else o.veiculo_id end,
    'cliente', coalesce(p->'cliente', o.cliente, '{}'::jsonb),
    'veiculo', coalesce(p->'veiculo', o.veiculo, '{}'::jsonb),
    'reclamacao', coalesce(p->>'reclamacao', o.reclamacao, ''),
    'obs', coalesce(p->>'obs', o.obs, ''),
    'obs_internas', coalesce(p->>'obs_internas', o.obs_internas, ''),
    'tabela_preco', coalesce(nullif(p->>'tabela_preco', ''), o.tabela_preco, 'vista'),
    'condicoes_pagamento', coalesce(p->>'condicoes_pagamento', o.condicoes_pagamento, ''),
    'desconto', v_desc, 'validade', v_val,
    'motivo', coalesce(p->>'motivo', o.motivo, '')))
    || jsonb_build_object('itens', v_itens);

  -- PRÉVIA de criar: não grava (a sequência do número não voltaria atrás). Confere o que o orcamento_salvar confere.
  if v_acao = 'criar' and public.agente_em_previa() then
    if trim(coalesce(v_pay->'cliente'->>'nome', '')) = '' then raise exception 'Informe o cliente (cadastro ou nome).'; end if;
    for it in select * from jsonb_array_elements(v_itens) loop
      if coalesce(it->>'tipo', '') not in ('servico', 'peca', 'terceiro') then raise exception 'Item com tipo inválido: %.', it->>'tipo'; end if;
      if trim(coalesce(it->>'descricao', '')) = '' then raise exception 'Há item sem descrição.'; end if;
      if coalesce(nullif(it->>'qtd', '')::numeric, 0) <= 0 then raise exception 'Item "%": a quantidade deve ser maior que zero.', it->>'descricao'; end if;
      if (it->>'aprovado') is distinct from 'false' then
        v_sub := v_sub + round(coalesce(nullif(it->>'qtd', '')::numeric, 0) * coalesce(nullif(it->>'valor_unit', '')::numeric, 0) - coalesce(nullif(it->>'desconto', '')::numeric, 0), 2);
        v_custo := v_custo + round(coalesce(nullif(it->>'qtd', '')::numeric, 0) * coalesce(nullif(it->>'custo_unit', '')::numeric, 0), 2);
      end if;
    end loop;
    if v_desc > v_sub + 0.001 then raise exception 'O desconto (%) não pode ser maior que o valor dos itens (%).', v_desc, v_sub; end if;
    return jsonb_build_object('acao', 'criar', 'numero', null, 'situacao', v_sit,
      'cliente', v_pay->'cliente'->>'nome', 'veiculo', v_pay->'veiculo',
      'itens', jsonb_array_length(v_itens), 'desconto', v_desc, 'total', greatest(v_sub - v_desc, 0), 'custo', v_custo,
      'validade', v_val, 'aviso', 'O número ORC sai na gravação (confirmar=true): na prévia nada é gravado.');
  end if;

  v_antes := case when o.id is null then null else to_jsonb(o) end;
  v_res := public.orcamento_salvar(v_pay);
  perform public.agente_registrar('orcamento', p, 'orcamentos', (v_res->>'id'), v_antes, v_res);
  return v_res || jsonb_build_object('acao', v_acao, 'numero', public.orc_numero_texto((v_res->>'numero')::int), 'n', (v_res->>'numero')::int,
    'situacao', public.orc_situacao(v_res->>'situacao', nullif(v_res->>'validade', '')::date),
    'link', 'https://gestao.dtcarcentroautomotivo.com.br/#/orcamento/' || (v_res->>'id'));
end $$;

-- =====================================================================
-- 3. Aprovar: o orçamento vira O.S. (a mesma orcamento_aprovar do v53)
-- =====================================================================
-- p: { numero|id, itens_fora [id dos itens que o cliente NÃO quis], por (quem aprovou), forma (como aprovou), pedido }
create or replace function public.agente_orcamento_aprovar(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.orcamentos; v_num int := nullif(p->>'numero', '')::int; v_id uuid := nullif(p->>'id', '')::uuid;
  v_fora uuid[] := '{}'; v_res jsonb; v_cli uuid; v_extra jsonb; v_doc text; v_cep text; v_aviso text := '';
begin
  perform public.agente_exige_admin();
  if v_id is null and v_num is null then raise exception 'Informe o número do orçamento (5 = ORC-00005) ou o id.'; end if;
  select * into o from public.orcamentos where (v_id is not null and id = v_id) or (v_id is null and numero = v_num);
  if o.id is null then raise exception 'Orçamento não encontrado: %.', coalesce(v_id::text, public.orc_numero_texto(v_num)); end if;
  if p ? 'itens_fora' then
    if jsonb_typeof(p->'itens_fora') <> 'array' then raise exception 'itens_fora deve ser uma lista de ids de item (veja buscar_orcamento).'; end if;
    select coalesce(array_agg(x::uuid), '{}') into v_fora from jsonb_array_elements_text(p->'itens_fora') x;
  end if;
  -- gravar = false confere sem gastar número de O.S. (v53)
  v_res := public.orcamento_aprovar(o.id, v_fora, coalesce(p->>'por', ''), coalesce(p->>'forma', ''), not public.agente_em_previa());

  -- A orcamento_aprovar NÃO levanta exceção quando não dá para aprovar: devolve pode_aprovar = false com os erros.
  -- Sem isto, o agente_fazer responderia "gravado" sem ter aberto O.S. nenhuma.
  if not public.agente_em_previa() and not coalesce((v_res->>'pode_aprovar')::boolean, false) then
    raise exception 'O orçamento % não pode virar O.S. agora: %', public.orc_numero_texto(o.numero),
      coalesce(array_to_string(array(select jsonb_array_elements_text(v_res->'erros')), ' '), 'confira o orçamento.');
  end if;

  if coalesce((v_res->>'gravado')::boolean, false) then
    -- cliente só digitado: o v53 cadastra com nome e telefone; aqui vai o resto que estava no orçamento
    -- (o mesmo completarClienteNovo que a tela faz depois de aprovar — js/clientedig.js).
    if coalesce((v_res->>'cliente_novo')::boolean, false) then
      select cliente_id into v_cli from public.ordens where id = (v_res->>'ordem_id')::uuid;
      v_doc := regexp_replace(coalesce(o.cliente->>'doc', ''), '\D', '', 'g');
      if not public.agente_doc_valido(v_doc) then v_doc := ''; end if;
      v_cep := regexp_replace(coalesce(o.cliente->>'cep', ''), '\D', '', 'g');
      v_extra := jsonb_strip_nulls(jsonb_build_object(
        'nascimento', case when length(v_doc) = 11 and coalesce(o.cliente->>'nascimento', '') ~ '^\d{4}-\d{2}-\d{2}$' then o.cliente->>'nascimento' end,
        'cep', case when length(v_cep) = 8 then left(v_cep, 5) || '-' || right(v_cep, 3) end,
        'rua', nullif(trim(coalesce(o.cliente->>'rua', '')), ''),
        'bairro', nullif(trim(coalesce(o.cliente->>'bairro', '')), ''),
        'cidade', case when length(v_cep) = 8 then nullif(trim(coalesce(o.cliente->>'cidade', '')), '') end,
        'uf', case when length(v_cep) = 8 then upper(left(nullif(trim(coalesce(o.cliente->>'uf', '')), ''), 2)) end,
        'email', lower(nullif(trim(coalesce(o.cliente->>'email', '')), ''))));
      if v_cli is not null and (v_doc <> '' or v_extra <> '{}'::jsonb) then
        begin
          update public.clientes c set
            doc = case when v_doc <> '' then v_doc else c.doc end,
            nascimento = coalesce((v_extra->>'nascimento')::date, c.nascimento),
            cep = coalesce(v_extra->>'cep', c.cep), rua = coalesce(v_extra->>'rua', c.rua),
            bairro = coalesce(v_extra->>'bairro', c.bairro), cidade = coalesce(v_extra->>'cidade', c.cidade),
            uf = coalesce(v_extra->>'uf', c.uf), email = coalesce(v_extra->>'email', c.email),
            endereco = case when coalesce(v_extra->>'rua', v_extra->>'bairro', v_extra->>'cep') is not null
                            then trim(both ', ' from concat_ws(', ', v_extra->>'rua', v_extra->>'bairro',
                                 coalesce(v_extra->>'cidade', 'Colatina') || '/' || coalesce(v_extra->>'uf', 'ES')))
                            else c.endereco end
          where c.id = v_cli;
        exception when unique_violation then
          -- o CPF/CNPJ já é de outro cliente: o endereço vai mesmo assim, sem o documento e sem o nascimento
          v_aviso := 'O CPF/CNPJ do orçamento já é de outro cliente: ele não foi para a ficha nova. Confira o cadastro.';
          update public.clientes c set
            cep = coalesce(v_extra->>'cep', c.cep), rua = coalesce(v_extra->>'rua', c.rua),
            bairro = coalesce(v_extra->>'bairro', c.bairro), cidade = coalesce(v_extra->>'cidade', c.cidade),
            uf = coalesce(v_extra->>'uf', c.uf), email = coalesce(v_extra->>'email', c.email)
          where c.id = v_cli;
        end;
      end if;
    end if;
    perform public.agente_registrar('orcamento_aprovar', p, 'orcamentos', o.id::text, to_jsonb(o), v_res);
  end if;
  return v_res || jsonb_build_object('orcamento_id', o.id, 'orcamento', public.orc_numero_texto(o.numero))
    || case when v_aviso <> '' then jsonb_build_object('atencao', v_aviso) else '{}'::jsonb end
    || case when (v_res->>'ordem_id') is not null
            then jsonb_build_object('link_os', 'https://gestao.dtcarcentroautomotivo.com.br/#/os/' || (v_res->>'ordem_id')) else '{}'::jsonb end;
end $$;

-- =====================================================================
-- 4. Entrada única do conector: as ações do v40/v41/v42/v50 continuam, mais as duas do orçamento
-- =====================================================================
create or replace function public.agente_fazer(p_acao text, p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare v jsonb; v_fn text;
begin
  perform public.agente_exige_admin();
  v_fn := case p_acao
    when 'alterar_os' then 'agente_alterar_os_v50' when 'salvar_cadastro' then 'agente_salvar_cadastro'
    when 'conta_pagar' then 'agente_conta' when 'atualizar_saldos' then 'agente_guardar_saldos'
    when 'transferir' then 'agente_transferencia' when 'cancelar_recibo' then 'agente_recibo'
    when 'movimentar_estoque' then 'agente_movimentar_estoque' when 'produto' then 'agente_produto'
    when 'boleto_preparar' then 'agente_boleto_preparar' when 'boleto_gravar' then 'agente_boleto_gravar' when 'boleto_desfazer' then 'agente_boleto_desfazer'
    when 'entrada_nota' then 'agente_entrada_nfe'
    -- v50
    when 'desconto_os' then 'agente_desconto_os' when 'fornecedor' then 'agente_fornecedor' when 'venda_balcao' then 'agente_venda'
    when 'recibo_avulso' then 'agente_recibo_avulso' when 'funcionario' then 'agente_funcionario' when 'nota_sefaz' then 'agente_nota_sefaz'
    when 'boleto_pago' then 'agente_boleto_pago' when 'boleto_situacao' then 'agente_boleto_situacao' when 'pedido_compra' then 'agente_pedido_compra'
    when 'parcela' then 'agente_parcela' when 'despesa_fixa' then 'agente_despesa_fixa' when 'ajustes' then 'agente_ajustes'
    when 'equipe' then 'agente_equipe' when 'site' then 'agente_site' when 'rh_documento' then 'agente_rh_documento'
    -- v61: orçamento separado da O.S.
    when 'orcamento' then 'agente_orcamento' when 'orcamento_aprovar' then 'agente_orcamento_aprovar' end;
  if v_fn is null then raise exception 'Ação desconhecida: %', p_acao; end if;
  perform set_config('dtcar.agente_previa', case when coalesce(p_gravar, false) then 'nao' else 'sim' end, true);
  begin
    execute format('select public.%I($1)', v_fn) into v using coalesce(p, '{}'::jsonb);
    if not coalesce(p_gravar, false) then raise exception using errcode = 'DT001', message = 'previa'; end if;
  exception when sqlstate 'DT001' then
    return v || jsonb_build_object('gravado', false, 'previa', true);
  end;
  return v || jsonb_build_object('gravado', true);
end $$;

-- ---------- permissões ----------
do $$
declare f text;
begin
  foreach f in array array['orc_situacao(text, date)', 'orc_numero_texto(int)', 'orc_validade_padrao()',
    'agente_orc_item_confere(jsonb, boolean)', 'agente_orc_item_estoque(jsonb, boolean, boolean)',
    'agente_orcamentos(jsonb)', 'agente_buscar_orcamento(jsonb)',
    'agente_orcamento(jsonb)', 'agente_orcamento_aprovar(jsonb)', 'agente_fazer(text, jsonb, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
