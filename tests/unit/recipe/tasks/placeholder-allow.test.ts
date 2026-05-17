import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPlaceholderAllowControls } from "../../../../src/recipe/tasks/placeholder-allow";
import {
  PLACEHOLDER_FIELDS,
  PLACEHOLDER_TEMPLATE_ID,
} from "../../../../src/recipe/ir/sitecore-templates";
import type { AuthoringApiClient, RemoteItem } from "../../../../src/recipe/api/client";

const HERO_RENDERING_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const HERO_RENDERING_CURLY = "{AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA}";

const folder = (path: string): RemoteItem => ({
  itemId: `id-${path}`,
  templateId: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  parentId: "root",
  name: path.split("/").pop() ?? path,
  path,
  fields: [],
});

const placeholder = (path: string, key: string, allowedControls = ""): RemoteItem => ({
  itemId: `ph-${path}`,
  templateId: PLACEHOLDER_TEMPLATE_ID,
  parentId: "root",
  name: path.split("/").pop() ?? path,
  path,
  fields: [
    { fieldId: PLACEHOLDER_FIELDS.PLACEHOLDER_KEY, value: key },
    { fieldId: PLACEHOLDER_FIELDS.ALLOWED_CONTROLS, value: allowedControls },
  ],
});

const rendering = (path: string, itemId: string): RemoteItem => ({
  itemId,
  templateId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  parentId: "root",
  name: path.split("/").pop() ?? path,
  path,
  fields: [],
});

/** Build a fake AuthoringApiClient backed by path lookup maps. */
const makeClient = (
  itemsByPath: Record<string, RemoteItem>,
  childrenByPath: Record<string, RemoteItem[]> = {}
) => {
  const updateItem = vi.fn().mockResolvedValue(undefined);
  const client = {
    getItem: vi.fn(async (selector: { path?: string }) => itemsByPath[selector.path ?? ""] ?? null),
    getChildren: vi.fn(
      async (selector: { path?: string }) => childrenByPath[selector.path ?? ""] ?? []
    ),
    updateItem,
  } as unknown as AuthoringApiClient;
  return { client, updateItem };
};

const componentTemplate = (overrides: Record<string, unknown> = {}) => ({
  kind: "component-template",
  handle: "hero-handle",
  name: "Hero",
  placedIn: ["headless-main"],
  ...overrides,
});

