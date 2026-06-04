---
"@sitecoreai-labs/sitecoreai-cli": minor
---

`sync`, `brief`, `campaign`: registry-tracked Sitecore UUID identity, URL-safe baseline keys, and a `--identities-out` write-back surface.

Three related changes that work together to let a registry-backed caller
(the showcase-orchestrater) skip scai's marker-in-name / handle-label
fallbacks and read tenant entities by id directly.

**`KindRef.baselineKey?: string`** (new optional field on the shared
sync interface).

Lets the caller pass a stable, URL-safe key for remote baseline storage
that's decoupled from `ref.id`. `ref.id` keeps the lookup semantics each
kind already had — full marked display name for briefs, display name +
labels for campaigns. `ref.baselineKey` rides through to the third path
segment of the `HttpBaselineStorage` URL (`/<env>/<key>`), so
URL-significant characters in display names (`&`, `?`, `#`, `%`,
whitespace) no longer crash the baseline GET/PUT regex on the orchestrator
end. The `campaigns/recipe/kind.ts` and `brief/recipe/instance-kind.ts`
baseline calls fall back to `ref.id` when `baselineKey` is absent, so
nothing changes for CLI invocations that don't supply it.

**`KindRef.tenantId?: string`** (new optional field).

Lets a registry-backed caller pin the tenant resource UUID
authoritatively. When present, the brief + campaign kinds' apply paths
prefer `getBrief(ref.tenantId)` / `getProject(ref.tenantId)` over the
baseline-stored tenant id, which in turn beats the marker-in-name /
label-search fallback. First-push behaviour is unchanged (the caller
doesn't have a UUID yet); subsequent pushes resolve in O(1) instead of
paging the tenant list.

**`CampaignRecipeSchema.handle`, `CampaignRecipeSchema.sitecoreId`,
`BriefInstanceRecipeSchema.handle`, `BriefInstanceRecipeSchema.sitecoreId`,
`CampaignDeliverableSchema.sitecoreId`, `CampaignTaskSchema.sitecoreId`**
(new optional fields).

The sync commands (`commands/{brief,campaign}/sync.ts`) and the MCP
tools (`mcp/tools/{brief,campaign}-recipe.ts`) lift `recipe.handle` into
`KindRef.baselineKey` and `recipe.sitecoreId` into `KindRef.tenantId`.
Deliverables and tasks gain their own `sitecoreId` on the wire (round-
tripped through the campaign apply outcome) so callers can persist UUIDs
for every nested entity, not just the top-level project.

**`ApplyResult.identities?: ResolvedIdentity[]`** (new optional field
on the shared `ApplyResult`; `ResolvedIdentity` exported from `@/sync`).

Surfaces every Sitecore UUID scai resolved during apply, scoped by
kind. The brief kind emits one identity per pushed brief. The campaign
kind emits one for the project plus one per handled deliverable and per
handled task, with `parentHandle` for nesting. Callers persist these
back onto their own model so subsequent pushes ride the by-id path.

**`scai ops brief sync push --identities-out <path>`** and
**`scai ops campaign sync push --identities-out <path>`** (new CLI flag).

Writes the apply outcome's `identities` to a JSON file at the given
path (`{ identities: [...] }`). The orchestrator passes a temp path,
reads the file after a successful push, and stamps the UUIDs into its
own recipe row. CLI-only invocations can leave the flag unset.

Composes cleanly with the brief-type three-way merge already shipped
on `briefTypeKind` and the brief / campaign three-way merges in
`briefInstanceKind` / `campaignKind`. No `RecipeKind` interface
breakage — every change is opt-in via the new fields.
