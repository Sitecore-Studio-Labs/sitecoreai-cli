/**
 * Unit tests for the reverse-projection (`src/recipe/read-current.ts`) —
 * live Sitecore items → clean `Recipe` objects.
 *
 * Strategy: a tiny in-memory `AuthoringApiClient` built from a flat list of
 * `RemoteItem` fixtures linked by `parentId`. Each fixture set represents
 * one of the four reverse-projectable item layouts; the assertions check the
 * shape of the `Recipe` objects `readCurrentRecipes` reconstructs.
 *
 * The round-trip test compiles the projected recipes back through
 * `compileRecipeSet` to prove the result is at least buildable.
 *
 * No `vi.mock` is used here — the client is a plain object, so there are no
 * relative-path-mock concerns.
 */
import { describe, expect, it } from "vitest";
import { v5 as uuidv5 } from "uuid";
import type {
  AuthoringApiClient,
  CreateItemInput,
  CreateItemResult,
  ItemSelector,
  RemoteItem,
} from "../../../src/recipe/api/client";
import { readCurrentRecipes, type ReadCurrentRoots } from "../../../src/recipe/items/read-current";
import { SCAI_HANDLE_FIELD_NAME } from "../../../src/recipe/items/marker";
import { compileRecipeSet } from "../../../src/recipe/compile";
import { emitLayoutXml, type LayoutEmitContext } from "../../../src/recipe/layout/emit";
import { encodeTemplatesMapping } from "../../../src/recipe/layout/templates-mapping";
import {
  COMPOSITION_FIELDS,
  DEFAULT_DEVICE_ID,
  LAYOUT_FIELDS,
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_TEMPLATE_ID,
  RENDERING_FIELDS,
  SITECORE_TEMPLATES,
  SXA_COMPONENT_BASE_TEMPLATES,
  SXA_HEADLESS_PAGE_BASE_TEMPLATES,
  SYSTEM_FIELDS,
  TEMPLATE_FIELD_FIELDS,
} from "../../../src/recipe/ir/sitecore-templates";
import { sitecoreFieldTypeLabel } from "../../../src/recipe/schema/field-types";
import type {
  ComponentSectionRecipe,
  ComponentTemplateRecipe,
  ContentTemplateRecipe,
  EnumerationRecipe,
  PageDesignRecipe,
  PageRecipe,
  PageTemplateRecipe,
  PartialDesignRecipe,
  PlaceholderRecipe,
} from "../../../src/recipe/schema/recipe";

// ─────────────────────────────────────────────────────────────────────────
// In-memory AuthoringApiClient over a flat RemoteItem list.
// ─────────────────────────────────────────────────────────────────────────

/** Build a read-only `AuthoringApiClient` backed by `items` (parentId-linked). */
const makeClient = (items: RemoteItem[]): AuthoringApiClient => {
  const byId = new Map(items.map((i) => [i.itemId, i]));
  const byPath = new Map(items.map((i) => [i.path, i]));
  const resolve = (selector: ItemSelector): RemoteItem | null => {
    if (selector.itemId) return byId.get(selector.itemId) ?? null;
    if (selector.path) return byPath.get(selector.path) ?? null;
    return null;
  };
  return {
    getItem: async (selector) => resolve(selector),
    getItemsByPaths: async (paths) => new Map(paths.map((p) => [p, byPath.get(p) ?? null])),
    getChildren: async (selector) => {
      const parent = resolve(selector);
      if (!parent) return [];
      return items.filter((i) => i.parentId === parent.itemId);
    },
    createItem: async (_input: CreateItemInput): Promise<CreateItemResult> => {
      throw new Error("read-only test client: createItem must not be called");
    },
    updateItem: async () => {
      throw new Error("read-only test client: updateItem must not be called");
    },
    deleteItem: async () => {
      throw new Error("read-only test client: deleteItem must not be called");
    },
    addItemVersion: async () => {
      throw new Error("read-only test client: addItemVersion must not be called");
    },
    getItemVersions: async () => [],
  };
};

// ─────────────────────────────────────────────────────────────────────────
// Fixture builders — keep each RemoteItem terse.
// ─────────────────────────────────────────────────────────────────────────

let idSeq = 0;
/**
 * Deterministic, sequence-stable item GUIDs. `uuidv5` (not `id-N`) so the
 * itemIds are real UUIDs — `emitLayoutXml` seeds `placementUid` off the
 * parent itemId, and uuid v14 rejects a non-UUID namespace. The DNS
 * namespace + a per-sequence seed keeps each fixture set reproducible
 * across the `idSeq = 0` resets the tests do.
 */
const DNS_NAMESPACE = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const nextId = () => uuidv5(`fixture-item:${(idSeq += 1)}`, DNS_NAMESPACE);

interface ItemSpec {
  name: string;
  templateId: string;
  parentId: string;
  path: string;
  fields?: RemoteItem["fields"];
}
const item = (spec: ItemSpec): RemoteItem => ({
  itemId: nextId(),
  name: spec.name,
  templateId: spec.templateId,
  parentId: spec.parentId,
  path: spec.path,
  fields: spec.fields ?? [],
});

/** A shared field carrying a raw string value. */
const f = (fieldId: string, value: string, name?: string) => ({
  fieldId,
  value,
  ...(name !== undefined && { name }),
});

const ROOT_PARENT = "ROOT";

