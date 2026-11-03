-- =====================================================================
-- DTCar Gestão — v26: WhatsApp — envio para qualquer número.
--
-- Decisão do Danilo (03/11/2026): o número (27) 99247-0140 é exclusivo da oficina e quem decide para
-- quem a mensagem vai é ele. A fila deixa de exigir cliente cadastrado: aceita qualquer telefone com DDD.
-- Se o número for de um cliente cadastrado, o nome aparece na fila; se não for, vem só um aviso.
-- Continuam valendo: horário comercial, intervalo, limites por hora e por dia, sem link encurtado, sem
-- repetir a mesma mensagem em 10 min e quem responde PARAR não recebe mais.
--
-- Rode depois do v25. Pode rodar mais de uma vez. Só troca a função whatsapp_enfileirar.
-- =====================================================================

create or replace function public.whatsapp_enfileirar(p jsonb, p_gravar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_txt text := btrim(coalesce(p ->> 'texto', ''));
  v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
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
  if length(v_tel) in (10, 11) then v_tel := '55' || v_tel; end if;
  if v_tel !~ '^55\d{10,11}$' then v_erros := v_erros || 'Telefone inválido: use DDD + número (ex.: 27 99999-0000).'::text; end if;
  -- qualquer número com DDD (decisão do Danilo, 03/11/2026: o número é só da oficina e quem decide para quem
  -- vai é ele). Se o telefone for de um cliente cadastrado, a fila mostra o nome.
  if v_cli.id is null and v_tel ~ '^55\d{10,11}$' then
    select * into v_cli from public.clientes c
     where public.whatsapp_chave_tel(v_tel) in (public.whatsapp_chave_tel(c.telefone), public.whatsapp_chave_tel(c.telefone2), public.whatsapp_chave_tel(c.telefone3))
       and coalesce(c.telefone, '') || coalesce(c.telefone2, '') || coalesce(c.telefone3, '') <> ''
     order by c.atualizado_em desc nulls last limit 1;
    if v_cli.id is null then v_avisos := v_avisos || 'Número sem cadastro no sistema (vai assim mesmo).'::text; end if;
  elsif v_cli.id is not null and v_tel ~ '^55\d{10,11}$' and public.whatsapp_chave_tel(v_tel) not in (public.whatsapp_chave_tel(v_cli.telefone), public.whatsapp_chave_tel(v_cli.telefone2), public.whatsapp_chave_tel(v_cli.telefone3)) then
    v_avisos := v_avisos || ('O telefone informado não é o do cadastro de ' || v_cli.nome || ' (vai para o número informado).');
  end if;
  if v_txt = '' then v_erros := v_erros || 'Mensagem vazia.'::text; end if;
  if length(v_txt) > 2000 then v_erros := v_erros || 'Mensagem longa demais (máximo 2000 caracteres).'::text; end if;
  if v_txt ~* '(bit\.ly|tinyurl|cutt\.ly|goo\.gl|t\.co/|is\.gd|ow\.ly|encurtador|rebrand\.ly|shorturl)' then
    v_erros := v_erros || 'Sem link encurtado: use o endereço completo.'::text;
  end if;
  if exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(v_tel)) then
    v_erros := v_erros || 'Este número pediu para não receber mensagens (respondeu PARAR).'::text;
  end if;
  if exists (select 1 from public.whatsapp_fila f where public.whatsapp_chave_tel(f.telefone) = public.whatsapp_chave_tel(v_tel) and f.texto = v_txt
              and f.status in ('pendente', 'enviando', 'enviada') and f.criado_em > now() - interval '10 minutes') then
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
      'telefone', v_tel, 'cliente', jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome), 'ordem_numero', v_os.numero, 'texto', v_txt,
      'pendentes_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente'));
  end if;
  insert into public.whatsapp_fila (telefone, texto, cliente_id, cliente_nome, ordem_numero, origem, pedido_por, fora_horario)
  values (v_tel, v_txt, v_cli.id, coalesce(v_cli.nome, ''), v_os.numero, coalesce(nullif(p ->> 'origem', ''), 'claude'),
          left(coalesce(p ->> 'pedido', ''), 300), v_fora)
  returning id into v_id;
  return jsonb_build_object('gravado', true, 'id', v_id, 'avisos', to_jsonb(v_avisos), 'telefone', v_tel,
    'cliente', jsonb_build_object('id', v_cli.id, 'nome', v_cli.nome), 'ordem_numero', v_os.numero,
    'posicao_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente' and id <= v_id));
end $$;

revoke all on function public.whatsapp_enfileirar(jsonb, boolean) from public, anon;
grant execute on function public.whatsapp_enfileirar(jsonb, boolean) to authenticated, service_role;

notify pgrst, 'reload schema';
