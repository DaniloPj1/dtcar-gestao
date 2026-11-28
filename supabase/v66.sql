-- v66 (28/11/2026, pedido do Danilo — item 2.5 da revisão): O MECÂNICO INICIA O SERVIÇO PELA PLACA, SEM O.S.
-- "Vira um apontamento; o que eu quero é que ele não fique impedido de dar entrada na placa no início do serviço."
-- Caso real: serviço de empresa, a empresa manda a peça e o mecânico já começa; a O.S. é aberta depois.
--
-- 1) servico_apontamentos.ordem_id deixa de ser obrigatório. Apontamento sem O.S. ("avulso") guarda a placa (e o veículo, se
--    estiver no cadastro) e, ao finalizar, o que o mecânico fez escrito (feito_texto).
-- 2) Quando uma O.S. dessa placa é aberta (no sistema, pelo conector, pelo orçamento aprovado ou pelo espelho do OS Oficina),
--    os apontamentos avulsos dos últimos 30 dias se ligam a ela sozinhos (gatilho apontamento_ligar_os) — só O.S. aberta
--    depois de o mecânico começar o carro (ou até um dia antes), nunca O.S. antiga, entregue, cancelada ou recusada. Daí em diante é um
--    apontamento como os outros: entra no histórico do mecânico e, na Comissão › Puxar O.S., o mecânico dele já vem escolhido.
-- 3) Se a O.S. for apagada (espelho zerado na transição), cancelada ou recusada, o avulso volta a ficar solto em vez de
--    sumir junto, e liga de novo quando a O.S. certa aparecer. Os apontamentos feitos dentro de uma O.S. continuam sumindo com ela, como no v60.
-- Não mexe em O.S., itens, estoque nem financeiro. Não altera nenhum registro existente (só colunas novas e regra). Idempotente.
-- Backup, restauração e banco do PC: a tabela já está nas rotinas (v60); as colunas novas vão junto.

alter table public.servico_apontamentos alter column ordem_id drop not null;
alter table public.servico_apontamentos add column if not exists placa text not null default '';
alter table public.servico_apontamentos add column if not exists veiculo_id uuid references public.veiculos (id) on delete set null;
alter table public.servico_apontamentos add column if not exists avulso boolean not null default false;   -- começou sem O.S.
alter table public.servico_apontamentos add column if not exists feito_texto text not null default '';    -- o que fez (avulso)
alter table public.servico_apontamentos add column if not exists ligado_em timestamptz;                   -- quando achou a O.S.

-- placa só com letras e números, em maiúsculas (ABC-1D23 = ABC1D23)
create or replace function public.placa_limpa(p text) returns text language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

-- todo apontamento tem O.S. ou placa
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'servico_apontamentos_os_ou_placa') then
    alter table public.servico_apontamentos add constraint servico_apontamentos_os_ou_placa
      check (ordem_id is not null or public.placa_limpa(placa) <> '') not valid;
  end if;
end $$;

create index if not exists servico_apontamentos_soltos on public.servico_apontamentos (public.placa_limpa(placa)) where ordem_id is null;
-- um avulso aberto por mecânico e placa (o mesmo mecânico não começa o mesmo carro duas vezes)
create unique index if not exists servico_apontamentos_aberto_placa on public.servico_apontamentos (perfil_id, public.placa_limpa(placa))
  where ordem_id is null and situacao <> 'finalizado';

