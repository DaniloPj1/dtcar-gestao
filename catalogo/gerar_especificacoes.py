#!/usr/bin/env python3
"""Lê os arquivos de etiqueta do VCDS e extrai a FAIXA DE NORMALIDADE por motor.

Uso: python3 catalogo/gerar_especificacoes.py <pasta Labels>

Isto preenche o buraco que o projeto tinha desde o começo. Nenhuma base aberta de
código de falha, de PID ou de barramento traz faixa de normalidade — todas trazem
escala de mostrador, que é outra coisa. Os arquivos de etiqueta do VCDS trazem a
especificação de verdade, por número de peça do módulo:

  000,1,Coolant Temperature,Specification: 189...210 (85.0...100.0 °C)
  000,3,Engine Speed,Specification: 49...75 (690...750 RPM)
  000,10,Ignition Timing,Specification: 42...47 (3.8...10.4 °BDTC)
  001,4,Sensor,Voltage Supply,Specification: 10.0...14.5 V

Cada linha é: grupo de medição, campo dentro do grupo, nome (às vezes em duas
partes) e a especificação. O primeiro par de números é o valor CRU que o módulo
devolve; o que vem entre parênteses é o mesmo valor em unidade de engenharia. Os
dois são guardados: o cru serve para conferir leitura direta, o de engenharia é o
que o mecânico entende.

Os arquivos são do tempo do KWP, então valem para a era de bloco de medição. Vale
como modelo de FORMATO e como primeira carga real de faixa por motor.

Codificação: os arquivos são Latin-1 (o grau sai como byte 0xB0), não UTF-8.
"""
import json
import os
import re
import sys

# Cabeçalho: ; P/N: 06F-907-115-???  e  ; Component: Engine (#01) - AML/AMM
PN = re.compile(r"^\s*;\s*P/N:\s*(.+?)\s*$", re.I)
COMP = re.compile(r"^\s*;\s*Component:\s*(.+?)\s*$", re.I)

# Linha de dado: grupo,campo,nome[,nome2],Specification|Range: ...
LINHA = re.compile(r"^\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,(.*)$")
ESPEC = re.compile(r"\b(Specification|Range)\s*:\s*(.+)$", re.I)

# "189...210 (85.0...100.0 °C)" / "10.0...14.5 V" / "0 CF (± 6 CF)"
# O número NÃO pode terminar em ponto: com `[\d.]+` guloso, "0.0...100.0" fazia o
# primeiro grupo virar "0.0." (comendo um ponto do separador) e o valor saía vazio.
NUM = r"(-?\d+(?:\.\d+)?)"
FAIXA = re.compile(NUM + r"\s*\.{2,3}\s*" + NUM)
PARENTESES = re.compile(r"\(([^)]*)\)")
UNIDADE = re.compile(r"([A-Za-z°%µ/]+(?:\s*[A-Za-z°%µ/]+)?)\s*$")


def num(x):
    try:
        return float(x)
    except ValueError:
        return None


def ler_especificacao(texto):
    """O texto depois de 'Specification:' → faixa crua, faixa de engenharia, unidade."""
    fora = {"texto": texto.strip()}
    dentro = PARENTESES.search(texto)
    fora_par = PARENTESES.sub("", texto).strip()

    f1 = FAIXA.search(fora_par)
    if f1:
        fora["cru_de"], fora["cru_ate"] = num(f1.group(1)), num(f1.group(2))
        resto = fora_par[f1.end():].strip(" ,;")
        u = UNIDADE.search(resto)
        if u:
            fora["cru_unidade"] = u.group(1).strip()
    if dentro:
        d = dentro.group(1)
        f2 = FAIXA.search(d)
        if f2:
            fora["de"], fora["ate"] = num(f2.group(1)), num(f2.group(2))
            resto = d[f2.end():].strip(" ,;")
            u = UNIDADE.search(resto)
            if u:
                fora["unidade"] = u.group(1).strip()
        else:
            # "± 6 CF": tolerância em torno do valor cru.
            t = re.search(r"±\s*" + NUM + r"\s*(\S*)", d)
            if t:
                fora["tolerancia"] = num(t.group(1))
                if t.group(2):
                    fora["unidade"] = t.group(2)

    # Sem parênteses mas com unidade junto da faixa crua: a faixa JÁ é de engenharia.
    if "de" not in fora and "cru_de" in fora and fora.get("cru_unidade"):
        fora["de"], fora["ate"] = fora.pop("cru_de"), fora.pop("cru_ate")
        fora["unidade"] = fora.pop("cru_unidade")
    return fora


