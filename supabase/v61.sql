-- DTCar Gestão — v61 (18/11/2026, pedido do Danilo): COMISSÃO POR QUINZENA.
-- A tela de Comissão puxa por quinzena o que cada mecânico apontou no app (servico_apontamentos, v60), aplica o percentual da
-- matriz e lança: a comissão entra como CUSTO do item de serviço na O.S. (os_itens.custo_unit) e como lançamento da folha
-- (funcionario_lanc, tipo 'comissao'). Decisões do Danilo:
--   1. A comissão vira custo na O.S. INCLUSIVE nas já fechadas e pagas (a margem de meses antigos muda e fica correta).
--   2. A matriz de percentuais é editada na própria tela (config.dados.comissao), não na ficha do funcionário.
--   3. Quinzena fixa: 1 a 15 e 16 ao fim do mês.
--   4. Ordem do percentual: exceção por grupo de serviço → padrão do mecânico → o que o Danilo digitar na hora (vence os dois).
--   5. O percentual incide sobre a mão de obra do serviço. Serviço apontado por mais de um mecânico: a mão de obra é dividida
--      em partes iguais entre eles, e cada um leva o percentual dele.
-- O mesmo serviço não entra duas vezes para o mesmo mecânico (índice único em comissao_itens, enquanto não for cancelado).
-- Gravação em O.S. sempre pela sincronizar_alteracao_os (v15), com o retrato do item como "antes": se alguém mexer no item no
-- meio do lançamento, dá conflito e nada é gravado.
-- Só o administrador lança e cancela. Tabelas novas entram no backup, na réplica do banco do PC e nas exclusões; o espelho do
-- OS Oficina PRESERVA as duas (não entram em espelho_legado_zerar). Idempotente: pode rodar mais de uma vez.

/* =================== 1. TABELAS =================== */

create table if not exists public.comissoes (
  id uuid primary key default gen_random_uuid(),
  funcionario_id uuid not null references public.funcionarios (id) on delete restrict,
  funcionario_nome text not null default '',
  inicio date not null,
  fim date not null,
  competencia date not null,                         -- 1º dia do mês da folha em que o lançamento entrou
  servicos int not null default 0,
  mao_de_obra numeric(12, 2) not null default 0,     -- soma das partes dele (base do cálculo)
  total numeric(12, 2) not null default 0 check (total >= 0),
  situacao text not null default 'lancado' check (situacao in ('lancado', 'cancelado')),
  lanc_id uuid references public.funcionario_lanc (id) on delete set null,
  obs text not null default '',
  usuario_nome text not null default '',
  cancelado_em timestamptz,
  cancelado_por text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  check (fim >= inicio)
);
create index if not exists comissoes_func on public.comissoes (funcionario_id, inicio desc);
create index if not exists comissoes_periodo on public.comissoes (inicio, fim);
create index if not exists comissoes_competencia on public.comissoes (competencia);
create index if not exists comissoes_atualizado on public.comissoes (atualizado_em);
-- uma quinzena lançada por mecânico (cancelar libera para lançar de novo)
create unique index if not exists comissoes_quinzena on public.comissoes (funcionario_id, inicio, fim) where situacao = 'lancado';

