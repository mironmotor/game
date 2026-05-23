"""
Mark 17 — минимальный SNN с LIF + упрощённым STDP.
Цель: 100–5000 нейронов, CPU-only, continual learning без backprop.
Запуск: python snn_stdp_demo.py
"""

from __future__ import annotations

import argparse
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import torch
from snntorch import spikegen

# === ПАРАМЕТРЫ (маленькие, MacBook Air 2015) ===
NUM_INPUTS = 10
NUM_HIDDEN = 20
NUM_OUTPUTS = 5  # зарезервировано под следующий слой
BETA = 0.9
THRESHOLD = 0.5

# STDP
A_PLUS = 0.01
A_MINUS = -0.012
TAU_PLUS = 20.0
TAU_MINUS = 20.0


def lif_neuron(
    x: torch.Tensor,
    v: torch.Tensor,
    *,
    threshold: float = THRESHOLD,
    beta: float = BETA,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Простой LIF: leak → порог → reset."""
    v = beta * v + x
    spike = (v > threshold).float()
    v = v * (1.0 - spike)
    return spike, v


def stdp_update(
    w: torch.Tensor,
    x: torch.Tensor,
    spike_hidden: torch.Tensor,
    *,
    a_plus: float = A_PLUS,
    a_minus: float = A_MINUS,
) -> torch.Tensor:
    """
    Упрощённый STDP (event-based, без eligibility traces).
    pre&post → potentiation; post без pre → depression.
    """
    if spike_hidden.sum() == 0:
        return w

    # outer: x[i] * spike_hidden[j]
    potentiation = torch.outer(x, spike_hidden) * a_plus
    depression = torch.outer(torch.ones_like(x), spike_hidden) * (a_minus * 0.5)
    # depression только там, где не было co-activation
    mask_no_pre = (x.unsqueeze(1) == 0) & (spike_hidden.unsqueeze(0) > 0)
    w = w + potentiation
    w = w + depression * mask_no_pre.float()
    return torch.clamp(w, 0.0, 1.0)


def run_demo(
    num_steps: int = 100,
    seed: int = 42,
    out_dir: Path | None = None,
) -> dict[str, float]:
    torch.manual_seed(seed)
    out_dir = out_dir or Path(__file__).resolve().parent / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    w = torch.rand(NUM_INPUTS, NUM_HIDDEN) * 0.1
    input_spikes = spikegen.rate(torch.rand(NUM_INPUTS), num_steps=num_steps)

    v_hidden = torch.zeros(NUM_HIDDEN)
    weight_history: list[float] = []

    print("Запускаем первый SNN с STDP...")
    print(f"  inputs={NUM_INPUTS}, hidden={NUM_HIDDEN}, steps={num_steps}")

    for t in range(num_steps):
        x = input_spikes[t]
        i_syn = x @ w
        spike_hidden, v_hidden = lif_neuron(i_syn, v_hidden)
        w = stdp_update(w, x, spike_hidden)
        weight_history.append(w.mean().item())

    mean_w = w.mean().item()
    print(f"Обучение закончено. Средний вес: {mean_w:.4f}")

    fig_path = out_dir / "stdp_avg_weight.png"
    plt.figure(figsize=(8, 4))
    plt.plot(weight_history)
    plt.title("Средний вес синапсов во времени (STDP)")
    plt.xlabel("Шаг")
    plt.ylabel("Средний вес")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(fig_path, dpi=120)
    plt.close()
    print(f"График сохранён: {fig_path}")

    return {"mean_weight": mean_w, "steps": num_steps, "plot": str(fig_path)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Mark17 STDP demo")
    parser.add_argument("--steps", type=int, default=100)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    run_demo(num_steps=args.steps, seed=args.seed)
