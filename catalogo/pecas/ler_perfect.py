# Leitor do catálogo PERFECT (PDF gerado pelo programa da Perfect) → catalogo/pecas/perfect.json + miniaturas das fotos.
# Uso: python3 -I catalogo/pecas/ler_perfect.py <catalogo.pdf> catalogo/pecas/perfect.json catalogo/fotos/perfect
# O PDF não fica no repositório (é grande e é da Perfect). Formato de saída: o comum dos catálogos de peças (ver catalogo/gerar_pecas.py).
# Como o PDF é montado: título da página (20pt) = grupo; rodapé = linha; tarja cinza (12pt) = montadora; etiqueta (10pt negrito branco) = código;
# texto colorido = aplicação (modelo e anos, separados por "|"); texto cinza = descrição e medidas; no fim, tabelas de CONVERSÕES.
import sys, re, json, hashlib, os
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]; pasta = sys.argv[3] if len(sys.argv) > 3 else None
d = fitz.open(pdf)
VERM = 0xe8234c
# a aplicação (modelo e ano) vem na cor da linha do catálogo (vermelho, azul, verde...); a descrição e as medidas vêm em cinza escuro
def colorido(c):
    r, g, b = (c >> 16) & 255, (c >> 8) & 255, c & 255; return max(r, g, b) - min(r, g, b) > 40
def linhas(p):
    out = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            if not l['spans']: continue
            sp = l['spans'][0]; s = ''.join(x['text'] for x in l['spans']).strip()
            if s: out.append(dict(x=l['bbox'][0], y=l['bbox'][1], x1=l['bbox'][2], y1=l['bbox'][3], tam=round(sp['size']), cor=sp['color'], negrito='Bold' in sp['font'], fonte=sp['font'], t=s))
    return out
def imagens(p):
    out = []
    for inf in p.get_image_info(xrefs=True):
        x0, y0, x1, y1 = inf['bbox']; out.append(dict(x=x0, y=y0, x1=x1, y1=y1, w=inf['width'], h=inf['height'], xref=inf['xref']))
    return out
pecas, convs, fotos = [], [], {}
for pn, p in enumerate(d):
    ls = linhas(p); tit = [l for l in ls if l['tam'] == 20]
    if not tit: continue
    familia = tit[0]['t']; rod = [l for l in ls if l['tam'] == 11 and l['negrito'] and l['y'] > 800]; linha = rod[0]['t'] if rod else ''
    if familia.startswith('CONVERS'):
        cab = [l for l in ls if l['tam'] == 8 and l['cor'] == 0xffffff and 70 < l['y'] < 95]
        if not cab: continue
        cols = [((c['x'] + c['x1']) / 2, c['t']) for c in sorted(cab, key=lambda c: c['x'])]
        corpo = sorted([l for l in ls if l['tam'] == 7], key=lambda l: (l['y'], l['x']))
        def col(l):
            cx = (l['x'] + l['x1']) / 2; return min(cols, key=lambda c: abs(c[0] - cx))[1]
        inicio = sorted(set(round(l['y']) for l in corpo if col(l) == 'MONTADORA'))
        for i, y0 in enumerate(inicio):
            y1 = inicio[i + 1] if i + 1 < len(inicio) else 10000
            r = {}
            for l in corpo:
                if y0 - 2 <= l['y'] < y1 - 2: r.setdefault(col(l), []).append(l['t'])
            convs.append(dict(pagina=pn + 1, familia=linha, cel=r))
        continue
    bandas = sorted([l for l in ls if l['tam'] == 12 and l['cor'] == 0xffffff], key=lambda l: l['y'])
    cods = sorted([l for l in ls if l['tam'] == 10 and l['negrito'] and l['cor'] == 0xffffff], key=lambda l: (l['y'], l['x']))
    txt = [l for l in ls if l['tam'] in (7, 8, 9) and l['y'] < 800 and l not in cods]
    ims = [i for i in imagens(p) if not (i['w'] == 1000 or (i['w'] == 743 and i['h'] == 107)) and (i['x1'] - i['x']) < 250]
    itens = []
    for c in cods:
        m = [b for b in bandas if b['y'] <= c['y'] + 2]
        itens.append(dict(codigo=c['t'].replace(' ', ''), x=c['x'], y=c['y'], montadora=m[-1]['t'] if m else '', ap=[], ds=[], foto=None))
    def dono(x, y):
        c = [i for i in itens if abs(i['x'] - x) < 40 and i['y'] <= y + 2]
        return max(c, key=lambda i: i['y']) if c else None
    for l in sorted(txt, key=lambda l: (l['y'], l['x'])):
        it = dono(l['x'], l['y'])
        if not it: continue
        (it['ap'] if colorido(l['cor']) else it['ds']).append(l['t'])
    for im in ims:
        cy = (im['y'] + im['y1']) / 2
        c = [i for i in itens if i['x'] >= im['x1'] - 15 and i['x'] - im['x1'] < 60 and i['y'] - 15 <= cy <= i['y'] + 110]
        if not c: continue
        it = min(c, key=lambda i: abs((i['y'] + 40) - cy))
        if it['foto']: continue
        try:
            e = d.extract_image(im['xref']); h = hashlib.sha1(e['image']).hexdigest()[:16]
        except Exception: continue
        it['foto'] = h
        if h not in fotos:
            fotos[h] = dict(ext=e['ext'], bytes=len(e['image']), w=e['width'], h=e['height'])
            if pasta:
                os.makedirs(pasta, exist_ok=True); open(os.path.join(pasta, h + '.' + e['ext']), 'wb').write(e['image'])
    for it in itens:
        pecas.append(dict(codigo=it['codigo'], linha=linha, familia=familia, montadora=it['montadora'], aplicacao=re.sub(r'\s+', ' ', ' '.join(it['ap'])).strip(),
                          descricao=it['ds'], foto=it['foto'], pagina=pn + 1))