create table if not exists public.comissao_itens (
  id uuid primary key default gen_random_uuid(),
  comissao_id uuid not null references public.comissoes (id) on delete cascade,
  funcionario_id uuid not null references public.funcionarios (id) on delete restrict,
  ordem_id uuid references public.ordens (id) on delete set null,
  os_numero int,
  placa text not null default '',
  item_id uuid references public.os_itens (id) on delete set null,
  descricao text not null default '',
  grupo text not null default '',
  mao_de_obra numeric(12, 2) not null default 0,     -- mão de obra do item inteiro
  fracao numeric(6, 4) not null default 1 check (fracao > 0 and fracao <= 1),
  base numeric(12, 2) not null default 0,            -- a parte dele: mao_de_obra * fracao
  pct numeric(6, 2) not null default 0 check (pct >= 0 and pct <= 100),
  valor numeric(12, 2) not null default 0 check (valor >= 0),
  dividido_com text not null default '',             -- nomes de quem dividiu o mesmo serviço
  cancelado boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists comissao_itens_comissao on public.comissao_itens (comissao_id);
create index if not exists comissao_itens_item on public.comissao_itens (item_id);
create index if not exists comissao_itens_ordem on public.comissao_itens (ordem_id);
-- o mesmo serviço não entra duas vezes para o mesmo mecânico enquanto o lançamento valer
create unique index if not exists comissao_itens_unico on public.comissao_itens (item_id, funcionario_id) where not cancelado;

drop trigger if exists comissoes_toca on public.comissoes;
create trigger comissoes_toca before update on public.comissoes for each row execute function public.toca_atualizado();
drop trigger if exists comissoes_exclusao on public.comissoes;
create trigger comissoes_exclusao after delete on public.comissoes for each row execute function public.registra_exclusao();
drop trigger if exists comissao_itens_exclusao on public.comissao_itens;
create trigger comissao_itens_exclusao after delete on public.comissao_itens for each row execute function public.registra_exclusao();

alter table public.comissoes enable row level security;
alter table public.comissao_itens enable row level security;
revoke all on public.comissoes from anon;
revoke all on public.comissao_itens from anon;
grant select, insert, update, delete on public.comissoes to authenticated;
grant select, insert, update, delete on public.comissao_itens to authenticated;
-- comissão é dinheiro e folha: só o administrador
drop policy if exists comissoes_admin on public.comissoes;
create policy comissoes_admin on public.comissoes for all to authenticated using (public.e_admin()) with check (public.e_admin());
drop policy if exists comissao_itens_admin on public.comissao_itens;
create policy comissao_itens_admin on public.comissao_itens for all to authenticated using (public.e_admin()) with check (public.e_admin());

/* =================== 2. A MATRIZ DE PERCENTUAIS =================== */
-- Fica em config.dados.comissao: { "padrao": { "<funcionario_id>": 45 }, "matriz": { "<funcionario_id>": { "<grupo>": 50 } } }
-- Ordem: exceção do mecânico naquele grupo → padrão do mecânico → comissao_pct da ficha → 0.

create or replace function public.comissao_pct(p_funcionario uuid, p_grupo text, p_ficha numeric default null)
returns numeric language sql stable security invoker set search_path = public as $$
  with m as (select coalesce(dados->'comissao', '{}'::jsonb) c from public.config where id = 1)
  select round(coalesce(
    nullif(m.c->'matriz'->p_funcionario::text->>public.grupo_chave(coalesce(p_grupo, '')), '')::numeric,
    nullif(m.c->'padrao'->>p_funcionario::text, '')::numeric,
    p_ficha, 0), 2) from m
$$;
revoke all on function public.comissao_pct(uuid, text, numeric) from public, anon;
grant execute on function public.comissao_pct(uuid, text, numeric) to authenticated;

/* =================== 3. MONTAR A QUINZENA =================== */
-- Devolve o que cada mecânico apontou na quinzena, já com a parte dele e o percentual da matriz. Não grava nada: é a prévia.
-- p_itens: itens de serviço de fora da quinzena que o Danilo puxou na mão ("Puxar O.S. para o mecânico").
-- "ja" = este serviço já foi lançado para este mecânico num lançamento que vale (não entra de novo).

create or replace function public.comissao_quinzena(p_inicio date, p_fim date, p_funcionario uuid default null,
                                                   p_itens uuid[] default '{}')
returns jsonb language sql stable security invoker set search_path = public as $$
  with ap as (   -- todos os apontamentos finalizados (todos, não só os da quinzena: é como se sabe quem dividiu cada serviço)
    select a.ordem_id, a.fim, f.id funcionario_id, coalesce(nullif(f.apelido, ''), f.nome) nome, f.comissao_pct, x.item_id
      from public.servico_apontamentos a
      join public.funcionarios f on f.perfil_id = a.perfil_id
      cross join unnest(a.itens_executados) x(item_id)
     where a.situacao = 'finalizado' and a.fim is not null
  ),
  donos as (select item_id, count(distinct funcionario_id) n from ap group by item_id),
  escolhidos as (   -- um por mecânico e serviço (o mesmo pode ter sido apontado mais de uma vez)
    select distinct on (funcionario_id, item_id) funcionario_id, nome, comissao_pct, item_id, fim
      from ap
     where ((fim at time zone 'America/Sao_Paulo')::date between p_inicio and p_fim or item_id = any (coalesce(p_itens, '{}')))
       and (p_funcionario is null or funcionario_id = p_funcionario)
     order by funcionario_id, item_id, fim desc
  ),
  linhas as (
    select e.funcionario_id, e.nome, e.fim, i.ordem_id, o.numero os_numero, e.item_id, i.descricao,
           coalesce(o.veiculo->>'placa', '') placa, coalesce(pr.categoria, '') grupo,
           round(i.qtd * i.valor_unit - coalesce(i.desconto, 0), 2) mao_de_obra,
           round(1.0 / d.n, 4) fracao,
           round((i.qtd * i.valor_unit - coalesce(i.desconto, 0)) / d.n, 2) base,
           public.comissao_pct(e.funcionario_id, coalesce(pr.categoria, ''), e.comissao_pct) pct,
           (select string_agg(distinct a2.nome, ', ') from ap a2 where a2.item_id = e.item_id and a2.funcionario_id <> e.funcionario_id) dividido_com,
           exists (select 1 from public.comissao_itens ci where ci.item_id = e.item_id and ci.funcionario_id = e.funcionario_id and not ci.cancelado) ja
      from escolhidos e
      join donos d on d.item_id = e.item_id
      join public.os_itens i on i.id = e.item_id and i.tipo = 'servico' and i.aprovado is distinct from false
      left join public.ordens o on o.id = i.ordem_id
      left join public.produtos pr on pr.id = i.produto_id
  ),
  itens as (select l.*, round(l.base * l.pct / 100, 2) valor from linhas l),
  porfunc as (
    select funcionario_id, nome,
           count(*) filter (where not ja) servicos,
           coalesce(sum(base) filter (where not ja), 0) mao_de_obra,
           coalesce(sum(valor) filter (where not ja), 0) total,
           jsonb_agg(jsonb_build_object(
             'item_id', item_id, 'ordem_id', ordem_id, 'os_numero', os_numero, 'placa', placa, 'descricao', descricao,
             'grupo', grupo, 'mao_de_obra', mao_de_obra, 'fracao', fracao, 'base', base, 'pct', pct, 'valor', valor,
             'dividido_com', coalesce(dividido_com, ''), 'ja_lancado', ja, 'fim', fim)
             order by os_numero, descricao) itens
      from itens group by funcionario_id, nome
  )
  select coalesce((select jsonb_agg(jsonb_build_object('funcionario_id', funcionario_id, 'nome', nome, 'servicos', servicos,
                                                       'mao_de_obra', mao_de_obra, 'total', total, 'itens', itens) order by nome)
                     from porfunc), '[]'::jsonb)
$$;
revoke all on function public.comissao_quinzena(date, date, uuid, uuid[]) from public, anon;
grant execute on function public.comissao_quinzena(date, date, uuid, uuid[]) to authenticated;

/* =================== 4. LANÇAR A QUINZENA =================== */
-- p = { funcionario_id, inicio, fim, competencia?, data?, obs?, itens: [{ item_id, pct? }] }
-- Recalcula TUDO no banco (mão de obra, fração, valor): o que vem da tela é só quais serviços entram e, se o Danilo digitou,
-- o percentual de cada um. Grava: comissoes + comissao_itens, o custo nos itens das O.S. (pela sincronizar_alteracao_os) e o
-- lançamento da folha (funcionario_lanc, tipo 'comissao'). Tudo numa transação: ou entra inteiro, ou nada entra.

create or replace function public.comissao_lancar(p jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_func public.funcionarios%rowtype;
  v_inicio date := (p->>'inicio')::date;
  v_fim date := (p->>'fim')::date;
  v_comp date := coalesce((p->>'competencia')::date, date_trunc('month', (p->>'fim')::date)::date);
  v_data date := coalesce((p->>'data')::date, current_date);
  v_id uuid; v_lanc uuid; v_total numeric := 0; v_mo numeric := 0; v_qtd int := 0;
  v_ordem uuid; v_status text; v_antes jsonb; v_itens jsonb; v_r jsonb; v_oss int[] := '{}';
begin
  if not public.e_admin() then raise exception 'Só o administrador lança comissão.'; end if;
  if v_inicio is null or v_fim is null or v_fim < v_inicio then raise exception 'Informe a quinzena (início e fim).'; end if;
  select * into v_func from public.funcionarios where id = (p->>'funcionario_id')::uuid for update;
  if not found then raise exception 'Funcionário não encontrado.'; end if;
  if jsonb_typeof(p->'itens') <> 'array' or jsonb_array_length(p->'itens') = 0 then
    raise exception 'Nenhum serviço selecionado para lançar.'; end if;
  if exists (select 1 from public.comissoes where funcionario_id = v_func.id and inicio = v_inicio and fim = v_fim and situacao = 'lancado') then
    raise exception 'A quinzena de % a % já foi lançada para %. Cancele o lançamento antes de lançar de novo.',
      to_char(v_inicio, 'DD/MM'), to_char(v_fim, 'DD/MM/YYYY'), coalesce(nullif(v_func.apelido, ''), v_func.nome); end if;

  insert into public.comissoes (funcionario_id, funcionario_nome, inicio, fim, competencia, obs, usuario_nome)
  values (v_func.id, coalesce(nullif(v_func.apelido, ''), v_func.nome), v_inicio, v_fim, v_comp,
          coalesce(p->>'obs', ''), coalesce(p->>'usuario_nome', ''))
  returning id into v_id;

  -- uma linha por serviço, com os números refeitos no banco
  insert into public.comissao_itens (comissao_id, funcionario_id, ordem_id, os_numero, placa, item_id, descricao, grupo,
                                     mao_de_obra, fracao, base, pct, valor, dividido_com)
  select v_id, v_func.id, i.ordem_id, o.numero, coalesce(o.veiculo->>'placa', ''), i.id, i.descricao,
         coalesce(pr.categoria, ''),
         round(i.qtd * i.valor_unit - coalesce(i.desconto, 0), 2),
         round(1.0 / d.n, 4),
         round((i.qtd * i.valor_unit - coalesce(i.desconto, 0)) / d.n, 2),
         x.pct,
         round(round((i.qtd * i.valor_unit - coalesce(i.desconto, 0)) / d.n, 2) * x.pct / 100, 2),
         coalesce((select string_agg(distinct coalesce(nullif(f2.apelido, ''), f2.nome), ', ')
                     from public.servico_apontamentos a2
                     join public.funcionarios f2 on f2.perfil_id = a2.perfil_id
                    where a2.situacao = 'finalizado' and i.id = any (a2.itens_executados) and f2.id <> v_func.id), '')
    from jsonb_to_recordset(p->'itens') as pedido(item_id uuid, pct numeric)
    join public.os_itens i on i.id = pedido.item_id
    left join public.ordens o on o.id = i.ordem_id
    left join public.produtos pr on pr.id = i.produto_id
    cross join lateral (select count(distinct f3.id) n from public.servico_apontamentos a3
                          join public.funcionarios f3 on f3.perfil_id = a3.perfil_id
                         where a3.situacao = 'finalizado' and i.id = any (a3.itens_executados)) d
    cross join lateral (select coalesce(pedido.pct, public.comissao_pct(v_func.id, coalesce(pr.categoria, ''), v_func.comissao_pct)) pct) x
   where i.tipo = 'servico' and i.aprovado is distinct from false and d.n > 0
     and exists (select 1 from public.servico_apontamentos a
                   join public.funcionarios f on f.perfil_id = a.perfil_id
                  where a.situacao = 'finalizado' and f.id = v_func.id and i.id = any (a.itens_executados));

  if (select count(*) from public.comissao_itens where comissao_id = v_id) <> jsonb_array_length(p->'itens') then
    raise exception 'Algum serviço da lista não serve para comissão (não é serviço aprovado, ou este mecânico não apontou que executou). Nada foi lançado.';
  end if;
  if exists (select 1 from public.comissao_itens where comissao_id = v_id and (pct < 0 or pct > 100)) then
    raise exception 'Percentual de comissão fora de 0 a 100.'; end if;

  select count(*), coalesce(sum(base), 0), coalesce(sum(valor), 0) into v_qtd, v_mo, v_total
    from public.comissao_itens where comissao_id = v_id;
  if v_total <= 0 then raise exception 'A comissão desta quinzena ficou em zero: confira os percentuais.'; end if;

  -- o custo entra nos itens das O.S. (inclusive nas fechadas, decisão do Danilo), sempre pela sincronizar_alteracao_os
  for v_ordem in select distinct ordem_id from public.comissao_itens where comissao_id = v_id and ordem_id is not null loop
    select status into v_status from public.ordens where id = v_ordem;
    select jsonb_object_agg(i.id::text, to_jsonb(i)),
           jsonb_agg(to_jsonb(i) || jsonb_build_object('custo_unit', case when i.qtd > 0 then round(a.soma / i.qtd, 2) else a.soma end))
      into v_antes, v_itens
      from (select ci.item_id, round(sum(c2.valor), 2) soma
              from public.comissao_itens ci
              join public.comissao_itens c2 on c2.item_id = ci.item_id and not c2.cancelado
             where ci.comissao_id = v_id and ci.ordem_id = v_ordem and not ci.cancelado
             group by ci.item_id) a
      join public.os_itens i on i.id = a.item_id;
    if v_itens is not null then
      v_r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'itens_os', 'ordem_id', v_ordem,
               'antes', jsonb_build_object('status', v_status, 'itens', v_antes), 'itens', v_itens));
      if v_r ? 'conflito' then
        raise exception 'A O.S. mudou enquanto a comissão era lançada (%). Nada foi lançado.', v_r->>'conflito'; end if;
    end if;
    v_r := public.os_custo_recalcular(v_ordem);   -- o custo guardado na O.S. passa a contar a comissão
    if v_r ? 'conflito' then
      raise exception 'A O.S. mudou enquanto a comissão era lançada (%). Nada foi lançado.', v_r->>'conflito'; end if;
  end loop;

  -- lançamento da folha
  insert into public.funcionario_lanc (funcionario_id, competencia, data, tipo, qtd, valor, descricao, usuario_nome)
  values (v_func.id, v_comp, v_data, 'comissao', v_qtd, v_total,
          'Comissão de ' || to_char(v_inicio, 'DD/MM') || ' a ' || to_char(v_fim, 'DD/MM/YYYY') || ' (' || v_qtd || ' serviço' || case when v_qtd = 1 then '' else 's' end || ')',
          coalesce(p->>'usuario_nome', ''))
  returning id into v_lanc;

  update public.comissoes set servicos = v_qtd, mao_de_obra = v_mo, total = v_total, lanc_id = v_lanc where id = v_id;
  select coalesce(array_agg(distinct os_numero) filter (where os_numero is not null), '{}') into v_oss
    from public.comissao_itens where comissao_id = v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'servicos', v_qtd, 'mao_de_obra', v_mo, 'total', v_total,
                            'lanc_id', v_lanc, 'ordens', to_jsonb(v_oss));
