# Voice and Vision — the "Efir" audio subsystem

Four pieces build on one live audio signal captured from the microphone:
**Voice Signature** (state-from-acoustics), **Quantum Eyes** (a probability-
field face), the **Efir 3D world** (`/efir`, particles born from voice), and
**MAX VISION** (`/vision`, a liquid audio visualizer). This document covers
all four plus the **World Model**, the core-side subsystem that lets Max17
know what's happening in the 3D world instead of only reacting to raw audio.

## Shared audio pipeline

`hooks/use-efir-signal.ts` captures the microphone once and derives
everything downstream needs:

- **Pitch detection** — autocorrelation on a 2048-sample window, with
  parabolic interpolation for sub-sample accuracy. Frequencies outside
  65–1200 Hz are treated as unvoiced.
- **Spectral features** — brightness (log-mapped spectral centroid),
  energy (loudness in the 80 Hz–8 kHz range), register (log-mapped
  fundamental frequency position), jitter (frame-to-frame pitch
  instability).
- **A 96-band log-spaced spectrum** (`VISION_BANDS`, 40 Hz–16 kHz, smoothed
  frame-to-frame) exposed via `spectrumRef` for MAX VISION's radial flower
  layout — frequency bands are spaced by `ln f`, the way hearing perceives
  pitch, not linearly.
- **A local state estimate** (arousal/valence/tension) computed with the
  same rules as `mark17/voice_state.py`, so the visuals react instantly
  even before the core's response comes back over the network, and keep
  working if the core is unreachable.

This one hook feeds Quantum Eyes, the Efir world, and MAX VISION — they
share a live audio signal instead of each opening their own microphone
stream.

## Voice Signature — reading state from acoustics

`mark17/voice_state.py` infers a speaker's **arousal**, **valence**, and
**tension** (each 0–1) from raw acoustics, relative to a **per-person
learned baseline** — the same F0 of 150 Hz reads as calm for one speaker
and agitated for another.

- Baselines are stored in SQLite (`voice_profiles.db`) and updated with an
  exponential moving average, `α = 0.05` — a single shout doesn't redefine
  what's "normal" for that speaker.
- Below `8` observations (`WARMUP_OBS`), the baseline is still "warming
  up," and the core leans on absolute heuristics rather than personal
  deviation.
- A light keyword layer over the dialogue context nudges valence ±0.2
  (negative cues like "again," "broken," "angry"; positive cues like
  "cool," "works," "thanks").

