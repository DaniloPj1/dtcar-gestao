#!/usr/bin/env bash
# Grava a chave do motor (gerada em Sistema › WhatsApp no DTCar Gestão) em ~/.dtcar-motor.json
# e confere com o banco. A chave fica só neste aparelho, legível só pelo Termux.
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
echo
echo "No DTCar Gestão: Sistema › WhatsApp › Motor no Android › Gerar chave do motor › Copiar."
while true; do
  read -r -p "Cole aqui a chave do motor (começa com dtm_): " CHAVE
  CHAVE="$(printf '%s' "$CHAVE" | tr -d '[:space:]')"
  [[ "$CHAVE" =~ ^dtm_[0-9a-f]{64}$ ]] && break
  echo "Chave com formato errado. Copie de novo pela tela do sistema."
done
read -r -p "Nome deste aparelho [Galaxy A15 da oficina]: " NOME
NOME="${NOME:-Galaxy A15 da oficina}"
umask 077
node -e 'const [c, n, a] = process.argv.slice(1); require("fs").writeFileSync(a, JSON.stringify({ chave_motor: c, aparelho: n }, null, 2));' "$CHAVE" "$NOME" "$HOME/.dtcar-motor.json"
chmod 600 "$HOME/.dtcar-motor.json"
echo "-- Conferindo a chave com o banco…"
( cd "$DIR" && node motor.js --teste ) || { echo "A chave não foi aceita. Gere outra na tela e rode de novo: bash $DIR/configurar.sh"; exit 1; }
