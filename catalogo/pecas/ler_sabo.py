# Lê o catálogo "Linha Leve" da Sabó (PDF "gerado em", ~9.500 páginas) e grava catalogo/pecas/sabo.json no formato comum.
# Uso: python3 -I -W ignore catalogo/pecas/ler_sabo.py <catalogo.pdf> catalogo/pecas/sabo.json
# O texto do PDF repete cada linha 2 a 4 vezes: as aplicações repetidas são descartadas pela chave (código, montadora, modelo, anos, motor, observação).
import sys, re, json
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]
# (primeira página 0-based, seção, grupo)
SECOES = [(7, "jogo", "Jogo de juntas"), (5722, "cab", "Junta de cabeçote"), (5951, "div", "Junta"), (6807, "ret", "Retentor"), (7383, "buc", "Bucha"),
          (7941, "cox", "Coxim"), (8575, "par", "Parafuso"), (8773, "amo", "Reparo de amortecedor"), (9217, "hom", "Reparo de homocinética")]
def secao(i):
    r = None
    for ini, s, g in SECOES:
        if i >= ini: r = (s, g)
    return r if i >= SECOES[0][0] else None
EXTRA_RET = [(324, "Ø eixo (mm)"), (360, "Ø alojamento (mm)")]
limpo = lambda t: re.sub(r"\s+", " ", t).strip()
def anos(t):
    m = re.search(r"\(([^()]*\d{4}[^()]*)\)\s*$", t)
    if not m: return t, 0, 0
    ys = [int(y) for y in re.findall(r"(?<!\d)((?:19|20)\d{2})(?!\d)", m.group(1))]
    modelo = t[:m.start()].strip()
    if not ys: return t, 0, 0
    return modelo, ys[0], (0 if ">" in m.group(1) or len(ys) < 2 else ys[1])
def linhas(p):
    rows = []
    for b in p.get_text("dict")["blocks"]:
        if b["type"]: continue
        for l in b["lines"]:
            t = "".join(s["text"] for s in l["spans"]).strip()
            if not t or l["bbox"][1] > 800 or l["spans"][0]["size"] < 2 or l["spans"][0]["size"] > 17: continue
            rows.append((l["bbox"][1], l["bbox"][0], l["spans"][0]["size"], "Bold" in l["spans"][0]["font"], "Italic" in l["spans"][0]["font"], t, l["bbox"][2]))
    rows.sort(); out = []
    for r in rows:
        if out and abs(out[-1][0][0] - r[0]) < 2.6: out[-1].append(r)
        else: out.append([r])
    return [sorted(g, key=lambda c: c[1]) for g in out]
