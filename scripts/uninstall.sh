#!/usr/bin/env bash
# Removes menu entries, autostart and the `look4sat` command. Your app folder and data/ stay.
set -u
"$(dirname "${BASH_SOURCE[0]}")/look4sat.sh" stop >/dev/null 2>&1
if [ -f /etc/systemd/system/look4sat-rpi.service ]; then
  sudo systemctl disable --now look4sat-rpi.service 2>/dev/null
  sudo rm -f /etc/systemd/system/look4sat-rpi.service
  sudo systemctl daemon-reload
fi
rm -f "$HOME/.config/autostart/look4sat-rpi.desktop" \
      "$HOME/.local/share/applications/look4sat-rpi.desktop" \
      "$HOME/.local/share/applications/look4sat-rpi-window.desktop" \
      "$HOME/.local/share/applications/look4sat-rpi-stop.desktop" \
      "$HOME/.local/bin/look4sat"
rm -rf "$HOME/.config/look4sat-rpi-chromium" "$HOME/.cache/look4sat-rpi"
echo "Look4Sat rPi removed (the app folder and its data/ were kept)."
