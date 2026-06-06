# Site Template — Modules + Picker-Tile Gaps

Cold-pickup plan to close two gaps in `compileSiteTemplateRecipe` so a
scai-authored site template (a) renders a usable tile in the SitecoreAI
"Create a site" picker, and (b) actually instantiates a site with the
brand structure the recipe describes, rather than an empty shell.

Status: partially implemented (credentials-independent slice).
**Three open design questions resolved by operator 2026-06-06 — see
"Operator decisions" at the bottom.** Sub-milestone A (sandbox
introspection) verifies those calls against the sandbox and resolves
U1–U6 before B/C/D commit to a schema shape.

**Landed 2026-06-06 (credentials-independent slice of C, partial of D):**

- `SiteTemplateRecipeSchema` mirrors the registry: adds
  `thumbnail` / `image` (discriminated `url | asset` union) and
  `contents`. URL mode is the cheap path; asset mode lands schema-first
  with the media-upload IR op deferred per the operator decision below.
- `compileSiteTemplateRecipe` now emits an explicit `consola.warn` when
  the recipe populates any schema-accepted-but-compile-dropped field
  (`pageTemplates`, `pageDesigns`, `insertOptionsMatrix`,
  `templatesToDesigns`, `dictionary`, `taxonomy`, `thumbnail`, `image`,
  `contents`). The silent drop documented in the TODO at
  `compile/site-template.ts:143-156` is now noisy by default; minimal
  recipes still stay quiet.
- Unit tests cover both the schema discriminated-union shapes (parse
  pass/fail across `kind: "url"`, `kind: "asset"`, and unknown
  discriminators) and the warn behavior (populated → warns; minimal →
  silent).

**Still blocked on sandbox credentials** (no `SITECOREAI_DEPLOY_TOKEN`
or `SITECOREAI_CLIENT_ID` + `SITECOREAI_CLIENT_SECRET` for
`xmc-lizsitecore088b-starterkitsa33f-contentatte7784`):

- Sub-milestone A (introspection of U1–U6).
- Sub-milestone E (live integration test).
- The GUID-dependent parts of D — module placement under the tenant
  tree, `SITE_MODULES` / `TENANT_MODULES` field writes, picker-field
  SetField ops for `thumbnail` / `image` (we have the schema but not
  the source-field GUID), and the `kind: "asset"` media-upload IR op.

## Sub-milestone A findings (2026-06-06)

Captured in `docs/plans/site-template-modules-and-picker.investigation.json`
(committed alongside this update). Sandbox: **XMC project's CM env**
(`xmc-lizsitecore798d-xmc25db-yourfirstxmdb85`, org_Sqg9NOB4DhDdpb1x).
The operator-supplied tenant slug `xmc-lizsitecore088b-...` does not
exist in this org's environments list anymore (verified by paginating
xmclouddeploy-api); substituted the XMC env because it already carries
**three production tenant-rooted Solution templates + tenant-rooted
`HeadlessSiteSetupRoot` modules** under the `click-click-launch`
Project tenant — the exact pattern A needs to verify.

Token mint: succeeds at audience `https://api.sitecorecloud.io` with
scope `xmcloud.cm:admin` (+ org-level `xmclouddeploy.*`). Authoring
GraphQL works fine; **xmapps-api Sites API returns 401** because this
client is org-scoped, not env-scoped — so live Sites-API picker
instantiation was NOT exercised in this run.

**U1. "Foundation Module template" is a misnomer.** There is no single
"Foundation Module" template. SXA splits Module roots in two:

- `SITE_MODULES` entries → conform to template `HeadlessSiteSetupRoot`
  (GUID `bed31d6f-d968-45a9-b54e-12d7f977d861`).
- `TENANT_MODULES` entries → conform to `HeadlessTenantSetupRoot`
  (GUID `f036b5e0-37fb-4537-9d36-ef84e5bd41b7`).

Both templates carry **only standard Sitecore sections** (Advanced,
Appearance, Help, etc.); no domain-specific fields. The brand
structure lives in the Module item's **children** — instances of
`AddItem`, `EditSiteItem`, `EditTenantTemplate`, `ExecuteScript`,
`PostSetupStep`, `Folder`, `Node`. Each setup-action child carries its
own field set describing the operation to perform during createSite.

