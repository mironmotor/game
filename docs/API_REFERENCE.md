# API Reference — `/api/max17`

A single Next.js route (`app/api/max17/route.ts`) is the front door to the
Max17 core. Every game mode that talks to the core sends a `POST` here.

## Base request shape

```bash
curl -s -X POST http://localhost:3000/api/max17 \
  -H 'Content-Type: application/json' \
  -d '{"type": "<event-type>", ...payload}'
```

Locally the app is served at the root, so the path is `/api/max17`. If
you're running the GitHub Pages static export, prefix with the base path:
`/game/api/max17` (see [docs/DEPLOYMENT.md](DEPLOYMENT.md)).

## Response shape

Every successful response is normalized to this stable shape (mode-specific
fields are added on top — see the per-event examples below):

```json
{
  "ok": true,
  "route": "introspect",
  "memory": { "hint": "..." },
  "plasticity": { "confidence": 0.8, "action": "...", "learned": true },
  "llm": { "status": "skipped", "text": "...", "latency_ms": 0 },
  "confidence": 0.8,
  "next_adaptation": "..."
}
```

Errors return `{ "ok": false, "error": "..." }` with an appropriate HTTP
status:

| Status | Meaning |
| --- | --- |
| `400` | Malformed JSON, missing body, or an event `type` not in the allowlist (the error includes `allowed: [...]` with the full list) |
| `502` | The core itself failed — either the spawned `python3` process errored, or the remote bridge (`MAX17_BRIDGE_URL`) is unreachable |

## Special event: `bridge_health`

Not a core event — handled entirely inside the Next.js route. Use it to
check whether a remote bridge is configured and reachable without touching
the core:

```bash
curl -s -X POST http://localhost:3000/api/max17 \
  -H 'Content-Type: application/json' \
  -d '{"type": "bridge_health"}'
```

```json
{
  "ok": true,
  "bridge": "remote",
  "configured": true,
  "reachable": true,
  "url_host": "your-bridge.up.railway.app"
}
```

When no `MAX17_BRIDGE_URL` is set, `bridge` reads `"local"` and the route
spawns `python3` directly instead.

## Event types

Every event below is validated against an allowlist in
`app/api/max17/route.ts` before it reaches the core. The `handler` column
points at the `mark17/json_cli.py` function that processes it.

| Event `type` | Handler | Used by | Payload |
| --- | --- | --- | --- |
| `user_message` | generic path (`brain.handle`) + link auto-reading | Home HUD chat | `{ text: string }` |
| `task_created` | generic path (`brain.handle`) | Home HUD missions | `{ task: {...} }` |
| `task_completed` | generic path (`brain.handle`) | Home HUD missions | `{ task: {...} }` |
| `deadline_failed` | generic path (`brain.handle`) | Home HUD missions | `{ task: {...} }` |
| `terminal_error` | generic path (`brain.handle`) | dev/testing | `{ line: string }` |
| `system_state` | generic path (`brain.handle`) | Home HUD | `{ energy, focus, reputation, balance, tasks_count, active_tasks_count }` |
| `sleep_consolidation` | `_handle_sleep_consolidation` | `npm run max17:sleep` | `{}` |
| `voice_state` | `_handle_voice_state` | `/efir` sound signature | see below |
| `world_state` | `_handle_world_state` | `/efir` 3D world | see below |
| `auto_plan` | `_handle_auto_plan` | `/autoplan` | `{ goal: string, horizon_days?: number }` |
| `synapse_graph` | `_handle_synapse_graph` | `/maxgraph` | `{ limit?: number }` (default 400, max 2000) |
| `big_idea` | `_handle_big_idea` | `/funnel`, `/tg` | `{ domain, audience, trend, twist }` (all optional) |
| `simulation` | `_handle_simulation` | `/simulation` | `{ prompt: string }` |
| `ingest` | `_handle_ingest` | `/inbox` | `{ interest: string, stream: string }` |
| `decode` | `_handle_decode` | `/decoder` | `{ target: string }` |
| `introspect` | `_handle_introspect` | `/mind` | `{}` |
| `physics` | `_handle_physics` | internal/debug | `{}` |
| `web` | `_handle_web` | chat link reading | `{ url: string }` |
| `compress_similar` | `_handle_compress_similar` | maintenance | `{}` |

