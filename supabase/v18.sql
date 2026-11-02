-- =====================================================================
-- DTCar Gestão — v18: saldo por conta (Sicredi, PicPay, Espécie…),
-- de qual conta saiu cada pagamento, em qual conta entrou cada recibo
-- e transferências entre contas.
--
-- As contas (bancos e caixa) e o saldo informado de cada uma ficam em
-- Ajustes do sistema (config, "contasFinanceiras"). O saldo atual de cada
-- conta = saldo informado + recibos que entraram nela − contas pagas por ela
-- ± transferências, tudo registrado depois do saldo informado.
--
-- Rode depois do v17. Pode rodar mais de uma vez. O site funciona antes do
-- SQL (sem gravar a conta de origem/destino e sem transferências).
-- Período de transição: o espelho do sistema antigo já foi desligado (virada
-- de 02/11/2026). As transferências são PRESERVADAS por uma carga do espelho
-- (dinheiro real da empresa, como as contas a pagar); a coluna conta_destino
-- dos recibos some junto com os recibos se o espelho for religado.
-- =====================================================================

-- 1. de qual conta saiu o pagamento / em qual conta entrou o recibo
alter table public.contas add column if not exists conta_origem text not null default '';
alter table public.recibos add column if not exists conta_destino text not null default '';
-- instante em que a baixa foi registrada (não muda quando a conta paga é editada depois); usado no saldo por conta
alter table public.contas add column if not exists pago_registrado_em timestamptz;
create or replace function public.contas_registra_baixa() returns trigger language plpgsql as $$
begin
  if new.status = 'paga' and (tg_op = 'INSERT' or old.status is distinct from 'paga') then new.pago_registrado_em := coalesce(new.pago_registrado_em, now());
  elsif new.status <> 'paga' then new.pago_registrado_em := null;
  end if;
  return new;
end $$;
drop trigger if exists contas_registra_baixa on public.contas;
create trigger contas_registra_baixa before insert or update of status on public.contas for each row execute function public.contas_registra_baixa();

-- 2. transferências entre contas da empresa
create table if not exists public.transferencias (
  id uuid primary key default gen_random_uuid(),
  data date not null default current_date,
  de_conta text not null,
  para_conta text not null,
  valor numeric(12, 2) not null check (valor > 0),
  obs text not null default '',
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (de_conta <> para_conta)
);
create index if not exists transferencias_data on public.transferencias (data);
create index if not exists transferencias_atualizado on public.transferencias (atualizado_em);
drop trigger if exists transferencias_toca on public.transferencias;
create trigger transferencias_toca before update on public.transferencias for each row execute function public.toca_atualizado();
-- exclusão avisada ao banco do PC (supabase/v13.sql)
drop trigger if exists transferencias_exclusao on public.transferencias;
create trigger transferencias_exclusao after delete on public.transferencias for each row execute function public.registra_exclusao();

grant select, insert, update, delete on public.transferencias to authenticated;
alter table public.transferencias enable row level security;
drop policy if exists transferencias_ler on public.transferencias;
drop policy if exists transferencias_gravar on public.transferencias;
-- financeiro é só do administrador
create policy transferencias_ler on public.transferencias for select to authenticated using (public.e_admin());
create policy transferencias_gravar on public.transferencias for all to authenticated using (public.e_admin()) with check (public.e_admin());

