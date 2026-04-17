import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const articlesDir = path.join(repoRoot, "public", "articles");
export const apiConfigFile = path.join(articlesDir, "shared", "article-shell.js");
export const articleDataFileName = "data.json";

export const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const absoluteUrlPattern = /^https?:\/\//i;

export async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function getArticleSlugs() {
  const entries = await readdir(articlesDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith(".") && name !== "shared")
    .sort();
}

export function validateArticleMetadata(slug, metadata) {
  const errors = [];

  if (!slugPattern.test(slug)) {
    errors.push(`Folder name "${slug}" must be a lowercase slug.`);
  }
  if (metadata.slug !== slug) {
    errors.push(`data.json slug must match folder name "${slug}".`);
  }
  for (const field of ["title", "description", "publishedAt", "updatedAt", "thumbnail", "author"]) {
    if (typeof metadata[field] !== "string" || !metadata[field].trim()) {
      errors.push(`${field} must be a non-empty string.`);
    }
  }
  for (const field of ["publishedAt", "updatedAt"]) {
    if (metadata[field] && Number.isNaN(Date.parse(metadata[field]))) {
      errors.push(`${field} must be a valid date string.`);
    }
  }
  if (!Array.isArray(metadata.tags) || metadata.tags.some((tag) => typeof tag !== "string" || !tag.trim())) {
    errors.push("tags must be an array of non-empty strings.");
  }
  if (typeof metadata.draft !== "boolean") {
    errors.push("draft must be a boolean.");
  }
  if (metadata.thumbnail?.startsWith("/") || metadata.thumbnail?.startsWith("../")) {
    errors.push("thumbnail must be relative to the article folder or an absolute URL.");
  }
  if (metadata.stats !== undefined) {
    if (typeof metadata.stats !== "object" || metadata.stats === null || Array.isArray(metadata.stats)) {
      errors.push("stats must be an object when present.");
    } else {
      for (const field of ["likes", "comments"]) {
        if (!Number.isInteger(metadata.stats[field]) || metadata.stats[field] < 0) {
          errors.push(`stats.${field} must be a non-negative integer.`);
        }
      }
      if (metadata.stats.updatedAt !== undefined && Number.isNaN(Date.parse(metadata.stats.updatedAt))) {
        errors.push("stats.updatedAt must be a valid date string when present.");
      }
    }
  }

  return errors;
}

export function isContentHashed(filePath) {
  const base = path.basename(filePath);
  return /(?:^|[-.])[a-f0-9]{8,}(?:[-.]|$)/i.test(base);
}

export function contentTypeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".mp4": "video/mp4",
    ".txt": "text/plain; charset=utf-8"
  };
  return types[ext] || "application/octet-stream";
}

export function cacheControlFor(filePath) {
  if (path.basename(filePath) === articleDataFileName) {
    return "max-age=10, must-revalidate";
  }

  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html" || ext === ".json" || ext === ".js" || ext === ".css") {
    return "max-age=60, must-revalidate";
  }
  if (isContentHashed(filePath)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=3600";
}
