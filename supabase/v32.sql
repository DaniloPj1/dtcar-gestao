-- =====================================================================
-- DTCar Gestão — v32: WhatsApp — status de entrega e alertas automáticos.
--
-- 1) STATUS DE ENTREGA (pedido do Danilo, 04/11/2026): cada mensagem que a oficina manda passa a guardar
--    os "tiques" do WhatsApp:
--      enviada (✓, chegou ao servidor) → entregue (✓✓, chegou ao celular do cliente) → lida (✓✓ azul)
--      → ouvida (áudio). "erro" quando o WhatsApp recusa.
--    O motor do Android (e a função zap, quando é ela que está conectada) recebe os tiques e grava aqui.
--    O status só anda para a frente (uma confirmação atrasada nunca "desfaz" a leitura).
--    Cliente que desligou a "Confirmação de leitura" nunca fica "lida": o máximo é "entregue".
--    Colunas novas em whatsapp_mensagens e whatsapp_fila: entrega, entregue_em, lida_em.
--
-- 2) ALERTAS (pedido do Danilo, 04/11/2026): a cada 5 minutos o banco confere a saúde do WhatsApp
--    (whatsapp_vigiar, agendada no pg_cron) e registra em whatsapp_conexao.alertas:
--      motor        — o motor do tablet/Android está sem sinal há mais de 15 minutos;
--      desvinculado — o celular da oficina desvinculou o sistema (precisa ler o QR Code de novo);
--      erro         — a conexão está "com problema" há mais de 15 minutos;
--      fila         — mensagem liberada para sair está parada na fila há mais de 30 minutos.
--    A tela mostra os alertas (faixa vermelha para o administrador). Para o "motor", que é o caso em que
--    o WhatsApp ainda funciona pela reserva, o sistema também manda uma mensagem para o número de alerta
--    (whatsapp_conexao.alerta_telefone, definido pelo administrador na tela) — dentro do horário de envio — e
--    avisa de novo quando o motor voltar. Se o motor voltar antes de o aviso sair, o aviso é cancelado.
--    Sem o motor, o agendamento também acorda a função zap para enviar a fila (antes ela só acordava quando
--    o Claude ou a tela pediam) e, no horário de envio, para buscar mensagens recebidas a cada 15 minutos.
--
-- 3) CONVERSA LIGADA AO CADASTRO: ao ler uma conversa, o Claude e a tela veem se o número é de cliente
--    cadastrado e as O.S. abertas dele (número, etapa, placa). Número sem cadastro aparece como tal.
--
-- 4) FOTO E ÁUDIO RECEBIDOS: o motor (ou a função zap) baixa a mídia e manda para a função zap:
--      áudio  — transcrito pelo Groq (Whisper), se a chave GROQ_API_KEY estiver nos segredos da função;
--               o texto fica na conversa ("[áudio 0:12] ...") e o arquivo NÃO é guardado;
--      foto   — guardada na pasta privada "whatsapp-midia" por 30 dias (depois é apagada sozinha);
--      vídeo, documento, figurinha — continuam só com o tipo (não guardados).
--
-- 5) SEM RESPOSTA: o resumo mostra conversas em que o cliente escreveu por último e ninguém respondeu
--    há mais de 2 horas (últimos 3 dias).
--
-- Rode depois do v25/v26. Pode rodar mais de uma vez.
-- Espelho/período de transição: tabelas do WhatsApp ficam fora do backup e do espelho (como no v25);
-- nada aqui é O.S., cadastro, dinheiro ou estoque. Antes e depois da virada funciona igual.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Colunas novas
-- ---------------------------------------------------------------------
alter table public.whatsapp_mensagens add column if not exists entrega text;          -- enviada | entregue | lida | ouvida | erro (só de_mim)
alter table public.whatsapp_mensagens add column if not exists entregue_em timestamptz;
alter table public.whatsapp_mensagens add column if not exists lida_em timestamptz;
alter table public.whatsapp_fila add column if not exists entrega text;
alter table public.whatsapp_fila add column if not exists entregue_em timestamptz;
alter table public.whatsapp_fila add column if not exists lida_em timestamptz;
create index if not exists whatsapp_fila_msg_id on public.whatsapp_fila (msg_id) where msg_id is not null;

alter table public.whatsapp_conexao add column if not exists alertas jsonb not null default '{}'::jsonb; -- problemas abertos
alter table public.whatsapp_conexao add column if not exists alerta_telefone text;                     -- quem recebe o aviso
alter table public.whatsapp_conexao add column if not exists vigiado_em timestamptz;                   -- última conferência
grant select (alertas, alerta_telefone, vigiado_em) on public.whatsapp_conexao to authenticated;

