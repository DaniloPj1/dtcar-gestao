#!/usr/bin/env bash
# Testa o supabase/v41.sql (boleto Sicredi pelo conector) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v41.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v41" -c "create database dtcar_teste_v41"
psql -q -d dtcar_teste_v41 -v ON_ERROR_STOP=1 -f teste/v40_esquema.sql
psql -q -d dtcar_teste_v41 -v ON_ERROR_STOP=1 -f supabase/v40.sql
psql -q -d dtcar_teste_v41 -v ON_ERROR_STOP=1 -f supabase/v41.sql
psql -q -d dtcar_teste_v41 -v ON_ERROR_STOP=1 -f supabase/v41.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v41 -v ON_ERROR_STOP=1 -f teste/v41_cenarios.sql
