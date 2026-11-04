#!/usr/bin/env bash
# Mantém o motor ligado: busca a versão nova do código, liga o motor e religa se ele parar.
# Chamado pelo Termux:Boot (ao ligar o celular) e pelo instalar.sh. Só uma cópia roda por vez.
DIR="$(cd "$(dirname "$0")" && pwd)"
PID="$HOME/.dtcar-motor.pid"
LOG="$HOME/dtcar-motor.log"
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then echo "$(date '+%d/%m %H:%M') motor já está rodando (pid $(cat "$PID"))"; exit 0; fi
echo $$ > "$PID"
FILHO=""
trap '[ -n "$FILHO" ] && kill "$FILHO" 2>/dev/null && wait "$FILHO"; rm -f "$PID" "$HOME/.dtcar-motor-node.pid"; exit 0' INT TERM
while true; do
  # log não cresce sem fim: passando de ~2 MB, guarda o final em .1 e esvazia o mesmo arquivo (sem renomear: quem
  # escreve nele — nohup do início automático — continua no arquivo certo e o "tail -f" segue funcionando)
  if [ -f "$LOG" ] && [ "$(wc -c < "$LOG")" -gt 2000000 ]; then tail -c 500000 "$LOG" > "$LOG.1"; : > "$LOG"; fi
  # Atualiza só por VERSÃO APROVADA (v32): a mais nova etiqueta motor-vX.Y do repositório. Mudança na main não chega ao
  # motor até alguém marcar a versão (git tag motor-v3.1 && git push origin motor-v3.1). Sem nenhuma etiqueta, segue a main.
  if git -C "$DIR/.." fetch -q --tags origin 2>/dev/null; then
    TAG="$(git -C "$DIR/.." tag -l 'motor-v*' --sort=-v:refname | head -1)"
    if [ -n "$TAG" ]; then
      if [ "$(git -C "$DIR/.." rev-parse HEAD 2>/dev/null)" != "$(git -C "$DIR/.." rev-parse "$TAG^{commit}" 2>/dev/null)" ]; then
        git -C "$DIR/.." -c advice.detachedHead=false checkout -q "$TAG" && echo "$(date '+%d/%m %H:%M') motor na versão aprovada $TAG" \
          || echo "$(date '+%d/%m %H:%M') não trocou para $TAG (segue com a versão atual)"
      fi
    else
      git -C "$DIR/.." pull --ff-only -q 2>/dev/null || true
    fi
  else
    echo "$(date '+%d/%m %H:%M') sem internet para buscar atualização (segue com a versão atual)"
  fi
  ATUAL="$(sha256sum "$DIR/package-lock.json" | cut -d' ' -f1)"
  if [ "$ATUAL" != "$(cat "$DIR/.instalado" 2>/dev/null)" ]; then
    echo "$(date '+%d/%m %H:%M') biblioteca mudou: reinstalando"
    ( cd "$DIR" && npm ci --omit=dev --no-audit --no-fund --loglevel=error ) && echo "$ATUAL" > "$DIR/.instalado"
  fi
  ( cd "$DIR" && exec node motor.js ) & FILHO=$!
  echo "$FILHO" > "$HOME/.dtcar-motor-node.pid"
  wait "$FILHO"; CODIGO=$?
  [ "$CODIGO" = 130 ] && break
  sleep 10
done
rm -f "$PID" "$HOME/.dtcar-motor-node.pid"
