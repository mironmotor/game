# QUICKSTART — GAME MARKET CORE

Get from zero to a validated (or honestly rejected) strategy. **Stage 1–6 run
on the Python standard library — no pip installs required.**

## 0. Prerequisites

- Python 3.10+
- For REAL data: a machine with open outbound network (the cloud sandbox this
  was built in blocks exchange/news APIs, so it auto-falls back to synthetic).

```bash
cd game_market_core
python3 main.py            # should print a backtest summary on synthetic data
```

### Run EVERYTHING with one command

```bash
cd game_market_core
./run_quickstart.sh        # runs all 7 steps below, prints ✓/✗ per step
```

This needs no pip installs, no network, and no API keys. When it finishes, open
`reports/output/dashboard.html` in a browser.

## 1. The honest workflow (run in this order)

```bash
# 1) Backtest — does the idea even survive costs/slippage/funding?
python3 main.py
python3 main.py --mode conservative          # 0.5% risk, 1x leverage

# 2) Walk-forward — does it survive OUT-OF-SAMPLE (the real test)?
python3 main.py walkforward

# 3) Train + OOS-gate the ML models (they stay inert unless they beat baselines)
python3 main.py train all                     # filter + regime + news + gbm

# 4) Paper trade with news + dashboard (simulated fills)
python3 main.py paper --ml                    # writes reports/output/dashboard.html

# 5) Portfolio across symbols (see diversification)
python3 main.py portfolio

# 6) Probe live feeds + execution safety gates (sends NO orders)
python3 main.py livecheck
```

Open `reports/output/dashboard.html` in a browser after `paper` — or run the
live web dashboard:

```bash
python3 main.py serve            # then open http://127.0.0.1:8000
python3 main.py serve --ml       # with the approved ML filter (run `train` first)
```

## 2. Switch to REAL data (network required)

Edit `config.yaml`:

```yaml
data:
  source: exchange        # was: synthetic
  venue: binance          # or bybit
  symbol: BTCUSDT
  timeframe: 1h
  start_date: 2019-01-01
macro:   { enabled: true } # S&P/Nasdaq/gold/dollar regime context (Stooq)
news:    { enabled: true } # GDELT + RSS
onchain: { enabled: true } # blockchain.info network data
```

Then re-run the workflow above. Real OHLCV is cached under `data/storage/` so
later runs work offline. If a fetch is blocked you'll see a `403` and a clean
fallback message — that means the network, not the code, said no.

Then ask the real questions:

```bash
python3 main.py --source exchange             # real backtest
python3 main.py walkforward                   # real out-of-sample
python3 main.py train all                     # do the models earn approval on real data?
```

## 3. What the results mean

- A green **single backtest** proves plumbing, not edge.
- **Walk-forward** is the first real evidence. If OOS collapses, it was overfit.
- **Paper trading** is the gate before any live capital.
- The **scam detector** flags anything that looks too good (too few trades,
  implausible Sharpe/ROMI, missing costs).
- **Capacity matters:** market impact is ~0 bps at $10k but can be hundreds of
  bps at $10M+. A strategy can be real AND un-scalable.

Realistic expectation (framing, not a promise): a genuinely validated crypto
edge usually lands in the single-digits-to-low-tens of percent per month
*before* degradation — with real drawdowns. **Sustained 100–300%/mo at safe
risk is not a credible target**, and every report says so.

## 4. Going live (deliberately hard)

Real orders flow only through `execution/execution_adapter.py` and require ALL:

```yaml
execution:
  live: true
  i_understand_risk: true
  venue_client_enabled: true
  test_only: true          # keep true first: validates via exchange TEST endpoint
```

plus `GMC_API_KEY` / `GMC_API_SECRET` in the environment, and a non-`godmode_research`
risk mode. Default is **dry-run** (validates + logs, sends nothing). Flip
`test_only: false` only after a deliberate review. `godmode_research` can never
place a live order by design.

```bash
export GMC_API_KEY=...   GMC_API_SECRET=...
python3 main.py livecheck        # confirm every gate before trusting it
```

### The honest $20 path (Bybit testnet first → tiny mainnet)

1. **Testnet (fake money, zero risk).** Make a Bybit **testnet** key at
   testnet.bybit.com, then:
   ```yaml
   execution: { live: true, i_understand_risk: true, venue: bybit,
                venue_client_enabled: true, testnet: true }
   ```
   ```bash
   export GMC_API_KEY=<testnet key>  GMC_API_SECRET=<testnet secret>
   python3 main.py livecheck         # should show venue=bybit testnet=true, live_enabled=true
   ```
   Orders now hit Bybit **testnet** — real plumbing, play funds.
2. **Paper-match for a week or two** and confirm fills behave like the backtest.
3. **Only then** mainnet with a tiny balance (e.g. $20): set `testnet: false`,
   use real Bybit keys, keep risk `conservative` (0.5%/trade ≈ $0.10). At $20
   this is to watch real orders flow, **not** to earn — the edge is ~0.4%/mo.
   `godmode_research` can never place a live order.

## 5. In the Game app (Next.js)

The dashboard is embedded as a tab: run `npm run dev`, open the 📈 button in the
HUD (or go to `/market`). Toggle ML filter / Max advisor / Max LLM live. The
`/api/market` route runs the Python and returns the dashboard.
