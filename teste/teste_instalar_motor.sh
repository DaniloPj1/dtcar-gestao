#!/usr/bin/env bash
# Teste da instalação do motor (instalar.sh, configurar.sh, iniciar.sh, parar.sh) num HOME temporário,
# com o código do próprio repositório (ramo atual) e um "banco" falso local. Não toca no Supabase.
# Rodar: bash teste/teste_instalar_motor.sh
set -u
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
RAMO="$(git -C "$RAIZ" rev-parse --abbrev-ref HEAD)"
T="$(mktemp -d)"; export HOME="$T/home"; mkdir -p "$HOME"
OKS=0; FALHAS=()
confere() { if eval "$2"; then OKS=$((OKS+1)); echo "OK $1"; else FALHAS+=("$1"); echo "FALHA $1"; fi; }
CHAVE="dtm_$(printf 'b%.0s' $(seq 64))"

# banco falso: aceita só a CHAVE; a vez fica com o "supabase" (motor espera, sem conectar ao WhatsApp)
cat > "$T/banco.mjs" <<EOF
import http from "node:http"; import fs from "node:fs";
http.createServer((q, r) => { let c = ""; q.on("data", (d) => c += d); q.on("end", () => {
  const a = JSON.parse(c || "{}"); fs.appendFileSync("$T/chamadas.txt", q.url.split("/rpc/")[1] + "\n");
  if (a.p_chave !== "$CHAVE") { r.writeHead(400, { "content-type": "application/json" }); return r.end(JSON.stringify({ message: "Chave do motor inválida ou revogada.", code: "28000" })); }
  r.writeHead(200, { "content-type": "application/json" }); r.end(q.url.endsWith("whatsapp_motor_pulso") ? JSON.stringify({ vez: false, dono: "supabase" }) : "");
}); }).listen(0, "127.0.0.1", function () { fs.writeFileSync("$T/porta", String(this.address().port)); });
EOF
node "$T/banco.mjs" & BANCO=$!
for i in $(seq 50); do [ -s "$T/porta" ] && break; sleep 0.1; done
export DTCAR_SUPABASE_URL="http://127.0.0.1:$(cat "$T/porta")"

# 1) instalação nova: pede a chave (primeiro errada, depois certa) e liga o motor
printf 'chave-errada\n%s\nA15 de teste\n' "$CHAVE" | DTCAR_REPO="file://$RAIZ" DTCAR_RAMO="$RAMO" bash "$RAIZ/motor-zap/instalar.sh" > "$T/instalar.out" 2>&1
confere "instalação terminou" 'grep -q "Pronto. O motor está ligado" "$T/instalar.out"'
confere "chave com formato errado pedida de novo" 'grep -q "formato errado" "$T/instalar.out"'
confere "chave conferida com o banco" 'grep -q "Chave do motor OK" "$T/instalar.out"'
confere "só o motor e o js baixados (sparse)" '[ -f "$HOME/dtcar-gestao/motor-zap/motor.js" ] && [ -f "$HOME/dtcar-gestao/js/config.js" ] && [ ! -d "$HOME/dtcar-gestao/supabase" ]'
confere "biblioteca instalada sem sharp" '[ -d "$HOME/dtcar-gestao/motor-zap/node_modules/baileys" ] && [ ! -d "$HOME/dtcar-gestao/motor-zap/node_modules/sharp" ]'
confere "config só legível pelo dono" '[ "$(stat -c %a "$HOME/.dtcar-motor.json")" = 600 ] && grep -q "A15 de teste" "$HOME/.dtcar-motor.json"'
sleep 3
confere "motor ligado e mandando pulso" 'grep -q "ligado" "$HOME/dtcar-motor.log" && grep -c whatsapp_motor_pulso "$T/chamadas.txt" | grep -qv "^[01]$"'
PID1="$(cat "$HOME/.dtcar-motor.pid")"
bash "$RAIZ/motor-zap/iniciar.sh" > "$T/segundo.out" 2>&1
confere "segunda cópia não liga (já rodando)" 'grep -q "já está rodando" "$T/segundo.out" && [ "$(cat "$HOME/.dtcar-motor.pid")" = "$PID1" ]'
# 2) motor cai: o iniciar.sh religa em ~10 s
pkill -f "node motor.js" ; sleep 13
confere "motor religado depois de cair" '[ "$(pgrep -fc "node motor.js")" -ge 1 ]'
# 3) parar: solta a vez e encerra tudo
bash "$RAIZ/motor-zap/parar.sh" > "$T/parar.out" 2>&1; sleep 2
confere "parar encerra o motor" 'grep -q "Motor parado" "$T/parar.out" && ! pgrep -f "node motor.js" >/dev/null && [ ! -f "$HOME/.dtcar-motor.pid" ]'
confere "ao parar, soltou a vez" 'tail -n 3 "$T/chamadas.txt" | grep -q whatsapp_motor_soltar'
# 4) reinstalar mantém a chave
DTCAR_REPO="file://$RAIZ" DTCAR_RAMO="$RAMO" bash "$RAIZ/motor-zap/instalar.sh" < /dev/null > "$T/re.out" 2>&1
confere "reinstalar mantém a chave configurada" 'grep -q "já configurada" "$T/re.out" && grep -q "Pronto" "$T/re.out"'
bash "$RAIZ/motor-zap/parar.sh" >/dev/null 2>&1

kill $BANCO 2>/dev/null; rm -rf "$T"
echo "OK $OKS — FALHAS ${#FALHAS[@]}: ${FALHAS[*]:-}"
[ ${#FALHAS[@]} = 0 ]
