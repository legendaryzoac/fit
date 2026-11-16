# fit — training & recovery tracker

**Live:** [fit.zackwithers.com](https://fit.zackwithers.com) — tap **"Explore the
live demo"** on the login screen to walk through the whole product on synthetic
data. No account needed.

`fit` is a personal replacement for the WHOOP app. It pairs recovery
dashboards (HRV, resting heart rate, sleep), fed by the WHOOP API, with the
training half that consumer apps rarely do well: an offline-capable gym
logger, an interval timer for speed and cardio work, analytics that connect
training load to recovery, and an AI coach that plans the day with you.

It is invite-only (a handful of friends) and built to run on AWS always-free
tiers for effectively **$0/month**.

## Contents

- [Features](#features)
- [How the coach works](#how-the-coach-works)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Development](#development)
- [Deploying](#deploying)
- [Cost](#cost)
- [Milestones](#milestones)

## Features

### Coach

The home screen greets you and asks one short question — *"Which wall
today?"* — then works out the answer with you. The coach can:

- plan the day: session, warm-up, cool-down and wind-down;
- reshape that plan when you are short on time, run down, or working around
  an injury;
- build multi-week training blocks by talking them through.

It runs on the cheapest current Claude model. What makes it trustworthy is
that it only *proposes*: every plan and block is checked by the progression
engine (volume landmarks, the per-session cap, the exercise catalog) before
you see it, and a block it builds opens in the same editor as one you lay out
by hand. See [How the coach works](#how-the-coach-works).

### Recovery

Daily HRV, resting HR and recovery trends plotted against rolling baselines,
plus sleep-stage breakdowns and sleep performance, ingested from the strap
you link: a WHOOP, or a Fitbit Air through the Google Health API. One strap
per account.

The two bands do not report the same things, and the app shows what each
one has. WHOOP brings a recovery score, strain and captured workouts. Fitbit
Air brings HRV, resting heart rate, blood oxygen, skin temperature against
your baseline, sleep stages and daily steps, with no vendor score; the
readings stand where the score ring would.

### Workout logger

- **Active sessions in the RP style** — check off each set; empty rows show a
  "ghost" of last time's numbers, and checking an empty row means "same as
  last time". Previous sets autofill.
- **Templates** — save and reuse session layouts.
- **Offline-first** — drafts live in localStorage and survive a dead phone
  battery mid-workout; writes are local-first and replay through an offline
  queue when the connection returns.
- **Past sessions** — forgot to log one? *Log → Add past session*. A block day
  is planned as of the date it happened and counts toward that week, without
  disturbing anything live.

### Interval timer

A full-screen countdown for speed and cardio sessions with color-coded
warm-up / work / rest / cool-down sections, pause and skip, and audio plus
vibration cues. It is timestamp-based, so it never drifts. Cardio sessions
finish into a summary with mileage and a link to the matching WHOOP workout.

### Analytics

- Strain vs. recovery overlay
- Per-exercise estimated 1RM (Epley) trends and PRs
- Weekly tonnage by muscle group
- Sprint-time progression
- Heart-rate zone mix
- Bedtime consistency
- Run pace vs. heart-rate efficiency
- Recovery by weekday

### Demo mode

A deterministic synthetic-data engine implements the entire API surface
client-side, behind the same interface the real API uses. It runs in a
namespaced storage sandbox, so it can never touch real data.

## How the coach works

```
Browser                                   api Lambda               Anthropic
───────                                   ──────────               ─────────
snapshot of today  ─┐
(engine-computed)   ├─ POST /api/agent ─▶ pins model, system  ───▶ claude-haiku-5-5
what you said      ─┘   {messages}        prompt, tools, budget ◀─ text + tool calls
        ▲                                        │
        └──── runs the tool calls ◀──────────────┘
              against the engine;
              loops only if it must
```

**The model proposes, the engine disposes.** The coach's tools
(`set_day_plan`, `propose_block`, `get_exercise_history`, `log_checkin`,
`remember`, …) run in the browser, where the data and the engine already
live. A day plan can only reference things the app already knows how to
start, and a block is validated against the volume landmarks documented in
[`PROGRESSION.md`](PROGRESSION.md). Anything that fails validation goes back
to the model as an error to fix; anything that was clamped is shown on the
card. Nothing starts, and no block is saved, without a tap from you.

**Front-loaded, so it is cheap.** The research digest and tool list form a
fixed, cached prompt prefix. Each message carries a compact `<state>`
snapshot computed by the engine — today's session with targets, weekly sets
per muscle with their zones, readiness, flags — so most turns need only one
model call. Between turns the conversation is stored as plain text, so
nothing on the device depends on the prompt or model version. A turn costs
about a tenth of a cent.

**Guard rails live on the server.** The Lambda owns the model id, system
prompt, tool list and output cap. It rebuilds the conversation block by block
before forwarding it, and holds each account to a daily budget of calls and
input tokens, counted in DynamoDB.

**It works without the model.** The demo, offline use, and a stack with no
API key all fall back to a rules-only coach built into the app. It speaks the
same tool format, so the cards and engine checks are identical.

## Architecture

```
WHOOP strap ──> WHOOP app/cloud ──webhook──> Lambda (fn URL, HMAC-verified) ──┐
Fitbit Air ───> Google Health  <──on app open──┐                              ▼
                       └───────nightly EventBridge──> sync Lambda ──> DynamoDB single table
                                                          │           (wearable-agnostic
                                                          ▼            entities, USER#-keyed)
                                                      S3 raw archive        │
                                                                            ▼
Browser (React PWA) <──CloudFront── S3 static site          api Lambda (fn URL + OAC)
        └────────────── /api/* behavior (OAC-signed) ──────────────┘
```

| Layer | Details |
|---|---|
| **Frontend** | React 19 + Vite + Tailwind 4 PWA. Service-worker precached; Recharts is lazy-loaded off the critical path (~100 KB gzipped first load). |
| **API** | A single Lambda behind a CloudFront `/api/*` behavior with an OAC-signed function URL. Cognito JWTs are verified in-function and carried in `x-authorization`, because OAC signing owns the real `Authorization` header. Requests with a body carry `x-amz-content-sha256`. |
| **Ingestion** | A provider layer (`api/src/providers`): each band supplies OAuth, its collections and a conversion into the shared record format; connection storage, token refresh, the sync loop and the routes are common. **WHOOP**: rotating token refresh, and webhooks on a dedicated public function URL (WHOOP can't sign OAC payload hashes), so HMAC is the auth. **Fitbit Air**: Google OAuth and the Google Health API, pulled when the app is opened (at most once per ten minutes) since its webhooks are not wired up yet. For both, a nightly reconciliation re-pulls 14 days per connected user, and raw vendor JSON is archived to S3 for future reprocessing. |
| **Data** | DynamoDB single table: a `USER#<id>` partition with ISO-dated sort keys (`SLEEP#`, `RECOVERY#`, `CYCLE#`, `SESSION#`, `WORKOUT#`, `TEMPLATE#`, `EXERCISE#`), so every dashboard query is a key range. Editing a workout's start time moves its rows transactionally. |
| **Infra** | Everything is AWS CDK (TypeScript) in one stack, including the GitHub Actions OIDC deploy role. |

## Repository layout

An npm workspaces monorepo:

| Path | What's in it |
|---|---|
| `shared/` | The wearable data contract: types only, imported by both `web/` and `api/` |
| `web/` | The React PWA, including the progression engine and the built-in coach |
| `api/` | Lambda handlers: the API, strap sync (`providers/`, `whoop/`, `google/`), and the webhook receiver |
| `infra/` | The CDK stack |
| `PROGRESSION.md` | How the auto-progression engine decides what to recommend, with sources |

## Development

```sh
npm install
npm run dev      # Vite dev server (proxies /api to production)
npm run build    # typecheck + production build
npm run lint     # oxlint over web/
npm test -w web  # unit tests for the coach's engine checks and strap state
npm test -w api  # ingestion end to end against in-memory AWS and fake vendor APIs
npm run synth    # synthesize the CDK stack to validate infra
```

## Deploying

- **Web** ships automatically: every push to `main` runs the GitHub Actions
  workflow, which builds the PWA and syncs it to S3 in about 30 seconds.
- **Infra** deploys run locally with `npm run deploy`.

### Enabling a strap

Each band's OAuth client id and secret are SSM SecureStrings written once by
hand. A band is not offered in Settings until its pair exists.

```sh
# WHOOP — redirect URI https://<domain>/api/whoop/callback
aws ssm put-parameter --type SecureString --name /fit/whoop/client-id --value ...
aws ssm put-parameter --type SecureString --name /fit/whoop/client-secret --value ...

# Fitbit Air — redirect URI https://<domain>/api/google/callback
aws ssm put-parameter --type SecureString --name /fit/google/client-id --value ...
aws ssm put-parameter --type SecureString --name /fit/google/client-secret --value ...
```

For Fitbit Air, the client comes from a Google Cloud project with the
[Google Health API](https://developers.google.com/health/setup) enabled and
three scopes added: `googlehealth.sleep.readonly`,
`googlehealth.health_metrics_and_measurements.readonly` and
`googlehealth.activity_and_fitness.readonly`. An unverified project serves up
to 100 people, each added as a test user. While its consent screen is in
"Testing", Google expires refresh tokens after 7 days and the strap asks to be
reconnected; "In production" removes that. Each person signs in to the Google
Health app with their Google account before connecting.

Adding another band is one adapter: implement `StrapProvider`
(`api/src/providers/types.ts`), convert its records into the shared format,
and list it in `api/src/providers/registry.ts`.

### Enabling the live coach

After the first `npm run deploy`, store an Anthropic API key once:

```sh
aws ssm put-parameter --type SecureString \
  --name /fit/agent/anthropic-api-key --value sk-ant-...
```

Until that parameter exists, `/api/agent` answers `503` and the app uses the
built-in rules-only coach.

Optional Lambda environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_MODEL` | `claude-haiku-5-5` | Model the coach runs on |
| `AGENT_EFFORT` | `medium` | Effort level passed to the model |
| `AGENT_DAILY_CALLS` | `150` | Per-account daily call budget |
| `AGENT_DAILY_INPUT_TOKENS` | `2,000,000` | Per-account daily input-token budget |
| `AGENT_STRICT_TOOLS` | on | Strict tool schemas; set to `0` to turn them off |

## Cost

At friends-and-family scale the AWS bill is a rounding error:

- CloudFront — 1 TB/month free
- Lambda — 1M requests/month free
- DynamoDB — pennies, pay-per-request
- Cognito — free under 10k monthly active users
- EventBridge and S3 — negligible

The coach is the one metered part: Claude Haiku 5.5 at $0.10 / $0.50 per
million input / output tokens. A turn is roughly 4k cached prefix tokens,
1.5k tokens of fresh state, and under 1k out — about a tenth of a cent. The
daily per-account cap bounds the worst case at pennies.

## Milestones

- [x] **M0 — Infrastructure:** subdomain, CDK stack, OIDC CI deploy
- [x] **M1 — Accounts & authenticated API:** invite-only Cognito, login, DynamoDB
- [x] **M2 — Ingestion:** WHOOP OAuth, webhooks, nightly sync, full-history backfill;
  Fitbit Air through the Google Health API behind a shared provider layer
- [x] **M3 — Recovery dashboard:** RHR/HRV/sleep trends with rolling baselines
- [x] **M4 — Workout logger:** offline-capable sessions, templates, interval timer
- [x] **M5 — Training analytics:** e1RM, volume, PRs, zones, load vs. recovery
- [x] **M6 — Portfolio polish:** public demo mode, code-splitting, docs
- [x] **M7 — The coach:** agent-centred home, day plans and blocks built in
  conversation and validated by the engine; monochrome palette with a
  dark-blue accent
