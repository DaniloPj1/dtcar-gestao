#!/usr/bin/env bash
# Testa o supabase/v65.sql (mensagem interna para grupo do WhatsApp) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v63 (teste/montar_banco.sh), roda o v65 duas vezes e os cenários (teste/v65_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v65.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v65 64 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v65 -v ON_ERROR_STOP=1 -f supabase/v65.sql
psql -q -d dtcar_teste_v65 -v ON_ERROR_STOP=1 -f supabase/v65.sql   # pode rodar 2 vezes
psql -q -d dtcar_teste_v65 -v ON_ERROR_STOP=1 -f teste/v65_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v65 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v65 sem resultado"; exit 1; }
