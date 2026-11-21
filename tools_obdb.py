#!/usr/bin/env python3
"""Importa os mapas de módulo e de sinal por modelo do OBDb (github.com/OBDb) para o nosso catálogo.

Uso: python3 -I tools_obdb.py <pasta com os signalsets baixados>
     (cada arquivo é o signalsets/v3/default.json de um repositório, salvo como <Marca-Modelo>.json)

O OBDb entrega, por modelo, duas coisas que nenhuma outra base aberta tem: EM QUAL ENDEREÇO cada
módulo responde e QUAIS identificadores de montadora (serviço 22 e 21) cada um expõe, com bit,
escala e unidade. É pergunta e resposta, então funciona no ELM327.

Licença do OBDb: CC BY-SA 4.0. Cada arquivo gerado leva o nome do repositório de origem.

O QUE FICA DE FORA, e por quê (nada aqui é adivinhado):
  - comando com `din`, `dout`, `pri`, `eax` ou `proto`: pedem byte extra, prioridade ou endereçamento
    que o nosso portão do Android não manda. São contados e descartados;
  - sinal com mais de 32 bits (texto, número de série): a tela de dado ao vivo não mostra;
  - comando do serviço 01: já lemos pelo OBD-II genérico.
Acrescentar um modelo é baixar o arquivo dele e rodar este comando de novo.
"""
import glob
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.abspath(__file__))
SAIDA = os.path.join(RAIZ, "js", "modelos")


def slug(nome):
    return re.sub(r"[^a-z0-9]+", "_", nome.lower()).strip("_")


def endereco(hdr, rax, tst):
    """(pedido, resposta) do jeito que o adaptador recebe, ou None se o formato não é conhecido."""
    hdr = (hdr or "").upper()
    rax = (rax or "").upper()
    tst = (tst or "F1").upper()
    if re.fullmatch(r"[0-9A-F]{3}", hdr):
        if re.fullmatch(r"[0-9A-F]{3}", rax):
            return hdr, rax
        if not rax:
            return hdr, "%03X" % (int(hdr, 16) + 8)
        return None
    if re.fullmatch(r"DA[0-9A-F]{2}", hdr):
        alvo = hdr[2:]
        if rax and not re.fullmatch(r"[0-9A-F]{2}", rax):
            return None
        return "18DA" + alvo + tst, "18DA" + tst + (rax or alvo)
    if re.fullmatch(r"DB[0-9A-F]{2}", hdr):
        return None                      # pedido para todos os módulos: não é mapa de módulo
    return None


def filtro(f):
    if not f:
        return None
    out = {}
    if "from" in f:
        out["de"] = f["from"]
    if "to" in f:
        out["ate"] = f["to"]
    if f.get("years"):
        out["anos"] = sorted(f["years"])
    return out or None


def sinal(s):
    fmt = s.get("fmt") or {}
    n = fmt.get("len")
    if not isinstance(n, int) or n < 1 or n > 32:
        return None
    o = {"id": s["id"], "n": s.get("name") or s["id"], "b": fmt.get("bix", 0), "l": n}
    for de, para in (("mul", "m"), ("div", "d"), ("add", "a"), ("min", "mn"), ("max", "mx"), ("nullmin", "nmn"), ("nullmax", "nmx")):
        if fmt.get(de) is not None:
            o[para] = fmt[de]
    if fmt.get("sign"):
        o["s"] = 1
    if fmt.get("blsb"):
        o["le"] = 1
    if fmt.get("unit"):
        o["u"] = fmt["unit"]
    if s.get("path"):
        o["g"] = s["path"]
    if s.get("suggestedMetric"):
        o["k"] = s["suggestedMetric"]
    if isinstance(fmt.get("map"), dict):
        o["mp"] = {str(k): (v.get("description") or v.get("value") or "") if isinstance(v, dict) else str(v) for k, v in fmt["map"].items()}
    return o