pecas, ordem, aplv = {}, [], set()
mont = modelo = motor = ""; de = ate = 0; atual = None; cabecalho = []
doc = fitz.open(pdf)
for i in range(SECOES[0][0], len(doc)):
    sec, grupo = secao(i)
    for g in linhas(doc[i]):
        c0 = g[0]; tam = c0[2]; txt0 = c0[5]; full = limpo(" ".join(c[5] for c in g))
        if re.search(r"Nº Sabó|Nº Ref|Ø Eixo|^\(mm\)", full) and tam >= 8 - .1 and not re.match(r"^[0-9A-Z]{4,10}$", txt0):
            if "Nº Sabó" in full: cabecalho = [((c[1] + c[6]) / 2, c[5]) for c in g if c[5] not in ("Nº Sabó", "Descrição") and not c[5].startswith("Nº Ref")]
            continue
        if tam >= 9.9 and c0[1] > 100: continue
        if tam >= 9.9 and txt0.startswith("Nº SABÓ"): pass
        elif tam >= 9.9 and False: pass
        if tam >= 9.9 and not txt0.startswith("Nº SABÓ"):
            mont = limpo(txt0).upper(); modelo = motor = ""; de = ate = 0; atual = None; continue
        if sec == "jogo":
            m = re.match(r"Nº SABÓ:\s*(\S+)\s*/\s*(.+)", full)
            if m:
                cod = m.group(1); atual = pecas.setdefault(cod, {"codigo": cod, "grupo": grupo, "descricao": limpo(m.group(2)).capitalize(), "medidas": "", "foto": "", "oem": [], "conv": [], "apl": []})
                if cod not in ordem: ordem.append(cod)
                k = (cod, mont, modelo, de, ate, motor, "")
                if k not in aplv: aplv.add(k); atual["apl"].append({"montadora": mont, "modelo": modelo, "de": de, "ate": ate, "obs": motor})
                continue
        if 8.5 <= tam < 9.9 and re.search(r"\d{4}", full) is not None and (g[0][1] < 60) and not re.match(r"^[0-9A-Z]{4,10}$", txt0):
            motor = ""
            esq = [c for c in g if c[1] < 400] if sec in ("jogo", "cab", "div", "par") else g
            dir_ = [c for c in g if c[1] >= 400] if sec in ("jogo", "cab", "div", "par") else []
            com = [c for c in esq if re.search(r"\(.*\d{4}", c[5])]
            modelo, de, ate = anos(limpo(com[0][5] if com else " ".join(c[5] for c in esq))); motor = limpo(" ".join(c[5] for c in dir_)); atual = None; continue
        if 8.5 <= tam < 9.9 and g[0][1] < 60 and not re.match(r"^[0-9A-Z]{4,10}$", txt0):  # modelo sem ano (ex.: retentores, "-")
            v = limpo(g[0][5]); modelo = "" if v in ("-", mont) else v; de = ate = 0; motor = ""; atual = None; continue
        if sec == "jogo": continue
        if tam > 8.6: continue
        if c0[1] < 110 and re.match(r"^[0-9A-Z]{4,10}$", txt0) and re.search(r"\d", txt0) and c0[2] <= 8.6:
            cod = txt0; resto = g[1:]; refx = 500 if sec != "hom" else 510
            desc = limpo(resto[0][5]) if resto else ""
            if cod not in pecas:
                pecas[cod] = {"codigo": cod, "grupo": grupo, "descricao": desc, "medidas": "", "foto": "", "oem": [], "conv": [], "apl": []}; ordem.append(cod)
            atual = pecas[cod]; med = []
            for c in resto[1:]:
                if c[1] >= refx - 20 and c[1] > 440 and sec not in ("cab", "div", "par", "ret") or c[1] >= refx and sec in ("cab", "div", "par", "ret", "cox", "buc", "amo", "hom"): 
                    if c[5] not in atual["oem"]: atual["oem"].append(c[5]); continue
                rot = ""
                cen = (c[1] + c[6]) / 2; dist = 1e9
                for x, nome in cabecalho + (EXTRA_RET if sec == "ret" else []):
                    if abs(x - cen) < dist: dist, rot = abs(x - cen), nome
                med.append((rot + ": " if rot and rot != "Descrição" else "") + c[5])
            if not atual["medidas"]: atual["medidas"] = " · ".join(med)
            obs = ""
            k = (cod, mont, modelo, de, ate, motor, obs)
            if k not in aplv: aplv.add(k); atual["apl"].append({"montadora": mont, "modelo": modelo, "de": de, "ate": ate, "obs": motor})
            atual["_k"] = k
        elif atual is not None:  # linha de continuação: observação (* Com rolamento) e mais referências
            for c in g:
                if c[1] >= 500:
                    if c[5] not in atual["oem"]: atual["oem"].append(c[5])
                elif c[1] < 340 and atual["apl"]:
                    nota = limpo(c[5])
                    if nota and nota not in atual["apl"][-1]["obs"]: atual["apl"][-1]["obs"] = limpo(atual["apl"][-1]["obs"] + " " + nota)
    if i % 500 == 0: print(i, len(pecas), flush=True)
saida_j = {"marca": "Sabó", "edicao": "Linha Leve, 15/11/2026", "fotos": "", "pecas": []}
for cod in ordem:
    p = pecas[cod]; p.pop("_k", None); saida_j["pecas"].append(p)
json.dump(saida_j, open(saida, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
print(len(ordem), "peças;", sum(len(p["apl"]) for p in saida_j["pecas"]), "aplicações")
