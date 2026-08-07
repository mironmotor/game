# Getting Started

Step-by-step setup for running GAME locally.

## Prerequisites

- **Node.js** 20+ and npm
- **Python 3.10+** and `pip` (only needed for the Max17 cognitive core — the
  frontend alone runs without Python)
- A **Gemini** or **OpenRouter** API key (free tier works) if you want the
  chat/funnel modes to call a real LLM instead of showing an empty response

## 1. Clone and install

```bash
git clone https://github.com/mironmotor/game.git
cd game
npm install
```

## 2. Configure environment variables

Copy the example file and fill in what you have:

```bash
cp .env.example .env.local
```

At minimum, set one of these so the chat/funnel modes can call an LLM:

```bash
NEXT_PUBLIC_GEMINI_API_KEY="your-gemini-key"
# or
NEXT_PUBLIC_OPENROUTER_API_KEY="your-openrouter-key"
```

Everything else in `.env.local` is optional for local development — see
[docs/DEPLOYMENT.md](DEPLOYMENT.md) for what each variable does in
production.

## 3. Install the Python core (optional but recommended)

The Max17 cognitive core (`mark17/`) powers memory, the synapse graph,
voice-state reading, and the World Model behind `/efir`. It needs NumPy:

```bash
python3 -m pip install -r mark17/requirements.txt
```

Verify it works:

```bash
npm run max17:smoke
```

You should see a JSON blob ending in `"ok": true`. If you skip this step,
the app still runs — routes that talk to the core (`/autoplan`, `/maxgraph`,
`/efir`, `/vision`, `/mind`, `/decoder`, `/inbox`) will simply show a
"bridge unavailable" state instead of live core data.

## 4. Run the app

```bash
npm run dev
```

Open **http://localhost:3000** (the dev server auto-picks the next free port
if 3000 is busy — check the terminal output).

> **Note on paths:** in local dev the app is served at the site root
> (`/`). In the GitHub Pages static export it is served under `/game`
> (see [docs/DEPLOYMENT.md](DEPLOYMENT.md)). On Vercel it is served at the
> domain root, same as local dev.

## 5. Try a few modes

- `/` — the main HUD (missions, XP, chat with Max)
- `/funnel` — turn a few seed words into one structured Big Idea
- `/efir` — a voice-reactive 3D world; click **🎙 Listen** and talk
- `/vision` — MAX VISION, a liquid audio visualizer; click **🎙 Let sound in**

See [docs/GAME_MODES.md](GAME_MODES.md) for the full list of modes.

## 6. Run the test suite

The Python core has standalone test files (no pytest dependency):

```bash
for f in mark17/test_*.py; do python3 "$f"; done
```

Lint and type-check the frontend:

```bash
npm run lint
npx tsc --noEmit
```

Build for production (checks the whole app compiles):

```bash
npm run build
```

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `ModuleNotFoundError: No module named 'numpy'` | Python deps not installed | `python3 -m pip install -r mark17/requirements.txt` |
| Chat modes reply with nothing / an error | No LLM API key set | Set `NEXT_PUBLIC_GEMINI_API_KEY` or `NEXT_PUBLIC_OPENROUTER_API_KEY` in `.env.local` |
| `/efir`, `/mind`, `/autoplan` show "bridge unavailable" | Python core not installed, or `python3` not on `PATH` | Install step 3 above; on Windows set `PYTHON_BIN` if your binary is named differently |
| Voice modes don't ask for the microphone | Not on `localhost` or HTTPS | Browsers require a secure context for `getUserMedia` — `localhost` counts, a plain HTTP LAN IP does not |
| `npm run dev` picks a different port than 3000 | Port 3000 already in use | Check the terminal output for the actual port, or free port 3000 first |

Next: [docs/GAME_MODES.md](GAME_MODES.md) for what each mode does, or
[docs/MAX17_CORE.md](MAX17_CORE.md) to understand the cognitive core.