-- 2b. estornos: quando um lançamento que já pode estar no saldo informado é desfeito, o banco registra o estorno
--     (recibo cancelado, pagamento desfeito/cancelado, transferência excluída). O saldo por conta aplica o estorno
--     só se o lançamento original foi registrado antes do saldo informado e o estorno depois (original_em / registrado_em).
create table if not exists public.estornos_saldo (
  id uuid primary key default gen_random_uuid(),
  conta text not null,
  valor numeric(12, 2) not null,           -- efeito no saldo da conta (+ volta para a conta, − sai da conta)
  origem text not null,                    -- recibo, pagamento, transferencia
  registro uuid,
  original_em timestamptz,                 -- quando o lançamento original foi registrado
  registrado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists estornos_saldo_registrado on public.estornos_saldo (registrado_em);
create index if not exists estornos_saldo_atualizado on public.estornos_saldo (atualizado_em);
drop trigger if exists estornos_saldo_exclusao on public.estornos_saldo;
create trigger estornos_saldo_exclusao after delete on public.estornos_saldo for each row execute function public.registra_exclusao();
grant select on public.estornos_saldo to authenticated;
alter table public.estornos_saldo enable row level security;
drop policy if exists estornos_saldo_ler on public.estornos_saldo;
create policy estornos_saldo_ler on public.estornos_saldo for select to authenticated using (public.e_admin());

create or replace function public.recibos_estorno_saldo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.conta_destino <> '' and new.cancelado and not old.cancelado then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em) values (new.conta_destino, -new.valor, 'recibo', new.id, new.criado_em);
    elsif new.conta_destino <> '' and old.cancelado and not new.cancelado then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em) values (new.conta_destino, new.valor, 'recibo', new.id, new.criado_em);
    end if;
    return new;
  end if;
  if old.conta_destino <> '' and not old.cancelado then
    insert into public.estornos_saldo (conta, valor, origem, registro, original_em) values (old.conta_destino, -old.valor, 'recibo', old.id, old.criado_em);
  end if;
  return old;
end $$;
drop trigger if exists recibos_estorno_saldo on public.recibos;
create trigger recibos_estorno_saldo after update of cancelado or delete on public.recibos for each row execute function public.recibos_estorno_saldo();

create or replace function public.contas_estorno_saldo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if old.status = 'paga' and new.status <> 'paga' and old.conta_origem <> '' then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em) values (old.conta_origem, coalesce(old.valor_pago, old.valor), 'pagamento', old.id, old.pago_registrado_em);
    end if;
    return new;
  end if;
  if old.status = 'paga' and old.conta_origem <> '' then
    insert into public.estornos_saldo (conta, valor, origem, registro, original_em) values (old.conta_origem, coalesce(old.valor_pago, old.valor), 'pagamento', old.id, old.pago_registrado_em);
  end if;
  return old;
end $$;
drop trigger if exists contas_estorno_saldo on public.contas;
create trigger contas_estorno_saldo after update of status or delete on public.contas for each row execute function public.contas_estorno_saldo();

create or replace function public.transferencias_estorno_saldo() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
  values (old.de_conta, old.valor, 'transferencia', old.id, old.criado_em), (old.para_conta, -old.valor, 'transferencia', old.id, old.criado_em);
  return old;
end $$;
drop trigger if exists transferencias_estorno_saldo on public.transferencias;
create trigger transferencias_estorno_saldo after delete on public.transferencias for each row execute function public.transferencias_estorno_saldo();

