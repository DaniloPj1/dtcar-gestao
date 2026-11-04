#!/usr/bin/env bash
# Testa o supabase/v32.sql (despesa fixa sem fim) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v32.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v32" -c "create database dtcar_teste_v32"
psql -q -d dtcar_teste_v32 -v ON_ERROR_STOP=1 -f teste/v32_esquema.sql
psql -q -d dtcar_teste_v32 -v ON_ERROR_STOP=1 -f supabase/v32.sql
psql -q -d dtcar_teste_v32 -v ON_ERROR_STOP=1 -f supabase/v32.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v32 -v ON_ERROR_STOP=1 -f teste/v32_cenarios.sql
