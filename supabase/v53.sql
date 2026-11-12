-- v53 (12/11/2026): ORÇAMENTO SEPARADO DA O.S. — etapa 2: aprovar e virar O.S.
-- Regra do Danilo (12/11/2026): ao aprovar, os itens que ele NÃO tirar seguem para a O.S.; os que ele tirar não seguem e
-- ficam registrados como "apontados pela oficina e não aprovados pelo cliente" — no orçamento (item com aprovado = false)
-- e numa observação da O.S. (sai na impressão: protege a oficina se o defeito apontado der problema depois).
--
--   ordens.orcamento_id / orcamento_numero   de qual orçamento a O.S. veio (sem chave estrangeira, como o resto do v52)
--   orcamento_aprovar(orcamento, itens_fora, por, forma, gravar)
--       cria a O.S. com o PRÓXIMO número, já em "Aprovado · em execução", com cliente, veículo, itens aprovados, desconto e
--       condições; marca o orçamento como aprovado e grava o vínculo dos dois lados e o histórico. Tudo numa transação.
--       gravar = false só confere e devolve o resumo (não gasta número de O.S.).
-- Estoque: a baixa acontece AQUI, pelo gatilho de sempre do os_itens (a peça sai quando entra na O.S.). Antes disso o
-- orçamento não mexe em estoque. Financeiro: nada é lançado (recibo e parcelas continuam na entrega da O.S.).
-- Carro que ainda não chegou: a O.S. nasce sem KM de entrada e com checkin.aguardando_veiculo = true; a tela da O.S. pede o
-- KM quando o carro chegar (e oferece o checklist), sem travar a aprovação.
-- Cliente ou veículo só digitados no orçamento são cadastrados na aprovação (telefone com DDD e placa são exigidos aí).
-- A O.S. nova é criada direto (como agente_abrir_os, v20): não existe fila sem internet para uma O.S. que acabou de nascer;
-- daí em diante toda alteração dela segue pela sincronizar_alteracao_os, como qualquer O.S.
-- Período de transição: as colunas novas de "ordens" são apagadas e recarregadas com as O.S. pelo espelho (nada a preservar).
-- Idempotente.

alter table public.ordens add column if not exists orcamento_id uuid;
alter table public.ordens add column if not exists orcamento_numero int;
create index if not exists ordens_orcamento on public.ordens (orcamento_id) where orcamento_id is not null;

create or replace function public.orcamento_aprovar(p_orcamento uuid, p_itens_fora uuid[] default '{}', p_por text default '', p_forma text default '', p_gravar boolean default false)
returns jsonb language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.orcamentos; v_cli public.clientes; v_vei public.veiculos; v_ord public.ordens; v_perfil public.perfis; cfg jsonb; dup public.clientes;
  v_fora uuid[] := coalesce(p_itens_fora, '{}'); v_ref text; v_placa text; v_tel text; v_nome text; v_ano int; v_end text;
  v_sub numeric := 0; v_custo numeric := 0; v_n int := 0; v_nfora int := 0; v_lista_fora text; v_obs text; v_semvalor text;
  erros text[] := '{}'; avisos text[] := '{}'; v_resumo jsonb; hoje date := (now() at time zone 'America/Sao_Paulo')::date; v_cli_novo boolean := false; v_vei_novo boolean := false;
