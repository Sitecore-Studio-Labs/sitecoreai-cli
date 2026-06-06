import "../setup";
import { afterAll, beforeAll, expect } from "vitest";
import { describe as describeRaw, it as itRaw } from "vitest";
import { getEnv, resolveDeployToken } from "../helpers";
import { templatePathRefKey } from "../../../src/recipe/items/guids";
import {
  type CompileContext,
  compileRecipeSet,
  executeIr,
  type ExecutionEvent,
  type OperationIr,
} from "../../../src/recipe";
import type { Recipe, SiteRecipe, SiteTemplateRecipe } from "../../../src/recipe/schema/recipe";
import { createAuthoringClient } from "../../../src/recipe/api/authoring-client";
import { createSitesApiClient, type SitesApiClient } from "../../../src/recipe/api/sites-client";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import {
  FOUNDATION_SITE_MODULES,
  HEADLESS_SITE_SETUP_ROOT,
  SETUP_ACTION_TEMPLATE_PATHS,
  SITE_TEMPLATE_FIELDS,
  SYSTEM_THUMBNAIL_FIELD_ID,
} from "../../../src/recipe/ir/sitecore-templates";

// Gating: SITECOREAI_RUN_INTEGRATION=1 + either an env-scoped
// SITECOREAI_DEPLOY_TOKEN OR client-credentials. We CANNOT use
// `describeIfDeployAuth` here because that helper enforces the
// presence of `SITECOREAI_DEPLOY_TOKEN | SITECOREAI_CLIENT_ID/SECRET`
// in env, but this test prefers the env-scoped token already minted
// by `scai setup login` and stored in the OS keychain (Sites API
// requires env-scoped tokens; the org-scoped client-credentials path
// returns 401 against the Sites API). Skips when the integration gate
// is off OR the env-scoped token isn't readable.
const integrationEnabled = process.env.SITECOREAI_RUN_INTEGRATION === "1";
const describe = integrationEnabled ? describeRaw : describeRaw.skip;
const it = integrationEnabled ? itRaw : itRaw.skip;

/**
 * Sandbox integration test for sub-milestone E — exercises the
 * SiteTemplate executor end-to-end against the live tenant:
 *
 *   1. Compiles a `SiteTemplateRecipe` with thumbnail (external URL),
 *      populated `contents`, plus `pageTemplates` / `pageDesigns`
 *      handles that trigger the Module-composition path.
 *   2. Applies the IR — exercises the `MediaUpload` executor (presigned
 *      URL fetch + multipart POST), the `media-xml-ref` resolver, the
 *      Module root item + setup-action children, and the `SITE_MODULES`
 *      aggregation.
 *   3. Pairs the template with a `SiteRecipe` that instances it via
 *      the Sites API `createSite` so the picker-side path is also
 *      exercised.
 *   4. Asserts the expected items, fields, and child shapes are
 *      present on the tenant before tearing everything down — site,
 *      site-template, module root, action children, uploaded media.
 *
 * Gating: SITECOREAI_RUN_INTEGRATION=1 + the same OAuth client-
 * credentials env vars `cta-button.integration.test.ts` uses.
 */

const DEFAULTS = {
  cmHost: "xmc-lizsitecoree793-agenticdemo67ba-testdemofor7ec7.sitecorecloud.io",
  templatesRoot: "/sitecore/templates/Project/scai-e2e",
  renderingsRoot: "/sitecore/layout/Renderings/Project/scai-e2e",
  // SXA Site Templates ("Solution templates") live under the tenant's
  // `Settings/Project/<tenant>/Templates` path, NOT `/sitecore/templates`.
  // Sub-milestone E (2026-06-06) verified the Sites API picker
  // `createSite` lookup is path-scoped to this subtree — it returns
  // "Template not found" for any `templateId` outside it.
  siteTemplatesRoot: "/sitecore/system/Settings/Project/click-click-launch/Templates",
} as const;

