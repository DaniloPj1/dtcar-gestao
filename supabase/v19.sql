-- =====================================================================
-- DTCar Gestão — v19: Fase 0 do agente de IA (Claude) no sistema.
--
-- Só cria a base. Não mexe em nenhum dado que já existe e não muda nada
-- nas telas:
--   1. pre_notas e pre_notas_itens: nota de compra sem NF (foto do cupom
--      ou romaneio) ligada à O.S./placa, com o custo provisório de cada
--      peça. Quando a NF-e chega pela SEFAZ, a pré-nota é "triangulada"
--      (NF ↔ pré-nota ↔ item da O.S.) e o custo oficial substitui o
--      provisório (Fase 3).
--   2. agente_acoes: histórico de tudo o que o agente gravar (antes e
--      depois), para conferir e desfazer.
--   3. agente_regras: o que o agente "aprende" com as correções do Danilo
--      (descrição do fornecedor → produto, preço, prazo, beneficiário
--      aceito do boleto…). Não há autoaprendizado: só o que está aqui.
--   4. papel agente_leitura: papel do banco só de leitura, SEM login
--      (nologin). O acesso do agente é ligado na Fase 1, quando o conector
--      for criado. Não lê telefone, documento (CPF/CNPJ), e-mail e
--      endereço de clientes, nem segredos, certificado e perfis de acesso.
--   5. pasta privada "pre-notas" para as fotos dos cupons.
--   6. backup: a restauração passa a aceitar as tabelas novas.
--
-- Decisões do Danilo (02/11/2026): o estoque oficial é o do DTCar Gestão
-- (D2); peça comprada para uma O.S. tem entrada e baixa simultâneas quando
-- a NF chega (D3); relatório semanal na segunda às 7h (D7).
--
-- Tudo é só do administrador (financeiro e custo). Rode depois do v18.
-- Pode rodar mais de uma vez. O site funciona igual antes e depois.
--
-- Espelho do sistema antigo: desligado desde a virada (02/11/2026). As
-- tabelas novas são PRESERVADAS se o espelho for religado (não entram em
-- espelho_legado_zerar): por isso pre_notas não tem chave estrangeira para
-- ordens, os_itens ou produtos (o espelho apaga essas tabelas); a ligação
-- guarda o nº da O.S., a placa e a descrição, que permitem religar.
-- =====================================================================

-- 1. pré-notas (nota de compra sem NF)
create table if not exists public.pre_notas (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,                 -- data da compra (do cupom)
  fornecedor_id uuid references public.fornecedores (id) on delete set null,
  fornecedor_nome text not null default '',                -- como está no cupom (vale quando o fornecedor ainda não tem cadastro)
  fornecedor_cnpj text not null default '',
  documento text not null default '',                      -- nº do cupom, pedido ou romaneio
  total numeric(12, 2) not null default 0,
  ordem_id uuid,                                           -- O.S. de destino (sem chave estrangeira: ver cabeçalho)
  os_numero int,
  placa text not null default '',
  fotos text[] not null default '{}',                      -- caminhos na pasta "pre-notas"
  situacao text not null default 'aberta' check (situacao in ('aberta', 'conferida', 'triangulada', 'cancelada')),
  chave_nfe text not null default '',                      -- NF-e que confirmou a compra (Notas da SEFAZ)
  triangulada_em timestamptz,
  obs text not null default '',
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (total >= 0)
);
create index if not exists pre_notas_situacao on public.pre_notas (situacao, data);
create index if not exists pre_notas_os on public.pre_notas (os_numero);
create index if not exists pre_notas_placa on public.pre_notas (placa) where placa <> '';
create index if not exists pre_notas_cnpj on public.pre_notas (fornecedor_cnpj) where fornecedor_cnpj <> '';
create index if not exists pre_notas_chave on public.pre_notas (chave_nfe) where chave_nfe <> '';
create index if not exists pre_notas_atualizado on public.pre_notas (atualizado_em);

