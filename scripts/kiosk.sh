#!/usr/bin/env bash
# Kept for compatibility - use look4sat.sh instead.
exec "$(dirname "$(readlink -f "${BASH_SOURCE[0]}")")/look4sat.sh" start "$@"
