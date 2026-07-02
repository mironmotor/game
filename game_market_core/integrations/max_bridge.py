"""Max17 advisor — integrates the Max core (mark17) into the trading loop.

Three things from Max are wired in, HONESTLY:

  * His real LLM bridge (``mark17.llm_bridge.LlmBridge`` → local Ollama) writes
    a natural-language "desk note" explaining the current decision. When Ollama
    isn't running it degrades to a deterministic explanation — no dependency.

  * A Max-style RISK CRITIC (same philosophy as ``mark17/critic.py`` +
    ``meta_controller.py``: transparent confidence thresholds) gives a second
    opinion using REAL signals — on-chain exchange netflow, the strategy's own
    risk temperature, news chaos, regime. Its verdict can only SKIP/down-weight
    a trade, never create one.

  * Max owns CAPITAL PRESERVATION, independent of the Risk Engine's own kill
    switch — defense in depth, so a bug in one layer doesn't sink the account:
      - a monthly PROFIT LOCK: once the current month's return reaches
        ``monthly_target_pct``, Max stands down for the rest of the month
        (protects a good month from being given back by over-reaching);
      - a HARD CIRCUIT BREAKER on Max's own, independently-tracked drawdown:
        once breached it is STICKY — Max refuses every trade from then on,
        even if the Risk Engine's kill switch has a bug or is misconfigured.

What this is NOT: a price oracle. The LLM cannot predict markets and is never
asked to. Max adds reasoning, explanation, a sanity veto, and a second,
independent line of defense against blowing up the account — that is its
honest job (and matches Max's own principle: increase contact with reality).
"""

from __future__ import annotations

import os
import sys
import time

# Make the Max core (mark17, at the repo root) importable.
_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


