-- =====================================================================
-- DTCar Gestão — v36: WhatsApp — aviso de resposta, resposta pelo WhatsApp do Danilo com texto revisado
-- pela IA e resumo das mensagens (pedido do Danilo, 05/11/2026).
--
-- Objetivo: saber quando o cliente responde e responder pelo próprio WhatsApp, sem gastar o plano do Claude
-- com conferências agendadas. Quem fica "de olho" é o motor do tablet (já recebe tudo); o banco decide.
--
-- 1) VIGIA DE 48 HORAS: toda mensagem que a oficina manda para um número (pela fila ou pelo próprio celular)
--    abre (ou renova) a vigia daquele número por 48 h (whatsapp_vigias). As mensagens para o número de alerta
--    (o celular do Danilo, whatsapp_conexao.alerta_telefone) não abrem vigia.
--
-- 2) AVISO NA HORA (whatsapp_avisos, tipo "aviso"): chegou mensagem de um número com vigia aberta OU de cliente
--    que tem O.S. (cadastro ou telefone gravado numa O.S.) → vai para o número de alerta:
--      🔔 *Luiz Patrus* (Siena MSS9H86 · O.S. 1835) respondeu:
--      › Bom dia, o carro está fazendo barulho na frente
--    O aviso espera 45 s antes de sair para juntar as mensagens seguidas do mesmo cliente num aviso só.
--    Áudio espera a transcrição (até 3 minutos). Número desconhecido, fornecedor ou propaganda: NÃO avisa —
--    vai para o resumo (item 4).
--
-- 3) RESPOSTA PELO WHATSAPP DO DANILO: o Danilo responde (de preferência com "Responder" em cima do aviso;
--    pode ser áudio) do celular dele para o número da oficina. O banco liga a resposta ao cliente do aviso
--    citado (motor 3.3 grava a mensagem citada: whatsapp_mensagens.responde_a). Sem citação, vale o único
--    cliente com aviso/rascunho nos últimos 30 minutos; se houver mais de um, ele recebe uma explicação.
--    A IA (Claude Haiku, pela função zap, segredo ANTHROPIC_API_KEY) reescreve o texto de forma profissional,
--    SEM acrescentar preço, prazo, data ou diagnóstico, e devolve o RASCUNHO ao Danilo.
--      OK (em cima do rascunho)   → vai para o cliente pela fila (regras de horário, intervalo e PARAR).
--                                    OK/CANCELAR/AGORA SÓ valem citando a mensagem do rascunho: solto ou em cima do
--                                    aviso não aprova nada (revisão independente, 05/11);
--      OK AGORA                    → idem, liberado fora do horário comercial;
--      outro texto (em cima)       → é a correção: a IA refaz o rascunho;
--      CANCELAR                    → nada é enviado.
--    Sem a chave da IA (ou se ela falhar 3 vezes), o rascunho volta com o texto do Danilo como ele escreveu.
--    Nada chega ao cliente sem o OK do Danilo. Rascunho sem OK vence em 24 h.
--
-- 4) RESUMO 3x AO DIA (08h, 12h e 17h30, horário de Brasília), por regras, SEM IA e sem custo: as mensagens que
--    não geraram aviso, agrupadas em clientes com O.S. aberta, clientes cadastrados, contatos com conversa
--    anterior, fornecedores cadastrados e números desconhecidos. Mensagens com palavras de propaganda
--    (lista em whatsapp_conexao.avisos -> 'propaganda', ajustável) entram só como contagem no fim.
--    Só sai se houver alguma mensagem.
--
-- 5) FILA: mensagens internas (para o celular do Danilo) têm prioridade, não contam nos limites por hora/dia
--    (são para o próprio dono, não para clientes) e, por padrão, saem também fora do horário comercial,
--    exceto entre 22h e 7h (whatsapp_conexao.avisos: fora_horario, silencio_inicio, silencio_fim).
--    whatsapp_fila.liberar_em: a mensagem só sai depois desse momento (usado para juntar o aviso).
--
-- Configuração em whatsapp_conexao.avisos (jsonb; os padrões estão em whatsapp_avisos_cfg()). Para desligar
-- tudo: update whatsapp_conexao set avisos = avisos || '{"ligado": false}' where id = 1;
--
-- Rode depois do v34. Pode rodar mais de uma vez.
-- Espelho/período de transição: tabelas do WhatsApp ficam fora do backup, do banco do PC e do espelho (como no
-- v25); nada aqui é O.S., cadastro, dinheiro ou estoque. Antes e depois da virada funciona igual.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Colunas e tabelas novas
-- ---------------------------------------------------------------------
alter table public.whatsapp_conexao add column if not exists avisos jsonb not null default '{}'::jsonb;
alter table public.whatsapp_conexao add column if not exists resumo_em timestamptz;   -- último resumo enviado
grant select (avisos, resumo_em) on public.whatsapp_conexao to authenticated;

alter table public.whatsapp_mensagens add column if not exists responde_a text;   -- id da mensagem citada ("Responder")
-- mensagens de antes do v36 não geram aviso nem entram no resumo: marcadas SÓ na primeira vez (quando a coluna nasce),
-- para rodar o v36 de novo não apagar as pendências (áudio esperando transcrição, comando do Danilo)
do $$ begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'whatsapp_mensagens' and column_name = 'aviso') then
    alter table public.whatsapp_mensagens add column aviso text;     -- como foi tratada (ver whatsapp_avisos_tratar)
    update public.whatsapp_mensagens set aviso = 'antiga';
  end if;
end $$;
alter table public.whatsapp_mensagens add column if not exists aviso_id bigint;
alter table public.whatsapp_mensagens add column if not exists aviso_erro text;
alter table public.whatsapp_mensagens add column if not exists resumida_em timestamptz;
alter table public.whatsapp_mensagens add column if not exists aviso_tentativas int not null default 0;  -- erro passageiro: tenta de novo
create index if not exists whatsapp_mensagens_tratar on public.whatsapp_mensagens (em) where aviso is null;
create index if not exists whatsapp_mensagens_resumo on public.whatsapp_mensagens (em) where aviso = 'resumo' and resumida_em is null;

alter table public.whatsapp_fila add column if not exists interno boolean not null default false;  -- para o celular do Danilo
alter table public.whatsapp_fila add column if not exists liberar_em timestamptz;                   -- não sai antes disso
alter table public.whatsapp_fila drop constraint if exists whatsapp_fila_origem_check;
alter table public.whatsapp_fila add constraint whatsapp_fila_origem_check check (origem in ('claude', 'tela', 'sistema', 'assistente'));
create index if not exists whatsapp_fila_pendente on public.whatsapp_fila (interno desc, id) where status = 'pendente';

create table if not exists public.whatsapp_vigias (
  chave text primary key,                       -- whatsapp_chave_tel do número
  telefone text not null,
  desde timestamptz not null default now(),
  ate timestamptz not null
);

