-- =====================================================================
-- DTCar Gestão — v34: WhatsApp, etapa 4 — PDF da O.S./orçamento/boleto pela fila e modelos de mensagem.
--
-- Pedido do Danilo (plano do WhatsApp próprio, etapa 4; começada em 05/11/2026).
--  1. A fila do WhatsApp passa a levar UM arquivo (PDF) junto da mensagem: coluna "arquivo"
--     {path, nome, tipo, bytes, origem}. O PDF é gerado pela função "email" (os mesmos js/pdf.js e js/boletopdf.js do site)
--     e guardado na pasta privada "whatsapp-envio" — só a chave de servidor lê e grava (funções zap e email).
--     O motor do Android baixa por um link temporário que a função zap só dá para a mensagem que ele pegou ("enviando").
--     Com texto e arquivo: sai o texto (com "digitando…") e, logo depois, o PDF. Só arquivo: sai o PDF sozinho.
--  2. "modelo": nome do modelo de mensagem usado (js/mensagens.js: entrada, orcamento, adicionais, pronto, entrega, cobranca,
--     boas_vindas), só para o histórico. O texto é montado pela função "email" a partir dos dados da O.S.
--  3. PDFs com mais de 30 dias saem da pasta (agendamento diário que já limpa as fotos do WhatsApp).
-- Continuam valendo todas as regras da fila (horário, intervalo, limites, PARAR, sem repetir em 10 min).
-- ORDEM SEGURA: mensagem com PDF só sai por quem sabe enviar PDF (zap nova, motor 3.2). Zap antiga/motor 3.1 não a recebem;
-- ela fica na fila até a zap nova ser publicada ou o motor atualizar (etiqueta motor-v3.2).
--
-- Rode depois do v32 (e do v33). Pode rodar mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Colunas novas na fila
-- ---------------------------------------------------------------------
alter table public.whatsapp_fila add column if not exists arquivo jsonb;   -- {path, nome, tipo, bytes, origem, apagado?}
alter table public.whatsapp_fila add column if not exists modelo text;
-- mensagem só com o PDF (sem texto) passa a valer
alter table public.whatsapp_fila drop constraint if exists whatsapp_fila_texto_check;
alter table public.whatsapp_fila drop constraint if exists whatsapp_fila_texto_ou_arquivo;
alter table public.whatsapp_fila add constraint whatsapp_fila_texto_ou_arquivo
  check (length(texto) <= 2000 and (length(texto) >= 1 or arquivo is not null));

