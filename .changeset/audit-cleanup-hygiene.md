---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`scai audit` + `scai cleanup` — content hygiene shipped.** XM-Cloud-shaped
replacement for the content-shaped subset of dotnet's `sitecore dbcleanup`.
Built on the Authoring GraphQL API; SQL-only operations (`clean-blobs`,
`clean-fields`, `rebuild-descendants`) remain out of scope.

**Read-only diagnostics — `scai audit <verb> list`:**

- `scai audit broken-links list` — finds content with internal links
  (RichText `<link>` tags, bare GUIDs, Multilist pipe-delimited refs)
  that point to items the tenant doesn't have. Tree-crawl-and-scan
  approach; bounded by `--limit` (default 5000) and `--root` (default
  `/sitecore/content`).
- `scai audit unused-media list` — two-pass diff between media items
  under `/sitecore/media library` and refs collected from content
  items (RichText `<link linktype="media">`, `<image mediaid="...">`
  XML, Multilist GUIDs). Bounded by `--media-limit` and
  `--reference-limit`.
- `scai audit orphans list` — items in the XM Cloud archive (recycle
  bin). True SQL-orphans don't exist on XM Cloud (schema enforces
  parent integrity); the archive is the closest analogue and is what
  the dotnet `clean-orphan-items` cleaned in practice.
- `scai audit stale-workflow list` — items in a non-final workflow
  state with no updates in `--days N` (default 30).
- `scai audit language-data list` — items with empty per-language
  entries (no versions). **Read-only by design**: the XM Cloud
  Authoring API has no per-item language-entry removal mutation. The
  dotnet `clean-invalid-language-data` shape isn't portable.

**Mutating cleanup — `scai cleanup versions prune`:**

- `scai cleanup versions prune --root <path> --keep N` — trims
  per-(item, language) version history down to N most recent versions.
- Safety rails: `--root` is required (no tenant-wide form), `--keep`
  must be ≥ 1, `/sitecore/system` and `/sitecore/templates/System`
  refuse without `--force`, honors `--allow-write` / `--what-if`.

**Output:** all verbs honor `--json` for piping into `scai ser pull` /
`scai ser push`.

**XM Cloud quirk fixed.** The Authoring GraphQL endpoint's
`SearchCriteriaType` enum can't be passed via JSON variables — the
resolver returns `EXEC_INVALID_TYPE` even for spec-conformant
bindings. The hygiene client inlines search documents as literal
GraphQL with bare enum tokens (`criteriaType: CONTAINS`); user-input
strings are JSON-escaped to prevent injection. See
[src/hygiene/api/client.ts:74-128](src/hygiene/api/client.ts#L74-L128).