begin
  if not public.e_gestor() then raise exception 'Só administrador ou consultor aprova orçamento.'; end if;
  select * into o from public.orcamentos where id = p_orcamento for update;
  if o.id is null then raise exception 'Orçamento não encontrado.'; end if;
  v_ref := 'ORC-' || lpad(o.numero::text, 5, '0');
  if o.situacao = 'aprovado' then raise exception 'O orçamento % já foi aprovado e virou a O.S. %.', v_ref, coalesce(o.os_numero::text, '?'); end if;
  if o.situacao = 'recusado' then raise exception 'O orçamento % está recusado. Reabra o orçamento antes de aprovar.', v_ref; end if;
  if exists (select 1 from unnest(v_fora) f where not exists (select 1 from public.orcamento_itens i where i.id = f and i.orcamento_id = o.id)) then
    raise exception 'Há item marcado como não aprovado que não é deste orçamento.';
  end if;

  -- itens que seguem (aprovados) e que ficam (não aprovados)
  select count(*), coalesce(sum(round(i.qtd * i.valor_unit - i.desconto, 2)), 0), coalesce(sum(round(i.qtd * i.custo_unit, 2)), 0),
         string_agg(i.descricao, ', ' order by i.posicao) filter (where not i.fornecida_cliente and not (i.valor_unit > 0))
    into v_n, v_sub, v_custo, v_semvalor
  from public.orcamento_itens i where i.orcamento_id = o.id and not (i.id = any(v_fora)) and i.aprovado is distinct from false;
  select count(*), string_agg(i.descricao, '; ' order by i.posicao) into v_nfora, v_lista_fora
  from public.orcamento_itens i where i.orcamento_id = o.id and (i.id = any(v_fora) or i.aprovado is false);
  if v_n = 0 then erros := array_append(erros, 'Nenhum item aprovado: o orçamento precisa de pelo menos um item para virar O.S. (se o cliente não quis nada, use "Cliente recusou").'); end if;
  if v_semvalor is not null then erros := array_append(erros, 'Informe o valor de: ' || v_semvalor || '.'); end if;
  if o.desconto > v_sub + 0.001 and v_n > 0 then erros := array_append(erros, 'O desconto do orçamento (' || o.desconto || ') ficou maior que os itens aprovados (' || v_sub || '). Ajuste o desconto no orçamento e salve.'); end if;
  if o.validade is not null and o.validade < hoje then avisos := array_append(avisos, 'A validade do orçamento passou em ' || to_char(o.validade, 'DD/MM/YYYY') || ': confira os preços antes de aprovar.'); end if;

  -- cliente: o do cadastro, ou cadastra o que foi digitado (nome + telefone com DDD)
  v_nome := trim(coalesce(o.cliente->>'nome', '')); v_tel := regexp_replace(coalesce(o.cliente->>'telefone', ''), '\D', '', 'g');
  if o.cliente_id is not null then
    select * into v_cli from public.clientes where id = o.cliente_id;
    if v_cli.id is null then erros := array_append(erros, 'O cliente do orçamento não está mais no cadastro. Escolha o cliente de novo no orçamento e salve.'); end if;
  else
    if length(v_tel) = 13 and left(v_tel, 2) = '55' then v_tel := substr(v_tel, 3); end if;
    if length(v_tel) not between 10 and 11 then erros := array_append(erros, 'Cliente sem cadastro: informe o telefone com DDD no orçamento (a O.S. precisa do cadastro do cliente).');
    else
      select * into dup from public.clientes c where regexp_replace(concat_ws(' ', c.telefone, c.telefone2, c.telefone3), '\D', '', 'g') like '%' || v_tel || '%' limit 1;
      if dup.id is not null then
        if lower(public.unaccent_simples(dup.nome)) = lower(public.unaccent_simples(v_nome)) then v_cli := dup;
        else erros := array_append(erros, 'O telefone do orçamento já é de ' || dup.nome || ' no cadastro. Escolha esse cliente no orçamento ("Do cadastro") ou corrija o telefone.'); end if;
      else v_cli_novo := true; end if;
    end if;
  end if;
  if v_cli.id is not null and v_cli.situacao = 'bloqueado' then
    erros := array_append(erros, 'Cliente bloqueado: ' || coalesce(nullif(v_cli.restricao, ''), 'verifique o cadastro') || '. Não é possível abrir O.S.');
  end if;

  -- veículo: o do cadastro, o da placa já cadastrada, ou cadastra o que foi digitado (placa, marca e modelo)
  v_placa := upper(regexp_replace(coalesce(o.veiculo->>'placa', ''), '[^A-Za-z0-9]', '', 'g'));
  if o.veiculo_id is not null then
    select * into v_vei from public.veiculos where id = o.veiculo_id;
    if v_vei.id is null then erros := array_append(erros, 'O veículo do orçamento não está mais no cadastro. Escolha o veículo de novo no orçamento e salve.'); end if;
  elsif v_placa !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then
    erros := array_append(erros, 'Informe a placa do veículo no orçamento (ABC1234 ou ABC1D23): a O.S. precisa do veículo.');
  else
    select * into v_vei from public.veiculos where placa = v_placa;
    if v_vei.id is null then
      if trim(coalesce(o.veiculo->>'marca', '')) = '' or trim(coalesce(o.veiculo->>'modelo', '')) = '' then erros := array_append(erros, 'Veículo novo: informe a marca e o modelo no orçamento.'); end if;
      v_ano := nullif(regexp_replace(coalesce(o.veiculo->>'ano', ''), '\D', '', 'g'), '')::int;
      if v_ano is not null and (v_ano < 1950 or v_ano > extract(year from now())::int + 1) then erros := array_append(erros, 'Veículo novo: o ano deve ter 4 dígitos.'); end if;
      v_vei_novo := true;
    elsif v_vei.cliente_id is not null and v_cli.id is not null and v_vei.cliente_id <> v_cli.id then
      avisos := array_append(avisos, 'A placa ' || v_placa || ' está cadastrada em nome de ' || coalesce((select nome from public.clientes where id = v_vei.cliente_id), 'outro cliente') || ': o cadastro do veículo não muda; a O.S. sai no nome do cliente do orçamento.');
    end if;
  end if;
  if v_vei.id is not null and exists (select 1 from public.ordens x where x.veiculo_id = v_vei.id and x.status in ('diagnostico', 'aguardando', 'execucao', 'pronto')) then
    avisos := array_append(avisos, 'O veículo já tem a O.S. ' || (select string_agg(x.numero::text, ', ') from public.ordens x where x.veiculo_id = v_vei.id and x.status in ('diagnostico', 'aguardando', 'execucao', 'pronto')) || ' em andamento: esta aprovação abre outra.');
  end if;

  v_resumo := jsonb_build_object('orcamento', v_ref, 'itens_aprovados', v_n, 'itens_nao_aprovados', v_nfora, 'nao_aprovados', coalesce(v_lista_fora, ''),
    'subtotal', v_sub, 'desconto', o.desconto, 'total', greatest(v_sub - o.desconto, 0), 'cliente_novo', v_cli_novo, 'veiculo_novo', v_vei_novo and v_vei.id is null,
    'avisos', to_jsonb(avisos));
  if array_length(erros, 1) > 0 then return v_resumo || jsonb_build_object('pode_aprovar', false, 'gravado', false, 'erros', to_jsonb(erros)); end if;
  if not coalesce(p_gravar, false) then return v_resumo || jsonb_build_object('pode_aprovar', true, 'gravado', false); end if;

  -- ===== gravação (uma transação só) =====
  select dados into cfg from public.config where id = 1;
  select * into v_perfil from public.perfis where id = auth.uid();
  if v_cli.id is null then
    insert into public.clientes (nome, telefone, cidade, uf, endereco, origem) values (v_nome, v_tel, 'Colatina', 'ES', 'Colatina/ES', 'Orçamento') returning * into v_cli;
  end if;
  if v_vei.id is null then
    insert into public.veiculos (placa, marca, modelo, ano, cliente_id) values (v_placa, trim(o.veiculo->>'marca'), trim(o.veiculo->>'modelo'), coalesce(v_ano::text, ''), v_cli.id) returning * into v_vei;
  end if;
  v_end := coalesce(nullif(concat_ws(', ', nullif(trim(concat_ws(' ', to_jsonb(v_cli)->>'rua', to_jsonb(v_cli)->>'complemento')), ''), nullif(to_jsonb(v_cli)->>'bairro', ''),
            nullif(concat_ws('/', nullif(v_cli.cidade, ''), nullif(v_cli.uf, '')), ''), case when coalesce(to_jsonb(v_cli)->>'cep', '') <> '' then 'CEP ' || (to_jsonb(v_cli)->>'cep') end), ''), v_cli.endereco, '');
  -- observação que sai na O.S.: o que a oficina apontou e o cliente não aprovou
  v_obs := trim(both E'\n' from concat_ws(E'\n', nullif(trim(o.obs), ''),
    case when v_nfora > 0 then 'Itens apontados pela oficina no orçamento ' || v_ref || ' e NÃO aprovados pelo cliente: ' || v_lista_fora || '.' end));

  insert into public.ordens (status, cliente_id, veiculo_id, cliente, veiculo, km_entrada, reclamacao, checkin, consultor_id, consultor_nome, garantia_dias,
      condicoes_pagamento, tabela_preco, desconto, total, custo, validade_orcamento, orcamento_enviado_em, aprovacao, obs_execucao, obs_internas, orcamento_id, orcamento_numero)
  values ('execucao', v_cli.id, v_vei.id,
      jsonb_build_object('nome', v_cli.nome, 'telefone', coalesce(v_cli.telefone, ''), 'doc', coalesce(v_cli.doc, ''), 'endereco', v_end),
      jsonb_build_object('placa', v_vei.placa, 'marca', v_vei.marca, 'modelo', v_vei.modelo, 'ano', v_vei.ano, 'cor', coalesce(v_vei.cor, ''), 'motor', coalesce(nullif(to_jsonb(v_vei)->>'combustivel', ''), v_vei.motor, '')),
      null, o.reclamacao, jsonb_build_object('feito', false, 'aguardando_veiculo', true, 'orcamento', v_ref),
      auth.uid(), coalesce(v_perfil.nome, ''), coalesce((cfg->>'garantiaDias')::int, 90),
      coalesce(nullif(o.condicoes_pagamento, ''), cfg->>'condicoesPadrao', ''), o.tabela_preco, o.desconto, greatest(v_sub - o.desconto, 0), v_custo, o.validade, o.enviado_em,
      jsonb_build_object('em', now(), 'por', coalesce(nullif(trim(p_por), ''), v_cli.nome), 'forma', coalesce(nullif(trim(p_forma), ''), 'Orçamento ' || v_ref || ' aprovado'), 'obs', '', 'assinatura', '', 'orcamento', v_ref),
      v_obs, o.obs_internas, o.id, o.numero)
  returning * into v_ord;

  -- itens aprovados entram aprovados (o gatilho do os_itens dá a baixa das peças do estoque)
  insert into public.os_itens (ordem_id, tipo, descricao, codigo, fornecedor, fornecedor_id, produto_id, qtd, valor_unit, custo_unit, desconto, horas, fornecida_cliente, qualidade, adicional, aprovado, executado, posicao)
  select v_ord.id, i.tipo, i.descricao, i.codigo, i.fornecedor,
         case when exists (select 1 from public.fornecedores f where f.id = i.fornecedor_id) then i.fornecedor_id end,
         case when exists (select 1 from public.produtos pr where pr.id = i.produto_id) then i.produto_id end,
         i.qtd, i.valor_unit, i.custo_unit, i.desconto, i.horas, i.fornecida_cliente, i.qualidade, false, true, false, row_number() over (order by i.posicao)
  from public.orcamento_itens i where i.orcamento_id = o.id and not (i.id = any(v_fora)) and i.aprovado is distinct from false;

  update public.orcamento_itens set aprovado = (not (id = any(v_fora)) and aprovado is distinct from false) where orcamento_id = o.id;
  update public.orcamentos set situacao = 'aprovado', respondido_em = now(), ordem_id = v_ord.id, os_numero = v_ord.numero, cliente_id = v_cli.id, veiculo_id = v_vei.id,
      total = greatest(v_sub - o.desconto, 0), custo = v_custo, motivo = '' where id = o.id;

  insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
  values (v_ord.id, 'abertura', 'O.S. aberta a partir do orçamento ' || v_ref || ', já aprovada (' || v_n || ' item(ns)).'
      || case when v_nfora > 0 then ' Não aprovados pelo cliente, apesar de apontados pela oficina: ' || v_lista_fora || '.' else '' end
      || ' O veículo ainda não deu entrada: registrar o KM quando chegar.', coalesce(v_perfil.nome, ''));

  return v_resumo || jsonb_build_object('pode_aprovar', true, 'gravado', true, 'ordem_id', v_ord.id, 'os_numero', v_ord.numero, 'cliente_novo', v_cli_novo, 'veiculo_novo', v_vei_novo);
end $$;
revoke all on function public.orcamento_aprovar(uuid, uuid[], text, text, boolean) from public, anon;
grant execute on function public.orcamento_aprovar(uuid, uuid[], text, text, boolean) to authenticated;
