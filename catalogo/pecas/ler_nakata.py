# Leitor dos catálogos completos no formato "Gerado em" (Nakata, Fremax, Lonaflex, Fras-le, Controil: mesmo sistema, mesmo layout) → catalogo/pecas/<marca>.json + fotos
# Uso: python3 -I catalogo/pecas/ler_nakata.py <catalogo.pdf> catalogo/pecas/nakata.json catalogo/fotos/nakata [Marca]   (Marca padrão: Nakata)
# Partes do PDF: aplicações (tabela Veículo/Modelo/Motor/Ano/Grupo/Produto/Obs, células mescladas), referências cruzadas
# (seções por marca: código da outra marca → código Nakata), imagens (8 por página, legenda = código) e especificações (embalagem etc.).
import sys, re, json, os, hashlib, io
import pymupdf as fitz
from PIL import Image
pdf, saida, pasta_fotos = sys.argv[1], sys.argv[2], sys.argv[3]
MARCA = sys.argv[4] if len(sys.argv) > 4 else 'Nakata'
PASTA = os.path.basename(pasta_fotos.rstrip('/'))
d = fitz.open(pdf)
limpo = lambda t: re.sub(r'\s+', ' ', str(t or '')).strip()
cod = lambda t: re.sub(r'\s+', ' ', t).strip()
def secoes():
    ap = ref = img = esp = None
    for i in range(len(d)):
        t = d[i].get_text()[:80]
        if ap is None and t.startswith('Veículo'): ap = i
        if ref is None and t.startswith('Código Equivalente'): ref = i
        if esp is None and ref and ('Partnumber' in t or 'Código do Produto' in t) and 'Especifica' in t: esp = i
    return ap, ref, esp
AP, REF, ESP = secoes()
# imagens: primeira página depois das referências cuja página tem fotos
IMG = next((i for i in range(REF, len(d)) if not d[i].get_text().startswith('Código Equivalente')), len(d))
if ESP is None: ESP = len(d)
IMG = min(IMG, ESP)
print('aplicações', AP, 'refs', REF, 'imagens', IMG, 'specs', ESP, flush=True)

# ---------- aplicações ----------
COLS = [54.0, 129.7, 210.3, 291.0, 340.4, 415.9, 475.7, 541.0]  # veículo, modelo, motor, ano, grupo, produto, obs
def coluna(x):
    for c in range(7):
        if COLS[c] <= x < COLS[c + 1]: return c
    return None
def linhas_h(p):
    ys = [[] for _ in range(7)]
    for g in p.get_drawings():
        for it in g['items']:
            if it[0] == 'l' and abs(it[1].y - it[2].y) < .3:
                x0, x1, y = min(it[1].x, it[2].x), max(it[1].x, it[2].x), it[1].y
                if y < 106: continue
                for c in range(7):
                    ov = min(x1, COLS[c + 1]) - max(x0, COLS[c])
                    if ov > .6 * (COLS[c + 1] - COLS[c]): ys[c].append(y)
    out = []
    for l in ys:
        l = sorted(l); r = []
        for y in l:
            if not r or y - r[-1] > 1.2: r.append(y)
        if not r or r[0] > 109: r.insert(0, 108.0)
        elif r[0] < 109: r[0] = 108.0
        out.append(r)
    return out
def ler_pagina(p):
    spans = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            t = limpo(''.join(s['text'] for s in l['spans']))
            x0, y0, x1, y1 = l['bbox']
            if t and y0 > 108 and y0 < 810: spans.append((t, (x0 + x1) / 2, (y0 + y1) / 2))
    ys = linhas_h(p)
    cel = lambda c, y: next((k for k in range(len(ys[c]) - 1) if ys[c][k] <= y < ys[c][k + 1]), None)
    textos = {}
    for t, x, y in spans:
        c = coluna(x)
        if c is None: continue
        k = cel(c, y)
        if k is None: continue
        textos.setdefault((c, k), []).append((y, x, t))
    linhas = []
    pc = ys[5]
    for k in range(len(pc) - 1):
        y0, y1 = pc[k], pc[k + 1]; ym = (y0 + y1) / 2
        row = [None] * 7
        for c in range(7):
            kk = cel(c, ym)
            row[c] = ' '.join(t for _, _, t in sorted(textos.get((c, kk), []))) if kk is not None else ''
        linhas.append(row)
    return linhas
def ano_faixa(t):
    m = re.match(r'^(\d{4})\s*/\s*(\d{4})$', t)
    if m: return int(m.group(1)), int(m.group(2))
    m = re.match(r'^(\d{4})', t)
    return (int(m.group(1)), 0) if m else (0, 0)
