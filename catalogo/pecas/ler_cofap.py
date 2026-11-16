# Leitor do catálogo COFAP de suspensão 2013 (PDF) → catalogo/pecas/cofap.json. Sem foto.
# Uso: python3 -I catalogo/pecas/ler_cofap.py <catalogo.pdf> catalogo/pecas/cofap.json
# O catálogo tem uma tabela diferente por linha de produto. Este leitor cobre três, as de formato regular:
#   AMORTECEDORES, KITS E TOP KITS: modelo (negrito) → versões; colunas: ano | Super D, T | Turbogás D, T | Spa D, T | Kit suspensão | Top kit
#   BANDEJAS: código (negrito) | nº original | modelo | ano | descrição (várias linhas)
#   PASTILHAS PARA FREIOS: modelo | dianteira: ano, código, sistema | traseira: ano, código, sistema
# Mais sete tabelas de formato próprio (v155): bieletas (cartões em duas colunas, a montadora fica embaixo), buchas e coxins, homocinéticas, molas helicoidais,
# feixes e barra de torção, cilindros de embreagem, terminais axiais. Ficam de fora: camisas e kits de motor (peça de motor, não de suspensão).
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
            if not l['spans'] or abs(l['dir'][0]) < 0.9: continue   # ignora o texto em pé da margem
            sp = l['spans'][0]; s = limpo(''.join(x['text'] for x in l['spans']))
            if s: out.append(dict(x=l['bbox'][0], y=l['bbox'][1], x1=l['bbox'][2], tam=sp['size'], f=sp['font'], t=s))
    return out
def ano2(a):
    a = int(a); return 1900 + a if a >= 30 else 2000 + a
def periodo(t):
    t = limpo(t); A = r'(?:\d{2}\.)?(\d{2})'
    m = re.match(r'^' + A + r'\s*/\s*' + A + r'$', t)
    if m: return ano2(m.group(1)), ano2(m.group(2))
    m = re.match(r'^' + A + r'\s*/\s*\.{2,3}$', t)
    if m: return ano2(m.group(1)), 0
    m = re.match(r'^\.{2,3}\s*/\s*' + A + r'$', t)
    if m: return 0, ano2(m.group(1))
    m = re.match(r'^' + A + r'$', t)
    if m: return ano2(m.group(1)), ano2(m.group(1))
    return 0, 0
def titulo(ls): return ' '.join(l['t'] for l in ls if 11 <= l['tam'] <= 12 and l['y'] < 80 and 'Black' not in l['f'])
def por_y(ls, tol=3):
    g = []
    for l in sorted(ls, key=lambda l: (l['y'], l['x'])):
        if g and abs(l['y'] - g[-1][0]) <= tol: g[-1][1].append(l)
        else: g.append([l['y'], [l]])
    return [sorted(v, key=lambda l: l['x']) for _, v in g]
pecas = {}
def peca(cod, desc, grupo=''):
    return pecas.setdefault(cod, dict(codigo=cod, grupo=grupo, descricao=desc, medidas='', foto='', oem=[], conv=[], apl=[]))
def aplica(j, montadora, modelo, de, ate, obs=''):
    a = dict(montadora=montadora, modelo=limpo(modelo), de=de, ate=ate, obs=limpo(obs))
    if a['modelo'] and a not in j['apl']: j['apl'].append(a)
COLS_AM = [(196, 'AMORTECEDOR DIANTEIRO SUPER'), (239, 'AMORTECEDOR TRASEIRO SUPER'), (283, 'AMORTECEDOR DIANTEIRO TURBOGÁS'), (326, 'AMORTECEDOR TRASEIRO TURBOGÁS'),
           (370, 'AMORTECEDOR DIANTEIRO SPA'), (413, 'AMORTECEDOR TRASEIRO SPA'), (453, 'KIT'), (506, 'TOP')]
