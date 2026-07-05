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
  pageDesignId,
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
  PAGE_DESIGN_FIELD_ID,
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_SETTINGS_FOLDER_TEMPLATE_ID,
  PLACEHOLDER_TEMPLATE_ID,
  SITECORE_TEMPLATES,
  STANDARD_TEMPLATE_ID,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SXA_JSON_LAYOUT_ID,
  SYSTEM_FIELDS,
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

  it("inherits the collection's scaffolded Page template by path (facet fallback) when the collection is known", () => {
    const ir2 = compilePageTemplateRecipe(articlePage, {
      ...CONTEXT,
      sitePathSegment: "Acme Collection/acme",
    });
    const base = ir2.operations.find(
      (op): op is SetBaseTemplatesOp => op.op === "SetBaseTemplates"
    )!;
    // Static list carries only Standard — the SXA page chain arrives via
    // the path-resolved collection Page (or its facet fallbacks).
    expect(base.baseTemplates).toEqual([STANDARD_TEMPLATE_ID]);
    expect(base.pathBases).toEqual([
      {
        path: "/sitecore/templates/Project/Acme Collection/Page",
        fallbackTemplates: [...SXA_HEADLESS_PAGE_BASE_TEMPLATES],
      },
    ]);
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
    // Labels carry the (lang.version) tag — default-language fields use
    // the `en` tag to match the multi-language emit shape.
    const field = findSetField(ir.operations, "page-field:home@1:en:MetaTitle");
    expect(field.fieldName).toBe("MetaTitle");
    expect(field.version).toBe(1);
    expect(field.value).toEqual({ kind: "string", value: "Welcome" });
  });

  it("writes the page layout to __Final Renderings (versioned)", () => {
    const layout = findSetField(ir.operations, "page-layout:home@1:en");
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
    const layout = findSetField(scopedIr.operations, "page-layout:scoped@1:en");
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

  it("resolves a compatible-datasources (templates[]) component to its FIRST template", () => {
    // The link-list pattern: the component declares `datasource.templates[]`
    // and ships NO component-template item of its own — fields live on the
    // listed content templates. The component-handle fallback would emit a
    // refKey nothing creates ("Cannot find a template" at apply time); the
    // scoped datasource must conform to the first compatible template.
    const compatible: ComponentTemplateRecipe = {
      ...component("link-list@1"),
      datasource: {
        templates: [{ handle: "link-list-content@1" }, { handle: "social-follow-content@1" }],
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [],
        query: [],
      },
    };
    const footerPage = {
      ...homePage,
      handle: "footer-page@1",
      name: "FooterPage",
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "link-list@1",
              variant: "Horizontal",
              datasourceRef: { kind: "scoped", slot: "FooterLinks" },
            },
          ],
        },
      },
    } satisfies PageRecipe;
    const irs = compileRecipeSet([articlePage, compatible, footerPage], CONTEXT);
    const pageIr = irs.find((ir) => ir.recipeHandle === "footer-page@1")!;
    const ds = findCreate(pageIr.operations, "page-datasource:footer-page@1:FooterLinks");
    expect(ds.templateOf).toBe(templateId("default", "link-list-content@1"));
    expect(ds.templateOf).not.toBe(templateId("default", "link-list@1"));
  });

  it("stamps the page Data folder with Insert Options drawn from EVERY placement's datasource template", () => {
    // Single-template component (inline-fields fallback), single-template
    // via `datasource.template`, and multi-template via `datasource.templates`
    // all need to appear in the Data folder's `__Masters` — authors who
    // turn off autoCreate on any rendering, or want to add a datasource
    // later, see the right Insert Options in the right-click menu.
    const inlineComponent = component("inline-block@1"); // no datasource block → fallback to handle itself
    const refComponent: ComponentTemplateRecipe = {
      ...component("widget@1"),
      datasource: {
        template: { handle: "widget-data@1" },
        autoCreate: true,
        openPropertiesAfterAdd: false,
        locations: [],
        query: [],
      },
    };
    const multiComponent: ComponentTemplateRecipe = {
      ...component("avatar-block@1"),
      datasource: {
        templates: [{ handle: "avatar-block@1" }, { handle: "author@1" }],
        autoCreate: false,
        openPropertiesAfterAdd: false,
        locations: [],
        query: [],
      },
    };
    const page = {
      ...homePage,
      handle: "multi-ds-page@1",
      name: "MultiDsPage",
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "inline-block@1",
              datasourceRef: { kind: "scoped", slot: "Inline" },
            },
            {
              componentHandle: "widget@1",
              datasourceRef: { kind: "scoped", slot: "Widget" },
            },
            // Second placement of the same component — Insert Options
            // should NOT duplicate templates across placements.
            {
              componentHandle: "widget@1",
              datasourceRef: { kind: "scoped", slot: "Widget2" },
            },
            {
              componentHandle: "avatar-block@1",
              datasourceRef: { kind: "scoped", slot: "Avatar" },
            },
          ],
        },
      },
    } satisfies PageRecipe;
    const irs = compileRecipeSet(
      [articlePage, inlineComponent, refComponent, multiComponent, page],
      CONTEXT
    );
    const pageIr = irs.find((ir) => ir.recipeHandle === "multi-ds-page@1")!;
    const insert = findSetField(
      pageIr.operations,
      "page-data-folder-insert-options:multi-ds-page@1"
    );
    expect(insert.itemRefKey).toBe(datasourceId(pageItemId("default", "multi-ds-page@1"), "Data"));
    expect(insert.fieldId).toBe(SYSTEM_FIELDS.INSERT_OPTIONS);
    if (insert.value.kind !== "ref-recipe-list") {
      throw new Error(`expected ref-recipe-list, got ${insert.value.kind}`);
    }
    expect(insert.value.refKeys).toEqual([
      templateId("default", "inline-block@1"),
      templateId("default", "widget-data@1"),
      templateId("default", "avatar-block@1"),
      templateId("default", "author@1"),
    ]);
  });

  it("omits the Data folder Insert Options write when no scoped slots exist (no Data folder to stamp)", () => {
    // homePage has only `datasourceRef: { kind: "none" }`, so no Data
    // folder is created. The Insert Options SetField rides with the
    // folder — both are absent.
    expect(ir.operations.find((op) => op.label === "page-data-folder:home@1")).toBeUndefined();
    expect(
      ir.operations.find((op) => op.label === "page-data-folder-insert-options:home@1")
    ).toBeUndefined();
  });

  it("standalone compile (no componentsByHandle) falls back to component handle for Insert Options", () => {
    // Without `componentsByHandle`, the compiler can't see datasource.templates[];
    // each placement's componentHandle is the best fallback (matches
    // the existing per-slot templateOf fallback). `tolerateMissing: true`
    // keeps the SetField alive even when those refKeys aren't in the
    // captured-itemId map for this single-recipe push.
    const scopedPage = {
      ...homePage,
      handle: "standalone-scoped@1",
      name: "StandaloneScoped",
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "alpha-block@1",
              datasourceRef: { kind: "scoped", slot: "Hero" },
            },
          ],
        },
      },
    } satisfies PageRecipe;
    const standaloneIr = compilePageRecipe(scopedPage, CONTEXT);
    const insert = findSetField(
      standaloneIr.operations,
      "page-data-folder-insert-options:standalone-scoped@1"
    );
    if (insert.value.kind !== "ref-recipe-list") {
      throw new Error(`expected ref-recipe-list, got ${insert.value.kind}`);
    }
    expect(insert.value.refKeys).toEqual([templateId("default", "alpha-block@1")]);
    expect(insert.value.tolerateMissing).toBe(true);
  });
});