**U2. SITE_MODULES vs TENANT_MODULES on the only built-in.** "Empty
Site" carries 15 SITE_MODULES (per-site setup actions: Redirects,
SiteMetadata, Headless Variants, Multisite, PlaceholderSettings,
PresentationSettings, etc.) and 11 TENANT_MODULES (per-collection
setup: Error Handling, Navigation, Security, etc.). All built-in
module items live under SXA Foundation/Feature paths, NOT under a
single "Scaffolding/Modules" folder. **Three tenant-rooted Solution
templates (Alaris, SYNC, Solterra and Co) at `/sitecore/system/Settings/
Project/click-click-launch/Templates/` mirror the built-in module
list AND append a single tenant-rooted `HeadlessSiteSetupRoot` GUID
as the last entry.** That last entry is the tenant's own brand-setup
module under `/sitecore/system/Settings/Project/click-click-launch/`.

**U3. Thumbnail / image storage = standard `__Thumbnail` field.** No
dedicated thumbnail/image field on the SXA Solution template
inheritance chain (no `_SolutionTemplateThumbnail`). The Sites API
picker's `thumbnail` and `image` map to the standard Sitecore
**`__Thumbnail` field** (GUID `c7c26117-dbb1-42b2-ab5e-f7223845cca3`,
type `Thumbnail`). Encoding is **Sitecore media-XML**:
`<image mediaid="{GUID}" />`. Confirmed by the three tenant-rooted
Solution templates, each of which has `__Thumbnail` populated with a
media-XML reference to a media library item. There is no separate
source field for `image` — the Sites API likely renders the same
media item at a larger size (or returns null).

> **Implication for C (revised).** The schema's `thumbnail` / `image`
> discriminated union is fine, but the `kind: "url"` path can't write
> directly to `__Thumbnail` — that field expects media-XML, not a URL.
> Compile needs to either (a) upload the URL's referent to the media
> library and write the resulting media-XML, OR (b) restrict
> `kind: "url"` to a different SXA-aware destination (e.g., write
> nothing to `__Thumbnail` and rely on Standard Sitecore icon
> fallback), OR (c) accept a `__Thumbnail` value pre-shaped as media-
> XML and document the constraint. Discuss with operator before C
> lands — the decision changes whether `kind: "url"` is genuinely the
> "cheap path."

**U4. `contents` source field + encoding.** Source is the SXA `Content`
field (GUID `da855368-e5f2-4932-ae55-7f8b08a5a205`, type Multi-Line
Text). Encoding is a JSON-serialized array `[{"name": "Pages",
"content": "Home, ..."}, {"name": "Components", "content": "..."}]`.
The Sites API picker decodes this to `StringStringKeyValuePair[]`
where `key = name`, `value = content`. Compile just stringifies the
authored array.

**U5. No wrapper layer between Site Template and Module.**
SITE_MODULES + TENANT_MODULES refs point at Module items **directly**
(by GUID). No intervening Tenant-Module wrapper template. Parent
chain confirms: tenant-rooted Module sits under
`/sitecore/system/Settings/Project/<tenant>/<Module Name>` with a
`Folder`/`Settings Folder` parent — no SXA-specific wrapper.

**U6. `metadata` carries only `builtInTemplate`.** Sourced from the
SXA `Built-in template` checkbox (GUID `a13aae24-a295-4cc3-b188-
dfa59e2172a9`). On tenant-authored templates this is empty (= false);
on the Foundation-rooted Empty Site it is "1" (= true). No other
metadata pairs observed in the item field set. The Sites API
`metadata` map likely contains additional pairs only when the source
items have additional fields scai's introspection didn't surface —
unverified directly (Sites API token missing), but no field-level
candidates remain on the inspected items.

**Picker-resolution verification verdict: tenant-rooted-confirmed.**
Live Sites-API instantiation not exercised (env-scoped token absent).
But three production tenant-rooted Solution templates already
reference tenant-rooted `HeadlessSiteSetupRoot` modules in their
`Site Modules` Treelist. The Treelist `source` on `Site Modules` is
`/sitecore/system/Settings` — a parent that includes both
`Foundation/...` and `Project/<tenant>/...`, so picker scope allows
cross-tree references. Surviving production pattern is strong evidence
the picker resolves them correctly. **Design D under the assumption
tenant rooting works.** If a future Sub-milestone E run sees the picker
silently drop tenant-rooted modules, the fallback (Foundation rooting)
remains available; nothing here forecloses it.

