# Leitor do catálogo FRAS-LE | LONAFLEX "Aplicação Geral" (PDF) → catalogo/pecas/frasle.json + desenhos das pastilhas.
# Uso: python3 -I catalogo/pecas/ler_frasle.py <catalogo.pdf> catalogo/pecas/frasle.json catalogo/fotos/frasle
# Só carros, SUVs, caminhonetes e utilitários leves. Os desenhos das pastilhas (com as medidas) viram a foto; a tabela de conversão vira o botão Conversão.
# Páginas "Aplicações": tabela Marca/Modelo | Ano | Dianteira (Fras-le, Lonaflex, Sistema) | Traseira (idem) | Obs. A tarja (12pt branco) é a montadora.
import sys, re, json, os
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]; pasta = sys.argv[3] if len(sys.argv) > 3 else None
d = fitz.open(pdf)
limpo = lambda t: re.sub(r'\s+', ' ', str(t or '').replace('\xa0', ' ')).strip()
def linhas(p):
    out = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            if not l['spans']: continue
            sp = l['spans'][0]; s = limpo(''.join(x['text'] for x in l['spans']))
            if s: out.append(dict(x=l['bbox'][0], y=l['bbox'][1], x1=l['bbox'][2], tam=sp['size'], cor=sp['color'], f=sp['font'], t=s))
    return out
def ano2(a):
    a = int(a); return 1900 + a if a >= 30 else 2000 + a
linhas_apl = []; montadora = ''
for pn, p in enumerate(d):
    ls = linhas(p)
    if not any(l['t'] == 'Aplicações' and l['y'] < 80 for l in ls): continue
    corpo = sorted([l for l in ls if l['y'] > 130], key=lambda l: (round(l['y']), l['x']))
    ys = []
    for l in corpo:
        if round(l['tam']) == 12 and l['cor'] == 0xffffff: ys.append(('M', l['y'], limpo(re.sub(r'\(continuação\)', '', l['t'])).upper())); continue
        if l['tam'] > 7.5: continue
        if not ys or ys[-1][0] == 'M' or abs(l['y'] - ys[-1][1]) > 4: ys.append(('L', l['y'], []))
        ys[-1][2].append(l)
    # colunas pela posição do cabeçalho desta página (as páginas pares e ímpares têm margens diferentes)
    cab = [l for l in ls if l['y'] < 130 and l['cor'] == 0xffffff]
    fl = sorted([l for l in cab if l['t'] in ('Fras-le', 'Lonaflex')], key=lambda l: l['x'])
    ano = [l for l in cab if l['t'] == 'Ano']; sis = sorted([l for l in cab if l['t'] == 'Sistema'], key=lambda l: l['x'])
    if len(fl) < 6 or not ano or len(sis) < 2: continue
    cx = lambda l: (l['x'] + l['x1']) / 2
    cols = [('ano', cx(ano[0])), ('df', cx(fl[0])), ('dl', cx(fl[1])), ('ds', cx(sis[0])), ('tf', cx(fl[2])), ('tl', cx(fl[3])), ('ts', cx(sis[1])), ('of', cx(fl[4])), ('ol', cx(fl[5]))]
    lim_modelo = ano[0]['x'] - 22
    for tipo, y, v in ys:
        if tipo == 'M': montadora = v; continue
        r = dict(montadora=montadora, modelo='', ano='', df=[], dl=[], ds='', tf=[], tl=[], ts='', obs=[], pagina=pn + 1)
        for l in v:
            if l['x'] < lim_modelo and l['x1'] < cols[1][1] - 10: r['modelo'] = limpo(r['modelo'] + ' ' + l['t']); continue
            k = min(cols, key=lambda c: abs(c[1] - cx(l)))[0]
            if k in ('ano', 'ds', 'ts'): r[k] = limpo(r[k] + ' ' + l['t'])
            elif k in ('of', 'ol'): r['obs'].append(l['t'])
            else: r[k].append(l['t'])
        linhas_apl.append(r)
