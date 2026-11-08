-- =====================================================================
-- DTCar Gestão — v45: aviso de contas a pagar no WhatsApp do Danilo.
--
-- Pedido do Danilo (08/11/2026): "as contas que estão vencendo não me dão nenhum alerta". Ele quer receber no
-- WhatsApp as contas vencidas, as que vencem no dia e as do dia seguinte.
--
-- Como funciona (decisões do Danilo em 08/11/2026):
--   * 09h (Brasília): resumo com as VENCIDAS, as que VENCEM HOJE e as que VENCEM AMANHÃ. Na sexta, "amanhã" vai
--     até a segunda (sábado, domingo e segunda juntos); no sábado, domingo e segunda. Feriado não é considerado.
--   * 16h: novo alerta SÓ se ainda houver conta vencida ou vencendo hoje sem baixa (status 'aberta').
--   * Dia sem nada para avisar: não sai mensagem.
--   * Vai para o número de alerta da tela Sistema › WhatsApp (whatsapp_conexao.alerta_telefone) como mensagem
--     interna (whatsapp_interno, v36): sai primeiro, fora dos limites, e respeita o silêncio das 22h às 7h.
--   * Uma mensagem por turno por dia (tabela contas_avisos): rodar de novo no mesmo turno não repete. Só marca o turno
--     quando a mensagem entrou na fila (sem número de alerta, tenta de novo na próxima chamada).
--
-- Agendamentos (pg_cron em UTC; Brasília = UTC−3, sem horário de verão):
--   dtcar-contas-aviso-09h  '0 12 * * *'   dtcar-contas-aviso-16h  '0 19 * * *'
--
-- Teste manual (não envia de novo se o turno do dia já saiu; p_forcar = true manda mesmo assim):
--   select public.contas_aviso_texto('manha');            -- só mostra o texto, não põe na fila
--   select public.contas_aviso_enviar('manha', true);     -- põe na fila agora
--
-- Tabela contas_avisos: registro do que foi enviado (log operacional, como backup_execucoes e email_envios):
-- fora do backup, do banco do PC e do espelho. Contas a pagar não são limpas pelo espelho; igual antes e depois
-- da virada.
-- Rode depois do v36. Pode rodar mais de uma vez.
-- =====================================================================

create table if not exists public.contas_avisos (
  dia date not null,
  turno text not null check (turno in ('manha', 'tarde')),
  fila_id bigint,
  contas int not null default 0,
  texto text not null default '',
  criado_em timestamptz not null default now(),
  primary key (dia, turno)
);
alter table public.contas_avisos enable row level security;
drop policy if exists contas_avisos_ler on public.contas_avisos;
create policy contas_avisos_ler on public.contas_avisos for select to authenticated using (public.e_admin());
revoke insert, update, delete on public.contas_avisos from anon, authenticated;

-- Último dia que entra em "vence amanhã": de amanhã até o próximo dia útil (seg–sex).
-- sex → seg; sáb → seg; dom → seg; seg a qui → o dia seguinte.
create or replace function public.contas_aviso_ate(p_hoje date) returns date
language plpgsql immutable as $$
declare d date := p_hoje + 1;
begin
  while extract(isodow from d) in (6, 7) loop d := d + 1; end loop;
  return d;
end $$;

-- Valor em reais: 1234.5 → "R$ 1.234,50"
create or replace function public.contas_aviso_reais(v numeric) returns text
language sql immutable as $$
  select 'R$ ' || replace(replace(replace(to_char(coalesce(v, 0), 'FM999G999G990D00'), ',', '#'), '.', ','), '#', '.')
$$;

-- Linha de uma conta: "• 05/11 · CIA BRA de Dis Auto · parc. 3/4 · R$ 320,00"
create or replace function public.contas_aviso_linha(c public.contas, p_com_data boolean) returns text
language sql stable set search_path = public as $$
  select '• ' || case when p_com_data then to_char(c.vencimento, 'DD/MM') || ' · ' else '' end
         || left(coalesce(nullif(btrim(c.favorecido), ''),
                          (select nullif(btrim(coalesce(nullif(f.fantasia, ''), f.razao)), '') from public.fornecedores f where f.id = c.fornecedor_id),
                          nullif(btrim(c.descricao), ''), 'Conta sem nome'), 40)
         || case when coalesce(c.parcelas, 0) > 1 then ' · parc. ' || c.parcela || '/' || c.parcelas else '' end
         || ' · ' || public.contas_aviso_reais(c.valor)
$$;

