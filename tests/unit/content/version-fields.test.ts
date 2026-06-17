import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration } from "../../../src/config/types";
import {
  FIELD_NEVER_PUBLISH,
  FIELD_VALID_FROM,
  FIELD_VALID_TO,
  findField,
  formatBoolean,
  parseBoolean,
  readVersionFields,
  resolveSinglePathToId,
  writeVersionFields,
} from "../../../src/content/api/version-fields";
import { ScaiError } from "../../../src/shared/errors";

vi.mock("../../../src/authoring/graphql", () => ({
  runAuthoringGraphQL: vi.fn(),
}));

import { runAuthoringGraphQL } from "../../../src/authoring/graphql";
const mockRun = runAuthoringGraphQL as unknown as ReturnType<typeof vi.fn>;

const env: EnvironmentConfiguration = {
  name: "test",
  host: "test.sitecorecloud.io",
} as EnvironmentConfiguration;

beforeEach(() => {
  mockRun.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("parseBoolean / formatBoolean", () => {
  it('parses Sitecore wire form `"1"` as true and `""` as false', () => {
    expect(parseBoolean("1")).toBe(true);
    expect(parseBoolean("")).toBe(false);
    expect(parseBoolean("0")).toBe(false);
    expect(parseBoolean(null)).toBe(false);
    expect(parseBoolean(undefined)).toBe(false);
  });
  it('formats true → `"1"` and false → `""`', () => {
    expect(formatBoolean(true)).toBe("1");
    expect(formatBoolean(false)).toBe("");
  });
});

describe("findField", () => {
  const snapshot = {
    itemId: "id",
    name: "x",
    path: "/p",
    language: "en",
    version: 1,
    fields: [
      { name: FIELD_NEVER_PUBLISH, value: "1" },
      { name: FIELD_VALID_TO, value: "" },
    ],
  };
  it("returns the value when present", () => {
    expect(findField(snapshot, FIELD_NEVER_PUBLISH)).toBe("1");
    expect(findField(snapshot, FIELD_VALID_TO)).toBe("");
  });
  it("returns null when absent", () => {
    expect(findField(snapshot, FIELD_VALID_FROM)).toBeNull();
  });
});

describe("readVersionFields", () => {
  it("returns a snapshot keyed by language + version from the GraphQL response", async () => {
    mockRun.mockResolvedValue({
      item: {
        itemId: "id-1",
        name: "Home",
        path: "/sitecore/content/Home",
        version: {
          version: 3,
          language: { name: "en" },
          fields: {
            nodes: [
              { name: FIELD_NEVER_PUBLISH, value: "1" },
              { name: "Title", value: "Hi" },
            ],
          },
        },
      },
    });

    const snap = await readVersionFields(env, { itemId: "id-1", language: "en" });
    expect(snap.itemId).toBe("id-1");
    expect(snap.version).toBe(3);
    expect(snap.language).toBe("en");
    expect(findField(snap, FIELD_NEVER_PUBLISH)).toBe("1");
  });

  it("passes a specific version when provided", async () => {
    mockRun.mockResolvedValue({
      item: {
        itemId: "id-1",
        name: "Home",
        path: "/p",
        version: {
          version: 2,
          language: { name: "en" },
          fields: { nodes: [] },
        },
      },
    });
    await readVersionFields(env, { itemId: "id-1", language: "en", version: 2 });
    const [, , vars] = mockRun.mock.calls[0];
    expect((vars as Record<string, unknown>).version).toBe(2);
  });

  it("throws INPUT_INVALID when the item doesn't exist", async () => {
    mockRun.mockResolvedValue({ item: null });
    await expect(
      readVersionFields(env, { itemId: "missing", language: "en" })
    ).rejects.toBeInstanceOf(ScaiError);
    await expect(
      readVersionFields(env, { itemId: "missing", language: "en" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when the version doesn't exist for the language", async () => {
    mockRun.mockResolvedValue({
      item: {
        itemId: "id-1",
        name: "Home",
        path: "/p",
        version: null,
      },
    });
    await expect(
      readVersionFields(env, { itemId: "id-1", language: "fr-CA" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID", hint: expect.stringContaining("language") });
  });
});

describe("writeVersionFields", () => {
  it("issues the version-scoped UpdateItem mutation with provided fields", async () => {
    mockRun.mockResolvedValue({ updateItem: { item: { itemId: "id-1" } } });
    await writeVersionFields(env, {
      itemId: "id-1",
      language: "en",
      version: 3,
      fields: [{ name: FIELD_NEVER_PUBLISH, value: "1" }],
    });
    expect(mockRun).toHaveBeenCalledOnce();
    const [, query, vars] = mockRun.mock.calls[0];
    expect(query).toContain("updateItem");
    expect(query).toContain("$version: Int!");
    expect(vars).toMatchObject({
      itemId: "id-1",
      language: "en",
      version: 3,
      fields: [{ name: FIELD_NEVER_PUBLISH, value: "1" }],
    });
  });

  it("is a no-op when no fields are supplied", async () => {
    await writeVersionFields(env, {
      itemId: "id-1",
      language: "en",
      version: 1,
      fields: [],
    });
    expect(mockRun).not.toHaveBeenCalled();
  });

  it("disables retries by default (maxAttempts:1)", async () => {
    mockRun.mockResolvedValue({ updateItem: { item: { itemId: "id-1" } } });
    await writeVersionFields(env, {
      itemId: "id-1",
      language: "en",
      version: 1,
      fields: [{ name: FIELD_NEVER_PUBLISH, value: "1" }],
    });
    const opts = mockRun.mock.calls[0][3] as { retry?: { maxAttempts?: number } } | undefined;
    expect(opts?.retry?.maxAttempts).toBe(1);
  });
});

describe("resolveSinglePathToId", () => {
  it("returns the itemId for a found path", async () => {
    mockRun.mockResolvedValue({ item: { itemId: "id-1" } });
    expect(await resolveSinglePathToId(env, "/sitecore/content/Home")).toBe("id-1");
  });
  it("throws INPUT_INVALID for a missing path", async () => {
    mockRun.mockResolvedValue({ item: null });
    await expect(resolveSinglePathToId(env, "/missing")).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});
