import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/publishing/api/auth", () => ({
  acquirePublishingToken: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/client", () => ({
  submitPublishJob: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/languages", () => ({
  resolvePublishingLocales: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/path-resolver", () => ({
  resolveItemPathsToIds: vi.fn(),
}));
vi.mock("../../../../src/publishing/api/sites", () => ({
  resolveSiteRoot: vi.fn(),
}));
vi.mock("../../../../src/shared/prompt", () => ({
  promptConfirm: vi.fn(),
}));

import { runPublishItem } from "../../../../src/publishing/tasks/item";
import { resolveEnvironment } from "../../../../src/policy/environment";
import { acquirePublishingToken } from "../../../../src/publishing/api/auth";
import { submitPublishJob } from "../../../../src/publishing/api/client";
import { resolvePublishingLocales } from "../../../../src/publishing/api/languages";
import { resolveItemPathsToIds } from "../../../../src/publishing/api/path-resolver";
import { resolveSiteRoot } from "../../../../src/publishing/api/sites";
import { promptConfirm } from "../../../../src/shared/prompt";
import { mintScopeToken } from "../../../../src/shared/publish-consent";
import type { PublishAuditScope } from "../../../../src/shared/publish-audit";

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-publish-item-"));
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

/** Mint a valid confirm-token for an item-scoped publish. */
const itemScopeToken = (itemIds: string[], languages: string[]): string => {
  const scope: PublishAuditScope = {
    envName: "sandbox",
    resolvedTenantId: "tenant-x",
    target: "Edge",
    kind: "item",
    itemIds,
    languages,
  };
  return mintScopeToken(scope);
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

beforeEach(() => {
  vi.clearAllMocks();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
  process.env.SITECOREAI_AUDIT_LOG = auditPath;
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
  vi.mocked(acquirePublishingToken).mockResolvedValue("test-token");
  vi.mocked(resolvePublishingLocales).mockResolvedValue([]);
  vi.mocked(resolveItemPathsToIds).mockResolvedValue({ resolved: [] } as never);
  vi.mocked(promptConfirm).mockResolvedValue(true);
});

afterEach(() => {
  stdout.mockRestore();
  delete process.env.SITECOREAI_AUDIT_LOG;
});

describe("runPublishItem — input validation", () => {
  it("throws INPUT_INVALID when no --items, --paths, or --site is given", async () => {
    setupEnv();

    await expect(runPublishItem({ quiet: true })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });
});

describe("runPublishItem — dry-run (what-if) path", () => {
  it("mints a scope token and never submits when --allow-write is absent", async () => {
    setupEnv();

    await runPublishItem({ quiet: true, itemIds: ["id-1"] });

    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
    const written = stdout.mock.calls.map((c) => String(c[0])).join("");
    expect(written).toMatch(/pub_/);
    expect(auditLines()).toHaveLength(0);
  });

  it("treats --allow-write --what-if as a dry-run", async () => {
    setupEnv();

    await runPublishItem({ quiet: true, itemIds: ["id-1"], allowWrite: true, whatIf: true });

    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });
});

describe("runPublishItem — target resolution", () => {
  it("resolves --paths to itemIds via the path resolver", async () => {
    setupEnv();
    vi.mocked(resolveItemPathsToIds).mockResolvedValue({
      resolved: [{ path: "/sitecore/content/Home", itemId: "id-home" }],
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-1",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({
      quiet: true,
      paths: ["/sitecore/content/Home"],
      allowWrite: true,
      yes: true,
    });

    expect(vi.mocked(resolveItemPathsToIds)).toHaveBeenCalledWith(expect.anything(), [
      "/sitecore/content/Home",
    ]);
    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.items).toEqual([{ id: "id-home", type: "item" }]);
  });

  it("resolves --site to its content-tree root item", async () => {
    setupEnv();
    vi.mocked(resolveSiteRoot).mockResolvedValue({
      siteName: "marketing",
      tenantName: "t",
      path: "/sitecore/content/t/marketing",
      itemId: "id-site-root",
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-2",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({ quiet: true, site: "marketing", allowWrite: true, yes: true });

    expect(vi.mocked(resolveSiteRoot)).toHaveBeenCalledWith(expect.anything(), "marketing");
    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.items).toEqual([{ id: "id-site-root", type: "item" }]);
  });

  it("unions direct --items with resolved paths and site root", async () => {
    setupEnv();
    vi.mocked(resolveItemPathsToIds).mockResolvedValue({
      resolved: [{ path: "/p", itemId: "id-path" }],
    } as never);
    vi.mocked(resolveSiteRoot).mockResolvedValue({
      siteName: "s",
      tenantName: "t",
      path: "/s",
      itemId: "id-site",
    } as never);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-3",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({
      quiet: true,
      itemIds: ["id-direct"],
      paths: ["/p"],
      site: "s",
      allowWrite: true,
      yes: true,
    });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.items).toEqual([
      { id: "id-direct", type: "item" },
      { id: "id-path", type: "item" },
      { id: "id-site", type: "item" },
    ]);
  });
});

