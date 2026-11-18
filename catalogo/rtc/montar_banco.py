#!/usr/bin/env python3
"""Monta o banco oficial da Calculadora de Tributos da Receita Federal.

Aplica os .sql do Flyway direto no SQLite, sem precisar de Java nem de Maven.

Uso:
    git clone --depth 1 https://github.com/ReceitaFederal/calculadora-rtc-regime-regular.git
    python3 catalogo/rtc/montar_banco.py calculadora-rtc-regime-regular/flyway/sql calculadora.db

ATENÇÃO: a pasta flyway/ com as tabelas NÃO está no repositório do Simples Nacional,
e sim no do regime regular — os dois usam o mesmo banco. O README da Receita manda
copiá-la do repositório errado (aponta para ele mesmo).

Ordem: criacao/beforeMigrate.sql, criacao/B*.sql, manutencao/V*.sql (ordem numérica),
criacao/afterMigrate.sql. Os scripts usam "PRAGMA defer_foreign_keys", que só vale
dentro de UMA transação: sem isso 7 migrações falham por chave estrangeira.

Depois de montar, gere o arquivo do sistema com catalogo/rtc/gerar_rtc.py.
"""
import os
import re
import sqlite3
import sys


def ordem(caminho):
    nome = os.path.basename(caminho)
    m = re.match(r"[BV](\d+)__", nome)
    return int(m.group(1)) if m else 0


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    base, saida = sys.argv[1], sys.argv[2]
    criacao = os.path.join(base, "criacao")
    manut = os.path.join(base, "manutencao")

    arquivos = []
    before = os.path.join(criacao, "beforeMigrate.sql")
    if os.path.exists(before):
        arquivos.append(before)
    arquivos += sorted(
        (os.path.join(criacao, f) for f in os.listdir(criacao) if re.match(r"B\d+__", f)),
        key=ordem,
    )
    arquivos += sorted(
        (os.path.join(manut, f) for f in os.listdir(manut) if re.match(r"V\d+__", f)),
        key=ordem,
    )
    after = os.path.join(criacao, "afterMigrate.sql")
    if os.path.exists(after):
        arquivos.append(after)

    if os.path.exists(saida):
        os.remove(saida)
    con = sqlite3.connect(saida)
    # sem controle automatico de transacao: os scripts da Receita usam
    # "PRAGMA defer_foreign_keys", que so vale dentro de uma transacao
    con.isolation_level = None
    con.execute("PRAGMA foreign_keys=ON")
    erros = 0
    for caminho in arquivos:
        with open(caminho, encoding="utf-8") as fh:
            sql = fh.read()
        # arquivo que adia a checagem de FK precisa rodar dentro de UMA transacao
        if "defer_foreign_keys" in sql.lower():
            sql = "BEGIN;\n" + sql + "\nCOMMIT;\n"
        try:
            con.executescript(sql)
            print(f"OK   {os.path.basename(caminho)}")
        except Exception as e:  # noqa: BLE001
            erros += 1
            print(f"ERRO {os.path.basename(caminho)}: {e}")

    tabelas = con.execute(
        "select name from sqlite_master where type='table' order by name"
    ).fetchall()
    quebras = con.execute("PRAGMA foreign_key_check").fetchall()
    print(f"\n{len(tabelas)} tabelas, {erros} arquivos com erro, "
          f"{len(quebras)} violacoes de chave estrangeira")
    con.close()
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