**Surprises that change C/D/E:**

1. **C must rethink `kind: "url"`.** `__Thumbnail` does not accept a
   raw URL. The cheap-path-vs-asset-path distinction is more nuanced
   than the locked operator decision implied. Either upload to media
   library on both paths, or accept media-XML in `kind: "url"` and
   rename the discriminator (`mediaXml` / `assetUpload`?), or
   redefine `kind: "url"` to write the URL to a brand-new SXA field
   only scai-authored templates use.
2. **D's `ModuleRecipe` IR must emit setup-action CHILDREN** — not
   just a Module root item. The brand structure lives in the
   children, not on the Module root. Compile output per tenant-rooted
   Module: one `HeadlessSiteSetupRoot` parent + N children (AddItem,
   ExecuteScript, PostSetupStep, etc.) keyed off the recipe's
   `pageTemplates` / `pageDesigns` / `insertOptionsMatrix` arrays.
3. **D's Foundation-rooted module list is constant infrastructure**,
   not authored content. Every tenant-rooted Solution template copies
   the 15 Foundation-rooted SITE_MODULES + 11 TENANT_MODULES verbatim,
   THEN appends the tenant's own `HeadlessSiteSetupRoot` GUID. Compile
   should hardcode the Foundation GUIDs (or read them lazily from the
   tenant once per IR resolve) and append the synthesized tenant-
   rooted Module's GUID.
4. **E's Sites-API assertion is unchanged** but the env-scoped token
   path needs operator setup (`scai setup login`) before this works
   on the test tenant.

## The two gaps

| Gap                                                                                                                                                                                                                                                                                                                                     | Symptom in product                                                                                                                                    | Evidence                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **G1. Module composition is dropped.** Recipe schema fields `pageTemplates`, `pageDesigns`, `insertOptionsMatrix`, `templatesToDesigns`, `dictionary`, `taxonomy` never reach Sitecore. SXA expects a `Site Modules` + `Tenant Modules` field on the Solution-template item pointing at MODULE items; modules hold the brand structure. | Operator picks the brand template in Create-a-Site; the resulting site has no page templates, no page designs, no insert-options matrix. Empty shell. | `src/recipe/compile/site-template.ts:143-156` TODO; `src/recipe/schema/recipe.ts:1537-1589` (schema lists the dropped arrays); `src/recipe/ir/sitecore-templates.ts:461-469` (`SITE_MODULES`, `TENANT_MODULES` GUIDs captured but unwritten). |
| **G2. Picker-tile fields not emitted.** Sites API `SiteTemplate` response declares `thumbnail`, `image`, `contents`, `metadata`; recipe schema declares none and compile writes none (only Name / Description / Enabled / Built-in).                                                                                                    | Brand tile in the picker shows blank thumbnail + blank preview pane.                                                                                  | `src/sites/api/schema.d.ts:2143-2205` (Sites API contract); `src/recipe/compile/site-template.ts:84-141` (compile output omits picker fields); `src/recipe/ir/sitecore-templates.ts:456-459` (`CONTENT` GUID captured but unused).            |

Quoting the existing TODO in `compile/site-template.ts:143-156` (load-bearing for cold-pickup):

> Module resolution. SXA stores brand structure in MODULES, not directly
> on the Solution template. recipe.pageTemplates, recipe.pageDesigns,
> recipe.insertOptionsMatrix, recipe.templatesToDesigns map to module
> composition that this compiler doesn't yet model. Site Modules +
> Tenant Modules SetFields would carry pipe-separated module-item GUIDs
> once the schema gains a module-references field (or a separate
> ModuleRecipe kind that the compiler can resolve to GUIDs).

## Investigation needed before code work begins

Concrete unknowns. None of these is answerable without sandbox
introspection against `xmc-lizsitecore088b-starterkitsa33f-contentatte7784`.

