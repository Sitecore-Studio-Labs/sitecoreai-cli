import { afterAll, beforeAll, expect } from "vitest";
import "../setup";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "../helpers";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import {
  type CompileContext,
  type ContentItemRecipe,
  type PageDesignRecipe,
  type PartialDesignRecipe,
  PAGE_DESIGNS_ROOT_REF_KEY,
  COMPOSITION_FIELDS,
  DEFAULT_DEVICE_ID,
  LAYOUT_FIELDS,
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
  compileRecipeSet,
  contentItemId,
  emitLayoutXml,
  encodeTemplatesMapping,
  executeIr,
  pageDesignId,
  renderingId,
  templateId,
  type ExecutionEvent,
  type OperationIr,
} from "../../../src/recipe";
import { createAuthoringClient } from "../../../src/recipe/api/authoring-client";
import type { AuthoringApiClient, RemoteItem } from "../../../src/recipe/api/client";
import { buildPhase4Fixtures, type Phase4FixtureSet } from "./fixtures/phase-4";

const { describe, it } = describeIfDeployAuth();

/**
 * Sandbox integration test for the Phase 4 composition layer.
 *
 * Exercises a complete partial-design + page-design recipe set against the
 * SitecoreAI sandbox tenant — the same tenant the smoke at
 * `/tmp/phase4-smoke.mjs` validated. Six numbered assertions, per the
 * milestone-F plan:
 *
 *   1. Push the complete recipe set (compileRecipeSet → executeIr).
 *   2. Verify each PartialDesignRecipe materialized correctly.
 *   3. Verify each PageDesignRecipe materialized correctly (PartialDesigns
 *      pipe-list, own __Renderings when authored).
 *   4. Verify Page Designs root TemplatesMapping aggregate.
 *   5. Idempotent re-push — zero create/update on second apply.
 *   6. Cleanup on teardown — best-effort delete of every created item.
 *
 * Gating: SITECOREAI_RUN_INTEGRATION=1 + OAuth credentials. CI must opt
 * in explicitly — same pattern as cta-button.integration.test.ts.
 *
 * Optional env-var overrides (otherwise defaults to the demo-registry
 * tenant the local-dev skill documents):
 *   RECIPE_TEST_CM_HOST                — Authoring API host (no scheme).
 *   RECIPE_TEST_TEMPLATES_ROOT         — /sitecore/templates/...
 *   RECIPE_TEST_RENDERINGS_ROOT        — /sitecore/layout/Renderings/...
 *   RECIPE_TEST_PARTIAL_DESIGNS_ROOT   — Partial Designs container.
 *   RECIPE_TEST_PAGE_DESIGNS_ROOT      — Page Designs container.
 *   RECIPE_TEST_CONTENT_ITEMS_ROOT     — content-items container.
 */

const DEFAULTS = {
  cmHost: "xmc-lizsitecore088b-starterkitsa33f-contentatte7784.sitecorecloud.io",
  templatesRoot: "/sitecore/templates/Project/demo-registry",
  renderingsRoot: "/sitecore/layout/Renderings/Project/demo-registry",
  partialDesignsRoot:
    "/sitecore/content/demo-registry/content-modelling/Presentation/Partial Designs",
  pageDesignsRoot: "/sitecore/content/demo-registry/content-modelling/Presentation/Page Designs",
  contentItemsRoot: "/sitecore/content/demo-registry/content-modelling/Data",
} as const;