pecas = {}
ant = ['', '', '', '']
for i in range(AP, REF):
    for row in ler_pagina(d[i]):
        veic, mod, mot, ano, grupo, prod, obs = [limpo(x) for x in row]
        if not prod: continue
        cur = [veic, mod, mot, ano]
        # célula mesclada que começou na página anterior: só herda quando o que está à esquerda é o mesmo
        for c in range(4):
            if not cur[c] and all(cur[k] == ant[k] for k in range(c)): cur[c] = ant[c]
        ant = cur[:]
        veic, mod, mot, ano = cur
        de, ate = ano_faixa(ano)
        # o PDF não traz a montadora: "Veículo" é o nome do carro (106, Meriva, Gol) e "Modelo" a versão
        veic = '' if veic == '-' else veic; mod = '' if mod == '-' else mod
        cil = re.search(r'\b(\d\.\d)\s*L\b', mot)
        modelo = limpo(veic + ' ' + mod + (' ' + cil.group(1) if cil and cil.group(1) not in (veic + ' ' + mod) else ''))
        j = pecas.setdefault(cod(prod), dict(codigo=cod(prod), grupo=grupo, descricao=grupo, medidas='', foto='', oem=[], conv=[], apl=[]))
        if grupo and not j['grupo']: j['grupo'] = j['descricao'] = grupo
        a = dict(montadora='', modelo=modelo, de=de, ate=ate, obs=obs)
        if modelo and a not in j['apl']: j['apl'].append(a)
    if (i - AP) % 500 == 0: print('aplicações pág', i, len(pecas), flush=True)
print(len(pecas), 'peças com aplicação', flush=True)

# ---------- referências cruzadas ----------
# seção "MARCA" → linhas (código equivalente | NAKATA | código Nakata). "X ORIGINAL" = código da montadora (oem).
brev_ok = bad = 0
MP = 'NAKATA'
_t0 = [limpo(x) for x in d[REF].get_text().split('\n') if limpo(x)]
if 'Código' in _t0 and _t0.index('Código') + 2 < len(_t0): MP = _t0[_t0.index('Código') + 2]
print('marca nas referências:', MP, flush=True)
for i in range(REF, IMG):
    t = [limpo(x) for x in d[i].get_text().split('\n')]
    t = [x for x in t if x]
    marca = None; k = 0
    while k < len(t):
        if k + 2 < len(t) and t[k + 1] == 'Marca' and t[k + 2] == 'Código':
            marca = t[k]; k += 3; continue
        if t[k] in ('Código Equivalente', 'Referência'): k += 1; continue
        if marca and k + 2 < len(t) and t[k + 1] == MP:
            eq, nk = t[k], t[k + 2]; k += 3
            j = pecas.get(nk)
            if j is None: bad += 1; continue
            brev_ok += 1
            if marca.endswith(' ORIGINAL') or marca in ('ORIGINAL', 'ORIGINAL OEM'):
                if eq not in j['oem']: j['oem'].append(eq)
            else:
                par = [(marca if len(marca) <= 3 else marca.title()) if marca.isupper() else marca, eq]
                if par not in j['conv']: j['conv'].append(par)
            continue
        k += 1
print('referências', brev_ok, 'sem peça:', bad, flush=True)

# ---------- fotos ----------
os.makedirs(pasta_fotos, exist_ok=True)
vistos = {}
def miniatura(xref):
    ex = d.extract_image(xref); im = Image.open(io.BytesIO(ex['image']))
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA'); fundo = Image.new('RGB', im.size, 'white'); fundo.paste(im, mask=im.split()[3]); im = fundo
    else: im = im.convert('RGB')
    from PIL import ImageChops
    caixa = ImageChops.difference(im, Image.new('RGB', im.size, (255, 255, 255))).point(lambda v: 255 if v > 18 else 0).getbbox()
    if caixa:
        m = int(max(im.size) * .03); caixa = (max(0, caixa[0] - m), max(0, caixa[1] - m), min(im.width, caixa[2] + m), min(im.height, caixa[3] + m))
        im = im.crop(caixa)
    im.thumbnail((340, 340), Image.LANCZOS)
    b = io.BytesIO(); im.save(b, 'JPEG', quality=58, optimize=True, progressive=True)
    return b.getvalue()
com_foto = 0
for i in range(IMG, ESP):
    p = d[i]
    legendas = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            t = cod(''.join(s['text'] for s in l['spans']))
            if t and l['bbox'][1] > 90 and l['bbox'][1] < 800 and not re.fullmatch(r'\d{4}', t): legendas.append((t, l['bbox'][0], l['bbox'][1]))
    for im in p.get_image_info(xrefs=True):
        x0, y0, x1, y1 = im['bbox']
        if y1 - y0 > 200 or x1 - x0 > 300 or not im['xref']: continue
        cand = [(y - y1, t) for t, x, y in legendas if y >= y1 - 2 and abs(x - x0) < 40 and t in pecas]
        if not cand: continue
        t = min(cand)[1]
        j = pecas[t]
        if j['foto']: continue
        dados = miniatura(im['xref']); h = hashlib.sha1(dados).hexdigest()[:16]
        if h not in vistos:
            open(os.path.join(pasta_fotos, h + '.jpg'), 'wb').write(dados); vistos[h] = 1
        j['foto'] = h; com_foto += 1
    if (i - IMG) % 100 == 0: print('fotos pág', i, com_foto, flush=True)
print(com_foto, 'peças com foto;', len(vistos), 'arquivos', flush=True)

