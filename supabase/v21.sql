-- =====================================================================
-- DTCar Gestão — v21: agente lança serviços e peças na O.S. (Fase 5, 1ª parte).
--
-- agente_lancar_itens_os(p jsonb, p_gravar boolean)
--   p: numero (da O.S.), itens [{tipo, descricao, qtd, valor_unit, custo_unit, codigo, peca_do_cliente}],
--      lancar_mesmo_repetido (true = aceita item com a mesma descrição de um já lançado),
--      pedido (o que o Danilo pediu, para o histórico)
--   Com p_gravar = false só confere e devolve a prévia (itens, totais, custo e margem).
--   Com p_gravar = true grava numa transação só, pela mesma função da sincronização
--   sem internet (sincronizar_alteracao_os, v15), para não gerar conflito com a fila do PC:
--   itens novos (tipo itens_os) + total e custo da O.S. (tipo alterar_os), histórico da
--   O.S. (eventos) e histórico do agente (agente_acoes).
--
-- Regras:
--   - Só O.S. em orçamento (diagnostico/aguardando) ou aprovada em execução.
--   - Igual às telas (js/telas/ordem.js): fora do orçamento em elaboração o item entra como
--     adicional, aguardando a aprovação do cliente, e não soma no total aprovado.
--   - Peça com código do estoque: liga ao produto e dá baixa no estoque da oficina (gatilho do v4).
--     Sem código: item genérico, não mexe no estoque (decisão D3); o custo vem depois pela nota.
--   - Nada é apagado nem alterado: só inclui itens.
--
-- Rode depois do v20. Pode rodar mais de uma vez. Não muda nada nas telas.
-- Espelho: desligado desde a virada; os itens seguem a mesma regra dos lançados pelas telas.
-- =====================================================================

