-- =====================================================================
-- DTCar Gestão — versão 35: backup de leitura por e-mail (todo dia às 18h)
-- Pedido do Danilo em 05/11/2026: uma cópia que se lê SEM o sistema no ar.
--   * A função "email" (backup.ts) monta um zip COM SENHA (AES-256): páginas HTML navegáveis (busca por O.S., placa ou cliente,
--     abrem direto do disco, sem internet) + planilha Excel; e manda pelo Hotmail da oficina para os e-mails da tela Backup.
--   * A senha fica no segredo BACKUP_SENHA da função "email" (Supabase › Edge Functions › Secrets). Sem ela, nada sai.
--   * Às 18h40, se o backup do dia não saiu, vai um aviso no WhatsApp do Danilo (o número dos alertas, v32).
-- Rode DEPOIS do v34.sql (usa o segredo do agendamento do v6 e o aviso no WhatsApp do v32). Pode ser executado mais de uma vez.
--
-- Tabela nova: backup_execucoes — histórico operacional (como email_envios): FORA do backup restaurável, do banco do PC
-- e do espelho (não é dado da oficina; não tem O.S., dinheiro, cadastro nem estoque). Antes/depois da virada: igual.
-- Pasta nova: "backup-leitura" (privada; só a função lê e grava). Os arquivos ficam lá só durante a geração e são
-- apagados depois do envio — a cópia de verdade fica FORA do Supabase (nos e-mails e, no Grau 2, no PC/Google Drive).
-- =====================================================================

create table if not exists public.backup_execucoes (
  id bigint generated always as identity primary key,
  iniciado_em timestamptz not null default now(),
  terminado_em timestamptz,
  origem text not null default 'agendamento' check (origem in ('agendamento', 'tela')),
  pedido_por text not null default '',
  situacao text not null default 'rodando' check (situacao in ('rodando', 'ok', 'erro')),
  passo text not null default 'inicio' check (passo in ('inicio', 'planilha', 'paginas', 'enviar')),
  gerado_em timestamptz,                        -- momento dos dados
  para text[] not null default '{}',            -- e-mails de destino
  detalhe jsonb not null default '{}'::jsonb,   -- tamanhos, tempos de cada passo, quantidades (nunca dados de clientes)
  erro text
);
create index if not exists backup_execucoes_recentes on public.backup_execucoes (iniciado_em desc);
-- no máximo UM backup "rodando" (o agendamento e o botão ao mesmo tempo não mandam dois e-mails)
create unique index if not exists backup_execucoes_uma_rodando on public.backup_execucoes ((true)) where situacao = 'rodando';
alter table public.backup_execucoes enable row level security;
revoke all on public.backup_execucoes from anon, authenticated;
grant select on public.backup_execucoes to authenticated;
drop policy if exists backup_execucoes_ler on public.backup_execucoes;
create policy backup_execucoes_ler on public.backup_execucoes for select to authenticated using (public.e_admin());

