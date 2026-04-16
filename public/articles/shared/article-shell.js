window.ARTICLES_API_BASE_URL = window.ARTICLES_API_BASE_URL || "https://gqem7lmu6mao6u3gl36orlhr2u0xwnxs.lambda-url.eu-west-2.on.aws";

window.ArticlesApi = (() => {
  const API_BASE = window.ARTICLES_API_BASE_URL.replace(/\/$/, "");
  const CLIENT_ID_KEY = "drbom_articles_client_id";

  function hasApi() {
    return Boolean(API_BASE);
  }

  function getClientId() {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  async function request(path, options = {}) {
    if (!API_BASE) {
      throw new Error("Articles API URL is not configured.");
    }
    const response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error || `Request failed with ${response.status}`);
    }
    return body;
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function renderComment(comment) {
    const item = document.createElement("article");
    item.className = "comment";

    const header = document.createElement("div");
    header.className = "comment__header";

    const name = document.createElement("strong");
    name.textContent = comment.name;

    const time = document.createElement("time");
    time.dateTime = comment.createdAt;
    time.textContent = new Date(comment.createdAt).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short"
    });

    const body = document.createElement("p");
    body.textContent = comment.body;

    header.append(name, time);
    item.append(header, body);
    return item;
  }

  async function hydrateArticle(slug) {
    const likeButton = byId("article-like-button");
    const likeCount = byId("article-like-count");
    const commentCount = byId("article-comment-count");
    const commentsList = byId("article-comments-list");
    const commentsForm = byId("article-comment-form");
    const commentsStatus = byId("article-comments-status");

    if (!hasApi()) {
      if (commentsStatus) {
        commentsStatus.textContent = "Comments are temporarily unavailable.";
      }
      return;
    }

    try {
      const stats = await request(`/stats?slugs=${encodeURIComponent(slug)}`);
      const current = stats.items?.[slug] || { likes: 0, comments: 0 };
      if (likeCount) likeCount.textContent = String(current.likes || 0);
      if (commentCount) commentCount.textContent = String(current.comments || 0);
    } catch {
      if (likeCount) likeCount.textContent = "0";
      if (commentCount) commentCount.textContent = "0";
    }

    if (commentsList) {
      try {
        const response = await request(`/articles/${encodeURIComponent(slug)}/comments?limit=20`);
        commentsList.replaceChildren(...(response.comments || []).map(renderComment));
        if (commentsStatus) {
          commentsStatus.textContent = response.comments?.length ? "" : "No comments yet.";
        }
      } catch (error) {
        if (commentsStatus) {
          commentsStatus.dataset.tone = "error";
          commentsStatus.textContent = error.message;
        }
      }
    }

    if (likeButton) {
      likeButton.addEventListener("click", async () => {
        likeButton.disabled = true;
        try {
          const response = await request(`/articles/${encodeURIComponent(slug)}/likes`, {
            method: "POST",
            body: JSON.stringify({ clientId: getClientId() })
          });
          if (likeCount) likeCount.textContent = String(response.likes || 0);
        } catch (error) {
          likeButton.title = error.message;
        } finally {
          likeButton.disabled = false;
        }
      });
    }

    if (commentsForm && commentsList) {
      commentsForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const data = new FormData(commentsForm);
        const payload = {
          name: String(data.get("name") || ""),
          body: String(data.get("body") || ""),
          website: String(data.get("website") || "")
        };
        const submit = commentsForm.querySelector("button[type='submit']");
        if (submit) submit.disabled = true;
        if (commentsStatus) {
          commentsStatus.dataset.tone = "";
          commentsStatus.textContent = "Posting...";
        }
        try {
          const response = await request(`/articles/${encodeURIComponent(slug)}/comments`, {
            method: "POST",
            body: JSON.stringify(payload)
          });
          if (response.comment) {
            commentsList.prepend(renderComment(response.comment));
          }
          if (commentCount) {
            commentCount.textContent = String(Number(commentCount.textContent || "0") + (response.comment ? 1 : 0));
          }
          commentsForm.reset();
          if (commentsStatus) commentsStatus.textContent = "";
        } catch (error) {
          if (commentsStatus) {
            commentsStatus.dataset.tone = "error";
            commentsStatus.textContent = error.message;
          }
        } finally {
          if (submit) submit.disabled = false;
        }
      });
    }
  }

  return {
    hasApi,
    request,
    hydrateArticle
  };
})();
