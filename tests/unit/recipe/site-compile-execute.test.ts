import { describe, expect, it, vi } from "vitest";
import { alarisRecipe } from "../../../example/recipes/alaris.recipe";
import { solterraCoRecipe } from "../../../example/recipes/solterra-co.recipe";
import { compileSiteRecipe } from "../../../src/recipe/compile";
import type { CompileContext } from "../../../src/recipe/compile";
import { executeIr } from "../../../src/recipe/runtime/execute";
import { siteId, templateId } from "../../../src/recipe/items/guids";
import type { CreateSiteFromTemplateOp } from "../../../src/recipe/ir/operations";
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
const makeStubAuthoringClient = (): AuthoringApiClient => {
  const stub: AuthoringApiClient = {
    getItem: vi.fn(async () => null),
    // Delegate to stub.getItem so tests that override getItem (per-path
    // mocking) automatically benefit. Without this, the executor's
    // batched prefetch path bypasses the test's getItem mock.
    getItemsByPaths: vi.fn(async (paths: readonly string[]) => {
      const result = new Map();
      for (const p of paths) {
        result.set(p, await stub.getItem({ path: p }));
      }
      return result;
    }),
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
  };
  return stub;
};

const makeStubSitesClient = (overrides: Partial<SitesApiClient> = {}): SitesApiClient => ({
  createSite: vi.fn(
    async (_input: NewSiteInput): Promise<JobResponse> =>
      ({
        handle: "job-1",
      }) as JobResponse
  ),
  getJobStatus: vi.fn(
    async (_jobHandle: string): Promise<Job> =>
      ({
        state: "Done",
      }) as unknown as Job
  ),
  listSites: vi.fn(async (): Promise<Site[]> => []),
  retrieveSite: vi.fn(async (): Promise<Site> => ({}) as Site),
  updateSite: vi.fn(async (): Promise<Site> => ({}) as Site),
  listSiteTemplates: vi.fn(async (): Promise<SiteTemplate[]> => []),
  listCollections: vi.fn(async (): Promise<SiteCollection[]> => []),
  listLanguages: vi.fn(async (): Promise<Language[]> => []),
  listSupportedLanguages: vi.fn(async () => []),
  addLanguage: vi.fn(
    async (_languageCode: string): Promise<Language> =>
      ({
        languageCode: _languageCode,
      }) as Language
  ),
  ...overrides,
});