LADO = {'D': 'DIANTEIRO', 'T': 'TRASEIRO', 'DD': 'DIANTEIRO LD', 'DE': 'DIANTEIRO LE', 'TD': 'TRASEIRO LD', 'TE': 'TRASEIRO LE'}
cont = collections.Counter()
for pn, p in enumerate(d):
    ls = linhas(p); tit = titulo(ls)
    if tit.startswith('AMORTECEDORES, KITS E TOP KITS'):
        montadora, modelo, pend, ult = '', '', '', None   # ult = (versão, de, até) da linha anterior, para a linha que só continua os códigos
        for g in por_y([l for l in ls if l['y'] > 125]):
            m12 = [l for l in g if round(l['tam']) == 12 and 'Black' in l['f']]
            if m12: montadora = limpo(re.sub(r'-\s*continuação', '', m12[0]['t'])).upper(); modelo = ''; pend = ''; ult = None; continue
            g = [l for l in g if round(l['tam']) == 7]
            if not g: continue
            esq = [l for l in g if l['x'] < 128]; dirt = [l for l in g if l['x'] >= 140]
            if esq and 'Bold' in esq[0]['f'] and not dirt: modelo = esq[0]['t']; pend = ''; ult = None; continue
            versao = limpo(' '.join(l['t'] for l in esq))
            if not dirt: pend = limpo(pend + ' ' + versao); continue
            versao = limpo(pend + ' ' + versao); pend = ''
            ano = [l for l in dirt if l['x'] < 190]; de, ate = periodo(ano[0]['t']) if ano else (0, 0)
            v = '' if re.match(r'^todos os modelos$', versao, re.I) else re.sub(r'^Todos os modelos\s*', '', versao)
            if not ano and ult:   # sem ano nesta linha: continua a anterior (mais códigos, ou a versão que quebrou de linha)
                v = limpo(ult[0] + ' ' + v) if versao else ult[0]; de, ate = ult[1], ult[2]
            ult = (v, de, ate)
            for l in dirt:
                if l['x'] < 190: continue
                x, nome = min(COLS_AM, key=lambda c: abs(c[0] - l['x']))
                pares = re.findall(r'(\S+)\s*\((\w+)\)', l['t']) or [(l['t'], '')]   # "GP32575 (DD) GP32577 (TD)": dois códigos na mesma célula
                for cod, lado in pares:
                    lado = LADO.get(lado, '')
                    if not re.match(r'^[A-Z]{0,4}\.?\d{4,}\w*$', cod): continue
                    if nome.startswith('AMORT'): desc = limpo(nome + (' ' + lado.split()[-1] if lado.endswith(('LD', 'LE')) else ''))
                    else: desc = limpo(('KIT DO AMORTECEDOR ' if nome == 'KIT' else 'COXIM DO AMORTECEDOR ') + lado + (' (KIT SUSPENSÃO: BATENTE E COIFA)' if nome == 'KIT' else ' (TOP KIT)'))
                    aplica(peca(cod, desc), montadora, limpo(modelo + ' ' + v), de, ate); cont['amortecedores e kits'] += 1
    elif tit.startswith('BANDEJAS PARA'):
        montadora = ''; atual = None
        corpo = sorted([l for l in ls if l['y'] > 112], key=lambda l: (l['y'], l['x']))
        blocos = []
        for l in corpo:
            if round(l['tam']) == 12 and 'Black' in l['f']: blocos.append(('M', limpo(re.sub(r'-\s*continuação', '', l['t'])).upper())); continue
            if abs(l['tam'] - 8.5) > 0.6: continue
            if 'Bold' in l['f'] and l['x'] < 110 and re.match(r'^[A-Z]{2,4}\d', l['t']): atual = dict(cod=l['t'], y=l['y'], oem=[], mod=[], ano='', desc=[]); blocos.append(('P', atual)); continue
            if not atual: continue
            if l['x'] < 190: atual['oem'].append(l['t'])
            elif l['x'] < 365: atual['mod'].append(l['t'])
            elif l['x'] < 425: atual['ano'] = l['t']
            else: atual['desc'].append(l['t'])
        for tipo, b in blocos:
            if tipo == 'M': montadora = b; continue
            ds = limpo(' '.join(b['desc'])).replace('C/ ', 'COM ').replace('S/ ', 'SEM ')
            desc = ds if ds.startswith(('BRAÇO', 'BANDEJA')) else 'BANDEJA ' + ds
            j = peca(b['cod'], desc)
            for o in b['oem']:
                if o not in j['oem'] and o not in ('-', '--'): j['oem'].append(o)
            de, ate = periodo(b['ano'])
            aplica(j, montadora, ' '.join(b['mod']), de, ate); cont['bandejas'] += 1
    elif tit.startswith('PASTILHAS PARA FREIOS') and not any('DESENHOS' in l['t'] or 'INTRODUÇÃO' in l['t'] or 'COMO LER' in l['t'] for l in ls if l['y'] < 100):
        montadora = ''
        for g in por_y([l for l in ls if l['y'] > 125 and round(l['tam']) == 8]):
            if 'Bold' in g[0]['f'] and g[0]['x'] < 60: montadora = limpo(re.sub(r'-\s*continuação', '', g[0]['t'])).upper(); continue
            modelo = limpo(' '.join(l['t'] for l in g if l['x'] < 200))
            for x0, x1, pos in ((200, 360, 'DIANTEIRA'), (360, 600, 'TRASEIRA')):
                cel = [l for l in g if x0 <= l['x'] < x1 and l['t'] != '-']
                cod = [l['t'] for l in cel if re.match(r'^PFC\d', l['t'])]; ano = [l['t'] for l in cel if re.match(r'^[\d.]', l['t'])]; sis = [l['t'] for l in cel if re.match(r'^[A-Za-z]', l['t']) and not l['t'].startswith('PFC')]
                for c in cod:
                    de, ate = periodo(ano[0]) if ano else (0, 0)
                    j = peca(c, 'PASTILHA DE FREIO'); j.setdefault('pos', set()).add(pos)
                    aplica(j, montadora, modelo, de, ate, pos.title() + (' - sistema ' + sis[0] if sis else '')); cont['pastilhas'] += 1

