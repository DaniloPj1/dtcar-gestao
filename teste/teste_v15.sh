#!/usr/bin/env bash
# Testa a função do supabase/v15.sql num Postgres local (sem tocar no banco real).
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v15.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v15" -c "create database dtcar_teste_v15"
psql -q -d dtcar_teste_v15 -v ON_ERROR_STOP=1 -f teste/v15_esquema.sql
psql -q -d dtcar_teste_v15 -v ON_ERROR_STOP=1 -f supabase/v15.sql
psql -q -d dtcar_teste_v15 -v ON_ERROR_STOP=1 -f supabase/v15.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v15 -f teste/v15_cenarios.sql > /tmp/v15_saida.txt
if diff -u teste/v15_esperado.txt /tmp/v15_saida.txt; then echo "OK: v15 ($(wc -l < teste/v15_esperado.txt) cenários)"; else echo "FALHAS no v15"; exit 1; fi
