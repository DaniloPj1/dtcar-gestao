-- =====================================================================
-- DTCar Gestão — versão 6
-- Notas fiscais de compra buscadas direto na SEFAZ (Distribuição DF-e)
-- com o certificado digital A1 da empresa. Rode DEPOIS do v5.sql.
-- Pode ser executado mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Segredos: senha do certificado e chave do agendamento.
-- Sem nenhuma regra de acesso: só o servidor (service role) lê.
-- ---------------------------------------------------------------------
create table if not exists public.segredos (
  chave text primary key,
  valor text not null,
  atualizado_em timestamptz not null default now()
);
alter table public.segredos enable row level security;
revoke all on public.segredos from anon, authenticated;
insert into public.segredos (chave, valor) values ('cron', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (chave) do nothing;

-- ---------------------------------------------------------------------
-- Configuração e situação da busca na SEFAZ (uma linha só)
-- ---------------------------------------------------------------------
create table if not exists public.sefaz_config (
  id int primary key default 1 check (id = 1),
  ativo boolean not null default false,
  ciencia_automatica boolean not null default true,
  uf_autor int not null default 32,              -- 32 = Espírito Santo
  cnpj text not null default '',
  titular text not null default '',
  validade timestamptz,
  ult_nsu text not null default '000000000000000',
  max_nsu text not null default '000000000000000',
  ultima_consulta timestamptz,
  proxima_consulta timestamptz,
  ultimo_status text not null default '',
  ultimo_erro text not null default '',
  atualizado_em timestamptz not null default now()
);
insert into public.sefaz_config (id) values (1) on conflict (id) do nothing;
grant select on public.sefaz_config to authenticated;
grant update (ciencia_automatica, ativo) on public.sefaz_config to authenticated;
alter table public.sefaz_config enable row level security;
drop policy if exists sefaz_config_ler on public.sefaz_config;
drop policy if exists sefaz_config_alterar on public.sefaz_config;
create policy sefaz_config_ler on public.sefaz_config for select to authenticated using (public.e_gestor());
create policy sefaz_config_alterar on public.sefaz_config for update to authenticated using (public.e_admin()) with check (public.e_admin());

-- ---------------------------------------------------------------------
-- Notas recebidas da SEFAZ (resumo e, depois da ciência, o XML completo)
-- ---------------------------------------------------------------------
create table if not exists public.nfe_recebidas (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  nsu text not null default '',
  cnpj_emitente text not null default '',
  nome_emitente text not null default '',
  ie_emitente text not null default '',
  numero text not null default '',
  serie text not null default '',
  emissao timestamptz,
  valor numeric(14, 2) not null default 0,
  tipo_nf int,                                   -- 0 entrada, 1 saída (do ponto de vista do emitente)
  situacao text not null default 'autorizada' check (situacao in ('autorizada', 'denegada', 'cancelada')),
  xml text,                                      -- XML completo (procNFe), quando liberado
  manifestacao text not null default '' check (manifestacao in ('', 'ciencia', 'confirmada', 'desconhecida', 'nao_realizada')),
  manifestada_em timestamptz,
  manifestacao_erro text not null default '',
  status text not null default 'nova' check (status in ('nova', 'lancada', 'ignorada')),
  nota_id uuid references public.notas_entrada (id) on delete set null,
  contas_lancadas boolean not null default false,
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.nfe_recebidas add column if not exists tem_xml boolean generated always as (xml is not null) stored;
create index if not exists nfe_recebidas_status on public.nfe_recebidas (status, emissao desc);
create index if not exists nfe_recebidas_atualizado on public.nfe_recebidas (atualizado_em);
drop trigger if exists nfe_recebidas_atualizado on public.nfe_recebidas;
create trigger nfe_recebidas_atualizado before update on public.nfe_recebidas for each row execute function public.toca_atualizado();
grant select on public.nfe_recebidas to authenticated;
grant update (status, obs, contas_lancadas) on public.nfe_recebidas to authenticated;
alter table public.nfe_recebidas enable row level security;
drop policy if exists nfe_recebidas_ler on public.nfe_recebidas;
drop policy if exists nfe_recebidas_alterar on public.nfe_recebidas;
create policy nfe_recebidas_ler on public.nfe_recebidas for select to authenticated using (public.e_gestor());
create policy nfe_recebidas_alterar on public.nfe_recebidas for update to authenticated using (public.e_gestor()) with check (public.e_gestor());

-- quando a nota é lançada pela Entrada de nota, marca como lançada aqui
create or replace function public.nfe_recebida_lancada() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.nfe_recebidas set status = 'lancada', nota_id = new.id where chave = new.chave;
  return new;
end $$;
drop trigger if exists notas_entrada_sefaz on public.notas_entrada;
create trigger notas_entrada_sefaz after insert on public.notas_entrada for each row execute function public.nfe_recebida_lancada();
update public.nfe_recebidas r set status = 'lancada', nota_id = n.id from public.notas_entrada n where n.chave = r.chave and r.status = 'nova';

-- o backup passa a incluir as notas da SEFAZ
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas') then
    raise exception 'Tabela não permitida: %', p_tabela;
  end if;
  perform set_config('dtcar.sem_estoque', '1', true);
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into cols
  from pg_attribute a where a.attrelid = ('public.' || p_tabela)::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = '';
  execute format('select count(*) from public.%I', p_tabela) into antes;
  q := format('insert into public.%1$I (%2$s) overriding system value select %2$s from jsonb_populate_recordset(null::public.%1$I, $1) on conflict do nothing', p_tabela, cols);
  begin
    execute q using p_linhas;
  exception when others then
    -- algum registro com problema (ex.: ligado a um usuário que não existe mais): tenta um a um
    for r in select * from jsonb_array_elements(p_linhas) loop
      begin execute q using jsonb_build_array(r); exception when others then erros := erros + 1; end;
    end loop;
  end;
  execute format('select count(*) from public.%I', p_tabela) into depois;
  return jsonb_build_object('incluidos', depois - antes, 'erros', erros);
end $$;

-- ---------------------------------------------------------------------
-- Agendamento: chama a função "sefaz" de hora em hora (minuto 7).
-- A própria função respeita a espera de 1 hora exigida pela SEFAZ.
-- ---------------------------------------------------------------------
create extension if not exists pg_net;
create extension if not exists pg_cron;
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'dtcar-sefaz';
end $$;
select cron.schedule('dtcar-sefaz', '7 * * * *', $cron$
  select net.http_post(
    url := 'https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/sefaz',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dtcar-cron', (select valor from public.segredos where chave = 'cron')),
    body := '{"acao":"consultar","origem":"agendamento"}'::jsonb,
    timeout_milliseconds := 120000)
  where (select ativo from public.sefaz_config where id = 1)
$cron$);
