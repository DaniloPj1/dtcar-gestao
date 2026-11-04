-- =====================================================================
-- DTCar Gestão — v31: pedidos de compra por fornecedor (cupons, pré-vendas, romaneios).
--
-- Pedido do Danilo (04/11/2026): "quero que esses cupons de pedidos que eu te envio fiquem registrados
-- em cada fornecedor por período, para conferência na hora de pagar". Sem guardar a foto: só fornecedor,
-- documento, data, valor e a O.S. de destino.
--
-- Usa a tabela pre_notas do v19 (já existe, sem chave estrangeira para O.S.) e acrescenta:
--   * conferida_em / conferida_por / conta_id: marca o pedido como conferido no acerto com o fornecedor
--     e, se quiser, liga à conta a pagar que quitou (sem chave estrangeira: só referência);
--   * agente_registrar_pre_nota(p, p_gravar): o Claude registra o pedido (prévia com p_gravar=false);
--     confere repetido (mesmo fornecedor + documento) e liga à O.S. pelo número;
--   * agente_pre_notas(...): lista por fornecedor e período, com totais (conector "pre_notas").
-- A tela Financeiro › Pedidos de compra lê e grava direto na tabela (RLS do v19: só administrador).
--
-- Rode depois do v19 e do v20. Pode rodar mais de uma vez.
-- Espelho: desligado desde a virada; pre_notas já é preservada pelo espelho (v19, sem chave estrangeira
-- para O.S., itens ou produtos). Antes e depois da virada o comportamento é o mesmo.
-- =====================================================================

alter table public.pre_notas add column if not exists conferida_em timestamptz;
alter table public.pre_notas add column if not exists conferida_por text not null default '';
alter table public.pre_notas add column if not exists conta_id uuid;   -- conta a pagar do acerto (sem chave estrangeira)
create index if not exists pre_notas_fornecedor on public.pre_notas (fornecedor_id, data);
create index if not exists pre_notas_data on public.pre_notas (data);
-- o papel agente_leitura (v19) já lê pre_notas inteira (select na tabela vale para as colunas novas)

-- fornecedor pelo CNPJ ou pelo nome (razão ou fantasia); devolve null se não achar ou se houver mais de um
create or replace function public.agente_achar_fornecedor(p_nome text, p_cnpj text) returns uuid
language plpgsql stable security invoker set search_path = public as $$
declare v_id uuid; v_doc text := regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'); v_n text := lower(trim(coalesce(p_nome, ''))); v_qtd int;
begin
  if length(v_doc) = 14 then
    select id into v_id from public.fornecedores where regexp_replace(cnpj, '\D', '', 'g') = v_doc limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  if length(v_n) < 3 then return null; end if;
  select count(*), min(id::text)::uuid into v_qtd, v_id from public.fornecedores
    where ativo and (lower(razao) like '%' || v_n || '%' or lower(fantasia) like '%' || v_n || '%');
  return case when v_qtd = 1 then v_id end;
end $$;

