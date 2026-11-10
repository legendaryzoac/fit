# fit — training & recovery tracker

**Live:** [fit.zackwithers.com](https://fit.zackwithers.com) — hit **"Explore the
live demo"** on the login screen to walk through the whole product on synthetic
data, no account needed.

A personal WHOOP-replacement: recovery dashboards (HRV, resting HR, sleep) fed
by the WHOOP API, plus the training half no consumer app does well — an
offline-capable gym logger with templates, an interval timer for speed/cardio
sessions, and analytics that connect training load to recovery. Invite-only
multi-user (a handful of friends), built to run on AWS always-free tiers at
effectively **$0/month**.

## What it does

- **Coach** — the home screen opens on one question, *"What wall are we
  running through today?"*, and a coach that answers it. It plans the day
  (session, warm-up, cool-down, wind-down), reshapes it when you say you are
  short on time, run down or working around something, and builds training
  blocks by talking them through. It runs on the cheapest current Claude
  model; what makes it good is that it only proposes. Every plan and block is
  checked by the progression engine (volume landmarks, the per-session cap,
  the exercise catalog) before you see it, and a block it built opens in the
  same editor as one you laid out by hand. See [The coach](#the-coach).
- **Recovery** — daily HRV/RHR/recovery trends against rolling baselines,
  sleep-stage breakdowns, and sleep performance, ingested from WHOOP.
- **Logger** — RP-style active sessions: per-set check-offs with last-time
  ghosts (checking an empty row means "same as last time"), previous-set
  autofill, reusable templates, and localStorage drafts that survive a dead
  phone battery mid-workout. Writes are local-first and replay through an
  offline queue.
- **Interval timer** — speed/cardio sessions run a full-screen, timestamp-drift-free
  countdown with color-coded warm-up/work/rest/cool-down sections, pause/skip,
  and audio + vibration cues; cardio finishes into a mileage + WHOOP-link summary.
- **Analytics** — strain-vs-recovery overlay, per-exercise Epley e1RM trends and
  PRs, weekly tonnage by muscle group, sprint-time progression, HR zone mix,
  bedtime consistency, run pace-vs-HR efficiency, recovery by weekday.
- **Demo mode** — a deterministic synthetic-data engine implements the entire
  API surface client-side behind the same interface, in a namespaced storage
  sandbox that can't touch real data.

## Architecture

```
WHOOP strap ──> WHOOP app/cloud ──webhook──> Lambda (fn URL, HMAC-verified) ──┐
                       │                                                      ▼
                       └───────nightly EventBridge──> sync Lambda ──> DynamoDB single table
                                                          │           (wearable-agnostic
                                                          ▼            entities, USER#-keyed)
                                                      S3 raw archive        │
                                                                            ▼
Browser (React PWA) <──CloudFront── S3 static site          api Lambda (fn URL + OAC)
        └────────────── /api/* behavior (OAC-signed) ──────────────┘
```

- **Frontend:** React 19 + Vite + Tailwind 4 PWA, service-worker precached,
  Recharts lazy-loaded off the critical path (~100 KB gz first load).
- **API:** one Lambda behind a CloudFront `/api/*` behavior with an OAC-signed
  function URL; Cognito JWTs verified in-function (carried in `x-authorization`
  because OAC signing owns the real `Authorization` header; bodied requests
  carry `x-amz-content-sha256`).
- **Ingestion:** per-user WHOOP OAuth with rotating token refresh; webhooks on
  a dedicated public function URL (WHOOP can't sign OAC payload hashes), HMAC
  is the auth; nightly reconciliation re-pulls 14 days per connected user; raw
  vendor JSON archived to S3 for future reprocessing.
- **Data:** DynamoDB single table — `USER#<id>` partition with ISO-dated sort
  keys (`SLEEP#`, `RECOVERY#`, `CYCLE#`, `SESSION#`, `WORKOUT#`, `TEMPLATE#`,
  `EXERCISE#`) so every dashboard query is a key range. Workout edits that
  change the start time move rows transactionally.
- **Infra:** everything is AWS CDK (TypeScript) in one stack, including the
  GitHub Actions OIDC deploy role. Web deploys ship via CI in ~30s; infra
  deploys run locally.

## The coach

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

- **The model proposes, the engine disposes.** The coach's tools
  (`set_day_plan`, `propose_block`, `get_exercise_history`, `log_checkin`,
  `remember`, …) run in the browser, where the data and the engine already
  live. A day plan is built from ids of things the app can already start; a
  block is validated against the landmarks in `PROGRESSION.md`. What fails
  goes back to the model as an error to fix; what was clamped is shown on the
  card. Nothing starts and no block is saved without a tap.
- **Front-loaded, so it is cheap.** The research digest and the tool list
  are a fixed, cached prefix. Each message carries a compact `<state>`
  snapshot the engine computed (today's session with targets, weekly sets per
  muscle with zones, readiness, flags), so most turns are one model call.
  Between turns the conversation is plain text, so nothing on the device
  depends on the prompt or model version. A turn costs a fraction of a cent.
- **Guard rails on the server.** The Lambda owns the model id, the system
  prompt, the tool list and the output cap, rebuilds the conversation block
  by block before forwarding it, and counts calls per account per day
  (`AGENT_DAILY_CALLS`, default 150) in DynamoDB.
- **Works without the model.** The demo, offline use, and a stack with no
  API key all run a rules-only coach built into the app that speaks the same
  tool format, so the cards and the engine checks are identical.

Turning the live coach on (once, after `npm run deploy`):

```sh
aws ssm put-parameter --type SecureString \
  --name /fit/agent/anthropic-api-key --value sk-ant-...
```

Until that parameter exists `/api/agent` answers 503 and the app uses the
built-in coach. Optional Lambda environment: `AGENT_MODEL`
(`claude-haiku-5-5`), `AGENT_EFFORT` (`medium`), `AGENT_DAILY_CALLS`,
`AGENT_STRICT_TOOLS`.

## Cost

CloudFront (1 TB/mo free) + Lambda (1M req/mo free) + DynamoDB (pennies
pay-per-request) + Cognito (free under 10k MAU) + EventBridge + S3: rounding
error per month at friends-and-family scale. The coach is the one metered
part: Claude Haiku 5.5 at $0.10 / $0.50 per million tokens in / out puts a
typical turn well under a tenth of a cent, and the daily per-account cap
bounds the worst case.

## Monorepo

- `web/` — the PWA
- `api/` — Lambda handlers (API, WHOOP sync, webhook)
- `infra/` — CDK stack

```sh
npm run dev      # vite dev server (proxies /api to prod)
npm run build    # typecheck + production build
npm test -w web  # unit tests for the coach's engine checks
npm run synth    # validate infra
npm run deploy   # deploy infra (web ships via CI on push)
```

## Milestones

- [x] M0 — infrastructure: subdomain, CDK stack, OIDC CI deploy
- [x] M1 — accounts & authenticated API: invite-only Cognito, login, DynamoDB
- [x] M2 — ingestion: WHOOP OAuth, webhooks, nightly sync, full-history backfill
- [x] M3 — recovery dashboard: RHR/HRV/sleep trends with rolling baselines
- [x] M4 — workout logger: offline-capable sessions, templates, interval timer
- [x] M5 — training analytics: e1RM, volume, PRs, zones, load-vs-recovery
- [x] M6 — portfolio polish: public demo mode, code-splitting, docs
- [x] M7 — the coach: agent-centred home, day plans and blocks built in
  conversation, engine-validated; monochrome palette with a dark-blue accent
