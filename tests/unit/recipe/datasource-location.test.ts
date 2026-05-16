import { describe, expect, it } from "vitest";
import {
  type CompileContext,
  compileComponentTemplateRecipe,
  compileRecipeSet,
} from "../../../src/recipe/compile";
import {
  renderingId,
  sharedDataFolderTemplateId,
  siteDataFolderId,
  siteDataFolderStandardValuesId,
  siteDataFolderTemplateId,
  templateId,
} from "../../../src/recipe/guids";
import {
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  SYSTEM_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import type {
  CreateItemOp,
  Operation,
  SetFieldOp,
  SetStandardValuesOp,
  SetBaseTemplatesOp,
} from "../../../src/recipe/ir/operations";
import type {
  ComponentSectionRecipe,
  ComponentTemplateRecipe,
} from "../../../src/recipe/schema/recipe";

const CONTENT_ITEMS_ROOT = "/sitecore/content/test-tenant/test-site/Data";

const UI_SECTION_RECIPE: ComponentSectionRecipe = {
  kind: "component-section",
  schemaVersion: "1",
  handle: "ui-section@1",
  name: "ui",
};

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/test-site/Components",
  renderingsRoot: "/sitecore/layout/Renderings/Project/test-site",
  contentItemsRoot: CONTENT_ITEMS_ROOT,
  sectionsByHandle: new Map([[UI_SECTION_RECIPE.handle, UI_SECTION_RECIPE]]),
};

const SITE = "default";

const baseRecipe = (overrides: Partial<ComponentTemplateRecipe>): ComponentTemplateRecipe =>
  ({
    kind: "component-template",
    schemaVersion: "1",
    handle: "badge-block@1",
    name: "BadgeBlock",
    displayName: "Badge Block",
    section: { handle: UI_SECTION_RECIPE.handle },
    fields: [{ name: "Title", shape: "text" }],
    ...overrides,
  }) as ComponentTemplateRecipe;

const findRendering = (operations: Operation[], handle: string): CreateItemOp => {
  const op = operations.find(
    (o): o is CreateItemOp => o.op === "CreateItem" && o.id === renderingId(SITE, handle)
  );
  if (!op) throw new Error(`rendering op not found for ${handle}`);
  return op;
};

const findField = (op: CreateItemOp, fieldGuid: string) =>
  op.fields.find((f) => f.fieldId === fieldGuid);

describe("rendering datasource locations — page scope", () => {
  it("page+subfolder emits Source `./Data/<subfolder>` and no extra CreateItem ops", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [{ scope: "page", subfolder: "Badges" }],
        },
      }),
      CONTEXT
    );

    const rendering = findRendering(ir.operations, "badge-block@1");
    expect(findField(rendering, RENDERING_FIELDS.DATASOURCE_LOCATION)?.value).toEqual({
      kind: "string",
      value: "./Data/Badges",
    });

    // No site-data-folder op was emitted.
    const folderOps = ir.operations.filter(
      (op) => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderOps).toHaveLength(0);
  });

  it("page without subfolder emits Source `./Data`", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [{ scope: "page" }],
        },
      }),
      CONTEXT
    );

    const rendering = findRendering(ir.operations, "badge-block@1");
    expect(findField(rendering, RENDERING_FIELDS.DATASOURCE_LOCATION)?.value).toEqual({
      kind: "string",
      value: "./Data",
    });
  });
});