-- pasta privada temporária (zip de até 20 MB), sem política: só a chave de servidor (função) entra
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('backup-leitura', 'backup-leitura', false, 20971520,
        array['application/zip', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do nothing;

-- configuração padrão (a tela Backup troca): ligado, para o e-mail da oficina e o e-mail de LOGIN do(s) administrador(es)
-- (lido do cadastro de acesso do Supabase, para o e-mail pessoal não ficar escrito no código, que é público). Até 3.
update public.config
   set dados = dados || jsonb_build_object('backupLeitura', jsonb_build_object('ativo', true, 'emails', (
         select jsonb_agg(e order by o) from (
           select e, min(o) as o from (
             select 'centroautomotivodtcar@hotmail.com'::text as e, 0 as o
             union all
             select lower(u.email::text), 1 from auth.users u join public.perfis p on p.id = u.id
              where p.papel = 'admin' and p.ativo and coalesce(u.email, '') <> ''
           ) t group by e order by min(o), e limit 3) x)))
 where id = 1 and not (dados ? 'backupLeitura');

-- ---------------------------------------------------------------------
-- Conferência das 18h40: o backup de hoje saiu? Se não saiu (erro, travou, ou o agendamento nem rodou),
-- põe um aviso na fila do WhatsApp para o número dos alertas (whatsapp_alerta_na_fila, v32 — respeita o horário
-- de envio: depois das 18h o aviso sai no próximo horário comercial). Um aviso por dia. Devolve o que fez.
-- ---------------------------------------------------------------------
create or replace function public.backup_leitura_vigiar(p_agora timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_ativo boolean; v_inicio timestamptz; v_ok boolean; v_ult public.backup_execucoes; v_txt text; v_fila bigint; v_motivo text;
begin
  select coalesce((dados -> 'backupLeitura' ->> 'ativo')::boolean, true) into v_ativo from public.config where id = 1;
  if not coalesce(v_ativo, true) then return jsonb_build_object('acao', 'desligado'); end if;
  -- "hoje" no horário de Brasília, a partir das 17h (pega também o "Gerar agora" da tarde)
  v_inicio := (date_trunc('day', p_agora at time zone 'America/Sao_Paulo') + interval '17 hours') at time zone 'America/Sao_Paulo';
  select exists (select 1 from public.backup_execucoes where situacao = 'ok' and iniciado_em >= v_inicio) into v_ok;
  if v_ok then return jsonb_build_object('acao', 'ok'); end if;
  if exists (select 1 from public.backup_execucoes where detalhe ? 'avisado_em' and (detalhe ->> 'avisado_em')::timestamptz >= v_inicio) then
    return jsonb_build_object('acao', 'ja_avisado');
  end if;
  select * into v_ult from public.backup_execucoes where iniciado_em >= v_inicio order by id desc limit 1;
  v_txt := 'Aviso do DTCar Gestão: o backup de leitura de hoje NÃO foi enviado aos e-mails. '
    || case when v_ult.id is null then 'O agendamento das 18h não rodou.'
            when v_ult.situacao = 'rodando' then 'Ficou parado no passo "' || v_ult.passo || '".'
            else 'Motivo: ' || left(coalesce(v_ult.erro, 'sem detalhe'), 300) end
    || ' Confira em Sistema › Backup e use "Gerar e enviar agora".';
  begin
    v_fila := public.whatsapp_alerta_na_fila(v_txt);
    if v_fila is null then v_motivo := 'sem número de alerta cadastrado no WhatsApp (Sistema › WhatsApp)'; end if;
  exception when undefined_function then v_fila := null; v_motivo := 'sem o v32 (aviso no WhatsApp)';
            when others then v_fila := null; v_motivo := 'aviso no WhatsApp falhou: ' || left(sqlerrm, 200);
  end;
  if v_ult.id is null then
    insert into public.backup_execucoes (origem, situacao, passo, erro, terminado_em, detalhe)
    values ('agendamento', 'erro', 'inicio', 'O agendamento das 18h não rodou.', p_agora, jsonb_build_object('avisado_em', p_agora, 'aviso_fila', v_fila, 'aviso_motivo', v_motivo));
  else
    update public.backup_execucoes set detalhe = detalhe || jsonb_build_object('avisado_em', p_agora, 'aviso_fila', v_fila, 'aviso_motivo', v_motivo),
      situacao = case when situacao = 'rodando' then 'erro' else situacao end,
      erro = case when situacao = 'rodando' then 'Parou no passo "' || passo || '".' else erro end,
      terminado_em = coalesce(terminado_em, p_agora)
    where id = v_ult.id;
  end if;
  return jsonb_build_object('acao', 'avisado', 'fila', v_fila, 'motivo', v_motivo);
end $$;
revoke all on function public.backup_leitura_vigiar(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Agendamentos (pg_cron + pg_net, como o v32). Horário do banco = UTC; Brasília = UTC−3 (sem horário de verão).
--   dtcar-backup-leitura        18h00 → chama a função "email" (ação backup_leitura)
--   dtcar-backup-leitura-vigia  18h40 → backup_leitura_vigiar()
-- ---------------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('dtcar-backup-leitura', 'dtcar-backup-leitura-vigia');
end $$;
select cron.schedule('dtcar-backup-leitura', '0 21 * * *', $cron$
  select net.http_post(
    url := 'https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dtcar-cron', (select valor from public.segredos where chave = 'cron')),
    body := '{"acao":"backup_leitura","origem":"agendamento"}'::jsonb,
    timeout_milliseconds := 60000)
  where coalesce((select (dados -> 'backupLeitura' ->> 'ativo')::boolean from public.config where id = 1), true)
$cron$);
select cron.schedule('dtcar-backup-leitura-vigia', '40 21 * * *', $cron$ select public.backup_leitura_vigiar() $cron$);

notify pgrst, 'reload schema';
