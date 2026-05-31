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

This is the path toward `1000+` practical graph synapses. The loop does not create random edges and does not claim biological scale; it only densifies associations that can affect future recall, planning, and answer style.

Run the growth smoke check with:

```bash
npm run max17:growth
```

Responses can include:

```json
{
  "growth": {
    "updated": 12,
    "target_synapses": 1000,
    "top": []
  }
}
```

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
