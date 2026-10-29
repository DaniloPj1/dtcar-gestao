-- =====================================================================
-- DTCar Gestão — versão 10
-- Funcionários: cadastro, jornada de trabalho (folha de ponto impressa)
-- e lançamentos do mês (vales, adiantamentos, horas extras, faltas,
-- comissão, bônus, descontos e pagamentos).
-- Valores de salário são sigilosos: só o administrador lê e grava.
-- Rode DEPOIS do v9.sql. Pode ser executado mais de uma vez.
-- =====================================================================

create table if not exists public.funcionarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  apelido text not null default '',
  cpf text not null default '',
  rg text not null default '',
  pis text not null default '',
  ctps text not null default '',
  nascimento date,
  telefone text not null default '',
  endereco text not null default '',
  funcao text not null default '',
  vinculo text not null default 'clt' check (vinculo in ('clt', 'experiencia', 'mei', 'diarista', 'estagio', 'socio')),
  admissao date,
  demissao date,
  ativo boolean not null default true,
  perfil_id uuid references public.perfis (id) on delete set null,
  salario numeric(12, 2) not null default 0,
  horas_mes numeric(6, 2) not null default 220,
  he_pct numeric(6, 2) not null default 50,
  comissao_pct numeric(6, 2) not null default 0,
  jornada jsonb not null default '{}'::jsonb,
  banco text not null default '',
  pix text not null default '',
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists public.funcionario_lanc (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios (id) on delete cascade,
  competencia date not null,
  data date not null default current_date,
  tipo text not null check (tipo in ('vale', 'adiantamento', 'hora_extra', 'falta', 'comissao', 'bonus', 'desconto', 'inss', 'pagamento')),
  qtd numeric(10, 2) not null default 0,
  valor numeric(12, 2) not null default 0 check (valor >= 0),
  descricao text not null default '',
  conta_id uuid references public.contas (id) on delete set null,
  usuario_nome text not null default '',
  criado_em timestamptz not null default now()
);
create index if not exists funcionario_lanc_comp on public.funcionario_lanc (funcionario_id, competencia);

drop trigger if exists funcionarios_toca on public.funcionarios;
create trigger funcionarios_toca before update on public.funcionarios for each row execute function public.toca_atualizado();

alter table public.funcionarios enable row level security;
alter table public.funcionario_lanc enable row level security;
drop policy if exists funcionarios_admin on public.funcionarios;
create policy funcionarios_admin on public.funcionarios for all to authenticated using (public.e_admin()) with check (public.e_admin());
drop policy if exists funcionario_lanc_admin on public.funcionario_lanc;
create policy funcionario_lanc_admin on public.funcionario_lanc for all to authenticated using (public.e_admin()) with check (public.e_admin());

-- backup: a restauração passa a aceitar as tabelas de funcionários
create or replace function public.restaurar_tabela(p_tabela text, p_linhas jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cols text; antes bigint; depois bigint; r jsonb; erros int := 0; q text;
begin
  if not public.e_admin() then raise exception 'Apenas o administrador restaura backup.'; end if;
  if p_tabela not in ('fornecedores', 'clientes', 'veiculos', 'servicos', 'produtos', 'produto_fornecedor', 'notas_entrada', 'ordens', 'os_itens', 'eventos', 'fotos',
                      'recibos', 'vendas', 'venda_itens', 'estoque_mov', 'estoque_reserva', 'contas', 'nfe_recebidas', 'nfe_os_vinculos',
                      'funcionarios', 'funcionario_lanc') then
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
    for r in select * from jsonb_array_elements(p_linhas) loop
      begin execute q using jsonb_build_array(r); exception when others then erros := erros + 1; end;
    end loop;
  end;
  execute format('select count(*) from public.%I', p_tabela) into depois;
  return jsonb_build_object('incluidos', depois - antes, 'erros', erros);
end $$;
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;