create or replace function public.agente_registrar_pre_nota(p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  erros text[] := '{}'; avisos text[] := '{}';
  v_nome text := trim(coalesce(p->>'fornecedor', '')); v_cnpj text := regexp_replace(coalesce(p->>'fornecedor_cnpj', ''), '\D', '', 'g');
  v_doc text := trim(coalesce(p->>'documento', '')); v_data date; v_total numeric; v_forn public.fornecedores; v_os public.ordens;
  v_perfil public.perfis; v_id uuid; v_res jsonb; v_rep public.pre_notas;
  v_repetido boolean := coalesce((p->>'registrar_mesmo_repetido')::boolean, false);
begin
  perform public.agente_exige_admin();
  if length(v_nome) < 2 and length(v_cnpj) <> 14 then erros := array_append(erros, 'Informe o fornecedor.'); end if;
  if v_doc = '' then erros := array_append(erros, 'Informe o nº do cupom, pedido ou pré-venda.'); end if;
  begin v_data := (p->>'data')::date; exception when others then v_data := null; end;
  if v_data is null then erros := array_append(erros, 'Informe a data do pedido (AAAA-MM-DD).');
  elsif v_data > current_date + 1 then erros := array_append(erros, 'Data do pedido no futuro: confira.'); end if;
  if jsonb_typeof(p->'total') <> 'number' or (p->>'total')::numeric <= 0 then erros := array_append(erros, 'Informe o valor total (já com desconto).');
  else v_total := round((p->>'total')::numeric, 2); end if;

  select * into v_forn from public.fornecedores where id = public.agente_achar_fornecedor(v_nome, v_cnpj);
  if v_forn.id is null then avisos := array_append(avisos, 'Fornecedor sem cadastro (ou nome parecido com mais de um): fica registrado pelo nome "' || v_nome || '".'); end if;

  if coalesce(p->>'os_numero', '') <> '' then
    if p->>'os_numero' !~ '^\s*[0-9]+\s*$' then erros := array_append(erros, 'Número da O.S. inválido.');
    else
      select * into v_os from public.ordens where numero = (p->>'os_numero')::int order by criado_em desc limit 1;
      if v_os.id is null then erros := array_append(erros, 'O.S. ' || (p->>'os_numero') || ' não encontrada.'); end if;
    end if;
  end if;

  -- mesmo documento do mesmo fornecedor já registrado (fora os cancelados)
  if v_doc <> '' then
    select * into v_rep from public.pre_notas pn where pn.situacao <> 'cancelada' and lower(trim(pn.documento)) = lower(v_doc)
      and (case when v_forn.id is not null then pn.fornecedor_id = v_forn.id else lower(pn.fornecedor_nome) = lower(v_nome) end) limit 1;
    if v_rep.id is not null then
      if v_repetido then avisos := array_append(avisos, 'Documento ' || v_doc || ' já estava registrado (confirmado registrar de novo).');
      else erros := array_append(erros, 'O documento ' || v_doc || ' deste fornecedor já foi registrado em ' || to_char(v_rep.data, 'DD/MM/YYYY') || ' (' || public.agente_reais(v_rep.total) || '). Registrar de novo mesmo assim?'); end if;
    end if;
  end if;

  v_res := jsonb_build_object('fornecedor', coalesce(nullif(v_forn.fantasia, ''), v_forn.razao, v_nome), 'fornecedor_cadastrado', v_forn.id is not null,
    'documento', v_doc, 'data', v_data, 'total', v_total, 'os', v_os.numero, 'placa', v_os.veiculo->>'placa', 'avisos', to_jsonb(avisos));
  if array_length(erros, 1) > 0 then return v_res || jsonb_build_object('pode_registrar', false, 'erros', to_jsonb(erros)); end if;
  if not coalesce(p_gravar, false) then return v_res || jsonb_build_object('pode_registrar', true, 'gravado', false); end if;

  select * into v_perfil from public.perfis where id = auth.uid();
  insert into public.pre_notas (data, fornecedor_id, fornecedor_nome, fornecedor_cnpj, documento, total, ordem_id, os_numero, placa, obs, criado_por)
  values (v_data, v_forn.id, coalesce(nullif(v_forn.fantasia, ''), v_forn.razao, v_nome), coalesce(nullif(v_cnpj, ''), regexp_replace(coalesce(v_forn.cnpj, ''), '\D', '', 'g')),
          v_doc, v_total, v_os.id, v_os.numero, coalesce(v_os.veiculo->>'placa', ''), trim(coalesce(p->>'obs', '')), coalesce(v_perfil.nome, ''))
  returning id into v_id;
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('registrar_pre_nota', coalesce(p->>'pedido', ''), 'pre_notas', v_id::text, null, v_res, coalesce(v_perfil.nome, ''));
  return v_res || jsonb_build_object('pode_registrar', true, 'gravado', true, 'id', v_id);
end $$;

-- lista por fornecedor e período (data do pedido), com totais; situação: abertas (padrão), conferidas ou todas
create or replace function public.agente_pre_notas(p_fornecedor text default null, p_de date default null, p_ate date default null, p_situacao text default 'abertas')
returns jsonb language plpgsql stable security invoker set search_path = public as $$
declare v_de date := coalesce(p_de, current_date - 60); v_ate date := coalesce(p_ate, current_date); v_f text := lower(trim(coalesce(p_fornecedor, '')));
  v_doc text := regexp_replace(coalesce(p_fornecedor, ''), '\D', '', 'g'); r jsonb;
begin
  perform public.agente_exige_admin();
  with l as (
    select pn.* from public.pre_notas pn
    where pn.data between v_de and v_ate and pn.situacao <> 'cancelada'
      and (v_f = '' or lower(pn.fornecedor_nome) like '%' || v_f || '%' or (v_doc <> '' and regexp_replace(pn.fornecedor_cnpj, '\D', '', 'g') = v_doc))
      and case coalesce(p_situacao, 'abertas') when 'abertas' then pn.situacao = 'aberta' when 'conferidas' then pn.situacao <> 'aberta' else true end
  ), g as (
    select fornecedor_nome, count(*) qtd, sum(total) total,
      jsonb_agg(jsonb_build_object('data', data, 'documento', documento, 'total', total, 'os', os_numero, 'placa', placa, 'situacao', situacao,
        'conferida_em', conferida_em) order by data, documento) pedidos
    from l group by fornecedor_nome
  )
  select jsonb_build_object('de', v_de, 'ate', v_ate, 'situacao', coalesce(p_situacao, 'abertas'),
    'total', coalesce(sum(total), 0), 'quantidade', coalesce(sum(qtd), 0),
    'fornecedores', coalesce(jsonb_agg(jsonb_build_object('fornecedor', fornecedor_nome, 'quantidade', qtd, 'total', total, 'pedidos', pedidos) order by fornecedor_nome), '[]'))
  into r from g;
  return r;
end $$;

grant execute on function public.agente_achar_fornecedor(text, text) to authenticated;
grant execute on function public.agente_registrar_pre_nota(jsonb, boolean) to authenticated;
grant execute on function public.agente_pre_notas(text, date, date, text) to authenticated;
