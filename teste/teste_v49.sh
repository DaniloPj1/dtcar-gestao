#!/usr/bin/env bash
# Testa o supabase/v49.sql (consulta da SEFAZ na hora, 8h e 16h) num Postgres local, com o GitHub FALSO (pg_net de mentira).
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v49.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v49" -c "create database dtcar_teste_v49"
psql -q -d dtcar_teste_v49 -v ON_ERROR_STOP=1 -f teste/v49_esquema.sql
psql -q -d dtcar_teste_v49 -v ON_ERROR_STOP=1 -f supabase/v49.sql
psql -q -d dtcar_teste_v49 -v ON_ERROR_STOP=1 -f supabase/v49.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v49 -v ON_ERROR_STOP=1 -f teste/v49_cenarios.sql
psql -q -c "drop database dtcar_teste_v49"
echo "teste_v49: tudo certo"
