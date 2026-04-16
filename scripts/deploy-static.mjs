import { readdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { articlesDir, cacheControlFor, contentTypeFor, repoRoot } from "./lib.mjs";

const bucket = process.env.ARTICLES_BUCKET || "drbom.net";
const prefix = (process.env.ARTICLES_PREFIX || "articles/").replace(/^\/+/, "").replace(/\/?$/, "/");

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
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

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(fullPath)));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

await run("node", ["scripts/build-index.mjs"]);
await run("node", ["scripts/validate-article.mjs"]);

const files = await walk(articlesDir);
const localKeys = new Set(files.map((file) => `${prefix}${path.relative(articlesDir, file).split(path.sep).join("/")}`));

const remoteJson = await run(
  "aws",
  [
    "s3api",
    "list-objects-v2",
    "--bucket",
    bucket,
    "--prefix",
    prefix,
    "--query",
    "Contents[].Key",
    "--output",
    "json"
  ],
  { capture: true }
);
const remoteKeys = JSON.parse(remoteJson || "[]") || [];
for (const key of remoteKeys) {
  if (key.startsWith(`${prefix}_deploy/`)) continue;
  if (!localKeys.has(key)) {
    await run("aws", ["s3api", "delete-object", "--bucket", bucket, "--key", key]);
    console.log(`Deleted s3://${bucket}/${key}`);
  }
}

for (const file of files) {
  const fileStat = await stat(file);
  if (!fileStat.isFile()) continue;
  const relative = path.relative(articlesDir, file).split(path.sep).join("/");
  const key = `${prefix}${relative}`;
  const s3Uri = `s3://${bucket}/${key}`;
  await run("aws", [
    "s3api",
    "put-object",
    "--bucket",
    bucket,
    "--key",
    key,
    "--body",
    file,
    "--content-type",
    contentTypeFor(file),
    "--cache-control",
    cacheControlFor(file)
  ]);
  console.log(`Uploaded ${s3Uri}`);
}
