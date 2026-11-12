-- v54 (12/11/2026, pedido do Danilo): AGENDA DA OFICINA — etapa 1 (banco e tela).
-- Serviços agendados: dia, horário (opcional), cliente e veículo (cadastro OU só digitados), o serviço combinado e observação.
-- Agenda livre: sem limite de carros por dia ou por horário (decisão do Danilo em 12/11/2026: "controlado por mim").
-- Nenhuma mensagem sai sozinha: os botões de WhatsApp (etapa 3) só abrem a mensagem pronta e quem envia é o Danilo.
-- A coluna "mensagens" já fica aqui para a etapa 3 guardar quando cada mensagem foi enviada ({ confirmacao, lembrete, remarcar }).
--
--   agendamentos    um serviço agendado
-- Situações gravadas: agendado, confirmado, chegou (virou O.S.), faltou, cancelado (com motivo).
-- "Remarcado" não é situação: trocar o dia ou o horário conta uma remarcação (remarcacoes + data/hora anterior) e
-- volta "confirmado" para "agendado" (o cliente confirmou o horário antigo). Quem calcula é o gatilho, não a tela.
-- No dia, o agendamento vira O.S. (ordem_id/os_numero; situação "chegou") ou orçamento (orcamento_id/orc_numero).
-- A agenda não mexe em O.S., estoque nem financeiro: só guarda o vínculo.
-- Sem chave estrangeira para clientes, veículos, ordens e orçamentos (como orcamentos, v52): a cópia do nome, do telefone
-- e da placa fica no próprio agendamento.
-- Período de transição (espelho do OS Oficina): a tabela é PRESERVADA, não entra em espelho_legado_zerar():
-- agendamento não existe no sistema antigo (uma carga nunca o traria de volta) e, sem chave estrangeira, a carga que
-- recria clientes e veículos não quebra o agendamento.
-- Backup, banco do PC (atualizado_em + exclusoes) e restauração incluídos. Idempotente.

create table if not exists public.agendamentos (
  id uuid primary key default gen_random_uuid(),
  data date not null,
  hora time,                                     -- vazio = sem horário marcado (só o dia)
  situacao text not null default 'agendado' check (situacao in ('agendado', 'confirmado', 'chegou', 'faltou', 'cancelado')),
  cliente_id uuid,
  veiculo_id uuid,
  cliente jsonb not null default '{}'::jsonb,    -- { nome, telefone } — cópia do cadastro ou o que foi digitado
  veiculo jsonb not null default '{}'::jsonb,    -- { placa, marca, modelo, ano }
  servico text not null,                         -- o que foi combinado (sai na mensagem da etapa 3)
  obs text not null default '',                  -- anotação interna
  motivo text not null default '',               -- por que foi cancelado
  remarcacoes int not null default 0,
  data_anterior date,
  hora_anterior time,
  ordem_id uuid,                                 -- O.S. aberta quando o carro chegou
  os_numero int,
  orcamento_id uuid,                             -- orçamento feito a partir do agendamento
  orc_numero int,
  mensagens jsonb not null default '{}'::jsonb,  -- etapa 3: quando cada mensagem foi enviada
  criado_por uuid default auth.uid(),
  criado_por_nome text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint agendamentos_servico check (btrim(servico) <> ''),
  constraint agendamentos_cliente check (btrim(coalesce(cliente->>'nome', '')) <> ''),
  constraint agendamentos_motivo check (situacao <> 'cancelado' or btrim(motivo) <> '')
);
create index if not exists agendamentos_data on public.agendamentos (data, hora);
create index if not exists agendamentos_atualizado on public.agendamentos (atualizado_em);
create index if not exists agendamentos_cliente on public.agendamentos (cliente_id);
create index if not exists agendamentos_veiculo on public.agendamentos (veiculo_id);

