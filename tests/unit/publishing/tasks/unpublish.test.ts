/**
 * Coverage top-up for `src/publishing/tasks/unpublish.ts`.
 *
 * The pre-existing `tests/unit/publishing/unpublish.test.ts` exercises
 * the field-write strategies at the GraphQL layer. This file targets
 * the remaining gaps: the `delete` strategy end-to-end, the
 * prompt-abort branch, JSON output, and the not-implemented strategy
 * error — mocking the higher-level helper modules so those branches
 * can be reached deterministically.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/recipe/api/graphql", () => ({ runAuthoringGraphQL: vi.fn() }));
vi.mock("../../../../src/publishing/api/auth", () => ({
  acquirePublishingToken: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/client", () => ({
  submitPublishJob: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/path-resolver", () => ({
  resolveItemPathsToIds: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/sites", () => ({
  resolveSiteRoot: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/languages", () => ({
  resolvePublishingLocales: vi.fn(),
}));
vi.mock("../../../../src/shared/prompt", () => ({
  promptConfirm: vi.fn(),
  promptText: vi.fn(),
}));
vi.mock("../../../../src/hygiene/api/client", () => ({
  createHygieneApiClient: vi.fn(),
}));
vi.mock("../../../../src/content/api/version-fields", async () => {
  const actual = await vi.importActual<typeof import("../../../../src/content/api/version-fields")>(
    "../../../../src/content/api/version-fields"
  );
  return { ...actual, readVersionFields: vi.fn(), writeVersionFields: vi.fn() };
});

import { runPublishUnpublish } from "../../../../src/publishing/tasks/unpublish";
import { resolveEnvironment } from "../../../../src/policy/environment";
import { runAuthoringGraphQL } from "../../../../src/recipe/api/graphql";
import { acquirePublishingToken } from "../../../../src/publishing/api/auth";
import { submitPublishJob } from "../../../../src/publishing/api/client";
import { resolvePublishingLocales } from "../../../../src/publishing/api/languages";
import { promptConfirm, promptText } from "../../../../src/shared/prompt";
import { createHygieneApiClient } from "../../../../src/hygiene/api/client";
import { readVersionFields, writeVersionFields } from "../../../../src/content/api/version-fields";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-publish-unp-tasks-"));
const auditPath = path.join(tmpRoot, "audit.log");

let stdout: ReturnType<typeof vi.spyOn>;

const setupEnv = (production = false): EnvironmentConfiguration => {
  const env = {
    name: "sandbox",
    host: "h",
    tenantId: "tenant-x",
    production,
  } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: env.name as string,
    environment: env,
    root: { environments: { [env.name as string]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

const auditLines = (): unknown[] =>
  fs.existsSync(auditPath)
    ? fs
        .readFileSync(auditPath, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

/** Snapshot returned by readVersionFields for the field-write strategies. */
const snapshot = (): unknown => ({
  itemId: "id-1",
  language: "en",
  version: 1,
  fields: [{ name: "__Never publish", value: "" }],
});

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  process.env.SITECOREAI_AUDIT_LOG = auditPath;
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
  vi.mocked(acquirePublishingToken).mockResolvedValue("test-token");
  vi.mocked(resolvePublishingLocales).mockResolvedValue(["en"]);
  vi.mocked(promptConfirm).mockResolvedValue(true);
  vi.mocked(readVersionFields).mockResolvedValue(snapshot() as never);
  vi.mocked(writeVersionFields).mockResolvedValue(undefined as never);
});

afterEach(() => {
  stdout.mockRestore();
  delete process.env.SITECOREAI_AUDIT_LOG;
});

describe("runPublishUnpublish — prompt-abort branch", () => {
  it("aborts without writing fields or submitting when the operator declines", async () => {
    setupEnv();
    vi.mocked(promptConfirm).mockResolvedValue(false);

    await runPublishUnpublish({
      quiet: true,
      itemIds: ["id-1"],
      languages: ["en"],
      allowWrite: true,
    });

    expect(vi.mocked(promptConfirm)).toHaveBeenCalled();
    expect(vi.mocked(writeVersionFields)).not.toHaveBeenCalled();
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
    expect(auditLines()).toHaveLength(0);
  });
});

describe("runPublishUnpublish — JSON output", () => {
  it("prints the job JSON in --json mode for the never-publish strategy", async () => {
    setupEnv();
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-json",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      json: true,
      itemIds: ["id-1"],
      languages: ["en"],
      allowWrite: true,
      yes: true,
    });

    const last = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null")) as { id: string };
    expect(last.id).toBe("job-json");
    expect(vi.mocked(writeVersionFields)).toHaveBeenCalledOnce();
  });
});

describe("runPublishUnpublish — unimplemented strategy", () => {
  it("throws INPUT_INVALID when an unsupported strategy reaches applyStrategy", async () => {
    setupEnv();

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
        yes: true,
        strategy: "bogus-strategy" as never,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });
});

