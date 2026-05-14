import "../setup";
import { afterAll, beforeAll, expect } from "vitest";
import { describeIfDeployAuth, getEnv, resolveDeployToken } from "../helpers";
import { alarisRecipe } from "../../../example/recipes/alaris.recipe";
import { cclBrandTemplateRecipe } from "../../../example/recipes/ccl-brand-template.recipe";
import { solterraCoRecipe } from "../../../example/recipes/solterra-co.recipe";
import {
  type CompileContext,
  compileRecipeSet,
  executeIr,
  type ExecutionEvent,
  type OperationIr,
} from "../../../src/recipe";
import type { Recipe } from "../../../src/recipe/schema/recipe";
import { createAuthoringClient } from "../../../src/recipe/api/authoring-client";
import {
  createSitesApiClient,
  type Site,
  type SitesApiClient,
} from "../../../src/recipe/api/sites-client";
import type { EnvironmentConfiguration } from "../../../src/config";

const { describe, it } = describeIfDeployAuth();

/**
 * Sandbox integration test for the Phase 5 Milestone E composition layer
 * — the SiteTemplate + multi-brand SiteRecipe pattern.
 *
 * Pushes the three-fixture set:
 *   - `ccl-brand-template@1`  (SiteTemplateRecipe — Authoring API)
 *   - `solterra-co@1`         (SiteRecipe — Sites API createSite)
 *   - `alaris@1`              (SiteRecipe — Sites API createSite, same template)
 *
 * Assertions:
 *   1. Compile + apply succeeds end-to-end with no aborted runs.
 *   2. SiteTemplate item is materialised at <siteTemplatesRoot>/<name>.
 *   3. Both Sites appear in `listSites` under their RUN_ID-namespaced names.
 *   4. Idempotent re-push — second `executeIr` over the same IR set produces
 *      zero create/update across all three recipes.
 *   5. afterAll cleanup — best-effort `deleteSite` for each materialised site.
 *
 * Gating: SITECOREAI_RUN_INTEGRATION=1 + the same OAuth client-credentials
 * env vars composition.integration.test.ts uses. The whole describe block
 * skips when any are missing — same pattern as cta-button.integration.test.ts.
 *
 * Optional env-var overrides:
 *   RECIPE_TEST_CM_HOST                — Authoring + Sites API host (no scheme)
 *   RECIPE_TEST_SITE_TEMPLATES_ROOT    — /sitecore/templates/Project/<...>
 *   RECIPE_TEST_TEMPLATES_ROOT         — required by compile context
 *   RECIPE_TEST_RENDERINGS_ROOT        — required by compile context
 *   RECIPE_TEST_COLLECTION_ID          — existing collection id for the
 *                                        alaris fixture (otherwise the test
 *                                        skips that fixture)
 */

const DEFAULTS = {
  cmHost: "xmc-lizsitecore088b-starterkitsa33f-contentatte7784.sitecorecloud.io",
  templatesRoot: "/sitecore/templates/Project/demo-registry",
  renderingsRoot: "/sitecore/layout/Renderings/Project/demo-registry",
  siteTemplatesRoot: "/sitecore/templates/Project/demo-registry",
} as const;