describe("compileSiteRecipe", () => {
  it("emits CreateSiteFromTemplate as the first op with the SiteTemplate handle resolved to its templateRefKey", () => {
    const ir = compileSiteRecipe(solterraCoRecipe, COMPILE_CONTEXT);
    expect(ir.recipeHandle).toBe(solterraCoRecipe.handle);
    const op = ir.operations[0] as CreateSiteFromTemplateOp;
    expect(op.op).toBe("CreateSiteFromTemplate");
    expect(op.siteName).toBe(solterraCoRecipe.name);
    expect(op.language).toBe(solterraCoRecipe.language);
    expect(op.siteRefKey).toBe(siteId(solterraCoRecipe.handle));
    expect(op.templateRefKey).toBe(templateId("default", solterraCoRecipe.siteTemplate));
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
      /must specify exactly one of collectionId \/ collectionName/
    );
  });

  it("rejects a SiteRecipe that specifies NEITHER collectionId nor collectionName", () => {
    const stripped: Record<string, unknown> = { ...solterraCoRecipe };
    delete stripped.collectionName;
    delete stripped.collectionDisplayName;
    delete stripped.collectionDescription;
    expect(() => compileSiteRecipe(stripped as never, COMPILE_CONTEXT)).toThrow(
      /must specify exactly one of collectionId \/ collectionName/
    );
  });

  it("includes the hostName from siteGrouping when set", () => {
    const ir = compileSiteRecipe(solterraCoRecipe, COMPILE_CONTEXT);
    const op = ir.operations[0] as CreateSiteFromTemplateOp;
    expect(op.hostName).toBe(solterraCoRecipe.siteGrouping?.hostName);
  });

  describe("dictionary override emission (v2)", () => {
    it("emits one SetField op per dictionaryOverrides phrase, with latePath under the derived collection path", () => {
      const ir = compileSiteRecipe(solterraCoRecipe, COMPILE_CONTEXT);
      // solterraCoRecipe overrides exactly one phrase: ContactUs.
      const setFieldOps = ir.operations.filter((o) => o.op === "SetField");
      expect(setFieldOps).toHaveLength(1);
      const op = setFieldOps[0];
      expect(op.label).toBe(`dictionary-override:${solterraCoRecipe.handle}/ContactUs`);
      expect(op.value).toEqual({
        kind: "string",
        value: solterraCoRecipe.dictionaryOverrides?.ContactUs,
      });
      // Default-derived path: /sitecore/content/<collectionName>/<siteName>/Dictionary/<phrase>
      expect(op.latePath).toBe(
        `/sitecore/content/${solterraCoRecipe.collectionName}/${solterraCoRecipe.name}/Dictionary/ContactUs`
      );
    });

    it("uses the operator-supplied collectionPath when set (overrides the collectionName-derived default)", () => {
      const customRecipe = {
        ...solterraCoRecipe,
        collectionPath: "/sitecore/content/Marketing/Brands",
      };
      const ir = compileSiteRecipe(customRecipe, COMPILE_CONTEXT);
      const setFieldOps = ir.operations.filter((o) => o.op === "SetField");
      expect(setFieldOps[0].latePath).toBe(
        `/sitecore/content/Marketing/Brands/${customRecipe.name}/Dictionary/ContactUs`
      );
    });

    it("trims a trailing slash from operator-supplied collectionPath", () => {
      const customRecipe = {
        ...solterraCoRecipe,
        collectionPath: "/sitecore/content/Marketing/",
      };
      const ir = compileSiteRecipe(customRecipe, COMPILE_CONTEXT);
      const setFieldOps = ir.operations.filter((o) => o.op === "SetField");
      expect(setFieldOps[0].latePath).toBe(
        `/sitecore/content/Marketing/${customRecipe.name}/Dictionary/ContactUs`
      );
    });

    it("skips override emission when collectionId is set without collectionPath (compiler can't derive path)", () => {
      const idOnlyRecipe = {
        ...alarisRecipe,
        // alaris already uses collectionId; no collectionPath set on the
        // fixture. Compiler cannot synthesise the dictionary phrase
        // path, so override SetFields are deliberately skipped.
      };
      const ir = compileSiteRecipe(idOnlyRecipe, COMPILE_CONTEXT);
      const setFieldOps = ir.operations.filter((o) => o.op === "SetField");
      expect(setFieldOps).toHaveLength(0);
      // The CreateSiteFromTemplate op is still emitted — the site is
      // created; only the overrides are skipped.
      expect(ir.operations).toHaveLength(1);
      expect(ir.operations[0].op).toBe("CreateSiteFromTemplate");
    });

    it("emits override SetFields when collectionId AND collectionPath are both supplied", () => {
      const idAndPathRecipe = {
        ...alarisRecipe,
        collectionPath: "/sitecore/content/Alaris-Collection",
      };
      const ir = compileSiteRecipe(idAndPathRecipe, COMPILE_CONTEXT);
      const setFieldOps = ir.operations.filter((o) => o.op === "SetField");
      // alaris overrides exactly one phrase: ReadMore.
      expect(setFieldOps).toHaveLength(1);
      expect(setFieldOps[0].latePath).toBe(
        `/sitecore/content/Alaris-Collection/${idAndPathRecipe.name}/Dictionary/ReadMore`
      );
    });
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
      // Idempotency check at plan time: returns empty so the planner
      // doesn't skip. Post-apply capture is via Authoring `getItem`
      // against the SXA content-tree path, not listSites — see the
      // stubbed `authoring.getItem` below.
      listSites: vi.fn(async () => []),
    });

    const authoring = makeStubAuthoringClient();
    // Pre-seed the templateRefKey via a cross-recipe ref the stub client
    // resolves, AND return a synthetic site item when the executor
    // reads the just-created site's content-tree path. The path follows
    // SXA convention `/sitecore/content/<collectionName>/<siteName>`.
    const expectedSitePath = `/sitecore/content/${op.collectionName}/${op.siteName}`;
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
      if (selector.path === expectedSitePath) {
        return {
          itemId: "newly-assigned-site-id",
          templateId: "site-tpl",
          parentId: "p",
          name: op.siteName,
          path: expectedSitePath,
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
    // 1 create (CreateSiteFromTemplate) + 1 skip (the dictionary-override
    // SetField that v2 emits — its late-path getItem returns null in the
    // stub so it skips with "not yet captured/created").
    expect(result.summary.create).toBe(1);
    expect(result.summary.error).toBe(0);
    expect(sitesClient.createSite).toHaveBeenCalledTimes(1);
    // The site is created with its full declared language list (the
    // pre-create ensure registered `en`, so it passes the env gate) —
    // not just the primary `language` field.
    expect(sitesClient.createSite).toHaveBeenCalledWith(
      expect.objectContaining({ language: "en", languages: ["en"] })
    );
    expect(sitesClient.getJobStatus).toHaveBeenCalledWith("job-42");
  });

  it("returns status: skip when listSites already has a site with the same name (idempotent re-push)", async () => {
    const { ir, op } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient({
      // The site's own CONFIGURED language list already carries every
      // declared language — nothing to add at the site level either.
      listSites: vi.fn(
        async () =>
          [{ id: "preexisting-site-id", name: op.siteName, supportedLanguages: ["en"] }] as Site[]
      ),
      // Every declared language already registered → nothing to provision.
      listLanguages: vi.fn(async () => [{ iso: "en", regionalIsoCode: "en" }] as Language[]),
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
    expect(sitesClient.addLanguage).not.toHaveBeenCalled();
    expect(sitesClient.updateSite).not.toHaveBeenCalled();
  });

  it("provisions missing declared languages when the site already exists (versioned brand-language growth)", async () => {
    const { ir, op } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient({
      listSites: vi.fn(async () => [{ id: "preexisting-site-id", name: op.siteName }] as Site[]),
      // Environment has NO languages registered — the declared primary
      // (`en`) is missing, e.g. a language added to the brand after the
      // site was first installed.
      listLanguages: vi.fn(async () => [] as Language[]),
    });

    const authoring = makeStubAuthoringClient();
    // Resolve ONLY the seeded template path — the dictionary-override
    // SetField's latePath must miss so it skips instead of planning an
    // update against the throwing stub updateItem.
    authoring.getItem = vi.fn(async (selector) =>
      selector.path === "/seeded"
        ? {
            itemId: "captured-template-id",
            templateId: "t",
            parentId: "p",
            name: "n",
            path: "/seeded",
            fields: [],
          }
        : null
    );

    const result = await executeIr(ir, authoring, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[op.templateRefKey, "/seeded"]]),
    });

    expect(result.aborted).toBe(false);
    const action = result.plan.actions[0];
    expect(action.status).toBe("update");
    expect(action.reason).toMatch(/registering missing environment language\(s\): en/);
    if (action.mutation?.kind !== "ensureLanguages") throw new Error("expected ensureLanguages");
    expect(action.mutation.missing).toEqual(["en"]);
    // Apply ran the same idempotent ensure the create path uses — the
    // missing language was registered, but no site was created.
    expect(sitesClient.addLanguage).toHaveBeenCalledWith("en");
    expect(sitesClient.createSite).not.toHaveBeenCalled();
    // The site's own configured language list was missing the declared
    // language too (fixture site has no `supportedLanguages`) — the
    // executor PATCHes it after the environment ensure registers the code.
    expect(sitesClient.updateSite).toHaveBeenCalledWith("preexisting-site-id", {
      supportedLanguages: ["en"],
    });
  });

  it("provisions languages for an existing site even when the templateRefKey is not captured", async () => {
    const { ir, op } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient({
      listSites: vi.fn(
        async () =>
          [{ id: "preexisting-site-id", name: op.siteName, supportedLanguages: [] }] as Site[]
      ),
      retrieveSite: vi.fn(
        async () => ({ id: "preexisting-site-id", supportedLanguages: [] }) as Site
      ),
      listLanguages: vi.fn(async () => [{ iso: "en", regionalIsoCode: "en" }] as Language[]),
    });

    const authoring = makeStubAuthoringClient();
    // NO crossRecipeRefs seeding and getItem resolves nothing — the
    // templateRefKey stays uncaptured. Language provisioning must run
    // anyway: an existing site doesn't need its template, and the old
    // template-first early skip silently swallowed the ensure.
    const result = await executeIr(ir, authoring, {
      mode: "apply",
      sitesClient,
    });

    expect(result.aborted).toBe(false);
    const action = result.plan.actions[0];
    expect(action.status).toBe("update");
    expect(action.reason).toMatch(/adding missing site language\(s\): en/);
    expect(sitesClient.updateSite).toHaveBeenCalledWith("preexisting-site-id", {
      supportedLanguages: ["en"],
    });
    expect(sitesClient.createSite).not.toHaveBeenCalled();
  });

  it("adds a declared language to the SITE list when the environment already has it (env-registered but site-invisible locale)", async () => {
    const { ir, op } = buildIrWithSeeding(solterraCoRecipe);

    const sitesClient = makeStubSitesClient({
      // Environment already registered `en` (say, via --provision-languages
      // on a localize pass), and the localize pass already wrote `en`
      // content under the site — so the derived "in use" list contains it.
      // But the SITE's CONFIGURED list (`supportedLanguages`, what Pages
      // offers locales from) never gained it. The diff must read the
      // configured list: keying off `languages` is the exact false
      // negative that left env-registered locales invisible in Pages.
      listSites: vi.fn(
        async () =>
          [
            {
              id: "preexisting-site-id",
              name: op.siteName,
              languages: ["en"],
              supportedLanguages: [],
            },
          ] as Site[]
      ),
      retrieveSite: vi.fn(
        async () => ({ id: "preexisting-site-id", supportedLanguages: [] }) as Site
      ),
      listLanguages: vi.fn(async () => [{ iso: "en", regionalIsoCode: "en" }] as Language[]),
    });

    const authoring = makeStubAuthoringClient();
    authoring.getItem = vi.fn(async (selector) =>
      selector.path === "/seeded"
        ? {
            itemId: "captured-template-id",
            templateId: "t",
            parentId: "p",
            name: "n",
            path: "/seeded",
            fields: [],
          }
        : null
    );

    const result = await executeIr(ir, authoring, {
      mode: "apply",
      sitesClient,
      crossRecipeRefs: new Map([[op.templateRefKey, "/seeded"]]),
    });

    expect(result.aborted).toBe(false);
    const action = result.plan.actions[0];
    expect(action.status).toBe("update");
    expect(action.reason).toMatch(/adding missing site language\(s\): en/);
    if (action.mutation?.kind !== "ensureLanguages") throw new Error("expected ensureLanguages");
    expect(action.mutation.missing).toEqual([]);
    expect(action.mutation.site).toEqual({
      siteId: "preexisting-site-id",
      siteName: op.siteName,
      currentLanguages: [],
      missing: ["en"],
    });
    // Nothing to register on the environment — only the site PATCH runs.
    expect(sitesClient.addLanguage).not.toHaveBeenCalled();
    expect(sitesClient.updateSite).toHaveBeenCalledWith("preexisting-site-id", {
      supportedLanguages: ["en"],
    });
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

    // Both ops skip: the createSite (templateRefKey not captured) and
    // the dictionary-override SetField (its phrase-item ref not in
    // capturedItemIds and the late-path getItem returns null in the stub).
    expect(result.summary.create).toBe(0);
    expect(result.summary.error).toBe(0);
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
