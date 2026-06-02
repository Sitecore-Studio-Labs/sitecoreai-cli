import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit tests for the `scai provision recipe pull` task runner
 * (`src/recipe/tasks/pull.ts`). Mocks the tenant resolver +
 * `readCurrentRecipes` so the test asserts the runner's own behaviour:
 * root resolution (CLI flags override env, both absent drops the root),
 * per-recipe serialization to `<outDir>/<kind>/<slug>.recipe.json`,
 * and the human / JSON output split.
 */

vi.mock("../../../../src/recipe/tasks/shared", () => ({
  toLogger: vi.fn(),
  resolveTenant: vi.fn(),
}));
vi.mock("../../../../src/recipe/items/read-current", () => ({
  readCurrentRecipes: vi.fn(),
}));

import { runRecipePull } from "../../../../src/recipe/tasks/pull";
import * as sharedMod from "../../../../src/recipe/tasks/shared";
import { readCurrentRecipes } from "../../../../src/recipe/items/read-current";

interface FakeLogger {
  isJson: () => boolean;
  info: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

let logger: FakeLogger;
let jsonMode: boolean;
let tmpDir: string;

const makeRecipe = (kind: string, handle: string): unknown => ({
  kind,
  schemaVersion: "1",
  handle,
  name: handle.replace(/@.*$/, ""),
  displayName: handle,
});

beforeEach(async () => {
  vi.clearAllMocks();
  jsonMode = false;
  logger = {
    isJson: () => jsonMode,
    info: vi.fn(),
    json: vi.fn(),
  };
  vi.mocked(sharedMod.toLogger).mockReturnValue(logger as never);
  vi.mocked(sharedMod.resolveTenant).mockReturnValue({
    envName: "test-tenant",
    environment: {
      templatesRoot: "/sitecore/templates/Project/demo",
      renderingsRoot: "/sitecore/layout/Renderings/Project/demo",
      componentsRoot: "/sitecore/templates/Project/demo/Components",
      contentItemsRoot: "/sitecore/content/demo/Data",
    } as never,
    root: {} as never,
    client: {} as never,
  });
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "scai-pull-test-"));
});

