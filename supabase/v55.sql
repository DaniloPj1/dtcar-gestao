-- v55 (13/11/2026, pedido do Danilo): CONSULTA DO VEÍCULO PELA PLACA (API Placas — apiplacas.com.br, provedor WDAPI).
-- Ao digitar uma placa que ainda não está no cadastro (Nova O.S., cadastro de veículo, orçamento, agenda), o sistema busca
-- marca, modelo, ano, cor, combustível e motor (consulta "básica", R$ 0,03). O botão "Consulta completa", na ficha do
-- veículo, traz também chassi, Renavam e número do motor (R$ 0,20). O Claude usa pelo conector (consultar_placa).
-- Quem fala com a API é a função "placa" do Supabase: a chave (segredo API_PLACAS_TOKEN da função) nunca chega ao navegador.
--
-- REGRA DO DANILO: só vai à API quando o sistema ainda não tem os dados — 1º o cadastro de veículos, 2º esta cópia, 3º a API.
--
--   placa_consultas   cada consulta PAGA que deu certo. Serve de cópia (a mesma placa não é paga de novo: a básica vale
--                     180 dias, a completa 365; a completa também serve de básica) e de histórico do gasto.
--
-- Quem grava é só a função "placa", com a chave de servidor (sem política de gravação aqui: ninguém grava pela tela,
-- então ninguém consegue pôr dado falso na cópia). Administrador e consultor leem (tela Ajustes: consultas e gasto do mês);
-- o mecânico recebe os dados pela função, sem ler a tabela. O papel agente_leitura (v19) não lê: o conector usa o login do Danilo.
-- Placa não encontrada ou erro não é cobrado pela API e não entra aqui.
-- Log operacional (como email_envios): FORA do backup, do banco do PC e da restauração.
-- Período de transição (espelho do OS Oficina): a tabela é PRESERVADA, não entra em espelho_legado_zerar(): consulta de placa
-- não existe no sistema antigo (uma carga nunca a traria de volta), não tem chave estrangeira para clientes nem veículos, e
-- apagar a cópia faria a oficina pagar de novo pelas mesmas placas. A consulta só preenche o cadastro de veículos: com o
-- espelho ligado, o veículo cadastrado aqui some na carga seguinte como qualquer outro; depois da virada, fica. Idempotente.

create table if not exists public.placa_consultas (
  id bigserial primary key,
  placa text not null check (placa ~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$'),
  tipo text not null check (tipo in ('basico', 'completa')),
  dados jsonb not null default '{}'::jsonb,       -- já no formato do cadastro: marca, modelo, ano_fab, ano_mod, cor, combustivel, motor, chassi, renavam…
  resposta jsonb,                                 -- a resposta inteira da API (os dados são montados de novo a partir dela a cada leitura)
  valor_centavos int not null default 0 check (valor_centavos >= 0),   -- quanto a API descontou do saldo
  saldo_centavos int,                             -- saldo que sobrou no API Placas depois desta consulta (vazio = a API não informou)
  por uuid,                                       -- quem pediu (auth.users); sem chave estrangeira: é histórico
  em timestamptz not null default now()
);
alter table public.placa_consultas add column if not exists resposta jsonb;
alter table public.placa_consultas add column if not exists saldo_centavos int;
create index if not exists placa_consultas_placa on public.placa_consultas (placa, em desc);
create index if not exists placa_consultas_dia on public.placa_consultas (em);

alter table public.placa_consultas enable row level security;
drop policy if exists placa_consultas_ler on public.placa_consultas;
create policy placa_consultas_ler on public.placa_consultas for select to authenticated using (public.e_gestor());
revoke all on public.placa_consultas from public, anon, authenticated;
grant select on public.placa_consultas to authenticated;
grant all on public.placa_consultas to service_role;
grant usage, select on sequence public.placa_consultas_id_seq to service_role;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'agente_leitura') then
    execute 'revoke all on public.placa_consultas from agente_leitura';
  end if;
end $$;