describe("runPublishUnpublish — delete strategy", () => {
  const installDeleteClient = (): { deleteItem: ReturnType<typeof vi.fn> } => {
    const deleteItem = vi.fn().mockResolvedValue(undefined);
    vi.mocked(createHygieneApiClient).mockReturnValue({ deleteItem } as never);
    return { deleteItem };
  };

  it("deletes the item then submits a publish job on the interactive path", async () => {
    setupEnv();
    const { deleteItem } = installDeleteClient();
    // lookupItemPath probe.
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);
    // Operator types the resolved path back.
    vi.mocked(promptText).mockResolvedValue("/sitecore/content/Home");
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-del",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      quiet: true,
      itemIds: ["id-1"],
      strategy: "delete",
      allowWrite: true,
      yes: false,
    });

    expect(vi.mocked(promptText)).toHaveBeenCalled();
    expect(deleteItem).toHaveBeenCalledWith({ itemId: "id-1", permanently: true });
    expect(vi.mocked(submitPublishJob)).toHaveBeenCalledOnce();
    // One audit entry per delete + one for the publish-job submit.
    const lines = auditLines() as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ command: "publish unpublish", risk: "high", outcome: "ok" });
    expect(lines[1]).toMatchObject({ jobId: "job-del", outcome: "ok" });
  });

  it("deletes via the --yes path when --confirm-item-path matches", async () => {
    setupEnv();
    const { deleteItem } = installDeleteClient();
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-del2",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      quiet: true,
      itemIds: ["id-1"],
      strategy: "delete",
      allowWrite: true,
      yes: true,
      confirmItemPath: "/sitecore/content/Home",
    });

    expect(vi.mocked(promptText)).not.toHaveBeenCalled();
    expect(deleteItem).toHaveBeenCalledWith({ itemId: "id-1", permanently: true });
    expect(vi.mocked(submitPublishJob)).toHaveBeenCalledOnce();
  });

  it("throws INPUT_INVALID when the item path can't be resolved", async () => {
    setupEnv();
    installDeleteClient();
    // lookupItemPath returns no item.
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({ item: null } as never);

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-missing"],
        strategy: "delete",
        allowWrite: true,
        yes: true,
        confirmItemPath: "/whatever",
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when the typed confirmation path doesn't match", async () => {
    setupEnv();
    installDeleteClient();
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);
    vi.mocked(promptText).mockResolvedValue("/sitecore/content/WRONG");

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        strategy: "delete",
        allowWrite: true,
        yes: false,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("records a high-risk error audit entry when deleteItem throws", async () => {
    setupEnv();
    const deleteItem = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("delete refused"), { code: "NETWORK" }));
    vi.mocked(createHygieneApiClient).mockReturnValue({ deleteItem } as never);
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        strategy: "delete",
        allowWrite: true,
        yes: true,
        confirmItemPath: "/sitecore/content/Home",
      })
    ).rejects.toThrow("delete refused");

    const lines = auditLines() as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      command: "publish unpublish",
      risk: "high",
      outcome: "error",
      errorCode: "NETWORK",
    });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("prints the publish-job JSON in --json mode for the delete strategy", async () => {
    setupEnv();
    installDeleteClient();
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-del-json",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      json: true,
      itemIds: ["id-1"],
      strategy: "delete",
      allowWrite: true,
      yes: true,
      confirmItemPath: "/sitecore/content/Home",
    });

    const last = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null")) as { id: string };
    expect(last.id).toBe("job-del-json");
  });

  it("throws INPUT_INVALID when --confirm-item-path doesn't match the resolved path", async () => {
    setupEnv();
    installDeleteClient();
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        strategy: "delete",
        allowWrite: true,
        yes: true,
        // Mismatched path → the --yes fast-path refuses.
        confirmItemPath: "/sitecore/content/WRONG",
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID for delete in non-interactive mode without --yes", async () => {
    setupEnv();
    installDeleteClient();
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        strategy: "delete",
        allowWrite: true,
        nonInteractive: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("records an error audit entry when the delete publish-job submission fails", async () => {
    setupEnv();
    installDeleteClient();
    vi.mocked(runAuthoringGraphQL).mockResolvedValue({
      item: { itemId: "id-1", path: "/sitecore/content/Home" },
    } as never);
    vi.mocked(submitPublishJob).mockRejectedValue(new Error("submit failed"));

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        strategy: "delete",
        allowWrite: true,
        yes: true,
        confirmItemPath: "/sitecore/content/Home",
      })
    ).rejects.toThrow("submit failed");

    const lines = auditLines() as Array<Record<string, unknown>>;
    // One ok entry for the delete + one error entry for the submit.
    expect(lines.at(-1)).toMatchObject({
      command: "publish unpublish",
      outcome: "error",
      errorCode: "UNKNOWN",
    });
  });
});

// ---------------------------------------------------------------------------
// Branch coverage — input resolution, dry-run / production-tier gates,
// and the field-write strategies.
// ---------------------------------------------------------------------------

