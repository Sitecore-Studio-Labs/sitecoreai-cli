import { describe, expect, it, vi } from "vitest";
import { alarisRecipe } from "../../../example/recipes/alaris.recipe";
import { solterraCoRecipe } from "../../../example/recipes/solterra-co.recipe";
import { compileSiteRecipe } from "../../../src/recipe/compile";
import type { CompileContext } from "../../../src/recipe/compile";
import { executeIr } from "../../../src/recipe/execute";
import { siteId, templateId } from "../../../src/recipe/guids";
import type {
  CreateSiteFromTemplateOp,
  Operation,
} from "../../../src/recipe/ir/operations";
import type { AuthoringApiClient } from "../../../src/recipe/api/client";
import type {
  Job,
  JobResponse,
  Language,
  NewSiteInput,
  Site,
  SiteCollection,
  SiteTemplate,
  SitesApiClient,
} from "../../../src/recipe/api/sites-client";

const COMPILE_CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  siteTemplatesRoot: "/sitecore/templates/Project/Demo",
};

/**
 * Stub Authoring API client — site-only IRs don't reach Authoring at
 * all. Throws on any unexpected call so a regression that adds
 * Authoring traffic to the site path surfaces loudly.
 */
const makeStubAuthoringClient = (): AuthoringApiClient => ({
  getItem: vi.fn(async () => null),
  getChildren: vi.fn(async () => []),
  createItem: vi.fn(async () => {
    throw new Error("Authoring createItem must not run for a site-only IR");
  }),
  updateItem: vi.fn(async () => {
    throw new Error("Authoring updateItem must not run for a site-only IR");
  }),
  deleteItem: vi.fn(async () => {
    throw new Error("Authoring deleteItem must not run for a site-only IR");
  }),
});

const makeStubSitesClient = (
  overrides: Partial<SitesApiClient> = {},
): SitesApiClient => ({
  createSite: vi.fn(async (_input: NewSiteInput): Promise<JobResponse> => ({
    handle: "job-1",
  } as JobResponse)),
  getJobStatus: vi.fn(async (_jobHandle: string): Promise<Job> => ({
    state: "Done",
  } as unknown as Job)),
  listSites: vi.fn(async (): Promise<Site[]> => []),
  listSiteTemplates: vi.fn(async (): Promise<SiteTemplate[]> => []),
  listCollections: vi.fn(async (): Promise<SiteCollection[]> => []),
  listLanguages: vi.fn(async (): Promise<Language[]> => []),
  addLanguage: vi.fn(async (_languageCode: string): Promise<Language> => ({
    languageCode: _languageCode,
  } as Language)),
  ...overrides,
});

