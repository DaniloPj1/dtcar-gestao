#!/usr/bin/env bash
# Testa o supabase/v66.sql (serviço iniciado pela placa, sem O.S.) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v65 (teste/montar_banco.sh), roda o v66 duas vezes e os cenários (teste/v66_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v66.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v66 65 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v66 -v ON_ERROR_STOP=1 -f supabase/v66.sql
psql -q -d dtcar_teste_v66 -v ON_ERROR_STOP=1 -f supabase/v66.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v66 -v ON_ERROR_STOP=1 -f teste/v66_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v66 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v66 sem resultado"; exit 1; }
