---
"@sitecoreai-labs/sitecoreai-cli": patch
---

0.2.1 — cleanup release: verb normalization, envelope adoption, content mutations, `scai doctor`

A consolidated batch of structural cleanups, surface normalizations,
and new content-tree primitives. **Breaking CLI / MCP / SDK surfaces
under 0.x** — see migration notes at the bottom.

**New: `scai doctor`** — local config + credentials diagnostic. Walks
`sitecoreai.cli.json`, the OS keychain, and the Node runtime;
surfaces what needs fixing before remote calls work. `--json` for
machine output, `--strict` for CI gating. Closes the 0.1.0
publish-gate item.

**New: content-tree mutations**

- `scai content move` — relocates a Sitecore item to a new parent via
  the Authoring `moveItem` GraphQL mutation. Preserves itemId, name,
  and every inbound reference (delete + recreate was the only path
  before). New SDK `AuthoringApiClient.moveItem`, new CLI command,
  new MCP `cleanup_execute verb='move-item'`.
- `scai hygiene cleanup multilist remove-ref` — removes one GUID from
  a multilist / treelist / droplink-list field on a single item.
  Promoted from the `scai/scripting/helpers/multilist.ts` `removeRef`
  helper. Case-insensitive, brace-tolerant.
- MCP `cleanup_execute verb='delete-item'` — single-item delete with
  the same inbound-ref safety model as `subtree`, narrower contract.

**Verb normalization (BREAKING — CLI + MCP)** — three different
verbs collapsed to one each:

- Read-one is `get`. `show` and `inspect` dropped.
- Property setters go through `update`. `set-X` dropped.
- Noun-as-verb collapses to a single noun. No more `list-` prefix.

CLI renames:

- `brief show <id>` → `brief get <id>`
- `brief set-status <id> <s>` → `brief update <id> --status <s>`
- `campaign show <id>` → `campaign get <id>` (and `task show` → `task get`)
- `webhook inspect <ref>` → `webhook get <ref>`
- `webhook event-types` → `webhook events`
- `workflow inspect <ref>` → `workflow get <ref>`
- `workflow list-commands <ref>` → `workflow commands <ref>`
- `workflow list-defs` → `workflow definitions`
- `content version inspect ...` → `content version get ...`

MCP renames:

- `brief_inspect` verb `show` → `get`
- `brief_manage` verb `set-status` removed — pass `status` on `update`
  (`{ resource: 'brief', verb: 'update', briefId, status }`)
- `campaign_inspect` verb `show` → `get`
- `webhook_inspect` verb `event-types` → `events`
- `workflow_inspect` verb `inspect` → `get`, `list-commands` →
  `commands`, `list-defs` → `definitions`

SDK removals: `runBriefSetStatus`, `setBriefStatus` (use
`runBriefUpdate` / `updateBrief` with `{ status }`).

**ScaiEnvelope adoption (BREAKING — `--json` consumers)** — every
CLI task that emits JSON under `--json` now wraps its output in the
canonical envelope shape (`{ command, environment, data, count?,
whatIf?, totalCount?, summary?, meta? }`). Previously seven task
families (`agents.*`, `brief.*`, `campaigns.*`, `workflow.*`,
`serialization.push`, `brand review --format json`, `recipe push`)
emitted raw JSON; consumers had to branch on shape per-command.
SARIF stays unwrapped (OASIS schema, downstream tooling parses
verbatim).

**Brief CRUD + recipe sync (unstable)** — brief instances (not
just brief types) now support `create`, `update`, and recipe sync.
`scai ops brief create -f <file>`, `update <id> --status <s>`, and
`sync {pull,diff,push} --kind brief|brief-type` (default
`brief-type` for back-compat). New SDK `assertCreateBriefInput`,
`briefInstanceKind`, `BriefInstanceRecipeSchema`. MCP
`brief_manage` accepts `resource: 'brief'` with `create` and
`update` verbs.

**Internal cleanups (no consumer impact)**

- New `@/auth` + `@/authoring` cross-domain barrels. The OAuth
  client-credentials helpers + Sitecore Authoring GraphQL transport
  that lived in `serialization/api` and `recipe/api` were de facto
  shared modules; cross-area callers now import via the new seams.
- Shared `decodeJwtPayload` / `extractScopes` in `@/shared/jwt` —
  the per-domain auth modules previously each shipped their own copy.
- Unified `ensureAllowWrite` naming across hygiene cleanup runners
  (alias `ensureAllowWriteForCleanup` dropped).
- Fire-and-forget history + telemetry write failures now log to
  stderr (`[scai:history]` / `[scai:telemetry]`) instead of silent
  swallow. Suppressible via `SITECOREAI_OBSERVABILITY_SILENT=1`.
- `isItemNotFoundError` (recipe prune-defaults) now matches against
  preserved GraphQL `extensions` payloads as well as the prose
  patterns — Sitecore phrasing changes are less likely to break it.
- `RecipeKind<T>` → `RecipeKind<unknown>` erasure casts collapsed to
  a single `eraseKind` helper exported from `@/sync`.
- `FieldFilter` (serialization module config) now declares its
  legacy PascalCase `FieldId` alias on the type itself instead of
  being read through an `as unknown as` cast at the loader boundary.

**Migration**

CLI scripts and agent prompts referencing the old verb names
(`show`, `inspect`, `set-status`, `event-types`, `list-commands`,
`list-defs`) will fail. Update to the new names; underlying API and
library behaviour is unchanged.

Scripts that read raw JSON output from `agents.*`, `brief.*`,
`campaigns.*`, `workflow.*`, `serialization.push`,
`brand review --format json`, or `recipe push` need to unwrap the
envelope:

```diff
-const result = JSON.parse(stdout);
-console.log(result.id);
+const envelope = JSON.parse(stdout);
+console.log(envelope.data.id);
```

The `command` field on the envelope identifies the source so a
single parser can dispatch by it.
