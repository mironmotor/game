<div align="center">
<img width="1200" height="475" alt="GAME banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# GAME — Reality Creator

GAME is a gamified HUD for an AGI-style assistant ("Max"), built on a
deterministic, from-scratch cognitive core called **Max17**
(`mark17/` — no ML framework, no required external API). One Next.js
frontend serves 19 modes: a mission/XP HUD with chat, a Big Idea funnel, a
voice-reactive 3D world where speaking literally creates matter, a liquid
audio visualizer, chaotic-attractor simulations, webcam hand-tracking
visualizers, a real SHA-256 proof-of-work visualizer, a self-awareness
readout, a synapse-graph explorer, and more.

Every mode is free and requires no sign-in — see
[GODMODE](docs/GAME_MODES.md#godmode).

Originally scaffolded in [Google AI Studio](https://ai.studio/apps/dcf78fd2-d064-4f32-a65f-e4dbd1128e38);
this repository is where it actually lives and grows now.

Built solo by a creator from Russia, coded over the course of a year.

## Quick start

```bash
git clone https://github.com/mironmotor/game.git
cd game
npm install
cp .env.example .env.local   # add an LLM key if you want chat/funnel to work
npm run dev
```

Open **http://localhost:3000**. Full walkthrough, including the optional
Python core: [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md).

## Documentation

| Doc | Covers |
| --- | --- |
| [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) | Step-by-step local setup, running tests, troubleshooting |
| [docs/GAME_MODES.md](docs/GAME_MODES.md) | All 19 modes: what each one does, its route, its core files |
| [docs/MAX17_CORE.md](docs/MAX17_CORE.md) | The cognitive core architecture — memory, synapse graph, cognitive-physics metaphors, principles |
| [docs/VOICE_AND_VISION.md](docs/VOICE_AND_VISION.md) | The voice/audio subsystem: Voice Signature, Quantum Eyes, the Efir 3D world, MAX VISION, and the World Model that lets the core know what's in the 3D world |
| [docs/API_REFERENCE.md](docs/API_REFERENCE.md) | Every `/api/max17` event type, with request/response examples |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Vercel, GitHub Pages, deploying the Max17 bridge, custom domains, environment variables |

## What makes this different from a typical AI chat app

- **Deterministic-first core.** Every subsystem in `mark17/` has a
  rule-based path that needs no network call and no API key — an LLM layer
  is optional and sits on top. This means the whole app, including its
  test suite, runs fully offline.
- **A real cognitive model, not a chatbot skin.** The core keeps an actual
  weighted synapse graph (`/maxgraph`), a per-person voice baseline that
  learns over time (`/efir`'s Sound Signature), and a genuine
  self-introspection pass over its own memory (`/mind`) — none of it is
  scripted per demo.
- **Physics, not metaphor-as-decoration.** The core's "ether" physics
  (`c = 1/√(εμ)`, impedance, cosmological epochs — see
  [`mark17/genesis.py`](mark17/genesis.py)) isn't flavor text: it's the
  literal equation set that throttles how expensive it is for a voice-driven
  3D world to create new matter, computed live from how dense that world
  has become. See [docs/VOICE_AND_VISION.md](docs/VOICE_AND_VISION.md#world-model-the-core-learns-what-its-world-looks-like).
- **No particle cap, by design.** The 3D/audio-reactive modes rasterize
  particles into a pixel buffer instead of issuing one draw call per
  particle, so population is bounded by physics (birth rate vs. lifetime),
  not an arbitrary limit — tens of thousands of particles at interactive
  frame rates.

## Tech stack

- **Frontend:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS 4
- **Core:** Python 3 + NumPy, stdlib-only beyond that (SQLite for
  persistence, no ML framework)
- **Auth/data:** Firebase (Auth + Firestore) — optional, gated by
  [GODMODE](docs/GAME_MODES.md#godmode)
- **Deployment:** Vercel (primary, full app) + GitHub Pages (secondary,
  static client-side showcase) — see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

## Contributing

Issues and pull requests are welcome. Before opening a PR:

```bash
npm run lint
npx tsc --noEmit
npm run build
for f in mark17/test_*.py; do python3 "$f"; done
```

This repository does not currently declare an open-source license; all
rights are reserved by default unless a `LICENSE` file is added.
