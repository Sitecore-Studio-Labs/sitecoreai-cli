/**
 * Branch coverage for `cleanup rename` — the bulk pattern-driven
 * item-renamer. Mirrors `cleanup-field-set.test.ts`:
 * `resolveEnvironment` + `createHygieneApiClient` are mocked,
 * the real `../shared` (scanItemsAndFields etc.) runs against a
 * stubbed client.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
import { runCleanupRename } from "../../../../src/hygiene/tasks/cleanup/rename";

vi.mock("../../../../src/policy/environment", () => ({
  resolveEnvironment: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../src/hygiene/api/client")>();
  return { ...actual, createHygieneApiClient: vi.fn() };
});

import { resolveEnvironment } from "../../../../src/policy/environment";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";

interface ItemSpec {
  id: string;
  name: string;
  path: string;
  templateName?: string;
}

const setup = (opts: {
  items: ItemSpec[];
  allowWrite?: boolean;
  renameImpl?: () => Promise<unknown>;
}) => {
  const env = {
    name: "sandbox",
    host: "h",
    allowWrite: opts.allowWrite ?? true,
  } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  const renameItem = vi
    .fn()
    .mockImplementation(opts.renameImpl ?? (() => Promise.resolve(undefined)));
  const client = {
    search: vi.fn().mockResolvedValue({
      totalCount: 1,
      results: [{ itemId: "rootid", path: "/sitecore/content" }],
    }),
    searchAll: vi.fn().mockImplementation(async function* () {
      for (const it of opts.items) {
        yield {
          itemId: it.id,
          path: it.path,
          name: it.name,
          templateName: it.templateName ?? "Default",
        };
      }
    }),
    getItemFieldsBatch: vi.fn().mockResolvedValue(new Map()),
    renameItem,
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return { client, renameItem };
};

describe("runCleanupRename — input validation", () => {
  it("throws when --pattern is missing", async () => {
    await expect(
      runCleanupRename({
        environmentName: "sandbox",
        pattern: "",
        replacement: "X",
      })
    ).rejects.toThrow(/--pattern is required/i);
  });

  it("throws when --replacement is undefined", async () => {
    await expect(
      runCleanupRename({
        environmentName: "sandbox",
        pattern: "old",
        replacement: undefined as unknown as string,
      })
    ).rejects.toThrow(/--replacement is required/i);
  });
});

describe("runCleanupRename — pattern compilation", () => {
  // --literal escapes regex metacharacters so `.` matches a literal
  // dot, not "any char".
  it("treats --literal pattern as escaped", async () => {
    const { renameItem } = setup({
      items: [
        { id: "i1", name: "page.draft", path: "/sitecore/content/page.draft" },
        { id: "i2", name: "pageXdraft", path: "/sitecore/content/pageXdraft" },
      ],
      allowWrite: true,
    });
    await runCleanupRename({
      environmentName: "sandbox",
      pattern: "page.draft",
      replacement: "page-final",
      literal: true,
      allowWrite: true,
    });
    // Only `page.draft` matches; `pageXdraft` would have matched a
    // non-literal regex but not a literal one.
    expect(renameItem).toHaveBeenCalledTimes(1);
    expect(renameItem.mock.calls[0][0].name).toBe("page-final");
  });

  it("--ignoreCase adds an i flag if not already in --flags", async () => {
    const { renameItem } = setup({
      items: [{ id: "i1", name: "PAGE1", path: "/sitecore/content/PAGE1" }],
      allowWrite: true,
    });
    await runCleanupRename({
      environmentName: "sandbox",
      pattern: "page",
      replacement: "Article",
      ignoreCase: true,
      allowWrite: true,
    });
    expect(renameItem).toHaveBeenCalledTimes(1);
    expect(renameItem.mock.calls[0][0].name).toBe("Article1");
  });

  it("--flags already including i is honoured (no double-i flag)", async () => {
    const { renameItem } = setup({
      items: [{ id: "i1", name: "PAGE1", path: "/sitecore/content/PAGE1" }],
      allowWrite: true,
    });
    await runCleanupRename({
      environmentName: "sandbox",
      pattern: "page",
      replacement: "Article",
      ignoreCase: true,
      flags: "iu",
      allowWrite: true,
    });
    expect(renameItem).toHaveBeenCalledTimes(1);
  });
});

describe("runCleanupRename — what-if + apply paths", () => {
  // --what-if logs the planned rename + does NOT call renameItem.
  it("--what-if returns 'what-if' status and does not call renameItem", async () => {
    const { renameItem } = setup({
      items: [{ id: "i1", name: "old1", path: "/sitecore/content/old1" }],
    });
    const actions = await runCleanupRename({
      environmentName: "sandbox",
      pattern: "old",
      replacement: "new",
      whatIf: true,
    });
    expect(actions.find((a) => a.itemId === "i1")?.status).toBe("what-if");
    expect(renameItem).not.toHaveBeenCalled();
  });

  it("apply mode writes the rename and returns status 'applied'", async () => {
    const { renameItem } = setup({
      items: [{ id: "i1", name: "old1", path: "/sitecore/content/old1" }],
      allowWrite: true,
    });
    const actions = await runCleanupRename({
      environmentName: "sandbox",
      pattern: "old",
      replacement: "new",
      allowWrite: true,
    });
    expect(actions.find((a) => a.itemId === "i1")?.status).toBe("applied");
    expect(renameItem).toHaveBeenCalledOnce();
  });

  // Empty new-name → skipped-shape (no name can be empty in Sitecore).
  it("skipped-shape when the new name is empty after replacement", async () => {
    const { renameItem } = setup({
      items: [{ id: "i1", name: "abc123", path: "/sitecore/content/abc123" }],
      allowWrite: true,
    });
    const actions = await runCleanupRename({
      environmentName: "sandbox",
      pattern: ".*", // matches the entire name
      replacement: "",
      allowWrite: true,
    });
    expect(actions.find((a) => a.itemId === "i1")?.status).toBe("skipped-shape");
    expect(renameItem).not.toHaveBeenCalled();
  });

  // Slash in new-name → skipped-shape (slashes break the path).
  it("skipped-shape when the new name contains a slash", async () => {
    const { renameItem } = setup({
      items: [{ id: "i1", name: "section.subsection", path: "/sitecore/content/x" }],
      allowWrite: true,
    });
    const actions = await runCleanupRename({
      environmentName: "sandbox",
      pattern: "\\.",
      replacement: "/",
      allowWrite: true,
    });
    expect(actions.find((a) => a.itemId === "i1")?.status).toBe("skipped-shape");
    expect(renameItem).not.toHaveBeenCalled();
  });

  // newName === oldName → skipped silently (no action emitted).
  it("skips silently when newName equals oldName (no diff)", async () => {
    const { renameItem } = setup({
      items: [{ id: "i1", name: "exact", path: "/sitecore/content/exact" }],
      allowWrite: true,
    });
    const actions = await runCleanupRename({
      environmentName: "sandbox",
      pattern: "X",
      replacement: "Y", // matches nothing
      allowWrite: true,
    });
    expect(actions).toHaveLength(0);
    expect(renameItem).not.toHaveBeenCalled();
  });

  // Failed rename → status: 'failed', error carries the message.
  it("captures the error message on a failed rename", async () => {
    setup({
      items: [{ id: "i1", name: "old1", path: "/sitecore/content/old1" }],
      allowWrite: true,
      renameImpl: () => Promise.reject(new Error("Authoring API rejected.")),
    });
    const actions = await runCleanupRename({
      environmentName: "sandbox",
      pattern: "old",
      replacement: "new",
      allowWrite: true,
    });
    expect(actions[0].status).toBe("failed");
    expect(actions[0].error).toContain("Authoring API rejected");
  });
});

describe("runCleanupRename — template filter + max-renames cap", () => {
  // --template-pattern filters out items whose templateName doesn't
  // match. The non-matching item still gets scanned but never planned.
  it("respects --template-pattern as an i-flagged regex filter", async () => {
    const { renameItem } = setup({
      items: [
        {
          id: "i1",
          name: "old1",
          path: "/sitecore/content/old1",
          templateName: "Article",
        },
        {
          id: "i2",
          name: "old2",
          path: "/sitecore/content/old2",
          templateName: "Banner",
        },
      ],
      allowWrite: true,
    });
    await runCleanupRename({
      environmentName: "sandbox",
      pattern: "old",
      replacement: "new",
      templatePattern: "article",
      allowWrite: true,
    });
    expect(renameItem).toHaveBeenCalledTimes(1);
    expect(renameItem.mock.calls[0][0].itemId).toContain("i1");
  });

  // --max-renames caps the active rename count. Items beyond the cap
  // are silently dropped from the plan with a warn log.
  it("caps the plan at --max-renames", async () => {
    const { renameItem } = setup({
      items: [
        { id: "i1", name: "old1", path: "/sitecore/content/old1" },
        { id: "i2", name: "old2", path: "/sitecore/content/old2" },
        { id: "i3", name: "old3", path: "/sitecore/content/old3" },
      ],
      allowWrite: true,
    });
    const actions = await runCleanupRename({
      environmentName: "sandbox",
      pattern: "old",
      replacement: "new",
      maxRenames: 2,
      allowWrite: true,
    });
    expect(actions).toHaveLength(2);
    expect(renameItem).toHaveBeenCalledTimes(2);
  });
});
