-- =====================================================================
-- DTCar Gestão — v29: e-mail da oficina (Hotmail/Outlook) para o Claude.
--
-- O Claude lê e responde o e-mail da oficina pelo conector do DTCar Gestão,
-- sempre a pedido do Danilo. A ligação com a Microsoft (Microsoft Graph,
-- login da Microsoft com autorização da conta) fica na função "email".
--
--   email_conexao: situação (uma linha): conta conectada, chave liga/desliga,
--                  último uso. Lida pela tela Sistema › E-mail (administrador).
--   email_token:   chave de acesso da Microsoft. Quem tem essa chave lê e envia
--                  e-mail como a oficina: NINGUÉM do sistema lê esta tabela, nem
--                  o administrador. Só a função "email" (chave de servidor).
--                  A senha do Hotmail nunca passa pelo sistema.
--   email_regras:  filtro (remetentes e domínios importantes, ignorados e
--                  golpes conhecidos), alimentado pelas correções do Danilo.
--   email_envios:  histórico de tudo o que foi enviado ou respondido.
--
-- Nada é guardado do conteúdo dos e-mails: eles são lidos na Microsoft na hora
-- do pedido. Tabelas fora do backup, do banco do PC e do espelho (não são dados
-- da oficina: O.S., cadastro, dinheiro ou estoque). Pode rodar mais de uma vez.
-- Precisa do v20 (agente_acoes e e_admin). Independe dos v28 (WhatsApp/boletos).
-- =====================================================================

create table if not exists public.email_conexao (
  id int primary key default 1 check (id = 1),
  ligado boolean not null default true,      -- chave liga/desliga (desligado: o Claude não lê nem envia)
  situacao text not null default 'desligado' check (situacao in ('desligado', 'conectado', 'erro')),
  conta text not null default '',            -- endereço conectado (ex.: centroautomotivodtcar@hotmail.com)
  nome text not null default '',             -- nome da conta na Microsoft
  detalhe text not null default '',          -- último aviso para a tela
  conectado_em timestamptz,
  ultimo_uso timestamptz,
  atualizado_em timestamptz not null default now()
);
insert into public.email_conexao (id) values (1) on conflict (id) do nothing;
alter table public.email_conexao enable row level security;
drop policy if exists email_conexao_ler on public.email_conexao;
create policy email_conexao_ler on public.email_conexao for select to authenticated using (public.e_admin());
revoke all on public.email_conexao from anon, authenticated;
grant select on public.email_conexao to authenticated;

create table if not exists public.email_token (
  id int primary key default 1 check (id = 1),
  refresh_token text,                        -- renova o acesso (a Microsoft troca a cada uso)
  access_token text,                         -- vale ~1 hora
  expira_em timestamptz,
  estado text,                               -- login em andamento: código de conferência (10 minutos)
  verificador text,                          -- PKCE do login em andamento
  estado_ate timestamptz,
  atualizado_em timestamptz not null default now()
);
alter table public.email_token enable row level security;  -- sem política: ninguém lê pelo sistema
revoke all on public.email_token from anon, authenticated;