-- ---------------------------------------------------------------------
-- 2. Pasta privada dos PDFs enviados (sem política para o site: só a chave de servidor mexe)
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('whatsapp-envio', 'whatsapp-envio', false, 5242880, array['application/pdf'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['application/pdf'];

-- caminho que a função "email" grava: AAAA/MM/<uuid>.pdf
create or replace function public.whatsapp_arquivo_valido(a jsonb) returns boolean
language sql immutable as $$
  select a is not null and jsonb_typeof(a) = 'object'
     and coalesce(a ->> 'path', '') ~ '^\d{4}/\d{2}/[0-9a-f-]{36}\.pdf$'
     and coalesce(a ->> 'tipo', '') = 'application/pdf'
     and length(coalesce(a ->> 'nome', '')) between 5 and 120 and (a ->> 'nome') ~* '\.pdf$' and (a ->> 'nome') !~ '[\\/:*?"<>|\r\n]'
     and coalesce(a ->> 'bytes', '') ~ '^\d{1,7}$' and (a ->> 'bytes')::int between 1 and 5242880
$$;

-- ---------------------------------------------------------------------
-- 3. Pôr na fila (v26 + arquivo e modelo)
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_enfileirar(p jsonb, p_gravar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_txt text := btrim(coalesce(p ->> 'texto', ''));
  v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
  v_arq jsonb := case when jsonb_typeof(p -> 'arquivo') = 'object' then p -> 'arquivo' end;
  v_modelo text := nullif(btrim(coalesce(p ->> 'modelo', '')), '');
  v_cli public.clientes; v_os public.ordens; v_r jsonb; v_erros text[] := '{}'; v_avisos text[] := '{}';
  v_id bigint; v_fora boolean := coalesce((p ->> 'fora_horario')::boolean, false); v_hoje int;
begin
  if not public.e_admin() then raise exception 'Só o administrador envia WhatsApp.'; end if;
  select regras into v_r from public.whatsapp_conexao where id = 1;
  if nullif(p ->> 'ordem_numero', '') is not null then
    select * into v_os from public.ordens where numero = (p ->> 'ordem_numero')::int;
    if v_os.id is null then v_erros := v_erros || ('O.S. ' || (p ->> 'ordem_numero') || ' não encontrada.'); end if;
  end if;
  if nullif(p ->> 'cliente_id', '') is not null then
    select * into v_cli from public.clientes where id = (p ->> 'cliente_id')::uuid;
  elsif v_os.cliente_id is not null then
    select * into v_cli from public.clientes where id = v_os.cliente_id;
  end if;
  if v_tel = '' and v_cli.id is not null then v_tel := regexp_replace(coalesce(nullif(v_cli.telefone, ''), v_cli.telefone2, ''), '\D', '', 'g'); end if;
  -- O.S. com cliente que não está no cadastro (cópia na O.S.): usa o telefone da O.S.
  if v_tel = '' and v_os.id is not null then v_tel := regexp_replace(coalesce(v_os.cliente ->> 'telefone', ''), '\D', '', 'g'); end if;
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel !~ '^55\d{10,11}$' then v_erros := v_erros || 'Telefone inválido: use DDD + número (ex.: 27 99999-0000).'::text; end if;
  -- qualquer número com DDD (v26). Se o telefone for de um cliente cadastrado, a fila mostra o nome.
  if v_cli.id is null and v_tel ~ '^55\d{10,11}$' then
    select * into v_cli from public.clientes c
     where public.whatsapp_chave_tel(v_tel) in (public.whatsapp_chave_tel(c.telefone), public.whatsapp_chave_tel(c.telefone2), public.whatsapp_chave_tel(c.telefone3))
       and coalesce(c.telefone, '') || coalesce(c.telefone2, '') || coalesce(c.telefone3, '') <> ''
     order by c.atualizado_em desc nulls last limit 1;
    if v_cli.id is null then v_avisos := v_avisos || 'Número sem cadastro no sistema (vai assim mesmo).'::text; end if;
  elsif v_cli.id is not null and v_tel ~ '^55\d{10,11}$' and public.whatsapp_chave_tel(v_tel) not in (public.whatsapp_chave_tel(v_cli.telefone), public.whatsapp_chave_tel(v_cli.telefone2), public.whatsapp_chave_tel(v_cli.telefone3)) then
    v_avisos := v_avisos || ('O telefone informado não é o do cadastro de ' || v_cli.nome || ' (vai para o número informado).');
  end if;
  if v_arq is not null and not public.whatsapp_arquivo_valido(v_arq) then
    v_erros := v_erros || 'Arquivo inválido: o PDF tem de ser gerado pelo sistema.'::text; v_arq := null;
  end if;
  -- só na hora de gravar o PDF já está na pasta (na prévia ele ainda não foi guardado)
  if v_arq is not null and p_gravar and not exists (select 1 from storage.objects o where o.bucket_id = 'whatsapp-envio' and o.name = v_arq ->> 'path') then
    v_erros := v_erros || 'O PDF não está na pasta do WhatsApp (gere de novo).'::text;
  end if;
  if v_txt = '' and v_arq is null then v_erros := v_erros || 'Mensagem vazia.'::text; end if;
  if length(v_txt) > 2000 then v_erros := v_erros || 'Mensagem longa demais (máximo 2000 caracteres).'::text; end if;
  if v_txt ~* '(bit\.ly|tinyurl|cutt\.ly|goo\.gl|t\.co/|is\.gd|ow\.ly|encurtador|rebrand\.ly|shorturl)' then
    v_erros := v_erros || 'Sem link encurtado: use o endereço completo.'::text;
  end if;
  if v_tel ~ '^55\d{10,11}$' and exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(v_tel)) then
    v_erros := v_erros || 'Este número pediu para não receber mensagens (respondeu PARAR).'::text;
  end if;
  -- dois pedidos ao mesmo tempo para o mesmo número: um espera o outro (a conferência de repetição vale para os dois)
  if p_gravar and v_tel ~ '^55\d{10,11}$' then perform pg_advisory_xact_lock(hashtext('dtcar-zap-fila:' || public.whatsapp_chave_tel(v_tel))); end if;
  -- mesma mensagem (texto e nome do arquivo) para o mesmo número em 10 minutos: não repete
  -- (inclui a que deu erro depois de o texto sair: msg_id gravado)
  if exists (select 1 from public.whatsapp_fila f where public.whatsapp_chave_tel(f.telefone) = public.whatsapp_chave_tel(v_tel) and f.texto = v_txt
              and coalesce(f.arquivo ->> 'nome', '') = coalesce(v_arq ->> 'nome', '')
              and (f.status in ('pendente', 'enviando', 'enviada') or (f.status = 'erro' and f.msg_id is not null)) and f.criado_em > now() - interval '10 minutes') then
    v_erros := v_erros || 'Esta mesma mensagem para este número já está na fila ou foi enviada há menos de 10 minutos.'::text;
  end if;
  select count(*) into v_hoje from public.whatsapp_fila
   where status in ('pendente', 'enviando', 'enviada') and criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
  if v_hoje >= coalesce((v_r ->> 'por_dia')::int, 80) then v_erros := v_erros || ('Limite do dia atingido (' || v_hoje || ' mensagens).'); end if;
  if not public.whatsapp_no_horario(v_r) and not v_fora then
    v_avisos := v_avisos || 'Fora do horário comercial: a mensagem sai no próximo horário de envio (para mandar agora, só com ordem do Danilo: fora_horario).'::text;
  end if;
  if (select situacao from public.whatsapp_conexao where id = 1) <> 'conectado' then
    v_avisos := v_avisos || 'O WhatsApp da oficina não está conectado agora: a mensagem fica na fila até conectar.'::text;
  end if;

  if array_length(v_erros, 1) > 0 or not p_gravar then
    return jsonb_build_object('gravado', false, 'erros', to_jsonb(v_erros), 'avisos', to_jsonb(v_avisos),
      'telefone', v_tel, 'cliente', jsonb_build_object('id', v_cli.id, 'nome', coalesce(v_cli.nome, v_os.cliente ->> 'nome')), 'ordem_numero', v_os.numero, 'texto', v_txt,
      'arquivo', case when v_arq is not null then jsonb_build_object('nome', v_arq ->> 'nome', 'kb', greatest(1, round((v_arq ->> 'bytes')::numeric / 1024)), 'origem', v_arq ->> 'origem') end,
      'modelo', v_modelo, 'pendentes_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente'));
  end if;
  insert into public.whatsapp_fila (telefone, texto, cliente_id, cliente_nome, ordem_numero, origem, pedido_por, fora_horario, arquivo, modelo)
  values (v_tel, v_txt, v_cli.id, coalesce(v_cli.nome, v_os.cliente ->> 'nome', ''), v_os.numero, coalesce(nullif(p ->> 'origem', ''), 'claude'),
          left(coalesce(p ->> 'pedido', ''), 300), v_fora,
          case when v_arq is not null then jsonb_build_object('path', v_arq ->> 'path', 'nome', v_arq ->> 'nome', 'tipo', 'application/pdf',
                                                             'bytes', (v_arq ->> 'bytes')::int, 'origem', left(coalesce(v_arq ->> 'origem', ''), 200)) end,
          v_modelo)
  returning id into v_id;
  return jsonb_build_object('gravado', true, 'id', v_id, 'avisos', to_jsonb(v_avisos), 'telefone', v_tel,
    'cliente', jsonb_build_object('id', v_cli.id, 'nome', coalesce(v_cli.nome, v_os.cliente ->> 'nome')), 'ordem_numero', v_os.numero,
    'arquivo', case when v_arq is not null then v_arq ->> 'nome' end, 'modelo', v_modelo,
    'posicao_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente' and id <= v_id));