end $$;
revoke all on function public.comissao_lancar(jsonb) from public, anon;
grant execute on function public.comissao_lancar(jsonb) to authenticated;

/* =================== 5. CANCELAR O LANÇAMENTO =================== */
-- Desfaz os três: tira o custo dos itens das O.S. (o que sobrar de outros lançamentos continua), apaga o lançamento da folha
-- e marca a comissão como cancelada. Os serviços voltam a aparecer na quinzena para lançar de novo.

create or replace function public.comissao_cancelar(p_id uuid, p_motivo text default '')
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  c public.comissoes%rowtype;
  v_ordem uuid; v_status text; v_antes jsonb; v_itens jsonb; v_r jsonb;
begin
  if not public.e_admin() then raise exception 'Só o administrador cancela comissão.'; end if;
  select * into c from public.comissoes where id = p_id for update;
  if not found then raise exception 'Lançamento de comissão não encontrado.'; end if;
  if c.situacao <> 'lancado' then raise exception 'Este lançamento já está cancelado.'; end if;

  update public.comissao_itens set cancelado = true where comissao_id = p_id;

  for v_ordem in select distinct ordem_id from public.comissao_itens where comissao_id = p_id and ordem_id is not null loop
    select status into v_status from public.ordens where id = v_ordem;
    select jsonb_object_agg(i.id::text, to_jsonb(i)),
           jsonb_agg(to_jsonb(i) || jsonb_build_object('custo_unit', case when i.qtd > 0 then round(a.soma / i.qtd, 2) else a.soma end))
      into v_antes, v_itens
      from (select ci.item_id,
                   coalesce((select round(sum(c2.valor), 2) from public.comissao_itens c2 where c2.item_id = ci.item_id and not c2.cancelado), 0) soma
              from public.comissao_itens ci
             where ci.comissao_id = p_id and ci.ordem_id = v_ordem
             group by ci.item_id) a
      join public.os_itens i on i.id = a.item_id;
    if v_itens is not null then
      v_r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'itens_os', 'ordem_id', v_ordem,
               'antes', jsonb_build_object('status', v_status, 'itens', v_antes), 'itens', v_itens));
      if v_r ? 'conflito' then
        raise exception 'A O.S. mudou enquanto o cancelamento era feito (%). Nada foi desfeito.', v_r->>'conflito'; end if;
    end if;
    v_r := public.os_custo_recalcular(v_ordem);
    if v_r ? 'conflito' then
      raise exception 'A O.S. mudou enquanto o cancelamento era feito (%). Nada foi desfeito.', v_r->>'conflito'; end if;
  end loop;

  if c.lanc_id is not null then delete from public.funcionario_lanc where id = c.lanc_id; end if;
  update public.comissoes set situacao = 'cancelado', cancelado_em = now(),
         cancelado_por = coalesce(nullif(p_motivo, ''), 'cancelado pelo administrador'), lanc_id = null
   where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke all on function public.comissao_cancelar(uuid, text) from public, anon;
