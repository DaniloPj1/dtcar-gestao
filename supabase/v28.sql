-- =====================================================================
-- v28 — Boletos Sicredi por arquivo (CNAB240 híbrido: boleto + QR Code Pix)
-- =====================================================================
-- O sistema gera o arquivo de remessa (registro dos boletos), o Danilo envia
-- no internet banking (Cobrança › Transferir Arquivos) e depois importa aqui o
-- arquivo de retorno (Cobrança › Arquivos de Retorno). O retorno confirma o
-- registro, traz o QR Code Pix e avisa os pagamentos, que viram recibo e baixa
-- da parcela em Contas a receber.
--
-- Tabelas novas:
--   boletos          um boleto registrado (ou a registrar) no Sicredi
--   boletos_arquivos remessas geradas e retornos importados (o retorno não é lido duas vezes)
-- Função nova:
--   cobranca_proximo(chave)  próximo número de uma sequência (Nosso Número do ano e número da remessa)
--
-- Espelho do sistema antigo: as duas tabelas ficam PRESERVADAS (não entram em
-- espelho_legado_zerar). Motivo: um boleto registrado no banco continua valendo
-- mesmo se as O.S. forem recarregadas; por isso não há chave estrangeira para
-- ordens, receber ou recibos (a ligação é por id, nº da O.S. e nome do cliente).
-- Idempotente: pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.boletos (
  id uuid primary key default gen_random_uuid(),
  receber_id uuid,                     -- parcela em Contas a receber (sem chave estrangeira, ver acima)
  ordem_id uuid,
  os_numero text not null default '',
  cliente_id uuid,
  pagador_nome text not null default '',
  pagador_doc text not null default '',
  pagador jsonb not null default '{}'::jsonb, -- endereço, CEP, cidade e UF usados no registro
  descricao text not null default '',
  valor numeric(12, 2) not null check (valor > 0),
  vencimento date not null,
  emissao date not null default current_date,
  nosso_numero text not null unique check (nosso_numero ~ '^[0-9]{9}$'),
  seu_numero text not null default '',
  codigo_barras text not null default '',
  linha_digitavel text not null default '',
  situacao text not null default 'gerado' check (situacao in ('gerado', 'enviado', 'registrado', 'rejeitado', 'pago', 'baixa_pedida', 'baixado')),
  ocorrencia text not null default '',  -- última mensagem do banco (ex.: "Entrada rejeitada: CEP inválido")
  qr_url text not null default '',
  txid text not null default '',
  remessa_id uuid,
  valor_pago numeric(12, 2),
  valor_liquido numeric(12, 2),
  tarifa numeric(12, 2) not null default 0,
  data_pagamento date,
  data_credito date,
  forma_pagamento text not null default '', -- Boleto ou Pix
  recibo_id uuid,
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists boletos_receber on public.boletos (receber_id);
create index if not exists boletos_ordem on public.boletos (ordem_id);
create index if not exists boletos_situacao on public.boletos (situacao, vencimento);
drop trigger if exists boletos_toca on public.boletos;
create trigger boletos_toca before update on public.boletos for each row execute function public.toca_atualizado();
drop trigger if exists boletos_exclusao on public.boletos;
create trigger boletos_exclusao after delete on public.boletos for each row execute function public.registra_exclusao();
alter table public.boletos enable row level security;
drop policy if exists boletos_ler on public.boletos;
create policy boletos_ler on public.boletos for select to authenticated using (public.e_membro());
drop policy if exists boletos_gravar on public.boletos;
create policy boletos_gravar on public.boletos for all to authenticated using (public.e_gestor()) with check (public.e_gestor());

create table if not exists public.boletos_arquivos (
  id uuid primary key default gen_random_uuid(),
  tipo text not null check (tipo in ('remessa', 'retorno')),
  nome text not null default '',
  sequencia int,                       -- número da remessa (header do arquivo)
  hash text,                           -- SHA-256 do retorno: o mesmo arquivo não é lido duas vezes
  conteudo text not null default '',
  resumo jsonb not null default '{}'::jsonb,
  criado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index if not exists boletos_arquivos_hash on public.boletos_arquivos (hash) where hash is not null;
drop trigger if exists boletos_arquivos_toca on public.boletos_arquivos;
create trigger boletos_arquivos_toca before update on public.boletos_arquivos for each row execute function public.toca_atualizado();
drop trigger if exists boletos_arquivos_exclusao on public.boletos_arquivos;
create trigger boletos_arquivos_exclusao after delete on public.boletos_arquivos for each row execute function public.registra_exclusao();
alter table public.boletos_arquivos enable row level security;
drop policy if exists boletos_arquivos_ler on public.boletos_arquivos;
create policy boletos_arquivos_ler on public.boletos_arquivos for select to authenticated using (public.e_gestor());
drop policy if exists boletos_arquivos_gravar on public.boletos_arquivos;
create policy boletos_arquivos_gravar on public.boletos_arquivos for all to authenticated using (public.e_gestor()) with check (public.e_gestor());

-- Sequências (Nosso Número por ano e número da remessa). Ficam fora do espelho e do backup:
-- se o banco fosse restaurado de um backup antigo, o número poderia repetir; por isso a
-- função nunca devolve número menor que o maior já usado nas tabelas.
create table if not exists public.cobranca_contadores (
  chave text primary key,
  valor int not null default 0
);
alter table public.cobranca_contadores enable row level security; -- sem política: só pela função

create or replace function public.cobranca_proximo(p_chave text)
returns int language plpgsql security definer set search_path = public as $$
declare v int; minimo int := 0;
begin
  if not public.e_gestor() then raise exception 'Sem permissão para emitir boletos.'; end if;
  if p_chave ~ '^nosso_numero:[0-9]{4}$' then
    -- maior sequencial já usado no ano (posições 4 a 8 do Nosso Número AABXXXXXD)
    select coalesce(max(substr(nosso_numero, 4, 5)::int), 0) into minimo from public.boletos
      where substr(nosso_numero, 1, 2) = right(split_part(p_chave, ':', 2), 2);
  elsif p_chave = 'remessa' then
    select coalesce(max(sequencia), 0) into minimo from public.boletos_arquivos where tipo = 'remessa';
  else
    raise exception 'Sequência desconhecida: %', p_chave;
  end if;
  insert into public.cobranca_contadores as c (chave, valor) values (p_chave, minimo + 1)
    on conflict (chave) do update set valor = greatest(c.valor, minimo) + 1
    returning valor into v;
  if p_chave like 'nosso_numero:%' and v > 99999 then raise exception 'Acabaram os números de boleto deste ano (99.999).'; end if;
  return v;
end $$;
revoke all on function public.cobranca_proximo(text) from public, anon;
grant execute on function public.cobranca_proximo(text) to authenticated;

-- Backup: a restauração passa a aceitar as tabelas de boletos (resto igual ao v19)
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text; ausentes uuid[] := '{}';
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc', 'receber', 'transferencias', 'estornos_saldo',
                      'pre_notas', 'pre_notas_itens', 'agente_acoes', 'agente_regras', 'boletos', 'boletos_arquivos') then
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
