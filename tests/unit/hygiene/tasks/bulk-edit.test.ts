import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runAuditEmptyLinks } from "../../../../src/hygiene/tasks/audit/empty-links";
import { runCleanupFieldSet } from "../../../../src/hygiene/tasks/cleanup/field-set";
import { runCleanupRename } from "../../../../src/hygiene/tasks/cleanup/rename";
import { runCleanupLanguageVersionAdd } from "../../../../src/hygiene/tasks/cleanup/language-version-add";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

const setup = (
  items: Array<{
    id: string;
    fields?: Array<{ name: string; value: string }>;
    name?: string;
    templateName?: string;
  }>
) => {
  const env = { name: "sandbox", host: "h", allowWrite: true } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const fieldsMap = new Map(
    items.map((it) => [it.id, (it.fields ?? []).map((f) => ({ fieldId: "f1", ...f }))])
  );
  const updateItemFields = vi.fn().mockResolvedValue(undefined);
  const renameItem = vi.fn().mockResolvedValue(undefined);
  const addItemVersion = vi.fn().mockResolvedValue({ versionNumber: 1 });
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
          name: it.name ?? it.id,
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
    updateItemFields,
    renameItem,
    addItemVersion,
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return { client, updateItemFields, renameItem, addItemVersion };
};

describe("audit empty-links", () => {
  it("flags <link/> with no targeting attributes", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "Cta", value: '<link linktype="internal" id="" />' }],
      },
    ]);
    const result = await runAuditEmptyLinks({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].emptyFields[0].reason).toBe("empty-attributes");
  });

  it("flags blank value on a name-hinted link field", async () => {
    setup([
      { id: "a", fields: [{ name: "PrimaryCTA", value: "" }] },
      { id: "b", fields: [{ name: "Title", value: "" }] }, // no name hint → ignored
    ]);
    const result = await runAuditEmptyLinks({ json: true } as never);
    expect(result).toHaveLength(1);
    expect(result[0].emptyFields[0].fieldName).toBe("PrimaryCTA");
    expect(result[0].emptyFields[0].reason).toBe("no-link-tag");
  });

  it("does not flag <link/> with a populated url or id", async () => {
    setup([
      {
        id: "a",
        fields: [{ name: "Cta", value: '<link linktype="external" url="https://x" />' }],
      },
    ]);
    const result = await runAuditEmptyLinks({ json: true } as never);
    expect(result).toHaveLength(0);
  });
});

