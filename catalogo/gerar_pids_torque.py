#!/usr/bin/env python3
"""Importa coleções de PID em formato Torque Pro (CSV de PID estendido).

Uso: python3 catalogo/gerar_pids_torque.py <pasta raiz> <nome da coleção>

O formato de cada linha é:
  nome completo, nome curto, PID (modo+identificador), fórmula, mínimo, máximo,
  unidade, cabeçalho (endereço do módulo)

A fórmula usa letras para os bytes da resposta (a, b, c…) e operadores do Torque
(`<` é deslocamento à esquerda), por exemplo `ad*0.1` ou `((f<8)+g)/100`.

ATENÇÃO ao que mínimo e máximo significam: no Torque eles são a **escala do
mostrador**, não faixa de normalidade. "11 a 14,6 V" numa bateria auxiliar por
acaso coincide com o razoável, mas "0 a 98 kW" é só o fim da escala. Guardamos
como escala, com esse nome, e não como especificação — é a mesma distinção que o
`de`/`ate` do nosso `js/obd.js` já faz.
"""
import csv
import json
import os
import re
import sys

COLUNAS = ("nome", "curto", "pid", "formula", "escala_de", "escala_ate", "unidade", "endereco")


def ler_pasta(raiz):
    fora = {}
    for atual, _, arquivos in os.walk(raiz):
        for a in sorted(arquivos):
            if not a.lower().endswith(".csv"):
                continue
            # A pasta imediatamente dentro da raiz nomeia o veículo.
            rel = os.path.relpath(atual, raiz)
            veiculo = rel.split(os.sep)[0] if rel != "." else "(raiz)"
            antigo = "no_longer_used" in atual or "no_longer_used" in a
            caminho = os.path.join(atual, a)
            linhas = []
            with open(caminho, encoding="utf-8", errors="replace") as f:
                for cols in csv.reader(f):
                    if len(cols) < 4 or not cols[0].strip() or cols[0].startswith("#"):
                        continue
                    reg = {}
                    for i, nome in enumerate(COLUNAS):
                        reg[nome] = cols[i].strip() if i < len(cols) else ""
                    if not reg["pid"]:
                        continue
                    # O nome vem prefixado com a ordem ("000_Airbag H/wire Duty").
                    reg["nome"] = re.sub(r"^\d{1,3}_", "", reg["nome"])
                    if antigo:
                        reg["antigo"] = True
                    linhas.append(reg)
            if linhas:
                fora.setdefault(veiculo, {})[a[:-4]] = linhas
    return fora


def main():
    if len(sys.argv) < 3:
        sys.exit("uso: gerar_pids_torque.py <pasta raiz> <nome da coleção>")
    raiz, nome = sys.argv[1], sys.argv[2]
    dados = ler_pasta(raiz)
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pids")
    os.makedirs(destino, exist_ok=True)
    caminho = os.path.join(destino, nome + ".json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    tot = sum(len(l) for v in dados.values() for l in v.values())
    antigos = sum(1 for v in dados.values() for l in v.values() for r in l if r.get("antigo"))
    com_escala = sum(1 for v in dados.values() for l in v.values() for r in l
                     if r.get("escala_de") and r.get("escala_ate"))
    enderecos = {r.get("endereco") for v in dados.values() for l in v.values() for r in l if r.get("endereco")}
    print("COLEÇÃO %s" % nome)
    for v in sorted(dados):
        n = sum(len(l) for l in dados[v].values())
        print("  %-34s %5d PIDs em %2d arquivos" % (v[:34], n, len(dados[v])))
    print("  TOTAL %d PIDs, %d com escala, %d marcados antigos" % (tot, com_escala, antigos))
    print("  módulos (cabeçalho): %s" % ", ".join(sorted(e for e in enderecos if e)[:14]))
    print("  arquivo: %.0f KB" % (os.path.getsize(caminho) / 1024))


if __name__ == "__main__":
    main()
