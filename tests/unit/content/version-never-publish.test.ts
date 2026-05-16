import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../src/config/types";

vi.mock("../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../src/recipe/api/graphql", () => ({ runAuthoringGraphQL: vi.fn() }));
vi.mock("../../../src/shared/prompt", () => ({
  promptConfirm: vi.fn().mockResolvedValue(true),
  promptText: vi.fn(),
}));

import { runContentVersionSetNeverPublish } from "../../../src/content/tasks/version-never-publish";
import { resolveEnvironment } from "../../../src/shared/env";
import { runAuthoringGraphQL } from "../../../src/recipe/api/graphql";

const mockRun = runAuthoringGraphQL as unknown as ReturnType<typeof vi.fn>;
const mockResolveEnv = resolveEnvironment as unknown as ReturnType<typeof vi.fn>;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-content-np-"));
const auditPath = path.join(tmpRoot, "audit.log");

const setupEnv = (production = false): EnvironmentConfiguration => {
  const env = {
    name: "sandbox",
    host: "h",
    tenantId: "tenant-x",
    production,
  } as EnvironmentConfiguration;
  mockResolveEnv.mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

const readResponseFor = (currentNeverPublish: string | undefined) => ({
  item: {
    itemId: "id-1",
    name: "Home",
    path: "/sitecore/content/Home",
    version: {
      version: 1,
      language: { name: "en" },
      fields: {
        nodes:
          currentNeverPublish === undefined
            ? []
            : [{ name: "__Never publish", value: currentNeverPublish }],
      },
    },
  },
});

beforeEach(() => {
  mockRun.mockReset();
  mockResolveEnv.mockReset();
  process.env.SITECOREAI_AUDIT_LOG = auditPath;
  if (fs.existsSync(auditPath)) fs.unlinkSync(auditPath);
});

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.SITECOREAI_AUDIT_LOG;
});

