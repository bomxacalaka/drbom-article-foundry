# Asset Inbox

Drop user-provided raw assets here before an article is built.

Codex should inspect this folder during article creation, then move or copy selected production assets into:

```text
public/articles/<slug>/assets/
```

Reusable source assets can be moved into `assets/library/`.

Do not treat files in this folder as deployed production assets.
