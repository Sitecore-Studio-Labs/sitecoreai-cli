# Implementation notes — content publishing state roadmap

Companion to `docs/roadmap-content-publishing-state.md`. Captures what
the implementation pass actually shipped, what was deferred, and any
spec gaps surfaced along the way.

## What shipped

All four verbs from the roadmap, plus their plumbing. CLI surface:

```
scai publish unpublish     # composite: field write + publish job
scai content version inspect
scai content version set-never-publish
scai content version set-validity
```

New files (mirrors PR 2b layout):

| Layer | File |
|---|---|
| Authoring GraphQL helpers | `src/content/sitecore-api/version-fields.ts` |
| Task — unpublish (composite) | `src/publishing/tasks/unpublish.ts` |
| Task — content version inspect | `src/content/tasks/version-inspect.ts` |
| Task — content version set-never-publish | `src/content/tasks/version-never-publish.ts` |
| Task — content version set-validity | `src/content/tasks/version-validity.ts` |
| Task — shared content scaffolding | `src/content/tasks/shared.ts` |
| Library entry | `src/content/index.ts` |
| CLI — publish unpublish | `src/commands/publish/unpublish.ts` |
| CLI — content (factory) | `src/commands/content/index.ts` |
| CLI — content version (factory) | `src/commands/content/version/index.ts` |
| CLI — content version inspect | `src/commands/content/version/inspect.ts` |
| CLI — content version set-never-publish | `src/commands/content/version/set-never-publish.ts` |
| CLI — content version set-validity | `src/commands/content/version/set-validity.ts` |
| Tests (5 files, 48 tests) | `tests/unit/content/*.test.ts`, `tests/unit/publishing/unpublish.test.ts` |

Extended files (no new modules, just additive changes per the roadmap):

- `src/publishing/audit.ts` — new `PublishAuditScopeKind` union
  (`unpublish` / `validity` / `never-publish`), new
  `PublishAuditFieldChange` interface, new `command` union members,
  and the optional `strategy` + `version` + `fieldChanges` fields on
  the audit entry / scope.
- `src/publishing/consent.ts` — `canonicalScope` now includes
  `strategy` and `version` so scope tokens bind to the exact
  mutation; `ScopeTokenPayload.k` widened to the union.
- `src/publishing/index.ts` — re-exports `runPublishUnpublish`.
- `src/commands/publish/index.ts` — registers `unpublish`.
- `src/cli.ts` — registers `scai content`.
- `package.json` — adds `./content` subpath export.

### Safety model — reused, not reimplemented

Every PR 2b primitive was extended, never copied:

- `--what-if` default + `--allow-write` graduation: same shape as
  `runPublishItem`.
- `computeScopeHash` / `mintScopeToken` / `verifyScopeToken` /
  `SCOPE_TOKEN_TTL_MS`: extended via the broader `kind` union.
  Tokens minted for one verb cannot be replayed against another
  (kind-mismatch) or against scope drift (scope-mismatch).
- `isProductionTier`: drives the typed-token gate identically.
- `recordPublishAudit`: extended via additive fields; every mutation
  records before/after values so an operator can reverse a mistaken
  toggle by reading the log. Reads do NOT write the audit log.

### Quality gates

- `pnpm exec tsc --noEmit` → clean (zero errors outside the agreed
  pre-existing `src/workflow/`, `src/webhooks/` exclusion).
- `pnpm exec eslint <new files>` → clean (zero errors / warnings).
- `pnpm exec vitest run tests/unit/content tests/unit/publishing` →
  99/99 passing (10 test files).
- Per-module coverage on the new code (statements / branches):
  - `version-fields.ts`: 97 / 92
  - `version-inspect.ts`: 100 / 81
  - `version-never-publish.ts`: 96 / 70
  - `version-validity.ts`: 98 / 85
  - `tasks/shared.ts` (content): 93 / 72
  - `tasks/unpublish.ts` (publishing): 86 / 71

The one pre-existing test failure (`tests/unit/lib-surface.test.ts`
brand `AI_SKILLS_REQUIRED_SCOPES`) is **not from this work** — it
fails on a clean `git stash` of these changes. Out of scope here.

## What was stubbed / deferred

### `--strategy delete` on `scai publish unpublish`

