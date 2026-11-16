# Limpeza das fotos dos catálogos (rodar depois dos leitores): uso: python3 catalogo/pecas/limpar_fotos.py
# Regra (pedido do Danilo: só foto de que se tem certeza): imagem repetida em 3 ou mais códigos é foto genérica/de família e sai;
# repetida em 2 códigos só fica se os dois são do mesmo grupo (mesma peça em variações). Depois apaga os arquivos que ninguém usa.
import json, glob, os, collections
for f in sorted(glob.glob('catalogo/pecas/*.json')):
    j = json.load(open(f)); pasta = os.path.basename(f)[:-5] if not j.get('fotos') else j['fotos']
    c = collections.defaultdict(list)
    for p in j['pecas']:
        if p['foto']: c[p['foto']].append(p)
    tirou = 0
    for h, ps in c.items():
        if len(ps) == 1: continue
        grupos = {p['grupo'] for p in ps}
        if len(ps) >= 3 or len(grupos) > 1:
            for p in ps: p['foto'] = ''; tirou += 1
    usados = {p['foto'] for p in j['pecas'] if p['foto']}
    dirf = os.path.join('catalogo/fotos', pasta); apagou = 0
    if os.path.isdir(dirf) and j['pecas']:
        for a in os.listdir(dirf):
            if a.endswith('.jpg') and a[:-4] not in usados and not a.startswith('pd-') and j.get('fotos'): os.remove(os.path.join(dirf, a)); apagou += 1
    json.dump(j, open(f, 'w'), ensure_ascii=False, separators=(',', ':'))
    print(os.path.basename(f), 'fotos tiradas por repetição:', tirou, '| arquivos apagados:', apagou, '| com foto:', len(usados))