describe("runPublishUnpublish — input resolution", () => {
  it("throws INPUT_INVALID when no --items, --paths, or --site is supplied", async () => {
    setupEnv();

    await expect(runPublishUnpublish({ quiet: true, allowWrite: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("resolves --paths to item IDs and includes them in the publish job", async () => {
    setupEnv();
    const { resolveItemPathsToIds } = await import("../../../../src/publishing/api/path-resolver");
    vi.mocked(resolveItemPathsToIds).mockResolvedValue({
      resolved: [{ path: "/sitecore/content/Home/About", itemId: "about-id" }],
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-paths",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      quiet: true,
      paths: ["/sitecore/content/Home/About"],
      allowWrite: true,
      yes: true,
    });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.items).toEqual([{ id: "about-id", type: "item" }]);
  });

  it("resolves --site to its content-tree root and honors --include-subitems", async () => {
    setupEnv();
    const { resolveSiteRoot } = await import("../../../../src/publishing/api/sites");
    vi.mocked(resolveSiteRoot).mockResolvedValue({
      siteName: "marketing",
      path: "/sitecore/content/Marketing/Home",
      itemId: "site-root-id",
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-site",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      quiet: true,
      site: "marketing",
      includeSubitems: true,
      allowWrite: true,
      yes: true,
    });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.items).toEqual([{ id: "site-root-id", type: "item" }]);
    expect(request.options.xmc?.items?.publishChildren).toBe(true);
  });
});

describe("runPublishUnpublish — dry-run and production-tier gates", () => {
  it("mints a scope token in dry-run mode and submits no job", async () => {
    setupEnv();

    await runPublishUnpublish({ quiet: true, itemIds: ["id-1"], languages: ["en"] });

    const written = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toMatch(/pub_/);
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
    expect(vi.mocked(writeVersionFields)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when a production-tier env real call has no --confirm-token", async () => {
    setupEnv(true); // production-tier

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID when a production-tier env confirm-token is rejected", async () => {
    setupEnv(true);

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
        confirmToken: "not-a-real-token",
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID in non-interactive non-prod mode without --yes", async () => {
    setupEnv();

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
        nonInteractive: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});

describe("runPublishUnpublish — expire-now strategy", () => {
  it("writes the __Valid to field and submits a publish job", async () => {
    setupEnv();
    vi.mocked(readVersionFields).mockResolvedValue({
      itemId: "id-1",
      language: "en",
      version: 1,
      fields: [{ name: "__Valid to", value: "" }],
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-expire",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      quiet: true,
      itemIds: ["id-1"],
      languages: ["en"],
      strategy: "expire-now",
      allowWrite: true,
      yes: true,
    });

    expect(vi.mocked(writeVersionFields)).toHaveBeenCalledOnce();
    const writeCall = vi.mocked(writeVersionFields).mock.calls[0][1];
    expect(writeCall.fields[0].name).toBe("__Valid to");
    expect(vi.mocked(submitPublishJob)).toHaveBeenCalledOnce();
  });
});

describe("runPublishUnpublish — field-write and submit error paths", () => {
  it("records an error audit entry and rethrows when a field write fails", async () => {
    setupEnv();
    vi.mocked(writeVersionFields).mockRejectedValue(
      Object.assign(new Error("write rejected"), { code: "NETWORK" })
    );

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
        yes: true,
      })
    ).rejects.toThrow("write rejected");

    const lines = auditLines() as Array<Record<string, unknown>>;
    expect(lines.at(-1)).toMatchObject({
      command: "publish unpublish",
      outcome: "error",
      errorCode: "NETWORK",
    });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("records an error audit entry and rethrows when the publish-job submit fails", async () => {
    setupEnv();
    vi.mocked(submitPublishJob).mockRejectedValue(new Error("publish boom"));

    await expect(
      runPublishUnpublish({
        quiet: true,
        itemIds: ["id-1"],
        languages: ["en"],
        allowWrite: true,
        yes: true,
      })
    ).rejects.toThrow("publish boom");

    const lines = auditLines() as Array<Record<string, unknown>>;
    expect(lines.at(-1)).toMatchObject({
      command: "publish unpublish",
      outcome: "error",
      errorCode: "UNKNOWN",
    });
  });

  it("falls back to writeLanguages ['en'] when no languages resolve", async () => {
    setupEnv();
    // resolvePublishingLocales returns [] → writeLanguages falls back to ["en"].
    vi.mocked(resolvePublishingLocales).mockResolvedValue([]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-default-lang",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishUnpublish({
      quiet: true,
      itemIds: ["id-1"],
      allowWrite: true,
      yes: true,
    });

    // One write per (item, language) — the "en" fallback yields exactly one.
    expect(vi.mocked(writeVersionFields)).toHaveBeenCalledOnce();
    expect(vi.mocked(writeVersionFields).mock.calls[0][1].language).toBe("en");
    // locales omitted from the request body when no languages resolved.
    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.xmc?.locales).toBeUndefined();
  });
});
