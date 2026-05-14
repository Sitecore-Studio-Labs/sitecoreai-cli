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
- **`scai mcp serve`** — built-in MCP (Model Context Protocol) server
  exposing scai's library surfaces as agent tools. Developer-side
  counterpart to Sitecore's managed Marketer MCP. See [mcp.md](./mcp.md).

## Deliberately not ported

### `sitecore index` (Indexing plugin) — ❌ out of scope

The dotnet plugin manages Solr / Azure Search index rebuilds and
schema population against an on-prem Sitecore. On XM Cloud, indexes
are a managed Sitecore service — tenants don't rebuild them and don't
manage their schemas.

**Decision:** no scai equivalent. If on-prem support ever becomes a
goal, this is a natural plugin to revive.

### `sitecore publish` (Publishing plugin) — 🗓️ planned (REST API + tiered consent model)

The dotnet plugin publishes from CM to one or more publishing targets
via the Authoring GraphQL `publish()` mutation. On XM Cloud the only
target is Experience Edge.

**Decision:** scope to four verbs backed by the **SAI Publishing REST
API** (`https://edge-platform.sitecorecloud.io/authoring/publishing/v1/jobs`,
documented at [api-docs.sitecore.com/sai/publishing-api](https://api-docs.sitecore.com/sai/publishing-api)),
not the legacy Authoring GraphQL `publish()` mutation. Same
automation-client JWT auth as the Sites and Pages APIs.

- `scai publish item --path <id-or-path> [--languages …]
[--include-subitems] [--include-related]` → item / subtree publish.
- `scai publish all [--languages …]` → whole-tenant republish to Edge.
  Real ops button (needed sometimes after big serialization pushes,
  rollbacks, or migrations where Edge has drifted from CM). Maximum
  gating, see Tier 2 below.
- `scai publish status [<jobId>]` → `GET /authoring/publishing/v1/jobs/{id}`
  with a jobId; without one, lists currently-running jobs so an
  operator who closed their terminal can recover the jobId.
- `scai publish cancel <jobId>` → `POST /jobs/{jobId}/cancel`.
  First-class because `publish all` is a heavy operation that
  operators may need to abort mid-flight.

Bare `scai publish` (no subcommand) errors out — no accidental
invocation path.

Out of scope (XM Cloud constraint): `list-targets` and multi-target
publishing — Experience Edge is the only target and `listOfTargets`
just returns `["Edge"]`. Anything that depends on multiple targets
(per-target republish, target-set selection) is meaningless on
XM Cloud and not ported.

**Safety model — non-negotiable.** Publishing pushes content to
Experience Edge and is immediately visible to end users. Agents must
never auto-invoke. Two tiers:

#### Tier 1 — item / subtree publish (`scai publish item`)

1. **CLI defaults to `--what-if`.** Running without `--allow-write`
   prints the resolved scope (env, tenant ID, target, item count +
   IDs, languages) and exits without calling the API. Same pattern
   as `scai cleanup versions prune`.

2. **Production envs require a typed scope token, two-step flow.**
   An environment is "production-tier" if its `sitecoreai.cli.json`
   entry sets `production: true`, or its name matches `/prod/i` or
   `/^live/i` (auto-flag, operator can override per-env). Production
   publishes are:
   - Step 1: dry-run prints scope summary plus a short token of the
     form `pub-<env>-<hash>-<ts>`, hashed over
     `(envName, resolvedTenantId, resolved itemIds, languages, target)`,
     TTL 5 minutes.
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
   (`submit_item`, `status`, `cancel`), **never** `submit_all` (see
   Tier 2 #5). The tool inherits the per-call `allowWrite: true` gate
   already enforced by the MCP dispatcher; the `PublishConsent`
   record is an additional gate that the dispatcher's generic write
   check cannot satisfy. Tool description explicitly directs agents
   to surface scope to the operator and never invoke `submit_item`
   without an unambiguous green-light naming the target environment.

#### Tier 2 — whole-tenant republish (`scai publish all`)

Strictly stricter than Tier 1. The same three layers apply, with
these overrides:

1. **Always production-tier semantics.** The env-config heuristic
   doesn't apply — `publish all` is treated as max-risk regardless
   of whether the env is flagged production. Sandbox tenants get the
   same gating; "I typed `all` instead of `item`" is a real failure
   mode that the token requirement catches.

2. **Two-step token, mandatory. No `[y/N]` fallback ever.** Same
   5-minute TTL as Tier 1. scopeHash inputs:
   `(envName, "FULL", languages, target, resolvedTenantId)` — bound
   to the resolved tenant GUID, not just the local env alias, so
   re-pointing `sitecoreai.cli.json` between dry-run and real call
   invalidates the token.

3. **Real call requires both `--confirm-token <token>` AND typing
   the env name back interactively.** The env-name prompt is a
   verbatim case-sensitive string match, echoed in dry-run output
   as `Type 'prod' to confirm.` No `--yes` flag suppresses it.

4. **CI requires three explicit opt-ins.** Env config must set all
   of `production: true`, `allowFullRepublish: true`, and
   `allowedCiPipelines: [pipelineId, …]`. Default is human-only.

5. **Not exposed on the MCP surface at all.** The
   `publishing_lifecycle` tool's `action` discriminator does **not**
   include `submit_all`. If an agent ever wants to recommend a full
   republish, it returns text recommending the CLI verb; the
   operator runs it manually. Hard cut.

6. **Pre-flight serialization.** CLI calls `GET /jobs` first and
   refuses if any `publish all` is already running on the same
   tenant. One full republish at a time per tenant — prevents
   concurrent storms hitting rate limits or doubling load on Edge.

7. **Audit log marks `publish all` distinctly.** `scope: "full"`,
   `risk: "high"`, resolved tenant ID, env name, token used, who
   cancelled if cancelled. Grep-able.

Every publish call (Tier 1 or Tier 2) writes a JSON-Lines entry to
`~/.sitecoreai/audit.log` (configurable via `SITECOREAI_AUDIT_LOG`):
caller identity, timestamp, scope, consent record, API response.
The audit log is never redacted — it's the production trail.

**Open implementation detail:** the request body schema for
`POST /authoring/publishing/v1/jobs` is rendered dynamically by
Redocly on api-docs.sitecore.com and not retrievable via plain HTTP.
Lock it during implementation from a real tenant's browser network
traffic or from the OpenAPI YAML directly.

**Auth model (resolved 2026-05-14, after consulting the Publishing
API architect):** automation clients in Sitecore Cloud Portal are
either **organization-level** (for org/project/env management
operations) or **environment-level** (for per-env operations
including publishing). The Publishing API requires an
**environment-level** automation client; org-level clients don't
carry the publishing grants.

- Required scopes (tenant-tier, on env-level automation clients):
  - `xmcpub.jobs.t:r` — read publishing jobs
  - `xmcpub.jobs.t:w` — create / cancel publishing jobs
  - `xmcpub.queue:r`  — read the publish queue
- Audience: `https://api.sitecorecloud.io` (the standard Sitecore
  Cloud API audience).
- The api-docs page also lists `.a` admin-tier variants
  (`xmcpub.jobs.a:r/w`); those are for Pages-UI **user** tokens
  with Organization Owner role, on the
  `https://api-webapp.sitecorecloud.io` resource server. Don't copy
  the Pages scope set verbatim into automation-client requests.

**Operator setup (per environment that needs to publish):**

There are two viable paths. Both depend on the operator having an
env-level automation client (Cloud Portal → Environments → [env] →
Automation Clients → Create — generates a clientId + secret that
carries the `.t` publishing grants by default).

**Path A — interactive operator (workstation):** run `scai login
-n <env>` against the env-level client. scai's default scope set
(`SCAI_API_SCOPES` in
`src/serialization/tasks/env/constants.ts`) already requests the
publishing scopes alongside the deploy + CM admin scopes, so a
successful login mints a token covering both surfaces. No
publish-specific login command; one login, both capabilities.

**Path B — CI / non-interactive:** set
`SITECOREAI_ENV_<NAME>_CLIENT_ID` + `_CLIENT_SECRET` env vars
(or put `clientId`/`clientSecret` on the env profile in
`sitecoreai.cli.json`). scai mints a fresh publishing-scoped token
on demand via client-credentials with explicit `.t` scopes, caches
it in the publishing keychain entry, and reuses it until expiry.

**Resolution order in `acquirePublishingToken`:**

1. Cached publishing-specific token in keychain (set by a previous
   successful mint or Path B run).
2. The deploy token in keychain, if its scope claim already
   contains `xmcpub.jobs.t:*` (Path A — same token serves both
   deploy and publishing).
3. Fresh client-credentials mint via the env's clientId + secret
   (Path B).

After minting (or reading from keychain), scai decodes the token
and verifies the publishing scopes are present. If not, it
surfaces an `AUTH_REQUIRED` error that **decodes what the token
DID get** and infers the likely cause — e.g. "looks like an
org-level client; the Publishing API requires env-level" — so the
operator knows whether to re-login or fix their credential
configuration.

**Note on prior research artifacts:** a multi-hour investigation
earlier on 2026-05-14 wrongly concluded the publishing scopes lived
on the `https://api-webapp.sitecorecloud.io` resource server and
that no scai-provisioned automation client had grants for them.
Both conclusions were wrong: the agent had copied `.a` admin-tier
scopes from a decoded Pages JWT instead of trying the `.t`
tenant-tier variants the api-docs page also documented. The Auth0
error "client has not been granted scopes" was literal — those
specific (admin) scopes weren't granted, but the tenant variants
were. Recorded here so future readers know to ignore commit
messages and earlier doc revisions claiming the REST API needs
operator-side client-grant work.

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

### Security / per-role ACL audits — ❌ not buildable from XM Cloud APIs

A natural complement to `audit empty-roles` / `audit role-bloat` /
`audit stale-users` would be:

- `audit anonymous-write` — items writable by the Anonymous user.
- `audit excessive-acls` — per-role per-item permission matrix.
- `audit unapproved-users` — users with `isApproved: false` or
  missing email.

**Authoring API (introspected 2026-05-13).** `Item.access` returns
only `canRead / canWrite / canDelete / ...` booleans from the
**caller's** perspective (the OAuth client-credentials identity).
No per-role ACL detail; no way to inspect anonymous-perspective
access without impersonation (which OAuth client-credentials
doesn't support).

**Management API (introspected 2026-05-14).** Has `users(predicates: [Predicate])`
and `roles(predicates: [Predicate])` that _do_ expose `isApproved`,
`email`, and other administrative fields the Authoring API hides.
**But:**

- `Predicate.pattern` is substring match (not glob, not SQL LIKE).
  `*` errors with `ARGUMENT`, `%` returns empty.
- The resolver is unreliable under repeated OAuth client-credentials
  calls — same query that succeeded once returns `ARGUMENT_NULL`
  on subsequent calls without an obvious trigger.
- Even with working calls, the per-role ACL bindings aren't
  surfaced.

Net: neither API exposes what these audits would need. The dotnet
CLI never had them either (it relied on direct SQL access to the
`ItemAccess` / `Domains_*` tables). They stay out of scope.

If a future XM Cloud release adds per-role ACL queries to either
API, revisit. Until then, operators inspecting tenant security
should use the Sitecore Security Editor UI directly.

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
