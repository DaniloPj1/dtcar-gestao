-- ---------------------------------------------------------------------
-- v65 — Mensagem interna para GRUPO do WhatsApp (pedido do Danilo em 25/11/2026)
--
-- Até aqui o destino da fila era sempre um telefone (55 + DDD + número) e o motor montava
-- "<telefone>@s.whatsapp.net". O Danilo criou o grupo "Financeiro" no WhatsApp da oficina para
-- receber os resumos do financeiro e pediu a regra dele:
--
--   "Eu colocaria a regra para atender apenas grupos com o meu número e do meu sócio."
--
-- Então grupo NÃO é destino livre. Para uma mensagem sair para um grupo, tudo isto tem de valer:
--   1. o grupo está escolhido em Sistema › WhatsApp (cfg.zapGrupos.<apelido>, tabela config —
--      gravado pela TELA, nunca pelo conector, como o número dos avisos: proteção contra ordem
--      falsa vinda de e-mail ou mensagem);
--   2. os participantes conferidos na escolha são só números autorizados (cfg.zapGrupos.numeros:
--      o do Danilo e o do sócio) mais o próprio número da oficina;
--   3. na hora do envio, o motor (ou a função zap) lê os participantes do grupo no WhatsApp e
--      compara com a lista gravada: entrou ou saiu alguém, a mensagem NÃO sai e vira erro na fila
--      com o motivo. Essa é a conferência que vale — a de agora, não a de quando ele escolheu.
--
-- Mensagem de grupo é INTERNA (vai para o Danilo e o sócio, não para cliente): sai primeiro, não
-- conta nos limites por hora/dia dos clientes e respeita o silêncio de 22h–7h, como os avisos.
-- Conversa de grupo não é gravada em whatsapp_mensagens (a tela de conversas é de cliente; o
-- histórico do que saiu fica na própria fila).
--
-- Antes e depois da virada do período de transição o comportamento é o mesmo: não mexe em O.S.,
-- estoque, financeiro nem cadastro. whatsapp_fila e whatsapp_conexao já ficam fora do backup, do
-- banco do PC e do espelho, então não há nada a acrescentar nessas rotinas.
-- ---------------------------------------------------------------------

-- destino de grupo na fila (vazio = mensagem normal, por telefone)
alter table public.whatsapp_fila add column if not exists grupo_jid text;
comment on column public.whatsapp_fila.grupo_jid is 'JID do grupo do WhatsApp (…@g.us) quando a mensagem é para um grupo autorizado; vazio nas mensagens por telefone.';

-- última lista de grupos levantada no WhatsApp (o motor grava; a tela mostra para o Danilo escolher)
alter table public.whatsapp_conexao add column if not exists grupos jsonb;
comment on column public.whatsapp_conexao.grupos is 'Último levantamento dos grupos do WhatsApp da oficina: {em, lista:[{jid,nome,ids,numeros,autorizado,motivo}]}. Só para escolher o grupo na tela.';