-- mídia recebida (foto guardada por 30 dias; áudio só a transcrição)
alter table public.whatsapp_mensagens add column if not exists midia_path text;         -- caminho na pasta whatsapp-midia
alter table public.whatsapp_mensagens add column if not exists midia_tipo text;         -- tipo do arquivo (image/jpeg, audio/ogg…)
alter table public.whatsapp_mensagens add column if not exists midia_expira timestamptz;
alter table public.whatsapp_mensagens add column if not exists transcricao text;
alter table public.whatsapp_mensagens add column if not exists duracao_s int;
alter table public.whatsapp_mensagens add column if not exists midia_erro text;
create index if not exists whatsapp_mensagens_midia_expira on public.whatsapp_mensagens (midia_expira) where midia_path is not null;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-midia', 'whatsapp-midia', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
-- só o administrador vê as fotos (link temporário pela tela); só a função zap grava e apaga (chave de servidor)
drop policy if exists whatsapp_midia_admin_ler on storage.objects;
create policy whatsapp_midia_admin_ler on storage.objects for select to authenticated
  using (bucket_id = 'whatsapp-midia' and public.e_admin());

-- alertas automáticos entram na fila com origem 'sistema'
alter table public.whatsapp_fila drop constraint if exists whatsapp_fila_origem_check;
alter table public.whatsapp_fila add constraint whatsapp_fila_origem_check check (origem in ('claude', 'tela', 'sistema'));

-- ---------------------------------------------------------------------
-- Status de entrega
-- ---------------------------------------------------------------------
-- ordem do status (só anda para a frente)
create or replace function public.whatsapp_ordem_entrega(p text) returns int language sql immutable as $$
  select case p when 'enviada' then 1 when 'entregue' then 2 when 'lida' then 3 when 'ouvida' then 4 else 0 end
$$;

