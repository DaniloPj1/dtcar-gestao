#!/usr/bin/env bash
# Testa o supabase/v29.sql (e-mail da oficina) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v29.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v29" -c "create database dtcar_teste_v29"
psql -q -d dtcar_teste_v29 -v ON_ERROR_STOP=1 -f teste/v29_esquema.sql
psql -q -d dtcar_teste_v29 -v ON_ERROR_STOP=1 -f supabase/v29.sql
psql -q -d dtcar_teste_v29 -v ON_ERROR_STOP=1 -f supabase/v29.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v29 -v ON_ERROR_STOP=1 -o /dev/null -f teste/v29_cenarios.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "teste_v29: tudo certo"
