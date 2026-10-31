-- DTCar Gestão — v13: base para o banco no PC (etapa 2 do programa para Windows)
-- 1) Toda tabela passa a ter "atualizado_em" (o PC busca só o que mudou desde a última vez).
-- 2) Registro de exclusões: o PC apaga localmente o que foi apagado no online.
-- Pode rodar mais de uma vez. Não altera dados existentes.

-- 1) atualizado_em em todas as tabelas replicadas
do $$
declare t text;
begin
  foreach t in array array['perfis', 'servicos', 'os_itens', 'fotos', 'eventos', 'estoque_mov', 'recibos', 'produto_fornecedor',
                           'notas_entrada', 'vendas', 'venda_itens', 'estoque_reserva', 'nfe_os_vinculos', 'funcionario_lanc'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('alter table public.%I add column if not exists atualizado_em timestamptz not null default now()', t);
    execute format('create index if not exists %I on public.%I (atualizado_em)', t || '_atualizado', t);
    execute format('drop trigger if exists %I on public.%I', t || '_toca', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.toca_atualizado()', t || '_toca', t);
  end loop;
end $$;

-- 2) registro de exclusões (só o identificador; quem lê precisa ser membro da equipe)
create table if not exists public.exclusoes (
  seq bigserial primary key,
  tabela text not null,
  registro text not null,
  em timestamptz not null default now()
);
create index if not exists exclusoes_em on public.exclusoes (em);
alter table public.exclusoes enable row level security;
drop policy if exists exclusoes_ler on public.exclusoes;
create policy exclusoes_ler on public.exclusoes for select using (public.e_membro());

create or replace function public.registra_exclusao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.exclusoes (tabela, registro)
  values (tg_table_name, coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'item_id'));
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['perfis', 'clientes', 'veiculos', 'servicos', 'produtos', 'fornecedores', 'produto_fornecedor', 'notas_entrada',
                           'ordens', 'os_itens', 'fotos', 'eventos', 'estoque_mov', 'estoque_reserva', 'recibos', 'vendas', 'venda_itens',
                           'contas', 'nfe_recebidas', 'nfe_os_vinculos', 'funcionarios', 'funcionario_lanc', 'receber'] loop
    if to_regclass('public.' || t) is null then continue; end if;
    execute format('drop trigger if exists %I on public.%I', t || '_exclusao', t);
    execute format('create trigger %I after delete on public.%I for each row execute function public.registra_exclusao()', t || '_exclusao', t);
  end loop;
end $$;

-- exclusões com mais de 90 dias não interessam mais (o PC faz a conferência completa de tempos em tempos)
delete from public.exclusoes where em < now() - interval '90 days';
