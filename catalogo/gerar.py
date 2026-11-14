# Gera js/catalogodados.js do DTCar Gestão a partir dos CSV montados dos catálogos (óleo, filtros e conversão).
# Uso (na raiz do repositório): python3 catalogo/gerar.py catalogo js/catalogodados.js && python3 tools_sw.py
import csv, json, re, sys, collections

pasta, saida = sys.argv[1], sys.argv[2]
ler = lambda n: list(csv.DictReader(open(f"{pasta}/{n}", encoding="utf-8-sig"), delimiter=";"))
limpa = lambda s: re.sub(r"\s+", " ", (s or "").replace("‐", "-").replace("–", "-")).strip()

def ano4(a):
    a = int(a)
    if a >= 1000: return a
    return 1900 + a if a >= 40 else 2000 + a

def periodo(txt):
    """Devolve (de, ate); 0 = sem limite / não informado."""
    t = limpa(txt)
    if not t: return 0, 0
    aberto_fim = bool(re.search(r"(→|->|-->|a >|>)\s*$", t)) or t.endswith(">")
    aberto_ini = bool(re.match(r"^(→|>|até)", t))
    anos = [ano4(x) for x in re.findall(r"(?:\d{2}[/.])?(\d{4}|\d{2})(?![/.\d])", t)]
    anos = [a for a in anos if 1940 <= a <= 2030]
    if not anos: return 0, 0
    if aberto_ini and not aberto_fim: return 0, max(anos)
    if aberto_fim and len(anos) == 1: return anos[0], 0
    if aberto_fim: return min(anos), 0
    if len(anos) == 1: return anos[0], anos[0]
    return min(anos), max(anos)

def anos_do_texto(t):
    a = [int(x) for x in re.findall(r"(?<![\d.,])((?:19[5-9]|20[0-3])\d)(?![\d.,])", t)]
    if not a: return 0, 0
    b = t.lower()
    if len(a) >= 2: return min(a), max(a)
    if re.search(r"at[eé]|anterior", b): return 0, a[0]
    return a[0], 0

# ---------- óleo ----------
AVISOS_OLEO = [
    (lambda q: q["montadora"] == "TOYOTA" and "HILUX" in q["modelo"].upper() and "2.8" in q["motor"] and q["litros"] == "5,9",
     "Conferido: o manual da Hilux 2.8 (177 cv) indica 7,9 L com filtro. Não use 5,9 L para o 2.8."),
    (lambda q: q["fonte"].startswith("Omnicraft") and q["modelo"].upper() == "ONIX" and "MT6" in q["motor"] and q["viscosidade"] == "15W40",
     "Provável erro de impressão da tabela (15W40): as outras fontes indicam 0W20 para o câmbio de 6 marchas."),
    (lambda q: q["fonte"].startswith("Petronas") and q["modelo"].upper() == "ONIX" and q["litros"] == "4,5",
     "Provável erro da tabela (4,5 L): as outras fontes indicam 3,5 L."),
]
EXTRAS_OLEO = [
    dict(fonte="Conferido no manual do proprietário", montadora="TOYOTA", modelo="HILUX / SW4", motor="2.8 diesel 1GD-FTV 177 cv",
         ano_de="2016", ano_ate="2021", litros="7,9", viscosidade="5W30 ou 10W30", norma="",
         aviso="7,9 L com filtro; 7,4 L sem trocar o filtro."),
    dict(fonte="Indicado por lojas (não conferido)", montadora="TOYOTA", modelo="HILUX / SW4", motor="2.8 diesel 204 cv",
         ano_de="2022", ano_ate="", litros="8", viscosidade="5W30", norma="ACEA C2 ; ACEA C3",
         aviso="Não conferido no manual: lojas vendem kit de 8 L (uma de 7 L). Confira no carro."),
]
mont, fontes, oleo = [], [], []
idx = lambda lista, v: lista.index(v) if v in lista else (lista.append(v) or len(lista) - 1)
for q in ler("oleo_aplicacoes.csv") + EXTRAS_OLEO:
    q = {k: limpa(v) for k, v in q.items()}
    if not q["litros"] and not q["viscosidade"]: continue
    a4 = lambda v: int(v) if re.fullmatch(r"(19|20)\d\d", v or "") else 0
    de, ate = a4(q["ano_de"]), a4(q["ano_ate"])
    if not de and not ate: de, ate = anos_do_texto(q["motor"] + " " + q["modelo"])
    aviso = q.get("aviso") or next((txt for f, txt in AVISOS_OLEO if f(q)), "")
    oleo.append([idx(mont, q["montadora"]), q["modelo"], q["motor"], de, ate, q["litros"], q["viscosidade"], q["norma"], idx(fontes, q["fonte"]), aviso])

