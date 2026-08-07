# Contributing

Issues and pull requests are welcome. This is a solo project, so the bar is
simple: keep it running, keep it honest.

## Setup

See [docs/GETTING_STARTED.md](docs/GETTING_STARTED.md) for the full
walkthrough. The short version:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Only the chat and idea-funnel modes need an LLM key. Every visual mode
works without one. The Python core (`mark17/`) is optional too — install it
with `python3 -m pip install -r mark17/requirements.txt` if you want to work
on memory, the synapse graph, or the World Model.

## Before opening a PR

```bash
npm run lint
npm run build
for f in mark17/test_*.py; do python3 "$f"; done
```

`npx tsc --noEmit` currently reports pre-existing errors in
`components/GameApp.tsx` and `lib/gemini.ts`. They're suppressed at build
time (`ignoreBuildErrors` in `next.config.ts`), so the build passes — just
don't add new ones on top.

## What's useful to work on

- **Performance in the visual modes.** The particle renderers rasterize into
  a pixel buffer rather than issuing a draw call per particle (see
  [docs/VOICE_AND_VISION.md](docs/VOICE_AND_VISION.md#no-particle-cap)).
  There's more headroom — WebGL for the 3D modes is an open direction.
- **The Python core.** Every subsystem in `mark17/` has a deterministic path
  with no network call. New subsystems should keep that property: an LLM
  layer may sit on top, never underneath.
- **Music, not just voice.** The audio pipeline (`hooks/use-efir-signal.ts`)
  is voice-centric — pitch, jitter, register. Beat/tempo detection and a
  chroma vector would let the worlds react to music properly.

## Conventions

- Match the surrounding code — comment density, naming, and idiom vary a
  little between the TypeScript frontend and the Python core; follow
  whichever file you're in.
- Python core: standard library only where possible (NumPy is the one
  dependency). No ML frameworks.
- New core subsystems get a standalone `mark17/test_<name>.py` in the same
  `assert`-based style as the existing ones — no pytest dependency.
