# Leitor do catálogo COFAP de suspensão 2013 (PDF) → catalogo/pecas/cofap.json. Sem foto.
# Uso: python3 -I catalogo/pecas/ler_cofap.py <catalogo.pdf> catalogo/pecas/cofap.json
# O catálogo tem uma tabela diferente por linha de produto. Este leitor cobre três, as de formato regular:
#   AMORTECEDORES, KITS E TOP KITS: modelo (negrito) → versões; colunas: ano | Super D, T | Turbogás D, T | Spa D, T | Kit suspensão | Top kit
#   BANDEJAS: código (negrito) | nº original | modelo | ano | descrição (várias linhas)
#   PASTILHAS PARA FREIOS: modelo | dianteira: ano, código, sistema | traseira: ano, código, sistema
# Ficam de fora (formato próprio, a fazer): bieletas, buchas e coxins, homocinéticas, molas, feixes, cilindros de embreagem, terminais axiais, camisas.
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
    m = re.match(r'^' + A + r'\s*/\s*\.\.\.$', t)
    if m: return ano2(m.group(1)), 0
    m = re.match(r'^\.\.\.\s*/\s*' + A + r'$', t)
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