create table if not exists public.pre_notas_itens (
  id uuid primary key default gen_random_uuid(),
  pre_nota_id uuid not null references public.pre_notas (id) on delete cascade,
  n int not null default 1,                                -- ordem do item no cupom
  descricao text not null,                                 -- como está no cupom
  codigo text not null default '',                         -- código do fornecedor, se houver
  quantidade numeric(12, 3) not null default 1 check (quantidade > 0),
  unidade text not null default 'UN',
  custo_unit numeric(12, 4) not null default 0 check (custo_unit >= 0),   -- custo provisório (do cupom)
  os_item_id uuid,                                         -- item da O.S. (sem chave estrangeira: ver cabeçalho)
  os_item_descricao text not null default '',              -- para religar se o item for recriado
  produto_id uuid,                                         -- produto do estoque, quando houver (sem chave estrangeira)
  nfe_item int,                                            -- nº do item na NF-e que confirmou (triangulação)
  custo_nf numeric(12, 4),                                 -- custo oficial da NF (com rateio de frete, IPI e ST)
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists pre_notas_itens_nota on public.pre_notas_itens (pre_nota_id, n);
create index if not exists pre_notas_itens_os_item on public.pre_notas_itens (os_item_id) where os_item_id is not null;
create index if not exists pre_notas_itens_atualizado on public.pre_notas_itens (atualizado_em);

-- 2. histórico das ações do agente (para conferir e desfazer). Ninguém apaga.
create table if not exists public.agente_acoes (
  id uuid primary key default gen_random_uuid(),
  em timestamptz not null default now(),
  ferramenta text not null,                                -- ex.: registrar_pre_nota, conferir_boleto
  pedido text not null default '',                         -- o que o Danilo pediu, resumido
  tabela text not null default '',
  registro text not null default '',                       -- id do registro alterado
  antes jsonb,                                             -- null = registro criado
  depois jsonb,                                            -- null = registro removido
  confirmado_por text not null default '',                 -- quem disse "sim"
  desfeita_em timestamptz,
  desfeita_por text not null default '',
  obs text not null default '',
  atualizado_em timestamptz not null default now()
);
create index if not exists agente_acoes_em on public.agente_acoes (em);
create index if not exists agente_acoes_registro on public.agente_acoes (tabela, registro);
create index if not exists agente_acoes_atualizado on public.agente_acoes (atualizado_em);

-- 3. regras e correspondências aprendidas com as correções do Danilo
create table if not exists public.agente_regras (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('descricao_produto', 'preco', 'prazo', 'beneficiario', 'unidade', 'outro')),
  fornecedor_id uuid references public.fornecedores (id) on delete cascade,  -- null = vale para todos
  chave text not null,                                     -- ex.: descrição no cupom, CNPJ do beneficiário
  valor jsonb not null default '{}'::jsonb,                -- ex.: {"produto_codigo": 640, "fator": 2}
  origem text not null default '',                         -- de onde veio (correção do Danilo em tal pré-nota)
  ativo boolean not null default true,
  usos int not null default 0,
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists agente_regras_unica on public.agente_regras (tipo, coalesce(fornecedor_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(chave));
create index if not exists agente_regras_atualizado on public.agente_regras (atualizado_em);

-- data de alteração e aviso de exclusão ao banco do PC (supabase/v13.sql), como nas outras tabelas
do $$
declare t text;
begin
  foreach t in array array['pre_notas', 'pre_notas_itens', 'agente_acoes', 'agente_regras'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_toca', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.toca_atualizado()', t || '_toca', t);
    execute format('drop trigger if exists %I on public.%I', t || '_exclusao', t);
    execute format('create trigger %I after delete on public.%I for each row execute function public.registra_exclusao()', t || '_exclusao', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_gravar', t);
    -- custo e histórico do agente: só o administrador
    execute format('create policy %I on public.%I for select to authenticated using (public.e_admin())', t || '_ler', t);
    if t = 'agente_acoes' then
      -- o histórico não se apaga: o administrador inclui e marca "desfeita"
      execute format('drop policy if exists %I on public.%I', t || '_incluir', t);
      execute format('drop policy if exists %I on public.%I', t || '_marcar', t);
      execute format('create policy %I on public.%I for insert to authenticated with check (public.e_admin())', t || '_incluir', t);
      execute format('create policy %I on public.%I for update to authenticated using (public.e_admin()) with check (public.e_admin())', t || '_marcar', t);
    else
      execute format('create policy %I on public.%I for all to authenticated using (public.e_admin()) with check (public.e_admin())', t || '_gravar', t);
    end if;
  end loop;
end $$;
revoke delete on public.agente_acoes from authenticated;
-- o histórico só pode ser marcado como desfeito: os demais campos não mudam depois de gravados
revoke update on public.agente_acoes from authenticated;
grant update (desfeita_em, desfeita_por) on public.agente_acoes to authenticated;

-- 4. papel só de leitura do agente (sem login até a Fase 1). Toda transação dele é só leitura
--    (default_transaction_read_only). Antes de ligar o login na Fase 1, conferir também as funções
--    que ele pode chamar (as funções do sistema já exigem administrador ou membro da equipe).
--    Dados pessoais: nas tabelas que têm (clientes, O.S., recibos, vendas, veículos, funcionários) o
--    papel só lê a LISTA DE CAMPOS PERMITIDOS abaixo; coluna nova nessas tabelas fica fora até ser
--    incluída aqui. Ficam de fora por inteiro: segredos, certificado, perfis, ajustes (config, que
--    guarda de tudo), lançamentos dos funcionários e o registro de exclusões.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    create role agente_leitura nologin noinherit;
  end if;
end $$;
alter role agente_leitura set default_transaction_read_only = on;
alter role agente_leitura set statement_timeout = '15s';
grant usage on schema public to agente_leitura;
do $$
declare t text; cols text;
  -- tabela → campos permitidos (sem telefone, documento, e-mail, endereço, assinatura, cópia dos dados do cliente na O.S. etc.)
  permitidos jsonb := jsonb_build_object(
    'clientes', jsonb_build_array('id', 'codigo', 'nome', 'fantasia', 'tipo_cliente', 'situacao', 'restricao', 'cidade', 'uf', 'origem', 'criado_em', 'atualizado_em'),
    'ordens', jsonb_build_array('id', 'numero', 'status', 'situacao', 'cliente_id', 'veiculo_id', 'veiculo', 'km_entrada', 'km_saida', 'combustivel', 'funcionando',
      'reclamacao', 'diagnostico', 'consultor_id', 'consultor_nome', 'mecanico_id', 'mecanico_nome', 'previsao_entrega', 'previsao_hora', 'condicoes_pagamento',
      'orcamento_enviado_em', 'validade_orcamento', 'desconto', 'total', 'custo', 'recebido', 'forma_pagamento', 'garantia_dias', 'entregue_em', 'finalizada_em',
      'obs_execucao', 'obs_internas', 'box', 'tabela_preco', 'estoque_baixado', 'motivo_cancelamento', 'criado_por', 'criado_em', 'atualizado_em'),
    'recibos', jsonb_build_array('id', 'numero', 'ordem_id', 'cliente_id', 'pagador', 'valor', 'referente', 'forma', 'data', 'obs', 'emitido_por', 'cancelado',
      'cancelado_motivo', 'criado_em', 'venda_id', 'atualizado_em', 'conta_destino'),
    'vendas', jsonb_build_array('id', 'numero', 'cliente_id', 'tabela_preco', 'subtotal', 'desconto', 'total', 'custo', 'forma_pagamento', 'obs', 'status',
      'vendedor_nome', 'criado_por', 'criado_em', 'cancelada_em', 'cancelada_motivo', 'atualizado_em'),
    'veiculos', jsonb_build_array('id', 'placa', 'marca', 'modelo', 'ano', 'ano_fab', 'ano_mod', 'cor', 'motor', 'chassi', 'combustivel', 'cliente_id', 'km_atual',
      'obs', 'revisao_data', 'revisao_km', 'oleo_data', 'oleo_km', 'filtro_data', 'filtro_km', 'criado_em', 'atualizado_em'),
    'funcionarios', jsonb_build_array('id', 'nome', 'apelido', 'funcao', 'vinculo', 'admissao', 'demissao', 'ativo', 'perfil_id', 'comissao_pct', 'jornada',
      'criado_em', 'atualizado_em'));
  fora text[] := array['segredos', 'sefaz_config', 'perfis', 'config', 'funcionario_lanc', 'exclusoes'];
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
           where s.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('revoke all on public.%I from agente_leitura', t);   -- também tira os campos liberados antes
    execute format('drop policy if exists %I on public.%I', t || '_agente_ler', t);
    if t = any(fora) then continue; end if;
    if permitidos ? t then
      -- só os campos da lista que existem na tabela
      select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols from pg_attribute a
        where a.attrelid = ('public.' || t)::regclass and a.attnum > 0 and not a.attisdropped
          and a.attname in (select jsonb_array_elements_text(permitidos -> t));
      if cols is null then continue; end if;
      execute format('grant select (%s) on public.%I to agente_leitura', cols, t);
    else
      execute format('grant select on public.%I to agente_leitura', t);
    end if;
    -- as tabelas têm RLS: sem esta política o papel não veria nenhuma linha
    if exists (select 1 from pg_class where oid = ('public.' || t)::regclass and relrowsecurity) then
      execute format('create policy %I on public.%I for select to agente_leitura using (true)', t || '_agente_ler', t);
    end if;
  end loop;
end $$;
-- nunca: segredos, certificado e perfis de acesso (reforço)
revoke all on public.segredos, public.sefaz_config, public.perfis from agente_leitura;

-- 5. fotos das pré-notas (pasta privada, só o administrador)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pre-notas', 'pre-notas', false, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do nothing;
drop policy if exists pre_notas_storage_ler on storage.objects;
create policy pre_notas_storage_ler on storage.objects for select to authenticated using (bucket_id = 'pre-notas' and public.e_admin());
drop policy if exists pre_notas_storage_incluir on storage.objects;
create policy pre_notas_storage_incluir on storage.objects for insert to authenticated with check (bucket_id = 'pre-notas' and public.e_admin());
drop policy if exists pre_notas_storage_excluir on storage.objects;
create policy pre_notas_storage_excluir on storage.objects for delete to authenticated using (bucket_id = 'pre-notas' and public.e_admin());

-- 6. backup: a restauração passa a aceitar as tabelas do agente (resto igual ao v18)
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text; ausentes uuid[] := '{}';
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias', 'estornos_saldo',
                      'pre_notas', 'pre_notas_itens', 'agente_acoes', 'agente_regras') then
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
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;
