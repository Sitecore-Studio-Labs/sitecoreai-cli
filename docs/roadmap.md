# Roadmap

The single source of truth for what's planned in scai. This file
supersedes the per-area follow-up docs that previously tracked work in
isolation — `agent-feedback-followups`, `brand-resource-followups`,
`campaigns-followups`, `publish-followups`, and the content-publishing
roadmap (`roadmap-content-publishing-state` + its impl notes) — all of
which are folded in below and removed.

- For how scai maps to the dotnet `Sitecore.DevEx` CLI and what was
  deliberately not ported, see
  [parity-with-devex.md](./parity-with-devex.md).
- Larger design discussions belong in GitHub issues; this file is the
  phased plan plus the parking lot.

## How an area ships

Every product area in scai ships the same way — the pattern set by
deploy, serialization, recipes, publishing, brand, brief, and campaign:

1. **SDK** — a typed subpath export
   (`@sitecoreai-labs/sitecoreai-cli/<area>`) with a `create*Client`
   factory.
2. **CLI** — a command group, `--what-if`-by-default for any write.
3. **MCP** — workflow-shaped tools (inspect / lifecycle / manage), never
   1:1 library wrappers, behind the per-call `allowWrite` gate.
4. **Recipe kind** — where the area has declarative config worth
   authoring as code (templates, workflows, brief types, campaigns).

New areas below are scoped against this four-surface checklist.

## Now — 0.1.0, the publish gate

Everything required before the first public npm release.

- **Security-audit remediation.** Close the 0.1.0 security audit — 7
  blockers and 8 mediums, tracked as GitHub issues. The big-ticket item
  is the **recipe trust model**: `.recipe.ts` files are executed code,
  so the sandboxed-compile path (`.recipe.ts` → `.recipe.json` in
  isolation, then operate on the JSON form) needs to become a
  first-class, documented workflow rather than a README caveat.
- **CI preflight** — checks for publish credentials, org access, and
  release gating before a release job runs.
- **npm provenance** — publishing via OIDC Trusted Publishing was wired
  2026-05-13; provenance attestation stays off until the repo goes
  public. Flip it on at that point (see [release.md](./release.md)).
- **A `doctor` command** — validate env / auth / config and surface
  actionable fixes in one command.
- **Config-schema enforcement** for module configs loaded from packages.
- **Config storage location** — make `sitecoreai.cli.json`'s location
  configurable (currently fixed at the project root, `--config` to
  override).
- **Changeset / CHANGELOG hygiene** — the publishing + content-version
  surface shipped without a CHANGELOG entry. Make sure the 0.1.0
  changeset names every new verb and the publishing auth model.

## Next — the Content side: Pages & Sites

The user-facing content APIs scai hasn't surfaced yet. This is the
priority once 0.1.0 is out.

### Sites API — CLI + MCP surface

The Sites API SDK client already exists (`src/sites/` — collections,
sites, languages, jobs) but has **no CLI or MCP surface**. `updateSite`
/ `setSiteBrandKit` (`PATCH /api/v1/sites/{siteId}`) shipped SDK-only.

- CLI: a sites command group (placement TBD — `scai content sites …`
  or top-level `scai sites …`) over sites, collections, language config.
- MCP: a `sites` inspect/manage tool pair.
- Site↔brand-kit association — surface `setSiteBrandKit` on CLI + MCP.
  Deferred from the brand work specifically so it lands alongside the
  Sites surface.

### Pages API — new build

`/sai/pages-api` (create / update / retrieve / delete site pages) is not
built at all. New SDK area + CLI group + MCP tools, same
automation-client JWT auth as the Sites and Publishing APIs.

### Content-tree mutations

Smaller content-side gaps surfaced by agent feedback:

