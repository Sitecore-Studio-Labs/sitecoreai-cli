---
"@sitecoreai-labs/sitecoreai-cli": patch
---

feat(brief): read briefs by UUID on pull (`ops brief sync pull --sitecore-id`)

The Sitecore Brief list endpoint (`/api/brief/v1/briefs`) caps every page at 20 rows and returns a `next` cursor that does not advance (re-sending it yields the same page; `Limit`, offset/skip/page params, and continuation headers are all ignored). So on a tenant with more than 20 briefs, the name-based `findBriefByName` walk physically cannot see past the first page — a brief that really exists reads as "not found", which the orchestrator surfaces as a false "deleted on Sitecore AI".

`ops brief sync pull` now accepts `--sitecore-id <uuid>`: the brief is read directly by id (`getBrief`) instead of by name, bypassing the broken list entirely. The brief kind's pull-path `readCurrent` prefers `ref.tenantId` (id) over the name walk and falls back to the name walk when no id is supplied. Advertised via the new `brief-pull-sitecore-id` capability token so the orchestrator only forwards the flag to a binary that understands it. Mirrors the existing `campaign-pull-sitecore-id` behaviour.
