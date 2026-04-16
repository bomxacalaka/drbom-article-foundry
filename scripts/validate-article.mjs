import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  absoluteUrlPattern,
  apiConfigFile,
  articlesDir,
  getArticleSlugs,
  pathExists,
  readJson,
  validateArticleMetadata
} from "./lib.mjs";

const errors = [];
const seen = new Set();

if (!(await pathExists(articlesDir))) {
  errors.push("public/articles does not exist.");
}

const apiConfig = await readFile(apiConfigFile, "utf8").catch(() => "");
if (!apiConfig.includes("window.ARTICLES_API_BASE_URL")) {
  errors.push("shared/article-shell.js must define window.ARTICLES_API_BASE_URL.");
}

for (const slug of await getArticleSlugs()) {
  const articleDir = path.join(articlesDir, slug);
  const metadataPath = path.join(articleDir, "article.json");

  if (seen.has(slug)) {
    errors.push(`Duplicate article slug: ${slug}`);
  }
  seen.add(slug);

  if (!(await pathExists(metadataPath))) {
    errors.push(`${slug}: missing article.json`);
    continue;
  }

  let metadata;
  try {
    metadata = await readJson(metadataPath);
  } catch (error) {
    errors.push(`${slug}: article.json is not valid JSON: ${error.message}`);
    continue;
  }

  for (const error of validateArticleMetadata(slug, metadata)) {
    errors.push(`${slug}: ${error}`);
  }

  for (const required of ["index.html", "style.css", "script.js"]) {
    if (!(await pathExists(path.join(articleDir, required)))) {
      errors.push(`${slug}: missing ${required}`);
    }
  }

  if (metadata.thumbnail && !absoluteUrlPattern.test(metadata.thumbnail)) {
    const thumbnailPath = path.resolve(articleDir, metadata.thumbnail);
    if (!thumbnailPath.startsWith(articleDir)) {
      errors.push(`${slug}: thumbnail escapes article folder.`);
    } else if (!(await pathExists(thumbnailPath))) {
      errors.push(`${slug}: thumbnail does not exist: ${metadata.thumbnail}`);
    }
  }

  const html = await readFile(path.join(articleDir, "index.html"), "utf8").catch(() => "");
  if (!metadata.draft && !html.includes("article-shell.js")) {
    errors.push(`${slug}: index.html should load shared/article-shell.js.`);
  }
}

if (await pathExists(path.join(articlesDir, "articles.json"))) {
  const index = await readJson(path.join(articlesDir, "articles.json")).catch((error) => {
    errors.push(`articles.json is invalid JSON: ${error.message}`);
    return null;
  });
  if (index) {
    const dates = (index.articles || []).map((article) => Date.parse(article.publishedAt));
    for (let i = 1; i < dates.length; i += 1) {
      if (dates[i] > dates[i - 1]) {
        errors.push("articles.json must be sorted by publishedAt descending.");
        break;
      }
    }
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log("Article validation passed.");