-- p_lista: [{msg_id, status, em}] — status no número do WhatsApp (0 erro, 1 pendente, 2 servidor, 3 entregue,
-- 4 lida, 5 ouvida) ou no nome (enviada/entregue/lida/ouvida/erro). Devolve quantas linhas mudaram.
create or replace function public.whatsapp_guardar_entrega(p_lista jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare x jsonb; v_st text; v_em timestamptz; n int := 0; k int;
begin
  for x in select * from jsonb_array_elements(coalesce(p_lista, '[]'::jsonb)) loop
    v_st := case x ->> 'status' when '0' then 'erro' when '2' then 'enviada' when '3' then 'entregue' when '4' then 'lida' when '5' then 'ouvida'
                 when 'erro' then 'erro' when 'enviada' then 'enviada' when 'entregue' then 'entregue' when 'lida' then 'lida' when 'ouvida' then 'ouvida' end;
    if v_st is null or coalesce(x ->> 'msg_id', '') = '' then continue; end if;
    v_em := coalesce((x ->> 'em')::timestamptz, now());
    if v_em > now() + interval '5 minutes' then v_em := now(); end if;
    if v_st = 'erro' then
      -- erro só vale enquanto não houve confirmação de entrega
      update public.whatsapp_mensagens set entrega = 'erro'
       where msg_id = x ->> 'msg_id' and de_mim and public.whatsapp_ordem_entrega(entrega) <= 1 and entrega is distinct from 'erro';
      get diagnostics k = row_count; n := n + k;
      update public.whatsapp_fila set entrega = 'erro'
       where msg_id = x ->> 'msg_id' and public.whatsapp_ordem_entrega(entrega) <= 1 and entrega is distinct from 'erro';
      continue;
    end if;
    update public.whatsapp_mensagens
       set entrega = v_st,
           entregue_em = case when public.whatsapp_ordem_entrega(v_st) >= 2 then coalesce(entregue_em, v_em) else entregue_em end,
           lida_em = case when public.whatsapp_ordem_entrega(v_st) >= 3 then coalesce(lida_em, v_em) else lida_em end
     where msg_id = x ->> 'msg_id' and de_mim and public.whatsapp_ordem_entrega(entrega) < public.whatsapp_ordem_entrega(v_st);
    get diagnostics k = row_count; n := n + k;
    update public.whatsapp_fila
       set entrega = v_st,
           entregue_em = case when public.whatsapp_ordem_entrega(v_st) >= 2 then coalesce(entregue_em, v_em) else entregue_em end,
           lida_em = case when public.whatsapp_ordem_entrega(v_st) >= 3 then coalesce(lida_em, v_em) else lida_em end
     where msg_id = x ->> 'msg_id' and public.whatsapp_ordem_entrega(entrega) < public.whatsapp_ordem_entrega(v_st);
  end loop;
  return n;
end $$;

-- versão para o motor (confere a chave; vale mesmo sem a vez: a confirmação é de mensagem que já saiu)
create or replace function public.whatsapp_motor_entrega(p_chave text, p_id text, p_lista jsonb) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_conferir(p_chave);
  return public.whatsapp_guardar_entrega(p_lista);
end $$;

-- resultado do envio (v25) + a mensagem enviada já nasce "enviada"
create or replace function public.whatsapp_resultado(p_dono text, p_id text, p_fila_id bigint, p_ok boolean, p_msg_id text, p_jid text, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_fila; r jsonb; a int; b int;
begin
  update public.whatsapp_fila set status = case when p_ok then 'enviada' else 'erro' end,
         enviada_em = case when p_ok then now() end, msg_id = p_msg_id, erro = case when p_ok then null else left(p_erro, 300) end,
         entrega = case when p_ok then coalesce(entrega, 'enviada') end
   where id = p_fila_id and status = 'enviando' and pego_por = p_dono returning * into v;
  if v.id is null then return; end if;
  if p_ok then
    insert into public.whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, tipo, em, fila_id, lida, entrega)
    values (p_msg_id, coalesce(nullif(p_jid, ''), v.telefone || '@s.whatsapp.net'), v.telefone, true, v.texto, 'texto', now(), v.id, true, 'enviada')
    on conflict (msg_id) do update set fila_id = excluded.fila_id, entrega = coalesce(public.whatsapp_mensagens.entrega, 'enviada');
  end if;
  select regras into r from public.whatsapp_conexao where id = 1;
  a := coalesce((r ->> 'intervalo_min')::int, 25); b := greatest(a, coalesce((r ->> 'intervalo_max')::int, 70));
  update public.whatsapp_conexao set proximo_envio = now() + make_interval(secs => a + floor(random() * (b - a + 1))) where id = 1;
end $$;

-- ---------------------------------------------------------------------
-- Conversa ligada ao cadastro (cliente e O.S. abertas)
-- ---------------------------------------------------------------------
-- cliente cadastrado com este telefone (o atualizado mais recente)
create or replace function public.whatsapp_cliente_do_tel(p_tel text) returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.clientes c
   where public.whatsapp_chave_tel(p_tel) <> ''
     and public.whatsapp_chave_tel(p_tel) in (public.whatsapp_chave_tel(c.telefone), public.whatsapp_chave_tel(c.telefone2), public.whatsapp_chave_tel(c.telefone3))
     and coalesce(c.telefone, '') || coalesce(c.telefone2, '') || coalesce(c.telefone3, '') <> ''
   order by c.atualizado_em desc nulls last limit 1
$$;

-- O.S. abertas do cliente (orçamento, execução, aguardando pagamento — no pátio ou entregue sem quitar)
create or replace function public.whatsapp_os_abertas(p_cliente uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('numero', o.numero, 'etapa', public.agente_etapa(o), 'placa', o.veiculo ->> 'placa',
                                               'veiculo', trim(concat_ws(' ', o.veiculo ->> 'marca', o.veiculo ->> 'modelo')),
                                               'aberta_em', o.criado_em, 'total', o.total,
                                               'falta_receber', greatest(o.total - coalesce(o.recebido, 0), 0)) order by o.numero desc), '[]'::jsonb)
    from (select * from public.ordens o
           where p_cliente is not null and o.cliente_id = p_cliente
             and (o.status in ('diagnostico', 'aguardando', 'execucao', 'pronto') or (o.status = 'entregue' and o.finalizada_em is null))
           order by o.numero desc limit 5) o
$$;

