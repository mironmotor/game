"""Strategy-health dashboard.

Stage 3 renders a self-contained static HTML snapshot (no server, no JS
dependencies) plus a terminal summary. A live FastAPI/Streamlit server is the
optional Stage 4 upgrade — the data shapes here are the contract it will use.
"""

from __future__ import annotations

import html
import os
import time


def _sparkline(points: list[float], w: int = 640, h: int = 120) -> str:
    if len(points) < 2:
        return ""
    lo, hi = min(points), max(points)
    rng = (hi - lo) or 1.0
    step = w / (len(points) - 1)
    coords = " ".join(
        f"{i * step:.1f},{h - (p - lo) / rng * (h - 8) - 4:.1f}"
        for i, p in enumerate(points)
    )
    color = "#16c784" if points[-1] >= points[0] else "#ea3943"
    return (f'<svg width="{w}" height="{h}" viewBox="0 0 {w} {h}">'
            f'<polyline fill="none" stroke="{color}" stroke-width="2" points="{coords}"/></svg>')


def _row(label: str, value: str) -> str:
    return f"<tr><td class='k'>{html.escape(label)}</td><td class='v'>{html.escape(value)}</td></tr>"


def render_html(state: dict, path: str) -> str:
    m = state["metrics"]
    health = state["health"]
    flags = state["flags"]
    trades = state["recent_trades"]
    eq = state["equity_sample"]

    mn = state.get("max_note")
    max_html = ""
    if mn:
        vcolor = {"TRADE": "#16c784", "CAUTION": "#f0a020", "SKIP": "#ea3943"}.get(mn["verdict"], "#888")
        max_html = (
            '<h2>Max desk note</h2><div class="card">'
            f'<div style="margin-bottom:8px"><span class="sev" style="background:{vcolor}">'
            f'{html.escape(mn["verdict"])}</span> '
            f'<span class="k">vetoes: {mn.get("veto_count", 0)} · LLM: {html.escape(str(mn.get("llm_status","")))}</span></div>'
            f'<div style="font-size:13px;line-height:1.5">{html.escape(mn["rationale"])}</div></div>'
        )

    metric_rows = "".join([
        _row("Data source", str(state.get("source", "synthetic"))),
        _row("Risk mode", f"{m['risk_mode']} (live allowed: {m['allow_live']})"),
        _row("Total return", f"{m['total_return_pct']:.2f}%"),
        _row("Avg monthly ROMI", f"{m['avg_monthly_romi_pct']:.2f}%"),
        _row("Trades", str(m["num_trades"])),
        _row("Win rate", f"{m['winrate']:.1%}"),
        _row("Avg R", f"{m['avg_r']:.3f}"),
        _row("Profit factor", f"{m['profit_factor']:.2f}"),
        _row("Max drawdown", f"{m['max_drawdown_pct']:.2f}%"),
        _row("Sharpe / Sortino", f"{m['sharpe']:.2f} / {m['sortino']:.2f}"),
        _row("P(>50% DD) MC", f"{m['prob_large_drawdown']:.1%}"),
        _row("Kill switch", "TRIPPED — " + m["kill_reason"] if m["kill_tripped"] else "armed"),
    ])

    health_rows = "".join([
        _row("Recent win rate", f"{health['recent_winrate']:.1%}"),
        _row("Current drawdown", f"{health['drawdown']:.1%}"),
        _row("Risk temperature", f"{health['risk_temperature']:.2f}"),
        _row("Loss streak", str(health["loss_streak"])),
        _row("Signals proposed", str(health["signals_proposed"])),
        _row("Signals by engine", str(health["by_engine"])),
        _row("Entries by regime", str(health["by_regime"])),
        _row("News-chaos vetoes", str(health.get("news_chaos_bars", "n/a"))),
    ])

    sev_color = {"high": "#ea3943", "medium": "#f0a020", "info": "#16c784", "low": "#888"}
    flag_items = "".join(
        f"<li><span class='sev' style='background:{sev_color.get(f['severity'], '#888')}'>"
        f"{html.escape(f['severity'].upper())}</span> "
        f"<b>{html.escape(f['code'])}</b> — {html.escape(f['message'])}</li>"
        for f in flags
    )

    trade_rows = "".join(
        f"<tr><td>{html.escape(t['exit_date'])}</td><td>{html.escape(t['strategy'])}</td>"
        f"<td>{html.escape(t['side'])}</td><td class='{'pos' if t['pnl'] >= 0 else 'neg'}'>"
        f"{t['pnl']:.2f}</td><td>{t['r']:.2f}R</td><td>{html.escape(t['exit_reason'])}</td></tr>"
        for t in trades
    )

    doc = f"""<!doctype html><html><head><meta charset="utf-8">
<title>GAME MARKET CORE — Dashboard</title>
<style>
 body{{font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#0e1117;color:#e6e6e6;margin:0;padding:24px}}
 h1{{font-size:20px;margin:0 0 4px}} h2{{font-size:15px;color:#9aa4b2;margin:24px 0 8px}}
 .sub{{color:#9aa4b2;font-size:13px;margin-bottom:16px}}
 .grid{{display:flex;gap:24px;flex-wrap:wrap}}
 .card{{background:#161b22;border:1px solid #232a33;border-radius:10px;padding:16px;min-width:320px}}
 table{{border-collapse:collapse;width:100%}} td{{padding:4px 8px;font-size:13px;border-bottom:1px solid #232a33}}
 .k{{color:#9aa4b2}} .v{{text-align:right;font-variant-numeric:tabular-nums}}
 .pos{{color:#16c784}} .neg{{color:#ea3943}}
 ul{{list-style:none;padding:0}} li{{padding:6px 0;font-size:13px;border-bottom:1px solid #232a33}}
 .sev{{color:#fff;border-radius:4px;padding:1px 6px;font-size:11px;margin-right:6px}}
 .banner{{background:#23282f;border-left:4px solid #f0a020;padding:10px 14px;border-radius:6px;font-size:13px}}
</style></head><body>
<h1>GAME MARKET CORE — Strategy Health Dashboard</h1>
<div class="sub">Generated {time.strftime('%Y-%m-%d %H:%M:%S UTC', time.gmtime())} · PAPER TRADING (simulated fills) · not financial advice</div>
<div class="banner">Target framing: {state['target_low']}–{state['target_high']}% ROMI/mo is treated as a hypothesis to disprove. Measured avg monthly ROMI: <b>{m['avg_monthly_romi_pct']:.2f}%</b>.</div>
<h2>Equity curve</h2>
<div class="card">{_sparkline(eq)}</div>
<div class="grid">
 <div class="card"><h2 style="margin-top:0">Performance</h2><table>{metric_rows}</table></div>
 <div class="card"><h2 style="margin-top:0">Strategy health</h2><table>{health_rows}</table></div>
</div>
{max_html}
<h2>Integrity checks</h2>
<div class="card"><ul>{flag_items}</ul></div>
<h2>Recent trades</h2>
<div class="card"><table>
 <tr><td><b>Exit</b></td><td><b>Engine</b></td><td><b>Side</b></td><td><b>PnL</b></td><td><b>R</b></td><td><b>Reason</b></td></tr>
 {trade_rows or '<tr><td colspan=6>no trades</td></tr>'}
</table></div>
</body></html>"""

    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(doc)
    return path


def print_console(metrics: dict) -> None:
    print(f"Dashboard: total {metrics['total_return_pct']:.2f}% | "
          f"trades {metrics['num_trades']} | maxDD {metrics['max_drawdown_pct']:.2f}%")
