#!/usr/bin/env bash
# Para o motor (ele solta a vez da conexão e o Supabase assume sob demanda).
PID="$HOME/.dtcar-motor.pid"
if [ -f "$PID" ] && kill -0 "$(cat "$PID")" 2>/dev/null; then
  kill "$(cat "$PID")"; sleep 3; echo "Motor parado."
else
  echo "O motor não estava rodando."
fi
command -v termux-wake-unlock >/dev/null && termux-wake-unlock || true
