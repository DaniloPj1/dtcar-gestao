#!/usr/bin/env bash
# Testa o supabase/v50.sql (conector com acesso a tudo, desconto e técnico) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v49 (teste/montar_banco.sh), roda o v50 duas vezes e os cenários (teste/v50_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v50.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v50 49 >/dev/null
psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f supabase/v50.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f supabase/v50.sql
psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f supabase/v50.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f teste/v50_cenarios.sql 2>&1 | grep -v NOTICE
