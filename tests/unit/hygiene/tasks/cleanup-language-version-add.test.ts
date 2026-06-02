/**
 * Branch coverage for `cleanup language-version-add` — bulk addition of
 * language versions to items. Same mock shape as cleanup-rename.test.ts.
 */
import { describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";
import type { HygieneApiClient } from "../../../../src/hygiene/api/client";
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

interface ItemSpec {
  id: string;
  name: string;
  path: string;
  templateName?: string;
}

const setup = (opts: {
  items: ItemSpec[];
  allowWrite?: boolean;
  addImpl?: () => Promise<{ versionNumber: number }>;
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
  const addItemVersion = vi
    .fn()
    .mockImplementation(opts.addImpl ?? (() => Promise.resolve({ versionNumber: 1 })));
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
    addItemVersion,
  } as unknown as HygieneApiClient;
  vi.mocked(createHygieneApiClient).mockReturnValue(client);
  return { client, addItemVersion };
};

describe("runCleanupLanguageVersionAdd — input validation", () => {
  it("throws when --languages is empty", async () => {
    await expect(
      runCleanupLanguageVersionAdd({
        environmentName: "sandbox",
        languages: [],
      })
    ).rejects.toThrow(/languages.*required/i);
  });

  it("throws when --languages is undefined", async () => {
    await expect(
      runCleanupLanguageVersionAdd({
        environmentName: "sandbox",
        languages: undefined as unknown as string[],
      })
    ).rejects.toThrow(/languages.*required/i);
  });
});

describe("runCleanupLanguageVersionAdd — apply paths", () => {
  it("applies one addItemVersion call per (item, language) pair", async () => {
    const { addItemVersion } = setup({
      items: [
        { id: "i1", name: "a", path: "/sitecore/content/a" },
        { id: "i2", name: "b", path: "/sitecore/content/b" },
      ],
      allowWrite: true,
    });
    const actions = await runCleanupLanguageVersionAdd({
      environmentName: "sandbox",
      languages: ["fr", "es"],
      allowWrite: true,
    });
    expect(addItemVersion).toHaveBeenCalledTimes(4);
    expect(actions.every((a) => a.status === "applied")).toBe(true);
  });

  it("--what-if skips the write and returns 'what-if' status with versionNumber: null", async () => {
    const { addItemVersion } = setup({
      items: [{ id: "i1", name: "a", path: "/sitecore/content/a" }],
    });
    const actions = await runCleanupLanguageVersionAdd({
      environmentName: "sandbox",
      languages: ["fr"],
      whatIf: true,
    });
    expect(actions[0].status).toBe("what-if");
    expect(actions[0].versionNumber).toBeNull();
    expect(addItemVersion).not.toHaveBeenCalled();
  });

  // --fromLanguage seeds the new version from the source language's
  // latest version. Verified by passing baseVersion: 1 to the Authoring API.
  it("passes baseVersion when --fromLanguage is set", async () => {
    const { addItemVersion } = setup({
      items: [{ id: "i1", name: "a", path: "/sitecore/content/a" }],
      allowWrite: true,
    });
    await runCleanupLanguageVersionAdd({
      environmentName: "sandbox",
      languages: ["fr"],
      fromLanguage: "en",
      allowWrite: true,
    });
    expect(addItemVersion.mock.calls[0][0].baseVersion).toBe(1);
  });

  // The Authoring API typically returns an error containing "already exist"
  // when a version is already present — surface as `skipped-existing`.
  it("classifies 'already exists' errors as skipped-existing (not failed)", async () => {
    const { addItemVersion } = setup({
      items: [{ id: "i1", name: "a", path: "/sitecore/content/a" }],
      allowWrite: true,
      addImpl: () => Promise.reject(new Error("Version already exists for language fr.")),
    });
    const actions = await runCleanupLanguageVersionAdd({
      environmentName: "sandbox",
      languages: ["fr"],
      allowWrite: true,
    });
    expect(actions[0].status).toBe("skipped-existing");
    expect(actions[0].error).toBeUndefined();
    expect(addItemVersion).toHaveBeenCalledOnce();
  });

  // Any other error surfaces as failed with the message attached.
  it("captures the error message on a generic add failure", async () => {
    setup({
      items: [{ id: "i1", name: "a", path: "/sitecore/content/a" }],
      allowWrite: true,
      addImpl: () => Promise.reject(new Error("Network down.")),
    });
    const actions = await runCleanupLanguageVersionAdd({
      environmentName: "sandbox",
      languages: ["fr"],
      allowWrite: true,
    });
    expect(actions[0].status).toBe("failed");
    expect(actions[0].error).toBe("Network down.");
  });
});

describe("runCleanupLanguageVersionAdd — template filter + max-adds cap", () => {
  it("respects --template-pattern as an i-flagged regex filter", async () => {
    const { addItemVersion } = setup({
      items: [
        {
          id: "i1",
          name: "a",
          path: "/sitecore/content/a",
          templateName: "Article",
        },
        {
          id: "i2",
          name: "b",
          path: "/sitecore/content/b",
          templateName: "Banner",
        },
      ],
      allowWrite: true,
    });
    await runCleanupLanguageVersionAdd({
      environmentName: "sandbox",
      languages: ["fr"],
      templatePattern: "article",
      allowWrite: true,
    });
    expect(addItemVersion).toHaveBeenCalledTimes(1);
    expect(addItemVersion.mock.calls[0][0].itemId).toContain("i1");
  });

  it("caps at --max-adds across (item, language) pairs", async () => {
    const { addItemVersion } = setup({
      items: [
        { id: "i1", name: "a", path: "/sitecore/content/a" },
        { id: "i2", name: "b", path: "/sitecore/content/b" },
        { id: "i3", name: "c", path: "/sitecore/content/c" },
      ],
      allowWrite: true,
    });
    const actions = await runCleanupLanguageVersionAdd({
      environmentName: "sandbox",
      languages: ["fr", "es"],
      maxAdds: 3,
      allowWrite: true,
    });
    expect(actions).toHaveLength(3);
    expect(addItemVersion).toHaveBeenCalledTimes(3);
  });
});