grant execute on function public.comissao_cancelar(uuid, text) to authenticated;

/* =================== 6. O CUSTO DA O.S. PASSA A CONTAR A MÃO DE OBRA =================== */
-- Decisão 1 do Danilo. Até aqui o custo da O.S. somava só peças e terceiros (os_itens.custo_unit de 'servico' era ignorado em
-- agente_totais_os, em agente_lancar_itens_os, no totais() do js/util.js e no relatório). Com a comissão virando custo do item de
-- serviço, os quatro passam a contar. Vale para TODAS as O.S., não só as da comissão: a margem de O.S. antigas muda e fica certa.

create or replace function public.agente_totais_os(p_ordem uuid) returns jsonb
language sql stable security invoker set search_path = public as $$
  with o as (select * from public.ordens where id = p_ordem),
  conta as (
    select i.* from public.os_itens i, o where i.ordem_id = o.id
      and case when o.status in ('execucao', 'pronto', 'entregue', 'recusado') then i.aprovado is true else i.aprovado is distinct from false end)
  select jsonb_build_object(
    'total', greatest(0, coalesce((select sum(round(qtd * valor_unit - coalesce(desconto, 0), 2)) from conta), 0) - coalesce((select desconto from o), 0)),
    'custo', coalesce((select sum(round(qtd * custo_unit, 2)) from conta), 0))   -- agora com a mão de obra (comissão)
