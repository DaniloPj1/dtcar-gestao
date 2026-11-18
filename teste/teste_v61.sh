#!/usr/bin/env bash
# Testa o supabase/v61.sql (orçamento separado da O.S., etapa 4: ferramentas do conector) no banco INTEIRO da oficina
# num Postgres local: monta schema.sql + v3…v60 (teste/montar_banco.sh), roda o v61 duas vezes (precisa ser idempotente)
# e os cenários (teste/v61_cenarios.sql).
# Depois, a REGRESSÃO do conector: o v61 redefine o agente_fazer (entrada única de tudo o que o conector grava), então os
# cenários do v40, v41, v42 e v50 rodam de novo no banco inteiro com o v61 — como o teste_v50.sh faz desde o v50.
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v61.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v61 60 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f supabase/v61.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v61 -v ON_ERROR_STOP=1 -f teste/v61_cenarios.sql 2>&1 | grep -v NOTICE | grep -E "v61 OK|ERROR|FALHOU|ERRO" || { echo "cenários do v61 sem resultado"; exit 1; }

# ---------- regressão do conector com o agente_fazer do v61 ----------
# Ajustes só de cenário, os mesmos do teste_v50.sh: login de administrador, coluna "cep" que o banco inteiro já tem,
# vínculo de NF com O.S. completo e a mensagem do desconto em O.S. fechada (v50: pede para reabrir).
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/admin.sql" <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
update public.perfis set papel = 'admin' where id = '99999999-9999-9999-9999-999999999999';
update public.config set dados = coalesce(dados, '{}') || '{"formasPagamento": ["PIX", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Boleto"],
  "contasFinanceiras": [{"nome": "Sicredi", "saldo": 1000}, {"nome": "PicPay PJ", "saldo": 0}, {"nome": "Espécie", "saldo": 100}],
  "contaRecebimento": "Sicredi", "contaPagamento": "Sicredi"}' where id = 1;
SQL
sed "s/'{\"numero\": 1, \"dados\": {\"desconto\": 50}}', true)\$c\$, 'não mudam'/'{\"numero\": 1, \"dados\": {\"desconto\": 50}}', true)\$c\$, 'Reabra antes'/" teste/v40_cenarios.sql > "$TMP/v40.sql"
sed "s/^alter table public.clientes add column cep text/alter table public.clientes add column if not exists cep text/" teste/v41_cenarios.sql > "$TMP/v41.sql"
cp teste/v50_cenarios.sql "$TMP/v50.sql"
python3 - "$TMP/v42.sql" <<'PY'
import sys
s = open("teste/v42_cenarios.sql").read()
a = "insert into public.nfe_os_vinculos (chave, nf_item, descricao_nf, qtd) select chave, 1, 'VELA BK CX4', 1 from public.nfe_recebidas;"
b = ("insert into public.ordens (id, numero, status, cliente, veiculo) values ('00000000-0000-0000-0000-00000000c0de', 4242, 'execucao', '{\"nome\": \"X\"}', '{\"placa\": \"AAA0A00\"}');\n"
     "  insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit) values ('00000000-0000-0000-0000-00000000c0df', '00000000-0000-0000-0000-00000000c0de', 'peca', 'Vela', 1, 50);\n"
     "  insert into public.nfe_os_vinculos (chave, nf_item, descricao_nf, qtd, ordem_id, item_id) select chave, 1, 'VELA BK CX4', 1, "
     "'00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-00000000c0df' from public.nfe_recebidas;")
assert s.count(a) == 1, "v42_cenarios mudou: ajuste o teste_v61.sh"
open(sys.argv[1], "w").write(s.replace(a, b))
PY
grep -q "Reabra antes" "$TMP/v40.sql" || { echo "v40_cenarios mudou: ajuste o teste_v61.sh"; exit 1; }
for v in 40 41 42 50; do
  bash teste/montar_banco.sh dtcar_teste_v61_r$v 60 >/dev/null 2>&1 || { echo "montar_banco falhou (v$v)"; exit 1; }
  psql -q -d dtcar_teste_v61_r$v -v ON_ERROR_STOP=1 -f supabase/v61.sql >/dev/null 2>&1
  if [ "$v" = 50 ]; then
    psql -q -d dtcar_teste_v61_r$v -v ON_ERROR_STOP=1 -f "$TMP/v50.sql" 2>&1 | grep -v NOTICE | grep -E "passaram|ERRO|FALHOU|ERROR" | sed "s/^/regressão v50 (com o v61): /"
  else
    (cat "$TMP/admin.sql"; echo "\\i $TMP/v$v.sql") | psql -q -d dtcar_teste_v61_r$v -v ON_ERROR_STOP=1 -f - 2>&1 | grep -v NOTICE | grep -E "^OK|ERRO|FALHOU|ERROR" | sed "s/^/regressão v$v (com o v61): /"
  fi
done
