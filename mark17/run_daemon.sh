#!/bin/bash
# Запуск из любой директории: bash mark17/run_daemon.sh
# или из mark17/: bash run_daemon.sh

MARK17="$(cd "$(dirname "$0")" && pwd)"
cd "$MARK17" || exit 1
exec python3 daemon.py -i --pretty "$@"
