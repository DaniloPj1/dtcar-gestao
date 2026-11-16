-- v59 (16/11/2026, pedido do Danilo): COMPRAS — etapa 1 (banco e tela).
-- Pesquisar a peça (pela placa do carro ou pelo código/descrição), ver o preço de cada fornecedor numa tela só, pôr no carrinho
-- e, ao comprar, o carrinho vira UM PEDIDO POR FORNECEDOR, que o Danilo finaliza em cada fornecedor (site, WhatsApp ou vendedor).
-- Nada é comprado sozinho: o sistema só monta os pedidos.
--
--   compras_fornecedores   fornecedor conectado (Ajustes › Fornecedores conectados): tipo de acesso, endereço do webservice ou do
--                          portal e o usuário. A SENHA (ou chave do webservice) NUNCA fica aqui: vai para a tabela segredos
--                          (chave 'compras_acesso:<id>'), que ninguém do sistema lê; só a função compras_gravar_acesso grava e só
--                          o servidor (chave de servidor) lê — a consulta automática de cada fornecedor entra nas próximas etapas.
--   compras_precos         preço de uma peça num fornecedor, com a ORIGEM e a DATA: "manual" (o Danilo digitou o que o vendedor
--                          passou) ou "ao_vivo" (veio do webservice; só o servidor grava). A "última compra" não fica aqui: sai das
--                          notas de entrada (produto_fornecedor.ultimo_custo/ultima_compra), calculada na tela.
--   compras_carrinho       o que vai ser pedido, com o fornecedor e o preço escolhidos.
--   compras_pedidos        um pedido por fornecedor, gerado do carrinho pela compras_gerar_pedidos (numa transação).
--   compras_pedido_itens   itens do pedido (não mudam; para corrigir, "Voltar para o carrinho").
--
-- Situações do pedido: a_finalizar → finalizado (o Danilo fechou no fornecedor; nº do pedido no fornecedor opcional) ou
-- cancelado (motivo obrigatório; não volta). "Voltar para o carrinho" cancela o pedido e devolve os itens ao carrinho.
-- Compras não mexe em estoque, O.S. nem financeiro: a peça entra no estoque pela nota (Notas da SEFAZ) e a conta pelo boleto, como hoje.
-- Quem usa: administrador e consultor (e_gestor), como os valores de custo. Conexões e senhas: só o administrador.
--
-- Período de transição (espelho do OS Oficina): as cinco tabelas são PRESERVADAS, não entram em espelho_legado_zerar():
-- não existem no sistema antigo (uma carga nunca as traria de volta). As chaves estrangeiras apontam só para fornecedores,
-- que o espelho não apaga. A virada foi em 02/11/2026: antes ou depois dela, nada aqui é lançamento oficial de estoque ou dinheiro.
-- Backup, banco do PC (atualizado_em + exclusoes) e restauração incluídos. Pode rodar mais de uma vez.

create sequence if not exists public.compras_pedido_numero_seq start 1;

