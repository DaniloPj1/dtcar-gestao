#!/usr/bin/env bash
# Testa o supabase/v44.sql (excluir O.S. com peça do estoque) num Postgres local, sobre o esquema do teste do v40.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v44.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v44" -c "create database dtcar_teste_v44"
psql -q -d dtcar_teste_v44 -v ON_ERROR_STOP=1 -f teste/v40_esquema.sql
psql -q -d dtcar_teste_v44 -v ON_ERROR_STOP=1 -c "create or replace function public.e_admin() returns boolean language sql as \$\$ select true \$\$"
psql -q -d dtcar_teste_v44 -v ON_ERROR_STOP=1 -f supabase/v44.sql
psql -q -d dtcar_teste_v44 -v ON_ERROR_STOP=1 -f supabase/v44.sql
psql -q -d dtcar_teste_v44 -v ON_ERROR_STOP=1 <<'SQL'
insert into public.produtos (codigo, descricao, custo, estoque_atual) values (100, 'Pastilha', 50, 10);
insert into public.ordens (id, numero, status, cliente, veiculo) values ('00000000-0000-0000-0000-000000000001', 1, 'diagnostico', '{}', '{}');
select null from public.agente_lancar_itens_os('{"numero": 1, "itens": [{"tipo": "peca", "descricao": "Pastilha", "codigo": "100", "qtd": 2, "valor_unit": 100}]}', true);
do $$ begin
  if (select estoque_atual from public.produtos where codigo = 100) <> 8 then raise exception 'FALHOU: reserva'; end if;
  -- o caminho antigo (apagar só a O.S.) falha pela chave do estoque_mov
  begin delete from public.ordens where numero = 1; raise exception 'FALHOU: o caminho antigo deveria falhar';
  exception when foreign_key_violation then null; end;
  perform public.excluir_ordem('00000000-0000-0000-0000-000000000001');
  if exists (select 1 from public.ordens where numero = 1) then raise exception 'FALHOU: O.S. continua'; end if;
  if (select estoque_atual from public.produtos where codigo = 100) <> 10 then raise exception 'FALHOU: estoque não voltou'; end if;
  begin perform public.excluir_ordem('00000000-0000-0000-0000-000000000001'); raise exception 'FALHOU: deveria dizer não encontrada';
  exception when others then if sqlerrm not like '%não encontrada%' then raise; end if; end;
  raise notice 'OK: v44 (excluir O.S. com peça do estoque)';
end $$;
SQL
