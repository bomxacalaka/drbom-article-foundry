import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { articleDataFileName, articlesDir, pathExists, slugPattern } from "./lib.mjs";

const [slug, ...titleParts] = process.argv.slice(2);
const title = titleParts.join(" ").trim() || slug?.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");

if (!slug || !slugPattern.test(slug)) {
  console.error('Usage: npm run article:new -- "my-slug" "My Article Title"');
  console.error("Slug must be lowercase letters/numbers separated by hyphens.");
  process.exit(1);
}

const articleDir = path.join(articlesDir, slug);
if (await pathExists(articleDir)) {
  console.error(`Article already exists: ${articleDir}`);
  process.exit(1);
}

await mkdir(path.join(articleDir, "assets"), { recursive: true });
const now = new Date().toISOString();

await writeFile(
  path.join(articleDir, articleDataFileName),
  `${JSON.stringify(
    {
      slug,
      title,
      description: "Replace this with a short landing-page description.",
      publishedAt: now,
      updatedAt: now,
      thumbnail: "./assets/thumbnail.svg",
      tags: ["draft"],
      author: "drbom",
      draft: true,
      stats: {
        likes: 0,
        comments: 0,
        updatedAt: now
      }
    },
    null,
    2
  )}\n`
);

await writeFile(
  path.join(articleDir, "index.html"),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title} | drbom</title>
    <meta name="description" content="Replace this with the article description.">
    <link rel="stylesheet" href="../shared/article-shell.css">
    <link rel="stylesheet" href="./style.css">
  </head>
  <body>
    <header class="site-header">
      <div class="site-header__inner">
        <a class="brand" href="/">drbom</a>
        <a class="nav-link" href="/articles/">Articles</a>
      </div>
    </header>
    <main class="page">
      <article class="article-body">
        <h1>${title}</h1>
        <p>Write the article here.</p>
      </article>
    </main>
    <script src="../shared/article-shell.js"></script>
    <script src="./script.js"></script>
  </body>
</html>
`
);

await writeFile(path.join(articleDir, "style.css"), ".article-body { padding: 56px 0 80px; max-width: 760px; }\n");
await writeFile(path.join(articleDir, "script.js"), `window.ArticlesApi.hydrateArticle("${slug}");\n`);
await writeFile(
  path.join(articleDir, "assets", "thumbnail.svg"),
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 675"><rect width="1200" height="675" fill="#f8f7f3"/><text x="80" y="360" font-family="Arial" font-size="72" fill="#171717">Article thumbnail</text></svg>\n'
);

console.log(`Created ${path.relative(process.cwd(), articleDir)}`);
