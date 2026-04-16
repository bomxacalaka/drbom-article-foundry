const grid = document.getElementById("article-grid");
const empty = document.getElementById("empty-state");

function formatDate(value) {
  return new Date(value).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric"
  });
}

function makeCard(article, stats = { likes: 0, comments: 0 }) {
  const card = document.createElement("article");
  card.className = "article-card";

  const href = `./${article.slug}/`;
  const thumb = document.createElement("img");
  thumb.className = "article-card__thumb";
  thumb.src = `${href}${article.thumbnail.replace(/^\.\//, "")}`;
  thumb.alt = "";
  thumb.loading = "lazy";

  const body = document.createElement("div");
  body.className = "article-card__body";

  const meta = document.createElement("div");
  meta.className = "meta-row";
  const date = document.createElement("time");
  date.dateTime = article.publishedAt;
  date.textContent = formatDate(article.publishedAt);
  meta.append(date);
  for (const tag of article.tags || []) {
    const tagEl = document.createElement("span");
    tagEl.className = "tag";
    tagEl.textContent = tag;
    meta.append(tagEl);
  }

  const title = document.createElement("h2");
  const link = document.createElement("a");
  link.href = href;
  link.textContent = article.title;
  title.append(link);

  const description = document.createElement("p");
  description.textContent = article.description;

  body.append(meta, title, description);

  const footer = document.createElement("footer");
  footer.className = "article-card__footer";
  const author = document.createElement("span");
  author.textContent = article.author;
  const statRow = document.createElement("span");
  statRow.className = "article-card__stats";
  statRow.textContent = `${stats.likes || 0} likes · ${stats.comments || 0} comments`;
  footer.append(author, statRow);

  card.append(thumb, body, footer);
  return card;
}

async function loadStats(articles) {
  if (!window.ArticlesApi?.hasApi() || !articles.length) {
    return {};
  }
  try {
    const slugs = articles.map((article) => article.slug).join(",");
    const response = await window.ArticlesApi.request(`/stats?slugs=${encodeURIComponent(slugs)}`);
    return response.items || {};
  } catch {
    return {};
  }
}

async function init() {
  const response = await fetch("./articles.json", { cache: "no-store" });
  const data = await response.json();
  const articles = data.articles || [];

  if (!articles.length) {
    empty.hidden = false;
    return;
  }

  const stats = await loadStats(articles);
  grid.replaceChildren(...articles.map((article) => makeCard(article, stats[article.slug])));
}

init().catch(() => {
  empty.hidden = false;
  empty.textContent = "Articles could not be loaded.";
});