describe("compileSiteRecipe", () => {
  it("emits a single CreateSiteFromTemplate op with the SiteTemplate handle resolved to its templateRefKey", () => {
    const ir = compileSiteRecipe(solterraCoRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe(solterraCoRecipe.handle);
    expect(ir.operations).toHaveLength(1);
    const op = ir.operations[0] as CreateSiteFromTemplateOp;
    expect(op.op).toBe("CreateSiteFromTemplate");
    expect(op.siteName).toBe(solterraCoRecipe.name);
    expect(op.language).toBe(solterraCoRecipe.language);
    expect(op.siteRefKey).toBe(siteId(solterraCoRecipe.handle));
    expect(op.templateRefKey).toBe(templateId(solterraCoRecipe.siteTemplate));
  });

  it("forwards collectionName when the recipe creates a new collection", () => {
    const ir = compileSiteRecipe(solterraCoRecipe, COMPILE_CONTEXT);
    const op = ir.operations[0] as CreateSiteFromTemplateOp;
    expect(op.collectionName).toBe(solterraCoRecipe.collectionName);
    expect(op.collectionId).toBeUndefined();
  });

  it("forwards collectionId when the recipe targets an existing collection", () => {
    const ir = compileSiteRecipe(alarisRecipe, COMPILE_CONTEXT);
    const op = ir.operations[0] as CreateSiteFromTemplateOp;
    expect(op.collectionId).toBe(alarisRecipe.collectionId);
    expect(op.collectionName).toBeUndefined();
  });

  it("rejects a SiteRecipe that specifies BOTH collectionId and collectionName", () => {
    const broken = {
      ...solterraCoRecipe,
      collectionId: "some-existing-collection-id",
    };
    expect(() => compileSiteRecipe(broken, COMPILE_CONTEXT)).toThrow(
      /must specify exactly one of collectionId \/ collectionName/,
    );
  });

  it("rejects a SiteRecipe that specifies NEITHER collectionId nor collectionName", () => {
    const { collectionName: _, collectionDisplayName: __, collectionDescription: ___, ...rest } =
      solterraCoRecipe;
    expect(() => compileSiteRecipe(rest as never, COMPILE_CONTEXT)).toThrow(
      /must specify exactly one of collectionId \/ collectionName/,
    );
  });

  it("includes the hostName from siteGrouping when set", () => {
    const ir = compileSiteRecipe(solterraCoRecipe, COMPILE_CONTEXT);
    const op = ir.operations[0] as CreateSiteFromTemplateOp;
    expect(op.hostName).toBe(solterraCoRecipe.siteGrouping?.hostName);
  });
});

describe("executeIr — CreateSiteFromTemplate apply path", () => {
  /**
   * Apply mode against a fresh tenant: planner gates on
   * `templateRefKey` being captured. We pre-seed the captured map
   * via the cross-recipe ref mechanism by passing a refKey→path entry
   * the stub authoring client resolves.
   */
  const buildIrWithSeeding = (recipe: typeof solterraCoRecipe) => {
    const ir = compileSiteRecipe(recipe, COMPILE_CONTEXT);
    const op = ir.operations[0] as CreateSiteFromTemplateOp;
    return { ir, op };
  };

  it("dispatches createSite, polls the job to Done, and captures the site itemId", async () => {
    const { ir, op } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient({
      createSite: vi.fn(async () => ({ handle: "job-42" }) as JobResponse),
      getJobStatus: vi.fn(async () => ({ state: "Done" }) as unknown as Job),
      listSites: vi.fn(async () =>
        // Two calls: idempotency check (empty) + post-apply capture (with site)
        [],
      ),
    });
    // listSites must return the new site on the post-apply call — make
    // a stateful stub so the first call returns empty, the second
    // returns the created site.
    let listSitesCallCount = 0;
    sitesClient.listSites = vi.fn(async () => {
      listSitesCallCount += 1;
      if (listSitesCallCount === 1) return [];
      return [{ id: "newly-assigned-site-id", name: op.siteName }] as Site[];
    });

    const authoring = makeStubAuthoringClient();
    // Pre-seed the templateRefKey via a cross-recipe ref the stub client
    // resolves: we register a path → return a synthetic remote item with
    // an itemId, which the executor captures into capturedItemIds.
    authoring.getItem = vi.fn(async (selector) => {
      if (selector.path === "/templates/seeded-site-template") {
        return {
          itemId: "captured-template-id",
          templateId: "tpl-x",
          parentId: "p",
          name: "ccl",
          path: "/templates/seeded-site-template",
          fields: [],
        };
      }
      return null;
    });

    const result = await executeIr(ir, authoring, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[op.templateRefKey, "/templates/seeded-site-template"]]),
    });

    expect(result.aborted).toBe(false);
    expect(result.summary).toEqual({ create: 1, update: 0, skip: 0, error: 0 });
    expect(sitesClient.createSite).toHaveBeenCalledTimes(1);
    expect(sitesClient.getJobStatus).toHaveBeenCalledWith("job-42");
  });

  it("returns status: skip when listSites already has a site with the same name (idempotent re-push)", async () => {
    const { ir, op } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient({
      listSites: vi.fn(async () => [{ id: "preexisting-site-id", name: op.siteName }] as Site[]),
    });

    const authoring = makeStubAuthoringClient();
    authoring.getItem = vi.fn(async () => ({
      itemId: "captured-template-id",
      templateId: "t",
      parentId: "p",
      name: "n",
      path: "/seeded",
      fields: [],
    }));

    const result = await executeIr(ir, authoring, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[op.templateRefKey, "/seeded"]]),
    });

    expect(result.summary.skip).toBe(1);
    expect(result.summary.create).toBe(0);
    expect(sitesClient.createSite).not.toHaveBeenCalled();
  });

  it("returns status: error when no SitesApiClient is threaded into the executor", async () => {
    const { ir } = buildIrWithSeeding(solterraCoRecipe);

    const authoring = makeStubAuthoringClient();
    const result = await executeIr(ir, authoring, {
      mode: "plan",
      // sitesClient: undefined — the omission is what we're testing
    });

    expect(result.summary.error).toBe(1);
    const action = result.plan.actions[0];
    expect(action.status).toBe("error");
    expect(action.reason).toMatch(/SitesApiClient/);
  });

  it("returns status: skip when the templateRefKey isn't yet captured (push the SiteTemplate first)", async () => {
    const { ir } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient();
    const authoring = makeStubAuthoringClient();
    // No cross-recipe ref seeding → templateRefKey stays uncaptured.
    const result = await executeIr(ir, authoring, {
      mode: "apply",
      sitesClient,
    });

    expect(result.summary.skip).toBe(1);
    const action = result.plan.actions[0];
    expect(action.status).toBe("skip");
    expect(action.reason).toMatch(/siteTemplate refKey .* not yet captured/);
    expect(sitesClient.createSite).not.toHaveBeenCalled();
  });

  it("aborts and rolls back (warn-only) when getJobStatus reports Failed", async () => {
    const { ir, op } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient({
      createSite: vi.fn(async () => ({ handle: "job-99" }) as JobResponse),
      getJobStatus: vi.fn(async () => ({ state: "Failed" }) as unknown as Job),
    });

    const authoring = makeStubAuthoringClient();
    authoring.getItem = vi.fn(async () => ({
      itemId: "captured-template-id",
      templateId: "t",
      parentId: "p",
      name: "n",
      path: "/seeded",
      fields: [],
    }));

    const result = await executeIr(ir, authoring, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[op.templateRefKey, "/seeded"]]),
    });

    expect(result.aborted).toBe(true);
    // Rollback for createSite is warn-only (returns null) — no rollback
    // operations should have run.
    expect(result.rollback?.rolledBack ?? 0).toBe(0);
  });
});
