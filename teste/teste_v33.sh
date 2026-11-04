#!/usr/bin/env bash
# Testa o supabase/v33.sql (Notas fiscais da O.S.) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v33.sh
set -euo pipefail
cd "$(dirname "$0")/.."
psql -q -c "drop database if exists dtcar_teste_v33" -c "create database dtcar_teste_v33"
psql -q -d dtcar_teste_v33 -v ON_ERROR_STOP=1 -f teste/v30_esquema.sql
psql -q -d dtcar_teste_v33 -v ON_ERROR_STOP=1 -f supabase/v33.sql
psql -q -d dtcar_teste_v33 -v ON_ERROR_STOP=1 -f supabase/v33.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v33 -v ON_ERROR_STOP=1 -o /dev/null -f teste/v33_cenarios.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
# parte do e-mail: em cima do v29 (histórico guarda o nome dos anexos)
psql -q -c "drop database if exists dtcar_teste_v33e" -c "create database dtcar_teste_v33e"
psql -q -d dtcar_teste_v33e -v ON_ERROR_STOP=1 -f teste/v29_esquema.sql
psql -q -d dtcar_teste_v33e -v ON_ERROR_STOP=1 -f supabase/v29.sql
psql -q -d dtcar_teste_v33e -v ON_ERROR_STOP=1 -c "create schema if not exists storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text); alter table storage.objects enable row level security;"
psql -q -d dtcar_teste_v33e -v ON_ERROR_STOP=1 -f supabase/v33.sql
psql -q -d dtcar_teste_v33e -v ON_ERROR_STOP=1 -f supabase/v33.sql
psql -q -d dtcar_teste_v33e -v ON_ERROR_STOP=1 -o /dev/null -f teste/v33_email.sql 2>&1 | sed 's/^psql:[^ ]* NOTICE:  /  /'
echo "teste_v33: tudo certo"
