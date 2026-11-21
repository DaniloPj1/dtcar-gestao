#!/usr/bin/env bash
# Testa o supabase/v63.sql (registro do OBD aceita atuador, aprendizado, bico, sessão, laudo e mapa) no banco INTEIRO num
# Postgres local: monta schema.sql + v3…v62 (teste/montar_banco.sh), roda o v63 duas vezes e os cenários (teste/v63_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v63.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v63 62 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v63 -v ON_ERROR_STOP=1 -f supabase/v63.sql
psql -q -d dtcar_teste_v63 -v ON_ERROR_STOP=1 -f supabase/v63.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v63 -v ON_ERROR_STOP=1 -f teste/v63_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v63 OK|ERROR|FALHOU|ERRO" || { echo "cenário não terminou"; exit 1; }