- **`moveItem`.** The Authoring API exposes `moveItem`, but scai has no
  SDK call, CLI command, or MCP tool for it. Today relocating a subtree
  means delete + recreate, which breaks every inbound reference. Plan:
  add `moveItem` to the Authoring client (sibling to `createItem` /
  `updateItem` / `deleteItem`), surface as `scai content move`, and
  extend the MCP `cleanup_tools` discriminator. Unblocks the
  `scai/scripting` `subtree.move` helper.
- **Multilist GUID removal → CLI.** The `removeRef` helper exists in
  `scai/scripting`; promote it to `scai hygiene cleanup multilist
remove-ref` (same read-mutate-write shape as `cleanup field-set`).
- **`deleteItem` MCP coverage.** `deleteItem` is wired into `cleanup
subtree` and rollback paths but no MCP tool calls it directly — extend
  `cleanup_tools` with a consent-guarded `delete-item` verb.

## Recipes — content-as-code expansion

Recipes are scai's declarative layer. The expansion goes two ways:
deeper (graduate the composition kinds) and wider (recipe kinds for
non-template surfaces).

- **Graduate the composition kinds.** `PartialDesignRecipe`,
  `PageDesignRecipe`, `PageTemplateRecipe`, `PageRecipe`,
  `PlaceholderRecipe`, `SiteTemplateRecipe`, `SiteRecipe`, and
  `ContentItemRecipe` are present in source but not in the 0.1.0
  stability promise. Stabilize them in a follow-up release with the same
  idempotent re-push + LIFO rollback guarantees as the seven stable
  kinds. `PageTemplateRecipe` (page-level templates with SXA page base
  inheritance) and `PlaceholderRecipe` (the hybrid placeholder model —
  standalone + inline `ComponentTemplateRecipe.placeholders`, with
  `Allowed Controls` whitelist emission and placement-legality
  validation) landed 2026-05-15. `PageRecipe` (concrete page items
  conforming to a page template, with `__Final Renderings` layout)
  landed 2026-05-16 — `scoped` datasources and page-tree nesting are
  the two open follow-ups.
- **Ops-as-code (in flight).** `brief-type` and `campaign` recipe kinds
  — recipes that wire the Content Operations and Orchestrate APIs into
  the same compile / plan / diff / push lifecycle as Sitecore templates.
  Source and tests are landing now (`src/brief/recipe/`,
  `src/campaigns/recipe/`, plus MCP `brief-recipe` / `campaign-recipe`
  tools).
- **Future kinds for new surfaces.** A `FormRecipe` (form definitions as
  code) for XM Cloud Forms, and an **agent recipe kind** for Agentic
  Studio (see Later) — declarative config is the natural authoring model
  for both.

## IAR — Items As Resources (`.dat` builder)

The one real `Sitecore.DevEx` parity gap scai hasn't closed. The dotnet
`sitecore itemres` plugin builds protobuf-encoded `.dat` files for
Sitecore's resource-item loader; real demand exists from teams shipping
content to on-prem installs.

Status: **planned, needs scoping.** Implementation requires protobuf-net
schema work that isn't trivially available in the JS ecosystem. Two
candidate shapes — (a) reconstruct the protobuf-net schema and use a JS
protobuf library, or (b) shell out to a small dotnet helper — each with
material trade-offs (schema fidelity vs. install footprint; a dotnet
helper reintroduces the .NET dependency scai exists to avoid). Commit it
to a release once a schema-reconstruction spike confirms a path.

## Later — new product surfaces

The expansion beyond DevEx parity. Each is a full four-surface area
(SDK / CLI / MCP / recipe-where-it-fits).

### Agentic Studio — agent authoring

The goal: **create and configure SitecoreAI agents as code.** Agentic
Studio is SitecoreAI's workspace for building agents, spaces, workflow
agents, and signals. The APIs that _create_ agents aren't in the public
api-docs catalog — they're the undocumented endpoints the Agentic Studio
UI calls.

scai's interest is strictly the **authoring** side: provisioning agents,
spaces, and workflow-agent definitions. It is **not** the runtime Agent
API (`/sai/agent-api` — triggering and chatting with already-built
agents); scai deliberately bypasses that and ships its own MCP server as
the developer-side agent surface (see Non-goals).

