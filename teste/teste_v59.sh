#!/usr/bin/env bash
# Testa o supabase/v59.sql (Compras, etapa 1) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v58 (teste/montar_banco.sh), roda o v59 duas vezes e os cenários (teste/v59_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v59.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v59 58 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v59 -v ON_ERROR_STOP=1 -f supabase/v59.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v59 -v ON_ERROR_STOP=1 -f supabase/v59.sql
psql -q -d dtcar_teste_v59 -v ON_ERROR_STOP=1 -f supabase/v59.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v59 -v ON_ERROR_STOP=1 -f teste/v59_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v59 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v59 sem resultado"; exit 1; }
