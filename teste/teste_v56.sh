#!/usr/bin/env bash
# Testa o supabase/v56.sql (consulta completa pela placa só do administrador + acerto do valor da completa) no banco INTEIRO
# da oficina num Postgres local: monta schema.sql + v3…v55 (teste/montar_banco.sh), roda o v56 e os cenários
# (teste/v56_cenarios.sql, que gravam as consultas como ficaram em 14/11/2026 e rodam o v56 mais duas vezes).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v56.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v56 55 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v56 -v ON_ERROR_STOP=1 -f supabase/v56.sql
psql -q -d dtcar_teste_v56 -v ON_ERROR_STOP=1 -f teste/v56_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v56 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v56 sem resultado"; exit 1; }