# ---------- especificações ----------
SCOLS = [54.0, 171.0, 360.0, 541.0]
def ler_spec(p):
    spans = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            t = limpo(''.join(s['text'] for s in l['spans'])); x0, y0, x1, y1 = l['bbox']
            if t and y0 > 112 and y0 < 810: spans.append((t, (x0 + x1) / 2, (y0 + y1) / 2))
    ys = [[], [], []]
    for g in p.get_drawings():
        for it in g['items']:
            if it[0] == 'l' and abs(it[1].y - it[2].y) < .3 and it[1].y > 106:
                x0, x1, y = min(it[1].x, it[2].x), max(it[1].x, it[2].x), it[1].y
                for c in range(3):
                    if min(x1, SCOLS[c + 1]) - max(x0, SCOLS[c]) > .6 * (SCOLS[c + 1] - SCOLS[c]): ys[c].append(y)
    cols = []
    for l in ys:
        r = []
        for y in sorted(l):
            if not r or y - r[-1] > 1.2: r.append(y)
        if not r or r[0] > 114: r.insert(0, 112.0)
        cols.append(r)
    cel = lambda c, y: next((k for k in range(len(cols[c]) - 1) if cols[c][k] <= y < cols[c][k + 1]), None)
    tx = {}
    for t, x, y in spans:
        c = next((c for c in range(3) if SCOLS[c] <= x < SCOLS[c + 1]), None)
        if c is None: continue
        k = cel(c, y)
        if k is not None: tx.setdefault((c, k), []).append((y, x, t))
    out = []
    for k in range(len(cols[1]) - 1):
        ym = (cols[1][k] + cols[1][k + 1]) / 2
        v = [' '.join(t for _, _, t in sorted(tx.get((c, cel(c, ym)), []))) if cel(c, ym) is not None else '' for c in range(3)]
        out.append([limpo(x) for x in v])
    return out
specs = {}; atual = ''
for i in range(ESP, len(d)):
    for part, chave, valor in ler_spec(d[i]):
        if part and part not in ('Partnumber', 'Código do Produto'): atual = cod(part)
        if not chave or chave in ('Especificação',) or not atual: continue
        specs.setdefault(atual, []).append((chave, valor))
    if (i - ESP) % 500 == 0: print('specs pág', i, len(specs), flush=True)
print(len(specs), 'peças com especificação', flush=True)
json.dump({k: v for k, v in specs.items()}, open(saida + '.specs.json', 'w', encoding='utf-8'), ensure_ascii=False)
CH = {c.lower(): c for c in ['Altura da embalagem', 'Largura da embalagem', 'Comprimento da embalagem']}
PULA = ('posição', 'lado', 'composição', 'código de barras', 'ncm', 'quantidade de peças por embalagem', 'altura da embalagem', 'largura da embalagem', 'comprimento da embalagem')
num = lambda t: re.sub(r'\s*mm$', '', t.replace(',0 ', ' ')).strip()
for cd, ls in specs.items():
    j = pecas.get(cd)
    if not j: continue
    dic = {}
    for k, v in ls: dic.setdefault(k.lower(), v)
    partes = []
    info = dic.get('informações adicionais')
    if info: partes.append(info.capitalize() if info.isupper() else info)
    for k, v in ls:
        kl = k.lower()
        if kl.startswith(PULA) or kl == 'informações adicionais' or not v: continue
        partes.append(k + ': ' + v)
    dims = [dic.get(x.lower()) for x in ('Altura da embalagem', 'Largura da embalagem', 'Comprimento da embalagem')]
    if all(dims): partes.append('Embalagem (A×L×C): ' + ' × '.join(num(x) for x in dims) + ' mm')
    j['medidas'] = ' · '.join(partes)
    q = dic.get('quantidade de peças por embalagem')
    if q: j['emb'] = q + (' peça' if q == '1' else ' peças')
    # posição e lado distinguem as peças do mesmo grupo na lista
    pos = dic.get('posição', ''); lado = dic.get('lado', '')
    lado = lado.replace('DIREITO / ESQUERDO', 'LD/LE').replace('ESQUERDO / DIREITO', 'LD/LE').replace('DIREITO', 'LD').replace('ESQUERDO', 'LE')
    pos = pos.replace(' / ', '/').capitalize() if pos else ''
    j['descricao'] = limpo(j['descricao'] + ' ' + pos + ' ' + lado + (' - ' + info.capitalize() if info and len(info) <= 45 and info.upper() not in j['descricao'].upper() else ''))

lista = sorted((j for j in pecas.values() if j['apl']), key=lambda x: x['codigo'])
json.dump(dict(marca=MARCA, edicao='catálogo completo (nov/2026)', fotos=PASTA if any(x['foto'] for x in lista) else '', pecas=lista), open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(lista), 'peças;', sum(len(x['apl']) for x in lista), 'aplicações;', sum(1 for x in lista if x['foto']), 'com foto;', sum(1 for x in lista if x['conv']), 'com conversão;', sum(1 for x in lista if x['oem']), 'com código da montadora;', sum(1 for x in lista if x['medidas']), 'com medidas')
