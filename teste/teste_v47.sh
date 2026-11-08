#!/usr/bin/env bash
# Testa o supabase/v47.sql (conteúdo do site institucional) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v47.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v47" -c "create database dtcar_teste_v47"
psql -q -d dtcar_teste_v47 -v ON_ERROR_STOP=1 -f teste/v47_cenarios.sql
psql -q -c "drop database dtcar_teste_v47"
echo "teste_v47: tudo certo"
