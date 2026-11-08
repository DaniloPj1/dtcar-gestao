#!/usr/bin/env bash
# Testa o supabase/v48.sql (conteúdo do site institucional) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v48.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v48" -c "create database dtcar_teste_v48"
psql -q -d dtcar_teste_v48 -v ON_ERROR_STOP=1 -f teste/v48_cenarios.sql
psql -q -c "drop database dtcar_teste_v48"
echo "teste_v48: tudo certo"