const RUN_ID = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
  .toString(36)
  .padStart(3, "0")}`;

const PUSH_TIMEOUT_MS = 10 * 60 * 1000;

// Stable test thumbnail — GitHub's CDN, returns a small PNG with stable
// content-type. Used to exercise the executor's `external-url` byte
// source path. Override via RECIPE_TEST_THUMBNAIL_URL if the default
// goes 404 in a future run.
const DEFAULT_TEST_THUMBNAIL_URL = "https://avatars.githubusercontent.com/u/9919?v=4&size=64";

describe("sub-milestone E — SiteTemplate picker end-to-end", () => {
  const cmHost = getEnv("RECIPE_TEST_CM_HOST") ?? DEFAULTS.cmHost;
  const templatesRoot = getEnv("RECIPE_TEST_TEMPLATES_ROOT") ?? DEFAULTS.templatesRoot;
  const renderingsRoot = getEnv("RECIPE_TEST_RENDERINGS_ROOT") ?? DEFAULTS.renderingsRoot;
  const siteTemplatesRoot = getEnv("RECIPE_TEST_SITE_TEMPLATES_ROOT") ?? DEFAULTS.siteTemplatesRoot;
  const existingCollectionId = getEnv("RECIPE_TEST_COLLECTION_ID");

  const testThumbnailUrl = getEnv("RECIPE_TEST_THUMBNAIL_URL") ?? DEFAULT_TEST_THUMBNAIL_URL;

  const compileContext: CompileContext = {
    templatesRoot,
    renderingsRoot,
    siteTemplatesRoot,
  };

  // Per-run unique names + handles so concurrent + repeat runs don't
  // collide on the tenant. Handles also include RUN_ID so cross-recipe
  // refKey derivation stays stable within the run.
  const templateRecipe: SiteTemplateRecipe = {
    kind: "site-template",
    schemaVersion: "1",
    handle: `e2e-template-${RUN_ID}@1`,
    name: `E2eTemplate${RUN_ID}`,
    displayName: `E2E Template ${RUN_ID}`,
    description: "Sub-milestone E sandbox test — exercises thumbnail upload + module composition.",
    pageTemplates: [`e2e-page-${RUN_ID}@1`],
    pageDesigns: [`e2e-design-${RUN_ID}@1`],
    thumbnail: {
      kind: "external-url",
      url: testThumbnailUrl,
      alt: "scai e2e test thumbnail",
    },
    contents: [
      { name: "Pages", content: "Home, Article, Landing" },
      { name: "Components", content: "Hero, CardGrid, RichText" },
    ],
  };

  const siteRecipe: SiteRecipe = {
    kind: "site",
    schemaVersion: "1",
    handle: `e2e-site-${RUN_ID}@1`,
    name: `E2eSite${RUN_ID}`,
    displayName: `E2E Site ${RUN_ID}`,
    siteTemplate: templateRecipe.handle,
    language: "en",
    ...(existingCollectionId
      ? { collectionId: existingCollectionId }
      : { collectionName: `E2eCollection${RUN_ID}` }),
  };

  const recipes: Recipe[] = [templateRecipe, siteRecipe];

  let environment: EnvironmentConfiguration;
  let authoring: ReturnType<typeof createAuthoringClient>;
  let sitesClient: SitesApiClient;
  let irs: OperationIr[];

  // Resources to delete in afterAll, populated as the apply pass succeeds.
  const created: {
    siteId?: string;
    siteTemplateItemId?: string;
    moduleRootItemId?: string;
    mediaItemId?: string;
  } = {};

  beforeAll(async () => {
    // Resolve the env profile from the project's sitecoreai.cli.json so
    // the Authoring client can mint env-scoped CM tokens via the
    // configured automation client. Falls back to the org-scoped
    // client-credentials env-var path when no env profile is named.
    //
    // The Sites API rejects org-scoped tokens with 401 — this test
    // requires an env-scoped CM token, which `scai setup login -n <env>`
    // mints into the keychain. `getAccessToken` reads that token (or
    // refreshes it through the env profile's automation client).
    const profileName = getEnv("RECIPE_TEST_ENV_PROFILE");
    if (profileName) {
      const { resolveEnvironment } = await import("../../../src/policy/environment");
      const resolved = resolveEnvironment({
        environmentName: profileName,
        skipPolicy: true,
      });
      environment = resolved.environment;
      authoring = createAuthoringClient({ environment });
      // Mint the access token via the env profile path so the Sites
      // client gets the same env-scoped token the Authoring client
      // uses (its own auth flows through the same getAccessToken
      // path under the hood).
      const { getAccessToken } = await import("../../../src/serialization/api/auth");
      const accessToken = await getAccessToken(environment);
      if (!accessToken) {
        throw new Error(
          `Could not resolve an access token for env profile '${profileName}' — has \`scai setup login -n ${profileName}\` been run?`
        );
      }
      sitesClient = createSitesApiClient({ accessToken });
    } else {
      const accessToken = await resolveDeployToken();
      environment = {
        name: "scai-e2e-site-template-picker",
        host: cmHost,
        accessToken,
        cacheAuthenticationToken: false,
      } as EnvironmentConfiguration;
      authoring = createAuthoringClient({ environment });
      sitesClient = createSitesApiClient({ accessToken });
    }
    irs = compileRecipeSet(recipes, compileContext);
  });

  afterAll(async () => {
    if (!authoring) return;
    // 1. Site — has its own DELETE endpoint and clones a content tree
    //    that would otherwise leak.
    if (created.siteId) {
      try {
        await sitesClient.deleteSite(created.siteId);
      } catch {
        // best-effort; teardown failures don't block the suite
      }
    }
    // 2. SiteTemplate item — server-side cascade also removes its
    //    `Modules/<RecipeName>` folder and setup-action children
    //    because they live under it. Still, we delete the SiteTemplate
    //    AFTER the site (the picker references the template) and we
    //    do an explicit module-root delete below as a belt-and-
    //    braces guard against the cascade missing the sibling
    //    `Modules` folder.
    if (created.siteTemplateItemId) {
      try {
        await authoring.deleteItem({ itemId: created.siteTemplateItemId });
      } catch {
        // ignore
      }
    }
    // 3. Module root.
    if (created.moduleRootItemId) {
      try {
        await authoring.deleteItem({ itemId: created.moduleRootItemId });
      } catch {
        // ignore
      }
    }
    // 4. Uploaded media item — distinct path under media library, not
    //    cascaded by template deletion.
    if (created.mediaItemId) {
      try {
        await authoring.deleteItem({ itemId: created.mediaItemId });
      } catch {
        // ignore
      }
    }
    // 5. SXA collection item under /sitecore/system/Settings/Project. The
    //    Sites API auto-creates a `Settings/Project/<collectionName>` item
    //    alongside the content-tree collection when `collectionName` is
    //    used (vs an existing `collectionId`). Site delete does NOT cascade
    //    to this settings item — each test run otherwise leaks one orphan.
    //    Hard guard: only delete if the name matches our exact per-run
    //    `E2eCollection${RUN_ID}` value. Never delete `click-click-launch`,
    //    `next-wave`, or any non-test collection.
    if ("collectionName" in siteRecipe && siteRecipe.collectionName) {
      const expectedName = siteRecipe.collectionName;
      if (expectedName.startsWith("E2eCollection")) {
        try {
          const settingsCollection = await authoring.getItem({
            path: `/sitecore/system/Settings/Project/${expectedName}`,
          });
          if (settingsCollection && settingsCollection.name === expectedName) {
            await authoring.deleteItem({ itemId: settingsCollection.itemId });
          }
        } catch {
          // best-effort; surface in test logs but don't block teardown
        }
      }
    }
  }, PUSH_TIMEOUT_MS);

  it(
    "compiles + applies SiteTemplate + Site; thumbnail uploads; modules synthesise; createSite resolves",
    async () => {
      const events: { recipe: string; event: ExecutionEvent }[] = [];
      // Mirror push.ts's seeding pass: every CreateItem's recipe-internal
      // refKey → expected path AND every `templateOf: ref-path`'s
      // deterministic ref → target path. The latter is required for the
      // SiteTemplate's module-action children, which conform to SXA
      // Foundation action templates resolved by path.
      const crossRecipeRefs = new Map<string, string>();
      for (const ir of irs) {
        for (const op of ir.operations) {
          if (op.op === "CreateItem") {
            crossRecipeRefs.set(op.id, op.path);
            if (typeof op.templateOf !== "string" && op.templateOf.kind === "ref-path") {
              crossRecipeRefs.set(templatePathRefKey(op.templateOf.value), op.templateOf.value);
            }
          }
        }
      }

      for (const ir of irs) {
        const result = await executeIr(ir, authoring, {
          mode: "apply",
          emit: (event) => events.push({ recipe: ir.recipeHandle, event }),
          crossRecipeRefs,
          sitesClient,
        });
        if (result.aborted || result.summary.error > 0) {
          const failed = events.find((e) => e.event.kind === "failed");
          const opErrors = events.filter((e) => e.event.kind === "op-error");
          const applyError = events.find((e) => e.event.kind === "apply-error");
          // Surface the diagnostics in test output so a failed assertion
          // tells the operator WHAT failed, not just that it failed.

          console.error("=== sub-milestone E apply diagnostics ===");

          console.error("recipe:", ir.recipeHandle);

          console.error("summary:", result.summary, "aborted:", result.aborted);
          if (failed) console.error("failed:", JSON.stringify(failed.event, null, 2));
          if (applyError) console.error("apply-error:", JSON.stringify(applyError.event, null, 2));
          for (const e of opErrors) console.error("op-error:", JSON.stringify(e.event, null, 2));
        }
        expect(result.aborted, `${ir.recipeHandle} aborted`).toBe(false);
        expect(result.summary.error, `${ir.recipeHandle} had errors`).toBe(0);
      }

      // ----------------------------------------------------------------
      // Assertion a — SiteTemplate item exists, conforms to Solution
      //   Template, has Enabled=1, BUILT_IN_TEMPLATE=0.
      // ----------------------------------------------------------------
      const siteTemplatePath = `${siteTemplatesRoot}/${templateRecipe.name}`;
      const siteTemplateItem = await authoring.getItem({ path: siteTemplatePath });
      expect(siteTemplateItem, `SiteTemplate at ${siteTemplatePath}`).not.toBeNull();
      if (siteTemplateItem) {
        created.siteTemplateItemId = siteTemplateItem.itemId;
      }

      const normalize = (g: string) => g.replace(/[{}-]/g, "").toLowerCase();
      const lookupField = (
        fields: ReadonlyArray<{ fieldId: string; name?: string; value: string }>,
        fieldId: string
      ): string | undefined =>
        fields.find((f) => normalize(f.fieldId) === normalize(fieldId))?.value;

      const enabled = lookupField(siteTemplateItem!.fields, SITE_TEMPLATE_FIELDS.ENABLED);
      const builtIn = lookupField(siteTemplateItem!.fields, SITE_TEMPLATE_FIELDS.BUILT_IN_TEMPLATE);
      expect(enabled, "Enabled field").toBe("1");
      expect(builtIn, "BUILT_IN_TEMPLATE field").toBe("0");

      // ----------------------------------------------------------------
      // Assertion b — __Thumbnail field value matches the
      //   `<image mediaid="{GUID}"/>` shape; the referenced media item
      //   exists with bytes.
      // ----------------------------------------------------------------
      const thumbnailValue = lookupField(siteTemplateItem!.fields, SYSTEM_THUMBNAIL_FIELD_ID);
      expect(thumbnailValue, "__Thumbnail field").toBeDefined();
      const mediaIdMatch = thumbnailValue?.match(/mediaid="\{([0-9A-Fa-f-]+)\}"/);
      expect(
        mediaIdMatch,
        `__Thumbnail value '${thumbnailValue}' matches mediaid pattern`
      ).toBeTruthy();
      const mediaId = mediaIdMatch?.[1];
      expect(mediaId).toBeDefined();
      const mediaItem = await authoring.getItem({ itemId: mediaId!.replace(/-/g, "") });
      expect(mediaItem, "uploaded media item").not.toBeNull();
      if (mediaItem) {
        created.mediaItemId = mediaItem.itemId;
        // Sitecore stamps a `Size` field in bytes; non-empty assert that
        // the upload actually carried bytes (not just metadata).
        const sizeField = mediaItem.fields.find((f) => (f.name ?? "").toLowerCase() === "size");
        expect(sizeField, "media item Size field").toBeDefined();
        const sizeBytes = Number(sizeField?.value ?? 0);
        expect(sizeBytes, "media size > 0").toBeGreaterThan(0);
      }

      // ----------------------------------------------------------------
      // Assertion c — SXA `Content` field parses as JSON Array<{name, content}>
      // ----------------------------------------------------------------
      const contentField = lookupField(siteTemplateItem!.fields, SITE_TEMPLATE_FIELDS.CONTENT);
      expect(contentField, "Content field").toBeDefined();
      const parsedContents = JSON.parse(contentField ?? "[]") as Array<{
        name: string;
        content: string;
      }>;
      expect(parsedContents).toHaveLength(2);
      expect(parsedContents[0].name).toBe("Pages");
      expect(parsedContents[1].name).toBe("Components");

      // ----------------------------------------------------------------
      // Assertion d — Module root item at <siteTemplatesRoot>/Modules/<TemplateName>
      //   conforms to HeadlessSiteSetupRoot.
      // ----------------------------------------------------------------
      const moduleRootPath = `${siteTemplatesRoot}/Modules/${templateRecipe.name}`;
      const moduleRoot = await authoring.getItem({ path: moduleRootPath });
      expect(moduleRoot, `Module root at ${moduleRootPath}`).not.toBeNull();
      if (moduleRoot) {
        created.moduleRootItemId = moduleRoot.itemId;
        expect(moduleRoot.templateId.replace(/-/g, "").toLowerCase()).toBe(
          HEADLESS_SITE_SETUP_ROOT.replace(/-/g, "").toLowerCase()
        );
      }

      // ----------------------------------------------------------------
      // Assertion e — setup-action children exist (one per pageTemplates,
      //   one per pageDesigns). templateOf should resolve to the
      //   SETUP_ACTION_TEMPLATE_PATHS we documented; if any path
      //   doesn't resolve on this tenant the createItem will have
      //   failed (we already asserted summary.error === 0).
      // ----------------------------------------------------------------
      const moduleChildren = await authoring.getChildren({ itemId: moduleRoot!.itemId });
      const childNames = moduleChildren.map((c) => c.name).sort();
      // The compiler sanitizes handle → item name (see
      // `sanitizeHandleForItemName` in `compile/site-template.ts`):
      // `@<n>` becomes ` v<n>`, other illegal chars collapse to spaces.
      // Mirror that here so the assertion checks the actual item names
      // Sitecore stored, not the raw handles.
      const sanitizeHandle = (h: string): string =>
        h
          .replace(/@(\d+)$/, " v$1")
          .replace(/[^\w\s\-$]/g, " ")
          .replace(/\s+/g, " ")
          .trim();
      const expectedChildNames = [
        `Add ${sanitizeHandle(templateRecipe.pageTemplates[0])}`,
        `Add ${sanitizeHandle(templateRecipe.pageDesigns[0])}`,
      ].sort();
      expect(childNames).toEqual(expect.arrayContaining(expectedChildNames));
      // Verify each child's templateOf resolves to the expected SXA path.
      // We capture the Sitecore-assigned templateId per child and the
      // assertion confirms each child's template is in the expected set
      // (AddItem). If ANY action child's templateOf path failed to
      // resolve on the tenant, summary.error would be non-zero — the
      // existence of two correctly-templated children is the smoke
      // signal.
      const addItemTemplate = await authoring.getItem({
        path: SETUP_ACTION_TEMPLATE_PATHS.ADD_ITEM,
      });
      if (addItemTemplate) {
        const addItemTemplateId = addItemTemplate.itemId.replace(/-/g, "").toLowerCase();
        const childTemplates = moduleChildren.map((c) =>
          c.templateId.replace(/-/g, "").toLowerCase()
        );
        // Both pageTemplate + pageDesign actions use AddItem per the
        // compiler — `emitAction("add-page-template", …)` and
        // `emitAction("add-page-design", …)`.
        expect(
          childTemplates.every((t) => t === addItemTemplateId),
          `every module-action child conforms to AddItem (${SETUP_ACTION_TEMPLATE_PATHS.ADD_ITEM}); got ${JSON.stringify(childTemplates)}`
        ).toBe(true);
      }

      // ----------------------------------------------------------------
      // Assertion f — SITE_MODULES field carries the 15 Foundation GUIDs
      //   plus the synthesised tenant Module GUID, in order.
      // ----------------------------------------------------------------
      const siteModulesValue = lookupField(
        siteTemplateItem!.fields,
        SITE_TEMPLATE_FIELDS.SITE_MODULES
      );
      expect(siteModulesValue, "SITE_MODULES field").toBeDefined();
      // Normalize each entry to the canonical no-curlies, no-hyphens,
      // lowercase form so the comparison is shape-agnostic — the field
      // stores hyphenated GUIDs but the compiler constants we compare
      // against are hyphen-stripped.
      const siteModulesList = (siteModulesValue ?? "")
        .split("|")
        .map((s) => s.trim().replace(/[{}-]/g, "").toLowerCase());
      expect(siteModulesList.length).toBe(FOUNDATION_SITE_MODULES.length + 1);
      // Foundation prefix matches the constant list verbatim.
      for (let i = 0; i < FOUNDATION_SITE_MODULES.length; i += 1) {
        expect(siteModulesList[i]).toBe(FOUNDATION_SITE_MODULES[i].replace(/-/g, "").toLowerCase());
      }
      // Last entry is the synthesised tenant Module GUID.
      expect(siteModulesList[siteModulesList.length - 1]).toBe(
        moduleRoot!.itemId.replace(/-/g, "").toLowerCase()
      );

      // ----------------------------------------------------------------
      // Assertion g — Sites API createSite succeeds; the resulting
      //   site item appears under the SXA content tree at
      //   `/sitecore/content/<collectionName>/<siteName>`.
      //
      //   The Sites API's listSites endpoint is eventually-consistent:
      //   the underlying SXA scaffolding job takes minutes to fully
      //   complete (module composition + indexing) even though the
      //   content-tree write lands early. Authoring GraphQL `getItem`
      //   reads the same master DB as the scaffolding writer, so the
      //   site item surfaces as soon as SXA writes it — no async
      //   job-status delay. Short retry window (~30s, 3s intervals)
      //   covers the bounded write-then-read race.
      // ----------------------------------------------------------------
      const siteContentPath = `/sitecore/content/${
        ("collectionName" in siteRecipe && siteRecipe.collectionName) || ""
      }/${siteRecipe.name}`;
      const RETRY_INTERVAL_MS = 3_000;
      const RETRY_ATTEMPTS = 10; // ~30s total
      let siteItem: Awaited<ReturnType<typeof authoring.getItem>> = null;
      for (let attempt = 0; attempt < RETRY_ATTEMPTS; attempt += 1) {
        siteItem = await authoring.getItem({ path: siteContentPath });
        if (siteItem) break;
        await new Promise((resolve) => setTimeout(resolve, RETRY_INTERVAL_MS));
      }
      expect(
        siteItem,
        `Site item at '${siteContentPath}' should exist after createSite (waited ${(RETRY_ATTEMPTS * RETRY_INTERVAL_MS) / 1000}s)`
      ).not.toBeNull();
      if (siteItem) created.siteId = siteItem.itemId;
    },
    PUSH_TIMEOUT_MS
  );
});
