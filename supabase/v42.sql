-- =====================================================================
-- DTCar Gestão — v42: dar entrada de NF de compra (SEFAZ) no estoque pelo conector (06/11/2026)
--
-- Pedido do Danilo (06/11/2026): no estoque, o agente atende a tudo o que ele pedir.
-- Faz o mesmo que Notas da SEFAZ › "Dar entrada no estoque" (js/telas/compras.js):
--   1. lê o XML guardado em nfe_recebidas (xpath do próprio Postgres, como lerNFe de js/nfe.js);
--   2. reconhece os produtos como reconhecer(): vínculo do fornecedor (produto_fornecedor),
--      código de barras (EAN) e referência; o resto vira produto novo (margem = Ajustes › markup de peças);
--   3. o Danilo pode trocar a decisão de cada item: itens [{n, acao: vincular|novo|ignorar, codigo, fator, descricao, margem}];
--   4. grava pela importar_nfe (v4: fornecedor, estoque, custo, vínculo, notas_entrada) e
--      lança as duplicatas em contas a pagar pela lancar_contas (v5), como a tela.
-- Pelo agente_fazer (v40): a prévia faz e desfaz — mostra exatamente o que entraria.
-- Rode depois do v41. Pode rodar mais de uma vez. Nenhuma tabela nova.
-- =====================================================================

-- texto do primeiro nó (xpath com o namespace da NF-e)
create or replace function public.agente_nfe_txt(x xml, caminho text) returns text language sql immutable as $$
  select nullif(trim((xpath(caminho || '/text()', x, array[array['n', 'http://www.portalfiscal.inf.br/nfe']]))[1]::text), '') $$;
create or replace function public.agente_nfe_num(x xml, caminho text) returns numeric language sql immutable as $$
  select coalesce(nullif(public.agente_nfe_txt(x, caminho), '')::numeric, 0) $$;

-- XML da NF-e → {nota, fornecedor, itens, duplicatas} (mesmos campos de lerNFe em js/nfe.js)
create or replace function public.agente_ler_nfe(p_xml text) returns jsonb language plpgsql immutable as $$
declare x xml; inf xml; det xml; p xml; ns text[] := array[array['n', 'http://www.portalfiscal.inf.br/nfe']]; itens jsonb := '[]'; dups jsonb := '[]';
  v_qtd numeric; v_prod numeric; v_extras numeric; v_ean text; d xml; v_chave text;
begin
  begin x := xmlparse(document p_xml); exception when others then raise exception 'O XML da nota não é válido.'; end;
  inf := (xpath('//n:infNFe', x, ns))[1];
  if inf is null then raise exception 'Este XML não é uma NF-e (sem infNFe).'; end if;
  v_chave := regexp_replace(coalesce((xpath('/n:infNFe/@Id', inf, ns))[1]::text, public.agente_nfe_txt(x, '//n:protNFe//n:chNFe'), ''), '\D', '', 'g');
  for det in select unnest(xpath('/n:infNFe/n:det', inf, ns)) loop
    p := (xpath('/n:det/n:prod', det, ns))[1];
    v_qtd := nullif(public.agente_nfe_num(p, '/n:prod/n:qCom'), 0); v_qtd := coalesce(v_qtd, 1);
    v_prod := public.agente_nfe_num(p, '/n:prod/n:vProd');
    v_extras := public.agente_nfe_num(p, '/n:prod/n:vFrete') + public.agente_nfe_num(p, '/n:prod/n:vSeg') + public.agente_nfe_num(p, '/n:prod/n:vOutro')
              - public.agente_nfe_num(p, '/n:prod/n:vDesc') + public.agente_nfe_num(det, '/n:det/n:imposto/n:IPI//n:vIPI') + public.agente_nfe_num(det, '/n:det/n:imposto/n:ICMS//n:vICMSST');
    v_ean := coalesce((select e from unnest(array[public.agente_nfe_txt(p, '/n:prod/n:cEAN'), public.agente_nfe_txt(p, '/n:prod/n:cEANTrib')]) e where e ~ '^\d{8,14}$' limit 1), '');
    itens := itens || jsonb_build_array(jsonb_build_object(
      'n', coalesce((xpath('/n:det/@nItem', det, ns))[1]::text, '0')::int, 'codigo', coalesce(public.agente_nfe_txt(p, '/n:prod/n:cProd'), ''), 'ean', v_ean,
      'descricao_nf', coalesce(public.agente_nfe_txt(p, '/n:prod/n:xProd'), ''), 'ncm', coalesce(public.agente_nfe_txt(p, '/n:prod/n:NCM'), ''),
      'unidade', upper(coalesce(public.agente_nfe_txt(p, '/n:prod/n:uCom'), '')), 'qtd', v_qtd, 'valor_unit_nf', public.agente_nfe_num(p, '/n:prod/n:vUnCom'),
      'total_nf', v_prod, 'extras', round(v_extras, 2), 'custo_unit', round((v_prod + v_extras) / v_qtd, 4)));
  end loop;
  if jsonb_array_length(itens) = 0 then raise exception 'A nota não tem itens.'; end if;
  for d in select unnest(xpath('/n:infNFe/n:cobr/n:dup', inf, ns)) loop
    if public.agente_nfe_num(d, '/n:dup/n:vDup') > 0 and coalesce(public.agente_nfe_txt(d, '/n:dup/n:dVenc'), '') ~ '^\d{4}-\d{2}-\d{2}$' then
      dups := dups || jsonb_build_array(jsonb_build_object('numero', coalesce(public.agente_nfe_txt(d, '/n:dup/n:nDup'), lpad((jsonb_array_length(dups) + 1)::text, 3, '0')),
        'vencimento', public.agente_nfe_txt(d, '/n:dup/n:dVenc'), 'valor', public.agente_nfe_num(d, '/n:dup/n:vDup')));
    end if;
  end loop;
  return jsonb_build_object(
    'nota', jsonb_build_object('chave', v_chave, 'numero', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:ide/n:nNF'), ''), 'serie', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:ide/n:serie'), ''),
      'emissao', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:ide/n:dhEmi'), public.agente_nfe_txt(inf, '/n:infNFe/n:ide/n:dEmi'), ''),
      'valor_total', public.agente_nfe_num(inf, '/n:infNFe/n:total/n:ICMSTot/n:vNF')),
    'fornecedor', jsonb_build_object('cnpj', regexp_replace(coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:CNPJ'), public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:CPF'), ''), '\D', '', 'g'),
      'razao', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:xNome'), ''), 'fantasia', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:xFant'), ''),
      'ie', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:IE'), ''),
      'telefone', regexp_replace(coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:fone'), ''), '\D', '', 'g'),
      'endereco', concat_ws(', ', public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:xLgr'), public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:nro'), public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:xCpl')),
      'bairro', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:xBairro'), ''), 'cidade', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:xMun'), ''),
      'uf', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:UF'), ''), 'cep', coalesce(public.agente_nfe_txt(inf, '/n:infNFe/n:emit/n:enderEmit/n:CEP'), '')),
    'itens', itens, 'duplicatas', dups);
