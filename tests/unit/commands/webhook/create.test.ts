import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai webhook create` command wiring. The webhook-create task runner
 * is mocked; tests parse the single-level command the way the CLI does
 * and assert the required-option enforcement on `--name` / `--url` /
 * `--event`, the custom `--event` / `--action` / `--serialization-type`
 * validators (valid + invalid paths), the comma-split `--events`
 * accumulator, and the `--disabled` → `enabled:false` inversion.
 */

const taskMocks = vi.hoisted(() => ({
  runWebhookCreate: vi.fn(),
}));

vi.mock("../../../../src/webhooks/tasks/create", () => taskMocks);

import { createWebhookCreateCommand } from "../../../../src/commands/webhook/create";

const runWebhookCreate = async (args: string[]): Promise<void> => {
  const command = createWebhookCreateCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

const baseArgs = ["--name", "MyHook", "--url", "https://hooks.example.com/in"];

beforeEach(() => {
  for (const m of Object.values(taskMocks)) m.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebhookCreateCommand — option surface", () => {
  const command = createWebhookCreateCommand();

  it("marks --name / --url / --event as required", () => {
    const required = command.options.filter((o) => o.mandatory).map((o) => o.long);
    expect(required).toEqual(expect.arrayContaining(["--name", "--url", "--event"]));
  });

  it("declares the flavor-specific flags", () => {
    const longs = new Set(command.options.map((o) => o.long));
    for (const long of [
      "--events",
      "--on-state",
      "--action",
      "--description",
      "--authorization",
      "--serialization-type",
      "--parent-path",
      "--disabled",
      "--what-if",
      "--allow-write",
    ]) {
      expect(longs.has(long), long).toBe(true);
    }
  });
});

describe("webhook create — required-option enforcement", () => {
  it("rejects a missing required --event", async () => {
    await expect(runWebhookCreate([...baseArgs, "--quiet"])).rejects.toBeDefined();
    expect(taskMocks.runWebhookCreate).not.toHaveBeenCalled();
  });

  it("rejects a missing required --url", async () => {
    await expect(
      runWebhookCreate(["--name", "MyHook", "--event", "item", "--quiet"])
    ).rejects.toBeDefined();
    expect(taskMocks.runWebhookCreate).not.toHaveBeenCalled();
  });
});

describe("webhook create — custom validators", () => {
  it("rejects an invalid --event category", async () => {
    await expect(runWebhookCreate([...baseArgs, "--event", "bogus", "--quiet"])).rejects.toThrow(
      /Invalid --event/
    );
    expect(taskMocks.runWebhookCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid --action kind", async () => {
    await expect(
      runWebhookCreate([...baseArgs, "--event", "workflow", "--action", "approve", "--quiet"])
    ).rejects.toThrow(/Invalid --action/);
    expect(taskMocks.runWebhookCreate).not.toHaveBeenCalled();
  });

  it("rejects an invalid --serialization-type", async () => {
    await expect(
      runWebhookCreate([...baseArgs, "--event", "item", "--serialization-type", "yaml", "--quiet"])
    ).rejects.toThrow(/Invalid --serialization-type/);
    expect(taskMocks.runWebhookCreate).not.toHaveBeenCalled();
  });

  it("accepts a valid workflow --action and --serialization-type", async () => {
    await runWebhookCreate([
      ...baseArgs,
      "--event",
      "workflow",
      "--on-state",
      "/sitecore/system/Workflows/Sample/Draft",
      "--action",
      "validation",
      "--serialization-type",
      "XML",
      "--quiet",
    ]);
    expect(taskMocks.runWebhookCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "workflow",
        action: "validation",
        serializationType: "XML",
        onState: "/sitecore/system/Workflows/Sample/Draft",
      })
    );
  });
});

describe("webhook create — option threading", () => {
  it("splits comma-separated --events and accumulates repeats", async () => {
    await runWebhookCreate([
      ...baseArgs,
      "--event",
      "item",
      "--events",
      "item:saved, item:deleted",
      "--events",
      "item:created",
      "--quiet",
    ]);
    expect(taskMocks.runWebhookCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        events: ["item:saved", "item:deleted", "item:created"],
      })
    );
  });

  it("does not set enabled when --disabled is omitted", async () => {
    await runWebhookCreate([...baseArgs, "--event", "publish", "--quiet"]);
    const call = taskMocks.runWebhookCreate.mock.calls[0][0];
    expect(call.enabled).toBeUndefined();
  });

  it("threads --disabled as enabled:false", async () => {
    await runWebhookCreate([...baseArgs, "--event", "item", "--disabled", "--quiet"]);
    expect(taskMocks.runWebhookCreate).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("threads --description / --authorization / --parent-path through", async () => {
    await runWebhookCreate([
      ...baseArgs,
      "--event",
      "item",
      "--description",
      "audit hook",
      "--authorization",
      "/sitecore/system/Settings/Webhooks/Authorizations/Default",
      "--parent-path",
      "/sitecore/system/Webhooks/Custom",
      "--quiet",
    ]);
    expect(taskMocks.runWebhookCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        description: "audit hook",
        authorization: "/sitecore/system/Settings/Webhooks/Authorizations/Default",
        parentPath: "/sitecore/system/Webhooks/Custom",
      })
    );
  });
});