// Run identifier: timestamp + a random tail. Same pattern as cta-button —
// concurrent runs and stale items don't collide.
const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
  .toString(36)
  .padStart(3, "0")}`;

/**
 * Per-test timeout for the long-running push tests. Empirically a 166-op
 * push against the demo-registry tenant runs ~65 seconds end-to-end.
 * 4 minutes leaves headroom for transient network slowness, OAuth token
 * refresh, and the apply-then-update pass when items already exist
 * from a previous run.
 */
const PUSH_TIMEOUT_MS = 4 * 60 * 1000;
/**
 * Per-test timeout for the verify tests — they fan out a handful of
 * `getItem({ path })` calls per recipe (~3 partials, ~3 page designs,
 * each calling getItem once or twice). 60s is overkill, used for
 * safety on slow CI.
 */
const VERIFY_TIMEOUT_MS = 60 * 1000;
/**
 * Cleanup-deletes are best-effort but can be slow when many leftover
 * items need cascade deletion. Generous budget for afterAll.
 */
const CLEANUP_TIMEOUT_MS = 5 * 60 * 1000;

const joinPath = (parent: string, name: string): string => `${parent.replace(/\/$/, "")}/${name}`;

/** Match Sitecore-returned dashless GUIDs against recipe-derived hyphenated GUIDs. */
const normalizeGuid = (g: string): string => g.toLowerCase().replace(/[{}-]/g, "");

const pickField = (item: RemoteItem, fieldGuid: string) => {
  const target = normalizeGuid(fieldGuid);
  return item.fields.find((f) => normalizeGuid(f.fieldId) === target);
};

/**
 * Compute the canonical layout XML scai's compiler writes for a
 * `PageDesignRecipe`. Page-design `__Renderings` writes round-trip
 * byte-for-byte (Sitecore stores them as-written for the SXA Page Design
 * template), so this is usable for byte-equality assertions.
 *
 * The partial-design counterpart of this helper would round-trip
 * differently — Sitecore's Layout pipeline rewrites partial-design
 * `__Renderings` writes into delta form. See test 2 below for the
 * substring-containment workaround that holds regardless of encoding.
 */
const expectedPageDesignLayout = (recipe: PageDesignRecipe): string => {
  if (!recipe.layout) return "";
  return emitLayoutXml(recipe.layout, {
    parentItemId: pageDesignId(recipe.handle),
    deviceId: DEFAULT_DEVICE_ID,
    renderingIdFor: renderingId,
    contentItemIdFor: contentItemId,
    allowScoped: false,
  });
};

interface RunOutcome {
  irs: OperationIr[];
  events: ExecutionEvent[];
  summary: { create: number; update: number; skip: number; error: number };
  aborted: boolean;
}

describe("recipe composition — sandbox round-trip", () => {
  let client: AuthoringApiClient;
  let context: CompileContext;
  let fixtures: Phase4FixtureSet;

  /**
   * Compile the fixture set and concatenate every IR's ops into one mega-IR
   * for executeIr (which takes a single IR). This matches the smoke-test
   * pattern at `/tmp/phase4-smoke.mjs`. The aggregate TemplatesMapping op
   * `compileRecipeSet` produces lands in the final synthetic IR — its
   * recipeHandle is `__templates-mapping__`.
   *
   * Also returns the per-recipe IR list so individual assertions can match
   * specific recipes' op counts / refKeys when needed.
   */
  const pushRecipeSet = async (label: string): Promise<RunOutcome> => {
    const irs = compileRecipeSet(fixtures.recipes, context);
    const combined: OperationIr = {
      schemaVersion: "1",
      recipeHandle: `__phase4-composition-${label}-${RUN_ID}__`,
      operations: irs.flatMap((ir) => ir.operations),
    };
    const events: ExecutionEvent[] = [];
    const crossRecipeRefs = new Map<string, string>();
    crossRecipeRefs.set(PAGE_DESIGNS_ROOT_REF_KEY, context.pageDesignsRoot!);

    const result = await executeIr(combined, client, {
      mode: "apply",
      emit: (e) => events.push(e),
      crossRecipeRefs,
    });

    if (result.aborted || result.summary.error > 0) {
      const failed = events.find((e) => e.kind === "failed");
      const applyError = events.find((e) => e.kind === "apply-error");
      const opErrors = events.filter((e) => e.kind === "op-error");
      console.error(`\n=== COMPOSITION ${label} FAILURE DIAGNOSTICS ===`);
      console.error("summary:", result.summary, "aborted:", result.aborted);
      if (failed) {
        console.error("failed:", JSON.stringify(failed, null, 2));
      }
      if (applyError) {
        console.error("apply-error:", JSON.stringify(applyError, null, 2));
      }
      if (opErrors.length > 0) {
        console.error(`op-errors (${opErrors.length}):`);
        for (const e of opErrors) {
          console.error(JSON.stringify(e, null, 2));
        }
      }
      console.error("=== END DIAGNOSTICS ===\n");
    }

    return { irs, events, summary: result.summary, aborted: result.aborted };
  };

  beforeAll(async () => {
    const accessToken = await resolveDeployToken();
    const cmHost = getEnv("RECIPE_TEST_CM_HOST") ?? DEFAULTS.cmHost;
    context = {
      templatesRoot: getEnv("RECIPE_TEST_TEMPLATES_ROOT") ?? DEFAULTS.templatesRoot,
      renderingsRoot: getEnv("RECIPE_TEST_RENDERINGS_ROOT") ?? DEFAULTS.renderingsRoot,
      partialDesignsRoot: getEnv("RECIPE_TEST_PARTIAL_DESIGNS_ROOT") ?? DEFAULTS.partialDesignsRoot,
      pageDesignsRoot: getEnv("RECIPE_TEST_PAGE_DESIGNS_ROOT") ?? DEFAULTS.pageDesignsRoot,
      contentItemsRoot: getEnv("RECIPE_TEST_CONTENT_ITEMS_ROOT") ?? DEFAULTS.contentItemsRoot,
    };

    const environment: EnvironmentConfiguration = {
      name: "recipe-composition-integration",
      host: cmHost,
      accessToken,
      cacheAuthenticationToken: false,
    };
    client = createAuthoringClient({ environment });
    fixtures = buildPhase4Fixtures(RUN_ID);
  });

  afterAll(async () => {
    if (!client || !fixtures || !context) return;
    // Cleanup runs even if tests failed — leaving 30+ items per failed
    // run on the tenant adds up fast.
    // Best-effort cleanup. Delete leaves first, then content items, then
    // templates and renderings — children before parents so server-side
    // cascade isn't required, though `permanently: true` in deleteItem
    // also handles cascade. Failures don't propagate; partial cleanup
    // beats no cleanup.
    const deleteOrder: { kind: string; path: string }[] = [];
    for (const r of fixtures.recipes) {
      switch (r.kind) {
        case "page-design":
          deleteOrder.push({
            kind: r.kind,
            path: joinPath(context.pageDesignsRoot!, r.name),
          });
          break;
        case "partial-design":
          deleteOrder.push({
            kind: r.kind,
            path: joinPath(context.partialDesignsRoot!, r.name),
          });
          break;
        case "content-item":
          deleteOrder.push({
            kind: r.kind,
            path: joinPath(context.contentItemsRoot!, r.name),
          });
          break;
        case "component-template":
          // Component templates also have a rendering item under
          // renderingsRoot — delete that first, then the template (which
          // also drops its sections, fields, standard-values via cascade).
          deleteOrder.push({
            kind: "rendering",
            path: joinPath(context.renderingsRoot!, r.name),
          });
          deleteOrder.push({ kind: r.kind, path: joinPath(context.templatesRoot!, r.name) });
          // Params template (only when params is non-empty).
          if (r.params.length > 0) {
            deleteOrder.push({
              kind: "params-template",
              path: joinPath(context.templatesRoot!, `${r.name} Parameters`),
            });
          }
          break;
        case "content-template":
          deleteOrder.push({ kind: r.kind, path: joinPath(context.templatesRoot!, r.name) });
          break;
      }
    }

    for (const { path } of deleteOrder) {
      try {
        const item = await client.getItem({ path });
        if (!item) continue;
        await client.deleteItem({ itemId: item.itemId });
      } catch {
        // ignore — best-effort cleanup
      }
    }
  }, CLEANUP_TIMEOUT_MS);

  /**
   * Test 1 — push the complete recipe set, expect at least one create.
   * Stores nothing; subsequent tests look up items by path on the tenant.
   *
   * Timeout sized for ~166 sequential GraphQL ops against a real CM —
   * empirical baseline ~65s on the demo-registry tenant. Leave headroom
   * for token refresh, transient DNS hiccups, etc.
   */
  it(
    "first push creates the complete recipe set",
    async () => {
      const outcome = await pushRecipeSet("first");
      expect(outcome.aborted).toBe(false);
      expect(outcome.summary.error).toBe(0);
      expect(outcome.summary.create).toBeGreaterThan(0);
    },
    PUSH_TIMEOUT_MS
  );

  /**
   * Test 2 — verify each PartialDesignRecipe item materialized with the
   * right template, layout, and __Display name.
   *
   * **Layout-XML assertion is by-content not by-bytes**, captured during
   * F.2.c. Sitecore's SXA Partial Design template normalizes incoming
   * `__Renderings` writes into a layout-deltas-encoded form. Our emitter
   * produces the canonical (`xmlns:xsd`, unprefixed `id`/`placeh`/`ds`)
   * form, but the read-back is the delta form (`xmlns:p`, `xmlns:s`,
   * `s:placeh`, `s:ds`, `s:id`, `p:before`/`p:after` anchors). See
   * orchestrator `plans/sitecore-relationships.md` (Phase 4 partial-design
   * layout-deltas section) for the full details and the Phase 5 fix path.
   *
   * Until the emitter learns delta form, we assert each placement's
   * rendering GUID and datasource GUID appear in the stored XML —
   * substring containment that holds regardless of the wrapping format.
   */
  it(
    "partial-design items materialize expected template, placements, and __Display name",
    async () => {
      const partials = fixtures.recipes.filter(
        (r): r is PartialDesignRecipe => r.kind === "partial-design"
      );
      expect(partials.length).toBeGreaterThan(0);

      for (const recipe of partials) {
        const path = joinPath(context.partialDesignsRoot!, recipe.name);
        const item = await client.getItem({ path });
        expect(item, `partial-design item missing at ${path}`).not.toBeNull();
        if (!item) continue;

        // Template GUID equality. Sitecore returns dashless lower-case;
        // recipe constants are hyphenated lower-case. Normalize both.
        expect(normalizeGuid(item.templateId)).toBe(
          normalizeGuid(SITECORE_TEMPLATES.PARTIAL_DESIGN)
        );

        const renderingsField = pickField(item, LAYOUT_FIELDS.RENDERINGS);
        expect(renderingsField, `${recipe.handle}: __Renderings not present`).not.toBeUndefined();
        const storedXml = renderingsField?.value ?? "";

        // Per-placement substring containment — agnostic to delta vs
        // canonical wrapping format. Each placement's renderingId and
        // (when shared) contentItemId must appear in the stored XML
        // (uppercase, dashed, curly-wrapped — the form Sitecore stores
        // GUIDs in regardless of layout encoding).
        for (const [placeholderKey, placements] of Object.entries(recipe.layout.placeholders)) {
          for (const placement of placements) {
            const renderingGuidCurly = `{${renderingId(placement.componentHandle).toUpperCase()}}`;
            expect(
              storedXml,
              `${recipe.handle} ${placeholderKey}: rendering '${placement.componentHandle}' GUID ${renderingGuidCurly} missing from stored layout`
            ).toContain(renderingGuidCurly);
            if (placement.datasourceRef?.kind === "shared") {
              const dsGuidCurly = `{${contentItemId(
                placement.datasourceRef.handle
              ).toUpperCase()}}`;
              expect(
                storedXml,
                `${recipe.handle} ${placeholderKey}: datasource '${placement.datasourceRef.handle}' GUID ${dsGuidCurly} missing from stored layout`
              ).toContain(dsGuidCurly);
            }
            expect(
              storedXml,
              `${recipe.handle} ${placeholderKey}: placeholder key missing from stored layout`
            ).toContain(placeholderKey);
          }
        }

        const displayNameField = pickField(item, SYSTEM_FIELDS.DISPLAY_NAME);
        expect(
          displayNameField,
          `${recipe.handle}: __Display name not present`
        ).not.toBeUndefined();
        expect(displayNameField?.value).toBe(recipe.displayName);
      }
    },
    VERIFY_TIMEOUT_MS
  );

  /**
   * Test 3 — verify each PageDesignRecipe item:
   *   - PARTIAL_DESIGN template GUID ✓
   *   - PartialDesigns field = pipe-separated curly-uppercase server-itemId
   *     list, in render order
   *   - __Renderings field = expected layout XML when the recipe has its
   *     own layout block
   */
  it(
    "page-design items match expected template + PartialDesigns + own __Renderings",
    async () => {
      const designs = fixtures.recipes.filter(
        (r): r is PageDesignRecipe => r.kind === "page-design"
      );
      expect(designs.length).toBeGreaterThan(0);

      for (const recipe of designs) {
        const path = joinPath(context.pageDesignsRoot!, recipe.name);
        const item = await client.getItem({ path });
        expect(item, `page-design item missing at ${path}`).not.toBeNull();
        if (!item) continue;

        expect(normalizeGuid(item.templateId)).toBe(normalizeGuid(SITECORE_TEMPLATES.PAGE_DESIGN));

        // PartialDesigns: resolve each linked partial's server-assigned
        // itemId by path, build the expected pipe-separated curly-upper
        // list, compare normalized.
        if (recipe.partials.length > 0) {
          const expectedPartialItemIds: string[] = [];
          for (const partialHandle of recipe.partials) {
            const partial = fixtures.recipes.find(
              (r) => r.kind === "partial-design" && r.handle === partialHandle
            );
            expect(partial, `partial recipe missing for handle ${partialHandle}`).toBeDefined();
            if (!partial) continue;
            const partialPath = joinPath(context.partialDesignsRoot!, partial.name);
            const partialItem = await client.getItem({ path: partialPath });
            expect(partialItem, `partial item missing at ${partialPath}`).not.toBeNull();
            if (partialItem) expectedPartialItemIds.push(partialItem.itemId);
          }

          const partialDesignsField = pickField(item, COMPOSITION_FIELDS.PARTIAL_DESIGNS);
          expect(
            partialDesignsField,
            `${recipe.handle}: PartialDesigns field not present`
          ).not.toBeUndefined();
          // Sitecore stores curly-uppercase GUIDs joined by `|`. Normalize
          // both sides — dashless, lowercase, no curlies — for comparison.
          const actualNormalized = (partialDesignsField?.value ?? "").split("|").map(normalizeGuid);
          const expectedNormalized = expectedPartialItemIds.map(normalizeGuid);
          expect(actualNormalized).toEqual(expectedNormalized);
        }

        // Own layout — only when the recipe authored a `layout` block.
        const expectedXml = expectedPageDesignLayout(recipe);
        if (expectedXml.length > 0) {
          const renderingsField = pickField(item, LAYOUT_FIELDS.RENDERINGS);
          expect(
            renderingsField,
            `${recipe.handle}: own __Renderings not present despite authored layout`
          ).not.toBeUndefined();
          expect(renderingsField?.value).toBe(expectedXml);
        }

        const displayNameField = pickField(item, SYSTEM_FIELDS.DISPLAY_NAME);
        expect(displayNameField?.value).toBe(recipe.displayName);
      }
    },
    VERIFY_TIMEOUT_MS
  );

  /**
   * Test 4 — Page Designs root carries the aggregated TemplatesMapping
   * URL-encoded property bag covering every (page template → page design)
   * entry in the fixture set.
   *
   * The existing field on the root almost certainly carries entries from
   * earlier runs (other agents' page designs, or this test's own prior
   * runs that didn't clean up). We assert *containment* — every expected
   * fragment is present in the field value — rather than full equality.
   */
  it(
    "Page Designs root TemplatesMapping contains every expected entry",
    async () => {
      const root = await client.getItem({ path: context.pageDesignsRoot! });
      expect(root, `Page Designs root not found at ${context.pageDesignsRoot}`).not.toBeNull();
      if (!root) return;

      const mappingField = pickField(root, COMPOSITION_FIELDS.TEMPLATES_MAPPING);
      expect(mappingField, "TemplatesMapping field not on Page Designs root").not.toBeUndefined();
      if (!mappingField) return;

      const designs = fixtures.recipes.filter(
        (r): r is PageDesignRecipe => r.kind === "page-design"
      );
      const entries: { templateGuid: string; designGuid: string }[] = [];
      for (const design of designs) {
        for (const tplHandle of design.appliesTo) {
          entries.push({
            templateGuid: templateId(tplHandle),
            designGuid: pageDesignId(design.handle),
          });
        }
      }
      // Same encoder the executor uses for the synthetic aggregate IR. Each
      // entry's URL-encoded fragment must appear verbatim in the field
      // value the tenant returned.
      const fragments = entries.map((entry) => encodeTemplatesMapping([entry]));
      for (const fragment of fragments) {
        expect(
          mappingField.value.includes(fragment),
          `expected fragment '${fragment}' missing from TemplatesMapping value`
        ).toBe(true);
      }
    },
    VERIFY_TIMEOUT_MS
  );

  /**
   * Test 5 — idempotent re-push (one-cycle convergence).
   *
   * Phase 5 fix: scai's `emitLayoutXml` now emits SXA delta form for
   * partial-design layouts (the wire shape Sitecore stores after its
   * first-write normalization). With both partial designs and page
   * designs producing the round-trip-canonical output, the second push
   * sees zero drift and skips every op.
   *
   * Asserts: second push is a full skip — zero create, zero update,
   * zero error, every op resolves to skip.
   */
  it(
    "re-push is fully idempotent — zero mutations on push 2",
    async () => {
      const second = await pushRecipeSet("second");

      console.log(`  second-push summary: ${JSON.stringify(second.summary)}`);
      expect(second.aborted).toBe(false);
      expect(second.summary.error).toBe(0);
      expect(second.summary.create).toBe(0);
      expect(second.summary.update).toBe(0);
      expect(second.summary.skip).toBeGreaterThan(0);
    },
    PUSH_TIMEOUT_MS
  );

  /**
   * Test 6 — partial-design that uses the `reference` content-item shape
   * (`primary-nav-content` → 3 nav-link content items) carries a
   * captured-itemId-resolved pipe-separated GUID list on its `Items`
   * field. This proves the executor's `ref-recipe-list` resolution path
   * lands real Sitecore IDs at apply time.
   */
  it(
    "primary-nav-content's Items reference field stores pipe-separated nav-link itemIds",
    async () => {
      const navListContentRecipe = fixtures.recipes.find(
        (r): r is ContentItemRecipe =>
          r.kind === "content-item" && r.handle === fixtures.handle("primaryNavContent")
      );
      expect(navListContentRecipe).toBeDefined();
      if (!navListContentRecipe) return;

      const path = joinPath(context.contentItemsRoot!, navListContentRecipe.name);
      const item = await client.getItem({ path });
      expect(item, `primary-nav-content item missing at ${path}`).not.toBeNull();
      if (!item) return;

      const itemsField = item.fields.find((f) => f.name === "Items");
      expect(itemsField, "Items field not on primary-nav-content item").not.toBeUndefined();
      if (!itemsField) return;

      // Resolve each referenced nav-link content item's server itemId by
      // path and compare against the pipe-separated value Sitecore returned.
      const itemsValue = itemsField.value;
      const linkHandles = ["navLinkProducts", "navLinkPricing", "navLinkDocs"] as const;
      const expectedItemIds: string[] = [];
      for (const key of linkHandles) {
        const linkItem = await client.getItem({
          path: joinPath(context.contentItemsRoot!, fixtures.name(key)),
        });
        expect(linkItem, `nav-link content item missing for ${key}`).not.toBeNull();
        if (linkItem) expectedItemIds.push(linkItem.itemId);
      }
      const actualNormalized = itemsValue.split("|").map(normalizeGuid);
      const expectedNormalized = expectedItemIds.map(normalizeGuid);
      expect(actualNormalized).toEqual(expectedNormalized);
    },
    VERIFY_TIMEOUT_MS
  );
});