-- 2c. saldo de cada conta calculado no banco, numa única consulta (estado consistente), e gravação da nova
--     referência na mesma transação. Regras: conta o que foi registrado depois do saldo informado (em), com data
--     a partir do dia da referência; estornos de lançamentos que já estavam no saldo informado.
create or replace function public.saldos_contas() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cfg jsonb; r jsonb := '[]'::jsonb; c jsonb; v_nome text; v_em timestamptz; v_dia date; v_saldo numeric;
  v_ent numeric; v_sai numeric; v_te numeric; v_ts numeric; v_est numeric;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador vê o saldo das contas.'; end if;
  select dados into cfg from public.config where id = 1;
  for c in select * from jsonb_array_elements(coalesce(cfg->'contasFinanceiras', '[]'::jsonb)) loop
    v_nome := c->>'nome'; v_em := nullif(c->>'em', '')::timestamptz; v_saldo := coalesce(nullif(c->>'saldo', '')::numeric, 0);
    v_dia := (v_em at time zone 'America/Sao_Paulo')::date;
    select coalesce(sum(valor), 0) into v_ent from public.recibos
      where not cancelado and conta_destino = v_nome and (v_em is null or (criado_em > v_em and data >= v_dia));
    select coalesce(sum(coalesce(valor_pago, valor)), 0) into v_sai from public.contas
      where status = 'paga' and conta_origem = v_nome
        and (v_em is null or (pago_registrado_em is not null and pago_registrado_em > v_em and pago_em >= v_dia) or (pago_registrado_em is null and pago_em > v_dia));
    select coalesce(sum(valor) filter (where para_conta = v_nome), 0), coalesce(sum(valor) filter (where de_conta = v_nome), 0) into v_te, v_ts
      from public.transferencias where (de_conta = v_nome or para_conta = v_nome) and (v_em is null or (criado_em > v_em and data >= v_dia));
    select coalesce(sum(valor), 0) into v_est from public.estornos_saldo
      where conta = v_nome and v_em is not null and original_em is not null and original_em <= v_em and registrado_em > v_em;
    r := r || jsonb_build_array(jsonb_build_object('nome', v_nome, 'saldo', v_saldo, 'em', c->'em', 'por', c->'por',
      'ent', v_ent + greatest(v_est, 0), 'sai', v_sai - least(v_est, 0), 'tEnt', v_te, 'tSai', v_ts, 'est', v_est,
      'atual', v_saldo + v_ent - v_sai + v_te - v_ts + v_est));
  end loop;
  return r;
end $$;
grant execute on function public.saldos_contas() to authenticated;

-- p_contas: [{nome, antigo, saldo}] — saldo nulo = manter o saldo calculado agora (mesma transação); com valor = extrato de agora
create or replace function public.guardar_saldos_contas(p_contas jsonb, p_pagar text, p_receber text, p_por text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare atuais jsonb; novas jsonb := '[]'::jsonb; c jsonb; v_saldo numeric; v_total numeric := 0;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador atualiza o saldo das contas.'; end if;
  perform 1 from public.config where id = 1 for update; -- uma atualização de saldos por vez
  atuais := public.saldos_contas();
  for c in select * from jsonb_array_elements(p_contas) loop
    if coalesce(trim(c->>'nome'), '') = '' then raise exception 'Dê um nome para cada conta.'; end if;
    if c->'saldo' is null or jsonb_typeof(c->'saldo') = 'null' then
      select coalesce((x->>'atual')::numeric, 0) into v_saldo from jsonb_array_elements(atuais) x where x->>'nome' = coalesce(c->>'antigo', c->>'nome');
      v_saldo := coalesce(v_saldo, 0);
    else v_saldo := (c->>'saldo')::numeric; end if;
    v_total := v_total + v_saldo;
    novas := novas || jsonb_build_array(jsonb_build_object('nome', trim(c->>'nome'), 'saldo', round(v_saldo, 2), 'em', now(), 'por', coalesce(p_por, '')));
  end loop;
  update public.config set dados = dados || jsonb_build_object('contasFinanceiras', novas, 'contaPagamento', coalesce(p_pagar, ''), 'contaRecebimento', coalesce(p_receber, ''),
    'caixaSaldo', jsonb_build_object('valor', round(v_total, 2), 'em', now(), 'por', coalesce(p_por, ''))), atualizado_em = now() where id = 1;
  return novas;
end $$;
grant execute on function public.guardar_saldos_contas(jsonb, text, text, text) to authenticated;

-- 3. backup: a restauração passa a aceitar as transferências
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text; ausentes uuid[] := '{}';
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias', 'estornos_saldo') then
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
  if array_length(ausentes, 1) > 0 then
    execute format('insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
      select e.conta, -sum(e.valor), ''restauracao'', e.registro, min(e.original_em) from public.estornos_saldo e
      where e.registro = any($1) and exists (select 1 from public.%I t where t.id = e.registro)
      group by e.conta, e.registro having sum(e.valor) <> 0', p_tabela) using ausentes;
  end if;
  return jsonb_build_object('incluidos', depois - antes, 'erros', erros);
end $$;
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;
