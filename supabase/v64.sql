-- v64 (24/11/2026, pedido do Danilo): O ROBÔ DO E-MAIL VIRA MOTOR NO TABLET, COMO O DO WHATSAPP.
--
-- A primeira versão do robô rodava dentro da tela, no navegador do tablet: com a tela bloqueada ou a aba atrás, o Android
-- suspende o navegador e o robô para. O Danilo pediu o mesmo arranjo que já funciona para o WhatsApp: um programa no
-- Termux, que sobe no boot e não depende de tela.
--
-- Quem faz o trabalho continua sendo a função "email" (a chave da Microsoft nunca sai do servidor). O motor só CHAMA a
-- função de tempos em tempos, com a MESMA chave do motor do WhatsApp (whatsapp_motor_conferir, v24) — nenhuma chave
-- nova e nada de segredo de servidor no tablet.
--
-- Esta migração cria só o lugar onde o resultado fica guardado, para a tela mostrar sem refazer o trabalho e para o
-- robô não avisar duas vezes o mesmo e-mail.
--
-- email_robo é LOG OPERACIONAL, como email_envios: fica FORA do backup, do banco do PC, da restauração e das exclusões,
-- e é preservada pelo espelho (não existe no OS Oficina). Conteúdo de e-mail não é guardado: só remetente, assunto,
-- a categoria que o filtro deu e o que o robô achou de cada anexo.

create table if not exists public.email_robo (
  id            bigserial primary key,
  email_id      text not null unique,          -- id da mensagem na Microsoft: é o que impede conferir/avisar duas vezes
  recebido_em   timestamptz,
  de_nome       text not null default '',
  de_email      text not null default '',
  assunto       text not null default '',
  categoria     text not null default '',      -- do filtro do v29: importante, util, fraude, propaganda, ignorar, revisar
  anexos        jsonb not null default '[]'::jsonb,   -- [{nome, kb, baixa, aviso, nfe:{chave,no_sistema}, boleto:{linha,no_sistema}}]
  pendencias    text[] not null default '{}',  -- "anexo que não abre", "NF fora do sistema", "boleto fora do sistema"
  avisado       boolean not null default false,
  avisado_em    timestamptz,
  conferido_em  timestamptz not null default now()
);

create index if not exists email_robo_recente on public.email_robo (conferido_em desc);
create index if not exists email_robo_pendencia on public.email_robo (conferido_em desc) where cardinality(pendencias) > 0;

alter table public.email_robo enable row level security;

-- a equipe não lê; o administrador lê (é a tela do robô). Só a função "email" grava, com a chave de servidor.
drop policy if exists email_robo_ler on public.email_robo;
create policy email_robo_ler on public.email_robo for select to authenticated using (public.e_admin());

revoke all on public.email_robo from anon;
grant select on public.email_robo to authenticated;
grant usage, select on sequence public.email_robo_id_seq to service_role;

-- o agente de IA não lê (log operacional, como email_envios e backup_execucoes)
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    execute 'revoke all on public.email_robo from agente_leitura';
  end if;
end $$;

-- limpeza: o robô guarda 30 dias. Sem isso a tabela cresce para sempre com dado que ninguém mais olha.
create or replace function public.email_robo_limpar()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_n integer;
begin
  delete from public.email_robo where conferido_em < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.email_robo_limpar() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('dtcar-email-robo-limpar') where exists (select 1 from cron.job where jobname = 'dtcar-email-robo-limpar');
    perform cron.schedule('dtcar-email-robo-limpar', '20 4 * * *', $cron$ select public.email_robo_limpar(); $cron$);
  end if;
exception when others then
  raise notice 'pg_cron não configurado: a limpeza do robô do e-mail fica para a próxima.';
end $$;

comment on table public.email_robo is
  'O que o robô do e-mail já conferiu (v64, 24/11/2026). Log operacional: fora do backup, do banco do PC, da restauração e das exclusões; preservada pelo espelho. Quem grava é a função "email" com a chave de servidor; o administrador só lê.';
