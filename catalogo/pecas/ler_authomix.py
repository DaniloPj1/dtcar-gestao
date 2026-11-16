# Lê o catálogo AuthoMix (Autopeças, ~480 páginas, grade de 3 a 4 colunas por 3 linhas) e grava catalogo/pecas/authomix.json no formato comum.
# Uso: python3 -I -W ignore catalogo/pecas/ler_authomix.py <catalogo.pdf> catalogo/pecas/authomix.json
# Cada célula da grade começa num código em negrito tamanho 10 (ex.: AX713105H). Tudo que está na mesma coluna, abaixo desse código e acima do próximo
# código da coluna, é da célula: nome (negrito 6,8), "Nº Orig." (5,8), aplicações (tamanho 7: "Modelo motor yy/yy", "yy/..." = em diante) e medidas/observações (4,8).
# O catálogo não traz a montadora (só o modelo): o gerador completa pela votação dos outros catálogos.
import sys, re, json
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]
limpo = lambda t: re.sub(r"\s+", " ", t).strip()
COD = re.compile(r"^[A-Z]{1,4}\d{2,6}[A-Z]{0,3}$")
def ano(y): y = int(y); return 2000 + y if y <= 30 else 1900 + y
def sem_orig(texto, oems):
    # "Nº Orig.: A / B  MODELO ..." (o rótulo pode vir no meio do texto): tira os códigos, devolve o resto
    while True:
        m = re.search(r"N[ºo°]\.?\s*Orig\.?:?\s*", texto)
        if not m: return limpo(texto)
        t = texto[m.end():].split(); cods = []
        if t: cods.append(t.pop(0))
        while len(t) >= 2 and t[0] == "/": t.pop(0); cods.append(t.pop(0))
        oems.extend(c for c in cods if re.search(r"\d", c))
        texto = texto[:m.start()] + " " + " ".join(t)
def aplicacoes(texto):
    out = []; depth = 0; cur = ""
    for ch in texto:
        if ch == "(": depth += 1
        if ch == ")": depth -= 1
        if ch == "," and depth == 0: out.append(cur); cur = ""
        else: cur += ch
    out.append(cur); res = []
    for e in out:
        e = limpo(e)
        m = re.match(r"^(.*?)\s*(\d{2})\s*/\s*(\d{2}|\.\.\.|…)?\s*(\(.*\))?$", e)
        if not m or not m.group(1): continue
        de = ano(m.group(2)); ate = ano(m.group(3)) if m.group(3) and m.group(3).isdigit() else 0
        res.append((limpo(m.group(1)), de, ate, (m.group(4) or "").strip("() ")))
    return res
doc = fitz.open(pdf); pecas, ordem = {}, []
for pi, pg in enumerate(doc):
    L = []
    for b in pg.get_text("dict")["blocks"]:
        if b["type"]: continue
        for l in b["lines"]:
            s = l["spans"][0]; t = limpo("".join(x["text"] for x in l["spans"]))
            if t and l["bbox"][1] < 805 and l["bbox"][1] > 40: L.append((l["bbox"][1], l["bbox"][0], l["bbox"][2], round(s["size"], 1), "Bold" in s["font"], t))
    cods = [l for l in L if l[4] and abs(l[3] - 10.0) < .3 and COD.match(l[5])]
    if len(cods) < 2: continue
    for c in cods:
        col = [x for x in cods if abs(x[1] - c[1]) < 12 and x[0] > c[0] + 5]
        y1 = min([x[0] for x in col], default=810) - 1
        cel = [l for l in L if c[0] - 1 <= l[0] < y1 and c[1] - 12 <= l[1] and l[2] <= c[1] + 135 and l is not c]
        cel.sort()
        nome = limpo(" ".join(l[5] for l in cel if l[4] and 6 <= l[3] < 8))
        oems = []
        apps = sem_orig(" ".join(l[5] for l in cel if (abs(l[3] - 7.0) < .3 and not l[4]) or re.match(r"^N[ºo°]\.?\s*Orig", l[5])), oems)
        med = limpo(" ".join(l[5] for l in cel if l[3] < 6.5 and not l[4] and not re.match(r"^N[ºo°]\.?\s*Orig", l[5])))
        oems = list(dict.fromkeys(oems))
        cod = c[5]
        novo = {"codigo": cod, "grupo": "", "descricao": nome, "medidas": med, "foto": "", "oem": oems, "conv": [], "apl": [{"montadora": "", "modelo": m.upper(), "de": de, "ate": ate, "obs": o} for m, de, ate, o in aplicacoes(apps)], "_pag": pi + 1}
        if cod not in pecas: pecas[cod] = novo; ordem.append(cod)
        else:  # o mesmo código aparece em mais de uma célula (variações): junta aplicações e números originais
            q = pecas[cod]
            q["oem"] += [o for o in novo["oem"] if o not in q["oem"]]; q["apl"] += [a for a in novo["apl"] if a not in q["apl"]]
            q["medidas"] = q["medidas"] or novo["medidas"]; q["descricao"] = q["descricao"] or novo["descricao"]
j = {"marca": "AuthoMix", "edicao": "Catálogo Autopeças", "fotos": "", "pecas": [pecas[c] for c in ordem]}
# Tabelas de conversão ("AUTHO MIX | PÁGINAS | SAMPEL | AXIOS | ..."): cada linha liga o código AuthoMix aos das outras marcas
por = {p["codigo"]: p for p in j["pecas"]}; pares = 0; faltam = set()
NOMES = {"SABÓ": "Sabó", "FRAS-LE": "Fras-le", "SKF": "SKF", "NYTRON": "Nytron"}
for pg in doc:
    L = []
    for b in pg.get_text("dict")["blocks"]:
        if b["type"]: continue
        for l in b["lines"]:
            t = limpo("".join(x["text"] for x in l["spans"]))
            if t: L.append((l["bbox"][1], (l["bbox"][0] + l["bbox"][2]) / 2, t))
    cab = [l for l in L if l[2].upper() == "PÁGINAS"]
    if not cab: continue
    hy = cab[0][0]; heads = [(x, t) for y, x, t in L if abs(y - hy) < 3 and t.upper() != "PÁGINAS"]
    linhas = {}
    for y, x, t in L:
        if y > hy + 6 and y < 805: linhas.setdefault(round(y / 3), []).append((x, t))
    for k in sorted(linhas):
        cel = sorted(linhas[k])
        if not cel or not COD.match(cel[0][1]) or cel[0][1] not in por: 
            if cel and COD.match(cel[0][1]): faltam.add(cel[0][1])
            continue
        p = por[cel[0][1]]
        for x, t in cel[1:]:
            h = min(heads, key=lambda h: abs(h[0] - x))[1]
            if h.upper().replace(" ", "") in ("AUTHOMIX", "PÁGINAS") or t in ("-", "–") or not re.search(r"\d", t): continue
            par = [NOMES.get(h.upper(), h.title()), t]
            if par not in p["conv"]: p["conv"].append(par); pares += 1
for p in j["pecas"]: p.pop("_pag", None)
json.dump(j, open(saida, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(pares, "conversões ligadas;", len(faltam), "códigos da tabela sem peça")
json.dump(j, open(saida, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(ordem), "peças;", sum(len(p["apl"]) for p in j["pecas"]), "aplicações;", sum(1 for p in j["pecas"] if not p["apl"]), "sem aplicação;", sum(1 for p in j["pecas"] for a in p["apl"] if a["ate"]), "com ano fechado")
