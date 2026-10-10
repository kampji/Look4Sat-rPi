#!/usr/bin/env bash
# Look4Sat rPi installer for Raspberry Pi OS (Bookworm / Trixie, desktop edition).
# Nothing is started at boot unless you ask for it - you start and stop the app yourself.
#
#   ./scripts/install.sh               menu entries + `look4sat` command
#   ./scripts/install.sh --autostart   also open it full screen when you log in
#   ./scripts/install.sh --lan         let other devices on your network open it while it runs
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${L4S_PORT:-8642}"
HOST="127.0.0.1"
AUTOSTART=0
for a in "$@"; do
  case "$a" in
    --autostart) AUTOSTART=1 ;;
    --lan) HOST="0.0.0.0" ;;
    *) echo "unknown option: $a"; exit 1 ;;
  esac
done
echo "==> Look4Sat rPi in $APP_DIR"

# --- packages ----------------------------------------------------------------
need=()
command -v python3 >/dev/null || need+=(python3)
command -v curl >/dev/null || need+=(curl)
if ! command -v chromium-browser >/dev/null && ! command -v chromium >/dev/null; then
  if apt-cache show chromium >/dev/null 2>&1; then need+=(chromium); else need+=(chromium-browser); fi
fi
if [ ${#need[@]} -gt 0 ]; then
  echo "==> Installing: ${need[*]}"
  sudo apt-get update
  sudo apt-get install -y "${need[@]}"
fi

chmod +x "$APP_DIR/scripts/"*.sh "$APP_DIR/server.py"
mkdir -p "$APP_DIR/data/custom"

# --- remove the always-on service from earlier versions, if present ----------
if [ -f /etc/systemd/system/look4sat-rpi.service ]; then
  echo "==> Removing old background service (the app now runs only while open)"
  sudo systemctl disable --now look4sat-rpi.service || true
  sudo rm -f /etc/systemd/system/look4sat-rpi.service
  sudo systemctl daemon-reload
fi

# --- `look4sat` command ------------------------------------------------------
mkdir -p "$HOME/.local/bin"
ln -sf "$APP_DIR/scripts/look4sat.sh" "$HOME/.local/bin/look4sat"

# --- menu entries ------------------------------------------------------------
APPS="$HOME/.local/share/applications"
mkdir -p "$APPS"
ENVV="env L4S_PORT=$PORT L4S_HOST=$HOST"
entry() {  # file name exec comment
  cat > "$APPS/$1" <<DESK
[Desktop Entry]
Type=Application
Name=$2
Comment=$4
Exec=$ENVV $APP_DIR/scripts/look4sat.sh $3
Icon=$APP_DIR/web/assets/icon.svg
Categories=Science;Education;HamRadio;
Terminal=false
DESK
}
entry look4sat-rpi.desktop "Look4Sat rPi" "start" "Satellite tracker - full screen"
entry look4sat-rpi-window.desktop "Look4Sat rPi (window)" "start --window" "Satellite tracker - in a window"
entry look4sat-rpi-stop.desktop "Stop Look4Sat rPi" "stop" "Close Look4Sat rPi"

if [ "$AUTOSTART" = 1 ]; then
  mkdir -p "$HOME/.config/autostart"
  cp "$APPS/look4sat-rpi.desktop" "$HOME/.config/autostart/look4sat-rpi.desktop"
  echo "==> Will open full screen at login (undo: rm ~/.config/autostart/look4sat-rpi.desktop)"
else
  rm -f "$HOME/.config/autostart/look4sat-rpi.desktop"
fi

echo
echo "Done. Start it from the menu (look under Education/Science/Other: \"Look4Sat rPi\")"
echo "or from a terminal:  look4sat start   |  look4sat start --window  |  look4sat stop"
echo "Quit from inside the app: Settings -> System -> Quit. Nothing keeps running afterwards."
if [ "$HOST" = "0.0.0.0" ]; then echo "While running, LAN access: http://$(hostname -I | awk '{print $1}'):$PORT (no password - trusted networks only)"; fi