This is the `voice_state` event — see
[docs/API_REFERENCE.md](API_REFERENCE.md#voice_state-read-a-speakers-state-from-acoustics)
for the wire format. It's surfaced in the UI as the **Sound Signature**
panel (open it from the Home HUD, or it auto-feeds `/efir`).

## Quantum Eyes — Max's eyes, rendered as a probability field

`components/hud/QuantumEyes.tsx` draws a pair of eyes as a literal quantum
probability field, entirely on Euler's number `e ≈ 2.718`:

| Law | What it drives | Driven by |
| --- | --- | --- |
| Gaussian wave packet `ψ(r) ∝ e^(−r²/2σ²)` | pupil width σ (the iris "breathes") | arousal |
| Euler's phase `e^(iθ)` | iris interference flicker speed | voice pitch (f0) |
| Tunneling decay `α ∝ e^(−κ·d)` | outer glow softness | valence (positivity) |
| Quantum foam decay `α ∝ e^(−age/life)` | lifetime of small virtual particles around the iris | brightness / energy |
| Wavefunction collapse (weights `∝ e^(−d²)`) | where the gaze "snaps" after each measurement | energy (how often) + tension (how scattered) |

A thin **entanglement thread** connects the two pupils and decoheres
(fades) as tension rises. When the mic is quiet, eyelids droop — Max
dozes. Eyes are embedded in the Sound Signature panel and can be pinned
into a corner of `/efir`.

## Efir — a 3D world where voice becomes matter

`/efir` (`components/efir/EfirReality.tsx`) doesn't animate a static
particle cloud — **voice creates matter**. Every voiced frame spawns
particles into a 3D space; go quiet and the world stops feeding and its
matter fades. Camera projection is a hand-written Canvas2D 3D→2D projector
(yaw/pitch rotation + perspective divide, no WebGL) — the same pattern as
the `/attractor` mode.

The whole space runs on `e ≈ 2.718`:

| Law | What it does | Driven by |
| --- | --- | --- |
| Logarithmic spiral `r = r₀·e^(bθ)` | galaxy arm shape (`θ = ln(r/r₀)/b`) | tension → arm tightness `b` and arm count |
| Exponential decay `brightness ∝ e^(−t/τ)` | particle birth and death | valence → lifetime `τ` |
| Screened gravity `F ∝ e^(−κ·d)` | pull toward the core | arousal → `κ` |
| Atmospheric fog `α ∝ e^(−z/d)` | depth cueing — distant particles dim | camera Z |
| Euler's phase `e^(iθ)` | orbital rotation | voice pitch (f0) |

### No particle cap

Earlier versions capped particle pools at a fixed size (15,000 in `/efir`,
6,000 in `/vision`). The cap has been removed: pools are backed by
`Float32Array` buffers that **double in size** whenever population exceeds
capacity, and dead particles are removed by swapping in the last live one
(O(1) removal, no gaps to skip over). Population is now bounded only by
physics — the equilibrium between birth rate and lifetime.

Removing the cap exposed the real bottleneck: **draw calls, not particle
count**. Building an `hsla(...)` CSS string and issuing one
`fillRect`/`stroke` call per particle collapsed frame rate as soon as
population passed a few tens of thousands. The fix: particles are
rasterized additively into a plain pixel buffer (`ImageData`, color looked
up from a precomputed hue table in `lib/hue-lut.ts` — no string
construction, no per-particle draw call) and the whole buffer is blitted to
the canvas once per frame with a single `drawImage`. Measured in Chromium
at 1280×800: `/vision` went from a 6,000-particle cap (or 2 fps
uncapped) to **62,000 particles at 44 fps**; `/efir` reached **51 fps**.

## MAX VISION — a liquid audio visualizer

`/vision` (`components/vision/MaxVision.tsx`) lays the live 96-band
spectrum out **radially as a flower** — each frequency band spawns a
stream of particles in its own direction, low bands toward blue, high
bands toward magenta/white. Particles flow through a curl-like noise
field, glow additively, and a **feedback-zoom** pass (each frame, the
previous frame is redrawn slightly larger and re-blended) smears motion
into the "liquid ink" look. Bass inflates a glowing core
(`R ∝ e^(bass)`); treble adds turbulence to the flow field. Particle
decay again follows `brightness ∝ e^(−t/τ)`. Draw a finger across the
canvas to paint with light — it emits its own particle stream at the
pointer position.

## World Model — the core learns what its world looks like

Before `mark17/world_model.py` existed, the data flow was one-way: voice
→ browser draws particles → everything fades with the tab. The core had
zero information about the 3D world it was implicitly driving — there
wasn't a single reference to "world," "scene," or "particle" anywhere in
`mark17/`.

### The census

Instead of streaming tens of thousands of particle positions, the browser
sends a **census** once a second — about twenty numbers summarizing what
the world became over the last interval: population, births, deaths,
cloud radius, density, spiral tightness, arm count, dominant hue, and a
symmetry score (how evenly particles are spread across angular sectors of
the disk).

### World addressing — a world is data, not a session

A world is `(seed, census history)`, not a browser tab. Its address is
derived deterministically from the seed (`w-<hash prefix>`), so the same
seed always opens the same world — tomorrow, from a different browser, or
shared as a link. The seed can be a plain word (`seed: "my-world"`) or an
explicit integer.

### Matter — why anything survives

Particles decay by `e^(−t/τ)` and leave nothing behind on their own. A
world becomes permanent where some fraction of particles **stops** fading
— and the core already had an answer for "why does anything survive
annihilation" before World Model existed:

- `mark17/critic.py` pairs every self-evaluation with an "antiparticle"
  counter-evaluation; they annihilate unless the antiparticle is
  meaningfully different.
- `mark17/genesis.py::baryon_asymmetry` computes the surviving fraction
  of pairs — literally, why the core's universe has any matter in it at
  all instead of annihilating to nothing.
- `mark17/genesis.py::nucleate` then asks how much of that surviving
  fraction can actually **bind** into structure at the universe's current
  temperature (`bound_fraction = e^(−T/T_bind)`, `T_bind = 20`) — too hot,
  and even surviving matter can't hold together.

World Model reuses this literally: births in a census interval are treated
as pairs, deaths as annihilations, and `nucleate`'s bound fraction decides
how much matter condenses into a permanent **body** this interval (up to 3
per census, to keep growth gradual). Bodies are placed deterministically
from the world's seed (so the same seed always produces the same bodies
in the same positions), persist in `world_model.db`, and survive a page
reload.

