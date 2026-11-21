#!/usr/bin/env python3
"""Importa arquivos DBC (banco de sinais de barramento CAN) de um acervo de repositórios.

Uso: python3 catalogo/gerar_dbc.py <pasta com os repositórios clonados>

DBC é o formato padrão da indústria para descrever o que passa no barramento.
Cada mensagem tem um identificador e um tamanho; cada sinal dentro dela tem
posição do primeiro bit, comprimento, ordem dos bytes, sinal, fator, offset,
faixa mínima e máxima e unidade:

  BO_ 2364540158 EEC1: 8 Vector__XXX
   SG_ EngineSpeed : 24|16@1+ (0.125,0) [0|8031.875] "rpm" Vector__XXX

É diferente do que o nosso app faz hoje: o DBC descreve o que o carro TRANSMITE
sozinho no barramento, não o que ele responde quando perguntado. Para usar
precisa de interface CAN de verdade — o ELM327 é ruim em escuta passiva. Entra
como acervo para a etapa do cabo CAN, e porque a faixa e a unidade de cada sinal
ajudam a conferir as nossas contas.
"""
import json
import os
import re
import sys

MSG = re.compile(r"^BO_\s+(\d+)\s+([\w]+)\s*:\s*(\d+)\s+(\S+)")
SIG = re.compile(
    r"^\s*SG_\s+([\w]+)\s*(?:M|m\d+)?\s*:\s*"
    r"(\d+)\|(\d+)@([01])([+-])\s*"
    r"\(([-\d.eE+]+),([-\d.eE+]+)\)\s*"
    r"\[([-\d.eE+]*)\|([-\d.eE+]*)\]\s*"
    r'"([^"]*)"'
)


def ler_dbc(caminho):
    msgs = []
    atual = None
    with open(caminho, encoding="utf-8", errors="replace") as f:
        for linha in f:
            m = MSG.match(linha)
            if m:
                atual = {
                    "id": int(m.group(1)) & 0x1FFFFFFF,
                    "nome": m.group(2),
                    "bytes": int(m.group(3)),
                    "sinais": [],
                }
                msgs.append(atual)
                continue
            s = SIG.match(linha)
            if s and atual is not None:
                def num(x):
                    try:
                        return float(x)
                    except ValueError:
                        return None
                atual["sinais"].append({
                    "nome": s.group(1),
                    "bit": int(s.group(2)),
                    "bits": int(s.group(3)),
                    "ordem": "intel" if s.group(4) == "1" else "motorola",
                    "sinalizado": s.group(5) == "-",
                    "fator": num(s.group(6)),
                    "offset": num(s.group(7)),
                    "min": num(s.group(8)),
                    "max": num(s.group(9)),
                    "unidade": s.group(10),
                })
    return [m for m in msgs if m["sinais"]]


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: gerar_dbc.py <pasta com os repositórios clonados>")
    raiz = sys.argv[1]
    acervo = {}
    por_repo = {}
    vazios = []
    for atual, dirs, arquivos in os.walk(raiz):
        dirs[:] = [d for d in dirs if d != ".git"]
        for a in sorted(arquivos):
            if not a.lower().endswith(".dbc"):
                continue
            caminho = os.path.join(atual, a)
            rel = os.path.relpath(caminho, raiz)
            repo = rel.split(os.sep)[0]
            try:
                msgs = ler_dbc(caminho)
            except Exception as e:
                vazios.append((rel, str(e)[:40]))
                continue
            if not msgs:
                vazios.append((rel, "sem sinal reconhecido"))
                continue
            chave = rel[: -len(".dbc")]
            acervo[chave] = msgs
            n = sum(len(m["sinais"]) for m in msgs)
            por_repo[repo] = por_repo.get(repo, [0, 0])
            por_repo[repo][0] += len(msgs)
            por_repo[repo][1] += n

    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dbc")
    os.makedirs(destino, exist_ok=True)
    caminho = os.path.join(destino, "acervo.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(acervo, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    msgs_tot = sum(len(v) for v in acervo.values())
    sin_tot = sum(len(m["sinais"]) for v in acervo.values() for m in v)
    com_faixa = sum(1 for v in acervo.values() for m in v for s in m["sinais"]
                    if s["min"] is not None and s["max"] is not None and s["max"] != s["min"])
    com_unidade = sum(1 for v in acervo.values() for m in v for s in m["sinais"] if s["unidade"])
    print("ACERVO DE DBC")
    for r in sorted(por_repo, key=lambda x: -por_repo[x][1])[:16]:
        print("  %-42s %4d mensagens %6d sinais" % (r[:42], por_repo[r][0], por_repo[r][1]))
    print("  TOTAL %d arquivos, %d mensagens, %d sinais" % (len(acervo), msgs_tot, sin_tot))
    print("  com faixa min/max: %d (%.0f%%)   com unidade: %d (%.0f%%)"
          % (com_faixa, 100 * com_faixa / max(sin_tot, 1), com_unidade, 100 * com_unidade / max(sin_tot, 1)))
    print("  arquivo: %.1f MB" % (os.path.getsize(caminho) / 1048576))
    if vazios:
        print("  sem sinal reconhecido: %d arquivos" % len(vazios))


if __name__ == "__main__":
    main()
