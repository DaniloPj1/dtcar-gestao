# Regenera a lista de arquivos do programa guardados para uso offline (sw.js). Rode depois de criar arquivos.
# Uso: python3 tools_sw.py [nova-versao]   (sem argumento, só soma 1 na versão)
import re, glob, sys, hashlib, json
s = open("sw.js", encoding="utf-8").read()
arqs = ["./", "index.html", "manifest.webmanifest"] + sorted(glob.glob("css/*.css")) + sorted(glob.glob("icons/*.png") + glob.glob("icons/*.jpg")) \
    + sorted(glob.glob("js/*.js")) + sorted(glob.glob("js/telas/*.js")) + sorted(glob.glob("vendor/**/*.js", recursive=True))
s = re.sub(r"const ARQUIVOS = \[.*?\];", "const ARQUIVOS = [" + ", ".join('"%s"' % a.replace("\\", "/") for a in arqs) + "];", s, flags=re.S)
v = int(re.search(r"dtcar-v(\d+)", s).group(1))
s = re.sub(r"dtcar-v\d+", "dtcar-v%d" % (int(sys.argv[1]) if len(sys.argv) > 1 else v + 1), s)
# conferência do programa para Windows: o que ele baixa do site tem que ser exatamente o que foi publicado
hashes = {a.replace("\\", "/"): hashlib.sha256(open(a, "rb").read()).hexdigest() for a in arqs if a != "./"}
s = re.sub(r"\n// integridade[^\n]*\nconst INTEGRIDADE = [^\n]*;\n?", "\n", s).rstrip("\n") + "\n"
s += "// integridade dos arquivos (usada pelo programa para Windows ao baixar as telas novas)\nconst INTEGRIDADE = " + json.dumps(hashes, ensure_ascii=False) + ";\n"
open("sw.js", "w", encoding="utf-8").write(s)
print(re.search(r"dtcar-v\d+", s).group(0), len(arqs), "arquivos")