-- Monta o texto do aviso. 'manha' = vencidas + hoje + amanhã; 'tarde' = só vencidas + hoje (as que ainda estão
-- sem baixa). Devolve null quando não há nada para avisar.
create or replace function public.contas_aviso_texto(p_turno text) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_ate date := public.contas_aviso_ate((now() at time zone 'America/Sao_Paulo')::date);
  v_txt text; v_bloco text; v_n int; v_soma numeric; v_total int := 0; v_valor numeric := 0;
  g record;
  v_dias text[] := array['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
begin
  if p_turno not in ('manha', 'tarde') then raise exception 'Turno inválido: %', p_turno; end if;
  if auth.uid() is not null and not public.e_admin() then raise exception 'Só o administrador'; end if;
  v_txt := case when p_turno = 'manha' then '💰 *Contas a pagar* — ' else '⏰ *Contas a pagar ainda sem baixa* — ' end
           || v_dias[extract(dow from v_hoje)::int + 1] || ' ' || to_char(v_hoje, 'DD/MM');
  for g in
    select * from (values
      (1, '🔴 *Vencidas*', null::date, v_hoje - 1, true),
      (2, '🟡 *Vencem hoje*', v_hoje, v_hoje, false),
      (3, case when v_ate = v_hoje + 1 then '🔵 *Vencem amanhã (' || to_char(v_ate, 'DD/MM') || ')*'
               else '🔵 *Vencem até ' || v_dias[extract(dow from v_ate)::int + 1] || ' (' || to_char(v_ate, 'DD/MM') || ')*' end,
          v_hoje + 1, v_ate, v_ate > v_hoje + 1)
    ) t(ordem, titulo, de, ate, com_data)
    where p_turno = 'manha' or t.ordem < 3
    order by t.ordem
  loop
    select count(*), coalesce(sum((c.k).valor), 0),
           string_agg(public.contas_aviso_linha(c.k, g.com_data), E'\n' order by c.rn) filter (where c.rn <= 10)
      into v_n, v_soma, v_bloco
      from (select x as k, row_number() over (order by x.vencimento, x.valor desc) rn
              from public.contas x
             where x.status = 'aberta' and x.vencimento <= g.ate and (g.de is null or x.vencimento >= g.de)) c;
    if v_n = 0 then continue; end if;
    v_total := v_total + v_n; v_valor := v_valor + v_soma;
    v_txt := v_txt || E'\n\n' || g.titulo || ' — ' || v_n || ' · ' || public.contas_aviso_reais(v_soma) || E'\n' || v_bloco
             || case when v_n > 10 then E'\n• … e mais ' || (v_n - 10) || ' conta(s)' else '' end;
  end loop;
  if v_total = 0 then return null; end if;
  v_txt := v_txt || E'\n\n*Total: ' || public.contas_aviso_reais(v_valor) || '*'
           || E'\n_Pagou? Dê baixa em Financeiro › Contas a pagar' || case when p_turno = 'manha'
                then ': às 16h chega outro aviso só se ainda houver vencida ou vencendo hoje._'
                else '._' end;
  if length(v_txt) > 1990 then v_txt := left(v_txt, 1950) || E'\n… (cortado: veja Contas a pagar no sistema)'; end if;
  return v_txt;
end $$;

-- Põe o aviso na fila do WhatsApp. Devolve o id da fila (null = nada a avisar, já enviado no turno ou sem número
-- de alerta). p_forcar = true ignora o "já enviado hoje" (teste manual).
create or replace function public.contas_aviso_enviar(p_turno text, p_forcar boolean default false) returns bigint
language plpgsql volatile security definer set search_path = public as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_txt text; v_id bigint; v_n int;
begin
  -- pelo site só o administrador; o agendamento (pg_cron) roda sem login
  if auth.uid() is not null and not public.e_admin() then raise exception 'Só o administrador'; end if;
  if p_turno not in ('manha', 'tarde') then raise exception 'Turno inválido: %', p_turno; end if;
  -- uma chamada por turno de cada vez (agendamento + teste manual ao mesmo tempo não mandam duas mensagens)
  perform pg_advisory_xact_lock(hashtext('dtcar-contas-aviso-' || p_turno));
  if not p_forcar and exists (select 1 from public.contas_avisos where dia = v_hoje and turno = p_turno) then return null; end if;
  v_txt := public.contas_aviso_texto(p_turno);
  if v_txt is null then return null; end if;
  v_id := public.whatsapp_interno(v_txt);
  -- sem número de alerta (ou WhatsApp desligado): nada entrou na fila; não marca o turno, para sair quando configurar
  if v_id is null then return null; end if;
  select count(*) into v_n from public.contas
   where status = 'aberta' and vencimento <= case when p_turno = 'manha' then public.contas_aviso_ate(v_hoje) else v_hoje end;
  insert into public.contas_avisos (dia, turno, fila_id, contas, texto) values (v_hoje, p_turno, v_id, v_n, v_txt)
  on conflict (dia, turno) do update set fila_id = excluded.fila_id, contas = excluded.contas, texto = excluded.texto, criado_em = now();
  return v_id;
end $$;

revoke all on function public.contas_aviso_texto(text) from public, anon;
revoke all on function public.contas_aviso_enviar(text, boolean) from public, anon;
grant execute on function public.contas_aviso_texto(text) to authenticated;
grant execute on function public.contas_aviso_enviar(text, boolean) to authenticated;

-- Agendamentos (refaz se já existirem)
do $$ begin
  perform cron.unschedule(jobname) from cron.job where jobname in ('dtcar-contas-aviso-09h', 'dtcar-contas-aviso-16h');
end $$;
select cron.schedule('dtcar-contas-aviso-09h', '0 12 * * *', $cron$ select public.contas_aviso_enviar('manha') $cron$);
select cron.schedule('dtcar-contas-aviso-16h', '0 19 * * *', $cron$ select public.contas_aviso_enviar('tarde') $cron$);
