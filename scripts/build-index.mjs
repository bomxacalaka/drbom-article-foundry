import { writeFile } from "node:fs/promises";
import path from "node:path";
import { articlesDir, getArticleSlugs, readJson } from "./lib.mjs";

const slugs = await getArticleSlugs();
const articles = [];

for (const slug of slugs) {
  const metadata = await readJson(path.join(articlesDir, slug, "article.json"));
  if (!metadata.draft) {
    articles.push(metadata);
  }
}

articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || a.slug.localeCompare(b.slug));

await writeFile(
  path.join(articlesDir, "articles.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), articles }, null, 2)}\n`
);

console.log(`Wrote ${articles.length} published article(s) to public/articles/articles.json`);
