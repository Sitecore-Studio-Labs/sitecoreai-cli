import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditFindReplace } from "../../../../src/hygiene/tasks/audit/find-replace";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (items: Array<{ id: string; fields: Array<{ name: string; value: string }> }>) => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const fieldsMap = new Map(
    items.map((it) => [it.id, it.fields.map((f) => ({ fieldId: "f1", ...f }))])
  );
  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of items) {
        yield {
          itemId: it.id,
          path: `/sitecore/content/${it.id}`,
          name: it.id,
          language: { name: "en" },
          version: 1,
        };
      }
    }),
    getItemFields: vi.fn(),
    getItemFieldsBatch: vi.fn().mockImplementation((ids: string[]) => {
      const m = new Map();
      for (const id of ids) m.set(id, fieldsMap.get(id) ?? null);
      return Promise.resolve(m);
    }),
    itemExists: vi.fn(),
    itemsExistBatch: vi.fn(),
    getItemVersions: vi.fn(),
    getItemWorkflow: vi.fn(),
    listArchivedItems: vi.fn(),
    deleteItemVersion: vi.fn(),
    deleteItem: vi.fn(),
    deleteItemTemplate: vi.fn(),
    deleteArchivedItem: vi.fn(),
    archiveVersion: vi.fn(),
    listItemTemplates: vi.fn(),
    getChildren: vi.fn(),
    updateItemFields: vi.fn(),
  } as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit find-replace — matching", () => {
  it("requires --pattern", async () => {
    setup([]);
    await expect(
      runAuditFindReplace({ pattern: "", root: "/sitecore/content", json: true } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("returns matches with counts and snippets", async () => {
    setup([{ id: "a", fields: [{ name: "Title", value: "Hello world. Hello again." }] }]);
    const result = await runAuditFindReplace({
      pattern: "Hello",
      literal: true,
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].matches[0].matchCount).toBe(2);
    expect(result[0].matches[0].samples[0]).toContain("Hello");
  });

  it("respects --fields filter", async () => {
    setup([
      {
        id: "a",
        fields: [
          { name: "Title", value: "Hello" },
          { name: "Body", value: "Hello" },
        ],
      },
    ]);
    const result = await runAuditFindReplace({
      pattern: "Hello",
      literal: true,
      fields: ["Title"],
      json: true,
    } as never);
    expect(result[0].matches).toHaveLength(1);
    expect(result[0].matches[0].fieldName).toBe("Title");
  });

  it("excludes __-prefixed system fields by default", async () => {
    setup([{ id: "a", fields: [{ name: "__Created", value: "Hello-stamp" }] }]);
    const result = await runAuditFindReplace({
      pattern: "Hello",
      literal: true,
      json: true,
    } as never);
    expect(result).toHaveLength(0);
  });

  it("includes __-prefixed fields when --include-system-fields", async () => {
    setup([{ id: "a", fields: [{ name: "__Created", value: "Hello-stamp" }] }]);
    const result = await runAuditFindReplace({
      pattern: "Hello",
      literal: true,
      includeSystemFields: true,
      json: true,
    } as never);
    expect(result).toHaveLength(1);
  });

  it("supports --ignore-case", async () => {
    setup([{ id: "a", fields: [{ name: "Title", value: "HELLO" }] }]);
    const result = await runAuditFindReplace({
      pattern: "hello",
      literal: true,
      ignoreCase: true,
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].matches[0].matchCount).toBe(1);
  });

  it("supports regex patterns (non-literal)", async () => {
    setup([{ id: "a", fields: [{ name: "Title", value: "v1.2.3 and v4.5.6" }] }]);
    const result = await runAuditFindReplace({
      pattern: "v\\d+\\.\\d+\\.\\d+",
      json: true,
    } as never);
    expect(result).toHaveLength(1);
    expect(result[0].matches[0].matchCount).toBe(2);
  });
});
