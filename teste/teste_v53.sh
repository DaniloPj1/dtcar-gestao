#!/usr/bin/env bash
# Testa o supabase/v53.sql (orçamento separado da O.S., etapa 2: aprovar e virar O.S.) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v52 (teste/montar_banco.sh), roda o v53 duas vezes e os cenários (teste/v53_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v53.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v53 52 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v53 -v ON_ERROR_STOP=1 -f supabase/v53.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v53 -v ON_ERROR_STOP=1 -f supabase/v53.sql
psql -q -d dtcar_teste_v53 -v ON_ERROR_STOP=1 -f supabase/v53.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v53 -v ON_ERROR_STOP=1 -f teste/v53_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v53 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v53 sem resultado"; exit 1; }
