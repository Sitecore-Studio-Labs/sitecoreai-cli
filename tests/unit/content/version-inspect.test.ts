import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../src/config/types";

vi.mock("../../../src/shared/env", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../src/recipe/api/graphql", () => ({ runAuthoringGraphQL: vi.fn() }));

import { runContentVersionInspect } from "../../../src/content/tasks/version-inspect";
import { resolveEnvironment } from "../../../src/shared/env";
import { runAuthoringGraphQL } from "../../../src/recipe/api/graphql";

const mockRun = runAuthoringGraphQL as unknown as ReturnType<typeof vi.fn>;
const mockResolveEnv = resolveEnvironment as unknown as ReturnType<typeof vi.fn>;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "scai-content-ins-"));
const auditPath = path.join(tmpRoot, "audit.log");

const setupEnv = (): EnvironmentConfiguration => {
  const env = {
    name: "sandbox",
    host: "h",
    tenantId: "t",
  } as EnvironmentConfiguration;
  mockResolveEnv.mockReturnValue({
    envName: env.name!,
    environment: env,
    root: { environments: { [env.name!]: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
  return env;
};

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

describe("runContentVersionInspect", () => {
  it("requires --language", async () => {
    setupEnv();
    await expect(runContentVersionInspect({ itemId: "id-1", language: "" })).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("issues a read-only call and does NOT write the audit log", async () => {
    setupEnv();
    mockRun.mockResolvedValue({
      item: {
        itemId: "id-1",
        name: "Home",
        path: "/sitecore/content/Home",
        version: {
          version: 2,
          language: { name: "en" },
          fields: {
            nodes: [
              { name: "__Never publish", value: "1" },
              { name: "__Valid from", value: "" },
              { name: "__Valid to", value: "2026-12-31" },
              { name: "Title", value: "Hi" },
            ],
          },
        },
      },
    });

    await runContentVersionInspect({
      itemId: "id-1",
      language: "en",
    });

    // Audit log not written — reads don't audit.
    expect(fs.existsSync(auditPath)).toBe(false);
  });

  it("emits JSON when --json is set and includes parsed publish state", async () => {
    setupEnv();
    mockRun.mockResolvedValue({
      item: {
        itemId: "id-1",
        name: "Home",
        path: "/p",
        version: {
          version: 1,
          language: { name: "en" },
          fields: {
            nodes: [{ name: "__Never publish", value: "1" }],
          },
        },
      },
    });

    const writeSpy = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await runContentVersionInspect({
        itemId: "id-1",
        language: "en",
        json: true,
      });
      const printed = writeSpy.mock.calls.map((c) => String(c[0])).join("");
      const parsed = JSON.parse(printed.trim());
      expect(parsed.publishState.neverPublish).toBe(true);
      expect(parsed.publishState.neverPublishRaw).toBe("1");
    } finally {
      writeSpy.mockRestore();
    }
  });
});
