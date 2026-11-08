-- =====================================================================
-- DTCar Gestão — v46: backup de leitura só em dia útil (sem sábado, domingo e feriado nacional).
--
-- Pedido do Danilo (08/11/2026): "tire o disparo de backup dos finais de semana e feriados".
--   * dtcar-backup-leitura (18h) e dtcar-backup-leitura-vigia (18h40) passam a rodar de segunda a sexta
--     ('1-5' no pg_cron) e não rodam em feriado nacional (feriado_nacional, abaixo).
--   * O aviso "backup não foi enviado" segue o mesmo calendário: não acusa falta em fim de semana e feriado.
--   * O botão "Gerar e enviar agora" (Sistema › Backup) continua funcionando em qualquer dia.
-- Feriados nacionais: os mesmos da folha de ponto (js/folha.js) + Sexta-feira da Paixão (móvel, pela Páscoa).
-- Feriado municipal de Colatina e ponto facultativo (Carnaval, Corpus Christi) NÃO entram.
-- Rode depois do v35. Pode rodar mais de uma vez. Não mexe em dados; igual antes e depois da virada.
-- =====================================================================

-- Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano)
create or replace function public.pascoa(p_ano int) returns date
language plpgsql immutable as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mes int; dia int;
begin
  a := p_ano % 19; b := p_ano / 100; c := p_ano % 100; d := b / 4; e := b % 4; f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30; i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451; mes := (h + l - 7 * m + 114) / 31; dia := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_ano, mes, dia);
end $$;

-- Nome do feriado nacional na data (null = não é feriado)
create or replace function public.feriado_nacional(p_dia date) returns text
language sql immutable as $$
  select coalesce(
    case to_char(p_dia, 'MM-DD')
      when '01-01' then 'Confraternização Universal' when '04-21' then 'Tiradentes' when '05-01' then 'Dia do Trabalho'
      when '09-07' then 'Independência' when '10-12' then 'N. Sra. Aparecida' when '11-02' then 'Finados'
      when '11-15' then 'Proclamação da República' when '11-20' then 'Consciência Negra' when '12-25' then 'Natal' end,
    case when p_dia = public.pascoa(extract(year from p_dia)::int) - 2 then 'Sexta-feira da Paixão' end)
$$;

-- Dia útil para o backup: segunda a sexta e sem feriado nacional
create or replace function public.backup_leitura_dia_util(p_dia date default (now() at time zone 'America/Sao_Paulo')::date) returns boolean
language sql stable as $$
  select extract(isodow from p_dia) < 6 and public.feriado_nacional(p_dia) is null
$$;

-- Agendamentos: os mesmos do v35, só em dia útil
do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('dtcar-backup-leitura', 'dtcar-backup-leitura-vigia');
end $$;
select cron.schedule('dtcar-backup-leitura', '0 21 * * 1-5', $cron$
  select net.http_post(
    url := 'https://vbbklawlbxznsemkgtvg.supabase.co/functions/v1/email',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-dtcar-cron', (select valor from public.segredos where chave = 'cron')),
    body := '{"acao":"backup_leitura","origem":"agendamento"}'::jsonb,
    timeout_milliseconds := 60000)
  where coalesce((select (dados -> 'backupLeitura' ->> 'ativo')::boolean from public.config where id = 1), true)
    and public.backup_leitura_dia_util()
$cron$);
select cron.schedule('dtcar-backup-leitura-vigia', '40 21 * * 1-5', $cron$
  select public.backup_leitura_vigiar() where public.backup_leitura_dia_util()
$cron$);
