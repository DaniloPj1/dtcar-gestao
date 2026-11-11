-- v51 (10/11/2026, pedido do Danilo): grupos de produtos (filtros na tela de estoque)
-- O grupo é a coluna produtos.categoria (não há tabela nova). A lista oficial de nomes fica em config.dados.gruposProduto
-- (grupos criados sem produto e a grafia escolhida); o resto vem dos próprios produtos.
-- 1. Grafia oficial: dois nomes que só diferem em maiúscula, acento ou espaço são o mesmo grupo. Um gatilho em produtos
--    troca o que foi digitado (tela, entrada de nota, conector) pela grafia oficial: a de config.gruposProduto ou,
--    sem ela, a mais usada no cadastro. Assim "filtros", "FILTROS " e "Filtros" não viram três grupos.
-- 2. agente_estoque ganha o grupo na resposta e um filtro por grupo (consultar_estoque do conector).
-- 3. agente_entrada_nfe: produto novo aceita categoria e, sem ela, sugere o grupo pela referência já cadastrada.
-- Sem tabela nova: nada muda em backup, banco do PC ou exclusões. Idempotente.

-- chave do grupo: sem acento, minúsculas, espaços repetidos viram um
create or replace function public.grupo_chave(t text) returns text language sql immutable as $$
  select regexp_replace(lower(public.unaccent_simples(trim(coalesce(t, '')))), '\s+', ' ', 'g') $$;

-- grafia oficial de um nome de grupo (ou o próprio nome aparado, se for grupo novo)
create or replace function public.grupo_canonico(p_nome text) returns text
language plpgsql stable set search_path = public as $$
declare k text := public.grupo_chave(p_nome); r text;
begin
  if k = '' then return ''; end if;
  select g into r from public.config c, jsonb_array_elements_text(coalesce(c.dados->'gruposProduto', '[]'::jsonb)) g where c.id = 1 and public.grupo_chave(g) = k limit 1;
  if r is null then
    select p.categoria into r from public.produtos p where public.grupo_chave(p.categoria) = k group by p.categoria order by count(*) desc, p.categoria limit 1;
  end if;
  return coalesce(trim(r), trim(p_nome));
end $$;

create or replace function public.produtos_grupo_canonico() returns trigger language plpgsql set search_path = public as $$
begin
  if new.categoria is distinct from old.categoria or tg_op = 'INSERT' then new.categoria := public.grupo_canonico(new.categoria); end if;
  return new;
end $$;
drop trigger if exists produtos_grupo_canonico on public.produtos;
create trigger produtos_grupo_canonico before insert or update of categoria on public.produtos
  for each row execute function public.produtos_grupo_canonico();

-- grupo sugerido para um produto novo da nota: produto já cadastrado com a mesma referência (ou a mesma descrição)
create or replace function public.produtos_grupo_sugerido(p_referencia text, p_descricao text default null) returns text
language sql stable set search_path = public as $$
  select p.categoria from public.produtos p
  where p.categoria <> '' and ((nullif(trim(coalesce(p_referencia, '')), '') is not null and lower(trim(p.referencia)) = lower(trim(p_referencia)))
     or (nullif(trim(coalesce(p_descricao, '')), '') is not null and lower(trim(p.descricao)) = lower(trim(p_descricao))))
  order by p.ativo desc, p.atualizado_em desc nulls last limit 1 $$;