describe("compilePageRecipe — Page Design override", () => {
  it("stamps the SXA _Designable `Page Design` Droplink (shared, ref-recipe) when pageDesign is set", () => {
    const page = {
      ...homePage,
      pageDesign: "standard-page@1",
    } satisfies PageRecipe;
    const ir = compilePageRecipe(page, CONTEXT);
    const create = findCreate(ir.operations, "page:home@1");
    const field = create.fields.find((f) => f.fieldId === PAGE_DESIGN_FIELD_ID);
    expect(field).toBeDefined();
    // Droplink → the recipe-created page-design item; executor resolves the
    // refKey to the real GUID at apply time.
    expect(field?.value).toEqual({
      kind: "ref-recipe",
      refKey: pageDesignId(SITE, "standard-page@1"),
    });
  });

  it("leaves the Page Design field unset when pageDesign is omitted", () => {
    const ir = compilePageRecipe(homePage, CONTEXT);
    const create = findCreate(ir.operations, "page:home@1");
    expect(create.fields.some((f) => f.fieldId === PAGE_DESIGN_FIELD_ID)).toBe(false);
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

describe("compilePageRecipe — multi-language (translations)", () => {
  it("emits AddItemVersion per translation lang + per-(lang,1) SetField", () => {
    const page = {
      ...homePage,
      translations: {
        fr: { fields: { MetaTitle: { shape: "text", value: "Bienvenue" } as const } },
      },
    } satisfies PageRecipe;
    const ir = compilePageRecipe(page, CONTEXT);
    // AddItemVersion for fr@1 (en@1 comes from the CreateItem).
    const addVersion = ir.operations.find(
      (op): op is Extract<Operation, { op: "AddItemVersion" }> =>
        op.op === "AddItemVersion" && (op as { language: string }).language === "fr"
    );
    expect(addVersion).toBeDefined();
    expect(addVersion!.version).toBe(1);
    // SetField for the French Title at fr,v1.
    const frTitle = findSetField(ir.operations, "page-field:home@1:fr:MetaTitle");
    expect(frTitle.language).toBe("fr");
    expect(frTitle.version).toBe(1);
    expect(frTitle.value).toEqual({ kind: "string", value: "Bienvenue" });
    // Item-level layout writes to every language's __Final Renderings.
    const enLayout = findSetField(ir.operations, "page-layout:home@1:en");
    const frLayout = findSetField(ir.operations, "page-layout:home@1:fr");
    expect(enLayout.language).toBe("en");
    expect(frLayout.language).toBe("fr");
  });
});

describe("compilePageRecipe — story mode (versions)", () => {
  const storyPage = {
    kind: "page",
    schemaVersion: "1",
    handle: "story@1",
    name: "Story",
    displayName: "Story",
    template: "article-page@1",
    versions: {
      en: [
        { version: 1, fields: { MetaTitle: { shape: "text", value: "v1 draft" } as const } },
        { version: 2, fields: { MetaTitle: { shape: "text", value: "v2 final" } as const } },
      ],
    },
  } satisfies PageRecipe;

  it("emits AddItemVersion per (lang, version) cell except en/v1", () => {
    const ir = compilePageRecipe(storyPage, CONTEXT);
    const addVersions = ir.operations.filter(
      (op): op is Extract<Operation, { op: "AddItemVersion" }> => op.op === "AddItemVersion"
    );
    // en/v1 already exists via CreateItem; only en/v2 needs AddItemVersion.
    expect(addVersions).toHaveLength(1);
    expect(addVersions[0]).toMatchObject({ language: "en", version: 2 });
    // SetFields at both versions.
    const v1 = findSetField(ir.operations, "page-field:story@1:en.v1:MetaTitle");
    const v2 = findSetField(ir.operations, "page-field:story@1:en.v2:MetaTitle");
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);
    expect(v2.value).toEqual({ kind: "string", value: "v2 final" });
  });

  it("rejects fields/translations alongside versions (XOR)", () => {
    const broken = {
      ...storyPage,
      fields: { MetaTitle: { shape: "text" as const, value: "stray" } },
    } satisfies PageRecipe;
    expect(() => compilePageRecipe(broken, CONTEXT)).toThrowError(/either simple .* or a story/);
  });

  it("rejects item-level layout in story mode", () => {
    const broken = {
      ...storyPage,
      layout: { placeholders: {} },
    } satisfies PageRecipe;
    expect(() => compilePageRecipe(broken, CONTEXT)).toThrowError(
      /item-level 'layout' is not allowed in story mode/
    );
  });
});

describe("compilePageRecipe — {site} itemPath substitution", () => {
  const sitePage = {
    ...homePage,
    handle: "site-path@1",
    name: "SitePath",
    itemPath: "/sitecore/content/{site}/Home/Site Path",
  } satisfies PageRecipe;

  it("substitutes {site} with sitePathSegment (<collection>/<site>)", () => {
    const ir = compilePageRecipe(sitePage, {
      ...CONTEXT,
      sitePathSegment: "Acme Collection/acme",
    });
    const create = findCreate(ir.operations, "page:site-path@1");
    expect(create.path).toBe("/sitecore/content/Acme Collection/acme/Home/Site Path");
    expect(create.parent).toEqual({
      kind: "ref-path",
      value: "/sitecore/content/Acme Collection/acme/Home",
    });
  });

  it("throws INPUT_INVALID when a {site} itemPath compiles without a site path", () => {
    // The pre-fix behaviour substituted the GUID seed ("default" unless
    // siteScopedGuids opted in) and pages landed in a phantom
    // /sitecore/content/default/ tree no site serves.
    expect(() => compilePageRecipe(sitePage, CONTEXT)).toThrowError(/\{site\} placeholder/);
  });
});

describe("compilePageRecipe — mediaLocation", () => {
  const withImage = (mediaLocation?: { scope: "page" | "site"; subfolder?: string }) =>
    ({
      ...homePage,
      fields: {
        Hero: { src: "https://picsum.photos/seed/hero/1200/600", alt: "Hero" },
      },
      ...(mediaLocation ? { mediaLocation } : {}),
    }) as PageRecipe;

  const uploadOf = (ops: Operation[]) => {
    const upload = ops.find((op) => op.op === "MediaUpload");
    if (upload?.op !== "MediaUpload") throw new Error("expected a MediaUpload op");
    return upload;
  };

  it("page scope mirrors the page's directory under the media root", () => {
    const ir = compilePageRecipe(withImage({ scope: "page" }), {
      ...CONTEXT,
      mediaLibraryRoot: "/sitecore/media library/Project/Demo",
    });
    // Home sits directly under pagesRoot → relative path is "Home".
    expect(uploadOf(ir.operations).destinationPath).toMatch(
      /^\/sitecore\/media library\/Project\/Demo\/Home\/Hero-/
    );
  });

  it("page scope appends the declared subfolder", () => {
    const ir = compilePageRecipe(withImage({ scope: "page", subfolder: "Banners" }), {
      ...CONTEXT,
      mediaLibraryRoot: "/sitecore/media library/Project/Demo",
    });
    expect(uploadOf(ir.operations).destinationPath).toMatch(
      /^\/sitecore\/media library\/Project\/Demo\/Home\/Banners\/Hero-/
    );
  });

  it("site scope targets the site-wide pool, skipping recipe-name nesting", () => {
    const ir = compilePageRecipe(withImage({ scope: "site", subfolder: "Shared" }), {
      ...CONTEXT,
      mediaLibraryRoot: "/sitecore/media library/Project/Demo",
    });
    expect(uploadOf(ir.operations).destinationPath).toMatch(
      /^\/sitecore\/media library\/Project\/Demo\/Shared\/Hero-/
    );
  });

  it("no mediaLocation keeps the default <root>/<recipeName>/ bucket", () => {
    const ir = compilePageRecipe(withImage(), {
      ...CONTEXT,
      mediaLibraryRoot: "/sitecore/media library/Project/Demo",
    });
    expect(uploadOf(ir.operations).destinationPath).toMatch(
      /^\/sitecore\/media library\/Project\/Demo\/home\/Hero-/
    );
  });

  it("emits the MediaUpload for a SCOPED datasource image, ordered before its SetField", () => {
    // Regression: the mediaOps spread used to run before the scoped-slots
    // block, whose per-slot emitFields also push MediaUploads into the
    // sink — those late ops were dropped from the IR entirely, and the
    // scoped SetField's media-xml-ref failed at apply time with
    // "refKey not in captured map".
    const scopedImagePage = {
      ...homePage,
      handle: "scoped-img@1",
      name: "ScopedImg",
      fields: {},
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "alpha-block@1",
              datasourceRef: {
                kind: "scoped",
                slot: "HeroMonarch",
                fields: {
                  Image: { src: "https://picsum.photos/seed/monarch/1200/600", alt: "Monarch" },
                },
              },
            },
          ],
        },
      },
    } as PageRecipe;
    const ir = compilePageRecipe(scopedImagePage, CONTEXT);

    const uploadIndex = ir.operations.findIndex((op) => op.op === "MediaUpload");
    expect(uploadIndex).toBeGreaterThan(-1);
    const upload = ir.operations[uploadIndex];
    if (upload.op !== "MediaUpload") throw new Error("expected MediaUpload");

    const setIndex = ir.operations.findIndex(
      (op) =>
        op.op === "SetField" && op.label === "page-field:scoped-img@1:scoped:HeroMonarch:Image"
    );
    expect(setIndex).toBeGreaterThan(-1);
    const set = ir.operations[setIndex];
    if (set.op !== "SetField") throw new Error("expected SetField");
    expect(set.value.kind).toBe("media-xml-ref");
    if (set.value.kind === "media-xml-ref") {
      // The producer op is IN the IR and pairs with the consumer refKey.
      expect(upload.id).toBe(set.value.refKey);
    }
    // ...and applies before the SetField that resolves against its capture.
    expect(uploadIndex).toBeLessThan(setIndex);
  });
});

