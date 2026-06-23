#!/usr/bin/env bash
# One-shot launcher for GAME MARKET CORE.
# Runs the whole Stage 1-7 pipeline on synthetic data: NO pip installs, NO
# network, NO API keys needed. Just: ./run_quickstart.sh
#
# To use REAL data instead, edit config.yaml (data.source: exchange,
# macro/news/onchain: enabled) on a machine with open network — see QUICKSTART.md.

set -u
cd "$(dirname "$0")"
PY="${PYTHON_BIN:-python3}"
fail=0

step () {
  local title="$1"; shift
  echo
  echo "════════════════════ ${title} ════════════════════"
  if "$@"; then
    echo "  ✓ ok"
  else
    echo "  ✗ FAILED (exit $?)"; fail=1
  fi
}

echo "GAME MARKET CORE — quick start ($("$PY" --version 2>&1))"

step "1/7  Backtest (synthetic)"        "$PY" main.py
step "2/7  Walk-forward (out-of-sample)" "$PY" main.py walkforward
step "3/7  Train all ML models"          "$PY" main.py train all
step "4/7  Paper trading + dashboard"    "$PY" main.py paper --ml
step "5/7  Multi-symbol portfolio"       "$PY" main.py portfolio
step "6/7  Backtest with ML filter"      "$PY" main.py backtest --ml
step "7/7  Live + execution gate check"  "$PY" main.py livecheck

echo
if [ "$fail" -eq 0 ]; then
  echo "ALL STEPS OK ✓"
else
  echo "SOME STEPS FAILED ✗ (see above)"
fi
echo "Dashboard:  reports/output/dashboard.html"
echo "Reports:    reports/output/"
exit "$fail"
