# Lê o catálogo Mobensani 2019 (borrachas: buchas, coxins, suportes; ~270 páginas com texto) e grava catalogo/pecas/mobensani.json no formato comum.
# Uso: python3 -I -W ignore catalogo/pecas/ler_mobensani.py <catalogo.pdf> catalogo/pecas/mobensani.json
# Cada página é de uma montadora (nome na vertical, x > 570). Cada item começa num "MB 0000" (negrito, x ≈ 57); os números originais ficam em x 140–200,
# a descrição em negrito em x 210–380 e os veículos em x 410–470, com o período ("96/14", "12/..." = em diante) em x ≈ 514.
import sys, re, json
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]
limpo = lambda t: re.sub(r"\s+", " ", t).strip()
def ano(y):
    y = int(y); return 2000 + y if y <= 30 else 1900 + y
def periodo(t):
    m = re.match(r"^(\d{2})\s*/\s*(\d{2}|\.\.\.|…)?$", t.strip())
    if not m: return None
    de = ano(m.group(1)); ate = ano(m.group(2)) if m.group(2) and m.group(2).isdigit() else 0
    return de, ate
doc = fitz.open(pdf); pecas, ordem = {}, []
EXTRA = ("AUDI", "SEAT", "SKODA", "CITROEN", "PEUGEOT")
for i, pg in enumerate(doc):
    linhas = []
    for b in pg.get_text("dict")["blocks"]:
        if b["type"]: continue
        for l in b["lines"]:
            t = limpo("".join(s["text"] for s in l["spans"]))
            if t: linhas.append((l["bbox"][1], l["bbox"][0], l["bbox"][2], "Bold" in l["spans"][0]["font"], t))
    mont = [l for l in linhas if l[1] > 570 and l[0] < 200 and re.match(r"^[A-ZÀ-Ú][A-ZÀ-Ú .\-]+$", l[4])]
    itens = sorted([l for l in linhas if 50 < l[1] < 70 and re.match(r"^MB \d{3,5}\w?$", l[4])])
    if not mont or not itens: continue
    montadora = limpo(" ".join(l[4] for l in sorted(mont))).upper(); montadora = {"GENERAL MOTORS": "CHEVROLET", "KIA MOTORS": "KIA", "CITROËN": "CITROEN"}.get(montadora, montadora)
    for k, it in enumerate(itens):
        y0 = it[0] - 1; y1 = itens[k + 1][0] - 1 if k + 1 < len(itens) else 810
        dentro = [l for l in linhas if y0 <= l[0] < y1 and l[0] < 805]
        refs = [l[4] for l in sorted(dentro) if 135 < l[1] < 205 and not l[3] and l[4] != str(k + 1)]
        desc = limpo(re.sub(r"(?i)\s*escapamentos?\s*\|\s*exhaust.*$", "", limpo(" ".join(l[4] for l in sorted(dentro) if l[3] and 205 < l[1] < 400))))
        qtd = [l[4] for l in dentro if 545 < l[1] < 565 and l[4].isdigit()]
        cod = it[4]
        if cod not in pecas:
            pecas[cod] = {"codigo": cod, "grupo": "", "descricao": desc.capitalize(), "medidas": "", "foto": "", "oem": [], "conv": [], "apl": [], "emb": (qtd[0] + (" peça" if qtd[0] == "1" else " peças")) if qtd else ""}
            ordem.append(cod)
        p = pecas[cod]
        for r in refs:
            if not re.search(r"\d", r) or r.upper().startswith("N. ORIG"): continue
            if r not in p["oem"]: p["oem"].append(r)
        for v in [l for l in dentro if 405 < l[1] < 500]:
            per = [x for x in dentro if 505 < x[1] < 545 and abs(x[0] - v[0]) < 3]
            pe = periodo(per[0][4]) if per else None
            if not pe: continue
            modelo = v[4].upper(); m2 = montadora
            for ex in EXTRA:
                if modelo.startswith(ex + " "): m2, modelo = ex, modelo[len(ex) + 1:]
            a = {"montadora": m2, "modelo": modelo, "de": pe[0], "ate": pe[1], "obs": ""}
            if a not in p["apl"]: p["apl"].append(a)
j = {"marca": "Mobensani", "edicao": "2019", "fotos": "", "pecas": [pecas[c] for c in ordem]}
json.dump(j, open(saida, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(ordem), "peças;", sum(len(p["apl"]) for p in j["pecas"]), "aplicações;", sum(1 for p in j["pecas"] if not p["apl"]), "sem aplicação")
