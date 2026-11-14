#!/usr/bin/env bash
# Testa o supabase/v55.sql (consulta do veículo pela placa) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v54 (teste/montar_banco.sh), roda o v55 duas vezes e os cenários (teste/v55_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v55.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v55 54 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v55 -v ON_ERROR_STOP=1 -f supabase/v55.sql
psql -q -d dtcar_teste_v55 -v ON_ERROR_STOP=1 -f supabase/v55.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v55 -v ON_ERROR_STOP=1 -f teste/v55_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v55 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v55 sem resultado"; exit 1; }