$$;

-- recalcula e grava ordens.custo pela sincronizar_alteracao_os (regra do projeto: O.S. só muda por ela)
create or replace function public.os_custo_recalcular(p_ordem uuid)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare o public.ordens%rowtype; v_novo numeric; v_r jsonb;
begin
  select * into o from public.ordens where id = p_ordem;
  if not found then return jsonb_build_object('ok', true, 'sem_os', true); end if;
  v_novo := coalesce((public.agente_totais_os(p_ordem)->>'custo')::numeric, 0);
  if v_novo = o.custo then return jsonb_build_object('ok', true, 'igual', true); end if;
  v_r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'alterar_os', 'ordem_id', p_ordem, 'status_base', o.status,
           'antes', jsonb_build_object('custo', o.custo), 'patch', jsonb_build_object('custo', v_novo)));
  if v_r ? 'conflito' then return v_r; end if;
  return jsonb_build_object('ok', true, 'custo', v_novo);
end $$;
revoke all on function public.os_custo_recalcular(uuid) from public, anon;
grant execute on function public.os_custo_recalcular(uuid) to authenticated;

-- agente_lancar_itens_os: a mesma do v27, só com o custo contando a mão de obra
create or replace function public.agente_lancar_itens_os(p jsonb, p_gravar boolean default false) returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  o public.ordens; it jsonb; n int := 0; erros text[] := '{}'; avisos text[] := '{}';
  v_tipo text; v_desc text; v_qtd numeric; v_val numeric; v_custo numeric; v_cod text; v_cli boolean; v_prod public.produtos;
  v_adicional boolean; v_aprov boolean; v_pos int; v_novos jsonb := '[]'; v_linhas jsonb := '[]'; v_id uuid;
  t_serv numeric := 0; t_peca numeric := 0; t_terc numeric := 0; t_custo numeric := 0; t_sub numeric; t_total numeric; t_lanc numeric := 0;
  v_perfil public.perfis; r jsonb; v_res jsonb; v_repetido boolean := coalesce((p->>'lancar_mesmo_repetido')::boolean, false);
  v_consumo jsonb := '{}'; v_ja numeric; -- quanto de cada produto as linhas anteriores deste mesmo pedido já vão tirar do estoque
