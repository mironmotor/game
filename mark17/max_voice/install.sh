#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
cd "$ROOT"

command -v uv >/dev/null 2>&1 || {
  echo "uv is required. Install it with: brew install uv" >&2
  exit 1
}

uv python install 3.11
if [ ! -x mark17/.venv-tts/bin/python ]; then
  uv venv --python 3.11 mark17/.venv-tts
fi
uv pip install --no-cache --python mark17/.venv-tts/bin/python \
  -r mark17/max_voice/requirements-mlx.txt

echo "MAX Voice installed. First neural start downloads the 8-bit model."
