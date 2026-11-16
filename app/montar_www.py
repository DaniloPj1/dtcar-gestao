#!/usr/bin/env python3
"""Monta app/www: a cópia do app com tudo dentro (é o que o APK leva).
As telas ficam em app/ e usam arquivos do site (../js/config.js, ../vendor/supabase.js, ../icons/...).
Aqui eles são copiados para dentro de www e os caminhos "../" viram caminhos locais.
Uso: python3 app/montar_www.py   (o GitHub Actions roda isto antes de gerar o APK)"""
import os, re, shutil, sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
WWW = os.path.join(AQUI, 'www')

# arquivos do app e arquivos do site que ele usa
DO_APP = ['index.html', 'app.js', 'app.css', 'manifest.webmanifest']
DO_SITE = ['js/config.js', 'vendor/supabase.js', 'icons/logo-branco-sm.png', 'icons/favicon.png', 'icons/icon-192.png', 'icons/icon-512.png']


def montar():
    if os.path.isdir(WWW):
        shutil.rmtree(WWW)
    os.makedirs(WWW)
    for nome in DO_APP:
        origem = os.path.join(AQUI, nome)
        texto = open(origem, encoding='utf-8').read()
        texto = re.sub(r'\.\./(js|vendor|icons)/', r'\1/', texto)
        open(os.path.join(WWW, nome), 'w', encoding='utf-8').write(texto)
    shutil.copytree(os.path.join(AQUI, 'fonts'), os.path.join(WWW, 'fonts'))
    for rel in DO_SITE:
        destino = os.path.join(WWW, rel)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        shutil.copy2(os.path.join(RAIZ, rel), destino)
    # confere: nada pode ficar apontando para fora da pasta
    for nome in DO_APP:
        if '../' in open(os.path.join(WWW, nome), encoding='utf-8').read():
            sys.exit('Sobrou caminho "../" em ' + nome)
    print('www montado em', WWW)


if __name__ == '__main__':
    montar()
