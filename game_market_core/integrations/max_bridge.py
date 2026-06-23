"""Max17 advisor — integrates the Max core (mark17) into the trading loop.

Two things from Max are wired in, HONESTLY:

  * His real LLM bridge (``mark17.llm_bridge.LlmBridge`` → local Ollama) writes
    a natural-language "desk note" explaining the current decision. When Ollama
    isn't running it degrades to a deterministic explanation — no dependency.

  * A Max-style RISK CRITIC (same philosophy as ``mark17/critic.py`` +
    ``meta_controller.py``: transparent confidence thresholds) gives a second
    opinion using REAL signals — on-chain exchange netflow, the strategy's own
    risk temperature, news chaos, regime. Its verdict can only SKIP/down-weight
    a trade, never create one.

What this is NOT: a price oracle. The LLM cannot predict markets and is never
asked to. Max adds reasoning, explanation, and a sanity veto — that is its
honest job (and matches Max's own principle: increase contact with reality).
"""

from __future__ import annotations

import os
import sys

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
        self._llm = None
        self.veto_count = 0
        self.last_ctx: dict | None = None
        self.last: dict | None = None

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
                    "llm_status": "none", "veto_count": self.veto_count}
        note = dict(self.last)
        note["veto_count"] = self.veto_count
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
            "returns; only judge the RISK of taking this trade.\n"
            f"Proposed trade: {ctx.get('strategy')} {ctx.get('side')} in a "
            f"{ctx.get('regime')} regime, signal confidence {ctx.get('confidence'):.2f}.\n"
            f"Exchange netflow z-score: {oc.get('exchange_netflow_z', 0.0)} "
            "(positive = coins moving TO exchanges = sell pressure).\n"
            f"Strategy risk temperature: {ctx.get('risk_temp')}, "
            f"drawdown: {ctx.get('drawdown')}, loss streak: {ctx.get('loss_streak')}.\n"
            f"My rule-based verdict is {verdict['verdict']} because: {verdict['rationale']}.\n"
            "Explain in plain language whether this is sensible and what to watch."
        )
