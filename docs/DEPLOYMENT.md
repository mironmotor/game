# Deployment

GAME has two deployment targets that build from the **same code** but
serve different capabilities:

| Target | What it serves | API routes work? | Config |
| --- | --- | --- | --- |
| **Vercel** (primary) | The full Next.js app at the domain root | Yes — Vercel runs a real server | `vercel.json` (framework preset only) |
| **GitHub Pages** (secondary) | A static export under `/game` | No — static hosts can't run server code | `.github/workflows/deploy.yml` |

`next.config.ts` defaults to the Vercel-style build — root path, no static
export — for everything, including plain local `npm run dev` / `npm run
build`. Only the GitHub Pages workflow opts into the static export, via an
explicit `GITHUB_PAGES_EXPORT=true` env var (set in
`.github/workflows/deploy.yml`, not something you set locally):

```ts
const isGithubPagesExport = !!process.env.GITHUB_PAGES_EXPORT;
const basePath = isGithubPagesExport ? '/game' : '';
// ...
...(isGithubPagesExport ? { output: 'export' as const, basePath, assetPrefix: basePath } : {}),
```

This is deliberately **not** inferred from "is this Vercel" — that used to
also match plain local dev (no `VERCEL` env var there either), which made
`npm run dev` serve everything under `/game` and 404 on the exact
`http://localhost:3000` URL this repo's README tells you to open. Local dev
and a plain local `npm run build` now always behave like the real app.

## Deploying to Vercel

1. Import the repository into a new Vercel project (Vercel auto-detects the
   Next.js framework from `vercel.json`).
2. Set environment variables under **Project → Settings → Environment
   Variables** (Production, and Preview if you want previews to work the
   same way):

   | Variable | Required for |
   | --- | --- |
   | `NEXT_PUBLIC_GEMINI_API_KEY` or `NEXT_PUBLIC_OPENROUTER_API_KEY` | The funnel and chat modes calling an LLM directly from the browser |
   | `MAX17_BRIDGE_URL` | `/autoplan`, `/maxgraph`, `/efir`, `/mind`, `/decoder`, `/inbox` — see [Deploying the Max17 bridge](#deploying-the-max17-bridge) below. **Vercel serverless functions cannot spawn `python3`**, so without this variable these routes have no core to talk to. |
   | `MAX17_BRIDGE_TOKEN` | Shared secret between Vercel and the bridge (optional but recommended) |
   | `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `APP_URL` | Only if you want real billing — otherwise `/pricing` just shows "payment not connected yet" without crashing. Irrelevant while [GODMODE](GAME_MODES.md#godmode) is on. |

3. Push to your default branch — Vercel builds and deploys automatically.
4. Verify: open `https://<your-app>.vercel.app/api/max17` with a `POST`
   (see [docs/API_REFERENCE.md](API_REFERENCE.md)), or just click through
   a few modes.

### Custom domain

**Project → Settings → Domains → Add**, then point your registrar's DNS at
Vercel:

```
A     @      216.198.79.1
CNAME www    cname.vercel-dns.com
```

**Both steps are required** — DNS alone doesn't activate the domain (Vercel
will 404 with "deployment not found" until the domain is added in the
dashboard), and adding the domain in Vercel alone doesn't route traffic
(DNS still points wherever it pointed before).

If your registrar is GoDaddy, `scripts/fix_dns_godaddy.py` automates the
DNS half:

```bash
export GODADDY_KEY=...       # developer.godaddy.com → API Keys → Create (Production)
export GODADDY_SECRET=...
python3 scripts/fix_dns_godaddy.py yourdomain.com            # dry run: show the plan only
python3 scripts/fix_dns_godaddy.py yourdomain.com --apply    # apply it
```

The script always prints current records and the diff before touching
anything; `--apply` **replaces** the existing `A @` record with Vercel's IP
(it does not add a second one). If you edit DNS by hand in a web panel
instead, make sure you're **editing** the existing `A @` record, not
**adding** a new one — two `A` records for the same name means traffic
alternates between the old server and Vercel, which looks like a flaky
site. Check propagation with `dig +short yourdomain.com` from a machine
with an unrestricted network — TTLs here are typically 600 seconds, so a
correct change is visible within about ten minutes.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys automatically on every
push to `main` (or via **Actions → Deploy to GitHub Pages → Run workflow**
for a manual run). One-time setup: **Settings → Pages → Source: GitHub
Actions**.

This target is a **static export** — `next build` with `output: 'export'`
produces a plain `out/` directory of HTML/CSS/JS with no server behind it.
Concretely that means:

