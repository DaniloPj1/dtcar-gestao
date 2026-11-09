#!/usr/bin/env bash
# Testa o supabase/v50.sql (conector com acesso a tudo, desconto e técnico) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v49 (teste/montar_banco.sh), roda o v50 duas vezes e os cenários (teste/v50_cenarios.sql);
# depois, a regressão dos cenários do conector (v40, v41, v42) no banco inteiro com o v50.
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v50.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v50 49 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f supabase/v50.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f supabase/v50.sql
psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f supabase/v50.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v50 -v ON_ERROR_STOP=1 -f teste/v50_cenarios.sql 2>&1 | grep -v NOTICE

# Regressão: os cenários do v40, v41 e v42 (conector) continuam passando no banco inteiro com o v50 (agente_fazer redefinido).
# Ajustes só de cenário: login de administrador (o esquema resumido não tem login), coluna "cep" que o banco inteiro já tem,
# vínculo de NF com O.S. completo (o banco inteiro exige ordem_id/item_id) e, de propósito, a mensagem nova do desconto em O.S.
# fechada (v50: o desconto passa pelo os_aplicar_desconto, que pede para reabrir).
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
python3 - "$TMP/v42.sql" <<'PY'
import sys
s = open("teste/v42_cenarios.sql").read()
a = "insert into public.nfe_os_vinculos (chave, nf_item, descricao_nf, qtd) select chave, 1, 'VELA BK CX4', 1 from public.nfe_recebidas;"
b = ("insert into public.ordens (id, numero, status, cliente, veiculo) values ('00000000-0000-0000-0000-00000000c0de', 4242, 'execucao', '{\"nome\": \"X\"}', '{\"placa\": \"AAA0A00\"}');\n"
     "  insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit) values ('00000000-0000-0000-0000-00000000c0df', '00000000-0000-0000-0000-00000000c0de', 'peca', 'Vela', 1, 50);\n"
     "  insert into public.nfe_os_vinculos (chave, nf_item, descricao_nf, qtd, ordem_id, item_id) select chave, 1, 'VELA BK CX4', 1, "
     "'00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-00000000c0df' from public.nfe_recebidas;")
assert s.count(a) == 1, "v42_cenarios mudou: ajuste o teste_v50.sh"
open(sys.argv[1], "w").write(s.replace(a, b))
PY
grep -q "Reabra antes" "$TMP/v40.sql" || { echo "v40_cenarios mudou: ajuste o teste_v50.sh"; exit 1; }
for v in 40 41 42; do
  bash teste/montar_banco.sh dtcar_teste_v50_r$v 49 >/dev/null 2>&1 || { echo "montar_banco falhou (v$v)"; exit 1; }
  psql -q -d dtcar_teste_v50_r$v -v ON_ERROR_STOP=1 -f supabase/v50.sql >/dev/null 2>&1
  (cat "$TMP/admin.sql"; echo "\\i $TMP/v$v.sql") | psql -q -d dtcar_teste_v50_r$v -v ON_ERROR_STOP=1 -f - 2>&1 | grep -v NOTICE | grep -E "^OK|ERRO|FALHOU|ERROR" | sed "s/^/regressão v$v (com o v50): /"
done
