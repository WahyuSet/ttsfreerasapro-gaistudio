#!/usr/bin/env bash
# =================================================================
# Login akun Google di VPS lewat VNC (via SSH tunnel)
#
#   sudo bash deploy/login-vps.sh
#
# Alur:
#   1. Service aistudio-tts dihentikan sementara (profil Chrome tidak bisa dipakai 2 proses)
#   2. x11vnc dijalankan di layar virtual :99, hanya di localhost:5900
#   3. Chrome dibuka ke aistudio.google.com
#   4. Dari PC Anda: buat SSH tunnel lalu buka VNC Viewer ke localhost:5900
#   5. Login, lalu tekan ENTER di terminal ini -> sesi disimpan, service dinyalakan lagi
# =================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_USER="${SUDO_USER:-$(id -un)}"
DISPLAY_NUM=":99"
VNC_PORT=5900

fail() { echo -e "\033[1;31m[ERROR] $*\033[0m" >&2; exit 1; }
[[ $EUID -eq 0 ]] || fail "Jalankan dengan sudo: sudo bash deploy/login-vps.sh"
command -v x11vnc >/dev/null || fail "x11vnc belum terpasang. Jalankan deploy/setup-vps.sh dulu."

VNC_PID=""
cleanup() {
  [[ -n "$VNC_PID" ]] && kill "$VNC_PID" 2>/dev/null || true
  echo "Menyalakan kembali service aistudio-tts..."
  systemctl start aistudio-tts.service || true
}
trap cleanup EXIT

echo "Menghentikan sementara service aistudio-tts..."
systemctl stop aistudio-tts.service || true
systemctl start aistudio-xvfb.service
sleep 1

sudo -u "$APP_USER" x11vnc -display "$DISPLAY_NUM" -localhost -rfbport "$VNC_PORT" \
  -forever -shared -nopw -quiet >/tmp/aistudio-x11vnc.log 2>&1 &
VNC_PID=$!
sleep 1
kill -0 "$VNC_PID" 2>/dev/null || fail "x11vnc gagal jalan, cek /tmp/aistudio-x11vnc.log"

VPS_HOST="$(hostname -I 2>/dev/null | awk '{print $1}')"
cat <<EOF

================================================================
 VNC siap (hanya bisa diakses lewat SSH tunnel)
================================================================
 1. Di PC Anda, buka terminal BARU lalu jalankan:
      ssh -L $VNC_PORT:localhost:$VNC_PORT $APP_USER@${VPS_HOST:-<IP-VPS>}
    (biarkan terminal itu tetap terbuka)

 2. Buka VNC Viewer (mis. RealVNC / TigerVNC) dan sambungkan ke:
      localhost:$VNC_PORT

 3. Login akun Google di jendela Chrome yang terlihat,
    selesaikan 2FA / verifikasi sampai masuk halaman AI Studio.

 4. Kembali ke terminal ini dan tekan ENTER.
================================================================

EOF

cd "$APP_DIR"
sudo -u "$APP_USER" -H env DISPLAY="$DISPLAY_NUM" node src/openBrowser.js https://aistudio.google.com/
