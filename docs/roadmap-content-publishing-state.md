# Roadmap: content publishing state (`scai content` + `scai publish unpublish`)

Companion roadmap to `docs/parity-with-devex.md`'s Publishing section.
PR 2b shipped the Publishing API surface (`scai publish item / all /
status / cancel`). This doc scopes the **content-state controls** that
affect what gets published — fields scai doesn't surface today.

The Publishing API has zero unpublish / per-version operations
(verified 2026-05-14 against the OpenAPI YAML). Sitecore's mechanism
for "unpublish" or "publish on a schedule" is to change an item's
publish-state fields via the **Authoring API**, then trigger a regular
publish. scai needs both halves of that.

## Required Authoring API field mutations

All three are version-level (or item-level) field writes via the
Authoring `updateItem` mutation. Field names quoted verbatim from
Sitecore docs:

| Field | Type | Effect |
|---|---|---|
| `__Never publish` | boolean | If true, publishing skips this item/version entirely. Setting true on an already-published item → next publish removes it from Edge. |
| `__Valid from` | datetime | Version's earliest publishable date. Versions before this date aren't selected by the publisher. |
| `__Valid to` | datetime | Version's latest publishable date. After this date the version stops being selected; next publish removes it from Edge. |

These are standard Sitecore fields; scai writes them through the
existing `runAuthoringGraphQL` plumbing (same path the recipe runtime
uses). No new Auth0 grants required — the deploy / CM admin scopes
scai already has cover Authoring writes.

## Verb design

### 1. `scai publish unpublish`

Composite operation: clear the publish state, then submit a publish.

**Surface:**
```
scai publish unpublish [-n <env>]
  --items <guid>                # repeatable / comma-separated
  --paths <path>                # repeatable / comma-separated (path→id via resolver)
  --languages <list>            # optional; default = tenant publish languages
  --include-subitems            # also unpublish descendants (xmc.items.publishChildren)
  --include-related             # also unpublish related items
  --strategy <mode>             # default `never-publish`; alternatives `expire-now`, `delete`
  --what-if                     # default
  --allow-write
  --confirm-token <token>       # production-tier
  --yes
```

**Strategies:**
- `never-publish` *(default, reversible)* — sets `__Never publish: true`
  on the latest version per language. To re-publish, operator clears
  the field and re-publishes. Audit-log records the previous value
  so it can be restored.
- `expire-now` *(reversible)* — sets `__Valid to: <now>` on each
  targeted version. Equivalent to expiring a version. Restoring
  requires writing `__Valid to: <future date>` back.
- `delete` *(destructive)* — calls Authoring `deleteItem` (or
  `archiveItem` if scoped to recycle bin). Not reversible at the
  scai layer. Production-tier prompts must explicitly name "delete"
  and require typed item path confirmation, not just a scope token.

**Flow:**
1. Resolve items (`--items` + `--paths` resolution via existing
   `resolveItemPathsToIds`).
2. Build scope (`PublishAuditScope { kind: "unpublish", strategy, … }`).
3. Tier check + scope token / interactive prompt (reuse PR 2b
   `consent.ts` primitives).
4. For each item:
   - Read current field value (audit trail captures original).
   - Write new field value via Authoring `updateItem` (or call
     `deleteItem` for `--strategy delete`).
5. Submit a Publishing API job (reuse `submitPublishJob`) so Edge
   sees the change.
6. Write audit entry per item: original value, new value, job id.

**File layout (matches PR 2b):**
- `src/publishing/tasks/unpublish.ts`
- `src/commands/publish/unpublish.ts`
- Reuse: `consent.ts`, `audit.ts`, `path-resolver.ts`,
  `acquirePublishingToken`, `submitPublishJob`.

### 2. `scai content version` command tree

New command group for version-level state changes. Doesn't fit under
`publish` because these are content mutations, not publish operations
— they just affect what publish picks up.

**Verbs:**
```
scai content version set-validity \
  --item-id <guid> | --path <path> \
  --language <code> \
  [--version <n>]                    # default: latest
  --valid-from <iso8601> | --clear-valid-from
  --valid-to   <iso8601> | --clear-valid-to
  [--what-if] [--allow-write]

scai content version set-never-publish \
  --item-id <guid> | --path <path> \
  --language <code> \
  [--version <n>] \
  --value <true|false> \
  [--what-if] [--allow-write]

scai content version inspect \
  --item-id <guid> | --path <path> \
  --language <code>                  # prints all version-state fields
```

**Flow (set-validity, set-never-publish):**
1. Resolve item (id or path).
2. Read current version's field values for audit.
3. Build scope hash + token (reuse `consent.ts`).
4. Production-tier gate (reuse `isProductionTier`).
5. Write new field value via Authoring `updateItem` mutation with
   `versionedFields: [{ name: "...", value: "..." }]`.
