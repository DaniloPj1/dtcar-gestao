-- Esquema mínimo para testar supabase/v37.sql num Postgres local (teste/teste_v37.sh).
-- Usa o esquema do teste do v21 e acrescenta clientes, recibos, receber e os gatilhos do v12/v17
-- (soma do recebido e fechamento da O.S. entregue quitada).
\set ON_ERROR_STOP 1
\ir v21_esquema.sql
alter table public.ordens add column cliente_id uuid, add column recebido numeric(12,2) not null default 0, add column checkin jsonb not null default '{}';
create table public.clientes (id uuid primary key default gen_random_uuid(), nome text not null, doc text not null default '');
create sequence public.recibos_numero_seq start 100;
create table public.recibos (id uuid primary key default gen_random_uuid(), numero int not null default nextval('public.recibos_numero_seq'),
  ordem_id uuid references public.ordens (id) on delete set null, cliente_id uuid, pagador text not null, doc text not null default '',
  valor numeric(12,2) not null check (valor > 0), referente text not null default '', forma text not null default '', conta_destino text,
  data date not null default current_date, obs text not null default '', emitido_por text not null default '',
  cancelado boolean not null default false, cancelado_motivo text not null default '', criado_em timestamptz not null default now());
create table public.receber (id uuid primary key default gen_random_uuid(), ordem_id uuid references public.ordens (id) on delete cascade, cliente_id uuid,
  cliente_nome text not null default '', descricao text not null default '', forma text not null default '', parcela int not null default 1, parcelas int not null default 1,
  valor numeric(12,2) not null check (valor > 0), vencimento date not null, status text not null default 'aberta' check (status in ('aberta', 'paga', 'cancelada')),
  pago_em date, recibo_id uuid references public.recibos (id) on delete set null, obs text not null default '', criado_por text not null default '',
  criado_em timestamptz not null default now());
-- v12: soma dos recibos válidos; v17: fecha quando entregue e quitada
create or replace function public.recalcular_recebido(p_ordem uuid) returns void language plpgsql security definer set search_path = public as $$
declare v numeric;
begin
  if p_ordem is null then return; end if;
  select coalesce(sum(valor), 0) into v from public.recibos where ordem_id = p_ordem and not cancelado;
  update public.ordens set recebido = v where id = p_ordem;
end $$;
create or replace function public.recibos_recalcula() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public.recalcular_recebido(old.ordem_id); return null; end if;
  perform public.recalcular_recebido(new.ordem_id); return null;
end $$;
create trigger recibos_recalcula after insert or update or delete on public.recibos for each row execute function public.recibos_recalcula();
create or replace function public.ordens_situacao_pagamento() returns trigger language plpgsql as $$
begin
  if new.status = 'entregue' and new.checkin->'legado' is not null and coalesce((new.checkin->'legado'->>'a_receber')::boolean, false) = false then
    new.finalizada_em := coalesce(new.finalizada_em, now());
  elsif new.status = 'entregue' and new.recebido >= new.total - 0.009 then new.finalizada_em := coalesce(new.finalizada_em, now());
  else new.finalizada_em := null; end if;
  return new;
end $$;
create trigger ordens_situacao_pagamento before insert or update on public.ordens for each row execute function public.ordens_situacao_pagamento();