-- ---------------------------------------------------------------------
-- O grupo escolhido na tela, com os números autorizados. null = não escolhido.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_grupo_escolhido(p_apelido text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g jsonb; cfg jsonb; v_ap text := lower(btrim(coalesce(p_apelido, '')));
begin
  if v_ap = '' or v_ap = 'numeros' then return null; end if;
  select dados -> 'zapGrupos' into cfg from public.config where id = 1;
  if cfg is null or jsonb_typeof(cfg) <> 'object' then return null; end if;
  g := cfg -> v_ap;
  if g is null or jsonb_typeof(g) <> 'object' then return null; end if;
  return g || jsonb_build_object('apelido', v_ap, 'autorizados', coalesce(cfg -> 'numeros', '[]'::jsonb));
end $$;

-- o mesmo, achado pelo JID (a fila guarda o JID, não o apelido)
create or replace function public.whatsapp_grupo_por_jid(p_jid text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare g jsonb; cfg jsonb;
begin
  if coalesce(p_jid, '') = '' then return null; end if;
  select dados -> 'zapGrupos' into cfg from public.config where id = 1;
  if cfg is null or jsonb_typeof(cfg) <> 'object' then return null; end if;
  select x.value || jsonb_build_object('apelido', x.key, 'autorizados', coalesce(cfg -> 'numeros', '[]'::jsonb))
    into g from jsonb_each(cfg) x
   where jsonb_typeof(x.value) = 'object' and x.value ->> 'jid' = p_jid limit 1;
  return g;
end $$;

grant execute on function public.whatsapp_grupo_escolhido(text) to authenticated;
grant execute on function public.whatsapp_grupo_por_jid(text) to authenticated;

-- ---------------------------------------------------------------------
-- Pôr na fila. Agora aceita p.grupo (apelido do grupo escolhido na tela) no lugar do telefone.
-- O resto é igual ao v36.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_enfileirar(p jsonb, p_gravar boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_txt text := btrim(coalesce(p ->> 'texto', ''));
  v_tel text := regexp_replace(coalesce(p ->> 'telefone', ''), '\D', '', 'g');
  v_arq jsonb := case when jsonb_typeof(p -> 'arquivo') = 'object' then p -> 'arquivo' end;
  v_modelo text := nullif(btrim(coalesce(p ->> 'modelo', '')), '');
  v_grupo text := lower(btrim(coalesce(p ->> 'grupo', '')));
  v_g jsonb; v_jid text := '';
  v_cli public.clientes; v_os public.ordens; v_r jsonb; v_erros text[] := '{}'; v_avisos text[] := '{}';
  v_id bigint; v_fora boolean := coalesce((p ->> 'fora_horario')::boolean, false); v_hoje int;
begin
  if not public.e_admin() then raise exception 'Só o administrador envia WhatsApp.'; end if;
  select regras into v_r from public.whatsapp_conexao where id = 1;

  -- ----- destino: grupo (interno) -----
  if v_grupo <> '' then
    if v_tel <> '' then v_erros := v_erros || 'Mande para o grupo OU para um telefone, não para os dois.'::text; end if;
    v_g := public.whatsapp_grupo_escolhido(v_grupo);
    if v_g is null then
      v_erros := v_erros || ('O grupo "' || v_grupo || '" não está escolhido em Sistema › WhatsApp (busque os grupos e escolha).');
    else
      v_jid := coalesce(v_g ->> 'jid', '');
      if v_jid !~ '^[0-9][0-9-]{4,}@g\.us$' then v_erros := v_erros || 'O grupo gravado está com endereço inválido: escolha de novo na tela.'::text; end if;
      if jsonb_array_length(coalesce(v_g -> 'ids', '[]'::jsonb)) = 0 then
        v_erros := v_erros || 'O grupo gravado está sem a lista de participantes conferida: busque os grupos de novo na tela.'::text;
      end if;
      if jsonb_array_length(coalesce(v_g -> 'autorizados', '[]'::jsonb)) = 0 then
        v_erros := v_erros || 'Cadastre os números autorizados (o seu e o do sócio) em Sistema › WhatsApp antes de mandar para grupo.'::text;
      end if;
    end if;
    if v_arq is not null then
      v_erros := v_erros || 'PDF em grupo ainda não: mande o PDF para um telefone.'::text; v_arq := null;
    end if;
    if v_modelo is not null then
      v_erros := v_erros || 'Modelo de mensagem da O.S. é para cliente, não para grupo: mande o texto.'::text;
    end if;
    if v_txt = '' then v_erros := v_erros || 'Mensagem vazia.'::text; end if;
    if length(v_txt) > 2000 then v_erros := v_erros || 'Mensagem longa demais (máximo 2000 caracteres).'::text; end if;
    if v_txt ~* '(bit\.ly|tinyurl|cutt\.ly|goo\.gl|t\.co/|is\.gd|ow\.ly|encurtador|rebrand\.ly|shorturl)' then
      v_erros := v_erros || 'Sem link encurtado: use o endereço completo.'::text;
    end if;
    -- mesma mensagem para o mesmo grupo em 10 minutos: não repete
    if v_jid <> '' and exists (select 1 from public.whatsapp_fila f
         where f.grupo_jid = v_jid and f.texto = v_txt
           and (f.status in ('pendente', 'enviando', 'enviada') or (f.status = 'erro' and f.msg_id is not null))
           and f.criado_em > now() - interval '10 minutes') then
      v_erros := v_erros || 'Esta mesma mensagem para este grupo já está na fila ou foi enviada há menos de 10 minutos.'::text;
    end if;
    if (select situacao from public.whatsapp_conexao where id = 1) <> 'conectado' then
      v_avisos := v_avisos || 'O WhatsApp da oficina não está conectado agora: a mensagem fica na fila até conectar.'::text;
    end if;
    if public.whatsapp_no_silencio(public.whatsapp_avisos_cfg()) and not v_fora then
      v_avisos := v_avisos || 'Silêncio da noite (22h–7h): a mensagem sai quando o silêncio acabar.'::text;
    end if;

    if array_length(v_erros, 1) > 0 or not p_gravar then
      return jsonb_build_object('gravado', false, 'erros', to_jsonb(v_erros), 'avisos', to_jsonb(v_avisos),
        'grupo', jsonb_build_object('apelido', v_grupo, 'nome', v_g ->> 'nome', 'jid', nullif(v_jid, ''),
                                    'participantes', jsonb_array_length(coalesce(v_g -> 'ids', '[]'::jsonb))),
        'texto', v_txt, 'interno', true,
        'pendentes_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente'));
    end if;
    insert into public.whatsapp_fila (telefone, grupo_jid, texto, cliente_nome, origem, pedido_por, fora_horario, interno)
    values ('', v_jid, v_txt, left('Grupo ' || coalesce(v_g ->> 'nome', v_grupo), 120),
            coalesce(nullif(p ->> 'origem', ''), 'claude'), left(coalesce(p ->> 'pedido', ''), 300), v_fora, true)
    returning id into v_id;
    return jsonb_build_object('gravado', true, 'id', v_id, 'avisos', to_jsonb(v_avisos), 'interno', true,
      'grupo', jsonb_build_object('apelido', v_grupo, 'nome', v_g ->> 'nome', 'jid', v_jid),
      'posicao_na_fila', (select count(*) from public.whatsapp_fila where status = 'pendente' and id <= v_id));
  end if;

  -- ----- destino: telefone (igual ao v36) -----
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
  if exists (select 1 from public.whatsapp_fila f where coalesce(f.grupo_jid, '') = '' and public.whatsapp_chave_tel(f.telefone) = public.whatsapp_chave_tel(v_tel) and f.texto = v_txt
              and coalesce(f.arquivo ->> 'nome', '') = coalesce(v_arq ->> 'nome', '')
              and (f.status in ('pendente', 'enviando', 'enviada') or (f.status = 'erro' and f.msg_id is not null)) and f.criado_em > now() - interval '10 minutes') then
    v_erros := v_erros || 'Esta mesma mensagem para este número já está na fila ou foi enviada há menos de 10 minutos.'::text;
  end if;
  select count(*) into v_hoje from public.whatsapp_fila
   where status in ('pendente', 'enviando', 'enviada') and not interno and criado_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo';
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
-- Próxima mensagem da fila. Igual ao v36, com duas diferenças:
--  * mensagem de grupo leva o JID, a lista de participantes conferida e os números autorizados,
--    para quem envia conferir o grupo AGORA, antes de mandar;
--  * grupo que saiu da escolha da tela não é enviado: vira erro na fila.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_pegar_proxima(p_dono text, p_id text, p_com_arquivo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_conexao; v public.whatsapp_fila; v_hora int; v_dia int; v_no boolean; v_lim boolean; v_sil boolean; v_int boolean; v_g jsonb;
begin
  select * into c from public.whatsapp_conexao where id = 1 for update;
  if not (c.dono = p_dono and c.dono_id = p_id and c.dono_ate > now()) then return jsonb_build_object('motivo', 'sem a vez'); end if;
  -- "enviando" esquecida (quem pegou caiu no meio): não reenvia sozinho — pode ter saído. Marca para conferir.
  update public.whatsapp_fila set status = 'erro', erro = 'Envio não confirmado (a conexão caiu no meio). Confira no WhatsApp antes de mandar de novo.'
   where status = 'enviando' and pego_em < now() - interval '5 minutes';
  if c.proximo_envio is not null and c.proximo_envio > now() then
    return jsonb_build_object('motivo', 'intervalo', 'proximo_envio', c.proximo_envio);
  end if;
  -- limites por hora/dia valem para os clientes; as mensagens internas (celular do Danilo, grupo) não contam
  select count(*) filter (where enviada_em > now() - interval '1 hour'),
         count(*) filter (where enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    into v_hora, v_dia from public.whatsapp_fila where status = 'enviada' and not interno and enviada_em > now() - interval '1 day';
  v_lim := v_hora >= coalesce((c.regras ->> 'por_hora')::int, 20) or v_dia >= coalesce((c.regras ->> 'por_dia')::int, 80);
  -- pendente de quem pediu PARAR depois de entrar na fila: não sai (vale também para as internas: o número de alerta
  -- pode ter pedido PARAR antes de ser escolhido como alerta). Mensagem de grupo não tem telefone: fica fora.
  update public.whatsapp_fila f set status = 'cancelada', erro = 'O número pediu para não receber mensagens (PARAR).'
   where f.status = 'pendente' and coalesce(f.grupo_jid, '') = ''
     and exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(f.telefone));
  v_no := public.whatsapp_no_horario(c.regras);
  -- interna fora do horário: o silêncio (22h–7h) é conferido agora, na retirada (não só quando entrou na fila)
  v_sil := public.whatsapp_no_silencio(public.whatsapp_avisos_cfg());
  v_int := coalesce((public.whatsapp_avisos_cfg() ->> 'fora_horario')::boolean, true) and not v_sil;
  -- no silêncio, as internas liberadas fora do horário voltam a esperar (assim o alerta "fila parada" do v32 não acusa à toa);
  -- quando o silêncio acaba, saem mesmo fora do horário comercial (aviso de sábado 23h sai domingo 7h, não segunda 8h)
  if v_sil then
    update public.whatsapp_fila set fora_horario = false where status = 'pendente' and interno and fora_horario;
  end if;
  select * into v from public.whatsapp_fila
   where status = 'pendente' and (v_no or (fora_horario and not (interno and v_sil)) or (interno and v_int)) and (p_com_arquivo or arquivo is null)
     and (liberar_em is null or liberar_em <= now()) and (interno or not v_lim)
   order by interno desc, id limit 1 for update skip locked;
  if v.id is null then
    return jsonb_build_object('motivo', case when v_hora >= coalesce((c.regras ->> 'por_hora')::int, 20) then 'limite por hora'
                                             when v_dia >= coalesce((c.regras ->> 'por_dia')::int, 80) then 'limite do dia'
                                             when v_no then 'fila vazia' else 'fora do horário' end);
  end if;
  -- grupo: só sai se continuar escolhido na tela (ele pode ter trocado ou apagado depois de a mensagem entrar na fila)
  if coalesce(v.grupo_jid, '') <> '' then
    v_g := public.whatsapp_grupo_por_jid(v.grupo_jid);
    if v_g is null or jsonb_array_length(coalesce(v_g -> 'ids', '[]'::jsonb)) = 0 then
      update public.whatsapp_fila set status = 'erro',
             erro = 'O grupo não está mais escolhido em Sistema › WhatsApp: a mensagem não foi enviada.' where id = v.id;
      return jsonb_build_object('motivo', 'grupo sem autorização');
    end if;
  end if;
  update public.whatsapp_fila set status = 'enviando', pego_em = now(), pego_por = p_dono where id = v.id;
  return jsonb_build_object('mensagem', jsonb_build_object('id', v.id, 'telefone', v.telefone, 'texto', v.texto,
    'grupo', case when coalesce(v.grupo_jid, '') <> '' then jsonb_build_object('jid', v.grupo_jid, 'nome', v_g ->> 'nome',
                                                                               'ids', coalesce(v_g -> 'ids', '[]'::jsonb),
                                                                               'numeros', coalesce(v_g -> 'autorizados', '[]'::jsonb)) end,
    'arquivo', case when v.arquivo is not null then jsonb_build_object('path', v.arquivo ->> 'path', 'nome', v.arquivo ->> 'nome',
                                                                       'tipo', v.arquivo ->> 'tipo', 'bytes', (v.arquivo ->> 'bytes')::int) end));
end $$;

-- ---------------------------------------------------------------------
-- Resultado do envio. Igual ao v38, mas conversa de GRUPO não entra em whatsapp_mensagens
-- (a tela de conversas é de cliente; o que saiu para o grupo fica registrado na própria fila).
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_resultado(p_dono text, p_id text, p_fila_id bigint, p_ok boolean, p_msg_id text, p_jid text, p_erro text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_fila; r jsonb; a int; b int; v_txt text; v_pacote boolean := false;
begin
  update public.whatsapp_fila set status = case when p_ok then 'enviada' else 'erro' end,
         enviada_em = case when p_ok then now() end, msg_id = p_msg_id, erro = case when p_ok then null else left(p_erro, 300) end,
         entrega = case when p_ok then coalesce(entrega, 'enviada') end
   where id = p_fila_id and status = 'enviando' and pego_por = p_dono returning * into v;
  if v.id is null then return; end if;
  if p_ok and coalesce(v.grupo_jid, '') = '' then
    -- na conversa: o texto; mensagem só com PDF aparece como "[documento] nome.pdf"
    v_txt := case when v.texto <> '' then v.texto else '[documento] ' || coalesce(v.arquivo ->> 'nome', '') end;
    insert into public.whatsapp_mensagens (msg_id, jid, telefone, de_mim, texto, tipo, em, fila_id, lida, entrega)
    values (p_msg_id, coalesce(nullif(p_jid, ''), v.telefone || '@s.whatsapp.net'), v.telefone, true, v_txt,
            case when v.texto <> '' then 'texto' else 'documento' end, now(), v.id, true, 'enviada')
    on conflict (msg_id) do update set fila_id = excluded.fila_id, entrega = coalesce(public.whatsapp_mensagens.entrega, 'enviada');
  end if;
  if p_ok then v_pacote := public.whatsapp_pacote_segue(v); end if;
  if v_pacote then
    update public.whatsapp_conexao set proximo_envio = now() + interval '3 seconds' where id = 1;
    return;
  end if;
  select regras into r from public.whatsapp_conexao where id = 1;
  a := coalesce((r ->> 'intervalo_min')::int, 25); b := greatest(a, coalesce((r ->> 'intervalo_max')::int, 70));
  update public.whatsapp_conexao set proximo_envio = now() + make_interval(secs => a + floor(random() * (b - a + 1))) where id = 1;
end $$;

-- ---------------------------------------------------------------------
-- Pacote (v38): mensagens seguidas para o MESMO destino saem com 3 s. Agora o destino pode ser um
-- grupo, e grupo só faz pacote com o mesmo grupo (duas mensagens de grupo têm telefone vazio).
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_pacote_segue(p_ant public.whatsapp_fila) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare prox public.whatsapp_fila; c public.whatsapp_conexao; n int; v_hora int; v_dia int;
begin
  if p_ant.id is null or p_ant.status <> 'enviada' then return false; end if;
  select * into prox from public.whatsapp_fila
   where status = 'pendente' and (liberar_em is null or liberar_em <= now())
   order by interno desc, id limit 1;
  if prox.id is null or prox.telefone <> p_ant.telefone or coalesce(prox.grupo_jid, '') <> coalesce(p_ant.grupo_jid, '')
     or prox.criado_em > p_ant.criado_em + interval '5 minutes' then return false; end if;
  select * into c from public.whatsapp_conexao where id = 1;
  if coalesce(prox.grupo_jid, '') = ''
     and exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(prox.telefone)) then return false; end if;
  if not (public.whatsapp_no_horario(c.regras)
          or (prox.fora_horario and not (prox.interno and public.whatsapp_no_silencio(public.whatsapp_avisos_cfg())))) then
    return false;
  end if;
  if not prox.interno then
    select count(*) filter (where enviada_em > now() - interval '1 hour'),
           count(*) filter (where enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
      into v_hora, v_dia from public.whatsapp_fila where status = 'enviada' and not interno and enviada_em > now() - interval '1 day';
    if v_hora >= coalesce((c.regras ->> 'por_hora')::int, 20) or v_dia >= coalesce((c.regras ->> 'por_dia')::int, 80) then return false; end if;
  end if;
  select count(*) into n from public.whatsapp_fila
   where status = 'enviada' and telefone = p_ant.telefone and coalesce(grupo_jid, '') = coalesce(p_ant.grupo_jid, '')
     and enviada_em > now() - interval '5 minutes';
  return n < 6;
end $$;

-- ---------------------------------------------------------------------
-- Levantar os grupos do WhatsApp: a tela pede, quem está com a vez lista e grava.
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_pedir_grupos() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v public.whatsapp_conexao;
begin
  if not public.e_admin() then raise exception 'Só o administrador busca os grupos do WhatsApp.'; end if;
  update public.whatsapp_conexao set pedido = 'grupos', detalhe = 'Buscando os grupos do WhatsApp…', atualizado_em = now()
   where id = 1 returning * into v;
  return jsonb_build_object('pedido', v.pedido, 'motor_visto', v.motor_visto, 'situacao', v.situacao);
end $$;

-- o motor (ou a função zap) grava a lista levantada e conclui o pedido
-- p_lista: [{jid, nome, participantes, ids, numeros, autorizado, motivo}]
create or replace function public.whatsapp_grupos_gravar(p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  update public.whatsapp_conexao
     set grupos = jsonb_build_object('em', now(), 'lista', coalesce(p_lista, '[]'::jsonb)),
         pedido = case when pedido = 'grupos' then null else pedido end,
         atualizado_em = now()
   where id = 1;
  return jsonb_build_object('gravados', jsonb_array_length(coalesce(p_lista, '[]'::jsonb)));
end $$;

-- números autorizados (o do Danilo e o do sócio) para o motor conferir o grupo. O motor não lê a
-- tabela config (é do administrador): pede por aqui, com a chave do motor.
create or replace function public.whatsapp_motor_autorizados(p_chave text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.whatsapp_motor_conferir(p_chave);
  select coalesce(dados -> 'zapGrupos' -> 'numeros', '[]'::jsonb) into v from public.config where id = 1;
  return coalesce(v, '[]'::jsonb);
end $$;

create or replace function public.whatsapp_motor_grupos(p_chave text, p_id text, p_lista jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_com_vez(p_chave, p_id);
  return public.whatsapp_grupos_gravar(p_lista);
end $$;

revoke all on function public.whatsapp_grupos_gravar(jsonb) from public, authenticated;
revoke all on function public.whatsapp_motor_grupos(text, text, jsonb) from public, authenticated;
revoke all on function public.whatsapp_motor_autorizados(text) from public, authenticated;
grant execute on function public.whatsapp_pedir_grupos() to authenticated;

-- ---------------------------------------------------------------------
-- Conferência (rodar depois do deploy): a coluna existe e o grupo não autorizado é recusado.
--   select public.whatsapp_enfileirar('{"grupo":"financeiro","texto":"teste"}'::jsonb, false);
-- Sem grupo escolhido na tela, a resposta traz o erro "não está escolhido em Sistema › WhatsApp".
-- ---------------------------------------------------------------------