end $$;

-- p: chave (44 dígitos) ou numero (+ fornecedor: parte do nome ou CNPJ); itens [{n, acao, codigo, fator, descricao, margem, atualizar_custo}];
--    lancar_contas (padrão true), vencimento (nota sem duplicata), categoria
create or replace function public.agente_entrada_nfe(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  n public.nfe_recebidas; v_n int; nf jsonb; forn uuid; it jsonb; ov jsonb; pr public.produtos; v_lista jsonb := '[]'; v_res jsonb; v_acao text; v_fator numeric;
  v_ref text; v_marg numeric; cfg jsonb; v_contas jsonb := '[]'; r_contas jsonb; v_nome text; v_grupo uuid := gen_random_uuid(); d jsonb; avisos text[] := '{}'; v_cand jsonb;
begin
  select dados into cfg from public.config where id = 1;
  if length(regexp_replace(coalesce(p->>'chave', ''), '\D', '', 'g')) = 44 then
    select * into n from public.nfe_recebidas where chave = regexp_replace(p->>'chave', '\D', '', 'g');
  elsif coalesce(p->>'numero', '') <> '' then
    select coalesce(jsonb_agg(jsonb_build_object('chave', x.chave, 'numero', x.numero, 'emitente', x.nome_emitente, 'emissao', x.emissao, 'valor', x.valor)), '[]'), count(*) into v_cand, v_n
    from public.nfe_recebidas x where x.numero::text = trim(p->>'numero')
      and (coalesce(p->>'fornecedor', '') = '' or x.nome_emitente ilike '%' || trim(p->>'fornecedor') || '%' or x.cnpj_emitente = regexp_replace(p->>'fornecedor', '\D', '', 'g'));
    if v_n > 1 then raise exception 'Achei % notas com o número %: diga a chave ou o fornecedor. %', v_n, p->>'numero', left(v_cand::text, 1200); end if;
    select * into n from public.nfe_recebidas where chave = v_cand->0->>'chave';
  else raise exception 'Informe a chave da NF-e ou o número (veja notas_da_sefaz).'; end if;
  if n.chave is null then raise exception 'Nota não encontrada nas Notas da SEFAZ.'; end if;
  if n.xml is null then raise exception 'A NF % ainda não tem o XML completo (dê ciência ou confirme a operação em Notas da SEFAZ, ou peça o XML ao fornecedor).', n.numero; end if;
  if exists (select 1 from public.notas_entrada where chave = n.chave) then raise exception 'A NF % já teve entrada no estoque. Entrar de novo duplicaria o estoque.', n.numero; end if;

  nf := public.agente_ler_nfe(n.xml);
  select id into forn from public.fornecedores where cnpj <> '' and regexp_replace(cnpj, '\D', '', 'g') = nf->'fornecedor'->>'cnpj';
  v_marg := coalesce(nullif(cfg->>'markupPecas', '')::numeric, 30);
  v_nome := coalesce(nullif(nf->'fornecedor'->>'fantasia', ''), nf->'fornecedor'->>'razao');

  for it in select * from jsonb_array_elements(nf->'itens') loop
    pr := null; v_fator := 1; v_acao := 'novo';
    -- reconhecer (como js/nfe.js): vínculo do fornecedor, EAN, referência
    if forn is not null then
      select x.* into pr from public.produto_fornecedor pf join public.produtos x on x.id = pf.produto_id
        where pf.fornecedor_id = forn and pf.codigo = it->>'codigo' and x.tipo = 'produto' limit 1;
      if pr.id is not null then select pf.fator into v_fator from public.produto_fornecedor pf where pf.fornecedor_id = forn and pf.codigo = it->>'codigo'; end if;
    end if;
    if pr.id is null and coalesce(it->>'ean', '') <> '' then select * into pr from public.produtos x where x.tipo = 'produto' and x.codigo_barras = it->>'ean' limit 1; v_fator := 1; end if;
    v_ref := upper(regexp_replace(coalesce(it->>'codigo', ''), '[^A-Za-z0-9]', '', 'g'));
    if pr.id is null and length(v_ref) >= 3 then
      select * into pr from public.produtos x where x.tipo = 'produto' and x.referencia <> ''
        and (upper(regexp_replace(x.referencia, '[^A-Za-z0-9]', '', 'g')) = v_ref or (length(v_ref) >= 4 and upper(regexp_replace(x.referencia, '[^A-Za-z0-9]', '', 'g')) like v_ref || '%')) limit 1;
      v_fator := 1;
    end if;
    if pr.id is not null then v_acao := 'vincular'; end if;
    v_fator := coalesce(v_fator, 1);
    -- decisão do Danilo para este item
    select e into ov from jsonb_array_elements(coalesce(p->'itens', '[]')) e where (e->>'n')::int = (it->>'n')::int limit 1;
    if ov is not null then
      v_acao := coalesce(nullif(lower(ov->>'acao'), ''), case when coalesce(ov->>'codigo', '') <> '' then 'vincular' else v_acao end);
      if v_acao not in ('vincular', 'novo', 'ignorar') then raise exception 'Item %: acao deve ser vincular, novo ou ignorar.', it->>'n'; end if;
      if coalesce(ov->>'codigo', '') <> '' then
        select * into pr from public.produtos x where x.tipo = 'produto' and x.codigo::text = trim(ov->>'codigo') limit 1;
        if pr.id is null then raise exception 'Item %: produto % não existe.', it->>'n', ov->>'codigo'; end if;
      end if;
      if nullif(ov->>'fator', '') is not null then v_fator := (ov->>'fator')::numeric; end if;
      if v_fator <= 0 then raise exception 'Item %: fator inválido.', it->>'n'; end if;
    end if;
    if v_acao = 'vincular' and pr.id is null then raise exception 'Item % (%): informe o codigo do produto para vincular.', it->>'n', it->>'descricao_nf'; end if;
    v_lista := v_lista || jsonb_build_array(jsonb_build_object('acao', v_acao, 'produto_id', case when v_acao = 'vincular' then pr.id end,
      'codigo', it->>'codigo', 'ean', it->>'ean', 'descricao_nf', it->>'descricao_nf', 'unidade', it->>'unidade', 'fator', v_fator, 'qtd', (it->>'qtd')::numeric,
      'custo_unit', (it->>'custo_unit')::numeric, 'atualizar_custo', coalesce((ov->>'atualizar_custo')::boolean, true),
      'novo', case when v_acao = 'novo' then jsonb_build_object('descricao', coalesce(nullif(trim(ov->>'descricao'), ''), it->>'descricao_nf'), 'referencia', it->>'codigo',
        'unidade', case when it->>'unidade' in ('CX', 'PCT', 'JG', 'KT') then it->>'unidade' else coalesce(nullif(it->>'unidade', ''), 'UN') end,
        'margem_vista', coalesce(nullif(ov->>'margem', '')::numeric, v_marg), 'margem_prazo', coalesce(nullif(ov->>'margem', '')::numeric, v_marg),
        'margem_atacado', coalesce(nullif(ov->>'margem', '')::numeric, v_marg), 'estoque_min', 0) end,
      -- só para mostrar
      '_n', (it->>'n')::int, '_produto', case when v_acao = 'vincular' then pr.codigo || ' ' || pr.descricao end));
    ov := null;
  end loop;

  v_res := public.importar_nfe(jsonb_build_object('nota', nf->'nota', 'fornecedor', nf->'fornecedor',
             'itens', (select jsonb_agg(x - '_n' - '_produto') from jsonb_array_elements(v_lista) x)));

  -- contas a pagar: as duplicatas (ou o total, com vencimento informado), como contasDaNota da tela
  if coalesce((p->>'lancar_contas')::boolean, true) then
    if jsonb_array_length(nf->'duplicatas') > 0 then
      for d in select * from jsonb_array_elements(nf->'duplicatas') loop
        v_contas := v_contas || jsonb_build_array(jsonb_build_object('descricao', 'NF ' || (nf->'nota'->>'numero') || ' – ' || v_nome, 'fornecedor_id', v_res->>'fornecedor_id',
          'favorecido', v_nome, 'categoria', coalesce(nullif(p->>'categoria', ''), 'Fornecedores de peças'), 'documento', (nf->'nota'->>'numero') || '/' || (d->>'numero'),
          'valor', d->'valor', 'emissao', left(nf->'nota'->>'emissao', 10), 'vencimento', d->>'vencimento', 'parcela', jsonb_array_length(v_contas) + 1,
          'parcelas', jsonb_array_length(nf->'duplicatas'), 'grupo', v_grupo, 'origem', 'nfe', 'chave_nfe', n.chave));
      end loop;
    elsif coalesce(p->>'vencimento', '') <> '' then
      v_contas := jsonb_build_array(jsonb_build_object('descricao', 'NF ' || (nf->'nota'->>'numero') || ' – ' || v_nome, 'fornecedor_id', v_res->>'fornecedor_id', 'favorecido', v_nome,
        'categoria', coalesce(nullif(p->>'categoria', ''), 'Fornecedores de peças'), 'documento', (nf->'nota'->>'numero') || '/001', 'valor', nf->'nota'->'valor_total',
        'emissao', left(nf->'nota'->>'emissao', 10), 'vencimento', p->>'vencimento', 'parcela', 1, 'parcelas', 1, 'grupo', v_grupo, 'origem', 'nfe', 'chave_nfe', n.chave));
    else avisos := array_append(avisos, 'A nota não traz duplicatas: nenhuma conta a pagar lançada (informe vencimento para lançar o total).'); end if;
    if jsonb_array_length(v_contas) > 0 then
      r_contas := public.lancar_contas(v_contas);
      update public.nfe_recebidas set contas_lancadas = true where chave = n.chave;
    end if;
  end if;

  perform public.agente_registrar('entrada_nota', p, 'notas_entrada', n.chave, null, jsonb_build_object('resultado', v_res, 'itens', v_lista, 'contas', r_contas));
  return jsonb_build_object('nf', nf->'nota'->>'numero', 'fornecedor', v_nome, 'valor_total', (nf->'nota'->>'valor_total')::numeric, 'chave', n.chave,
    'itens', (select jsonb_agg(jsonb_build_object('n', x->'_n', 'descricao_nf', x->>'descricao_nf', 'acao', x->>'acao', 'produto', coalesce(x->>'_produto', x->'novo'->>'descricao'),
        'qtd_nota', x->'qtd', 'fator', x->'fator', 'qtd_estoque', (x->>'qtd')::numeric * (x->>'fator')::numeric, 'custo_unit_estoque', round((x->>'custo_unit')::numeric / (x->>'fator')::numeric, 4)) order by (x->>'_n')::int)
      from jsonb_array_elements(v_lista) x),
    'resultado', v_res, 'duplicatas', nf->'duplicatas', 'contas_lancadas', coalesce((r_contas->>'lancadas')::int, 0), 'contas_repetidas', coalesce((r_contas->>'repetidas')::int, 0),
    'avisos', to_jsonb(avisos));
end $$;

do $$
declare src text;
begin
  select pg_get_functiondef('public.agente_fazer(text, jsonb, boolean)'::regprocedure) into src;
  if src not like '%agente_entrada_nfe%' then
    src := replace(src, $a$when 'boleto_gravar' then 'agente_boleto_gravar' end;$a$,
                        $b$when 'boleto_gravar' then 'agente_boleto_gravar' when 'entrada_nota' then 'agente_entrada_nfe' end;$b$);
    if src not like '%agente_entrada_nfe%' then raise exception 'v42: não reconheci a agente_fazer do v41 (rode o v41 antes).'; end if;
    execute src;
  end if;
end $$;

do $$
declare f text;
begin
  foreach f in array array['agente_nfe_txt(xml, text)', 'agente_nfe_num(xml, text)', 'agente_ler_nfe(text)', 'agente_entrada_nfe(jsonb)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
