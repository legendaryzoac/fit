# fit — training & recovery tracker

Personal WHOOP-replacement living at [fit.zackwithers.com](https://fit.zackwithers.com):
recovery dashboards (RHR, HRV, sleep) fed by the WHOOP API, plus a gym-friendly workout
logger with strength and cardio analytics that no consumer app does well. Built to run
on AWS always-free tiers (~$0/month) as a portfolio project.

## How data flows

WHOOP strap → WHOOP app/cloud (proprietary sync, computes HRV/recovery) → this system
pulls it via the WHOOP API v2 through two paths: webhooks for push updates and a nightly
EventBridge-scheduled reconciliation. Everything is normalized behind a wearable-agnostic
adapter into DynamoDB, served by Lambda to a static PWA on S3 + CloudFront.

## Monorepo layout

- `web/` — Vite + React 19 + Tailwind 4 PWA (the entire UI)
- `infra/` — AWS CDK app (TypeScript); one stack per concern, starting with `FitSite`
  (S3 + CloudFront + ACM cert + Route 53 records)

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
- [ ] M1 — ingestion: WHOOP OAuth, webhooks, nightly sync, history backfill
- [ ] M2 — recovery dashboard: RHR/HRV/sleep trends with rolling baselines
- [ ] M3 — workout logger: offline-capable strength logging, cardio session linking
- [ ] M4 — training analytics: e1RM, volume, PRs, cardio efficiency, load-vs-recovery
- [ ] M5 — portfolio polish: public demo mode with synthetic data

## Cost

S3 + CloudFront (1 TB/mo free) + Lambda (1M req/mo free) + DynamoDB (25 GB free) +
EventBridge + Route 53 records on the existing zone: effectively $0/month at
single-user scale. See `DEPLOYMENT.md` for the setup checklist.
