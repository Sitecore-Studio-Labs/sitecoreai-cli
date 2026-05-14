---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`deploy environments list` now walks every page by default.**

The Deploy API caps single-page responses at 10 items by default, so
`scai deploy environments list` (and `... --project X`) returned only
the first page unless the operator remembered `--all`. That made
"couldn't find" errors common the moment a project grew past ten
environments — the resolver paths were fixed earlier; the `list`
command was the remaining hole.

- Default is now the walker (`fetchAllEnvironments` / `fetchAllProjectEnvironments`).
- `--no-all` or `--page <n>` opts out and fetches a single page.
- The `--project X` branch now honors `--all` / `--no-all` / `--page` —
  previously it always returned a single page and silently ignored the
  page-control flags.
- Both branches now return the same `{ totalCount, pageSize, data }`
  envelope so downstream consumers don't have to branch on shape.
- The type-filter fallback (re-fetch without server-side `Types` when
  the filtered response is empty) is mirrored into the walker path.

`--page` and `--page-size` semantics are unchanged for callers who use
them explicitly. Help text updated to reflect the new default.
