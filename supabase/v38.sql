-- =====================================================================
-- DTCar Gestão — v38: WhatsApp — "pacote" de mensagens para o mesmo número (pedido do Danilo, 05/11/2026).
--
-- Problema: a O.S. + NF-e + NFS-e para o mesmo cliente saíam com minutos de diferença, porque depois de CADA envio
-- a fila esperava o intervalo de 25 a 70 s (regras.intervalo_min/max), mesmo sendo o mesmo contato.
--
-- Regra nova (só em whatsapp_resultado, que marca o intervalo depois de cada envio):
--   se o envio deu certo e a PRÓXIMA mensagem que a fila vai pegar é para o MESMO número e entrou na fila até
--   5 minutos depois desta, ela é do mesmo "pacote": o intervalo cai para 3 s. Cada mensagem continua separada,
--   com o seu PDF. O intervalo normal volta entre um contato e outro.
--   Trava: no máximo 6 mensagens seguidas para o mesmo número em 5 minutos; passou disso, intervalo normal.
--   Os limites por hora e por dia, o horário comercial e o PARAR não mudam (continuam na whatsapp_pegar_proxima).
--   Quando a mensagem seguinte entra na fila DEPOIS de a anterior já ter saído (o Claude enfileira uma de cada vez),
--   o gatilho da fila faz a mesma conta e encurta o intervalo que já estava marcado.
--
-- O motor 3.4 do tablet manda o pacote no mesmo sinal (não espera o sinal seguinte de 30 s). O motor antigo e a
-- função zap também respeitam o intervalo de 3 s, só demoram mais (um por sinal).
--
-- Depende do v36 (colunas interno e liberar_em da whatsapp_fila). Pode rodar mais de uma vez.
-- =====================================================================

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'whatsapp_fila' and column_name = 'liberar_em') then
    raise exception 'Rode o v36.sql antes do v38.sql (falta a coluna whatsapp_fila.liberar_em).';
  end if;
end $$;

-- A mensagem p_ant (já enviada) e a próxima que a fila vai pegar (mesma ordem da whatsapp_pegar_proxima) formam um pacote?
create or replace function public.whatsapp_pacote_segue(p_ant public.whatsapp_fila) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare prox public.whatsapp_fila; n int;
begin
  if p_ant.id is null or p_ant.status <> 'enviada' then return false; end if;
  select * into prox from public.whatsapp_fila
   where status = 'pendente' and (liberar_em is null or liberar_em <= now())
   order by interno desc, id limit 1;
  if prox.id is null or prox.telefone <> p_ant.telefone or prox.criado_em > p_ant.criado_em + interval '5 minutes' then return false; end if;
  select count(*) into n from public.whatsapp_fila
   where status = 'enviada' and telefone = p_ant.telefone and enviada_em > now() - interval '5 minutes';
  return n < 6;
end $$;

create or replace function public.whatsapp_resultado(p_dono text, p_id text, p_fila_id bigint, p_ok boolean, p_msg_id text, p_jid text, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_fila; r jsonb; a int; b int; v_txt text; v_pacote boolean := false;
begin
  update public.whatsapp_fila set status = case when p_ok then 'enviada' else 'erro' end,
         enviada_em = case when p_ok then now() end, msg_id = p_msg_id, erro = case when p_ok then null else left(p_erro, 300) end,
         entrega = case when p_ok then coalesce(entrega, 'enviada') end
   where id = p_fila_id and status = 'enviando' and pego_por = p_dono returning * into v;
  if v.id is null then return; end if;
  if p_ok then
    -- na conversa: o texto; mensagem só com PDF aparece como "[documento] nome.pdf"
    v_txt := case when v.texto <> '' then v.texto else '[documento] ' || coalesce(v.arquivo ->> 'nome', '') end;
    insert into public.whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, tipo, em, fila_id, lida, entrega)
    values (p_msg_id, coalesce(nullif(p_jid, ''), v.telefone || '@s.whatsapp.net'), v.telefone, true, v_txt,
            case when v.texto <> '' then 'texto' else 'documento' end, now(), v.id, true, 'enviada')
    on conflict (msg_id) do update set fila_id = excluded.fila_id, entrega = coalesce(public.whatsapp_mensagens.entrega, 'enviada');
    v_pacote := public.whatsapp_pacote_segue(v);
  end if;
  if v_pacote then
    update public.whatsapp_conexao set proximo_envio = now() + interval '3 seconds' where id = 1;
    return;
  end if;
  select regras into r from public.whatsapp_conexao where id = 1;
  a := coalesce((r ->> 'intervalo_min')::int, 25); b := greatest(a, coalesce((r ->> 'intervalo_max')::int, 70));
  update public.whatsapp_conexao set proximo_envio = now() + make_interval(secs => a + floor(random() * (b - a + 1))) where id = 1;
end $$;

-- A próxima do pacote entrou na fila depois de a anterior sair: encurta o intervalo já marcado (nunca alonga).
create or replace function public.whatsapp_fila_pacote_gatilho() returns trigger
language plpgsql security definer set search_path = public as $$
declare ant public.whatsapp_fila;
begin
  -- a última que saiu (ou falhou): se falhou, o intervalo normal fica
  select * into ant from public.whatsapp_fila
   where status in ('enviada', 'erro') and pego_em > now() - interval '5 minutes'
   order by pego_em desc, id desc limit 1;
  if public.whatsapp_pacote_segue(ant) then
    update public.whatsapp_conexao set proximo_envio = now() + interval '3 seconds'
     where id = 1 and proximo_envio > now() + interval '3 seconds';
  end if;
  return null;
end $$;

drop trigger if exists whatsapp_fila_pacote on public.whatsapp_fila;
create trigger whatsapp_fila_pacote after insert on public.whatsapp_fila
  for each row when (new.status = 'pendente') execute function public.whatsapp_fila_pacote_gatilho();

revoke all on function public.whatsapp_pacote_segue(public.whatsapp_fila) from public, anon, authenticated;
revoke all on function public.whatsapp_fila_pacote_gatilho() from public, anon, authenticated;
revoke all on function public.whatsapp_resultado(text, text, bigint, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_resultado(text, text, bigint, boolean, text, text, text) to service_role;
