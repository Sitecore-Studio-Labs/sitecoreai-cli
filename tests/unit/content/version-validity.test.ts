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

import { runContentVersionSetValidity } from "../../../src/content/tasks/version-validity";
import { resolveEnvironment } from "../../../src/shared/env";
import { runAuthoringGraphQL } from "../../../src/recipe/api/graphql";

const mockRun = runAuthoringGraphQL as unknown as ReturnType<typeof vi.fn>;
const mockResolveEnv = resolveEnvironment as unknown as ReturnType<typeof vi.fn>;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-content-val-"));
const auditPath = path.join(tmpRoot, "audit.log");

const setupEnv = (production = false): EnvironmentConfiguration => {
  const env = {
    name: "sandbox",
    host: "h",
    tenantId: "t",
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

const readResponse = (validFrom: string | undefined, validTo: string | undefined) => ({
  item: {
    itemId: "id-1",
    name: "Home",
    path: "/sitecore/content/Home",
    version: {
      version: 1,
      language: { name: "en" },
      fields: {
        nodes: [
          ...(validFrom !== undefined ? [{ name: "__Valid from", value: validFrom }] : []),
          ...(validTo !== undefined ? [{ name: "__Valid to", value: validTo }] : []),
        ],
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

describe("runContentVersionSetValidity", () => {
  it("requires at least one of valid-from/valid-to/clear-* flags", async () => {
    setupEnv();
    await expect(
      runContentVersionSetValidity({ itemId: "id-1", language: "en" })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects both --valid-from and --clear-valid-from", async () => {
    setupEnv();
    await expect(
      runContentVersionSetValidity({
        itemId: "id-1",
        language: "en",
        validFrom: "2026-01-01",
        clearValidFrom: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("rejects malformed ISO 8601 input", async () => {
    setupEnv();
    await expect(
      runContentVersionSetValidity({
        itemId: "id-1",
        language: "en",
        validFrom: "not-a-date",
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("writes both fields when both are provided and records both audit changes", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse("", ""));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });

    await runContentVersionSetValidity({
      itemId: "id-1",
      language: "en",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      allowWrite: true,
      yes: true,
    });

    const writeVars = mockRun.mock.calls[1][2] as {
      fields: Array<{ name: string; value: string }>;
    };
    expect(writeVars.fields).toEqual(
      expect.arrayContaining([
        { name: "__Valid from", value: "2026-01-01" },
        { name: "__Valid to", value: "2026-12-31" },
      ])
    );

    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.fieldChanges).toHaveLength(2);
    expect(entry.scope.kind).toBe("validity");
  });

  it("writes empty string when --clear-valid-to is used", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse(undefined, "2026-12-31"));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });

    await runContentVersionSetValidity({
      itemId: "id-1",
      language: "en",
      clearValidTo: true,
      allowWrite: true,
      yes: true,
    });

    const writeVars = mockRun.mock.calls[1][2] as {
      fields: Array<{ name: string; value: string }>;
    };
    expect(writeVars.fields).toEqual([{ name: "__Valid to", value: "" }]);
    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.fieldChanges[0]).toMatchObject({
      name: "__Valid to",
      before: "2026-12-31",
      after: null,
    });
  });

  it("does NOT call the publish API (pure CM mutation)", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse("", ""));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    await runContentVersionSetValidity({
      itemId: "id-1",
      language: "en",
      validTo: "2026-12-31",
      allowWrite: true,
      yes: true,
    });
    // 2 calls = 1 read + 1 write. Nothing else.
    expect(mockRun).toHaveBeenCalledTimes(2);
  });

  it("dry-run returns without writing or auditing", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse("", ""));
    await runContentVersionSetValidity({
      itemId: "id-1",
      language: "en",
      validTo: "2026-12-31",
      // whatIf default
    });
    expect(mockRun).toHaveBeenCalledOnce();
    expect(fs.existsSync(auditPath)).toBe(false);
  });

  it("audits an error entry when the write fails", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse("", ""));
    mockRun.mockRejectedValueOnce(new Error("write failed"));
    await expect(
      runContentVersionSetValidity({
        itemId: "id-1",
        language: "en",
        validTo: "2026-12-31",
        allowWrite: true,
        yes: true,
      })
    ).rejects.toThrow("write failed");
    const entry = JSON.parse(fs.readFileSync(auditPath, "utf8").trim());
    expect(entry.outcome).toBe("error");
    expect(entry.errorMessage).toBe("write failed");
  });

  it("emits JSON when --json is set", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse("", ""));
    mockRun.mockResolvedValueOnce({ updateItem: { item: { itemId: "id-1" } } });
    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runContentVersionSetValidity({
        itemId: "id-1",
        language: "en",
        validTo: "2026-12-31",
        allowWrite: true,
        yes: true,
        json: true,
      });
      const printed = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      expect(printed).toContain("changes");
    } finally {
      writeSpy.mockRestore();
    }
  });

  it("rejects --valid-to + --clear-valid-to combination", async () => {
    setupEnv();
    await expect(
      runContentVersionSetValidity({
        itemId: "id-1",
        language: "en",
        validTo: "2026-12-31",
        clearValidTo: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("non-interactive without --yes fails before any write", async () => {
    setupEnv();
    mockRun.mockResolvedValueOnce(readResponse("", ""));
    await expect(
      runContentVersionSetValidity({
        itemId: "id-1",
        language: "en",
        validTo: "2026-12-31",
        allowWrite: true,
        nonInteractive: true,
      })
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });
});
