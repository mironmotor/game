# GAME MARKET CORE

A **research → backtest → paper-trading** crypto system, built in the spirit
of the Game / Max core. Its job is **not** to promise returns. Its job is to
take a hypothesis — including the ambitious "100–300% ROMI per month" target —
and **try as hard as possible to disprove it** with costs, drawdown, slippage,
regime shifts, survivorship bias, and Monte Carlo before anything touches real
money.

> **No financial promises. No reckless gambling bot.** An edge must be proven
> on history, then survive out-of-sample, then walk-forward, then paper
> trading, and only then may it be wired to live trading behind hard limits.

It is a re-imagining of the MT4 EA `ExpertFinalStage3_Enhanced.mq4` (adaptive
risk, ATR/time/performance multipliers, 2%/6% risk caps, max 3 daily trades,
W1/D1 trend logic, BPU/BSU levels, ATR-75% false-breakout model, spread/news
filters, trade lifecycle, dashboard) — rebuilt as a modular Python crypto
research platform.

---

## 1. Honest goal framing

The user's target is **100–300% ROMI/month**. The system treats that as a
**hypothesis to be tested, not a setting to be dialed in.** Every report
states the measured monthly ROMI, compares it to the target, and gives a
realistic range. Sustained triple-digit monthly returns at controlled risk are
not a credible objective; the platform is designed to say so out loud when the
numbers don't support the dream — and to flag any result that *does* hit the
target as far more likely to be overfitting/leakage than a real edge.

## 2. Architecture

```
game_market_core/
  config.py / config.yaml      # zero-dependency config (stdlib YAML fallback)
  main.py                      # pipeline orchestrator + CLI
  datatypes.py                 # Candle, Signal, Trade

  data/loaders/                # crypto (synthetic+CSV), macro, news, realtime
  data/storage/                # SQLite/CSV persistence

  features/                    # market (full), macro/news/onchain (stubs),
                               # internal_state (risk temperature)

  strategies/                  # false_breakout (full), trend/news/mean-rev/
                               # vol-expansion (stubs), meta_controller

  risk/                        # risk_engine, position_sizing, kill_switch
  backtest/                    # engine, metrics, scam_detector,
                               # walk_forward + monte_carlo
  ml/                          # regime/trade-filter/news models + training
  paper/                       # portfolio, journal, paper_trader
  dashboard/                   # strategy-health dashboard
  reports/                     # markdown report generator
```

**Data flow (Stage 1):**
`load data → market features → meta controller (False Breakout) → risk engine
→ backtest (with fees/slippage/spread/funding) → metrics → scam detector →
markdown report`.

### Design guarantees that keep results honest
- **No look-ahead:** every feature at bar `i` uses only candles `≤ i`; signals
  fire at the **close of `i`** and fill at the **open of `i+1`**.
- **Costs are mandatory:** taker fees, slippage, half-spread, and perpetual
  funding are applied to every fill. A frictionless backtest is treated as a
  bug (the scam detector flags zero-cost runs).
- **Pessimistic fills:** when a bar straddles both stop and target, the **stop**
  is assumed to fill first.
- **Risk is the anchor:** position size is derived from stop distance so a
  stop-out costs a fixed % of equity, then capped by leverage and cooled by the
  internal "risk temperature".

## 3. Roadmap (realistic)

| Stage | Scope | Status |
|---|---|---|
| **1** | Architecture, config, synthetic data, market features, False Breakout engine, risk engine, backtest, metrics, scam detector, report | ✅ |
| **2** | Real OHLCV loaders (Binance/Bybit REST + cache + fallback), macro/equities loader (Stooq) as regime context, rule-based regime classifier, Trend engine, regime-gated Meta Controller, walk-forward validation | ✅ |
| **3** | News layer (GDELT/RSS + lexicon scoring + synthetic fallback), News Shock Engine with chaos veto, paper trading on the live-feed abstraction, journal + daily/weekly reports + strategy-health HTML dashboard | ✅ |
| **4** | Pure-Python ML trade-filter with strict OOS approval gate, on-chain layer (blockchain.info), live REST polling feed, execution adapter behind hard live limits (dry-run by default) | ✅ |
| **5** | Live websocket feed (stdlib RFC 6455), learned regime (vol-forecaster) + news-impact models with OOS gates vs baselines, signed venue order client (test-endpoint, fully gated) | ✅ |
| **6** | Gradient-boosted-trees filter (gated vs logistic + take-all OOS), multi-symbol portfolio backtest with diversification, size-dependent market-impact slippage (capacity), on-chain large-flow proxy | ✅ |
| **7** | Sequence model (Elman RNN + BPTT, pure stdlib) gated OOS, cross-symbol risk budgeting (inverse-vol + portfolio kill), order-book microstructure, keyed exchange-flow/whale hook | ✅ |
| **8+** | Transformer/attention sequence models, full L2 order-book replay, live multi-symbol paper execution, capital-curve compounding study | ⬜ |

