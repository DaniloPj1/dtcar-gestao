#!/usr/bin/env bash
# Testa o supabase/v35.sql (backup de leitura: histórico, pasta, configuração, aviso das 18h40 e agendamentos) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v35.sh
set -euo pipefail
cd "$(dirname "$0")/.."
B=dtcar_teste_v35
psql -q -c "drop database if exists $B" -c "create database $B"
psql -q -d $B -v ON_ERROR_STOP=1 -f teste/v35_esquema.sql
sed -E 's/create extension if not exists pg_(net|cron);//' supabase/v35.sql > /tmp/v35_teste.sql
psql -q -d $B -v ON_ERROR_STOP=1 -f /tmp/v35_teste.sql
psql -q -d $B -v ON_ERROR_STOP=1 -f /tmp/v35_teste.sql   # pode rodar 2 vezes
psql -q -d $B -v ON_ERROR_STOP=1 -f teste/v35_cenarios.sql
psql -q -c "drop database if exists $B"
echo "v35: todos os cenários passaram"
