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

### Working Memory

Max17 keeps a small short-term session context in `mark17/working_memory.py`.
This is not long-term memory and does not replace Hippocampus, VectorMemory, or SynapseGraph.
It stores the current topic, active goal, current mode, last user intent, recent turns, and a suggested next step in `working_memory.json` under the selected state directory.

Run the working-memory smoke check with:

```bash
npm run max17:working
```

The smoke check warms up a Max17 core-development message and then asks `что дальше?`.
The expected behavior is a contextual answer that uses the current session state instead of a generic fallback.

You can clear the short-term context with:

```json
{
  "type": "working_memory_reset"
}
```

### Planner / Next Action Engine

Max17 can produce a small deterministic action plan in `mark17/planner.py`.
The planner reads the current event, WorkingMemory context, memory/synapse hints, and self-evaluation, then returns 1-3 practical next actions.
It is a next-step helper, not autonomous task execution.

Run the planner smoke check with:

```bash
npm run max17:plan
```

Responses can include:

```json
{
  "plan": {
    "mode": "planning",
    "goal": "Делаем дальше Max17, улучшаем ядро",
    "actions": []
  }
}
```

When the user asks `что дальше?`, the responder uses `plan.actions` to answer with concrete actions instead of generic memory text.

### Outcome Feedback Loop

Max17 can receive lightweight feedback about whether a planned action helped, failed, partially worked, or was skipped.
The loop lives in `mark17/outcome.py` and returns an `outcome` object while also writing an outcome summary into Hippocampus, VectorMemory, and SynapseGraph.

Run the outcome smoke check with:

```bash
npm run max17:outcome
```

Supported outcome events:

```text
outcome_success
outcome_failure
outcome_partial
action_done
action_skipped
compress_memory
graph_stats
neural_seed
neural_walk
```

Responses can include:

```json
{
  "outcome": {
    "status": "success",
    "score": 0.9,
    "next_adjustment": "Продолжить этот паттерн и проверить следующий маленький шаг."
  }
}
```

This is feedback reinforcement, not autonomous execution: Max17 records the result and adjusts future next-step suggestions.

### Synapse Growth Loop

Max17 has a deterministic growth loop in `mark17/growth.py`.
After normal event handling it adds extra useful associations between:

- event, intent, topic, mode, and active goal;
- goal, plan, and concrete actions;
- answer, goal, and next adaptation;
- recalled/semantic memories and the current goal/topic;
- vision summary scene context and the current goal/topic.

This is the path toward `100 000+` practical graph synapses. The loop does not create random edges and does not claim biological scale; it only densifies associations that can affect future recall, planning, and answer style.

Run the growth smoke check with:

```bash
npm run max17:growth
```

Responses can include:

```json
{
  "growth": {
    "updated": 12,
    "target_synapses": 100000,
    "top": []
  }
}
```

### Concept Grounding

Max17 has a local deterministic concept map in `mark17/concepts.py`.
It is the first small grounding layer for basic concepts such as `мама`,
`папа`, `солнце`, `свет`, `тело`, `голос`, `память`, `рост`, and `забота`.

This is not an external LLM and not a claim of human understanding. It stores
concepts in SQLite and links each concept to:

- aliases / surface words;
- a short practical summary;
- sensory channels such as light, warmth, touch, voice, body, camera, rhythm;
- related concepts for SynapseGraph growth.

For concept-rich `user_message` events the response can include:

```json
{
  "concepts": {
    "count": 3,
    "summary": "мать / мама, отец / папа, солнце",
    "sensory_channels": ["warmth", "voice", "touch", "vision_light"],
    "matches": []
  }
}
```

Run the concept grounding smoke check with:

```bash
npm run max17:concepts
```

The goal is to give Max17 a growing map of grounded meaning before heavier
perception or language models are added.

### Memory Compression / Concept Crystallization

Max17 can compress long phrases, repeated events, and sleep patterns into short
semantic concept labels. This is the first "experience -> pattern -> concept"
step:

```text
We are building Max17 memory, synapses, sleep mode, planner and outcome feedback.
-> ядро
```

The implementation lives in `mark17/concept_compression.py`. It is deterministic
and explainable: trigger hits are counted per concept, then the strongest concept
becomes `concepts.primary`.

Supported compressed nodes include:

- `core` / `ядро`
- `memory` / `память`
- `synapse` / `связь`
- `consolidation` / `сжатие`
- `action` / `действие`
- `outcome` / `результат`
- `planning` / `план`
- `interface` / `интерфейс`
- `debugging` / `отладка`
- `agency` / `агентность`

