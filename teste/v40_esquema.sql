-- Esquema mínimo para testar supabase/v40.sql num Postgres local (teste/teste_v40.sh).
-- Parte do esquema do v37 (que já traz o do v21 e o do v15) e acrescenta o que o v40 usa.
\set ON_ERROR_STOP 1
\ir v37_esquema.sql
\ir ../supabase/v27.sql
\ir ../supabase/v37.sql
alter table public.ordens add column veiculo_id uuid, add column km_entrada int, add column km_saida int, add column entregue_em timestamptz,
  add column forma_pagamento text not null default '', add column garantia_dias int not null default 90, add column situacao text not null default '',
  add column motivo_cancelamento text not null default '', add column validade_orcamento date, add column box text not null default '',
  add column mecanico_nome text not null default '', add column consultor_nome text not null default '', add column diagnostico text not null default '',
  add column criado_por uuid, add column estoque_baixado boolean not null default false, add column assinatura_entrada text not null default '',
  add column assinatura_entrega text not null default '';
alter table public.os_itens add column fornecedor text not null default '';
alter table public.clientes add column codigo int, add column telefone text not null default '', add column endereco text not null default '',
  add column rua text not null default '', add column complemento text not null default '', add column bairro text not null default '',
  add column cidade text not null default '', add column uf text not null default '', add column ficha jsonb not null default '{}',
  add column criado_em timestamptz not null default now(), add column atualizado_em timestamptz not null default now();
create table public.veiculos (id uuid primary key default gen_random_uuid(), placa text not null unique, marca text not null default '', modelo text not null default '',
  ano text not null default '', cor text not null default '', cliente_id uuid references public.clientes (id) on delete restrict, km_atual int,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
alter table public.ordens add constraint ordens_cli foreign key (cliente_id) references public.clientes (id) on delete restrict;
alter table public.produtos add column preco_vista numeric(12,2) not null default 0, add column preco_prazo numeric(12,2) not null default 0,
  add column margem_vista numeric(9,2) not null default 0, add column margem_prazo numeric(9,2) not null default 0, add column margem_atacado numeric(9,2) not null default 0,
  add column preco_atacado numeric(12,2) not null default 0, add column referencia text not null default '', add column marca text not null default '',
  add column unidade text not null default 'UN', add column criado_em timestamptz not null default now(), add column atualizado_em timestamptz not null default now();
create sequence public.produtos_codigo_seq start 1000;
alter table public.produtos alter column codigo set default nextval('public.produtos_codigo_seq');
alter table public.estoque_mov add column custo_unit numeric(12,2);
create table public.fotos (id uuid primary key default gen_random_uuid(), ordem_id uuid not null references public.ordens (id) on delete cascade, caminho text not null);
create table public.fornecedores (id uuid primary key default gen_random_uuid(), cnpj text not null default '', razao text not null, fantasia text not null default '');
create table public.contas (id uuid primary key default gen_random_uuid(), descricao text not null, fornecedor_id uuid references public.fornecedores (id) on delete set null,
  favorecido text not null default '', categoria text not null default '', documento text not null default '', valor numeric(12,2) not null check (valor >= 0),
  emissao date, vencimento date not null, linha_digitavel text not null default '', codigo_barras text not null default '', parcela int, parcelas int,
  status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')), pago_em date, valor_pago numeric(12,2), juros numeric(12,2) not null default 0,
  desconto numeric(12,2) not null default 0, forma_pagamento text not null default '', origem text not null default 'manual', obs text not null default '',
  criado_por text not null default '', conta_origem text not null default '', pago_registrado_em timestamptz,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now());
create unique index contas_codigo_barras_unico on public.contas (codigo_barras) where codigo_barras <> '' and status <> 'cancelada';
create table public.transferencias (id uuid primary key default gen_random_uuid(), data date not null default current_date, de_conta text not null, para_conta text not null,
  valor numeric(12,2) not null check (valor > 0), obs text not null default '', criado_por text not null default '', criado_em timestamptz not null default now(), check (de_conta <> para_conta));
create table public.boletos (id uuid primary key default gen_random_uuid(), receber_id uuid, ordem_id uuid, os_numero text not null default '', cliente_id uuid,
  pagador_nome text not null default '', pagador_doc text not null default '', pagador jsonb not null default '{}', descricao text not null default '',
  valor numeric(12,2) not null check (valor > 0), vencimento date not null, emissao date not null default current_date,
  nosso_numero text not null unique check (nosso_numero ~ '^[0-9]{9}$'), seu_numero text not null default '', codigo_barras text not null default '',
  linha_digitavel text not null default '', situacao text not null default 'gerado', ocorrencia text not null default '', qr_url text not null default '',
  txid text not null default '', recibo_id uuid, criado_por text not null default '', criado_em timestamptz not null default now());
-- saldo por conta (versão simples do v18: saldo informado + recibos − pagamentos ± transferências)
create or replace function public.saldos_contas() returns jsonb language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object('nome', c->>'nome', 'informado', (c->>'saldo')::numeric,
    'atual', (c->>'saldo')::numeric
      + coalesce((select sum(valor) from public.recibos r where r.conta_destino = c->>'nome' and not r.cancelado), 0)
      - coalesce((select sum(valor_pago) from public.contas x where x.conta_origem = c->>'nome' and x.status = 'paga'), 0)
      + coalesce((select sum(valor) from public.transferencias t where t.para_conta = c->>'nome'), 0)
      - coalesce((select sum(valor) from public.transferencias t where t.de_conta = c->>'nome'), 0))), '[]')
  from public.config, jsonb_array_elements(coalesce(dados->'contasFinanceiras', '[]')) c where id = 1 $$;