describe("rendering datasource locations — site scope", () => {
  it("site+subfolder emits Source `<contentItemsRoot>/<subfolder>` plus a CreateOnly folder op", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [{ scope: "site", subfolder: "Badges" }],
        },
      }),
      CONTEXT
    );

    const rendering = findRendering(ir.operations, "badge-block@1");
    expect(findField(rendering, RENDERING_FIELDS.DATASOURCE_LOCATION)?.value).toEqual({
      kind: "string",
      value: `${CONTENT_ITEMS_ROOT}/Badges`,
    });

    const folderOps = ir.operations.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderOps).toHaveLength(1);
    const folderOp = folderOps[0];
    expect(folderOp.policy).toBe("CreateOnly");
    expect(folderOp.id).toBe(siteDataFolderId(SITE, "Badges"));
    expect(folderOp.path).toBe(`${CONTENT_ITEMS_ROOT}/Badges`);
    expect(folderOp.parent).toEqual({ kind: "ref-path", value: CONTENT_ITEMS_ROOT });
    // Folder ITEM conforms to the per-component Data Folder template,
    // not the generic Folder, so its SV's Insert Options can restrict
    // right-click → Insert to this recipe's datasource type.
    expect(folderOp.templateOf).toBe(siteDataFolderTemplateId(SITE, "badge-block@1"));
    expect(folderOp.name).toBe("Badges");
  });

  it("page+site with the same subfolder pipe-joins the Source and emits one folder op", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [
            { scope: "page", subfolder: "Badges" },
            { scope: "site", subfolder: "Badges" },
          ],
        },
      }),
      CONTEXT
    );

    const rendering = findRendering(ir.operations, "badge-block@1");
    expect(findField(rendering, RENDERING_FIELDS.DATASOURCE_LOCATION)?.value).toEqual({
      kind: "string",
      value: `./Data/Badges|${CONTENT_ITEMS_ROOT}/Badges`,
    });

    const folderOps = ir.operations.filter(
      (op) => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderOps).toHaveLength(1);
  });

  it("two recipes sharing the same site subfolder coalesce into one shared template (no per-recipe templates) and the folder item points at the shared template", () => {
    const recipeA = baseRecipe({
      handle: "badge-a@1",
      name: "BadgeA",
      displayName: "Badge A",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Shared" }],
      },
    });
    const recipeB = baseRecipe({
      handle: "badge-b@1",
      name: "BadgeB",
      displayName: "Badge B",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Shared" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipeA, recipeB], CONTEXT);
    const allOps = irs.flatMap((ir) => ir.operations);

    // Exactly ONE folder ITEM and it conforms to the SHARED template
    // (NOT either recipe's per-component template).
    const folderOps = allOps.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderOps).toHaveLength(1);
    expect(folderOps[0].id).toBe(siteDataFolderId(SITE, "Shared"));
    expect(folderOps[0].templateOf).toBe(sharedDataFolderTemplateId(SITE, "Shared"));

    // Exactly ONE shared template emitted, identified by the
    // shared-data-folder-template label.
    const sharedTemplateOps = allOps.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("shared-data-folder-template:")
    );
    expect(sharedTemplateOps).toHaveLength(1);
    expect(sharedTemplateOps[0].label).toBe("shared-data-folder-template:Shared");
    expect(sharedTemplateOps[0].id).toBe(sharedDataFolderTemplateId(SITE, "Shared"));

    // The shared template's SV's Insert Options is the union of both
    // contributing recipes' datasource templates, sorted by handle so
    // re-pushes don't drift the field value.
    const sharedInsertOps = allOps.filter(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label.startsWith("shared-data-folder-insert-options:")
    );
    expect(sharedInsertOps).toHaveLength(1);
    expect(sharedInsertOps[0].value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId(SITE, "badge-a@1"), templateId(SITE, "badge-b@1")],
    });

    // NEITHER recipe emits its per-recipe `<Component> Data Folder`
    // template — both recipes' subfolders are shared, so the per-recipe
    // emission early-returns.
    const perRecipeTemplateOps = allOps.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("site-data-folder-template:")
    );
    expect(perRecipeTemplateOps).toHaveLength(0);
  });

  it("mixed shared + singleton: recipe with one shared and one singleton site subfolder still emits its per-recipe template", () => {
    // recipeA targets BOTH "Shared" (also targeted by recipeB → shared)
    // AND "OnlyMine" (singleton). The singleton folder item needs the
    // per-recipe template, so it must still be emitted.
    const recipeA = baseRecipe({
      handle: "mixed-a@1",
      name: "MixedA",
      displayName: "Mixed A",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [
          { scope: "site", subfolder: "Shared" },
          { scope: "site", subfolder: "OnlyMine" },
        ],
      },
    });
    const recipeB = baseRecipe({
      handle: "mixed-b@1",
      name: "MixedB",
      displayName: "Mixed B",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Shared" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipeA, recipeB], CONTEXT);
    const allOps = irs.flatMap((ir) => ir.operations);

    // recipeA's per-recipe template emits (singleton "OnlyMine" needs
    // it); recipeB's does NOT (its only site subfolder is shared).
    const perRecipeTemplateOps = allOps.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("site-data-folder-template:")
    );
    expect(perRecipeTemplateOps.map((op) => op.label).sort()).toEqual([
      "site-data-folder-template:mixed-a@1",
    ]);

    // Two folder ITEMs total — "Shared" and "OnlyMine".
    const folderOps = allOps.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    const sharedFolder = folderOps.find((op) => op.id === siteDataFolderId(SITE, "Shared"));
    const onlyMineFolder = folderOps.find((op) => op.id === siteDataFolderId(SITE, "OnlyMine"));
    expect(sharedFolder).toBeDefined();
    expect(onlyMineFolder).toBeDefined();

    // "Shared" folder uses the SHARED template; "OnlyMine" uses
    // recipeA's per-recipe template.
    expect(sharedFolder!.templateOf).toBe(sharedDataFolderTemplateId(SITE, "Shared"));
    expect(onlyMineFolder!.templateOf).toBe(siteDataFolderTemplateId(SITE, "mixed-a@1"));
  });

  it("singleton subfolder in compileRecipeSet keeps the per-recipe template path (no coalescing)", () => {
    // A single recipe targeting one site subfolder — should behave
    // identically to the `compileComponentTemplateRecipe` standalone
    // case: per-recipe template emitted, folder item conforms to it.
    const recipe = baseRecipe({
      handle: "solo@1",
      name: "Solo",
      displayName: "Solo",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "SoloFolder" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipe], CONTEXT);
    const allOps = irs.flatMap((ir) => ir.operations);

    // Per-recipe template emitted.
    const perRecipeTemplateOps = allOps.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label === "site-data-folder-template:solo@1"
    );
    expect(perRecipeTemplateOps).toHaveLength(1);

    // No shared template emitted — singleton path.
    const sharedTemplateOps = allOps.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("shared-data-folder-template:")
    );
    expect(sharedTemplateOps).toHaveLength(0);

    // Folder item conforms to the per-recipe template.
    const folderOps = allOps.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderOps).toHaveLength(1);
    expect(folderOps[0].templateOf).toBe(siteDataFolderTemplateId(SITE, "solo@1"));
  });

  it("multi-segment shared subfolder lands the shared template under <componentsRoot>/Data Folders/<intermediates>/<leaf> Data Folder", () => {
    const recipeA = baseRecipe({
      handle: "ui-badge-a@1",
      name: "UiBadgeA",
      displayName: "UI Badge A",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "ui/badges" }],
      },
    });
    const recipeB = baseRecipe({
      handle: "ui-badge-b@1",
      name: "UiBadgeB",
      displayName: "UI Badge B",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "ui/badges" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipeA, recipeB], CONTEXT);
    const allOps = irs.flatMap((ir) => ir.operations);

    const sharedTemplateOps = allOps.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("shared-data-folder-template:")
    );
    expect(sharedTemplateOps).toHaveLength(1);
    const tplOp = sharedTemplateOps[0];
    // Path: <componentsRoot>/Data Folders/ui/badges Data Folder
    // (componentsRoot falls back to templatesRoot when unset, which the
    // test CONTEXT doesn't set; the templatesRoot is the Components
    // path itself in this fixture).
    expect(tplOp.path).toBe(`${CONTEXT.templatesRoot}/Data Folders/ui/badges Data Folder`);
    expect(tplOp.parent).toEqual({
      kind: "ref-path",
      value: `${CONTEXT.templatesRoot}/Data Folders/ui`,
    });
    expect(tplOp.name).toBe("badges Data Folder");
    expect(tplOp.label).toBe("shared-data-folder-template:ui/badges");
  });

  it("standalone compileComponentTemplateRecipe call (no shared signal) keeps singleton behaviour", () => {
    // Direct compileComponentTemplateRecipe (no compileRecipeSet) means
    // context.sharedSubfolders is unset. The recipe's site subfolder
    // should be treated as a singleton — per-recipe template emitted,
    // folder item points at it.
    const recipe = baseRecipe({
      handle: "standalone@1",
      name: "Standalone",
      displayName: "Standalone",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "WhateverFolder" }],
      },
    });

    const ir = compileComponentTemplateRecipe(recipe, CONTEXT);

    const folderOps = ir.operations.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderOps).toHaveLength(1);
    expect(folderOps[0].templateOf).toBe(siteDataFolderTemplateId(SITE, "standalone@1"));

    const perRecipeTemplateOps = ir.operations.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label === "site-data-folder-template:standalone@1"
    );
    expect(perRecipeTemplateOps).toHaveLength(1);
  });

  it("multi-segment site subfolder emits a single folder op for the leaf, parented at the intermediate path", () => {
    // Sitecore's `createItem` rejects names with `/`, so the compiler
    // must split on `/` and use only the leaf segment as the item
    // name; the executor's path-walker auto-creates the intermediate
    // segments when materialising the leaf. Source string still
    // resolves to the full path.
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [{ scope: "site", subfolder: "ui/badges" }],
        },
      }),
      CONTEXT
    );

    const rendering = findRendering(ir.operations, "badge-block@1");
    expect(findField(rendering, RENDERING_FIELDS.DATASOURCE_LOCATION)?.value).toEqual({
      kind: "string",
      value: `${CONTENT_ITEMS_ROOT}/ui/badges`,
    });

    const folderOps = ir.operations.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderOps).toHaveLength(1);
    const folderOp = folderOps[0];
    expect(folderOp.id).toBe(siteDataFolderId(SITE, "ui/badges"));
    expect(folderOp.path).toBe(`${CONTENT_ITEMS_ROOT}/ui/badges`);
    expect(folderOp.parent).toEqual({
      kind: "ref-path",
      value: `${CONTENT_ITEMS_ROOT}/ui`,
    });
    expect(folderOp.name).toBe("badges");
    // Only the LEAF folder gets the data-folder template; intermediate
    // segments (`ui`) are auto-created as plain folders by the
    // executor's path-walker.
    expect(folderOp.templateOf).toBe(siteDataFolderTemplateId(SITE, "badge-block@1"));
  });

  it("multi-segment subfolders with same intermediate segments produce distinct refKeys per leaf", () => {
    // `ui/badges` and `ui/cards` share the `ui` parent (auto-created
    // by the executor) but track distinct deterministic refKeys for
    // each leaf, keyed on the full subfolder string.
    const recipeBadges = baseRecipe({
      handle: "badge-block@1",
      name: "badge-block",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "ui/badges" }],
      },
    });
    const recipeCards = baseRecipe({
      handle: "card-block@1",
      name: "card-block",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "ui/cards" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipeBadges, recipeCards], CONTEXT);
    const folderOps = irs
      .flatMap((ir) => ir.operations)
      .filter(
        (op): op is CreateItemOp =>
          op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
      );
    expect(folderOps).toHaveLength(2);
    const ids = folderOps.map((op) => op.id).sort();
    expect(ids).toEqual(
      [siteDataFolderId(SITE, "ui/badges"), siteDataFolderId(SITE, "ui/cards")].sort()
    );
    expect(folderOps.map((op) => op.name).sort()).toEqual(["badges", "cards"]);
    // Both parented at the shared intermediate `ui` path — executor
    // resolves it once and reuses the captured itemId for both leaves.
    for (const op of folderOps) {
      expect(op.parent).toEqual({
        kind: "ref-path",
        value: `${CONTENT_ITEMS_ROOT}/ui`,
      });
    }
  });

  it("site scope without contentItemsRoot configured throws INPUT_INVALID", () => {
    const recipe = baseRecipe({
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Badges" }],
      },
    });
    const noContentItemsRoot: CompileContext = {
      templatesRoot: CONTEXT.templatesRoot,
      renderingsRoot: CONTEXT.renderingsRoot,
      sectionsByHandle: CONTEXT.sectionsByHandle,
    };

    expect(() => compileComponentTemplateRecipe(recipe, noContentItemsRoot)).toThrow(
      /contentItemsRoot/
    );
  });
});

