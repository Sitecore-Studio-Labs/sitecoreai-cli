import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EnvironmentConfiguration, RootConfiguration } from "../../../../src/config/types";

vi.mock("../../../../src/policy/environment", () => ({ resolveEnvironment: vi.fn() }));
vi.mock("../../../../src/recipe/api/authoring-client", () => ({
  createAuthoringClient: vi.fn(),
}));

import { runDeploySiteBind } from "../../../../src/deploy/tasks/site-bind";
import { resolveEnvironment } from "../../../../src/policy/environment";
import { createAuthoringClient } from "../../../../src/recipe/api/authoring-client";
import type { DeploySiteBindOptions } from "../../../../src/deploy/tasks/types";

interface FakeItem {
  itemId: string;
  path: string;
  fields: Array<{ name: string; value: string }>;
}

interface FakeClient {
  getItem: ReturnType<typeof vi.fn>;
  updateItem: ReturnType<typeof vi.fn>;
}

let stdout: ReturnType<typeof vi.spyOn>;

const setupEnv = (): void => {
  const env = { name: "sandbox", host: "h" } as EnvironmentConfiguration;
  vi.mocked(resolveEnvironment).mockReturnValue({
    envName: "sandbox",
    environment: env,
    root: { environments: { sandbox: env } } as unknown as RootConfiguration,
    timeoutMs: undefined,
  });
};

/** Install a fake authoring client; `items` maps content-path → item. */
const setupClient = (items: Record<string, FakeItem | null>): FakeClient => {
  const client: FakeClient = {
    getItem: vi.fn(async (sel: { path: string }) => items[sel.path] ?? null),
    updateItem: vi.fn(async () => undefined),
  };
  vi.mocked(createAuthoringClient).mockReturnValue(client as never);
  return client;
};

const siteGroupingPath = "/sitecore/content/Collection/e2e/Settings/Site Grouping/e2e";
const startItemPath = "/sitecore/content/Collection/e2e/Home";

const baseOptions = (overrides: Partial<DeploySiteBindOptions> = {}): DeploySiteBindOptions => ({
  siteName: "e2e",
  siteCollection: "Collection",
  json: true,
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  setupEnv();
  stdout = vi.spyOn(process.stdout, "write").mockReturnValue(true);
});

afterEach(() => {
  stdout.mockRestore();
});

/**
 * The `data` payload of the last ScaiEnvelope written to stdout —
 * `printDeployResultWithContext` nests the bind result under `data`.
 */
const jsonData = (): Record<string, unknown> => {
  const envelope = JSON.parse(String(stdout.mock.calls.at(-1)?.[0] ?? "null")) as {
    data?: Record<string, unknown>;
  };
  return envelope.data ?? {};
};

describe("runDeploySiteBind — input validation", () => {
  it("throws INPUT_INVALID when --site-name is missing", async () => {
    setupClient({});
    await expect(runDeploySiteBind(baseOptions({ siteName: undefined }))).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when --site-collection is missing", async () => {
    setupClient({});
    await expect(
      runDeploySiteBind(baseOptions({ siteCollection: undefined }))
    ).rejects.toMatchObject({ code: "INPUT_INVALID" });
  });

  it("throws INPUT_INVALID when the Site Grouping item is not found", async () => {
    setupClient({ [siteGroupingPath]: null });
    await expect(runDeploySiteBind(baseOptions())).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });

  it("throws INPUT_INVALID when the Start Item is not found", async () => {
    setupClient({
      [siteGroupingPath]: { itemId: "sg-1", path: siteGroupingPath, fields: [] },
      [startItemPath]: null,
    });
    await expect(runDeploySiteBind(baseOptions())).rejects.toMatchObject({
      code: "INPUT_INVALID",
    });
  });
});

