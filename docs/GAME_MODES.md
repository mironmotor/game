# Game Modes

GAME ships 22 modes, each its own route. Open the **△∞** floating menu
(bottom-right on any page) to jump between them, or go straight to a route.

All modes are free and require no sign-in — see [GODMODE](#godmode).

The authoritative list lives in [`lib/modes-catalog.ts`](../lib/modes-catalog.ts),
which both the △∞ menu and the `/modes` hub read. A few of the most
recently added modes are in that catalog but do not yet have a write-up
below.

## Quick reference

| Route | Name | Talks to the core? | One-line description |
| --- | --- | --- | --- |
| `/` | Home HUD | yes (`user_message`, `system_state`, `task_*`) | Missions, XP, and a chat with Max |
| `/funnel` | Big Idea Funnel | yes (`big_idea`) | Seed words → many raw sparks → one structured idea |
| `/agentmind` | Agent Mind — It Decides On Its Own | yes (`world_state` → `agent`) | The first autonomous inhabitant: it wants things from the world and acts, unprompted |
| `/efir` | Efir — Reality from Voice | yes (`voice_state`, `world_state`) | A 3D world where particles are born from your voice |
| `/vision` | MAX VISION | no (pure client audio viz) | A liquid, TouchDesigner-style visualizer driven by the mic |
| `/simulation` | Max Simulation | yes (`simulation`) | A particle cloud on a chaotic attractor, steered by a prompt |
| `/autoplan` | Autoplan | yes (`auto_plan`) | Turns a goal into a day-by-day task plan with XP |
| `/maxgraph` | Synapse Graph | yes (`synapse_graph`) | Visualizes the core's real weighted association graph |
| `/mind` | Self-Awareness | yes (`introspect`) | Max reports on its own memory, mood, and priorities |
| `/inbox` | Max Inbox | yes (`ingest`) | Pastes a stream of text; keeps what matches your interest |
| `/decoder` | Decoder | yes (`decode`) | A real SHA-256 proof-of-work brute-forcer, browser-side |
| `/quantum` | Quantum Dream | no (pure client) | Auto-rotating dream animations, no backend call |
| `/evolution` | Evolutionary Forge | no (pure client) | "Compile 1 trillion synapses" — a compressed 2000-year animation |
| `/attractor` | Chaos Abyss | no (pure client) | Interactive 3D strange attractors (Thomas, Lorenz, Aizawa, Halvorsen) |
| `/neurodance` | Chaos Neuro Dance | no (pure client) | Webcam hand tracking → fingertip trails as attractors |
| `/handbrain` | Neuro-Hand | no (pure client) | Webcam hand tracking with MediaPipe, stylized as a neural rig |
| `/splats` | Braindance | no (pure client) | A tiny Gaussian-Splatting-style 4D renderer |
| `/brain` | EdgeAI Neuro-Brain | no (pure client) | A classic layered neural-net visualizer (inputs → hidden → outputs) |
| `/tg` | Big Idea (Telegram) | yes (`big_idea`) | The funnel, restyled as a Telegram Mini App |
| `/pricing` | Pricing | — | Plan comparison (currently moot — see GODMODE) |

---

## Home HUD (`/`)

The main screen: a mission list with XP rewards, a rank/energy/focus HUD, and
a chat box wired to Max17. Sending a message emits a `user_message` event;
completing or creating a mission emits `task_completed` / `task_created`.
Voice input works through the browser's Speech Recognition API where
available, falling back to a raw "ear mode" (mic capture without
transcription) on browsers that don't support it (notably iOS Safari).

**Files:** `components/GameApp.tsx`, `components/hud/HudApp.tsx`,
`components/hud/GameHud.tsx`

## Big Idea Funnel (`/funnel`)

A three-stage funnel:

1. **Top (wide)** — pour in optional seeds: domain, audience, trend, twist.
2. **Middle (narrowing)** — the model generates many raw "sparks" (idea
   fragments).
3. **Bottom (one idea)** — sparks are synthesized into a single Big Idea:
   name, tagline, problem, solution, who it's for, why now, unfair
   advantage, first step, plus 0–10 boldness/scale scores.

Runs against the Max17 core when the bridge is reachable, or falls back to
calling OpenRouter/Gemini directly from the browser.

**Files:** `lib/funnel.ts`, `components/funnel/FunnelApp.tsx`,
`app/funnel/page.tsx`

## Agent Mind — It Decides On Its Own (`/agentmind`)

Everything else in GAME reacts: the browser sends an event, the core answers.
The Agent is the first thing in the project that **acts without being asked**.

It lives in the `/efir` world (same particles, same physics), and once a
second it does a full loop of its own:

1. **Perceive.** The world census it already receives — density, symmetry,
   turnover — plus your vocal tension, collapsed into four numbers.
2. **Want.** Four drives, each with a setpoint: *care* (wants you calm),
   *growth* (wants a populated world), *order* (wants structure), *novelty*
   (wants the world to keep moving).
3. **Choose.** It scores all seven actions by **Helmholtz free energy**:

   ```
   F = E − T·S
   ```

   `E` is how far the world is from what its drives want. `S` is the world's
   Shannon entropy. `T` is the agent's temperature, taken from your arousal
   and the thickness of the ether. It picks the action with the lowest `F`.

   That single equation is the whole explore/exploit switch — not two modes
   with a flag. When you're excited and the ether is thin, `T` is high, the
   `−T·S` term dominates, and the agent buys disorder: it scatters the world
   wide. When things settle, `T` collapses and it goes back to perfecting the
   structure. On roughly a third of all reachable world states, hot and cold
   agents choose *differently* — this is measured in `test_agent.py`, not
   asserted.

4. **Act.** The chosen action returns knobs the browser actually applies:
   emission rate, particle lifetime, spiral tightness, arm count, hue.
5. **Check.** Next tick it compares what it promised against where the world
   actually went, and moves its trust in that action up or down. Trust scales
   the action's claimed effect next time, so an action that lies stops winning.

Nothing here is an LLM call, and nothing is random — the same world state and
the same memory always produce the same choice.

### On judging direction, not position

The first version scored the agent on whether it predicted the world's next
*state*. Every action scored 0% accuracy and all trust collapsed to the floor
within a minute. The reason is structural: your voice moves this world an
order of magnitude harder than the agent does, so demanding an accurate state
prediction is demanding it predict *you*.

It now scores the **cosine between what it promised and where the world
actually moved**. Noise lands near 0.5 ("learned nothing", trust holds still),
a genuine steer scores above it, and pushing the world the wrong way scores
below. A world that doesn't move at all is a miss for any action that promised
movement.

### What the panel shows

Every number on screen is the agent's own: current action and its trust, the
live `F / E / T / S` readout, the four drives against their setpoints, **all
seven alternatives with their free energies** (it has to be able to explain
itself, not just decide), what it learned last tick, and its journal.

The agent is addressed by world — one world, one agent — and it persists in
SQLite, so it remembers its tick count, its journal, and everything it has
learned to trust across restarts.

**Files:** `mark17/agent.py`, `mark17/test_agent.py`,
`components/agent/AgentPanel.tsx`, `app/agentmind/page.tsx`

Not to be confused with `/agent`, which is the character-appearance studio —
that one is about how the agent *looks*, this one about what it *wants*.

## Efir — Reality from Voice (`/efir`)

Your voice doesn't just drive a visualization — it **creates matter**. Every
voiced frame spawns particles into a 3D world; go quiet and the world stops
feeding and fades. The whole space is built on Euler's number, `e ≈ 2.718`:
a logarithmic spiral (`r = r₀·e^(bθ)`) for the galaxy arms, exponential
decay (`brightness ∝ e^(−t/τ)`) for particle lifetime, screened gravity
(`F ∝ e^(−κ·d)`) pulling toward the core, and atmospheric fog
(`α ∝ e^(−z/d)`) for depth.

Once a second, the browser sends the core a **census** — not the particles
themselves, just ~20 numbers (population, births, deaths, radius, density,
spiral tightness, dominant hue, symmetry). The core replies with **laws**
for the next interval (how expensive it is to emit matter right now, how
long particles should live) computed from its own ether physics
(`c = 1/√(εμ)`, impedance `Z = √(μ/ε)`) — see
[World Model](VOICE_AND_VISION.md#world-model-the-core-learns-what-its-world-looks-like) for the full mechanic.
Matter that survives condenses into permanent bodies that outlive the page
reload.

Quantum Eyes (a small canvas rendering Max as a pair of probability-field
eyes) can be pinned into a corner of this view — same live audio signal,
same math.

**Try it:** open `/efir`, click **🎙 Let the voice in**, allow the
microphone, then talk or hum. Drag to orbit the camera.

**Files:** `components/efir/EfirReality.tsx`, `components/hud/QuantumEyes.tsx`,
`hooks/use-efir-signal.ts`, `mark17/world_model.py`. Full writeup:
[docs/VOICE_AND_VISION.md](VOICE_AND_VISION.md).

## MAX VISION (`/vision`)

A liquid, ink-in-water audio visualizer in the spirit of TouchDesigner. The
live spectrum (96 log-spaced bands, low → high mapped to a blue → magenta →
white palette) is laid out **radially as a flower** — each frequency band
spawns a stream of particles in its own direction. Particles flow through a
curl-like noise field, glow additively, and a feedback-zoom pass smears the
previous frame outward for the "liquid smoke" look. Bass inflates a glowing
core (`R ∝ e^(bass)`); treble adds turbulence to the flow field.

No particle cap: particles are rasterized straight into a pixel buffer (one
`putImageData`/`drawImage` per frame) instead of one canvas draw call per
particle, so tens of thousands of particles render at interactive frame
rates. Draw a finger across the canvas to paint with light.

**Try it:** open `/vision`, click **🎙 Let sound in**, then talk, sing, or
play music near the mic.

**Files:** `components/vision/MaxVision.tsx`, `lib/hue-lut.ts`,
`hooks/use-efir-signal.ts`. Full writeup:
[docs/VOICE_AND_VISION.md](VOICE_AND_VISION.md).

## Max Simulation (`/simulation`)

A 3D particle cloud on a chaotic attractor, parameterized by a text prompt
sent to the core (event `simulation`, handled by `mark17/dream_sim.py`).
The core picks attractor constants, color palette, and motion character
either deterministically or via an LLM, and the browser renders the
resulting particle system.

**Files:** `components/simulation/MaxSim.tsx`, `mark17/dream_sim.py`

## Autoplan (`/autoplan`)

Give the core a goal and a time horizon; it returns a day-by-day task plan
(MGR-1/2/3 difficulty tiers, XP values, a `first_move`, and a
`reality_check` per task) built by `mark17/planner.py`. Requires a working
core bridge — this is one of the two routes (with `/maxgraph`) that cannot
run meaningfully without Python, which is why production deployments need
the [Max17 bridge](DEPLOYMENT.md#deploying-the-max17-bridge).

**Files:** `components/autoplan/*`, `mark17/planner.py`

## Synapse Graph (`/maxgraph`)

A read-only visualization of the core's real weighted association graph
(`mark17/synapse_graph.py`) — nodes are events, memories, routes, and
adaptations; edges strengthen with repeated co-occurrence
(`evidence_count`, `weight`). This is not a mockup: every other mode that
talks to the core feeds this same graph.

**Files:** `components/maxgraph/*`

## Self-Awareness (`/mind`)

Sends an `introspect` event with no payload. The core gathers real facts
about itself — memory count and top memory types, recent actions, the
strongest synapse-graph relations — and returns a mood (deterministically
thresholded, e.g. "young" under 5 memories, "well-connected" when synapses
outnumber memories 2:1), a current focus, and a ranked list of next-action
priorities. Every introspection is written back into memory, so
introspecting reinforces the graph it's reporting on.

**Files:** `components/mind/SelfAwareness.tsx`, `mark17/introspect.py`

## Max Inbox (`/inbox`)

Paste a block of text (one item per line) plus a free-text "interest"
string. The core scores each line 0–1 against your interest (keyword-stem
matching plus an "importance signal" regex for deadlines, money amounts,
urgency words) and keeps everything above `score ≥ 0.34` into memory,
discarding the rest as noise. This is a stream filter, not a chatbot.

**Files:** `components/inbox/MaxInbox.tsx`, `lib/ingest.ts`,
`mark17/ingest.py`

## Decoder (`/decoder`)

A real, visible SHA-256 proof-of-work brute-forcer — no cryptocurrency
angle, just the mechanic made visible. The browser hashes
`<target>:<nonce>` (real SHA-256, `lib/sha256.ts`) at up to 900 hashes per
animation frame, looking for a hash with enough leading hex zeros. The
`decode` event asks the core only for session flavor — starting difficulty,
two hues, a short line of "thought," and a visual theme — all derived
deterministically from `sha256(target)`, optionally re-styled by an LLM.
Difficulty (2–4 leading zeros to start) auto-increments every third block
found, capped at 8, mimicking real proof-of-work retargeting.

**Files:** `components/decoder/Decoder.tsx`, `lib/sha256.ts`,
`mark17/decoder.py`

## Quantum Dream (`/quantum`)

A self-contained, Instagram-Reels-style animation loop — no backend call.
"G = MIRON" is a cosine-similarity readout: `MIRON` is a hardcoded 5-D unit
vector baked into the component, and each 4-second "dream frame" generates
a random 5-D vector, computes its cosine similarity ("resonance") against
`MIRON`, and uses that percentage to drive glow intensity across five
procedural Canvas2D animations (wave interference, particle cloud, fractal
triangles, echo rings, log spiral).

**Files:** `components/quantum/QuantumDream.tsx`

## Evolutionary Forge (`/evolution`)

A pure client-side animation compressing "1 trillion synapses across 2000
years of evolution" into a short visual sequence. No backend call.

**Files:** `components/evolution/EvolutionForge.tsx`

## Chaos Abyss (`/attractor`)

Four interactive 3D chaotic attractors (Thomas, Lorenz, Aizawa, Halvorsen),
each with tunable parameters, rendered with a hand-written Canvas2D 3D
projector (yaw/pitch rotation + a simple perspective divide) — no WebGL.
Drag to orbit. This is the projector pattern that `/efir`'s 3D world reuses.

**Files:** `components/attractor/Attractor.tsx`

## Chaos Neuro Dance (`/neurodance`)

Webcam hand tracking (MediaPipe) turns your fingertips into moving
attractor sources — trails render like the aura in the GAME OS reference
art. Pure client-side, no backend call.

**Files:** `components/neurodance/NeuroDance.tsx`

## Neuro-Hand (`/handbrain`)

Webcam hand tracking (MediaPipe HandLandmarker) with joints rendered as
glowing "stars" and bones as neural connections — a stylized skeletal rig
over your live hand. Pure client-side.

**Files:** `components/handbrain/HandBrain.tsx`

## Braindance (`/splats`)

A minimal renderer in the spirit of Gaussian Splatting: each "splat" carries
four parameters (position + one extra dimension), giving a pseudo-4D look
with far fewer primitives than a real splatting pipeline. Pure client-side.

**Files:** `components/splats/BrainDance.tsx`

## EdgeAI Neuro-Brain (`/brain`)

A classic layered neural-network visualizer — inputs → hidden layers →
outputs, with glowing synapses and a live forward-pass animation. Pure
client-side, meant as an approachable "what is a neural net" visual.

**Files:** `components/brain/NeuralBrain.tsx`

## Big Idea (Telegram) (`/tg`)

The same funnel engine as `/funnel` (`lib/funnel.ts` — identical
`generateSparks` / `synthesizeBigIdea` calls), wrapped in the Telegram
WebApp SDK: native MainButton, haptics, and identity pulled from Telegram
instead of the standalone web UI. Falls back to a direct browser-side LLM
call if the core bridge is unreachable, so it works even without a running
Max17 bridge.

**Files:** `components/telegram/TgBigIdea.tsx`,
`components/telegram/useTelegram.ts`

## Pricing (`/pricing`)

Shows the Free/Pro plan comparison. See [GODMODE](#godmode) below for why
every feature is currently unlocked regardless of plan.

---

## GODMODE

`lib/subscription.ts` exports a single flag:

```ts
export const GODMODE = true;
```

While `true`, every feature check (`canUseFeature`, `tierAtLeast`) and every
daily-limit check (`dailyLimitFor`) always passes, and `AuthGate` renders
its children without requiring sign-in. The `/pricing` page detects the
flag and shows a banner instead of a "Buy Pro" button, so it never sells
something that's already free.

The tier tables (`FEATURE_MIN_TIER`, `DAILY_LIMITS`) are left in place on
purpose — they describe what the product looks like with GODMODE off.
Flipping the flag to `false` restores the paywall exactly as configured,
with nothing to reconstruct from memory.