# linha sem modelo (só códigos) continua o modelo e o ano da linha de cima
ult = None
for r in linhas_apl:
    if not r['modelo'] and ult and ult['montadora'] == r['montadora']: r['modelo'] = ult['modelo']; r['ano'] = r['ano'] or ult['ano']
    if r['modelo']: ult = r
def periodo(t):
    """'00 / 03', '01 /', '07-09 /' (mês-ano), '92 / 07-10', '/ 05', '01', 'Todos'"""
    t = limpo(t); A = r'(?:\d{2}-)?(\d{2})'
    m = re.match(r'^' + A + r'\s*/\s*(?:' + A + r')?$', t)
    if m: return ano2(m.group(1)), (ano2(m.group(2)) if m.group(2) else 0)
    m = re.match(r'^/\s*' + A + r'$', t)
    if m: return 0, ano2(m.group(1))
    m = re.match(r'^' + A + r'$', t)
    if m: return ano2(m.group(1)), ano2(m.group(1))
    return 0, 0
# só carros, SUVs, caminhonetes e utilitários leves (regra do Danilo): fabricantes só de caminhão, ônibus, implemento e trator ficam de fora
FORA = set("""SCANIA AGRALE CLARK GUERRA RANDON WABCO CATERPILLAR CUMMINS INTERNACIONAL TEREX IDEROL MARCOPOLO MAN METALPI RODOVIÁRIA DRESSER SINOTRUK SCHIFFER
VALMET CONTIN DAF GOTTI GRAHL KRONE MARINGÁ NOMA PASTRE ROSSETTI BISELLI CASE FACHINI GOLIVE MAFERSA MASSARI RECRUSUL ANTONINI HUBER-WARCO MASSEY-FERGUSON MINUANO FOTON""".split())
def tipo(cod):
    c = cod.upper()
    if c.startswith('PD/'): return 'PASTILHA DE FREIO'
    if re.search(r'-CPA?\b|-CP$|-T$', c): return 'SAPATA DE FREIO COM LONA'
    return 'LONA DE FREIO'
pecas = {}
for r in linhas_apl:
    if not r['modelo'] or r['montadora'] in FORA or r['montadora'].startswith(('ENGESA', 'OTTO', 'FNM')): continue
    de, ate = periodo(r['ano']); obs_l = limpo(' '.join(dict.fromkeys(r['obs'])))
    for cods, lona, sistema, pos in ((r['df'], r['dl'], r['ds'], 'Dianteira'), (r['tf'], r['tl'], r['ts'], 'Traseira')):
        for c in cods:
            c = limpo(c).rstrip('-')
            if not re.match(r'^[A-Z]{1,3}/\d', c): continue
            j = pecas.setdefault(c, dict(codigo=c, grupo='', descricao=tipo(c), medidas='', foto='', oem=[], conv=[], apl=[], pos=set()))
            j['pos'].add(pos)
            for l in lona:
                l = limpo(l)
                if re.match(r'^[A-Z]-?\d', l) and ['Lonaflex', l] not in j['conv']: j['conv'].append(['Lonaflex', l])
            a = dict(montadora=r['montadora'], modelo=r['modelo'], de=de, ate=ate, obs=limpo(' - '.join(x for x in (pos, ('sistema ' + sistema) if sistema else '', obs_l) if x)))
            if a not in j['apl']: j['apl'].append(a)
for j in pecas.values():
    if len(j['pos']) == 1: j['descricao'] += ' ' + next(iter(j['pos'])).upper()
    del j['pos']
