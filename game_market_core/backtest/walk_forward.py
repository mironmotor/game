"""Walk-forward validation (Stage 2 stub).

Plan: split history into rolling train/test windows, (re)fit parameters on
each train window, evaluate ONLY on the untouched test window, and stitch
the out-of-sample segments into one equity curve. In-sample brilliance that
collapses out-of-sample is the single most common way strategies fool their
authors; walk-forward is the antidote and is REQUIRED before paper trading.
"""

from __future__ import annotations


def walk_forward(*args, **kwargs):
    raise NotImplementedError("Walk-forward validation arrives in Stage 2.")
