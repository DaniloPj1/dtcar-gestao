#!/usr/bin/env bash
# Monta num Postgres local o banco INTEIRO da oficina: o Supabase de mentira (teste/supabase_falso.sql), o schema.sql e
# todos os supabase/vNN.sql em ordem — como o Danilo rodou no SQL Editor. Serve de base para testar um SQL novo contra o
# esquema de verdade (e não contra um esquema resumido).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/montar_banco.sh <banco> [até o vNN, inclusive]
# As linhas "create extension pg_cron/pg_net" são puladas (o Supabase de mentira já traz cron e net).
set -euo pipefail
cd "$(dirname "$0")/.."
BANCO="${1:?informe o nome do banco}"; ATE="${2:-999}"
psql -q -c "drop database if exists $BANCO" -c "create database $BANCO" >/dev/null
psql -q -d "$BANCO" -v ON_ERROR_STOP=1 -f teste/supabase_falso.sql >/dev/null
for f in supabase/schema.sql $(ls supabase/v*.sql | sort -V); do
  n=$(basename "$f" .sql); n=${n#v}; n=${n%%_*}
  if [ "$f" != supabase/schema.sql ] && [ "$n" -gt "$ATE" ]; then continue; fi
  # v17 (virada): só a regra nova (função); o acerto das 42 O.S. depende dos dados reais da oficina
  if [ "$(basename "$f")" = v17_virada.sql ]; then src=$(sed -n '1,/^-- 2\. Ajuste das O\.S\./p' "$f"); else src=$(cat "$f"); fi
  printf '%s\n' "$src" | sed -E 's/^\s*create extension if not exists (pg_cron|pg_net)[^;]*;//I' \
    | psql -q -d "$BANCO" -v ON_ERROR_STOP=1 -f - >/dev/null 2>/tmp/montar_banco_erro.txt \
    || { echo "FALHOU em $f:"; cat /tmp/montar_banco_erro.txt; exit 1; }
done
echo "banco $BANCO montado (até v$ATE)"
