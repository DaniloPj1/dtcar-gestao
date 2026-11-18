#!/usr/bin/env bash
# Testa o supabase/v61.sql (orçamento separado da O.S., etapa 4: ferramentas do conector) no banco INTEIRO da oficina
# num Postgres local: monta schema.sql + v3…v60 (teste/montar_banco.sh), roda o v61 duas vezes (precisa ser idempotente)
# e os cenários (teste/v61_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v61.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v61 60 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f teste/v61_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v61 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v61 sem resultado"; exit 1; }
