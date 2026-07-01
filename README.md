<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/dcf78fd2-d064-4f32-a65f-e4dbd1128e38

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## Воронка — Big Idea Generator

A creative "funnel" that turns raw inputs into one Big Idea. Open `/funnel`
(there is also a floating link on the home screen).

How it works — a two-stage funnel that runs fully client-side against the
OpenRouter/Gemini API (uses `NEXT_PUBLIC_OPENROUTER_API_KEY` or
`NEXT_PUBLIC_GEMINI_API_KEY`):

1. **Top (wide)** — you pour in optional seeds: domain, audience, trend, twist.
2. **Middle (narrowing)** — the model spits out many raw "sparks" (idea fragments).
3. **Bottom (one idea)** — the sparks are synthesized into a single structured
   Big Idea: name, tagline, problem, solution, who-for, why-now, unfair
   advantage, first step, plus boldness/scale scores.

Code: `lib/funnel.ts`, `components/funnel/FunnelApp.tsx`, `app/funnel/page.tsx`.

## Max17 bridge

`mark17` is the internal package name for the Max17 cognitive core.

### Product principle

Every Max17 answer should increase the user's contact with reality, not reduce it.

Good responses should push toward real-world action, body awareness, creation, work, money, live relationships, and honest self-understanding. Responses that only keep the user inside the system waiting for "divine answers" are treated as a product failure, even if they look polished.

This principle is encoded in `mark17/principles.py` and used by the deterministic responder.

### Install Python dependencies

The core bridge requires Python 3 and NumPy.

```bash
python3 -m pip install -r mark17/requirements.txt
```

### Run the Max17 smoke test

```bash
npm run max17:smoke
```

The smoke test runs `mark17/json_cli.py` directly with LLM disabled and an ephemeral temporary state directory.
It warms up both keyword memory and the experimental local vector memory, then checks a semantic recall flow.

### Experimental vector memory

Max17 keeps the existing `Hippocampus` SQLite keyword memory intact. The experimental semantic layer lives beside it in `mark17/vector_memory.py` and stores records in `vector_memory.db` under the selected state directory.

This prototype uses deterministic local token hashing, a small domain synonym map, normalized vectors, and cosine similarity. It does not call external APIs and does not require transformer models. For `user_message` events the API returns both:

```json
{
  "memory": {
    "recalled": [],
    "semantic": []
  }
}
```

### Experimental synapse graph

Max17 also keeps a first weighted association graph in `mark17/synapse_graph.py`, stored as `synapse_graph.db` under the selected state directory. It does not replace keyword or vector memory.

The graph creates deterministic associations between events, recalled memories, semantic memories, task statuses, routes, self-evaluations, and adaptations. Repeated relations increase `evidence_count` and gently strengthen `weight`.

Responses can include:

```json
{
  "synapses": {
    "updated": 0,
    "top": []
  }
}
```

### Sleep / Consolidation Mode

Max17 can run a manual sleep pass with:

```bash
npm run max17:sleep
```

Sleep mode uses `mark17/consolidation.py` to read recent Hippocampus memories and strong SynapseGraph associations, group repeated themes, and write stable `consolidated_pattern` memories back into Hippocampus. It also mirrors those summaries into VectorMemory so future recall can find them semantically.

This is a deterministic compression loop, not autonomous background AGI. The response includes:

```json
{
  "consolidation": {
    "patterns_created": 0,
    "patterns": []
  }
}
```

### Call `/api/max17` with curl

Start the Next.js dev server:

```bash
npm run dev
```

Then send an event:

```bash
curl -s -X POST http://localhost:3000/api/max17 \
  -H 'Content-Type: application/json' \
  -d '{"type":"terminal_error","line":"Max17 manual smoke warning"}'
```

The API accepts these event types:

```text
user_message
task_created
task_completed
deadline_failed
terminal_error
system_state
sleep_consolidation
```

### Enable local LLM routing

By default, `/api/max17` runs with the Max17 LLM bridge disabled so the route does not depend on Ollama.

To allow Max17 to call the local Ollama bridge:

```bash
MAX17_LLM_ENABLED=true npm run dev
```

Optional environment variables:

```bash
PYTHON_BIN=python3
MAX17_STATE_DIR=/absolute/path/to/state
```

### Deploy Max17 to production (Vercel + hosted bridge)

The frontend deploys as a Next.js app on Vercel, but **Vercel serverless functions
cannot spawn `python3`**, so `/autoplan` and `/maxgraph` need the Max17 core to run
somewhere with Python. The bridge (`mark17/server.py`) wraps the exact same logic
behind HTTP; `/api/max17` proxies to it when `MAX17_BRIDGE_URL` is set.

**1. Deploy the bridge (Railway example)**

```bash
# From the repo root — the Dockerfile builds the mark17 package.
# Railway: New Project → Deploy from Repo → set Dockerfile path to mark17/Dockerfile
#   (or: railway up  with the Dockerfile)
```

On the **bridge service** set env:

```bash
MAX17_BRIDGE_TOKEN=<long-random-secret>
MAX17_LLM_ENABLED=true
MAX17_LLM_PROVIDER=openrouter
OPENROUTER_API_KEY=<your key>            # same one used by the funnel
MAX17_LLM_MODEL=google/gemini-2.0-flash-exp:free   # optional
# Mount a volume at /data so memory + synapses persist.
```

Verify: `curl https://<bridge-host>/health` → `{"ok": true, ...}`.

**2. Point Vercel at the bridge**

In the **Vercel project** env (Production):

```bash
MAX17_BRIDGE_URL=https://<bridge-host>     # no trailing slash
MAX17_BRIDGE_TOKEN=<same secret as above>
NEXT_PUBLIC_GEMINI_API_KEY=<key>           # for the Voronka funnel (client side)
```

Redeploy. Now `/autoplan` builds real plans and `/maxgraph` shows the real synapse
graph in production. Locally nothing changes: leave `MAX17_BRIDGE_URL` unset and
`npm run dev` spawns `python3` directly.

Run the bridge locally (to test the same path):

```bash
python3 -m mark17.server            # listens on :8000, GET /health, POST /event
```
