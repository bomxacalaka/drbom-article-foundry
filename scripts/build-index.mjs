import { writeFile } from "node:fs/promises";
import path from "node:path";
import { articleDataFileName, articlesDir, getArticleSlugs, readJson } from "./lib.mjs";

const slugs = await getArticleSlugs();
const articles = [];

for (const slug of slugs) {
  const metadata = await readJson(path.join(articlesDir, slug, articleDataFileName));
  if (!metadata.draft) {
    articles.push({
      slug: metadata.slug,
      title: metadata.title,
      description: metadata.description,
      publishedAt: metadata.publishedAt,
      updatedAt: metadata.updatedAt,
      data: `./${metadata.slug}/${articleDataFileName}`
    });
  }
}

articles.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt) || a.slug.localeCompare(b.slug));

await writeFile(
  path.join(articlesDir, "articles.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), articles }, null, 2)}\n`
);

console.log(`Wrote ${articles.length} published article(s) to public/articles/articles.json`);
