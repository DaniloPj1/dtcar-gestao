-- Esquema mínimo para testar supabase/v21.sql num Postgres local (teste/teste_v21.sh).
-- Usa o esquema do teste do v15 e acrescenta só as colunas e tabelas que o v21 usa.
\set ON_ERROR_STOP 1
\ir v15_esquema.sql
\ir ../supabase/v15.sql
alter table public.ordens add column custo numeric(12,2) not null default 0, add column desconto numeric(12,2) not null default 0,
  add column veiculo jsonb not null default '{}', add column finalizada_em timestamptz;
alter table public.os_itens add column codigo text not null default '', add column custo_unit numeric(10,2) not null default 0,
  add column desconto numeric(10,2) not null default 0, add column produto_id uuid, add column fornecida_cliente boolean not null default false,
  add column qualidade text not null default '', add column adicional boolean not null default false;
create table public.produtos (id uuid primary key default gen_random_uuid(), codigo int, codigo_barras text, tipo text not null default 'produto', descricao text not null,
  custo numeric(12,2) not null default 0, estoque_atual numeric(12,3) not null default 0, controla_estoque boolean not null default true, vender_sem_estoque boolean not null default true, ativo boolean not null default true);
create table public.estoque_mov (id bigint generated always as identity primary key, produto_id uuid not null, ordem_id uuid, tipo text not null, qtd numeric(12,3) not null,
  saldo numeric(12,3) not null, obs text not null default '', usuario_nome text not null default '', criado_em timestamptz not null default now());
create table public.estoque_reserva (item_id uuid primary key, ordem_id uuid not null, produto_id uuid not null, qtd numeric(12,3) not null);
create table public.perfis (id uuid primary key, nome text not null default '');
create table public.agente_acoes (id uuid primary key default gen_random_uuid(), em timestamptz not null default now(), ferramenta text not null, pedido text not null default '',
  tabela text not null default '', registro text not null default '', antes jsonb, depois jsonb, confirmado_por text not null default '');
create schema if not exists auth;
create or replace function auth.uid() returns uuid language sql as $$ select '00000000-0000-0000-0000-00000000000a'::uuid $$;
insert into public.perfis values ('00000000-0000-0000-0000-00000000000a', 'Danilo');
create or replace function public.agente_exige_admin() returns void language sql as $$ select null::void $$;
create or replace function public.agente_reais(v numeric) returns text language sql immutable as $$
  select 'R$ ' || translate(to_char(coalesce(v, 0), 'FM999,999,999,990.00'), ',.', '.,') $$;
create or replace function public.agente_etapa(o public.ordens) returns text language sql immutable as $$ select o.status $$;
create or replace function public.estoque_sincroniza_item(p_item uuid, p_ordem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare it public.os_itens; st text; num int; res public.estoque_reserva; quer_prod uuid; quer_qtd numeric := 0; delta numeric; novo numeric; v_nome text;
begin
  if current_setting('dtcar.sem_estoque', true) = '1' then return; end if;
  select * into it from public.os_itens where id = p_item;
  select status, numero into st, num from public.ordens where id = p_ordem;
  if it.id is not null and it.tipo = 'peca' and it.produto_id is not null and not it.fornecida_cliente and it.aprovado is distinct from false
     and coalesce(st, 'cancelado') <> 'cancelado'
     and exists (select 1 from public.produtos p where p.id = it.produto_id and p.tipo = 'produto' and p.controla_estoque) then
    quer_prod := it.produto_id; quer_qtd := it.qtd;
  end if;
  select pf.nome into v_nome from public.perfis pf where pf.id = auth.uid();
  select * into res from public.estoque_reserva where item_id = p_item;
  if res.item_id is not null and (quer_prod is null or res.produto_id <> quer_prod) then
    update public.produtos set estoque_atual = estoque_atual + res.qtd where id = res.produto_id returning estoque_atual into novo;
    insert into public.estoque_mov (produto_id, ordem_id, tipo, qtd, saldo, obs, usuario_nome)
    values (res.produto_id, p_ordem, 'estorno', res.qtd, novo, 'Retirado da O.S. ' || lpad(coalesce(num, 0)::text, 5, '0'), coalesce(v_nome, ''));
    delete from public.estoque_reserva where item_id = p_item; res := null;
  end if;
  if quer_prod is null then return; end if;
  delta := quer_qtd - coalesce(res.qtd, 0);
  if delta = 0 then return; end if;
  update public.produtos set estoque_atual = estoque_atual - delta where id = quer_prod returning estoque_atual into novo;
  insert into public.estoque_mov (produto_id, ordem_id, tipo, qtd, saldo, obs, usuario_nome)
  values (quer_prod, p_ordem, case when delta > 0 then 'saida' else 'estorno' end, -delta, novo, 'O.S. ' || lpad(coalesce(num, 0)::text, 5, '0'), coalesce(v_nome, ''));
  insert into public.estoque_reserva (item_id, ordem_id, produto_id, qtd) values (p_item, p_ordem, quer_prod, quer_qtd)
  on conflict (item_id) do update set produto_id = excluded.produto_id, qtd = excluded.qtd;
end $$;

create or replace function public.estoque_item_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.estoque_sincroniza_item(coalesce(new.id, old.id), coalesce(new.ordem_id, old.ordem_id));
  return null;
end $$;
drop trigger if exists os_itens_estoque on public.os_itens;
create trigger os_itens_estoque after insert or update or delete on public.os_itens for each row execute function public.estoque_item_gatilho();
