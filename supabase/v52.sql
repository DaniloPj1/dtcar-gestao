-- v52 (11/11/2026, pedido do Danilo em 10/11): ORÇAMENTO SEPARADO DA O.S. — etapa 1 (banco, tela e PDF).
-- Hoje todo atendimento nasce em "ordens" e gasta número de O.S., mesmo quando o cliente só pediu preço. Daqui em diante o
-- orçamento de quem ainda NÃO deixou o carro fica em tabela própria, com numeração própria (ORC-00001), e só vira O.S. quando
-- o cliente aprova (etapa 2: orcamento_aprovar). Carro que entra no pátio para diagnóstico continua nascendo como O.S.
-- As O.S. que já existem (inclusive as que estão na etapa "Orçamento") não mudam em nada.
-- Orçamento NÃO mexe em estoque nem em financeiro: nenhuma função ou gatilho daqui toca produtos, reservas, contas ou recibos.
--
--   orcamentos        cabeçalho: cliente e veículo (cadastro OU só nome/telefone/placa digitados), pedido, validade, situação
--   orcamento_itens   peças, serviços e terceiros, com as mesmas colunas de preço do os_itens; aprovado = false: item recusado
--   orcamento_salvar  grava cabeçalho e itens numa transação só (administrador ou consultor) e calcula total e custo
-- Situações gravadas: elaboracao, enviado, aprovado (só pela etapa 2), recusado (com motivo). "Vencido" não é gravado:
-- é o orçamento em elaboração ou enviado cuja validade já passou (calculado na leitura; não precisa de agendamento).
-- Sem chave estrangeira para clientes, veículos, produtos e ordens (como pre_notas, v19): a cópia do nome e da placa fica no
-- próprio orçamento, e apagar um cadastro não apaga o histórico de orçamentos.
-- Período de transição (espelho do OS Oficina): as duas tabelas são PRESERVADAS, não entram em espelho_legado_zerar():
-- orçamento sem O.S. não existe no sistema antigo, então uma carga nunca o traria de volta; e, sem chave estrangeira,
-- a carga que recria clientes e veículos não quebra o orçamento (ele guarda a cópia do nome e da placa).
-- Backup, banco do PC (atualizado_em + exclusoes) e restauração incluídos. Idempotente.

create sequence if not exists public.orc_numero_seq start 1;

