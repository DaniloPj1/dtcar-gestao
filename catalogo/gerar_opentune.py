#!/usr/bin/env python3
"""Importa os dados do OpenTune: códigos, definições de módulo e pacotes.

Uso: python3 catalogo/gerar_opentune.py <pasta do opentune>

O OpenTune é o projeto aberto mais avançado que apareceu: tem canais de
adaptação, teste de atuador por 0x2F e rotina por 0x31, com funções de serviço
declaradas em dado em vez de código. O que importa aqui é dado em texto simples:

- `crates/opentune-dtc/data/dtc.tsv` — códigos genéricos, um por linha.
- `database/units/*.json` — definições de módulo: processador, tamanho da
  memória, memória de dados, barramentos, protocolos, como se lê, soma de
  verificação e a lista de veículos. Inclui os Bosch EDC15, EDC16 e EDC17, que
  são os módulos de diesel.
- `ctrldefs/*.json` — definições de controlador de câmbio e tração (DQ250,
  DQ381, Haldex Gen4 e Gen5, ZF 8HP, Mercedes 722.6).
- `packs/*/services/*.json` — o FORMATO de função de serviço: um roteiro
  declarativo de passos (abrir sessão, rodar rotina, conferir resposta, ler
  identificador) em vez de código por função. É o formato que a nossa Etapa 4
  vai adotar.

Os roteiros do pacote `vcar-demo` dizem na própria descrição que são endereços e
dados FICTÍCIOS, de carro nenhum: entram como exemplo de formato e ficam
marcados, nunca como dado de veículo.
"""
import json
import os
import sys


def ler_tsv(caminho):
    fora = {}
    with open(caminho, encoding="utf-8", errors="replace") as f:
        for linha in f:
            partes = linha.rstrip("\n").split("\t")
            if len(partes) >= 2 and partes[0].strip():
                fora[partes[0].strip()] = partes[1].strip()
    return fora


def ler_json_da_pasta(pasta):
    fora = {}
    if not os.path.isdir(pasta):
        return fora
    for a in sorted(os.listdir(pasta)):
        if not a.endswith(".json"):
            continue
        try:
            with open(os.path.join(pasta, a), encoding="utf-8") as f:
                fora[a[: -len(".json")]] = json.load(f)
        except Exception:
            continue
    return fora


def ler_pacotes(raiz):
    fora = {}
    base = os.path.join(raiz, "packs")
    if not os.path.isdir(base):
        return fora
    for pacote in sorted(os.listdir(base)):
        p = os.path.join(base, pacote)
        if not os.path.isdir(p):
            continue
        conteudo = {}
        for tipo in ("services", "adaptation", "modules", "loggers", "coding", "controllers", "triggers"):
            d = ler_json_da_pasta(os.path.join(p, tipo))
            if d:
                conteudo[tipo] = d
        if conteudo:
            # Marca o que o próprio projeto declara como fictício.
            ficticio = any(
                "fictional" in json.dumps(v, ensure_ascii=False).lower()
                for t in conteudo.values() for v in t.values()
            )
            conteudo["_ficticio"] = ficticio
            fora[pacote] = conteudo
    return fora


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: gerar_opentune.py <pasta do opentune>")
    raiz = sys.argv[1]
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "opentune")
    os.makedirs(destino, exist_ok=True)

    def grava(nome, dados, legivel=True):
        caminho = os.path.join(destino, nome + ".json")
        with open(caminho, "w", encoding="utf-8") as f:
            if legivel:
                json.dump(dados, f, ensure_ascii=False, indent=1, sort_keys=True)
            else:
                json.dump(dados, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        return os.path.getsize(caminho)

    dtc = ler_tsv(os.path.join(raiz, "crates", "opentune-dtc", "data", "dtc.tsv"))
    n1 = grava("codigos", dtc, legivel=False)
    print("CÓDIGOS: %d entradas, %.0f KB" % (len(dtc), n1 / 1024))

    unidades = ler_json_da_pasta(os.path.join(raiz, "database", "units"))
    n2 = grava("modulos", unidades)
    print("\nDEFINIÇÕES DE MÓDULO: %d, %.0f KB" % (len(unidades), n2 / 1024))
    for k, v in sorted(unidades.items()):
        veic = v.get("vehicles") or []
        print("  %-28s %-34s %d veículos, %s"
              % (k[:28], (v.get("name") or "")[:34], len(veic),
                 "/".join(v.get("protocols") or []) or "?"))

    ctrl = ler_json_da_pasta(os.path.join(raiz, "ctrldefs"))
    n3 = grava("controladores", ctrl)
    print("\nCONTROLADORES: %d, %.0f KB" % (len(ctrl), n3 / 1024))
    for k, v in sorted(ctrl.items()):
        print("  %-28s %s" % (k[:28], (v.get("name") or v.get("id") or "")[:46]))

    packs = ler_pacotes(raiz)
    n4 = grava("pacotes", packs)
    print("\nPACOTES: %d, %.0f KB" % (len(packs), n4 / 1024))
    for k, v in sorted(packs.items()):
        partes = ", ".join("%s %d" % (t, len(d)) for t, d in v.items() if t != "_ficticio")
        print("  %-26s %s%s" % (k[:26], partes, "   [FICTÍCIO: só formato]" if v.get("_ficticio") else ""))


if __name__ == "__main__":
    main()
