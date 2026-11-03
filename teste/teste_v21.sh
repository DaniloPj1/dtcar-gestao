#!/usr/bin/env bash
# Testa a função do supabase/v21.sql (agente lança itens na O.S.) num Postgres local (sem tocar no banco real).
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v21.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v21" -c "create database dtcar_teste_v21"
psql -q -d dtcar_teste_v21 -v ON_ERROR_STOP=1 -f teste/v21_esquema.sql
psql -q -d dtcar_teste_v21 -v ON_ERROR_STOP=1 -f supabase/v21.sql
psql -q -d dtcar_teste_v21 -v ON_ERROR_STOP=1 -f supabase/v21.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v21 -v ON_ERROR_STOP=1 -f teste/v21_cenarios.sql
