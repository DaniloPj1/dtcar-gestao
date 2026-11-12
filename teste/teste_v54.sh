#!/usr/bin/env bash
# Testa o supabase/v54.sql (agenda da oficina, etapa 1) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v53 (teste/montar_banco.sh), roda o v54 duas vezes e os cenários (teste/v54_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v54.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v54 53 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v54 -v ON_ERROR_STOP=1 -f supabase/v54.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v54 -v ON_ERROR_STOP=1 -f supabase/v54.sql
psql -q -d dtcar_teste_v54 -v ON_ERROR_STOP=1 -f supabase/v54.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v54 -v ON_ERROR_STOP=1 -f teste/v54_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v54 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v54 sem resultado"; exit 1; }
