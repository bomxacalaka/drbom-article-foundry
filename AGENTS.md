# Codex Instructions For drbom Articles

This repo powers `https://drbom.net/articles/`. Future Codex sessions should treat this file as the source of truth for article creation, visual consistency, asset handling, local review, and deployment.

## Architecture

- Static article files live in `public/articles/`.
- The public articles prefix is `s3://drbom.net/articles/`.
- The live site is `https://drbom.net/articles/`.
- Likes and comments use the Lambda Function URL API configured in `public/articles/shared/article-shell.js`.
- Runtime data is stored in DynamoDB table `drbom-articles-interactions`.
- The article index reads counts from static `public/articles/stats.json`, not Lambda. Lambda refreshes `s3://drbom.net/articles/stats.json` after likes/comments change.
- Infrastructure is in `infra/template.yaml`.
- `scripts/deploy-infra.mjs` packages Lambda code, deploys CloudFormation, and ensures the newer Lambda Function URL invoke permission through boto3.
- `scripts/deploy-static.mjs` validates, rebuilds the article index, and uploads `public/articles/` to S3.

## Default Workflow

When the user asks to create or update an article/site:

1. Inspect `assets/inbox/`, `assets/library/`, and the target article folder if it exists.
2. Clarify only the details that cannot be inferred: article goal, title/slug, intended audience, and whether any special Lambda/API behavior is required.
3. Create or update the article under `public/articles/<slug>/`.
4. Reuse the shared theme by linking `../shared/article-shell.css` and `../shared/article-shell.js`.
5. Keep the article local and previewable until the user explicitly says to upload, deploy, publish, or make it live.
6. Serve locally for review with a simple static server, for example:

   ```bash
   python3 -m http.server 4173 --directory public
   ```

   Then preview at `http://localhost:4173/articles/<slug>/`.

7. Iterate locally with the user until the page looks right.
8. Before deployment, run:

   ```bash
   npm run articles:index
   npm run articles:validate
   ```

9. Only when the user explicitly approves publishing, deploy:

   ```bash
   npm run deploy:infra
   npm run deploy:static
   ```

   Skip `deploy:infra` if no Lambda/API/infrastructure code changed.

10. Smoke-test the live URLs after deploy.

## Article Contract

Every article folder must contain:

```text
public/articles/<slug>/
  index.html
  style.css
  script.js
  article.json
  assets/
```

`article.json` must match the folder slug and include title, description, dates, thumbnail, tags, author, and `draft`.

Use `draft: true` while a page is in progress. Set `draft: false` only when the user wants the article included on the live article index.

## Theme And Visual Consistency

All article pages should look like they belong to the same site by default.

Required defaults:

- Use `public/articles/shared/article-shell.css`.
- Use the sticky `.site-header` with the `drbom` brand link and `/articles/` nav link.
- Use the shared color tokens: `--bg`, `--panel`, `--text`, `--muted`, `--line`, `--accent`, `--accent-strong`.
- Use the same typography stack from `article-shell.css`.
- Keep cards at `8px` border radius or less.
- Prefer full-width article sections and clean editorial layouts over nested cards.
- Keep buttons on the shared `.button` and `.button--primary` classes unless the article needs a specialized control.
- Use `.meta-row` and `.tag` for dates/tags.
- Render comments through `window.ArticlesApi.hydrateArticle("<slug>")` when an article supports comments/likes.
- User-generated content must be rendered as text, never assigned through `innerHTML`.

Allowed customization:

- Article-specific layouts, media, 3D canvases, animations, and demos can live in the article's own `style.css` and `script.js`.
- Change the article mood with imagery, spacing, and local sections, but do not redefine the whole site theme unless the user explicitly asks for a one-off visual treatment.
- If building an interactive demo, keep the main article readable and make the demo a first-class section rather than a tiny embedded widget.

## Asset Handling

User-provided assets should be placed in `assets/inbox/` first. Codex should inspect them and then move/copy only the assets needed for a specific article into:

```text
public/articles/<slug>/assets/
```

Reusable assets that may help future articles belong in:

```text
assets/library/
```

Do not leave production article assets in `assets/inbox/`.

Current default hosting:

- Serve production article assets from S3 with the article.
- Use optimized formats: `.webp`, `.avif`, optimized `.png`, compressed `.mp4`, and `.glb`/`.gltf` for 3D.
- Keep filenames stable and descriptive.
- Use content-hashed filenames for long-lived heavy assets when practical, for example `hero-a1b2c3d4.webp`.

External asset hosting:

- Do not assume GitHub/raw GitHub URLs for production assets by default.
- If the user explicitly asks to reduce S3 storage by hosting heavy assets elsewhere, discuss the tradeoff first.
- Prefer reliable, cacheable public URLs over raw repository URLs.
- Document any external asset URL in the article folder, either in `article.json` or a local `ASSETS.md`.

## Local Review Rules

Before asking the user to review:

- Build or update `articles.json`.
- Run article validation.
- Start a local static server if the page needs browser behavior.
- Give the user the exact local URL.
- Keep the page as `draft: true` if the user is still reviewing.

For interactive/visual work:

- Check desktop and mobile viewport behavior.
- Ensure text does not overlap controls or media.
- Ensure buttons and form inputs have stable dimensions.
- Ensure all referenced local assets load.

## Deployment Rules

Do not deploy just because a page is created. Deploy only when the user clearly says to upload/publish/go live.

Deployment sequence:

1. `npm run articles:index`
2. `npm run articles:validate`
3. `npm run deploy:infra` only if infra or Lambda changed
4. `npm run deploy:static`
5. Smoke-test:

   ```bash
   curl -I https://drbom.net/articles/
   curl -I https://drbom.net/articles/<slug>/
   curl -sS "$ARTICLES_API_URL/health"
   curl -sS "$ARTICLES_API_URL/stats?slugs=<slug>"
   ```

Read the API URL from `public/articles/shared/article-shell.js` or the CloudFormation `ArticlesApiUrl` stack output.

## Lambda/API Additions

If the user asks for article-specific server behavior:

- Prefer adding narrowly scoped endpoints to `infra/src/api/index.js`.
- Keep general likes/comments behavior intact.
- Add DynamoDB item families using the existing `pk`/`sk` convention.
- Keep public endpoints rate-limited and validate all input.
- Avoid storing secrets in frontend files.
- Run syntax checks and deploy infra before deploying static pages that depend on the new API.
- Do not make the article index call Lambda for stat counts. Keep index reads on `./stats.json`; use Lambda only for writes and comment retrieval.

## Git Expectations

After a successful article or infrastructure change:

- Show `git status --short`.
- Do not commit unless the user asks.
- If the user asks to push to Git, commit the repo source files, not generated `.tmp/` artifacts.
- Do not use GitHub as production asset hosting unless the user explicitly approves that hosting strategy.