describe("cleanup field-set", () => {
  it("mode=replace overwrites the field value", async () => {
    const { updateItemFields } = setup([{ id: "a", fields: [{ name: "Status", value: "draft" }] }]);
    const actions = await runCleanupFieldSet({
      field: "Status",
      value: "live",
      mode: "replace",
      allowWrite: true,
      json: true,
    } as never);
    expect(actions).toHaveLength(1);
    expect(actions[0].status).toBe("applied");
    expect(updateItemFields).toHaveBeenCalledWith({
      itemId: expect.any(String),
      fields: [{ name: "Status", value: "live" }],
    });
  });

  it("mode=clear wipes the field", async () => {
    const { updateItemFields } = setup([
      { id: "a", fields: [{ name: "Banner", value: "marketing-banner" }] },
    ]);
    await runCleanupFieldSet({
      field: "Banner",
      mode: "clear",
      allowWrite: true,
      json: true,
    } as never);
    expect(updateItemFields).toHaveBeenCalledWith({
      itemId: expect.any(String),
      fields: [{ name: "Banner", value: "" }],
    });
  });

  it("mode=add unions GUIDs into a pipe-delimited list", async () => {
    const { updateItemFields } = setup([
      {
        id: "a",
        fields: [
          {
            name: "Tags",
            value: "{11111111-1111-1111-1111-111111111111}",
          },
        ],
      },
    ]);
    await runCleanupFieldSet({
      field: "Tags",
      value: "{22222222-2222-2222-2222-222222222222}",
      mode: "add",
      allowWrite: true,
      json: true,
    } as never);
    const writtenValue = updateItemFields.mock.calls[0][0].fields[0].value as string;
    expect(writtenValue).toContain("11111111");
    expect(writtenValue).toContain("22222222");
    expect(writtenValue.split("|")).toHaveLength(2);
  });

  it("mode=remove subtracts GUIDs from the list", async () => {
    const { updateItemFields } = setup([
      {
        id: "a",
        fields: [
          {
            name: "Tags",
            value: "{11111111-1111-1111-1111-111111111111}|{22222222-2222-2222-2222-222222222222}",
          },
        ],
      },
    ]);
    await runCleanupFieldSet({
      field: "Tags",
      value: "{22222222-2222-2222-2222-222222222222}",
      mode: "remove",
      allowWrite: true,
      json: true,
    } as never);
    const writtenValue = updateItemFields.mock.calls[0][0].fields[0].value as string;
    expect(writtenValue).toContain("11111111");
    expect(writtenValue).not.toContain("22222222");
  });

  it("mode=add refuses non-pipe-delimited shapes (skips with shape error)", async () => {
    const { updateItemFields } = setup([
      { id: "a", fields: [{ name: "Title", value: "Hello world" }] },
    ]);
    const actions = await runCleanupFieldSet({
      field: "Title",
      value: "{11111111-1111-1111-1111-111111111111}",
      mode: "add",
      allowWrite: true,
      json: true,
    } as never);
    expect(actions[0].status).toBe("skipped-shape");
    expect(updateItemFields).not.toHaveBeenCalled();
  });

  it("--what-if reports plan without writing", async () => {
    const { updateItemFields } = setup([{ id: "a", fields: [{ name: "Status", value: "draft" }] }]);
    const actions = await runCleanupFieldSet({
      field: "Status",
      value: "live",
      mode: "replace",
      whatIf: true,
      json: true,
    } as never);
    expect(actions[0].status).toBe("what-if");
    expect(updateItemFields).not.toHaveBeenCalled();
  });

  it("--where-current-matches restricts to items whose current value matches", async () => {
    const { updateItemFields } = setup([
      { id: "a", fields: [{ name: "Status", value: "" }] },
      { id: "b", fields: [{ name: "Status", value: "already-set" }] },
    ]);
    await runCleanupFieldSet({
      field: "Status",
      value: "live",
      mode: "replace",
      whereCurrentMatches: "^$",
      allowWrite: true,
      json: true,
    } as never);
    expect(updateItemFields).toHaveBeenCalledTimes(1);
  });

  it("--max-mutations caps the number of items mutated", async () => {
    setup([
      { id: "a", fields: [{ name: "Status", value: "draft" }] },
      { id: "b", fields: [{ name: "Status", value: "draft" }] },
      { id: "c", fields: [{ name: "Status", value: "draft" }] },
    ]);
    const actions = await runCleanupFieldSet({
      field: "Status",
      value: "live",
      mode: "replace",
      maxMutations: 2,
      allowWrite: true,
      json: true,
    } as never);
    expect(actions.filter((a) => a.status === "applied")).toHaveLength(2);
  });

  it("rejects __-prefixed fields without --include-system-fields", async () => {
    setup([]);
    await expect(
      runCleanupFieldSet({
        field: "__Renderings",
        value: "x",
        mode: "replace",
        allowWrite: true,
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("cleanup rename", () => {
  it("renames items whose name matches the pattern", async () => {
    const { renameItem } = setup([
      { id: "a", name: "campaign-2024-old" },
      { id: "b", name: "evergreen-page" },
    ]);
    const actions = await runCleanupRename({
      pattern: "2024",
      replacement: "2025",
      literal: true,
      allowWrite: true,
      json: true,
    } as never);
    const applied = actions.filter((a) => a.status === "applied");
    expect(applied).toHaveLength(1);
    expect(applied[0].newName).toBe("campaign-2025-old");
    expect(renameItem).toHaveBeenCalledWith({
      itemId: expect.any(String),
      name: "campaign-2025-old",
    });
  });

  it("rejects new names with slashes (skipped-shape)", async () => {
    const { renameItem } = setup([{ id: "a", name: "page" }]);
    const actions = await runCleanupRename({
      pattern: "page",
      replacement: "folder/sub",
      literal: true,
      allowWrite: true,
      json: true,
    } as never);
    expect(actions[0].status).toBe("skipped-shape");
    expect(renameItem).not.toHaveBeenCalled();
  });

  it("--what-if reports plan without writing", async () => {
    const { renameItem } = setup([{ id: "a", name: "old-name" }]);
    const actions = await runCleanupRename({
      pattern: "old",
      replacement: "new",
      literal: true,
      whatIf: true,
      json: true,
    } as never);
    expect(actions[0].status).toBe("what-if");
    expect(renameItem).not.toHaveBeenCalled();
  });
});

describe("cleanup language-version-add", () => {
  it("creates one version per (item, language) pair", async () => {
    const { addItemVersion } = setup([
      { id: "a", name: "page-1" },
      { id: "b", name: "page-2" },
    ]);
    const actions = await runCleanupLanguageVersionAdd({
      languages: ["fr", "es"],
      allowWrite: true,
      json: true,
    } as never);
    expect(actions.filter((a) => a.status === "applied")).toHaveLength(4);
    expect(addItemVersion).toHaveBeenCalledTimes(4);
  });

  it("classifies 'already exists' errors as skipped-existing", async () => {
    const env = { name: "sandbox", host: "h", allowWrite: true } as EnvironmentConfiguration;
    vi.mocked(resolveEnvironment).mockReturnValue({
      envName: "sandbox",
      environment: env,
      root: { environments: { sandbox: env } } as unknown as RootConfiguration,
      timeoutMs: undefined,
    });
    const client = {
      search: vi.fn().mockResolvedValue({
        totalCount: 1,
        results: [{ itemId: "rootid", path: "/sitecore/content" }],
      }),
      searchAll: vi.fn().mockImplementation(async function* () {
        yield {
          itemId: "a",
          path: "/sitecore/content/a",
          name: "page",
          templateName: "Page",
          language: { name: "en" },
          version: 1,
        };
      }),
      getItemFieldsBatch: vi.fn().mockResolvedValue(new Map()),
      addItemVersion: vi.fn().mockRejectedValue(new Error("Version already exists")),
    } as unknown as HygieneApiClient;
    vi.mocked(createHygieneApiClient).mockReturnValue(client);

    const actions = await runCleanupLanguageVersionAdd({
      languages: ["fr"],
      allowWrite: true,
      json: true,
    } as never);
    expect(actions[0].status).toBe("skipped-existing");
  });

  it("respects --max-adds cap", async () => {
    setup([
      { id: "a", name: "p1" },
      { id: "b", name: "p2" },
      { id: "c", name: "p3" },
    ]);
    const actions = await runCleanupLanguageVersionAdd({
      languages: ["fr", "es"],
      maxAdds: 3,
      allowWrite: true,
      json: true,
    } as never);
    expect(actions.filter((a) => a.status === "applied")).toHaveLength(3);
  });

  it("requires at least one language", async () => {
    setup([]);
    await expect(
      runCleanupLanguageVersionAdd({
        languages: [],
        allowWrite: true,
        json: true,
      } as never)
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