# ---------- tabelas de formato próprio ----------
neg = lambda l: 'Bold' in l['f'] or 'Black' in l['f']
COD = re.compile(r'^[A-Z]{2,4}\d{5}$')
def anos(t):
    """'99 / 07', '03/...', '07/97 - 04/99', '99 /...' → (de, ate)"""
    t = limpo(t)
    m = re.search(r'(\d{2})/(\d{2})\s*-\s*(\d{2})/(\d{2})', t)
    if m: return ano2(m.group(2)), ano2(m.group(4))
    m = re.search(r'(\d{2})/(\d{2})\s*-\s*\.{2,3}', t)
    if m: return ano2(m.group(2)), 0
    m = re.search(r'(?:\d{2}\.)?(\d{2})\s*/\s*(?:\d{2}\.)?(\d{2})\b', t)
    if m: return ano2(m.group(1)), ano2(m.group(2))
    m = re.search(r'(?:\d{2}\.)?(\d{2})\s*/\s*\.{2,3}', t)
    if m: return ano2(m.group(1)), 0
    m = re.search(r'(\d{2})\s*/\s*\.{2,3}', t)
    if m: return ano2(m.group(1)), 0
    m = re.search(r'\.{2,3}\s*/\s*(\d{2})\b', t)
    if m: return 0, ano2(m.group(1))
    return 0, 0