describe("rendering datasource locations — per-component Data Folder template", () => {
  it("site-scoped subfolder emits the Data Folder template, base templates, SV, link-SV, set-insert-options + the folder ITEM", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [{ scope: "site", subfolder: "Badges" }],
        },
      }),
      CONTEXT
    );

    const expectedTplRefKey = siteDataFolderTemplateId(SITE, "badge-block@1");
    const expectedSvRefKey = siteDataFolderStandardValuesId(SITE, "badge-block@1");
    const expectedDsTemplateRefKey = templateId(SITE, "badge-block@1");

    // CreateItem for the data-folder template at
    // `Components/<section>/Component Folders/<Component> Data Folder`.
    const tplOp = ir.operations.find(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label === "site-data-folder-template:badge-block@1"
    );
    expect(tplOp).toBeDefined();
    if (!tplOp) throw new Error("expected tplOp");
    expect(tplOp.id).toBe(expectedTplRefKey);
    expect(tplOp.path).toBe(`${CONTEXT.templatesRoot}/ui/Component Folders/BadgeBlock Data Folder`);
    expect(tplOp.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE);
    expect(tplOp.name).toBe("BadgeBlock Data Folder");

    // SetBaseTemplates → [STANDARD_TEMPLATE_ID].
    const baseOp = ir.operations.find(
      (op): op is SetBaseTemplatesOp =>
        op.op === "SetBaseTemplates" && op.label === "site-data-folder-base-templates:badge-block@1"
    );
    expect(baseOp).toBeDefined();
    if (!baseOp) throw new Error("expected baseOp");
    expect(baseOp.itemRefKey).toBe(expectedTplRefKey);

    // CreateItem for `__Standard Values` parented under the template.
    const svOp = ir.operations.find(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label === "site-data-folder-standard-values:badge-block@1"
    );
    expect(svOp).toBeDefined();
    if (!svOp) throw new Error("expected svOp");
    expect(svOp.id).toBe(expectedSvRefKey);
    expect(svOp.parent).toEqual({ kind: "ref-recipe", refKey: expectedTplRefKey });
    expect(svOp.templateOf).toBe(expectedTplRefKey);

    // SetStandardValues link.
    const linkOp = ir.operations.find(
      (op): op is SetStandardValuesOp =>
        op.op === "SetStandardValues" &&
        op.label === "link-site-data-folder-standard-values:badge-block@1"
    );
    expect(linkOp).toBeDefined();
    if (!linkOp) throw new Error("expected linkOp");
    expect(linkOp.templateRefKey).toBe(expectedTplRefKey);
    expect(linkOp.standardValuesRefKey).toBe(expectedSvRefKey);

    // SetField on the SV — Insert Options ref-recipe-list with the
    // recipe's own datasource template only.
    const insertOp = ir.operations.find(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label === "site-data-folder-insert-options:badge-block@1"
    );
    expect(insertOp).toBeDefined();
    if (!insertOp) throw new Error("expected insertOp");
    expect(insertOp.itemRefKey).toBe(expectedSvRefKey);
    expect(insertOp.fieldId).toBe(SYSTEM_FIELDS.INSERT_OPTIONS);
    expect(insertOp.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [expectedDsTemplateRefKey],
    });

    // The folder ITEM still emits and references the per-component
    // Data Folder template via templateOf.
    const folderItemOps = ir.operations.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderItemOps).toHaveLength(1);
    expect(folderItemOps[0].templateOf).toBe(expectedTplRefKey);
  });

  it("two site-scoped subfolders on the same recipe emit ONE Data Folder template but TWO folder ITEMs both pointing at it via templateOf", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [
            { scope: "site", subfolder: "Badges" },
            { scope: "site", subfolder: "Featured Badges" },
          ],
        },
      }),
      CONTEXT
    );

    const expectedTplRefKey = siteDataFolderTemplateId(SITE, "badge-block@1");

    // Idempotent on the template's refKey: only one
    // site-data-folder-template CreateItem op.
    const templateOps = ir.operations.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("site-data-folder-template:")
    );
    expect(templateOps).toHaveLength(1);
    expect(templateOps[0].id).toBe(expectedTplRefKey);

    // But two folder ITEMs (one per declared subfolder).
    const folderItemOps = ir.operations.filter(
      (op): op is CreateItemOp => op.op === "CreateItem" && op.label.startsWith("site-data-folder:")
    );
    expect(folderItemOps).toHaveLength(2);
    expect(folderItemOps.map((op) => op.name).sort()).toEqual(["Badges", "Featured Badges"].sort());
    // Both reference the same per-component Data Folder template.
    for (const op of folderItemOps) {
      expect(op.templateOf).toBe(expectedTplRefKey);
    }
  });

  it("two recipes with site-scoped subfolders via compileRecipeSet emit TWO Data Folder templates each referencing its own datasource template in Insert Options", () => {
    const recipeA = baseRecipe({
      handle: "badge-a@1",
      name: "BadgeA",
      displayName: "Badge A",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Badges" }],
      },
    });
    const recipeB = baseRecipe({
      handle: "card-b@1",
      name: "CardB",
      displayName: "Card B",
      datasource: {
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [{ scope: "site", subfolder: "Cards" }],
      },
    });

    const irs = compileRecipeSet([UI_SECTION_RECIPE, recipeA, recipeB], CONTEXT);
    const allOps = irs.flatMap((ir) => ir.operations);

    // Two distinct data-folder templates — one per recipe handle.
    const templateOps = allOps.filter(
      (op): op is CreateItemOp =>
        op.op === "CreateItem" && op.label.startsWith("site-data-folder-template:")
    );
    expect(templateOps.map((op) => op.id).sort()).toEqual(
      [
        siteDataFolderTemplateId(SITE, "badge-a@1"),
        siteDataFolderTemplateId(SITE, "card-b@1"),
      ].sort()
    );

    // Each template's Insert Options references its own recipe's
    // datasource template.
    const insertOps = allOps.filter(
      (op): op is SetFieldOp =>
        op.op === "SetField" && op.label.startsWith("site-data-folder-insert-options:")
    );
    expect(insertOps).toHaveLength(2);
    const insertA = insertOps.find(
      (op) => op.label === "site-data-folder-insert-options:badge-a@1"
    );
    const insertB = insertOps.find((op) => op.label === "site-data-folder-insert-options:card-b@1");
    expect(insertA?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId(SITE, "badge-a@1")],
    });
    expect(insertB?.value).toEqual({
      kind: "ref-recipe-list",
      refKeys: [templateId(SITE, "card-b@1")],
    });
  });
});

