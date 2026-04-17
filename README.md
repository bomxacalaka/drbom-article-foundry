# drbom Articles

Static articles live under `public/articles/` and deploy to:

```text
s3://drbom.net/articles/
```

The live likes/comments API is a Lambda Function URL backed by DynamoDB. The infrastructure is defined in `infra/template.yaml`.
Each article keeps public metadata and counts in its own `data.json`; Lambda refreshes the live article `data.json` after likes/comments change.

Future Codex sessions should read `AGENTS.md` before changing articles. It documents the default article workflow, theme rules, asset intake process, local preview expectations, and deployment boundaries.

## Common Commands

```bash
npm run article:new -- my-article "My Article Title"
npm run articles:validate
npm run articles:index
npm run deploy:infra
npm run deploy:static
```

`deploy:infra` requires a private salt for rate-limit hashes:

```bash
ARTICLES_RATE_LIMIT_SALT="replace-with-a-private-random-value" npm run deploy:infra
```

## Article Creation Flow

1. Put user-provided images, video, 3D files, and other raw assets in `assets/inbox/`.
2. Ask Codex to create or update an article.
3. Codex should inspect `assets/inbox/` and `assets/library/`, then copy selected production assets into `public/articles/<slug>/assets/`.
4. Codex should serve the article locally for review before publishing.
5. Iterate locally until the article looks right.
6. When ready, explicitly tell Codex to upload/publish/deploy.
7. Codex should then deploy static files to S3 and deploy Lambda/infrastructure only if needed.

By default, production article assets are served from S3 with the article. If you want heavy assets hosted elsewhere, say so explicitly for that article so Codex can discuss and document the tradeoff.

## Article Contract

Each article folder must contain:

```text
public/articles/<slug>/
  index.html
  style.css
  script.js
  data.json
  assets/
```

`data.json` must include:

```json
{
  "slug": "example-article",
  "title": "Example Article",
  "description": "Short description shown on the articles landing page.",
  "publishedAt": "2026-04-16T00:00:00.000Z",
  "updatedAt": "2026-04-16T00:00:00.000Z",
  "thumbnail": "./assets/thumbnail.svg",
  "tags": ["demo"],
  "author": "drbom",
  "draft": false,
  "stats": {
    "likes": 0,
    "comments": 0,
    "updatedAt": "2026-04-16T00:00:00.000Z"
  }
}
```

Draft articles are excluded from `public/articles/articles.json`.

## Default Theme

All pages should use the shared article shell unless you explicitly ask for a one-off design:

- `public/articles/shared/article-shell.css`
- `public/articles/shared/article-shell.js`

Article-specific styles and scripts live in the article folder. Keep the shared header, typography, color tokens, buttons, tags, and interaction patterns so new articles look like part of the same site by default.

## Frontend API Config

`public/articles/shared/article-shell.js` contains `window.ARTICLES_API_BASE_URL`. `npm run deploy:infra` outputs the real Lambda Function URL. Set that value before deploying static files if it changes.

New Lambda Function URLs require resource-policy permissions for both `lambda:InvokeFunctionUrl` and `lambda:InvokeFunction`. CloudFormation currently manages the `lambda:InvokeFunctionUrl` permission; `scripts/deploy-infra.mjs` then uses boto3 to ensure the `lambda:InvokeFunction` permission exists with `InvokedViaFunctionUrl=true`.

## Static Deploy

`scripts/deploy-static.mjs` validates articles, rebuilds `articles.json`, and uploads static files with cache headers:

- HTML/JSON: `max-age=60, must-revalidate`
- hashed static assets: `public, max-age=31536000, immutable`
- non-hashed static assets: `public, max-age=3600`

## Runtime Data

DynamoDB table:

```text
drbom-articles-interactions
```

Keys:

- `pk`
- `sk`

Item families:

- `ARTICLE#<slug> / META`
- `ARTICLE#<slug> / COMMENT#<iso>#<id>`
- `RATE#<hash> / <kind>#<slug>#<bucket>`

Comments are published immediately and rendered as text in the browser.

The index page should not call Lambda for counts. It fetches article-local data files listed in `articles.json`, for example:

```text
/articles/welcome/data.json
```

Article `data.json` files use `Cache-Control: max-age=10, must-revalidate`, so normal page loads avoid Lambda while still picking up recent interaction counts quickly.

## Deployment Permissions Note

The infrastructure template enables DynamoDB TTL for rate-limit records. The deploy principal needs these actions in addition to normal DynamoDB table permissions:

```json
[
  "dynamodb:UpdateTimeToLive",
  "dynamodb:DescribeTimeToLive"
]
```

`aws cloudformation deploy` also uses change sets, so the deploy principal needs:

```json
[
  "cloudformation:CreateChangeSet",
  "cloudformation:DescribeChangeSet",
  "cloudformation:ExecuteChangeSet",
  "cloudformation:DeleteChangeSet",
  "cloudformation:GetTemplateSummary"
]
```
