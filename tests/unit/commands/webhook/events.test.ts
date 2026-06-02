import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `scai webhook events` command wiring. Covers the inline --category
 * parser (item | publish accept; anything else throws), the action's
 * happy-path delegation, and read-option threading.
 */

const taskMocks = vi.hoisted(() => ({
  runWebhookEvents: vi.fn(),
}));

vi.mock("../../../../src/webhooks/tasks/events", () => taskMocks);

import { createWebhookEventsCommand } from "../../../../src/commands/webhook/events";

const runCmd = async (args: string[]): Promise<void> => {
  const command = createWebhookEventsCommand();
  command.exitOverride();
  await command.parseAsync(["node", "scai", ...args]);
};

beforeEach(() => {
  taskMocks.runWebhookEvents.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createWebhookEventsCommand", () => {
  it("delegates to runWebhookEvents with no filter when --category is omitted", async () => {
    await runCmd(["--quiet"]);
    expect(taskMocks.runWebhookEvents).toHaveBeenCalledOnce();
    const call = taskMocks.runWebhookEvents.mock.calls[0][0];
    expect(call.category).toBeUndefined();
  });

  it("threads --category item through", async () => {
    await runCmd(["--quiet", "--category", "item"]);
    expect(taskMocks.runWebhookEvents).toHaveBeenCalledWith(
      expect.objectContaining({ category: "item" })
    );
  });

  it("threads --category publish through", async () => {
    await runCmd(["--quiet", "--category", "publish"]);
    expect(taskMocks.runWebhookEvents).toHaveBeenCalledWith(
      expect.objectContaining({ category: "publish" })
    );
  });

  it("rejects --category workflow (only item | publish allowed on the events catalog)", async () => {
    await expect(runCmd(["--quiet", "--category", "workflow"])).rejects.toThrow(
      /Invalid --category 'workflow'/
    );
    expect(taskMocks.runWebhookEvents).not.toHaveBeenCalled();
  });

  it("rejects any garbage --category value", async () => {
    await expect(runCmd(["--quiet", "--category", "everything"])).rejects.toThrow(
      /Invalid --category/
    );
  });
});