create table if not exists public.email_regras (
  id bigint generated always as identity primary key,
  tipo text not null check (tipo in ('importante', 'ignorar', 'fraude')),
  alvo text not null check (alvo in ('remetente', 'dominio', 'nome', 'assunto')),
  valor text not null,                       -- minúsculo, sem acento (a função grava assim)
  obs text not null default '',
  origem text not null default '',           -- padrao, danilo, claude
  ativo boolean not null default true,
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists email_regras_unica on public.email_regras (alvo, valor);
alter table public.email_regras enable row level security;
drop policy if exists email_regras_ler on public.email_regras;
create policy email_regras_ler on public.email_regras for select to authenticated using (public.e_admin());
revoke all on public.email_regras from anon, authenticated;
grant select on public.email_regras to authenticated;

create table if not exists public.email_envios (
  id bigint generated always as identity primary key,
  em timestamptz not null default now(),
  tipo text not null check (tipo in ('enviar', 'responder')),
  para text not null default '',
  cc text not null default '',
  assunto text not null default '',
  resumo text not null default '',           -- começo do texto enviado (até 300 letras)
  resposta_a text not null default '',       -- assunto/remetente do e-mail respondido
  pedido text not null default '',
  por text not null default ''
);
create index if not exists email_envios_em on public.email_envios (em);
alter table public.email_envios enable row level security;
drop policy if exists email_envios_ler on public.email_envios;
create policy email_envios_ler on public.email_envios for select to authenticated using (public.e_admin());
revoke all on public.email_envios from anon, authenticated;
grant select on public.email_envios to authenticated;

do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    execute 'revoke all on public.email_conexao, public.email_token, public.email_regras, public.email_envios from agente_leitura';
  end if;
end $$;

-- Regras de partida. Golpes: cobranças fraudulentas vistas no DDA em 02/11/2026 (nunca pagar).
-- Importantes: bancos e órgãos públicos usados pela oficina. O Danilo tira ou acrescenta na tela.
insert into public.email_regras (tipo, alvo, valor, obs, origem) values
  ('fraude', 'nome', 'id certificacao', 'Cobrança fraudulenta no DDA (02/11/2026)', 'padrao'),
  ('fraude', 'nome', 'sisbra', 'Cobrança fraudulenta no DDA (02/11/2026)', 'padrao'),
  ('fraude', 'nome', 'storehost', 'Cobrança fraudulenta no DDA (02/11/2026)', 'padrao'),
  ('fraude', 'nome', 'sesnat', 'Cobrança fraudulenta no DDA (02/11/2026)', 'padrao'),
  ('fraude', 'nome', 'speed tecnet', 'Cobrança fraudulenta no DDA (02/11/2026)', 'padrao'),
  ('fraude', 'nome', 'itev', 'Cobrança fraudulenta no DDA (02/11/2026)', 'padrao'),
  ('fraude', 'nome', 'costa ltda', 'Cobrança fraudulenta no DDA (02/11/2026)', 'padrao'),
  ('importante', 'dominio', 'sicredi.com.br', 'Banco', 'padrao'),
  ('importante', 'dominio', 'picpay.com', 'Banco', 'padrao'),
  ('importante', 'dominio', 'gov.br', 'Órgãos públicos (SEFAZ, Receita, prefeitura)', 'padrao'),
  ('importante', 'dominio', 'dpk.com.br', 'Fornecedor (portal de boletos)', 'padrao')
on conflict (alvo, valor) do nothing;

-- Situação para a tela e para o conector.
create or replace function public.email_resumo() returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare c public.email_conexao;
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no e-mail.'; end if;
  select * into c from public.email_conexao where id = 1;
  return to_jsonb(c) || jsonb_build_object(
    'regras', (select count(*) from public.email_regras where ativo),
    'enviados_hoje', (select count(*) from public.email_envios where em >= date_trunc('day', now() at time zone 'America/Sao_Paulo') at time zone 'America/Sao_Paulo'));
end $$;

-- E-mails cadastrados no sistema: fornecedores, prestadores, clientes e equipe (para o filtro: "sempre ler").
create or replace function public.email_contatos() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no e-mail.'; end if;
  return coalesce((select jsonb_agg(x) from (
    -- o campo e-mail pode ter mais de um endereço (separados por ; , ou espaço)
    select distinct on (e) e as email, t as tipo, n as nome from (
      select lower(trim(s)) e, case when f.prestador then 'prestador' else 'fornecedor' end t, coalesce(nullif(f.fantasia, ''), f.razao) n, 1 o
        from public.fornecedores f, regexp_split_to_table(coalesce(f.email, ''), '[;,\s]+') s where f.ativo
      union all
      select lower(trim(p.email)), 'equipe', p.nome, 2 from public.perfis p where p.ativo
      union all
      select lower(trim(s)), 'cliente', c.nome, 3 from public.clientes c, regexp_split_to_table(coalesce(c.email, ''), '[;,\s]+') s
    ) z where e ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' order by e, o) x), '[]'::jsonb);
end $$;

-- Cria ou troca uma regra do filtro (valor já normalizado pela função "email"; normaliza de novo o básico).
create or replace function public.email_regra_salvar(p_tipo text, p_alvo text, p_valor text, p_obs text default '', p_origem text default 'danilo')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v text := lower(trim(coalesce(p_valor, ''))); r public.email_regras; antes public.email_regras; quem text;
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no e-mail.'; end if;
  if p_tipo not in ('importante', 'ignorar', 'fraude') then raise exception 'Tipo de regra inválido: use importante, ignorar ou fraude.'; end if;
  if p_alvo not in ('remetente', 'dominio', 'nome', 'assunto') then raise exception 'Use remetente, dominio, nome ou assunto.'; end if;
  if p_alvo = 'remetente' then v := regexp_replace(v, '^.*<([^>]+)>.*$', '\1'); end if;
  if p_alvo = 'dominio' then v := regexp_replace(regexp_replace(v, '^.*@', ''), '^www\.', ''); end if;
  if length(v) < 2 or length(v) > 200 then raise exception 'Informe de 2 a 200 letras.'; end if;
  if p_alvo = 'remetente' and v !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Remetente precisa ser um e-mail completo (nome@dominio).'; end if;
  if p_alvo = 'dominio' and v !~ '^[a-z0-9.-]+\.[a-z]{2,}$' then raise exception 'Domínio inválido (ex.: fornecedor.com.br).'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  select * into antes from public.email_regras where alvo = p_alvo and valor = v;
  insert into public.email_regras (tipo, alvo, valor, obs, origem, criado_por)
  values (p_tipo, p_alvo, v, coalesce(p_obs, ''), coalesce(nullif(p_origem, ''), 'danilo'), coalesce(quem, ''))
  on conflict (alvo, valor) do update set tipo = excluded.tipo, obs = case when excluded.obs <> '' then excluded.obs else email_regras.obs end,
    origem = excluded.origem, ativo = true, atualizado_em = now()
  returning * into r;
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('email_regra', coalesce(p_obs, ''), 'email_regras', r.id::text, case when antes.id is null then null else to_jsonb(antes) end, to_jsonb(r), coalesce(quem, ''));
  return to_jsonb(r);
end $$;

create or replace function public.email_regra_remover(p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare r public.email_regras; antes public.email_regras; quem text;
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no e-mail.'; end if;
  select * into antes from public.email_regras where id = p_id;
  if antes.id is null then raise exception 'Regra não encontrada.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  update public.email_regras set ativo = false, atualizado_em = now() where id = p_id returning * into r;
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('email_regra', 'regra desativada', 'email_regras', r.id::text, to_jsonb(antes), to_jsonb(r), coalesce(quem, ''));
  return to_jsonb(r);
end $$;

-- Histórico de envio (chamada pela função "email" com o login do administrador, depois que a Microsoft aceitou o envio).
create or replace function public.email_registrar_envio(p jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; quem text;
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no e-mail.'; end if;
  select nome into quem from public.perfis where id = auth.uid();
  insert into public.email_envios (tipo, para, cc, assunto, resumo, resposta_a, pedido, por)
  values (coalesce(p->>'tipo', 'enviar'), left(coalesce(p->>'para', ''), 1000), left(coalesce(p->>'cc', ''), 1000), left(coalesce(p->>'assunto', ''), 300),
          left(coalesce(p->>'texto', ''), 300), left(coalesce(p->>'resposta_a', ''), 300), left(coalesce(p->>'pedido', ''), 500), coalesce(quem, ''))
  returning id into v_id;
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('email_' || coalesce(p->>'tipo', 'enviar'), coalesce(p->>'pedido', ''), 'email_envios', v_id::text, null,
          jsonb_build_object('para', p->>'para', 'cc', p->>'cc', 'assunto', p->>'assunto', 'resposta_a', p->>'resposta_a', 'resumo', left(coalesce(p->>'texto', ''), 300)),
          coalesce(quem, ''));
  update public.email_conexao set ultimo_uso = now() where id = 1;
  return v_id;
end $$;

-- Chave liga/desliga (a tela grava; a função "email" confere antes de ler ou enviar).
create or replace function public.email_ligar(p_ligado boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Só o administrador mexe no e-mail.'; end if;
  update public.email_conexao set ligado = coalesce(p_ligado, true), atualizado_em = now() where id = 1;
  return public.email_resumo();
end $$;

do $$
declare f text;
begin
  foreach f in array array['email_resumo()', 'email_contatos()', 'email_regra_salvar(text, text, text, text, text)', 'email_regra_remover(bigint)',
                           'email_registrar_envio(jsonb)', 'email_ligar(boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