def ler_lbl(caminho):
    pn = comp = ""
    itens = []
    with open(caminho, encoding="latin-1", errors="replace") as f:
        for linha in f:
            linha = linha.rstrip("\n").rstrip("\r")
            m = PN.match(linha)
            if m and not pn:
                pn = m.group(1)
                continue
            m = COMP.match(linha)
            if m and not comp:
                comp = m.group(1)
                continue
            if linha.lstrip().startswith(";"):
                continue
            m = LINHA.match(linha)
            if not m:
                continue
            grupo, campo, resto = m.group(1), m.group(2), m.group(3)
            e = ESPEC.search(resto)
            if not e:
                continue
            nome = resto[: e.start()].strip().strip(",").strip()
            nome = re.sub(r"\s*,\s*", " — ", nome)
            if not nome:
                continue
            # A palavra usada decide o SENTIDO da faixa, e misturar as duas
            # destruiria a única coisa que esta fonte tem de especial:
            #   Specification: é o valor normal, na condição que a linha diz.
            #   Range:         é a escala do sinal — o mesmo que o nosso de/ate.
            reg = {
                "grupo": int(grupo),
                "campo": int(campo),
                "nome": nome,
                "tipo": "especificacao" if e.group(1).lower().startswith("spec") else "escala",
            }
            reg.update(ler_especificacao(e.group(2)))
            itens.append(reg)
    return pn, comp, itens


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: gerar_especificacoes.py <pasta Labels>")
    raiz = sys.argv[1]
    acervo = {}
    sem_faixa = 0
    for atual, _, arquivos in os.walk(raiz):
        for a in sorted(arquivos):
            if not a.lower().endswith((".lbl", ".xpl")):  # .xpl é o mesmo formato de texto
                continue
            caminho = os.path.join(atual, a)
            try:
                pn, comp, itens = ler_lbl(caminho)
            except Exception:
                continue
            if not itens:
                continue
            chave = a[: a.rfind(".")]
            acervo[chave] = {"peca": pn, "modulo": comp, "itens": itens}
            sem_faixa += sum(1 for i in itens if "de" not in i and "cru_de" not in i)

    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "especificacoes")
    os.makedirs(destino, exist_ok=True)
    caminho = os.path.join(destino, "vag.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(acervo, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    todos = [i for v in acervo.values() for i in v["itens"]]
    esp = [i for i in todos if i["tipo"] == "especificacao"]
    esc = [i for i in todos if i["tipo"] == "escala"]
    num_esp = [i for i in esp if "de" in i]
    print("ARQUIVOS DE ETIQUETA DO VCDS")
    print("  arquivos aproveitados : %d" % len(acervo))
    print("  itens no total        : %d" % len(todos))
    print()
    print("  ESPECIFICAÇÃO (valor normal — o que faltava no projeto)")
    print("    itens               : %d" % len(esp))
    print("    com faixa numérica  : %d" % len(num_esp))
    print("    com unidade         : %d" % sum(1 for i in num_esp if i.get("unidade")))
    print("    com valor cru junto : %d" % sum(1 for i in esp if "cru_de" in i))
    print()
    print("  ESCALA (faixa do sinal — o mesmo que o nosso de/ate)")
    print("    itens               : %d" % len(esc))
    print("    com faixa numérica  : %d" % sum(1 for i in esc if "de" in i))
    print()
    print("  sem faixa numérica    : %d (fica o texto, como está)" % sem_faixa)
    print("  arquivo: %.0f KB" % (os.path.getsize(caminho) / 1024))
    print()
    print("  amostra de ESPECIFICAÇÃO:")
    n = 0
    for k in sorted(acervo):
        for i in acervo[k]["itens"]:
            if i["tipo"] == "especificacao" and "de" in i and i.get("unidade") and n < 10:
                print("    %-20s g%03d.%-2d %-32s %s a %s %s"
                      % (k[:20], i["grupo"], i["campo"], i["nome"][:32], i["de"], i["ate"], i["unidade"]))
                n += 1


if __name__ == "__main__":
    main()
