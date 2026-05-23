"""
Mark 17 — тот же STDP+LIF, но только NumPy (без PyTorch).
Для MacBook Air 2015 и Python без torch wheels.
Запуск: python3 snn_stdp_demo_numpy.py
"""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np

NUM_INPUTS = 10
NUM_HIDDEN = 20
BETA = 0.9
THRESHOLD = 0.5
A_PLUS = 0.01
A_MINUS = -0.012


def rate_spikes(num_neurons: int, num_steps: int, rate: float = 0.3, seed: int = 42) -> np.ndarray:
    """Пуассоновские спайки: shape (steps, neurons)."""
    rng = np.random.default_rng(seed)
    return (rng.random((num_steps, num_neurons)) < rate).astype(np.float32)


def lif_neuron(x: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    v = BETA * v + x
    spike = (v > THRESHOLD).astype(np.float32)
    v = v * (1.0 - spike)
    return spike, v


def stdp_update(w: np.ndarray, x: np.ndarray, spike_hidden: np.ndarray) -> np.ndarray:
    if spike_hidden.sum() == 0:
        return w
    potentiation = np.outer(x, spike_hidden) * A_PLUS
    mask_no_pre = (x[:, None] == 0) & (spike_hidden[None, :] > 0)
    depression = mask_no_pre.astype(np.float32) * (A_MINUS * 0.5)
    w = w + potentiation + depression
    return np.clip(w, 0.0, 1.0)


def save_plot(weight_history: list[float], fig_path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    plt.figure(figsize=(8, 4))
    plt.plot(weight_history)
    plt.title("Средний вес синапсов (STDP, NumPy)")
    plt.xlabel("Шаг")
    plt.ylabel("Средний вес")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()
    plt.savefig(fig_path, dpi=120)
    plt.close()


def run_demo(num_steps: int = 100, seed: int = 42, plot: bool = True) -> None:
    rng = np.random.default_rng(seed)
    out_dir = Path(__file__).resolve().parent / "output"
    out_dir.mkdir(parents=True, exist_ok=True)

    w = rng.random((NUM_INPUTS, NUM_HIDDEN)).astype(np.float32) * 0.1
    input_spikes = rate_spikes(NUM_INPUTS, num_steps)
    v_hidden = np.zeros(NUM_HIDDEN, dtype=np.float32)
    weight_history: list[float] = []

    print("Запускаем SNN (NumPy) с STDP...")
    for t in range(num_steps):
        x = input_spikes[t]
        i_syn = x @ w
        spike_hidden, v_hidden = lif_neuron(i_syn, v_hidden)
        w = stdp_update(w, x, spike_hidden)
        weight_history.append(float(w.mean()))

    print(f"Обучение закончено. Средний вес: {w.mean():.4f}")

    csv_path = out_dir / "stdp_avg_weight.csv"
    with csv_path.open("w", newline="") as f:
        wtr = csv.writer(f)
        wtr.writerow(["step", "mean_weight"])
        for i, mw in enumerate(weight_history):
            wtr.writerow([i, mw])
    print(f"CSV: {csv_path}")

    if plot:
        try:
            fig_path = out_dir / "stdp_avg_weight_numpy.png"
            save_plot(weight_history, fig_path)
            print(f"График: {fig_path}")
        except Exception as e:
            print(f"График пропущен ({e}). Открой CSV или: python3 -m pip install matplotlib")


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--steps", type=int, default=100)
    p.add_argument("--seed", type=int, default=42)
    p.add_argument("--no-plot", action="store_true", help="только CSV, без matplotlib")
    args = p.parse_args()
    run_demo(num_steps=args.steps, seed=args.seed, plot=not args.no_plot)
