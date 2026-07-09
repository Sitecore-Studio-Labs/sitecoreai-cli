---
"@sitecoreai-labs/sitecoreai-cli": minor
---

Recipe push: two robustness fixes for AI-generated page recipes.

**Graceful degrade for dead external media URLs.** A `MediaUpload` op whose
`external-url` byte sourcing fails (dead link, blocked host, timeout, soft 404) no longer aborts + rolls back the whole recipe: the failure is recorded
on the action (`status: "error"`, visible in `--json`/NDJSON output) and every
referencing `media-xml-ref` field degrades to the legacy hotlink form
(`<image src="…" alt="…" />`). Asset-source (repo-local file) failures keep
failing hard. The push summary surfaces `N media upload(s) failed; affected
image fields fell back to hotlink URLs`, and the `--json` envelope carries a
per-recipe `mediaFallbackCount`. External-URL fetches are also hardened: 15s
timeout, 20 MB size cap, `text/html` rejection, and a private-host
(RFC1918/loopback/link-local) SSRF guard.

**Inline treelist child materialisation.** A scoped datasource field whose
value is an inline ARRAY of child field maps (a card grid's cards, ranking
rows) — previously dropped silently, leaving the parent rendering empty — now
materialises as real child items under the datasource item, conforming to the
treelist field's child template (`sitecore.source.types[0]`), with each child
field (including external-URL images, which ride the same media-ingest path)
written and the parent field set to the children's GUID list. Applies to page
recipes and partial/page-design scoped datasources; nested arrays recurse.
Arrays whose child template can't be resolved keep the legacy drop behaviour.