const RENDERINGS_ROOT = "/sitecore/layout/Renderings/Project";
const PH_ROOT = "/sitecore/layout/Placeholder Settings/Project";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyPlaceholderAllowControls", () => {
  it("returns an empty summary when no component-template recipe declares placedIn", async () => {
    const { client, updateItem } = makeClient({});

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate({ placedIn: [] })] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result).toEqual({
      patched: 0,
      totalAdded: 0,
      unresolvedRecipeHandles: [],
      unmatchedPlaceholderKeys: [],
    });
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("records a recipe whose rendering item is missing on the tenant", async () => {
    const { client } = makeClient({}); // no rendering item at /…/Hero

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result.unresolvedRecipeHandles).toEqual(["hero-handle"]);
    expect(result.patched).toBe(0);
  });

  it("marks every requested key unmatched when no placeholder roots are configured", async () => {
    const { client } = makeClient({
      [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
    });

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [],
      apply: true,
    });

    expect(result.unmatchedPlaceholderKeys).toEqual(["headless-main"]);
    expect(result.patched).toBe(0);
  });

  it("appends the rendering id to a matching placeholder and writes it when apply=true", async () => {
    const ph = placeholder(`${PH_ROOT}/main`, "headless-main", "");
    const { client, updateItem } = makeClient(
      {
        [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/main`]: ph,
      },
      { [PH_ROOT]: [ph] }
    );
    const onUpdate = vi.fn();

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
      onUpdate,
    });

    expect(result).toMatchObject({ patched: 1, totalAdded: 1, unmatchedPlaceholderKeys: [] });
    expect(updateItem).toHaveBeenCalledTimes(1);
    expect(updateItem.mock.calls[0][0]).toMatchObject({
      itemId: ph.itemId,
      fields: [
        expect.objectContaining({
          fieldId: PLACEHOLDER_FIELDS.ALLOWED_CONTROLS,
          value: { kind: "string", value: HERO_RENDERING_CURLY },
        }),
      ],
    });
    expect(onUpdate).toHaveBeenCalledWith(`${PH_ROOT}/main`, 1);
  });

  it("plans without writing when apply=false", async () => {
    const ph = placeholder(`${PH_ROOT}/main`, "headless-main", "");
    const { client, updateItem } = makeClient(
      {
        [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/main`]: ph,
      },
      { [PH_ROOT]: [ph] }
    );

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: false,
    });

    expect(result.patched).toBe(1);
    expect(result.totalAdded).toBe(1);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("is idempotent — a placeholder already listing the rendering is not patched", async () => {
    const ph = placeholder(`${PH_ROOT}/main`, "headless-main", HERO_RENDERING_CURLY);
    const { client, updateItem } = makeClient(
      {
        [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/main`]: ph,
      },
      { [PH_ROOT]: [ph] }
    );

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result.patched).toBe(0);
    expect(result.totalAdded).toBe(0);
    expect(updateItem).not.toHaveBeenCalled();
  });

  it("rewrites a no-dash existing entry to canonical dashed-curly form (added=0 but patched)", async () => {
    const noDash = "{AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA}";
    const ph = placeholder(`${PH_ROOT}/main`, "headless-main", noDash);
    const { client, updateItem } = makeClient(
      {
        [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/main`]: ph,
      },
      { [PH_ROOT]: [ph] }
    );

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result.patched).toBe(1);
    expect(result.totalAdded).toBe(0);
    expect(updateItem.mock.calls[0][0].fields[0].value.value).toBe(HERO_RENDERING_CURLY);
  });

  it("resolves the rendering path through a component-section name", async () => {
    const ph = placeholder(`${PH_ROOT}/main`, "headless-main", "");
    const sectionedPath = `${RENDERINGS_ROOT}/Content/Hero`;
    const { client, updateItem } = makeClient(
      {
        [sectionedPath]: rendering(sectionedPath, HERO_RENDERING_ID),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/main`]: ph,
      },
      { [PH_ROOT]: [ph] }
    );

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [
        { kind: "component-section", handle: "sec-1", name: "Content" },
        componentTemplate({ section: { handle: "sec-1" } }),
      ] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result.patched).toBe(1);
    expect(updateItem).toHaveBeenCalledTimes(1);
  });

  it("reports placeholder keys that match no Placeholder Settings item", async () => {
    const otherPh = placeholder(`${PH_ROOT}/sidebar`, "headless-sidebar", "");
    const { client } = makeClient(
      {
        [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/sidebar`]: otherPh,
      },
      { [PH_ROOT]: [otherPh] }
    );

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result.unmatchedPlaceholderKeys).toEqual(["headless-main"]);
    expect(result.patched).toBe(0);
  });

  it("recurses into nested folders to find placeholders", async () => {
    const ph = placeholder(`${PH_ROOT}/nested/main`, "headless-main", "");
    const nestedFolder = folder(`${PH_ROOT}/nested`);
    const { client } = makeClient(
      {
        [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/nested`]: nestedFolder,
        [`${PH_ROOT}/nested/main`]: ph,
      },
      {
        [PH_ROOT]: [nestedFolder],
        [`${PH_ROOT}/nested`]: [ph],
      }
    );

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [componentTemplate()] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result.patched).toBe(1);
  });

  it("de-duplicates a placeholder key declared by multiple recipes", async () => {
    const ph = placeholder(`${PH_ROOT}/main`, "headless-main", "");
    const otherId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const { client, updateItem } = makeClient(
      {
        [`${RENDERINGS_ROOT}/Hero`]: rendering(`${RENDERINGS_ROOT}/Hero`, HERO_RENDERING_ID),
        [`${RENDERINGS_ROOT}/Card`]: rendering(`${RENDERINGS_ROOT}/Card`, otherId),
        [PH_ROOT]: folder(PH_ROOT),
        [`${PH_ROOT}/main`]: ph,
      },
      { [PH_ROOT]: [ph] }
    );

    const result = await applyPlaceholderAllowControls({
      client,
      recipes: [
        componentTemplate(),
        componentTemplate({ handle: "card-handle", name: "Card" }),
      ] as never,
      renderingsRoot: RENDERINGS_ROOT,
      placeholderSettingsRoots: [PH_ROOT],
      apply: true,
    });

    expect(result.patched).toBe(1);
    expect(result.totalAdded).toBe(2);
    expect(updateItem.mock.calls[0][0].fields[0].value.value.split("|")).toHaveLength(2);
  });
});