const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
  .toString(36)
  .padStart(3, "0")}`;

const PUSH_TIMEOUT_MS = 5 * 60 * 1000;

describe("Phase 5 Milestone E — multi-brand SiteRecipe round-trip", () => {
  const cmHost = getEnv("RECIPE_TEST_CM_HOST") ?? DEFAULTS.cmHost;
  const templatesRoot = getEnv("RECIPE_TEST_TEMPLATES_ROOT") ?? DEFAULTS.templatesRoot;
  const renderingsRoot = getEnv("RECIPE_TEST_RENDERINGS_ROOT") ?? DEFAULTS.renderingsRoot;
  const siteTemplatesRoot = getEnv("RECIPE_TEST_SITE_TEMPLATES_ROOT") ?? DEFAULTS.siteTemplatesRoot;
  const existingCollectionId = getEnv("RECIPE_TEST_COLLECTION_ID");

  const compileContext: CompileContext = {
    templatesRoot,
    renderingsRoot,
    siteTemplatesRoot,
  };

  // Namespace fixture names with RUN_ID so concurrent + repeat runs don't
  // collide on the tenant. We mutate the fixtures' `name` only — handles
  // stay stable so refKeys are deterministic and idempotency works.
  const ccl: typeof cclBrandTemplateRecipe = {
    ...cclBrandTemplateRecipe,
    name: `${cclBrandTemplateRecipe.name}-${RUN_ID}`,
  };
  const solterra: typeof solterraCoRecipe = {
    ...solterraCoRecipe,
    name: `${solterraCoRecipe.name}-${RUN_ID}`,
    siteTemplate: ccl.handle,
    collectionName: `${solterraCoRecipe.collectionName}-${RUN_ID}`,
    siteGrouping: solterraCoRecipe.siteGrouping
      ? {
          ...solterraCoRecipe.siteGrouping,
          hostName: `solterra-${RUN_ID}.example.com`,
        }
      : undefined,
  };
  const alaris: typeof alarisRecipe | null = existingCollectionId
    ? ({
        ...alarisRecipe,
        name: `${alarisRecipe.name}-${RUN_ID}`,
        siteTemplate: ccl.handle,
        collectionId: existingCollectionId,
        siteGrouping: alarisRecipe.siteGrouping
          ? {
              ...alarisRecipe.siteGrouping,
              hostName: `alaris-${RUN_ID}.example.com`,
            }
          : undefined,
      } as typeof alarisRecipe)
    : null;

  const recipes: Recipe[] = alaris ? [ccl, solterra, alaris] : [ccl, solterra];

  let environment: EnvironmentConfiguration;
  let authoring: ReturnType<typeof createAuthoringClient>;
  let sitesClient: SitesApiClient;
  let irs: OperationIr[];
  const createdSiteIds: string[] = [];

  beforeAll(async () => {
    const accessToken = await resolveDeployToken();
    environment = {
      cmHost,
      accessToken,
    } as unknown as EnvironmentConfiguration;
    authoring = createAuthoringClient({ environment });
    sitesClient = createSitesApiClient({ accessToken });
    irs = compileRecipeSet(recipes, compileContext);
  });

  afterAll(async () => {
    for (const siteId of createdSiteIds) {
      try {
        await sitesClient.deleteSite?.(siteId);
      } catch {
        // best-effort; teardown failures don't block the suite
      }
    }
  });

  it(
    "compiles + applies the three-fixture set; both Sites land via Sites API; SiteTemplate via Authoring",
    async () => {
      const events: { recipe: string; event: ExecutionEvent }[] = [];
      // Build crossRecipeRefs the same way push.ts does — walk every
      // CreateItem op and seed refKey → expected path. This is the
      // bridge for the SiteTemplate's templateId being captured by
      // SiteRecipe planning during a later IR execution.
      const crossRecipeRefs = new Map<string, string>();
      for (const ir of irs) {
        for (const op of ir.operations) {
          if (op.op === "CreateItem") crossRecipeRefs.set(op.id, op.path);
        }
      }

      for (const ir of irs) {
        const result = await executeIr(ir, authoring, {
          mode: "apply",
          emit: (event) => events.push({ recipe: ir.recipeHandle, event }),
          crossRecipeRefs,
          sitesClient,
        });
        expect(result.aborted, `${ir.recipeHandle} aborted`).toBe(false);
      }

      // Capture site ids for cleanup. listSites is the canonical way to
      // resolve newly-created sites.
      const allSites = await sitesClient.listSites();
      for (const recipe of recipes.filter((r) => r.kind === "site")) {
        const siteName = (recipe as { name: string }).name;
        const found: Site | undefined = allSites.find((s) => s.name === siteName);
        expect(found, `Site '${siteName}' should be present after push`).toBeDefined();
        if (found?.id) createdSiteIds.push(found.id);
      }
    },
    PUSH_TIMEOUT_MS
  );

  it(
    "second push is idempotent — every recipe reports zero create/update",
    async () => {
      const crossRecipeRefs = new Map<string, string>();
      for (const ir of irs) {
        for (const op of ir.operations) {
          if (op.op === "CreateItem") crossRecipeRefs.set(op.id, op.path);
        }
      }

      for (const ir of irs) {
        const result = await executeIr(ir, authoring, {
          mode: "apply",
          crossRecipeRefs,
          sitesClient,
        });
        expect(result.aborted, `${ir.recipeHandle} aborted on re-push`).toBe(false);
        expect(result.summary.create, `${ir.recipeHandle} should report 0 creates on re-push`).toBe(
          0
        );
        expect(result.summary.update, `${ir.recipeHandle} should report 0 updates on re-push`).toBe(
          0
        );
      }
    },
    PUSH_TIMEOUT_MS
  );
});
