#!/usr/bin/env bash
# Testa o supabase/v27.sql (itens que o Danilo manda acrescentar entram aprovados) num Postgres local.
# Usa o mesmo esquema e os cenários do v21 que não mudaram, e os cenários novos do v27.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v27.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v27" -c "create database dtcar_teste_v27"
psql -q -d dtcar_teste_v27 -v ON_ERROR_STOP=1 -f teste/v21_esquema.sql
psql -q -d dtcar_teste_v27 -v ON_ERROR_STOP=1 -f supabase/v21.sql
psql -q -d dtcar_teste_v27 -v ON_ERROR_STOP=1 -f supabase/v27.sql
psql -q -d dtcar_teste_v27 -v ON_ERROR_STOP=1 -f supabase/v27.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v27 -v ON_ERROR_STOP=1 -f teste/v27_cenarios.sql
