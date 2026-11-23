-- v62 (19/11/2026, pedido do Danilo): APAGAR FALHA PELO APP, COM REGISTRO DE QUEM APAGOU.
-- Até aqui o diagnóstico OBD era só leitura. Apagar é o único comando que o app manda PARA o carro, e apagar sem registro é o
-- que vira discussão depois ("quem zerou a luz?", "o carro chegou assim?"). Por isso cada apagamento deixa uma linha aqui:
-- quem, quando, qual carro, o KM, os códigos que estavam lá ANTES e, logo depois, os que sobraram — e o ajuste de combustível
-- antes e depois, que é o que mostra se o módulo recomeçou a aprender.
-- A mesma tabela guarda LEITURA gravada (tipo = 'leitura'), que é a etapa seguinte (prova do reparo na O.S.).
-- Decisão do Danilo (19/11/2026): apagar é do administrador; ele libera por pessoa em Sistema › Equipe (cfg.appAcessos[id].obd_apagar,
-- na tabela config, sem SQL). Aqui o banco só registra: quem apaga é o aparelho na mão do mecânico, com o carro na frente.
-- NINGUÉM ALTERA uma linha gravada (não há política de update): é registro, não rascunho.
-- Não mexe em O.S., estoque nem financeiro. Backup, banco do PC (atualizado_em + exclusoes) e restauração incluídos. Idempotente.
-- Período de transição (espelho do OS Oficina): PRESERVADA, não entra em espelho_legado_zerar() — não existe no OS Oficina e
-- apagar o registro de quem mexeu no carro seria perder prova. Sem chave estrangeira para veiculos/ordens, que o espelho recarrega.

create table if not exists public.obd_leituras (
  id uuid primary key default gen_random_uuid(),
  tipo text not null default 'leitura' check (tipo in ('leitura', 'apagar')),
  perfil_id uuid references public.perfis (id) on delete set null,
  perfil_nome text not null default '',
  placa text not null default '',
  veiculo_id uuid,                                      -- sem chave estrangeira: o espelho recarrega veiculos
  ordem_id uuid,                                        -- idem para ordens (como pre_notas, v19)
  os_numero int,
  km int,
  vin text not null default '',                         -- chassi lido do módulo (09 02), quando o carro informa
  codigos jsonb not null default '[]'::jsonb,           -- o que estava lá ANTES: [{ codigo, origem, texto }]
  codigos_depois jsonb,                                 -- o que sobrou logo depois (null = não deu para conferir)
  combustivel jsonb,                                    -- ajuste de combustível antes (leituraCombustivel de js/obd.js)
  combustivel_depois jsonb,                             -- e depois, para ver o módulo recomeçando a aprender
  leituras jsonb not null default '[]'::jsonb,          -- valores ao vivo no momento: [{ chave, rotulo, unidade, valor }]
  prontidao jsonb,                                      -- monitores (01 01) no momento
  obs text not null default '',
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists obd_leituras_placa on public.obd_leituras (placa, criado_em desc);
create index if not exists obd_leituras_ordem on public.obd_leituras (ordem_id);
create index if not exists obd_leituras_perfil on public.obd_leituras (perfil_id, criado_em desc);
create index if not exists obd_leituras_atualizado on public.obd_leituras (atualizado_em);

drop trigger if exists obd_leituras_toca on public.obd_leituras;
create trigger obd_leituras_toca before update on public.obd_leituras for each row execute function public.toca_atualizado();
drop trigger if exists obd_leituras_exclusao on public.obd_leituras;
create trigger obd_leituras_exclusao after delete on public.obd_leituras for each row execute function public.registra_exclusao();

alter table public.obd_leituras enable row level security;
revoke all on public.obd_leituras from anon;
grant select, insert, delete on public.obd_leituras to authenticated;
-- a equipe toda lê (o mecânico precisa ver se este carro já foi apagado antes); cada um grava o seu; só o administrador apaga.
-- Não existe política de UPDATE de propósito: linha gravada não muda mais.
drop policy if exists obd_leituras_ler on public.obd_leituras;
create policy obd_leituras_ler on public.obd_leituras for select to authenticated using (public.e_membro());
drop policy if exists obd_leituras_incluir on public.obd_leituras;
create policy obd_leituras_incluir on public.obd_leituras for insert to authenticated with check (public.e_membro() and (perfil_id = auth.uid() or public.e_gestor()));
drop policy if exists obd_leituras_excluir on public.obd_leituras;
create policy obd_leituras_excluir on public.obd_leituras for delete to authenticated using (public.e_admin());

-- papel só de leitura do agente (v19)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    grant select on public.obd_leituras to agente_leitura;
    drop policy if exists obd_leituras_agente_ler on public.obd_leituras;
    create policy obd_leituras_agente_ler on public.obd_leituras for select to agente_leitura using (true);
  end if;
end $$;

-- backup: a restauração passa a aceitar obd_leituras (resto igual ao v60)
do $$
declare fonte text; novo text;
begin
  select pg_get_functiondef(p.oid) into fonte from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'restaurar_tabela';
  if fonte is null then raise exception 'restaurar_tabela não existe: rode os SQL anteriores antes do v62.'; end if;
  if position('''obd_leituras''' in fonte) > 0 then return; end if;   -- já aceita: nada a fazer (idempotente)
  novo := replace(fonte, '''servico_apontamentos'')', '''servico_apontamentos'', ''obd_leituras'')');
  if novo = fonte then raise exception 'não achei a lista de tabelas de restaurar_tabela: confira o v62 à mão.'; end if;
  execute novo;
end $$;
revoke all on function public.restaurar_tabela(text, jsonb) from public, anon;
grant execute on function public.restaurar_tabela(text, jsonb) to authenticated;
