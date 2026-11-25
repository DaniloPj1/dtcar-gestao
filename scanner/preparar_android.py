#!/usr/bin/env python3
"""Ajusta o projeto Android do DTCar Scanner depois de "npx cap add android" (roda no GitHub Actions).
 - ícone do aplicativo = a logo branca da DTCar sobre o azul do Scanner #174f94 (scanner/icone.png)
 - versão do aplicativo (nome = scanner/package.json, código = número da execução)
 - sem cópia de segurança automática do Android
Uso: python3 scanner/preparar_android.py <numero_da_execucao>"""
import json, os, re, shutil, sys
from PIL import Image

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
RES = os.path.join(AQUI, 'android', 'app', 'src', 'main', 'res')
GRADLE = os.path.join(AQUI, 'android', 'app', 'build.gradle')
MANIFESTO = os.path.join(AQUI, 'android', 'app', 'src', 'main', 'AndroidManifest.xml')
TAMANHOS = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}


def icones():
    base = Image.open(os.path.join(AQUI, 'icone.png')).convert('RGBA')
    # o ícone adaptativo do modelo é trocado por ícones comuns com o desenho da DTCar
    adaptativo = os.path.join(RES, 'mipmap-anydpi-v26')
    if os.path.isdir(adaptativo):
        shutil.rmtree(adaptativo)
    for dens, lado in TAMANHOS.items():
        pasta = os.path.join(RES, 'mipmap-' + dens)
        os.makedirs(pasta, exist_ok=True)
        im = base.resize((lado, lado), Image.LANCZOS)
        for nome in ('ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'):
            im.save(os.path.join(pasta, nome))


def versao(codigo):
    nome = json.load(open(os.path.join(AQUI, 'package.json')))['version']
    g = open(GRADLE).read()
    g, n1 = re.subn(r'versionCode\s+\d+', 'versionCode ' + str(codigo), g, count=1)
    g, n2 = re.subn(r'versionName\s+"[^"]*"', 'versionName "' + nome + '"', g, count=1)
    if n1 != 1 or n2 != 1:
        sys.exit('Não achei versionCode/versionName no build.gradle')
    open(GRADLE, 'w').write(g)


def manifesto():
    m = open(MANIFESTO).read()
    if 'android:allowBackup="true"' in m:
        m = m.replace('android:allowBackup="true"', 'android:allowBackup="false"')
    else:
        sys.exit('Não achei allowBackup no AndroidManifest.xml')
    if 'android.permission.INTERNET' not in m:
        sys.exit('O app precisa da permissão de internet')
    open(MANIFESTO, 'w').write(m)


if __name__ == '__main__':
    icones()
    versao(sys.argv[1] if len(sys.argv) > 1 else '1')
    manifesto()
    print('Projeto Android ajustado')