describe("runPublishItem — production-tier gate", () => {
  it("throws INPUT_INVALID on a prod-tier env without --confirm-token", async () => {
    setupEnv(true);

    await expect(
      runPublishItem({ quiet: true, itemIds: ["id-1"], allowWrite: true })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("throws INPUT_INVALID on a prod-tier env when the confirm-token is rejected", async () => {
    setupEnv(true);

    await expect(
      runPublishItem({
        quiet: true,
        itemIds: ["id-1"],
        allowWrite: true,
        confirmToken: "garbage-token",
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("proceeds on a prod-tier env with a matching confirm-token", async () => {
    setupEnv(true);
    const token = itemScopeToken(["id-1"], []);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-prod",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({
      quiet: true,
      itemIds: ["id-1"],
      allowWrite: true,
      confirmToken: token,
    });

    expect(vi.mocked(submitPublishJob)).toHaveBeenCalledOnce();
  });
});

describe("runPublishItem — non-prod confirmation gate", () => {
  it("throws INPUT_INVALID in non-interactive mode without --yes", async () => {
    setupEnv();

    await expect(
      runPublishItem({
        quiet: true,
        itemIds: ["id-1"],
        allowWrite: true,
        nonInteractive: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
  });

  it("aborts without submitting when the operator declines the prompt", async () => {
    setupEnv();
    vi.mocked(promptConfirm).mockResolvedValue(false);

    await runPublishItem({ quiet: true, itemIds: ["id-1"], allowWrite: true });

    expect(vi.mocked(promptConfirm)).toHaveBeenCalled();
    expect(vi.mocked(submitPublishJob)).not.toHaveBeenCalled();
    expect(auditLines()).toHaveLength(0);
  });

  it("submits after the operator confirms the prompt", async () => {
    setupEnv();
    vi.mocked(promptConfirm).mockResolvedValue(true);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-confirmed",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({ quiet: true, itemIds: ["id-1"], allowWrite: true });

    expect(vi.mocked(submitPublishJob)).toHaveBeenCalledOnce();
  });
});

describe("runPublishItem — apply path", () => {
  it("builds the items request with Smart mode and subitem/related flags", async () => {
    setupEnv();
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-9",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({
      quiet: true,
      itemIds: ["id-1", "id-2"],
      allowWrite: true,
      yes: true,
      includeSubitems: true,
      includeRelated: true,
    });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.items).toEqual([
      { id: "id-1", type: "item" },
      { id: "id-2", type: "item" },
    ]);
    expect(request.options.xmc?.items).toMatchObject({
      mode: "Smart",
      publishChildren: true,
      publishRelatedItems: true,
    });
  });

  it("honors an explicit --mode Republish", async () => {
    setupEnv();
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-rp",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({
      quiet: true,
      itemIds: ["id-1"],
      allowWrite: true,
      yes: true,
      mode: "Republish",
    });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.xmc?.items?.mode).toBe("Republish");
  });

  it("passes resolved locales through to xmc.locales", async () => {
    setupEnv();
    vi.mocked(resolvePublishingLocales).mockResolvedValue(["en-US", "de-DE"]);
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-loc",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({ quiet: true, itemIds: ["id-1"], allowWrite: true, yes: true });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.xmc?.locales).toEqual(["en-US", "de-DE"]);
  });

  it("uses a custom --itemType when provided", async () => {
    setupEnv();
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-ct",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({
      quiet: true,
      itemIds: ["id-1"],
      allowWrite: true,
      yes: true,
      itemType: "ContentItem",
    });

    const request = vi.mocked(submitPublishJob).mock.calls[0][1];
    expect(request.options.items).toEqual([{ id: "id-1", type: "ContentItem" }]);
  });

  it("records an ok audit entry on success", async () => {
    setupEnv();
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-ok",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({ quiet: true, itemIds: ["id-1"], allowWrite: true, yes: true });

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      command: "publish item",
      outcome: "ok",
      jobId: "job-ok",
      risk: "normal",
    });
  });

  it("prints the job JSON in --json mode", async () => {
    setupEnv();
    vi.mocked(submitPublishJob).mockResolvedValue({
      id: "job-json",
      state: "queued",
      canCancel: true,
      raw: {},
    } as never);

    await runPublishItem({ json: true, itemIds: ["id-1"], allowWrite: true, yes: true });

    const last = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null")) as { id: string };
    expect(last.id).toBe("job-json");
  });

  it("records an error audit entry and rethrows when submit fails", async () => {
    setupEnv();
    const err = Object.assign(new Error("submit blew up"), { code: "NETWORK" });
    vi.mocked(submitPublishJob).mockRejectedValue(err);

    await expect(
      runPublishItem({ quiet: true, itemIds: ["id-1"], allowWrite: true, yes: true })
    ).rejects.toThrow("submit blew up");

    const lines = auditLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      command: "publish item",
      outcome: "error",
      errorCode: "NETWORK",
      errorMessage: "submit blew up",
    });
  });
});