class MaxAdvisor:
    def __init__(self, cfg: dict):
        m = cfg.get("max", {})
        self.enabled = bool(m.get("enabled", False))
        self.use_llm = bool(m.get("llm", False))
        self.model = m.get("model", "qwen2.5:0.5b")
        # Capital preservation — independent of the Risk Engine.
        self.monthly_target_pct = float(m.get("monthly_target_pct", 10.0))
        self.hard_drawdown_breaker_pct = float(m.get("hard_drawdown_breaker_pct", 0.20))
        self._llm = None
        self.veto_count = 0
        self.last_ctx: dict | None = None
        self.last: dict | None = None

        # Max's own equity bookkeeping (does NOT read risk.state — a second,
        # independent measurement, so it can catch what the Risk Engine misses).
        self._peak_equity = 0.0
        self._month_key: tuple[int, int] | None = None
        self._month_start_equity = 0.0
        self._month_return_pct = 0.0
        self._profit_locked = False
        self._halted = False
        self._halt_reason = ""

    def on_equity(self, ts: int, equity: float) -> None:
        """Called every bar (mirrors RiskEngine.on_equity) so Max tracks its
        own peak/drawdown and monthly return, independent of the risk engine."""
        self._peak_equity = max(self._peak_equity, equity)
        if self._peak_equity > 0 and not self._halted:
            dd = (self._peak_equity - equity) / self._peak_equity
            if dd >= self.hard_drawdown_breaker_pct:
                self._halted = True
                self._halt_reason = (
                    f"Max circuit breaker: drawdown {dd:.1%} >= "
                    f"{self.hard_drawdown_breaker_pct:.0%} — trading halted for capital preservation"
                )

        t = time.gmtime(ts)
        key = (t.tm_year, t.tm_mon)
        if key != self._month_key:
            self._month_key = key
            self._month_start_equity = equity
            self._profit_locked = False
        if self._month_start_equity > 0:
            self._month_return_pct = (equity / self._month_start_equity - 1.0) * 100.0
            if self.monthly_target_pct > 0 and self._month_return_pct >= self.monthly_target_pct:
                self._profit_locked = True

    def _llm_bridge(self):
        if self._llm is None and self.use_llm:
            try:
                from mark17.llm_bridge import LlmBridge
                self._llm = LlmBridge(model=self.model, enabled=True)
            except Exception:
                self._llm = False  # import failed; don't retry
        return self._llm or None

    # ---- Max-style deterministic risk critic (numpy-free) ------------------
    def _critic(self, ctx: dict) -> tuple[str, float, list[str]]:
        reasons: list[str] = []
        verdict = "TRADE"
        conf = float(ctx.get("confidence", 0.5))

        # Capital preservation comes FIRST and overrides everything else —
        # this is Max's core job per the user's instruction: never let the
        # bot blow up, even at the cost of skipping good-looking setups.
        if self._halted:
            return "SKIP", 0.0, [self._halt_reason]
        if self._profit_locked:
            return "SKIP", 0.0, [
                f"profit lock: month-to-date {self._month_return_pct:+.1f}% already "
                f">= target {self.monthly_target_pct:.0f}% — standing down to protect the gain"
            ]

        oc = ctx.get("onchain") or {}
        nf = float(oc.get("exchange_netflow_z", 0.0) or 0.0)
        side = ctx.get("side")
        if oc.get("available"):
            if side == "long" and nf > 1.0:
                verdict = "SKIP"
                reasons.append(f"heavy exchange INFLOWS (netflow z={nf:+.1f}) = sell pressure into a long")
            elif side == "short" and nf < -1.0:
                verdict = "SKIP"
                reasons.append(f"heavy exchange OUTFLOWS (z={nf:+.1f}) = accumulation against a short")

        # Internal risk temperature is already handled by the Risk Engine (it
        # sizes down after losses). Max only NOTES it as caution — never vetoes
        # on it, to avoid a doom loop (low temp -> veto all -> never recover).
        rt = float(ctx.get("risk_temp", 1.0))
        if rt < 0.35 and verdict != "SKIP":
            verdict = "CAUTION"
            conf *= 0.85
            reasons.append(f"risk temperature {rt:.2f} — desk suggests smaller size")

        if (ctx.get("news") or {}).get("chaos"):
            verdict = "SKIP"
            reasons.append("news chaos — too contradictory to act")
        if ctx.get("regime") == "crisis":
            verdict = "SKIP"
            reasons.append("crisis regime — risk off")

        if not reasons:
            reasons.append(f"{ctx.get('regime')} regime, {ctx.get('strategy')} "
                           f"{side} @ conf {conf:.2f} — no red flags")
        return verdict, max(0.0, min(1.0, conf)), reasons

    def advise(self, ctx: dict) -> dict:
        """Fast, deterministic verdict used inside the backtest loop."""
        verdict, conf, reasons = self._critic(ctx)
        self.last_ctx = ctx
        self.last = {"verdict": verdict, "confidence": round(conf, 2),
                     "rationale": "; ".join(reasons), "llm_status": "deterministic"}
        if verdict == "SKIP":
            self.veto_count += 1
        return self.last

    def explain(self) -> dict:
        """One natural-language read of the most recent context, via Max's LLM
        if available (else the deterministic rationale). For the dashboard / CLI."""
        if self.last is None:
            return {"verdict": "n/a", "rationale": "no decisions yet",
                    "llm_status": "none", "veto_count": self.veto_count,
                    "halted": self._halted, "month_return_pct": round(self._month_return_pct, 2),
                    "monthly_target_pct": self.monthly_target_pct,
                    "profit_locked": self._profit_locked}
        note = dict(self.last)
        note["veto_count"] = self.veto_count
        note["halted"] = self._halted
        note["month_return_pct"] = round(self._month_return_pct, 2)
        note["monthly_target_pct"] = self.monthly_target_pct
        note["profit_locked"] = self._profit_locked
        bridge = self._llm_bridge()
        if bridge is not None and self.last_ctx is not None:
            resp = bridge.ask(self._prompt(self.last_ctx, self.last))
            note["llm_status"] = resp.status
            if resp.ok:
                note["rationale"] = resp.text.strip()
        return note

    def _prompt(self, ctx: dict, verdict: dict) -> str:
        oc = ctx.get("onchain") or {}
        return (
            "You are Max, a risk-focused crypto trading desk analyst. Be concise "
            "(<=4 sentences), concrete, and honest. Do NOT predict price or promise "
            "returns; only judge the RISK of taking this trade. Your top priority is "
            "capital preservation — never let the account blow up.\n"
            f"Proposed trade: {ctx.get('strategy')} {ctx.get('side')} in a "
            f"{ctx.get('regime')} regime, signal confidence {ctx.get('confidence'):.2f}.\n"
            f"Exchange netflow z-score: {oc.get('exchange_netflow_z', 0.0)} "
            "(positive = coins moving TO exchanges = sell pressure).\n"
            f"Strategy risk temperature: {ctx.get('risk_temp')}, "
            f"drawdown: {ctx.get('drawdown')}, loss streak: {ctx.get('loss_streak')}.\n"
            f"Month-to-date return: {self._month_return_pct:+.1f}% "
            f"(profit-lock target {self.monthly_target_pct:.0f}%). "
            f"Capital-preservation circuit breaker: {'HALTED' if self._halted else 'armed'}.\n"
            f"My rule-based verdict is {verdict['verdict']} because: {verdict['rationale']}.\n"
            "Explain in plain language whether this is sensible and what to watch."
        )
