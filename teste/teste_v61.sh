#!/usr/bin/env bash
# Testa o supabase/v61.sql (comissão por quinzena) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v60 (teste/montar_banco.sh), roda o v61 duas vezes e os cenários (teste/v61_cenarios.sql),
# que também rodam duas vezes (nada pode sobrar sujo entre uma rodada e outra).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v61.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v61 60 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f teste/v61_cenarios.sql >/dev/null 2>&1 || { echo "1a rodada dos cenários falhou"; psql -q -d dtcar_teste_v61 -f teste/v61_cenarios.sql; exit 1; }
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f teste/v61_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v61: todos os cenários passaram|ERROR|FALHOU|ERRO" || { echo "cenários do v61 sem resultado"; exit 1; }
