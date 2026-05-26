import { describe, expect, it } from "vitest";
import { articlePageRecipe } from "../../../example/recipes/article-page.recipe";
import { homePageRecipe } from "../../../example/recipes/home-page.recipe";
import { pageBodyPlaceholderRecipe } from "../../../example/recipes/page-body-placeholder.recipe";
import { siteHomeRecipe } from "../../../example/recipes/site-home.recipe";
import {
  type CompileContext,
  PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE,
  compilePageRecipe,
  compilePageTemplateRecipe,
  compilePlaceholderRecipe,
  compileRecipeSet,
} from "../../../src/recipe/compile";
import {
  datasourceId,
  pageItemId,
  placeholderSettingsId,
  renderingId,
  standardValuesId,
  templateId,
} from "../../../src/recipe/items/guids";
import type {
  CreateItemOp,
  Operation,
  SetBaseTemplatesOp,
  SetFieldOp,
} from "../../../src/recipe/ir/operations";
import {
  LAYOUT_FIELDS,
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_SETTINGS_FOLDER_TEMPLATE_ID,
  PLACEHOLDER_TEMPLATE_ID,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SXA_JSON_LAYOUT_ID,
} from "../../../src/recipe/ir/sitecore-templates";
import {
  type ComponentTemplateRecipe,
  type PageDesignRecipe,
  type PageRecipe,
  PageRecipeSchema,
  type PageTemplateRecipe,
  PageTemplateRecipeSchema,
  type PlaceholderRecipe,
  PlaceholderRecipeSchema,
  type Recipe,
} from "../../../src/recipe/schema/recipe";
import { isValid, validateRecipeSet } from "../../../src/recipe/validate";

const SITE = "default";

const CONTEXT: CompileContext = {
  templatesRoot: "/sitecore/templates/Project/Demo",
  renderingsRoot: "/sitecore/layout/Renderings/Project/Demo",
  pageTemplatesRoot: "/sitecore/templates/Project/Demo",
  pageDesignsRoot: "/sitecore/content/Demo/Presentation/Page Designs",
  placeholderSettingsRoot: "/sitecore/content/Demo/Presentation/Placeholder Settings",
  pagesRoot: "/sitecore/content/Demo/Home",
};

const findCreate = (ops: Operation[], label: string): CreateItemOp =>
  ops.find((op): op is CreateItemOp => op.op === "CreateItem" && op.label === label)!;
const findSetField = (ops: Operation[], label: string): SetFieldOp =>
  ops.find((op): op is SetFieldOp => op.op === "SetField" && op.label === label)!;

const articlePage = {
  kind: "page-template",
  schemaVersion: "1",
  handle: "article-page@1",
  name: "ArticlePage",
  displayName: "Article Page",
  fields: [{ name: "MetaTitle", shape: "text" }],
  insertOptions: ["article-page@1"],
} satisfies PageTemplateRecipe;

// A minimal placeable component — `compileRecipeSet` runs it through the
// component compiler; its rendering refKey is what the placeholder
// aggregate resolves `Allowed Controls` against.
const component = (handle: string, placedIn: string[] = []): ComponentTemplateRecipe =>
  ({
    kind: "component-template",
    schemaVersion: "1",
    handle,
    name: handle.replace(/@.*/, "").replace(/-/g, ""),
    displayName: handle,
    fields: [],
    variants: [],
    params: [],
    placedIn,
    placeholders: [],
    dynamicPlaceholders: false,
  }) satisfies ComponentTemplateRecipe;