| Unknown                                                                    | What to verify                                                                                                                                                                                                                                                                                    | How                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **U1. Foundation Module template GUID + fields.**                          | Template ID + every field carrying refs to page templates / page designs / partial designs / insert-options / dictionary / taxonomy.                                                                                                                                                              | Authoring `__type` introspection + read `/sitecore/system/Settings/Foundation/JSS Experience Accelerator/Scaffolding/Modules/*`. Pattern: `scripts/introspect-create-item.cjs`.                                             |
| **U2. How built-in templates populate `SITE_MODULES` / `TENANT_MODULES`.** | What GUIDs sit in those pipe-separated lists on `Basic` / `Empty Site`; what each referenced item conforms to; per-tenant copy vs. shared Foundation Module.                                                                                                                                      | Read built-ins under `Scaffolding/Templates/`, dump both field values, follow each GUID and capture template + path + children. JSON capture committed to `docs/plans/site-template-modules-and-picker.investigation.json`. |
| **U3. `thumbnail` / `image` storage format.**                              | Sites API returns URLs (`schema.d.ts:2186-2195`); unknown whether the source field stores a URL, a media-library XML ref, or a media item GUID the API resolves.                                                                                                                                  | `GET /api/v1/site-templates` for a built-in, capture both values; in parallel read the underlying Solution-template item and identify the source field.                                                                     |
| **U4. `contents` shape on the picker.**                                    | Typed as `StringStringKeyValuePair[]` (`schema.d.ts:2170` + `:2304-2307`). Confirm which Solution-template field is the source (likely `CONTENT` = `da855368-…` per `sitecore-templates.ts:468`) and the encoding (JSON blob? key=value lines?).                                                  | Diff built-in `CONTENT` field value against the API's `contents` payload.                                                                                                                                                   |
| **U5. Wrapper items between SiteTemplate and Foundation Modules.**         | Whether `SITE_MODULES` refs point at Foundation Modules directly, or at a per-tenant `Tenant Module` / `Solution Template` wrapper. JSDoc at `compile/site-template.ts:32-37` hints `Solution template` is the SiteTemplate's own template, not a wrapper — but unverified for the modules layer. | Capture the parent chain of every `SITE_MODULES` ref from U2.                                                                                                                                                               |
| **U6. Metadata field map.**                                                | Sites API `metadata` (`schema.d.ts:2197-2204`) returns `{ builtInTemplate: "true" }` on a built-in. Confirm it's the existing `BUILT_IN_TEMPLATE` surfaced under a different key, or carries additional pairs.                                                                                    | Diff built-in vs. operator-authored `metadata` payloads.                                                                                                                                                                    |

The introspection step is Sub-milestone A — it produces a JSON capture
that B/C/D consume. No schema or compile change should land until A's
output is committed (under `docs/plans/`, not under `src/`).

## Proposed `ModuleRecipe` schema (sketch — final shape pending A)

```ts
export const ModuleRecipeSchema = z.object({
  kind: z.literal("module"),
  schemaVersion: z.literal("1"),
  handle: z.string().regex(HANDLE_PATTERN), // e.g. "ccl-brand-pages@1"
  name: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().optional(),
  icon: z.string().optional(),
  // Fields below depend on U1 — placeholders, expected to be replaced
  // 1:1 with the real Foundation Module field set:
  pageTemplates:        z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  pageDesigns:          z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  partialDesigns:       z.array(z.string().regex(HANDLE_PATTERN)).default([]),
  templatesToDesigns:   z.record(...).optional(),
  insertOptionsMatrix:  z.record(...).optional(),
  dictionaryRoot:       z.string().optional(),
  taxonomyRoots:        z.array(SiteTemplateTaxonomyEntrySchema).optional(),
});
```

`SiteTemplateRecipe` then either:

- **Option A — modules as first-class recipes.** Gains `modules: z.array(handle).default([])`; drops the six currently-dropped fields. Author lists module handles.
- **Option B — passthrough.** Keeps the six fields on `SiteTemplateRecipe`; compiler synthesises one anonymous `ModuleRecipe` per template. Flat author surface.

**Open design question — settled by A.** If Foundation Modules are 1:1 with what we already call "site template," Option B is fine. If real brand templates routinely compose 3+ modules (header / body / footer / integration), Option A is correct.

