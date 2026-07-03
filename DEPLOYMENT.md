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

- [x] Repo: [legendaryzoac/fit](https://github.com/legendaryzoac/fit) (public — portfolio piece)
- [x] Repo settings → Secrets and variables → Actions:
  - Variable `S3_BUCKET` — from stack output `BucketName`
  - Variable `CLOUDFRONT_DISTRIBUTION_ID` — from stack output `DistributionId`
  - Secret `AWS_ROLE_ARN` — from stack output `CiRoleArn`

## 3. AWS: OIDC role for GitHub Actions (no long-lived keys)

- [x] The `token.actions.githubusercontent.com` identity provider already existed
      from the adversarial-playground setup and is reused
- [x] The deploy role is **CDK-managed** (`GithubDeployRole` in
      `infra/lib/site-stack.ts`): trusted for `repo:legendaryzoac/fit:ref:refs/heads/main`
      only, with S3 put/delete/list on the site bucket and
      `cloudfront:CreateInvalidation` on the distribution

## 4. Deploys after that

- **Web changes**: push to `main` → Actions builds `web/` and syncs to S3 + invalidates
- **Infra changes**: `npm run deploy` locally (CDK diff shows what changes first)

## Inviting a user (you + up to ~5 friends)

There is no public sign-up. Create accounts by hand:

```sh
aws cognito-idp admin-create-user \
  --user-pool-id us-east-1_2ehtxnXC9 \
  --username friend@example.com \
  --user-attributes Name=email,Value=friend@example.com Name=email_verified,Value=true
```

Cognito emails them a temporary password (built-in mailer, 50 emails/day cap —
plenty). On first sign-in the app walks them through choosing a real password
(12+ characters). To revoke access: `admin-disable-user` with the same identifiers.

## Secrets policy

WHOOP client id/secret never enter this repo. From M1 on they live in SSM Parameter
Store (SecureString), written once by hand:
`aws ssm put-parameter --name /fit/whoop/client-id --type SecureString --value ...`