end $$;

-- ---------------------------------------------------------------------
-- 4. Pegar a próxima (v25 + o arquivo vai junto) e gravar o resultado (v32 + registro do PDF na conversa)
-- ---------------------------------------------------------------------
-- Só quem sabe enviar PDF (zap nova e motor 3.2+) passa p_com_arquivo = true. A zap antiga e o motor 3.1 continuam
-- chamando sem ele e NÃO recebem mensagem com PDF (senão mandariam só o texto, sem o PDF): ela espera quem saiba.
drop function if exists public.whatsapp_pegar_proxima(text, text);
create or replace function public.whatsapp_pegar_proxima(p_dono text, p_id text, p_com_arquivo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_conexao; v public.whatsapp_fila; v_hora int; v_dia int; v_no boolean;
begin
  select * into c from public.whatsapp_conexao where id = 1 for update;
  if not (c.dono = p_dono and c.dono_id = p_id and c.dono_ate > now()) then return jsonb_build_object('motivo', 'sem a vez'); end if;
  -- "enviando" esquecida (quem pegou caiu no meio): não reenvia sozinho — pode ter saído. Marca para conferir.
  update public.whatsapp_fila set status = 'erro', erro = 'Envio não confirmado (a conexão caiu no meio). Confira no WhatsApp antes de mandar de novo.'
   where status = 'enviando' and pego_em < now() - interval '5 minutes';
  if c.proximo_envio is not null and c.proximo_envio > now() then
    return jsonb_build_object('motivo', 'intervalo', 'proximo_envio', c.proximo_envio);
  end if;
  select count(*) filter (where enviada_em > now() - interval '1 hour'),
         count(*) filter (where enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    into v_hora, v_dia from public.whatsapp_fila where status = 'enviada' and enviada_em > now() - interval '1 day';
  if v_hora >= coalesce((c.regras ->> 'por_hora')::int, 20) then return jsonb_build_object('motivo', 'limite por hora'); end if;
  if v_dia >= coalesce((c.regras ->> 'por_dia')::int, 80) then return jsonb_build_object('motivo', 'limite do dia'); end if;
  -- pendente de quem pediu PARAR depois de entrar na fila: não sai
  update public.whatsapp_fila f set status = 'cancelada', erro = 'O cliente pediu para não receber mensagens (PARAR).'
   where f.status = 'pendente' and exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(f.telefone));
  v_no := public.whatsapp_no_horario(c.regras);
  select * into v from public.whatsapp_fila
   where status = 'pendente' and (v_no or fora_horario) and (p_com_arquivo or arquivo is null)
   order by id limit 1 for update skip locked;
  if v.id is null then return jsonb_build_object('motivo', case when v_no then 'fila vazia' else 'fora do horário' end); end if;
  update public.whatsapp_fila set status = 'enviando', pego_em = now(), pego_por = p_dono where id = v.id;
  return jsonb_build_object('mensagem', jsonb_build_object('id', v.id, 'telefone', v.telefone, 'texto', v.texto,
    'arquivo', case when v.arquivo is not null then jsonb_build_object('path', v.arquivo ->> 'path', 'nome', v.arquivo ->> 'nome',
                                                                       'tipo', v.arquivo ->> 'tipo', 'bytes', (v.arquivo ->> 'bytes')::int) end));
end $$;

create or replace function public.whatsapp_resultado(p_dono text, p_id text, p_fila_id bigint, p_ok boolean, p_msg_id text, p_jid text, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_fila; r jsonb; a int; b int; v_txt text;
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
  end if;
  select regras into r from public.whatsapp_conexao where id = 1;
  a := coalesce((r ->> 'intervalo_min')::int, 25); b := greatest(a, coalesce((r ->> 'intervalo_max')::int, 70));
  update public.whatsapp_conexao set proximo_envio = now() + make_interval(secs => a + floor(random() * (b - a + 1))) where id = 1;
end $$;

drop function if exists public.whatsapp_motor_proxima(text, text);
create or replace function public.whatsapp_motor_proxima(p_chave text, p_id text, p_com_arquivo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_com_vez(p_chave, p_id);
  return public.whatsapp_pegar_proxima('android', p_id, p_com_arquivo);
end $$;

-- O motor pede o PDF da mensagem que pegou: a função zap confere aqui (chave do motor + mensagem "enviando" pelo motor)
-- e só então dá o link temporário. Devolve o caminho na pasta, ou erro.
create or replace function public.whatsapp_motor_arquivo(p_chave text, p_fila_id bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_fila;
begin
  perform public.whatsapp_motor_conferir(p_chave);
  select * into v from public.whatsapp_fila where id = p_fila_id;
  if v.id is null or v.status <> 'enviando' or v.pego_por <> 'android' or v.pego_em < now() - interval '5 minutes' then
    raise exception 'Mensagem % não está sendo enviada pelo motor.', p_fila_id;
  end if;
  if v.arquivo is null or coalesce((v.arquivo ->> 'apagado')::boolean, false) then raise exception 'Mensagem % sem arquivo.', p_fila_id; end if;
  return jsonb_build_object('path', v.arquivo ->> 'path', 'nome', v.arquivo ->> 'nome', 'tipo', v.arquivo ->> 'tipo', 'bytes', (v.arquivo ->> 'bytes')::int);
end $$;

-- ---------------------------------------------------------------------
-- 5. Limpeza: PDFs com mais de 30 dias (inclusive os gerados e não enviados)
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_envio_vencido(p_limite int default 200) returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(name), '{}') from (
    select o.name from storage.objects o
     where o.bucket_id = 'whatsapp-envio' and o.created_at < now() - interval '30 days'
     order by o.created_at limit least(greatest(coalesce(p_limite, 200), 1), 1000)) x
$$;
create or replace function public.whatsapp_envio_apagado(p_paths text[]) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update public.whatsapp_fila set arquivo = arquivo || jsonb_build_object('apagado', true)
   where arquivo ->> 'path' = any(p_paths) and not coalesce((arquivo ->> 'apagado')::boolean, false);
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Permissões
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['whatsapp_pegar_proxima(text, text, boolean)', 'whatsapp_resultado(text, text, bigint, boolean, text, text, text)',
                           'whatsapp_envio_vencido(int)', 'whatsapp_envio_apagado(text[])', 'whatsapp_motor_arquivo(text, bigint)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
  execute 'revoke all on function public.whatsapp_motor_proxima(text, text, boolean) from public, authenticated';
  execute 'grant execute on function public.whatsapp_motor_proxima(text, text, boolean) to anon, service_role';
  execute 'revoke all on function public.whatsapp_arquivo_valido(jsonb) from public, anon';
  execute 'revoke all on function public.whatsapp_enfileirar(jsonb, boolean) from public, anon';
  execute 'grant execute on function public.whatsapp_enfileirar(jsonb, boolean) to authenticated, service_role';
  execute 'grant execute on function public.whatsapp_arquivo_valido(jsonb) to authenticated, service_role';
end $$;

-- ---------------------------------------------------------------------
-- Agendamento: a limpeza diária das fotos (v32) passa a limpar também os PDFs enviados
-- ---------------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;
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
     or exists (select 1 from storage.objects where bucket_id = 'whatsapp-envio' and created_at < now() - interval '30 days')
$cron$);

notify pgrst, 'reload schema';