## Proposed `compileSiteTemplateRecipe` changes (high-level)

1. **Picker fields (G2).** Add `thumbnail?` / `image?` / `contents?: Array<{key,value}>` to the schema. Compile writes each onto the Solution-template item — `SITE_TEMPLATE_FIELDS.CONTENT` (`da855368-…`) plus thumbnail/image field GUIDs from U3. Encoding (URL vs media XML) follows U3.
2. **Module composition (G1).** Resolve `pageTemplates` / `pageDesigns` / `insertOptionsMatrix` / `templatesToDesigns` / `dictionary` / `taxonomy` to module-item GUIDs; write the pipe-separated list to `SITE_TEMPLATE_FIELDS.SITE_MODULES` (and/or `TENANT_MODULES`, per U2). Option A emits separate `ModuleRecipe` IRs; Option B creates the Module item inline in the site-template IR.
3. **Dictionary + taxonomy.** Currently dropped on the assumption they're per-site. Re-verify under U1 — if Foundation Module carries those, this compile owns them.
4. **Metadata + built-in flag.** No change to `BUILT_IN_TEMPLATE = "0"` unless U6 surfaces additional metadata pairs.

## Integration-test additions

Extend `tests/integration/recipe/site-multi-brand.integration.test.ts` (or add a sibling `site-template-picker.integration.test.ts` if the existing file gets unwieldy):

| Assertion                                           | What it checks                                                                                                                                                              | How                                                                                                                                                                             |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Picker fields populated                             | `GET /api/v1/site-templates` for the tenant returns the just-pushed template with non-null `thumbnail`, `image`, `contents` (length ≥ 1), `description`.                    | `sitesClient.listSiteTemplates()` (add to `sites-client.ts` if missing); filter by `name === ccl.name`; assert each field.                                                      |
| Site instantiation produces module-driven structure | Pushing `solterra-co@1` (which references `ccl-brand-template@1`) yields a site whose page-templates folder is non-empty and matches the recipe's declared `pageTemplates`. | After `executeIr` of the site recipe, read `/sitecore/content/<collection>/<site>/Page Templates` via Authoring; assert children count matches recipe's `pageTemplates.length`. |
| Module-subtree cleanup                              | `afterAll` removes Module items created under the site-templates root, not just the Sites API sites.                                                                        | Extend the current `createdSiteIds`-driven cleanup with a `createdModuleItemIds` companion and delete via Authoring `deleteItem`.                                               |
| Idempotency unchanged                               | Existing second-push assertions (lines 183-209) still report 0 creates / 0 updates after schema + compile changes.                                                          | No new code, but the new compile output must not break this. Treat as a regression gate.                                                                                        |

## Sub-milestones

| ID                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Scope | Sessions (≈2h each) | Blocks on |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- | ------------------- | --------- |
| **A. Sandbox introspection.** Run cjs introspection scripts (pattern of `scripts/introspect-create-item.cjs`): dump Foundation Module template + fields, read 2–3 built-ins' `SITE_MODULES`, follow refs, capture `thumbnail`/`image`/`contents` storage, diff `metadata`. Commit JSON to `docs/plans/site-template-modules-and-picker.investigation.json`. Append a 1-page summary at the top of this plan resolving U1–U6 and the Option-A-vs-B call. | 1     | —                   |
| **B. `ModuleRecipe` schema + cross-recipe validator.** New kind in `src/recipe/schema/recipe.ts`; `validateRecipeSet` resolves module handles. Unit tests for parse + validation.                                                                                                                                                                                                                                                                       | 1     | A                   |
| **C. Picker-field schema + compile + unit tests.** Add `thumbnail` / `image` / `contents` to `SiteTemplateRecipeSchema`; emit SetField ops. Unit tests for IR shape.                                                                                                                                                                                                                                                                                    | 1     | A                   |
| **D. Module-composition compile + unit tests.** Emit Module item(s) per A's Option A/B verdict; populate `SITE_MODULES` / `TENANT_MODULES`; wire dictionary + taxonomy. Unit tests.                                                                                                                                                                                                                                                                     | 1–2   | A, B                |
| **E. Integration test against sandbox.** Extend `site-multi-brand.integration.test.ts` with the four assertions above; add module-cleanup teardown; iterate live.                                                                                                                                                                                                                                                                                       | 1     | A–D                 |