create or replace function public.guardar_saldos_contas(p_contas jsonb, p_pagar text, p_receber text, p_por text) returns jsonb language plpgsql as $$
declare atuais jsonb := public.saldos_contas(); novas jsonb := '[]'; c jsonb; v numeric;
begin
  for c in select * from jsonb_array_elements(p_contas) loop
    if c->'saldo' is null or jsonb_typeof(c->'saldo') = 'null' then
      select (x->>'atual')::numeric into v from jsonb_array_elements(atuais) x where x->>'nome' = coalesce(c->>'antigo', c->>'nome');
    else v := (c->>'saldo')::numeric; end if;
    novas := novas || jsonb_build_array(jsonb_build_object('nome', c->>'nome', 'saldo', coalesce(v, 0)));
  end loop;
  update public.config set dados = dados || jsonb_build_object('contasFinanceiras', novas, 'contaPagamento', p_pagar, 'contaRecebimento', p_receber) where id = 1;
  return novas;
end $$;
create or replace function public.e_gestor() returns boolean language sql as $$ select true $$;
-- movimentar_estoque do v3 (sem a checagem de perfil)
create or replace function public.movimentar_estoque(p_produto uuid, p_tipo text, p_qtd numeric, p_custo numeric default null, p_obs text default '')
returns numeric language plpgsql as $$
declare p public.produtos; delta numeric; novo numeric;
begin
  select * into p from public.produtos where id = p_produto for update;
  delta := case p_tipo when 'entrada' then abs(p_qtd) when 'saida' then -abs(p_qtd) else p_qtd - p.estoque_atual end;
  novo := p.estoque_atual + delta;
  update public.produtos set estoque_atual = novo, custo = case when p_tipo = 'entrada' and coalesce(p_custo, 0) > 0 then p_custo else custo end where id = p_produto;
  insert into public.estoque_mov (produto_id, tipo, qtd, saldo, custo_unit, obs) values (p_produto, p_tipo, delta, novo, nullif(p_custo, 0), coalesce(p_obs, ''));
  return novo;
end $$;
update public.config set dados = '{"contasFinanceiras": [{"nome": "Sicredi", "saldo": 1000}, {"nome": "PicPay PJ", "saldo": 5000}, {"nome": "Espécie", "saldo": 200}],
  "contaPagamento": "Sicredi", "contaRecebimento": "Sicredi", "formasPagamento": ["PIX", "Dinheiro", "Boleto"], "validadeDias": 10, "garantiaDias": 90}' where id = 1;
-- v4: cancelar/descancelar a O.S. devolve/reserva o estoque
create or replace function public.estoque_ordem_gatilho() returns trigger language plpgsql security definer set search_path = public as $$
declare r record;
begin
  if (old.status = 'cancelado') <> (new.status = 'cancelado') then
    for r in select id from public.os_itens where ordem_id = new.id loop perform public.estoque_sincroniza_item(r.id, new.id); end loop;
  end if;
  return null;
end $$;
create trigger ordens_estoque_status after update of status on public.ordens for each row execute function public.estoque_ordem_gatilho();
-- v12: recibo cancelado reabre a parcela que ele pagou
create or replace function public.recibo_cancelado_reabre() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.cancelado and not old.cancelado then update public.receber set status = 'aberta', pago_em = null, recibo_id = null where recibo_id = new.id; end if;
  return null;
end $$;
create trigger recibo_cancelado_reabre after update of cancelado on public.recibos for each row execute function public.recibo_cancelado_reabre();
-- v3: o movimento de estoque aponta para a O.S.
alter table public.estoque_mov add constraint estoque_mov_ordem foreign key (ordem_id) references public.ordens (id) on delete set null;
