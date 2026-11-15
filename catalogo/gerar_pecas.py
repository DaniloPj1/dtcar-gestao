# Gera js/pecasdados.js (peças por veículo) a partir dos catálogos lidos em catalogo/pecas/*.json (um arquivo por marca/catálogo).
# Uso (na raiz do repositório): python3 catalogo/gerar_pecas.py catalogo/pecas js/pecasdados.js && python3 tools_sw.py <versão>
# Formato de cada catalogo/pecas/<marca>.json (o mesmo para todos os leitores):
#   { marca, edicao, fotos (pasta em catalogo/fotos), pecas: [ { codigo, grupo, linha, descricao, medidas, foto, oem: [códigos da montadora],
#     conv: [[marca, código]], breve, apl: [ { montadora, modelo, de, ate, obs } ] } ] }        (de/ate = ano; 0 = sem limite)
import json, sys, glob, os, re, datetime
pasta, saida = sys.argv[1], sys.argv[2]
cats, mont, grupos, pecas, apl = [], [], [], [], []
def idx(lista, v):
    if v not in lista: lista.append(v)
    return lista.index(v)
limpo = lambda t: re.sub(r"\s+", " ", str(t or "")).strip()
for arq in sorted(glob.glob(os.path.join(pasta, "*.json"))):
    j = json.load(open(arq, encoding="utf-8")); c = len(cats); cats.append([j["marca"], j.get("edicao", ""), j.get("fotos", "")])
    for p in j["pecas"]:
        if not p.get("apl"): continue
        n = len(pecas)
        pecas.append([c, p["codigo"], idx(grupos, limpo(p["grupo"])), limpo(p["descricao"]).upper(), limpo(p.get("medidas")), p.get("foto") or "",
                      [limpo(x) for x in p.get("oem", []) if limpo(x)], [[limpo(a), limpo(b)] for a, b in p.get("conv", []) if limpo(b)], 1 if p.get("breve") else 0])
        for a in p["apl"]:
            apl.append([n, idx(mont, limpo(a["montadora"]).upper()), limpo(a["modelo"]).upper(), int(a.get("de") or 0), int(a.get("ate") or 0), limpo(a.get("obs")).upper()])
d = {"versao": datetime.date.today().isoformat(), "catalogos": cats, "montadoras": mont, "grupos": grupos, "pecas": pecas, "apl": apl}
cab = ("// Peças por veículo (pedido do Danilo em 15/11/2026). ARQUIVO GERADO por catalogo/gerar_pecas.py: não edite à mão.\n"
       "// Catálogos: " + ", ".join(f"{m} {e}".strip() for m, e, _ in cats) + ". É dado de catálogo: a tela sempre manda conferir. Formato explicado em js/pecas.js.\n")
open(saida, "w", encoding="utf-8").write(cab + "export default " + json.dumps(d, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(len(pecas), "peças,", len(apl), "aplicações,", len(mont), "montadoras,", len(grupos), "grupos →", saida, os.path.getsize(saida) // 1024, "KB")