create table if not exists public.whatsapp_avisos (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('aviso', 'rascunho', 'resposta', 'resumo', 'ajuda')),
  chave text,                                   -- cliente/contato (whatsapp_chave_tel); null em resumo e ajuda
  telefone text,
  cliente_id uuid,                              -- sem chave estrangeira: o espelho recarrega clientes
  cliente_nome text not null default '',
  fila_id bigint,                               -- a mensagem que foi para o celular do Danilo
  mensagens bigint[] not null default '{}',     -- mensagens do cliente incluídas no aviso
  base text,                                    -- rascunho: o que o Danilo escreveu
  anterior text,                                -- rascunho: o rascunho anterior (quando é correção)
  proposta text,                                -- rascunho: o texto que vai para o cliente
  ia text,                                      -- modelo usado ou o motivo de ter ido sem a IA
  situacao text not null default 'avisado'
    check (situacao in ('avisado', 'pendente', 'gerando', 'aguardando_ok', 'enviado', 'substituido', 'cancelado', 'expirado', 'info')),
  tentativas int not null default 0,
  envio_fila_id bigint,                         -- rascunho/resposta: a mensagem que foi para o cliente
  origem_msg_id bigint,                         -- rascunho: a mensagem do Danilo que pediu
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists whatsapp_avisos_chave on public.whatsapp_avisos (chave, id desc);
create index if not exists whatsapp_avisos_fila on public.whatsapp_avisos (fila_id);
create index if not exists whatsapp_avisos_pendente on public.whatsapp_avisos (id) where situacao in ('pendente', 'gerando');

-- conversas que a oficina abriu nas últimas 48 h (antes do v36) já entram vigiadas
insert into public.whatsapp_vigias (chave, telefone, desde, ate)
select distinct on (public.whatsapp_chave_tel(m.telefone)) public.whatsapp_chave_tel(m.telefone), m.telefone, m.em, m.em + interval '48 hours'
  from public.whatsapp_mensagens m
 where m.de_mim and m.em > now() - interval '48 hours' and length(regexp_replace(m.telefone, '\D', '', 'g')) >= 10
   and public.whatsapp_chave_tel(m.telefone) is distinct from (select public.whatsapp_chave_tel(alerta_telefone) from public.whatsapp_conexao where id = 1)
 order by public.whatsapp_chave_tel(m.telefone), m.em desc
on conflict (chave) do nothing;

