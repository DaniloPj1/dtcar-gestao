#!/usr/bin/env python3
"""Importa coleções de código de falha por marca e mapas de módulo da comunidade.

Uso: python3 catalogo/gerar_marcas.py <pasta com <Marca>.json> [<readme do vag-uds-ids>]

Duas coisas importam aqui:

1. **O formato do código muda por marca, e misturar seria inventar.** A VW não usa
   código SAE: usa o número de 5 dígitos que aparece no VCDS ("00000"). A BMW usa
   hexa de 4 ou 5 dígitos, que é a numeração dela. GM, Ford, Nissan e Fiat usam
   P/B/C/U. O importador classifica cada código e guarda o tipo junto, para a tela
   nunca procurar um número da VW como se fosse P-code.

2. **A fonte vem com sujeira.** Há chave com aspas sobrando ('"B1380'), espaço nas
   bordas e descrição duplicada. É limpo aqui, uma vez, e não na tela.
"""
import json
import os
import re
import sys

SAE = re.compile(r"^[PBCU][0-3][0-9A-F]{3}$")
VAG5 = re.compile(r"^\d{5}$")
HEXA = re.compile(r"^[0-9A-F]{4,5}$")


def tipo_do_codigo(c):
    if SAE.match(c):
        return "sae"
    if VAG5.match(c):
        return "vag5"      # número de 5 dígitos do VCDS
    if HEXA.match(c):
        return "hexa"      # numeração própria da marca (BMW)
    return "outro"


def _pares(dados):
    """A fonte vem como lista de pares OU como objeto. Aceita os dois."""
    if isinstance(dados, dict):
        return list(dados.items())
    fora = []
    for e in dados:
        if isinstance(e, (list, tuple)) and len(e) >= 2:
            fora.append((e[0], e[1]))
        elif isinstance(e, dict):
            k = e.get("code") or e.get("dtc") or e.get("id")
            v = e.get("description") or e.get("desc") or e.get("text")
            if k and v:
                fora.append((k, v))
    return fora


def limpar_codigo(c):
    c = str(c).strip().strip('"').strip("'").strip().upper()
    return re.sub(r"\s+", "", c)


def limpar_descricao(d):
    d = re.sub(r"\s+", " ", str(d)).strip().strip('"').strip()
    # Descrição que repete a si mesma ("X; X") aparece em algumas marcas.
    m = re.match(r"^(.{8,}?)[;,]\s*\1$", d, re.I)
    return m.group(1) if m else d


def importar_marcas(pasta):
    fora = {}
    relatorio = {}
    for a in sorted(os.listdir(pasta)):
        if not a.endswith(".json"):
            continue
        marca = a[: -len(".json")]
        with open(os.path.join(pasta, a), encoding="utf-8", errors="replace") as f:
            dados = json.load(f)
        por_codigo = {}
        tipos = {}
        descartados = 0
        for k, v in _pares(dados):
            c, d = limpar_codigo(k), limpar_descricao(v)
            if not c or not d:
                descartados += 1
                continue
            t = tipo_do_codigo(c)
            tipos[t] = tipos.get(t, 0) + 1
            # Código repetido: fica a descrição mais longa.
            if c not in por_codigo or len(d) > len(por_codigo[c]["d"]):
                por_codigo[c] = {"d": d, "t": t}
        if por_codigo:
            fora[marca] = por_codigo
            relatorio[marca] = {"codigos": len(por_codigo), "tipos": tipos, "descartados": descartados}
    return fora, relatorio


LINHA_VAG = re.compile(r"^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|")


def modulos_vag(caminho_readme):
    """A tabela do vag-uds-ids: componente, endereço de pedido, endereço de resposta."""
    fora = []
    with open(caminho_readme, encoding="utf-8", errors="replace") as f:
        for linha in f:
            m = LINHA_VAG.match(linha)
            if not m:
                continue
            nome, pede, resp = (x.strip() for x in m.groups())
            if nome.lower().startswith("component") or set(nome) <= set("-: "):
                continue
            def ends(s):
                return [e.upper().replace("0X", "") for e in re.findall(r"0x[0-9A-Fa-f]{3,8}", s)]
            p, r = ends(pede), ends(resp)
            if not p:
                continue
            fora.append({"nome": nome, "pede_em": p, "responde_em": r})
    return fora


def main():
    if len(sys.argv) < 2:
        sys.exit("uso: gerar_marcas.py <pasta com <Marca>.json> [<readme do vag-uds-ids>]")
    destino = os.path.join(os.path.dirname(os.path.abspath(__file__)), "falhas")
    os.makedirs(destino, exist_ok=True)

    marcas, rel = importar_marcas(sys.argv[1])
    caminho = os.path.join(destino, "montadora.json")
    with open(caminho, "w", encoding="utf-8") as f:
        json.dump(marcas, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)

    print("CÓDIGOS POR MARCA")
    tot = 0
    for m in sorted(rel, key=lambda x: -rel[x]["codigos"]):
        r = rel[m]
        tot += r["codigos"]
        tipos = ", ".join("%s %d" % (k, v) for k, v in sorted(r["tipos"].items(), key=lambda kv: -kv[1]))
        print("  %-12s %6d  (%s)%s" % (m, r["codigos"], tipos,
                                       "  descartados: %d" % r["descartados"] if r["descartados"] else ""))
    print("  TOTAL %d códigos em %d marcas, %.0f KB" % (tot, len(marcas), os.path.getsize(caminho) / 1024))

    if len(sys.argv) > 2 and os.path.exists(sys.argv[2]):
        mods = modulos_vag(sys.argv[2])
        cam2 = os.path.join(os.path.dirname(destino), "uds", "modulos_vag.json")
        os.makedirs(os.path.dirname(cam2), exist_ok=True)
        with open(cam2, "w", encoding="utf-8") as f:
            json.dump(mods, f, ensure_ascii=False, indent=1)
        print("\nMAPA DE MÓDULOS — VAG (do ODIS): %d módulos, %.0f KB"
              % (len(mods), os.path.getsize(cam2) / 1024))
        for x in mods[:6]:
            print("  %-34s pede %s  responde %s"
                  % (x["nome"][:34], "/".join(x["pede_em"]), "/".join(x["responde_em"])))


if __name__ == "__main__":
    main()
