---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`brand seed` can now seed a kit from a JSON/YAML file, not just a PDF.**

`scai brand seed` is the single "create a brand kit" entry point, and
it now takes two sources:

- `--url <pdf>` — the full pipeline (create → upload → publish →
  ingest → enrich → poll). Unchanged. `--name` required here.
- `--file <kit.yaml|json>` — **new** — a kit-shaped recipe applied
  directly via the converge engine: no PDF, no paid AI pipeline. It is
  the same `BrandKitRecipe` shape `brand sync pull` emits, so
  `seed --file` and `sync pull` round-trip.

The previously-unsupported `[file]` positional argument is gone —
`--file` replaces it. `--name` is no longer a hard `requiredOption`
(the recipe carries the kit name on the `--file` path); it is validated
per source instead.