-- Regras gravadas pelo banco (a tela não decide): remarcação, quem criou, motivo só no cancelado.
create or replace function public.agendamentos_regras() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.remarcacoes := coalesce(new.remarcacoes, 0);
    if coalesce(new.criado_por_nome, '') = '' then
      new.criado_por_nome := coalesce((select nome from public.perfis where id = auth.uid()), '');
    end if;
  else
    new.criado_por := old.criado_por; new.criado_por_nome := old.criado_por_nome; new.criado_em := old.criado_em;
    if (new.data, new.hora) is distinct from (old.data, old.hora) then
      new.remarcacoes := old.remarcacoes + 1;
      new.data_anterior := old.data; new.hora_anterior := old.hora;
      -- a confirmação e o lembrete eram do horário antigo
      new.mensagens := coalesce(new.mensagens, '{}'::jsonb) - 'confirmacao' - 'lembrete';
      if new.situacao = 'confirmado' and old.situacao = 'confirmado' then new.situacao := 'agendado'; end if;
    else
      new.remarcacoes := old.remarcacoes; new.data_anterior := old.data_anterior; new.hora_anterior := old.hora_anterior;
    end if;
  end if;
  if new.situacao <> 'cancelado' then new.motivo := ''; else new.motivo := btrim(new.motivo); end if;
  new.servico := btrim(new.servico);
  return new;
end $$;
drop trigger if exists agendamentos_regras on public.agendamentos;
create trigger agendamentos_regras before insert or update on public.agendamentos for each row execute function public.agendamentos_regras();

-- data de alteração, aviso de exclusão ao banco do PC (v13) e regras de acesso
drop trigger if exists agendamentos_toca on public.agendamentos;
create trigger agendamentos_toca before update on public.agendamentos for each row execute function public.toca_atualizado();
drop trigger if exists agendamentos_exclusao on public.agendamentos;
create trigger agendamentos_exclusao after delete on public.agendamentos for each row execute function public.registra_exclusao();
grant select, insert, update, delete on public.agendamentos to authenticated;
alter table public.agendamentos enable row level security;
-- a equipe toda lê (o mecânico vê o que vai chegar); administrador e consultor gravam; só o administrador apaga
drop policy if exists agendamentos_ler on public.agendamentos;
create policy agendamentos_ler on public.agendamentos for select to authenticated using (public.e_membro());
drop policy if exists agendamentos_incluir on public.agendamentos;
create policy agendamentos_incluir on public.agendamentos for insert to authenticated with check (public.e_gestor());
drop policy if exists agendamentos_alterar on public.agendamentos;
create policy agendamentos_alterar on public.agendamentos for update to authenticated using (public.e_gestor()) with check (public.e_gestor());
drop policy if exists agendamentos_excluir on public.agendamentos;
create policy agendamentos_excluir on public.agendamentos for delete to authenticated using (public.e_admin());

-- papel só de leitura do agente (v19): lê a agenda sem a cópia do cliente (telefone), como nas O.S. e nos orçamentos
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    revoke all on public.agendamentos from agente_leitura;
    grant select (id, data, hora, situacao, cliente_id, veiculo_id, veiculo, servico, obs, motivo, remarcacoes, data_anterior, hora_anterior,
                  ordem_id, os_numero, orcamento_id, orc_numero, mensagens, criado_por_nome, criado_em, atualizado_em) on public.agendamentos to agente_leitura;
    drop policy if exists agendamentos_agente_ler on public.agendamentos;
    create policy agendamentos_agente_ler on public.agendamentos for select to agente_leitura using (true);
  end if;
end $$;

-- backup: a restauração passa a aceitar a agenda (resto igual ao v52)
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text; ausentes uuid[] := '{}';
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias', 'estornos_saldo',
                      'pre_notas', 'pre_notas_itens', 'agente_acoes', 'agente_regras', 'boletos', 'boletos_arquivos',
                      'orcamentos', 'orcamento_itens', 'agendamentos') then
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
