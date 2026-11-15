# Leitor do folheto NAKATA "Principais aplicações para suspensão" (PDF de 19 páginas, só texto, sem foto) → catalogo/pecas/nakata.json
# Uso: python3 -I catalogo/pecas/ler_nakata_resumo.py <folheto.pdf> catalogo/pecas/nakata.json
# Cada linha: CÓDIGO | Descrição | "MONTADORA - Modelo / Modelo - 01/1995 - 12/2011 - detalhes - posição - lado" (a aplicação pode quebrar de linha).
# Quando o catálogo Nakata completo entrar, ele substitui este arquivo (mesma marca).
import sys, re, json
import pymupdf as fitz
pdf, saida = sys.argv[1], sys.argv[2]
limpo = lambda t: re.sub(r'\s+', ' ', str(t or '')).strip()
linhas = []
for p in fitz.open(pdf):
    ls = []
    for b in p.get_text('dict')['blocks']:
        if b['type'] != 0: continue
        for l in b['lines']:
            sp = l['spans'][0]; t = limpo(''.join(x['text'] for x in l['spans']))
            if t and round(sp['size']) == 9 and l['bbox'][1] > 92: ls.append((round(l['bbox'][1]), l['bbox'][0], t))
    ls.sort(); atual = None
    for y, x, t in ls:
        if x < 85: atual = dict(codigo=t.replace(' ', ''), desc='', ap=''); linhas.append(atual)
        elif atual is None: continue
        elif x < 200: atual['desc'] = limpo(atual['desc'] + ' ' + t)
        else: atual['ap'] = limpo(atual['ap'] + ' ' + t)
pecas = {}
for l in linhas:
    m = re.search(r'\s-\s(\d{2})/((?:19|20)\d\d)\s-\s(\d{2})/((?:19|20)\d\d)(?:\s-\s|$)', l['ap'])
    if not m: m2 = re.search(r'\s-\s(\d{2})/((?:19|20)\d\d)\s-\s*(?:\.\.\.|→|>|$)', l['ap'])
    antes = l['ap'][:(m or m2).start()] if (m or m2) else l['ap']; resto = l['ap'][(m or m2).end():].strip(' -') if (m or m2) else ''
    de = int((m or m2).group(2)) if (m or m2) else 0; ate = int(m.group(4)) if m else 0
    partes = antes.split(' - ', 1); montadoras = [limpo(x).upper() for x in partes[0].split(' / ')]; modelos = [limpo(x) for x in (partes[1] if len(partes) > 1 else '').split(' / ') if limpo(x)]
    # detalhes do meio vão para a observação; posição e lado (o final) completam a descrição
    det = [limpo(x) for x in resto.split(' - ') if limpo(x)]
    pos = [x for x in det if re.search(r'Dianteir|Traseir|Superior|Inferior|Dir\b|Esq\b|Dir / Esq', x)]; obs = ' - '.join(x for x in det if x not in pos)
    desc = limpo(l['desc'] + (' ' + ' '.join(pos) if pos else ''))
    desc = re.sub(r'\bDir / Esq\b', 'LD/LE', desc); desc = re.sub(r'\bDir\b', 'LD', desc); desc = re.sub(r'\bEsq\b', 'LE', desc)
    j = pecas.setdefault(l['codigo'], dict(codigo=l['codigo'], grupo=l['desc'], descricao=desc, medidas='', foto='', oem=[], conv=[], apl=[]))
    for mo in montadoras:
        for md in (modelos or ['']):
            a = dict(montadora=mo, modelo=md, de=de, ate=ate, obs=obs)
            if md and a not in j['apl']: j['apl'].append(a)
json.dump(dict(marca='Nakata', edicao='principais aplicações', fotos='', pecas=sorted(pecas.values(), key=lambda x: x['codigo'])), open(saida, 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print(len(pecas), 'peças;', sum(len(x['apl']) for x in pecas.values()), 'aplicações;', sum(1 for x in pecas.values() if not x['apl']), 'sem aplicação;', sum(1 for x in pecas.values() for a in x['apl'] if not a['de']), 'aplicações sem ano')
