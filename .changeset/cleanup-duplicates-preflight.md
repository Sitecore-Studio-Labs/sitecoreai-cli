---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**`cleanup duplicates` now runs an `audit references` pre-flight per deletion candidate.**

Previously the cleanup picked one survivor per group and deleted the
rest with no inbound-reference check; the docstring acknowledged
"refs to deleted dupes become broken — run `audit broken-links` after."
That post-cleanup mitigation was easy for a human to forget and
impossible for an agent to figure out unaided.

The cleanup now invokes `audit references` (silent mode) for each
dupe in the deletion set before calling `deleteItem`. Items with
inbound refs return `status: "blocked"` with a structured
`blockers: ReferenceReport[]` list, identical to the pattern
`cleanup-dead-templates` uses for `audit template-dependencies`.
`audit references` is invoked with `cache: true` so back-to-back
checks against the same `--root` share a warm field cache; first dupe
pays the O(items × fields) scan, subsequent ones land in ms.

- New `--skip-ref-check` flag (CLI) / `skipRefCheck: boolean` (library)
  opts out for migrations that will rebuild refs separately.
- `--force` (already part of the cleanup base options) also bypasses.
- `--what-if` skips the pre-flight by design — plan-only output doesn't
  call deletion or scanning.
- A new `silent: boolean` on `runAuditReferences` mirrors the flag now
  on `runAuditTemplateDependencies`; suppresses the audit's own report
  for cleanup callers that surface findings in their own combined output.
