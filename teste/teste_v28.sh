#!/usr/bin/env bash
# Testa o supabase/v28.sql (boletos Sicredi) num Postgres local (sem tocar no banco real).
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v28.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v28" -c "create database dtcar_teste_v28"
psql -q -d dtcar_teste_v28 -v ON_ERROR_STOP=1 -f teste/v28_esquema.sql
psql -q -d dtcar_teste_v28 -v ON_ERROR_STOP=1 -f supabase/v28.sql
psql -q -d dtcar_teste_v28 -v ON_ERROR_STOP=1 -f supabase/v28.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v28 -f teste/v28_cenarios.sql 2>/dev/null > /tmp/v28_saida.txt
if diff -u teste/v28_esperado.txt /tmp/v28_saida.txt; then echo "OK: v28 ($(wc -l < teste/v28_esperado.txt) cenários)"; else echo "FALHAS no v28"; exit 1; fi
