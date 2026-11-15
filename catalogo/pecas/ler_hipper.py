# Leitor do catálogo HIPPER FREIOS (PDF) → catalogo/pecas/hipper.json. Discos, tambores e cubos de roda, com as medidas. Sem foto.
# Uso: python3 -I catalogo/pecas/ler_hipper.py <catalogo.pdf> catalogo/pecas/hipper.json
# Cada página: tipo (20pt: Disco de Freio / Tambor de Freio / Cubo de Roda), montadora (26pt) e uma tabela: CÓDIGO HF (negrito) | Nº ORIGINAL (várias
# linhas) | APLICAÇÕES (texto corrido: "MODELO versão 1996>2001 / versão 1990> OUTRO MODELO ...") | EIXO | CUBO | medidas A, B, C... (a legenda muda por tipo).
# No fim, TABELA DE CONVERSÕES (HF ↔ concorrentes, sem nome de marca: BD = Fremax, RCDI/RPDI/RPTA = TRW, o resto "Outra marca").
import sys, re, json, collections
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]
d = fitz.open(pdf)
limpo = lambda t: re.sub(r'\s+', ' ', str(t or '')).strip()
def linhas(p):
    out = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            if not l['spans']: continue
            sp = l['spans'][0]; s = limpo(''.join(x['text'] for x in l['spans']))
            if s: out.append(dict(x=l['bbox'][0], y=l['bbox'][1], x1=l['bbox'][2], tam=round(sp['size']), neg='Bold' in sp['font'], t=s))
    return out
LEG = {'Disco': {'A': 'Ø externo', 'B': 'espessura', 'B Min': 'espessura mínima', 'C': 'altura', 'D': 'Ø do furo central', 'E': 'furos'},
       'Tambor': {'A': 'Ø interno', 'A Max': 'Ø interno máximo', 'B': 'Ø externo', 'C': 'altura', 'D': 'Ø do furo central', 'E': 'largura da pista', 'F': 'furos'}}
FORA = {'AGRALE', 'SCANIA', 'RANDON', 'FOTON'}
brutos = []
for pn, p in enumerate(d):
    ls = linhas(p)
    tp = [l for l in ls if l['neg'] and l['y'] < 45 and re.match(r'^(Disco|Tambor|Cubo) ', l['t'])]
    mo = [l for l in ls if l['neg'] and l['tam'] >= 16 and l['y'] < 45 and l not in tp]   # nome comprido (VOLKSWAGEN, MERCEDES BENZ) vem em letra menor
    if not tp or not mo: continue
    tipo = tp[0]['t'].split()[0]; tipo = 'Cubo' if tipo.startswith('Cubo') else tipo; montadora = mo[0]['t'].upper()
    if montadora in FORA: continue
    cab = [l for l in ls if l['neg'] and 46 < l['y'] < 74 and l['tam'] in (7, 8)]
    apl = [l for l in cab if l['t'] == 'APLICAÇÕES']; cod = [l for l in cab if l['t'].startswith('CÓDIGO HF')]
    if not apl or not cod: continue
    x_cod = cod[0]['x']; nums = [l for l in cab if l['x'] > apl[0]['x1'] + 60]
    cols = {}
    for l in nums:
        k = l['t']; cx = (l['x'] + l['x1']) / 2
        if k in ('QTD.', 'FUROS'): k = 'furos'
        elif k in ('Ø FURO', 'ROL.(mm)'): k = 'Ø do furo do rolamento (mm)'
        elif k == 'ROL.': k = 'rolamento'
        elif k == 'TIPO PISTA': k = 'pista'
        cols.setdefault(k, cx)
    # no pé de algumas páginas há desenhos com legenda (códigos HF soltos): a tabela acaba onde eles começam
    y_img = min((i['bbox'][1] for i in p.get_image_info() if i['bbox'][1] > 90 and (i['bbox'][2] - i['bbox'][0]) < 300), default=10000)
    corpo = sorted([l for l in ls if 66 < l['y'] < y_img - 2 and l['tam'] in (7, 8)], key=lambda l: (l['y'], l['x']))
    ini = [l for l in corpo if l['neg'] and abs(l['x'] - x_cod) < 6 and re.match(r'^HF', l['t'])]
    x_apl = min((l['x'] for l in corpo if l['neg'] and l['x'] > x_cod + 80 and l['x'] < apl[0]['x1']), default=apl[0]['x'] - 130)
    x_fim_apl = min(cols.values()) - 22 if cols else 440
    for k, c in enumerate(ini):
        y1 = ini[k + 1]['y'] - 2 if k + 1 < len(ini) else 10000
        r = dict(codigo=limpo(c['t']), tipo=tipo, montadora=montadora, oem=[], ap=[], val={}, pagina=pn + 1)
        for l in corpo:
            if l is c or not (c['y'] - 2 <= l['y'] < y1): continue
            if l['x'] < x_apl - 4: r['oem'].append(l['t'])
            elif l['x'] < x_fim_apl: r['ap'].append((l['y'], l['x'], l['t']))
            elif l['t'] != '|':
                cx = (l['x'] + l['x1']) / 2; k2 = min(cols, key=lambda q: abs(cols[q] - cx))
                if tipo == 'Cubo' and 'Ø do furo do rolamento (mm)' in cols and cx > cols['Ø do furo do rolamento (mm)'] + 18: k2 = 'CONVERSÕES'
                r['val'].setdefault(k2, []).append(l['t'])
        r['ap'] = ' '.join(t for _, _, t in sorted(r['ap']))
        brutos.append(r)
