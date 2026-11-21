#!/usr/bin/env python3
"""Monta os arquivos que o app carrega para explicar um código de falha (js/falhas/*.js).

Uso: python3 -I catalogo/gerar_falhasdados.py

Junta três acervos que já estão em catalogo/ e nenhuma tela usava:
  - catalogo/falhas/_extrato.json   1.519 códigos genéricos com CAUSAS (base da Honda, HDS);
  - catalogo/opentune/codigos.json  11.140 descrições genéricas (texto SAE), sem causa;
  - catalogo/falhas/montadora.json  31.267 códigos de 10 marcas, só descrição.
E a tradução conferida à mão em catalogo/falhas/pt.tsv (inglês normalizado <TAB> português).

REGRAS, as mesmas do documento aprovado (Etapa 1 e Etapa 2):
  - o que não tem tradução conferida sai em INGLÊS e marcado (p = 0). Nunca tradução automática;
  - cada verbete leva a ORIGEM, e a tela escreve de onde veio;
  - carregamento por pedaço: o app baixa só o arquivo do prefixo ou da marca que apareceu no carro.
"""
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAT = os.path.join(RAIZ, "catalogo")
SAIDA = os.path.join(RAIZ, "js", "falhas")

# Seções do texto da Honda que vão para a tela, com o nome curto usado no arquivo.
SECOES = [("procedimento", "viu"), ("condicao_teste", "teste"), ("luz", "luz"), ("ciclos", "ciclos"),
          ("quando_grava", "grava"), ("apagar", "apaga"), ("emergencia", "emergencia")]

LIXO_TITULO = re.compile(r"^(DTC HELP|[PUBC][0-9A-F]{4}\b)", re.I)


def chave(texto):
    """Normaliza o inglês para servir de chave da tradução: espaços, ponto final e NÚMEROS.

    Os números viram {1}, {2}… na ordem em que aparecem: "Cylinder 3 Injector" e "Cylinder 4
    Injector" são a mesma frase para traduzir, e a tradução devolve o número no lugar certo.
    Devolve (chave, [números])."""
    t = re.sub(r"\s+", " ", str(texto or "")).strip(" .")
    nums = []

    def troca(m):
        nums.append(m.group(0))
        return "{%d}" % len(nums)

    k = re.sub(r"(?<![A-Za-z{])\d+(?![A-Za-z}])", troca, t)
    return k.lower(), nums


def carregar_pt():
    pt = {}
    arq = os.path.join(CAT, "falhas", "pt.tsv")
    if os.path.exists(arq):
        for n, linha in enumerate(open(arq, encoding="utf-8"), 1):
            linha = linha.rstrip("\n")
            if not linha or linha.startswith("#"):
                continue
            if "\t" not in linha:
                sys.exit("pt.tsv linha %d sem TAB" % n)
            en, br = linha.split("\t", 1)
            pt[en] = br
    return pt


def traduz(texto, pt, faltam):
    """(texto para a tela, 1 se está em português conferido / 0 se ficou em inglês)."""
    limpo = re.sub(r"\s+", " ", str(texto or "")).strip()
    k, nums = chave(limpo)
    br = pt.get(k)
    if br is None:
        faltam[k] = faltam.get(k, 0) + 1
        return limpo, 0
    for i, n in enumerate(nums, 1):
        br = br.replace("{%d}" % i, n)
    return br, 1


def escreve(nome, dados, comentario):
    corpo = json.dumps(dados, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    with open(os.path.join(SAIDA, nome), "w", encoding="utf-8") as f:
        f.write("// GERADO por catalogo/gerar_falhasdados.py — não editar à mão. %s\n" % comentario)
        f.write("export default " + corpo + ";\n")
    return len(corpo)


SLUG = {"AlfaRomeo": "alfaromeo", "BMW": "bmw", "Chrysler": "chrysler", "Fiat": "fiat", "Ford": "ford",
        "GM": "gm", "Honda": "honda", "Mitsubishi": "mitsubishi", "Nissan": "nissan", "Volkswagen": "vw"}


def main():
    os.makedirs(SAIDA, exist_ok=True)
    pt = carregar_pt()
    faltam = {}
    extrato = json.load(open(os.path.join(CAT, "falhas", "_extrato.json"), encoding="utf-8"))
    sae = json.load(open(os.path.join(CAT, "opentune", "codigos.json"), encoding="utf-8"))
    marcas = json.load(open(os.path.join(CAT, "falhas", "montadora.json"), encoding="utf-8"))

    gen = {}
    for cod, desc in sae.items():
        d, p = traduz(desc, pt, faltam)
        gen[cod] = {"d": d, "p": p, "o": "s"}
    com_causa = 0
    for e in extrato:
        cod = e["codigo"]
        v = gen.get(cod)
        if v is None:
            # código que o texto SAE não tem: o título vem da Honda, se for título de verdade
            tit = e.get("titulo") or ""
            if LIXO_TITULO.match(tit):
                v = {"d": "", "p": 0, "o": "h"}
            else:
                d, p = traduz(tit, pt, faltam)
                v = {"d": d, "p": p, "o": "h"}
            gen[cod] = v
        causas = []
        for c in e.get("causas", []):
            t, p = traduz(c["t"], pt, faltam)
            causas.append([c.get("nivel", 0), t, p])
        if causas:
            v["c"] = causas
            com_causa += 1
        x = {}
        for origem, curto in SECOES:
            linhas = []
            for c in e.get(origem, []):
                t, p = traduz(c["t"], pt, faltam)
                linhas.append([t, p])
            if linhas:
                x[curto] = linhas
        if x:
            v["x"] = x

    grupos = {"p0": {}, "p2": {}, "outros": {}}
    for cod, v in gen.items():
        g = "p0" if cod.startswith("P0") else "p2" if cod.startswith("P2") else "outros"
        grupos[g][cod] = v
    total = 0
    for g, d in grupos.items():
        total += escreve("generico_%s.js" % g, d, "Códigos genéricos (%s): texto SAE e, onde existe, causas da base da Honda." % g.upper())

    resumo = {}
    for marca, tabela in marcas.items():
        saida = {}
        for cod, v in tabela.items():
            d, p = traduz(v["d"], pt, {})          # montadora: não entra na conta do que falta traduzir
            item = {"d": d, "p": p}
            if v.get("t") != "sae":
                item["t"] = v["t"]
            # VW: a designação do componente no diagrama elétrico (G61, N148) fica à parte, para conferir
            pecas = sorted(set(re.findall(r"-([A-Z]\d{1,3})\b", v["d"])))
            if pecas and marca == "Volkswagen":
                item["g"] = pecas
            saida[cod] = item
        total += escreve("marca_%s.js" % SLUG[marca], saida, "Códigos de montadora: %s. Só descrição, sem causa." % marca)
        resumo[SLUG[marca]] = len(saida)

    em_pt = sum(1 for v in gen.values() if v["p"])
    causas_tot = sum(len(v.get("c", [])) for v in gen.values())
    causas_pt = sum(1 for v in gen.values() for c in v.get("c", []) if c[2])
    indice = {"genericos": len(gen), "genericos_pt": em_pt, "com_causa": com_causa, "causas": causas_tot,
              "causas_pt": causas_pt, "marcas": resumo}
    escreve("indice.js", indice, "Quanto existe e quanto está traduzido.")
    json.dump(sorted(faltam.items(), key=lambda kv: -kv[1]), open(os.path.join(CAT, "falhas", "_faltam.json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(json.dumps(indice, ensure_ascii=False))
    print("bytes:", total, "| frases sem tradução:", len(faltam))


if __name__ == "__main__":
    main()
