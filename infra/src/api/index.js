import { createHash, randomUUID } from "node:crypto";
import {
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  UpdateItemCommand
} from "@aws-sdk/client-dynamodb";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const tableName = process.env.TABLE_NAME;
const allowedOrigin = process.env.ALLOWED_ORIGIN || "https://drbom.net";
const hashSalt = process.env.RATE_LIMIT_SALT;
const statsBucket = process.env.STATS_BUCKET;
const articlesPrefix = (process.env.ARTICLES_PREFIX || "articles/").replace(/^\/+/, "").replace(/\/?$/, "/");
const articleDataFileName = process.env.ARTICLE_DATA_FILE || "data.json";
const ddb = new DynamoDBClient({});
const s3 = new S3Client({});
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  if (!event.body) return {};
  const raw = event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body;
  return JSON.parse(raw);
}

function getHeader(event, name) {
  const headers = event.headers || {};
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value;
  }
  return "";
}

function getIp(event) {
  const forwarded = getHeader(event, "x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return event.requestContext?.http?.sourceIp || "unknown";
}

function ipHash(event) {
  return createHash("sha256").update(`${hashSalt}:${getIp(event)}`).digest("hex").slice(0, 32);
}

function assertSlug(slug) {
  if (!slugPattern.test(slug || "")) {
    const error = new Error("Invalid article slug.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizeString(value, max) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, max);
}

function hasUnsafeMarkup(value) {
  return /<\s*\/?\s*(script|iframe|object|embed|img|svg|math|link|style|meta|form|input|button)\b/i.test(value);
}

function nowIso() {
  return new Date().toISOString();
}

function hourBucket() {
  return new Date().toISOString().slice(0, 13);
}

function ttl(secondsFromNow) {
  return Math.floor(Date.now() / 1000) + secondsFromNow;
}

async function incrementRateLimit({ hash, kind, slug, limit, ttlSeconds }) {
  const key = {
    pk: { S: `RATE#${hash}` },
    sk: { S: `${kind}#${slug}#${hourBucket()}` }
  };
  const response = await ddb.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: key,
      UpdateExpression: "ADD #count :one SET #ttl = if_not_exists(#ttl, :ttl)",
      ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
      ExpressionAttributeNames: {
        "#count": "count",
        "#ttl": "ttl"
      },
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":limit": { N: String(limit) },
        ":ttl": { N: String(ttl(ttlSeconds)) }
      },
      ReturnValues: "UPDATED_NEW"
    })
  );
  return Number(response.Attributes?.count?.N || "1");
}

async function getStats(slugs) {
  const items = {};
  await Promise.all(
    slugs.map(async (slug) => {
      assertSlug(slug);
      const response = await ddb.send(
        new GetItemCommand({
          TableName: tableName,
          Key: {
            pk: { S: `ARTICLE#${slug}` },
            sk: { S: "META" }
          },
          ConsistentRead: false
        })
      );
      items[slug] = {
        likes: Number(response.Item?.likes?.N || "0"),
        comments: Number(response.Item?.comments?.N || "0")
      };
    })
  );
  return items;
}

async function bodyToString(body) {
  if (!body) return "";
  return await body.transformToString();
}

async function publishArticleDataStats(slug, stats) {
  if (!statsBucket) return;

  const key = `${articlesPrefix}${slug}/${articleDataFileName}`;
  const current = await s3.send(
    new GetObjectCommand({
      Bucket: statsBucket,
      Key: key
    })
  );
  const data = JSON.parse(await bodyToString(current.Body));
  data.stats = {
    likes: Number(stats.likes || 0),
    comments: Number(stats.comments || 0),
    updatedAt: nowIso()
  };

  await s3.send(
    new PutObjectCommand({
      Bucket: statsBucket,
      Key: key,
      Body: `${JSON.stringify(data, null, 2)}\n`,
      ContentType: "application/json; charset=utf-8",
      CacheControl: "max-age=10, must-revalidate"
    })
  );
}

async function publishArticleDataStatsBestEffort(slug, stats) {
  try {
    await publishArticleDataStats(slug, stats);
  } catch (error) {
    console.error(`Failed to publish article data stats for ${slug}.`, error);
  }
}

