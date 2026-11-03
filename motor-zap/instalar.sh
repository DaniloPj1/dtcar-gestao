#!/usr/bin/env bash
# Instala o motor do WhatsApp da DTCar no Android (Termux) — também serve num PC Linux com Node 20+.
# Uso no Termux:
#   pkg install -y curl && curl -fsSL https://raw.githubusercontent.com/DaniloPj1/dtcar-gestao/main/motor-zap/instalar.sh -o instalar.sh && bash instalar.sh
# Pode rodar de novo: atualiza o código e mantém a chave já configurada.
set -euo pipefail
REPO="${DTCAR_REPO:-https://github.com/DaniloPj1/dtcar-gestao.git}"
RAMO="${DTCAR_RAMO:-main}"
DIR="${DTCAR_DIR:-$HOME/dtcar-gestao}"
TERMUX=0; [ -d /data/data/com.termux ] && TERMUX=1

echo "== Motor do WhatsApp da DTCar: instalação =="
if [ "$TERMUX" = 1 ]; then
  echo "-- Atualizando o Termux e instalando Node.js e Git (alguns minutos)…"
  yes | pkg update -y -o Dpkg::Options::=--force-confnew >/dev/null || true
  pkg install -y nodejs-lts git
fi
command -v node >/dev/null || { echo "ERRO: Node.js não encontrado."; exit 1; }
node -e 'process.exit(parseInt(process.versions.node) >= 20 ? 0 : 1)' || { echo "ERRO: precisa do Node 20 ou mais novo (tem $(node -v))."; exit 1; }
command -v git >/dev/null || { echo "ERRO: Git não encontrado."; exit 1; }

echo "-- Baixando o código do motor…"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only -q
else
  git clone -q --depth 1 --filter=blob:none --sparse -b "$RAMO" "$REPO" "$DIR"
  git -C "$DIR" sparse-checkout set motor-zap js
fi

echo "-- Instalando a biblioteca do WhatsApp (versão travada)…"
( cd "$DIR/motor-zap" && npm ci --omit=dev --no-audit --no-fund --loglevel=error )
sha256sum "$DIR/motor-zap/package-lock.json" | cut -d' ' -f1 > "$DIR/motor-zap/.instalado"

if [ ! -f "$HOME/.dtcar-motor.json" ]; then
  bash "$DIR/motor-zap/configurar.sh"
else
  echo "-- Chave do motor já configurada (para trocar: bash $DIR/motor-zap/configurar.sh)"
fi

if [ "$TERMUX" = 1 ]; then
  echo "-- Ligando o início automático (app Termux:Boot)…"
  mkdir -p "$HOME/.termux/boot"
  cat > "$HOME/.termux/boot/dtcar-motor.sh" <<EOF
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
nohup bash "$DIR/motor-zap/iniciar.sh" >> "$HOME/dtcar-motor.log" 2>&1 &
EOF
  chmod +x "$HOME/.termux/boot/dtcar-motor.sh"
  sh "$HOME/.termux/boot/dtcar-motor.sh"
else
  nohup bash "$DIR/motor-zap/iniciar.sh" >> "$HOME/dtcar-motor.log" 2>&1 &
fi
sleep 8
echo
echo "== Pronto. O motor está ligado. =="
echo "Ver o que ele está fazendo:  tail -f ~/dtcar-motor.log   (sair da visualização: Ctrl+C — o motor continua)"
echo "Parar o motor:               bash $DIR/motor-zap/parar.sh"
echo
tail -n 15 "$HOME/dtcar-motor.log" || true
