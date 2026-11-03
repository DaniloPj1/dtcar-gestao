#!/usr/bin/env bash
# Mantém o motor ligado: busca a versão nova do código, liga o motor e religa se ele parar.
# Chamado pelo Termux:Boot (ao ligar o celular) e pelo instalar.sh. Só uma cópia roda por vez.
DIR="$(cd "$(dirname "$0")" && pwd)"
PID="$HOME/.dtcar-motor.pid"
LOG="$HOME/dtcar-motor.log"
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then echo "$(date '+%d/%m %H:%M') motor já está rodando (pid $(cat "$PID"))"; exit 0; fi
echo $$ > "$PID"
FILHO=""
trap '[ -n "$FILHO" ] && kill "$FILHO" 2>/dev/null && wait "$FILHO"; rm -f "$PID"; exit 0' INT TERM
while true; do
  # log não cresce sem fim: guarda só o último bloco de ~2 MB
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2000000 ]; then mv -f "$LOG" "$LOG.1"; fi
  git -C "$DIR/.." pull --ff-only -q 2>/dev/null || echo "$(date '+%d/%m %H:%M') sem internet para buscar atualização (segue com a versão atual)"
  ATUAL="$(sha256sum "$DIR/package-lock.json" | cut -d' ' -f1)"
  if [ "$ATUAL" != "$(cat "$DIR/.instalado" 2>/dev/null)" ]; then
    echo "$(date '+%d/%m %H:%M') biblioteca mudou: reinstalando"
    ( cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error ) && echo "$ATUAL" > "$DIR/.instalado"
  fi
  ( cd "$DIR" && exec node motor.js ) & FILHO=$!
  wait "$FILHO"; CODIGO=$?
  [ "$CODIGO" = 130 ] && break
  sleep 10
done
rm -f "$PID"
