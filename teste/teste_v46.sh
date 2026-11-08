#!/usr/bin/env bash
# Testa o supabase/v46.sql (backup de leitura só em dia útil) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v46.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v46" -c "create database dtcar_teste_v46"
psql -q -d dtcar_teste_v46 -v ON_ERROR_STOP=1 -f teste/v46_cenarios.sql
psql -q -c "drop database dtcar_teste_v46"
echo "teste_v46: tudo certo"
