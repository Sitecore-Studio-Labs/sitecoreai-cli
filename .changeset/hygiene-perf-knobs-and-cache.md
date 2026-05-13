---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai audit` performance — tunable concurrency, parallel pagination,
and an opt-in field cache.** Cuts repeated-run audit time ~2.4× on
warm cache and lets operators dial throughput up or down per tenant.

**New flags on every `scai audit *` command:**

- `--concurrency <N>` (default 8, env `SITECOREAI_HYGIENE_CONCURRENCY`) —
  parallel batch fan-out for field reads and ref resolution.
- `--batch-size <N>` (default 50, env `SITECOREAI_HYGIENE_BATCH_SIZE`) —
  aliased GraphQL batch size per field-read query.
- `--page-parallelism <N>` (default 4, env
  `SITECOREAI_HYGIENE_PAGE_PARALLELISM`) — parallel page-windows during
  search enumeration. The first page is always sequential (we need its
  `totalCount`); subsequent pages are fetched in concurrent windows.
- `--cache` (env `SITECOREAI_AUDIT_CACHE=true`) — opt-in on-disk
  field cache at `~/.sitecoreai/audit-cache/<envName>.json`, keyed by
  `(itemId, updatedDate)`. LRU-capped at 50k entries. Best for running
  multiple audits back-to-back (e.g. `broken-links` then `unused-media`
  then `duplicates` in one CI pass): the second and third audits skip
  field re-fetches for unchanged items.

**Behind the scenes:**

- `HygieneApiClient.searchAll(query, perPage, parallel)` — new
  `parallel` parameter. Set to 1 (default for legacy callers) preserves
  the original sequential-page ordering. Higher values fetch
  page-windows concurrently after the first page reveals totalCount;
  cross-window order is still page-index order, but within-window
  ordering is non-deterministic so callers that need stable output
  should sort the final accumulated set.
- `scanItemsAndFields` helper in `src/hygiene/tasks/shared.ts` —
  bundles the enumeration → field-fetch pipeline used by every
  field-reading audit. Centralizes the perf knobs + cache wiring so
  individual audits don't repeat the boilerplate.
- New module `src/hygiene/cache.ts` — `createFieldCache`,
  `wrapFieldsBatchWithCache`, `isAuditCacheEnabled`. Per-env JSON
  files; corrupt-file recovery; LRU eviction.

**Benchmark (sandbox tenant, 500 items, `audit broken-links list`):**

- Cold cache: 2.9s
- Warm cache (second run): 1.2s (~2.4× speedup)

Parallelism wins are workload-dependent. Small tenants and
restricted-throughput environments may prefer lower values (e.g.
`--concurrency 4 --page-parallelism 1`). The defaults are tuned for
typical XM Cloud tenants but every knob is overridable per-run.

23 new unit tests (134 total in hygiene module).
