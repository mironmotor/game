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
| **1** | Architecture, config, synthetic data, market features, False Breakout engine, risk engine, backtest, metrics, scam detector, report | ✅ in this commit |
| **2** | Trend engine, regime classifier, walk-forward, full Monte Carlo, real OHLCV loaders (Stooq/exchange REST), macro features | ⬜ |
| **3** | News layer (GDELT/RSS), real-time websocket feeds, paper trading, web dashboard | ⬜ |
| **4** | ML meta-controller (regime + trade-filter models), on-chain features, exchange execution adapter behind hard live limits | ⬜ |

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
python3 main.py --mode conservative   # 0.5% risk, 1x leverage
python3 main.py --mode aggressive     # 1.5x risk (capped 3%/trade)
python3 main.py --mode godmode_research  # high leverage, RESEARCH ONLY (no live)
```

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
