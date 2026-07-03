# fit — training & recovery tracker

Personal WHOOP-replacement living at [fit.zackwithers.com](https://fit.zackwithers.com):
recovery dashboards (RHR, HRV, sleep) fed by the WHOOP API, plus a gym-friendly workout
logger with strength and cardio analytics that no consumer app does well. Built to run
on AWS always-free tiers (~$0/month) as a portfolio project.

Invite-only multi-user: a handful of friends get accounts (admin-created, no public
sign-up) for workout tracking. WHOOP connection is optional per user — friends without
a strap still get the full logger and strength analytics.

## How data flows

WHOOP strap → WHOOP app/cloud (proprietary sync, computes HRV/recovery) → this system
pulls it via the WHOOP API v2 through two paths: webhooks for push updates and a nightly
EventBridge-scheduled reconciliation. Everything is normalized behind a wearable-agnostic
adapter into DynamoDB, served by Lambda to a static PWA on S3 + CloudFront.

## Monorepo layout

- `web/` — Vite + React 19 + Tailwind 4 PWA (the entire UI)
- `api/` — Lambda handler behind CloudFront `/api/*` (Cognito-JWT auth, DynamoDB)
- `infra/` — AWS CDK app (TypeScript); the `FitSite` stack owns everything:
  S3 + CloudFront + cert + DNS, Cognito user pool, DynamoDB table, API Lambda

## Commands

```sh
npm run dev      # vite dev server
npm run build    # typecheck + production build of web/
npm run lint     # oxlint
npm run synth    # cdk synth (validate infra)
npm run deploy   # cdk deploy (infra changes; web deploys go through CI)
```

## Milestones

- [x] M0 — infrastructure: subdomain live, CDK stack, CI deploy
- [x] M1 — accounts & authenticated API: invite-only Cognito, login, DynamoDB, `/api/*`
- [x] M2 — ingestion: WHOOP OAuth (per-user, optional), webhooks, nightly sync, backfill
- [x] M3 — recovery dashboard: RHR/HRV/sleep trends with rolling baselines
- [x] M4 — workout logger: offline-capable strength logging, cardio session linking
- [ ] M5 — training analytics: e1RM, volume, PRs, cardio efficiency, load-vs-recovery
- [ ] M6 — portfolio polish: public demo mode with synthetic data

## Cost

S3 + CloudFront (1 TB/mo free) + Lambda (1M req/mo free) + DynamoDB (pay-per-request,
pennies at this volume) + Cognito (free below 10k monthly users) + EventBridge +
Route 53 records on the existing zone: effectively $0/month at friends-and-family
scale. See `DEPLOYMENT.md` for the setup checklist.