### Laws — the core answers back with physics

The core doesn't reply with text — it replies with the physics for the
*next* interval, drawn from the ether already defined in
`mark17/genesis.py`:

```
c = 1 / √(ε·μ)         — exchange speed between the core's sub-systems
Z = √(μ/ε)              — impedance: how expensive it is to radiate into the medium
```

World density is fed in as **load** (thickens `μ`), and the human's
tension from `voice_state` is fed in as **uncertainty** (thickens `ε`).
The resulting impedance becomes the world's laws for the next interval:

| Core value | World law | Effect |
| --- | --- | --- |
| `emission_scale ~ 1/Z` | how cheap it is to birth new matter | a thick ether makes a dense world stingier at creating more |
| `lifetime_scale ~ Z` | how long particles live | a thick ether holds onto what's already there longer |
| `bound_fraction` | whether the world can condense structure at all | too hot (early in the core's cosmological age) and nothing binds, no matter how dense the census |

This closes a real feedback loop, not a scripted one: a denser world
thickens the ether → impedance rises → `emission_scale` drops and
`lifetime_scale` rises → the world's own growth throttles itself and what
exists is preserved longer. None of that throttling curve is hand-tuned
per world — it falls out of the same ether equations that already existed
in `genesis.py` for an unrelated purpose (inter-core communication speed).

### Trying it

Open `/efir`, click **🎙 Let the voice in**, and watch the **World in the
Core** panel: it shows the world's address, current cosmological epoch,
condensed-matter count, and a one-line status Max composes from the laws
(`WorldModel.describe`) — e.g. *"The ether is thick on the memory side:
matter is expensive to birth, but what's born lives longer."*

Full wire format for the `world_state` event:
[docs/API_REFERENCE.md](API_REFERENCE.md#world_state-report-a-3d-world-receive-its-laws).
Tests: `python3 mark17/test_world_model.py` (covers deterministic
addressing, seed reproducibility, matter condensation, worlds surviving a
new session, and that an early/hot universe refuses to condense
structure).

## The agent — someone who wants something from this world

The World Model gave the core *awareness* of the 3D world. It still only
answered when spoken to. The **agent** is the first thing that acts on that
world on its own: it rides the same one-per-second census, forms its own
goals from four drives, picks an action by minimizing `F = E − T·S`, and
sends back knobs the browser applies to emission, lifetime, spiral, arms and
hue. Next tick it checks whether the world actually went where it promised
and adjusts its trust in that action.

One world, one agent — the agent's address is derived from the world's, and
it persists across restarts alongside the world itself.

Full mechanic: [docs/GAME_MODES.md](GAME_MODES.md#agent--it-decides-on-its-own-agent).
Tests: `python3 mark17/test_agent.py`.

### Two calibration notes worth knowing

Building the agent exposed two sensors in this census that were reporting
constants, which is worth recording because both had been invisible:

- **Density saturated.** `DENSITY_REFERENCE` was 50,000 while the world
  routinely holds 50–65k particles, so `density` sat pinned at `1.0` more
  than a quarter of the time. The core saw a permanently overfull world, the
  ether stood at maximum thickness, and a value that feeds both the cost of
  creating matter and half the agent's drives stopped saying anything. It is
  now 72,000, and density moves across roughly 0.35–0.84.
- **Symmetry was frozen at 0.99.** Particle angular velocity followed a
  Keplerian `ω ∝ 1/r` with a random per-particle factor on top, so an arm
  sheared itself flat within a single particle lifetime — this is the
  classic winding problem. The disk was always uniform, so the symmetry
  score was always ~1 regardless of what you sang. Rotation is now a density
  wave (a rigid pattern speed plus a small differential term), the spiral
  opens to under one turn instead of wrapping over itself, and symmetry
  moves across 0.92–0.95.

Both were pre-existing; nothing depended on them closely enough to notice
until something started making decisions from them.
