#!/usr/bin/env python3
"""Extrai o catálogo de códigos de falha genéricos da base decodificada do HDS.

Uso: python3 catalogo/gerar_falhas.py <caminho do hondascan.db>

Escreve catalogo/falhas/_extrato.json: um registro por código SAE genérico, em
inglês, com as seções separadas, pronto para tradução.

Por que juntar em vez de escolher um texto: um mesmo código tem vários textos na
base, de sistemas diferentes, e eles não são iguais em conteúdo. O P0301 tem dez.
O do sistema de injeção antigo (TCPF_*) traz a árvore de causas completa, separada
por "um cilindro" e "vários cilindros", e dentro de cada uma por combustível/mecânica
e elétrica — mas não traz procedimento nem condição de teste. O do sistema novo
(4R_*) traz procedimento, condição de teste, estado da luz, ciclos de verificação e
quando o código é gravado — mas a lista de causas é curta.

Então cada seção é pescada do texto que a tem mais completa, e o resultado é melhor
que qualquer um dos dois originais.
"""
import json
import os
import re
import sqlite3
import sys

# Famílias SAE: valem em qualquer carro, não só Honda.
FAMILIAS = ("P0", "P2", "P3", "U0", "U3", "B0", "C0")

# Sistemas de injeção, preferidos quando há empate de tamanho.
INJECAO = ("CANFI", "FI_", "PFI", "CANDIE", "CANFI2")

# Cabeçalhos de seção no texto do HDS, na ordem em que aparecem.
SECOES = [
    ("causas", ("POSSIBLE FAILURES", "POSSIBLE FAILURE")),
    ("procedimento", ("DIAGNOSTIC PROCEDURE",)),
    ("condicao_teste", ("TEST CONDITIONS",)),
    ("emergencia", ("FAIL SAFE ACTION",)),
    ("apagar", ("CONDITIONS FOR CANCELING DTCs", "CONDITIONS FOR CANCELING DTC")),
    ("luz", ("MIL/WARNING/INDICATOR STATUS",)),
    ("ciclos", ("SYSTEM CHECK CYCLES",)),
    ("quando_grava", ("DTC STORAGE TIMING",)),
]

# Linhas que não são conteúdo.
RUIDO = re.compile(
    r"^(DTC HELP|PENDING \(TEMPORARY\) DTC HELP|GLOSSARY|Detailed description:)\s*$",
    re.I,
)

# Texto que existe só para dizer que não serve.
INUTIL = re.compile(r"do not diagnose, proceed to troubleshoot", re.I)

TODOS_CABECALHOS = [c for _, cs in SECOES for c in cs] + ["GLOSSARY"]


def e_cabecalho(linha):
    return linha.strip().upper() in (c.upper() for c in TODOS_CABECALHOS)


# Linha que é só a numeração da falha no jeito da Honda, com ou sem o código SAE
# entre parênteses: "71-1(P0301)", "71-01 (P0301)", "B0001-2B", "T45-9", "B0001-11".
# Sem reconhecer todas essas formas, a numeração virava o título da ficha.
NUMERACAO = re.compile(
    r"^[A-Za-z]{0,2}[0-9A-Fa-f]{1,5}-[0-9A-Za-z]{1,4}\s*(\(\s*[\w.]+\s*\))?$"
)


def partir(texto, chave, codigo):
    """Texto bruto do HDS → {titulo, secoes: {nome: [linhas]}}."""
    linhas = [l.rstrip() for l in texto.splitlines()]
    # O começo do texto traz a chave (às vezes REPETIDA na linha seguinte), às
    # vezes "DTC HELP", a numeração da falha no jeito da Honda e só então o
    # título. Pular só a primeira linha deixava a chave repetida virar título.
    titulo = ""
    secoes = {}
    atual = None
    for l in linhas:
        bruta, limpa = l, l.strip()
        if not limpa:
            continue
        if limpa == chave:
            continue
        if RUIDO.match(limpa):
            atual = None if limpa.upper() == "GLOSSARY" else atual
            continue
        # Numeração da falha, antes de qualquer seção: não é título nem conteúdo.
        if atual is None and (NUMERACAO.match(limpa) or limpa.upper() == codigo.upper()):
            continue
        achou = None
        for nome, cabecalhos in SECOES:
            if limpa.upper() in (c.upper() for c in cabecalhos):
                achou = nome
                break
        if achou:
            atual = achou
            secoes.setdefault(atual, [])
            continue
        if e_cabecalho(limpa):
            atual = None
            continue
        if atual is None:
            if not titulo:
                titulo = limpa
            continue
        # Mantém o recuo: no HDS ele separa categoria de item.
        secoes[atual].append({"t": limpa, "nivel": 0 if bruta[:1] not in (" ", "\t") else 1})
    return {"titulo": titulo, "secoes": secoes}


def melhor(valores):
    """De várias listas candidatas para a mesma seção, a mais completa."""
    melhores = []
    for v in valores:
        if not v:
            continue
        if len(v) > len(melhores):
            melhores = v
    return melhores


def extrair(caminho_db):
    con = sqlite3.connect("file:%s?mode=ro" % caminho_db, uri=True)
    where = " or ".join("d.sae like '%s%%'" % f for f in FAMILIAS)
    linhas = con.execute(
        """select d.sae, d.system, h.key, h.text
             from dtc d join help h on h.key = d.help_key
            where (%s) and h.text is not null and length(h.text) > 40
            order by d.sae"""
        % where
    ).fetchall()

    por_codigo = {}
    for sae, sistema, chave, texto in linhas:
        if INUTIL.search(texto):
            continue
        por_codigo.setdefault(sae, []).append((sistema, chave, texto))

    saida = []
    for sae in sorted(por_codigo):
        partes = []
        for sistema, chave, texto in por_codigo[sae]:
            p = partir(texto, chave, sae)
            p["sistema"] = sistema
            p["chave"] = chave
            p["injecao"] = sistema in INJECAO
            partes.append(p)

        # Título: o do sistema de injeção quando houver, senão o primeiro não vazio.
        titulos = [p["titulo"] for p in partes if p["injecao"] and p["titulo"]]
        titulos += [p["titulo"] for p in partes if p["titulo"]]
        reg = {"codigo": sae, "titulo": titulos[0] if titulos else "", "fonte": "hds"}

        # Cada seção vem do texto que a tem mais completa.
        for nome, _ in SECOES:
            v = melhor([p["secoes"].get(nome, []) for p in partes])
            if v:
                reg[nome] = v

        reg["sistemas"] = sorted({p["sistema"] for p in partes})
        saida.append(reg)

    return saida


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: gerar_falhas.py <hondascan.db>")
    registros = extrair(sys.argv[1])
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "falhas")
    os.makedirs(destino, exist_ok=True)
    arquivo = os.path.join(destino, "_extrato.json")
    with open(arquivo, "w", encoding="utf-8") as f:
        json.dump(registros, f, ensure_ascii=False, indent=1, sort_keys=True)

    com = lambda s: sum(1 for r in registros if r.get(s))
    print("códigos extraídos      : %d" % len(registros))
    print("  com causas           : %d" % com("causas"))
    print("  com procedimento     : %d" % com("procedimento"))
    print("  com condição de teste: %d" % com("condicao_teste"))
    print("  com estado da luz    : %d" % com("luz"))
    print("  com ciclos           : %d" % com("ciclos"))
    print("  com quando grava     : %d" % com("quando_grava"))
    print("  com como apagar      : %d" % com("apagar"))
    print("tamanho                : %.2f MB" % (os.path.getsize(arquivo) / 1048576))
    print(arquivo)


if __name__ == "__main__":
    main()
