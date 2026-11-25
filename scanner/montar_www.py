#!/usr/bin/env python3
"""Monta scanner/www: o que o APK do DTCar Scanner leva dentro dele.
O app abre as telas do site (server.url em capacitor.config.json), então aqui vai só a tela
"Sem internet" (offline.html, que vira index.html) com a logo da oficina.
Uso: python3 scanner/montar_www.py   (o GitHub Actions roda isto antes de gerar o APK)"""
import os, shutil

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
WWW = os.path.join(AQUI, 'www')

DO_SITE = ['icons/logo-branco-sm.png']


def montar():
    if os.path.isdir(WWW):
        shutil.rmtree(WWW)
    os.makedirs(WWW)
    shutil.copy2(os.path.join(AQUI, 'offline.html'), os.path.join(WWW, 'index.html'))
    for rel in DO_SITE:
        destino = os.path.join(WWW, rel)
        os.makedirs(os.path.dirname(destino), exist_ok=True)
        shutil.copy2(os.path.join(RAIZ, rel), destino)
    print('www do Scanner montado em', WWW)


if __name__ == '__main__':
    montar()