-- conversas recentes (v25) + cliente cadastrado e O.S. aberta mais recente
create or replace function public.whatsapp_conversas(p_limite int default 20, p_so_nao_lidas boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Só o administrador vê o WhatsApp.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(x) - 'chave' - 'cliente_uuid' order by x.ultima_em desc) from (
    select g.*, c.nome cliente, c.id cliente_id, c.id is not null cadastrado,
           (select (a -> 0 ->> 'numero') || ' · ' || (a -> 0 ->> 'etapa') || coalesce(' · ' || nullif(a -> 0 ->> 'placa', ''), '')
              from (select public.whatsapp_os_abertas(c.id) a) z where jsonb_array_length(a) > 0) os_aberta,
           c.id cliente_uuid
      from (select public.whatsapp_chave_tel(m.telefone) chave, max(m.telefone) telefone,
                   max(m.em) ultima_em, count(*) filter (where not m.de_mim and not m.lida) nao_lidas,
                   (array_agg(m.texto order by m.em desc))[1] ultima_mensagem, (array_agg(m.de_mim order by m.em desc))[1] ultima_de_mim,
                   (array_agg(case when m.de_mim then coalesce(m.entrega, 'enviada') end order by m.em desc))[1] ultima_entrega,
                   max(nullif(m.nome, '')) nome_no_whatsapp
              from public.whatsapp_mensagens m where m.telefone <> ''
             group by public.whatsapp_chave_tel(m.telefone)
            having not p_so_nao_lidas or count(*) filter (where not m.de_mim and not m.lida) > 0
             order by max(m.em) desc limit least(greatest(coalesce(p_limite, 20), 1), 100)) g
      left join public.clientes c on c.id = public.whatsapp_cliente_do_tel(g.telefone)) x), '[]'::jsonb);
end $$;

-- mensagens de um número (v25) + status de entrega, mídia, cliente e O.S. abertas
create or replace function public.whatsapp_mensagens_de(p_telefone text, p_limite int default 30, p_marcar_lidas boolean default true) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_chave text := public.whatsapp_chave_tel(p_telefone); v jsonb; v_ids bigint[]; v_cli public.clientes;
begin
  if not public.e_admin() then raise exception 'Só o administrador vê o WhatsApp.'; end if;
  if length(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g')) < 8 then raise exception 'Informe o telefone com DDD.'; end if;
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('em', em, 'de', case when de_mim then 'oficina' else coalesce(nullif(nome, ''), 'cliente') end,
                                               'texto', texto, 'tipo', tipo,
                                               'entrega', case when de_mim then coalesce(entrega, 'enviada') end,
                                               'entregue_em', case when de_mim then entregue_em end,
                                               'lida_em', case when de_mim then lida_em end,
                                               'foto_guardada_ate', case when midia_path is not null then midia_expira end,
                                               'midia_nao_processada', midia_erro)) order by em), '[]'::jsonb), array_agg(id)
    into v, v_ids from (select * from public.whatsapp_mensagens where public.whatsapp_chave_tel(telefone) = v_chave
                  order by em desc limit least(greatest(coalesce(p_limite, 30), 1), 200)) t;
  if p_marcar_lidas then update public.whatsapp_mensagens set lida = true where id = any(v_ids) and not lida; end if;
  select * into v_cli from public.clientes where id = public.whatsapp_cliente_do_tel(p_telefone);
  return jsonb_build_object('telefone', p_telefone, 'mensagens', v,
    'cliente', case when v_cli.id is null then null else jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome) end,
    'cadastrado', v_cli.id is not null,
    'os_abertas', public.whatsapp_os_abertas(v_cli.id),
    'na_fila', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status, 'texto', left(texto, 120), 'erro', erro, 'criado_em', criado_em) order by id), '[]'::jsonb)
                  from public.whatsapp_fila where public.whatsapp_chave_tel(telefone) = v_chave and status in ('pendente', 'enviando', 'erro') and criado_em > now() - interval '7 days'),
    'pediu_parar', exists (select 1 from public.whatsapp_optout where telefone = v_chave),
    'sobre_a_entrega', 'entrega: enviada = chegou ao WhatsApp; entregue = chegou ao celular; lida = abriu (quem desligou a confirmação de leitura nunca aparece como lida); ouvida = áudio ouvido.');
end $$;

