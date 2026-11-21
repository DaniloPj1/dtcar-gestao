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
# O texto de todo comando que AGE no carro é montado no próprio código, nunca colado do JavaScript:
# o site escolhe o quê, e manda só os valores (identificador, opção, chave) — já conferidos um por um.
# Se algum destes métodos passar a enviar texto vindo de fora, este teste reprova.
# A pergunta "aceita gravar?" manda SEMPRE um byte fixo escrito no código (nunca valor vindo da página)
# e só depois de conferir que o dado tem 2 bytes ou mais: é isso que garante que ela não grava nada.
JAVA_OBD="$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java"
sed -n "/public void sondarGravacao(/,/^    }/p" "$JAVA_OBD" | grep -q '"2E" + did + "00\\r"' || { echo "FALHOU: sondarGravacao deveria mandar o byte fixo 00."; exit 1; }
sed -n "/public void sondarGravacao(/,/^    }/p" "$JAVA_OBD" | grep -q 'podeSondarGravacao(antes, did)' || { echo "FALHOU: sondarGravacao tem de conferir o tamanho do dado antes de perguntar."; exit 1; }
sed -n "/public void sondarGravacao(/,/^    }/p" "$JAVA_OBD" | grep -q 'getString("valor' && { echo "FALHOU: sondarGravacao não pode aceitar valor da página."; exit 1; }
for m in atuar rotina reiniciarModulo; do
  sed -n "/public void $m(/,/^    }/p" "$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java" \
    | grep -q 'enviar(call, "' \
    || { echo "FALHOU: o método $m deveria montar o comando a partir de um literal escrito no código."; exit 1; }
done
grep -q 'return porUds ? "14FFFFFF" : "04";' "$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java" \
  || { echo "FALHOU: o comando de apagar deveria ser literal, no comandoApagar."; exit 1; }
# gravar LIVRE (0x2E em qualquer módulo) e destravar (0x27) NÃO podem existir: método publicado
# que ninguém chama é superfície de ataque de graça, e o 0x2E é escrita de calibração.
# (21/11/2026: a gravação voltou como gravarDado, travada no módulo do motor; ver ObdPlugin.java)
for m in gravar destravar; do
  grep -q "public void $m(" "$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java" \
    && { echo "FALHOU: o método $m não deveria existir enquanto nenhuma tela o usa."; exit 1; }
done
# Regravar memória de módulo não pode existir de jeito nenhum: nem serviço, nem método.
grep -qE '"3[4567]"' <(sed -n '/SERVICOS_PROIBIDOS = /,/));/p' "$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java") \
  || { echo "FALHOU: os serviços de transferência (34/35/36/37) deveriam estar na lista de proibidos."; exit 1; }
grep -q '"04"' <(grep -A3 'SERVICOS_LEITURA = ' "$RAIZ/app/plugins/obd/android/src/main/java/br/com/dtcarcentroautomotivo/obd/ObdPlugin.java") \
  && { echo "FALHOU: o 04 não pode entrar na lista branca do comando()."; exit 1; }
java -cp "$TMP/out" br.com.dtcarcentroautomotivo.obd.VerificaListaBranca "$RAIZ/teste/obd_java/sondas.txt"