def importar(caminho):
    nome = os.path.basename(caminho)[:-5]
    d = json.load(open(caminho, encoding="utf-8"))
    fora = {"extra": 0, "endereco": 0, "servico": 0, "sem_sinal": 0}
    tipos = {}
    for e in d.get("ecu", []):
        par = endereco(e.get("hdr"), None, None)
        if par and e.get("type"):
            tipos[par[0]] = e["type"]
    comandos = []
    for c in d.get("commands", []):
        if any(k in c for k in ("din", "dout", "pri", "eax", "proto")):
            fora["extra"] += 1
            continue
        svc = [k for k in c.get("cmd", {}) if k in ("22", "21")]
        if len(c.get("cmd", {})) != 1 or not svc:
            fora["servico"] += 1
            continue
        pid = str(c["cmd"][svc[0]]).upper()
        if not re.fullmatch(r"[0-9A-F]{2}" if svc[0] == "21" else r"[0-9A-F]{4}", pid):
            fora["servico"] += 1
            continue
        par = endereco(c.get("hdr"), c.get("rax"), c.get("tst"))
        if not par:
            fora["endereco"] += 1
            continue
        sinais = [x for x in (sinal(s) for s in c.get("signals", [])) if x]
        if not sinais:
            fora["sem_sinal"] += 1
            continue
        o = {"p": par[0], "r": par[1], "s": svc[0], "i": pid, "q": c.get("freq", 1), "z": sinais}
        if c.get("dbg"):
            o["nc"] = 1
        f, df = filtro(c.get("filter")), filtro(c.get("dbgfilter"))
        if f:
            o["f"] = f
        if df:
            o["df"] = df
        comandos.append(o)
    modulos = {}
    for c in comandos:
        modulos.setdefault(c["p"], {"p": c["p"], "r": c["r"], "t": tipos.get(c["p"], "")})
    return nome, {"fonte": "OBDb/" + nome, "modulos": sorted(modulos.values(), key=lambda m: m["p"]), "comandos": comandos}, fora


def main():
    if len(sys.argv) != 2:
        sys.exit("uso: tools_obdb.py <pasta com os <Marca-Modelo>.json>")
    os.makedirs(SAIDA, exist_ok=True)
    for velho in glob.glob(os.path.join(SAIDA, "*.js")):
        os.remove(velho)
    indice, descartes = [], {"extra": 0, "endereco": 0, "servico": 0, "sem_sinal": 0}
    for caminho in sorted(glob.glob(os.path.join(sys.argv[1], "*.json"))):
        nome, dados, fora = importar(caminho)
        for k in descartes:
            descartes[k] += fora[k]
        if not dados["comandos"]:
            continue
        marca, _, modelo = nome.partition("-")
        arq = slug(nome)
        corpo = json.dumps(dados, ensure_ascii=False, separators=(",", ":"))
        with open(os.path.join(SAIDA, arq + ".js"), "w", encoding="utf-8") as f:
            f.write("// GERADO por tools_obdb.py a partir de github.com/OBDb/%s (CC BY-SA 4.0) — não editar à mão.\n" % nome)
            f.write("export default " + corpo + ";\n")
        indice.append({"marca": marca.replace("-", " "), "modelo": modelo.replace("-", " "), "arquivo": arq,
                       "modulos": len(dados["modulos"]), "comandos": len(dados["comandos"]),
                       "sinais": sum(len(c["z"]) for c in dados["comandos"])})
    with open(os.path.join(RAIZ, "js", "modelosdados.js"), "w", encoding="utf-8") as f:
        f.write("// GERADO por tools_obdb.py — a lista dos modelos que têm mapa de módulos e sinais (origem: OBDb, CC BY-SA 4.0).\n")
        f.write("export default " + json.dumps(indice, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(len(indice), "modelos;", sum(i["comandos"] for i in indice), "comandos;", sum(i["sinais"] for i in indice), "sinais; descartados:", descartes)


if __name__ == "__main__":
    main()
