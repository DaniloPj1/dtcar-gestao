#!/usr/bin/env bash
# Testa o supabase/v42.sql (entrada de NF da SEFAZ pelo conector) num Postgres local.
# Uso: PGHOST=/caminho/do/socket PGPORT=5432 PGUSER=postgres bash teste/teste_v42.sh
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# as funções de produção que o v42 usa: importar_nfe (v4) e lancar_contas (v5), copiadas dos arquivos
python3 - "$tmp/funcoes.sql" <<'PY'
import sys, re
out = []
for arq, nome in (("supabase/v4.sql", "importar_nfe"), ("supabase/v5.sql", "lancar_contas")):
    s = open(arq, encoding="utf-8").read()
    i = s.index("create or replace function public." + nome + "(")
    j = s.index("end $$;", i) + len("end $$;")
    out.append(s[i:j])
open(sys.argv[1], "w", encoding="utf-8").write("\n".join(out) + "\n")
PY
psql -q -c "drop database if exists dtcar_teste_v42" -c "create database dtcar_teste_v42"
psql -q -d dtcar_teste_v42 -v ON_ERROR_STOP=1 -f teste/v40_esquema.sql
psql -q -d dtcar_teste_v42 -v ON_ERROR_STOP=1 -f teste/v42_esquema.sql
psql -q -d dtcar_teste_v42 -v ON_ERROR_STOP=1 -f "$tmp/funcoes.sql"
for v in v40 v41 v42 v42; do psql -q -d dtcar_teste_v42 -v ON_ERROR_STOP=1 -f supabase/$v.sql; done   # v42 pode rodar 2 vezes
psql -q -d dtcar_teste_v42 -v ON_ERROR_STOP=1 -f teste/v42_cenarios.sql
