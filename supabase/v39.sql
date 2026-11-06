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
-- Também corrige o whatsapp_vigiar (v32), que tinha o mesmo problema com a vez solta (dono_ate nulo): sem o motor, depois da
-- primeira execução da zap o agendamento de 5 minutos deixava de acordá-la.
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
     -- vez livre: ninguém com validade futura (dono_ate nulo = vez solta pela zap, whatsapp_soltar_vez do v24)
     and not coalesce(c.dono in ('android', 'supabase') and c.dono_ate > now(), false)
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


-- v32 com a mesma correção: depois de uma execução normal da zap, a vez fica com dono 'supabase' e dono_ate NULO
-- (whatsapp_soltar_vez, v24). A conta "not (dono = 'supabase' and dono_ate > now())" dava NULO, e o agendamento de 5 minutos
-- deixava de acordar a zap (sem o motor, a fila e as recebidas só andavam quando o Claude ou a tela pediam).
create or replace function public.whatsapp_vigiar() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c public.whatsapp_conexao; v_vinc boolean; v_motor_vez boolean; v_novos jsonb := '{}'::jsonb; v_ant jsonb; k text;
  v_paradas int; v_fila_id bigint; v_no boolean; v_pode_sair boolean; v_acordar boolean := false; v_ult timestamptz;
  v_motivo text := '';
begin
  select * into c from public.whatsapp_conexao where id = 1 for update;
  if c.id is null then return jsonb_build_object('acordar', false); end if;
  v_ant := coalesce(c.alertas, '{}'::jsonb);
  select exists (select 1 from public.whatsapp_sessao where chave = 'creds'
                  and (valor -> 'me' ->> 'id' is not null or coalesce((valor ->> 'registered')::boolean, false))) into v_vinc;
  v_motor_vez := coalesce(c.dono = 'android' and c.dono_ate > now(), false);  -- v39: dono_ate nulo = vez solta
  v_no := public.whatsapp_no_horario(c.regras);

  -- motor do Android/tablet sem sinal (só se já existe chave do motor: senão o motor não está em uso)
  if c.motor_hash is not null and c.motor_visto is not null and c.motor_visto < now() - interval '15 minutes' and v_vinc then
    v_novos := v_novos || jsonb_build_object('motor', jsonb_build_object(
      'texto', 'O motor do WhatsApp no tablet está sem sinal desde ' || to_char(c.motor_visto at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
               || '. As mensagens seguem pelo Supabase, com alguns minutos de atraso. Confira se o tablet está ligado, na tomada e com Wi-Fi.',
      'desde', c.motor_visto));
  end if;
  -- celular desvinculou o sistema (havia número vinculado antes ou já houve conversa)
  if not v_vinc and c.situacao <> 'pareando' and (c.motor_hash is not null or exists (select 1 from public.whatsapp_mensagens limit 1)) then
    v_novos := v_novos || jsonb_build_object('desvinculado', jsonb_build_object(
      'texto', 'O WhatsApp da oficina está desvinculado do sistema: nada é enviado nem recebido. Vincule de novo pelo QR Code em Sistema › WhatsApp.',
      'desde', coalesce(v_ant -> 'desvinculado' -> 'desde', to_jsonb(now()))));
  end if;
  -- conexão com problema há mais de 15 min
  if v_vinc and c.situacao = 'erro' and c.atualizado_em < now() - interval '15 minutes' then
    v_novos := v_novos || jsonb_build_object('erro', jsonb_build_object(
      'texto', 'O WhatsApp da oficina está com problema de conexão: ' || coalesce(nullif(c.detalhe, ''), 'sem detalhe') || ' Confira em Sistema › WhatsApp.',
      'desde', c.atualizado_em));
  end if;
  -- fila parada: mensagem que já podia ter saído está pendente há mais de 30 min
  select count(*) into v_paradas from public.whatsapp_fila
   where status = 'pendente' and (v_no or fora_horario) and criado_em < now() - interval '30 minutes';
  if v_paradas > 0 and v_vinc then
    v_novos := v_novos || jsonb_build_object('fila', jsonb_build_object(
      'texto', v_paradas || ' mensagem(ns) parada(s) na fila do WhatsApp há mais de 30 minutos. Confira em Sistema › WhatsApp.',
      'desde', coalesce(v_ant -> 'fila' -> 'desde', to_jsonb(now()))));
  end if;

  -- aviso pelo WhatsApp: só para "motor" (é o caso em que o WhatsApp ainda funciona, pela reserva)
  if v_novos ? 'motor' then
    if v_ant ? 'motor' then
      v_novos := jsonb_set(v_novos, '{motor,fila_id}', coalesce(v_ant -> 'motor' -> 'fila_id', 'null'::jsonb));
      v_novos := jsonb_set(v_novos, '{motor,avisado_em}', coalesce(v_ant -> 'motor' -> 'avisado_em', 'null'::jsonb));
    else
      v_fila_id := public.whatsapp_alerta_na_fila('⚠️ DTCar Gestão: ' || (v_novos -> 'motor' ->> 'texto'));
      v_novos := jsonb_set(v_novos, '{motor,fila_id}', to_jsonb(v_fila_id));
      v_novos := jsonb_set(v_novos, '{motor,avisado_em}', to_jsonb(now()));
    end if;
  elsif v_ant ? 'motor' then
    -- o motor voltou: se o aviso ainda não saiu, cancela; se saiu, avisa que voltou
    update public.whatsapp_fila set status = 'cancelada', erro = 'O motor voltou antes de o aviso sair.'
     where id = nullif(v_ant -> 'motor' ->> 'fila_id', '')::bigint and status = 'pendente';
    if not found and nullif(v_ant -> 'motor' ->> 'fila_id', '') is not null then
      perform public.whatsapp_alerta_na_fila('✅ DTCar Gestão: o motor do WhatsApp no tablet voltou a funcionar.');
    end if;
  end if;
  -- mantém o "desde" original de cada alerta que continua aberto
  for k in select jsonb_object_keys(v_novos) loop
    if v_ant ? k and k <> 'motor' then v_novos := jsonb_set(v_novos, array[k, 'desde'], v_ant -> k -> 'desde'); end if;
  end loop;

  -- sem o motor: acorda a função zap para enviar a fila / buscar as recebidas
  if v_vinc and not v_motor_vez and coalesce(c.situacao, '') <> 'pareando' and not coalesce(c.dono = 'supabase' and c.dono_ate > now(), false) then
    v_pode_sair := exists (select 1 from public.whatsapp_fila where status = 'pendente' and (v_no or fora_horario))
                   and (c.proximo_envio is null or c.proximo_envio < now() + interval '4 minutes');
    v_ult := nullif(c.ultimo_teste ->> 'em', '')::timestamptz;
    if v_pode_sair then v_acordar := true; v_motivo := 'fila';
    elsif v_no and (v_ult is null or v_ult < now() - interval '15 minutes') then v_acordar := true; v_motivo := 'buscar recebidas';
    end if;
  end if;

  update public.whatsapp_conexao set alertas = v_novos, vigiado_em = now() where id = 1;
  return jsonb_build_object('acordar', v_acordar, 'motivo', v_motivo, 'alertas', v_novos);
end $$;

revoke all on function public.whatsapp_avisos_minuto() from public, anon, authenticated;
revoke all on function public.whatsapp_vigiar() from public, anon, authenticated;
grant execute on function public.whatsapp_vigiar() to service_role;
grant execute on function public.whatsapp_avisos_minuto() to service_role;

notify pgrst, 'reload schema';
