-- v60 (16/11/2026, pedido do Danilo à noite): SERVIÇO PELO MECÂNICO NO APP e MECÂNICO NO AGENDAMENTO.
-- 1) agendamentos.mecanico_id / mecanico_nome: quem vai mexer no carro. No app, o administrador vê todos os agendamentos e o
--    colaborador só os dele.
-- 2) servico_apontamentos: o mecânico "inicia o serviço" pela placa (O.S. aberta), pausa com motivo, finaliza marcando os itens
--    que executou e indica a outro responsável as etapas que não são dele (quem foi indicado recebe o aviso no app e o sistema vê
--    no sino). Um apontamento em andamento por pessoa (regra conferida no app e pela função apontamento_abrir abaixo).
--    O histórico do colaborador (por quinzena no app; Relatórios › Serviços por colaborador no sistema) sai daqui.
-- Não mexe em O.S., estoque nem financeiro. Backup, banco do PC (atualizado_em + exclusoes) e restauração incluídos. Idempotente.

alter table public.agendamentos add column if not exists mecanico_id uuid references public.perfis (id) on delete set null;
alter table public.agendamentos add column if not exists mecanico_nome text not null default '';
create index if not exists agendamentos_mecanico on public.agendamentos (mecanico_id);

create table if not exists public.servico_apontamentos (
  id uuid primary key default gen_random_uuid(),
  ordem_id uuid not null references public.ordens (id) on delete cascade,
  os_numero int,
  perfil_id uuid not null references public.perfis (id) on delete cascade,
  perfil_nome text not null default '',
  situacao text not null default 'andamento' check (situacao in ('andamento', 'pausado', 'finalizado')),
  inicio timestamptz not null default now(),
  fim timestamptz,
  motivo_pausa text not null default '',
  pausas jsonb not null default '[]'::jsonb,         -- [{ em, motivo, retomado_em }]
  itens_executados uuid[] not null default '{}',    -- os_itens que este mecânico executou
  indicacoes jsonb not null default '[]'::jsonb,     -- [{ item_id, descricao, para_id, para_nome, em, visto_em }]
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists servico_apontamentos_ordem on public.servico_apontamentos (ordem_id);
create index if not exists servico_apontamentos_perfil on public.servico_apontamentos (perfil_id, inicio desc);
create index if not exists servico_apontamentos_situacao on public.servico_apontamentos (situacao);
create index if not exists servico_apontamentos_atualizado on public.servico_apontamentos (atualizado_em);
-- um serviço em andamento ou pausado por pessoa e por O.S. (o mesmo mecânico não abre a mesma O.S. duas vezes)
create unique index if not exists servico_apontamentos_aberto on public.servico_apontamentos (perfil_id, ordem_id) where situacao <> 'finalizado';

drop trigger if exists servico_apontamentos_toca on public.servico_apontamentos;
create trigger servico_apontamentos_toca before update on public.servico_apontamentos for each row execute function public.toca_atualizado();
drop trigger if exists servico_apontamentos_exclusao on public.servico_apontamentos;
create trigger servico_apontamentos_exclusao after delete on public.servico_apontamentos for each row execute function public.registra_exclusao();
alter table public.servico_apontamentos enable row level security;
revoke all on public.servico_apontamentos from anon;
grant select, insert, update, delete on public.servico_apontamentos to authenticated;
-- a equipe toda lê; cada um grava o próprio apontamento (o administrador e o consultor mexem em qualquer um); só o administrador apaga
drop policy if exists servico_apontamentos_ler on public.servico_apontamentos;
create policy servico_apontamentos_ler on public.servico_apontamentos for select to authenticated using (public.e_membro());
drop policy if exists servico_apontamentos_incluir on public.servico_apontamentos;
create policy servico_apontamentos_incluir on public.servico_apontamentos for insert to authenticated with check (public.e_membro() and (perfil_id = auth.uid() or public.e_gestor()));
drop policy if exists servico_apontamentos_alterar on public.servico_apontamentos;
create policy servico_apontamentos_alterar on public.servico_apontamentos for update to authenticated using (public.e_membro() and (perfil_id = auth.uid() or public.e_gestor())) with check (public.e_membro() and (perfil_id = auth.uid() or public.e_gestor()));
drop policy if exists servico_apontamentos_excluir on public.servico_apontamentos;
create policy servico_apontamentos_excluir on public.servico_apontamentos for delete to authenticated using (public.e_admin());

-- quem foi indicado como responsável marca o aviso como visto (só mexe em indicacoes[].visto_em da própria indicação)
create or replace function public.apontamento_visto(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.e_membro() then raise exception 'Sem acesso.'; end if;
  update public.servico_apontamentos
     set indicacoes = (select coalesce(jsonb_agg(case when (i->>'para_id')::uuid = auth.uid() and i->>'visto_em' is null then i || jsonb_build_object('visto_em', now()) else i end), '[]'::jsonb)
                         from jsonb_array_elements(indicacoes) i)
   where id = p_id;
end $$;
revoke all on function public.apontamento_visto(uuid) from public, anon;
grant execute on function public.apontamento_visto(uuid) to authenticated;

-- papel só de leitura do agente (v19): lê os apontamentos e o mecânico do agendamento
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    grant select on public.servico_apontamentos to agente_leitura;
    drop policy if exists servico_apontamentos_agente_ler on public.servico_apontamentos;
    create policy servico_apontamentos_agente_ler on public.servico_apontamentos for select to agente_leitura using (true);
    grant select (mecanico_id, mecanico_nome) on public.agendamentos to agente_leitura;
  end if;
end $$;

-- backup: a restauração passa a aceitar servico_apontamentos (resto igual ao v59)
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text; ausentes uuid[] := '{}';
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias', 'estornos_saldo',
                      'pre_notas', 'pre_notas_itens', 'agente_acoes', 'agente_regras', 'boletos', 'boletos_arquivos',
                      'orcamentos', 'orcamento_itens', 'agendamentos',
                      'compras_fornecedores', 'compras_precos', 'compras_carrinho', 'compras_pedidos', 'compras_pedido_itens', 'servico_apontamentos') then
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
