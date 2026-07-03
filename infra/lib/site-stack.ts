import * as path from 'node:path'
import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
} from 'aws-cdk-lib'
import * as acm from 'aws-cdk-lib/aws-certificatemanager'
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront'
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins'
import * as cognito from 'aws-cdk-lib/aws-cognito'
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb'
import * as events from 'aws-cdk-lib/aws-events'
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets'
import * as iam from 'aws-cdk-lib/aws-iam'
import * as lambda from 'aws-cdk-lib/aws-lambda'
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs'
import * as logs from 'aws-cdk-lib/aws-logs'
import * as route53 from 'aws-cdk-lib/aws-route53'
import * as targets from 'aws-cdk-lib/aws-route53-targets'
import * as s3 from 'aws-cdk-lib/aws-s3'
import type { Construct } from 'constructs'

const DOMAIN = 'fit.zackwithers.com'
const ZONE_ID = 'Z0874780F3FVBPDZKEOR'
const ZONE_NAME = 'zackwithers.com'
const GITHUB_REPO = 'legendaryzoac/fit'

export class SiteStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props)

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: ZONE_ID,
      zoneName: ZONE_NAME,
    })

    // CloudFront requires the cert in us-east-1; the whole stack lives there.
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: DOMAIN,
      validation: acm.CertificateValidation.fromDns(zone),
    })

    const siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
    })

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultRootObject: 'index.html',
      domainNames: [DOMAIN],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        compress: true,
      },
      // SPA routing: unknown paths fall through to index.html
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: Duration.minutes(1),
        },
      ],
    })

    new route53.ARecord(this, 'AliasRecord', {
      zone,
      recordName: 'fit',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    })

    new route53.AaaaRecord(this, 'AliasRecordIpv6', {
      zone,
      recordName: 'fit',
      target: route53.RecordTarget.fromAlias(
        new targets.CloudFrontTarget(distribution),
      ),
    })

    // ---- identity, data, API (M1) ----

    // Invite-only: accounts are created with admin-create-user, never self-signup.
    const userPool = new cognito.UserPool(this, 'Users', {
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      removalPolicy: RemovalPolicy.RETAIN,
    })

    const webClient = userPool.addClient('WebClient', {
      authFlows: { userSrp: true },
      preventUserExistenceErrors: true,
      refreshTokenValidity: Duration.days(60),
    })

    const table = new dynamodb.Table(this, 'DataTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'ttl',
      removalPolicy: RemovalPolicy.RETAIN,
    })

    // Sparse index: only WHOOP connection items set gsi1pk, so this lists
    // connected users without scanning entity data.
    table.addGlobalSecondaryIndex({
      indexName: 'gsi1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    })

    const apiFn = new NodejsFunction(this, 'ApiFn', {
      entry: path.join(__dirname, '../../api/src/handler.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        TABLE_NAME: table.tableName,
        USER_POOL_ID: userPool.userPoolId,
        CLIENT_ID: webClient.userPoolClientId,
      },
    })
    table.grantReadWriteData(apiFn)

    // Same-origin API: CloudFront routes /api/* to the function URL (OAC-signed),
    // so the browser never talks to the Lambda URL directly and CORS never exists.
    const fnUrl = apiFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
    })
    distribution.addBehavior(
      'api/*',
      origins.FunctionUrlOrigin.withOriginAccessControl(fnUrl),
      {
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy:
          cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    )
    // The OAC docs grant CloudFront both InvokeFunctionUrl and InvokeFunction;
    // CDK's withOriginAccessControl only adds the former, and URL invokes 403
    // without the latter.
    apiFn.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/${distribution.distributionId}`,
    })

    // ---- WHOOP ingestion (M2) ----

    // Untouched vendor JSON, kept for reprocessing when adapters change
    const rawBucket = new s3.Bucket(this, 'RawBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    })

    // WHOOP client id/secret are hand-written SSM SecureStrings, never in code
    const whoopSsmRead = new iam.PolicyStatement({
      actions: ['ssm:GetParameter'],
      resources: [
        `arn:aws:ssm:${this.region}:${this.account}:parameter/fit/whoop/*`,
      ],
    })

    const syncFn = new NodejsFunction(this, 'WhoopSyncFn', {
      entry: path.join(__dirname, '../../api/src/sync.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 512,
      timeout: Duration.minutes(10), // full-history backfill pages slowly on purpose
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        TABLE_NAME: table.tableName,
        RAW_BUCKET: rawBucket.bucketName,
        WHOOP_SSM_PREFIX: '/fit/whoop',
      },
    })
    table.grantReadWriteData(syncFn)
    rawBucket.grantPut(syncFn)
    syncFn.addToRolePolicy(whoopSsmRead)

    apiFn.addToRolePolicy(whoopSsmRead)
    apiFn.addEnvironment('SYNC_FUNCTION_NAME', syncFn.functionName)
    apiFn.addEnvironment('APP_URL', `https://${DOMAIN}`)
    apiFn.addEnvironment('WHOOP_SSM_PREFIX', '/fit/whoop')
    syncFn.grantInvoke(apiFn)

    // Reconciliation pass: scores change after the fact (sleep rescoring,
    // late uploads), webhooks cover the real-time path.
    new events.Rule(this, 'NightlyWhoopSync', {
      schedule: events.Schedule.cron({ minute: '0', hour: '17' }),
      targets: [
        new eventsTargets.LambdaFunction(syncFn, {
          event: events.RuleTargetInput.fromObject({ mode: 'nightly' }),
        }),
      ],
    })

    // Webhooks get a direct public function URL instead of the /api/*
    // behavior: OAC-signed origins demand an x-amz-content-sha256 payload
    // hash on POSTs, which WHOOP's servers don't send. Auth is the HMAC
    // signature check in the handler.
    const webhookFn = new NodejsFunction(this, 'WhoopWebhookFn', {
      entry: path.join(__dirname, '../../api/src/webhook.ts'),
      runtime: lambda.Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(10),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        TABLE_NAME: table.tableName,
        WHOOP_SSM_PREFIX: '/fit/whoop',
        SYNC_FUNCTION_NAME: syncFn.functionName,
      },
    })
    table.grantReadData(webhookFn)
    webhookFn.addToRolePolicy(whoopSsmRead)
    syncFn.grantInvoke(webhookFn)
    const webhookUrl = webhookFn.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.NONE,
    })

    // Deploy role assumed by GitHub Actions via the account's existing
    // OIDC provider; scoped to pushes on this repo's main branch.
    const ciRole = new iam.Role(this, 'GithubDeployRole', {
      roleName: 'fit-github-deploy',
      assumedBy: new iam.WebIdentityPrincipal(
        `arn:aws:iam::${this.account}:oidc-provider/token.actions.githubusercontent.com`,
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
            'token.actions.githubusercontent.com:sub': `repo:${GITHUB_REPO}:ref:refs/heads/main`,
          },
        },
      ),
    })
    siteBucket.grantPut(ciRole)
    siteBucket.grantDelete(ciRole)
    ciRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [siteBucket.bucketArn],
      }),
    )
    distribution.grantCreateInvalidation(ciRole)

    new CfnOutput(this, 'BucketName', { value: siteBucket.bucketName })
    new CfnOutput(this, 'DistributionId', { value: distribution.distributionId })
    new CfnOutput(this, 'CiRoleArn', { value: ciRole.roleArn })
    new CfnOutput(this, 'UserPoolId', { value: userPool.userPoolId })
    new CfnOutput(this, 'WebClientId', { value: webClient.userPoolClientId })
    new CfnOutput(this, 'WhoopWebhookUrl', { value: webhookUrl.url })
    new CfnOutput(this, 'Url', { value: `https://${DOMAIN}` })
  }
}
