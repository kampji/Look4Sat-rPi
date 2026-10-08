#!/usr/bin/env bash
# Look4Sat rPi launcher - start and stop the app on demand.
#
#   look4sat.sh start            server + full-screen (kiosk) window
#   look4sat.sh start --window   server + normal app window (F11 toggles full screen)
#   look4sat.sh stop             close the window and stop the server
#   look4sat.sh status
#   look4sat.sh server           run only the server in the foreground (for debugging)
#
# Nothing runs in the background once you quit: closing the window (or Settings ->
# System -> Quit) stops the server too. Environment: L4S_PORT (default 8642),
# L4S_HOST (default 127.0.0.1; 0.0.0.0 allows other devices on your network).
set -u

APP_DIR="$(cd "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/.." && pwd)"
PORT="${L4S_PORT:-8642}"
HOST="${L4S_HOST:-127.0.0.1}"
URL="http://127.0.0.1:${PORT}/"
RUN_DIR="${XDG_RUNTIME_DIR:-/tmp}/look4sat-rpi-$(id -u)"
PIDFILE="$RUN_DIR/server.pid"
LOG_DIR="$HOME/.cache/look4sat-rpi"
PROFILE="$HOME/.config/look4sat-rpi-chromium"   # dedicated browser profile (name used by the server's Quit)
mkdir -p "$RUN_DIR" "$LOG_DIR"

server_running() { [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; }
browser_running() { pgrep -f -- "--user-data-dir=$PROFILE" >/dev/null 2>&1; }

start_server() {
  if server_running; then return 0; fi
  nohup python3 "$APP_DIR/server.py" --host "$HOST" --port "$PORT" >>"$LOG_DIR/server.log" 2>&1 &
  echo $! >"$PIDFILE"
  for _ in $(seq 1 60); do
    curl -fs -o /dev/null "${URL}api/meta" && return 0
    server_running || { echo "Server failed to start - see $LOG_DIR/server.log" >&2; return 1; }
    sleep 0.5
  done
  echo "Server did not answer on $URL" >&2
  return 1
}

stop_server() {
  if server_running; then
    kill "$(cat "$PIDFILE")" 2>/dev/null
    for _ in $(seq 1 20); do server_running || break; sleep 0.2; done
    server_running && kill -9 "$(cat "$PIDFILE")" 2>/dev/null
  fi
  rm -f "$PIDFILE"
}

find_browser() { command -v chromium-browser || command -v chromium || true; }

open_browser() {  # $1 = kiosk|window ; blocks until the window is closed
  local browser mode="$1"
  browser="$(find_browser)"
  if [ -z "$browser" ]; then
    echo "Chromium not found - install it with: sudo apt install chromium" >&2
    return 1
  fi
  # no "restore pages?" bubble after an unclean shutdown
  local prefs="$PROFILE/Default/Preferences"
  [ -f "$prefs" ] && sed -i 's/"exited_cleanly":false/"exited_cleanly":true/; s/"exit_type":"Crashed"/"exit_type":"Normal"/' "$prefs"
  local common=(--user-data-dir="$PROFILE" --noerrdialogs --disable-infobars --no-first-run
    --no-default-browser-check --disable-session-crashed-bubble --disable-translate
    --disable-features=Translate,TouchpadOverscrollHistoryNavigation --overscroll-history-navigation=0
    --disable-pinch --password-store=basic --check-for-update-interval=31536000 --ozone-platform-hint=auto)
  if [ "$mode" = kiosk ]; then
    "$browser" "${common[@]}" --kiosk "$URL" >>"$LOG_DIR/browser.log" 2>&1
  else
    "$browser" "${common[@]}" --app="$URL" --window-size=800,480 >>"$LOG_DIR/browser.log" 2>&1
  fi
}

case "${1:-start}" in
  start)
    mode=kiosk
    [ "${2:-}" = "--window" ] && mode=window
    # one instance at a time: if it's already open, do nothing
    exec 9>"$RUN_DIR/launcher.lock"
    if ! flock -n 9; then echo "Look4Sat rPi is already running."; exit 0; fi
    start_server || exit 1
    open_browser "$mode"
    # window closed (or Quit pressed) -> stop everything
    stop_server
    ;;
  stop)
    pkill -f -- "--user-data-dir=$PROFILE" 2>/dev/null
    stop_server
    echo "Look4Sat rPi stopped."
    ;;
  status)
    server_running && echo "server: running (pid $(cat "$PIDFILE"), $URL)" || echo "server: stopped"
    browser_running && echo "window: open" || echo "window: closed"
    ;;
  server)
    exec python3 "$APP_DIR/server.py" --host "$HOST" --port "$PORT"
    ;;
  *)
    sed -n '2,13p' "$0"
    exit 1
    ;;
esac
