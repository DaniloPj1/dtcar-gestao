#!/usr/bin/env bash
# Testa o supabase/v36.sql (receber O.S. pelo conector) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v36.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v36" -c "create database dtcar_teste_v36"
psql -q -d dtcar_teste_v36 -v ON_ERROR_STOP=1 -f teste/v36_esquema.sql
psql -q -d dtcar_teste_v36 -v ON_ERROR_STOP=1 -f supabase/v36.sql
psql -q -d dtcar_teste_v36 -v ON_ERROR_STOP=1 -f supabase/v36.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v36 -v ON_ERROR_STOP=1 -f teste/v36_cenarios.sql
