-- =====================================================================
-- DTCar Gestão — versão 7
-- A conversa com a SEFAZ passa para o robô do GitHub (worker/sefaz.mjs).
-- A tela grava pedidos (consultar agora, manifestações) e o robô atende
-- em até 10 minutos. Rode DEPOIS do v6.sql. Pode ser executado mais de uma vez.
-- =====================================================================
alter table public.sefaz_config add column if not exists pedido_em timestamptz;
alter table public.sefaz_config add column if not exists worker_em timestamptz;
alter table public.sefaz_config add column if not exists worker_erro text not null default '';
alter table public.nfe_recebidas add column if not exists manifestacao_pedida text not null default ''
  check (manifestacao_pedida in ('', 'confirmada', 'desconhecida', 'nao_realizada'));
alter table public.nfe_recebidas add column if not exists justificativa_pedida text not null default '';

-- "Consultar agora": o robô consulta na próxima volta (respeitando a espera de 1 hora da SEFAZ)
create or replace function public.pedir_consulta_sefaz()
returns jsonb language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador pode pedir a consulta.'; end if;
  update public.sefaz_config set pedido_em = now() where id = 1 returning * into c;
  return jsonb_build_object('proxima_consulta', c.proxima_consulta, 'worker_em', c.worker_em);
end $$;

-- manifestação do destinatário: fica na fila até o robô registrar na SEFAZ
create or replace function public.pedir_manifestacao(p_chave text, p_tipo text, p_justificativa text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Apenas o administrador registra manifestações.'; end if;
  if p_tipo not in ('confirmada', 'desconhecida', 'nao_realizada') then raise exception 'Manifestação inválida.'; end if;
  if p_tipo = 'nao_realizada' and length(trim(coalesce(p_justificativa, ''))) < 15 then raise exception 'Escreva uma justificativa com pelo menos 15 caracteres.'; end if;
  update public.nfe_recebidas set manifestacao_pedida = p_tipo, justificativa_pedida = left(trim(coalesce(p_justificativa, '')), 255), manifestacao_erro = ''
  where chave = p_chave;
  if not found then raise exception 'Nota não encontrada.'; end if;
end $$;
grant execute on function public.pedir_consulta_sefaz() to authenticated;
grant execute on function public.pedir_manifestacao(text, text, text) to authenticated;

-- o agendamento pelo banco não é mais usado (o robô do GitHub roda a cada 10 minutos)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtcar-sefaz';
exception when others then null;
end $$;
