---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`ops brief list` and `ops campaign list`: add `--lean` flag.

Under `--lean` (JSON mode only) the list verbs emit a compact, projected envelope carrying only the identity + linkage fields a tenant scan or delete cascade needs:

- brief → `{ id, name, status, locale, references }`
- campaign → `{ id, name, labels, brandkit_id, status }`

The heavy bodies that dominate a full record — the brief's `fields` (RichText ProseMirror docs), `tasks`, and `comments`; the project's `deliverables`, `members`, `attachments`, and `context` — are dropped, and the JSON is emitted without two-space pretty-printing. This keeps a `--limit 1000` page small enough that downstream consumers capturing the output to a bounded buffer don't truncate the envelope mid-stream (which surfaced as the orchestrator's "scai ops brief list returned unparseable --json output" strays-scan failure on content-rich tenants).