import io
from PIL import Image
def miniatura(h):
    f = fotos[h]; orig = os.path.join(pasta, h + '.' + f['ext'])
    im = Image.open(orig)
    if im.mode in ('RGBA', 'LA', 'P'):
        im = im.convert('RGBA'); fundo = Image.new('RGB', im.size, (255, 255, 255)); fundo.paste(im, mask=im.split()[-1]); im = fundo
    im = im.convert('RGB'); im.thumbnail((640, 640)); im.save(os.path.join(pasta, h + '.jpg'), 'JPEG', quality=76, optimize=True)
    if f['ext'] != 'jpg' and os.path.exists(orig): os.remove(orig)
if pasta:
    for h in fotos: miniatura(h)
limpo = lambda t: re.sub(r'\s+', ' ', str(t or '')).strip()
def aplicacoes(montadora, texto):
    out = []
    for a in [limpo(x) for x in texto.split('|') if limpo(x)]:
        m = re.search(r'((?:19|20)\d\d)\s*/\s*((?:19|20)\d\d)', a) or re.search(r'((?:19|20)\d\d)\s*/?\s*(\.\.\.)?', a)
        if not m: out.append(dict(montadora=montadora, modelo=a, de=0, ate=0, obs='')); continue
        de = int(m.group(1)); ate = int(m.group(2)) if m.group(2) and m.group(2).isdigit() else 0
        out.append(dict(montadora=montadora, modelo=a[:m.start()].strip(' -'), de=de, ate=ate, obs=a[m.end():].strip(' -')))
    return out
# conversões por código Perfect: OEM (código da montadora) e outras marcas
conv = {}
for c in convs:
    cel = c['cel']
    for k in cel.get('CÓD. INTERNO', []):
        d0 = conv.setdefault(k.replace(' ', ''), dict(oem=[], conv=[]))
        for col, vals in cel.items():
            if col in ('MONTADORA', 'CÓD. INTERNO'): continue
            for v in vals:
                v = limpo(v).strip('*').strip()
                if not v or v in ('-', '--'): continue
                if col == 'OEM':
                    v = re.sub(r'^PART\s*-\s*', '', v)
                    for x in (v.split() if re.fullmatch(r'[\dA-Z.\-]+( [\dA-Z.\-]+)+', v) and all(len(y) >= 5 for y in v.split()) else [v]):
                        if x not in d0['oem']: d0['oem'].append(x)
                elif [col.title(), v] not in d0['conv']: d0['conv'].append([col.title(), v])
junt = {}
for p in pecas:
    j = junt.get(p['codigo'])
    ds = [limpo(x) for x in p['descricao'] if limpo(x)]
    # a descrição pode quebrar em duas linhas; medidas são as linhas com número e unidade/medida
    eh_med = lambda t: bool(re.search(r'\d', t)) and bool(re.search(r'MM|DENTES|FUROS|Ø|M\d+X|DIÂMETRO|COMPR|ELO|ESTRIAS|POL', t.upper()))
    desc = ' '.join(t for t in ds if not eh_med(t)); med = ' · '.join(t for t in ds if eh_med(t))
    breve = 'EM BREVE' in desc.upper(); desc = limpo(re.sub(r'\(?\s*EM\s+BREVE\s*\)?', '', desc, flags=re.I))
    if not j:
        c = conv.get(p['codigo'], dict(oem=[], conv=[]))
        j = junt[p['codigo']] = dict(codigo=p['codigo'], grupo=p['familia'].title(), linha=p['linha'].title(), descricao=desc.upper(), medidas=med, foto=p['foto'] or '',
                                    oem=c['oem'], conv=c['conv'], breve=breve, pagina=p['pagina'], apl=[])
    if not j['foto'] and p['foto']: j['foto'] = p['foto']
    for a in aplicacoes(p['montadora'].upper(), p['aplicacao']):
        if a not in j['apl']: j['apl'].append(a)
saida_d = dict(marca='Perfect', edicao='2026-11', fotos='perfect', pecas=sorted(junt.values(), key=lambda x: x['codigo']))
json.dump(saida_d, open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(junt), 'peças;', sum(len(x['apl']) for x in junt.values()), 'aplicações;', sum(1 for x in junt.values() if x['oem']), 'com código da montadora;',
      sum(1 for x in junt.values() if x['conv']), 'com outras marcas;', sum(1 for x in junt.values() if x['foto']), 'com foto;', len(fotos), 'fotos')
