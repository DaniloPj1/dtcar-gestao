# Gera js/pecasdados.js (peças por veículo) a partir dos catálogos lidos em catalogo/pecas/*.json (um arquivo por marca/catálogo).
# Uso (na raiz do repositório): python3 catalogo/gerar_pecas.py catalogo/pecas js/pecasdados.js && python3 tools_sw.py <versão>
# Formato de cada catalogo/pecas/<marca>.json (o mesmo para todos os leitores):
#   { marca, edicao, fotos (pasta em catalogo/fotos), pecas: [ { codigo, grupo, linha, descricao, medidas, foto, oem: [códigos da montadora],
#     conv: [[marca, código]], breve, emb (embalagem: "2 peças"), apl: [ { montadora, modelo, de, ate, obs } ] } ] }        (de/ate = ano; 0 = sem limite)
import json, sys, glob, os, re, datetime
pasta, saida = sys.argv[1], sys.argv[2]
cats, mont, grupos, pecas, apl, modelos, obss = [], [], [], [], [], [""], [""]
mod_i, obs_i = {"": 0}, {"": 0}
def dic(lista, tab, v):
    if v not in tab: tab[v] = len(lista); lista.append(v)
    return tab[v]
def idx(lista, v):
    if v not in lista: lista.append(v)
    return lista.index(v)
limpo = lambda t: re.sub(r"\s+", " ", str(t or "")).strip()
import unicodedata
sem_acento = lambda t: "".join(c for c in unicodedata.normalize("NFD", str(t or "").upper()) if unicodedata.category(c) != "Mn")
# Grupo da peça: o mesmo nome em todos os catálogos, tirado da descrição (cada marca chama o grupo de um jeito). A ordem importa.
GRUPOS = [
    (r"COIFA.*HOMOCINETICA", "Coifa da homocinética"), (r"COIFA.*(CAIXA|DIRECAO)", "Coifa da caixa de direção"),
    (r"KIT.*AMORTECEDOR|BATENTE.*(COIFA|AMORTECEDOR)", "Kit e batente do amortecedor"),
    (r"(COXIM|SUPORTE).*AMORTECEDOR", "Coxim do amortecedor"), (r"(COXIM|SUPORTE|CALCO).*(MOTOR|CAMBIO)", "Coxim do motor e câmbio"),
    (r"^BATENTE", "Batente da suspensão"), (r"BUCHA.*BARRA ESTABILIZADORA", "Bucha da barra estabilizadora"), (r"^BUCHA", "Bucha"),
    (r"BIELETA", "Bieleta"), (r"AXIAL", "Axial de direção"), (r"^TERMINAL", "Terminal de direção"),
    (r"JUNTA DESLIZANTE", "Junta deslizante"), (r"HOMOCINETICA", "Homocinética"), (r"TULIPA", "Tulipa"), (r"TRIZETA", "Trizeta"), (r"SEMI-? ?EIXO", "Semieixo"),
    (r"^(BANDEJA|BRACO)", "Bandeja e braço de suspensão"), (r"^PIVO", "Pivô"), (r"^CUBO", "Cubo de roda"), (r"CAIXA DE DIRECAO", "Caixa de direção"),
    (r"BARRA DE DIRECAO", "Barra de direção"), (r"CILINDRO MESTRE", "Cilindro mestre"), (r"CILINDRO DE RODA", "Cilindro de roda"), (r"PASTILHA", "Pastilha de freio"), (r"DISCO", "Disco de freio"),
    (r"TAMBOR", "Tambor de freio"), (r"LONA|SAPATA", "Lona e sapata de freio"), (r"^AMORTECEDOR", "Amortecedor"), (r"PALHETA", "Palheta"), (r"^COXIM|^SUPORTE", "Coxim e suporte"),
]
def grupo_de(descricao, grupo_do_catalogo):
    for fonte in (sem_acento(descricao), sem_acento(grupo_do_catalogo)):
        for padrao, nome in GRUPOS:
            if re.search(padrao, fonte): return nome
    g = limpo(grupo_do_catalogo); return (g[:1].upper() + g[1:].lower()) if g else "Outros"
# Catálogo sem montadora (o Nakata completo traz só o nome do carro): a montadora vem dos outros catálogos quando o nome do carro é quase sempre de uma só
# (GOL → Volkswagen; 85% das aplicações). Nome dividido entre montadoras fica sem montadora: a tela então casa só pelo nome e pede conferência.
ALIAS = {"GENERAL": "CHEVROLET", "GM": "CHEVROLET", "VW": "VOLKSWAGEN"}
def chave_m(m):
    w = sem_acento(m).split(); w = w[0] if w else ""
    return ALIAS.get(w, w)
