import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { apiConfigFile, repoRoot } from "./lib.mjs";

const bucket = process.env.ARTICLES_BUCKET || "drbom.net";
const deployPrefix = (process.env.ARTICLES_DEPLOY_PREFIX || "articles/_deploy/").replace(/^\/+/, "").replace(/\/?$/, "/");
const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "eu-west-2";
const stackName = process.env.ARTICLES_STACK_NAME || "drbom-articles-api";
const tmpDir = path.join(repoRoot, ".tmp");
const zipPath = path.join(tmpDir, "drbom-articles-api.zip");
const codeKey = `${deployPrefix}drbom-articles-api-${Date.now()}.zip`;
const rateLimitSalt = process.env.ARTICLES_RATE_LIMIT_SALT;

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd || repoRoot,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit"
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}\n${stderr}`));
    });
  });
}

await mkdir(tmpDir, { recursive: true });
await rm(zipPath, { force: true });

if (!rateLimitSalt) {
  throw new Error("ARTICLES_RATE_LIMIT_SALT is required for deploy:infra.");
}

const identityJson = await run("aws", ["sts", "get-caller-identity", "--output", "json"], { capture: true });
const accountId = JSON.parse(identityJson).Account;
const deployUserArn = JSON.parse(identityJson).Arn;

const ttlSimulation = await run(
  "aws",
  [
    "iam",
    "simulate-principal-policy",
    "--policy-source-arn",
    deployUserArn,
    "--action-names",
    "dynamodb:UpdateTimeToLive",
    "dynamodb:DescribeTimeToLive",
    "--resource-arns",
    `arn:aws:dynamodb:${region}:${accountId}:table/drbom-articles-interactions`,
    "--region",
    region,
    "--output",
    "json"
  ],
  { capture: true }
);
const deniedTtlActions = JSON.parse(ttlSimulation).EvaluationResults.filter((result) => result.EvalDecision !== "allowed").map(
  (result) => result.EvalActionName
);
if (deniedTtlActions.length) {
  throw new Error(
    `Missing required DynamoDB TTL permissions for deploy: ${deniedTtlActions.join(", ")}. Add them to the homeserver articles policy and rerun npm run deploy:infra.`
  );
}

const changeSetSimulation = await run(
  "aws",
  [
    "iam",
    "simulate-principal-policy",
    "--policy-source-arn",
    deployUserArn,
    "--action-names",
    "cloudformation:CreateChangeSet",
    "cloudformation:DescribeChangeSet",
    "cloudformation:ExecuteChangeSet",
    "cloudformation:DeleteChangeSet",
    "cloudformation:GetTemplateSummary",
    "--resource-arns",
    `arn:aws:cloudformation:${region}:${accountId}:stack/${stackName}/*`,
    "--region",
    region,
    "--output",
    "json"
  ],
  { capture: true }
);
const deniedChangeSetActions = JSON.parse(changeSetSimulation).EvaluationResults.filter(
  (result) => result.EvalDecision !== "allowed"
).map((result) => result.EvalActionName);
if (deniedChangeSetActions.length) {
  throw new Error(
    `Missing required CloudFormation change-set permissions for deploy: ${deniedChangeSetActions.join(", ")}. Add them to the homeserver articles policy and rerun npm run deploy:infra.`
  );
}

await run("zip", ["-qr", zipPath, "."], { cwd: path.join(repoRoot, "infra", "src", "api") });

await run("aws", [
  "s3api",
  "put-object",
  "--bucket",
  bucket,
  "--key",
  codeKey,
  "--body",
  zipPath,
  "--content-type",
  "application/zip",
  "--cache-control",
  "no-store"
]);

await run("aws", [
  "cloudformation",
  "deploy",
  "--template-file",
  "infra/template.yaml",
  "--stack-name",
  stackName,
  "--capabilities",
  "CAPABILITY_NAMED_IAM",
  "--region",
  region,
  "--parameter-overrides",
  `CodeS3Bucket=${bucket}`,
  `CodeS3Key=${codeKey}`,
  `RateLimitSalt=${rateLimitSalt}`
]);

const stackJson = await run(
  "aws",
  [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--region",
    region,
    "--query",
    "Stacks[0].Outputs",
    "--output",
    "json"
  ],
  { capture: true }
);

const outputs = JSON.parse(stackJson);
const apiUrl = outputs.find((output) => output.OutputKey === "ArticlesApiUrl")?.OutputValue;
if (!apiUrl) {
  throw new Error("CloudFormation stack did not output ArticlesApiUrl.");
}

await run("python3", [
  "-c",
  `
import boto3
client = boto3.client('lambda', region_name='${region}')
try:
    client.add_permission(
        FunctionName='drbom-articles-api',
        StatementId='AllowPublicInvokeFunctionFromFunctionUrl',
        Action='lambda:InvokeFunction',
        Principal='*',
        InvokedViaFunctionUrl=True,
    )
    print('Added Lambda Function URL invoke permission.')
except client.exceptions.ResourceConflictException:
    print('Lambda Function URL invoke permission already exists.')
`
]);

const config = await readFile(apiConfigFile, "utf8");
const updated = config.replace(
  /window\.ARTICLES_API_BASE_URL = window\.ARTICLES_API_BASE_URL \|\| ".*?";/,
  `window.ARTICLES_API_BASE_URL = window.ARTICLES_API_BASE_URL || "${apiUrl.replace(/\/$/, "")}";`
);
await writeFile(apiConfigFile, updated);

console.log(`Articles API URL: ${apiUrl}`);
console.log("Updated public/articles/shared/article-shell.js");
