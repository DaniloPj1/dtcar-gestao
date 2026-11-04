#!/usr/bin/env bash
# Testa o supabase/v30.sql (Documentos do RH) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v30.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v30" -c "create database dtcar_teste_v30"
psql -q -d dtcar_teste_v30 -v ON_ERROR_STOP=1 -f teste/v30_esquema.sql
psql -q -d dtcar_teste_v30 -v ON_ERROR_STOP=1 -f supabase/v30.sql
psql -q -d dtcar_teste_v30 -v ON_ERROR_STOP=1 -f supabase/v30.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v30 -v ON_ERROR_STOP=1 -o /dev/null -f teste/v30_cenarios.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "teste_v30: tudo certo"