describe("runDeploySiteBind — plan-only paths", () => {
  it("does not write when --allow-write is absent (plan-only)", async () => {
    const client = setupClient({
      [siteGroupingPath]: { itemId: "sg-1", path: siteGroupingPath, fields: [] },
      [startItemPath]: { itemId: "home-1", path: startItemPath, fields: [] },
    });

    await runDeploySiteBind(baseOptions());

    expect(client.updateItem).not.toHaveBeenCalled();
    expect(jsonData()).toMatchObject({ mode: "plan-only (--allow-write not set)" });
  });

  it("does not write in --what-if mode even with --allow-write", async () => {
    const client = setupClient({
      [siteGroupingPath]: { itemId: "sg-1", path: siteGroupingPath, fields: [] },
      [startItemPath]: { itemId: "home-1", path: startItemPath, fields: [] },
    });

    await runDeploySiteBind(baseOptions({ allowWrite: true, whatIf: true }));

    expect(client.updateItem).not.toHaveBeenCalled();
    expect(jsonData()).toMatchObject({ mode: "what-if" });
  });
});

describe("runDeploySiteBind — idempotency short-circuit", () => {
  it("skips the write when the Site Grouping is already bound", async () => {
    const client = setupClient({
      [siteGroupingPath]: {
        itemId: "sg-1",
        path: siteGroupingPath,
        fields: [
          { name: "RenderingHost", value: "e2e" },
          { name: "HostName", value: "*" },
          { name: "StartItem", value: "{HOME-1}" },
        ],
      },
      [startItemPath]: { itemId: "home-1", path: startItemPath, fields: [] },
    });

    await runDeploySiteBind(baseOptions({ allowWrite: true }));

    expect(client.updateItem).not.toHaveBeenCalled();
    expect(jsonData()).toMatchObject({ mode: "no-op (already bound)", applied: false });
  });
});

describe("runDeploySiteBind — apply path", () => {
  it("writes the three Site Grouping fields when --allow-write is set", async () => {
    const client = setupClient({
      [siteGroupingPath]: { itemId: "sg-1", path: siteGroupingPath, fields: [] },
      [startItemPath]: { itemId: "home-1", path: startItemPath, fields: [] },
    });

    await runDeploySiteBind(baseOptions({ allowWrite: true }));

    expect(client.updateItem).toHaveBeenCalledOnce();
    const call = client.updateItem.mock.calls[0][0] as {
      itemId: string;
      fields: Array<{ fieldName: string; value: { kind: string; value: string } }>;
    };
    expect(call.itemId).toBe("sg-1");
    const byName = Object.fromEntries(call.fields.map((f) => [f.fieldName, f.value]));
    expect(byName.HostName).toEqual({ kind: "string", value: "*" });
    expect(byName.RenderingHost).toEqual({ kind: "string", value: "e2e" });
    expect(byName.StartItem).toEqual({ kind: "ref-guid", value: "home-1" });
    expect(jsonData()).toMatchObject({ applied: true });
  });

  it("honors --rendering-host-name, --start-item-name and --host-name-pattern overrides", async () => {
    const customStartPath = "/sitecore/content/Collection/e2e/Landing";
    const client = setupClient({
      [siteGroupingPath]: { itemId: "sg-1", path: siteGroupingPath, fields: [] },
      [customStartPath]: { itemId: "landing-1", path: customStartPath, fields: [] },
    });

    await runDeploySiteBind(
      baseOptions({
        allowWrite: true,
        renderingHostName: "custom-host",
        startItemName: "Landing",
        hostNamePattern: "www.example.com",
      })
    );

    const call = client.updateItem.mock.calls[0][0] as {
      fields: Array<{ fieldName: string; value: { value: string } }>;
    };
    const byName = Object.fromEntries(call.fields.map((f) => [f.fieldName, f.value.value]));
    expect(byName.RenderingHost).toBe("custom-host");
    expect(byName.HostName).toBe("www.example.com");
    // The updateItem call carries the raw start-item id (the uppercased
    // braced form only appears in the printed `fields` summary).
    expect(byName.StartItem).toBe("landing-1");
  });
});
