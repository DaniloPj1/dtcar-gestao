-- DTCar Gestão — v16: O.S. entregues do sistema antigo contam como fechadas também depois da carga do espelho
-- Problema (01/11/2026): o painel mostrava 1766 O.S. "Aguardando pagamento". A regra "entregue no OS Oficina = paga"
-- (v12) só rodava ao ALTERAR a O.S.; a carga do sistema antigo INCLUI as O.S. de novo e elas ficavam sem a data de fechamento.
-- Agora a mesma regra vale ao incluir, e as O.S. já carregadas são acertadas.
-- Pode rodar mais de uma vez. Período de transição: só acerta a situação de pagamento das O.S. do sistema antigo
-- (nada novo a zerar); antes e depois da virada o comportamento é o mesmo.

drop trigger if exists ordens_situacao_pagamento on public.ordens;
create trigger ordens_situacao_pagamento before insert or update of status, total, recebido on public.ordens
  for each row execute function public.ordens_situacao_pagamento();

update public.ordens set finalizada_em = coalesce(entregue_em, now())
  where status = 'entregue' and checkin->'legado' is not null and finalizada_em is null;
