#!/usr/bin/env bash
# Testa o supabase/v45.sql (aviso de contas a pagar no WhatsApp) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v45.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v45" -c "create database dtcar_teste_v45"
psql -q -d dtcar_teste_v45 -v ON_ERROR_STOP=1 -f teste/v45_esquema.sql
psql -q -d dtcar_teste_v45 -v ON_ERROR_STOP=1 -f supabase/v45.sql
psql -q -d dtcar_teste_v45 -v ON_ERROR_STOP=1 -f supabase/v45.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v45 -v ON_ERROR_STOP=1 -f teste/v45_cenarios.sql
psql -q -c "drop database dtcar_teste_v45"
echo "teste_v45: tudo certo"