6. Audit entry with before/after values.
7. **Do NOT auto-publish** — operator runs `scai publish item`
   separately when ready. Keeping these as pure CM mutations lets
   operators batch changes before a single publish call.

**File layout:**
- `src/content/tasks/version-validity.ts`
- `src/content/tasks/version-never-publish.ts`
- `src/content/tasks/version-inspect.ts`
- `src/content/sitecore-api/version-fields.ts`  ← Authoring GraphQL helpers
- `src/commands/content/index.ts` (factory)
- `src/commands/content/version/{set-validity,set-never-publish,inspect}.ts`
- New top-level command `scai content` registered in `src/cli.ts`.

### 3. `scai content unpublish` convenience verb

Same as `scai publish unpublish` but lives under `content/` because
operators may not yet think of it as a publishing operation. Alias —
both routes call the same task.

## Authoring GraphQL details

```graphql
# Read current state for an item version
query($itemId: ID!, $language: String!, $version: Int) {
  item(where: { itemId: $itemId }) {
    itemId
    name
    path
    version(language: $language, version: $version) {
      version
      language { name }
      fields(ownFields: false) {
        nodes {
          name
          value
          versioned
        }
      }
    }
  }
}

# Write version-level fields
mutation($itemId: ID!, $language: String!, $version: Int!, $fields: [FieldValueInput!]!) {
  updateItem(input: {
    itemId: $itemId
    language: $language
    version: $version
    fields: $fields
  }) {
    item { itemId }
  }
}
```

The actual mutation shape varies slightly across XM Cloud versions —
the agent should verify against the OpenAPI surface in
`src/sites/api/schema.d.ts` and the existing recipe runtime's
`updateItem` calls (`src/recipe/api/authoring-client.ts`) for the
canonical pattern.

## Safety model — reuses PR 2b

All four primitives from PR 2b apply unchanged:

1. **`--what-if` default** — show what would change, no API call.
2. **`PublishAuditScope` + `computeScopeHash` + `mintScopeToken` /
   `verifyScopeToken`** — same TTL, same env-binding. Add new
   `kind` values: `"unpublish"`, `"validity"`, `"never-publish"`.
3. **Production-tier prompts** — reuse `isProductionTier`.
   `--strategy delete` adds typed item-path confirmation (parallel
   to publish-all's typed env-name confirmation).
4. **Audit log** — extend `PublishAuditEntry.command` with
   `"content version set-validity"`, etc. Reuse
   `recordPublishAudit`. Audit entries capture before/after state
   so the operator can later restore.

## Tests

Unit tests for each task (mock `runAuthoringGraphQL`); reuse the
patterns from `tests/unit/publishing/`. Real-tenant smoke scripts go
under `scripts/_smoke-content-*.ts` mirroring the publishing smokes.

## Out of scope for this work

- **Bulk validity scheduling** (e.g. "expire all items under
  /sitecore/content/Campaign on 2026-12-31") — useful but a different
  shape; defer until at least one operator asks for it.
- **Per-language batch operations** — single-language at a time is
  fine for the first cut.
- **MCP wiring** — the MCP surface adds these as workflow-shaped
  tools (per `scai-mcp-tool-shape` memory) after the CLI lands and
  the consent model is field-tested.

## Brief for the implementing agent

- Branch from current `dev` (or whatever the active branch is) in a
  worktree.
- Read `docs/parity-with-devex.md` § Publishing for the safety model
  + the PR 2b file layout — mirror it.
- Existing primitives to reuse, NOT reimplement:
  - `src/publishing/audit.ts` (`recordPublishAudit`,
    `PublishAuditEntry`, `PublishAuditScope`)
  - `src/publishing/consent.ts` (`computeScopeHash`,
    `mintScopeToken`, `verifyScopeToken`, `SCOPE_TOKEN_TTL_MS`)
  - `src/publishing/env-tier.ts` (`isProductionTier`)
  - `src/publishing/sitecore-api/path-resolver.ts`
    (`resolveItemPathsToIds`)
  - `src/recipe/api/graphql.ts` (`runAuthoringGraphQL`) for all
    Authoring mutations
  - `src/recipe/api/authoring-client.ts` for the `updateItem`
    canonical pattern
- Tests: vitest, mock `runAuthoringGraphQL` and assert request shape +
  audit-log writes. Match the style in
  `tests/unit/publishing/consent.test.ts` and `audit.test.ts`.
- No MCP tool wiring in this pass — leave for a follow-up.
- When done, full lint + typecheck + tests must pass. Don't merge
  into the parent branch; surface the worktree path so it can be
  reviewed separately.