function encodeCursor(key) {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (!cursor) return undefined;
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

async function listComments(slug, query) {
  assertSlug(slug);
  const limit = Math.min(Math.max(Number(query.limit || 20), 1), 50);
  const response = await ddb.send(
    new QueryCommand({
      TableName: tableName,
      KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
      ExpressionAttributeValues: {
        ":pk": { S: `ARTICLE#${slug}` },
        ":prefix": { S: "COMMENT#" }
      },
      ScanIndexForward: false,
      Limit: limit,
      ExclusiveStartKey: decodeCursor(query.cursor)
    })
  );

  return {
    comments: (response.Items || []).map((item) => ({
      id: item.commentId.S,
      name: item.name.S,
      body: item.body.S,
      createdAt: item.createdAt.S
    })),
    cursor: encodeCursor(response.LastEvaluatedKey)
  };
}

async function postComment(slug, event) {
  assertSlug(slug);
  const body = parseBody(event);

  if (String(body.website || "").trim()) {
    return { ok: true };
  }

  const name = normalizeString(body.name, 40);
  const commentBody = String(body.body || "").trim();

  if (!name || name.length > 40) {
    const error = new Error("Name must be between 1 and 40 characters.");
    error.statusCode = 400;
    throw error;
  }
  if (!commentBody || commentBody.length > 1000) {
    const error = new Error("Comment must be between 1 and 1000 characters.");
    error.statusCode = 400;
    throw error;
  }
  if (hasUnsafeMarkup(name) || hasUnsafeMarkup(commentBody)) {
    const error = new Error("Comment contains unsupported markup.");
    error.statusCode = 400;
    throw error;
  }

  const hash = ipHash(event);
  await incrementRateLimit({ hash, kind: "COMMENT", slug, limit: 6, ttlSeconds: 7200 });

  const createdAt = nowIso();
  const id = randomUUID();
  const comment = {
    id,
    name,
    body: commentBody,
    createdAt
  };

  await ddb.send(
    new TransactWriteItemsCommand({
      TransactItems: [
        {
          Put: {
            TableName: tableName,
            Item: {
              pk: { S: `ARTICLE#${slug}` },
              sk: { S: `COMMENT#${createdAt}#${id}` },
              commentId: { S: id },
              name: { S: name },
              body: { S: commentBody },
              status: { S: "published" },
              createdAt: { S: createdAt },
              ipHash: { S: hash }
            }
          }
        },
        {
          Update: {
            TableName: tableName,
            Key: {
              pk: { S: `ARTICLE#${slug}` },
              sk: { S: "META" }
            },
            UpdateExpression: "ADD comments :one SET updatedAt = :now",
            ExpressionAttributeValues: {
              ":one": { N: "1" },
              ":now": { S: createdAt }
            }
          }
        }
      ]
    })
  );

  await publishArticleDataStatsBestEffort(slug, await getStats([slug]).then((items) => items[slug]));

  return { ok: true, comment };
}

async function postLike(slug, event) {
  assertSlug(slug);
  const body = parseBody(event);
  const clientId = normalizeString(body.clientId, 120);
  if (!clientId) {
    const error = new Error("clientId is required.");
    error.statusCode = 400;
    throw error;
  }

  const hash = ipHash(event);
  const clientHash = createHash("sha256").update(`${hashSalt}:${clientId}`).digest("hex").slice(0, 32);
  await incrementRateLimit({ hash: `${hash}#${clientHash}`, kind: "LIKE", slug, limit: 1, ttlSeconds: 31536000 });

  const response = await ddb.send(
    new UpdateItemCommand({
      TableName: tableName,
      Key: {
        pk: { S: `ARTICLE#${slug}` },
        sk: { S: "META" }
      },
      UpdateExpression: "ADD likes :one SET updatedAt = :now",
      ExpressionAttributeValues: {
        ":one": { N: "1" },
        ":now": { S: nowIso() }
      },
      ReturnValues: "ALL_NEW"
    })
  );

  await publishArticleDataStatsBestEffort(slug, {
    likes: Number(response.Attributes?.likes?.N || "0"),
    comments: Number(response.Attributes?.comments?.N || "0")
  });

  return { ok: true, likes: Number(response.Attributes?.likes?.N || "0") };
}

function route(event) {
  const method = event.requestContext?.http?.method || event.httpMethod;
  const path = event.rawPath || event.path || "/";
  const query = event.queryStringParameters || {};
  const origin = getHeader(event, "origin");
  return { method, path, query, origin };
}

export async function handler(event) {
  if (!hashSalt) {
    return json(500, { ok: false, error: "Server configuration error." });
  }

  const { method, path, query, origin } = route(event);

  try {
    if (method === "OPTIONS") {
      return { statusCode: 204, headers: {}, body: "" };
    }

    if (method === "GET" && path === "/health") {
      return json(200, { ok: true });
    }

    if (method === "GET" && path === "/stats") {
      const slugs = String(query.slugs || "")
        .split(",")
        .map((slug) => slug.trim())
        .filter(Boolean)
        .slice(0, 50);
      return json(200, { ok: true, items: await getStats(slugs) });
    }

    const commentMatch = path.match(/^\/articles\/([^/]+)\/comments$/);
    if (commentMatch && method === "GET") {
      return json(200, { ok: true, ...(await listComments(commentMatch[1], query)) });
    }
    if (commentMatch && method === "POST") {
      return json(200, await postComment(commentMatch[1], event));
    }

    const likeMatch = path.match(/^\/articles\/([^/]+)\/likes$/);
    if (likeMatch && method === "POST") {
      return json(200, await postLike(likeMatch[1], event));
    }

    return json(404, { ok: false, error: "Not found." });
  } catch (error) {
    const status = error.name === "ConditionalCheckFailedException" ? 429 : error.statusCode || 500;
    const message =
      error.name === "ConditionalCheckFailedException"
        ? "Rate limit exceeded."
        : status === 500
          ? "Internal server error."
          : error.message;
    console.error(error);
    return json(status, { ok: false, error: message });
  }
}