## 4. Data needed

- **Market physics (1940→2026):** S&P/Dow/Nasdaq, Gold, Oil, USD index, rates,
  inflation, recessions, major wars/crises, volatility & liquidity regimes —
  used to learn *cross-era market physics* (panic, euphoria, liquidity
  expansion/contraction, trend vs mean-reversion, black swans), not to trade
  crypto on 1940s equities.
- **Crypto (2009→2026):** BTC/ETH/alts OHLCV, market cap, volume, funding,
  open interest, liquidations, stablecoin supply, dominance, exchange flows,
  order book where available.
- **Real-time:** exchange websockets; candles 1m–1d; order-book imbalance,
  spread, volatility, volume spikes, funding changes, liquidation maps.
- **News/world events:** GDELT, RSS (central banks/exchanges/regulators),
  economic calendars, regulation/ETF/SEC events, hacks/exploits. Social
  sentiment **only** via an authorized API whose terms permit it.

## 5. APIs that can be connected (free/public tiers exist)

- **Macro:** FRED (rates, CPI, USREC recession flag), Stooq / Yahoo Finance.
- **Crypto market data:** Binance / Bybit / OKX public REST + websocket
  (read-only, no keys needed for market data).
- **On-chain:** blockchain.com charts, mempool.space, Glassnode/CryptoQuant
  free tiers.
- **News:** GDELT 2.0, public RSS, public ICS economic calendars.

> Live **trading** (placing orders) requires API keys and is gated behind the
> risk engine and paper-trading validation. Market-data reads do not.

## 6. Risks (named, not hidden)

- **Overfitting / data leakage / survivorship bias** — the scam detector and
  walk-forward exist specifically to catch these.
- **Regime shift** — an edge in one regime can invert in another; results are
  reported per-regime in Stage 2.
- **Liquidity / slippage / capacity** — high-ROMI "edges" often assume fills
  that don't exist at size.
- **Leverage = ruin risk** — `godmode_research` shows what high leverage *looks*
  like but **can never place a live order** (`allow_live = False`).
- **Black swans** — synthetic data and Monte Carlo include jump shocks; real
  tails are worse. The kill switch halts trading at the max-drawdown limit.

## 7. Run instructions

**Requirements:** Python 3.10+. **Stage 1 needs no third-party packages.**

```bash
cd game_market_core
python3 main.py                       # backtest on synthetic data
python3 main.py walkforward           # out-of-sample walk-forward validation
python3 main.py paper                 # paper trading + news + HTML dashboard
python3 main.py train                 # train + OOS-gate the ML trade filter
python3 main.py train all             # filter + regime + news + gbm + seq models
python3 main.py backtest --ml         # apply the best approved ML filter (inert if none)
python3 main.py portfolio             # multi-symbol portfolio (risk parity + kill)
python3 main.py serve                 # live web dashboard at http://127.0.0.1:8000
python3 main.py serve --ml --port 9000  # served, with the approved ML filter
python3 main.py livecheck             # probe REST + websocket feeds + execution gates
python3 main.py --source exchange     # pull real Binance history (cache + fallback)
python3 main.py --mode conservative   # 0.5% risk, 1x leverage
python3 main.py --mode aggressive     # 1.5x risk (capped 3%/trade)
python3 main.py --mode godmode_research  # high leverage, RESEARCH ONLY (no live)
```

### Real data

**Default is now `data.source: coinmetrics`** — real daily BTC back to 2010
from the CoinMetrics community dataset on GitHub (`raw.githubusercontent.com`),
**no API key needed**, with REAL on-chain series (exchange netflow, active
addresses, fees). It's reachable even where exchanges are geo-blocked. The raw
CSV is cached under `data/storage/`, and if GitHub is unreachable it falls back
to synthetic. Caveat: this dataset is **daily close only** (no intraday wicks),
so it mainly exercises the Trend engine + regime, not the wick-based False
Breakout engine. Set `data.cm_asset` (e.g. `eth`) for other assets.

