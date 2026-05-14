# Parity with `Sitecore.DevEx`

This document maps `scai` to the dotnet `Sitecore.DevEx` CLI and the
`Sitecore.DevEx.Extensibility.XmCloud` plugin, and records what was
deliberately not ported. It's the source of truth for "is feature X in
scope."

scai is positioned **XM Cloud first**. Several `Sitecore.DevEx` plugins
target on-prem Sitecore (direct SQL access, managed Solr/Azure Search,
runtime resource bundles) and don't have a useful shape on XM Cloud.
Those are out of scope by design, not by oversight.

## Covered

| dotnet surface                                                                       | scai equivalent                                               | Notes                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ------ | ------------------------------------------------------------ |
| `sitecore ser pull`                                                                  | `scai ser pull`                                               | Same semantics.                                                                                                                                                                                                         |
| `sitecore ser push`                                                                  | `scai ser push`                                               | Same semantics. The `--publish` chain flag is intentionally not ported — publish is a separate consent-gated verb (see Publishing below); chaining would bypass the safety model.                                       |
| `sitecore ser diff` (local vs remote)                                                | `scai ser diff`                                               | Same semantics for the local-vs-remote case.                                                                                                                                                                            |
| `sitecore ser diff --source A --destination B [--push]`                              | `scai ser diff --source-env A --target-env B [--push]`        | Same semantics. Source/destination metadata fetched in parallel; per-item fetch fanout bounded by `SITECOREAI_HTTP_CONCURRENCY`. Adds `--what-if`, `--allow-write`, `--force` (empty-source guard). Shipped 2026-05-14. |
| `sitecore ser info`, `explain`, `validate`, `watch`                                  | `scai ser info                                                | explain                                                                                                                                                                                                                 | validate                                               | watch` | Same. `--fix` auto-correct on `validate` is not implemented. |
| `sitecore ser package create                                                         | install`                                                      | `scai ser package create                                                                                                                                                                                                | install`                                               | Same.  |
| `sitecore cloud organization {info,health,license}`                                  | `scai deploy org {get,health,license,launch-demo}`            | scai adds `launch-demo`.                                                                                                                                                                                                |
| `sitecore cloud project {create,list,info,update,delete}`                            | `scai deploy proj {…}`                                        | scai adds `limitation`, `validate-name`, `link-repository`, `unlink-repository`.                                                                                                                                        |
| `sitecore cloud environment {create,list,info,update,delete,health,restart,promote}` | `scai deploy env {…}` including `health`                      | scai adds `get-edge-token`, `get-editing-secret`, `regenerate-context`, repo linking. `env health` probes `<cmHost>/healthz/ready`.                                                                                     |
| `sitecore cloud environment variable {list,upsert,delete}`                           | `scai deploy env variables {…}`                               | Same.                                                                                                                                                                                                                   |
| `sitecore cloud deployment {create,list,info,start,watch,cancel}`                    | `scai deploy dep {…}`                                         | Same.                                                                                                                                                                                                                   |
| `sitecore cloud editinghost {create,update,delete,deploy}`                           | `scai deploy editing-host {list,create,update,delete,deploy}` | scai adds `list`.                                                                                                                                                                                                       |
| `sitecore cloud logs {list,view,download}` + `deployment log`                        | `scai deploy logs {list,view,data}`                           | Same.                                                                                                                                                                                                                   |
| `sitecore cloud login                                                                | logout`                                                       | `scai login` / `scai logout`                                                                                                                                                                                            | Top-level on scai; OS keychain instead of `user.json`. |
| `sitecore init` (sitecore.json)                                                      | `scai init`                                                   | Different config file (`sitecoreai.cli.json`) and an interactive wizard.                                                                                                                                                |

## Added in scai

Features that have no dotnet counterpart:

- **Recipes** (`scai recipe {compile,plan,diff,push,prune-defaults}`) —
  declarative TypeScript template + rendering definitions pushed via the
  Authoring GraphQL API with deterministic GUIDs and LIFO rollback. See
  [recipes.md](./recipes.md).
- **Agent / CI ergonomics** — `--json`, `--non-interactive`, stable exit
  codes, OS keychain credential storage, per-environment env-var
  overrides (`SITECOREAI_ENV_<NAME>_*`), and `SITECOREAI_AUTO_WIZARD=0`.
- **Local activity log** — `scai history` records redacted commands at
  `~/.sitecoreai/cli-history.log`.