- served under `/game` (`basePath`), not the domain root
- `app/api/*` routes are removed before the build (a static host cannot
  run them regardless — see the workflow's "Remove server-only API
  routes" step), so any mode that depends on the core
  (`/autoplan`, `/maxgraph`, `/efir`, `/mind`, `/decoder`, `/inbox`,
  chat) will show a "bridge unavailable" state here. Pure client-side
  modes (`/attractor`, `/neurodance`, `/handbrain`, `/splats`, `/brain`,
  `/evolution`, `/quantum`) work exactly the same as on Vercel.
- set the `NEXT_PUBLIC_GEMINI_API_KEY` repository secret (**Settings →
  Secrets and variables → Actions**) if you want the funnel to call an LLM
  from this deployment too.

Treat GitHub Pages as a read-only showcase of the client-side experience,
and Vercel as the deployment where the app is actually complete.

## Deploying the Max17 bridge

Two routes (`/autoplan`, `/maxgraph`) are meaningless without a working
core, and several more (`/efir`, `/vision`'s World Model panel, `/mind`,
`/decoder`, `/inbox`) degrade gracefully but lose real functionality
without one. Locally, `/api/max17` just spawns `python3
mark17/json_cli.py` per request — but **Vercel serverless functions cannot
spawn `python3`**, so production needs the core running somewhere else,
reachable over HTTP. `mark17/server.py` wraps the exact same core logic
behind `GET /health` and `POST /event`.

### Variant A — Railway (recommended for 24/7)

1. From the repo root, create a new Railway project → **Deploy from
   Repo** → set the Dockerfile path to `mark17/Dockerfile`.
2. Set environment variables on the **bridge service**:

   ```bash
   MAX17_BRIDGE_TOKEN=<a long random secret>
   MAX17_LLM_ENABLED=true
   MAX17_LLM_PROVIDER=openrouter
   OPENROUTER_API_KEY=<your key>
   MAX17_LLM_MODEL=google/gemini-2.0-flash-exp:free   # optional
   ```

   Mount a persistent volume at `/data` (set `MAX17_STATE_DIR=/data/state`)
   so memory and the synapse graph survive redeploys.
3. Verify: `curl https://<bridge-host>/health` → `{"ok": true, ...}`.
4. On the **Vercel project**, set:

   ```bash
   MAX17_BRIDGE_URL=https://<bridge-host>   # no trailing slash
   MAX17_BRIDGE_TOKEN=<same secret as step 2>
   ```

5. Redeploy Vercel. `/autoplan` and `/maxgraph` now use the real core in
   production. Locally nothing changes — leave `MAX17_BRIDGE_URL` unset
   and `npm run dev` keeps spawning `python3` directly.

Run the same bridge locally to test the exact production code path:

```bash
python3 -m mark17.server   # listens on :8000
```

### Variant B — your own machine (quick, not for 24/7)

```bash
bash mark17/run_bridge_mac.sh
```

This script checks for `python3`/NumPy, detects a running Ollama instance
(enabling LLM routing through it if alive, deterministic mode otherwise),
generates a `MAX17_BRIDGE_TOKEN`, starts `mark17.server`, opens a
`cloudflared` quick tunnel (`brew install cloudflared` first), and prints
the resulting `MAX17_BRIDGE_URL` plus ready-to-paste `vercel env add`
commands. `Ctrl+C` stops everything — the tunnel and the bridge only live
while the script runs and the machine is awake, so use Railway for
anything that needs to stay up.

## Environment variables

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_GEMINI_API_KEY` | Vercel / `.env.local` | Direct Gemini calls from the browser (funnel fallback, image generation) |
| `NEXT_PUBLIC_OPENROUTER_API_KEY` | Vercel / `.env.local` | Preferred over Gemini when both are set — used by chat and the funnel |
| `MAX17_BRIDGE_URL` | Vercel | URL of a hosted `mark17.server` — required on Vercel for core-backed routes to work |
| `MAX17_BRIDGE_TOKEN` | Vercel + bridge service | Shared secret validated by the bridge |
| `MAX17_LLM_ENABLED` | bridge service / local | `true` to let the core call an LLM on top of its deterministic logic |
| `MAX17_LLM_PROVIDER` | bridge service | `openrouter` \| `minimax` \| `ollama` |
| `OPENROUTER_API_KEY` | bridge service | Required when `MAX17_LLM_PROVIDER=openrouter` |
| `MINIMAX_API_KEY` / `MINIMAX_MODEL` / `MINIMAX_BASE_URL` | bridge service | Required when `MAX17_LLM_PROVIDER=minimax` |
| `MAX17_LLM_MODEL` | bridge service | Optional model override |
| `MAX17_STATE_DIR` | bridge service | Persistent path for SQLite memory/synapse databases (e.g. `/data/state` on a mounted volume) |
| `PYTHON_BIN` | local / self-hosted | Override the `python3` binary name if yours differs |
| `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `APP_URL` | Vercel | Real billing — optional, irrelevant while GODMODE is on |
| `NEXT_PUBLIC_BASE_PATH` | set automatically by `next.config.ts` | Not something you set by hand — lets client-side `fetch()` calls prepend `/game` on the GitHub Pages export |

See `.env.example` in the repo root for a copy-pasteable template with
inline comments.

## GODMODE — no paywall in production, on purpose

`lib/subscription.ts` currently ships with `GODMODE = true`: every mode is
unlocked for every visitor, with no sign-in and no daily limits. This is
intentional, not a bug — see
[docs/GAME_MODES.md#godmode](GAME_MODES.md#godmode) for what it does and
how to turn the paywall back on (`GODMODE = false`, nothing else to
reconstruct).
