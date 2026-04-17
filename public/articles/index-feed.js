const list = document.getElementById("article-list");
const empty = document.getElementById("empty-state");

function formatDate(value) {
  const date = new Date(value);
  const now = new Date();
  const diffMs = now - date;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs >= 0 && diffMs < minute) return "now";
  if (diffMs >= 0 && diffMs < hour) return `${Math.floor(diffMs / minute)}m`;
  if (diffMs >= 0 && diffMs < day) return `${Math.floor(diffMs / hour)}h`;
  if (diffMs >= 0 && diffMs < 7 * day) return `${Math.floor(diffMs / day)}d`;

  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric"
  });
}

function makeArticleItem(article) {
  const item = document.createElement("article");
  item.className = "article-item";
  const stats = article.stats || { likes: 0, comments: 0 };

  const href = `./${article.slug}/`;
  const content = document.createElement("div");
  content.className = "article-item__content";

  const date = document.createElement("time");
  date.className = "article-item__date";
  date.dateTime = article.publishedAt;
  date.textContent = formatDate(article.publishedAt);

  const statsRow = document.createElement("div");
  statsRow.className = "article-item__stats";

  const likes = document.createElement("span");
  likes.className = "article-item__metric";
  likes.innerHTML = `${icon("heart")}<span>${stats.likes || 0}</span>`;

  const comments = document.createElement("span");
  comments.className = "article-item__metric";
  comments.innerHTML = `${icon("comment")}<span>${stats.comments || 0}</span>`;

  statsRow.append(likes, comments);

  const title = document.createElement("h2");
  const link = document.createElement("a");
  link.href = href;
  link.textContent = article.title;
  title.append(link);

  const description = document.createElement("p");
  description.textContent = article.description;

  content.append(title, description);
  item.append(content, date, statsRow);
  return item;
}

function icon(name) {
  const icons = {
    heart:
      '<svg class="article-item__icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M20.5 8.7c0 5.2-8.5 10-8.5 10s-8.5-4.8-8.5-10A4.6 4.6 0 0 1 12 6a4.6 4.6 0 0 1 8.5 2.7Z"/></svg>',
    comment:
      '<svg class="article-item__icon" width="15" height="15" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 6.5A3.5 3.5 0 0 1 8.5 3h7A3.5 3.5 0 0 1 19 6.5v4A3.5 3.5 0 0 1 15.5 14H12l-5 4v-4.2a3.5 3.5 0 0 1-2-3.2v-4Z"/></svg>'
  };
  return icons[name];
}

async function loadArticleData(entry) {
  try {
    const data = await fetch(entry.data || `./${entry.slug}/data.json`, { cache: "no-cache" }).then((result) => result.json());
    return data.draft ? null : data;
  } catch {
    return { ...entry, stats: { likes: 0, comments: 0 } };
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

  const hydrated = (await Promise.all(articles.map(loadArticleData))).filter(Boolean);
  list.replaceChildren(...hydrated.map((article) => makeArticleItem(article)));
}

init().catch(() => {
  empty.hidden = false;
  empty.textContent = "Articles could not be loaded.";
});