Surfaced as an explicit error with a clear hint pointing the operator
at `never-publish` (default, reversible) or `expire-now`
(reversible). The roadmap calls for a typed-item-path confirmation
gate (parallel to publish-all's typed env-name gate) plus a different
Authoring mutation (`deleteItem` / `archiveItem`). That gate is the
real complexity, not the wire call. Deferred to a follow-up so this
pass doesn't half-ship a destructive verb.

### `scai content unpublish` alias

The roadmap's third verb. Same plumbing as
`scai publish unpublish`. Not wired — operators get one canonical
path right now (`scai publish unpublish`), and adding a second name
later is a 5-line factory change.

### MCP tool wiring

Per spec, explicitly out of scope for this pass.

## Open questions / spec gaps

1. **Default write language.** The roadmap says
   `scai publish unpublish --languages` defaults to "tenant publish
   languages" — but the CLI doesn't have access to those at the
   field-write layer (the resolved env config doesn't carry them).
   Implementation falls back to `["en"]` when `--languages` is empty.
   For tenants whose primary language isn't `en` this is
   user-hostile. Two reasonable fixes:
   - Read `system.languages` from the Authoring API before the
     field-write loop and use the active set.
   - Make `--languages` required and remove the fallback.
   Either way, the current default deserves a callout in the help
   text once the right shape is settled. Right now it's documented
   inline in the help string ("field writes default to 'en'").

2. **Authoring `UpdateItemInput` shape on version-scoped writes.**
   The roadmap's GraphQL example shows
   `updateItem(input: { itemId, language, version, fields })`. This
   matches what's in the Authoring schema introspection, BUT scai's
   existing recipe runtime (`src/recipe/api/authoring-client.ts`)
   sends only `{ itemId, fields }` — no version qualifier. Both work
   for different cases (item-level shared fields vs. versioned
   fields). I shipped a dedicated version-scoped helper rather than
   threading version through the recipe client to avoid coupling
   change to a hot path. If a future use case wants version writes
   in recipes (e.g. for `__Never publish` toggles), the helper is
   already there.

3. **`--include-related` semantics on unpublish.** The Publishing API
   honors `publishRelatedItems` on the follow-up job, but the
   field-write loop only touches the directly-targeted items. So
   `scai publish unpublish --include-related` will publish the
   related items WITHOUT clearing their publish state — which means
   they'll be re-emitted, not removed. Probably the right behaviour
   for "I want to unpublish A and republish related B,C", but the
   help text doesn't currently call this out. Worth a clarification
   in the spec doc.

4. **`__Valid from/to` field-name mapping.** Sitecore stores these
   under their display names with spaces (`"__Valid from"`,
   `"__Valid to"`). The Authoring API accepts both display name and
   field GUID on `FieldValueInput.name`. The helper writes by
   display name (matches the existing recipe runtime's convention).
   If a tenant has renamed these fields (unlikely but possible —
   `__Display Name` field is unique here), the write will fail at
   the wire. Smoke-script verification recommended before signing
   off on a real tenant.

## Should update the roadmap doc

- **Strategy enum addition.** The roadmap's "Required Authoring API
  field mutations" table is correct; consider linking it to the
  `UnpublishStrategy` type alias (`src/publishing/audit.ts`) so a
  reader can grep for the canonical name.
- **`scai content unpublish` alias paragraph.** Either implement it
  now or drop the section — it sits between `version` and
  "Authoring GraphQL details" with no actual deliverable.
- **Smoke scripts.** Roadmap mentions `scripts/_smoke-content-*.ts`
  but none were added in this pass (matched the spec's
  prioritization). Add a real-tenant smoke for `unpublish` +
  `set-never-publish` before merging to `dev`.

## Verification

Run from the worktree root:

```bash
pnpm exec tsc --noEmit                                         # clean
pnpm exec eslint src/content src/publishing/tasks/unpublish.ts \
  src/commands/content src/commands/publish/unpublish.ts        # clean
pnpm exec vitest run tests/unit/content tests/unit/publishing   # 99/99
```

End-to-end dry-run (requires a configured env):

```bash
scai content version inspect --path /sitecore/content/Home \
  --language en -n sandbox
scai content version set-never-publish --path /sitecore/content/Home \
  --language en --value true -n sandbox      # prints scope token
scai publish unpublish --items <guid> -n sandbox    # prints scope token
```