create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('public.orc_numero_seq'),
  situacao text not null default 'elaboracao' check (situacao in ('elaboracao', 'enviado', 'aprovado', 'recusado')),
  cliente_id uuid,
  veiculo_id uuid,
  cliente jsonb not null default '{}'::jsonb,   -- { nome, telefone } — cópia do cadastro ou o que foi digitado
  veiculo jsonb not null default '{}'::jsonb,   -- { placa, marca, modelo, ano }
  reclamacao text not null default '',          -- o que o cliente pediu
  obs text not null default '',                 -- sai no orçamento
  obs_internas text not null default '',        -- só a oficina vê
  tabela_preco text not null default 'vista',
  condicoes_pagamento text not null default '',
  desconto numeric(10, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  custo numeric(12, 2) not null default 0,
  validade date,
  enviado_em timestamptz,
  respondido_em timestamptz,
  motivo text not null default '',              -- por que foi recusado
  ordem_id uuid,                                -- O.S. gerada na aprovação (etapa 2)
  os_numero int,
  consultor_id uuid,
  consultor_nome text not null default '',
  criado_por uuid default auth.uid(),
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists orcamentos_situacao on public.orcamentos (situacao);
create index if not exists orcamentos_criado on public.orcamentos (criado_em desc);
create index if not exists orcamentos_atualizado on public.orcamentos (atualizado_em);
create index if not exists orcamentos_cliente on public.orcamentos (cliente_id);

create table if not exists public.orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  orcamento_id uuid not null references public.orcamentos (id) on delete cascade,
  tipo text not null check (tipo in ('servico', 'peca', 'terceiro')),
  descricao text not null,
  codigo text not null default '',
  fornecedor text not null default '',
  fornecedor_id uuid,
  produto_id uuid,
  qtd numeric(10, 3) not null default 1,
  valor_unit numeric(10, 2) not null default 0,
  custo_unit numeric(10, 2) not null default 0,
  desconto numeric(10, 2) not null default 0,
  horas numeric(6, 2),
  fornecida_cliente boolean not null default false,
  qualidade text not null default '',
  aprovado boolean,                              -- null = sem resposta; false = o cliente não quis este item
  posicao int not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists orcamento_itens_orcamento on public.orcamento_itens (orcamento_id);
create index if not exists orcamento_itens_atualizado on public.orcamento_itens (atualizado_em);

-- número: quem inclui com número (restauração de backup) empurra a sequência, para o próximo nunca repetir
create or replace function public.orcamentos_numero() returns trigger language plpgsql set search_path = public as $$
begin
  if new.numero is null then new.numero := nextval('public.orc_numero_seq');
  elsif new.numero >= (select last_value from public.orc_numero_seq) then perform setval('public.orc_numero_seq', new.numero, true);
  end if;
  return new;
end $$;
drop trigger if exists orcamentos_numero on public.orcamentos;
create trigger orcamentos_numero before insert on public.orcamentos for each row execute function public.orcamentos_numero();

-- data de alteração, aviso de exclusão ao banco do PC (v13) e regras de acesso
do $$
declare t text;
begin
  foreach t in array array['orcamentos', 'orcamento_itens'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_toca', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.toca_atualizado()', t || '_toca', t);
    execute format('drop trigger if exists %I on public.%I', t || '_exclusao', t);
    execute format('create trigger %I after delete on public.%I for each row execute function public.registra_exclusao()', t || '_exclusao', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    -- a equipe toda lê (o mecânico consulta); só administrador e consultor gravam (como "orcar" em js/regras.js)
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.e_membro())', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_incluir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.e_gestor())', t || '_incluir', t);
    execute format('drop policy if exists %I on public.%I', t || '_alterar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.e_gestor()) with check (public.e_gestor())', t || '_alterar', t);
    execute format('drop policy if exists %I on public.%I', t || '_excluir', t);
  end loop;
end $$;
-- itens saem na edição (gestor); o orçamento inteiro só o administrador apaga
create policy orcamento_itens_excluir on public.orcamento_itens for delete to authenticated using (public.e_gestor());
create policy orcamentos_excluir on public.orcamentos for delete to authenticated using (public.e_admin());
grant usage on sequence public.orc_numero_seq to authenticated;

-- papel só de leitura do agente (v19): lê os orçamentos sem a cópia do cliente (telefone), como nas O.S.
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    revoke all on public.orcamentos, public.orcamento_itens from agente_leitura;
    grant select (id, numero, situacao, cliente_id, veiculo_id, veiculo, reclamacao, obs, tabela_preco, condicoes_pagamento, desconto, total, custo,
                  validade, enviado_em, respondido_em, motivo, ordem_id, os_numero, consultor_nome, criado_em, atualizado_em) on public.orcamentos to agente_leitura;
    grant select on public.orcamento_itens to agente_leitura;
    drop policy if exists orcamentos_agente_ler on public.orcamentos;
    create policy orcamentos_agente_ler on public.orcamentos for select to agente_leitura using (true);
    drop policy if exists orcamento_itens_agente_ler on public.orcamento_itens;
    create policy orcamento_itens_agente_ler on public.orcamento_itens for select to agente_leitura using (true);
  end if;
end $$;