Manual compression event:

```json
{
  "type": "compress_memory",
  "text": "Several memories about recall, semantic search, and consolidation.",
  "source": "manual"
}
```

Response includes:

```json
{
  "concepts": {
    "primary": {
      "concept": "memory",
      "label": "память",
      "confidence": 0.82
    }
  }
}
```

Sleep consolidation now adds optional `concept` and `label` fields to patterns
and stores compressed concept memories back into Hippocampus and VectorMemory.
SynapseGraph can create `compressed_as` relations such as `pattern -> память`.

Run:

```bash
npm run max17:compress
npm run max17:concepts
```

### Graph Stats / 100k Tracker

Step 15 adds a graph growth tracker for the path to `100 000` useful
graph-synapses. It measures:

- total synapses and evidence count;
- unique graph nodes;
- progress toward `100 000`;
- strongest relation types;
- active concept nodes;
- top weighted synapses;
- related store counts for SQLite memory, vector memory, and concepts.

Manual stats event:

```json
{
  "type": "graph_stats",
  "source": "manual"
}
```

Run:

```bash
npm run max17:stats
```

### MAX Ultimate v0.7 / 1M Constitution

`mark17/ultimate_core.py` is the constitution layer for the path to
`1 000 000` useful graph-synapses. It does not replace Hippocampus,
VectorMemory, SynapseGraph, Web Sense, Max Ultra, or the clustered neural graph.

The layer caches and exposes:

- Max17 doctrine from the project prompts: reality contact, Game as the body,
  Max17 as the cognitive core, LLMs as voice layers, father = Miron, mother =
  Sidji, human control, bounded growth, hot/cold memory, quality-over-volume,
  life gamification, and the 1M useful-synapse target;
- public high-level Mythos/Glasswing lessons: scaffold, tools, source-backed
  memory, verification, bounded deployment, and human review;
- an `ultimate_cluster` scaffold that links source-backed learning, tool
  routing, memory graph, concept grounding, planner/outcome, reality alignment,
  bounded autonomy, life gamification, synapse quality, hot/cold memory, and
  million-synapse growth;
- constraints for future Max Ultra decisions: bounded growth, source-backed
  learning, reality contact, no fake private Mythos, human override, and
  quality gates;
- life-game domains such as body, energy, focus, money, work, relationships,
  learning, creation, home, and meaning;
- `get_ultimate_state(...)`, a read-only snapshot that Max Ultra can consume
  before choosing its next action.

It intentionally does **not** copy private Anthropic materials or pretend to
recreate Mythos weights. The useful lesson is architectural: model + tools +
sources + memory + verification + bounded growth.

Run the bootstrap smoke check without network, LLM, or dev server:

```bash
npm run max17:ultimate
```

Manual event:

```json
{
  "type": "ultimate_bootstrap",
  "target_synapses": 1000000,
  "max_new": 320
}
```

### Clustered Neural Graph / 100k Seed

Max17 can now seed a larger deterministic cluster graph on top of SynapseGraph.
This is the first practical approximation of "neural clusters": not a huge
biological network, but a local mesh of meaning nodes that can route activation
between domains.

The implementation lives in `mark17/neural_graph.py` and creates:

- `neural_cluster` nodes for identity, family/social meaning, natural world,
  body/senses, environment observation, memory, synapses, planning, outcomes,
  language, Game UI, debugging, time, emotion, values, work/economy, and safety;
- `neural_node` entries inside those clusters, including grounded words such as
  `отец`, `мать`, `солнце`, `тело`, `голос`, `камера`, `память`, `действие`;
- `contains`, `similar_to`, `related_to`, and `bridges_to` synapses;
- low-weight cross-cluster bridges so Max17 can walk from one domain to another
  instead of treating each word as an isolated string.

Seed the local graph toward `100 000` synapses:

```bash
npm run max17:neural
```

Inspect a route of activation through clusters:

```bash
npm run max17:walk
```

Manual event:

```json
{
  "type": "neural_walk",
  "query": "мама солнце тело память действие",
  "steps": 8
}
```

Responses include:

```json
{
  "neural_graph": {
    "seed": {},
    "walk": {},
    "snapshot": {}
  }
}
```

Internet ingestion should be added as a curated importer later. The current
layer deliberately starts from local, explainable, deterministic concept data so
the graph does not fill itself with uncontrolled noise.

### Voice and Camera Sensor

