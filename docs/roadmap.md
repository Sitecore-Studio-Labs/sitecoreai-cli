# Roadmap

Near-term improvements. Larger architectural shifts live in GitHub
issues/milestones, not here — this file is a quick-glance "what's in
flight" for new contributors.

## Near-term

- Config/schema enforcement for module configs loaded from packages.
- A `doctor` command to validate env/auth/config and surface actionable
  fixes.
- Configuration options for `sitecoreai.cli.json` storage location
  (currently fixed at the project root with `--config` as the override).
- ~~Two-environment `ser diff`~~ — **shipped 2026-05-14.** The
  `scai serialization diff` engine already operated instance-to-instance
  in memory; the work landed as flag aliasing (`--source-env` /
  `--target-env`), `--what-if` + `--allow-write` + `--force` wiring,
  empty-source push guard, augmented JSON output (`mode` + optional
  `changes` block under `--verbose`), and a concurrency refactor that
  parallelizes source/destination fetches and bounds per-item fetch
  fanout via `SITECOREAI_HTTP_CONCURRENCY`. See
  [docs/serialization.md](./serialization.md#diff-modes).

## Feature areas

These are larger pieces of work scoped during the parity audit
(see [parity-with-devex.md](./parity-with-devex.md)). Each one is
sized for its own branch/PR.

### ✅ `scai audit` + `scai cleanup` — shipped 2026-05-13, expanded 2026-05-14

Replaces the XM-Cloud-shaped subset of dotnet `sitecore dbcleanup` with
operations expressible through the Authoring GraphQL API. SQL-level
operations (`clean-blobs`, `clean-fields`, `rebuild-descendants`) remain
out of scope — they aren't possible without direct DB access.

The group was renamed from the originally-planned `scai content` to
two command groups by intent: read-only diagnostics under `scai audit`,
mutating cleanup under `scai cleanup`. "Content" was too broad — every
verb in the set is hygiene/diagnostic, not "content" in general.

Shipped:

- `scai audit broken-links list` — internal links pointing to deleted
  items (search-index crawl + ref-resolution batch).
- `scai audit unused-media list` — media items with zero references.
- `scai audit orphans list` — items in the Sitecore archive (recycle
  bin). XM Cloud doesn't produce true SQL-orphans because the schema
  enforces parent integrity; the archive is the closest analogue.
- `scai audit stale-workflow list` — items stuck in a non-final
  workflow state past a `--days N` threshold.
- `scai audit language-data list` — items with empty per-language
  entries. **Read-only by design**: the XM Cloud Authoring API
  exposes only `deleteLanguage` (tenant-wide, destructive) and
  `deleteItemVersion` (single version) — no per-item, per-language
  removal mutation. The on-prem `clean-invalid-language-data` shape
  isn't portable; this command surfaces the data, operator cleans up
  manually.
- `scai audit dead-templates list` — templates with zero items
  derived from them (search-indexed `_template` lookup).
- `scai audit datasource-missing list` — pages whose rendering
  XML references datasources (path or itemId) that don't resolve.
- `scai audit duplicates list` — items with byte-identical
  authored content (SHA-256 hash; system fields excluded).
- `scai audit empty-items list` — items with no author-facing
  field values.
- `scai audit page-design-orphans list` — XM Cloud SXA pages
  referencing missing page designs.
- `scai audit personalization-broken list` — pages with
  personalization rules pointing to missing variants/rule sets.
- `scai cleanup archive purge --older-than-days N` — purge old
  records from the Sitecore archive.
- `scai cleanup dead-templates purge --root <path>` — delete
  templates with zero items, then recursively clean up empty
  template folders.
- `scai cleanup duplicates purge --keep-rule <…>` — delete
  duplicate items, keeping one per group via oldest / newest /
  shortest-path / interactive rule.
- `scai cleanup versions archive --keep N --root <path>` — soft
  alternative to versions prune; moves older versions to the
  Sitecore archive (reversible via `restoreArchivedVersion`).
- `scai cleanup versions prune --keep N --root <path>` — trim
  per-(item, language) version history down to N most recent. Requires
  `--root` (no tenant-wide form), refuses `/sitecore/system` and
  `/sitecore/templates/System` without `--force`, honors
  `--allow-write` / `--what-if`.

All `list` verbs honor `--json` for piping into `ser pull` / `ser push`.

### `scai publish item` — Edge publish trigger

Thin wrapper over the Authoring GraphQL publish mutation. Shape:

```sh
scai publish item --path <item-path> [--languages <l1,l2>] [--sub-items]
```

Replaces the XM-Cloud-relevant slice of dotnet `sitecore publish item`.
The rest of the dotnet Publishing plugin (`list-targets`, multi-target,
republish-all) is on-prem-only and stays out of scope.

### Resource package (`.dat`) builder — planned, unscoped

The dotnet `sitecore itemres` plugin builds protobuf-encoded `.dat`
files for on-prem Sitecore's resource-item loader. Real demand exists
from teams shipping content to on-prem installs. Implementation
requires protobuf-net schema work that isn't trivially available in
the JS ecosystem.

No design has been committed. The most likely shapes are (a) reuse
the dotnet protobuf-net schema via a JS protobuf library if the schema
can be reconstructed, or (b) shell out to a small dotnet helper. Both
have material trade-offs (schema fidelity vs. install footprint). To
be scoped when there's concrete user demand.

## CI and release

- CI preflight checks for publish credentials, org access, and release
  gating.
- Re-enable npm provenance when the repo goes public (see
  [`release.md`](./release.md)).

## Telemetry UX

- Persisted defaults and clearer status output for telemetry opt-in/out.
