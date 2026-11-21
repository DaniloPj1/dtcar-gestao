#!/usr/bin/env bash
# Compila o plugin do app DTCar Clone e confere a LISTA BRANCA: libera LEITURA (OBD + UDS) e
# endereçamento do adaptador, e RECUSA tudo que escreve/age no carro. Garantia sem teste não é garantia.
# Uso: bash teste/teste_clone_java.sh   (antes: cd clone && npm ci)
set -e
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
CAP="$RAIZ/clone/node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor"
[ -d "$CAP" ] || { echo "Falta o Capacitor: rode 'cd clone && npm ci' antes." >&2; exit 2; }
command -v javac > /dev/null || { echo "Sem javac (Java 17+)." >&2; exit 2; }

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/src/com/getcapacitor/annotation" "$TMP/out"
cp "$CAP/JSObject.java" "$CAP/JSArray.java" "$CAP/PermissionState.java" "$CAP/PluginMethod.java" "$TMP/src/com/getcapacitor/"
cp "$CAP/annotation/Permission.java" "$CAP/annotation/CapacitorPlugin.java" "$CAP/annotation/PermissionCallback.java" "$TMP/src/com/getcapacitor/annotation/"
cp -r "$RAIZ/teste/obd_java/stubs/." "$TMP/src/"
cp -r "$RAIZ/clone/plugins/obd/android/src/main/java/br" "$TMP/src/"
cp "$RAIZ/teste/clone_java/VerificaCloneLista.java" "$TMP/src/br/com/dtcarcentroautomotivo/obd/"

echo "Compilando o plugin do Clone…"
javac -nowarn -d "$TMP/out" $(find "$TMP/src" -name '*.java')
echo "Compilou sem erro."
# garantia extra por texto: o plugin do clone não tem método de apagar nem de escrever
grep -q 'public void apagar' "$RAIZ/clone/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java" \
  && { echo "FALHOU: o app de clone não pode ter método apagar()."; exit 1; }
java -cp "$TMP/out" br.com.dtcarcentroautomotivo.obd.VerificaCloneLista