FIM_ANO = re.compile(r'\s*-?\s*(?:(?:\d{2}\.)?\d{2}\s*/\s*(?:(?:\d{2}\.)?\d{2}|\.{2,3})|\.{2,3}\s*/\s*(?:\d{2}\.)?\d{2})\s*-?\s*$')
def sem_ano(t): return limpo(FIM_ANO.sub('', t)).strip(' -')
def montadora_de(l): return limpo(re.sub(r'-\s*continuação', '', l['t'])).upper()
def cab(ls): return ' '.join(l['t'] for l in ls if l['y'] < 130)
def p_bieletas(ls):
    if any('CROSS REFERENCE' in l['t'] for l in ls): return
    for lado, (x0, x1) in enumerate(((0, 250), (250, 700))):
        col = sorted([l for l in ls if x0 <= l['x'] < x1 and l['y'] > 105], key=lambda l: l['y'])
        cx = sorted(l['x'] for l in col if round(l['tam']) == 8 and re.match(r'^BTC\d{5}$', l['t']))
        if not cx: continue
        cx = cx[len(cx) // 2]   # a coluna do código muda de uma página para outra; o modelo fica ~47 pt à direita dele
        cards = []
        for l in col:
            if round(l['tam']) == 8 and re.match(r'^BTC\d{5}$', l['t']) and abs(l['x'] - cx) < 25: cards.append(dict(cod=l['t'], oem=[], mod=[], mont='')); continue
            if not cards: continue
            c = cards[-1]
            if round(l['tam']) == 10 and neg(l): c['mont'] = montadora_de(l)
            elif l['x'] < cx + 35: c['oem'].append(l['t'])
            else: c['mod'].append(l['t'])
        for c in cards:
            j = peca(c['cod'], 'BIELETA DA BARRA ESTABILIZADORA')
            for o in c['oem']:
                if o not in j['oem'] and not o.startswith('Nº') and o != '-': j['oem'].append(o)
            pos = [m for m in c['mod'] if re.match(r'^(Dianteira|Traseira)', m)]; mods = [m for m in c['mod'] if m not in pos and not m.startswith('(')]
            extra = [m for m in c['mod'] if m.startswith('(')]
            for m in mods:
                de, ate = anos(m); aplica(j, c['mont'], sem_ano(re.sub(r'\s*-\s*Todos', '', m)), de, ate, ' '.join(pos + extra)); cont['bieletas'] += 1
def p_buchas(ls):
    montadora, cur = '', None
    pecas_l = []
    for g in por_y([l for l in ls if l['y'] > 125]):
        if g[0]['x'] < 60 and neg(g[0]) and len(g) == 1: montadora = montadora_de(g[0]); cur = None; continue
        c = next((l for l in g if 140 <= l['x'] < 205 and COD.match(l['t'])), None)
        if c:
            cur = dict(cod=c['t'], mont=montadora, oem='', emb='', desc=[], apl=[]); pecas_l.append(cur)
            for l in g:
                if 225 <= l['x'] < 300: cur['oem'] = l['t']
                elif 305 <= l['x'] < 335: cur['emb'] = l['t']
        if not cur: continue
        for l in g:
            if 340 <= l['x'] < 445: cur['desc'].append(l['t'])
            elif l['x'] >= 445: cur['apl'].append(l['t'])
    for c in pecas_l:
        j = peca(c['cod'], limpo(' '.join(c['desc'])).upper())
        if c['oem'] and c['oem'] not in j['oem'] and c['oem'] != '-': j['oem'].append(c['oem'])
        if re.match(r'^\d+$', c['emb']): j['emb'] = c['emb'] + (' peça' if c['emb'] == '1' else ' peças')
        for a in c['apl']:
            de, ate = anos(a); aplica(j, c['mont'], sem_ano(a), de, ate); cont['buchas e coxins'] += 1
def p_terminais(ls):
    montadora = ''; ult = None
    for g in por_y([l for l in ls if l['y'] > 100]):
        if g[0]['x'] < 60 and neg(g[0]) and len(g) == 1: montadora = montadora_de(g[0]); ult = None; continue
        c = next((l for l in g if 410 <= l['x'] < 480 and COD.match(l['t'])), None)
        esq = limpo(' '.join(l['t'] for l in g if l['x'] < 180 and l['t'] != 'd'))
        if not c:
            if esq and ult: ult['modelo'] = limpo(ult['modelo'] + ' ' + esq)
            continue
        ano = ' '.join(l['t'] for l in g if 195 <= l['x'] < 285); obs = limpo(' '.join(l['t'] for l in g if 285 <= l['x'] < 410)); oem = [l['t'] for l in g if l['x'] >= 495]
        j = peca(c['t'], 'TERMINAL AXIAL')
        for o in oem:
            if o not in j['oem'] and o != '-': j['oem'].append(o)
        de, ate = anos(ano); aplica(j, montadora, esq, de, ate, obs); ult = j['apl'][-1] if j['apl'] and j['apl'][-1]['modelo'] == limpo(esq) else None; cont['terminais axiais'] += 1
def p_cilindros(ls):
    montadora, tipo, cur, cards = '', '', None, []
    for l in sorted([l for l in ls if l['y'] > 100], key=lambda l: (l['y'], l['x'])):
        if round(l['tam']) == 12 and neg(l) and l['x'] < 100: montadora = montadora_de(l); continue
        if neg(l) and 160 <= l['x'] < 175 and not COD.match(l['t']): tipo = l['t'].upper(); cur = None; continue
        if neg(l) and 100 <= l['x'] < 125 and COD.match(l['t']): cur = dict(cod=l['t'], mont=montadora, tipo=tipo, mod=[], ano=[], oem=[]); cards.append(cur); continue
        if not cur: continue
        if 160 <= l['x'] < 420: cur['mod'].append(l['t'])
        elif 420 <= l['x'] < 482: cur['ano'].append(l['t'])
        elif l['x'] >= 484: cur['oem'].append(l['t'])
    for c in cards:
        tp = c['tipo'] + (' DE EMBREAGEM' if 'CILINDRO' in c['tipo'] else ' DE EMBREAGEM')
        j = peca(c['cod'], tp.replace('COM TUBO', 'COM TUBO'))
        for o in c['oem']:
            if o not in j['oem'] and o != '-': j['oem'].append(o)
        mods = []
        for m in c['mod']:
            if m.startswith('(') and mods: mods[-1] += ' ' + m
            else: mods.append(m)
        ys = [anos(a) for a in c['ano']]
        for i, m in enumerate(mods):
            de, ate = ys[i] if len(ys) == len(mods) else (ys[0] if ys else (0, 0)); aplica(j, c['mont'], m, de, ate); cont['cilindros de embreagem'] += 1
def p_molas(ls):
    montadora, base, pend, ult = '', '', [], None
    for g in por_y([l for l in ls if l['y'] > 110]):
        if g[0]['x'] < 60 and round(g[0]['tam']) == 12 and 'Black' in g[0]['f']: montadora = montadora_de(g[0]); base = ''; pend = []; ult = None; continue
        c = next((l for l in g if 330 <= l['x'] < 420 and re.match(r'^MC\.\w+', l['t'])), None)
        esq = limpo(' '.join(l['t'] for l in g if l['x'] < 215))
        if not c:
            if not esq or esq in ('REFERÊNCIA DE CORES', 'COFAP'): continue
            if ult and ult[1].endswith(('/', '-')): ult[0]['modelo'] = limpo(ult[0]['modelo'] + ' ' + esq); ult = (ult[0], esq); continue
            if esq == esq.upper() and not re.search(r'\d', esq) or (esq == esq.upper() and len(esq) < 14): base = esq; pend = []
            else: pend.append(esq)
            continue
        ano = ' '.join(l['t'] for l in g if 215 <= l['x'] < 270); pos = ' '.join(l['t'] for l in g if 270 <= l['x'] < 330); cor = limpo(' '.join(l['t'] for l in g if l['x'] >= 415))
        lado = 'DIANTEIRA' if pos.startswith('Diant') else 'TRASEIRA' if pos.startswith('Tras') else ''
        j = peca(c['t'], limpo('MOLA HELICOIDAL ' + lado)); de, ate = anos(ano)
        modelo = limpo(base + ' ' + ' '.join(pend) + ' ' + esq); pend = []
        aplica(j, montadora, modelo, de, ate, ('Cor: ' + cor) if cor else ''); ult = (j['apl'][-1], esq) if j['apl'] and j['apl'][-1]['modelo'] == modelo else None; cont['molas helicoidais'] += 1
HC = {'JHC': 'JUNTA HOMOCINÉTICA FIXA', 'KJH': 'KIT DA JUNTA HOMOCINÉTICA FIXA', 'TRC': 'TRIZETA', 'KTC': 'KIT DA TRIZETA', 'JDC': 'JUNTA HOMOCINÉTICA DESLIZANTE', 'KJD': 'KIT DA JUNTA DESLIZANTE'}
def p_homocineticas(ls):
    montadora, base = '', ''
    for g in por_y([l for l in ls if l['y'] > 112]):
        if g[0]['x'] < 60 and round(g[0]['tam']) == 12 and 'Black' in g[0]['f']: montadora = montadora_de(g[0]); base = ''; continue
        if len(g) == 1 and round(g[0]['tam']) == 9 and g[0]['x'] < 60: base = g[0]['t'].upper(); continue
        cods = [l for l in g if l['x'] >= 260 and COD.match(l['t'])]
        if not cods: continue
        esq = limpo(' '.join(l['t'] for l in g if l['x'] < 215)); esq = re.split(r'\s-\s(?:As|Os)\s', esq)[0]
        ano = ' '.join(l['t'] for l in g if 215 <= l['x'] < 260); de, ate = anos(ano)
        if not montadora: continue
        for c in cods:
            j = peca(c['t'], HC.get(c['t'][:3], 'JUNTA HOMOCINÉTICA / TRIZETA'))
            aplica(j, montadora, limpo(base + ' ' + esq), de, ate); cont['homocinéticas'] += 1
def p_feixes(ls):
    montadora, base = '', ''
    for g in por_y([l for l in ls if l['y'] > 110]):
        if g[0]['x'] < 60 and round(g[0]['tam']) == 12 and 'Black' in g[0]['f']: montadora = montadora_de(g[0]); base = ''; continue
        cods = [l for l in g if re.match(r'^(FC|BT)\.\w+', l['t'])]
        if len(g) == 1 and round(g[0]['tam']) == 9 and g[0]['x'] < 60 and not cods: base = g[0]['t'].upper(); continue
        if len(cods) != 1: continue
        c = cods[0]; esq = limpo(' '.join(l['t'] for l in g if l['x'] < 190))
        ano = ' '.join(l['t'] for l in g if 190 <= l['x'] < 255); pos = ' '.join(l['t'] for l in g if 255 <= l['x'] < c['x'] - 5); obs = limpo(' '.join(l['t'] for l in g if l['x'] > c['x'] + 40))
        j = peca(c['t'], 'FEIXE DE MOLAS'); de, ate = anos(ano)
        aplica(j, montadora, limpo(base + ' ' + esq) if esq.upper() != base else base, de, ate, limpo(pos + ' ' + obs)); cont['feixes de molas'] += 1
for pn, p in enumerate(d):
    ls = linhas(p); tit = titulo(ls); ch = cab(ls)
    if tit.startswith('BIELETAS'): p_bieletas(ls)
    elif tit.startswith('TERMINAIS AXIAIS'): p_terminais(ls)
    elif tit.startswith('CILINDROS E ATUADORES'): p_cilindros(ls)
    elif tit.startswith('MOLAS HELICOIDAIS'): p_molas(ls)
    elif tit.startswith('JUNTAS HOMOCIN'): p_homocineticas(ls)
    elif tit.startswith('FEIXES DE MOLAS'): p_feixes(ls)
    elif 'Embalagem' in ch and 'Descri' in ch: p_buchas(ls)
# medidas das pastilhas (páginas de desenhos técnicos: "PFC030012 / Dimensões em MM: 108,70 x 49,45 x 14,50")
for p in d:
    ls = linhas(p)
    if not titulo(ls).startswith('PASTILHAS PARA FREIOS') or not any('DESENHOS' in l['t'] for l in ls if l['y'] < 100): continue
    cods = [l for l in ls if re.match(r'^PFC\d{6}$', l['t'])]
    for l in ls:
        m = re.match(r'^Dimensões em MM:\s*(.+)$', l['t'])
        if not m or not cods: continue
        c = min(cods, key=lambda c: abs(c['y'] - l['y']) + abs(c['x'] - l['x']) * 0.6)
        if c['t'] in pecas and not pecas[c['t']]['medidas']: pecas[c['t']]['medidas'] = 'Dimensões (mm): ' + m.group(1)
for j in pecas.values():
    pos = j.pop('pos', None)
    if pos and len(pos) == 1: j['descricao'] += ' ' + next(iter(pos))
json.dump(dict(marca='Cofap', edicao='2013', fotos='', pecas=sorted(pecas.values(), key=lambda x: x['codigo'])), open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(pecas), 'peças;', sum(len(x['apl']) for x in pecas.values()), 'aplicações;', dict(cont), ';', collections.Counter(x['descricao'].split()[0] for x in pecas.values()).most_common(), ';',
      sum(1 for x in pecas.values() if x['medidas']), 'com medidas;', sum(1 for x in pecas.values() for a in x['apl'] if not a['de'] and not a['ate']), 'aplicações sem ano')
