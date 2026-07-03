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

## Cost

CloudFront (1 TB/mo free) + Lambda (1M req/mo free) + DynamoDB (pennies
pay-per-request) + Cognito (free under 10k MAU) + EventBridge + S3: rounding
error per month at friends-and-family scale.

## Monorepo

- `web/` — the PWA
- `api/` — Lambda handlers (API, WHOOP sync, webhook)
- `infra/` — CDK stack

```sh
npm run dev      # vite dev server (proxies /api to prod)
npm run build    # typecheck + production build
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

See `DEPLOYMENT.md` for the zero-to-production checklist.
