#!/usr/bin/env bash
# Serve the Beet design locally — Babel-in-browser needs HTTP, not file://.
# Usage: ./serve.sh [port]   (default 8000)
set -euo pipefail
PORT="${1:-8000}"
cd "$(dirname "$0")"
echo "→ http://localhost:${PORT}/Beet.html"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