// ─────────────────────────────────────────────────────────────────────────
// component-section + component-template
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — component-section + component-template", () => {
  it("reverse-projects a section folder and its component templates", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";

    const compRootItem = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });

    // Section folder directly under componentsRoot.
    const section = item({
      name: "ui",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: compRootItem.itemId,
      path: `${componentsRoot}/ui`,
      fields: [
        f(SYSTEM_FIELDS.DISPLAY_NAME, "UI Components", "__Display name"),
        f(SYSTEM_FIELDS.ICON, "office/16x16/folder.png", "__Icon"),
        f(SYSTEM_FIELDS.SORT_ORDER, "200", "__Sortorder"),
      ],
    });

    // Component template under the section, carrying the SXA component bases.
    const ctaTemplate = item({
      name: "CtaButton",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: section.itemId,
      path: `${componentsRoot}/ui/CtaButton`,
      fields: [
        f(SYSTEM_FIELDS.DISPLAY_NAME, "CTA Button", "__Display name"),
        f(SYSTEM_FIELDS.BASE_TEMPLATE, SXA_COMPONENT_BASE_TEMPLATES.join("|"), "__Base template"),
      ],
    });
    const contentSection = item({
      name: "Content",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: ctaTemplate.itemId,
      path: `${componentsRoot}/ui/CtaButton/Content`,
    });
    const labelField = item({
      name: "Label",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: contentSection.itemId,
      path: `${componentsRoot}/ui/CtaButton/Content/Label`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("single-line-text"), "Type"),
        f(SYSTEM_FIELDS.SORT_ORDER, "100", "__Sortorder"),
      ],
    });
    const bodyField = item({
      name: "Body",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: contentSection.itemId,
      path: `${componentsRoot}/ui/CtaButton/Content/Body`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("rich-text"), "Type"),
        f(SYSTEM_FIELDS.SORT_ORDER, "200", "__Sortorder"),
      ],
    });
    const standardValues = item({
      name: "__Standard Values",
      templateId: SITECORE_TEMPLATES.TEMPLATE, // SV conforms to the template
      parentId: ctaTemplate.itemId,
      path: `${componentsRoot}/ui/CtaButton/__Standard Values`,
    });

    // Rendering item — its presence is also enough to classify a template
    // as a component (here CtaButton has SXA bases anyway).
    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    const rSection = item({
      name: "ui",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/ui`,
    });
    const rendering = item({
      name: "CtaButton",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rSection.itemId,
      path: `${renderingsRoot}/ui/CtaButton`,
      fields: [f(RENDERING_FIELDS.COMPONENT_NAME, "CtaButton", "ComponentName")],
    });

    const client = makeClient([
      compRootItem,
      section,
      ctaTemplate,
      contentSection,
      labelField,
      bodyField,
      standardValues,
      rRoot,
      rSection,
      rendering,
    ]);
    const roots: ReadCurrentRoots = {
      templatesRoot: componentsRoot,
      renderingsRoot,
      componentsRoot,
    };

    const recipes = await readCurrentRecipes(roots, client);
    expect(recipes).not.toBeNull();

    const sectionRecipe = recipes!.find(
      (r): r is ComponentSectionRecipe => r.kind === "component-section"
    );
    expect(sectionRecipe).toBeDefined();
    expect(sectionRecipe!.name).toBe("ui");
    expect(sectionRecipe!.displayName).toBe("UI Components");
    expect(sectionRecipe!.icon).toBe("office/16x16/folder.png");
    expect(sectionRecipe!.sortOrder).toBe(200);
    expect(sectionRecipe!.handle).toBe("ui@1");

    const component = recipes!.find(
      (r): r is ComponentTemplateRecipe => r.kind === "component-template"
    );
    expect(component).toBeDefined();
    expect(component!.name).toBe("CtaButton");
    expect(component!.displayName).toBe("CTA Button");
    expect(component!.handle).toBe("cta-button@1");
    // The component references its section by (synthesised) handle.
    expect(component!.section).toEqual({ handle: "ui@1" });
    // Fields reverse-project in sort order with their Sitecore types.
    expect(component!.fields.map((fd) => fd.name)).toEqual(["Label", "Body"]);
    expect(component!.fields[0].shape).toBe("text");
    expect(component!.fields[0].sitecore?.type).toBe("single-line-text");
    expect(component!.fields[1].shape).toBe("richText");
    expect(component!.fields[1].sitecore?.type).toBe("rich-text");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// content-template
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — content-template", () => {
  it("reverse-projects a content template with a taxonomy group folder", async () => {
    idSeq = 0;
    const contentModelsRoot = "/sitecore/templates/Project/demo/Content Models";

    const cmRoot = item({
      name: "Content Models",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: contentModelsRoot,
    });
    // Group folder directly under contentModelsRoot.
    const group = item({
      name: "Accordion",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: cmRoot.itemId,
      path: `${contentModelsRoot}/Accordion`,
    });
    // Content template — no SXA bases, no rendering → content-template.
    const template = item({
      name: "AccordionItem",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: group.itemId,
      path: `${contentModelsRoot}/Accordion/AccordionItem`,
      fields: [f(SYSTEM_FIELDS.DISPLAY_NAME, "Accordion Item", "__Display name")],
    });
    const section = item({
      name: "Content",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${contentModelsRoot}/Accordion/AccordionItem/Content`,
    });
    const titleField = item({
      name: "Title",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: section.itemId,
      path: `${contentModelsRoot}/Accordion/AccordionItem/Content/Title`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("single-line-text"), "Type"),
        f(SYSTEM_FIELDS.SORT_ORDER, "100", "__Sortorder"),
      ],
    });

    const client = makeClient([cmRoot, group, template, section, titleField]);
    const roots: ReadCurrentRoots = {
      templatesRoot: "/sitecore/templates/Project/demo",
      renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
      contentModelsRoot,
    };

    const recipes = await readCurrentRecipes(roots, client);
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    expect(content).toBeDefined();
    expect(content!.name).toBe("AccordionItem");
    expect(content!.displayName).toBe("Accordion Item");
    expect(content!.handle).toBe("accordion-item@1");
    // Group folder name reverse-projects onto meta.tax.group.
    expect(content!.meta?.tax?.group).toBe("Accordion");
    expect(content!.fields.map((fd) => fd.name)).toEqual(["Title"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// page-template
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — page-template", () => {
  it("reverse-projects a Template carrying the SXA page base set", async () => {
    idSeq = 0;
    const pageTemplatesRoot = "/sitecore/templates/Project/demo";

    const ptRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: pageTemplatesRoot,
    });
    // Template carrying the SXA page base set → page-template (not a
    // component, not a plain content template).
    const template = item({
      name: "ArticlePage",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: ptRoot.itemId,
      path: `${pageTemplatesRoot}/ArticlePage`,
      fields: [
        f(SYSTEM_FIELDS.DISPLAY_NAME, "Article Page", "__Display name"),
        f(
          SYSTEM_FIELDS.BASE_TEMPLATE,
          SXA_HEADLESS_PAGE_BASE_TEMPLATES.join("|"),
          "__Base template"
        ),
      ],
    });
    const section = item({
      name: "SEO",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${pageTemplatesRoot}/ArticlePage/SEO`,
    });
    const metaField = item({
      name: "MetaTitle",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: section.itemId,
      path: `${pageTemplatesRoot}/ArticlePage/SEO/MetaTitle`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("single-line-text"), "Type"),
        f(SYSTEM_FIELDS.SORT_ORDER, "100", "__Sortorder"),
      ],
    });

    const client = makeClient([ptRoot, template, section, metaField]);
    const roots: ReadCurrentRoots = {
      templatesRoot: "/sitecore/templates/Project",
      renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
      pageTemplatesRoot,
    };

    const recipes = await readCurrentRecipes(roots, client);
    const page = recipes!.find((r): r is PageTemplateRecipe => r.kind === "page-template");
    expect(page).toBeDefined();
    expect(page!.name).toBe("ArticlePage");
    expect(page!.displayName).toBe("Article Page");
    expect(page!.handle).toBe("article-page@1");
    expect(page!.fields.map((fd) => fd.name)).toEqual(["MetaTitle"]);
    // Not misclassified as a component or content template.
    expect(recipes!.filter((r) => r.kind === "component-template")).toHaveLength(0);
    expect(recipes!.filter((r) => r.kind === "content-template")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// enumeration
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — enumeration", () => {
  it("reverse-projects an enumeration container with values and a default", async () => {
    idSeq = 0;
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";

    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    // Container item — children are value leaves.
    const container = item({
      name: "ColorScheme",
      templateId: SITECORE_TEMPLATES.TEMPLATE, // per-site Enumeration template
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/ColorScheme`,
      fields: [
        f(SYSTEM_FIELDS.DISPLAY_NAME, "Color Scheme", "__Display name"),
        f("be351a73-0000-0000-0000-000000000000", "primary", "Value"),
      ],
    });
    const primary = item({
      name: "primary",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/ColorScheme/primary`,
      fields: [f(SYSTEM_FIELDS.SORT_ORDER, "100", "__Sortorder")],
    });
    const accent = item({
      name: "accent",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/ColorScheme/accent`,
      fields: [
        f(SYSTEM_FIELDS.SORT_ORDER, "200", "__Sortorder"),
        f(SYSTEM_FIELDS.DISPLAY_NAME, "Accent", "__Display name"),
      ],
    });

    const client = makeClient([enumRoot, container, primary, accent]);
    const roots: ReadCurrentRoots = {
      templatesRoot: "/sitecore/templates/Project/demo",
      renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
      enumerationsRoot,
    };

    const recipes = await readCurrentRecipes(roots, client);
    const enumeration = recipes!.find((r): r is EnumerationRecipe => r.kind === "enumeration");
    expect(enumeration).toBeDefined();
    expect(enumeration!.name).toBe("ColorScheme");
    expect(enumeration!.displayName).toBe("Color Scheme");
    expect(enumeration!.values.map((v) => v.name)).toEqual(["primary", "accent"]);
    // accent carries a display name; primary's matches its name → omitted.
    expect(enumeration!.values[0].displayName).toBeUndefined();
    expect(enumeration!.values[1].displayName).toBe("Accent");
    // default is read off the container's `Value` field and is one of values.
    expect(enumeration!.default).toBe("primary");
  });

  it("reverse-projects a grouped enumeration (location.folder)", async () => {
    idSeq = 0;
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";

    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    const groupFolder = item({
      name: "Theme",
      templateId: SITECORE_TEMPLATES.TEMPLATE, // per-site Enumerations Folder template
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/Theme`,
    });
    const container = item({
      name: "Spacing",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: groupFolder.itemId,
      path: `${enumerationsRoot}/Theme/Spacing`,
    });
    const sm = item({
      name: "sm",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/Theme/Spacing/sm`,
    });

    const client = makeClient([enumRoot, groupFolder, container, sm]);
    const roots: ReadCurrentRoots = {
      templatesRoot: "/sitecore/templates/Project/demo",
      renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
      enumerationsRoot,
    };

    const recipes = await readCurrentRecipes(roots, client);
    const enumeration = recipes!.find((r): r is EnumerationRecipe => r.kind === "enumeration");
    expect(enumeration).toBeDefined();
    expect(enumeration!.name).toBe("Spacing");
    expect(enumeration!.location).toEqual({ scope: "site", folder: ["Theme"] });
    expect(enumeration!.values.map((v) => v.name)).toEqual(["sm"]);
  });

  it("skips a value-less enumeration container (schema requires values.min(1))", async () => {
    idSeq = 0;
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";
    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    // A single childless item under the root is neither folder nor container.
    const empty = item({
      name: "Empty",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/Empty`,
    });

    const client = makeClient([enumRoot, empty]);
    const recipes = await readCurrentRecipes(
      {
        templatesRoot: "/t",
        renderingsRoot: "/r",
        enumerationsRoot,
      },
      client
    );
    expect(recipes!.filter((r) => r.kind === "enumeration")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// edge cases
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — edge cases", () => {
  it("returns null when no recipe roots are configured at all", async () => {
    const client = makeClient([]);
    const result = await readCurrentRecipes({ templatesRoot: "", renderingsRoot: "" }, client);
    expect(result).toBeNull();
  });

  it("returns an empty array when roots are configured but the trees are absent", async () => {
    const client = makeClient([]); // no items → getItem(root) resolves null
    const result = await readCurrentRecipes(
      {
        templatesRoot: "/sitecore/templates/Project/demo",
        renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
        componentsRoot: "/sitecore/templates/Project/demo/Components",
      },
      client
    );
    expect(result).toEqual([]);
  });

  it("ignores items that match none of the four reverse-projectable patterns", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const compRoot = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    // A bare placeholder-settings-shaped item — not a template/folder/enum.
    const stray = item({
      name: "Stray",
      templateId: "d2a6884c-04d5-4089-a64e-d27ca9d68d4c", // Placeholder template
      parentId: compRoot.itemId,
      path: `${componentsRoot}/Stray`,
    });
    const client = makeClient([compRoot, stray]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: componentsRoot, renderingsRoot: "/r", componentsRoot },
      client
    );
    expect(recipes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// marker-aware handle resolution (`Scai Handle`)
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — Scai Handle marker", () => {
  it("recovers the exact authored handle from the marker, not a synthesised one", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";

    const compRootItem = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    // Section folder + component template both carry markers whose handles
    // deliberately differ from what `handleFromName` would synthesise — the
    // `@5` / `@9` majors and the unrelated `interactive` slug can only come
    // from the stored marker.
    const section = item({
      name: "ui",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: compRootItem.itemId,
      path: `${componentsRoot}/ui`,
      fields: [f("scai-handle-id", "interactive@5", SCAI_HANDLE_FIELD_NAME)],
    });
    const ctaTemplate = item({
      name: "CtaButton",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: section.itemId,
      path: `${componentsRoot}/ui/CtaButton`,
      fields: [
        f(SYSTEM_FIELDS.BASE_TEMPLATE, SXA_COMPONENT_BASE_TEMPLATES.join("|"), "__Base template"),
        f("scai-handle-id", "cta-button@9", SCAI_HANDLE_FIELD_NAME),
      ],
    });

    const client = makeClient([compRootItem, section, ctaTemplate]);
    const roots: ReadCurrentRoots = {
      templatesRoot: componentsRoot,
      renderingsRoot,
      componentsRoot,
    };

    const recipes = await readCurrentRecipes(roots, client);
    const sectionRecipe = recipes!.find(
      (r): r is ComponentSectionRecipe => r.kind === "component-section"
    );
    const component = recipes!.find(
      (r): r is ComponentTemplateRecipe => r.kind === "component-template"
    );

    // Handles come straight off the marker, not `kebab(name)@1`.
    expect(sectionRecipe!.handle).toBe("interactive@5");
    expect(component!.handle).toBe("cta-button@9");
    // The component's section reference points at the section's MARKER
    // handle — the two recipes stay linked by identity, not by item name.
    expect(component!.section).toEqual({ handle: "interactive@5" });
  });

  it("falls back to a synthesised handle for an unmarked item", async () => {
    idSeq = 0;
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";
    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    // No `Scai Handle` field — a first capture of an environment scai never
    // pushed to. The handle is synthesised from the name.
    const container = item({
      name: "ColorScheme",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/ColorScheme`,
    });
    const primary = item({
      name: "primary",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/ColorScheme/primary`,
    });

    const client = makeClient([enumRoot, container, primary]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", enumerationsRoot },
      client
    );
    const enumeration = recipes!.find((r): r is EnumerationRecipe => r.kind === "enumeration");
    expect(enumeration!.handle).toBe("color-scheme@1");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// round-trip — fixtures → readCurrent → recipes → compileRecipeSet
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — round-trip through the compiler", () => {
  it("projects recipes that compile back to a buildable IR set", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";

    // --- templates tree: one section + one component template ---
    const compRoot = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    const section = item({
      name: "ui",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: compRoot.itemId,
      path: `${componentsRoot}/ui`,
      fields: [f(SYSTEM_FIELDS.DISPLAY_NAME, "UI", "__Display name")],
    });
    const template = item({
      name: "Hero",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: section.itemId,
      path: `${componentsRoot}/ui/Hero`,
      fields: [
        f(SYSTEM_FIELDS.DISPLAY_NAME, "Hero", "__Display name"),
        f(SYSTEM_FIELDS.BASE_TEMPLATE, SXA_COMPONENT_BASE_TEMPLATES.join("|"), "__Base template"),
      ],
    });
    const contentSection = item({
      name: "Content",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${componentsRoot}/ui/Hero/Content`,
    });
    const headingField = item({
      name: "Heading",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: contentSection.itemId,
      path: `${componentsRoot}/ui/Hero/Content/Heading`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("single-line-text"), "Type"),
        f(SYSTEM_FIELDS.SORT_ORDER, "100", "__Sortorder"),
      ],
    });

    // --- enumeration ---
    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    const container = item({
      name: "Size",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/Size`,
    });
    const lg = item({
      name: "lg",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/Size/lg`,
    });

    const client = makeClient([
      compRoot,
      section,
      template,
      contentSection,
      headingField,
      enumRoot,
      container,
      lg,
    ]);
    const roots: ReadCurrentRoots = {
      templatesRoot: componentsRoot,
      renderingsRoot,
      componentsRoot,
      enumerationsRoot,
    };

    const recipes = await readCurrentRecipes(roots, client);
    expect(recipes).not.toBeNull();
    expect(recipes!.map((r) => r.kind).sort()).toEqual([
      "component-section",
      "component-template",
      "enumeration",
    ]);

    // The projected recipe set compiles without throwing — the strongest
    // available proof the projection is structurally coherent.
    const irs = compileRecipeSet(recipes!, {
      templatesRoot: componentsRoot,
      renderingsRoot,
      componentsRoot,
      enumerationsRoot,
    });
    expect(irs.length).toBeGreaterThan(0);
    // Every emitted IR carries a recipe handle and at least one operation
    // for the non-aggregate recipes.
    for (const ir of irs) {
      expect(typeof ir.recipeHandle).toBe("string");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// field storage axis (sitecore.storage)
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — field storage axis", () => {
  it("reverse-projects the Shared / Unversioned flags onto sitecore.storage", async () => {
    idSeq = 0;
    const contentModelsRoot = "/sitecore/templates/Project/demo/Content Models";

    const cmRoot = item({
      name: "Content Models",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: contentModelsRoot,
    });
    const template = item({
      name: "Story",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: cmRoot.itemId,
      path: `${contentModelsRoot}/Story`,
    });
    const section = item({
      name: "Content",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${contentModelsRoot}/Story/Content`,
    });
    const textType = sitecoreFieldTypeLabel("single-line-text");
    // Headline: no flags → versioned. Locale: Shared. Summary: Unversioned.
    const headline = item({
      name: "Headline",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: section.itemId,
      path: `${contentModelsRoot}/Story/Content/Headline`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, textType, "Type"),
        f(SYSTEM_FIELDS.SORT_ORDER, "100", "__Sortorder"),
      ],
    });
    const locale = item({
      name: "Locale",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: section.itemId,
      path: `${contentModelsRoot}/Story/Content/Locale`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, textType, "Type"),
        f(TEMPLATE_FIELD_FIELDS.SHARED, "1", "Shared"),
        f(SYSTEM_FIELDS.SORT_ORDER, "200", "__Sortorder"),
      ],
    });
    const summary = item({
      name: "Summary",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: section.itemId,
      path: `${contentModelsRoot}/Story/Content/Summary`,
      fields: [
        f(TEMPLATE_FIELD_FIELDS.TYPE, textType, "Type"),
        f(TEMPLATE_FIELD_FIELDS.UNVERSIONED, "1", "Unversioned"),
        f(SYSTEM_FIELDS.SORT_ORDER, "300", "__Sortorder"),
      ],
    });

    const client = makeClient([cmRoot, template, section, headline, locale, summary]);
    const recipes = await readCurrentRecipes(
      {
        templatesRoot: "/sitecore/templates/Project/demo",
        renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
        contentModelsRoot,
      },
      client
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    const byName = (n: string) => content!.fields.find((fd) => fd.name === n);

    // `versioned` is the Sitecore default — omitted, never fabricated.
    expect(byName("Headline")?.sitecore?.storage).toBeUndefined();
    expect(byName("Locale")?.sitecore?.storage).toBe("shared");
    expect(byName("Summary")?.sitecore?.storage).toBe("unversioned");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// layout-bearing kinds — partial-design, page-design, page, placeholder
// ─────────────────────────────────────────────────────────────────────────

/**
 * The marker field carrying a recipe handle (`Scai Handle`). Layout-XML
 * reverse-projection resolves `<r>` GUIDs to handles through these.
 */
const marker = (handle: string) => f("scai-handle-id", handle, SCAI_HANDLE_FIELD_NAME);

/**
 * Build a `LayoutEmitContext` whose `renderingIdFor` / `contentItemIdFor`
 * read from explicit handle→itemId maps — so the emitted layout XML
 * references the SAME itemIds the fixture rendering / content items carry.
 * That is what makes the GUID→handle marker index resolve on the way back.
 */
const layoutCtx = (
  parentItemId: string,
  renderings: Record<string, string>,
  contentItems: Record<string, string> = {}
): LayoutEmitContext => ({
  parentItemId,
  deviceId: DEFAULT_DEVICE_ID,
  renderingIdFor: (handle) => {
    const id = renderings[handle];
    if (!id) throw new Error(`test: unknown rendering handle ${handle}`);
    return id;
  },
  contentItemIdFor: (handle) => {
    const id = contentItems[handle];
    if (!id) throw new Error(`test: unknown content-item handle ${handle}`);
    return id;
  },
  allowScoped: false,
});

describe("readCurrentRecipes — partial-design", () => {
  it("reverse-projects a partial design, parsing its delta-form layout XML", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const partialDesignsRoot = "/sitecore/content/demo/Presentation/Partial Designs";

    // Rendering item — carries a marker so the layout `<r id>` resolves.
    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    const logoRendering = item({
      name: "SiteLogo",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/SiteLogo`,
      fields: [marker("site-logo@1")],
    });
    const navRendering = item({
      name: "PrimaryNav",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/PrimaryNav`,
      fields: [marker("primary-nav@1")],
    });

    // Partial design item — its `__Renderings` carries delta-form layout
    // XML (the form `compilePartialDesignRecipe` emits).
    const pdRoot = item({
      name: "Partial Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: partialDesignsRoot,
    });
    const header = item({
      name: "StandardHeader",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/StandardHeader`,
      fields: [
        marker("standard-header@1"),
        f(SYSTEM_FIELDS.DISPLAY_NAME, "Standard Header", "__Display name"),
      ],
    });
    const layoutXml = emitLayoutXml(
      {
        placeholders: {
          "/header": [
            { componentHandle: "site-logo@1", variant: "FullWidth" },
            { componentHandle: "primary-nav@1" },
          ],
        },
      },
      {
        ...layoutCtx(header.itemId, {
          "site-logo@1": logoRendering.itemId,
          "primary-nav@1": navRendering.itemId,
        }),
        mode: "delta",
      }
    );
    header.fields.push(f(LAYOUT_FIELDS.RENDERINGS, layoutXml, "__Renderings"));

    const client = makeClient([rRoot, logoRendering, navRendering, pdRoot, header]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot, partialDesignsRoot },
      client
    );
    const partial = recipes!.find((r): r is PartialDesignRecipe => r.kind === "partial-design");
    expect(partial).toBeDefined();
    expect(partial!.name).toBe("StandardHeader");
    expect(partial!.displayName).toBe("Standard Header");
    expect(partial!.handle).toBe("standard-header@1");
    // Layout XML reverse-parsed: two placements, order preserved, the
    // FieldNames param lifted back to `variant`.
    const placements = partial!.layout.placeholders["/header"];
    expect(placements.map((p) => p.componentHandle)).toEqual(["site-logo@1", "primary-nav@1"]);
    expect(placements[0].variant).toBe("FullWidth");
  });

  it("drops a layout placement whose rendering GUID carries no marker", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const partialDesignsRoot = "/sitecore/content/demo/Presentation/Partial Designs";

    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    // Marked rendering — resolvable.
    const logo = item({
      name: "SiteLogo",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/SiteLogo`,
      fields: [marker("site-logo@1")],
    });
    // Unmarked rendering — unrecoverable; its placement must be dropped.
    const orphan = item({
      name: "OrphanWidget",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/OrphanWidget`,
    });

    const pdRoot = item({
      name: "Partial Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: partialDesignsRoot,
    });
    const header = item({
      name: "Header",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/Header`,
      fields: [marker("header@1")],
    });
    const layoutXml = emitLayoutXml(
      {
        placeholders: {
          "/header": [{ componentHandle: "site-logo@1" }, { componentHandle: "orphan-widget@1" }],
        },
      },
      layoutCtx(header.itemId, {
        "site-logo@1": logo.itemId,
        "orphan-widget@1": orphan.itemId,
      })
    );
    header.fields.push(f(LAYOUT_FIELDS.RENDERINGS, layoutXml, "__Renderings"));

    const client = makeClient([rRoot, logo, orphan, pdRoot, header]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot, partialDesignsRoot },
      client
    );
    const partial = recipes!.find((r): r is PartialDesignRecipe => r.kind === "partial-design");
    // Only the marked placement survives; the orphan is omitted (not
    // fabricated into a dangling handle).
    expect(partial!.layout.placeholders["/header"].map((p) => p.componentHandle)).toEqual([
      "site-logo@1",
    ]);
  });
});

describe("readCurrentRecipes — page-design", () => {
  it("reverse-projects partials and recovers appliesTo from TemplatesMapping", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const pageTemplatesRoot = "/sitecore/templates/Project/demo";
    const partialDesignsRoot = "/sitecore/content/demo/Presentation/Partial Designs";
    const pageDesignsRoot = "/sitecore/content/demo/Presentation/Page Designs";

    // A page template — its marker lets `appliesTo` resolve.
    const ptRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: pageTemplatesRoot,
    });
    const articleTpl = item({
      name: "ArticlePage",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: ptRoot.itemId,
      path: `${pageTemplatesRoot}/ArticlePage`,
      fields: [
        marker("article-page@1"),
        f(
          SYSTEM_FIELDS.BASE_TEMPLATE,
          SXA_HEADLESS_PAGE_BASE_TEMPLATES.join("|"),
          "__Base template"
        ),
      ],
    });

    // A partial design the page design links.
    const pdRoot = item({
      name: "Partial Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: partialDesignsRoot,
    });
    const headerPartial = item({
      name: "Header",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/Header`,
      fields: [marker("standard-header@1")],
    });

    // The Page Designs root carries the cross-recipe TemplatesMapping.
    const pdgRoot = item({
      name: "Page Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pageDesignsRoot,
    });
    const landing = item({
      name: "LandingDesign",
      templateId: SITECORE_TEMPLATES.PAGE_DESIGN,
      parentId: pdgRoot.itemId,
      path: `${pageDesignsRoot}/LandingDesign`,
      fields: [
        marker("landing-design@1"),
        f(SYSTEM_FIELDS.DISPLAY_NAME, "Landing Design", "__Display name"),
        // PartialDesigns — pipe-separated GUID list (one entry here).
        f(COMPOSITION_FIELDS.PARTIAL_DESIGNS, headerPartial.itemId, "PartialDesigns"),
      ],
    });
    // TemplatesMapping on the ROOT — `{tpl}={design}` URL-encoded. The
    // design GUID is the live page-design itemId.
    pdgRoot.fields.push(
      f(
        COMPOSITION_FIELDS.TEMPLATES_MAPPING,
        encodeTemplatesMapping([{ templateGuid: articleTpl.itemId, designGuid: landing.itemId }]),
        "TemplatesMapping"
      )
    );

    const client = makeClient([ptRoot, articleTpl, pdRoot, headerPartial, pdgRoot, landing]);
    const recipes = await readCurrentRecipes(
      {
        templatesRoot: "",
        renderingsRoot,
        pageTemplatesRoot,
        partialDesignsRoot,
        pageDesignsRoot,
      },
      client
    );
    const design = recipes!.find((r): r is PageDesignRecipe => r.kind === "page-design");
    expect(design).toBeDefined();
    expect(design!.name).toBe("LandingDesign");
    expect(design!.handle).toBe("landing-design@1");
    // partials[] resolved from the PartialDesigns GUID list.
    expect(design!.partials).toEqual(["standard-header@1"]);
    // appliesTo recovered from the root's TemplatesMapping slice.
    expect(design!.appliesTo).toEqual(["article-page@1"]);
  });

  it("leaves appliesTo empty when the root carries no TemplatesMapping", async () => {
    idSeq = 0;
    const pageDesignsRoot = "/sitecore/content/demo/Presentation/Page Designs";
    const pdgRoot = item({
      name: "Page Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pageDesignsRoot,
    });
    const design = item({
      name: "BareDesign",
      templateId: SITECORE_TEMPLATES.PAGE_DESIGN,
      parentId: pdgRoot.itemId,
      path: `${pageDesignsRoot}/BareDesign`,
      fields: [marker("bare-design@1")],
    });
    const client = makeClient([pdgRoot, design]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "", pageDesignsRoot },
      client
    );
    const projected = recipes!.find((r): r is PageDesignRecipe => r.kind === "page-design");
    expect(projected!.appliesTo).toEqual([]);
    expect(projected!.partials).toEqual([]);
  });
});

