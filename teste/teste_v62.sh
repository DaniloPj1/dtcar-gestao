#!/usr/bin/env bash
# Testa o supabase/v62.sql (apagar falha no OBD, com registro) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v61 (teste/montar_banco.sh), roda o v62 duas vezes e os cenários (teste/v62_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v62.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v62 61 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v62 -v ON_ERROR_STOP=1 -f supabase/v62.sql
psql -q -d dtcar_teste_v62 -v ON_ERROR_STOP=1 -f supabase/v62.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v62 -v ON_ERROR_STOP=1 -f teste/v62_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v62 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v62 sem resultado"; exit 1; }
