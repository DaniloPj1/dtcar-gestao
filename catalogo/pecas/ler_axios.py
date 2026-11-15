# Leitor do catálogo AXIOS (PDF gerado pelo programa da Axios) → catalogo/pecas/axios.json + miniaturas das fotos.
# Uso: python3 -I catalogo/pecas/ler_axios.py <catalogo.pdf> catalogo/pecas/axios.json catalogo/fotos/axios
# O PDF não fica no repositório. Só a LINHA LEVE (carros, SUVs e caminhonetes: regra do Danilo); a linha pesada fica de fora.
# Como o PDF é montado (duas colunas por página): montadora no alto (16pt preto); modelo (12pt negrito); embalagem (10pt: PEÇA, PAR, 2 pçs);
# etiqueta do código (10pt negrito branco) com o código da montadora ao lado (8pt); descrição em português (8pt negrito), espanhol e
# inglês (itálico, ignorados); aplicações em cinza ("HB20 Aut/Man 12/19"); no fim, REFERÊNCIA CRUZADA (outras marcas).
import sys, re, json, hashlib, os, io
import pymupdf as fitz
from PIL import Image
pdf, saida = sys.argv[1], sys.argv[2]; pasta = sys.argv[3] if len(sys.argv) > 3 else None
d = fitz.open(pdf)
limpo = lambda t: re.sub(r'\s+', ' ', str(t or '')).strip()
def linhas(p):
    out = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            if not l['spans']: continue
            sp = l['spans'][0]; s = ''.join(x['text'] for x in l['spans'])
            if s.strip(): out.append(dict(x=l['bbox'][0], y=l['bbox'][1], x1=l['bbox'][2], y1=l['bbox'][3], tam=round(sp['size']), cor=sp['color'], f=sp['font'], t=limpo(s)))
    return out
def ano2(a):
    a = int(a); return 1900 + a if a >= 40 else 2000 + a
ANO = r'(?:(?:\d{2}\.)?((?:19|20)\d\d|\d{2})\.?|(\.{2,}|…))'
def aplicacao(montadora, t):
    """'HB20 Aut/Man 12/19', 'Jetta 2018/...', 'I30 13/…', 'Passat SEDAN 06.12/12.19', 'S10 2012 / 2013 Com calço' → modelo, de, ate, obs"""
    m = None
    for x in re.finditer(r'(?<![\d.,/])' + ANO + r'\s*/\s*' + ANO + r'(?![\d/,])', t):
        a, b = x.group(1), x.group(3)
        if not a and not b: continue
        ok = lambda v: v is None or (len(v) == 4) or True
        va = (int(a) if len(a) == 4 else ano2(a)) if a else 0; vb = (int(b) if len(b) == 4 else ano2(b)) if b else 0
        if (va and not 1950 <= va <= 2027) or (vb and not 1950 <= vb <= 2027) or (va and vb and vb < va): continue
        m = (x, va, vb); break
    if not m: return dict(montadora=montadora, modelo=t, de=0, ate=0, obs='')
    x, de, ate = m
    return dict(montadora=montadora, modelo=t[:x.start()].strip(' -'), de=de, ate=ate, obs=t[x.end():].strip(' -'))