describe("readCurrentRecipes — page", () => {
  it("reverse-projects a page, resolving its template and __Final Renderings", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const pageTemplatesRoot = "/sitecore/templates/Project/demo";
    const pagesRoot = "/sitecore/content/demo/Home";

    // Rendering — marked, so the page layout `<r id>` resolves.
    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    const hero = item({
      name: "Hero",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/Hero`,
      fields: [marker("hero@1")],
    });

    // Page template — marked, so the page's `template` resolves.
    const ptRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: pageTemplatesRoot,
    });
    const articleTpl = item({
      name: "ArticlePage",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: ptRoot.itemId,
      path: `${pageTemplatesRoot}/ArticlePage`,
      fields: [
        marker("article-page@1"),
        f(
          SYSTEM_FIELDS.BASE_TEMPLATE,
          SXA_HEADLESS_PAGE_BASE_TEMPLATES.join("|"),
          "__Base template"
        ),
      ],
    });

    // The page item — conforms to the page template (templateId points at
    // it), carries `__Final Renderings` layout XML.
    const homeRoot = item({
      name: "Home",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pagesRoot,
    });
    const aboutPage = item({
      name: "About",
      templateId: articleTpl.itemId, // conforms to the page template
      parentId: homeRoot.itemId,
      path: `${pagesRoot}/About`,
      fields: [marker("about@1"), f(SYSTEM_FIELDS.DISPLAY_NAME, "About Us", "__Display name")],
    });
    const finalLayout = emitLayoutXml(
      { placeholders: { "/main": [{ componentHandle: "hero@1", variant: "Centered" }] } },
      layoutCtx(aboutPage.itemId, { "hero@1": hero.itemId })
    );
    aboutPage.fields.push(f(LAYOUT_FIELDS.FINAL_RENDERINGS, finalLayout, "__Final Renderings"));

    const client = makeClient([rRoot, hero, ptRoot, articleTpl, homeRoot, aboutPage]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot, pageTemplatesRoot, pagesRoot },
      client
    );
    const page = recipes!.find((r): r is PageRecipe => r.kind === "page");
    expect(page).toBeDefined();
    expect(page!.name).toBe("About");
    expect(page!.displayName).toBe("About Us");
    expect(page!.handle).toBe("about@1");
    // `template` resolved through the marker index.
    expect(page!.template).toBe("article-page@1");
    // `__Final Renderings` reverse-parsed.
    expect(page!.layout!.placeholders["/main"][0].componentHandle).toBe("hero@1");
    expect(page!.layout!.placeholders["/main"][0].variant).toBe("Centered");
    // `fields` is left at the schema default — page field values aren't
    // reverse-projected in v1.
    expect(page!.fields).toEqual({});
  });

  it("skips a page whose template GUID carries no marker", async () => {
    idSeq = 0;
    const pagesRoot = "/sitecore/content/demo/Home";
    const homeRoot = item({
      name: "Home",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pagesRoot,
    });
    // Page item conforming to an UNMARKED template — unrecoverable.
    const orphanPage = item({
      name: "Orphan",
      templateId: "ab86861a-0000-0000-0000-000000000000",
      parentId: homeRoot.itemId,
      path: `${pagesRoot}/Orphan`,
      fields: [marker("orphan@1")],
    });
    const client = makeClient([homeRoot, orphanPage]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "", pagesRoot },
      client
    );
    expect(recipes!.filter((r) => r.kind === "page")).toHaveLength(0);
  });
});

describe("readCurrentRecipes — placeholder", () => {
  it("reverse-projects a Placeholder Settings item with allowed controls", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const placeholderSettingsRoot = "/sitecore/content/demo/Presentation/Placeholder Settings";

    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    const hero = item({
      name: "Hero",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/Hero`,
      fields: [marker("hero@1")],
    });

    const psRoot = item({
      name: "Placeholder Settings",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: placeholderSettingsRoot,
    });
    // A grouping folder + a placeholder leaf under it.
    const groupFolder = item({
      name: "Partial Design",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: psRoot.itemId,
      path: `${placeholderSettingsRoot}/Partial Design`,
    });
    const mainSlot = item({
      name: "MainSlot",
      templateId: PLACEHOLDER_TEMPLATE_ID,
      parentId: groupFolder.itemId,
      path: `${placeholderSettingsRoot}/Partial Design/MainSlot`,
      fields: [
        marker("page-body-slot@1"),
        f(PLACEHOLDER_FIELDS.PLACEHOLDER_KEY, "headless-main", "Placeholder Key"),
        f(SYSTEM_FIELDS.DISPLAY_NAME, "Page Body", "__Display name"),
        f(PLACEHOLDER_FIELDS.ALLOWED_CONTROLS, hero.itemId, "Allowed Controls"),
      ],
    });

    const client = makeClient([rRoot, hero, psRoot, groupFolder, mainSlot]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot, placeholderSettingsRoot },
      client
    );
    const placeholder = recipes!.find((r): r is PlaceholderRecipe => r.kind === "placeholder");
    expect(placeholder).toBeDefined();
    expect(placeholder!.name).toBe("MainSlot");
    expect(placeholder!.key).toBe("headless-main");
    expect(placeholder!.displayName).toBe("Page Body");
    expect(placeholder!.handle).toBe("page-body-slot@1");
    // Grouping folder reverse-projects onto `folder` (array form).
    expect(placeholder!.folder).toEqual(["Partial Design"]);
    // Allowed Controls GUID resolved through the marker index.
    expect(placeholder!.allowedComponents).toEqual(["hero@1"]);
  });

  it("skips a Placeholder Settings item that carries no Placeholder Key", async () => {
    idSeq = 0;
    const placeholderSettingsRoot = "/sitecore/content/demo/Presentation/Placeholder Settings";
    const psRoot = item({
      name: "Placeholder Settings",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: placeholderSettingsRoot,
    });
    const keyless = item({
      name: "Keyless",
      templateId: PLACEHOLDER_TEMPLATE_ID,
      parentId: psRoot.itemId,
      path: `${placeholderSettingsRoot}/Keyless`,
      fields: [marker("keyless@1")],
    });
    const client = makeClient([psRoot, keyless]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "", placeholderSettingsRoot },
      client
    );
    expect(recipes!.filter((r) => r.kind === "placeholder")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// round-trip — recipe → compile + emitLayoutXml → parse back → assert Layout
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — layout round-trip through the compiler", () => {
  it("compiles a partial design's layout, parses the XML back, Layout matches", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const partialDesignsRoot = "/sitecore/content/demo/Presentation/Partial Designs";

    // Two marked renderings the layout will reference.
    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    const logo = item({
      name: "SiteLogo",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/SiteLogo`,
      fields: [marker("site-logo@1")],
    });
    const nav = item({
      name: "PrimaryNav",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/PrimaryNav`,
      fields: [marker("primary-nav@1")],
    });

    // The original recipe-author intent.
    const originalLayout = {
      placeholders: {
        "/header": [
          { componentHandle: "site-logo@1", variant: "Default", params: { Size: "lg" } },
          { componentHandle: "primary-nav@1" },
        ],
      },
    };

    // Emit it the way `compilePartialDesignRecipe` does — delta form,
    // GUIDs resolved against the live rendering itemIds.
    const pdRoot = item({
      name: "Partial Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: partialDesignsRoot,
    });
    const header = item({
      name: "StandardHeader",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/StandardHeader`,
      fields: [marker("standard-header@1")],
    });
    const layoutXml = emitLayoutXml(originalLayout, {
      ...layoutCtx(header.itemId, {
        "site-logo@1": logo.itemId,
        "primary-nav@1": nav.itemId,
      }),
      mode: "delta",
    });
    header.fields.push(f(LAYOUT_FIELDS.RENDERINGS, layoutXml, "__Renderings"));

    const client = makeClient([rRoot, logo, nav, pdRoot, header]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot, partialDesignsRoot },
      client
    );
    const partial = recipes!.find((r): r is PartialDesignRecipe => r.kind === "partial-design");

    // Round-trip equality: the reverse-projected Layout matches the
    // original recipe-author intent (variant + params + ordering).
    expect(partial!.layout).toEqual(originalLayout);

    // And the projected recipe compiles back to a buildable IR set.
    const irs = compileRecipeSet(recipes!, {
      templatesRoot: "",
      renderingsRoot,
      partialDesignsRoot,
    });
    expect(irs.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Field-type inverse mapping — shapeFromSitecoreType across every type
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — field type inverse mapping", () => {
  /**
   * Build a content template carrying one field per Sitecore type and
   * assert each reverse-projects to the expected abstract `shape` and
   * carries the verbatim `sitecore.type`. This walks every arm of
   * `shapeFromSitecoreType`.
   */
  it("maps every Sitecore field type back to its abstract shape", async () => {
    idSeq = 0;
    const contentModelsRoot = "/sitecore/templates/Project/demo/Content Models";

    const cmRoot = item({
      name: "Content Models",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: contentModelsRoot,
    });
    const template = item({
      name: "AllTypes",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: cmRoot.itemId,
      path: `${contentModelsRoot}/AllTypes`,
    });
    const section = item({
      name: "Content",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${contentModelsRoot}/AllTypes/Content`,
    });

    // type label → expected abstract shape.
    const typeToShape: Array<[string, string]> = [
      ["single-line-text", "text"],
      ["multi-line-text", "text"],
      ["rich-text", "richText"],
      ["image", "image"],
      ["file", "image"],
      ["general-link", "link"],
      ["checkbox", "boolean"],
      ["number", "number"],
      ["integer", "integer"],
      ["date", "date"],
      ["datetime", "datetime"],
      ["droplist", "enum"],
      ["droplink", "reference"],
      ["treelist", "reference"],
      ["treelist-with-search", "reference"],
      ["lookup", "reference"],
      ["tags", "reference"],
    ];

    const fieldItems = typeToShape.map(([type], idx) =>
      item({
        name: `Field_${type}`,
        templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
        parentId: section.itemId,
        path: `${contentModelsRoot}/AllTypes/Content/Field_${type}`,
        fields: [
          f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel(type as never), "Type"),
          f(SYSTEM_FIELDS.SORT_ORDER, String((idx + 1) * 10), "__Sortorder"),
        ],
      })
    );

    const client = makeClient([cmRoot, template, section, ...fieldItems]);
    const recipes = await readCurrentRecipes(
      {
        templatesRoot: "/sitecore/templates/Project/demo",
        renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
        contentModelsRoot,
      },
      client
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    expect(content).toBeDefined();

    for (const [type, expectedShape] of typeToShape) {
      const fd = content!.fields.find((x) => x.name === `Field_${type}`)!;
      expect(fd.shape).toBe(expectedShape);
      // The exact Sitecore type round-trips verbatim on sitecore.type.
      expect(fd.sitecore?.type).toBe(type);
    }
  });

  it("falls back to shape 'text' for a field with an unrecognised Type label", async () => {
    idSeq = 0;
    const contentModelsRoot = "/sitecore/templates/Project/demo/Content Models";
    const cmRoot = item({
      name: "Content Models",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: contentModelsRoot,
    });
    const template = item({
      name: "Weird",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: cmRoot.itemId,
      path: `${contentModelsRoot}/Weird`,
    });
    const section = item({
      name: "Content",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${contentModelsRoot}/Weird/Content`,
    });
    const oddField = item({
      name: "Mystery",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: section.itemId,
      path: `${contentModelsRoot}/Weird/Content/Mystery`,
      // A type Sitecore would never emit — sitecoreTypeFromLabel returns
      // undefined, shapeFromSitecoreType is never reached, shape stays "text".
      fields: [f(TEMPLATE_FIELD_FIELDS.TYPE, "Quantum Field", "Type")],
    });
    const noTypeField = item({
      name: "Untyped",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: section.itemId,
      path: `${contentModelsRoot}/Weird/Content/Untyped`,
      // No Type field at all.
      fields: [],
    });

    const client = makeClient([cmRoot, template, section, oddField, noTypeField]);
    const recipes = await readCurrentRecipes(
      {
        templatesRoot: "/sitecore/templates/Project/demo",
        renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
        contentModelsRoot,
      },
      client
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    const mystery = content!.fields.find((x) => x.name === "Mystery")!;
    expect(mystery.shape).toBe("text");
    // No recognised type → sitecore.type is omitted.
    expect(mystery.sitecore?.type).toBeUndefined();
    const untyped = content!.fields.find((x) => x.name === "Untyped")!;
    expect(untyped.shape).toBe("text");
  });
});

describe("readCurrentRecipes — subordinate template buckets", () => {
  it("skips nested Component Folders / Presentation Parameters folders", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";

    const compRoot = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    // A real section folder — its component template SHOULD project.
    const uiSection = item({
      name: "ui",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: compRoot.itemId,
      path: `${componentsRoot}/ui`,
    });
    const realComponent = item({
      name: "Hero",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: uiSection.itemId,
      path: `${componentsRoot}/ui/Hero`,
      fields: [
        f(SYSTEM_FIELDS.BASE_TEMPLATE, SXA_COMPONENT_BASE_TEMPLATES.join("|"), "__Base template"),
      ],
    });
    // Subordinate buckets nested *under* the section folder (depth > 0):
    // walkTemplatesTree skips these by name. Their contents must NOT
    // reverse-project.
    const componentFolders = item({
      name: "Component Folders",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: uiSection.itemId,
      path: `${componentsRoot}/ui/Component Folders`,
    });
    const supportTemplate = item({
      name: "SupportTemplate",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: componentFolders.itemId,
      path: `${componentsRoot}/ui/Component Folders/SupportTemplate`,
    });
    const presentationParams = item({
      name: "Presentation Parameters",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: uiSection.itemId,
      path: `${componentsRoot}/ui/Presentation Parameters`,
    });
    const paramsTemplate = item({
      name: "ParamsTemplate",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: presentationParams.itemId,
      path: `${componentsRoot}/ui/Presentation Parameters/ParamsTemplate`,
    });

    const client = makeClient([
      compRoot,
      uiSection,
      realComponent,
      componentFolders,
      supportTemplate,
      presentationParams,
      paramsTemplate,
    ]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: componentsRoot, renderingsRoot, componentsRoot },
      client
    );
    const names = recipes!.map((r) => r.name);
    expect(names).toContain("Hero");
    // Templates under the subordinate buckets are not visited.
    expect(names).not.toContain("SupportTemplate");
    expect(names).not.toContain("ParamsTemplate");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — field-level projection arms
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — field projection branches", () => {
  /** Build a content-template fixture with one section + supplied fields. */
  const contentTemplateWith = (fieldItems: (parent: string, root: string) => RemoteItem[]) => {
    idSeq = 0;
    const contentModelsRoot = "/sitecore/templates/Project/demo/Content Models";
    const cmRoot = item({
      name: "Content Models",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: contentModelsRoot,
    });
    const template = item({
      name: "Doc",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: cmRoot.itemId,
      path: `${contentModelsRoot}/Doc`,
    });
    const section = item({
      name: "Content",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${contentModelsRoot}/Doc/Content`,
    });
    const fields = fieldItems(section.itemId, `${contentModelsRoot}/Doc/Content`);
    return {
      contentModelsRoot,
      items: [cmRoot, template, section, ...fields],
    };
  };

  it("omits sitecore.sortOrder when __Sortorder is non-numeric", async () => {
    const { contentModelsRoot, items } = contentTemplateWith((parent, root) => [
      item({
        name: "Title",
        templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
        parentId: parent,
        path: `${root}/Title`,
        fields: [
          f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("single-line-text"), "Type"),
          // Garbage sort order → Number.parseInt is NaN → augment.sortOrder omitted.
          f(SYSTEM_FIELDS.SORT_ORDER, "not-a-number", "__Sortorder"),
        ],
      }),
    ]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", contentModelsRoot },
      makeClient(items)
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    const title = content!.fields.find((x) => x.name === "Title")!;
    expect(title.sitecore?.sortOrder).toBeUndefined();
  });

  it("carries sitecore.source = { kind: 'raw', value } verbatim when a Source field is set", async () => {
    const sourceWire = "query:./*[@@templatename='Page']";
    const { contentModelsRoot, items } = contentTemplateWith((parent, root) => [
      item({
        name: "Picker",
        templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
        parentId: parent,
        path: `${root}/Picker`,
        fields: [
          f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("droplink"), "Type"),
          f(TEMPLATE_FIELD_FIELDS.SOURCE, sourceWire, "Source"),
        ],
      }),
    ]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", contentModelsRoot },
      makeClient(items)
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    const picker = content!.fields.find((x) => x.name === "Picker")!;
    expect(picker.sitecore?.source).toEqual({ kind: "raw", value: sourceWire });
  });

  it("does not set sitecore.source when the Source field is the empty string", async () => {
    const { contentModelsRoot, items } = contentTemplateWith((parent, root) => [
      item({
        name: "Plain",
        templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
        parentId: parent,
        path: `${root}/Plain`,
        fields: [
          f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("single-line-text"), "Type"),
          f(TEMPLATE_FIELD_FIELDS.SOURCE, "", "Source"),
        ],
      }),
    ]);
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", contentModelsRoot },
      makeClient(items)
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    const plain = content!.fields.find((x) => x.name === "Plain")!;
    expect(plain.sitecore?.source).toBeUndefined();
  });

  it("records a non-Content section name onto sitecore.section", async () => {
    idSeq = 0;
    const contentModelsRoot = "/sitecore/templates/Project/demo/Content Models";
    const cmRoot = item({
      name: "Content Models",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: contentModelsRoot,
    });
    const template = item({
      name: "Doc",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: cmRoot.itemId,
      path: `${contentModelsRoot}/Doc`,
    });
    const metaSection = item({
      name: "Metadata",
      templateId: SITECORE_TEMPLATES.TEMPLATE_SECTION,
      parentId: template.itemId,
      path: `${contentModelsRoot}/Doc/Metadata`,
    });
    const seoField = item({
      name: "SeoTitle",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FIELD,
      parentId: metaSection.itemId,
      path: `${contentModelsRoot}/Doc/Metadata/SeoTitle`,
      fields: [f(TEMPLATE_FIELD_FIELDS.TYPE, sitecoreFieldTypeLabel("single-line-text"), "Type")],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", contentModelsRoot },
      makeClient([cmRoot, template, metaSection, seoField])
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    const seo = content!.fields.find((x) => x.name === "SeoTitle")!;
    // A non-default section name is carried; "Content" would be omitted.
    expect(seo.sitecore?.section).toBe("Metadata");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — component-section + enumeration omission arms
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — component-section omission arms", () => {
  it("omits displayName when __Display name equals the folder name", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const compRoot = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    const section = item({
      name: "ui",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: compRoot.itemId,
      path: `${componentsRoot}/ui`,
      fields: [
        // Display name identical to the item name → omitted (no fabrication).
        f(SYSTEM_FIELDS.DISPLAY_NAME, "ui", "__Display name"),
        // Non-numeric sort order → recipe.sortOrder omitted.
        f(SYSTEM_FIELDS.SORT_ORDER, "xyz", "__Sortorder"),
      ],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: componentsRoot, renderingsRoot: "/r", componentsRoot },
      makeClient([compRoot, section])
    );
    const sectionRecipe = recipes!.find(
      (r): r is ComponentSectionRecipe => r.kind === "component-section"
    );
    expect(sectionRecipe!.displayName).toBeUndefined();
    expect(sectionRecipe!.sortOrder).toBeUndefined();
  });
});

describe("readCurrentRecipes — enumeration default arms", () => {
  it("drops the container default when it names no declared value", async () => {
    idSeq = 0;
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";
    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    const container = item({
      name: "Mood",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/Mood`,
      // The Value field points at a value that is not one of the children.
      fields: [f("be351a73-0000-0000-0000-000000000000", "ghost", "Value")],
    });
    const calm = item({
      name: "calm",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/Mood/calm`,
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", enumerationsRoot },
      makeClient([enumRoot, container, calm])
    );
    const enumeration = recipes!.find((r): r is EnumerationRecipe => r.kind === "enumeration");
    // Stale container `Value` is not intent — `default` is omitted.
    expect(enumeration!.default).toBeUndefined();
  });

  it("skips a childless item directly under the enumerations root", async () => {
    idSeq = 0;
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";
    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    const lonely = item({
      name: "Lonely",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/Lonely`,
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", enumerationsRoot },
      makeClient([enumRoot, lonely])
    );
    expect(recipes!.filter((r) => r.kind === "enumeration")).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — placeholder + page layout-omission arms
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — placeholder arms", () => {
  const placeholderSettingsRoot = "/sitecore/content/demo/Presentation/Placeholder Settings";

  it("skips a Placeholder Settings item that carries no Placeholder Key", async () => {
    idSeq = 0;
    const psRoot = item({
      name: "Placeholder Settings",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: placeholderSettingsRoot,
    });
    const keyless = item({
      name: "Keyless",
      templateId: PLACEHOLDER_TEMPLATE_ID,
      parentId: psRoot.itemId,
      path: `${placeholderSettingsRoot}/Keyless`,
      // No `Placeholder Key` field → placeholderFromItem returns null.
      fields: [],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", placeholderSettingsRoot },
      makeClient([psRoot, keyless])
    );
    expect(recipes!.filter((r) => r.kind === "placeholder")).toHaveLength(0);
  });

  it("recovers the folder path for a placeholder nested under grouping folders", async () => {
    idSeq = 0;
    const psRoot = item({
      name: "Placeholder Settings",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: placeholderSettingsRoot,
    });
    const groupFolder = item({
      name: "Headers",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: psRoot.itemId,
      path: `${placeholderSettingsRoot}/Headers`,
    });
    const ph = item({
      name: "MainPlaceholder",
      templateId: PLACEHOLDER_TEMPLATE_ID,
      parentId: groupFolder.itemId,
      path: `${placeholderSettingsRoot}/Headers/MainPlaceholder`,
      fields: [f(PLACEHOLDER_FIELDS.PLACEHOLDER_KEY, "headless-main", "Placeholder Key")],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", placeholderSettingsRoot },
      makeClient([psRoot, groupFolder, ph])
    );
    const placeholder = recipes!.find((r): r is PlaceholderRecipe => r.kind === "placeholder");
    expect(placeholder!.key).toBe("headless-main");
    expect(placeholder!.folder).toEqual(["Headers"]);
    // No Allowed Controls field → allowedComponents stays empty (default).
    expect(placeholder!.allowedComponents).toEqual([]);
  });
});

describe("readCurrentRecipes — page-design / page layout omission", () => {
  it("leaves a page-design layout unset when its __Renderings is empty", async () => {
    idSeq = 0;
    const pageDesignsRoot = "/sitecore/content/demo/Presentation/Page Designs";
    const pdgRoot = item({
      name: "Page Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pageDesignsRoot,
    });
    const design = item({
      name: "HomeDesign",
      templateId: SITECORE_TEMPLATES.PAGE_DESIGN,
      parentId: pdgRoot.itemId,
      path: `${pageDesignsRoot}/HomeDesign`,
      fields: [marker("home-design@1")],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", pageDesignsRoot },
      makeClient([pdgRoot, design])
    );
    const pageDesign = recipes!.find((r): r is PageDesignRecipe => r.kind === "page-design");
    expect(pageDesign).toBeDefined();
    // Empty layout → the optional `layout` is omitted entirely.
    expect(pageDesign!.layout).toBeUndefined();
    // No PartialDesigns field, no mapping → both default to [].
    expect(pageDesign!.partials).toEqual([]);
    expect(pageDesign!.appliesTo).toEqual([]);
  });

  it("drops an unresolved partial GUID from a page-design's partials list", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const partialDesignsRoot = "/sitecore/content/demo/Presentation/Partial Designs";
    const pageDesignsRoot = "/sitecore/content/demo/Presentation/Page Designs";

    const pdRoot = item({
      name: "Partial Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: partialDesignsRoot,
    });
    // Marked partial — resolvable.
    const headerPartial = item({
      name: "Header",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/Header`,
      fields: [marker("header@1")],
    });
    // Unmarked partial — its GUID won't be in the marker index.
    const ghostPartial = item({
      name: "Ghost",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/Ghost`,
    });

    const pdgRoot = item({
      name: "Page Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pageDesignsRoot,
    });
    const design = item({
      name: "ArticleDesign",
      templateId: SITECORE_TEMPLATES.PAGE_DESIGN,
      parentId: pdgRoot.itemId,
      path: `${pageDesignsRoot}/ArticleDesign`,
      fields: [
        marker("article-design@1"),
        // PartialDesigns lists both GUIDs; only the marked one resolves.
        f(
          COMPOSITION_FIELDS.PARTIAL_DESIGNS,
          `${headerPartial.itemId}|${ghostPartial.itemId}`,
          "PartialDesigns"
        ),
      ],
    });

    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot, partialDesignsRoot, pageDesignsRoot },
      makeClient([pdRoot, headerPartial, ghostPartial, pdgRoot, design])
    );
    const pageDesign = recipes!.find(
      (r): r is PageDesignRecipe => r.kind === "page-design" && r.name === "ArticleDesign"
    );
    // Only the marked partial survives — the ghost GUID is dropped.
    expect(pageDesign!.partials).toEqual(["header@1"]);
  });

  it("skips a page whose template GUID carries no marker but projects its marked sibling", async () => {
    idSeq = 0;
    const pageTemplatesRoot = "/sitecore/templates/Project/demo";
    const pagesRoot = "/sitecore/content/demo/Home";

    const ptRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: pageTemplatesRoot,
    });
    const articleTpl = item({
      name: "ArticlePage",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: ptRoot.itemId,
      path: `${pageTemplatesRoot}/ArticlePage`,
      fields: [
        marker("article-page@1"),
        f(
          SYSTEM_FIELDS.BASE_TEMPLATE,
          SXA_HEADLESS_PAGE_BASE_TEMPLATES.join("|"),
          "__Base template"
        ),
      ],
    });

    const homeRoot = item({
      name: "Home",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pagesRoot,
    });
    // Conforms to the marked template → reverse-projects.
    const goodPage = item({
      name: "Welcome",
      templateId: articleTpl.itemId,
      parentId: homeRoot.itemId,
      path: `${pagesRoot}/Welcome`,
    });
    // Conforms to an UNMARKED template GUID → skipped.
    const orphanPage = item({
      name: "Orphan",
      templateId: nextId(),
      parentId: homeRoot.itemId,
      path: `${pagesRoot}/Orphan`,
    });

    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", pageTemplatesRoot, pagesRoot },
      makeClient([ptRoot, articleTpl, homeRoot, goodPage, orphanPage])
    );
    const pages = recipes!.filter((r): r is PageRecipe => r.kind === "page");
    expect(pages.map((p) => p.name)).toEqual(["Welcome"]);
    expect(pages[0].template).toBe("article-page@1");
    // No __Final Renderings → layout omitted.
    expect(pages[0].layout).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — empty-root short-circuits across every walker
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — absent-root short-circuits", () => {
  it("returns an empty array when every layout-bearing root resolves to no item", async () => {
    // All four layout-bearing walkers (`walkPartialDesignsTree`,
    // `walkPageDesignsTree`, `walkPagesTree`, `walkPlaceholderSettingsTree`)
    // plus `collectRenderingComponentNames` hit their `root === null` arm.
    const recipes = await readCurrentRecipes(
      {
        templatesRoot: "",
        renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
        partialDesignsRoot: "/sitecore/content/demo/Presentation/Partial Designs",
        pageDesignsRoot: "/sitecore/content/demo/Presentation/Page Designs",
        pagesRoot: "/sitecore/content/demo/Home",
        placeholderSettingsRoot: "/sitecore/content/demo/Presentation/Placeholder Settings",
        enumerationsRoot: "/sitecore/content/demo/Presentation/Enumerations",
      },
      makeClient([]) // no items → every getItem(root) resolves null
    );
    expect(recipes).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — fieldValue byName fallback + handle synthesis guard
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — fieldValue byName fallback", () => {
  it("resolves a field by name when no GUID-keyed field matches", async () => {
    idSeq = 0;
    const contentModelsRoot = "/sitecore/templates/Project/demo/Content Models";
    const cmRoot = item({
      name: "Content Models",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: contentModelsRoot,
    });
    // __Display name carried ONLY by field name (no fieldId) — exercises
    // `fieldValue`'s byName fallback arm.
    const template = item({
      name: "Doc",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: cmRoot.itemId,
      path: `${contentModelsRoot}/Doc`,
      fields: [{ value: "Document Model", name: "__Display name" } as never],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", contentModelsRoot },
      makeClient([cmRoot, template])
    );
    const content = recipes!.find((r): r is ContentTemplateRecipe => r.kind === "content-template");
    expect(content!.displayName).toBe("Document Model");
  });

  it("prefixes a synthesised handle with x- when the item name starts with a digit", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const compRoot = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    // Folder name starts with a digit → kebab is "3-col-grid", which fails
    // /^[a-z]/, so `handleFromName` prepends "x-".
    const section = item({
      name: "3 Col Grid",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: compRoot.itemId,
      path: `${componentsRoot}/3 Col Grid`,
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: componentsRoot, renderingsRoot: "/r", componentsRoot },
      makeClient([compRoot, section])
    );
    const sectionRecipe = recipes!.find(
      (r): r is ComponentSectionRecipe => r.kind === "component-section"
    );
    expect(sectionRecipe!.handle).toBe("x-3-col-grid@1");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — description / icon omission arms across layout kinds
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — description / icon arms", () => {
  it("carries description and icon onto a partial design when both fields are set", async () => {
    idSeq = 0;
    const partialDesignsRoot = "/sitecore/content/demo/Presentation/Partial Designs";
    const pdRoot = item({
      name: "Partial Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: partialDesignsRoot,
    });
    const partial = item({
      name: "Footer",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/Footer`,
      fields: [
        marker("footer@1"),
        f(SYSTEM_FIELDS.ICON, "office/16x16/document.png", "__Icon"),
        { value: "Site footer partial", name: "__Long description" } as never,
      ],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", partialDesignsRoot },
      makeClient([pdRoot, partial])
    );
    const pd = recipes!.find((r): r is PartialDesignRecipe => r.kind === "partial-design");
    expect(pd!.description).toBe("Site footer partial");
    expect(pd!.icon).toBe("office/16x16/document.png");
  });

  it("carries description and icon onto a page design when both fields are set", async () => {
    idSeq = 0;
    const pageDesignsRoot = "/sitecore/content/demo/Presentation/Page Designs";
    const pdgRoot = item({
      name: "Page Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pageDesignsRoot,
    });
    const design = item({
      name: "LandingDesign",
      templateId: SITECORE_TEMPLATES.PAGE_DESIGN,
      parentId: pdgRoot.itemId,
      path: `${pageDesignsRoot}/LandingDesign`,
      fields: [
        marker("landing-design@1"),
        f(SYSTEM_FIELDS.ICON, "office/16x16/page.png", "__Icon"),
        { value: "Marketing landing layout", name: "__Long description" } as never,
      ],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", pageDesignsRoot },
      makeClient([pdgRoot, design])
    );
    const pd = recipes!.find((r): r is PageDesignRecipe => r.kind === "page-design");
    expect(pd!.description).toBe("Marketing landing layout");
    expect(pd!.icon).toBe("office/16x16/page.png");
  });

  it("carries description onto a page when __Long description is set", async () => {
    idSeq = 0;
    const pageTemplatesRoot = "/sitecore/templates/Project/demo";
    const pagesRoot = "/sitecore/content/demo/Home";
    const ptRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: pageTemplatesRoot,
    });
    const tpl = item({
      name: "ArticlePage",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: ptRoot.itemId,
      path: `${pageTemplatesRoot}/ArticlePage`,
      fields: [
        marker("article-page@1"),
        f(
          SYSTEM_FIELDS.BASE_TEMPLATE,
          SXA_HEADLESS_PAGE_BASE_TEMPLATES.join("|"),
          "__Base template"
        ),
      ],
    });
    const homeRoot = item({
      name: "Home",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pagesRoot,
    });
    const page = item({
      name: "Story",
      templateId: tpl.itemId,
      parentId: homeRoot.itemId,
      path: `${pagesRoot}/Story`,
      fields: [marker("story@1"), { value: "A story page", name: "__Long description" } as never],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", pageTemplatesRoot, pagesRoot },
      makeClient([ptRoot, tpl, homeRoot, page])
    );
    const pageRecipe = recipes!.find(
      (r): r is PageRecipe => r.kind === "page" && r.name === "Story"
    );
    expect(pageRecipe!.description).toBe("A story page");
  });

  it("carries description and icon onto a placeholder when both fields are set", async () => {
    idSeq = 0;
    const placeholderSettingsRoot = "/sitecore/content/demo/Presentation/Placeholder Settings";
    const psRoot = item({
      name: "Placeholder Settings",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: placeholderSettingsRoot,
    });
    const ph = item({
      name: "MainSlot",
      templateId: PLACEHOLDER_TEMPLATE_ID,
      parentId: psRoot.itemId,
      path: `${placeholderSettingsRoot}/MainSlot`,
      fields: [
        f(PLACEHOLDER_FIELDS.PLACEHOLDER_KEY, "headless-main", "Placeholder Key"),
        f(SYSTEM_FIELDS.ICON, "office/16x16/window.png", "__Icon"),
        { value: "The main content slot", name: "__Long description" } as never,
      ],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", placeholderSettingsRoot },
      makeClient([psRoot, ph])
    );
    const placeholder = recipes!.find((r): r is PlaceholderRecipe => r.kind === "placeholder");
    expect(placeholder!.description).toBe("The main content slot");
    expect(placeholder!.icon).toBe("office/16x16/window.png");
  });

  it("carries description onto component, content, page-template and section recipes", async () => {
    idSeq = 0;
    const componentsRoot = "/sitecore/templates/Project/demo/Components";
    const compRoot = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    const section = item({
      name: "ui",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: compRoot.itemId,
      path: `${componentsRoot}/ui`,
      fields: [{ value: "UI building blocks", name: "__Long description" } as never],
    });
    const component = item({
      name: "Badge",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: section.itemId,
      path: `${componentsRoot}/ui/Badge`,
      fields: [
        f(SYSTEM_FIELDS.BASE_TEMPLATE, SXA_COMPONENT_BASE_TEMPLATES.join("|"), "__Base template"),
        { value: "A small badge", name: "__Long description" } as never,
      ],
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: componentsRoot, renderingsRoot: "/r", componentsRoot },
      makeClient([compRoot, section, component])
    );
    const sectionRecipe = recipes!.find(
      (r): r is ComponentSectionRecipe => r.kind === "component-section"
    );
    const componentRecipe = recipes!.find(
      (r): r is ComponentTemplateRecipe => r.kind === "component-template"
    );
    expect(sectionRecipe!.description).toBe("UI building blocks");
    expect(componentRecipe!.description).toBe("A small badge");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — decodeTemplatesMapping malformed-pair arms + page-design
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — TemplatesMapping decode arms", () => {
  it("skips empty and malformed mapping pairs while keeping the well-formed one", async () => {
    idSeq = 0;
    const pageTemplatesRoot = "/sitecore/templates/Project/demo";
    const pageDesignsRoot = "/sitecore/content/demo/Presentation/Page Designs";

    const ptRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: pageTemplatesRoot,
    });
    const tpl = item({
      name: "ArticlePage",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: ptRoot.itemId,
      path: `${pageTemplatesRoot}/ArticlePage`,
      fields: [
        marker("article-page@1"),
        f(
          SYSTEM_FIELDS.BASE_TEMPLATE,
          SXA_HEADLESS_PAGE_BASE_TEMPLATES.join("|"),
          "__Base template"
        ),
      ],
    });

    const pdgRoot = item({
      name: "Page Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pageDesignsRoot,
      // Three "&"-joined pairs: an empty segment, a no-`=` segment, and a
      // well-formed `{tpl}={design}` segment. Only the last survives decode.
      fields: [],
    });
    const design = item({
      name: "ArticleDesign",
      templateId: SITECORE_TEMPLATES.PAGE_DESIGN,
      parentId: pdgRoot.itemId,
      path: `${pageDesignsRoot}/ArticleDesign`,
      fields: [marker("article-design@1")],
    });
    pdgRoot.fields.push(
      f(
        COMPOSITION_FIELDS.TEMPLATES_MAPPING,
        encodeTemplatesMapping([{ templateGuid: tpl.itemId, designGuid: design.itemId }]) +
          "&&malformed-no-equals",
        "TemplatesMapping"
      )
    );

    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", pageTemplatesRoot, pageDesignsRoot },
      makeClient([ptRoot, tpl, pdgRoot, design])
    );
    const pageDesign = recipes!.find((r): r is PageDesignRecipe => r.kind === "page-design");
    // Only the well-formed pair resolves; the empty + no-`=` segments drop.
    expect(pageDesign!.appliesTo).toEqual(["article-page@1"]);
  });

  it("drops a TemplatesMapping entry whose template GUID carries no marker", async () => {
    idSeq = 0;
    const pageDesignsRoot = "/sitecore/content/demo/Presentation/Page Designs";
    const pdgRoot = item({
      name: "Page Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pageDesignsRoot,
    });
    const design = item({
      name: "OrphanDesign",
      templateId: SITECORE_TEMPLATES.PAGE_DESIGN,
      parentId: pdgRoot.itemId,
      path: `${pageDesignsRoot}/OrphanDesign`,
      fields: [marker("orphan-design@1")],
    });
    // Mapping references an unmarked template GUID → unrecoverable handle.
    pdgRoot.fields.push(
      f(
        COMPOSITION_FIELDS.TEMPLATES_MAPPING,
        encodeTemplatesMapping([
          { templateGuid: "11111111-2222-3333-4444-555555555555", designGuid: design.itemId },
        ]),
        "TemplatesMapping"
      )
    );
    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", pageDesignsRoot },
      makeClient([pdgRoot, design])
    );
    const pageDesign = recipes!.find((r): r is PageDesignRecipe => r.kind === "page-design");
    // The only mapping entry pointed at an unmarked template → appliesTo []
    expect(pageDesign!.appliesTo).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — placement datasource arms (scoped / shared / unresolved)
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — placement datasource arms", () => {
  it("recovers a scoped datasource from a local: sentinel and a shared one by GUID", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const partialDesignsRoot = "/sitecore/content/demo/Presentation/Partial Designs";

    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    const hero = item({
      name: "Hero",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/Hero`,
      fields: [marker("hero@1")],
    });
    const card = item({
      name: "Card",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/Card`,
      fields: [marker("card@1")],
    });
    // A marked content item used as a shared datasource target.
    const sharedDs = item({
      name: "SharedHero",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/SharedHero`,
      fields: [marker("shared-hero@1")],
    });

    const pdRoot = item({
      name: "Partial Designs",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: partialDesignsRoot,
    });
    const header = item({
      name: "DsHeader",
      templateId: SITECORE_TEMPLATES.PARTIAL_DESIGN,
      parentId: pdRoot.itemId,
      path: `${partialDesignsRoot}/DsHeader`,
      fields: [marker("ds-header@1")],
    });
    // Three placements: scoped (local: sentinel), shared (resolvable GUID),
    // shared-but-unresolvable (GUID with no marker → datasourceRef omitted).
    const layoutXml = emitLayoutXml(
      {
        placeholders: {
          "/main": [
            { componentHandle: "hero@1", datasourceRef: { kind: "scoped", slot: "Hero" } },
            {
              componentHandle: "card@1",
              datasourceRef: { kind: "shared", handle: "shared-hero@1" },
            },
            {
              componentHandle: "card@1",
              datasourceRef: { kind: "shared", handle: "missing-ds@1" },
            },
          ],
        },
      },
      {
        parentItemId: header.itemId,
        deviceId: DEFAULT_DEVICE_ID,
        renderingIdFor: (handle) =>
          ({ "hero@1": hero.itemId, "card@1": card.itemId })[handle] ??
          (() => {
            throw new Error(`test: unknown rendering ${handle}`);
          })(),
        // Resolve shared-hero@1 to a real marked GUID; missing-ds@1 to an
        // unmarked GUID so its datasourceRef is dropped on reverse-projection.
        contentItemIdFor: (handle) =>
          ({
            "shared-hero@1": sharedDs.itemId,
            "missing-ds@1": "99999999-8888-7777-6666-555555555555",
          })[handle] ??
          (() => {
            throw new Error(`test: unknown content item ${handle}`);
          })(),
        allowScoped: true,
        mode: "delta",
      }
    );
    header.fields.push(f(LAYOUT_FIELDS.RENDERINGS, layoutXml, "__Renderings"));

    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot, partialDesignsRoot },
      makeClient([rRoot, hero, card, sharedDs, pdRoot, header])
    );
    const partial = recipes!.find((r): r is PartialDesignRecipe => r.kind === "partial-design");
    const placements = partial!.layout.placeholders["/main"];
    expect(placements).toHaveLength(3);
    // Placement 1: local: sentinel → scoped datasourceRef.
    expect(placements[0].datasourceRef).toEqual({ kind: "scoped", slot: "Hero" });
    // Placement 2: GUID resolved via the marker index → shared datasourceRef.
    expect(placements[1].datasourceRef).toEqual({ kind: "shared", handle: "shared-hero@1" });
    // Placement 3: GUID has no marker → datasourceRef omitted entirely.
    expect(placements[2].datasourceRef).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — walkPagesTree Data-folder skip + nested pages
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — pages tree Data folder + nesting", () => {
  it("skips the Data folder and recurses into nested child pages", async () => {
    idSeq = 0;
    const pageTemplatesRoot = "/sitecore/templates/Project/demo";
    const pagesRoot = "/sitecore/content/demo/Home";

    const ptRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: pageTemplatesRoot,
    });
    const tpl = item({
      name: "ArticlePage",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: ptRoot.itemId,
      path: `${pageTemplatesRoot}/ArticlePage`,
      fields: [
        marker("article-page@1"),
        f(
          SYSTEM_FIELDS.BASE_TEMPLATE,
          SXA_HEADLESS_PAGE_BASE_TEMPLATES.join("|"),
          "__Base template"
        ),
      ],
    });

    const homeRoot = item({
      name: "Home",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: ROOT_PARENT,
      path: pagesRoot,
    });
    const parentPage = item({
      name: "Section",
      templateId: tpl.itemId,
      parentId: homeRoot.itemId,
      path: `${pagesRoot}/Section`,
      fields: [marker("section@1")],
    });
    // Data folder under the parent page — must be skipped, not projected.
    const dataFolder = item({
      name: "Data",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: parentPage.itemId,
      path: `${pagesRoot}/Section/Data`,
    });
    // Nested child page — must be recursed into and projected.
    const childPage = item({
      name: "Detail",
      templateId: tpl.itemId,
      parentId: parentPage.itemId,
      path: `${pagesRoot}/Section/Detail`,
      fields: [marker("detail@1")],
    });

    const recipes = await readCurrentRecipes(
      { templatesRoot: "", renderingsRoot: "/r", pageTemplatesRoot, pagesRoot },
      makeClient([ptRoot, tpl, homeRoot, parentPage, dataFolder, childPage])
    );
    const pages = recipes!.filter((r): r is PageRecipe => r.kind === "page");
    expect(pages.map((p) => p.name).sort()).toEqual(["Detail", "Section"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — enumeration grouping-folder recursion
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — enumeration grouping folder", () => {
  it("recurses through a grouping folder that parents enumeration containers", async () => {
    idSeq = 0;
    const enumerationsRoot = "/sitecore/content/demo/Presentation/Enumerations";
    const enumRoot = item({
      name: "Enumerations",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: enumerationsRoot,
    });
    // A grouping folder: its grandchildren (value items of the container)
    // themselves have children → `groupsContainers` flips true.
    const groupFolder = item({
      name: "Branding",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: enumRoot.itemId,
      path: `${enumerationsRoot}/Branding`,
    });
    const container = item({
      name: "Tone",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: groupFolder.itemId,
      path: `${enumerationsRoot}/Branding/Tone`,
    });
    const calm = item({
      name: "calm",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/Branding/Tone/calm`,
    });
    const bold = item({
      name: "bold",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: container.itemId,
      path: `${enumerationsRoot}/Branding/Tone/bold`,
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: "/t", renderingsRoot: "/r", enumerationsRoot },
      makeClient([enumRoot, groupFolder, container, calm, bold])
    );
    const enumeration = recipes!.find((r): r is EnumerationRecipe => r.kind === "enumeration");
    expect(enumeration!.name).toBe("Tone");
    // Recursed through the grouping folder → location.folder threaded in.
    expect(enumeration!.location).toEqual({ scope: "site", folder: ["Branding"] });
    expect(enumeration!.values.map((v) => v.name).sort()).toEqual(["bold", "calm"]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Branch coverage — collectRenderingComponentNames nested-folder recursion
// ─────────────────────────────────────────────────────────────────────────

describe("readCurrentRecipes — rendering folder recursion", () => {
  it("recurses through a plain Folder under the renderings root to find renderings", async () => {
    idSeq = 0;
    const renderingsRoot = "/sitecore/layout/Renderings/Project/demo";
    const componentsRoot = "/sitecore/templates/Project/demo/Components";

    const rRoot = item({
      name: "demo",
      templateId: SITECORE_TEMPLATES.RENDERING_FOLDER,
      parentId: ROOT_PARENT,
      path: renderingsRoot,
    });
    // A plain Folder (not a Rendering Folder) nested under the renderings
    // root — `collectRenderingComponentNames` recurses into it too.
    const plainFolder = item({
      name: "legacy",
      templateId: SITECORE_TEMPLATES.FOLDER,
      parentId: rRoot.itemId,
      path: `${renderingsRoot}/legacy`,
    });
    const rendering = item({
      name: "WidgetBox",
      templateId: SITECORE_TEMPLATES.RENDERING,
      parentId: plainFolder.itemId,
      path: `${renderingsRoot}/legacy/WidgetBox`,
      // No ComponentName field → falls back to the item name.
      fields: [],
    });

    const compRoot = item({
      name: "Components",
      templateId: SITECORE_TEMPLATES.TEMPLATE_FOLDER,
      parentId: ROOT_PARENT,
      path: componentsRoot,
    });
    // A plain content-shaped template named WidgetBox — classified as a
    // component ONLY because the nested rendering's name matches.
    const widgetTpl = item({
      name: "WidgetBox",
      templateId: SITECORE_TEMPLATES.TEMPLATE,
      parentId: compRoot.itemId,
      path: `${componentsRoot}/WidgetBox`,
    });
    const recipes = await readCurrentRecipes(
      { templatesRoot: componentsRoot, renderingsRoot, componentsRoot },
      makeClient([rRoot, plainFolder, rendering, compRoot, widgetTpl])
    );
    // The template was classified as a component because a rendering with
    // its name was discovered through the nested plain Folder.
    expect(recipes!.some((r) => r.kind === "component-template" && r.name === "WidgetBox")).toBe(
      true
    );
  });
});
