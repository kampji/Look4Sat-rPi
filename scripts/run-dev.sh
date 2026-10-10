#!/usr/bin/env bash
# Run without installing (any Linux/macOS machine): starts the server and prints the URL.
cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1
echo "Open http://127.0.0.1:${L4S_PORT:-8642}/ in a browser (Ctrl+C to stop)"
exec python3 server.py --port "${L4S_PORT:-8642}" "$@"