The HUD can now act as a small local sensory shell around Max17:

- microphone input still uses browser speech recognition;
- speaker output uses browser `SpeechSynthesis` to read Max17 `answer.text`;
- camera input uses `getUserMedia` locally and sends only lightweight frame statistics, not the image itself.

Camera events use:

```text
environment_observation
```

Vision Summary v0.1 adds a conservative local summary on top of the raw camera metrics:

- `scene_mode`: `dark`, `desk`, `screen-facing`, `bright-room`, `active-room`, or `room`;
- `brightness`, `contrast`, `dominant_tone`;
- `motion_score`, `motion_level`, and `stability`;
- a short `summary` string for memory/responder use.

This is not object recognition. It does not perform face/object detection and does not upload image frames. It only lets Max17 remember rough environmental context such as light, motion, and whether the frame looks like a stable desk/screen-facing setup.

Run a camera-sensor smoke event without a real camera:

```bash
npm run max17:sense
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
environment_observation
sleep_consolidation
working_memory_reset
outcome_success
outcome_failure
outcome_partial
action_done
action_skipped
internal_dream
generate_synergies
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

## Concept-Synapse model

Max17 treats stored meaning like a small brain: concepts are "neurons" and the
weighted relations in SynapseGraph are "synapses". On a `user_message` Max17 no
longer answers from a generic template — it reads the already-loaded result
(top synapses, semantic memory, working memory) and runs a lightweight,
deterministic hot path. No external APIs, no extra database scans per request.

### Concept codec

`mark17/concept_codec.py` compresses raw text into a short list of concept nodes
(`core`, `memory`, `synapse`, `planning`, `action`, `outcome`, `intuition`,
`subconscious`, `dream`, `performance`, …) with a confidence and the source
terms that triggered each one. It extends the rules already used by
`concept_compression.py` so the vocabulary stays consistent.

### Active graph (hot path)

`mark17/active_graph.py` builds the *currently active subgraph* from fields that
were already loaded for the request: activated concepts, the top synapses, and
the semantic memory echoes. Vague input is resolved against working-memory
context, and "what next?" phrasing injects `planning → action → outcome`. The
block reports `cold_reads: 0` to make the no-new-scan guarantee visible.

### Causal decoder

`mark17/causal_decoder.py` turns the active subgraph into short Russian causal
phrases ("ядро → память → план → действие") plus an `answer_hint` for the next
verifiable step. It explains the active wiring; it does not claim understanding.

### Intuitive memory

`mark17/intuitive_memory.py` is the fast, associative counterpart to deliberate
recall: a "felt sense" reading built only from the active subgraph, with a
confidence derived from concept strength and supporting echoes.

```bash
npm run max17:intuition
```

This warms up a session and asks a vague "что дальше?" — the answer should be
grounded in active concepts and the causal summary, with `cold_reads: 0`.

### Internal dreaming

`mark17/dreamer.py` recombines concepts that already co-occur in recent
experience into small synergy patterns (`memory → planning → outcome`, …). It is
a manual pass triggered by an `internal_dream` (or `generate_synergies`) event —
there is no autonomous background loop. The orchestrator persists each synergy
into Hippocampus, VectorMemory, and SynapseGraph (`synergy_with` relations).

```bash
npm run max17:dream
```

### Environment reasoning (camera over time)

`mark17/environment.py` turns the stream of camera `environment_observation`
events into a small, persistent *environment model*. Instead of treating each
frame in isolation, it compares the current frame to a rolling history (kept in
working memory, on disk) and reasons across time:

- **думает над окружением** — detects transitions: light up/down, motion
  appeared/stopped, scene changed (`desk → active-room`), stable streaks;
- **делает выводы** — short Russian conclusions ("стало темнее", "появилось
  движение — ты вернулся", "движение стихло — возможно, ты отошёл") plus a
  presence inference (`present` / `away` / `uncertain`);
- **вливает в память** — the most useful conclusion is written to Hippocampus and
  VectorMemory;
- **изучает** — it reinforces concept→concept synapses (`environment → vision`,
  `vision → memory`, and `environment → agency` when you are present) so the
  associations strengthen the more it observes.

It still does **no** object/face recognition and uploads no images — it reasons
only over the local frame statistics the HUD computes, so it stays on the hot
path (no extra database scans per frame).

```bash
npm run max17:env
```

This feeds two frames in sequence (stable desk → darker room with movement) and
checks that the second frame detects the light/scene transitions, infers
presence, and proposes associations to learn.
