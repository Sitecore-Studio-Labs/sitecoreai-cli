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

| dotnet surface | scai equivalent | Notes |
| --- | --- | --- |
| `sitecore ser pull` | `scai ser pull` | Same semantics. |
| `sitecore ser push` | `scai ser push` | Same semantics. `--publish` chain is out of scope (see Publishing below). |
| `sitecore ser diff` (local vs remote) | `scai ser diff` | Same semantics for the local-vs-remote case. |
| `sitecore ser diff --source A --destination B [--push]` | _Planned_ | Roadmap entry: `--source-env` / `--target-env` / `--push`. Implementation: temp-dir pivot reusing the existing diff + push engines. |
| `sitecore ser info`, `explain`, `validate`, `watch` | `scai ser info|explain|validate|watch` | Same. `--fix` auto-correct on `validate` is not implemented. |
| `sitecore ser package create|install` | `scai ser package create|install` | Same. |
| `sitecore cloud organization {info,health,license}` | `scai deploy org {get,health,license,launch-demo}` | scai adds `launch-demo`. |
| `sitecore cloud project {create,list,info,update,delete}` | `scai deploy proj {…}` | scai adds `limitation`, `validate-name`, `link-repository`, `unlink-repository`. |
| `sitecore cloud environment {create,list,info,update,delete,health,restart,promote}` | `scai deploy env {…}` including `health` | scai adds `get-edge-token`, `get-editing-secret`, `regenerate-context`, repo linking. `env health` probes `<cmHost>/healthz/ready`. |
| `sitecore cloud environment variable {list,upsert,delete}` | `scai deploy env variables {…}` | Same. |
| `sitecore cloud deployment {create,list,info,start,watch,cancel}` | `scai deploy dep {…}` | Same. |
| `sitecore cloud editinghost {create,update,delete,deploy}` | `scai deploy editing-host {list,create,update,delete,deploy}` | scai adds `list`. |
| `sitecore cloud logs {list,view,download}` + `deployment log` | `scai deploy logs {list,view,data}` | Same. |
| `sitecore cloud login|logout` | `scai login` / `scai logout` | Top-level on scai; OS keychain instead of `user.json`. |
| `sitecore init` (sitecore.json) | `scai init` | Different config file (`sitecoreai.cli.json`) and an interactive wizard. |

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

### `sitecore publish` (Publishing plugin) — ⚠️ partial via roadmap

The dotnet plugin publishes from CM to one or more publishing targets
(web, preview, ...). On XM Cloud the only target is Experience Edge and
publishing is implicit in the deploy pipeline.

**Decision:** add a thin `scai publish item` wrapper to roadmap that
triggers an Edge publish for a specific item / subtree via the
Authoring GraphQL API. The rest of the dotnet surface
(`list-targets`, multi-target, republish-all) is on-prem-only.

### `sitecore dbcleanup` (Database plugin) — ❌ replaced by `scai content` hygiene group

The dotnet plugin's `clean-blobs`, `clean-fields`, `clean-orphan-fields`,
and `rebuild-descendants` operate at the SQL layer. None of those are
possible on XM Cloud. But several of its operations
(`clean-orphan-items`, `clean-cyclic-dependencies`,
`clean-invalid-language-data`) are content-shaped and *are* expressible
through the Authoring GraphQL API.

**Decision:** rather than port `dbcleanup`, build a `scai content`
command group focused on XM-Cloud-shaped content hygiene operations
(broken links, unused media, orphans, version pruning, etc.). See the
roadmap. The SQL-only operations remain explicitly out of scope.

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
  one binary, which is a *simpler* story for end users (one install,
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