describe("compilePageTemplateRecipe", () => {
  const ir = compilePageTemplateRecipe(articlePage, CONTEXT);

  it("creates the template item under pageTemplatesRoot as a Sitecore Template", () => {
    const create = findCreate(ir.operations, "template:article-page@1");
    expect(create.id).toBe(templateId(SITE, "article-page@1"));
    expect(create.path).toBe("/sitecore/templates/Project/Demo/ArticlePage");
    expect(create.templateOf).toBe(SITECORE_TEMPLATES.TEMPLATE);
  });

  it("inherits the SXA Headless page base set plus the Standard template", () => {
    const base = ir.operations.find(
      (op): op is SetBaseTemplatesOp => op.op === "SetBaseTemplates"
    )!;
    expect(base.baseTemplates).toContain(STANDARD_TEMPLATE_ID);
    for (const pageBase of SXA_HEADLESS_PAGE_BASE_TEMPLATES) {
      expect(base.baseTemplates).toContain(pageBase);
    }
  });

  it("stamps the standard-values __Renderings with the JSON-layout shell", () => {
    const layout = findSetField(ir.operations, "page-template-layout:article-page@1");
    expect(layout.itemRefKey).toBe(standardValuesId(SITE, "article-page@1"));
    expect(layout.fieldId).toBe(LAYOUT_FIELDS.RENDERINGS);
    if (layout.value.kind !== "string") throw new Error("expected string layout value");
    // Device + JSON-layout pointer, no <r> renderings (chrome comes from
    // the page design).
    expect(layout.value.value).toContain(`l="{${SXA_JSON_LAYOUT_ID.toUpperCase()}}"`);
    expect(layout.value.value).toContain("<d ");
    expect(layout.value.value).not.toContain("<r id=");
  });

  it("emits an insert-options SetField on the standard-values item", () => {
    const insert = findSetField(ir.operations, "insert-options:article-page@1");
    expect(insert.itemRefKey).toBe(standardValuesId(SITE, "article-page@1"));
  });

  it("falls back to templatesRoot when pageTemplatesRoot is unset", () => {
    const { pageTemplatesRoot: _omit, ...noPageRoot } = CONTEXT;
    void _omit;
    const fallback = compilePageTemplateRecipe(articlePage, noPageRoot);
    const create = findCreate(fallback.operations, "template:article-page@1");
    expect(create.path).toBe("/sitecore/templates/Project/Demo/ArticlePage");
  });

  it("nests the template under <root>/<group> when meta.tax.group is set", () => {
    const grouped = {
      ...articlePage,
      meta: { tax: { group: "Editorial" } },
    } satisfies PageTemplateRecipe;
    const groupedIr = compilePageTemplateRecipe(grouped, CONTEXT);
    const folder = findCreate(
      groupedIr.operations,
      "page-templates-group-folder:default:Editorial"
    );
    expect(folder.policy).toBe("CreateOnly");
    expect(folder.path).toBe("/sitecore/templates/Project/Demo/Editorial");
    const create = findCreate(groupedIr.operations, "template:article-page@1");
    expect(create.path).toBe("/sitecore/templates/Project/Demo/Editorial/ArticlePage");
    expect(create.parent).toEqual({ kind: "ref-recipe", refKey: folder.id });
  });

  it("emits the group folder once across a set of same-group page templates", () => {
    const a = {
      ...articlePage,
      meta: { tax: { group: "Editorial" } },
    } satisfies PageTemplateRecipe;
    const b = {
      ...articlePage,
      handle: "news-page@1",
      name: "NewsPage",
      displayName: "News Page",
      insertOptions: ["news-page@1"],
      meta: { tax: { group: "Editorial" } },
    } satisfies PageTemplateRecipe;
    const irs = compileRecipeSet([a, b], CONTEXT);
    const folderOps = irs
      .flatMap((ir) => ir.operations)
      .filter((op) => op.label === "page-templates-group-folder:default:Editorial");
    expect(folderOps).toHaveLength(1);
  });
});

const homePage = {
  kind: "page",
  schemaVersion: "1",
  handle: "home@1",
  name: "Home",
  displayName: "Home",
  template: "article-page@1",
  fields: { MetaTitle: { shape: "text", value: "Welcome" } },
  layout: {
    placeholders: {
      "headless-main": [{ componentHandle: "alpha-block@1", datasourceRef: { kind: "none" } }],
    },
  },
} satisfies PageRecipe;

