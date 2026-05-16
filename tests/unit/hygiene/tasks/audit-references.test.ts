import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditReferences } from "../../../../src/hygiene/tasks/audit/references";

vi.mock("../../../../src/shared/env", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/shared/env";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const TARGET_GUID = "{abc12345-0000-0000-0000-000000000001}";
const TARGET_FLAT = "abc12345000000000000000000000001";
const TARGET_DASHED = "abc12345-0000-0000-0000-000000000001";
const TARGET_CURLY_UPPER = "{ABC12345-0000-0000-0000-000000000001}";

const setup = (
  items: Array<{
    id: string;
    fields: Array<{ name: string; value: string }>;
    templateName?: string;
  }>
): HygieneApiClient => {
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
          templateName: it.templateName ?? "Page",
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
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return client;
};

describe("audit references", () => {
  it("throws when --to is missing", async () => {
    setup([]);
    await expect(runAuditReferences({ json: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("detects each canonical Sitecore GUID form", async () => {
    setup([
      { id: "flat", fields: [{ name: "Body", value: `prefix ${TARGET_FLAT} suffix` }] },
      { id: "dashed", fields: [{ name: "Body", value: `text ${TARGET_DASHED} more` }] },
      {
        id: "curlyupper",
        fields: [{ name: "Body", value: `multilist|${TARGET_CURLY_UPPER}|otherguid` }],
      },
      { id: "irrelevant", fields: [{ name: "Body", value: "no ids here" }] },
    ]);

    const reports = await runAuditReferences({
      to: TARGET_GUID,
      json: true,
    });

    expect(reports).toHaveLength(3);
    const byId = new Map(reports.map((r) => [r.itemId, r]));
    expect(byId.get("flat")?.matches[0].form).toBe("flat");
    expect(byId.get("dashed")?.matches[0].form).toBe("dashed");
    expect(byId.get("curlyupper")?.matches[0].form).toBe("curly-upper");
  });

  it("ignores self-references", async () => {
    setup([
      // Item with itemId === target — this would normally match via _path or
      // similar self-ref field. The audit deliberately excludes the target
      // from its own reference list to avoid noise.
      {
        id: TARGET_FLAT,
        fields: [{ name: "_path", value: `${TARGET_DASHED}|otheritem` }],
      },
      { id: "other", fields: [{ name: "Link", value: TARGET_DASHED }] },
    ]);

    const reports = await runAuditReferences({ to: TARGET_GUID, json: true });

    expect(reports.map((r) => r.itemId)).toEqual(["other"]);
  });

  it("respects --fields to scope which fields are scanned", async () => {
    setup([
      {
        id: "a",
        fields: [
          { name: "Link", value: TARGET_DASHED },
          { name: "Body", value: TARGET_DASHED },
        ],
      },
    ]);

    const reports = await runAuditReferences({
      to: TARGET_GUID,
      fields: ["link"],
      json: true,
    });

    expect(reports).toHaveLength(1);
    expect(reports[0].matches.map((m) => m.fieldName)).toEqual(["Link"]);
  });

  it("excludes system fields when --include-system-fields is false", async () => {
    setup([
      {
        id: "a",
        fields: [
          { name: "__Renderings", value: TARGET_DASHED },
          { name: "Body", value: "no ref" },
        ],
      },
    ]);

    const reports = await runAuditReferences({
      to: TARGET_GUID,
      includeSystemFields: false,
      json: true,
    });

    expect(reports).toHaveLength(0);
  });

  it("includes system fields by default", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "__Renderings", value: TARGET_DASHED }],
      },
    ]);

    const reports = await runAuditReferences({ to: TARGET_GUID, json: true });

    expect(reports).toHaveLength(1);
    expect(reports[0].matches[0].fieldName).toBe("__Renderings");
  });
});