-- 1. fornecedores conectados -----------------------------------------------------------------------------------------
create table if not exists public.compras_fornecedores (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null unique references public.fornecedores (id) on delete cascade,
  tipo text not null default 'webservice' check (tipo in ('webservice', 'portal', 'sem_integracao')),
  endereco text not null default '',              -- endereço do webservice ou do portal (https://…)
  usuario text not null default '',               -- login no fornecedor (a senha fica em segredos)
  ativo boolean not null default true,
  situacao text not null default 'aguardando' check (situacao in ('aguardando', 'ok', 'erro')), -- só o servidor muda
  detalhe text not null default '',
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint compras_fornecedores_endereco check (endereco = '' or endereco ~* '^https?://')
);
create index if not exists compras_fornecedores_atualizado on public.compras_fornecedores (atualizado_em);

create or replace function public.compras_fornecedores_regras() returns trigger language plpgsql set search_path = public as $$
begin
  new.endereco := btrim(coalesce(new.endereco, '')); new.usuario := btrim(coalesce(new.usuario, '')); new.obs := btrim(coalesce(new.obs, ''));
  if current_user = 'authenticated' then          -- a tela não muda a situação da integração (é o servidor que conecta)
    if tg_op = 'INSERT' then new.situacao := 'aguardando'; new.detalhe := '';
    else new.situacao := old.situacao; new.detalhe := old.detalhe; end if;
  end if;
  if tg_op = 'UPDATE' then new.fornecedor_id := old.fornecedor_id; new.criado_em := old.criado_em; end if;
  return new;
end $$;
drop trigger if exists compras_fornecedores_regras on public.compras_fornecedores;
create trigger compras_fornecedores_regras before insert or update on public.compras_fornecedores for each row execute function public.compras_fornecedores_regras();

-- conexão apagada: a senha guardada vai junto
create or replace function public.compras_fornecedores_apagar_acesso() returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.segredos where chave = 'compras_acesso:' || old.id;
  return null;
end $$;
drop trigger if exists compras_fornecedores_apagar_acesso on public.compras_fornecedores;
create trigger compras_fornecedores_apagar_acesso after delete on public.compras_fornecedores for each row execute function public.compras_fornecedores_apagar_acesso();

-- 2. preços por fornecedor ----------------------------------------------------------------------------------------------
create table if not exists public.compras_precos (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores (id) on delete cascade,
  codigo text not null,                           -- código da peça como o fornecedor vende (marca + código ou original)
  codigo_norm text not null default '',           -- só letras e números, maiúsculas (calculado pelo banco)
  marca text not null default '',
  descricao text not null default '',
  preco numeric(12, 2) not null check (preco > 0),
  estoque numeric(12, 3) check (estoque is null or estoque >= 0),   -- quanto o fornecedor tem (vazio = não informado)
  prazo text not null default '',                 -- ex.: "amanhã", "2 dias úteis"
  origem text not null default 'manual' check (origem in ('ao_vivo', 'manual')),
  consultado_em timestamptz not null default now(),
  criado_por_nome text not null default '',
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint compras_precos_codigo check (btrim(codigo) <> '')
);
create unique index if not exists compras_precos_unico on public.compras_precos (fornecedor_id, codigo_norm);
create index if not exists compras_precos_codigo on public.compras_precos (codigo_norm);
create index if not exists compras_precos_atualizado on public.compras_precos (atualizado_em);

create or replace function public.compras_precos_regras() returns trigger language plpgsql set search_path = public as $$
begin
  new.codigo := btrim(new.codigo);
  new.codigo_norm := upper(regexp_replace(new.codigo, '[^A-Za-z0-9]', '', 'g'));
  if new.codigo_norm = '' then raise exception 'Informe o código da peça.' using errcode = 'check_violation'; end if;
  new.marca := upper(btrim(coalesce(new.marca, ''))); new.descricao := upper(btrim(coalesce(new.descricao, '')));
  new.prazo := btrim(coalesce(new.prazo, '')); new.obs := btrim(coalesce(new.obs, ''));
  if current_user = 'authenticated' then
    -- preço digitado na tela é sempre "manual", com a data de agora; "ao vivo" só o servidor grava (webservice do fornecedor)
    -- (a tela só grava quando a pessoa clica "Guardar preço": confirmar o MESMO preço hoje também renova a data)
    new.origem := 'manual'; new.consultado_em := now();
    new.criado_por_nome := coalesce((select nome from public.perfis where id = auth.uid()), '');
  end if;
  if tg_op = 'UPDATE' then new.criado_em := old.criado_em; end if;
  return new;
end $$;
drop trigger if exists compras_precos_regras on public.compras_precos;
create trigger compras_precos_regras before insert or update on public.compras_precos for each row execute function public.compras_precos_regras();

-- 3. carrinho -----------------------------------------------------------------------------------------------------------
create table if not exists public.compras_carrinho (
  id uuid primary key default gen_random_uuid(),
  fornecedor_id uuid not null references public.fornecedores (id) on delete cascade,
  codigo text not null default '',
  marca text not null default '',
  descricao text not null,
  qtd numeric(12, 3) not null default 1 check (qtd > 0),
  preco numeric(12, 2) not null check (preco >= 0),
  origem_preco text not null default 'manual' check (origem_preco in ('ao_vivo', 'manual', 'ultima_compra')),
  preco_em timestamptz,                           -- data do preço (consulta ou última compra)
  os_numero int,                                  -- O.S. para a qual a peça vai (opcional; sem chave estrangeira)
  placa text not null default '',
  obs text not null default '',
  criado_por_nome text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint compras_carrinho_descricao check (btrim(descricao) <> '')
);
create index if not exists compras_carrinho_atualizado on public.compras_carrinho (atualizado_em);

create or replace function public.compras_carrinho_regras() returns trigger language plpgsql set search_path = public as $$
begin
  new.codigo := btrim(coalesce(new.codigo, '')); new.marca := upper(btrim(coalesce(new.marca, ''))); new.descricao := upper(btrim(new.descricao));
  new.placa := upper(regexp_replace(coalesce(new.placa, ''), '[^A-Za-z0-9]', '', 'g')); new.obs := btrim(coalesce(new.obs, ''));
  if tg_op = 'INSERT' then
    if coalesce(new.criado_por_nome, '') = '' then new.criado_por_nome := coalesce((select nome from public.perfis where id = auth.uid()), ''); end if;
  else
    new.criado_por_nome := old.criado_por_nome; new.criado_em := old.criado_em;
    -- preço trocado à mão no carrinho deixa de ser o da consulta ou da nota
    if current_user = 'authenticated' and new.preco is distinct from old.preco then new.origem_preco := 'manual'; new.preco_em := now(); end if;
  end if;
  return new;
end $$;
drop trigger if exists compras_carrinho_regras on public.compras_carrinho;
create trigger compras_carrinho_regras before insert or update on public.compras_carrinho for each row execute function public.compras_carrinho_regras();

-- 4. pedidos (um por fornecedor) ----------------------------------------------------------------------------------------
create table if not exists public.compras_pedidos (
  id uuid primary key default gen_random_uuid(),
  numero int not null unique default nextval('public.compras_pedido_numero_seq'),
  fornecedor_id uuid references public.fornecedores (id) on delete set null,
  fornecedor_nome text not null default '',       -- cópia: o pedido continua legível se o cadastro mudar ou sair
  situacao text not null default 'a_finalizar' check (situacao in ('a_finalizar', 'finalizado', 'cancelado')),
  total numeric(12, 2) not null default 0 check (total >= 0),
  documento text not null default '',             -- nº do pedido no fornecedor (informado ao finalizar)
  motivo text not null default '',                -- por que foi cancelado
  obs text not null default '',
  finalizado_em timestamptz,
  finalizado_por_nome text not null default '',
  criado_por_nome text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint compras_pedidos_motivo check (situacao <> 'cancelado' or btrim(motivo) <> '')
);
create index if not exists compras_pedidos_situacao on public.compras_pedidos (situacao, criado_em);
create index if not exists compras_pedidos_atualizado on public.compras_pedidos (atualizado_em);

create table if not exists public.compras_pedido_itens (
  id uuid primary key default gen_random_uuid(),
  pedido_id uuid not null references public.compras_pedidos (id) on delete cascade,
  posicao int not null default 0,
  codigo text not null default '',
  marca text not null default '',
  descricao text not null,
  qtd numeric(12, 3) not null check (qtd > 0),
  preco numeric(12, 2) not null check (preco >= 0),
  origem_preco text not null default 'manual',
  preco_em timestamptz,
  os_numero int,
  placa text not null default '',
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists compras_pedido_itens_pedido on public.compras_pedido_itens (pedido_id);
create index if not exists compras_pedido_itens_atualizado on public.compras_pedido_itens (atualizado_em);

-- número: quem inclui com número (restauração de backup) empurra a sequência; a tela só muda situação, nº no fornecedor, motivo e obs
create or replace function public.compras_pedidos_regras() returns trigger language plpgsql set search_path = public as $$
declare quem text := coalesce((select nome from public.perfis where id = auth.uid()), '');
begin
  if tg_op = 'INSERT' then
    if new.numero is null then new.numero := nextval('public.compras_pedido_numero_seq');
    elsif new.numero >= (select last_value from public.compras_pedido_numero_seq) then perform setval('public.compras_pedido_numero_seq', new.numero, true);
    end if;
  else
    if current_user = 'authenticated' then
      new.numero := old.numero; new.fornecedor_id := old.fornecedor_id; new.fornecedor_nome := old.fornecedor_nome; new.total := old.total;
      new.criado_por_nome := old.criado_por_nome; new.criado_em := old.criado_em;
      if old.situacao = 'cancelado' and new.situacao <> 'cancelado' then raise exception 'Pedido cancelado não volta. Gere outro pelo carrinho.'; end if;
    end if;
    if new.situacao = 'finalizado' and old.situacao <> 'finalizado' then new.finalizado_em := now(); new.finalizado_por_nome := quem;
    elsif new.situacao <> 'finalizado' then new.finalizado_em := null; new.finalizado_por_nome := '';
    end if;
  end if;
  new.documento := btrim(coalesce(new.documento, '')); new.obs := btrim(coalesce(new.obs, ''));
  if new.situacao <> 'cancelado' then new.motivo := ''; else new.motivo := btrim(coalesce(new.motivo, '')); end if;
  return new;
end $$;
drop trigger if exists compras_pedidos_regras on public.compras_pedidos;
create trigger compras_pedidos_regras before insert or update on public.compras_pedidos for each row execute function public.compras_pedidos_regras();

-- 5. data de alteração, aviso de exclusão ao banco do PC (v13) e regras de acesso ---------------------------------------
do $$
declare t text;
begin
  foreach t in array array['compras_fornecedores', 'compras_precos', 'compras_carrinho', 'compras_pedidos', 'compras_pedido_itens'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_toca', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.toca_atualizado()', t || '_toca', t);
    execute format('drop trigger if exists %I on public.%I', t || '_exclusao', t);
    execute format('create trigger %I after delete on public.%I for each row execute function public.registra_exclusao()', t || '_exclusao', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
-- quem lê: administrador e consultor (custos e preços dos fornecedores; o mecânico não vê valores)
drop policy if exists compras_fornecedores_ler on public.compras_fornecedores;
create policy compras_fornecedores_ler on public.compras_fornecedores for select to authenticated using (public.e_gestor());
drop policy if exists compras_fornecedores_incluir on public.compras_fornecedores;
create policy compras_fornecedores_incluir on public.compras_fornecedores for insert to authenticated with check (public.e_admin());
drop policy if exists compras_fornecedores_alterar on public.compras_fornecedores;
create policy compras_fornecedores_alterar on public.compras_fornecedores for update to authenticated using (public.e_admin()) with check (public.e_admin());
drop policy if exists compras_fornecedores_excluir on public.compras_fornecedores;
create policy compras_fornecedores_excluir on public.compras_fornecedores for delete to authenticated using (public.e_admin());
grant select, insert, update, delete on public.compras_fornecedores to authenticated;

do $$
declare t text;
begin
  foreach t in array array['compras_precos', 'compras_carrinho'] loop
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.e_gestor())', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_incluir', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.e_gestor())', t || '_incluir', t);
    execute format('drop policy if exists %I on public.%I', t || '_alterar', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.e_gestor()) with check (public.e_gestor())', t || '_alterar', t);
    execute format('drop policy if exists %I on public.%I', t || '_excluir', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.e_gestor())', t || '_excluir', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- pedidos e itens só nascem pela compras_gerar_pedidos (o banco soma o total); a tela muda a situação; só o administrador apaga
drop policy if exists compras_pedidos_ler on public.compras_pedidos;
create policy compras_pedidos_ler on public.compras_pedidos for select to authenticated using (public.e_gestor());
drop policy if exists compras_pedidos_alterar on public.compras_pedidos;
create policy compras_pedidos_alterar on public.compras_pedidos for update to authenticated using (public.e_gestor()) with check (public.e_gestor());
drop policy if exists compras_pedidos_excluir on public.compras_pedidos;
create policy compras_pedidos_excluir on public.compras_pedidos for delete to authenticated using (public.e_admin());
revoke all on public.compras_pedidos from authenticated;
grant select, update, delete on public.compras_pedidos to authenticated;
drop policy if exists compras_pedido_itens_ler on public.compras_pedido_itens;
create policy compras_pedido_itens_ler on public.compras_pedido_itens for select to authenticated using (public.e_gestor());
revoke all on public.compras_pedido_itens from authenticated;
grant select on public.compras_pedido_itens to authenticated;

-- papel só de leitura do agente (v19): lê compras e preços; das conexões, sem o usuário do fornecedor
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    revoke all on public.compras_fornecedores, public.compras_precos, public.compras_carrinho, public.compras_pedidos, public.compras_pedido_itens from agente_leitura;
    grant select (id, fornecedor_id, tipo, endereco, ativo, situacao, detalhe, obs, criado_em, atualizado_em) on public.compras_fornecedores to agente_leitura;
    grant select on public.compras_precos, public.compras_carrinho, public.compras_pedidos, public.compras_pedido_itens to agente_leitura;
    drop policy if exists compras_fornecedores_agente_ler on public.compras_fornecedores;
    create policy compras_fornecedores_agente_ler on public.compras_fornecedores for select to agente_leitura using (true);
    drop policy if exists compras_precos_agente_ler on public.compras_precos;
    create policy compras_precos_agente_ler on public.compras_precos for select to agente_leitura using (true);
    drop policy if exists compras_carrinho_agente_ler on public.compras_carrinho;
    create policy compras_carrinho_agente_ler on public.compras_carrinho for select to agente_leitura using (true);
    drop policy if exists compras_pedidos_agente_ler on public.compras_pedidos;
    create policy compras_pedidos_agente_ler on public.compras_pedidos for select to agente_leitura using (true);
    drop policy if exists compras_pedido_itens_agente_ler on public.compras_pedido_itens;
    create policy compras_pedido_itens_agente_ler on public.compras_pedido_itens for select to agente_leitura using (true);
  end if;
end $$;

-- 6. funções -------------------------------------------------------------------------------------------------------------
-- Senha (ou chave do webservice) do fornecedor: grava em segredos e NUNCA devolve o valor. Vazio = apagar a senha guardada.
create or replace function public.compras_gravar_acesso(p_conexao uuid, p_senha text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k text := 'compras_acesso:' || p_conexao;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador grava o acesso dos fornecedores.'; end if;
  if not exists (select 1 from public.compras_fornecedores where id = p_conexao) then raise exception 'Fornecedor conectado não encontrado.'; end if;
  if coalesce(btrim(p_senha), '') = '' then
    delete from public.segredos where chave = k;
    return jsonb_build_object('gravado', false);
  end if;
  if length(p_senha) > 2000 then raise exception 'Senha ou chave longa demais.'; end if;
  insert into public.segredos (chave, valor, atualizado_em) values (k, p_senha, now())
    on conflict (chave) do update set valor = excluded.valor, atualizado_em = now();
  return jsonb_build_object('gravado', true, 'gravado_em', now());
end $$;
revoke all on function public.compras_gravar_acesso(uuid, text) from public, anon;
grant execute on function public.compras_gravar_acesso(uuid, text) to authenticated;

-- Quais conexões têm senha guardada e desde quando (sem o valor)
create or replace function public.compras_acessos()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.e_admin() then raise exception 'Apenas o administrador vê os acessos dos fornecedores.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'gravado_em', s.atualizado_em))
    from public.compras_fornecedores c join public.segredos s on s.chave = 'compras_acesso:' || c.id), '[]'::jsonb);
