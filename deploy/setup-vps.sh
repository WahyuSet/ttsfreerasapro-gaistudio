#!/usr/bin/env bash
# =================================================================
# Setup Google AI Studio TTS di VPS Linux (Ubuntu / Debian, x86_64)
#
# Jalankan SEKALI dari dalam folder proyek:
#   sudo bash deploy/setup-vps.sh
#
# Yang dilakukan:
#   1. Install Node.js 22 (jika belum ada / versi < 18)
#   2. Install Xvfb (layar virtual) + x11vnc (untuk login Google)
#   3. Install Google Chrome + dependensinya via Playwright
#   4. npm ci
#   5. Membuat .env dengan API_KEY acak (jika belum ada)
#   6. Membuat & mengaktifkan service systemd:
#        aistudio-xvfb  -> layar virtual :99
#        aistudio-tts   -> server API (node src/server.js)
# =================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-$(id -un)}"
DISPLAY_NUM=":99"
SCREEN_RES="1440x900x24"

log()  { echo -e "\n\033[1;32m==> $*\033[0m"; }
fail() { echo -e "\033[1;31m[ERROR] $*\033[0m" >&2; exit 1; }

[[ $EUID -eq 0 ]] || fail "Jalankan dengan sudo: sudo bash deploy/setup-vps.sh"
[[ -f "$APP_DIR/package.json" ]] || fail "package.json tidak ditemukan di $APP_DIR"
command -v apt-get >/dev/null || fail "Skrip ini hanya untuk Ubuntu/Debian (apt-get)."
[[ "$(uname -m)" == "x86_64" ]] || fail "Google Chrome hanya tersedia untuk x86_64, arsitektur VPS: $(uname -m)"

echo "Folder aplikasi : $APP_DIR"
echo "User service    : $APP_USER"

# ---------------------------------------------------------------
log "1/6 Install paket sistem (Xvfb, x11vnc, curl, openssl)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg openssl xvfb x11vnc

# ---------------------------------------------------------------
log "2/6 Cek Node.js"
NODE_MAJOR=0
if command -v node >/dev/null; then
  NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
fi
if (( NODE_MAJOR < 18 )); then
  echo "Node.js belum ada / terlalu lama, install Node.js 22 dari NodeSource..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
NODE_BIN="$(command -v node)"
echo "Node.js: $("$NODE_BIN" -v) ($NODE_BIN)"

# ---------------------------------------------------------------
log "3/6 npm ci"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm ci"

# ---------------------------------------------------------------
log "4/6 Install Google Chrome + dependensi via Playwright"
(cd "$APP_DIR" && npx --yes playwright install --with-deps chrome)
[[ -x /opt/google/chrome/chrome ]] || fail "Google Chrome gagal terpasang di /opt/google/chrome"
/opt/google/chrome/chrome --version

# ---------------------------------------------------------------
log "5/6 Konfigurasi .env"
ENV_FILE="$APP_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  echo ".env sudah ada, tidak diubah."
else
  NEW_KEY="$(openssl rand -hex 24)"
  cat > "$ENV_FILE" <<EOF
PORT=3740
API_KEY=$NEW_KEY
EOF
  chown "$APP_USER":"$APP_USER" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo ".env dibuat dengan API_KEY baru."
fi
mkdir -p "$APP_DIR/profiles" "$APP_DIR/downloads"
chown -R "$APP_USER":"$APP_USER" "$APP_DIR/profiles" "$APP_DIR/downloads"

# ---------------------------------------------------------------
log "6/6 Membuat service systemd"
cat > /etc/systemd/system/aistudio-xvfb.service <<EOF
[Unit]
Description=Xvfb virtual display $DISPLAY_NUM untuk AI Studio TTS
After=network.target

[Service]
User=$APP_USER
ExecStart=/usr/bin/Xvfb $DISPLAY_NUM -screen 0 $SCREEN_RES -nolisten tcp
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/aistudio-tts.service <<EOF
[Unit]
Description=Google AI Studio TTS - Playwright API Server
After=network-online.target aistudio-xvfb.service
Wants=network-online.target
Requires=aistudio-xvfb.service

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=DISPLAY=$DISPLAY_NUM
Environment=NODE_ENV=production
ExecStart=$NODE_BIN src/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now aistudio-xvfb.service
systemctl enable aistudio-tts.service
systemctl restart aistudio-tts.service

PORT="$(grep -E '^PORT=' "$ENV_FILE" | cut -d= -f2 || true)"
PORT="${PORT:-3740}"
for _ in $(seq 1 15); do
  curl -fs "http://127.0.0.1:$PORT/health" >/dev/null && break
  sleep 1
done

echo
if curl -fs "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo -e "\033[1;32mServer AKTIF di port $PORT\033[0m"
else
  echo -e "\033[1;33mServer belum merespons. Cek log: journalctl -u aistudio-tts -n 50\033[0m"
fi

cat <<EOF

================================================================
 SETUP SELESAI
================================================================
 API Key  : lihat di $ENV_FILE
 Health   : curl http://127.0.0.1:$PORT/health

 LANGKAH BERIKUTNYA (wajib, sekali saja):
   Login akun Google di VPS:
     sudo bash deploy/login-vps.sh

 Perintah berguna:
   sudo systemctl status aistudio-tts
   sudo systemctl restart aistudio-tts
   journalctl -u aistudio-tts -f

 Catatan: server listen di semua interface pada port $PORT.
 Jika memakai firewall (ufw), buka port bila perlu diakses dari luar:
   sudo ufw allow $PORT/tcp
================================================================
EOF