# Desenhos das pastilhas: título (14pt) = código; texto pequeno ao lado = o que vem na caixa; o desenho com as medidas vira a "foto"
n_des = 0
for pn, p in enumerate(d):
    ls = linhas(p)
    if not any(l['t'].startswith('Desenhos') and l['y'] < 80 for l in ls): continue
    tit = sorted([l for l in ls if round(l['tam']) == 14 and re.match(r'^[A-Z]{1,3}/\d', l['t'])], key=lambda l: (l['y'], l['x']))
    larg = p.rect.width; meio = larg / 2
    for t in tit:
        col = 0 if t['x'] < meio - 20 else 1
        abaixo = [o['y'] for o in tit if o['y'] > t['y'] + 20 and ((o['x'] < meio - 20) == (col == 0))]
        y1 = min(abaixo) - 4 if abaixo else p.rect.height - 40
        x0, x1 = (20, meio - 4) if col == 0 else (meio - 4, larg - 20)
        # desenho que ocupa a largura toda (só um título na faixa): usa a página inteira
        if not any(abs(o['y'] - t['y']) < 20 and o is not t for o in tit) and col == 0 and any(l['x'] > meio + 30 and t['y'] < l['y'] < y1 and round(l['tam']) == 7 for l in ls): x1 = larg - 20
        cod = limpo(t['t'])
        if cod not in pecas: continue
        comp = [l['t'] for l in ls if round(l['tam']) == 6 and t['y'] - 4 <= l['y'] < t['y'] + 22 and x0 <= l['x'] < x1]
        j = pecas[cod]
        if comp and not j['medidas']: j['medidas'] = 'Na caixa: ' + ' + '.join(limpo(x) for x in comp)
        if pasta and not j['foto']:
            os.makedirs(pasta, exist_ok=True); nome = re.sub(r'[^A-Za-z0-9]+', '-', cod).lower()
            pm = p.get_pixmap(clip=fitz.Rect(x0, t['y'] - 6, x1, y1), dpi=170)
            from PIL import Image
            im = Image.frombytes('RGB', (pm.width, pm.height), pm.samples); im.thumbnail((900, 900)); im.save(os.path.join(pasta, nome + '.jpg'), 'JPEG', quality=70, optimize=True)
            j['foto'] = nome; n_des += 1
# Tabela de conversão das pastilhas: código de outra marca (coluna com o nome da marca no cabeçalho) ↔ Fras-le (negrito PD/...)
n_conv = 0
for pn, p in enumerate(d):
    ls = linhas(p)
    if not any(l['t'].startswith('Tabela de Conversão') and l['y'] < 80 for l in ls): continue
    cab = [l for l in ls if l['y'] < 135 and 'Bold' in l['f'] and l['t'] not in ('APLICADO', 'NAS MARCAS', 'FRAS-LE', 'LONAFLEX') and not l['t'].startswith(('APLIC', 'NAS'))]
    for c in cab:
        marca = c['t'].title(); cxm = (c['x'] + c['x1']) / 2
        for l in ls:
            if l['y'] < 135 or 'Bold' in l['f'] or abs((l['x'] + l['x1']) / 2 - cxm) > 22: continue
            fr = [o for o in ls if 'Bold' in o['f'] and abs(o['y'] - l['y']) < 4 and 0 < o['x'] - l['x1'] < 60 and o['t'].startswith('PD/')]
            if fr and limpo(fr[0]['t']) in pecas and [marca, l['t']] not in pecas[limpo(fr[0]['t'])]['conv']: pecas[limpo(fr[0]['t'])]['conv'].append([marca, l['t']]); n_conv += 1
json.dump(dict(marca='Fras-le', edicao='aplicação geral', fotos='frasle', pecas=sorted(pecas.values(), key=lambda x: x['codigo'])), open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
import collections
print(len(pecas), 'peças;', sum(len(x['apl']) for x in pecas.values()), 'aplicações;', collections.Counter(x['descricao'].split(' DIANT')[0].split(' TRAS')[0] for x in pecas.values()).most_common(),
      ';', n_des, 'desenhos;', sum(1 for x in pecas.values() if x['medidas']), 'com conteúdo da caixa;', n_conv, 'conversões;', sum(1 for x in pecas.values() for a in x['apl'] if not a['de'] and not a['ate']), 'aplicações sem ano')
