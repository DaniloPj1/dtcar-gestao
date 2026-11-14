-- v57 (14/11/2026, pedido do Danilo): FICHA DE ÓLEO E FILTROS NO VEÍCULO (etapa 2 de "Óleo e filtros por veículo").
-- Na página do veículo, o botão "Preencher pelo catálogo" mostra as versões do carro (motor) e as respostas de óleo do catálogo;
-- quem está na oficina escolhe a certa e a ficha fica gravada no veículo (e o motor, se o cadastro não tinha). Assim a escolha é feita
-- uma vez por carro e não depende mais de adivinhar o motor.
--
--   veiculos.ficha_oleo  jsonb, vazio até a ficha ser feita. Formato:
--     { litros, viscosidade, norma, filtros: { oleo:[], ar:[], combustivel:[], cabine:[] }, marca, base,
--       origem: 'catalogo' | 'oficina', em, confirmado_em }
--     origem 'catalogo' = veio do catálogo ("Do catálogo, confira"); 'oficina' = alguém conferiu e confirmou.
--
-- Só uma coluna nova em tabela que já existe: segue no backup, no banco do PC e na leitura do conector sem mudança (linha inteira).
-- A gravação usa a mesma regra de quem já edita o veículo (políticas de veiculos). Idempotente.

alter table public.veiculos add column if not exists ficha_oleo jsonb;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'veiculos_ficha_oleo_objeto') then
    alter table public.veiculos add constraint veiculos_ficha_oleo_objeto
      check (ficha_oleo is null or jsonb_typeof(ficha_oleo) = 'object');
  end if;
end $$;

comment on column public.veiculos.ficha_oleo is 'Ficha de óleo e filtros do veículo (v57): litros, viscosidade, norma, códigos dos filtros e se veio do catálogo ou foi confirmada pela oficina.';