describe("compilePageRecipe", () => {
  const ir = compilePageRecipe(homePage, CONTEXT);

  it("creates the page item under pagesRoot, conforming to the page template", () => {
    const create = findCreate(ir.operations, "page:home@1");
    expect(create.id).toBe(pageItemId("default", "home@1"));
    expect(create.path).toBe("/sitecore/content/Demo/Home/Home");
    expect(create.parent).toEqual({ kind: "ref-path", value: "/sitecore/content/Demo/Home" });
    expect(create.templateOf).toBe(templateId("default", "article-page@1"));
  });

  it("emits a versioned SetField per page field value", () => {
    const field = findSetField(ir.operations, "page-field:home@1:MetaTitle");
    expect(field.fieldName).toBe("MetaTitle");
    expect(field.version).toBe(1);
    expect(field.value).toEqual({ kind: "string", value: "Welcome" });
  });

  it("writes the page layout to __Final Renderings (versioned)", () => {
    const layout = findSetField(ir.operations, "page-layout:home@1");
    expect(layout.fieldId).toBe(LAYOUT_FIELDS.FINAL_RENDERINGS);
    expect(layout.version).toBe(1);
    if (layout.value.kind !== "string") throw new Error("expected string layout");
    expect(layout.value.value).toContain("<r id=");
  });

  it("throws INPUT_INVALID when pagesRoot is unconfigured", () => {
    const { pagesRoot: _omit, ...noPagesRoot } = CONTEXT;
    void _omit;
    expect(() => compilePageRecipe(homePage, noPagesRoot)).toThrowError(/pagesRoot/);
  });

  it("materialises page-local datasource items for scoped placements", () => {
    const scopedPage = {
      ...homePage,
      handle: "scoped@1",
      name: "Scoped",
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "alpha-block@1",
              datasourceRef: { kind: "scoped", slot: "HeroContent" },
            },
          ],
        },
      },
    } satisfies PageRecipe;
    const scopedIr = compilePageRecipe(scopedPage, CONTEXT);
    const pageRef = pageItemId("default", "scoped@1");

    // The `<page>/Data` folder, then the per-slot datasource item.
    const dataFolder = findCreate(scopedIr.operations, "page-data-folder:scoped@1");
    expect(dataFolder.name).toBe("Data");
    expect(dataFolder.parent).toEqual({ kind: "ref-recipe", refKey: pageRef });

    const ds = findCreate(scopedIr.operations, "page-datasource:scoped@1:HeroContent");
    expect(ds.parent).toEqual({ kind: "ref-recipe", refKey: dataFolder.id });
    // Standalone compile (no componentsByHandle) → the datasource item
    // falls back to conforming to the component template itself.
    expect(ds.templateOf).toBe(templateId("default", "alpha-block@1"));

    // The layout `ds` resolves to the materialised item — not a `local:`
    // sentinel.
    const layout = findSetField(scopedIr.operations, "page-layout:scoped@1");
    if (layout.value.kind !== "string") throw new Error("expected string layout");
    expect(layout.value.value).toContain(
      `ds="{${datasourceId(pageRef, "HeroContent").toUpperCase()}}"`
    );
    expect(layout.value.value).not.toContain("local:");
  });

  it("resolves a scoped datasource template via componentsByHandle", () => {
    // A component declaring a separate datasource template — the scoped
    // datasource item conforms to THAT, not the component template.
    const componentWithDs: ComponentTemplateRecipe = {
      ...component("widget@1"),
      datasource: {
        template: { handle: "widget-data@1" },
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [],
        query: [],
      },
    };
    const scopedPage = {
      ...homePage,
      handle: "ds-page@1",
      name: "DsPage",
      layout: {
        placeholders: {
          "headless-main": [
            { componentHandle: "widget@1", datasourceRef: { kind: "scoped", slot: "WidgetData" } },
          ],
        },
      },
    } satisfies PageRecipe;
    const irs = compileRecipeSet([articlePage, componentWithDs, scopedPage], CONTEXT);
    const pageIr = irs.find((ir) => ir.recipeHandle === "ds-page@1")!;
    const ds = findCreate(pageIr.operations, "page-datasource:ds-page@1:WidgetData");
    expect(ds.templateOf).toBe(templateId("default", "widget-data@1"));
  });
});

describe("validateRecipeSet — PageRecipe", () => {
  it("resolves a page whose template is a page-template and placement is allowed", () => {
    const placeholder = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "pb@1",
      key: "headless-main",
      name: "Main",
      displayName: "Main",
      dynamic: false,
      allowedComponents: ["alpha-block@1"],
    } satisfies PlaceholderRecipe;
    const result = validateRecipeSet([
      placeholder,
      articlePage,
      component("alpha-block@1"),
      homePage,
    ]);
    expect(isValid(result)).toBe(true);
  });

  it("flags a page whose template doesn't resolve to a page-template", () => {
    const result = validateRecipeSet([component("alpha-block@1"), homePage]);
    expect(
      result.unresolvedHandles.some(
        (u) => u.fromField === "template" && u.expectedKinds.includes("page-template")
      )
    ).toBe(true);
  });
});

describe("compilePlaceholderRecipe", () => {
  it("emits an empty IR — placeholder emission is the cross-recipe aggregate", () => {
    const placeholder = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "page-body@1",
      key: "headless-main",
      name: "Main",
      displayName: "Page Body",
      dynamic: false,
      allowedComponents: [],
    } satisfies PlaceholderRecipe;
    const ir = compilePlaceholderRecipe(placeholder, CONTEXT);
    expect(ir.operations).toHaveLength(0);
    expect(ir.recipeHandle).toBe("page-body@1");
  });
});