First step is a reconnaissance probe — capture a HAR of agent creation
in the Agentic Studio UI to discover the endpoints + auth shape, the
same way the Brief and Campaign areas were reverse-engineered. The
headline deliverable is an **agent recipe kind**: declarative agent
definitions authored in `.recipe.ts` and pushed through the same
compile / plan / diff / push lifecycle as templates.

### XM Cloud Forms

XM Cloud's SaaS form builder — surface form-definition CRUD and
submission export. No REST API is in the public api-docs catalog yet, so
the first step is a reconnaissance probe to capture the endpoint + auth
shape (the approach used for the Brief and Campaign areas). A
`FormRecipe` (form-as-code) is a natural follow-on.

### Performance — CDP/Personalize analytics

A read-only analytics/insights surface over **CDP and Personalize** —
experiment results, variant performance, audience analytics. Read-only
by design, and valuable for agents (pull metrics, never mutate). Likely
`scai insights …` (namespace provisional), with the analytics subpath
returning structured JSON for downstream tooling.

## Awaiting Sitecore — preempt entries blocked on unreleased APIs

Areas scai wants to support but cannot build yet because the upstream
API isn't available. Re-probe when the blocker clears.

### Sitecore Search (the product)

Sitecore Search — the SaaS product for building your own indices — is
**future roadmap**, but its management APIs aren't published yet. Hold
until Sitecore publishes the API, then scope an ingestion +
source/widget-config surface.

> Not to be confused with the dotnet DevEx `sitecore index` plugin
> (managed-search index rebuilds for on-prem). That is a **deliberate
> non-goal** — see Non-goals below.

### Strategy "Brands API"

The unreleased Sitecore Strategy Brands API. Auth coordinates and the
endpoint surface are verified against staging
(`scripts/_smoke-strategy-brand-probe.ts`), but the API is feature-
flagged off (`BRANDS_API_DISABLED`) for every reachable tenant — so the
data model is still unknown and no client can be built. **Unblock:** an
admin enables the Brands feature on a staging tenant scai has M2M
credentials for, then re-run the probe to capture the `brand` +
`brand-types` shapes. Planned once unblocked: a `brand` resource client
under `src/brand/` (a separate auth seam from the brand-kit
surface), `scai brand brands list|get`, and MCP `brand_inspect`
coverage.

## Parking lot — smaller items & open questions

Tracked, not yet scheduled. Promote into a phase when prioritized.

**ScaiEnvelope coverage** — adoption is now complete across every
task family (brief, campaigns, workflow, serialization push, brand
review JSON, recipe push, agents). The 2026-05-27 audit's seven
remaining gaps were closed the same day; the codebase-conventions
skill flags the requirement so new tasks must call
`buildScaiEnvelope` on the `--json` path. SARIF output from
`brand review` stays unwrapped — it's a standardized OASIS schema
that downstream tooling parses verbatim, and the `--format json`
path is the envelope-compliant alternative.

**Publishing polish**

- Token-scope re-mint on cache miss — when a cached publishing token's
  scope has drifted, fall through to a fresh M2M mint instead of
  throwing (`src/publishing/api/auth.ts`).
- Long-running `publish all` in `--non-interactive` — default to
  submit-then-watch-until-terminal with a sensible timeout; add
  `--no-wait` for fire-and-forget CI.
- MCP test coverage for `publishing_lifecycle` — assert `submit_all` is
  unreachable from MCP, `submit_item` requires a `PublishConsent`, and
  status / cancel are `allowWrite`-gated per call.
- Pre-publish diff for `publish all --mode Smart` — "N items modified
  since last full publish" (operator confidence only; Smart already
  handles this server-side).

**Campaign area — unverified, needs a probe**

- OAuth scope — `acquireCampaignToken` mints with no `scope` param;
  capture an authed request and pin the Orchestrate scope.
