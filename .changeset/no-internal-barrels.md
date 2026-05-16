---
"@sitecoreai-labs/sitecoreai-cli": minor
---

**Internal aggregator barrels removed.**

Every `index.ts` (and sibling `.ts` pass-through file) that existed
solely to re-export from neighboring files has been deleted from the
source tree. Production code now imports directly from the file that
owns the symbol.

Deleted internal aggregators:

- `src/index.ts` (the SDK root namespace barrel)
- `src/config/index.ts`
- `src/deploy/api/common/index.ts` + `src/deploy/api/common.ts`
- `src/deploy/tasks/index.ts` + `src/deploy/tasks.ts`
- `src/hygiene/tasks/index.ts` + `src/hygiene/tasks.ts`
- `src/publishing/tasks/index.ts`
- `src/recipe/tasks/index.ts`
- `src/serialization/filesystem-store/index.ts` + `src/serialization/filesystem-store.ts`
- `src/serialization/sitecore-api.ts` (pass-through; the public-entry
  `src/serialization/sitecore-api/index.ts` is retained as SDK contract)
- `src/serialization/tasks/index.ts` + `src/serialization/tasks.ts`
- `src/serialization/tasks/env/index.ts` + `src/serialization/tasks/env.ts`
- `src/serialization/tasks/helpers/index.ts` + `src/serialization/tasks/helpers.ts`
- `src/sites/api/index.ts`
- `src/webhooks/api/index.ts` + `src/webhooks/tasks/index.ts`
- `src/workflow/api/index.ts` + `src/workflow/tasks/index.ts`

What stays:

- The **9 public package entries** that `package.json#exports` points at
  (`recipe`, `deploy`, `serialization`, `brand`, `sites`, `publishing`,
  `hygiene`, `webhooks`, `workflow`) — they're SDK contract files, not
  aggregator-of-convenience.
- The **commander composition files** under `src/commands/**/index.ts`
  — they wire `Command` instances together, not bag-of-re-exports.

Why: barrels cost tooling time (TS parses everything they re-export),
hide which file owns a symbol, and encourage import-everything patterns
inside the codebase. The 9 public entries get to stay because they
define the SDK surface; the rest were convenience-only and gone.

No public API breakage. The public package-entry surface is unchanged:
the 9 subpaths still export the same symbols. Only internal import
paths changed.
