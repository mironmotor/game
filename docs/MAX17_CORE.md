# The Max17 Cognitive Core

`mark17/` is the internal package name for **Max17**, GAME's deterministic
cognitive core. It is a standalone Python package with no ML framework and
no required external API calls — every subsystem has a rule-based
deterministic path, with an optional LLM layer that can be enabled on top.

## Product principle

> Every Max17 answer should increase the user's contact with reality, not
> reduce it.

Concretely: good responses push toward real-world action, body awareness,
creation, work, money, live relationships, and honest self-understanding.
A response that only keeps the user inside the system waiting for "the
system" to say something profound is treated as a product failure, even if
it's polished. This is encoded as a literal constant in
`mark17/principles.py` (`REALITY_CONTACT_PRINCIPLE`) and used by the
deterministic responder to bias its output.

## Why deterministic-first

Every subsystem below has a rule-based fallback that requires no network
call and no API key. This means:

- `npm run dev` works fully offline (except for LLM-backed chat, which
  degrades gracefully to a template response)
- the test suite (`mark17/test_*.py`) runs in CI with no secrets
- behavior is reproducible — the same input always produces the same
  output on the deterministic path, which made it possible to write
  seed-based reproducibility tests for the World Model
  (`mark17/test_world_model.py`)

An LLM bridge (OpenRouter, MiniMax, or local Ollama) can be layered on top
per-subsystem via `MAX17_LLM_ENABLED=true` — see
[docs/DEPLOYMENT.md](DEPLOYMENT.md#environment-variables).

## Subsystem map

| Module | What it does |
| --- | --- |
| `hippocampus.py` | SQLite keyword memory — the baseline "does the core remember this" layer |
| `vector_memory.py` | Experimental semantic memory: deterministic local token hashing + a small domain synonym map + cosine similarity. No transformer model, no external API. |
| `synapse_graph.py` | A weighted association graph between events, memories, routes, and adaptations. Repeated relations raise `evidence_count` and strengthen `weight`. Powers `/maxgraph`. |
| `consolidation.py` | "Sleep mode" — reads recent memories + strong synapse-graph edges, groups repeated themes, writes stable `consolidated_pattern` memories back, and mirrors them into vector memory. |
| `compression.py` | Deduplicates near-identical memory/synapse entries using Dice-coefficient similarity over crude word stems (default threshold `0.20`). |
| `critic.py` | Self-evaluation: every core action produces a score and an "antiparticle" counter-evaluation; a `remember` event is only written when the pair doesn't fully annihilate — see [World Model](VOICE_AND_VISION.md#world-model-the-core-learns-what-its-world-looks-like) for how this same mechanic funds particle matter. |
| `cognitive_physics.py` | Three physics metaphors mapped onto the core's own machinery: **Standard Model** typing of every event into a "knowledge quantum" (generation, flavour, charge, spin, mass), **Maxwell induction** for non-blocking communication between the plasticity/memory/LLM cores, and **Yang-Mills confinement** gating when the "Council" of sub-cores may emit a verdict. |
| `genesis.py` | A literal cosmological model of the core's own age: the "ether" (`permittivity`/`permeability`, `c = 1/√(εμ)`, impedance `Z = √(μ/ε)`), a cooling universe that passes through inflation → quark-gluon plasma → hadronization → nucleosynthesis → recombination → structure over its first real year, and baryon asymmetry (why anything survives annihilation at all). Powers the World Model's laws. |
| `world_model.py` | 3D-world awareness for the core — see the dedicated writeup in [docs/VOICE_AND_VISION.md](VOICE_AND_VISION.md#world-model-the-core-learns-what-its-world-looks-like). |
| `voice_state.py` | Reads a speaker's arousal/valence/tension from acoustic features (pitch, register, brightness, jitter, energy) relative to a per-person learned baseline. |
| `planner.py` | Builds day-by-day task plans from a goal (powers `/autoplan`). |
| `dream_sim.py` | Generates chaotic-attractor simulation parameters from a prompt (powers `/simulation`). |
| `decoder.py` | Deterministic session flavor for the SHA-256 brute-forcer (powers `/decoder`). |
| `introspect.py` | Gathers real self-facts (memory stats, recent actions, top synapse relations) and produces a mood/focus/priority readout (powers `/mind`). |
| `ingest.py` | Scores lines of pasted text against a user interest string; keeps what's relevant (powers `/inbox`). |
| `big_idea.py` | The funnel's idea synthesizer (powers `/funnel` and `/tg`). |
| `attractor_core.py` | Models the core's own attention as a fractal-eye attractor (`z_{n+1} = sin(Re z² + a) + i·cos(Im z² + b)` — a complex-square map wrapped in trig). Its Lyapunov exponent tells you whether attention is converging (`λ < 0`) or scattering (`λ > 0`). |
| `fluid_flow.py` | Treats cognitive load as an incompressible fluid — a literal Navier–Stokes metaphor for HUD state (`ρ(∂v/∂t + v·∇v) = −∇p + μ∇²v + f`): density = what's being carried (memories/synapses/tasks), viscosity = uncertainty ("doubt makes thought thick"), and the Reynolds number decides whether the HUD renders calm laminar streamlines or turbulent chaos. |
| `web_sense.py` | Handles the `web` event — lets Max read a URL pasted into chat, or search when it doesn't know enough. Blocks requests to localhost/internal networks (SSRF protection: a chat link like `http://127.0.0.1:8790/` cannot make the core hit its own internal services), plus hard time and size caps per fetch. |
| `snn_core.py` / `snn_stdp_demo*.py` | A small spiking-neural-network core with an STDP (spike-timing-dependent plasticity) learning demo. |
| `meta_controller.py` / `plasticity_bridge.py` / `daemon.py` | Routing, the plasticity ("attention") subsystem, and the long-running brain object (`Mark17Brain`) that wires everything together. |
| `responder.py` | The deterministic text responder that applies the reality-contact principle. |
| `llm_bridge.py` | The optional LLM layer — OpenRouter, MiniMax, or local Ollama, selected by `MAX17_LLM_PROVIDER`. |
| `ratelimit.py` | Flood/brute-force protection for the HTTP bridge. |
| `json_cli.py` | The single entry point every event flows through — reads one JSON event from stdin (or is called directly by the API route), dispatches to the right handler, and prints one JSON response. |
| `server.py` | Wraps `json_cli.py`'s logic behind HTTP (`GET /health`, `POST /event`) so a hosted service without a local Next.js process can run the core — see [deployment](DEPLOYMENT.md#deploying-the-max17-bridge). |

## How an event flows through the core

1. The frontend calls `sendMax17Event({ type, ...payload })`
   (`lib/max17-client.ts`), which `POST`s to `/api/max17`.
2. `app/api/max17/route.ts` validates the event type against an allowlist
   (see [docs/API_REFERENCE.md](API_REFERENCE.md) for the full list), then
   either:
   - **spawns `python3 mark17/json_cli.py`** directly and pipes the event
     as JSON over stdin (local dev, or any deployment target that can run
     Python), or
   - **proxies over HTTP** to a hosted bridge (`MAX17_BRIDGE_URL`) running
     `mark17/server.py` — required on Vercel, since serverless functions
     there cannot spawn `python3`.
3. `json_cli.py` dispatches on `event.type` to a `_handle_*` function
   (e.g. `_handle_world_state`, `_handle_introspect`), which touches the
   relevant subsystem(s) above, updates the synapse graph, and returns one
   JSON object.
4. The Next.js route normalizes the response into a stable shape
   (`route`, `memory`, `plasticity`, `llm`, `confidence`, `next_adaptation`,
   plus mode-specific keys like `voice`, `world`, `plan`, `graph`) and
   returns it to the browser.

## Running the core standalone

```bash
# One event, no LLM, throwaway state directory:
echo '{"type":"introspect"}' | python3 mark17/json_cli.py --no-llm --ephemeral

# Persistent state directory:
MAX17_STATE_DIR=/path/to/state python3 mark17/json_cli.py <<< '{"type":"introspect"}'

# As an HTTP service:
python3 -m mark17.server   # listens on :8000 — GET /health, POST /event
```

## Testing

Each major subsystem has a standalone test file (stdlib `assert`-based, no
pytest needed):

```bash
python3 mark17/test_genesis.py
python3 mark17/test_world_model.py
python3 mark17/test_cognitive_physics.py
python3 mark17/test_attractor_core.py
python3 mark17/test_voice_state.py
```

The smoke test exercises a realistic multi-event session end to end:

```bash
npm run max17:smoke
```

## Sleep / consolidation

```bash
npm run max17:sleep
```

Reads recent memories and strong synapse-graph associations, groups
repeated themes, and writes stable `consolidated_pattern` memories back —
a deterministic compression pass, not autonomous background processing.

Next: [docs/API_REFERENCE.md](API_REFERENCE.md) for the full event
reference, or [docs/VOICE_AND_VISION.md](VOICE_AND_VISION.md) for how the
voice/world subsystems feed the 3D modes.
