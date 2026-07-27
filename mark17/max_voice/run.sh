#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
PYTHON="$ROOT/mark17/.venv-tts/bin/python"
HOST=${MAX17_TTS_HOST:-127.0.0.1}
PORT=${MAX17_TTS_PORT:-8017}

if [ ! -x "$PYTHON" ]; then
  echo "MAX Voice environment is missing. Run: npm run max17:voice:install" >&2
  exit 1
fi

if [ "$HOST" != "127.0.0.1" ] && [ "$HOST" != "localhost" ] && [ -z "${MAX17_TTS_TOKEN:-}" ]; then
  echo "Refusing a public bind without MAX17_TTS_TOKEN." >&2
  exit 1
fi

cd "$ROOT"
exec "$PYTHON" -m uvicorn mark17.max_voice.app:app --host "$HOST" --port "$PORT"