describe("buildPlaceholderSettingsAggregate (via compileRecipeSet)", () => {
  const placeholder = {
    kind: "placeholder",
    schemaVersion: "1",
    handle: "page-body@1",
    key: "headless-main",
    name: "Main",
    displayName: "Page Body",
    dynamic: false,
    allowedComponents: ["alpha-block@1"],
  } satisfies PlaceholderRecipe;

  const recipes: Recipe[] = [
    placeholder,
    component("alpha-block@1"),
    // beta names the key in `placedIn` — the component-side allow push.
    component("beta-block@1", ["headless-main"]),
    // gamma is unrelated — must NOT land in the whitelist.
    component("gamma-block@1"),
  ];
  const irs = compileRecipeSet(recipes, CONTEXT);
  const aggregate = irs.find((ir) => ir.recipeHandle === PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE)!;

  it("emits one Placeholder Settings CreateItem keyed by the placeholder key", () => {
    expect(aggregate).toBeDefined();
    const create = findCreate(aggregate.operations, "placeholder-settings:default:headless-main");
    expect(create.id).toBe(placeholderSettingsId(SITE, "headless-main"));
    expect(create.templateOf).toBe(PLACEHOLDER_TEMPLATE_ID);
    expect(create.path).toBe("/sitecore/content/Demo/Presentation/Placeholder Settings/Main");
    const keyField = create.fields.find((f) => f.fieldId === PLACEHOLDER_FIELDS.PLACEHOLDER_KEY);
    expect(keyField?.value).toEqual({ kind: "string", value: "headless-main" });
  });

  it("Allowed Controls is the union of allowedComponents and placedIn pushes", () => {
    const allowed = findSetField(
      aggregate.operations,
      "placeholder-allowed-controls:default:headless-main"
    );
    expect(allowed.fieldId).toBe(PLACEHOLDER_FIELDS.ALLOWED_CONTROLS);
    if (allowed.value.kind !== "ref-recipe-list") throw new Error("expected ref-recipe-list");
    // alpha (slot-side) + beta (placedIn) — sorted by handle; gamma absent.
    expect(allowed.value.refKeys).toEqual([
      renderingId(SITE, "alpha-block@1"),
      renderingId(SITE, "beta-block@1"),
    ]);
    expect(allowed.value.tolerateMissing).toBe(true);
  });

  it("throws INPUT_INVALID when a placeholder is declared but no root is configured", () => {
    const { placeholderSettingsRoot: _omit, ...noRoot } = CONTEXT;
    void _omit;
    expect(() => compileRecipeSet([placeholder], noRoot)).toThrowError(/placeholderSettingsRoot/);
  });

  it("emits no placeholder aggregate when the set declares no placeholders", () => {
    const none = compileRecipeSet([component("solo-block@1")], CONTEXT);
    expect(
      none.find((ir) => ir.recipeHandle === PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE)
    ).toBeUndefined();
  });

  it("nests a placeholder under its folder path, each segment a Placeholder Settings Folder", () => {
    const foldered = {
      kind: "placeholder",
      schemaVersion: "1",
      handle: "footer-slot@1",
      key: "sxa-footer",
      name: "Footer",
      displayName: "Footer",
      folder: ["Partial Design", "Chrome"],
      dynamic: false,
      allowedComponents: [],
    } satisfies PlaceholderRecipe;
    const agg = compileRecipeSet([foldered], CONTEXT).find(
      (ir) => ir.recipeHandle === PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE
    )!;
    const partialDesign = findCreate(
      agg.operations,
      "placeholder-settings-folder:default:Partial Design"
    );
    expect(partialDesign.templateOf).toBe(PLACEHOLDER_SETTINGS_FOLDER_TEMPLATE_ID);
    expect(partialDesign.parent).toEqual({
      kind: "ref-path",
      value: "/sitecore/content/Demo/Presentation/Placeholder Settings",
    });
    const chrome = findCreate(
      agg.operations,
      "placeholder-settings-folder:default:Partial Design/Chrome"
    );
    expect(chrome.parent).toEqual({ kind: "ref-recipe", refKey: partialDesign.id });
    const item = findCreate(agg.operations, "placeholder-settings:default:sxa-footer");
    expect(item.parent).toEqual({ kind: "ref-recipe", refKey: chrome.id });
    expect(item.path).toBe(
      "/sitecore/content/Demo/Presentation/Placeholder Settings/Partial Design/Chrome/Footer"
    );
  });

  it("shares a grouping folder across placeholders naming the same folder", () => {
    const mk = (handle: string, key: string, name: string): PlaceholderRecipe => ({
      kind: "placeholder",
      schemaVersion: "1",
      handle,
      key,
      name,
      displayName: name,
      folder: ["Shared"],
      dynamic: false,
      allowedComponents: [],
    });
    const agg = compileRecipeSet(
      [mk("a@1", "ph-a", "PhA"), mk("b@1", "ph-b", "PhB")],
      CONTEXT
    ).find((ir) => ir.recipeHandle === PLACEHOLDER_SETTINGS_AGGREGATE_HANDLE)!;
    const folderOps = agg.operations.filter(
      (op) => op.label === "placeholder-settings-folder:default:Shared"
    );
    expect(folderOps).toHaveLength(1);
  });
});

