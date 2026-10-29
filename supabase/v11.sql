-- =====================================================================
-- DTCar Gestão — versão 11
-- Entrega do veículo separada do recebimento: a O.S. entregue fica
-- "a receber" até os recibos quitarem o total; aí é finalizada.
-- Motivo obrigatório no cancelamento.
-- Rode DEPOIS do v10.sql. Pode ser executado mais de uma vez.
-- =====================================================================
alter table public.ordens add column if not exists recebido numeric(12, 2) not null default 0;
alter table public.ordens add column if not exists finalizada_em timestamptz;
alter table public.ordens add column if not exists motivo_cancelamento text not null default '';

-- soma dos recibos válidos da O.S.; finaliza quando o veículo já saiu e o total foi quitado
create or replace function public.recalcular_recebido(p_ordem uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v numeric; o record;
begin
  if p_ordem is null then return; end if;
  select coalesce(sum(valor), 0) into v from public.recibos where ordem_id = p_ordem and not cancelado;
  select * into o from public.ordens where id = p_ordem;
  if not found then return; end if;
  update public.ordens set recebido = v,
    finalizada_em = case when o.status = 'entregue' and v >= o.total - 0.009 then coalesce(o.finalizada_em, now()) else null end
  where id = p_ordem;
end $$;

create or replace function public.recibos_recalcula() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then perform public.recalcular_recebido(old.ordem_id); return null; end if;
  perform public.recalcular_recebido(new.ordem_id);
  if tg_op = 'UPDATE' and old.ordem_id is distinct from new.ordem_id then perform public.recalcular_recebido(old.ordem_id); end if;
  return null;
end $$;
drop trigger if exists recibos_recalcula on public.recibos;
create trigger recibos_recalcula after insert or update or delete on public.recibos for each row execute function public.recibos_recalcula();

-- ao entregar, reabrir ou mudar o total, a situação de pagamento é refeita
create or replace function public.ordens_situacao_pagamento() returns trigger language plpgsql as $$
begin
  if new.status = 'entregue' and new.checkin->'legado' is not null then new.finalizada_em := coalesce(new.finalizada_em, new.entregue_em, now());
  elsif new.status = 'entregue' and new.recebido >= new.total - 0.009 then new.finalizada_em := coalesce(new.finalizada_em, now());
  else new.finalizada_em := null; end if;
  return new;
end $$;
drop trigger if exists ordens_situacao_pagamento on public.ordens;
create trigger ordens_situacao_pagamento before update of status, total, recebido on public.ordens for each row execute function public.ordens_situacao_pagamento();

-- situação atual: recibos já emitidos e O.S. importadas do sistema antigo (entregues = pagas no sistema antigo)
update public.ordens o set recebido = coalesce((select sum(r.valor) from public.recibos r where r.ordem_id = o.id and not r.cancelado), 0);
update public.ordens set finalizada_em = coalesce(entregue_em, now()) where status = 'entregue' and checkin->'legado' is not null and finalizada_em is null;
update public.ordens set finalizada_em = coalesce(entregue_em, now()) where status = 'entregue' and recebido >= total - 0.009 and finalizada_em is null;
