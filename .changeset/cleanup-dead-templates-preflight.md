---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`cleanup dead-templates` now runs an `audit template-dependencies` pre-flight per candidate.**

`audit dead-templates` only checks primary-template count — items whose
`_template` points at the candidate. It misses the four other reference
shapes that block a template delete: **base-template inheritance**,
**`__masters` insert-options**, **`__source` branch sources**, and the
**`datasource template`** field on Rendering items. Before this change
the cleanup attempted the delete anyway and surfaced whatever the
Authoring API returned — typically a terse "still used by other items"
that didn't tell the operator which item or which reference kind.

The cleanup now invokes `audit template-dependencies` (silent mode) per
candidate before attempting the delete. If any inbound refs are found
the action returns `status: "blocked"` with a structured `blockers:
TemplateDependencyReport[]` list grouped by reference kind and
sorted by path. The operator (or agent) gets an actionable list:
"`/sitecore/templates/Project/Inheritor` blocks via base-template",
not a generic API error.

- `--force` skips the pre-flight (preserves the existing escape hatch
  for cases where the Authoring API would accept the delete despite
  stale index entries — for example mid-rebuild).
- `--what-if` reports the plan inclusive of blocked candidates so the
  operator sees what would and wouldn't proceed.
- Empty-folder cleanup runs against the residual tree; blocked
  templates aren't deleted, so their folders aren't candidates for
  removal — matches existing semantics.

A new `silent: boolean` option on `runAuditTemplateDependencies` lets
callers (cleanup tasks here, future MCP `cleanup_preview` workflows)
suppress the audit's own printed report and surface findings in their
own combined output instead. Direct CLI / MCP callers see the report
as before.

Follow-up: extend the same pattern to `cleanup-duplicates` (no
pre-flight today), `cleanup-subtree` and `cleanup-site-residue` (own
field-value scan; add structural-ref coverage via the same audit).