# ---------- filtros ----------
ANO_CATALOGO = {"TECFIL": "Tecfil 2026", "MANN": "MANN 2021/22", "WEGA": "Wega 2023/24", "BOSCH": "Bosch 2019/20", "VOX": "Vox"}
marcas = list(ANO_CATALOGO)  # ordem = prioridade na tela
def codigos(s):
    """Campo do catálogo -> lista de códigos sem espaço (um campo pode trazer mais de um)."""
    s = limpa(s)
    if not s: return []
    partes = re.split(r"\s*(?:;|,|\bou\b|\s/\s|\|)\s*", s)
    out = []
    for p in partes:
        p = re.sub(r"\(.*?\)", "", p)
        p = re.sub(r"\s+", "", p).upper()
        if re.fullmatch(r"[A-Z0-9][A-Z0-9/.\-]{2,17}", p) and re.search(r"\d", p) and p not in out: out.append(p)
    return out
filtros = []
for q in ler("filtros_aplicacoes.csv"):
    m = q["marca_filtro"]
    if m not in ANO_CATALOGO: continue  # Mahle 2013 fica de fora: os códigos Mahle vêm da conversão da Tecfil
    q = {k: limpa(v) for k, v in q.items()}
    cs = [codigos(q[k]) for k in ("filtro_oleo", "filtro_ar", "filtro_combustivel", "filtro_cabine")]
    if not any(cs): continue
    de, ate = periodo(q["periodo"])
    filtros.append([marcas.index(m), idx(mont, q["montadora"]), q["modelo"], q["versao"], q["motor"], de, ate] + [" ".join(c) for c in cs] + [q["observacao"][:140]])

# ---------- conversão (base: código Tecfil) ----------
NOME = {"ACDELCO": "ACDelco", "AUTHOMIX": "AuthoMix", "MERCEDES BENZ": "Mercedes-Benz", "KIA MOTORS": "Kia", "JAC MOTORS": "JAC"}
marcas_conv, conv = [], collections.defaultdict(list)
for q in ler("conversao_marcas.csv"):
    cod = re.sub(r"\s+", "", q["codigo"]).upper(); tec = re.sub(r"\s+", "", q["codigo_tecfil"]).upper()
    if not cod or not tec: continue
    nome = NOME.get(q["marca"], q["marca"] if q["marca"] in ("MANN", "MAHLE", "VOX", "WEGA", "BOSCH", "FRAM", "WIX", "GM", "BMW", "BYD", "GWM", "JEEP", "MOPAR") else q["marca"].title())
    mi = idx(marcas_conv, nome + ("*" if q["tipo_marca"].startswith("montadora") else ""))
    if [mi, cod] not in conv[tec]: conv[tec].append([mi, cod])

dados = {"versao": "2026-11-14", "montadoras": mont, "fontesOleo": fontes, "oleo": oleo,
         "catalogos": [ANO_CATALOGO[m] for m in marcas], "marcas": [m.title() if m != "MANN" else "MANN" for m in marcas],
         "filtros": filtros, "marcasConv": marcas_conv, "conv": conv}
js = ("// Catálogo de óleo e filtros por veículo (pedido do Danilo em 14/11/2026). ARQUIVO GERADO: não edite à mão.\n"
      "// Fontes: tabelas de lubrificação Ipiranga, Maxon, Petronas, Texaco e Omnicraft (só litros, viscosidade e norma: a marca do óleo não entra)\n"
      "// e catálogos de filtros Tecfil 2026, MANN 2021/22, Wega 2023/24, Bosch 2019/20 e Vox; conversão entre marcas: Tecfil 2026.\n"
      "// Só carros, SUVs e caminhonetes. É dado de catálogo: a tela sempre manda conferir. Formato explicado em js/catalogo.js.\n"
      "export default " + json.dumps(dados, ensure_ascii=False, separators=(",", ":")) + ";\n")
open(saida, "w", encoding="utf-8").write(js)
print(len(js) // 1024, "KB;", len(oleo), "óleo;", len(filtros), "filtros;", len(conv), "códigos Tecfil com conversão;", len(mont), "montadoras")