describe("compilePageRecipe — nested placements (dynamic placeholders)", () => {
  // Mirrors the registry's column-splitter pattern: a layout component
  // hosting scoped-datasource children in its own logical placeholders.
  const nestedPage = {
    ...homePage,
    handle: "nested@1",
    name: "Nested",
    layout: {
      placeholders: {
        "headless-main": [
          {
            componentHandle: "splitter@1",
            variant: "Default",
            params: { Gap: "lg" },
            datasourceRef: { kind: "none" },
            placeholders: {
              "column-1": [
                {
                  componentHandle: "card@1",
                  variant: "MediaStacked",
                  datasourceRef: {
                    kind: "scoped",
                    slot: "LeftCard",
                    fields: { Title: "Left" },
                  },
                },
              ],
              "column-2": [
                {
                  componentHandle: "card@1",
                  datasourceRef: { kind: "scoped", slot: "RightCard", fields: {} },
                },
              ],
            },
          },
        ],
      },
    },
  } satisfies PageRecipe;

  const ir = compilePageRecipe(nestedPage, CONTEXT);
  const layout = findSetField(ir.operations, "page-layout:nested@1:en");
  const xml = layout.value.kind === "string" ? layout.value.value : "";

  it("materialises datasource items for nested scoped placements", () => {
    const pageRef = pageItemId("default", "nested@1");
    const left = findCreate(ir.operations, "page-datasource:nested@1:LeftCard");
    expect(left.path).toBe("/sitecore/content/Demo/Home/Nested/Data/LeftCard");
    expect(xml).toContain(`ds="{${datasourceId(pageRef, "LeftCard").toUpperCase()}}"`);
    const leftTitle = findSetField(ir.operations, "page-field:nested@1:scoped:LeftCard:Title");
    expect(leftTitle.value).toEqual({ kind: "string", value: "Left" });
  });

  it("assigns the parent a DynamicPlaceholderId rendering parameter", () => {
    // par is URL-encoded then XML-escaped; the raw param name survives both.
    expect(xml).toContain("DynamicPlaceholderId%3D1".replace("%3D", "=") /* readable */);
    expect(xml).toMatch(/par="[^"]*DynamicPlaceholderId=1[^"]*"/);
  });

  it("emits children under path-qualified dynamic keys", () => {
    expect(xml).toContain('placeh="/headless-main/column-1-1"');
    expect(xml).toContain('placeh="/headless-main/column-2-1"');
  });

  it("respects an author-set DynamicPlaceholderId and never re-mints it", () => {
    const authored = {
      ...nestedPage,
      handle: "authored@1",
      name: "Authored",
      layout: {
        placeholders: {
          "headless-main": [
            {
              ...nestedPage.layout.placeholders["headless-main"][0],
              params: { Gap: "lg", DynamicPlaceholderId: "7" },
            },
          ],
        },
      },
    } satisfies PageRecipe;
    const authoredIr = compilePageRecipe(authored, CONTEXT);
    const authoredLayout = findSetField(authoredIr.operations, "page-layout:authored@1:en");
    const authoredXml = authoredLayout.value.kind === "string" ? authoredLayout.value.value : "";
    expect(authoredXml).toMatch(/par="[^"]*DynamicPlaceholderId=7[^"]*"/);
    expect(authoredXml).toContain('placeh="/headless-main/column-1-7"');
  });

  it("mints distinct ids for sibling parents (skipping author-used values)", () => {
    const parent = nestedPage.layout.placeholders["headless-main"][0];
    const twoParents = {
      ...nestedPage,
      handle: "two@1",
      name: "Two",
      layout: {
        placeholders: {
          "headless-main": [
            { ...parent, params: { DynamicPlaceholderId: "2" } },
            {
              ...parent,
              placeholders: {
                "column-1": [
                  {
                    componentHandle: "card@1",
                    datasourceRef: { kind: "scoped", slot: "OtherCard", fields: {} },
                  },
                ],
              },
            },
          ],
        },
      },
    } satisfies PageRecipe;
    const twoIr = compilePageRecipe(twoParents, CONTEXT);
    const twoLayout = findSetField(twoIr.operations, "page-layout:two@1:en");
    const twoXml = twoLayout.value.kind === "string" ? twoLayout.value.value : "";
    // Author used 2; the minted id skips it and lands on 1... then 3 would
    // follow. First parent keeps its authored 2, second parent gets 1.
    expect(twoXml).toContain('placeh="/headless-main/column-1-2"');
    expect(twoXml).toContain('placeh="/headless-main/column-1-1"');
  });

  it("compiles arbitrarily deep placement trees (recursive schema)", () => {
    const deep = (levels: number): Record<string, unknown> =>
      levels === 0
        ? {
            componentHandle: "card@1",
            datasourceRef: { kind: "scoped", slot: "DeepCard", fields: {} },
          }
        : {
            componentHandle: "splitter@1",
            datasourceRef: { kind: "none" },
            placeholders: { "column-1": [deep(levels - 1)] },
          };
    const deepPage = {
      ...homePage,
      handle: "deep@1",
      name: "Deep",
      layout: { placeholders: { "headless-main": [deep(6)] } },
    } as unknown as PageRecipe;
    const deepIr = compilePageRecipe(deepPage, CONTEXT);
    const deepLayout = findSetField(deepIr.operations, "page-layout:deep@1:en");
    const deepXml = deepLayout.value.kind === "string" ? deepLayout.value.value : "";
    // Six nested splitters (DynamicPlaceholderIds 1..6), then the card at
    // the innermost path-qualified key.
    expect(deepXml).toContain(
      'placeh="/headless-main/column-1-1/column-1-2/column-1-3/column-1-4/column-1-5/column-1-6"'
    );
    // The innermost scoped datasource still materialises under <page>/Data.
    const deepCard = findCreate(deepIr.operations, "page-datasource:deep@1:DeepCard");
    expect(deepCard.path).toBe("/sitecore/content/Demo/Home/Deep/Data/DeepCard");
  });
});

describe("validateRecipeSet — nested placements", () => {
  it("flags a nested componentHandle that is not in the set", () => {
    const page = {
      ...homePage,
      handle: "nested-check@1",
      name: "NestedCheck",
      layout: {
        placeholders: {
          "headless-main": [
            {
              componentHandle: "alpha-block@1",
              datasourceRef: { kind: "none" },
              placeholders: {
                "column-1": [{ componentHandle: "ghost-card@1", datasourceRef: { kind: "none" } }],
              },
            },
          ],
        },
      },
    } satisfies PageRecipe;
    const result = validateRecipeSet([
      PageRecipeSchema.parse(page),
      PageTemplateRecipeSchema.parse(articlePage),
      component("alpha-block@1"),
    ] as Recipe[]);
    expect(isValid(result)).toBe(false);
    expect(result.unresolvedHandles).toContainEqual(
      expect.objectContaining({
        handle: "ghost-card@1",
        fromField: expect.stringContaining("placeholders.column-1"),
      })
    );
  });
});