create or replace function public.agente_lancar_itens_os(p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.ordens; it jsonb; n int := 0; erros text[] := '{}'; avisos text[] := '{}';
  v_tipo text; v_desc text; v_qtd numeric; v_val numeric; v_custo numeric; v_cod text; v_cli boolean; v_prod public.produtos;
  v_adicional boolean; v_aprov boolean; v_pos int; v_novos jsonb := '[]'; v_linhas jsonb := '[]'; v_id uuid;
  t_serv numeric := 0; t_peca numeric := 0; t_terc numeric := 0; t_custo numeric := 0; t_sub numeric; t_total numeric; t_lanc numeric := 0;
  v_perfil public.perfis; r jsonb; v_res jsonb; v_repetido boolean := coalesce((p->>'lancar_mesmo_repetido')::boolean, false);
  v_consumo jsonb := '{}'; v_ja numeric; -- quanto de cada produto as linhas anteriores deste mesmo pedido já vão tirar do estoque
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
  -- trava a O.S. já na leitura: duas chamadas juntas para a mesma O.S. não leem os mesmos itens e totais
  -- (cada uma espera a anterior terminar e confere repetidos e soma o total com o que a outra lançou)
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1 for update;
  if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;
  if o.status not in ('diagnostico', 'aguardando', 'execucao') then
    erros := array_append(erros, 'A O.S. ' || o.numero || ' está em "' || public.agente_etapa(o) || '": só dá para lançar itens no orçamento ou com o serviço em execução.');
  end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'Informe pelo menos um item.'; end if;
  if jsonb_array_length(p->'itens') > 40 then raise exception 'No máximo 40 itens por vez.'; end if;

  v_adicional := o.status <> 'diagnostico';
  select coalesce(max(posicao), -1) + 1 into v_pos from public.os_itens where ordem_id = o.id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    n := n + 1;
    v_tipo := coalesce(it->>'tipo', '');
    v_desc := trim(coalesce(it->>'descricao', ''));
    v_cod := trim(coalesce(it->>'codigo', ''));
    v_cli := coalesce((it->>'peca_do_cliente')::boolean, false);
    v_prod := null;
    if v_tipo not in ('servico', 'peca', 'terceiro') then erros := array_append(erros, 'Item ' || n || ': tipo deve ser servico, peca ou terceiro.'); continue; end if;
    if jsonb_typeof(it->'qtd') <> 'number' or (it->>'qtd')::numeric <= 0 then erros := array_append(erros, 'Item ' || n || ': quantidade inválida.'); continue; end if;
    if jsonb_typeof(it->'valor_unit') <> 'number' or (it->>'valor_unit')::numeric < 0 then erros := array_append(erros, 'Item ' || n || ': valor unitário inválido.'); continue; end if;
    if it ? 'custo_unit' and it->'custo_unit' <> 'null'::jsonb and (jsonb_typeof(it->'custo_unit') <> 'number' or (it->>'custo_unit')::numeric < 0) then
      erros := array_append(erros, 'Item ' || n || ': custo unitário inválido.'); continue;
    end if;
    v_qtd := round((it->>'qtd')::numeric, 3); v_val := round((it->>'valor_unit')::numeric, 2);
    v_custo := round(nullif(it->>'custo_unit', '')::numeric, 2);
    if v_cod <> '' then
      if v_tipo <> 'peca' then erros := array_append(erros, 'Item ' || n || ': código do estoque só vale para peça.'); continue; end if;
      select * into v_prod from public.produtos pr where pr.tipo = 'produto' and (pr.codigo::text = v_cod or lower(coalesce(pr.codigo_barras, '')) = lower(v_cod)) order by pr.ativo desc limit 1;
      if v_prod.id is null then erros := array_append(erros, 'Item ' || n || ': código ' || v_cod || ' não existe no estoque.'); continue; end if;
      if v_desc = '' then v_desc := v_prod.descricao; end if;
      if v_custo is null and not v_cli then v_custo := coalesce(v_prod.custo, 0); end if;
      -- mesma regra da tela da O.S.: produto marcado para não vender sem estoque bloqueia; os outros só avisam
      -- conta também o que as linhas anteriores deste pedido já vão tirar do mesmo produto
      v_ja := coalesce((v_consumo->>v_prod.id::text)::numeric, 0);
      if v_prod.controla_estoque and not v_cli and coalesce(v_prod.estoque_atual, 0) - v_ja < v_qtd then
        if coalesce(v_prod.vender_sem_estoque, true) then
          avisos := array_append(avisos, v_prod.descricao || ': estoque ' || coalesce(v_prod.estoque_atual, 0) || ', vai ficar negativo.');
        else
          erros := array_append(erros, v_prod.descricao || ': estoque insuficiente (' || coalesce(v_prod.estoque_atual, 0)
            || case when v_ja > 0 then ', já contando ' || v_ja || ' em outra linha deste pedido' else '' end
            || ') e o produto está marcado para não ser vendido sem estoque.');
          continue;
        end if;
      end if;
      if v_prod.controla_estoque and not v_cli then v_consumo := jsonb_set(v_consumo, array[v_prod.id::text], to_jsonb(v_ja + v_qtd)); end if;
    end if;
    if length(v_desc) < 2 then erros := array_append(erros, 'Item ' || n || ': informe a descrição.'); continue; end if;
    v_custo := case when v_cli then 0 else coalesce(v_custo, 0) end;
    if v_tipo = 'peca' and not v_cli and v_custo = 0 then avisos := array_append(avisos, v_desc || ': sem custo (a margem fica superestimada até a nota chegar).'); end if;
    if v_val = 0 and not v_cli then avisos := array_append(avisos, v_desc || ': valor zero.'); end if;
    if exists (select 1 from public.os_itens i where i.ordem_id = o.id and upper(trim(i.descricao)) = upper(v_desc) and i.aprovado is distinct from false)
       or exists (select 1 from jsonb_array_elements(v_novos) x where upper(x->>'descricao') = upper(v_desc)) then
      if v_repetido then avisos := array_append(avisos, v_desc || ': já estava na O.S. (confirmado lançar de novo).');
      else erros := array_append(erros, v_desc || ' já está na O.S. Lançar de novo mesmo assim?'); end if;
    end if;
    v_id := gen_random_uuid();
    v_novos := v_novos || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'tipo', v_tipo, 'descricao', v_desc, 'codigo', coalesce(v_prod.codigo::text, ''), 'produto_id', v_prod.id,
      'qtd', v_qtd, 'valor_unit', v_val, 'custo_unit', v_custo, 'desconto', 0, 'fornecida_cliente', v_cli,
      'qualidade', case when v_tipo = 'peca' then 'original' else '' end, 'adicional', v_adicional, 'aprovado', null, 'executado', false,
      'posicao', v_pos));
    v_pos := v_pos + 1;
    t_lanc := t_lanc + round(v_qtd * v_val, 2);
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'descricao', v_desc, 'qtd', v_qtd, 'valor_unit', v_val,
      'total', round(v_qtd * v_val, 2), 'custo_unit', v_custo,
      'estoque', case when v_cli then 'peça do cliente' when v_prod.id is not null then 'baixa no estoque (código ' || v_prod.codigo || ')'
                      when v_tipo = 'peca' then 'item genérico (não mexe no estoque)' end));
  end loop;

  -- totais como a tela calcula (js/util.js, totais): no orçamento soma o que não foi recusado; depois de aprovada, só o aprovado
  with todos as (
    select i.tipo, i.qtd, i.valor_unit, coalesce(i.desconto, 0) desconto, i.custo_unit, i.aprovado from public.os_itens i where i.ordem_id = o.id
    union all
    select x->>'tipo', (x->>'qtd')::numeric, (x->>'valor_unit')::numeric, 0, (x->>'custo_unit')::numeric, null::boolean from jsonb_array_elements(v_novos) x
  ), conta as (
    select * from todos where case when o.status in ('execucao', 'pronto', 'entregue', 'recusado') then aprovado is true else aprovado is distinct from false end
  )
  select coalesce(sum(round(qtd * valor_unit - desconto, 2)) filter (where tipo = 'servico'), 0),
         coalesce(sum(round(qtd * valor_unit - desconto, 2)) filter (where tipo = 'peca'), 0),
         coalesce(sum(round(qtd * valor_unit - desconto, 2)) filter (where tipo = 'terceiro'), 0),
         coalesce(sum(round(qtd * custo_unit, 2)) filter (where tipo <> 'servico'), 0)
    into t_serv, t_peca, t_terc, t_custo from conta;
  t_sub := t_serv + t_peca + t_terc;
  t_total := greatest(0, t_sub - coalesce(o.desconto, 0));
  if v_adicional and o.status = 'execucao' then
    avisos := array_append(avisos, 'A O.S. já está aprovada: os itens entram como adicionais e só somam no total depois que o cliente aprovar.');
  end if;

  v_res := jsonb_build_object('os', o.numero, 'id', o.id, 'etapa', public.agente_etapa(o), 'placa', o.veiculo->>'placa', 'cliente', o.cliente->>'nome',
    'itens', v_linhas, 'valor_lancado', t_lanc, 'total_antes', o.total,
    'total_os', t_total, 'servicos', t_serv, 'pecas', t_peca, 'terceiros', t_terc, 'desconto', coalesce(o.desconto, 0),
    'custo', t_custo, 'margem_bruta', t_total - t_custo, 'avisos', to_jsonb(avisos));
  if array_length(erros, 1) > 0 then return v_res || jsonb_build_object('pode_lancar', false, 'erros', to_jsonb(erros)); end if;
  if not coalesce(p_gravar, false) then return v_res || jsonb_build_object('pode_lancar', true, 'gravado', false); end if;

  -- gravação: pela função da sincronização (trava a O.S.; itens com id novo não conflitam com a fila do PC)
  select * into v_perfil from public.perfis where id = auth.uid();
  r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'itens_os', 'ordem_id', o.id, 'itens', v_novos,
         'antes', jsonb_build_object('status', o.status, 'itens', '{}'::jsonb)), false);
  if r ? 'conflito' then raise exception 'Não gravei: %', r->>'conflito'; end if;
  r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'alterar_os', 'ordem_id', o.id,
         'antes', jsonb_build_object('total', o.total, 'custo', o.custo), 'patch', jsonb_build_object('total', t_total, 'custo', t_custo)), false);
  if r ? 'conflito' then raise exception 'Não gravei: %', r->>'conflito'; end if;
  insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
  values (o.id, 'itens', 'Agente (Claude) lançou ' || jsonb_array_length(v_novos) || ' item(ns): ' || public.agente_reais(t_lanc)
          || case when v_adicional then ' (adicionais, aguardando aprovação)' else '' end || '.', coalesce(v_perfil.nome, ''));
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('lancar_itens_os', coalesce(p->>'pedido', ''), 'os_itens', o.id::text,
          jsonb_build_object('numero', o.numero, 'total', o.total, 'custo', o.custo),
          jsonb_build_object('numero', o.numero, 'total', t_total, 'custo', t_custo, 'itens', v_novos),
          coalesce(v_perfil.nome, ''));
  return v_res || jsonb_build_object('pode_lancar', true, 'gravado', true);
end $$;

revoke all on function public.agente_lancar_itens_os(jsonb, boolean) from public, anon;
grant execute on function public.agente_lancar_itens_os(jsonb, boolean) to authenticated;