-- Grava o orçamento inteiro (cabeçalho + itens) numa transação. p: { id (ausente = novo), cliente_id, veiculo_id, cliente, veiculo,
-- reclamacao, obs, obs_internas, tabela_preco, condicoes_pagamento, desconto, validade, situacao, motivo, itens: [...] }.
-- Itens que não vierem na lista são removidos. Total = itens não recusados − desconto (como "totais" em js/util.js).
create or replace function public.orcamento_salvar(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_id uuid := nullif(p->>'id', '')::uuid; o public.orcamentos; it jsonb; v_pos int := 0; v_sit text; v_sub numeric := 0; v_custo numeric := 0;
  v_desc numeric := greatest(coalesce(nullif(p->>'desconto', '')::numeric, 0), 0); v_ids uuid[] := '{}'; v_iid uuid; v_novo boolean := false; v_nome text;
begin
  if not public.e_gestor() then raise exception 'Só administrador ou consultor grava orçamento.'; end if;
  if jsonb_typeof(coalesce(p->'itens', '[]'::jsonb)) <> 'array' then raise exception 'itens deve ser uma lista.'; end if;
  if v_id is not null then
    select * into o from public.orcamentos where id = v_id for update;
  end if;
  if o.id is null then v_novo := true; v_id := coalesce(v_id, gen_random_uuid());
  elsif o.situacao = 'aprovado' then raise exception 'O orçamento % já virou O.S.: não pode mais ser alterado.', 'ORC-' || lpad(o.numero::text, 5, '0');
  end if;
  v_sit := coalesce(nullif(p->>'situacao', ''), o.situacao, 'elaboracao');
  if v_sit not in ('elaboracao', 'enviado', 'recusado') then raise exception 'Situação inválida: %. O orçamento só fica "aprovado" quando vira O.S.', v_sit; end if;
  if v_sit = 'recusado' and trim(coalesce(p->>'motivo', o.motivo, '')) = '' then raise exception 'Informe o motivo da recusa.'; end if;
  if trim(coalesce(p->'cliente'->>'nome', '')) = '' then raise exception 'Informe o cliente (cadastro ou nome).'; end if;

  -- itens: confere e soma (item recusado não entra no total; peça do cliente vale zero)
  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    if coalesce(it->>'tipo', '') not in ('servico', 'peca', 'terceiro') then raise exception 'Item com tipo inválido: %.', it->>'tipo'; end if;
    if trim(coalesce(it->>'descricao', '')) = '' then raise exception 'Há item sem descrição.'; end if;
    if coalesce(nullif(it->>'qtd', '')::numeric, 0) <= 0 then raise exception 'Item "%": a quantidade deve ser maior que zero.', it->>'descricao'; end if;
    if (it->>'aprovado') is distinct from 'false' then
      v_sub := v_sub + round(coalesce(nullif(it->>'qtd', '')::numeric, 0) * coalesce(nullif(it->>'valor_unit', '')::numeric, 0) - coalesce(nullif(it->>'desconto', '')::numeric, 0), 2);
      v_custo := v_custo + round(coalesce(nullif(it->>'qtd', '')::numeric, 0) * coalesce(nullif(it->>'custo_unit', '')::numeric, 0), 2);
    end if;
  end loop;
  if v_desc > v_sub + 0.001 then raise exception 'O desconto (%) não pode ser maior que o valor dos itens (%).', v_desc, v_sub; end if;

  if v_novo then
    select nome into v_nome from public.perfis where id = auth.uid();
    insert into public.orcamentos (id, situacao, cliente_id, veiculo_id, cliente, veiculo, reclamacao, obs, obs_internas, tabela_preco, condicoes_pagamento,
        desconto, total, custo, validade, enviado_em, respondido_em, motivo, consultor_id, consultor_nome)
    values (v_id, v_sit, nullif(p->>'cliente_id', '')::uuid, nullif(p->>'veiculo_id', '')::uuid, coalesce(p->'cliente', '{}'::jsonb), coalesce(p->'veiculo', '{}'::jsonb),
        coalesce(p->>'reclamacao', ''), coalesce(p->>'obs', ''), coalesce(p->>'obs_internas', ''), coalesce(nullif(p->>'tabela_preco', ''), 'vista'), coalesce(p->>'condicoes_pagamento', ''),
        v_desc, greatest(v_sub - v_desc, 0), v_custo, nullif(p->>'validade', '')::date,
        case when v_sit = 'enviado' then now() end, case when v_sit = 'recusado' then now() end, case when v_sit = 'recusado' then trim(p->>'motivo') else '' end,
        auth.uid(), coalesce(v_nome, ''));
  else
    update public.orcamentos set situacao = v_sit, cliente_id = nullif(p->>'cliente_id', '')::uuid, veiculo_id = nullif(p->>'veiculo_id', '')::uuid,
        cliente = coalesce(p->'cliente', cliente), veiculo = coalesce(p->'veiculo', veiculo),
        reclamacao = coalesce(p->>'reclamacao', reclamacao), obs = coalesce(p->>'obs', obs), obs_internas = coalesce(p->>'obs_internas', obs_internas),
        tabela_preco = coalesce(nullif(p->>'tabela_preco', ''), tabela_preco), condicoes_pagamento = coalesce(p->>'condicoes_pagamento', condicoes_pagamento),
        desconto = v_desc, total = greatest(v_sub - v_desc, 0), custo = v_custo, validade = nullif(p->>'validade', '')::date,
        enviado_em = case when v_sit = 'enviado' then coalesce(enviado_em, now()) else enviado_em end,
        respondido_em = case when v_sit = 'recusado' then coalesce(respondido_em, now()) else null end,
        motivo = case when v_sit = 'recusado' then trim(coalesce(p->>'motivo', motivo)) else '' end
      where id = v_id;
  end if;

  for it in select * from jsonb_array_elements(coalesce(p->'itens', '[]'::jsonb)) loop
    v_pos := v_pos + 1; v_iid := coalesce(nullif(it->>'id', '')::uuid, gen_random_uuid()); v_ids := v_ids || v_iid;
    insert into public.orcamento_itens (id, orcamento_id, tipo, descricao, codigo, fornecedor, fornecedor_id, produto_id, qtd, valor_unit, custo_unit, desconto, horas,
        fornecida_cliente, qualidade, aprovado, posicao)
    values (v_iid, v_id, it->>'tipo', trim(it->>'descricao'), coalesce(it->>'codigo', ''), coalesce(it->>'fornecedor', ''), nullif(it->>'fornecedor_id', '')::uuid,
        nullif(it->>'produto_id', '')::uuid, (it->>'qtd')::numeric, coalesce(nullif(it->>'valor_unit', '')::numeric, 0), coalesce(nullif(it->>'custo_unit', '')::numeric, 0),
        coalesce(nullif(it->>'desconto', '')::numeric, 0), nullif(it->>'horas', '')::numeric, coalesce((it->>'fornecida_cliente')::boolean, false), coalesce(it->>'qualidade', ''),
        nullif(it->>'aprovado', '')::boolean, v_pos)
    on conflict (id) do update set tipo = excluded.tipo, descricao = excluded.descricao, codigo = excluded.codigo, fornecedor = excluded.fornecedor,
        fornecedor_id = excluded.fornecedor_id, produto_id = excluded.produto_id, qtd = excluded.qtd, valor_unit = excluded.valor_unit, custo_unit = excluded.custo_unit,
        desconto = excluded.desconto, horas = excluded.horas, fornecida_cliente = excluded.fornecida_cliente, qualidade = excluded.qualidade, aprovado = excluded.aprovado,
        posicao = excluded.posicao
      where orcamento_itens.orcamento_id = v_id;   -- nunca mexe em item de outro orçamento
  end loop;
  delete from public.orcamento_itens where orcamento_id = v_id and not (id = any(v_ids));

  select * into o from public.orcamentos where id = v_id;
  return to_jsonb(o) || jsonb_build_object('itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.posicao) from public.orcamento_itens i where i.orcamento_id = v_id), '[]'::jsonb));
end $$;
revoke all on function public.orcamento_salvar(jsonb) from public, anon;
grant execute on function public.orcamento_salvar(jsonb) to authenticated;

-- backup: a restauração passa a aceitar as tabelas de orçamento (resto igual ao v28)
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text; ausentes uuid[] := '{}';
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias', 'estornos_saldo',
                      'pre_notas', 'pre_notas_itens', 'agente_acoes', 'agente_regras', 'boletos', 'boletos_arquivos',
                      'orcamentos', 'orcamento_itens') then
    raise exception 'Tabela não permitida: %', p_tabela;
  end if;
  perform set_config('dtcar.sem_estoque', '1', true);
  -- backup feito antes da v18 não tem as colunas novas: sem isso elas viriam nulas e a linha seria recusada
  if p_tabela = 'contas' then
    p_linhas := (select coalesce(jsonb_agg(jsonb_build_object('conta_origem', '') || jsonb_strip_nulls(e)), '[]'::jsonb) from jsonb_array_elements(p_linhas) e);
  elsif p_tabela = 'recibos' then
    p_linhas := (select coalesce(jsonb_agg(jsonb_build_object('conta_destino', '') || jsonb_strip_nulls(e)), '[]'::jsonb) from jsonb_array_elements(p_linhas) e);
  end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a where a.attrelid = ('public.' || p_tabela)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  -- registros que vão voltar (ainda não existem): se tinham estornos (foram excluídos), a volta compensa
  if p_tabela in ('transferencias', 'recibos', 'contas') then
    execute format('select coalesce(array_agg((x->>''id'')::uuid), ''{}'') from jsonb_array_elements($1) x where not exists (select 1 from public.%I t where t.id = (x->>''id'')::uuid)', p_tabela)
      into ausentes using p_linhas;
  end if;
  execute format('select count(*) from public.%I', p_tabela) into antes;
  q := format('insert into public.%1$I (%2$s) overriding system value select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing', p_tabela, cols);
  begin
    execute q using p_linhas;
  exception when others then
    for r in select * from jsonb_array_elements(p_linhas) loop
      begin execute q using jsonb_build_array(r); exception when others then erros := erros + 1; end;
    end loop;
  end;
  execute format('select count(*) from public.%I', p_tabela) into depois;
  -- registro que voltou e tinha estornos (foi excluído depois de entrar no saldo): grava o efeito do estado restaurado
  -- (Σ estornos = efeito atual − efeito na referência; o registro estava ausente, efeito atual 0 → soma-se o efeito do que voltou)
  if array_length(ausentes, 1) > 0 then
    if p_tabela = 'transferencias' then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
      select x.conta, x.valor, 'restauracao', t.id, t.criado_em from public.transferencias t
        cross join lateral (values (t.de_conta, -t.valor), (t.para_conta, t.valor)) x(conta, valor)
        where t.id = any(ausentes) and exists (select 1 from public.estornos_saldo e where e.registro = t.id);
    elsif p_tabela = 'recibos' then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
      select r.conta_destino, r.valor, 'restauracao', r.id, r.criado_em from public.recibos r
        where r.id = any(ausentes) and not r.cancelado and r.conta_destino <> '' and exists (select 1 from public.estornos_saldo e where e.registro = r.id);
    elsif p_tabela = 'contas' then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
      select c.conta_origem, -coalesce(c.valor_pago, c.valor), 'restauracao', c.id,
             coalesce(c.pago_registrado_em, (select min(e.original_em) from public.estornos_saldo e where e.registro = c.id)) from public.contas c
        where c.id = any(ausentes) and c.status = 'paga' and c.conta_origem <> '' and exists (select 1 from public.estornos_saldo e where e.registro = c.id);
    end if;
  end if;
  return jsonb_build_object('incluidos', depois - antes, 'erros', erros);
end $$;
revoke all on function public.restaurar_tabela(text, jsonb) from public, anon;
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;