describe("rendering datasource locations — IsAutoDatasourceRendering / OtherProperties", () => {
  it("autoCreate: true sets IsAutoDatasourceRendering=true on OtherProperties", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: true,
          openPropertiesAfterAdd: false,
          locations: [{ scope: "page" }],
        },
      }),
      CONTEXT
    );

    const rendering = findRendering(ir.operations, "badge-block@1");
    expect(findField(rendering, RENDERING_FIELDS.OTHER_PROPERTIES)?.value).toMatchObject({
      kind: "url-string-map",
      entries: { IsAutoDatasourceRendering: "true" },
    });
  });

  it("autoCreate: false omits IsAutoDatasourceRendering from OtherProperties", () => {
    const ir = compileComponentTemplateRecipe(
      baseRecipe({
        datasource: {
          autoCreate: false,
          openPropertiesAfterAdd: false,
          locations: [{ scope: "page" }],
        },
      }),
      CONTEXT
    );

    const rendering = findRendering(ir.operations, "badge-block@1");
    const otherProps = findField(rendering, RENDERING_FIELDS.OTHER_PROPERTIES);
    if (otherProps?.value.kind !== "url-string-map") {
      throw new Error("expected OtherProperties to be url-string-map");
    }
    expect(otherProps.value.entries.IsAutoDatasourceRendering).toBeUndefined();
  });
});