do $$ declare t text; begin
  foreach t in array array['whatsapp_vigias', 'whatsapp_avisos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.e_admin())', t || '_ler', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
    if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
      execute format('revoke all on public.%I from agente_leitura', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Configuração e auxiliares
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_avisos_cfg() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'ligado', true, 'vigia_horas', 48, 'juntar_s', 45, 'ia', true,
    'fora_horario', true, 'silencio_inicio', '22:00', 'silencio_fim', '07:00',
    'propaganda', jsonb_build_array('promoção', 'promocao', 'oferta', 'divulgação', 'divulgacao', 'anúncio', 'anuncio', 'patrocin',
                                    'marketing', 'clique aqui', 'imperdível', 'imperdivel', 'cupom', 'black friday', 'sorteio',
                                    'seguidores', 'impulsion', 'tráfego pago', 'trafego pago', 'parceria', 'catálogo', 'catalogo'))
    || coalesce((select avisos from public.whatsapp_conexao where id = 1), '{}'::jsonb)
$$;

-- texto com palavra de propaganda?
create or replace function public.whatsapp_e_propaganda(p_texto text, p_cfg jsonb) returns boolean
language sql immutable as $$
  select exists (select 1 from jsonb_array_elements_text(coalesce(p_cfg -> 'propaganda', '[]'::jsonb)) w
                  where w <> '' and position(lower(w) in lower(coalesce(p_texto, ''))) > 0)
$$;

-- agora está no silêncio (padrão 22h–7h, horário de Brasília)? Mensagem interna espera o horário comercial.
create or replace function public.whatsapp_no_silencio(p_cfg jsonb, p_quando timestamptz default now()) returns boolean
language sql stable as $$
  select case when i <= f then t >= i and t < f else t >= i or t < f end
    from (select (p_quando at time zone 'America/Sao_Paulo')::time t,
                 coalesce(p_cfg ->> 'silencio_inicio', '22:00')::time i, coalesce(p_cfg ->> 'silencio_fim', '07:00')::time f) x
$$;

-- O mesmo número de celular? Compara TODOS os dígitos (com 55 e o 9 dos celulares do Brasil), não só a chave
-- DDD + 8 últimos (whatsapp_chave_tel), para um número estrangeiro com os mesmos dígitos finais nunca passar pelo Danilo.
create or replace function public.whatsapp_tel_completo(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) in (10, 11) then d := '55' || d; end if;
  if length(d) = 12 and d like '55%' and substr(d, 5, 1) in ('6', '7', '8', '9') then d := substr(d, 1, 4) || '9' || substr(d, 5); end if;
  return d;
end $$;
create or replace function public.whatsapp_e_alerta(p_tel text) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(c.alerta_telefone, '') <> '' and public.whatsapp_tel_completo(p_tel) = public.whatsapp_tel_completo(c.alerta_telefone)
    from public.whatsapp_conexao c where c.id = 1
$$;

-- texto do Danilo sem a marca do áudio transcrito
create or replace function public.whatsapp_sem_marca(p text) returns text language sql immutable as $$
  select btrim(regexp_replace(coalesce(p, ''), '^\[áudio[^\]]*\]\s*', ''))
$$;

-- Quem é o número: cliente (cadastro ou telefone gravado numa O.S.), O.S. aberta, veículo, fornecedor.
create or replace function public.whatsapp_contato(p_tel text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  k text := public.whatsapp_chave_tel(p_tel); v_cli public.clientes; v_os public.ordens; v_ult public.ordens;
  v_forn text; v_abertas jsonb;
begin
  if k = '' or length(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g')) < 8 then return jsonb_build_object('chave', k); end if;
  select * into v_cli from public.clientes where id = public.whatsapp_cliente_do_tel(p_tel);
  -- número fora do cadastro: o cliente a quem a oficina mandou mensagem por último neste número (fila com cliente)
  if v_cli.id is null then
    select * into v_cli from public.clientes where id = (select f.cliente_id from public.whatsapp_fila f
      where not f.interno and f.cliente_id is not null and public.whatsapp_chave_tel(f.telefone) = k order by f.id desc limit 1);
  end if;
  -- O.S. aberta do cliente (cadastro) ou com o telefone gravado na própria O.S.
  select * into v_os from public.ordens o
   where (o.status in ('diagnostico', 'aguardando', 'execucao', 'pronto') or (o.status = 'entregue' and o.finalizada_em is null))
     and ((v_cli.id is not null and o.cliente_id = v_cli.id)
          or public.whatsapp_chave_tel(o.cliente ->> 'telefone') = k)
   order by o.numero desc limit 1;
  select * into v_ult from public.ordens o
   where (v_cli.id is not null and o.cliente_id = v_cli.id) or public.whatsapp_chave_tel(o.cliente ->> 'telefone') = k
   order by o.numero desc limit 1;
  begin
    execute 'select nome from public.fornecedores where public.whatsapp_chave_tel(telefone) = $1 and coalesce(telefone, '''') <> '''' limit 1'
      into v_forn using k;
  exception when undefined_table or undefined_column then v_forn := null;
  end;
  return jsonb_build_object(
    'chave', k,
    'cliente_id', v_cli.id,
    'nome', coalesce(v_cli.nome, v_os.cliente ->> 'nome', v_ult.cliente ->> 'nome', v_forn),
    'tem_os', v_ult.id is not null,
    'os_aberta', v_os.numero,
    'veiculo', nullif(btrim(concat_ws(' ', nullif(coalesce(v_os.veiculo, v_ult.veiculo) ->> 'modelo', ''),
                                      nullif(coalesce(v_os.veiculo, v_ult.veiculo) ->> 'placa', ''))), ''),
    'fornecedor', v_forn,
    'conversa_antes', exists (select 1 from public.whatsapp_mensagens m where m.de_mim and public.whatsapp_chave_tel(m.telefone) = k));
end $$;

-- Põe uma mensagem interna (para o celular do Danilo) na fila. null = sem número de alerta ou desligado.
create or replace function public.whatsapp_interno(p_texto text, p_esperar_s int default 0) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_tel text; v_id bigint; v_cfg jsonb := public.whatsapp_avisos_cfg();
begin
  select alerta_telefone into v_tel from public.whatsapp_conexao where id = 1;
  if coalesce(v_tel, '') = '' then return null; end if;
  insert into public.whatsapp_fila (telefone, texto, cliente_nome, origem, pedido_por, interno, fora_horario, liberar_em)
  values (v_tel, left(btrim(p_texto), 2000), 'Danilo (aviso do sistema)', 'sistema', 'aviso automático do WhatsApp', true,
          coalesce((v_cfg ->> 'fora_horario')::boolean, true) and not public.whatsapp_no_silencio(v_cfg),
          case when coalesce(p_esperar_s, 0) > 0 then now() + make_interval(secs => p_esperar_s) end)
  returning id into v_id;
  return v_id;
end $$;

-- Linha de um cliente no aviso: nome (veículo · O.S.)
create or replace function public.whatsapp_contato_rotulo(c jsonb, p_tel text) returns text language sql immutable as $$
  select '*' || coalesce(nullif(c ->> 'nome', ''), '+' || regexp_replace(coalesce(p_tel, ''), '\D', '', 'g')) || '*'
         || case when coalesce(c ->> 'veiculo', '') <> '' or c ->> 'os_aberta' is not null
                 then ' (' || concat_ws(' · ', nullif(c ->> 'veiculo', ''), 'O.S. ' || (c ->> 'os_aberta')) || ')' else '' end
$$;

-- Liga a função zap para a IA fazer os rascunhos pendentes (pg_net; sem pg_net, o agendamento de 1 minuto tenta).
create or replace function public.whatsapp_assistente_acordar() returns void
language plpgsql security definer set search_path = public as $$
begin
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  execute $q$ select net.http_post(
      url := 'https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/zap',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-dtcar-cron', (select valor from public.segredos where chave = 'cron')),
      body := '{"acao":"assistente","origem":"banco"}'::jsonb,
      timeout_milliseconds := 60000) $q$;
exception when others then raise warning 'WhatsApp: não acordou a função zap: %', sqlerrm;
end $$;

-- Mensagem para o cliente depois do OK do Danilo (mesmas proteções do whatsapp_enfileirar).
create or replace function public.whatsapp_assistente_enviar(p_av bigint, p_agora boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a public.whatsapp_avisos; v_id bigint; v_txt text; v_r jsonb;
begin
  select * into a from public.whatsapp_avisos where id = p_av for update;
  -- conferido DEPOIS de travar: CANCELAR, correção ou vencimento ao mesmo tempo ganham do OK
  if a.id is null or a.tipo <> 'rascunho' or a.situacao <> 'aguardando_ok' or a.atualizado_em < now() - interval '24 hours' then
    return jsonb_build_object('erro', 'Este rascunho não está mais esperando OK (cancelado, corrigido ou vencido).');
  end if;
  v_txt := btrim(coalesce(a.proposta, ''));
  if v_txt = '' then return jsonb_build_object('erro', 'O rascunho está vazio.'); end if;
  if length(v_txt) > 2000 then return jsonb_build_object('erro', 'O rascunho passou de 2000 caracteres.'); end if;
  if v_txt ~* '(bit\.ly|tinyurl|cutt\.ly|goo\.gl|t\.co/|is\.gd|ow\.ly|encurtador|rebrand\.ly|shorturl)' then
    return jsonb_build_object('erro', 'O rascunho tem link encurtado (não é enviado).');
  end if;
  if exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(a.telefone)) then
    return jsonb_build_object('erro', 'Este cliente pediu para não receber mensagens (respondeu PARAR).');
  end if;
  perform pg_advisory_xact_lock(hashtext('dtcar-zap-fila:' || public.whatsapp_chave_tel(a.telefone)));
  if exists (select 1 from public.whatsapp_fila f where public.whatsapp_chave_tel(f.telefone) = public.whatsapp_chave_tel(a.telefone)
              and f.texto = v_txt and f.status in ('pendente', 'enviando', 'enviada') and f.criado_em > now() - interval '10 minutes') then
    return jsonb_build_object('erro', 'Esta mesma mensagem já foi para este cliente há menos de 10 minutos.');
  end if;
  insert into public.whatsapp_fila (telefone, texto, cliente_id, cliente_nome, origem, pedido_por, fora_horario)
  values (a.telefone, v_txt, a.cliente_id, a.cliente_nome, 'assistente', 'Danilo pelo WhatsApp (OK no rascunho ' || a.id || ')', p_agora)
  returning id into v_id;
  update public.whatsapp_avisos set situacao = 'enviado', envio_fila_id = v_id, atualizado_em = now() where id = a.id;
  select regras into v_r from public.whatsapp_conexao where id = 1;
  return jsonb_build_object('fila_id', v_id, 'no_horario', p_agora or public.whatsapp_no_horario(v_r));
end $$;

-- Cria um rascunho (texto do Danilo) para o cliente do aviso e chama a IA.
create or replace function public.whatsapp_rascunho_novo(p_alvo public.whatsapp_avisos, p_base text, p_anterior text, p_msg bigint) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_cfg jsonb := public.whatsapp_avisos_cfg();
begin
  -- rascunhos anteriores do mesmo cliente que ainda não foram enviados ficam substituídos
  update public.whatsapp_avisos set situacao = 'substituido', atualizado_em = now()
   where tipo = 'rascunho' and chave = p_alvo.chave and situacao in ('pendente', 'gerando', 'aguardando_ok');
  insert into public.whatsapp_avisos (tipo, chave, telefone, cliente_id, cliente_nome, base, anterior, situacao, origem_msg_id)
  values ('rascunho', p_alvo.chave, p_alvo.telefone, p_alvo.cliente_id, p_alvo.cliente_nome, left(p_base, 2000), p_anterior, 'pendente', p_msg)
  returning id into v_id;
  if coalesce((v_cfg ->> 'ia')::boolean, true) then
    perform public.whatsapp_assistente_acordar();
  else
    perform public.whatsapp_assistente_resultado(v_id, null, null, 'IA desligada na configuração', true);
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Tratamento de cada mensagem (gatilho em whatsapp_mensagens e agendamento de 1 minuto)
-- whatsapp_mensagens.aviso: oficina (enviada pela oficina) | aviso | resumo | comando (do Danilo) | sem_numero | desligado | antiga | erro
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_avisos_tratar(p_id bigint) returns text
language plpgsql security definer set search_path = public as $$
declare
  m public.whatsapp_mensagens; v_cfg jsonb := public.whatsapp_avisos_cfg(); v_alerta text; k text; c jsonb;
  a public.whatsapp_avisos; v_fila public.whatsapp_fila; v_linha text; v_texto text; v_res text;
begin
  select * into m from public.whatsapp_mensagens where id = p_id for update;
  if m.id is null or m.aviso is not null then return coalesce(m.aviso, 'sem mensagem'); end if;
  select alerta_telefone into v_alerta from public.whatsapp_conexao where id = 1;
  k := public.whatsapp_chave_tel(m.telefone);

  -- a oficina mandou: abre/renova a vigia (menos para o próprio Danilo)
  if m.de_mim then
    if k <> '' and length(regexp_replace(m.telefone, '\D', '', 'g')) >= 10
       and not coalesce(public.whatsapp_e_alerta(m.telefone), false) then
      insert into public.whatsapp_vigias (chave, telefone, desde, ate)
      values (k, m.telefone, m.em, m.em + make_interval(hours => coalesce((v_cfg ->> 'vigia_horas')::int, 48)))
      on conflict (chave) do update set telefone = excluded.telefone,
        desde = case when public.whatsapp_vigias.ate < now() then excluded.desde else public.whatsapp_vigias.desde end,
        ate = greatest(public.whatsapp_vigias.ate, excluded.ate);
    end if;
    update public.whatsapp_mensagens set aviso = 'oficina' where id = m.id;
    return 'oficina';
  end if;

  if not coalesce((v_cfg ->> 'ligado')::boolean, true) then
    update public.whatsapp_mensagens set aviso = 'desligado' where id = m.id; return 'desligado';
  end if;
  if coalesce(v_alerta, '') = '' then
    update public.whatsapp_mensagens set aviso = 'sem_numero' where id = m.id; return 'sem_numero';
  end if;
  -- mensagem antiga (motor voltou depois de muito tempo, histórico do celular vinculado de novo): não avisa nem resume
  if m.em < now() - interval '6 hours' then
    update public.whatsapp_mensagens set aviso = 'antiga' where id = m.id; return 'antiga';
  end if;
  -- áudio: espera a transcrição (até 3 minutos)
  if m.tipo = 'audio' and m.transcricao is null and m.midia_erro is null and m.gravada_em > now() - interval '3 minutes' then
    return 'esperando transcrição';
  end if;

  -- mensagem do próprio Danilo para a oficina: é uma ordem (número inteiro igual ao de alerta)
  if public.whatsapp_e_alerta(m.telefone) then
    v_res := public.whatsapp_comando(m);
    update public.whatsapp_mensagens set aviso = 'comando', lida = true where id = m.id;
    return 'comando: ' || v_res;
  end if;

  c := public.whatsapp_contato(m.telefone);
  if coalesce(c ->> 'nome', '') = '' and coalesce(m.nome, '') <> '' then c := c || jsonb_build_object('nome', m.nome); end if;  -- nome do perfil
  if k <> '' and (exists (select 1 from public.whatsapp_vigias v where v.chave = k and v.ate > now())
                  or coalesce((c ->> 'tem_os')::boolean, false)) then
    v_linha := '› ' || left(btrim(coalesce(nullif(m.texto, ''), '[' || m.tipo || ']')), 600);
    -- aviso do mesmo cliente que ainda não saiu: junta
    select av.* into a from public.whatsapp_avisos av join public.whatsapp_fila f on f.id = av.fila_id
     where av.tipo = 'aviso' and av.chave = k and f.status = 'pendente' order by av.id desc limit 1 for update of av;
    if a.id is not null then
      select * into v_fila from public.whatsapp_fila where id = a.fila_id for update;
      if v_fila.status = 'pendente' and length(v_fila.texto) + length(v_linha) < 1990 then
        update public.whatsapp_fila
           set texto = regexp_replace(texto, E'\n\n_Responda em cima[^\n]*$', '') || E'\n' || v_linha
                       || E'\n\n_Responda em cima desta mensagem para eu preparar a resposta._'
         where id = v_fila.id;
        update public.whatsapp_avisos set mensagens = mensagens || m.id, atualizado_em = now() where id = a.id;
        update public.whatsapp_mensagens set aviso = 'aviso', aviso_id = a.id where id = m.id;
        return 'aviso (juntado)';
      end if;
    end if;
    v_texto := '🔔 ' || public.whatsapp_contato_rotulo(c, m.telefone) || ' respondeu:' || E'\n' || v_linha
               || E'\n\n_Responda em cima desta mensagem para eu preparar a resposta._';
    insert into public.whatsapp_avisos (tipo, chave, telefone, cliente_id, cliente_nome, mensagens, situacao)
    values ('aviso', k, m.telefone, (c ->> 'cliente_id')::uuid, coalesce(c ->> 'nome', nullif(m.nome, ''), ''), array[m.id], 'avisado')
    returning * into a;
    update public.whatsapp_avisos set fila_id = public.whatsapp_interno(v_texto, coalesce((v_cfg ->> 'juntar_s')::int, 45)) where id = a.id;
    update public.whatsapp_mensagens set aviso = 'aviso', aviso_id = a.id where id = m.id;
    return 'aviso';
  end if;

  update public.whatsapp_mensagens set aviso = 'resumo' where id = m.id;
  return 'resumo';
end $$;

-- Mensagem do Danilo (OK, CANCELAR, correção ou resposta a um aviso).
create or replace function public.whatsapp_comando(m public.whatsapp_mensagens) returns text
language plpgsql security definer set search_path = public as $$
declare
  a public.whatsapp_avisos; r2 public.whatsapp_avisos; v_txt text := public.whatsapp_sem_marca(m.texto); v_p text; v_ok boolean; v_agora boolean;
  v_cancela boolean; v_cmd boolean; v_n int; v_r jsonb; v_id bigint;
begin
  v_p := lower(btrim(v_txt, E' .,!\n\t'));
  v_p := regexp_replace(v_p, '\s+', ' ', 'g');
  v_ok := v_p in ('ok', 'okay', 'oks', 'okk', 'sim', 'pode', 'pode mandar', 'pode enviar', 'manda', 'mandar', 'envia', 'enviar', 'envie',
                  '1', '👍', 'ok agora', 'manda agora', 'envia agora', 'enviar agora', 'pode mandar agora', 'sim agora', 'agora');
  v_agora := v_ok and v_p like '%agora%';
  v_cancela := v_p in ('cancelar', 'cancela', 'cancelado', 'não', 'nao', 'não manda', 'nao manda', 'não envia', 'nao envia', '2');

  v_cmd := v_ok or v_cancela;
  -- 1) o que ele citou com "Responder" (a mensagem que a oficina mandou para ele: aviso, rascunho ou confirmação)
  if coalesce(m.responde_a, '') <> '' then
    select av.* into a from public.whatsapp_avisos av join public.whatsapp_fila f on f.id = av.fila_id
     where f.msg_id = m.responde_a and av.tipo in ('aviso', 'rascunho', 'resposta') order by av.id desc limit 1;
  end if;
  -- OK / CANCELAR / AGORA só valem EM CIMA da mensagem do próprio rascunho (ou, o AGORA, da confirmação "na fila").
  -- Sem citação, citando um aviso ou outra mensagem: não aprova nada, explica (um OK solto nunca manda texto a cliente).
  if v_cmd and not (a.id is not null and (a.tipo = 'rascunho' or (a.tipo = 'resposta' and v_agora))) then
    if not exists (select 1 from public.whatsapp_avisos where tipo = 'ajuda' and criado_em > now() - interval '2 minutes') then
      insert into public.whatsapp_avisos (tipo, situacao, fila_id) values ('ajuda', 'info',
        public.whatsapp_interno(case when v_cancela
          then '🤖 Nada foi cancelado. Para cancelar, toque e segure no *rascunho* do cliente, escolha *Responder* e escreva CANCELAR.'
          else '🤖 Nada foi enviado. O *OK* só vale em cima do *rascunho*: toque e segure na mensagem "✍️ Rascunho para…", escolha *Responder* e escreva OK.' end));
    end if;
    return 'comando sem rascunho citado';
  end if;
  -- 2) texto sem citação: o único cliente com aviso/rascunho nos últimos 30 minutos (só cria rascunho; nada sai sem OK).
  --    Citou uma mensagem que não é aviso/rascunho/resposta, ou a mensagem é antiga (chegou atrasada): não adivinha.
  if a.id is null and coalesce(m.responde_a, '') = '' and m.em > now() - interval '10 minutes' then
    select count(distinct chave) into v_n from public.whatsapp_avisos
     where tipo in ('aviso', 'rascunho', 'resposta') and chave is not null and criado_em > now() - interval '30 minutes';
    if v_n = 1 then
      select * into a from public.whatsapp_avisos
       where tipo in ('aviso', 'rascunho', 'resposta') and chave is not null and criado_em > now() - interval '30 minutes'
       order by id desc limit 1;
    end if;
  end if;
  if a.id is null then
    -- explica no máximo uma vez a cada 10 minutos
    if not exists (select 1 from public.whatsapp_avisos where tipo = 'ajuda' and criado_em > now() - interval '10 minutes') then
      insert into public.whatsapp_avisos (tipo, situacao, fila_id) values ('ajuda', 'info',
        public.whatsapp_interno(case when coalesce(m.responde_a, '') <> ''
          then '🤖 A mensagem que você respondeu não é um aviso nem um rascunho de cliente. Nada foi enviado. Toque e segure no aviso (ou no rascunho) do cliente, escolha *Responder* e escreva de novo.'
          else '🤖 Não sei para qual cliente é esta mensagem. Toque e segure no aviso do cliente, escolha *Responder* e escreva (ou grave o áudio) de novo.' end));
    end if;
    return case when coalesce(m.responde_a, '') <> '' then 'citação desconhecida' else 'sem cliente' end;
  end if;

  if a.tipo = 'rascunho' and a.situacao = 'aguardando_ok' and v_ok then
    v_r := public.whatsapp_assistente_enviar(a.id, v_agora);
    if v_r ? 'erro' then
      insert into public.whatsapp_avisos (tipo, chave, telefone, cliente_id, cliente_nome, situacao, fila_id)
      values ('resposta', a.chave, a.telefone, a.cliente_id, a.cliente_nome, 'info',
              public.whatsapp_interno('⚠️ Não enviado para *' || coalesce(nullif(a.cliente_nome, ''), a.telefone) || '*: ' || (v_r ->> 'erro')));
      return 'ok recusado';
    end if;
    insert into public.whatsapp_avisos (tipo, chave, telefone, cliente_id, cliente_nome, situacao, envio_fila_id, fila_id)
    values ('resposta', a.chave, a.telefone, a.cliente_id, a.cliente_nome, 'info', (v_r ->> 'fila_id')::bigint,
            public.whatsapp_interno('✅ Na fila para *' || coalesce(nullif(a.cliente_nome, ''), a.telefone) || '*'
              || case when (v_r ->> 'no_horario')::boolean then ': sai em instantes.'
                      else E'. Fora do horário comercial: sai no próximo horário. Para mandar já, responda *AGORA* em cima desta mensagem.' end));
    return 'enviado';
  elsif a.tipo = 'rascunho' and a.situacao = 'aguardando_ok' and v_cancela then
    update public.whatsapp_avisos set situacao = 'cancelado', atualizado_em = now() where id = a.id;
    insert into public.whatsapp_avisos (tipo, chave, telefone, cliente_id, cliente_nome, situacao, fila_id)
    values ('resposta', a.chave, a.telefone, a.cliente_id, a.cliente_nome, 'info',
            public.whatsapp_interno('🚫 Cancelado. Nada foi enviado para *' || coalesce(nullif(a.cliente_nome, ''), a.telefone) || '*.'));
    return 'cancelado';
  elsif a.tipo = 'rascunho' and a.situacao in ('enviado', 'cancelado', 'expirado', 'substituido') and (v_ok or v_cancela) then
    insert into public.whatsapp_avisos (tipo, chave, telefone, cliente_id, cliente_nome, situacao, fila_id)
    values ('resposta', a.chave, a.telefone, a.cliente_id, a.cliente_nome, 'info',
            public.whatsapp_interno('ℹ️ Este rascunho para *' || coalesce(nullif(a.cliente_nome, ''), a.telefone) || '* já está '
              || case a.situacao when 'enviado' then 'enviado' when 'cancelado' then 'cancelado' when 'expirado' then 'vencido (mais de 24 h)'
                                 else 'substituído por um mais novo' end || '. Nada mudou.'));
    return 'rascunho já tratado';
  elsif a.tipo = 'resposta' and v_p in ('agora', 'ok agora', 'manda agora', 'envia agora', 'enviar agora') and a.envio_fila_id is not null then
    update public.whatsapp_fila set fora_horario = true where id = a.envio_fila_id and status = 'pendente';
    get diagnostics v_n = row_count;
    v_id := public.whatsapp_interno(case when v_n > 0 then '⏩ Liberado: a mensagem para *' || coalesce(nullif(a.cliente_nome, ''), a.telefone) || '* sai agora.'
                                         else 'ℹ️ A mensagem para *' || coalesce(nullif(a.cliente_nome, ''), a.telefone) || '* já saiu (ou não está mais na fila).' end);
    insert into public.whatsapp_avisos (tipo, chave, telefone, situacao, fila_id) values ('resposta', a.chave, a.telefone, 'info', v_id);
    return 'agora';
  end if;
  if v_txt = '' then return 'vazio'; end if;
  -- texto (ou correção): novo rascunho pela IA
  perform public.whatsapp_rascunho_novo(a, v_txt, case when a.tipo = 'rascunho' then coalesce(a.proposta, a.base) end, m.id);
  return 'rascunho';
end $$;

-- Tratamento FORA da gravação (revisão independente, 05/11): o insert das recebidas nunca espera nem falha por causa dos
-- avisos. Quem grava (motor: whatsapp_motor_avisos; zap: whatsapp_avisos_processar) chama logo depois, numa chamada
-- separada e com poucas mensagens por vez; o agendamento de 1 minuto pega o resto. Erro numa mensagem vira aviso = 'erro'.
drop trigger if exists whatsapp_mensagens_aviso on public.whatsapp_mensagens;
drop function if exists public.whatsapp_mensagens_aviso_gatilho();
create or replace function public.whatsapp_avisos_processar(p_limite int default 5) returns int
language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from public.whatsapp_mensagens where aviso is null and em > now() - interval '2 days'
            order by id limit least(greatest(coalesce(p_limite, 5), 1), 100) loop
    begin
      perform public.whatsapp_avisos_tratar(r.id); n := n + 1;
    exception when others then
      -- erro passageiro: fica para a próxima rodada; na 3ª falha vira erro
      update public.whatsapp_mensagens set aviso_erro = left(sqlerrm, 300), aviso_tentativas = aviso_tentativas + 1,
             aviso = case when aviso_tentativas + 1 >= 3 then 'erro' end where id = r.id;
    end;
  end loop;
  return n;
end $$;
-- o motor (chave própria, sem precisar da vez) pede o tratamento depois de gravar as recebidas
create or replace function public.whatsapp_motor_avisos(p_chave text) returns int
language plpgsql security definer set search_path = public as $$
begin
  perform public.whatsapp_motor_conferir(p_chave);
  return public.whatsapp_avisos_processar(5);
end $$;

-- ---------------------------------------------------------------------
-- IA (função zap, chave de servidor): pega os rascunhos pendentes e devolve o resultado
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_assistente_pegar(p_limite int default 3) returns jsonb
language plpgsql security definer set search_path = public as $$
declare r jsonb := '[]'::jsonb; a public.whatsapp_avisos; c jsonb;
begin
  for a in select * from public.whatsapp_avisos
            where tipo = 'rascunho'
              and ((situacao = 'pendente' and (tentativas = 0 or atualizado_em < now() - interval '45 seconds'))  -- falhou: espera 45 s
                   or (situacao = 'gerando' and atualizado_em < now() - interval '3 minutes'))
              and tentativas < 3
            order by id limit greatest(1, least(coalesce(p_limite, 3), 10)) for update skip locked loop
    update public.whatsapp_avisos set situacao = 'gerando', tentativas = tentativas + 1, atualizado_em = now() where id = a.id;
    c := public.whatsapp_contato(a.telefone);
    r := r || jsonb_build_object(
      'id', a.id, 'base', a.base, 'anterior', a.anterior, 'tentativa', a.tentativas + 1,
      'cliente', coalesce(nullif(a.cliente_nome, ''), c ->> 'nome'), 'veiculo', c ->> 'veiculo', 'os_aberta', c ->> 'os_aberta',
      'agora', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' (' ||
               (array['segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado', 'domingo'])[extract(isodow from now() at time zone 'America/Sao_Paulo')::int] || ')',
      -- últimas mensagens da conversa (a mais antiga primeiro); texto do cliente é dado, nunca instrução
      'conversa', coalesce((select jsonb_agg(jsonb_build_object('de', case when x.de_mim then 'oficina' else 'cliente' end,
                                                                  'texto', left(x.texto, 500), 'em', to_char(x.em at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI'))
                                             order by x.em)
                              from (select * from public.whatsapp_mensagens mm
                                     where public.whatsapp_chave_tel(mm.telefone) = a.chave and mm.em > now() - interval '7 days'
                                     order by mm.em desc limit 10) x), '[]'::jsonb));
  end loop;
  return r;
end $$;

-- p_proposta null + p_erro: sem a IA. p_final = não tenta de novo (ou passou de 3 tentativas): vai o texto do Danilo.
create or replace function public.whatsapp_assistente_resultado(p_id bigint, p_proposta text, p_modelo text, p_erro text, p_final boolean default false)
returns boolean language plpgsql security definer set search_path = public as $$
declare a public.whatsapp_avisos; v_txt text; v_sem boolean; v_r jsonb; v_cab text; v_cortou boolean;
begin
  select * into a from public.whatsapp_avisos where id = p_id and tipo = 'rascunho' for update;
  if a.id is null or a.situacao not in ('pendente', 'gerando') then return false; end if;
  v_txt := btrim(coalesce(p_proposta, ''));
  v_sem := v_txt = '';
  if v_sem and not p_final and a.tentativas < 3 then
    update public.whatsapp_avisos set situacao = 'pendente', ia = left('falhou: ' || coalesce(p_erro, '?'), 200), atualizado_em = now() where id = a.id;
    return false;
  end if;
  if v_sem then v_txt := btrim(a.base); end if;
  -- o rascunho mostrado ao Danilo e o texto que vai ao cliente com o OK são EXATAMENTE o mesmo: corta antes, nos dois.
  -- 1.400 caracteres: cabeçalho + texto + rodapé cabem na mensagem interna (2.000), sem cortar o texto.
  v_cortou := length(v_txt) > 1400;
  if v_cortou then v_txt := btrim(left(v_txt, 1400)); end if;
  select regras into v_r from public.whatsapp_conexao where id = 1;
  v_cab := '✍️ *Rascunho para ' || coalesce(nullif(a.cliente_nome, ''), a.telefone) || '*'
           || case when v_sem then E'\n⚠️ _Sem revisão da IA (' || left(coalesce(p_erro, 'motivo desconhecido'), 120) || '): texto como você escreveu._' else '' end
           || case when v_cortou then E'\n✂️ _Texto longo: vai só até onde aparece abaixo (1.400 caracteres)._' else '' end;
  update public.whatsapp_avisos
     set proposta = v_txt, situacao = 'aguardando_ok', atualizado_em = now(),
         ia = case when v_sem then left('sem IA: ' || coalesce(p_erro, '?'), 200) else left(coalesce(p_modelo, 'IA'), 200) end,
         fila_id = public.whatsapp_interno(v_cab || E'\n\n' || v_txt || E'\n\n'
                     || '_Responda *OK* em cima desta mensagem para enviar, *CANCELAR* para não enviar, ou escreva a correção._'
                     || case when not public.whatsapp_no_horario(v_r) then E'\n_Fora do horário comercial: com OK, sai no próximo horário; com *OK AGORA*, sai já._' else '' end)
   where id = a.id;
  return true;
end $$;

-- ---------------------------------------------------------------------
-- Agendamentos: a cada minuto (sobras e rascunhos) e o resumo 3x ao dia
-- ---------------------------------------------------------------------
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

-- Resumo das mensagens que não geraram aviso (por regras, sem IA). Devolve o id da fila (null = nada a resumir).
create or replace function public.whatsapp_resumo_enviar() returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb := public.whatsapp_avisos_cfg(); r record; c jsonb; g text; v_prop int := 0; v_ids bigint[] := '{}';
  v_grupos jsonb := '{}'::jsonb; v_txt text; v_id bigint; v_desde timestamptz; v_n int := 0; v_linha text; v_ord text[];
  v_cont jsonb := '{}'::jsonb; i int;
begin
  if not coalesce((v_cfg ->> 'ligado')::boolean, true) then return null; end if;
  select resumo_em into v_desde from public.whatsapp_conexao where id = 1;
  for r in select coalesce(nullif(public.whatsapp_chave_tel(m.telefone), ''), m.jid) chave, max(m.telefone) telefone, max(m.nome) nome,
                  count(*) qtd, array_agg(m.id) ids, (array_agg(m.texto order by m.em desc))[1] ultimo,
                  bool_and(public.whatsapp_e_propaganda(m.texto, v_cfg)) propaganda, min(m.em) primeira
             from public.whatsapp_mensagens m
            where m.aviso = 'resumo' and m.resumida_em is null and m.em > now() - interval '2 days'
            group by 1 order by min(m.em) loop
    v_ids := v_ids || r.ids;
    c := public.whatsapp_contato(r.telefone);
    g := case when c ->> 'os_aberta' is not null then '1|*Clientes com O.S. aberta*'
              when c ->> 'cliente_id' is not null or coalesce((c ->> 'tem_os')::boolean, false) then '2|*Clientes cadastrados*'
              when coalesce((c ->> 'conversa_antes')::boolean, false) then '3|*Contatos com conversa anterior*'
              when c ->> 'fornecedor' is not null then '4|*Fornecedores*'
              else '5|*Números desconhecidos*' end;
    if r.propaganda and left(g, 1) in ('3', '4', '5') then v_prop := v_prop + r.qtd; continue; end if;
    v_linha := '• ' || coalesce(nullif(c ->> 'nome', ''), nullif(r.nome, ''), case when r.telefone <> '' then '+' || r.telefone else 'número oculto' end)
               || case when coalesce(c ->> 'veiculo', '') <> '' then ' (' || (c ->> 'veiculo') || ')' else '' end
               || ' — ' || r.qtd || ' msg: "' || left(regexp_replace(btrim(r.ultimo), '\s+', ' ', 'g'), 70)
               || case when length(btrim(r.ultimo)) > 70 then '…' else '' end || '"';
    v_cont := jsonb_set(v_cont, array[g], to_jsonb(coalesce((v_cont ->> g)::int, 0) + 1));
    if coalesce((v_cont ->> g)::int, 0) <= 10 then
      v_grupos := jsonb_set(v_grupos, array[g], coalesce(v_grupos -> g, '[]'::jsonb) || to_jsonb(v_linha));
    end if;
    v_n := v_n + 1;
  end loop;
  if coalesce(array_length(v_ids, 1), 0) = 0 then return null; end if;
  v_txt := '📋 *Resumo do WhatsApp* — ' || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') || E'\n'
           || '_Mensagens que não geraram aviso' || case when v_desde is not null then ' desde ' || to_char(v_desde at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI') else '' end || '._';
  select array_agg(x order by x) into v_ord from jsonb_object_keys(v_grupos) x;
  if v_ord is not null then
    for i in 1 .. array_length(v_ord, 1) loop
      v_txt := v_txt || E'\n\n' || split_part(v_ord[i], '|', 2) || E'\n'
               || (select string_agg(l, E'\n') from jsonb_array_elements_text(v_grupos -> v_ord[i]) l)
               || case when (v_cont ->> v_ord[i])::int > 10 then E'\n• … e mais ' || ((v_cont ->> v_ord[i])::int - 10) || ' contato(s)' else '' end;
    end loop;
  end if;
  if v_prop > 0 then v_txt := v_txt || E'\n\n_Propaganda: ' || v_prop || ' mensagem(ns) ignorada(s)._'; end if;
  if length(v_txt) > 1990 then v_txt := left(v_txt, 1960) || E'\n… (resumo cortado: veja Sistema › WhatsApp)'; end if;
  v_id := public.whatsapp_interno(v_txt);
  if v_id is null then return null; end if;
  insert into public.whatsapp_avisos (tipo, situacao, fila_id, mensagens) values ('resumo', 'info', v_id, v_ids);
  update public.whatsapp_mensagens set resumida_em = now() where id = any (v_ids);
  update public.whatsapp_conexao set resumo_em = now() where id = 1;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- Fila: mensagens internas primeiro, fora dos limites por hora/dia, e "liberar_em" (v34 + v36)
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_pegar_proxima(p_dono text, p_id text, p_com_arquivo boolean default false) returns jsonb
language plpgsql security definer set search_path = public as $$
declare c public.whatsapp_conexao; v public.whatsapp_fila; v_hora int; v_dia int; v_no boolean; v_lim boolean; v_sil boolean; v_int boolean;
begin
  select * into c from public.whatsapp_conexao where id = 1 for update;
  if not (c.dono = p_dono and c.dono_id = p_id and c.dono_ate > now()) then return jsonb_build_object('motivo', 'sem a vez'); end if;
  -- "enviando" esquecida (quem pegou caiu no meio): não reenvia sozinho — pode ter saído. Marca para conferir.
  update public.whatsapp_fila set status = 'erro', erro = 'Envio não confirmado (a conexão caiu no meio). Confira no WhatsApp antes de mandar de novo.'
   where status = 'enviando' and pego_em < now() - interval '5 minutes';
  if c.proximo_envio is not null and c.proximo_envio > now() then
    return jsonb_build_object('motivo', 'intervalo', 'proximo_envio', c.proximo_envio);
  end if;
  -- limites por hora/dia valem para os clientes; as mensagens internas (celular do Danilo) não contam
  select count(*) filter (where enviada_em > now() - interval '1 hour'),
         count(*) filter (where enviada_em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo')
    into v_hora, v_dia from public.whatsapp_fila where status = 'enviada' and not interno and enviada_em > now() - interval '1 day';
  v_lim := v_hora >= coalesce((c.regras ->> 'por_hora')::int, 20) or v_dia >= coalesce((c.regras ->> 'por_dia')::int, 80);
  -- pendente de quem pediu PARAR depois de entrar na fila: não sai (vale também para as internas: o número de alerta
  -- pode ter pedido PARAR antes de ser escolhido como alerta)
  update public.whatsapp_fila f set status = 'cancelada', erro = 'O número pediu para não receber mensagens (PARAR).'
   where f.status = 'pendente' and exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(f.telefone));
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
  update public.whatsapp_fila set status = 'enviando', pego_em = now(), pego_por = p_dono where id = v.id;
  return jsonb_build_object('mensagem', jsonb_build_object('id', v.id, 'telefone', v.telefone, 'texto', v.texto,
    'arquivo', case when v.arquivo is not null then jsonb_build_object('path', v.arquivo ->> 'path', 'nome', v.arquivo ->> 'nome',
                                                                       'tipo', v.arquivo ->> 'tipo', 'bytes', (v.arquivo ->> 'bytes')::int) end));
end $$;

-- ---------------------------------------------------------------------
-- Pôr na fila (v34): o limite do dia conta só as mensagens para clientes (as internas não gastam o limite)
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

-- aviso de "motor sem sinal" (v32) também como mensagem interna (sai primeiro, fora dos limites, respeita o silêncio)
create or replace function public.whatsapp_alerta_na_fila(p_texto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_tel text;
begin
  select alerta_telefone into v_tel from public.whatsapp_conexao where id = 1;
  if coalesce(v_tel, '') = '' then return null; end if;
  if exists (select 1 from public.whatsapp_optout o where o.telefone = public.whatsapp_chave_tel(v_tel)) then return null; end if;
  return public.whatsapp_interno(p_texto);
end $$;

-- ---------------------------------------------------------------------
-- Gravar mensagens recebidas (v25 + a mensagem citada, motor 3.3)
-- ---------------------------------------------------------------------
create or replace function public.whatsapp_guardar_mensagens(p_msgs jsonb) returns int
language plpgsql security definer set search_path = public as $$
declare m jsonb; n int := 0; k int;
begin
  for m in select * from jsonb_array_elements(coalesce(p_msgs, '[]'::jsonb)) loop
    insert into public.whatsapp_mensagens (msg_id, jid, telefone, nome, de_mim, texto, tipo, em, responde_a)
    values (m ->> 'msg_id', m ->> 'jid', regexp_replace(coalesce(m ->> 'telefone', ''), '\D', '', 'g'), left(coalesce(m ->> 'nome', ''), 80),
            coalesce((m ->> 'de_mim')::boolean, false), left(coalesce(m ->> 'texto', ''), 4000), coalesce(nullif(m ->> 'tipo', ''), 'texto'),
            coalesce((m ->> 'em')::timestamptz, now()), nullif(left(coalesce(m ->> 'responde_a', ''), 200), ''))
    on conflict (msg_id) do nothing;
    get diagnostics k = row_count; n := n + k;
    if k > 0 and not coalesce((m ->> 'de_mim')::boolean, false) and coalesce(m ->> 'telefone', '') <> ''
       and lower(btrim(coalesce(m ->> 'texto', ''), E' .!\n')) in ('parar', 'pare', 'sair', 'stop', 'cancelar mensagens')
       -- o Danilo dando ordem para a oficina não vira "PARAR" do número dele
       and not coalesce(public.whatsapp_e_alerta(m ->> 'telefone'), false) then
      insert into public.whatsapp_optout (telefone, texto) values (public.whatsapp_chave_tel(m ->> 'telefone'), left(m ->> 'texto', 100))
      on conflict (telefone) do nothing;
    end if;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Permissões: tudo interno (chave de servidor, gatilho e agendamento)
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['whatsapp_avisos_cfg()', 'whatsapp_contato(text)', 'whatsapp_interno(text, int)', 'whatsapp_assistente_acordar()',
                           'whatsapp_assistente_enviar(bigint, boolean)', 'whatsapp_rascunho_novo(public.whatsapp_avisos, text, text, bigint)',
                           'whatsapp_avisos_tratar(bigint)', 'whatsapp_comando(public.whatsapp_mensagens)', 'whatsapp_avisos_processar(int)',
                           'whatsapp_e_alerta(text)',
                           'whatsapp_assistente_pegar(int)', 'whatsapp_assistente_resultado(bigint, text, text, text, boolean)',
                           'whatsapp_avisos_minuto()', 'whatsapp_resumo_enviar()', 'whatsapp_guardar_mensagens(jsonb)',
                           'whatsapp_pegar_proxima(text, text, boolean)'] loop
    execute 'revoke all on function public.' || f || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || f || ' to service_role';
  end loop;
  execute 'revoke all on function public.whatsapp_motor_avisos(text) from public, authenticated';
  execute 'grant execute on function public.whatsapp_motor_avisos(text) to anon, service_role';
end $$;

-- ---------------------------------------------------------------------
-- Agendamentos (pg_cron; horário do servidor em UTC = Brasília + 3 h)
-- ---------------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('dtcar-zap-avisos', 'dtcar-zap-resumo-08h', 'dtcar-zap-resumo-12h', 'dtcar-zap-resumo-17h30');
end $$;
select cron.schedule('dtcar-zap-avisos', '* * * * *', $cron$ select public.whatsapp_avisos_minuto() $cron$);
select cron.schedule('dtcar-zap-resumo-08h', '0 11 * * *', $cron$ select public.whatsapp_resumo_enviar() $cron$);
select cron.schedule('dtcar-zap-resumo-12h', '0 15 * * *', $cron$ select public.whatsapp_resumo_enviar() $cron$);
select cron.schedule('dtcar-zap-resumo-17h30', '30 20 * * *', $cron$ select public.whatsapp_resumo_enviar() $cron$);

notify pgrst, 'reload schema';
