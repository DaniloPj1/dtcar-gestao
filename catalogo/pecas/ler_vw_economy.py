# Lê o catálogo "Linha Economy Parts" da Volkswagen (PDF, edição 12, out/2022; 33 páginas) e grava catalogo/pecas/vw_economy.json no formato comum.
# Uso: python3 -I -W ignore catalogo/pecas/ler_vw_economy.py <catalogo.pdf> catalogo/pecas/vw_economy.json
# Página em paisagem. Colunas (x): título do produto (< 200), modelo (≈ 238), ano "2005>2011" (≈ 329), referência de série = código da VW (≈ 425–500),
# referência Economy (≈ 510–600), referência de outras marcas = conversão (≈ 610–700). Cada bloco de modelos (separado por espaço maior) tem os seus códigos ao lado.
import sys, re, json
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]
limpo = lambda t: re.sub(r"\s+", " ", t).strip()
doc = fitz.open(pdf); pecas, ordem = {}, []; total = 0; perdidos = []
for pg in doc:
    L = []
    for b in pg.get_text("dict")["blocks"]:
        if b["type"]: continue
        for l in b["lines"]:
            t = limpo("".join(s["text"] for s in l["spans"]))
            if t: L.append((l["bbox"][1], l["bbox"][0], l["bbox"][2], l["spans"][0]["size"], t))
    L.sort()
    anos = [l for l in L if 320 < l[1] < 340 and re.match(r"^\d{4}\s*>\s*(\d{4})?$", l[4])]
    if not anos: continue
    mod = [l for l in L if 230 < l[1] < 300 and 120 < l[0] < 560]
    linhas = []  # (y, modelo, de, ate)
    for a in anos:
        m = [x for x in mod if abs(x[0] - a[0]) < 3]
        if m:
            ys = re.findall(r"\d{4}", a[4]); de = int(ys[0]); ate = int(ys[1]) if len(ys) > 1 else 0
            linhas.append((a[0], limpo(m[0][4]), de, ate))
    if not linhas: continue
    blocos = [[linhas[0]]]
    for r in linhas[1:]:
        if r[0] - blocos[-1][-1][0] > 12.5: blocos.append([r])
        else: blocos[-1].append(r)
    titulos = [l for l in L if l[1] < 200 and (l[3] >= 11 or (l[3] >= 9.5 and l[4].startswith("("))) and l[0] > 90 and not re.match(r"^\d+$", l[4]) and l[4] != "Linha Economy"]
    for k, bl in enumerate(blocos):
        y0 = bl[0][0] - 6; y1 = blocos[k + 1][0][0] - 6 if k + 1 < len(blocos) else 560
        dentro = [l for l in L if y0 <= l[0] < y1]
        serie = [l[4] for l in dentro if 415 < l[1] < 505 and not l[4].startswith("(") and not re.match(r"^(Todos|Veículos|produzidos|até)", l[4])]
        econ = [l[4] for l in dentro if 505 <= l[1] < 600 and not l[4].startswith("(") and l[4] != "--"]
        medidas = " ".join(l[4] for l in dentro if 505 <= l[1] < 600 and l[4].startswith("("))
        conv = [l[4] for l in dentro if 605 <= l[1] < 710 and l[4] != "--"]
        tit = [t for t in titulos if t[0] <= bl[0][0] + 5]
        titulo = limpo(" ".join(t[4] for t in tit if tit and abs(t[0] - tit[-1][0]) < 25)) if tit else ""
        cod = (econ[0] if econ else (serie[0] if serie else "")).strip()
        total += 1
        if not cod or not titulo: perdidos.append((cod, titulo, bl[0][1])); continue
        if cod not in pecas:
            pecas[cod] = {"codigo": cod, "grupo": "", "descricao": titulo, "medidas": limpo(medidas.strip("()")), "foto": "", "oem": [], "conv": [], "apl": []}; ordem.append(cod)
        p = pecas[cod]
        for s in serie:
            if s not in p["oem"]: p["oem"].append(s)
        # conversão: "Fremax BD-5614" ou "Bosch 0 986 479 R68" (a 2ª linha de um código com marca vira continuação)
        jun = []
        for c in conv:
            if re.match(r"^[A-Za-zÀ-ú]{3,}\s+\S", c) or not jun: jun.append(c)
            else: jun[-1] += " " + c
        for c in jun:
            m = re.match(r"^([A-Za-zÀ-ú]+)\s+(.+)$", c)
            if m and [m.group(1), m.group(2)] not in p["conv"]: p["conv"].append([m.group(1), m.group(2)])
        for (_, modelo, de, ate) in bl:
            a = {"montadora": "VOLKSWAGEN", "modelo": modelo.upper(), "de": de, "ate": ate, "obs": ""}
            if a not in p["apl"]: p["apl"].append(a)
j = {"marca": "Volkswagen Economy", "edicao": "Linha Economy Parts, edição 12, outubro de 2022", "fotos": "", "pecas": [pecas[c] for c in ordem]}
json.dump(j, open(saida, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(total, "blocos,", len(perdidos), "sem código/título", perdidos[:5]); print(len(ordem), "peças;", sum(len(p["apl"]) for p in j["pecas"]), "aplicações")