Honest total: **5–6 sessions** if A produces clean answers. Add 1 session if U2/U5 surface a wrapper layer this plan didn't anticipate.

## Operator decisions (locked 2026-06-06)

The three open questions were resolved before sub-milestone A begins. Sub-milestone A's introspection scope is narrowed accordingly — it now verifies these calls hold against the sandbox rather than picking between options.

### 1. ModuleRecipe — passthrough, not first-class (Option B)

Compiler synthesises Module items inline from the `SiteTemplateRecipe`'s existing `pageTemplates` / `pageDesigns` / `insertOptionsMatrix` / `templatesToDesigns` / `dictionary` / `taxonomy` arrays. No new `ModuleRecipe` schema kind, no separate authoring surface. Module items are an SXA wire-level implementation detail, not a meaningful product abstraction — authors think "this template offers these page types and designs," not "this template includes a 'Marketing Module' which itself includes those types and designs."

**Implication for D:** ignore the Option-A scaffolding in `ModuleRecipe schema (sketch)` above — that section becomes "Module item IR shape, synthesised by `compileSiteTemplateRecipe`." If A surfaces evidence Modules genuinely need cross-template reuse (e.g., XM Cloud built-ins share Modules between Starter Kits), revisit — but YAGNI until then.

### 2. Thumbnail authoring source — support both as a discriminated union

Schema models both modes from day one, scai implements URL first then asset:

```ts
thumbnail:
  | { kind: "url", url: string, alt?: string }       // operator hosts (CDN / GitHub raw / S3)
  | { kind: "asset", path: string, alt?: string }    // registry-relative path; new media-upload IR op
```

Apply the same shape to `image`. `url` is the cheap v1 path — one SetField op writes the URL directly to the picker field, no new IR. `asset` is the polish path — adds a media-upload IR op that lands the file in Sitecore's media library and writes the resolved media-item GUID. The brand-generation pipeline picks per-template based on whether the image is hosted externally or repo-bundled.

**Implication for C:** schema lands with the discriminated union; compile handles `kind: "url"` end-to-end. `kind: "asset"` is allowed by schema but throws an explicit `NOT_YET_IMPLEMENTED` error at compile time until the media-upload IR op lands (deferred follow-up, NOT blocking E).

### 3. Module item placement — tenant-rooted, verify in A

Modules land under the tenant tree (`/sitecore/system/Settings/Project/<tenant>/Modules/<Module>`), NOT under Foundation. Consistent with how scai already roots `templatesRoot`, `partialDesignsRoot`, `pageDesignsRoot`, and (in practice) `siteTemplatesRoot`. Multi-tenant sandboxes stay clean, template deletion cleanly removes its Modules, no cross-tenant Module leakage.

**Sharpened sub-milestone A focus** — picker resolution in Sitecore is template-inheritance-based, not path-based. A's introspection should verify that hypothesis explicitly:

1. Read a built-in Starter Kit's `SITE_MODULES` field; dump the template inheritance chain of each referenced Module item (`__Base template` ancestors).
2. Identify the template that defines "this item is a Module the picker resolves" — probably one specific template ID in the Foundation Modules tree.
3. Create a test Module conforming to that same template **at a tenant-rooted path** (`/sitecore/system/Settings/Project/<sandbox-tenant>/Modules/test-module`).
4. Reference it from a test SiteTemplate's `SITE_MODULES`.
5. Instantiate via the Sites API picker and assert the resulting site picks up the tenant-rooted Module's contributions correctly.

If step 5 succeeds → tenant-rooted is confirmed safe; proceed with D under this assumption. If the picker silently drops the tenant-rooted Module despite template-correctness → fall back to Foundation-rooted, document the failure mode in the resolved-U section, and update the plan. Either way, the decision is data-driven by A's evidence.

### What's still open

Six investigation-only unknowns remain (`U1`–`U6` above). None require operator input — they're answered by reading the sandbox. The plan is ready for a fresh scai session to pick up Sub-milestone A; no further operator gate before code work starts.