-- conector: consultar_estoque com grupo (resposta e filtro). A assinatura antiga (text) sai para não ficar ambígua.
drop function if exists public.agente_estoque(text);
create or replace function public.agente_estoque(p_texto text default null, p_grupo text default null) returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare q text := lower(trim(coalesce(p_texto, ''))); g text := public.grupo_chave(p_grupo); r jsonb; grupos jsonb;
begin
  perform public.agente_exige_admin();
  if length(q) < 2 and g = '' then raise exception 'Digite pelo menos 2 letras da peça, o código ou a referência, ou informe o grupo.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'descricao', p.descricao, 'referencia', p.referencia, 'marca', p.marca, 'grupo', p.categoria,
      'estoque', p.estoque_atual, 'minimo', p.estoque_min, 'custo', p.custo, 'preco_vista', p.preco_vista, 'preco_prazo', p.preco_prazo,
      'local', p.localizacao, 'ativo', p.ativo) order by p.descricao), '[]'::jsonb) into r
  from (select * from public.produtos p
        where p.tipo = 'produto'
          and (g = '' or (g = 'sem grupo' and public.grupo_chave(p.categoria) = '') or public.grupo_chave(p.categoria) = g)
          and (length(q) < 2 or lower(p.descricao) like '%' || q || '%' or lower(coalesce(p.referencia, '')) like '%' || q || '%'
               or lower(coalesce(p.marca, '')) like '%' || q || '%' or p.codigo::text = q or lower(coalesce(p.codigo_barras, '')) = q)
        order by p.ativo desc, p.descricao limit case when g <> '' and length(q) < 2 then 200 else 20 end) p;
  -- grupos existentes, para o conector saber os nomes (produtos ativos por grupo)
  select coalesce(jsonb_agg(jsonb_build_object('grupo', x.categoria, 'produtos', x.n) order by x.categoria), '[]'::jsonb) into grupos
  from (select p.categoria, count(*) n from public.produtos p where p.tipo = 'produto' and p.ativo and p.categoria <> '' group by p.categoria) x;
  return jsonb_build_object('itens', r, 'grupos', grupos);
end $$;
revoke all on function public.agente_estoque(text, text) from public, anon;
grant execute on function public.agente_estoque(text, text) to authenticated;