# vocabulário de modelos por montadora: a palavra que abre a aplicação de cada linha e a que vem depois de um ano (sem barra antes)
ANO = r'(?:(?:19|20)\d\d\s*>\s*(?:(?:19|20)\d\d)?|[<>]\s*(?:19|20)\d\d|(?<![\d.,/])(?:19|20)\d\d(?![\d.,/>]))'
vocab = collections.defaultdict(set)
def pedacos(t):
    """corta o texto corrido depois de cada ano: [(texto, de, ate)]; o resto sem ano vem com (0, 0)"""
    out, pos = [], 0
    for m in re.finditer(ANO, t):
        a = re.findall(r'(?:19|20)\d\d', m.group(0)); de, ate = (0, int(a[0])) if m.group(0).lstrip()[0] in '<>' else (int(a[0]), int(a[1]) if len(a) > 1 else 0)
        out.append((limpo(t[pos:m.start()]), de, ate)); pos = m.end()
    if limpo(t[pos:]).strip('/ '): out.append((limpo(t[pos:]), 0, 0))
    return out
for r in brutos:
    for txt, de, ate in pedacos(r['ap']):
        if txt and not txt.startswith('/') and not txt.startswith('('):
            w = re.sub(r'^\(.*?\)\s*', '', txt).split()
            if w and re.match(r'^[A-Z0-9][A-Z0-9\-]+$', w[0]) and not re.match(r'^\d\.\d$', w[0]): vocab[r['montadora']].add(w[0])
