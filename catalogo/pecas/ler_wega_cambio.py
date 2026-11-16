# Lê o catálogo Wega de filtros de câmbio automático 2023-2024 (22 páginas) e grava catalogo/pecas/wega_cambio.json no formato comum.
# Uso: python3 -I -W ignore catalogo/pecas/ler_wega_cambio.py <catalogo.pdf> catalogo/pecas/wega_cambio.json
# Colunas (x): código Wega (≈ 45, tamanho 8,6), câmbio (≈ 100–140), aplicação (≈ 157, tamanho 6,7: "MONTADORA MODELO motor 98-08" ou "2013-->" = em diante),
# conversão (marca ≈ 344–400, código ≈ 404). A linha de cada código vai até o ponto médio do código seguinte.
import sys, re, json
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]
limpo = lambda t: re.sub(r"\s+", " ", t).strip()
def ano(y):
    y = int(y); return y if y > 99 else (2000 + y if y <= 30 else 1900 + y)
MARCAS_MONT = {"HYUNDAI", "KIA", "TOYOTA", "AUDI", "JEEP", "MITSUBISHI", "FORD", "GM", "CHEVROLET", "FIAT", "VW", "VOLKSWAGEN", "HONDA", "NISSAN", "RENAULT", "PEUGEOT", "CITROEN", "CITROËN", "BMW", "MERCEDES", "MERCEDES-BENZ", "VOLVO", "LAND ROVER", "JAGUAR", "SUZUKI", "MINI", "CHERY", "JAC", "LEXUS", "SUBARU", "MAZDA", "CHRYSLER", "DODGE", "PORSCHE", "SSANGYONG", "SEAT", "SKODA"}
MONT2 = ("LAND ROVER", "ALFA ROMEO", "MERCEDES-BENZ", "MERCEDES BENZ", "GREAT WALL", "ASIA MOTORS")
doc = fitz.open(pdf); pecas, ordem = {}, []
for pg in doc:
    L = []
    for b in pg.get_text("dict")["blocks"]:
        if b["type"]: continue
        for l in b["lines"]:
            t = limpo("".join(x["text"] for x in l["spans"]))
            if t and 60 < l["bbox"][1] < 815: L.append((l["bbox"][1], l["bbox"][0], round(l["spans"][0]["size"], 1), t))
    L.sort()
    cods = [l for l in L if l[1] < 90 and abs(l[2] - 8.6) < .3 and re.match(r"^W[A-Z]{2,3}-?\d+", l[3])]
    for k, c in enumerate(cods):
        ini = (cods[k - 1][0] + c[0]) / 2 if k else 80; fim = (c[0] + cods[k + 1][0]) / 2 if k + 1 < len(cods) else 815
        cel = [l for l in L if ini <= l[0] < fim and l is not c]
        cambios = [l[3] for l in cel if 95 < l[1] < 150 and abs(l[2] - 8.6) < .3 and l[3].upper() != "CÂMBIO"]
        obs = [l[3] for l in cel if re.match(r"(?i)^obs:", l[3])]
        apps = []
        for l in cel:
            if not (150 < l[1] < 200 and abs(l[2] - 6.7) < .3) or re.match(r"(?i)^obs:", l[3]): continue
            m = re.match(r"^(.*?)\s*-?\s*(\d{2}|\d{4})\s*-\s*(\d{2}|\d{4})$", l[3])
            op = re.match(r"^(.*?)\s*(\d{2}|\d{4})\s*-+>$", l[3])
            if m: txt, de, ate = m.group(1), ano(m.group(2)), ano(m.group(3))
            elif op: txt, de, ate = op.group(1), ano(op.group(2)), 0
            else: continue
            txt = limpo(txt).rstrip("-").strip().upper(); mont = next((x for x in MONT2 if txt.startswith(x + " ")), txt.split(" ")[0]); modelo = txt[len(mont):].strip()
            apps.append({"montadora": mont.replace("MERCEDES-BENZ", "MERCEDES BENZ"), "modelo": modelo, "de": de, "ate": ate, "obs": ""})
        marcas = [l for l in cel if 335 < l[1] < 400 and abs(l[2] - 7.7) < .3]; codigos = [l for l in cel if l[1] >= 400 and abs(l[2] - 7.7) < .3]
        oem, conv = [], []
        for cd in codigos:
            mc = [m for m in marcas if abs(m[0] - cd[0]) < 3]
            marca = mc[0][3].strip() if mc else ""
            if not marca or marca.upper() in MARCAS_MONT or marca.upper() in {a["montadora"] for a in apps}: oem.append(cd[3])
            else: conv.append([marca.title(), cd[3]])
        medidas = " · ".join(([("Câmbio " + " / ".join(cambios))] if cambios else []) + [o.replace("OBS:", "Obs:").replace("Obs:", "Obs.:") for o in obs])
        cod = c[3]
        if cod in pecas: continue
        pecas[cod] = {"codigo": cod, "grupo": "Filtro de câmbio", "descricao": "Filtro de câmbio automático", "medidas": medidas, "foto": "", "oem": oem, "conv": conv, "apl": apps}; ordem.append(cod)
j = {"marca": "Wega", "edicao": "Filtros de câmbio automático 2023-2024", "fotos": "", "pecas": [pecas[c] for c in ordem]}
json.dump(j, open(saida, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(ordem), "peças;", sum(len(p["apl"]) for p in j["pecas"]), "aplicações;", sum(1 for p in j["pecas"] for a in p["apl"] if a["ate"]), "com ano fechado;", sum(1 for p in j["pecas"] if not p["apl"]), "sem aplicação")
