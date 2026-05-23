"""Минимальный LIF + STDP на NumPy (plasticity layer)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

DEFAULT_NUM_INPUTS = 16
DEFAULT_NUM_HIDDEN = 32
BETA = 0.9
THRESHOLD = 0.5
A_PLUS = 0.01
A_MINUS = -0.012


def lif_step(x: np.ndarray, v: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
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
    return np.clip(w + potentiation + depression, 0.0, 1.0)


@dataclass
class StepResult:
    input_spikes: np.ndarray
    hidden_spikes: np.ndarray
    hidden_activation: float
    mean_weight: float


class PlasticityNetwork:
    def __init__(
        self,
        num_inputs: int = DEFAULT_NUM_INPUTS,
        num_hidden: int = DEFAULT_NUM_HIDDEN,
        seed: int = 42,
    ) -> None:
        rng = np.random.default_rng(seed)
        self.num_inputs = num_inputs
        self.num_hidden = num_hidden
        self.w = rng.random((num_inputs, num_hidden)).astype(np.float32) * 0.1
        self.v_hidden = np.zeros(num_hidden, dtype=np.float32)
        self.step_count = 0

    def step(self, x: np.ndarray) -> StepResult:
        x = np.asarray(x, dtype=np.float32).reshape(-1)
        if x.shape[0] != self.num_inputs:
            raise ValueError(f"expected {self.num_inputs} inputs, got {x.shape[0]}")

        i_syn = x @ self.w
        spike_hidden, self.v_hidden = lif_step(i_syn, self.v_hidden)
        self.w = stdp_update(self.w, x, spike_hidden)
        self.step_count += 1

        return StepResult(
            input_spikes=x,
            hidden_spikes=spike_hidden,
            hidden_activation=float(spike_hidden.mean()),
            mean_weight=float(self.w.mean()),
        )

    def save(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(
            path,
            w=self.w,
            v_hidden=self.v_hidden,
            step_count=self.step_count,
            num_inputs=self.num_inputs,
            num_hidden=self.num_hidden,
        )

    @classmethod
    def load(cls, path: Path, seed: int = 42) -> PlasticityNetwork:
        if not path.exists():
            return cls(seed=seed)
        data = np.load(path)
        net = cls(
            num_inputs=int(data["num_inputs"]),
            num_hidden=int(data["num_hidden"]),
            seed=seed,
        )
        net.w = data["w"].astype(np.float32)
        net.v_hidden = data["v_hidden"].astype(np.float32)
        net.step_count = int(data["step_count"])
        return net
