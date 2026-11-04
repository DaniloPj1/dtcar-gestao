#!/usr/bin/env bash
# Testa o supabase/v31.sql (pedidos de compra por fornecedor) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v31.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v31" -c "create database dtcar_teste_v31"
psql -q -d dtcar_teste_v31 -v ON_ERROR_STOP=1 -f teste/v31_esquema.sql
psql -q -d dtcar_teste_v31 -v ON_ERROR_STOP=1 -f supabase/v31.sql
psql -q -d dtcar_teste_v31 -v ON_ERROR_STOP=1 -f supabase/v31.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v31 -v ON_ERROR_STOP=1 -f teste/v31_cenarios.sql
