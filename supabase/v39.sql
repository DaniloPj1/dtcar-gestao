-- =====================================================================
-- DTCar Gestão — v39: WhatsApp — sem o motor, acorda a função zap para o aviso interno liberado fora do horário
-- (apontamento do Codex no PR #47, 05/11/2026).
--
-- O v36 deixa os avisos ao Danilo (mensagens internas) saírem fora do horário comercial, menos no silêncio (22h–7h),
-- conferindo isso na hora de enviar (whatsapp_pegar_proxima). Mas, SEM o motor do tablet, quem acorda a função zap é o
-- whatsapp_vigiar (v32), que só conhece o horário comercial e o fora_horario. Resultado: um aviso que nasceu no silêncio de
-- sábado à noite ficava parado até segunda às 8h.
--
-- Agora o agendamento de 1 minuto (whatsapp_avisos_minuto) também acorda a zap quando há interna pendente que o
-- whatsapp_pegar_proxima já libera: fora do horário comercial, fora do silêncio, sem o motor na vez e sem a zap já conectada.
--
-- Rode depois do v36 (e do v38, se já estiver rodado; a ordem entre os dois não importa). Pode rodar mais de uma vez.
-- Espelho/período de transição: nada aqui é O.S., cadastro, dinheiro ou estoque.
-- =====================================================================

create or replace function public.whatsapp_avisos_minuto() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0; v_exp int; v_pend boolean; c public.whatsapp_conexao; v_cfg jsonb; v_acordou_zap boolean := false;
begin
  -- mensagens ainda sem tratamento (o motor/zap não pediu, áudio esperando a transcrição, erro passageiro)
  n := public.whatsapp_avisos_processar(50);
  -- rascunho sem OK há 24 h vence
  update public.whatsapp_avisos set situacao = 'expirado', atualizado_em = now()
   where tipo = 'rascunho' and situacao = 'aguardando_ok' and atualizado_em < now() - interval '24 hours';
  get diagnostics v_exp = row_count;
  -- 3 tentativas da IA sem sucesso: vai o texto do Danilo
  for r in select id from public.whatsapp_avisos where tipo = 'rascunho' and situacao in ('pendente', 'gerando') and tentativas >= 3
             and atualizado_em < now() - interval '3 minutes' loop
    update public.whatsapp_avisos set situacao = 'pendente' where id = r.id;
    perform public.whatsapp_assistente_resultado(r.id, null, null, coalesce((select ia from public.whatsapp_avisos where id = r.id), 'a IA não respondeu'), true);
  end loop;
  -- rascunho esperando a IA (o chamado na hora pode ter falhado)
  v_pend := exists (select 1 from public.whatsapp_avisos where tipo = 'rascunho' and tentativas < 3
                     and ((situacao = 'pendente' and atualizado_em < now() - interval '50 seconds')
                          or (situacao = 'gerando' and atualizado_em < now() - interval '3 minutes')));
  if v_pend then perform public.whatsapp_assistente_acordar(); end if;
  -- sem o motor: interna liberada fora do horário comercial (fim do silêncio, fim de semana) — o whatsapp_vigiar (v32) só acorda a
  -- zap para o que sai no horário comercial ou com fora_horario; aqui acorda para as internas que o whatsapp_pegar_proxima já libera
  select * into c from public.whatsapp_conexao where id = 1;
  v_cfg := public.whatsapp_avisos_cfg();
  if c.id is not null and not public.whatsapp_no_horario(c.regras) and coalesce((v_cfg ->> 'fora_horario')::boolean, true)
     and not public.whatsapp_no_silencio(v_cfg)
     and not (c.dono = 'android' and c.dono_ate > now()) and not (c.dono = 'supabase' and c.dono_ate > now())
     and coalesce(c.situacao, '') not in ('pareando', 'desligado')
     and (c.proximo_envio is null or c.proximo_envio < now() + interval '1 minute')
     and exists (select 1 from public.whatsapp_fila where status = 'pendente' and interno and not fora_horario
                  and (liberar_em is null or liberar_em <= now()))
     and to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is not null then
    begin
      execute $q$ select net.http_post(
          url := 'https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/zap',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-dtcar-cron', (select valor from public.segredos where chave = 'cron')),
          body := '{"acao":"processar","origem":"agendamento"}'::jsonb,
          timeout_milliseconds := 30000) $q$;
      v_acordou_zap := true;
    exception when others then raise warning 'WhatsApp: não acordou a função zap: %', sqlerrm;
    end;
  end if;
  -- vigias vencidas há mais de 30 dias saem da tabela
  delete from public.whatsapp_vigias where ate < now() - interval '30 days';
  return jsonb_build_object('tratadas', n, 'vencidos', v_exp, 'acordou_ia', v_pend, 'acordou_zap', v_acordou_zap);
end $$;

revoke all on function public.whatsapp_avisos_minuto() from public, anon, authenticated;
grant execute on function public.whatsapp_avisos_minuto() to service_role;

notify pgrst, 'reload schema';