- **Interactive REPL** — `scai shell`.
- **`scai deploy site`** and **`scai deploy source-control`** command
  groups — first-class Deploy API surfaces that the dotnet plugin
  didn't expose.
- **Telemetry honoring `DO_NOT_TRACK`** — opt-out via the standard
  Console Do Not Track env var, plus `DISABLE_TELEMETRY` and
  `SITECOREAI_TELEMETRY=false`.

## Deliberately not ported

### `sitecore index` (Indexing plugin) — ❌ out of scope

The dotnet plugin manages Solr / Azure Search index rebuilds and
schema population against an on-prem Sitecore. On XM Cloud, indexes
are a managed Sitecore service — tenants don't rebuild them and don't
manage their schemas.

**Decision:** no scai equivalent. If on-prem support ever becomes a
goal, this is a natural plugin to revive.

### `sitecore publish` (Publishing plugin) — 🗓️ planned (REST API + consent model)

The dotnet plugin publishes from CM to one or more publishing targets
via the Authoring GraphQL `publish()` mutation. On XM Cloud the only
target is Experience Edge.

**Decision:** scope to two verbs — `scai publish` (item / subtree) and
`scai publish status <jobId>` — backed by the **SAI Publishing REST
API** (`https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs`,
documented at [api-docs.sitecore.com/sai/publishing-api](https://api-docs.sitecore.com/sai/publishing-api)),
not the legacy Authoring GraphQL `publish()` mutation. Same
automation-client JWT auth as the Sites and Pages APIs. `cancel`,
`list`, and `summary` are adjacent endpoints we'll consider as
follow-ups when there's a real need.

Out of scope (XM Cloud constraint): `list-targets` and multi-target
publishing (Edge is the only target), whole-DB republish (implicit
in the deploy pipeline; an out-of-band CLI republish is the wrong
shape).

**Safety model — non-negotiable.** Publishing pushes content to
Experience Edge and is immediately visible to end users. An agent
must never auto-invoke. Three layers, all required:

1. **CLI defaults to `--what-if`.** Running `scai publish` without
   `--allow-write` prints the resolved scope (env, target, item
   count + IDs, languages) and exits without calling the API.
   Same pattern as `scai cleanup versions prune`.

2. **Production envs require a typed scope token, two-step flow.**
   An environment is "production-tier" if its `sitecoreai.cli.json`
   entry sets `production: true`, or its name matches `/prod/i` or
   `/^live/i` (auto-flag, operator can override per-env). Production
   publishes are:
   - Step 1: dry-run prints scope summary plus a short token of the
     form `pub-<env>-<hash>-<ts>`, hashed over `(envName, resolved
itemIds, languages, target)`, TTL 5 minutes.
   - Step 2: real call requires `--allow-write --confirm-token <token>`.
     Changing scope between steps invalidates the token. CI pipelines
     follow the same two-step flow (`--json --what-if` → parse token
     from output → real call); there is no auto-approve shortcut.

   Non-production envs accept an interactive `[y/N]` prompt or
   `--yes` instead.

3. **Library + MCP require a structured consent record.** The
   publish library function (e.g. `publishJob`) is typed to require
   a `PublishConsent { confirmedBy, scope, scopeHash, issuedAt, ttl }`
   argument and refuses to call `POST /jobs` without one. The library
   recomputes `scopeHash` from the actual arguments and rejects on
   mismatch — the caller cannot lie about scope. Production-tier
   publishes require `confirmedBy.type === "human"` by default; CI
   principals can publish to production only when the env config
   explicitly lists their pipeline ID. An agent cannot synthesize a
   valid consent record; it must come from a layer the agent does
   not control (CLI prompt, MCP host approval modal, CI gate).

   On the MCP surface, publishing follows the workflow-shaped tool
   pattern (see [scai-mcp-tool-shape] memory) — exposed as a single
   `publishing_lifecycle` tool with a discriminated `action`
   (`submit`, `status`, and later `cancel` / `list`), not a 1:1
   `publish_item` wrapper. The tool inherits the per-call
   `allowWrite: true` gate already enforced by the MCP dispatcher;
   the `PublishConsent` record is an additional gate that the
   dispatcher's generic write check cannot satisfy. Tool description
   explicitly directs agents to surface scope to the operator and
   never invoke `submit` without an unambiguous green-light naming
   the target environment.

Every publish call writes a JSON-Lines entry to
`~/.sitecoreai/audit.log` (configurable via `SITECOREAI_AUDIT_LOG`):
caller identity, timestamp, scope, consent record, API response.
The audit log is never redacted — it's the production trail.

**Open implementation detail:** the request body schema for
`POST /authoring/publishing/v1/jobs` is rendered dynamically by
Redocly on api-docs.sitecore.com and not retrievable via plain HTTP.
Lock it during implementation from a real tenant's browser network
traffic or from the OpenAPI YAML directly.

### `sitecore dbcleanup` (Database plugin) — ✅ replaced by `scai audit` + `scai cleanup` (shipped 2026-05-13)

The dotnet plugin's `clean-blobs`, `clean-fields`, `clean-orphan-fields`,
and `rebuild-descendants` operate at the SQL layer. None of those are
possible on XM Cloud. But several of its operations
(`clean-orphan-items`, `clean-cyclic-dependencies`,
`clean-invalid-language-data`) are content-shaped and _are_ expressible
through the Authoring GraphQL API.

**Decision (shipped):** rather than port `dbcleanup`, the parity work
landed as two intent-shaped command groups:

- `scai audit` (read-only diagnostics) — broken-links, unused-media,
  orphans (= XM Cloud archive listing), stale-workflow, language-data.
- `scai cleanup` (mutating) — versions prune with `--root` /
  `--keep` / `--what-if` / `--allow-write`.

Originally planned as `scai content`; renamed during scoping because
"content" was too broad — every verb is hygiene-shaped, not
content-shaped in any general sense.

**XM Cloud limits surfaced during the build:**

- `clean-invalid-language-data` analogue is **read-only** (`scai audit
language-data list`). The Authoring API exposes only tenant-wide
  `deleteLanguage` (destructive) and per-version `deleteItemVersion` —
  no per-item, per-language entry removal. The on-prem mutation
  isn't portable.
- True SQL-orphans (items whose parent rows are missing) don't exist
  on XM Cloud — the GraphQL schema enforces parent integrity. The
  closest analogue is items in the archive (recycle bin), surfaced via
  `archivedItems`.
- `broken-links` and `unused-media` are tree-crawl-and-scan operations
  on XM Cloud (no link-database query exposed). The `--limit` flag
  guards against very large tenants.

The SQL-only operations remain explicitly out of scope.

### `sitecore itemres` (ResourcePackage plugin) — 🗓️ planned

The dotnet plugin builds protobuf-encoded `.dat` files that an on-prem
Sitecore install loads at startup to expose read-only resource items.
This is an XM-traditional runtime mechanism — XM Cloud has no
equivalent loader — but `.dat` patterns are still in use by teams
shipping content to on-prem installs.

**Decision:** roadmap entry. Implementation requires protobuf-net
schema work and is not scoped yet. Recipes solve a conceptually
similar problem (declarative item trees as code) for the
XM-Cloud-shaped case.

## Architectural decisions

### Plugin model — closed binary, no SDK

`Sitecore.DevEx` is a host CLI that loads third-party plugins as
NuGet packages implementing `ISitecoreCliExtension`. The XmCloud plugin
is itself one of those plugins.

**Decision:** scai ships as a single Node binary. Everything that ships
with scai lives in one repo and is published as one npm package. There
is no plugin SDK, no third-party command registration, no plugin
discovery.

Rationale:

- The dotnet plugin model exists mostly so Sitecore can ship XmCloud
  separately from the host — that's a Sitecore-team coordination
  boundary, not a user-facing benefit. scai bundles all of that into
  one binary, which is a _simpler_ story for end users (one install,
  one version, one audit surface).
- Most user-shaped extension needs (custom template / rendering
  definitions, project-specific content patterns) are covered by
  **Recipes**, which is a more direct fit for the actual problem.
- If genuine third-party CLI extensions ever show up, the right
  pattern is subprocess plugins (git-style `scai-plugin-<verb>`
  discovery on `PATH`) — small, language-agnostic, isolated. This is
  a planning-only decision today, not an implementation commitment.

### XM Cloud first, on-prem deliberately out of scope

scai targets XM Cloud tenants. On-prem-only features (SQL cleanup,
managed-search index control, `.dat` resource loaders, multi-publish-target
publishing) are out of scope. If on-prem support becomes a real goal
later, the natural shape is a separate command tree
(`scai on-prem <…>`) or — if the surface gets large enough — a
revisit of the plugin-model decision.
