#!/usr/bin/env bash
# Launch the Progressive Translation Card Stack locally.
set -e
cd "$(dirname "$0")"
PORT="${PORT:-7860}"
echo "Lingua Stack -> http://127.0.0.1:${PORT}"
exec python3 -m uvicorn app:app --host 127.0.0.1 --port "${PORT}"