def prefixos(modelo):
    w = re.findall(r"[A-Z0-9]+", sem_acento(modelo)); return [" ".join(w[:2]), w[0]] if len(w) > 1 else w[:1]
donos, bonito = {}, {}
arquivos = sorted(glob.glob(os.path.join(pasta, "*.json")))
for arq in arquivos:
    for p in json.load(open(arq, encoding="utf-8"))["pecas"]:
        for a in p.get("apl", []):
            if not limpo(a["montadora"]): continue
            k = chave_m(a["montadora"]); bonito.setdefault(k, limpo(a["montadora"]).upper())
            for pre in prefixos(a["modelo"]): donos.setdefault(pre, {}); donos[pre][k] = donos[pre].get(k, 0) + 1
def montadora_de(a):
    if limpo(a["montadora"]): return limpo(a["montadora"]).upper()
    for pre in prefixos(a["modelo"]):
        v = donos.get(pre)
        if v and len(pre) > 2:
            k, n = max(v.items(), key=lambda kv: kv[1])
            if n >= .85 * sum(v.values()): return bonito[k]
    return ""
inferidas = 0
for arq in arquivos:
    j = json.load(open(arq, encoding="utf-8")); c = len(cats)
    # ano de referência do catálogo: o da edição ou, se ela não diz, o ano mais novo que aparece nas aplicações. Serve para a tela avisar
    # quando o carro é mais novo que o catálogo e a aplicação é "de tal ano em diante".
    m = re.search(r"(?:19|20)\d\d", j.get("edicao", "")); ref = int(m.group(0)) if m else max((int(a.get("de") or 0) for p in j["pecas"] for a in p.get("apl", [])), default=0)
    cats.append([j["marca"], j.get("edicao", ""), j.get("fotos", ""), ref])
    for p in j["pecas"]:
        # Só entra aplicação com intervalo de anos fechado (de X até Y). "De X em diante", "até X" e sem ano ficam de fora (decisão do Danilo, 16/11/2026):
        # peça sem nenhuma aplicação certa não entra no acervo.
        p = dict(p, apl=[a for a in p.get("apl", []) if int(a.get("de") or 0) and int(a.get("ate") or 0)])
        if not p["apl"]: continue
        n = len(pecas)
        pecas.append([c, p["codigo"], idx(grupos, grupo_de(p["descricao"], p.get("grupo"))), limpo(p["descricao"]).upper(), limpo(p.get("medidas")), p.get("foto") or "",
                      [limpo(x) for x in p.get("oem", []) if limpo(x)], [[limpo(a).upper() if len(limpo(a)) <= 3 else limpo(a), limpo(b)] for a, b in p.get("conv", []) if limpo(b)], 1 if p.get("breve") else 0, limpo(p.get("emb"))])
        for a in p["apl"]:
            mo = montadora_de(a); inferidas += (mo != "" and not limpo(a["montadora"]))
            apl.append([n, idx(mont, mo), dic(modelos, mod_i, limpo(a["modelo"]).upper()), int(a.get("de") or 0), int(a.get("ate") or 0), dic(obss, obs_i, limpo(a.get("obs")).upper())])
d = {"versao": datetime.date.today().isoformat(), "catalogos": cats, "montadoras": mont, "grupos": grupos, "pecas": pecas, "modelos": modelos, "obs": obss, "apl": apl}
cab = ("// Peças por veículo (pedido do Danilo em 15/11/2026). ARQUIVO GERADO por catalogo/gerar_pecas.py: não edite à mão.\n"
       "// Catálogos: " + ", ".join(f"{c[0]} {c[1]}".strip() for c in cats) + ". É dado de catálogo: a tela sempre manda conferir. Formato explicado em js/pecas.js.\n")
open(saida, "w", encoding="utf-8").write(cab + "export default " + json.dumps(d, ensure_ascii=False, separators=(",", ":")) + ";\n")
print(inferidas, "aplicações sem montadora receberam a dos outros catálogos")
print(len(pecas), "peças,", len(apl), "aplicações,", len(mont), "montadoras,", len(grupos), "grupos →", saida, os.path.getsize(saida) // 1024, "KB")
