# Getting fit.zackwithers.com live: 0 → production checklist

Unlike the adversarial-playground (console-created bucket), all AWS resources here are
CDK-managed. Infra deploys run locally with your credentials; CI only ships the web build.

## 1. One-time AWS setup (done during M0)

- [x] `npx cdk bootstrap aws://545628619410/us-east-1` (CDKToolkit stack)
- [x] `npm run deploy` — creates ACM cert (DNS-validated automatically against the
      zackwithers.com hosted zone), private S3 bucket with Origin Access Control,
      CloudFront distribution, and the `fit` A/AAAA alias records
- [x] Note the stack outputs: `BucketName`, `DistributionId`

## 2. GitHub repo

- [ ] `git init` done locally; create the repo when ready:
      `gh repo create fit --public --source . --push` (public = portfolio piece)
- [ ] Repo settings → Secrets and variables → Actions:
  - Variable `S3_BUCKET` — from stack output `BucketName`
  - Variable `CLOUDFRONT_DISTRIBUTION_ID` — from stack output `DistributionId`
  - Secret `AWS_ROLE_ARN` — created in step 3

## 3. AWS: OIDC role for GitHub Actions (no long-lived keys)

- [ ] IAM → Identity providers: `token.actions.githubusercontent.com` already exists
      from the adversarial-playground setup — reuse it
- [ ] Create an IAM role trusted by that provider with condition
      `token.actions.githubusercontent.com:sub` = `repo:<you>/fit:ref:refs/heads/main`
- [ ] Minimal permissions policy:
  - `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket` on the site bucket + objects
  - `cloudfront:CreateInvalidation` on the distribution
- [ ] Copy the role ARN into the `AWS_ROLE_ARN` repo secret

## 4. Deploys after that

- **Web changes**: push to `main` → Actions builds `web/` and syncs to S3 + invalidates
- **Infra changes**: `npm run deploy` locally (CDK diff shows what changes first)

## Secrets policy

WHOOP client id/secret never enter this repo. From M1 on they live in SSM Parameter
Store (SecureString), written once by hand:
`aws ssm put-parameter --name /fit/whoop/client-id --type SecureString --value ...`