-- solta os avulsos ligados a uma O.S. (O.S. apagada, cancelada ou recusada). Se o mecânico já começou de novo o mesmo carro
-- (outro avulso aberto da mesma placa), o antigo é finalizado antes de soltar: dois abertos do mesmo carro não podem existir,
-- e um erro aqui derrubaria a exclusão da O.S. (e com ela a carga do espelho na transição).
create or replace function public.apontamento_soltar(p_ordem uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update public.servico_apontamentos a set situacao = 'finalizado', fim = coalesce(a.fim, now()), motivo_pausa = ''
   where a.ordem_id = p_ordem and a.avulso and a.situacao <> 'finalizado'
     and exists (select 1 from public.servico_apontamentos b
                  where b.ordem_id is null and b.avulso and b.situacao <> 'finalizado' and b.id <> a.id
                    and b.perfil_id is not distinct from a.perfil_id and public.placa_limpa(b.placa) = public.placa_limpa(a.placa));
  update public.servico_apontamentos set ordem_id = null, os_numero = null, ligado_em = null where ordem_id = p_ordem and avulso;
end $$;
revoke all on function public.apontamento_soltar(uuid) from public, anon, authenticated;

-- liga os avulsos da placa à O.S. — só a O.S. aberta DEPOIS (ou no máximo um dia antes) de o mecânico começar o carro:
-- a carga do espelho e a restauração reinserem o histórico inteiro, e o avulso não pode cair numa O.S. antiga já entregue.
create or replace function public.apontamento_ligar_os() returns trigger language plpgsql security definer set search_path = public as $$
declare v_placa text;
begin
  -- O.S. que passou a cancelada/recusada devolve o avulso para ficar solto (e ligar na O.S. certa depois)
  if tg_op = 'UPDATE' and new.status in ('recusado', 'cancelado') and old.status is distinct from new.status then
    perform public.apontamento_soltar(new.id); return new;
  end if;
  if new.status in ('recusado', 'cancelado', 'entregue') then return new; end if;
  v_placa := public.placa_limpa(coalesce(nullif(new.veiculo->>'placa', ''), (select placa from public.veiculos where id = new.veiculo_id)));
  if v_placa = '' then return new; end if;
  update public.servico_apontamentos
     set ordem_id = new.id, os_numero = new.numero, ligado_em = now(),
         veiculo_id = coalesce(veiculo_id, new.veiculo_id)
   where ordem_id is null and avulso
     and public.placa_limpa(placa) = v_placa
     and inicio >= now() - interval '30 days'
     and coalesce(new.criado_em, now()) >= inicio - interval '1 day'
     -- não junta dois abertos do mesmo mecânico na mesma O.S. (regra do v60)
     and not exists (select 1 from public.servico_apontamentos b
                      where b.ordem_id = new.id and b.perfil_id = servico_apontamentos.perfil_id
                        and b.situacao <> 'finalizado' and servico_apontamentos.situacao <> 'finalizado');
  return new;
end $$;
drop trigger if exists ordens_liga_apontamentos on public.ordens;
drop trigger if exists ordens_liga_apontamentos_ins on public.ordens;
drop trigger if exists ordens_liga_apontamentos_upd on public.ordens;
create trigger ordens_liga_apontamentos_ins after insert on public.ordens
  for each row execute function public.apontamento_ligar_os();
-- na alteração, só quando muda o carro ou a situação (salvar a O.S. sem mexer no veículo não religa nada)
create trigger ordens_liga_apontamentos_upd after update of veiculo_id, veiculo, status on public.ordens
  for each row when (old.veiculo_id is distinct from new.veiculo_id
                     or public.placa_limpa(old.veiculo->>'placa') is distinct from public.placa_limpa(new.veiculo->>'placa')
                     or old.status is distinct from new.status)
  execute function public.apontamento_ligar_os();

-- antes de apagar a O.S., o avulso volta a ficar solto (não some em cascata)
create or replace function public.apontamento_soltar_os() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.apontamento_soltar(old.id);
  return old;
end $$;
drop trigger if exists ordens_solta_apontamentos on public.ordens;
create trigger ordens_solta_apontamentos before delete on public.ordens
  for each row execute function public.apontamento_soltar_os();

revoke all on function public.apontamento_ligar_os() from public, anon, authenticated;
revoke all on function public.apontamento_soltar_os() from public, anon, authenticated;