end $$;
revoke all on function public.compras_acessos() from public, anon;
grant execute on function public.compras_acessos() to authenticated;

-- Carrinho → um pedido por fornecedor, numa transação. p_itens = ids escolhidos (vazio/null = o carrinho inteiro).
-- Os itens são travados primeiro: dois cliques ao mesmo tempo não geram pedido em dobro (o segundo não acha mais os itens).
create or replace function public.compras_gerar_pedidos(p_itens uuid[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ids uuid[]; f record; ped public.compras_pedidos; res jsonb := '[]'::jsonb; n int;
        quem text := coalesce((select nome from public.perfis where id = auth.uid()), '');
begin
  if not public.e_gestor() then raise exception 'Seu usuário não pode gerar pedidos de compra.'; end if;
  select coalesce(array_agg(id), '{}') into ids from (
    select c.id from public.compras_carrinho c where p_itens is null or cardinality(p_itens) = 0 or c.id = any(p_itens) for update) x;
  if cardinality(ids) = 0 then raise exception 'O carrinho está vazio.'; end if;
  for f in select c.fornecedor_id, coalesce(nullif(btrim(fo.fantasia), ''), fo.razao) as nome,
                  sum(round(c.qtd * c.preco, 2)) as total, count(*) as itens
           from public.compras_carrinho c join public.fornecedores fo on fo.id = c.fornecedor_id
           where c.id = any(ids) group by c.fornecedor_id, fo.fantasia, fo.razao order by 2 loop
    insert into public.compras_pedidos (fornecedor_id, fornecedor_nome, total, criado_por_nome)
      values (f.fornecedor_id, f.nome, f.total, quem) returning * into ped;
    insert into public.compras_pedido_itens (pedido_id, posicao, codigo, marca, descricao, qtd, preco, origem_preco, preco_em, os_numero, placa, obs)
      select ped.id, (row_number() over (order by c.criado_em, c.id))::int - 1, c.codigo, c.marca, c.descricao, c.qtd, c.preco, c.origem_preco,
             c.preco_em, c.os_numero, c.placa, c.obs
      from public.compras_carrinho c where c.id = any(ids) and c.fornecedor_id = f.fornecedor_id;
    get diagnostics n = row_count;
    res := res || jsonb_build_object('id', ped.id, 'numero', ped.numero, 'fornecedor', ped.fornecedor_nome, 'total', ped.total, 'itens', n);
  end loop;
  delete from public.compras_carrinho where id = any(ids);
  return res;
end $$;
revoke all on function public.compras_gerar_pedidos(uuid[]) from public, anon;
grant execute on function public.compras_gerar_pedidos(uuid[]) to authenticated;

-- Pedido ainda não finalizado volta para o carrinho (para trocar quantidade, fornecedor ou tirar item): cancela o pedido com o motivo
create or replace function public.compras_pedido_voltar(p_pedido uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ped public.compras_pedidos; n int;
begin
  if not public.e_gestor() then raise exception 'Seu usuário não pode mexer nos pedidos de compra.'; end if;
  select * into ped from public.compras_pedidos where id = p_pedido for update;
  if not found then raise exception 'Pedido não encontrado.'; end if;
  if ped.situacao <> 'a_finalizar' then raise exception 'Só volta para o carrinho o pedido que ainda não foi finalizado nem cancelado.'; end if;
  if ped.fornecedor_id is null or not exists (select 1 from public.fornecedores where id = ped.fornecedor_id) then
    raise exception 'O fornecedor deste pedido saiu do cadastro: cancele o pedido.'; end if;
  insert into public.compras_carrinho (fornecedor_id, codigo, marca, descricao, qtd, preco, origem_preco, preco_em, os_numero, placa, obs, criado_por_nome)
    select ped.fornecedor_id, i.codigo, i.marca, i.descricao, i.qtd, i.preco, i.origem_preco, i.preco_em, i.os_numero, i.placa, i.obs, ped.criado_por_nome
    from public.compras_pedido_itens i where i.pedido_id = ped.id order by i.posicao;
  get diagnostics n = row_count;
  update public.compras_pedidos set situacao = 'cancelado', motivo = 'Voltou para o carrinho' where id = ped.id;
  return jsonb_build_object('pedido', ped.numero, 'itens', n);
end $$;
revoke all on function public.compras_pedido_voltar(uuid) from public, anon;
grant execute on function public.compras_pedido_voltar(uuid) to authenticated;

-- 7. backup: a restauração passa a aceitar as compras (resto igual ao v54)
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text; ausentes uuid[] := '{}';
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias', 'estornos_saldo',
                      'pre_notas', 'pre_notas_itens', 'agente_acoes', 'agente_regras', 'boletos', 'boletos_arquivos',
                      'orcamentos', 'orcamento_itens', 'agendamentos',
                      'compras_fornecedores', 'compras_precos', 'compras_carrinho', 'compras_pedidos', 'compras_pedido_itens') then
    raise exception 'Tabela não permitida: %', p_tabela;
  end if;
  perform set_config('dtcar.sem_estoque', '1', true);
  -- backup feito antes da v18 não tem as colunas novas: sem isso elas viriam nulas e a linha seria recusada
  if p_tabela = 'contas' then
    p_linhas := (select coalesce(jsonb_agg(jsonb_build_object('conta_origem', '') || jsonb_strip_nulls(e)), '[]'::jsonb) from jsonb_array_elements(p_linhas) e);
  elsif p_tabela = 'recibos' then
    p_linhas := (select coalesce(jsonb_agg(jsonb_build_object('conta_destino', '') || jsonb_strip_nulls(e)), '[]'::jsonb) from jsonb_array_elements(p_linhas) e);
  end if;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a where a.attrelid = ('public.' || p_tabela)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  -- registros que vão voltar (ainda não existem): se tinham estornos (foram excluídos), a volta compensa
  if p_tabela in ('transferencias', 'recibos', 'contas') then
    execute format('select coalesce(array_agg((x->>''id'')::uuid), ''{}'') from jsonb_array_elements($1) x where not exists (select 1 from public.%I t where t.id = (x->>''id'')::uuid)', p_tabela)
      into ausentes using p_linhas;
  end if;
  execute format('select count(*) from public.%I', p_tabela) into antes;
  q := format('insert into public.%1$I (%2$s) overriding system value select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing', p_tabela, cols);
  begin
    execute q using p_linhas;
  exception when others then
    for r in select * from jsonb_array_elements(p_linhas) loop
      begin execute q using jsonb_build_array(r); exception when others then erros := erros + 1; end;
    end loop;
  end;
  execute format('select count(*) from public.%I', p_tabela) into depois;
  -- registro que voltou e tinha estornos (foi excluído depois de entrar no saldo): grava o efeito do estado restaurado
  -- (Σ estornos = efeito atual − efeito na referência; o registro estava ausente, efeito atual 0 → soma-se o efeito do que voltou)
  if array_length(ausentes, 1) > 0 then
    if p_tabela = 'transferencias' then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
      select x.conta, x.valor, 'restauracao', t.id, t.criado_em from public.transferencias t
        cross join lateral (values (t.de_conta, -t.valor), (t.para_conta, t.valor)) x(conta, valor)
        where t.id = any(ausentes) and exists (select 1 from public.estornos_saldo e where e.registro = t.id);
    elsif p_tabela = 'recibos' then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
      select r.conta_destino, r.valor, 'restauracao', r.id, r.criado_em from public.recibos r
        where r.id = any(ausentes) and not r.cancelado and r.conta_destino <> '' and exists (select 1 from public.estornos_saldo e where e.registro = r.id);
    elsif p_tabela = 'contas' then
      insert into public.estornos_saldo (conta, valor, origem, registro, original_em)
      select c.conta_origem, -coalesce(c.valor_pago, c.valor), 'restauracao', c.id,
             coalesce(c.pago_registrado_em, (select min(e.original_em) from public.estornos_saldo e where e.registro = c.id)) from public.contas c
        where c.id = any(ausentes) and c.status = 'paga' and c.conta_origem <> '' and exists (select 1 from public.estornos_saldo e where e.registro = c.id);
    end if;
  end if;
  return jsonb_build_object('incluidos', depois - antes, 'erros', erros);
end $$;
revoke all on function public.restaurar_tabela(text, jsonb) from public, anon;
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;