-- ---------------------------------------------------------------------
-- Mídia recebida (função zap, chave de servidor)
-- ---------------------------------------------------------------------
-- p: {msg_id, path, mime, transcricao, duracao_s, erro}. Áudio transcrito vira o texto da mensagem.
create or replace function public.whatsapp_guardar_midia(p jsonb) returns boolean
language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_mensagens; v_dur int := nullif(p ->> 'duracao_s', '')::int; v_rot text;
begin
  select * into v from public.whatsapp_mensagens where msg_id = p ->> 'msg_id' for update;
  if v.id is null then return false; end if;
  v_rot := case when v_dur is not null then ' ' || (v_dur / 60) || ':' || lpad((v_dur % 60)::text, 2, '0') else '' end;
  update public.whatsapp_mensagens
     set midia_path = coalesce(nullif(p ->> 'path', ''), midia_path),
         midia_tipo = coalesce(nullif(p ->> 'mime', ''), midia_tipo),
         midia_expira = case when nullif(p ->> 'path', '') is not null then now() + interval '30 days' else midia_expira end,
         duracao_s = coalesce(v_dur, duracao_s),
         transcricao = coalesce(nullif(p ->> 'transcricao', ''), transcricao),
         texto = case when nullif(btrim(p ->> 'transcricao'), '') is not null
                      then left('[áudio' || v_rot || '] ' || btrim(p ->> 'transcricao'), 4000) else texto end,
         midia_erro = case when nullif(p ->> 'erro', '') is not null then left(p ->> 'erro', 200) else null end
   where id = v.id;
  return true;
end $$;

-- fotos vencidas (a função zap apaga o arquivo e depois avisa com whatsapp_midia_apagada)
create or replace function public.whatsapp_midia_vencida(p_limite int default 200) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(midia_path), '{}') from (select midia_path from public.whatsapp_mensagens
   where midia_path is not null and midia_expira < now() order by midia_expira limit p_limite) t
