#!/usr/bin/env bash
# Compila o plugin nativo do OBD e confere a LISTA BRANCA de comandos.
#
# Por que existe: o app abre um site, então tudo o que o plugin expõe fica alcançável por qualquer
# script daquela página. A promessa "a etapa 1 só lê" é garantida no nativo, pela lista branca — e
# garantia sem teste não é garantia. Este teste também é a única forma de compilar o Java aqui, onde
# não há SDK do Android: as classes do Android entram como stubs (teste/obd_java/stubs/) e as do
# Capacitor vêm das fontes de verdade, em app/node_modules.
#
# Uso: bash teste/teste_obd_java.sh        (antes: cd app && npm ci)
set -e
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
CAP="$RAIZ/app/node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor"

if [ ! -d "$CAP" ]; then
  echo "Falta o Capacitor: rode 'cd app && npm ci' antes." >&2
  exit 2
fi
if ! command -v javac > /dev/null; then
  echo "Sem javac (Java 17). No GitHub Actions ele existe; aqui, instale o JDK para rodar este teste." >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src/com/getcapacitor/annotation" "$TMP/out"

# fontes de verdade do Capacitor (as que o plugin usa e que compilam sem o resto do Android)
cp "$CAP/JSObject.java" "$CAP/JSArray.java" "$CAP/PermissionState.java" "$CAP/PluginMethod.java" "$TMP/src/com/getcapacitor/"
cp "$CAP/annotation/Permission.java" "$CAP/annotation/CapacitorPlugin.java" "$CAP/annotation/PermissionCallback.java" "$TMP/src/com/getcapacitor/annotation/"

cp -r "$RAIZ/teste/obd_java/stubs/." "$TMP/src/"
cp -r "$RAIZ/app/plugins/obd/android/src/main/java/br" "$TMP/src/"
mkdir -p "$TMP/src/br/com/dtcarcentroautomotivo/obd"
cp "$RAIZ/teste/obd_java/VerificaListaBranca.java" "$TMP/src/br/com/dtcarcentroautomotivo/obd/"

echo "Compilando o plugin…"
javac -nowarn -d "$TMP/out" $(find "$TMP/src" -name '*.java')
echo "Compilou sem erro."
# o apagar manda o 04 escrito no próprio código, nunca o que vier do JavaScript
grep -q 'enviar(call, "04"' "$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java" \
  || { echo "FALHOU: o método apagar deveria mandar o 04 escrito no código."; exit 1; }
grep -q '"04"' <(grep -A3 'SERVICOS_LEITURA = ' "$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java") \
  && { echo "FALHOU: o 04 não pode entrar na lista branca do comando()."; exit 1; }
java -cp "$TMP/out" br.com.dtcarcentroautomotivo.obd.VerificaListaBranca
