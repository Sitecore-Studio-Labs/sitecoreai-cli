---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Four new `scai audit` verbs — content quality round 2.** Built on
the Phase A substrate; all four honor `--baseline`, `--output`,
`--exclude`, `--since`, and the perf knobs.

- `audit broken-images list` — `<img src="...">` URLs in RichText
  fields that return non-2xx / timeout / network error. HEAD-probes
  with a `--request-timeout-ms` budget; falls back to range-limited
  GET for CDNs that reject HEAD. `--exclude-domains` skips hosts
  you can't reach. **Off by default in `audit all`** because it
  makes external HTTP requests.
- `audit slug-conflicts list` — sibling items sharing the same name
  (case-insensitive by default). Catches URL ambiguity that
  routers resolve unpredictably.
- `audit translation-coverage list --target-languages fr,de,es` —
  measures translation completeness between a reference and target
  language(s). Reports per-target `coveragePercent` + samples of
  missing items. **Required `--target-languages`**, so off by
  default in `audit all`.
- `audit fallback-drift list --target-languages fr,de --drift-days N` —
  items where the target-language version's `updatedDate` lags
  the reference language by more than N days. Catches "English was
  edited but French wasn't refreshed." **Required
  `--target-languages`**, so off by default in `audit all`.

7 new unit tests (178 total in hygiene module). Live-validated all
four against the sandbox tenant.
