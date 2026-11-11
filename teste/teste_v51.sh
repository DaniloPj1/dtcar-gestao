#!/usr/bin/env bash
# Testa o supabase/v51.sql (grupos de produtos) no banco INTEIRO da oficina num Postgres local:
# monta schema.sql + v3…v50 (teste/montar_banco.sh), roda o v51 duas vezes e os cenários (teste/v51_cenarios.sql).
# Uso: PGHOST=/caminho/do/socket PGUSER=postgres bash teste/teste_v51.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash teste/montar_banco.sh dtcar_teste_v51 50 >/dev/null 2>&1 || { echo "montar_banco falhou"; exit 1; }
psql -q -d dtcar_teste_v51 -v ON_ERROR_STOP=1 -f supabase/v51.sql >/dev/null 2>&1 || psql -q -d dtcar_teste_v51 -v ON_ERROR_STOP=1 -f supabase/v51.sql
psql -q -d dtcar_teste_v51 -v ON_ERROR_STOP=1 -f supabase/v51.sql >/dev/null 2>&1   # pode rodar 2 vezes
psql -q -d dtcar_teste_v51 -v ON_ERROR_STOP=1 -f teste/v51_cenarios.sql 2>&1 | grep -v NOTICE
# Regressão: os cenários da entrada de nota pelo conector (v42) continuam passando com a agente_entrada_nfe redefinida
# (banco inteiro até o v51; os mesmos ajustes de cenário do teste_v50.sh: login de administrador e vínculo de NF completo).
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
cat > "$TMP/admin.sql" <<'SQL'
insert into auth.users (id, email, raw_user_meta_data) values ('99999999-9999-9999-9999-999999999999', 'danilo@oficina.test', '{"nome": "Danilo"}') on conflict do nothing;
select null from set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
update public.perfis set papel = 'admin' where id = '99999999-9999-9999-9999-999999999999';
update public.config set dados = coalesce(dados, '{}') || '{"formasPagamento": ["PIX", "Dinheiro", "Cartão de débito", "Cartão de crédito", "Boleto"],
  "contasFinanceiras": [{"nome": "Sicredi", "saldo": 1000}, {"nome": "PicPay PJ", "saldo": 0}, {"nome": "Espécie", "saldo": 100}],
  "contaRecebimento": "Sicredi", "contaPagamento": "Sicredi"}' where id = 1;
SQL
python3 - "$TMP/v42.sql" <<'PY'
import sys
s = open("teste/v42_cenarios.sql").read()
a = "insert into public.nfe_os_vinculos (chave, nf_item, descricao_nf, qtd) select chave, 1, 'VELA BK CX4', 1 from public.nfe_recebidas;"
b = ("insert into public.ordens (id, numero, status, cliente, veiculo) values ('00000000-0000-0000-0000-00000000c0de', 4242, 'execucao', '{\"nome\": \"X\"}', '{\"placa\": \"AAA0A00\"}');\n"
     "  insert into public.os_itens (id, ordem_id, tipo, descricao, qtd, valor_unit) values ('00000000-0000-0000-0000-00000000c0df', '00000000-0000-0000-0000-00000000c0de', 'peca', 'Vela', 1, 50);\n"
     "  insert into public.nfe_os_vinculos (chave, nf_item, descricao_nf, qtd, ordem_id, item_id) select chave, 1, 'VELA BK CX4', 1, "
     "'00000000-0000-0000-0000-00000000c0de', '00000000-0000-0000-0000-00000000c0df' from public.nfe_recebidas;")
assert s.count(a) == 1, "v42_cenarios mudou: ajuste o teste_v51.sh"
open(sys.argv[1], "w").write(s.replace(a, b))
PY
bash teste/montar_banco.sh dtcar_teste_v51_r42 51 >/dev/null 2>&1 || { echo "montar_banco falhou (regressão v42)"; exit 1; }
(cat "$TMP/admin.sql"; echo "\\i $TMP/v42.sql") | psql -q -d dtcar_teste_v51_r42 -v ON_ERROR_STOP=1 -f - 2>&1 | grep -v NOTICE | grep -E "^OK|ERRO|FALHOU|ERROR" | sed "s/^/regressão v42 (com o v51): /"