describe("validateRecipeSet — placeholders & page templates", () => {
  const placeholder = {
    kind: "placeholder",
    schemaVersion: "1",
    handle: "page-body@1",
    key: "headless-main",
    name: "Main",
    displayName: "Page Body",
    dynamic: false,
    allowedComponents: ["alpha-block@1"],
  } satisfies PlaceholderRecipe;

  const pageDesign = (placedComponent: string): PageDesignRecipe =>
    ({
      kind: "page-design",
      schemaVersion: "1",
      handle: "demo-design@1",
      name: "DemoDesign",
      displayName: "Demo Design",
      appliesTo: ["article-page@1"],
      partials: [],
      layout: {
        placeholders: {
          "headless-main": [{ componentHandle: placedComponent }],
        },
      },
    }) satisfies PageDesignRecipe;

  it("passes when a placement targets a component the placeholder allows", () => {
    const result = validateRecipeSet([
      placeholder,
      articlePage,
      component("alpha-block@1"),
      pageDesign("alpha-block@1"),
    ]);
    expect(result.placementViolations).toHaveLength(0);
    expect(isValid(result)).toBe(true);
  });

  it("flags a PlacementViolation when a placement targets a disallowed component", () => {
    const result = validateRecipeSet([
      placeholder,
      articlePage,
      component("alpha-block@1"),
      component("rogue-block@1"),
      pageDesign("rogue-block@1"),
    ]);
    expect(result.placementViolations).toHaveLength(1);
    expect(result.placementViolations[0]).toMatchObject({
      fromRecipe: "demo-design@1",
      componentHandle: "rogue-block@1",
      placeholderKey: "headless-main",
    });
    expect(isValid(result)).toBe(false);
  });

  it("flags a placeholder key declared by more than one recipe", () => {
    const dup = {
      ...placeholder,
      handle: "page-body-dup@1",
      name: "MainDup",
    } satisfies PlaceholderRecipe;
    const result = validateRecipeSet([placeholder, dup]);
    expect(result.fieldShapeErrors.some((e) => e.message.includes("headless-main"))).toBe(true);
  });

  it("flags a page-design appliesTo that doesn't resolve to a page-template", () => {
    const result = validateRecipeSet([component("alpha-block@1"), pageDesign("alpha-block@1")]);
    // article-page@1 isn't in the set — appliesTo is unresolved.
    expect(result.unresolvedHandles.some((u) => u.fromField.startsWith("appliesTo"))).toBe(true);
  });
});

describe("example recipes — page-level kinds", () => {
  it("article-page + home-page parse as PageTemplateRecipe and compile", () => {
    expect(() => PageTemplateRecipeSchema.parse(articlePageRecipe)).not.toThrow();
    expect(() => PageTemplateRecipeSchema.parse(homePageRecipe)).not.toThrow();
    const ir = compilePageTemplateRecipe(
      PageTemplateRecipeSchema.parse(articlePageRecipe),
      CONTEXT
    );
    expect(ir.operations.length).toBeGreaterThan(0);
  });

  it("page-body-placeholder parses as PlaceholderRecipe", () => {
    expect(() => PlaceholderRecipeSchema.parse(pageBodyPlaceholderRecipe)).not.toThrow();
  });

  it("site-home parses as PageRecipe and compiles", () => {
    expect(() => PageRecipeSchema.parse(siteHomeRecipe)).not.toThrow();
    const ir = compilePageRecipe(PageRecipeSchema.parse(siteHomeRecipe), CONTEXT);
    expect(ir.operations.length).toBeGreaterThan(0);
  });
});
