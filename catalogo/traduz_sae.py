#!/usr/bin/env python3
"""Tradução das descrições genéricas de código de falha (texto SAE) para português de oficina.

POR QUE NÃO FRASE A FRASE: o texto da norma é montado. São poucas centenas de COMPONENTES
combinados com umas dezenas de MODOS de falha ("circuit high", "range/performance", "stuck on") e
com qualificadores (banco, sensor, cilindro, letra A/B). Traduzindo o componente à mão, uma vez, e
o modo por regra, a mesma tradução conferida serve para milhares de códigos — e fica igual em todos.

O QUE ESTE ARQUIVO GARANTE: se o componente não está em catalogo/falhas/componentes.tsv, a função
devolve None e o texto fica em INGLÊS, marcado. Nunca sai metade traduzido.

Formato da saída: "<Componente> <letra>: <modo> (banco N, sensor M)". Os dois-pontos evitam a
concordância de gênero ("sinal alto no circuito" serve para "o sensor" e para "a válvula").
"""
import os
import re

AQUI = os.path.dirname(os.path.abspath(__file__))

# Modos de falha, do mais comprido para o mais curto. O primeiro que casar no FIM da frase ganha.
MODOS = [
    ("control circuit range/performance", "circuito de comando fora da faixa ou com desempenho ruim"),
    ("control circuit performance", "circuito de comando com desempenho ruim"),
    ("control circuit high", "sinal alto no circuito de comando"),
    ("control circuit low", "sinal baixo no circuito de comando"),
    ("control circuit/open", "circuito de comando aberto"),
    ("control circuit /open", "circuito de comando aberto"),
    ("control circuit open", "circuito de comando aberto"),
    ("control circuit", "falha no circuito de comando"),
    ("control performance", "comando com desempenho ruim"),
    ("circuit intermittent/erratic", "circuito intermitente ou instável"),
    ("circuit range/performance", "circuito fora da faixa ou com desempenho ruim"),
    ("circuit high voltage", "tensão alta no circuito"),
    ("circuit low voltage", "tensão baixa no circuito"),
    ("circuit high input", "sinal alto no circuito"),
    ("circuit low input", "sinal baixo no circuito"),
    ("circuit no activity detected", "circuito sem atividade"),
    ("circuit slow response", "resposta lenta"),
    ("circuit intermittent", "circuito intermitente"),
    ("circuit malfunction", "defeito no circuito"),
    ("circuit performance", "circuito com desempenho ruim"),
    ("circuit high", "sinal alto no circuito"),
    ("circuit low", "sinal baixo no circuito"),
    ("circuit/open", "circuito aberto"),
    ("circuit /open", "circuito aberto"),
    ("circuit open", "circuito aberto"),
    ("circuit", "falha no circuito"),
    ("performance/stuck off", "desempenho ruim ou preso desligado"),
    ("performance/stuck disengaged", "desempenho ruim ou presa desacoplada"),
    ("performance or stuck off", "desempenho ruim ou preso desligado"),
    ("performance/too slow", "desempenho ruim (lento demais)"),
    ("performance/too low", "desempenho ruim (baixo demais)"),
    ("range/performance", "fora da faixa ou com desempenho ruim"),
    ("over temperature", "temperatura alta demais"),
    ("stuck engaged", "presa acoplada"),
    ("stuck open", "preso aberto"),
    ("stuck closed", "preso fechado"),
    ("stuck on", "preso ligado"),
    ("stuck off", "preso desligado"),
    ("too high", "alto demais"),
    ("too low", "baixo demais"),
    ("performance", "desempenho ruim"),
    ("malfunction", "defeito"),
    ("correlation", "os sinais não batem um com o outro"),
    ("intermittent", "intermitente"),
    ("high", "valor alto"),
    ("low", "valor baixo"),
]

_ASPAS = str.maketrans({"“": '"', "”": '"', "–": "-", "’": "'"})


def desmontar(chave):
    """Separa a frase (já em minúsculas e com números como {1}) em (componente, letras, modo, qualificadores)."""
    t = chave.translate(_ASPAS)
    quais = []
    m = re.search(r"\s*\(?bank (\{\d\})\)?(?: sensor (\{\d\}))?( or single sensor)?\)?\s*$", t)
    if not m:
        m = re.search(r"\s*\(?bank (\{\d\})\)?(?: sensor (\{\d\}))?( or single sensor)?", t)
    if m:
        q = "banco " + m.group(1) + (", sensor " + m.group(2) if m.group(2) else "") + (" ou sensor único" if m.group(3) else "")
        quais.append(q)
        t = (t[:m.start()] + " " + t[m.end():]).strip()
    m = re.search(r"\s*-\s*cylinder (\{\d\})\s*$", t)
    cil = None
    if m:
        cil = m.group(1); t = t[:m.start()]
    m = re.match(r"cylinder (\{\d\}) ", t)
    if m:
        cil = m.group(1); t = t[m.end():]
    if cil:
        quais.insert(0, "cilindro " + cil)
    modo = None
    for en, pt in MODOS:
        if t.endswith(" " + en):
            modo = pt; t = t[:-len(en) - 1]
            break
    letras = re.findall(r'"([a-z])"', t)
    t = re.sub(r'\s*"[a-z]"(\s*/\s*"[a-z]")*', "", t)
    t = re.sub(r"\s+", " ", t).strip(" -/")
    return t, [x.upper() for x in letras], modo, quais


def carregar_componentes():
    comp = {}
    arq = os.path.join(AQUI, "falhas", "componentes.tsv")
    if os.path.exists(arq):
        for linha in open(arq, encoding="utf-8"):
            linha = linha.rstrip("\n")
            if linha and not linha.startswith("#") and "\t" in linha:
                en, pt = linha.split("\t", 1)
                comp[en] = pt
    return comp


def traduzir(chave, comp):
    """Devolve a frase em português (com os mesmos {1}, {2}) ou None se o componente não é conhecido."""
    c, letras, modo, quais = desmontar(chave)
    if not c or c not in comp:
        return None
    pt = comp[c]
    if letras:
        pt += " " + "/".join(letras)
    if modo:
        pt += ": " + modo
    if quais:
        pt += " (" + ", ".join(quais) + ")"
    return pt
