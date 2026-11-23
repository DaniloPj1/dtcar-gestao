-- v64 (23/11/2026, pedido do Danilo): COMISSÃO POR LINHA DE SERVIÇO.
-- Hoje a comissão da folha é um percentual CHEIO sobre a mão de obra inteira da O.S., para uma pessoa só: o técnico
-- responsável (v50). Na oficina de verdade um carro passa pela mão de mais de um mecânico, e o que cada um fez está
-- em linhas diferentes da O.S. O Danilo pediu a tela onde a O.S. cai e ele puxa CADA SERVIÇO para o nome de um
-- funcionário, com o percentual lançado à mão.
--
-- Esta tabela guarda esse rateio: uma linha por (serviço da O.S. + funcionário). A mesma linha de serviço pode ser
-- dividida entre dois mecânicos (percentuais diferentes); o mesmo funcionário não entra duas vezes no mesmo serviço.
--
-- Decisões de desenho:
--  * `base` e `valor` ficam GRAVADOS, não calculados na leitura. Mexer no preço do serviço meses depois não pode
--    mudar sozinha uma comissão que já foi conferida e paga. Quem relança, relança de propósito.
--  * `competencia` é o mês da folha, gravado no lançamento (primeiro dia do mês). Segue a data de entrega da O.S.,
--    que é a regra que a folha já usa (`ordensEntregues`), mas fica gravada para não mudar se a entrega for refeita.
--  * `origem` diz de onde veio a sugestão: 'app' quando o mecânico marcou o item como executado no app do celular
--    (servico_apontamentos, v60) e 'manual' quando o Danilo escolheu na tela. O percentual é SEMPRE dele.
--  * Não mexe em O.S., estoque nem financeiro: é só o rateio da comissão. A folha continua sendo valor de referência
--    para a gestão; a folha oficial é a do contador.
--
-- Backup, banco do PC (atualizado_em + exclusoes) e restauração incluídos. Idempotente.
-- Período de transição (espelho do OS Oficina): PRESERVADA, não entra em espelho_legado_zerar() — não existe no
-- OS Oficina e apagar faria perder rateio já conferido. Some junto com a O.S. (ordem_id on delete cascade).
-- Antes deste SQL o site continua funcionando: a tela de Comissões avisa que falta rodar o v64 e nada mais muda.

create table if not exists public.os_item_comissoes (
  id uuid primary key default gen_random_uuid(),
  ordem_id uuid not null references public.ordens (id) on delete cascade,
  os_numero int,
  item_id uuid not null references public.os_itens (id) on delete cascade,
  descricao text not null default '',                 -- cópia da descrição do serviço na hora do lançamento
  funcionario_id uuid references public.funcionarios (id) on delete cascade,
  funcionario_nome text not null default '',          -- fica mesmo que o cadastro saia depois
  percentual numeric(6,2) not null default 0 check (percentual >= 0 and percentual <= 100),
  base numeric(12,2) not null default 0 check (base >= 0),   -- mão de obra da linha quando foi lançada
  valor numeric(12,2) not null default 0 check (valor >= 0), -- a comissão em reais: base × percentual ÷ 100
  competencia date,                                   -- mês da folha (sempre o dia 1)
  origem text not null default 'manual' check (origem in ('manual', 'app')),
  obs text not null default '',
  lancado_por uuid references public.perfis (id) on delete set null,
  lancado_nome text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

-- o mesmo funcionário não entra duas vezes no mesmo serviço (dois mecânicos na mesma linha, sim)
create unique index if not exists os_item_comissoes_item_func on public.os_item_comissoes (item_id, funcionario_id);
create index if not exists os_item_comissoes_ordem on public.os_item_comissoes (ordem_id);
create index if not exists os_item_comissoes_func on public.os_item_comissoes (funcionario_id, competencia);
create index if not exists os_item_comissoes_competencia on public.os_item_comissoes (competencia);
create index if not exists os_item_comissoes_atualizado on public.os_item_comissoes (atualizado_em);

drop trigger if exists os_item_comissoes_toca on public.os_item_comissoes;
create trigger os_item_comissoes_toca before update on public.os_item_comissoes for each row execute function public.toca_atualizado();
drop trigger if exists os_item_comissoes_exclusao on public.os_item_comissoes;
create trigger os_item_comissoes_exclusao after delete on public.os_item_comissoes for each row execute function public.registra_exclusao();

alter table public.os_item_comissoes enable row level security;
revoke all on public.os_item_comissoes from anon;
grant select, insert, update, delete on public.os_item_comissoes to authenticated;

-- Comissão é salário: quem lê e mexe é quem já vê a folha (administrador). O mecânico NÃO lê a comissão dos outros.
drop policy if exists os_item_comissoes_ler on public.os_item_comissoes;
create policy os_item_comissoes_ler on public.os_item_comissoes for select to authenticated using (public.e_admin());
drop policy if exists os_item_comissoes_incluir on public.os_item_comissoes;
create policy os_item_comissoes_incluir on public.os_item_comissoes for insert to authenticated with check (public.e_admin());
drop policy if exists os_item_comissoes_alterar on public.os_item_comissoes;
create policy os_item_comissoes_alterar on public.os_item_comissoes for update to authenticated using (public.e_admin()) with check (public.e_admin());
drop policy if exists os_item_comissoes_excluir on public.os_item_comissoes;
create policy os_item_comissoes_excluir on public.os_item_comissoes for delete to authenticated using (public.e_admin());

comment on table public.os_item_comissoes is 'Comissão por linha de serviço da O.S. (v64). Uma linha por serviço + funcionário; base e valor gravados no lançamento. Só o administrador lê e grava.';

-- O agente de leitura NÃO lê esta tabela: é valor de salário, mesma regra do RH (v30) e dos lançamentos de funcionário.

-- backup: a restauração passa a aceitar os_item_comissoes (resto igual ao v62)
do $$
declare fonte text; novo text;
begin
  select pg_get_functiondef(p.oid) into fonte from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'restaurar_tabela';
  if fonte is null then raise exception 'restaurar_tabela não existe: rode os SQL anteriores antes do v64.'; end if;
  if position('''os_item_comissoes''' in fonte) > 0 then return; end if;   -- já aceita: nada a fazer (idempotente)
  novo := replace(fonte, '''obd_leituras'')', '''obd_leituras'', ''os_item_comissoes'')');
  if novo = fonte then raise exception 'não achei a lista de tabelas de restaurar_tabela: confira o v64 à mão.'; end if;
  execute novo;
end $$;
revoke all on function public.restaurar_tabela(text, jsonb) from public, anon;
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;

notify pgrst, 'reload schema';
