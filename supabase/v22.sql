-- =====================================================================
-- DTCar Gestão — v22: WhatsApp da oficina, etapa 1 (teste de viabilidade).
--
-- Base para a conexão própria com o WhatsApp (biblioteca Baileys), rodando na
-- função "zap" do Supabase. Nesta etapa a função só testa a conexão, faz o
-- pareamento do celular da oficina por código e confere se a sessão guardada
-- volta a conectar. Ainda não envia nem recebe mensagens.
--
--   whatsapp_conexao: situação da conexão (uma linha), lida pela tela
--                     Sistema › WhatsApp (só administrador).
--   whatsapp_sessao:  chaves da sessão do WhatsApp. Quem tem essas chaves tem o
--                     WhatsApp do número inteiro: NINGUÉM do sistema lê esta
--                     tabela, nem o administrador. Só a função "zap" (chave de
--                     servidor). Fica fora do backup de propósito.
--
-- Rode depois do v20 (o v21 do PR #16 não é necessário para este). Pode rodar
-- mais de uma vez. Não mexe em nada que já existe.
-- Espelho: desligado desde a virada. Estas tabelas não são dados da oficina
-- (O.S., cadastro, dinheiro ou estoque) e são preservadas pelo espelho.
-- =====================================================================

create table if not exists public.whatsapp_conexao (
  id int primary key default 1 check (id = 1),
  situacao text not null default 'desligado' check (situacao in ('desligado', 'pareando', 'conectado', 'erro')),
  numero text not null default '',           -- número vinculado (depois do pareamento)
  dono text not null default '',             -- quem está segurando a conexão (supabase, pc, celular)
  detalhe text not null default '',          -- última mensagem para a tela (erro, código pedido, teste)
  ultimo_teste jsonb,                        -- resultado do último teste/conferência
  atualizado_em timestamptz not null default now()
);
insert into public.whatsapp_conexao (id) values (1) on conflict (id) do nothing;
alter table public.whatsapp_conexao enable row level security;
drop policy if exists whatsapp_conexao_ler on public.whatsapp_conexao;
create policy whatsapp_conexao_ler on public.whatsapp_conexao for select to authenticated using (public.e_admin());
revoke all on public.whatsapp_conexao from anon, authenticated;
grant select on public.whatsapp_conexao to authenticated;

create table if not exists public.whatsapp_sessao (
  chave text primary key,                    -- 'creds' ou 'k:<tipo>:<id>'
  valor jsonb not null,
  atualizado_em timestamptz not null default now()
);
alter table public.whatsapp_sessao enable row level security;  -- sem política: ninguém lê pelo sistema
revoke all on public.whatsapp_sessao from anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    execute 'revoke all on public.whatsapp_sessao, public.whatsapp_conexao from agente_leitura';
  end if;
end $$;