begin
  perform public.agente_exige_admin();
  if coalesce(p->>'numero', '') !~ '^\s*[0-9]+\s*$' then raise exception 'Informe o número da O.S.'; end if;
  -- trava a O.S. já na leitura: duas chamadas juntas para a mesma O.S. não leem os mesmos itens e totais
  -- (cada uma espera a anterior terminar e confere repetidos e soma o total com o que a outra lançou)
  select * into o from public.ordens where numero = (p->>'numero')::int order by criado_em desc limit 1 for update;
  if o.id is null then raise exception 'O.S. % não encontrada.', p->>'numero'; end if;
  -- O.S. aberta = orçamento, execução ou aguardando pagamento (no pátio ou entregue sem quitar). Fechada, recusada ou cancelada: não.
  if o.status not in ('diagnostico', 'aguardando', 'execucao', 'pronto', 'entregue') or (o.status = 'entregue' and o.finalizada_em is not null) then
    erros := array_append(erros, 'A O.S. ' || o.numero || ' está "' || public.agente_etapa(o) || '": só dá para lançar itens em O.S. aberta (orçamento, execução ou aguardando pagamento).');
  end if;
  if jsonb_typeof(p->'itens') is distinct from 'array' or jsonb_array_length(p->'itens') = 0 then raise exception 'Informe pelo menos um item.'; end if;
  if jsonb_array_length(p->'itens') > 40 then raise exception 'No máximo 40 itens por vez.'; end if;

  v_adicional := o.status <> 'diagnostico';
  -- regra do Danilo (03/11/2026): o que ele manda acrescentar depois da aprovação já entra aprovado e cobrado
  v_aprov := o.status in ('execucao', 'pronto', 'entregue');
  select coalesce(max(posicao), -1) + 1 into v_pos from public.os_itens where ordem_id = o.id;

  for it in select * from jsonb_array_elements(p->'itens') loop
    n := n + 1;
    v_tipo := coalesce(it->>'tipo', '');
    v_desc := trim(coalesce(it->>'descricao', ''));
    v_cod := trim(coalesce(it->>'codigo', ''));
    v_cli := coalesce((it->>'peca_do_cliente')::boolean, false);
    v_prod := null;
    if v_tipo not in ('servico', 'peca', 'terceiro') then erros := array_append(erros, 'Item ' || n || ': tipo deve ser servico, peca ou terceiro.'); continue; end if;
    if jsonb_typeof(it->'qtd') <> 'number' or (it->>'qtd')::numeric <= 0 then erros := array_append(erros, 'Item ' || n || ': quantidade inválida.'); continue; end if;
    if jsonb_typeof(it->'valor_unit') <> 'number' or (it->>'valor_unit')::numeric < 0 then erros := array_append(erros, 'Item ' || n || ': valor unitário inválido.'); continue; end if;
    if it ? 'custo_unit' and it->'custo_unit' <> 'null'::jsonb and (jsonb_typeof(it->'custo_unit') <> 'number' or (it->>'custo_unit')::numeric < 0) then
      erros := array_append(erros, 'Item ' || n || ': custo unitário inválido.'); continue;
    end if;
    v_qtd := round((it->>'qtd')::numeric, 3); v_val := round((it->>'valor_unit')::numeric, 2);
    v_custo := round(nullif(it->>'custo_unit', '')::numeric, 2);
    if v_cod <> '' then
      if v_tipo <> 'peca' then erros := array_append(erros, 'Item ' || n || ': código do estoque só vale para peça.'); continue; end if;
      -- trava o produto até o fim: dois lançamentos juntos do mesmo produto (em O.S. diferentes) não leem o mesmo saldo
      select * into v_prod from public.produtos pr where pr.tipo = 'produto' and (pr.codigo::text = v_cod or lower(coalesce(pr.codigo_barras, '')) = lower(v_cod)) order by pr.ativo desc limit 1 for update;
      if v_prod.id is null then erros := array_append(erros, 'Item ' || n || ': código ' || v_cod || ' não existe no estoque.'); continue; end if;
      if v_desc = '' then v_desc := v_prod.descricao; end if;
      if v_custo is null and not v_cli then v_custo := coalesce(v_prod.custo, 0); end if;
      -- mesma regra da tela da O.S.: produto marcado para não vender sem estoque bloqueia; os outros só avisam
      -- conta também o que as linhas anteriores deste pedido já vão tirar do mesmo produto
      v_ja := coalesce((v_consumo->>v_prod.id::text)::numeric, 0);
      if v_prod.controla_estoque and not v_cli and coalesce(v_prod.estoque_atual, 0) - v_ja < v_qtd then
        if coalesce(v_prod.vender_sem_estoque, true) then
          avisos := array_append(avisos, v_prod.descricao || ': estoque ' || coalesce(v_prod.estoque_atual, 0) || ', vai ficar negativo.');
        else
          erros := array_append(erros, v_prod.descricao || ': estoque insuficiente (' || coalesce(v_prod.estoque_atual, 0)
            || case when v_ja > 0 then ', já contando ' || v_ja || ' em outra linha deste pedido' else '' end
            || ') e o produto está marcado para não ser vendido sem estoque.');
          continue;
        end if;
      end if;
      if v_prod.controla_estoque and not v_cli then v_consumo := jsonb_set(v_consumo, array[v_prod.id::text], to_jsonb(v_ja + v_qtd)); end if;
    end if;
    if length(v_desc) < 2 then erros := array_append(erros, 'Item ' || n || ': informe a descrição.'); continue; end if;
    v_custo := case when v_cli then 0 else coalesce(v_custo, 0) end;
    -- peça trazida pelo cliente: sem preço (como no editor da O.S.; a O.S. impressa e o PDF não mostram valor dessas peças)
    if v_cli and v_val > 0 then avisos := array_append(avisos, v_desc || ': peça do cliente, lançada sem valor.'); end if;
    if v_cli then v_val := 0; end if;
    if v_tipo = 'peca' and not v_cli and v_custo = 0 then avisos := array_append(avisos, v_desc || ': sem custo (a margem fica superestimada até a nota chegar).'); end if;
    if v_val = 0 and not v_cli then avisos := array_append(avisos, v_desc || ': valor zero.'); end if;
    if exists (select 1 from public.os_itens i where i.ordem_id = o.id and upper(trim(i.descricao)) = upper(v_desc) and i.aprovado is distinct from false)
       or exists (select 1 from jsonb_array_elements(v_novos) x where upper(x->>'descricao') = upper(v_desc)) then
      if v_repetido then avisos := array_append(avisos, v_desc || ': já estava na O.S. (confirmado lançar de novo).');
      else erros := array_append(erros, v_desc || ' já está na O.S. Lançar de novo mesmo assim?'); end if;
    end if;
    v_id := gen_random_uuid();
    v_novos := v_novos || jsonb_build_array(jsonb_build_object(
      'id', v_id, 'tipo', v_tipo, 'descricao', v_desc, 'codigo', coalesce(v_prod.codigo::text, ''), 'produto_id', v_prod.id,
      'qtd', v_qtd, 'valor_unit', v_val, 'custo_unit', v_custo, 'desconto', 0, 'fornecida_cliente', v_cli,
      'qualidade', case when v_tipo = 'peca' then 'original' else '' end, 'adicional', v_adicional, 'aprovado', case when v_aprov then true end, 'executado', o.status in ('pronto', 'entregue'),
      'posicao', v_pos));
    v_pos := v_pos + 1;
    t_lanc := t_lanc + round(v_qtd * v_val, 2);
    v_linhas := v_linhas || jsonb_build_array(jsonb_build_object('tipo', v_tipo, 'descricao', v_desc, 'qtd', v_qtd, 'valor_unit', v_val,
      'total', round(v_qtd * v_val, 2), 'custo_unit', v_custo,
      'estoque', case when v_cli then 'peça do cliente' when v_prod.id is not null then 'baixa no estoque (código ' || v_prod.codigo || ')'
                      when v_tipo = 'peca' then 'item genérico (não mexe no estoque)' end));
  end loop;

  -- totais como a tela calcula (js/util.js, totais): no orçamento soma o que não foi recusado; depois de aprovada, só o aprovado
  with todos as (
    select i.tipo, i.qtd, i.valor_unit, coalesce(i.desconto, 0) desconto, i.custo_unit, i.aprovado from public.os_itens i where i.ordem_id = o.id
    union all
    select x->>'tipo', (x->>'qtd')::numeric, (x->>'valor_unit')::numeric, 0, (x->>'custo_unit')::numeric, (x->>'aprovado')::boolean from jsonb_array_elements(v_novos) x
  ), conta as (
    select * from todos where case when o.status in ('execucao', 'pronto', 'entregue', 'recusado') then aprovado is true else aprovado is distinct from false end
  )
  select coalesce(sum(round(qtd * valor_unit - desconto, 2)) filter (where tipo = 'servico'), 0),
         coalesce(sum(round(qtd * valor_unit - desconto, 2)) filter (where tipo = 'peca'), 0),
         coalesce(sum(round(qtd * valor_unit - desconto, 2)) filter (where tipo = 'terceiro'), 0),
         coalesce(sum(round(qtd * custo_unit, 2)), 0)   -- v61: com a mão de obra (comissão)
    into t_serv, t_peca, t_terc, t_custo from conta;
  t_sub := t_serv + t_peca + t_terc;
  t_total := greatest(0, t_sub - coalesce(o.desconto, 0));
  if o.status in ('pronto', 'entregue') then
    avisos := array_append(avisos, 'A O.S. está aguardando pagamento: o total muda. Confira recibos e parcelas a receber.');
  end if;

  v_res := jsonb_build_object('os', o.numero, 'id', o.id, 'etapa', public.agente_etapa(o), 'placa', o.veiculo->>'placa', 'cliente', o.cliente->>'nome',
    'itens', v_linhas, 'valor_lancado', t_lanc, 'total_antes', o.total,
    'total_os', t_total, 'servicos', t_serv, 'pecas', t_peca, 'terceiros', t_terc, 'desconto', coalesce(o.desconto, 0),
    'custo', t_custo, 'margem_bruta', t_total - t_custo, 'avisos', to_jsonb(avisos));
  if array_length(erros, 1) > 0 then return v_res || jsonb_build_object('pode_lancar', false, 'erros', to_jsonb(erros)); end if;
  if not coalesce(p_gravar, false) then return v_res || jsonb_build_object('pode_lancar', true, 'gravado', false); end if;

  -- gravação: pela função da sincronização (trava a O.S.; itens com id novo não conflitam com a fila do PC)
  select * into v_perfil from public.perfis where id = auth.uid();
  r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'itens_os', 'ordem_id', o.id, 'itens', v_novos,
         'antes', jsonb_build_object('status', o.status, 'itens', '{}'::jsonb)), false);
  if r ? 'conflito' then raise exception 'Não gravei: %', r->>'conflito'; end if;
  r := public.sincronizar_alteracao_os(jsonb_build_object('tipo', 'alterar_os', 'ordem_id', o.id, 'status_base', o.status,
         'antes', jsonb_build_object('total', o.total, 'custo', o.custo), 'patch', jsonb_build_object('total', t_total, 'custo', t_custo)), false);
  if r ? 'conflito' then raise exception 'Não gravei: %', r->>'conflito'; end if;
  insert into public.eventos (ordem_id, tipo, texto, usuario_nome)
  values (o.id, 'itens', 'Agente (Claude) lançou ' || jsonb_array_length(v_novos) || ' item(ns): ' || public.agente_reais(t_lanc)
          || case when v_aprov then ' (já aprovados e cobrados)' else '' end || '.', coalesce(v_perfil.nome, ''));
  insert into public.agente_acoes (ferramenta, pedido, tabela, registro, antes, depois, confirmado_por)
  values ('lancar_itens_os', coalesce(p->>'pedido', ''), 'os_itens', o.id::text,
          jsonb_build_object('numero', o.numero, 'total', o.total, 'custo', o.custo),
          jsonb_build_object('numero', o.numero, 'total', t_total, 'custo', t_custo, 'itens', v_novos),
          coalesce(v_perfil.nome, ''));
  return v_res || jsonb_build_object('pode_lancar', true, 'gravado', true);
end $$;

revoke all on function public.agente_lancar_itens_os(jsonb, boolean) from public, anon;
grant execute on function public.agente_lancar_itens_os(jsonb, boolean) to authenticated;