Events on the "generic path" still go through the full pipeline (memory
recall, self-evaluation, synapse-graph update, physics attachment) — they
just don't need a type-specific handler because `Mark17Brain.handle()`
already does the right thing from the event's `type` and `payload` alone.

### `voice_state` — read a speaker's state from acoustics

```bash
curl -s -X POST http://localhost:3000/api/max17 \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "voice_state",
    "user_id": "alex",
    "context": "still not working, this is frustrating",
    "acoustics": {
      "f0": 150, "register": 0.55, "brightness": 0.7,
      "jitter": 0.35, "energy": 0.8, "voiced": true
    }
  }'
```

Response includes a `voice` object:

```json
{
  "voice": {
    "arousal": 0.62, "valence": 0.31, "tension": 0.58,
    "label": "tense, on edge",
    "note": "D3",
    "baseline": { "obs": 12, "warming_up": false }
  }
}
```

`arousal`/`valence`/`tension` are 0–1. The core keeps a per-`user_id`
baseline (EMA-smoothed) in SQLite, so the same acoustics read differently
depending on how that speaker normally sounds — see
[docs/VOICE_AND_VISION.md](VOICE_AND_VISION.md).

### `world_state` — report a 3D world, receive its laws

```bash
curl -s -X POST http://localhost:3000/api/max17 \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "world_state",
    "user_id": "alex",
    "title": "my-world",
    "census": {
      "alive": 4000, "born": 300, "died": 90,
      "density": 0.6, "radius": 3.2, "hue": 316,
      "arms": 3, "spiral_b": 0.4, "dt": 1.0
    },
    "voice": { "tension": 0.3 }
  }'
```

Response includes a `world` object with the world's address, the current
cosmological epoch, and the physics laws for the next interval
(`emission_scale`, `lifetime_scale`, `can_condense`). Full mechanic in
[docs/VOICE_AND_VISION.md](VOICE_AND_VISION.md#world-model-the-core-learns-what-its-world-looks-like).

### `introspect` — ask the core about itself

```bash
curl -s -X POST http://localhost:3000/api/max17 \
  -H 'Content-Type: application/json' \
  -d '{"type": "introspect"}'
```

```json
{
  "self_evaluation": { "score": 0.7, "reason": "..." },
  "answer": { "text": "I'm growing — 43 memories, 61 synapses..." }
}
```

### `ingest` — filter a stream against an interest

```bash
curl -s -X POST http://localhost:3000/api/max17 \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "ingest",
    "interest": "urgent client deadlines",
    "stream": "buy milk\nclient X needs the report by tomorrow, urgent\nwatched a movie"
  }'
```

Returns `kept`/`dropped` counts and a per-line `{ score, reason }`
breakdown — see [docs/GAME_MODES.md](GAME_MODES.md#max-inbox-inbox) for the
scoring rules.

## Environment variables that affect this route

See [docs/DEPLOYMENT.md](DEPLOYMENT.md#environment-variables) for the full
list. The short version:

- **Unset `MAX17_BRIDGE_URL`** (default, local dev) → the route spawns
  `python3 mark17/json_cli.py` per request.
- **Set `MAX17_BRIDGE_URL`** (required on Vercel) → the route proxies the
  event as JSON to that URL's `/event` endpoint instead.
- **`MAX17_LLM_ENABLED=true`** → the core is allowed to call an LLM
  (OpenRouter/MiniMax/Ollama per `MAX17_LLM_PROVIDER`) on top of its
  deterministic logic. Default is deterministic-only.
