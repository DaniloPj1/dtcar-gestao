#!/usr/bin/env bash
# Testa o supabase/v52.sql (orçamento separado da O.S., etapa 1) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v51 (teste/montar_banco.sh), roda o v52 duas vezes e os cenários (teste/v52_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v52.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v52 51 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v52 -v ON_ERROR_STOP=1 -f supabase/v52.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v52 -v ON_ERROR_STOP=1 -f supabase/v52.sql
psql -q -d dtcar_teste_v52 -v ON_ERROR_STOP=1 -f supabase/v52.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v52 -v ON_ERROR_STOP=1 -f teste/v52_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v52 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v52 sem resultado"; exit 1; }