$$;
create or replace function public.whatsapp_midia_apagada(p_paths text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.whatsapp_mensagens set midia_path = null where midia_path = any(p_paths);
  get diagnostics n = row_count; return n;
end $$;

-- ---------------------------------------------------------------------
-- Alertas
-- ---------------------------------------------------------------------
-- Número que recebe os avisos (administrador, pela tela). Vazio = só a faixa na tela.
create or replace function public.whatsapp_alerta_config(p_telefone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_tel text := regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g');
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no WhatsApp.'; end if;
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel <> '' and v_tel !~ '^55\d{10,11}$' then raise exception 'Telefone inválido: use DDD + número (ex.: 27 99999-0000).'; end if;
  update public.whatsapp_conexao set alerta_telefone = nullif(v_tel, '') where id = 1;
  return jsonb_build_object('alerta_telefone', nullif(v_tel, ''));
end $$;

-- põe um aviso automático na fila (respeita o horário de envio; sem PARAR, sem repetir)
create or replace function public.whatsapp_alerta_na_fila(p_texto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_tel text; v_id bigint;
begin
  select alerta_telefone into v_tel from public.whatsapp_conexao where id = 1;
  if coalesce(v_tel, '') = '' then return null; end if;
  if exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(v_tel)) then return null; end if;
  insert into public.whatsapp_fila (telefone, texto, cliente_nome, origem, pedido_por, fora_horario)
  values (v_tel, left(p_texto, 2000), 'Alerta do sistema', 'sistema', 'alerta automático do WhatsApp', false)
  returning id into v_id;
  return v_id;
end $$;

-- Conferência a cada 5 min (pg_cron). Atualiza whatsapp_conexao.alertas e devolve se a função zap deve ser
-- acordada (sem o motor: há mensagem para sair ou, no horário de envio, faz 15 min que ninguém buscou as recebidas).
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
  v_motor_vez := c.dono = 'android' and c.dono_ate > now();
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
  if v_vinc and not v_motor_vez and coalesce(c.situacao, '') <> 'pareando' and not (c.dono = 'supabase' and c.dono_ate > now()) then
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

-- resumo para o Claude e a tela (v25) + alertas abertos
create or replace function public.whatsapp_resumo() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c public.whatsapp_conexao;
begin
  if not public.e_admin() then raise exception 'Só o administrador vê o WhatsApp.'; end if;
  select * into c from public.whatsapp_conexao where id = 1;
  return jsonb_build_object(
    'situacao', c.situacao, 'numero', c.numero, 'detalhe', c.detalhe,
    'motor_do_android', case when c.motor_visto is null then 'nunca ligado'
                             when c.motor_visto > now() - interval '90 seconds' then case when (c.motor_info ->> 'conectado')::boolean then 'ligado e conectado' else 'ligado, sem conexão' end
                             else 'sem sinal desde ' || to_char(c.motor_visto at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') end,
    'envio_agora', case when c.dono = 'android' and c.dono_ate > now() then 'pelo motor do Android (na hora)'
                        else 'pelo Supabase sob demanda (alguns minutos de atraso)' end,
    'no_horario_de_envio', public.whatsapp_no_horario(c.regras), 'regras', c.regras,
    'fila', (select jsonb_build_object('pendentes', count(*) filter (where status = 'pendente'),
                                       'enviando', count(*) filter (where status = 'enviando'),
                                       'enviadas_hoje', count(*) filter (where status = 'enviada' and enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'),
                                       'com_erro_7_dias', count(*) filter (where status = 'erro' and criado_em > now() - interval '7 days'),
                                       'enviadas_7_dias_sem_entrega_24h', count(*) filter (where status = 'enviada' and enviada_em between now() - interval '7 days' and now() - interval '24 hours' and coalesce(entrega, 'enviada') = 'enviada'))
               from public.whatsapp_fila),
    'nao_lidas', (select count(*) from public.whatsapp_mensagens where not de_mim and not lida),
    'alertas', coalesce((select jsonb_agg(jsonb_build_object('tipo', key, 'texto', value ->> 'texto', 'desde', value ->> 'desde')) from jsonb_each(coalesce(c.alertas, '{}'::jsonb))), '[]'::jsonb),
    'alerta_telefone', c.alerta_telefone,
    'vigiado_em', c.vigiado_em,
    -- cliente escreveu por último e ninguém respondeu há mais de 2 h (últimos 3 dias)
    'sem_resposta', coalesce((select jsonb_agg(jsonb_build_object('telefone', u.telefone, 'cliente', cl.nome, 'nome_no_whatsapp', nullif(u.nome, ''),
                                                                  'ultima_em', u.em, 'ultima_mensagem', left(u.texto, 120)) order by u.em)
        from (select distinct on (public.whatsapp_chave_tel(m.telefone)) m.telefone, m.nome, m.em, m.texto, m.de_mim
                from public.whatsapp_mensagens m where m.telefone <> '' and m.em > now() - interval '3 days'
               order by public.whatsapp_chave_tel(m.telefone), m.em desc) u
        left join public.clientes cl on cl.id = public.whatsapp_cliente_do_tel(u.telefone)
       where not u.de_mim and u.em < now() - interval '2 hours'), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  -- internas: só a chave de servidor (função zap e agendamento)
  foreach f in array array['whatsapp_guardar_entrega(jsonb)', 'whatsapp_resultado(text, text, bigint, boolean, text, text, text)',
                           'whatsapp_alerta_na_fila(text)', 'whatsapp_vigiar()', 'whatsapp_guardar_midia(jsonb)',
                           'whatsapp_midia_vencida(int)', 'whatsapp_midia_apagada(text[])', 'whatsapp_cliente_do_tel(text)',
                           'whatsapp_os_abertas(uuid)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
  -- motor (confere a chave do motor)
  execute 'revoke all on function public.whatsapp_motor_entrega(text, text, jsonb) from public, authenticated';
  execute 'grant execute on function public.whatsapp_motor_entrega(text, text, jsonb) to anon, service_role';
  -- administrador (tela e conector; conferem e_admin)
  foreach f in array array['whatsapp_resumo()', 'whatsapp_mensagens_de(text, int, boolean)', 'whatsapp_alerta_config(text)',
                           'whatsapp_conversas(int, boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon';
    execute 'grant execute on function public.' || f || ' to authenticated, service_role';
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Agendamento: a cada 5 minutos confere o WhatsApp e, sem o motor, acorda a função zap
-- (mesmo segredo do agendamento da SEFAZ, v6).
-- ---------------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtcar-zap-vigia';
end $$;
select cron.schedule('dtcar-zap-vigia', '*/5 * * * *', $cron$
  select net.http_post(
    url := 'https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/zap',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dtcar-cron', (select valor from public.segredos where chave = 'cron')),
    body := '{"acao":"processar","origem":"agendamento"}'::jsonb,
    timeout_milliseconds := 30000)
  where (public.whatsapp_vigiar() ->> 'acordar')::boolean
$cron$);
-- fotos do WhatsApp com mais de 30 dias: apagadas uma vez por dia (03h17)
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtcar-zap-limpar-midia';
end $$;
select cron.schedule('dtcar-zap-limpar-midia', '17 6 * * *', $cron$
  select net.http_post(
    url := 'https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/zap',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dtcar-cron', (select valor from public.segredos where chave = 'cron')),
    body := '{"acao":"limpar_midia","origem":"agendamento"}'::jsonb,
    timeout_milliseconds := 30000)
  where exists (select 1 from public.whatsapp_mensagens where midia_path is not null and midia_expira < now())
$cron$);

notify pgrst, 'reload schema';