describe("runRecipePull", () => {
  it("writes each recipe to <outDir>/<kind>/<slug>.recipe.json and returns counts", async () => {
    vi.mocked(readCurrentRecipes).mockResolvedValue([
      makeRecipe("component-template", "cta-button@1"),
      makeRecipe("component-section", "ui@1"),
      makeRecipe("content-item", "primary-cta@1"),
    ] as never);

    const result = await runRecipePull({ output: tmpDir });

    expect(result.totalRecipes).toBe(3);
    expect(result.byKind).toEqual({
      "component-template": 1,
      "component-section": 1,
      "content-item": 1,
    });
    // The `@` in handles becomes `_v` for filesystem safety (mirrors
    // slugifyHandle in io.ts).
    const ctaPath = path.join(tmpDir, "component-template", "cta-button_v1.recipe.json");
    const sectionPath = path.join(tmpDir, "component-section", "ui_v1.recipe.json");
    const ciPath = path.join(tmpDir, "content-item", "primary-cta_v1.recipe.json");
    await expect(fs.access(ctaPath)).resolves.toBeUndefined();
    await expect(fs.access(sectionPath)).resolves.toBeUndefined();
    await expect(fs.access(ciPath)).resolves.toBeUndefined();
    // File content is the recipe JSON, pretty-printed.
    const cta = JSON.parse(await fs.readFile(ctaPath, "utf8"));
    expect(cta).toMatchObject({
      kind: "component-template",
      handle: "cta-button@1",
      displayName: "cta-button@1",
    });
  });

  it("handles an empty recipe set (roots configured but tenant trees empty)", async () => {
    vi.mocked(readCurrentRecipes).mockResolvedValue([] as never);
    const result = await runRecipePull({ output: tmpDir });
    expect(result.totalRecipes).toBe(0);
    expect(result.byKind).toEqual({});
    expect(result.files).toEqual([]);
    // Output dir is still created so subsequent runs find it ready.
    await expect(fs.access(tmpDir)).resolves.toBeUndefined();
    // Yellow hint to the operator.
    const allInfo = logger.info.mock.calls.map((c) => c[0]).join("\n");
    expect(allInfo).toContain("no recipes recovered");
  });

  it("throws INPUT_INVALID when no recipe-projectable roots are configured", async () => {
    vi.mocked(sharedMod.resolveTenant).mockReturnValue({
      envName: "bare-tenant",
      environment: {} as never,
      root: {} as never,
      client: {} as never,
    });
    vi.mocked(readCurrentRecipes).mockResolvedValue(null);
    await expect(runRecipePull({ output: tmpDir })).rejects.toThrow(/No recipe-projectable roots/);
  });

  it("emits a JSON envelope when logger isJson() is true", async () => {
    jsonMode = true;
    vi.mocked(readCurrentRecipes).mockResolvedValue([
      makeRecipe("placeholder", "main-placeholder@1"),
    ] as never);
    await runRecipePull({ output: tmpDir });
    expect(logger.json).toHaveBeenCalledTimes(1);
    const envelope = logger.json.mock.calls[0][0] as Record<string, unknown>;
    expect(envelope.command).toBe("recipe.pull");
    expect(envelope.environment).toBe("test-tenant");
    expect(envelope.totalRecipes).toBe(1);
    expect(envelope.byKind).toEqual({ placeholder: 1 });
    // The human-mode `info` summary is NOT emitted under --json.
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("CLI flag --content-items-root overrides the env-profile value passed to readCurrent", async () => {
    vi.mocked(readCurrentRecipes).mockResolvedValue([] as never);
    await runRecipePull({
      output: tmpDir,
      contentItemsRoot: "/override/content/Data",
    });
    const rootsArg = vi.mocked(readCurrentRecipes).mock.calls[0][0];
    expect(rootsArg.contentItemsRoot).toBe("/override/content/Data");
    // Untouched env-profile roots pass through.
    expect(rootsArg.componentsRoot).toBe("/sitecore/templates/Project/demo/Components");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// classifyMergeStatus — unit-test the heart of merge mode in isolation.
// Pure function, exhaustively coverable.
// ─────────────────────────────────────────────────────────────────────────

import { classifyMergeStatus } from "../../../../src/recipe/tasks/pull";

const hash = (s: string): string => {
  // Deterministic fake hash for tests — actual hash content doesn't
  // matter to the classifier, only equality. Real hashFieldValue is
  // SHA-256 hex; this just keeps the tests readable.
  return `h(${s})`;
};

const fieldMap = (entries: Array<[string, string]>): Map<string, string> => new Map(entries);

describe("classifyMergeStatus", () => {
  it("disk and tenant both null → in-sync (degenerate)", () => {
    expect(classifyMergeStatus(null, null, null)).toEqual({
      status: "in-sync",
      diskChanged: 0,
      tenantChanged: 0,
    });
  });

  it("disk null, tenant present → tenant-only", () => {
    const t = fieldMap([["k1", hash("v")]]);
    expect(classifyMergeStatus(null, t, null).status).toBe("tenant-only");
  });

  it("disk present, tenant null → disk-only", () => {
    const d = fieldMap([["k1", hash("v")]]);
    expect(classifyMergeStatus(d, null, null).status).toBe("disk-only");
  });

  it("disk == tenant (any baseline) → in-sync, no changes", () => {
    const d = fieldMap([["k1", hash("v")]]);
    const t = fieldMap([["k1", hash("v")]]);
    const b = fieldMap([["k1", hash("old")]]);
    expect(classifyMergeStatus(d, t, b)).toEqual({
      status: "in-sync",
      diskChanged: 0,
      tenantChanged: 0,
    });
  });

  it("disk diverged, tenant matches baseline → disk-ahead", () => {
    // Author edited the recipe on disk but hasn't pushed yet.
    const d = fieldMap([["k1", hash("disk-new")]]);
    const t = fieldMap([["k1", hash("baseline")]]);
    const b = fieldMap([["k1", hash("baseline")]]);
    const out = classifyMergeStatus(d, t, b);
    expect(out.status).toBe("disk-ahead");
    expect(out.diskChanged).toBe(1);
    expect(out.tenantChanged).toBe(0);
  });

  it("disk matches baseline, tenant diverged → tenant-edited", () => {
    // Author edited the tenant in CMS after last push.
    const d = fieldMap([["k1", hash("baseline")]]);
    const t = fieldMap([["k1", hash("tenant-new")]]);
    const b = fieldMap([["k1", hash("baseline")]]);
    const out = classifyMergeStatus(d, t, b);
    expect(out.status).toBe("tenant-edited");
    expect(out.diskChanged).toBe(0);
    expect(out.tenantChanged).toBe(1);
  });

  it("both diverged from baseline → conflict", () => {
    const d = fieldMap([["k1", hash("disk-new")]]);
    const t = fieldMap([["k1", hash("tenant-new")]]);
    const b = fieldMap([["k1", hash("baseline")]]);
    const out = classifyMergeStatus(d, t, b);
    expect(out.status).toBe("conflict");
    expect(out.diskChanged).toBe(1);
    expect(out.tenantChanged).toBe(1);
  });

  it("no baseline + disk != tenant → conflict (can't tell who moved)", () => {
    const d = fieldMap([["k1", hash("v1")]]);
    const t = fieldMap([["k1", hash("v2")]]);
    expect(classifyMergeStatus(d, t, null).status).toBe("conflict");
  });

  it("mixed fields: one tenant-edited + one in-sync → tenant-edited rollup", () => {
    const d = fieldMap([
      ["k1", hash("same")],
      ["k2", hash("baseline")],
    ]);
    const t = fieldMap([
      ["k1", hash("same")],
      ["k2", hash("tenant-new")],
    ]);
    const b = fieldMap([
      ["k1", hash("same")],
      ["k2", hash("baseline")],
    ]);
    const out = classifyMergeStatus(d, t, b);
    expect(out.status).toBe("tenant-edited");
    expect(out.tenantChanged).toBe(1);
  });

  it("mixed fields: one disk-ahead + one tenant-edited → conflict at recipe level", () => {
    // Different fields moved on different sides — still a conflict for
    // recipe-level reconciliation (operator needs to decide both).
    const d = fieldMap([
      ["k1", hash("disk-new")],
      ["k2", hash("baseline")],
    ]);
    const t = fieldMap([
      ["k1", hash("baseline")],
      ["k2", hash("tenant-new")],
    ]);
    const b = fieldMap([
      ["k1", hash("baseline")],
      ["k2", hash("baseline")],
    ]);
    const out = classifyMergeStatus(d, t, b);
    expect(out.status).toBe("conflict");
    expect(out.diskChanged).toBe(1);
    expect(out.tenantChanged).toBe(1);
  });

  it("tenant has a field disk doesn't — tenant-edited under audit R4 first-pull friendliness", () => {
    const d = fieldMap([["k1", hash("v")]]);
    const t = fieldMap([
      ["k1", hash("v")],
      ["k2", hash("tenant-only-field")],
    ]);
    // No baseline coverage for k2, field present only on tenant → bumps
    // tenantChanged only. Rollup: tenant-edited (no conflict because
    // disk didn't move on any field).
    const result = classifyMergeStatus(d, t, null);
    expect(result.status).toBe("tenant-edited");
    expect(result.tenantChanged).toBe(1);
    expect(result.diskChanged).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// perFieldStatuses — per-field classification map.
// ─────────────────────────────────────────────────────────────────────────

import { perFieldStatuses } from "../../../../src/recipe/tasks/pull";

describe("perFieldStatuses", () => {
  it("returns 'in-sync' for fields where disk == tenant", () => {
    const d = fieldMap([["k1", hash("v")]]);
    const t = fieldMap([["k1", hash("v")]]);
    const m = perFieldStatuses(d, t, null);
    expect(m.get("k1")).toBe("in-sync");
  });

  it("distinguishes disk-ahead, tenant-edited, conflict per field", () => {
    const d = fieldMap([
      ["k1", hash("disk-edit")],
      ["k2", hash("same")],
      ["k3", hash("disk-side")],
    ]);
    const t = fieldMap([
      ["k1", hash("baseline")],
      ["k2", hash("tenant-edit")],
      ["k3", hash("tenant-side")],
    ]);
    const b = fieldMap([
      ["k1", hash("baseline")],
      ["k2", hash("same")],
      ["k3", hash("baseline")],
    ]);
    const m = perFieldStatuses(d, t, b);
    expect(m.get("k1")).toBe("disk-ahead");
    expect(m.get("k2")).toBe("tenant-edited");
    expect(m.get("k3")).toBe("conflict");
  });

  it("keys present only on disk → disk-ahead (likely local addition); only on tenant → tenant-edited (likely CMS addition); first-pull friendliness", () => {
    // Audit R4 fix: before, one-side-only classified as "conflict" and
    // blocked the first pull under --policy=error. Now classifies as the
    // "ahead" side which matches the operator's mental model (a field
    // present on only one side is an addition, not a conflict).
    const d = fieldMap([["only-disk", hash("v")]]);
    const t = fieldMap([["only-tenant", hash("v")]]);
    const m = perFieldStatuses(d, t, null);
    expect(m.get("only-disk")).toBe("disk-ahead");
    expect(m.get("only-tenant")).toBe("tenant-edited");
  });

  it("handles null disk or null tenant gracefully", () => {
    expect(perFieldStatuses(null, null, null).size).toBe(0);
    const t = fieldMap([["k1", hash("v")]]);
    const m = perFieldStatuses(null, t, null);
    // Tenant has it, disk doesn't, no baseline → tenant-edited (per
    // audit R4 fix).
    expect(m.get("k1")).toBe("tenant-edited");
  });

  it("both sides differ + no baseline → conflict (can't tell who moved)", () => {
    const d = fieldMap([["k1", hash("d")]]);
    const t = fieldMap([["k1", hash("t")]]);
    expect(perFieldStatuses(d, t, null).get("k1")).toBe("conflict");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// mergeContentValueRecipe — per-field synthesis for content-item / page.
// ─────────────────────────────────────────────────────────────────────────

import { mergeContentValueRecipe } from "../../../../src/recipe/tasks/pull";
import type { ContentItemRecipe, PageRecipe } from "../../../../src/recipe/schema/recipe";

const ITEM_REF = "11111111-1111-1111-1111-111111111111";
const fk = (name: string, lang = "en", version: number | "" = 1): string =>
  `${ITEM_REF.toLowerCase()}|name:${name.toLowerCase()}|${lang}|${version === "" ? "" : version}`;

const ciRecipe = (over: Partial<ContentItemRecipe>): ContentItemRecipe => ({
  kind: "content-item",
  schemaVersion: "1",
  handle: "primary-cta@1",
  name: "primary-cta",
  displayName: "Primary CTA",
  templateType: "nav-link@1",
  fields: {},
  ...over,
});

describe("mergeContentValueRecipe — content-item per-field merge", () => {
  it("disk-ahead fields are preserved; others come from tenant (tenant-wins)", () => {
    const disk = ciRecipe({
      fields: {
        Title: { shape: "text", value: "disk-title" }, // disk-ahead
        Body: { shape: "text", value: "any" }, // tenant-edited → take tenant
      },
    });
    const tenant = ciRecipe({
      fields: {
        Title: { shape: "text", value: "tenant-title" },
        Body: { shape: "text", value: "tenant-body" },
      },
    });
    const statuses = new Map([
      [fk("Title"), "disk-ahead" as const],
      [fk("Body"), "tenant-edited" as const],
    ]);
    const merged = mergeContentValueRecipe(disk, tenant, statuses, ITEM_REF) as ContentItemRecipe;
    expect(merged.fields.Title).toEqual({ shape: "text", value: "disk-title" });
    expect(merged.fields.Body).toEqual({ shape: "text", value: "tenant-body" });
  });

  it("fields with no status (in-sync) take tenant value", () => {
    const disk = ciRecipe({ fields: { Title: { shape: "text", value: "same" } } });
    const tenant = ciRecipe({ fields: { Title: { shape: "text", value: "same" } } });
    const merged = mergeContentValueRecipe(disk, tenant, new Map(), ITEM_REF) as ContentItemRecipe;
    expect(merged.fields.Title).toEqual({ shape: "text", value: "same" });
  });

  it("shared bucket merges per-field (no language/version)", () => {
    const disk = ciRecipe({
      shared: {
        Enabled: { shape: "boolean", value: false }, // disk-ahead
        OnlyDisk: { shape: "text", value: "kept" },
      },
    });
    const tenant = ciRecipe({
      shared: {
        Enabled: { shape: "boolean", value: true },
        OnlyTenant: { shape: "text", value: "added" },
      },
    });
    const statuses = new Map([
      [fk("Enabled", "", ""), "disk-ahead" as const],
      [fk("OnlyDisk", "", ""), "disk-ahead" as const],
      [fk("OnlyTenant", "", ""), "tenant-edited" as const],
    ]);
    const merged = mergeContentValueRecipe(disk, tenant, statuses, ITEM_REF) as ContentItemRecipe;
    expect(merged.shared).toEqual({
      Enabled: { shape: "boolean", value: false }, // disk wins
      OnlyDisk: { shape: "text", value: "kept" },
      OnlyTenant: { shape: "text", value: "added" },
    });
  });

  it("translations merge per-language per-field", () => {
    const disk = ciRecipe({
      fields: { Title: { shape: "text", value: "en-disk" } },
      translations: {
        fr: { fields: { Title: { shape: "text", value: "fr-disk" } } },
      },
    });
    const tenant = ciRecipe({
      fields: { Title: { shape: "text", value: "en-tenant" } },
      translations: {
        fr: { fields: { Title: { shape: "text", value: "fr-tenant" } } },
      },
    });
    const statuses = new Map([
      [fk("Title", "en", 1), "disk-ahead" as const],
      [fk("Title", "fr", 1), "tenant-edited" as const],
    ]);
    const merged = mergeContentValueRecipe(disk, tenant, statuses, ITEM_REF) as ContentItemRecipe;
    expect(merged.fields.Title).toEqual({ shape: "text", value: "en-disk" });
    expect(merged.translations?.fr.fields.Title).toEqual({
      shape: "text",
      value: "fr-tenant",
    });
  });

  it("versions merge per-(language, version) per-field; per-version metadata from tenant", () => {
    const disk = ciRecipe({
      fields: {},
      versions: {
        en: [
          {
            version: 1,
            fields: { Title: { shape: "text", value: "v1-disk" } },
            workflowState: "draft-disk",
          },
        ],
      },
    });
    const tenant = ciRecipe({
      fields: {},
      versions: {
        en: [
          {
            version: 1,
            fields: { Title: { shape: "text", value: "v1-tenant" } },
            workflowState: "draft-tenant",
          },
          {
            version: 2,
            fields: { Title: { shape: "text", value: "v2-tenant" } },
          },
        ],
      },
    });
    const statuses = new Map([
      [fk("Title", "en", 1), "disk-ahead" as const],
      // v2 is tenant-only — no status, defaults to tenant.
    ]);
    const merged = mergeContentValueRecipe(disk, tenant, statuses, ITEM_REF) as ContentItemRecipe;
    expect(merged.versions?.en).toHaveLength(2);
    // v1: per-field merge takes disk's Title; per-version metadata
    // (workflowState) comes from tenant since base = tenant.
    expect(merged.versions?.en[0].fields.Title).toEqual({ shape: "text", value: "v1-disk" });
    expect(merged.versions?.en[0].workflowState).toBe("draft-tenant");
    // v2: tenant-only, adopted whole.
    expect(merged.versions?.en[1].fields.Title).toEqual({ shape: "text", value: "v2-tenant" });
  });

  it("falls back to tenantRecipe when mainItemRefKey is undefined", () => {
    const disk = ciRecipe({ fields: { Title: { shape: "text", value: "disk" } } });
    const tenant = ciRecipe({ fields: { Title: { shape: "text", value: "tenant" } } });
    const merged = mergeContentValueRecipe(disk, tenant, new Map(), undefined);
    expect(merged).toBe(tenant);
  });
});

describe("mergeContentValueRecipe — page per-field merge", () => {
  const pageRecipe = (over: Partial<PageRecipe>): PageRecipe => ({
    kind: "page",
    schemaVersion: "1",
    handle: "about@1",
    name: "About",
    displayName: "About",
    template: "article-page@1",
    fields: {},
    ...over,
  });

  it("page kind round-trips through per-field merge same as content-item", () => {
    const disk = pageRecipe({
      fields: { MetaTitle: { shape: "text", value: "disk-meta" } },
    });
    const tenant = pageRecipe({
      fields: { MetaTitle: { shape: "text", value: "tenant-meta" } },
    });
    const statuses = new Map([[fk("MetaTitle"), "disk-ahead" as const]]);
    const merged = mergeContentValueRecipe(disk, tenant, statuses, ITEM_REF) as PageRecipe;
    expect(merged.fields.MetaTitle).toEqual({ shape: "text", value: "disk-meta" });
  });

  it("page item-level layout: disk-ahead preserves disk's layout, otherwise tenant wins", () => {
    const diskLayout = {
      placeholders: {
        "headless-main": [{ componentHandle: "alpha@1", datasourceRef: { kind: "none" as const } }],
      },
    };
    const tenantLayout = {
      placeholders: {
        "headless-main": [{ componentHandle: "beta@1", datasourceRef: { kind: "none" as const } }],
      },
    };
    const disk = pageRecipe({ layout: diskLayout });
    const tenant = pageRecipe({ layout: tenantLayout });

    // No status entry → defaults to tenant.
    const defaultMerged = mergeContentValueRecipe(disk, tenant, new Map(), ITEM_REF) as PageRecipe;
    expect(defaultMerged.layout).toEqual(tenantLayout);

    // Layout cell explicitly disk-ahead → keep disk's layout.
    // The IR's layout SetField uses fieldId LAYOUT_FIELDS.FINAL_RENDERINGS
    // (no fieldName), so the lookup key uses `id:<guid>` not `name:`.
    const layoutKey = `${ITEM_REF.toLowerCase()}|id:04bf00db-f5fb-41f7-8ab7-22408372a981|en|1`;
    const diskAheadMerged = mergeContentValueRecipe(
      disk,
      tenant,
      new Map([[layoutKey, "disk-ahead" as const]]),
      ITEM_REF
    ) as PageRecipe;
    expect(diskAheadMerged.layout).toEqual(diskLayout);

    // tenant-edited → tenant wins.
    const tenantEditedMerged = mergeContentValueRecipe(
      disk,
      tenant,
      new Map([[layoutKey, "tenant-edited" as const]]),
      ITEM_REF
    ) as PageRecipe;
    expect(tenantEditedMerged.layout).toEqual(tenantLayout);
  });

  it("per-version layout: disk-ahead preserves disk, others yield to tenant", () => {
    const diskLayout = {
      placeholders: {
        main: [{ componentHandle: "alpha@1", datasourceRef: { kind: "none" as const } }],
      },
    };
    const tenantLayout = {
      placeholders: {
        main: [{ componentHandle: "beta@1", datasourceRef: { kind: "none" as const } }],
      },
    };
    const disk = ciRecipe({
      fields: {},
      versions: {
        en: [{ version: 1, fields: {}, layout: diskLayout }],
      },
    });
    const tenant = ciRecipe({
      fields: {},
      versions: {
        en: [{ version: 1, fields: {}, layout: tenantLayout }],
      },
    });
    const layoutKey = `${ITEM_REF.toLowerCase()}|id:04bf00db-f5fb-41f7-8ab7-22408372a981|en|1`;

    const diskAhead = mergeContentValueRecipe(
      disk,
      tenant,
      new Map([[layoutKey, "disk-ahead" as const]]),
      ITEM_REF
    ) as ContentItemRecipe;
    expect(diskAhead.versions?.en[0].layout).toEqual(diskLayout);

    const tenantEdited = mergeContentValueRecipe(
      disk,
      tenant,
      new Map([[layoutKey, "tenant-edited" as const]]),
      ITEM_REF
    ) as ContentItemRecipe;
    expect(tenantEdited.versions?.en[0].layout).toEqual(tenantLayout);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// mergeTemplateRecipe — per-field merge for template-style recipes.
// Matches fields by NAME (the stable identity); FieldDefinition is the
// merge unit, not its sub-properties.
// ─────────────────────────────────────────────────────────────────────────

import { mergeTemplateRecipe } from "../../../../src/recipe/tasks/pull";
import type {
  ComponentTemplateRecipe,
  ContentTemplateRecipe,
} from "../../../../src/recipe/schema/recipe";
import type { OperationIr } from "../../../../src/recipe/ir/operations";

/** Build a stub IR whose CreateItem labels declare per-field refKeys. */
const stubTemplateIr = (
  handle: string,
  fieldRefKeys: Record<string, string>,
  paramRefKeys: Record<string, string> = {}
): OperationIr => ({
  schemaVersion: "1",
  recipeHandle: handle,
  operations: [
    ...Object.entries(fieldRefKeys).map(([name, id]) => ({
      op: "CreateItem" as const,
      policy: "CreateAndUpdate" as const,
      label: `field:${handle}/${name}`,
      id,
      path: "/sitecore/templates/test/" + name,
      parent: { kind: "ref-path" as const, value: "/sitecore/templates/test" },
      templateOf: "tpl",
      name,
      fields: [],
    })),
    ...Object.entries(paramRefKeys).map(([name, id]) => ({
      op: "CreateItem" as const,
      policy: "CreateAndUpdate" as const,
      label: `params-field:${handle}/${name}`,
      id,
      path: "/sitecore/templates/test/Parameters/" + name,
      parent: { kind: "ref-path" as const, value: "/sitecore/templates/test/Parameters" },
      templateOf: "tpl",
      name,
      fields: [],
    })),
  ],
});

/** Build a status entry under a field's refKey for the rollup. */
const fieldPropKey = (fieldRefKey: string, property: string): string =>
  `${fieldRefKey.toLowerCase()}|name:${property.toLowerCase()}|en|1`;

const componentTemplate = (over: Partial<ComponentTemplateRecipe>): ComponentTemplateRecipe => ({
  kind: "component-template",
  schemaVersion: "1",
  handle: "hero@1",
  name: "Hero",
  displayName: "Hero",
  fields: [],
  variants: [],
  params: [],
  placedIn: [],
  placeholders: [],
  dynamicPlaceholders: false,
  ...over,
});

const contentTemplate = (over: Partial<ContentTemplateRecipe>): ContentTemplateRecipe => ({
  kind: "content-template",
  schemaVersion: "1",
  handle: "article@1",
  name: "Article",
  displayName: "Article",
  fields: [],
  ...over,
});

describe("mergeTemplateRecipe — ComponentTemplate per-field merge", () => {
  it("disk-ahead field preserves disk's FieldDefinition; others take tenant", () => {
    const disk = componentTemplate({
      fields: [
        { name: "Title", shape: "text", sitecore: { type: "single-line-text" } },
        { name: "Body", shape: "text", sitecore: { type: "rich-text" } },
      ],
    });
    const tenant = componentTemplate({
      fields: [
        { name: "Title", shape: "text", sitecore: { type: "single-line-text" } },
        { name: "Body", shape: "text", sitecore: { type: "rich-text" } },
      ],
    });
    // Override tenant's Body field to differ from disk.
    tenant.fields[1] = { name: "Body", shape: "richText", sitecore: { type: "rich-text" } };
    // Disk-ahead override for tenant's Title (operator added a Source locally).
    disk.fields[0] = {
      name: "Title",
      shape: "text",
      sitecore: { type: "single-line-text", source: "/sitecore/content/snippets" },
    };

    const diskIr = stubTemplateIr("hero@1", {
      Title: "title-ref",
      Body: "body-ref",
    });
    const tenantIr = stubTemplateIr("hero@1", {
      Title: "title-ref",
      Body: "body-ref",
    });
    const statuses = new Map([
      // Title is disk-ahead (one of its properties moved on disk only)
      [fieldPropKey("title-ref", "Source"), "disk-ahead" as const],
      // Body is tenant-edited (tenant moved the Type)
      [fieldPropKey("body-ref", "Type"), "tenant-edited" as const],
    ]);

    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      statuses,
      diskIr,
      tenantIr
    ) as ComponentTemplateRecipe;
    // Title (disk-ahead) → disk's FieldDefinition (with source).
    expect(merged.fields[0]).toEqual(disk.fields[0]);
    // Body (tenant-edited) → tenant's FieldDefinition.
    expect(merged.fields[1]).toEqual(tenant.fields[1]);
  });

  it("field present only on disk (likely disk-add or tenant-delete) is preserved under tenant-wins", () => {
    const disk = componentTemplate({
      fields: [
        { name: "Title", shape: "text" },
        { name: "OnlyDisk", shape: "richText" },
      ],
    });
    const tenant = componentTemplate({
      fields: [{ name: "Title", shape: "text" }],
    });
    const diskIr = stubTemplateIr("hero@1", { Title: "t", OnlyDisk: "d" });
    const tenantIr = stubTemplateIr("hero@1", { Title: "t" });
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      new Map(),
      diskIr,
      tenantIr
    ) as ComponentTemplateRecipe;
    expect(merged.fields.map((f) => f.name)).toEqual(["Title", "OnlyDisk"]);
    expect(merged.fields[1].shape).toBe("richText");
  });

  it("field present only on tenant (new in CMS) is adopted at tenant order position", () => {
    const disk = componentTemplate({
      fields: [{ name: "Title", shape: "text" }],
    });
    const tenant = componentTemplate({
      fields: [
        { name: "Title", shape: "text" },
        { name: "OnlyTenant", shape: "image" },
      ],
    });
    const diskIr = stubTemplateIr("hero@1", { Title: "t" });
    const tenantIr = stubTemplateIr("hero@1", { Title: "t", OnlyTenant: "ot" });
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      new Map(),
      diskIr,
      tenantIr
    ) as ComponentTemplateRecipe;
    expect(merged.fields.map((f) => f.name)).toEqual(["Title", "OnlyTenant"]);
    expect(merged.fields[1].shape).toBe("image");
  });

  it("disk-ahead + tenant-edited within the same field → conflict → tenant wins under tenant-wins", () => {
    // Title's Source moved on disk, Title's SortOrder moved on tenant.
    // Field-level rollup: conflict (different properties moved on different sides).
    // Under tenant-wins: take tenant's FieldDefinition.
    const disk = componentTemplate({
      fields: [
        {
          name: "Title",
          shape: "text",
          sitecore: { type: "single-line-text", source: "disk-source" },
        },
      ],
    });
    const tenant = componentTemplate({
      fields: [
        { name: "Title", shape: "text", sitecore: { type: "single-line-text", sortOrder: 100 } },
      ],
    });
    const diskIr = stubTemplateIr("hero@1", { Title: "title-ref" });
    const tenantIr = stubTemplateIr("hero@1", { Title: "title-ref" });
    const statuses = new Map([
      [fieldPropKey("title-ref", "Source"), "disk-ahead" as const],
      [fieldPropKey("title-ref", "__Sortorder"), "tenant-edited" as const],
    ]);
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      statuses,
      diskIr,
      tenantIr
    ) as ComponentTemplateRecipe;
    // Field-level rollup is conflict (mixed disk-ahead + tenant-edited
    // within one field's property set) → tenant wins.
    expect(merged.fields[0]).toEqual(tenant.fields[0]);
  });

  it("params[] merges the same way as fields[]", () => {
    const disk = componentTemplate({
      fields: [],
      params: [
        { name: "Size", shape: "enum", sitecore: { type: "droplist", source: "disk-list" } },
      ],
    });
    const tenant = componentTemplate({
      fields: [],
      params: [
        { name: "Size", shape: "enum", sitecore: { type: "droplist", source: "tenant-list" } },
      ],
    });
    const diskIr = stubTemplateIr("hero@1", {}, { Size: "size-ref" });
    const tenantIr = stubTemplateIr("hero@1", {}, { Size: "size-ref" });
    const statuses = new Map([[fieldPropKey("size-ref", "Source"), "disk-ahead" as const]]);
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      statuses,
      diskIr,
      tenantIr
    ) as ComponentTemplateRecipe;
    // Disk-ahead → disk's Size param preserved.
    expect(merged.params?.[0].sitecore?.source).toBe("disk-list");
  });

  it("non-field surface (variants, placeholders, displayName) comes from tenant base", () => {
    const disk = componentTemplate({
      fields: [],
      displayName: "Disk Hero",
      variants: [],
    });
    const tenant = componentTemplate({
      fields: [],
      displayName: "Tenant Hero",
      variants: [],
    });
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      new Map(),
      stubTemplateIr("hero@1", {}),
      stubTemplateIr("hero@1", {})
    ) as ComponentTemplateRecipe;
    expect(merged.displayName).toBe("Tenant Hero");
  });
});

describe("mergeTemplateRecipe — ContentTemplate works the same as ComponentTemplate", () => {
  it("disk-ahead field preserved; params concept absent on ContentTemplate so only fields merge", () => {
    const disk = contentTemplate({
      fields: [{ name: "Body", shape: "richText" }],
    });
    const tenant = contentTemplate({
      fields: [{ name: "Body", shape: "text" }],
    });
    const diskIr = stubTemplateIr("article@1", { Body: "body-ref" });
    const tenantIr = stubTemplateIr("article@1", { Body: "body-ref" });
    const statuses = new Map([[fieldPropKey("body-ref", "Type"), "disk-ahead" as const]]);
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      statuses,
      diskIr,
      tenantIr
    ) as ContentTemplateRecipe;
    expect(merged.fields[0].shape).toBe("richText");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// composeMergePlan + winnerOverrides — merge-plan file mode.
// Operator edits the plan file, re-runs pull --apply-plan, picks the
// winner per-field.
// ─────────────────────────────────────────────────────────────────────────

import { composeMergePlan, loadMergePlan } from "../../../../src/recipe/tasks/pull";

describe("composeMergePlan — default winners per policy", () => {
  const entries = [
    {
      handle: "hero@1",
      kind: "content-item",
      rollupStatus: "conflict" as const,
      fieldStatuses: new Map<string, "in-sync" | "disk-ahead" | "tenant-edited" | "conflict">([
        ["k-in-sync", "in-sync"],
        ["k-disk-ahead", "disk-ahead"],
        ["k-tenant-edited", "tenant-edited"],
        ["k-conflict", "conflict"],
      ]),
    },
  ];

  it("tenant-wins: disk-ahead → disk, everything else → tenant", () => {
    const plan = composeMergePlan("staging", "tenant-wins", "2026-06-01T00:00:00Z", entries);
    const fieldByKey = Object.fromEntries(plan.recipes[0].fields.map((f) => [f.rawKey, f.winner]));
    expect(fieldByKey["k-in-sync"]).toBe("tenant");
    expect(fieldByKey["k-disk-ahead"]).toBe("disk");
    expect(fieldByKey["k-tenant-edited"]).toBe("tenant");
    expect(fieldByKey["k-conflict"]).toBe("tenant");
  });

  it("disk-wins: in-sync + tenant-edited → tenant, disk-ahead + conflict → disk", () => {
    const plan = composeMergePlan("staging", "disk-wins", "2026-06-01T00:00:00Z", entries);
    const fieldByKey = Object.fromEntries(plan.recipes[0].fields.map((f) => [f.rawKey, f.winner]));
    expect(fieldByKey["k-in-sync"]).toBe("tenant");
    expect(fieldByKey["k-disk-ahead"]).toBe("disk");
    expect(fieldByKey["k-tenant-edited"]).toBe("tenant");
    expect(fieldByKey["k-conflict"]).toBe("disk");
  });

  it("error policy uses tenant-wins defaults (disk only when disk-ahead)", () => {
    const plan = composeMergePlan("staging", "error", "2026-06-01T00:00:00Z", entries);
    const fieldByKey = Object.fromEntries(plan.recipes[0].fields.map((f) => [f.rawKey, f.winner]));
    expect(fieldByKey["k-disk-ahead"]).toBe("disk");
    expect(fieldByKey["k-conflict"]).toBe("tenant");
  });

  it("skips recipes with no per-field statuses (nothing to reconcile)", () => {
    const plan = composeMergePlan("staging", "tenant-wins", "now", [
      {
        handle: "empty@1",
        kind: "content-item",
        rollupStatus: "in-sync",
        fieldStatuses: new Map(),
      },
    ]);
    expect(plan.recipes).toEqual([]);
  });
});

describe("loadMergePlan — schema validation", () => {
  it("loads a valid plan from disk", async () => {
    const planPath = path.join(tmpDir, "plan.json");
    const plan = composeMergePlan("staging", "tenant-wins", "2026-06-01T00:00:00Z", [
      {
        handle: "hero@1",
        kind: "content-item",
        rollupStatus: "tenant-edited",
        fieldStatuses: new Map([["k1", "tenant-edited"]]),
      },
    ]);
    await fs.writeFile(planPath, JSON.stringify(plan), "utf8");
    const loaded = await loadMergePlan(planPath);
    expect(loaded.environment).toBe("staging");
    expect(loaded.recipes[0].handle).toBe("hero@1");
  });

  it("throws INPUT_INVALID when file is missing", async () => {
    await expect(loadMergePlan(path.join(tmpDir, "missing.json"))).rejects.toThrow(
      /Merge plan file not found/
    );
  });

  it("throws INPUT_INVALID on schema violation", async () => {
    const planPath = path.join(tmpDir, "bad.json");
    await fs.writeFile(planPath, JSON.stringify({ wrong: "shape" }), "utf8");
    await expect(loadMergePlan(planPath)).rejects.toThrow(/Invalid merge plan/);
  });
});

describe("winnerOverrides — per-field overrides beat default policy", () => {
  it("mergeContentValueRecipe honours winnerOverrides over classification", () => {
    const disk = ciRecipe({
      fields: {
        Title: { shape: "text", value: "disk-title" },
        Body: { shape: "text", value: "disk-body" },
      },
    });
    const tenant = ciRecipe({
      fields: {
        Title: { shape: "text", value: "tenant-title" },
        Body: { shape: "text", value: "tenant-body" },
      },
    });
    // Classifications WITHOUT overrides: Title=disk-ahead (would pick
    // disk), Body=tenant-edited (would pick tenant).
    const statuses = new Map([
      [fk("Title"), "disk-ahead" as const],
      [fk("Body"), "tenant-edited" as const],
    ]);
    // Overrides FLIP both: operator decided Title should take tenant
    // (adopt CMS edit) and Body should take disk (preserve local).
    const overrides = new Map<string, "disk" | "tenant">([
      [fk("Title"), "tenant"],
      [fk("Body"), "disk"],
    ]);
    const merged = mergeContentValueRecipe(
      disk,
      tenant,
      statuses,
      ITEM_REF,
      overrides
    ) as ContentItemRecipe;
    expect(merged.fields.Title).toEqual({ shape: "text", value: "tenant-title" });
    expect(merged.fields.Body).toEqual({ shape: "text", value: "disk-body" });
  });

  it("mergeTemplateRecipe honours winnerOverrides per template-field (by refKey)", () => {
    const disk = componentTemplate({
      fields: [
        {
          name: "Title",
          shape: "text",
          sitecore: { type: "single-line-text", source: "disk-src" },
        },
      ],
    });
    const tenant = componentTemplate({
      fields: [
        {
          name: "Title",
          shape: "text",
          sitecore: { type: "single-line-text", source: "tenant-src" },
        },
      ],
    });
    const diskIr = stubTemplateIr("hero@1", { Title: "title-ref" });
    const tenantIr = stubTemplateIr("hero@1", { Title: "title-ref" });
    // Classification says disk-ahead (would pick disk). Override flips to tenant.
    const statuses = new Map([[fieldPropKey("title-ref", "Source"), "disk-ahead" as const]]);
    const overrides = new Map<string, "disk" | "tenant">([["title-ref", "tenant"]]);
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      statuses,
      diskIr,
      tenantIr,
      overrides
    ) as ComponentTemplateRecipe;
    expect(merged.fields[0].sitecore?.source).toBe("tenant-src");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Audit fix regression tests
// ─────────────────────────────────────────────────────────────────────────

describe("audit B2 — tenant-side deletions accepted via merge-plan override", () => {
  it("mergeContentValueRecipe omits a disk-only field when operator picks 'tenant'", () => {
    // Disk has Title + Body; tenant deleted Body (only has Title).
    // Without override: disk's Body would be preserved (default-safe).
    // With explicit override `winner: tenant` for the Body key: omit.
    const disk = ciRecipe({
      fields: {
        Title: { shape: "text", value: "ok" },
        Body: { shape: "text", value: "to-be-deleted" },
      },
    });
    const tenant = ciRecipe({ fields: { Title: { shape: "text", value: "ok" } } });
    const overrides = new Map<string, "disk" | "tenant">([[fk("Body"), "tenant"]]);
    const merged = mergeContentValueRecipe(
      disk,
      tenant,
      new Map(),
      ITEM_REF,
      overrides
    ) as ContentItemRecipe;
    expect(Object.keys(merged.fields)).toEqual(["Title"]);
    expect(merged.fields.Body).toBeUndefined();
  });

  it("mergeTemplateRecipe omits a disk-only field when operator picks 'tenant'", () => {
    const disk = componentTemplate({
      fields: [
        { name: "Title", shape: "text" },
        { name: "Body", shape: "text" }, // disk-only — tenant deleted
      ],
    });
    const tenant = componentTemplate({
      fields: [{ name: "Title", shape: "text" }],
    });
    const diskIr = stubTemplateIr("hero@1", { Title: "t", Body: "b" });
    const tenantIr = stubTemplateIr("hero@1", { Title: "t" });
    // Override: operator picked tenant for Body (= accept deletion).
    const overrides = new Map<string, "disk" | "tenant">([["b", "tenant"]]);
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      new Map(),
      diskIr,
      tenantIr,
      overrides
    ) as ComponentTemplateRecipe;
    expect(merged.fields.map((f) => f.name)).toEqual(["Title"]);
  });

  it("default behaviour (no override) preserves disk-only fields — safe default", () => {
    const disk = componentTemplate({
      fields: [
        { name: "Title", shape: "text" },
        { name: "OnlyDisk", shape: "text" },
      ],
    });
    const tenant = componentTemplate({ fields: [{ name: "Title", shape: "text" }] });
    const diskIr = stubTemplateIr("hero@1", { Title: "t", OnlyDisk: "od" });
    const tenantIr = stubTemplateIr("hero@1", { Title: "t" });
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      new Map(),
      diskIr,
      tenantIr
    ) as ComponentTemplateRecipe;
    expect(merged.fields.map((f) => f.name)).toEqual(["Title", "OnlyDisk"]);
  });
});

describe("audit B1 — template merge-plan rollup produces field-level rawKeys", () => {
  it("composeMergePlan emits one entry per template field (not per property) when labels provided", () => {
    // Simulate the in-runRecipePull path: per-property statuses come
    // in; rollupTemplateStatuses (caller-side) collapses to per-field
    // before composeMergePlan sees them. The plan field count matches
    // the field count, not the property count.
    const perFieldRolled = new Map<string, "in-sync" | "disk-ahead" | "tenant-edited" | "conflict">(
      [
        ["title-ref", "disk-ahead"],
        ["body-ref", "tenant-edited"],
      ]
    );
    const labels = new Map<string, string>([
      ["title-ref", "Title"],
      ["body-ref", "Body"],
    ]);
    const plan = composeMergePlan("env", "tenant-wins", "now", [
      {
        handle: "hero@1",
        kind: "component-template",
        rollupStatus: "conflict",
        fieldStatuses: perFieldRolled,
        labels,
      },
    ]);
    expect(plan.recipes[0].fields).toHaveLength(2);
    expect(plan.recipes[0].fields[0]).toMatchObject({ field: "Title", rawKey: "title-ref" });
    expect(plan.recipes[0].fields[1]).toMatchObject({ field: "Body", rawKey: "body-ref" });
  });

  it("plan override applied via bare refKey wins in mergeTemplateRecipe (key-shape audit fix)", () => {
    // The audit B1 bug: composeMergePlan emitted per-property rawKeys
    // but mergeTemplateRecipe looked up by bare refKey → overrides
    // never matched. Now rolled per-field → keys match → overrides work.
    const disk = componentTemplate({
      fields: [{ name: "Title", shape: "text", sitecore: { source: "disk-source" } }],
    });
    const tenant = componentTemplate({
      fields: [{ name: "Title", shape: "text", sitecore: { source: "tenant-source" } }],
    });
    const diskIr = stubTemplateIr("hero@1", { Title: "title-ref" });
    const tenantIr = stubTemplateIr("hero@1", { Title: "title-ref" });
    // Plan-style override using BARE refKey (what composeMergePlan now emits).
    const overrides = new Map<string, "disk" | "tenant">([["title-ref", "tenant"]]);
    const merged = mergeTemplateRecipe(
      disk,
      tenant,
      // statuses say disk-ahead — would default to disk without override
      new Map([[fieldPropKey("title-ref", "Source"), "disk-ahead" as const]]),
      diskIr,
      tenantIr,
      overrides
    ) as ComponentTemplateRecipe;
    // Override forces tenant.
    expect(merged.fields[0].sitecore?.source).toBe("tenant-source");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// detectStalePlanDrift — apply-plan staleness verification helper
// (audit B3 fix; extracted from runRecipePull for unit-test coverage)
// ─────────────────────────────────────────────────────────────────────────

import { detectStalePlanDrift } from "../../../../src/recipe/tasks/pull";
import type { MergePlanRecipe } from "../../../../src/recipe/tasks/pull";

const planEntry = (
  fields: Array<{
    field: string;
    rawKey: string;
    status: "in-sync" | "disk-ahead" | "tenant-edited" | "conflict";
    winner: "disk" | "tenant";
  }>
): MergePlanRecipe => ({
  handle: "hero@1",
  kind: "content-item",
  rollupStatus: "tenant-edited",
  fields,
});

describe("detectStalePlanDrift", () => {
  it("returns [] when every plan-recorded status matches the current classification (fresh plan)", () => {
    const entry = planEntry([
      { field: "Title", rawKey: "k-title", status: "tenant-edited", winner: "tenant" },
      { field: "Body", rawKey: "k-body", status: "disk-ahead", winner: "disk" },
    ]);
    const current = new Map<string, "in-sync" | "disk-ahead" | "tenant-edited" | "conflict">([
      ["k-title", "tenant-edited"],
      ["k-body", "disk-ahead"],
    ]);
    expect(detectStalePlanDrift(entry, current)).toEqual([]);
  });

  it("flags fields whose status moved between write-plan and apply-plan", () => {
    // World moved: plan recorded tenant-edited on Title, but a push
    // happened in between and now Title classifies as in-sync. Applying
    // the stale `winner: tenant` pick would needlessly clobber a value
    // the operator already accepted.
    const entry = planEntry([
      { field: "Title", rawKey: "k-title", status: "tenant-edited", winner: "tenant" },
    ]);
    const current = new Map<string, "in-sync" | "disk-ahead" | "tenant-edited" | "conflict">([
      ["k-title", "in-sync"],
    ]);
    const drift = detectStalePlanDrift(entry, current);
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("Title");
    expect(drift[0]).toContain("tenant-edited");
    expect(drift[0]).toContain("in-sync");
  });

  it("flags fields that vanished from current classification (operator deleted disk recipe)", () => {
    const entry = planEntry([
      { field: "Title", rawKey: "k-title", status: "tenant-edited", winner: "tenant" },
    ]);
    const drift = detectStalePlanDrift(entry, new Map());
    expect(drift).toHaveLength(1);
    expect(drift[0]).toContain("absent");
  });

  it("rawKey lookup is case-insensitive (operator may hand-edit casing)", () => {
    const entry = planEntry([
      { field: "Title", rawKey: "K-Title", status: "tenant-edited", winner: "tenant" },
    ]);
    const current = new Map<string, "in-sync" | "disk-ahead" | "tenant-edited" | "conflict">([
      ["k-title", "tenant-edited"],
    ]);
    expect(detectStalePlanDrift(entry, current)).toEqual([]);
  });

  it("empty plan entry yields no drift (degenerate)", () => {
    expect(detectStalePlanDrift(planEntry([]), new Map())).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// assertWithinDir — defensive path-escape guard (audit H-1 belt-and-braces)
// ─────────────────────────────────────────────────────────────────────────

import { assertWithinDir } from "../../../../src/recipe/tasks/pull";

describe("assertWithinDir", () => {
  it("accepts a path inside the container", () => {
    expect(() =>
      assertWithinDir("/tmp/outDir", "/tmp/outDir/component-template/hero_v1.recipe.json")
    ).not.toThrow();
  });

  it("accepts the container directory itself + nested subdirectories", () => {
    expect(() => assertWithinDir("/tmp/outDir", "/tmp/outDir")).not.toThrow();
    expect(() =>
      assertWithinDir("/tmp/outDir", "/tmp/outDir/deeply/nested/file.json")
    ).not.toThrow();
  });

  it("rejects parent-directory traversal", () => {
    expect(() => assertWithinDir("/tmp/outDir", "/tmp/outDir/../sibling/escape.json")).toThrow(
      /Refusing to write outside the configured directory/
    );
    expect(() => assertWithinDir("/tmp/outDir", "/tmp/outDir/../../etc/pwn")).toThrow();
  });

  it("rejects absolute paths outside the container", () => {
    expect(() => assertWithinDir("/tmp/outDir", "/etc/passwd")).toThrow();
    expect(() => assertWithinDir("/tmp/outDir", "/tmp/sibling/file.json")).toThrow();
  });

  it("normalises relative containers + candidates consistently", () => {
    // Both relative — resolves against process.cwd() the same way.
    expect(() => assertWithinDir("./outDir", "./outDir/nested.json")).not.toThrow();
    expect(() => assertWithinDir("./outDir", "./other/escape.json")).toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// runRecipePull merge mode + --apply-plan integration: covers the env-
// mismatch refusal + missing-recipe refusal paths in the apply-plan path.
// (We can't mock the full compileRecipeSet pipeline cleanly, so this
// focuses on the up-front validation that runs BEFORE the per-recipe
// loop.)
// ─────────────────────────────────────────────────────────────────────────

describe("runRecipePull --apply-plan up-front validation", () => {
  it("refuses to apply a plan generated for a different environment", async () => {
    // Compose a plan tagged with a different env name, write it to
    // disk, then call runRecipePull with --apply-plan + --against
    // pointing at a different env.
    const planPath = path.join(tmpDir, "wrong-env.plan.json");
    const plan = composeMergePlan("staging", "tenant-wins", "2026-06-01T00:00:00Z", [
      {
        handle: "hero@1",
        kind: "content-item",
        rollupStatus: "tenant-edited",
        fieldStatuses: new Map([["k-title", "tenant-edited"]]),
      },
    ]);
    await fs.writeFile(planPath, JSON.stringify(plan), "utf8");

    vi.mocked(readCurrentRecipes).mockResolvedValue([] as never);
    // resolveTenant default fixture has envName="test-tenant" — plan
    // was generated for "staging", so env mismatch should fire BEFORE
    // any disk recipe loading happens.
    await expect(
      runRecipePull({
        output: tmpDir,
        against: "./recipes",
        applyPlan: planPath,
      })
    ).rejects.toThrow(/Merge plan was generated against environment 'staging'/);
  });
});