- ~~Region resolution~~ — **done.** `src/shared/region.ts` resolves the
  region from the org id via the Platform Inventory API; campaign,
  brief, and agents all call it (`resolveRegionalBaseUrl` /
  `resolveRegionCode`). `campaignBaseUrl` / `briefBaseUrl` remain as
  explicit per-env overrides.
- Project update / delete — `OPTIONS`-probe `/projects/{id}` before
  adding `updateProject` / `deleteProject`.
- Brief↔campaign linking — mechanism undiscovered; capture a HAR of
  attaching a brief in the Content Operations UI before building it.
- Attachments, `members` / `labels` on create, enum tightening —
  surface gaps in the campaign CLI/MCP input shape.

**Content-state follow-ons**

- `--strategy delete` on `scai content publish unpublish` — currently
  stubbed with an error pointing at the reversible strategies. Needs a
  typed-item-path confirmation gate plus the `deleteItem` / `archiveItem`
  mutation.
- `scai content unpublish` alias — a convenience route to the same task
  (today there's one canonical path, `content publish unpublish`).
- Default write language — unpublish / version writes fall back to `en`
  when `--languages` is empty, which is user-hostile for non-`en`
  tenants. Read `system.languages` from the Authoring API, or make
  `--languages` required.

**Cross-cutting**

- Library-layer consent universalisation — should publishing's
  scope-token model (TTL, scope hash, two-step dry-run → token → call)
  extend to other destructive areas (bulk cleanup, env delete,
  source-control unlink)? Needs a focused design pass before scattering
  scope tokens everywhere.
- Reverse-dependency scan helper — parametric "items referencing X under
  subtree Y filtered by field Z"; likely lands in `scai/scripting`.
- Telemetry UX — persisted defaults and clearer status output for
  telemetry opt-in / opt-out.

## Deliberate non-goals

Recorded so they don't get re-proposed. Full rationale in
[parity-with-devex.md](./parity-with-devex.md).

- **DevEx `sitecore index` (content-search / indexing plugin)** —
  managing Solr / Azure Search index rebuilds for on-prem Sitecore. On
  XM Cloud, indexes are a managed service; cut. (Distinct from the
  Sitecore Search _product_, which is future roadmap — see above.)
- **SQL-level `dbcleanup`** (`clean-blobs`, `clean-fields`,
  `rebuild-descendants`) — needs direct DB access; not possible on
  XM Cloud.
- **Multi-publish-target publishing, per-role ACL audits** — on-prem
  constructs, or not exposed by any XM Cloud API.
- **The runtime Agent API (`/sai/agent-api`) and Marketer MCP** —
  triggering and chatting with already-built agents. scai is a
  developer / authoring tool and ships its own MCP server as its agent
  surface; _consuming_ Sitecore's managed agentic runtime is out of
  scope. (Authoring agents — _creating_ them — is in scope; see Later.)
- **A plugin SDK** — scai ships as one closed binary. If third-party
  extensions are ever needed, the fallback is subprocess plugins
  (`scai-plugin-*`).

## Recently shipped

| Area                                                              | Shipped       |
| ----------------------------------------------------------------- | ------------- |
| `scai mcp serve` — MCP server, 24+ workflow-shaped tools          | 2026-05-14    |
| `scai hygiene audit` (12 verbs) + `scai hygiene cleanup`          | 2026-05-13/14 |
| `scai content publish` + `content version` (SAI Publishing API)   | 2026-05-14    |
| Two-environment `ser diff` (`--source-env` / `--target-env`)      | 2026-05-14    |
| `scai ops brief` — Content Operations brief types + instances     | 2026-05-15    |
| `scai ops campaign` — Orchestrate projects / deliverables / tasks | 2026-05-15    |
| `scai brand` — Brand Management + Brand Review                    | 2026-05       |
| npm publish via OIDC Trusted Publishing                           | 2026-05-13    |