-- entrada de nota pelo conector: produto novo com grupo (itens [{n, acao: novo, categoria}]) e sugestão pela referência
create or replace function public.agente_entrada_nfe(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  n public.nfe_recebidas; v_n int; nf jsonb; forn uuid; it jsonb; ov jsonb; pr public.produtos; v_lista jsonb := '[]'; v_res jsonb; v_acao text; v_fator numeric;
  v_ref text; v_marg numeric; cfg jsonb; v_contas jsonb := '[]'; r_contas jsonb; v_nome text; v_grupo uuid := gen_random_uuid(); d jsonb; avisos text[] := '{}'; v_cand jsonb; v_ligado jsonb; v_qtd numeric; v_cat text;
begin
  perform public.agente_exige_admin();
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
  if coalesce(to_jsonb(n)->>'situacao', 'autorizada') <> 'autorizada' then raise exception 'A NF % está % na SEFAZ: não dá entrada.', n.numero, to_jsonb(n)->>'situacao'; end if;
  if n.status = 'ignorada' then avisos := array_append(avisos, 'A nota estava marcada como ignorada nas Notas da SEFAZ.'); end if;
  -- peças desta nota já ligadas a O.S. (v9) já entraram e saíram do estoque: só a sobra entra aqui (como "O que sobrou da nota")
  if exists (select 1 from public.nfe_os_vinculos v where v.chave = n.chave and v.nf_item is null and v.descricao_nf = 'Nota inteira') then
    raise exception 'A NF % inteira já foi ligada a uma O.S.: não há sobra para dar entrada.', n.numero;
  end if;
  select coalesce(jsonb_object_agg(v.nf_item::text, v.q), '{}') into v_ligado from (select nf_item, sum(qtd) q from public.nfe_os_vinculos where chave = n.chave and nf_item is not null group by nf_item) v;

  nf := public.agente_ler_nfe(n.xml);
  select id into forn from public.fornecedores where cnpj <> '' and regexp_replace(cnpj, '\D', '', 'g') = nf->'fornecedor'->>'cnpj';
  v_marg := coalesce(nullif(cfg->>'markupPecas', '')::numeric, 30);
  v_nome := coalesce(nullif(nf->'fornecedor'->>'fantasia', ''), nf->'fornecedor'->>'razao');

  -- itens pedidos que não existem na nota
  select string_agg(e->>'n', ', ') into v_ref from jsonb_array_elements(coalesce(p->'itens', '[]')) e
    where not exists (select 1 from jsonb_array_elements(nf->'itens') x where (x->>'n')::int = (e->>'n')::int);
  if v_ref is not null then raise exception 'Item(ns) % não existe(m) na NF % (a nota tem % itens).', v_ref, n.numero, jsonb_array_length(nf->'itens'); end if;
  for it in select * from jsonb_array_elements(nf->'itens') loop
    pr := null; v_fator := 1; v_acao := 'novo';
    v_qtd := (it->>'qtd')::numeric - coalesce((v_ligado->>(it->>'n'))::numeric, 0);
    if v_qtd <= 0.0001 then
      avisos := array_append(avisos, 'Item ' || (it->>'n') || ' (' || (it->>'descricao_nf') || ') já foi todo para O.S.: fica de fora.');
      v_lista := v_lista || jsonb_build_array(jsonb_build_object('acao', 'ignorar', 'codigo', it->>'codigo', 'descricao_nf', it->>'descricao_nf', 'qtd', 0, 'fator', 1, 'custo_unit', (it->>'custo_unit')::numeric, '_n', (it->>'n')::int));
      continue;
    end if;
    if v_qtd < (it->>'qtd')::numeric then
      avisos := array_append(avisos, 'Item ' || (it->>'n') || ': ' || ((it->>'qtd')::numeric - v_qtd) || ' já foi(ram) para O.S.; entra só a sobra (' || v_qtd || ').');
      it := jsonb_set(it, '{qtd}', to_jsonb(v_qtd));
    end if;
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
        -- v51: grupo do produto novo = o pedido (categoria) ou o grupo de um produto já cadastrado com a mesma referência
        'categoria', coalesce(nullif(trim(ov->>'categoria'), ''), public.produtos_grupo_sugerido(it->>'codigo', it->>'descricao_nf'), ''),
        'unidade', case when it->>'unidade' in ('CX', 'PCT', 'JG', 'KT') then it->>'unidade' else coalesce(nullif(it->>'unidade', ''), 'UN') end,
        'margem_vista', coalesce(nullif(ov->>'margem', '')::numeric, v_marg), 'margem_prazo', coalesce(nullif(ov->>'margem', '')::numeric, v_marg),
        'margem_atacado', coalesce(nullif(ov->>'margem', '')::numeric, v_marg), 'estoque_min', 0) end,
      -- só para mostrar
      '_n', (it->>'n')::int, '_produto', case when v_acao = 'vincular' then pr.codigo || ' ' || pr.descricao end));
    ov := null;
  end loop;

  v_res := public.importar_nfe(jsonb_build_object('nota', nf->'nota', 'fornecedor', nf->'fornecedor',
             'itens', (select jsonb_agg(x - '_n' - '_produto') from jsonb_array_elements(v_lista) x)));

  -- categoria: a pedida, a padrão do fornecedor ou "Fornecedores de peças" (como a tela)
  select coalesce(nullif(p->>'categoria', ''), nullif(to_jsonb(f)->>'categoria_padrao', ''), 'Fornecedores de peças') into v_cat from public.fornecedores f where f.id = (v_res->>'fornecedor_id')::uuid;
  v_cat := coalesce(v_cat, nullif(p->>'categoria', ''), 'Fornecedores de peças');
  -- contas a pagar: as duplicatas (ou o total, com vencimento informado), como contasDaNota da tela
  if coalesce((p->>'lancar_contas')::boolean, true) then
    if jsonb_array_length(nf->'duplicatas') > 0 then
      for d in select * from jsonb_array_elements(nf->'duplicatas') loop
        v_contas := v_contas || jsonb_build_array(jsonb_build_object('descricao', 'NF ' || (nf->'nota'->>'numero') || ' – ' || v_nome, 'fornecedor_id', v_res->>'fornecedor_id',
          'favorecido', v_nome, 'categoria', v_cat, 'documento', (nf->'nota'->>'numero') || '/' || (d->>'numero'),
          'valor', d->'valor', 'emissao', left(nf->'nota'->>'emissao', 10), 'vencimento', d->>'vencimento', 'parcela', jsonb_array_length(v_contas) + 1,
          'parcelas', jsonb_array_length(nf->'duplicatas'), 'grupo', v_grupo, 'origem', 'nfe', 'chave_nfe', n.chave));
      end loop;
    elsif coalesce(p->>'vencimento', '') <> '' then
      v_contas := jsonb_build_array(jsonb_build_object('descricao', 'NF ' || (nf->'nota'->>'numero') || ' – ' || v_nome, 'fornecedor_id', v_res->>'fornecedor_id', 'favorecido', v_nome,
        'categoria', v_cat, 'documento', (nf->'nota'->>'numero') || '/001', 'valor', nf->'nota'->'valor_total',
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

-- acesso das funções novas
revoke all on function public.grupo_canonico(text), public.produtos_grupo_sugerido(text, text) from public, anon;
grant execute on function public.grupo_chave(text), public.grupo_canonico(text), public.produtos_grupo_sugerido(text, text) to authenticated;