**For intraday (1h/15m) real data** — needed so the wick-based False Breakout
engine fires — fetch from an exchange where it's reachable:

```bash
python3 main.py --source exchange --venue bybit --timeframe 1h
python3 main.py --source exchange --venue binance --timeframe 15m
```

`--venue`/`--timeframe` override config. No keys needed; chain is **live fetch
→ CSV cache → synthetic**. If your network blocks one venue (Binance is often
geo-blocked), try `bybit`, or drop a CSV (`ts,open,high,low,close,volume`) at
`data/storage/<symbol>_<tf>.csv` and run `--source csv`. Set
`macro.enabled: true` to pull the
S&P/Nasdaq/gold/dollar basket (Stooq) as **regime context** — risk-on/off and
crisis flags that gate crypto trading, not separately traded instruments.

### Regime gating

The rule-based regime classifier labels each bar `trend` / `euphoria` /
`crisis` / `range`. The Meta Controller uses it: **range → False Breakout**,
**trend/euphoria → Trend engine**, **crisis → no new entries**, and **News
Shock may speak in any non-crisis regime**. So the mean-reversion and trend
engines never fight each other.

### News & paper trading

`python3 main.py paper` runs the **same** engine as backtest (so results are
comparable) but through the live-feed abstraction (`ReplayFeed`), with news
wired in. The news layer pulls **GDELT + RSS** (titles scored by a transparent
lexicon → sentiment/severity/novelty/entities); offline it falls back to a
deterministic synthetic stream aligned to the candle range. The **News Shock
Engine** trades only high-severity, high-novelty, directional events and
**refuses on news chaos** (contradictory strong events) — which is also an
independent risk-off veto for every engine. Outputs land in `reports/output/`:
`dashboard.html` (strategy-health snapshot), `paper_report.md` (daily/weekly +
health), and `paper_journal.csv`. Swapping `ReplayFeed` for a real
websocket/REST feed (Stage 4) is the only change needed to go live.

### ML trade filter (it must earn the right to act)

`python3 main.py train` collects every executed signal's feature snapshot +
outcome, time-splits the trades (60% train / 40% test, no shuffling), fits a
pure-Python logistic regression, tunes its threshold on train only, then
**gates on test**: the model is marked `approved` *only* if it improves
out-of-sample expectancy versus taking every signal **and** still takes enough
trades. Otherwise it ships **inert** (never vetoes). `--ml` loads it; an
unapproved model changes nothing. So ML can never silently degrade the system,
and a result that "looks great" on a handful of trades is rejected by design.
### Learned regime & news models (Stage 5)

`python3 main.py train all` also trains two models with **real, future-derived
ground truth** (not circular rule-mimicry):

* **regime model** (`ml/regime_model.py`) — forecasts whether the next
  `horizon` bars will be more volatile than the recent trailing average. Gated
  against a **persistence** baseline OOS.
* **news-impact model** (`ml/news_model.py`) — predicts whether a significant
  price move follows a high-severity event within `K` bars. Gated against a
  **majority-class** baseline OOS.

Both ship inert unless they beat their baseline out-of-sample. On synthetic
data they correctly do **not** (regime beats persistence by <1%, news ties
majority), so they stay inert — the honest result.

### Live websocket feed

`data/loaders/ws_feed.py` is a minimal stdlib RFC 6455 client (handshake +
frame decode + ping/pong, no `websockets` dependency) that streams finalized
candles from Binance behind the same `ExchangeFeed` interface. `livecheck`
probes it. A real exchange-flow/whale on-chain feed and gradient-boosted models
are the Stage 6 upgrades.

### Real venue order client (still fully gated)

`execution/venue_client.py` builds HMAC-SHA256-signed Binance orders. It is
only reachable once **every** execution gate passes (above) **and**
`execution.venue_client_enabled: true` **and** API keys are present — and even
then defaults to the exchange **test endpoint** (`execution.test_only: true`,
validates without executing). Going truly live is a deliberate, auditable
config change, never a silent default.

### Stage 6 — GBM, portfolio, capacity

* **Gradient-boosted filter** (`ml/gbm.py`): a pure-stdlib GBT trade filter,
  trained by `python3 main.py train gbm`. It is approved only if it beats BOTH
  take-all AND the logistic baseline out-of-sample with enough trades;
  `load_model` then prefers the approved GBM over the logistic filter.
* **Multi-symbol portfolio** (`python3 main.py portfolio`): runs the engine per
  symbol on an equal capital slice and combines the equity curves, reporting
  the **diversification gain** (portfolio max drawdown vs the average
  single-symbol drawdown).