describe("runContentVersionSetNeverPublish", () => {
  it("requires --language", async () => {
    setupEnv();
    await expect(
      runContentVersionSetNeverPublish({
        itemId: "id-1",
        language: "",
        value: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("requires --item-id or --path (not both)", async () => {
    setupEnv();
    mockRun.mockResolvedValue(readResponseFor("0"));
    await expect(
      runContentVersionSetNeverPublish({
        itemId: "id-1",
        path: "/p",
        language: "en",
        value: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("dry-run prints scope token and does NOT write", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    await runContentVersionSetNeverPublish({
      itemId: "id-1",
      language: "en",
      value: true,
      // whatIf default
    });
    // Only the read query was issued.
    expect(mockRun).toHaveBeenCalledOnce();
    // No audit on a dry-run.
    expect(fs.existsSync(auditPath)).toBe(false);
  });

  it("real call writes the field and records an audit entry with before/after", async () => {
    setupEnv();
    // Read: never-publish currently false (empty string).
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    // Write: success.
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });

    await runContentVersionSetNeverPublish({
      itemId: "id-1",
      language: "en",
      value: true,
      allowWrite: true,
      yes: true,
    });

    expect(mockRun).toHaveBeenCalledTimes(2);
    const writeCall = mockRun.mock.calls[1];
    expect(writeCall[1]).toContain("updateItem");
    expect(writeCall[2]).toMatchObject({
      itemId: "id-1",
      language: "en",
      version: 1,
      fields: [{ name: "__Never publish", value: "1" }],
    });

    expect(fs.existsSync(auditPath)).toBe(true);
    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.command).toBe("content version set-never-publish");
    expect(entry.outcome).toBe("ok");
    expect(entry.fieldChanges).toEqual([{ name: "__Never publish", before: "", after: "1" }]);
    expect(entry.scope.kind).toBe("never-publish");
    expect(entry.scope.version).toBe(1);
  });

  it("production-tier without --confirm-token errors out before any write", async () => {
    setupEnv(true);
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    await expect(
      runContentVersionSetNeverPublish({
        itemId: "id-1",
        language: "en",
        value: true,
        allowWrite: true,
      })
    ).rejects.toMatchObject({
      code: "INPUT_INVALID",
      message: expect.stringContaining("--confirm-token"),
    });
    // Only the snapshot read happened.
    expect(mockRun).toHaveBeenCalledOnce();
  });

  it("captures `before: null` when the field was absent on the version", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponseFor(undefined));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });

    await runContentVersionSetNeverPublish({
      itemId: "id-1",
      language: "en",
      value: true,
      allowWrite: true,
      yes: true,
    });
    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.fieldChanges[0].before).toBeNull();
    expect(entry.fieldChanges[0].after).toBe("1");
  });

  it("aborts when prompt-confirm returns false (non-prod, no --yes)", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    const { promptConfirm } = await import("../../../src/shared/prompt");
    (promptConfirm as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);

    await runContentVersionSetNeverPublish({
      itemId: "id-1",
      language: "en",
      value: true,
      allowWrite: true,
    });
    // Only the read call ran — no write, no audit.
    expect(mockRun).toHaveBeenCalledOnce();
    expect(fs.existsSync(auditPath)).toBe(false);
  });

  it("non-interactive without --yes refuses to proceed", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    await expect(
      runContentVersionSetNeverPublish({
        itemId: "id-1",
        language: "en",
        value: true,
        allowWrite: true,
        nonInteractive: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("production-tier with valid --confirm-token proceeds with the write", async () => {
    setupEnv(true);
    // We need to mint a real scope token. The simplest path is to
    // exercise the dry-run and capture the token from stdout. But the
    // test framework already captures process.stdout; easier to mint
    // it directly via the consent helper.
    const { mintScopeToken } = await import("../../../src/publishing/consent");
    const token = mintScopeToken({
      envName: "sandbox",
      resolvedTenantId: "tenant-x",
      target: "AuthoringCM",
      kind: "never-publish",
      itemIds: ["id-1"],
      path: "/sitecore/content/Home",
      languages: ["en"],
      version: 1,
    });

    mockRun.mockResolvedValueOnce(readResponseFor(""));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    await runContentVersionSetNeverPublish({
      itemId: "id-1",
      language: "en",
      value: true,
      allowWrite: true,
      confirmToken: token,
    });
    expect(mockRun).toHaveBeenCalledTimes(2);
    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.outcome).toBe("ok");
    expect(entry.scopeToken).toBe(token);
  });

  it("production-tier with stale --confirm-token (scope drift) rejects", async () => {
    setupEnv(true);
    const { mintScopeToken } = await import("../../../src/publishing/consent");
    // Mint a token for a different item — scope hash will mismatch.
    const wrongToken = mintScopeToken({
      envName: "sandbox",
      resolvedTenantId: "tenant-x",
      target: "AuthoringCM",
      kind: "never-publish",
      itemIds: ["DIFFERENT-ID"],
      path: "/x",
      languages: ["en"],
      version: 1,
    });
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    await expect(
      runContentVersionSetNeverPublish({
        itemId: "id-1",
        language: "en",
        value: true,
        allowWrite: true,
        confirmToken: wrongToken,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("emits JSON when --json is set", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runContentVersionSetNeverPublish({
        itemId: "id-1",
        language: "en",
        value: true,
        allowWrite: true,
        yes: true,
        json: true,
      });
      const printed = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      const parsed = JSON.parse(printed.trim());
      expect(parsed.field).toBe("__Never publish");
      expect(parsed.after).toBe("1");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("records an error audit entry when the write fails", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponseFor(""));
    mockRun.mockRejectedValueOnce(new Error("boom"));
    await expect(
      runContentVersionSetNeverPublish({
        itemId: "id-1",
        language: "en",
        value: true,
        allowWrite: true,
        yes: true,
      })
    ).rejects.toThrow("boom");
    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.outcome).toBe("error");
    expect(entry.errorMessage).toBe("boom");
  });
});