pecas, fotos, n_pag = {}, {}, 0
for pn, p in enumerate(d):
    ls = linhas(p)
    if not any(l['tam'] == 16 and l['t'].startswith('LINHA LEVE') for l in ls): continue
    n_pag += 1
    mont = [l for l in ls if l['tam'] == 16 and l['cor'] == 0 and l['y'] < 70]; montadora = mont[0]['t'].upper() if mont else ''
    ims = [i for i in p.get_image_info(xrefs=True) if (i['bbox'][2] - i['bbox'][0]) < 120 and i['bbox'][1] > 60]
    for col in (0, 1):
        x0, x1 = (0, 297) if col == 0 else (297, 600)
        cl = sorted([l for l in ls if x0 <= l['x'] < x1 and 60 < l['y'] < 815], key=lambda l: (round(l['y']), l['x']))
        modelo, emb, it, itens = '', '', None, []
        for l in cl:
            if l['tam'] == 12 and 'Bold' in l['f']: modelo = l['t']; continue
            if l['tam'] == 10 and 'Bold' in l['f'] and l['cor'] == 0xffffff:
                it = dict(codigo=l['t'].replace(' ', ''), y=l['y'], x=l['x'], modelo=modelo, emb=emb, oem=[], desc=[], ap=[]); itens.append(it); emb = ''; continue
            if l['tam'] == 10 and 'Bold' not in l['f']: emb = l['t']; continue
            if not it or l['tam'] != 8: continue
            if l['cor'] == 0x5a5a5a: it['ap'].append((l['y'], l['t']))
            elif 'Italic' in l['f']: pass
            elif 'Bold' in l['f']: it['desc'].append(l['t'])
            elif abs(l['y'] - it['y']) < 6 and l['x'] > it['x'] + 40: it['oem'].append(l['t'])
        for k, it in enumerate(itens):
            yfim = itens[k + 1]['y'] if k + 1 < len(itens) else 830
            foto = ''
            for im in ims:
                bx = im['bbox']
                if x0 <= bx[0] < x1 and bx[0] < it['x'] and it['y'] - 4 <= bx[1] < yfim - 4:
                    try: e = d.extract_image(im['xref'])
                    except Exception: continue
                    h = hashlib.sha1(e['image']).hexdigest()[:16]; foto = h
                    if h not in fotos:
                        fotos[h] = 1
                        if pasta:
                            os.makedirs(pasta, exist_ok=True)
                            try:
                                im2 = Image.open(io.BytesIO(e['image']))
                                if im2.mode in ('RGBA', 'LA', 'P'):
                                    im2 = im2.convert('RGBA'); fundo = Image.new('RGB', im2.size, (255, 255, 255)); fundo.paste(im2, mask=im2.split()[-1]); im2 = fundo
                                im2 = im2.convert('RGB'); im2.thumbnail((640, 640)); im2.save(os.path.join(pasta, h + '.jpg'), 'JPEG', quality=76, optimize=True)
                            except Exception: foto = ''; del fotos[h]
                    break
            desc = limpo(' '.join(it['desc']))
            emb = limpo(it['emb']).lower().replace('pçs', 'peças').replace('pç', 'peça')
            j = pecas.setdefault(it['codigo'], dict(codigo=it['codigo'], grupo='', descricao=desc, medidas='', emb=emb, foto=foto, oem=[], conv=[], apl=[], pagina=pn + 1))
            if not j['foto'] and foto: j['foto'] = foto
            if len(desc) > len(j['descricao']): j['descricao'] = desc
            for o in it['oem']:
                for x in re.split(r'\s*[/;]\s*|\s{2,}', o):
                    x = limpo(x)
                    if x and x not in j['oem']: j['oem'].append(x)
            # linha de aplicação quebrada em duas (9 pt de distância; aplicações diferentes ficam a 12 pt ou mais): junta
            juntas = []
            for y, t in it['ap']:
                if juntas and y - juntas[-1][0] < 10.8: juntas[-1] = (y, juntas[-1][1] + ' ' + t)
                else: juntas.append((y, t))
            ult = None
            for _, a in juntas:
                ap = aplicacao(montadora, limpo(a))
                # "** observação" e linha sem ano que não começa pelo modelo: complemento da aplicação anterior
                if ult is not None and not ap['de'] and not ap['ate'] and (a.startswith('**') or not re.search(r'\btodos\b', a, re.I)):
                    ult['obs'] = limpo(ult['obs'] + ' ' + a.lstrip('* ')); continue
                if ap['modelo'].startswith('**'): ap['modelo'] = limpo(it['modelo'] + ' ' + ap['modelo'].lstrip('* '))
                if not ap['modelo']: ap['modelo'] = it['modelo']
                if ap in j['apl']: ult = j['apl'][j['apl'].index(ap)]; continue
                j['apl'].append(ap); ult = ap
# REFERÊNCIA CRUZADA: 1ª coluna = código Axios; as outras = a mesma peça em outras marcas (o nome da marca fica no cabeçalho de cada coluna)
n_conv = 0
for pn, p in enumerate(d):
    ls = linhas(p)
    if not any(l['tam'] == 16 and l['t'].startswith('REFERÊNCIA CRUZADA') for l in ls): continue
    cab = [l for l in ls if l['tam'] == 6 and l['t'] not in ('CÓDIGO', 'AXIOS', 'MONROE')]
    if not cab: continue
    cols = [((c['x'] + c['x1']) / 2, c['t'].title()) for c in cab]
    corpo = sorted([l for l in ls if l['tam'] == 7 and l['y'] > 108], key=lambda l: (round(l['y']), l['x']))
    for l in corpo:
        if l['x'] > 75: continue
        cod = l['t'].replace(' ', '')
        if cod not in pecas: continue
        for o in corpo:
            if o is l or abs(o['y'] - l['y']) > 3 or o['x'] <= 75: continue
            marca = min(cols, key=lambda c: abs(c[0] - (o['x'] + o['x1']) / 2))[1]
            if [marca, o['t']] not in pecas[cod]['conv']: pecas[cod]['conv'].append([marca, o['t']]); n_conv += 1
print(n_conv, 'conversões para outras marcas em', sum(1 for x in pecas.values() if x['conv']), 'peças')
json.dump(dict(marca='Axios', edicao='2026', fotos='axios', pecas=sorted(pecas.values(), key=lambda x: x['codigo'])), open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(n_pag, 'páginas da linha leve;', len(pecas), 'peças;', sum(len(x['apl']) for x in pecas.values()), 'aplicações;', sum(1 for x in pecas.values() if x['oem']), 'com código da montadora;',
      sum(1 for x in pecas.values() if x['foto']), 'com foto;', len(fotos), 'fotos')