pecas = {}
for r in brutos:
    apl, modelo = [], ''
    for txt, de, ate in pedacos(r['ap']):
        nota = re.match(r'^((?:\([^)]*\)\s*)+)', txt)   # "(+ ABS)" depois do ano: observação da aplicação anterior
        if nota:
            if apl: apl[-1]['obs'] = limpo(apl[-1]['obs'] + ' ' + nota.group(1))
            txt = txt[nota.end():]
        if not txt.strip('/ '): continue
        # dentro do pedaço pode começar outro modelo (palavra do vocabulário que não vem depois de barra): cada um vira uma aplicação
        tok = txt.split(); partes, atual = [], []
        for i, w in enumerate(tok):
            if atual and w in vocab[r['montadora']] and tok[i - 1] != '/' and len(atual) >= 2 and not atual[-1].startswith('('):
                partes.append(atual); atual = []
            atual.append(w)
        partes.append(atual)
        for n, pt in enumerate(partes):
            s = ' '.join(pt)
            if s.startswith('/'): s = limpo(modelo + ' ' + s.lstrip('/ '))
            else: modelo = pt[0] if pt[0] not in ('NOVO', 'NOVA', 'NEW', 'GRAND', 'GRAN') or len(pt) < 2 else pt[0] + ' ' + pt[1]
            ultimo = n == len(partes) - 1
            a = dict(montadora=r['montadora'], modelo=s, de=de if ultimo else 0, ate=ate if ultimo else 0, obs='')
            if a not in apl: apl.append(a)
    v = {k: ' '.join(x) for k, x in r['val'].items()}
    eixo = {'D': 'DIANTEIRO', 'T': 'TRASEIRO'}.get(v.get('EIXO', ''), '')
    if r['tipo'] == 'Cubo':
        desc = limpo('CUBO DE RODA ' + eixo)
        med = ' · '.join(x for x in ((v.get('furos', '') + ' furos') if v.get('furos') else '', ('rolamento: ' + v['rolamento'].lower()) if v.get('rolamento') else '',
                                    ('Ø do furo do rolamento ' + v['Ø do furo do rolamento (mm)'] + ' mm') if v.get('Ø do furo do rolamento (mm)') else '') if x)
        conv = [['Outra marca', limpo(x)] for x in r['val'].get('CONVERSÕES', []) if limpo(x)]
    else:
        nome = 'DISCO DE FREIO' if r['tipo'] == 'Disco' else 'TAMBOR DE FREIO'
        desc = limpo(nome + ' ' + eixo + ' ' + (v.get('pista', '') if r['tipo'] == 'Disco' else ''))
        leg = LEG[r['tipo']]
        med = ' · '.join(x for x in [leg[k] + ' ' + v[k] + ('' if leg[k] == 'furos' else ' mm') for k in leg if v.get(k)] + ([('cubo: ' + v['CUBO'].lower())] if v.get('CUBO') else []) if x)
        med = re.sub(r'furos (\d+)', r'\1 furos', med); conv = []
    j = pecas.setdefault(r['codigo'], dict(codigo=r['codigo'], grupo=r['tipo'], descricao=desc, medidas=med, foto='', oem=[], conv=conv, apl=[]))
    for o in r['oem']:
        for x in re.split(r'\s*/\s*', o):
            if limpo(x) and limpo(x) not in j['oem']: j['oem'].append(limpo(x))
    for a in apl:
        if a not in j['apl']: j['apl'].append(a)
def marca_conc(c):
    return 'Fremax' if re.match(r'^BD\s?\d', c) else 'TRW' if re.match(r'^R[CP](DI|TA)', c) else 'Outra marca'
n_conv = 0
for p in d:
    ls = linhas(p)
    if not any(l['tam'] == 34 for l in ls): continue
    hf = sorted([l for l in ls if l['neg'] and l['t'] == 'HIPPER FREIOS'], key=lambda l: l['x'])
    for k, h in enumerate(hf):
        x0 = h['x'] - 4; x1 = hf[k + 1]['x'] - 6 if k + 1 < len(hf) else 10000
        faixa = [l for l in ls if l['tam'] == 7 and x0 <= l['x'] < x1 and l['y'] > 80]
        for c in [l for l in faixa if l['t'].startswith('HF') and l['x'] < x0 + 20]:
            if limpo(c['t']) not in pecas: continue
            for o in faixa:
                if o is not c and abs(o['y'] - c['y']) < 4:
                    par = [marca_conc(o['t']), o['t']]
                    if par not in pecas[limpo(c['t'])]['conv']: pecas[limpo(c['t'])]['conv'].append(par); n_conv += 1
json.dump(dict(marca='Hipper Freios', edicao='', fotos='', pecas=sorted(pecas.values(), key=lambda x: x['codigo'])), open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(pecas), 'peças;', collections.Counter(x['grupo'] for x in pecas.values()).most_common(), ';', sum(len(x['apl']) for x in pecas.values()), 'aplicações;', sum(1 for x in pecas.values() if x['oem']), 'com código da montadora;',
      sum(1 for x in pecas.values() if x['medidas']), 'com medidas;', n_conv, 'conversões;', sum(1 for x in pecas.values() if not x['apl']), 'sem aplicação;', sum(1 for x in pecas.values() for a in x['apl'] if not a['de'] and not a['ate']), 'aplicações sem ano')