* **Capacity / market impact** (`costs.impact_coeff`): fills pay extra slippage
  that scales with order notional / bar dollar-volume — ~0 bps for small
  accounts, hundreds of bps at size. This is why an edge can be real yet
  un-scalable, and why "just add leverage / more capital" fails.
* **On-chain large-flow proxy**: `OnchainContext` adds a `whale_z` signal
  (keyed exchange-flow/whale feeds slot in behind their providers later).

### Stage 7 — sequence model, risk budgeting, microstructure

* **Sequence model** (`ml/seq_model.py`): a tiny Elman RNN trained with real
  backpropagation-through-time (pure stdlib, no numpy) that reads a window of
  recent log-returns and predicts the next bar's direction. `python3 main.py
  train seq`. Approved only if it beats BOTH a majority and a "predict last
  move" baseline out-of-sample — on near-random returns it does **not** (it
  ships inert), which is the honest evidence that price is not predictable from
  price alone.
* **Cross-symbol risk budgeting** (`portfolio.risk_budget: inverse_vol`):
  capital is allocated inversely to each symbol's volatility (risk parity), and
  a **portfolio-level kill** (`portfolio.max_drawdown`) halts the whole book if
  combined drawdown breaches the cap.
* **Order-book microstructure** (`data/loaders/orderbook.py`,
  `features/microstructure.py`): depth-snapshot order-book imbalance and
  spread, used by the live spread filter; `livecheck` probes it.
* **Keyed exchange-flow/whale** (`load_keyed_flows`): Glassnode/CryptoQuant
  netflow loads automatically when `GMC_GLASSNODE_KEY` is set, else the free
  `whale_z` proxy stands in.

### Max integration (the Game's cognitive core)

`integrations/max_bridge.py` wires the **Max core (`mark17`)** into the trading
loop — honestly, as a *risk second opinion + desk analyst*, never a price
oracle:

* a **Max-style risk critic** (transparent thresholds, same spirit as
  `mark17/critic.py`) vetoes trades on ORTHOGONAL real signals — on-chain
  exchange netflow contradicting the direction, news chaos, crisis regime — and
  notes low risk-temperature. It can only block/down-weight, never invent edge.
* **Max's real LLM bridge** (`mark17.llm_bridge`, local Ollama) writes a
  natural-language desk note explaining the call. Offline it degrades to a
  deterministic explanation — no dependency.

```bash
python3 main.py max            # run with Max active; prints his verdict + vetoes
python3 main.py serve --max    # dashboard with a "Max desk note" panel
```
Turn on the LLM note by setting `max.llm: true` (needs Ollama running locally:
`ollama serve && ollama pull qwen2.5:0.5b`). Max is opt-in; without `--max`/
`max.enabled` nothing changes.

See **[QUICKSTART.md](QUICKSTART.md)** for the end-to-end workflow and how to
switch to real data.

### Going live — the hard gates

Real orders flow only through `execution/execution_adapter.py`, which refuses
unless **all** hold: `execution.live` + `execution.i_understand_risk` +
non-`godmode_research` risk mode + `GMC_API_KEY`/`GMC_API_SECRET` in the
environment + a concrete venue client (intentionally **not** shipped). Default
is dry-run: orders are validated against risk limits and logged, never sent.
`python3 main.py livecheck` shows the live-feed status and every gate without
sending anything.

Outputs:
- console summary (returns, win rate, R, drawdown, Sharpe/Sortino, ruin prob,
  integrity flags);
- a timestamped markdown report in `reports/output/`;
- the trade journal `reports/output/trades.csv`.

To use **real data** instead of synthetic, set in `config.yaml`:
```yaml
data:
  source: csv
  csv_path: data/storage/BTCUSDT_1h.csv   # columns: ts,open,high,low,close,volume
```

## 8. Risk modes

| Mode | Risk/trade | Max leverage | Live orders |
|---|---|---|---|
| `conservative` | 0.5% | 1x | allowed |
| `balanced` (default) | 1% | 3x | allowed |
| `aggressive` | 1.5% (cap 3%) | config | allowed |
| `godmode_research` | 10%+ | 10x+ | **forbidden — research only** |

## 9. What a result is NOT

A green Stage-1 backtest on synthetic data proves the **plumbing and
discipline** work — nothing about a real edge. Before any live capital:
real data → out-of-sample → walk-forward → paper trading → live with hard
limits. The report restates this every time.
