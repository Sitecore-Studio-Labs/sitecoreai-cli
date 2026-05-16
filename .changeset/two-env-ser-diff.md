---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Two-environment `scai serialization diff` — shipped.** Closes parity
with dotnet `sitecore ser diff --source A --destination B [--push]`.

- New flag aliases: `--source-env` / `--target-env` (alias to existing
  `--source` / `--destination`) to match the dotnet naming.
- New diff flags: `--what-if` (build the push plan, don't write),
  `--allow-write` (per-invocation override of the env's `allowWrite`),
  `--force` (skip the empty-source confirmation guard).
- Empty-source push guard: when `--push` would recycle every item in
  the destination because the source has zero items, the diff prompts
  for confirmation (or refuses, in non-TTY mode, without `--force`).
- Augmented `--json` output: includes `mode`
  (`local-vs-instance` | `instance-vs-instance`), a top-level `whatIf`
  flag, and per-database `whatIf` flag. With `--verbose`, each database
  carries a `changes` block listing the create / update / recycle /
  move / rename entries.

**Performance refactor (also benefits `ser pull`, `ser push`, `ser package`):**

- Source and destination metadata fetches now run in parallel.
- Per-subtree metadata fetches within an environment now run with
  bounded concurrency.
- On `--push`, source and destination item-body collection
  (`collectItemData`) runs in parallel.
- The per-item `fetchItemData` fanout inside `collectItemData` is now
  bounded-concurrent — the largest wall-clock improvement for trees
  with many items. For 1000 items at ~100 ms/round-trip, the
  sequential path was ~100 s; with the default concurrency of 8 it's
  ~12.5 s. Same speedup applies to every consumer of `collectItemData`
  (`ser pull`, `ser push`, `ser package`, and the existing
  local-vs-remote diff path).
- Concurrency is bounded by `SITECOREAI_HTTP_CONCURRENCY` (default 8)
  to avoid hitting tenant rate limits or exhausting sockets.
